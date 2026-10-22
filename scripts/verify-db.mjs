// Vérifie la base déployée : migrations appliquées et droits d'accès du rôle public (anon).
// Usage : DATABASE_URL=... node scripts/verify-db.mjs   (l'URL n'est jamais affichée)
import { createRequire } from 'node:module';
import { writeFileSync, readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const EXPECTED_FUNCTIONS = [
  'fiila_courier_view', 'fiila_create_place', 'fiila_create_request', 'fiila_delete_place', 'fiila_delete_request',
  'fiila_fulfill_request', 'fiila_get_owned', 'fiila_get_public', 'fiila_get_request_owner', 'fiila_get_request_public',
  'fiila_join_meeting', 'fiila_meeting_guests', 'fiila_new_link', 'fiila_owned_summaries', 'fiila_position',
  'fiila_revoke_place', 'fiila_start_delivery', 'fiila_track', 'fiila_update_place', 'fiila_watch',
  // comptes, carnet, boutique (20261017220000)
  'fiila_claim', 'fiila_customer_delete', 'fiila_customer_get', 'fiila_customer_save', 'fiila_customers',
  'fiila_delete_account', 'fiila_me', 'fiila_order_create', 'fiila_order_delivery', 'fiila_order_get',
  'fiila_order_payment_add', 'fiila_order_payment_delete', 'fiila_order_public', 'fiila_order_request_address',
  'fiila_order_set_status', 'fiila_orders', 'fiila_profile_save', 'fiila_set_tag', 'fiila_shop_get', 'fiila_shop_save',
  // boutique sans compte, articles, notes (20261017230000)
  'fiila_product_delete', 'fiila_product_save', 'fiila_products', 'fiila_review', 'fiila_shop_claim',
  // livreurs (20261017240000)
  'fiila_courier_accept', 'fiila_courier_delete', 'fiila_courier_done', 'fiila_courier_invite', 'fiila_courier_invite_get',
  'fiila_courier_me', 'fiila_courier_register', 'fiila_courier_review', 'fiila_courier_update', 'fiila_order_dispatch',
  'fiila_shop_courier', 'fiila_shop_delete',
  // durcissement (20261017250000)
  'fiila_meeting_guest_remove',
  // origine et parrainage, publications, statistiques (20261018000000)
  'fiila_admin_stats', 'fiila_attribute', 'fiila_voice', 'fiila_voice_private', 'fiila_voice_set', 'fiila_feed', 'fiila_shop_feed', 'fiila_admin_shop_types', 'fiila_ambassador_me', 'fiila_ambassador_register', 'fiila_ambassador_quiz', 'fiila_ambassador_quiz_start', 'fiila_ambassador_quiz_answer', 'fiila_amb_today', 'fiila_amb_task_done', 'fiila_amb_messages', 'fiila_amb_message_send', 'fiila_bo_career', 'fiila_bo_career_thread', 'fiila_bo_career_reply', 'fiila_bo_objective_set', 'fiila_bo_mission_save', 'fiila_bo_note_decide', 'fiila_app_flags', 'fiila_bo_nudges', 'fiila_bo_onboarding', 'fiila_partner_invite', 'fiila_partner_accept', 'fiila_partner_activate', 'fiila_partner_mine', 'fiila_bo_partners', 'fiila_bo_pack_save', 'fiila_bo_partner_invite', 'fiila_bo_partner_action', 'fiila_partner_messages', 'fiila_partner_message_send', 'fiila_bo_partner_thread', 'fiila_bo_partner_reply', 'fiila_bo_manager_whatsapp_set', 'fiila_ambassador_link', 'fiila_shop_ambassador', 'fiila_ambassador_board', 'fiila_admin_ambassadors', 'fiila_admin_ambassador_decide', 'fiila_admin_reward', 'fiila_vd_submit', 'fiila_vd_mine', 'fiila_vd_withdraw', 'fiila_admin_vd', 'fiila_admin_vd_decide', 'fiila_posts', 'fiila_react', 'fiila_saved', 'fiila_comments', 'fiila_comment_add', 'fiila_comment_delete', 'fiila_comment_report', 'fiila_product_stats', 'fiila_schema_version', 'fiila_bo_me', 'fiila_bo_overview', 'fiila_bo_shops', 'fiila_bo_shop', 'fiila_bo_shop_action', 'fiila_bo_orders', 'fiila_bo_order', 'fiila_bo_accounts', 'fiila_bo_account', 'fiila_bo_feed', 'fiila_bo_finance', 'fiila_bo_team', 'fiila_bo_invite', 'fiila_bo_invite_revoke', 'fiila_bo_invite_get', 'fiila_bo_invite_accept', 'fiila_bo_staff_set', 'fiila_bo_audit', 'fiila_bo_settings', 'fiila_bo_setting_set', 'fiila_admin_comments', 'fiila_admin_comment_decide', 'fiila_shop_vitrine', 'fiila_vitrine', 'fiila_vitrine_order', 'fiila_vitrine_photo', 'fiila_post_log', 'fiila_referral_card_delete', 'fiila_referral_card_save', 'fiila_referral_me', 'fiila_referral_public',
  // équipe de la boutique (20261020200000)
  'fiila_shop_team', 'fiila_shop_invite', 'fiila_shop_invite_cancel', 'fiila_shop_invite_get', 'fiila_shop_invite_accept', 'fiila_shop_member_set', 'fiila_shop_leave',
  // photos d'articles (20261020400000)
  'fiila_product_photos',
  // cartes WhatsApp (20261022000000)
  'fiila_bo_wa', 'fiila_bo_wa_status',
  // photos dans le stockage (20261022200000) — fiila_media_* : clé de service seulement
  'fiila_bo_media',
  // Ma boutique → Marketing (20261022300000)
  'fiila_shop_stats',
].sort();
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? '— ' + JSON.stringify(detail) : ''); };

