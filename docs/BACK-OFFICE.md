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
| Boutiques | Recherche (nom, lien, téléphone), filtres, fiche (dont l'équipe de la boutique : membres, rôle, numéro confirmé, invitations en attente ; articles à plusieurs photos, articles hors format 4:5) ; **Abonnement** (22/10 : Gratuit / Premium, sélecteur réservé au droit `shops_write`, journalisé `shop_set_plan`) et modèle de site affiché (avec le choix premium gardé si l'abonnement s'arrête), logo présent ou non ; **Marketing · 30 jours** (22/10) : visites du site, commandes passées par le site, publications, réseaux de la boutique avec liens) |
| Commandes | Recherche (boutique, client, numéro, téléphone), filtre par statut, fiche avec articles et paiements, lien vers la facture |
| Comptes | Recherche par nom ou e-mail, fiche (boutique possédée ou dont il est membre, numéro confirmé par SMS, ambassadeur, rôle, activité) |
| Modération | Commentaires masqués ou signalés : rétablir ou supprimer |
| Vide-dressing | Articles à vérifier (avec leur catégorie ; tout type d'article depuis le 21/10), commandes, reversements |
| Ambassadeurs (21/10, marques invitées) | Programme distinct des Agents : « Inviter une marque » (nom, activité, WhatsApp, durée 1 ou 2 mois ; boutique existante et note repliées), aperçu du message personnalisé et lien privé (montré une fois, partage WhatsApp, copie), liste des invitations et essais (état, pack, échéance), actions : nouveau lien (l'ancien cesse de marcher), retirer (motif), prolonger d'un mois, suspendre (motif), reprendre — prolonger, suspendre et retirer réservés au super admin (droit `partners_admin`), tout au journal ; pack en versions (avantages, non inclus, retouches Studio) : une version utilisée ne change jamais ; un pack avec Studio reste `BLOCKED_DEPENDENCY` tant que le Studio n'est pas prêt (réglage `studio_ready`) |
| Agents (ex-Ambassadeurs, renommés le 21/10) | Rubrique native (20/10) : indicateurs (actifs, à valider, à verser, versés), file « À valider » (valider, refuser), file « À verser » (confirmation avant de marquer versé), liste avec recherche et filtres par état, fiche ambassadeur (profil, test, gains, actions selon l'état : valider, suspendre, réactiver, renvoyer en formation, exclure ; zone sensible « Supprimer le profil », connexion récente exigée, refusée si un versement a déjà été fait), gains en vérification (annulation avec motif), questions manquées du test |
| Manager Carrière (20/10) | Cap du mois (objectifs de commerçants actifs et nouveaux, types et quartiers prioritaires, phrase lue par chaque ambassadeur) fixé par le Head of Stratégie ; propositions du Manager (formation, missions, constats) à accepter ou écarter ; analyse IA à la demande (si activée) ; canal WhatsApp du Manager (numéro, réglé par le Head of Stratégie ; API branchée ou lien direct) ; conversations avec chaque ambassadeur (messages classés et canal application ou WhatsApp, problèmes en tête, bouton WhatsApp vers l'ambassadeur, réponse au nom de l'équipe envoyée aussi sur WhatsApp si la fenêtre de 24 h est ouverte), missions récentes et retours ; catalogue des missions (créer, retirer, taux de réalisation) |
| Fil | Les 25 places gratuites et la liste d'attente |
| Finances | 6 derniers mois, gains d'ambassadeurs à verser et versés, ventes de vide-dressing à reverser |
| Croissance | Parcours d'accueil → **Modèles Premium** (22/10 : par modèle, touché verrouillé, aperçu, « Je veux ce modèle », appliqué ; nombre de boutiques Premium) ; **Ma boutique et Marketing** (22/10, compteurs anonymes sur 30 jours : raccourcis Commandes / Articles / Marketing / Clients touchés depuis l'accueil, écran Marketing ouvert, partage WhatsApp, copie, QR code, réseaux enregistrés, « Publier ») ; Parcours d'accueil (20/10) — avec la découverte après une action (21/10 : par contexte, vue, suivie, « tous les services », masquée) et l'entonnoir du démarrage guidé de la boutique (21/10 : nom et type → premier article → site en ligne → partage touché, « Plus tard », « Reprendre ») : « Découvrir les services » ouvert, chaque service découvert, raccourci touché, retiré de l'accueil, et tâches réussies (adresses, événements, demandes, boutiques, articles, commandes, livreurs) sur 30 jours, compteurs anonymes ; origine des arrivées, parrainages ; **Messages WhatsApp** (21/10, mandat WHATSAPP-001) : registre des 6 modèles du catalogue (message, action, intégration, état Meta — `Non soumis` par défaut, modifiable à la main par le droit `settings`, journalisé ; rien n'est soumis ni envoyé automatiquement), aperçu des cartes envoyées (demande d'adresse, adresse, événement, site, aperçu de lien — 22/10), partages par carte sur 30 jours (image + texte, texte seul, image téléchargée, échecs ; un partage ouvert ne prouve pas l'envoi) ; découverte progressive : chaque suggestion vue, suivie, écartée (30 jours) |
| Équipe | Membres, rôles (dont Head of Stratégie et Développement : cap de Fii La Carrière, propositions du Manager, missions), invitations |
| Journal | Toutes les actions de l'équipe (qui, quoi, quand), non modifiables depuis le back-office |
| Réglages | Nouvel accueil (`onboarding_v2` : 1 = nouvel accueil, 0 = ancien, sans redéploiement), suggestion après une action (`discover_after`), commission du vide-dressing, gains des 3 niveaux d'ambassadeur, plafond mensuel, code SMS obligatoire pour rejoindre une équipe de boutique, Manager avec IA (0/1), suggestions de découverte (0/1), API WhatsApp du Manager (0/1), carte image avec la demande d'adresse (`wa_card_media` : 1 = image + texte, 0 = texte seul), photos servies par le stockage (`media_cdn` : 1 = stockage, 0 = retour aux photos servies par la base) ; en tête de page, **Photos (stockage)** (22/10) : photos copiées et espace utilisé, en attente, dernière copie, échecs des 7 derniers jours, bouton « Copier maintenant » ; bornes contrôlées |

Actions possibles sur la fiche d'une boutique :
- suspendre, avec un motif obligatoire. Le site est mis hors ligne, la boutique sort du fil et ne peut pas rouvrir son site elle-même ;
- réactiver ;
- retirer du fil ou l'y remettre ;
- libérer sa place du fil, qui passe à la boutique en attente la plus ancienne ;
- changer son type de commerce ;
- retirer un membre de l'équipe de la boutique (son accès s'arrête aussitôt ; le nom du membre est gardé au journal).

Les anciennes adresses `#/stats` et `#/admin/…` ouvrent la section correspondante du back-office.

## Présentation (v2, 20/10)

Barre latérale sombre groupée (Pilotage, Opérations, Programmes, Administration), en-tête de page (rubrique, titre, phrase d'état), indicateurs à pastille d'icône, ligne d'indicateurs secondaires, panneau « À traiter » avec compteurs, fiches avec en-tête (pastille, badges, ligne d'informations), recherche avec icône et nombre de résultats.

## Navigation (v3, 20/10)

Barre vitrée en haut (ordinateur) : fil d'Ariane et « Rechercher ». Recherche globale (⌘K, Ctrl+K ou « / ») : rubriques, boutiques, comptes, commandes, ambassadeurs, selon les droits ; flèches et Entrée. Téléphone : onglets du bas (Accueil, Boutiques, Commandes, Chercher) et loupe dans la barre du haut. Listes : squelette de chargement, flèche sur les lignes cliquables.

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
