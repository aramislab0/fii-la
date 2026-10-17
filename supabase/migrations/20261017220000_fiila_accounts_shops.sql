-- Fii La — comptes, coffre d'adresses, boutique (Rali intégré à Fii La). 17/10/2026.
--
-- 1. Comptes (Supabase Auth, e-mail + mot de passe). Un compte est facultatif : tout ce qui marchait
--    sans compte continue de marcher avec la clé de gestion du téléphone. Avec un compte, une fiche
--    est aussi reconnue par auth.uid() : on la retrouve sur tous ses appareils.
-- 2. Coffre : chaque adresse du compte porte une étiquette (maison, bureau, boutique, autre).
--    Elle reste privée tant que son lien n'est pas envoyé.
-- 3. Boutique : clients, commandes numérotées, facture partageable, demande d'adresse liée,
--    livraison suivie en direct, paiements enregistrés. Le paiement en ligne (Wave, Orange Money)
--    viendra écrire dans fiila.payments (source 'provider') : rien d'autre à changer dans le modèle.

-- ---------------------------------------------------------------- utilisateur courant
create or replace function fiila.uid() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  return auth.uid();
exception when others then
  return null;
end $$;

create or replace function fiila.need_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := fiila.uid();
begin
  if v is null then perform fiila.fail('auth_required'); end if;
  return v;
end $$;

create or replace function fiila.clean_phone(p_text text) returns text
language plpgsql immutable set search_path = '' as $$
declare r text := fiila.clean(p_text, 30);
begin
  if r is null then return null; end if;
  if r !~ '^[0-9 +().-]{6,20}$' then perform fiila.fail('phone_invalid'); end if;
  return r;
end $$;

-- Clé de comparaison d'un numéro : chiffres seuls, sans indicatif international du Sénégal (+221 / 00221).
create or replace function fiila.phone_key(p_text text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(coalesce(p_text, ''), '[^0-9]', '', 'g'), '^00', ''), '^221(?=[0-9]{9}$)', '')
$$;

-- ---------------------------------------------------------------- tables
create table fiila.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  phone        text,
  avatar       bytea,
  avatar_type  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table fiila.places
  add column user_id uuid references auth.users (id) on delete cascade,
  add column tag text check (tag in ('home', 'work', 'shop', 'other'));
alter table fiila.requests
  add column user_id uuid references auth.users (id) on delete cascade;
create index places_user on fiila.places (user_id) where user_id is not null;
create index requests_user on fiila.requests (user_id) where user_id is not null;

