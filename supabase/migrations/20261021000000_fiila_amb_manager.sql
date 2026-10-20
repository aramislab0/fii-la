-- Fii La Carrière : le Manager (fondateur, 20/10/2026 06:59 : « un agent Manager principal de Fii La Carrière ; il gère les agents,
-- leur onboarding, leurs formations et leurs missions au quotidien, suit les objectifs, discute avec chaque agent, analyse les
-- retours, apprend et oriente dans le sens de la stratégie ; il est sous la tutelle du Head of Stratégie et Développement ;
-- il crée et définit les missions et formations, assure le suivi et les améliorations »).
--
-- Ce que fait la base (toujours, même sans modèle d'IA) :
--   - objectifs du mois fixés par le Head of Stratégie et Développement (nouveau rôle d'équipe « strategy ») ;
--   - missions du jour de chaque ambassadeur, calculées chaque jour (commerçants à faire progresser, objectif du mois, formation) ;
--   - conversation ambassadeur ↔ Manager : chaque message est classé (question, objection, problème, idée…), le Manager répond
--     selon les règles du programme ; un problème remonte à l'équipe ;
--   - analyse quotidienne : propositions d'amélioration (formation, missions) soumises au Head of Stratégie, jamais appliquées seules.
-- Avec un modèle d'IA (réglage amb_manager_llm = 1 et clé saisie par le fondateur dans Supabase) : la fonction fiila-manager
-- rédige les réponses et l'analyse ; mêmes garde-fous (jamais de promesse d'argent, jamais de décision sur un gain ou un statut).

-- ---------------------------------------------------------------- rôle « Head of Stratégie et Développement »
alter table fiila.staff drop constraint if exists staff_role_check;
alter table fiila.staff add constraint staff_role_check check (role in ('super_admin', 'operations', 'moderation', 'support', 'finance', 'strategy'));
alter table fiila.staff_invites drop constraint if exists staff_invites_role_check;
alter table fiila.staff_invites add constraint staff_invites_role_check check (role in ('super_admin', 'operations', 'moderation', 'support', 'finance', 'strategy'));

create or replace function fiila.staff_perms(p_role text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_role
    when 'super_admin' then array['dashboard', 'shops', 'shops_write', 'shops_suspend', 'orders', 'accounts', 'feed', 'moderation', 'vide_dressing',
                                  'ambassadors', 'finance', 'settings', 'team', 'audit', 'strategy']
    when 'operations'  then array['dashboard', 'shops', 'shops_write', 'shops_suspend', 'orders', 'accounts', 'feed', 'moderation', 'vide_dressing', 'ambassadors', 'finance']
    when 'moderation'  then array['dashboard', 'shops', 'shops_suspend', 'moderation', 'vide_dressing']
    when 'support'     then array['dashboard', 'shops', 'orders', 'accounts']
    when 'finance'     then array['dashboard', 'orders', 'finance', 'ambassadors']
    when 'strategy'    then array['dashboard', 'shops', 'ambassadors', 'strategy']
    else array[]::text[] end
$$;

do $$
declare v_def text; v_new text; v_sig text;
begin
  foreach v_sig in array array['public.fiila_bo_invite(text, text)', 'public.fiila_bo_staff_set(uuid, text)'] loop
    select pg_get_functiondef(v_sig::regprocedure) into v_def;
    v_new := replace(v_def, $s$('super_admin', 'operations', 'moderation', 'support', 'finance')$s$, $s$('super_admin', 'operations', 'moderation', 'support', 'finance', 'strategy')$s$);
    if v_new = v_def then raise exception 'amb_manager: % non modifiée', v_sig; end if;
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------- réglages
insert into fiila.settings (key, value) values ('amb_manager_llm', '0'), ('nudges', '1') on conflict (key) do nothing;
create or replace function fiila.bo_setting_bounds(p_key text) returns int[]
language sql immutable set search_path = '' as $$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1]
    when 'amb_manager_llm' then array[0, 1]
    when 'nudges' then array[0, 1] end
$$;
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'amb_monthly_cap', 'sms_verify']$s$, $s$'amb_monthly_cap', 'sms_verify', 'amb_manager_llm', 'nudges']$s$);
  if v_new = v_def then raise exception 'amb_manager: fiila_bo_settings non modifiée'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------- tables
