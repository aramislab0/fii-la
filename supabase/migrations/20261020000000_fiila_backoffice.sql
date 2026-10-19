-- Fii La : back-office (fondateur, 19/10/2026 10:41 : « l'interface back-office qui me permettra de gérer toute la plateforme
-- en tant que super admin […] accès uniques et portail de connexion pour moi et les équipes qui rejoindront »).
--
-- 1. Équipe : chaque membre a SON compte (jamais de mot de passe partagé) et UN rôle. Le fondateur (compte déjà
--    administrateur) devient super admin. Les autres arrivent par invitation nominative (e-mail + rôle, lien valable 7 jours,
--    utilisable une fois, par le compte qui porte cet e-mail).
-- 2. Rôles et droits :
--      super_admin : tout, y compris l'équipe, les réglages et le journal ;
--      operations  : tableau de bord, boutiques (lecture et actions), commandes, comptes, fil, modération, vide-dressing, ambassadeurs, finances ;
--      moderation  : tableau de bord, boutiques (lecture et suspension), modération, vide-dressing ;
--      support     : tableau de bord, boutiques (lecture), commandes, comptes ;
--      finance     : tableau de bord, commandes, finances, ambassadeurs.
-- 3. Journal : toute action du back-office est écrite dans fiila.admin_log (qui, quoi, quand, sur quoi).
-- 4. Gestes sensibles (équipe, réglages) : connexion de moins de 15 minutes exigée (fiila.recent_login).
-- 5. Les fonctions d'administration existantes passent sur ces droits (plus de simple case « administrateur »).

-- ---------------------------------------------------------------- équipe
create table fiila.staff (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         text not null check (role in ('super_admin', 'operations', 'moderation', 'support', 'finance')),
  added_by     uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);
create table fiila.staff_invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  email      text not null,
  role       text not null check (role in ('super_admin', 'operations', 'moderation', 'support', 'finance')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  used_by    uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create table fiila.admin_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid references auth.users (id) on delete set null,
  actor       text,                       -- prénom et rôle au moment de l'action (gardé si le compte part)
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb
);
create index admin_log_at on fiila.admin_log (at desc);
revoke all on fiila.staff, fiila.staff_invites, fiila.admin_log from public;

-- Le fondateur (comptes déjà administrateurs) devient super admin.
insert into fiila.staff (user_id, role) select user_id, 'super_admin' from fiila.profiles where is_admin on conflict do nothing;

create or replace function fiila.staff_role(p_uid uuid) returns text
language sql stable set search_path = '' as $$ select role from fiila.staff where user_id = p_uid $$;