create table fiila.shops (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade, -- une boutique par compte (MVP)
  name        text not null,
  phone       text,
  ninea       text,
  next_number int  not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table fiila.customers (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references fiila.shops (id) on delete cascade,
  name       text not null,
  phone      text,
  note       text,
  place_id   uuid references fiila.places (id) on delete set null, -- dernière adresse donnée par le client
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_shop on fiila.customers (shop_id);

create table fiila.orders (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references fiila.shops (id) on delete cascade,
  number         int  not null,
  customer_id    uuid references fiila.customers (id) on delete set null,
  customer_name  text not null,
  customer_phone text,
  items          jsonb not null,
  total          bigint not null check (total >= 0),       -- en francs CFA
  note           text,
  status         text not null default 'open' check (status in ('open', 'delivered', 'cancelled')),
  share_token    text not null unique,                     -- lien de la facture envoyé au client
  request_id     uuid references fiila.requests (id) on delete set null,
  place_id       uuid references fiila.places (id) on delete set null,
  watch_token    text,                                     -- dernière livraison lancée
  delivered_at   timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (shop_id, number)
);
create index orders_shop on fiila.orders (shop_id, created_at desc);
create index orders_request on fiila.orders (request_id) where request_id is not null;

-- Paiements : saisis à la main aujourd'hui ; demain, aussi écrits par l'intégration Wave / Orange Money.
create table fiila.payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references fiila.orders (id) on delete cascade,
  amount       bigint not null check (amount > 0),
  method       text not null check (method in ('cash', 'wave', 'orange_money', 'card', 'other')),
  source       text not null default 'manual' check (source in ('manual', 'provider')),
  status       text not null default 'confirmed' check (status in ('pending', 'confirmed', 'failed', 'refunded')),
  provider_ref text,
  created_at   timestamptz not null default now()
);
create index payments_order on fiila.payments (order_id);

revoke all on fiila.profiles, fiila.shops, fiila.customers, fiila.orders, fiila.payments from public;

-- ---------------------------------------------------------------- propriété : clé de gestion OU compte
create or replace function fiila.owned_place(p_id text, p_owner text) returns fiila.places
language plpgsql set search_path = '' as $$
declare r fiila.places; v_id uuid := fiila.as_uuid(p_id); v_uid uuid := fiila.uid();
begin
  if v_id is null or char_length(coalesce(p_owner, '')) > 100 then perform fiila.fail('not_found'); end if;
  if p_owner is null and v_uid is null then perform fiila.fail('not_found'); end if;
  select * into r from fiila.places
   where id = v_id
     and ((p_owner is not null and owner_hash = fiila.h(p_owner)) or (v_uid is not null and user_id = v_uid))
   for update;
  if not found then perform fiila.fail('not_found'); end if;
  return r;
end $$;

create or replace function fiila.owned_request(p_id text, p_owner text) returns fiila.requests
language plpgsql set search_path = '' as $$
declare r fiila.requests; v_id uuid := fiila.as_uuid(p_id); v_uid uuid := fiila.uid();
begin
  if v_id is null or char_length(coalesce(p_owner, '')) > 100 then perform fiila.fail('not_found'); end if;
  if p_owner is null and v_uid is null then perform fiila.fail('not_found'); end if;
  select * into r from fiila.requests
   where id = v_id
     and ((p_owner is not null and owner_hash = fiila.h(p_owner)) or (v_uid is not null and user_id = v_uid))
   for update;
  if not found then perform fiila.fail('not_found'); end if;
  return r;
end $$;

-- Création : la fiche est rattachée au compte connecté (s'il y en a un), en plus de la clé de gestion.
create or replace function public.fiila_create_place(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_owner text; v_share text; v_id uuid; v_tag text;
begin
  perform fiila.rate_check('create_place', 40);
  perform fiila.housekeeping();
  v_kind := coalesce(p ->> 'kind', 'address');
  if v_kind not in ('address', 'meeting') then perform fiila.fail('invalid_kind'); end if;
  v_tag := nullif(p ->> 'tag', '');
  if v_tag is not null and (v_kind <> 'address' or v_tag not in ('home', 'work', 'shop', 'other')) then perform fiila.fail('invalid_tag'); end if;
  v_owner := fiila.token(32);
  v_share := fiila.token(16);
  insert into fiila.places (kind, share_token, owner_hash, label, entry_lat, entry_lng, user_id, tag)
  values (v_kind, v_share, fiila.h(v_owner), '', 0, 0, fiila.uid(), v_tag)
  returning id into v_id;
  perform fiila.write_place(v_id, p);
  return jsonb_build_object('id', v_id, 'share_token', v_share, 'owner_token', v_owner);
end $$;

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
  insert into fiila.requests (share_token, owner_hash, requester_name, purpose, order_ref, expires_at, user_id)
  values (v_share, fiila.h(v_owner), v_name, v_purpose, v_ref, now() + interval '7 days', fiila.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'share_token', v_share, 'owner_token', v_owner);
end $$;

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
    'created_at',  r.created_at,
    'tag',         r.tag,
    'account',     r.user_id is not null
  ) else '{}'::jsonb end)
$$;

-- Résumés « Mes adresses / demandes / rendez-vous » : fiches de ce téléphone + fiches du compte.
-- Les demandes créées par une commande de boutique restent dans la boutique.
create or replace function public.fiila_owned_summaries(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; r fiila.places; q fiila.requests; v_out jsonb := '[]'::jsonb; v_id uuid;
  v_uid uuid := fiila.uid(); v_seen uuid[] := '{}';
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then p_items := '[]'::jsonb; end if;
  if jsonb_array_length(p_items) > 200 then perform fiila.fail('too_many'); end if;
  for item in select * from jsonb_array_elements(p_items) loop
    v_id := fiila.as_uuid(item ->> 'id');
    if v_id is null then continue; end if;
    v_seen := v_seen || v_id;
    if coalesce(item ->> 'type', 'place') = 'request' then
      select * into q from fiila.requests
       where id = v_id and (owner_hash = fiila.h(item ->> 'owner') or (v_uid is not null and user_id = v_uid));
      if found then
        v_out := v_out || jsonb_build_array(fiila.request_summary(q));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'request', 'id', v_id, 'missing', true));
      end if;
    else
      select * into r from fiila.places
       where id = v_id and (owner_hash = fiila.h(item ->> 'owner') or (v_uid is not null and user_id = v_uid));
      if found then
        v_out := v_out || jsonb_build_array(fiila.place_summary(r));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'place', 'id', v_id, 'missing', true));
      end if;
    end if;
  end loop;
  if v_uid is not null then
    for r in select * from fiila.places where user_id = v_uid and not (id = any (v_seen)) order by updated_at desc limit 300 loop
      v_out := v_out || jsonb_build_array(fiila.place_summary(r));
    end loop;
    for q in select * from fiila.requests rq where user_id = v_uid and not (id = any (v_seen))
               and not exists (select 1 from fiila.orders o where o.request_id = rq.id)
             order by created_at desc limit 300 loop
      v_out := v_out || jsonb_build_array(fiila.request_summary(q));
    end loop;
  end if;
  return v_out;
