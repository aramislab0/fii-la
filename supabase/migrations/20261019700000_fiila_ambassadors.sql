-- Fii La Carrière : programme Ambassadeurs (fondateur, 19/10/2026 07:15 : règle « on paie un commerçant actif, jamais une
-- inscription », 3 niveaux, récompenses entre 2 000 et 10 000 FCFA ; proposition docs/PROPOSITION-VIDE-DRESSING-AMBASSADEURS.md).
--
-- Parcours : inscription (compte obligatoire, charte) → formation → test (8/10, 2 essais par jour) → validation par l'équipe
-- → code ambassadeur → le commerçant tape le code à la création de sa boutique (7 jours au plus après) → niveaux calculés
-- par la plateforme → gains en attente 30 jours → versement manuel (Wave / Orange Money) marqué par le fondateur.
-- Garde-fous : pas de soi-même (compte, téléphone), commandes au numéro de l'ambassadeur ignorées, clientes distinctes,
-- plafond mensuel de commerçants, gains annulables pendant l'attente, sanctions (suspension, exclusion).

insert into fiila.settings (key, value) values
  ('amb_reward_1', '2000'), ('amb_reward_2', '5000'), ('amb_reward_3', '10000'), ('amb_monthly_cap', '20')
on conflict (key) do nothing;

create table fiila.ambassadors (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users (id) on delete cascade,
  code           text not null unique,
  name           text not null,
  phone          text not null,
  zone           text,
  payout_method  text not null check (payout_method in ('wave', 'orange_money')),
  payout_phone   text not null,
  status         text not null default 'training' check (status in ('training', 'review', 'active', 'suspended', 'excluded')),
  grade          text not null default 'ambassadeur' check (grade in ('ambassadeur', 'confirme', 'certifie')),
  charter_at     timestamptz not null default now(),
  quiz_score     smallint,
  quiz_passed_at timestamptz,
  approved_at    timestamptz,
  note           text,                                   -- motif d'une décision de l'équipe
  created_at     timestamptz not null default now()
);

create table fiila.ambassador_quiz (
  id            uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references fiila.ambassadors (id) on delete cascade,
  score         smallint not null,
  at            timestamptz not null default now()
);
create index ambassador_quiz_amb on fiila.ambassador_quiz (ambassador_id, at);

-- Un commerçant accompagné : une boutique n'a qu'un seul ambassadeur, pour toujours.
create table fiila.ambassador_shops (
  id            uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references fiila.ambassadors (id) on delete cascade,
  shop_id       uuid not null unique references fiila.shops (id) on delete cascade,
  linked_at     timestamptz not null default now()
);
create index ambassador_shops_amb on fiila.ambassador_shops (ambassador_id, linked_at);

-- Gains : un par niveau atteint et par boutique. pending → validated (après 30 jours) → paid ; cancelled à tout moment avant paid.
create table fiila.ambassador_rewards (
  id             uuid primary key default gen_random_uuid(),
  ambassador_id  uuid not null references fiila.ambassadors (id) on delete cascade,
  shop_id        uuid references fiila.shops (id) on delete set null,
  shop_name      text not null,
  level          smallint not null check (level between 1 and 3),
  amount         integer not null check (amount > 0),
  status         text not null default 'pending' check (status in ('pending', 'validated', 'paid', 'cancelled')),
  earned_at      timestamptz not null default now(),
  validate_after timestamptz not null default now() + interval '30 days',
  paid_at        timestamptz,
  reason         text,
  unique (shop_id, level)
);
create index ambassador_rewards_amb on fiila.ambassador_rewards (ambassador_id, status);

revoke all on fiila.ambassadors, fiila.ambassador_quiz, fiila.ambassador_shops, fiila.ambassador_rewards from public;

-- ---------------------------------------------------------------- helpers
create or replace function fiila.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select is_admin from fiila.profiles where user_id = fiila.uid()), false)
$$;
create or replace function fiila.need_admin() returns void
language plpgsql set search_path = '' as $$
begin
  perform fiila.need_uid();
  if not fiila.is_admin() then perform fiila.fail('not_allowed'); end if;
