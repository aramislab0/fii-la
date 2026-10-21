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
