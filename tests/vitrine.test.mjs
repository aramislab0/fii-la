// Vitrine de bout en bout : la boutique ouvre sa vitrine, une cliente commande sans compte sur un autre téléphone,
// donne son adresse depuis la facture ; la boutique voit la commande ; la publication pointe vers la vitrine.
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
const SHOTS = 'docs/screenshots/vitrine';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
const results = [];
let failed = 0;
async function t(name, fn) {
  try { await fn(); results.push(name); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone() {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', geolocation: { latitude: 14.75814, longitude: -17.47032, accuracy: 9 }, permissions: ['geolocation'] });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');

const S = await newPhone();
let KEY, URLV, P1, P2, INVOICE;

await t('boutique : ouvre sa vitrine depuis les réglages, lien prêt à envoyer', async () => {
  await S.goto(URL0 + '#/boutique');
  await S.fill('#shop-name', 'Boutique Awa (test)');
  await S.fill('#shop-phone', '77 100 00 01');
  await S.click('#shop-save');
  await S.locator('#shop-title').waitFor();
  KEY = await S.evaluate(() => JSON.parse(localStorage.getItem('fiila.shop')).key);
  P1 = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Robe wax (test)', price: 15000, description: 'Taille M ou L.', photo } });
  P2 = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Foulard (test)', price: 3000 } });
  await S.goto(URL0 + '#/'); await S.goto(URL0 + '#/boutique');
  await S.locator('#vitrine-open-link').click();
  await S.locator('#vitrine-section').getByText('Ouverte').click();
  await S.locator('#vitrine-url').waitFor();
  URLV = await S.locator('#vitrine-url').textContent();
  assert.ok(URLV.endsWith('#/b/boutique-awa-test'), URLV);
  await shot(S, '01-reglages');
});

await t('cliente : vitrine sans compte, photos chargées à l’affichage, panier, commande, puis adresse', async () => {
  const C = await newPhone();
  await C.goto(URLV);
  await C.getByRole('heading', { name: 'Boutique Awa (test)' }).waitFor();
  await C.locator('#vitrine-products .vcard').nth(1).waitFor();
  await C.locator('.vimg img').first().waitFor();
  await shot(C, '02-vitrine');
  await C.locator(`[data-add="${P1.id}"]`).click();
  await C.getByRole('button', { name: 'Ajouter un Robe wax (test)' }).click();
  await C.locator(`[data-add="${P2.id}"]`).click();
  await C.locator('#cart-go').getByText('Commander · 3 articles · 33 000 FCFA').waitFor();
  await C.locator('#cart-go').click();
  await C.locator('#order-total').getByText('33 000 FCFA').waitFor();
  await C.click('#order-send');
  await C.getByText('Indiquez votre nom.').waitFor();
  await C.fill('#v-name', 'Coumba (test)');
  await C.fill('#v-phone', '70 000 00 05');
  await C.fill('#v-note', 'Taille M');
  await shot(C, '03-commande');
  await C.click('#order-send');
  await C.locator('#order-sent').getByText('Commande envoyée à Boutique Awa (test).').waitFor();
  INVOICE = C.url().match(/#\/f\/([A-Za-z0-9_-]+)/)[1];
  assert.match(await C.locator('#notify-shop').getAttribute('href'), /^https:\/\/wa\.me\/221771000001\?text=/);
  await C.locator('#give-address-btn').waitFor();
  assert.equal(await C.evaluate(() => localStorage.length), 0, 'rien écrit sur le téléphone de la cliente');
  await shot(C, '04-facture');
});

await t('boutique : la commande en ligne apparaît, prix de la base, adresse attendue', async () => {
  await S.goto(URL0 + '#/'); await S.goto(URL0 + '#/boutique');
  await S.locator('#orders').getByText('N° 0001 · Coumba (test)').waitFor();
  await S.locator('#orders').getByText('33 000 FCFA').waitFor();
  await S.locator('#orders').getByText(/Adresse attendue/).waitFor();
});

await t('publication d’un article : la légende renvoie vers la vitrine', async () => {
  await S.goto(URL0 + '#/boutique/article/' + P1.id);
  await S.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  await S.click('#product-publish');
  await S.locator('#post-caption').getByText(/Pour commander : .*#\/b\/boutique-awa-test\?a=/).waitFor();
});

await t('personnalisation : modèle Magazine, couleur Prune, couverture ; la vitrine change aussitôt', async () => {
  await S.goto(URL0 + '#/boutique/reglages');
  await S.locator('#vitrine-theme').getByText('Magazine').click();
  await S.getByText('Modèle « Magazine » appliqué.').waitFor();
  await S.getByRole('radio', { name: 'Prune' }).check({ force: true });
  await S.getByText('Couleur « Prune » appliquée.').waitFor();
  await S.setInputFiles('#vitrine-cover', 'tests/fixtures/door-with-exif.jpg');
  await S.getByText('Couverture enregistrée.').waitFor();
  await shot(S, '05-personnalisation');
  const C = await newPhone();
  await C.goto(URLV);
  await C.locator('.vt.vt-magazine').waitFor();
  await C.locator('#vitrine-cover img').waitFor();
  const bg = await C.locator(`[data-add="${P1.id}"]`).evaluate((b) => getComputedStyle(b).backgroundColor);
  assert.equal(bg, 'rgb(91, 42, 134)', 'couleur d’accent appliquée aux boutons');
  await shot(C, '06-magazine');
  await S.locator('#vitrine-theme').getByText('Catalogue').click();
  await S.getByText('Modèle « Catalogue » appliqué.').waitFor();
  await C.goto(URL0 + '#/'); await C.goto(URLV);
  await C.locator('.vt.vt-catalogue').waitFor();
  await shot(C, '07-catalogue');
});

await t('vitrine fermée : message clair, plus de commande possible', async () => {
  await S.goto(URL0 + '#/boutique/reglages');
  await S.locator('#vitrine-section').getByText('Fermée').click();
  await S.getByText('Vitrine fermée.').waitFor();
  const C = await newPhone();
  await C.goto(URLV);
  await C.getByText('La vitrine est fermée pour le moment.').waitFor();
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });

await browser.close();
local.server.close();
console.log(`\n${results.length}/${results.length + failed} tests vitrine réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
