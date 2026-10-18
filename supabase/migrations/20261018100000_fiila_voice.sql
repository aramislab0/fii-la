-- Fii La : repère vocal (fondateur, 18/10/2026 21:18 : « ajoute le repère vocal »).
-- L'expéditeur enregistre au plus 30 secondes (par exemple en wolof) ; la personne qui reçoit le lien,
-- ou le livreur de la course, l'écoute. L'audio n'est chargé qu'à la demande (fonction dédiée),
-- jamais avec la fiche : la page reçue reste légère.

alter table fiila.places add column voice bytea, add column voice_type text, add column voice_secs smallint;
alter table fiila.places add constraint places_voice_size check (voice is null or length(voice) <= 400000);

-- Contrôle du fichier : taille, et format reconnu par sa signature (pas par ce que dit le client).
create or replace function fiila.voice_in(p_b64 text, out data bytea, out ctype text)
language plpgsql immutable set search_path = '' as $$
begin
  data := null; ctype := null;
  if p_b64 is null or p_b64 = '' then return; end if;
  if char_length(p_b64) > 540000 then perform fiila.fail('voice_too_large'); end if;
  begin
    data := decode(p_b64, 'base64');
  exception when others then
    perform fiila.fail('voice_invalid');
  end;
  if length(data) > 400000 then perform fiila.fail('voice_too_large'); end if;
  if length(data) < 200 then perform fiila.fail('voice_invalid'); end if;
  if substring(data from 1 for 4) = '\x1a45dfa3'::bytea then ctype := 'audio/webm';
  elsif substring(data from 1 for 4) = '\x4f676753'::bytea then ctype := 'audio/ogg';
  elsif substring(data from 5 for 4) = '\x66747970'::bytea then ctype := 'audio/mp4';
  elsif substring(data from 1 for 3) = '\x494433'::bytea or get_byte(data, 0) = 255 then ctype := 'audio/mpeg';
  elsif substring(data from 1 for 4) = '\x52494646'::bytea and substring(data from 9 for 4) = '\x57415645'::bytea then ctype := 'audio/wav';
  else perform fiila.fail('voice_invalid');
  end if;
end $$;

-- Fiche : on signale seulement qu'un repère vocal existe (et sa durée).
create or replace function fiila.place_json(r fiila.places, p_owner_view boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind',        r.kind,
    'label',       r.label,
    'locality',    r.locality,
    'instruction', r.instruction,
    'entry',       jsonb_build_object('lat', r.entry_lat, 'lng', r.entry_lng),
    'vehicle_ok',  r.vehicle_ok,
    'stop',        case when r.stop_lat is not null then jsonb_build_object('lat', r.stop_lat, 'lng', r.stop_lng) end,
    'walk',        r.walk,
    'photo',       case when r.photo is not null
                        then 'data:' || r.photo_type || ';base64,' || replace(encode(r.photo, 'base64'), E'\n', '') end,
    'has_voice',   case when r.voice is not null then true end,
    'voice_secs',  case when r.voice is not null then r.voice_secs end,
    'starts_at',   r.starts_at,
    'expires_at',  r.expires_at,
    'updated_at',  r.updated_at
  ) || case when p_owner_view then jsonb_build_object(
    'id',          r.id,
    'share_token', r.share_token,
    'status',      r.status,
    'entry_acc',   r.entry_acc,
    'created_at',  r.created_at,
    'tag',         r.tag,
    'account',     r.user_id is not null
  ) else '{}'::jsonb end)
$$;

-- Liste « Mes adresses » : le lien de partage (le propriétaire l'a déjà) pour « Envoyer » et « Copier ».
create or replace function fiila.place_summary(r fiila.places) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'type', 'place', 'id', r.id, 'kind', r.kind, 'label', r.label, 'locality', r.locality,
    'status', r.status, 'starts_at', r.starts_at, 'expires_at', r.expires_at,
    'expired', r.kind = 'meeting' and r.expires_at < now(), 'tag', r.tag,
    'share_token', case when r.status = 'active' then r.share_token end,
    'account', r.user_id is not null, 'updated_at', r.updated_at))
$$;

-- Enregistrer, remplacer ou retirer ('' ) le repère vocal d'une fiche (clé de gestion ou compte).
create or replace function public.fiila_voice_set(p_id text, p_owner text, p_voice text, p_secs integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places := fiila.owned_place(p_id, p_owner); v record;
begin
  perform fiila.rate_check('voice_set', 60);
  if p_voice is null or p_voice = '' then
    update fiila.places set voice = null, voice_type = null, voice_secs = null, updated_at = now() where id = r.id;
    return jsonb_build_object('has_voice', false);
  end if;
  select * into v from fiila.voice_in(p_voice);
  update fiila.places set voice = v.data, voice_type = v.ctype,
    voice_secs = greatest(1, least(coalesce(p_secs, 0), 30)), updated_at = now() where id = r.id;
  return jsonb_build_object('has_voice', true, 'voice_secs', greatest(1, least(coalesce(p_secs, 0), 30)));
end $$;

-- Écouter : avec le lien de la fiche (destinataire, propriétaire) ou le lien de course (livreur).
-- Mêmes règles que la fiche : lien actif, rendez-vous non expiré, course non terminée.
create or replace function public.fiila_voice(p_token text, p_via text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places; t fiila.trackers;
begin
  perform fiila.read_check();
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  if p_via = 'course' then
    select * into t from fiila.trackers where send_hash = fiila.h(p_token) and kind = 'courier';
    if not found or t.expires_at < now() or t.status = 'stopped' then return jsonb_build_object('state', 'not_found'); end if;
    select * into r from fiila.places where id = t.place_id;
  else
    select * into r from fiila.places where share_token = p_token;
  end if;
  if r.id is null or r.status <> 'active' or (r.kind = 'meeting' and r.expires_at <= now()) or r.voice is null then
    return jsonb_build_object('state', 'not_found');
  end if;
  return jsonb_build_object('state', 'ok', 'secs', r.voice_secs,
    'voice', 'data:' || r.voice_type || ';base64,' || replace(encode(r.voice, 'base64'), E'\n', ''));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_voice_set(text, text, text, integer)', 'public.fiila_voice(text, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('grant execute on function %s to %I', fn, role_name);
      end if;
    end loop;
  end loop;
end $$;
