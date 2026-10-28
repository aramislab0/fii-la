-- Fii Studio : mesures par décor et affichage « 6 + Plus » (MANDAT-STUDIO-FIABLE-001 §3 ; revue VP #82 R3-R4 ; fondateur :
-- « Oui, dans cet ordre », « Oui, continue »).
-- Mesures, par décor ET par version / mode :
--   * exposition réelle : décors réellement affichés à la boutique (fiila_studio_seen, un compteur par jour) ;
--   * génération livrée, panne, garde : lues dans les séries (studio_jobs) ;
--   * rejet explicite : « Autre proposition » ou « Changer de décor » après avoir vu la version (fiila_studio_reject) ;
--   * partage : partage de l'article réussi depuis Publier après une version gardée (fiila_studio_shared). Un simple clic,
--     un téléchargement ou l'ouverture d'un réseau ne comptent pas.
-- Seuil de garde (moins de 40 % après 20 générations livrées) = alerte de revue au back-office ; aucun retrait ni aucune
-- promotion automatique.
-- Affichage : 6 décors puis « Plus de décors » ; d'abord les décors que la boutique a gardés (favoris), puis au plus un
-- décor candidat (nouveau décor promu par le fondateur, colonne candidate) choisi pour la semaine (stable toute la
-- semaine pour une boutique), puis les autres par rang ; les autres candidats passent dans « Plus ». Aucun candidat si la
-- boutique a déjà 6 favoris.
-- Back-office : mesures par décor et par mode, alerte « À revoir », interrupteur « candidat » (motif obligatoire, journal).

alter table fiila.studio_jobs add column if not exists rejected_at timestamptz;
alter table fiila.studio_jobs add column if not exists shared_at timestamptz;
alter table fiila.studio_scenes add column if not exists candidate boolean not null default false;

create table if not exists fiila.studio_scene_views (
  shop_id  uuid not null references fiila.shops (id) on delete cascade,
  scene_id text not null references fiila.studio_scenes (id) on delete cascade,
  version  text not null,
  mode     text not null check (mode in ('fidele', 'premium')),
  day      date not null default ((now() at time zone 'Africa/Dakar')::date),
  n        int not null default 1 check (n > 0),
  primary key (shop_id, scene_id, version, mode, day)
);
alter table fiila.studio_scene_views enable row level security;
revoke all on fiila.studio_scene_views from public;
create index if not exists studio_scene_views_scene on fiila.studio_scene_views (scene_id, version, mode);

-- Décors proposés à une boutique : favoris, puis au plus un candidat de la semaine, puis les autres ; « top » = les 6 visibles.
create or replace function fiila.studio_scenes_for(p_shop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select coalesce(business_type, 'autre') t from fiila.shops where id = p_shop),
  pool as (
    select c.* from fiila.studio_scenes c, s where c.active and c.category = s.t
    union all
    select c.* from fiila.studio_scenes c where c.active and c.category is null
      and not exists (select 1 from fiila.studio_scenes x, s where x.active and x.category = s.t)
  ),
  pref as (select style, count(*) n from fiila.studio_jobs where shop_id = p_shop and status = 'kept' group by style),
  fav as (select p.id, row_number() over (order by f.n desc, p.rank, p.id) rn from pool p join pref f on f.style = p.id),
  k as (select count(*) n from fav),
  cand as (
    select p.id from pool p, k where p.candidate and k.n < 6 and not exists (select 1 from fav where fav.id = p.id)
     order by md5(p_shop::text || to_char(now() at time zone 'Africa/Dakar', 'IYYY-IW') || p.id) limit 1
  ),
  ordered as (
    select p.id, p.label, p.swatch, (cd.id is not null) is_cand,
           case when fv.id is not null then fv.rn::numeric
                when cd.id is not null then (select n from k) + 0.5
                when p.candidate then 2000 + p.rank
                else 1000 + p.rank end ord
      from pool p left join fav fv on fv.id = p.id left join cand cd on cd.id = p.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'swatch', o.swatch, 'top', o.pos <= 6,
           'candidate', case when o.is_cand then true end) order by o.pos), '[]'::jsonb)
    from (select ordered.*, row_number() over (order by ord, id) pos from ordered) o
$$;
revoke all on function fiila.studio_scenes_for(uuid) from public;

-- Exposition réelle : décors affichés à la boutique (au plus 30 par appel), comptés par jour, version et mode.
create or replace function public.fiila_studio_seen(p_key text, p_scenes jsonb, p_mode text default 'fidele') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_mode text := coalesce(p_mode, 'fidele'); v_n int := 0; v_list jsonb;
begin
  perform fiila.rate_check('studio_seen', 120);
  if v_mode not in ('fidele', 'premium') or jsonb_typeof(coalesce(p_scenes, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_scenes) > 30 then
    perform fiila.fail('invalid_payload');
  end if;
  v_list := fiila.studio_scenes_for(s.id);
  insert into fiila.studio_scene_views (shop_id, scene_id, version, mode)
  select s.id, c.id, c.version, v_mode from fiila.studio_scenes c
   where c.id in (select jsonb_array_elements_text(p_scenes))
     and exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'id' = c.id)
  on conflict (shop_id, scene_id, version, mode, day) do update set n = fiila.studio_scene_views.n + 1;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'counted', v_n);
end $$;

