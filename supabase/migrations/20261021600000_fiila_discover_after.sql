-- Découverte après une action (accueil v2, lot 3 ; proposition validée le 20/10/2026 23:36, A2) : sous la tâche du lien, une
-- seule proposition discrète et masquable + « Voir tous les services ». Contextes : commande (après l'adresse), adresse envoyée
-- à une demande, course de livraison ; « Voir tous les services » aussi sous la découverte des fiches et événements reçus.
-- Réglage discover_after (1 = oui, 0 = rien). Mesure anonyme (vue, suivie, masquée, « tous les services »).
-- Back-office (règle n° 8) : tableau dans Croissance → Parcours d'accueil.

insert into fiila.settings (key, value) values ('discover_after', '1') on conflict (key) do nothing;

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
    when 'onboarding_v2' then array[0, 1]
    when 'discover_after' then array[0, 1] end
$$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'amb_whatsapp', 'onboarding_v2']$s$, $s$'amb_whatsapp', 'onboarding_v2', 'discover_after']$s$);
  if v_new = v_def then raise exception 'discover_after: fiila_bo_settings non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'payment_recorded'$s$, $s$    or (p_event = 'discover' and p_variant ~ '^(order|sent|course|fiche|event):(shown|click|hide|all)$')
    or (p_event = 'payment_recorded'$s$);
  if v_new = v_def then raise exception 'discover_after: fiila_track non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'tasks', jsonb_build_object($s$, $s$    'discover_on', coalesce(fiila.setting_int('discover_after'), 1) = 1,
    'discover', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'discover' and day > v_since group by 1) x), '{}'::jsonb),
    'tasks', jsonb_build_object($s$);
  if v_new = v_def then raise exception 'discover_after: fiila_bo_onboarding non modifiée'; end if;
  execute v_new;
end $$;

create or replace function public.fiila_app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nudges', coalesce(fiila.setting_int('nudges'), 1) = 1,
                            'onboarding', coalesce(fiila.setting_int('onboarding_v2'), 1) = 1,
                            'discover', coalesce(fiila.setting_int('discover_after'), 1) = 1)
$$;