end $$;
create or replace function fiila.setting_int(p_key text) returns int
language sql stable set search_path = '' as $$ select (select value from fiila.settings where key = p_key)::int $$;

create or replace function fiila.my_ambassador() returns fiila.ambassadors
language plpgsql set search_path = '' as $$
declare a fiila.ambassadors;
begin
  select * into a from fiila.ambassadors where user_id = fiila.need_uid();
  return a;
end $$;

-- Commandes qui comptent pour un commerçant : non annulées, passées après le lien, cliente ni ambassadeur ni boutique.
create or replace function fiila.amb_orders(p_link fiila.ambassador_shops, p_amb fiila.ambassadors)
returns table (customer text, delivered boolean, created_at timestamptz)
language sql stable set search_path = '' as $$
  select fiila.phone_key(o.customer_phone), o.status = 'delivered', o.created_at
    from fiila.orders o join fiila.shops s on s.id = o.shop_id
   where o.shop_id = p_link.shop_id and o.status <> 'cancelled' and o.created_at >= p_link.linked_at
     and nullif(fiila.phone_key(o.customer_phone), '') is not null
     and fiila.phone_key(o.customer_phone) <> fiila.phone_key(p_amb.phone)
     and fiila.phone_key(o.customer_phone) is distinct from nullif(fiila.phone_key(s.phone), '')
$$;

-- État d'un commerçant accompagné : ce qui est atteint et ce qui manque. Attribue les gains des niveaux atteints à temps.
create or replace function fiila.amb_eval(p_link fiila.ambassador_shops) returns jsonb
language plpgsql set search_path = '' as $$
declare a fiila.ambassadors; s fiila.shops; v_photos int; v_l1 boolean; v_orders int; v_clients int; v_deliv int; v_l2 boolean;
        v_weeks int; v_l3 boolean; v_age interval := now() - p_link.linked_at; v_lvl int := 0; lv int; v_amount int;
begin
  select * into a from fiila.ambassadors where id = p_link.ambassador_id;
  select * into s from fiila.shops where id = p_link.shop_id;
  if s.id is null then return null; end if;
  select count(*) into v_photos from fiila.products where shop_id = s.id and active and photo is not null;
  v_l1 := s.business_type is not null and v_photos >= 5 and s.public;
  select count(*), count(distinct customer), count(*) filter (where delivered) into v_orders, v_clients, v_deliv
    from fiila.amb_orders(p_link, a) where created_at <= p_link.linked_at + interval '30 days';
  v_l2 := v_clients >= 3 and v_deliv >= 1 and v_orders >= 3;
  -- Niveau 3 : 60 jours après le lien, au moins une commande par semaine sur 4 des 8 dernières semaines.
  select count(distinct date_trunc('week', created_at)) into v_weeks
    from fiila.amb_orders(p_link, a) where created_at > now() - interval '56 days';
  v_l3 := v_age >= interval '60 days' and v_weeks >= 4;
  -- Délais : niveau 1 en 7 jours, niveau 2 en 30 jours, niveau 3 entre 60 et 120 jours. Un niveau suppose le précédent.
  -- Un niveau déjà attribué reste acquis (même si l'activité baisse ensuite) ; un niveau annulé (fraude) bloque la suite.
  if exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled') then
    v_lvl := coalesce((select min(level) - 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled'), 0);
  else
    if (v_l1 and v_age <= interval '7 days') or exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and level = 1) then v_lvl := 1; end if;
    if v_lvl = 1 and ((v_l2 and v_age <= interval '30 days') or exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and level = 2)) then v_lvl := 2; end if;
    if v_lvl = 2 and ((v_l3 and v_age <= interval '120 days') or exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and level = 3)) then v_lvl := 3; end if;
  end if;
  if a.status = 'active' and not exists (select 1 from fiila.ambassador_rewards where shop_id = s.id and status = 'cancelled') then
    for lv in 1..v_lvl loop
      v_amount := fiila.setting_int('amb_reward_' || lv);
      insert into fiila.ambassador_rewards (ambassador_id, shop_id, shop_name, level, amount)
      values (a.id, s.id, s.name, lv, v_amount) on conflict (shop_id, level) do nothing;
    end loop;
  end if;
  return jsonb_build_object('shop', s.name, 'type', s.business_type, 'linked_at', p_link.linked_at, 'level', v_lvl,
    'photos', v_photos, 'public', s.public, 'typed', s.business_type is not null,
    'orders', v_orders, 'clients', v_clients, 'delivered', v_deliv, 'active_weeks', v_weeks,
    'deadline', case v_lvl when 0 then p_link.linked_at + interval '7 days' when 1 then p_link.linked_at + interval '30 days'
                               when 2 then p_link.linked_at + interval '60 days' end,
    'expired', (v_lvl = 0 and v_age > interval '7 days') or (v_lvl = 1 and v_age > interval '30 days'));
