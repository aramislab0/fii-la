-- Ma boutique, lot 1 (fondateur, 22/10/2026 : « Ma boutique » sur l'accueil, à côté « Mes commandes », « Marketing »
-- avec les statistiques et les pages sur les réseaux).
-- 1) Visites de la vitrine : un compteur par boutique et par jour (UTC), sans aucune donnée sur la personne qui visite.
-- 2) Réseaux de la boutique (Instagram, TikTok, Facebook) : identifiants seulement, affichés en bas de la vitrine.
-- 3) fiila_shop_stats : ventes, commandes, panier moyen, commandes venues de la vitrine, nouveaux clients, visites,
--    publications et articles les plus vendus, sur 7, 30 ou 90 jours, avec la période précédente pour comparer.
-- Back-office (règle n° 8) : fiche boutique → « Marketing » (visites et commandes vitrine sur 30 jours, réseaux) ;
-- mesure anonyme de l'écran (événement « marketing »).

create table if not exists fiila.shop_views (
  shop_id uuid not null references fiila.shops (id) on delete cascade,
  day     date not null,
  n       int  not null default 0,
  primary key (shop_id, day)
);
alter table fiila.shop_views enable row level security;
revoke all on fiila.shop_views from public;

alter table fiila.shops add column if not exists socials jsonb not null default '{}'::jsonb;

-- Identifiant de réseau : « @nom », « nom » ou un lien collé (instagram.com/nom) → « nom ». Vide = retiré.
create or replace function fiila.social_handle(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p, ''));
begin
  if v = '' then return null; end if;
  v := regexp_replace(v, '^https?://', '', 'i');
  v := regexp_replace(v, '^(www\.|m\.)?(instagram\.com|tiktok\.com|facebook\.com|fb\.com)/', '', 'i');
  v := regexp_replace(v, '[/?#].*$', '');
  v := regexp_replace(v, '^@', '');
  if v !~ '^[A-Za-z0-9._-]{1,50}$' then perform fiila.fail('invalid_social'); end if;
  return v;
end $$;

