// Livreur attitré de bout en bout : invitation WhatsApp, inscription du livreur, course automatique,
// suivi sur la facture, livraison confirmée par le livreur, note de la livraison, suppression de la boutique.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/livreurs';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
const results = [];
let failed = 0;
async function t(name, fn) {
  try { await fn(); results.push({ ok: true, name }); console.log('PASS', name); }
  catch (e) { failed++; results.push({ ok: false, name, err: String(e.message || e).slice(0, 500) }); console.log('FAIL', name, '\n   ', e.message); }
}
const ENTRY = { lat: 14.758140, lng: -17.470320 };
const FAR = { latitude: 14.7167, longitude: -17.4677 };
const pages = [];
async function newPhone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', timezoneId: 'Africa/Dakar', serviceWorkers: 'block', geolocation: { ...FAR, accuracy: 12 }, permissions: ['geolocation'],
  });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (opts.fakeGeo) await ctx.addInitScript((start) => {
    const pos = () => ({ coords: { latitude: start.latitude, longitude: start.longitude, accuracy: 10 }, timestamp: Date.now() });
    navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(pos()), 50); return 1; };
    navigator.geolocation.clearWatch = () => {};
  }, FAR);
  if (opts.owned) await ctx.addInitScript((o) => { if (!localStorage.getItem('fiila.owned')) localStorage.setItem('fiila.owned', JSON.stringify(o)); }, opts.owned);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return { ctx, page };
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
const waText = async (page, sel) => decodeURIComponent(new URL(await page.locator(sel).getAttribute('href')).searchParams.get('text'));
const urlIn = (txt) => txt.match(/https?:\/\/\S+/)[0];

const clientPlace = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez Ndeye (test)', entry: ENTRY, vehicle_ok: true, instruction: 'Porte rouge [TEST]' } });
const S = (await newPhone()).page;     // commerçante
const L = (await newPhone({ fakeGeo: true })).page; // livreur
const C = (await newPhone({ owned: [{ type: 'place', kind: 'address', id: clientPlace.id, owner: clientPlace.owner_token, share: clientPlace.share_token, label: 'Chez Ndeye (test)' }] })).page;
let invite, invoice;

