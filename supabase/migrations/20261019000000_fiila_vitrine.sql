-- Fii La : vitrine publique de la boutique (fondateur, 18/10/2026 23:16 : « Vitrine de la boutique »).
-- Page publique #/b/<slug> : articles visibles, panier, « Commander » crée la commande et la demande d'adresse.
-- Sécurité : la vitrine est fermée par défaut (la boutique l'ouvre) ; les prix viennent toujours de la base ;
-- une commande en ligne ne réutilise jamais une adresse déjà connue (un numéro tapé ne suffit pas à livrer chez quelqu'un).

alter table fiila.shops add column slug text unique, add column public boolean not null default false, add column about text;
alter table fiila.shops add constraint shops_slug_format check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
alter table fiila.orders add column source text not null default 'shop' check (source in ('shop', 'vitrine'));
alter table fiila.referrals drop constraint referrals_source_check;
alter table fiila.referrals add constraint referrals_source_check check (source in ('code', 'phone', 'link', 'request', 'invoice', 'address', 'meeting',
  'course', 'watch', 'courier_invite', 'post', 'vitrine', 'direct'));

-- Identifiant lisible de la vitrine, tiré du nom (sans accents), unique.
create or replace function fiila.make_slug(p_name text) returns text
language plpgsql set search_path = '' as $$
declare v_base text; v_slug text; i int := 0;
begin
  v_base := lower(translate(coalesce(p_name, ''), 'ÀÂÄÁÃÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝàâäáãçéèêëíìîïñóòôöõúùûüýÿ’''',
                                                'AAAAACEEEEIIIINOOOOOUUUUYaaaaaceeeeiiiinooooouuuuyy  '));
  v_base := trim(both '-' from regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'));
  v_base := left(v_base, 30);
  if char_length(v_base) < 3 then v_base := 'boutique'; end if;
  v_base := trim(both '-' from v_base);
  v_slug := v_base;
  while exists (select 1 from fiila.shops where slug = v_slug) loop
    i := i + 1;
    v_slug := v_base || '-' || substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 4);
    if i > 20 then perform fiila.fail('slug_unavailable'); end if;
  end loop;
  return v_slug;
end $$;

create or replace function fiila.shop_json(s fiila.shops) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone, 'ninea', s.ninea,
    'slug', s.slug, 'public', s.public, 'about', s.about, 'created_at', s.created_at))
$$;

-- Ouvrir, fermer ou décrire sa vitrine. p : {public?, about?} ; p null = lecture.
create or replace function public.fiila_shop_vitrine(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  if p is not null then
    perform fiila.rate_check('shop_vitrine', 60);
    if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
    if s.slug is null then update fiila.shops set slug = fiila.make_slug(s.name) where id = s.id returning * into s; end if;
    update fiila.shops set
      public = coalesce((p ->> 'public')::boolean, public),
      about = case when p ? 'about' then fiila.clean(p ->> 'about', 160) else about end,
      updated_at = now()
     where id = s.id returning * into s;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('slug', s.slug, 'public', s.public, 'about', s.about,
    'products', (select count(*) from fiila.products where shop_id = s.id and active)));
end $$;

-- Vitrine publique (sans photos : elles sont chargées une à une, à l'affichage).
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
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 60) pr), '[]'::jsonb));
end $$;

create or replace function public.fiila_vitrine_photo(p_slug text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  perform fiila.read_check();
  select 'data:' || pr.photo_type || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '') into v
    from fiila.products pr join fiila.shops s on s.id = pr.shop_id
   where s.slug = p_slug and s.public and pr.id = fiila.as_uuid(p_id) and pr.active and pr.photo is not null;
  return jsonb_strip_nulls(jsonb_build_object('photo', v));
end $$;

