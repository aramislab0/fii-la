// Rétention lot 1 (v2 validée le 22/10/2026, revue VP R1–R5) : une suggestion à la fois sous un budget commun (une exposition
// par session, deux sur 7 jours), comptée à la visibilité ; clic ≠ usage ; succès relu dans l'état réel (serveur) ; répétition ;
// anciens « suivie » non relancés ; commande sans adresse en tête (hors budget) ; interrupteurs général et par suggestion.
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
const metric = async (v, ev = 'retention') => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = $2 and variant = $1`, [v, ev])).rows[0].n);
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); if (r.status !== 200) throw new Error(fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shopInit = (k, extra = '') => `localStorage.setItem('fiila.shop', JSON.stringify({ key: ${JSON.stringify(k)} }));` + extra;
const settle = (P) => P.waitForTimeout(700);


const S1 = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Découverte (test)', business_type: 'mode' } });
await ok('fiila_product_save', { p_key: S1.key, p: { name: 'Robe (test)', price: 12000 } });

await t('boutique à 1 article : une suggestion, comptée une fois à la visibilité ; un rechargement ne recompte pas ; « Plus tard » = silence', async () => {
  const P = await newPhone(shopInit(S1.key));
  await P.goto(URL0 + '#/boutique');
  await P.locator('#nudge-shop_more_products').waitFor();
  assert.equal(await P.locator('.nudge2').count(), 1, 'une seule suggestion par écran');
  await settle(P);
  await shot(P, '01-boutique-suggestion');
  await P.reload(); await P.locator('#nudge-shop_more_products').waitFor(); await settle(P);
  assert.equal(await metric('shop_more_products:shown'), 1, 'même session : même carte, pas de nouvelle exposition');
  await P.click('#nudge-shop_more_products-later');
  await P.locator('#nudge-shop_more_products').waitFor({ state: 'detached' });
  await P.reload(); await P.locator('#new-order').waitFor(); await settle(P);
  assert.equal(await P.locator('.nudge2').count(), 0, '7 jours de silence');
  assert.equal(await metric('shop_more_products:dismiss'), 1);
});

await t('clic sans succès ≠ usage ; succès confirmé par le serveur (article ajouté) sous 7 jours = usage ; nouveau succès un jour plus tard = répétition', async () => {
  const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Succès (test)', business_type: 'mode' } });
  await ok('fiila_product_save', { p_key: S.key, p: { name: 'Pagne (test)', price: 5000 } });
  const P = await newPhone(shopInit(S.key));
  await P.goto(URL0 + '#/boutique');
  await P.locator('#nudge-shop_more_products').waitFor(); await settle(P);
  await P.click('#nudge-shop_more_products-go');
  await P.waitForFunction(() => location.hash === '#/boutique/article/nouveau');
  await P.goto(URL0 + '#/boutique'); await P.locator('#nudge-shop_more_products').waitFor(); await settle(P);
  assert.equal(await metric('shop_more_products:used'), 0, 'un clic n’est pas un usage');
  await ok('fiila_product_save', { p_key: S.key, p: { name: 'Sac (test)', price: 7000 } });
  await P.reload(); await P.locator('#new-order').waitFor(); await settle(P);
  assert.equal(await metric('shop_more_products:used'), 1, 'succès relu dans l’état réel');
  assert.equal(await P.locator('#nudge-shop_more_products').count(), 0, 'utilisée : plus proposée');
  await P.evaluate(() => { const st = JSON.parse(localStorage.getItem('fiila.ret')); st.s.shop_more_products.used -= 2 * 864e5; localStorage.setItem('fiila.ret', JSON.stringify(st)); });
  await ok('fiila_product_save', { p_key: S.key, p: { name: 'Foulard (test)', price: 3000 } });
  await P.reload(); await P.locator('#new-order').waitFor(); await settle(P);
  assert.equal(await metric('shop_more_products:repeat'), 1);
});

await t('budget commun : deux expositions au plus sur 7 jours, d’une session à l’autre (accueil, boutique, fin de tâche)', async () => {
  const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Budget (test)', business_type: 'mode' } });
  await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe (test)', price: 9000 } });
  const P = await newPhone(shopInit(S.key));
  const ctx = P.context();
  await P.goto(URL0 + '#/boutique'); await P.locator('#nudge-shop_more_products').waitFor(); await settle(P);
  await P.click('#nudge-shop_more_products-later');
  const P2 = await ctx.newPage(); P2.__errors = []; P2.on('pageerror', (e) => P2.__errors.push(String(e))); pages.push(P2);
  await P2.evaluate(() => 0).catch(() => {});
  await P2.goto(URL0 + '#/boutique'); await P2.locator('#new-order').waitFor(); await settle(P2);
  // La seule suggestion éligible est en silence : rien.
  assert.equal(await P2.locator('.nudge2').count(), 0);
  await P2.evaluate(() => { const st = JSON.parse(localStorage.getItem('fiila.ret')); st.exp = [Date.now(), Date.now()]; delete st.s.shop_more_products.until; st.s.shop_more_products.d = 0; localStorage.setItem('fiila.ret', JSON.stringify(st)); });
  const P3 = await ctx.newPage(); pages.push(P3); P3.__errors = [];
  await P3.goto(URL0 + '#/boutique'); await P3.locator('#new-order').waitFor(); await settle(P3);
  assert.equal(await P3.locator('.nudge2').count(), 0, 'deux expositions sur 7 jours : plus rien');
});

await t('R1 : commande sans adresse en tête de Ma boutique, même sans article (hors budget) ; mène à la commande', async () => {
  const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Commandes (test)', business_type: 'mode' } });
  const o = await ok('fiila_order_create', { p_key: S.key, p: { customer: { name: 'Awa (test)', phone: '770000041' }, items: [{ label: 'Robe', qty: 1, price: 5000 }] } });
  const P = await newPhone(shopInit(S.key, `localStorage.setItem('fiila.ret', JSON.stringify({ s: {}, exp: [Date.now(), Date.now()] }));`));
  await P.goto(URL0 + '#/boutique');
  await P.locator('#need-address').getByText('1 commande attend une adresse').waitFor();
  await settle(P);
  await shot(P, '02-commande-sans-adresse');
  assert.equal(await metric('shown', 'order_address'), 1);
  await P.click('#need-address');
  await P.waitForFunction(() => /#\/commande\/[0-9a-f-]{36}/.test(location.hash));
  assert.ok(P.url().includes(o.id || ''), 'la commande concernée');
});

await t('R1 : site hors ligne → jamais « partager le site » ; anciens « suivie » non relancés ; accueil : boutique suggérée après une action', async () => {
  const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Hors ligne (test)', business_type: 'mode' } });
  for (const n of ['A', 'B', 'C']) await ok('fiila_product_save', { p_key: S.key, p: { name: 'Article ' + n + ' (test)', price: 1000 } });
  const P = await newPhone(shopInit(S.key));
  await P.goto(URL0 + '#/boutique'); await P.locator('#new-order').waitFor(); await settle(P);
  assert.equal(await P.locator('#nudge-shop_share_vitrine').count(), 0);
  const L = await newPhone(`localStorage.setItem('fiila.tx', '1'); localStorage.setItem('fiila.nudges', JSON.stringify({ ids: { home_shop: { done: true } } }));`);
  await L.goto(URL0 + '#/'); await L.locator('#create-address').waitFor(); await settle(L);
  assert.equal(await L.locator('#nudge-home_shop').count(), 0, 'ancien clic : pas de relance au déploiement');
  const H = await newPhone(`localStorage.setItem('fiila.tx', '1')`);
  await H.goto(URL0 + '#/'); await H.locator('#nudge-home_shop').waitFor(); await settle(H);
  await shot(H, '03-accueil-suggestion');
  const N = await newPhone();
  await N.goto(URL0 + '#/'); await N.locator('#create-address').waitFor(); await settle(N);
  assert.equal(await N.locator('.nudge2').count(), 0, 'jamais au premier geste');
});

await t('interrupteurs : une suggestion coupée au back-office ; « nudges = 0 » coupe tout', async () => {
  await local.db.query(`insert into fiila.settings (key, value) values ('sugg_home_shop', '0') on conflict (key) do update set value = '0'`);
  const P = await newPhone(`localStorage.setItem('fiila.tx', '1')`);
  await P.goto(URL0 + '#/'); await P.locator('#create-address').waitFor();
  await P.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await P.reload(); await P.locator('#create-address').waitFor(); await settle(P);
  assert.equal(await P.locator('#nudge-home_shop').count(), 0);
  await local.db.query(`update fiila.settings set value = '1' where key = 'sugg_home_shop'`);
  await local.db.query(`update fiila.settings set value = '0' where key = 'nudges'`);
  const Q = await newPhone(`localStorage.setItem('fiila.tx', '1')`);
  await Q.goto(URL0 + '#/'); await Q.locator('#create-address').waitFor();
  await Q.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await Q.reload(); await Q.locator('#create-address').waitFor(); await settle(Q);
  assert.equal(await Q.locator('.nudge2').count(), 0);
  await local.db.query(`update fiila.settings set value = '1' where key = 'nudges'`);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors || []), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests rétention (suggestions) réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