const migrations = await q(`select version from supabase_migrations.schema_migrations order by version`).catch(() => []);
const expectedMigrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((f) => f.split('_')[0]);
// Le dépôt doit être le début de la liste en base : une base plus récente (republication d'une version antérieure) est acceptée.
const applied = migrations.map((m) => m.version);
const dbNewer = applied.length > expectedMigrations.length;
check('migrations appliquées dans l’ordre (' + expectedMigrations.length + ')', expectedMigrations.every((v, i) => applied[i] === v), applied);
if (dbNewer) console.log('NOTE base plus récente que ce dépôt (' + applied.slice(expectedMigrations.length).join(', ') + ') : liste des fonctions non comparée.');

const tables = await q(`select table_name from information_schema.tables where table_schema = 'fiila' order by 1`);
check('tables présentes', ['courier_invites', 'courier_reviews', 'couriers', 'customers', 'metrics', 'orders', 'payments', 'places', 'posts', 'products', 'profiles', 'referrals', 'referrers', 'reviews', 'rate_events', 'requests', 'retired_tokens', 'settings', 'shops', 'trackers', 'likes', 'saves', 'comments', 'comment_reports', 'staff', 'staff_invites', 'admin_log', 'ambassadors', 'ambassador_rewards', 'vd_submissions', 'shop_members', 'shop_invites', 'product_photos', 'ambassador_quiz_runs', 'amb_objectives', 'amb_missions', 'amb_tasks', 'amb_messages', 'amb_notes', 'wa_events'].every((t) => tables.some((r) => r.table_name === t)), tables.map((r) => r.table_name));

const usage = await q(`select has_schema_privilege('anon', 'fiila', 'usage') as anon, has_schema_privilege('authenticated', 'fiila', 'usage') as auth`);
check('schéma fiila fermé à anon et authenticated', !usage[0].anon && !usage[0].auth, usage[0]);

const tablePriv = await q(`select table_name, privilege_type, grantee from information_schema.role_table_grants
  where table_schema = 'fiila' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
check('aucun droit sur les tables fiila pour anon / authenticated / PUBLIC', tablePriv.length === 0, tablePriv);

const fns = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'fiila_%' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
const names = fns.map((f) => f.proname).sort();
if (dbNewer) check('fonctions prévues par ce dépôt toutes présentes', EXPECTED_FUNCTIONS.every((f) => names.includes(f)), EXPECTED_FUNCTIONS.filter((f) => !names.includes(f)));
else check('fonctions exécutables par anon = exactement les ' + EXPECTED_FUNCTIONS.length + ' fonctions prévues', JSON.stringify(names) === JSON.stringify(EXPECTED_FUNCTIONS), names);

const definer = await q(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fiila_%'`);
check('fonctions publiques en security definer avec search_path vide', definer.every((d) => d.prosecdef && d.cfg.includes('search_path=""')), definer.filter((d) => !(d.prosecdef && d.cfg.includes('search_path=""'))));

const authDel = await q(`select has_table_privilege(current_user, 'auth.users', 'DELETE') as ok`).catch(() => [{ ok: false }]);
check('le propriétaire des fonctions peut supprimer un compte (auth.users)', authDel[0].ok === true, authDel[0]);

const exposedTables = await q(`select table_name from information_schema.tables where table_schema = 'public'`);
check('aucune table dans le schéma public exposé', exposedTables.length === 0, exposedTables.map((t) => t.table_name));

await c.end();
const ok = checks.every((x) => x.ok);
writeFileSync('docs/deploy-db-checks.json', JSON.stringify({ date: new Date().toISOString(), ok, migrations: migrations.map((m) => m.version), checks }, null, 2));
process.exit(ok ? 0 : 1);