end $$;

-- Gains en attente depuis 30 jours : validés. Grade recalculé.
create or replace function fiila.amb_refresh(a fiila.ambassadors) returns jsonb
language plpgsql set search_path = '' as $$
declare l fiila.ambassador_shops; v_shops jsonb := '[]'::jsonb; v_l2 int; v_l3 int; v_cancel int; v_total int; v_grade text;
begin
  for l in select * from fiila.ambassador_shops where ambassador_id = a.id order by linked_at desc loop
    v_shops := v_shops || jsonb_build_array(fiila.amb_eval(l));
  end loop;
  update fiila.ambassador_rewards set status = 'validated' where ambassador_id = a.id and status = 'pending' and validate_after <= now();
  select count(*) filter (where level = 2 and status <> 'cancelled'), count(*) filter (where level = 3 and status <> 'cancelled'),
         count(*) filter (where status = 'cancelled'), count(*)
    into v_l2, v_l3, v_cancel, v_total from fiila.ambassador_rewards where ambassador_id = a.id;
  v_grade := case when v_l3 >= 25 and (v_total = 0 or v_cancel::numeric / v_total < 0.05) then 'certifie'
                  when v_l2 >= 10 then 'confirme' else 'ambassadeur' end;
  if v_grade <> a.grade then update fiila.ambassadors set grade = v_grade where id = a.id; end if;
  return jsonb_build_object('shops', v_shops, 'grade', v_grade, 'l2', v_l2, 'l3', v_l3);
end $$;

create or replace function fiila.amb_json(a fiila.ambassadors) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('name', a.name, 'phone', a.phone, 'zone', a.zone, 'code', a.code, 'status', a.status,
    'grade', a.grade, 'payout_method', a.payout_method, 'payout_phone', a.payout_phone, 'quiz_score', a.quiz_score,
    'quiz_passed', a.quiz_passed_at is not null, 'note', a.note,
    'attempts_today', (select count(*) from fiila.ambassador_quiz q where q.ambassador_id = a.id and q.at > now() - interval '24 hours'),
    'rewards', jsonb_build_object(
      'pending',   (select coalesce(sum(amount), 0) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status = 'pending'),
      'validated', (select coalesce(sum(amount), 0) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status = 'validated'),
      'paid',      (select coalesce(sum(amount), 0) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status = 'paid')),
    'amounts', jsonb_build_array(fiila.setting_int('amb_reward_1'), fiila.setting_int('amb_reward_2'), fiila.setting_int('amb_reward_3')),
    'history', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('shop', r.shop_name, 'level', r.level, 'amount', r.amount,
        'status', r.status, 'earned_at', r.earned_at, 'validate_after', r.validate_after, 'paid_at', r.paid_at, 'reason', r.reason))
        order by r.earned_at desc), '[]'::jsonb) from (select * from fiila.ambassador_rewards r where r.ambassador_id = a.id order by earned_at desc limit 50) r)))
