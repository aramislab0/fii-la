// Serveur local : sert web/ et simule l'API PostgREST de Supabase sur un Postgres PGlite.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createDb, rpc } from './db.mjs';
import { minifyJs, minifyCss } from '../scripts/minify.mjs';
import { newSecret, totpOk } from './totp.mjs';
const STUDIO_STORE = new Map();

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
// Comme en production : app.js, styles.css et theme.js compressés (scripts/minify.mjs). FIILA_MIN=0 sert les sources (débogage).
const MIN = process.env.FIILA_MIN !== '0';
const minCache = new Map();
function minified(path, data) {
  const f = { '/app.js': minifyJs, '/bo.js': minifyJs, '/styles.css': minifyCss, '/theme.js': minifyJs }['/' + path.replace(/^[/\\]+/, '')];
  if (!MIN || !f) return data;
  const key = createHash('sha1').update(data).digest('hex');
  if (!minCache.has(key)) minCache.set(key, Buffer.from(f(data.toString('utf8'))));
  return minCache.get(key);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// Émulation minimale de GoTrue (Supabase Auth) : inscription, connexion, rafraîchissement, mot de passe.
// Jetons au format JWT (non signés de façon vérifiable : test local uniquement).
function makeAuth(db) {
  const users = new Map();      // email -> { id, email, pw }
  const access = new Map();     // jeton d'accès -> { uid, exp }
  const refresh = new Map();    // jeton de rafraîchissement -> { uid, loginAt }
  const codes = new Map();      // code PKCE -> { uid, challenge }
  const factors = new Map();    // uid -> [{ id, secret, status, friendly_name }]
  const challenges = new Map(); // id du défi -> { factor, uid }
  let lastRecovery = null;
  const smsOut = [];            // SMS « envoyés » (crochet Send SMS simulé) : { phone, otp }
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const hash = (pw) => createHash('sha256').update('fiila-test:' + pw).digest('hex');
  let ttl = 3600;
  // aal : niveau d'assurance de la session (aal1 = mot de passe ; aal2 = mot de passe + code de l'application), comme Supabase.
  function session(u, loginAt = Math.floor(Date.now() / 1000), aal = 'aal1') {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const at = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: u.id, email: u.email, role: 'authenticated', exp, aal, amr: [{ method: 'password', timestamp: loginAt }] }) + '.' + randomBytes(16).toString('base64url');
    const rt = randomBytes(18).toString('base64url');
    access.set(at, { uid: u.id, exp, loginAt, aal }); refresh.set(rt, { uid: u.id, loginAt, aal });
    return { access_token: at, token_type: 'bearer', expires_in: ttl, expires_at: exp, refresh_token: rt, user: { id: u.id, email: u.email } };
  }
  const byId = (id) => [...users.values()].find((u) => u.id === id);
  return {
    expireAll() { for (const v of access.values()) v.exp = 0; },
    lastRecovery() { return lastRecovery; },
    lastSms() { return smsOut[smsOut.length - 1] || null; },
    forgeSession(email) { const u = users.get(email); return u ? session(u) : null; },
    setTtl(s) { ttl = s; },
    uidFor(authz) {
      const tok = /^Bearer (.+)$/.exec(authz || '');
      if (!tok || tok[1].split('.').length !== 3) return { uid: null };
      const a = access.get(tok[1]);
      if (!a || a.exp <= Math.floor(Date.now() / 1000)) return { expired: true };
      return { uid: a.uid, loginAt: a.loginAt, aal: a.aal };
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
        const rt = refresh.get(body.refresh_token);
        const u = rt && byId(rt.uid);
        if (!u) return err(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refresh.delete(body.refresh_token);
        return [200, session(u, rt.loginAt, rt.aal)];
      }
      if (path === '/token' && method === 'POST' && q.get('grant_type') === 'pkce') {
        const c = codes.get(body.auth_code);
        codes.delete(body.auth_code);
        const ok = c && createHash('sha256').update(String(body.code_verifier || '')).digest('base64url') === c.challenge;
        const u = ok && byId(c.uid);
        if (!u) return err(400, 'bad_code_verifier', 'code challenge does not match previously saved code verifier');
        return [200, session(u)];
      }
      const who = this.uidFor(authz);
      if (path === '/user') {
        if (!who.uid) return err(401, 'bad_jwt', 'invalid JWT');
        const u = byId(who.uid);
        if (!u) return err(404, 'user_not_found', 'User not found');
        if (method === 'PUT') {
          // Changement de numéro : code à 6 chiffres envoyé par SMS (crochet), confirmé ensuite par POST /verify (type phone_change).
          if (body.phone != null) {
            const d = String(body.phone).replace(/\D/g, '');
            if (!/^\d{8,15}$/.test(d)) return err(400, 'validation_failed', 'Invalid phone number format (E.164 required)');
            const taken = await db.query('select 1 from auth.users where phone = $1 and phone_confirmed_at is not null and id <> $2', [d, u.id]);
            if (taken.rows.length) return err(422, 'phone_exists', 'A user with this phone number has already been registered');
            if (u.smsAt && Date.now() - u.smsAt < 1000 && !process.env.FIILA_SMS_FAST) return err(429, 'over_sms_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.');
            u.pendingPhone = d; u.phoneOtp = String(Math.floor(100000 + Math.random() * 900000)); u.smsAt = Date.now();
            smsOut.push({ phone: '+' + d, otp: u.phoneOtp });
          }
          if (body.password != null) {
            if (String(body.password).length < 8) return err(422, 'weak_password', 'Password should be at least 8 characters.');
            if (hash(body.password) === u.pw) return err(422, 'same_password', 'New password should be different from the old password.');
            u.pw = hash(body.password);
          }
        }
        return [200, { id: u.id, email: u.email, factors: (factors.get(u.id) || []).map((f) => ({ id: f.id, factor_type: 'totp', status: f.status, friendly_name: f.friendly_name })) }];
      }
      if (path === '/verify' && method === 'POST' && body.type === 'recovery') {
        const u = users.get(String(body.email || '').trim().toLowerCase());
        if (!u || !u.recoveryOtp || String(body.token || '') !== u.recoveryOtp) return err(403, 'otp_expired', 'Token has expired or is invalid');
        u.recoveryOtp = null;
        return [200, session(u)];
      }
      if (path === '/verify' && method === 'POST' && body.type === 'phone_change') {
        if (!who.uid) return err(401, 'bad_jwt', 'invalid JWT');
        const u = byId(who.uid);
        const d = String(body.phone || '').replace(/\D/g, '');
        if (!u || !u.pendingPhone || u.pendingPhone !== d || String(body.token || '') !== u.phoneOtp) return err(403, 'otp_expired', 'Token has expired or is invalid');
        await db.query('update auth.users set phone = $1, phone_confirmed_at = now() where id = $2', [d, u.id]);
        u.pendingPhone = null; u.phoneOtp = null;
        return [200, session(u, who.loginAt, who.aal)];
      }
      // Double authentification (TOTP), comme l'API MFA de Supabase Auth.
      const fm = /^\/factors(?:\/([0-9a-f-]{36})(?:\/(challenge|verify))?)?$/.exec(path);
      if (fm) {
        if (!who.uid) return err(401, 'bad_jwt', 'invalid JWT');
        const list = factors.get(who.uid) || []; factors.set(who.uid, list);
        if (!fm[1] && method === 'POST') {
          const f = { id: randomUUID(), secret: newSecret(), status: 'unverified', friendly_name: body.friendly_name || 'TOTP' };
          if (list.some((x) => x.friendly_name === f.friendly_name)) return err(422, 'mfa_factor_name_conflict', 'A factor with the friendly name already exists');
          list.push(f);
          const uri = 'otpauth://totp/' + encodeURIComponent((body.issuer || 'Fii') + ':' + byId(who.uid).email) + '?secret=' + f.secret + '&issuer=' + encodeURIComponent(body.issuer || 'Fii');
          // Même format que l'API Supabase (internal/api/mfa.go : QRCode = buf.String()) : SVG brut, sans préfixe « data: »,
          // avec en-tête XML et des couleurs « # ». FIILA_QR_PREFIX=1 simule l'ancien format préfixé (supabase-js).
          const qr = (process.env.FIILA_QR_PREFIX ? 'data:image/svg+xml;utf-8,' : '') + '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#ffffff"/><rect x="20" y="20" width="120" height="120" fill="#111111"/></svg>';
          return [200, { id: f.id, type: 'totp', friendly_name: f.friendly_name, totp: { qr_code: qr, secret: f.secret, uri } }];
        }
        const f = list.find((x) => x.id === fm[1]);
        if (!f) return err(404, 'mfa_factor_not_found', 'Factor not found');
        if (method === 'DELETE') {
          if (f.status === 'verified' && who.aal !== 'aal2') return err(403, 'insufficient_aal', 'AAL2 required');
          list.splice(list.indexOf(f), 1); return [200, { id: f.id }];
        }
        if (fm[2] === 'challenge') { const id = randomUUID(); challenges.set(id, { factor: f.id, uid: who.uid }); return [200, { id, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }]; }
        if (fm[2] === 'verify') {
          const c = challenges.get(body.challenge_id);
          if (!c || c.factor !== f.id) return err(422, 'mfa_challenge_expired', 'Challenge expired');
          if (!totpOk(f.secret, body.code)) return err(422, 'mfa_verification_failed', 'Invalid TOTP code entered');
          challenges.delete(body.challenge_id); f.status = 'verified';
          return [200, session(byId(who.uid), Math.floor(Date.now() / 1000), 'aal2')];
        }
      }
      if (path === '/logout' && method === 'POST') {
        const tok = /^Bearer (.+)$/.exec(authz || '');
        if (tok) access.delete(tok[1]);
        return [204, null];
      }
      if (path === '/recover' && method === 'POST') {
        const u = users.get(String(body.email || '').trim().toLowerCase());
        if (u && body.code_challenge) {
          const code = randomUUID();
          codes.set(code, { uid: u.id, challenge: body.code_challenge });
          // Le même e-mail porte aussi un code à 6 chiffres ({{ .Token }} dans le modèle Supabase).
          u.recoveryOtp = String(Math.floor(100000 + Math.random() * 900000));
          lastRecovery = { code, otp: u.recoveryOtp };
        }
        return [200, {}];
      }
      return err(404, 'not_found', 'not found');
    }
  };
}

