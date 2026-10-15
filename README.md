# Fii La

**Ton adresse, expliquée une seule fois.**

Fii La permet d’expliquer où arriver quand une adresse postale ne suffit pas : un point d’entrée confirmé sur une carte, une photo de la porte, un repère, et si besoin un point d’arrêt voiture distinct de l’entrée. La fiche se partage par un lien, s’ouvre sans compte ni installation, et renvoie vers Google Maps pour l’itinéraire.

Fii La complète les applications de navigation. Ce n’est ni une adresse postale officielle, ni un moteur d’itinéraire.

## Parcours
- **Créer mon adresse** : point d’entrée (position GPS ou carte), arrêt voiture distinct, photo, repère, aperçu, lien de partage.
- **Partager** : lien, message WhatsApp préparé, QR code, partage natif quand le téléphone le permet.
- **Fiche destinataire** : photo, repère, « Arrêt voiture » puis « Entrée », itinéraire Google Maps, coordonnées copiables.
- **Demander une adresse** : un commerçant ou un livreur envoie une demande, le client répond avec sa fiche, seul le demandeur voit la réponse.
- **Rendez-vous** : fiche de lieu temporaire qui cesse d’afficher le lieu à la date choisie.
- **Découverte** : après la fiche reçue, un bloc discret propose de créer sa propre adresse ou son rendez-vous, avec retour vers la fiche.
- **Réutilisation** : réouvrir et repartager une fiche, « Créer un rendez-vous similaire », relancer une demande expirée.
- **Gestion** : modifier (même lien), désactiver, nouveau lien, supprimer, clé de gestion pour un autre téléphone.

## Architecture
| Élément | Choix | Pourquoi |
|---|---|---|
| Front | HTML/CSS/JS sans framework ni build (`web/`) | Page destinataire légère sur réseau lent, aucune chaîne de build à maintenir |
| Hébergement | GitHub Pages (`.github/workflows/pages.yml`) | Gratuit, HTTPS, déploiement à chaque push |
| Données | Supabase Postgres, schéma privé `fiila` | Les tables ne sont jamais exposées par l’API |
| API | Fonctions SQL `public.fiila_*` (`security definer`), appelées en POST | Vérification des jetons, validation, révocation et expiration appliquées côté serveur |
| Photos | Dans la même ligne que la fiche (≤ 400 Ko) | Suppression et révocation immédiates, aucune URL publique permanente, aucun bucket à sécuriser |
| Carte | Leaflet + tuiles OpenStreetMap, chargés seulement pendant la création | Licence ouverte, page destinataire sans carte |

## Sécurité, en bref
- Deux jetons par fiche : un **jeton de partage** (128 bits, dans le lien) et un **jeton propriétaire** (256 bits, gardé sur le téléphone, stocké haché côté serveur). Le lien de partage ne donne jamais de droit de gestion.
- Les réponses aux demandes d’adresse ne sont lisibles qu’avec le jeton du demandeur.
- Photos réduites et réencodées dans le navigateur (métadonnées GPS retirées) ; le serveur refuse tout fichier qui n’est pas une image ou qui contient encore un bloc EXIF.
- Limite de créations par adresse IP (empreinte salée, effacée après 24 h). Mesure agrégée anonyme (compteurs journaliers sans identifiant, signal « ne pas suivre » respecté), voir `docs/LIVRAISON.md` section 11.

## Développer et tester en local
```bash
npm install
npm run test:sql      # 30 tests de l'API SQL sur un vrai Postgres (PGlite)
npm run test:e2e      # parcours complets dans Chromium, format iPhone 13
npm run test:discovery # découverte destinataire → créateur, installation, mesure
npm run test:circuit  # circuit complet : partage, réouverture, rendez-vous similaire, brouillons
npm run dev           # http://127.0.0.1:8787
```
Les tests E2E utilisent uniquement des données synthétiques et suppriment ce qu’ils créent.

## Déployer
Voir `docs/LIVRAISON.md`, section « Déploiement et retour arrière ».

## Licences des composants
Leaflet (BSD-2), qrcode-generator (MIT), Montserrat (SIL OFL 1.1), données cartographiques © contributeurs OpenStreetMap (ODbL).
