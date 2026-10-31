-- Beauté & bien-être (fondateur, 31/10/2026 14:41 ; premier client : Le Labo, barbier et beauté, Point E).
-- Salons (coiffure, barbier, ongles, cils, spa, massage) : les articles deviennent des **prestations** (durée, caution),
-- la boutique a des **horaires** et un nombre de **postes** ; la cliente choisit une prestation, un jour, un créneau libre,
-- puis **réserve** ; si la prestation demande une caution, elle la paie par Wave ou Orange Money au numéro de la boutique
-- (même règle que le paiement avant la livraison : numéro jamais montré sur le site, seulement sur la page du rendez-vous),
-- et le salon confirme à réception. Une réservation en attente de caution bloque le créneau `book_hold` minutes (60).
-- Réalisations : photos et courtes vidéos verticales (poster affiché tout de suite, vidéo chargée au toucher), copiées
-- dans le stockage par fiila-media-sync comme les photos. Adresse du salon : une fiche Fii (entrée, photo, itinéraire).
-- Nouveau modèle Premium « Rituel ». Fonctions réécrites en entier (règle des migrations depuis 20261028300000).

alter table fiila.products
  add column duration_min smallint check (duration_min between 5 and 600),
  add column deposit bigint check (deposit between 0 and 10000000);

alter table fiila.shops
  add column hours jsonb not null default '{}'::jsonb,
  add column seats smallint not null default 1 check (seats between 1 and 20),
  add column book_step smallint not null default 30 check (book_step in (15, 30, 60)),
  add column place_token text;
alter table fiila.shops drop constraint if exists shops_theme_check;
alter table fiila.shops add constraint shops_theme_check check (theme in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison', 'edition', 'concept', 'rituel'));

create table fiila.bookings (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references fiila.shops (id) on delete cascade,
  product_id     uuid references fiila.products (id) on delete set null,
  number         int not null,
  service        text not null,
  duration_min   smallint not null,
  price          bigint not null,
  deposit        bigint not null default 0,
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  customer_name  text not null,
  customer_phone text not null,
  note           text,
  status         text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'done', 'no_show')),
  pay_mode       text check (pay_mode in ('wave', 'om')),
  deposit_paid   boolean not null default false,
  cancel_reason  text check (cancel_reason in ('client', 'salon', 'expired')),
  token          text not null unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (shop_id, number)
);
create index bookings_shop_start on fiila.bookings (shop_id, start_at);
create index bookings_product on fiila.bookings (product_id);
alter table fiila.bookings enable row level security;
revoke all on fiila.bookings from public;

create table fiila.shop_reels (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references fiila.shops (id) on delete cascade,
  pos         smallint not null default 0,
  caption     text,
  poster      bytea,
  poster_type text,
  poster_path text,
  video       bytea,
  video_path  text,
  created_at  timestamptz not null default now(),
  check (poster is not null or poster_path is not null)
);
create index shop_reels_shop on fiila.shop_reels (shop_id, pos);
alter table fiila.shop_reels enable row level security;
revoke all on fiila.shop_reels from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on fiila.bookings from %I', role_name);
      execute format('revoke all on fiila.shop_reels from %I', role_name);
    end if;
  end loop;
end $$;

alter table fiila.media_objects drop constraint if exists media_objects_kind_check;
alter table fiila.media_objects add constraint media_objects_kind_check check (kind in ('product', 'product_extra', 'cover', 'thumb', 'reel', 'reel_poster'));

insert into fiila.settings (key, value) values ('book_hold', '60'), ('salon_booking', '1') on conflict (key) do nothing;

-- Le seau des photos accepte aussi les vidéos courtes des réalisations (6 Mo au plus, MP4).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  update storage.buckets set file_size_limit = 6000000, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
   where id = 'media';
end $$;

