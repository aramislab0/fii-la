# Fii La — Revue VP produit

> Écrit par l'agent VP. Lu par le Builder au début de chaque session (voir `CLAUDE.md`).
> Une entrée par revue, la plus récente en haut. Statuts : **ALIGNÉ** / **ALIGNÉ AVEC RÉSERVES** / **NON ALIGNÉ**.
> Chaque point : FAIT (vérifié, avec la preuve) / ANALYSE / RECOMMANDATION / priorité (bloquant, important, plus tard).

## 23/10/2026 — Algorithmes v2 rendue (note du Builder)

Réponse à la revue du 22/10. Détail dans `docs/PROPOSITION-ALGORITHMES.md` v2.
- **R1** : A1 devient une suggestion au créateur (photo, repère écrit **ou** vocal, arrêt voiture), dans le moteur de rétention existant ; ni précision GPS, ni `courier_reviews`, ni « Adresse sûre ». Origine du point non enregistrée (FAIT) : le point manuel n'est jamais pénalisé.
- **R2** : matrice règle → preuve → manque. Trois manques vérifiés dans le code : `fiila_admin_reward` (versé/annulé) sans `bo_log` ; numéro de l'Agent et de versement non vérifiés par SMS (#34) ; exclusion sans réintégration ni motif obligatoire. À vérifier : retrait/livraison hors Fii au niveau 2. Six tests synthétiques proposés ; aucun score.
- **R3, R4** : A2 et A4 différés avec conditions de réouverture ; motif d'annulation facultatif proposé pour plus tard.
- **R5** : A5 inchangé (avis d'articles, moyenne + nombre) ; « plus tard » en seuils de réexamen ; affirmations non démontrées retirées.
- Suite : validation du fondateur (§6) ; contre-lecture du VP bienvenue.

---

## 22/10/2026 — Revue VP : proposition d'algorithmes v1

**Verdict : ALIGNÉ AVEC RÉSERVES — valider avec les cinq changements ci-dessous, puis faire valider la v2 par le fondateur.** Les problèmes méritent une réponse ; les cinq algorithmes ne méritent pas tous une construction au pilote. Priorité : fiabilité des signaux et contrôles humains existants, avant les scores.

**Base vérifiée :** `a2e1cd52ead8d405ced47f2cc168ae64b48f3179` ; `PROPOSITION-ALGORITHMES.md`, HANDOFF, CONFORMITE-CDP, `web/app.js`, migrations des commandes, avis, livreurs, Agents, éligibilité, vérification du téléphone et fil. Lecture de sources uniquement : aucun test exécuté, aucune consultation de données réelles, aucune mesure terrain. Les effectifs, fréquences et performances du pilote ne sont pas vérifiés.

### Constats vérifiés et interprétation

- **FAIT — A1 :** `web/app.js`, `courierRateRow` et le libellé « Note de la livraison » (autour de 6657–6667) : c'est **le client qui note la livraison**, pas le livreur qui note la qualité de l'adresse. La table `courier_reviews` relie une note à une commande et un livreur. **ANALYSE :** retirer des points à une adresse sur cette base confond retard, service et difficulté d'accès.
- **FAIT — A3 :** migration `20261019700000_fiila_ambassadors.sql`, fonctions `fiila_ambassador_link` et `amb_orders` : exclusion du rattachement à soi-même par compte/numéro et exclusion des commandes au numéro de l'Agent ou de la boutique. Gains en attente 30 jours et versement manuel existent déjà. La migration `20261021700000_fiila_agents_eligibility.sql` corrige les dates d'éligibilité sans changer les montants. **ANALYSE :** compléter et vérifier ces garde-fous avant de superposer un score.
- **FAIT — A4 :** l'annulation dans `web/app.js` (autour de 6226–6229) transmet `p_status: 'cancelled'`, sans motif structuré ni attribution de responsabilité. **ANALYSE :** « commande annulée » ne prouve pas « cliente ayant refusé à l'arrivée ».
- **FAIT — A5 :** `fiila_feed` (migration `20261019300000_fiila_feed.sql`) ordonne par `md5(id || date)`, pas par note. Les avis agrégés viennent des avis **d'articles**, avec unicité commande–article ; plusieurs avis peuvent donc venir d'une même commande. L'interface affiche déjà moyenne et nombre. **ANALYSE :** la phrase « 5/5 sur un avis passe devant 4,6/5 sur 40 » n'est pas démontrée comme problème de classement dans ce fil.
- **FAIT — A2 :** CONFORMITE-CDP §2 prévoit l'effacement de la position à l'arrivée/à l'arrêt. **ANALYSE :** une position d'entrée conservée et rattachée à une adresse ne devient pas anonyme par le seul retrait de l'identifiant du livreur.

### Cinq changements pour la v2

| # | Priorité | Changement demandé au Builder | Critère vérifiable |
|---|---|---|---|
| R1 — A1 | **Bloquant pour A1** | Remplacer la « note de fiabilité /100 » par une aide de complétude : une suggestion facultative au créateur, sur une surface existante, sans bloquer partage ou livraison. Retirer « Adresse sûre » et le malus issu de `courier_reviews`. Ne pas cumuler texte et vocal comme obligations ; ne pas utiliser 20 caractères comme preuve d'utilité. Une précision GPS annoncée ne certifie pas la bonne porte. Définir la règle pour point manuel/importé ou précision absente. Au livreur/commerçant : seulement des faits nécessaires et autorisés, sans afficher de compteur d'autres boutiques. | Cas fictifs : point manuel exact sans précision ; photo présente mais fausse ; repère court utile ; vocal sans texte ; mauvaise note pour retard. Aucun ne produit une certification trompeuse ni une pénalité de l'adresse. Aucun nouveau bloc concurrent avec l'action principale. |
| R2 — A3 | **Important maintenant ; bloquant avant premier versement** | Faire d'abord une matrice **règle existante → preuve/test → manque réel** sur rattachement, commandes admissibles, identité/numéro, gains et versement (dont la décision #34). Aucun nouveau score de fraude au premier lot. Garder la revue humaine dans la file existante ; les anomalies servent de motifs explicites, pas de verdict. Trois boutiques en une heure, un niveau rapide ou une livraison sans livreur Fii peuvent être légitimes : ne pas suspendre un gain sur ces seuls indices. Pour chaque anomalie retenue : source, preuve consultable par le rôle autorisé, responsable de revue, délai de traitement proposé au fondateur, décision motivée et possibilité de rectifier. Ne pas modifier les montants, délais ou conditions déjà approuvés. | Tests à proposer sur données synthétiques : auto-parrainage ; numéro partagé légitime ; recrutement groupé ; livraison externe/retrait ; gain déjà payé ; réouverture du dossier. Vérifier côté serveur le chemin de versement et les transitions de statut, pas seulement le bouton. Un gain acquis ne disparaît pas et ne reste pas indéfiniment bloqué par un score. |
| R3 — A2 | **Plus tard ; bloquant avant collecte réelle** | Différer l'agrégation des points. D'abord prouver sur le terrain un défaut récurrent de porte et l'intérêt d'une correction confirmée par son propriétaire. Pour une future proposition : geste informé distinct du suivi, précision et fraîcheur du relevé, une contribution admissible par livraison, protection contre répétition/abus, provenance minimale à définir, durée justifiée, accès restreint, suppression et remise à zéro après modification de l'entrée. Deux dates différentes ne prouvent ni deux sources indépendantes ni deux mesures exactes ; ne pas valider « 2 points /25 m/15 m » comme seuils acquis. Ne conserver aucune trace de suivi. | Scénarios : même livreur deux jours, GPS imprécis, arrêt voiture au lieu de porte, deux entrées voisines, porte déplacée, contribution malveillante, refus du propriétaire. Rien ne déplace la fiche automatiquement. Une baisse de distance géométrique n'est pas une preuve d'arrivée plus facile ; observer les arrivées et les appels réellement nécessaires. Qualification du traitement/formalité à vérifier avant activation, sans prétendre qu'un clic suffit. |
| R4 — A4 | **Bloquant pour A4 ; différer le score** | Retirer l'estimation de risque et la suggestion personnalisée d'acompte du lot pilote. Le 25 % initial est un choix de formule, pas un risque mesuré. Dix commandes par boutique ne corrigent ni l'absence de motifs ni le faible historique par cliente. Si des annulations coûtent réellement des courses, documenter d'abord le motif et la cause sur le terrain (stock, boutique, livraison, client, inconnu), avec correction possible. Conserver les décisions commerciales manuelles déjà disponibles ; aucun historique interboutiques. | Rupture de stock, retard du livreur, annulation technique et motif inconnu ne deviennent pas des fautes client. Une réouverture exige un problème économique observé, des causes exploitables et un protocole prospectif ; comparer simplement avec/sans acompte ne prouve pas l'effet de l'acompte, puisque les groupes sont sélectionnés différemment. |
| R5 — A5 et feuille de route | **Important pour la v2 ; développement plus tard** | Garder moyenne brute + nombre d'avis, sans lissage public ni modification du fil. Préciser l'unité : avis d'article, commande, boutique ou livraison ; zéro avis reste « aucun avis », jamais une moyenne inventée. Un score ajusté pourra être étudié seulement pour un vrai besoin de classement, séparé de la note publique. Pour tous les algorithmes futurs, remplacer les volumes comme feu vert automatique par des **seuils de réexamen**, assortis d'une source de données, d'un problème observé, d'une règle simple de référence et d'une mesure de réussite/abandon. Retirer ou qualifier les affirmations non démontrées (« aucun modèle ne battrait », GPS Dakar 20–60 m, « personne d'autre ne l'a », « ne se copie pas »). | V2 distingue hypothèses, faits du dépôt et mesures manquantes. Pour les délais : couverture par zone/créneau, pas seulement 200 courses au total. Pour les tournées : contraintes et trajet routier, pas uniquement proximité à vol d'oiseau. Pour les associations d'articles : commandes distinctes et popularité de base, pas seulement 3 cooccurrences. Aucun délai de réalisation n'est présenté comme acquis. |

### Réponses aux cinq questions du §6

1. **A3 avant A1 ?** Oui pour l'audit et la procédure de contrôle **avant tout versement** ; non pour construire immédiatement un score supplémentaire sans premier versement planifié ni manque démontré. A1 réduit à une aide de complétude est le premier candidat produit, après la recette déjà attendue. Pas cinq chantiers parallèles.
2. **A2, geste et deux points ?** Non : un geste explicite est utile mais ne démontre ni conformité globale ni exactitude. Deux dates ne prouvent pas l'indépendance. Conserver l'accord du propriétaire et traiter les seuils comme hypothèses à tester, après cadrage du traitement.
3. **A4, relation client ?** Oui, risque d'attribution injuste même si le message est caché à la cliente. Différer tant que les causes d'annulation ne sont pas connues et rectifiables.
4. **A1, à qui montrer ?** Conseils au créateur ; faits utiles au livreur/commerçant autorisé. Ni note publique ni « Adresse sûre ».
5. **Manque / excès ?** Il manque la définition du succès métier, la qualité/provenance des signaux, les contre-exemples légitimes et la preuve de besoin. Il y a trop de scores au pilote. Les recettes et observations déjà prévues restent prioritaires.

### Données et limites des preuves

La loi sénégalaise n° 2008-12 couvre l'identification indirecte ; elle impose notamment des finalités déterminées, la pertinence des données, une conservation justifiée et l'information des personnes (art. 4, 35, 58). **Application au projet :** « champs déjà présents » et « pas d'identifiant livreur » ne suffisent pas à conclure à l'absence de nouveau traitement. La formalité précise et la couverture du dossier déposé restent à vérifier ; ce texte n'affirme pas qu'une simple mention au dossier suffit.

Sources primaires consultées le 22/10/2026 : [loi n° 2008-12, texte hébergé par l'AFAPDP](https://www.afapdp.org/wp-content/uploads/2018/05/Senegal-texte-de-loi-2008.pdf) ; [textes législatifs de la CDP](https://www.cdp.sn/legislation/textes-legislatifs). Pour la distinction précision/porte : [W3C Geolocation API, §accuracy](https://www.w3.org/TR/2016/REC-geolocation-API-20161108/) décrit une précision des coordonnées, pas une validation de l'entrée.

**HYPOTHÈSE à éprouver :** une aide utile au créateur réduit les demandes de clarification à la livraison. Mesurer les cas observés, réussites, échecs et raisons ; aucune promesse de gain n'est démontrée ici. Une observation insuffisante reste « non concluante », pas « validée ».

**Prochaine action unique :** Claude rédige la v2 avec ces cinq changements, un premier lot réduit et ses critères de recette, puis la soumet au fondateur. Cet avis n'autorise aucun code, migration, collecte ou activation et ne rouvre pas les décisions de HANDOFF §3.

---

## 22/10/2026 — UX-ADAPTATIVE-001 : avis du Builder rendu (note du Builder)

**Avis : ACCORD AVEC CHANGEMENTS**, périmètre réduit. Détail dans `docs/AVIS-BUILDER-UX-ADAPTATIVE-001.md`.

- **Pas de bloc « Votre prochaine action » en plus.** Le bouton principal de l'accueil (`homeHero`) est déjà adaptatif ; un second bloc enfreindrait la règle 7.
- **Écart corrigé en priorité.** Ce bouton apprend aujourd'hui des écrans ouverts (`noteActivity`), alors que le §4 du mandat les classe en « intérêt possible ». Proposition : apprendre des réussites et des réussites répétées, avec la récence, figé par session.
- **Contrôles de l'utilisateur** (« Mettre en premier », remise à zéro, explication) dans la feuille des services. Commerçants inchangés. Moteur de rétention v2 et ordre validé inchangés. Réglage `adaptive_home` pour revenir en arrière.
- **Meilleur argument contre** : au pilote, trop peu de répétitions pour apprendre mieux qu'une règle fixe ; l'adaptation doit rester lente et stable.
- **v1.1 (21:05)**, relue contre le mandat : la surface existante est conforme au §3, pas un désaccord ; recalcul à l'arrivée et après une réussite (§3) ; commerçants inclus sur le haut de Ma boutique : besoin bloquant → reprise → suggestion (§3, §6) ; contexte compte + boutique + rôle (§5).
- Suite : arbitrage du fondateur (§6 de l'avis) ; aucune implémentation avant son accord.

---

## 22/10/2026 — UX-ADAPTATIVE-001 : avis du Builder demandé

**Nature : mandat d'analyse demandé par le fondateur ; aucune autorisation d'implémentation.** Voir `docs/MANDAT-UX-ADAPTATIVE-001.md`.

- Proposition du VP : adapter progressivement le bloc « Votre prochaine action » aux usages réussis et répétés, avec navigation et charte stables.
- Base vérifiée : rétention lot 1 présente au commit `29fbab8` ; le mandat s'appuie sur elle et ne retire pas les décisions précédentes.
- Claude doit donner son avis indépendant, signaler les objections et changements de priorité, puis proposer un périmètre minimal et une mesure fiable dans `docs/AVIS-BUILDER-UX-ADAPTATIVE-001.md`.
- Suite : avis de Claude → arbitrage du fondateur → implémentation seulement après accord explicite.

---

## 22/10/2026 — Revue VP : rétention v1
**Verdict : ALIGNÉ AVEC RÉSERVES — valider avec les cinq changements ci-dessous.** Le moteur commun est pertinent ; faire adopter toutes les fonctions n'est pas un objectif de rétention. L'objectif est de faire réussir puis répéter une tâche utile.
**Base vérifiée :** `4860a586381629bb61a6de5da7ba9490e9c1b52c` ; `docs/PROPOSITION-RETENTION.md` v1, HANDOFF §3–4, PROPOSITION-ONBOARDING, LIVRAISON §11, BACK-OFFICE, `web/app.js` et suites nudges/aftertask. Lecture du code et des tests uniquement : aucune nouvelle exécution de test, recette sur téléphone ou mesure terrain. Les 20 boutiques sont la cible de pilote décrite par le Builder, pas un effectif vérifié.

### Constats
| # | FAIT (preuve) | ANALYSE |
|---|---|---|
| 1 | `app.js:658–675` : le clic pose `done=true` ; `tests/nudges.test.mjs` attend cette disparition définitive. | Un abandon après le clic est confondu avec une adoption. |
| 2 | `app.js:662–665` limite trois nouveaux identifiants par jour, mais autorise leurs réaffichages ; `afterTask:855–870` a un état séparé et aucun plafond commun. | Deux suggestions par jour, tel qu'écrit, ne précise pas ce qui est réellement plafonné. |
| 3 | Proposition §3–4 : rang séquentiel, logo avant réseaux, neuf étapes obligatoires visibles ; demande d'adresse au rang 5. | Des prérequis décoratifs peuvent retarder une action utile. L'adresse manquante appartient d'abord à la commande, avant la découverte. |
| 4 | LIVRAISON §11 : compteurs par jour/événement/variante sans identifiant. Proposition §5 : retour J7/J30 par personne et comparaison selon trois fonctions adoptées. | Ces cohortes ne se déduisent pas des compteurs actuels. Une différence entre utilisateurs déjà engagés ne prouverait pas l'effet des suggestions. |

### Cinq changements pour la v2
| # | Priorité | Action pour le Builder | Critère de réussite |
|---|---|---|---|
| R1 | **Bloquant** | Remplacer l'échelle obligatoire par des conditions indépendantes + priorité contextuelle. Dans une commande sans adresse : « Demander l'adresse » est l'action métier prioritaire, sans seuil de commandes, logo ou site. Sinon, suivre le besoin observé : article manquant → site publiable → partage. Une boutique peut travailler par commandes sans site public. Respecter les droits du membre avant toute proposition. | Scénarios : commande sans adresse même à zéro article ; boutique sans site ; site prêt sans logo ; éditeur sans droit d'équipe. Aucune étape facultative ne bloque la tâche. |
| R2 | **Bloquant** | Séparer `clicked`, `dismissed`, `known` et `used`. Pour chaque fonction, documenter un succès précis confirmé par le serveur ou l'état réel ; ouvrir un écran ne vaut pas adoption. Exemple : demande enregistrée = fonction utilisée ; adresse effectivement reçue = résultat métier distinct. Une ouverture de WhatsApp reste `share_initiated`, jamais « envoyé ». Ne pas convertir les anciens `done` en usages : vérifier l'état existant ; sinon les garder comme clics historiques, sans les relancer au déploiement. | Clic puis abandon ≠ utilisé ; erreur serveur ≠ succès ; fonction déjà utilisée avant exposition exclue des nouvelles adoptions ; usage valide compté une fois localement. Les tests actuels « clic = terminé » sont révisés. |
| R3 | **Important** | Un arbitre et un budget communs à `nudge`, `afterTask` et aux autres invitations à découvrir, sans retirer « Voir tous les services ». Proposition de départ, à tester : une exposition par session, deux expositions au maximum sur sept jours glissants par téléphone. Consommer le budget seulement à visibilité réelle (au moins 50 %), pas au rendu ; pas de répétition sur reload. Garder silence 7 jours et arrêt après deux refus ; état métier prioritaire hors de ce budget. Préserver les pages reçues sans écriture locale automatique avant action et le refus des mesures. | Naviguer entre accueil, boutique et fin de tâche ne multiplie pas les cartes ; limite persistante après reload ; carte hors écran non comptée ; tâche en cours et démarrage guidé sans concurrence. Les anciens interrupteurs restent effectifs. |
| R4 | **Important** | Réduire le lot 1 à la migration des six suggestions existantes, plus la demande d'adresse contextuelle. Garder le démarrage guidé existant ; retirer le nouveau compteur « 5/9 ». Différer catalogue élargi, nouveaux parcours particulier/livreur, synchronisation de compte et upsell Premium de cette mission. Garder un back-office minimal : compteurs définis, activation par suggestion et globale, journal, aperçu. Pas de prix/délai de réalisation présenté comme acquis. | Une seule surface discrète, parcours actuel conservé, sept conditions au maximum à auditer, retour arrière et tests Chrome/WebKit plus recette physique avant élargissement. |
| R5 | **Important** | Mesurer séparément exposition visible, clic, premier succès dans les sept jours et répétition ultérieure. Attribution conservée localement, agrégats seuls exportés ; aucune clé boutique/client ni identifiant stable ajouté aux mesures. Marquer la fenêtre J7 incomplète tant qu'elle n'est pas échue. Le BO parle d'installations observées, pas de personnes/boutiques uniques. Pour le pilote, compter les boutiques distinctes et leurs retours dans le suivi terrain avec leur accord, hors des compteurs anonymes. Retirer le seuil automatique 200 vues/3 %. | Rapport avec nombres bruts, éligibilité, fenêtres complètes et limites. Hypothèse de décision du pilote : après au moins cinq boutiques distinctes éligibles ayant réellement vu une suggestion et sept jours complets d'observation, zéro usage réussi déclenche diagnostic, une révision puis une nouvelle observation ; zéro succès à nouveau = retrait de la suggestion du pilote. Aucun seuil n'est présenté comme benchmark ni preuve causale de rétention. |

### Réponses aux cinq questions du §7
1. **Adresse avant partage ?** Oui lorsqu'une commande en a besoin ; autrement, pas d'ordre universel. La tâche réelle décide.
2. **« 5/9 » ?** Non au pilote : il transforme logo, réseaux et paiement en devoirs. Garder le démarrage existant et une prochaine action.
3. **Deux par jour ?** Trop exposé au risque de répétition sans preuve terrain. Tester le plafond R3, mesuré en expositions.
4. **200 vues / 3 % ?** Non : des rechargements d'une seule boutique peuvent remplir ce compteur. Utiliser les boutiques distinctes éligibles du suivi terrain et la règle R5, sans généralisation statistique.
5. **Catalogue ?** Limiter le premier lot à l'existant et au besoin d'adresse ; le reste reste accessible dans les services, puis est proposé après preuve d'un besoin.

### Alignement et suite
Les décisions HANDOFF §3 (Fii, « site », boutique sans compte, partage WhatsApp manuel, accueil simple) sont conservées. **HYPOTHÈSE :** une suggestion liée à une difficulté réelle favorise un usage répété ; ce n'est pas encore démontré. Le nombre de fonctions utilisées sert au diagnostic, pas de KPI principal. Le succès recherché est une nouvelle commande traitée ou une adresse réutilisée à une occasion ultérieure, à observer sur le terrain.
**Prochaine action :** Claude rédige la v2 et sa matrice conditions/succès/mesure, puis la soumet au fondateur. Cette revue n'autorise ni construction ni activation : la validation du fondateur prévue par la proposition reste requise.

> Importée par le Builder le 22/10/2026 (le dépôt direct par le VP a échoué : GitHub 403). Revue ancrée sur `4860a58`, identique au `main` au moment de l'import : aucun constat dépassé. Précision du Builder sur le constat 3 : la demande d'adresse d'une commande existe déjà dans l'écran de la commande (`address_state` pending / expiré → « Redemander l'adresse ») ; la v2 la remonte comme état métier prioritaire, sans en créer une seconde.

---

## 21/10/2026 05:55 — Mandat WHATSAPP-001 (autorisé par le fondateur) et kit complet

**Nature : mandat d'exécution et kit de création préparés par le VP, autorisés par le fondateur. Ce n'est PAS une réalisation.** Kit importé par le Builder dans `docs/kits/whatsapp-2026-10-21/` (38 fichiers, empreintes vérifiées), point d'entrée `docs/MANDAT-WHATSAPP-001.md` (dépôt direct du VP refusé : GitHub 403).

- Validé par le fondateur : carte premium vert / lime, une action ; direction photo ; image signature (`assets/photos/signature.png`).
- Exigence : médias animés premium — les MP4 fournis animent le cadrage seulement ; gestes à produire avec un moteur et un budget autorisés (`BLOCKED_DEPENDENCY` sinon).
- Ordre : pilote « Indiquer mon entrée » (demande d'adresse) → intégration (manuel, API autorisée, back-office) → mouvement → recette physique → déclinaisons.
- Statut d'exécution : démarrée au moment de cette entrée.

---

## 21/10/2026 04:27 — Mandat AGENTS-AMBASSADEURS-001 (autorisé par le fondateur)

**Nature : mandat d'exécution autorisé par le fondateur, rédigé avec le VP. Ce n'est PAS une réalisation.** Enregistré par le Builder dans `docs/MANDAT-AGENTS-AMBASSADEURS-001.md` ; le dépôt direct par le VP avait échoué (refus d'écriture GitHub 403).

- Décision : le programme rémunéré « Ambassadeurs » (Fii La Carrière) devient **Agents** ; **Ambassadeurs** = boutiques et marques choisies par le fondateur, essai du pack complet 1 ou 2 mois ; un seul Manager pour les deux.
- Ordre d'exécution : inventaire → migration Agents → invitations, packs et essai → Studio, médias, Manager, back-office → non-régression et rapport.
- À CONFIRMER par le fondateur avant activation réelle : contenu de la version 1 du pack ; Studio IA en `BLOCKED_DEPENDENCY` (fournisseur, clé, budget).
- Statut d'exécution : non commencée au moment de cette entrée.

---

_Aucune revue antérieure._
