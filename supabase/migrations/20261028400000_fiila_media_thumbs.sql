-- Photos, étape 2 (lot 3 de l'audit, demande du fondateur le 28/10 : « sortir les photos de la base ») : miniatures et
-- adresses dans les listes. Constat avant ce lot : les photos publiques sont déjà servies par le seau « media » depuis le 22/10,
-- mais (1) chaque carte de la vitrine et du fil demande son adresse à la base par un appel séparé (fiila_vitrine_photo),
-- (2) la grille affiche la photo pleine taille (120 à 270 Ko sur les boutiques réelles).
-- Ce lot, sans rien supprimer :
--   * miniature de la photo principale de chaque article (640 px au plus, JPEG) fabriquée par fiila-media-sync à partir de
--     la photo déjà copiée dans le seau, déposée sous t/<article>-<empreinte>.jpg ; photos PNG / WebP : pas de miniature
--     (la photo d'origine reste affichée) ;
--   * la vitrine (fiila_vitrine) et le fil (fiila_posts) renvoient directement l'adresse de l'image de la carte (« img » :
--     vitrine = miniature, sinon photo du seau ; fil, image pleine largeur = photo du seau) : plus d'appel à la base par carte ; sans adresse (réglage media_cdn = 0, photo pas
--     encore copiée), l'application revient à l'appel d'avant ;
--   * la liste des articles du commerçant (fiila.product_json) renvoie aussi « thumb ».
-- La photo reste dans la base (retirer cette copie = étape suivante, avec l'accord du fondateur : elle concerne les fiches
-- des boutiques réelles). Back-office (règle n° 8) : Réglages → « Photos (stockage) » affiche les miniatures faites et en attente.

alter table fiila.products add column if not exists thumb_path text;

alter table fiila.media_objects drop constraint if exists media_objects_kind_check;
alter table fiila.media_objects add constraint media_objects_kind_check check (kind in ('product', 'product_extra', 'cover', 'thumb'));

-- Adresse publique d'un fichier du seau (ou rien : pas de copie, adresse de base absente, ou retour arrière media_cdn = 0).
create or replace function fiila.media_url(p_path text) returns text
language sql stable set search_path = '' as $$
  select case when p_path is not null and coalesce(fiila.setting_int('media_cdn'), 1) = 1
              then (select value from fiila.settings where key = 'media_base') || p_path end
$$;

-- Photo modifiée : sa copie ET sa miniature sont refaites.
create or replace function fiila.media_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'products' then
    if new.photo is distinct from old.photo then new.photo_path := null; new.thumb_path := null; end if;
  elsif tg_table_name = 'product_photos' then
    if new.data is distinct from old.data then new.path := null; end if;
  elsif tg_table_name = 'shops' then
    if new.cover is distinct from old.cover then new.cover_path := null; end if;
  end if;
  return new;
end $$;

-- Miniatures à faire (clé de service) : photo JPEG déjà copiée dans le seau, sans miniature, sans échec depuis un jour
-- (une photo illisible n'est pas retentée à chaque minute).
create or replace function public.fiila_media_thumbs_pending(p_limit int default 3) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select p.id::text ref, p.photo_path src, md5(p.photo) hash
      from fiila.products p
     where p.photo is not null and p.photo_path is not null and p.thumb_path is null and p.photo_type = 'image/jpeg'
       and not exists (select 1 from fiila.media_log l where l.action = 'failed' and l.ref = 'thumb:' || p.id::text
                          and l.at > now() - interval '1 day')
     order by p.updated_at desc
     limit least(greatest(coalesce(p_limit, 3), 1), 10)
  ) x
$$;

-- Copie faite : l'adresse n'est enregistrée que si la photo n'a pas changé entre-temps (empreinte identique).
create or replace function public.fiila_media_done(p_kind text, p_ref text, p_hash text, p_path text, p_bytes int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_id uuid; v_pos int;
begin
  if p_path !~ '^(p|c)/[0-9a-f-]{36}(-[1-4])?-[0-9a-f]{32}\.(jpg|png|webp)$'
     and not (p_kind = 'thumb' and p_path ~ '^t/[0-9a-f-]{36}-[0-9a-f]{32}\.jpg$') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if p_kind = 'product' then
    update fiila.products set photo_path = p_path where id = p_ref::uuid and md5(photo) = p_hash and photo_path is null;
  elsif p_kind = 'product_extra' then
    v_id := split_part(p_ref, ':', 1)::uuid; v_pos := split_part(p_ref, ':', 2)::int;
    update fiila.product_photos set path = p_path where product_id = v_id and pos = v_pos and md5(data) = p_hash and path is null;
  elsif p_kind = 'cover' then
    update fiila.shops set cover_path = p_path where id = p_ref::uuid and md5(cover) = p_hash and cover_path is null;
  elsif p_kind = 'thumb' then
    update fiila.products set thumb_path = p_path where id = p_ref::uuid and md5(photo) = p_hash and thumb_path is null;
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  insert into fiila.media_objects (path, kind, ref, bytes) values (p_path, p_kind, p_ref, greatest(coalesce(p_bytes, 0), 0))
    on conflict (path) do nothing;
  if v_n = 1 then insert into fiila.media_log (action, ref) values ('copied', p_kind || ':' || p_ref); end if;
  return jsonb_build_object('ok', true, 'linked', v_n = 1);
end $$;

-- Fichiers du seau qui ne servent plus (miniatures comprises).
create or replace function fiila.media_used(p_path text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from fiila.products p where p.photo_path = p_path or p.thumb_path = p_path)
      or exists (select 1 from fiila.product_photos x where x.path = p_path)
      or exists (select 1 from fiila.shops s where s.cover_path = p_path)
$$;

create or replace function public.fiila_media_orphans(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(m.path), '[]'::jsonb) from (
    select o.path from fiila.media_objects o
     where o.created_at < now() - interval '10 minutes' and not fiila.media_used(o.path)
     order by o.created_at limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
$$;

create or replace function public.fiila_media_forget(p_paths jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_list text[] := array(select jsonb_array_elements_text(coalesce(p_paths, '[]'::jsonb)));
begin
  delete from fiila.media_objects o where o.path = any (v_list) and not fiila.media_used(o.path);
  get diagnostics v_n = row_count;
  if v_n > 0 then insert into fiila.media_log (action, detail) values ('removed', v_n || ' photo(s) retirée(s) du stockage'); end if;
  return jsonb_build_object('ok', true, 'removed', v_n);
end $$;

-- Back-office : état du stockage des photos, miniatures comprises.
create or replace function public.fiila_bo_media() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('settings');
begin
  return jsonb_build_object(
    'on', coalesce(fiila.setting_int('media_cdn'), 1) = 1,
    'ready', (select value from fiila.settings where key = 'media_base') is not null,
    'copied', (select count(*) from fiila.media_objects where kind <> 'thumb'),
    'bytes', (select coalesce(sum(bytes), 0) from fiila.media_objects where kind <> 'thumb'),
    'pending', (select count(*) from fiila.products where photo is not null and photo_path is null)
             + (select count(*) from fiila.product_photos where path is null)
             + (select count(*) from fiila.shops where cover is not null and cover_path is null),
    'thumbs', (select count(*) from fiila.products where thumb_path is not null),
    'thumb_bytes', (select coalesce(sum(bytes), 0) from fiila.media_objects where kind = 'thumb'),
    'thumbs_pending', (select count(*) from fiila.products where photo is not null and thumb_path is null and photo_type = 'image/jpeg'),
    'last_run', (select value from fiila.settings where key = 'media_last_run'),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'ref', l.ref, 'detail', l.detail) order by l.at desc)
       from (select * from fiila.media_log where action = 'failed' and at > now() - interval '7 days' order by at desc limit 10) l), '[]'::jsonb));
