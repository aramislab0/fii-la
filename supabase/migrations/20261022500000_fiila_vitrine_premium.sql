-- Vitrine premium (fondateur, 22/10/2026 04:55) : réglages simplifiés, logo de la boutique (carré arrondi, à la place
-- de l'initiale), réseaux en ronds à côté du logo (Snapchat ajouté), trois modèles réservés aux abonnés Premium.
-- 1) shops.logo / logo_type : petit logo (≤ 80 Ko, carré recadré par l'application), servi dans la réponse de la vitrine.
-- 2) shops.plan : 'free' (par défaut) ou 'premium'. Réglé par l'équipe au back-office (aucun paiement en ligne à ce stade).
-- 3) Modèles premium 'atelier', 'comptoir', 'maison' : refusés si la boutique n'est pas Premium ; si l'abonnement
--    s'arrête, la vitrine revient au modèle Galerie sans rien perdre (le choix est gardé).
-- 4) Réseaux : Snapchat ajouté (snapchat.com/add/<nom>).
-- Back-office (règle n° 8) : fiche boutique → « Abonnement » (Gratuit / Premium, journalisé), modèle et logo visibles ;
-- Croissance : intérêt pour les modèles premium (compteurs anonymes).

alter table fiila.shops add column if not exists logo bytea;
alter table fiila.shops add column if not exists logo_type text;
alter table fiila.shops add column if not exists plan text not null default 'free';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shops_plan_check') then
    alter table fiila.shops add constraint shops_plan_check check (plan in ('free', 'premium'));
  end if;
end $$;

