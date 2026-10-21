> DOCUMENT SOURCE HISTORIQUE — conservé pour traçabilité. Lire les documents 00 à 04 à la racine pour les statuts courants. Ne pas réinitialiser un mandat déjà en cours dans le dépôt.

# Fii La — Mandat AGENTS-AMBASSADEURS-001

> Date : 20/10/2026, Dakar. Émetteur : Assane, fondateur, via son VP produit.
> Statut : À EXÉCUTER PAR LE BUILDER après sécurisation et clôture de son lot en cours.
> Construction, tests et intégration demandés par le fondateur ; ce document n'est pas une déclaration de livraison.
> Priorité : prochain mandat produit après le travail en cours et les corrections bloquantes déjà dues.
> Source : instruction directe du fondateur dans ChatGPT. Dépôt observé à la préparation : 2e5e9abd171fa8055c3d960d7640dab972448807.
> Rapport attendu : docs/RAPPORT-AGENTS-AMBASSADEURS-001.md, à créer par le Builder avec des preuves réelles.

## 0. Passation à Claude — dépôt et exécution

Ce fichier est le mandat complet autorisé par le fondateur. Le VP n'a pas pu le déposer dans GitHub : écritures de fichiers et de ticket refusées par la connexion (403). Il n'existe donc pas encore dans le dépôt au moment de cette remise.

Après sécurisation/clôture du lot en cours :
1. Synchroniser le dépôt `aramislab0/fii-la` et lire ses instructions actuelles.
2. Enregistrer ce fichier sous `docs/MANDAT-AGENTS-AMBASSADEURS-001.md`.
3. Dans le même commit, ajouter le mandat en haut de `docs/REVUE-VP.md` et à `docs/HANDOFF.md` : nouvelle décision, état À EXÉCUTER, prochaine action, ligne de journal. Ne pas écraser les mises à jour d'un autre intervenant ; choisir le prochain numéro d'action disponible.
4. Exécuter ce mandat, mettre les statuts à jour à chaque lot et livrer `docs/RAPPORT-AGENTS-AMBASSADEURS-001.md`.
5. Ne pas considérer le dépôt de ce document comme la réalisation des fonctions. Distinguer demandé, construit, déployé et testé.


## 1. Décision du fondateur — nouvelle terminologie faisant autorité

| Programme | Définition et bénéficiaire | Valeur accordée | Accès |
|---|---|---|---|
| **Agents Fii La** / Fii La Carrière | Personnes qui accompagnent et onboardent les autres usagers, notamment les commerçants | Rémunération selon les missions et preuves d'activité validées | Parcours existant de formation, test, validation, missions et gains |
| **Ambassadeurs Fii La** | Boutiques, marques et e-commerces existants, sélectionnés personnellement par le fondateur | Pack complet offert en essai pendant un ou deux mois ; accompagnement du Manager | Invitation nominative créée dans le back-office, lien privé, configuration de leur boutique et utilisation du pack |
| **Manager Fii La** | Un même point de contact, avec l'équipe humaine en supervision | Accompagnement distinct des Agents et des Ambassadeurs | Interface et infrastructure communes, contextes et droits séparés |

Cette décision remplace le sens ancien d'« ambassadeur » pour les recruteurs rémunérés. Les décisions historiques, montants et gains ne sont pas annulés : ils concernent désormais les **Agents**. Un Ambassadeur commerçant n'est pas rémunéré par défaut pour recruter. Un Agent ne reçoit pas automatiquement le pack Ambassadeur.

Une même personne peut être acheteur, commerçant, livreur, Agent et responsable d'une marque Ambassadrice. Les activités coexistent ; aucun choix de profil exclusif. Le partenariat Ambassadeur appartient à la boutique/organisation et à ses bénéficiaires autorisés, pas indistinctement à toutes les boutiques d'un compte.

**Distinction des sources :** les définitions ci-dessus sont la décision du fondateur. Les valeurs et comportements par défaut explicités ci-dessous sont les recommandations d'exécution du VP ; ils doivent rester réglables sans modifier arbitrairement les décisions ou avantages déjà acquis.

