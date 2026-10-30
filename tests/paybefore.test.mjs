// Paiement avant la livraison dans le navigateur (fondateur, 30/10/2026 16:15) : la boutique choisit ses modes (à la
// livraison, Wave ou Orange Money avant la livraison, avec son numéro) ; la cliente choisit en commandant ; sa facture
// montre le montant et le numéro ; la boutique confirme la réception. Un article sans prix ne peut pas être publié.
// Captures iPhone : docs/screenshots/paiement/.
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
const SHOTS = 'docs/screenshots/paiement';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone() {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png` });

// Boutique synthétique (supprimée à l'arrêt du serveur de test), avec un téléphone : il est proposé comme numéro Wave.
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Paiement Démo (test)', business_type: 'mode', phone: '77 123 45 67' } });
const KEY = S.key;
const P = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Sac cabas (test)', price: 10000 } });
const V = await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true } });
const SITE = URL0 + '#/b/' + V.slug;

const B = await newPhone();
await B.goto(URL0);
await B.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), KEY);

await t('réglages : à la livraison + Wave avant la livraison, numéro proposé d’office (téléphone de la boutique)', async () => {
  await B.goto(URL0 + '#/boutique/reglages');
  await B.click('#tile-policies');
  await B.locator('#pol-pay [data-v="livraison"]').click();
  await B.locator('#pol-pay [data-v="wave"]').click();
  assert.match(await B.inputValue('#pol-wave-to'), /77 ?123 ?45 ?67/);
  await B.locator('#pol-pay-hint').waitFor();
  await shot(B, '01-reglages');
  await B.click('#policies-save');
  await B.locator('#policies-sheet').waitFor({ state: 'detached' });
  const po = (await local.db.query(`select policies from fiila.shops where id = $1`, [S.shop.id])).rows[0].policies;
  assert.deepEqual(po.pay, ['livraison', 'wave']); assert.ok(po.wave_to);
});

const C = await newPhone();
let invoiceUrl = '';
await t('commande : la cliente choisit Wave ; la facture montre le montant et le numéro à payer', async () => {
  await C.goto(SITE);
  await C.locator(`[data-add="${P.id}"]`).first().click();
  await C.click('#cart-go');
  await C.fill('#v-name', 'Awa (test)');
  await C.fill('#v-phone', '77 000 00 09');
  await C.click('#order-send');
  await C.getByText('Choisissez comment vous payez.').waitFor();
  await C.click('#v-pay [data-pay="wave"]');
  await C.locator('#v-pay-hint').waitFor();
  await shot(C, '02-commande-choix');
  await C.click('#order-send');
  await C.locator('#pay-before').waitFor();
  assert.match(await C.locator('#pay-before').textContent(), /10\s000\s?FCFA.*Wave/);
  assert.match(await C.locator('#pay-to').textContent(), /77 ?123 ?45 ?67/);
  invoiceUrl = C.url();
  await shot(C, '03-facture-a-payer');
});

await t('boutique : « Paiement attendu », puis « Wave reçu » enregistre le paiement ; la facture passe à payée', async () => {
  const o = (await local.db.query(`select id, pay_mode from fiila.orders where shop_id = $1 order by created_at desc limit 1`, [S.shop.id])).rows[0];
  assert.equal(o.pay_mode, 'wave');
  await B.goto(URL0 + '#/commande/' + o.id);
  await B.locator('#prepay-received').waitFor();
  assert.match(await B.locator('#order-pay-mode').textContent(), /Wave, avant la livraison/);
  await shot(B, '04-commande-boutique');
  await B.click('#prepay-received');
  await B.getByText('Paiement enregistré : vous pouvez livrer.').waitFor();
  await C.goto(invoiceUrl.replace('?nouvelle=1', ''));
  await C.locator('#inv-remaining').getByText('Payée').waitFor();
  assert.equal(await C.locator('#pay-before').count(), 0);
});

await t('article sans prix : visible refusé avec un message clair, enregistré masqué', async () => {
  await B.goto(URL0 + '#/boutique/article/nouveau');
  await B.fill('#product-name', 'Sans prix (test)');
  await B.fill('#product-price', '0');
  await B.click('#product-save');
  await B.getByText('Ajoutez un prix pour publier l’article.').waitFor();
  await B.click('#product-active');
  await B.click('#product-save');
  await B.waitForURL(/#\/boutique\/articles/);
  const r = (await local.db.query(`select active from fiila.products where shop_id = $1 and name = 'Sans prix (test)'`, [S.shop.id])).rows[0];
  assert.equal(r.active, false);
});

await t('aucune erreur JavaScript', async () => {
  assert.deepEqual(pages.flatMap((p) => p.__errors), []);
});

await browser.close();
local.server.close();
console.log(`\n${failed ? 'ÉCHEC' : 'OK'} — paiement avant livraison (navigateur, ${ENGINE})`);
process.exit(failed ? 1 : 0);
