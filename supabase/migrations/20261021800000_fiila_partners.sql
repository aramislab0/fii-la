-- Mandat AGENTS-AMBASSADEURS-001, lot 3 (fondateur, 21/10/2026 04:27) : programme « Ambassadeurs Fii La » — boutiques, marques
-- et e-commerces choisis par le fondateur, invités à essayer le pack complet 1 ou 2 mois. Nom interne « partner » (les tables
-- ambassador_* restent celles du programme Agents).
--
-- Invitation : créée dans le back-office (droit « partners »), lien privé à partager par WhatsApp. Le jeton n'est gardé qu'en
-- empreinte ; il expire, se révoque, se régénère (l'ancien lien cesse de marcher). Lire l'invitation ne change rien (aperçus
-- WhatsApp, ouvertures répétées). Une seule acceptation, un seul essai par boutique. Preuve de propriété : la clé de gestion de
-- la boutique, ou le compte qui la possède ; une boutique existante désignée dans l'invitation doit être celle-là.
-- Essai : démarre seulement sur « Activer mon essai », et seulement si la version du pack est prête (un pack qui promet le
-- Studio n'est prêt que lorsque le Studio l'est : BLOCKED_DEPENDENCY sinon). Dates calculées par le serveur, en mois
-- calendaires à l'heure de Dakar (fin de mois : 31 janvier + 1 mois = 28 ou 29 février). Activation idempotente.
-- Échéance : les avantages temporaires s'arrêtent ; boutique, catalogue, commandes et photos restent. Aucune facturation.
-- Accepter une invitation ne génère jamais de gain d'agent.

-- ---------------------------------------------------------------- droits de l'équipe
create or replace function fiila.staff_perms(p_role text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_role
    when 'super_admin' then array['dashboard', 'shops', 'shops_write', 'shops_suspend', 'orders', 'accounts', 'feed', 'moderation', 'vide_dressing',
                                  'ambassadors', 'finance', 'settings', 'team', 'audit', 'strategy', 'partners', 'partners_admin']
    when 'operations'  then array['dashboard', 'shops', 'shops_write', 'shops_suspend', 'orders', 'accounts', 'feed', 'moderation', 'vide_dressing', 'ambassadors', 'finance', 'partners']
    when 'moderation'  then array['dashboard', 'shops', 'shops_suspend', 'moderation', 'vide_dressing']
    when 'support'     then array['dashboard', 'shops', 'orders', 'accounts']
    when 'finance'     then array['dashboard', 'orders', 'finance', 'ambassadors']
    when 'strategy'    then array['dashboard', 'shops', 'ambassadors', 'strategy', 'partners']
    else array[]::text[] end
$$;

-- ---------------------------------------------------------------- packs (versionnés, jamais modifiés une fois utilisés)
create table fiila.partner_packs (
  code        text not null check (code ~ '^[a-z0-9_]{2,30}$'),
  version     int not null check (version >= 1),
  name        text not null,
  benefits    jsonb not null default '[]'::jsonb,   -- ["Libellé exact", …]
  limits      jsonb not null default '{}'::jsonb,   -- { "studio_credits": 20 } : quotas appliqués par le serveur
  exclusions  jsonb not null default '[]'::jsonb,
  needs_studio boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  primary key (code, version)
);
revoke all on fiila.partner_packs from public;

-- Dépendances externes : le Studio n'est « prêt » que lorsque le fondateur l'a déclaré (fournisseur, clé, budget, génération
-- réelle vérifiée). Tant que ce réglage vaut 0, un pack qui inclut le Studio reste en BLOCKED_DEPENDENCY.
insert into fiila.settings (key, value) values ('studio_ready', '0') on conflict (key) do nothing;
create or replace function fiila.pack_ready(p fiila.partner_packs) returns boolean
language sql stable set search_path = '' as $$
  select p.code is not null and jsonb_array_length(p.benefits) > 0 and (not p.needs_studio or coalesce(fiila.setting_int('studio_ready'), 0) = 1)
$$;
create or replace function fiila.pack_json(p fiila.partner_packs) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('code', p.code, 'version', p.version, 'name', p.name, 'benefits', p.benefits, 'limits', p.limits,
    'exclusions', p.exclusions, 'needs_studio', p.needs_studio, 'ready', fiila.pack_ready(p),
    'blocked', case when p.needs_studio and coalesce(fiila.setting_int('studio_ready'), 0) <> 1 then 'BLOCKED_DEPENDENCY' end)
$$;

-- ---------------------------------------------------------------- invitations et essais
create table fiila.partner_invites (
  id            uuid primary key default gen_random_uuid(),
  token_hash    bytea not null unique,
  brand         text not null,
  activity      text,
  whatsapp      text,
  shop_id       uuid references fiila.shops (id) on delete set null,   -- boutique existante désignée (facultatif)
  pack_code     text not null,
  pack_version  int not null,
  months        int not null default 1 check (months in (1, 2)),
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at    timestamptz not null default now() + interval '30 days',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  accepted_shop uuid references fiila.shops (id) on delete set null,
  foreign key (pack_code, pack_version) references fiila.partner_packs (code, version)
);
create index partner_invites_created on fiila.partner_invites (created_at desc);
revoke all on fiila.partner_invites from public;

create table fiila.partner_trials (
  id            uuid primary key default gen_random_uuid(),
  invite_id     uuid not null unique references fiila.partner_invites (id),
  shop_id       uuid not null unique references fiila.shops (id) on delete cascade,   -- un seul essai par boutique
  pack_code     text not null,
  pack_version  int not null,
  months        int not null check (months between 1 and 6),
  status        text not null default 'ready' check (status in ('ready', 'active', 'suspended', 'revoked', 'ended')),
  activated_at  timestamptz,
  ends_at       timestamptz,
  studio_used   int not null default 0,
  created_at    timestamptz not null default now(),
  foreign key (pack_code, pack_version) references fiila.partner_packs (code, version)
);
create index partner_trials_invite on fiila.partner_trials (invite_id);
revoke all on fiila.partner_trials from public;

-- Fin d'essai : le jour d'échéance à minuit, heure de Dakar, N mois calendaires après l'activation.
create or replace function fiila.trial_end(p_start timestamptz, p_months int) returns timestamptz
language sql immutable set search_path = '' as $$
  select (((p_start at time zone 'Africa/Dakar')::date + make_interval(months => p_months))::timestamp + interval '1 day') at time zone 'Africa/Dakar'
$$;

-- État lu (et mis à jour) : un essai actif dont l'échéance est passée devient « ended ».
create or replace function fiila.trial_refresh(p_shop uuid) returns fiila.partner_trials
language plpgsql security definer set search_path = '' as $$
declare t fiila.partner_trials;
begin
  update fiila.partner_trials set status = 'ended' where shop_id = p_shop and status = 'active' and ends_at <= now();
  select * into t from fiila.partner_trials where shop_id = p_shop;
  return t;
end $$;

-- Droit en cours d'une boutique (utilisé par le serveur pour appliquer les avantages et quotas).
create or replace function fiila.partner_active(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from fiila.partner_trials where shop_id = p_shop and status = 'active' and ends_at > now())
$$;

create or replace function fiila.trial_json(t fiila.partner_trials) returns jsonb
language sql stable set search_path = '' as $$
  select case when t.id is null then null else jsonb_strip_nulls(jsonb_build_object('id', t.id, 'status', t.status, 'months', t.months,
    'activated_at', t.activated_at, 'ends_at', t.ends_at,
    'ends_on', case when t.ends_at is not null then ((t.ends_at at time zone 'Africa/Dakar') - interval '1 day')::date end,
    'studio_left', case when (p.limits ? 'studio_credits') then greatest(0, (p.limits ->> 'studio_credits')::int - t.studio_used) end,
    'brand', i.brand, 'pack', fiila.pack_json(p))) end
  from (select 1) x left join fiila.partner_packs p on p.code = t.pack_code and p.version = t.pack_version
       left join fiila.partner_invites i on i.id = t.invite_id
$$;

-- Jeton d'invitation : 32 caractères (base64url), seule son empreinte est gardée.
create or replace function fiila.invite_token() returns text
language sql volatile set search_path = '' as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_')
$$;
create or replace function fiila.invite_by_token(p_token text) returns fiila.partner_invites
language sql stable set search_path = '' as $$
  select * from fiila.partner_invites where p_token is not null and p_token ~ '^[A-Za-z0-9_-]{32}$' and token_hash = fiila.h(p_token)
$$;
create or replace function fiila.invite_state(i fiila.partner_invites) returns text
language sql stable set search_path = '' as $$
  select case when i.id is null then 'not_found' when i.status = 'revoked' then 'revoked' when i.status = 'accepted' then 'accepted'
              when i.expires_at <= now() then 'expired' else 'valid' end
$$;

-- ---------------------------------------------------------------- public (lien d'invitation)
-- Lecture seule : aucune écriture, quel que soit le nombre d'ouvertures ou d'aperçus.
create or replace function public.fiila_partner_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i fiila.partner_invites := fiila.invite_by_token(p_token); p fiila.partner_packs; v_state text := fiila.invite_state(i);
begin
  if v_state = 'not_found' then return jsonb_build_object('state', 'not_found'); end if;
  select * into p from fiila.partner_packs where code = i.pack_code and version = i.pack_version;
  return jsonb_strip_nulls(jsonb_build_object('state', v_state, 'brand', i.brand, 'months', i.months, 'expires_at', i.expires_at,
    'existing_shop', case when i.shop_id is not null then (select name from fiila.shops where id = i.shop_id) end,
    'pack', case when v_state in ('valid', 'accepted') then fiila.pack_json(p) end));
end $$;

-- Acceptation : la boutique de la personne (clé ou compte) devient partenaire ; l'essai est créé « prêt », pas activé.
-- Idempotente pour la même boutique ; refusée pour une autre.
create or replace function public.fiila_partner_accept(p_token text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i fiila.partner_invites; s fiila.shops; t fiila.partner_trials;
begin
  perform fiila.rate_check('partner_accept', 20);
  select * into i from fiila.partner_invites where id = (fiila.invite_by_token(p_token)).id for update;
  if i.id is null then perform fiila.fail('invite_not_found'); end if;
  s := fiila.my_shop(p_key, 'owner');
  if i.status = 'accepted' then
    if i.accepted_shop = s.id then select * into t from fiila.partner_trials where invite_id = i.id; return jsonb_build_object('trial', fiila.trial_json(t), 'again', true); end if;
    perform fiila.fail('invite_used');
  end if;
  if i.status = 'revoked' then perform fiila.fail('invite_revoked'); end if;
  if i.expires_at <= now() then perform fiila.fail('invite_expired'); end if;
  if i.shop_id is not null and i.shop_id <> s.id then perform fiila.fail('invite_other_shop'); end if;
  if exists (select 1 from fiila.partner_trials where shop_id = s.id) then perform fiila.fail('trial_already'); end if;
  insert into fiila.partner_trials (invite_id, shop_id, pack_code, pack_version, months)
  values (i.id, s.id, i.pack_code, i.pack_version, i.months) returning * into t;
  update fiila.partner_invites set status = 'accepted', accepted_at = now(), accepted_shop = s.id where id = i.id;
  return jsonb_build_object('trial', fiila.trial_json(t));
end $$;

-- « Activer mon essai » : seulement si le pack est prêt ; dates du serveur ; idempotente.
create or replace function public.fiila_partner_activate(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'owner'); t fiila.partner_trials; p fiila.partner_packs;
begin
  select * into t from fiila.partner_trials where shop_id = s.id for update;
  if t.id is null then perform fiila.fail('trial_none'); end if;
  if t.status = 'active' then return jsonb_build_object('trial', fiila.trial_json(t), 'again', true); end if;
  if t.status <> 'ready' then perform fiila.fail('trial_not_ready'); end if;
  select * into p from fiila.partner_packs where code = t.pack_code and version = t.pack_version;
  if not fiila.pack_ready(p) then perform fiila.fail(case when p.needs_studio then 'pack_blocked_dependency' else 'pack_not_ready' end); end if;
  update fiila.partner_trials set status = 'active', activated_at = now(), ends_at = fiila.trial_end(now(), months) where id = t.id returning * into t;
  return jsonb_build_object('trial', fiila.trial_json(t));
end $$;

-- Essai de la boutique (tableau de bord) ; null si aucun.
create or replace function public.fiila_partner_mine(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); t fiila.partner_trials := fiila.trial_refresh(s.id);
begin
  return jsonb_build_object('trial', fiila.trial_json(t), 'manager', case when t.id is not null then fiila.manager_wa() end);
end $$;

-- ---------------------------------------------------------------- back-office
create or replace function public.fiila_bo_partners() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('partners');
begin
  update fiila.partner_trials set status = 'ended' where status = 'active' and ends_at <= now();
  return jsonb_build_object(
    'can_admin', fiila.staff_can(v_uid, 'partners_admin'),
    'packs', coalesce((select jsonb_agg(fiila.pack_json(p) || jsonb_build_object('used', exists (select 1 from fiila.partner_invites i where i.pack_code = p.code and i.pack_version = p.version)) order by p.code, p.version desc)
                        from fiila.partner_packs p), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', i.id, 'brand', i.brand, 'activity', i.activity, 'whatsapp', i.whatsapp,
        'months', i.months, 'pack', i.pack_code || ' v' || i.pack_version, 'state', fiila.invite_state(i), 'expires_at', i.expires_at, 'created_at', i.created_at,
        'existing_shop', (select name from fiila.shops where id = i.shop_id), 'shop', (select name from fiila.shops where id = i.accepted_shop),
        'trial', (select fiila.trial_json(t) from fiila.partner_trials t where t.invite_id = i.id))) order by i.created_at desc)
      from (select * from fiila.partner_invites order by created_at desc limit 200) i), '[]'::jsonb));
