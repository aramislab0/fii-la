// Découverte après une action (accueil v2, lot 3) : la tâche du lien d'abord ; dessous, une seule proposition discrète et
// masquable + « Voir tous les services ». Contextes : adresse envoyée (demande ou commande), course de livraison, fiche reçue.
// « × » = 7 jours de silence ; réglage discover_after = 0 → rien ; mesure anonyme.
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
const SHOTS = 'docs/screenshots/apres-action';
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
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const pages = [];
async function newPhone(init) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(700); return page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true }); };
const metric = async (v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = 'discover' and variant = $1`, [v])).rows[0].n);

const addr = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez Awa (test)', locality: 'Ouakam', instruction: 'Portail vert [TEST]', entry: { lat: 14.72, lng: -17.48 }, vehicle_ok: true } });
const req1 = await ok('fiila_create_request', { p: { requester_name: 'Boutique Ndèye (test)', purpose: 'Livraison' } });
const req2 = await ok('fiila_create_request', { p: { requester_name: 'Boutique Binta (test)', purpose: 'Livraison' } });
const deliv = await ok('fiila_start_delivery', { p_kind: 'place', p_id: addr.id, p_owner: addr.owner_token });
const OWN = `localStorage.setItem('fiila.owned', JSON.stringify([{ type: 'place', kind: 'address', id: ${JSON.stringify(addr.id)}, owner: ${JSON.stringify(addr.owner_token)}, share: ${JSON.stringify(addr.share_token)}, label: 'Chez Awa (test)' }]))`;

await t('adresse envoyée à une demande : « C’est envoyé » d’abord, puis une proposition discrète et « Voir tous les services »', async () => {
  const P = await newPhone(OWN);
  await P.goto(URL0 + '#/d/' + req1.share_token + '?sel=' + addr.id);
  await P.click('#send-address');
  await P.locator('#sent').waitFor();
  await P.locator('#after-sent').waitFor();
  const order = await P.evaluate(() => [...document.querySelectorAll('#sent, #after-sent')].map((e) => e.id));
  assert.deepEqual(order, ['sent', 'after-sent'], 'la tâche reste en premier');
  await shot(P, '01-adresse-envoyee');
  await P.click('#after-all');
  await P.locator('#services-sheet').waitFor();
  assert.equal(await metric('sent:all'), 1);
});

await t('adresse donnée pour une commande : « Revenir à ma commande », puis « Ouvrir ma boutique gratuite »', async () => {
  const P = await newPhone(OWN);
  await P.goto(URL0 + '#/d/' + req2.share_token + '?sel=' + addr.id + '&f=' + 'A'.repeat(22));
  await P.click('#send-address');
  await P.locator('#back-invoice').waitFor();
  await P.locator('#after-order').getByText('Ouvrir ma boutique gratuite').waitFor();
  await P.click('#after-order-go');
  await P.locator('#shop-setup[data-step="1"]').waitFor();
  assert.equal(await metric('order:click'), 1);
});

await t('course de livraison (sans espace livreur) : « Mon espace livreur » ; « × » = plus rien pendant 7 jours', async () => {
  const P = await newPhone();
  await P.goto(URL0 + '#/l/' + deliv.courier_token);
  await P.locator('#after-course').waitFor();
  await shot(P, '02-course');
  await P.click('#after-course-hide');
  await P.locator('#after-course').waitFor({ state: 'detached' });
  await P.reload(); await P.locator('.fiche').first().waitFor(); await P.waitForTimeout(500);
  assert.equal(await P.locator('#after-course').count(), 0);
  assert.equal(await metric('course:hide'), 1);
});

await t('fiche reçue : « Voir tous les services » sous la découverte existante', async () => {
  const P = await newPhone();
  await P.goto(URL0 + '#/a/' + addr.share_token);
  await P.locator('#discover #after-all').click();
  await P.locator('#services-sheet').waitFor();
  assert.equal(await metric('fiche:all'), 1);
});

await t('réglage discover_after = 0 : aucune proposition après une action', async () => {
  await local.db.query(`update fiila.settings set value = '0' where key = 'discover_after'`);
  const P = await newPhone();
  await P.goto(URL0 + '#/'); await P.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await P.goto(URL0 + '#/l/' + deliv.courier_token);
  await P.locator('.fiche').first().waitFor(); await P.waitForTimeout(500);
  assert.equal(await P.locator('#after-course').count(), 0);
  await local.db.query(`update fiila.settings set value = '1' where key = 'discover_after'`);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests découverte après action réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