create or replace function fiila.salon_type(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') in ('coiffure', 'esthetique') $$;

-- Horaires : {"0".."6" (0 = dimanche) : ["HH:MM", "HH:MM"]} ; jour absent = fermé.
create or replace function fiila.hours_in(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; o time; c time; r jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_hours'); end if;
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[0-6]$' then perform fiila.fail('invalid_hours'); end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2
       or coalesce(v ->> 0, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(v ->> 1, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      perform fiila.fail('invalid_hours'); end if;
    o := (v ->> 0)::time; c := (v ->> 1)::time;
    if c <= o then perform fiila.fail('invalid_hours'); end if;
    r := r || jsonb_build_object(k, v);
  end loop;
  return r;
end $$;

create or replace function fiila.theme_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p, '') in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison', 'edition', 'concept', 'rituel')
$$;

create or replace function fiila.premium_theme(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p, '') in ('atelier', 'comptoir', 'maison', 'edition', 'concept', 'rituel')
$$;

create or replace function fiila.booking_hold() returns int
language sql stable set search_path = '' as $$ select greatest(15, least(240, coalesce(fiila.setting_int('book_hold'), 60))) $$;

-- Une réservation occupe un poste tant qu'elle n'est ni annulée ni expirée (en attente de caution depuis plus de book_hold).
create or replace function fiila.booking_live(b fiila.bookings) returns boolean
language sql stable set search_path = '' as $$
  select b.status in ('confirmed', 'done', 'no_show')
      or (b.status = 'pending' and (b.deposit = 0 or b.deposit_paid or b.created_at > now() - make_interval(mins => fiila.booking_hold())))
$$;

create or replace function fiila.booking_ref(p_number int) returns text
language sql immutable set search_path = '' as $$ select 'R' || lpad(p_number::text, 4, '0') $$;

create or replace function fiila.booking_json(b fiila.bookings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'ref', fiila.booking_ref(b.number), 'service', b.service, 'duration', b.duration_min, 'price', b.price,
    'deposit', nullif(b.deposit, 0), 'start_at', b.start_at, 'end_at', b.end_at,
    'customer_name', b.customer_name, 'customer_phone', b.customer_phone, 'note', b.note,
    'status', case when b.status = 'pending' and not fiila.booking_live(b) then 'expired' else b.status end,
    'pay_mode', b.pay_mode, 'deposit_paid', case when b.deposit > 0 then b.deposit_paid end,
    'cancel_reason', b.cancel_reason, 'created_at', b.created_at))
$$;

create or replace function fiila.salon_place(p_token text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('token', p.share_token, 'label', p.label, 'locality', p.locality,
    'lat', round(p.entry_lat::numeric, 5), 'lng', round(p.entry_lng::numeric, 5)))
    from fiila.places p where p_token is not null and p.share_token = p_token and p.kind = 'address' and p.status = 'active'
$$;

create or replace function fiila.reels_json(p_shop uuid, p_mine boolean) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'caption', r.caption,
      'poster', fiila.media_src(r.poster_path, r.poster, r.poster_type),
      'video', fiila.media_url(r.video_path),
      'video_pending', case when p_mine and r.video is not null and r.video_path is null then true end)) order by r.pos, r.created_at), '[]'::jsonb)
    from fiila.shop_reels r where r.shop_id = p_shop
$$;

-- --------------------------------------------------------------------------- articles : durée et caution des prestations
CREATE OR REPLACE FUNCTION fiila.product_json(p fiila.products, p_photo boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'name', p.name, 'price', p.price, 'description', p.description, 'active', p.active,
    'category', p.category, 'rubric', p.rubric, 'sizes', case when cardinality(p.sizes) > 0 then to_jsonb(p.sizes) end,
    'colors', case when cardinality(p.colors) > 0 then to_jsonb(p.colors) end, 'stock', p.stock,
    'price_was', p.price_was, 'sizes_out', case when cardinality(p.sizes_out) > 0 then to_jsonb(p.sizes_out) end,
    'duration', p.duration_min, 'deposit', p.deposit,
    'photo', case when p_photo and (p.photo is not null or p.photo_path is not null)
                  then fiila.media_src(p.photo_path, p.photo, p.photo_type) end,
    'photos', fiila.photo_count(p.id), 'thumb', case when p_photo then fiila.media_url(p.thumb_path) end,
    'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = p.id),
    'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = p.id),
    'updated_at', p.updated_at))
$function$;

CREATE OR REPLACE FUNCTION public.fiila_product_save(p_key text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); pr fiila.products; v_id uuid; v_name text; v_price bigint; v_ph record;
  v_cat text; v_sizes text[]; v_colors text[]; v_stock int; v_was bigint; v_out text[]; v_dur int; v_dep bigint;
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
  -- Prestations (salons, 31/10) : durée de 5 à 600 minutes, caution comprise entre 0 et le prix.
  if p ? 'duration' and jsonb_typeof(p -> 'duration') <> 'null' then
    begin v_dur := (p ->> 'duration')::int; exception when others then perform fiila.fail('invalid_duration'); end;
    if v_dur is null or v_dur < 5 or v_dur > 600 then perform fiila.fail('invalid_duration'); end if;
  end if;
  if p ? 'deposit' and jsonb_typeof(p -> 'deposit') <> 'null' then
    begin v_dep := (p ->> 'deposit')::bigint; exception when others then perform fiila.fail('invalid_deposit'); end;
    if v_dep is null or v_dep < 0 or v_dep > v_price then perform fiila.fail('invalid_deposit'); end if;
    if v_dep = 0 then v_dep := null; end if;
  end if;
  v_out := fiila.tag_list(p -> 'sizes_out', 20, 8);
  v_id := fiila.as_uuid(p ->> 'id');
  if v_id is not null then
    select * into pr from fiila.products where id = v_id and shop_id = s.id for update;
    if not found then perform fiila.fail('product_not_found'); end if;
    update fiila.products set name = v_name, price = v_price,
      description = case when p ? 'description' then fiila.clean(p ->> 'description', 300) else description end,
      price_was = case when p ? 'price_was' then v_was when price_was > v_price then price_was end,
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now() where id = pr.id returning * into pr;
    if p ? 'category' or p ? 'sizes' or p ? 'colors' or p ? 'stock' or p ? 'rubric' or p ? 'duration' or p ? 'deposit' then
      update fiila.products set
        category = case when p ? 'category' then v_cat else category end,
        rubric = case when p ? 'rubric' then fiila.clean(p ->> 'rubric', 30) else rubric end,
        sizes = case when p ? 'sizes' then v_sizes else sizes end,
        colors = case when p ? 'colors' then v_colors else colors end,
        stock = case when p ? 'stock' then v_stock else stock end,
        duration_min = case when p ? 'duration' then v_dur else duration_min end,
        deposit = case when p ? 'deposit' then v_dep else deposit end
       where id = pr.id returning * into pr;
    end if;
    if pr.deposit > pr.price then update fiila.products set deposit = price where id = pr.id returning * into pr; end if;
  else
    if (select count(*) from fiila.products where shop_id = s.id) >= 500 then perform fiila.fail('too_many'); end if;
    insert into fiila.products (shop_id, name, price, description, category, rubric, sizes, colors, stock, active, duration_min, deposit)
    values (s.id, v_name, v_price, fiila.clean(p ->> 'description', 300), v_cat, fiila.clean(p ->> 'rubric', 30), coalesce(v_sizes, '{}'), coalesce(v_colors, '{}'), v_stock,
      coalesce((p ->> 'active')::boolean, true), v_dur, v_dep) returning * into pr;
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
  -- Un article sans prix ne peut pas être publié (30/10) : il peut être enregistré, masqué.
  if pr.active and pr.price <= 0 then perform fiila.fail('price_required'); end if;
  return fiila.product_json(pr, true);
