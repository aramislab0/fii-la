-- Fii La — V2 livreurs : livreur attitré, courses automatiques, notes ; suppression de boutique. 17/10/2026.
-- Décisions du fondateur (17/10, 21:25) :
--   1. commencer par le livreur attitré (relation commerçant ↔ livreur déjà existante), avant toute inscription publique ;
--   2. la course arrive toute seule sur la page du livreur (gratuit) ; pas d'API WhatsApp payante ;
--   3. un commerçant peut supprimer sa boutique.
--
-- Rattachement sûr : le commerçant envoie une invitation sur le WhatsApp du livreur ; seul celui qui ouvre ce lien
-- et l'accepte devient livreur attitré. Un numéro saisi seul ne donne jamais accès aux adresses des clients.

create table fiila.couriers (
  id         uuid primary key default gen_random_uuid(),
  owner_hash bytea not null unique,                  -- clé du téléphone du livreur
  user_id    uuid references auth.users (id) on delete set null,
  name       text not null,
  phone      text,
  vehicle    text not null default 'moto' check (vehicle in ('moto', 'voiture', 'velo', 'pied')),
  zone       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fiila.courier_invites (
  token_hash bytea primary key,
  shop_id    uuid not null references fiila.shops (id) on delete cascade,
  name       text,
  phone      text,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index courier_invites_shop on fiila.courier_invites (shop_id);

create table fiila.courier_reviews (
  order_id   uuid primary key references fiila.orders (id) on delete cascade,
  courier_id uuid not null references fiila.couriers (id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courier_reviews_courier on fiila.courier_reviews (courier_id);

alter table fiila.shops
  add column courier_id uuid references fiila.couriers (id) on delete set null,
  add column courier_auto boolean not null default true;
alter table fiila.trackers
  add column courier_id uuid references fiila.couriers (id) on delete set null,
  add column courier_send text,                       -- lien livreur, rendu seulement au livreur attitré (sa clé)
  add column order_id uuid references fiila.orders (id) on delete cascade;
create index trackers_courier on fiila.trackers (courier_id) where courier_id is not null;

revoke all on fiila.couriers, fiila.courier_invites, fiila.courier_reviews from public;

-- ---------------------------------------------------------------- helpers
create or replace function fiila.my_courier(p_key text) returns fiila.couriers
language plpgsql set search_path = '' as $$
declare c fiila.couriers;
begin
  if p_key is null or char_length(p_key) > 100 then perform fiila.fail('courier_required'); end if;
  select * into c from fiila.couriers where owner_hash = fiila.h(p_key) for update;
  if not found then perform fiila.fail('courier_required'); end if;
  return c;
end $$;

create or replace function fiila.courier_json(c fiila.couriers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'vehicle', c.vehicle, 'zone', c.zone,
    'active', c.active,
    'rating', (select round(avg(rating)::numeric, 1) from fiila.courier_reviews r where r.courier_id = c.id),
    'reviews', (select nullif(count(*), 0) from fiila.courier_reviews r where r.courier_id = c.id)))
$$;

-- Envoie la commande au livreur attitré : adresse reçue, commande ouverte, pas déjà en livraison.
create or replace function fiila.order_dispatch(p_order uuid, p_force boolean) returns boolean
language plpgsql set search_path = '' as $$
declare o fiila.orders; s fiila.shops; c fiila.couriers; v_send text; v_watch text;
begin
  select * into o from fiila.orders where id = p_order for update;
  if not found or o.status <> 'open' or o.place_id is null then return false; end if;
  if o.watch_token is not null and exists (select 1 from fiila.trackers t where t.watch_token = o.watch_token
       and t.expires_at > now() and t.status <> 'stopped') then return false; end if;
  select * into s from fiila.shops where id = o.shop_id;
  if s.courier_id is null or (not s.courier_auto and not p_force) then return false; end if;
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

-- Synchronisation d'une commande : adresse reçue → posée sur la commande et la fiche client → course automatique.
create or replace function fiila.order_sync(p_id uuid) returns fiila.orders
language plpgsql set search_path = '' as $$
declare o fiila.orders; q fiila.requests;
begin
  select * into o from fiila.orders where id = p_id;
  if o.place_id is null and o.request_id is not null then
    select * into q from fiila.requests where id = o.request_id;
    if found and q.fulfilled_at is not null and q.place_id is not null then
      update fiila.orders set place_id = q.place_id, updated_at = now() where id = o.id returning * into o;
      update fiila.customers set place_id = q.place_id, updated_at = now() where id = o.customer_id;
      if fiila.order_dispatch(o.id, false) then select * into o from fiila.orders where id = o.id; end if;
    end if;
  end if;
  return o;
end $$;

-- Le client répond à une demande : les commandes liées sont synchronisées tout de suite (course automatique).
create or replace function public.fiila_fulfill_request(p_token text, p_place_id text, p_place_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q fiila.requests; r fiila.places; v_o uuid;
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
  for v_o in select id from fiila.orders where request_id = q.id loop
    perform fiila.order_sync(v_o);
  end loop;
  return jsonb_build_object('state', 'fulfilled');
end $$;

-- Le livreur et l'état de la course apparaissent sur la commande.
create or replace function fiila.order_courier(o fiila.orders) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'phone', c.phone, 'status', t.status)
    from fiila.trackers t join fiila.couriers c on c.id = t.courier_id
   where o.watch_token is not null and t.watch_token = o.watch_token
$$;

-- ---------------------------------------------------------------- livreur
create or replace function public.fiila_courier_register(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fiila.couriers; v_key text; v_name text; v_vehicle text;
begin
  perform fiila.rate_check('courier_register', 20);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name := fiila.clean(p ->> 'name', 60);
  if v_name is null then perform fiila.fail('name_required'); end if;
  v_vehicle := coalesce(nullif(p ->> 'vehicle', ''), 'moto');
  if v_vehicle not in ('moto', 'voiture', 'velo', 'pied') then perform fiila.fail('invalid_vehicle'); end if;
  v_key := fiila.token(32);
  insert into fiila.couriers (owner_hash, user_id, name, phone, vehicle, zone)
  values (fiila.h(v_key), fiila.uid(), v_name, fiila.clean_phone(p ->> 'phone'), v_vehicle, fiila.clean(p ->> 'zone', 60))
  returning * into c;
  return jsonb_build_object('key', v_key, 'courier', fiila.courier_json(c));
end $$;

create or replace function public.fiila_courier_update(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fiila.couriers := fiila.my_courier(p_key); v_vehicle text;
begin
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

-- Espace du livreur : ses boutiques, ses courses en cours (avec le lien de chacune), ses livraisons du jour.
create or replace function public.fiila_courier_me(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fiila.couriers := fiila.my_courier(p_key);
begin
  return jsonb_build_object('courier', fiila.courier_json(c),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'auto', s.courier_auto) order by s.name)
      from fiila.shops s where s.courier_id = c.id), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'token', t.courier_send, 'status', t.status, 'created_at', t.created_at,
        'shop', s.name, 'shop_phone', s.phone, 'ref', fiila.order_ref(o.number), 'customer', o.customer_name,
        'customer_phone', o.customer_phone, 'total', o.total, 'paid', fiila.order_paid(o.id),
        'dest', p.label, 'locality', p.locality)) order by t.created_at)
      from fiila.trackers t
      join fiila.orders o on o.id = t.order_id
      join fiila.shops s on s.id = o.shop_id
      join fiila.places p on p.id = t.place_id
      where t.courier_id = c.id and t.expires_at > now() and t.status in ('waiting', 'live', 'arrived')
        and o.status = 'open'), '[]'::jsonb),
    'done_today', (select count(*) from fiila.orders o join fiila.trackers t on t.order_id = o.id
      where t.courier_id = c.id and o.status = 'delivered' and o.delivered_at > date_trunc('day', now())));