create or replace function fiila.staff_perms(p_role text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_role
    when 'super_admin' then array['dashboard', 'shops', 'shops_write', 'orders', 'accounts', 'feed', 'moderation', 'vide_dressing',
                                  'ambassadors', 'finance', 'settings', 'team', 'audit']
    when 'operations'  then array['dashboard', 'shops', 'shops_write', 'orders', 'accounts', 'feed', 'moderation', 'vide_dressing', 'ambassadors', 'finance']
    when 'moderation'  then array['dashboard', 'shops', 'shops_write', 'moderation', 'vide_dressing']
    when 'support'     then array['dashboard', 'shops', 'orders', 'accounts']
    when 'finance'     then array['dashboard', 'orders', 'finance', 'ambassadors']
    else array[]::text[] end
$$;

create or replace function fiila.staff_can(p_uid uuid, p_perm text) returns boolean
language sql stable set search_path = '' as $$
  select p_uid is not null and coalesce(p_perm = any (fiila.staff_perms(fiila.staff_role(p_uid))), false)
$$;

create or replace function fiila.need_staff(p_perm text) returns uuid
language plpgsql set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  if not fiila.staff_can(v_uid, p_perm) then perform fiila.fail('not_allowed'); end if;
  return v_uid;
end $$;

-- Journal d'une action du back-office.
create or replace function fiila.bo_log(p_action text, p_type text, p_id text, p_detail jsonb default null) returns void
language plpgsql set search_path = '' as $$
declare v_uid uuid := fiila.uid();
begin
  insert into fiila.admin_log (user_id, actor, action, target_type, target_id, detail)
  values (v_uid, (select coalesce(nullif(split_part(trim(p.display_name), ' ', 1), ''), 'Membre') || ' · ' || coalesce(fiila.staff_role(v_uid), '?')
                  from (select 1) x left join fiila.profiles p on p.user_id = v_uid),
          p_action, p_type, p_id, p_detail);
end $$;

-- Ancienne case « administrateur » : tenue à jour pour l'affichage (super admin), plus jamais utilisée pour un droit.
create or replace function fiila.staff_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update fiila.profiles set is_admin = false where user_id = old.user_id;
    return old;
  end if;
  insert into fiila.profiles (user_id) values (new.user_id) on conflict do nothing;
  update fiila.profiles set is_admin = (new.role = 'super_admin') where user_id = new.user_id;
  return new;
end $$;
create trigger staff_sync after insert or update or delete on fiila.staff for each row execute function fiila.staff_sync();

-- ---------------------------------------------------------------- droits des fonctions d'administration existantes
create or replace function fiila.is_admin() returns boolean
language sql stable set search_path = '' as $$ select fiila.staff_can(fiila.uid(), 'team') $$;
create or replace function fiila.need_admin() returns void
language plpgsql set search_path = '' as $$ begin perform fiila.need_staff('team'); end $$;

do $$
declare r record; v_def text; v_perm text;
  v_map jsonb := '{"fiila_admin_stats":"dashboard","fiila_admin_shop_types":"dashboard",
    "fiila_admin_ambassadors":"ambassadors","fiila_admin_ambassador_decide":"ambassadors","fiila_admin_reward":"ambassadors",
    "fiila_admin_vd":"vide_dressing","fiila_admin_vd_decide":"vide_dressing",
    "fiila_comments":"moderation","fiila_comment_delete":"moderation","fiila_admin_comments":"moderation","fiila_admin_comment_decide":"moderation"}';
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fiila_%'
             and (p.prosrc like '%and is_admin)%' or p.prosrc like '%fiila.need_admin()%') loop
    v_perm := coalesce(v_map ->> r.proname, 'team');
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, 'exists (select 1 from fiila.profiles where user_id = v_uid and is_admin)', format('fiila.staff_can(v_uid, %L)', v_perm));
    v_def := replace(v_def, 'perform fiila.need_admin();', format('perform fiila.need_staff(%L);', v_perm));
    execute v_def;
  end loop;
  -- Plus aucune fonction publique ne doit décider d'un droit avec l'ancienne case.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like 'fiila_%' and (p.prosrc like '%is_admin)%' or p.prosrc like '%need_admin()%')) then
    raise exception 'droit d''administration non converti';
  end if;
end $$;

-- ---------------------------------------------------------------- suspension d'une boutique
alter table fiila.shops add column suspended_at timestamptz, add column suspended_reason text;
-- Une boutique suspendue ne peut pas rouvrir sa vitrine elle-même.
create or replace function fiila.shop_suspended_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.suspended_at is not null and new.public and not old.public then perform fiila.fail('shop_suspended'); end if;
  return new;
end $$;
create trigger shops_suspended_guard before update of public on fiila.shops for each row execute function fiila.shop_suspended_guard();

-- ---------------------------------------------------------------- portail : qui suis-je ?
create or replace function public.fiila_bo_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); v_role text;
begin
  if v_uid is null then return jsonb_build_object('staff', false, 'auth', false); end if;
  v_role := fiila.staff_role(v_uid);
  if v_role is null then return jsonb_build_object('staff', false, 'auth', true); end if;
  update fiila.staff set last_seen_at = now() where user_id = v_uid and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  return jsonb_build_object('staff', true, 'auth', true, 'role', v_role, 'perms', to_jsonb(fiila.staff_perms(v_role)),
    'name', (select display_name from fiila.profiles where user_id = v_uid),
    'email', (select email from auth.users where id = v_uid));
end $$;

