// Postgres local (PGlite) qui reproduit l'environnement Supabase utile à Fii :
// schéma `extensions` avec pgcrypto, rôles `anon` / `authenticated`, puis la migration réelle.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// opts.before : n'applique que les migrations antérieures (test de migration : données créées avant, vérifiées après).
export async function createDb(opts = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists extensions;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    -- Équivalent minimal du schéma auth de Supabase (GoTrue) : utilisateurs et auth.uid().
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text unique, phone text unique, phone_confirmed_at timestamptz, created_at timestamptz default now(), email_confirmed_at timestamptz default now());
    create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await applyMigrations(db, null, opts.before || null);
  return db;
}
export async function applyMigrations(db, from, before) {
  const dir = join(root, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const v = f.split('_')[0];
    if (from && v < from) continue;
    if (before && v >= before) continue;
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
}

// Crée un utilisateur de test (équivalent d'une inscription GoTrue) et renvoie son identifiant.
export async function createUser(db, email) {
  const r = await db.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email]);
  return r.rows[0].id;
}

// Appelle une fonction RPC comme le ferait PostgREST : rôle anon (ou authenticated avec uid), en-têtes exposés.
// aal : niveau de la session (Supabase) ; par défaut aal2 dans les tests SQL directs (les tests de double authentification passent aal1).
export async function rpc(db, fn, args = {}, { ip = '203.0.113.7', role = 'anon', uid = null, loginAt = null, aal = 'aal2' } = {}) {
  if (uid) role = 'authenticated';
  if (!/^fiila_[a-z_]+$/.test(fn)) return { status: 404, body: { code: 'PGRST202', message: 'not found' } };
  const keys = Object.keys(args);
  for (const k of keys) if (!/^[a-z_]+$/.test(k)) return { status: 400, body: { message: 'bad arg' } };
  const params = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v == null ? null : typeof v === 'boolean' ? v : String(v);
  });
  const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  try {
    const out = await db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip })]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid, role: 'authenticated', aal, amr: [{ method: 'password', timestamp: loginAt ?? Math.floor(Date.now() / 1000) }] }) : '']);
      const res = await tx.query(call, params);
      return res.rows[0].r;
    });
    return { status: 200, body: out };
  } catch (e) {
    return { status: 400, body: { code: e.code, message: e.message } };
  }
}