end $function$;

-- --------------------------------------------------------------------------- site public
CREATE OR REPLACE FUNCTION public.fiila_vitrine(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops; v_salon boolean;
begin
  perform fiila.read_check();
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,40}$' then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where slug = p_slug;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if not s.public then return jsonb_build_object('state', 'closed', 'shop', jsonb_build_object('name', s.name)); end if;
  insert into fiila.shop_views (shop_id, day, n) values (s.id, (now() at time zone 'utc')::date, 1)
    on conflict (shop_id, day) do update set n = fiila.shop_views.n + 1;
  v_salon := fiila.salon_type(s.business_type) and coalesce(fiila.setting_int('salon_booking'), 1) = 1;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'about', s.about, 'phone', s.phone,
      'demo', case when s.demo then true end, 'platform', case when s.platform then true end,
      'theme', fiila.shown_theme(s), 'accent', s.accent, 'style', nullif(s.style, '{}'::jsonb),
      'rail', greatest(4, least(20, coalesce(fiila.setting_int('site_rail'), 10))),
      'anim_off', case when coalesce(fiila.setting_int('site_anim'), 1) = 0 then true end, 'policies', nullif(s.policies - 'wave_to' - 'om_to', '{}'::jsonb), 'pay_before_off', case when coalesce(fiila.setting_int('pay_before'), 1) = 0 then true end,
      'look', greatest(0, least(6, coalesce(fiila.setting_int('site_look'), 3))),
      'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end, 'socials', nullif(s.socials, '{}'::jsonb), 'has_cover', case when (s.cover is not null or s.cover_path is not null) then true end,
      'business_type', s.business_type,
      'salon', case when v_salon then true end,
      'hours', case when v_salon then s.hours end,
      'place', fiila.salon_place(s.place_token),
      'reels', case when exists (select 1 from fiila.shop_reels r where r.shop_id = s.id) then fiila.reels_json(s.id, false) end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', (pr.photo is not null or pr.photo_path is not null), 'img', fiila.card_img(pr.id),
        'is_new', case when pr.created_at > now() - interval '14 days' then true end, 'photos', fiila.photo_count(pr.id),
        'category', pr.category, 'rubric', pr.rubric, 'added', floor(extract(epoch from pr.created_at))::bigint, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'price_was', pr.price_was, 'sizes_out', case when cardinality(pr.sizes_out) > 0 then to_jsonb(pr.sizes_out) end,
        'gender', pr.gender, 'age_band', pr.age_band, 'condition', pr.condition,
        'duration', case when v_salon then pr.duration_min end, 'deposit', case when v_salon then pr.deposit end,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active and price > 0 order by updated_at desc limit 500) pr), '[]'::jsonb));
end $function$;

