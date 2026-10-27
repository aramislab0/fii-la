// Fii Édition, lot V1 (fondateur, 27/10/2026 19:50) dans le navigateur : rubriques dans un ordre fixe (Nouveautés →
// catégories → Promos), fiche article qui rassure (tailles épuisées barrées, guide des tailles, « Vendu par », livraison,
// paiement, échange), « Complétez le look » ; côté boutique : prix barré, tailles épuisées, conditions en pastilles.
// Captures iPhone, clair et sombre : docs/screenshots/edition-v1/.
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
const SHOTS = 'docs/screenshots/edition-v1';
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
async function newPhone(scheme) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme || 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name, full) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: !!full });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');

// Boutique synthétique (supprimée à l'arrêt du serveur de test) : Premium, modèle Édition, conditions choisies.
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Testo Édition (test)', business_type: 'enfants' } });
const KEY = S.key;
const save = (p) => ok('fiila_product_save', { p_key: KEY, p: Object.assign({ photo }, p) });
const ROBE = await save({ name: 'Robe wax (test)', price: 12500, category: 'mode', sizes: ['2 ans', '4 ans', '6 ans', '8 ans'], sizes_out: ['8 ans'], description: 'Robe fille, manches ballon.' });
const BASK = await save({ name: 'Baskets scratch (test)', price: 15000, category: 'chaussures', sizes: ['26', '27', '28'] });
const ENS = await save({ name: 'Ensemble été (test)', price: 9000, price_was: 12000, category: 'mode', sizes: ['4 ans', '6 ans'] });
await save({ name: 'Boubou brodé (test)', price: 18000, category: 'mode', sizes: ['4 ans', '6 ans'] });
await save({ name: 'Sandales (test)', price: 11000, category: 'chaussures', sizes: ['24', '25'] });
await local.db.query(`update fiila.products set created_at = now() - interval '30 days' where id = any($1)`, [[BASK.id, ENS.id]]);
await local.db.query(`update fiila.shops set plan = 'premium' where id = $1`, [S.shop.id]);
const V = await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true, theme: 'edition', policies: { delivery: '24h', pay: ['livraison', 'wave'], exchange: '3j' } } });
const SITE = URL0 + '#/b/' + V.slug;

const C = await newPhone();
await t('rubriques : une rangée, Nouveautés en premier, les catégories, Promos en dernier ; Promos ne montre que le prix barré', async () => {
  await C.goto(SITE);
  await C.locator('#filter-cat').waitFor();
  const tabs = await C.locator('#filter-cat .opt').allTextContents();
  assert.deepEqual(tabs, ['Nouveautés', 'Vêtements', 'Chaussures', 'Promos']);
  assert.equal(await C.locator('.filt-bar').count(), 1, 'une seule rangée de filtres');
  const first = await C.locator('#vitrine-products .vcard h3').first().textContent();
  assert.notEqual(first, 'Baskets scratch (test)', 'les nouveautés d’abord');
  await shot(C, '01-site-rubriques');
  await C.locator('#filter-cat [data-tab="promos"]').click();
  assert.deepEqual(await C.locator('#vitrine-products .vcard h3').allTextContents(), ['Ensemble été (test)']);
  assert.match(await C.locator('#vitrine-products .vprice.sale').textContent(), /12\s000.*9\s000/);
  await C.locator('#vitrine-products .vsale').getByText('−25 %').waitFor();
  await C.locator('#filter-cat [data-tab="new"]').click();
});

await t('fiche article : taille épuisée barrée et non choisissable, guide des tailles, ce qui rassure, « Complétez le look »', async () => {
  await C.locator(`[data-open="${ROBE.id}"]`).click();
  await C.locator('#product-sheet').waitFor();
  const out = C.locator('#sheet-sizes .opt', { hasText: '8 ans' });
  assert.equal(await out.isDisabled(), true);
  assert.equal(await out.getAttribute('aria-label'), '8 ans, épuisé');
  assert.equal(await C.locator('#sheet-add').textContent(), 'Ajouter à la commande');
  const facts = await C.locator('#sheet-facts').textContent();
  assert.match(facts, /Vendu parTesto Édition \(test\)/);
  assert.match(facts, /Sous 24 h/); assert.match(facts, /À la livraison ou Wave/); assert.match(facts, /Sous 3 jours, article non porté/);
  assert.equal(await C.locator('#sheet-look .vlook-it').count(), 3, '3 articles par défaut');
  const firstLook = await C.locator('#sheet-look .vlook-it .vlook-n').first().textContent();
  assert.match(firstLook, /Ensemble été|Boubou/, 'même rubrique et prix proche d’abord');
  await C.waitForTimeout(300);
  await shot(C, '02-fiche-article');
  await C.locator('#product-sheet .vsheet').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await C.waitForTimeout(200);
  await shot(C, '03-fiche-rassure-look');
  await C.click('#sheet-guide');
  await C.locator('#guide-sheet').getByText('Taille de l’enfant').waitFor();
  assert.equal(await C.locator('#guide-sheet tr.out').count(), 1, 'taille épuisée barrée dans le guide');
  await shot(C, '04-guide-tailles');
  await C.click('#guide-close');
});

