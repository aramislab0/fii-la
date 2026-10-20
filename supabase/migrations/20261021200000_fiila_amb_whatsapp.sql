-- Fii La Carrière : le Manager sur WhatsApp (fondateur, 20/10/2026 07:44 : « le manager doit créer un canal de discussion
-- WhatsApp avec chaque agent pour que la proximité se crée »).
--
-- Deux niveaux, une seule conversation par ambassadeur (application et WhatsApp mêlés, le canal est noté sur chaque message) :
--   1. Tout de suite, gratuit : le numéro WhatsApp du Manager (réglé dans le back-office). L'ambassadeur l'ouvre d'un geste
--      depuis son espace ; l'équipe ouvre WhatsApp avec chaque ambassadeur depuis sa conversation dans le back-office.
--   2. Quand le fondateur aura branché l'API WhatsApp Business (Meta) : la fonction fiila-whatsapp reçoit les messages des
--      ambassadeurs, le Manager répond sur WhatsApp (règles ou IA), et les réponses de l'équipe partent aussi sur WhatsApp tant
--      que la fenêtre de 24 heures est ouverte. Réglage amb_whatsapp (0 = coupé).

alter table fiila.amb_messages add column channel text not null default 'app' check (channel in ('app', 'whatsapp'));

-- Messages WhatsApp déjà traités (Meta peut renvoyer le même message) : gardés 7 jours.
create table fiila.wa_events (
  wamid text primary key,
  at    timestamptz not null default now()
);
revoke all on fiila.wa_events from public;

insert into fiila.settings (key, value) values ('amb_whatsapp', '0') on conflict (key) do nothing;
create or replace function fiila.bo_setting_bounds(p_key text) returns int[]
language sql immutable set search_path = '' as $$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1]
    when 'amb_manager_llm' then array[0, 1]
    when 'nudges' then array[0, 1]
    when 'amb_whatsapp' then array[0, 1] end
$$;
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'amb_manager_llm', 'nudges']$s$, $s$'amb_manager_llm', 'nudges', 'amb_whatsapp']$s$);
  if v_new = v_def then raise exception 'amb_whatsapp: fiila_bo_settings non modifiée'; end if;
  execute v_new;
end $$;

-- Numéro WhatsApp du Manager, chiffres seulement avec l'indicatif (ex. 221771234567) ; null si non réglé.
create or replace function fiila.manager_wa() returns text
language sql stable set search_path = '' as $$
  select nullif(regexp_replace(coalesce((select value from fiila.settings where key = 'manager_whatsapp'), ''), '[^0-9]', '', 'g'), '')
