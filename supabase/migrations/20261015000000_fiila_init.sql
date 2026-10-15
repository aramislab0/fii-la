-- Fii La — schéma initial
-- Toutes les données vivent dans le schéma privé `fiila`, jamais exposé par l'API.
-- Le client n'accède qu'à des fonctions `public.fiila_*` (security definer) qui
-- vérifient les jetons, valident les entrées et appliquent révocation et expiration.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists fiila;
revoke all on schema fiila from public;

-- ---------------------------------------------------------------- tables
create table fiila.settings (
  key   text primary key,
  value text not null
);

create table fiila.places (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('address', 'meeting')),
  share_token  text not null unique,
  owner_hash   bytea not null,
  status       text not null default 'active' check (status in ('active', 'revoked')),
  label        text not null,
  locality     text,
  instruction  text,
  entry_lat    double precision not null,
  entry_lng    double precision not null,
  entry_acc    real,
  vehicle_ok   boolean not null default true,
  stop_lat     double precision,
  stop_lng     double precision,
  walk         text,
  photo        bytea,
  photo_type   text,
  starts_at    timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table fiila.retired_tokens (
  token      text primary key,
  retired_at timestamptz not null default now()
);

create table fiila.requests (
  id             uuid primary key default gen_random_uuid(),
  share_token    text not null unique,
  owner_hash     bytea not null,
  requester_name text not null,
  purpose        text not null,
  order_ref      text,
  place_id       uuid references fiila.places (id) on delete set null,
  fulfilled_at   timestamptz,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create table fiila.rate_events (
  id     bigserial primary key,
  bucket text not null,
  action text not null,
  at     timestamptz not null default now()
);
create index rate_events_lookup on fiila.rate_events (bucket, action, at);

revoke all on all tables in schema fiila from public;
revoke all on all sequences in schema fiila from public;

-- ---------------------------------------------------------------- helpers (internal)
create or replace function fiila.fail(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'fiila:%', p_code using errcode = 'P0001';
end $$;

create or replace function fiila.token(p_bytes int) returns text
language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '='), '+/', '-_')
$$;

