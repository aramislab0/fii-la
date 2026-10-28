-- Fii Studio : FIBO 2.0 branché (comparatif du 28/10/2026, base privée XEL bench/FIBO.md ; validation du fondateur le 28/10 :
-- « Oui, branche-le »). Les deux modes vus par la boutique ne changent pas ; le moteur de chaque série est choisi ici :
--   * mode « fidele » : FIBO avec masque (produit gardé au pixel près) pour les bijoux et la restauration, où Bria
--     replace-background ajoutait des objets ; Bria replace-background pour les autres catégories (inchangé) ;
--   * mode « premium » : FIBO sans masque pour les vêtements portés (mode, couture), FIBO avec masque pour les objets et
--     emballages ; Nano Banana Pro n'est plus appelé (1 / 6 gardable sur les objets au comparatif, 0,15 USD).
-- Réglage studio_fibo = 0 : retour immédiat aux moteurs d'avant (Bria / Nano Banana Pro), sans redéploiement.
-- Chaque série enregistre son moteur (studio_jobs.engine) ; back-office : colonne « Moteur » des séries, réglage studio_fibo.
-- Crédits inchangés (décision commerciale du fondateur) ; coût réel enregistré par série (FIBO 0,04 USD, + 0,018 USD de
-- détourage pour le masque).

insert into fiila.settings (key, value) values ('studio_fibo', '1') on conflict (key) do nothing;

alter table fiila.studio_jobs add column if not exists engine text;
alter table fiila.studio_jobs drop constraint if exists studio_jobs_engine_check;
alter table fiila.studio_jobs add constraint studio_jobs_engine_check check (engine is null or engine in ('bria', 'nano', 'fibo', 'fibo_mask'));

create or replace function fiila.studio_engine(p_mode text, p_type text) returns text
language sql stable set search_path = '' as $$
  select case
    when coalesce(fiila.setting_int('studio_fibo'), 1) <> 1 then case when p_mode = 'premium' then 'nano' else 'bria' end
    when p_mode = 'premium' then case when coalesce(p_type, '') in ('mode', 'couture') then 'fibo' else 'fibo_mask' end
    when coalesce(p_type, '') in ('bijoux', 'restauration') then 'fibo_mask'
    else 'bria' end
$$;
revoke all on function fiila.studio_engine(text, text) from public;

