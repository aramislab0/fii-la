# Mandat consolidé pour Claude — WHATSAPP-001 / PHOTO / MOTION

## Autorisation et résultat attendu

Assane a validé la direction premium des cartes, demandé les déclinaisons et les mandats d'intégration, d'animation et d'amélioration, puis retenu l'image signature dédiée. Sa demande finale est un kit complet avec tous les éléments et instructions. Ne pas redemander l'accord de principe pour l'exécution déjà autorisée.

**Résultat attendu :** une carte pilote « Indiquer mon entrée » effectivement partageable, ouvrant la bonne ressource, avec source photo retenue, déclinaison statique et média animé ; puis déploiement de la même grammaire sur les autres usages, avec preuves. La qualité visuelle ne remplace pas le bon destinataire, le bon lien et les bons droits.

## A. Prise en charge et dépôt

1. Sécuriser le lot courant. Synchroniser le dépôt et lire ses instructions, HANDOFF, REVUE-VP, le mandat Agents/Ambassadeurs, le partage existant et l'intégration WhatsApp réellement disponible.
2. Vérifier si WHATSAPP-001 et une version plus récente de ces documents existent. Réconcilier ; ne pas créer de doublon ou remplacer les mises à jour concurrentes.
3. Copier les ressources dans les emplacements de documentation/médias du dépôt conformes à ses règles. Les chemins du kit peuvent être conservés sous `docs/kits/whatsapp-2026-10-21/`, ou les fichiers être placés dans les dossiers canoniques avec liens corrigés. Ne pas créer deux sources de vérité.
4. Garder `docs/MANDAT-WHATSAPP-001.md` comme point d'entrée, lié au présent mandat et au manifeste. Référencer la décision, l'état, la prochaine action et le journal dans HANDOFF ; ajouter une entrée en haut de REVUE-VP dans le même commit documentaire. Choisir le prochain numéro d'action libre.
5. Committer/pousser selon les règles courantes, relire les fichiers distants et rapporter le SHA réel. Aucun force-push ni fusion implicite. Un dépôt documentaire n'est pas une fonction terminée.
6. Si l'écriture est refusée, conserver les fichiers et signaler NOT_COMMITTED. Ne pas contourner le refus.

## B. Référence créative courante

- Logo/palette du dépôt : vert profond #1E4A34, lime #C9E265, ivoire #F5F2EA ; Montserrat dans les médias et pages Fii La.
- Texte prioritaire, une action, pas de badge décoratif, de collage ou de fausse interface.
- Source principale : `assets/photos/signature.png`. Relation humaine au bon seuil ; nature illustrative clairement conservée dans la provenance.
- Sources complémentaires : `commerce.png` et `evenement.png`. Elles servent la direction, sans inventer un vrai commerçant, produit ou lieu.
- Préserver un espace calme pour le titre, la lisibilité sur petit écran et les regards/mains. Recadrer ou modifier le dégradé plutôt que couvrir un visage.
- Les 10 maquettes sont des références de composition. Reconstruire les médias de marque seuls ; ne jamais envoyer une capture de conversation WhatsApp complète.
- Produire des gabarits éditables et déterministes. Ne pas appeler une IA de génération à chaque notification.
- Les visuels photo intégrés aux anciennes maquettes v2 ont été remplacés comme sources créatives par les photographies dédiées. Ne pas les réinstaller par défaut.

## C. Pilote et déclinaisons

**Pilote — demande d'adresse :** photo signature, message nommant le vrai demandeur, motif compréhensible, action unique « Indiquer mon entrée », lien destiné au client et bon contexte conservé. Ni création de compte imposée au destinataire, ni clé de gestion transmise, ni photo de porte privée mise dans un aperçu public.

Puis réutiliser le catalogue pour :

| Usage | Action et point à contrôler |
|---|---|
| Ambassadeur | « Voir mon invitation » ; durée et avantages du pack réellement prêt ; essai ne démarre pas à la prélecture |
| Agent | « Commencer » ; parcours de formation/validation existant ; aucune confusion avec une marque Ambassadrice ou gain garanti |
| Commande | « Voir ma commande » ; enregistrée ne signifie pas payée ; si adresse manquante, une seule prochaine action contextuelle |
| Livraison | « Suivre ma livraison » ; message instantané à l'envoi, état actuel dans la fiche ; aucune ETA ou position inventée |
| Événement | « Voir l'événement » ; date/fuseau, modification/annulation et entrée effectivement renseignée |

Pour un produit réel, utiliser sa vraie photo autorisée ; à défaut, repli typographique ou illustration d'ambiance non trompeuse. Jamais un produit généré présenté comme l'article commandé.

