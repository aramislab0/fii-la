# STUDIO-FIABLE-001 — Feu vert d'exécution

> Fondateur, 28/10/2026, ChatGPT : « arrondis a 10 credit de bienvenue. je financerai les cadeaux avant lancement. informe claude et demmarons ».
> **Exécution autorisée maintenant** : Studio fiable avant vente, mesures par décor, affichage 6 + Plus, et pilote de 9 décors dans le plafond de recherche de **5 USD au plus** présenté au fondateur. Ce plafond est distinct des cadeaux et n'augmente pas le budget de production.
> Source des prix et droits : `OFFRE-COMMERCIALE-001.md`, révisée au bonus de 10. Source de la revue : `REVUE-VP.md`, avis du 28/10.
> Base examinée : `d65d01750f3145811cdda075cb3903ffc48007c3`. Ce commit transmet le mandat, ne prétend pas avoir exécuté le code ou engagé une dépense.

## 1. Répartition et ordre

- **Claude / Builder** : commencer le lot A ci-dessous ; mesures et 6 + Plus après la fiabilité. Réutiliser l'architecture, les réglages et le back-office actuels ; préserver la charte et les données.
- **Codex / VP** : produire les 9 propositions de décors vides, 3 mode / 3 chaussures / 3 beauté-produits, avec les packs XEL ; direction et contrôle visuel. Cette création d'aperçus ne constitue pas un test d'intégration produit.
- **Builder** : intégrer les propositions dans une branche de travail privée XEL, exécuter 2 essais par décor avec produits synthétiques, documenter coûts et résultats sous le plafond cumulé de 5 USD ; jamais de donnée réelle pour la recette.
- **Fondateur** : approbation artistique de chaque décor avant ACTIVE, financement des cadeaux avant campagne et décisions externes restantes (HT/TTC, contrats, date).
- Aucun entraînement de modèle, achat de domaine ou lancement de campagne n'est impliqué. XEL #130 reste non fusionnée ; ne pas déduire son autorisation de fusion du présent feu vert.

## 2. Lot A — Studio fiable, prioritaire

**Règle commerciale :** Fidèle 1 crédit, Premium 3, par génération techniquement réussie et durablement récupérable. « Garder », télécharger à nouveau et publier ne débitent pas une deuxième fois. Autre proposition = nouvelle génération facturable annoncée. Échec technique = libération ou recrédit unique.

### Critères de réussite

1. Réserver **atomiquement** le crédit client et le coût fournisseur selon le moteur avant tout appel payant ; deux téléphones ou deux boutiques ne dépassent ni le solde ni le budget commun. Aucun simple test « dépense terminée < plafond ».
2. Conserver le résultat dans un stockage maîtrisé et récupérable par la boutique avant finalisation du débit ; un lien temporaire fal et une sauvegarde exclusivement sur le téléphone ne suffisent pas. En cas de coupure après succès, retrouver la même génération sans nouvel appel payant.
3. Une identité idempotente de demande relie réservation, appel, résultat, débit, annulation/recrédit et coût réel. Les répétitions, retours tardifs et finalisations concurrentes restent sans double effet.
4. Distinguer coûts réellement facturés, réservés et estimés ; les appels partiellement réussis peuvent coûter au fournisseur même si le client est recrédité. Ne pas effacer cette dépense. Traitement explicite des délais dépassés et des jobs abandonnés, sans relance incontrôlée.
5. Préserver les crédits acquis et essais partenaires. Préparer des lots séparés : bienvenue 10, abonnement Business 60/période et achats ; une expiration ou un changement de plan n'efface pas un achat.
6. Prévenir les boutiques du changement du débit « garder » vers « résultat livré », afficher le prix avant génération et le solde après. Un seul CTA principal.
7. Back-office dans le même lot : solde/disponible/réservé, origine des crédits, jobs et états, coûts réalisés/réservés, erreur/recrédit et journal ; conserver les interrupteurs existants. Tests adaptés SQL + handler + navigateur, puis vérification du parcours déployé. Aucun résultat ni crédit factice laissé en production.

**Sortie attendue du Builder :** fichiers/commit, résultats des tests, état réellement déployé, critères ci-dessus vérifiés, écart éventuel et retour arrière. Pas de chantier facturation complet avant ce lot.

## 3. Mesures et bibliothèque

- Par décor **et version/mode** : exposition réelle, génération livrée, panne, rejet explicite, garde et publication ; pas de clic assimilé à une publication réussie.
- Afficher 6 décors puis Plus ; au plus un candidat nouveau parmi les six, rotation hebdomadaire stable durant une session, favoris conservés.
- Seuil de garde = alerte de revue ; pas de retrait automatique ni d'auto-promotion. Pas de conclusion forcée à 30 jours avec trop peu de données.
- Aperçus : 4:5, maître cible 1024 × 1280 sRGB, vide, sans produit/personne/texte/logo ; résultat non garanti identique à l'aperçu. Une image de référence ne guide pas FIBO masqué de la même façon que FIBO libre : respecter les limites du moteur.
- Prompts, fiches lumière/caméra, VGL expurgé et références restent dans **XEL privé**, jamais dans le dépôt produit public. Sources, versions, coûts, tests et statut PROPOSED traçables.
- Le plafond de 5 USD est un **maximum de recherche**, pas une dépense déclarée ; arrêter avant dépassement. Si Codex fournit les aperçus, ne pas les régénérer sur fal sans besoin.

## 4. Cadeaux avant lancement

- **10 crédits une seule fois par commerçant éligible**, sur toutes les offres ; valeur catalogue **1 000 FCFA**, provision de production **400 FCFA** avec l'hypothèse 40 FCFA/crédit.
- Attribution après boutique publiée + premier produit réel et contrôle d'unicité ; durée 30 jours annoncée. Pas de nouveau bonus à chaque boutique recréée ou changement de plan.
- Le fondateur financera l'enveloppe avant lancement ; montant total encore non fixé. Préparer le mécanisme, **ne pas activer la campagne ni distribuer les crédits globalement maintenant**.
- Préserver / réconcilier Maison OUMY et les crédits déjà accordés ; aucun retrait rétroactif.
- Le plafond de production actuel de 10 USD n'est pas augmenté par ce document. Ne pas vendre des crédits dont la livraison serait bloquée silencieusement par ce plafond. Décrire l'enveloppe financée avant vente.