-- Commande passée depuis la vitrine. p : {items: [{product_id, qty}], customer: {name, phone}, note}.
create or replace function public.fiila_vitrine_order(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; c fiila.customers; o fiila.orders; pr fiila.products;
  it jsonb; v_items jsonb := '[]'::jsonb; v_qty int; v_total bigint := 0; v_num int; v_name text; v_phone text;
begin
  perform fiila.rate_check('vitrine_order', 10);
  perform fiila.housekeeping();
  select * into s from fiila.shops where slug = p_slug and public for update;
  if not found then perform fiila.fail('not_found'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then perform fiila.fail('items_required'); end if;
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
create or replace function fiila.ref_by_link(p_src text, p_token text) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare v_shop uuid; v_courier uuid; v_uid uuid;
begin
  if p_token is null or char_length(p_token) > 100 then return null; end if;
  if p_src = 'request' then
    select o.shop_id into v_shop from fiila.requests q join fiila.orders o on o.request_id = q.id where q.share_token = p_token limit 1;
    if v_shop is null then select user_id into v_uid from fiila.requests where share_token = p_token; end if;
  elsif p_src = 'invoice' then
    select shop_id into v_shop from fiila.orders where share_token = p_token;
  elsif p_src in ('address', 'meeting') then
    select user_id into v_uid from fiila.places where share_token = p_token;
  elsif p_src = 'course' then
    select courier_id into v_courier from fiila.trackers where send_hash = fiila.h(p_token);
  elsif p_src = 'watch' then
    select o.shop_id into v_shop from fiila.orders o where o.watch_token = p_token;
  elsif p_src = 'vitrine' then
    select id into v_shop from fiila.shops where slug = lower(p_token) and public;
  elsif p_src = 'courier_invite' then
    select shop_id into v_shop from fiila.courier_invites where token_hash = fiila.h(p_token);
  end if;
  if v_shop is not null then return fiila.ref_for_shop(v_shop); end if;
  if v_courier is not null then return fiila.ref_for_courier(v_courier); end if;
  if v_uid is not null then return fiila.ref_for_user(v_uid); end if;
  return null;
end $$;

create or replace function public.fiila_attribute(p_kind text, p_id text, p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_courier uuid; v_place uuid; v_created timestamptz; v_self_phone text; v_self_uid uuid;
        r fiila.referrers; v_src text := 'direct'; v_pending text; v_phone text; v_code text; v_ctx text; v_tok text;
        s fiila.shops; c fiila.couriers; pl fiila.places;
begin
  perform fiila.rate_check('attribute', 60);
  if p is null then p := '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if p_kind = 'shop' then
    s := fiila.my_shop(p_key); v_shop := s.id; v_created := s.created_at; v_self_phone := fiila.ref_phone(s.phone); v_self_uid := s.user_id;
  elsif p_kind = 'courier' then
    c := fiila.my_courier(p_key); v_courier := c.id; v_created := c.created_at; v_self_phone := fiila.ref_phone(c.phone); v_self_uid := c.user_id;
  elsif p_kind in ('address', 'meeting') then
    pl := fiila.owned_place(p_id, p_key);
    if pl.kind <> p_kind then perform fiila.fail('not_found'); end if;
    v_place := pl.id; v_created := pl.created_at; v_self_uid := pl.user_id;
  else perform fiila.fail('invalid_payload');
  end if;
  if v_created < now() - interval '1 hour'
     or exists (select 1 from fiila.referrals where shop_id = v_shop or courier_id = v_courier or place_id = v_place) then
    return jsonb_build_object('ok', true);
  end if;

  v_code := upper(trim(coalesce(p ->> 'code', '')));
  v_phone := fiila.ref_phone(p ->> 'phone');
  v_ctx := p ->> 'src'; v_tok := p ->> 'token';
  if v_code ~ '^[A-Z0-9]{6}$' then
    select * into r from fiila.referrers where code = v_code;
    if r.id is not null then v_src := 'code'; end if;
  end if;
  if r.id is null and v_phone is not null then
    r := fiila.ref_by_phone(v_phone); v_src := 'phone';
    if r.id is null then v_pending := v_phone; end if;
  end if;
  if r.id is null and v_pending is null and v_ctx = 'link' and v_tok ~ '^[A-Za-z0-9]{6}$' then
    select * into r from fiila.referrers where code = upper(v_tok);
    if r.id is not null then v_src := 'link'; end if;
  end if;
  if r.id is null and v_pending is null
     and v_ctx in ('request', 'invoice', 'address', 'meeting', 'course', 'watch', 'courier_invite', 'vitrine') then
    v_src := v_ctx;
    if v_ctx = 'address' then v_src := coalesce((select kind from fiila.places where share_token = v_tok), 'address'); end if;
    r := fiila.ref_by_link(v_ctx, v_tok);
  end if;

  -- Jamais soi-même : même boutique, même livreur, même compte ou même numéro.
  if r.id is not null and (r.shop_id is not distinct from v_shop and v_shop is not null
       or r.courier_id is not distinct from v_courier and v_courier is not null
       or (v_self_uid is not null and r.user_id = v_self_uid)
       or (fiila.uid() is not null and r.user_id = fiila.uid())
       or (v_self_phone is not null and r.phone_key = v_self_phone)) then
    r := null;
  end if;
  if v_pending is not null and v_pending = v_self_phone then v_pending := null; end if;

  insert into fiila.referrals (referrer_id, phone_key, kind, shop_id, courier_id, place_id, source)
  values (r.id, v_pending, p_kind, v_shop, v_courier, v_place, v_src);
  return jsonb_build_object('ok', true);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_shop_vitrine(text, jsonb)', 'public.fiila_vitrine(text)', 'public.fiila_vitrine_photo(text, text)',
    'public.fiila_vitrine_order(text, jsonb)', 'public.fiila_attribute(text, text, text, jsonb)'];
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
