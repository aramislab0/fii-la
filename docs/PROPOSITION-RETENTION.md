# Proposition — Rétention par découverte progressive des fonctions

> v1 rédigée par le Builder (Claude), 22/10/2026, à la demande du fondateur (13:34) : « une stratégie de rétention qui va
> proposer ou mettre en avant certaines fonctionnalités inconnues de l'utilisateur, selon ses besoins et ses usages, pour
> faire adopter petit à petit toutes les fonctionnalités ». **Rien n'est construit avant l'avis de ChatGPT (VP) et la
> validation du fondateur.** L'avis du VP s'ajoute en haut de `docs/REVUE-VP.md` ; la v2 intègre ses changements.

## 1. Verdict

Remplacer les suggestions dispersées par **un seul moteur « prochaine étape »** :
- un **catalogue** d'une vingtaine de fonctions, chacune avec qui elle concerne, quand elle devient utile, son bénéfice en une phrase et son bouton ;
- **une seule suggestion à la fois**, au bon moment ;
- un ordre d'adoption par profil (**échelle**) ;
- des **limites de fréquence** ;
- une mesure « vue → touchée → **utilisée** ».

Pour les commerçants, un **parcours visible** (« Votre boutique : 5 étapes sur 9 ») rend la progression concrète.

Ce qui existe déjà et sert de base (FAIT, dans `web/app.js`) :
- les cartes de suggestion `nudge()` :
  - 6 suggestions (boutique, articles, partage du site, livreur, photos, équipe) ;
  - « × » vaut 7 jours de silence, deux « × » valent plus jamais ;
  - au plus 3 suggestions nouvelles ;
- la découverte après une action, `afterTask()` ;
- « Mes activités » et « Découvrir les services » ;
- les badges du démarrage de la boutique ;
- les compteurs anonymes et le back-office Croissance.

Le problème actuel (ANALYSE) :
- chaque suggestion est codée à la main, dans un écran différent ;
- aucune vue d'ensemble de ce que la personne connaît déjà ;
- aucune mesure de l'adoption réelle : on compte « touché », pas « utilisé ensuite » ;
- une bonne moitié des fonctions n'est jamais proposée : repère vocal, événement, acompte, Marketing, réseaux, publication d'un article, QR code, vide-dressing, parrainage, Premium.

## 2. Principes

1. **La tâche d'abord.** Une suggestion n'interrompt jamais une action en cours. Elle arrive après une réussite, sur l'accueil, ou dans l'écran où la fonction sert.
2. **Une seule à la fois.** Une suggestion au plus par écran, et deux au plus par jour.
3. **Selon l'usage réel, pas le profil supposé.** Une fonction n'est proposée que si la précédente de l'échelle est faite et si le contexte la rend utile. Exemple : l'acompte après 3 commandes, pas avant.
4. **Bénéfice concret, jamais de promesse.** « Vos clientes vous trouvent sans appeler », pas « boostez vos ventes ».
5. **Respect du refus.** « × » vaut 7 jours de silence ; deux « × » valent plus jamais pour cette fonction ; « Je connais déjà » la retire. On ne relance jamais une fonction déjà utilisée.
6. **Rien de personnel ne sort du téléphone.**
   - L'état « connu / utilisé » vit sur le téléphone, et dans le compte s'il existe (lot 3).
   - Les mesures restent anonymes et agrégées.

## 3. Les échelles d'adoption (ordre proposé)

### Commerçant (cœur de la rétention)