end $$;

create or replace function fiila.place_summary(r fiila.places) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'type', 'place', 'id', r.id, 'kind', r.kind, 'label', r.label, 'locality', r.locality,
    'status', r.status, 'starts_at', r.starts_at, 'expires_at', r.expires_at,
    'expired', r.kind = 'meeting' and r.expires_at < now(), 'tag', r.tag,
    'account', r.user_id is not null, 'updated_at', r.updated_at))
$$;

create or replace function fiila.request_summary(q fiila.requests) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'type', 'request', 'id', q.id, 'requester_name', q.requester_name, 'purpose', q.purpose,
    'state', case when q.fulfilled_at is not null then 'fulfilled'
                  when q.expires_at < now() then 'expired' else 'pending' end,
    'account', q.user_id is not null, 'created_at', q.created_at)
$$;

-- La personne sollicitée voit aussi si la demande vient d'une commande (le commerçant pourra réutiliser l'adresse).
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
    'expires_at', q.expires_at,
    'shop', case when exists (select 1 from fiila.orders o where o.request_id = q.id) then true end));
end $$;

-- ---------------------------------------------------------------- compte et profil
create or replace function public.fiila_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); p fiila.profiles; s fiila.shops; v_email text;
begin
  select email into v_email from auth.users where id = v_uid;
  select * into p from fiila.profiles where user_id = v_uid;
  select * into s from fiila.shops where user_id = v_uid;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', v_uid, 'email', v_email,
    'display_name', p.display_name, 'phone', p.phone,
    'avatar', case when p.avatar is not null
                   then 'data:' || p.avatar_type || ';base64,' || replace(encode(p.avatar, 'base64'), E'\n', '') end,
    'shop', case when s.id is not null then jsonb_build_object('id', s.id, 'name', s.name) end));
end $$;

-- p : {display_name, phone, avatar}. avatar absent = inchangé ; '' = supprimé ; base64 = remplacé.
create or replace function public.fiila_profile_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); v_name text; v_phone text; v_ph record;
begin
  perform fiila.rate_check('profile_save', 120);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name  := fiila.clean(p ->> 'display_name', 60);
  v_phone := fiila.clean_phone(p ->> 'phone');
  insert into fiila.profiles (user_id, display_name, phone) values (v_uid, v_name, v_phone)
  on conflict (user_id) do update set display_name = excluded.display_name, phone = excluded.phone, updated_at = now();
  if p ? 'avatar' then
    if coalesce(p ->> 'avatar', '') = '' then
      update fiila.profiles set avatar = null, avatar_type = null where user_id = v_uid;
    else
      select * into v_ph from fiila.photo_in(p ->> 'avatar');
      if length(v_ph.data) > 150000 then perform fiila.fail('photo_too_large'); end if;
      update fiila.profiles set avatar = v_ph.data, avatar_type = v_ph.ctype where user_id = v_uid;
    end if;
  end if;
  return public.fiila_me();
end $$;