-- ---------------------------------------------------------------- tableau de bord
create or replace function public.fiila_bo_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('dashboard');
begin
  return jsonb_build_object(
    'kpis', jsonb_build_object(
      'accounts', (select count(*) from auth.users),
      'accounts_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'shops', (select count(*) from fiila.shops where not demo and not platform),
      'shops_open', (select count(*) from fiila.shops where public and not demo and not platform),
      'shops_7d', (select count(*) from fiila.shops where not demo and not platform and created_at > now() - interval '7 days'),
      'orders_30d', (select count(*) from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.demo and o.created_at > now() - interval '30 days'),
      'delivered_30d', (select count(*) from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.demo and o.status = 'delivered' and o.delivered_at > now() - interval '30 days'),
      'gmv_30d', (select coalesce(sum(o.total), 0) from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.demo and o.status = 'delivered' and o.delivered_at > now() - interval '30 days'),
      'addresses', (select count(*) from fiila.places where kind = 'address' and status = 'active'),
      'meetings', (select count(*) from fiila.places where kind = 'meeting' and status = 'active'),
      'couriers', (select count(*) from fiila.couriers),
      'ambassadors', (select count(*) from fiila.ambassadors where status = 'active'),
      'feed_left', 25 - (select count(*) from fiila.shops where featured_rank is not null)),
    'queues', jsonb_strip_nulls(jsonb_build_object(
      'vide_dressing', case when fiila.staff_can(v_uid, 'vide_dressing') then (select count(*) from fiila.vd_submissions where status = 'pending') end,
      'ambassadors', case when fiila.staff_can(v_uid, 'ambassadors') then (select count(*) from fiila.ambassadors where status = 'review') end,
      'rewards', case when fiila.staff_can(v_uid, 'ambassadors') then (select count(*) from fiila.ambassador_rewards where status = 'validated') end,
      'comments', case when fiila.staff_can(v_uid, 'moderation') then (select count(*) from fiila.comments c where c.hidden or exists (select 1 from fiila.comment_reports r where r.comment_id = c.id)) end,
      'suspended', case when fiila.staff_can(v_uid, 'shops') then (select count(*) from fiila.shops where suspended_at is not null) end)),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d::date,
        'orders', (select count(*) from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.demo and o.created_at >= d and o.created_at < d + interval '1 day'),
        'shops', (select count(*) from fiila.shops s where not s.demo and not s.platform and s.created_at >= d and s.created_at < d + interval '1 day'),
        'accounts', (select count(*) from auth.users u where u.created_at >= d and u.created_at < d + interval '1 day')) order by d)
      from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- boutiques
create or replace function public.fiila_bo_shops(p_q text default null, p_filter text default null, p_page int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('shops'); v_q text := nullif(trim(coalesce(p_q, '')), ''); v_page int := greatest(0, least(coalesce(p_page, 0), 200));
begin
  return jsonb_build_object('page', v_page, 'shops', coalesce((select jsonb_agg(j order by ord) from (
    select row_number() over (order by s.created_at desc) ord, jsonb_strip_nulls(jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'type', s.business_type, 'created_at', s.created_at,
      'public', s.public, 'rank', s.featured_rank, 'demo', case when s.demo then true end, 'platform', case when s.platform then true end,
      'suspended', case when s.suspended_at is not null then true end,
      'products', (select count(*) from fiila.products p where p.shop_id = s.id and p.active),
      'orders', (select count(*) from fiila.orders o where o.shop_id = s.id))) j
    from fiila.shops s
    where (v_q is null or s.name ilike '%' || v_q || '%' or s.slug ilike '%' || v_q || '%'
           or fiila.phone_key(s.phone) like '%' || nullif(fiila.phone_key(v_q), '') || '%')
      and (p_filter is null or p_filter = ''
           or (p_filter = 'open' and s.public) or (p_filter = 'closed' and not s.public and s.suspended_at is null)
           or (p_filter = 'suspended' and s.suspended_at is not null) or (p_filter = 'feed' and s.featured_rank is not null)
           or (p_filter = 'demo' and s.demo))
    order by s.created_at desc limit 50 offset v_page * 50) x), '[]'::jsonb));
end $$;

