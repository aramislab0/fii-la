# Fii La — HANDOFF (état du projet en temps réel)

> Fichier de passation entre agents. **Mis à jour à chaque action** (code, déploiement, décision, test, doc).
> Règle : toute session qui modifie le projet met à jour « État actuel » et ajoute une ligne au « Journal » dans le même commit.
> Dernière mise à jour : **17/10/2026 21:40 (Dakar)** — commit de référence : voir `git log -1`.

## 0. Équipe et rôles

| Rôle | Qui | Responsabilité |
|---|---|---|
| Fondateur, décision finale | Assane (Mohamed Assane Niang, Aramis Lab) | Vision, arbitrages, validation finale, démarches externes (CDP, comptes, paiements) |
| VP produit | Agent VP | Valide l'alignement produit d'ensemble : besoin, parcours, priorités, cohérence avec la stratégie (Rali), qualité perçue. Ne code pas ; signale, tranche ou remonte au fondateur |
| Builder | Agent Claude Code (cette session) | Code, tests, déploiement, documentation, ce fichier |

Escalade : un désaccord VP ↔ Builder sur le produit remonte au fondateur, avec les deux options et une recommandation.

## 1. Produit en une phrase

Fii La permet d'expliquer **une seule fois** comment arriver à une entrée : point d'entrée confirmé sur une carte, photo de la porte, repère, point d'arrêt voiture si distinct. La fiche se partage par un lien, s'ouvre sans compte, et renvoie vers Google Maps (ou Plans sur iPhone) pour l'itinéraire. Usages : adresse permanente, rendez-vous temporaire, demande d'adresse (commerçant/livreur → client).

