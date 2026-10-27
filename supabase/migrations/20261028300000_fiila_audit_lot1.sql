-- Audit du 27/10/2026 (HANDOFF #78), corrections côté base demandées par le fondateur (« corrige tous les autres points »).
-- Chaque fonction modifiée est réécrite EN ENTIER (plus de remplacement de texte dans une définition : recommandation de
-- l'audit, contrôlée par tests/migrations.sql.test.mjs pour les migrations suivantes).
--   1. Stock rendu quand une commande du site est annulée (et repris si elle est rouverte) ;
--   2. journal des commandes et des paiements (order_events) : changement d'état, paiement ajouté ou supprimé ;
--   3. RLS activé sur toutes les tables du schéma fiila (sans politique : seules les fonctions y accèdent) ;
--   4. fonctions du back-office fermées au rôle anon (sauf l'ouverture d'une invitation et le portail fiila_bo_me) ;
--   5. purges : empreinte IP des favoris et suivis après 30 jours, séries Studio après 6 mois, invitations d'équipe
--      utilisées ou expirées après 90 jours, sel des empreintes IP renouvelé chaque année ; images de la pièce d'identité
--      effacées dès sa validation ; « suivre » effacé avec le compte ;
--   6. identifiant d'appareil haché avec un sel secret, et « effacer mes favoris sur ce téléphone » ;
--   7. crédits Studio : portefeuille verrouillé pendant « garder », retrait au-delà du solde refusé ; NINEA plus enregistré ;
--   8. gains des Agents calculés chaque nuit (plus seulement quand l'agent ouvre son tableau de bord) ;
--   9. copie des photos (fiila-media-sync) réservée au planificateur (jeton en base) et à l'équipe ;
--  10. index des clés étrangères signalées par Supabase ; erreurs du navigateur comptées (sans contenu) et santé au back-office.

-- ---------------------------------------------------------------- 2. journal des commandes et des paiements
create table fiila.order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references fiila.orders (id) on delete cascade,
  shop_id    uuid not null,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('status', 'payment_add', 'payment_delete')),
  from_status text,
  to_status  text,
  amount     bigint,
  method     text,
  actor      text                -- 'u:<compte>' si une personne connectée a agi, sinon 'cle' (clé de boutique ou de livreur)
);
create index order_events_order on fiila.order_events (order_id, at);
revoke all on fiila.order_events from public;

create or replace function fiila.order_actor() returns text
language sql stable set search_path = '' as $$ select coalesce('u:' || fiila.uid()::text, 'cle') $$;

create or replace function fiila.order_events_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into fiila.order_events (order_id, shop_id, kind, from_status, to_status, actor)
    values (new.id, new.shop_id, 'status', old.status, new.status, fiila.order_actor());
  end if;
  return new;
end $$;
create trigger order_events_status after update of status on fiila.orders for each row execute function fiila.order_events_status();

create or replace function fiila.order_events_payment() returns trigger
language plpgsql set search_path = '' as $$
declare o fiila.orders;
begin
  if tg_op = 'INSERT' then
    select * into o from fiila.orders where id = new.order_id;
    insert into fiila.order_events (order_id, shop_id, kind, amount, method, actor) values (new.order_id, o.shop_id, 'payment_add', new.amount, new.method, fiila.order_actor());
    return new;
  end if;
  select * into o from fiila.orders where id = old.order_id;
  if o.id is not null then -- commande supprimée (purge, suppression de boutique) : rien à journaliser
    insert into fiila.order_events (order_id, shop_id, kind, amount, method, actor) values (old.order_id, o.shop_id, 'payment_delete', old.amount, old.method, fiila.order_actor());
  end if;
  return old;
end $$;
create trigger order_events_payment after insert or delete on fiila.payments for each row execute function fiila.order_events_payment();

-- ---------------------------------------------------------------- 1. statut d'une commande, stock rendu à l'annulation
create or replace function public.fiila_order_set_status(p_key text, p_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o fiila.orders := fiila.my_order(p_key, p_id); v_old text;
begin
  if p_status not in ('open', 'delivered', 'cancelled') then perform fiila.fail('invalid_status'); end if;
  v_old := o.status;
  update fiila.orders set status = p_status, updated_at = now(),
    delivered_at = case when p_status = 'delivered' then now() end,
    cancelled_at = case when p_status = 'cancelled' then now() end
   where id = o.id returning * into o;
  -- Stock suivi : décompté à la commande du site (fiila_vitrine_order), rendu à l'annulation, repris à la réouverture.
  -- Les commandes saisies dans l'application ne touchent pas au stock (libellés libres).
  if o.source = 'vitrine' and v_old is distinct from p_status and (v_old = 'cancelled' or p_status = 'cancelled') then
    update fiila.products p set stock = case when p_status = 'cancelled' then least(100000, p.stock + x.q) else greatest(0, p.stock - x.q) end
      from (select fiila.as_uuid(it ->> 'product_id') pid, sum(greatest(0, coalesce((it ->> 'qty')::int, 0))) q
              from jsonb_array_elements(o.items) it where it ? 'product_id' group by 1) x
     where p.id = x.pid and p.shop_id = o.shop_id and p.stock is not null;
  end if;
  if p_status <> 'open' and o.watch_token is not null then
    update fiila.trackers set status = 'stopped', lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null,
      expires_at = least(expires_at, now())
     where watch_token = o.watch_token;
  end if;
  return fiila.order_json(o, true) || jsonb_build_object('items', fiila.items_with_photos(o.items));
end $$;

-- Back-office : historique d'une commande (lecture, droit « orders »).
create or replace function public.fiila_bo_order_events(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('orders');
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', e.at, 'kind', e.kind, 'from', e.from_status, 'to', e.to_status,
      'amount', e.amount, 'method', e.method, 'actor', case when e.actor = 'cle' then 'boutique' else 'compte' end)) order by e.at)
    from fiila.order_events e where e.order_id = p_order), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 6. identifiant d'appareil haché avec un sel secret
