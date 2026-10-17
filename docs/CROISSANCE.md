# Fii La : stratégie de croissance organique et parrainage

> Statut : proposition du 17/10/2026. **Décisions du fondateur (17/10 23:10)** : cible = tout le Sénégal, boutiques et commerçants, particuliers (qui commandent et envoient) et leurs livreurs ; phase 0 validée et construite (voir §9) ; récompenses fixées plus tard par le fondateur, l'argent n'est pas exclu.
> Document interne.

## 1. Verdict

La croissance de Fii La viendra d'abord du produit lui-même, pas du parrainage.

Chaque usage envoie un lien à quelqu'un qui ne connaît pas encore Fii La :
- la boutique envoie une demande d'adresse à sa cliente ;
- la cliente envoie son adresse au livreur ;
- l'organisateur envoie son rendez-vous à 50 invités.

Ces personnes découvrent le service en s'en servant. C'est le moteur principal.

Le parrainage amplifie ce moteur. Il ne le remplace pas. Une récompense sur un produit peu utilisé ne crée pas de bouche-à-oreille ; sur un produit utilisé chaque jour, elle l'accélère.

Il faut donc trois choses, dans cet ordre :
1. **Mesurer d'où vient chaque nouvel utilisateur.** Tout lien Fii La porte son origine.
2. **Rendre chaque page reçue contagieuse**, sans gêner celui qui la reçoit.
3. **Un parrainage par numéro**, simple, récompensé seulement quand le filleul utilise vraiment le service.

## 2. Cible de départ

Ne pas viser « tout le Sénégal ». Viser un groupe dense où tout le monde se connaît :
- **Vendeuses en ligne de Dakar** qui vendent sur WhatsApp, Instagram et TikTok (mode, cosmétiques, thiouraye, plats, wax).
- **Leurs livreurs**, à moto.

**Pourquoi ce groupe**
- La douleur est quotidienne : « envoie ta localisation », le livreur qui appelle cinq fois, le colis qui revient.
- Une vendeuse a des centaines de clientes. Chacune reçoit une demande, crée son adresse une fois, puis la réutilise avec d'autres boutiques (« Adresse déjà connue »). C'est l'effet réseau.
- **Le livreur est le meilleur canal.** Il travaille pour 5 à 10 boutiques et gagne du temps quand l'adresse est claire. C'est lui qui dira aux autres vendeuses : « envoie-moi ça en Fii La ».

**Zone pilote proposée :** Almadies, Ngor, Yoff, Ouakam, Mermoz. La zone est dense en vendeuses en ligne et les adresses y sont difficiles.

## 3. Les quatre boucles

| Boucle | Qui envoie | Qui découvre | Ce qu'il faut sur la page reçue |
|---|---|---|---|
| Demande d'adresse | Boutique | Cliente | Après envoi : « Votre adresse est prête, partagez-la à vos proches » (existe) |
| Facture et suivi | Boutique | Cliente | Après livraison : « Vous vendez aussi sur WhatsApp ? » (existe) |
| Course | Boutique | Livreur | « Recevez vos courses de toutes vos boutiques ici » + parrainage livreur |
| Rendez-vous | Organisateur | Invités | Après l'arrivée : « Créer votre rendez-vous » (existe) |
| Publication d'article (à venir, ARCHITECTURE §8) | Boutique | Abonnés de la boutique | Lien de commande qui crée la demande d'adresse |

**Règle :** l'appel à rejoindre arrive toujours **après** le service rendu (adresse envoyée, colis livré, arrivée au rendez-vous), jamais avant. La personne qui reçoit un lien ne doit rien avoir à faire d'autre que ce pour quoi elle l'a reçu.

## 4. Parrainage par numéro