-- Rattache au compte les fiches et demandes de ce téléphone (clés de gestion valides seulement).
create or replace function public.fiila_claim(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); item jsonb; v_id uuid; v_n int := 0; v_c int;
begin
  perform fiila.rate_check('claim', 60);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('claimed', 0); end if;
  if jsonb_array_length(p_items) > 200 then perform fiila.fail('too_many'); end if;
  for item in select * from jsonb_array_elements(p_items) loop
    v_id := fiila.as_uuid(item ->> 'id');
    if v_id is null or coalesce(item ->> 'owner', '') = '' then continue; end if;
    if coalesce(item ->> 'type', 'place') = 'request' then
      update fiila.requests set user_id = v_uid where id = v_id and user_id is null and owner_hash = fiila.h(item ->> 'owner');
    else
      update fiila.places set user_id = v_uid where id = v_id and user_id is null and owner_hash = fiila.h(item ->> 'owner');
    end if;
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
  end loop;
  return jsonb_build_object('claimed', v_n);
end $$;

create or replace function public.fiila_set_tag(p_id text, p_owner text, p_tag text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.places;
begin
  r := fiila.owned_place(p_id, p_owner);
  if r.kind <> 'address' then perform fiila.fail('not_an_address'); end if;
  if p_tag is not null and p_tag not in ('home', 'work', 'shop', 'other') then perform fiila.fail('invalid_tag'); end if;
  update fiila.places set tag = p_tag where id = r.id;
  return jsonb_build_object('tag', p_tag);
end $$;

-- Supprime le compte et tout ce qui lui est rattaché (fiches, demandes, boutique, clients, commandes).
-- Les fiches restées seulement sur un téléphone (sans compte) ne sont pas concernées.
create or replace function public.fiila_delete_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  delete from fiila.shops where user_id = v_uid;
  delete from fiila.places where user_id = v_uid;
  delete from fiila.requests where user_id = v_uid;
  delete from fiila.profiles where user_id = v_uid;
  delete from auth.users where id = v_uid;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- boutique
create or replace function fiila.my_shop() returns fiila.shops
language plpgsql set search_path = '' as $$
declare s fiila.shops;
begin
  select * into s from fiila.shops where user_id = fiila.need_uid() for update;
  if not found then perform fiila.fail('shop_required'); end if;
  return s;
end $$;

create or replace function fiila.shop_json(s fiila.shops) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone, 'ninea', s.ninea,
    'created_at', s.created_at))
$$;

create or replace function fiila.order_ref(p_number int) returns text
language sql immutable set search_path = '' as $$ select lpad(p_number::text, 4, '0') $$;

create or replace function public.fiila_shop_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops;
begin
  select * into s from fiila.shops where user_id = fiila.need_uid();
  if not found then return jsonb_build_object('shop', null); end if;
  return jsonb_build_object('shop', fiila.shop_json(s),
    'stats', (select jsonb_build_object(
      'open', count(*) filter (where o.status = 'open'),
      'unpaid', count(*) filter (where o.status <> 'cancelled' and fiila.order_paid(o.id) < o.total),
      'customers', (select count(*) from fiila.customers c where c.shop_id = s.id))
      from fiila.orders o where o.shop_id = s.id));
end $$;

create or replace function public.fiila_shop_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); v_name text; v_phone text; v_ninea text; s fiila.shops;
begin
  perform fiila.rate_check('shop_save', 60);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name  := fiila.clean(p ->> 'name', 60);
  v_phone := fiila.clean_phone(p ->> 'phone');
  v_ninea := fiila.clean(p ->> 'ninea', 30);
  if v_name is null then perform fiila.fail('shop_name_required'); end if;
  insert into fiila.shops (user_id, name, phone, ninea) values (v_uid, v_name, v_phone, v_ninea)
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, ninea = excluded.ninea, updated_at = now()
  returning * into s;
  return jsonb_build_object('shop', fiila.shop_json(s));
end $$;

-- ----- clients
create or replace function fiila.customer_json(c fiila.customers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'note', c.note,
    'has_address', exists (select 1 from fiila.places p where p.id = c.place_id and p.status = 'active'),
    'orders', (select count(*) from fiila.orders o where o.customer_id = c.id and o.status <> 'cancelled'),
    'created_at', c.created_at))
$$;

