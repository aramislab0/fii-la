// Postgres local (PGlite) qui reproduit l'environnement Supabase utile à Fii La :
// schéma `extensions` avec pgcrypto, rôles `anon` / `authenticated`, puis la migration réelle.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists extensions;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    grant usage on schema public to anon, authenticated;
  `);
  const dir = join(root, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

// Appelle une fonction RPC comme le ferait PostgREST : rôle anon, en-têtes de requête exposés.
export async function rpc(db, fn, args = {}, { ip = '203.0.113.7', role = 'anon' } = {}) {
  if (!/^fiila_[a-z_]+$/.test(fn)) return { status: 404, body: { code: 'PGRST202', message: 'not found' } };
  const keys = Object.keys(args);
  for (const k of keys) if (!/^[a-z_]+$/.test(k)) return { status: 400, body: { message: 'bad arg' } };
  const params = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v == null ? null : String(v);
  });
  const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  try {
    const out = await db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip })]);
      const res = await tx.query(call, params);
      return res.rows[0].r;
    });
    return { status: 200, body: out };
  } catch (e) {
    return { status: 400, body: { code: e.code, message: e.message } };
  }
}