create or replace function public.fiila_bo_shop(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('shops'); s fiila.shops;
begin
  select * into s from fiila.shops where id = p_id;
  if not found then perform fiila.fail('not_found'); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', s.id, 'name', s.name, 'slug', s.slug, 'phone', s.phone, 'about', s.about, 'type', s.business_type,
    'created_at', s.created_at, 'public', s.public, 'feed', s.feed, 'rank', s.featured_rank, 'demo', s.demo, 'platform', s.platform,
    'suspended_at', s.suspended_at, 'suspended_reason', s.suspended_reason,
    'owner', case when fiila.staff_can(v_uid, 'accounts') and s.user_id is not null then
      jsonb_build_object('id', s.user_id, 'email', (select email from auth.users where id = s.user_id)) end,
    'access', case when s.user_id is not null then 'account' else 'key' end,
    'stats', jsonb_build_object(
      'products', (select count(*) from fiila.products p where p.shop_id = s.id and p.active),
      'customers', (select count(*) from fiila.customers c where c.shop_id = s.id),
      'orders', (select count(*) from fiila.orders o where o.shop_id = s.id),
      'delivered', (select count(*) from fiila.orders o where o.shop_id = s.id and o.status = 'delivered'),
      'gmv', (select coalesce(sum(o.total), 0) from fiila.orders o where o.shop_id = s.id and o.status = 'delivered'),
      'likes', (select count(*) from fiila.likes l join fiila.products p on p.id = l.product_id where p.shop_id = s.id),
      'comments', (select count(*) from fiila.comments c join fiila.products p on p.id = c.product_id where p.shop_id = s.id and not c.hidden)),
    'ambassador', (select a.name from fiila.ambassador_shops x join fiila.ambassadors a on a.id = x.ambassador_id where x.shop_id = s.id limit 1),
    'recent_orders', case when fiila.staff_can(v_uid, 'orders') then (select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number,
        'total', o.total, 'status', o.status, 'created_at', o.created_at) order by o.created_at desc)
      from (select * from fiila.orders where shop_id = s.id order by created_at desc limit 5) o) end,
    'log', (select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'detail', l.detail) order by l.at desc)
      from (select * from fiila.admin_log where target_type = 'shop' and target_id = s.id::text order by at desc limit 10) l)));
end $$;

