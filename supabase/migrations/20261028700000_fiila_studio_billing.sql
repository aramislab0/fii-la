-- Fii Studio fiable avant vente (offre commerciale validée le 28/10, OFFRE-COMMERCIALE-001 §3 et §6.2 ; revue VP #82 R1 ;
-- fondateur : « Oui, dans cet ordre », « go »). Nouvelle règle : les crédits sont débités par génération techniquement
-- réussie et récupérable (Fidèle 1, Premium 3), même si la boutique ne garde pas la version ; « Autre proposition »
-- consomme à nouveau ; une panne n'est pas facturée ; un résultat perdu est recrédité une seule fois ; « garder » ne débite
-- plus rien et peut être répété.
-- Fonctionnement :
--   * réservation (fiila_studio_reserve) : portefeuille et essai de la boutique verrouillés (deux téléphones), crédits
--     retenus tout de suite (essai d'abord, puis portefeuille) ; budget du mois verrouillé pour toutes les boutiques
--     (verrou consultatif), coût estimé du moteur réservé (le budget compte les séries en cours) ;
--   * fin de série (fiila_studio_complete, clé de service) : réussite seulement si l'image est copiée dans le seau privé
--     « studio » (adresse s/<série>.<ext>) → crédits débités ; sinon série en échec et crédits rendus ; une fin tardive
--     après le délai (3 minutes, crédits déjà rendus) est ignorée ;
--   * résultat introuvable au moment de le reprendre (fiila_studio_lost, clé de service) : crédits rendus une seule fois ;
--   * copies du seau « studio » effacées après 7 jours par fiila-media-sync (fiila_studio_purgeable / _forget).
-- Séries d'avant cette règle (charge = 'legacy') : « garder » les débite comme avant.
-- Back-office : crédits et état de facturation de chaque série, budget réservé par les séries en cours.

alter table fiila.studio_jobs add column if not exists credits_held int not null default 0;
alter table fiila.studio_jobs add column if not exists credits_trial int not null default 0;
alter table fiila.studio_jobs add column if not exists charge text;
alter table fiila.studio_jobs add column if not exists cost_reserved numeric(8, 4) not null default 0;
alter table fiila.studio_jobs add column if not exists result_path text;
alter table fiila.studio_jobs add column if not exists refund_reason text;
alter table fiila.studio_jobs add column if not exists refunded_at timestamptz;
update fiila.studio_jobs set charge = 'legacy' where charge is null;
alter table fiila.studio_jobs alter column charge set default 'held';
alter table fiila.studio_jobs alter column charge set not null;
alter table fiila.studio_jobs drop constraint if exists studio_jobs_charge_check;
alter table fiila.studio_jobs add constraint studio_jobs_charge_check check (charge in ('held', 'charged', 'refunded', 'legacy'));
alter table fiila.studio_jobs drop constraint if exists studio_jobs_credits_check;
alter table fiila.studio_jobs add constraint studio_jobs_credits_check check (credits_held >= 0 and credits_trial >= 0 and credits_trial <= credits_held);
alter table fiila.studio_jobs drop constraint if exists studio_jobs_result_path_check;
alter table fiila.studio_jobs add constraint studio_jobs_result_path_check check (result_path is null or result_path ~ '^s/[0-9a-f-]{36}\.(jpg|png|webp)$');
create index if not exists studio_jobs_running on fiila.studio_jobs (created_at) where status = 'running';
create index if not exists studio_jobs_result_path on fiila.studio_jobs (created_at) where result_path is not null;

-- Coût fournisseur estimé d'un moteur (USD), réservé sur le budget du mois pendant la série.
create or replace function fiila.studio_engine_usd(p_engine text) returns numeric
language sql immutable set search_path = '' as $$
  select case p_engine when 'fibo_mask' then 0.058 when 'nano' then 0.15 else 0.04 end::numeric
$$;

-- Dépense du mois : coût réel des séries finies + coût réservé des séries en cours.
create or replace function fiila.studio_spent() returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(case when status = 'running' then cost_reserved else cost_usd end), 0) from fiila.studio_jobs
   where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'
$$;

