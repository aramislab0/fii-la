-- Mandat AGENTS-AMBASSADEURS-001, lot 4 : un seul Manager pour les deux programmes, avec des contextes distincts.
--   Agents       : conversation existante (amb_messages), inchangée.
--   Ambassadeurs : conversation de la boutique partenaire (partner_messages) : configuration, catalogue, vitrine, partage,
--                  premières commandes, bilan d'essai, suite. Réponses du Manager sans IA (règles), escalade visible à l'équipe.
-- Le Manager n'approuve jamais un versement, ne prolonge pas un essai, n'augmente pas un quota et n'invente aucun prix :
-- ces sujets sont transmis à l'équipe (escalate).
-- WhatsApp : le contexte est vérifié par le serveur. Un numéro qui est à la fois celui d'un agent et celui d'une marque
-- invitée reçoit une question (« 1. Agent / 2. Boutique ») ; le choix vaut 24 heures.
-- Jalons réels (back-office) : boutique configurée, premier article, vitrine ouverte, commande reçue, commande livrée,
-- retour de la marque (message après l'activation) — lus dans les données, jamais déduits d'un clic.

create table fiila.partner_messages (
  id            uuid primary key default gen_random_uuid(),
  trial_id      uuid not null references fiila.partner_trials (id) on delete cascade,
  author        text not null check (author in ('brand', 'manager', 'staff')),
  body          text not null,
  channel       text not null default 'app' check (channel in ('app', 'whatsapp')),
  escalate      boolean not null default false,
  staff_seen_at timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index partner_messages_trial on fiila.partner_messages (trial_id, created_at);
revoke all on fiila.partner_messages from public;

-- Choix de contexte WhatsApp pour un numéro ambigu (24 heures).
create table fiila.wa_context (
  phone_key  text primary key,
  context    text not null check (context in ('agent', 'partner', 'ask')),
  until      timestamptz not null
);
revoke all on fiila.wa_context from public;

-- Réponse du Manager sans IA, selon le sujet et l'état réel de l'essai. escalate = l'équipe doit répondre.
create or replace function fiila.partner_rule_reply(t fiila.partner_trials, p_body text, out reply text, out escalate boolean)
language plpgsql stable security definer set search_path = '' as $$
declare b text := lower(coalesce(p_body, '')); s fiila.shops; v_products int; p fiila.partner_packs;
begin
  select * into s from fiila.shops where id = t.shop_id;
  select count(*) into v_products from fiila.products where shop_id = t.shop_id and active;
  select * into p from fiila.partner_packs where code = t.pack_code and version = t.pack_version;
  escalate := false;
  if b ~ '(prix|tarif|combien|payer|paiement|abonnement|suite|après l.essai|prolong|plus de temps|quota|crédit)' then
    reply := 'Bonne question. Je la transmets à l’équipe Fii La, qui vous répond ici directement. Je ne fixe ni prix ni prolongation moi-même.';
    escalate := true;
  elsif b ~ '(studio|retouch|améliorer la photo|photo pro)' then
    reply := case when p.needs_studio and coalesce(fiila.setting_int('studio_ready'), 0) <> 1
      then 'Le Studio de retouche n’est pas encore disponible. Je préviens l’équipe : vous serez informé dès qu’il l’est.'
      else 'Pour une belle photo : l’article seul, à la lumière du jour, sur un fond simple. Ajoutez-la dans « Mes articles ».' end;
    escalate := p.needs_studio and coalesce(fiila.setting_int('studio_ready'), 0) <> 1;
  elsif t.status = 'ready' then
    reply := 'Votre essai vous attend : touchez « Activer mon essai » dans votre boutique quand vous êtes prêt. Il dure ' || t.months || ' mois à partir de ce moment.';
  elsif v_products = 0 then
    reply := 'Prochaine étape : votre premier article. Une photo, un nom et un prix suffisent (« Mes articles » → « Ajouter un article »).';
  elsif not s.public then
    reply := 'Vos articles sont prêts. Ouvrez votre vitrine dans « Réglages » → « Ma vitrine en ligne » : vos clientes pourront commander.';
  elsif not exists (select 1 from fiila.orders where shop_id = s.id) then
    reply := 'Votre vitrine est en ligne. Mettez son lien dans votre statut WhatsApp et envoyez-le à vos meilleures clientes : c’est ainsi que viennent les premières commandes.';
  else
    reply := 'Merci pour votre message. Je le transmets à l’équipe Fii La, qui vous répond ici.';
    escalate := true;
  end if;
end $$;

create or replace function fiila.partner_say(t fiila.partner_trials, p_body text, p_channel text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_body text := fiila.clean(p_body, 1000);
begin
  if v_body is null then perform fiila.fail('message_required'); end if;
  select * into r from fiila.partner_rule_reply(t, v_body);
  insert into fiila.partner_messages (trial_id, author, body, channel, escalate, created_by) values (t.id, 'brand', v_body, p_channel, r.escalate, fiila.uid());
  insert into fiila.partner_messages (trial_id, author, body, channel) values (t.id, 'manager', r.reply, p_channel);
  return jsonb_build_object('reply', r.reply, 'escalate', r.escalate);
end $$;

-- Volatile : relue juste après un message envoyé dans la même requête (une fonction stable ne le verrait pas).
create or replace function fiila.partner_thread(p_trial uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'channel', case when m.channel = 'whatsapp' then 'whatsapp' end,
    'escalate', case when m.escalate then true end, 'at', m.created_at)) order by m.created_at), '[]'::jsonb)
  from (select * from fiila.partner_messages where trial_id = p_trial order by created_at desc limit 100) m
