-- Marketing v2 (fondateur, 23/10/2026 05:23 : « pour faire mes posts sur Instagram je ne pouvais pas deviner ; l'écran
-- pour choisir la nature du post est illisible »). Feuille « Publier » à deux formats. Mesure anonyme ajoutée :
-- marketing × publish:(open|post|story|shared|saved). Lue par le back-office (Croissance → Ma boutique et Marketing).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$|publish:click|vitrine:open)$')$s$, $s$|publish:(click|open|post|story|shared|saved)|vitrine:open)$')$s$);
  if v_new = v_def then raise exception 'marketing_publish: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

do $$
declare role_name text;
begin
  execute 'revoke execute on function public.fiila_track(text, text) from public';
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function public.fiila_track(text, text) to %I', role_name); end if;
  end loop;
end $$;
