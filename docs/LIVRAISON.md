# Fii La — dossier de livraison du pilote

*Mis à jour le 15 octobre 2026. Données de démonstration et de test : uniquement synthétiques.*

## 1. Statut

**STATUT : NOT READY — non déployé.** Le produit fonctionne et est testé en local ; il n’est pas encore accessible en ligne.

| Critère d’acceptation | État |
|---|---|
| Aucun défaut critique connu de sécurité ou de perte de données | Aucun connu (29 tests SQL, 35 + 23 tests E2E, parcours de production répété en local 12/12) |
| Tous les parcours obligatoires passent dans l’environnement **déployé** | **Non vérifié** : la base de données en ligne n’existe pas |
| Limites des intégrations externes explicites | Oui, section 6 |

## 1 bis. Déploiement : état réel et blocage

| Élément | État vérifié |
|---|---|
| Code | https://github.com/aramislab0/fii-la, branche `main` |
| Hébergement (GitHub Pages, gratuit) | Activé. Les déploiements échouent uniquement à l’étape « Écrire la configuration publique » : `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` n’existent pas, faute de base. **L’hébergement n’est pas le blocage et ne demande aucun paiement.** |
| Base de données (Supabase) | **Bloquée.** Création refusée par Supabase : « There are overdue invoices in the organization(s) AramisLab ». Le refus s’applique aussi à une organisation neuve (essai du 15/10, 01:35) |
| Migrations | Prêtes : `20261015000000_fiila_init.sql`, `20261015100000_fiila_metrics.sql`. Appliquées sur aucune base en ligne |

**Actions nécessaires (côté compte, non faisables par Claude)**
1. **Régler la facture en retard** de l’organisation Supabase AramisLab : tableau de bord → Organization → Billing → Invoices. Montant visible seulement dans ce tableau de bord. Fii La lui-même ne coûte rien en plan gratuit.
2. **Possible ensuite** : Supabase limite le plan gratuit à 2 projets actifs (les projets en pause ne comptent pas). Si la création échoue pour cette raison : mettre en pause un projet inutilisé (gratuit) ou passer l’organisation en Pro (25 $/mois, 1 projet inclus, projets supplémentaires à partir de 10 $/mois). Rien ne sera activé sans accord.
3. **Lancer le déploiement** depuis le Mac (Supabase CLI et GitHub CLI y sont connectés) : `cd ~/Projects/fii-la && git pull && ./scripts/deploy.sh`, ou rouvrir l’application Claude sur le Mac pour que Claude le lance.

**Ce que fait `scripts/deploy.sh`** : crée (ou réutilise) le projet `fii-la` à Paris, applique les migrations dans l’ordre, vérifie les droits d’accès (`scripts/verify-db.mjs` : schéma privé fermé, aucune table exposée, exactement 14 fonctions publiques), publie seulement l’URL et la clé publique dans les variables GitHub, déploie Pages, attend que le site serve le bon commit, puis lance en production le parcours complet (`tests/deployed.test.mjs`) en Chromium et WebKit et la suite complète en Chromium, avec lecture des compteurs agrégés. Le mot de passe de la base reste dans `~/Projects/fii-la-ops/.env.ops` (droits 600) : jamais affiché, jamais envoyé à GitHub, jamais dans le dépôt. Aucune clé privilégiée n’est utilisée.

**Alternative sans paiement, non retenue par défaut** : installer Fii La dans un schéma séparé d’un projet Supabase existant. Elle demande un accord explicite et un projet encore actif ; or Supabase met en pause les projets d’une organisation qui a une facture en retard.

## 2. Périmètre livré

