-- Photos publiques dans Supabase Storage (fondateur, 22/10/2026 00:08, « Oui go »), étape 1.
-- Photos d'articles (principale + supplémentaires) et couvertures de vitrine : copiées dans le seau public « media »,
-- servies par adresse fixe avec mise en cache (CDN + téléphone) au lieu d'un texte base64 renvoyé par la base à chaque vue.
-- Les photos privées (porte d'une adresse, repère vocal, avatar) RESTENT dans la base, derrière les contrôles actuels.
-- Fonctionnement :
--   * l'envoi ne change pas (la base valide et garde la photo) ;
--   * la fonction Edge fiila-media-sync (toutes les minutes, ou depuis le back-office) copie les photos en attente dans le
--     seau, à une adresse qui contient l'empreinte du contenu (une photo modifiée = une nouvelle adresse, jamais de cache
--     périmé), puis enregistre l'adresse ; elle supprime aussi du seau les photos qui ne servent plus (article supprimé) ;
--   * les fonctions de lecture renvoient l'adresse du seau si elle existe, sinon la photo comme avant ;
--   * réglage media_cdn = 0 : retour immédiat aux photos servies par la base, sans redéploiement.
-- Étape 1 : la photo reste aussi dans la base (sécurité, retour arrière) ; étape 2 (plus tard) : la retirer de la base.
-- Back-office (règle n° 8) : Réglages → « Photos (stockage) » : copiées, en attente, espace, erreurs, « Copier maintenant ».

alter table fiila.products add column if not exists photo_path text;
alter table fiila.product_photos add column if not exists path text;
alter table fiila.shops add column if not exists cover_path text;

create table if not exists fiila.media_objects (
  path text primary key,
  kind text not null check (kind in ('product', 'product_extra', 'cover')),
  ref text not null,
  bytes int not null,
  created_at timestamptz not null default now()
);
alter table fiila.media_objects enable row level security;

create table if not exists fiila.media_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('copied', 'removed', 'failed', 'run')),
  ref text,
  detail text
);
alter table fiila.media_log enable row level security;
create index if not exists media_log_at on fiila.media_log (at desc);

insert into fiila.settings (key, value) values ('media_cdn', '1') on conflict (key) do nothing;

-- Adresse publique d'une photo copiée, sinon la photo telle qu'avant (texte base64).
create or replace function fiila.media_src(p_path text, p_data bytea, p_type text) returns text
language sql stable set search_path = '' as $$
  select case
    when p_path is not null and coalesce(fiila.setting_int('media_cdn'), 1) = 1
         and (select value from fiila.settings where key = 'media_base') is not null
      then (select value from fiila.settings where key = 'media_base') || p_path
    when p_data is not null then 'data:' || p_type || ';base64,' || replace(encode(p_data, 'base64'), E'\n', '')
  end
$$;

-- Une photo modifiée perd son adresse : la nouvelle version sera copiée sous une nouvelle adresse.
create or replace function fiila.media_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'products' then
    if new.photo is distinct from old.photo then new.photo_path := null; end if;
  elsif tg_table_name = 'product_photos' then
    if new.data is distinct from old.data then new.path := null; end if;
  elsif tg_table_name = 'shops' then
    if new.cover is distinct from old.cover then new.cover_path := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists media_reset on fiila.products;
create trigger media_reset before update of photo on fiila.products for each row execute function fiila.media_reset();
drop trigger if exists media_reset on fiila.product_photos;
create trigger media_reset before update of data on fiila.product_photos for each row execute function fiila.media_reset();
drop trigger if exists media_reset on fiila.shops;
create trigger media_reset before update of cover on fiila.shops for each row execute function fiila.media_reset();

