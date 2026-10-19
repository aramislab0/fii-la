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
| Tableau de bord | Indicateurs (boutiques, commandes, volume livré, comptes, adresses, livreurs, ambassadeurs, places du fil), file « À traiter », commandes sur 14 jours |
| Boutiques | Recherche (nom, lien, téléphone), filtres, fiche |
| Commandes | Recherche (boutique, client, numéro, téléphone), filtre par statut, fiche avec articles et paiements, lien vers la facture |
| Comptes | Recherche par nom ou e-mail, fiche (boutique, ambassadeur, rôle, activité) |
| Modération | Commentaires masqués ou signalés : rétablir ou supprimer |
| Vide-dressing | Articles à vérifier, commandes, reversements |
| Ambassadeurs | Validations, gains, versements |
| Fil | Les 25 places gratuites et la liste d'attente |
| Finances | 6 derniers mois, gains d'ambassadeurs à verser et versés, ventes de vide-dressing à reverser |
| Croissance | Origine des arrivées, parrainages |
| Équipe | Membres, rôles, invitations |
| Journal | Toutes les actions de l'équipe (qui, quoi, quand), non modifiables depuis le back-office |
| Réglages | Commission du vide-dressing, gains des 3 niveaux d'ambassadeur, plafond mensuel ; bornes contrôlées |

Actions possibles sur la fiche d'une boutique :
- suspendre, avec un motif obligatoire. La vitrine est fermée, la boutique sort du fil et ne peut pas rouvrir sa vitrine elle-même ;
- réactiver ;
- retirer du fil ou l'y remettre ;
- libérer sa place du fil, qui passe à la boutique en attente la plus ancienne ;
- changer son type de commerce.

Les anciennes adresses `#/stats` et `#/admin/…` ouvrent la section correspondante du back-office.

## Vérification

- Tests SQL : `tests/backoffice.sql.test.mjs` (12 tests) — droits par rôle, invitations, garde-fous d'équipe, suspension, fil, réglages, journal.
- Tests navigateur : `tests/backoffice.test.mjs` (10 tests), sur ordinateur et sur téléphone, en clair et en sombre. Ils sont lancés sur Chrome et Safari à chaque mise en ligne.
- Captures : `docs/screenshots/back-office/`.

## Ensuite (V1)

- Double authentification (code par SMS ou application) pour les rôles Super admin et Finances.
- Sous-domaine dédié (par exemple `admin.fii-la.com`) quand le domaine sera choisi.
- Export CSV des commandes et des finances.
- Blocage d'un compte utilisateur : il demande la clé d'administration de Supabase côté serveur, à prévoir avec les fonctions serveur.