-- Actions : suspend (motif obligatoire) / unsuspend / feed_off / feed_on / free_place / set_type.
create or replace function public.fiila_bo_shop_action(p_id uuid, p_action text, p_value text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('shops_write'); s fiila.shops; v_val text := fiila.clean(p_value, 300);
begin
  select * into s from fiila.shops where id = p_id for update;
  if not found then perform fiila.fail('not_found'); end if;
  if s.platform and p_action in ('suspend', 'free_place') then perform fiila.fail('not_allowed'); end if;
  if p_action in ('feed_off', 'feed_on', 'free_place') and not fiila.staff_can(v_uid, 'feed') then perform fiila.fail('not_allowed'); end if;
  if p_action = 'suspend' then
    if v_val is null then perform fiila.fail('reason_required'); end if;
    update fiila.shops set suspended_at = now(), suspended_reason = v_val, public = false, updated_at = now() where id = p_id;
  elsif p_action = 'unsuspend' then
    update fiila.shops set suspended_at = null, suspended_reason = null, updated_at = now() where id = p_id;
  elsif p_action = 'feed_off' then
    update fiila.shops set feed = false, updated_at = now() where id = p_id;
  elsif p_action = 'feed_on' then
    update fiila.shops set feed = true, updated_at = now() where id = p_id;
  elsif p_action = 'free_place' then
    if s.featured_rank is null then perform fiila.fail('not_found'); end if;
    perform pg_advisory_xact_lock(hashtext('fiila_feed_rank'));
    update fiila.shops set featured_rank = null, featured_at = null where id = p_id;
    update fiila.shops set featured_rank = s.featured_rank, featured_at = now()
     where id = (select id from fiila.shops where featured_rank is null and public and feed and not demo and not platform and id <> p_id order by created_at limit 1);
  elsif p_action = 'set_type' then
    update fiila.shops set business_type = v_val, updated_at = now() where id = p_id;
  else
    perform fiila.fail('invalid_action');
  end if;
  perform fiila.bo_log('shop_' || p_action, 'shop', p_id::text, jsonb_strip_nulls(jsonb_build_object('name', s.name, 'value', v_val)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- commandes
create or replace function public.fiila_bo_orders(p_q text default null, p_status text default null, p_page int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('orders'); v_q text := nullif(trim(coalesce(p_q, '')), ''); v_page int := greatest(0, least(coalesce(p_page, 0), 200));
begin
  return jsonb_build_object('page', v_page, 'orders', coalesce((select jsonb_agg(j order by ord) from (
    select row_number() over (order by o.created_at desc) ord, jsonb_strip_nulls(jsonb_build_object(
      'id', o.id, 'number', o.number, 'shop', s.name, 'shop_id', s.id, 'customer', o.customer_name, 'total', o.total,
      'status', o.status, 'created_at', o.created_at, 'delivered_at', o.delivered_at, 'demo', case when s.demo then true end)) j
    from fiila.orders o join fiila.shops s on s.id = o.shop_id
    where (p_status is null or p_status = '' or o.status = p_status)
      and (v_q is null or s.name ilike '%' || v_q || '%' or o.customer_name ilike '%' || v_q || '%'
           or o.number::text = ltrim(v_q, '0#N° ') or fiila.phone_key(o.customer_phone) = fiila.phone_key(v_q))
    order by o.created_at desc limit 50 offset v_page * 50) x), '[]'::jsonb));
end $$;

create or replace function public.fiila_bo_order(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('orders'); o fiila.orders; s fiila.shops;
begin
  select * into o from fiila.orders where id = p_id;
  if not found then perform fiila.fail('not_found'); end if;
  select * into s from fiila.shops where id = o.shop_id;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', o.id, 'number', o.number, 'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug),
    'customer', o.customer_name, 'phone', o.customer_phone, 'items', o.items, 'total', o.total, 'note', o.note,
    'status', o.status, 'created_at', o.created_at, 'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at,
    'address', case when o.place_id is not null then 'received' when o.request_id is not null then 'pending' else 'none' end,
    'invoice', o.share_token,
    'paid', (select coalesce(sum(amount), 0) from fiila.payments where order_id = o.id and status = 'confirmed'),
    'payments', (select jsonb_agg(jsonb_build_object('amount', amount, 'method', method, 'at', created_at) order by created_at)
      from fiila.payments where order_id = o.id and status = 'confirmed')));
end $$;

-- ---------------------------------------------------------------- comptes
create or replace function public.fiila_bo_accounts(p_q text default null, p_page int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('accounts'); v_q text := nullif(trim(coalesce(p_q, '')), ''); v_page int := greatest(0, least(coalesce(p_page, 0), 200));
begin
  return jsonb_build_object('page', v_page, 'accounts', coalesce((select jsonb_agg(j order by ord) from (
    select row_number() over (order by u.created_at desc) ord, jsonb_strip_nulls(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', p.display_name, 'created_at', u.created_at,
      'shop', (select s.name from fiila.shops s where s.user_id = u.id limit 1),
      'ambassador', (select a.status from fiila.ambassadors a where a.user_id = u.id),
      'role', fiila.staff_role(u.id))) j
    from auth.users u left join fiila.profiles p on p.user_id = u.id
    where v_q is null or u.email ilike '%' || v_q || '%' or p.display_name ilike '%' || v_q || '%'
    order by u.created_at desc limit 50 offset v_page * 50) x), '[]'::jsonb));
end $$;

create or replace function public.fiila_bo_account(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('accounts');
begin
  if not exists (select 1 from auth.users where id = p_id) then perform fiila.fail('not_found'); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', p_id, 'email', (select email from auth.users where id = p_id), 'created_at', (select created_at from auth.users where id = p_id),
    'name', (select display_name from fiila.profiles where user_id = p_id), 'phone', (select phone from fiila.profiles where user_id = p_id),
    'role', fiila.staff_role(p_id),
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name) from fiila.shops s where s.user_id = p_id limit 1),
    'ambassador', (select jsonb_build_object('status', a.status, 'code', a.code) from fiila.ambassadors a where a.user_id = p_id),
    'counts', jsonb_build_object(
      'addresses', (select count(*) from fiila.places where user_id = p_id and kind = 'address'),
      'meetings', (select count(*) from fiila.places where user_id = p_id and kind = 'meeting'),
      'comments', (select count(*) from fiila.comments where user_id = p_id),
      'vide_dressing', (select count(*) from fiila.vd_submissions where user_id = p_id))));
