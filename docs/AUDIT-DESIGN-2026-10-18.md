# Audit design : beauté, couleurs, formes, sentiment de sécurité et de calme

> 18/10/2026. Document interne. Rien n'est modifié.
>
> **Base de l'audit.** Captures à jour des suites de tests :
> - accueil et parcours de création ;
> - fiche reçue en clair et en sombre ;
> - demande d'adresse, facture et suivi ;
> - boutique, commande, livreur, parrainage.
>
> **Référence.** Design system v1.1, validé le 17/10. Les changements proposés ici le modifient. Ils deviennent une **v1.2, à valider par le fondateur**. Deux règles de la v1.1 sont touchées : le style des tuiles de carte et le poids des titres (signalés en §3).

## 1. Verdict

La base est saine :
- la palette est cohérente : vert profond, fond sable, accent citron ;
- les contrastes sont bons ;
- les zones tactiles sont larges ;
- aucun signe « fait par une IA » ;
- les pages reçues (fiche, demande, facture) sont déjà les plus réussies.

Ce qui empêche l'application d'être apaisante tient en trois points.

1. **Tout a la même forme.** Bouton, carte, tuile de chiffre, section dépliable et lien de navigation sont tous des rectangles blancs à bord gris. L'œil ne sait pas ce qui se touche, ce qui se lit et ce qui est dangereux. C'est la principale source d'hésitation.
2. **Trop de choses au même niveau.**
   - L'accueil propose 5 boutons de poids presque égal.
   - La page de gestion d'une fiche empile 9 rectangles.
   - Chaque page se termine par un pied lourd : thème et 5 liens.
   - Le calme vient de la retenue. Il manque ici.
3. **La sécurité est écrite, pas ressentie.**
   - Les messages de confidentialité existent, mais ressemblent à des avertissements : encadré vert, « Répondez seulement si vous attendez cette demande ».
   - « Supprimer » et « Annuler la commande » sont rangés à côté des actions courantes, à la même taille.
   - On ne voit jamais clairement « qui voit quoi » au moment d'envoyer.

## 2. Constats détaillés

| # | Écran | Constat | Effet sur la personne |
|---|---|---|---|
| D1 | Partout | Boutons secondaires, cartes, tuiles et sections dépliables ont le même rectangle blanc bordé (« Plus » et « Clé de gestion » ressemblent à des boutons ; les tuiles de chiffres aussi, cliquables ou non) | Hésitation, impression de formulaire administratif |
| D2 | Accueil | 5 actions de poids proche ; « Mes adresses » est un bouton qui répète la liste juste en dessous ; particulier, boutique et livreur sont mélangés | Choix difficile dès la première seconde |
| D3 | Gestion d'une fiche, commande | Deux actions principales de couleurs différentes (bouton citron « Préparer un message WhatsApp », bouton vert ailleurs) ; le citron sert tantôt d'action principale, tantôt de marque | On ne sait pas quel est « le » bouton |
| D4 | Gestion, commande, rendez-vous | « Supprimer », « Désactiver le lien » et « Annuler la commande » ont la même taille que « Modifier », juste à côté | Peur de mal faire |
| D5 | Pages du propriétaire | Le pied de page (sélecteur de thème et 5 liens) pèse autant que le contenu | Bruit visuel |
| D6 | Titres | Montserrat ExtraBold (800) en 28 px, avec beaucoup de petites capitales espacées (« ÉTAPE 1 SUR 4 », « MA BOUTIQUE », « COMMANDE N° », quartier en capitales) ; un titre long fait 3 lignes | Ton dur, administratif, pas apaisé |
| D7 | Création, étape 1 | Le bouton désactivé « C'est l'entrée » est un vert délavé proche du vert actif ; « Utiliser ma position » sélectionné ressemble à un bouton désactivé | « Est-ce que ça a marché ? » |
| D8 | Carte | Les tuiles OpenStreetMap d'origine (couleurs vives, beaucoup de libellés) jurent avec le fond sable | Rupture visuelle au moment le plus délicat (poser son point) |
| D9 | Messages éphémères | Le bandeau noir apparaît par-dessus les boutons (« Adresse enregistrée », « Merci pour votre note ») | Il masque l'action suivante et fait sursauter |
| D10 | Confiance | Une demande reçue dit « Répondez seulement si vous attendez cette demande ». Au moment d'envoyer, on ne voit pas « seule Boutique X recevra votre adresse ». Le lien de partage est présenté avec une mise en garde | Inquiétude plutôt que sécurité |
| D11 | Mouvement | Changements de page brusques, pas d'état « appuyé » visible, pas de confirmation douce après une action importante | Interface sèche, nerveuse |
| D12 | Couleurs annexes | Étoiles de note en brun-ocre, puces « Adresse attendue » en ocre, rouge de suppression vif : trois teintes chaudes qui n'existent nulle part ailleurs | Palette moins tenue |
| D13 | Sombre | Les cartes ont des bords marqués sur fond presque noir ; le vert d'itinéraire est plus vif qu'en clair | Plus dur que le thème clair |

## 3. Direction proposée : « calme et sûr »

**Principe.** Moins de formes, une seule action principale par écran, la sécurité montrée au bon moment.

### Trois formes, chacune avec un rôle
1. **Bouton = action.**
   - Action principale : pilule pleine verte, une seule par écran.
   - Actions secondaires : pilule à contour fin, ou lien texte.
