-- Cartes WhatsApp, suite (fondateur, 22/10/2026 02:24 : « le visuel qu'on avait fait ne s'affiche pas » après des envois
-- d'adresse et d'événement — seules les demandes d'adresse portaient une carte).
-- 1) Mesure anonyme du partage étendue aux cartes adresse, événement et vitrine (mêmes actions : file, text, download, failed).
-- 2) Registre : l'invitation à un événement passe en pilote de partage manuel avec sa carte (rien n'est soumis à Meta).
-- Back-office : Croissance → Messages WhatsApp (mesures par carte, aperçu de chaque carte).

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$p_variant ~ '^(request|invite|agent|order|delivery|event):(file|text|download|failed)$'$s$,
    $s$p_variant ~ '^(request|address|vitrine|invite|agent|order|delivery|event):(file|text|download|failed)$'$s$);
  if v_new = v_def then raise exception 'wa_cards_more: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

update fiila.wa_templates set integration = 'MANUAL_PILOT', media = 'media/wa/evenement.jpg', updated_at = now()
 where id = 'fiila_event_invite_v1' and integration = 'TO_IMPLEMENT';

revoke execute on function public.fiila_track(text, text) from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function public.fiila_track(text, text) to %I', role_name); end if;
  end loop;
end $$;