| Parcours du cahier des charges | Livré | Remarques |
|---|---|---|
| A. Créer, enregistrer, modifier, supprimer une adresse | Oui | Point d’entrée sur carte réelle (GPS ou placement manuel, coordonnées collées), précision affichée, validation explicite du point, arrêt voiture distinct, photo, repère, aperçu, brouillon local |
| B. Partager et recevoir | Oui | Partage natif quand disponible, copie du lien, message WhatsApp préparé, QR code du vrai lien ; fiche destinataire sans compte, sans demande de position |
| C. Demander un Fii La | Oui | Une réponse par demande, vue privée du demandeur, validité 7 jours |
| D. Rendez-vous Fii La | Oui | Date en heure de Dakar, mise à jour sur le même lien, expiration appliquée par le serveur |
| Propriété, révocation, suppression | Oui | Jetons séparés lecture / gestion, désactivation, nouveau lien, suppression de la fiche et de sa photo, clé de gestion pour un autre téléphone |
| Audio | **Non** | Optionnel ; volontairement écarté pour fiabiliser les parcours obligatoires |
| Plus Codes | **Non** | Optionnel ; les coordonnées restent la référence et sont copiables |
| Carte d’adresse téléchargeable | **Non** | Optionnelle ; le QR code et le lien couvrent le besoin |
| Yango | **Non** | Aucune intégration ni bouton ; voir section 6 |
| Vue satellite | **Non** | La carte est OpenStreetMap (plan). Voir section 6 |

## 3. Démonstration (5 minutes)

1. Sur le téléphone A, ouvrir l’URL, **Créer mon adresse**, « Utiliser ma position », ajuster la carte, **Valider ce point**.
2. Répondre **Non** à « Une voiture peut-elle arriver… », placer l’arrêt voiture, écrire le trajet à pied.
3. Nom, photo de la porte, repère, **Continuer**, vérifier l’aperçu, **Enregistrer et obtenir mon lien**.
4. **Préparer un message WhatsApp** et l’envoyer au téléphone B. Sur B, ouvrir le lien : photo, « 1. Arrêt voiture », « 2. Entrée », **Itinéraire (Google Maps)**.
5. Sur A, **Demander une adresse** (« Livraison de votre commande »), envoyer le lien à B. Sur B, créer ou choisir une adresse, vérifier l’aperçu, **Envoyer mon adresse**. Sur A, **Vérifier si le client a répondu**.
6. Sur A, **Créer un rendez-vous**, partager, puis modifier les indications : B voit le changement en rouvrant le lien.
7. Sur A, ouvrir l’adresse, **Désactiver le lien** : B voit « Ce lien a été désactivé ».

## 4. Architecture et sécurité

- **Front** : `web/`, HTML/CSS/JS sans framework ni build. La page destinataire ne charge ni la carte ni le générateur de QR.
- **Hébergement** : GitHub Pages, déployé par `.github/workflows/pages.yml` à chaque push sur `main`. La configuration publique (`config.js`) est écrite au déploiement depuis les variables du dépôt.
- **Données** : schéma privé `fiila` (`supabase/migrations/`). Le rôle `anon` n’a aucun droit sur les tables ; il ne peut exécuter que 13 fonctions `public.fiila_*`.
- **Jetons** : partage 128 bits (dans le lien), gestion 256 bits (sur le téléphone, stocké haché SHA-256). Comparaison côté serveur ; une erreur ne dit jamais si la fiche existe.
- **Appels en POST uniquement** : les jetons et contenus ne passent jamais dans une URL HTTP ni dans les journaux d’accès. Les liens utilisent le fragment `#`, qui n’est jamais envoyé au serveur.
- **Photos** : réduites à 1 280 px, recompressées en JPEG, segments de métadonnées retirés dans le navigateur ; le serveur refuse tout ce qui n’est pas JPEG/PNG/WebP, plus de 400 Ko, ou qui contient un bloc EXIF. Elles sont stockées dans la ligne de la fiche : désactivation et suppression les rendent immédiatement inaccessibles, il n’existe aucune URL publique permanente.
- **Abus** : 40 créations par heure et par adresse IP (empreinte salée, conservée 24 h). Jetons invalides refusés avant toute requête.
- **Contenu utilisateur** : jamais injecté en HTML (textContent partout), politique CSP stricte (scripts du site uniquement), aucune donnée privée dans les aperçus de lien.
- **Rétention** : rendez-vous effacés 30 jours après expiration, demandes 30 jours après expiration, anciens liens remplacés oubliés après 180 jours.

## 5. Tests

| Suite | Commande | Résultat | Conditions |
|---|---|---|---|
| API SQL | `npm run test:sql` | **29/29** | Postgres 17 via PGlite 0.3.16, migration réelle, rôle `anon` |
| E2E local | `npm run test:e2e` | **35/35** | Chromium 141.0.7390.37 (Playwright 1.56), émulation iPhone 13, 390 px, deux contextes isolés |
| E2E local | `ENGINE=webkit npm run test:e2e` | **35/35** | WebKit 26.0 (Playwright 1.56) sur le Mac du fondateur, émulation iPhone 13 |
| E2E déployé | `npm run test:e2e:deploye` | voir 1 bis | même suite, contre l’URL publique |
| Découverte | `npm run test:discovery` | **23/23** | Chromium 141.0.7390.37, iPhone 13 émulé, Light et Dark, 320 / 390 / 1 280 px ; voir section 11 |