end $$;

-- ---------------------------------------------------------------- fil (25 places)
create or replace function public.fiila_bo_feed() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('feed');
begin
  return jsonb_build_object(
    'places', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('rank', s.featured_rank, 'id', s.id, 'name', s.name, 'slug', s.slug,
        'public', s.public, 'feed', s.feed, 'suspended', case when s.suspended_at is not null then true end,
        'products', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and p.photo is not null))) order by s.featured_rank)
      from fiila.shops s where s.featured_rank is not null), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'since', s.created_at) order by s.created_at)
      from fiila.shops s where s.featured_rank is null and s.public and s.feed and not s.demo and not s.platform), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- finances
create or replace function public.fiila_bo_finance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('finance');
begin
  return jsonb_build_object(
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', m::date,
        'orders', (select count(*) from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.demo and o.created_at >= m and o.created_at < m + interval '1 month'),
        'delivered', (select count(*) from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.demo and o.status = 'delivered' and o.delivered_at >= m and o.delivered_at < m + interval '1 month'),
        'gmv', (select coalesce(sum(o.total), 0) from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.demo and o.status = 'delivered' and o.delivered_at >= m and o.delivered_at < m + interval '1 month'),
        'vd_gmv', (select coalesce(sum(o.total), 0) from fiila.orders o join fiila.shops s on s.id = o.shop_id where s.platform and o.status = 'delivered' and o.delivered_at >= m and o.delivered_at < m + interval '1 month'))
        order by m desc)
      from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m), '[]'::jsonb),
    'vd_commission', fiila.setting_int('vd_commission'),
    'rewards', jsonb_build_object(
      'pending', (select coalesce(sum(amount), 0) from fiila.ambassador_rewards where status = 'pending'),
      'validated', (select coalesce(sum(amount), 0) from fiila.ambassador_rewards where status = 'validated'),
      'paid', (select coalesce(sum(amount), 0) from fiila.ambassador_rewards where status = 'paid')),
    'vd_to_pay', (select count(*) from fiila.vd_submissions where status = 'sold' and paid_at is null));
end $$;

-- ---------------------------------------------------------------- équipe et invitations
create or replace function public.fiila_bo_team() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('team');
begin
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('user_id', st.user_id, 'role', st.role,
        'name', p.display_name, 'email', u.email, 'since', st.created_at, 'last_seen_at', st.last_seen_at,
        'me', case when st.user_id = v_uid then true end)) order by st.created_at)
      from fiila.staff st join auth.users u on u.id = st.user_id left join fiila.profiles p on p.user_id = st.user_id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'expires_at', i.expires_at) order by i.created_at desc)
      from fiila.staff_invites i where i.used_at is null and i.revoked_at is null and i.expires_at > now()), '[]'::jsonb));
end $$;

