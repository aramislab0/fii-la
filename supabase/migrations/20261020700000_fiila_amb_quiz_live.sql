-- Fii La Carrière : test de passage question par question, avec la correction tout de suite (fondateur, 20/10/2026 04:28 :
-- « des questionnaires dynamiques, inspire-toi de Duolingo sans les copier »).
--
-- La réponse à chaque question est enregistrée côté serveur dès qu'elle est donnée, puis verrouillée : voir la correction
-- n'améliore pas le score de l'essai en cours. Le score final reste calculé par le serveur ; 2 essais terminés par 24 heures.
-- Back-office (règle n° 8) : taux d'erreur par question, pour améliorer la formation là où elle n'est pas comprise.

create table fiila.ambassador_quiz_runs (
  id            uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references fiila.ambassadors (id) on delete cascade,
  answers       smallint[] not null default array_fill(null::smallint, array[10]),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  score         smallint
);
create index ambassador_quiz_runs_amb on fiila.ambassador_quiz_runs (ambassador_id, started_at);
revoke all on fiila.ambassador_quiz_runs from public;

create or replace function fiila.amb_quiz_key() returns int[]
language sql immutable set search_path = '' as $$ select array[1, 1, 0, 1, 0, 1, 1, 1, 1, 0] $$;

-- L'explication montrée après chaque réponse (bonne ou non) : la règle, en une phrase.
create or replace function fiila.amb_quiz_why(p_q int) returns text
language sql immutable set search_path = '' as $$
  select (array[
    'Vous êtes payé quand le commerçant atteint un niveau vérifié par Fii La, jamais pour une simple inscription.',
    'Niveau 1 : 5 articles avec photo, le type de commerce et la vitrine ouverte.',
    'Niveau 2 : 3 commandes de 3 clientes différentes, dont 1 livrée, en 30 jours.',
    'Jamais : vos commandes ou celles de vos proches ne comptent pas, et c’est un motif d’exclusion.',
    'Le commerçant tape votre code dans « Code ambassadeur », en créant sa boutique, sur son propre téléphone.',
    'Une bonne photo : l’article seul, à la lumière du jour, sur un fond simple.',
    'Promettez seulement ce que Fii La offre vraiment : boutique, vitrine et adresses gratuites. Jamais de ventes ni d’argent.',
    'Les gains sont vérifiés pendant 30 jours, puis versés une fois par mois.',
    'Les numéros des clientes restent confidentiels : vous ne les copiez jamais.',
    'Vous gardez les niveaux déjà validés ; les suivants ne comptent plus si le commerçant arrête.'])[p_q + 1]
$$;

-- Démarre un essai (ou reprend celui en cours depuis moins de 3 heures).
create or replace function public.fiila_ambassador_quiz_start() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); r fiila.ambassador_quiz_runs; v_key int[] := fiila.amb_quiz_key();
begin
  if a.id is null then perform fiila.fail('not_found'); end if;
  if a.status <> 'training' or a.quiz_passed_at is not null then perform fiila.fail('quiz_done'); end if;
  perform fiila.rate_check('amb_quiz_start', 30);
  select * into r from fiila.ambassador_quiz_runs where ambassador_id = a.id and finished_at is null and started_at > now() - interval '3 hours'
   order by started_at desc limit 1;
  if r.id is null then
    -- 2 essais par 24 heures : un essai commencé compte (sinon on verrait les corrections sans consommer d'essai).
    if (select count(*) from fiila.ambassador_quiz where ambassador_id = a.id and at > now() - interval '24 hours') >= 2
       or (select count(*) from fiila.ambassador_quiz_runs where ambassador_id = a.id and started_at > now() - interval '24 hours') >= 2 then
      perform fiila.fail('quiz_wait'); end if;
    insert into fiila.ambassador_quiz_runs (ambassador_id) values (a.id) returning * into r;
  end if;
  return jsonb_build_object('run', r.id,
    'answered', coalesce((select jsonb_agg(jsonb_build_object('q', i - 1, 'answer', r.answers[i], 'correct', r.answers[i] = v_key[i], 'right', v_key[i],
        'why', fiila.amb_quiz_why(i - 1)) order by i)
      from generate_subscripts(r.answers, 1) i where r.answers[i] is not null), '[]'::jsonb),
    'attempts_today', (select count(*) from fiila.ambassador_quiz where ambassador_id = a.id and at > now() - interval '24 hours'));
end $$;

-- Réponse à une question : enregistrée une seule fois (la première), puis la correction. À la 10e : score et résultat.
create or replace function public.fiila_ambassador_quiz_answer(p_run uuid, p_q int, p_answer int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); r fiila.ambassador_quiz_runs; v_key int[] := fiila.amb_quiz_key(); v_ans int; v_score int; v jsonb;
begin
  if a.id is null then perform fiila.fail('not_found'); end if;
  perform fiila.rate_check('amb_quiz_answer', 300);
  if p_q is null or p_q < 0 or p_q > 9 or p_answer is null or p_answer < 0 or p_answer > 3 then perform fiila.fail('invalid_payload'); end if;
  select * into r from fiila.ambassador_quiz_runs where id = p_run and ambassador_id = a.id for update;
  if r.id is null then perform fiila.fail('not_found'); end if;
  if r.finished_at is not null then perform fiila.fail('quiz_done'); end if;
  if r.answers[p_q + 1] is null then
    r.answers[p_q + 1] := p_answer;
    update fiila.ambassador_quiz_runs set answers = r.answers where id = r.id;
  end if;
  v_ans := r.answers[p_q + 1];
  v := jsonb_build_object('q', p_q, 'answer', v_ans, 'correct', v_ans = v_key[p_q + 1], 'right', v_key[p_q + 1], 'why', fiila.amb_quiz_why(p_q));
  if not exists (select 1 from unnest(r.answers) x where x is null) then
    select count(*) into v_score from generate_subscripts(r.answers, 1) i where r.answers[i] = v_key[i];
    update fiila.ambassador_quiz_runs set finished_at = now(), score = v_score where id = r.id;
    insert into fiila.ambassador_quiz (ambassador_id, score) values (a.id, v_score);
    update fiila.ambassadors set quiz_score = v_score,
      quiz_passed_at = case when v_score >= 8 then now() end,
      status = case when v_score >= 8 then 'review' else status end
     where id = a.id and status = 'training';
    v := v || jsonb_build_object('done', true, 'score', v_score, 'passed', v_score >= 8);
  end if;
  return v;
end $$;

-- Back-office : taux d'erreur par question (essais terminés).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_admin_ambassadors()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'settings', jsonb_build_object('rewards',$s$, $s$    'quiz_stats', (select coalesce(jsonb_agg(jsonb_build_object('q', q - 1,
        'answered', (select count(*) from fiila.ambassador_quiz_runs r where r.finished_at is not null),
        'wrong', (select count(*) from fiila.ambassador_quiz_runs r where r.finished_at is not null and r.answers[q] is distinct from (fiila.amb_quiz_key())[q]))
        order by q), '[]'::jsonb) from generate_series(1, 10) q),
    'settings', jsonb_build_object('rewards',$s$);
  if v_new = v_def then raise exception 'amb_quiz_live: fiila_admin_ambassadors non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_ambassador_quiz_start()', 'public.fiila_ambassador_quiz_answer(uuid, integer, integer)', 'public.fiila_admin_ambassadors()'];
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
