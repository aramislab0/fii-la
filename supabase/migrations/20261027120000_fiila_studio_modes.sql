-- Fii Studio : deux modes (fondateur, 27/10/2026 01:09, « go » ; bench « studio premium » dans la base privée XEL,
-- Production/FII_STUDIO/bench/STUDIO_PREMIUM.md) :
--   « fidele »  : le décor est refait autour du produit, qui garde ses pixels d'origine (Bria replace-background, ~0,04 USD) ;
--   « premium » : rendu studio hyperréaliste (Nano Banana Pro 2K, ~0,15 USD) ; le produit peut être légèrement redessiné, la
--                 boutique compare avec l'original avant de garder. Interdit pour bijoux, plats, pâtisserie et fleurs.
-- Une version par série (« Autre proposition » relance). Garder une version premium coûte studio_premium_credits crédits.
-- Les gabarits de prompt (caméra, « garder le produit identique », « porté par un mannequin ») sont des DONNÉES chargées
-- depuis XEL dans fiila.settings (studio_tpl_*) : rien de propriétaire dans ce dépôt public.

alter table fiila.studio_jobs add column mode text not null default 'fidele' check (mode in ('fidele', 'premium'));

insert into fiila.settings (key, value) values ('studio_premium', '1'), ('studio_premium_credits', '3'),
  ('studio_tpl_camera', ''), ('studio_tpl_keep', ''), ('studio_tpl_wear', '')
on conflict (key) do nothing;

create or replace function fiila.studio_text(p_key text) returns text
language sql stable set search_path = '' as $$ select coalesce((select value from fiila.settings where key = p_key), '') $$;

create or replace function fiila.studio_premium_ok(p_type text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(fiila.setting_int('studio_premium'), 0) = 1
     and coalesce(p_type, 'autre') not in ('bijoux', 'restauration', 'patisserie', 'fleurs', 'coiffure', 'esthetique', 'services')
$$;

create or replace function fiila.studio_cost(p_mode text) returns int
language sql stable set search_path = '' as $$
  select case when p_mode = 'premium' then greatest(1, coalesce(fiila.setting_int('studio_premium_credits'), 3)) else 1 end
$$;

create or replace function public.fiila_studio_state(p_key text, p_product text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product);
begin
  if v_pid is null or not exists (select 1 from fiila.products where id = v_pid and shop_id = s.id) then perform fiila.fail('product_not_found'); end if;
  return jsonb_build_object('ready', fiila.studio_ready() and not fiila.studio_service(s.business_type), 'credits', fiila.studio_credits(s.id),
    'scenes', fiila.studio_scenes_for(s.id),
    'premium', case when fiila.studio_premium_ok(s.business_type) then jsonb_build_object('credits', fiila.studio_cost('premium'),
      'wear', coalesce(s.business_type, '') in ('mode', 'couture')) end,
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'style', j.style, 'mode', j.mode, 'status', j.status, 'results', j.results, 'kept', j.kept, 'created_at', j.created_at) order by j.created_at desc)
      from (select * from fiila.studio_jobs where product_id = v_pid and status in ('done', 'kept') and created_at > now() - interval '2 days' order by created_at desc limit 3) j), '[]'::jsonb));
end $$;

drop function public.fiila_studio_reserve(text, text, text);
create or replace function public.fiila_studio_reserve(p_key text, p_product text, p_style text, p_mode text default 'fidele') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); pr fiila.products; j fiila.studio_jobs; sc fiila.studio_scenes;
  v_mode text := coalesce(p_mode, 'fidele'); v_prompt text;
begin
  perform fiila.rate_check('studio_reserve', 30);
  if not fiila.studio_ready() or fiila.studio_service(s.business_type) then perform fiila.fail('studio_off'); end if;
  if v_mode not in ('fidele', 'premium') then perform fiila.fail('invalid_payload'); end if;
  if v_mode = 'premium' and not fiila.studio_premium_ok(s.business_type) then perform fiila.fail('studio_premium_off'); end if;
  select * into pr from fiila.products where id = v_pid and shop_id = s.id;
  if pr.id is null then perform fiila.fail('product_not_found'); end if;
  if pr.photo is null then perform fiila.fail('studio_no_photo'); end if;
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
  v_prompt := fiila.studio_text('studio_tpl_camera')
    || case when v_mode = 'premium' then case when coalesce(s.business_type, '') in ('mode', 'couture') then fiila.studio_text('studio_tpl_wear') else fiila.studio_text('studio_tpl_keep') end else '' end
    || sc.prompt;
  insert into fiila.studio_jobs (shop_id, product_id, style, mode, scene_version, created_by) values (s.id, pr.id, sc.id, v_mode, sc.version, fiila.uid()) returning * into j;
  return jsonb_build_object('job', j.id, 'style', j.style, 'mode', j.mode, 'prompt', v_prompt, 'name', pr.name,
    'image', 'data:' || coalesce(pr.photo_type, 'image/jpeg') || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', ''));
end $$;

-- Garder : 1 crédit (fidèle) ou studio_premium_credits (premium) ; essai partenaire d'abord, puis crédits de la boutique.
create or replace function public.fiila_studio_keep(p_key text, p_job uuid, p_index int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); j fiila.studio_jobs; c jsonb; v_need int; v_trial int; v_from text;
begin
  select * into j from fiila.studio_jobs where id = p_job and shop_id = s.id for update;
  if j.id is null then perform fiila.fail('not_found'); end if;
  if j.status = 'kept' then return jsonb_build_object('id', j.id, 'status', j.status, 'kept', j.kept, 'url', j.results ->> j.kept, 'credits', fiila.studio_credits(s.id)); end if;
  if j.status <> 'done' or p_index is null or p_index < 0 or p_index >= jsonb_array_length(j.results) then perform fiila.fail('invalid_state'); end if;
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

-- Back-office : le mode apparaît dans les dernières séries ; réglages studio_premium (0/1) et studio_premium_credits (1–10).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_studio()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'style', j.style, 'status', j.status,$s$, $s$'style', j.style, 'mode', j.mode, 'status', j.status,$s$);
  if v_new = v_def then raise exception 'studio_modes: fiila_bo_studio non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$when 'studio_daily' then array[1, 100]$s$, $s$when 'studio_daily' then array[1, 100]
    when 'studio_premium' then array[0, 1] when 'studio_premium_credits' then array[1, 10]$s$);
  if v_new = v_def then raise exception 'studio_modes: bo_setting_bounds non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'studio_ready', 'studio_budget_usd', 'studio_daily']$s$, $s$'studio_ready', 'studio_budget_usd', 'studio_daily', 'studio_premium', 'studio_premium_credits']$s$);
  if v_new = v_def then raise exception 'studio_modes: fiila_bo_settings non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_studio_state(text, text)', 'public.fiila_studio_reserve(text, text, text, text)', 'public.fiila_studio_keep(text, uuid, integer)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
