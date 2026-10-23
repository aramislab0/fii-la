// Aide de complétude d'une adresse (algorithmes v2.1, A1 réduit, validé le 23/10/2026) : sur la page de gestion de
// l'adresse seulement, une suggestion pour le premier manque (photo de l'entrée, puis repère écrit OU vocal). Jamais de
// note, de certification ni de conseil sur la précision ; rien sur un lien reçu. « Utilisé » = champ enregistré sur
// l'adresse où la suggestion a été vue. Budget commun du moteur de rétention ; interrupteur par suggestion. Données synthétiques.
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
const SHOTS = 'docs/screenshots/adresse-completude';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url.replace(/\/?$/, '/');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); if (r.status !== 200) throw new Error(fn + ' ' + JSON.stringify(r.body)); return r.body; };
const metric = async (v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = 'retention' and variant = $1`, [v])).rows[0].n);
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
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC';
// Adresse synthétique : champs précisés pour chaque cas.
async function place(label, { instruction = '', photo = false, voice = false } = {}) {
  const r = await ok('fiila_create_place', { p: { kind: 'address', label, locality: 'Yoff', instruction: instruction || 'provisoire', entry: { lat: 14.75, lng: -17.47 }, vehicle_ok: true } });
  if (!instruction) await local.db.query(`update fiila.places set instruction = null where id = $1`, [r.id]);
  if (photo) await local.db.query(`update fiila.places set photo = decode($2, 'base64'), photo_type = 'image/png' where id = $1`, [r.id, png]);
  if (voice) await local.db.query(`update fiila.places set voice = decode($2, 'base64'), voice_secs = 3 where id = $1`, [r.id, 'AAAA']);
  return r;
}
const own = (...ps) => `localStorage.setItem('fiila.owned', JSON.stringify(${JSON.stringify(ps.map((p) => ({ type: 'place', kind: 'address', id: p.id, owner: p.owner_token, share: p.share_token, label: 'x' })))}));`;
async function until(fn, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; }
const nudges = (P) => P.locator('.nudge2');
async function manage(P, p) { await P.goto(URL0 + '#/m/' + p.id); await P.locator('#edit-link').waitFor(); await P.waitForTimeout(500); }

await t('repère écrit sans photo (propriétaire) → « Une photo de l’entrée » seulement ; aucune note ni « vérifiée »', async () => {
  const p = await place('Chez Coumba [TEST]', { instruction: 'portail vert' });
  const P = await newPhone(own(p));
  await manage(P, p);
  await P.locator('#nudge-addr_photo').getByText('Une photo de l’entrée').waitFor();
  assert.equal(await nudges(P).count(), 1);
  const txt = await P.locator('main, #app').first().textContent();
  assert.doesNotMatch(txt, /vérifiée|Adresse sûre|fiabilité|précision du point/i);
  assert.equal(await P.locator('#nudge-addr_photo-go').getAttribute('href'), '#/edit/' + p.id);
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-01-suggestion-photo.png`, fullPage: true });
  await P.locator('#nudge-addr_photo').scrollIntoViewIfNeeded();   // l'exposition compte quand la carte est vue
  assert.ok(await until(async () => await metric('addr_photo:shown') >= 1), 'exposition comptée');
});

await t('photo sans repère → « Un repère pour trouver la porte » ; photo + vocal sans texte → rien ; photo + texte court → rien', async () => {
  const a = await place('Photo seule [TEST]', { photo: true });
  const P = await newPhone(own(a));
  await manage(P, a);
  await P.locator('#nudge-addr_mark').waitFor();
  const b = await place('Photo et vocal [TEST]', { photo: true, voice: true });
  const Q = await newPhone(own(b));
  await manage(Q, b);
  assert.equal(await nudges(Q).count(), 0, 'le vocal compte comme repère');
  const c = await place('Photo et texte court [TEST]', { photo: true, instruction: '2e' });
  const R = await newPhone(own(c));
  await manage(R, c);
  assert.equal(await nudges(R).count(), 0, 'aucune longueur minimale');
});

await t('lien reçu (#/a/…) ou visiteur : aucune suggestion, rien écrit sur le téléphone', async () => {
  const p = await place('Adresse d’une cliente [TEST]');
  await local.db.query(`update fiila.places set photo = null where id = $1`, [p.id]);
  const P = await newPhone();
  await P.goto(URL0 + '#/a/' + p.share_token); await P.waitForTimeout(1500);
  assert.equal(await nudges(P).count(), 0);
  assert.equal(await P.evaluate(() => localStorage.getItem('fiila.ret')), null);
});

await t('« utilisé » seulement si la photo est enregistrée sur l’adresse où la suggestion a été vue', async () => {
  const p = await place('Adresse A [TEST]', { instruction: 'à côté de la boulangerie' });
  const q = await place('Adresse B [TEST]', { instruction: 'immeuble bleu' });
  const P = await newPhone(own(p, q));
  const used0 = await metric('addr_photo:used');
  await manage(P, p);
  await P.locator('#nudge-addr_photo').waitFor();
  await P.click('#nudge-addr_photo-go');                      // un clic n'est pas un usage
  await P.waitForFunction(() => location.hash.startsWith('#/edit/'));
  assert.equal(await metric('addr_photo:used'), used0);
  // [SIMULÉ] la photo est ajoutée à l'AUTRE adresse : ne compte pas.
  await local.db.query(`update fiila.places set photo = decode($2, 'base64'), photo_type = 'image/png' where id = $1`, [q.id, png]);
  await manage(P, q);
  assert.equal(await metric('addr_photo:used'), used0);
  // [SIMULÉ] la photo est enregistrée sur l'adresse A (comme après « Modifier ») : utilisé.
  await local.db.query(`update fiila.places set photo = decode($2, 'base64'), photo_type = 'image/png' where id = $1`, [p.id, png]);
  await manage(P, p);
  assert.ok(await until(async () => await metric('addr_photo:used') === used0 + 1), 'utilisé');
  assert.ok(await P.evaluate((id) => JSON.parse(localStorage.getItem('fiila.ret')).s.addr_photo.pid === id, p.id));
  assert.equal((await local.db.query(`select count(*)::int n from fiila.metrics where variant like '%' || $1 || '%'`, [p.id])).rows[0].n, 0, 'aucun identifiant d’adresse au serveur');
});

await t('budget commun et refus : « Plus tard » → rien pendant 7 jours ; interrupteur sugg_addr_photo = 0 → plus rien', async () => {
  const p = await place('Adresse Refus [TEST]', { instruction: 'face à la mosquée' });
  const P = await newPhone(own(p));
  await manage(P, p);
  await P.click('#nudge-addr_photo-later');
  assert.ok(await until(async () => await metric('addr_photo:dismiss') >= 1));
  await P.evaluate(() => sessionStorage.clear());
  await manage(P, p);
  assert.equal(await P.locator('#nudge-addr_photo').count(), 0, 'pause de 7 jours');
  await local.db.query(`insert into fiila.settings (key, value) values ('sugg_addr_photo', '0') on conflict (key) do update set value = '0'`);
  const Q = await newPhone(own(p));
  await manage(Q, p);
  await Q.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await Q.reload(); await Q.locator('#edit-link').waitFor(); await Q.waitForTimeout(500);
  assert.equal(await Q.locator('#nudge-addr_photo').count(), 0);
  await local.db.query(`update fiila.settings set value = '1' where key = 'sugg_addr_photo'`);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests aide de complétude d’adresse (${ENGINE}) réussis`);
process.exit(failed ? 1 : 0);