-- Rend les crédits d'une série (une seule fois) : part de l'essai d'abord retenue, puis portefeuille.
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
  if j.credits_trial > 0 then
    update fiila.partner_trials set studio_used = greatest(0, studio_used - j.credits_trial) where shop_id = j.shop_id;
  end if;
  if j.credits_held - j.credits_trial > 0 then
    insert into fiila.studio_wallets (shop_id, credits) values (j.shop_id, j.credits_held - j.credits_trial)
      on conflict (shop_id) do update set credits = fiila.studio_wallets.credits + excluded.credits, updated_at = now();
  end if;
  update fiila.studio_jobs set charge = 'refunded', refund_reason = p_reason, refunded_at = now() where id = j.id;
  return true;
end $$;

-- Séries bloquées plus de 3 minutes : en échec, crédits rendus (une boutique, ou toutes si p_shop est nul).
create or replace function fiila.studio_sweep(p_shop uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in select id from fiila.studio_jobs where status = 'running' and created_at < now() - interval '3 minutes'
             and (p_shop is null or shop_id = p_shop) for update skip locked loop
    -- Coût estimé gardé (le fournisseur a pu facturer l'appel) ; remplacé par le coût réel si la fin arrive plus tard.
    update fiila.studio_jobs set status = 'failed', error = 'Délai dépassé', done_at = now(), cost_usd = cost_reserved where id = r.id;
    perform fiila.studio_refund(r.id, 'timeout');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function fiila.studio_engine_usd(text), fiila.studio_refund(uuid, text), fiila.studio_sweep(uuid) from public;

CREATE OR REPLACE FUNCTION public.fiila_studio_reserve(p_key text, p_product text, p_style text, p_mode text DEFAULT 'fidele'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); pr fiila.products; j fiila.studio_jobs; sc fiila.studio_scenes;
  v_mode text := coalesce(p_mode, 'fidele'); v_prompt text; v_engine text; v_need int; v_trial int; v_est numeric; c jsonb;
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
  perform fiila.studio_sweep(s.id);
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
  -- Crédits retenus tout de suite : essai d'abord, puis portefeuille (débités à la réussite, rendus sur échec).
  v_trial := least(v_need, (c ->> 'trial')::int);
  if v_trial > 0 then update fiila.partner_trials set studio_used = studio_used + v_trial where shop_id = s.id; end if;
  if v_need - v_trial > 0 then
    update fiila.studio_wallets set credits = credits - (v_need - v_trial), updated_at = now() where shop_id = s.id;
  end if;
  insert into fiila.studio_jobs (shop_id, product_id, style, mode, scene_version, created_by, engine, credits_held, credits_trial, charge, cost_reserved, credit_from)
  values (s.id, pr.id, sc.id, v_mode, sc.version, fiila.uid(), v_engine, v_need, v_trial, 'held', v_est, case when v_trial > 0 then 'trial' else 'wallet' end)
  returning * into j;
  return jsonb_build_object('job', j.id, 'style', j.style, 'mode', j.mode, 'engine', j.engine, 'prompt', v_prompt, 'name', pr.name,
    'credits', fiila.studio_credits(s.id),
    'image', case when pr.photo is not null then 'data:' || coalesce(pr.photo_type, 'image/jpeg') || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '')
                   else (select value from fiila.settings where key = 'media_base') || pr.photo_path end);
end $function$;

-- Fin de série (clé de service) : réussite = image copiée dans le seau privé (p.path) ; sinon échec et crédits rendus.
-- Idempotente : une série déjà finie (ou rendue après le délai) n'est pas modifiée.
CREATE OR REPLACE FUNCTION public.fiila_studio_complete(p_job uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j fiila.studio_jobs; v_results jsonb; v_path text := nullif(p ->> 'path', ''); v_ok boolean;
begin
  select * into j from fiila.studio_jobs where id = p_job for update;
  if j.id is null then perform fiila.fail('not_found'); end if;
  if j.status <> 'running' then
    -- Fin tardive d'une série rendue après le délai : ni débit ni livraison, mais le coût réel du fournisseur est gardé.
    if j.status = 'failed' and p ? 'cost_usd' then
      update fiila.studio_jobs set cost_usd = least(greatest(coalesce((p ->> 'cost_usd')::numeric, 0), 0), 5) where id = j.id returning * into j;
    end if;
    return jsonb_build_object('id', j.id, 'status', j.status, 'results', j.results, 'error', j.error, 'charge', j.charge, 'credits', fiila.studio_credits(j.shop_id));
  end if;
  v_results := case when jsonb_typeof(p -> 'results') = 'array' then (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements_text(p -> 'results') x
      where x ~ '^https://[a-z0-9.-]+\.fal\.(media|ai|run)/' limit 3) y) else '[]'::jsonb end;
  v_ok := jsonb_array_length(v_results) > 0 and v_path is not null and v_path ~ ('^s/' || j.id::text || '\.(jpg|png|webp)$');
  update fiila.studio_jobs set
    status = case when v_ok then 'done' else 'failed' end,
    results = v_results, result_path = case when v_ok then v_path end,
    charge = case when v_ok then 'charged' else charge end,
    cost_usd = least(greatest(coalesce((p ->> 'cost_usd')::numeric, 0), 0), 5),
    error = case when v_ok then null else coalesce(nullif(left(coalesce(p ->> 'error', ''), 300), ''), case when jsonb_array_length(v_results) > 0 then 'provider_store' else 'Aucune image' end) end,
    done_at = now()
   where id = p_job returning * into j;
  if not v_ok then perform fiila.studio_refund(j.id, 'failed'); select * into j from fiila.studio_jobs where id = p_job; end if;
  return jsonb_build_object('id', j.id, 'status', j.status, 'results', j.results, 'error', j.error, 'charge', j.charge, 'credits', fiila.studio_credits(j.shop_id));
end $function$;

-- Garder : plus aucun débit (la génération est déjà payée) ; répétable sans effet. Séries d'avant la règle : débit comme avant.
CREATE OR REPLACE FUNCTION public.fiila_studio_keep(p_key text, p_job uuid, p_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); j fiila.studio_jobs; c jsonb; v_need int; v_trial int;
begin
  select * into j from fiila.studio_jobs where id = p_job and shop_id = s.id for update;
  if j.id is null then perform fiila.fail('not_found'); end if;
  if j.status = 'kept' then return jsonb_build_object('id', j.id, 'status', j.status, 'kept', j.kept, 'url', j.results ->> j.kept, 'credits', fiila.studio_credits(s.id)); end if;
  if j.status <> 'done' or p_index is null or p_index < 0 or p_index >= jsonb_array_length(j.results) then perform fiila.fail('invalid_state'); end if;
  if j.charge = 'legacy' then
    perform 1 from fiila.studio_wallets where shop_id = s.id for update;
    perform 1 from fiila.partner_trials where shop_id = s.id for update;
    v_need := fiila.studio_cost(j.mode);
    c := fiila.studio_credits(s.id);
    if (c ->> 'total')::int < v_need then perform fiila.fail('studio_no_credits'); end if;
    v_trial := least(v_need, (c ->> 'trial')::int);
    if v_trial > 0 then update fiila.partner_trials set studio_used = studio_used + v_trial where shop_id = s.id; end if;
    if v_need - v_trial > 0 then update fiila.studio_wallets set credits = credits - (v_need - v_trial), updated_at = now() where shop_id = s.id; end if;
    update fiila.studio_jobs set credit_from = case when v_trial > 0 then 'trial' else 'wallet' end where id = j.id;
  end if;
  update fiila.studio_jobs set status = 'kept', kept = p_index where id = j.id returning * into j;
  return jsonb_build_object('id', j.id, 'status', j.status, 'kept', j.kept, 'url', j.results ->> j.kept, 'credits', fiila.studio_credits(s.id));
end $function$;

-- Image d'une série (boutique) : adresse fal et copie durable du seau privé.
CREATE OR REPLACE FUNCTION public.fiila_studio_result(p_key text, p_job uuid, p_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); j fiila.studio_jobs;
begin
  select * into j from fiila.studio_jobs where id = p_job and shop_id = s.id;
  if j.id is null or j.status not in ('done', 'kept') or p_index is null or p_index < 0 or p_index >= jsonb_array_length(j.results) then perform fiila.fail('not_found'); end if;
  return jsonb_strip_nulls(jsonb_build_object('url', j.results ->> p_index, 'path', case when p_index = 0 then j.result_path end, 'job', j.id));
end $function$;

-- Résultat introuvable (clé de service, appelée par fiila-studio) : crédits rendus une seule fois.
create or replace function public.fiila_studio_lost(p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j fiila.studio_jobs; v_done boolean := false;
begin
  select * into j from fiila.studio_jobs where id = p_job for update;
  if j.id is null then perform fiila.fail('not_found'); end if;
  if j.status in ('done', 'kept') and j.charge = 'charged' then
    v_done := fiila.studio_refund(j.id, 'result_lost');
    update fiila.studio_jobs set result_path = null where id = j.id;
  end if;
  return jsonb_build_object('refunded', v_done, 'credits', fiila.studio_credits(j.shop_id));
end $$;

-- Copies du seau « studio » à effacer (plus de 7 jours) et oubli de leur adresse (clé de service, fiila-media-sync).
create or replace function public.fiila_studio_purgeable(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.result_path), '[]'::jsonb) from (
    select result_path from fiila.studio_jobs where result_path is not null and created_at < now() - interval '7 days'
     order by created_at limit least(greatest(coalesce(p_limit, 50), 1), 100)) x
$$;
create or replace function public.fiila_studio_forget(p_paths jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update fiila.studio_jobs set result_path = null
   where result_path = any (array(select jsonb_array_elements_text(coalesce(p_paths, '[]'::jsonb)))) and created_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'forgotten', v_n);
end $$;

CREATE OR REPLACE FUNCTION public.fiila_studio_state(p_key text, p_product text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product);
begin
  if v_pid is null or not exists (select 1 from fiila.products where id = v_pid and shop_id = s.id) then perform fiila.fail('product_not_found'); end if;
  perform fiila.studio_sweep(s.id);
  return jsonb_build_object('ready', fiila.studio_ready() and not fiila.studio_service(s.business_type), 'credits', fiila.studio_credits(s.id),
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
    'wallets', coalesce((select jsonb_agg(jsonb_build_object('shop_id', s.id, 'shop', s.name, 'credits', w.credits, 'updated_at', w.updated_at,
        'trial', (fiila.studio_credits(s.id) ->> 'trial')::int,
        'reserved', (select coalesce(sum(x.credits_held), 0) from fiila.studio_jobs x where x.shop_id = s.id and x.status = 'running')) order by w.updated_at desc)
      from fiila.studio_wallets w join fiila.shops s on s.id = w.shop_id where w.credits > 0 or w.updated_at > now() - interval '30 days'), '[]'::jsonb));
end $function$;

-- Seau privé des résultats du Studio (infrastructure Supabase, absente des tests locaux) : lu et écrit par la clé de service.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('studio', 'studio', false, 12000000, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
end $$;

-- Droits : réservation, état, garder, résultat pour les boutiques (anon et comptes) comme avant ; fin, perte et purge
-- réservées à la clé de service ; back-office aux comptes (droit vérifié dans la fonction).
do $$
declare r text; fn text;
begin
  foreach fn in array array['public.fiila_studio_reserve(text, text, text, text)', 'public.fiila_studio_state(text, text)',
      'public.fiila_studio_keep(text, uuid, integer)', 'public.fiila_studio_result(text, uuid, integer)',
      'public.fiila_studio_complete(uuid, jsonb)', 'public.fiila_studio_lost(uuid)', 'public.fiila_studio_purgeable(integer)',
      'public.fiila_studio_forget(jsonb)', 'public.fiila_bo_studio()'] loop
    execute format('revoke execute on function %s from public', fn);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke execute on function %s from %I', fn, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
    if fn ~ '(reserve|state|keep|result)\(' then
      foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then execute format('grant execute on function %s to %I', fn, r); end if;
      end loop;
    elsif fn like '%bo_studio%' and exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', fn);
    end if;
  end loop;
end $$;
