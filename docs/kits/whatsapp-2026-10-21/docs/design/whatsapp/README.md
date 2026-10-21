# Fii La — Messages WhatsApp v1

> **Lecture actuelle :** ce document conserve une étape du travail. Les statuts, sources photo à retenir et consignes courantes sont dans `00-LIRE-DABORD.md`, `01-MANDAT-CLAUDE-CONSOLIDE.md` et `02-DECISIONS-ET-STATUTS.md` à la racine de ce paquet. Les anciennes photos intégrées aux captures v2 ne sont plus les sources photo de production.

> **Mise à jour validée — 21/10/2026 :** la direction photographique v2 fait désormais référence. Lire [PHOTO-V2-VALIDEE](PHOTO-V2-VALIDEE.md). Trois nouvelles captures sont incluses ; la v1 reste conservée.

Date : 21/10/2026. Mandat : [WHATSAPP-001](../../MANDAT-WHATSAPP-001.md).

## Validation et périmètre

Le fondateur a validé la référence Ambassadeur avec bouton API et son repli manuel. Les cinq autres images sont les déclinaisons demandées, proposées dans cette même direction. Aucun message n'a été envoyé ; aucune acceptation de template, animation ou intégration n'est déclarée.

## Captures de référence

| Usage | Maquette générée | Action |
|---|---|---|
| Ambassadeur — API, référence validée | [Capture](../../screenshots/whatsapp-v1/01-ambassadeur-api.png) | Voir mon invitation |
| Ambassadeur — manuel | [Capture](../../screenshots/whatsapp-v1/02-ambassadeur-manuel.png) | Lien dans le texte |
| Agent | [Capture](../../screenshots/whatsapp-v1/03-agent-api.png) | Commencer |
| Commande | [Capture](../../screenshots/whatsapp-v1/04-commande-api.png) | Voir ma commande |
| Demande d'adresse | [Capture](../../screenshots/whatsapp-v1/05-demande-adresse-api.png) | Indiquer mon entrée |
| Livraison | [Capture](../../screenshots/whatsapp-v1/06-livraison-api.png) | Suivre ma livraison |
| Événement | [Capture](../../screenshots/whatsapp-v1/07-evenement-api.png) | Voir l'événement |

Les captures représentent une conversation simulée ; pas des templates fonctionnels. Ne pas envoyer l'écran complet. Reconstruire l'image d'en-tête seule, avec texte et bouton natifs du canal.

## Règles visuelles

- Média : vert #1E4A34, accent #C9E265, texte ivoire #F5F2EA ; Montserrat ; logo source `web/icons/icon-512.png`.
- Hiérarchie : marque discrète → contexte → titre court → détail utile ; une action.
- Corps du message : texte natif lisible même sans média. Une information personnelle n'a pas sa place dans une image publique de prévisualisation.
- Bouton API : natif, non recoloré dans une fausse interface Fii La ; partage manuel : URL dans le texte, aucun faux bouton dans l'image.
- Le bleu, les marges et la typographie de WhatsApp dans ces maquettes sont indicatifs. Vérifier le résultat dans l'application réelle.
- La version statique est le standard ; le mouvement léger est prévu d'abord dans la destination Fii La. Contrat précis dans le mandat.

`catalogue.json` porte les textes et contrats de destinations ; `manifest.json` porte les empreintes et la provenance des captures. Les champs de destination sont sémantiques : vérifier les vraies routes avant intégration.
