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

- **Code chargé à part** (27/10, HANDOFF #75) : le back-office est dans `web/bo.js`, téléchargé seulement à l'ouverture de `#/bo` ; la page reçue par les clientes ne le contient plus. Un outil de `app.js` utilisé dans `bo.js` doit être ajouté à `boShared()` (app.js) et à la ligne `var … = F.…` (bo.js) : `tests/bosplit.sql.test.mjs` le vérifie.

- **Audit du 27/10 (28/10)** : toutes les fonctions du back-office sont fermées aux visiteurs non connectés, sauf le portail (`fiila_bo_me`) et l'ouverture d'une invitation ; `verify-db` le contrôle à chaque mise en ligne. Tableau de bord : ligne **Santé** (`#bo-health`, 7 jours : erreurs de l'application par écran, copies de photos et séries Studio en échec). Fiche commande : **Historique** (`#bo-order-events` : changements d'état, paiements ajoutés ou supprimés, par la boutique ou un compte). Crédits Studio : un retrait plus grand que le solde est refusé. Pièce d'identité : images effacées dès la décision (« Voir la pièce » disparaît ensuite). Tests : `auditlot1.sql`, `backoffice`.

## Rôles

| Rôle | Accès |
|---|---|
| Head of Stratégie (`strategy`) | Fii Carrière : cap du mois, propositions du Manager, missions |
| Super admin | Tout, dont l'équipe, les réglages et le journal |
| Opérations | Boutiques (lecture et actions), commandes, comptes, fil, modération, vide-dressing, ambassadeurs, finances |
| Modération | Commentaires, vérification du vide-dressing (sans téléphones), suspension et réactivation des boutiques |
| Support | Lecture des boutiques, commandes et comptes |
| Finances | Commandes, finances, versements des ambassadeurs, « livré » et « reversé » du vide-dressing |

C'est la base qui vérifie chaque droit (`fiila.staff_can`). L'interface ne fait que masquer ce qui n'est pas permis.

## Sections

| Section | Contenu |
|---|---|
| Studio (section, 26/10) | Fii Studio : ouvert ou fermé (`studio_ready`), dépense du mois face au budget (`studio_budget_usd`), séries, versions gardées, échecs, boutiques ; crédits des boutiques ; « Accorder des crédits » (recherche de la boutique, nombre positif ou négatif, motif obligatoire, journal `studio_grant`) ; dernières séries (décor, statut, coût, erreur). Réglage `studio_daily`. **27/10 : « Décors par catégorie »** (section repliée) : décors de chaque pack, versions gardées / séries par décor, couper ou activer un décor (motif obligatoire, journal `studio_scene`). **27/10 : modes** — dernières séries « · premium » ; réglages `studio_premium` (0/1) et `studio_premium_credits` (1–10). Tests : `studio.sql` (14), `studiofn` (8), `studio` (4), `backoffice` |
| Domaines (section, 24/10) | Domaines propres des boutiques Premium : nom, boutique (gratuite signalée), statut (en attente, vérification, actif, erreur, expiré, déconnecté), certificat, dernière erreur de Cloudflare, date. « Revérifier » (relit Cloudflare) ; « Déconnecter » avec motif obligatoire (droit `shops_write`, journal `domain_disconnect`, nom retiré chez Cloudflare). Interrupteurs `custom_domains` et `shop_subdomains` (adresses `<lien>.fii.shop`) dans Réglages. Test : `backoffice` (16 sections), `domains.sql` |
| Tableau de bord | Indicateurs (boutiques, commandes, volume livré, comptes, adresses, livreurs, ambassadeurs, places du fil, membres d'équipe de boutiques et numéros confirmés par SMS, articles à plusieurs photos et photos principales hors format 4:5), file « À traiter », commandes sur 14 jours |
| Boutiques | Recherche (nom, lien, téléphone), filtres, fiche (dont l'équipe de la boutique : membres, rôle, numéro confirmé, invitations en attente ; articles à plusieurs photos, articles hors format 4:5) ; **Abonnement** (22/10 : Gratuit / Premium, sélecteur réservé au droit `shops_write`, journalisé `shop_set_plan`) et modèle de site affiché (avec le choix premium gardé si l'abonnement s'arrête), logo présent ou non ; **Marketing · 30 jours** (22/10) : visites du site, commandes passées par le site, publications, réseaux de la boutique avec liens) |
| Identités (27/10) | Pièce d'identité du propriétaire, exigée après la première vente : file « À vérifier » (boutique, propriétaire, téléphone, type de pièce, date), file « Bloquées faute de pièce » (non envoyée ou refusée). Sur la fiche boutique, carte « Propriétaire et identité » : nom et numéro du propriétaire, état de la pièce, « Voir la pièce » (chaque consultation est journalisée `kyc_view`), « Valider » ou « Refuser » avec motif obligatoire (motif montré à la boutique, images effacées, commandes rebloquées). Réglage `kyc_required` (0/1). Droit : `shops_write`. Tableau de bord : file « Pièces d'identité à vérifier » |
| Commandes | Recherche (boutique, client, numéro, téléphone), filtre par statut, fiche avec articles et paiements, lien vers la facture |
| Comptes | Recherche par nom ou e-mail, fiche (boutique possédée ou dont il est membre, numéro confirmé par SMS, ambassadeur, rôle, activité) |
| Modération | Commentaires masqués ou signalés : rétablir ou supprimer |
| Vide-dressing | Articles à vérifier (avec leur catégorie ; tout type d'article depuis le 21/10), commandes, reversements |
| Ambassadeurs (21/10, marques invitées) | Programme distinct des Agents : « Inviter une marque » (nom, activité, WhatsApp, durée 1 ou 2 mois ; boutique existante et note repliées), aperçu du message personnalisé et lien privé (montré une fois, partage WhatsApp, copie), liste des invitations et essais (état, pack, échéance), actions : nouveau lien (l'ancien cesse de marcher), retirer (motif), prolonger d'un mois, suspendre (motif), reprendre — prolonger, suspendre et retirer réservés au super admin (droit `partners_admin`), tout au journal ; pack en versions (avantages, non inclus, retouches Studio) : une version utilisée ne change jamais ; un pack avec Studio reste `BLOCKED_DEPENDENCY` tant que le Studio n'est pas prêt (réglage `studio_ready`) |
| Agents (ex-Ambassadeurs, renommés le 21/10) | Rubrique native (20/10) : indicateurs (actifs, à valider, à verser, versés), file « À valider » (valider, refuser), file « À verser » (confirmation avant de marquer versé), liste avec recherche et filtres par état, fiche ambassadeur (profil, test, gains, actions selon l'état : valider, suspendre, réactiver, renvoyer en formation, exclure ; zone sensible « Supprimer le profil », connexion récente exigée, refusée si un versement a déjà été fait), gains en vérification (annulation avec motif), questions manquées du test **23/10 (contrôles avant versement, algorithmes v2.1 / A3)** : « J'ai versé » indisponible tant que le numéro de versement n'est pas confirmé par code SMS (#34, contrôlé aussi par le serveur) ; badge « confirmé par SMS / non confirmé » dans la fiche ; motif obligatoire pour suspendre, exclure, réintégrer ; « Réintégrer » un exclu (il repasse « suspendu ») ; section **Historique** de l'agent (décisions et gains, avec ancien statut et motif) et **gains annulés à rétablir un par un** avec motif. |
| Manager Carrière (20/10) | Cap du mois (objectifs de commerçants actifs et nouveaux, types et quartiers prioritaires, phrase lue par chaque ambassadeur) fixé par le Head of Stratégie ; propositions du Manager (formation, missions, constats) à accepter ou écarter ; analyse IA à la demande (si activée) ; canal WhatsApp du Manager (numéro, réglé par le Head of Stratégie ; API branchée ou lien direct) ; conversations avec chaque ambassadeur (messages classés et canal application ou WhatsApp, problèmes en tête, bouton WhatsApp vers l'ambassadeur, réponse au nom de l'équipe envoyée aussi sur WhatsApp si la fenêtre de 24 h est ouverte), missions récentes et retours ; catalogue des missions (créer, retirer, taux de réalisation) |
| Fil | Les 25 places gratuites et la liste d'attente |
| Finances | 6 derniers mois, gains d'ambassadeurs à verser et versés, ventes de vide-dressing à reverser |
| Croissance | Parcours d'accueil → **Accueil adaptatif** (22/10, UX-ADAPTATIVE-001) : état et version des paramètres (`adaptive_v1`), par service bouton principal vu / touché / tâche réussie ensuite, « Mettre en premier » / retour automatique / remises à zéro, reprises en haut de Ma boutique (vue, reprise, enregistrée), aperçu sur 5 cas fictifs ; **Suggestions** (rétention lot 1, 22/10) : par suggestion, vues (exposition visible), clics, refus, succès sous 7 jours (état réel), répétitions, sur 30 jours, en installations observées ; fenêtre incomplète des 7 derniers jours ; commandes sans adresse (carte vue, adresse redemandée, adresses reçues pour des commandes sur 30 jours, commandes ouvertes en attente) ; interrupteur par suggestion (droit `settings`, journalisé) ; aperçu des cartes ; ancienne mesure repliée. Parcours d'accueil → **Modèles Premium** (22/10 : par modèle, touché verrouillé, aperçu, « Je veux ce modèle », appliqué ; nombre de boutiques Premium) ; **Ma boutique et Marketing** (22/10, compteurs anonymes sur 30 jours : raccourcis Commandes / Articles / Marketing / Clients touchés depuis l'accueil, écran Marketing ouvert, partage WhatsApp, copie, QR code, réseaux enregistrés, « Publier ») ; Parcours d'accueil (20/10) — avec la découverte après une action (21/10 : par contexte, vue, suivie, « tous les services », masquée) et l'entonnoir du démarrage guidé de la boutique (21/10 : nom et type → premier article → site en ligne → partage touché, « Plus tard », « Reprendre ») : « Découvrir les services » ouvert, chaque service découvert, raccourci touché, retiré de l'accueil, et tâches réussies (adresses, événements, demandes, boutiques, articles, commandes, livreurs) sur 30 jours, compteurs anonymes ; origine des arrivées, parrainages ; **Messages WhatsApp** (21/10, mandat WHATSAPP-001) : registre des 6 modèles du catalogue (message, action, intégration, état Meta — `Non soumis` par défaut, modifiable à la main par le droit `settings`, journalisé ; rien n'est soumis ni envoyé automatiquement), aperçu des cartes envoyées (demande d'adresse, adresse, événement, site, aperçu de lien — 22/10), partages par carte sur 30 jours (image + texte, texte seul, image téléchargée, échecs ; un partage ouvert ne prouve pas l'envoi) ; découverte progressive : chaque suggestion vue, suivie, écartée (30 jours) **23/10** : panneau Suggestions + 2 lignes « Mon adresse → photo de l'entrée » et « Mon adresse → repère écrit ou vocal » (A1 réduit), chacune avec son interrupteur (`sugg_addr_photo`, `sugg_addr_mark`). **23/10, Marketing v2** : ligne « Publier un article » (feuille ouverte, Publication, Story ou statut, partage envoyé, image à enregistrer), `#bo-publish-line`. **26/10, App mobile** : ligne `#bo-app-line`, ouvertures de l'app Android et iPhone sur 30 jours (anonymes). **23/10, Publier v3** : la ligne `#bo-publish-line` compte les touchers par réseau (Instagram, Facebook, WhatsApp, TikTok, Snapchat), les partages envoyés et les images enregistrées. |
| Équipe | Membres, rôles (dont Head of Stratégie et Développement : cap de Fii La Carrière, propositions du Manager, missions), invitations |
| Journal | Toutes les actions de l'équipe (qui, quoi, quand), non modifiables depuis le back-office |
| Réglages | Nouvel accueil (`onboarding_v2` : 1 = nouvel accueil, 0 = ancien, sans redéploiement), suggestion après une action (`discover_after`), commission du vide-dressing, gains des 3 niveaux d'ambassadeur, plafond mensuel, code SMS obligatoire pour rejoindre une équipe de boutique, Manager avec IA (0/1), suggestions de découverte (0/1), API WhatsApp du Manager (0/1), carte image avec la demande d'adresse (`wa_card_media` : 1 = image + texte, 0 = texte seul), photos servies par le stockage (`media_cdn` : 1 = stockage, 0 = retour aux photos servies par la base), accueil adaptatif (`adaptive_home` : 1 = appris des réussites, 0 = règle d'avant), suggestions une par une (`sugg_home_shop`, `sugg_shop_more_products`, `sugg_shop_share_vitrine`, `sugg_shop_courier`, `sugg_shop_photos`, `sugg_shop_team` : 1 = active, 0 = coupée) ; en tête de page, **Photos (stockage)** (22/10) : photos copiées et espace utilisé, en attente, dernière copie, échecs des 7 derniers jours, bouton « Copier maintenant » ; miniatures des grilles (28/10) : faites, poids, à faire (`media_cdn` = 0 les coupe aussi) ; copies retirées de la base (28/10, étape 3) : nombre, poids restant dans la base, arrêt par `media_purge` = 0 (`media_cdn` = 0 ne ramène plus une photo déjà retirée) ; bornes contrôlées |

Fiche d'une boutique, carte **Audience** (Fii Édition, 27/10) : abonnés (« Suivre ») et favoris (cœur), au total et sur 30 jours, et les 3 articles les plus mis en favori. Droit : `shops`.

Croissance → ligne **Réglages et Studio v2** (`#bo-settings-line`, 27/10, 30 jours, anonyme) : bouton « Compléter » de la carte « presque prête » par étape (site, article, logo, couverture, livraison, propriétaire), tuiles touchées, « Partager mon site » ; Studio : mode Fidèle / Premium choisi, comparaison avant / après utilisée, « Publier sur mes réseaux » après « Bravo », « Terminé ». Les séries, crédits et versions gardées restent dans la section Studio. Tests : `settingsv2.sql`, `backoffice`.

Fiche d'une boutique, carte **Fiche article** (Fii Édition V1, 27/10) : livraison, paiement et échange choisis par la boutique (« Non indiqué » sinon), nombre d'articles en promo (prix barré) et d'articles avec des tailles épuisées. Droit : `shops`. Croissance → ligne **Sites des boutiques** (`#bo-site-line`, 30 jours, anonyme) : fiche article ouverte, ajout depuis la fiche, guide des tailles, « Complétez le look » touché, rubriques touchées. Réglages → `site_look` : nombre d'articles de « Complétez le look » (0 = masqué, 6 au plus, 3 par défaut), journalisé. Tests : `editionv1.sql`, `backoffice`.

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
