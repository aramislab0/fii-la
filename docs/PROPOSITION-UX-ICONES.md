# Proposition : interface plus simple, guidée par les icônes

> 18/10/2026. Document interne. **Validée par le fondateur le 18/10 21:18 (« je valide tout et ajoute le repère vocal ») et appliquée le soir même** (§ Réalisé). Maquette : `docs/screenshots/proposition-icones.png` (accueil, partage, fiche reçue, boutique).

## Constat
- **Trop de boutons au même niveau.**
  - La page de partage en compte 7 (WhatsApp, copier, Telegram, Facebook, Instagram, TikTok, partage natif), suivis de 4 lignes.
  - La commande en a 6.
  - Le code de l'application contient 161 boutons ou liens-boutons.
- **Tout passe par le texte.** Les seules icônes sont celles des réseaux sociaux et quelques flèches. Une personne qui lit difficilement doit tout déchiffrer.
- **Les états se lisent surtout par des mots.** Les puces ont une petite icône, mais l'essentiel est écrit : « Adresse attendue », « En route », « Livrée ».

## Principes proposés
1. **Une icône + un mot.** Chaque action a un pictogramme clair et un mot court (« Envoyer », « Copier », « Y aller », « Appeler »). Jamais d'icône seule, sauf pour « Plus » (trois points). Jamais de phrase sur un bouton.
2. **Par écran : 1 grande action, 2 à 4 raccourcis ronds, le reste en lignes.**
   - La grande action est un bouton vert avec icône.
   - Les raccourcis sont des icônes rondes avec leur mot dessous, comme dans les applications de paiement mobile que les gens connaissent déjà.
   - Les actions rares passent dans des lignes avec icône et chevron, ou derrière « Autres ».
3. **Les états en image.** Une pastille de couleur avec un pictogramme : épingle (adresse attendue), moto (en route), coche (livrée), horloge (en attente). On comprend sans lire.
4. **La photo avant le texte.** Une vignette de la porte dans les listes et en tête de la page de gestion. Sur la fiche reçue, la photo reste en grand.
5. **Les étapes du trajet en pictogrammes** (voiture, puis porte), et un seul bouton « Y aller » qui ouvre l'itinéraire. « Autre appli » pour Plans ou Waze.
6. **La confiance en une ligne avec un cadenas** : « Partagée par Awa · lien privé », « Seules les personnes qui ont le lien voient la fiche ».
7. **Boutique : barre d'onglets en bas.** Quatre onglets avec icône : Commandes, Articles, Clients, Plus. Les chiffres du jour sont accompagnés d'une icône.

## Icônes
- **Jeu de pictogrammes au trait arrondi**, dessiné pour Fii La dans le style de la maquette, ou repris d'une bibliothèque libre (Phosphor, licence MIT). Une trentaine d'icônes intégrées directement dans le code : aucune dépendance, aucun poids notable.
- **Logos de WhatsApp, Telegram, etc. :** à utiliser seulement avec les fichiers officiels de chaque marque et selon leurs règles. La maquette utilise des icônes génériques.

## Pistes pour les personnes qui lisent peu (fonctions, à décider)
- **Repère vocal.** L'expéditeur enregistre 15 secondes en wolof (« après la mosquée, le portail vert »). Le livreur appuie sur lecture. Effet probable : fort, puisque c'est le réflexe actuel sur WhatsApp. À prévoir : stockage audio (environ 100 Ko par fiche), mise à jour du dossier CDP.
- **Lecture à voix haute** des instructions en français (synthèse vocale du téléphone, gratuite). Le wolof n'est pas disponible de cette façon.
- **Interface en wolof.** Interdit par le design system v1.1 (« Ne pas traduire en wolof ») : décision à rouvrir par le fondateur si souhaité.

## Textes touchés par la maquette (à valider)
- Accueil : « Votre adresse, en une photo. » au lieu de « Ton adresse, expliquée une seule fois. »
- Fiche reçue : « Y aller » et « Autre appli » au lieu de « Itinéraire », « Ouvrir dans Plans », « Ouvrir dans Waze ».
- Partage : « Copier », « Story », « QR code », « Autres » sous les icônes.

## Ordre d'exécution proposé
1. Jeu d'icônes, composants « grande action avec icône », « raccourci rond », « ligne avec icône », « pastille d'état ».
2. Accueil, partage, fiche reçue (les 3 écrans les plus vus).
3. Boutique avec barre d'onglets, commande, facture, espace livreur.
4. Le reste. Tests complets, captures en clair et en sombre.

## Réalisé (18/10/2026)
- Jeu de pictogrammes Fii La (trait arrondi, une trentaine) dans `ICONS` ; composants `iconBtn`, `roundBtn`, `iconRow`, `statePill`.
- **Accueil** : grande action « Créer mon adresse » (appareil photo), 4 raccourcis (Demander, Rendez-vous, Boutique, Livreur), adresses en cartes avec vignette de la porte (gardée sur le téléphone), « Envoyer » et « Copier », « Inviter un proche ».
- **Partage** : « Envoyer sur WhatsApp » en grand, raccourcis ronds Copier, Telegram, Story, QR code (ou TikTok), Autres (Facebook, TikTok, partage du téléphone) ; ligne cadenas.
- **Gestion** : vignette, lignes avec icône (Modifier, Voir comme le destinataire, Livraison et étiquette, Clé de gestion), actions sensibles en bas.
- **Fiche reçue et course** : étapes en pictogrammes (voiture, porte), « Y aller », « À pied jusqu'à l'entrée » s'il y a un arrêt, « Autre appli » (Plans, Waze), ligne « Lien privé ».
- **Demande reçue** : « Votre adresse ira uniquement à X. Vous pourrez la retirer à tout moment. » remplace l'avertissement.
- **Boutique** : barre d'onglets (Commandes, Articles, Clients, Réglages ; « Réglages » plutôt que « Plus », plus clair), commandes avec pastille d'état et montant, chiffres du jour avec pictogramme, « Annuler la commande » en action sensible.
- **Icônes sur les boutons d'action** : photo, position, course, appel, livré, facture, impression, paiement, etc.
- **Repère vocal** : migration `20261018100000_fiila_voice` (audio ≤ 400 Ko, format vérifié par signature, 30 s au plus), enregistrement dans l'étape 3 de la création et en modification (refaire, retirer), écoute par le destinataire (chargée seulement au toucher) et par le livreur de la course. Tests : `voice.sql.test.mjs` (6), `voice.test.mjs` (5, micro simulé). Mention ajoutée à la page Confidentialité ; **à ajouter au dossier CDP**.
- Pas fait : appel direct depuis la fiche reçue (la fiche ne contient pas de numéro), logos officiels des marques, interface en wolof.
