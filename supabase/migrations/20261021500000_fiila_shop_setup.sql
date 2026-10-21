-- Démarrage guidé de la boutique (accueil v2, lot 2 ; proposition validée le 20/10/2026 23:36) : 1. nom et type,
-- 2. premier article (ou « Plus tard »), 3. aperçu, ouverture de la vitrine, partage. Mesure anonyme de chaque étape
-- (compteurs par jour, sans identifiant). Back-office (règle n° 8) : entonnoir du démarrage dans « Parcours d'accueil ».

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'payment_recorded'$s$, $s$    or (p_event = 'shop_setup' and p_variant in ('name:done', 'product:done', 'product:skip', 'vitrine:open', 'share:click', 'resume:open'))
    or (p_event = 'payment_recorded'$s$);
  if v_new = v_def then raise exception 'shop_setup: fiila_track non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'tasks', jsonb_build_object($s$, $s$    'setup', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'shop_setup' and day > v_since group by 1) x), '{}'::jsonb),
    'tasks', jsonb_build_object($s$);
  if v_new = v_def then raise exception 'shop_setup: fiila_bo_onboarding non modifiée'; end if;
  execute v_new;
end $$;