end $$;

-- Nouvelle version de pack (droit partners_admin). Une version déjà utilisée ne se modifie jamais : on en crée une autre.
create or replace function public.fiila_bo_pack_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('partners_admin'); v_code text := lower(coalesce(p ->> 'code', 'complet')); v_ver int; r fiila.partner_packs;
begin
  if v_code !~ '^[a-z0-9_]{2,30}$' then perform fiila.fail('invalid_payload'); end if;
  if nullif(trim(coalesce(p ->> 'name', '')), '') is null then perform fiila.fail('invalid_payload'); end if;
  if jsonb_typeof(coalesce(p -> 'benefits', '[]')) <> 'array' or jsonb_array_length(coalesce(p -> 'benefits', '[]')) = 0 then perform fiila.fail('pack_benefits_required'); end if;
  if p ? 'limits' and jsonb_typeof(p -> 'limits') <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if (p -> 'limits') ? 'studio_credits' and ((p -> 'limits' ->> 'studio_credits') !~ '^[0-9]{1,4}$') then perform fiila.fail('invalid_payload'); end if;
  select coalesce(max(version), 0) + 1 into v_ver from fiila.partner_packs where code = v_code;
  insert into fiila.partner_packs (code, version, name, benefits, limits, exclusions, needs_studio, created_by)
  values (v_code, v_ver, fiila.clean(p ->> 'name', 60), p -> 'benefits', coalesce(p -> 'limits', '{}'), coalesce(p -> 'exclusions', '[]'),
          coalesce((p ->> 'needs_studio')::boolean, false) or coalesce((p -> 'limits') ? 'studio_credits', false), v_uid) returning * into r;
  perform fiila.bo_log('pack_saved', 'pack', v_code || ' v' || v_ver, jsonb_build_object('name', r.name));
  return fiila.pack_json(r);
