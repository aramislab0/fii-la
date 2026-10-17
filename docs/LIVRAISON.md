# Fii La — dossier de livraison du pilote

*Mis à jour le 16 octobre 2026. Données de démonstration et de test : uniquement synthétiques.*

## 1. Statut

**STATUT : DEPLOYED AND VERIFIED IN PRODUCTION (synthetic data) — 16/10/2026.** URL : https://aramislab0.github.io/fii-la/. Pas encore ouvert à de vrais utilisateurs : voir `CONFORMITE-CDP.md` (formalité CDP à clarifier par le responsable du traitement) et la recette sur téléphones réels (`RECETTE-TELEPHONES.md`, non exécutée).

| Critère d’acceptation | État |
|---|---|
| Aucun défaut critique connu de sécurité ou de perte de données | Aucun connu |
| Tous les parcours obligatoires passent dans l’environnement **déployé** | **Oui** : parcours de production 12/12 en Chromium 141 et WebKit 26 ; suite complète 35/35 en Chromium et en WebKit sur l’URL publique |
| Droits de la base de production | Vérifiés (`scripts/verify-db.mjs`) : 4 migrations dans l’ordre, schéma `fiila` fermé, aucune table exposée, exactement 14 fonctions publiques en `security definer` avec `search_path` vide |
| Limites des intégrations externes explicites | Oui, section 6 |

Non vérifié à ce jour : vrais téléphones, vraies applications sociales (WhatsApp, Telegram, Facebook, Instagram, TikTok), réseau mobile lent réel. Les suites découverte, circuit et partage social tournent en local uniquement.

## 1 bis. Déploiement

| Élément | État vérifié |
|---|---|
| Code | https://github.com/aramislab0/fii-la, branche `main` |
| Hébergement | GitHub Pages (gratuit), URL ci-dessus |
| Base de données | Supabase, projet `fii-la` (`lkvulwocirttozfnyxck`), région Paris (`eu-west-3`), organisation « aramislab » (plan Pro existant, plafond de dépenses activé : aucun coût au-delà de l’abonnement). Créé le 16/10/2026 |
| Données | Base vide après les tests : toutes les fiches de test synthétiques supprimées |

**Incident de recette corrigé (16/10)** : 3 tests de la suite complète échouaient en production (désactivation, nouveau lien, suppression). Le serveur était correct (vérifié par appels directs). Cause : le test cliquait avant que la vue de gestion demandée remplace la précédente, ce que la latence réseau rendait visible. Correction dans le test uniquement (commit `0d09efe`) ; aucun changement du code de l’application.

**Point d’organisation** : l’organisation Supabase « AramisLab » (autre compte, projets Agent X, Solu, WURUS, etc.) a toujours une facture en retard. Elle n’héberge pas Fii La.

**Redéployer** : `cd ~/Projects/fii-la && git pull && FIILA_ORG_ID=tqooydfbuihhmoudtnot ./scripts/deploy.sh` (réutilise le projet existant). Le mot de passe de la base reste dans `~/Projects/fii-la-ops/.env.ops` (droits 600) : jamais affiché, jamais envoyé à GitHub, jamais dans le dépôt. Aucune clé privilégiée n’est utilisée.

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

**Analyse détaillée : `docs/CONFORMITE-CDP.md`** (textes, inventaire réel des données, questions ouvertes).

