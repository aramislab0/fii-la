// Salons (beauté & bien-être, fondateur 31/10/2026) dans le navigateur : page du salon (prestations, réalisations,
// horaires), réservation en trois temps avec caution Wave, page du rendez-vous ; côté salon : agenda, « Caution reçue »,
// réglages (horaires, postes), prestation avec durée et caution. Captures iPhone : docs/screenshots/salon/.
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
const SHOTS = 'docs/screenshots/salon';
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
const shot = (page, name, full) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: !!full });
const png = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64'), Buffer.alloc(200)]).toString('base64');

// Salon synthétique (supprimé à l'arrêt du serveur de test) : Premium, modèle Rituel, horaires tous les jours, Wave.
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Salon Démo (test)', business_type: 'coiffure', phone: '77 000 00 09' } });
const KEY = S.key;
await local.db.query(`update fiila.shops set plan = 'premium' where id = $1`, [S.shop.id]);
const V = await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true, theme: 'rituel', accent: 'noir', about: 'Coupes, barbe et soins.',
  policies: { pay: ['wave'], wave_to: '77 111 22 33' } } });
const ALL = {}; for (let d = 0; d <= 6; d++) ALL[d] = ['08:00', '22:00'];
await ok('fiila_shop_salon', { p_key: KEY, p: { hours: ALL, seats: 1, step: '30' } });
const CUT = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Coupe homme (test)', price: 5000, duration: 30, rubric: 'Coupes' } });
const FADE = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Coupe + barbe (test)', price: 8000, duration: 60, deposit: 2000, rubric: 'Coupes' } });
await ok('fiila_product_save', { p_key: KEY, p: { name: 'Manucure (test)', price: 6000, duration: 45, rubric: 'Beauté' } });
await ok('fiila_reel_add', { p_key: KEY, p: { poster: png, caption: 'Low fade' } });
await ok('fiila_reel_add', { p_key: KEY, p: { poster: png, caption: 'Soin visage' } });
const SITE = URL0 + '#/b/' + V.slug;

const C = await newPhone();
let RDV;
await t('page du salon : cartes (photo, prix, durée, « Réserver »), une rangée de rubriques, réalisations en bulles, horaires dans une feuille', async () => {
  await C.goto(SITE);
  await C.locator('#salon-menu .sl-card').first().waitFor();
  assert.equal(await C.locator('.sl-name').textContent(), 'Salon Démo (test)');
  assert.equal(await C.locator('.vt-rituel').count(), 1);
  const tabs = await C.locator('#salon-tabs .opt').allTextContents();
  assert.equal(tabs[0], 'Tout'); assert.deepEqual(tabs.slice(1).sort(), ['Beauté', 'Coupes']);
  assert.equal(await C.locator('.sl-card').count(), 3);
  assert.match(await C.locator(`[data-svc="${FADE.id}"]`).textContent(), /8 000 FCFA · 1 h.*Réserver/);
  await C.locator('#salon-tabs [data-tab="Beauté"]').click();
  assert.equal(await C.locator('.sl-card').count(), 1);
  await C.locator('#salon-tabs [data-tab=""]').click();
  assert.equal(await C.locator('.sl-bub').count(), 2);
  await C.click('#salon-open');
  assert.equal(await C.locator('#hours-sheet .sl-hr').count(), 7);
  await C.locator('#hours-sheet .vsheet-close').click();
  assert.equal(await C.locator('.brand-bar .logo').count(), 0, 'pas de logo Fii en tête (Premium)');
  assert.equal(await C.locator('.vrail, .vcard').count(), 0, 'pas de catalogue d’articles');
  await shot(C, '01-salon');
});

await t('réalisation : lecteur plein écran, « Réserver » ouvre la réservation', async () => {
  await C.locator('[data-reel="1"]').click();
  await C.locator('#reel-viewer').waitFor();
  assert.equal(await C.locator('.rv-bars span').count(), 2);
  assert.equal(await C.locator('.rv-cap').textContent(), 'Soin visage');
  await C.click('#reel-book');
  await C.locator('#book-sheet').waitFor();
  assert.equal(await C.locator('[data-pick]').count(), 3, 'choix de la prestation');
  await C.click('#book-close');
});