create or replace function fiila.h(p_text text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(coalesce(p_text, ''), 'sha256')
$$;

insert into fiila.settings (key, value) values ('rate_salt', fiila.token(24))
on conflict (key) do nothing;

-- Nettoie un texte libre : retire les caractères de contrôle, borne la longueur.
create or replace function fiila.clean(p_text text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare r text;
begin
  if p_text is null then return null; end if;
  r := btrim(regexp_replace(p_text, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  r := replace(r, chr(13), '');
  if r = '' then return null; end if;
  if char_length(r) > p_max then perform fiila.fail('too_long'); end if;
  return r;
end $$;

create or replace function fiila.num(p_text text) returns double precision
language plpgsql immutable set search_path = '' as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  return p_text::double precision;
exception when others then
  perform fiila.fail('invalid_number');
  return null;
end $$;

create or replace function fiila.as_uuid(p_text text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end $$;

create or replace function fiila.as_ts(p_text text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  return p_text::timestamptz;
exception when others then
  perform fiila.fail('invalid_date');
  return null;
end $$;

create or replace function fiila.valid_token(p_token text) returns boolean
language sql immutable set search_path = '' as $$
  select p_token is not null and p_token ~ '^[A-Za-z0-9_-]{16,64}$'
$$;

-- Vérifie un point géographique.
create or replace function fiila.check_point(p_lat double precision, p_lng double precision) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_lat is null or p_lng is null then perform fiila.fail('point_required'); end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then perform fiila.fail('point_invalid'); end if;
  if abs(p_lat) < 0.0001 and abs(p_lng) < 0.0001 then perform fiila.fail('point_invalid'); end if;
end $$;

-- Décode et contrôle une photo envoyée en base64 (sans préfixe data:).
-- Refuse ce qui n'est pas un JPEG, PNG ou WebP, ce qui est trop lourd,
-- et toute image qui contient encore un bloc de métadonnées EXIF.
create or replace function fiila.photo_in(p_b64 text, out data bytea, out ctype text)
language plpgsql immutable set search_path = '' as $$
begin
  data := null; ctype := null;
  if p_b64 is null or p_b64 = '' then return; end if;
  if char_length(p_b64) > 560000 then perform fiila.fail('photo_too_large'); end if;
  begin
    data := decode(p_b64, 'base64');
  exception when others then
    perform fiila.fail('photo_invalid');
  end;
  if length(data) > 400000 then perform fiila.fail('photo_too_large'); end if;
  if length(data) < 100 then perform fiila.fail('photo_invalid'); end if;
  if substring(data from 1 for 3) = '\xffd8ff'::bytea then
    ctype := 'image/jpeg';
    if position('\x457869660000'::bytea in data) > 0 then perform fiila.fail('photo_metadata'); end if;
  elsif substring(data from 1 for 8) = '\x89504e470d0a1a0a'::bytea then
    ctype := 'image/png';
    if position('\x65584966'::bytea in data) > 0 then perform fiila.fail('photo_metadata'); end if;
  elsif substring(data from 1 for 4) = '\x52494646'::bytea and substring(data from 9 for 4) = '\x57454250'::bytea then
    ctype := 'image/webp';
    if position('\x45584946'::bytea in data) > 0 then perform fiila.fail('photo_metadata'); end if;
  else
    perform fiila.fail('photo_invalid');
  end if;
end $$;

-- Limitation simple des créations par adresse IP (hachée et salée, gardée 24 h).
create or replace function fiila.rate_check(p_action text, p_max int) returns void
language plpgsql set search_path = '' as $$
declare
  v_headers json;
  v_ip text := '';
  v_bucket text;
  v_n int;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_ip := coalesce(v_headers ->> 'cf-connecting-ip',
                     split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '');
  exception when others then
    v_ip := '';
  end;
  v_bucket := encode(extensions.digest(
    (select value from fiila.settings where key = 'rate_salt') || ':' || coalesce(nullif(btrim(v_ip), ''), 'unknown'),
    'sha256'), 'hex');
  delete from fiila.rate_events where at < now() - interval '1 day';
  select count(*) into v_n from fiila.rate_events
   where bucket = v_bucket and action = p_action and at > now() - interval '1 hour';
  if v_n >= p_max then perform fiila.fail('rate_limited'); end if;
  insert into fiila.rate_events (bucket, action) values (v_bucket, p_action);
end $$;

-- Ménage : rendez-vous expirés depuis 30 jours, demandes expirées depuis 30 jours.
create or replace function fiila.housekeeping() returns void
language sql set search_path = '' as $$
  delete from fiila.places where kind = 'meeting' and expires_at < now() - interval '30 days';
  delete from fiila.requests where expires_at < now() - interval '30 days';
  delete from fiila.retired_tokens where retired_at < now() - interval '180 days';
$$;

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
    'starts_at',   r.starts_at,
    'expires_at',  r.expires_at,
    'updated_at',  r.updated_at
  ) || case when p_owner_view then jsonb_build_object(
    'id',          r.id,
    'share_token', r.share_token,
    'status',      r.status,
    'entry_acc',   r.entry_acc,
    'created_at',  r.created_at
  ) else '{}'::jsonb end)
$$;

-- Écrit tous les champs modifiables d'un lieu à partir d'un objet JSON validé.
create or replace function fiila.write_place(p_id uuid, p jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  r          fiila.places;
  v_label    text;
  v_locality text;
  v_instr    text;
  v_walk     text;
  v_lat      double precision;
  v_lng      double precision;
  v_acc      double precision;
  v_vehicle  boolean;
  v_slat     double precision;
  v_slng     double precision;
  v_photo    bytea;
  v_ptype    text;
  v_starts   timestamptz;
  v_expires  timestamptz;
begin
  select * into r from fiila.places where id = p_id for update;
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;

  v_label    := fiila.clean(p ->> 'label', 60);
  v_locality := fiila.clean(p ->> 'locality', 60);
  v_instr    := fiila.clean(p ->> 'instruction', 280);
  v_walk     := fiila.clean(p ->> 'walk', 200);
  if v_label is null then perform fiila.fail('label_required'); end if;

  v_lat := fiila.num(p -> 'entry' ->> 'lat');
  v_lng := fiila.num(p -> 'entry' ->> 'lng');
  perform fiila.check_point(v_lat, v_lng);
  v_acc := fiila.num(p -> 'entry' ->> 'acc');
  if v_acc is not null and (v_acc < 0 or v_acc > 100000) then v_acc := null; end if;

  v_vehicle := coalesce((p ->> 'vehicle_ok') = 'true', true);
  if p ? 'vehicle_ok' and jsonb_typeof(p -> 'vehicle_ok') = 'boolean' then
    v_vehicle := (p ->> 'vehicle_ok')::boolean;
  end if;
  if v_vehicle then
    v_slat := null; v_slng := null; v_walk := null;
  else
    v_slat := fiila.num(p -> 'stop' ->> 'lat');
    v_slng := fiila.num(p -> 'stop' ->> 'lng');
    if v_slat is null or v_slng is null then perform fiila.fail('stop_required'); end if;
    perform fiila.check_point(v_slat, v_slng);
  end if;

  if p ? 'photo' then
    select x.data, x.ctype into v_photo, v_ptype from fiila.photo_in(p ->> 'photo') x;
  else
    v_photo := r.photo; v_ptype := r.photo_type;
  end if;

  if r.kind = 'address' then
    if v_photo is null and v_instr is null then perform fiila.fail('photo_or_instruction_required'); end if;
    v_starts := null; v_expires := null;
  else
    v_starts  := fiila.as_ts(p ->> 'starts_at');
    v_expires := fiila.as_ts(p ->> 'expires_at');
    if v_starts is null or v_expires is null then perform fiila.fail('date_required'); end if;
    if v_expires <= v_starts then perform fiila.fail('expiry_before_start'); end if;
    if v_expires > v_starts + interval '31 days' then perform fiila.fail('expiry_too_far'); end if;
    if v_expires <= now() then perform fiila.fail('expiry_in_past'); end if;
    if v_starts > now() + interval '366 days' then perform fiila.fail('start_too_far'); end if;
  end if;

  update fiila.places set
    label = v_label, locality = v_locality, instruction = v_instr,
    entry_lat = v_lat, entry_lng = v_lng, entry_acc = v_acc,
    vehicle_ok = v_vehicle, stop_lat = v_slat, stop_lng = v_slng, walk = v_walk,
    photo = v_photo, photo_type = v_ptype,
    starts_at = v_starts, expires_at = v_expires,
    updated_at = now()
  where id = p_id;
end $$;

-- Retourne le lieu si le jeton propriétaire correspond, sinon échoue sans dire pourquoi.
create or replace function fiila.owned_place(p_id text, p_owner text) returns fiila.places
language plpgsql set search_path = '' as $$
declare r fiila.places; v_id uuid := fiila.as_uuid(p_id);
begin
  if v_id is null or p_owner is null or char_length(p_owner) > 100 then perform fiila.fail('not_found'); end if;
  select * into r from fiila.places where id = v_id and owner_hash = fiila.h(p_owner) for update;
  if not found then perform fiila.fail('not_found'); end if;
  return r;
end $$;

create or replace function fiila.owned_request(p_id text, p_owner text) returns fiila.requests
language plpgsql set search_path = '' as $$
declare r fiila.requests; v_id uuid := fiila.as_uuid(p_id);
begin
  if v_id is null or p_owner is null or char_length(p_owner) > 100 then perform fiila.fail('not_found'); end if;
  select * into r from fiila.requests where id = v_id and owner_hash = fiila.h(p_owner) for update;
  if not found then perform fiila.fail('not_found'); end if;
  return r;
end $$;

-- ---------------------------------------------------------------- API publique (RPC)
-- Chaque fonction est volatile : PostgREST n'accepte alors que POST,
-- donc jetons et contenus ne passent jamais dans une URL ni dans les journaux d'accès.

create or replace function public.fiila_create_place(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_owner text; v_share text; v_id uuid;
begin
  perform fiila.rate_check('create_place', 40);
  perform fiila.housekeeping();
  v_kind := coalesce(p ->> 'kind', 'address');
  if v_kind not in ('address', 'meeting') then perform fiila.fail('invalid_kind'); end if;
  v_owner := fiila.token(32);
  v_share := fiila.token(16);
  insert into fiila.places (kind, share_token, owner_hash, label, entry_lat, entry_lng)
  values (v_kind, v_share, fiila.h(v_owner), '', 0, 0)
  returning id into v_id;
  perform fiila.write_place(v_id, p);
  return jsonb_build_object('id', v_id, 'share_token', v_share, 'owner_token', v_owner);
end $$;

create or replace function public.fiila_update_place(p_id text, p_owner text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  perform fiila.write_place(r.id, p);
  select * into r from fiila.places where id = r.id;
  return fiila.place_json(r, true);
end $$;

create or replace function public.fiila_get_owned(p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  return fiila.place_json(r, true);
end $$;

-- Résumés légers pour la liste « Mes adresses » (sans photo).
create or replace function public.fiila_owned_summaries(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; r fiila.places; q fiila.requests; v_out jsonb := '[]'::jsonb; v_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return v_out; end if;
  if jsonb_array_length(p_items) > 200 then perform fiila.fail('too_many'); end if;
  for item in select * from jsonb_array_elements(p_items) loop
    v_id := fiila.as_uuid(item ->> 'id');
    if v_id is null then continue; end if;
    if coalesce(item ->> 'type', 'place') = 'request' then
      select * into q from fiila.requests where id = v_id and owner_hash = fiila.h(item ->> 'owner');
      if found then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'type', 'request', 'id', q.id, 'requester_name', q.requester_name, 'purpose', q.purpose,
          'state', case when q.fulfilled_at is not null then 'fulfilled'
                        when q.expires_at < now() then 'expired' else 'pending' end,
          'created_at', q.created_at));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'request', 'id', v_id, 'missing', true));
      end if;
    else
      select * into r from fiila.places where id = v_id and owner_hash = fiila.h(item ->> 'owner');
      if found then
        v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'type', 'place', 'id', r.id, 'kind', r.kind, 'label', r.label, 'locality', r.locality,
          'status', r.status, 'starts_at', r.starts_at, 'expires_at', r.expires_at,
          'expired', r.kind = 'meeting' and r.expires_at < now(),
          'updated_at', r.updated_at)));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'place', 'id', v_id, 'missing', true));
      end if;
    end if;
  end loop;
  return v_out;
