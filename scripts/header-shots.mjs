// Captures de l'en-tête de l'accueil avec un compte (nom long + photo), clair et sombre. Données synthétiques, serveur local.
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { startServer } from '../tests/dev-server.mjs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const out = process.argv[2] || 'docs/screenshots';
const local = await startServer(0);
const browser = await pw.chromium.launch();
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function portrait() { // disque chaud sur fond vert : un portrait de substitution
  const W = 200, rows = [];
  for (let y = 0; y < W; y++) { const r = Buffer.alloc(1 + W * 3); for (let x = 0; x < W; x++) { const d = Math.hypot(x - 100, y - 85); const head = d < 45, body = Math.hypot(x - 100, y - 230) < 100; const [R, G, B] = head || body ? [120, 78, 52] : [30, 74, 52]; r[1 + 3 * x] = R; r[2 + 3 * x] = G; r[3 + 3 * x] = B; } rows.push(r); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(W, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme });
  const p = await ctx.newPage();
  await p.goto(local.url + '#/compte?mode=inscription');
  await p.getByRole('tab', { name: 'Créer un compte' }).click().catch(() => {});
  await p.fill('#acc-name', 'Mohamed Assane Niang');
  await p.fill('#acc-email', `entete.${scheme}@example.invalid`);
  await p.fill('#acc-pass', 'motdepasse-test-123');
  await p.click('#auth-submit');
  await p.getByText('Compte créé.').waitFor();
  const sess = await p.evaluate(() => JSON.parse(localStorage.getItem('fiila.session')));
  const r = await fetch(local.url + 'rest/v1/rpc/fiila_profile_save', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.access_token, apikey: 'local-test-key' },
    body: JSON.stringify({ p: { display_name: 'Mohamed Assane Niang', avatar: portrait() } }) });
  if (!r.ok) console.log('profil', r.status, await r.text());
  await p.goto(local.url + '#/'); await p.reload();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/entete-${scheme}.png`, clip: { x: 0, y: 0, width: 390, height: 420 } });
  await ctx.close();
}
await browser.close(); local.server.close();
console.log('ok');
