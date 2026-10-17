// Serveur local : sert web/ et simule l'API PostgREST de Supabase sur un Postgres PGlite.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, rpc } from './db.mjs';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

export async function startServer(port = 0) {
  const db = await createDb();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      let body = '';
      for await (const c of req) body += c;
      let args = {};
      try { args = body ? JSON.parse(body) : {}; } catch { res.writeHead(400); return res.end('{"message":"bad json"}'); }
      const ip = req.headers['x-test-ip'] || '127.0.0.1';
      const r = await rpc(db, m[1], args, { ip });
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
  return { server, db, url: `http://127.0.0.1:${server.address().port}/` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.env.PORT || 8787));
  console.log('Fii La local :', s.url);
}