-- Lecture : l'adresse du seau quand elle existe.
do $$
declare v_def text; v_new text; r record;
begin
  for r in select * from (values
      ('fiila.product_json', $s$'data:' || p.photo_type || ';base64,' || replace(encode(p.photo, 'base64'), E'\n', '')$s$, $s$fiila.media_src(p.photo_path, p.photo, p.photo_type)$s$),
      ('fiila.items_with_photos', $s$'data:' || pr.photo_type || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '')$s$, $s$fiila.media_src(pr.photo_path, pr.photo, pr.photo_type)$s$),
      ('public.fiila_product_photos', $s$'data:' || x.ctype || ';base64,' || replace(encode(x.data, 'base64'), E'\n', '')$s$, $s$fiila.media_src(x.path, x.data, x.ctype)$s$),
      ('public.fiila_shop_vitrine', $s$'data:' || s.cover_type || ';base64,' || replace(encode(s.cover, 'base64'), E'\n', '')$s$, $s$fiila.media_src(s.cover_path, s.cover, s.cover_type)$s$),
      ('public.fiila_vitrine_photo', $s$'data:' || s.cover_type || ';base64,' || replace(encode(s.cover, 'base64'), E'\n', '')$s$, $s$fiila.media_src(s.cover_path, s.cover, s.cover_type)$s$),
      ('public.fiila_vitrine_photo', $s$'data:' || pr.photo_type || ';base64,' || replace(encode(pr.photo, 'base64'), E'\n', '')$s$, $s$fiila.media_src(pr.photo_path, pr.photo, pr.photo_type)$s$),
      ('public.fiila_vitrine_photo', $s$'data:' || x.ctype || ';base64,' || replace(encode(x.data, 'base64'), E'\n', '')$s$, $s$fiila.media_src(x.path, x.data, x.ctype)$s$)
    ) t(fn, old_expr, new_expr) loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname = r.fn;
    if v_def is null then raise exception 'media: fonction % introuvable', r.fn; end if;
    v_new := replace(v_def, r.old_expr, r.new_expr);
    if v_new = v_def then raise exception 'media: % non modifiée (%)', r.fn, left(r.old_expr, 40); end if;
    execute v_new;
  end loop;
end $$;

-- File d'attente pour la fonction Edge (clé de service uniquement) : photos à copier, avec leur contenu.
create or replace function public.fiila_media_pending(p_limit int default 8) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select * from (
      select 'product' kind, p.id::text ref, p.photo_type ctype, md5(p.photo) hash, encode(p.photo, 'base64') b64
        from fiila.products p where p.photo is not null and p.photo_path is null
      union all
      select 'product_extra', x.product_id::text || ':' || x.pos, x.ctype, md5(x.data), encode(x.data, 'base64')
        from fiila.product_photos x where x.path is null
      union all
      select 'cover', s.id::text, s.cover_type, md5(s.cover), encode(s.cover, 'base64')
        from fiila.shops s where s.cover is not null and s.cover_path is null
    ) q limit least(greatest(coalesce(p_limit, 8), 1), 20)
  ) x
$$;

