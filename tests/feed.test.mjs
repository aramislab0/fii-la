// Fil des boutiques de bout en bout : accueil (3 boutiques, défilement), page « Boutiques », ouverture d'une vitrine
// et retour, réglage « Apparaître dans le fil », fil proposé à la fin d'une tâche (commande livrée). Données synthétiques.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/fil';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone(scheme = 'light') {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.__photoCalls = 0; page.on('request', (r) => { if (/rpc\/fiila_vitrine_photo$/.test(r.url())) page.__photoCalls++; });
  pages.push(page);
  return page;
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });

// Photos synthétiques : aplats de couleur encodés ici en PNG (sans métadonnées, quel que soit le navigateur).
import { deflateSync } from 'node:zlib';
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
async function swatch(color) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const W = 320, H = 180, row = Buffer.alloc(1 + W * 3);
  for (let x = 0; x < W; x++) { const shade = 0.85 + 0.15 * (x / W); row[1 + 3 * x] = r * shade; row[2 + 3 * x] = g * shade; row[3 + 3 * x] = b * shade; }
  const raw = Buffer.concat(Array.from({ length: H }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const SHOPS = [
  { name: 'Awa Couture (test)', about: 'Robes wax et foulards, livrés à Dakar.', accent: 'prune', color: '#5B2A86', items: [['Robe wax', 15000], ['Foulard', 3000], ['Pagne tissé', 8000]] },
  { name: 'Thiouraye Ndèye (test)', about: 'Encens et parfums maison.', accent: 'terre', color: '#8A4B1F', items: [['Thiouraye 250 g', 5000], ['Gongo', 4000]] },
  { name: 'Cosmétiques Fatou (test)', about: 'Karité et savons naturels.', accent: 'foret', color: '#1E4A34', items: [['Beurre de karité', 2500]] },
  { name: 'Plats de Mame (test)', about: 'Thiéboudienne le vendredi.', accent: 'bordeaux', color: '#7A1F3D', items: [['Thiéboudienne', 3500], ['Yassa poulet', 3000]] },
];
const KEYS = [];
for (const [i, s] of SHOPS.entries()) {
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: s.name, phone: '77 300 00 0' + i } })).key;
  for (const [j, [n, price]] of s.items.entries()) await ok('fiila_product_save', { p_key: k, p: { name: n, price, photo: j === 0 ? await swatch(s.color, n) : undefined } });
  await ok('fiila_shop_vitrine', { p_key: k, p: { public: true, about: s.about, accent: s.accent, cover: i === 0 ? await swatch(s.color, s.name) : undefined } });
  KEYS.push(k);
}
// Une boutique sans vitrine ouverte : jamais dans le fil.
await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique fermée (test)' } });

await t('accueil : bloc « Boutiques à découvrir » après les adresses, 3 boutiques, photos chargées au défilement', async () => {
  const A = await newPhone();
  await A.goto(URL0 + '#/');
  await A.locator('#home-feed .fcard').first().waitFor();
  assert.equal(await A.locator('#home-feed .fcard').count(), 3);
  assert.ok(await A.locator('#home-feed-all').isVisible(), 'lien « Tout voir »');
  const txt = await A.locator('#home-feed').textContent();
  assert.ok(!/fermée/.test(txt), 'boutique fermée absente');
  assert.ok(!/77 300/.test(txt), 'aucun numéro');
  const order = await A.evaluate(() => [...document.querySelectorAll('#create-address, #mes-adresses, #home-feed')].map((e) => e.id));
  assert.deepEqual(order, ['create-address', 'mes-adresses', 'home-feed'], 'l’action principale reste en premier');
  const over = await A.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, 'débordement horizontal ' + over);
  await A.locator('#home-feed').scrollIntoViewIfNeeded();
  await A.waitForFunction(() => document.querySelector('#home-feed .fimg img'));
  assert.ok(A.__photoCalls <= 4, 'photos chargées à la demande : ' + A.__photoCalls);
  await shot(A, '01-accueil');
});

