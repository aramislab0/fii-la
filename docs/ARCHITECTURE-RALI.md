# Fii La + Rali : périmètre, architecture et phases

> Version du 17/10/2026, 21:15, après la consigne du fondateur. Remplace la version de 21:00.
> Ce qui est **construit** est marqué ✅. Ce qui est **prévu dans l'architecture, sans code** est marqué ◻︎.

## 1. Règles produit (fondateur, 17/10)

1. **Personne n'est bloqué par un compte.**
   - Toute personne qui reçoit un lien l'ouvre et fait sa transaction : voir une adresse, donner la sienne, suivre un livreur, voir sa facture, noter un article.
   - Tout le monde peut aussi créer une adresse, un rendez-vous, une demande ou **une boutique** sans compte.
2. **Le compte est proposé, jamais imposé**, à trois moments :
   - à la création de la boutique : carte « Votre boutique est sur ce téléphone », avec « Plus tard » ;
   - après 3 actions sur le téléphone : carte « Ne perdez rien », avec « Plus tard » (revient après 14 jours) ;
   - par un lien discret en bas de page, « Se connecter », pour retrouver ses données sur un autre téléphone.
3. **Ouverture des fonctions une à une**, avec un interrupteur par fonction (`window.FIILA_CONFIG`).
   - Exemple : `shop: false` masque la boutique.

## 2. Phases

| Phase | Contenu | État |
|---|---|---|
| **V1 — lancement** | Adresse (entrée, photo, repère, arrêt voiture), rendez-vous, demande d'adresse, partage WhatsApp / Facebook / Telegram / Instagram / TikTok, suivi du livreur, invités d'un rendez-vous | ✅ en production |
| **V1 — lancement (Rali inclus)** | Boutique sans compte, articles avec photo et prix, commande en un geste depuis le catalogue, facture partageable, demande d'adresse liée, livraison suivie depuis la facture, paiements enregistrés à la main, clients, notes des acheteurs | ✅ construit ce soir |
| V1 — option | Compte : profil, photo, mot de passe, carnet d'adresses étiqueté (maison, bureau, boutique), boutique sur tous ses téléphones | ✅ |
| **V2 — livreurs (livreur attitré)** | Invitation du livreur par WhatsApp, espace livreur sans compte, courses automatiques dès que l'adresse est reçue, « Livrée » par le livreur, notes de la livraison, disponible/indisponible | ✅ construit (17/10, 21:45) |
| V2 — livreurs (inscription publique) | Annuaire de livreurs, choix par zone, vérification | ◻︎ §4 |
| **V2 — paiement** | Wave / Orange Money sur la facture | ◻︎ §5 (modèle prêt) |
| **V3 — vitrine et marketplace** | Vitrine publique de chaque boutique, fil des produits, recherche, marketplace Sénégal | ◻︎ §6 |

## 3. Architecture en place

**Propriété.** Chaque objet se gère par **une clé gardée sur le téléphone** (fiche, demande, boutique), **ou** par le compte connecté.
- Le compte est une couche de récupération, pas une porte d'entrée.
- Fonctions communes : `fiila.owned_place`, `fiila.owned_request`, `fiila.my_shop(p_key)`.

**Tables (schéma privé `fiila`)**

