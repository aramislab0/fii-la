# Back-office Fii La

> 19/10/2026. Demande du fondateur : gérer toute la plateforme en super admin, avec un portail de connexion et des accès uniques pour lui et les équipes à venir.

## Accès

- **Portail** : `https://aramislab0.github.io/fii-la/#/bo` (plus tard sur le domaine Fii La). Sur ordinateur et sur téléphone.
- **Un compte par personne.** Personne ne partage de mot de passe. Le compte du fondateur, déjà administrateur, devient **super admin** à la mise en ligne.
- **Rejoindre l'équipe** : le super admin crée une invitation (e-mail + rôle) dans **Équipe**. Le lien :
  - fonctionne **une seule fois** ;
  - reste valable **7 jours** ;
  - n'est utilisable **qu'avec le compte de cette adresse e-mail** ;
  - n'est jamais gardé en clair dans la base.
- **Retirer quelqu'un** : bouton « Retirer » dans Équipe. Son compte reste, sans accès au back-office.
- **Double authentification obligatoire** pour toute l'équipe (19/10) : à la première connexion, on scanne un QR code avec une application d'authentification (Google Authenticator, Microsoft Authenticator, « Mots de passe » sur iPhone), puis on saisit le code à 6 chiffres à chaque connexion. Sans ce code, la base refuse toute action du back-office (`mfa_required`), même avec le bon mot de passe.
- **Téléphone perdu** : le super admin retire le facteur dans le tableau de bord Supabase (Authentication → Users → le compte → facteurs MFA). Le membre en active un nouveau à sa connexion suivante. Conseil : à l'activation, scanner aussi le QR code sur un second appareil de confiance.
- **Gestes sensibles** (équipe, réglages) : une connexion de moins de 15 minutes est exigée. Sinon, le mot de passe est redemandé.
- **Invitation** : acceptée seulement par un compte dont l'adresse e-mail est celle de l'invitation **et confirmée**.
- **Jamais sans super admin** : la base refuse de retirer, rétrograder ou supprimer le compte du dernier super admin.
- **Consultations journalisées** : ouvrir une commande ou un compte laisse une ligne au journal. Le lien de facture d'un client n'est jamais montré au back-office.

## Rôles

| Rôle | Accès |
|---|---|
| Super admin | Tout, dont l'équipe, les réglages et le journal |
| Opérations | Boutiques (lecture et actions), commandes, comptes, fil, modération, vide-dressing, ambassadeurs, finances |
| Modération | Commentaires, vérification du vide-dressing (sans téléphones), suspension et réactivation des boutiques |
| Support | Lecture des boutiques, commandes et comptes |
| Finances | Commandes, finances, versements des ambassadeurs, « livré » et « reversé » du vide-dressing |

C'est la base qui vérifie chaque droit (`fiila.staff_can`). L'interface ne fait que masquer ce qui n'est pas permis.

## Sections

| Section | Contenu |
|---|---|
| Tableau de bord | Indicateurs (boutiques, commandes, volume livré, comptes, adresses, livreurs, ambassadeurs, places du fil, membres d'équipe de boutiques et numéros confirmés par SMS, articles à plusieurs photos et photos principales hors format 4:5), file « À traiter », commandes sur 14 jours |
| Boutiques | Recherche (nom, lien, téléphone), filtres, fiche (dont l'équipe de la boutique : membres, rôle, numéro confirmé, invitations en attente ; articles à plusieurs photos, articles hors format 4:5) |
| Commandes | Recherche (boutique, client, numéro, téléphone), filtre par statut, fiche avec articles et paiements, lien vers la facture |
| Comptes | Recherche par nom ou e-mail, fiche (boutique possédée ou dont il est membre, numéro confirmé par SMS, ambassadeur, rôle, activité) |
| Modération | Commentaires masqués ou signalés : rétablir ou supprimer |
| Vide-dressing | Articles à vérifier, commandes, reversements |
| Ambassadeurs | Validations, gains, versements |
| Fil | Les 25 places gratuites et la liste d'attente |
| Finances | 6 derniers mois, gains d'ambassadeurs à verser et versés, ventes de vide-dressing à reverser |
| Croissance | Origine des arrivées, parrainages |
| Équipe | Membres, rôles, invitations |
| Journal | Toutes les actions de l'équipe (qui, quoi, quand), non modifiables depuis le back-office |
| Réglages | Commission du vide-dressing, gains des 3 niveaux d'ambassadeur, plafond mensuel, code SMS obligatoire pour rejoindre une équipe de boutique ; bornes contrôlées |

Actions possibles sur la fiche d'une boutique :
- suspendre, avec un motif obligatoire. La vitrine est fermée, la boutique sort du fil et ne peut pas rouvrir sa vitrine elle-même ;
- réactiver ;
- retirer du fil ou l'y remettre ;
- libérer sa place du fil, qui passe à la boutique en attente la plus ancienne ;
- changer son type de commerce ;
- retirer un membre de l'équipe de la boutique (son accès s'arrête aussitôt ; le nom du membre est gardé au journal).

Les anciennes adresses `#/stats` et `#/admin/…` ouvrent la section correspondante du back-office.

## Règle : chaque nouvelle fonction arrive avec son back-office

Décision du fondateur (20/10/2026) : toute fonction livrée dans l'application est, dans la même livraison, visible et pilotable dans le back-office.
Avant de livrer, vérifier :
1. **Voir** : les nouvelles données apparaissent sur la bonne fiche (boutique, compte, commande) et, si utile, dans un indicateur du tableau de bord ;
2. **Agir** : l'équipe peut corriger ou arrêter ce qui pose problème (retirer, suspendre, masquer), avec le bon droit ;
3. **Tracer** : chaque action de l'équipe est au journal, avec un libellé lisible ;
4. **Régler** : un paramètre qui peut changer (montant, seuil, interrupteur) est dans Réglages, avec des bornes ;
5. **Tester** : un test SQL et un test navigateur couvrent la partie back-office ; ce document est à jour.

## Vérification

- Tests SQL : `tests/backoffice.sql.test.mjs` (12 tests) — droits par rôle, invitations, garde-fous d'équipe, suspension, fil, réglages, journal.
- Tests navigateur : `tests/backoffice.test.mjs` (10 tests), sur ordinateur et sur téléphone, en clair et en sombre. Ils sont lancés sur Chrome et Safari à chaque mise en ligne.
- Captures : `docs/screenshots/back-office/`.

## Ensuite (V1)

- Sous-domaine dédié (par exemple `admin.fii-la.com`) quand le domaine sera choisi.
- Export CSV des commandes et des finances.
- Blocage d'un compte utilisateur : il demande la clé d'administration de Supabase côté serveur, à prévoir avec les fonctions serveur.
