-- Fii Studio : décors par catégorie de boutique (fondateur, 27/10/2026 : « Je ne veux pas un modèle de génération standard
-- pour toutes les boutiques », règles R1–R3 de la base Aramis Studio, dépôt privé XEL, Production/FII_STUDIO/).
-- Les décors (libellé, couleur, prompt) sont des DONNÉES chargées depuis XEL (scenes-seed.json) : aucun prompt propriétaire
-- dans ce dépôt public. Seuls les 5 décors génériques d'origine (déjà publics) sont semés ici, comme repli.
-- Ordre des décors proposé à une boutique : ceux qu'ELLE garde le plus d'abord (apprentissage par l'usage), puis l'ordre du
-- pack de sa catégorie. Les catégories de service (coiffure, esthetique, services) n'ont pas de génération (règle des packs :
-- jamais de faux résultat) : le Studio n'y est pas proposé.

create table fiila.studio_scenes (
  id          text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  category    text,                                   -- null = décor générique (repli)
  label       text not null check (char_length(label) between 1 and 40),
  swatch      text not null default '#E9DFD0' check (swatch ~ '^#[0-9A-Fa-f]{6}$'),
  prompt      text not null check (char_length(prompt) between 10 and 600),
  rank        int not null default 100,
  active      boolean not null default true,
  version     text not null default '0',
  updated_at  timestamptz not null default now()
);
create index studio_scenes_cat on fiila.studio_scenes (category, rank);
revoke all on fiila.studio_scenes from public;

insert into fiila.studio_scenes (id, category, label, swatch, prompt, rank, version) values
  ('blanc', null, 'Blanc', '#FFFFFF', 'pure white seamless studio background, soft natural contact shadow, even diffused light, ecommerce product photo', 1, 'generic-1'),
  ('minimal', null, 'Minimal', '#E9DFD0', 'minimalist warm beige studio set, soft daylight from a window, subtle shadow, clean premium catalog photo', 2, 'generic-1'),
  ('luxe', null, 'Luxe', '#2B2A28', 'elegant dark marble surface, warm soft spotlight, luxury boutique ambiance, refined shadows', 3, 'generic-1'),
  ('soleil', null, 'Soleil', '#F2B544', 'bright sunny outdoor terrace, warm golden hour light, soft palm leaf shadows, summer mood', 4, 'generic-1'),
  ('fete', null, 'Fête', '#B5452F', 'festive celebration table, warm golden lights bokeh, rich fabric textures, elegant holiday atmosphere', 5, 'generic-1')
on conflict (id) do nothing;

-- Une série retient le décor (id) et la version du pack utilisée.
alter table fiila.studio_jobs drop constraint if exists studio_jobs_style_check;
alter table fiila.studio_jobs add constraint studio_jobs_style_check check (style ~ '^[a-z0-9-]{2,40}$');
alter table fiila.studio_jobs add column scene_version text;

create or replace function fiila.studio_service(p_type text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p_type, '') in ('coiffure', 'esthetique', 'services') $$;

-- Décors proposés à une boutique : ceux de sa catégorie (sinon les génériques), ordonnés par ses versions gardées puis par
-- le rang du pack.
create or replace function fiila.studio_scenes_for(p_shop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select coalesce(business_type, 'autre') t from fiila.shops where id = p_shop),
  pool as (
    select c.* from fiila.studio_scenes c, s where c.active and c.category = s.t
    union all
    select c.* from fiila.studio_scenes c where c.active and c.category is null
      and not exists (select 1 from fiila.studio_scenes x, s where x.active and x.category = s.t)
  ),
  pref as (select style, count(*) n from fiila.studio_jobs where shop_id = p_shop and status = 'kept' group by style)
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'swatch', p.swatch) order by coalesce(f.n, 0) desc, p.rank, p.id), '[]'::jsonb)
    from pool p left join pref f on f.style = p.id
$$;

create or replace function public.fiila_studio_state(p_key text, p_product text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product);
begin
  if v_pid is null or not exists (select 1 from fiila.products where id = v_pid and shop_id = s.id) then perform fiila.fail('product_not_found'); end if;
  return jsonb_build_object('ready', fiila.studio_ready() and not fiila.studio_service(s.business_type), 'credits', fiila.studio_credits(s.id),
    'scenes', fiila.studio_scenes_for(s.id),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'style', j.style, 'status', j.status, 'results', j.results, 'kept', j.kept, 'created_at', j.created_at) order by j.created_at desc)
      from (select * from fiila.studio_jobs where product_id = v_pid and status in ('done', 'kept') and created_at > now() - interval '2 days' order by created_at desc limit 3) j), '[]'::jsonb));
