-- Fii La : origine des nouveaux utilisateurs, parrainage par lien, code ou numéro, journal des publications d'articles,
-- statistiques réservées au fondateur. Proposition docs/CROISSANCE.md, phase 0 validée le 17/10/2026 23:10.
-- Les récompenses ne sont pas encore fixées : on enregistre et on compte, on ne récompense pas encore.

-- ---------------------------------------------------------------- tables
-- Un parrain : une boutique, un livreur, ou un particulier (fiche de parrainage, avec ou sans compte).
create table fiila.referrers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                           -- 6 caractères, sans 0/O/1/I
  owner_hash bytea unique,                                   -- clé du particulier sans compte
  user_id    uuid unique references auth.users (id) on delete cascade,
  shop_id    uuid unique references fiila.shops (id) on delete cascade,
  courier_id uuid unique references fiila.couriers (id) on delete cascade,
  name       text,
  phone_key  text,                                           -- numéro normalisé, jamais renvoyé au public
  created_at timestamptz not null default now(),
  constraint referrers_one_owner check (
    (shop_id is not null)::int + (courier_id is not null)::int + (owner_hash is not null or user_id is not null)::int = 1)
);
create index referrers_phone on fiila.referrers (phone_key) where phone_key is not null;

-- Une arrivée : d'où vient chaque boutique, livreur, adresse ou rendez-vous, et qui l'a amené (s'il est connu).
create table fiila.referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid references fiila.referrers (id) on delete set null,
  phone_key   text,                                          -- numéro donné mais pas encore inscrit : rattaché plus tard
  kind        text not null check (kind in ('shop', 'courier', 'address', 'meeting')),
  shop_id     uuid unique references fiila.shops (id) on delete cascade,
  courier_id  uuid unique references fiila.couriers (id) on delete cascade,
  place_id    uuid unique references fiila.places (id) on delete cascade,
  source      text not null check (source in ('code', 'phone', 'link', 'request', 'invoice', 'address', 'meeting',
                                              'course', 'watch', 'courier_invite', 'post', 'direct')),
  created_at  timestamptz not null default now(),
  constraint referrals_one_target check (
    (shop_id is not null)::int + (courier_id is not null)::int + (place_id is not null)::int = 1)
);
create index referrals_referrer on fiila.referrals (referrer_id) where referrer_id is not null;
create index referrals_pending on fiila.referrals (phone_key) where referrer_id is null and phone_key is not null;
create index referrals_created on fiila.referrals (created_at);