**Contexte stratégique (décisions du fondateur, prises hors de ce dépôt, 15–16/10/2026)** :
- Fii La est une commande d'un ami ; elle devient le **moteur d'adresse et de livraison du produit Rali** (« bon de commande WhatsApp par lien » pour vendeuses social commerce à Dakar). « Rali » = nom de travail, non validé pour lancement (antériorité à vérifier).
- Fii La pourra plus tard ramener ses utilisateurs pertinents vers Rali.
- **17/10 : Rali est intégré à Fii La** (comptes, carnet d'adresses, boutique, commandes, factures, clients, livraison, paiements saisis à la main). Architecture : `docs/ARCHITECTURE-RALI.md`. Paiement en ligne Wave / Orange Money : prévu, non activé.

## 2. État actuel (17/10/2026)

| Domaine | État | Preuve |
|---|---|---|
| Application | **En ligne** : https://aramislab0.github.io/fii-la/ | GitHub Pages, workflow `.github/workflows/pages.yml` |
| Base de données | Supabase, projet `fii-la` (`lkvulwocirttozfnyxck`), Paris `eu-west-3`, organisation « aramislab » (plan Pro, plafond de dépenses activé) | `docs/LIVRAISON.md` §1 bis |
| Fonction serveur | `fiila-resolve-maps` (lit les liens courts Google Maps, n'enregistre rien) | `supabase/functions/fiila-resolve-maps/` |
| Tests automatiques | Local : SQL 31/31, E2E 37/37, découverte 23/23, circuit 20/20, partage social 23/23, parcours 12/12. **Production** : E2E 37/37 Chromium et WebKit (17/10 18:45) | `tests/`, commandes §5 |
| Tests sur vrais téléphones | **Partiel** : le fondateur a testé sur son iPhone le 17/10 (retour positif, 2 défauts corrigés le jour même, re-test à faire) | `docs/RECETTE-TELEPHONES.md` (grille vide à remplir) |
| Conformité CDP | **Demande en cours**, déposée par le fondateur (17/10). Fiche descriptive art. 22 préparée | `docs/CONFORMITE-CDP.md` ; doc partagé « Fii La — Fiche descriptive du traitement (dossier CDP) » |
| Données réelles | Aucune ouverture publique. Base : uniquement les fiches de test personnelles du fondateur, aucune donnée de test automatique | — |
| Test terrain (5 chauffeurs, 30 arrivées) | **Non démarré** — attend le récépissé CDP | `docs/FICHE-TEST-TERRAIN.md` |
| Suivi en direct | **Livré (17/10)** : lien livreur + lien de suivi client (livraison), « Qui arrive » pour l'organisateur d'un rendez-vous. Heure d'arrivée estimée sur le téléphone, sans service payant. Dernière position seulement, effacée à l'arrivée | `supabase/migrations/20261017100000_fiila_tracking.sql`, `tests/tracking.test.mjs` |
| Comptes et boutique (Rali) | **En production (17/10 21:35)** : migration appliquée, `verify-db` 8/8 (6 migrations, 40 fonctions, schéma fermé). Inscription ouverte mais « Confirm email » actif avec l'envoi d'e-mails intégré de Supabase : seules les adresses de l'équipe reçoivent l'e-mail → réglage fondateur §4 #12 avant tout vrai commerçant | `docs/ARCHITECTURE-RALI.md`, `tests/accounts.sql.test.mjs` (21), `tests/shop.test.mjs` (19) |
| Interface | **Design system v1.1 appliqué** (Light + Dark, sélecteur de thème, 6 cartes, contrastes AA). Aucune coordonnée affichée. Audit UI/UX fait et corrigé le 17/10 | `docs/design-system/README.md`, `web/styles.css` |

## 3. Décisions en vigueur

| Date | Décision | Par |
|---|---|---|
| 15/10 | Construire de bout en bout sans validation par étape ; données synthétiques uniquement en test | Fondateur |
| 15/10 | Supabase + GitHub Pages ; aucun service payant sans accord | Fondateur |
| 15/10 | Périmètre fonctionnel gelé au commit `9576bc8` (aucune nouvelle fonction sans demande explicite) | Mandat fondateur |
| 15/10 | Ne pas affirmer qu'une autorisation CDP est requise ; formalité = déclaration (art. 18) + transfert (art. 49) à confirmer par la CDP ; Claude ne contacte pas la CDP | Mandat fondateur |
| 16/10 | Héberger dans l'organisation Supabase « aramislab » (Pro) ; la facture de l'autre organisation « AramisLab » reste à régler séparément | Fondateur |
| 17/10 | Corriger la position refusée et l'ouverture de Google Maps sur iPhone ; rendre l'import depuis Google Maps « très simple » (dérogation au gel demandée par le fondateur) | Fondateur |
| 17/10 | Abandon du comparateur Google Maps / Waze : la navigation reste dans Google Maps ou Waze (lien direct, gratuit) | Fondateur |
| 17/10 | Suivi en direct à coût zéro : livreur suivi par l'expéditeur et le client ; invités d'un rendez-vous suivis par l'organisateur seul, avec leur accord | Fondateur |
| 17/10 | Après validation de la version web, construction d'une application mobile native (suivi en arrière-plan fiable) | Fondateur |
| 17/10 | Ne plus afficher de coordonnées GPS à l'utilisateur (destinataire et création) : la complexité reste en arrière-plan | Fondateur |
| 17/10 | Tenir ce fichier HANDOFF à jour à chaque action ; un agent VP valide l'alignement produit | Fondateur |
| 17/10 | Intégrer tout le produit Rali dans Fii La : comptes (profil, photo, mot de passe), carnet d'adresses secret (maison, bureau, boutique), boutique (clients, commandes numérotées, factures, demande d'adresse, livraisons, paiements). Paiement Wave / Orange Money en dernier : prévu dans le modèle, non intégré | Fondateur |
| 17/10 | Compte facultatif : tout reste utilisable sans compte (clé de gestion). Connexion par e-mail + mot de passe (gratuit) ; pas de SMS (payant) | Builder, à confirmer fondateur |
| 17/10 | Design system v1 (Light + Dark) = référence de la refonte d'interface ; application par le Builder sans toucher aux parcours ni aux textes ; ajout d'un sélecteur de thème Clair / Sombre / Automatique (seule addition au périmètre) | Fondateur |

## 4. En attente / prochaines actions

| # | Action | Qui | Bloquant pour |
|---|---|---|---|
| 1 | Re-tester sur iPhone : « Utiliser ma position », « Depuis Google Maps » avec un **vrai** lien partagé, « Itinéraire » | Fondateur | Validation des correctifs du 17/10 (lien court réel jamais testé) |
| 2 | Communiquer l'identité et le contact du responsable du traitement déclaré à la CDP | Fondateur | Page confidentialité (art. 58), fiche art. 22 |
| 3 | Décider une durée maximale de conservation des adresses (proposition : 12 mois sans consultation ni modification) | Fondateur, avis VP | Art. 35 ; nécessite une petite évolution du code |
| 4 | Recette complète sur 3 téléphones (iPhone, Android, Android entrée de gamme) | Fondateur / testeur | Ouverture au test terrain |
| 5 | Test terrain réel | Après récépissé CDP | Décision de pilote élargi |
| 6 | Contrôle VP du design appliqué (captures Light/Dark dans `docs/screenshots/`) | VP | — |
| 9 | Signaler à la CDP le nouveau traitement « suivi en direct » (dossier en cours) avant usage avec de vrais livreurs | Fondateur | Usage réel du suivi |
| 10 | Alléger les textes de l'interface (retour fondateur du 17/10 : trop de petites indications) | Builder | Prochain test |
| 11 | Application mobile native, après validation de la version web | Builder, VP | — |
| 12 | Supabase → Authentication : Site URL et Redirect URL = `https://aramislab0.github.io/fii-la/` ; pour le pilote, désactiver « Confirm email » **ou** brancher un SMTP (Resend / Brevo, offre gratuite à confirmer) — sans SMTP, « mot de passe oublié » ne marche pas pour de vrais utilisateurs | Fondateur | Mise en production des comptes |
| 13 | ~~Appliquer la migration comptes/boutique en production~~ fait 17/10 21:35 | Builder | — |
| 14 | Ajouter au dossier CDP : comptes (e-mail, profil, photo), données clients des commerçants (nom, téléphone, commandes, paiements). Le commerçant est responsable de ses données clients | Fondateur | Usage réel des comptes |
| 15 | Paiement en ligne : choisir l'opérateur (Wave Business, Orange Money, agrégateur), coûts et contrat | Fondateur | Bouton « Payer » sur la facture |
| 17 | Tester sur iPhone : créer son compte (e-mail du fondateur), créer la boutique, une commande, ouvrir la facture sur un 2e téléphone, donner l'adresse, envoyer au livreur | Fondateur | Validation web avant app native |
| 16 | Revue VP de l'intégration Rali (parcours commerçant et client, `docs/screenshots/boutique/`) | VP | — |
| 7 | ~~Alignement Fii La ↔ Rali~~ → tranché le 17/10 : intégration (voir décisions) | VP → fondateur | Feuille de route | (quelles données, quel parcours, quel moment) | VP → fondateur | Feuille de route |
| 8 | Régler la facture de l'organisation Supabase « AramisLab » (autres projets) | Fondateur | Hors Fii La |

## 5. Comment vérifier (pour le VP ou tout agent)

**Sans outil** : ouvrir https://aramislab0.github.io/fii-la/ sur un téléphone ; créer une adresse de test ; partager ; ouvrir le lien sur un autre téléphone.

**Dépôt** : https://github.com/aramislab0/fii-la (public). Fichiers de référence :
- `README.md` : produit et architecture en bref
- `docs/LIVRAISON.md` : dossier de livraison, statut, limites (§6), mesure (§11)
- `docs/CONFORMITE-CDP.md` : données traitées, lecture de la loi 2008-12, questions ouvertes
- `docs/RECETTE-TELEPHONES.md`, `docs/FICHE-TEST-TERRAIN.md` : grilles de recette et de terrain
- `docs/screenshots/` : captures des parcours (générées par les tests)
- `docs/design-system/` : design system v1 Light + Dark (référence de la refonte)
- `web/app.js` : toute l'application ; `supabase/migrations/` : base et règles d'accès ; `supabase/functions/` : fonction serveur

**Commandes** (Node 20+) :
```bash
git clone https://github.com/aramislab0/fii-la && cd fii-la && npm install
npm run test:sql && npm run test:e2e && npm run test:discovery && npm run test:circuit && npm run test:social
FIILA_URL=https://aramislab0.github.io/fii-la/ node tests/e2e.test.mjs      # suite complète sur la production
```
Les tests créent puis suppriment des données synthétiques. Ne jamais lancer la suite de production pendant un test terrain réel.

**Accès réservés au fondateur** (ne pas demander de les copier dans un fichier ou une conversation) : tableau de bord Supabase, mot de passe de la base (`~/Projects/fii-la-ops/.env.ops` sur son Mac), compte GitHub.

## 6. Points de vigilance connus

- **Lien court Google Maps** : lecture validée sur des URL d'exemple et en simulation ; jamais sur un lien réel partagé depuis un téléphone.
- **Instagram / TikTok** : pas de partage de lien direct possible ; image verticale + QR code + consigne. Non testé dans les vraies applications.
- **Facebook** : sans identifiant d'application Meta, simple copie du lien.
- **Itinéraire iPhone** : ouvre l'application Google Maps directement ; si elle n'est pas installée, Safari affiche une erreur et Fii La propose Plans.
- **Conservation** : pas de durée maximale pour les adresses (écart art. 35, décision #3).
- **Nom** : « Fii La » n'est pas la marque de Rali ; ne pas investir dans l'identité de Fii La avant l'arbitrage Rali.

## 7. Journal (le plus récent en haut)

| Date (Dakar) | Action | Commit / preuve |
|---|---|---|
| 17/10 21:35 | Production : migration comptes/boutique appliquée (script `scripts/apply-migration.mjs`, transaction unique) ; `verify-db` 8/8 ; sondes anonymes (`fiila_me` → auth_required, facture inconnue → not_found) ; E2E production 38/38 Chromium et 38/38 WebKit ; parcours boutique 19/19 WebKit (Mac, local). Base de production : 3 fiches (fondateur ×2, Test VP), aucune donnée de test restante. Suite suivi : 1 échec ponctuel sous charge (attente d'arrivée), 12/12 au relancement | `inspect.sh`, journaux Mac |
| 17/10 21:10 | Rali intégré à Fii La : migration `20261017220000_fiila_accounts_shops` (comptes, profil, carnet étiqueté, boutique, clients, commandes, factures, paiements, livraison par commande), client Auth sans bibliothèque, écrans `#/compte`, `#/boutique`, `#/clients`, `#/commande/…`, facture `#/f/…`. Tests locaux : comptes/boutique SQL 21/21, parcours boutique 19/19 Chromium ; non-régression SQL 37, E2E 38, circuit 20, découverte 23, social 23. Note `docs/ARCHITECTURE-RALI.md`. Production : migration à appliquer | ce commit |
| 17/10 21:25 | Migration `fiila_tracking` appliquée en production (directement sur la base, le CLI Supabase du Mac restant bloqué) ; `verify-db` : 5 migrations, 20 fonctions, schéma fermé. Sonde de production des 6 fonctions de suivi : OK (données supprimées). E2E en production 38/38 Chromium et WebKit ; suite suivi 12/12 WebKit | journal de session |
| 17/10 21:10 | ~~En attente~~ (résolu à 21:25) : interface du suivi en ligne (GitHub Pages), mais migration `20261017100000_fiila_tracking` **pas encore appliquée** en production. Le CLI Supabase du Mac reste bloqué (probable fenêtre Trousseau macOS) ; l'application via le connecteur Supabase a été annulée côté fondateur. Les boutons de suivi échouent en production tant que la migration n'est pas appliquée | journal de session |
| 17/10 21:00 | Suivi en direct : migration `fiila_tracking` (table `trackers`, 6 fonctions), pages livreur `#/l/…` et suivi `#/s/…`, « Envoyer au livreur » (demande reçue) et « Faire venir un livreur » (adresse), « Prévenir l'organisateur » et « Qui arrive » (rendez-vous), bouton Waze. Tests locaux : SQL 37, E2E 38, circuit 20, découverte 23, social 23, suivi 12, parcours 12 | `6330f09` |
| 17/10 20:05 | Production après refonte : E2E 38/38 Chromium et 38/38 WebKit sur l'URL publique. Base : fiche du fondateur + une fiche « Test VP » créée par l'agent VP (à supprimer par lui) | journal de test sur le Mac |
| 17/10 19:55 | Design system v1.1 appliqué (tokens Light/Dark, `theme.js`, sélecteur Clair/Sombre/Automatique, icônes de puces et d'états, étapes avec pictogrammes, confirmation destructive pleine, fiche en 2 colonnes sur ordinateur). Coordonnées retirées de l'interface. Audit UI/UX : libellés d'itinéraire raccourcis (« Itinéraire en voiture / à pied »), une seule action principale à l'étape carte, photo de rendez-vous en bouton secondaire, lien de partage sur une ligne. Tests locaux : SQL 31, E2E 38, découverte 23, circuit 20, social 23, parcours 12 | `e3628db` |
| 17/10 19:40 | Design system v1.1 Light + Dark versé dans `docs/design-system/` (tokens CSS/JSON, composants sur les classes existantes, brief d'exécution, script de contrastes : 31/31 couples AA). v1.1 spécifie les fonctions du 17/10 : coordonnées repliées, Plans iPhone, Découverte, partage multi-canaux et panneau Instagram/TikTok, installation, position refusée, « Depuis Google Maps ». Code applicatif non modifié | `e3628db` |
| 17/10 18:55 | Création de ce fichier HANDOFF, règle de mise à jour (`CLAUDE.md`), prompt de l'agent VP (`docs/PROMPT-VP.md`) | `8cad411` |
| 17/10 18:50 | Nettoyage des données de test laissées par un test interrompu (fiche réelle du fondateur conservée) | base : 1 fiche |
| 17/10 18:45 | Suite complète en production : 37/37 Chromium et WebKit | journal de test sur le Mac |
| 17/10 18:40 | Correctifs iPhone : itinéraire par l'application Google Maps (plus de détour App Store) + Plans ; aide pas à pas si la position est refusée ; import « Depuis Google Maps » (lien partagé → point) ; fonction `fiila-resolve-maps` déployée | `ba1352e`, `9dc41a5`, `9d02c77` |
| 17/10 18:32 | Retour fondateur après test iPhone : bon accueil ; position refusée ; Google Maps → App Store → cul-de-sac | message fondateur |
| 17/10 18:20 | Page « Données et confidentialité » complétée (art. 58) ; fiche descriptive art. 22 créée (doc partagé) | `3419094`, `9c1b54f` |
| 17/10 18:14 | Fondateur : demande CDP en cours | message fondateur |
| 16/10 22:45 | Déploiement en production ; correction d'un test (course réseau) ; 35/35 Chromium et WebKit | `0d09efe`, `78c31df`, `3efd09f` |
| 16/10 22:30 | Choix de l'organisation Supabase « aramislab » (Pro) après échec du paiement sur la mauvaise organisation | décision fondateur |
| 15/10 | Correction de la documentation CDP (autorisation non établie) | `3be271e` |
| 15/10 | Partage social, circuit de réutilisation, découverte, gel du périmètre | `188a7dc`, `dcc6554`, `909b011`, `9576bc8` |
| 15/10 | Première version : API SQL sécurisée, application web, tests | `3fe7585` |
