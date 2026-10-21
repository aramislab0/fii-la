-- Mandat WHATSAPP-001 (kit du 21/10/2026, autorisé par le fondateur) — lot 1 : pilote « Indiquer mon entrée ».
-- 1) Registre des 6 modèles de messages WhatsApp du catalogue (docs/kits/whatsapp-2026-10-21/docs/design/whatsapp/catalogue.json) :
--    révision, action, état Meta (rien n'est soumis : NOT_SUBMITTED), état d'intégration. Le registre trace ; il n'envoie rien.
-- 2) Réglage wa_card_media (1 = la demande d'adresse se partage avec la carte image signature, 0 = texte seul).
-- 3) Mesure anonyme du partage : fichier partagé (image + texte), repli texte (wa.me), image téléchargée, échec du partage avec image.
--    « Partage ouvert » ne prouve pas qu'un message est parti ni qu'il a été lu.
-- Back-office (règle n° 8) : Croissance → « Messages WhatsApp » (voir, aperçu, mesures) ; Réglages (interrupteur) ;
-- état Meta modifiable par le droit « settings », journalisé.

create table if not exists fiila.wa_templates (
  id text primary key,
  revision int not null default 1,
  usage text not null,
  cta_label text not null,
  meta_status text not null default 'NOT_SUBMITTED' check (meta_status in ('NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAUSED')),
  integration text not null default 'TO_IMPLEMENT' check (integration in ('TO_IMPLEMENT', 'MANUAL_PILOT', 'MANUAL', 'API')),
  media text,
  position int not null default 0,
  updated_at timestamptz not null default now()
);
alter table fiila.wa_templates enable row level security;

insert into fiila.wa_templates (id, usage, cta_label, integration, media, position) values
  ('fiila_address_request_v1', 'Demande d’adresse', 'Indiquer mon entrée', 'MANUAL_PILOT', 'media/wa/demande-adresse.jpg', 1),
  ('fiila_ambassador_invite_v1', 'Invitation Ambassadeur', 'Voir mon invitation', 'TO_IMPLEMENT', null, 2),
  ('fiila_agent_invite_v1', 'Invitation Agent', 'Commencer', 'TO_IMPLEMENT', null, 3),
  ('fiila_order_recorded_v1', 'Commande enregistrée', 'Voir ma commande', 'TO_IMPLEMENT', null, 4),
  ('fiila_delivery_started_v1', 'Livraison en route', 'Suivre ma livraison', 'TO_IMPLEMENT', null, 5),
  ('fiila_event_invite_v1', 'Invitation à un événement', 'Voir l’événement', 'TO_IMPLEMENT', null, 6)
on conflict (id) do nothing;

insert into fiila.settings (key, value) values ('wa_card_media', '1') on conflict (key) do nothing;

create or replace function fiila.bo_setting_bounds(p_key text) returns int[]
language sql immutable set search_path = '' as $$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1]
    when 'amb_manager_llm' then array[0, 1]
    when 'nudges' then array[0, 1]
    when 'amb_whatsapp' then array[0, 1]
    when 'onboarding_v2' then array[0, 1]
    when 'discover_after' then array[0, 1]
    when 'wa_card_media' then array[0, 1] end
$$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'onboarding_v2', 'discover_after']$s$, $s$'onboarding_v2', 'discover_after', 'wa_card_media']$s$);
  if v_new = v_def then raise exception 'wa_cards: fiila_bo_settings non modifiée'; end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_track(text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$    or (p_event = 'payment_recorded'$s$, $s$    or (p_event = 'wa_card' and p_variant ~ '^(request|invite|agent|order|delivery|event):(file|text|download|failed)$')
    or (p_event = 'payment_recorded'$s$);
  if v_new = v_def then raise exception 'wa_cards: fiila_track non modifiée'; end if;
  execute v_new;
end $$;

create or replace function public.fiila_app_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nudges', coalesce(fiila.setting_int('nudges'), 1) = 1,
                            'onboarding', coalesce(fiila.setting_int('onboarding_v2'), 1) = 1,
                            'discover', coalesce(fiila.setting_int('discover_after'), 1) = 1,
                            'wa_card', coalesce(fiila.setting_int('wa_card_media'), 1) = 1)
$$;

-- Back-office : registre + mesures (30 jours) + interrupteur.
create or replace function public.fiila_bo_wa() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('dashboard'); v_since date := (now() at time zone 'utc')::date - 30;
begin
  return jsonb_build_object(
    'media_on', coalesce(fiila.setting_int('wa_card_media'), 1) = 1,
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'revision', t.revision, 'usage', t.usage, 'cta', t.cta_label,
        'meta', t.meta_status, 'integration', t.integration, 'media', t.media, 'updated_at', t.updated_at) order by t.position)
      from fiila.wa_templates t), '[]'::jsonb),
    'shares', coalesce((select jsonb_object_agg(variant, n) from (
      select variant, sum(n)::int n from fiila.metrics where event = 'wa_card' and day > v_since group by 1) x), '{}'::jsonb),
    'requests', (select coalesce(sum(n), 0)::int from fiila.metrics where event = 'request_created' and day > v_since));
end $$;

-- État Meta d'un modèle, saisi par l'équipe (aucune soumission automatique) ; journalisé.
create or replace function public.fiila_bo_wa_status(p_id text, p_meta text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('settings'); v_old text;
begin
  if p_meta not in ('NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAUSED') then raise exception 'invalid' using errcode = '22023'; end if;
  select meta_status into v_old from fiila.wa_templates where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_old = p_meta then return jsonb_build_object('ok', true, 'changed', false); end if;
  update fiila.wa_templates set meta_status = p_meta, updated_at = now() where id = p_id;
  perform fiila.bo_log('wa_template_status', 'wa_template', p_id, jsonb_build_object('from', v_old, 'to', p_meta));
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_track(text, text)', 'public.fiila_app_flags()', 'public.fiila_bo_settings()', 'public.fiila_bo_wa()', 'public.fiila_bo_wa_status(text, text)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
end $$;
