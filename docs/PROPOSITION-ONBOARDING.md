# Proposition — Parcours d'accueil et accueil allégé (v2)

> Statut : **v2, en attente de validation du fondateur** (20/10/2026, 23:40).
> v1 rédigée par le Builder (Claude) ; relue par ChatGPT (verdict : « valider avec changements », 5 changements) ; v2 = v1 + ces 5 changements + 2 arbitrages du Builder signalés (A1, A2). Rien n'est construit avant validation, sauf le point 0.

## Le problème

Une personne qui arrive sans connaître le concept est perdue : l'accueil montre tout en même temps (grande action, 4 raccourcis, phrase d'explication, installation, suggestions, listes, fil, « Plus sur Fii La »).

## Le principe

**On entre par son besoin (le lien reçu), on retrouve facilement ses activités, on découvre les autres services un à un.**

- Aucun service ne s'« installe » : tout est déjà disponible. **Le premier usage d'un service ajoute son raccourci** à l'accueil.
- Après une action, la tâche en cours passe d'abord ; la découverte vient ensuite, discrète.
- On mesure des **tâches réussies**, pas des tuiles ajoutées.

## 0. Thème automatique — déjà livré (20/10, 23:10)

Sélecteur « Clair / Sombre / Automatique » supprimé ; l'application suit le réglage du téléphone ; ancien choix effacé ; test mis à jour.

## 1. Accueil léger (lot 1)

| Zone | Contenu |
|---|---|
| En-tête | Logo, photo du compte, « Bonjour, Prénom ». |
| Action principale | **Nouveau visiteur** : « Créer mon adresse ». **Activité commencée et non finie** : « Reprendre… » (ex. « Reprendre ma boutique »). **Sinon** : l'activité la plus utilisée (A1). |
| Mes activités | Les raccourcis des services déjà utilisés (Boutique, Livreur, Événement, Demander une adresse, Vide-dressing enfants, Ambassadeur, Mes adresses). |
| Découvrir | Un bouton large et visible **« Découvrir les services »**. |
| Listes | Adresses, demandes, événements, seulement si non vides. |
| En bas | Fil des boutiques, une rangée, chargé après le reste (décision du 19/10). |

Retirés : phrase « Événement : mariage… », section « Plus sur Fii La », sélecteur de thème (fait). « Installer l'app » à partir de la 2ᵉ visite.

**Reprise des activités existantes** : les raccourcis sont retrouvés à partir de ce qui existe déjà — le compte (boutique, rôle de livreur, ambassadeur) et les clés gardées sur le téléphone (adresses, événements, demandes) — sans mélanger les droits : un raccourci ne donne jamais un accès que la personne n'a pas. Retirer un raccourci ne retire aucun accès.

**A1 (arbitrage Builder)** — ChatGPT propose « la dernière activité utilisée » comme action principale. Je recommande **la plus utilisée sur 14 jours** : l'action principale ne doit pas changer d'une visite à l'autre (un repère qui bouge désoriente).

## 2. « Découvrir les services » (feuille du bas, lot 1)

