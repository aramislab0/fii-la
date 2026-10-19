# Proposition : Sites (vitrines en marque blanche), Studio IA, assistant d'achat, « Rendez-vous » rendu clair

> Document interne, 19/10/2026. Réponse à la demande du fondateur du 19/10 05:05. Rien n'est construit tant qu'il n'a pas validé.
> Prix vérifiés le 19/10/2026 (sources en fin de document). Conversion indicative : 1 USD ≈ 600 FCFA, à confirmer au moment du contrat.

## 1. Verdict

**Tout est faisable avec les outils disponibles aujourd'hui. Il ne faut pas tout construire en même temps.**

Il y a trois produits différents, avec trois clients et trois risques :

| Produit | Qui paie | Valeur perçue | Risque principal |
|---|---|---|---|
| **Studio IA** (retouche, pub, mannequins, motion) | La boutique | Très forte et immédiate : une vendeuse Instagram paie déjà un photographe | Un produit modifié par l'IA, donc une cliente trompée |
| **Site Pro** (son domaine, marque blanche) | La boutique | Forte pour les boutiques établies, faible pour une vendeuse WhatsApp | Coût d'hébergement et support des noms de domaine |
| **Assistant d'achat** (recommandations, recherche vocale) | Personne directement ; il augmente les ventes | Faible tant que le catalogue est petit | Profilage des personnes : CDP, consentement, confiance |

**Ordre recommandé**
1. Rendre « Rendez-vous » clair : petit travail, construit tout de suite.
2. Ajouter aux articles la catégorie, les tailles, les pointures et les couleurs. C'est un prérequis à tout le reste.
3. Studio IA niveau 1 : retouche fidèle et visuel publicitaire. C'est ce qui fera payer.
4. Site Pro.
5. Mannequins et motion.
6. Assistant, en dernier.

**Critère d'arrêt.** Si moins de 30 % des 25 boutiques fondatrices utilisent le Studio en 30 jours, on n'investit pas dans les mannequins ni dans la vidéo.

## 2. « Sites » : vitrine offerte, Site Pro payant

**Nom proposé :** **Sites**. Deux niveaux.

| | **Site** (offert) | **Site Pro** (payant, prix à fixer) |
|---|---|---|
| Adresse | `nom-boutique.<domaine-neutre>.sn` | Son propre domaine (`awacouture.sn`, `.com`…) |
| Marque Fii La | Une mention discrète en bas de page (voir décision 1) | **Aucune**, nulle part (titre, icône, partage, facture, e-mails) |
| Modèles | Les 3 actuels, 6 couleurs | Modèles avancés : polices, mise en page des sections, bannières, pages « À propos » et « Livraison », logo |
| Studio IA | Quelques crédits d'essai | Crédits inclus chaque mois |
| Divers | — | Statistiques de visites, lien Instagram et TikTok, pixel publicitaire (plus tard) |

**Décision 1 : la mention sur le site offert.** Tu as dit que Fii La ne se verra nulle part.
- **Recommandation : vrai pour le Site Pro.** Sur le site offert, une petite mention « Créé avec … » en bas de page.
- C'est le modèle de Shopify et Wix : le gratuit paie par la visibilité, ce qui fait venir les boutiques suivantes. C'est aussi une raison concrète de passer au Pro.
- Sans aucune mention, la vitrine cesse d'être une source d'arrivées. C'était pourtant une des boucles de croissance (CROISSANCE §3).

**Décision 2 : le domaine neutre.**
- Les sites offerts ont besoin d'un domaine qui ne soit ni « Fii La » ni le nom d'une boutique, par exemple une marque courte de commerce.
- Je propose 3 noms disponibles après vérification si tu valides le principe.
- Le même chantier règle l'action #22 (domaine dédié pour Fii La).

**Technique.** GitHub Pages ne sert qu'un seul domaine par site. Il faut donc passer les vitrines sur Cloudflare.
- Cloudflare for SaaS : **100 domaines de boutiques inclus**, y compris dans l'offre gratuite. Au-delà, **0,10 USD par domaine et par mois**, certificat HTTPS automatique.
- Une fonction Cloudflare reconnaît le domaine et affiche la bonne vitrine.
- La boutique achète son domaine chez un registraire (`.sn` via le NIC Sénégal, `.com` partout) et ajoute un enregistrement que nous lui indiquons. Plus tard, nous pourrons vendre le domaine nous-mêmes.
- Coût de départ : **0 FCFA** jusqu'à 100 Sites Pro, puis environ **60 FCFA par boutique et par mois**.
- La base reste Supabase, sans changement.