| # | Fonction | Devient proposée quand | Bénéfice affiché | Où |
|---|---|---|---|---|
| 1 | Premier article | boutique créée, 0 article | « Une photo, un prix : prêt pour vos commandes » | Ma boutique (existe) |
| 2 | Mettre le site en ligne | ≥ 1 article, site hors ligne | « Vos clientes commandent sans vous appeler » | Ma boutique |
| 3 | Partager le site (WhatsApp, statut) | site en ligne, 0 visite sur 7 jours | « Mettez le lien dans votre statut » | Accueil, Marketing |
| 4 | 5 articles avec photo | < 5 articles, 3 jours après la création | « Un site bien rempli rassure » | Articles (existe) |
| 5 | Demander l'adresse d'une cliente | 1re commande sans adresse | « L'adresse exacte, en une photo » | Après la commande |
| 6 | Logo et personnalisation | site en ligne depuis 3 jours, sans logo | « Votre logo à la place de l'initiale » | Réglages, accueil |
| 7 | Réseaux sur le site | logo fait, aucun réseau | « Vos clientes vous suivent en un toucher » | Personnaliser |
| 8 | Plusieurs photos par article | ≥ 3 articles à une seule photo | « Jusqu'à 5 photos qui défilent » | Articles (existe) |
| 9 | Paiement et acompte | ≥ 3 commandes, aucun paiement noté | « Suivez ce qui reste à encaisser » | Commande |
| 10 | Publier un article (Story, statut) | ≥ 1 vente sur un article | « Republiez ce qui se vend » | Marketing |
| 11 | Statistiques Marketing | 7 jours après la mise en ligne | « Vos visites et ventes de la semaine » | Accueil (pastille) |
| 12 | Livreur attitré | ≥ 3 commandes livrées | « Vos courses avec l'adresse exacte » | Après une livraison (existe) |
| 13 | Équipe de la boutique | ≥ 10 commandes, ou boutique tenue depuis 2 téléphones | « Un membre, ses droits » | Réglages (existe) |
| 14 | Fil Fii | site en ligne et place gratuite libre | « Apparaissez dans le fil » | Réglages |
| 15 | Compte | 3 actions réussies sans compte | « Ne perdez rien en changeant de téléphone » | Accueil (existe) |
| 16 | Modèles Premium | logo et 10 articles, site actif depuis 14 jours | « Une mise en page haut de gamme » | Personnaliser |

### Particulier

| # | Fonction | Devient proposée quand | Où |
|---|---|---|---|
| 1 | Créer mon adresse | première visite | Accueil (existe) |
| 2 | Envoyer mon adresse | adresse créée, jamais envoyée | Fiche (existe) |
| 3 | Repère vocal | adresse envoyée 2 fois, sans repère vocal | Fiche |
| 4 | Événement | 2e visite, aucun événement | Accueil |
| 5 | Installer l'app | 2e visite (existe) | Accueil |
| 6 | Demander une adresse | après avoir reçu une demande, ou 3 adresses envoyées | Après une action (existe) |
| 7 | Inviter un proche | 3 actions réussies | Après une action |
| 8 | Vide-dressing | compte créé, 14 jours d'usage | Accueil |
| 9 | Ouvrir une boutique | adresse donnée pour une commande (existe) | Après une action |

### Livreur
Courses reçues → partager son lien à d'autres boutiques → compte.

## 4. Le mécanisme (MVP)

- **Catalogue dans le code**, avec pour chaque fonction :
  - `id`, profil, échelle et rang ;
  - la condition d'éligibilité ;
  - la condition « déjà utilisée » ;
  - les textes et le lien ;
  - les écrans où elle peut apparaître.
- **Choix de la suggestion** : sur un écran donné, la première fonction éligible de l'échelle qui n'est ni utilisée, ni écartée, ni en pause.
- **Données utilisées.**
  - Déjà disponibles :
    - l'activité locale (`fiila.acts`, `fiila.tx`) ;
    - les fiches du téléphone ;
    - les compteurs de la boutique (`fiila_shop_get`, `fiila_shop_stats`) ;
    - l'état du site (logo, réseaux, modèle).
  - Aucune nouvelle donnée personnelle.
