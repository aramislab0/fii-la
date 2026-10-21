# Fii La — Mandat WHATSAPP-001

> **Lecture actuelle :** ce document conserve une étape du travail. Les statuts, sources photo à retenir et consignes courantes sont dans `00-LIRE-DABORD.md`, `01-MANDAT-CLAUDE-CONSOLIDE.md` et `02-DECISIONS-ET-STATUTS.md` à la racine de ce paquet. Les anciennes photos intégrées aux captures v2 ne sont plus les sources photo de production.

> **Mise à jour validée — 21/10/2026 :** la direction photographique v2 fait désormais référence. Lire [PHOTO-V2-VALIDEE](design/whatsapp/PHOTO-V2-VALIDEE.md). Trois nouvelles captures sont incluses ; la v1 reste conservée.

Date : 21/10/2026, Africa/Dakar. Auteur effectif : CHATGPT/Codex, VP produit. Modèle exact : non exposé.
Source : instruction directe d'Assane dans cette conversation : « Je valide génère les autres et documente le repo avec les captures et donne lui les mandants d’animation et d’intégration et même d’amélioration si nécessaire ».
Statut : DESIGN DE RÉFÉRENCE VALIDÉ ; déclinaisons produites ; INTÉGRATION ET ANIMATION À EXÉCUTER PAR CLAUDE. Aucune émission de message ni intégration déclarée par ce document.
Dépôt observé avant préparation : `83614d7296fc4a4262489e3d084fea60837e1ac0`. Relire la branche courante avant toute modification.

## Vision / état actuel / prochaine action

- **VISION :** une signature de message Fii La reconnaissable, une raison de cliquer, une action par message, sans confusion entre Agents et Ambassadeurs.
- **ÉTAT ACTUEL :** le fondateur a validé le système visuel de l'invitation Ambassadeur API et son équivalent manuel. Les autres captures sont des déclinaisons de travail à vérifier ; ce sont des maquettes générées, pas des captures de messages réels ni une approbation Meta. Le mandat AGENTS-AMBASSADEURS-001 est enregistré et en exécution par Claude selon HANDOFF lu le 21/10.
- **PROCHAINE ACTION UNIQUE :** après sécurisation du lot en cours, intégrer ce système commun aux parcours existants, livrer l'animation de leurs pages d'arrivée et une recette réelle, sans refonte globale.

## 1. Passation et portée

1. Lire CLAUDE.md, HANDOFF, REVUE-VP, BACK-OFFICE et le mandat Agents/Ambassadeurs actuel.
2. Enregistrer ce mandat, le catalogue, les captures et le manifeste dans le dépôt. Référencer ce mandat en haut de REVUE-VP et dans les sections État, Décisions, Actions et Journal de HANDOFF, dans le même commit documentaire. Choisir le prochain numéro d'action disponible ; ne pas écraser les travaux concurrents.
3. Déclarer la prise en charge, puis exécuter jusqu'à la recette. Le dépôt documentaire ne termine pas le mandat.
4. Garder le périmètre d'exécution Claude ; le VP fournit le contrat produit et les maquettes. Ne pas introduire un second compte, un nouveau moteur de notification ou un back-office parallèle.
5. Rapport final : `docs/RAPPORT-WHATSAPP-001.md`. Distinguer préparé, construit, configuré, accepté par Meta, déployé et testé.

## 2. Références et statut des captures

Voir `docs/design/whatsapp/README.md`, `catalogue.json` et `manifest.json`.

Les images `docs/screenshots/whatsapp-v1/` montrent le message dans une conversation simulée. **Ne jamais envoyer la capture complète comme média** : reconstruire uniquement le visuel de marque, le texte et le CTA dans les composants réellement disponibles.

Référence source : logo lu dans `web/icons/icon-512.png`, tokens lus dans `web/styles.css` le 21/10 : vert #1E4A34, lime #C9E265, ivoire #F5F2EA ; Montserrat pour les médias/pages Fii La. La typographie, les couleurs et la géométrie des contrôles WhatsApp appartiennent à WhatsApp. La présentation exacte varie selon application et plateforme.

Les noms Awa, Boutique Démo, Rencontre Démo, D-021 et 18 000 FCFA sont des fixtures. Ne pas les publier comme clients ou résultats réels. Le lien `fiila.example` du partage manuel est volontairement fictif.

## 3. Mandat INTÉGRATION — un modèle commun, deux canaux

### 3.1 Architecture minimale

Créer un seul catalogue versionné de modèles avec : identifiant, révision, contexte métier, média, texte, variables autorisées, libellé d'action, résolution de destination, canal, état d'approbation et repli. Réutiliser le partage et le webhook WhatsApp existants. Le catalogue livré ici est une spécification éditoriale, pas un payload Meta prêt à envoyer.

Construire les médias de production de manière déterministe et éditable (assets de marque existants + gabarit texte, rendu serveur ou outil de rendu déjà présent). Ne pas générer chaque notification par IA. Garder les titres courts ; adapter réellement les noms longs, accents, montants et durées. Ne pas graver des informations qui deviennent rapidement fausses dans un visuel générique réutilisé.

