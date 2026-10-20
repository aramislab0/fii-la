-- Découverte progressive (fondateur, 20/10/2026 06:59) : suggestions discrètes dans l'application, une à la fois, selon l'usage.
-- Mesure anonyme (compteurs par jour : affichée, suivie, « plus tard ») ; réglage nudges (0 = aucune suggestion).
-- Back-office (règle n° 8) : taux de suivi de chaque suggestion sur 30 jours, dans « Croissance ».

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'payment_recorded'$s$, $s$    or (p_event = 'nudge' and p_variant ~ '^[a-z_]{3,30}:(shown|click|dismiss)$')
    or (p_event = 'payment_recorded'$s$);
  if v_new = v_def then raise exception 'nudges: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

-- Réglages publics de l'application (aucune donnée personnelle).
create or replace function public.fiila_app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nudges', coalesce(fiila.setting_int('nudges'), 1) = 1)
$$;

create or replace function public.fiila_bo_nudges() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('dashboard');
begin
  return jsonb_build_object('on', coalesce(fiila.setting_int('nudges'), 1) = 1,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'shown', shown, 'click', click, 'dismiss', dismiss) order by shown desc) from (
      select split_part(variant, ':', 1) id,
             sum(n) filter (where split_part(variant, ':', 2) = 'shown') shown,
             coalesce(sum(n) filter (where split_part(variant, ':', 2) = 'click'), 0) click,
             coalesce(sum(n) filter (where split_part(variant, ':', 2) = 'dismiss'), 0) dismiss
        from fiila.metrics where event = 'nudge' and day > (now() at time zone 'utc')::date - 30 group by 1) x where shown > 0), '[]'::jsonb));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_track(text, text)', 'public.fiila_app_flags()', 'public.fiila_bo_nudges()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
