-- Fii La : type de commerce de chaque boutique (fondateur, 19/10/2026 06:34 : « catégoriser les boutiques, salon de coiffure
-- et n'importe quel type de commerce, pour offrir les outils adaptés et mieux les gérer »).
-- Liste fermée, choisie à la création (modifiable dans les réglages). Sert au fil (filtre), aux statistiques, et plus tard
-- aux outils propres à chaque métier (rendez-vous pour un salon, menu pour un restaurant…).

alter table fiila.shops add column business_type text check (business_type in ('mode', 'chaussures', 'beaute', 'coiffure', 'esthetique', 'restauration', 'patisserie', 'epicerie', 'electronique', 'maison', 'bijoux', 'enfants', 'fleurs', 'couture', 'services', 'autre'));

create or replace function fiila.valid_business_type(p text) returns boolean
language sql immutable set search_path = '' as $$ select p in ('mode', 'chaussures', 'beaute', 'coiffure', 'esthetique', 'restauration', 'patisserie', 'epicerie', 'electronique', 'maison', 'bijoux', 'enfants', 'fleurs', 'couture', 'services', 'autre') $$;

create or replace function fiila.shop_json(s fiila.shops) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone, 'ninea', s.ninea,
    'slug', s.slug, 'public', s.public, 'about', s.about, 'business_type', s.business_type, 'created_at', s.created_at))
$$;

-- Boutiques de démonstration : un type cohérent avec leurs articles.
update fiila.shops s set business_type = case
    when s.name like 'Fleurs%' then 'fleurs' when s.name like 'Bijoux%' then 'bijoux' when s.name like 'Pâtisserie%' then 'patisserie'
    when s.name like 'Saveurs%' then 'restauration' when s.name like 'Thiouraye%' or s.name like 'Karité%' then 'beaute'
    when s.name like 'Petits%' then 'enfants'
    else (select case p.category when 'mode' then 'mode' when 'chaussures' then 'chaussures' when 'maison' then 'maison'
                   when 'electronique' then 'electronique' else 'autre' end
            from fiila.products p where p.shop_id = s.id limit 1) end
 where s.demo and s.business_type is null;

-- Statistiques fondateur : nombre de boutiques par type (chiffres agrégés).
create or replace function public.fiila_admin_shop_types() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  if not exists (select 1 from fiila.profiles where user_id = v_uid and is_admin) then perform fiila.fail('not_allowed'); end if;
  return coalesce((select jsonb_object_agg(coalesce(t, 'non_renseigne'), n) from (
    select business_type t, count(*) n from fiila.shops where not demo group by business_type) x), '{}'::jsonb);
end $$;

create or replace function public.fiila_shop_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); v_name text; v_phone text; v_ninea text; s fiila.shops; v_key text; v_type text;
begin
  perform fiila.rate_check('shop_save', 60);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name  := fiila.clean(p ->> 'name', 60);
  v_phone := fiila.clean_phone(p ->> 'phone');
  v_ninea := fiila.clean(p ->> 'ninea', 30);
  if v_name is null then perform fiila.fail('shop_name_required'); end if;
  v_type := nullif(p ->> 'business_type', '');
  if v_type is not null and not fiila.valid_business_type(v_type) then perform fiila.fail('invalid_business_type'); end if;
  begin
    s := fiila.my_shop(p_key);
  exception when others then
    s := null;
  end;
  if s.id is not null then
    update fiila.shops set name = v_name, phone = v_phone, ninea = v_ninea,
      business_type = case when p ? 'business_type' then v_type else business_type end, updated_at = now() where id = s.id returning * into s;
    return jsonb_build_object('shop', fiila.shop_json(s));
  end if;
  v_key := fiila.token(32);
  insert into fiila.shops (user_id, owner_hash, name, phone, ninea, business_type) values (v_uid, fiila.h(v_key), v_name, v_phone, v_ninea, v_type)
  returning * into s;
  return jsonb_build_object('shop', fiila.shop_json(s), 'key', v_key);
end $$;

create or replace function public.fiila_feed(p_demo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.read_check();
  return jsonb_build_object('free_left', 25 - (select count(*) from fiila.shops where featured_rank is not null), 'shops', coalesce((
    select jsonb_agg(x.j order by x.d, x.k) from (
      select s.demo d, md5(s.id::text || current_date::text) k, jsonb_strip_nulls(jsonb_build_object(
        'slug', s.slug, 'name', s.name, 'about', s.about, 'accent', s.accent, 'rank', s.featured_rank,
        'demo', case when s.demo then true end, 'type', s.business_type,
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
        and ((s.featured_rank is not null and not s.demo) or (coalesce(p_demo, false) and s.demo))
        and exists (select 1 from fiila.products p where p.shop_id = s.id and p.active)
    ) x), '[]'::jsonb));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_shop_save(text, jsonb)', 'public.fiila_feed(boolean)', 'public.fiila_admin_shop_types()'];
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
