-- UX-ADAPTATIVE-001 (avis du Builder v1.1 validé par le fondateur le 22/10/2026 21:11).
-- L'adaptation se fait sur le téléphone : aucune donnée personnelle nouvelle au serveur. Ici :
-- 1) réglage adaptive_home (1 = l'accueil apprend des réussites ; 0 = règle d'avant), lu par l'application ;
-- 2) mesure anonyme : home_hero × service × (shown, click, success) ; home_pref × (pin, unpin, reset) ;
--    resume × (order, product) × (shown, click, success) ;
-- 3) back-office Croissance → Parcours d'accueil : état, version des paramètres, compteurs sur 30 jours.

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$when 'sugg_shop_team' then array[0, 1] end$s$, $s$when 'sugg_shop_team' then array[0, 1]
    when 'adaptive_home' then array[0, 1] end$s$);
  if v_new = v_def then raise exception 'adaptive: bo_setting_bounds non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'sugg_shop_photos', 'sugg_shop_team']$s$, $s$'sugg_shop_photos', 'sugg_shop_team', 'adaptive_home']$s$);
  if v_new = v_def then raise exception 'adaptive: fiila_bo_settings non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'retention'$s$,
    $s$    or (p_event = 'home_hero' and p_variant ~ '^(adresse|demander|evenement|livreur|vide_dressing|ambassadeur):(shown|click|success)$')
    or (p_event = 'home_pref' and p_variant in ('pin', 'unpin', 'reset'))
    or (p_event = 'resume' and p_variant ~ '^(order|product):(shown|click|success)$')
    or (p_event = 'retention'$s$);
  if v_new = v_def then raise exception 'adaptive: fiila_track non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'discover_on',$s$, $s$    'adaptive', jsonb_build_object('on', coalesce(fiila.setting_int('adaptive_home'), 1) = 1, 'version', 'adaptive_v1',
      'hero', coalesce((select jsonb_object_agg(variant, n) from (select variant, sum(n)::int n from fiila.metrics
                 where event = 'home_hero' and day > v_since group by 1) x), '{}'::jsonb),
      'pref', coalesce((select jsonb_object_agg(variant, n) from (select variant, sum(n)::int n from fiila.metrics
                 where event = 'home_pref' and day > v_since group by 1) x), '{}'::jsonb),
      'resume', coalesce((select jsonb_object_agg(variant, n) from (select variant, sum(n)::int n from fiila.metrics
                 where event = 'resume' and day > v_since group by 1) x), '{}'::jsonb)),
    'discover_on',$s$);
  if v_new = v_def then raise exception 'adaptive: fiila_bo_onboarding non modifiée'; end if;
  execute v_new;
end $$;

create or replace function public.fiila_app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nudges', coalesce(fiila.setting_int('nudges'), 1) = 1,
                            'onboarding', coalesce(fiila.setting_int('onboarding_v2'), 1) = 1,
                            'discover', coalesce(fiila.setting_int('discover_after'), 1) = 1,
                            'wa_card', coalesce(fiila.setting_int('wa_card_media'), 1) = 1,
                            'adaptive', coalesce(fiila.setting_int('adaptive_home'), 1) = 1,
                            'sugg_off', coalesce((select jsonb_agg(k) from unnest(array['home_shop', 'shop_more_products', 'shop_share_vitrine', 'shop_courier', 'shop_photos', 'shop_team']) k
                                                   where coalesce(fiila.setting_int('sugg_' || k), 1) = 0), '[]'::jsonb))
$$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_app_flags()', 'public.fiila_bo_settings()', 'public.fiila_track(text, text)', 'public.fiila_bo_onboarding()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
