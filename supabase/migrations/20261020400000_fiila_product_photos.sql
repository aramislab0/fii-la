-- Fii La : jusqu'à 5 photos par article (fondateur, 19/10/2026 22:48 : « au moins 5, pas obligatoire mais faisable »,
-- avec un carrousel sur les cartes des articles qui en ont plusieurs).
--
-- La photo principale reste dans products.photo (factures, fil, commandes : inchangés). Les 4 autres sont dans
-- product_photos (pos 1 à 4), chargées une à une à l'affichage (fiila_vitrine_photo avec l'identifiant « <article>:<pos> »).

create table fiila.product_photos (
  product_id uuid not null references fiila.products (id) on delete cascade,
  pos        smallint not null check (pos between 1 and 4),
  data       bytea not null,
  ctype      text not null,
  primary key (product_id, pos)
);
revoke all on fiila.product_photos from public;

-- Nombre total de photos (principale comprise) quand il y en a plusieurs ; sinon null (clé absente du JSON).
create or replace function fiila.photo_count(p_id uuid) returns int
language sql stable set search_path = '' as $$
  select nullif(1 + (select count(*)::int from fiila.product_photos x where x.product_id = p.id), 1)
    from fiila.products p where p.id = p_id and p.photo is not null
$$;

create or replace function fiila.product_json(p fiila.products, p_photo boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'name', p.name, 'price', p.price, 'description', p.description, 'active', p.active,
    'category', p.category, 'sizes', case when cardinality(p.sizes) > 0 then to_jsonb(p.sizes) end,
    'colors', case when cardinality(p.colors) > 0 then to_jsonb(p.colors) end, 'stock', p.stock,
    'photo', case when p_photo and p.photo is not null
                  then 'data:' || p.photo_type || ';base64,' || replace(encode(p.photo, 'base64'), E'\n', '') end,
    'photos', fiila.photo_count(p.id),
    'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = p.id),
    'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = p.id),
    'updated_at', p.updated_at))
$$;

