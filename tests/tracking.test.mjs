// Suivi en direct : livraison (demandeur → livreur → client) et rendez-vous (invités → organisateur seul).
// Chromium (ou ENGINE=webkit), émulation iPhone 13, vrai Postgres local (PGlite) derrière le serveur de dev.
// Simulations : [SIMULÉ GPS] positions fournies par le navigateur de test (setGeolocation).
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
const SHOTS = 'docs/screenshots';
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
const FAR = { latitude: 14.7167, longitude: -17.4677 };   // ~5 km
async function newPhone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', timezoneId: 'Africa/Dakar', serviceWorkers: 'block', colorScheme: opts.dark ? 'dark' : 'light',
    geolocation: opts.geo === false ? undefined : { ...(opts.at || FAR), accuracy: 12 },
    permissions: opts.geo === false ? [] : ['geolocation'],
  });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (opts.fakeGeo) await ctx.addInitScript((start) => {
    // [SIMULÉ GPS] watchPosition piloté par le test (Playwright ne rappelle pas les observateurs en continu).
    const subs = new Map(); let n = 0; let cur = start;
    const pos = () => ({ coords: { latitude: cur.latitude, longitude: cur.longitude, accuracy: 10 }, timestamp: Date.now() });
    navigator.geolocation.watchPosition = (ok) => { n++; subs.set(n, ok); setTimeout(() => ok(pos()), 50); return n; };
    navigator.geolocation.clearWatch = (id) => subs.delete(id);
    window.__setPos = (lat, lng) => { cur = { latitude: lat, longitude: lng }; subs.forEach((f) => f(pos())); };
  }, opts.at || FAR);
  if (opts.owned) await ctx.addInitScript((o) => localStorage.setItem('fiila.owned', JSON.stringify(o)), opts.owned);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('dialog', (d) => d.dismiss());
  return { ctx, page };
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/tracking-${ENGINE}-${name}.png`, fullPage: true });
const waLinkTarget = async (page, id) => {
  const href = await page.locator('#' + id).getAttribute('href');
  return decodeURIComponent(new URL(href).searchParams.get('text')).match(/https?:\/\/\S+/)[0];
};
// La position est envoyée au plus toutes les 20 s : on autorise l'envoi suivant pour le test.
const unthrottle = () => local.db.query(`update fiila.trackers set pos_at = now() - interval '1 minute'`);
const pages = [];

// ------------------------------------------------------------------ données
const client = await ok('fiila_create_place', { p: { kind: 'address', label: 'Maison du client (test)', entry: ENTRY, vehicle_ok: true, instruction: 'Portail bleu' } });
const req = await ok('fiila_create_request', { p: { requester_name: 'Boutique Awa (test)', purpose: 'Commande 12', order_ref: 'C12' } });
await ok('fiila_fulfill_request', { p_token: req.share_token, p_place_id: client.id, p_place_owner: client.owner_token });

let courierUrl, watchUrl;
const merchant = await newPhone({ owned: [{ type: 'request', id: req.id, owner: req.owner_token, kind: 'request', label: 'Commande 12' }] });
pages.push(merchant.page);
const M = merchant.page;

await t('demandeur : « Envoyer au livreur » crée un lien livreur et un lien de suivi pour le client', async () => {
  await M.goto(URL0 + '#/demande/' + req.id);
  await M.getByRole('button', { name: 'Envoyer au livreur' }).click();
  await M.getByRole('heading', { name: 'Livraison' }).waitFor();
  courierUrl = await waLinkTarget(M, 'send-courier');
  watchUrl = await waLinkTarget(M, 'send-watch');
  assert.match(courierUrl, /#\/l\/[A-Za-z0-9_-]{20,}$/);
  assert.match(watchUrl, /#\/s\/[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(courierUrl.split('#')[1].slice(3), watchUrl.split('#')[1].slice(3));
  await M.getByText('Pas encore parti').waitFor();
  const own = await M.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned')));
  assert.ok(own[0].delivery && own[0].delivery.watch, 'liens non gardés sur le téléphone du demandeur');
  await shot(M, '01-demandeur');
});

const courier = await newPhone({ fakeGeo: true });
pages.push(courier.page);
const C = courier.page;
await t('livreur : voit la fiche (photo, repère, Google Maps, Waze) et démarre la livraison', async () => {
  await C.goto(courierUrl);
  await C.getByRole('heading', { name: 'Maison du client (test)' }).waitFor();
  await C.getByText('Portail bleu').waitFor();
  await C.getByRole('link', { name: 'Y aller' }).waitFor();
  await C.locator('#other-app').click();
  assert.ok(await C.getByRole('link', { name: 'Ouvrir dans Waze' }).count() >= 1, 'Waze absent');
  const waze = await C.getByRole('link', { name: 'Ouvrir dans Waze' }).first().getAttribute('href');
  assert.equal(waze, 'https://waze.com/ul?ll=14.758140,-17.470320&navigate=yes');
  await C.getByRole('button', { name: 'Démarrer la livraison' }).click();
  await C.getByText('Position partagée').waitFor();
  await C.getByText('Gardez cette page ouverte pendant le trajet.').waitFor();
  const row = (await local.db.query(`select status, lat from fiila.trackers where kind = 'courier'`)).rows[0];
  assert.equal(row.status, 'live'); assert.ok(Math.abs(row.lat - FAR.latitude) < 1e-6);
  await shot(C, '02-livreur');
});

const watcher = await newPhone();
pages.push(watcher.page);
const W = watcher.page;
await t('client : le lien de suivi montre le livreur en route et une heure d’arrivée estimée', async () => {
  await W.goto(watchUrl);
  await W.getByRole('heading', { name: 'Votre livraison' }).waitFor();
  await W.getByText(/En route · environ \d+ min/).waitFor();
  await W.waitForFunction(() => document.querySelectorAll('.live-map .leaflet-overlay-pane path').length >= 2); // destination + livreur
  assert.equal(await W.getByText(/14\.7/).count(), 0, 'coordonnées affichées');
  await shot(W, '03-client-suivi');
});

await t('demandeur : le suivi intégré se met à jour sans recharger', async () => {
  await M.getByText(/En route · environ \d+ min/).waitFor({ timeout: 20000 });
});

await t('livreur près de l’entrée : arrivée détectée, position effacée, suivi « arrivé »', async () => {
  await unthrottle();
  await C.evaluate(([a, b]) => window.__setPos(a, b), [ENTRY.lat + 0.0002, ENTRY.lng]);
  await C.getByText('Arrivée confirmée').waitFor({ timeout: 20000 });
  const row = (await local.db.query(`select status, lat, jsonb_array_length(trail) n from fiila.trackers where kind = 'courier'`)).rows[0];
  assert.deepEqual(row, { status: 'arrived', lat: null, n: 0 });
  await W.reload();
  await W.getByText('Livreur arrivé').waitFor();
});

await t('propriétaire d’une adresse : « Faire venir un livreur » sur sa propre fiche', async () => {
  const p = await newPhone({ owned: [{ type: 'place', id: client.id, owner: client.owner_token, share: client.share_token, kind: 'address', label: 'Maison du client (test)' }] });
  pages.push(p.page);
  await p.page.goto(URL0 + '#/m/' + client.id);
  await p.page.locator('#more summary').click();
  await p.page.getByRole('button', { name: 'Faire venir un livreur' }).click();
  await p.page.getByRole('heading', { name: 'Livraison' }).waitFor();
  assert.equal(await p.page.locator('#send-watch').count(), 0, 'pas de lien client pour soi-même');
  await p.page.getByText('Pas encore parti').waitFor();
  await p.ctx.close();
});

await t('livreur : position refusée → message clair, rien n’est envoyé', async () => {
  const d = await ok('fiila_start_delivery', { p_kind: 'place', p_id: client.id, p_owner: client.owner_token });
  const p = await newPhone({ geo: false });
  pages.push(p.page);
  await p.page.goto(URL0 + '#/l/' + d.courier_token);
  await p.page.getByRole('button', { name: 'Démarrer la livraison' }).click();
  await p.page.getByText(/Position refusée/).waitFor();
  const row = (await local.db.query(`select status from fiila.trackers where watch_token = $1`, [d.watch_token])).rows[0];
  assert.equal(row.status, 'waiting');
  await p.ctx.close();
});

// ------------------------------------------------------------------ rendez-vous
const now = Date.now();
const meet = await ok('fiila_create_place', { p: { kind: 'meeting', label: 'Réunion du samedi (test)', entry: ENTRY, instruction: 'Salle du fond',
  starts_at: new Date(now + 3600e3).toISOString(), expires_at: new Date(now + 6 * 3600e3).toISOString() } });

await t('invité : « Je viens » puis « Je pars maintenant » ; l’organisateur seul le voit', async () => {
  const g = await newPhone();
  pages.push(g.page);
  await g.page.goto(URL0 + '#/a/' + meet.share_token);
  await g.page.getByRole('heading', { name: 'Prévenir l’organisateur' }).waitFor();
  await g.page.locator('#guest-name').fill('Assane Niang');
  await g.page.getByRole('button', { name: 'Je viens' }).click();
  await g.page.getByRole('button', { name: 'Je pars maintenant' }).click();
  await g.page.getByText('Position partagée').waitFor();
  await shot(g.page, '04-invite');
  // deuxième invité : accepte mais n'est pas encore parti
  const g2 = await newPhone();
  pages.push(g2.page);
  await g2.page.goto(URL0 + '#/a/' + meet.share_token);
  await g2.page.locator('#guest-name').fill('Fatou');
  await g2.page.getByRole('button', { name: 'Je viens' }).click();
  await g2.page.getByRole('button', { name: 'Je pars maintenant' }).waitFor();
  // un autre invité ne voit rien des autres
  assert.equal(await g2.page.getByText('Assane Niang').count(), 0);
  await g2.page.reload();
  await g2.page.getByRole('button', { name: 'Je pars maintenant' }).waitFor(); // l'invité est retrouvé sur son téléphone
  await g.ctx.close(); await g2.ctx.close();
});

await t('organisateur : « Qui arrive » avec heure d’arrivée et invités pas encore partis', async () => {
  const o = await newPhone({ owned: [{ type: 'place', id: meet.id, owner: meet.owner_token, share: meet.share_token, kind: 'meeting', label: 'Réunion du samedi (test)' }] });
  pages.push(o.page);
  await o.page.goto(URL0 + '#/m/' + meet.id);
  await o.page.getByRole('heading', { name: 'Qui arrive' }).waitFor();
  await o.page.getByText(/Assane Niang en route · environ \d+ min/).waitFor();
  await o.page.getByText('Fatou n’est pas encore parti').waitFor();
  await shot(o.page, '05-organisateur');
  await o.ctx.close();
});

await t('fiche publique du rendez-vous : aucun nom d’invité, aucune position', async () => {
  const pub = await rpc(local.db, 'fiila_get_public', { p_token: meet.share_token });
  assert.ok(!JSON.stringify(pub.body).match(/Assane|Fatou/));
});

await t('mode sombre : pages de suivi lisibles', async () => {
  const d = await newPhone({ dark: true });
  pages.push(d.page);
  await d.page.goto(watchUrl);
  await d.page.getByText('Livreur arrivé').waitFor();
  await shot(d.page, '06-suivi-sombre');
  await d.ctx.close();
});

await t('aucune erreur JavaScript', async () => {
  assert.deepEqual(pages.flatMap((p) => p.__errors || []), []);
});

await ok('fiila_delete_place', { p_id: client.id, p_owner: client.owner_token });
await ok('fiila_delete_place', { p_id: meet.id, p_owner: meet.owner_token });
await ok('fiila_delete_request', { p_id: req.id, p_owner: req.owner_token });
await browser.close();
local.server.close();
const report = { moteur: ENGINE, version, date: new Date().toISOString(), reussis: results.filter((r) => r.ok).length, total: results.length, results };
writeFileSync(`docs/tracking-test-report-${ENGINE}.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.reussis}/${report.total} tests suivi réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