**Correction (15/10/2026)** : les versions précédentes affirmaient qu’une demande d’autorisation à la CDP était requise avant tout utilisateur réel. Ce n’est pas établi. En résumé, selon la lecture des textes, qui n’est pas un avis juridique :
- La loi n° 2008-12 s’applique très probablement aux fiches d’adresse (point d’entrée et photo de porte rattachables à une personne, art. 4.6).
- Aucune exemption ne paraît applicable (art. 3 et 17) ; l’existence d’une norme simplifiée (art. 19) n’a pas été trouvée.
- **Formalité de droit commun : déclaration** (art. 18). Seule la réception du récépissé autorise la mise en œuvre.
- **Autorisation (art. 20)** : la liste est fermée et aucune catégorie ne correspond à Fii La.
- **Hébergement à Paris = transfert vers un pays tiers** (art. 4.12 et 49) : information préalable de la CDP et niveau de protection suffisant ; à défaut, autorisation sur demande motivée (art. 51). Dans sa pratique publiée (avis trimestriel 03-2025), la CDP oriente l’hébergement hors du Sénégal vers son formulaire de demande d’autorisation : c’est à confirmer pour Fii La.
- Écarts à traiter : responsable du traitement non désigné, absence de durée maximale pour les fiches d’adresse (art. 35), identité du responsable absente de la page de confidentialité (art. 58), conditions de sous-traitance Supabase à vérifier (art. 39).
- **Prochaine étape** : désigner le responsable, faire relire la note par un juriste, puis le responsable interroge la CDP sur la formalité applicable. D’ici là, données synthétiques uniquement. Aucune démarche n’a été faite auprès de la CDP.

**Mesures déjà en place** : minimisation (pas de compte, pas de téléphone, pas de contacts, pas de pièce d’identité), position lue seulement sur action, métadonnées des photos retirées, aucun outil de suivi (seulement des compteurs journaliers anonymes, section 11), suppression réelle, page « Données et confidentialité » dans l’application.

**Sauvegardes** : sur le plan gratuit Supabase, aucune sauvegarde automatique n’est incluse ; une suppression est donc définitive. Sur un plan payant, les sauvegardes quotidiennes conservent une copie quelques jours.

