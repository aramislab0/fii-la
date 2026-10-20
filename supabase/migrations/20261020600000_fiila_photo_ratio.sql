-- Fii La : règle de format des photos d'articles (fondateur, 20/10/2026 02:30 : « une règle des tailles d'images par rapport à
-- l'affichage des cartes sur la vitrine ; toutes les images doivent la respecter pour que tout soit aligné ; réadapter les
-- ratios avant publication »).
--
-- Format unique des photos d'articles : portrait 4:5 (1080 × 1350 au plus, comme les publications Instagram). Les cartes de
-- la vitrine, du fil, des enregistrés et du vide-dressing l'affichent toutes en 4:5. L'application recadre au format 4:5 à
-- l'ajout (recadrage ajustable) ; le serveur refuse une photo d'article dont le format s'écarte de plus de 2 %.
-- La couverture de la vitrine garde son propre format (bandeau) : elle n'est pas concernée.

-- Largeur et hauteur d'une image JPEG ou PNG (null si le format n'est pas reconnu).
create or replace function fiila.img_dims(p bytea, out w int, out h int)
language plpgsql immutable set search_path = '' as $$
declare i int := 2; n int := coalesce(length(p), 0); m int; seg int;
begin
  w := null; h := null;
  if n < 24 then return; end if;
  if substring(p from 1 for 8) = '\x89504e470d0a1a0a'::bytea then
    w := (get_byte(p, 16) << 24) | (get_byte(p, 17) << 16) | (get_byte(p, 18) << 8) | get_byte(p, 19);
    h := (get_byte(p, 20) << 24) | (get_byte(p, 21) << 16) | (get_byte(p, 22) << 8) | get_byte(p, 23);
    return;
  end if;
  if get_byte(p, 0) <> 255 or get_byte(p, 1) <> 216 then return; end if;          -- JPEG : FF D8
  while i + 9 < n loop
    if get_byte(p, i) <> 255 then return; end if;
    m := get_byte(p, i + 1);
    if m = 255 then i := i + 1; continue; end if;                                     -- remplissage
    if m = 1 or (m between 208 and 217) then i := i + 2; continue; end if;            -- marqueurs sans longueur
    seg := (get_byte(p, i + 2) << 8) | get_byte(p, i + 3);
    if m between 192 and 207 and m not in (196, 200, 204) then                        -- SOFn
      h := (get_byte(p, i + 5) << 8) | get_byte(p, i + 6);
      w := (get_byte(p, i + 7) << 8) | get_byte(p, i + 8);
      return;
    end if;
    if seg < 2 then return; end if;
    i := i + 2 + seg;
  end loop;
end $$;

-- Format 4:5 respecté (à 2 % près) ; une image dont le format n'est pas lisible est acceptée (elle s'affiche recadrée).
create or replace function fiila.ratio_ok(p bytea) returns boolean
language sql immutable set search_path = '' as $$
  select case when d.w is null or d.h is null or d.h = 0 then true else abs(d.w::numeric / d.h - 0.8) <= 0.016 end
    from fiila.img_dims(p) d
$$;

create or replace function fiila.need_ratio(p bytea) returns void
language plpgsql set search_path = '' as $$
begin
  if p is not null and not fiila.ratio_ok(p) then perform fiila.fail('photo_ratio'); end if;
end $$;

-- Contrôle ajouté là où une photo d'article entre : photo principale, photos supplémentaires, vide-dressing.
do $$
declare v_def text; v_new text; v_sig text;
begin
  foreach v_sig in array array['public.fiila_product_save(text, jsonb)', 'public.fiila_vd_submit(jsonb)'] loop
    select pg_get_functiondef(v_sig::regprocedure) into v_def;
    v_new := replace(v_def, $s$select * into v_ph from fiila.photo_in(p ->> 'photo');$s$,
                            $s$select * into v_ph from fiila.photo_in(p ->> 'photo'); perform fiila.need_ratio(v_ph.data);$s$);
    if v_new = v_def then raise exception 'photo_ratio: % non modifiée', v_sig; end if;
    execute v_new;
  end loop;
  select pg_get_functiondef('fiila.product_photos_set(uuid, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$select * into v_ph from fiila.photo_in(v_item #>> '{}');$s$,
                          $s$select * into v_ph from fiila.photo_in(v_item #>> '{}'); perform fiila.need_ratio(v_ph.data);$s$);
  if v_new = v_def then raise exception 'photo_ratio: product_photos_set non modifiée'; end if;
  execute v_new;

  -- Back-office (règle n° 8) : articles dont une photo n'est pas au format, sur la fiche boutique et au tableau de bord.
  select pg_get_functiondef('public.fiila_bo_shop(uuid)'::regprocedure) into v_def;
  v_new := replace(v_def, $s$      'multi_photos',$s$, $s$      'off_format', (select count(*) from fiila.products p where p.shop_id = s.id and p.active and (not fiila.ratio_ok(p.photo)
          or exists (select 1 from fiila.product_photos x where x.product_id = p.id and not fiila.ratio_ok(x.data)))),
      'multi_photos',$s$);
  if v_new = v_def then raise exception 'photo_ratio: fiila_bo_shop non modifiée'; end if;
  execute v_new;
  select pg_get_functiondef('public.fiila_bo_overview()'::regprocedure) into v_def;
  v_new := replace(v_def, $s$      'multi_photos',$s$, $s$      'off_format', (select count(*) from fiila.products p join fiila.shops s on s.id = p.shop_id where p.active and not s.demo and not fiila.ratio_ok(p.photo)),
      'multi_photos',$s$);
  if v_new = v_def then raise exception 'photo_ratio: fiila_bo_overview non modifiée'; end if;
  execute v_new;
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_product_save(text, jsonb)', 'public.fiila_vd_submit(jsonb)', 'public.fiila_bo_shop(uuid)', 'public.fiila_bo_overview()'];
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
