# Proposition — Algorithmes utiles à Fii, maintenant et plus tard

> **v2.1, 23/10/2026**, par le Builder (Claude). Intègre les cinq changements R1–R5 de la revue VP du 22/10 et les corrections C1–C3 de sa contre-lecture du 23/10 (`docs/REVUE-VP.md`). La v1 (commit `a2e1cd5`) et la v2 (`8a3ebf4`) restent dans l'historique git.
> **Validé par le fondateur le 23/10/2026 04:16 (« Ok pour tout ») et construit le même jour.** Écart de construction, fondé sur le code : la suggestion « arrêt voiture » (`addr_stop`) n'est pas construite, car le formulaire d'adresse impose déjà « accessible en voiture » ou un arrêt (`valid()`, étape 2) et `vehicle_ok` n'est jamais vide en base ; elle ne se montrerait jamais. Le numéro de versement est confirmé quand il est le numéro du compte vérifié par code SMS : un autre numéro se confirme par le même parcours, et devient celui du compte.
> **Corrigé en v2.1 :** deux constats de la v2 étaient faux. Le journal des gains existe déjà (déclencheur `bo_audit`), et un Agent exclu peut redevenir actif par un détour. Les deux sont vérifiés dans les migrations et dans la définition en production.
> **Rien n'est construit avant la validation du fondateur.** Ce document n'autorise aucun code, migration, collecte ni activation.
> Base lue : `main` après `b2303be`. Chaque affirmation est marquée **FAIT** (vérifié dans le dépôt, avec la référence), **HYPOTHÈSE** (à éprouver) ou **À VÉRIFIER**.

## 1. Verdict

**Au pilote : pas de score.** On renforce les contrôles humains qui existent et on aide la personne qui crée l'adresse. Les scores (fiabilité /100, fraude, risque client, note lissée) sont retirés ou différés : les signaux ne sont pas assez sûrs et le volume ne permet pas de les vérifier.

