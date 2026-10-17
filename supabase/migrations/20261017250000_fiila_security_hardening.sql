-- Fii La — durcissement après l'audit du 17/10/2026 (docs/AUDIT-2026-10-17.md). Validé par le fondateur (22:10).
-- S3 adresse IP de confiance, S4 livreur confirmé par la boutique, S5 livreur retiré coupé, S6 notes de livreur vérifiées,
-- S7 index et ménage espacé, S8 limites sur les lectures publiques et facture en lecture seule, S9 destination arrondie
-- dans le suivi, S10 invités d'un rendez-vous, S11 suppression de compte complète avec connexion récente,
-- S12 métadonnées XMP refusées, S13 caractères invisibles filtrés, S14 conservation (24 mois, décision du fondateur).

-- ---------------------------------------------------------------- S13 : caractères invisibles et de contrôle de direction
create or replace function fiila.clean(p_text text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare r text;
begin
  if p_text is null then return null; end if;
  r := regexp_replace(p_text, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F​-‏‪-‮⁠-⁩﻿]', '', 'g');
  r := btrim(replace(r, chr(13), ''));
  if r = '' then return null; end if;
  if char_length(r) > p_max then perform fiila.fail('too_long'); end if;
  return r;
end $$;

-- ---------------------------------------------------------------- S12 : métadonnées XMP (peuvent contenir une position)
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
  if position('http://ns.adobe.com/xap/1.0/'::bytea in data) > 0 or position('XML:com.adobe.xmp'::bytea in data) > 0 then
    perform fiila.fail('photo_metadata');
  end if;
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

-- ---------------------------------------------------------------- S3 + S7 : adresse IP de confiance, limites sans balayage
create index if not exists rate_events_at on fiila.rate_events (at);
create index if not exists trackers_expires on fiila.trackers (expires_at);
create index if not exists places_meeting_expiry on fiila.places (expires_at) where kind = 'meeting';
create index if not exists requests_expiry on fiila.requests (expires_at);
create index if not exists orders_created on fiila.orders (created_at);

-- Adresse du client : en-tête posé par Cloudflare en priorité ; sinon le DERNIER saut de x-forwarded-for
-- (ajouté par notre proxy), jamais le premier (choisi par le client). IPv6 regroupée par /64.
create or replace function fiila.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare v_h json; v_ip text := ''; v_parts text[];
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_h := null;
  end;
  if v_h is not null then
    v_ip := btrim(coalesce(v_h ->> 'cf-connecting-ip', ''));
    if v_ip = '' then
      v_parts := string_to_array(coalesce(v_h ->> 'x-forwarded-for', ''), ',');
      if array_length(v_parts, 1) > 0 then v_ip := btrim(v_parts[array_length(v_parts, 1)]); end if;
    end if;
  end if;
  if position(':' in v_ip) > 0 then
    v_parts := string_to_array(v_ip, ':');
    v_ip := array_to_string(v_parts[1:4], ':') || '::/64';
  end if;
  return coalesce(nullif(v_ip, ''), 'unknown');
end $$;

create or replace function fiila.rate_check(p_action text, p_max int) returns void
language plpgsql set search_path = '' as $$
declare v_bucket text; v_n int;
begin
  v_bucket := encode(extensions.digest(
    (select value from fiila.settings where key = 'rate_salt') || ':' || fiila.client_ip(), 'sha256'), 'hex');
  select count(*) into v_n from fiila.rate_events
   where bucket = v_bucket and action = p_action and at > now() - interval '1 hour';
  if v_n >= p_max then perform fiila.fail('rate_limited'); end if;
  insert into fiila.rate_events (bucket, action) values (v_bucket, p_action);
end $$;

-- Ménage au plus toutes les 10 minutes (et non à chaque appel), avec la conservation décidée (S14 : 24 mois).
insert into fiila.settings (key, value) values ('housekeeping_at', '1970-01-01T00:00:00Z') on conflict (key) do nothing;
create or replace function fiila.housekeeping() returns void
language plpgsql set search_path = '' as $$
declare v_last timestamptz;
begin
  select value::timestamptz into v_last from fiila.settings where key = 'housekeeping_at' for update skip locked;
  if v_last is null or v_last > now() - interval '10 minutes' then return; end if;
  update fiila.settings set value = now()::text where key = 'housekeeping_at';
  delete from fiila.rate_events where at < now() - interval '1 day';
  delete from fiila.places where kind = 'meeting' and expires_at < now() - interval '30 days';
  delete from fiila.requests where expires_at < now() - interval '30 days'
    and not exists (select 1 from fiila.orders o where o.request_id = requests.id and o.place_id is null and o.status = 'open');
  delete from fiila.retired_tokens where retired_at < now() - interval '180 days';
  delete from fiila.trackers where expires_at < now() - interval '1 day';
  update fiila.trackers set lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null
   where expires_at < now() and (lat is not null or courier_send is not null);
  delete from fiila.courier_invites where coalesce(used_at, expires_at) < now() - interval '7 days';
  -- conservation des données de boutique : 24 mois
  delete from fiila.orders where created_at < now() - interval '24 months';
  delete from fiila.customers c where c.updated_at < now() - interval '24 months'
    and not exists (select 1 from fiila.orders o where o.customer_id = c.id);
end $$;

-- Lectures publiques : limite large (les pages de suivi interrogent toutes les 15 s).
create or replace function fiila.read_check() returns void
language sql set search_path = '' as $$ select fiila.rate_check('read', 3000) $$;

create or replace function public.fiila_get_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  perform fiila.read_check();
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

create or replace function public.fiila_courier_view(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t fiila.trackers; r fiila.places;
begin
  perform fiila.read_check();
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into t from fiila.trackers where send_hash = fiila.h(p_token) and kind = 'courier';
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if t.expires_at <= now() or t.status = 'stopped' then return jsonb_build_object('state', 'expired'); end if;
  select * into r from fiila.places where id = t.place_id;
  if r.status <> 'active' then return jsonb_build_object('state', 'revoked'); end if;
  return jsonb_build_object('state', 'ok', 'status', t.status, 'place', fiila.place_json(r, false));
end $$;

-- S9 : le suivi montre la destination à environ 100 m près (pas le point exact de la porte).
create or replace function public.fiila_watch(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t fiila.trackers; r fiila.places;
begin
  perform fiila.read_check();
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into t from fiila.trackers where watch_token = p_token and kind = 'courier';
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if t.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  select * into r from fiila.places where id = t.place_id;
  if r.status <> 'active' then return jsonb_build_object('state', 'revoked'); end if;
  return jsonb_build_object('state', 'ok', 'tracker', fiila.tracker_json(t),
    'dest', jsonb_build_object('label', r.label,
      'entry', jsonb_build_object('lat', round(r.entry_lat::numeric, 3), 'lng', round(r.entry_lng::numeric, 3))));
end $$;

create or replace function public.fiila_get_request_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q fiila.requests;
begin
  perform fiila.read_check();
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into q from fiila.requests where share_token = p_token;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if q.fulfilled_at is not null then
    return jsonb_build_object('state', 'fulfilled', 'requester_name', q.requester_name);
  end if;
  if q.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  return jsonb_strip_nulls(jsonb_build_object('state', 'pending',
    'requester_name', q.requester_name, 'purpose', q.purpose, 'order_ref', q.order_ref,
    'expires_at', q.expires_at,
    'shop', case when exists (select 1 from fiila.orders o where o.request_id = q.id) then true end));
end $$;

-- S8 : la facture publique ne fait plus d'écriture (la synchronisation a lieu à la réponse du client).
create or replace function public.fiila_order_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders; s fiila.shops; v_full jsonb; v_items jsonb; v_cour jsonb; v_cid uuid; v_my smallint;
begin
  perform fiila.read_check();
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into o from fiila.orders where share_token = p_token;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where id = o.shop_id;
  if o.status = 'cancelled' then
    return jsonb_build_object('state', 'cancelled', 'shop', jsonb_build_object('name', s.name), 'ref', fiila.order_ref(o.number));
  end if;
  v_full := fiila.order_json(o, true);
  select coalesce(jsonb_agg(case when r.rating is not null then it || jsonb_build_object('my_rating', r.rating) else it end order by ord), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(fiila.items_with_photos(o.items)) with ordinality as x(it, ord)
    left join fiila.reviews r on r.order_id = o.id and r.product_id = fiila.as_uuid(it ->> 'product_id');
  select t.courier_id into v_cid from fiila.trackers t where t.order_id = o.id and t.courier_id is not null order by t.created_at desc limit 1;
  if v_cid is not null then
    select rating into v_my from fiila.courier_reviews where order_id = o.id;
    select jsonb_strip_nulls(jsonb_build_object('name', split_part(c.name, ' ', 1), 'my_rating', v_my,
        'can_rate', exists (select 1 from fiila.trackers t2 where t2.order_id = o.id and t2.courier_id = c.id and t2.done_at is not null)))
      into v_cour from fiila.couriers c where c.id = v_cid;
  end if;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'phone', s.phone, 'ninea', s.ninea)),
    'order', jsonb_strip_nulls(jsonb_build_object(
      'ref', v_full ->> 'ref', 'customer_name', o.customer_name, 'items', v_items, 'total', o.total,
      'paid', v_full -> 'paid', 'pay_state', v_full ->> 'pay_state',
      'address_state', v_full ->> 'address_state', 'delivery_state', v_full ->> 'delivery_state',
      'request_token', v_full ->> 'request_token', 'watch_token', v_full ->> 'watch_token',
      'can_review', o.status = 'delivered', 'courier', v_cour,
      'note', o.note, 'created_at', o.created_at, 'delivered_at', o.delivered_at)));
end $$;

-- ---------------------------------------------------------------- S4 : livreur confirmé par la boutique
alter table fiila.shops add column courier_confirmed boolean not null default false;
alter table fiila.trackers add column done_at timestamptz;

create or replace function fiila.order_dispatch(p_order uuid, p_force boolean) returns boolean
language plpgsql set search_path = '' as $$
declare o fiila.orders; s fiila.shops; c fiila.couriers; v_send text; v_watch text;
begin
  select * into o from fiila.orders where id = p_order for update;
  if not found or o.status <> 'open' or o.place_id is null then return false; end if;
  if o.watch_token is not null and exists (select 1 from fiila.trackers t where t.watch_token = o.watch_token
       and t.expires_at > now() and t.status <> 'stopped') then return false; end if;
  select * into s from fiila.shops where id = o.shop_id;
  if s.courier_id is null or not s.courier_confirmed or (not s.courier_auto and not p_force) then return false; end if;
  select * into c from fiila.couriers where id = s.courier_id and active;
  if not found then return false; end if;
  if not exists (select 1 from fiila.places where id = o.place_id and status = 'active') then return false; end if;
  v_send := fiila.token(16);
  v_watch := fiila.token(16);
  insert into fiila.trackers (place_id, request_id, kind, send_hash, watch_token, expires_at, courier_id, courier_send, order_id)
  values (o.place_id, o.request_id, 'courier', fiila.h(v_send), v_watch, now() + interval '12 hours', c.id, v_send, o.id);
  update fiila.orders set watch_token = v_watch, updated_at = now() where id = o.id;
  return true;
end $$;

create or replace function public.fiila_courier_accept(p_token text, p_courier_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i fiila.courier_invites; c fiila.couriers := fiila.my_courier(p_courier_key); s fiila.shops;
begin
  perform fiila.rate_check('courier_accept', 30);
  if not fiila.valid_token(p_token) then perform fiila.fail('not_found'); end if;
  select * into i from fiila.courier_invites where token_hash = fiila.h(p_token) for update;
  if not found then perform fiila.fail('not_found'); end if;
  if i.used_at is not null then perform fiila.fail('already_used'); end if;
  if i.expires_at <= now() then perform fiila.fail('expired'); end if;
  update fiila.courier_invites set used_at = now() where token_hash = i.token_hash;
  -- l'ancien livreur perd ses courses ; le nouveau attend la confirmation de la boutique
  select * into s from fiila.shops where id = i.shop_id for update;
  if s.courier_id is not null and s.courier_id <> c.id then perform fiila.courier_cut(s.id, s.courier_id); end if;
  update fiila.shops set courier_id = c.id, courier_confirmed = false, updated_at = now() where id = i.shop_id returning * into s;
  return jsonb_build_object('shop', s.name);
end $$;

-- S5 : couper toutes les courses en cours d'un livreur pour une boutique (retrait ou remplacement).
create or replace function fiila.courier_cut(p_shop uuid, p_courier uuid) returns void
language sql set search_path = '' as $$
  update fiila.trackers t set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null,
         expires_at = least(t.expires_at, now())
    from fiila.orders o
   where t.order_id = o.id and o.shop_id = p_shop and t.courier_id = p_courier and t.expires_at > now();
$$;

-- p_action : 'confirm', 'auto_on', 'auto_off', 'remove', 'cancel_invite'
create or replace function public.fiila_shop_courier(p_key text, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_o uuid;
begin
  if p_action = 'confirm' then
    if s.courier_id is null then perform fiila.fail('no_courier'); end if;
    update fiila.shops set courier_confirmed = true where id = s.id;
    -- les commandes déjà prêtes partent maintenant
    for v_o in select id from fiila.orders where shop_id = s.id and status = 'open' and place_id is not null loop
      perform fiila.order_dispatch(v_o, false);
    end loop;
  elsif p_action = 'auto_on' then update fiila.shops set courier_auto = true where id = s.id;
  elsif p_action = 'auto_off' then update fiila.shops set courier_auto = false where id = s.id;
  elsif p_action = 'remove' then
    if s.courier_id is not null then perform fiila.courier_cut(s.id, s.courier_id); end if;
    update fiila.shops set courier_id = null, courier_confirmed = false where id = s.id;
  elsif p_action = 'cancel_invite' then delete from fiila.courier_invites where shop_id = s.id and used_at is null;
  else perform fiila.fail('invalid_status');
  end if;
  return public.fiila_shop_get(p_key);
end $$;

create or replace function public.fiila_shop_get(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; c fiila.couriers; i fiila.courier_invites;
begin
  begin
    s := fiila.my_shop(p_key);
  exception when others then
    return jsonb_build_object('shop', null);
  end;
  select * into c from fiila.couriers where id = s.courier_id;
  select * into i from fiila.courier_invites where shop_id = s.id and used_at is null and expires_at > now() order by created_at desc limit 1;
  return jsonb_build_object('shop', fiila.shop_json(s) || jsonb_strip_nulls(jsonb_build_object('account', s.user_id is not null,
      'courier_auto', s.courier_auto, 'courier_confirmed', s.courier_confirmed,
      'courier', case when c.id is not null then fiila.courier_json(c) end,
      'courier_invite', case when i.token_hash is not null then jsonb_build_object('name', i.name, 'phone', i.phone) end)),
    'stats', (select jsonb_build_object(
      'open', count(*) filter (where o.status = 'open'),
      'unpaid', count(*) filter (where o.status <> 'cancelled' and fiila.order_paid(o.id) < o.total),
      'orders', count(*),
      'customers', (select count(*) from fiila.customers cu where cu.shop_id = s.id),
      'products', (select count(*) from fiila.products pr where pr.shop_id = s.id and pr.active))
      from fiila.orders o where o.shop_id = s.id));
end $$;

-- S5 + S6 : seul le livreur actuel, sur une course active, peut la clôturer ; la clôture est datée (note possible).
create or replace function public.fiila_courier_done(p_key text, p_send text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fiila.couriers := fiila.my_courier(p_key); t fiila.trackers; o fiila.orders; s fiila.shops;
begin
  perform fiila.rate_check('courier_done', 200);
  t := fiila.tracker_by_send(p_send);
  if t.courier_id is distinct from c.id or t.expires_at <= now() or t.status = 'stopped' then perform fiila.fail('not_found'); end if;
  select * into o from fiila.orders where id = t.order_id for update;
  select * into s from fiila.shops where id = o.shop_id;
  if o.watch_token is distinct from t.watch_token or s.courier_id is distinct from c.id then perform fiila.fail('not_found'); end if;
  update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null,
    done_at = now(), expires_at = least(expires_at, now() + interval '1 hour') where id = t.id;
  update fiila.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = o.id and status = 'open';
  return jsonb_build_object('done', true);
end $$;

-- S6 : note du livreur seulement si la course a été close par lui.
create or replace function public.fiila_courier_review(p_token text, p_rating int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders; v_cid uuid;
begin
  perform fiila.rate_check('review', 120);
  if not fiila.valid_token(p_token) then perform fiila.fail('order_not_found'); end if;
  select * into o from fiila.orders where share_token = p_token;
  if not found then perform fiila.fail('order_not_found'); end if;
  if o.status <> 'delivered' then perform fiila.fail('not_delivered'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then perform fiila.fail('invalid_rating'); end if;
  select t.courier_id into v_cid from fiila.trackers t
   where t.order_id = o.id and t.courier_id is not null and t.done_at is not null order by t.done_at desc limit 1;
  if v_cid is null then perform fiila.fail('no_courier'); end if;
  insert into fiila.courier_reviews (order_id, courier_id, rating) values (o.id, v_cid, p_rating)
  on conflict (order_id) do update set rating = excluded.rating, updated_at = now();
  return jsonb_build_object('rating', p_rating);
end $$;

-- S6 : une boutique ne note pas ses propres articles (commande à son propre numéro).
create or replace function public.fiila_review(p_token text, p_product_id text, p_rating int, p_comment text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders; s fiila.shops; v_pid uuid := fiila.as_uuid(p_product_id);
begin
  perform fiila.rate_check('review', 120);
  if not fiila.valid_token(p_token) then perform fiila.fail('order_not_found'); end if;
  select * into o from fiila.orders where share_token = p_token;
  if not found then perform fiila.fail('order_not_found'); end if;
  if o.status <> 'delivered' then perform fiila.fail('not_delivered'); end if;
  select * into s from fiila.shops where id = o.shop_id;
  if s.phone is not null and o.customer_phone is not null and fiila.phone_key(s.phone) = fiila.phone_key(o.customer_phone) then
    perform fiila.fail('not_allowed');
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then perform fiila.fail('invalid_rating'); end if;
  if v_pid is null or not exists (select 1 from jsonb_array_elements(o.items) it where fiila.as_uuid(it ->> 'product_id') = v_pid)
     or not exists (select 1 from fiila.products where id = v_pid) then
    perform fiila.fail('product_not_found');
  end if;
  insert into fiila.reviews (product_id, order_id, rating, comment) values (v_pid, o.id, p_rating, fiila.clean(p_comment, 300))
  on conflict (order_id, product_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = now();
  return jsonb_build_object('rating', p_rating);
end $$;

-- Le lien de course n'est plus gardé une fois la commande close (S14).
create or replace function public.fiila_order_set_status(p_key text, p_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id);
begin
  if p_status not in ('open', 'delivered', 'cancelled') then perform fiila.fail('invalid_status'); end if;
  update fiila.orders set status = p_status, updated_at = now(),
    delivered_at = case when p_status = 'delivered' then now() end,
    cancelled_at = case when p_status = 'cancelled' then now() end
   where id = o.id returning * into o;
  if p_status <> 'open' and o.watch_token is not null then
    update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null,
      expires_at = least(expires_at, now())
     where watch_token = o.watch_token;
  end if;
  return fiila.order_json(o, true) || jsonb_build_object('items', fiila.items_with_photos(o.items));
end $$;

-- ---------------------------------------------------------------- S10 : rendez-vous
create or replace function public.fiila_join_meeting(p_share_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places; v_name text; v_send text; v_id uuid; v_n int;
begin
  perform fiila.rate_check('join_meeting', 10);
  if not fiila.valid_token(p_share_token) then perform fiila.fail('not_found'); end if;
  select * into r from fiila.places where share_token = p_share_token;
  if not found or r.kind <> 'meeting' then perform fiila.fail('not_found'); end if;
  if r.status <> 'active' then perform fiila.fail('place_revoked'); end if;
  if r.expires_at <= now() then perform fiila.fail('expired'); end if;
  v_name := fiila.clean(p_name, 40);
  if v_name is null then perform fiila.fail('name_required'); end if;
  select count(*) into v_n from fiila.trackers where place_id = r.id and kind = 'guest';
  if v_n >= 100 then perform fiila.fail('too_many'); end if;
  v_send := fiila.token(16);
  insert into fiila.trackers (place_id, kind, send_hash, name, expires_at)
  values (r.id, 'guest', fiila.h(v_send), v_name, r.expires_at)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'guest_token', v_send);
end $$;

-- L'organisateur retire un invité (nom usurpé, inconnu).
create or replace function public.fiila_meeting_guest_remove(p_id text, p_owner text, p_guest_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  delete from fiila.trackers where id = fiila.as_uuid(p_guest_id) and place_id = r.id and kind = 'guest';
  if not found then perform fiila.fail('not_found'); end if;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- S11 : suppression de compte complète, connexion récente
-- Supabase Auth inscrit dans le jeton (amr) l'heure de la dernière connexion par mot de passe : elle doit dater de moins de 15 min.
create or replace function fiila.recent_login() returns boolean
language plpgsql stable set search_path = '' as $$
declare v_claims jsonb; v_ts bigint;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return false;
  end;
  select max((a ->> 'timestamp')::bigint) into v_ts from jsonb_array_elements(coalesce(v_claims -> 'amr', '[]'::jsonb)) a;
  return v_ts is not null and v_ts > extract(epoch from now()) - 900;
end $$;

create or replace function public.fiila_delete_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  perform fiila.rate_check('delete_account', 10);
  if not fiila.recent_login() then perform fiila.fail('reauth_required'); end if;
  delete from fiila.requests where id in (select o.request_id from fiila.orders o join fiila.shops s on s.id = o.shop_id
                                           where s.user_id = v_uid and o.request_id is not null);
  delete from fiila.shops where user_id = v_uid;
  delete from fiila.couriers where user_id = v_uid;
  delete from fiila.places where user_id = v_uid;
  delete from fiila.requests where user_id = v_uid;
  delete from fiila.profiles where user_id = v_uid;
  delete from auth.users where id = v_uid;
  return jsonb_build_object('deleted', true);
end $$;

create or replace function public.fiila_shop_delete(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  perform fiila.rate_check('shop_delete', 10);
  delete from fiila.requests where id in (select request_id from fiila.orders where shop_id = s.id and request_id is not null);
  delete from fiila.shops where id = s.id;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- limites sur les écritures restées libres
create or replace function public.fiila_courier_update(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fiila.couriers := fiila.my_courier(p_key); v_vehicle text;
begin
  perform fiila.rate_check('courier_update', 120);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_vehicle := coalesce(nullif(p ->> 'vehicle', ''), c.vehicle);
  if v_vehicle not in ('moto', 'voiture', 'velo', 'pied') then perform fiila.fail('invalid_vehicle'); end if;
  update fiila.couriers set
    name = coalesce(fiila.clean(p ->> 'name', 60), name),
    phone = case when p ? 'phone' then fiila.clean_phone(p ->> 'phone') else phone end,
    zone = case when p ? 'zone' then fiila.clean(p ->> 'zone', 60) else zone end,
    vehicle = v_vehicle,
    active = coalesce((p ->> 'active')::boolean, active),
    updated_at = now()
   where id = c.id returning * into c;
  return fiila.courier_json(c);
end $$;

-- ---------------------------------------------------------------- droits
revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array[
    'public.fiila_get_public(text)', 'public.fiila_courier_view(text)', 'public.fiila_watch(text)',
    'public.fiila_get_request_public(text)', 'public.fiila_order_public(text)', 'public.fiila_courier_accept(text, text)',
    'public.fiila_shop_courier(text, text)', 'public.fiila_shop_get(text)', 'public.fiila_courier_done(text, text)',
    'public.fiila_courier_review(text, integer)', 'public.fiila_review(text, text, integer, text)',
    'public.fiila_order_set_status(text, text, text)', 'public.fiila_join_meeting(text, text)',
    'public.fiila_meeting_guest_remove(text, text, text)', 'public.fiila_delete_account()', 'public.fiila_shop_delete(text)',
    'public.fiila_courier_update(text, jsonb)'];
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