## 2. Prise en charge et périmètre

1. Finir ou sécuriser le lot en cours, synchroniser main et lire CLAUDE.md, HANDOFF, REVUE-VP et ce mandat avant de commencer.
2. Annoncer la prise en charge dans HANDOFF avec statut, branche et ordre d'exécution ; ne pas demander une seconde validation du principe de construction.
3. Inspecter l'existant réel (comptes, boutiques, équipes, ancien programme ambassadeur, Manager, WhatsApp, Studio, droits et back-office) avant de coder. Réutiliser ces briques.
4. Livrer les parcours complets : données et migrations, contrôles serveur, interface mobile, invitations, états d'erreur, Manager, médias/Studio, suivi, back-office, tests et documentation.
5. Ne pas lancer une nouvelle plateforme, un second compte utilisateur, un second moteur de conversation ou un nouveau réseau de recrutement.

Le pack est gratuit pour le bénéficiaire pendant l'essai ; ses consommations externes restent un coût Fii La. L'autorisation de construire n'est pas une autorisation de dépenses illimitées, d'envoi à de vrais destinataires ou de publication sur leurs comptes. Réutiliser uniquement les fournisseurs et budgets déjà autorisés ; documenter toute dépendance manquante et continuer le travail indépendant.

## 3. Partie A — Agents : faire évoluer l'existant sans perdre de données

- Renommer les textes actifs, menus, cartes, formation, charte, test, grades, classements, messages du Manager, WhatsApp, notifications et rubriques de gestion : **Agent**, **Agent confirmé**, **Agent certifié Fii La**.
- Garder Fii La Carrière comme entrée du programme des Agents. Aucun questionnaire métier n'est imposé à un Ambassadeur commerçant.
- Conserver intégralement comptes, codes distribués, rattachements commerçants, formations, scores, missions, conversations, niveaux, gains, versements et journaux.
- Garder les anciens liens opérationnels : les anciennes routes du programme rémunéré continuent d'ouvrir l'espace Agent ou redirigent sans boucle. Ne jamais réaffecter un ancien lien à un nouveau commerçant Ambassadeur.
- Un renommage physique des tables/RPC amb_* n'est pas obligatoire : préférer une correspondance documentée et des migrations additives à un remplacement dangereux. Ne pas modifier les anciennes migrations appliquées.
- Conserver les montants et conditions approuvés. L'extension à d'autres types d'onboarding utilise un catalogue de missions explicites ; aucune nouvelle rémunération n'est inventée. Une mission sans barème approuvé n'annonce aucun montant.
- Les gains doivent dépendre de la date où les conditions sont remplies, et non de la consultation du tableau de bord. Reproduire/corriger le cas « conditions remplies J6, première évaluation J8 ». Attribution unique, sans perdre ou doubler les gains acquis.
- Pas d'auto-récompense : un Agent ne gagne rien en activant sa propre boutique ou son propre essai Ambassadeur. Une invitation Ambassadeur ne génère pas à elle seule un gain Agent. Ne pas effacer rétroactivement un gain déjà attribué ; signaler tout conflit pour revue humaine.

## 4. Partie B — Ambassadeurs : créer une invitation en une fiche

### 4.1 Geste du fondateur

Back-office → **Programmes → Ambassadeurs → Inviter une marque**.

Champs visibles : nom de la marque/boutique, activité, contact WhatsApp, boutique existante à rattacher si connue, pack et durée **1 mois / 2 mois**. Logo, personne de contact, réseaux et notes vont dans « Compléter », facultatifs au départ.

Recommandation : **1 mois par défaut**, 2 mois sélectionnable. Le pack est un modèle versionné avec avantages, quotas et budget ; le fondateur choisit le modèle au lieu de reconfigurer chaque invitation. Aucun quota IA ou prix ne doit être inventé dans le code ou le texte.