-- Objectifs du mois (le dernier enregistré pour le mois en cours fait foi).
create table fiila.amb_objectives (
  id             uuid primary key default gen_random_uuid(),
  month          date not null,
  target_active  int not null default 0 check (target_active between 0 and 100000),   -- commerçants actifs (niveau 2) visés ce mois
  target_new     int not null default 0 check (target_new between 0 and 100000),      -- nouveaux commerçants installés visés
  focus_types    text[] not null default '{}',
  focus_zones    text[] not null default '{}',
  brief          text,                                                                  -- le cap, en une ou deux phrases, lu par chaque ambassadeur
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index amb_objectives_month on fiila.amb_objectives (month, created_at desc);

-- Catalogue des missions : proposées par le Manager ou écrites par l'équipe ; actives seulement après validation.
create table fiila.amb_missions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('daily', 'training')),
  title       text not null,
  body        text,
  audience    text not null default 'active' check (audience in ('all', 'training', 'active')),
  status      text not null default 'active' check (status in ('proposed', 'active', 'retired')),
  source      text not null default 'staff' check (source in ('staff', 'manager')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Missions du jour d'un ambassadeur.
create table fiila.amb_tasks (
  id            uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references fiila.ambassadors (id) on delete cascade,
  day           date not null,
  kind          text not null check (kind in ('shop', 'prospect', 'training', 'catalog', 'setup')),
  title         text not null,
  body          text,
  mission_id    uuid references fiila.amb_missions (id) on delete set null,
  done_at       timestamptz,
  feedback      text,
  created_at    timestamptz not null default now()
);
create index amb_tasks_amb_day on fiila.amb_tasks (ambassador_id, day);
create index amb_tasks_mission on fiila.amb_tasks (mission_id);

-- Conversation ambassadeur ↔ Manager (et équipe).
create table fiila.amb_messages (
  id            uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references fiila.ambassadors (id) on delete cascade,
  author        text not null check (author in ('agent', 'manager', 'staff')),
  body          text not null,
  tags          text[] not null default '{}',
  escalate      boolean not null default false,
  answered      boolean not null default false,        -- message d'agent : réponse donnée
  seen_at       timestamptz,                           -- message du Manager ou de l'équipe : lu par l'agent
  staff_seen_at timestamptz,                           -- message d'agent : lu par l'équipe
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index amb_messages_amb on fiila.amb_messages (ambassador_id, created_at);
create index amb_messages_created_by on fiila.amb_messages (created_by);

-- Analyses et propositions du Manager, soumises au Head of Stratégie et Développement.
create table fiila.amb_notes (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('report', 'insight', 'training', 'mission')),
  title       text not null,
  body        text,
  data        jsonb not null default '{}',
  status      text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'info')),
  decided_by  uuid references auth.users (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index amb_notes_status on fiila.amb_notes (status, created_at desc);

create index amb_objectives_by on fiila.amb_objectives (created_by);
create index amb_missions_by on fiila.amb_missions (created_by);
create index amb_notes_by on fiila.amb_notes (decided_by);
revoke all on fiila.amb_objectives, fiila.amb_missions, fiila.amb_tasks, fiila.amb_messages, fiila.amb_notes from public;

-- Missions de départ (écrites par l'équipe, modifiables dans le back-office).
insert into fiila.amb_missions (kind, title, body, audience) values
  ('daily', 'Faire le tour de 3 commerces de votre quartier', 'Présentez Fii La en une phrase, laissez votre code à ceux qui sont intéressés.', 'active'),
  ('daily', 'Partager une vitrine de vos commerçants', 'Envoyez le lien de la vitrine d’un de vos commerçants dans votre statut WhatsApp.', 'active'),
  ('training', 'Relire la fiche « Ce qui ne se fait jamais »', 'Deux minutes pour garder les règles en tête avant vos visites.', 'all');

-- ---------------------------------------------------------------- le Manager : outils
create or replace function fiila.amb_objective() returns fiila.amb_objectives
language sql stable set search_path = '' as $$
  select * from fiila.amb_objectives where month = date_trunc('month', now())::date order by created_at desc limit 1
$$;

create or replace function fiila.amb_say(p_amb uuid, p_body text, p_tags text[] default '{}') returns void
language sql set search_path = '' as $$
  insert into fiila.amb_messages (ambassador_id, author, body, tags) values (p_amb, 'manager', p_body, coalesce(p_tags, '{}'))
$$;

-- Classement d'un message d'ambassadeur (mots-clés ; l'IA, si elle est activée, affine).
create or replace function fiila.amb_tags(p_body text) returns text[]
language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when b ~ '(bug|marche pas|fonctionne pas|erreur|plante|bloqu|impossible|probl)' then 'probleme' end,
    case when b ~ '(refus|pas int[eé]ress|veut pas|veulent pas|m[eé]fian|pas confiance|trop cher|pas le temps|d[eé]j[aà] (sur|un|une))' then 'objection' end,
    case when b ~ '(gain|argent|pay|vers|wave|orange|fcfa|combien)' then 'gains' end,
    case when b ~ '(id[eé]e|propos|sugg|on pourrait|il faudrait)' then 'idee' end,
    case when b ~ '(merci|super|top|bravo|g[eé]nial|content)' then 'positif' end,
    case when b ~ '\?' or b ~ '^(comment|pourquoi|quand|o[uù]|est-ce|qui|quel)' then 'question' end], null)
  from (select lower(coalesce(p_body, '')) b) x
$$;

-- Réponse du Manager sans IA : claire, utile, fidèle aux règles ; un problème ou une objection remonte à l'équipe.
create or replace function fiila.amb_rule_reply(a fiila.ambassadors, p_body text, p_tags text[]) returns text
language plpgsql set search_path = '' as $$
declare b text := lower(coalesce(p_body, '')); t fiila.amb_tasks; o fiila.amb_objectives := fiila.amb_objective(); v text;
begin
  select * into t from fiila.amb_tasks where ambassador_id = a.id and day = (now() at time zone 'utc')::date and done_at is null order by created_at limit 1;
  if 'probleme' = any (p_tags) then
    v := 'Merci de me l’avoir signalé. Je transmets tout de suite à l’équipe Fii La, qui revient vers vous ici. Si vous pouvez, dites-moi sur quel écran et ce que vous avez touché juste avant.';
  elsif 'objection' = any (p_tags) then
    v := 'C’est normal d’entendre ça au début. Ce qui convainc le plus : montrer une vraie vitrine sur votre téléphone, rappeler que c’est gratuit et que ses clientes donnent leur adresse exacte en une photo. Ne promettez jamais de ventes. Je note cette objection pour l’équipe : elle nous aide à améliorer la formation.';
  elsif 'gains' = any (p_tags) then
    v := 'Vous êtes payé quand un commerçant atteint un niveau vérifié : ' || fiila.setting_int('amb_reward_1') || ' FCFA au niveau 1, ' || fiila.setting_int('amb_reward_2') || ' au niveau 2, ' || fiila.setting_int('amb_reward_3') || ' au niveau 3. Chaque gain est vérifié 30 jours, puis versé une fois par mois sur votre numéro de versement.';
  elsif b ~ 'code' then
    v := 'Votre code est ' || a.code || '. Le commerçant le tape dans « Code ambassadeur » en créant sa boutique, sur son propre téléphone, au plus tard 7 jours après.';
  elsif b ~ '(photo|image)' then
    v := 'Une bonne photo : l’article seul, à la lumière du jour, sur un fond simple. L’application la recadre au bon format. 5 articles avec photo, c’est le début du niveau 1.';
  elsif b ~ '(niveau|level)' then
    v := 'Niveau 1 : type de commerce, 5 articles avec photo et vitrine ouverte. Niveau 2 : 3 clientes différentes dont 1 commande livrée en 30 jours. Niveau 3 : des commandes 4 semaines sur 8 après 60 jours.';
  elsif 'idee' = any (p_tags) then
    v := 'Merci, c’est noté. Je fais remonter votre idée à l’équipe stratégie ; les meilleures deviennent des missions.';
  elsif 'positif' = any (p_tags) then
    v := 'Merci ! Continuez comme ça.' || case when t.id is not null then ' Prochaine étape aujourd’hui : ' || t.title || '.' else '' end;
  else
    v := 'Bien reçu.' || case when t.id is not null then ' Votre priorité aujourd’hui : ' || t.title || '.' else '' end
      || case when o.brief is not null then ' Le cap du mois : ' || o.brief else '' end;
  end if;
  return v;
end $$;

-- Missions du jour (créées une fois par jour) : faire progresser ses commerçants, l'objectif du mois, une formation.
create or replace function fiila.amb_plan_day(a fiila.ambassadors) returns void
language plpgsql set search_path = '' as $$
declare v_day date := (now() at time zone 'utc')::date; o fiila.amb_objectives := fiila.amb_objective(); s jsonb; n int := 0; m fiila.amb_missions;
  v_miss text; v_focus text;
begin
  if exists (select 1 from fiila.amb_tasks where ambassador_id = a.id and day = v_day and (done_at is null or kind <> 'setup')) then return; end if;
  if a.status = 'training' then
    insert into fiila.amb_tasks (ambassador_id, day, kind, title, body) values
      (a.id, v_day, 'setup', 'Terminer la formation et réussir le test', 'Six fiches courtes, puis 10 questions. 8 bonnes réponses pour passer.');
    return;
  end if;
  if a.status = 'review' then
    insert into fiila.amb_tasks (ambassador_id, day, kind, title, body) values
      (a.id, v_day, 'setup', 'Repérer 3 commerçants de votre quartier', 'Notez leur nom et leur type de commerce : vous les installerez dès votre profil validé.');
    return;
  end if;
  if a.status <> 'active' then return; end if;
  -- 1. Les commerçants les plus proches du niveau suivant (2 au plus).
  for s in select x from jsonb_array_elements(coalesce(fiila.amb_refresh(a) -> 'shops', '[]'::jsonb)) x
           where (x ->> 'level')::int < 3 and not coalesce((x ->> 'expired')::boolean, false)
           order by (x ->> 'level')::int desc limit 2 loop
    v_miss := case (s ->> 'level')::int
      when 0 then concat_ws(', ', case when not (s ->> 'typed')::boolean then 'choisir le type de commerce' end,
                                 case when (s ->> 'photos')::int < 5 then (5 - (s ->> 'photos')::int) || ' article(s) avec photo' end,
                                 case when not (s ->> 'public')::boolean then 'ouvrir la vitrine' end)
      when 1 then concat_ws(', ', case when (s ->> 'clients')::int < 3 then (3 - (s ->> 'clients')::int) || ' cliente(s) de plus' end,
                                 case when not (s ->> 'delivered')::boolean then '1 commande livrée' end)
      else 'des commandes chaque semaine' end;
    insert into fiila.amb_tasks (ambassador_id, day, kind, title, body) values
      (a.id, v_day, 'shop', 'Aider ' || (s ->> 'shop') || ' à passer au niveau ' || ((s ->> 'level')::int + 1), 'Encore : ' || v_miss || '.');
    n := n + 1;
  end loop;
  -- 2. Prospection selon l'objectif du mois (types et quartiers prioritaires).
  if n < 2 then
    v_focus := nullif(concat_ws(' · ', nullif(array_to_string(o.focus_types, ', '), ''), nullif(array_to_string(o.focus_zones, ', '), '')), '');
    insert into fiila.amb_tasks (ambassador_id, day, kind, title, body) values
      (a.id, v_day, 'prospect', case when v_focus is null then 'Trouver un nouveau commerçant' else 'Trouver un commerçant : ' || v_focus end,
       coalesce(o.brief, 'Envoyez votre code et installez sa boutique avec lui, sur son téléphone.'));
    n := n + 1;
  end if;
  -- 3. Une mission du catalogue (tour à tour) ou une formation.
  select * into m from fiila.amb_missions where status = 'active' and audience in ('all', 'active')
   order by md5(id::text || v_day::text) limit 1;
  if m.id is not null and n < 3 then
    insert into fiila.amb_tasks (ambassador_id, day, kind, title, body, mission_id) values
      (a.id, v_day, case when m.kind = 'training' then 'training' else 'catalog' end, m.title, m.body, m.id);
  end if;
end $$;

-- Messages automatiques du Manager aux grandes étapes du parcours.
create or replace function fiila.amb_manager_trg() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform fiila.amb_say(new.id, 'Bienvenue ' || split_part(new.name, ' ', 1) || ', je suis votre Manager Fii La Carrière. Je vous accompagne chaque jour : vos missions, vos questions, vos retours du terrain. Commencez par la formation : six fiches courtes, puis le test.');
  elsif new.status is distinct from old.status then
    -- Nouvelle étape : les missions du jour non faites sont recalculées à la prochaine ouverture.
    delete from fiila.amb_tasks where ambassador_id = new.id and day = (now() at time zone 'utc')::date and done_at is null;
    if new.status = 'review' then perform fiila.amb_say(new.id, 'Bravo pour le test ! L’équipe valide votre profil, en général sous 48 heures. En attendant, repérez 3 commerçants de votre quartier.');
    elsif new.status = 'active' and old.status = 'review' then perform fiila.amb_say(new.id, 'Votre profil est validé. Votre code : ' || new.code || '. Votre première mission : trouver un commerçant et installer sa boutique avec lui, sur son téléphone. Je suis là si vous bloquez.');
    elsif new.status = 'active' and old.status = 'suspended' then perform fiila.amb_say(new.id, 'Votre compte est réactivé. On reprend : vos missions du jour sont prêtes.');
    elsif new.status = 'suspended' then perform fiila.amb_say(new.id, 'Votre compte est suspendu pour le moment' || coalesce(' : ' || new.note, '.') || ' Écrivez-moi si vous avez une question.');
    end if;
  end if;
  return new;
end $$;
create trigger amb_manager after insert or update of status on fiila.ambassadors for each row execute function fiila.amb_manager_trg();

-- Analyse quotidienne : propositions au Head of Stratégie (jamais appliquées sans décision humaine).
create or replace function fiila.amb_digest() returns void
language plpgsql set search_path = '' as $$
declare r record; v_runs int; v_tasks int; v_done int; v_obj int;
begin
  if exists (select 1 from fiila.amb_notes where kind = 'report' and created_at > now() - interval '20 hours') then return; end if;
  select count(*) into v_runs from fiila.ambassador_quiz_runs where finished_at is not null;
  -- Formation : une question manquée par 40 % ou plus (au moins 3 tests) → fiche à clarifier.
  if v_runs >= 3 then
    for r in select q - 1 as q, count(*) filter (where x.answers[q] is distinct from (fiila.amb_quiz_key())[q]) as wrong
               from generate_series(1, 10) q cross join fiila.ambassador_quiz_runs x where x.finished_at is not null group by q loop
      if r.wrong::numeric / v_runs >= 0.4 and not exists (select 1 from fiila.amb_notes where kind = 'training' and status = 'open' and (data ->> 'q')::int = r.q) then
        insert into fiila.amb_notes (kind, title, body, data) values ('training', 'Clarifier la règle de la question ' || (r.q + 1),
          round(100 * r.wrong::numeric / v_runs) || ' % des tests la manquent. Règle à mieux expliquer dans la formation : ' || fiila.amb_quiz_why(r.q),
          jsonb_build_object('q', r.q, 'wrong', r.wrong, 'runs', v_runs));
      end if;
    end loop;
  end if;
  -- Terrain : objection fréquente (3 fois ou plus en 7 jours) → mission de réponse type.
  select count(*) into v_obj from fiila.amb_messages where author = 'agent' and 'objection' = any (tags) and created_at > now() - interval '7 days';
  if v_obj >= 3 and not exists (select 1 from fiila.amb_notes where kind = 'mission' and status = 'open') then
    insert into fiila.amb_notes (kind, title, body, data) values ('mission', 'Préparer une réponse type aux objections des commerçants',
      v_obj || ' objections remontées en 7 jours. Proposition : une mission de formation « Répondre à un commerçant hésitant » avec la phrase qui marche le mieux sur le terrain.',
      jsonb_build_object('objections', v_obj, 'examples', (select coalesce(jsonb_agg(left(body, 140)), '[]'::jsonb) from (select body from fiila.amb_messages
        where author = 'agent' and 'objection' = any (tags) order by created_at desc limit 5) e)));
  end if;
  -- Missions : peu accomplies (moins de 30 % sur 7 jours, au moins 10) → trop nombreuses ou mal ciblées.
  select count(*), count(done_at) into v_tasks, v_done from fiila.amb_tasks where day > (now() at time zone 'utc')::date - 7 and kind <> 'setup';
  if v_tasks >= 10 and v_done::numeric / v_tasks < 0.3 then
    insert into fiila.amb_notes (kind, title, body, data, status) values ('insight', 'Missions peu accomplies',
      v_done || ' missions faites sur ' || v_tasks || ' en 7 jours. À revoir : moins de missions par jour, ou des missions plus concrètes.', jsonb_build_object('tasks', v_tasks, 'done', v_done), 'info');
  end if;
  -- Rapport du jour (chiffres).
  insert into fiila.amb_notes (kind, title, body, data, status) values ('report', 'Point du ' || to_char(now(), 'DD/MM'), null, jsonb_build_object(
    'ambassadors', (select count(*) from fiila.ambassadors where status = 'active'),
    'training', (select count(*) from fiila.ambassadors where status = 'training'),
    'review', (select count(*) from fiila.ambassadors where status = 'review'),
    'shops_7d', (select count(*) from fiila.ambassador_shops where linked_at > now() - interval '7 days'),
    'level2_month', (select count(*) from fiila.ambassador_rewards where level = 2 and status <> 'cancelled' and earned_at >= date_trunc('month', now())),
    'tasks_7d', v_tasks, 'done_7d', v_done,
    'messages_7d', (select count(*) from fiila.amb_messages where author = 'agent' and created_at > now() - interval '7 days'),
    'tags_7d', (select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) from (select unnest(tags) t, count(*) n from fiila.amb_messages
       where author = 'agent' and created_at > now() - interval '7 days' group by 1) z)), 'info');
  delete from fiila.amb_notes where kind = 'report' and created_at < now() - interval '90 days';