await t('fiche article : sans taille choisie, rappel ; avec taille, ajout à la commande et barre « Commander »', async () => {
  await C.click('#sheet-add');
  await C.locator('#product-sheet [role="alert"]').getByText('Choisissez votre taille.').waitFor();
  await C.locator('#sheet-sizes .opt', { hasText: '4 ans' }).click();
  assert.equal(await C.locator('#sheet-add').textContent(), 'Ajouter à la commande · 4 ans');
  await C.click('#sheet-add');
  await C.locator('#product-sheet').waitFor({ state: 'detached' });
  await C.locator('#cart-go').getByText('1 article').waitFor();
});

await t('« Complétez le look » ouvre la fiche de l’article touché ; un lien d’article ouvre sa fiche', async () => {
  await C.locator(`[data-open="${ROBE.id}"]`).click();
  await C.locator('#sheet-look .vlook-it').first().click();
  await C.locator('#product-sheet h2').filter({ hasNotText: 'Robe wax' }).waitFor();
  await C.click('#product-sheet-close');
  const D = await newPhone();
  await D.goto(SITE + '?a=' + BASK.id);
  await D.locator('#product-sheet h2').getByText('Baskets scratch (test)').waitFor();
  assert.equal(await D.locator('#sheet-guide').count(), 1, 'pointures : guide des longueurs de pied');
});

await t('commande : une taille épuisée entre-temps est refusée avec un message clair', async () => {
  await save({ id: ROBE.id, name: 'Robe wax (test)', price: 12500, sizes_out: ['4 ans', '8 ans'] });
  await C.click('#cart-go');
  await C.fill('#v-name', 'Cliente test');
  await C.fill('#v-phone', '77 000 00 02');
  await C.click('#order-send');
  await C.getByText('Une taille choisie vient d’être épuisée').waitFor();
  await save({ id: ROBE.id, name: 'Robe wax (test)', price: 12500, sizes_out: ['8 ans'] });
});

await t('sombre : site et fiche article lisibles', async () => {
  const N = await newPhone('dark');
  await N.goto(SITE);
  await N.locator('#filter-cat').waitFor();
  await shot(N, '05-site-sombre');
  await N.locator(`[data-open="${ENS.id}"]`).click();
  await N.locator('#product-sheet').waitFor();
  await N.waitForTimeout(300);
  await shot(N, '06-fiche-sombre');
});

const B = await newPhone();
await t('boutique : prix barré et tailles épuisées sur l’article ; livraison, paiement, échange en pastilles', async () => {
  await B.goto(URL0 + '#/');
  await B.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), KEY);
  await B.goto(URL0 + '#/boutique/article/' + ROBE.id);
  await B.click('#product-promo summary'); // audit du 27/10 : prix barré replié sous « Promo »
  await B.locator('#product-price-was').waitFor();
  await B.locator('#product-sizes-out [data-v="8 ans"][aria-pressed="true"]').waitFor();
  await B.locator('#product-sizes-out [data-v="6 ans"]').click();
  await B.fill('#product-price-was', '10000');
  await B.click('#product-save');
  await B.getByText('Prix barré : indiquez l’ancien prix').waitFor();
  await B.fill('#product-price-was', '15000');
  await B.locator('#product-details').scrollIntoViewIfNeeded();
  await shot(B, '07-article-promo-tailles');
  await B.click('#product-save');
  await B.waitForURL(/#\/boutique\/articles/);
  const r = (await local.db.query(`select price_was, sizes_out from fiila.products where id = $1`, [ROBE.id])).rows[0];
  assert.equal(Number(r.price_was), 15000); assert.deepEqual(r.sizes_out.sort(), ['6 ans', '8 ans']);
  // Réglages v2 : « Livraison et paiement » est une tuile des réglages.
  await B.goto(URL0 + '#/boutique/reglages');
  await B.click('#tile-policies');
  await B.locator('#pol-delivery [data-v="24h"][aria-checked="true"]').waitFor();
  await B.locator('#pol-delivery [data-v="48h"]').click();
  await B.locator('#pol-pay [data-v="om"]').click();
  await shot(B, '08-reglages-livraison');
  await B.click('#policies-save');
  await B.getByText('Enregistré : visible sur la fiche de vos articles.').waitFor();
  const po = (await local.db.query(`select policies from fiila.shops where id = $1`, [S.shop.id])).rows[0].policies;
  assert.deepEqual(po, { delivery: '48h', pay: ['livraison', 'wave', 'om'], exchange: '3j' });
});

await t('aucune erreur JavaScript', async () => {
  const errs = pages.flatMap((p) => p.__errors);
  assert.deepEqual(errs, []);
});

await browser.close();
local.server.close();
console.log(`\n${failed ? 'ÉCHEC' : 'OK'} — Fii Édition V1 (navigateur, ${ENGINE})`);
process.exit(failed ? 1 : 0);