-- Rejet explicite d'une version livrée (« Autre proposition », « Changer de décor ») ; répétable sans effet.
create or replace function public.fiila_studio_reject(p_key text, p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_n int;
begin
  update fiila.studio_jobs set rejected_at = now() where id = p_job and shop_id = s.id and status = 'done' and rejected_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from fiila.studio_jobs where id = p_job and shop_id = s.id) then perform fiila.fail('not_found'); end if;
  return jsonb_build_object('ok', true, 'rejected', v_n = 1);
end $$;

-- Partage réussi depuis Publier : la dernière version gardée de l'article (30 jours) est comptée comme partagée, une fois.
create or replace function public.fiila_studio_shared(p_key text, p_product text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v_pid uuid := fiila.as_uuid(p_product); v_job uuid;
begin
  perform fiila.rate_check('studio_shared', 60);
  select id into v_job from fiila.studio_jobs
   where shop_id = s.id and product_id = v_pid and status = 'kept' and created_at > now() - interval '30 days'
   order by created_at desc limit 1;
  if v_job is null then return jsonb_build_object('ok', true, 'shared', false); end if;
  update fiila.studio_jobs set shared_at = now() where id = v_job and shared_at is null;
  return jsonb_build_object('ok', true, 'shared', found);
end $$;

-- Back-office : décors avec leurs mesures par version et mode, candidat ; alerte de revue = au moins une version/mode sous 40 %
-- de garde après 20 générations livrées.
CREATE OR REPLACE FUNCTION public.fiila_bo_studio_scenes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform fiila.need_staff('shops');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'label', c.label, 'swatch', c.swatch, 'rank', c.rank,
      'active', c.active, 'version', c.version, 'candidate', c.candidate, 'series', coalesce(x.series, 0), 'kept', coalesce(x.kept, 0),
      'alert', coalesce((select bool_or((e ->> 'alert')::boolean) from jsonb_array_elements(m.stats) e), false), 'stats', coalesce(m.stats, '[]'::jsonb))
      order by c.category nulls first, c.rank, c.id)
    from fiila.studio_scenes c
    left join (select style, count(*) series, count(*) filter (where status = 'kept') kept from fiila.studio_jobs group by style) x on x.style = c.id
    left join lateral (
      select jsonb_agg(jsonb_build_object('version', z.version, 'mode', z.mode, 'shown', z.shown, 'delivered', z.delivered,
               'failed', z.failed, 'rejected', z.rejected, 'kept', z.kept, 'shared', z.shared, 'shops', z.shops,
               'keep_rate', case when z.delivered > 0 then round(z.kept::numeric / z.delivered, 2) end,
               'alert', z.delivered >= 20 and z.kept::numeric / z.delivered < 0.4) order by z.version, z.mode) stats
        from (
          select coalesce(j.version, v.version) version, coalesce(j.mode, v.mode) mode,
                 coalesce(v.shown, 0) shown, coalesce(j.delivered, 0) delivered, coalesce(j.failed, 0) failed,
                 coalesce(j.rejected, 0) rejected, coalesce(j.kept, 0) kept, coalesce(j.shared, 0) shared, coalesce(j.shops, 0) shops
            from (select coalesce(scene_version, '0') version, mode,
                         count(*) filter (where status in ('done', 'kept')) delivered, count(*) filter (where status = 'failed') failed,
                         count(*) filter (where rejected_at is not null) rejected, count(*) filter (where status = 'kept') kept,
                         count(*) filter (where shared_at is not null) shared,
                         count(distinct shop_id) filter (where status in ('done', 'kept')) shops
                    from fiila.studio_jobs where style = c.id group by 1, 2) j
            full join (select version, mode, sum(n) shown from fiila.studio_scene_views where scene_id = c.id group by 1, 2) v
              on v.version = j.version and v.mode = j.mode
        ) z
    ) m on true), '[]'::jsonb);
end $function$;

-- Décor « candidat » (nouveau décor à faire essayer, au plus un parmi les six visibles) : équipe, motif obligatoire, journal.
create or replace function public.fiila_bo_studio_scene_candidate(p_id text, p_candidate boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_reason text := nullif(fiila.clean(p_reason, 200), ''); c fiila.studio_scenes;
begin
  perform fiila.need_staff('shops_write');
  if v_reason is null then perform fiila.fail('reason_required'); end if;
  update fiila.studio_scenes set candidate = coalesce(p_candidate, candidate), updated_at = now() where id = p_id returning * into c;
  if c.id is null then perform fiila.fail('not_found'); end if;
  perform fiila.bo_log('studio_scene', 'studio_scene', c.id, jsonb_build_object('candidate', c.candidate, 'reason', v_reason));
  return jsonb_build_object('id', c.id, 'candidate', c.candidate);
end $$;

do $$
declare r text; fn text;
begin
  foreach fn in array array['public.fiila_studio_seen(text, jsonb, text)', 'public.fiila_studio_reject(text, uuid)',
      'public.fiila_studio_shared(text, text)', 'public.fiila_bo_studio_scenes()', 'public.fiila_bo_studio_scene_candidate(text, boolean, text)'] loop
    execute format('revoke execute on function %s from public', fn);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke execute on function %s from %I', fn, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', fn); end if;
    if fn !~ 'bo_' and exists (select 1 from pg_roles where rolname = 'anon') then execute format('grant execute on function %s to anon', fn); end if;
  end loop;
end $$;
