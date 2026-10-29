-- Modèle Premium « Concept » (fondateur, 29/10/2026 20:38 : « standardise BAe Rayons comme faisant partie des modèles
-- Premium, trouve-lui un nom adéquat, enlève le rose comme couleur prédéfinie, allons sur des boutons noirs, avec la
-- possibilité de changer la couleur des boutons et d'autres personnalisations ») ; maquette validée le 29/10 19:24.
--   1. rubriques propres à la boutique (`products.rubric`, 30 caractères) : remplacent la liste fixe de catégories dans les
--      rubriques du site quand la boutique en a ; la catégorie reste pour le fil et les filtres de Fii ;
--   2. modèle Premium `concept` : une rangée par rubrique qui défile de côté, « Tout voir » en grille ;
--   3. couleur des boutons : deux couleurs de plus, `noir` (proposée par défaut pour Concept) et `rose` ;
--   4. style du site (`shops.style`) : coins doux ou nets, animations, cœurs flottants de saison.
-- Corrigés au passage (HANDOFF #85) : un article créé avec `active: false` reste masqué ; une modification sans
-- `description` ne l'efface plus. Le site sert jusqu'à 500 articles (plafond d'une boutique) au lieu de 200.
-- Back-office : carte « Site » de la boutique (modèle, couleur, style, rubriques) et réglage par l'équipe, tracé ;
-- réglages `site_rail` (articles par rangée) et `site_anim` (coupe toutes les animations des sites).

alter table fiila.products add column if not exists rubric text check (rubric is null or char_length(rubric) between 1 and 30);
create index if not exists products_shop_rubric on fiila.products (shop_id, rubric) where rubric is not null;
alter table fiila.shops add column if not exists style jsonb not null default '{}'::jsonb;

insert into fiila.settings (key, value) values ('site_rail', '10'), ('site_anim', '1') on conflict (key) do nothing;

-- ---------------------------------------------------------------- modèles et couleurs
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'fiila.shops'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%theme%' or pg_get_constraintdef(oid) like '%accent%') loop
    execute format('alter table fiila.shops drop constraint %I', c);
  end loop;
end $$;
alter table fiila.shops add constraint shops_theme_check check (theme in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison', 'edition', 'concept'));
alter table fiila.shops add constraint shops_accent_check check (accent in ('foret', 'nuit', 'indigo', 'prune', 'bordeaux', 'terre', 'noir', 'rose'));
alter table fiila.shops add constraint shops_style_check check (jsonb_typeof(style) = 'object');

create or replace function fiila.premium_theme(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') in ('atelier', 'comptoir', 'maison', 'edition', 'concept') $$;

create or replace function fiila.theme_ok(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison', 'edition', 'concept') $$;
create or replace function fiila.accent_ok(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') in ('foret', 'nuit', 'indigo', 'prune', 'bordeaux', 'terre', 'noir', 'rose') $$;

-- Style du site : liste fermée ; absent = valeur du modèle (coins doux, animations).
create or replace function fiila.style_in(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_style'); end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('corners', 'anim', 'season')) then perform fiila.fail('invalid_style'); end if;
  if p ? 'corners' and coalesce(p ->> 'corners', '') not in ('doux', 'nets') then perform fiila.fail('invalid_style'); end if;
  if p ? 'anim' and jsonb_typeof(p -> 'anim') <> 'boolean' then perform fiila.fail('invalid_style'); end if;
  if p ? 'season' and jsonb_typeof(p -> 'season') <> 'boolean' then perform fiila.fail('invalid_style'); end if;
  return jsonb_strip_nulls(jsonb_build_object('corners', p ->> 'corners', 'anim', p -> 'anim', 'season', p -> 'season'));
end $$;

-- Fonctions réécrites en entier (garde-fou des migrations, HANDOFF #78) : Personnaliser mon site (modèle Concept,
-- couleurs noir et rose, style) ; site public (style, réglages des rangées et des animations, rubrique et date d'ajout de
-- chaque article, 500 articles) ; fiche article (rubrique) ; enregistrer un article (rubrique, `active: false` respecté à
-- la création, description gardée si absente) ; réglages site_rail et site_anim.
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
    if p ? 'theme' and not fiila.theme_ok(p ->> 'theme') then perform fiila.fail('invalid_theme'); end if;
    if fiila.premium_theme(p ->> 'theme') and s.plan <> 'premium' then perform fiila.fail('premium_required'); end if;
    if p ? 'accent' and not fiila.accent_ok(p ->> 'accent') then perform fiila.fail('invalid_theme'); end if;
    if s.slug is null then update fiila.shops set slug = fiila.make_slug(s.name) where id = s.id returning * into s; end if;
    update fiila.shops set
      public = coalesce((p ->> 'public')::boolean, public),
      about = case when p ? 'about' then fiila.clean(p ->> 'about', 160) else about end,
      theme = case when p ? 'theme' then p ->> 'theme' else theme end,
      accent = case when p ? 'accent' then p ->> 'accent' else accent end,
      socials = case when p ? 'socials' then fiila.socials_in(p -> 'socials') else socials end,
      policies = case when p ? 'policies' then fiila.policies_in(p -> 'policies') else policies end,
      style = case when p ? 'style' then fiila.style_in(p -> 'style') else style end,
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
    'theme', s.theme, 'shown_theme', fiila.shown_theme(s), 'plan', s.plan, 'accent', s.accent, 'style', nullif(s.style, '{}'::jsonb), 'socials', s.socials, 'policies', s.policies,
    'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end,
    'cover', case when s.cover is not null or s.cover_path is not null then fiila.media_src(s.cover_path, s.cover, s.cover_type) end,
    'products', (select count(*) from fiila.products where shop_id = s.id and active)));
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
      'theme', fiila.shown_theme(s), 'accent', s.accent, 'style', nullif(s.style, '{}'::jsonb),
      'rail', greatest(4, least(20, coalesce(fiila.setting_int('site_rail'), 10))),
      'anim_off', case when coalesce(fiila.setting_int('site_anim'), 1) = 0 then true end, 'policies', nullif(s.policies, '{}'::jsonb),
      'look', greatest(0, least(6, coalesce(fiila.setting_int('site_look'), 3))),
      'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end, 'socials', nullif(s.socials, '{}'::jsonb), 'has_cover', case when (s.cover is not null or s.cover_path is not null) then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', (pr.photo is not null or pr.photo_path is not null), 'img', fiila.card_img(pr.id),
        'is_new', case when pr.created_at > now() - interval '14 days' then true end, 'photos', fiila.photo_count(pr.id),
        'category', pr.category, 'rubric', pr.rubric, 'added', floor(extract(epoch from pr.created_at))::bigint, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'price_was', pr.price_was, 'sizes_out', case when cardinality(pr.sizes_out) > 0 then to_jsonb(pr.sizes_out) end,
        'gender', pr.gender, 'age_band', pr.age_band, 'condition', pr.condition,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 500) pr), '[]'::jsonb));
end $function$;

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
    update fiila.products set name = v_name, price = v_price,
      description = case when p ? 'description' then fiila.clean(p ->> 'description', 300) else description end,
      price_was = case when p ? 'price_was' then v_was when price_was > v_price then price_was end,
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now() where id = pr.id returning * into pr;
    if p ? 'category' or p ? 'sizes' or p ? 'colors' or p ? 'stock' or p ? 'rubric' then
      update fiila.products set
        category = case when p ? 'category' then v_cat else category end,
        rubric = case when p ? 'rubric' then fiila.clean(p ->> 'rubric', 30) else rubric end,
        sizes = case when p ? 'sizes' then v_sizes else sizes end,
        colors = case when p ? 'colors' then v_colors else colors end,
        stock = case when p ? 'stock' then v_stock else stock end
       where id = pr.id returning * into pr;
    end if;
  else
    if (select count(*) from fiila.products where shop_id = s.id) >= 500 then perform fiila.fail('too_many'); end if;
    insert into fiila.products (shop_id, name, price, description, category, rubric, sizes, colors, stock, active)
    values (s.id, v_name, v_price, fiila.clean(p ->> 'description', 300), v_cat, fiila.clean(p ->> 'rubric', 30), coalesce(v_sizes, '{}'), coalesce(v_colors, '{}'), v_stock,
      coalesce((p ->> 'active')::boolean, true)) returning * into pr;
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
    when 'studio_premium' then array[0, 1] when 'kyc_required' then array[0, 1] when 'site_look' then array[0, 6] when 'site_rail' then array[4, 20] when 'site_anim' then array[0, 1] when 'studio_premium_credits' then array[1, 10] when 'studio_fibo' then array[0, 1]
    when 'studio_welcome' then array[0, 1] when 'studio_welcome_credits' then array[1, 50] when 'studio_welcome_days' then array[7, 90] end
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
    from unnest(array['vd_commission', 'amb_reward_1', 'amb_reward_2', 'amb_reward_3', 'amb_monthly_cap', 'sms_verify', 'amb_manager_llm', 'nudges', 'amb_whatsapp', 'onboarding_v2', 'discover_after', 'wa_card_media', 'media_cdn', 'sugg_home_shop', 'sugg_shop_more_products', 'sugg_shop_share_vitrine', 'sugg_shop_courier', 'sugg_shop_photos', 'sugg_shop_team', 'adaptive_home', 'sugg_addr_photo', 'sugg_addr_mark', 'custom_domains', 'shop_subdomains', 'studio_ready', 'studio_budget_usd', 'studio_daily', 'studio_premium', 'studio_premium_credits', 'studio_fibo', 'studio_welcome', 'studio_welcome_credits', 'studio_welcome_days', 'kyc_required', 'site_look', 'site_rail', 'site_anim']) k), '{}'::jsonb);
