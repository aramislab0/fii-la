# Fii La — règles pour tout agent qui travaille dans ce dépôt

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
