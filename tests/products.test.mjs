// Attributs d'articles de bout en bout : la boutique renseigne catégorie, tailles, couleurs et stock ; la cliente filtre
// « ma taille », choisit taille et couleur, commande ; la facture porte la variante ; un article épuisé ne se commande pas.
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
const SHOTS = 'docs/screenshots/articles';
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
async function newPhone() {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });

const KEY = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Mode Awa (test)', phone: '77 400 00 01' } })).key;
const SLUG = (await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true } })).slug;
await ok('fiila_product_save', { p_key: KEY, p: { name: 'Baskets (test)', price: 25000, category: 'chaussures', sizes: ['41', '42', '43'] } });
await ok('fiila_product_save', { p_key: KEY, p: { name: 'Sac (test)', price: 5000, category: 'accessoires', stock: 0 } });

await t('boutique : article avec catégorie, tailles (raccourci), couleurs et stock depuis le formulaire', async () => {
  const S = await newPhone();
  await S.goto(URL0 + '#/confidentialite');
  await S.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), KEY);
  await S.goto(URL0 + '#/boutique/article/nouveau');
  await S.fill('#product-name', 'Robe wax (test)');
  await S.fill('#product-price', '15000');
  await S.locator('#product-details summary').click();
  await S.selectOption('#product-cat', 'mode');
  await S.getByRole('button', { name: 'Tailles S à XL' }).click();
  await S.fill('#product-colors', 'Rouge, Bleu nuit');
  await S.fill('#product-stock', '2');
  await shot(S, '01-formulaire');
  await S.click('#product-save');
  await S.waitForFunction(() => !/nouveau/.test(location.hash));
  const row = (await local.db.query(`select category, sizes, colors, stock from fiila.products where name = 'Robe wax (test)'`)).rows[0];
  assert.deepEqual(row, { category: 'mode', sizes: ['S', 'M', 'L', 'XL'], colors: ['Rouge', 'Bleu nuit'], stock: 2 });
});

await t('cliente : filtre « ma taille », choix de taille et couleur obligatoire, commande, variante sur la facture', async () => {
  const C = await newPhone();
  await C.goto(URL0 + '#/b/' + SLUG);
  await C.locator('#filter-cat').waitFor();
  assert.equal(await C.locator('.filt-bar .opt-row').count(), 1, 'une seule rangée de filtres visible');
  await C.click('#filter-more');
  await C.selectOption('#fs-size', '42');
  await C.click('#filter-apply');
  assert.match(await C.locator('#filter-more').textContent(), /Filtres · 1/);
  assert.deepEqual(await C.locator('#vitrine-products h3').allTextContents(), ['Baskets (test)']);
  await C.click('#filter-more'); await C.click('#filter-clear');
  await C.locator('#filter-cat').getByRole('button', { name: 'Vêtements' }).click();
  const robe = C.locator('article', { hasText: 'Robe wax (test)' });
  assert.equal(await robe.locator('.opt').count(), 0, 'la carte ne montre pas de pastilles');
  await robe.locator('[data-add]').click();
  const vs = C.locator('#variant-sheet');
  await vs.waitFor();
  await C.waitForTimeout(500); await C.screenshot({ path: `${SHOTS}/${ENGINE}-02b-choix.png` });
  await C.click('#variant-add');
  await vs.getByText('Choisissez votre taille ou pointure.').waitFor();
  await vs.getByRole('button', { name: 'M', exact: true }).click();
  await vs.getByRole('button', { name: 'Bleu nuit' }).click();
  await C.click('#variant-add');
  await vs.waitFor({ state: 'detached' });
  await robe.getByText('1 ajouté').waitFor();
  await robe.getByText('Plus que 2 en stock').waitFor();
  await C.locator('#filter-cat').getByRole('button', { name: 'Tout' }).click();
  await C.locator('article', { hasText: 'Sac (test)' }).getByText('Épuisé').waitFor();
  assert.equal(await C.locator('article', { hasText: 'Sac (test)' }).locator('[data-add]').count(), 0);
  await shot(C, '02-vitrine');
  await C.click('#cart-go');
  await C.getByText('1 × Robe wax (test) (M · Bleu nuit)').waitFor();
  await C.fill('#v-name', 'Cliente (test)');
  await C.fill('#v-phone', '70 000 00 71');
  await C.click('#order-send');
  await C.locator('#order-sent').waitFor();
  await C.getByText('Robe wax (test) (M · Bleu nuit)').first().waitFor();
  assert.equal((await local.db.query(`select stock from fiila.products where name = 'Robe wax (test)'`)).rows[0].stock, 1);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests attributs d’articles réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
