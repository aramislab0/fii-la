-- Fii La : correctifs de la revue de bugs du 19/10/2026 (aucune donnée modifiée, seulement des fonctions).
-- 1. Commande de vitrine : le numéro tapé n'est pas vérifié, donc l'adresse reçue ne remplace jamais celle d'un client connu.
-- 2. Commande sans « items » (appel direct) : refusée au lieu de créer une commande vide.
-- 3. Parrainage par numéro : la boutique, le livreur ou le compte qui porte le numéro passe avant une fiche anonyme.
-- 4. « Supprimer mon code » avec un compte : la fiche n'est plus recréée d'office à la visite suivante.
-- 5. Repère vocal : écoute par le propriétaire (même lien coupé), par le demandeur d'une adresse et par la boutique.
-- 6. Vitrine : photos comptées à part (plusieurs abonnés mobiles partagent souvent la même adresse IP), 200 articles,
--    quota de commandes relevé.

-- 1.
create or replace function fiila.order_sync(p_id uuid) returns fiila.orders
language plpgsql set search_path = '' as $$
declare o fiila.orders; q fiila.requests;
begin
  select * into o from fiila.orders where id = p_id;
  if o.place_id is null and o.request_id is not null then
    select * into q from fiila.requests where id = o.request_id;
    if found and q.fulfilled_at is not null and q.place_id is not null then
      update fiila.orders set place_id = q.place_id, updated_at = now() where id = o.id returning * into o;
      if o.source is distinct from 'vitrine' then
        update fiila.customers set place_id = q.place_id, updated_at = now() where id = o.customer_id;
      end if;
      if fiila.order_dispatch(o.id, false) then select * into o from fiila.orders where id = o.id; end if;
    end if;
  end if;
  return o;
end $$;

-- 2. (et 1., 6. pour la vitrine)
create or replace function public.fiila_vitrine_order(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; c fiila.customers; o fiila.orders; pr fiila.products;
  it jsonb; v_items jsonb := '[]'::jsonb; v_qty int; v_total bigint := 0; v_num int; v_name text; v_phone text;
begin
  perform fiila.rate_check('vitrine_order', 40);
  perform fiila.housekeeping();
  select * into s from fiila.shops where slug = p_slug and public for update;
  if not found then perform fiila.fail('not_found'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if coalesce(jsonb_typeof(p -> 'items'), '') <> 'array' or jsonb_array_length(p -> 'items') = 0 then perform fiila.fail('items_required'); end if;
  if jsonb_array_length(p -> 'items') > 20 then perform fiila.fail('too_many'); end if;
  v_name := fiila.clean(p -> 'customer' ->> 'name', 60);
  if v_name is null then perform fiila.fail('customer_name_required'); end if;
  v_phone := fiila.clean_phone(p -> 'customer' ->> 'phone');
  if nullif(fiila.phone_key(v_phone), '') is null then perform fiila.fail('phone_required'); end if;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    begin v_qty := (it ->> 'qty')::int; exception when others then perform fiila.fail('invalid_qty'); end;
    if v_qty is null or v_qty < 1 or v_qty > 99 then perform fiila.fail('invalid_qty'); end if;
    select * into pr from fiila.products where id = fiila.as_uuid(it ->> 'product_id') and shop_id = s.id and active;
    if not found then perform fiila.fail('product_not_found'); end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'label', pr.name, 'qty', v_qty, 'price', pr.price));
    v_total := v_total + v_qty * pr.price;
  end loop;
  -- Client de la boutique : retrouvé par son numéro (sans changer le nom enregistré par la boutique), sinon créé.
  -- Le numéro n'est pas vérifié : l'adresse reçue pour cette commande ne sera jamais copiée sur ce client (order_sync).
  select * into c from fiila.customers where shop_id = s.id and fiila.phone_key(phone) = fiila.phone_key(v_phone) order by created_at limit 1;
  if not found then
    if (select count(*) from fiila.customers where shop_id = s.id) >= 5000 then perform fiila.fail('too_many'); end if;
    insert into fiila.customers (shop_id, name, phone) values (s.id, v_name, v_phone) returning * into c;
  end if;
  update fiila.shops set next_number = next_number + 1 where id = s.id returning next_number - 1 into v_num;
  -- Jamais d'adresse reprise automatiquement : la personne donne la sienne par le lien de la facture.
  insert into fiila.orders (shop_id, number, customer_id, customer_name, customer_phone, items, total, note, share_token, place_id, source)
  values (s.id, v_num, c.id, v_name, v_phone, v_items, v_total, fiila.clean(p ->> 'note', 200), fiila.token(16), null, 'vitrine')
  returning * into o;
  perform fiila.order_new_request(s, o);
  return jsonb_build_object('invoice', o.share_token, 'ref', fiila.order_ref(o.number), 'total', o.total,
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'phone', s.phone)));
end $$;

