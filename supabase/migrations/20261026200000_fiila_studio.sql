-- Fii Studio, niveau 1 (fondateur, 26/10/2026 19:29 : « passons à Fii Studio » ; proposition validée le 19/10,
-- docs/PROPOSITION-SITES-STUDIO-ASSISTANT.md §3, docs/PLAN-FII-STUDIO.md).
-- Une photo d'article prise au téléphone devient 3 versions « pro » (décor, lumière, ombre) ; le produit n'est jamais
-- redessiné (fournisseur : fal.ai, modèle Bria Product Shot, qui garde les pixels du produit). La boutique choisit une
-- version : elle devient la photo principale, l'originale reste la photo suivante.
-- Crédits : 1 crédit par version gardée (une série non gardée n'est pas facturée à la boutique). Crédits d'essai d'un
-- partenaire (pack Ambassadeur, studio_credits) d'abord, puis crédits de la boutique (accordés au back-office ; achat de
-- packs sur le web plus tard). Garde-fous de coût : interrupteur studio_ready, budget mensuel en USD (studio_budget_usd),
-- 10 séries par boutique et par jour, 1 série à la fois.
-- Les échanges avec fal passent par la fonction serveur fiila-studio (clé FAL_KEY, saisie par le fondateur) ;
-- fiila_studio_complete n'est ouverte qu'à la clé de service.

create table fiila.studio_wallets (
  shop_id     uuid primary key references fiila.shops (id) on delete cascade,
  credits     int not null default 0 check (credits >= 0),
  updated_at  timestamptz not null default now()
);
revoke all on fiila.studio_wallets from public;

create table fiila.studio_jobs (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references fiila.shops (id) on delete cascade,
  product_id  uuid not null references fiila.products (id) on delete cascade,
  style       text not null check (style in ('blanc', 'minimal', 'luxe', 'soleil', 'fete')),
  status      text not null default 'running' check (status in ('running', 'done', 'failed', 'kept')),
  results     jsonb not null default '[]'::jsonb,       -- adresses des images renvoyées par fal (temporaires)
  kept        int,                                      -- version gardée (0, 1 ou 2)
  credit_from text check (credit_from in ('trial', 'wallet')),
  cost_usd    numeric(8, 4) not null default 0,
  error       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index studio_jobs_shop on fiila.studio_jobs (shop_id, created_at desc);
create index studio_jobs_month on fiila.studio_jobs (created_at);
revoke all on fiila.studio_jobs from public;

insert into fiila.settings (key, value) values ('studio_budget_usd', '50') on conflict (key) do nothing;
insert into fiila.settings (key, value) values ('studio_daily', '10') on conflict (key) do nothing;

-- Dépense du mois en cours (heure de Dakar), en USD.
create or replace function fiila.studio_spent() returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(cost_usd), 0) from fiila.studio_jobs
   where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'
$$;

-- Crédits disponibles : essai partenaire actif (quota du pack moins l'utilisé) + crédits de la boutique.
create or replace function fiila.studio_credits(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t fiila.partner_trials := fiila.trial_refresh(p_shop); v_trial int := 0; v_wallet int;
begin
  if t.id is not null and t.status = 'active' then
    select greatest(0, coalesce((p.limits ->> 'studio_credits')::int, 0) - t.studio_used) into v_trial
      from fiila.partner_packs p where p.code = t.pack_code and p.version = t.pack_version;
  end if;
  select credits into v_wallet from fiila.studio_wallets where shop_id = p_shop;
  return jsonb_build_object('trial', coalesce(v_trial, 0), 'wallet', coalesce(v_wallet, 0), 'total', coalesce(v_trial, 0) + coalesce(v_wallet, 0));
end $$;

create or replace function fiila.studio_ready() returns boolean
language sql stable set search_path = '' as $$ select coalesce(fiila.setting_int('studio_ready'), 0) = 1 $$;

-- État pour l'écran d'un article : Studio ouvert ou non, crédits, dernières séries de cet article.
create or replace function public.fiila_studio_state(p_key text, p_product text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product);
begin
  if v_pid is null or not exists (select 1 from fiila.products where id = v_pid and shop_id = s.id) then perform fiila.fail('product_not_found'); end if;
  return jsonb_build_object('ready', fiila.studio_ready(), 'credits', fiila.studio_credits(s.id),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'style', j.style, 'status', j.status, 'results', j.results, 'kept', j.kept, 'created_at', j.created_at) order by j.created_at desc)
      from (select * from fiila.studio_jobs where product_id = v_pid and status in ('done', 'kept') and created_at > now() - interval '2 days' order by created_at desc limit 3) j), '[]'::jsonb));
end $$;

