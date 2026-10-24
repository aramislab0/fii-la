-- Domaine propre d'une boutique (mandat du fondateur du 24/10/2026 ; docs/PLAN-DOMAINES-FII.md §4).
-- Un nom d'hôte appartient à une seule boutique. Il ne sert le site qu'une fois vérifié par Cloudflare (propriété ET certificat).
-- Réservé aux boutiques Premium (le domaine propre fait partie du Site Pro), au propriétaire ou à un administrateur.
-- Une demande non vérifiée expire après 72 heures (contre le blocage d'un domaine par quelqu'un qui ne le possède pas).
-- Les échanges avec Cloudflare passent par la fonction serveur fiila-domains (clé de service) : fiila.domain_cf_update
-- n'est appelable que par elle. Le Worker lit fiila_domain_resolve (public) : la boutique d'un nom d'hôte actif, rien d'autre.
-- Interrupteur du back-office : custom_domains (1 = ouvert, 0 = aucun domaine propre ne sert de site).

create table fiila.shop_domains (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references fiila.shops (id) on delete cascade,
  hostname      text not null check (hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' and char_length(hostname) <= 253),
  status        text not null default 'pending' check (status in ('pending', 'verifying', 'active', 'failed', 'expired', 'disconnected')),
  ssl_status    text,
  cf_id         text,
  records       jsonb not null default '[]'::jsonb,   -- enregistrements à afficher, renvoyés par Cloudflare (jamais inventés)
  last_error    text,
  checked_at    timestamptz,
  verified_at   timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz,
  ended_reason  text
);
-- Un nom d'hôte vivant (en attente, en vérification ou actif) n'appartient qu'à une boutique.
create unique index shop_domains_live on fiila.shop_domains (hostname) where status in ('pending', 'verifying', 'active');
create index shop_domains_shop on fiila.shop_domains (shop_id, created_at desc);
revoke all on fiila.shop_domains from public;

insert into fiila.settings (key, value) values ('custom_domains', '1') on conflict (key) do nothing;

-- Nom d'hôte normalisé (minuscules, sans protocole ni chemin ni port ni point final), ou null s'il est inacceptable.
create or replace function fiila.domain_norm(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare h text := lower(trim(coalesce(p, '')));
begin
  h := regexp_replace(h, '^[a-z]+://', '');
  h := split_part(split_part(split_part(h, '/', 1), '?', 1), '#', 1);
  h := regexp_replace(h, ':[0-9]+$', '');
  h := regexp_replace(h, '\.$', '');
  if h = '' or char_length(h) > 253 or h !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then return null; end if;
  if h ~ '^[0-9.]+$' then return null; end if;                                         -- adresse IP
  if h ~ '(^|\.)(fiila\.app|fii-la\.com|github\.io|supabase\.co|workers\.dev|localhost|local|test|example|invalid)$' then return null; end if;
  if h !~ '\.[a-z]{2,63}$' then return null; end if;                                    -- extension alphabétique
  return h;
end $$;

-- Demandes non vérifiées de plus de 72 heures : expirées (le nom est libéré).
create or replace function fiila.domain_expire() returns void
language sql set search_path = '' as $$
  update fiila.shop_domains set status = 'expired', ended_at = now(), ended_reason = 'Non vérifié en 72 heures'
   where status in ('pending', 'verifying') and created_at < now() - interval '72 hours'
$$;

create or replace function fiila.domain_json(d fiila.shop_domains) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', d.id, 'hostname', d.hostname, 'status', d.status, 'ssl_status', d.ssl_status,
    'records', d.records, 'last_error', d.last_error, 'checked_at', d.checked_at, 'verified_at', d.verified_at, 'created_at', d.created_at,
    'ended_at', d.ended_at, 'ended_reason', d.ended_reason,
    'apex', case when d.hostname !~ '^www\.' and array_length(string_to_array(d.hostname, '.'), 1) = 2 then true end))
$$;

