-- Fii La : vérification des numéros par code SMS (fondateur, 19/10/2026 20:31 : « connecte le code SMS avec Africa's Talking »).
--
-- Le code est généré et contrôlé par Supabase Auth (changement de numéro du compte : PUT /user puis POST /verify) ;
-- le SMS part par Africa's Talking via la fonction fiila-send-sms (crochet « Send SMS »). Un numéro vérifié est celui
-- d'auth.users (phone + phone_confirmed_at) : Fii La ne stocke aucun code.
-- Réglage `sms_verify` (back-office) : 0 = facultatif (par défaut, tant que l'envoi n'est pas confirmé en réel),
-- 1 = obligatoire pour rejoindre l'équipe d'une boutique, avec le numéro qui a reçu l'invitation.

insert into fiila.settings (key, value) values ('sms_verify', '0') on conflict (key) do nothing;

create or replace function fiila.bo_setting_bounds(p_key text) returns int[]
language sql immutable set search_path = '' as $$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1] end
$$;

create or replace function public.fiila_bo_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('settings');
begin
  return coalesce((select jsonb_object_agg(k, fiila.setting_int(k))
    from unnest(array['vd_commission', 'amb_reward_1', 'amb_reward_2', 'amb_reward_3', 'amb_monthly_cap', 'sms_verify']) k), '{}'::jsonb);
end $$;

-- Numéro vérifié du compte (format +221…), ou null.
create or replace function fiila.verified_phone(p_uid uuid) returns text
language sql stable set search_path = '' as $$
  select case when u.phone is not null and u.phone <> '' and u.phone_confirmed_at is not null then '+' || ltrim(u.phone, '+') end
    from auth.users u where u.id = p_uid
$$;

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
    'display_name', p.display_name, 'phone', p.phone, 'phone_verified', fiila.verified_phone(v_uid),
    'avatar', case when p.avatar is not null
                   then 'data:' || p.avatar_type || ';base64,' || replace(encode(p.avatar, 'base64'), E'\n', '') end,
    'shop', case when s.id is not null then jsonb_build_object('id', s.id, 'name', s.name, 'role', v_role) end));
end $$;

-- Invitation : le numéro invité est transmis à la personne qui a le lien (pour préremplir la vérification) ;
-- `verify` indique si la vérification par SMS est exigée.
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
  return jsonb_strip_nulls(jsonb_build_object('state', 'ok', 'shop', s.name, 'role', i.role, 'name', i.name, 'phone', i.phone,
    'verify', case when coalesce(fiila.setting_int('sms_verify'), 0) = 1 and i.phone is not null then true end));
end $$;

create or replace function public.fiila_shop_invite_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); i fiila.shop_invites; s fiila.shops; v_ph text;
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
  -- Vérification par SMS exigée : le compte doit avoir confirmé, par code, le numéro qui a reçu l'invitation.
  if coalesce(fiila.setting_int('sms_verify'), 0) = 1 and i.phone is not null then
    v_ph := fiila.verified_phone(v_uid);
    if v_ph is null then perform fiila.fail('phone_verify_required'); end if;
    if fiila.phone_key(v_ph) <> fiila.phone_key(i.phone) then perform fiila.fail('phone_mismatch'); end if;
  end if;
  update fiila.shop_invites set used_at = now(), used_by = v_uid where token_hash = i.token_hash;
  insert into fiila.shop_members (shop_id, user_id, role, name, phone, invited_by)
  values (s.id, v_uid, i.role, coalesce((select display_name from fiila.profiles where user_id = v_uid), i.name), coalesce(fiila.verified_phone(v_uid), i.phone), i.created_by);
  return jsonb_build_object('shop', s.name, 'role', i.role);
end $$;

-- Équipe : un membre au numéro vérifié est signalé (le propriétaire sait qui a confirmé son numéro).
create or replace function fiila.shop_team_json(p_shop uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'owner', (select jsonb_strip_nulls(jsonb_build_object('name', coalesce(pr.display_name, sh.name), 'me', sh.user_id is not distinct from fiila.uid() and sh.user_id is not null))
                from fiila.shops sh left join fiila.profiles pr on pr.user_id = sh.user_id where sh.id = p_shop),
    'members', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.user_id, 'role', m.role,
        'name', coalesce(m.name, pr.display_name, split_part(u.email, '@', 1)), 'phone', m.phone, 'me', m.user_id = fiila.uid() or null,
        'verified', fiila.verified_phone(m.user_id) is not null and fiila.phone_key(fiila.verified_phone(m.user_id)) = fiila.phone_key(m.phone) or null))
        order by m.created_at)
      from fiila.shop_members m join auth.users u on u.id = m.user_id left join fiila.profiles pr on pr.user_id = m.user_id
      where m.shop_id = p_shop), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', i.id, 'role', i.role, 'name', i.name, 'phone', i.phone,
        'expires_at', i.expires_at)) order by i.created_at)
      from fiila.shop_invites i where i.shop_id = p_shop and i.used_at is null and i.expires_at > now()), '[]'::jsonb))
$$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_me()', 'public.fiila_shop_invite_get(text)', 'public.fiila_shop_invite_accept(text)', 'public.fiila_bo_settings()'];
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
