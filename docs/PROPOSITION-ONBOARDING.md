# Proposition — Parcours d'accueil (onboarding) et accueil allégé

> Statut : **PROPOSITION, en attente de validation du fondateur** (20/10/2026, 23:15).
> Rédigée par le Builder (Claude). À relire par ChatGPT, puis à valider par Assane. Rien n'est construit avant validation, sauf le point 0 (déjà livré).

## Le problème

Retour d'utilisateurs proches, même critiques : l'application plaît, mais **une personne qui arrive sans connaître le concept est perdue**. L'accueil montre d'emblée 1 grande action, 4 raccourcis, une phrase d'explication, une carte d'installation, des suggestions, des listes, le fil des boutiques et une section « Plus sur Fii La ». Tout est utile, mais tout arrive en même temps.

## Le principe

**Une personne découvre Fii La par ce qu'on lui a envoyé, puis ajoute les fonctions une à une, quand elle le veut.**

1. Chacun entre par un lien (une demande d'adresse, une vitrine, un événement, une livraison, une invitation d'équipe).
2. Il fait **l'action de base**, sans compte, sans explication préalable.
3. À la fin, il reçoit **une seule belle carte** : ce qu'il vient de faire, et 2 ou 3 choix adaptés à sa situation (« Ouvrir ma boutique », « Devenir livreur », « Créer mon adresse »…), plus « Plus tard ».
4. Chaque fonction choisie s'installe en **3 étapes au maximum**, une carte par étape, un seul bouton par carte, une barre de progression.
5. L'accueil ne montre ensuite **que les fonctions qu'il a installées**, avec un bouton bien visible **« + Ajouter une fonction »**.

## 0. Thème automatique — déjà livré (20/10, 23:10)

Le choix « Clair / Sombre / Automatique » en bas de page est supprimé. L'application suit toujours le réglage du téléphone. Un ancien choix gardé sur un téléphone est effacé. Test automatique mis à jour (téléphone clair → clair, téléphone sombre → sombre).

## 1. Le nouvel accueil (léger)

De haut en bas, rien d'autre :

| Zone | Contenu |
|---|---|
| En-tête | Logo, photo du compte (si connecté), « Bonjour, Prénom ». |
| Action principale | « Créer mon adresse » (inchangée : c'est la promesse de Fii La). |
| Mes fonctions | Les tuiles des fonctions **installées** uniquement (Boutique, Livreur, Événement, Demander une adresse, Vide-dressing, Ambassadeur). |
| Ajouter | Un bouton large et visible **« + Ajouter une fonction »**. |
| Mes éléments | Les listes existantes (adresses, demandes, événements), seulement si elles ne sont pas vides. |
| Découvrir | Le fil des boutiques (carrousel), une seule rangée. |

Retirés de l'accueil : la phrase d'explication « Événement : mariage… » (elle va dans la carte de la fonction), la section « Plus sur Fii La » (son contenu devient des fonctions à ajouter), le sélecteur de thème (fait). La carte « Installer l'app » n'apparaît qu'à partir de la 2ᵉ visite.

**Aucune régression pour les utilisateurs actuels** : une fonction déjà utilisée sur le téléphone est installée d'office (boutique existante → Boutique ; livreur inscrit → Livreur ; un événement créé → Événement ; etc.).

**Nouveau visiteur sans lien** : « Créer mon adresse » + « + Ajouter une fonction ». C'est tout.

## 2. « + Ajouter une fonction » (feuille du bas)

Une carte par fonction, avec une illustration simple, une phrase, un bouton « Ajouter ». Ordre :

| Fonction | Phrase | Pour qui |
|---|---|---|
| Boutique | Vendez en ligne : vitrine, commandes, factures, adresse exacte des clientes. | Commerçants |
| Vente personnelle (vide-dressing) | Vendez ou achetez des articles d'occasion près de chez vous. | Particuliers |
| Livreur | Recevez les courses de vos commerçants avec l'adresse exacte. | Livreurs |
| Événement | Un seul lien pour que tous vos invités trouvent le lieu. | Tout le monde |
| Demander une adresse | Recevez l'adresse exacte d'un client en un lien. | Commerçants, livreurs |
| Ambassadeur | Gagnez de l'argent en installant Fii La chez les commerçants. | Tout le monde |

Une fonction installée disparaît de la feuille et apparaît dans « Mes fonctions ». On peut la retirer de l'accueil (appui long ou « Retirer de l'accueil »), sans rien supprimer.

## 3. La carte de fin d'action, selon le lien reçu

Une seule carte, jamais bloquante, toujours avec « Plus tard ». Elle ne revient pas si la personne a dit « Plus tard » (7 jours de silence, comme les suggestions actuelles).

