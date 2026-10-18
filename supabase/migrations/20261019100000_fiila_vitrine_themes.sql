-- Fii La : trois modèles de vitrine et une personnalisation simple (fondateur, 18/10/2026 23:31 : « 3 types de vitrine… comme Shopify »).
-- Modèles : galerie (grille de photos), catalogue (liste compacte), magazine (grandes photos).
-- Personnalisation : couleur d'accent (palette fermée, contrastes vérifiés), photo de couverture, présentation.

alter table fiila.shops add column theme text not null default 'galerie' check (theme in ('galerie', 'catalogue', 'magazine')),
  add column accent text not null default 'foret' check (accent in ('foret', 'nuit', 'indigo', 'prune', 'bordeaux', 'terre')),
  add column cover bytea, add column cover_type text;
alter table fiila.shops add constraint shops_cover_size check (cover is null or length(cover) <= 400000);

create or replace function public.fiila_shop_vitrine(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_ph record;
begin
  if p is not null then
    perform fiila.rate_check('shop_vitrine', 60);
    if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
    if p ? 'theme' and coalesce(p ->> 'theme', '') not in ('galerie', 'catalogue', 'magazine') then perform fiila.fail('invalid_theme'); end if;
    if p ? 'accent' and coalesce(p ->> 'accent', '') not in ('foret', 'nuit', 'indigo', 'prune', 'bordeaux', 'terre') then perform fiila.fail('invalid_theme'); end if;
    if s.slug is null then update fiila.shops set slug = fiila.make_slug(s.name) where id = s.id returning * into s; end if;
    update fiila.shops set
      public = coalesce((p ->> 'public')::boolean, public),
      about = case when p ? 'about' then fiila.clean(p ->> 'about', 160) else about end,
      theme = case when p ? 'theme' then p ->> 'theme' else theme end,
      accent = case when p ? 'accent' then p ->> 'accent' else accent end,
      updated_at = now()
     where id = s.id returning * into s;
    -- Photo de couverture : absente = inchangée, '' = retirée, base64 = remplacée (mêmes contrôles que les photos d'articles).
    if p ? 'cover' then
      if coalesce(p ->> 'cover', '') = '' then
        update fiila.shops set cover = null, cover_type = null where id = s.id returning * into s;
      else
        select * into v_ph from fiila.photo_in(p ->> 'cover');
        update fiila.shops set cover = v_ph.data, cover_type = v_ph.ctype where id = s.id returning * into s;
      end if;
    end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('slug', s.slug, 'public', s.public, 'about', s.about,
    'theme', s.theme, 'accent', s.accent,
    'cover', case when s.cover is not null then 'data:' || s.cover_type || ';base64,' || replace(encode(s.cover, 'base64'), E'\n', '') end,
    'products', (select count(*) from fiila.products where shop_id = s.id and active)));
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
      'theme', s.theme, 'accent', s.accent, 'has_cover', case when s.cover is not null then true end,
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
  fns text[] := array['public.fiila_shop_vitrine(text, jsonb)', 'public.fiila_vitrine(text)', 'public.fiila_vitrine_photo(text, text)'];
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