Ce que couvrent les 35 parcours : création complète, géolocalisation réussie / refusée / trop lente / imprécise, correction manuelle sur la carte, arrêt voiture distinct, photo (refus d’un fichier non image, retrait des métadonnées vérifié octet par octet), échec réseau à l’enregistrement avec reprise, absence de clé dans le lien, QR décodé égal au lien, copie et repli quand le presse-papiers est refusé, ouverture sur un second téléphone isolé, aucune demande de position côté destinataire, script injecté non exécuté, texte long sans débordement, itinéraires et coordonnées égaux aux points enregistrés, tentative de modification sans clé refusée, modification sur le même lien, restauration de la clé, demande (création, réponse, invisibilité pour un tiers, récupération privée), rendez-vous (création, mise à jour, expiration côté serveur), désactivation, nouveau lien, suppression, liens invalides, hors connexion, absence d’erreur JavaScript, poids de la page sur réseau lent.

**Défauts trouvés et corrigés pendant les tests**
- Safari/WebKit ajoute un bloc EXIF aux JPEG produits par un canvas : le serveur refusait la photo, donc l’enregistrement échouait sur iPhone. Corrigé par le retrait des segments de métadonnées avant envoi (vérifié en WebKit).
- Deux affichages de listes rendaient du texte brut au lieu des éléments ; coordonnées à 1 ou 2 décimales refusées à tort ; QR code avec une marge trop faible pour certains lecteurs ; point GPS légèrement décalé si la carte était encore animée au moment de valider. Tous corrigés et couverts par les tests.

**Performance mesurée (page destinataire avec photo)** : 142 Ko transférés au total, fiche complète affichée en 2,8 s, sur réseau simulé à 750 kbit/s avec 300 ms de latence (Chromium, serveur local ; la latence réelle vers Paris s’ajoute). La carte et le générateur de QR ne sont pas chargés sur cette page.

**Couverture appareils : ce qui n’a pas été testé**
- Aucun test sur un **iPhone ou un téléphone Android physique**. Chromium et WebKit ont été testés en émulation mobile, ce qui ne remplace pas un vrai appareil (GPS réel, appareil photo, clavier, Safari iOS).
- L’ouverture réelle de **WhatsApp**, du **partage natif** et de l’**application Google Maps** n’a pas été vérifiée : seuls les liens produits ont été contrôlés.
- En WebKit, le processus de test a planté lors d’un rechargement de page ; les tests ouvrent désormais chaque lien dans un nouvel onglet. Non reproduit en Chromium ; à surveiller sur iPhone.

## 6. Intégrations externes et limites

- **Google Maps** : liens au format officiel « Maps URLs » (`/maps/dir/?api=1&destination=lat,lng&travelmode=…`). Les coordonnées transmises sont celles enregistrées (vérifié). La qualité de l’itinéraire dépend de Google Maps, pas de Fii La.
- **Yango** : aucune intégration. Les coordonnées copiables et le lien suffisent pour les communiquer à un chauffeur.
- **Carte** : tuiles OpenStreetMap standard, gratuites, sans engagement de service. Leur politique d’usage interdit l’usage intensif et peut couper l’accès sans préavis. Elle convient à un pilote ; au-delà, il faudra un fournisseur de tuiles commercial ou auto-hébergé. **Il n’y a pas de vue satellite**, ce qui rend le placement précis d’une entrée plus difficile dans les quartiers où le plan OSM est peu détaillé : c’est la principale limite produit du pilote.
- **Précision** : un point confirmé ou une position GPS ne prouvent pas que l’entrée physique est la bonne. La fiche l’indique implicitement en montrant la photo et le repère, mais rien n’est vérifié sur place.

## 7. Données et conformité (Sénégal)

