-- Salons, lot 1 des recommandations (fondateur, 31/10 17:19 : « applique tes recommandations ») :
-- prochain créneau libre de chaque prestation (fiila_vitrine_next), règles du salon (shops.salon_rules) et délai de caution
-- envoyés au site, aperçu de partage des sites de boutique (description et image) pour WhatsApp et Instagram.
-- Fonctions réécrites en entier (règle des migrations depuis 20261028300000).

alter table fiila.shops add column salon_rules text check (char_length(salon_rules) <= 200);

-- Créneaux libres d'une prestation un jour donné (heure de Dakar) : partagé par le site (un jour) et le prochain créneau.
create or replace function fiila.salon_slots(s fiila.shops, pr fiila.products, p_day date) returns text[]
language plpgsql stable set search_path = '' as $$
declare v_h jsonb; v_open timestamptz; v_close timestamptz; t timestamptz; v_dur interval; v_taken int; v_out text[] := '{}';
begin
  v_h := s.hours -> extract(dow from p_day)::int::text;
  if v_h is null or jsonb_typeof(v_h) <> 'array' then return null; end if;
  v_dur := make_interval(mins => coalesce(pr.duration_min, 30));
  v_open := (p_day + (v_h ->> 0)::time) at time zone 'Africa/Dakar';
  v_close := (p_day + (v_h ->> 1)::time) at time zone 'Africa/Dakar';
  t := v_open;
  while t + v_dur <= v_close loop
    if t > now() + interval '30 minutes' then
      select count(*) into v_taken from fiila.bookings b
       where b.shop_id = s.id and b.start_at < t + v_dur and b.end_at > t and fiila.booking_live(b);
      if v_taken < s.seats then v_out := v_out || to_char(t at time zone 'Africa/Dakar', 'HH24:MI'); end if;
    end if;
    t := t + make_interval(mins => s.book_step);
  end loop;
  return v_out;
end $$;

