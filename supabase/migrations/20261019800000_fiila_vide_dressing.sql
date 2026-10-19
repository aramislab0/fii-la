-- Fii La : vide-dressing enfants, pilote tenu par Fii La (fondateur, 19/10/2026 07:15 : « 1. Ok » à la proposition
-- docs/PROPOSITION-VIDE-DRESSING-AMBASSADEURS.md §1). Tout utilisateur avec un compte propose un article ; rien n'est publié
-- sans validation ; l'article validé entre dans la vitrine « Vide-dressing Fii La » (boutique de la plateforme) ; la vendeuse
-- reste invisible pour l'acheteur ; Fii La coordonne la livraison et reverse le prix moins la commission.
-- Garde-fous : compte obligatoire, 20 articles en attente au plus, compte bloqué après 3 refus en 30 jours, photo contrôlée
-- (aucun enfant reconnaissable), articles interdits rappelés, un seul exemplaire par annonce (stock 1).

insert into fiila.settings (key, value) values ('vd_commission', '15') on conflict (key) do nothing;

alter table fiila.shops add column platform boolean not null default false;
alter table fiila.products
  add column gender text check (gender in ('fille', 'garcon', 'mixte')),
  add column age_band text check (age_band in ('0-6m', '6-12m', '1-2a', '2-4a', '4-6a', '6-8a', '8-10a', '10-12a', '12-14a')),
  add column condition text check (condition in ('neuf', 'tres_bon', 'bon')),
  add column submission_id uuid;

create table fiila.vd_submissions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  seller_name  text not null,
  seller_phone text not null,
  quartier     text,
  title        text not null,
  gender       text not null check (gender in ('fille', 'garcon', 'mixte')),
  age_band     text not null check (age_band in ('0-6m', '6-12m', '1-2a', '2-4a', '4-6a', '6-8a', '8-10a', '10-12a', '12-14a')),
  size         text,
  condition    text not null check (condition in ('neuf', 'tres_bon', 'bon')),
  price        integer not null check (price between 100 and 1000000),
  photo        bytea not null,
  photo_type   text not null,
  status       text not null default 'pending' check (status in ('pending', 'changes', 'approved', 'rejected', 'sold', 'withdrawn')),
  reason       text,
  product_id   uuid references fiila.products (id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  sold_at      timestamptz,
  paid_at      timestamptz
);
create index vd_submissions_user on fiila.vd_submissions (user_id, created_at desc);
create index vd_submissions_status on fiila.vd_submissions (status, created_at);
revoke all on fiila.vd_submissions from public;


create or replace function fiila.feed_assign() returns trigger
language plpgsql set search_path = '' as $$
declare v_rank int;
begin
  if new.public and new.feed and new.featured_rank is null and not new.demo and not new.platform then
    perform pg_advisory_xact_lock(hashtext('fiila_feed_rank'));
    select r into v_rank from generate_series(1, 25) r
     where not exists (select 1 from fiila.shops x where x.featured_rank = r) order by r limit 1;
    if v_rank is not null then new.featured_rank := v_rank; new.featured_at := now(); end if;
  end if;
  return new;
end $$;

-- La boutique de la plateforme : personne ne la gère avec une clé (empreinte aléatoire jetée) ; seulement par les fonctions admin.
insert into fiila.shops (owner_hash, name, about, slug, public, theme, accent, business_type, platform)
values (extensions.gen_random_bytes(32), 'Vide-dressing Fii La',
  'Vêtements et chaussures d’enfants de seconde main, vérifiés par Fii La. Livrés à la bonne porte.',
  'vide-dressing', true, 'galerie', 'prune', 'enfants', true);

