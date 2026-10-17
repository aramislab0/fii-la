// Applique une migration sur la base Supabase sans le CLI (qui peut rester bloqué sur macOS).
// Usage : SUPABASE_DB_PASSWORD=... node scripts/apply-migration.mjs supabase/migrations/<fichier>.sql
// L'URL du pooler est lue dans supabase/.temp/pooler-url (créé par `supabase link`). Rien n'est affiché du secret.
// Transaction unique : la migration et son enregistrement dans supabase_migrations réussissent ensemble ou pas du tout.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const file = process.argv[2];
if (!file || !/^\d{14}_[a-z0-9_]+\.sql$/.test(basename(file))) { console.error('Fichier de migration attendu.'); process.exit(2); }
if (!process.env.SUPABASE_DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD manquant.'); process.exit(2); }
const [version, ...rest] = basename(file, '.sql').split('_');
const name = rest.join('_');
const url = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
url.password = process.env.SUPABASE_DB_PASSWORD;
const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const done = await c.query('select 1 from supabase_migrations.schema_migrations where version = $1', [version]);
  if (done.rows.length) { console.log('Déjà appliquée :', version); process.exit(0); }
  await c.query('begin');
  await c.query(readFileSync(file, 'utf8'));
  await c.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [version, name]);
  await c.query('commit');
  console.log('Appliquée :', version, name);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('ÉCHEC (annulée) :', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