### 3.2 Partage manuel

- Préparer image exportable, texte et lien corrects, avec aperçu dans Fii La ; laisser l'expéditeur confirmer l'envoi.
- Vérifier `navigator.canShare({files: ...})` lorsque disponible. Le partage de fichiers, texte et URL ensemble n'est pas présumé uniforme entre navigateurs et applications.
- Repli : télécharger le visuel puis copier le texte/lien ; ou texte/lien seul. Aucun média ne doit être obligatoire pour accomplir la tâche.
- Ne jamais présenter un faux bouton à l'intérieur de l'image comme cliquable ; l'action est le lien dans le texte.
- Distinguer aperçu préparé, partage ouvert et envoi réellement constaté. L'ouverture du partage n'est pas un message envoyé.

### 3.3 API WhatsApp Business

- Identifier le vrai numéro émetteur, le compte connecté et les capacités disponibles. Un message envoyé par Fii La ne doit pas se faire passer pour le WhatsApp du commerçant. Nommer la boutique dans le corps lorsque nécessaire.
- Vérifier les formats, fenêtres de conversation, consentements, catégories de templates, langues, contraintes de boutons et tarifs dans la documentation actuelle de Meta avant configuration. Aucun ancien chiffre de gratuité du dépôt ne fait autorité.
- Pour les envois qui exigent un template approuvé, préparer et enregistrer son état ; ne pas déclarer l'acceptation avant réponse Meta. Conserver un repli manuel tant que nécessaire.
- Un seul bouton URL natif par message de cette famille. Garder le libellé proposé court ; vérifier les limites propres au format réellement retenu.
- Contrôler l'événement métier et le destinataire côté serveur ; dédoublonnage par ressource, événement, destinataire, canal et révision. Reprises sans double envoi, erreurs explicites, journaux sans contenu sensible.
- API acceptée, envoyé, délivré et lu sont des états distincts. Les clics et tâches réussies ne se déduisent pas de ces états. Définir une attribution conservatrice ; sans preuve de provenance, signaler source inconnue.
- Pas d'activation payante, de nouvelle campagne, d'envoi réel, ni d'inscription automatique d'un numéro sans les autorisations applicables. La décision existante sans API payante pour les livreurs n'est pas annulée par le présent mandat : repli manuel pour ce périmètre, sauf nouvelle décision explicite.

### 3.4 Destination et confidentialité

- Résoudre une route existante pour la BONNE ressource et le BON destinataire. Le catalogue fournit un contrat de destination, pas des routes inventées. Les liens publics reçus restent accessibles sans compte selon les droits existants ; Agents et back-office conservent leurs protections.
- Ne jamais réutiliser une clé de gestion comme lien destiné au client. Aucun jeton, adresse précise, photo de porte, téléphone, montant privé ou donnée de client dans les captures du dépôt, les URLs de média publiques, les journaux ou les métadonnées de prévisualisation publiques.
- Les GET, aperçus WhatsApp et visites par robots ne consomment pas une invitation, ne démarrent pas un essai et ne changent pas une commande.
- Tester les routes avec fragment `#/...` existantes : ne pas supposer que le robot d'aperçu exécute le JavaScript ou voit le fragment. Si des aperçus distincts sont nécessaires, utiliser un point d'entrée compatible avec le déploiement existant, aux métadonnées minimales non sensibles, sans nouveau produit parallèle.
- En cas de lien expiré/révoqué, afficher l'état exact et une issue utile. Pour une livraison ou un événement, le message décrit l'état à l'envoi ; la fiche liée est la référence actuelle.

## 4. Mandat ANIMATION — mouvement utile, hors des contrôles WhatsApp

### 4.1 Priorité : pages d'arrivée Fii La

Appliquer un composant de mouvement réutilisable aux pages d'invitation, commande, demande d'adresse, suivi et événement existantes ; ne pas reconstruire leurs parcours.

Contrat proposé par le VP :

| Élément | Mouvement | Timing cible |
|---|---|---|
| Carte/entête Fii La | Opacité 0→1, translation verticale 8 px→0 | 240 ms, une fois |
| Repère lime | Échelle .96→1, sans rebond ni boucle | 280 ms, en parallèle |
| Contenu utile | Apparition groupée, pas de texte lettre par lettre | 180 ms ; délai maximal 80 ms |
| Confirmation métier | Retour visuel après succès confirmé côté serveur | 180–240 ms, une fois |

Ces timings sont des objectifs de conception à vérifier sur appareil, pas des performances mesurées. Le CTA est présent et utilisable dès que le parcours le permet ; aucune animation ou vidéo ne conditionne le clic. Zéro écran d'attente de marque. Réduire à un rendu immédiat si `prefers-reduced-motion: reduce`, sans perdre d'information. Aucun flash, son automatique, vibration imposée, décalage de mise en page ou animation récurrente du bouton.

### 4.2 Média animé facultatif