$$;

-- Boutique : conversation avec le Manager (propriétaire ou administrateur de la boutique partenaire).
create or replace function public.fiila_partner_messages(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin'); t fiila.partner_trials;
begin
  select * into t from fiila.partner_trials where shop_id = s.id;
  if t.id is null then perform fiila.fail('trial_none'); end if;
  return jsonb_build_object('messages', fiila.partner_thread(t.id));
end $$;
create or replace function public.fiila_partner_message_send(p_key text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key, 'admin'); t fiila.partner_trials;
begin
  perform fiila.rate_check('partner_msg', 30);
  select * into t from fiila.partner_trials where shop_id = s.id;
  if t.id is null then perform fiila.fail('trial_none'); end if;
  if t.status = 'revoked' then perform fiila.fail('trial_not_ready'); end if;
  return fiila.partner_say(t, p_body, 'app') || jsonb_build_object('messages', fiila.partner_thread(t.id));
end $$;

-- Back-office : lire et répondre (droit partners) ; la lecture marque les messages comme vus par l'équipe.
create or replace function public.fiila_bo_partner_thread(p_invite uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('partners'); t fiila.partner_trials;
begin
  select * into t from fiila.partner_trials where invite_id = p_invite;
  if t.id is null then perform fiila.fail('trial_none'); end if;
  update fiila.partner_messages set staff_seen_at = now() where trial_id = t.id and author = 'brand' and staff_seen_at is null;
  return jsonb_build_object('messages', fiila.partner_thread(t.id));
end $$;
create or replace function public.fiila_bo_partner_reply(p_invite uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('partners'); t fiila.partner_trials; v_body text := fiila.clean(p_body, 1500); i fiila.partner_invites;
begin
  if v_body is null then perform fiila.fail('message_required'); end if;
  select * into t from fiila.partner_trials where invite_id = p_invite;
  if t.id is null then perform fiila.fail('trial_none'); end if;
  select * into i from fiila.partner_invites where id = p_invite;
  insert into fiila.partner_messages (trial_id, author, body, created_by) values (t.id, 'staff', v_body, v_uid);
  perform fiila.bo_log('partner_reply', 'partner', p_invite::text, jsonb_build_object('name', i.brand));
  return jsonb_build_object('messages', fiila.partner_thread(t.id));
end $$;

-- Jalons réels d'une boutique partenaire.
create or replace function fiila.partner_milestones(t fiila.partner_trials) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when t.id is null then null else jsonb_build_object(
    'configured', (select business_type is not null from fiila.shops where id = t.shop_id),
    'first_product', exists (select 1 from fiila.products where shop_id = t.shop_id),
    'storefront', (select public from fiila.shops where id = t.shop_id),
    'orders', (select count(*) from fiila.orders where shop_id = t.shop_id and status <> 'cancelled' and created_at >= coalesce(t.activated_at, t.created_at)),
    'delivered', (select count(*) from fiila.orders where shop_id = t.shop_id and status = 'delivered' and created_at >= coalesce(t.activated_at, t.created_at)),
    'returned', exists (select 1 from fiila.partner_messages m where m.trial_id = t.id and m.author = 'brand' and t.activated_at is not null and m.created_at > t.activated_at + interval '1 day'),
    'to_read', (select count(*) from fiila.partner_messages m where m.trial_id = t.id and m.author = 'brand' and m.staff_seen_at is null),
    'escalated', (select count(*) from fiila.partner_messages m where m.trial_id = t.id and m.escalate and m.staff_seen_at is null)) end
$$;

do $$
declare v_def text; v_new text;
begin
  -- Liste du back-office : jalons de chaque essai.
  select pg_get_functiondef('public.fiila_bo_partners()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'trial', (select fiila.trial_json(t) from fiila.partner_trials t where t.invite_id = i.id)$s$,
    $s$'trial', (select fiila.trial_json(t) || jsonb_build_object('milestones', fiila.partner_milestones(t)) from fiila.partner_trials t where t.invite_id = i.id)$s$);
  if v_new = v_def then raise exception 'partner_manager: fiila_bo_partners non modifiée'; end if;
  execute v_new;

  -- WhatsApp : contexte vérifié par le serveur ; numéro de marque invitée → conversation de la boutique ; numéro ambigu → question.
  select pg_get_functiondef('public.fiila_wa_inbound(text, text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$  select * into a from fiila.ambassadors where fiila.phone_key(phone) = fiila.phone_key(p_phone) and nullif(fiila.phone_key(p_phone), '') is not null
   order by (status = 'excluded') limit 1;
  if a.id is null then return jsonb_build_object('known', false); end if;$s$,
  $s$  select * into a from fiila.ambassadors where fiila.phone_key(phone) = fiila.phone_key(p_phone) and nullif(fiila.phone_key(p_phone), '') is not null
   order by (status = 'excluded') limit 1;
  -- Contexte : agent, boutique partenaire, ou les deux (question, choix gardé 24 heures).
  declare v_pt fiila.partner_trials; v_ctx text; v_key text := fiila.phone_key(p_phone); v_brand text;
  begin
    select t.* into v_pt from fiila.partner_trials t join fiila.partner_invites i on i.id = t.invite_id
      left join fiila.shops s on s.id = t.shop_id
     where v_key <> '' and t.status <> 'revoked' and (fiila.phone_key(i.whatsapp) = v_key or fiila.phone_key(s.phone) = v_key)
     order by t.created_at desc limit 1;
    if v_pt.id is not null then
      select i.brand into v_brand from fiila.partner_invites i where i.id = v_pt.invite_id;
      select context into v_ctx from fiila.wa_context where phone_key = v_key and until > now();
      if a.id is not null and v_ctx is distinct from 'agent' and v_ctx is distinct from 'partner' then
        if v_ctx = 'ask' and trim(coalesce(p_body, '')) in ('1', '2') then
          v_ctx := case when trim(p_body) = '1' then 'agent' else 'partner' end;
          update fiila.wa_context set context = v_ctx, until = now() + interval '24 hours' where phone_key = v_key;
          return jsonb_build_object('known', true, 'reply', case when v_ctx = 'agent' then 'C’est noté : je vous réponds pour votre activité d’Agent Fii La. Écrivez votre message.'
            else 'C’est noté : je vous réponds pour votre boutique ' || v_brand || '. Écrivez votre message.' end);
        end if;
        insert into fiila.wa_context (phone_key, context, until) values (v_key, 'ask', now() + interval '24 hours')
          on conflict (phone_key) do update set context = 'ask', until = excluded.until;
        return jsonb_build_object('known', true, 'reply', 'Bonjour ! Vous écrivez pour : 1. votre activité d’Agent Fii La, ou 2. votre boutique ' || v_brand || ' ? Répondez 1 ou 2.');
      end if;
      if a.id is null or v_ctx = 'partner' then
        if fiila.clean(p_body, 1000) is null then
          return jsonb_build_object('known', true, 'reply', 'Pour l’instant, je lis seulement les messages écrits. Pouvez-vous me l’écrire en quelques mots ?');
        end if;
        return jsonb_build_object('known', true, 'partner', true, 'reply', (fiila.partner_say(v_pt, p_body, 'whatsapp')) ->> 'reply');
      end if;
    end if;
  end;
  if a.id is null then return jsonb_build_object('known', false); end if;$s$);
  if v_new = v_def then raise exception 'partner_manager: fiila_wa_inbound non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_partner_messages(text)', 'public.fiila_partner_message_send(text, text)', 'public.fiila_bo_partner_thread(uuid)',
    'public.fiila_bo_partner_reply(uuid, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