create or replace function fiila.socials_in(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v jsonb := '{}'::jsonb; k text; h text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  foreach k in array array['instagram', 'tiktok', 'facebook'] loop
    if p ? k then
      if jsonb_typeof(p -> k) not in ('string', 'null') then perform fiila.fail('invalid_social'); end if;
      h := fiila.social_handle(p ->> k);
      if h is not null then v := v || jsonb_build_object(k, h); end if;
    end if;
  end loop;
  return v;
end $$;

do $$
declare v_def text; v_new text;
begin
  -- Vitrine publique : une visite comptée, et les réseaux de la boutique.
  select pg_get_functiondef('public.fiila_vitrine(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$  return jsonb_build_object('state', 'ok',$s$,
    $s$  insert into fiila.shop_views (shop_id, day, n) values (s.id, (now() at time zone 'utc')::date, 1)
    on conflict (shop_id, day) do update set n = fiila.shop_views.n + 1;
  return jsonb_build_object('state', 'ok',$s$);
  v_new := replace(v_new, $s$'theme', s.theme, 'accent', s.accent, 'has_cover'$s$,
    $s$'theme', s.theme, 'accent', s.accent, 'socials', nullif(s.socials, '{}'::jsonb), 'has_cover'$s$);
  if v_new = v_def or v_new !~ 'shop_views' or v_new !~ 'socials' then raise exception 'shop_marketing: fiila_vitrine non modifiée'; end if;
  execute v_new;

  -- Réglages de la vitrine : les réseaux s'enregistrent avec le reste (même droit « admin », même limite).
  select pg_get_functiondef('public.fiila_shop_vitrine(text, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$      accent = case when p ? 'accent' then p ->> 'accent' else accent end,$s$,
    $s$      accent = case when p ? 'accent' then p ->> 'accent' else accent end,
      socials = case when p ? 'socials' then fiila.socials_in(p -> 'socials') else socials end,$s$);
  v_new := replace(v_new, $s$'theme', s.theme, 'accent', s.accent,
    'cover'$s$, $s$'theme', s.theme, 'accent', s.accent, 'socials', s.socials,
    'cover'$s$);
  if v_new = v_def or (length(v_new) - length(replace(v_new, 'socials', ''))) / 7 < 6 then raise exception 'shop_marketing: fiila_shop_vitrine non modifiée'; end if;
  execute v_new;

  -- Back-office : fiche boutique → marketing sur 30 jours.
  select pg_get_functiondef('public.fiila_bo_shop(uuid)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'team', fiila.bo_shop_team(s.id, v_uid),$s$,
    $s$    'marketing', jsonb_build_object(
      'views_30', (select coalesce(sum(v.n), 0) from fiila.shop_views v where v.shop_id = s.id and v.day > (now() at time zone 'utc')::date - 30),
      'vitrine_orders_30', (select count(*) from fiila.orders o where o.shop_id = s.id and o.source = 'vitrine' and o.created_at >= now() - interval '30 days'),
      'posts_30', (select count(*) from fiila.posts p where p.shop_id = s.id and p.created_at >= now() - interval '30 days'),
      'socials', nullif(s.socials, '{}'::jsonb)),
    'team', fiila.bo_shop_team(s.id, v_uid),$s$);
  if v_new = v_def then raise exception 'shop_marketing: fiila_bo_shop non modifiée'; end if;
  execute v_new;

  -- Back-office : Croissance → Parcours d'accueil → « Ma boutique et Marketing » (compteurs anonymes, 30 jours).
  select pg_get_functiondef('public.fiila_bo_onboarding()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'discover_on',$s$, $s$    'marketing', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'marketing' and day > v_since group by 1) x), '{}'::jsonb),
    'discover_on',$s$);
  if v_new = v_def then raise exception 'shop_marketing: fiila_bo_onboarding non modifiée'; end if;
  execute v_new;

  -- Mesure anonyme de l'écran Marketing.
  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'shop_setup'$s$,
    $s$    or (p_event = 'marketing' and p_variant ~ '^(open|period:(7|30|90)|share:(wa|copy|qr)|socials:(open|save)|publish:click|vitrine:open)$')
    or (p_event = 'shop_setup'$s$);
  if v_new = v_def then raise exception 'shop_marketing: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

-- Statistiques de la boutique (tout membre de l'équipe). Période : 7, 30 ou 90 jours ; sinon 30.
create or replace function public.fiila_shop_stats(p_key text, p_days int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
  v_days int := case when p_days in (7, 30, 90) then p_days else 30 end;
  v_from timestamptz := now() - make_interval(days => v_days);
  v_prev timestamptz := now() - make_interval(days => 2 * v_days);
  v_today date := (now() at time zone 'utc')::date;
  v_cur record; v_old record;
begin
  perform fiila.rate_check('shop_stats', 120);
  select count(*) as n, coalesce(sum(o.total), 0) as amount, count(*) filter (where o.source = 'vitrine') as vit
    into v_cur from fiila.orders o where o.shop_id = s.id and o.status <> 'cancelled' and o.created_at >= v_from;
  select count(*) as n, coalesce(sum(o.total), 0) as amount
    into v_old from fiila.orders o where o.shop_id = s.id and o.status <> 'cancelled' and o.created_at >= v_prev and o.created_at < v_from;
  return jsonb_build_object('days', v_days, 'name', s.name,
    'role', coalesce(nullif(current_setting('fiila.shop_role', true), ''), 'owner'),
    'orders', v_cur.n, 'revenue', v_cur.amount, 'basket', case when v_cur.n > 0 then round(v_cur.amount::numeric / v_cur.n) else 0 end,
    'vitrine_orders', v_cur.vit,
    'prev_orders', v_old.n, 'prev_revenue', v_old.amount,
    'new_customers', (select count(*) from fiila.customers c where c.shop_id = s.id and c.created_at >= v_from),
    'views', (select coalesce(sum(v.n), 0) from fiila.shop_views v where v.shop_id = s.id and v.day > v_today - v_days),
    'prev_views', (select coalesce(sum(v.n), 0) from fiila.shop_views v where v.shop_id = s.id and v.day > v_today - 2 * v_days and v.day <= v_today - v_days),
    'posts', (select count(*) from fiila.posts p where p.shop_id = s.id and p.created_at >= v_from),
    'top', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'qty', t.qty, 'amount', t.amount) order by t.qty desc, t.amount desc)
      from (select fiila.as_uuid(it ->> 'product_id') as pid, sum((it ->> 'qty')::int) as qty, sum((it ->> 'qty')::bigint * (it ->> 'price')::bigint) as amount
              from fiila.orders o, jsonb_array_elements(o.items) it
             where o.shop_id = s.id and o.status <> 'cancelled' and o.created_at >= v_from and it ? 'product_id'
             group by 1 order by 2 desc, 3 desc limit 3) t
      join fiila.products pr on pr.id = t.pid and pr.shop_id = s.id), '[]'::jsonb),
    'vitrine', jsonb_strip_nulls(jsonb_build_object('public', s.public, 'slug', s.slug)),
    'socials', s.socials);
end $$;

revoke all on all functions in schema fiila from public;
revoke execute on function public.fiila_shop_stats(text, int) from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_shop_stats(text, int)', 'public.fiila_vitrine(text)', 'public.fiila_shop_vitrine(text, jsonb)',
                      'public.fiila_bo_shop(uuid)', 'public.fiila_track(text, text)', 'public.fiila_bo_onboarding()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
