// Circuit complet : recevoir → trouver l'entrée → comprendre → créer → enregistrer → partager → revenir → réutiliser.
// Chromium (ou ENGINE=webkit), émulation iPhone 13, vrai Postgres local (PGlite) derrière le serveur de dev.
// Simulations explicites (signalées dans les noms de tests) :
//   [SIMULÉ partage natif] navigator.share remplacé par un enregistreur (Chromium Linux n'a pas Web Share) ;
//   [SIMULÉ temps] expiration forcée en base pour éviter d'attendre ;
//   [SIMULÉ réseau] panne ou lenteur de l'API par interception des requêtes.
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
const CREATED = [];
const shareMock = () => { window.__shared = []; navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); }; };
async function newPhone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', timezoneId: 'Africa/Dakar', colorScheme: opts.dark ? 'dark' : 'light', serviceWorkers: 'block',
    permissions: ENGINE === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [],
  });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (opts.share) await ctx.addInitScript(shareMock);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.__errors = []; page.__tracks = []; page.__creates = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('dialog', (d) => d.dismiss());
  page.on('request', (r) => {
    if (r.url().endsWith('/rpc/fiila_track')) page.__tracks.push(JSON.parse(r.postData()));
    if (r.url().endsWith('/rpc/fiila_create_place')) page.__creates.push(r.postData());
  });
  page.on('response', async (res) => {
    if (!/rpc\/fiila_create_(place|request)$/.test(res.url()) || res.status() !== 200) return;
    try { const b = await res.json(); CREATED.push({ fn: res.url().includes('request') ? 'fiila_delete_request' : 'fiila_delete_place', id: b.id, owner: b.owner_token }); } catch {}
  });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/circuit-${ENGINE}-${name}.png`, fullPage: true });
const waitTrack = (page, ev, v) => {
  const p = page.waitForRequest((r) => r.url().endsWith('/rpc/fiila_track') && r.postData().includes(`"${ev}"`) && r.postData().includes(`"${v}"`), { timeout: 8000 });
  p.catch(() => {});
  return p;
};
async function pastePoint(page, coords, idx = 0) {
  await page.getByRole('button', { name: 'Depuis Google Maps' }).nth(idx).click();
  await page.locator('input[placeholder^="Collez"]').nth(idx).fill(`${coords.lat}, ${coords.lng}`);
  await page.getByRole('button', { name: 'Placer ce point' }).first().click(); // seul le panneau ouvert est visible
  await page.locator('button:not([disabled])', { hasText: /^Valider ce point$/ }).first().click(); // le seul sélecteur actif est celui qu'on vient de placer
}
const row = async (id) => (await local.db.query(`select id, kind, share_token, encode(owner_hash,'hex') oh, status, label, locality, instruction, entry_lat, entry_lng,
  vehicle_ok, stop_lat, stop_lng, walk, md5(photo) photo_md5, starts_at, expires_at, updated_at from fiila.places where id = $1`, [id])).rows[0];
const ownedOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned') || '[]'));
function dirParams(href) { const u = new URL(href); return { api: u.searchParams.get('api'), destination: u.searchParams.get('destination'), mode: u.searchParams.get('travelmode'), path: u.origin + u.pathname }; }

// ================================================================== A. propriétaire : rendez-vous avec arrêt voiture
const owner = await newPhone({ share: true });
const O = owner.page;
let meetId, meetShare;
await t('enregistrement lent [SIMULÉ réseau] : l’état « partager » n’apparaît qu’après la réponse du serveur', async () => {
  await O.goto(URL0 + '#/rdv/nouveau');
  await O.locator('#m-label').fill('Réunion de quartier (test)');
  const d = new Date(Date.now() + 2 * 86400e3);
  await O.locator('#m-date').fill(d.toISOString().slice(0, 10));
  await O.locator('#m-time').fill('18:30');
  await pastePoint(O, { lat: 14.746100, lng: -17.492500 }, 0);
  await O.locator('#m-instr').fill('Salle au fond de la cour, porte bleue');
  await O.locator('#m-photo').setInputFiles('tests/fixtures/door-with-exif.jpg');
  await O.locator('img.photo-prev').waitFor();
  await O.locator('#m-hasstop').check();
  await pastePoint(O, { lat: 14.746500, lng: -17.493000 }, 1);
  await O.locator('#m-walk').fill('Traverser la place, 60 m');
  let release;
  await O.route('**/rpc/fiila_create_place', async (r) => { await new Promise((res) => { release = res; }); await r.continue(); });
  await O.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await O.getByRole('button', { name: 'Enregistrement…' }).waitFor();
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(await O.getByRole('heading', { name: 'Partager' }).count(), 0, 'partage affiché avant enregistrement');
  assert.equal(await O.locator('#saved-ok').count(), 0);
  release();
  await O.locator('#saved-ok').waitFor();
  await O.getByRole('heading', { name: 'Partager' }).waitFor();
  await O.unroute('**/rpc/fiila_create_place');
  meetId = O.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  meetShare = (await O.locator('#share-url').textContent()).split('#/a/')[1];
  assert.equal(await O.evaluate(() => localStorage.getItem('fiila.draft.meeting')), null, 'brouillon non effacé après succès');
  await shot(O, '01-enregistre-partager');
});

await t('après enregistrement : partager est l’action principale, gestion accessible en second', async () => {
  const order = await O.evaluate(() => {
    const ids = ['share-url', 'similar', 'revoke', 'delete'];
    const pos = ids.map((id) => document.getElementById(id)).map((el) => (el ? el.getBoundingClientRect().top + scrollY : null));
    return pos;
  });
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] <= order[3], 'ordre inattendu ' + order);
  await O.getByRole('link', { name: 'Modifier' }).waitFor();
});

await t('partage natif [SIMULÉ partage natif] : seule l’URL destinataire est transmise', async () => {
  const ev = waitTrack(O, 'share_initiated', 'native_meeting');
  await O.getByRole('button', { name: 'Partager…' }).click();
  await ev;
  const shared = await O.evaluate(() => window.__shared);
  const own = (await ownedOf(O)).find((x) => x.id === meetId);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].url, URL0 + '#/a/' + meetShare);
  const all = JSON.stringify(shared);
  assert.ok(!all.includes(own.owner) && !all.includes(meetId), 'clé ou identifiant interne partagé');
  assert.ok(!/14\.746|17\.49/.test(all), 'coordonnées brutes partagées');
});

// ================================================================== B. destinataire : navigation, coordonnées repliées
const visitor = await newPhone();
const V = visitor.page;
await t('destinataire anonyme : itinéraire voiture vers l’arrêt, à pied vers le lieu (iPhone : appli Google Maps directe + Plans)', async () => {
  await V.goto(URL0 + '#/a/' + meetShare);
  await V.getByRole('heading', { name: 'Réunion de quartier (test)' }).waitFor();
  const links = await V.getByRole('link', { name: /Itinéraire/ }).evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
  assert.equal(links.length, 2);
  // iPhone : schéma officiel comgooglemaps:// (ouvre l'application avec la destination, sans détour par l'App Store)
  const car = new URL(links[0][1]), walk = new URL(links[1][1]);
  assert.equal(car.protocol, 'comgooglemaps:');
  assert.deepEqual([car.searchParams.get('daddr'), car.searchParams.get('directionsmode')], ['14.746500,-17.493000', 'driving']);
  assert.deepEqual([walk.searchParams.get('daddr'), walk.searchParams.get('directionsmode')], ['14.746100,-17.492500', 'walking']);
  const plans = await V.getByRole('link', { name: 'Ouvrir dans Plans' }).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert.deepEqual(plans, ['https://maps.apple.com/?daddr=14.746500,-17.493000&dirflg=d', 'https://maps.apple.com/?daddr=14.746100,-17.492500&dirflg=w']);
  assert.equal(await V.evaluate(() => localStorage.length), 0);
});

await t('destinataire : aucune coordonnée affichée, tout passe par l’itinéraire', async () => {
  assert.equal(await V.locator('.coords, .coords-more').count(), 0);
  assert.equal(await V.getByText(/14\.74/).count(), 0);
  await shot(V, '02-destinataire-sans-coordonnees');
});

await t('le propriétaire qui ouvre son propre lien retrouve sa gestion, pas l’invitation à créer', async () => {
  await O.goto(URL0 + '#/a/' + meetShare);
  await O.locator('#owner-block').waitFor();
  assert.equal(await O.locator('#discover').count(), 0);
  await O.locator('#owner-manage').click();
  await O.getByRole('heading', { name: 'Partager' }).waitFor();
  assert.match(O.url(), new RegExp('#/m/' + meetId));
});

// ================================================================== C. réouvrir et repartager (nouvelle visite)
await t('réouverture depuis « Mes rendez-vous » après rechargement, puis repartage', async () => {
  await O.goto(URL0);
  await O.reload();
  const reopen = waitTrack(O, 'owned_reopened', 'meeting');
  await O.getByRole('link', { name: /Réunion de quartier \(test\)/ }).click();
  await reopen;
  await O.getByRole('heading', { name: 'Partager' }).waitFor();
  assert.equal(await O.locator('#saved-ok').count(), 0, 'confirmation affichée hors création');
  const wa = await O.getByRole('link', { name: 'Préparer un message WhatsApp' }).getAttribute('href');
  assert.ok(decodeURIComponent(wa).includes(URL0 + '#/a/' + meetShare));
  if (ENGINE === 'chromium') {
    const cp = waitTrack(O, 'link_copied', 'meeting');
    await O.locator('#copy-link').click();
    await cp;
    assert.equal(await O.evaluate(() => navigator.clipboard.readText()), URL0 + '#/a/' + meetShare);
  }
});

// ================================================================== D. rendez-vous similaire
let before, simId;
await t('« Créer un rendez-vous similaire » : brouillon neuf, lieu à reconfirmer, nom et date vides', async () => {
  before = await row(meetId);
  await O.goto(URL0 + '#/m/' + meetId);
  await O.locator('#similar').click();
  await O.getByRole('heading', { name: 'Rendez-vous similaire' }).waitFor();
  await O.locator('#similar-notice').waitFor();
  assert.equal(await O.locator('#m-label').inputValue(), '', 'nom repris');
  assert.equal(await O.locator('#m-date').inputValue(), '', 'date reprise');
  assert.equal(await O.locator('#m-time').inputValue(), '', 'heure reprise');
  assert.equal(await O.locator('#m-instr').inputValue(), 'Salle au fond de la cour, porte bleue');
  assert.equal(await O.locator('#m-walk').inputValue(), 'Traverser la place, 60 m');
  assert.ok(await O.locator('#m-hasstop').isChecked());
  assert.equal(await O.locator('img.photo-prev').count(), 1, 'photo non reprise');
  assert.equal(await O.getByText('Point validé pour le lieu du rendez-vous').count(), 0, 'lieu validé sans confirmation');
  await O.getByText('Point repris du rendez-vous précédent : vérifiez-le, puis validez.').first().waitFor();
  assert.ok(await O.getByRole('button', { name: 'Créer le rendez-vous' }).isDisabled(), 'création possible sans nouvelle date');
  await shot(O, '03-rendez-vous-similaire');
});

await t('brouillon du rendez-vous similaire conservé si on quitte la page', async () => {
  await O.locator('#m-label').fill('Réunion de quartier — novembre (test)');
  await O.getByRole('link', { name: '← Retour au rendez-vous d’origine' }).click();
  await O.getByRole('heading', { name: 'Partager' }).waitFor();
  await O.locator('#similar').click();
  await O.getByText('Brouillon repris là où vous l’aviez laissé.').waitFor();
  assert.equal(await O.locator('#m-label').inputValue(), 'Réunion de quartier — novembre (test)');
});

await t('enregistrement : fiche distincte, rendez-vous d’origine inchangé', async () => {
  const d = new Date(Date.now() + 30 * 86400e3);
  await O.locator('#m-date').fill(d.toISOString().slice(0, 10));
  await O.locator('#m-time').fill('17:00');
  assert.ok(await O.getByRole('button', { name: 'Créer le rendez-vous' }).isDisabled(), 'lieu repris accepté sans confirmation');
  await O.getByRole('button', { name: 'Valider ce point' }).nth(0).click();
  await O.getByRole('button', { name: 'Valider ce point' }).nth(0).click();
  const created = waitTrack(O, 'fiche_created', 'meeting_similar');
  await O.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await O.locator('#saved-ok').waitFor();
  await created;
  simId = O.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  assert.notEqual(simId, meetId);
  const after = await row(meetId), sim = await row(simId);
  assert.deepEqual(after, before, 'le rendez-vous d’origine a été modifié');
  assert.notEqual(sim.share_token, before.share_token);
  assert.notEqual(sim.oh, before.oh, 'même clé de gestion');
  assert.equal(sim.label, 'Réunion de quartier — novembre (test)');
  assert.deepEqual([sim.entry_lat, sim.entry_lng, sim.stop_lat, sim.stop_lng], [before.entry_lat, before.entry_lng, before.stop_lat, before.stop_lng]);
  assert.equal(sim.instruction, before.instruction);
  assert.equal(sim.photo_md5, before.photo_md5);
  assert.notEqual(String(sim.starts_at), String(before.starts_at));
  assert.equal(sim.status, 'active');
  assert.equal(await O.evaluate((k) => localStorage.getItem(k), 'fiila.draft.meeting.similaire.' + meetId), null, 'brouillon non effacé');
});

await t('similaire depuis un rendez-vous désactivé et expiré [SIMULÉ temps] : la copie est active, l’origine reste désactivée', async () => {
  await local.db.query(`update fiila.places set status = 'revoked', starts_at = now() - interval '3 days', expires_at = now() - interval '2 days' where id = $1`, [meetId]);
  const src = await row(meetId);
  await O.goto(URL0 + '#/m/' + meetId);
  await O.getByText('Ce rendez-vous a expiré : le lien n’affiche plus le lieu.').waitFor();
  assert.equal(await O.locator('#similar').evaluate((a) => a.className), 'btn', 'action non mise en avant sur un rendez-vous expiré');
  await O.locator('#similar').click();
  await O.locator('#m-label').fill('Réunion relancée (test)');
  await O.locator('#m-date').fill(new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10));
  await O.locator('#m-time').fill('10:00');
  await O.getByRole('button', { name: 'Valider ce point' }).nth(0).click();
  await O.getByRole('button', { name: 'Valider ce point' }).nth(0).click();
  await O.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await O.locator('#saved-ok').waitFor();
  const id2 = O.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  const copy = await row(id2);
  assert.equal(copy.status, 'active');
  assert.ok(new Date(copy.expires_at) > new Date(), 'copie expirée');
  assert.deepEqual(await row(meetId), src, 'origine modifiée');
  const pub = await rpc(local.db, 'fiila_get_public', { p_token: copy.share_token });
  assert.equal(pub.body.state, 'ok');
});

await t('liens terminés : désactivé et expiré, avec la bonne suite', async () => {
  await V.goto(URL0 + '#/a/' + meetShare);
  await V.reload();
  await V.getByText('Ce lien a été désactivé').waitFor();
  await local.db.query(`update fiila.places set status = 'active' where id = $1`, [meetId]);
  await V.reload();
  await V.getByText('Ce rendez-vous est terminé').waitFor();
  await V.getByRole('link', { name: 'Créer mon rendez-vous' }).click();
  await V.getByRole('heading', { name: 'Créer un rendez-vous' }).waitFor();
});

// ================================================================== E. brouillon de rendez-vous après échec d'enregistrement
await t('échec d’enregistrement [SIMULÉ réseau] puis rechargement : le brouillon de rendez-vous est retrouvé', async () => {
  const p = await newPhone();
  await p.page.goto(URL0 + '#/rdv/nouveau');
  await p.page.locator('#m-label').fill('Mariage (test brouillon)');
  await p.page.locator('#m-instr').fill('Entrée par le portail blanc');
  await pastePoint(p.page, { lat: 14.70, lng: -17.45 });
  await p.ctx.route('**/rpc/fiila_create_place', (r) => r.abort('failed'));
  await p.page.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await p.page.getByText(/Connexion impossible/).waitFor();
  assert.equal(await p.page.getByRole('heading', { name: 'Partager' }).count(), 0);
  await p.page.reload();
  await p.page.getByText('Brouillon repris là où vous l’aviez laissé.').waitFor();
  assert.equal(await p.page.locator('#m-label').inputValue(), 'Mariage (test brouillon)');
  assert.equal(await p.page.locator('#m-instr').inputValue(), 'Entrée par le portail blanc');
  await p.page.getByText('Point validé pour le lieu du rendez-vous').waitFor();
  await p.ctx.unroute('**/rpc/fiila_create_place');
  await p.page.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await p.page.locator('#saved-ok').waitFor();
  await p.page.goto(URL0 + '#/rdv/nouveau');
  assert.equal(await p.page.locator('#m-label').inputValue(), '', 'ancien brouillon resté après succès');
  await p.ctx.close();
});

await t('position refusée pendant la création d’un rendez-vous : message et alternative manuelle', async () => {
  const p = await newPhone();
  await p.page.goto(URL0 + '#/rdv/nouveau');
  await p.page.getByRole('button', { name: 'Utiliser ma position' }).first().click();
  await p.page.getByText(/Accès à la position refusé|Position indisponible/).waitFor();
  await pastePoint(p.page, { lat: 14.71, lng: -17.46 });
  await p.page.getByText('Point validé pour le lieu du rendez-vous').waitFor();
  await p.ctx.close();
});

// ================================================================== F. demande d'adresse : partage et relance
await t('demande : partage natif [SIMULÉ partage natif] et lien seul ; demande expirée [SIMULÉ temps] relancée sans la référence', async () => {
  await O.goto(URL0 + '#/demande/nouvelle');
  await O.getByLabel('Votre nom ou celui de votre commerce').fill('Boutique Ndèye (test)');
  await O.getByLabel('Pourquoi demandez-vous l’adresse ?').fill('Livraison de votre commande');
  await O.getByLabel(/Référence de commande/).fill('CMD-77');
  const rc = waitTrack(O, 'request_created', 'request');
  await O.getByRole('button', { name: 'Créer la demande' }).click();
  await rc;
  await O.locator('#request-url').waitFor();
  const url = await O.locator('#request-url').textContent();
  const nat = waitTrack(O, 'share_initiated', 'native_request');
  await O.locator('#share-request').click();
  await nat;
  const shared = await O.evaluate(() => window.__shared.at(-1));
  assert.equal(shared.url, url);
  const reqId = O.url().split('#/demande/')[1];
  await local.db.query(`update fiila.requests set expires_at = now() - interval '1 minute' where id = $1`, [reqId]);
  await O.reload();
  await O.locator('#request-again').click();
  assert.equal(await O.getByLabel('Votre nom ou celui de votre commerce').inputValue(), 'Boutique Ndèye (test)');
  assert.equal(await O.getByLabel('Pourquoi demandez-vous l’adresse ?').inputValue(), 'Livraison de votre commande');
  assert.equal(await O.getByLabel(/Référence de commande/).inputValue(), '', 'référence reprise');
  await O.getByRole('button', { name: 'Créer la demande' }).click();
  await O.getByText('En attente de réponse').waitFor();
  assert.notEqual(O.url().split('#/demande/')[1], reqId);
});

// ================================================================== G. thèmes, clavier, texte long
await t('thème sombre : écrans modifiés lisibles (gestion, similaire, demande expirée)', async () => {
  const p = await newPhone({ dark: true });
  await p.page.goto(URL0);
  const own = await ownedOf(O);
  await p.page.evaluate((o) => localStorage.setItem('fiila.owned', JSON.stringify(o)), own);
  await p.page.goto(URL0 + '#/m/' + simId + '?nouveau=1');
  await p.page.locator('#saved-ok').waitFor();
  const c = await p.page.evaluate(() => [getComputedStyle(document.getElementById('saved-ok')).color, getComputedStyle(document.body).backgroundColor]);
  const lum = (s) => { const [r, g, b] = s.match(/\d+/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (Math.max(lum(c[0]), lum(c[1])) + 0.05) / (Math.min(lum(c[0]), lum(c[1])) + 0.05);
  assert.ok(ratio >= 4.5, 'contraste confirmation ' + ratio.toFixed(2));
  await shot(p.page, '04-enregistre-dark');
  await p.page.goto(URL0 + '#/rdv/nouveau?depuis=' + meetId);
  await p.page.getByRole('heading', { name: 'Rendez-vous similaire' }).waitFor();
  await shot(p.page, '05-similaire-dark');
  await p.ctx.close();
});

await t('clavier : « Créer un rendez-vous similaire » et le repli des coordonnées sont atteignables, focus visible', async () => {
  await O.goto(URL0 + '#/m/' + simId);
  await O.getByRole('heading', { name: 'Partager' }).waitFor();
  const reach = async (page, test) => {
    for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(test)) return true; }
    return false;
  };
  assert.ok(await reach(O, () => document.activeElement && document.activeElement.id === 'similar'), 'bouton similaire non atteint');
  const o = await O.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(o, 'none');
  await V.goto(URL0 + '#/a/' + (await row(simId)).share_token);
  await V.getByRole('heading', { name: /novembre/ }).waitFor();
  assert.ok(await reach(V, () => document.activeElement && /Itinéraire/.test(document.activeElement.textContent || '')), 'bouton Itinéraire non atteint au clavier');
  const o2 = await V.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(o2, 'none');
});

await t('texte long à 320 px : rendez-vous similaire et fiche sans débordement', async () => {
  const p = await newPhone({ viewport: { width: 320, height: 640 } });
  await p.page.goto(URL0);
  const longLabel = 'Rassemblement-' + 'é'.repeat(46);
  const r = await rpc(local.db, 'fiila_create_place', { p: { kind: 'meeting', label: longLabel, instruction: 'Repère-' + 'x'.repeat(270),
    entry: { lat: 14.7, lng: -17.4 }, starts_at: new Date(Date.now() + 3600e3).toISOString(), expires_at: new Date(Date.now() + 7200e3).toISOString() } }, { ip: '192.0.2.77' });
  CREATED.push({ fn: 'fiila_delete_place', id: r.body.id, owner: r.body.owner_token });
  await p.page.evaluate((o) => localStorage.setItem('fiila.owned', JSON.stringify([o])), { type: 'place', kind: 'meeting', id: r.body.id, owner: r.body.owner_token, share: r.body.share_token, label: longLabel });
  for (const h of ['#/rdv/nouveau?depuis=' + r.body.id, '#/a/' + r.body.share_token, '#/m/' + r.body.id]) {
    await p.page.goto(URL0 + h);
    await p.page.waitForTimeout(600);
    const over = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `débordement ${over}px sur ${h}`);
  }
  await shot(p.page, '06-texte-long-320');
  await p.ctx.close();
});

await t('mesure : uniquement événement + variante, sans clé, jeton, identifiant ni coordonnées', async () => {
  const all = [...O.__tracks, ...V.__tracks];
  assert.ok(all.length >= 6);
  const own = await ownedOf(O);
  const secrets = own.flatMap((x) => [x.owner, x.id, x.share]).filter(Boolean);
  for (const b of all) {
    assert.deepEqual(Object.keys(b).sort(), ['p_event', 'p_variant']);
    const s = JSON.stringify(b);
    for (const sec of secrets) assert.ok(!s.includes(sec), 'donnée privée dans la mesure');
    assert.ok(!/\d+\.\d{3,}/.test(s), 'coordonnées dans la mesure');
  }
  const m = await local.db.query(`select event, variant, n::int from fiila.metrics order by 1, 2`);
  writeFileSync(`docs/circuit-metrics-local-${ENGINE}.json`, JSON.stringify(m.rows, null, 2));
  for (const k of ['fiche_created:meeting_similar', 'request_created:request', 'owned_reopened:meeting', 'share_initiated:native_meeting', 'share_initiated:native_request'])
    assert.ok(m.rows.some((r) => r.event + ':' + r.variant === k), 'compteur absent ' + k);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual([...O.__errors, ...V.__errors], []); });

for (const c of CREATED) await rpc(local.db, c.fn, { p_id: c.id, p_owner: c.owner });
await browser.close();
local.server.close();
const report = { moteur: ENGINE, version, mode: 'automatisation Playwright, émulation iPhone 13, base Postgres locale réelle (PGlite)', date: new Date().toISOString(),
  reussis: results.filter((r) => r.ok).length, total: results.length, results };
writeFileSync(`docs/circuit-test-report-${ENGINE}.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.reussis}/${report.total} tests circuit réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