end $$;

-- ---------------------------------------------------------------- API ambassadeur
create or replace function public.fiila_amb_today() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); o fiila.amb_objectives;
begin
  perform fiila.read_check();
  if a.id is null then perform fiila.fail('not_found'); end if;
  perform fiila.amb_plan_day(a);
  o := fiila.amb_objective();
  return jsonb_build_object(
    'objective', case when o.id is null then null else jsonb_strip_nulls(jsonb_build_object('brief', o.brief, 'focus_types', o.focus_types, 'focus_zones', o.focus_zones)) end,
    'tasks', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'body', t.body, 'done', t.done_at is not null)) order by t.created_at)
       from fiila.amb_tasks t where t.ambassador_id = a.id and t.day = (now() at time zone 'utc')::date), '[]'::jsonb),
    'streak', (select count(distinct day) from fiila.amb_tasks where ambassador_id = a.id and done_at is not null and day > (now() at time zone 'utc')::date - 30),
    'unread', (select count(*) from fiila.amb_messages where ambassador_id = a.id and author <> 'agent' and seen_at is null),
    'llm', fiila.setting_int('amb_manager_llm') = 1);
end $$;

create or replace function public.fiila_amb_task_done(p_id uuid, p_feedback text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); t fiila.amb_tasks;
begin
  if a.id is null then perform fiila.fail('not_found'); end if;
  perform fiila.rate_check('amb_task', 120);
  update fiila.amb_tasks set done_at = coalesce(done_at, now()), feedback = coalesce(fiila.clean(p_feedback, 500), feedback)
   where id = p_id and ambassador_id = a.id returning * into t;
  if t.id is null then perform fiila.fail('not_found'); end if;
  -- Un retour écrit sur une mission entre dans la conversation : le Manager le lit et l'équipe le voit.
  if nullif(trim(coalesce(p_feedback, '')), '') is not null then
    insert into fiila.amb_messages (ambassador_id, author, body, tags, answered) values (a.id, 'agent', '[Mission « ' || t.title || ' »] ' || fiila.clean(p_feedback, 500),
      fiila.amb_tags(p_feedback) || array['retour'], true);
  end if;
  return jsonb_build_object('ok', true, 'left', (select count(*) from fiila.amb_tasks where ambassador_id = a.id and day = t.day and done_at is null));