-- Copie faite : l'adresse n'est enregistrée que si la photo n'a pas changé entre-temps (empreinte identique).
create or replace function public.fiila_media_done(p_kind text, p_ref text, p_hash text, p_path text, p_bytes int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_id uuid; v_pos int;
begin
  if p_path !~ '^(p|c)/[0-9a-f-]{36}(-[1-4])?-[0-9a-f]{32}\.(jpg|png|webp)$' then raise exception 'invalid' using errcode = '22023'; end if;
  if p_kind = 'product' then
    update fiila.products set photo_path = p_path where id = p_ref::uuid and md5(photo) = p_hash and photo_path is null;
  elsif p_kind = 'product_extra' then
    v_id := split_part(p_ref, ':', 1)::uuid; v_pos := split_part(p_ref, ':', 2)::int;
    update fiila.product_photos set path = p_path where product_id = v_id and pos = v_pos and md5(data) = p_hash and path is null;
  elsif p_kind = 'cover' then
    update fiila.shops set cover_path = p_path where id = p_ref::uuid and md5(cover) = p_hash and cover_path is null;
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  insert into fiila.media_objects (path, kind, ref, bytes) values (p_path, p_kind, p_ref, greatest(coalesce(p_bytes, 0), 0))
    on conflict (path) do nothing;
  if v_n = 1 then insert into fiila.media_log (action, ref) values ('copied', p_kind || ':' || p_ref); end if;
  return jsonb_build_object('ok', true, 'linked', v_n = 1);
end $$;

-- Photos du seau qui ne servent plus (article ou photo supprimés, photo remplacée).
create or replace function public.fiila_media_orphans(p_limit int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(m.path), '[]'::jsonb) from (
    select o.path from fiila.media_objects o
     where o.created_at < now() - interval '10 minutes'
       and not exists (select 1 from fiila.products p where p.photo_path = o.path)
       and not exists (select 1 from fiila.product_photos x where x.path = o.path)
       and not exists (select 1 from fiila.shops s where s.cover_path = o.path)
     order by o.created_at limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
$$;

create or replace function public.fiila_media_forget(p_paths jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_list text[] := array(select jsonb_array_elements_text(coalesce(p_paths, '[]'::jsonb)));
begin
  delete from fiila.media_objects o where o.path = any (v_list)
    and not exists (select 1 from fiila.products p where p.photo_path = o.path)
    and not exists (select 1 from fiila.product_photos x where x.path = o.path)
    and not exists (select 1 from fiila.shops s where s.cover_path = o.path);
  get diagnostics v_n = row_count;
  if v_n > 0 then insert into fiila.media_log (action, detail) values ('removed', v_n || ' photo(s) retirée(s) du stockage'); end if;
  return jsonb_build_object('ok', true, 'removed', v_n);
end $$;

create or replace function public.fiila_media_report(p_action text, p_ref text, p_detail text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('failed', 'run') then raise exception 'invalid' using errcode = '22023'; end if;
  if p_action = 'run' then
    insert into fiila.settings (key, value) values ('media_last_run', now()::text)
      on conflict (key) do update set value = excluded.value;
    if p_detail is null then return jsonb_build_object('ok', true); end if;
  end if;
  insert into fiila.media_log (action, ref, detail) values (p_action, left(p_ref, 120), left(p_detail, 300));
  delete from fiila.media_log where id < (select min(id) from (select id from fiila.media_log order by id desc limit 500) k);
  return jsonb_build_object('ok', true);
end $$;

-- Back-office : état du stockage des photos.
create or replace function public.fiila_bo_media() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := fiila.need_staff('settings');
begin
  return jsonb_build_object(
    'on', coalesce(fiila.setting_int('media_cdn'), 1) = 1,
    'ready', (select value from fiila.settings where key = 'media_base') is not null,
    'copied', (select count(*) from fiila.media_objects),
    'bytes', (select coalesce(sum(bytes), 0) from fiila.media_objects),
    'pending', (select count(*) from fiila.products where photo is not null and photo_path is null)
             + (select count(*) from fiila.product_photos where path is null)
             + (select count(*) from fiila.shops where cover is not null and cover_path is null),
    'last_run', (select value from fiila.settings where key = 'media_last_run'),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'ref', l.ref, 'detail', l.detail) order by l.at desc)
       from (select * from fiila.media_log where action = 'failed' and at > now() - interval '7 days' order by at desc limit 10) l), '[]'::jsonb));
end $$;

-- Réglage media_cdn (0/1) dans Réglages.
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
    when 'wa_card_media' then array[0, 1]
    when 'media_cdn' then array[0, 1] end
$$;
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fiila_bo_settings()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$'discover_after', 'wa_card_media']$s$, $s$'discover_after', 'wa_card_media', 'media_cdn']$s$);
  if v_new = v_def then raise exception 'media: fiila_bo_settings non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  staff_fns text[] := array['public.fiila_bo_media()', 'public.fiila_bo_settings()'];
  svc_fns text[] := array['public.fiila_media_pending(int)', 'public.fiila_media_done(text, text, text, text, int)',
                          'public.fiila_media_orphans(int)', 'public.fiila_media_forget(jsonb)', 'public.fiila_media_report(text, text, text)'];
begin
  foreach fn in array staff_fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  foreach fn in array svc_fns loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;

-- Infrastructure Supabase (absente des tests locaux) : seau public, adresse de base, copie toutes les minutes.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', true, 600000, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  insert into fiila.settings (key, value) values
    ('media_base', 'https://lkvulwocirttozfnyxck.supabase.co/storage/v1/object/public/media/'),
    ('media_sync_url', 'https://lkvulwocirttozfnyxck.supabase.co/functions/v1/fiila-media-sync')
    on conflict (key) do nothing;
  begin
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('fiila-media-sync', '* * * * *',
      $c$select net.http_post(url := (select value from fiila.settings where key = 'media_sync_url'), body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)$c$);
  exception when others then
    raise notice 'media: copie automatique non programmée (%), lancer la copie depuis le back-office', sqlerrm;
  end;
end $$;