### Principe
- Chaque boutique, livreur ou utilisateur a un **lien de parrainage** et un **code court** (6 caractères, par exemple `K7M2QD`).
- Le code ne contient jamais le numéro de téléphone : un lien qui circule ne doit pas révéler un numéro.
- **À la création** d'une boutique ou d'un profil livreur, une question facultative : « Qui vous a parlé de Fii La ? ». On y tape le **numéro** ou le code de la personne. C'est le « parrainage par numéro » : le bouche-à-oreille oral, sans lien, est quand même compté.
- **Sans rien taper**, l'origine est déjà connue : si la personne est arrivée par un lien d'une boutique (demande, facture) ou d'un livreur, cette boutique ou ce livreur devient son parrain. C'est la première origine qui compte.
- Le parrain voit dans son espace : « 3 boutiques ont rejoint grâce à vous, 2 actives ». L'accès passe par sa clé de boutique ou son compte, jamais par son numéro : sans code SMS, n'importe qui pourrait taper le numéro d'un autre.

### Récompenses sans budget

| Parrain | Récompense | Déclencheur (anti-fraude) |
|---|---|---|
| Boutique | 1 mois offert de la future offre Pro par boutique filleule active, à faire valoir quand l'abonnement existera ; badge « Boutique fondatrice » pour les 100 premières | Filleule ayant eu au moins 3 commandes de 3 clientes différentes, dont 1 livrée |
| Livreur | Il devient livreur attitré proposé à la boutique qu'il amène, donc plus de courses ; visibilité future dans l'annuaire des livreurs | Boutique filleule active (même règle) |
| Cliente ou particulier | Aucune au départ : son intérêt est l'utilité. Compteur « 5 proches ont votre adresse » | — |

**Pas d'argent ni de crédit de communication** pour l'instant. Avec des numéros non vérifiés, une récompense en argent attire les faux comptes. Elle coûte de l'argent avant d'avoir prouvé quoi que ce soit.

