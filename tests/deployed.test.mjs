// Parcours complet en production (ou en local si FIILA_URL est absent), deux sessions isolées :
// créer une adresse → l'ouvrir en destinataire → bouton découverte → 2e adresse vierge → retour à la fiche
// → partager → désactiver → supprimer. Persistance après rechargement. Compteurs agrégés avant/après.
//
// Variables : FIILA_URL (URL publique), ENGINE (chromium | webkit), DATABASE_URL (lecture des compteurs,
// facultatif ; jamais affichée). Données 100 % synthétiques, supprimées à la fin.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;

const ENGINE = process.env.ENGINE || 'chromium';
const BASE = process.env.FIILA_URL ? process.env.FIILA_URL.replace(/\/?$/, '/') : null;
let local = null;
if (!BASE) { const { startServer } = await import('./dev-server.mjs'); local = await startServer(0); }
const URL0 = BASE || local.url;
const TARGET = BASE ? 'deploye' : 'local';
const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- compteurs agrégés
let pgClient = null;
if (BASE && process.env.DATABASE_URL) {
  const { Client } = require('pg');
  pgClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pgClient.connect();
}
async function metricsToday() {
  const q = `select event, variant, n::int as n from fiila.metrics where day = (now() at time zone 'utc')::date`;
  let rows = null;
  if (local) rows = (await local.db.query(q)).rows;
  else if (pgClient) rows = (await pgClient.query(q)).rows;
  if (!rows) return null;
  return Object.fromEntries(rows.map((r) => [r.event + ':' + r.variant, r.n]));
}