Action principale : **Préparer l'invitation** → aperçu nominatif, durée et avantages exacts → **Envoyer sur WhatsApp** par partage/lien existant. Copier le lien reste disponible. Ouvrir le partage n'est pas une preuve d'envoi. L'automatisation WhatsApp utilise seulement les autorisations et capacités réellement disponibles ; sinon le fondateur envoie lui-même.

Éviter les doublons par boutique et invitation active. « Renvoyer » avant expiration ne crée ni second partenariat ni seconde période gratuite. Régénérer révoque l'ancien jeton.

### 4.2 Invitation et premier accueil du commerçant

Le lien ouvre sans installation ni connexion forcée, avec logo Fii La, nom de la marque, invitation du fondateur, pack et durée lisibles, puis une seule action **Configurer ma boutique**.

- Un affichage, un aperçu WhatsApp, une prélecture ou une requête GET ne consomme pas l'invitation et ne démarre pas l'essai.
- Lien signé/aléatoire à forte entropie, jeton stocké haché, révocable, à usage unique pour l'acceptation ; expiration par défaut recommandée : 7 jours, indépendante de l'essai.
- Une boutique existante est rattachée uniquement après preuve de ses droits de propriétaire : session autorisée ou clé de gestion valide. Un nom ou numéro simplement tapé ne prouve aucun droit.
- Pour une nouvelle boutique sans compte, réutiliser le mécanisme propriétaire existant ; expliciter que le lien d'invitation est privé. Il ne donne aucun accès aux données d'autres boutiques.
- L'acceptation lie le bénéfice à une boutique ; réouverture par le propriétaire autorisé = reprise du même parcours. Un autre compte, membre ou détenteur du lien ne peut ni reprendre sa propriété ni multiplier le bénéfice.
- Le compte reste facultatif pour le parcours commerçant selon les règles existantes ; proposer la récupération multi-téléphones au moment utile. Le compte exigé pour les Agents et la protection du back-office restent inchangés.

### 4.3 Configuration guidée

Réutiliser le démarrage de boutique prévu par PROPOSITION-ONBOARDING, sans seconde copie :

1. **Votre boutique** : informations préremplies, identité visuelle facultative, activité confirmée.
2. **Votre premier article** : nom, prix et photo facultative ; article existant réutilisable, sauvegarde immédiate et reprise.
3. **Aperçu** : vérifier la vitrine ; ouverture publique toujours explicite ; ensuite partager.

Un commerçant déjà équipé arrive directement sur ce qui manque. Une boutique vide n'est pas présentée comme prête à vendre. « Plus tard » conserve le brouillon. Aucune publication sociale ou de vitrine n'est déclenchée par l'acceptation du partenariat.

Le bénéficiaire n'a pas un second tableau de bord : dans sa boutique, une carte **Mon partenariat** donne statut, pack, échéance, crédits et prochaine action. « Mes médias » et « Mon Manager » sont des accès contextuels dans cet espace.

## 5. Essai et pack : un avantage exact, vérifié côté serveur

### 5.1 Cycle de vie

États distincts : brouillon → invitation disponible → acceptée/configuration → prête à activer → essai actif → expiré ; révocation possible et tracée. Distinguer expiration de l'invitation, suspension opérationnelle et fin de l'essai.

L'essai démarre à la première confirmation **Activer mon essai**, après acceptation et disponibilité effective du pack, jamais à la création de l'invitation. Action idempotente. Durée = un ou deux mois calendaires, fuseau Africa/Dakar ; conserver et afficher les dates exactes, y compris fin de mois. Calcul et contrôle côté serveur.

Rappels recommandés : J-7 et J-1 avant la fin, une seule fois par canal autorisé, avec le Manager ; pas de campagne payante automatique. Les dates se calculent depuis la fin réelle. Une prolongation humaine ajuste la date et laisse une trace.