create or replace function public.fiila_bo_invite(p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('team'); v_email text := lower(fiila.clean(p_email, 200)); v_token text := fiila.token(24); v_id uuid;
begin
  if not fiila.recent_login() then perform fiila.fail('reauth_required'); end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform fiila.fail('email_invalid'); end if;
  if p_role not in ('super_admin', 'operations', 'moderation', 'support', 'finance') then perform fiila.fail('invalid_role'); end if;
  if exists (select 1 from fiila.staff st join auth.users u on u.id = st.user_id where lower(u.email) = v_email) then perform fiila.fail('already_staff'); end if;
  perform fiila.rate_check('bo_invite', 30);
  update fiila.staff_invites set revoked_at = now() where lower(email) = v_email and used_at is null and revoked_at is null;
  insert into fiila.staff_invites (token_hash, email, role, invited_by) values (fiila.h(v_token), v_email, p_role, v_uid) returning id into v_id;
  perform fiila.bo_log('team_invite', 'invite', v_id::text, jsonb_build_object('email', v_email, 'role', p_role));
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', now() + interval '7 days');
end $$;

create or replace function public.fiila_bo_invite_revoke(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('team'); v_email text;
begin
  update fiila.staff_invites set revoked_at = now() where id = p_id and used_at is null and revoked_at is null returning email into v_email;
  if v_email is null then perform fiila.fail('not_found'); end if;
  perform fiila.bo_log('team_invite_revoke', 'invite', p_id::text, jsonb_build_object('email', v_email));
  return jsonb_build_object('ok', true);
end $$;

-- Lien d'invitation : ce que voit la personne invitée avant d'accepter (rôle, e-mail masqué, validité).
create or replace function public.fiila_bo_invite_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i fiila.staff_invites;
begin
  perform fiila.read_check();
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,64}$' then return jsonb_build_object('state', 'invalid'); end if;
  select * into i from fiila.staff_invites where token_hash = fiila.h(p_token);
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  if i.used_at is not null then return jsonb_build_object('state', 'used'); end if;
  if i.revoked_at is not null or i.expires_at < now() then return jsonb_build_object('state', 'expired'); end if;
  return jsonb_build_object('state', 'ok', 'role', i.role,
    'email', regexp_replace(i.email, '^(.)[^@]*(@.*)$', '\1•••\2'));
end $$;

create or replace function public.fiila_bo_invite_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); i fiila.staff_invites;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,64}$' then perform fiila.fail('not_found'); end if;
  perform fiila.rate_check('bo_invite_accept', 20);
  select * into i from fiila.staff_invites where token_hash = fiila.h(p_token) for update;
  if not found or i.used_at is not null or i.revoked_at is not null or i.expires_at < now() then perform fiila.fail('invite_invalid'); end if;
  if lower((select email from auth.users where id = v_uid)) <> lower(i.email) then perform fiila.fail('invite_email_mismatch'); end if;
  insert into fiila.staff (user_id, role, added_by) values (v_uid, i.role, i.invited_by)
    on conflict (user_id) do update set role = excluded.role;
  update fiila.staff_invites set used_at = now(), used_by = v_uid where id = i.id;
  perform fiila.bo_log('team_join', 'staff', v_uid::text, jsonb_build_object('role', i.role, 'email', i.email));
  return jsonb_build_object('role', i.role);
end $$;

-- Changer un rôle ou retirer un membre (p_role null). Jamais soi-même ; jamais le dernier super admin.
create or replace function public.fiila_bo_staff_set(p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('team'); v_old text := fiila.staff_role(p_user);
begin
  if not fiila.recent_login() then perform fiila.fail('reauth_required'); end if;
  if p_user = v_uid then perform fiila.fail('not_self'); end if;
  if v_old is null then perform fiila.fail('not_found'); end if;
  if p_role is not null and p_role not in ('super_admin', 'operations', 'moderation', 'support', 'finance') then perform fiila.fail('invalid_role'); end if;
  if v_old = 'super_admin' and coalesce(p_role, '') <> 'super_admin'
     and (select count(*) from fiila.staff where role = 'super_admin') <= 1 then perform fiila.fail('last_super_admin'); end if;
  if p_role is null then delete from fiila.staff where user_id = p_user;
  else update fiila.staff set role = p_role where user_id = p_user; end if;
  perform fiila.bo_log(case when p_role is null then 'team_remove' else 'team_role' end, 'staff', p_user::text,
    jsonb_strip_nulls(jsonb_build_object('from', v_old, 'to', p_role, 'email', (select email from auth.users where id = p_user))));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- journal
create or replace function public.fiila_bo_audit(p_page int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('audit'); v_page int := greatest(0, least(coalesce(p_page, 0), 500));
begin
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action,
      'target_type', l.target_type, 'target_id', l.target_id, 'detail', l.detail)) order by l.at desc, l.id desc)
    from (select * from fiila.admin_log order by at desc, id desc limit 50 offset v_page * 50) l), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- réglages de la plateforme (liste fermée, bornes contrôlées)
create or replace function fiila.bo_setting_bounds(p_key text) returns int[]
language sql immutable set search_path = '' as $$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500] end
$$;
create or replace function public.fiila_bo_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('settings');
begin
  return coalesce((select jsonb_object_agg(k, fiila.setting_int(k))
    from unnest(array['vd_commission', 'amb_reward_1', 'amb_reward_2', 'amb_reward_3', 'amb_monthly_cap']) k), '{}'::jsonb);
