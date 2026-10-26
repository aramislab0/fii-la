# Audit de l'app iPhone — 26/10/2026

> Demande du fondateur (26/10, 17:17) : « audite l'application de bout en bout sur Apple, corrige les problèmes et potentiels bugs, propose des optimisations ».
> Fait par le Builder sur le simulateur du Mac du fondateur (iPhone 16 Pro, iOS 18.6), avec une version d'audit branchée sur une **base de test locale** (données synthétiques, aucune donnée réelle touchée). Le journal JavaScript et les appels natifs ont été lus pendant tout l'audit.

## 1. Verdict

L'app iPhone fonctionne de bout en bout : accueil, adresse, position, boutique, article avec photo, partage natif vers les réseaux, vitrine, commande, facture, réglages, mode sombre, retour depuis une app externe. **Aucune erreur JavaScript** sur les 25 écrans parcourus, **aucun débordement horizontal**.

L'audit a trouvé **8 défauts**, tous corrigés et couverts par des tests, dont **3 visibles par tout utilisateur d'iPhone** : une double demande de position au nom de « localhost », des listes déroulantes écrasées, et le contenu qui passait sous l'heure.

## 2. Défauts trouvés et corrigés

| # | Gravité | Constat (simulateur) | Correction | Preuve |
|---|---|---|---|---|
| 1 | **Bloquant** | Au premier démarrage, l'app restait bloquée sur l'écran vert : le noyau natif n'était pas chargé, donc le partage, la mémoire du téléphone et le bouton retour étaient absents. Même défaut dans le 1er APK Android | Noyau chargé avant l'application ; modules enregistrés à la demande ; l'écran de démarrage se masque seul après 1,5 s, même en cas d'incident | Accueil affiché ; commit `dbd9d3d` |
| 2 | **Majeur** | « Utiliser ma position » : une seconde demande « *localhost* aimerait utiliser votre position », à chaque usage, après celle d'iOS. Effet amateur, et un refus probable de l'utilisateur | Position par le module natif du téléphone : une seule demande, celle d'iOS, avec le texte Fii (« pour placer votre entrée sur la carte ») | Constaté avant et après sur le simulateur ; test `native` (position, suivi, arrêt du suivi) |
| 3 | **Majeur** | Listes déroulantes (type de commerce, catégorie) écrasées à 29 px avec le style système, à côté de champs de 52 px. **Aussi sur Safari iPhone (site web)** | Style unifié : 52 px, flèche du design system ; variante compacte dans le back-office | 52 px mesurés sur iPhone ; test `native` |
| 4 | **Majeur** | En faisant défiler, le contenu passait sous l'heure et l'encoche | Bande opaque aux couleurs du fond sous la barre d'état (clair et sombre) | Capture iPhone |
| 5 | Moyen | Titre repliable « Un agent Fii vous      aide ? » écarté au milieu (groupe insécable traité comme un élément séparé dans un conteneur flex). **Aussi sur le web** | Le texte et ses groupes insécables forment un seul bloc | Test `native` (anti-régression) |
| 6 | Mineur | Feuille de partage : le nom du fichier affiché était « 1793035553069-0-robe-photo-test » | Nom propre (« robe-photo-test.jpg ») dans un dossier unique par partage | Test `native` |
| 8 | Moyen | Flash blanc entre l'écran de démarrage et l'accueil (vu sur la version de production réinstallée) | Écran de démarrage masqué quand le premier écran est affiché (4 s au plus) ; fond de la WebView aux couleurs de Fii | Capture iPhone |
| 7 | Mineur | Liens du pied de page hauts de 19 px (cible tactile minimale d'Apple : 44 px) ; boutons + / − de la carte à 30 px | Zone de toucher de 44 px sans changer l'aspect ; boutons de carte à 44 px | Test `native` |

**Comportements d'app ajoutés :**
- **Geste retour iOS**, en glissant depuis le bord gauche. Compilé et branché ; à confirmer au doigt sur un iPhone, car le simulateur ne reproduit pas fidèlement le geste au bord.
- **Pas d'aperçu de lien** ni de menu « Copier » au toucher long sur les boutons, les liens et les images.
- **Session de connexion lue après la restauration du stockage** du téléphone : on n'est plus déconnecté si iOS a vidé la mémoire de la WebView.

## 3. Vérifié sans défaut

| Point | Résultat |
|---|---|
| Photo d'article | Menu natif iOS en français (Photothèque, Prendre une photo, Choisir les fichiers) ; image traitée, article créé, carte « Publier » affichée |
| Partage Instagram | Feuille de partage iOS avec l'image JPEG, « Enregistrer l'image » proposé ; texte copié dans le presse-papiers (vérifié) ; l'annulation est gérée sans message d'erreur |
| Lien WhatsApp | Ouvert hors de l'app (Safari dans le simulateur, l'app WhatsApp sur un téléphone) ; l'app garde son écran |
| Retour dans l'app par un lien `fii://` | Arrive sur le bon écran |
| Mode sombre | Couleurs et barre d'état correctes |
| Zones sûres | Barre d'onglets au-dessus de la barre d'accueil ; rien sous l'encoche |
| Clavier | Pas de zoom à la saisie ; barre « Terminé » d'iOS conservée (utile dans les formulaires) |
| Micro et appareil photo | Autorisés par la seule demande d'iOS (la WebView ne redemande pas) |