À l'expiration :
- retirer uniquement les avantages temporaires ; conserver boutique, catalogue, commandes, accès de base et médias déjà produits ;
- aucune facturation ni reconduction payante automatique ;
- si aucune offre tarifée n'est validée, afficher **Demander la suite au Manager**, sans prix inventé ;
- informer sur les crédits inutilisés et traitements en cours selon les règles affichées avant activation ;
- rejouer l'invitation, changer de téléphone ou recréer un compte ne redémarre pas l'essai.

Pas de carte bancaire exigée pour l'essai offert. Suspension, prolongation, révocation et changement de pack nécessitent les droits adéquats et un journal.

### 5.2 Contenu du « full pack »

Créer un catalogue explicite des avantages, réutilisant les services existants : boutique/vitrine et personnalisation, catalogue et photos, commandes et factures, demande d'adresse et livraison, médias/partage, accompagnement du Manager, Studio de retouche d'articles. Les options réellement disponibles sont incluses dans le modèle de pack ; les limites et exclusions sont visibles avant activation.

Les services non encore livrés ou non configurés (ex. domaine propre, modèles IA indisponibles, fonctions médias en attente) ne sont pas annoncés comme actifs. Le Studio photo de bout en bout est un livrable obligatoire du mandat, coordonné avec l'action #48, pas un simple bouton « bientôt ». Les autres capacités Studio déjà demandées restent tracées dans leur mandat ; aucun modèle complexe supplémentaire n'est requis pour distinguer Agents et Ambassadeurs.

Avant envoi d'une invitation promettant le Studio, le modèle de pack doit avoir un quota et un plafond de coût approuvés, un fournisseur configuré et une chaîne testée. Si une dépendance manque, permettre de préparer la campagne et les fiches, mais garder l'offre concernée en brouillon ; ne pas démarrer son essai sur une promesse inopérante.

Vérifier les avantages et quotas sur chaque opération serveur. Un badge ou un raccourci visible ne donne aucun droit.

## 6. Médias, Studio et partage : finir le circuit

### 6.1 Parcours minimal indispensable

Depuis un article → **Améliorer la photo** → aperçu original/résultat → validation → **Utiliser cette photo** → aperçu du visuel de partage → **Partager**.

Réutiliser les photos d'articles, les exports et le partage existants. L'espace médias associe article, original, variantes, statut, date et résultat approuvé. Pas de remplacement destructif de l'original et pas de publication d'un résultat non validé.

Retouche fidèle : garder forme, couleur, motif, matière apparente, quantité, étiquette et marque du produit. Le traitement nettoie le fond/lumière/cadrage ; s'il ne peut conserver le produit, proposer de recommencer ou d'utiliser l'original. Tester les dérives, notamment texte de marque et motifs ; ne pas promettre une fidélité garantie par le seul prompt.

Conserver le format produit 4:5 et les règles photo existantes. Le visuel de partage réutilise les formats déjà pris en charge. Fournir une image téléchargeable et son lien de boutique/article via les outils existants ; ne pas prétendre publier automatiquement sur Instagram/TikTok ou connaître leur audience sans intégration vérifiée.

### 6.2 Exécution et coût Studio

- Clés du fournisseur uniquement côté serveur, jamais dans le navigateur ni les journaux.
- Quota consommé atomiquement, plafonds par partenariat et globaux, protection contre le double clic et les appels concurrents.
- Création de tâche idempotente ; états en attente, en cours, réussie, échouée, à reprendre. Temps limite et reprise après coupure réseau.
- Échec sans sortie exploitable : restitution du crédit utilisateur ; le coût fournisseur éventuel reste visible pour l'équipe, il n'est pas inventé comme nul.
- Si un coût réel est indisponible, le marquer « non reçu » ; distinguer estimation et coût mesuré. Une réservation de budget se réconcilie avec le coût réel.
- Définir avant activation la règle des tâches démarrées avant expiration ; recommandation : achever les tâches déjà acceptées dans leur budget réservé, refuser les nouvelles après expiration.
- Tester sans dépense avec des doubles de fournisseur ; le test réel reste nécessaire pour déclarer le Studio prêt, dans le budget autorisé. Si clé/crédits manquent, rapport BLOCKED_DEPENDENCY pour ce circuit réel, pas PASS simulé.

