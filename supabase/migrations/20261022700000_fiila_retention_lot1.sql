-- Rétention, lot 1 (proposition v2 validée par le fondateur le 22/10/2026 19:20, après revue VP R1–R5).
-- 1) fiila_shop_get : compteurs d'état réel qui confirment un succès (visites du site, commandes par le site, articles à
--    plusieurs photos, membres et invitations d'équipe) et commandes ouvertes qui attendent une adresse (S0).
-- 2) Un interrupteur par suggestion (sugg_<id>, 0/1), en plus de l'interrupteur général « nudges » ; lus par l'application.
-- 3) Mesure anonyme : retention × <suggestion> × (shown, click, dismiss, used, repeat) ; order_address × (shown, used).
-- 4) Back-office Croissance → Suggestions : agrégats 30 jours, 7 derniers jours (fenêtre incomplète), interrupteurs,
--    adresses de commandes obtenues sur 30 jours et commandes ouvertes en attente (agrégats, aucune donnée de client).

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_shop_get(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'products', (select count(*) from fiila.products pr where pr.shop_id = s.id and pr.active))$s$,
    $s$'products', (select count(*) from fiila.products pr where pr.shop_id = s.id and pr.active),
      'views', (select coalesce(sum(v.n), 0) from fiila.shop_views v where v.shop_id = s.id),
      'vitrine_orders', (select count(*) from fiila.orders x where x.shop_id = s.id and x.source = 'vitrine' and x.status <> 'cancelled'),
      'multi_photos', (select count(*) from fiila.products pr where pr.shop_id = s.id and pr.active and exists (select 1 from fiila.product_photos ph where ph.product_id = pr.id)),
      'members', (select count(*) from fiila.shop_members m where m.shop_id = s.id) + (select count(*) from fiila.shop_invites si where si.shop_id = s.id and si.used_at is null and si.expires_at > now()),
      'need_address', (select count(*) from fiila.orders x where x.shop_id = s.id and x.status = 'open' and fiila.order_address_state(x) <> 'received'),
      'need_address_order', (select x.id from fiila.orders x where x.shop_id = s.id and x.status = 'open' and fiila.order_address_state(x) <> 'received' order by x.created_at limit 1))$s$);
  if v_new = v_def then raise exception 'retention: fiila_shop_get non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    when 'media_cdn' then array[0, 1] end$s$,
    $s$    when 'media_cdn' then array[0, 1]
    when 'sugg_home_shop' then array[0, 1] when 'sugg_shop_more_products' then array[0, 1] when 'sugg_shop_share_vitrine' then array[0, 1]
    when 'sugg_shop_courier' then array[0, 1] when 'sugg_shop_photos' then array[0, 1] when 'sugg_shop_team' then array[0, 1] end$s$);
  if v_new = v_def then raise exception 'retention: bo_setting_bounds non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'wa_card_media', 'media_cdn']$s$,
    $s$'wa_card_media', 'media_cdn', 'sugg_home_shop', 'sugg_shop_more_products', 'sugg_shop_share_vitrine', 'sugg_shop_courier', 'sugg_shop_photos', 'sugg_shop_team']$s$);
  if v_new = v_def then raise exception 'retention: fiila_bo_settings non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'premium'$s$,
    $s$    or (p_event = 'retention' and p_variant ~ '^(home_shop|shop_more_products|shop_share_vitrine|shop_courier|shop_photos|shop_team):(shown|click|dismiss|used|repeat)$')
    or (p_event = 'order_address' and p_variant in ('shown', 'used'))
    or (p_event = 'premium'$s$);
  if v_new = v_def then raise exception 'retention: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

create or replace function public.fiila_app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nudges', coalesce(fiila.setting_int('nudges'), 1) = 1,
                            'onboarding', coalesce(fiila.setting_int('onboarding_v2'), 1) = 1,
                            'discover', coalesce(fiila.setting_int('discover_after'), 1) = 1,
                            'wa_card', coalesce(fiila.setting_int('wa_card_media'), 1) = 1,
                            'sugg_off', coalesce((select jsonb_agg(k) from unnest(array['home_shop', 'shop_more_products', 'shop_share_vitrine', 'shop_courier', 'shop_photos', 'shop_team']) k
                                                   where coalesce(fiila.setting_int('sugg_' || k), 1) = 0), '[]'::jsonb))
$$;

create or replace function public.fiila_bo_nudges() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('dashboard'); v_today date := (now() at time zone 'utc')::date;
begin
  return jsonb_build_object('on', coalesce(fiila.setting_int('nudges'), 1) = 1,
    -- Ancienne mesure (avant le 22/10) : gardée pour l'historique.
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'shown', shown, 'click', click, 'dismiss', dismiss) order by shown desc) from (
      select split_part(variant, ':', 1) id,
             sum(n) filter (where split_part(variant, ':', 2) = 'shown') shown,
             coalesce(sum(n) filter (where split_part(variant, ':', 2) = 'click'), 0) click,
             coalesce(sum(n) filter (where split_part(variant, ':', 2) = 'dismiss'), 0) dismiss
        from fiila.metrics where event = 'nudge' and day > v_today - 30 group by 1) x where shown > 0), '[]'::jsonb),
    'suggestions', (select jsonb_agg(jsonb_build_object('id', k,
        'on', coalesce(fiila.setting_int('sugg_' || k), 1) = 1,
        'd30', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb) from (select split_part(variant, ':', 2) a, sum(n)::int n from fiila.metrics
                 where event = 'retention' and split_part(variant, ':', 1) = k and day > v_today - 30 group by 1) y),
        'd7', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb) from (select split_part(variant, ':', 2) a, sum(n)::int n from fiila.metrics
                 where event = 'retention' and split_part(variant, ':', 1) = k and day > v_today - 7 group by 1) y)) order by ord)
      from unnest(array['home_shop', 'shop_more_products', 'shop_share_vitrine', 'shop_courier', 'shop_photos', 'shop_team']) with ordinality as t(k, ord)),
    'order_address', jsonb_build_object(
      'shown', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'order_address' and variant = 'shown' and day > v_today - 30),
      'used', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'order_address' and variant = 'used' and day > v_today - 30),
      'received_30', (select count(*)::int from fiila.orders o join fiila.requests q on q.id = o.request_id
                       where o.place_id is not null and q.fulfilled_at >= now() - interval '30 days'),
      'waiting_now', (select count(*)::int from fiila.orders o where o.status = 'open' and fiila.order_address_state(o) <> 'received')));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_shop_get(text)', 'public.fiila_app_flags()', 'public.fiila_bo_settings()', 'public.fiila_track(text, text)', 'public.fiila_bo_nudges()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
