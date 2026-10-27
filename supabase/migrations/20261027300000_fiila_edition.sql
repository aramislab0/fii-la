-- Fii Édition, lot 1 (fondateur, 27/10/2026 18:12 : « je valide fii edition tu peux déployer » ; proposition inspirée de
-- Farfetch, HANDOFF #76) :
--   1. un seul cœur « Favoris » : « J'aime » et « Enregistrer » fusionnés (un cœur écrit les deux ; les anciennes réactions
--      sont réunies) ; le cœur marche aussi sur le site de la boutique, pas seulement dans le fil ;
--   2. « Suivre » une boutique, sans compte (même identité que le cœur) ; les boutiques suivies passent en tête de « Pour vous » ;
--   3. modèle de site premium « Édition » (noir et blanc).
-- Back-office : abonnés et favoris de chaque boutique (total et 30 jours).

-- ---------------------------------------------------------------- 1. favoris
insert into fiila.saves (product_id, who, src, created_at) select product_id, who, src, created_at from fiila.likes on conflict do nothing;
insert into fiila.likes (product_id, who, src, created_at) select product_id, who, src, created_at from fiila.saves on conflict do nothing;

-- Article qu'on peut mettre en favori : actif, d'une boutique en ligne (fil ou site).
create or replace function fiila.fav_ok(p_product uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from fiila.products p join fiila.shops s on s.id = p.shop_id
    where p.id = p_product and p.active and s.public and s.slug is not null and s.suspended_at is null)
$$;

create or replace function public.fiila_fav(p_product uuid, p_on boolean, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device); v_src text;
begin
  if v_who is null then perform fiila.fail('device_required'); end if;
  if p_on is null then perform fiila.fail('invalid_payload'); end if;
  if not fiila.fav_ok(p_product) then perform fiila.fail('not_found'); end if;
  perform fiila.rate_check('react', 300);
  v_src := case when v_who like 'd:%' then fiila.ip_bucket() end;
  if p_on then
    insert into fiila.likes (product_id, who, src) values (p_product, v_who, v_src) on conflict do nothing;
    insert into fiila.saves (product_id, who, src) values (p_product, v_who, v_src) on conflict do nothing;
  else
    delete from fiila.likes where product_id = p_product and who = v_who;
    delete from fiila.saves where product_id = p_product and who = v_who;
  end if;
  return fiila.post_stats(p_product) || jsonb_build_object('fav', exists (select 1 from fiila.saves where product_id = p_product and who = v_who),
    'favs', (select count(*) from fiila.saves where product_id = p_product));
end $$;

-- Mes favoris sur un site : identifiants des articles de la boutique déjà en favori (pour dessiner les cœurs).
create or replace function public.fiila_favs_in(p_slug text, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device);
begin
  perform fiila.read_check();
  if v_who is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(v.product_id) from fiila.saves v join fiila.products p on p.id = v.product_id
    join fiila.shops s on s.id = p.shop_id where v.who = v_who and s.slug = lower(p_slug)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 2. suivre une boutique
create table fiila.follows (
  shop_id    uuid not null references fiila.shops (id) on delete cascade,
  who        text not null,                 -- 'u:<compte>' ou 'd:<empreinte de l'appareil>' (fiila.who)
  src        text,
  created_at timestamptz not null default now(),
  primary key (shop_id, who)
);
create index follows_who on fiila.follows (who);
alter table fiila.follows enable row level security;
revoke all on fiila.follows from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on fiila.follows from %I', r); end if;
  end loop;
end $$;

create or replace function fiila.follow_json(p_shop uuid, p_who text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('following', p_who is not null and exists (select 1 from fiila.follows where shop_id = p_shop and who = p_who),
    'followers', (select count(*) from fiila.follows where shop_id = p_shop))
$$;

create or replace function public.fiila_follow(p_slug text, p_on boolean, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device); s fiila.shops;
begin
  if v_who is null then perform fiila.fail('device_required'); end if;
  if p_on is null then perform fiila.fail('invalid_payload'); end if;
  select * into s from fiila.shops where slug = lower(p_slug) and public and suspended_at is null;
  if s.id is null then perform fiila.fail('not_found'); end if;
  perform fiila.rate_check('follow', 120);
  if p_on then insert into fiila.follows (shop_id, who, src) values (s.id, v_who, case when v_who like 'd:%' then fiila.ip_bucket() end) on conflict do nothing;
  else delete from fiila.follows where shop_id = s.id and who = v_who; end if;
  return fiila.follow_json(s.id, v_who);
end $$;

create or replace function public.fiila_follow_state(p_slug text, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops;
begin
  perform fiila.read_check();
  select * into s from fiila.shops where slug = lower(p_slug) and public;
  if s.id is null then return jsonb_build_object('following', false, 'followers', 0); end if;
  return fiila.follow_json(s.id, fiila.who(p_device));
end $$;

-- Boutiques suivies (page « Mes favoris »).
create or replace function public.fiila_follows(p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device);
begin
  perform fiila.read_check();
  if v_who is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('slug', s.slug, 'name', s.name, 'type', s.business_type,
      'logo', case when s.logo is not null then true end,
      'news', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and p.created_at > greatest(f.created_at, now() - interval '14 days'))))
      order by f.created_at desc)
    from fiila.follows f join fiila.shops s on s.id = f.shop_id where f.who = v_who and s.public and s.slug is not null), '[]'::jsonb);