await t('réservation : prestation → jour et heure → coordonnées, caution Wave ; page du rendez-vous avec le numéro à payer', async () => {
  await C.locator(`[data-book="${FADE.id}"]`).click();
  await C.locator('#book-days').waitFor();
  await C.locator('[data-day]').nth(1).click();
  await C.locator('#book-slots .sl-slot').first().waitFor();
  assert.equal(await C.locator('#book-slots .sl-slot').first().textContent(), '08:00');
  await shot(C, '02-creneaux');
  await C.locator('#book-slots .sl-slot[data-time="10:00"]').click();
  await C.fill('#book-name', 'Awa Test');
  await C.fill('#book-phone', '77 000 00 01');
  assert.match(await C.locator('#book-pay').textContent(), /Caution de 2 000 FCFA.*Wave/);
  await shot(C, '03-coordonnees');
  await C.click('#book-send');
  await C.locator('#rdv-card').waitFor();
  assert.equal(await C.locator('#rdv-status').getAttribute('data-status'), 'pending');
  assert.match(await C.locator('#rdv-pay-to').textContent(), /77 111 22 33/);
  assert.match(await C.locator('#rdv-when').textContent(), /· 10:00$/);
  RDV = C.url().split('#/rdv/')[1].split('?')[0];
  await shot(C, '04-rendez-vous');
});

await t('créneau pris : il disparaît pour la cliente suivante', async () => {
  const D = await newPhone();
  await D.goto(SITE + '?s=' + FADE.id);
  await D.locator('#book-days').waitFor();
  await D.locator('[data-day]').nth(1).click();
  await D.locator('#book-slots .sl-slot').first().waitFor();
  assert.equal(await D.locator('#book-slots .sl-slot[data-time="10:00"]').count(), 0);
  assert.equal(await D.locator('#book-slots .sl-slot[data-time="09:30"]').count(), 0, '09:30–10:30 chevauche');
  assert.equal(await D.locator('#book-slots .sl-slot[data-time="11:00"]').count(), 1);
});

const B = await newPhone();
await t('salon : agenda du jour, « Caution reçue » confirme le rendez-vous', async () => {
  await B.goto(URL0);
  await B.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), KEY);
  await B.goto(URL0 + '#/boutique');
  await B.locator('#agenda-days').waitFor();
  assert.equal(await B.locator('#tab-orders').textContent(), 'Agenda');
  assert.equal(await B.locator('#tab-products').textContent(), 'Prestations');
  await B.locator('#agenda-waiting').waitFor();
  await B.locator('[data-day]').nth(1).click();
  await B.locator('.bk-row').first().waitFor();
  assert.match(await B.locator('.bk-row').first().textContent(), /10:00.*Awa Test.*Caution attendue/);
  await shot(B, '05-agenda');
  await B.locator('.bk-row').first().click();
  await B.click('#bk-deposit');
  await B.getByText('Caution reçue : rendez-vous confirmé.').waitFor();
  await B.locator('.bk-row', { hasText: 'Confirmé' }).waitFor();
  const C2 = await newPhone();
  await C2.goto(URL0 + '#/rdv/' + RDV);
  await C2.locator('#rdv-card').waitFor();
  assert.equal(await C2.locator('#rdv-status').getAttribute('data-status'), 'confirmed');
  assert.equal(await C2.locator('#rdv-pay').count(), 0);
});

await t('réglages : horaires par jour (fermé le dimanche), postes ; enregistrés', async () => {
  await B.goto(URL0 + '#/boutique/salon');
  await B.locator('#salon-hours-edit').waitFor();
  await B.locator('.hr-row[data-d="0"] [role="switch"]').click();
  await B.locator('#salon-seats').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await B.locator('#salon-seats [data-v="2"]').dispatchEvent('click');
  await B.click('#salon-save');
  await B.getByText('Réservations enregistrées.').waitFor();
  const row = (await local.db.query(`select hours, seats from fiila.shops where id = $1`, [S.shop.id])).rows[0];
  assert.equal(row.hours['0'], undefined); assert.equal(row.seats, 2);
  assert.equal(await B.locator('#salon-reels-edit .sl-reel:not(.add)').count(), 2);
  await shot(B, '06-reglages', true);
});

await t('prestation : durée en pastilles et caution, ni tailles ni stock', async () => {
  await B.goto(URL0 + '#/boutique/article/' + CUT.id);
  await B.locator('#product-duration').waitFor();
  assert.equal(await B.locator('#product-sizes').count(), 0);
  await B.locator('#product-duration [data-v="45"]').click();
  await B.fill('#product-deposit', '1000');
  await B.click('#product-save');
  await B.waitForURL(/#\/boutique\/articles/);
  const r = (await local.db.query(`select duration_min, deposit from fiila.products where id = $1`, [CUT.id])).rows[0];
  assert.deepEqual({ d: r.duration_min, p: Number(r.deposit) }, { d: 45, p: 1000 });
});

await t('aucune erreur JavaScript', async () => {
  assert.deepEqual(pages.flatMap((p) => p.__errors), []);
});

await browser.close();
local.server.close();
console.log(`\n${failed ? 'ÉCHEC' : 'OK'} — salons et réservations (navigateur, ${ENGINE})`);
process.exit(failed ? 1 : 0);
