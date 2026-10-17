-- Fii La — boutique sans compte obligatoire, catalogue d'articles avec photo, notes des acheteurs. 17/10/2026.
--
-- Décision du fondateur (17/10, 21:06) : personne n'est bloqué par la création de compte.
-- Une boutique se crée en un geste et se gère depuis le téléphone qui l'a créée, avec sa clé
-- (comme une fiche d'adresse). Le compte est proposé ensuite, jamais imposé : il rattache la boutique
-- pour la retrouver sur tous ses téléphones.
--
-- Chaque fonction de boutique reçoit p_key (clé de la boutique sur ce téléphone, ou null).
-- Accès accordé si la clé correspond, OU si le compte connecté possède la boutique.

alter table fiila.shops alter column user_id drop not null;
alter table fiila.shops add column owner_hash bytea unique;
alter table fiila.shops add constraint shops_owner_present check (user_id is not null or owner_hash is not null);

-- Catalogue : articles avec photo, prix en FCFA. Base de la future vitrine publique (marketplace).
create table fiila.products (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references fiila.shops (id) on delete cascade,
  name        text not null,
  price       bigint not null check (price >= 0),
  description text,
  photo       bytea,
  photo_type  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_shop on fiila.products (shop_id, active, updated_at desc);

-- Notes : seulement par l'acheteur, depuis le lien de sa commande livrée (achat vérifié), une par article et par commande.
create table fiila.reviews (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references fiila.products (id) on delete cascade,
  order_id   uuid not null references fiila.orders (id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, product_id)
);
create index reviews_product on fiila.reviews (product_id);
revoke all on fiila.products, fiila.reviews from public;

-- ---------------------------------------------------------------- accès boutique : clé OU compte
drop function if exists public.fiila_shop_get();
drop function if exists public.fiila_shop_save(jsonb);
drop function if exists public.fiila_customers(text);
drop function if exists public.fiila_customer_save(jsonb);
drop function if exists public.fiila_customer_get(text);
drop function if exists public.fiila_customer_delete(text);
drop function if exists public.fiila_order_create(jsonb);
drop function if exists public.fiila_orders(text);
drop function if exists public.fiila_order_get(text);
drop function if exists public.fiila_order_set_status(text, text);
drop function if exists public.fiila_order_payment_add(text, bigint, text);
drop function if exists public.fiila_order_payment_delete(text, text);
drop function if exists public.fiila_order_request_address(text);
drop function if exists public.fiila_order_delivery(text);
drop function if exists fiila.my_order(text);
drop function if exists fiila.my_shop();

create or replace function fiila.my_shop(p_key text) returns fiila.shops
language plpgsql set search_path = '' as $$
declare s fiila.shops; v_uid uuid := fiila.uid();
begin
  if p_key is not null and char_length(p_key) <= 100 then
    select * into s from fiila.shops where owner_hash = fiila.h(p_key) for update;
    if found then return s; end if;
  end if;
  if v_uid is not null then
    select * into s from fiila.shops where user_id = v_uid for update;
    if found then return s; end if;
  end if;
  perform fiila.fail('shop_required');
  return s;
end $$;

create or replace function fiila.my_order(p_key text, p_id text) returns fiila.orders
language plpgsql set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); o fiila.orders;
begin
  select * into o from fiila.orders where id = fiila.as_uuid(p_id) and shop_id = s.id for update;
  if not found then perform fiila.fail('order_not_found'); end if;
  return fiila.order_sync(o.id);
end $$;

-- Photos des articles du catalogue, ajoutées aux lignes de commande qui en viennent.
create or replace function fiila.items_with_photos(p_items jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(case
      when pr.photo is not null then it || jsonb_build_object('photo',
        'data:' || pr.photo_type || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', ''))
      else it end order by ord), '[]'::jsonb)
  from jsonb_array_elements(p_items) with ordinality as x(it, ord)
  left join fiila.products pr on pr.id = fiila.as_uuid(it ->> 'product_id')
$$;

create or replace function fiila.product_json(p fiila.products, p_photo boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'name', p.name, 'price', p.price, 'description', p.description, 'active', p.active,
    'photo', case when p_photo and p.photo is not null
                  then 'data:' || p.photo_type || ';base64,' || replace(encode(p.photo, 'base64'), E'\n', '') end,
    'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = p.id),
    'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = p.id),
    'updated_at', p.updated_at))
$$;

-- ----- boutique
create or replace function public.fiila_shop_get(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops;
begin
  begin
    s := fiila.my_shop(p_key);
  exception when others then
    return jsonb_build_object('shop', null);
  end;
  return jsonb_build_object('shop', fiila.shop_json(s) || jsonb_build_object('account', s.user_id is not null),
    'stats', (select jsonb_build_object(
      'open', count(*) filter (where o.status = 'open'),
      'unpaid', count(*) filter (where o.status <> 'cancelled' and fiila.order_paid(o.id) < o.total),
      'customers', (select count(*) from fiila.customers c where c.shop_id = s.id),
      'products', (select count(*) from fiila.products pr where pr.shop_id = s.id and pr.active))
      from fiila.orders o where o.shop_id = s.id));
end $$;

-- Création sans compte : renvoie la clé de la boutique (à garder sur le téléphone), une seule fois.
create or replace function public.fiila_shop_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); v_name text; v_phone text; v_ninea text; s fiila.shops; v_key text;
begin
  perform fiila.rate_check('shop_save', 60);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name  := fiila.clean(p ->> 'name', 60);
  v_phone := fiila.clean_phone(p ->> 'phone');
  v_ninea := fiila.clean(p ->> 'ninea', 30);
  if v_name is null then perform fiila.fail('shop_name_required'); end if;
  begin
    s := fiila.my_shop(p_key);
  exception when others then
    s := null;
  end;
  if s.id is not null then
    update fiila.shops set name = v_name, phone = v_phone, ninea = v_ninea, updated_at = now() where id = s.id returning * into s;
    return jsonb_build_object('shop', fiila.shop_json(s));
  end if;
  v_key := fiila.token(32);
  insert into fiila.shops (user_id, owner_hash, name, phone, ninea) values (v_uid, fiila.h(v_key), v_name, v_phone, v_ninea)
  returning * into s;
  return jsonb_build_object('shop', fiila.shop_json(s), 'key', v_key);
end $$;

-- Rattache au compte connecté la boutique de ce téléphone (si le compte n'en a pas déjà une).
create or replace function public.fiila_shop_claim(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); s fiila.shops;
begin
  perform fiila.rate_check('claim', 60);
  if p_key is null then return jsonb_build_object('claimed', false); end if;
  select * into s from fiila.shops where owner_hash = fiila.h(p_key) for update;
  if not found then return jsonb_build_object('claimed', false); end if;
  if s.user_id = v_uid then return jsonb_build_object('claimed', true); end if;
  if s.user_id is not null then return jsonb_build_object('claimed', false, 'reason', 'other_account'); end if;
  if exists (select 1 from fiila.shops where user_id = v_uid) then return jsonb_build_object('claimed', false, 'reason', 'has_shop'); end if;
  update fiila.shops set user_id = v_uid, updated_at = now() where id = s.id;
  return jsonb_build_object('claimed', true);
end $$;

-- ----- articles
create or replace function public.fiila_products(p_key text, p_all boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  return coalesce((select jsonb_agg(fiila.product_json(pr, true) order by pr.active desc, pr.updated_at desc)
    from fiila.products pr where pr.shop_id = s.id and (coalesce(p_all, false) or pr.active)), '[]'::jsonb);
end $$;

-- p : {id?, name, price, description, photo (absent = inchangée, '' = retirée, base64 = remplacée), active}
create or replace function public.fiila_product_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); pr fiila.products; v_id uuid; v_name text; v_price bigint; v_ph record;
begin
  perform fiila.rate_check('product_save', 600);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name := fiila.clean(p ->> 'name', 80);
  if v_name is null then perform fiila.fail('item_label_required'); end if;
  begin v_price := (p ->> 'price')::bigint; exception when others then perform fiila.fail('invalid_price'); end;
  if v_price is null or v_price < 0 or v_price > 100000000 then perform fiila.fail('invalid_price'); end if;
  v_id := fiila.as_uuid(p ->> 'id');
  if v_id is not null then
    select * into pr from fiila.products where id = v_id and shop_id = s.id for update;
    if not found then perform fiila.fail('product_not_found'); end if;
    update fiila.products set name = v_name, price = v_price, description = fiila.clean(p ->> 'description', 300),
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now() where id = pr.id returning * into pr;
  else
    if (select count(*) from fiila.products where shop_id = s.id) >= 500 then perform fiila.fail('too_many'); end if;
    insert into fiila.products (shop_id, name, price, description)
    values (s.id, v_name, v_price, fiila.clean(p ->> 'description', 300)) returning * into pr;
  end if;
  if p ? 'photo' then
    if coalesce(p ->> 'photo', '') = '' then
      update fiila.products set photo = null, photo_type = null where id = pr.id;
    else
      select * into v_ph from fiila.photo_in(p ->> 'photo');
      if length(v_ph.data) > 300000 then perform fiila.fail('photo_too_large'); end if;
      update fiila.products set photo = v_ph.data, photo_type = v_ph.ctype where id = pr.id;
    end if;
  end if;
  select * into pr from fiila.products where id = pr.id;
  return fiila.product_json(pr, true);
end $$;

create or replace function public.fiila_product_delete(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  delete from fiila.products where id = fiila.as_uuid(p_id) and shop_id = s.id;
  if not found then perform fiila.fail('product_not_found'); end if;
  return jsonb_build_object('deleted', true);
end $$;

-- ----- clients
create or replace function public.fiila_customers(p_key text, p_query text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_q text := fiila.clean(p_query, 60);
begin
  return coalesce((select jsonb_agg(x.j order by x.u desc)
    from (select fiila.customer_json(c) as j, c.updated_at as u from fiila.customers c
           where c.shop_id = s.id
             and (v_q is null or c.name ilike '%' || v_q || '%' or coalesce(c.phone, '') like '%' || v_q || '%')
           order by c.updated_at desc limit 300) x), '[]'::jsonb);
end $$;

create or replace function public.fiila_customer_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); c fiila.customers;
begin
  perform fiila.rate_check('customer_save', 600);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  c := fiila.customer_upsert(s, fiila.as_uuid(p ->> 'id'), fiila.clean(p ->> 'name', 60),
         fiila.clean_phone(p ->> 'phone'), fiila.clean(p ->> 'note', 200));
  return fiila.customer_json(c);
end $$;

create or replace function public.fiila_customer_get(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); c fiila.customers;
begin
  select * into c from fiila.customers where id = fiila.as_uuid(p_id) and shop_id = s.id;
  if not found then perform fiila.fail('customer_not_found'); end if;
  return fiila.customer_json(c) || jsonb_build_object('order_list', coalesce((
    select jsonb_agg(fiila.order_json(o, false) order by o.number desc)
      from fiila.orders o where o.customer_id = c.id), '[]'::jsonb));
end $$;

create or replace function public.fiila_customer_delete(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  delete from fiila.customers where id = fiila.as_uuid(p_id) and shop_id = s.id;
  if not found then perform fiila.fail('customer_not_found'); end if;
  return jsonb_build_object('deleted', true);
end $$;

-- ----- commandes
-- p : {customer_id | customer: {name, phone}, items: [{product_id?, label, qty, price}], note}
create or replace function public.fiila_order_create(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s fiila.shops := fiila.my_shop(p_key); c fiila.customers; o fiila.orders;
  it jsonb; v_items jsonb := '[]'::jsonb; v_label text; v_qty bigint; v_price bigint; v_total bigint := 0;
  v_place uuid; v_num int; v_pid uuid;
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
    v_pid := null;
    if it ->> 'product_id' is not null then
      select id into v_pid from fiila.products where id = fiila.as_uuid(it ->> 'product_id') and shop_id = s.id;
      if v_pid is null then perform fiila.fail('product_not_found'); end if;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('product_id', v_pid, 'label', v_label, 'qty', v_qty, 'price', v_price)));
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

create or replace function public.fiila_orders(p_key text, p_filter text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); o fiila.orders; v_out jsonb := '[]'::jsonb;
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

create or replace function public.fiila_order_get(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id); v jsonb;
begin
  v := fiila.order_json(o, true);
  return v || jsonb_build_object('items', fiila.items_with_photos(o.items));
end $$;

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
    update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb,
      expires_at = least(expires_at, now())
     where watch_token = o.watch_token;
  end if;
  return fiila.order_json(o, true) || jsonb_build_object('items', fiila.items_with_photos(o.items));
end $$;

create or replace function public.fiila_order_payment_add(p_key text, p_id text, p_amount bigint, p_method text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id);
begin
  perform fiila.rate_check('payment_add', 600);
  if p_amount is null or p_amount < 1 or p_amount > 2000000000 then perform fiila.fail('invalid_price'); end if;
  if p_method not in ('cash', 'wave', 'orange_money', 'card', 'other') then perform fiila.fail('invalid_method'); end if;
  if (select count(*) from fiila.payments where order_id = o.id) >= 50 then perform fiila.fail('too_many'); end if;
  insert into fiila.payments (order_id, amount, method) values (o.id, p_amount, p_method);
  return fiila.order_json(o, true) || jsonb_build_object('items', fiila.items_with_photos(o.items));
end $$;

create or replace function public.fiila_order_payment_delete(p_key text, p_id text, p_payment_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id);
begin
  delete from fiila.payments where id = fiila.as_uuid(p_payment_id) and order_id = o.id and source = 'manual';
  if not found then perform fiila.fail('payment_not_found'); end if;
  return fiila.order_json(o, true) || jsonb_build_object('items', fiila.items_with_photos(o.items));
end $$;

create or replace function public.fiila_order_request_address(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id); s fiila.shops;
begin
  perform fiila.rate_check('create_request', 40);
  select * into s from fiila.shops where id = o.shop_id;
  if fiila.order_address_state(o) in ('received', 'pending') then perform fiila.fail('address_already'); end if;
  update fiila.orders set place_id = null where id = o.id returning * into o;
  perform fiila.order_new_request(s, o);
  select * into o from fiila.orders where id = o.id;
  return fiila.order_json(o, true) || jsonb_build_object('items', fiila.items_with_photos(o.items));
end $$;

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

-- ----- facture publique : photos des articles, notes de l'acheteur une fois livrée
create or replace function public.fiila_order_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders; s fiila.shops; v_full jsonb; v_items jsonb;
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
  -- l'acheteur voit sa propre note sur chaque article
  select coalesce(jsonb_agg(case when r.rating is not null then it || jsonb_build_object('my_rating', r.rating) else it end order by ord), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(fiila.items_with_photos(o.items)) with ordinality as x(it, ord)
    left join fiila.reviews r on r.order_id = o.id and r.product_id = fiila.as_uuid(it ->> 'product_id');
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'phone', s.phone, 'ninea', s.ninea)),
    'order', jsonb_strip_nulls(jsonb_build_object(
      'ref', v_full ->> 'ref', 'customer_name', o.customer_name, 'items', v_items, 'total', o.total,
      'paid', v_full -> 'paid', 'pay_state', v_full ->> 'pay_state',
      'address_state', v_full ->> 'address_state', 'delivery_state', v_full ->> 'delivery_state',
      'request_token', v_full ->> 'request_token', 'watch_token', v_full ->> 'watch_token',
      'can_review', o.status = 'delivered',
      'note', o.note, 'created_at', o.created_at, 'delivered_at', o.delivered_at)));
end $$;

-- Note d'un article par l'acheteur : commande livrée, article présent dans la commande. Modifiable.
create or replace function public.fiila_review(p_token text, p_product_id text, p_rating int, p_comment text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders; v_pid uuid := fiila.as_uuid(p_product_id);
begin
  perform fiila.rate_check('review', 120);
  if not fiila.valid_token(p_token) then perform fiila.fail('order_not_found'); end if;
  select * into o from fiila.orders where share_token = p_token;
  if not found then perform fiila.fail('order_not_found'); end if;
  if o.status <> 'delivered' then perform fiila.fail('not_delivered'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then perform fiila.fail('invalid_rating'); end if;
  if v_pid is null or not exists (select 1 from jsonb_array_elements(o.items) it where fiila.as_uuid(it ->> 'product_id') = v_pid)
     or not exists (select 1 from fiila.products where id = v_pid) then
    perform fiila.fail('product_not_found');
  end if;
  insert into fiila.reviews (product_id, order_id, rating, comment) values (v_pid, o.id, p_rating, fiila.clean(p_comment, 300))
  on conflict (order_id, product_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = now();
  return jsonb_build_object('rating', p_rating);
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
    or (p_event = 'delivery_started' and p_variant in ('request', 'place', 'order'))
    or (p_event = 'tracking_shared'  and p_variant in ('courier', 'guest'))
    or (p_event = 'meeting_joined'   and p_variant = 'guest')
    or (p_event = 'account_created'  and p_variant in ('account', 'shop', 'nudge'))
    or (p_event = 'account_nudge'    and p_variant in ('shown', 'dismissed'))
    or (p_event = 'shop_created'     and p_variant in ('shop', 'no_account', 'account'))
    or (p_event = 'product_created'  and p_variant in ('photo', 'no_photo'))
    or (p_event = 'order_created'    and p_variant in ('new_customer', 'known_customer', 'known_address'))
    or (p_event = 'invoice_opened'   and p_variant = 'order')
    or (p_event = 'review_left'      and p_variant in ('1', '2', '3', '4', '5'))
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
    'public.fiila_shop_get(text)', 'public.fiila_shop_save(text, jsonb)', 'public.fiila_shop_claim(text)',
    'public.fiila_products(text, boolean)', 'public.fiila_product_save(text, jsonb)', 'public.fiila_product_delete(text, text)',
    'public.fiila_customers(text, text)', 'public.fiila_customer_save(text, jsonb)', 'public.fiila_customer_get(text, text)',
    'public.fiila_customer_delete(text, text)', 'public.fiila_order_create(text, jsonb)', 'public.fiila_orders(text, text)',
    'public.fiila_order_get(text, text)', 'public.fiila_order_set_status(text, text, text)',
    'public.fiila_order_payment_add(text, text, bigint, text)', 'public.fiila_order_payment_delete(text, text, text)',
    'public.fiila_order_request_address(text, text)', 'public.fiila_order_delivery(text, text)',
    'public.fiila_order_public(text)', 'public.fiila_review(text, text, integer, text)', 'public.fiila_track(text, text)'];
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
