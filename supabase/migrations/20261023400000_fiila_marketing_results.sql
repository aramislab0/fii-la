-- Marketing v2, « Résultats » premium (fondateur, 23/10/2026 06:05 : « l'affichage des chiffres est trop simple »).
-- fiila_shop_stats ajoute : la série jour par jour de la période (ventes, commandes, visites) pour la courbe,
-- et les nouveaux clients de la période précédente (tendance). Aucune donnée nouvelle : calculs sur les tables existantes.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_shop_stats(text, integer)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'vitrine', jsonb_strip_nulls(jsonb_build_object('public', s.public, 'slug', s.slug)),$s$,
    $s$    'prev_customers', (select count(*) from fiila.customers c where c.shop_id = s.id and c.created_at >= v_prev and c.created_at < v_from),
    'series', (select jsonb_agg(jsonb_build_array(to_char(d.day, 'YYYY-MM-DD'),
        coalesce((select sum(o.total) from fiila.orders o where o.shop_id = s.id and o.status <> 'cancelled' and (o.created_at at time zone 'utc')::date = d.day), 0),
        (select count(*) from fiila.orders o where o.shop_id = s.id and o.status <> 'cancelled' and (o.created_at at time zone 'utc')::date = d.day),
        coalesce((select sum(v.n) from fiila.shop_views v where v.shop_id = s.id and v.day = d.day), 0)) order by d.day)
      from (select (v_today - g)::date as day from generate_series(0, v_days - 1) g) d),
    'vitrine', jsonb_strip_nulls(jsonb_build_object('public', s.public, 'slug', s.slug)),$s$);
  if v_new = v_def then raise exception 'marketing_results: fiila_shop_stats non modifiée'; end if;
  execute v_new;
end $$;

do $$
declare role_name text;
begin
  execute 'revoke execute on function public.fiila_shop_stats(text, integer) from public';
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function public.fiila_shop_stats(text, integer) to %I', role_name); end if;
  end loop;
end $$;
