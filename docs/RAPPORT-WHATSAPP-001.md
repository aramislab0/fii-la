# Rapport — Mandat WHATSAPP-001 (messages premium, photo signature, mouvement)

> Tenu par le Builder, lot après lot. Statuts : **PASS** (vérifié, preuve citée), **FAIL**, **NOT_RUN** (vérification non faite), **BLOCKED_DEPENDENCY** (dépend d'un moteur, d'un compte, d'un budget ou d'une validation absents). Point d'entrée du mandat : [`MANDAT-WHATSAPP-001.md`](MANDAT-WHATSAPP-001.md).

## Lot 0 — Dépôt du kit (21/10/2026)

| Élément | Statut | Preuve |
|---|---|---|
| Kit importé dans `docs/kits/whatsapp-2026-10-21/` (38 fichiers) | PASS | SHA-256 des 38 fichiers = `MANIFEST.json`, 0 écart ; commit `10034b6`, 40 chemins relus sur `origin/main` |
| Point d'entrée, décision HANDOFF, action #57, entrée REVUE-VP | PASS | même commit |

## Lot 1 — Pilote « Indiquer mon entrée » (demande d'adresse)

### Ce qui est construit

- **Carte statique de marque** `web/media/wa/demande-adresse.jpg` (1200 × 800, 151 Ko) rendue par `scripts/render_wa_cards.py` à partir de `assets/photos/signature.png` et des textes du modèle `fiila_address_request_v1` du catalogue (kicker « VOTRE ENTRÉE », titre « Livrer à la bonne porte. », détail « Un point précis. Un repère utile. », repère Fii La), Montserrat. Dégradé vert à gauche sur le portail ; visages, mains et colis dégagés. Rendu **déterministe** (deux rendus = même empreinte MD5) ; aucune IA appelée. Aucune donnée personnelle dans l'image, aucun faux bouton.
- **Partage** (écran de la demande, côté demandeur) : la carte est montrée au-dessus d'une seule action « Envoyer sur WhatsApp ».
  - téléphone qui sait partager un fichier (`navigator.canShare({files})`) : image + texte partis ensemble par la feuille de partage ; repli discret « Envoyer le texte seul » ;
  - sinon (ordinateur, navigateur ancien) : lien WhatsApp texte ; repli discret « Télécharger l'image » ;
  - échec du partage avec image : message clair, le repli texte reste là ; annulation : rien.
- **Texte** (modèle `fiila_address_request_v1`) : « Bonjour, *[vrai demandeur]* vous demande votre adresse pour : *[motif]* (réf. …). Indiquez votre entrée et, si utile, ajoutez une photo ou un repère. — Indiquer mon entrée : *[lien destinataire #/d/…]* — Votre adresse sert uniquement à cette demande. » Un seul lien ; jamais la clé de gestion.
  - Écart assumé au catalogue : pied « sert uniquement à cette demande » au lieu de « sert à cette livraison », car le motif d'une demande n'est pas toujours une livraison. Le prénom du destinataire n'est pas connu de Fii La : « Bonjour, » seul.
- **Page d'arrivée** du client (`#/d/<jeton>`) : sur-titre « Votre entrée », entrée de 240 ms (fondu + 10 px), supprimée si « réduire les animations » ; rien n'attend avant le clic ; ouvrir la page ne modifie rien.
- **Back-office** (règle n° 8) :
  - voir — Croissance → « Messages WhatsApp » : registre des 6 modèles (message, action, intégration, état Meta), aperçu de la carte, partages sur 30 jours (image + texte, texte seul, image téléchargée, échecs) avec la mise en garde « un partage ouvert ne prouve pas l'envoi » ;
  - agir / régler — Réglages : `wa_card_media` (1 = image + texte, 0 = texte seul, sans redéploiement) ; état Meta d'un modèle modifiable à la main (droit `settings`) ;
  - tracer — changement d'état Meta au Journal (`wa_template_status`) ;
  - tester — `tests/wacards.test.mjs`, `tests/wacards.sql.test.mjs`, bloc ajouté à `tests/backoffice.test.mjs`.
- **Migration** `20261022000000_fiila_wa_cards` : table `fiila.wa_templates` (6 modèles, tous `NOT_SUBMITTED`, seul `fiila_address_request_v1` en `MANUAL_PILOT`), réglage `wa_card_media`, mesure `wa_card` (variantes contrôlées), `fiila_bo_wa`, `fiila_bo_wa_status`, `fiila_app_flags.wa_card`.

### Tests

| Vérification | Statut | Preuve |
|---|---|---|
| Message : vrai demandeur, motif, un seul lien destinataire, pas de clé de gestion | PASS | `wacards` Chromium |
| Sans partage de fichier : texte WhatsApp + « Télécharger l'image » (fichier `fii-la-demande-adresse.jpg`), mesures | PASS | `wacards` Chromium |
| Partage de fichier **[SIMULÉ]** : JPEG complet + texte ensemble ; annulation muette ; échec → message, mesure | PASS | `wacards` Chromium |
| `wa_card_media = 0` → texte seul | PASS | `wacards` Chromium |
| Page d'arrivée : animation présente, absente en mouvement réduit, aucune écriture | PASS | `wacards` Chromium |
| Registre, mesure, droits, journal, réglage | PASS | `wacards.sql` 4/4 |
| Back-office : registre, aperçu, état Meta enregistré, réglage listé | PASS | `backoffice` 13/13 |
| Mêmes parcours sous WebKit | voir CI | ajouté à la liste WebKit de `pages.yml` |
| Partage réel image + texte vers WhatsApp sur Android et iPhone (le texte accompagne-t-il l'image ? compression ? aperçu du lien ?) | **NOT_RUN** | pas de téléphone physique ; à faire par le fondateur (liste plus bas) |

### Canaux

| Canal | État |
|---|---|
| Partage manuel (téléphone du demandeur) | Livré en pilote, confirmation d'envoi par l'utilisateur dans WhatsApp |
| API WhatsApp Business (envoi par Fii La) | **NOT_SUBMITTED** : aucun modèle soumis à Meta, aucun envoi ; numéro réel, jeton permanent, prix et consentements non vérifiés pour cet usage → **BLOCKED_DEPENDENCY** (jeton permanent et numéro définitif côté fondateur, action #51) |
| Média animé (MP4) | Non intégré : les 3 MP4 du kit sont des essais de cadrage ; gestes des personnes **BLOCKED_DEPENDENCY** (moteur vidéo et budget non autorisés) |

### Recette physique à faire (fondateur, 5 minutes)

1. Sur Android puis iPhone : créer une demande d'adresse (`#/demande/nouvelle`, nom et motif de test), toucher « Envoyer sur WhatsApp », choisir WhatsApp, s'envoyer le message à soi-même.
2. Vérifier : l'image arrive, le texte est bien sous l'image (si le texte manque, utiliser « Envoyer le texte seul » et le noter), le lien s'ouvre sur « … vous demande votre adresse ».
3. Répondre avec une adresse de test, puis supprimer la demande.

### Retrait

Réglage `wa_card_media = 0` (immédiat, sans redéploiement) : retour au partage texte d'avant. La table et la mesure peuvent rester (aucun effet sur l'application).