**Sources** : [Loi n° 2008-12](https://www.afapdp.org/wp-content/uploads/2018/05/Senegal-texte-de-loi-2008.pdf) · [CDP, avis trimestriel n° 03-2025](https://sppsyrftszniuaicadvk.supabase.co/storage/v1/object/public/public_docs/avis-trimestriels/avis-trimestriel-1763029761225.pdf) · [Osiris, révision de la loi (2020)](https://osiris.sn/le-senegal-va-reviser-la-loi-sur-la-protection-des-donnees-personnelles.html) · [AllAfrica, mars 2026](https://fr.allafrica.com/stories/202603280054.html)

## 8. Coûts d’infrastructure (vérifiés sur les sites des fournisseurs le 15/10/2026)

| Service | Coût pilote | Limites à connaître |
|---|---|---|
| GitHub Pages | 0 € | Dépôt public obligatoire sur le plan gratuit |
| Supabase (plan gratuit) | 0 € | 500 Mo de base, 5 Go de trafic sortant par mois, **mise en pause après 7 jours sans activité**, 2 projets actifs par organisation, pas de sauvegarde |
| Supabase Pro (si besoin) | 25 $/mois puis 10 $/mois par projet supplémentaire | Sauvegardes, pas de mise en pause |
| Tuiles OpenStreetMap | 0 € | Sans garantie de service |

Ordre de grandeur : une fiche avec photo pèse environ 150 à 300 Ko, soit environ 2 000 fiches avec photo dans 500 Mo.

**Fonction serveur** : `fiila-resolve-maps` (Supabase Edge Function, publique, sans accès à la base) lit les liens courts Google Maps (`maps.app.goo.gl`) collés par l’utilisateur et renvoie le point. Elle n’accepte que ces liens, ne suit que des redirections vers Google et n’enregistre rien. Déployée par `scripts/deploy.sh`.

**Hébergement retenu** : organisation Supabase « aramislab », plan Pro déjà payé, plafond de dépenses activé. Fii La n’ajoute pas de coût tant qu’il reste dans le quota inclus.

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
- Consentement : ces compteurs ne contiennent aucune donnée personnelle et ne déposent rien sur le téléphone ; aucune bannière n’est donc ajoutée. L’empreinte d’IP temporaire est vraisemblablement une donnée personnelle : elle fait partie du traitement décrit en section 7 et dans `CONFORMITE-CDP.md`. À confirmer par un juriste.
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

## 12. Circuit complet et réutilisation (ajout du 15/10/2026, après-midi)

Circuit visé : recevoir → trouver l’entrée → comprendre Fii La → créer → enregistrer → partager → revenir → réutiliser. Hors périmètre : offres payantes, paiement, suivi en direct, calcul d’itinéraire interne.

**Audit : écarts trouvés et corrections**

| Étape | Écart constaté dans le code | Correction |
|---|---|---|
| Trouver l’entrée | Coordonnées brutes affichées en grand sous chaque itinéraire : on partageait des chiffres plutôt qu’une fiche | Coordonnées repliées sous « Coordonnées GPS (si le lien ne s’ouvre pas) », toujours copiables |
| Trouver l’entrée | Aucun écart : voiture vers l’arrêt, à pied vers l’entrée, URLs Google Maps officielles | Vérifié par test (`api=1`, `destination=lat,lng` dans cet ordre, virgule encodée `%2C`, `travelmode`) |
| Comprendre | Le propriétaire qui ouvre son propre lien (depuis WhatsApp) voyait « Créer mon Fii La » | Bloc « Cette fiche est la vôtre » avec « Gérer et partager » |
| Comprendre | Rendez-vous terminé : le seul bouton menait à la création d’adresse | Le bouton mène à « Créer mon rendez-vous » |
| Créer | Formulaire de rendez-vous sans brouillon : tout était perdu en quittant la page, en revenant à la fiche reçue ou après un échec suivi d’un rechargement | Brouillon local enregistré à chaque saisie, repris avec « Recommencer » possible, effacé après succès |
| Enregistrer → partager | Confirmation seulement dans un message éphémère de 3 s | Confirmation persistante « ✓ Enregistré. Envoyez maintenant le lien… » au-dessus du bloc Partager, affichée seulement après la réponse du serveur |
| Partager | Page d’une demande d’adresse sans partage natif | « Partager… » ajouté quand le téléphone le permet, avant WhatsApp et la copie |
| Revenir | Aucun écart : retour vers la fiche reçue depuis la création et après l’enregistrement | Revérifié |
| Réutiliser | Aucun moyen de réutiliser un rendez-vous passé | « Créer un rendez-vous similaire » (détail ci-dessous) |
| Réutiliser | Demande expirée : « Créez-en une nouvelle » sans bouton (cul-de-sac) | « Refaire la demande », nom et objet repris, référence de commande vide |
| Carte | Un recalage d’affichage de la carte décalait un point repris d’environ 0,3 m | Le recalage ne modifie plus le point (défaut trouvé par les tests) |
| Texte long | Le bandeau « À partir de… » débordait à 320 px avec un nom sans espace | Retour à la ligne forcé |

**« Créer un rendez-vous similaire »** (page de gestion d’un rendez-vous ; mis en avant quand il est expiré)
- Repris : lieu et arrêt voiture (affichés mais à **reconfirmer** avec « Valider ce point »), trajet à pied, indications, photo, durée d’affichage.
- Jamais repris : nom, date et heure (à saisir), lien de partage, clé de gestion, statut désactivé ou expiré.
- Enregistré comme une fiche distincte (nouveaux jetons). Le rendez-vous d’origine n’est jamais modifié : vérifié champ par champ en base, y compris quand l’origine est désactivée et expirée.
- Brouillon propre à chaque rendez-vous d’origine, gardé si l’on quitte la page.

**Carte (rappel)** : Leaflet 1.9.4 + tuiles OpenStreetMap standard, chargées seulement pendant la création, attribution « © OpenStreetMap » visible. Politique d’usage OSMF : pas d’usage intensif ni de téléchargement massif, pas de garantie de service, accès révocable sans préavis. Adapté au pilote ; un fournisseur de tuiles dédié sera nécessaire à plus grande échelle. Aucune API payante. Les itinéraires passent par les URLs Google Maps, qui ne demandent ni clé ni abonnement.

**Mesure : ajouts (migration `20261015120000_fiila_metrics_reuse.sql`)**

| Événement | Variantes | Sens exact |
|---|---|---|
| `fiche_created` | + `meeting_similar` | Rendez-vous enregistré à partir d’un autre |
| `request_created` | `request` | Demande d’adresse enregistrée |
| `share_initiated` | `native_*`, `whatsapp_*` pour `address`, `meeting`, `request` | Partage natif ou WhatsApp **ouvert** ; jamais « message envoyé » |
| `link_copied` | + `request` | Copie réussie du lien d’une demande |
| `owned_reopened` | `address`, `meeting`, `request` | Une fiche possédée rouverte depuis l’accueil |

Ce sont des comptes d’événements par jour : ni des personnes uniques, ni un taux de fidélité, ni des arrivées. Aucun clic sur l’itinéraire n’est compté. Aucune donnée de lieu, aucune clé ni aucun jeton n’est envoyé (vérifié par test).

**Tests de ce lot (`tests/circuit.test.mjs`, 20/20, Chromium 141, iPhone 13 émulé, base Postgres locale réelle)**
- Simulations, signalées dans le nom des tests : partage natif remplacé par un enregistreur (Chromium Linux n’a pas Web Share), expiration forcée en base, panne ou lenteur réseau par interception.
- Couvert : état « partager » seulement après la réponse du serveur ; partage natif limité à l’URL destinataire ; ordre partager puis gérer ; destinataire anonyme ; cibles d’itinéraire ; coordonnées repliées ; propriétaire reconnu sur son propre lien ; réouverture depuis l’accueil puis repartage (WhatsApp, copie) ; rendez-vous similaire (vierge sur nom et date, lieu à reconfirmer, brouillon gardé, fiche distincte, origine inchangée, y compris depuis une origine désactivée et expirée) ; liens désactivé et expiré ; brouillon retrouvé après échec puis rechargement ; position refusée ; demande partagée puis relancée après expiration ; thème sombre (contraste de la confirmation au moins 4,5:1) ; clavier ; texte long à 320 px ; contenu de la mesure.
- Non-régression : SQL 30/30, suite complète 35/35, découverte 23/23, parcours de production rejoué en local 12/12.

**Limites de ce lot**
- WebKit non exécuté : il ne s’installe pas dans cet environnement (téléchargement bloqué) et le Mac était hors ligne. La dernière exécution WebKit (35/35) date d’avant la découverte et la réutilisation.
- Aucun test sur téléphone physique ; le partage natif réel n’a pas été ouvert.
- Rien n’est en ligne : migrations non appliquées, aucune mesure réelle.

**À vérifier après déploiement (URL publique et vrais téléphones)**
1. `./scripts/deploy.sh` : 3 migrations appliquées, `verify-db` au vert, parcours de production Chromium et WebKit au vert.
2. iPhone (Safari) et Android (Chrome), en vrai : ouvrir un lien reçu dans WhatsApp, photo, « Itinéraire » qui ouvre bien l’application Google Maps sur l’arrêt puis sur l’entrée.
3. Partage natif réel depuis la page de gestion et depuis une demande : seul le lien de la fiche part.
4. « Créer un rendez-vous similaire » sur un vrai téléphone : saisie de la date avec le sélecteur natif.
5. Installation : invite sur Android, consigne « Sur l’écran d’accueil » sur iPhone.
6. Lire `fiila.metrics` après quelques jours de pilote : des comptes, pas des personnes.

## 13. Partage social (ajout du 15/10/2026)

**Panneau unique** sur les pages de gestion d’une adresse, d’un rendez-vous et d’une demande : lien destinataire, avertissement « Toute personne ayant ce lien peut consulter la fiche et le retransmettre. », puis « Partager… » (si le téléphone le permet), WhatsApp, « Copier le lien », et une grille discrète Telegram, Facebook, Instagram / Story, TikTok, avec des icônes monochromes simples (pas les logos officiels). La fiche destinataire ne reçoit aucun bouton de réseau social : l’itinéraire y reste l’action principale.

| Canal | Mise en œuvre | Ce que Fii La ne fait pas |
|---|---|---|
| Partage natif | `navigator.share` avec le titre, un court texte et l’URL destinataire. Annulation silencieuse ; refus → « Utilisez Copier le lien ». Bouton absent si le navigateur ne le permet pas | Le système choisit les applications proposées : aucune n’est garantie |
| WhatsApp | Lien `wa.me` avec message prêt (inchangé) | N’envoie rien tout seul |
| Telegram | `https://t.me/share/url?url=…&text=…`, les deux encodés, conforme à la documentation Telegram | — |
| Facebook | **Avec** un identifiant d’application Meta configuré (`FACEBOOK_APP_ID`) : bouton « Facebook » vers le Share Dialog documenté `facebook.com/dialog/share?app_id=…&href=…`. **Sans** configuration (cas actuel) : bouton « Facebook : copier le lien », qui copie l’URL destinataire et affiche la consigne « Fii La n’est pas relié à Facebook : le lien est seulement copié… ». Aucun lien vers Facebook n’est alors affiché | Aucun SDK Facebook, aucun message prérempli, aucune publication forcée, aucune adresse non documentée (`sharer.php` retiré le 15/10) |
| Instagram / Story | Image verticale + « Copier le lien » + consigne : ajouter le sticker « Lien » et y coller le lien | Pas de lien cliquable dans l’image, pas de publication automatique, pas d’ajout automatique du sticker. Instagram ne propose pas ce sticker aux comptes très récents |
| TikTok | Image verticale + « Copier le lien » + consigne prudente sur le champ « Site web » du profil | Pas de lien cliquable dans la légende ni dans l’image, pas de publication automatique |

**Image verticale** : 1080 × 1920 PNG, dessinée dans le navigateur avec la police et les couleurs de Fii La (aucune image générée par IA). Contenu : marque, type de fiche, nom (ou formule neutre si le propriétaire le masque), date et heure pour un rendez-vous (masquables), invitation à ouvrir la fiche, QR code de l’URL destinataire avec une marge blanche de 4 modules, et l’URL en clair. Jamais de clé de gestion, de coordonnées, de quartier ni de réponse privée. La photo de l’entrée n’apparaît que si le propriétaire coche « Inclure la photo » : elle est alors entière, non recadrée, sans texte par-dessus. Aperçu avant export ; si le navigateur ne sait pas télécharger, l’image s’affiche avec la consigne « appui long ». « Partager l’image… » n’apparaît que si le téléphone sait partager un fichier.

**Aperçus des réseaux sociaux** : les liens de fiche utilisent un fragment (`#/a/…`) que les robots des réseaux ne transmettent pas au serveur. L’aperçu ne montre donc que le titre et la description génériques de Fii La, jamais le contenu d’une fiche. Rien n’a été ouvert aux robots pour enrichir l’aperçu.

**Mesure** (migration `20261015140000_fiila_metrics_social.sql`) : `share_initiated` avec `telegram_*`, `facebook_*`, `instagram_*`, `tiktok_*` (canal choisi dans Fii La) ; `link_copied` (copie réussie) ; `visual_exported` avec `download_*` / `share_*` (image enregistrée ou feuille de partage ouverte). Aucun de ces compteurs ne signifie qu’un contenu a été publié, livré, vu, ni qu’une personne est arrivée. Aucun identifiant ajouté.

**Tests (`tests/social.test.mjs`, 23/23 après correction, Chromium 141, iPhone 13 émulé, base locale)** : liens destinataires exacts pour chaque action et chaque type de fiche ; aucune clé ni identifiant interne dans les liens, le partage natif, l’image ou son QR code ; encodage (accents, guillemets français, « & », « # », titre long) ; Share Dialog documenté quand un identifiant est configuré, et dans ce cas pas d’action de copie ; sans identifiant, aucun lien vers Facebook, copie de l’URL destinataire et consigne affichée, aucune fenêtre ouverte ; titre neutre réellement appliqué pour une adresse et une demande (nom, repère, nom du demandeur et référence absents des textes de l’image) ; photo non cochée par défaut ; aucune URL de gestion (`#/m/`, `#/edit/`, `#/k/`) ni URL privée du demandeur (`#/demande/`) dans les liens, l’image ou son QR code ; vue destinataire sans boutons sociaux ; partage natif absent, réussi, annulé, refusé (simulé) ; presse-papiers refusé ; export PNG réellement téléchargé, 1080 × 1920, QR décodé égal au lien (avec et sans photo, pour les trois types) ; photo non recadrée ; titres longs coupés sans dépasser ; formule neutre ; repli « appui long » ; thème sombre (contraste ≥ 4,5:1) ; clavier ; 320 px ; plus de panneau ni d’image pour un lien désactivé ou un rendez-vous expiré ; compteurs distincts sans donnée privée. Les adresses wa.me, t.me et facebook.com sont interceptées : **aucune publication réelle**. Non-régression : 35/35, 23/23, 20/20, 12/12, SQL 31/31.

**Ce qui n’est pas vérifié** : aucun test dans les vraies applications (WhatsApp, Telegram, Facebook, Instagram, TikTok), aucun téléphone physique, WebKit non exécuté pour ce lot. La page d’aide officielle TikTok sur le lien du profil n’a pas pu être lue : la consigne reste volontairement générale. Fiche de recette à remplir : `docs/RECETTE-TELEPHONES.md`.

**Pour le déploiement** : appliquer les 4 migrations (`./scripts/deploy.sh`). Facultatif : créer une application Meta (gratuite), y déclarer le domaine du site, puis renseigner son identifiant dans la variable de dépôt GitHub `FACEBOOK_APP_ID` (déjà lue par le workflow) pour remplacer la copie du lien par le Share Dialog documenté.

## 14. Périmètre gelé (15/10/2026, 11 h)

Le périmètre fonctionnel est **gelé** : adresse, demande d’adresse, rendez-vous, découverte, réutilisation, partage (natif, WhatsApp, copie, Telegram, Facebook par copie ou Share Dialog configuré, Instagram / TikTok par image et lien), installation facultative, mesure agrégée. Aucune nouvelle fonctionnalité avant le déploiement et la recette sur téléphones. Seules des corrections de défauts constatés seront faites.

**Ce qui est vérifié, et où**

| Niveau | État | Preuve |
|---|---|---|
| Automatisation locale, Chromium 141, iPhone 13 émulé, base Postgres locale réelle | Vérifié | SQL 31/31 ; suite complète 35/35 ; découverte 23/23 ; circuit 20/20 ; partage social 23/23 ; parcours de production rejoué en local 12/12 |
| Automatisation locale, WebKit | Partiel | 35/35 avant la découverte (Mac) ; pas réexécuté depuis : WebKit ne s’installe pas dans l’environnement de Claude et le Mac était hors ligne |
| Environnement déployé (URL publique, Supabase) | **Non vérifié** | Base non créée : facture Supabase en attente. `./scripts/deploy.sh` est prêt |
| Vraies applications sociales (WhatsApp, Telegram, Facebook, Instagram, TikTok) | **Non vérifié** | Aucune publication ni envoi réel ; liens et images contrôlés par automatisation uniquement |
| Téléphones physiques | **Non vérifié** | `docs/RECETTE-TELEPHONES.md`, toutes les cases vides |

**Ordre de mise en production** : 1) régler la facture Supabase ; 2) `./scripts/deploy.sh` (migrations, droits, Pages, parcours de production Chromium + WebKit) ; 3) remplir `docs/RECETTE-TELEPHONES.md` ; 4) corriger seulement les défauts trouvés ; 5) avant tout utilisateur réel ou test avec de vraies adresses : désigner le responsable du traitement et confirmer avec la CDP la formalité applicable (déclaration, art. 18, et transfert vers un pays tiers, art. 49 à 51 ; voir `CONFORMITE-CDP.md`).
