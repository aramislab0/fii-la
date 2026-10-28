-- Photos, étape 3 (accord du fondateur le 28/10 : « supprimer de la base la copie de secours des photos ») : la copie des
-- photos publiques (photo principale et photos supplémentaires des articles, couverture des sites) est retirée de la base
-- une fois le fichier du seau « media » vérifié. Rien n'est retiré à l'aveugle :
--   * fiila-media-sync télécharge le fichier publié, calcule son empreinte SHA-256 et ne demande le retrait
--     (fiila_media_purged) que si elle est identique à celle de la photo de la base ; la base revérifie l'empreinte et
--     l'adresse avant de vider la colonne ;
--   * photo principale JPEG : seulement après sa miniature ;
--   * réglage media_purge = 0 : plus aucun retrait (les retraits déjà faits restent faits) ;
--   * une photo retirée reste affichée par son adresse du seau, même avec media_cdn = 0 (ce réglage ne ramène plus que les
--     photos encore présentes dans la base).
-- « A une photo » = octets dans la base OU adresse dans le seau (fonctions réécrites ci-dessous, en entier).
-- Le retrait d'une photo par le commerçant efface aussi son adresse (sinon une photo déjà retirée de la base resterait visible).
-- Photos de porte, repères vocaux, logos, pièces d'identité et photos du vide-dressing : inchangés, jamais dans le seau.
-- Back-office (règle n° 8) : Réglages → « Photos (stockage) » affiche les copies retirées et le poids restant dans la base.

insert into fiila.settings (key, value) values ('media_purge', '1') on conflict (key) do nothing;

-- Photo supplémentaire retirée de la base : seule son adresse reste.
alter table fiila.product_photos alter column data drop not null;

alter table fiila.media_log drop constraint if exists media_log_action_check;
alter table fiila.media_log add constraint media_log_action_check check (action in ('copied', 'removed', 'failed', 'run', 'purged'));

-- Adresse publique d'une photo copiée ; la photo de la base seulement si elle y est encore (retour arrière media_cdn = 0).
create or replace function fiila.media_src(p_path text, p_data bytea, p_type text) returns text
language sql stable set search_path = '' as $$
  select case
    when p_path is not null and (coalesce(fiila.setting_int('media_cdn'), 1) = 1 or p_data is null)
         and (select value from fiila.settings where key = 'media_base') is not null
      then (select value from fiila.settings where key = 'media_base') || p_path
    when p_data is not null then 'data:' || p_type || ';base64,' || replace(encode(p_data, 'base64'), E'\n', '')
  end
$$;

-- Nouvelle photo envoyée : sa copie et sa miniature sont refaites. Le retrait de la copie de la base (octets → null) et
-- une adresse posée en même temps (promotion d'une photo supplémentaire) ne réinitialisent rien.
create or replace function fiila.media_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'products' then
    if new.photo is not null and new.photo is distinct from old.photo and new.photo_path is not distinct from old.photo_path then
      new.photo_path := null; new.thumb_path := null;
    end if;
  elsif tg_table_name = 'product_photos' then
    if new.data is not null and new.data is distinct from old.data and new.path is not distinct from old.path then new.path := null; end if;
  elsif tg_table_name = 'shops' then
    if new.cover is not null and new.cover is distinct from old.cover and new.cover_path is not distinct from old.cover_path then new.cover_path := null; end if;
  end if;
  return new;
end $$;

-- Miniatures : la source est le fichier du seau (la photo de la base peut déjà être retirée) ; empreinte = celle de son adresse.
create or replace function public.fiila_media_thumbs_pending(p_limit int default 3) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select p.id::text ref, p.photo_path src, md5(p.photo_path) hash
      from fiila.products p
     where p.photo_path is not null and p.thumb_path is null and p.photo_type = 'image/jpeg'
       and not exists (select 1 from fiila.media_log l where l.action = 'failed' and l.ref = 'thumb:' || p.id::text
                          and l.at > now() - interval '1 day')
     order by p.updated_at desc
     limit least(greatest(coalesce(p_limit, 3), 1), 10)
  ) x