create or replace function fiila.product_photos_set(p_product uuid, p_list jsonb) returns void
language plpgsql set search_path = '' as $$
declare v_ph record; i int := 0; v_item jsonb;
begin
  if p_list is null or jsonb_typeof(p_list) <> 'array' then perform fiila.fail('invalid_payload'); end if;
  if jsonb_array_length(p_list) > 4 then perform fiila.fail('too_many_photos'); end if;
  delete from fiila.product_photos where product_id = p_product;
  for v_item in select value from jsonb_array_elements(p_list) loop
    if jsonb_typeof(v_item) <> 'string' or coalesce(v_item #>> '{}', '') = '' then continue; end if;
    select * into v_ph from fiila.photo_in(v_item #>> '{}');
    if length(v_ph.data) > 300000 then perform fiila.fail('photo_too_large'); end if;
    i := i + 1;
    insert into fiila.product_photos (product_id, pos, data, ctype) values (p_product, i, v_ph.data, v_ph.ctype);
  end loop;
end $$;

-- Pas de photo principale mais des supplémentaires : la première devient principale, les autres remontent.
create or replace function fiila.product_photos_promote(p_product uuid) returns void
language plpgsql set search_path = '' as $$
declare v_first fiila.product_photos; v_data bytea[]; v_types text[];
begin
  if not exists (select 1 from fiila.products where id = p_product and photo is null) then return; end if;
  select * into v_first from fiila.product_photos where product_id = p_product order by pos limit 1;
  if v_first.product_id is null then return; end if;
  update fiila.products set photo = v_first.data, photo_type = v_first.ctype where id = p_product;
  select array_agg(data order by pos), array_agg(ctype order by pos) into v_data, v_types
    from fiila.product_photos where product_id = p_product and pos <> v_first.pos;
  delete from fiila.product_photos where product_id = p_product;
  if v_data is not null then
    insert into fiila.product_photos (product_id, pos, data, ctype)
    select p_product, i, v_data[i], v_types[i] from generate_subscripts(v_data, 1) i;
  end if;
end $$;

-- Enregistrement : `photos` (facultatif) = la liste complète des photos supplémentaires, dans l'ordre (4 au plus,
-- 300 Ko chacune). Absent = inchangé ; [] = toutes retirées. Sans photo principale, la première supplémentaire la remplace.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_product_save(text, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, E'  select * into pr from fiila.products where id = pr.id;\n  return fiila.product_json(pr, true);',
E'  if p ? \'photos\' then\n    perform fiila.product_photos_set(pr.id, p -> \'photos\');\n  end if;\n  perform fiila.product_photos_promote(pr.id);\n  select * into pr from fiila.products where id = pr.id;\n  return fiila.product_json(pr, true);');
  if v_new = v_def then raise exception 'product_photos: fiila_product_save non modifiée'; end if;
  execute v_new;
end $$;

-- Photos supplémentaires d'un article, pour l'écran de modification de la boutique (dans l'ordre).
create or replace function public.fiila_product_photos(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_id uuid := fiila.as_uuid(p_id);
begin
  if not exists (select 1 from fiila.products where id = v_id and shop_id = s.id) then perform fiila.fail('product_not_found'); end if;
  return coalesce((select jsonb_agg('data:' || x.ctype || ';base64,' || replace(encode(x.data, 'base64'), E'\n', '') order by x.pos)
    from fiila.product_photos x where x.product_id = v_id), '[]'::jsonb);
end $$;

-- Vitrine et fil : « <article> » = photo principale, « <article>:<n> » (n = 1 à 4) = photo supplémentaire.
create or replace function public.fiila_vitrine_photo(p_slug text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text; v_pid uuid; v_pos int;
begin
  perform fiila.rate_check('vitrine_photo', 6000);
  if p_id = 'cover' then
    select 'data:' || s.cover_type || ';base64,' || replace(encode(s.cover, 'base64'), E'\n', '') into v
      from fiila.shops s where s.slug = p_slug and s.public and s.cover is not null;
    return jsonb_strip_nulls(jsonb_build_object('photo', v));
  end if;
  v_pid := fiila.as_uuid(split_part(coalesce(p_id, ''), ':', 1));
  v_pos := case when split_part(coalesce(p_id, ''), ':', 2) ~ '^[1-4]$' then split_part(p_id, ':', 2)::int end;
  if position(':' in coalesce(p_id, '')) > 0 and v_pos is null then return '{}'::jsonb; end if;
  if v_pos is null then
    select 'data:' || pr.photo_type || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '') into v
      from fiila.products pr join fiila.shops s on s.id = pr.shop_id
     where s.slug = p_slug and s.public and pr.id = v_pid and pr.active and pr.photo is not null;
  else
    select 'data:' || x.ctype || ';base64,' || replace(encode(x.data, 'base64'), E'\n', '') into v
      from fiila.product_photos x join fiila.products pr on pr.id = x.product_id join fiila.shops s on s.id = pr.shop_id
     where s.slug = p_slug and s.public and pr.id = v_pid and pr.active and x.pos = v_pos;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('photo', v));
end $$;

-- Nombre de photos dans la vitrine et le fil (ajouté sans recopier ces fonctions).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_vitrine(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'has_photo', pr.photo is not null,$s$, $s$'has_photo', pr.photo is not null, 'photos', fiila.photo_count(pr.id),$s$);
  if v_new = v_def then raise exception 'product_photos: fiila_vitrine non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_posts(text, text, boolean, integer)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'id', k.id, 'name', k.name, 'price', k.price,$s$, $s$'id', k.id, 'name', k.name, 'price', k.price, 'photos', fiila.photo_count(k.id),$s$);
  if v_new = v_def then raise exception 'product_photos: fiila_posts non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_product_photos(text, text)', 'public.fiila_vitrine_photo(text, text)', 'public.fiila_product_save(text, jsonb)',
    'public.fiila_vitrine(text)', 'public.fiila_posts(text, text, boolean, integer)'];
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
