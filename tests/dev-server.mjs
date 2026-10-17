// Serveur local : sert web/ et simule l'API PostgREST de Supabase sur un Postgres PGlite.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createDb, rpc } from './db.mjs';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// Émulation minimale de GoTrue (Supabase Auth) : inscription, connexion, rafraîchissement, mot de passe.
// Jetons au format JWT (non signés de façon vérifiable : test local uniquement).
function makeAuth(db) {
  const users = new Map();      // email -> { id, email, pw }
  const access = new Map();     // jeton d'accès -> { uid, exp }
  const refresh = new Map();    // jeton de rafraîchissement -> uid
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const hash = (pw) => createHash('sha256').update('fiila-test:' + pw).digest('hex');
  let ttl = 3600;
  function session(u) {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const at = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: u.id, email: u.email, role: 'authenticated', exp }) + '.' + randomBytes(16).toString('base64url');
    const rt = randomBytes(18).toString('base64url');
    access.set(at, { uid: u.id, exp }); refresh.set(rt, u.id);
    return { access_token: at, token_type: 'bearer', expires_in: ttl, expires_at: exp, refresh_token: rt, user: { id: u.id, email: u.email } };
  }
  const byId = (id) => [...users.values()].find((u) => u.id === id);
  return {
    expireAll() { for (const v of access.values()) v.exp = 0; },
    setTtl(s) { ttl = s; },
    uidFor(authz) {
      const tok = /^Bearer (.+)$/.exec(authz || '');
      if (!tok || tok[1].split('.').length !== 3) return { uid: null };
      const a = access.get(tok[1]);
      if (!a || a.exp <= Math.floor(Date.now() / 1000)) return { expired: true };
      return { uid: a.uid };
    },
    async handle(path, method, q, body, authz) {
      const err = (status, code, msg) => [status, { code: status, error_code: code, msg }];
      if (path === '/signup' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, 'email_address_invalid', 'Unable to validate email address: invalid format');
        if (String(body.password || '').length < 8) return err(422, 'weak_password', 'Password should be at least 8 characters.');
        if (users.has(email)) return err(422, 'user_already_exists', 'User already registered');
        const u = { id: randomUUID(), email, pw: hash(body.password) };
        users.set(email, u);
        await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, email]);
        return [200, session(u)];
      }
      if (path === '/token' && method === 'POST' && q.get('grant_type') === 'password') {
        const u = users.get(String(body.email || '').trim().toLowerCase());
        if (!u || u.pw !== hash(body.password)) return err(400, 'invalid_credentials', 'Invalid login credentials');
        const exists = await db.query('select 1 from auth.users where id = $1', [u.id]);
        if (!exists.rows.length) { users.delete(u.email); return err(400, 'invalid_credentials', 'Invalid login credentials'); }
        return [200, session(u)];
      }
      if (path === '/token' && method === 'POST' && q.get('grant_type') === 'refresh_token') {
        const uid = refresh.get(body.refresh_token);
        const u = uid && byId(uid);
        if (!u) return err(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refresh.delete(body.refresh_token);
        return [200, session(u)];
      }
      const who = this.uidFor(authz);
      if (path === '/user') {
        if (!who.uid) return err(401, 'bad_jwt', 'invalid JWT');
        const u = byId(who.uid);
        if (!u) return err(404, 'user_not_found', 'User not found');
        if (method === 'PUT') {
          if (body.password != null) {
            if (String(body.password).length < 8) return err(422, 'weak_password', 'Password should be at least 8 characters.');
            if (hash(body.password) === u.pw) return err(422, 'same_password', 'New password should be different from the old password.');
            u.pw = hash(body.password);
          }
        }
        return [200, { id: u.id, email: u.email }];
      }
      if (path === '/logout' && method === 'POST') {
        const tok = /^Bearer (.+)$/.exec(authz || '');
        if (tok) access.delete(tok[1]);
        return [204, null];
      }
      if (path === '/recover' && method === 'POST') return [200, {}];
      return err(404, 'not_found', 'not found');
    }
  };
}

export async function startServer(port = 0) {
  const db = await createDb();
  const auth = makeAuth(db);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__test/expire-tokens') { auth.expireAll(); res.writeHead(204); return res.end(); }
    const am = url.pathname.match(/^\/auth\/v1(\/[a-z]+)$/);
    if (am) {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      let body = '';
      for await (const c of req) body += c;
      let args = {};
      try { args = body ? JSON.parse(body) : {}; } catch { res.writeHead(400); return res.end('{"msg":"bad json"}'); }
      const [status, out] = await auth.handle(am[1], req.method, url.searchParams, args, req.headers.authorization);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(out == null ? '' : JSON.stringify(out));
    }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      let body = '';
      for await (const c of req) body += c;
      let args = {};
      try { args = body ? JSON.parse(body) : {}; } catch { res.writeHead(400); return res.end('{"message":"bad json"}'); }
      const ip = req.headers['x-test-ip'] || '127.0.0.1';
      const who = auth.uidFor(req.headers.authorization);
      if (who.expired) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"code":"PGRST301","message":"JWT expired"}'); }
      const r = await rpc(db, m[1], args, { ip, uid: who.uid });
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(r.body));
    }
    // Simulation de la fonction fiila-resolve-maps : mêmes règles d'extraction, liens courts de test fixes
    // (aucun accès réseau vers Google pendant les tests).
    if (url.pathname === '/functions/v1/fiila-resolve-maps') {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      let body = '';
      for await (const c of req) body += c;
      let input = '';
      try { input = String(JSON.parse(body || '{}').url || ''); } catch { res.writeHead(400); return res.end('{"error":"invalid"}'); }
      const ex = await import('../supabase/functions/fiila-resolve-maps/extract.mjs');
      const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
      const direct = ex.extractFromUrl(input);
      if (direct) return send(200, direct);
      let u; try { u = new URL(input); } catch { return send(400, { error: 'invalid' }); }
      if (!ex.isShortMapsUrl(u)) return send(400, { error: 'unsupported' });
      const FAKE = { '/fiilaTestPin': 'https://consent.google.com/m?continue=https://www.google.com/maps/search/14.758140,%2B-17.470320?entry%3Dtts' };
      const loc = FAKE[u.pathname];
      const c = loc ? (ex.extractFromUrl(loc) || ex.extractFromUrl(new URL(loc).searchParams.get('continue') || '')) : null;
      return c ? send(200, c) : send(422, { error: 'not_found' });
    }
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`window.FIILA_CONFIG={supabaseUrl:location.origin,supabaseKey:'local-test-key',publicUrl:''};`);
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      const data = await readFile(join(webRoot, path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, db, auth, url: `http://127.0.0.1:${server.address().port}/` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.env.PORT || 8787));
  console.log('Fii La local :', s.url);
}
