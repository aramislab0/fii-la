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
].sort();
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? '— ' + JSON.stringify(detail) : ''); };

const migrations = await q(`select version from supabase_migrations.schema_migrations order by version`).catch(() => []);
const expectedMigrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((f) => f.split('_')[0]);
check('migrations appliquées dans l’ordre (' + expectedMigrations.length + ')', migrations.map((m) => m.version).join(',') === expectedMigrations.join(','), migrations.map((m) => m.version));

const tables = await q(`select table_name from information_schema.tables where table_schema = 'fiila' order by 1`);
check('tables présentes', ['customers', 'metrics', 'orders', 'payments', 'places', 'products', 'profiles', 'reviews', 'rate_events', 'requests', 'retired_tokens', 'settings', 'shops', 'trackers'].every((t) => tables.some((r) => r.table_name === t)), tables.map((r) => r.table_name));

const usage = await q(`select has_schema_privilege('anon', 'fiila', 'usage') as anon, has_schema_privilege('authenticated', 'fiila', 'usage') as auth`);
check('schéma fiila fermé à anon et authenticated', !usage[0].anon && !usage[0].auth, usage[0]);

const tablePriv = await q(`select table_name, privilege_type, grantee from information_schema.role_table_grants
  where table_schema = 'fiila' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
check('aucun droit sur les tables fiila pour anon / authenticated / PUBLIC', tablePriv.length === 0, tablePriv);

const fns = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'fiila_%' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
const names = fns.map((f) => f.proname).sort();
check('fonctions exécutables par anon = exactement les ' + EXPECTED_FUNCTIONS.length + ' fonctions prévues', JSON.stringify(names) === JSON.stringify(EXPECTED_FUNCTIONS), names);

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