$$;

-- ---------------------------------------------------------------- API ambassadeur
-- Espace ambassadeur : état complet (null si pas inscrit).
create or replace function public.fiila_ambassador_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); v jsonb;
begin
  perform fiila.read_check();
  if a.id is null then return jsonb_build_object('ambassador', null); end if;
  v := case when a.status in ('active', 'suspended') then fiila.amb_refresh(a) else null end;
  select * into a from fiila.ambassadors where id = a.id;
  return jsonb_build_object('ambassador', fiila.amb_json(a) || coalesce(v, '{}'::jsonb));
end $$;

-- Inscription : compte obligatoire, charte acceptée. p : {name, phone, zone, payout_method, payout_phone, charter: true}
create or replace function public.fiila_ambassador_register(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); a fiila.ambassadors; v_name text; v_phone text; v_pay text;
begin
  perform fiila.rate_check('ambassador_register', 10);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if coalesce((p ->> 'charter')::boolean, false) is not true then perform fiila.fail('charter_required'); end if;
  v_name := fiila.clean(p ->> 'name', 60);
  if v_name is null then perform fiila.fail('name_required'); end if;
  v_phone := fiila.clean_phone(p ->> 'phone');
  if nullif(fiila.phone_key(v_phone), '') is null or length(fiila.phone_key(v_phone)) < 9 then perform fiila.fail('phone_required'); end if;
  v_pay := fiila.clean_phone(coalesce(nullif(p ->> 'payout_phone', ''), p ->> 'phone'));
  if coalesce(p ->> 'payout_method', '') not in ('wave', 'orange_money') then perform fiila.fail('invalid_payout'); end if;
  -- Un numéro = un ambassadeur.
  if exists (select 1 from fiila.ambassadors where fiila.phone_key(phone) = fiila.phone_key(v_phone) and user_id <> v_uid) then
    perform fiila.fail('phone_taken'); end if;
  select * into a from fiila.ambassadors where user_id = v_uid for update;
  if a.id is null then
    insert into fiila.ambassadors (user_id, code, name, phone, zone, payout_method, payout_phone)
    values (v_uid, fiila.ref_code(), v_name, v_phone, fiila.clean(p ->> 'zone', 60), p ->> 'payout_method', v_pay) returning * into a;
  else
    if a.status = 'excluded' then perform fiila.fail('not_allowed'); end if;
    update fiila.ambassadors set name = v_name, zone = fiila.clean(p ->> 'zone', 60), payout_method = p ->> 'payout_method', payout_phone = v_pay
     where id = a.id returning * into a;   -- le numéro principal ne change pas après l'inscription
  end if;
  return jsonb_build_object('ambassador', fiila.amb_json(a));
end $$;