end $function$;

-- ---------------------------------------------------------------- back-office
-- Carte « Site » : modèle, couleur, style, rubriques (articles visibles) ; réglage par l'équipe (droit « boutiques »
-- en écriture), tracé dans le journal (`shop_look`).
create or replace function fiila.bo_site_json(p_shop uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('theme', s.theme, 'shown_theme', fiila.shown_theme(s), 'plan', s.plan, 'accent', s.accent, 'style', s.style,
    'rubrics', coalesce((select jsonb_agg(jsonb_build_object('name', r.rubric, 'n', r.n) order by r.n desc, r.rubric)
      from (select rubric, count(*) n from fiila.products where shop_id = s.id and active and rubric is not null group by rubric) r), '[]'::jsonb),
    'no_rubric', (select count(*) from fiila.products where shop_id = s.id and active and rubric is null),
    'active', (select count(*) from fiila.products where shop_id = s.id and active))
  from fiila.shops s where s.id = p_shop
$$;

create or replace function public.fiila_bo_shop_site(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('shops');
  if not exists (select 1 from fiila.shops where id = p_shop) then perform fiila.fail('not_found'); end if;
  return fiila.bo_site_json(p_shop);
end $$;

create or replace function public.fiila_bo_shop_look(p_shop uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops;
begin
  perform fiila.need_staff('shops_write');
  select * into s from fiila.shops where id = p_shop for update;
  if s.id is null then perform fiila.fail('not_found'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where k not in ('theme', 'accent', 'style')) then perform fiila.fail('invalid_payload'); end if;
  if p ? 'theme' and not fiila.theme_ok(p ->> 'theme') then perform fiila.fail('invalid_theme'); end if;
  if p ? 'theme' and fiila.premium_theme(p ->> 'theme') and s.plan <> 'premium' then perform fiila.fail('premium_required'); end if;
  if p ? 'accent' and not fiila.accent_ok(p ->> 'accent') then perform fiila.fail('invalid_theme'); end if;
  update fiila.shops set
    theme = case when p ? 'theme' then p ->> 'theme' else theme end,
    accent = case when p ? 'accent' then p ->> 'accent' else accent end,
    style = case when p ? 'style' then fiila.style_in(p -> 'style') else style end,
    updated_at = now()
   where id = s.id;
  perform fiila.bo_log('shop_look', 'shop', p_shop::text, jsonb_build_object('name', s.name,
    'from', jsonb_build_object('theme', s.theme, 'accent', s.accent, 'style', s.style), 'to', p));
  return fiila.bo_site_json(p_shop);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  bo text[] := array['public.fiila_bo_shop_site(uuid)', 'public.fiila_bo_shop_look(uuid, jsonb)'];
  pub text[] := array['public.fiila_shop_vitrine(text, jsonb)', 'public.fiila_vitrine(text)', 'public.fiila_product_save(text, jsonb)'];
begin
  foreach fn in array bo || pub loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array pub loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach fn in array bo loop execute format('grant execute on function %s to authenticated', fn); end loop;
  end if;
end $$;