end $$;

-- Conversation : les 60 derniers messages ; marque lus ceux du Manager et de l'équipe. Un message resté sans réponse plus
-- d'une minute (IA indisponible) reçoit la réponse du Manager sans IA.
create or replace function public.fiila_amb_messages() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); m fiila.amb_messages;
begin
  perform fiila.read_check();
  if a.id is null then perform fiila.fail('not_found'); end if;
  for m in select * from fiila.amb_messages where ambassador_id = a.id and author = 'agent' and not answered and created_at < now() - interval '1 minute' loop
    perform fiila.amb_say(a.id, fiila.amb_rule_reply(a, m.body, m.tags));
    update fiila.amb_messages set answered = true, escalate = escalate or 'probleme' = any (tags) where id = m.id;
  end loop;
  update fiila.amb_messages set seen_at = now() where ambassador_id = a.id and author <> 'agent' and seen_at is null;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'author', x.author, 'body', x.body, 'at', x.created_at) order by x.created_at)
    from (select * from fiila.amb_messages where ambassador_id = a.id order by created_at desc limit 60) x), '[]'::jsonb);
end $$;

create or replace function public.fiila_amb_message_send(p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); v_body text := fiila.clean(p_body, 1000); v_tags text[]; v_id uuid; v_llm boolean := fiila.setting_int('amb_manager_llm') = 1;
begin
  if a.id is null then perform fiila.fail('not_found'); end if;
  if a.status = 'excluded' then perform fiila.fail('not_allowed'); end if;
  if v_body is null then perform fiila.fail('message_required'); end if;
  perform fiila.rate_check('amb_message', 60);
  v_tags := fiila.amb_tags(v_body);
  insert into fiila.amb_messages (ambassador_id, author, body, tags, escalate, answered)
  values (a.id, 'agent', v_body, v_tags, 'probleme' = any (v_tags), not v_llm) returning id into v_id;
  if not v_llm then perform fiila.amb_say(a.id, fiila.amb_rule_reply(a, v_body, v_tags)); end if;
  return jsonb_build_object('id', v_id, 'pending', v_llm);
