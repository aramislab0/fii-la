-- Fii La — suivi en direct (17/10/2026).
-- 1. Livraison : le demandeur (ou le propriétaire d'une adresse) crée un lien livreur et un lien de suivi.
--    Le livreur partage sa position tant que sa page est ouverte ; le lien de suivi la montre.
-- 2. Rendez-vous : un invité qui l'accepte partage son trajet ; seul l'organisateur le voit.
-- Données minimales : dernière position + courte trace (30 points), effacées à l'arrivée ou à l'arrêt,
-- suivi supprimé au plus tard 24 h après son expiration. Aucun historique.

create table fiila.trackers (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references fiila.places (id) on delete cascade,
  request_id   uuid references fiila.requests (id) on delete cascade,
  kind         text not null check (kind in ('courier', 'guest')),
  send_hash    bytea not null unique,            -- jeton de celui qui partage sa position (haché)
  watch_token  text unique,                      -- lien de suivi d'une livraison (capacité, comme un lien de partage)
  name         text,                             -- prénom de l'invité (rendez-vous)
  status       text not null default 'waiting' check (status in ('waiting', 'live', 'arrived', 'stopped')),
  lat          double precision,
  lng          double precision,
  acc          real,
  pos_at       timestamptz,
  trail        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index trackers_place on fiila.trackers (place_id);
revoke all on fiila.trackers from public;

-- Ménage : on ajoute les suivis expirés (24 h après expiration).
create or replace function fiila.housekeeping() returns void
language sql set search_path = '' as $$
  delete from fiila.places where kind = 'meeting' and expires_at < now() - interval '30 days';
  delete from fiila.requests where expires_at < now() - interval '30 days';
  delete from fiila.retired_tokens where retired_at < now() - interval '180 days';
  delete from fiila.trackers where expires_at < now() - interval '1 day';
  update fiila.trackers set lat = null, lng = null, acc = null, trail = '[]'::jsonb
   where expires_at < now() and lat is not null;
$$;

create or replace function fiila.tracker_by_send(p_token text) returns fiila.trackers
language plpgsql set search_path = '' as $$
declare t fiila.trackers;
begin
  if not fiila.valid_token(p_token) then perform fiila.fail('not_found'); end if;
  select * into t from fiila.trackers where send_hash = fiila.h(p_token) for update;
  if not found then perform fiila.fail('not_found'); end if;
  return t;
end $$;

create or replace function fiila.tracker_json(t fiila.trackers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'name', t.name, 'status', t.status,
    'pos', case when t.lat is not null then jsonb_build_object('lat', t.lat, 'lng', t.lng, 'acc', t.acc, 'at', t.pos_at) end,
    'trail', case when jsonb_array_length(t.trail) > 1 then t.trail end,
    'expires_at', t.expires_at))
$$;

-- ---------------------------------------------------------------- livraison

-- Crée un lien livreur + un lien de suivi. p_kind = 'request' (demandeur d'une adresse reçue)
-- ou 'place' (propriétaire d'une adresse qui fait venir un livreur chez lui).
create or replace function public.fiila_start_delivery(p_kind text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q fiila.requests; r fiila.places; v_send text; v_watch text; v_id uuid;
begin
  perform fiila.rate_check('start_delivery', 60);
  perform fiila.housekeeping();
  if p_kind = 'request' then
    q := fiila.owned_request(p_id, p_owner);
    if q.fulfilled_at is null or q.place_id is null then perform fiila.fail('not_fulfilled'); end if;
    select * into r from fiila.places where id = q.place_id;
  elsif p_kind = 'place' then
    r := fiila.owned_place(p_id, p_owner);
  else
    perform fiila.fail('invalid_kind');
  end if;
  if r.kind <> 'address' then perform fiila.fail('not_an_address'); end if;
  if r.status <> 'active' then perform fiila.fail('place_revoked'); end if;
  v_send := fiila.token(16);
  v_watch := fiila.token(16);
  insert into fiila.trackers (place_id, request_id, kind, send_hash, watch_token, expires_at)
  values (r.id, q.id, 'courier', fiila.h(v_send), v_watch, now() + interval '12 hours')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'courier_token', v_send, 'watch_token', v_watch);
end $$;

-- Ce que voit le livreur : la fiche de destination et l'état de son partage.
create or replace function public.fiila_courier_view(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t fiila.trackers; r fiila.places;
begin
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into t from fiila.trackers where send_hash = fiila.h(p_token) and kind = 'courier';
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if t.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  select * into r from fiila.places where id = t.place_id;
  if r.status <> 'active' then return jsonb_build_object('state', 'revoked'); end if;
  return jsonb_build_object('state', 'ok', 'status', t.status, 'place', fiila.place_json(r, false));
end $$;

-- Ce que voit celui qui suit la livraison : position du livreur et destination.
create or replace function public.fiila_watch(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t fiila.trackers; r fiila.places;
begin
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into t from fiila.trackers where watch_token = p_token and kind = 'courier';
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if t.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  select * into r from fiila.places where id = t.place_id;
  if r.status <> 'active' then return jsonb_build_object('state', 'revoked'); end if;
  return jsonb_build_object('state', 'ok', 'tracker', fiila.tracker_json(t),
    'dest', jsonb_strip_nulls(jsonb_build_object('label', r.label,
      'entry', jsonb_build_object('lat', r.entry_lat, 'lng', r.entry_lng),
      'stop', case when r.stop_lat is not null then jsonb_build_object('lat', r.stop_lat, 'lng', r.stop_lng) end)));
end $$;

-- ---------------------------------------------------------------- rendez-vous

-- Un invité accepte de partager son trajet avec l'organisateur.
create or replace function public.fiila_join_meeting(p_share_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places; v_name text; v_send text; v_id uuid; v_n int;
begin
  perform fiila.rate_check('join_meeting', 30);
  if not fiila.valid_token(p_share_token) then perform fiila.fail('not_found'); end if;
  select * into r from fiila.places where share_token = p_share_token;
  if not found or r.kind <> 'meeting' then perform fiila.fail('not_found'); end if;
  if r.status <> 'active' then perform fiila.fail('place_revoked'); end if;
  if r.expires_at <= now() then perform fiila.fail('expired'); end if;
  v_name := fiila.clean(p_name, 40);
  if v_name is null then perform fiila.fail('name_required'); end if;
  select count(*) into v_n from fiila.trackers where place_id = r.id and kind = 'guest';
  if v_n >= 50 then perform fiila.fail('too_many'); end if;
  v_send := fiila.token(16);
  insert into fiila.trackers (place_id, kind, send_hash, name, expires_at)
  values (r.id, 'guest', fiila.h(v_send), v_name, r.expires_at)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'guest_token', v_send);
end $$;

-- Vue de l'organisateur uniquement (jeton propriétaire du rendez-vous).
create or replace function public.fiila_meeting_guests(p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  if r.kind <> 'meeting' then perform fiila.fail('not_a_meeting'); end if;
  return jsonb_build_object('guests', coalesce((
    select jsonb_agg(fiila.tracker_json(t) order by t.created_at)
      from fiila.trackers t where t.place_id = r.id and t.kind = 'guest'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- position (livreur ou invité)

-- p_status : 'live' (avec position), 'waiting' (pas encore parti), 'arrived' ou 'stopped'.
-- À l'arrivée ou à l'arrêt, la position et la trace sont effacées.
create or replace function public.fiila_position(p_token text, p_status text, p_lat double precision, p_lng double precision, p_acc double precision) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t fiila.trackers; v_trail jsonb;
begin
  perform fiila.rate_check('position', 5000); -- opérateurs mobiles : beaucoup d'utilisateurs derrière une même adresse IP
  t := fiila.tracker_by_send(p_token);
  if t.expires_at <= now() then perform fiila.fail('expired'); end if;
  if p_status not in ('live', 'waiting', 'arrived', 'stopped') then perform fiila.fail('invalid_status'); end if;
  if p_status = 'live' then
    perform fiila.check_point(p_lat, p_lng);
    -- au plus une position toutes les 5 secondes
    if t.pos_at is not null and t.pos_at > now() - interval '5 seconds' and t.status = 'live' then
      return jsonb_build_object('state', 'ok');
    end if;
    v_trail := t.trail || jsonb_build_array(jsonb_build_array(round(p_lat::numeric, 6), round(p_lng::numeric, 6)));
    if jsonb_array_length(v_trail) > 30 then v_trail := v_trail - 0; end if;
    update fiila.trackers set status = 'live', lat = p_lat, lng = p_lng,
      acc = least(greatest(coalesce(p_acc, 0), 0), 100000), pos_at = now(), trail = v_trail
     where id = t.id;
  else
    update fiila.trackers set status = p_status, lat = null, lng = null, acc = null, pos_at = now(), trail = '[]'::jsonb
     where id = t.id;
  end if;
  return jsonb_build_object('state', 'ok');
end $$;

-- ---------------------------------------------------------------- mesure (nouveaux événements)
create or replace function public.fiila_track(p_event text, p_variant text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (
       (p_event = 'discovery_shown' and p_variant in ('address', 'meeting'))
    or (p_event = 'discovery_cta'   and p_variant in ('address', 'meeting'))
    or (p_event = 'fiche_created'   and p_variant in ('address_direct', 'address_discovery', 'address_request',
                                                      'meeting_direct', 'meeting_discovery', 'meeting_similar'))
    or (p_event = 'request_created' and p_variant = 'request')
    or (p_event = 'share_initiated' and (p_variant in ('native', 'whatsapp')
          or p_variant ~ '^(native|whatsapp|telegram|facebook|instagram|tiktok)_(address|meeting|request)$'))
    or (p_event = 'link_copied'     and p_variant in ('address', 'meeting', 'request'))
    or (p_event = 'owned_reopened'  and p_variant in ('address', 'meeting', 'request'))
    or (p_event = 'visual_exported' and p_variant ~ '^(download|share)_(address|meeting|request)$')
    or (p_event = 'delivery_started' and p_variant in ('request', 'place'))
    or (p_event = 'tracking_shared'  and p_variant in ('courier', 'guest'))
    or (p_event = 'meeting_joined'   and p_variant = 'guest')
  ) then
    perform fiila.fail('invalid_event');
  end if;
  perform fiila.rate_check('track', 300);
  insert into fiila.metrics (day, event, variant, n)
  values ((now() at time zone 'utc')::date, p_event, p_variant, 1)
  on conflict (day, event, variant) do update set n = fiila.metrics.n + 1;
end $$;

-- ---------------------------------------------------------------- droits
revoke all on all functions in schema fiila from public;
revoke execute on function
  public.fiila_start_delivery(text, text, text), public.fiila_courier_view(text), public.fiila_watch(text),
  public.fiila_join_meeting(text, text), public.fiila_meeting_guests(text, text),
  public.fiila_position(text, text, double precision, double precision, double precision)
from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function
        public.fiila_start_delivery(text, text, text), public.fiila_courier_view(text), public.fiila_watch(text),
        public.fiila_join_meeting(text, text), public.fiila_meeting_guests(text, text),
        public.fiila_position(text, text, double precision, double precision, double precision)
        to %I', role_name);
    end if;
  end loop;
end $$;