### 6.3 Mesure de l'essai

Tableau de bord lisible : boutique configurée, premier article, vitrine ouverte, retouche réussie et utilisée, partage ouvert, commande réellement reçue/livrée, retour du commerçant. Les réactions et vues sociales restent « non disponibles » sans preuve. Ne jamais transformer un clic de partage en publication ni attribuer automatiquement une vente au programme.

Objectif proposé pour le pilote : obtenir avant la fin de l'essai une utilisation autonome puis une réponse explicite du commerçant sur la poursuite. Aucun nombre de ventes ni revenu cible n'est annoncé comme acquis. Les chiffres du tableau de bord viennent des opérations réelles et excluent les données synthétiques.

## 7. Un Manager, deux accompagnements, des décisions humaines

Même infrastructure de conversation et point d'entrée de contact ; séparer programme, boutique, personne et conversation dans chaque contexte.

| Agent | Ambassadeur commerçant |
|---|---|
| Formation, test, activation, missions, preuves d'activité, gains, versements, difficultés terrain | Configuration de boutique, catalogue, Studio et médias, partage, première commande, retours produit, échéance et poursuite |

- Le Manager propose la prochaine action concrète et reprend l'étape en cours ; une action principale, pas un panneau de missions d'Agent dans la boutique Ambassadrice.
- Une personne cumulant les deux activités choisit le contexte si son message est ambigu ; aucun rattachement automatique de privilèges sur la seule correspondance d'un numéro.
- Le contexte demandé via WhatsApp ou dans l'application est revérifié côté serveur. Pas de données clientes, clé de gestion, lien privé de facture, numéro de versement ou données d'un autre programme transmis au modèle sans nécessité.
- Pas de duplication des historiques existants ; routage de leurs anciennes conversations vers Agents.
- Le Manager ne décide seul ni d'un versement, ni d'un nouveau tarif, ni d'une prolongation gratuite, ni d'une augmentation de quota, ni d'une activation payante. Il prépare une proposition pour l'équipe autorisée.
- Escalade humaine visible avec statut et responsable ; réponse selon les règles possible sans IA. Si l'IA ou WhatsApp est indisponible, aucune tâche principale ne doit être bloquée.
- Rappels WhatsApp : respecter les règles et tarifs actuels du fournisseur, vérifiés avant implémentation. Ne pas reprendre sans vérification les anciens chiffres de gratuité du dépôt ; hors capacité autorisée, préparer une action manuelle, sans simuler un envoi.
- Consentement aux messages et possibilité d'arrêter les rappels ; pas de publication ni d'envoi massif.

## 8. Back-office : voir, agir, tracer, régler, tester

Navigation Programmes : **Agents**, **Ambassadeurs**, **Manager** (filtres Agents / Ambassadeurs). Les rubriques présentes doivent être réutilisées, sans duplication.

**Agents** : dossiers, validation, formation/test, missions, commerçants accompagnés, gains, versements, fraude, suspension. Les finances continuent de contrôler les versements.

**Ambassadeurs** : bouton Inviter ; recherche, état d'invitation/essai, boutique, activité, contact selon droits, dates, pack, consommation, prochaine action et retour. Actions : aperçu du lien, préparer partage, révoquer/régénérer invitation, prolonger, modifier les futurs avantages, suspendre, terminer et noter le bilan. Toute modification sensible : confirmation, droits, motif et trace. Ne pas garder un jeton brut uniquement pour le réafficher.

**Manager** : conversations filtrées par programme, problèmes non résolus, prochaine action, échéances, propositions à accepter ou refuser. Les opérateurs n'obtiennent pas automatiquement des droits financiers ou de création de packs.

**Réglages** : modèles de packs versionnés, durées autorisées, quota et budget, rappels, interrupteurs, limites d'essai et état des fournisseurs. Un réglage futur ne change pas rétroactivement l'offre déjà acceptée sans action explicite et information.

