-- Vide-dressing ouvert à tout type d'article (fondateur, 20/10/2026 23:36 : « Le vide-dressing est ouvert à tout type
-- d'articles. Les enfants sont juste une catégorie »). Chaque article a une catégorie (celles des boutiques, sans
-- l'alimentation) ; le genre (fille, garçon, mixte) et la tranche d'âge restent obligatoires pour la catégorie « Enfants »
-- seulement. Les articles déjà déposés deviennent « Enfants ». Mêmes garde-fous : vérification avant publication, photo
-- contrôlée (aucune personne reconnaissable), articles interdits, un exemplaire par annonce.

alter table fiila.vd_submissions
  add column category text not null default 'enfants'
    check (category in ('mode', 'chaussures', 'beaute', 'maison', 'electronique', 'accessoires', 'enfants', 'autre'));
alter table fiila.vd_submissions alter column gender drop not null, alter column age_band drop not null;
alter table fiila.vd_submissions add constraint vd_submissions_child_details
  check (category <> 'enfants' or (gender is not null and age_band is not null));

update fiila.shops set about = 'Articles de seconde main vérifiés par Fii La : vêtements, chaussures, maison, électronique, enfants… Livrés à la bonne porte.',
  business_type = 'autre'
 where platform and slug = 'vide-dressing';

create or replace function fiila.vd_json(v fiila.vd_submissions, p_photo boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', v.id, 'title', v.title, 'category', v.category, 'gender', v.gender, 'age_band', v.age_band, 'size', v.size,
    'condition', v.condition, 'price', v.price, 'quartier', v.quartier, 'status', v.status, 'reason', v.reason,
    'net', v.price - (v.price * fiila.setting_int('vd_commission') / 100), 'created_at', v.created_at, 'sold_at', v.sold_at, 'paid_at', v.paid_at,
    'photo', case when p_photo then 'data:' || v.photo_type || ';base64,' || replace(encode(v.photo, 'base64'), E'\n', '') end))
$$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_vd_submit(jsonb)'::regprocedure) into v_def;
  v_new := v_def;
  v_new := replace(v_new, $s$declare v_uid uuid := fiila.need_uid();$s$,
    $s$declare v_cat text := coalesce(nullif(p ->> 'category', ''), 'enfants'); v_uid uuid := fiila.need_uid();$s$);
  v_new := replace(v_new, $s$  if coalesce(p ->> 'gender', '') not in$s$,
    $s$  if v_cat not in ('mode', 'chaussures', 'beaute', 'maison', 'electronique', 'accessoires', 'enfants', 'autre') then perform fiila.fail('vd_category_required'); end if;
  if v_cat = 'enfants' and coalesce(p ->> 'gender', '') not in$s$);
  v_new := replace(v_new, $s$  if coalesce(p ->> 'age_band', '') not in$s$, $s$  if v_cat = 'enfants' and coalesce(p ->> 'age_band', '') not in$s$);
  v_new := replace(v_new, $s$(user_id, seller_name, seller_phone, quartier, title, gender, age_band,$s$,
    $s$(user_id, seller_name, seller_phone, quartier, title, category, gender, age_band,$s$);
  v_new := replace(v_new, $s$v_title, p ->> 'gender', p ->> 'age_band',$s$,
    $s$v_title, v_cat, case when v_cat = 'enfants' then p ->> 'gender' end, case when v_cat = 'enfants' then p ->> 'age_band' end,$s$);
  v_new := replace(v_new, $s$set title = v_title, gender = p ->> 'gender', age_band = p ->> 'age_band',$s$,
    $s$set title = v_title, category = v_cat, gender = case when v_cat = 'enfants' then p ->> 'gender' end, age_band = case when v_cat = 'enfants' then p ->> 'age_band' end,$s$);
  if (length(v_new) - length(v_def)) < 400 or v_new !~ 'category = v_cat' or v_new !~ 'v_cat = ''enfants'' and coalesce\(p ->> ''age_band''' then
    raise exception 'vd_open: fiila_vd_submit non modifiée entièrement';
  end if;
  execute v_new;

  select pg_get_functiondef('public.fiila_admin_vd_decide(text, text, text)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$values (s.id, v.title, v.price, null, 'enfants', case when v.size$s$, $s$values (s.id, v.title, v.price, null, v.category, case when v.size$s$);
  if v_new = v_def then raise exception 'vd_open: fiila_admin_vd_decide non modifiée'; end if;
  execute v_new;
end $$;
