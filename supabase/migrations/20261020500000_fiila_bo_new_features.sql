-- Fii La : back-office mis à jour avec les fonctions du 19-20/10/2026 (fondateur, 20/10 02:16 : « met à jour le back-office
-- par rapport aux nouvelles fonctionnalités, et que ça devienne une habitude »).
--   équipe de boutique : membres (rôle, numéro confirmé) et invitations en attente sur la fiche boutique ; retrait d'un
--                        membre par l'équipe Fii La (droit shops_write, tracé au journal) ;
--   numéros confirmés par SMS : sur la fiche compte, avec la boutique dont le compte est membre ;
--   photos d'articles : articles à plusieurs photos sur la fiche boutique ;
--   tableau de bord : membres d'équipe, numéros confirmés, articles à plusieurs photos.
-- Les fonctions existantes sont complétées sur place (texte inséré, vérifié), sans être recopiées.

create or replace function fiila.bo_shop_team(p_shop uuid, p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.user_id, 'role', m.role,
        'name', coalesce(m.name, pr.display_name, split_part(u.email, '@', 1)),
        'email', case when fiila.staff_can(p_uid, 'accounts') then u.email end,
        'verified', case when fiila.verified_phone(m.user_id) is not null and fiila.phone_key(fiila.verified_phone(m.user_id)) = fiila.phone_key(m.phone) then true end,
        'since', m.created_at)) order by m.created_at)
      from fiila.shop_members m join auth.users u on u.id = m.user_id left join fiila.profiles pr on pr.user_id = m.user_id
      where m.shop_id = p_shop), '[]'::jsonb),
    'invites', (select nullif(count(*), 0) from fiila.shop_invites i where i.shop_id = p_shop and i.used_at is null and i.expires_at > now())))
$$;

do $$
declare v_def text; v_new text;
begin
  -- fiche boutique : équipe et articles à plusieurs photos
  select pg_get_functiondef('public.fiila_bo_shop(uuid)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'ambassador', (select a.name$s$, $s$    'team', fiila.bo_shop_team(s.id, v_uid),
    'ambassador', (select a.name$s$);
  v_new := replace(v_new, $s$      'products', (select count(*) from fiila.products p where p.shop_id = s.id and p.active),$s$,
    $s$      'products', (select count(*) from fiila.products p where p.shop_id = s.id and p.active),
      'multi_photos', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and exists (select 1 from fiila.product_photos x where x.product_id = p.id)),$s$);
  if v_new = v_def or position('multi_photos' in v_new) = 0 then raise exception 'bo_new_features: fiila_bo_shop non modifiée'; end if;
  execute v_new;

  -- action : retirer un membre de l'équipe d'une boutique (p_value = identifiant du compte)
  select pg_get_functiondef('public.fiila_bo_shop_action(uuid, text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$  else
    perform fiila.fail('invalid_action');$s$, $s$  elsif p_action = 'member_remove' then
    -- le journal garde le nom du membre retiré (pas son identifiant)
    delete from fiila.shop_members where shop_id = p_id and user_id = fiila.as_uuid(v_val) returning coalesce(name, 'membre') into v_val;
    if v_val is null then perform fiila.fail('not_found'); end if;
  else
    perform fiila.fail('invalid_action');$s$);
  if v_new = v_def then raise exception 'bo_new_features: fiila_bo_shop_action non modifiée'; end if;
  execute v_new;

  -- fiche compte : numéro confirmé, boutique dont le compte est membre
  select pg_get_functiondef('public.fiila_bo_account(uuid)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'role', fiila.staff_role(p_id),$s$, $s$    'role', fiila.staff_role(p_id),
    'phone_verified', fiila.verified_phone(p_id),
    'member_of', (select jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role) from fiila.shop_members m join fiila.shops s on s.id = m.shop_id where m.user_id = p_id),$s$);
  if v_new = v_def then raise exception 'bo_new_features: fiila_bo_account non modifiée'; end if;
  execute v_new;

  -- tableau de bord
  select pg_get_functiondef('public.fiila_bo_overview()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$      'couriers', (select count(*) from fiila.couriers),$s$, $s$      'couriers', (select count(*) from fiila.couriers),
      'shop_members', (select count(*) from fiila.shop_members),
      'phones_verified', (select count(*) from auth.users where phone_confirmed_at is not null),
      'multi_photos', (select count(*) from fiila.products p where p.active and exists (select 1 from fiila.product_photos x where x.product_id = p.id)),$s$);
  if v_new = v_def then raise exception 'bo_new_features: fiila_bo_overview non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_bo_shop(uuid)', 'public.fiila_bo_shop_action(uuid, text, text)', 'public.fiila_bo_account(uuid)', 'public.fiila_bo_overview()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('grant execute on function %s to %I', fn, role_name);
      end if;
    end loop;
  end loop;
end $$;
