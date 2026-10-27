-- Fii Édition, lot V1 (fondateur, 27/10/2026 19:50 : « Lance le lot Fii Édition V1 (rubriques, fiche qui rassure,
-- Complétez le look) » ; proposition HANDOFF #76, artefact EdVExViaAPTkTikt4jLYRK) :
--   1. rubriques du site dans un ordre fixe (Nouveautés → catégories → Promos) : la rubrique Promos repose sur un
--      prix barré par article (`price_was`, strictement supérieur au prix) ;
--   2. fiche article qui rassure : tailles épuisées barrées (`sizes_out`, sous-ensemble des tailles, refusées à la
--      commande), « Vendu par », livraison, paiement et échange choisis par la boutique en pastilles (`shops.policies`) ;
--   3. « Complétez le look » : articles de la même boutique, choisis sur le téléphone ; nombre réglé au back-office
--      (`site_look`, 0 = masqué).
-- Back-office : carte « Fiche article » de la boutique, ligne de mesure « Site » (Croissance), réglage `site_look`.

-- ---------------------------------------------------------------- 1. données
alter table fiila.products
  add column price_was bigint check (price_was is null or (price_was > price and price_was <= 100000000)),
  add column sizes_out text[] not null default '{}';
alter table fiila.shops add column policies jsonb not null default '{}'::jsonb;
insert into fiila.settings (key, value) values ('site_look', '3') on conflict (key) do nothing;

-- Conditions de la boutique : liste fermée (pastilles), rien en texte libre.
--   delivery : 'jour' (le jour même) | '24h' | '48h' | '5j' (2 à 5 jours) ;
--   pay      : tableau parmi 'livraison' (à la livraison), 'wave', 'om' (Orange Money) ;
--   exchange : 'non' | '3j' | '7j'.
create or replace function fiila.policies_in(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v jsonb := '{}'::jsonb; x text; v_pay text[] := '{}';
begin
  if p is null or jsonb_typeof(p) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if nullif(p ->> 'delivery', '') is not null then
    if p ->> 'delivery' not in ('jour', '24h', '48h', '5j') then perform fiila.fail('invalid_payload'); end if;
    v := v || jsonb_build_object('delivery', p ->> 'delivery');
  end if;
  if p ? 'pay' and jsonb_typeof(p -> 'pay') <> 'null' then
    if jsonb_typeof(p -> 'pay') <> 'array' then perform fiila.fail('invalid_payload'); end if;
    for x in select jsonb_array_elements_text(p -> 'pay') loop
      if x not in ('livraison', 'wave', 'om') then perform fiila.fail('invalid_payload'); end if;
      if not x = any (v_pay) then v_pay := v_pay || x; end if;
    end loop;
    if cardinality(v_pay) > 0 then v := v || jsonb_build_object('pay', to_jsonb(v_pay)); end if;
  end if;
  if nullif(p ->> 'exchange', '') is not null then
    if p ->> 'exchange' not in ('non', '3j', '7j') then perform fiila.fail('invalid_payload'); end if;
    v := v || jsonb_build_object('exchange', p ->> 'exchange');
  end if;
  return v;
end $$;

do $$
declare v_def text; v_new text;
begin
  -- Article : prix barré et tailles épuisées (lecture de la boutique).
  select pg_get_functiondef('fiila.product_json(fiila.products, boolean)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'colors', case when cardinality(p.colors) > 0 then to_jsonb(p.colors) end, 'stock', p.stock,$s$,
    $s$'colors', case when cardinality(p.colors) > 0 then to_jsonb(p.colors) end, 'stock', p.stock,
    'price_was', p.price_was, 'sizes_out', case when cardinality(p.sizes_out) > 0 then to_jsonb(p.sizes_out) end,$s$);
  if v_new = v_def then raise exception 'edition_v1: product_json non modifiée'; end if;
  execute v_new;

  -- Enregistrement : `price_was` (absent = inchangé, null ou 0 = retiré, sinon > prix) ; `sizes_out` gardé dans les tailles.
  select pg_get_functiondef('public.fiila_product_save(text, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$  v_cat text; v_sizes text[]; v_colors text[]; v_stock int;$s$,
    $s$  v_cat text; v_sizes text[]; v_colors text[]; v_stock int; v_was bigint; v_out text[];$s$);
  v_new := replace(v_new, $s$  v_id := fiila.as_uuid(p ->> 'id');$s$,
    $s$  if p ? 'price_was' and jsonb_typeof(p -> 'price_was') <> 'null' then
    begin v_was := (p ->> 'price_was')::bigint; exception when others then perform fiila.fail('invalid_price_was'); end;
    if v_was = 0 then v_was := null;
    elsif v_was is null or v_was <= v_price or v_was > 100000000 then perform fiila.fail('invalid_price_was'); end if;
  end if;
  v_out := fiila.tag_list(p -> 'sizes_out', 20, 8);
  v_id := fiila.as_uuid(p ->> 'id');$s$);
  -- Même ordre que le prix (une seule mise à jour) ; un prix monté au-dessus de l'ancien prix barré efface la promotion.
  v_new := replace(v_new, $s$    update fiila.products set name = v_name, price = v_price, description = fiila.clean(p ->> 'description', 300),$s$,
    $s$    update fiila.products set name = v_name, price = v_price, description = fiila.clean(p ->> 'description', 300),
      price_was = case when p ? 'price_was' then v_was when price_was > v_price then price_was end,$s$);
  v_new := replace(v_new, $s$  if p ? 'photo' then
    if coalesce(p ->> 'photo', '') = '' then$s$,
    $s$  if v_id is null and v_was is not null then update fiila.products set price_was = v_was where id = pr.id returning * into pr; end if;
  -- Tailles épuisées : seulement parmi les tailles de l'article (une taille retirée cesse d'être épuisée).
  if p ? 'sizes_out' or p ? 'sizes' then
    update fiila.products set sizes_out = coalesce(array(select x from unnest(case when p ? 'sizes_out' then coalesce(v_out, '{}') else sizes_out end) x
      where x = any (sizes)), '{}') where id = pr.id returning * into pr;
  end if;
  if p ? 'photo' then
    if coalesce(p ->> 'photo', '') = '' then$s$);
  if v_new = v_def or position('v_out := fiila.tag_list' in v_new) = 0 or position('price_was = case when p ?' in v_new) = 0
    or position('sizes_out = coalesce' in v_new) = 0 then raise exception 'edition_v1: fiila_product_save non modifiée'; end if;
  execute v_new;

  -- Site public : prix barré, tailles épuisées, conditions de la boutique, nombre d'articles de « Complétez le look ».
  select pg_get_functiondef('public.fiila_vitrine(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,$s$,
    $s$'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'price_was', pr.price_was, 'sizes_out', case when cardinality(pr.sizes_out) > 0 then to_jsonb(pr.sizes_out) end,$s$);
  v_new := replace(v_new, $s$'theme', fiila.shown_theme(s), 'accent', s.accent,$s$,
    $s$'theme', fiila.shown_theme(s), 'accent', s.accent, 'policies', nullif(s.policies, '{}'::jsonb),
      'look', greatest(0, least(6, coalesce(fiila.setting_int('site_look'), 3))),$s$);
  if v_new = v_def or position('sizes_out' in v_new) = 0 or position('site_look' in v_new) = 0 then raise exception 'edition_v1: fiila_vitrine non modifiée'; end if;
  execute v_new;

  -- Réglages du site : conditions de la boutique (pastilles), relues avec le reste.
  select pg_get_functiondef('public.fiila_shop_vitrine(text, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$      socials = case when p ? 'socials' then fiila.socials_in(p -> 'socials') else socials end,$s$,
    $s$      socials = case when p ? 'socials' then fiila.socials_in(p -> 'socials') else socials end,
      policies = case when p ? 'policies' then fiila.policies_in(p -> 'policies') else policies end,$s$);
  v_new := replace(v_new, $s$'accent', s.accent, 'socials', s.socials,$s$, $s$'accent', s.accent, 'socials', s.socials, 'policies', s.policies,$s$);
  if v_new = v_def or position('policies_in' in v_new) = 0 or position($s$'policies', s.policies$s$ in v_new) = 0 then raise exception 'edition_v1: fiila_shop_vitrine non modifiée'; end if;
  execute v_new;

  -- Commande depuis le site : une taille épuisée est refusée par le serveur, pas seulement barrée à l'écran.
  select pg_get_functiondef('public.fiila_vitrine_order(text, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    if cardinality(pr.sizes) = 0 then v_size := null; end if;$s$,
    $s$    if v_size is not null and v_size = any (pr.sizes_out) then perform fiila.fail('size_sold_out'); end if;
    if cardinality(pr.sizes) = 0 then v_size := null; end if;$s$);
  if v_new = v_def then raise exception 'edition_v1: fiila_vitrine_order non modifiée'; end if;
  execute v_new;

  -- Mesures anonymes du site ; et le modèle « Édition » manquait aux mesures Premium (lot 1).
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$p_variant ~ '^(atelier|comptoir|maison):(locked|preview|interest|applied)$'$s$,
    $s$p_variant ~ '^(atelier|comptoir|maison|edition):(locked|preview|interest|applied)$'$s$);
  v_new := replace(v_new, $s$    or (p_event = 'migrate'$s$, $s$    or (p_event = 'site' and p_variant in ('sheet:open', 'sheet:add', 'guide:open', 'look:click', 'tab:new', 'tab:cat', 'tab:promos'))
    or (p_event = 'migrate'$s$);
  if v_new = v_def or position($s$p_event = 'site'$s$ in v_new) = 0 or position('maison|edition' in v_new) = 0 then raise exception 'edition_v1: fiila_track non modifiée'; end if;
  execute v_new;

  -- Back-office, Croissance : compteurs « site » sur 30 jours.
  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'discover_on',$s$, $s$    'site', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'site' and day > v_since group by 1) x), '{}'::jsonb),
    'discover_on',$s$);
  if v_new = v_def then raise exception 'edition_v1: fiila_bo_onboarding non modifiée'; end if;
  execute v_new;

  -- Réglage `site_look` (0 à 6).
  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$when 'kyc_required' then array[0, 1]$s$, $s$when 'kyc_required' then array[0, 1] when 'site_look' then array[0, 6]$s$);
  if v_new = v_def then raise exception 'edition_v1: bo_setting_bounds non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'studio_premium_credits', 'kyc_required']$s$, $s$'studio_premium_credits', 'kyc_required', 'site_look']$s$);
  if v_new = v_def then raise exception 'edition_v1: fiila_bo_settings non modifiée'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------- back-office : fiche article d'une boutique
create or replace function public.fiila_bo_shop_sheet(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('shops');
  return (select jsonb_build_object('policies', s.policies,
    'promos', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and p.price_was is not null),
    'sold_out_sizes', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and cardinality(p.sizes_out) > 0),
    'with_sizes', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and cardinality(p.sizes) > 0))
    from fiila.shops s where s.id = p_shop);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  pub text[] := array['public.fiila_product_save(text, jsonb)', 'public.fiila_vitrine(text)', 'public.fiila_shop_vitrine(text, jsonb)',
    'public.fiila_vitrine_order(text, jsonb)', 'public.fiila_track(text, text)', 'public.fiila_bo_onboarding()', 'public.fiila_bo_settings()'];
begin
  foreach fn in array pub || array['public.fiila_bo_shop_sheet(uuid)'] loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array pub loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.fiila_bo_shop_sheet(uuid) to authenticated'; end if;
end $$;
