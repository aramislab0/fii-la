-- Back-office du modèle Concept fermé à anon (contrôle verify-db du 29/10, run 40953144991) : Supabase accorde anon par
-- défaut à toute nouvelle fonction ; la migration 20261029300000 ne retirait le droit qu'à PUBLIC. Les deux fonctions
-- exigeaient déjà un membre de l'équipe (need_staff) : aucune donnée n'était lisible sans compte.
do $$
declare fn text;
begin
  foreach fn in array array['public.fiila_bo_shop_site(uuid)', 'public.fiila_bo_shop_look(uuid, jsonb)'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', fn); end if;
  end loop;
end $$;