## 4. Non vérifiable sur le simulateur — à faire sur un vrai iPhone

- **Geste retour** au doigt.
- **Repère vocal** : le micro du simulateur passe par celui du Mac.
- **Appareil photo réel**.
- **WhatsApp et Instagram installés** : publication jusqu'au bout.
- **Performance** sur un iPhone ancien (iPhone 8 ou SE).
- **Liens universels** `https://fii.app` : ils demandent le domaine et le Team ID Apple.

## 5. Optimisations — validées par le fondateur (26/10, 18:07), état

| # | Optimisation | État |
|---|---|---|
| 1 | **Notifications de commande** (nouvelle commande, adresse reçue) | **Après les paiements**, comme prévu. Il faudra un projet Firebase (Android) et une clé APNs (compte Apple Developer), à créer par le fondateur |
| 2 | **Liens universels** `https://fii.app/…` ouverts dans l'app | **Préparé.** L'app déclare déjà `fii.app` (Android et iPhone). La CI écrit les fichiers de vérification dès que les variables `APPLE_TEAM_ID` et `ANDROID_CERT_SHA256` sont remplies. Le Worker sert le fichier iPhone en JSON (test). Actif quand `fii.app` sera en ligne |
| 3 | Premier écran plus rapide (sortir le back-office) | **Mesuré, puis écarté pour l'instant.** Le back-office ne représente que 18 % du code (138 Ko sur 758), pas 30 % comme estimé. Dans l'app, le code est lu sur le téléphone, sans téléchargement : gain faible pour une refonte risquée. À revoir si un iPhone ancien montre un démarrage lent pendant la recette |
| 4 | Publication plus rapide | **Écarté après analyse.** L'écriture de l'image et l'ouverture du partage partent dans la même fraction de seconde (journal natif) ; l'attente vient surtout d'iOS, qui prépare la feuille de partage. Rien d'utile à gagner côté Fii |
| 5 | **Lecture hors ligne** | **Fait.** Sans réseau, la boutique, les commandes, une commande, les articles et les clients s'affichent dans leur dernière version, avec « Hors ligne : affichage du … à … ». Lecture seule, aucune écriture ; jamais copié dans la sauvegarde du téléphone ni transféré d'une adresse à l'autre ; effacé à la suppression de la boutique et à la déconnexion d'une boutique liée au compte. Aussi sur le web. Test `native` |
| 6 | Verrou Face ID | **Plus tard, sur demande.** Utile seulement pour une boutique à plusieurs membres sur un même téléphone |

## 6. Méthode (reproductible)

- Serveur de test local sur le Mac (`FIILA_CORS=1 node tests/dev-server.mjs`), version d'audit de l'app branchée dessus. Cette version n'est jamais publiée ni commitée.
- Le journal JavaScript et les échanges natifs sont lus avec `xcrun simctl launch --console-pty`.
- Parcours de 25 écrans par script, avec pour chaque écran : erreurs JavaScript, débordement, cibles tactiles, risque de zoom. Gestes réels sur le simulateur pour la photo, le partage, la position et le mode sombre.
- Tests automatiques ajoutés : `tests/native.test.mjs` (8 tests, dont position native, nom de fichier partagé, hauteur des listes, cibles du pied de page, texte en flex).
