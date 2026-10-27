-- Fii Édition V1 : `fiila_bo_shop_sheet` (back-office) reste exécutable par anon en production — droits par défaut de
-- Supabase sur les nouvelles fonctions du schéma public (HANDOFF §6). La fonction refusait déjà tout appel hors équipe
-- (`need_staff`) ; le contrôle `verify-db` de la CI l'a signalé. Révocation explicite, équipe connectée seulement.
revoke execute on function public.fiila_bo_shop_sheet(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.fiila_bo_shop_sheet(uuid) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.fiila_bo_shop_sheet(uuid) to authenticated'; end if;
end $$;