## 3. Studio IA : des visuels de pub sans trahir le produit

La règle qui garantit « le produit reste intact » : **on ne laisse jamais l'IA redessiner le produit.**
1. L'IA détoure le produit.
2. Elle génère seulement le décor, la lumière et l'ombre autour.
3. On replace les pixels d'origine du produit par-dessus.

Les motifs (wax, broderies, logos, étiquettes) restent exacts parce qu'ils ne sont jamais régénérés.

| Niveau | Ce que fait la boutique | Comment | Coût unitaire indicatif |
|---|---|---|---|
| **1. Retouche** | Photo prise au téléphone → fond propre, lumière corrigée, ombre réaliste, cadrage carré, 4:5 et 9:16 | Détourage + décor généré + produit d'origine recollé | 0,02 à 0,10 USD, soit 12 à 60 FCFA |
| **2. Visuel pub** | Choisit un style (« minimal », « luxe », « été », « Tabaski ») → visuel avec nom, prix et logo, au format des pubs internationales | Décor généré + mise en page par nos modèles (texte net, jamais écrit par l'IA) | Environ le niveau 1 |
| **3. Mannequins** | Choisit un modèle dans la galerie (corpulences, tailles, carnations, âges adultes) → le vêtement porté | Essayage virtuel (FASHN, Kling Kolors…) | 0,04 à 0,075 USD par image, soit 25 à 45 FCFA |
| **4. Motion** | Une photo devient un clip de 6 à 8 s (rotation, gros plan, lumière qui passe) pour statut, Reels ou TikTok | Image vers vidéo (Kling 3.0, Veo 3.1 Fast, Runway) | 0,05 à 0,17 USD par seconde, soit environ 250 à 800 FCFA par clip de 8 s |

**Garde-fous, non négociables**
- **Le produit ne change jamais.** Pour l'essayage et la vidéo, où l'IA touche le produit, la boutique compare côte à côte avec la photo d'origine et valide chaque image avant publication. Une image refusée n'est pas facturée.
  - **Point d'attention :** les motifs wax denses sont le cas le plus difficile pour l'essayage virtuel. À tester sur de vraies pièces avant d'ouvrir le niveau 3.
- **Mention honnête.** Les visuels avec mannequin virtuel portent une petite mention (« modèle virtuel ») sur la vitrine. Une cliente doit savoir que la personne n'existe pas ; c'est aussi une protection contre les réclamations.
- **Mannequins virtuels**
  - Ce sont des visages inventés, jamais ressemblants à une personne réelle.
  - Aucun mannequin enfant ou adolescent : les articles pour enfants passent en photo à plat ou sur cintre.
  - Aucune tenue ni pose suggestive.
- **Un seul fournisseur d'accès au départ** (fal.ai réunit FASHN, Kling, Veo, FLUX), payé à l'usage.
  - On change de modèle sans changer l'application ; aucun abonnement.
  - Selon ta règle, aucune dépense sans ton accord : je demande un budget d'essai plafonné (voir décision 3).

**Ce que je construirais d'abord** : le niveau 1 et le niveau 2, sur l'écran d'un article.
- Le bouton « Rendre pro » propose 3 versions.
- La boutique choisit et garde aussi l'original.
- Le visuel choisi sert dans la vitrine, dans « Publier » et dans le fil.

## 4. Assistant d'achat

Ce que tu décris a deux parties :
- **recommander** des produits selon les habitudes ;
- **chercher à la demande**, par la voix ou par écrit : « une robe rouge en M à moins de 15 000 », « des baskets pointure 43 ».

**Pourquoi le placer en dernier**
- **Le catalogue est trop petit.** Avec 25 boutiques et quelques centaines d'articles, un assistant ne trouve rien de mieux qu'une liste. Il faut plusieurs milliers d'articles et des données de taille et de pointure. Les articles n'ont aujourd'hui qu'un nom, un prix et une description.
- **Le profilage est un traitement sensible.** Étudier les habitudes de chaque personne demande une déclaration à la CDP, un consentement clair et un moyen de tout effacer. Cela va aussi contre la promesse actuelle : « la personne qui reçoit un lien n'est pas suivie ».

**Recommandation : un assistant fondé sur ce que la personne dit, pas sur une surveillance**
- Une fiche **« Mes tailles et goûts »** facultative, liée au compte : taille, pointure, couleurs, budget, catégories.
- **Recherche en langage naturel**, d'abord par écrit, puis par la voix en français. Un modèle de langage interroge le catalogue (filtres taille, prix, catégorie, note) et compare le rapport qualité-prix à partir des notes réelles des clientes. Le wolof vocal viendra quand la reconnaissance sera fiable ; à tester.
- **Recommandations** à partir des commandes passées sur Fii La et des goûts déclarés, seulement pour les personnes qui l'ont activé.
- Coût : quelques FCFA par question avec un modèle de langage rapide.

**Prérequis, utiles tout de suite et peu coûteux :** ajouter aux articles la catégorie, les tailles ou pointures disponibles, les couleurs et le stock. La vitrine en profite aussitôt (filtres « taille M », « pointure 43 »).

## 5. « Rendez-vous » : le rendre compréhensible

**Le problème.** « Rendez-vous » évoque un rendez-vous médical ou à deux. Personne ne devine « j'invite 200 personnes à un baptême ».

**Proposition**
- **Accueil**
  - La tuile devient **« Événement »**, avec une icône de lieu et de personnes.
  - Sous les tuiles, une ligne qui donne des exemples : *« Mariage, baptême, anniversaire, réunion : un seul lien pour que tous vos invités trouvent le lieu. »*
- **Écran de création**
  - Le titre devient « Votre événement ».
  - Au-dessus du formulaire, 6 boutons à toucher :
    - Mariage
    - Baptême
    - Anniversaire
    - Funérailles / Condoléances
    - Réunion
    - Autre
  - Le choix remplit le nom (par exemple « Baptême de … ») et une icône.
- **Partage :** le message WhatsApp commence par « Vous êtes invité(e) : Baptême de … ».
- **Partout :** « rendez-vous » est remplacé par « événement » dans l'interface. Le code et les données ne changent pas.

**Mesure :** les créations d'événements par semaine, avant et après.

**Petit travail, sans risque :** je peux le livrer dès ta validation.

## 6. Calendrier proposé

| Étape | Contenu | Durée indicative | Dépense |
|---|---|---|---|
| 0 | « Événement » à la place de « Rendez-vous » | 1 jour | 0 |
| 1 | Articles : catégorie, tailles ou pointures, couleurs, stock ; filtres de la vitrine | 2 à 3 jours | 0 |
| 2 | Studio IA niveaux 1 et 2, offert aux 25 boutiques fondatrices pendant le test | 1 semaine | Budget d'essai plafonné |
| 3 | Sites : domaine neutre, Site Pro (domaine propre, marque blanche, modèles avancés), passage sur Cloudflare | 1 à 2 semaines | 0 jusqu'à 100 boutiques, puis 0,10 USD par mois et par boutique ; domaine neutre environ 10 à 20 USD par an |
| 4 | Mannequins virtuels et motion (si le critère d'arrêt est passé) | 1 à 2 semaines | À l'usage |
| 5 | Assistant d'achat : préférences déclarées, recherche texte puis vocale, recommandations avec consentement | Après le seuil marketplace (action #19) et la déclaration CDP | À l'usage |

## 7. Décisions demandées au fondateur

1. **Site offert** : une petite mention en bas de page (recommandé), ou rien du tout ?
2. **Domaine neutre** pour les sites offerts : d'accord pour que je propose 3 noms disponibles ?
3. **Budget d'essai du Studio IA** : par exemple 50 USD plafonnés (environ 1 000 retouches ou 60 clips), chez fal.ai, payé à l'usage ?
4. **« Événement »** à la place de « Rendez-vous », avec les 6 exemples : je le livre ?
5. **Ordre des étapes** du §6 : validé, ou une autre priorité ?

## Sources (consultées le 19/10/2026)
- [Cloudflare for SaaS : offres et domaines inclus](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)
- [fal.ai : comparatif des API d'essayage virtuel 2026](https://fal.ai/learn/tools/best-virtual-try-on-apis-2026)
- [CometAPI : prix des API vidéo (mis à jour le 03/09/2026)](https://www.cometapi.com/ai-video-api-pricing/)
- [Wearview : prix de l'API Photoroom (mai 2026)](https://www.wearview.co/blog/photoroom-pricing)
