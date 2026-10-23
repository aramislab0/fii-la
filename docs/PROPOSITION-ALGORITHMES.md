# Proposition — Algorithmes utiles à Fii, maintenant et plus tard

> **v2, 23/10/2026**, par le Builder (Claude). Intègre les cinq changements R1–R5 de la revue VP du 22/10 (`docs/REVUE-VP.md`, verdict ALIGNÉ AVEC RÉSERVES). La v1 (commit `0988e5d`) reste dans l'historique git.
> **Rien n'est construit avant la validation du fondateur.** Ce document n'autorise aucun code, migration, collecte ni activation.
> Base lue : `main` après `b2303be`. Chaque affirmation est marquée **FAIT** (vérifié dans le dépôt, avec la référence), **HYPOTHÈSE** (à éprouver) ou **À VÉRIFIER**.

## 1. Verdict

**Au pilote : pas de score.** On renforce les contrôles humains qui existent et on aide la personne qui crée l'adresse. Les scores (fiabilité /100, fraude, risque client, note lissée) sont retirés ou différés : les signaux ne sont pas assez sûrs et le volume ne permet pas de les vérifier.

**Premier lot proposé (§2)** — petit, réversible, sans donnée nouvelle :
1. **A3 — audit des contrôles des Agents** et correction des manques trouvés, avant tout versement.
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
| Inscription | Compte et charte obligatoires ; un numéro = un Agent | `fiila_ambassador_join` (migration `20261019700000`) ; test `ambassadors.sql` « inscription » | **Numéro de l'Agent et numéro de versement non vérifiés par SMS** (action #34 ouverte ; le code SMS existe, `20261020300000_fiila_phone_verify.sql`, mais ne couvre que l'entrée dans une équipe) |
| Activation | Validation par le fondateur seulement ; avant, le code ne marche pas | `fiila_admin_ambassador_decide` ; test « validation par le fondateur » | — |
| Rattachement | Par le commerçant, 7 jours au plus, une seule fois, jamais à soi-même (compte ou numéro), démo exclue | `fiila_ambassador_link` ; tests « lien » et `agents.sql` « pas d'auto-rémunération » | — |
| Commandes admissibles | Commandes au numéro de l'Agent ou de la boutique exclues ; clientes distinctes | `fiila.amb_orders` ; test « niveau 2 » | **À VÉRIFIER** : une commande en retrait ou livrée hors Fii compte-t-elle comme « livrée » au niveau 2 ? Pas de test dédié |
| Plafond | 20 boutiques par mois (`amb_monthly_cap`) | Test « plafond mensuel » | — |
| Gains | En attente 30 jours, puis validés ; jamais recréés une fois acquis | `amb_refresh` ; tests « gains » et `agents.sql` « migration » | — |
| Versement | Manuel (Wave / Orange Money), puis « marqué versé » au back-office ; un gain versé ne peut plus être annulé (`status in ('pending','validated')`) | `fiila_admin_reward` ; test « gains » | **Ni « versé » ni « annulé » ne sont tracés dans `bo_log`** : on ne sait pas qui a marqué, quand, ni pour quel motif |
| Exclusion | Annule les gains non versés, avec motif facultatif | `fiila_admin_ambassador_decide` ('exclude') | **Pas de retour possible** : aucune action « réintégrer », et les gains annulés ne peuvent pas être rétablis. Motif facultatif |

**Proposition (lot 1) :**
- tracer `paid` et `cancel` de `fiila_admin_reward` dans `bo_log` (qui, quand, montant, motif) ;
- rendre le motif d'exclusion obligatoire ; ajouter « réintégrer » (exclu → suspendu) **sans** rétablir automatiquement les gains : l'équipe les rétablit un par un, avec motif tracé ;
- ajouter les tests manquants sur données synthétiques : numéro partagé légitime (boutique familiale) ; recrutement groupé légitime ; retrait ou livraison hors Fii ; gain déjà versé intouchable ; réintégration ; transitions de statut vérifiées **côté serveur**, pas seulement par le bouton ;
- **aucun score, aucun nouveau seuil** ; montants, délais et conditions inchangés.