-- Contrainte du modèle élargie (le nom généré par Postgres pour la contrainte de colonne est retrouvé, pas supposé).
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'fiila.shops'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%theme%' loop
    execute format('alter table fiila.shops drop constraint %I', c);
  end loop;
  alter table fiila.shops add constraint shops_theme_check check (theme in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison'));
end $$;

create or replace function fiila.premium_theme(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') in ('atelier', 'comptoir', 'maison') $$;
-- Modèle affiché : un modèle premium n'est servi qu'aux boutiques Premium.
create or replace function fiila.shown_theme(s fiila.shops) returns text
language sql stable set search_path = '' as $$
  select case when fiila.premium_theme(s.theme) and s.plan <> 'premium' then 'galerie' else s.theme end
$$;

create or replace function fiila.socials_in(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v jsonb := '{}'::jsonb; k text; h text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  foreach k in array array['instagram', 'tiktok', 'snapchat', 'facebook'] loop
    if p ? k then
      if jsonb_typeof(p -> k) not in ('string', 'null') then perform fiila.fail('invalid_social'); end if;
      h := fiila.social_handle(p ->> k);
      if h is not null then v := v || jsonb_build_object(k, h); end if;
    end if;
  end loop;
  return v;
end $$;

create or replace function fiila.social_handle(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p, ''));
begin
  if v = '' then return null; end if;
  v := regexp_replace(v, '^https?://', '', 'i');
  v := regexp_replace(v, '^(www\.|m\.)?(instagram\.com|tiktok\.com|facebook\.com|fb\.com|snapchat\.com/add)/', '', 'i');
  v := regexp_replace(v, '[/?#].*$', '');
  v := regexp_replace(v, '^@', '');
  if v !~ '^[A-Za-z0-9._-]{1,50}$' then perform fiila.fail('invalid_social'); end if;
  return v;
end $$;

do $$
declare v_def text; v_new text;
begin
  -- Réglages de la vitrine : modèles premium contrôlés, logo.
  select pg_get_functiondef('public.fiila_shop_vitrine(text, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$if p ? 'theme' and coalesce(p ->> 'theme', '') not in ('galerie', 'catalogue', 'magazine') then perform fiila.fail('invalid_theme'); end if;$s$,
    $s$if p ? 'theme' and coalesce(p ->> 'theme', '') not in ('galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison') then perform fiila.fail('invalid_theme'); end if;
    if fiila.premium_theme(p ->> 'theme') and s.plan <> 'premium' then perform fiila.fail('premium_required'); end if;$s$);
  v_new := replace(v_new, $s$    -- Photo de couverture : absente = inchangée$s$,
    $s$    -- Logo : absent = inchangé, '' = retiré, base64 = remplacé (petit format : 80 Ko au plus).
    if p ? 'logo' then
      if coalesce(p ->> 'logo', '') = '' then
        update fiila.shops set logo = null, logo_type = null where id = s.id returning * into s;
      else
        select * into v_ph from fiila.photo_in(p ->> 'logo');
        if length(v_ph.data) > 80000 then perform fiila.fail('photo_too_large'); end if;
        update fiila.shops set logo = v_ph.data, logo_type = v_ph.ctype where id = s.id returning * into s;
      end if;
    end if;
    -- Photo de couverture : absente = inchangée$s$);
  v_new := replace(v_new, $s$'theme', s.theme, 'accent', s.accent, 'socials', s.socials,$s$,
    $s$'theme', s.theme, 'shown_theme', fiila.shown_theme(s), 'plan', s.plan, 'accent', s.accent, 'socials', s.socials,
    'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end,$s$);
  if v_new = v_def or v_new !~ 'premium_required' or v_new !~ 'logo_type = v_ph' or v_new !~ 'shown_theme' then raise exception 'vitrine_premium: fiila_shop_vitrine non modifiée'; end if;
  execute v_new;

  -- Vitrine publique : modèle affiché (premium seulement si Premium), logo.
  select pg_get_functiondef('public.fiila_vitrine(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'theme', s.theme, 'accent', s.accent, 'socials'$s$,
    $s$'theme', fiila.shown_theme(s), 'accent', s.accent,
      'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end, 'socials'$s$);
  if v_new = v_def then raise exception 'vitrine_premium: fiila_vitrine non modifiée'; end if;
  execute v_new;

  -- Back-office : abonnement et apparence sur la fiche ; action « set_plan » (droit shops_write), journalisée.
  select pg_get_functiondef('public.fiila_bo_shop(uuid)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'suspended_at', s.suspended_at,$s$,
    $s$    'plan', s.plan, 'theme', s.theme, 'shown_theme', fiila.shown_theme(s), 'has_logo', s.logo is not null,
    'suspended_at', s.suspended_at,$s$);
  if v_new = v_def then raise exception 'vitrine_premium: fiila_bo_shop non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_shop_action(uuid, text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$  elsif p_action = 'set_type' then$s$,
    $s$  elsif p_action = 'set_plan' then
    if v_val is null or v_val not in ('free', 'premium') then perform fiila.fail('invalid_value'); end if;
    update fiila.shops set plan = v_val, updated_at = now() where id = p_id;
  elsif p_action = 'set_type' then$s$);
  if v_new = v_def then raise exception 'vitrine_premium: fiila_bo_shop_action non modifiée'; end if;
  execute v_new;

  -- Mesure anonyme : modèle premium touché (verrouillé), aperçu, demande d'accès.
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'marketing'$s$,
    $s$    or (p_event = 'premium' and p_variant ~ '^(atelier|comptoir|maison):(locked|preview|interest|applied)$')
    or (p_event = 'marketing'$s$);
  if v_new = v_def then raise exception 'vitrine_premium: fiila_track non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'discover_on',$s$, $s$    'premium', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'premium' and day > v_since group by 1) x), '{}'::jsonb),
    'premium_shops', (select count(*)::int from fiila.shops where plan = 'premium'),
    'discover_on',$s$);
  if v_new = v_def then raise exception 'vitrine_premium: fiila_bo_onboarding non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_vitrine(text)', 'public.fiila_shop_vitrine(text, jsonb)', 'public.fiila_bo_shop(uuid)',
                      'public.fiila_bo_shop_action(uuid, text, text)', 'public.fiila_track(text, text)', 'public.fiila_bo_onboarding()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
