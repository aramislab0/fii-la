-- Fii La : fil des boutiques (fondateur, 19/10/2026 04:24 : « le feed qui mettra en avant les 25 premières boutiques
-- gratuitement ; tous les utilisateurs tomberont sur le feed une fois leurs tâches terminées, ou à la page principale »).
-- Les 25 premières boutiques qui ouvrent leur vitrine reçoivent une place gratuite et définitive (rang 1 à 25).
-- Une boutique n'apparaît que si sa vitrine est ouverte, qu'elle a au moins un article, et qu'elle n'a pas choisi d'en sortir.
-- Le fil ne montre que ce que la vitrine montre déjà : nom, présentation, articles, prix, note. Jamais de numéro de client.

alter table fiila.shops add column feed boolean not null default true,
  add column featured_rank smallint unique check (featured_rank between 1 and 25),
  add column featured_at timestamptz;

-- Place gratuite attribuée à l'ouverture de la vitrine, dans l'ordre d'arrivée, tant qu'il en reste.
create or replace function fiila.feed_assign() returns trigger
language plpgsql set search_path = '' as $$
declare v_rank int;
begin
  if new.public and new.feed and new.featured_rank is null then
    perform pg_advisory_xact_lock(hashtext('fiila_feed_rank'));
    select r into v_rank from generate_series(1, 25) r
     where not exists (select 1 from fiila.shops x where x.featured_rank = r) order by r limit 1;
    if v_rank is not null then new.featured_rank := v_rank; new.featured_at := now(); end if;
  end if;
  return new;
end $$;
create trigger shops_feed_assign before insert or update of public, feed on fiila.shops
  for each row execute function fiila.feed_assign();

-- Une boutique supprimée libère sa place : elle revient à la plus ancienne boutique ouverte qui attend.
create or replace function fiila.feed_release() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.featured_rank is not null then
    perform pg_advisory_xact_lock(hashtext('fiila_feed_rank'));
    update fiila.shops set featured_rank = old.featured_rank, featured_at = now()
     where id = (select id from fiila.shops where featured_rank is null and public and feed order by created_at limit 1);
  end if;
  return null;
end $$;
create trigger shops_feed_release after delete on fiila.shops
  for each row execute function fiila.feed_release();

-- Boutiques déjà ouvertes : places attribuées dans l'ordre de création.
with o as (select id, row_number() over (order by created_at) n from fiila.shops where public and feed)
update fiila.shops s set featured_rank = o.n, featured_at = now() from o where s.id = o.id and o.n <= 25;

-- Réglage de la boutique : lire (p_on null) ou choisir d'apparaître dans le fil.
create or replace function public.fiila_shop_feed(p_key text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  if p_on is not null then
    perform fiila.rate_check('shop_vitrine', 60);
    update fiila.shops set feed = p_on, updated_at = now() where id = s.id returning * into s;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('feed', s.feed, 'public', s.public, 'rank', s.featured_rank,
    'free_left', 25 - (select count(*) from fiila.shops where featured_rank is not null)));
end $$;

-- Le fil public. Ordre tournant chaque jour (chacune passe en tête à son tour), sans photo (chargées à part, au défilement).
create or replace function public.fiila_feed() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.read_check();
  return jsonb_build_object('free_left', 25 - (select count(*) from fiila.shops where featured_rank is not null), 'shops', coalesce((
    select jsonb_agg(x.j order by x.k) from (
      select md5(s.id::text || current_date::text) k, jsonb_strip_nulls(jsonb_build_object(
        'slug', s.slug, 'name', s.name, 'about', s.about, 'accent', s.accent, 'rank', s.featured_rank,
        'has_cover', case when s.cover is not null then true end,
        'photo_id', (select p.id from fiila.products p where p.shop_id = s.id and p.active and p.photo is not null order by p.updated_at desc limit 1),
        'count', (select count(*) from fiila.products p where p.shop_id = s.id and p.active),
        'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
        'products', (select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'price', q.price)) from (
            select p.id, p.name, p.price from fiila.products p where p.shop_id = s.id and p.active order by p.updated_at desc limit 3) q)
      )) j
      from fiila.shops s
      where s.featured_rank is not null and s.public and s.feed and s.slug is not null
        and exists (select 1 from fiila.products p where p.shop_id = s.id and p.active)
    ) x), '[]'::jsonb));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_shop_feed(text, boolean)', 'public.fiila_feed()'];
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