**Décision qui reste au fondateur (#34)** : SMS obligatoire pour le numéro de l'Agent et le numéro de versement avant le premier versement. L'envoi SMS n'est pas encore confirmé en réel (`sms_verify = 0`). Sans cette décision, je recommande de **ne faire aucun versement**.

**Anomalies (plus tard, seulement si un cas réel se présente)** : elles s'afficheront comme motifs à examiner dans la file existante, jamais comme verdict. Pour chacune : source, preuve consultable par le rôle autorisé, responsable de revue, délai proposé au fondateur, décision motivée, rectification possible. Un gain acquis ne disparaît pas et ne reste pas bloqué indéfiniment.

**Back-office (règle 8)** : voir — journal des versements et annulations dans la fiche Agent ; agir — réintégrer, rétablir un gain ; tracer — `bo_log` ; régler — rien de nouveau ; tester — les cas ci-dessus.

**Critères de recette :**
- chaque « versé » et chaque « annulé » apparaît dans le journal avec auteur, date, montant et motif ;
- un gain versé reste versé, quelle que soit l'action suivante (exclusion comprise) ;
- un Agent exclu peut être réintégré ; ses gains annulés ne reviennent qu'un par un, avec motif ;
- les six cas synthétiques passent ; aucune donnée réelle touchée.

**Effort (HYPOTHÈSE)** : une demi-journée.

### A1 réduit. Aide de complétude pour le créateur de l'adresse

**Ce que c'est** : une seule suggestion, facultative, à la personne qui a créé l'adresse, pour ce qui manque. Pas de note, pas de « Adresse sûre », pas de compteur, rien pour le public.

**Données (FAIT, table `fiila.places`)** : `photo`, `instruction`, `voice`, `vehicle_ok`, `stop_lat`/`stop_lng`, `entry_acc`. L'origine du point (GPS, manuel, collé) n'est **pas** enregistrée : seul `entry_acc` est gardé, et il vaut `null` pour un point manuel (FAIT, app.js ~1383).

**Règle (ordre fixe, on montre seulement le premier manque) :**
1. pas de photo de l'entrée → « Ajoutez une photo de l'entrée » ;
2. ni repère écrit, ni repère vocal → « Ajoutez un repère, écrit ou vocal » (l'un **ou** l'autre suffit ; aucune longueur minimale) ;
3. « accessible en voiture » non renseigné et pas d'arrêt voiture → « Indiquez où une voiture peut s'arrêter ».

Ce que la règle **ne fait pas** :
- elle ne regarde pas la précision GPS : un point manuel exact sans précision ne déclenche rien et n'est jamais pénalisé ; la précision est déjà signalée au moment de la création (`accInfo`, app.js ~1303) ;
- elle ne lit pas `courier_reviews` ;
- elle ne juge pas le contenu : une photo fausse ou un repère court ne sont ni validés ni pénalisés ;
- elle ne bloque ni le partage ni la livraison.

**Où** : sur la page de l'adresse, vue par son propriétaire (surface existante), comme une suggestion du moteur de rétention du lot 1. Elle obéit donc au même budget : une exposition par session, deux par 7 jours, fin après refus, « déjà fait » ou usage (`retPick`, `nudge`). Aucun bloc nouveau à côté de l'action principale.

**Livreur et commerçant** : rien de nouveau au lot 1. Ils voient déjà la photo et les repères quand ils existent.

**Back-office (règle 8)** : voir — ligne « Adresse incomplète » dans le panneau Suggestions (affichée, touchée, faite, refusée sur 30 jours) ; régler — interrupteur `sugg_addr_complete` ; tracer — changements de réglage déjà journalisés ; tester — cas fictifs ci-dessous.

**Critères de recette (cas fictifs) :**
- point manuel exact sans précision, photo et repère présents → aucune suggestion ;
- photo présente mais fausse → aucune suggestion, aucune mention « vérifiée » ;
- repère court utile (« portail vert ») → compte comme repère ;
- vocal sans texte → compte comme repère ;
- adresse ayant une mauvaise note de livraison pour retard → aucun effet ;
- aucune suggestion vue par un livreur, un commerçant ou un visiteur ;
- interrupteur à 0 → plus aucune suggestion, sans autre changement ;
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

1. **Valider le premier lot** : A3 (journal des versements, réintégration, tests) puis A1 réduit (suggestion au créateur). Oui / non / modifier.
2. **#34** : SMS obligatoire pour le numéro de l'Agent et le numéro de versement avant le premier versement. Je recommande oui, et aucun versement d'ici là.
3. **Motif d'annulation facultatif** (préparation d'A4) : à mettre dans un lot ultérieur, ou à laisser de côté.

## Message à transmettre à ChatGPT (copier-coller)

> Bonjour. La v2 de `docs/PROPOSITION-ALGORITHMES.md` intègre tes cinq réserves R1–R5. Résumé : aucun score au pilote. Premier lot : (1) A3 — matrice des contrôles Agents existants avec références et tests ; trois manques trouvés (versé/annulé non tracés dans `bo_log` ; numéro Agent et numéro de versement non vérifiés par SMS, #34 ; exclusion sans retour possible ni motif obligatoire) ; correction et six tests synthétiques, sans score ni changement de montant. (2) A1 réduit — une suggestion au créateur de l'adresse (photo, repère écrit ou vocal, arrêt voiture), dans le moteur de rétention existant, sans lecture de la précision GPS ni de `courier_reviews`. A2 et A4 différés avec conditions de réouverture ; A5 inchangé ; « plus tard » transformé en seuils de réexamen. Peux-tu vérifier que la v2 lève tes réserves et que les critères de recette sont suffisants ? Ajoute ton avis en haut de `docs/REVUE-VP.md`.