end $$;
create or replace function public.fiila_bo_setting_set(p_key text, p_value int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('settings'); v_b int[] := fiila.bo_setting_bounds(p_key); v_old int;
begin
  if not fiila.recent_login() then perform fiila.fail('reauth_required'); end if;
  if v_b is null then perform fiila.fail('invalid_setting'); end if;
  if p_value is null or p_value < v_b[1] or p_value > v_b[2] then perform fiila.fail('invalid_value'); end if;
  v_old := fiila.setting_int(p_key);
  insert into fiila.settings (key, value) values (p_key, p_value::text) on conflict (key) do update set value = excluded.value;
  perform fiila.bo_log('setting', 'setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- journal des actions des fonctions d'administration existantes
create or replace function fiila.bo_audit_trg() returns trigger
language plpgsql set search_path = '' as $$
declare v_uid uuid := fiila.uid();
begin
  if v_uid is null or fiila.staff_role(v_uid) is null then return null; end if;
  -- Un test par table (PL/pgSQL n'évite pas d'évaluer new.<colonne> d'une autre table dans une même condition).
  if tg_table_name = 'ambassadors' then
    if new.status is distinct from old.status then
      perform fiila.bo_log('ambassador_' || new.status, 'ambassador', new.id::text, jsonb_build_object('name', new.name));
    end if;
  elsif tg_table_name = 'ambassador_rewards' then
    if new.status is distinct from old.status then
      perform fiila.bo_log('reward_' || new.status, 'reward', new.id::text, jsonb_build_object('amount', new.amount, 'shop', new.shop_name));
    end if;
  elsif tg_table_name = 'vd_submissions' then
    if new.status is distinct from old.status or new.paid_at is distinct from old.paid_at then
      perform fiila.bo_log(case when new.paid_at is distinct from old.paid_at then 'vd_paid' else 'vd_' || new.status end, 'vide_dressing', new.id::text,
        jsonb_build_object('title', new.title));
    end if;
  elsif tg_table_name = 'comments' then
    if new.hidden is distinct from old.hidden then
      perform fiila.bo_log(case when new.hidden then 'comment_hide' else 'comment_restore' end, 'comment', new.id::text, jsonb_build_object('body', left(new.body, 80)));
    end if;
  end if;
  return null;
end $$;
create trigger bo_audit after update on fiila.ambassadors for each row execute function fiila.bo_audit_trg();
create trigger bo_audit after update on fiila.ambassador_rewards for each row execute function fiila.bo_audit_trg();
create trigger bo_audit after update on fiila.vd_submissions for each row execute function fiila.bo_audit_trg();
create trigger bo_audit after update on fiila.comments for each row execute function fiila.bo_audit_trg();
create or replace function fiila.bo_audit_del_trg() returns trigger
language plpgsql set search_path = '' as $$
declare v_uid uuid := fiila.uid();
begin
  if v_uid is not null and fiila.staff_role(v_uid) is not null then
    perform fiila.bo_log('comment_delete', 'comment', old.id::text, jsonb_build_object('body', left(old.body, 80)));
  end if;
  return null;
end $$;
create trigger bo_audit_del after delete on fiila.comments for each row execute function fiila.bo_audit_del_trg();

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_bo_me()', 'public.fiila_bo_overview()', 'public.fiila_bo_shops(text, text, integer)', 'public.fiila_bo_shop(uuid)',
    'public.fiila_bo_shop_action(uuid, text, text)', 'public.fiila_bo_orders(text, text, integer)', 'public.fiila_bo_order(uuid)',
    'public.fiila_bo_accounts(text, integer)', 'public.fiila_bo_account(uuid)', 'public.fiila_bo_feed()', 'public.fiila_bo_finance()',
    'public.fiila_bo_team()', 'public.fiila_bo_invite(text, text)', 'public.fiila_bo_invite_revoke(uuid)', 'public.fiila_bo_invite_get(text)',
    'public.fiila_bo_invite_accept(text)', 'public.fiila_bo_staff_set(uuid, text)', 'public.fiila_bo_audit(integer)',
    'public.fiila_bo_settings()', 'public.fiila_bo_setting_set(text, integer)'];
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
