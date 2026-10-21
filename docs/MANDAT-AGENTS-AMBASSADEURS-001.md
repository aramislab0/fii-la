# Mandat AGENTS-AMBASSADEURS-001

> **Mandat d'exécution direct du fondateur (Assane)**, transmis au Builder le 21/10/2026 à 04:27 (heure de Dakar), rédigé avec le VP.
> Statut : **ENREGISTRÉ — exécution non commencée.** Ce document reprend l'instruction ; il ne décrit aucune réalisation.
> Le connecteur GitHub du VP a reçu des refus d'écriture (403) : ce mandat n'avait pas été déposé avant ce commit.
> Rapport de livraison prévu : `docs/RAPPORT-AGENTS-AMBASSADEURS-001.md` (construit / déployé / testé, séparés).

## 1. Enregistrement

Synchroniser le dépôt sans écraser de travail concurrent ; lire `CLAUDE.md`, `docs/HANDOFF.md`, `docs/REVUE-VP.md` et l'existant (programme Ambassadeurs actuel, Manager, Studio, back-office). Créer ce document, le référencer dans HANDOFF (décision, état, action, journal), ajouter une entrée en tête de REVUE-VP (« mandat autorisé par le fondateur, pas une réalisation »), pousser ensemble.

## 2. Décision du fondateur : deux programmes distincts

- **Agents Fii La** : personnes rémunérées pour installer et accompagner les utilisateurs, surtout les commerçants. Le programme rémunéré actuellement appelé « Ambassadeurs » (« Fii La Carrière ») **devient « Agents »**.
- **Ambassadeurs Fii La** : boutiques, marques et e-commerces existants **choisis personnellement par le fondateur**, invités à essayer le pack complet pendant **un ou deux mois**.
- **Manager Fii La** : une seule infrastructure d'accompagnement pour les deux programmes, avec des parcours, des droits et des contextes de conversation distincts.

Une même personne peut être à la fois Agent, commerçante, propriétaire d'une boutique Ambassadeur, acheteuse ou livreuse. Pas de profil exclusif, pas de second système de comptes.

## 3. Programme Agents : conserver et migrer

- Renommer les libellés visibles, la navigation, la formation, les quiz, les missions, les grades, les gains, les réponses du Manager et les sections du back-office.
- Conserver comptes, codes, rattachements de commerçants, résultats de formation, gains acquis, versements et historiques de conversation. Les liens existants restent valides. Migrations additives ; inutile de renommer les tables internes `amb_*`.
- Conserver les règles de rémunération approuvées ; n'inventer aucun taux.
- Un gain dépend de la date où l'éligibilité est atteinte, pas de la date d'ouverture d'un tableau de bord (tester : éligible au jour 6, première évaluation au jour 8).
- Empêcher l'auto-rémunération et la double attribution. Accepter une invitation Ambassadeur ne génère jamais à lui seul un gain d'Agent.

## 4. Parcours d'invitation Ambassadeur

Back-office → Programmes → Ambassadeurs → **Inviter une marque**.

- Champs minimum : nom de la marque, activité, contact WhatsApp, boutique existante le cas échéant, pack, durée (1 ou 2 mois). Le reste facultatif et replié.
- Défaut recommandé par le VP : 1 mois, 2 mois au choix.
- Aperçu personnalisé de l'invitation et lien privé que le fondateur partage par WhatsApp. Ouvrir la feuille de partage ne prouve pas l'envoi.
- L'invitation : révocable, expire, régénérable sans risque ; inchangée par les requêtes GET, les aperçus WhatsApp ou les ouvertures répétées ; une seule acceptation et un seul essai ; preuve de propriété avant de rattacher une boutique existante ; réutilise le parcours commerçant sans compte obligatoire ; reprise sans boutique ni avantage en double.
- Réutiliser le démarrage guidé : informations → premier article → aperçu et ouverture explicite de la vitrine ; progression enregistrée.
- Le partenariat vit dans le tableau de bord normal de la boutique : statut, avantages, échéance, crédits restants, prochaine action. Pas de second tableau de bord.

## 5. Essai exact et appliqué par le serveur

- L'essai démarre seulement sur « Activer mon essai », quand le pack promis est réellement disponible.
- Dates calculées par le serveur : 1 ou 2 mois calendaires, fuseau Africa/Dakar, fins de mois comprises. Activation idempotente.
- Packs versionnés ; avantages, limites et exclusions exacts affichés avant l'activation ; droits et quotas appliqués côté serveur.
- À l'échéance : retrait des avantages temporaires ; boutique, catalogue, commandes, photos d'origine et médias générés conservés. Aucune facturation ni reconduction payante automatique.
- Sans offre payante approuvée : « Demander la suite au Manager ».
- Prolongations, suspensions, révocations et changements sensibles : droits adaptés et trace au journal.

## 6. Studio, médias et partage

Réutiliser l'existant et le Studio déjà prévu.

