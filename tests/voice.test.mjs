// Repère vocal de bout en bout (Chromium, micro simulé) : enregistrement dans la création, écoute par le destinataire
// (audio chargé seulement au toucher), écoute par le livreur, retrait. Données synthétiques.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, devices } = pw;
const SHOTS = 'docs/screenshots/vocal';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
// [SIMULÉ micro] : Chromium fournit un son de test à la place d'un vrai micro.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const phone = devices['iPhone 13'];
const results = [];
let failed = 0;
async function t(name, fn) {
  try { await fn(); results.push({ ok: true, name }); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone() {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', geolocation: { latitude: 14.75814, longitude: -17.47032, accuracy: 9 }, permissions: ['geolocation', 'microphone'] });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.__voiceCalls = 0; page.on('request', (r) => { if (/rpc\/fiila_voice$/.test(r.url())) page.__voiceCalls++; });
  pages.push(page);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/chromium-${name}.png`, fullPage: true });
const A = await newPhone();
let shareUrl, placeId;

await t('création : repère vocal enregistré (micro simulé), réécoutable, envoyé avec la fiche', async () => {
  await A.goto(URL0 + '#/new');
  await A.getByRole('button', { name: 'Utiliser ma position' }).click();
  await A.getByText('Position précise.').first().waitFor();
  await A.locator('#wizard-next').click();
  await A.getByLabel('Oui').check();
  await A.locator('#wizard-next').click();
  await A.locator('#voice-record').click();
  await A.getByText('Parlez maintenant…').waitFor();
  await shot(A, '01-enregistrement');
  await A.waitForTimeout(2600);
  await A.locator('#voice-stop').click();
  await A.locator('#voice-play').waitFor();
  assert.match(await A.locator('#voice-box').textContent(), /0:0[2-3]/);
  await shot(A, '02-enregistre');
  await A.locator('#label').fill('Chez Mame (test)');
  await A.locator('#instruction').fill('Portail vert [TEST]');
  await A.locator('#wizard-next').click();
  await A.getByText('Écouter le repère').waitFor();
  await A.locator('#wizard-next').click();
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
  shareUrl = await A.locator('#share-url').textContent();
  placeId = A.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  await A.locator('#voice-player').waitFor();
  const row = (await local.db.query('select length(voice) n, voice_type, voice_secs from fiila.places where id = $1', [placeId])).rows[0];
  assert.ok(row.n > 500, 'audio enregistré'); assert.match(row.voice_type, /^audio\//); assert.ok(row.voice_secs >= 2 && row.voice_secs <= 4);
});

await t('destinataire : le repère s’affiche, l’audio n’est chargé qu’au toucher « Écouter »', async () => {
  const B = await newPhone();
  await B.goto(shareUrl);
  await B.locator('#voice-player').getByText('Écouter le repère').waitFor();
  await B.waitForTimeout(500);
  assert.equal(B.__voiceCalls, 0, 'audio chargé sans action');
  await shot(B, '03-destinataire');
  await B.locator('#voice-listen').click();
  await B.waitForFunction(() => !/Chargement|Indisponible/.test(document.querySelector('#voice-player').textContent));
  assert.equal(B.__voiceCalls, 1);
  assert.equal(await B.evaluate(() => localStorage.length), 0, 'rien écrit sur le téléphone du destinataire');
});

await t('livreur : écoute avec le lien de sa course', async () => {
  const owner = await A.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned'))[0].owner);
  const d = (await rpc(local.db, 'fiila_start_delivery', { p_kind: 'place', p_id: placeId, p_owner: owner })).body;
  const L = await newPhone();
  await L.goto(URL0 + '#/l/' + d.courier_token);
  await L.locator('#voice-listen').click();
  await L.waitForFunction(() => !/Chargement|Indisponible/.test(document.querySelector('#voice-player').textContent));
  assert.equal(L.__voiceCalls, 1);
});

await t('demande d’adresse : le demandeur écoute le repère de l’adresse reçue', async () => {
  const owner = await A.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned'))[0].owner);
  const R = (await rpc(local.db, 'fiila_create_request', { p: { requester_name: 'Boutique Test', purpose: 'Livraison [TEST]' } })).body;
  await rpc(local.db, 'fiila_fulfill_request', { p_token: R.share_token, p_place_id: placeId, p_place_owner: owner });
  await A.evaluate((r) => { const l = JSON.parse(localStorage.getItem('fiila.owned')); l.push({ type: 'request', id: r.id, owner: r.owner_token, share: r.share_token, label: 'Livraison [TEST]', created: Date.now() }); localStorage.setItem('fiila.owned', JSON.stringify(l)); }, R);
  await A.goto(URL0 + '#/demande/' + R.id);
  const before = A.__voiceCalls;
  await A.locator('#voice-listen').click();
  await A.waitForFunction(() => !/Chargement|Indisponible/.test(document.querySelector('#voice-player').textContent));
  assert.equal(A.__voiceCalls, before, 'accès privé (fiila_voice_private), pas le lien public');
});

await t('« Continuer » pendant l’enregistrement : le vocal est gardé ; lien coupé : le propriétaire l’écoute encore', async () => {
  await A.goto(URL0 + '#/new');
  await A.getByRole('button', { name: 'Utiliser ma position' }).click();
  await A.getByText('Position précise.').first().waitFor();
  await A.locator('#wizard-next').click();
  await A.getByLabel('Oui').check();
  await A.locator('#wizard-next').click();
  await A.locator('#label').fill('Chez Awa (test)');
  await A.locator('#instruction').fill('Porte bleue [TEST]');
  await A.locator('#voice-record').click();
  await A.getByText('Parlez maintenant…').waitFor();
  await A.waitForTimeout(2200);
  await A.locator('#wizard-next').click();
  await A.getByText('Écouter le repère').waitFor();
  await A.locator('#wizard-next').click();
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
  const id = A.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  assert.ok((await local.db.query('select voice is not null v from fiila.places where id = $1', [id])).rows[0].v, 'vocal enregistré');
  await local.db.query(`update fiila.places set status = 'revoked' where id = $1`, [id]);
  await A.goto(URL0 + '#/');
  await A.goto(URL0 + '#/m/' + id);
  await A.getByText('Lien désactivé', { exact: true }).waitFor();
  await A.locator('#voice-listen').click();
  await A.waitForFunction(() => !/Chargement|Indisponible/.test(document.querySelector('#voice-player').textContent));
  await local.db.query('delete from fiila.places where id = $1', [id]);
});

await t('modification : retrait du repère vocal ; il disparaît chez le destinataire', async () => {
  await A.goto(URL0 + '#/edit/' + placeId);
  await A.locator('#wizard-next').click();
  await A.locator('#wizard-next').click();
  await A.locator('#voice-remove').click();
  await A.locator('#voice-record').waitFor();
  await A.locator('#wizard-next').click();
  await A.locator('#wizard-next').click();
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
  const B = await newPhone();
  await B.goto(shareUrl);
  await B.getByRole('link', { name: 'Y aller' }).waitFor();
  assert.equal(await B.locator('#voice-player').count(), 0);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });

await browser.close();
local.server.close();
console.log(`\n${results.length}/${results.length + failed} tests repère vocal réussis — chromium (micro simulé)`);
process.exit(failed ? 1 : 0);
