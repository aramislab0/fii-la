// Accueil adaptatif (UX-ADAPTATIVE-001, avis du Builder v1.1 validé le 22/10/2026) : le bouton principal apprend des tâches
// réussies (jamais des écrans ouverts), choix de l'utilisateur (« Mettre en premier »), remise à zéro, réglage adaptive_home ;
// haut de Ma boutique : commande sans adresse → reprise d'une tâche commencée → suggestion. Données synthétiques.
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
const SHOTS = 'docs/screenshots/accueil-adaptatif';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url.replace(/\/?$/, '/');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); if (r.status !== 200) throw new Error(fn + ' ' + JSON.stringify(r.body)); return r.body; };
const metric = async (ev, v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = $1 and variant = $2`, [ev, v])).rows[0].n);
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
const D = 864e5;
const succ = (log) => `localStorage.setItem('fiila.succ', JSON.stringify({ local: { log: ${JSON.stringify(log)} } }));`;
const opens = (svc, n) => `localStorage.setItem('fiila.acts', JSON.stringify({ log: { ${svc}: Array.from({ length: ${n} }, (_, i) => Date.now() - i * 3600e3) }, used: { ${svc}: 1 }, hidden: {} }));`;
const hero = (P) => P.locator('.hero').first().getAttribute('data-hero');

await t('nouvel utilisateur : « Créer mon adresse » ; 6 ouvertures de « Demander » sans envoi ne changent rien', async () => {
  const P = await newPhone();
  await P.goto(URL0 + '#/'); await P.locator('.hero').waitFor();
  assert.equal(await hero(P), 'adresse');
  const Q = await newPhone(opens('demander', 6));
  await Q.goto(URL0 + '#/'); await Q.locator('.hero').waitFor();
  assert.equal(await hero(Q), 'adresse', 'des écrans ouverts ne sont pas des réussites');
});

await t('3 événements créés en 10 jours : « Créer un événement » en bouton principal, explication dans les services', async () => {
  const P = await newPhone(succ({ evenement: [Date.now() - 9 * D, Date.now() - 4 * D, Date.now() - D] }));
  await P.goto(URL0 + '#/'); await P.locator('.hero').waitFor();
  assert.equal(await hero(P), 'evenement');
  assert.equal(await P.locator('#home-hero').getAttribute('data-why'), 'auto');
  await P.click('#services-open');
  await P.locator('#home-why').getByText(/« Créer un événement », d’après vos 3 réussites récentes/).waitFor();
  await P.waitForTimeout(700); await P.screenshot({ path: `${SHOTS}/${ENGINE}-01-services-explication.png` });
});

await t('vraie réussite : une demande créée compte ; le bouton change au retour sur l’accueil, mesure « touché puis réussi »', async () => {
  const P = await newPhone(succ({ demander: [Date.now() - 3 * D] }));
  await P.goto(URL0 + '#/'); await P.locator('.hero').waitFor();
  assert.equal(await hero(P), 'adresse', 'une seule réussite : sous le seuil');
  await P.goto(URL0 + '#/demande/nouvelle');
  await P.getByLabel('Votre nom ou celui de votre commerce').fill('Boutique Adaptative (test)');
  await P.getByLabel('Pourquoi demandez-vous l’adresse ?').fill('Livraison (test)');
  await P.getByText('Créer la demande', { exact: true }).click();
  await P.getByText('En attente de réponse').waitFor();
  await P.goto(URL0 + '#/'); await P.locator('.hero').waitFor();
  assert.equal(await hero(P), 'demander', 'deux réussites, deux jours différents');
  await P.waitForTimeout(600);
  await P.click('#home-hero');
  await P.waitForFunction(() => location.hash.startsWith('#/demande'));
  await P.getByLabel('Votre nom ou celui de votre commerce').fill('Boutique Adaptative (test)');
  await P.getByLabel('Pourquoi demandez-vous l’adresse ?').fill('Livraison 2 (test)');
  await P.getByText('Créer la demande', { exact: true }).click();
  await P.getByText('En attente de réponse').waitFor();
  assert.equal(await metric('home_hero', 'demander:click'), 1);
  assert.equal(await metric('home_hero', 'demander:success'), 1);
});

await t('« Mettre en premier », retour au choix automatique, remise à zéro (aucune fiche touchée)', async () => {
  const P = await newPhone(succ({ evenement: [Date.now() - 2 * D, Date.now() - D] }));
  await P.goto(URL0 + '#/'); await P.locator('.hero').waitFor();
  assert.equal(await hero(P), 'evenement');
  await P.click('#services-open');
  await P.click('#svc-livreur-pin');
  await P.getByText('« Espace livreur » est en premier sur l’accueil.').waitFor();
  await P.locator('.hero[data-hero="livreur"]').waitFor();
  await P.click('#services-open');
  await P.locator('#svc-livreur-pinned').waitFor();
  await P.click('#home-unpin');
  await P.locator('.hero[data-hero="evenement"]').waitFor();
  await P.click('#services-open');
  await P.click('#home-reset');
  await P.getByText('Accueil remis à zéro. Vos adresses et commandes ne changent pas.').waitFor();
  await P.locator('.hero[data-hero="adresse"]').waitFor();
  assert.equal(await metric('home_pref', 'pin'), 1); assert.equal(await metric('home_pref', 'unpin'), 1); assert.equal(await metric('home_pref', 'reset'), 1);
});

await t('réglage adaptive_home = 0 : retour à la règle d’avant (écrans ouverts), sans perte du journal', async () => {
  await local.db.query(`insert into fiila.settings (key, value) values ('adaptive_home', '0') on conflict (key) do update set value = '0'`);
  const P = await newPhone(opens('demander', 3) + succ({ evenement: [Date.now() - 2 * D, Date.now() - D] }));
  await P.goto(URL0 + '#/'); await P.locator('.hero').waitFor();
  await P.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await P.reload(); await P.locator('.hero').waitFor();
  assert.equal(await hero(P), 'demander');
  assert.ok(await P.evaluate(() => JSON.parse(localStorage.getItem('fiila.succ')).local.log.evenement.length === 2));
  await local.db.query(`update fiila.settings set value = '1' where key = 'adaptive_home'`);
});

await t('Ma boutique : commande en cours de saisie → « Reprendre la commande », sauf si une commande attend une adresse ; autre boutique = autre contexte', async () => {
  const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Reprise (test)', business_type: 'mode' } });
  await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe (test)', price: 9000 } });
  const P = await newPhone(`localStorage.setItem('fiila.shop', JSON.stringify({ key: ${JSON.stringify(S.key)} }));`);
  await P.goto(URL0 + '#/boutique'); await P.locator('#new-order').waitFor();
  await P.goto(URL0 + '#/commande/nouvelle');
  await P.locator('#order-create').waitFor();
  await P.locator('input').first().fill('Coumba (test)');
  await P.waitForTimeout(300);
  await P.goto(URL0 + '#/boutique');
  await P.locator('#resume-order').getByText('Reprendre la commande en cours').waitFor();
  assert.equal(await P.locator('.nudge2').count(), 0, 'reprise d’abord, pas de suggestion en plus');
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-02-reprise-commande.png` });
  // Brouillon d'une autre boutique : jamais montré ici.
  await P.evaluate(() => { const d = JSON.parse(localStorage.getItem('fiila.draft.order')); d.ctx = 'local|autre-boutique|owner'; localStorage.setItem('fiila.draft.order', JSON.stringify(d)); });
  await P.reload(); await P.locator('#new-order').waitFor(); await P.waitForTimeout(500);
  assert.equal(await P.locator('#resume-order').count(), 0);
  // Commande sans adresse : elle passe avant la reprise.
  await P.evaluate(() => { const d = JSON.parse(localStorage.getItem('fiila.draft.order')); d.ctx = null; localStorage.setItem('fiila.draft.order', JSON.stringify(d)); });
  await ok('fiila_order_create', { p_key: S.key, p: { customer: { name: 'Awa (test)', phone: '770000051' }, items: [{ label: 'Robe', qty: 1, price: 9000 }] } });
  await P.goto(URL0 + '#/commande/nouvelle'); await P.locator('#order-create').waitFor();
  await P.locator('input').first().fill('Fatou (test)'); await P.waitForTimeout(300);
  await P.goto(URL0 + '#/boutique');
  await P.locator('#need-address').waitFor();
  assert.equal(await P.locator('#resume-order').count(), 0, 'besoin bloquant d’abord');
});