-- Définitions complètes (garde-fou des migrations), identiques à la production du 28/10 (empreintes vérifiées) à l'ajout près
-- du moteur (réservation, séries du back-office) et du réglage studio_fibo (bornes, liste des réglages).
CREATE OR REPLACE FUNCTION public.fiila_studio_reserve(p_key text, p_product text, p_style text, p_mode text DEFAULT 'fidele'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); pr fiila.products; j fiila.studio_jobs; sc fiila.studio_scenes;
  v_mode text := coalesce(p_mode, 'fidele'); v_prompt text; v_engine text;
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
  if (fiila.studio_credits(s.id) ->> 'total')::int < fiila.studio_cost(v_mode) then perform fiila.fail('studio_no_credits'); end if;
  if fiila.studio_spent() >= coalesce(fiila.setting_int('studio_budget_usd'), 0) then perform fiila.fail('studio_budget'); end if;
  if (select count(*) from fiila.studio_jobs where shop_id = s.id and created_at > now() - interval '1 day') >= coalesce(fiila.setting_int('studio_daily'), 10) then
    perform fiila.fail('studio_daily_limit');
  end if;
  update fiila.studio_jobs set status = 'failed', error = 'Délai dépassé', done_at = now() where shop_id = s.id and status = 'running' and created_at < now() - interval '3 minutes';
  if exists (select 1 from fiila.studio_jobs where shop_id = s.id and status = 'running') then perform fiila.fail('studio_busy'); end if;
  -- Moteur (comparatif du 28/10) ; FIBO avec masque protège déjà le produit : pas de consigne « garder le produit ».
  v_engine := fiila.studio_engine(v_mode, s.business_type);
  v_prompt := fiila.studio_text('studio_tpl_camera')
    || case when v_mode = 'premium' and v_engine <> 'fibo_mask' then case when coalesce(s.business_type, '') in ('mode', 'couture') then fiila.studio_text('studio_tpl_wear') else fiila.studio_text('studio_tpl_keep') end else '' end
    || sc.prompt;
  insert into fiila.studio_jobs (shop_id, product_id, style, mode, scene_version, created_by, engine) values (s.id, pr.id, sc.id, v_mode, sc.version, fiila.uid(), v_engine) returning * into j;
  return jsonb_build_object('job', j.id, 'style', j.style, 'mode', j.mode, 'engine', j.engine, 'prompt', v_prompt, 'name', pr.name,
    'image', case when pr.photo is not null then 'data:' || coalesce(pr.photo_type, 'image/jpeg') || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '')
                   else (select value from fiila.settings where key = 'media_base') || pr.photo_path end);
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_bo_studio()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform fiila.need_staff('shops');
  return jsonb_build_object(
    'ready', fiila.studio_ready(), 'fibo', coalesce(fiila.setting_int('studio_fibo'), 1) = 1, 'budget_usd', coalesce(fiila.setting_int('studio_budget_usd'), 0), 'spent_usd', fiila.studio_spent(),
    'month', jsonb_build_object('series', (select count(*) from fiila.studio_jobs where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'kept', (select count(*) from fiila.studio_jobs where status = 'kept' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'failed', (select count(*) from fiila.studio_jobs where status = 'failed' and created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar'),
      'shops', (select count(distinct shop_id) from fiila.studio_jobs where created_at >= date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar')),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'shop', s.name, 'shop_id', s.id, 'product', p.name, 'style', j.style, 'mode', j.mode, 'engine', j.engine, 'status', j.status,
        'kept', j.kept, 'cost_usd', j.cost_usd, 'error', j.error, 'created_at', j.created_at) order by j.created_at desc)
      from (select * from fiila.studio_jobs order by created_at desc limit 100) j join fiila.shops s on s.id = j.shop_id join fiila.products p on p.id = j.product_id), '[]'::jsonb),
    'wallets', coalesce((select jsonb_agg(jsonb_build_object('shop_id', s.id, 'shop', s.name, 'credits', w.credits, 'updated_at', w.updated_at) order by w.updated_at desc)
      from fiila.studio_wallets w join fiila.shops s on s.id = w.shop_id where w.credits > 0 or w.updated_at > now() - interval '30 days'), '[]'::jsonb));
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
    when 'studio_premium' then array[0, 1] when 'kyc_required' then array[0, 1] when 'site_look' then array[0, 6] when 'studio_premium_credits' then array[1, 10] when 'studio_fibo' then array[0, 1] end
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
    from unnest(array['vd_commission', 'amb_reward_1', 'amb_reward_2', 'amb_reward_3', 'amb_monthly_cap', 'sms_verify', 'amb_manager_llm', 'nudges', 'amb_whatsapp', 'onboarding_v2', 'discover_after', 'wa_card_media', 'media_cdn', 'sugg_home_shop', 'sugg_shop_more_products', 'sugg_shop_share_vitrine', 'sugg_shop_courier', 'sugg_shop_photos', 'sugg_shop_team', 'adaptive_home', 'sugg_addr_photo', 'sugg_addr_mark', 'custom_domains', 'shop_subdomains', 'studio_ready', 'studio_budget_usd', 'studio_daily', 'studio_premium', 'studio_premium_credits', 'studio_fibo', 'kyc_required', 'site_look']) k), '{}'::jsonb);
end $function$;

-- Droits réaffirmés, identiques à la production : réservation ouverte aux boutiques sans compte (anon) et aux comptes ;
-- back-office aux comptes seulement (le droit de l'équipe est vérifié dans la fonction).
do $$
declare r text; fn text;
begin
  foreach fn in array array['public.fiila_studio_reserve(text, text, text, text)', 'public.fiila_bo_studio()', 'public.fiila_bo_settings()'] loop
    execute format('revoke execute on function %s from public', fn);
    foreach r in array array['authenticated', 'service_role'] || case when fn like '%reserve%' then array['anon'] else array[]::text[] end loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('grant execute on function %s to %I', fn, r); end if;
    end loop;
    if fn not like '%reserve%' and exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', fn); end if;
  end loop;
end $$;