| Lien reçu | Action de base | Carte de fin : titre | Choix proposés (2 à 3) |
|---|---|---|---|
| Demande d'adresse (d'un commerçant ou livreur) | Donner son adresse | « C'est envoyé. » | Garder mon adresse pour mes prochaines livraisons · Vous vendez aussi ? Ouvrir ma boutique |
| Vitrine d'une boutique | Commander | « Commande envoyée. » | Créer mon adresse (livraisons plus rapides) · Ouvrir ma boutique |
| Événement | Voir le lieu, itinéraire | « Bon trajet. » | Créer mon événement · Créer mon adresse |
| Fiche d'adresse partagée | Itinéraire | « Vous êtes arrivé ? » | Créer mon adresse |
| Course de livraison (livreur) | Livrer | « Course terminée. » | Installer l'espace Livreur |
| Invitation d'équipe de boutique | Rejoindre | « Bienvenue dans l'équipe. » | (aucun choix : on entre dans la boutique) |
| Lien d'ambassadeur (commerçant parrainé) | — | Parcours Boutique directement (3 étapes) | — |

## 4. L'installation guidée d'une fonction (3 étapes au maximum)

Exemple **Boutique** :
1. **Nom et type de commerce** (un champ, une liste) → « Continuer ».
2. **Premier article** (une photo, un prix) → « Continuer » (ou « Plus tard »).
3. **Partager ma vitrine** sur WhatsApp → « Partager ».
→ Carte de réussite (animation légère) : « Votre boutique est prête. » + **une seule** prochaine étape, qui reviendra les jours suivants par le moteur de suggestions déjà en place (« Ajoutez 2 ou 3 articles », etc.).

Exemple **Livreur** : 1) nom et numéro → 2) quartier → 3) partager mon lien de livreur à mes commerçants → réussite.

Règles de forme pour toutes les cartes : un titre court, une phrase, une illustration, **un seul bouton principal**, un lien discret « Plus tard », une barre de progression (1/3, 2/3, 3/3), une carte par écran, rien d'autre visible.

## 5. Back-office (règle du 20/10)

Nouvelle rubrique **« Parcours d'accueil »** :
- **Voir** : pour chaque entrée (demande, vitrine, événement, livraison…), le taux qui va de l'action de base → carte vue → choix cliqué → fonction installée ; les fonctions les plus installées.
- **Agir / régler** : activer ou couper chaque carte de fin d'action et le nouvel accueil (réglage `onboarding_v2`, coupé = retour à l'accueil actuel, sans redéploiement) ; ordre des fonctions dans « + Ajouter ».
- **Tracer** : chaque changement de réglage dans le journal d'administration.
- **Tester** : aperçu de chaque carte depuis le back-office.

Mesure anonyme (comme les suggestions actuelles) : aucune donnée personnelle, seulement des compteurs.

## 6. Déploiement proposé (3 lots, chacun testé et réversible)

| Lot | Contenu | Durée estimée | Critère pour passer au suivant |
|---|---|---|---|
| 1 | Accueil léger + « + Ajouter une fonction » + installation d'office pour les utilisateurs actuels + réglage `onboarding_v2` + rubrique back-office (vue simple) | 1 session | Tests automatiques verts ; capture validée par le fondateur ; aucun utilisateur actuel ne perd une tuile |
| 2 | Cartes de fin d'action pour les 6 liens + mesures | 1 session | Test sur téléphone par 3 proches (dont un qui ne connaît pas l'app) : chacun comprend quoi faire sans aide |
| 3 | Installations guidées en 3 étapes (Boutique, Livreur, Événement, Vente personnelle, Demander, Ambassadeur) + carte de réussite | 1 à 2 sessions | Taux « carte vue → fonction installée » suivi 7 jours dans le back-office |

Chaque lot : tests navigateur Chrome et Safari (iPhone), captures clair et sombre, back-office livré dans le même commit, retour arrière par le réglage `onboarding_v2`.

## 7. Ce qui n'est pas proposé (volontairement)

- Pas de tutoriel en plusieurs écrans au premier lancement : on apprend en faisant.
- Pas de compte obligatoire (décision du 17/10, maintenue).
- Pas de choix de « profil » au démarrage (commerçant / client / livreur) : c'est le lien reçu et les fonctions ajoutées qui définissent l'usage. Une personne peut être cliente le matin et vendeuse le soir.

## 8. Questions ouvertes pour le fondateur

1. « Créer mon adresse » reste-t-il l'action principale de l'accueil pour tout le monde ? (Recommandation : oui, c'est la promesse.)
2. Le fil des boutiques reste-t-il sur l'accueil d'un nouveau visiteur ? (Recommandation : oui, une rangée, en bas.)
3. Illustrations des cartes : pictogrammes actuels agrandis (rapide) ou illustrations dédiées produites par GPT Image dans le style de l'icône (plus beau, à produire) ? (Recommandation : pictogrammes au lot 1-2, illustrations au lot 3.)