$$;

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
    update fiila.products set thumb_path = p_path where id = p_ref::uuid and md5(photo_path) = p_hash and thumb_path is null;
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  insert into fiila.media_objects (path, kind, ref, bytes) values (p_path, p_kind, p_ref, greatest(coalesce(p_bytes, 0), 0))
    on conflict (path) do nothing;
  if v_n = 1 then insert into fiila.media_log (action, ref) values ('copied', p_kind || ':' || p_ref); end if;
  return jsonb_build_object('ok', true, 'linked', v_n = 1);
end $$;

-- Copies de la base à retirer (clé de service) : photo copiée dans le seau (et miniature faite pour une photo principale
-- JPEG), sans échec de vérification depuis un jour. sha = empreinte SHA-256 de la photo de la base, comparée par
-- fiila-media-sync à celle du fichier téléchargé.
create or replace function public.fiila_media_purge_pending(p_limit int default 8) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select * from (
      select 'product' kind, p.id::text ref, p.photo_path path, encode(extensions.digest(p.photo, 'sha256'), 'hex') sha
        from fiila.products p
       where p.photo is not null and p.photo_path is not null and (p.photo_type <> 'image/jpeg' or p.thumb_path is not null)
      union all
      select 'product_extra', x.product_id::text || ':' || x.pos, x.path, encode(extensions.digest(x.data, 'sha256'), 'hex')
        from fiila.product_photos x where x.data is not null and x.path is not null
      union all
      select 'cover', s.id::text, s.cover_path, encode(extensions.digest(s.cover, 'sha256'), 'hex')
        from fiila.shops s where s.cover is not null and s.cover_path is not null
    ) c
     where coalesce(fiila.setting_int('media_purge'), 1) = 1
       and not exists (select 1 from fiila.media_log l where l.action = 'failed' and l.ref = 'purge:' || c.kind || ':' || c.ref
                          and l.at > now() - interval '1 day')
     limit least(greatest(coalesce(p_limit, 8), 1), 20)
  ) x
$$;

-- Retrait d'une copie (clé de service) : seulement si l'adresse et l'empreinte sont toujours celles vérifiées.
create or replace function public.fiila_media_purged(p_kind text, p_ref text, p_path text, p_sha text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_id uuid; v_pos int;
begin
  if coalesce(fiila.setting_int('media_purge'), 1) <> 1 then return jsonb_build_object('ok', true, 'purged', false); end if;
  if coalesce(p_sha, '') !~ '^[0-9a-f]{64}$' or p_path is null then raise exception 'invalid' using errcode = '22023'; end if;
  if p_kind = 'product' then
    update fiila.products set photo = null where id = p_ref::uuid and photo_path = p_path
       and encode(extensions.digest(photo, 'sha256'), 'hex') = p_sha and (photo_type <> 'image/jpeg' or thumb_path is not null);
  elsif p_kind = 'product_extra' then
    v_id := split_part(p_ref, ':', 1)::uuid; v_pos := split_part(p_ref, ':', 2)::int;
    update fiila.product_photos set data = null where product_id = v_id and pos = v_pos and path = p_path
       and encode(extensions.digest(data, 'sha256'), 'hex') = p_sha;
  elsif p_kind = 'cover' then
    update fiila.shops set cover = null where id = p_ref::uuid and cover_path = p_path
       and encode(extensions.digest(cover, 'sha256'), 'hex') = p_sha;
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 1 then insert into fiila.media_log (action, ref) values ('purged', p_kind || ':' || p_ref); end if;
  return jsonb_build_object('ok', true, 'purged', v_n = 1);
end $$;

-- Back-office : état du stockage, copies retirées de la base comprises.
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
             + (select count(*) from fiila.product_photos where data is not null and path is null)
             + (select count(*) from fiila.shops where cover is not null and cover_path is null),
    'thumbs', (select count(*) from fiila.products where thumb_path is not null),
    'thumb_bytes', (select coalesce(sum(bytes), 0) from fiila.media_objects where kind = 'thumb'),
    'thumbs_pending', (select count(*) from fiila.products where photo_path is not null and thumb_path is null and photo_type = 'image/jpeg'),
    'purge_on', coalesce(fiila.setting_int('media_purge'), 1) = 1,
    'purged', (select count(*) from fiila.products where photo is null and photo_path is not null)
            + (select count(*) from fiila.product_photos where data is null and path is not null)
            + (select count(*) from fiila.shops where cover is null and cover_path is not null),
    'db_bytes', (select coalesce(sum(length(photo)), 0) from fiila.products)
              + (select coalesce(sum(length(data)), 0) from fiila.product_photos)
              + (select coalesce(sum(length(cover)), 0) from fiila.shops),
    'last_run', (select value from fiila.settings where key = 'media_last_run'),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'ref', l.ref, 'detail', l.detail) order by l.at desc)
       from (select * from fiila.media_log where action = 'failed' and at > now() - interval '7 days' order by at desc limit 10) l), '[]'::jsonb));
