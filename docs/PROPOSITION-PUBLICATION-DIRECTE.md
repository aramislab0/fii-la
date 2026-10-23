# Proposition — Publier sur les réseaux sans quitter Fii

> v1, 23/10/2026, Builder (Claude), à la demande du fondateur (14:57) : « pour publier, c'est trop difficile ; il faut cliquer sur un lien qui t'amène autre part ; la majeure partie des gens ne vont pas comprendre. Y a-t-il un moyen plus simple ? ».
> **Rien n'est construit avant l'avis du VP et la validation du fondateur** (service tiers, dossier Meta, nouveau traitement de données).
> Sources consultées le 23/10/2026 : documentation Instagram Platform (Meta), TikTok Content Sharing Guidelines, Snap Kit Creative Kit for Web.

## 1. Verdict

**Oui pour Instagram et Facebook (pages), pas pour WhatsApp ni Snapchat, plus tard pour TikTok.**

La seule façon d'éviter l'écran « Partager » du téléphone est la **publication directe** : la commerçante relie une fois son compte (« Connecter Instagram »), puis un toucher sur « Publier » met la photo en ligne depuis Fii, sans ouvrir d'autre appli. Ce n'est possible que là où le réseau ouvre une interface officielle.

| Réseau | Publication directe depuis Fii | Conditions (FAIT, documentation officielle) |
|---|---|---|
| Instagram | **Oui** | Compte **professionnel** (Entreprise ou Créateur) ; permission `instagram_business_content_publish` ; image servie par une adresse publique ; plafond d'environ 50 à 100 publications par 24 h par compte. Un compte personnel ne peut pas publier par l'interface |
| Facebook | **Oui, sur une Page** | Publication sur une **Page** (pas sur un profil personnel) ; permission de gestion des publications de la Page |
| TikTok | **Plus tard** | Sans audit de TikTok : 5 comptes par jour au plus, publications **privées** seulement. L'audit impose un écran précis (aperçu, choix de confidentialité sans valeur par défaut, consentement) |
| Snapchat | **Non** | Pas d'interface de publication : seulement le partage d'un **lien** vers Snapchat |
| Statut WhatsApp | **Non** | Aucune interface officielle pour publier un statut |

**HYPOTHÈSES à vérifier :**
- Meta demande une **vérification d'entreprise** (Aramis Lab) et un **examen de l'appli** pour ouvrir ces permissions à tous les utilisateurs. Le délai et le contenu exact du dossier ne sont pas confirmés ici.
- La documentation lue ne dit pas explicitement si une Page Facebook est nécessaire avec la connexion Instagram ; elle le laisse entendre.

## 2. Ce qui est déjà corrigé aujourd'hui (sans attendre)

Sur iPhone, Facebook n'affichait que le lien « github.io », sans la photo (capture du fondateur, 23/10). Cause : l'appli Facebook garde le texte et perd l'image quand on lui envoie les deux. Correctif : **l'image seule** part vers Instagram, Facebook, TikTok et Snapchat. Le texte est copié à part. WhatsApp reçoit l'image avec sa légende.

## 3. Proposition (V1, à valider)

**Parcours visé** (une commerçante) :
1. **Une fois** : Marketing → « Connecter Instagram » → écran officiel de Meta → retour dans Fii, compte relié (logo coloré coché).
2. **Ensuite** : sur la carte d'un article, toucher le logo Instagram → aperçu → **« Publier »** → « Publié » dans Fii. Aucun autre écran.
3. Les réseaux non reliés (WhatsApp, Snapchat, TikTok) gardent le partage actuel.

**Construction (estimation, HYPOTHÈSE)** : environ 2 jours de développement, plus le délai d'examen de Meta.
- Une appli Meta au nom d'Aramis Lab ; une fonction serveur qui publie ; les jetons d'accès gardés côté serveur, jamais dans le téléphone ni dans le dépôt.
- Les images publiées depuis le stockage existant (adresse publique).
- **Back-office** : comptes reliés par boutique (sans jeton visible), publications réussies et en échec avec la raison, interrupteur général, déconnexion d'un compte.

**Coût** : l'interface de Meta est gratuite. **Aucun service payant** dans cette option.

**Option B (plus rapide, payante, non recommandée maintenant)** : un service tiers de publication (Ayrshare, bundle.social, Postiz) qui porte déjà ses applis approuvées. Abonnement payant, et les données des commerçantes passent par un tiers de plus. À réexaminer seulement si l'examen Meta bloque.

## 4. Conditions et risques

- **CDP** : relier un compte de réseau social et garder un jeton d'accès est un **nouveau traitement**, à déclarer avant l'ouverture réelle.
- **Comptes personnels** : beaucoup de commerçantes publient depuis un compte Instagram personnel. Il faudra les guider pour passer en compte professionnel (gratuit, deux minutes dans Instagram), sinon la publication directe ne marchera pas pour elles.
- **Dépendance** : Meta peut changer ses règles ou ses plafonds. Le partage actuel reste toujours disponible en secours.

## 5. Décisions demandées au fondateur

1. Lancer le dossier Meta (vérification d'Aramis Lab, création de l'appli) : **oui / non**. Démarche de ton côté, avec les documents de l'entreprise ; je prépare la liste et les textes.
2. Construire la V1 Instagram + Page Facebook dès que l'appli existe : **oui / non**.
3. TikTok : attendre l'audit, ou ne rien faire pour l'instant.

## Message à transmettre à ChatGPT (copier-coller)

> Bonjour. Nouvelle proposition dans `docs/PROPOSITION-PUBLICATION-DIRECTE.md` : publier sur Instagram et sur une Page Facebook directement depuis Fii (compte relié une fois, puis un toucher), via les interfaces officielles de Meta. TikTok plus tard (audit), Snapchat et statut WhatsApp impossibles (pas d'interface). Conditions : compte Instagram professionnel, examen de l'appli par Meta, nouveau traitement à déclarer à la CDP, jetons gardés côté serveur, back-office complet. Aucun service payant. Un correctif est déjà en ligne : Facebook perdait la photo quand on envoyait aussi le texte. Peux-tu vérifier l'alignement produit (priorité face aux recettes en cours, parcours des commerçantes sans compte professionnel, risque de dépendance) et déposer ton avis en haut de `docs/REVUE-VP.md` ?