**À confirmer :** promettre des « mois offerts » engage la future offre Pro. Il faut une formule prudente (« mois offerts dès le lancement de l'offre Pro »), validée par le fondateur avant toute communication externe.

### Garde-fous
- On ne peut pas se parrainer soi-même : même numéro, même clé, ou cliente au numéro de la boutique.
- Un filleul n'a qu'un seul parrain, et ce parrain ne change plus.
- Les récompenses sont plafonnées par parrain et par mois, avec contrôle manuel au début.
- Données : un parrainage relie deux personnes. Il faut l'ajouter au dossier CDP (action fondateur, comme pour les comptes et les livreurs).

## 5. Ce qu'il faut construire

**Phase 0 (avant le pilote, 2 à 3 jours de travail)**
1. Origine sur chaque création : colonnes `source` (lien de demande, facture, rendez-vous, parrainage, publication, direct) et `referrer` sur les boutiques, livreurs, fiches et profils. Paramètre `?r=` sur tous les liens sortants, gardé au premier contact.
2. Codes de parrainage : table `referral_codes` et table `referrals` (parrain, filleul, origine, date, statut actif).
3. Écran « Parrainer » dans Ma boutique et dans l'espace livreur : lien, code, message WhatsApp prêt à envoyer, compteur.
4. Question facultative « Qui vous a parlé de Fii La ? » (numéro ou code) à la création de la boutique et du livreur.
5. Bouton « Publier » sur un article (partage natif, ARCHITECTURE §8 brique 1). C'est gratuit, et chaque publication devient une boucle d'acquisition.
6. Tableau interne fondateur : nouveaux utilisateurs par origine et par semaine, parrains principaux, taux d'activation. Lecture seule, chiffres agrégés.

**Phase 1 (pilote, 30 jours)**
- Choisir à la main 20 boutiques fondatrices dans le réseau d'Aramis et les installer en personne (2 minutes par boutique, sans compte).
- Inscrire leurs livreurs comme attitrés.
- Créer un groupe WhatsApp « Boutiques fondatrices » pour les retours, avec un message par semaine.
- Une personne de l'équipe pilote le groupe et les relances. **Pas le fondateur.**

**Phase 2 (après preuve)**
- Récompenses branchées sur l'offre Pro.
- Classement des livreurs.
- Vitrine publique.
- Publication directe sur les réseaux.

**Phase 3**
- Publicité payante, seulement sur les boucles qui convertissent déjà.

## 6. Communication sans budget

- **Pages Instagram, TikTok et Facebook**, avec un format répété : vidéo de 15 secondes « avant / après ». Avant : le vocal « je suis à côté de la boutique bleue, après le deuxième ralentisseur… ». Après : la carte Fii La, avec la photo de l'entrée et le livreur qui arrive du premier coup. C'est le savoir-faire d'Aramis Studio.
- **Kit pour les boutiques :** un visuel de statut WhatsApp « Pour vos livraisons, envoyez votre entrée en une photo » et une phrase pour leur bio. Elles en ont besoin pour dire à leurs clientes ce qu'est le lien reçu.
- **Vrais témoignages uniquement**, avec accord écrit de la boutique. Jamais de faux avis ni de chiffres inventés.
- **La marque sur les pages reçues reste discrète** : le nom Fii La et un seul lien, rien de plus.

## 7. Mesure et critères d'arrêt

**Indicateur principal :** livraisons faites avec une adresse Fii La, par semaine.

| Mesure au jour 30 du pilote | Seuil pour continuer |
|---|---|
| Boutiques fondatrices encore actives (au moins 1 demande par semaine) | 12 sur 20 |
| Clientes qui complètent l'adresse après avoir ouvert la demande | 60 % |
| Clientes qui réutilisent leur adresse avec une 2e boutique | à mesurer, référence pour la suite |
| Nouvelles boutiques arrivées sans démarchage (parrainage ou lien) | au moins 10 |
| Livreurs qui ont amené au moins une boutique | au moins 3 |

**Si le seuil d'activité n'est pas atteint**, le problème est le produit ou la cible, pas le marketing. On corrige avant d'ajouter des récompenses ou de la publicité.

## 8. Décisions demandées au fondateur
1. Cible et zone du pilote : vendeuses en ligne et leurs livreurs, Almadies-Yoff-Ouakam-Mermoz ?
2. Récompenses : mois offerts de la future offre Pro pour les boutiques, plus de courses pour les livreurs, rien en argent ?
3. Qui pilote les 20 boutiques fondatrices ?
4. Feu vert pour la phase 0, y compris le bouton « Publier » ?

## 9. Phase 0 construite (17/10/2026)

- **Origine de chaque arrivée** (boutique, livreur, adresse, rendez-vous) : lien de parrainage, code tapé, numéro tapé, ou lien reçu (demande, facture, adresse, rendez-vous, course, suivi, invitation de livreur), sinon « direct ». Première origine gardée 30 jours sur le téléphone ; un lien de parrainage la remplace.
- **Parrainage par numéro** : à la création d'une boutique, d'un espace livreur ou d'une adresse, « Quelqu'un vous a recommandé Fii La ? » (replié, facultatif) accepte un numéro ou un code. Un numéro pas encore inscrit est gardé et rattaché dès que la personne crée son code ou ouvre une boutique ou un espace livreur avec ce numéro.
- **Espace « Parrainer »** : boutique, livreur et particulier (« Inviter un proche », avec ou sans compte). Code de 6 caractères, lien `#/r/CODE`, message WhatsApp prêt, compteur des arrivées et des arrivées actives, dernières arrivées.
- **Bandeau d'invitation** sur l'accueil quand on arrive par un lien de parrainage (prénom ou nom de la boutique seulement).
- **Bouton « Publier »** sur chaque article : feuille de partage du téléphone avec la photo et la légende (prix, lien WhatsApp de commande), légende copiée ; repli ordinateur : enregistrer la photo, copier la légende. Nombre de publications compté.
- **Statistiques fondateur** `#/stats` : totaux, origines sur 30 jours, arrivées par semaine, meilleurs parrains. Réservées à un compte marqué administrateur par SQL.
- **Garde-fous** : pas de parrainage de soi-même (même boutique, livreur, compte ou numéro), une seule origine par arrivée, enregistrée dans l'heure qui suit la création, réponse neutre (on ne dit jamais si un numéro est inscrit), aucun numéro affiché, suppression du code par son titulaire.
- **Récompenses** : rien n'est attribué. Le comptage « actif » est prêt pour les règles que fixera le fondateur. **Point d'attention si l'argent est retenu** : sans vérification du numéro par SMS, prévoir un contrôle manuel avant chaque paiement et un plafond.