**Sécurité** : appliquer les rôles existants ; super admin/Head of Stratégie pour la stratégie et les modèles selon délégation documentée, finances pour paiements, support en lecture selon périmètre. MFA et gestes sensibles existants conservés. Contrôles serveur, pas seulement boutons masqués.

**Journal et données** : qui a invité, lié, activé, prolongé, révoqué, modifié le pack ou marqué un versement ; ne pas recopier secrets ou médias dans les logs. Mettre à jour BACK-OFFICE et l'inventaire CONFORMITE-CDP pour le renommage des Agents, les invitations, essais, médias et prestataires réellement utilisés. Le Builder ne contacte pas la CDP.

## 9. Séquencement d'exécution — travail autorisé, pas de nouvelle étude à la place du produit

| Lot | Travail | Preuve de sortie |
|---|---|---|
| 0 | Inventaire réel, protection des données et caractérisation des parcours existants | Carte de correspondance ancien programme → Agents ; risques, tests de migration et dépendances listés ; aucun gain perdu |
| 1 | Migration sémantique Agents, routes compatibles, UI/formation/Manager/back-office et correction des droits/gains nécessaires | Reprise des comptes, liens, gains et conversations vérifiée ; tests d'isolation et de récompenses verts |
| 2 | Ambassadeurs : invitations, rattachement boutique, pack, activation, dates, fin/prolongation, contrôle des avantages et back-office | Circuit invitation → configuration → activation → expiration vérifié, sans compte forcé pour le commerçant |
| 3 | Studio photo réel, médias/partage, Manager à deux contextes et mesure | Produit original → retouche approuvée → article mis à jour → partage exploitable ; coûts et quotas vérifiés |
| 4 | Recette croisée, mise en ligne selon les règles existantes, vérification production et rapport | Preuves automatiques, preuves de déploiement et essais réels distincts ; limites honnêtement signalées |

Exécuter les lots jusqu'au bout sans s'arrêter à une maquette ou à un plan. Une dépendance externe manquante n'arrête pas les lots indépendants. Ne pas envoyer de vraies invitations ni créer de profils pour des personnes réelles pendant les tests. Préparer les modèles de messages et inviter uniquement des fixtures synthétiques dans les environnements autorisés.

Ne pas contourner les critères de recette déjà acceptés de l'accueil v2 ; articuler les composants et documenter l'ordre de mise en ligne. Ne pas mélanger une refonte globale à ce mandat. Toute mise en ligne respecte le pipeline et les autorisations déjà en vigueur.

## 10. Recette obligatoire et critères d'acceptation

Le Builder vérifie l'interface, les appels API, les écritures, les contrôles serveur et le résultat reçu ; une capture ou un test simulé seul ne vaut pas preuve de bout en bout.