$$;
-- Numéro d'un ambassadeur au format WhatsApp (indicatif 221 ajouté aux 9 chiffres sénégalais).
create or replace function fiila.wa_number(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case when length(fiila.phone_key(p_phone)) = 9 then '221' || fiila.phone_key(p_phone) else nullif(fiila.phone_key(p_phone), '') end
$$;

create or replace function public.fiila_bo_manager_whatsapp_set(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('strategy'); v text := fiila.wa_number(p_phone);
begin
  if nullif(trim(coalesce(p_phone, '')), '') is not null and (v is null or length(v) < 11 or length(v) > 15) then perform fiila.fail('phone_required'); end if;
  if v is null then delete from fiila.settings where key = 'manager_whatsapp';
  else insert into fiila.settings (key, value) values ('manager_whatsapp', v) on conflict (key) do update set value = excluded.value; end if;
  perform fiila.bo_log('career_whatsapp', 'setting', 'manager_whatsapp', jsonb_build_object('value', coalesce('+' || v, 'retiré')));
  return jsonb_build_object('ok', true, 'whatsapp', v);
end $$;

-- Messages d'étape : le numéro WhatsApp du Manager est donné dès que le profil est validé.
create or replace function fiila.amb_manager_trg() returns trigger
language plpgsql set search_path = '' as $$
declare v_wa text := fiila.manager_wa();
begin
  if tg_op = 'INSERT' then
    perform fiila.amb_say(new.id, 'Bienvenue ' || split_part(new.name, ' ', 1) || ', je suis votre Manager Fii La Carrière. Je vous accompagne chaque jour : vos missions, vos questions, vos retours du terrain. Commencez par la formation : six fiches courtes, puis le test.');
  elsif new.status is distinct from old.status then
    delete from fiila.amb_tasks where ambassador_id = new.id and day = (now() at time zone 'utc')::date and done_at is null;
    if new.status = 'review' then perform fiila.amb_say(new.id, 'Bravo pour le test ! L’équipe valide votre profil, en général sous 48 heures. En attendant, repérez 3 commerçants de votre quartier.');
    elsif new.status = 'active' and old.status = 'review' then perform fiila.amb_say(new.id, 'Votre profil est validé. Votre code : ' || new.code || '. Votre première mission : trouver un commerçant et installer sa boutique avec lui, sur son téléphone. Je suis là si vous bloquez.'
      || case when v_wa is not null then ' Enregistrez mon numéro WhatsApp, +' || v_wa || ' : écrivez-moi aussi là-bas, quand vous voulez.' else '' end);
    elsif new.status = 'active' and old.status = 'suspended' then perform fiila.amb_say(new.id, 'Votre compte est réactivé. On reprend : vos missions du jour sont prêtes.');
    elsif new.status = 'suspended' then perform fiila.amb_say(new.id, 'Votre compte est suspendu pour le moment' || coalesce(' : ' || new.note, '.') || ' Écrivez-moi si vous avez une question.');
    end if;
  end if;
  return new;
end $$;

-- La réponse du Manager part sur le canal du message auquel elle répond.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_amb_manager_post(uuid, text, jsonb, boolean)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$perform fiila.amb_say(m.ambassador_id, coalesce(fiila.clean(p_reply, 1500), 'Bien reçu.'));$s$,
    $s$insert into fiila.amb_messages (ambassador_id, author, body, channel) values (m.ambassador_id, 'manager', coalesce(fiila.clean(p_reply, 1500), 'Bien reçu.'), m.channel);$s$);
  if v_new = v_def then raise exception 'amb_whatsapp: fiila_amb_manager_post non modifiée'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------- fonction fiila-whatsapp : rôle service seulement
-- Message reçu sur WhatsApp. Renvoie qui l'a écrit et, sans IA, la réponse à envoyer.
create or replace function public.fiila_wa_inbound(p_phone text, p_body text, p_wamid text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors; v_body text := fiila.clean(p_body, 1000); v_tags text[]; v_id uuid; v_llm boolean := fiila.setting_int('amb_manager_llm') = 1; v_reply text;
begin
  if fiila.setting_int('amb_whatsapp') <> 1 then return jsonb_build_object('off', true); end if;
  if nullif(p_wamid, '') is not null then
    if exists (select 1 from fiila.wa_events where wamid = p_wamid) then return jsonb_build_object('duplicate', true); end if;
    insert into fiila.wa_events (wamid) values (left(p_wamid, 200));
    delete from fiila.wa_events where at < now() - interval '7 days';
  end if;
  select * into a from fiila.ambassadors where fiila.phone_key(phone) = fiila.phone_key(p_phone) and nullif(fiila.phone_key(p_phone), '') is not null
   order by (status = 'excluded') limit 1;
  if a.id is null then return jsonb_build_object('known', false); end if;
  if a.status = 'excluded' then return jsonb_build_object('known', true, 'excluded', true); end if;
  if v_body is null then
    return jsonb_build_object('known', true, 'reply', 'Pour l’instant, je lis seulement les messages écrits. Pouvez-vous me l’écrire en quelques mots ?');
  end if;
  v_tags := fiila.amb_tags(v_body);
  insert into fiila.amb_messages (ambassador_id, author, body, tags, escalate, answered, channel)
  values (a.id, 'agent', v_body, v_tags, 'probleme' = any (v_tags), not v_llm, 'whatsapp') returning id into v_id;
  if not v_llm then
    v_reply := fiila.amb_rule_reply(a, v_body, v_tags);
    insert into fiila.amb_messages (ambassador_id, author, body, channel) values (a.id, 'manager', v_reply, 'whatsapp');
    return jsonb_build_object('known', true, 'message', v_id, 'reply', v_reply);
  end if;
  return jsonb_build_object('known', true, 'message', v_id, 'pending', true);
end $$;

-- Dernier message de l'équipe à envoyer sur WhatsApp, si la fenêtre de 24 heures est ouverte (dernier message de l'agent sur WhatsApp).
create or replace function public.fiila_wa_push_data(p_amb uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors; v_body text;
begin
  select * into a from fiila.ambassadors where id = p_amb;
  if a.id is null then perform fiila.fail('not_found'); end if;
  select body into v_body from fiila.amb_messages where ambassador_id = a.id and author = 'staff' order by created_at desc limit 1;
  return jsonb_build_object('to', fiila.wa_number(a.phone), 'body', v_body,
    'open', fiila.setting_int('amb_whatsapp') = 1 and exists (select 1 from fiila.amb_messages where ambassador_id = a.id and author = 'agent' and channel = 'whatsapp' and created_at > now() - interval '23 hours 50 minutes'));
end $$;

-- ---------------------------------------------------------------- application et back-office
do $$
declare v_def text; v_new text;
begin
  -- Espace ambassadeur : numéro du Manager.
  select pg_get_functiondef('public.fiila_amb_today()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'llm', fiila.setting_int('amb_manager_llm') = 1);$s$, $s$'llm', fiila.setting_int('amb_manager_llm') = 1, 'whatsapp', fiila.manager_wa());$s$);
  if v_new = v_def then raise exception 'amb_whatsapp: fiila_amb_today non modifiée'; end if;
  execute v_new;
  -- Conversation dans l'application : le canal de chaque message.
  select pg_get_functiondef('public.fiila_amb_messages()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$jsonb_build_object('id', x.id, 'author', x.author, 'body', x.body, 'at', x.created_at)$s$, $s$jsonb_build_object('id', x.id, 'author', x.author, 'body', x.body, 'at', x.created_at, 'channel', x.channel)$s$);
  if v_new = v_def then raise exception 'amb_whatsapp: fiila_amb_messages non modifiée'; end if;
  execute v_new;
  -- Back-office : réglages du canal, numéro de chaque ambassadeur, fenêtre ouverte.
  select pg_get_functiondef('public.fiila_bo_career()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    'llm', fiila.setting_int('amb_manager_llm') = 1,$s$, $s$    'llm', fiila.setting_int('amb_manager_llm') = 1,
    'whatsapp', fiila.manager_wa(), 'wa_api', fiila.setting_int('amb_whatsapp') = 1,$s$);
  if v_new = v_def then raise exception 'amb_whatsapp: fiila_bo_career non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_bo_career_thread(uuid)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'zone', a.zone, 'code', a.code),$s$,
    $s$jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'zone', a.zone, 'code', a.code, 'wa', fiila.wa_number(a.phone),
      'wa_open', fiila.setting_int('amb_whatsapp') = 1 and exists (select 1 from fiila.amb_messages m where m.ambassador_id = a.id and m.author = 'agent' and m.channel = 'whatsapp' and m.created_at > now() - interval '23 hours 50 minutes')),$s$);
  v_new := replace(v_new, $s$jsonb_build_object('id', x.id, 'author', x.author, 'body', x.body, 'tags', x.tags, 'escalate', x.escalate, 'at', x.created_at)$s$,
    $s$jsonb_build_object('id', x.id, 'author', x.author, 'body', x.body, 'tags', x.tags, 'escalate', x.escalate, 'at', x.created_at, 'channel', x.channel)$s$);
  if v_new = v_def then raise exception 'amb_whatsapp: fiila_bo_career_thread non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_bo_manager_whatsapp_set(text)', 'public.fiila_amb_today()', 'public.fiila_amb_messages()', 'public.fiila_bo_career()',
    'public.fiila_bo_career_thread(uuid)', 'public.fiila_bo_settings()'];
  svc text[] := array['public.fiila_wa_inbound(text, text, text)', 'public.fiila_wa_push_data(uuid)', 'public.fiila_amb_manager_post(uuid, text, jsonb, boolean)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  foreach fn in array svc loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke execute on function %s from %I', fn, role_name); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;