end $$;

-- Inviter une marque. Renvoie le jeton une seule fois (lien à partager) ; il n'est jamais relisible ensuite.
create or replace function public.fiila_bo_partner_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('partners'); v_tok text := fiila.invite_token(); i fiila.partner_invites; pk fiila.partner_packs; v_shop uuid;
begin
  perform fiila.rate_check('partner_invite', 60);
  if nullif(trim(coalesce(p ->> 'brand', '')), '') is null then perform fiila.fail('brand_required'); end if;
  if coalesce((p ->> 'months')::int, 1) not in (1, 2) then perform fiila.fail('invalid_payload'); end if;
  select * into pk from fiila.partner_packs where code = coalesce(p ->> 'pack', 'complet') order by version desc limit 1;
  if pk.code is null then perform fiila.fail('pack_none'); end if;
  if nullif(p ->> 'shop_slug', '') is not null then
    select id into v_shop from fiila.shops where slug = lower(p ->> 'shop_slug') and not platform and not demo;
    if v_shop is null then perform fiila.fail('shop_not_found'); end if;
  end if;
  insert into fiila.partner_invites (token_hash, brand, activity, whatsapp, shop_id, pack_code, pack_version, months, note, created_by)
  values (fiila.h(v_tok), fiila.clean(p ->> 'brand', 60), fiila.clean(p ->> 'activity', 80), fiila.clean_phone(nullif(p ->> 'whatsapp', '')), v_shop,
          pk.code, pk.version, coalesce((p ->> 'months')::int, 1), fiila.clean(p ->> 'note', 300), v_uid) returning * into i;
  perform fiila.bo_log('partner_invite', 'partner', i.id::text, jsonb_build_object('name', i.brand, 'months', i.months, 'pack', pk.code || ' v' || pk.version));
  return jsonb_build_object('id', i.id, 'token', v_tok, 'brand', i.brand, 'months', i.months, 'whatsapp', i.whatsapp, 'expires_at', i.expires_at, 'pack', fiila.pack_json(pk));