-- Créneaux libres d'une prestation pour un jour (heure de Dakar), au pas de la boutique ; 30 jours à l'avance au plus.
create or replace function public.fiila_vitrine_slots(p_slug text, p_product uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; pr fiila.products; v_h jsonb; v_open timestamptz; v_close timestamptz; t timestamptz; v_dur interval;
  v_slots jsonb := '[]'::jsonb; v_taken int; v_today date := (now() at time zone 'Africa/Dakar')::date;
begin
  perform fiila.read_check();
  select * into s from fiila.shops where slug = p_slug and public;
  if not found or not fiila.salon_type(s.business_type) then perform fiila.fail('not_found'); end if;
  select * into pr from fiila.products where id = p_product and shop_id = s.id and active and price > 0;
  if not found then perform fiila.fail('product_not_found'); end if;
  if p_day is null or p_day < v_today or p_day > v_today + 30 then perform fiila.fail('invalid_day'); end if;
  v_h := s.hours -> extract(dow from p_day)::int::text;
  if v_h is null or jsonb_typeof(v_h) <> 'array' then return jsonb_build_object('day', p_day, 'closed', true, 'slots', '[]'::jsonb); end if;
  v_dur := make_interval(mins => coalesce(pr.duration_min, 30));
  v_open := (p_day + (v_h ->> 0)::time) at time zone 'Africa/Dakar';
  v_close := (p_day + (v_h ->> 1)::time) at time zone 'Africa/Dakar';
  t := v_open;
  while t + v_dur <= v_close loop
    if t > now() + interval '30 minutes' then
      select count(*) into v_taken from fiila.bookings b
       where b.shop_id = s.id and b.start_at < t + v_dur and b.end_at > t and fiila.booking_live(b);
      if v_taken < s.seats then v_slots := v_slots || to_jsonb(to_char(t at time zone 'Africa/Dakar', 'HH24:MI')); end if;
    end if;
    t := t + make_interval(mins => s.book_step);
  end loop;
  return jsonb_build_object('day', p_day, 'slots', v_slots);
end $$;

-- Réservation par la cliente (sans compte). Caution > 0 et numéro Wave / OM de la boutique : la cliente choisit le mode,
-- la réservation reste en attente (créneau bloqué book_hold minutes) jusqu'à « Caution reçue » ; sinon confirmée.
create or replace function public.fiila_vitrine_book(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; pr fiila.products; b fiila.bookings; v_day date; v_time time; v_start timestamptz; v_end timestamptz;
  v_name text; v_phone text; v_pay text; v_modes text[]; v_dep bigint; v_h jsonb; v_taken int; v_num int;
begin
  perform fiila.rate_check('vitrine_book', 30);
  perform fiila.housekeeping();
  select * into s from fiila.shops where slug = p_slug and public for update;
  if not found or not fiila.salon_type(s.business_type) or coalesce(fiila.setting_int('salon_booking'), 1) = 0 then perform fiila.fail('not_found'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  select * into pr from fiila.products where id = fiila.as_uuid(p ->> 'product_id') and shop_id = s.id and active and price > 0;
  if not found then perform fiila.fail('product_not_found'); end if;
  begin v_day := (p ->> 'day')::date; v_time := (p ->> 'time')::time; exception when others then perform fiila.fail('invalid_slot'); end;
  if v_day is null or v_time is null then perform fiila.fail('invalid_slot'); end if;
  v_start := (v_day + v_time) at time zone 'Africa/Dakar';
  v_end := v_start + make_interval(mins => coalesce(pr.duration_min, 30));
  v_h := s.hours -> extract(dow from v_day)::int::text;
  if v_h is null or jsonb_typeof(v_h) <> 'array' or v_start < (v_day + (v_h ->> 0)::time) at time zone 'Africa/Dakar'
     or v_end > (v_day + (v_h ->> 1)::time) at time zone 'Africa/Dakar' or v_start <= now() + interval '30 minutes'
     or v_start > now() + interval '31 days' then
    perform fiila.fail('slot_taken'); end if;
  select count(*) into v_taken from fiila.bookings x where x.shop_id = s.id and x.start_at < v_end and x.end_at > v_start and fiila.booking_live(x);
  if v_taken >= s.seats then perform fiila.fail('slot_taken'); end if;
  v_name := fiila.clean(p -> 'customer' ->> 'name', 60);
  if v_name is null then perform fiila.fail('customer_name_required'); end if;
  v_phone := fiila.clean_phone(p -> 'customer' ->> 'phone');
  if nullif(fiila.phone_key(v_phone), '') is null then perform fiila.fail('phone_required'); end if;
  -- Une même personne : 3 rendez-vous à venir au plus dans ce salon.
  if (select count(*) from fiila.bookings x where x.shop_id = s.id and fiila.phone_key(x.customer_phone) = fiila.phone_key(v_phone)
        and x.start_at > now() and fiila.booking_live(x)) >= 3 then perform fiila.fail('too_many'); end if;
  v_dep := coalesce(pr.deposit, 0);
  v_modes := array(select m from jsonb_array_elements_text(coalesce(s.policies -> 'pay', '[]'::jsonb)) m
                    where (m = 'wave' and s.policies ? 'wave_to') or (m = 'om' and s.policies ? 'om_to'));
  if coalesce(fiila.setting_int('pay_before'), 1) = 0 then v_modes := '{}'; end if;
  if v_dep > 0 and cardinality(v_modes) = 0 then v_dep := 0; end if;
  v_pay := nullif(p ->> 'pay', '');
  if v_dep > 0 then
    if v_pay is null then perform fiila.fail('pay_required'); end if;
    if not v_pay = any (v_modes) then perform fiila.fail('invalid_pay'); end if;
  else v_pay := null; end if;
  select coalesce(max(number), 0) + 1 into v_num from fiila.bookings where shop_id = s.id;
  insert into fiila.bookings (shop_id, product_id, number, service, duration_min, price, deposit, start_at, end_at,
      customer_name, customer_phone, note, status, pay_mode, token)
    values (s.id, pr.id, v_num, pr.name, coalesce(pr.duration_min, 30), pr.price, v_dep, v_start, v_end,
      v_name, v_phone, fiila.clean(p ->> 'note', 200), case when v_dep > 0 then 'pending' else 'confirmed' end, v_pay, fiila.token(16))
    returning * into b;
  return jsonb_build_object('token', b.token, 'ref', fiila.booking_ref(b.number), 'status', b.status);
end $$;

-- Page du rendez-vous (lien gardé par la cliente).
create or replace function public.fiila_booking_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b fiila.bookings; s fiila.shops;
begin
  perform fiila.read_check();
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into b from fiila.bookings where token = p_token;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where id = b.shop_id;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'slug', case when s.public then s.slug end, 'phone', s.phone,
      'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end,
      'place', fiila.salon_place(s.place_token))),
    'booking', fiila.booking_json(b) - 'customer_phone'
      || jsonb_strip_nulls(jsonb_build_object('pay_to', case when b.status = 'pending' and b.deposit > 0 and not b.deposit_paid
           then case b.pay_mode when 'wave' then s.policies ->> 'wave_to' when 'om' then s.policies ->> 'om_to' end end,
        'hold_until', case when b.status = 'pending' and b.deposit > 0 and not b.deposit_paid
           then b.created_at + make_interval(mins => fiila.booking_hold()) end,
        'can_cancel', case when b.status in ('pending', 'confirmed') and b.start_at > now() + interval '2 hours' then true end)));