create or replace function public.fiila_customers(p_query text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(); v_q text := fiila.clean(p_query, 60);
begin
  return coalesce((select jsonb_agg(x.j order by x.u desc)
    from (select fiila.customer_json(c) as j, c.updated_at as u from fiila.customers c
           where c.shop_id = s.id
             and (v_q is null or c.name ilike '%' || v_q || '%' or coalesce(c.phone, '') like '%' || v_q || '%')
           order by c.updated_at desc limit 300) x), '[]'::jsonb);
end $$;

create or replace function fiila.customer_upsert(s fiila.shops, p_id uuid, p_name text, p_phone text, p_note text) returns fiila.customers
language plpgsql set search_path = '' as $$
declare c fiila.customers;
begin
  if p_id is not null then
    select * into c from fiila.customers where id = p_id and shop_id = s.id for update;
    if not found then perform fiila.fail('customer_not_found'); end if;
    update fiila.customers set name = coalesce(p_name, c.name), phone = p_phone, note = p_note, updated_at = now()
     where id = c.id returning * into c;
    return c;
  end if;
  if p_name is null then perform fiila.fail('customer_name_required'); end if;
  -- même numéro dans la même boutique = même client
  if p_phone is not null then
    select * into c from fiila.customers
     where shop_id = s.id and fiila.phone_key(phone) = fiila.phone_key(p_phone)
     order by created_at limit 1 for update;
    if found then
      update fiila.customers set name = p_name, updated_at = now() where id = c.id returning * into c;
      return c;
    end if;
  end if;
  if (select count(*) from fiila.customers where shop_id = s.id) >= 5000 then perform fiila.fail('too_many'); end if;
  insert into fiila.customers (shop_id, name, phone, note) values (s.id, p_name, p_phone, p_note) returning * into c;
  return c;
end $$;

create or replace function public.fiila_customer_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(); c fiila.customers;
begin
  perform fiila.rate_check('customer_save', 600);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  c := fiila.customer_upsert(s, fiila.as_uuid(p ->> 'id'), fiila.clean(p ->> 'name', 60),
         fiila.clean_phone(p ->> 'phone'), fiila.clean(p ->> 'note', 200));
  return fiila.customer_json(c);
end $$;

create or replace function public.fiila_customer_get(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(); c fiila.customers;
begin
  select * into c from fiila.customers where id = fiila.as_uuid(p_id) and shop_id = s.id;
  if not found then perform fiila.fail('customer_not_found'); end if;
  return fiila.customer_json(c) || jsonb_build_object('order_list', coalesce((
    select jsonb_agg(fiila.order_json(o, false) order by o.number desc)
      from fiila.orders o where o.customer_id = c.id), '[]'::jsonb));
end $$;

-- Supprime le client du fichier de la boutique. Ses commandes restent (nom recopié sur chaque commande).
create or replace function public.fiila_customer_delete(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop();
begin
  delete from fiila.customers where id = fiila.as_uuid(p_id) and shop_id = s.id;
  if not found then perform fiila.fail('customer_not_found'); end if;
  return jsonb_build_object('deleted', true);
end $$;

-- ----- commandes
create or replace function fiila.order_paid(p_order uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(amount), 0)::bigint from fiila.payments where order_id = p_order and status = 'confirmed'
$$;

-- Quand le client a répondu à la demande d'adresse, l'adresse est posée sur la commande
-- et retenue pour ce client (le client peut la désactiver à tout moment).
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
    end if;
  end if;
  return o;
end $$;

create or replace function fiila.order_address_state(o fiila.orders) returns text
language plpgsql stable set search_path = '' as $$
declare v_status text; q fiila.requests;
begin
  if o.place_id is not null then
    select status into v_status from fiila.places where id = o.place_id;
    return case when v_status = 'active' then 'received' else 'revoked' end;
  end if;
  if o.request_id is null then return 'none'; end if;
  select * into q from fiila.requests where id = o.request_id;
  if not found then return 'none'; end if;
  if q.fulfilled_at is not null then return 'revoked'; end if; -- adresse supprimée par le client
  if q.expires_at <= now() then return 'expired'; end if;
  return 'pending';
end $$;

create or replace function fiila.order_delivery_state(o fiila.orders) returns text
language plpgsql stable set search_path = '' as $$
declare t fiila.trackers;
begin
  if o.status = 'delivered' then return 'delivered'; end if;
  if o.status = 'cancelled' then return 'cancelled'; end if;
  if o.watch_token is not null then
    select * into t from fiila.trackers where watch_token = o.watch_token;
    if found and t.expires_at > now() then
      return case t.status when 'live' then 'on_the_way' when 'arrived' then 'arrived'
                           when 'waiting' then 'courier_ready' else 'to_ship' end;
    end if;
  end if;
  return 'to_ship';
end $$;

create or replace function fiila.order_json(o fiila.orders, p_full boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_paid bigint := fiila.order_paid(o.id); v_out jsonb; r fiila.places; q fiila.requests;
begin
  v_out := jsonb_strip_nulls(jsonb_build_object(
    'id', o.id, 'number', o.number, 'ref', fiila.order_ref(o.number),
    'customer_id', o.customer_id, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
    'total', o.total, 'paid', v_paid,
    'pay_state', case when v_paid >= o.total then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end,
    'address_state', fiila.order_address_state(o), 'delivery_state', fiila.order_delivery_state(o),
    'status', o.status, 'created_at', o.created_at, 'delivered_at', o.delivered_at));
  if not p_full then return v_out; end if;
  if o.request_id is not null then select * into q from fiila.requests where id = o.request_id; end if;
  if o.place_id is not null then select * into r from fiila.places where id = o.place_id and status = 'active'; end if;
  return v_out || jsonb_strip_nulls(jsonb_build_object(
    'items', o.items, 'note', o.note, 'share_token', o.share_token,
    'request_token', case when q.id is not null and q.fulfilled_at is null and q.expires_at > now() then q.share_token end,
    'watch_token', case when fiila.order_delivery_state(o) in ('courier_ready', 'on_the_way', 'arrived') then o.watch_token end,
    'place', case when r.id is not null then fiila.place_json(r, false) end,
    'payments', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', pm.id, 'amount', pm.amount,
        'method', pm.method, 'source', pm.source, 'status', pm.status, 'created_at', pm.created_at)) order by pm.created_at)
        from fiila.payments pm where pm.order_id = o.id), '[]'::jsonb)));