end $$;

-- p_style = id d'un décor actif proposé à cette boutique. Renvoie le prompt du décor à la fonction serveur.
create or replace function public.fiila_studio_reserve(p_key text, p_product text, p_style text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); pr fiila.products; j fiila.studio_jobs; sc fiila.studio_scenes;
begin
  perform fiila.rate_check('studio_reserve', 30);
  if not fiila.studio_ready() or fiila.studio_service(s.business_type) then perform fiila.fail('studio_off'); end if;
  select * into pr from fiila.products where id = v_pid and shop_id = s.id;
  if pr.id is null then perform fiila.fail('product_not_found'); end if;
  if pr.photo is null then perform fiila.fail('studio_no_photo'); end if;
  if p_style is null or not exists (select 1 from jsonb_array_elements(fiila.studio_scenes_for(s.id)) e where e ->> 'id' = p_style) then
    perform fiila.fail('invalid_payload');
  end if;
  select * into sc from fiila.studio_scenes where id = p_style;
  if (fiila.studio_credits(s.id) ->> 'total')::int < 1 then perform fiila.fail('studio_no_credits'); end if;
  if fiila.studio_spent() >= coalesce(fiila.setting_int('studio_budget_usd'), 0) then perform fiila.fail('studio_budget'); end if;
  if (select count(*) from fiila.studio_jobs where shop_id = s.id and created_at > now() - interval '1 day') >= coalesce(fiila.setting_int('studio_daily'), 10) then
    perform fiila.fail('studio_daily_limit');
  end if;
  update fiila.studio_jobs set status = 'failed', error = 'Délai dépassé', done_at = now() where shop_id = s.id and status = 'running' and created_at < now() - interval '3 minutes';
  if exists (select 1 from fiila.studio_jobs where shop_id = s.id and status = 'running') then perform fiila.fail('studio_busy'); end if;
  insert into fiila.studio_jobs (shop_id, product_id, style, scene_version, created_by) values (s.id, pr.id, sc.id, sc.version, fiila.uid()) returning * into j;
  return jsonb_build_object('job', j.id, 'style', j.style, 'prompt', sc.prompt, 'name', pr.name,
    'image', 'data:' || coalesce(pr.photo_type, 'image/jpeg') || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', ''));
end $$;

-- ---------------------------------------------------------------- back-office
-- Décors avec leurs résultats (séries, versions gardées, taux) : ce que les boutiques préfèrent, par catégorie.
create or replace function public.fiila_bo_studio_scenes() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('shops');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'label', c.label, 'swatch', c.swatch, 'rank', c.rank,
      'active', c.active, 'version', c.version, 'series', coalesce(x.series, 0), 'kept', coalesce(x.kept, 0))
      order by c.category nulls first, c.rank, c.id)
    from fiila.studio_scenes c
    left join (select style, count(*) series, count(*) filter (where status = 'kept') kept from fiila.studio_jobs group by style) x on x.style = c.id), '[]'::jsonb);
end $$;

create or replace function public.fiila_bo_studio_scene_set(p_id text, p_active boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_reason text := nullif(fiila.clean(p_reason, 200), ''); c fiila.studio_scenes;
begin
  perform fiila.need_staff('shops_write');
  if v_reason is null then perform fiila.fail('reason_required'); end if;
  update fiila.studio_scenes set active = coalesce(p_active, active), updated_at = now() where id = p_id returning * into c;
  if c.id is null then perform fiila.fail('not_found'); end if;
  perform fiila.bo_log('studio_scene', 'studio_scene', c.id, jsonb_build_object('active', c.active, 'reason', v_reason));
  return jsonb_build_object('id', c.id, 'active', c.active);
end $$;

-- Mesure anonyme : les variantes studio acceptent tout id de décor.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$p_variant ~ '^(open|run|kept|cancel):(blanc|minimal|luxe|soleil|fete)$'$s$, $s$p_variant ~ '^(open|run|kept|cancel):[a-z0-9-]{2,40}$'$s$);
  if v_new = v_def then raise exception 'studio_scenes: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_studio_state(text, text)', 'public.fiila_studio_reserve(text, text, text)',
                      'public.fiila_bo_studio_scenes()', 'public.fiila_bo_studio_scene_set(text, boolean, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
