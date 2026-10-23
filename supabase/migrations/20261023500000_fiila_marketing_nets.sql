-- Publier v3 (fondateur, 23/10/2026 08:36) : une carte par article avec les logos des réseaux. Mesure anonyme du réseau
-- touché : marketing × publish:(instagram|facebook|whatsapp|tiktok|snapchat). Lue par le back-office.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$|publish:(click|open|post|story|shared|saved)|$s$, $s$|publish:(click|open|post|story|shared|saved|instagram|facebook|whatsapp|tiktok|snapchat)|$s$);
  if v_new = v_def then raise exception 'marketing_nets: fiila_track non modifiée'; end if;
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