await t('carrousel : avance seul en douceur, s’arrête quand on touche ; « réduire les animations » : immobile', async () => {
  const A = await newPhone();
  await A.goto(URL0 + '#/');
  await A.locator('#home-feed .car-dot').first().waitFor();
  await A.locator('#home-feed').scrollIntoViewIfNeeded();
  assert.equal(await A.locator('#home-feed .car-dot').count(), 3);
  const active = () => A.evaluate(() => [...document.querySelectorAll('#home-feed .fcard')].findIndex((c) => c.classList.contains('is-active')));
  assert.equal(await active(), 0);
  await A.waitForFunction(() => document.querySelectorAll('#home-feed .fcard')[1].classList.contains('is-active'), null, { timeout: 9000 });
  await A.waitForTimeout(1200);
  const x = await A.evaluate(() => document.querySelector('#home-feed .car-track').scrollLeft);
  assert.ok(x > 100, 'la piste a glissé : ' + x);
  await shot(A, '01b-carrousel');
  await A.locator('#home-feed .car-dot').nth(2).click();
  await A.waitForFunction(() => document.querySelectorAll('#home-feed .fcard')[2].classList.contains('is-active'));
  await A.waitForTimeout(7000);
  assert.equal(await active(), 2, 'après un toucher, plus de défilement automatique');
  // Mouvement réduit
  const ctx = await browser.newContext({ viewport: phone.viewport, isMobile: ENGINE === 'chromium', hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block', reducedMotion: 'reduce' });
  const R = await ctx.newPage(); R.__errors = []; R.on('pageerror', (e) => R.__errors.push(String(e))); pages.push(R);
  await R.goto(URL0 + '#/');
  await R.locator('#home-feed .car-dot').first().waitFor();
  await R.waitForTimeout(7000);
  assert.equal(await R.evaluate(() => [...document.querySelectorAll('#home-feed .fcard')].findIndex((c) => c.classList.contains('is-active'))), 0);
});

await t('page « Boutiques » : les 4 vitrines ouvertes, places gratuites restantes, ouverture d’une vitrine puis retour', async () => {
  const A = await newPhone();
  await A.goto(URL0 + '#/');
  await A.locator('#home-feed-all').click();
  await A.locator('#feed-list .fcard').first().waitFor();
  assert.equal(await A.locator('#feed-list .fcard').count(), 4);
  assert.match(await A.locator('#feed-join').textContent(), /Encore 21 places gratuites/);
  await A.locator('#feed-list .fcard', { hasText: 'Awa Couture' }).click();
  await A.getByRole('heading', { name: 'Awa Couture (test)' }).waitFor();
  assert.match(A.url(), /#\/b\/awa-couture-test/);
  await A.locator('.back, .bar-back').first().click();
  await A.locator('#feed-list').waitFor();
  assert.match(A.url(), /#\/boutiques$/);
  await shot(A, '02-boutiques');
});

await t('boutique : place gratuite affichée dans les réglages ; « Ne pas apparaître » la retire du fil, sans perdre la place', async () => {
  const S = await newPhone();
  await S.goto(URL0 + '#/confidentialite');
  await S.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), KEYS[1]);
  await S.goto(URL0 + '#/boutique/reglages');
  await S.locator('#feed-status').waitFor();
  assert.match(await S.locator('#feed-status').textContent(), /Place gratuite n° 2 sur 25/);
  await S.locator('#feed-on').getByText('Ne pas apparaître').click();
  await S.getByText('Votre boutique n’apparaît plus dans le fil.').waitFor();
  const f = await ok('fiila_feed', {});
  assert.ok(!f.shops.some((s) => /Thiouraye/.test(s.name)));
  assert.match(await S.locator('#feed-status').textContent(), /n° 2 gardée/);
  await S.locator('#feed-on').getByText('Apparaître', { exact: true }).click();
  await S.getByText('Votre boutique apparaît dans le fil.').waitFor();
  await shot(S, '03-reglages');
});

await t('fin de tâche : la facture d’une commande livrée propose le fil', async () => {
  const o = await ok('fiila_order_create', { p_key: KEYS[2], p: { customer: { name: 'Cliente (test)', phone: '70 000 00 51' }, items: [{ label: 'Karité', qty: 1, price: 2500 }] } });
  const pl = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez la cliente (test)', entry: { lat: 14.7, lng: -17.4 }, vehicle_ok: true, instruction: 'Porte [TEST]' } });
  await ok('fiila_fulfill_request', { p_token: o.request_token, p_place_id: pl.id, p_place_owner: pl.owner_token });
  await ok('fiila_order_set_status', { p_key: KEYS[2], p_id: o.id, p_status: 'delivered' });
  const C = await newPhone('dark');
  await C.goto(URL0 + '#/f/' + o.share_token);
  await C.locator('#done-feed .fcard').first().waitFor();
  assert.ok(await C.locator('#done-feed .fcard').count() >= 2);
  await shot(C, '04-facture-livree-sombre');
});

await t('mode démo : boutiques fictives visibles et marquées, filtre par catégorie, vitrine signalée ; sans mode démo, invisibles', async () => {
  const { readFileSync } = await import('node:fs');
  await local.db.exec(readFileSync('scripts/demo-seed.sql', 'utf8'));
  const A = await newPhone();
  await A.goto(URL0 + '#/boutiques');
  await A.locator('#feed-list .fcard').first().waitFor();
  const n0 = await A.locator('#feed-list .fcard').count();
  assert.equal(await A.locator('.demo-tag').count(), 0, 'aucune boutique fictive sans le mode démo');
  await A.goto(URL0 + '#/demo');
  await A.locator('#demo-banner').waitFor();
  await A.locator('#feed-list .demo-tag').first().waitFor();
  assert.equal(await A.locator('#feed-list .fcard').count(), n0 + 13);
  await A.locator('#feed-cats').getByRole('button', { name: 'Chaussures' }).click();
  const names = await A.locator('#feed-list .fname').allTextContents();
  assert.deepEqual(names.sort(), ['Cuirs de Ngaye (démo)', 'Sneakers Médina (démo)']);
  await shot(A, '05-mode-demo');
  await A.locator('#feed-list .fcard').first().click();
  await A.locator('#vitrine-demo').waitFor();
  await A.goto(URL0 + '#/demo?off=1');
  await A.goto(URL0 + '#/boutiques');
  await A.locator('#feed-list .fcard').first().waitFor();
  assert.equal(await A.locator('.demo-tag').count(), 0);
  await local.db.exec(readFileSync('scripts/demo-clear.sql', 'utf8'));
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests fil des boutiques réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