const engine = ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const version = browser.version();
const phone = devices['iPhone 13'];
const results = [];
let failed = 0;
async function t(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ ok: true, name, ms: Date.now() - t0 }); console.log('PASS', name); }
  catch (e) { failed++; results.push({ ok: false, name, err: String(e.message || e).slice(0, 500) }); console.log('FAIL', name, '\n   ', e.message); }
}
const CREATED = [];
async function session(label) {
  const ctx = await browser.newContext({
    viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', timezoneId: 'Africa/Dakar', serviceWorkers: 'block',
    permissions: ENGINE === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [],
  });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(BASE ? 25000 : 12000);
  page.__label = label; page.__errors = []; page.__creates = []; page.__tracks = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('dialog', (d) => d.dismiss());
  page.on('request', (r) => {
    if (r.url().endsWith('/rpc/fiila_create_place')) page.__creates.push(r.postData());
    if (r.url().endsWith('/rpc/fiila_track')) page.__tracks.push(r.postData());
  });
  page.on('response', async (res) => {
    if (!res.url().endsWith('/rpc/fiila_create_place') || res.status() !== 200) return;
    try { const b = await res.json(); CREATED.push({ id: b.id, owner: b.owner_token }); } catch {}
  });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${TARGET}-${ENGINE}-${name}.png`, fullPage: true });
async function pastePoint(page, coords) {
  await page.getByRole('button', { name: 'Depuis Google Maps' }).first().click();
  await page.locator('input[placeholder^="Collez"]').first().fill(`${coords.lat}, ${coords.lng}`);
  await page.getByRole('button', { name: 'Placer ce point' }).first().click();
  await page.getByRole('button', { name: 'Valider ce point' }).first().click();
}
async function rpcFrom(page, fn, args) {
  return page.evaluate(async ([fn, args]) => {
    const c = window.FIILA_CONFIG;
    const headers = { 'Content-Type': 'application/json', apikey: c.supabaseKey };
    if (/^eyJ/.test(c.supabaseKey)) headers.Authorization = 'Bearer ' + c.supabaseKey;
    const r = await fetch(c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [fn, args]);
}

const stamp = Date.now().toString(36);
const A_LABEL = `Atelier test ${stamp}`;
const A_INSTR = `Porte verte test ${stamp}, sonner deux fois`;
const A_POINT = { lat: 14.758140, lng: -17.470320 };
const B_POINT = { lat: 14.690100, lng: -17.446700 };

const before = await metricsToday();
const owner = await session('propriétaire');
const A = owner.page;
const visitor = await session('destinataire');
const B = visitor.page;
let shareUrl, placeId, secondId;

await t('configuration publique : URL HTTPS de l’API et clé publique seulement', async () => {
  await A.goto(URL0);
  const cfg = await A.evaluate(() => window.FIILA_CONFIG);
  assert.ok(cfg && cfg.supabaseUrl && cfg.supabaseKey, 'configuration absente');
  if (BASE) {
    assert.ok(URL0.startsWith('https://'), 'site non HTTPS');
    assert.ok(cfg.supabaseUrl.startsWith('https://'), 'API non HTTPS');
    assert.ok(!/service_role|sb_secret_/.test(JSON.stringify(cfg)), 'clé privilégiée exposée');
    if (/^eyJ/.test(cfg.supabaseKey)) {
      const payload = JSON.parse(Buffer.from(cfg.supabaseKey.split('.')[1], 'base64url').toString());
      assert.equal(payload.role, 'anon', 'la clé du navigateur n’est pas la clé anon');
    }
  }
});

await t('1. propriétaire : créer une adresse avec photo', async () => {
  await A.goto(URL0 + '#/new');
  await pastePoint(A, A_POINT);
  await A.getByRole('button', { name: 'Continuer' }).click();
  await A.getByLabel('Oui').check();
  await A.getByRole('button', { name: 'Continuer' }).click();
  await A.locator('#label').fill(A_LABEL);
  await A.locator('#photo').setInputFiles('tests/fixtures/door-with-exif.jpg');
  await A.locator('img.photo-prev').waitFor();
  await A.locator('#instruction').fill(A_INSTR);
  await A.getByRole('button', { name: 'Continuer' }).click();
  await A.getByRole('button', { name: 'Enregistrer et obtenir mon lien' }).click();
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
  shareUrl = await A.locator('#share-url').textContent();
  placeId = A.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  if (BASE) assert.ok(shareUrl.startsWith(URL0), 'lien de partage hors du site déployé : ' + shareUrl);
  assert.ok(!Buffer.from(JSON.parse(A.__creates.at(-1)).p.photo, 'base64').includes(Buffer.from('Exif')), 'EXIF envoyé');
});

await t('persistance : la fiche et sa photo survivent au rechargement (propriétaire)', async () => {
  await A.reload();
  await A.getByRole('heading', { name: A_LABEL }).waitFor();
  assert.equal(await A.locator('#share-url').textContent(), shareUrl);
  const own = await rpcFrom(A, 'fiila_get_owned', { p_id: placeId, p_owner: (await A.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned'))))[0].owner });
  assert.equal(own.status, 200);
  assert.match(own.body.photo, /^data:image\/jpeg;base64,/);
  await shot(A, '01-gestion');
});

await t('2. destinataire (session isolée) : fiche, photo et repère, sans compte', async () => {
  assert.equal(await B.evaluate(() => 1), 1);
  await B.goto(shareUrl);
  await B.getByRole('heading', { name: A_LABEL }).waitFor();
  await B.getByText(A_INSTR).waitFor();
  assert.ok(await B.locator('img.door').evaluate((i) => i.complete && i.naturalWidth > 100), 'photo non chargée');
  const dir = await B.getByRole('link', { name: /Itinéraire/ }).first().getAttribute('href');
  assert.match(dir, /^comgooglemaps:\/\/\?daddr=14\.758140,-17\.470320&directionsmode=/); // iPhone : application Google Maps directe
  await B.reload();
  await B.getByText(A_INSTR).waitFor();
  assert.ok(await B.locator('img.door').evaluate((i) => i.complete && i.naturalWidth > 100), 'photo non chargée après rechargement');
  await shot(B, '02-destinataire');
});

await t('3. bouton découverte : création vierge d’une 2e adresse', async () => {
  await B.locator('#discover').scrollIntoViewIfNeeded();
  await B.locator('#discover-cta').click();
  await B.getByRole('heading', { name: 'Où est l’entrée ?' }).waitFor();
  await B.getByText('Aucun point choisi').waitFor();
  await pastePoint(B, B_POINT);
  await B.getByRole('button', { name: 'Continuer' }).click();
  await B.getByLabel('Oui').check();
  await B.getByRole('button', { name: 'Continuer' }).click();
  for (const id of ['label', 'locality', 'instruction']) assert.equal(await B.locator('#' + id).inputValue(), '', id + ' pré-rempli');
  assert.equal(await B.locator('img.photo-prev').count(), 0, 'photo pré-remplie');
  await B.locator('#label').fill(`Boutique test ${stamp}`);
  await B.locator('#instruction').fill('Porte jaune à côté du tailleur');
  await B.getByRole('button', { name: 'Continuer' }).click();
  await B.getByRole('button', { name: 'Enregistrer et obtenir mon lien' }).click();
  await B.getByRole('heading', { name: 'Partager' }).waitFor();
  const body = B.__creates.at(-1);
  for (const s of [A_LABEL, A_INSTR, '14.75814', shareUrl.split('#/a/')[1]]) assert.ok(!body.includes(s), 'donnée de l’expéditeur reprise : ' + s);
  assert.ok(!('photo' in JSON.parse(body).p) || JSON.parse(body).p.photo === null, 'photo reprise');
  secondId = B.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  assert.notEqual(secondId, placeId);
});

await t('4. retour à la fiche d’origine', async () => {
  await B.getByRole('link', { name: '← Revenir à la fiche reçue' }).click();
  await B.getByRole('heading', { name: A_LABEL }).waitFor();
  await B.getByText(A_INSTR).waitFor();
});

await t('5. partage : lien copié et message WhatsApp avec la vraie URL', async () => {
  await A.goto(URL0 + '#/m/' + placeId);
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
  const wa = await A.getByRole('link', { name: 'Préparer un message WhatsApp' }).getAttribute('href');
  assert.ok(decodeURIComponent(wa).includes(shareUrl), 'URL absente du message WhatsApp');
  const [popup] = await Promise.all([A.waitForEvent('popup', { timeout: 5000 }).catch(() => null), A.getByRole('link', { name: 'Préparer un message WhatsApp' }).click()]);
  if (popup) await popup.close().catch(() => {});
  await A.locator('#copy-link').click();
  if (ENGINE === 'chromium') {
    await A.getByText('Lien copié.').waitFor();
    assert.equal(await A.evaluate(() => navigator.clipboard.readText()), shareUrl);
  } else {
    await A.locator('.toast').waitFor();
  }
});

await t('6. désactivation : la fiche et sa photo ne sont plus servies', async () => {
  await A.locator('#revoke').click();
  await A.getByText('Lien désactivé', { exact: true }).waitFor();
  await B.goto(shareUrl); await B.reload();
  await B.getByText('Ce lien a été désactivé').waitFor();
  assert.equal(await B.locator('img.door').count(), 0);
  const r = await rpcFrom(B, 'fiila_get_public', { p_token: shareUrl.split('#/a/')[1] });
  assert.deepEqual(r.body, { state: 'revoked' });
  await shot(B, '03-desactive');
});

await t('7. suppression : fiche et photo inaccessibles, même par l’API', async () => {
  await A.goto(URL0 + '#/m/' + placeId);
  await A.locator('#delete').click();
  await A.locator('#confirm-delete').click();
  await A.getByText('Fiche supprimée.').waitFor();
  await B.goto(shareUrl); await B.reload();
  await B.getByText('Lien introuvable').waitFor();
  const own = await rpcFrom(B, 'fiila_get_owned', { p_id: placeId, p_owner: 'x' });
  assert.equal(own.status, 400);
});

await t('sécurité en production : tables privées inaccessibles par l’API', async () => {
  const r = await B.evaluate(async () => {
    const c = window.FIILA_CONFIG;
    const headers = { apikey: c.supabaseKey };
    if (/^eyJ/.test(c.supabaseKey)) headers.Authorization = 'Bearer ' + c.supabaseKey;
    const base = c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/';
    const out = {};
    for (const [name, url, extra] of [['places', base + 'places?select=*', {}], ['places_fiila', base + 'places?select=*', { 'Accept-Profile': 'fiila' }],
      ['metrics_fiila', base + 'metrics?select=*', { 'Accept-Profile': 'fiila' }]]) {
      const res = await fetch(url, { headers: { ...headers, ...extra } });
      out[name] = res.status;
    }
    return out;
  });
  for (const [k, v] of Object.entries(r)) assert.ok(v >= 400, `${k} accessible (HTTP ${v})`);
});

await t('aucune erreur JavaScript dans les deux sessions', async () => {
  assert.deepEqual([...A.__errors, ...B.__errors], []);
});

// ---------------------------------------------------------------- nettoyage puis compteurs
await new Promise((r) => setTimeout(r, 1500));
for (const c of CREATED) await rpcFrom(B, 'fiila_delete_place', { p_id: c.id, p_owner: c.owner }).catch(() => {});
let metrics = null;
const after = await metricsToday();
await t('compteurs agrégés : événements du parcours enregistrés (comptes, pas un tunnel individuel)', async () => {
  if (!after) { metrics = { note: 'DATABASE_URL absent : compteurs non lus' }; return; }
  const diff = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
    const d = (after[k] || 0) - ((before || {})[k] || 0);
    if (d) diff[k] = d;
  }
  metrics = { delta_pendant_le_test: diff, note: 'Écart des compteurs du jour entre le début et la fin du test. D’autres visiteurs réels peuvent s’y ajouter.' };
  for (const k of ['discovery_shown:address', 'discovery_cta:address', 'fiche_created:address_direct', 'fiche_created:address_discovery', 'share_initiated:whatsapp_address'])
    assert.ok((diff[k] || 0) >= 1, 'compteur non incrémenté : ' + k);
  if (ENGINE === 'chromium') assert.ok((diff['link_copied:address'] || 0) >= 1, 'link_copied non compté');
  for (const b of [...A.__tracks, ...B.__tracks]) assert.deepEqual(Object.keys(JSON.parse(b)).sort(), ['p_event', 'p_variant']);
});

await browser.close();
if (pgClient) await pgClient.end();
if (local) local.server.close();
const report = { cible: TARGET, url: URL0, moteur: ENGINE, version, mode: 'automatisation Playwright, émulation iPhone 13 (pas un téléphone physique)',
  date: new Date().toISOString(), reussis: results.filter((r) => r.ok).length, total: results.length, compteurs: metrics, results };
writeFileSync(`docs/journey-${TARGET}-${ENGINE}.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.reussis}/${report.total} étapes réussies — ${ENGINE} ${version} — ${TARGET} ${URL0}`);
if (metrics) console.log('compteurs', JSON.stringify(metrics));
process.exit(failed ? 1 : 0);
