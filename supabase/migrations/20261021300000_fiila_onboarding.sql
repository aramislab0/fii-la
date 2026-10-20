-- Parcours d'accueil v2 (proposition validée par le fondateur le 20/10/2026 23:36, docs/PROPOSITION-ONBOARDING.md).
-- Accueil léger : action principale, mes activités, « Découvrir les services ». Réglage onboarding_v2 (1 = nouvel accueil,
-- 0 = ancien accueil, sans redéploiement). Mesure anonyme (compteurs par jour, sans identifiant) des gestes de découverte.
-- Back-office (règle n° 8) : rubrique « Parcours d'accueil » dans Croissance — gestes et tâches réussies sur 30 jours.

insert into fiila.settings (key, value) values ('onboarding_v2', '1') on conflict (key) do nothing;

create or replace function fiila.bo_setting_bounds(p_key text) returns int[]
language sql immutable set search_path = '' as $$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1]
    when 'amb_manager_llm' then array[0, 1]
    when 'nudges' then array[0, 1]
    when 'amb_whatsapp' then array[0, 1]
    when 'onboarding_v2' then array[0, 1] end
$$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'nudges', 'amb_whatsapp']$s$, $s$'nudges', 'amb_whatsapp', 'onboarding_v2']$s$);
  if v_new = v_def then raise exception 'onboarding: fiila_bo_settings non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'payment_recorded'$s$, $s$    or (p_event = 'onboarding' and p_variant ~ '^[a-z_]{3,30}:(open|click|hide)$')
    or (p_event = 'payment_recorded'$s$);
  if v_new = v_def then raise exception 'onboarding: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

create or replace function public.fiila_app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nudges', coalesce(fiila.setting_int('nudges'), 1) = 1,
                            'onboarding', coalesce(fiila.setting_int('onboarding_v2'), 1) = 1)
$$;

-- Back-office : gestes de découverte (30 jours) et tâches réussies sur la même période (compteurs existants).
create or replace function public.fiila_bo_onboarding() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('dashboard'); v_since date := (now() at time zone 'utc')::date - 30;
begin
  return jsonb_build_object('on', coalesce(fiila.setting_int('onboarding_v2'), 1) = 1,
    'gestures', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'onboarding' and day > v_since group by 1) x), '{}'::jsonb),
    'tasks', jsonb_build_object(
      'address', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'fiche_created' and variant like 'address%' and day > v_since),
      'meeting', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'fiche_created' and variant like 'meeting%' and day > v_since),
      'request', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'request_created' and day > v_since),
      'shop', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'shop_created' and day > v_since),
      'product', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'product_created' and day > v_since),
      'order', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'order_created' and day > v_since),
      'courier', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'courier_registered' and day > v_since)));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_track(text, text)', 'public.fiila_app_flags()', 'public.fiila_bo_onboarding()', 'public.fiila_bo_settings()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
