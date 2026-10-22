// Ma boutique (22/10/2026) : accueil du commerçant (« Ma boutique » + Commandes, Articles, Marketing, Clients), onglet
// Marketing (statistiques par période, partage de la vitrine, QR code, réseaux) et réseaux affichés sur la vitrine.
// Chromium (ou ENGINE=webkit), iPhone 13, vrai Postgres local (PGlite). Données synthétiques.
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
const SHOTS = 'docs/screenshots/marketing';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url.replace(/\/?$/, '/');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const pages = [];
async function newPhone(shop, opts = {}) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (shop) await ctx.addInitScript((x) => { localStorage.setItem('fiila.shop', JSON.stringify(x)); }, { id: shop.shop.id, key: shop.key });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Atelier Marketing (test)', business_type: 'mode' } });
const A = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe Ndella (test)', price: 12000 } });
const SLUG = (await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } })).slug;
await ok('fiila_vitrine', { p_slug: SLUG });
await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: A.id, qty: 2 }], customer: { name: 'Awa (test)', phone: '770000011' } } });
const P = await newPhone(S);

await t('accueil du commerçant : « Ma boutique » en action principale, puis Commandes (en cours), Articles, Marketing, Clients', async () => {
  await P.goto(URL0 + '#/');
  const hero = P.locator('#home-hero[data-hero="boutique"]');
  await hero.waitFor();
  assert.equal(await hero.locator('b').textContent(), 'Ma boutique');
  await P.locator('#home-shop-sub').getByText('Atelier Marketing (test) · 1 commande en cours').waitFor();
  assert.deepEqual(await P.locator('#my-shop .ttile .pro-name').allTextContents(), ['Commandes', 'Articles', 'Marketing', 'Clients']);
  await P.locator('#biz-orders-n').getByText('1').waitFor();
  assert.equal(await P.locator('#act-boutique').count(), 0, 'la boutique n’est pas répétée dans « Mes activités »');
  assert.ok(await noOverflow(P));
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-01-accueil.png` });
  await P.click('#biz-orders');
  await P.locator('#orders .order-row').first().waitFor();
  assert.equal(await P.locator('#tab-orders').getAttribute('aria-current'), 'page');
});

await t('barre de la boutique : 5 onglets lisibles (Commandes, Articles, Marketing, Clients, Réglages), sans débordement', async () => {
  assert.deepEqual((await P.locator('.tabbar .tab').allTextContents()).map((x) => x.trim()), ['Commandes', 'Articles', 'Marketing', 'Clients', 'Réglages']);
  const boxes = await P.locator('.tabbar .tab').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, e.scrollWidth <= e.clientWidth + 1]; }));
  assert.ok(boxes.every((b) => b[2]), 'aucun libellé coupé');
  assert.ok(boxes[4][1] <= 390, 'le dernier onglet tient dans l’écran');
  assert.ok(await noOverflow(P));
});

await t('Marketing : chiffres de la période, comparaison, panier moyen ; changement de période sans rechargement', async () => {
  await P.click('#tab-marketing');
  await P.locator('#mk-revenue').waitFor();
  assert.equal(await P.locator('#tab-marketing').getAttribute('aria-current'), 'page');
  assert.match(await P.locator('#mk-revenue').textContent(), /^24\s000 FCFAVentes$/);
  assert.match(await P.locator('#mk-orders').textContent(), /^1Commande/);
  assert.match(await P.locator('#mk-views').textContent(), /^1Visite du site/);
  assert.match(await P.locator('#mk-line').textContent(), /Panier moyen 24\s000 FCFA · 1 via le site/);
  assert.match(await P.locator('#mk-top').textContent(), /Robe Ndella \(test\).*2 vendus.*Publier/s);
  assert.equal(await P.locator('#mk-top a').getAttribute('href'), '#/boutique/article/' + A.id + '?publier=1');
  await P.locator('#mk-period').getByText('7 jours').click();
  await P.waitForFunction(() => location.hash === '#/boutique/marketing?p=7');
  await P.locator('#mk-revenue').waitFor();
  assert.equal(await P.locator('#mk-period input:checked').getAttribute('value'), '7');
  // Une seule action principale et une seule rangée de filtres (règle 7).
  assert.equal(await P.locator('#app .btn.big').count(), 1);
  assert.equal(await P.locator('#app .segfield').count(), 1);
  assert.ok(await noOverflow(P));
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-02-marketing.png`, fullPage: true });
});

await t('partage de la vitrine : WhatsApp avec le lien, copie, QR code à imprimer, aperçu', async () => {
  const href = await P.locator('#mk-share-wa').getAttribute('href');
  const text = decodeURIComponent(new URL(href).searchParams.get('text'));
  assert.ok(text.includes('#/b/' + SLUG), text);
  await P.click('#mk-qr-btn');
  await P.waitForFunction(() => { const i = document.getElementById('mk-qr-img'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await P.locator('#mk-qr-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(await P.locator('#mk-vitrine').getAttribute('href'), '#/b/' + SLUG);
});

await t('réseaux : saisie « @nom » ou lien, refus clair d’une valeur invalide, affichage sur la vitrine', async () => {
  await P.click('#mk-social-instagram');
  await P.locator('#mk-socials-sheet').waitFor();
  await P.fill('#mk-in-instagram', 'mon compte !');
  await P.click('#mk-socials-save');
  await P.locator('#mk-socials-sheet [role="alert"]').getByText(/Identifiant non reconnu/).waitFor();
  await P.fill('#mk-in-instagram', '@atelier.test');
  await P.fill('#mk-in-tiktok', 'https://www.tiktok.com/@atelier_test');
  await P.click('#mk-socials-save');
  await P.locator('#mk-socials-sheet').waitFor({ state: 'detached' });
  assert.equal(await P.locator('#mk-social-instagram .mk-handle').textContent(), '@atelier.test');
  assert.equal(await P.locator('#mk-social-tiktok .mk-handle').textContent(), '@atelier_test');
  assert.equal(await P.locator('#mk-social-facebook .mk-handle').textContent(), 'Ajouter');
  const V = await newPhone(null);
  await V.goto(URL0 + '#/b/' + SLUG);
  await V.locator('#vitrine-socials').waitFor();
  assert.deepEqual(await V.locator('#vitrine-socials a').evaluateAll((a) => a.map((x) => x.href)),
    ['https://www.instagram.com/atelier.test', 'https://www.tiktok.com/@atelier_test']);
  await V.locator('#vitrine-socials').scrollIntoViewIfNeeded();
  await V.screenshot({ path: `${SHOTS}/${ENGINE}-03-vitrine-reseaux.png` });
  assert.deepEqual(V.__errors, []);
});

await t('mode sombre : accueil et Marketing lisibles, aucune erreur', async () => {
  const D = await newPhone(S, { dark: true });
  await D.goto(URL0 + '#/');
  await D.locator('#my-shop').waitFor();
  await D.screenshot({ path: `${SHOTS}/${ENGINE}-04-accueil-sombre.png` });
  await D.goto(URL0 + '#/boutique/marketing');
  await D.locator('#mk-revenue').waitFor();
  await D.screenshot({ path: `${SHOTS}/${ENGINE}-05-marketing-sombre.png`, fullPage: true });
  assert.deepEqual(D.__errors, []);
  assert.deepEqual(P.__errors, []);
});

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests Ma boutique / Marketing (${ENGINE}) réussis`);
process.exit(failed ? 1 : 0);