Produire une boucle de démonstration MP4 muette, environ 2 secondes, avec simple respiration lumineuse du repère ; image initiale et poster statique déjà lisibles. Livrer fichier source modifiable + MP4 + poster. Une version générique suffit avant toute multiplication par usage. Ne pas animer un faux bouton ou une fausse position de livreur.

Vérifier format, poids, qualité après compression et combinaison média/bouton acceptée par le canal réel. Ne pas promettre autoplay, GIF animé dans l'aperçu de lien ou bouton embarqué dans la vidéo. Le média animé reste optionnel et désactivé par défaut jusqu'à recette ; la version statique demeure le standard pour les tâches transactionnelles.

## 5. Mandat AMÉLIORATION — marge autorisée, limites

Claude peut corriger sans nouvel arbitrage : typographie, contrastes, retours à la ligne, poids des exports, textes trop longs, cohérence des statuts, erreurs, états vides, reprise réseau et adaptation aux formats réellement acceptés. Documenter avant/après et raison. Raccourcir la carte plutôt que réduire son texte jusqu'à l'illisibilité.

Ne pas transformer la palette, le logo, les définitions Agents/Ambassadeurs, la durée choisie, les avantages accordés ou la logique des droits. Ne pas promettre le Studio tant qu'il n'est pas opérationnel pour ce pack. Les captures Ambassadeur sont des démonstrations d'une offre cible, pas la preuve de sa disponibilité.

Simplification éditoriale permise : footer de commande « Enregistrée ne signifie pas payée » peut devenir une information de paiement factuelle issue du dossier, si elle est fiable ; la capture garde sa valeur de référence visuelle. Toute garantie de confidentialité doit correspondre aux accès et durées effectifs, sans promesse absolue non vérifiée.

## 6. Back-office et mesure

Réutiliser les rubriques en place : modèles (version, langue, état Meta, actif/inactif), aperçu synthétique, choix du contexte, échecs à reprendre, interrupteur du canal, journal des actions sensibles. Droits de stratégie, support et finances conservés ; ne pas autoriser le support à modifier les montants ou avantages.

Mesurer séparément : aperçu, partage ouvert, API acceptée, délivré, ouverture attribuable, action métier réussie. La conservation de ces données doit être bornée et documentée dans l'inventaire existant. Ne pas créer un suivi individuel supplémentaire seulement pour embellir un taux.

## 7. Lots et recette de sortie

| Lot | Livrable | Preuve requise |
|---|---|---|
| A — base statique | Catalogue unique, gabarit éditable, les 6 usages, partage manuel et replis | Exports et captures, bons textes et liens, données synthétiques |
| B — intégration | Résolution des destinations, droits, raccord API autorisé et back-office | Tests serveur/route, état des templates et numéro émetteur documentés ; repli disponible |
| C — mouvement et recette | Mouvement pages, MP4 optionnel, recette croisée, rapport | Réduction du mouvement, faible réseau, vrais téléphones et limites explicites |

Tests obligatoires :
1. Chaque modèle ouvre la bonne ressource ; aucune inversion client/boutique/organisateur/livreur.
2. Invitation Ambassadeur distincte d'Agent ; durée et avantages issus du pack réel.
3. Prélecture/GET, double clic, reprise et lien révoqué : aucun effet métier indu.
4. Noms longs, variables absentes, injection HTML, accents, montants et dates : texte valide, sûr et lisible.
5. Commande annulée, réglée, livrée ; événement modifié/annulé ; livraison sans position : pas de promesse fausse.
6. Échec Meta, timeout, template refusé, numéro non configuré : état honnête, pas de boucle d'envoi, repli utile.
7. Téléphone partagé/changement de compte et membre révoqué : aucune fuite ni privilège hérité.
8. iPhone et Android physiques via WhatsApp : sélection média, légende/lien, ouverture, retour, téléchargement et reprise. Sans appareil : NOT_RUN, jamais PASS d'émulation.
9. 320/390 px, lumière/sombre, clavier et réduction du mouvement. La maquette générée n'est pas une preuve de conformité pixel des contrôles WhatsApp.
10. Données synthétiques, environnement autorisé, nettoyage ; aucun vrai destinataire utilisé sans instruction dédiée.

Le rapport comprend PASS/FAIL/NOT_RUN/BLOCKED_DEPENDENCY par test, SHA/run, captures réelles expurgées, sources éditables, poids des médias, état des templates, dépendances, procédure de retrait et améliorations faites. Ne pas fabriquer le rapport avant l'exécution.

## 8. Sources techniques à relire au moment de l'intégration

- Collection officielle Meta : https://www.postman.com/meta/whatsapp-business-platform/overview
- Templates interactifs : https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive
- Types de médias : https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3
- Message avec aperçu : https://www.postman.com/meta/whatsapp-business-platform/request/xdvc1ph/send-text-message-with-preview-url
- GIF dans l'application : https://faq.whatsapp.com/674208810641277/

Références consultées pendant l'exploration le 21/10/2026 ; les limites exactes, tarifs et conditions d'envoi restent à vérifier dans la documentation applicable au compte et au format intégrés. Aucune tarification inventée.