- **« Utilisée »** est déduit de l'état réel (le site a un logo, une commande a un acompte) ou du premier usage de l'écran. Ce n'est pas le clic sur la suggestion.
- **Parcours commerçant visible** : sur Ma boutique, une carte repliée affiche « Votre boutique : 5 étapes sur 9 », avec la prochaine étape en un bouton. Les 9 étapes sont les rangs 1 à 9 de l'échelle. La carte disparaît quand tout est fait. Les badges existants se prolongent.
- **Limites** : une suggestion par écran ; 2 par jour ; 7 jours après « × » ; jamais après deux « × » ; jamais pendant un démarrage guidé ou une commande en cours.

## 5. Mesure (pour décider)

- Par fonction, sur 30 jours : vue → touchée → **utilisée dans les 7 jours** (l'adoption).
- Par profil :
  - nombre moyen de fonctions utilisées par personne active ;
  - retour à 7 et à 30 jours des personnes qui ont adopté au moins 3 fonctions, comparé aux autres.
- **Critère d'arrêt** : une suggestion vue 200 fois et utilisée moins de 3 % du temps est réécrite une fois, puis retirée.
- **Back-office** : Croissance → **Adoption**.
  - Voir : catalogue, entonnoir par fonction, fonctions les moins connues.
  - Agir : interrupteur par fonction, et un interrupteur général « suggestions ».
  - Tracer : changements journalisés.
  - Tester : aperçu de la suggestion.

## 6. Découpage

| Lot | Contenu | Effort |
|---|---|---|
| 1 | Moteur + catalogue + échelle commerçant (rangs 1 à 11) + carte « parcours » sur Ma boutique + mesure d'adoption + back-office Adoption. Les 6 suggestions actuelles migrent dans le moteur. | ≈ 1 jour |
| 2 | Échelle particulier et livreur, suggestions après une action reliées au moteur | ≈ ½ jour |
| 3 | État « connu / utilisé » gardé dans le compte (d'un téléphone à l'autre), rangs 12 à 16 | ≈ ½ jour |
| Plus tard | Rappels hors de l'app (WhatsApp ou e-mail) : dépendent de l'envoi par l'API (#51), écarté pour l'instant le 22/10 | — |

## 7. Questions pour le VP (ChatGPT)

1. **L'ordre de l'échelle commerçant.** Faut-il faire passer « Demander l'adresse » (rang 5) avant « Partager le site » (rang 3) ? La demande d'adresse est le cœur historique de Fii.
2. **Le parcours visible** (« 5 étapes sur 9 ») sur Ma boutique : utile ou pression de trop pour une vendeuse débutante ?
3. **Les limites de fréquence** : une par écran et deux par jour, est-ce assez discret ?
4. **Le critère d'arrêt** (200 vues, moins de 3 % d'usage) : adapté au volume du pilote (20 boutiques), ou faut-il un seuil en nombre de boutiques ?
5. **Ce qui manque ou ce qui est en trop** dans le catalogue au stade MVP.

---

## Message à transmettre à ChatGPT (copier-coller)

> Tu es VP produit de Fii (ex-Fii La), avec le Builder (Claude Code). Le fondateur demande une stratégie de rétention
> par découverte progressive des fonctions. Lis la proposition du Builder :
> https://raw.githubusercontent.com/aramislab0/fii-la/main/docs/PROPOSITION-RETENTION.md
> Contexte et décisions en vigueur : https://raw.githubusercontent.com/aramislab0/fii-la/main/docs/HANDOFF.md
> Ne rouvre pas les décisions de HANDOFF §3. Rends un avis au format de `docs/REVUE-VP.md` :
> - un verdict (valider / valider avec changements / refaire) ;
> - au plus 5 changements, classés bloquant / important / plus tard, chacun exécutable sans deviner ;
> - une réponse courte aux 5 questions du §7.
>
> Distingue FAIT / ANALYSE / HYPOTHÈSE. Défends la solution simple (stade pilote, 20 boutiques). Français, registre direct.