**Faits vérifiés**
- La loi n° 2008-12 du 25 janvier 2008 sur la protection des données à caractère personnel reste le cadre applicable ; une réforme est annoncée depuis 2019 mais n’était pas adoptée selon un article de mars 2026.
- La CDP (Commission de protection des données personnelles) traite les formalités préalables : déclarations et demandes d’autorisation. Son avis trimestriel n° 03-2025 précise qu’une base de données hébergée au Sénégal relève d’une **déclaration normale**, et qu’un hébergement **à l’étranger** relève d’une **demande d’autorisation**.

**Conséquence pour Fii La**
- Le pilote stocke des points d’entrée et des photos de portes, rattachables à des personnes : ce sont des données personnelles, même sans compte.
- La base est hébergée à Paris : **une demande d’autorisation à la CDP est à prévoir avant d’ouvrir le service à de vrais utilisateurs**. Le responsable de traitement (Aramis Lab ou la structure de l’ami) doit être désigné.
- **Tant que cette formalité n’est pas faite, le pilote doit rester restreint** : données synthétiques, ou test terrain encadré avec le consentement écrit des participants (voir `FICHE-TEST-TERRAIN.md`). Ce point est à faire valider par un juriste ; ce dossier n’est pas un avis juridique.

**Mesures déjà en place** : minimisation (pas de compte, pas de téléphone, pas de contacts, pas de pièce d’identité), position lue seulement sur action, métadonnées des photos retirées, aucun outil de suivi (seulement des compteurs journaliers anonymes, section 11), suppression réelle, page « Données et confidentialité » dans l’application.

**Sauvegardes** : sur le plan gratuit Supabase, aucune sauvegarde automatique n’est incluse ; une suppression est donc définitive. Sur un plan payant, les sauvegardes quotidiennes conservent une copie quelques jours.

