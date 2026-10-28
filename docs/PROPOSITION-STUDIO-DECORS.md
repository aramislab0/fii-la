# Proposition : coûts du Studio, formats, bibliothèque de décors

> Document interne, 28/10/2026. Réponse à la demande du fondateur du 28/10 au soir : renseigner les coûts de génération (le VP fixe les prix officiels), donner les formats du Studio, préparer une bibliothèque de 15 décors par catégorie, donner l'avis du Builder et demander celui du VP. **Rien n'est construit ni dépensé avant la validation du fondateur.**
> Coûts vérifiés sur les pages fal (27 et 28/10) et mesurés en production et aux bancs d'essai. Conversion indicative : **1 USD ≈ 600 FCFA** (même convention que `PROPOSITION-SITES-STUDIO-ASSISTANT.md`), à confirmer au moment de fixer les prix.
> Les recettes de décor (prompts, règles d'éclairage) sont propriétaires : elles restent dans le dépôt privé XEL (`Production/FII_STUDIO/`), jamais ici.

## 1. Verdict du Builder

**La bibliothèque de décors est une bonne idée pour la qualité, la cohérence et l'apprentissage. Elle ne fera presque pas économiser.**

- Le coût d'une série vient de l'**image générée**, facturée à l'image (0,04 USD), pas du texte du prompt. Un décor préparé à l'avance ne supprime pas cet appel : chaque produit doit encore être placé dans son décor, avec sa lumière et son ombre.
- L'économie réelle vient du **taux de versions gardées** : un bon décor évite les « Autre proposition ». Une bibliothèque mesurée et triée par l'usage améliore ce taux.
- Une vraie baisse de coût (2 à 3 fois) n'est possible qu'avec une composition sans génération (détourage + décor + ombre calculée). Notre essai du 27/10 l'a fait échouer en l'état (produit déplacé, lumière qui jure). À re-tester avant de le promettre.

## 2. Coûts de génération (pour fixer les prix)

### 2.1 Coût par série, en production depuis le 28/10

Une série = une image. La boutique ne paie des crédits que si elle **garde** la version ; une série refusée coûte à Fii mais rien à la boutique.

| Mode vu par la boutique | Catégories | Moteur | Coût fal | ≈ FCFA | Durée | Crédits si gardée |
|---|---|---|---|---|---|---|
| Fidèle | toutes sauf bijoux, restauration | Bria replace-background | 0,040 USD | 24 | ≈ 15 s | 1 |
| Fidèle | bijoux, restauration | FIBO 2.0 + masque (détourage 0,018) | 0,058 USD | 35 | ≈ 14 s | 1 |
| Premium | mode, couture (porté) | FIBO 2.0 sans masque | 0,040 USD | 24 | ≈ 9 s | 3 |
| Premium | objets, emballages, chaussures… | FIBO 2.0 + masque | 0,058 USD | 35 | ≈ 14 s | 3 |
| (retour arrière, `studio_fibo` = 0) | — | Nano Banana Pro 2K | 0,150 USD | 90 | ≈ 28 s | 3 |

Premium interdit pour bijoux, restauration, pâtisserie, fleurs ; Studio fermé pour coiffure, esthétique, services (pas de résultat inventé).

### 2.2 Coût par image **gardée** (le chiffre pour le prix)

Mesuré au comparatif du 28/10 (10 produits, XEL `bench/FIBO.md`) : coût ÷ part des images gardables.

| Moteur | Gardables | Coût par image gardée | ≈ FCFA |
|---|---|---|---|
| FIBO + masque | 8 / 10 | 0,073 USD | 44 |
| FIBO sans masque | 6 / 10 | 0,067 USD | 40 |
| Bria (fidèle) | 5 / 10 | 0,080 USD | 48 |
| Nano Banana Pro | 3 / 8 | 0,40 USD | 240 |

**Repère prudent pour le prix : ≈ 50 FCFA de coût par image gardée**, quel que soit le mode (échantillon de 10 produits : à revoir après un mois d'usage réel, le back-office compte séries et versions gardées).

### 2.3 Marge brute selon le prix d'un crédit (à décider par le VP et le fondateur)

Coût retenu : 48 FCFA par image gardée en fidèle (1 crédit), 44 FCFA en premium (3 crédits).

| Prix d'un crédit | Fidèle (1 crédit) | Premium (3 crédits) |
|---|---|---|
| 50 FCFA | 2 FCFA (4 %) | 106 FCFA (71 %) |
| 100 FCFA | 52 FCFA (52 %) | 256 FCFA (85 %) |
| 150 FCFA | 102 FCFA (68 %) | 406 FCFA (90 %) |
| 250 FCFA | 202 FCFA (81 %) | 706 FCFA (94 %) |

Non compris : frais de paiement (Wave, Orange Money), variation du dollar (fal facture en USD), séries gratuites des essais partenaires. Le prix d'un crédit en FCFA **n'existe pas encore** dans Fii : les crédits sont aujourd'hui accordés par le back-office (30 offerts à Maison OUMY) ou inclus dans les packs partenaires.

### 2.4 Coûts fixes, plafonds et dépense réelle

- **Plafonds actuels** : budget du Studio 10 USD par mois (`studio_budget_usd`, au-delà le Studio se met en pause) ; 10 séries par boutique et par jour (`studio_daily`).
- **Dépense réelle en production** au 28/10 : 0,21 USD (2 séries, 1 gardée).
- **Recherche et essais** (hors production) : ≈ 11,5 USD au total (bancs du 27/10 : 3,8 + 4,8 ; comparatif FIBO du 28/10 : 2,88).
- **Sans coût par image** : stockage de la photo gardée (Supabase, ≈ 150 à 280 Ko), miniature des grilles (fonction de Fii), dépôt temporaire sur le stockage de fal.
- **Pas en production** : vidéo (MiniMax H3 Max, 0,08 à 0,40 USD le clip de 5 s, prix exact à confirmer).

## 3. Formats et ratios (vérifiés dans le code)

| Usage | Ratio | Dimensions | Où |
|---|---|---|---|
| Photo d'article (stockée) | 4:5 portrait | **864 × 1080**, JPEG ≤ 300 Ko, recadrée au centre | `web/app.js` (PHOTO_RATIO 0,8, PHOTO_H 1080) ; contrôle du ratio par la base (± 2 %) |
| Miniature des grilles | 4:5 | 512 × 640 | `fiila-media-sync` |
| Sortie Bria (fidèle) | celui de la photo | taille de la photo | fal |
| Sortie FIBO + masque | celui de la photo | taille de la photo | fal |
| Sortie FIBO sans masque | 4:5 | ≈ 896 × 1120 (≈ 1 Mpx) | fal |
| Sortie Nano Banana Pro (retour arrière) | 4:5 | 1856 × 2304 (2K) | fal |
| Publier : publication | 4:5 | 1080 × 1350 | `productVisual` |
| Publier : Story / Statut | 9:16 | 1080 × 1920 (photo + cadre Fii) | `productVisual` |

**Conséquence pour les prix :** toute version gardée est ramenée à 864 × 1080. Le rendu 2K n'apporte rien aujourd'hui ; FIBO à ≈ 1 Mpx suffit.

### Format demandé pour chaque image de décor

- **Maître 4:5, 1024 × 1280 px** (≥ 1 Mpx), JPEG qualité ≥ 85, sRGB.
- **Décor vide** : sans produit, sans texte, sans logo ni marque, sans personne.
- **Zone du produit** : centre, tiers inférieur, prévue pour un produit qui occupe 40 à 60 % de la hauteur.
- **Point de vue proche d'une photo de téléphone** (hauteur des yeux à 30° en plongée) : en mode fidèle, le produit garde sa perspective d'origine, le décor doit s'y accorder.
- Si l'outil ne fait pas de 4:5 (ChatGPT : 1024 × 1536), recadrer au centre en 1024 × 1280.
- Variante 9:16 (1080 × 1920) : pas maintenant (les Stories sont composées par Fii à partir de la photo 4:5).

## 4. La bibliothèque : ce qui existe et ce qui est proposé

**Existe déjà (27/10)** : 82 décors actifs, environ 6 par catégorie (13 catégories + 5 génériques), chacun avec sa recette (décor, lumière nommée, matières) dans les packs v0.2.0 de XEL, chargés dans la base. Fii compte déjà, par décor, les séries et les versions gardées (back-office → Studio → « Décors par catégorie »), et met en tête, pour chaque boutique, les décors qu'elle garde le plus. L'export quotidien vers XEL est écrit mais **inactif tant que la PR XEL #130 n'est pas fusionnée** (décision du fondateur).

**Proposé** : 15 décors par catégorie où le Studio génère, soit **13 catégories × 15 = 195 décors** (≈ 113 nouveaux). Pas de décors pour coiffure, esthétique, services (Studio fermé).

### Fiche d'un décor (une par décor, dans XEL)

| Champ | Contenu |
|---|---|
| `id`, `version`, `statut` | ex. `chaussures-p7`, v1, PROPOSED → ACTIVE → RETIRED |
| `categorie`, `usages` | catégorie Fii ; produits adaptés (ex. « sandales, mules ; pas de bottes ») |
| `nom`, `teinte` | nom français court (carte du choix) ; couleur dominante (hex) pour la pastille |
| `apercu` | image du décor vide, 1024 × 1280 (ci-dessus) |
| `prompt` | description du décor en anglais pour le moteur |
| `lumiere` | direction de la lumière principale, douceur, température (K), contraste, ombre (portée, de contact), reflets |
| `palette` | 3 à 5 couleurs (hex), saturation, ambiance |
| `surface`, `accessoires` | matière du support ; accessoires permis (sans concurrencer le produit) |
| `camera` | hauteur, angle, focale équivalente, profondeur de champ |
| `placement` | zone et taille du produit dans l'image |
| `compatibilite` | fidèle (masque) / premium ; « lumière proche d'une photo de téléphone » ou « re-éclairage nécessaire » |
| `interdits` | ce qui ne doit jamais apparaître (matériel d'éclairage visible, texte, autre produit, personne…) |
| `mesures` | séries, versions gardées, taux de garde (rempli par l'export quotidien) |
| `source`, `droits` | outil et date de génération ; droits commerciaux vérifiés |

## 5. Avis du Builder et recommandations

1. **Ne pas promettre d'économies.** Indicateur à suivre : le **taux de versions gardées par décor** (objectif ≥ 70 %), pas le nombre de décors.
2. **Écrire la lumière de chaque décor pour le mode fidèle.** Avec le masque, le produit garde ses pixels et donc la lumière du téléphone : un décor en contre-jour ou en spot dur ne s'accordera pas. Chaque fiche dit si elle est « compatible photo de téléphone » ou si elle demande un re-éclairage (Bria relight, à tester et chiffrer).
3. **L'image d'aperçu sert d'abord à la boutique**, pour choisir. Pour le moteur, la fiche (prompt et règles) compte plus que l'image : FIBO accepte jusqu'à 3 images de référence, mais **pas avec le masque**. L'image ne peut donc guider le moteur que pour les vêtements portés (premium sans masque). À tester sur ce cas.
4. **Garder les consignes structurées de FIBO** (VGL : décor, lumière, esthétique) d'une version gardée comme base réutilisable du décor : c'est la forme la plus fidèle d'une « règle de décor ».
5. **Règle d'interface « simple et intuitif »** : 15 cartes sur un téléphone, c'est trop d'un coup. Montrer 6 décors (ceux que la boutique garde le plus, puis les meilleurs de la catégorie) et le reste dans « Plus de décors ».
6. **Honnêteté de l'aperçu** : écrire « Aperçu du décor » ; le résultat garde le produit tel quel et peut différer de l'aperçu.
7. **Pilote avant les 195** : 15 décors pour 3 catégories d'abord (proposé : mode, chaussures, beauté), mesurés 3 à 4 semaines, puis extension. Chaque nouveau décor est essayé sur 2 produits synthétiques avant de passer ACTIVE ; un décor sous 40 % de garde après 20 séries est retiré (PROPOSED par le Builder, validé par le fondateur, comme le prévoient les règles du Studio).
8. **Coût de construction** à approuver : aperçus ≈ 0,03 à 0,04 USD l'image sur fal (113 nouveaux, avec un second essai : ≈ 10 USD) ; essai de chaque décor sur 2 produits (113 × 2 × 0,058 ≈ 13 USD). **Total ≈ 25 USD**, ou ≈ 5 USD pour le pilote de 3 catégories. Si le VP génère les aperçus lui-même (ChatGPT), seuls les essais sur nos moteurs restent à payer.
9. **Apprentissage** : il marche déjà dans Fii ; pour qu'il remonte dans XEL chaque jour, le fondateur doit fusionner la PR XEL #130 (le Builder n'a pas le droit de le faire).

## 6. Questions au VP

1. **Prix officiel d'un crédit** (FCFA) et prix du premium : faut-il rester à 3 crédits (décision du fondateur du 28/10) ou vendre le premium en prix séparé ? Packs de crédits (ex. 10, 30, 100) et remise ?
2. **Ordre des catégories** pour le pilote de la bibliothèque : mode, chaussures, beauté, ou autre ?
3. **Qui produit les 15 décors** : le VP (aperçus et fiches), le Builder (essais sur nos moteurs et chargement), le fondateur (validation) ? Format de livraison : la fiche du §4, dans XEL.
4. **Nombre de décors visibles** sur le téléphone : 6 + « Plus de décors », d'accord ?
5. **Seuils de l'apprentissage** : retirer un décor sous 40 % de garde après 20 séries, d'accord ? Mettre un nouveau décor en tête combien de temps pour qu'il soit essayé ?
6. **Objectif de marge** et plafond mensuel du Studio une fois les prix fixés (aujourd'hui 10 USD par mois, Studio en pause au-delà).

## 7. Ce qui attend le fondateur

- Valider ou corriger ce dossier après l'avis du VP.
- Approuver le budget de construction (≈ 5 USD pour le pilote, ≈ 25 USD pour les 195 décors).
- Décider de la fusion de la PR XEL #130 (export quotidien de l'apprentissage).

## Annexe — demande d'avis à transmettre au VP

Le Builder ne peut pas écrire directement au VP (ChatGPT). Bloc à copier dans sa session :

```
Tu es VP produit de Fii (dépôt public aramislab0/fii-la, branche main). Lis docs/HANDOFF.md, puis
docs/PROPOSITION-STUDIO-DECORS.md (coûts de génération du Studio, formats, projet de bibliothèque de
15 décors par catégorie, avis du Builder). Le fondateur veut : fixer les prix officiels du Studio, et
constituer une bibliothèque propriétaire de décors (aperçu + fiche avec prompt, lumière, teinte) qui
s'enrichit avec les préférences des boutiques.

Rends ton avis dans docs/REVUE-VP.md (format habituel : verdict ALIGNÉ / ALIGNÉ AVEC RÉSERVES /
NON ALIGNÉ, puis FAIT / ANALYSE / RECOMMANDATION / priorité), en répondant aux 6 questions du §6.
Pour les décors : si tu en proposes, respecte le format du §3 (4:5, 1024 × 1280, décor vide, sans
texte, marque ni personne) et la fiche du §4 ; ne mets aucun prompt ni aucune recette de décor dans le
dépôt public : livre-les au fondateur pour le dépôt privé XEL. Distingue ce que tu as vérifié, ce que
tu déduis et ce qui reste incertain. Ne prétends pas avoir testé une génération que tu n'as pas faite.
```
