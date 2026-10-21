# Rapport — Mandat AGENTS-AMBASSADEURS-001

> Tenu par le Builder, lot après lot. Chaque élément est classé **CONSTRUIT** (dans le dépôt), **DÉPLOYÉ** (en production, preuve GitHub Actions ou MCP) et **TESTÉ** (commande et résultat). Une vérification non faite est notée **NOT_RUN**.

## Lot 1 — Inventaire et garde-fous de migration (21/10/2026)

### Inventaire de l'existant (programme rémunéré actuel « Ambassadeurs », marque « Fii La Carrière »)

**Base (schéma `fiila`)** — tables gardées telles quelles (migration additive, pas de renommage interne) :
`ambassadors`, `ambassador_shops`, `ambassador_rewards`, `ambassador_quiz`, `ambassador_quiz_runs`, `amb_messages`, `amb_tasks`, `amb_notes`, `amb_objectives`, `amb_missions` ; fonctions internes `amb_eval`, `amb_refresh`, `amb_json`, `amb_rule_reply`, `amb_say`, `amb_plan_day`, `amb_digest`… ; fonctions publiques `fiila_ambassador_*`, `fiila_amb_*`, `fiila_admin_ambassador*`, `fiila_bo_career*`, `fiila_wa_*`.
Migrations concernées : `20261019700000_fiila_ambassadors`, `…20261020000000_fiila_backoffice`, `…20261020200000_fiila_shop_team`, `…20261020500000_fiila_bo_new_features`, `…20261020700000_fiila_amb_quiz_live`, `…20261020800000_fiila_bo_ambassadors`, `…20261021000000_fiila_amb_manager`, `…20261021200000_fiila_amb_whatsapp`.

**Application (`web/app.js`)** — 131 lignes contiennent « ambassad… », 21 « Carrière ». Libellés visibles à renommer : espace (`#/ambassadeur`), inscription, charte, formation, test de passage, carte d'agent, grades (« ambassadeur, confirmé, certifié »), missions, portefeuille, classement, « Code ambassadeur » (création de boutique, réglages), Manager, back-office (navigation, rubriques Ambassadeurs et Manager Carrière, journal, réglages, file d'attente), page de confidentialité. Identifiants internes (`fiila_ambassador_*`, ids HTML, clés) inchangés.