end $$;

-- Actions : regenerate (nouveau lien, l'ancien cesse de marcher), revoke, extend (+1 mois), suspend, resume, end.
create or replace function public.fiila_bo_partner_action(p_id uuid, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; i fiila.partner_invites; t fiila.partner_trials; v_tok text;
begin
  v_uid := fiila.need_staff(case when p_action = 'regenerate' then 'partners' else 'partners_admin' end);
  if p_action in ('revoke', 'suspend') and nullif(trim(coalesce(p_reason, '')), '') is null then perform fiila.fail('reason_required'); end if;
  select * into i from fiila.partner_invites where id = p_id for update;
  if i.id is null then perform fiila.fail('not_found'); end if;
  select * into t from fiila.partner_trials where invite_id = i.id for update;
  if p_action = 'regenerate' then
    if i.status <> 'pending' then perform fiila.fail('invalid_state'); end if;
    v_tok := fiila.invite_token();
    update fiila.partner_invites set token_hash = fiila.h(v_tok), expires_at = now() + interval '30 days' where id = i.id;
  elsif p_action = 'revoke' then
    if i.status = 'revoked' then return jsonb_build_object('ok', true); end if;
    update fiila.partner_invites set status = 'revoked' where id = i.id;
    if t.id is not null and t.status in ('ready', 'active', 'suspended') then update fiila.partner_trials set status = 'revoked' where id = t.id; end if;
  elsif p_action = 'extend' then
    if t.id is null or t.status not in ('active', 'ended') or t.months >= 6 then perform fiila.fail('invalid_state'); end if;
    update fiila.partner_trials set months = months + 1, status = 'active', ends_at = fiila.trial_end(activated_at, months + 1) where id = t.id;
  elsif p_action = 'suspend' then
    if t.id is null or t.status <> 'active' then perform fiila.fail('invalid_state'); end if;
    update fiila.partner_trials set status = 'suspended' where id = t.id;
  elsif p_action = 'resume' then
    if t.id is null or t.status <> 'suspended' then perform fiila.fail('invalid_state'); end if;
    update fiila.partner_trials set status = case when ends_at > now() then 'active' else 'ended' end where id = t.id;
  else perform fiila.fail('invalid_payload');
  end if;
  perform fiila.bo_log('partner_' || p_action, 'partner', i.id::text, jsonb_strip_nulls(jsonb_build_object('name', i.brand, 'reason', fiila.clean(p_reason, 200))));
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'token', v_tok));
end $$;

-- ---------------------------------------------------------------- Agents : une boutique partenaire ne génère pas de gain
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('fiila.amb_eval(fiila.ambassador_shops)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$  if a.status = 'active' and not exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled') then$s$,
    $s$  if a.status = 'active' and not exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled')
     and not exists (select 1 from fiila.partner_trials pt where pt.shop_id = s.id) then$s$);
  if v_new = v_def then raise exception 'partners: fiila.amb_eval non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_partner_invite(text)', 'public.fiila_partner_accept(text, text)', 'public.fiila_partner_activate(text)',
    'public.fiila_partner_mine(text)', 'public.fiila_bo_partners()', 'public.fiila_bo_pack_save(jsonb)', 'public.fiila_bo_partner_invite(jsonb)',
    'public.fiila_bo_partner_action(uuid, text, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