create or replace function public.fiila_order_create(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p is not null and jsonb_typeof(p) = 'object' and coalesce(jsonb_typeof(p -> 'items'), '') <> 'array' then
    perform fiila.fail('items_required');
  end if;
  return fiila.after_order_create(fiila.order_create_base(p_key, p));
end $$;

-- 3. Parrainage par numéro : une boutique, un livreur ou un compte qui porte ce numéro passe avant une fiche anonyme
--    (la première fiche créée ne gagne plus d'office). Le numéro reste déclaratif : pas de récompense sans contrôle.
create or replace function fiila.ref_by_phone(p_key text) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare r fiila.referrers; v_id uuid;
begin
  if p_key is null then return null; end if;
  select * into r from fiila.referrers where phone_key = p_key and (shop_id is not null or courier_id is not null or user_id is not null)
   order by (shop_id is null), (courier_id is null), created_at limit 1;
  if found then return r; end if;
  select id into v_id from fiila.shops where fiila.ref_phone(phone) = p_key order by created_at limit 1;
  if v_id is not null then return fiila.ref_for_shop(v_id); end if;
  select id into v_id from fiila.couriers where fiila.ref_phone(phone) = p_key order by created_at limit 1;
  if v_id is not null then return fiila.ref_for_courier(v_id); end if;
  select user_id into v_id from fiila.profiles where fiila.ref_phone(phone) = p_key and not ref_opt_out order by created_at limit 1;
  if v_id is not null then return fiila.ref_for_user(v_id); end if;
  select * into r from fiila.referrers where phone_key = p_key order by created_at limit 1;
  if found then return r; end if;
  return null;
end $$;

-- 4. Compte qui a supprimé sa fiche de parrainage : elle n'est plus recréée d'office (ni par l'espace « Parrainer »,
--    ni quand quelqu'un tape son numéro). Elle revient seulement s'il la recrée lui-même.
alter table fiila.profiles add column ref_opt_out boolean not null default false;

create or replace function fiila.ref_for_user(p_uid uuid) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare r fiila.referrers; pr fiila.profiles;
begin
  select * into r from fiila.referrers where user_id = p_uid;
  if found then return r; end if;
  select * into pr from fiila.profiles where user_id = p_uid;
  if pr.ref_opt_out then return null; end if;
  insert into fiila.referrers (code, user_id, name, phone_key)
  values (fiila.ref_code(), p_uid, pr.display_name, fiila.ref_phone(pr.phone)) returning * into r;
  perform fiila.ref_link_pending(r);
  return r;
end $$;

create or replace function public.fiila_referral_me(p_for text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.referrers; s fiila.shops; c fiila.couriers;
begin
  perform fiila.read_check();
  if p_for = 'shop' then s := fiila.my_shop(p_key); r := fiila.ref_for_shop(s.id);
  elsif p_for = 'courier' then c := fiila.my_courier(p_key); r := fiila.ref_for_courier(c.id);
  elsif p_for = 'person' then
    r := fiila.my_person_ref(p_key);
    if r.id is null and fiila.uid() is not null then r := fiila.ref_for_user(fiila.uid()); end if;
    if r.id is null then return jsonb_build_object('referrer', null); end if;
  else perform fiila.fail('invalid_payload');
  end if;
  return jsonb_build_object('referrer', fiila.referrer_json(r));
end $$;

create or replace function public.fiila_referral_card_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.referrers := fiila.my_person_ref(p_key); v_key text; v_name text; v_phone text;
begin
  perform fiila.rate_check('referral_card', 20);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name := fiila.clean(p ->> 'name', 60);
  if v_name is null then perform fiila.fail('name_required'); end if;
  v_phone := fiila.ref_phone(p ->> 'phone');
  if p ? 'phone' and nullif(trim(p ->> 'phone'), '') is not null and v_phone is null then perform fiila.fail('invalid_phone'); end if;
  if r.id is null then
    if fiila.uid() is null then v_key := fiila.token(32); end if;
    insert into fiila.referrers (code, owner_hash, user_id, name, phone_key)
    values (fiila.ref_code(), case when v_key is not null then fiila.h(v_key) end, fiila.uid(), v_name, v_phone)
    returning * into r;
  else
    update fiila.referrers set name = v_name, phone_key = coalesce(v_phone, phone_key) where id = r.id returning * into r;
  end if;
  if fiila.uid() is not null then update fiila.profiles set ref_opt_out = false where user_id = fiila.uid(); end if;
  perform fiila.ref_link_pending(r);
  return jsonb_build_object('key', v_key, 'referrer', fiila.referrer_json(r));
end $$;

create or replace function public.fiila_referral_card_delete(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.referrers := fiila.my_person_ref(p_key);
begin
  perform fiila.rate_check('referral_card', 20);
  if r.id is null then perform fiila.fail('not_found'); end if;
  if r.user_id is not null then update fiila.profiles set ref_opt_out = true where user_id = r.user_id; end if;
  delete from fiila.referrers where id = r.id;
  return jsonb_build_object('deleted', true);
end $$;

-- 5. p_kind : 'place' (clé de gestion ou compte), 'request' (clé de la demande ou compte), 'order' (clé de boutique ou compte).
create or replace function public.fiila_voice_private(p_kind text, p_id text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places; q fiila.requests; o fiila.orders;
begin
  perform fiila.read_check();
  if p_kind = 'place' then
    r := fiila.owned_place(p_id, p_key);
  elsif p_kind = 'request' then
    q := fiila.owned_request(p_id, p_key);
    if q.place_id is null or q.fulfilled_at is null then return jsonb_build_object('state', 'not_found'); end if;
    select * into r from fiila.places where id = q.place_id;
    if r.status <> 'active' then return jsonb_build_object('state', 'not_found'); end if;
  elsif p_kind = 'order' then
    o := fiila.my_order(p_key, p_id);
    if o.place_id is null then return jsonb_build_object('state', 'not_found'); end if;
    select * into r from fiila.places where id = o.place_id;
    if r.status <> 'active' then return jsonb_build_object('state', 'not_found'); end if;
  else
    perform fiila.fail('invalid_payload');
  end if;
  if r.id is null or r.voice is null then return jsonb_build_object('state', 'not_found'); end if;
  return jsonb_build_object('state', 'ok', 'secs', r.voice_secs,
    'voice', 'data:' || r.voice_type || ';base64,' || replace(encode(r.voice, 'base64'), E'\n', ''));
end $$;

-- 6.
create or replace function public.fiila_vitrine(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops;
begin
  perform fiila.read_check();
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,40}$' then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where slug = p_slug;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if not s.public then return jsonb_build_object('state', 'closed', 'shop', jsonb_build_object('name', s.name)); end if;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'about', s.about, 'phone', s.phone,
      'theme', s.theme, 'accent', s.accent, 'has_cover', case when s.cover is not null then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 200) pr), '[]'::jsonb));
end $$;

create or replace function public.fiila_vitrine_photo(p_slug text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  perform fiila.rate_check('vitrine_photo', 6000);
  if p_id = 'cover' then
    select 'data:' || s.cover_type || ';base64,' || replace(encode(s.cover, 'base64'), E'\n', '') into v
      from fiila.shops s where s.slug = p_slug and s.public and s.cover is not null;
    return jsonb_strip_nulls(jsonb_build_object('photo', v));
  end if;
  select 'data:' || pr.photo_type || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '') into v
    from fiila.products pr join fiila.shops s on s.id = pr.shop_id
   where s.slug = p_slug and s.public and pr.id = fiila.as_uuid(p_id) and pr.active and pr.photo is not null;
  return jsonb_strip_nulls(jsonb_build_object('photo', v));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_vitrine_order(text, jsonb)', 'public.fiila_order_create(text, jsonb)',
    'public.fiila_referral_me(text, text)', 'public.fiila_referral_card_save(text, jsonb)', 'public.fiila_referral_card_delete(text)', 'public.fiila_voice_private(text, text, text)',
    'public.fiila_vitrine(text)', 'public.fiila_vitrine_photo(text, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('grant execute on function %s to %I', fn, role_name);
      end if;
    end loop;
  end loop;
end $$;