await t('Ma boutique : article commencé → « Reprendre l’article », champs restaurés, mesure de la reprise', async () => {
  const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Article (test)', business_type: 'mode' } });
  await ok('fiila_product_save', { p_key: S.key, p: { name: 'Sac (test)', price: 5000 } });
  const P = await newPhone(`localStorage.setItem('fiila.shop', JSON.stringify({ key: ${JSON.stringify(S.key)} }));`);
  await P.goto(URL0 + '#/boutique'); await P.locator('#new-order').waitFor();
  await P.goto(URL0 + '#/boutique/article/nouveau');
  await P.fill('#product-name', 'Kaftan (test)');
  await P.fill('#product-price', '28000');
  await P.goto(URL0 + '#/boutique');
  await P.locator('#resume-product').getByText('Kaftan (test)', { exact: false }).waitFor();
  await P.waitForTimeout(600);
  await P.click('#resume-product');
  await P.locator('#product-name').waitFor();
  assert.equal(await P.inputValue('#product-name'), 'Kaftan (test)');
  assert.equal(await P.inputValue('#product-price'), '28000');
  await P.click('#product-save');
  await P.waitForFunction(() => /#\/boutique\/article\/[0-9a-f-]{36}/.test(location.hash));
  assert.equal(await metric('resume', 'product:click'), 1);
  assert.equal(await metric('resume', 'product:success'), 1);
  assert.equal(await P.evaluate(() => localStorage.getItem('fiila.draft.product')), null);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests accueil adaptatif (${ENGINE}) réussis`);
process.exit(failed ? 1 : 0);