end $$;

create or replace function fiila.my_order(p_id text) returns fiila.orders
language plpgsql set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(); o fiila.orders;
begin
  select * into o from fiila.orders where id = fiila.as_uuid(p_id) and shop_id = s.id for update;
  if not found then perform fiila.fail('order_not_found'); end if;
  return fiila.order_sync(o.id);
end $$;

-- Demande d'adresse rattachée à la commande (au nom de la boutique, gérée par le compte).
create or replace function fiila.order_new_request(s fiila.shops, o fiila.orders) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into fiila.requests (share_token, owner_hash, requester_name, purpose, order_ref, expires_at, user_id)
  values (fiila.token(16), fiila.h(fiila.token(32)), s.name,
          'Livraison de la commande N° ' || fiila.order_ref(o.number), 'N° ' || fiila.order_ref(o.number),
          now() + interval '7 days', s.user_id)
  returning id into v_id;
  update fiila.orders set request_id = v_id, updated_at = now() where id = o.id;
  return v_id;
end $$;

-- p : {customer_id | customer: {name, phone}, items: [{label, qty, price}], note}
create or replace function public.fiila_order_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s fiila.shops := fiila.my_shop(); c fiila.customers; o fiila.orders;
  it jsonb; v_items jsonb := '[]'::jsonb; v_label text; v_qty bigint; v_price bigint; v_total bigint := 0;
  v_place uuid; v_num int;
begin
  perform fiila.rate_check('order_create', 300);
  perform fiila.housekeeping();
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then perform fiila.fail('items_required'); end if;
  if jsonb_array_length(p -> 'items') > 50 then perform fiila.fail('too_many'); end if;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_label := fiila.clean(it ->> 'label', 80);
    if v_label is null then perform fiila.fail('item_label_required'); end if;
    begin
      v_qty := (it ->> 'qty')::bigint; v_price := (it ->> 'price')::bigint;
    exception when others then perform fiila.fail('invalid_number'); end;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then perform fiila.fail('invalid_qty'); end if;
    if v_price is null or v_price < 0 or v_price > 100000000 then perform fiila.fail('invalid_price'); end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('label', v_label, 'qty', v_qty, 'price', v_price));
    v_total := v_total + v_qty * v_price;
  end loop;
  if v_total > 2000000000 then perform fiila.fail('invalid_price'); end if;

  if p ->> 'customer_id' is not null then
    select * into c from fiila.customers where id = fiila.as_uuid(p ->> 'customer_id') and shop_id = s.id;
    if not found then perform fiila.fail('customer_not_found'); end if;
  else
    c := fiila.customer_upsert(s, null, fiila.clean(p -> 'customer' ->> 'name', 60),
           fiila.clean_phone(p -> 'customer' ->> 'phone'), null);
  end if;

  -- Adresse déjà connue et toujours active : pas besoin de la redemander.
  select id into v_place from fiila.places where id = c.place_id and status = 'active' and kind = 'address';

  update fiila.shops set next_number = next_number + 1 where id = s.id returning next_number - 1 into v_num;
  insert into fiila.orders (shop_id, number, customer_id, customer_name, customer_phone, items, total, note, share_token, place_id)
  values (s.id, v_num, c.id, c.name, c.phone, v_items, v_total, fiila.clean(p ->> 'note', 200), fiila.token(16), v_place)
  returning * into o;
  if v_place is null then perform fiila.order_new_request(s, o); end if;
  update fiila.customers set updated_at = now() where id = c.id;
  select * into o from fiila.orders where id = o.id;
  return fiila.order_json(o, true);
