# Mandat UX-ADAPTATIVE-001 — Avis du Builder avant exécution

Date : 22/10/2026 · Produit : Fii · Destinataire : Claude, Builder
**Statut : AVIS DEMANDÉ — analyse et proposition autorisées ; implémentation et activation non autorisées par ce mandat.**

## 1. Demande du fondateur et décision attendue

Le fondateur souhaite un système qui apprend des besoins, habitudes et usages de chaque utilisateur et adapte progressivement son expérience, tout en respectant la charte visuelle et UX générale. Il demande explicitement l'avis de Claude avant exécution.

Le VP recommande une personnalisation des priorités et de l'accompagnement dans une interface stable. **Cette direction est une proposition à discuter, pas un algorithme déjà validé ni une promesse de rétention.**

Claude doit rendre un avis argumenté (accord, accord avec changements ou désaccord), une proposition minimale et les arbitrages nécessaires. Le fondateur examine cet avis avant de donner son accord d'implémentation.

## 2. Base vérifiée et articulation avec l'existant

Base documentaire et code lus : commit `29fbab8b878e16d35115b8865548735e938ee3d6`.
Sources : `CLAUDE.md`, `docs/HANDOFF.md`, `docs/REVUE-VP.md`, `docs/PROPOSITION-RETENTION.md` v2, `web/app.js` (arbitre de rétention et `shopNudge`).

**FAIT :** la v2 de rétention est consignée comme validée le 22/10 à 19:20 ; le lot 1 est présent dans ce commit : arbitre commun, six suggestions, états distincts, priorité à la commande sans adresse et back-office Suggestions. Sa recette terrain n'est pas démontrée par la présente lecture.
**ANALYSE :** ce moteur est le point d'extension à étudier. Un second moteur parallèle ferait courir un risque de suggestions contradictoires et de budgets de fréquence indépendants.
**HYPOTHÈSE :** mieux choisir une prochaine action selon des usages réussis et répétés peut réduire les manipulations inutiles. Le gain reste à mesurer.

L'ordre articles → partage → photos → livreur → membre validé dans HANDOFF constitue la référence actuelle. Proposer de le personnaliser exige de signaler ce changement et d'obtenir la validation du fondateur. Ce mandat ne retire aucune validation antérieure et ne relance pas une refonte globale.

## 3. Périmètre proposé pour le premier essai

Une seule surface adaptative : **le contenu du bloc « Votre prochaine action »**, à intégrer dans une surface existante si possible. Ne pas ajouter une deuxième action principale.

