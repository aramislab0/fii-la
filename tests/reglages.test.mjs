// Réglages v2 (fondateur, 27/10/2026, maquette T3zFpNLrgCYn5gjaNkwoJi validée) dans le navigateur : carte « presque prête »
// (anneau x/6, un seul bouton vers ce qui manque, qui avance quand une étape est faite), carte « Mon site », tuiles qui
// ouvrent une feuille avec un seul bouton « Enregistrer », Fil Fii en une ligne, clair et sombre, 320 px sans débordement.
// Captures : docs/screenshots/reglages/.
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
const SHOTS = 'docs/screenshots/reglages';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let failed = 0, passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const pages = [];
async function newPhone(shop, scheme) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme || 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  await ctx.addInitScript((x) => localStorage.setItem('fiila.shop', x), JSON.stringify(shop));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Réglages (test)', business_type: 'mode' } });
await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe (test)', price: 10000 } });
await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } });
const SHOP = { id: S.shop.id, key: S.key };
const metric = async (v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = 'settings_ui' and variant = $1`, [v])).rows[0].n);

let P;
await t('carte « presque prête » : 2 sur 6, ce qui reste en clair, un seul bouton vers la première étape', async () => {
  P = await newPhone(SHOP);
  await P.goto(URL0 + '#/boutique/reglages');
  await P.locator('#st-ready-cta').waitFor();
  assert.equal(await P.locator('#st-ready .st-ring').getAttribute('aria-label'), '2 sur 6 prêts');
  assert.match(await P.locator('#st-ready').textContent(), /Il reste : logo, photo de couverture, livraison et paiement, propriétaire\./);
  assert.equal(await P.locator('#st-ready-cta').getAttribute('data-step'), 'logo');
  assert.equal(await P.locator('#st-ready button, #st-ready a').count(), 1, 'une seule action');
  await P.waitForTimeout(1200);
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-01-reglages.png`, fullPage: true });
  await P.click('#st-ready-cta');
  await P.waitForURL(/#\/boutique\/vitrine/);
  assert.equal(await metric('cta:logo'), 1, 'mesure anonyme du bouton');
});

await t('tuile « Livraison et paiement » : à faire, feuille en pastilles, un seul « Enregistrer » ; la carte avance', async () => {
  await P.goto(URL0 + '#/boutique/reglages');
  await P.locator('#tile-policies .st-badge').getByText('À faire').waitFor();
  await P.click('#tile-policies');
  await P.locator('#policies-sheet').waitFor();
  assert.equal(await P.locator('#policies-sheet .btn').count(), 1);
  await P.locator('#pol-delivery [data-v="jour"]').click();
  await P.locator('#pol-pay [data-v="wave"]').click();
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-02-livraison.png` });
  await P.click('#policies-save');
  await P.locator('#policies-sheet').waitFor({ state: 'detached' });
  await P.locator('#tile-policies').getByText('Le jour même · Wave').waitFor();
  assert.equal(await P.locator('#tile-policies .st-badge').count(), 0);
  assert.equal(await P.locator('#st-ready .st-ring').getAttribute('aria-label'), '3 sur 6 prêts');
  assert.equal(await metric('tile:policies'), 1);
});

await t('tuile « Informations » : nom et type en pastilles, enregistrés ; le titre suit', async () => {
  await P.click('#tile-info');
  await P.locator('#info-sheet').waitFor();
  await P.fill('#shop-name', 'Boutique Réglages 2 (test)');
  await P.locator('#shop-type [data-v="chaussures"]').click();
  await P.click('#shop-save');
  await P.getByText('Boutique mise à jour.').waitFor();
  await P.locator('#tile-info').getByText('Boutique Réglages 2 (test) · Chaussures').waitFor();
});

await t('Équipe et Fil Fii s’ouvrent chacun dans sa feuille, refermée proprement', async () => {
  await P.goto(URL0 + '#/'); await P.goto(URL0 + '#/boutique/reglages');
  await P.locator('#tile-team').getByText('Vous seul(e)').waitFor();
  await P.click('#tile-team');
  await P.locator('#team-list').waitFor();
  await P.click('#team-hub .sheet-x');
  await P.click('#feed-row');
  await P.locator('#feed-status').waitFor();
  await P.click('#feed-sheet .sheet-x');
  assert.equal(await P.locator('.sheet-back').count(), 0);
});

await t('sombre et 320 px : lisible, sans débordement, aucune erreur JavaScript', async () => {
  const D = await newPhone(SHOP, 'dark');
  await D.goto(URL0 + '#/boutique/reglages');
  await D.locator('#st-ready-cta, #st-ready .st-ring.done').first().waitFor();
  await D.waitForTimeout(1200);
  await D.screenshot({ path: `${SHOTS}/${ENGINE}-03-sombre.png`, fullPage: true });
  await D.setViewportSize({ width: 320, height: 760 });
  await D.reload(); await D.locator('#st-tiles .st-tile').first().waitFor();
  assert.ok(await D.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de défilement horizontal à 320 px');
  assert.deepEqual(pages.flatMap((p) => p.__errors), []);
});

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests Réglages v2 réussis — ${ENGINE}`);
process.exit(failed ? 1 : 0);