end $$;

-- p_filter : 'open' (en cours), 'done' (livrées ou annulées), 'unpaid', ou null (toutes).
create or replace function public.fiila_orders(p_filter text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(); o fiila.orders; v_out jsonb := '[]'::jsonb;
begin
  for o in select * from fiila.orders
            where shop_id = s.id
              and (p_filter is null
                or (p_filter = 'open' and status = 'open')
                or (p_filter = 'done' and status <> 'open')
                or (p_filter = 'unpaid' and status <> 'cancelled' and fiila.order_paid(id) < total))
            order by number desc limit 300 loop
    o := fiila.order_sync(o.id);
    v_out := v_out || jsonb_build_array(fiila.order_json(o, false));
  end loop;
  return v_out;
end $$;

create or replace function public.fiila_order_get(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_id);
begin
  return fiila.order_json(o, true);
end $$;

-- 'open' (rouvrir), 'delivered', 'cancelled'
create or replace function public.fiila_order_set_status(p_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_id);
begin
  if p_status not in ('open', 'delivered', 'cancelled') then perform fiila.fail('invalid_status'); end if;
  update fiila.orders set status = p_status, updated_at = now(),
    delivered_at = case when p_status = 'delivered' then now() end,
    cancelled_at = case when p_status = 'cancelled' then now() end
   where id = o.id returning * into o;
  -- Livraison terminée ou annulée : le partage de position s'arrête et la trace est effacée.
  if p_status <> 'open' and o.watch_token is not null then
    update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb,
      expires_at = least(expires_at, now())
     where watch_token = o.watch_token;
  end if;
  return fiila.order_json(o, true);
end $$;

create or replace function public.fiila_order_payment_add(p_id text, p_amount bigint, p_method text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_id);
begin
  perform fiila.rate_check('payment_add', 600);
  if p_amount is null or p_amount < 1 or p_amount > 2000000000 then perform fiila.fail('invalid_price'); end if;
  if p_method not in ('cash', 'wave', 'orange_money', 'card', 'other') then perform fiila.fail('invalid_method'); end if;
  if (select count(*) from fiila.payments where order_id = o.id) >= 50 then perform fiila.fail('too_many'); end if;
  insert into fiila.payments (order_id, amount, method) values (o.id, p_amount, p_method);
  return fiila.order_json(o, true);
end $$;

-- Seuls les paiements saisis à la main peuvent être retirés (ceux d'un opérateur suivront son statut).
create or replace function public.fiila_order_payment_delete(p_id text, p_payment_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_id);
begin
  delete from fiila.payments where id = fiila.as_uuid(p_payment_id) and order_id = o.id and source = 'manual';
  if not found then perform fiila.fail('payment_not_found'); end if;
  return fiila.order_json(o, true);
end $$;

-- Nouvelle demande d'adresse (la précédente a expiré, ou le client a retiré son adresse).
create or replace function public.fiila_order_request_address(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_id); s fiila.shops := fiila.my_shop();
begin
  perform fiila.rate_check('create_request', 40);
  if fiila.order_address_state(o) in ('received', 'pending') then perform fiila.fail('address_already'); end if;
  update fiila.orders set place_id = null where id = o.id returning * into o;
  perform fiila.order_new_request(s, o);
  select * into o from fiila.orders where id = o.id;
  return fiila.order_json(o, true);
end $$;

-- Lance la livraison : lien livreur (renvoyé une seule fois) ; le client suit sur sa facture.
create or replace function public.fiila_order_delivery(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_id); r fiila.places; v_send text; v_watch text;
begin
  perform fiila.rate_check('start_delivery', 60);
  if o.status <> 'open' then perform fiila.fail('order_closed'); end if;
  select * into r from fiila.places where id = o.place_id;
  if not found then perform fiila.fail('not_fulfilled'); end if;
  if r.status <> 'active' then perform fiila.fail('place_revoked'); end if;
  -- un seul livreur à la fois : l'ancien lien s'arrête
  if o.watch_token is not null then
    update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb,
      expires_at = least(expires_at, now())
     where watch_token = o.watch_token;
  end if;
  v_send := fiila.token(16);
  v_watch := fiila.token(16);
  insert into fiila.trackers (place_id, request_id, kind, send_hash, watch_token, expires_at)
  values (r.id, o.request_id, 'courier', fiila.h(v_send), v_watch, now() + interval '12 hours');
  update fiila.orders set watch_token = v_watch, updated_at = now() where id = o.id;
  return jsonb_build_object('courier_token', v_send, 'watch_token', v_watch);
end $$;

-- Facture vue par le client (lien partagé). Pas de téléphone du client : le lien peut circuler.
create or replace function public.fiila_order_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders; s fiila.shops; v_full jsonb;
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
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'phone', s.phone, 'ninea', s.ninea)),
    'order', jsonb_strip_nulls(jsonb_build_object(
      'ref', v_full ->> 'ref', 'customer_name', o.customer_name, 'items', o.items, 'total', o.total,
      'paid', v_full -> 'paid', 'pay_state', v_full ->> 'pay_state',
      'address_state', v_full ->> 'address_state', 'delivery_state', v_full ->> 'delivery_state',
      'request_token', v_full ->> 'request_token', 'watch_token', v_full ->> 'watch_token',
      'note', o.note, 'created_at', o.created_at, 'delivered_at', o.delivered_at)));