-- Test de passage : 10 réponses (indices), corrigées ici. 8/10 pour réussir ; 2 essais par 24 heures.
create or replace function public.fiila_ambassador_quiz(p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors := fiila.my_ambassador(); v_key integer[] := array[1,1,0,1,0,1,1,1,1,0]; v_score int := 0; i int;
begin
  if a.id is null then perform fiila.fail('not_found'); end if;
  if a.status <> 'training' then perform fiila.fail('quiz_done'); end if;
  if (select count(*) from fiila.ambassador_quiz where ambassador_id = a.id and at > now() - interval '24 hours') >= 2 then
    perform fiila.fail('quiz_wait'); end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> 10 then perform fiila.fail('invalid_payload'); end if;
  for i in 1..10 loop if (p_answers ->> (i - 1)) = v_key[i]::text then v_score := v_score + 1; end if; end loop;
  insert into fiila.ambassador_quiz (ambassador_id, score) values (a.id, v_score);
  update fiila.ambassadors set quiz_score = v_score,
    quiz_passed_at = case when v_score >= 8 then now() end,
    status = case when v_score >= 8 then 'review' else status end
   where id = a.id;
  -- On ne renvoie que le score : jamais les bonnes réponses.
  return jsonb_build_object('score', v_score, 'passed', v_score >= 8);
end $$;

-- Lien commerçant ↔ ambassadeur, par le commerçant (clé de boutique ou compte), avec le code de l'ambassadeur.
create or replace function public.fiila_ambassador_link(p_key text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); a fiila.ambassadors; v_month int;
begin
  perform fiila.rate_check('ambassador_link', 20);
  select * into a from fiila.ambassadors where code = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  if a.id is null or a.status <> 'active' then perform fiila.fail('ambassador_unknown'); end if;
  if exists (select 1 from fiila.ambassador_shops where shop_id = s.id) then perform fiila.fail('ambassador_already'); end if;
  if s.created_at < now() - interval '7 days' then perform fiila.fail('ambassador_too_late'); end if;
  if s.demo then perform fiila.fail('ambassador_unknown'); end if;
  -- Jamais soi-même : même compte, ou le numéro de la boutique est celui de l'ambassadeur.
  if s.user_id = a.user_id or fiila.uid() = a.user_id
     or (nullif(fiila.phone_key(s.phone), '') is not null and fiila.phone_key(s.phone) = fiila.phone_key(a.phone)) then
    perform fiila.fail('ambassador_self'); end if;
  select count(*) into v_month from fiila.ambassador_shops where ambassador_id = a.id and linked_at > date_trunc('month', now());
  if v_month >= fiila.setting_int('amb_monthly_cap') then perform fiila.fail('ambassador_cap'); end if;
  insert into fiila.ambassador_shops (ambassador_id, shop_id) values (a.id, s.id);
  return jsonb_build_object('linked', true, 'ambassador', split_part(a.name, ' ', 1));
end $$;

-- Boutique : son ambassadeur (prénom) s'il y en a un.
create or replace function public.fiila_shop_ambassador(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); v text;
begin
  select split_part(a.name, ' ', 1) into v from fiila.ambassador_shops l join fiila.ambassadors a on a.id = l.ambassador_id where l.shop_id = s.id;
  return jsonb_strip_nulls(jsonb_build_object('ambassador', v, 'can_link', v is null and s.created_at >= now() - interval '7 days'));
end $$;

-- Classement : les 10 premiers ambassadeurs actifs par commerçants actifs (niveau 2) sur 90 jours ; prénom et zone seulement.
create or replace function public.fiila_ambassador_board() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fiila.read_check();
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', x.n, 'zone', x.z, 'grade', x.g, 'score', x.c)) order by x.c desc, x.n)
    from (select split_part(a.name, ' ', 1) n, a.zone z, a.grade g, count(r.id) c
            from fiila.ambassadors a left join fiila.ambassador_rewards r
              on r.ambassador_id = a.id and r.level = 2 and r.status <> 'cancelled' and r.earned_at > now() - interval '90 days'
           where a.status = 'active' group by a.id having count(r.id) > 0 order by c desc limit 10) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- API fondateur (administrateur)
create or replace function public.fiila_admin_ambassadors() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a fiila.ambassadors;
begin
  perform fiila.need_admin();
  for v_a in select * from fiila.ambassadors where status in ('active', 'suspended') loop perform fiila.amb_refresh(v_a); end loop;
  return jsonb_build_object(
    'ambassadors', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'name', a.name, 'phone', a.phone, 'zone', a.zone,
        'code', a.code, 'status', a.status, 'grade', a.grade, 'quiz_score', a.quiz_score, 'created_at', a.created_at,
        'payout_method', a.payout_method, 'payout_phone', a.payout_phone, 'note', a.note,
        'shops', (select count(*) from fiila.ambassador_shops l where l.ambassador_id = a.id),
        'month', (select count(*) from fiila.ambassador_shops l where l.ambassador_id = a.id and l.linked_at > date_trunc('month', now())),
        'cancelled', (select count(*) from fiila.ambassador_rewards r where r.ambassador_id = a.id and r.status = 'cancelled')))
        order by (a.status = 'review') desc, a.created_at desc) from fiila.ambassadors a), '[]'::jsonb),
    'to_pay', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ambassador', a.name, 'payout_method', a.payout_method,
        'payout_phone', a.payout_phone, 'shop', r.shop_name, 'level', r.level, 'amount', r.amount, 'earned_at', r.earned_at) order by a.name, r.earned_at)
        from fiila.ambassador_rewards r join fiila.ambassadors a on a.id = r.ambassador_id
       where r.status = 'validated' and a.status = 'active'), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ambassador', a.name, 'shop', r.shop_name, 'level', r.level,
        'amount', r.amount, 'validate_after', r.validate_after) order by r.validate_after)
        from fiila.ambassador_rewards r join fiila.ambassadors a on a.id = r.ambassador_id where r.status = 'pending'), '[]'::jsonb),
    'settings', jsonb_build_object('rewards', jsonb_build_array(fiila.setting_int('amb_reward_1'), fiila.setting_int('amb_reward_2'), fiila.setting_int('amb_reward_3')),
        'monthly_cap', fiila.setting_int('amb_monthly_cap')));