-- Publications d'articles (partage depuis le téléphone). On ne sait pas sur quel réseau : la feuille de partage ne le dit pas.
create table fiila.posts (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references fiila.shops (id) on delete cascade,
  product_id uuid not null references fiila.products (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index posts_product on fiila.posts (product_id);

-- Accès aux statistiques : posé à la main par le fondateur (SQL), jamais depuis l'application.
alter table fiila.profiles add column is_admin boolean not null default false;

revoke all on fiila.referrers, fiila.referrals, fiila.posts from public;

-- ---------------------------------------------------------------- helpers
-- Numéro normalisé, ou null (phone_key renvoie une chaîne vide pour un numéro absent).
create or replace function fiila.ref_phone(p_text text) returns text
language sql immutable set search_path = '' as $$
  select nullif(fiila.phone_key(fiila.clean_phone(p_text)), '')
$$;
create or replace function fiila.ref_code() returns text
language plpgsql set search_path = '' as $$
declare v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_b bytea; v_code text; i int;
begin
  loop
    v_b := extensions.gen_random_bytes(6); v_code := '';
    for i in 0..5 loop v_code := v_code || substr(v_alpha, 1 + (get_byte(v_b, i) % 32), 1); end loop;
    exit when not exists (select 1 from fiila.referrers where code = v_code);
  end loop;
  return v_code;
end $$;

-- Rattache les arrivées « en attente » (numéro donné avant que la personne soit inscrite comme parrain).
create or replace function fiila.ref_link_pending(r fiila.referrers) returns void
language sql set search_path = '' as $$
  update fiila.referrals x set referrer_id = r.id
   where r.phone_key is not null and x.referrer_id is null and x.phone_key = r.phone_key
     -- jamais soi-même : la boutique ou le livreur parrain n'est pas l'arrivée elle-même
     and (r.shop_id is null or x.shop_id is distinct from r.shop_id)
     and (r.courier_id is null or x.courier_id is distinct from r.courier_id);
$$;

create or replace function fiila.ref_for_shop(p_shop uuid) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare r fiila.referrers; s fiila.shops;
begin
  select * into r from fiila.referrers where shop_id = p_shop;
  if found then return r; end if;
  select * into s from fiila.shops where id = p_shop;
  insert into fiila.referrers (code, shop_id, name, phone_key)
  values (fiila.ref_code(), s.id, s.name, fiila.ref_phone(s.phone)) returning * into r;
  perform fiila.ref_link_pending(r);
  return r;
end $$;

create or replace function fiila.ref_for_courier(p_courier uuid) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare r fiila.referrers; c fiila.couriers;
begin
  select * into r from fiila.referrers where courier_id = p_courier;
  if found then return r; end if;
  select * into c from fiila.couriers where id = p_courier;
  insert into fiila.referrers (code, courier_id, name, phone_key)
  values (fiila.ref_code(), c.id, c.name, fiila.ref_phone(c.phone)) returning * into r;
  perform fiila.ref_link_pending(r);
  return r;
end $$;

-- Particulier avec compte : sa fiche de parrainage, créée au besoin (nom et numéro du profil).
create or replace function fiila.ref_for_user(p_uid uuid) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare r fiila.referrers; pr fiila.profiles;
begin
  select * into r from fiila.referrers where user_id = p_uid;
  if found then return r; end if;
  select * into pr from fiila.profiles where user_id = p_uid;
  insert into fiila.referrers (code, user_id, name, phone_key)
  values (fiila.ref_code(), p_uid, pr.display_name, fiila.ref_phone(pr.phone)) returning * into r;
  perform fiila.ref_link_pending(r);
  return r;
end $$;

-- Parrain d'un numéro : fiche existante, sinon boutique, livreur ou profil qui porte ce numéro.
create or replace function fiila.ref_by_phone(p_key text) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare r fiila.referrers; v_id uuid;
begin
  if p_key is null then return null; end if;
  select * into r from fiila.referrers where phone_key = p_key order by created_at limit 1;
  if found then return r; end if;
  select id into v_id from fiila.shops where fiila.ref_phone(phone) = p_key order by created_at limit 1;
  if v_id is not null then return fiila.ref_for_shop(v_id); end if;
  select id into v_id from fiila.couriers where fiila.ref_phone(phone) = p_key order by created_at limit 1;
  if v_id is not null then return fiila.ref_for_courier(v_id); end if;
  select user_id into v_id from fiila.profiles where fiila.ref_phone(phone) = p_key order by created_at limit 1;
  if v_id is not null then return fiila.ref_for_user(v_id); end if;
  return null;
end $$;

-- Parrain derrière un lien reçu (demande, facture, adresse, rendez-vous, course, suivi, invitation de livreur).
create or replace function fiila.ref_by_link(p_src text, p_token text) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare v_shop uuid; v_courier uuid; v_uid uuid;
begin
  if p_token is null or char_length(p_token) > 100 then return null; end if;
  if p_src = 'request' then
    select o.shop_id into v_shop from fiila.requests q join fiila.orders o on o.request_id = q.id where q.share_token = p_token limit 1;
    if v_shop is null then select user_id into v_uid from fiila.requests where share_token = p_token; end if;
  elsif p_src = 'invoice' then
    select shop_id into v_shop from fiila.orders where share_token = p_token;
  elsif p_src in ('address', 'meeting') then
    select user_id into v_uid from fiila.places where share_token = p_token;
  elsif p_src = 'course' then
    select courier_id into v_courier from fiila.trackers where send_hash = fiila.h(p_token);
  elsif p_src = 'watch' then
    select o.shop_id into v_shop from fiila.orders o where o.watch_token = p_token;
  elsif p_src = 'courier_invite' then
    select shop_id into v_shop from fiila.courier_invites where token_hash = fiila.h(p_token);
  end if;
  if v_shop is not null then return fiila.ref_for_shop(v_shop); end if;
  if v_courier is not null then return fiila.ref_for_courier(v_courier); end if;
  if v_uid is not null then return fiila.ref_for_user(v_uid); end if;
  return null;
end $$;

-- Arrivée « active » : la règle anti-fraude de la proposition (une adresse ou un rendez-vous compte dès qu'il existe).
create or replace function fiila.ref_active(x fiila.referrals) returns boolean
language sql stable set search_path = '' as $$
  select case
    when x.shop_id is not null then
      (select count(distinct coalesce(o.customer_id::text, fiila.ref_phone(o.customer_phone), lower(o.customer_name))) >= 3
              and bool_or(o.status = 'delivered')
         from fiila.orders o where o.shop_id = x.shop_id and o.status <> 'cancelled')
    when x.courier_id is not null then exists (select 1 from fiila.trackers t where t.courier_id = x.courier_id and t.done_at is not null)
    else exists (select 1 from fiila.places p where p.id = x.place_id and p.status = 'active')
  end
$$;

create or replace function fiila.referrer_json(r fiila.referrers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'code', r.code, 'name', r.name,
    'kind', case when r.shop_id is not null then 'shop' when r.courier_id is not null then 'courier' else 'person' end,
    'has_phone', r.phone_key is not null,
    'joined', (select count(*) from fiila.referrals x where x.referrer_id = r.id),
    'active', (select count(*) from fiila.referrals x where x.referrer_id = r.id and coalesce(fiila.ref_active(x), false)),
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
                  from (select kind, count(*) n from fiila.referrals x where x.referrer_id = r.id group by kind) k),
    'recent', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'kind', x.kind,
                  -- nom public pour une boutique, prénom pour un livreur, rien pour l'adresse d'un particulier
                  'label', case when x.shop_id is not null then (select s.name from fiila.shops s where s.id = x.shop_id)
                                when x.courier_id is not null then (select split_part(c.name, ' ', 1) from fiila.couriers c where c.id = x.courier_id) end,
                  'active', coalesce(fiila.ref_active(x), false),
                  'at', x.created_at)) order by x.created_at desc), '[]'::jsonb)
                 from fiila.referrals x
                where x.id in (select y.id from fiila.referrals y where y.referrer_id = r.id order by y.created_at desc limit 20)))