create or replace function public.fiila_feed(p_demo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.read_check();
  return jsonb_build_object('free_left', 25 - (select count(*) from fiila.shops where featured_rank is not null), 'shops', coalesce((
    select jsonb_agg(x.j order by x.d, x.k) from (
      select s.demo d, md5(s.id::text || current_date::text) k, jsonb_strip_nulls(jsonb_build_object(
        'slug', s.slug, 'name', s.name, 'about', s.about, 'accent', s.accent, 'rank', s.featured_rank,
        'demo', case when s.demo then true end, 'platform', case when s.platform then true end, 'type', s.business_type,
        'has_cover', case when s.cover is not null then true end,
        'photo_id', (select p.id from fiila.products p where p.shop_id = s.id and p.active and p.photo is not null order by p.updated_at desc limit 1),
        'count', (select count(*) from fiila.products p where p.shop_id = s.id and p.active),
        'categories', (select jsonb_agg(distinct p.category) from fiila.products p where p.shop_id = s.id and p.active and p.category is not null),
        'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
        'products', (select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'price', q.price)) from (
            select p.id, p.name, p.price from fiila.products p where p.shop_id = s.id and p.active order by p.updated_at desc limit 3) q)
      )) j
      from fiila.shops s
      where s.public and s.feed and s.slug is not null
        and ((s.featured_rank is not null and not s.demo) or s.platform or (coalesce(p_demo, false) and s.demo))
        and exists (select 1 from fiila.products p where p.shop_id = s.id and p.active)
    ) x), '[]'::jsonb));
end $$;

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
      'demo', case when s.demo then true end, 'platform', case when s.platform then true end,
      'theme', s.theme, 'accent', s.accent, 'has_cover', case when s.cover is not null then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null,
        'category', pr.category, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'gender', pr.gender, 'age_band', pr.age_band, 'condition', pr.condition,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 200) pr), '[]'::jsonb));
end $$;

create or replace function public.fiila_admin_shop_types() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  if not exists (select 1 from fiila.profiles where user_id = v_uid and is_admin) then perform fiila.fail('not_allowed'); end if;
  return coalesce((select jsonb_object_agg(coalesce(t, 'non_renseigne'), n) from (
    select business_type t, count(*) n from fiila.shops where not demo and not platform group by business_type) x), '{}'::jsonb);
end $$;

create or replace function fiila.feed_release() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.featured_rank is not null then
    perform pg_advisory_xact_lock(hashtext('fiila_feed_rank'));
    update fiila.shops set featured_rank = old.featured_rank, featured_at = now()
     where id = (select id from fiila.shops where featured_rank is null and public and feed and not demo and not platform order by created_at limit 1);
  end if;
  return null;
end $$;

create or replace function fiila.vd_shop() returns fiila.shops
language sql stable set search_path = '' as $$ select * from fiila.shops where platform and slug = 'vide-dressing' limit 1 $$;

create or replace function fiila.vd_json(v fiila.vd_submissions, p_photo boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', v.id, 'title', v.title, 'gender', v.gender, 'age_band', v.age_band, 'size', v.size,
    'condition', v.condition, 'price', v.price, 'quartier', v.quartier, 'status', v.status, 'reason', v.reason,
    'net', v.price - (v.price * fiila.setting_int('vd_commission') / 100), 'created_at', v.created_at, 'sold_at', v.sold_at, 'paid_at', v.paid_at,
    'photo', case when p_photo then 'data:' || v.photo_type || ';base64,' || replace(encode(v.photo, 'base64'), E'\n', '') end))
$$;

