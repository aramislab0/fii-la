# Avis du Builder — Mandat UX-ADAPTATIVE-001

> Claude (Builder), 22/10/2026, à la demande du fondateur (« ok go », 20:53).
> Base lue : commit `0e07469` (= `29fbab8` + l'import du mandat + journal). Lecture du code et des tests uniquement : aucune mesure terrain.
> **Avis seulement.** Rien n'est implémenté, migré ni activé. L'implémentation attend l'accord explicite du fondateur.

## 1. Verdict

**ACCORD AVEC CHANGEMENTS, sur un périmètre plus petit que le mandat.**

- **Pas de nouveau bloc « Votre prochaine action ».** L'accueil a déjà une action principale adaptative : le grand bouton du haut (`homeHero`, `web/app.js:820`). La règle 7 (une seule action principale par écran) interdit d'en ajouter une seconde. La « prochaine action » du mandat, c'est ce bouton : on corrige sa façon d'apprendre au lieu de créer une deuxième surface.
- **Correction prioritaire.** Ce bouton apprend aujourd'hui des **écrans ouverts** (`noteActivity`, `web/app.js:789`). Le tableau des signaux du mandat (§4) dit précisément qu'une ouverture d'écran est « intérêt possible ; jamais réussite ». Il faut le faire apprendre des **tâches réussies et répétées**.
- **Pour les commerçants, rien ne bouge.** Leur bouton principal reste « Ma boutique » (décision du 22/10). Leur « prochaine action » est déjà la carte « commandes sans adresse » puis la suggestion du moteur de rétention (`retPick`, `web/app.js:722`), avec l'ordre validé. Je ne propose pas de personnaliser cet ordre.
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

**Stabilité.**
- Le choix est calculé à l'ouverture de la session et figé jusqu'à la fin de cette session.
- Le choix épinglé et les tâches commencées passent toujours devant.
- Une réussite peut changer le bouton à la session suivante, jamais dans la session en cours.

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
| Changement de compte sur le même téléphone | Journal séparé par contexte : « sans compte » et chaque compte. Les usages ne se mélangent pas. |
| Téléphone partagé sans compte | Un seul contexte local, sans prétendre reconnaître une personne |
| Stockage bloqué (navigation privée) | Règle fixe actuelle (« Créer mon adresse »), sans erreur |
| Éditeur d'une boutique | « Ma boutique » ; ses droits limitent déjà les suggestions (inchangé) |
| Personnalisation coupée au back-office | Retour immédiat à la règle d'avant, sans perte de données |

## 5. Périmètre minimal, coût, essai et retour arrière

**Périmètre (si accordé) :**
1. Journal des **réussites** par service et par contexte (compte ou « sans compte »), sur le téléphone. Il se branche sur les créations réussies déjà mesurées : `fiche_created`, `request_created`, course terminée, proposition de vide-dressing.
2. Le score et la règle du §3, à la place de `topActivity`. Le choix est figé par session.
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

**Coût estimé (hypothèse).** Environ une demi-journée de construction et de tests (Chrome et WebKit), plus la recette sur téléphone. Aucun service payant, aucune dépendance nouvelle.

**Essai.**
- Lancer `adaptive_home` = 1 pour tous, pendant 14 jours.
- Comparer aux 14 jours précédents, avec les compteurs existants `onboarding` (bouton touché).
- Ajouter le suivi terrain des boutiques et utilisateurs recrutés, avec leur accord.
- Critère utile : la part de sessions où le bouton principal mène à une **tâche réussie**.
- Critère d'arrêt : un seul retour terrain « le bouton a changé et je ne m'y retrouve plus » remet `adaptive_home` à 0 le temps d'examiner.
- Limite : sans tirage au sort et avec ces volumes, aucune conclusion causale. C'est un contrôle de non-dégradation, pas une preuve de gain.

**Retour arrière.** `adaptive_home` = 0 rétablit la règle actuelle. Le journal des réussites est gardé et inutilisé : aucune donnée perdue, rien à migrer.

**Recommandation unique.** Faire seulement le correctif « apprendre des réussites, figé par session, choix de l'utilisateur et remise à zéro », derrière `adaptive_home`. Ne rien personnaliser d'autre avant d'avoir des données terrain.

## 6. Arbitrages pour le fondateur

1. **Pas de nouveau bloc.** On adapte le bouton principal existant au lieu d'ajouter « Votre prochaine action ». *Recommandé : oui.*
2. **Commerçants exclus de l'adaptation.** « Ma boutique » reste fixe ; l'ordre des suggestions reste celui validé. *Recommandé : oui.*
3. **Contrôles dans la feuille des services** (explication, « Mettre en premier », remise à zéro) plutôt qu'un lien « Pourquoi ? » sur l'accueil. *Recommandé : oui (règle 7).*
4. **Paramètres de départ** : demi-vie de 7 jours, au moins 2 réussites, fenêtre de 30 jours. *À valider comme hypothèses.*
5. **Essai de 14 jours** sans groupe témoin, arrêt sur un retour terrain négatif. *À valider.*
