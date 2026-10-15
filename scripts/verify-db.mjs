// Vérifie la base déployée : migrations appliquées et droits d'accès du rôle public (anon).
// Usage : DATABASE_URL=... node scripts/verify-db.mjs   (l'URL n'est jamais affichée)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const EXPECTED_FUNCTIONS = [
  'fiila_create_place', 'fiila_create_request', 'fiila_delete_place', 'fiila_delete_request', 'fiila_fulfill_request',
  'fiila_get_owned', 'fiila_get_public', 'fiila_get_request_owner', 'fiila_get_request_public', 'fiila_new_link',
  'fiila_owned_summaries', 'fiila_revoke_place', 'fiila_track', 'fiila_update_place',
];
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? '— ' + JSON.stringify(detail) : ''); };

const migrations = await q(`select version from supabase_migrations.schema_migrations order by version`).catch(() => []);
check('migrations appliquées dans l’ordre', migrations.map((m) => m.version).join(',') === '20261015000000,20261015100000', migrations.map((m) => m.version));

const tables = await q(`select table_name from information_schema.tables where table_schema = 'fiila' order by 1`);
check('tables présentes', ['metrics', 'places', 'rate_events', 'requests', 'retired_tokens', 'settings'].every((t) => tables.some((r) => r.table_name === t)), tables.map((r) => r.table_name));

const usage = await q(`select has_schema_privilege('anon', 'fiila', 'usage') as anon, has_schema_privilege('authenticated', 'fiila', 'usage') as auth`);
check('schéma fiila fermé à anon et authenticated', !usage[0].anon && !usage[0].auth, usage[0]);

const tablePriv = await q(`select table_name, privilege_type, grantee from information_schema.role_table_grants
  where table_schema = 'fiila' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
check('aucun droit sur les tables fiila pour anon / authenticated / PUBLIC', tablePriv.length === 0, tablePriv);

const fns = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'fiila_%' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
const names = fns.map((f) => f.proname);
check('fonctions exécutables par anon = exactement les 14 fonctions prévues', JSON.stringify(names) === JSON.stringify(EXPECTED_FUNCTIONS), names);

const definer = await q(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fiila_%'`);
check('fonctions publiques en security definer avec search_path vide', definer.every((d) => d.prosecdef && d.cfg.includes('search_path=""')), definer.filter((d) => !(d.prosecdef && d.cfg.includes('search_path=""'))));

const exposedTables = await q(`select table_name from information_schema.tables where table_schema = 'public'`);
check('aucune table dans le schéma public exposé', exposedTables.length === 0, exposedTables.map((t) => t.table_name));

await c.end();
const ok = checks.every((x) => x.ok);
writeFileSync('docs/deploy-db-checks.json', JSON.stringify({ date: new Date().toISOString(), ok, migrations: migrations.map((m) => m.version), checks }, null, 2));
process.exit(ok ? 0 : 1);