-- Proposer un article (ou le corriger après une demande de correction : p.id). p : {title, gender, age_band, size, condition, price, quartier, photo, phone, photo_ok: true}
create or replace function public.fiila_vd_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); v fiila.vd_submissions; v_ph record; v_data bytea; v_ctype text; v_price int; v_title text; v_phone text; pr fiila.profiles;
begin
  perform fiila.rate_check('vd_submit', 30);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if coalesce((p ->> 'photo_ok')::boolean, false) is not true then perform fiila.fail('vd_photo_rule'); end if;
  if (select count(*) from fiila.vd_submissions where user_id = v_uid and status = 'rejected' and decided_at > now() - interval '30 days') >= 3 then
    perform fiila.fail('vd_blocked'); end if;
  v_title := fiila.clean(p ->> 'title', 80);
  if v_title is null then perform fiila.fail('item_label_required'); end if;
  if coalesce(p ->> 'gender', '') not in ('fille', 'garcon', 'mixte') then perform fiila.fail('vd_gender_required'); end if;
  if coalesce(p ->> 'age_band', '') not in ('0-6m', '6-12m', '1-2a', '2-4a', '4-6a', '6-8a', '8-10a', '10-12a', '12-14a') then perform fiila.fail('vd_age_required'); end if;
  if coalesce(p ->> 'condition', '') not in ('neuf', 'tres_bon', 'bon') then perform fiila.fail('vd_condition_required'); end if;
  begin v_price := (p ->> 'price')::int; exception when others then perform fiila.fail('invalid_price'); end;
  if v_price is null or v_price < 100 or v_price > 1000000 then perform fiila.fail('invalid_price'); end if;
  select * into pr from fiila.profiles where user_id = v_uid;
  v_phone := fiila.clean_phone(coalesce(nullif(p ->> 'phone', ''), pr.phone));
  if nullif(fiila.phone_key(v_phone), '') is null then perform fiila.fail('phone_required'); end if;
  if fiila.as_uuid(p ->> 'id') is not null then
    select * into v from fiila.vd_submissions where id = fiila.as_uuid(p ->> 'id') and user_id = v_uid for update;
    if v.id is null then perform fiila.fail('not_found'); end if;
    if v.status <> 'changes' then perform fiila.fail('invalid_state'); end if;
  else
    if (select count(*) from fiila.vd_submissions where user_id = v_uid and status in ('pending', 'changes')) >= 20 then perform fiila.fail('too_many'); end if;
    if coalesce(p ->> 'photo', '') = '' then perform fiila.fail('vd_photo_required'); end if;
  end if;
  if coalesce(p ->> 'photo', '') <> '' then select * into v_ph from fiila.photo_in(p ->> 'photo'); v_data := v_ph.data; v_ctype := v_ph.ctype; end if;
  if v.id is null then
    insert into fiila.vd_submissions (user_id, seller_name, seller_phone, quartier, title, gender, age_band, size, condition, price, photo, photo_type)
    values (v_uid, coalesce(pr.display_name, 'Vendeuse'), v_phone, fiila.clean(p ->> 'quartier', 60), v_title, p ->> 'gender', p ->> 'age_band',
            fiila.clean(p ->> 'size', 12), p ->> 'condition', v_price, v_data, v_ctype) returning * into v;
  else
    update fiila.vd_submissions set title = v_title, gender = p ->> 'gender', age_band = p ->> 'age_band', size = fiila.clean(p ->> 'size', 12),
      condition = p ->> 'condition', price = v_price, quartier = fiila.clean(p ->> 'quartier', 60), seller_phone = v_phone,
      photo = coalesce(v_data, photo), photo_type = coalesce(v_ctype, photo_type), status = 'pending', reason = null
     where id = v.id returning * into v;
  end if;
  return fiila.vd_json(v, false);
end $$;

create or replace function public.fiila_vd_mine() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  return jsonb_build_object('commission', fiila.setting_int('vd_commission'),
    'items', coalesce((select jsonb_agg(fiila.vd_json(v, true) order by v.created_at desc) from fiila.vd_submissions v
                        where v.user_id = v_uid and v.status <> 'withdrawn'), '[]'::jsonb));
end $$;