| Table | Rôle |
|---|---|
| `places`, `requests`, `trackers` | Adresses et rendez-vous, demandes d'adresse, suivi en direct (existants) |
| `profiles` | Nom, téléphone, photo du compte |
| `shops` | Boutique, avec `owner_hash` (clé du téléphone) et/ou `user_id` (compte) |
| `products` | Articles : nom, prix FCFA, description, photo, visible ou masqué |
| `customers` | Fichier clients de la boutique. Même numéro = même client. Dernière adresse reçue |
| `orders` | Commandes numérotées, lignes (avec `product_id` si l'article vient du catalogue), total calculé par le serveur, lien de facture |
| `payments` | Paiements. Aujourd'hui `source = manual` ; demain `source = provider` |
| `reviews` | Notes 1 à 5 par article. Seulement l'acheteur, depuis sa facture, une fois la commande livrée. Une par article et par commande |

**Sécurité**
- Aucun accès direct aux tables. Uniquement des fonctions `security definer` avec `search_path` vide.
- Tout lien partagé porte un jeton de 128 bits.
- La facture publique n'expose ni le téléphone du client ni d'identifiant interne.

## 4. V2 — livreurs

**Construit (décision du fondateur, 17/10 21:25) : livreur attitré d'abord.**
- `couriers` (clé du téléphone, nom, téléphone, moyen, zone, disponible), `courier_invites` (lien à usage unique, 7 jours, envoyé sur le WhatsApp du livreur), `courier_reviews` (note de la livraison par le client), `shops.courier_id` et `courier_auto`, `trackers.courier_id / order_id / courier_send`.
- Sécurité : un numéro saisi seul ne donne rien. Seul celui qui ouvre l'invitation et l'accepte reçoit les courses, donc les adresses des clients. Le lien de course est effacé à la fin de la livraison.
- Course automatique : à la réponse du client (`fiila_fulfill_request` → `order_sync` → `order_dispatch`) ou à la création d'une commande dont l'adresse est déjà connue. Envoi manuel possible (« Envoyer à … »).
- Page livreur `#/livreur` : courses en cours, montant à encaisser, appel du client, « Livrée ». Rafraîchie toutes les 20 s, vibration à chaque nouvelle course. Pas d'API WhatsApp payante.
- Suppression de la boutique (`fiila_shop_delete`) : boutique, articles, clients, commandes, paiements, notes, demandes liées. Les adresses des clients restent à eux.

**Suite prévue**
- Notification web push (gratuite) pour prévenir le livreur page fermée.
- Inscription publique des livreurs.

### Conception initiale (référence)

**Besoin (fondateur)**
- Un livreur s'inscrit et reçoit des courses.
- Un commerçant ou un particulier choisit un « livreur attitré ».
- Dès que le client a donné son adresse, la course part automatiquement chez ce livreur.
- Les livreurs sont notés.

**Architecture prévue**
- `couriers` : nom, téléphone, zone, moyen (moto, voiture, vélo), clé du téléphone et/ou compte. Statut disponible / indisponible.
- `shop_couriers` : livreur(s) attitré(s) d'une boutique. Le livreur accepte le rattachement par un lien.
- `deliveries` : course. Elle regroupe l'actuel `trackers` (lien livreur, suivi) plus le livreur assigné et son statut (proposée, acceptée, en route, livrée). La table `trackers` existante en devient la partie position, sans réécriture.
- **Envoi automatique.** À la réponse du client (`order_sync`), si la boutique a un livreur attitré, une course est créée et apparaît dans la page du livreur.
  - Page livreur `#/livreur` : ses courses du jour, sans compte obligatoire.
  - Alerte du livreur : notification web push (gratuite) si elle est acceptée sur son téléphone, sinon lien WhatsApp préparé.
  - L'envoi automatique d'un message WhatsApp passe par l'API WhatsApp Business, **payante** : décision du fondateur.
- `courier_reviews` : note par l'expéditeur et/ou le client après la livraison, comme `reviews`.

**Point à trancher avant de construire.** La liste publique de livreurs (« inscrits sur la plateforme ») engage Fii La : vérification d'identité, litiges, données à déclarer à la CDP. Je recommande de commencer par le **livreur attitré** (relation déjà existante entre le commerçant et son livreur), puis d'ouvrir l'inscription publique.

## 5. V2 — paiement en ligne (prévu)

Le modèle est en place (`payments.source / status / provider_ref`).

Il reste :
1. l'accord avec l'opérateur : Wave Business, Orange Money ou un agrégateur ;
2. la fonction serveur `fiila-pay` : session de paiement et webhook signé ;
3. le bouton « Payer » sur la facture.

Aucun service payant ni contrat n'est engagé sans accord du fondateur.

## 6. V3 — vitrine et marketplace (prévu)

**Base déjà posée :** boutiques, articles avec photo et prix, notes vérifiées par achat.

**À ajouter le moment venu**
- `shops.public` et `shops.slug` : vitrine `#/b/<slug>` avec les articles visibles et le bouton « Commander », qui crée la commande et la demande d'adresse d'un coup.
- `products.public` et `category`, un index de recherche : fil des produits et recherche par quartier ou catégorie.
- Modération (signalement, retrait), règles de mise en avant, frais éventuels.

**Condition proposée pour ouvrir la marketplace :** un nombre minimal de boutiques actives et de commandes livrées en V1. Une vitrine vide décourage. Seuil à fixer par le fondateur.

## 7. Limites connues

- Sans compte, la boutique vit dans le navigateur du téléphone. Effacer ses données fait perdre l'accès. D'où la proposition de compte à la création.
- « Mot de passe oublié » demande un service d'envoi d'e-mails (Resend ou Brevo, gratuits au départ). La confirmation e-mail est désactivée pour le pilote.
- Les limites anti-abus sont comptées par adresse IP. Au Sénégal, beaucoup de téléphones mobiles partagent une même adresse IP. Les seuils sont à surveiller au lancement : 60 boutiques par heure, 40 fiches par heure et par adresse IP.
- Les photos sont stockées dans la base (≤ 300 Ko par article). C'est suffisant pour la V1. Pour la marketplace, il faudra passer au stockage de fichiers avec miniatures.

## 8. Publication sur les réseaux sociaux de la boutique (prévu, fondateur 17/10 23:01)

**Besoin :** quand une boutique ajoute un article (ou en livre un), elle publie la photo et le texte sur ses propres comptes (Instagram, Facebook, TikTok, statut WhatsApp) depuis Fii La, puis gère ses publications depuis Fii La.

**Briques, dans l'ordre**
1. **Partage natif (gratuit, sans compte relié).** Bouton « Publier » sur un article : le téléphone ouvre sa feuille de partage avec la photo, la légende et le lien de commande (`navigator.share` avec fichier). La commerçante choisit Instagram, Facebook, TikTok ou son statut WhatsApp. Repli ordinateur : télécharger la photo et copier la légende. Aucune autorisation, aucune API, aucun coût.
2. **Vitrine publique** (§6, `#/b/<slug>`) : chaque publication renvoie vers l'article et le bouton « Commander ». Sans elle, le lien d'une publication ne peut qu'ouvrir WhatsApp.
3. **Historique local** : table `posts` (shop_id, product_id, canal choisi, date, lien suivi `?src=post`) pour savoir quelles publications ramènent des commandes.
4. **Comptes reliés (plus tard).** Publication directe et programmée par API : Meta Graph API (Instagram professionnel et page Facebook, examen de l'application par Meta obligatoire), TikTok Content Posting API (audit TikTok). Jetons des réseaux chiffrés côté serveur, jamais dans le navigateur. Le statut WhatsApp n'a pas d'API : il restera en partage natif.

**Données prévues :** `posts`, `social_accounts` (shop_id, réseau, identifiant du compte, jeton chiffré, expiration). Rien n'est créé tant que la brique 4 n'est pas lancée.

**Points à trancher plus tard :** examen Meta (délai, politique de confidentialité sur le domaine dédié), traitement de données supplémentaire à signaler à la CDP.

## 9. Suivi en direct en 3D (en attente, fondateur 17/10 23:01 : « on validera plus tard »)

Proposition faite le 17/10, non validée. Rien n'est construit.

- **Rendu :** carte inclinée de Dakar, bâtiments en relief stylisés (hauteurs OpenStreetMap souvent absentes), style propre à Fii La : sol sable, océan profond, peu de libellés, version nuit pour le thème sombre. Livreur représenté par un personnage sur son véhicule (moto Jakarta, voiture, à pied) avec ombre, mouvement fluide entre deux positions, orientation dans le sens de la marche, trajet en ligne lumineuse, caméra qui suit, petite animation à l'arrivée avec la photo de l'entrée.
- **Technique, coût 0 :** MapLibre GL (libre) avec fonds vectoriels OpenStreetMap gratuits (OpenFreeMap), ou un fichier PMTiles du Sénégal hébergé par nous (hébergement et coût à vérifier) ; modèles 3D légers (glTF) affichés avec three.js, libres de droits ou dessinés pour Fii La ; interpolation des positions reçues, pas de service payant.
- **Garde-fous :** +400 Ko environ, alors que la page reçue pèse 118 Ko. Le statut, l'heure d'arrivée et l'appel s'affichent d'abord ; la 3D se charge ensuite seulement si le téléphone tient, sinon la carte 2D actuelle. Rien ne change dans les données de position (toujours effacées à l'arrivée).
- **Non retenu :** 3D photoréaliste (Google, Mapbox) : payante et trop lourde pour la 3G.
- **Étapes proposées :** prototype seul avec un faux trajet → test iPhone du fondateur → branchement livraison puis rendez-vous → plus tard trajet calé sur les rues (service d'itinéraire, choix de coût).
- **Questions ouvertes pour le fondateur :** ambiance (« Dakar au crépuscule » ou graphique façon jeu), véhicules du départ, périmètre (livraison seule ou aussi rendez-vous), feu vert du prototype.

## 10. Croissance : origine, parrainage, publications (construit le 17/10/2026)

- Tables `fiila.referrers` (parrain : boutique, livreur ou particulier avec clé ou compte ; code unique ; numéro normalisé jamais renvoyé), `fiila.referrals` (une ligne par arrivée : type, cible, source, parrain ou numéro en attente), `fiila.posts` (publication d'un article), `profiles.is_admin`.
- RPC : `fiila_attribute`, `fiila_referral_me`, `fiila_referral_card_save`, `fiila_referral_card_delete`, `fiila_referral_public`, `fiila_post_log`, `fiila_admin_stats` ; `fiila_products` renvoie `posts`.
- Arrivée active : boutique = 3 clientes différentes et une commande livrée ; livreur = une course terminée ; adresse ou rendez-vous = fiche active.
- Client : `noteTouch()` dans le routeur, `attribute()` après chaque création, `referralAsk()`, vues `#/r/CODE`, `#/parrainer[?pour=boutique|livreur]`, `#/stats`, `publishBox()`.
- Migration `20261018000000_fiila_referrals.sql`. Tests : `tests/referrals.sql.test.mjs`, `tests/referrals.test.mjs`, publication dans `tests/shop.test.mjs`.

## 11. Vitrine publique (construite le 19/10/2026)

- `shops.slug` (unique, lisible, tiré du nom), `shops.public` (fermée par défaut), `shops.about` ; `orders.source` (`shop` | `vitrine`).
- RPC : `fiila_shop_vitrine` (ouvrir, fermer, présenter), `fiila_vitrine` (lecture publique, sans photos), `fiila_vitrine_photo` (photo d'un article, à l'affichage), `fiila_vitrine_order` (commande en ligne : prix de la base, 20 articles et 99 par article au plus, nom et numéro obligatoires, 10 commandes par heure et par IP).
- Une commande en ligne ne reprend **jamais** une adresse connue du client : un numéro tapé ne suffit pas à faire livrer chez quelqu'un. La personne donne son adresse depuis la facture.
- Client : `#/b/<slug>` (panier en mémoire, rien d'écrit sur le téléphone), `#/b/<slug>?a=<article>` (article mis en avant, utilisé par la légende « Publier »), confirmation sur la facture (`?nouvelle=1`) avec « Prévenir la boutique sur WhatsApp ». Réglages : « Ma vitrine en ligne ».
- Parrainage : une boutique ouverte après la visite d'une vitrine est comptée pour cette vitrine (source `vitrine`).
- Restent pour la marketplace (V3) : catégories, recherche, modération, mise en avant.

### 11 bis. Modèles et personnalisation de la vitrine (19/10/2026)
- Trois modèles : **Galerie** (deux vignettes par ligne, par défaut), **Catalogue** (liste compacte, photo à gauche), **Magazine** (une grande photo 4:5 par article).
- Couleur d'accent dans une palette fermée de 6 (Forêt, Nuit, Indigo, Prune, Bordeaux, Terre) : texte blanc lisible sur chacune ; aucune couleur libre (pas de saisie hexadécimale).
- Photo de couverture (mêmes contrôles que les photos d'articles : format vérifié, métadonnées refusées, 400 Ko au plus), chargée à part.
- Migration `20261019100000_fiila_vitrine_themes` : `shops.theme`, `shops.accent`, `shops.cover`.
