# App mobile Fii — Android et iPhone

> v1, 26/10/2026, Builder (Claude Code). Demande du fondateur du 26/10 (15:42) : « la version native mobile Android et Apple, avec toutes les fonctions, optimisée pour chaque version, en respectant le design system et tout ce qui a été validé ». Ensuite : fournisseur de Fii Studio, puis paiements Orange Money et Wave.

## 1. Décisions (fondateur, 26/10)

| Décision | Conséquence |
|---|---|
| **App native construite sur la base validée** (Capacitor), pas deux réécritures | Mêmes écrans, design system, logique et tests que le web ; coquille native Android et iPhone ; fonctions natives là où elles changent l'usage |
| **Abonnement et packs Studio vendus sur le web** (Orange Money, Wave) ; l'app débloque ce qui a été payé | Règles Apple (3.1.1, hors États-Unis) et Google : pas de bouton ni de lien d'achat d'un contenu numérique dans l'app. Les **produits physiques** des boutiques se paient dans l'app (Wave, Orange Money) |
| **`fii.app` acheté maintenant** | Retour automatique dans l'app après Wave (lien https vérifié), connexion, liens partagés |

Décision antérieure conservée (#60, 21/10) : l'argent d'une commande va **directement à la boutique** (son Wave ou son Orange Money). Le compte marchand Orange Money d'Aramis Lab encaisse les abonnements et les packs. Tout flux où l'argent d'un tiers transite par Aramis Lab demande un avis juridique avant construction.

## 2. Ce qui est construit

| Pièce | Où | Rôle |
|---|---|---|
| Projet mobile | `mobile/` (`capacitor.config.json`, `android/`, `ios/`) | Identifiant `app.fii` (définitif une fois publié). Android 7+ (API 24), cible API 36 ; iPhone iOS 15+, iPhone seul (pas d'iPad, donc pas de captures iPad à fournir) ; portrait |
| Construction | `mobile/scripts/build-www.mjs` | Copie `web/`, compresse comme en production, écrit une configuration propre à l'app (pas de service worker, adresse publique pour les liens) |
| Icônes, démarrage | `mobile/scripts/icons.mjs` | À partir des icônes validées (`web/icons`) : icône adaptative Android, icône iPhone 1024, écran de démarrage vert Fii |
| Pont natif | `web/app.js` (bloc « application mobile ») | Inactif sur le web. Dans l'app : partage natif avec images, stockage recopié, bouton retour, liens externes, liens Fii, retour haptique, aucun achat numérique |
| CI | `.github/workflows/mobile.yml` | APK de test Android à chaque envoi ; bundle signé Google Play dès que la clé d'envoi est fournie ; app iPhone compilée pour le simulateur (macOS) |
| Mesure | migration `20261026100000_fiila_app_mobile.sql` | Ouvertures de l'app par plateforme (anonymes) |
| Back-office | Croissance → ligne « App mobile » | Ouvertures Android et iPhone sur 30 jours |

### Optimisé pour chaque plateforme

| | Android | iPhone |
|---|---|---|
| Retour | Bouton retour : ferme la feuille ouverte, sinon écran précédent ; à l'accueil, l'app passe en arrière-plan (pas de sortie brutale) | Geste et flèches de l'app (inchangés) |
| Partage | Feuille de partage Android avec l'image (Instagram, Facebook, WhatsApp, TikTok, Snapchat) — la WebView Android n'a pas de partage web | Feuille de partage iOS avec l'image |
| Liens externes | WhatsApp, Maps, Waze, réseaux : ouverts dans l'app concernée | Idem ; Google Maps par `comgooglemaps://`, sinon Plans |
| Bords d'écran | Bord à bord Android 15+ (encoche et barres gérées) | Encoche et barre d'accueil (zones sûres) |
| Démarrage | Écran de démarrage système Android 12+ aux couleurs de Fii | Écran de démarrage vert Fii |
| Autorisations | Position, appareil photo, micro : demandées au moment de l'usage | Textes d'autorisation en français |
| Stockage | Clés de gestion recopiées dans les préférences du téléphone (restaurées si la WebView est vidée) ; incluses dans la sauvegarde du téléphone | Idem |

## 3. Preuves

- `tests/native.test.mjs` (coquille native simulée, Chrome ; Safari en CI) : démarrage et mesure, restauration du stockage, bouton retour (écran, feuille, accueil), partage d'images (cache puis partage ; Instagram image seule, WhatsApp image + texte avec le lien public), liens externes et liens Fii, iPhone sans incitation à l'achat, web inchangé — **7/7**.
- APK de test Android construit ici (`app.fii`, versionCode 1, cible API 36, autorisations attendues).
- **Non vérifiable ici :** l'app sur un vrai téléphone (pas d'émulateur dans cet environnement) ; la compilation iPhone (macOS requis : faite par la CI).

## 4. Ce qui manque pour publier — accès du fondateur

| Accès | Coût | Délai | Pour |
|---|---|---|---|
| `fii.app` (Cloudflare) | 8,20 USD puis 14,20 USD/an (prix standard, à confirmer) | immédiat | Retour après Wave, liens https vérifiés (`assetlinks.json`, `apple-app-site-association`) |
| Google Play Console, compte organisation Aramis Lab | 25 USD une fois | numéro D-U-N-S + vérification, quelques jours | Publication Android |
| Apple Developer Program, organisation Aramis Lab | 99 USD/an | numéro D-U-N-S (1 à 2 semaines si absent) | Publication iPhone, liens universels |
| Clé d'envoi Android (créée par le fondateur, ou par le Builder dans la CI sans jamais l'afficher) | 0 | 10 min | Bundle signé ; secrets GitHub `ANDROID_UPLOAD_KEYSTORE_B64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` |
| Fiche store : politique de confidentialité (existe : `#/confidentialite`), captures, description, classification, formulaire « sécurité des données » | 0 | 1 jour | Revue Google et Apple |

## 5. Étapes suivantes

1. **Fondateur :** installer l'APK de test sur un Android et faire la recette (fiche `docs/RECETTE-TELEPHONES.md`, section App).
2. **Fondateur :** comptes Play et Apple ; achat de `fii.app`.
3. **Builder :** liens vérifiés (`.well-known`), bundle signé, test interne Google Play ; TestFlight pour iPhone (avec accord).
4. **Builder :** Fii Studio (fournisseur), puis paiements Orange Money (compte marchand Aramis Lab) et Wave (sortie vers Wave, retour automatique par `https://fii.app/#/paiement/…`, confirmation par le serveur de Wave, jamais par le retour seul).

## 6. Audit iPhone (26/10)

Voir `docs/AUDIT-APP-IOS-2026-10-26.md` : 7 défauts corrigés, optimisations proposées (notifications de commande, liens universels, premier écran plus rapide, publication plus rapide, hors ligne, Face ID).

## 7. Risques

- **Revue Apple (4.2, « fonctionnalité minimale ») :** une app qui affiche un site est refusée. Ici l'app est embarquée (fonctionne au démarrage hors ligne), avec partage natif, appareil photo, position, micro et liens universels. Risque faible, à surveiller à la première revue.
- **Abonnements :** si une incitation à acheter réapparaît dans l'app iPhone ou Android, refus. Garde-fou : `SELL_DIGITAL` est faux dans l'app ; tout futur écran d'achat d'abonnement ou de pack doit en dépendre (test `native`).
- **Identifiant `app.fii` :** impossible à changer après la première publication.
