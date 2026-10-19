-- Fii La : fil façon Instagram (fondateur, 19/10/2026 09:34 : « le feed ressemble au feed d'Instagram, avec le nombre
-- de j'aime, de commentaires et d'enregistrements, le classement des best-sellers et des coups de cœur »).
--
-- Une publication = un article avec photo d'une boutique du fil (mêmes règles que fiila_feed : vitrine ouverte,
-- place du fil, ou boutique de la plateforme ; boutiques de démonstration seulement en mode démo).
--
-- Règles :
-- - J'aime et Enregistrer : sans compte (comme tout Fii La). Le téléphone envoie un identifiant aléatoire qu'il garde ;
--   la base n'en garde que l'empreinte. Avec un compte, c'est le compte qui compte (suivi sur tous ses appareils).
-- - Commenter : compte obligatoire (un commentaire public engage un nom). 300 caractères, ni lien ni numéro de téléphone
--   (pas de vente hors plateforme, pas d'arnaque). Signalé par 3 personnes : masqué en attendant une revue.
--   Supprimable par son auteur, par la boutique (sur ses articles) et par l'administrateur.
-- - Meilleures ventes : quantités des commandes LIVRÉES sur 30 jours (une commande ouverte peut être fictive),
--   5 au plus par commande pour le classement.
-- - Coups de cœur : sur 14 jours, j'aime + 2 × enregistrements + 2 × commentaires visibles.
-- - Aucun chiffre inventé : une boutique de démonstration n'a que les réactions réelles.

create table fiila.likes (
  product_id uuid not null references fiila.products (id) on delete cascade,
  who        text not null,                 -- 'u:<compte>' ou 'd:<empreinte de l'appareil>'
  created_at timestamptz not null default now(),
  primary key (product_id, who)
);
create index likes_recent on fiila.likes (created_at);
create table fiila.saves (
  product_id uuid not null references fiila.products (id) on delete cascade,
  who        text not null,
  created_at timestamptz not null default now(),
  primary key (product_id, who)
);
create index saves_who on fiila.saves (who, created_at desc);
create table fiila.comments (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references fiila.products (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_product on fiila.comments (product_id, created_at);
create table fiila.comment_reports (
  comment_id uuid not null references fiila.comments (id) on delete cascade,
  who        text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, who)
);
revoke all on fiila.likes, fiila.saves, fiila.comments, fiila.comment_reports from public;

-- Qui réagit : le compte s'il y en a un, sinon l'empreinte de l'identifiant de l'appareil (jamais gardé en clair).
create or replace function fiila.who(p_device text) returns text
language plpgsql stable set search_path = '' as $$
declare v_uid uuid := fiila.uid();
begin
  if v_uid is not null then return 'u:' || v_uid; end if;
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{22,64}$' then return null; end if;
  return 'd:' || encode(fiila.h(p_device), 'hex');
end $$;

-- Article publiable dans le fil (photo, actif, boutique visible dans le fil).
create or replace function fiila.post_ok(p_product uuid, p_demo boolean) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from fiila.products p join fiila.shops s on s.id = p.shop_id
    where p.id = p_product and p.active and p.photo is not null
      and s.public and s.feed and s.slug is not null
      and ((s.featured_rank is not null and not s.demo) or s.platform or (coalesce(p_demo, false) and s.demo)))
$$;

-- Chiffres d'un article.
create or replace function fiila.post_stats(p_product uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'likes', (select count(*) from fiila.likes where product_id = p_product),
    'saves', (select count(*) from fiila.saves where product_id = p_product),
    'comments', (select count(*) from fiila.comments where product_id = p_product and not hidden),
    'sold', (select coalesce(sum(least((it ->> 'qty')::int, 5)), 0) from fiila.orders o, jsonb_array_elements(o.items) it
              where o.status = 'delivered' and o.delivered_at > now() - interval '30 days' and (it ->> 'product_id') = p_product::text))
$$;

-- Le fil. p_tab : 'pour-vous' (récent et apprécié, 3 articles au plus par boutique en tête), 'ventes', 'coeur'.
create or replace function public.fiila_posts(p_tab text default 'pour-vous', p_device text default null,
  p_demo boolean default false, p_page int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device); v_tab text := coalesce(p_tab, 'pour-vous'); v_page int := greatest(0, least(coalesce(p_page, 0), 20));
begin
  perform fiila.read_check();
  if v_tab not in ('pour-vous', 'ventes', 'coeur') then v_tab := 'pour-vous'; end if;
  return jsonb_build_object('tab', v_tab, 'posts', coalesce((
    with base as (
      select p.id, p.name, p.price, p.updated_at, p.shop_id, s.slug, s.name shop_name, s.accent, s.business_type, s.demo, s.platform,
        (select count(*) from fiila.likes l where l.product_id = p.id) likes,
        (select count(*) from fiila.saves v where v.product_id = p.id) saves,
        (select count(*) from fiila.comments c where c.product_id = p.id and not c.hidden) comments,
        (select coalesce(sum(least((it ->> 'qty')::int, 5)), 0) from fiila.orders o, jsonb_array_elements(o.items) it
          where o.shop_id = p.shop_id and o.status = 'delivered' and o.delivered_at > now() - interval '30 days'
            and (it ->> 'product_id') = p.id::text) sold,
        (select count(*) from fiila.likes l where l.product_id = p.id and l.created_at > now() - interval '14 days')
          + 2 * (select count(*) from fiila.saves v where v.product_id = p.id and v.created_at > now() - interval '14 days')
          + 2 * (select count(*) from fiila.comments c where c.product_id = p.id and not c.hidden and c.created_at > now() - interval '14 days') love
      from fiila.products p join fiila.shops s on s.id = p.shop_id
      where p.active and p.photo is not null and s.public and s.feed and s.slug is not null
        and ((s.featured_rank is not null and not s.demo) or s.platform or (coalesce(p_demo, false) and s.demo))
    ), ranked as (
      select b.*,
        rank() over (order by b.sold desc) sold_rank, rank() over (order by b.love desc) love_rank,
        row_number() over (partition by b.shop_id order by b.updated_at desc) nth,
        (b.likes + 2 * b.saves + 3 * b.comments + 1) / power(extract(epoch from now() - b.updated_at) / 3600 + 2, 1.2) score
      from base b
    ), picked as (
      select r.* from ranked r
      where (v_tab = 'pour-vous') or (v_tab = 'ventes' and r.sold > 0) or (v_tab = 'coeur' and r.love > 0)
      order by
        case when v_tab = 'ventes' then r.sold when v_tab = 'coeur' then r.love end desc nulls last,
        case when v_tab = 'pour-vous' then (r.nth > 3)::int end,
        case when v_tab = 'pour-vous' then r.score end desc,
        r.updated_at desc, r.id
      limit 30 offset v_page * 30
    )
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', k.id, 'name', k.name, 'price', k.price,
      'shop', jsonb_strip_nulls(jsonb_build_object('slug', k.slug, 'name', k.shop_name, 'accent', k.accent, 'type', k.business_type,
        'demo', case when k.demo then true end, 'platform', case when k.platform then true end)),
      'likes', k.likes, 'saves', k.saves, 'comments', k.comments, 'sold', nullif(k.sold, 0),
      'best', case when k.sold > 0 and k.sold_rank <= 10 then true end,
      'heart', case when k.love > 0 and k.love_rank <= 10 then true end,
      'liked', case when v_who is not null and exists (select 1 from fiila.likes l where l.product_id = k.id and l.who = v_who) then true end,
      'saved', case when v_who is not null and exists (select 1 from fiila.saves v where v.product_id = k.id and v.who = v_who) then true end))
      order by k.ord)
    from (select picked.*, row_number() over () ord from picked) k), '[]'::jsonb));
