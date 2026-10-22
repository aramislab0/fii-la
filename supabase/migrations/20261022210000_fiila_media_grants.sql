-- Correctif du 22/10/2026 : sur Supabase, toute nouvelle fonction du schéma public reçoit par défaut le droit d'exécution
-- pour anon et authenticated (privilèges par défaut), en plus de PUBLIC. La migration 20261022200000 ne retirait que PUBLIC :
-- les fonctions de la file de copie des photos étaient appelables sans clé de service pendant ~15 minutes (détecté par le
-- contrôle de la base en CI ; aucun appel extérieur constaté dans le journal). Elles sont réservées à la clé de service.
-- Appliqué aussitôt en production (MCP), puis ici pour que le dépôt reste la référence.
do $$
declare fn text; role_name text;
  svc_fns text[] := array['public.fiila_media_pending(int)', 'public.fiila_media_done(text, text, text, text, int)',
                          'public.fiila_media_orphans(int)', 'public.fiila_media_forget(jsonb)', 'public.fiila_media_report(text, text, text)'];
begin
  foreach fn in array svc_fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function %s from %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
