-- « Vitrine » devient « site » partout dans le vocabulaire de Fii (fondateur, 22/10/2026 13:34 : « Remplace ma vitrine,
-- et met mon site, c'est plus simple. Remplace partout dans le jargon de Fii »).
-- Textes des fonctions (réponses du Manager et de l'accompagnement des Ambassadeurs, quiz, plan du jour) et missions.
-- Les noms techniques (fiila_vitrine, route #/b/…, mesures 'vitrine:…') ne changent pas : rien ne casse pour les liens déjà partagés.

do $$
declare f regprocedure; v_def text; v_new text; n int := 0;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'fiila' and p.proname in ('amb_rule_reply', 'amb_plan_day', 'amb_quiz_why', 'partner_rule_reply') loop
    select pg_get_functiondef(f) into v_def;
    v_new := v_def;
    v_new := replace(v_new, $q$Ouvrir ma vitrine en ligne$q$, $q$Mettre mon site en ligne$q$);
    v_new := replace(v_new, $q$Ouvrez votre vitrine en ligne$q$, $q$Mettez votre site en ligne$q$);
    v_new := replace(v_new, $q$Ma vitrine en ligne$q$, $q$Mon site$q$);
    v_new := replace(v_new, $q$Vitrine ouverte : vos clientes peuvent commander.$q$, $q$Site en ligne : vos clientes peuvent commander.$q$);
    v_new := replace(v_new, $q$Visible par vos clientes. Touchez pour fermer.$q$, $q$Visible par vos clientes. Touchez pour le mettre hors ligne.$q$);
    v_new := replace(v_new, $q$Personne ne la voit. Touchez pour l’ouvrir.$q$, $q$Personne ne le voit. Touchez pour le mettre en ligne.$q$);
    v_new := replace(v_new, $q$Vitrine ouverte$q$, $q$Site en ligne$q$);
    v_new := replace(v_new, $q$Vitrine fermée$q$, $q$Site hors ligne$q$);
    v_new := replace(v_new, $q$Ouvrir ma vitrine$q$, $q$Mettre mon site en ligne$q$);
    v_new := replace(v_new, $q$Ouvrez votre vitrine avec au moins un article.$q$, $q$Mettez votre site en ligne avec au moins un article.$q$);
    v_new := replace(v_new, $q$Ouvrez votre vitrine pour voir l’aperçu.$q$, $q$Mettez votre site en ligne pour voir l’aperçu.$q$);
    v_new := replace(v_new, $q$Ouvrez votre vitrine : $q$, $q$Mettez votre site en ligne : $q$);
    v_new := replace(v_new, $q$Ouvrez votre vitrine dans « Réglages » → « Ma vitrine en ligne »$q$, $q$Mettez votre site en ligne dans « Réglages » → « Mon site »$q$);
    v_new := replace(v_new, $q$Ouvrez votre vitrine dans « Réglages » → « Mon site »$q$, $q$Mettez votre site en ligne dans « Réglages » → « Mon site »$q$);
    v_new := replace(v_new, $q$Rouvrez la vitrine pour réapparaître$q$, $q$Remettez le site en ligne pour réapparaître$q$);
    v_new := replace(v_new, $q$ouvrir votre vitrine$q$, $q$mettre votre site en ligne$q$);
    v_new := replace(v_new, $q$On ouvre la vitrine$q$, $q$On met le site en ligne$q$);
    v_new := replace(v_new, $q$qui ouvrent leur vitrine$q$, $q$qui mettent leur site en ligne$q$);
    v_new := replace(v_new, $q$La suspension ferme la vitrine$q$, $q$La suspension met le site hors ligne$q$);
    v_new := replace(v_new, $q$Elle peut rouvrir sa vitrine.$q$, $q$Elle peut remettre son site en ligne.$q$);
    v_new := replace(v_new, $q$ne peut pas la rouvrir elle-même$q$, $q$ne peut pas le remettre en ligne elle-même$q$);
    v_new := replace(v_new, $q$Une vitrine bien remplie$q$, $q$Un site bien rempli$q$);
    v_new := replace(v_new, $q$Nom de vitrine indisponible$q$, $q$Adresse du site indisponible$q$);
    v_new := replace(v_new, $q$Vitrine d’une boutique (si elle l’ouvre)$q$, $q$Site d’une boutique (s’il est en ligne)$q$);
    v_new := replace(v_new, $q$la vitrine passe à « Ouverte »$q$, $q$le site passe « En ligne »$q$);
    v_new := replace(v_new, $q$Affichés en bas de votre vitrine, pour qu’on vous suive.$q$, $q$Affichés à côté de votre logo, pour qu’on vous suive.$q$);
    v_new := replace(v_new, $q$vitrine ouverte$q$, $q$site en ligne$q$);
    v_new := replace(v_new, $q$vitrine fermée$q$, $q$site hors ligne$q$);
    v_new := replace(v_new, $q$ouvrir la vitrine$q$, $q$mettre le site en ligne$q$);
    v_new := replace(v_new, $q$Votre vitrine est en ligne.$q$, $q$Votre site est en ligne.$q$);
    v_new := replace(v_new, $q$montrer une vraie vitrine$q$, $q$montrer un vrai site$q$);
    v_new := replace(v_new, $q$Partager une vitrine de vos commerçants$q$, $q$Partager le site d’un de vos commerçants$q$);
    v_new := replace(v_new, $q$le lien de la vitrine d’un de vos commerçants$q$, $q$le lien du site d’un de vos commerçants$q$);
    v_new := replace(v_new, $q$Visites de la vitrine$q$, $q$Visites du site$q$);
    v_new := replace(v_new, $q$Visite de la vitrine$q$, $q$Visite du site$q$);
    v_new := replace(v_new, $q$visites de la vitrine$q$, $q$visites du site$q$);
    v_new := replace(v_new, $q$Commandes via la vitrine$q$, $q$Commandes via le site$q$);
    v_new := replace(v_new, $q$via la vitrine$q$, $q$via le site$q$);
    v_new := replace(v_new, $q$Vitrine introuvable$q$, $q$Site introuvable$q$);
    v_new := replace(v_new, $q$La vitrine est fermée pour le moment.$q$, $q$Ce site est hors ligne pour le moment.$q$);
    v_new := replace(v_new, $q$QR code de la vitrine$q$, $q$QR code du site$q$);
    v_new := replace(v_new, $q$pour une vitrine haut de gamme$q$, $q$pour un site haut de gamme$q$);
    v_new := replace(v_new, $q$Vitrine (Marketing)$q$, $q$Site (Marketing)$q$);
    v_new := replace(v_new, $q$Vitrine sans lien$q$, $q$Site sans lien$q$);
    v_new := replace(v_new, $q$Lien de sa vitrine Fii$q$, $q$Lien de son site Fii$q$);
    v_new := replace(v_new, $q$couvertures de vitrine$q$, $q$couvertures de site$q$);
    v_new := replace(v_new, $q$Votre vitrine$q$, $q$Votre site$q$);
    v_new := replace(v_new, $q$votre vitrine$q$, $q$votre site$q$);
    v_new := replace(v_new, $q$Ma vitrine$q$, $q$Mon site$q$);
    v_new := replace(v_new, $q$ma vitrine$q$, $q$mon site$q$);
    v_new := replace(v_new, $q$La vitrine$q$, $q$Le site$q$);
    v_new := replace(v_new, $q$la vitrine$q$, $q$le site$q$);
    v_new := replace(v_new, $q$une vitrine$q$, $q$un site$q$);
    v_new := replace(v_new, $q$Une vitrine$q$, $q$Un site$q$);
    v_new := replace(v_new, $q$de vitrine$q$, $q$de site$q$);
    v_new := replace(v_new, $q$sa vitrine$q$, $q$son site$q$);
    v_new := replace(v_new, $q$leur vitrine$q$, $q$leur site$q$);
    v_new := replace(v_new, $q$boutique, vitrine et adresses$q$, $q$boutique, site et adresses$q$);
    v_new := replace(v_new, $q$: vitrine, commandes$q$, $q$: site, commandes$q$);
    v_new := replace(v_new, $q$, vitrine, commandes$q$, $q$, site, commandes$q$);
    v_new := replace(v_new, $q$Commandes, articles, vitrine$q$, $q$Commandes, articles, site$q$);
    if v_new <> v_def then execute v_new; n := n + 1; end if;
  end loop;
  if n < 4 then raise exception 'site: % fonction(s) modifiée(s) sur 4', n; end if;
end $$;

update fiila.amb_missions set title = replace(title, 'Partager une vitrine de vos commerçants', 'Partager le site d’un de vos commerçants'),
  body = replace(body, 'le lien de la vitrine d’un de vos commerçants', 'le lien du site d’un de vos commerçants')
 where title ~* 'vitrine' or body ~* 'vitrine';