end $$;

create or replace function public.fiila_booking_cancel(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b fiila.bookings;
begin
  perform fiila.rate_check('booking_cancel', 20);
  if not fiila.valid_token(p_token) then perform fiila.fail('not_found'); end if;
  select * into b from fiila.bookings where token = p_token for update;
  if not found then perform fiila.fail('not_found'); end if;
  if b.status not in ('pending', 'confirmed') then perform fiila.fail('not_cancellable'); end if;
  if b.start_at <= now() + interval '2 hours' then perform fiila.fail('too_late'); end if;
  update fiila.bookings set status = 'cancelled', cancel_reason = 'client', updated_at = now() where id = b.id;
  return public.fiila_booking_public(p_token);
end $$;

-- --------------------------------------------------------------------------- espace du salon
create or replace function public.fiila_bookings(p_key text, p_from date, p_days int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_from date := coalesce(p_from, (now() at time zone 'Africa/Dakar')::date);
begin
  perform fiila.housekeeping();
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(fiila.booking_json(b) order by b.start_at)
      from fiila.bookings b where b.shop_id = s.id
       and b.start_at >= v_from::timestamp at time zone 'Africa/Dakar'
       and b.start_at < (v_from + greatest(1, least(coalesce(p_days, 7), 62)))::timestamp at time zone 'Africa/Dakar'), '[]'::jsonb),
    'waiting', (select count(*) from fiila.bookings b where b.shop_id = s.id and b.status = 'pending' and b.deposit > 0
                  and not b.deposit_paid and fiila.booking_live(b)),
    'today', (select count(*) from fiila.bookings b where b.shop_id = s.id and b.status in ('pending', 'confirmed') and fiila.booking_live(b)
                and (b.start_at at time zone 'Africa/Dakar')::date = (now() at time zone 'Africa/Dakar')::date));
end $$;

-- Actions du salon : deposit (caution reçue → confirmé), confirm (sans caution), cancel, done (venue), no_show.
create or replace function public.fiila_booking_set(p_key text, p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); b fiila.bookings;
begin
  perform fiila.rate_check('booking_set', 300);
  select * into b from fiila.bookings where id = p_id and shop_id = s.id for update;
  if not found then perform fiila.fail('not_found'); end if;
  if p_action = 'deposit' then
    if b.status not in ('pending', 'confirmed') or b.deposit = 0 then perform fiila.fail('invalid_action'); end if;
    update fiila.bookings set deposit_paid = true, status = 'confirmed', updated_at = now() where id = b.id returning * into b;
  elsif p_action = 'confirm' then
    if b.status <> 'pending' then perform fiila.fail('invalid_action'); end if;
    update fiila.bookings set status = 'confirmed', updated_at = now() where id = b.id returning * into b;
  elsif p_action = 'cancel' then
    if b.status not in ('pending', 'confirmed') then perform fiila.fail('invalid_action'); end if;
    update fiila.bookings set status = 'cancelled', cancel_reason = 'salon', updated_at = now() where id = b.id returning * into b;
  elsif p_action in ('done', 'no_show') then
    if b.status not in ('pending', 'confirmed') then perform fiila.fail('invalid_action'); end if;
    update fiila.bookings set status = p_action, updated_at = now() where id = b.id returning * into b;
  else
    perform fiila.fail('invalid_action');
  end if;
  return fiila.booking_json(b);
end $$;

