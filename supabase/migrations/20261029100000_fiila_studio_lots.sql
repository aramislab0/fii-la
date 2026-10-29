-- Fii Studio : lots de crédits datés et bonus de bienvenue (OFFRE-COMMERCIALE-001 §3 ; fondateur 29/10 : « vas y avance »,
-- « Par compte »).
-- Lots : chaque attribution de crédits (bienvenue, Business du mois, achat) est un lot à part, avec son reste et sa date
-- d'expiration (aucune pour un achat). Une série retient d'abord les lots qui expirent le plus tôt, puis l'essai
-- partenaire, puis le portefeuille ; un échec rend chaque part à son lot. Un lot expiré ne compte plus.
-- Bienvenue : 10 crédits valables 30 jours, une seule fois par compte propriétaire (et par numéro vérifié quand les SMS
-- seront branchés), accordés quand la boutique (hors démo) est publique avec au moins un article actif photographié.
-- Désactivé (studio_welcome = 0) tant que l'enveloppe n'est pas financée. Les comptes dont une boutique a déjà reçu des
-- crédits offerts sont marqués « rapprochés » : pas de second bonus, rien n'est retiré.
-- Business (60 crédits par mois, non reportés) et achats : fiila_studio_lot_add, clé de service seulement, idempotente.

create table if not exists fiila.studio_credit_lots (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references fiila.shops (id) on delete cascade,
  source     text not null check (source in ('welcome', 'business', 'purchase')),
  credits    int not null check (credits > 0),
  remaining  int not null,
  expires_at timestamptz,
  ref        text not null unique,
  note       text,
  created_at timestamptz not null default now(),
  check (remaining between 0 and credits),
  check ((source = 'purchase') = (expires_at is null))
);
alter table fiila.studio_credit_lots enable row level security;
revoke all on fiila.studio_credit_lots from public;
create index if not exists studio_credit_lots_shop on fiila.studio_credit_lots (shop_id, expires_at);

create table if not exists fiila.studio_welcome (
  user_id uuid primary key,
  shop_id uuid references fiila.shops (id) on delete set null,
  lot_id  uuid references fiila.studio_credit_lots (id) on delete set null,
  status  text not null check (status in ('granted', 'reconciled')),
  at      timestamptz not null default now()
);
alter table fiila.studio_welcome enable row level security;
revoke all on fiila.studio_welcome from public;

alter table fiila.studio_jobs add column if not exists credits_lots jsonb not null default '[]'::jsonb;
alter table fiila.studio_jobs drop constraint if exists studio_jobs_credit_from_check;
alter table fiila.studio_jobs add constraint studio_jobs_credit_from_check check (credit_from in ('trial', 'wallet', 'lot'));

insert into fiila.settings (key, value) values ('studio_welcome', '0'), ('studio_welcome_credits', '10'), ('studio_welcome_days', '30')
  on conflict (key) do nothing;

-- Rapprochement : un compte dont une boutique a déjà reçu des crédits du Studio n'a pas de bonus de bienvenue en plus.
insert into fiila.studio_welcome (user_id, shop_id, status)
select distinct on (s.user_id) s.user_id, s.id, 'reconciled' from fiila.shops s
 where s.user_id is not null and exists (select 1 from fiila.studio_wallets w where w.shop_id = s.id)
 order by s.user_id, s.created_at
on conflict (user_id) do nothing;

-- Crédits d'une boutique : essai, portefeuille, lots valables ; « expiring » = crédits datés et la date la plus proche.
create or replace function fiila.studio_credits(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t fiila.partner_trials := fiila.trial_refresh(p_shop); v_trial int := 0; v_wallet int; v_lots int; v_dated int; v_at timestamptz;
begin
  if t.id is not null and t.status = 'active' then
    select greatest(0, coalesce((p.limits ->> 'studio_credits')::int, 0) - t.studio_used) into v_trial
      from fiila.partner_packs p where p.code = t.pack_code and p.version = t.pack_version;
  end if;
  select credits into v_wallet from fiila.studio_wallets where shop_id = p_shop;
  select coalesce(sum(remaining), 0), coalesce(sum(remaining) filter (where expires_at is not null), 0), min(expires_at)
    into v_lots, v_dated, v_at
    from fiila.studio_credit_lots where shop_id = p_shop and remaining > 0 and (expires_at is null or expires_at > now());
  return jsonb_strip_nulls(jsonb_build_object('trial', coalesce(v_trial, 0), 'wallet', coalesce(v_wallet, 0), 'lots', nullif(v_lots, 0),
    'total', coalesce(v_trial, 0) + coalesce(v_wallet, 0) + v_lots,
    'expiring', case when v_dated > 0 then jsonb_build_object('credits', v_dated, 'at', v_at) end));
end $$;

create or replace function fiila.studio_lots_sum(p_lots jsonb) returns int
language sql immutable set search_path = '' as $$
  select coalesce(sum((x ->> 'n')::int), 0)::int from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb)) x