- Une tâche explicite inachevée et un besoin métier bloquant, tel qu'une commande sans adresse, passent avant une préférence supposée.
- À défaut : classer uniquement des actions déjà disponibles, pertinentes et autorisées pour le rôle courant.
- Sans historique suffisant : conserver une priorité déterministe compréhensible, compatible avec le parcours actuel.
- Recalculer à des moments stables (arrivée sur l'accueil, retour après une tâche réussie) ; ne pas faire changer un bouton sous le doigt.
- Ne pas confondre un acheteur ponctuel, un commerçant et un livreur ; une même personne peut avoir plusieurs usages.

**Invariants :** navigation, emplacement des commandes essentielles, charte couleur et typographique, composants, libellés et sens des actions, accessibilité, fonctionnement sans compte et accès à tous les services. Aucun déplacement automatique des onglets ou masquage d'une fonction sur la seule base d'une prédiction.

## 4. Signaux et logique à proposer

| Signal | Interprétation admissible |
|---|---|
| Préférence explicite, action épinglée | Priorité exprimée, dans les limites du rôle et du besoin métier |
| Tâche réussie, puis répétée à une autre occasion | Usage établi, avec récence |
| Clic ou ouverture d'écran | Intérêt possible ; jamais réussite |
| Brouillon ou tâche commencée | Possibilité de reprise, sans conclure à un besoin permanent |
| Refus explicite | Pause ou arrêt selon les règles existantes |
| Abandon ou erreur | Cause inconnue ; ne pas déduire un désintérêt ou pénaliser une panne |

Commencer par des règles et un score inspectable ; pas de modèle entraîné, de service payant ni d'appel LLM nécessaire par défaut. Claude peut contester ce choix avec un besoin concret non couvert.

Proposer la gestion de la récence, du manque de données, des signaux contradictoires, des égalités et de la stabilité. Ne pas inventer de poids « optimaux » : les paramètres initiaux sont des hypothèses versionnées, à tester. Le système met à jour un état de préférences ; il ne réécrit pas son propre code, ses droits ou ses critères de qualité.

Prévenir l'auto-renforcement : une action très affichée ne doit pas être réputée préférée parce qu'elle a reçu davantage d'expositions. Les fonctions non utilisées restent accessibles ; une découverte éventuelle respecte l'arbitre existant.

## 5. Contrôle utilisateur et données

Étudier des commandes discrètes : « Pourquoi cette suggestion ? », épingler une préférence, désactiver ou réinitialiser la personnalisation. Réinitialiser les préférences ne supprime jamais les commandes, adresses, articles ou droits.

État local minimal d'abord, isolé par compte/boutique et rôle. Traiter explicitement changement de compte, téléphone partagé, utilisateur sans compte et absence de stockage. Sans identité fiable, ne pas prétendre reconnaître une personne : parler d'un contexte local. La synchronisation entre appareils est hors du premier essai et doit être chiffrée séparément si proposée.

Utiliser seulement les interactions utiles dans Fii. Ne pas exploiter le contenu des messages privés, les coordonnées, les photos de porte, ni déduire de caractéristiques sensibles. Distinguer l'état nécessaire à l'expérience des mesures facultatives ; conserver les protections existantes des pages reçues et les refus des mesures. Documenter conservation, effacement et toute donnée supplémentaire envisagée.

## 6. Mesure, contrôle et retour arrière

La cible est une tâche utile réussie et répétée, pas davantage de clics, de fonctions consultées ou de temps passé.

Comparer au comportement actuel : réussite, reprise utile, erreurs/abandons et répétition à une occasion ultérieure. Mesurer durée ou nombre d'étapes uniquement si cela est fiable et justifie les données collectées. Les agrégats actuels ne prouvent ni des utilisateurs uniques ni un gain causal.

Claude doit proposer un protocole de pilote adapté aux boutiques effectivement recrutées, ses critères d'arrêt et ses limites. Arrêt immédiat de l'essai si une suggestion viole un droit, masque une tâche nécessaire ou mélange des contextes. Proposer un retour simple au classement déterministe actuel, sans perte de données.

Back-office minimal, si le projet est ensuite validé : voir la version et les règles actives, aperçu sur cas synthétiques, activer/désactiver le pilote, journaliser les réglages, consulter les mesures disponibles sans surestimer leur précision. Ne pas créer une nouvelle plateforme de personnalisation.

## 7. Réponse attendue de Claude

Créer `docs/AVIS-BUILDER-UX-ADAPTATIVE-001.md` avec :

1. Verdict et meilleur argument **contre** cette proposition.
2. Cartographie de ce qui existe déjà et de ce qui manque, avec chemins de code ; toute divergence avec la rétention v2.
3. Règles de sélection proposées, matrice signaux → décisions → succès et pseudocode lisible ; paramètres identifiés comme hypothèses.
4. Cas de contrôle : novice, commerçant récurrent, multi-usage, commande urgente, abandon après clic, panne, refus, changement de compte/boutique, droits restreints, stockage absent, utilisateur qui a épinglé une préférence.
5. Périmètre minimal, coût/effort estimés avec hypothèses, dépendances, protocole d'essai et retour arrière ; une recommandation finale unique.
6. Arbitrages pour le fondateur avant implémentation.

Mettre à jour HANDOFF et le journal dans le même commit documentaire. Signaler l'avis dans le canal du dépôt utilisé par le VP. Préserver les autres travaux de Claude.

## Instruction to Claude

Review this mandate against the current repository before proposing implementation. Give your independent opinion, including objections and a smaller alternative if appropriate. Reuse the existing retention engine and explain any proposed change to previously approved priorities. Write the requested review document and update the handoff. Do not implement, migrate data, enable a provider, or activate adaptive UI under this mandate. Wait for the founder to review your opinion and explicitly authorize implementation.
