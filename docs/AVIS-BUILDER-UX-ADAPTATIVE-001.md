# Avis du Builder — Mandat UX-ADAPTATIVE-001

> Claude (Builder), 22/10/2026, à la demande du fondateur (« ok go », 20:53).
> Base lue : commit `0e07469` (= `29fbab8` + l'import du mandat + journal). Lecture du code et des tests uniquement : aucune mesure terrain.
> **Avis seulement.** Rien n'est implémenté, migré ni activé. L'implémentation attend l'accord explicite du fondateur.
>
> **v1.1 (22/10, 21:05)** : relue point par point contre le mandat, à la demande du fondateur. Quatre corrections, détaillées au §0.

## 0. Relecture contre le mandat : corrections de la v1.1

| # | Mandat | v1 | v1.1 |
|---|---|---|---|
| C1 | §3 : « à intégrer dans une surface existante si possible ; ne pas ajouter une deuxième action principale » | Présenté comme un changement (« pas de nouveau bloc ») | **C'est ce que demande le mandat.** Ce n'est pas un désaccord : la surface existante est le bouton principal de l'accueil et, pour une boutique, le haut de Ma boutique. |
| C2 | §3 : « recalculer à des moments stables (arrivée sur l'accueil, retour après une tâche réussie) » | Choix figé pour toute la session | **Recalcul à l'arrivée sur l'accueil et au retour après une tâche réussie**, jamais pendant qu'un écran est affiché. Le figé par session est retiré. |
| C3 | §3 : « ne pas confondre acheteur, commerçant, livreur ; une même personne peut avoir plusieurs usages » ; §6 : protocole adapté **aux boutiques recrutées** | Commerçants exclus de l'adaptation | **Commerçants inclus**, sur leur surface existante (le haut de Ma boutique), sans toucher au bouton « Ma boutique » ni à l'ordre validé (§3 bis). Le pilote, qui recrute des boutiques, mesure donc bien quelque chose. |
| C4 | §5 : état « isolé par compte / boutique et rôle » | Isolé par compte seulement | **Contexte = compte (ou « sans compte ») + boutique + rôle.** Changer de boutique ou de rôle change de contexte. |

Le reste de l'avis (signaux, auto-renforcement, contrôles, données, retour arrière) tient tel quel.


## 1. Verdict

**ACCORD AVEC CHANGEMENTS, sur un périmètre plus petit que le mandat.**

- **« Votre prochaine action » sur les surfaces existantes**, comme le demande le mandat (§3). Pour un particulier ou un livreur : le grand bouton du haut de l'accueil (`homeHero`, `web/app.js:820`), déjà adaptatif. Pour une boutique : le haut de Ma boutique (§3 bis). Aucun bloc ni action principale en plus (règle 7).
- **Correction prioritaire.** Ce bouton apprend aujourd'hui des **écrans ouverts** (`noteActivity`, `web/app.js:789`). Le tableau des signaux du mandat (§4) dit précisément qu'une ouverture d'écran est « intérêt possible ; jamais réussite ». Il faut le faire apprendre des **tâches réussies et répétées**.
- **Commerçants : sur leur surface, sans déplacer leurs commandes.** Leur bouton principal reste « Ma boutique » (décision du 22/10), et « Nouvelle commande » reste l'action de Ma boutique. Le haut de Ma boutique montre la prochaine action dans cet ordre : besoin bloquant (commande sans adresse), puis tâche commencée à reprendre, puis suggestion du moteur de rétention, dans l'ordre validé (§3 bis). Je ne propose pas de personnaliser cet ordre.
- **Pas de modèle entraîné, pas d'IA, pas de service payant.** Une règle lisible, des paramètres versionnés, l'état sur le téléphone.

### Le meilleur argument contre

**Au stade du pilote, il n'y a pas assez de répétitions pour apprendre quoi que ce soit qu'une règle fixe ne fasse déjà.** Prenons 20 boutiques et quelques dizaines de particuliers. La plupart ouvrent l'app quelques fois par semaine, pour une ou deux tâches. Un classement « appris » sur 14 jours repose alors sur 2 à 5 événements par personne. Il hésitera, ou suivra le bruit.

Le seul effet visible pour l'utilisateur serait un bouton principal qui change de place d'une visite à l'autre. C'est contraire à la règle « simple et intuitif », et c'est le motif pour lequel l'arbitrage A1 du 20/10 avait écarté « la dernière activité ».

L'adaptation doit donc rester **lente, stable et facile à neutraliser**. Sa valeur principale n'est pas d'être maline : c'est **de ne pas se tromper de signal**.

## 2. Ce qui existe déjà et ce qui manque

| Élément | Où (`web/app.js`) | Ce qu'il fait | Écart avec le mandat |
|---|---|---|---|
| Bouton principal de l'accueil | `homeHero` 820 | Priorité fixe : adresse commencée (`addressDraftStarted` 816) → démarrage de boutique en cours (`setupPending` 5234) → boutique (`shopHero` 845) → activité la plus fréquente sur 14 jours (`topActivity` 808, au moins 2 occurrences) → « Créer mon adresse » | **Le signal est une ouverture d'écran**, pas une réussite. Le choix est recalculé à chaque affichage. Aucune explication, aucun moyen de choisir son bouton, aucune remise à zéro. |
| Journal d'activité | `noteActivity` 789, `actState` 787, `fiila.acts` | Une marque par écran ouvert (au plus toutes les 10 min), gardée 14 jours | Compte les visites, y compris les abandons et les ouvertures par erreur. Non isolé par compte : un téléphone partagé mélange les usages. |
| « Mes activités » | `myActivities` 800, `homeActivities` 882 | Raccourcis des services utilisés ou présents sur le téléphone ; « Retirer de l'accueil » | Conforme : accès conservé, retrait volontaire. |
| Moteur de rétention v2 | `retPick` 722, `retObserve` 706, `retBudget` 685, `afterTask` 936 | Budget commun ; clic, refus, connu, utilisé, répété ; succès relus dans l'état réel | Conforme au §4 du mandat. **C'est le bon socle** : il distingue déjà clic et réussite. |
| Tâche bloquante | `addressDueCard` 985 | Commandes sans adresse, en tête de Ma boutique, hors budget | Conforme (« besoin métier bloquant d'abord »). |
| Compteur de réussites | `bumpTx` 6136, `fiila.tx` | Un total unique (adresse, demande, commande) | Ne dit pas **quelle** tâche a réussi. |

**Divergence avec la rétention v2 : aucune.** Je ne touche ni à l'ordre validé (articles → partage → photos → livreur → membre), ni au budget, ni aux états. Le bouton principal est hors budget, comme aujourd'hui : c'est l'action principale, pas une suggestion.

## 3. Règle de sélection proposée (bouton principal des particuliers et livreurs)

### Matrice signaux → décision → succès

| Signal | Ce qu'il change | Succès qui le confirme |
|---|---|---|
| Tâche commencée et non finie (brouillon d'adresse, démarrage de boutique) | Priorité absolue, comme aujourd'hui : « Reprendre… » | Tâche terminée |
| Boutique présente | Bouton fixe « Ma boutique » (décision du 22/10) | — |
| **Réussite d'une tâche** : adresse créée, événement créé, demande envoyée, course terminée, article de vide-dressing proposé | +1 au score de ce service, pondéré par la récence | La réponse du serveur (création réussie), déjà disponible dans le code |
| **Réussite répétée** à une autre occasion (un autre jour) | Bonus : usage établi | Seconde réussite au moins un jour après la première |
| Action choisie à la main (« Mettre en premier ») | Priorité au choix de l'utilisateur, dans la limite des tâches bloquantes | — |
| Écran ouvert, clic | **Rien.** Sert seulement à départager deux scores égaux | — |
| Abandon, erreur, panne | **Rien** (cause inconnue : on ne pénalise pas) | — |
| Service retiré de l'accueil | Jamais en bouton principal tant qu'il n'est pas remis | — |

### Pseudocode

```
actionPrincipale(contexte):
  si brouillon d'adresse        → « Reprendre mon adresse »
  si démarrage de boutique      → « Reprendre ma boutique »
  si boutique                   → « Ma boutique »                         (décision du 22/10)
  si choix épinglé valable      → service épinglé                         (« Mettre en premier »)
  si session.figé existe        → session.figé                            (stabilité : pas de changement sous le doigt)
  scores = pour chaque service non retiré :
             Σ réussites × 0,5^(âge_jours / DEMI_VIE) + BONUS_REPETITION si réussi deux jours différents
  meilleur = service au score le plus haut, si score ≥ SEUIL
  égalité  → le plus récemment réussi ; puis celui le plus ouvert (départage seulement) ; puis « Créer mon adresse »
  sinon    → « Créer mon adresse »                                         (défaut actuel, compréhensible)
  session.figé = résultat ; renvoyer résultat
```

**Paramètres (hypothèses versionnées `adaptive_v1`, à ajuster sur le terrain, non optimaux) :**
- `DEMI_VIE` = 7 jours ;
- `BONUS_REPETITION` = 1 ;
- `SEUIL` = 2. Il faut au moins deux réussites, ou une réussite répétée, pour que le bouton quitte « Créer mon adresse » : c'est le seuil actuel, appliqué cette fois aux réussites.
- Fenêtre de calcul : 30 jours.

**Auto-renforcement évité.** Le score ne compte que des réussites, jamais des expositions ni des clics sur le bouton. Être affiché plus souvent ne fait pas monter un service.

**Stabilité (C2).**
- Le choix est recalculé à deux moments seulement : à l'arrivée sur l'accueil, et au retour après une tâche réussie.
- Jamais pendant qu'un écran est affiché, et jamais à la suite d'une simple navigation sans réussite.
- Le choix épinglé et les tâches commencées passent toujours devant.

### 3 bis. Surface d'une boutique (C3)

Le haut de Ma boutique existe déjà : carte « commandes sans adresse », puis une suggestion. Il devient la « prochaine action » de la boutique, sans nouvel emplacement.

```
prochaineActionBoutique(contexte = compte + boutique + rôle):
  1. besoin bloquant          → commandes sans adresse                 (existe, hors budget)
  2. tâche commencée          → « Reprendre l'article » (brouillon d'article non enregistré) ;
                                « Reprendre la commande » (commande en cours de saisie)
                                — seulement si un brouillon existe dans ce contexte
  3. sinon                    → suggestion du moteur de rétention (retPick), ordre validé, budget commun
```

- **Rôle.** Un éditeur ne voit que ce que son rôle peut faire : le moteur filtre déjà le livreur et l'équipe.
- **Plusieurs usages.** Une personne qui a une boutique et crée aussi des adresses ou des événements garde « Ma boutique » en bouton principal. Ses autres activités restent dans « Mes activités », sans réordonnancement automatique : c'est un invariant du mandat, aucun déplacement sur prédiction.
- **À l'implémentation, deux brouillons à créer**, uniquement sur le téléphone : l'article en cours de saisie et la commande en cours de saisie. Aucune donnée de client n'est envoyée.

### Contrôle par l'utilisateur, sans écran de plus (règle 7)

Ces commandes vont dans la feuille « Découvrir les services », déjà existante :
- une ligne discrète en tête : « Action principale de l'accueil : Événement — choisie d'après vos 3 derniers événements créés » ;
- « Mettre en premier » sur chaque service ;
- « Revenir au choix automatique » ;
- « Remettre à zéro » : efface uniquement le journal d'activité. Les adresses, commandes, articles et droits ne sont jamais touchés.

## 4. Cas de contrôle (à automatiser si l'implémentation est accordée)

| Cas | Résultat attendu |
|---|---|
| Nouvel utilisateur, rien fait | « Créer mon adresse » |
| Particulier : 3 événements créés en 10 jours | « Créer un événement », stable pendant toute la session |
| Ouvre « Demander » 6 fois sans rien envoyer | **Ne change pas** le bouton (des écrans ouverts ne sont pas des réussites) |
| Multi-usage : 2 adresses et 2 demandes réussies | Égalité → la réussite la plus récente ; le bouton ne bascule pas pendant la session |
| Commerçant récurrent | « Ma boutique » ; à l'intérieur, commandes sans adresse puis suggestion du moteur (inchangé) |
| Commande urgente sans adresse | La carte en tête de Ma boutique passe avant tout, hors budget (inchangé) |
| Abandon après un clic | Aucun effet sur le score |
| Panne ou erreur serveur à l'envoi | Aucun effet (pas de réussite, pas de pénalité) |
| Service retiré de l'accueil | Jamais en bouton principal ; remis par la feuille des services |
| Choix épinglé | Le service épinglé, sauf tâche commencée ou boutique |
| Changement de compte sur le même téléphone | Journal séparé par contexte (compte ou « sans compte », boutique, rôle). Les usages ne se mélangent pas. |
| Changement de boutique, ou éditeur dans une autre boutique | Nouveau contexte : ni reprise ni suggestion d'une autre boutique |
| Refus d'une suggestion | Pause de 7 jours, arrêt au deuxième refus (règles existantes du moteur, inchangées) |
| Brouillon d'article abandonné | « Reprendre l'article » en haut de Ma boutique, sauf si une commande attend une adresse |
| Téléphone partagé sans compte | Un seul contexte local, sans prétendre reconnaître une personne |
| Stockage bloqué (navigation privée) | Règle fixe actuelle (« Créer mon adresse »), sans erreur |
| Éditeur d'une boutique | « Ma boutique » ; ses droits limitent déjà les suggestions (inchangé) |
| Personnalisation coupée au back-office | Retour immédiat à la règle d'avant, sans perte de données |

## 5. Périmètre minimal, coût, essai et retour arrière

**Périmètre (si accordé) :**
1. Journal des **réussites** par service et par contexte (compte ou « sans compte », boutique, rôle), sur le téléphone. Il se branche sur les créations réussies déjà mesurées : `fiche_created`, `request_created`, course terminée, proposition de vide-dressing.
2. Le score et la règle du §3, à la place de `topActivity`, recalculés à l'arrivée sur l'accueil et après une réussite.
2 bis. Le haut de Ma boutique selon le §3 bis : reprise d'un article ou d'une commande commencés, sur le téléphone.
3. Dans la feuille des services : la ligne d'explication, « Mettre en premier », « Revenir au choix automatique », « Remettre à zéro ».
4. Un réglage `adaptive_home` (0 = règle actuelle) et la version des paramètres affichée.
5. **Back-office minimal** (règle 8), dans Croissance → Parcours d'accueil :
   - version et règle actives ;
   - interrupteur, inscrit dans l'historique de l'équipe ;
   - aperçu du bouton choisi sur 5 cas fictifs ;
   - compteurs anonymes : bouton touché, puis tâche réussie dans la même session, par service ;
   - nombre de « Mettre en premier » et de remises à zéro.

**Données.**
- Aucune nouvelle donnée envoyée au serveur, en dehors de compteurs anonymes et agrégés : `home_hero` × service × (`shown`, `click`, `success`), et `home_pin` / `home_reset`.
- Le journal reste sur le téléphone. Il ne contient que des noms de service et des dates de réussite : ni contenu, ni coordonnées, ni photos.
- Il est effacé par « Remettre à zéro » ou en vidant les données du navigateur.
- Les pages reçues par lien n'écrivent toujours rien sur le téléphone sans action.

**Coût estimé (hypothèse).** Environ une journée de construction et de tests (Chrome et WebKit) avec la surface de la boutique, plus la recette sur téléphone. Aucun service payant, aucune dépendance nouvelle.

**Essai.**
- Lancer `adaptive_home` = 1 pour tous, pendant 14 jours.
- Comparer aux 14 jours précédents, avec les compteurs existants `onboarding` (bouton touché).
- Ajouter le suivi terrain des boutiques et utilisateurs recrutés, avec leur accord.
- Critères, comparés au comportement actuel :
  - la part de sessions où l'action proposée mène à une **tâche réussie** ;
  - les **reprises utiles** (brouillon repris, puis enregistré) ;
  - les **erreurs et abandons** ;
  - la **répétition** à une occasion ultérieure.
- **Pour les boutiques recrutées** : suivi dans la fiche terrain (grille du §5), avec leur accord.
- Critère d'arrêt : un seul retour terrain « le bouton a changé et je ne m'y retrouve plus » remet `adaptive_home` à 0 le temps d'examiner.
- Limite : sans tirage au sort et avec ces volumes, aucune conclusion causale. C'est un contrôle de non-dégradation, pas une preuve de gain.

**Retour arrière.** `adaptive_home` = 0 rétablit la règle actuelle. Le journal des réussites est gardé et inutilisé : aucune donnée perdue, rien à migrer.

**Recommandation unique.** Construire le périmètre ci-dessus, et seulement lui, derrière `adaptive_home` :
- l'accueil apprend des réussites, avec des moments de recalcul stables ;
- le haut de Ma boutique propose besoin bloquant → reprise → suggestion ;
- l'utilisateur garde la main (« Mettre en premier », remise à zéro).

Ne rien personnaliser d'autre avant d'avoir des données terrain.

## 6. Arbitrages pour le fondateur

1. **Surfaces existantes** : bouton principal de l'accueil pour les particuliers et livreurs, haut de Ma boutique pour les boutiques (conforme au mandat §3). *Recommandé : oui.*
2. **Boutiques : besoin bloquant → reprise → suggestion**, sans déplacer « Ma boutique » ni « Nouvelle commande », et avec l'ordre des suggestions validé. *Recommandé : oui.*
3. **Contrôles dans la feuille des services** (explication, « Mettre en premier », remise à zéro) plutôt qu'un lien « Pourquoi ? » sur l'accueil. *Recommandé : oui (règle 7).*
4. **Paramètres de départ** : demi-vie de 7 jours, au moins 2 réussites, fenêtre de 30 jours. *À valider comme hypothèses.*
5. **Essai de 14 jours** sans groupe témoin, arrêt sur un retour terrain négatif. *À valider.*