end $$;

-- Définitions complètes (garde-fou des migrations), identiques à l'état précédent à « a une photo » près
-- (octets OU adresse), plus : Studio (adresse du seau si la photo n'est plus dans la base), promotion d'une photo
-- supplémentaire (son adresse suit), retrait d'une photo ou d'une couverture (son adresse est effacée).
CREATE OR REPLACE FUNCTION fiila.items_with_photos(p_items jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(case
      when (pr.photo is not null or pr.photo_path is not null) then it || jsonb_build_object('photo',
        fiila.media_src(pr.photo_path, pr.photo, pr.photo_type))
      else it end order by ord), '[]'::jsonb)
  from jsonb_array_elements(p_items) with ordinality as x(it, ord)
  left join fiila.products pr on pr.id = fiila.as_uuid(it ->> 'product_id')
$function$;

CREATE OR REPLACE FUNCTION fiila.photo_count(p_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select nullif(1 + (select count(*)::int from fiila.product_photos x where x.product_id = p.id), 1)
    from fiila.products p where p.id = p_id and (p.photo is not null or p.photo_path is not null)
$function$;

CREATE OR REPLACE FUNCTION fiila.post_ok(p_product uuid, p_demo boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (select 1 from fiila.products p join fiila.shops s on s.id = p.shop_id
    where p.id = p_product and p.active and (p.photo is not null or p.photo_path is not null)
      and s.public and s.feed and s.slug is not null
      and ((s.featured_rank is not null and not s.demo) or s.platform or (coalesce(p_demo, false) and s.demo)))
$function$;

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
    'photo', case when p_photo and (p.photo is not null or p.photo_path is not null)
                  then fiila.media_src(p.photo_path, p.photo, p.photo_type) end,
    'photos', fiila.photo_count(p.id), 'thumb', case when p_photo then fiila.media_url(p.thumb_path) end,
    'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = p.id),
    'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = p.id),
    'updated_at', p.updated_at))
$function$;

CREATE OR REPLACE FUNCTION public.fiila_bo_feed()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := fiila.need_staff('feed');
begin
  return jsonb_build_object(
    'places', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('rank', s.featured_rank, 'id', s.id, 'name', s.name, 'slug', s.slug,
        'public', s.public, 'feed', s.feed, 'suspended', case when s.suspended_at is not null then true end,
        'products', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and (p.photo is not null or p.photo_path is not null)))) order by s.featured_rank)
      from fiila.shops s where s.featured_rank is not null), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'since', s.created_at) order by s.created_at)
      from fiila.shops s where s.featured_rank is null and s.public and s.feed and not s.demo and not s.platform), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_feed(p_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform fiila.read_check();
  return jsonb_build_object('free_left', 25 - (select count(*) from fiila.shops where featured_rank is not null), 'shops', coalesce((
    select jsonb_agg(x.j order by x.d, x.k) from (
      select s.demo d, md5(s.id::text || current_date::text) k, jsonb_strip_nulls(jsonb_build_object(
        'slug', s.slug, 'name', s.name, 'about', s.about, 'accent', s.accent, 'rank', s.featured_rank,
        'demo', case when s.demo then true end, 'platform', case when s.platform then true end, 'type', s.business_type,
        'has_cover', case when (s.cover is not null or s.cover_path is not null) then true end,
        'photo_id', (select p.id from fiila.products p where p.shop_id = s.id and p.active and (p.photo is not null or p.photo_path is not null) order by p.updated_at desc limit 1),
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
      where p.active and (p.photo is not null or p.photo_path is not null) and s.public and s.feed and s.slug is not null
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

CREATE OR REPLACE FUNCTION public.fiila_saved(p_device text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_who text := fiila.who(p_device);
begin
  perform fiila.read_check();
  if v_who is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price,
      'shop', jsonb_build_object('slug', s.slug, 'name', s.name))) order by v.created_at desc)
    from (select * from fiila.saves where who = v_who order by created_at desc limit 200) v
    join fiila.products p on p.id = v.product_id join fiila.shops s on s.id = p.shop_id
    where p.active and (p.photo is not null or p.photo_path is not null) and s.public and s.slug is not null), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_studio_state_shop(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  return jsonb_build_object('ready', fiila.studio_ready() and not fiila.studio_service(s.business_type), 'credits', fiila.studio_credits(s.id),
    'premium', fiila.studio_premium_ok(s.business_type),
    'photos', (select count(*) from fiila.products p where p.shop_id = s.id and (p.photo is not null or p.photo_path is not null)),
    'kept', (select count(*) from fiila.studio_jobs j where j.shop_id = s.id and j.status = 'kept'));
end $function$;

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
      'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end, 'socials', nullif(s.socials, '{}'::jsonb), 'has_cover', case when (s.cover is not null or s.cover_path is not null) then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', (pr.photo is not null or pr.photo_path is not null), 'img', fiila.card_img(pr.id),
        'is_new', case when pr.created_at > now() - interval '14 days' then true end, 'photos', fiila.photo_count(pr.id),
        'category', pr.category, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'price_was', pr.price_was, 'sizes_out', case when cardinality(pr.sizes_out) > 0 then to_jsonb(pr.sizes_out) end,
        'gender', pr.gender, 'age_band', pr.age_band, 'condition', pr.condition,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 200) pr), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_vitrine_photo(p_slug text, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text; v_pid uuid; v_pos int;
begin
  perform fiila.rate_check('vitrine_photo', 6000);
  if p_id = 'cover' then
    select fiila.media_src(s.cover_path, s.cover, s.cover_type) into v
      from fiila.shops s where s.slug = p_slug and s.public and (s.cover is not null or s.cover_path is not null);
    return jsonb_strip_nulls(jsonb_build_object('photo', v));
  end if;
  v_pid := fiila.as_uuid(split_part(coalesce(p_id, ''), ':', 1));
  v_pos := case when split_part(coalesce(p_id, ''), ':', 2) ~ '^[1-4]$' then split_part(p_id, ':', 2)::int end;
  if position(':' in coalesce(p_id, '')) > 0 and v_pos is null then return '{}'::jsonb; end if;
  if v_pos is null then
    select fiila.media_src(pr.photo_path, pr.photo, pr.photo_type) into v
      from fiila.products pr join fiila.shops s on s.id = pr.shop_id
     where s.slug = p_slug and s.public and pr.id = v_pid and pr.active and (pr.photo is not null or pr.photo_path is not null);
  else
    select fiila.media_src(x.path, x.data, x.ctype) into v
      from fiila.product_photos x join fiila.products pr on pr.id = x.product_id join fiila.shops s on s.id = pr.shop_id
     where s.slug = p_slug and s.public and pr.id = v_pid and pr.active and x.pos = v_pos;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('photo', v));
end $function$;

CREATE OR REPLACE FUNCTION fiila.amb_eval(p_link fiila.ambassador_shops)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a fiila.ambassadors; s fiila.shops; v_photos int; v_l1 boolean; v_orders int; v_clients int; v_deliv int; v_l2 boolean;
        v_weeks int; v_l3 boolean; v_age interval := now() - p_link.linked_at; v_lvl int := 0; lv int; v_amount int;
begin
  select * into a from fiila.ambassadors where id = p_link.ambassador_id;
  select * into s from fiila.shops where id = p_link.shop_id;
  if s.id is null then return null; end if;
  select count(*) into v_photos from fiila.products where shop_id = s.id and active and (photo is not null or photo_path is not null);
  v_l1 := s.business_type is not null and v_photos >= 5 and s.public;
  select count(*), count(distinct customer), count(*) filter (where delivered) into v_orders, v_clients, v_deliv
    from fiila.amb_orders(p_link, a) where created_at <= p_link.linked_at + interval '30 days';
  v_l2 := v_clients >= 3 and v_deliv >= 1 and v_orders >= 3;
  -- Niveau 3 : 60 jours après le lien, au moins une commande par semaine sur 4 des 8 dernières semaines.
  select coalesce(max(x.w), 0) into v_weeks from (
    select (select count(distinct date_trunc('week', o.created_at)) from fiila.amb_orders(p_link, a) o
             where o.created_at > d - interval '56 days' and o.created_at <= d) w
      from generate_series(p_link.linked_at + interval '60 days', least(now(), p_link.linked_at + interval '120 days'), interval '1 day') d) x;
  v_l3 := v_age >= interval '60 days' and v_weeks >= 4;
  -- Délais : niveau 1 en 7 jours, niveau 2 en 30 jours, niveau 3 entre 60 et 120 jours. Un niveau suppose le précédent.
  -- Un niveau déjà attribué reste acquis (même si l'activité baisse ensuite) ; un niveau annulé (fraude) bloque la suite.
  if exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled') then
    v_lvl := coalesce((select min(level) - 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled'), 0);
  else
    if (v_l1 and v_age <= interval '7 days') or (p_link.l1_at is not null and p_link.l1_at <= p_link.linked_at + interval '7 days') or exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and level = 1) then v_lvl := 1; end if;
    if v_lvl = 1 and (v_l2 or exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and level = 2)) then v_lvl := 2; end if;
    if v_lvl = 2 and (v_l3 or exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and level = 3)) then v_lvl := 3; end if;
  end if;
  if a.status = 'active' and not exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled')
     and not exists (select 1 from fiila.partner_trials pt where pt.shop_id = s.id) then
    for lv in 1..v_lvl loop
      v_amount := fiila.setting_int('amb_reward_' || lv);
      insert into fiila.ambassador_rewards (ambassador_id, shop_id, shop_name, level, amount)
      values (a.id, s.id, s.name, lv, v_amount) on conflict (shop_id, level) do nothing;
    end loop;
  end if;
  return jsonb_build_object('shop', s.name, 'type', s.business_type, 'linked_at', p_link.linked_at, 'level', v_lvl,
    'photos', v_photos, 'public', s.public, 'typed', s.business_type is not null,
    'orders', v_orders, 'clients', v_clients, 'delivered', v_deliv, 'active_weeks', v_weeks,
    'deadline', case v_lvl when 0 then p_link.linked_at + interval '7 days' when 1 then p_link.linked_at + interval '30 days'
                               when 2 then p_link.linked_at + interval '60 days' end,
    'expired', (v_lvl = 0 and v_age > interval '7 days') or (v_lvl = 1 and v_age > interval '30 days'));
end $function$;

CREATE OR REPLACE FUNCTION fiila.amb_stamp(p_shop uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l fiila.ambassador_shops; s fiila.shops; v_photos int;
begin
  select * into l from fiila.ambassador_shops where shop_id = p_shop;
  if l.id is null or l.l1_at is not null or now() > l.linked_at + interval '7 days' then return; end if;
  select * into s from fiila.shops where id = p_shop;
  select count(*) into v_photos from fiila.products where shop_id = p_shop and active and (photo is not null or photo_path is not null);
  if s.business_type is not null and s.public and v_photos >= 5 then
    update fiila.ambassador_shops set l1_at = now() where id = l.id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_studio_reserve(p_key text, p_product text, p_style text, p_mode text DEFAULT 'fidele'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); pr fiila.products; j fiila.studio_jobs; sc fiila.studio_scenes;
  v_mode text := coalesce(p_mode, 'fidele'); v_prompt text;
begin
  perform fiila.rate_check('studio_reserve', 30);
  if not fiila.studio_ready() or fiila.studio_service(s.business_type) then perform fiila.fail('studio_off'); end if;
  if v_mode not in ('fidele', 'premium') then perform fiila.fail('invalid_payload'); end if;
  if v_mode = 'premium' and not fiila.studio_premium_ok(s.business_type) then perform fiila.fail('studio_premium_off'); end if;
  select * into pr from fiila.products where id = v_pid and shop_id = s.id;
  if pr.id is null then perform fiila.fail('product_not_found'); end if;
  if pr.photo is null and pr.photo_path is null then perform fiila.fail('studio_no_photo'); end if;
  if p_style is null or not exists (select 1 from jsonb_array_elements(fiila.studio_scenes_for(s.id)) e where e ->> 'id' = p_style) then
    perform fiila.fail('invalid_payload');
  end if;
  select * into sc from fiila.studio_scenes where id = p_style;
  if (fiila.studio_credits(s.id) ->> 'total')::int < fiila.studio_cost(v_mode) then perform fiila.fail('studio_no_credits'); end if;
  if fiila.studio_spent() >= coalesce(fiila.setting_int('studio_budget_usd'), 0) then perform fiila.fail('studio_budget'); end if;
  if (select count(*) from fiila.studio_jobs where shop_id = s.id and created_at > now() - interval '1 day') >= coalesce(fiila.setting_int('studio_daily'), 10) then
    perform fiila.fail('studio_daily_limit');
  end if;
  update fiila.studio_jobs set status = 'failed', error = 'Délai dépassé', done_at = now() where shop_id = s.id and status = 'running' and created_at < now() - interval '3 minutes';
  if exists (select 1 from fiila.studio_jobs where shop_id = s.id and status = 'running') then perform fiila.fail('studio_busy'); end if;
  v_prompt := fiila.studio_text('studio_tpl_camera')
    || case when v_mode = 'premium' then case when coalesce(s.business_type, '') in ('mode', 'couture') then fiila.studio_text('studio_tpl_wear') else fiila.studio_text('studio_tpl_keep') end else '' end
    || sc.prompt;
  insert into fiila.studio_jobs (shop_id, product_id, style, mode, scene_version, created_by) values (s.id, pr.id, sc.id, v_mode, sc.version, fiila.uid()) returning * into j;
  return jsonb_build_object('job', j.id, 'style', j.style, 'mode', j.mode, 'prompt', v_prompt, 'name', pr.name,
    'image', case when pr.photo is not null then 'data:' || coalesce(pr.photo_type, 'image/jpeg') || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '')
                   else (select value from fiila.settings where key = 'media_base') || pr.photo_path end);
end $function$;

CREATE OR REPLACE FUNCTION fiila.product_photos_promote(p_product uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_first fiila.product_photos; v_data bytea[]; v_types text[]; v_paths text[];
begin
  if not exists (select 1 from fiila.products where id = p_product and photo is null and photo_path is null) then return; end if;
  select * into v_first from fiila.product_photos where product_id = p_product order by pos limit 1;
  if v_first.product_id is null then return; end if;
  update fiila.products set photo = v_first.data, photo_type = v_first.ctype, photo_path = v_first.path, thumb_path = null where id = p_product;
  select array_agg(data order by pos), array_agg(ctype order by pos), array_agg(path order by pos) into v_data, v_types, v_paths
    from fiila.product_photos where product_id = p_product and pos <> v_first.pos;
  delete from fiila.product_photos where product_id = p_product;
  if v_types is not null then
    insert into fiila.product_photos (product_id, pos, data, ctype, path)
    select p_product, i, v_data[i], v_types[i], v_paths[i] from generate_subscripts(v_types, 1) i;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_product_save(p_key text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); pr fiila.products; v_id uuid; v_name text; v_price bigint; v_ph record;
  v_cat text; v_sizes text[]; v_colors text[]; v_stock int; v_was bigint; v_out text[];
begin
  perform fiila.rate_check('product_save', 600);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name := fiila.clean(p ->> 'name', 80);
  if v_name is null then perform fiila.fail('item_label_required'); end if;
  begin v_price := (p ->> 'price')::bigint; exception when others then perform fiila.fail('invalid_price'); end;
  if v_price is null or v_price < 0 or v_price > 100000000 then perform fiila.fail('invalid_price'); end if;
  v_cat := nullif(p ->> 'category', '');
  if v_cat is not null and v_cat not in ('mode', 'chaussures', 'beaute', 'alimentation', 'maison', 'electronique', 'accessoires', 'enfants', 'autre') then
    perform fiila.fail('invalid_category'); end if;
  v_sizes := fiila.tag_list(p -> 'sizes', 20, 8);
  v_colors := fiila.tag_list(p -> 'colors', 12, 20);
  if p ? 'stock' and jsonb_typeof(p -> 'stock') <> 'null' then
    begin v_stock := (p ->> 'stock')::int; exception when others then perform fiila.fail('invalid_stock'); end;
    if v_stock < 0 or v_stock > 100000 then perform fiila.fail('invalid_stock'); end if;
  end if;
  if p ? 'price_was' and jsonb_typeof(p -> 'price_was') <> 'null' then
    begin v_was := (p ->> 'price_was')::bigint; exception when others then perform fiila.fail('invalid_price_was'); end;
    if v_was = 0 then v_was := null;
    elsif v_was is null or v_was <= v_price or v_was > 100000000 then perform fiila.fail('invalid_price_was'); end if;
  end if;
  v_out := fiila.tag_list(p -> 'sizes_out', 20, 8);
  v_id := fiila.as_uuid(p ->> 'id');
  if v_id is not null then
    select * into pr from fiila.products where id = v_id and shop_id = s.id for update;
    if not found then perform fiila.fail('product_not_found'); end if;
    update fiila.products set name = v_name, price = v_price, description = fiila.clean(p ->> 'description', 300),
      price_was = case when p ? 'price_was' then v_was when price_was > v_price then price_was end,
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now() where id = pr.id returning * into pr;
    if p ? 'category' or p ? 'sizes' or p ? 'colors' or p ? 'stock' then
      update fiila.products set
        category = case when p ? 'category' then v_cat else category end,
        sizes = case when p ? 'sizes' then v_sizes else sizes end,
        colors = case when p ? 'colors' then v_colors else colors end,
        stock = case when p ? 'stock' then v_stock else stock end
       where id = pr.id returning * into pr;
    end if;
  else
    if (select count(*) from fiila.products where shop_id = s.id) >= 500 then perform fiila.fail('too_many'); end if;
    insert into fiila.products (shop_id, name, price, description, category, sizes, colors, stock)
    values (s.id, v_name, v_price, fiila.clean(p ->> 'description', 300), v_cat, coalesce(v_sizes, '{}'), coalesce(v_colors, '{}'), v_stock) returning * into pr;
  end if;
  if v_id is null and v_was is not null then update fiila.products set price_was = v_was where id = pr.id returning * into pr; end if;
  -- Tailles épuisées : seulement parmi les tailles de l'article (une taille retirée cesse d'être épuisée).
  if p ? 'sizes_out' or p ? 'sizes' then
    update fiila.products set sizes_out = coalesce(array(select x from unnest(case when p ? 'sizes_out' then coalesce(v_out, '{}') else sizes_out end) x
      where x = any (sizes)), '{}') where id = pr.id returning * into pr;
  end if;
  if p ? 'photo' then
    if coalesce(p ->> 'photo', '') = '' then
      update fiila.products set photo = null, photo_type = null, photo_path = null, thumb_path = null where id = pr.id;
    else
      select * into v_ph from fiila.photo_in(p ->> 'photo'); perform fiila.need_ratio(v_ph.data);
      if length(v_ph.data) > 300000 then perform fiila.fail('photo_too_large'); end if;
      update fiila.products set photo = v_ph.data, photo_type = v_ph.ctype where id = pr.id;
    end if;
  end if;
  if p ? 'photos' then
    perform fiila.product_photos_set(pr.id, p -> 'photos');
  end if;
  perform fiila.product_photos_promote(pr.id);
  select * into pr from fiila.products where id = pr.id;
  return fiila.product_json(pr, true);
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_shop_vitrine(p_key text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_ph record;
begin
  if p is not null then
    perform fiila.need_shop_role('admin');
    perform fiila.rate_check('shop_vitrine', 60);
    if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
    if p ? 'theme' and coalesce(p ->> 'theme', '') not in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison', 'edition') then perform fiila.fail('invalid_theme'); end if;
    if fiila.premium_theme(p ->> 'theme') and s.plan <> 'premium' then perform fiila.fail('premium_required'); end if;
    if p ? 'accent' and coalesce(p ->> 'accent', '') not in ('foret', 'nuit', 'indigo', 'prune', 'bordeaux', 'terre') then perform fiila.fail('invalid_theme'); end if;
    if s.slug is null then update fiila.shops set slug = fiila.make_slug(s.name) where id = s.id returning * into s; end if;
    update fiila.shops set
      public = coalesce((p ->> 'public')::boolean, public),
      about = case when p ? 'about' then fiila.clean(p ->> 'about', 160) else about end,
      theme = case when p ? 'theme' then p ->> 'theme' else theme end,
      accent = case when p ? 'accent' then p ->> 'accent' else accent end,
      socials = case when p ? 'socials' then fiila.socials_in(p -> 'socials') else socials end,
      policies = case when p ? 'policies' then fiila.policies_in(p -> 'policies') else policies end,
      updated_at = now()
     where id = s.id returning * into s;
    -- Logo : absent = inchangé, '' = retiré, base64 = remplacé (petit format : 80 Ko au plus).
    if p ? 'logo' then
      if coalesce(p ->> 'logo', '') = '' then
        update fiila.shops set logo = null, logo_type = null where id = s.id returning * into s;
      else
        select * into v_ph from fiila.photo_in(p ->> 'logo');
        if length(v_ph.data) > 80000 then perform fiila.fail('photo_too_large'); end if;
        update fiila.shops set logo = v_ph.data, logo_type = v_ph.ctype where id = s.id returning * into s;
      end if;
    end if;
    -- Photo de couverture : absente = inchangée, '' = retirée, base64 = remplacée (mêmes contrôles que les photos d'articles).
    if p ? 'cover' then
      if coalesce(p ->> 'cover', '') = '' then
        update fiila.shops set cover = null, cover_type = null, cover_path = null where id = s.id returning * into s;
      else
        select * into v_ph from fiila.photo_in(p ->> 'cover');
        update fiila.shops set cover = v_ph.data, cover_type = v_ph.ctype where id = s.id returning * into s;
      end if;
    end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('slug', s.slug, 'public', s.public, 'about', s.about,
    'theme', s.theme, 'shown_theme', fiila.shown_theme(s), 'plan', s.plan, 'accent', s.accent, 'socials', s.socials, 'policies', s.policies,
    'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end,
    'cover', case when s.cover is not null or s.cover_path is not null then fiila.media_src(s.cover_path, s.cover, s.cover_type) end,
    'products', (select count(*) from fiila.products where shop_id = s.id and active)));
end $function$;

do $$
declare role_name text; fn text;
begin
  foreach fn in array array['public.fiila_media_purge_pending(int)', 'public.fiila_media_purged(text, text, text, text)'] loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke execute on function %s from %I', fn, role_name);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
