# Fii (ex-Fii La) — règles pour tout agent qui travaille dans ce dépôt

1. **Au début de chaque session** : lire `docs/HANDOFF.md` (état, décisions, actions en attente) et `docs/REVUE-VP.md` (retours du VP produit), s'il existe.
2. **À chaque action** (code, test, déploiement, décision, doc) : mettre à jour `docs/HANDOFF.md` dans le même commit :
   - section 2 « État actuel » si un état change ;
   - section 3 si une décision est prise (date, décision, qui) ;
   - section 4 si une action est ajoutée, faite ou débloquée ;
   - section 7 « Journal » : une ligne en haut (date et heure de Dakar, action, commit ou preuve).
3. Le VP produit valide l'alignement d'ensemble. Ses retours vivent dans `docs/REVUE-VP.md`. Un point « bloquant » du VP se traite avant toute nouvelle fonction ; un désaccord remonte au fondateur avec les options.
4. Ne jamais écrire de secret (mot de passe, clé privilégiée, jeton propriétaire) dans le dépôt, les journaux ou les conversations.
5. Tests et démonstrations : données synthétiques uniquement ; supprimer ce qui a été créé. Ne jamais toucher aux fiches réelles.
6. Ne jamais contacter la CDP, publier sur un compte réel ni activer un service payant sans accord explicite du fondateur.
7. **Règle d'interface « simple et intuitif »** (fondateur, 19/10/2026, pour toute l'application et tous les builds à venir) :
   - une seule action principale et une seule rangée de filtres visibles par écran ; les filtres et réglages secondaires vont dans « Filtres » (feuille) ou une section repliée ;
   - jamais de choix inutile : une option unique (une seule taille, une seule couleur) s'affiche en texte, pas en bouton ;
   - une ligne d'informations discrète plutôt que plusieurs ;
   - avant de livrer un écran, vérifier sa capture : si l'écran paraît chargé, replier ou retirer avant d'ajouter.
8. **Back-office à jour à chaque fonction** (fondateur, 20/10/2026, « que ça devienne une habitude ») : toute nouvelle fonction est livrée avec sa partie back-office dans le même commit — voir, agir, tracer, régler, tester (liste de contrôle dans `docs/BACK-OFFICE.md`). Le message de livraison au fondateur dit ce qui a été ajouté au back-office.