end $$;

-- Listes : adresse de l'image de la carte (miniature, sinon photo du seau), ajoutée sans recopier ces fonctions.
create or replace function fiila.card_img(p_id uuid) returns text
language sql stable set search_path = '' as $$
  select fiila.media_url(coalesce(p.thumb_path, p.photo_path)) from fiila.products p where p.id = p_id
$$;
-- Définitions complètes (garde-fou des migrations : plus de remplacement de texte), identiques à la production du 28/10
-- (empreintes vérifiées) à l'ajout près de « img » (vitrine : miniature, sinon photo du seau ; fil, image pleine largeur :
-- photo du seau) et de « thumb » (liste du commerçant).
CREATE OR REPLACE FUNCTION public.fiila_vitrine(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops;
begin
  perform fiila.read_check();
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,40}$' then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where slug = p_slug;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if not s.public then return jsonb_build_object('state', 'closed', 'shop', jsonb_build_object('name', s.name)); end if;
  insert into fiila.shop_views (shop_id, day, n) values (s.id, (now() at time zone 'utc')::date, 1)
    on conflict (shop_id, day) do update set n = fiila.shop_views.n + 1;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'about', s.about, 'phone', s.phone,
      'demo', case when s.demo then true end, 'platform', case when s.platform then true end,
      'theme', fiila.shown_theme(s), 'accent', s.accent, 'policies', nullif(s.policies, '{}'::jsonb),
      'look', greatest(0, least(6, coalesce(fiila.setting_int('site_look'), 3))),
      'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end, 'socials', nullif(s.socials, '{}'::jsonb), 'has_cover', case when s.cover is not null then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null, 'img', fiila.card_img(pr.id),
        'is_new', case when pr.created_at > now() - interval '14 days' then true end, 'photos', fiila.photo_count(pr.id),
        'category', pr.category, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'price_was', pr.price_was, 'sizes_out', case when cardinality(pr.sizes_out) > 0 then to_jsonb(pr.sizes_out) end,
        'gender', pr.gender, 'age_band', pr.age_band, 'condition', pr.condition,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 200) pr), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_posts(p_tab text DEFAULT 'pour-vous'::text, p_device text DEFAULT NULL::text, p_demo boolean DEFAULT false, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_who text := fiila.who(p_device); v_tab text := coalesce(p_tab, 'pour-vous'); v_page int := greatest(0, least(coalesce(p_page, 0), 20));
begin
  perform fiila.read_check();
  if v_tab not in ('pour-vous', 'ventes', 'coeur') then v_tab := 'pour-vous'; end if;
  return jsonb_build_object('tab', v_tab, 'posts', coalesce((
    with base as (
      select p.id, p.name, p.price, p.updated_at, p.shop_id, s.slug, s.name shop_name, s.accent, s.business_type, s.demo, s.platform,
        (select count(*) from fiila.likes l where l.product_id = p.id) likes,
        (select count(*) from fiila.saves v where v.product_id = p.id) saves,
        (select count(*) from fiila.comments c where c.product_id = p.id and not c.hidden) comments,
        fiila.product_sold(p.id) sold,
        fiila.product_love(p.id) love
      from fiila.products p join fiila.shops s on s.id = p.shop_id
      where p.active and p.photo is not null and s.public and s.feed and s.slug is not null
        and ((s.featured_rank is not null and not s.demo) or s.platform or (coalesce(p_demo, false) and s.demo))
    ), ranked as (
      select b.*,
        rank() over (order by b.sold desc) sold_rank, rank() over (order by b.love desc) love_rank,
        row_number() over (partition by b.shop_id order by b.updated_at desc) nth,
        (b.likes + 2 * b.saves + 3 * b.comments + 1) / power(extract(epoch from now() - b.updated_at) / 3600 + 2, 1.2) score
      from base b
    ), ordered as (
      -- Un seul ordre, réutilisé pour la page et pour l'assemblage (ordre garanti).
      select r.*, row_number() over (order by
        case when v_tab = 'ventes' then r.sold when v_tab = 'coeur' then r.love end desc nulls last,
        case when v_tab = 'pour-vous' and v_who is not null then (not exists (select 1 from fiila.follows fw where fw.shop_id = r.shop_id and fw.who = v_who))::int end,
        case when v_tab = 'pour-vous' then (r.nth > 3)::int end,
        case when v_tab = 'pour-vous' then r.score end desc,
        r.updated_at desc, r.id) ord
      from ranked r
      where (v_tab = 'pour-vous') or (v_tab = 'ventes' and r.sold > 0) or (v_tab = 'coeur' and r.love > 0)
    ), picked as (
      select * from ordered where ord > v_page * 30 and ord <= (v_page + 1) * 30
    )
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', k.id, 'name', k.name, 'price', k.price, 'photos', fiila.photo_count(k.id), 'img', (select fiila.media_url(x.photo_path) from fiila.products x where x.id = k.id),
      'shop', jsonb_strip_nulls(jsonb_build_object('slug', k.slug, 'name', k.shop_name,
        'following', case when v_who is not null and exists (select 1 from fiila.follows fw where fw.shop_id = k.shop_id and fw.who = v_who) then true end, 'accent', k.accent, 'type', k.business_type,
        'demo', case when k.demo then true end, 'platform', case when k.platform then true end)),
      'likes', k.likes, 'saves', k.saves, 'comments', k.comments, 'sold', nullif(k.sold, 0),
      'best', case when k.sold > 0 and k.sold_rank <= 10 then true end,
      'heart', case when k.love > 0 and k.love_rank <= 10 then true end,
      'liked', case when v_who is not null and exists (select 1 from fiila.likes l where l.product_id = k.id and l.who = v_who) then true end,
      'saved', case when v_who is not null and exists (select 1 from fiila.saves v where v.product_id = k.id and v.who = v_who) then true end))
      order by k.ord)
    from picked k), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION fiila.product_json(p fiila.products, p_photo boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'name', p.name, 'price', p.price, 'description', p.description, 'active', p.active,
    'category', p.category, 'sizes', case when cardinality(p.sizes) > 0 then to_jsonb(p.sizes) end,
    'colors', case when cardinality(p.colors) > 0 then to_jsonb(p.colors) end, 'stock', p.stock,
    'price_was', p.price_was, 'sizes_out', case when cardinality(p.sizes_out) > 0 then to_jsonb(p.sizes_out) end,
    'photo', case when p_photo and p.photo is not null
                  then fiila.media_src(p.photo_path, p.photo, p.photo_type) end,
    'photos', fiila.photo_count(p.id), 'thumb', case when p_photo then fiila.media_url(p.thumb_path) end,
    'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = p.id),
    'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = p.id),
    'updated_at', p.updated_at))
$function$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text;
begin
  execute 'revoke execute on function public.fiila_media_thumbs_pending(int) from public';
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke execute on function public.fiila_media_thumbs_pending(int) from %I', role_name);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.fiila_media_thumbs_pending(int) to service_role';
  end if;
end $$;
