-- Fii La : boutiques de démonstration (fondateur, 19/10/2026 05:56 : « ajoute d'autres fausses boutiques dans chaque catégorie
-- pour faciliter les tests et différentes opinions »).
-- Garde-fous : une boutique de démonstration ne prend jamais une des 25 places gratuites, n'apparaît dans le fil que sur un
-- téléphone passé en « mode démo », et sa vitrine affiche « Boutique fictive ». Les vrais utilisateurs ne la voient pas.
-- Elles sont créées et effacées par SQL (scripts/demo-seed.sql, scripts/demo-clear.sql), jamais depuis l'application.

alter table fiila.shops add column demo boolean not null default false;

create or replace function fiila.feed_assign() returns trigger
language plpgsql set search_path = '' as $$
declare v_rank int;
begin
  if new.public and new.feed and new.featured_rank is null and not new.demo then
    perform pg_advisory_xact_lock(hashtext('fiila_feed_rank'));
    select r into v_rank from generate_series(1, 25) r
     where not exists (select 1 from fiila.shops x where x.featured_rank = r) order by r limit 1;
    if v_rank is not null then new.featured_rank := v_rank; new.featured_at := now(); end if;
  end if;
  return new;
end $$;

create or replace function fiila.feed_release() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.featured_rank is not null then
    perform pg_advisory_xact_lock(hashtext('fiila_feed_rank'));
    update fiila.shops set featured_rank = old.featured_rank, featured_at = now()
     where id = (select id from fiila.shops where featured_rank is null and public and feed and not demo order by created_at limit 1);
  end if;
  return null;
end $$;

drop function if exists public.fiila_feed();
create or replace function public.fiila_feed(p_demo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.read_check();
  return jsonb_build_object('free_left', 25 - (select count(*) from fiila.shops where featured_rank is not null), 'shops', coalesce((
    select jsonb_agg(x.j order by x.d, x.k) from (
      select s.demo d, md5(s.id::text || current_date::text) k, jsonb_strip_nulls(jsonb_build_object(
        'slug', s.slug, 'name', s.name, 'about', s.about, 'accent', s.accent, 'rank', s.featured_rank,
        'demo', case when s.demo then true end,
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
      'demo', case when s.demo then true end,
      'theme', s.theme, 'accent', s.accent, 'has_cover', case when s.cover is not null then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null,
        'category', pr.category, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 200) pr), '[]'::jsonb));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_feed(boolean)', 'public.fiila_vitrine(text)'];
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
