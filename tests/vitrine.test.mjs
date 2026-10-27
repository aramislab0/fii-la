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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');

const S = await newPhone();
let KEY, URLV, P1, P2, INVOICE;

await t('boutique : ouvre sa vitrine depuis les réglages, lien prêt à envoyer', async () => {
  await S.goto(URL0 + '#/boutique');
  await S.fill('#shop-name', 'Boutique Awa (test)');
  await S.selectOption('#shop-type', 'mode');
  if (!(await S.locator('#shop-more').evaluate((d) => d.open))) await S.locator('#shop-more > summary').click();
  await S.fill('#shop-phone', '77 100 00 01');
  await S.click('#shop-save');
  await S.locator('#setup-later').click();
  await S.locator('#shop-title').waitFor();
  KEY = await S.evaluate(() => JSON.parse(localStorage.getItem('fiila.shop')).key);
  P1 = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Robe wax (test)', price: 15000, description: 'Taille M ou L.', photo } });
  P2 = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Foulard (test)', price: 3000 } });
  await S.goto(URL0 + '#/'); await S.goto(URL0 + '#/boutique');
  await S.locator('#vitrine-open-link').click();
  assert.equal(await S.locator('#vitrine-switch').getAttribute('aria-checked'), 'false');
  await S.click('#vitrine-switch'); // un seul toucher
  // Site sans logo : la personnalisation est proposée juste après la mise en ligne (recette du 27/10).
  await S.locator('#look-online').waitFor();
  await S.goto(URL0 + '#/boutique/reglages');
  await S.locator('#vitrine-url').waitFor();
  assert.equal(await S.locator('#vitrine-switch').getAttribute('aria-checked'), 'true');
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
  await S.waitForFunction(() => document.querySelector('#publish-box .pub-card.ready'));
  await S.locator('#publish-box .pub-net[data-net="facebook"]').click();
  await S.locator('#post-caption').getByText(/Pour commander : .*#\/b\/boutique-awa-test\?a=/).waitFor();
});

await t('personnalisation : accès évident, un seul « Enregistrer » ; Magazine, Prune, couverture, logo, réseaux ; la vitrine change', async () => {
  await S.goto(URL0 + '#/boutique/reglages');
  await S.click('#vitrine-customize');
  await S.locator('#look-save').waitFor();
  assert.equal(await S.locator('#look-save').isDisabled(), true, 'rien à enregistrer au départ');
  await S.locator('#vitrine-theme').getByText('Magazine').click();
  await S.locator('#vitrine-accent button[title="Prune"]').click();
  await S.setInputFiles('#vitrine-cover', 'tests/fixtures/door-with-exif.jpg');
  await S.locator('#vitrine-cover').locator('xpath=..').locator('img.photo-prev').waitFor();
  await S.setInputFiles('#look-logo', 'tests/fixtures/door-with-exif.jpg');
  await S.locator('#look-logo-remove').waitFor();
  await S.fill('#look-instagram', '@boutique.awa');
  await S.fill('#look-snapchat', 'boutiqueawa');
  assert.equal(await S.locator('#look-save').isDisabled(), false);
  await S.click('#look-save');
  await S.getByText('Site enregistré.').waitFor();
  assert.equal(await S.locator('#look-save').isDisabled(), true);
  // Modèle premium : verrouillé pour une boutique gratuite → feuille avec aperçu, rien d'enregistré.
  await S.locator('#vitrine-theme-premium [data-theme="atelier"]').click();
  await S.locator('#premium-sheet').waitFor();
  await S.click('#premium-preview');
  await S.locator('#premium-preview-banner').waitFor();
  await S.locator('.vt.vt-atelier').waitFor();
  await shot(S, '05-apercu-atelier');
  const C = await newPhone();
  await C.goto(URLV);
  await C.locator('.vt.vt-magazine').waitFor();
  await C.locator('#vitrine-cover img').waitFor();
  await C.locator('.vprof .vavatar.has-logo img').waitFor();
  assert.deepEqual(await C.locator('#vitrine-socials a').evaluateAll((a) => a.map((x) => x.href)),
    ['https://www.instagram.com/boutique.awa', 'https://www.snapchat.com/add/boutiqueawa']);
  const bg = await C.locator(`[data-add="${P1.id}"]`).evaluate((b) => getComputedStyle(b).backgroundColor);
  assert.equal(bg, 'rgb(91, 42, 134)', 'couleur d’accent appliquée aux boutons');
  await shot(C, '06-magazine');
  await S.goto(URL0 + '#/boutique/vitrine');
  await S.locator('#vitrine-theme').getByText('Catalogue').click();
  await S.click('#look-save');
  await S.getByText('Site enregistré.').waitFor();
  await C.goto(URL0 + '#/'); await C.goto(URLV);
  await C.locator('.vt.vt-catalogue').waitFor();
  await shot(C, '07-catalogue');
});

await t('Premium (réglé au back-office) : le modèle Maison s’applique et s’affiche chez la cliente', async () => {
  await local.db.query(`update fiila.shops set plan = 'premium' where slug = 'boutique-awa-test'`);
  await S.goto(URL0 + '#/'); await S.goto(URL0 + '#/boutique/vitrine');
  await S.locator('#vitrine-theme-premium [data-theme="maison"]').click();
  assert.equal(await S.locator('#premium-sheet').count(), 0, 'plus de verrou');
  await S.click('#look-save');
  await S.getByText('Site enregistré.').waitFor();
  const C = await newPhone();
  await C.goto(URLV);
  await C.locator('.vt.vt-maison').waitFor();
  assert.equal(await C.evaluate(() => document.documentElement.getAttribute('data-vt')), 'maison');
  assert.match(await C.locator('.vhead h1').evaluate((e) => getComputedStyle(e).fontFamily), /Instrument Serif/);
  await shot(C, '08-maison');
  await C.goto(URL0 + '#/');
  assert.equal(await C.evaluate(() => document.documentElement.getAttribute('data-vt')), null, 'la palette ne déborde pas sur le reste de l’app');
});

await t('vitrine fermée : message clair, plus de commande possible', async () => {
  await S.goto(URL0 + '#/boutique/reglages');
  await S.click('#vitrine-switch');
  await S.getByText('Site hors ligne.').waitFor();
  const C = await newPhone();
  await C.goto(URLV);
  await C.getByText('Ce site est hors ligne pour le moment.').waitFor();
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });

await browser.close();
local.server.close();
console.log(`\n${results.length}/${results.length + failed} tests vitrine réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
