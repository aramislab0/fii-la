-- Application mobile Android et iPhone (fondateur, 26/10/2026 ; docs/PLAN-APP-MOBILE.md).
-- Mesure anonyme : ouverture de l'app par plateforme (« app » : android | ios), lue dans le back-office (Croissance).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'migrate'$s$, $s$    or (p_event = 'app' and p_variant in ('android', 'ios'))
    or (p_event = 'migrate'$s$);
  if v_new = v_def then raise exception 'app_mobile: fiila_track non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'discover_on',$s$, $s$    'app_opens', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'app' and day > v_since group by 1) x), '{}'::jsonb),
    'discover_on',$s$);
  if v_new = v_def then raise exception 'app_mobile: fiila_bo_onboarding non modifiée'; end if;
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