2. **Carte = contenu à lire.** Fond blanc, sans bordure, ombre très douce, coins de 20 px. Une carte ne ressemble jamais à un bouton.
3. **Ligne de liste = navigation ou section dépliable.** Texte et chevron, séparateurs fins, sans boîte. Concerne « Plus », « Clé de gestion », les réglages, les chiffres cliquables.

Les tuiles de chiffres non cliquables deviennent du texte posé, sans boîte.

### Couleurs
- **Vert profond :** action principale et état « fait ».
- **Citron :** réservé à la marque et aux petits signaux positifs (numéro d'étape, « nouveau »). Il ne colore plus de bouton.
- **Une teinte « protégé »** pour toutes les mentions de confidentialité : sauge très pâle avec icône de cadenas. Elle remplace l'encadré vert d'avertissement.
- **Rouge :** seulement en texte, dans une zone « Actions sensibles » en bas de page. Jamais en bouton plein hors confirmation.
- **Notes et attentes :** l'ocre et le brun sont remplacés par l'encre et le vert. Étoiles pleines vertes ; « en attente » en gris chaud avec icône d'horloge.
- **Sombre :** bords des cartes retirés (fond légèrement plus clair à la place), vert d'action ramené au même ressenti qu'en clair.

### Typographie
- Titres en Montserrat 700 au lieu de 800 ; titre de page en 24–26 px au lieu de 28 ; interlignage plus ample.
- Petites capitales gardées seulement pour « Étape X sur 4 ».
- Quartier et numéros de commande en casse normale.
- **Touche le design system v1.1** : poids 800 validé.

### Carte
- Tuiles atténuées par un filtre CSS : désaturées, légèrement chaudes. Coût nul, aucun service ajouté.
- **Touche le design system v1.1**, qui dit « tuiles OSM non filtrées en Dark ». Le filtre serait plus doux en sombre qu'en clair, et la lisibilité des rues serait vérifiée.

### Sécurité ressentie
- **Ligne de confidentialité** (cadenas, une phrase, toujours au même endroit), sur chaque écran qui envoie quelque chose :
  - « Seule Boutique Awa recevra votre adresse. »
  - « Toute personne qui a ce lien voit la fiche. Vous pouvez le couper à tout moment. »
  - « Votre position est effacée à l'arrivée. »
- **Demande reçue** : on remplace « Répondez seulement si vous attendez cette demande » par l'identité de l'expéditeur mise en avant (nom, commande, date) et la ligne « Seule Boutique X recevra votre adresse ».
- **Après une action importante** (adresse envoyée, commande créée, boutique créée) : un écran ou un bloc de confirmation calme (coche, une phrase, l'étape suivante), plutôt qu'un bandeau noir furtif.
- **Actions sensibles** (désactiver, supprimer, annuler) regroupées en bas, en texte, avec confirmation.

### Mouvement et retours
- Transition de page de 150 ms (fondu et léger glissement). Désactivée si le téléphone demande de réduire les animations.
- État « appuyé » visible sur tous les boutons.
- Bouton désactivé : gris neutre clairement différent du vert actif.
- Messages éphémères en bas d'écran, au-dessus de la zone de sécurité, sans masquer de bouton.

### Simplifier les écrans chargés
- **Accueil :**
  - une action principale, « Créer mon adresse » ;
  - en dessous, « Demander une adresse » et « Créer un rendez-vous » en secondaires ;
  - puis la liste « Mes adresses » ;
  - « Ma boutique », « Espace livreur » et « Inviter un proche » regroupés dans une ligne « Pour les commerçants et livreurs ».
- **Gestion d'une fiche :**
  - en haut, « Partager » (WhatsApp en principal, copier le lien en secondaire) ;
  - puis les autres applications ;
  - puis une liste « Modifier · Voir la fiche publique · Clé de gestion » ;
  - en bas, la zone des actions sensibles.
- **Pied de page :** une ligne de liens (Fii La · Confidentialité · Compte). Le choix du thème passe dans « Mon compte » ou dans un réglage discret.

## 4. Plan d'exécution proposé (après validation)

| Lot | Contenu | Écrans |
|---|---|---|
| 1. Fondations | Jetons v1.2 (rôles des couleurs, teinte « protégé », titres 700, tailles), 3 formes (bouton pilule, carte sans bord, ligne de liste), états appuyé et désactivé, messages éphémères repositionnés, pied de page allégé | Tous (CSS surtout) |
| 2. Sécurité ressentie | Composant « ligne de confidentialité », demande reçue réécrite, confirmations calmes, zone « Actions sensibles » | Demande, création, gestion, commande, boutique, livreur |
| 3. Hiérarchie | Accueil simplifié, page de gestion réordonnée, tableau de bord boutique, une seule action principale par écran | Accueil, gestion, boutique, commande |
| 4. Carte et mouvement | Tuiles atténuées (clair et sombre), transitions douces, retouches du thème sombre | Création, fiche reçue, suivi |
| 5. Vérification | Contrastes AA (script existant), toutes les suites de tests, captures avant/après en clair et en sombre, test 320 px, revue VP | Tous |

**Garde-fous**
- Mêmes parcours et mêmes fonctions.
- Les textes changent seulement pour les lignes de confidentialité et la demande reçue (formulations ci-dessus, à valider).
- Aucune police ni dépendance ajoutée.
- Page reçue toujours aussi légère.

**Pour valider avant de tout appliquer :** le lot 1 et l'accueil du lot 3, avec des captures avant/après de 4 écrans (accueil, fiche reçue, gestion, demande reçue) en clair et en sombre.