**Premier lot proposé (§2)** — petit, réversible, sans donnée métier nouvelle (le journal de contrôle gagne le motif et l'ancien statut) :
1. **A3 — contrôles des Agents** : fermer le détour de réactivation, compléter le journal existant, tester, avant tout versement.
2. **A1 réduit — aide de complétude** pour celui qui crée l'adresse, dans le moteur de suggestions existant.

**Différé avec conditions de réouverture (§3)** : A2 (entrée confirmée), A4 (acompte). **Conservé tel quel** : A5 (moyenne brute + nombre d'avis).

Ce qui a changé depuis la v1 :

| v1 | v2 | Raison (revue VP) |
|---|---|---|
| A1 : note de fiabilité /100, « Adresse sûre », malus si note ≤ 2/5 | Une suggestion au créateur, rien d'autre | R1 : `courier_reviews` est la note **de la livraison par la cliente**, pas de l'adresse (FAIT, `courierRateRow`, app.js ~6657) ; une précision GPS ne prouve pas la bonne porte |
| A3 : score de risque, gain « en vérification » au-delà d'un seuil | Matrice des contrôles existants, correction des manques, revue humaine | R2 : des indices (3 boutiques en 1 h, niveau rapide) peuvent être légitimes |
| A2 : construire maintenant, seuils 2 points / 25 m / 15 m | Différé, conditions de réouverture | R3 : besoin non prouvé ; seuils non démontrés ; traitement à cadrer |
| A4 : estimation de risque + suggestion d'acompte | Retiré ; d'abord documenter les motifs d'annulation | R4 : l'annulation n'a pas de motif (FAIT, app.js ~6226, `p_status: 'cancelled'` seul) |
| A5 : moyenne ajustée | Moyenne brute + nombre conservés | R5 : le fil n'est pas classé par note (FAIT, `md5(id ‖ date)`) ; pas de problème démontré |
| « Plus tard » : déclencheurs chiffrés = feu vert | Seuils **de réexamen** avec problème, source, règle de référence, mesure | R5 |

Affirmations de la v1 retirées : « aucun modèle ne battrait une règle lisible », « GPS souvent à 20–60 m », « personne d'autre ne l'a », « ne se copie pas ». Elles n'étaient pas démontrées.

## 2. Premier lot (proposé à la validation)

### A3. Contrôles des Agents avant tout versement

**Matrice : règle existante → preuve → manque réel.**

| Domaine | Règle existante (FAIT) | Preuve | Manque |
|---|---|---|---|
| Inscription | Compte et charte obligatoires ; un numéro = un Agent | `fiila_ambassador_register` (migration `20261019700000`) ; test `ambassadors.sql` « inscription » | **Numéro de l'Agent et numéro de versement non vérifiés par SMS** (action #34 ouverte ; le code SMS existe, `20261020300000_fiila_phone_verify.sql`, mais ne couvre que l'entrée dans une équipe) |
| Activation | Validation par le fondateur seulement ; avant, le code ne marche pas | `fiila_admin_ambassador_decide` ; test « validation par le fondateur » | — |
| Rattachement | Par le commerçant, 7 jours au plus, une seule fois, jamais à soi-même (compte ou numéro), démo exclue | `fiila_ambassador_link` ; tests « lien » et `agents.sql` « pas d'auto-rémunération » | — |
| Commandes admissibles | Commandes au numéro de l'Agent ou de la boutique exclues ; clientes distinctes | `fiila.amb_orders` ; test « niveau 2 » | **À VÉRIFIER** : une commande en retrait ou livrée hors Fii compte-t-elle comme « livrée » au niveau 2 ? Pas de test dédié |
| Plafond | 20 boutiques par mois (`amb_monthly_cap`) | Test « plafond mensuel » | — |
| Gains | En attente 30 jours, puis validés ; jamais recréés une fois acquis | `amb_refresh` ; tests « gains » et `agents.sql` « migration » | — |
| Versement | Manuel (Wave / Orange Money), puis « marqué versé » au back-office ; un gain versé ne peut plus être annulé (`status in ('pending','validated')`) ; motif obligatoire pour annuler | `fiila_admin_reward` ; test « gains » | — |
| Journal des gains | Chaque changement de statut d'un gain fait par l'équipe est journalisé une fois : `reward_<statut>`, auteur, date, identifiant, montant, boutique | Déclencheur `bo_audit` sur `ambassador_rewards` → `fiila.bo_audit_trg` (`20261020000000_fiila_backoffice.sql`, ~627–654) ; présent en production | **Le journal ne garde ni le motif ni l'ancien statut.** Aucun test ne vérifie un seul événement par gain changé. Le journal global est réservé au super admin : la fiche Agent ne montre pas cet historique |
| Exclusion | Annule les gains non versés, avec motif facultatif | `fiila_admin_ambassador_decide` ('exclude') | **Transitions non encadrées** : `suspend` ne vérifie pas l'état de départ, donc exclu → suspendu → `reactivate` → actif (ou → `training`) est possible pour l'équipe, sans motif obligatoire (vu dans le code et en production, non exécuté). Les gains annulés, eux, ne reviennent pas. Motif d'exclusion facultatif |

**Matrice des transitions proposée (Agent)** — tout le reste est refusé par le serveur :

| Depuis → vers | Action | Motif | Droit |
|---|---|---|---|
| review → active | approve | facultatif | fondateur (`need_admin`) |
| active → suspended | suspend | **obligatoire** | fondateur |
| suspended → active | reactivate | facultatif | fondateur |
| review / active / suspended → training | training | facultatif | fondateur |
| training / review / active / suspended → excluded | exclude | **obligatoire** | fondateur |
| excluded → suspended | **reinstate** (nouveau, seul chemin de sortie) | **obligatoire** | fondateur |

Un exclu ne sort donc que par `reinstate`, puis passe par « suspendu » : sa réactivation reste une seconde décision.

**Proposition (lot 1) :**
- **un seul mécanisme de journal** : compléter `bo_audit_trg` avec l'ancien statut et le motif (`reason` pour les gains, `note` pour les Agents), sans second appel dans `fiila_admin_reward` ;
- appliquer la matrice des transitions ci-dessus dans `fiila_admin_ambassador_decide` ;
- **rétablir un gain annulé**, un par un, avec motif : même gain, même montant, mêmes dates ; il revient à `pending` si `validate_after` n'est pas passé, sinon à `validated` ; aucun nouveau gain créé, aucune restauration en masse ; refusé si l'Agent est exclu ; un gain versé reste intouchable ;
- montrer dans la fiche Agent l'historique **de cet Agent seulement** (gains et décisions), lu par une fonction dédiée au droit `ambassadors` ; le journal global reste réservé au super admin ;
- tests SQL qui appellent directement les fonctions, sur données synthétiques : (1) numéro partagé légitime (boutique familiale) ; (2) recrutement groupé légitime ; (3) retrait ou livraison hors Fii au niveau 2 ; (4) gain versé intouchable, y compris après exclusion ; (5) exclu → aucun chemin vers actif sauf `reinstate` puis `reactivate` (tester suspend, reactivate, approve, training depuis exclu) ; (6) rétablissement : même gain, statut selon `validate_after`, répétition sans effet, rétablissement et versement concurrents sans double effet ; (7) journal : un événement par gain changé, aucun pour un gain inchangé dans un lot mixte, aucun pour une répétition sans effet ;
- **aucun score, aucun nouveau seuil** ; montants, barèmes, délais et conditions inchangés.

**Décision qui reste au fondateur (#34, principe déjà posé dans HANDOFF)** — portée proposée :
- le contrôle porte sur **le numéro effectivement utilisé pour le versement** ;
- si le numéro de versement est celui du compte de l'Agent, une seule vérification suffit ; s'il est différent, il est vérifié à son tour ;
- toute modification du numéro de versement annule sa vérification précédente ;
- « marquer versé » est refusé tant que le numéro de versement n'est pas vérifié.

La preuve conservée est la date de vérification (donnée de contrôle nouvelle, à mentionner au dossier CDP). L'état réel de l'envoi SMS n'est pas confirmé (`sms_verify = 0` dans les migrations ; production non interrogée) ; aucun service payant n'est activé par cette proposition. D'ici là, je recommande de **ne faire aucun versement**.

**Anomalies (plus tard, seulement si un cas réel se présente)** : elles s'afficheront comme motifs à examiner dans la file existante, jamais comme verdict. Pour chacune : source, preuve consultable par le rôle autorisé, responsable de revue, délai proposé au fondateur, décision motivée, rectification possible. Un gain acquis ne disparaît pas et ne reste pas bloqué indéfiniment.

**Back-office (règle 8)** : voir — historique de l'Agent dans sa fiche ; agir — réintégrer, rétablir un gain ; tracer — journal existant complété ; régler — rien de nouveau ; tester — les sept cas ci-dessus.

**Critères de recette :**
- un seul événement par gain dont le statut change, avec auteur, date, identifiant, montant, ancien et nouveau statut, motif ;
- aucun événement pour un gain inchangé ni pour une répétition sans effet ;
- un gain versé reste versé, quelle que soit l'action suivante ;
- depuis « exclu », seuls `reinstate` (motif obligatoire) puis `reactivate` mènent à « actif » ; tout autre appel direct est refusé ;
- un gain rétabli garde son identifiant, son montant et ses dates ; aucun second droit n'est créé ;
- les sept cas synthétiques passent ; aucune donnée réelle touchée.

**Effort (HYPOTHÈSE)** : une demi-journée.

### A1 réduit. Aide de complétude pour le créateur de l'adresse

**Ce que c'est** : une seule suggestion, facultative, à la personne qui a créé l'adresse, pour ce qui manque. Pas de note, pas de « Adresse sûre », pas de compteur, rien pour le public.

**Données (FAIT, table `fiila.places`)** : `photo`, `instruction`, `voice`, `vehicle_ok`, `stop_lat`/`stop_lng`, `entry_acc`. L'origine du point (GPS, manuel, collé) n'est **pas** enregistrée : seul `entry_acc` est gardé, et il vaut `null` pour un point manuel (FAIT, app.js ~1383).

**Qui la voit** : seulement une personne qui a le droit de modifier cette adresse (son propriétaire). C'est ce droit qui décide, pas le métier : un commerçant propriétaire de l'adresse la voit, un commerçant qui ouvre l'adresse d'une cliente ne la voit pas. Rien sur un lien reçu, rien pour un livreur ou un visiteur, et aucune écriture automatique.

**Règle (ordre fixe, on montre seulement le premier manque) :**
1. pas de photo de l'entrée → « Ajoutez une photo de l'entrée » ;
2. ni repère écrit, ni repère vocal → « Ajoutez un repère, écrit ou vocal » (l'un **ou** l'autre suffit ; aucune longueur minimale) ;
3. « accessible en voiture » non renseigné et pas d'arrêt voiture → « Indiquez où une voiture peut s'arrêter ».

Ce que la règle **ne fait pas** :
- elle ne regarde pas la précision GPS : un point manuel ne reçoit **aucun conseil sur sa précision** (il peut recevoir un conseil photo, repère ou arrêt si ce champ manque vraiment) ; la précision est déjà signalée au moment de la création (`accInfo`, app.js ~1303) ;
- elle ne lit pas `courier_reviews` ;
- elle ne juge pas le contenu : une photo fausse ou un repère court ne sont ni validés ni pénalisés ; une photo présente n'empêche pas un conseil sur un autre champ manquant ;
- elle ne bloque ni le partage ni la livraison.

**Où** : sur la page de l'adresse, vue par son propriétaire (surface existante), comme une suggestion du moteur de rétention du lot 1. Elle obéit donc au même budget : une exposition par session, deux par 7 jours, pause de 7 jours après un refus et arrêt au second (`retPick`, `retUsable`, `nudge`). Aucun bloc nouveau à côté de l'action principale.

**Portée de l'apprentissage** : l'état du moteur est tenu par identifiant de suggestion, pour tout l'appareil (`retObserve`, app.js ~706). Une seule suggestion `addr_complete` mélangerait donc les adresses et les manques. Proposition : trois suggestions distinctes, `addr_photo`, `addr_mark`, `addr_stop`. Chacune apprend une fonction : une fois que la personne a ajouté ce champ après l'avoir vue, elle connaît la fonction et la suggestion s'arrête pour toutes ses adresses. **Succès** = le champ conseillé est enregistré sur l'adresse où la suggestion a été vue ; un clic seul ou la modification d'une autre adresse ne comptent pas. L'identifiant de l'adresse reste sur le téléphone ; les compteurs du serveur ne reçoivent que `addr_photo:shown`, `:click`, `:used`, etc.

**Livreur et commerçant** : rien de nouveau au lot 1. Ils voient déjà la photo et les repères quand ils existent.

**Back-office (règle 8)** : voir — trois lignes dans le panneau Suggestions (affichée, touchée, utilisée, refusée sur 30 jours) ; régler — interrupteurs `sugg_addr_photo`, `sugg_addr_mark`, `sugg_addr_stop` ; tracer — changements de réglage déjà journalisés ; tester — cas fictifs ci-dessous.

**Critères de recette (cas fictifs, tous les champs précisés)** :

| Cas | Photo | Texte | Vocal | Voiture / arrêt | Droit | Attendu |
|---|---|---|---|---|---|---|
| Point manuel complet | oui | oui | non | renseigné | propriétaire | aucune suggestion, aucun conseil de précision |
| Point manuel sans arrêt | oui | oui | non | absent | propriétaire | `addr_stop` seulement |
| Photo fausse, sans repère | oui (fausse) | non | non | renseigné | propriétaire | `addr_mark` ; aucune mention « vérifiée » |
| Repère court | non | « portail vert » | non | renseigné | propriétaire | `addr_photo` ; le repère compte |
| Vocal sans texte | oui | non | oui | renseigné | propriétaire | aucune suggestion |
| Mauvaise note pour retard | oui | oui | non | renseigné | propriétaire | aucune suggestion, aucun effet |
| Adresse d'une cliente ouverte par un commerçant | non | non | non | absent | lecture seule | aucune suggestion |
| Commerçant propriétaire de sa propre adresse | non | oui | non | renseigné | propriétaire | `addr_photo` |
| Lien reçu (`#/a/…`) | non | non | non | absent | visiteur | aucune suggestion, aucune écriture |

Et aussi :
- budget partagé avec les autres suggestions (une par session, deux par 7 jours) ; refus → pause 7 jours, second refus → arrêt ;
- succès compté seulement si le champ conseillé est enregistré sur la même adresse ;
- aucun identifiant d'adresse dans `fiila.metrics` ;
- interrupteur à 0 → plus cette suggestion, sans autre changement ;
- capture d'écran conforme à la règle 7 (une seule action principale).

**Mesure (HYPOTHÈSE à éprouver)** : une adresse plus complète réduit les demandes de précision à la livraison. Mesure : part des suggestions suivies d'un ajout ; sur le terrain, les cas où le livreur a dû appeler, notés dans la fiche de test (`FICHE-TEST-TERRAIN.md`). Trop peu de cas = « non concluant », pas « validé ».

**Effort (HYPOTHÈSE)** : une demi-journée.

### Ordre

1. A3 (avant tout versement) ; 2. A1 réduit. Pas en parallèle. Les recettes déjà attendues (#63, #65, #66) restent prioritaires sur le terrain.

## 3. Différés : conditions de réouverture

### A2. Entrée confirmée par les livraisons — différé, bloquant avant toute collecte réelle

Réouverture seulement si les trois conditions sont réunies :
1. **Besoin prouvé sur le terrain** : des livraisons du pilote où le point de l'adresse menait à la mauvaise entrée, notées dans la fiche de test, et l'intérêt d'une correction confirmée par le propriétaire ;
2. **Cadrage du traitement** : qualification et formalité auprès de la CDP vérifiées (loi 2008-12, art. 4, 35, 58). Retirer l'identifiant du livreur ne suffit pas à rendre le point anonyme ;
3. **Proposition complète** : geste informé distinct du suivi ; précision et fraîcheur du relevé ; une contribution par livraison ; protection contre la répétition ; provenance minimale ; durée justifiée ; accès restreint ; suppression et remise à zéro quand l'entrée change ; aucune trace de suivi conservée.

Les seuils de la v1 (2 points, 25 m, 15 m) sont des **hypothèses**, pas des valeurs acquises. Rien ne déplace jamais une adresse automatiquement. Scénarios de test à prévoir : même livreur deux jours ; GPS imprécis ; arrêt voiture au lieu de la porte ; deux entrées voisines ; porte déplacée ; contribution malveillante ; refus du propriétaire.

### A4. Commandes non honorées — score et acompte retirés

Avant tout algorithme, il faut savoir **pourquoi** une commande est annulée. Proposition pour plus tard (hors lot 1, à valider séparément) : un motif facultatif à l'annulation — rupture de stock, boutique, livraison, cliente, inconnu — modifiable par la boutique.

Réouverture seulement si : un coût réel observé (courses perdues) ; des motifs exploitables ; un protocole prospectif. Comparer « avec / sans acompte » ne prouve pas l'effet de l'acompte, car les groupes ne sont pas choisis au hasard. Rupture, retard du livreur, annulation technique et motif inconnu ne sont jamais des fautes de la cliente. Aucun historique entre boutiques.

### A5. Notes — conservé tel quel

- **FAIT** : les avis affichés sont des avis **d'articles**, uniques par commande et article ; une même commande peut donc donner plusieurs avis. L'interface affiche moyenne et nombre (`ratingEl`, app.js ~6286), et n'affiche rien quand il n'y a aucun avis.
- On garde : moyenne brute + nombre d'avis, avec l'unité « avis d'article » dite clairement si on l'affiche ailleurs. Zéro avis = « aucun avis », jamais une moyenne inventée.
- Un score ajusté ne sera étudié que pour un vrai besoin de classement, séparé de la note publique.

## 4. Plus tard : seuils de réexamen (pas de feu vert automatique)

Atteindre un seuil ouvre **une étude**, pas une construction. Chaque ligne précise le problème à observer, la source, la règle simple qui sert de référence et la mesure qui décide.

| Algorithme | Problème à observer d'abord | Seuil de réexamen | Source | Règle de référence | Mesure de réussite ou d'abandon |
|---|---|---|---|---|---|
| Ordre de passage | Livreurs qui portent plusieurs courses à la fois et perdent du temps | Courses simultanées fréquentes chez les livreurs actifs | `orders`, statuts de course | L'ordre choisi par le livreur | Temps total réel, avec trajet routier et contraintes (créneaux, retrait), pas la distance à vol d'oiseau |
| Délai estimé | Clientes qui demandent « il arrive quand ? » | Couverture suffisante **par zone et par créneau**, pas un total de courses | Départ et arrivée des courses | Délai fixe annoncé par la boutique | Écart entre délai annoncé et réel, par zone |
| « Souvent commandés ensemble » | Boutiques qui vendent des articles complémentaires | Assez de **commandes distinctes** à plusieurs articles dans une boutique | `orders`, lignes | Articles les plus vendus de la boutique | Gain sur la popularité de base, pas seulement des cooccurrences |
| Prévision de stock | Ruptures fréquentes signalées par les boutiques | Stock suivi sur une durée suffisante | Stock, ventes | Reprendre les ventes de la semaine précédente | Ruptures évitées |
| Zones et tarifs | Tarifs de livraison contestés ou à perte | Livraisons réelles par commune | Courses, tarifs | Grille fixe actuelle | Courses à perte, litiges |

Aucun délai de réalisation n'est annoncé pour ces lignes.

## 5. À éviter (inchangé, précisé)

- Score opaque sur des personnes, apprentissage automatique sans volume ni vérification possible.
- Toute décision automatique défavorable : exclusion, refus ou blocage de gain, liste noire.
- Tout historique de clientes partagé entre boutiques.
- Toute conservation des positions des livreurs au-delà de l'engagement actuel (effacement à l'arrivée, `CONFORMITE-CDP.md`).
- Toute « certification » d'adresse tirée de la précision GPS ou d'une note de livraison.

## 6. Décisions demandées au fondateur

1. **Valider le premier lot** : A3 (transitions encadrées, journal complété, rétablissement d'un gain, sept tests) puis A1 réduit (trois suggestions au propriétaire de l'adresse). Oui / non / modifier.
2. **#34** : vérification SMS du numéro effectivement utilisé pour le versement, annulée à chaque changement de ce numéro ; « marquer versé » refusé sans elle. Je recommande oui, et aucun versement d'ici là.
3. **Motif d'annulation facultatif** (préparation d'A4) : à mettre dans un lot ultérieur, ou à laisser de côté.

## Message à transmettre à ChatGPT (copier-coller)

> Bonjour. v2.1 de `docs/PROPOSITION-ALGORITHMES.md` : tes corrections C1–C3 sont intégrées, et tes deux constats sont confirmés dans les migrations et dans la définition en production. C1 : le journal des gains existe (`bo_audit`) ; un seul mécanisme, complété par l'ancien statut et le motif ; critères d'unicité ajoutés. C2 : matrice des transitions de l'Agent ; un exclu ne sort que par `reinstate` (motif obligatoire) vers « suspendu » ; rétablissement d'un gain un par un (même gain, statut selon `validate_after`, versé intouchable) ; sept tests SQL en appel direct, dont concurrence et lot mixte. C3 : trois suggestions `addr_photo`, `addr_mark`, `addr_stop` ; succès = champ enregistré sur la même adresse ; visibles seulement avec le droit de modifier l'adresse ; tableau des cas fictifs avec tous les champs. SMS : portée sur le numéro de versement effectivement utilisé, annulée à chaque changement. Références corrigées (`fiila_ambassador_register`, v1 = `a2e1cd5`). Reste-t-il une réserve bloquante ?
