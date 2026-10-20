// Découverte progressive : une suggestion discrète à la fois selon l'usage (accueil, boutique), « Plus tard » respecté,
// suggestion suivie = plus jamais, réglage du back-office qui coupe tout ; mesure anonyme.
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
const SHOTS = 'docs/screenshots/decouverte';
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
async function newPhone(init) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(900); return page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true }); };
const metric = async (v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = 'nudge' and variant = $1`, [v])).rows[0].n);

const key = (await rpc(local.db, 'fiila_shop_save', { p_key: null, p: { name: 'Boutique Découverte (test)', business_type: 'mode' } })).body.key;
await rpc(local.db, 'fiila_product_save', { p_key: key, p: { name: 'Robe (test)', price: 12000 } });

await t('boutique avec 1 article : une seule suggestion (« Encore 2 ou 3 articles ») ; « Plus tard » la fait disparaître et elle ne revient pas', async () => {
  const P = await newPhone(`localStorage.setItem('fiila.shop', JSON.stringify({ key: ${JSON.stringify(key)} }))`);
  await P.goto(URL0 + '#/boutique');
  await P.locator('#nudge-shop_more_products').waitFor();
  assert.equal(await P.locator('.nudge2').count(), 1, 'une seule suggestion par écran');
  await shot(P, '01-boutique-suggestion');
  await P.click('#nudge-shop_more_products-later');
  await P.locator('#nudge-shop_more_products').waitFor({ state: 'detached' });
  await P.reload(); await P.locator('#new-order').waitFor(); await P.waitForTimeout(600);
  assert.equal(await P.locator('.nudge2').count(), 0, '7 jours de silence');
  assert.equal(await metric('shop_more_products:shown'), 1); assert.equal(await metric('shop_more_products:dismiss'), 1);
});

await t('accueil : après une première adresse, la boutique est suggérée ; suivie = plus jamais proposée', async () => {
  const P = await newPhone(`localStorage.setItem('fiila.tx', '1')`);
  await P.goto(URL0 + '#/');
  await P.locator('#nudge-home_shop').waitFor();
  await shot(P, '02-accueil-suggestion');
  await P.click('#nudge-home_shop-go');
  await P.waitForFunction(() => location.hash === '#/boutique');
  await P.goto(URL0 + '#/'); await P.locator('#create-address').waitFor(); await P.waitForTimeout(600);
  assert.equal(await P.locator('#nudge-home_shop').count(), 0);
  assert.equal(await metric('home_shop:click'), 1);
  // Premier passage, sans aucune action : aucune suggestion.
  const N = await newPhone();
  await N.goto(URL0 + '#/'); await N.locator('#create-address').waitFor(); await N.waitForTimeout(600);
  assert.equal(await N.locator('.nudge2').count(), 0, 'jamais au premier geste');
});

await t('réglage du back-office « nudges = 0 » : plus aucune suggestion', async () => {
  await local.db.query(`update fiila.settings set value = '0' where key = 'nudges'`);
  const P = await newPhone(`localStorage.setItem('fiila.tx', '1')`);
  await P.goto(URL0 + '#/'); await P.locator('#create-address').waitFor();
  await P.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await P.reload(); await P.locator('#create-address').waitFor(); await P.waitForTimeout(600);
  assert.equal(await P.locator('.nudge2').count(), 0);
  await local.db.query(`update fiila.settings set value = '1' where key = 'nudges'`);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests découverte progressive réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