**Sources** : [CDP, avis trimestriel n° 03-2025](https://sppsyrftszniuaicadvk.supabase.co/storage/v1/object/public/public_docs/avis-trimestriels/avis-trimestriel-1763029761225.pdf) · [Osiris, révision de la loi (2020)](https://osiris.sn/le-senegal-va-reviser-la-loi-sur-la-protection-des-donnees-personnelles.html) · [AllAfrica, mars 2026](https://fr.allafrica.com/stories/202603280054.html)

## 8. Coûts d’infrastructure (vérifiés sur les sites des fournisseurs le 15/10/2026)

| Service | Coût pilote | Limites à connaître |
|---|---|---|
| GitHub Pages | 0 € | Dépôt public obligatoire sur le plan gratuit |
| Supabase (plan gratuit) | 0 € | 500 Mo de base, 5 Go de trafic sortant par mois, **mise en pause après 7 jours sans activité**, 2 projets actifs par organisation, pas de sauvegarde |
| Supabase Pro (si besoin) | 25 $/mois puis 10 $/mois par projet supplémentaire | Sauvegardes, pas de mise en pause |
| Tuiles OpenStreetMap | 0 € | Sans garantie de service |

Ordre de grandeur : une fiche avec photo pèse environ 150 à 300 Ko, soit environ 2 000 fiches avec photo dans 500 Mo.

**Inconnu** : la facture en retard sur l’organisation Supabase AramisLab, qui bloque la création de projet.

## 9. Déploiement et retour arrière

**Variables du dépôt GitHub** (Settings → Secrets and variables → Actions → Variables) :
- `SUPABASE_URL` : `https://<ref>.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` : clé publique « anon » ou « publishable » du projet (conçue pour être publique)
- `PUBLIC_URL` (facultatif) : URL publique si un domaine est ajouté

**Base** : `supabase link --project-ref <ref>` puis `supabase db push` applique `supabase/migrations/`.

**Front** : chaque push sur `main` qui touche `web/` redéploie. Déclenchement manuel : onglet Actions → « Déployer Fii La sur GitHub Pages » → Run workflow.

**Retour arrière** : `git revert <commit>` puis push (redéploie la version précédente), ou relancer le workflow sur un commit antérieur. Pour la base, toute migration future doit être additive ; aucune migration destructive n’est livrée.

## 10. Récupérer, désactiver, supprimer (mode d’emploi utilisateur)

- **Mes fiches sont liées à mon téléphone.** Elles apparaissent dans « Mes adresses » sur le téléphone qui les a créées.
- **Changer de téléphone** : sur la fiche, ouvrir « Clé de gestion », la copier ou se l’envoyer sur WhatsApp, puis l’ouvrir sur le nouveau téléphone (ou « Restaurer une clé de gestion » en bas de page).
- **Clé perdue et téléphone perdu** : la fiche ne peut plus être modifiée par son propriétaire. Elle peut être supprimée par l’administrateur de la base sur demande, après vérification hors application.
- **Désactiver** : la fiche n’affiche plus rien ; **Créer un nouveau lien** la remet en ligne avec un lien différent.
- **Supprimer** : la fiche et sa photo sont effacées. Les captures d’écran ou messages déjà envoyés ne peuvent pas être rappelés.

## 11. Découverte : du destinataire au créateur (ajout du 15/10/2026)

**Ce qui change pour le destinataire.** Rien avant l’essentiel : la fiche (photo, repère, arrêt voiture, entrée, itinéraire) s’affiche comme avant, sans compte, sans invite d’installation, sans fenêtre surgissante ni demande de notification. Juste après les informations d’arrivée vient un bloc discret (fond doux, bouton contour, jamais flottant) :

| Fiche reçue | Titre | Texte | Bouton → parcours ouvert |
|---|---|---|---|
| Adresse | Et si on te trouvait aussi facilement ? | Crée ton adresse avec ta photo d’entrée et tes repères. Partage-la à tes visiteurs et livreurs. | « Créer mon Fii La » → création d’adresse existante |
| Rendez-vous | Tu organises aussi un rassemblement ? | Partage le lieu, l’heure et les indications dans une seule fiche. | « Créer mon rendez-vous » → création de rendez-vous existante |

Sous le bouton, une ligne factuelle : « Gratuit, sans compte et sans application à installer. Ta fiche se gère depuis ce téléphone. » C’est exact aujourd’hui : aucune étape payante ni compte n’existe dans le produit.

**Création.** Le formulaire s’ouvre vierge : aucune donnée de la fiche reçue (nom, repère, quartier, coordonnées, photo, lien) n’est copiée ; la carte part de la vue par défaut de Dakar. Le seul lien conservé est le chemin de retour, dans l’adresse de la page sur le téléphone (`?retour=…`), jamais envoyé au serveur. « ← Revenir à la fiche reçue » est présent pendant la création (le brouillon d’adresse est gardé) et sur la page de gestion après l’enregistrement. Aucun écran supplémentaire.

**Installation.** Proposée seulement après la première fiche enregistrée, sur la page de gestion, en une ligne facultative :
- Chrome, Edge, Samsung Internet (Android, ordinateur) : bouton « Installer Fii La » qui ouvre l’invite native du navigateur, seulement si le navigateur a signalé que l’installation est possible ;
- iPhone/iPad : consigne « bouton Partager, puis Sur l’écran d’accueil » (iOS n’a pas d’invite automatique) ;
- ailleurs (Firefox, navigateur intégré de WhatsApp, appli déjà installée) : rien n’est affiché.
« Plus tard » la masque durablement sur ce téléphone, sans rien bloquer. Aucun lien de store, aucune mention d’application native. Ajouts techniques : `manifest.webmanifest`, icônes, et un service worker qui garde seulement la coquille de l’application (HTML, CSS, JS, polices) ; il ne met jamais en cache les appels à l’API ni le contenu des fiches.

**Mesure.** Compteurs agrégés par jour, sans aucun identifiant :

| Événement | Variantes | Ce que cela signifie exactement |
|---|---|---|
| `discovery_shown` | address, meeting | Le bloc a été visible à au moins 50 % à l’écran, une fois par affichage de page |
| `discovery_cta` | address, meeting | Le bouton du bloc a été touché |
| `fiche_created` | address_direct, address_discovery, address_request, meeting_direct, meeting_discovery | Une fiche a été enregistrée par le serveur (succès confirmé) ; *_discovery quand la création part du bloc |
| `share_initiated` | native, whatsapp | Le partage natif ou WhatsApp a été ouvert. **Ce n’est pas un message envoyé** : Fii La ne peut pas le savoir |
| `link_copied` | address, meeting | La copie du lien dans le presse-papiers a réussi |

- Stocké : `jour, événement, variante, nombre`. Rien d’autre : ni jeton, ni clé, ni identifiant de fiche, ni adresse, ni coordonnées, ni photo, ni cookie, ni stockage sur le téléphone. Le serveur refuse toute valeur hors de la liste blanche.
- Anti-abus : 300 envois par heure et par connexion, avec la même empreinte salée de l’IP que les créations, effacée après 24 h.
- Les signaux « Global Privacy Control » et « Do Not Track » du navigateur sont respectés : aucun envoi.
- L’envoi est silencieux et n’est jamais attendu : une panne ou un blocage n’affecte ni l’affichage ni la création (testé : requêtes rejetées et requêtes sans réponse).
- Lecture : uniquement dans l’éditeur SQL Supabase, `select day, event, variant, n from fiila.metrics order by day desc;`. Pas d’accès par l’API publique.
- Consentement : ces compteurs ne contiennent aucune donnée personnelle et ne déposent rien sur le téléphone ; aucune bannière n’est donc ajoutée. L’empreinte d’IP temporaire relève du traitement déjà décrit en section 7 et doit figurer dans la demande à la CDP. À confirmer par un juriste.
- Déploiement : appliquer la migration `supabase/migrations/20261015100000_fiila_metrics.sql` (`supabase db push`). Sans elle, la mesure échoue sans bruit et le reste fonctionne.

**Lecture du tunnel.** Taux de clic = `discovery_cta / discovery_shown` ; conversion = `fiche_created (*_discovery) / discovery_cta` ; partage = `share_initiated + link_copied`. Ce sont des ordres de grandeur : sans identifiant, une même personne qui revient sur une fiche est recomptée, et un parcours ne peut pas être suivi d’un bout à l’autre.

**Vérifications (23 tests, `tests/discovery.test.mjs`)**
- Destinataire anonyme : fiche, photo et itinéraire visibles ; aucun stockage local, aucune demande de position, aucune boîte de dialogue, aucune invite de compte, de store ou d’installation.
- Bloc placé après la fiche, sans recouvrement ni position flottante ; bouton moins appuyé que l’itinéraire.
- Contrastes mesurés du bloc (AA exigé, 4,5:1) : Light titre 14,2, texte 14,2, mention 5,6, bouton 16,7 ; Dark titre 13,0, texte 13,0, mention 6,4, bouton 14,4.
- Clavier : bouton atteignable à la tabulation, focus visible.
- Les deux boutons ouvrent le bon parcours ; formulaires vierges ; données envoyées à la création vérifiées octet par octet sans aucune donnée de l’expéditeur ; fiche créée relue côté serveur.
- Retour vers la fiche reçue : depuis la création (étape 1 et suivantes) et après l’enregistrement.
- Texte long à 320 et 390 px : aucun débordement. Ordinateur 1 280 px en Light et Dark.
- Mesure : bons événements, uniquement `p_event` et `p_variant`, aucune donnée sensible ; compteurs vérifiés en base ; GPC respecté ; panne de la mesure sans effet.
- Installation : absente avant la 1re fiche ; bouton puis invite native (simulée) ; « Plus tard » persistant ; consigne iPhone ; rien en mode application ; rien quand le navigateur ne la permet pas. Installabilité réelle vérifiée par Chromium lui-même (manifeste sans erreur, aucune erreur d’installabilité) ; le cache du service worker ne contient aucun appel à l’API.
- Non-régression : les 35 parcours existants passent toujours.

Captures : `docs/screenshots/discovery-*.png` (fiche adresse et rendez-vous en Light et Dark, focus clavier, création ouverte depuis le bloc, gestion après création, texte long à 320 px, ordinateur Light/Dark, installation Chromium et iPhone).

**Limites restantes**
- Rien de tout cela n’est encore en ligne : la base Supabase n’est pas créée (facture en attente). Tests faits en local uniquement.
- WebKit (Safari) n’a pas été relancé pour ce changement : le Mac n’était pas joignable. La passe WebKit précédente (35/35) ne couvre pas ce code.
- L’invite d’installation Chromium est simulée dans les tests (un navigateur sans interface ne la déclenche pas) ; l’installabilité, elle, est vérifiée réellement. La consigne iPhone est vérifiée en émulation, pas sur un iPhone.
- Si le destinataire avait lui-même un brouillon d’adresse non terminé sur ce téléphone, la création le reprend : ce sont ses propres données, jamais celles de l’expéditeur.
- Les compteurs peuvent être gonflés volontairement dans la limite anti-abus ; ils servent à décider, pas à facturer.