## D. Canaux et contrôles

- Partage manuel : image/vidéo facultative + texte/lien, confirmation d'envoi par l'utilisateur. Vérifier le partage combiné sur téléphone ; proposer téléchargement et copie du texte en repli. Pas de faux bouton dessiné dans le média.
- API : vérifier format, compte/numéro émetteur, templates, consentements, fenêtre et prix réels Meta. Préparer les templates nécessaires et tracer leur état ; aucune acceptation présumée. Les couleurs et contrôles natifs ne sont pas ceux d'une carte HTML personnalisable.
- Le message Fii La ne doit pas usurper le numéro du commerçant. Nommer clairement celui pour qui le message est envoyé.
- Un seul CTA natif URL par message de cette famille. Les GET/robots/aperçus ne modifient aucune donnée métier.
- Vérifier autorisation, ressource et destinataire côté serveur. Gérer idempotence, reprise et erreurs sans doublons d'envoi ni double avantage.
- API acceptée, envoyé, délivré, lu, partage ouvert, clic attribuable et tâche réussie sont distincts. Aucun taux de conversion inventé.
- Respecter les décisions existantes sur le coût de l'API, notamment les livreurs. Ce mandat n'autorise ni nouveau service payant ni émission à un vrai destinataire sans autorisation applicable.
- Garder les réglages, aperçus, versions de templates, échecs, interrupteurs et traces dans le back-office existant. Ne pas bâtir une nouvelle plateforme de campagnes.

## E. Animation : exigence et état honnête

Le fondateur exige des images animées, dynamiques et premium. Les trois MP4 du kit sont **des essais de cadrage et de lumière**. Ils ne suffisent pas à déclarer réalisée l'animation des personnes. Ils ne sont pas validés par le simple fait d'être inclus dans ce kit.

Lire `04-ANIMATION-ET-RECETTE.md` : étapes, prompts par scène, contraintes de fidélité et critères de réussite. Utiliser uniquement un moteur vidéo/fournisseur et un budget autorisés. Si la dépendance manque, préparer toutes les autres briques, noter BLOCKED_DEPENDENCY pour les gestes et ne pas les simuler comme livrés.

Le texte/logo est posé en postproduction et reste stable. Aucun faux bouton animé, flash, pulsation insistante, son automatique, déformation de visage/produit ou attente imposée avant le clic. Le repli statique est toujours disponible. Tester le média et les limites réelles de WhatsApp ; autoplay non garanti.

## F. Améliorations autorisées

Corriger les textes trop longs, contrastes, cadrages, marges, poids/qualité après compression, messages d'erreur, états expirés et reprise. Documenter avant/après. Conserver marque, sens produit, durée choisie, avantages acquis et règles d'accès.

Ne pas annoncer le Studio avant qu'il soit effectivement disponible pour le pack. Ne pas transformer une ancienne maquette ou un montant fictif en engagement commercial. Un éventuel changement de droits, prix ou périmètre ne se déduit pas du travail visuel.

## G. Ordre et preuve de sortie

1. **Dépôt + pilote statique :** fichiers distants vérifiés, bonne destination, toutes les données synthétiques.
2. **Intégration du pilote :** partage manuel et chemin API autorisé, back-office et replis ; vidéo facultative ne bloquant pas la tâche.
3. **Motion finalisée :** essai de rythme puis gestes avec moteur autorisé ; comparaison source/résultat, images clés et média final.
4. **Recette physique Android/iPhone :** WhatsApp → message → média → lien → bonne fiche → action réussie → retour. Compression, réseau lent, interruption, changement de compte, lien révoqué, aperçus et double clic couverts.
5. **Déclinaisons + non-régression :** les autres usages reprennent la brique commune ; pas de nouveaux formulaires parallèles.

Rapport attendu : `docs/RAPPORT-WHATSAPP-001.md` avec SHA/runs, migrations s'il y en a, captures réellement obtenues, fichiers éditables, statuts Meta, état exact de chaque canal, tests PASS/FAIL/NOT_RUN/BLOCKED_DEPENDENCY, dépendances et retrait possible. Actualiser HANDOFF à chaque lot. Le VP examine les preuves ; le fondateur garde la décision finale.

## H. Contexte professionnel

Documenter idées, décisions, travaux, résultats et blocages accessibles à chaque exécution et en fin de session. Les états non prouvés restent inconnus. Fii La dans son dépôt ; contexte transversal confidentiel uniquement dans le corpus privé autorisé. Aucun export de toutes les conversations ni synchronisation globale automatique n'est impliqué.