Parcours : Article → Améliorer la photo → comparaison original / résultat → approbation explicite → Utiliser cette photo → aperçu du partage → Partager.

- Conserver l'original, la forme, la couleur, le motif, la matière apparente, les étiquettes et la marque du produit ; format 4:5 ; jamais de remplacement silencieux ni de publication automatique sur les réseaux.
- Clés du fournisseur côté serveur uniquement ; quotas atomiques ; plafonds de budget ; travaux idempotents ; états de reprise ; protection contre la double facturation concurrente ; crédit rendu à l'utilisateur en cas d'échec, sans prétendre que le coût du fournisseur était nul.
- Un pack promettant le Studio ne peut pas s'activer tant que fournisseur, quota approuvé, budget et chemin de génération réel ne sont pas prêts. Clés ou financement manquants : **`BLOCKED_DEPENDENCY`**, et poursuite du travail indépendant. Aucun prix, quota ou résultat inventé.

## 7. Manager et back-office

- Une seule infrastructure Manager. Agents : formation, missions, progression, gains, difficultés de terrain. Ambassadeurs : configuration de la boutique, catalogue, Studio, partage, premières commandes, bilan d'essai, suite.
- Contexte (programme, ressource) vérifié côté serveur, y compris sur WhatsApp ; demander de quelle activité il s'agit en cas d'ambiguïté.
- Le Manager n'approuve jamais seul un versement, ne prolonge pas un essai, n'augmente pas un quota, n'invente pas de prix. Réponses utiles sans IA et escalade humaine visible.
- Back-office : voir, agir, tracer, régler, tester pour les deux programmes ; droits financiers et administratifs existants préservés.
- Mesurer des jalons réels : configuration, premier article, vitrine ouverte, retouche approuvée utilisée, partage ouvert, commande reçue / livrée, retour du commerçant. Ne jamais assimiler un clic à un message WhatsApp remis, une publication ou une vente attribuée.

## 8. Exécution et vérification

Ordre :
1. Inventaire et garde-fous de migration.
2. Migration des Agents et compatibilité.
3. Invitations Ambassadeurs, packs et cycle de vie de l'essai.
4. Studio, médias, Manager et back-office.
5. Non-régression, chaîne de mise en ligne autorisée, rapport de livraison.

À vérifier au minimum :
- codes, gains et liens historiques survivent à la migration ;
- invitations expirées ou révoquées et rattachement non autorisé échouent proprement ;
- double acceptation, double activation, double génération : aucun avantage ni coût en double ;
- dates d'essai insensibles à l'horloge du téléphone et aux réouvertures ;
- échéance, prolongation, quota épuisé, échecs et travaux interrompus ;
- Agent + Ambassadeur + acheteuse sur un même compte sans fuite de droits ;
- déconnexion, téléphone partagé, membre d'équipe retiré, appels API non autorisés ;
- parcours adresse, événement, commande, stock, paiement enregistré, livreur intacts ;
- Chromium / WebKit, petits écrans, clair / sombre, clavier, mouvement réduit ;
- partage WhatsApp et reprise sur Android et iPhone physiques si disponibles (sinon **`NOT_RUN`**, jamais « réussi » par émulation).

Données synthétiques uniquement. Aucune invitation réelle, aucun contact avec la CDP, aucune publication sur un compte réel, aucun service payant non approuvé.

Rapport `docs/RAPPORT-AGENTS-AMBASSADEURS-001.md` : commits exacts, migrations, commandes et résultats de tests, captures, exécutions GitHub Actions, preuves réelles du Studio, dépendances restantes, procédure de retour arrière ; **construit**, **déployé** et **testé** séparés. HANDOFF mis à jour à chaque lot ; commits distants vérifiés avant toute annonce.

## 9. Contexte professionnel

Consigner décisions, idées, résultats, blocages et prochaines actions à chaque exécution et fin de session ; distinguer propositions, décisions approuvées et résultats observés. Les informations Fii La vivent dans ce dépôt ; le contexte Aramis transverse ou confidentiel n'y est jamais copié (dépôt public).

## Points relevés par le Builder à l'enregistrement (À CONFIRMER, ne bloquent pas les lots 1-2)

- **Contenu du « pack complet »** : non défini dans le dépôt (avantages, quotas, limites, exclusions). Les packs seront versionnés en base ; le contenu de la version 1 doit être fixé par le fondateur avant toute activation réelle.
- **Studio IA** : reporté le 19/10 (action #37/#48 : compte fal.ai, plafond 50 USD, clé non fournie). Tout pack incluant le Studio reste en **`BLOCKED_DEPENDENCY`** tant que ces éléments manquent.
- **Nom « Fii La Carrière »** : marque actuelle du programme rémunéré (numéro WhatsApp du Manager affiché « Fii La Carrière ®»). Le renommage en « Agents Fii La » touche ce libellé ; le nom affiché du numéro WhatsApp chez Meta devra suivre.