end $$;

create or replace function public.fiila_revoke_place(p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  update fiila.places set status = 'revoked', updated_at = now() where id = r.id;
  select * into r from fiila.places where id = r.id;
  return fiila.place_json(r, true);
end $$;

-- Remplace le lien public : l'ancien jeton reste inactif (« remplacé »).
create or replace function public.fiila_new_link(p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  insert into fiila.retired_tokens (token) values (r.share_token) on conflict do nothing;
  update fiila.places set share_token = fiila.token(16), status = 'active', updated_at = now() where id = r.id;
  select * into r from fiila.places where id = r.id;
  return fiila.place_json(r, true);
end $$;

-- Suppression définitive de la fiche et de sa photo (stockée dans la même ligne).
create or replace function public.fiila_delete_place(p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  delete from fiila.places where id = r.id;
  return jsonb_build_object('deleted', true);
end $$;

create or replace function public.fiila_get_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into r from fiila.places where share_token = p_token;
  if not found then
    if exists (select 1 from fiila.retired_tokens where token = p_token) then
      return jsonb_build_object('state', 'replaced');
    end if;
    return jsonb_build_object('state', 'not_found');
  end if;
  if r.status <> 'active' then return jsonb_build_object('state', 'revoked'); end if;
  if r.kind = 'meeting' and r.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  return jsonb_build_object('state', 'ok', 'place', fiila.place_json(r, false));
end $$;

-- ----- demandes d'adresse
create or replace function public.fiila_create_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_purpose text; v_ref text; v_owner text; v_share text; v_id uuid;
begin
  perform fiila.rate_check('create_request', 40);
  perform fiila.housekeeping();
  v_name    := fiila.clean(p ->> 'requester_name', 60);
  v_purpose := fiila.clean(p ->> 'purpose', 80);
  v_ref     := fiila.clean(p ->> 'order_ref', 30);
  if v_name is null then perform fiila.fail('name_required'); end if;
  if v_purpose is null then perform fiila.fail('purpose_required'); end if;
  v_owner := fiila.token(32);
  v_share := fiila.token(16);
  insert into fiila.requests (share_token, owner_hash, requester_name, purpose, order_ref, expires_at)
  values (v_share, fiila.h(v_owner), v_name, v_purpose, v_ref, now() + interval '7 days')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'share_token', v_share, 'owner_token', v_owner);
end $$;

-- Ce que voit la personne sollicitée : qui demande et pourquoi. Jamais de réponse.
create or replace function public.fiila_get_request_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q fiila.requests;
begin
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into q from fiila.requests where share_token = p_token;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if q.fulfilled_at is not null then
    return jsonb_build_object('state', 'fulfilled', 'requester_name', q.requester_name);
  end if;
  if q.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  return jsonb_strip_nulls(jsonb_build_object('state', 'pending',
    'requester_name', q.requester_name, 'purpose', q.purpose, 'order_ref', q.order_ref,
    'expires_at', q.expires_at));
end $$;

create or replace function public.fiila_fulfill_request(p_token text, p_place_id text, p_place_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q fiila.requests; r fiila.places;
begin
  perform fiila.rate_check('fulfill_request', 40);
  if not fiila.valid_token(p_token) then perform fiila.fail('not_found'); end if;
  select * into q from fiila.requests where share_token = p_token for update;
  if not found then perform fiila.fail('not_found'); end if;
  if q.fulfilled_at is not null then perform fiila.fail('already_fulfilled'); end if;
  if q.expires_at <= now() then perform fiila.fail('expired'); end if;
  r := fiila.owned_place(p_place_id, p_place_owner);
  if r.kind <> 'address' then perform fiila.fail('not_an_address'); end if;
  if r.status <> 'active' then perform fiila.fail('place_revoked'); end if;
  update fiila.requests set place_id = r.id, fulfilled_at = now() where id = q.id;
  return jsonb_build_object('state', 'fulfilled');
end $$;

-- Vue privée du demandeur (jeton propriétaire de la demande requis).
create or replace function public.fiila_get_request_owner(p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q fiila.requests; r fiila.places; v_base jsonb;
begin
  q := fiila.owned_request(p_id, p_owner);
  v_base := jsonb_strip_nulls(jsonb_build_object('id', q.id, 'share_token', q.share_token,
    'requester_name', q.requester_name, 'purpose', q.purpose, 'order_ref', q.order_ref,
    'created_at', q.created_at, 'expires_at', q.expires_at, 'fulfilled_at', q.fulfilled_at));
  if q.fulfilled_at is null then
    return v_base || jsonb_build_object('state', case when q.expires_at <= now() then 'expired' else 'pending' end);
  end if;
  if q.place_id is null then return v_base || jsonb_build_object('state', 'place_deleted'); end if;
  select * into r from fiila.places where id = q.place_id;
  if r.status <> 'active' then return v_base || jsonb_build_object('state', 'place_revoked'); end if;
  return v_base || jsonb_build_object('state', 'fulfilled', 'place', fiila.place_json(r, false));
end $$;

create or replace function public.fiila_delete_request(p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q fiila.requests;
begin
  q := fiila.owned_request(p_id, p_owner);
  delete from fiila.requests where id = q.id;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- droits
revoke all on all functions in schema fiila from public;
revoke execute on function
  public.fiila_create_place(jsonb), public.fiila_update_place(text, text, jsonb),
  public.fiila_get_owned(text, text), public.fiila_owned_summaries(jsonb),
  public.fiila_revoke_place(text, text), public.fiila_new_link(text, text),
  public.fiila_delete_place(text, text), public.fiila_get_public(text),
  public.fiila_create_request(jsonb), public.fiila_get_request_public(text),
  public.fiila_fulfill_request(text, text, text), public.fiila_get_request_owner(text, text),
  public.fiila_delete_request(text, text)
from public;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function
        public.fiila_create_place(jsonb), public.fiila_update_place(text, text, jsonb),
        public.fiila_get_owned(text, text), public.fiila_owned_summaries(jsonb),
        public.fiila_revoke_place(text, text), public.fiila_new_link(text, text),
        public.fiila_delete_place(text, text), public.fiila_get_public(text),
        public.fiila_create_request(jsonb), public.fiila_get_request_public(text),
        public.fiila_fulfill_request(text, text, text), public.fiila_get_request_owner(text, text),
        public.fiila_delete_request(text, text)
        to %I', role_name);
    end if;
  end loop;
end $$;