-- Réglages du salon : horaires, postes, pas des créneaux, adresse (lien d'une fiche Fii). p null = lecture.
create or replace function public.fiila_shop_salon(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_tok text; v_n int;
begin
  if p is not null then
    perform fiila.need_shop_role('admin');
    perform fiila.rate_check('shop_salon', 60);
    if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
    if p ? 'seats' then
      begin v_n := (p ->> 'seats')::int; exception when others then perform fiila.fail('invalid_seats'); end;
      if v_n is null or v_n < 1 or v_n > 20 then perform fiila.fail('invalid_seats'); end if;
    end if;
    if p ? 'step' and coalesce(p ->> 'step', '') not in ('15', '30', '60') then perform fiila.fail('invalid_step'); end if;
    if p ? 'place' and coalesce(p ->> 'place', '') <> '' then
      v_tok := substring(p ->> 'place' from '([A-Za-z0-9_-]{16,64})/?$');
      if v_tok is null or fiila.salon_place(v_tok) is null then perform fiila.fail('place_not_found'); end if;
    end if;
    update fiila.shops set
      hours = case when p ? 'hours' then fiila.hours_in(p -> 'hours') else hours end,
      seats = case when p ? 'seats' then v_n else seats end,
      book_step = case when p ? 'step' then (p ->> 'step')::smallint else book_step end,
      place_token = case when p ? 'place' then v_tok else place_token end,
      updated_at = now()
     where id = s.id returning * into s;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('salon', fiila.salon_type(s.business_type), 'hours', s.hours, 'seats', s.seats,
    'step', s.book_step, 'place', fiila.salon_place(s.place_token), 'reels', fiila.reels_json(s.id, true)));
end $$;

-- Réalisations : photo (poster, 4:5 ou 9:16) et vidéo MP4 facultative (4 Mo au plus) ; 24 au plus.
create or replace function public.fiila_reel_add(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_ph record; v_vid bytea;
begin
  perform fiila.need_shop_role('admin');
  perform fiila.rate_check('reel_add', 40);
  if p is null or jsonb_typeof(p) <> 'object' or coalesce(p ->> 'poster', '') = '' then perform fiila.fail('photo_required'); end if;
  if (select count(*) from fiila.shop_reels where shop_id = s.id) >= 24 then perform fiila.fail('too_many'); end if;
  select * into v_ph from fiila.photo_in(p ->> 'poster');
  if length(v_ph.data) > 300000 then perform fiila.fail('photo_too_large'); end if;
  if coalesce(p ->> 'video', '') <> '' then
    begin v_vid := decode(regexp_replace(p ->> 'video', '^data:video/mp4;base64,', ''), 'base64'); exception when others then perform fiila.fail('invalid_video'); end;
    if length(v_vid) > 4200000 then perform fiila.fail('video_too_large'); end if;
    if length(v_vid) < 12 or substring(v_vid from 5 for 4) <> '\x66747970'::bytea then perform fiila.fail('invalid_video'); end if;
  end if;
  insert into fiila.shop_reels (shop_id, pos, caption, poster, poster_type, video)
    values (s.id, coalesce((select max(pos) + 1 from fiila.shop_reels where shop_id = s.id), 0), fiila.clean(p ->> 'caption', 80),
            v_ph.data, v_ph.ctype, v_vid);
  return fiila.reels_json(s.id, true);
end $$;

create or replace function public.fiila_reel_delete(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  perform fiila.need_shop_role('admin');
  delete from fiila.shop_reels where id = p_id and shop_id = s.id;
  if not found then perform fiila.fail('not_found'); end if;
  return fiila.reels_json(s.id, true);
end $$;

-- --------------------------------------------------------------------------- copie des réalisations dans le stockage
CREATE OR REPLACE FUNCTION public.fiila_media_pending(p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select * from (
      select 'product' kind, p.id::text ref, p.photo_type ctype, md5(p.photo) hash, encode(p.photo, 'base64') b64
        from fiila.products p where p.photo is not null and p.photo_path is null
      union all
      select 'product_extra', x.product_id::text || ':' || x.pos, x.ctype, md5(x.data), encode(x.data, 'base64')
        from fiila.product_photos x where x.path is null
      union all
      select 'cover', s.id::text, s.cover_type, md5(s.cover), encode(s.cover, 'base64')
        from fiila.shops s where s.cover is not null and s.cover_path is null
      union all
      select 'reel_poster', r.id::text, r.poster_type, md5(r.poster), encode(r.poster, 'base64')
        from fiila.shop_reels r where r.poster is not null and r.poster_path is null
      union all
      -- Vidéos : une par passage (quelques Mo chacune).
      (select 'reel', r.id::text, 'video/mp4', md5(r.video), encode(r.video, 'base64')
        from fiila.shop_reels r where r.video is not null and r.video_path is null order by r.created_at limit 1)
    ) q limit least(greatest(coalesce(p_limit, 8), 1), 20)
  ) x
$function$;

CREATE OR REPLACE FUNCTION public.fiila_media_done(p_kind text, p_ref text, p_hash text, p_path text, p_bytes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int := 0; v_id uuid; v_pos int;
begin
  if p_path !~ '^(p|c)/[0-9a-f-]{36}(-[1-4])?-[0-9a-f]{32}\.(jpg|png|webp)$'
     and not (p_kind = 'thumb' and p_path ~ '^t/[0-9a-f-]{36}-[0-9a-f]{32}\.jpg$')
     and not (p_kind in ('reel', 'reel_poster') and p_path ~ '^r/[0-9a-f-]{36}-[0-9a-f]{32}\.(jpg|png|webp|mp4)$') then
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
  elsif p_kind = 'reel_poster' then
    update fiila.shop_reels set poster_path = p_path where id = p_ref::uuid and md5(poster) = p_hash and poster_path is null;
  elsif p_kind = 'reel' then
    update fiila.shop_reels set video_path = p_path where id = p_ref::uuid and md5(video) = p_hash and video_path is null;
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  insert into fiila.media_objects (path, kind, ref, bytes) values (p_path, p_kind, p_ref, greatest(coalesce(p_bytes, 0), 0))
    on conflict (path) do nothing;
  if v_n = 1 then insert into fiila.media_log (action, ref) values ('copied', p_kind || ':' || p_ref); end if;
  return jsonb_build_object('ok', true, 'linked', v_n = 1);
end $function$;

CREATE OR REPLACE FUNCTION fiila.media_used(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (select 1 from fiila.products p where p.photo_path = p_path or p.thumb_path = p_path)
      or exists (select 1 from fiila.product_photos x where x.path = p_path)
      or exists (select 1 from fiila.shops s where s.cover_path = p_path)
      or exists (select 1 from fiila.shop_reels r where r.poster_path = p_path or r.video_path = p_path)
$function$;

-- --------------------------------------------------------------------------- entretien
CREATE OR REPLACE FUNCTION fiila.housekeeping()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_last timestamptz;
begin
  select value::timestamptz into v_last from fiila.settings where key = 'housekeeping_at' for update skip locked;
  if v_last is null or v_last > now() - interval '10 minutes' then return; end if;
  update fiila.settings set value = now()::text where key = 'housekeeping_at';
  delete from fiila.rate_events where at < now() - interval '1 day';
  delete from fiila.places where kind = 'meeting' and expires_at < now() - interval '30 days';
  delete from fiila.requests where expires_at < now() - interval '30 days'
    and not exists (select 1 from fiila.orders o where o.request_id = requests.id and o.place_id is null and o.status = 'open');
  delete from fiila.retired_tokens where retired_at < now() - interval '180 days';
  delete from fiila.trackers where expires_at < now() - interval '1 day';
  update fiila.trackers set lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null
   where expires_at < now() and (lat is not null or courier_send is not null);
  delete from fiila.courier_invites where coalesce(used_at, expires_at) < now() - interval '7 days';
  -- conservation des données de boutique : 24 mois
  delete from fiila.orders where created_at < now() - interval '24 months';
  delete from fiila.customers c where c.updated_at < now() - interval '24 months'
    and not exists (select 1 from fiila.orders o where o.customer_id = c.id);
  -- Rendez-vous (31/10) : caution non reçue à temps → annulé (« expiré ») ; conservés 24 mois comme les commandes.
  update fiila.bookings b set status = 'cancelled', cancel_reason = 'expired', updated_at = now()
   where b.status = 'pending' and b.deposit > 0 and not b.deposit_paid and b.created_at < now() - make_interval(mins => fiila.booking_hold());
  delete from fiila.bookings where start_at < now() - interval '24 months';
  -- Audit du 27/10 : empreinte IP des favoris et suivis (anti-abus du classement sur 14 jours) gardée 30 jours ;
  -- séries Studio 6 mois ; invitations d'équipe utilisées ou expirées 90 jours ; sel des empreintes IP renouvelé chaque année.
  update fiila.likes set src = null where src is not null and created_at < now() - interval '30 days';
  update fiila.saves set src = null where src is not null and created_at < now() - interval '30 days';
  update fiila.follows set src = null where src is not null and created_at < now() - interval '30 days';
  delete from fiila.studio_jobs where created_at < now() - interval '6 months';
  delete from fiila.shop_invites where coalesce(used_at, expires_at) < now() - interval '90 days';
  if coalesce((select value::timestamptz from fiila.settings where key = 'rate_salt_at'), now()) < now() - interval '365 days' then
    update fiila.settings set value = fiila.token(24) where key = 'rate_salt';
    update fiila.settings set value = now()::text where key = 'rate_salt_at';
  end if;
end $function$;

-- --------------------------------------------------------------------------- back-office
CREATE OR REPLACE FUNCTION fiila.bo_setting_bounds(p_key text)
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1]
    when 'amb_manager_llm' then array[0, 1]
    when 'nudges' then array[0, 1]
    when 'amb_whatsapp' then array[0, 1]
    when 'onboarding_v2' then array[0, 1]
    when 'discover_after' then array[0, 1]
    when 'wa_card_media' then array[0, 1]
    when 'media_cdn' then array[0, 1]
    when 'sugg_home_shop' then array[0, 1] when 'sugg_shop_more_products' then array[0, 1] when 'sugg_shop_share_vitrine' then array[0, 1]
    when 'sugg_shop_courier' then array[0, 1] when 'sugg_shop_photos' then array[0, 1] when 'sugg_shop_team' then array[0, 1]
    when 'adaptive_home' then array[0, 1]
    when 'sugg_addr_photo' then array[0, 1] when 'sugg_addr_mark' then array[0, 1]
    when 'custom_domains' then array[0, 1] when 'shop_subdomains' then array[0, 1]
    when 'studio_ready' then array[0, 1] when 'studio_budget_usd' then array[0, 2000] when 'studio_daily' then array[1, 100]
    when 'studio_premium' then array[0, 1] when 'kyc_required' then array[0, 1] when 'site_look' then array[0, 6] when 'site_rail' then array[4, 20] when 'site_anim' then array[0, 1] when 'pay_before' then array[0, 1] when 'studio_premium_credits' then array[1, 10] when 'studio_fibo' then array[0, 1]
    when 'studio_welcome' then array[0, 1] when 'studio_welcome_credits' then array[1, 50] when 'studio_welcome_days' then array[7, 90]
    when 'salon_booking' then array[0, 1] when 'book_hold' then array[15, 240] end
$function$;

CREATE OR REPLACE FUNCTION public.fiila_bo_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := fiila.need_staff('settings');
begin
  return coalesce((select jsonb_object_agg(k, fiila.setting_int(k))
    from unnest(array['vd_commission', 'amb_reward_1', 'amb_reward_2', 'amb_reward_3', 'amb_monthly_cap', 'sms_verify', 'amb_manager_llm', 'nudges', 'amb_whatsapp', 'onboarding_v2', 'discover_after', 'wa_card_media', 'media_cdn', 'sugg_home_shop', 'sugg_shop_more_products', 'sugg_shop_share_vitrine', 'sugg_shop_courier', 'sugg_shop_photos', 'sugg_shop_team', 'adaptive_home', 'sugg_addr_photo', 'sugg_addr_mark', 'custom_domains', 'shop_subdomains', 'studio_ready', 'studio_budget_usd', 'studio_daily', 'studio_premium', 'studio_premium_credits', 'studio_fibo', 'studio_welcome', 'studio_welcome_credits', 'studio_welcome_days', 'kyc_required', 'site_look', 'site_rail', 'site_anim', 'pay_before', 'salon_booking', 'book_hold']) k), '{}'::jsonb);
end $function$;

-- Rendez-vous d'un salon (back-office) : à venir et récents, compteurs, réglages du salon, réalisations.
create or replace function public.fiila_bo_bookings(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops;
begin
  perform fiila.need_staff('shops');
  select * into s from fiila.shops where id = p_shop;
  if not found then perform fiila.fail('not_found'); end if;
  return jsonb_build_object(
    'salon', fiila.salon_type(s.business_type), 'hours', s.hours, 'seats', s.seats, 'step', s.book_step,
    'place', fiila.salon_place(s.place_token),
    'counts', (select jsonb_build_object(
        'upcoming', count(*) filter (where b.start_at > now() and b.status in ('pending', 'confirmed') and fiila.booking_live(b)),
        'waiting', count(*) filter (where b.status = 'pending' and b.deposit > 0 and not b.deposit_paid and fiila.booking_live(b)),
        'done', count(*) filter (where b.status = 'done'), 'no_show', count(*) filter (where b.status = 'no_show'),
        'cancelled', count(*) filter (where b.status = 'cancelled'))
      from fiila.bookings b where b.shop_id = s.id),
    'items', coalesce((select jsonb_agg(x.j order by x.st desc) from (
        select fiila.booking_json(b) - 'customer_phone' - 'note' j, b.start_at st from fiila.bookings b
         where b.shop_id = s.id order by b.start_at desc limit 60) x), '[]'::jsonb),
    'reels', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'caption', r.caption, 'video', r.video is not null or r.video_path is not null,
        'synced', (r.poster_path is not null and (r.video is null or r.video_path is not null))) order by r.pos), '[]'::jsonb)
      from fiila.shop_reels r where r.shop_id = s.id));
end $$;

create or replace function public.fiila_bo_reel_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.shop_reels; s fiila.shops;
begin
  perform fiila.need_staff('shops_write');
  select * into r from fiila.shop_reels where id = p_id;
  if not found then perform fiila.fail('not_found'); end if;
  select * into s from fiila.shops where id = r.shop_id;
  delete from fiila.shop_reels where id = p_id;
  perform fiila.bo_log('reel_delete', 'shop', s.id::text, jsonb_build_object('name', s.name, 'caption', r.caption));
  return public.fiila_bo_bookings(s.id);
end $$;

-- --------------------------------------------------------------------------- droits
revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  pub text[] := array['public.fiila_vitrine(text)', 'public.fiila_product_save(text, jsonb)', 'public.fiila_vitrine_slots(text, uuid, date)',
    'public.fiila_vitrine_book(text, jsonb)', 'public.fiila_booking_public(text)', 'public.fiila_booking_cancel(text)',
    'public.fiila_bookings(text, date, int)', 'public.fiila_booking_set(text, uuid, text)', 'public.fiila_shop_salon(text, jsonb)',
    'public.fiila_reel_add(text, jsonb)', 'public.fiila_reel_delete(text, uuid)'];
  bo text[] := array['public.fiila_bo_settings()', 'public.fiila_bo_bookings(uuid)', 'public.fiila_bo_reel_delete(uuid)'];
  svc text[] := array['public.fiila_media_pending(int)', 'public.fiila_media_done(text, text, text, text, int)'];
begin
  foreach fn in array pub || bo || svc loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array pub loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  foreach fn in array bo loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', fn); end if;
  end loop;
  foreach fn in array svc loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function %s from %I', fn, role_name); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;