**Fonctions Edge** — `fiila-manager` (consignes du modèle : « programme d'ambassadeurs »), `fiila-whatsapp` (texte aux numéros inconnus : « Manager de Fii La Carrière… ambassadeur »).

**Adresses existantes à garder valides** : `#/ambassadeur`, `#/ambassadeur?…`, `#/bo/ambassadeurs`, `#/bo/ambassadeurs/<id>`, `#/admin/ambassadeurs`, `#/bo/carriere`, `#/bo/carriere/<id>`, codes d'agent (6 caractères) tapés à la création de boutique.

### Mesure de référence en production (lecture seule, 21/10/2026 ~04:50, MCP `execute_sql`)

| Table | Lignes |
|---|---|
| ambassadors | 1 |
| ambassador_shops | 0 |
| ambassador_rewards | 0 (dont versés : 0) |
| ambassador_quiz_runs | 1 |
| amb_messages | 4 |
| amb_tasks | 0 |
| amb_notes | 0 |
| amb_objectives | 0 |
| amb_missions | 3 |

Ces chiffres doivent être identiques après la migration du lot 2 (contrôle à refaire et à noter ici).

### Écart constaté dans les règles de gain (à corriger au lot 2)

`fiila.amb_eval` décide les niveaux **au moment où l'espace est ouvert** : niveau 1 exige « conditions remplies ET lien de moins de 7 jours » au moment du calcul, niveau 2 « moins de 30 jours », niveau 3 compte « les 8 dernières semaines à partir d'aujourd'hui ». Un commerçant éligible au jour 6 dont l'agent n'ouvre son espace qu'au jour 8 ne génère aucun gain : contraire au mandat (§3). Correction prévue : la date d'éligibilité est enregistrée quand elle est atteinte (déclencheurs sur articles, boutique et commandes), et le calcul utilise ces dates, pas la date d'ouverture. Montants et seuils approuvés inchangés.

### Garde-fous retenus

1. Migrations additives uniquement (colonnes, tables, fonctions) ; aucune suppression ni renommage de table.
2. Adresses existantes conservées par des alias ; nouvelles adresses `#/agent` et `#/bo/agents`.
3. Test automatique de migration : données d'agent synthétiques créées **avant** la migration, puis vérifiées après (code, rattachements, gains, versements, messages, quiz).
4. Contrôle des comptages en production avant / après (tableau ci-dessus).
5. Retour arrière : les libellés sont dans l'application (redéploiement de la version précédente) ; les colonnes ajoutées sont sans effet sur l'existant.

| | Statut |
|---|---|
| CONSTRUIT | Ce document (inventaire, référence, garde-fous) |
| DÉPLOYÉ | Sans objet (documentation) |
| TESTÉ | Comptages de production lus (lecture seule) |

## Lot 2 — Migration des Agents (21/10/2026)

**CONSTRUIT**
- Migration `20261021700000_fiila_agents_eligibility.sql` (additive) : colonne `ambassador_shops.l1_at` ; fonction `fiila.amb_stamp` et 3 déclencheurs (articles, boutique, rattachement) qui enregistrent la date d'éligibilité au niveau 1 quand elle est atteinte ; `fiila.amb_eval` corrigée : niveau 1 dû si l'éligibilité est datée dans les 7 jours (quel que soit le jour du calcul), niveau 2 sans condition sur le jour du calcul (commandes déjà limitées aux 30 premiers jours), niveau 3 par fenêtre glissante entre le 60e et le 120e jour. Montants, seuils et délais inchangés. Libellés serveur « Code ambassadeur » → « Code agent ».
- Application : libellés visibles « Ambassadeur(s) » → « Agent(s) » (espace, inscription, charte, formation, test, grades « Agent / Agent confirmé / Agent certifié Fii La », missions, gains, Manager, back-office, journal, réglages, confidentialité). Nouvelles adresses `#/agent` et `#/bo/agents` ; anciennes adresses `#/ambassadeur`, `#/carriere`, `#/bo/ambassadeurs/<id>` toujours valides. Marque du programme « Fii La Carrière » conservée (nom affiché du numéro WhatsApp du Manager).
- Fonctions Edge (dépôt) : consignes du Manager et message aux numéros inconnus disent « agent ». Redéploiement manuel (MCP) après la mise en ligne du lot.
- Tests : `tests/agents.sql.test.mjs` (5) — éligible jour 6 / calcul jour 8 → gain dû ; éligible jour 8 → pas de gain ; niveau 2 calculé au jour 40 → dû ; auto-rémunération et double attribution refusées, aucun gain recréé ; **migration** : agent, code, rattachement, gain versé et message créés avec les migrations antérieures, puis migration appliquée → comptages et code identiques, gain versé intact. `tests/db.mjs` sait maintenant créer une base « avant migration » (`createDb({ before })`, `applyMigrations`).

## Lot 3 — Programme Ambassadeurs (marques invitées), packs, essai (21/10/2026)

**CONSTRUIT**
- Migration `20261021800000_fiila_partners.sql` : droits `partners` (super admin, Head of Stratégie, Opérations) et `partners_admin` (super admin) ; tables `partner_packs` (versions immuables une fois utilisées), `partner_invites` (empreinte du jeton seulement, expiration 30 jours, révocable, régénérable), `partner_trials` (une par invitation, une par boutique) ; réglage `studio_ready` (0) ; fonctions publiques `fiila_partner_invite` (lecture seule), `fiila_partner_accept` (preuve : clé ou compte propriétaire ; idempotente pour la même boutique ; refus pour une autre, révoquée, expirée, boutique désignée différente, essai déjà eu), `fiila_partner_activate` (seulement si le pack est prêt ; `pack_blocked_dependency` sinon ; idempotente), `fiila_partner_mine` ; back-office `fiila_bo_partners`, `fiila_bo_pack_save`, `fiila_bo_partner_invite`, `fiila_bo_partner_action` (nouveau lien, retirer, prolonger, suspendre, reprendre ; motif obligatoire pour retirer et suspendre ; journal). Dates : `fiila.trial_end` = minuit (Dakar) après N mois calendaires (31 janvier + 1 mois → 28/29 février inclus). Une boutique partenaire ne génère jamais de gain d'agent (`amb_eval`).
- Application : page `#/invitation/<jeton>` (carte de la marque, contenu exact du pack, « Accepter avec ma boutique » ou « Accepter et créer ma boutique » → démarrage guidé, acceptation automatique après l'étape 1) ; carte de l'essai dans le tableau de bord normal de la boutique (à activer / en cours jusqu'au… / pack en préparation / terminé + « Demander la suite au Manager ») ; back-office : rubrique **Ambassadeurs** (Programmes) distincte de **Agents** — « Inviter une marque », aperçu personnalisé, lien privé montré une fois, partage WhatsApp, liste et actions, packs en versions.
- Tests : `tests/partners.sql.test.mjs` (9), `tests/partners.test.mjs` (5, navigateur), `tests/backoffice.test.mjs` (+1 : pack, invitation, lien WhatsApp ; 15 rubriques).

**Limites assumées (non masquées)**
- Le contenu du « pack complet » n'est pas défini (action #56). Les tests utilisent des packs synthétiques. Sans version de pack, « Inviter une marque » est désactivé.
- Seul le quota « retouches Studio » est un droit chiffré appliqué par le serveur ; il ne sert qu'au lot 4 (Studio), lui-même en `BLOCKED_DEPENDENCY`. Les autres avantages sont affichés tels que rédigés par le fondateur et appliqués par l'équipe tant qu'ils ne correspondent pas à une fonction mesurable.
- « Partager sur WhatsApp » ouvre WhatsApp : ce n'est pas une preuve d'envoi.