$$;

-- Fiche de parrainage du particulier : par sa clé, sinon par son compte.
create or replace function fiila.my_person_ref(p_key text) returns fiila.referrers
language plpgsql set search_path = '' as $$
declare r fiila.referrers; v_uid uuid := fiila.uid();
begin
  if p_key is not null and char_length(p_key) <= 100 then
    select * into r from fiila.referrers where owner_hash = fiila.h(p_key) for update;
    if found then return r; end if;
  end if;
  if v_uid is not null then
    select * into r from fiila.referrers where user_id = v_uid for update;
    if found then return r; end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- API
-- Espace « Parrainer ». p_for : 'shop' (clé de boutique), 'courier' (clé de livreur), 'person' (clé de fiche ou compte).
create or replace function public.fiila_referral_me(p_for text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.referrers; s fiila.shops; c fiila.couriers;
begin
  perform fiila.read_check();
  if p_for = 'shop' then s := fiila.my_shop(p_key); r := fiila.ref_for_shop(s.id);
  elsif p_for = 'courier' then c := fiila.my_courier(p_key); r := fiila.ref_for_courier(c.id);
  elsif p_for = 'person' then
    r := fiila.my_person_ref(p_key);
    if r.id is null and fiila.uid() is not null then r := fiila.ref_for_user(fiila.uid()); end if;
    if r.id is null then return jsonb_build_object('referrer', null); end if;
  else perform fiila.fail('invalid_payload');
  end if;
  return jsonb_build_object('referrer', fiila.referrer_json(r));
end $$;

-- Créer ou modifier sa fiche de parrainage de particulier. p : {name, phone}. La clé n'est renvoyée qu'à la création.
create or replace function public.fiila_referral_card_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.referrers := fiila.my_person_ref(p_key); v_key text; v_name text; v_phone text;
begin
  perform fiila.rate_check('referral_card', 20);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name := fiila.clean(p ->> 'name', 60);
  if v_name is null then perform fiila.fail('name_required'); end if;
  v_phone := fiila.ref_phone(p ->> 'phone');
  if p ? 'phone' and nullif(trim(p ->> 'phone'), '') is not null and v_phone is null then perform fiila.fail('invalid_phone'); end if;
  if r.id is null then
    if fiila.uid() is null then v_key := fiila.token(32); end if;
    insert into fiila.referrers (code, owner_hash, user_id, name, phone_key)
    values (fiila.ref_code(), case when v_key is not null then fiila.h(v_key) end, fiila.uid(), v_name, v_phone)
    returning * into r;
  else
    update fiila.referrers set name = v_name, phone_key = coalesce(v_phone, phone_key) where id = r.id returning * into r;
  end if;
  perform fiila.ref_link_pending(r);
  return jsonb_build_object('key', v_key, 'referrer', fiila.referrer_json(r));
end $$;

-- Supprimer sa fiche de parrainage de particulier (nom et numéro effacés ; les arrivées restent, sans parrain).
create or replace function public.fiila_referral_card_delete(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.referrers := fiila.my_person_ref(p_key);
begin
  perform fiila.rate_check('referral_card', 20);
  if r.id is null then perform fiila.fail('not_found'); end if;
  delete from fiila.referrers where id = r.id;
  return jsonb_build_object('deleted', true);
end $$;

-- Page d'arrivée d'un lien de parrainage : seulement le prénom et le type de parrain.
create or replace function public.fiila_referral_public(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r fiila.referrers;
begin
  perform fiila.read_check();
  select * into r from fiila.referrers where code = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  return jsonb_build_object('state', 'ok',
    'name', case when r.shop_id is not null then r.name else nullif(split_part(coalesce(r.name, ''), ' ', 1), '') end,
    'kind', case when r.shop_id is not null then 'shop' when r.courier_id is not null then 'courier' else 'person' end);
end $$;

-- Enregistrer l'origine d'une création, juste après celle-ci (moins d'une heure), une seule fois.
-- p_kind : shop | courier | address | meeting ; p_key : clé de la boutique, du livreur ou de la fiche (ou le compte).
-- p : {code?, phone?, src?, token?}. Ordre : code tapé, numéro tapé, lien de parrainage, lien reçu, sinon « direct ».
-- Réponse toujours neutre : on ne dit jamais si un numéro est inscrit.
create or replace function public.fiila_attribute(p_kind text, p_id text, p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_courier uuid; v_place uuid; v_created timestamptz; v_self_phone text; v_self_uid uuid;
        r fiila.referrers; v_src text := 'direct'; v_pending text; v_phone text; v_code text; v_ctx text; v_tok text;
        s fiila.shops; c fiila.couriers; pl fiila.places;
begin
  perform fiila.rate_check('attribute', 60);
  if p is null then p := '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if p_kind = 'shop' then
    s := fiila.my_shop(p_key); v_shop := s.id; v_created := s.created_at; v_self_phone := fiila.ref_phone(s.phone); v_self_uid := s.user_id;
  elsif p_kind = 'courier' then
    c := fiila.my_courier(p_key); v_courier := c.id; v_created := c.created_at; v_self_phone := fiila.ref_phone(c.phone); v_self_uid := c.user_id;
  elsif p_kind in ('address', 'meeting') then
    pl := fiila.owned_place(p_id, p_key);
    if pl.kind <> p_kind then perform fiila.fail('not_found'); end if;
    v_place := pl.id; v_created := pl.created_at; v_self_uid := pl.user_id;
  else perform fiila.fail('invalid_payload');
  end if;
  if v_created < now() - interval '1 hour'
     or exists (select 1 from fiila.referrals where shop_id = v_shop or courier_id = v_courier or place_id = v_place) then
    return jsonb_build_object('ok', true);
  end if;

  v_code := upper(trim(coalesce(p ->> 'code', '')));
  v_phone := fiila.ref_phone(p ->> 'phone');
  v_ctx := p ->> 'src'; v_tok := p ->> 'token';
  if v_code ~ '^[A-Z0-9]{6}$' then
    select * into r from fiila.referrers where code = v_code;
    if r.id is not null then v_src := 'code'; end if;
  end if;
  if r.id is null and v_phone is not null then
    r := fiila.ref_by_phone(v_phone); v_src := 'phone';
    if r.id is null then v_pending := v_phone; end if;
  end if;
  if r.id is null and v_pending is null and v_ctx = 'link' and v_tok ~ '^[A-Za-z0-9]{6}$' then
    select * into r from fiila.referrers where code = upper(v_tok);
    if r.id is not null then v_src := 'link'; end if;
  end if;
  if r.id is null and v_pending is null
     and v_ctx in ('request', 'invoice', 'address', 'meeting', 'course', 'watch', 'courier_invite') then
    v_src := v_ctx;
    if v_ctx = 'address' then v_src := coalesce((select kind from fiila.places where share_token = v_tok), 'address'); end if;
    r := fiila.ref_by_link(v_ctx, v_tok);
  end if;

  -- Jamais soi-même : même boutique, même livreur, même compte ou même numéro.
  if r.id is not null and (r.shop_id is not distinct from v_shop and v_shop is not null
       or r.courier_id is not distinct from v_courier and v_courier is not null
       or (v_self_uid is not null and r.user_id = v_self_uid)
       or (fiila.uid() is not null and r.user_id = fiila.uid())
       or (v_self_phone is not null and r.phone_key = v_self_phone)) then
    r := null;
  end if;
  if v_pending is not null and v_pending = v_self_phone then v_pending := null; end if;

  insert into fiila.referrals (referrer_id, phone_key, kind, shop_id, courier_id, place_id, source)
  values (r.id, v_pending, p_kind, v_shop, v_courier, v_place, v_src);
  return jsonb_build_object('ok', true);
end $$;

-- Journal d'une publication d'article (appelé quand le partage a abouti). Renvoie le nombre de publications de l'article.
create or replace function public.fiila_post_log(p_key text, p_product_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_id uuid := fiila.as_uuid(p_product_id);
begin
  perform fiila.rate_check('post_log', 300);
  if v_id is null or not exists (select 1 from fiila.products where id = v_id and shop_id = s.id) then perform fiila.fail('not_found'); end if;
  insert into fiila.posts (shop_id, product_id) values (s.id, v_id);
  return jsonb_build_object('posts', (select count(*) from fiila.posts where product_id = v_id));
end $$;

-- Articles : on ajoute le nombre de publications.
create or replace function public.fiila_products(p_key text, p_all boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  return coalesce((select jsonb_agg(fiila.product_json(pr, true)
                     || jsonb_strip_nulls(jsonb_build_object('posts', (select nullif(count(*), 0) from fiila.posts po where po.product_id = pr.id)))
                     order by pr.active desc, pr.updated_at desc)
    from fiila.products pr where pr.shop_id = s.id and (coalesce(p_all, false) or pr.active)), '[]'::jsonb);
end $$;

-- Statistiques de croissance, réservées aux comptes marqués administrateurs (chiffres agrégés, aucune donnée personnelle).
create or replace function public.fiila_admin_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  if not exists (select 1 from fiila.profiles where user_id = v_uid and is_admin) then perform fiila.fail('not_allowed'); end if;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'shops', (select count(*) from fiila.shops),
      'couriers', (select count(*) from fiila.couriers),
      'addresses', (select count(*) from fiila.places where kind = 'address' and status = 'active'),
      'meetings', (select count(*) from fiila.places where kind = 'meeting' and status = 'active'),
      'orders', (select count(*) from fiila.orders),
      'delivered', (select count(*) from fiila.orders where status = 'delivered'),
      'posts', (select count(*) from fiila.posts),
      'referrers', (select count(*) from fiila.referrers),
      'referred', (select count(*) from fiila.referrals where referrer_id is not null),
      'pending_phone', (select count(*) from fiila.referrals where referrer_id is null and phone_key is not null)),
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(wk, 'YYYY-MM-DD'), 'kinds', kinds, 'total', total) order by wk desc), '[]'::jsonb)
                from (select wk, jsonb_object_agg(kind, n) kinds, sum(n) total
                        from (select date_trunc('week', created_at) wk, kind, count(*) n from fiila.referrals
                               where created_at > now() - interval '12 weeks' group by 1, 2) a
                       group by wk) z),
    'sources', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb)
                  from (select source, count(*) n from fiila.referrals where created_at > now() - interval '30 days' group by source) s),
    'top', (select coalesce(jsonb_agg(t order by (t ->> 'joined')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('code', r.code,
               'name', case when r.shop_id is not null then r.name else split_part(coalesce(r.name, ''), ' ', 1) end,
               'kind', case when r.shop_id is not null then 'shop' when r.courier_id is not null then 'courier' else 'person' end,
               'joined', count(x.id),
               'active', count(x.id) filter (where coalesce(fiila.ref_active(x), false))) t
        from fiila.referrers r join fiila.referrals x on x.referrer_id = r.id
       group by r.id order by count(x.id) desc limit 20) y));
end $$;

-- ---------------------------------------------------------------- droits
revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array[
    'public.fiila_referral_me(text, text)', 'public.fiila_referral_card_save(text, jsonb)', 'public.fiila_referral_card_delete(text)', 'public.fiila_referral_public(text)',
    'public.fiila_attribute(text, text, text, jsonb)', 'public.fiila_post_log(text, text)', 'public.fiila_products(text, boolean)',
    'public.fiila_admin_stats()'];
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