end $$;

-- Le livreur confirme la remise : la commande passe livrée, sa position est effacée.
create or replace function public.fiila_courier_done(p_key text, p_send text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fiila.couriers := fiila.my_courier(p_key); t fiila.trackers;
begin
  t := fiila.tracker_by_send(p_send);
  if t.courier_id is distinct from c.id then perform fiila.fail('not_found'); end if;
  update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null,
    expires_at = least(expires_at, now() + interval '1 hour') where id = t.id;
  update fiila.orders set status = 'delivered', delivered_at = now(), updated_at = now()
   where id = t.order_id and status = 'open';
  return jsonb_build_object('done', true);
end $$;

create or replace function public.fiila_courier_delete(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fiila.couriers := fiila.my_courier(p_key);
begin
  delete from fiila.couriers where id = c.id;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- boutique ↔ livreur attitré
create or replace function public.fiila_courier_invite(p_key text, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_tok text;
begin
  perform fiila.rate_check('courier_invite', 30);
  delete from fiila.courier_invites where shop_id = s.id and used_at is null;
  v_tok := fiila.token(16);
  insert into fiila.courier_invites (token_hash, shop_id, name, phone, expires_at)
  values (fiila.h(v_tok), s.id, fiila.clean(p_name, 60), fiila.clean_phone(p_phone), now() + interval '7 days');
  return jsonb_build_object('token', v_tok);
end $$;

create or replace function public.fiila_courier_invite_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i fiila.courier_invites; s fiila.shops;
begin
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into i from fiila.courier_invites where token_hash = fiila.h(p_token);
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if i.used_at is not null then return jsonb_build_object('state', 'used'); end if;
  if i.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  select * into s from fiila.shops where id = i.shop_id;
  return jsonb_strip_nulls(jsonb_build_object('state', 'ok', 'shop', s.name, 'name', i.name, 'phone', i.phone));
end $$;

create or replace function public.fiila_courier_accept(p_token text, p_courier_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i fiila.courier_invites; c fiila.couriers := fiila.my_courier(p_courier_key); s fiila.shops;
begin
  if not fiila.valid_token(p_token) then perform fiila.fail('not_found'); end if;
  select * into i from fiila.courier_invites where token_hash = fiila.h(p_token) for update;
  if not found then perform fiila.fail('not_found'); end if;
  if i.used_at is not null then perform fiila.fail('already_used'); end if;
  if i.expires_at <= now() then perform fiila.fail('expired'); end if;
  update fiila.courier_invites set used_at = now() where token_hash = i.token_hash;
  update fiila.shops set courier_id = c.id, updated_at = now() where id = i.shop_id returning * into s;
  return jsonb_build_object('shop', s.name);
end $$;

-- p_action : 'auto_on', 'auto_off', 'remove', 'cancel_invite'
create or replace function public.fiila_shop_courier(p_key text, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  if p_action = 'auto_on' then update fiila.shops set courier_auto = true where id = s.id;
  elsif p_action = 'auto_off' then update fiila.shops set courier_auto = false where id = s.id;
  elsif p_action = 'remove' then update fiila.shops set courier_id = null where id = s.id;
  elsif p_action = 'cancel_invite' then delete from fiila.courier_invites where shop_id = s.id and used_at is null;
  else perform fiila.fail('invalid_status');
  end if;
  return public.fiila_shop_get(p_key);
end $$;

-- Envoi manuel au livreur attitré (si l'envoi automatique est coupé, ou pour renvoyer).
create or replace function public.fiila_order_dispatch(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id);
begin
  if o.status <> 'open' then perform fiila.fail('order_closed'); end if;
  if o.place_id is null then perform fiila.fail('not_fulfilled'); end if;
  if o.watch_token is not null then
    update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null,
      expires_at = least(expires_at, now()) where watch_token = o.watch_token;
  end if;
  if not fiila.order_dispatch(o.id, true) then perform fiila.fail('no_courier'); end if;
  select * into o from fiila.orders where id = o.id;
  return fiila.order_json(o, true) || jsonb_build_object('items', fiila.items_with_photos(o.items), 'courier', fiila.order_courier(o));
end $$;

-- ---------------------------------------------------------------- boutique : lecture enrichie, suppression
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
      'courier_auto', s.courier_auto,
      'courier', case when c.id is not null then fiila.courier_json(c) end,
      'courier_invite', case when i.token_hash is not null then jsonb_build_object('name', i.name, 'phone', i.phone) end)),
    'stats', (select jsonb_build_object(
      'open', count(*) filter (where o.status = 'open'),
      'unpaid', count(*) filter (where o.status <> 'cancelled' and fiila.order_paid(o.id) < o.total),
      'customers', (select count(*) from fiila.customers cu where cu.shop_id = s.id),
      'products', (select count(*) from fiila.products pr where pr.shop_id = s.id and pr.active))
      from fiila.orders o where o.shop_id = s.id));
end $$;

-- Supprime la boutique et tout ce qui lui appartient : articles, clients, commandes, factures, paiements, notes,
-- demandes d'adresse des commandes. Les adresses des clients leur appartiennent : elles ne sont pas touchées.
create or replace function public.fiila_shop_delete(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  delete from fiila.requests where id in (select request_id from fiila.orders where shop_id = s.id and request_id is not null);
  delete from fiila.shops where id = s.id;
  return jsonb_build_object('deleted', true);
end $$;

-- Commande (commerçant) : livreur et état de la course.
create or replace function public.fiila_order_get(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id);
begin
  return fiila.order_json(o, true) || jsonb_strip_nulls(jsonb_build_object('items', fiila.items_with_photos(o.items), 'courier', fiila.order_courier(o)));
end $$;

-- Facture : prénom du livreur, et note de la livraison une fois livrée.
create or replace function public.fiila_order_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders; s fiila.shops; v_full jsonb; v_items jsonb; v_cour jsonb; v_cid uuid; v_my smallint;
begin
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into o from fiila.orders where share_token = p_token;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  o := fiila.order_sync(o.id);
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
    select jsonb_strip_nulls(jsonb_build_object('name', split_part(c.name, ' ', 1), 'my_rating', v_my)) into v_cour from fiila.couriers c where c.id = v_cid;
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

-- Note de la livraison par le client (commande livrée, livreur attitré).
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
  select t.courier_id into v_cid from fiila.trackers t where t.order_id = o.id and t.courier_id is not null order by t.created_at desc limit 1;
  if v_cid is null then perform fiila.fail('no_courier'); end if;
  insert into fiila.courier_reviews (order_id, courier_id, rating) values (o.id, v_cid, p_rating)
  on conflict (order_id) do update set rating = excluded.rating, updated_at = now();
  return jsonb_build_object('rating', p_rating);
end $$;

-- Commande manuelle (« Envoyer au livreur » sans livreur attitré) : rattachée à la commande.
create or replace function public.fiila_order_delivery(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id); r fiila.places; v_send text; v_watch text;
begin
  perform fiila.rate_check('start_delivery', 60);
  if o.status <> 'open' then perform fiila.fail('order_closed'); end if;
  select * into r from fiila.places where id = o.place_id;
  if not found then perform fiila.fail('not_fulfilled'); end if;
  if r.status <> 'active' then perform fiila.fail('place_revoked'); end if;
  if o.watch_token is not null then
    update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null,
      expires_at = least(expires_at, now())
     where watch_token = o.watch_token;
  end if;
  v_send := fiila.token(16);
  v_watch := fiila.token(16);
  insert into fiila.trackers (place_id, request_id, kind, send_hash, watch_token, expires_at, order_id)
  values (r.id, o.request_id, 'courier', fiila.h(v_send), v_watch, now() + interval '12 hours', o.id);
  update fiila.orders set watch_token = v_watch, updated_at = now() where id = o.id;
  return jsonb_build_object('courier_token', v_send, 'watch_token', v_watch);
end $$;

-- Création de commande : si l'adresse du client est déjà connue, la course part tout de suite au livreur attitré.
-- (on enveloppe la fonction existante sans la réécrire)
create or replace function fiila.after_order_create(p_out jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := fiila.as_uuid(p_out ->> 'id'); o fiila.orders;
begin
  if fiila.order_dispatch(v_id, false) then
    select * into o from fiila.orders where id = v_id;
    return fiila.order_json(o, true);
  end if;
  return p_out;
end $$;

alter function public.fiila_order_create(text, jsonb) rename to order_create_base;
alter function public.order_create_base(text, jsonb) set schema fiila;
revoke execute on function fiila.order_create_base(text, jsonb) from public, anon, authenticated;
create or replace function public.fiila_order_create(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return fiila.after_order_create(fiila.order_create_base(p_key, p));
end $$;

-- ---------------------------------------------------------------- mesure
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
    or (p_event = 'delivery_started' and p_variant in ('request', 'place', 'order', 'courier'))
    or (p_event = 'tracking_shared'  and p_variant in ('courier', 'guest'))
    or (p_event = 'meeting_joined'   and p_variant = 'guest')
    or (p_event = 'account_created'  and p_variant in ('account', 'shop', 'nudge'))
    or (p_event = 'account_nudge'    and p_variant in ('shown', 'dismissed'))
    or (p_event = 'shop_created'     and p_variant in ('shop', 'no_account', 'account'))
    or (p_event = 'shop_deleted'     and p_variant = 'shop')
    or (p_event = 'product_created'  and p_variant in ('photo', 'no_photo'))
    or (p_event = 'order_created'    and p_variant in ('new_customer', 'known_customer', 'known_address'))
    or (p_event = 'invoice_opened'   and p_variant = 'order')
    or (p_event = 'review_left'      and p_variant in ('1', '2', '3', '4', '5'))
    or (p_event = 'courier_review'   and p_variant in ('1', '2', '3', '4', '5'))
    or (p_event = 'courier_registered' and p_variant in ('direct', 'invite'))
    or (p_event = 'courier_invited'  and p_variant = 'whatsapp')
    or (p_event = 'courier_linked'   and p_variant = 'invite')
    or (p_event = 'courier_done'     and p_variant = 'courier')
    or (p_event = 'payment_recorded' and p_variant in ('cash', 'wave', 'orange_money', 'card', 'other'))
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
do $$
declare role_name text; fn text;
  fns text[] := array[
    'public.fiila_courier_register(jsonb)', 'public.fiila_courier_update(text, jsonb)', 'public.fiila_courier_me(text)',
    'public.fiila_courier_done(text, text)', 'public.fiila_courier_delete(text)',
    'public.fiila_courier_invite(text, text, text)', 'public.fiila_courier_invite_get(text)', 'public.fiila_courier_accept(text, text)',
    'public.fiila_shop_courier(text, text)', 'public.fiila_order_dispatch(text, text)', 'public.fiila_shop_get(text)',
    'public.fiila_shop_delete(text)', 'public.fiila_order_get(text, text)', 'public.fiila_order_public(text)',
    'public.fiila_courier_review(text, integer)', 'public.fiila_order_delivery(text, text)', 'public.fiila_order_create(text, jsonb)',
    'public.fiila_fulfill_request(text, text, text)', 'public.fiila_track(text, text)'];
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
