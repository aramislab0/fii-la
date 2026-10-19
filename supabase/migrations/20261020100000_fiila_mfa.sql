-- Fii La : double authentification obligatoire pour l'équipe du back-office (fondateur, 19/10/2026 14:09 : « oui »).
--
-- Supabase Auth porte dans chaque jeton le niveau de la session (`aal`) : aal1 après le mot de passe, aal2 après le code à
-- 6 chiffres de l'application d'authentification (TOTP). Toute action du back-office exige désormais aal2, pour tous les rôles :
-- un mot de passe volé ne suffit plus. Le portail sait qu'un membre doit d'abord activer ou saisir son code (fiila_bo_me.mfa).
-- Téléphone perdu : le super admin retire le facteur du membre dans le tableau de bord Supabase (Authentication → Users),
-- puis le membre en active un nouveau à sa prochaine connexion (docs/BACK-OFFICE.md).

create or replace function fiila.aal() returns text
language plpgsql stable set search_path = '' as $$
declare v jsonb;
begin
  begin
    v := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return v ->> 'aal';
end $$;

-- Un droit du back-office n'existe qu'avec une session vérifiée par le code (aal2).
create or replace function fiila.staff_can(p_uid uuid, p_perm text) returns boolean
language sql stable set search_path = '' as $$
  select p_uid is not null and coalesce(p_perm = any (fiila.staff_perms(fiila.staff_role(p_uid))), false)
     and fiila.aal() is not distinct from 'aal2'
$$;

create or replace function fiila.need_staff(p_perm text) returns uuid
language plpgsql set search_path = '' as $$
declare v_uid uuid := fiila.need_uid();
begin
  if fiila.staff_role(v_uid) is not null and fiila.aal() is distinct from 'aal2' then perform fiila.fail('mfa_required'); end if;
  if not fiila.staff_can(v_uid, p_perm) then perform fiila.fail('not_allowed'); end if;
  return v_uid;
end $$;

-- Portail : indique si la session de ce membre a passé le code (sinon : activer ou saisir le code avant d'entrer).
create or replace function public.fiila_bo_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); v_role text;
begin
  if v_uid is null then return jsonb_build_object('staff', false, 'auth', false); end if;
  v_role := fiila.staff_role(v_uid);
  if v_role is null then return jsonb_build_object('staff', false, 'auth', true); end if;
  if fiila.aal() is distinct from 'aal2' then
    return jsonb_build_object('staff', true, 'auth', true, 'mfa', false, 'role', v_role,
      'email', (select email from auth.users where id = v_uid));
  end if;
  update fiila.staff set last_seen_at = now() where user_id = v_uid and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  return jsonb_build_object('staff', true, 'auth', true, 'mfa', true, 'role', v_role, 'perms', to_jsonb(fiila.staff_perms(v_role)),
    'name', (select display_name from fiila.profiles where user_id = v_uid),
    'email', (select email from auth.users where id = v_uid));
end $$;

-- Les fonctions d'administration qui testent un droit directement renvoient aussi « code requis » (et non « non autorisé »)
-- quand la session n'a pas passé le code : message juste dans le portail.
do $$
declare r record; v_def text; v_new text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fiila_%' and p.prosrc like '%if not %fiila.staff_can(v_uid, %then perform fiila.fail(''not_allowed''); end if;%' loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, '(\n\s*)(if not \(?fiila\.staff_can\(v_uid, )',
      E'\\1if fiila.staff_role(v_uid) is not null and fiila.aal() is distinct from ''aal2'' then perform fiila.fail(''mfa_required''); end if;\\1\\2', 'g');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end $$;