end $$;

-- ---------------------------------------------------------------- fonction fiila-manager (IA) : rôle service seulement
-- Contexte complet d'un message pour rédiger la réponse.
create or replace function public.fiila_amb_manager_context(p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m fiila.amb_messages; a fiila.ambassadors; o fiila.amb_objectives := fiila.amb_objective();
begin
  select * into m from fiila.amb_messages where id = p_message and author = 'agent';
  if m.id is null then perform fiila.fail('not_found'); end if;
  select * into a from fiila.ambassadors where id = m.ambassador_id;
  return jsonb_build_object('message', jsonb_build_object('id', m.id, 'body', m.body, 'tags', m.tags, 'answered', m.answered),
    'user_id', a.user_id, 'llm', fiila.setting_int('amb_manager_llm') = 1,
    'ambassador', fiila.amb_json(a) - 'history' - 'payout_phone' - 'phone' || coalesce(case when a.status in ('active', 'suspended') then fiila.amb_refresh(a) end, '{}'::jsonb),
    'objective', case when o.id is null then null else jsonb_build_object('brief', o.brief, 'focus_types', o.focus_types, 'focus_zones', o.focus_zones,
      'target_active', o.target_active, 'target_new', o.target_new) end,
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'body', t.body, 'done', t.done_at is not null)) from fiila.amb_tasks t
       where t.ambassador_id = a.id and t.day = (now() at time zone 'utc')::date), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('author', x.author, 'body', x.body) order by x.created_at)
       from (select * from fiila.amb_messages where ambassador_id = a.id and created_at <= m.created_at order by created_at desc limit 16) x), '[]'::jsonb),
    'rules', (select jsonb_agg(fiila.amb_quiz_why(q)) from generate_series(0, 9) q),
    'rewards', jsonb_build_array(fiila.setting_int('amb_reward_1'), fiila.setting_int('amb_reward_2'), fiila.setting_int('amb_reward_3')),
    'fallback', fiila.amb_rule_reply(a, m.body, m.tags));
