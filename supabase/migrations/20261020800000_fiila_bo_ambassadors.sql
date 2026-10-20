-- Back-office, rubrique Ambassadeurs (fondateur, 20/10/2026 05:12 : « je n'arrive pas à effacer mon profil dans le back-office,
-- je ne vois que suspendre ») :
--  - « Supprimer le profil » : efface l'ambassadeur (tests, liens commerçants, gains non versés). Refusé s'il a déjà reçu un
--    versement (la trace financière reste : on l'exclut à la place). Geste sensible : connexion récente exigée ; tracé au journal.
--  - « Renvoyer en formation » : le profil repasse la formation et le test (score effacé).
--  - La liste donne ce qu'il faut pour une fiche complète : e-mail du compte, dates, gains par état, essais du test.

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_admin_ambassador_decide(text, text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$  else perform fiila.fail('invalid_payload');
  end if;
  return jsonb_build_object('ok', true);$s$, $s$  elsif p_decision = 'training' then
    if a.status not in ('review', 'active', 'suspended') then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'training', quiz_score = null, quiz_passed_at = null, approved_at = null, note = fiila.clean(p_note, 200) where id = a.id;
    delete from fiila.ambassador_quiz where ambassador_id = a.id;
    delete from fiila.ambassador_quiz_runs where ambassador_id = a.id;
  elsif p_decision = 'delete' then
    if not fiila.recent_login() then perform fiila.fail('reauth_required'); end if;
    if exists (select 1 from fiila.ambassador_rewards where ambassador_id = a.id and status = 'paid') then perform fiila.fail('ambassador_has_payouts'); end if;
    perform fiila.bo_log('ambassador_deleted', 'ambassador', a.id::text, jsonb_build_object('name', a.name, 'code', a.code));
    delete from fiila.ambassadors where id = a.id;
    return jsonb_build_object('ok', true, 'deleted', true);
  else perform fiila.fail('invalid_payload');
  end if;
  return jsonb_build_object('ok', true);$s$);
  if v_new = v_def then raise exception 'bo_ambassadors: fiila_admin_ambassador_decide non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_admin_ambassadors()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$        'cancelled', (select count(*) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status = 'cancelled')))$s$,
    $s$        'cancelled', (select count(*) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status = 'cancelled'),
        'email', (select u.email from auth.users u where u.id = a.user_id),
        'approved_at', a.approved_at,
        'active_shops', (select count(*) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.level = 2 and r.status <> 'cancelled'),
        'earned', (select coalesce(sum(amount), 0) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status in ('pending', 'validated', 'paid')),
        'paid', (select coalesce(sum(amount), 0) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status = 'paid'),
        'attempts', (select count(*) from fiila.ambassador_quiz q where q.ambassador_id = a.id)))$s$);
  if v_new = v_def then raise exception 'bo_ambassadors: fiila_admin_ambassadors non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_admin_ambassador_decide(text, text, text)', 'public.fiila_admin_ambassadors()'];
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
