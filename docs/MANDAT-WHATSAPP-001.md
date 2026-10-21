# Mandat WHATSAPP-001 — messages WhatsApp premium, photo signature, mouvement

> **Point d'entrée du mandat dans le dépôt.** Mandat d'exécution autorisé par le fondateur (« traite ce document et exécute-le bien », 21/10/2026 05:55, Dakar), préparé par le VP (ChatGPT/Codex).
> Statut au dépôt : **ENREGISTRÉ — exécution en cours par le Builder.** Ce document n'est pas une livraison.
> Le dépôt du kit par la connexion du VP avait échoué (GitHub 403) ; importé ici par le Builder (empreintes SHA-256 des 38 fichiers vérifiées contre `MANIFEST.json`, 0 écart).

## Sources (kit importé tel quel)

- Kit : [`docs/kits/whatsapp-2026-10-21/`](kits/whatsapp-2026-10-21/) — ordre de lecture : `00-LIRE-DABORD.md`, **`01-MANDAT-CLAUDE-CONSOLIDE.md` (mandat courant)**, `02-DECISIONS-ET-STATUTS.md`, `03-DIRECTION-PHOTO-ET-PROMPTS.md`, `04-ANIMATION-ET-RECETTE.md`, `docs/design/whatsapp/catalogue.json`, puis `docs/MANDAT-WHATSAPP-001.md` (version détaillée historique du VP).
- Manifeste et contrôle : `MANIFEST.json`, `VERIFICATION-DU-PAQUET.json`.
- Image signature retenue : `assets/photos/signature.png` (générée, illustrative — jamais présentée comme un client, un lieu ou une porte réels).

Une seule source de vérité : les fichiers du kit restent dans `docs/kits/whatsapp-2026-10-21/` ; les médias de production dérivés (cartes rendues) vivent dans `web/media/wa/` et sont reconstruits par `scripts/render_wa_cards.py` à partir de ces sources.

## Décisions du fondateur reprises (voir `02-DECISIONS-ET-STATUTS.md`)

- Carte premium vert / lime, texte court, une seule action : **validé**.
- Photographies réalistes intégrées : **direction validée** ; image **signature** retenue ; `commerce.png` et `evenement.png` complémentaires.
- Images animées, dynamiques et premium : **exigence** ; les 3 MP4 du kit sont des **essais de cadrage**, pas des gestes.
- Canaux : partage manuel + API WhatsApp **validés comme direction** ; aucun modèle Meta soumis.

## Ordre d'exécution (mandat consolidé §G)

1. Dépôt + pilote statique « Indiquer mon entrée » (demande d'adresse).
2. Intégration du pilote : partage manuel, chemin API autorisé, back-office, replis.
3. Mouvement : pages d'arrivée ; gestes des personnes = moteur vidéo et budget autorisés (sinon `BLOCKED_DEPENDENCY`).
4. Recette physique Android / iPhone (sinon `NOT_RUN`).
5. Déclinaisons (Ambassadeur, Agent, Commande, Livraison, Événement) sur la brique commune.

Rapport : `docs/RAPPORT-WHATSAPP-001.md`.