end $$;

-- Réponse rédigée par l'IA (ou de secours) pour un message.
create or replace function public.fiila_amb_manager_post(p_message uuid, p_reply text, p_tags jsonb, p_escalate boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m fiila.amb_messages; v_tags text[];
begin
  select * into m from fiila.amb_messages where id = p_message and author = 'agent' for update;
  if m.id is null then perform fiila.fail('not_found'); end if;
  if m.answered then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  select coalesce(array_agg(t), '{}') into v_tags from jsonb_array_elements_text(case when jsonb_typeof(p_tags) = 'array' then p_tags else '[]'::jsonb end) t
   where t in ('question', 'objection', 'probleme', 'gains', 'idee', 'positif', 'retour', 'formation', 'motivation');
  update fiila.amb_messages set answered = true, tags = (select array_agg(distinct x) from unnest(m.tags || v_tags) x),
    escalate = m.escalate or coalesce(p_escalate, false) where id = m.id;
  perform fiila.amb_say(m.ambassador_id, coalesce(fiila.clean(p_reply, 1500), 'Bien reçu.'));
  return jsonb_build_object('ok', true);
end $$;

-- Données de l'analyse IA (rapport et propositions), puis enregistrement d'une note.
create or replace function public.fiila_amb_manager_digest_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.amb_digest();
  return jsonb_build_object('report', (select data from fiila.amb_notes where kind = 'report' order by created_at desc limit 1),
    'objective', (select to_jsonb(o) - 'created_by' from fiila.amb_objectives o where month = date_trunc('month', now())::date order by created_at desc limit 1),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('tags', tags, 'body', left(body, 300))) from (select * from fiila.amb_messages
       where author = 'agent' and created_at > now() - interval '7 days' order by created_at desc limit 80) x), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('task', title, 'feedback', left(feedback, 300))) from (select * from fiila.amb_tasks
       where feedback is not null and done_at > now() - interval '7 days' order by done_at desc limit 40) y), '[]'::jsonb),
    'missions', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'kind', kind, 'status', status)) from fiila.amb_missions), '[]'::jsonb),
    'rules', (select jsonb_agg(fiila.amb_quiz_why(q)) from generate_series(0, 9) q));