create or replace function public.fiila_vd_withdraw(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v fiila.vd_submissions;
begin
  select * into v from fiila.vd_submissions where id = fiila.as_uuid(p_id) and user_id = fiila.need_uid() for update;
  if v.id is null then perform fiila.fail('not_found'); end if;
  if v.status in ('sold', 'withdrawn') then perform fiila.fail('invalid_state'); end if;
  update fiila.vd_submissions set status = 'withdrawn' where id = v.id;
  if v.product_id is not null then update fiila.products set active = false where id = v.product_id; end if;
  return jsonb_build_object('withdrawn', true);
end $$;

-- ---------------------------------------------------------------- fondateur
create or replace function public.fiila_admin_vd() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.vd_shop();
begin
  perform fiila.need_admin();
  return jsonb_build_object('commission', fiila.setting_int('vd_commission'),
    'queue', coalesce((select jsonb_agg(fiila.vd_json(v, true) || jsonb_build_object('seller', v.seller_name, 'phone', v.seller_phone) order by v.created_at)
       from fiila.vd_submissions v where v.status = 'pending'), '[]'::jsonb),
    'live', coalesce((select jsonb_agg(fiila.vd_json(v, false) || jsonb_build_object('seller', v.seller_name, 'phone', v.seller_phone,
         'stock', (select stock from fiila.products where id = v.product_id)) order by v.decided_at desc)
       from fiila.vd_submissions v where v.status = 'approved'), '[]'::jsonb),
    'to_pay', coalesce((select jsonb_agg(fiila.vd_json(v, false) || jsonb_build_object('seller', v.seller_name, 'phone', v.seller_phone) order by v.sold_at)
       from fiila.vd_submissions v where v.status = 'sold' and v.paid_at is null), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('ref', fiila.order_ref(o.number), 'customer', o.customer_name, 'phone', o.customer_phone,
         'total', o.total, 'status', o.status, 'invoice', o.share_token, 'created_at', o.created_at,
         'items', (select jsonb_agg(jsonb_build_object('label', it ->> 'label', 'seller', v.seller_name, 'seller_phone', v.seller_phone, 'quartier', v.quartier, 'submission', v.id))
                     from jsonb_array_elements(o.items) it left join fiila.products pr on pr.id = fiila.as_uuid(it ->> 'product_id')
                     left join fiila.vd_submissions v on v.id = pr.submission_id)) order by o.created_at desc)
       from (select * from fiila.orders where shop_id = s.id order by created_at desc limit 50) o), '[]'::jsonb));
end $$;

-- approve : publié dans la vitrine (stock 1) ; changes : correction demandée (motif) ; reject : refus (motif).
create or replace function public.fiila_admin_vd_decide(p_id text, p_decision text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v fiila.vd_submissions; s fiila.shops := fiila.vd_shop(); pr fiila.products;
begin
  perform fiila.need_admin();
  select * into v from fiila.vd_submissions where id = fiila.as_uuid(p_id) for update;
  if v.id is null then perform fiila.fail('not_found'); end if;
  if p_decision = 'approve' then
    if v.status <> 'pending' then perform fiila.fail('invalid_state'); end if;
    insert into fiila.products (shop_id, name, price, description, category, sizes, stock, photo, photo_type, gender, age_band, condition, submission_id)
    values (s.id, v.title, v.price, null, 'enfants', case when v.size is not null then array[v.size] else '{}' end, 1, v.photo, v.photo_type,
            v.gender, v.age_band, v.condition, v.id) returning * into pr;
    update fiila.vd_submissions set status = 'approved', decided_at = now(), reason = null, product_id = pr.id where id = v.id;
  elsif p_decision in ('changes', 'reject') then
    if v.status <> 'pending' then perform fiila.fail('invalid_state'); end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then perform fiila.fail('reason_required'); end if;
    update fiila.vd_submissions set status = case when p_decision = 'changes' then 'changes' else 'rejected' end, decided_at = now(),
      reason = fiila.clean(p_reason, 200) where id = v.id;
  elsif p_decision = 'sold' then
    if v.status <> 'approved' then perform fiila.fail('invalid_state'); end if;
    update fiila.vd_submissions set status = 'sold', sold_at = now() where id = v.id;
    update fiila.products set active = false where id = v.product_id;
  elsif p_decision = 'paid' then
    if v.status <> 'sold' then perform fiila.fail('invalid_state'); end if;
    update fiila.vd_submissions set paid_at = now() where id = v.id;
  elsif p_decision = 'unpublish' then
    if v.status <> 'approved' then perform fiila.fail('invalid_state'); end if;
    update fiila.vd_submissions set status = 'rejected', reason = coalesce(fiila.clean(p_reason, 200), 'Retiré par Fii La') where id = v.id;
    update fiila.products set active = false where id = v.product_id;
  else perform fiila.fail('invalid_payload');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_feed(boolean)', 'public.fiila_vitrine(text)', 'public.fiila_vd_submit(jsonb)', 'public.fiila_vd_mine()',
    'public.fiila_vd_withdraw(text)', 'public.fiila_admin_vd()', 'public.fiila_admin_vd_decide(text, text, text)', 'public.fiila_admin_shop_types()'];
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
