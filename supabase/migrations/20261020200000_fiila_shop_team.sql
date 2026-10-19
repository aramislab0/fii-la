-- Fii La : équipe de la boutique (fondateur, 19/10/2026 20:04 : « ajouter un autre membre de ma boutique, en tant qu'admin
-- ou éditeur, en mettant son nom et son numéro, et lui envoyer le message par WhatsApp »).
--
-- Rôles : propriétaire (le compte ou la clé qui a créé la boutique) > administrateur > éditeur.
--   propriétaire  : tout, dont la suppression de la boutique ;
--   administrateur : tout sauf supprimer la boutique (réglages, vitrine, livreur, équipe, suppressions) ;
--   éditeur        : commandes, articles, clients ; ni réglages, ni suppression, ni équipe.
-- Invitation : un lien personnel (jeton haché, 7 jours, un seul usage) envoyé depuis le WhatsApp de la boutique (wa.me,
-- sans service payant). La personne l'ouvre, se connecte ou crée son compte, puis rejoint la boutique.
-- Un compte appartient à une seule boutique (MVP) : propriétaire ou membre, pas les deux.

create table fiila.shop_members (
  shop_id    uuid not null references fiila.shops (id) on delete cascade,
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'editor')),
  name       text,
  phone      text,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create table fiila.shop_invites (
  id         uuid not null unique default gen_random_uuid(),
  token_hash bytea primary key,
  shop_id    uuid not null references fiila.shops (id) on delete cascade,
  role       text not null check (role in ('admin', 'editor')),
  name       text,
  phone      text,
  created_by uuid references auth.users (id) on delete set null,
  used_at    timestamptz,
  used_by    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index shop_invites_shop on fiila.shop_invites (shop_id);

revoke all on fiila.shop_members, fiila.shop_invites from public;

-- ---------------------------------------------------------------- rôle dans la boutique
create or replace function fiila.shop_rank(p_role text) returns int
language sql immutable set search_path = '' as $$
  select case p_role when 'owner' then 3 when 'admin' then 2 when 'editor' then 1 else 0 end
$$;

-- Boutique de la personne qui appelle, avec un rôle minimal. Le rôle trouvé est gardé pour la requête en cours
-- (fiila.shop_role) : les fonctions qui lisent pour tous mais écrivent pour les administrateurs le vérifient ensuite.
create or replace function fiila.my_shop(p_key text, p_min text) returns fiila.shops
language plpgsql set search_path = '' as $$
declare s fiila.shops; v_uid uuid := fiila.uid(); v_role text;
begin
  if p_key is not null and char_length(p_key) <= 100 then
    select * into s from fiila.shops where owner_hash = fiila.h(p_key) for update;
    if found then v_role := 'owner'; end if;
  end if;
  if v_role is null and v_uid is not null then
    select * into s from fiila.shops where user_id = v_uid for update;
    if found then
      v_role := 'owner';
    else
      select m.role into v_role from fiila.shop_members m where m.user_id = v_uid;
      if v_role is not null then
        select sh.* into s from fiila.shops sh join fiila.shop_members m on m.shop_id = sh.id where m.user_id = v_uid for update of sh;
      end if;
    end if;
  end if;
  if v_role is null then perform fiila.fail('shop_required'); end if;
  perform set_config('fiila.shop_role', v_role, true);
  if fiila.shop_rank(v_role) < fiila.shop_rank(coalesce(p_min, 'editor')) then
    perform fiila.fail(case when p_min = 'owner' then 'shop_owner_only' else 'shop_admin_only' end);
  end if;
  return s;
end $$;

create or replace function fiila.my_shop(p_key text) returns fiila.shops
language sql set search_path = '' as $$ select fiila.my_shop(p_key, 'editor') $$;

-- À appeler après fiila.my_shop dans la même fonction.
create or replace function fiila.need_shop_role(p_min text) returns void
language plpgsql set search_path = '' as $$
begin
  if fiila.shop_rank(nullif(current_setting('fiila.shop_role', true), '')) < fiila.shop_rank(p_min) then
    perform fiila.fail(case when p_min = 'owner' then 'shop_owner_only' else 'shop_admin_only' end);
  end if;
end $$;

-- Écritures réservées : la vérification est insérée au début du corps des fonctions existantes (sans les recopier).
--   administrateur : réglages, livreur, suppressions d'articles et de clients, lien ambassadeur ;
--   propriétaire   : suppression de la boutique ;
--   vitrine et fil : lecture pour tous, modification pour les administrateurs.
do $$
declare r record; v_def text; v_new text; v_min text; v_after text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('fiila_shop_courier', 'fiila_courier_invite', 'fiila_product_delete',
             'fiila_customer_delete', 'fiila_ambassador_link', 'fiila_shop_delete', 'fiila_shop_vitrine', 'fiila_shop_feed') loop
    v_def := pg_get_functiondef(r.oid);
    v_min := case when r.proname = 'fiila_shop_delete' then 'owner' else 'admin' end;
    v_after := case r.proname when 'fiila_shop_vitrine' then 'if p is not null then' when 'fiila_shop_feed' then 'if p_on is not null then' else 'begin' end;
    if position(E'\n' || v_after || E'\n' in v_def) > 0 then
      v_new := regexp_replace(v_def, E'\\n' || regexp_replace(v_after, '([()])', '\\\1', 'g') || E'\\n',
        E'\n' || v_after || E'\n  perform fiila.need_shop_role(''' || v_min || E''');\n');
    else
      v_new := regexp_replace(v_def, E'\\n(\\s*)' || regexp_replace(v_after, '([()])', '\\\1', 'g') || E'\\n',
        E'\n\\1' || v_after || E'\n\\1  perform fiila.need_shop_role(''' || v_min || E''');\n');
    end if;
    if v_new = v_def then raise exception 'shop_team: vérification non insérée dans %', r.proname; end if;
    execute v_new;
  end loop;
end $$;

-- Réglages : un membre ne crée jamais une seconde boutique ; un éditeur ne modifie pas les réglages.
create or replace function public.fiila_shop_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); v_name text; v_phone text; v_ninea text; s fiila.shops; v_key text; v_type text;
begin
  perform fiila.rate_check('shop_save', 60);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name  := fiila.clean(p ->> 'name', 60);
  v_phone := fiila.clean_phone(p ->> 'phone');
  v_ninea := fiila.clean(p ->> 'ninea', 30);
  if v_name is null then perform fiila.fail('shop_name_required'); end if;
  v_type := nullif(p ->> 'business_type', '');
  if v_type is not null and not fiila.valid_business_type(v_type) then perform fiila.fail('invalid_business_type'); end if;
  begin
    s := fiila.my_shop(p_key);
  exception when others then
    if sqlerrm <> 'fiila:shop_required' then raise; end if;
    s := null;
  end;
  if s.id is not null then
    perform fiila.need_shop_role('admin');
    update fiila.shops set name = v_name, phone = v_phone, ninea = v_ninea,
      business_type = case when p ? 'business_type' then v_type else business_type end, updated_at = now() where id = s.id returning * into s;
    return jsonb_build_object('shop', fiila.shop_json(s));
  end if;
  v_key := fiila.token(32);
  insert into fiila.shops (user_id, owner_hash, name, phone, ninea, business_type) values (v_uid, fiila.h(v_key), v_name, v_phone, v_ninea, v_type)
  returning * into s;
  return jsonb_build_object('shop', fiila.shop_json(s), 'key', v_key);
end $$;

-- Lecture de la boutique : le rôle de la personne (l'interface masque ce qui ne la concerne pas).
create or replace function public.fiila_shop_get(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; c fiila.couriers; i fiila.courier_invites; v_role text;
begin
  begin
    s := fiila.my_shop(p_key);
  exception when others then
    return jsonb_build_object('shop', null);
  end;
  v_role := current_setting('fiila.shop_role', true);
  select * into c from fiila.couriers where id = s.courier_id;
  select * into i from fiila.courier_invites where shop_id = s.id and used_at is null and expires_at > now() order by created_at desc limit 1;
  return jsonb_build_object('shop', fiila.shop_json(s) || jsonb_strip_nulls(jsonb_build_object('account', s.user_id is not null,
      'role', v_role,
      'courier_auto', s.courier_auto, 'courier_confirmed', s.courier_confirmed,
      'courier', case when c.id is not null then fiila.courier_json(c) end,
      'courier_invite', case when i.token_hash is not null and v_role <> 'editor' then jsonb_build_object('name', i.name, 'phone', i.phone) end)),
    'stats', (select jsonb_build_object(
      'open', count(*) filter (where o.status = 'open'),
      'unpaid', count(*) filter (where o.status <> 'cancelled' and fiila.order_paid(o.id) < o.total),
      'orders', count(*),
      'customers', (select count(*) from fiila.customers cu where cu.shop_id = s.id),
      'products', (select count(*) from fiila.products pr where pr.shop_id = s.id and pr.active))
      from fiila.orders o where o.shop_id = s.id));
end $$;

-- Compte : la boutique du membre apparaît aussi, avec son rôle.
create or replace function public.fiila_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); p fiila.profiles; s fiila.shops; v_email text; v_role text;
begin
  select email into v_email from auth.users where id = v_uid;
  select * into p from fiila.profiles where user_id = v_uid;
  select * into s from fiila.shops where user_id = v_uid;
  if s.id is not null then
    v_role := 'owner';
  else
    select m.role into v_role from fiila.shop_members m where m.user_id = v_uid;
    if v_role is not null then select sh.* into s from fiila.shops sh join fiila.shop_members m on m.shop_id = sh.id where m.user_id = v_uid; end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', v_uid, 'email', v_email,
    'display_name', p.display_name, 'phone', p.phone,
    'avatar', case when p.avatar is not null
                   then 'data:' || p.avatar_type || ';base64,' || replace(encode(p.avatar, 'base64'), E'\n', '') end,
    'shop', case when s.id is not null then jsonb_build_object('id', s.id, 'name', s.name, 'role', v_role) end));
end $$;

-- Rattacher une boutique sans compte : impossible pour un membre d'une autre boutique.
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
  if exists (select 1 from fiila.shops where user_id = v_uid) or exists (select 1 from fiila.shop_members where user_id = v_uid) then
    return jsonb_build_object('claimed', false, 'reason', 'has_shop');
  end if;
  update fiila.shops set user_id = v_uid, updated_at = now() where id = s.id;
  return jsonb_build_object('claimed', true);
end $$;

-- ---------------------------------------------------------------- équipe
create or replace function fiila.shop_team_json(p_shop uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'owner', (select jsonb_strip_nulls(jsonb_build_object('name', coalesce(pr.display_name, sh.name), 'me', sh.user_id is not distinct from fiila.uid() and sh.user_id is not null))
                from fiila.shops sh left join fiila.profiles pr on pr.user_id = sh.user_id where sh.id = p_shop),
    'members', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.user_id, 'role', m.role,
        'name', coalesce(m.name, pr.display_name, split_part(u.email, '@', 1)), 'phone', m.phone, 'me', m.user_id = fiila.uid() or null))
        order by m.created_at)
      from fiila.shop_members m join auth.users u on u.id = m.user_id left join fiila.profiles pr on pr.user_id = m.user_id
      where m.shop_id = p_shop), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', i.id, 'role', i.role, 'name', i.name, 'phone', i.phone,
        'expires_at', i.expires_at)) order by i.created_at)
      from fiila.shop_invites i where i.shop_id = p_shop and i.used_at is null and i.expires_at > now()), '[]'::jsonb))
$$;

create or replace function public.fiila_shop_team(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin');
begin
  return fiila.shop_team_json(s.id) || jsonb_build_object('role', current_setting('fiila.shop_role', true));
end $$;

-- Invitation : renvoie le jeton (une seule fois) ; le lien part du WhatsApp de la boutique.
create or replace function public.fiila_shop_invite(p_key text, p_name text, p_phone text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin'); v_tok text; v_phone text := fiila.clean_phone(p_phone);
begin
  perform fiila.rate_check('shop_invite', 30);
  if p_role is null or p_role not in ('admin', 'editor') then perform fiila.fail('invalid_role'); end if;
  if v_phone is null then perform fiila.fail('phone_invalid'); end if;
  if (select count(*) from fiila.shop_members where shop_id = s.id)
     + (select count(*) from fiila.shop_invites where shop_id = s.id and used_at is null and expires_at > now()) >= 10 then
    perform fiila.fail('team_full');
  end if;
  -- une seule invitation en attente par numéro
  delete from fiila.shop_invites where shop_id = s.id and used_at is null and phone = v_phone;
  v_tok := fiila.token(16);
  insert into fiila.shop_invites (token_hash, shop_id, role, name, phone, created_by, expires_at)
  values (fiila.h(v_tok), s.id, p_role, fiila.clean(p_name, 60), v_phone, fiila.uid(), now() + interval '7 days');
  return jsonb_build_object('token', v_tok, 'team', fiila.shop_team_json(s.id));
end $$;

create or replace function public.fiila_shop_invite_cancel(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin');
begin
  delete from fiila.shop_invites where shop_id = s.id and id = p_id and used_at is null;
  return fiila.shop_team_json(s.id);
end $$;

create or replace function public.fiila_shop_invite_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i fiila.shop_invites; s fiila.shops;
begin
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into i from fiila.shop_invites where token_hash = fiila.h(p_token);
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if i.used_at is not null then return jsonb_build_object('state', 'used'); end if;
  if i.expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  select * into s from fiila.shops where id = i.shop_id;
  return jsonb_strip_nulls(jsonb_build_object('state', 'ok', 'shop', s.name, 'role', i.role, 'name', i.name));
end $$;

create or replace function public.fiila_shop_invite_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); i fiila.shop_invites; s fiila.shops;
begin
  perform fiila.rate_check('shop_invite_accept', 20);
  if not fiila.valid_token(p_token) then perform fiila.fail('not_found'); end if;
  select * into i from fiila.shop_invites where token_hash = fiila.h(p_token) for update;
  if not found then perform fiila.fail('not_found'); end if;
  if i.used_at is not null then perform fiila.fail('already_used'); end if;
  if i.expires_at <= now() then perform fiila.fail('expired'); end if;
  select * into s from fiila.shops where id = i.shop_id;
  if s.user_id = v_uid or exists (select 1 from fiila.shop_members where shop_id = s.id and user_id = v_uid) then
    perform fiila.fail('already_member');
  end if;
  if exists (select 1 from fiila.shops where user_id = v_uid) or exists (select 1 from fiila.shop_members where user_id = v_uid) then
    perform fiila.fail('has_shop');
  end if;
  update fiila.shop_invites set used_at = now(), used_by = v_uid where token_hash = i.token_hash;
  insert into fiila.shop_members (shop_id, user_id, role, name, phone, invited_by)
  values (s.id, v_uid, i.role, coalesce((select display_name from fiila.profiles where user_id = v_uid), i.name), i.phone, i.created_by);
  return jsonb_build_object('shop', s.name, 'role', i.role);
end $$;

-- Changer le rôle d'un membre ('admin' / 'editor') ou le retirer ('remove'). Le propriétaire n'est jamais un membre.
create or replace function public.fiila_shop_member_set(p_key text, p_user uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin');
begin
  if not exists (select 1 from fiila.shop_members where shop_id = s.id and user_id = p_user) then perform fiila.fail('not_found'); end if;
  if p_action = 'remove' then delete from fiila.shop_members where shop_id = s.id and user_id = p_user;
  elsif p_action in ('admin', 'editor') then update fiila.shop_members set role = p_action where shop_id = s.id and user_id = p_user;
  else perform fiila.fail('invalid_role');
  end if;
  return fiila.shop_team_json(s.id);
end $$;

-- Quitter la boutique (tout membre, éditeurs compris).
create or replace function public.fiila_shop_leave() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  delete from fiila.shop_members where user_id = v_uid;
  if not found then perform fiila.fail('not_found'); end if;
  return jsonb_build_object('left', true);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_shop_team(text)', 'public.fiila_shop_invite(text, text, text, text)', 'public.fiila_shop_invite_cancel(text, uuid)',
    'public.fiila_shop_invite_get(text)', 'public.fiila_shop_invite_accept(text)', 'public.fiila_shop_member_set(text, uuid, text)',
    'public.fiila_shop_leave()', 'public.fiila_shop_save(text, jsonb)', 'public.fiila_shop_get(text)', 'public.fiila_me()',
    'public.fiila_shop_claim(text)'];
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