| # | Scénario | Résultat exigé |
|---|---|---|
| T01 | Migration ancien ambassadeur rémunéré → Agent | Même compte, code, boutique rattachée, score, gains, versements et historique ; anciens liens opérationnels |
| T02 | Fondateur prépare invitation avec nom, activité, 1 ou 2 mois | Aperçu exact ; aucune date d'essai démarrée avant activation |
| T03 | Prélecture WhatsApp, lien ouvert plusieurs fois, double acceptation | Aucun effet GET ; une seule acceptation et un seul avantage |
| T04 | Invitation expirée/révoquée/régénérée/volée à un autre propriétaire | Message clair, aucun accès à la boutique ou aux données privées d'un tiers ; ancienne invitation inutilisable après révocation |
| T05 | Nouvelle boutique sans compte ; boutique déjà possédée ; membre sans droit propriétaire | Création ou rattachement légitime, pas de doublon ni de prise de contrôle ; reprise du brouillon |
| T06 | Activation, fin de mois, 1 ou 2 mois, changement d'heure du téléphone | Dates exactes côté serveur, essai inchangé au rechargement ou sur un second appareil |
| T07 | Expiration et prolongation, avec tâche Studio en cours | Plus de nouvelle consommation après fin ; tâches déjà acceptées traitées selon règle annoncée ; données conservées, aucun débit automatique |
| T08 | Double clic Studio, tâches concurrentes, échec, timeout, reprise, quota épuisé | Aucun double débit ni dépassement ; crédit restitué selon règle ; résultat toujours retrouvable |
| T09 | Retouche réelle sur photos synthétiques, contrôle marque/couleur/motif | Original conservé ; sortie approuvable et exploitable en 4:5 ; comparaison documentée, fidélité non présumée |
| T10 | Partage WhatsApp Android → iPhone et inversement | Visuel/lien exploitables ; destinataire ouvre la bonne vitrine/article sans compte ; pas de publication sociale inventée |
| T11 | Même personne Agent + boutique Ambassadrice + acheteur ailleurs | Activités accessibles, contextes distincts, aucun gain sur sa propre activation et aucun avantage propagé à autrui |
| T12 | Changement de compte/téléphone partagé et retrait d'un membre | Aucune ressource privée de la personne précédente exposée ; aucun privilège conservé par un membre révoqué |
| T13 | Manager application/WhatsApp, ambiguïté et panne IA | Bon programme, bon destinataire, pas de fuite entre boutiques, repli utile et escalade humaine |
| T14 | Rôle support/modération/finances/stratégie non autorisé | API refuse les actions hors périmètre ; actions légitimes tracées ; MFA maintenue |
| T15 | Gain atteint dans les délais sans consultation puis calcul tardif | Gain attribué une seule fois selon date réelle ; aucun gain créé par l'essai Ambassadeur seul |
| T16 | Parcours existants adresse/événement/commande/livreur/stock/paiement manuel | Non-régression ; aucune confusion de libellé, aucun compte ajouté au destinataire, pas de perte de commande |

Vérifier navigateur Chromium et WebKit, mobile 320/390 px et desktop, thèmes système clair/sombre, clavier, mouvement réduit, réseau lent, interruption et messages d'erreur. Une seule action principale par écran ; les actions administratives secondaires sont repliées.

Exiger une vraie recette iPhone + Android (WhatsApp, sélection photo, reprise, téléchargement et ouverture du lien). Sans appareil disponible, noter **NOT_RUN — appareil manquant** et préparer une grille précise pour le fondateur ; ne pas appeler l'émulation « test iPhone réel ».

## 11. Rapport de livraison attendu

Créer RAPPORT-AGENTS-AMBASSADEURS-001.md avec :
- commit de référence, diff, migrations et compatibilité des anciens liens ;
- matrice T01–T16 : PASS / FAIL / NOT_RUN / BLOCKED_DEPENDENCY, environnement, commande ou geste, preuve et limite ;
- résultats des suites et contrôles production effectivement exécutés, avec SHA et run GitHub ;
- captures des deux parcours, du Manager et du back-office ; aucune donnée réelle ni secret ;
- état de chaque avantage du pack et preuve Studio réelle, fournisseur/budget/consommation sans clé secrète ;
- dépendances précises qui requièrent une action externe du fondateur, procédure de retour arrière et conservation des données ;
- verdict final : construit / déployé / testé séparément. Zéro déclaration « tout fonctionne » sans preuve.

Mettre à jour HANDOFF à chaque lot. Ne pas marquer le mandat terminé tant que des critères obligatoires échouent ; s'il manque un service ou un appareil, signaler clairement le reste plutôt que laisser une promesse commerciale fausse.

## 12. Message d'invitation proposé (modèle, aucun envoi autorisé par ce dépôt)

« Bonjour [Prénom], nous avons choisi [Marque] pour découvrir Fii La comme Ambassadeur. Votre invitation comprend [avantages exacts] pendant [1 ou 2 mois], à partir de votre activation, avec l'accompagnement de notre Manager. Configurez votre boutique ici : [lien privé]. Aucun paiement automatique à la fin de l'essai. »

Le message final ne mentionne le Studio que lorsque ses accès et crédits sont réellement prêts. L'envoi réel est fait par le fondateur ou après son instruction explicite à l'équipe.

