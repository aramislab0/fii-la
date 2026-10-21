# Animation premium — contrat et recette

## Exigence du fondateur

Les images doivent être animées, dynamiques et premium. L'animation renforce le moment et la relation ; elle ne détourne pas de la lecture ou du clic. Une animation de caméra et une vidéo où les personnages bougent sont deux livrables différents.

## État livré dans ce kit

| Fichier | Mouvement réellement produit | État |
|---|---|---|
| `assets/animations/signature.mp4` | Rapprochement/retour lent, petit déplacement horizontal, lumière subtile ; texte stable | Essai à examiner |
| `assets/animations/commerce.mp4` | Même grammaire ; personnes/garment fixes | Essai à examiner |
| `assets/animations/evenement.mp4` | Même grammaire ; personnes fixes | Essai à examiner |

Chaque fichier : 5 s, 1200×800, 30 images/s, H.264, yuv420p, muet. Les contrôles locaux de décodage ont été exécutés ; aucune recette physique WhatsApp n'est déduite de cela. L'image animée n'a pas de bouton intégré.

## Version finale à produire avec gestes

Demander une animation courte de 5 s, presque documentaire. Garder le mouvement de caméra très discret ; un ou deux microgestes crédibles suffisent. Conserver la géométrie, les visages, les vêtements et objets ; ne pas inventer une action spectaculaire pour remplir cinq secondes.

Le modèle vidéo produit la scène **sans texte ni logo**. Les textes, informations et logo sont posés séparément en postproduction afin de rester nets, exacts et stables. Une typographie fixe peut coexister avec le mouvement d'ambiance. Le CTA reste natif dans WhatsApp et utilisable sans attendre la lecture du média.

### Prompt commun — utiliser la photographie correspondante comme image initiale

```text
Animate the supplied approved photograph into a five-second natural observational shot. Preserve exact identities, faces, body proportions, clothes, product/parcel, gate geometry, lighting direction and composition. Very restrained premium motion. No generated text or logo. No lip-sync, walk, handshake, face morphing, material changes, dramatic camera move, fake map animation or new objects. Leave the left copy area quiet and stable. Natural small movements only; hands and objects remain anatomically and physically coherent. End on a clean hold suitable for a subtle loop. If an invisible loop is not natural, deliver a clean ending instead of reversing a human action.
```

### Complément signature

```text
The woman gives a tiny natural head acknowledgement and breathes. The courier shifts his weight slightly while keeping the parcel stable. One small leaf cluster moves in a light breeze. Do not open/close the gate or transfer the parcel in this short shot. Camera nearly locked with a barely perceptible push-in. Preserve the moment of recognizing the right entrance.
```

### Complément commerce

```text
The merchant makes one small precise fabric-checking gesture with the fingers already touching the seam, then pauses. Preserve garment shape, weave, colour and stitching; do not transform or fold the product into another shape. Natural breathing, small eye movement toward the seam, minimal shoulder movement. No new packing sequence, changing label or invented tools. Camera quiet and steady.
```

### Complément événement

```text
The host gives a small welcoming head movement while her open hand settles naturally. The arriving friend breathes and shifts weight slightly without walking across the frame. Background friends have only subtle posture movement, never attention-grabbing gestures. Keep the gate still. Preserve eye contact, identities, daylight and the quiet feeling of welcome.
```

Utiliser un fournisseur/moteur et un budget déjà autorisés. Si manquant : BLOCKED_DEPENDENCY pour la vraie animation de gestes ; poursuivre gabarits, partage, destination et recette locale. Aucun tarif, modèle disponible, capacité ou coût n'est inventé par ce document.

## Paramètres de mouvement des pages Fii La

- Carte/entête : opacité et translation de 8 px, environ 240 ms, une seule fois.
- Repère : échelle .96→1 en environ 280 ms, sans rebond permanent.
- Contenu utile : apparition groupée ; pas de texte lettre par lettre ; CTA non retardé.
- Confirmation : seulement après événement métier confirmé.
- Avec réduction du mouvement : rendu immédiat, aucune information perdue. Pas de son automatique, flash, vibration imposée ou animation récurrente du bouton.

Ces timings sont des objectifs, pas des mesures de performance.

## Export et repli

- Priorité MP4 silencieux compatible avec le canal réellement retenu ; poster statique net et repli sans média.
- Garder la meilleure qualité sous le budget de poids vérifié sur appareil. Ne pas fixer un poids artificiellement garanti avant compression et contrôle.
- Vérifier le média en-tête et sa combinaison avec le bouton pour le format/API réellement utilisé. Ne pas promettre GIF animé dans les aperçus ni autoplay universel.
- La diffusion automatique éventuelle dans une page Fii La doit s'arrêter hors écran et respecter la réduction du mouvement. Les contrôles/politiques du navigateur et de WhatsApp restent applicables.
- Un ancien message n'affiche pas magiquement le statut actuel d'une commande ; la fiche liée est la source actuelle.

## Critères de réussite et preuves à livrer

1. Comparaison avant/après : mêmes personnes, objets, couleurs et architecture ; anatomie et gestes crédibles.
2. Texte/logo stables, lisibles dans l'aperçu réduit et après compression ; pas d'information erronée ou périmée.
3. Début/fin sans saut agressif ; boucle sans marche arrière visible d'un geste humain, ou fin propre signalée.
4. iPhone et Android physiques : affichage, téléchargement, lecture, partage, compression et ouverture de la bonne fiche.
5. Page destination utilisable avant lecture vidéo ; repli statique et réduction du mouvement opérationnels.
6. Aucune fuite d'adresse privée, clé de gestion, numéro ou vraie donnée client dans média, métadonnées ou capture de test.

Rapport : modèle/fournisseur réellement utilisé, conditions et budget autorisés, référence de source, prompts/paramètres observés, résultat, poids et durée mesurés, version, traces sans secrets, tests PASS/FAIL/NOT_RUN/BLOCKED_DEPENDENCY. La validation créative du fondateur et l'état technique sont distincts.

## Reconstruire les essais actuels

Avec Python 3 et FFmpeg/FFprobe installés, depuis le dossier extrait :

```bash
python3 scripts/render_motion.py
python3 scripts/render_motion.py --scene signature
```

Les fontes WOFF2 et les images nécessaires sont incluses. FFmpeg doit disposer de drawtext et de la lecture WOFF2 ; sinon utiliser une fonte TTF Montserrat équivalente conforme à la licence, en adaptant les chemins. Le script ne fait aucun appel réseau ou à une API payante. Il produit des essais de caméra, pas une génération de gestes.