await t('commerçante : boutique sans compte, invitation du livreur sur son WhatsApp', async () => {
  await S.goto(URL0 + '#/boutique');
  await S.fill('#shop-name', 'Boutique Fatim (test)');
  await S.selectOption('#shop-type', 'mode');
  await S.click('#shop-save');
  await S.locator('#shop-title').waitFor();
  await S.getByRole('link', { name: 'Réglages' }).click();
  await S.fill('#courier-name', 'Ibou');
  await S.fill('#courier-phone', '76 333 33 33');
  await S.click('#courier-invite');
  const href = await S.locator('#courier-invite-send').getAttribute('href');
  assert.match(href, /^https:\/\/wa\.me\/221763333333\?text=/);
  invite = urlIn(await waText(S, '#courier-invite-send'));
  assert.match(invite, /#\/livreur\/invitation\/[A-Za-z0-9_-]{20,}$/);
  await shot(S, '01-invitation');
});

await t('livreur : ouvre l’invitation, crée son espace sans compte, accepte', async () => {
  await L.goto(invite);
  await L.getByText('Boutique Fatim (test) vous propose d’être son livreur attitré').waitFor();
  assert.equal(await L.inputValue('#cr-name'), 'Ibou');
  await L.locator('#cr-vehicle').getByText('Moto').click();
  await L.click('#courier-register');
  await L.getByText('Vous êtes le livreur attitré de Boutique Fatim (test).').waitFor();
  await L.getByText('Aucune course pour l’instant.').waitFor();
  await L.getByText('Livreur attitré de : Boutique Fatim (test).').waitFor();
  await S.reload();
  // la boutique confirme que c'est bien son livreur (audit S4)
  await S.locator('#courier-to-confirm').getByText('Ibou').waitFor();
  await S.click('#courier-confirm');
  await S.getByText('Ibou est votre livreur.').waitFor();
  await S.locator('#courier-auto').getByText('Automatique').waitFor();
});

await t('commande → la cliente donne son adresse → la course arrive seule chez le livreur', async () => {
  await S.goto(URL0 + '#/commande/nouvelle');
  await S.fill('#cust-name', 'Ndeye (test)');
  await S.fill('#cust-phone', '70 444 44 44');
  await S.locator('.li-label').first().fill('Thiouraye');
  await S.locator('.li-price').first().fill('2500');
  await S.click('#order-create');
  await S.locator('#order-created').waitFor();
  invoice = urlIn(await waText(S, '#send-invoice'));
  await C.goto(invoice);
  await C.click('#give-address-btn');
  await C.click('#send-address');
  await C.click('#back-invoice');
  await C.getByText('Ibou n’est pas encore parti').waitFor();
  await L.reload();
  await L.locator('#courses').getByText('Boutique Fatim (test) · N° 0001').waitFor();
  await L.locator('#courses').getByText('À encaisser :').waitFor();
  await shot(L, '02-course-recue');
  await S.reload();
  await S.locator('#att-course').getByText('Ibou').waitFor();
});

await t('livreur : démarre la course ; la cliente le voit en route sur sa facture', async () => {
  await L.locator('#courses').getByRole('link', { name: 'Ouvrir la course' }).click();
  await L.getByRole('heading', { name: 'Chez Ndeye (test)' }).waitFor();
  await L.getByRole('button', { name: 'Démarrer la livraison' }).click();
  await L.getByText('Position partagée').waitFor();
  await C.reload();
  await C.getByText(/Ibou en route · environ \d+ min/).waitFor();
});

await t('livreur : « Livrée » → commande livrée ; la cliente note la livraison', async () => {
  await L.goto(URL0 + '#/livreur');
  await L.locator('#courses').getByRole('button', { name: 'C’est livré' }).click();
  await L.getByText('Livraison confirmée.').waitFor();
  await L.getByText('Aucune course pour l’instant.').waitFor();
  await C.reload();
  await C.locator('#courier-rate').waitFor();
  await C.getByRole('radio', { name: 'Livraison 5 sur 5' }).click();
  await C.getByText('Merci pour votre note.').waitFor();
  await shot(C, '03-note-livraison');
  await L.reload();
  await L.getByText('5,0 (1)').waitFor();
  await S.goto(URL0 + '#/boutique?vue=done');
  await S.locator('#orders').getByText('N° 0001 · Ndeye (test)').waitFor();
});

await t('livreur indisponible : la commande suivante ne lui est pas envoyée', async () => {
  await L.locator('#cr-active').getByText('Indisponible').click();
  await L.getByText('Plus de nouvelles courses pour l’instant.').waitFor();
  await S.goto(URL0 + '#/clients');
  await S.locator('#customers').getByText('Ndeye (test)').click();
  await S.click('#customer-order');
  await S.locator('.li-label').first().fill('Café Touba');
  await S.locator('.li-price').first().fill('1000');
  await S.click('#order-create');
  await S.getByText('Commande N° 0002').waitFor();
  await S.locator('#dispatch-att').waitFor(); // envoi manuel proposé
  await L.locator('#cr-active').getByText('Disponible', { exact: true }).click();
  await S.click('#dispatch-att');
  await S.getByText('Course envoyée à Ibou.').waitFor();
  await L.reload();
  await L.locator('#courses').getByText('N° 0002').waitFor();
});

await t('suppression de la boutique : tout part, l’adresse de la cliente reste, le livreur n’a plus de course', async () => {
  await S.goto(URL0 + '#/boutique/reglages');
  await S.locator('#shop-delete-box summary').click();
  await S.click('#shop-delete');
  await S.click('#shop-delete-confirm');
  await S.getByText('Boutique supprimée.').waitFor();
  const n = async (sql) => (await local.db.query(sql)).rows[0].n;
  assert.equal(await n(`select count(*)::int n from fiila.shops where not platform`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.orders o join fiila.shops s on s.id = o.shop_id where not s.platform`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.places where id = '${clientPlace.id}'`), 1);
  await L.reload();
  await L.getByText('Aucune course pour l’instant.').waitFor();
  assert.equal(await S.evaluate(() => localStorage.getItem('fiila.shop')), null);
});

await t('aucune erreur JavaScript', async () => {
  assert.deepEqual(pages.flatMap((p) => p.__errors || []), []);
});

await ok('fiila_delete_place', { p_id: clientPlace.id, p_owner: clientPlace.owner_token });
await browser.close();
local.server.close();
const report = { moteur: ENGINE, version, date: new Date().toISOString(), reussis: results.filter((r) => r.ok).length, total: results.length, results };
writeFileSync(`docs/couriers-test-report-${ENGINE}.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.reussis}/${report.total} tests livreurs réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