end $$;

-- « Pour vous » : les articles des boutiques suivies d'abord.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_posts(text, text, boolean, integer)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$case when v_tab = 'pour-vous' then (r.nth > 3)::int end,$s$,
    $s$case when v_tab = 'pour-vous' and v_who is not null then (not exists (select 1 from fiila.follows fw where fw.shop_id = r.shop_id and fw.who = v_who))::int end,
        case when v_tab = 'pour-vous' then (r.nth > 3)::int end,$s$);
  if v_new = v_def then raise exception 'edition: fiila_posts non modifiée'; end if;
  -- Bouton « Suivre » dans le fil : l'état de la boutique pour la personne.
  v_def := v_new;
  v_new := replace(v_def, $s$'shop', jsonb_strip_nulls(jsonb_build_object('slug', k.slug, 'name', k.shop_name,$s$,
    $s$'shop', jsonb_strip_nulls(jsonb_build_object('slug', k.slug, 'name', k.shop_name,
        'following', case when v_who is not null and exists (select 1 from fiila.follows fw where fw.shop_id = k.shop_id and fw.who = v_who) then true end,$s$);
  if v_new = v_def then raise exception 'edition: fiila_posts (suivre) non modifiée'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------- 3. modèle premium « Édition »
do $$
declare c text; v_def text; v_new text;
begin
  for c in select conname from pg_constraint where conrelid = 'fiila.shops'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%theme%' loop
    execute format('alter table fiila.shops drop constraint %I', c);
  end loop;
  alter table fiila.shops add constraint shops_theme_check check (theme in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison', 'edition'));
  select pg_get_functiondef('public.fiila_shop_vitrine(text, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'atelier', 'comptoir', 'maison')$s$, $s$'atelier', 'comptoir', 'maison', 'edition')$s$);
  if v_new = v_def then raise exception 'edition: fiila_shop_vitrine non modifiée'; end if;
  execute v_new;
end $$;
create or replace function fiila.premium_theme(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') in ('atelier', 'comptoir', 'maison', 'edition') $$;

-- Étiquette « Nouveau » sur le site : article ajouté depuis moins de 14 jours.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_vitrine(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null,$s$,
    $s$'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null,
        'is_new', case when pr.created_at > now() - interval '14 days' then true end,$s$);
  if v_new = v_def then raise exception 'edition: fiila_vitrine non modifiée'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------- back-office
create or replace function public.fiila_bo_shop_audience(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('shops');
  return jsonb_build_object(
    'followers', (select count(*) from fiila.follows where shop_id = p_shop),
    'followers_30', (select count(*) from fiila.follows where shop_id = p_shop and created_at > now() - interval '30 days'),
    'favs', (select count(*) from fiila.saves v join fiila.products p on p.id = v.product_id where p.shop_id = p_shop),
    'favs_30', (select count(*) from fiila.saves v join fiila.products p on p.id = v.product_id where p.shop_id = p_shop and v.created_at > now() - interval '30 days'),
    'top', coalesce((select jsonb_agg(x) from (select jsonb_build_object('name', p.name, 'favs', count(*)) x
        from fiila.saves v join fiila.products p on p.id = v.product_id where p.shop_id = p_shop group by p.id, p.name order by count(*) desc limit 3) t), '[]'::jsonb));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  pub text[] := array['public.fiila_fav(uuid, boolean, text)', 'public.fiila_favs_in(text, text)', 'public.fiila_follow(text, boolean, text)',
    'public.fiila_follow_state(text, text)', 'public.fiila_follows(text)', 'public.fiila_posts(text, text, boolean, integer)', 'public.fiila_shop_vitrine(text, jsonb)', 'public.fiila_vitrine(text)'];
begin
  foreach fn in array pub || array['public.fiila_bo_shop_audience(uuid)'] loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array pub loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.fiila_bo_shop_audience(uuid) to authenticated'; end if;
end $$;
