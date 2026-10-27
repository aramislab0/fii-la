-- Propriétaire de la boutique et pièce d'identité (fondateur, 27/10/2026 16:20, recette Testo) :
--   4. après la personnalisation, le nom et le numéro du propriétaire sont demandés obligatoirement ;
--   5. après la première vente, la pièce d'identité (carte d'identité ou passeport) du propriétaire est exigée.
-- Arbitrages du fondateur (16:30) : « construire et activer tout de suite » et « blocage immédiat » : tant que la pièce
-- n'est pas envoyée, une boutique qui a déjà vendu ne prend plus de nouvelle commande (site et application).
-- Une pièce refusée par l'équipe rebloque. Réglage kyc_required (0/1) pour suspendre l'exigence sans redéployer.
-- Vente = commande livrée, ou commande non annulée avec un paiement confirmé.
-- Données sensibles : table fermée (aucun accès direct), lecture des images par l'équipe seulement (droit shops_write),
-- chaque consultation est journalisée ; images effacées si la pièce est refusée, et avec la boutique.
-- À déclarer à la CDP (complément du dossier, action du fondateur, HANDOFF §4).

alter table fiila.shops add column owner_name text, add column owner_phone text;

create table fiila.shop_kyc (
  shop_id      uuid primary key references fiila.shops (id) on delete cascade,
  doc_type     text not null check (doc_type in ('cni', 'passport')),
  front        bytea,
  front_type   text,
  back         bytea,
  back_type    text,
  status       text not null default 'submitted' check (status in ('submitted', 'verified', 'rejected')),
  reason       text,
  submitted_at timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid
);
alter table fiila.shop_kyc enable row level security;
revoke all on fiila.shop_kyc from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on fiila.shop_kyc from %I', r); end if;
  end loop;
end $$;

insert into fiila.settings (key, value) values ('kyc_required', '1') on conflict (key) do nothing;

-- La boutique a-t-elle déjà vendu ?
create or replace function fiila.shop_sold(p_shop uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from fiila.orders o where o.shop_id = p_shop and (o.status = 'delivered'
    or (o.status <> 'cancelled' and exists (select 1 from fiila.payments p where p.order_id = o.id and p.status = 'confirmed'))))
$$;