end $$;
create or replace function public.fiila_amb_manager_note(p_kind text, p_title text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('insight', 'training', 'mission') then perform fiila.fail('invalid_payload'); end if;
  insert into fiila.amb_notes (kind, title, body, data, status) values (p_kind, coalesce(fiila.clean(p_title, 140), 'Proposition'), fiila.clean(p_body, 2000),
    jsonb_build_object('source', 'ia'), case when p_kind = 'insight' then 'info' else 'open' end);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- back-office : Manager Fii La Carrière
create or replace function public.fiila_bo_career() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('ambassadors'); o fiila.amb_objectives;
begin
  perform fiila.amb_digest();
  o := fiila.amb_objective();
  return jsonb_build_object(
    'can_strategy', fiila.staff_can(v_uid, 'strategy'),
    'llm', fiila.setting_int('amb_manager_llm') = 1,
    'objective', case when o.id is null then null else jsonb_build_object('target_active', o.target_active, 'target_new', o.target_new,
      'focus_types', o.focus_types, 'focus_zones', o.focus_zones, 'brief', o.brief, 'at', o.created_at) end,
    'progress', jsonb_build_object(
      'active', (select count(*) from fiila.ambassador_rewards where level = 2 and status <> 'cancelled' and earned_at >= date_trunc('month', now())),
      'new', (select count(*) from fiila.ambassador_shops where linked_at >= date_trunc('month', now()))),
    'report', (select jsonb_build_object('title', title, 'data', data, 'at', created_at) from fiila.amb_notes where kind = 'report' order by created_at desc limit 1),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body, 'status', status, 'at', created_at, 'ia', data ->> 'source' = 'ia') order by created_at desc)
       from (select * from fiila.amb_notes where kind <> 'report' and (status in ('open', 'info') and created_at > now() - interval '30 days') order by created_at desc limit 30) n), '[]'::jsonb),
    'missions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body, 'audience', audience, 'status', status, 'source', source,
        'given', (select count(*) from fiila.amb_tasks t where t.mission_id = m.id), 'done', (select count(*) from fiila.amb_tasks t where t.mission_id = m.id and t.done_at is not null))
        order by (status = 'active') desc, created_at desc) from fiila.amb_missions m where status <> 'retired' or created_at > now() - interval '30 days'), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(x order by (x ->> 'waiting')::int desc, x ->> 'last_at' desc) from (
        select jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'zone', a.zone,
          'last', (select left(body, 120) from fiila.amb_messages m where m.ambassador_id = a.id order by created_at desc limit 1),
          'last_at', (select max(created_at) from fiila.amb_messages m where m.ambassador_id = a.id),
          'waiting', (select count(*) from fiila.amb_messages m where m.ambassador_id = a.id and m.author = 'agent' and m.staff_seen_at is null),
          'escalated', (select count(*) from fiila.amb_messages m where m.ambassador_id = a.id and m.escalate and m.staff_seen_at is null),
          'done_7d', (select count(*) from fiila.amb_tasks t where t.ambassador_id = a.id and t.done_at > now() - interval '7 days')) x
        from fiila.ambassadors a where exists (select 1 from fiila.amb_messages m where m.ambassador_id = a.id)) y), '[]'::jsonb));
end $$;

create or replace function public.fiila_bo_career_thread(p_amb uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('ambassadors'); a fiila.ambassadors;
begin
  select * into a from fiila.ambassadors where id = p_amb;
  if a.id is null then perform fiila.fail('not_found'); end if;
  update fiila.amb_messages set staff_seen_at = now() where ambassador_id = a.id and author = 'agent' and staff_seen_at is null;
  return jsonb_build_object('ambassador', jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'zone', a.zone, 'code', a.code),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'author', x.author, 'body', x.body, 'tags', x.tags, 'escalate', x.escalate, 'at', x.created_at) order by x.created_at)
       from (select * from fiila.amb_messages where ambassador_id = a.id order by created_at desc limit 100) x), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'title', t.title, 'done', t.done_at is not null, 'feedback', t.feedback) order by t.day desc, t.created_at)
       from (select * from fiila.amb_tasks where ambassador_id = a.id order by day desc, created_at limit 21) t), '[]'::jsonb));
end $$;