end $$;

-- ---------------------------------------------------------------- mesure (événements ajoutés)
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
    or (p_event = 'delivery_started' and p_variant in ('request', 'place', 'order'))
    or (p_event = 'tracking_shared'  and p_variant in ('courier', 'guest'))
    or (p_event = 'meeting_joined'   and p_variant = 'guest')
    or (p_event = 'account_created'  and p_variant = 'account')
    or (p_event = 'shop_created'     and p_variant = 'shop')
    or (p_event = 'order_created'    and p_variant in ('new_customer', 'known_customer', 'known_address'))
    or (p_event = 'invoice_opened'   and p_variant = 'order')
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
revoke execute on function
  public.fiila_me(), public.fiila_profile_save(jsonb), public.fiila_claim(jsonb),
  public.fiila_set_tag(text, text, text), public.fiila_delete_account(),
  public.fiila_shop_get(), public.fiila_shop_save(jsonb),
  public.fiila_customers(text), public.fiila_customer_save(jsonb), public.fiila_customer_get(text), public.fiila_customer_delete(text),
  public.fiila_order_create(jsonb), public.fiila_orders(text), public.fiila_order_get(text),
  public.fiila_order_set_status(text, text), public.fiila_order_payment_add(text, bigint, text),
  public.fiila_order_payment_delete(text, text), public.fiila_order_request_address(text),
  public.fiila_order_delivery(text), public.fiila_order_public(text)
from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function
        public.fiila_me(), public.fiila_profile_save(jsonb), public.fiila_claim(jsonb),
        public.fiila_set_tag(text, text, text), public.fiila_delete_account(),
        public.fiila_shop_get(), public.fiila_shop_save(jsonb),
        public.fiila_customers(text), public.fiila_customer_save(jsonb), public.fiila_customer_get(text), public.fiila_customer_delete(text),
        public.fiila_order_create(jsonb), public.fiila_orders(text), public.fiila_order_get(text),
        public.fiila_order_set_status(text, text), public.fiila_order_payment_add(text, bigint, text),
        public.fiila_order_payment_delete(text, text), public.fiila_order_request_address(text),
        public.fiila_order_delivery(text), public.fiila_order_public(text)
        to %I', role_name);
    end if;
  end loop;
end $$;
