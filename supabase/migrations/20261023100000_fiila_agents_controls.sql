-- Contrôles des Agents avant tout versement (algorithmes v2.1, lot 1 / A3 ; validé par le fondateur le 23/10/2026 04:16).
-- Aucun score, aucun nouveau seuil ; montants, barèmes, délais et conditions inchangés.
-- 1) Journal : un seul mécanisme, le déclencheur bo_audit, complété par l'ancien statut et le motif.
--    Le passage automatique « en vérification → à verser » (30 jours écoulés) n'est pas une décision : il n'est plus journalisé.
-- 2) Transitions des Agents encadrées par le serveur. Un exclu ne sort que par « reinstate » (motif obligatoire) vers « suspendu ».
-- 3) Rétablir un gain annulé : un seul à la fois, avec motif ; même gain, même montant, mêmes dates ; refusé pour un exclu.
-- 4) #34 : « marquer versé » refusé si le numéro de versement n'est pas le numéro du compte confirmé par SMS.
--    Contrôle calculé à chaque fois (fiila.verified_phone) : changer de numéro de versement annule donc la vérification.
-- 5) Historique d'un Agent pour sa fiche du back-office (droit « ambassadors »), sans ouvrir le journal global.

create or replace function fiila.bo_audit_trg() returns trigger
language plpgsql set search_path = '' as $$
declare v_uid uuid := fiila.uid();
begin
  if v_uid is null or fiila.staff_role(v_uid) is null then return null; end if;
  -- Un test par table (PL/pgSQL n'évite pas d'évaluer new.<colonne> d'une autre table dans une même condition).
  if tg_table_name = 'ambassadors' then
    if new.status is distinct from old.status then
      perform fiila.bo_log(case when old.status = 'excluded' then 'ambassador_reinstated' else 'ambassador_' || new.status end, 'ambassador', new.id::text,
        jsonb_strip_nulls(jsonb_build_object('name', new.name, 'from', old.status, 'to', new.status, 'note', new.note)));
    end if;
  elsif tg_table_name = 'ambassador_rewards' then
    if new.status is distinct from old.status and not (old.status = 'pending' and new.status = 'validated') then
      perform fiila.bo_log(case when old.status = 'cancelled' then 'reward_restored' else 'reward_' || new.status end, 'reward', new.id::text,
        jsonb_strip_nulls(jsonb_build_object('amount', new.amount, 'shop', new.shop_name, 'level', new.level, 'ambassador', new.ambassador_id,
          'from', old.status, 'to', new.status, 'reason', case when new.status in ('cancelled') or old.status = 'cancelled' then new.reason end)));
    end if;
  elsif tg_table_name = 'vd_submissions' then
    if new.status is distinct from old.status or new.paid_at is distinct from old.paid_at then
      perform fiila.bo_log(case when new.paid_at is distinct from old.paid_at then 'vd_paid' else 'vd_' || new.status end, 'vide_dressing', new.id::text,
        jsonb_build_object('title', new.title));
    end if;
  elsif tg_table_name = 'comments' then
    if new.hidden is distinct from old.hidden then
      perform fiila.bo_log(case when new.hidden then 'comment_hide' else 'comment_restore' end, 'comment', new.id::text, jsonb_build_object('body', left(new.body, 80)));
    end if;
  end if;
  return null;
end $$;

-- Numéro de versement confirmé : c'est le numéro du compte, vérifié par code SMS.
create or replace function fiila.amb_payout_verified(a fiila.ambassadors) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(fiila.verified_phone(a.user_id) is not null
                  and fiila.phone_key(fiila.verified_phone(a.user_id)) = fiila.phone_key(a.payout_phone), false)
$$;

create or replace function public.fiila_admin_ambassador_decide(p_id text, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors; v_note text := nullif(fiila.clean(p_note, 200), '');
begin
  perform fiila.need_staff('ambassadors');
  select * into a from fiila.ambassadors where id = fiila.as_uuid(p_id) for update;
  if a.id is null then perform fiila.fail('not_found'); end if;
  -- Matrice des transitions : tout ce qui n'est pas listé est refusé.
  if p_decision in ('suspend', 'exclude', 'reinstate') and v_note is null then perform fiila.fail('reason_required'); end if;
  if p_decision = 'approve' then
    if a.status <> 'review' then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'active', approved_at = now(), note = v_note where id = a.id;
  elsif p_decision = 'suspend' then
    if a.status <> 'active' then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'suspended', note = v_note where id = a.id;
  elsif p_decision = 'reactivate' then
    if a.status <> 'suspended' then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'active', note = v_note where id = a.id;
  elsif p_decision = 'exclude' then
    if a.status not in ('training', 'review', 'active', 'suspended') then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'excluded', note = v_note where id = a.id;
    update fiila.ambassador_rewards set status = 'cancelled', reason = v_note
     where ambassador_id = a.id and status in ('pending', 'validated');
  elsif p_decision = 'reinstate' then
    if a.status <> 'excluded' then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'suspended', note = v_note where id = a.id;
  elsif p_decision = 'training' then
    if a.status not in ('review', 'active', 'suspended') then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'training', quiz_score = null, quiz_passed_at = null, approved_at = null, note = v_note where id = a.id;
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
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fiila_admin_reward(p_ids jsonb, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int; v_ids uuid[]; r fiila.ambassador_rewards; a fiila.ambassadors; v_reason text := nullif(fiila.clean(p_reason, 200), '');
begin
  perform fiila.need_staff('ambassadors');
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then perform fiila.fail('invalid_payload'); end if;
  select coalesce(array_agg(fiila.as_uuid(x)), '{}') into v_ids from jsonb_array_elements_text(p_ids) x;
  if p_action = 'paid' then
    -- #34 : jamais de versement vers un numéro non confirmé par code SMS.
    if exists (select 1 from fiila.ambassador_rewards x join fiila.ambassadors y on y.id = x.ambassador_id
                where x.id = any (v_ids) and x.status = 'validated' and not fiila.amb_payout_verified(y)) then
      perform fiila.fail('payout_unverified');
    end if;
    update fiila.ambassador_rewards set status = 'paid', paid_at = now() where id = any (v_ids) and status = 'validated';
  elsif p_action = 'cancel' then
    if v_reason is null then perform fiila.fail('reason_required'); end if;
    update fiila.ambassador_rewards set status = 'cancelled', reason = v_reason where id = any (v_ids) and status in ('pending', 'validated');
  elsif p_action = 'restore' then
    -- Un gain à la fois, avec motif ; même gain, même montant, mêmes dates. Répéter n'a aucun effet.
    if v_reason is null then perform fiila.fail('reason_required'); end if;
    if cardinality(v_ids) <> 1 then perform fiila.fail('invalid_payload'); end if;
    select * into r from fiila.ambassador_rewards where id = v_ids[1] for update;
    if r.id is null then perform fiila.fail('not_found'); end if;
    select * into a from fiila.ambassadors where id = r.ambassador_id;
    if a.status = 'excluded' then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassador_rewards set status = case when validate_after <= now() then 'validated' else 'pending' end, reason = v_reason
     where id = r.id and status = 'cancelled';
  else perform fiila.fail('invalid_payload');
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $$;

-- Historique d'un Agent (sa fiche) : décisions sur son profil et sur ses gains, plus les gains annulés à rétablir.
create or replace function public.fiila_bo_ambassador_history(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.need_staff('ambassadors');
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'actor', l.actor, 'action', l.action, 'detail', l.detail) order by l.at desc)
      from (select * from fiila.admin_log l
             where (l.target_type = 'ambassador' and l.target_id = p_id::text)
                or (l.target_type = 'reward' and l.target_id in (select id::text from fiila.ambassador_rewards where ambassador_id = p_id))
             order by l.at desc limit 100) l), '[]'::jsonb),
    'cancelled', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'shop', r.shop_name, 'level', r.level, 'amount', r.amount,
        'reason', r.reason, 'earned_at', r.earned_at, 'validate_after', r.validate_after) order by r.earned_at desc)
      from fiila.ambassador_rewards r where r.ambassador_id = p_id and r.status = 'cancelled'), '[]'::jsonb));
