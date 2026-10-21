// Démarrage guidé de la boutique (accueil v2, lot 2) : 1. nom et type → 2. premier article (ou « Plus tard ») → 3. aperçu,
// ouverture explicite de la vitrine, partage. Reprise après interruption ; boutique sans article jamais proposée au partage ;
// mesure anonyme de chaque étape ; réglage onboarding_v2 = 0 → ancien formulaire.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/demarrage-boutique';
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
async function newPhone(scheme) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme || 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(700); return page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true }); };
const metric = async (v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = 'shop_setup' and variant = $1`, [v])).rows[0].n);
const shopOf = async (name) => (await local.db.query(`select public, slug from fiila.shops where name = $1`, [name])).rows[0];

let P;
await t('étape 1 : nom et type, un seul bouton ; les champs facultatifs repliés', async () => {
  P = await newPhone();
  await P.goto(URL0 + '#/boutique');
  await P.locator('#shop-setup[data-step="1"]').waitFor();
  assert.equal(await P.locator('#shop-phone').isVisible(), false, 'téléphone replié');
  await shot(P, '01-nom');
  await P.click('#shop-save');
  await P.getByText('Donnez un nom à votre boutique.').waitFor();
  await P.fill('#shop-name', 'Boutique Coumba (test)');
  await P.selectOption('#shop-type', 'mode');
  await P.click('#shop-save');
  await P.locator('#shop-setup[data-step="2"]').waitFor();
  assert.match(await P.locator('#setup-win').textContent(), /Étape 1 réussie.*Boutique Coumba \(test\)/);
  assert.equal(await P.locator('.sb-done').count(), 1, 'badge « Boutique » débloqué');
  await shot(P, '01b-felicitations');
  assert.equal(await metric('name:done'), 1);
});

await t('interruption : l’accueil propose « Reprendre ma boutique », qui ramène à l’étape 2', async () => {
  await P.goto(URL0 + '#/');
  await P.locator('#home-hero').waitFor();
  assert.match(await P.locator('#home-hero').textContent(), /Reprendre ma boutique/);
  await P.click('#home-hero');
  await P.locator('#shop-setup[data-step="2"]').waitFor();
  assert.equal(await P.locator('#setup-win').count(), 0, 'la carte de félicitations ne revient pas');
  await shot(P, '02-article');
});

await t('étape 2 → 3 : premier article ; aperçu ; la vitrine ne s’ouvre que sur choix explicite', async () => {
  await P.fill('#product-name', 'Boubou brodé (test)');
  await P.fill('#product-price', '25000');
  await P.click('#setup-product-save');
  await P.locator('#shop-setup[data-step="3"]').waitFor();
  await P.locator('#setup-preview').getByText('Boubou brodé (test)').waitFor();
  await P.locator('#setup-win').getByText('Votre premier article est prêt').waitFor();
  assert.equal(await P.locator('.sb-done').count(), 2);
  assert.equal((await shopOf('Boutique Coumba (test)')).public, false, 'vitrine encore fermée');
  await shot(P, '03-vitrine');
  await P.click('#setup-open');
  await P.locator('#cel').getByText('Bravo, Boutique Coumba (test) est en ligne !').waitFor();
  assert.match(await P.locator('#cel').textContent(), /Place n° \d+ \/ 25/);
  await shot(P, '03b-bravo');
  await P.click('#cel-close');
  await P.locator('#setup-done').waitFor();
  assert.equal((await shopOf('Boutique Coumba (test)')).public, true);
  assert.match(await P.locator('#setup-url').textContent(), /#\/b\//);
  assert.match(await P.locator('#setup-share').getAttribute('href'), /^https:\/\/wa\.me\//);
  await shot(P, '04-prete');
  assert.equal(await metric('product:done'), 1); assert.equal(await metric('vitrine:open'), 1);
  await P.goto(URL0 + '#/'); await P.locator('a.hero').waitFor();
  assert.doesNotMatch(await P.locator('a.hero').textContent(), /Reprendre ma boutique/);
});

await t('« Plus tard » à l’article : boutique enregistrée, vitrine fermée, rien à partager', async () => {
  const Q = await newPhone('dark');
  await Q.goto(URL0 + '#/boutique');
  await Q.fill('#shop-name', 'Boutique Plus Tard (test)');
  await Q.selectOption('#shop-type', 'beaute');
  await Q.click('#shop-save');
  await Q.locator('#shop-setup[data-step="2"]').waitFor();
  await shot(Q, '05-article-sombre');
  await Q.click('#setup-later');
  await Q.locator('#shop-title').waitFor();
  assert.equal(await metric('product:skip'), 1);
  assert.equal((await shopOf('Boutique Plus Tard (test)')).public, false);
  const over = await Q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, 'débordement ' + over);
});

await t('réglage onboarding_v2 = 0 : ancien formulaire de création', async () => {
  await local.db.query(`update fiila.settings set value = '0' where key = 'onboarding_v2'`);
  const R = await newPhone();
  await R.goto(URL0 + '#/'); await R.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await R.goto(URL0 + '#/boutique');
  await R.locator('#shop-save').waitFor();
  assert.equal(await R.locator('#shop-setup').count(), 0);
  assert.ok(await R.locator('#shop-phone').isVisible());
  await local.db.query(`update fiila.settings set value = '1' where key = 'onboarding_v2'`);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests démarrage boutique réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