insert into fiila.settings (key, value) values ('device_salt', fiila.token(32)) on conflict (key) do nothing;
create or replace function fiila.device_key(p_device text) returns text
language sql stable set search_path = '' as $$
  select case when p_device ~ '^[A-Za-z0-9_-]{22,64}$'
    then 'd:' || encode(extensions.hmac(p_device, (select value from fiila.settings where key = 'device_salt'), 'sha256'), 'hex') end
$$;
create or replace function fiila.who(p_device text) returns text
language plpgsql stable set search_path = '' as $$
declare v_uid uuid := fiila.uid();
begin
  if v_uid is not null then return 'u:' || v_uid; end if;
  return fiila.device_key(p_device);
end $$;
-- Favoris, suivis et signalements faits sans compte depuis ce téléphone : effacés à la demande (page confidentialité).
create or replace function public.fiila_forget_device(p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.device_key(p_device); n1 int; n2 int; n3 int;
begin
  if v_who is null then perform fiila.fail('device_required'); end if;
  perform fiila.rate_check('forget_device', 20);
  delete from fiila.likes where who = v_who;
  delete from fiila.saves where who = v_who; get diagnostics n1 = row_count;
  delete from fiila.follows where who = v_who; get diagnostics n2 = row_count;
  delete from fiila.comment_reports where who = v_who; get diagnostics n3 = row_count;
  return jsonb_build_object('favs', n1, 'follows', n2, 'reports', n3);
end $$;
-- Anciennes lignes à empreinte non salée : plus rattachables à un appareil, effacées.
delete from fiila.likes where who like 'd:%';
delete from fiila.saves where who like 'd:%';
delete from fiila.follows where who like 'd:%';
delete from fiila.comment_reports where who like 'd:%';

-- ---------------------------------------------------------------- 5. purges et effacements
insert into fiila.settings (key, value) values ('rate_salt_at', now()::text) on conflict (key) do nothing;
create or replace function fiila.housekeeping() returns void
language plpgsql set search_path = '' as $$
declare v_last timestamptz;
begin
  select value::timestamptz into v_last from fiila.settings where key = 'housekeeping_at' for update skip locked;
  if v_last is null or v_last > now() - interval '10 minutes' then return; end if;
  update fiila.settings set value = now()::text where key = 'housekeeping_at';
  delete from fiila.rate_events where at < now() - interval '1 day';
  delete from fiila.places where kind = 'meeting' and expires_at < now() - interval '30 days';
  delete from fiila.requests where expires_at < now() - interval '30 days'
    and not exists (select 1 from fiila.orders o where o.request_id = requests.id and o.place_id is null and o.status = 'open');
  delete from fiila.retired_tokens where retired_at < now() - interval '180 days';
  delete from fiila.trackers where expires_at < now() - interval '1 day';
  update fiila.trackers set lat = null, lng = null, acc = null, trail = '[]'::jsonb, courier_send = null
   where expires_at < now() and (lat is not null or courier_send is not null);
  delete from fiila.courier_invites where coalesce(used_at, expires_at) < now() - interval '7 days';
  -- conservation des données de boutique : 24 mois
  delete from fiila.orders where created_at < now() - interval '24 months';
  delete from fiila.customers c where c.updated_at < now() - interval '24 months'
    and not exists (select 1 from fiila.orders o where o.customer_id = c.id);
  -- Audit du 27/10 : empreinte IP des favoris et suivis (anti-abus du classement sur 14 jours) gardée 30 jours ;
  -- séries Studio 6 mois ; invitations d'équipe utilisées ou expirées 90 jours ; sel des empreintes IP renouvelé chaque année.
  update fiila.likes set src = null where src is not null and created_at < now() - interval '30 days';
  update fiila.saves set src = null where src is not null and created_at < now() - interval '30 days';
  update fiila.follows set src = null where src is not null and created_at < now() - interval '30 days';
  delete from fiila.studio_jobs where created_at < now() - interval '6 months';
  delete from fiila.shop_invites where coalesce(used_at, expires_at) < now() - interval '90 days';
  if coalesce((select value::timestamptz from fiila.settings where key = 'rate_salt_at'), now()) < now() - interval '365 days' then
    update fiila.settings set value = fiila.token(24) where key = 'rate_salt';
    update fiila.settings set value = now()::text where key = 'rate_salt_at';
  end if;
end $$;

-- Pièce d'identité : images effacées dès la validation (type, dates et décision gardés).
create or replace function public.fiila_bo_kyc_decide(p_shop uuid, p_ok boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('shops_write'); k fiila.shop_kyc; v_reason text := nullif(fiila.clean(p_reason, 200), '');
begin
  select * into k from fiila.shop_kyc where shop_id = p_shop for update;
  if k.shop_id is null then perform fiila.fail('not_found'); end if;
  if p_ok is null then perform fiila.fail('invalid_payload'); end if;
  if not p_ok and v_reason is null then perform fiila.fail('reason_required'); end if;
  update fiila.shop_kyc set status = case when p_ok then 'verified' else 'rejected' end, reason = case when p_ok then null else v_reason end,
    front = null, front_type = null, back = null, back_type = null, reviewed_at = now(), reviewed_by = v_uid where shop_id = p_shop;
  perform fiila.bo_log(case when p_ok then 'kyc_verified' else 'kyc_rejected' end, 'shop', p_shop::text, jsonb_build_object('reason', v_reason));
  return public.fiila_bo_shop_identity(p_shop);
end $$;
update fiila.shop_kyc set front = null, front_type = null, back = null, back_type = null where status = 'verified';

create or replace function public.fiila_delete_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  perform fiila.rate_check('delete_account', 10);
  if not fiila.recent_login() then perform fiila.fail('reauth_required'); end if;
  if exists (select 1 from fiila.vd_submissions where user_id = v_uid and status = 'sold' and paid_at is null)
     or exists (select 1 from fiila.ambassador_rewards r join fiila.ambassadors a on a.id = r.ambassador_id
                where a.user_id = v_uid and r.status = 'validated') then
    perform fiila.fail('payout_pending');
  end if;
  update fiila.products set active = false where submission_id in (select id from fiila.vd_submissions where user_id = v_uid);
  delete from fiila.likes where who = 'u:' || v_uid;
  delete from fiila.saves where who = 'u:' || v_uid;
  delete from fiila.follows where who = 'u:' || v_uid;
  delete from fiila.comment_reports where who = 'u:' || v_uid;
  delete from fiila.staff where user_id = v_uid;
  delete from fiila.requests where id in (select o.request_id from fiila.orders o join fiila.shops s on s.id = o.shop_id
                                           where s.user_id = v_uid and o.request_id is not null);
  delete from fiila.shops where user_id = v_uid;
  delete from fiila.couriers where user_id = v_uid;
  delete from fiila.places where user_id = v_uid;
  delete from fiila.requests where user_id = v_uid;
  delete from fiila.profiles where user_id = v_uid;
  delete from auth.users where id = v_uid;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- 7. crédits Studio, NINEA
create or replace function public.fiila_studio_keep(p_key text, p_job uuid, p_index integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); j fiila.studio_jobs; c jsonb; v_need int; v_trial int; v_from text;
begin
  select * into j from fiila.studio_jobs where id = p_job and shop_id = s.id for update;
  if j.id is null then perform fiila.fail('not_found'); end if;
  if j.status = 'kept' then return jsonb_build_object('id', j.id, 'status', j.status, 'kept', j.kept, 'url', j.results ->> j.kept, 'credits', fiila.studio_credits(s.id)); end if;
  if j.status <> 'done' or p_index is null or p_index < 0 or p_index >= jsonb_array_length(j.results) then perform fiila.fail('invalid_state'); end if;
  -- Deux « garder » en même temps (deux séries, deux téléphones) : le portefeuille et l'essai sont verrouillés.
  perform 1 from fiila.studio_wallets where shop_id = s.id for update;
  perform 1 from fiila.partner_trials where shop_id = s.id for update;
  v_need := fiila.studio_cost(j.mode);
  c := fiila.studio_credits(s.id);
  if (c ->> 'total')::int < v_need then perform fiila.fail('studio_no_credits'); end if;
  v_trial := least(v_need, (c ->> 'trial')::int);
  if v_trial > 0 then update fiila.partner_trials set studio_used = studio_used + v_trial where shop_id = s.id; end if;
  if v_need - v_trial > 0 then
    update fiila.studio_wallets set credits = credits - (v_need - v_trial), updated_at = now() where shop_id = s.id;
  end if;
  v_from := case when v_trial > 0 then 'trial' else 'wallet' end;
  update fiila.studio_jobs set status = 'kept', kept = p_index, credit_from = v_from where id = j.id returning * into j;
  return jsonb_build_object('id', j.id, 'status', j.status, 'kept', j.kept, 'url', j.results ->> j.kept, 'credits', fiila.studio_credits(s.id));
end $$;

create or replace function public.fiila_bo_studio_grant(p_shop uuid, p_delta integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_reason text := nullif(fiila.clean(p_reason, 200), ''); w fiila.studio_wallets; v_cur int;
begin
  perform fiila.need_staff('shops_write');
  if v_reason is null then perform fiila.fail('reason_required'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 500 then perform fiila.fail('invalid_value'); end if;
  if not exists (select 1 from fiila.shops where id = p_shop) then perform fiila.fail('not_found'); end if;
  select credits into v_cur from fiila.studio_wallets where shop_id = p_shop for update;
  -- Un retrait plus grand que le solde est refusé (avant : ramené à 0 sans le dire, et le journal notait le retrait demandé).
  if coalesce(v_cur, 0) + p_delta < 0 then perform fiila.fail('not_enough_credits'); end if;
  -- Ligne proposée toujours positive (la contrainte la vérifie avant de passer à la mise à jour) ; le solde réel est calculé dessous.
  insert into fiila.studio_wallets (shop_id, credits) values (p_shop, greatest(0, p_delta))
    on conflict (shop_id) do update set credits = fiila.studio_wallets.credits + p_delta, updated_at = now()
    returning * into w;
  perform fiila.bo_log('studio_grant', 'shop', p_shop::text, jsonb_build_object('delta', p_delta, 'credits', w.credits, 'reason', v_reason));
  return jsonb_build_object('shop_id', p_shop, 'credits', w.credits);
end $$;

-- NINEA : plus demandé depuis le 18/10 (décision du fondateur) ; le serveur ne l'enregistre plus, l'ancien est effacé.
create or replace function public.fiila_shop_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); v_name text; v_phone text; s fiila.shops; v_key text; v_type text;
begin
  perform fiila.rate_check('shop_save', 60);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name  := fiila.clean(p ->> 'name', 60);
  v_phone := fiila.clean_phone(p ->> 'phone');
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
    update fiila.shops set name = v_name, phone = v_phone, ninea = null,
      business_type = case when p ? 'business_type' then v_type else business_type end, updated_at = now() where id = s.id returning * into s;
    return jsonb_build_object('shop', fiila.shop_json(s));
  end if;
  v_key := fiila.token(32);
  insert into fiila.shops (user_id, owner_hash, name, phone, ninea, business_type) values (v_uid, fiila.h(v_key), v_name, v_phone, null, v_type)
  returning * into s;
  return jsonb_build_object('shop', fiila.shop_json(s), 'key', v_key);
end $$;
update fiila.shops set ninea = null where ninea is not null;

-- ---------------------------------------------------------------- 8. gains des Agents calculés chaque nuit
create or replace function fiila.amb_eval_all() returns int
language plpgsql set search_path = '' as $$
declare l fiila.ambassador_shops; n int := 0;
begin
  for l in select ls.* from fiila.ambassador_shops ls join fiila.ambassadors a on a.id = ls.ambassador_id where a.status = 'active' loop
    perform fiila.amb_eval(l); n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- 9. copie des photos : jeton du planificateur
insert into fiila.settings (key, value) values ('media_sync_token', fiila.token(32)) on conflict (key) do nothing;
create or replace function public.fiila_media_sync_auth(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_token) >= 32 and extensions.digest(p_token, 'sha256')
    = extensions.digest((select value from fiila.settings where key = 'media_sync_token'), 'sha256'), false)
$$;

-- ---------------------------------------------------------------- 10. santé : erreurs du navigateur et des tâches
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
    or (p_event = 'nudge' and p_variant ~ '^[a-z_]{3,30}:(shown|click|dismiss)$')
    or (p_event = 'onboarding' and p_variant ~ '^[a-z_]{3,30}:(open|click|hide)$')
    or (p_event = 'home_hero' and p_variant ~ '^(adresse|demander|evenement|livreur|vide_dressing|ambassadeur):(shown|click|success)$')
    or (p_event = 'home_pref' and p_variant in ('pin', 'unpin', 'reset'))
    or (p_event = 'resume' and p_variant ~ '^(order|product):(shown|click|success)$')
    or (p_event = 'retention' and p_variant ~ '^(home_shop|shop_more_products|shop_share_vitrine|shop_courier|shop_photos|shop_team|addr_photo|addr_mark):(shown|click|dismiss|used|repeat)$')
    or (p_event = 'order_address' and p_variant in ('shown', 'used'))
    or (p_event = 'premium' and p_variant ~ '^(atelier|comptoir|maison|edition):(locked|preview|interest|applied)$')
    or (p_event = 'app' and p_variant in ('android', 'ios'))
    or (p_event = 'studio' and p_variant ~ '^(open|run|kept|cancel):[a-z0-9-]{2,40}$')
    or (p_event = 'site' and p_variant in ('sheet:open', 'sheet:add', 'guide:open', 'look:click', 'tab:new', 'tab:cat', 'tab:promos'))
    or (p_event = 'settings_ui' and p_variant ~ '^(cta:(site|product|logo|cover|policies|owner)|tile:(info|policies|team|courier|identity|agent)|share)$')
    or (p_event = 'studio_ui' and p_variant in ('mode:fidele', 'mode:premium', 'compare', 'publish', 'finish'))
    -- Erreur du navigateur : seulement l'écran où elle s'est produite (premier segment de l'adresse), jamais son contenu.
    or (p_event = 'js_error' and p_variant ~ '^[a-z_]{2,30}$')
    or (p_event = 'migrate' and p_variant in ('merged', 'empty'))
    or (p_event = 'marketing' and p_variant ~ '^(open|period:(7|30|90)|share:(wa|copy|qr)|socials:(open|save)|publish:(click|open|post|story|shared|saved|instagram|facebook|whatsapp|tiktok|snapchat)|vitrine:open)$')
    or (p_event = 'shop_setup' and p_variant in ('name:done', 'product:done', 'product:skip', 'vitrine:open', 'look:done', 'owner:done', 'share:click', 'resume:open'))
    or (p_event = 'discover' and p_variant ~ '^(order|sent|course|fiche|event):(shown|click|hide|all)$')
    or (p_event = 'wa_card' and p_variant ~ '^(request|address|vitrine|invite|agent|order|delivery|event):(file|text|download|failed)$')
    or (p_event = 'payment_recorded' and p_variant in ('cash', 'wave', 'orange_money', 'card', 'other'))
  ) then
    perform fiila.fail('invalid_event');
  end if;
  perform fiila.rate_check('track', 300);
  insert into fiila.metrics (day, event, variant, n)
  values ((now() at time zone 'utc')::date, p_event, p_variant, 1)
  on conflict (day, event, variant) do update set n = fiila.metrics.n + 1;
end $$;

-- Back-office, tableau de bord : erreurs du navigateur par écran (7 jours), copies de photos et séries Studio en échec.
create or replace function public.fiila_bo_health() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('dashboard');
  return jsonb_build_object(
    'js_errors', coalesce((select jsonb_object_agg(variant, n) from (select variant, sum(n)::int n from fiila.metrics
      where event = 'js_error' and day > (now() at time zone 'utc')::date - 7 group by 1) x), '{}'::jsonb),
    'media_failed', (select count(*) from fiila.media_log where action = 'failed' and at > now() - interval '7 days'),
    'studio_failed', (select count(*) from fiila.studio_jobs where status = 'failed' and created_at > now() - interval '7 days'));
end $$;

-- ---------------------------------------------------------------- 10. index des clés étrangères (avis Supabase)
create index if not exists partner_invites_shop on fiila.partner_invites (shop_id);
create index if not exists partner_invites_accepted on fiila.partner_invites (accepted_shop);
create index if not exists partner_invites_pack on fiila.partner_invites (pack_code, pack_version);
create index if not exists partner_trials_pack on fiila.partner_trials (pack_code, pack_version);
create index if not exists partner_messages_created_by on fiila.partner_messages (created_by);
create index if not exists shop_domains_created_by on fiila.shop_domains (created_by);
create index if not exists studio_jobs_product on fiila.studio_jobs (product_id);
create index if not exists studio_jobs_created_by on fiila.studio_jobs (created_by);

-- ---------------------------------------------------------------- 3. RLS sur toutes les tables du schéma fiila
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'fiila' and c.relkind in ('r', 'p') and not c.relrowsecurity loop
    execute format('alter table fiila.%I enable row level security', r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------- planificateur (production seulement)
do $$
begin
  if to_regnamespace('cron') is null then return; end if;
  begin
    perform cron.unschedule('fiila-media-sync');
  exception when others then null; -- tâche absente : elle est (re)créée juste après
  end;
  perform cron.schedule('fiila-media-sync', '* * * * *',
    $c$select net.http_post(url := (select value from fiila.settings where key = 'media_sync_url'), body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', (select value from fiila.settings where key = 'media_sync_token')))$c$);
  perform cron.schedule('fiila-amb-eval', '15 2 * * *', $c$select fiila.amb_eval_all()$c$);
exception when others then
  raise notice 'audit lot 1 : planificateur non modifié (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------- droits
revoke all on all functions in schema fiila from public;
do $$
declare r record; role_name text; fn text;
  pub text[] := array['public.fiila_order_set_status(text, text, text)', 'public.fiila_forget_device(text)', 'public.fiila_delete_account()',
    'public.fiila_studio_keep(text, uuid, integer)', 'public.fiila_shop_save(text, jsonb)', 'public.fiila_track(text, text)'];
  staff text[] := array['public.fiila_bo_order_events(uuid)', 'public.fiila_bo_health()', 'public.fiila_bo_kyc_decide(uuid, boolean, text)', 'public.fiila_bo_studio_grant(uuid, integer, text)'];
begin
  foreach fn in array pub || staff || array['public.fiila_media_sync_auth(text)'] loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array pub loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach fn in array staff loop execute format('grant execute on function %s to authenticated', fn); end loop;
  end if;
  -- Copie des photos : jeton vérifié par la fonction Edge avec la clé de service seulement.
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function public.fiila_media_sync_auth(text) from %I', role_name); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.fiila_media_sync_auth(text) to service_role'; end if;
  -- 4. Back-office fermé à anon (Supabase accorde anon par défaut à toute nouvelle fonction : incidents du 22/10 et 27/10).
  --    Exceptions : l'ouverture d'une invitation d'équipe (avant connexion) et fiila_bo_me (« pas de l'équipe » pour un
  --    visiteur ; une session expirée ramène ainsi à la connexion au lieu d'une erreur).
  if exists (select 1 from pg_roles where rolname = 'anon') then
    for r in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname ~ '^fiila_(bo|admin)_' and p.proname not in ('fiila_bo_invite_get', 'fiila_bo_me') loop
      execute format('revoke execute on function %s from anon', r.sig);
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', r.sig); end if;
    end loop;
  end if;
end $$;