CREATE OR REPLACE FUNCTION public.fiila_vitrine_slots(p_slug text, p_product uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops; pr fiila.products; v_slots text[]; v_today date := (now() at time zone 'Africa/Dakar')::date;
begin
  perform fiila.read_check();
  select * into s from fiila.shops where slug = p_slug and public;
  if not found or not fiila.salon_type(s.business_type) then perform fiila.fail('not_found'); end if;
  select * into pr from fiila.products where id = p_product and shop_id = s.id and active and price > 0;
  if not found then perform fiila.fail('product_not_found'); end if;
  if p_day is null or p_day < v_today or p_day > v_today + 30 then perform fiila.fail('invalid_day'); end if;
  v_slots := fiila.salon_slots(s, pr, p_day);
  if v_slots is null then return jsonb_build_object('day', p_day, 'closed', true, 'slots', '[]'::jsonb); end if;
  return jsonb_build_object('day', p_day, 'slots', to_jsonb(v_slots));
end $function$;

-- Prochain créneau libre de chaque prestation sur 14 jours : { "<id>": { "day": "YYYY-MM-DD", "time": "HH:MM" } }.
create or replace function public.fiila_vitrine_next(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; pr fiila.products; d date; v_slots text[]; v_out jsonb := '{}'::jsonb; v_today date := (now() at time zone 'Africa/Dakar')::date;
begin
  perform fiila.read_check();
  select * into s from fiila.shops where slug = p_slug and public;
  if not found or not fiila.salon_type(s.business_type) then perform fiila.fail('not_found'); end if;
  for pr in select * from fiila.products where shop_id = s.id and active and price > 0 order by updated_at desc limit 60 loop
    for i in 0..13 loop
      d := v_today + i;
      v_slots := fiila.salon_slots(s, pr, d);
      if v_slots is not null and cardinality(v_slots) > 0 then
        v_out := v_out || jsonb_build_object(pr.id::text, jsonb_build_object('day', d, 'time', v_slots[1]));
        exit;
      end if;
    end loop;
  end loop;
  return v_out;
end $$;

-- Aperçu de partage d'un site de boutique (Worker) : la présentation et une image publique (couverture, sinon un article).
create or replace function fiila.share_meta(p_shop uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'about', s.about,
    'kind', case when fiila.salon_type(s.business_type) then 'salon' end,
    'image', coalesce(fiila.media_url(s.cover_path),
      (select fiila.media_url(coalesce(p.photo_path, p.thumb_path)) from fiila.products p
        where p.shop_id = s.id and p.active and p.photo_path is not null order by p.updated_at desc limit 1))))
  from fiila.shops s where s.id = p_shop
$$;

CREATE OR REPLACE FUNCTION public.fiila_domain_resolve(p_host text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h text := fiila.domain_norm(p_host); r record; v_sub text; v_id uuid;
begin
  -- <lien>.getfii.app : toute boutique en ligne et non suspendue (le lien de la boutique, en minuscules).
  v_sub := substring(lower(trim(coalesce(p_host, ''))) from '^([a-z0-9]([a-z0-9-]{1,38}[a-z0-9]))\.getfii\.app\.?$');
  if v_sub is not null then
    if v_sub in ('www', 'sites', 'site', 'app', 'api', 'admin', 'bo', 'mail', 'email', 'smtp', 'mx', 'cdn', 'static', 'assets', 'img',
                 'aide', 'help', 'support', 'docs', 'blog', 'status', 'staging', 'preview', 'dev', 'test', 'demo', 'pay', 'paiement')
      or coalesce(fiila.setting_int('shop_subdomains'), 1) <> 1 then
      return jsonb_build_object('state', 'unknown');
    end if;
    select s.id, s.slug, s.name into r from fiila.shops s where s.slug = v_sub and s.public and s.suspended_at is null;
    if not found then return jsonb_build_object('state', 'unknown'); end if;
    return jsonb_build_object('state', 'ok', 'slug', r.slug, 'name', r.name, 'host', v_sub || '.getfii.app') || fiila.share_meta(r.id);
  end if;
  if h is null or coalesce(fiila.setting_int('custom_domains'), 1) <> 1 then return jsonb_build_object('state', 'unknown'); end if;
  select s.id, s.slug, s.name into r from fiila.shop_domains d join fiila.shops s on s.id = d.shop_id
   where d.hostname = h and d.status = 'active' and s.plan = 'premium' and s.public and s.suspended_at is null and s.slug is not null;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  return jsonb_build_object('state', 'ok', 'slug', r.slug, 'name', r.name, 'host', h) || fiila.share_meta(r.id);
end $function$;;

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
      'hold', case when v_salon then fiila.booking_hold() end, 'rules', case when v_salon then s.salon_rules end,
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
end $function$;;

CREATE OR REPLACE FUNCTION public.fiila_shop_salon(p_key text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      salon_rules = case when p ? 'rules' then fiila.clean(p ->> 'rules', 200) else salon_rules end,
      updated_at = now()
     where id = s.id returning * into s;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('salon', fiila.salon_type(s.business_type), 'hours', s.hours, 'seats', s.seats,
    'step', s.book_step, 'rules', s.salon_rules, 'place', fiila.salon_place(s.place_token), 'reels', fiila.reels_json(s.id, true)));
end $function$;;

CREATE OR REPLACE FUNCTION public.fiila_bo_bookings(p_shop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops;
begin
  perform fiila.need_staff('shops');
  select * into s from fiila.shops where id = p_shop;
  if not found then perform fiila.fail('not_found'); end if;
  return jsonb_build_object(
    'salon', fiila.salon_type(s.business_type), 'hours', s.hours, 'seats', s.seats, 'step', s.book_step, 'rules', s.salon_rules,
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
end $function$;;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  pub text[] := array['public.fiila_vitrine(text)', 'public.fiila_vitrine_slots(text, uuid, date)', 'public.fiila_vitrine_next(text)',
    'public.fiila_shop_salon(text, jsonb)', 'public.fiila_domain_resolve(text)'];
  bo text[] := array['public.fiila_bo_bookings(uuid)'];
begin
  foreach fn in array pub || bo loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array pub loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  foreach fn in array bo loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', fn); end if;
  end loop;
end $$;
