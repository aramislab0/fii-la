-- Fii Studio : export quotidien vers la base privée Aramis Studio (dépôt XEL, Production/FII_STUDIO/boutiques/<lien>/),
-- décision du fondateur du 27/10/2026 (« chaque boutique qui utilise Fii Studio doit avoir son sous-dossier … pour connaître
-- les habitudes et préférences de chaque boutique »). Résumé par boutique : catégorie, décors demandés et gardés, journal des
-- séries (date, nom de l'article, décor, résultat, coût, durée). Aucune donnée de client final, aucune clé, aucune photo.
-- Appelée uniquement par la fonction serveur fiila-studio-export (clé de service), elle-même protégée par un jeton saisi par le
-- fondateur (STUDIO_EXPORT_TOKEN), partagé avec le flux planifié du dépôt XEL.

create or replace function public.fiila_studio_export(p_days int default 3650) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('generated_at', now(), 'shops', coalesce(jsonb_agg(x order by x ->> 'slug'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'slug', coalesce(s.slug, 'boutique-' || left(s.id::text, 8)),
      'name', s.name,
      'category', coalesce(s.business_type, 'autre'),
      'series', count(j.id),
      'kept', count(j.id) filter (where j.status = 'kept'),
      'cost_usd', coalesce(sum(j.cost_usd), 0),
      'styles', (select jsonb_object_agg(style, jsonb_build_object('series', n, 'kept', k)) from (
          select style, count(*) n, count(*) filter (where status = 'kept') k from fiila.studio_jobs where shop_id = s.id group by style) z),
      'journal', (select coalesce(jsonb_agg(jsonb_build_object('at', jj.created_at, 'product', p.name, 'style', jj.style, 'version', jj.scene_version,
            'status', jj.status, 'kept', jj.kept, 'cost_usd', jj.cost_usd,
            'seconds', case when jj.done_at is not null then round(extract(epoch from jj.done_at - jj.created_at)) end, 'error', jj.error)
          order by jj.created_at desc), '[]'::jsonb)
        from fiila.studio_jobs jj join fiila.products p on p.id = jj.product_id
        where jj.shop_id = s.id and jj.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 3650), 3650))))
    ) x
    from fiila.shops s join fiila.studio_jobs j on j.shop_id = s.id
    group by s.id
  ) t
$$;

do $$
declare role_name text;
begin
  execute 'revoke execute on function public.fiila_studio_export(int) from public';
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function public.fiila_studio_export(int) from %I', role_name); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.fiila_studio_export(int) to service_role'; end if;
end $$;