end $$;

-- Décision sur un ambassadeur : approve (après le test), suspend, reactivate, exclude (les gains non versés sont annulés).
create or replace function public.fiila_admin_ambassador_decide(p_id text, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a fiila.ambassadors;
begin
  perform fiila.need_admin();
  select * into a from fiila.ambassadors where id = fiila.as_uuid(p_id) for update;
  if a.id is null then perform fiila.fail('not_found'); end if;
  if p_decision = 'approve' then
    if a.status <> 'review' then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'active', approved_at = now(), note = fiila.clean(p_note, 200) where id = a.id;
  elsif p_decision = 'suspend' then
    update fiila.ambassadors set status = 'suspended', note = fiila.clean(p_note, 200) where id = a.id;
  elsif p_decision = 'reactivate' then
    if a.status <> 'suspended' then perform fiila.fail('invalid_state'); end if;
    update fiila.ambassadors set status = 'active', note = fiila.clean(p_note, 200) where id = a.id;
  elsif p_decision = 'exclude' then
    update fiila.ambassadors set status = 'excluded', note = fiila.clean(p_note, 200) where id = a.id;
    update fiila.ambassador_rewards set status = 'cancelled', reason = coalesce(fiila.clean(p_note, 200), 'Exclusion')
     where ambassador_id = a.id and status in ('pending', 'validated');
  else perform fiila.fail('invalid_payload');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Gains : marquer versés (après le versement Wave / Orange Money fait à la main), ou annuler (fraude, boutique fausse).
create or replace function public.fiila_admin_reward(p_ids jsonb, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int; v_ids uuid[];
begin
  perform fiila.need_admin();
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then perform fiila.fail('invalid_payload'); end if;
  select coalesce(array_agg(fiila.as_uuid(x)), '{}') into v_ids from jsonb_array_elements_text(p_ids) x;
  if p_action = 'paid' then
    update fiila.ambassador_rewards set status = 'paid', paid_at = now() where id = any (v_ids) and status = 'validated';
  elsif p_action = 'cancel' then
    if nullif(trim(coalesce(p_reason, '')), '') is null then perform fiila.fail('reason_required'); end if;
    update fiila.ambassador_rewards set status = 'cancelled', reason = fiila.clean(p_reason, 200) where id = any (v_ids) and status in ('pending', 'validated');
  else perform fiila.fail('invalid_payload');
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_ambassador_me()', 'public.fiila_ambassador_register(jsonb)', 'public.fiila_ambassador_quiz(jsonb)',
    'public.fiila_ambassador_link(text, text)', 'public.fiila_shop_ambassador(text)', 'public.fiila_ambassador_board()',
    'public.fiila_admin_ambassadors()', 'public.fiila_admin_ambassador_decide(text, text, text)', 'public.fiila_admin_reward(jsonb, text, text)'];
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