$$;

-- Retient p_need crédits (verrous pris par l'appelant) : lots qui expirent le plus tôt, puis essai, puis portefeuille.
create or replace function fiila.studio_take(p_shop uuid, p_need int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_left int := p_need; v_n int; v_trial int; v_lots jsonb := '[]'::jsonb; l record; c jsonb := fiila.studio_credits(p_shop);
begin
  for l in select id, remaining from fiila.studio_credit_lots
            where shop_id = p_shop and remaining > 0 and (expires_at is null or expires_at > now())
            order by expires_at nulls last, created_at loop
    exit when v_left = 0;
    v_n := least(v_left, l.remaining);
    update fiila.studio_credit_lots set remaining = remaining - v_n where id = l.id;
    v_lots := v_lots || jsonb_build_array(jsonb_build_object('lot', l.id, 'n', v_n));
    v_left := v_left - v_n;
  end loop;
  v_trial := least(v_left, (c ->> 'trial')::int);
  if v_trial > 0 then update fiila.partner_trials set studio_used = studio_used + v_trial where shop_id = p_shop; end if;
  v_left := v_left - v_trial;
  if v_left > 0 then update fiila.studio_wallets set credits = credits - v_left, updated_at = now() where shop_id = p_shop; end if;
  return jsonb_build_object('lots', v_lots, 'trial', v_trial, 'wallet', v_left);
end $$;

-- Bonus de bienvenue : accordé une seule fois par compte propriétaire, si activé et si la boutique est prête. Rend le
-- bonus accordé à cet appel (sinon null).
create or replace function fiila.studio_welcome_check(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; v_n int := coalesce(fiila.setting_int('studio_welcome_credits'), 10);
  v_exp timestamptz := now() + make_interval(days => coalesce(fiila.setting_int('studio_welcome_days'), 30)); v_lot uuid;
begin
  if coalesce(fiila.setting_int('studio_welcome'), 0) <> 1 or not fiila.studio_ready() then return null; end if;
  select * into s from fiila.shops where id = p_shop;
  if s.id is null or s.user_id is null or s.demo or s.platform or not s.public or fiila.studio_service(s.business_type) then return null; end if;
  if not exists (select 1 from fiila.products p where p.shop_id = s.id and p.active and (p.photo is not null or p.photo_path is not null)) then return null; end if;
  insert into fiila.studio_welcome (user_id, shop_id, status) values (s.user_id, s.id, 'granted') on conflict (user_id) do nothing;
  if not found then return null; end if;
  insert into fiila.studio_credit_lots (shop_id, source, credits, remaining, expires_at, ref, note)
    values (s.id, 'welcome', v_n, v_n, v_exp, 'welcome:' || s.user_id, 'Bonus de bienvenue') returning id into v_lot;
  update fiila.studio_welcome set lot_id = v_lot where user_id = s.user_id;
  return jsonb_build_object('credits', v_n, 'expires_at', v_exp);
end $$;
revoke all on function fiila.studio_credits(uuid), fiila.studio_lots_sum(jsonb), fiila.studio_take(uuid, integer), fiila.studio_welcome_check(uuid) from public;

-- Rend les crédits d'une série (une seule fois) : chaque lot, l'essai et le portefeuille récupèrent leur part.
create or replace function fiila.studio_refund(p_job uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j fiila.studio_jobs;
begin
  select * into j from fiila.studio_jobs where id = p_job for update;
  if j.id is null or j.charge not in ('held', 'charged') or j.credits_held = 0 then
    if j.id is not null and j.charge in ('held', 'charged') then
      update fiila.studio_jobs set charge = 'refunded', refund_reason = p_reason, refunded_at = now() where id = j.id;
    end if;
    return false;
  end if;
  -- Lots (bienvenue, Business, achats) : chaque part revient à son lot.
  update fiila.studio_credit_lots l set remaining = least(l.credits, l.remaining + (x ->> 'n')::int)
    from jsonb_array_elements(coalesce(j.credits_lots, '[]'::jsonb)) x where l.id = (x ->> 'lot')::uuid;
  if j.credits_trial > 0 then
    update fiila.partner_trials set studio_used = greatest(0, studio_used - j.credits_trial) where shop_id = j.shop_id;
  end if;
  if j.credits_held - j.credits_trial - fiila.studio_lots_sum(j.credits_lots) > 0 then
    insert into fiila.studio_wallets (shop_id, credits) values (j.shop_id, j.credits_held - j.credits_trial - fiila.studio_lots_sum(j.credits_lots))
      on conflict (shop_id) do update set credits = fiila.studio_wallets.credits + excluded.credits, updated_at = now();
  end if;
  update fiila.studio_jobs set charge = 'refunded', refund_reason = p_reason, refunded_at = now() where id = j.id;
  return true;
end $$;

CREATE OR REPLACE FUNCTION public.fiila_studio_reserve(p_key text, p_product text, p_style text, p_mode text DEFAULT 'fidele'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); pr fiila.products; j fiila.studio_jobs; sc fiila.studio_scenes;
  v_mode text := coalesce(p_mode, 'fidele'); v_prompt text; v_engine text; v_need int; v_trial int; v_est numeric; c jsonb; v_take jsonb;
begin
  perform fiila.rate_check('studio_reserve', 30);
  if not fiila.studio_ready() or fiila.studio_service(s.business_type) then perform fiila.fail('studio_off'); end if;
  if v_mode not in ('fidele', 'premium') then perform fiila.fail('invalid_payload'); end if;
  if v_mode = 'premium' and not fiila.studio_premium_ok(s.business_type) then perform fiila.fail('studio_premium_off'); end if;
  select * into pr from fiila.products where id = v_pid and shop_id = s.id;
  if pr.id is null then perform fiila.fail('product_not_found'); end if;
  if pr.photo is null and pr.photo_path is null then perform fiila.fail('studio_no_photo'); end if;
  if p_style is null or not exists (select 1 from jsonb_array_elements(fiila.studio_scenes_for(s.id)) e where e ->> 'id' = p_style) then
    perform fiila.fail('invalid_payload');
  end if;
  select * into sc from fiila.studio_scenes where id = p_style;
  -- Verrous : crédits de la boutique (deux téléphones, deux onglets), puis séries bloquées rendues.
  perform 1 from fiila.studio_wallets where shop_id = s.id for update;
  perform 1 from fiila.partner_trials where shop_id = s.id for update;
  perform 1 from fiila.studio_credit_lots where shop_id = s.id for update;
  perform fiila.studio_sweep(s.id);
  perform fiila.studio_welcome_check(s.id);
  if exists (select 1 from fiila.studio_jobs where shop_id = s.id and status = 'running') then perform fiila.fail('studio_busy'); end if;
  v_need := fiila.studio_cost(v_mode);
  c := fiila.studio_credits(s.id);
  if (c ->> 'total')::int < v_need then perform fiila.fail('studio_no_credits'); end if;
  if (select count(*) from fiila.studio_jobs where shop_id = s.id and created_at > now() - interval '1 day') >= coalesce(fiila.setting_int('studio_daily'), 10) then
    perform fiila.fail('studio_daily_limit');
  end if;
  -- Moteur (comparatif du 28/10) ; FIBO avec masque protège déjà le produit : pas de consigne « garder le produit ».
  v_engine := fiila.studio_engine(v_mode, s.business_type);
  v_est := fiila.studio_engine_usd(v_engine);
  -- Budget du mois, toutes boutiques : un seul contrôle à la fois, séries en cours comprises (coût réservé).
  perform pg_advisory_xact_lock(hashtext('fiila.studio_budget'));
  if fiila.studio_spent() + v_est > coalesce(fiila.setting_int('studio_budget_usd'), 0) then perform fiila.fail('studio_budget'); end if;
  v_prompt := fiila.studio_text('studio_tpl_camera')
    || case when v_mode = 'premium' and v_engine <> 'fibo_mask' then case when coalesce(s.business_type, '') in ('mode', 'couture') then fiila.studio_text('studio_tpl_wear') else fiila.studio_text('studio_tpl_keep') end else '' end
    || sc.prompt;
  -- Crédits retenus tout de suite (débités à la réussite, rendus sur échec) : lots qui expirent le plus tôt, puis essai
  -- partenaire, puis portefeuille.
  v_take := fiila.studio_take(s.id, v_need);
  v_trial := (v_take ->> 'trial')::int;
  insert into fiila.studio_jobs (shop_id, product_id, style, mode, scene_version, created_by, engine, credits_held, credits_trial, credits_lots, charge, cost_reserved, credit_from)
  values (s.id, pr.id, sc.id, v_mode, sc.version, fiila.uid(), v_engine, v_need, v_trial, v_take -> 'lots', 'held', v_est,
          case when jsonb_array_length(v_take -> 'lots') > 0 then 'lot' when v_trial > 0 then 'trial' else 'wallet' end)
  returning * into j;
  return jsonb_build_object('job', j.id, 'style', j.style, 'mode', j.mode, 'engine', j.engine, 'prompt', v_prompt, 'name', pr.name,
    'credits', fiila.studio_credits(s.id),
    'image', case when pr.photo is not null then 'data:' || coalesce(pr.photo_type, 'image/jpeg') || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '')
                   else (select value from fiila.settings where key = 'media_base') || pr.photo_path end);
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_studio_state(p_key text, p_product text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); v_welcome jsonb;
begin
  if v_pid is null or not exists (select 1 from fiila.products where id = v_pid and shop_id = s.id) then perform fiila.fail('product_not_found'); end if;
  perform fiila.studio_sweep(s.id);
  -- Bonus de bienvenue accordé maintenant (une seule fois par compte propriétaire) : l'application l'annonce une fois.
  v_welcome := fiila.studio_welcome_check(s.id);
  return jsonb_build_object('welcome', v_welcome,'ready', fiila.studio_ready() and not fiila.studio_service(s.business_type), 'credits', fiila.studio_credits(s.id),
    'scenes', fiila.studio_scenes_for(s.id),
    'premium', case when fiila.studio_premium_ok(s.business_type) then jsonb_build_object('credits', fiila.studio_cost('premium'),
      'wear', coalesce(s.business_type, '') in ('mode', 'couture')) end,
    -- Dernières séries payées et pas encore gardées (création interrompue, réseau coupé) : la boutique peut les reprendre.
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'style', j.style, 'mode', j.mode, 'status', j.status, 'results', j.results, 'kept', j.kept,
        'charge', j.charge, 'credits', j.credits_held, 'durable', j.result_path is not null, 'created_at', j.created_at) order by j.created_at desc)
      from (select * from fiila.studio_jobs where product_id = v_pid and status in ('done', 'kept') and created_at > now() - interval '2 days' order by created_at desc limit 3) j), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_bo_studio()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform fiila.need_staff('shops');
  perform fiila.studio_sweep(null);
  return jsonb_build_object(
    'ready', fiila.studio_ready(), 'fibo', coalesce(fiila.setting_int('studio_fibo'), 1) = 1, 'budget_usd', coalesce(fiila.setting_int('studio_budget_usd'), 0), 'spent_usd', fiila.studio_spent(),
    'reserved_usd', (select coalesce(sum(cost_reserved), 0) from fiila.studio_jobs where status = 'running'),
    'month', jsonb_build_object('series', (select count(*) from fiila.studio_jobs where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'kept', (select count(*) from fiila.studio_jobs where status = 'kept' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'failed', (select count(*) from fiila.studio_jobs where status = 'failed' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'shops', (select count(distinct shop_id) from fiila.studio_jobs where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'charged_credits', (select coalesce(sum(credits_held), 0) from fiila.studio_jobs where charge = 'charged' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'refunded_credits', (select coalesce(sum(credits_held), 0) from fiila.studio_jobs where charge = 'refunded' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar')),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'shop', s.name, 'shop_id', s.id, 'product', p.name, 'style', j.style, 'mode', j.mode, 'engine', j.engine, 'status', j.status,
        'kept', j.kept, 'cost_usd', j.cost_usd, 'error', j.error, 'created_at', j.created_at,
        'credits', j.credits_held, 'charge', j.charge, 'refund_reason', j.refund_reason, 'credit_from', j.credit_from) order by j.created_at desc)
      from (select * from fiila.studio_jobs order by created_at desc limit 100) j join fiila.shops s on s.id = j.shop_id join fiila.products p on p.id = j.product_id), '[]'::jsonb),
    'welcome', jsonb_build_object('on', coalesce(fiila.setting_int('studio_welcome'), 0) = 1, 'credits', coalesce(fiila.setting_int('studio_welcome_credits'), 10),
      'days', coalesce(fiila.setting_int('studio_welcome_days'), 30),
      'granted', (select count(*) from fiila.studio_welcome where status = 'granted'),
      'reconciled', (select count(*) from fiila.studio_welcome where status = 'reconciled'),
      'used', (select coalesce(sum(credits - remaining), 0) from fiila.studio_credit_lots where source = 'welcome'),
      'expired', (select coalesce(sum(remaining), 0) from fiila.studio_credit_lots where source = 'welcome' and expires_at <= now())),
    'wallets', coalesce((select jsonb_agg(jsonb_build_object('shop_id', s.id, 'shop', s.name, 'credits', coalesce(w.credits, 0), 'updated_at', x.at,
        'trial', (fiila.studio_credits(s.id) ->> 'trial')::int,
        'reserved', (select coalesce(sum(r.credits_held), 0) from fiila.studio_jobs r where r.shop_id = s.id and r.status = 'running'),
        'lots', (select coalesce(jsonb_agg(jsonb_build_object('source', l.source, 'credits', l.credits, 'remaining', l.remaining, 'expires_at', l.expires_at,
                   'expired', l.expires_at is not null and l.expires_at <= now()) order by l.created_at), '[]'::jsonb)
                   from fiila.studio_credit_lots l where l.shop_id = s.id)) order by x.at desc)
      from fiila.shops s left join fiila.studio_wallets w on w.shop_id = s.id
      cross join lateral (select greatest(w.updated_at, (select max(l.created_at) from fiila.studio_credit_lots l where l.shop_id = s.id)) at) x
     where coalesce(w.credits, 0) > 0 or w.updated_at > now() - interval '30 days' or exists (select 1 from fiila.studio_credit_lots l where l.shop_id = s.id)), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION fiila.bo_setting_bounds(p_key text)
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1]
    when 'amb_manager_llm' then array[0, 1]
    when 'nudges' then array[0, 1]
    when 'amb_whatsapp' then array[0, 1]
    when 'onboarding_v2' then array[0, 1]
    when 'discover_after' then array[0, 1]
    when 'wa_card_media' then array[0, 1]
    when 'media_cdn' then array[0, 1]
    when 'sugg_home_shop' then array[0, 1] when 'sugg_shop_more_products' then array[0, 1] when 'sugg_shop_share_vitrine' then array[0, 1]
    when 'sugg_shop_courier' then array[0, 1] when 'sugg_shop_photos' then array[0, 1] when 'sugg_shop_team' then array[0, 1]
    when 'adaptive_home' then array[0, 1]
    when 'sugg_addr_photo' then array[0, 1] when 'sugg_addr_mark' then array[0, 1]
    when 'custom_domains' then array[0, 1] when 'shop_subdomains' then array[0, 1]
    when 'studio_ready' then array[0, 1] when 'studio_budget_usd' then array[0, 2000] when 'studio_daily' then array[1, 100]
    when 'studio_premium' then array[0, 1] when 'kyc_required' then array[0, 1] when 'site_look' then array[0, 6] when 'studio_premium_credits' then array[1, 10] when 'studio_fibo' then array[0, 1]
    when 'studio_welcome' then array[0, 1] when 'studio_welcome_credits' then array[1, 50] when 'studio_welcome_days' then array[7, 90] end
$function$;

CREATE OR REPLACE FUNCTION public.fiila_bo_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := fiila.need_staff('settings');
begin
  return coalesce((select jsonb_object_agg(k, fiila.setting_int(k))
    from unnest(array['vd_commission', 'amb_reward_1', 'amb_reward_2', 'amb_reward_3', 'amb_monthly_cap', 'sms_verify', 'amb_manager_llm', 'nudges', 'amb_whatsapp', 'onboarding_v2', 'discover_after', 'wa_card_media', 'media_cdn', 'sugg_home_shop', 'sugg_shop_more_products', 'sugg_shop_share_vitrine', 'sugg_shop_courier', 'sugg_shop_photos', 'sugg_shop_team', 'adaptive_home', 'sugg_addr_photo', 'sugg_addr_mark', 'custom_domains', 'shop_subdomains', 'studio_ready', 'studio_budget_usd', 'studio_daily', 'studio_premium', 'studio_premium_credits', 'studio_fibo', 'studio_welcome', 'studio_welcome_credits', 'studio_welcome_days', 'kyc_required', 'site_look']) k), '{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_studio_state_shop(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_welcome jsonb := fiila.studio_welcome_check(s.id);
begin
  return jsonb_build_object('welcome', v_welcome, 'ready', fiila.studio_ready() and not fiila.studio_service(s.business_type), 'credits', fiila.studio_credits(s.id),
    'premium', fiila.studio_premium_ok(s.business_type),
    'photos', (select count(*) from fiila.products p where p.shop_id = s.id and (p.photo is not null or p.photo_path is not null)),
    'kept', (select count(*) from fiila.studio_jobs j where j.shop_id = s.id and j.status = 'kept'));
end $function$;

revoke all on function fiila.studio_refund(uuid, text) from public;

-- Lot Business (fin de période obligatoire) ou achat (sans expiration), clé de service ; idempotent sur la référence.
create or replace function public.fiila_studio_lot_add(p_shop uuid, p_source text, p_credits int, p_expires timestamptz, p_ref text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ref text := p_source || ':' || nullif(trim(coalesce(p_ref, '')), ''); v_id uuid; v_shop uuid;
begin
  if coalesce(p_source, '') not in ('business', 'purchase') or v_ref is null or coalesce(p_credits, 0) not between 1 and 10000
     or (p_source = 'business' and (p_expires is null or p_expires <= now())) or (p_source = 'purchase' and p_expires is not null) then
    perform fiila.fail('invalid_payload');
  end if;
  if not exists (select 1 from fiila.shops where id = p_shop) then perform fiila.fail('not_found'); end if;
  insert into fiila.studio_credit_lots (shop_id, source, credits, remaining, expires_at, ref, note)
    values (p_shop, p_source, p_credits, p_credits, p_expires, v_ref, fiila.clean(p_note, 200))
    on conflict (ref) do nothing returning id into v_id;
  if v_id is not null then return jsonb_build_object('lot', v_id, 'created', true); end if;
  select id, shop_id into v_id, v_shop from fiila.studio_credit_lots where ref = v_ref;
  if v_shop <> p_shop then perform fiila.fail('invalid_payload'); end if;
  return jsonb_build_object('lot', v_id, 'created', false);
end $$;

-- Droits : inchangés pour la réservation, l'état et le back-office ; ajout de lots réservé à la clé de service.
do $$
declare r text; fn text;
begin
  foreach fn in array array['public.fiila_studio_reserve(text, text, text, text)', 'public.fiila_studio_state(text, text)', 'public.fiila_studio_state_shop(text)',
      'public.fiila_bo_studio()', 'public.fiila_bo_settings()', 'public.fiila_studio_lot_add(uuid, text, integer, timestamp with time zone, text, text)'] loop
    execute format('revoke execute on function %s from public', fn);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke execute on function %s from %I', fn, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
    if fn !~ 'lot_add' and exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', fn); end if;
    if fn ~ '(reserve|state|state_shop)\(' and exists (select 1 from pg_roles where rolname = 'anon') then execute format('grant execute on function %s to anon', fn); end if;
  end loop;
end $$;