-- Pour la fonction fiila-studio (appelée avec l'identité de la personne) : ouvre une série si tout est en règle et renvoie
-- la photo d'origine à envoyer au fournisseur. Rien n'est débité ici.
create or replace function public.fiila_studio_reserve(p_key text, p_product text, p_style text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); pr fiila.products; j fiila.studio_jobs;
begin
  perform fiila.rate_check('studio_reserve', 30);
  if not fiila.studio_ready() then perform fiila.fail('studio_off'); end if;
  select * into pr from fiila.products where id = v_pid and shop_id = s.id;
  if pr.id is null then perform fiila.fail('product_not_found'); end if;
  if pr.photo is null then perform fiila.fail('studio_no_photo'); end if;
  if p_style is null or p_style not in ('blanc', 'minimal', 'luxe', 'soleil', 'fete') then perform fiila.fail('invalid_payload'); end if;
  if (fiila.studio_credits(s.id) ->> 'total')::int < 1 then perform fiila.fail('studio_no_credits'); end if;
  if fiila.studio_spent() >= coalesce(fiila.setting_int('studio_budget_usd'), 0) then perform fiila.fail('studio_budget'); end if;
  if (select count(*) from fiila.studio_jobs where shop_id = s.id and created_at > now() - interval '1 day') >= coalesce(fiila.setting_int('studio_daily'), 10) then
    perform fiila.fail('studio_daily_limit');
  end if;
  -- Une seule série en cours par boutique (une série bloquée plus de 3 minutes est close en échec).
  update fiila.studio_jobs set status = 'failed', error = 'Délai dépassé', done_at = now() where shop_id = s.id and status = 'running' and created_at < now() - interval '3 minutes';
  if exists (select 1 from fiila.studio_jobs where shop_id = s.id and status = 'running') then perform fiila.fail('studio_busy'); end if;
  insert into fiila.studio_jobs (shop_id, product_id, style, created_by) values (s.id, pr.id, p_style, fiila.uid()) returning * into j;
  return jsonb_build_object('job', j.id, 'style', j.style, 'name', pr.name,
    'image', 'data:' || coalesce(pr.photo_type, 'image/jpeg') || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', ''));
end $$;

-- Résultat du fournisseur (clé de service seulement) : adresses des images et coût réel de la série.
create or replace function public.fiila_studio_complete(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j fiila.studio_jobs;
begin
  select * into j from fiila.studio_jobs where id = p_job for update;
  if j.id is null then perform fiila.fail('not_found'); end if;
  if j.status <> 'running' then return jsonb_build_object('id', j.id, 'status', j.status); end if;
  update fiila.studio_jobs set
    status = case when jsonb_typeof(p -> 'results') = 'array' and jsonb_array_length(p -> 'results') > 0 then 'done' else 'failed' end,
    results = case when jsonb_typeof(p -> 'results') = 'array' then (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements_text(p -> 'results') x
      where x ~ '^https://[a-z0-9.-]+\.fal\.(media|ai|run)/' limit 3) y) else '[]'::jsonb end,
    cost_usd = least(greatest(coalesce((p ->> 'cost_usd')::numeric, 0), 0), 5),
    error = nullif(left(coalesce(p ->> 'error', ''), 300), ''), done_at = now()
   where id = p_job returning * into j;
  if j.status = 'done' and jsonb_array_length(j.results) = 0 then update fiila.studio_jobs set status = 'failed', error = coalesce(error, 'Aucune image') where id = p_job returning * into j; end if;
  return jsonb_build_object('id', j.id, 'status', j.status, 'results', j.results, 'error', j.error);
end $$;

-- La boutique garde une version : 1 crédit (essai d'abord). L'image elle-même est enregistrée par l'application comme photo
-- principale de l'article (même contrôle que toute photo), l'originale restant la photo suivante.
create or replace function public.fiila_studio_keep(p_key text, p_job uuid, p_index int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); j fiila.studio_jobs; c jsonb; v_from text;
begin
  select * into j from fiila.studio_jobs where id = p_job and shop_id = s.id for update;
  if j.id is null then perform fiila.fail('not_found'); end if;
  if j.status = 'kept' then return jsonb_build_object('id', j.id, 'status', j.status, 'kept', j.kept, 'url', j.results ->> j.kept, 'credits', fiila.studio_credits(s.id)); end if;
  if j.status <> 'done' or p_index is null or p_index < 0 or p_index >= jsonb_array_length(j.results) then perform fiila.fail('invalid_state'); end if;
  c := fiila.studio_credits(s.id);
  if (c ->> 'trial')::int > 0 then
    update fiila.partner_trials set studio_used = studio_used + 1 where shop_id = s.id; v_from := 'trial';
  elsif (c ->> 'wallet')::int > 0 then
    update fiila.studio_wallets set credits = credits - 1, updated_at = now() where shop_id = s.id; v_from := 'wallet';
  else perform fiila.fail('studio_no_credits');
  end if;
  update fiila.studio_jobs set status = 'kept', kept = p_index, credit_from = v_from where id = j.id returning * into j;
  return jsonb_build_object('id', j.id, 'status', j.status, 'kept', j.kept, 'url', j.results ->> j.kept, 'credits', fiila.studio_credits(s.id));
end $$;

-- Pour la fonction fiila-studio (« take ») : l'adresse d'une version d'une série de la boutique (droit vérifié).
create or replace function public.fiila_studio_result(p_key text, p_job uuid, p_index int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); j fiila.studio_jobs;
begin
  select * into j from fiila.studio_jobs where id = p_job and shop_id = s.id;
  if j.id is null or j.status not in ('done', 'kept') or p_index is null or p_index < 0 or p_index >= jsonb_array_length(j.results) then perform fiila.fail('not_found'); end if;
  return jsonb_build_object('url', j.results ->> p_index);
end $$;

-- ---------------------------------------------------------------- back-office
create or replace function public.fiila_bo_studio() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('shops');
  return jsonb_build_object(
    'ready', fiila.studio_ready(), 'budget_usd', coalesce(fiila.setting_int('studio_budget_usd'), 0), 'spent_usd', fiila.studio_spent(),
    'month', jsonb_build_object('series', (select count(*) from fiila.studio_jobs where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'kept', (select count(*) from fiila.studio_jobs where status = 'kept' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'failed', (select count(*) from fiila.studio_jobs where status = 'failed' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'shops', (select count(distinct shop_id) from fiila.studio_jobs where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar')),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'shop', s.name, 'shop_id', s.id, 'product', p.name, 'style', j.style, 'status', j.status,
        'kept', j.kept, 'cost_usd', j.cost_usd, 'error', j.error, 'created_at', j.created_at) order by j.created_at desc)
      from (select * from fiila.studio_jobs order by created_at desc limit 100) j join fiila.shops s on s.id = j.shop_id join fiila.products p on p.id = j.product_id), '[]'::jsonb),
    'wallets', coalesce((select jsonb_agg(jsonb_build_object('shop_id', s.id, 'shop', s.name, 'credits', w.credits, 'updated_at', w.updated_at) order by w.updated_at desc)
      from fiila.studio_wallets w join fiila.shops s on s.id = w.shop_id where w.credits > 0 or w.updated_at > now() - interval '30 days'), '[]'::jsonb));
end $$;

-- Crédits accordés (ou retirés) par l'équipe, motif obligatoire, au journal.
create or replace function public.fiila_bo_studio_grant(p_shop uuid, p_delta int, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_reason text := nullif(fiila.clean(p_reason, 200), ''); w fiila.studio_wallets;
begin
  perform fiila.need_staff('shops_write');
  if v_reason is null then perform fiila.fail('reason_required'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 500 then perform fiila.fail('invalid_value'); end if;
  if not exists (select 1 from fiila.shops where id = p_shop) then perform fiila.fail('not_found'); end if;
  insert into fiila.studio_wallets (shop_id, credits) values (p_shop, greatest(0, p_delta))
    on conflict (shop_id) do update set credits = greatest(0, fiila.studio_wallets.credits + p_delta), updated_at = now()
    returning * into w;
  perform fiila.bo_log('studio_grant', 'shop', p_shop::text, jsonb_build_object('delta', p_delta, 'credits', w.credits, 'reason', v_reason));
  return jsonb_build_object('shop_id', p_shop, 'credits', w.credits);
end $$;

-- Réglages du back-office et mesure anonyme.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$when 'custom_domains' then array[0, 1] when 'shop_subdomains' then array[0, 1] end$s$,
    $s$when 'custom_domains' then array[0, 1] when 'shop_subdomains' then array[0, 1]
    when 'studio_ready' then array[0, 1] when 'studio_budget_usd' then array[0, 2000] when 'studio_daily' then array[1, 100] end$s$);
  if v_new = v_def then raise exception 'studio: bo_setting_bounds non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'custom_domains', 'shop_subdomains']$s$, $s$'custom_domains', 'shop_subdomains', 'studio_ready', 'studio_budget_usd', 'studio_daily']$s$);
  if v_new = v_def then raise exception 'studio: fiila_bo_settings non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'app' and p_variant in ('android', 'ios'))$s$, $s$    or (p_event = 'app' and p_variant in ('android', 'ios'))
    or (p_event = 'studio' and p_variant ~ '^(open|run|kept|cancel):(blanc|minimal|luxe|soleil|fete)$')$s$);
  if v_new = v_def then raise exception 'studio: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_studio_state(text, text)', 'public.fiila_studio_reserve(text, text, text)', 'public.fiila_studio_keep(text, uuid, integer)',
                      'public.fiila_studio_result(text, uuid, integer)', 'public.fiila_bo_studio()', 'public.fiila_bo_studio_grant(uuid, integer, text)',
                      'public.fiila_bo_settings()', 'public.fiila_track(text, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  execute 'revoke execute on function public.fiila_studio_complete(uuid, jsonb) from public';
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function public.fiila_studio_complete(uuid, jsonb) from %I', role_name); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.fiila_studio_complete(uuid, jsonb) to service_role';
  end if;
end $$;