end $$;

-- J'aime / retirer (p_on), Enregistrer / retirer. Renvoie les chiffres à jour.
create or replace function public.fiila_react(p_product uuid, p_kind text, p_on boolean, p_device text default null, p_demo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device);
begin
  if v_who is null then perform fiila.fail('device_required'); end if;
  if p_kind not in ('like', 'save') then perform fiila.fail('invalid_kind'); end if;
  if not fiila.post_ok(p_product, p_demo) then perform fiila.fail('not_found'); end if;
  perform fiila.rate_check('react', 300);
  if p_kind = 'like' then
    if p_on then insert into fiila.likes (product_id, who) values (p_product, v_who) on conflict do nothing;
    else delete from fiila.likes where product_id = p_product and who = v_who; end if;
  else
    if p_on then insert into fiila.saves (product_id, who) values (p_product, v_who) on conflict do nothing;
    else delete from fiila.saves where product_id = p_product and who = v_who; end if;
  end if;
  return fiila.post_stats(p_product) || jsonb_strip_nulls(jsonb_build_object(
    'liked', case when exists (select 1 from fiila.likes where product_id = p_product and who = v_who) then true end,
    'saved', case when exists (select 1 from fiila.saves where product_id = p_product and who = v_who) then true end));
end $$;

-- Mes enregistrements (articles encore visibles).
create or replace function public.fiila_saved(p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device);
begin
  perform fiila.read_check();
  if v_who is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price,
      'shop', jsonb_build_object('slug', s.slug, 'name', s.name))) order by v.created_at desc)
    from fiila.saves v join fiila.products p on p.id = v.product_id join fiila.shops s on s.id = p.shop_id
    where v.who = v_who and p.active and p.photo is not null and s.public and s.slug is not null), '[]'::jsonb);
end $$;

