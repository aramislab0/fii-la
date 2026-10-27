-- Réglages et Fii Studio v2 (fondateur, 27/10/2026 : « Oui, construis la refonte Réglages et Studio comme dans la
-- maquette » ; HANDOFF #77, artefact T3zFpNLrgCYn5gjaNkwoJi). Écrans seulement : aucune donnée nouvelle.
-- Mesures anonymes (compteurs par jour, sans identifiant) pour suivre l'usage des nouveaux écrans au back-office :
--   settings_ui : bouton de la carte « presque prête » (par étape), tuiles touchées, « Partager mon site » ;
--   studio_ui   : mode choisi, comparaison avant / après utilisée, « Publier sur mes réseaux », « Terminé ».
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'migrate'$s$, $s$    or (p_event = 'settings_ui' and p_variant ~ '^(cta:(site|product|logo|cover|policies|owner)|tile:(info|policies|team|courier|identity|agent)|share)$')
    or (p_event = 'studio_ui' and p_variant in ('mode:fidele', 'mode:premium', 'compare', 'publish', 'finish'))
    or (p_event = 'migrate'$s$);
  if v_new = v_def then raise exception 'settings_studio_v2: fiila_track non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'discover_on',$s$, $s$    'settings_ui', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'settings_ui' and day > v_since group by 1) x), '{}'::jsonb),
    'studio_ui', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'studio_ui' and day > v_since group by 1) x), '{}'::jsonb),
    'discover_on',$s$);
  if v_new = v_def then raise exception 'settings_studio_v2: fiila_bo_onboarding non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_track(text, text)', 'public.fiila_bo_onboarding()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