export async function startServer(port = 0) {
  const db = await createDb();
  const auth = makeAuth(db);
  const server = http.createServer(async (req, res) => {
    // App mobile en test local (FIILA_CORS=1) : l'app tourne sur capacitor://localhost, autre origine que ce serveur,
    // comme avec Supabase en production (qui autorise toutes les origines).
    if (process.env.FIILA_CORS === '1') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__test/expire-tokens') { auth.expireAll(); res.writeHead(204); return res.end(); }
    if (url.pathname === '/__test/last-recovery') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(auth.lastRecovery())); }
    if (url.pathname === '/__test/forge-session') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(auth.forgeSession(url.searchParams.get('email')))); }
    const am = url.pathname.match(/^\/auth\/v1(\/[a-z]+(?:\/[0-9a-f-]{36}(?:\/(?:challenge|verify))?)?)$/);
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
      // Clé de service de test (fonctions serveur simulées) : rôle service_role, comme la vraie clé de service.
      const svc = req.headers.authorization === 'Bearer local-service-key';
      const r = await rpc(db, m[1], args, svc ? { ip, role: 'service_role' } : { ip, uid: who.uid, loginAt: who.loginAt, aal: who.aal || 'aal1' });
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
    // Fonction fiila-domains : le vrai code, sans secrets Cloudflare (réponse « configured: false », aucun appel extérieur).
    if (url.pathname === '/functions/v1/fiila-domains') {
      let body = '';
      for await (const c of req) body += c;
      const { makeHandler } = await import('../supabase/functions/fiila-domains/handler.mjs');
      const origin = `http://127.0.0.1:${server.address().port}`;
      const h = makeHandler({ env: (k) => ({ SUPABASE_URL: origin, SUPABASE_ANON_KEY: 'local-test-key' })[k], fetch: globalThis.fetch });
      const r = await h(new Request(origin + url.pathname, { method: req.method, headers: { authorization: req.headers.authorization || '' }, body: req.method === 'POST' ? body : undefined }));
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    }
    // Fonction fiila-studio : le vrai code ; fal est simulé (FIILA_STUDIO_FAIL=1 : le fournisseur échoue). Images de test servies ici.
    if (url.pathname === '/functions/v1/fiila-studio') {
      let body = '';
      for await (const c of req) body += c;
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const { makeHandler } = await import('../supabase/functions/fiila-studio/handler.mjs');
      const origin = `http://127.0.0.1:${server.address().port}`;
      const fakeFetch = async (u, init) => {
        if (String(u).startsWith('https://fal.run/')) {
          if (process.env.FIILA_STUDIO_FAIL === '1') return new Response(JSON.stringify({ detail: 'test failure' }), { status: 500 });
          return new Response(JSON.stringify({ images: [0, 1, 2].map((i) => ({ url: `https://v3.fal.media/files/test/studio-${i}.png`, content_type: 'image/png' })) }), { status: 200 });
        }
        // Seau privé « studio » simulé en mémoire (copie durable des résultats ; clé de service exigée).
        if (String(u).startsWith(origin + '/storage/v1/object/studio/')) {
          const key = String(u).slice((origin + '/storage/v1/object/studio/').length);
          if ((init && init.headers && init.headers.Authorization) !== 'Bearer local-service-key') return new Response('{}', { status: 403 });
          if (init && init.method === 'POST') { STUDIO_STORE.set(key, { type: init.headers['Content-Type'], bytes: new Uint8Array(init.body) }); return new Response('{}', { status: 200 }); }
          const f = STUDIO_STORE.get(key);
          return f ? new Response(f.bytes, { status: 200, headers: { 'content-type': f.type } }) : new Response('{"error":"not_found"}', { status: 404 });
        }
        if (String(u).startsWith('https://v3.fal.media/files/test/')) {
          const { default: sharp } = await import('sharp');
          const png = await sharp({ create: { width: 880, height: 1100, channels: 3, background: '#d8c3a5' } }).png().toBuffer();
          return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
        }
        return globalThis.fetch(u, init);
      };
      const h = makeHandler({ env: (k) => ({ SUPABASE_URL: origin, SUPABASE_ANON_KEY: 'local-test-key', SUPABASE_SERVICE_ROLE_KEY: 'local-service-key', FAL_KEY: 'fal-test' })[k], fetch: fakeFetch });
      const r = await h(new Request(origin + url.pathname, { method: req.method, headers: { authorization: req.headers.authorization || '' }, body: req.method === 'POST' ? body : undefined }));
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    }
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`window.FIILA_CONFIG={supabaseUrl:location.origin,supabaseKey:'local-test-key',publicUrl:'',domainsLive:true};`);
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      const data = minified(path, await readFile(join(webRoot, path)));
      const type = TYPES[extname(path)] || 'application/octet-stream';
      // Comme GitHub Pages : textes compressés en gzip si le navigateur l'accepte (mesure de poids réaliste).
      if (/^(text\/|application\/(javascript|json)|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
        return res.end(gzipSync(data));
      }
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, db, auth, url: `http://127.0.0.1:${server.address().port}/` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.env.PORT || 8787));
  console.log('Fii local :', s.url);
}
