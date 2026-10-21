-- Nouveau nom : « Fii La » devient « Fii » (décision du fondateur, 21/10/2026 08:50, avec le nouveau logo).
-- Périmètre : tout ce qui est visible. Les noms internes (schéma fiila, fonctions fiila_*, adresse du site, dépôt) ne changent pas.
-- 1) Textes des fonctions de la base (réponses du Manager, messages WhatsApp, quiz, modération…) : « Fii La Carrière » → « Fii
--    Carrière », « Fii La » → « Fii ». Chaque fonction est recréée à l'identique hors ce texte (droits conservés).
-- 2) Contenus de la plateforme : missions des Agents et boutique du vide-dressing (slug vide-dressing), pas les fiches des
--    utilisateurs.

do $$
declare r record; v_def text; v_new text; n int := 0;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname in ('public', 'fiila') and p.prokind = 'f' and p.prosrc like '%Fii La%' loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(replace(v_def, 'Fii La Carrière', 'Fii Carrière'), 'Fii La', 'Fii');
    execute v_new;
    n := n + 1;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname in ('public', 'fiila') and p.prosrc like '%Fii La%') then
    raise exception 'brand_fii: texte « Fii La » encore présent dans une fonction';
  end if;
  raise notice 'brand_fii: % fonction(s) mises à jour', n;
end $$;

update fiila.amb_missions set title = replace(title, 'Fii La', 'Fii'), body = replace(body, 'Fii La', 'Fii')
 where title like '%Fii La%' or body like '%Fii La%';
update fiila.shops set name = replace(name, 'Fii La', 'Fii'), about = replace(about, 'Fii La', 'Fii')
 where slug = 'vide-dressing' and (name like '%Fii La%' or about like '%Fii La%');