-- Liste des domaines de la boutique (tous les rôles la voient ; seuls propriétaire et administrateurs agissent).
create or replace function public.fiila_domains(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  perform fiila.domain_expire();
  return jsonb_build_object('plan', s.plan, 'enabled', coalesce(fiila.setting_int('custom_domains'), 1) = 1,
    'can_edit', fiila.shop_rank(nullif(current_setting('fiila.shop_role', true), '')) >= fiila.shop_rank('admin'),
    'slug', s.slug, 'public', s.public,
    'domains', coalesce((select jsonb_agg(fiila.domain_json(d) order by d.created_at desc) from fiila.shop_domains d
                          where d.shop_id = s.id and d.status in ('pending', 'verifying', 'active', 'failed')), '[]'::jsonb));
end $$;

create or replace function public.fiila_domain_add(p_key text, p_host text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin'); h text := fiila.domain_norm(p_host); d fiila.shop_domains;
begin
  perform fiila.rate_check('domain_add', 20);
  if coalesce(fiila.setting_int('custom_domains'), 1) <> 1 then perform fiila.fail('domains_off'); end if;
  if s.plan <> 'premium' then perform fiila.fail('premium_required'); end if;
  if h is null then perform fiila.fail('domain_invalid'); end if;
  perform fiila.domain_expire();
  if (select count(*) from fiila.shop_domains where shop_id = s.id and status in ('pending', 'verifying', 'active', 'failed')) >= 2 then
    perform fiila.fail('domain_limit');
  end if;
  if exists (select 1 from fiila.shop_domains where hostname = h and status in ('pending', 'verifying', 'active')) then
    perform fiila.fail('domain_taken');
  end if;
  -- Une erreur précédente sur le même nom, pour cette boutique : on la clôt avant de recommencer.
  update fiila.shop_domains set status = 'disconnected', ended_at = now(), ended_reason = 'Nouvelle demande'
   where shop_id = s.id and hostname = h and status = 'failed';
  insert into fiila.shop_domains (shop_id, hostname, created_by) values (s.id, h, fiila.uid()) returning * into d;
  return fiila.domain_json(d);
end $$;

-- Déconnexion par la boutique : le site ne répond plus sur ce nom ; l'adresse Fii reste.
create or replace function public.fiila_domain_remove(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin'); d fiila.shop_domains;
begin
  update fiila.shop_domains set status = 'disconnected', ended_at = now(), ended_reason = 'Déconnecté par la boutique'
   where id = p_id and shop_id = s.id and status in ('pending', 'verifying', 'active', 'failed') returning * into d;
  if d.id is null then perform fiila.fail('not_found'); end if;
  return fiila.domain_json(d);
end $$;

-- Pour la fonction fiila-domains (appelée avec la session ou la clé de la personne) : le domaine à synchroniser,
-- seulement si la personne peut agir dessus (administrateur de la boutique, ou équipe Fii avec le droit shops_write).
create or replace function public.fiila_domain_target(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d fiila.shop_domains; v_uid uuid := fiila.uid(); s fiila.shops;
begin
  select * into d from fiila.shop_domains where id = p_id;
  if d.id is null then perform fiila.fail('not_found'); end if;
  if v_uid is not null and fiila.staff_can(v_uid, 'shops_write') then
    return fiila.domain_json(d) || jsonb_build_object('cf_id', d.cf_id, 'by', 'staff');
  end if;
  s := fiila.my_shop(p_key, 'admin');
  if s.id <> d.shop_id then perform fiila.fail('not_found'); end if;
  return fiila.domain_json(d) || jsonb_build_object('cf_id', d.cf_id, 'by', 'shop');
end $$;

-- Écrit le résultat de Cloudflare (réservé à la clé de service : aucun rôle public ne peut l'appeler).
-- p : { cf_id, cf_status, ssl_status, records, error }. Statut Fii : actif seulement si propriété ET certificat actifs.
create or replace function public.fiila_domain_cf_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d fiila.shop_domains; v_cf text := p ->> 'cf_status'; v_ssl text := p ->> 'ssl_status'; v_status text;
begin
  select * into d from fiila.shop_domains where id = p_id for update;
  if d.id is null then perform fiila.fail('not_found'); end if;
  if d.status not in ('pending', 'verifying', 'active', 'failed') then return fiila.domain_json(d); end if;   -- déjà clos
  v_status := case
    when p ? 'error' and nullif(p ->> 'error', '') is not null and coalesce(v_cf, '') = '' then 'failed'
    when v_cf = 'active' and v_ssl = 'active' then 'active'
    when v_cf in ('blocked', 'moved', 'deleted') or v_ssl in ('validation_timed_out', 'issuance_timed_out', 'deleted') then 'failed'
    when v_cf is null then d.status
    else 'verifying' end;
  update fiila.shop_domains set
    cf_id = coalesce(nullif(p ->> 'cf_id', ''), cf_id), ssl_status = coalesce(v_ssl, ssl_status), status = v_status,
    records = case when jsonb_typeof(p -> 'records') = 'array' then p -> 'records' else records end,
    last_error = nullif(left(coalesce(p ->> 'error', ''), 300), ''), checked_at = now(),
    verified_at = case when v_status = 'active' then coalesce(verified_at, now()) else verified_at end
   where id = p_id returning * into d;
  return fiila.domain_json(d) || jsonb_build_object('cf_id', d.cf_id);
end $$;

-- Pour le Worker : la boutique servie par un nom d'hôte. Seulement si le domaine est actif, l'interrupteur ouvert,
-- la boutique Premium, en ligne et non suspendue. Rien d'autre n'est renvoyé.
create or replace function public.fiila_domain_resolve(p_host text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h text := fiila.domain_norm(p_host); r record;
begin
  if h is null or coalesce(fiila.setting_int('custom_domains'), 1) <> 1 then return jsonb_build_object('state', 'unknown'); end if;
  select s.slug, s.name into r from fiila.shop_domains d join fiila.shops s on s.id = d.shop_id
   where d.hostname = h and d.status = 'active' and s.plan = 'premium' and s.public and s.suspended_at is null and s.slug is not null;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  return jsonb_build_object('state', 'ok', 'slug', r.slug, 'name', r.name, 'host', h);
end $$;

-- ---------------------------------------------------------------- back-office
create or replace function public.fiila_bo_domains() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('shops');
  perform fiila.domain_expire();
  return jsonb_build_object('enabled', coalesce(fiila.setting_int('custom_domains'), 1) = 1,
    'domains', coalesce((select jsonb_agg(fiila.domain_json(d) || jsonb_build_object('shop', s.name, 'shop_id', s.id, 'plan', s.plan, 'cf_id', d.cf_id)
                 order by (d.status in ('failed', 'verifying', 'pending')) desc, d.created_at desc)
      from (select * from fiila.shop_domains order by created_at desc limit 300) d join fiila.shops s on s.id = d.shop_id), '[]'::jsonb));
end $$;

-- Déconnexion par l'équipe (motif obligatoire, au journal). Le nom est libéré : une autre boutique pourra le réclamer
-- (réattribution = déconnexion ici, puis nouvelle demande de la boutique qui possède vraiment le domaine).
create or replace function public.fiila_bo_domain_action(p_id uuid, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d fiila.shop_domains; v_reason text := nullif(fiila.clean(p_reason, 200), '');
begin
  perform fiila.need_staff('shops_write');
  select * into d from fiila.shop_domains where id = p_id for update;
  if d.id is null then perform fiila.fail('not_found'); end if;
  if p_action = 'disconnect' then
    if v_reason is null then perform fiila.fail('reason_required'); end if;
    if d.status not in ('pending', 'verifying', 'active', 'failed') then perform fiila.fail('invalid_state'); end if;
    update fiila.shop_domains set status = 'disconnected', ended_at = now(), ended_reason = v_reason where id = p_id returning * into d;
    perform fiila.bo_log('domain_disconnect', 'domain', d.id::text, jsonb_build_object('hostname', d.hostname, 'reason', v_reason));
  else perform fiila.fail('invalid_payload');
  end if;
  return fiila.domain_json(d);
end $$;

-- Interrupteur dans les réglages du back-office.
do $$
declare v_def text; v_new text;
begin
  -- Mesure anonyme du transfert vers le nouveau domaine principal (aucune donnée : seulement « transféré » ou « vide »).
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'marketing'$s$, $s$    or (p_event = 'migrate' and p_variant in ('merged', 'empty'))
    or (p_event = 'marketing'$s$);
  if v_new = v_def then raise exception 'shop_domains: fiila_track non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$when 'sugg_addr_photo' then array[0, 1] when 'sugg_addr_mark' then array[0, 1] end$s$,
    $s$when 'sugg_addr_photo' then array[0, 1] when 'sugg_addr_mark' then array[0, 1]
    when 'custom_domains' then array[0, 1] end$s$);
  if v_new = v_def then raise exception 'shop_domains: bo_setting_bounds non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'sugg_addr_photo', 'sugg_addr_mark']$s$, $s$'sugg_addr_photo', 'sugg_addr_mark', 'custom_domains']$s$);
  if v_new = v_def then raise exception 'shop_domains: fiila_bo_settings non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_domains(text)', 'public.fiila_domain_add(text, text)', 'public.fiila_domain_remove(text, uuid)',
                      'public.fiila_domain_target(text, uuid)', 'public.fiila_domain_resolve(text)', 'public.fiila_bo_domains()',
                      'public.fiila_bo_domain_action(uuid, text, text)', 'public.fiila_bo_settings()', 'public.fiila_track(text, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  -- Réservé à la clé de service (fonction fiila-domains).
  execute 'revoke execute on function public.fiila_domain_cf_update(uuid, jsonb) from public';
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function public.fiila_domain_cf_update(uuid, jsonb) from %I', role_name); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.fiila_domain_cf_update(uuid, jsonb) to service_role';
  end if;
end $$;
