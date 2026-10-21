-- Mandat AGENTS-AMBASSADEURS-001, lot 2 (fondateur, 21/10/2026 04:27) : le programme rémunéré « Ambassadeurs » devient
-- « Agents ». Tables internes inchangées (ambassadors, ambassador_shops…) : seuls les libellés changent, côté application.
--
-- Correctif des règles de gain (mandat §3) : « un gain dépend de la date où l'éligibilité est atteinte, pas de la date
-- d'ouverture d'un tableau de bord ». Avant : le niveau 1 exigeait « conditions remplies ET lien de moins de 7 jours » au
-- moment du calcul (ouverture de l'espace) ; le niveau 2 « moins de 30 jours » ; le niveau 3 comptait les 8 semaines avant
-- aujourd'hui. Après :
--   niveau 1 : la date où les conditions sont remplies est enregistrée quand elle arrive (déclencheurs sur articles, boutique
--              et rattachement) ; gain si cette date est dans les 7 jours du lien, quel que soit le jour du calcul ;
--   niveau 2 : les commandes comptées sont déjà celles des 30 premiers jours : plus de condition sur le jour du calcul ;
--   niveau 3 : il suffit qu'à un jour quelconque entre le 60e et le 120e jour, 4 des 8 semaines précédentes aient une commande.
-- Montants, seuils et délais approuvés inchangés.

alter table fiila.ambassador_shops add column l1_at timestamptz;

-- Enregistre la date d'éligibilité au niveau 1 d'une boutique accompagnée (une seule fois, dans les 7 jours du lien).
create or replace function fiila.amb_stamp(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l fiila.ambassador_shops; s fiila.shops; v_photos int;
begin
  select * into l from fiila.ambassador_shops where shop_id = p_shop;
  if l.id is null or l.l1_at is not null or now() > l.linked_at + interval '7 days' then return; end if;
  select * into s from fiila.shops where id = p_shop;
  select count(*) into v_photos from fiila.products where shop_id = p_shop and active and photo is not null;
  if s.business_type is not null and s.public and v_photos >= 5 then
    update fiila.ambassador_shops set l1_at = now() where id = l.id;
  end if;
end $$;
revoke all on function fiila.amb_stamp(uuid) from public;

create or replace function fiila.amb_stamp_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'products' then perform fiila.amb_stamp(new.shop_id);
  elsif tg_table_name = 'shops' then perform fiila.amb_stamp(new.id);
  elsif tg_table_name = 'ambassador_shops' then perform fiila.amb_stamp(new.shop_id);
  end if;
  return null;
end $$;
revoke all on function fiila.amb_stamp_trg() from public;

create trigger amb_stamp_products after insert or update of active, photo on fiila.products
  for each row execute function fiila.amb_stamp_trg();
create trigger amb_stamp_shops after update of public, business_type on fiila.shops
  for each row when (new.public and new.business_type is not null) execute function fiila.amb_stamp_trg();
create trigger amb_stamp_link after insert on fiila.ambassador_shops
  for each row execute function fiila.amb_stamp_trg();

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('fiila.amb_eval(fiila.ambassador_shops)'::regprocedure) into v_def;
  v_new := v_def;
  -- Niveau 3 : fenêtre glissante, à n'importe quel jour entre le 60e et le 120e.
  v_new := replace(v_new, $s$  select count(distinct date_trunc('week', created_at)) into v_weeks
    from fiila.amb_orders(p_link, a) where created_at > now() - interval '56 days';
  v_l3 := v_age >= interval '60 days' and v_weeks >= 4;$s$, $s$  select coalesce(max(x.w), 0) into v_weeks from (
    select (select count(distinct date_trunc('week', o.created_at)) from fiila.amb_orders(p_link, a) o
             where o.created_at > d - interval '56 days' and o.created_at <= d) w
      from generate_series(p_link.linked_at + interval '60 days', least(now(), p_link.linked_at + interval '120 days'), interval '1 day') d) x;
  v_l3 := v_age >= interval '60 days' and v_weeks >= 4;$s$);
  v_new := replace(v_new, $s$if (v_l1 and v_age <= interval '7 days') or exists$s$,
    $s$if (v_l1 and v_age <= interval '7 days') or (p_link.l1_at is not null and p_link.l1_at <= p_link.linked_at + interval '7 days') or exists$s$);
  v_new := replace(v_new, $s$((v_l2 and v_age <= interval '30 days') or exists$s$, $s$(v_l2 or exists$s$);
  v_new := replace(v_new, $s$((v_l3 and v_age <= interval '120 days') or exists$s$, $s$(v_l3 or exists$s$);
  if v_new !~ 'l1_at is not null' or v_new ~ 'v_l2 and v_age' or v_new ~ 'v_l3 and v_age' or v_new !~ 'generate_series' then
    raise exception 'agents: fiila.amb_eval non modifiée entièrement';
  end if;
  execute v_new;
end $$;

-- Boutiques déjà rattachées et déjà éligibles : date enregistrée maintenant (sans effet en production : aucun rattachement au 21/10).
select fiila.amb_stamp(shop_id) from fiila.ambassador_shops;

-- Libellés côté serveur : « Code ambassadeur » devient « Code agent » (explication du test, réponse du Manager sans IA).
do $$
declare v_def text; v_new text; fn text;
begin
  foreach fn in array array['fiila.amb_quiz_why(integer)', 'fiila.amb_rule_reply(fiila.ambassadors, text, text[])'] loop
    select pg_get_functiondef(fn::regprocedure) into v_def;
    v_new := replace(v_def, '« Code ambassadeur »', '« Code agent »');
    if v_new = v_def then raise exception 'agents: % non modifiée', fn; end if;
    execute v_new;
  end loop;
end $$;