Une carte par service : pictogramme existant, une phrase, un bouton qui **ouvre directement le parcours** (pas d'activation).

| Service | Phrase | Le bouton ouvre |
|---|---|---|
| Boutique | Vendez en ligne : vitrine, commandes, factures, adresse exacte des clientes. | Le démarrage guidé (lot 2) |
| Demander une adresse | Recevez l'adresse exacte d'un client en un lien. | Le parcours existant |
| Événement | Un seul lien pour que tous vos invités trouvent le lieu. | Le parcours existant |
| Livreur | Recevez les courses de vos commerçants, avec l'adresse exacte. | L'espace livreur existant (invitation par le commerçant, livreur attitré) |
| Vide-dressing enfants | Proposez un article enfant à Fii La, ou achetez. | Le vide-dressing existant (tenu par Fii La) |
| Ambassadeur | Gagnez de l'argent en installant Fii La chez les commerçants, après formation et validation. | L'espace ambassadeur existant (formation, test, validation inchangés) |

Aucune carte ne promet plus que le service actuel (la « vente personnelle » au sens large n'existe pas encore : à décider séparément si souhaitée).

## 3. Démarrage guidé de la boutique (lot 2)

1. **Nom et type de commerce** → « Continuer ».
2. **Premier article** : nom, prix, photo (facultative) → « Continuer ». « Plus tard » possible.
3. **Aperçu de la vitrine** → « Ouvrir ma vitrine » (choix explicite) → « Partager sur WhatsApp ».

- Si l'article est sauté : boutique enregistrée, **vitrine non proposée au partage** (une boutique vide n'est pas prête).
- Chaque étape est enregistrée ; une interruption reprend au même endroit (« Reprendre ma boutique » sur l'accueil).
- Fin : carte de réussite légère + **une seule** prochaine étape, puis le moteur de suggestions existant prend le relais les jours suivants.
- « 3 étapes » est une cible, pas une règle absolue.
- Forme : une carte par écran, un titre, une phrase, un bouton principal, « Plus tard » discret, progression 1/3 → 3/3.

## 4. Découverte après action (lot 3)

La tâche du lien reste l'action principale ; la découverte est **une seule proposition secondaire, discrète et masquable**, sous l'action principale — jamais une carte qui surgit.

| Lien reçu | Action principale après la tâche | Proposition secondaire (une) |
|---|---|---|
| Vitrine → commande | « Donner mon adresse » si elle manque ; sinon « Voir ma commande » | Ouvrir ma boutique |
| Demande d'adresse → réponse | « Retrouver mon adresse » (sans recréer la fiche) | Demander une adresse à mes clients |
| Fiche d'adresse reçue | « Itinéraire » (inchangé) | Créer mon adresse (sous l'itinéraire, rien au départ vers Maps) |
| Événement reçu | « Itinéraire » (inchangé) | Créer mon événement |
| Course de livraison | Parcours livreur inchangé | Mon espace livreur |
| Invitation d'équipe | Entrer dans la boutique | — |

**A2 (arbitrage Builder)** — Vous aviez demandé que la personne ait « le choix entre plusieurs fonctionnalités ». ChatGPT recommande une seule proposition. Les deux tiennent : **une proposition adaptée + un lien « Voir tous les services »** qui ouvre la feuille « Découvrir les services ». Le choix reste complet, sans concurrencer la tâche.

## 5. Back-office (dans chaque lot)

Rubrique **« Parcours d'accueil »** :
- **Voir** (agrégé, anonyme) : par entrée et par service, carte vue → choix touché → **tâche réussie** (adresse envoyée, premier article enregistré, vitrine ouverte, invitation acceptée). « Partage ouvert » n'est jamais présenté comme « message envoyé ».
- **Régler** : réglage `onboarding_v2` (coupé = accueil actuel, sans redéploiement) ; chaque proposition secondaire activable ou coupable ; ordre des services.
- **Tracer** : chaque changement dans le journal d'administration.
- **Tester** : aperçu de chaque carte.

## 6. Déploiement (3 lots ; durées = estimations, le passage dépend des preuves)

| Lot | Contenu | Critère de passage |
|---|---|---|
| 1 | Accueil léger, Mes activités, Découvrir les services, reprise des activités existantes, réglage de retour arrière, back-office minimal | Tests verts ; **recette sur un Android et un iPhone physiques** par le fondateur : retrouver une activité existante, découvrir un service, ouvrir un lien reçu sur WhatsApp. Aucun accès perdu, aucun compte imposé. |
| 2 | Démarrage guidé de la boutique (les autres services gardent leurs parcours) | **3 novices** réussissent sans aide : créer la boutique, ajouter un article, ouvrir la vitrine, transmettre le lien à un 2ᵉ téléphone ; interruption et reprise vérifiées ; la même personne peut acheter ailleurs sans perdre sa boutique. |
| 3 | Découverte après action (§4) | Chaque lien garde sa tâche principale ; aucune suggestion ne détourne d'une adresse manquante ou d'une commande en cours ; 7 jours d'observation des tâches réussies et abandons (7 jours ne valent pas validation à eux seuls). |

## 7. Volontairement exclu

Tutoriel au premier lancement ; compte obligatoire ; choix de « profil » au démarrage ; illustrations dédiées (pictogrammes existants sur les 3 lots ; une petite capture réelle de l'interface quand il faut montrer un geste).

## 8. À valider par le fondateur

1. La v2 dans son ensemble.
2. A1 : action principale = activité la plus utilisée sur 14 jours (au lieu de la dernière).
3. A2 : une proposition + « Voir tous les services » après une action.
4. Hors proposition : élargir le vide-dressing enfants à la vente personnelle de tout article — sujet séparé, non inclus ici.