create or replace function public.fiila_bo_career_reply(p_amb uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('ambassadors'); v_body text := fiila.clean(p_body, 1500); v_name text;
begin
  if v_body is null then perform fiila.fail('message_required'); end if;
  select name into v_name from fiila.ambassadors where id = p_amb;
  if v_name is null then perform fiila.fail('not_found'); end if;
  insert into fiila.amb_messages (ambassador_id, author, body, created_by) values (p_amb, 'staff', v_body, v_uid);
  update fiila.amb_messages set answered = true, staff_seen_at = coalesce(staff_seen_at, now()) where ambassador_id = p_amb and author = 'agent' and (not answered or escalate);
  perform fiila.bo_log('career_reply', 'ambassador', p_amb::text, jsonb_build_object('name', v_name));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fiila_bo_objective_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('strategy'); v_types text[]; v_zones text[];
begin
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  select coalesce(array_agg(t), '{}') into v_types from jsonb_array_elements_text(coalesce(p -> 'focus_types', '[]'::jsonb)) t where fiila.valid_business_type(t);
  select coalesce(array_agg(z), '{}') into v_zones from (select fiila.clean(z, 40) z from jsonb_array_elements_text(coalesce(p -> 'focus_zones', '[]'::jsonb)) z) x where z is not null;
  insert into fiila.amb_objectives (month, target_active, target_new, focus_types, focus_zones, brief, created_by)
  values (date_trunc('month', now())::date, greatest(0, least(100000, coalesce((p ->> 'target_active')::int, 0))), greatest(0, least(100000, coalesce((p ->> 'target_new')::int, 0))),
          v_types[1:6], v_zones[1:6], fiila.clean(p ->> 'brief', 300), v_uid);
  perform fiila.bo_log('career_objective', 'objective', to_char(now(), 'YYYY-MM'), jsonb_build_object('title', fiila.clean(p ->> 'brief', 80)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fiila_bo_mission_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('strategy'); v_id uuid := fiila.as_uuid(p ->> 'id'); v_title text := fiila.clean(p ->> 'title', 120);
begin
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if v_id is null then
    if v_title is null then perform fiila.fail('title_required'); end if;
    if coalesce(p ->> 'kind', 'daily') not in ('daily', 'training') or coalesce(p ->> 'audience', 'active') not in ('all', 'training', 'active') then perform fiila.fail('invalid_payload'); end if;
    insert into fiila.amb_missions (kind, title, body, audience, created_by) values (coalesce(p ->> 'kind', 'daily'), v_title, fiila.clean(p ->> 'body', 400), coalesce(p ->> 'audience', 'active'), v_uid)
      returning id into v_id;
  else
    if coalesce(p ->> 'status', '') not in ('active', 'retired') then perform fiila.fail('invalid_payload'); end if;
    update fiila.amb_missions set status = p ->> 'status' where id = v_id returning title into v_title;
    if v_title is null then perform fiila.fail('not_found'); end if;
  end if;
  perform fiila.bo_log('career_mission', 'mission', v_id::text, jsonb_build_object('title', v_title, 'value', coalesce(p ->> 'status', 'active')));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Décision sur une proposition du Manager. Une proposition de mission acceptée devient une mission active.
create or replace function public.fiila_bo_note_decide(p_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('strategy'); n fiila.amb_notes;
begin
  if p_decision not in ('accepted', 'rejected') then perform fiila.fail('invalid_payload'); end if;
  update fiila.amb_notes set status = p_decision, decided_by = v_uid, decided_at = now() where id = p_id and status in ('open', 'info') returning * into n;
  if n.id is null then perform fiila.fail('not_found'); end if;
  if p_decision = 'accepted' and n.kind = 'mission' then
    insert into fiila.amb_missions (kind, title, body, audience, source, created_by) values ('training', left(n.title, 120), left(n.body, 400), 'active', 'manager', v_uid);
  end if;
  perform fiila.bo_log('career_note_' || p_decision, 'note', n.id::text, jsonb_build_object('title', n.title));
  return jsonb_build_object('ok', true);
end $$;

-- Tableau de bord : messages d'ambassadeurs à lire.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_overview()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'rewards', case when fiila.staff_can(v_uid, 'ambassadors') then$s$,
    $s$'career', case when fiila.staff_can(v_uid, 'ambassadors') then (select count(*) from fiila.amb_messages where author = 'agent' and staff_seen_at is null and (escalate or not answered)) end,
      'proposals', case when fiila.staff_can(v_uid, 'strategy') then (select count(*) from fiila.amb_notes where status = 'open') end,
      'rewards', case when fiila.staff_can(v_uid, 'ambassadors') then$s$);
  if v_new = v_def then raise exception 'amb_manager: fiila_bo_overview non modifiée'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------- droits
revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_amb_today()', 'public.fiila_amb_task_done(uuid, text)', 'public.fiila_amb_messages()', 'public.fiila_amb_message_send(text)',
    'public.fiila_bo_career()', 'public.fiila_bo_career_thread(uuid)', 'public.fiila_bo_career_reply(uuid, text)', 'public.fiila_bo_objective_set(jsonb)',
    'public.fiila_bo_mission_save(jsonb)', 'public.fiila_bo_note_decide(uuid, text)', 'public.fiila_bo_overview()', 'public.fiila_bo_settings()',
    'public.fiila_bo_invite(text, text)', 'public.fiila_bo_staff_set(uuid, text)'];
  svc text[] := array['public.fiila_amb_manager_context(uuid)', 'public.fiila_amb_manager_post(uuid, text, jsonb, boolean)',
    'public.fiila_amb_manager_digest_data()', 'public.fiila_amb_manager_note(text, text, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  -- Fonctions de la fonction fiila-manager : jamais appelables depuis l'application, seulement avec la clé de service.
  foreach fn in array svc loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function %s from %I', fn, role_name); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;
