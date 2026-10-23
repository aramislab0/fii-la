-- Aide de complétude d'une adresse (algorithmes v2.1, A1 réduit ; validé par le fondateur le 23/10/2026 04:16).
-- Deux suggestions du moteur de rétention, sur la page de gestion de l'adresse : addr_photo, addr_mark (repère écrit OU vocal).
-- La troisième prévue (arrêt voiture) n'est pas construite : le formulaire impose déjà « accessible en voiture » ou un arrêt.
-- Aucune note, aucune certification, aucune lecture de la précision GPS ni des notes de livraison. Rien côté serveur sur
-- l'adresse : seuls des compteurs anonymes retention × addr_* × (shown, click, dismiss, used, repeat), sans identifiant.
-- Un interrupteur par suggestion (sugg_addr_photo, sugg_addr_mark), dans le panneau Suggestions du back-office.

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('fiila.bo_setting_bounds(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$when 'adaptive_home' then array[0, 1] end$s$, $s$when 'adaptive_home' then array[0, 1]
    when 'sugg_addr_photo' then array[0, 1] when 'sugg_addr_mark' then array[0, 1] end$s$);
  if v_new = v_def then raise exception 'addr_sugg: bo_setting_bounds non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'adaptive_home']$s$, $s$'adaptive_home', 'sugg_addr_photo', 'sugg_addr_mark']$s$);
  if v_new = v_def then raise exception 'addr_sugg: fiila_bo_settings non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'^(home_shop|shop_more_products|shop_share_vitrine|shop_courier|shop_photos|shop_team):$s$,
    $s$'^(home_shop|shop_more_products|shop_share_vitrine|shop_courier|shop_photos|shop_team|addr_photo|addr_mark):$s$);
  if v_new = v_def then raise exception 'addr_sugg: fiila_track non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_bo_nudges()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$array['home_shop', 'shop_more_products', 'shop_share_vitrine', 'shop_courier', 'shop_photos', 'shop_team']) with ordinality$s$,
    $s$array['home_shop', 'shop_more_products', 'shop_share_vitrine', 'shop_courier', 'shop_photos', 'shop_team', 'addr_photo', 'addr_mark']) with ordinality$s$);
  if v_new = v_def then raise exception 'addr_sugg: fiila_bo_nudges non modifiée'; end if;
  execute v_new;
end $$;

create or replace function public.fiila_app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nudges', coalesce(fiila.setting_int('nudges'), 1) = 1,
                            'onboarding', coalesce(fiila.setting_int('onboarding_v2'), 1) = 1,
                            'discover', coalesce(fiila.setting_int('discover_after'), 1) = 1,
                            'wa_card', coalesce(fiila.setting_int('wa_card_media'), 1) = 1,
                            'adaptive', coalesce(fiila.setting_int('adaptive_home'), 1) = 1,
                            'sugg_off', coalesce((select jsonb_agg(k) from unnest(array['home_shop', 'shop_more_products', 'shop_share_vitrine', 'shop_courier', 'shop_photos', 'shop_team', 'addr_photo', 'addr_mark']) k
                                                   where coalesce(fiila.setting_int('sugg_' || k), 1) = 0), '[]'::jsonb))
$$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_app_flags()', 'public.fiila_bo_settings()', 'public.fiila_track(text, text)', 'public.fiila_bo_nudges()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