-- Commentaires visibles d'un article. p_key (facultatif) : la boutique qui consulte peut supprimer.
create or replace function public.fiila_comments(p_product uuid, p_key text default null, p_device text default null, p_demo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); v_shop boolean; v_admin boolean; v_who text := fiila.who(p_device);
begin
  perform fiila.read_check();
  if not fiila.post_ok(p_product, p_demo) then return jsonb_build_object('state', 'not_found'); end if;
  select exists (select 1 from fiila.products p join fiila.shops s on s.id = p.shop_id where p.id = p_product
      and ((p_key is not null and char_length(p_key) <= 100 and s.owner_hash = fiila.h(p_key)) or (v_uid is not null and s.user_id = v_uid)))
    into v_shop;
  v_admin := v_uid is not null and exists (select 1 from fiila.profiles where user_id = v_uid and is_admin);
  return jsonb_build_object('state', 'ok', 'can_comment', v_uid is not null, 'shop', case when v_shop then true else false end,
    'comments', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', c.id, 'body', c.body, 'at', c.created_at,
        'author', coalesce(nullif(split_part(trim(pf.display_name), ' ', 1), ''), 'Membre'),
        'mine', case when c.user_id = v_uid then true end,
        'can_delete', case when c.user_id = v_uid or v_shop or v_admin then true end,
        'reported', case when v_who is not null and exists (select 1 from fiila.comment_reports r where r.comment_id = c.id and r.who = v_who) then true end))
        order by c.created_at)
      from fiila.comments c left join fiila.profiles pf on pf.user_id = c.user_id
      where c.product_id = p_product and not c.hidden), '[]'::jsonb));
end $$;

create or replace function public.fiila_comment_add(p_product uuid, p_body text, p_demo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_uid(); v_body text := fiila.clean(p_body, 2000); v_id uuid;
begin
  if not fiila.post_ok(p_product, p_demo) then perform fiila.fail('not_found'); end if;
  if v_body is null then perform fiila.fail('comment_empty'); end if;
  if char_length(v_body) > 300 then perform fiila.fail('comment_too_long'); end if;
  -- Pas de lien ni de numéro : la vente et le contact restent sur Fii La (protection des clientes).
  if v_body ~* '(https?://|www\.|\.(com|sn|net|org|io|me|ly)\b)' or regexp_replace(v_body, '[^0-9]', '', 'g') ~ '[0-9]{8,}' then
    perform fiila.fail('comment_contact');
  end if;
  if not exists (select 1 from fiila.profiles where user_id = v_uid and nullif(trim(display_name), '') is not null) then
    perform fiila.fail('name_required');
  end if;
  perform fiila.rate_check('comment', 20);
  insert into fiila.comments (product_id, user_id, body) values (p_product, v_uid, v_body) returning id into v_id;
  return jsonb_build_object('id', v_id) || fiila.post_stats(p_product);
end $$;

create or replace function public.fiila_comment_delete(p_id uuid, p_key text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.uid(); c fiila.comments;
begin
  select * into c from fiila.comments where id = p_id;
  if not found then perform fiila.fail('not_found'); end if;
  if not ((v_uid is not null and c.user_id = v_uid)
       or exists (select 1 from fiila.products p join fiila.shops s on s.id = p.shop_id where p.id = c.product_id
            and ((p_key is not null and char_length(p_key) <= 100 and s.owner_hash = fiila.h(p_key)) or (v_uid is not null and s.user_id = v_uid)))
       or (v_uid is not null and exists (select 1 from fiila.profiles where user_id = v_uid and is_admin))) then
    perform fiila.fail('not_allowed');
  end if;
  perform fiila.rate_check('comment_delete', 120);
  delete from fiila.comments where id = p_id;
  return fiila.post_stats(c.product_id);
end $$;

-- Signaler : 3 signalements de personnes différentes masquent le commentaire.
create or replace function public.fiila_comment_report(p_id uuid, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_who text := fiila.who(p_device);
begin
  if v_who is null then perform fiila.fail('device_required'); end if;
  if not exists (select 1 from fiila.comments where id = p_id) then perform fiila.fail('not_found'); end if;
  perform fiila.rate_check('comment_report', 30);
  insert into fiila.comment_reports (comment_id, who) values (p_id, v_who) on conflict do nothing;
  update fiila.comments set hidden = true where id = p_id and (select count(*) from fiila.comment_reports where comment_id = p_id) >= 3;
  return jsonb_build_object('hidden', (select hidden from fiila.comments where id = p_id));
end $$;

-- Chiffres d'un article pour sa boutique (page article et tableau de bord).
create or replace function public.fiila_product_stats(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key);
begin
  if not exists (select 1 from fiila.products where id = p_id and shop_id = s.id) then perform fiila.fail('not_found'); end if;
  return fiila.post_stats(p_id);
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_posts(text, text, boolean, integer)', 'public.fiila_react(uuid, text, boolean, text, boolean)',
    'public.fiila_saved(text)', 'public.fiila_comments(uuid, text, text, boolean)', 'public.fiila_comment_add(uuid, text, boolean)',
    'public.fiila_comment_delete(uuid, text)', 'public.fiila_comment_report(uuid, text)', 'public.fiila_product_stats(text, uuid)'];
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