end $$;

-- L'agent et le back-office voient si le numéro de versement est confirmé.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('fiila.amb_json(fiila.ambassadors)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'payout_phone', a.payout_phone, 'quiz_score'$s$, $s$'payout_phone', a.payout_phone, 'payout_verified', fiila.amb_payout_verified(a), 'quiz_score'$s$);
  if v_new = v_def then raise exception 'agents_controls: amb_json non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_admin_ambassadors()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'payout_method', a.payout_method, 'payout_phone', a.payout_phone, 'note', a.note,$s$,
    $s$'payout_method', a.payout_method, 'payout_phone', a.payout_phone, 'payout_verified', fiila.amb_payout_verified(a), 'note', a.note,$s$);
  v_new := replace(v_new, $s$'payout_phone', a.payout_phone, 'shop', r.shop_name,$s$,
    $s$'payout_phone', a.payout_phone, 'payout_verified', fiila.amb_payout_verified(a), 'shop', r.shop_name,$s$);
  if position($s$'payout_verified', fiila.amb_payout_verified(a), 'note'$s$ in v_new) = 0
     or position($s$'payout_verified', fiila.amb_payout_verified(a), 'shop'$s$ in v_new) = 0 then
    raise exception 'agents_controls: fiila_admin_ambassadors non modifiée';
  end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_admin_ambassador_decide(text, text, text)', 'public.fiila_admin_reward(jsonb, text, text)',
                      'public.fiila_bo_ambassador_history(uuid)', 'public.fiila_admin_ambassadors()'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