-- Pièce exigée : réglage actif, vraie boutique (ni démonstration ni boutique Fii), déjà une vente.
create or replace function fiila.kyc_needed(p_shop uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(fiila.setting_int('kyc_required'), 0) = 1
     and exists (select 1 from fiila.shops s where s.id = p_shop and not s.demo and not s.platform)
     and fiila.shop_sold(p_shop)
$$;

-- Bloquée : pièce exigée et ni envoyée ni validée (absente ou refusée).
create or replace function fiila.kyc_blocked(p_shop uuid) returns boolean
language sql stable set search_path = '' as $$
  select fiila.kyc_needed(p_shop)
     and not exists (select 1 from fiila.shop_kyc k where k.shop_id = p_shop and k.status in ('submitted', 'verified'))
$$;

-- Toutes les créations de commande passent par la table : le blocage tient quel que soit le chemin (site, application).
create or replace function fiila.orders_kyc_trg() returns trigger
language plpgsql set search_path = '' as $$
begin
  if fiila.kyc_blocked(new.shop_id) then perform fiila.fail('shop_kyc_required'); end if;
  return new;
end $$;
create trigger orders_kyc before insert on fiila.orders for each row execute function fiila.orders_kyc_trg();

-- Image d'une pièce : JPEG ou PNG, 700 Ko au plus.
create or replace function fiila.kyc_image(p_b64 text) returns bytea
language plpgsql immutable set search_path = '' as $$
declare v bytea;
begin
  if p_b64 is null or char_length(p_b64) > 960000 then perform fiila.fail('kyc_image_invalid'); end if;
  begin v := decode(regexp_replace(p_b64, '^data:[^,]+,', ''), 'base64'); exception when others then perform fiila.fail('kyc_image_invalid'); end;
  if length(v) < 2000 or length(v) > 700000 then perform fiila.fail('kyc_image_invalid'); end if;
  if substring(v from 1 for 3) <> '\xffd8ff'::bytea and substring(v from 1 for 4) <> '\x89504e47'::bytea then perform fiila.fail('kyc_image_invalid'); end if;
  return v;
end $$;
create or replace function fiila.kyc_type(v bytea) returns text
language sql immutable set search_path = '' as $$
  select case when substring(v from 1 for 4) = '\x89504e47'::bytea then 'image/png' else 'image/jpeg' end
$$;

-- ---------------------------------------------------------------- boutique
-- État pour l'application : informations du propriétaire et pièce. Les éditeurs voient seulement le blocage.
create or replace function public.fiila_shop_identity(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_role text := current_setting('fiila.shop_role', true); k fiila.shop_kyc;
begin
  select * into k from fiila.shop_kyc where shop_id = s.id;
  if v_role = 'editor' then
    return jsonb_build_object('role', v_role, 'blocked', fiila.kyc_blocked(s.id));
  end if;
  return jsonb_build_object('role', v_role,
    'owner_name', s.owner_name, 'owner_phone', s.owner_phone,
    'need_owner', not s.demo and not s.platform and (s.owner_name is null or s.owner_phone is null),
    'kyc', jsonb_strip_nulls(jsonb_build_object('needed', fiila.kyc_needed(s.id), 'status', k.status, 'doc_type', k.doc_type,
      'reason', case when k.status = 'rejected' then k.reason end, 'at', k.submitted_at)),
    'blocked', fiila.kyc_blocked(s.id));
end $$;

-- Nom et numéro du propriétaire : réservés au propriétaire.
create or replace function public.fiila_shop_owner_save(p_key text, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'owner'); v_name text := nullif(fiila.clean(p_name, 80), ''); v_phone text := fiila.phone_key(p_phone);
begin
  perform fiila.rate_check('shop_owner_save', 20);
  if v_name is null or char_length(v_name) < 2 then perform fiila.fail('owner_name_required'); end if;
  if v_phone !~ '^(7[05678][0-9]{7}|[1-9][0-9]{7,14})$' then perform fiila.fail('phone_invalid'); end if;
  update fiila.shops set owner_name = v_name, owner_phone = case when v_phone ~ '^7[0-9]{8}$' then '+221' || v_phone else '+' || v_phone end,
    updated_at = now() where id = s.id;
  return public.fiila_shop_identity(p_key);
end $$;

-- Envoi de la pièce : carte d'identité (recto et verso) ou passeport (page photo). Réservé au propriétaire.
create or replace function public.fiila_shop_kyc_submit(p_key text, p_doc_type text, p_front text, p_back text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'owner'); f bytea; b bytea; k fiila.shop_kyc;
begin
  perform fiila.rate_check('shop_kyc_submit', 10);
  if p_doc_type not in ('cni', 'passport') then perform fiila.fail('invalid_payload'); end if;
  select * into k from fiila.shop_kyc where shop_id = s.id;
  if k.status = 'verified' then perform fiila.fail('kyc_already_verified'); end if;
  f := fiila.kyc_image(p_front);
  if p_doc_type = 'cni' then
    if p_back is null then perform fiila.fail('kyc_back_required'); end if;
    b := fiila.kyc_image(p_back);
  end if;
  insert into fiila.shop_kyc (shop_id, doc_type, front, front_type, back, back_type, status, reason, submitted_at, reviewed_at, reviewed_by)
  values (s.id, p_doc_type, f, fiila.kyc_type(f), b, case when b is not null then fiila.kyc_type(b) end, 'submitted', null, now(), null, null)
  on conflict (shop_id) do update set doc_type = excluded.doc_type, front = excluded.front, front_type = excluded.front_type,
    back = excluded.back, back_type = excluded.back_type, status = 'submitted', reason = null, submitted_at = now(), reviewed_at = null, reviewed_by = null;
  return public.fiila_shop_identity(p_key);
end $$;

-- Fii Studio proposé partout (fondateur, 27/10) : état du Studio pour la boutique, sans article (nouvel article, liste,
-- fin du démarrage). Lecture pour toute l'équipe de la boutique.
create or replace function public.fiila_studio_state_shop(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  return jsonb_build_object('ready', fiila.studio_ready() and not fiila.studio_service(s.business_type), 'credits', fiila.studio_credits(s.id),
    'premium', fiila.studio_premium_ok(s.business_type),
    'photos', (select count(*) from fiila.products p where p.shop_id = s.id and p.photo is not null),
    'kept', (select count(*) from fiila.studio_jobs j where j.shop_id = s.id and j.status = 'kept'));
end $$;

-- ---------------------------------------------------------------- back-office (droit shops_write)
-- Propriétaire et état de la pièce, sans les images.
create or replace function public.fiila_bo_shop_identity(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; k fiila.shop_kyc;
begin
  perform fiila.need_staff('shops_write');
  select * into s from fiila.shops where id = p_shop;
  if s.id is null then perform fiila.fail('not_found'); end if;
  select * into k from fiila.shop_kyc where shop_id = s.id;
  return jsonb_build_object('owner_name', s.owner_name, 'owner_phone', s.owner_phone, 'sold', fiila.shop_sold(s.id),
    'needed', fiila.kyc_needed(s.id), 'blocked', fiila.kyc_blocked(s.id),
    'kyc', case when k.shop_id is not null then jsonb_build_object('doc_type', k.doc_type, 'status', k.status, 'reason', k.reason,
      'submitted_at', k.submitted_at, 'reviewed_at', k.reviewed_at, 'has_images', k.front is not null) end);
end $$;

-- Images de la pièce : chaque consultation est journalisée.
create or replace function public.fiila_bo_kyc_doc(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k fiila.shop_kyc;
begin
  perform fiila.need_staff('shops_write');
  select * into k from fiila.shop_kyc where shop_id = p_shop;
  if k.shop_id is null or k.front is null then perform fiila.fail('not_found'); end if;
  perform fiila.bo_log('kyc_view', 'shop', p_shop::text, jsonb_build_object('doc_type', k.doc_type));
  return jsonb_build_object('doc_type', k.doc_type,
    'front', 'data:' || k.front_type || ';base64,' || replace(encode(k.front, 'base64'), E'\n', ''),
    'back', case when k.back is not null then 'data:' || k.back_type || ';base64,' || replace(encode(k.back, 'base64'), E'\n', '') end);
end $$;

-- Valider ou refuser (motif obligatoire, visible par la boutique). Un refus efface les images et rebloque la boutique.
create or replace function public.fiila_bo_kyc_decide(p_shop uuid, p_ok boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('shops_write'); k fiila.shop_kyc; v_reason text := nullif(fiila.clean(p_reason, 200), '');
begin
  select * into k from fiila.shop_kyc where shop_id = p_shop for update;
  if k.shop_id is null then perform fiila.fail('not_found'); end if;
  if p_ok is null then perform fiila.fail('invalid_payload'); end if;
  if not p_ok and v_reason is null then perform fiila.fail('reason_required'); end if;
  if p_ok then
    update fiila.shop_kyc set status = 'verified', reason = null, reviewed_at = now(), reviewed_by = v_uid where shop_id = p_shop;
  else
    update fiila.shop_kyc set status = 'rejected', reason = v_reason, front = null, front_type = null, back = null, back_type = null,
      reviewed_at = now(), reviewed_by = v_uid where shop_id = p_shop;
  end if;
  perform fiila.bo_log(case when p_ok then 'kyc_verified' else 'kyc_rejected' end, 'shop', p_shop::text, jsonb_build_object('reason', v_reason));
  return public.fiila_bo_shop_identity(p_shop);
end $$;

-- File : pièces à vérifier, et boutiques bloquées faute de pièce.
create or replace function public.fiila_bo_kyc_list() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('shops_write');
  return jsonb_build_object(
    'pending', coalesce((select jsonb_agg(jsonb_build_object('shop_id', s.id, 'shop', s.name, 'owner_name', s.owner_name, 'owner_phone', s.owner_phone,
        'doc_type', k.doc_type, 'at', k.submitted_at) order by k.submitted_at)
      from fiila.shop_kyc k join fiila.shops s on s.id = k.shop_id where k.status = 'submitted'), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('shop_id', s.id, 'shop', s.name, 'owner_name', s.owner_name, 'owner_phone', s.owner_phone,
        'rejected', exists (select 1 from fiila.shop_kyc k where k.shop_id = s.id and k.status = 'rejected')) order by s.name)
      from fiila.shops s where fiila.kyc_blocked(s.id)), '[]'::jsonb),
    'verified', (select count(*) from fiila.shop_kyc where status = 'verified'));
end $$;

-- Tableau de bord : file « Pièces d'identité à vérifier » ; réglage kyc_required (0/1).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_overview()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'suspended', case when fiila.staff_can(v_uid, 'shops') then (select count(*) from fiila.shops where suspended_at is not null) end$s$,
    $s$'suspended', case when fiila.staff_can(v_uid, 'shops') then (select count(*) from fiila.shops where suspended_at is not null) end,
      'kyc', case when fiila.staff_can(v_uid, 'shops_write') then (select count(*) from fiila.shop_kyc where status = 'submitted') end$s$);
  if v_new = v_def then raise exception 'owner_kyc: fiila_bo_overview non modifiée'; end if;
  execute v_new;
  -- Mesure anonyme des deux nouvelles étapes du démarrage.
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'product:skip', 'vitrine:open', 'share:click'$s$, $s$'product:skip', 'vitrine:open', 'look:done', 'owner:done', 'share:click'$s$);
  if v_new = v_def then raise exception 'owner_kyc: fiila_track non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$when 'studio_premium' then array[0, 1]$s$, $s$when 'studio_premium' then array[0, 1] when 'kyc_required' then array[0, 1]$s$);
  if v_new = v_def then raise exception 'owner_kyc: bo_setting_bounds non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'studio_premium', 'studio_premium_credits']$s$, $s$'studio_premium', 'studio_premium_credits', 'kyc_required']$s$);
  if v_new = v_def then raise exception 'owner_kyc: fiila_bo_settings non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  shop_fns text[] := array['public.fiila_studio_state_shop(text)', 'public.fiila_shop_identity(text)', 'public.fiila_shop_owner_save(text, text, text)', 'public.fiila_shop_kyc_submit(text, text, text, text)'];
  bo_fns text[] := array['public.fiila_bo_shop_identity(uuid)', 'public.fiila_bo_kyc_doc(uuid)', 'public.fiila_bo_kyc_decide(uuid, boolean, text)', 'public.fiila_bo_kyc_list()'];
begin
  foreach fn in array shop_fns || bo_fns loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array shop_fns loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  foreach fn in array bo_fns loop
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', fn); end if;
  end loop;
end $$;
