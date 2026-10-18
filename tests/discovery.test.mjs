// Parcours « destinataire → créateur » : bloc découverte, création vierge, retour à la fiche reçue,
// installation facultative, mesure agrégée. Chromium, émulation iPhone 13, serveur local.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, devices } = pw;
const sharp = (() => { try { return require('sharp'); } catch { return require('/opt/npm-tools/node_modules/sharp'); } })();

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await chromium.launch();
const version = browser.version();
const phone = devices['iPhone 13'];

const results = [];
let failed = 0;
async function t(name, fn) {
  try { await fn(); results.push({ ok: true, name }); console.log('PASS', name); }
  catch (e) { failed++; results.push({ ok: false, name, err: String(e.message || e).slice(0, 400) }); console.log('FAIL', name, '\n   ', e.message); }
}

// ------------------------------------------------------------------ fiches de l'expéditeur (synthétiques)
const SENDER = { label: 'Atelier EXPEDITEUR-7731', locality: 'QUARTIER-EXPEDITEUR', instruction: 'REPERE-EXPEDITEUR porte grise', lat: 14.711111, lng: -17.422222 };
const senderPhoto = (await sharp({ create: { width: 640, height: 480, channels: 3, background: '#7a5c3c' } }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
const seed = async (p) => {
  const r = await rpc(local.db, 'fiila_create_place', { p }, { ip: '192.0.2.50' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const sAddr = await seed({ kind: 'address', label: SENDER.label, locality: SENDER.locality, instruction: SENDER.instruction,
  entry: { lat: SENDER.lat, lng: SENDER.lng }, vehicle_ok: true, photo: senderPhoto });
const start = new Date(Date.now() + 3 * 3600e3), end = new Date(Date.now() + 27 * 3600e3);
const sMeet = await seed({ kind: 'meeting', label: 'Baptême EXPEDITEUR', instruction: 'Tente REPERE-EXPEDITEUR', entry: { lat: 14.7461, lng: -17.4925 },
  starts_at: start.toISOString(), expires_at: end.toISOString() });
const LONG = 'Très-long-repère-sans-espace-' + 'é'.repeat(200);
const sLong = await seed({ kind: 'address', label: 'Nom-très-long-' + 'x'.repeat(46), instruction: LONG, entry: { lat: 14.7, lng: -17.4 }, vehicle_ok: true });
const addrUrl = URL0 + '#/a/' + sAddr.share_token;
const meetUrl = URL0 + '#/a/' + sMeet.share_token;
const SENDER_SECRETS = [SENDER.label, SENDER.locality, 'REPERE-EXPEDITEUR', '14.711111', '-17.422222', senderPhoto.slice(0, 40),
  sAddr.share_token, sAddr.owner_token, sMeet.share_token, sMeet.owner_token, 'EXPEDITEUR'];

// ------------------------------------------------------------------ outils
const CREATED = [];
async function newPhone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || phone.viewport, deviceScaleFactor: 2, isMobile: !opts.desktop, hasTouch: !opts.desktop,
    userAgent: opts.desktop ? undefined : phone.userAgent, locale: 'fr-FR', timezoneId: 'Africa/Dakar',
    colorScheme: opts.dark ? 'dark' : 'light', serviceWorkers: opts.sw ? 'allow' : 'block',
    permissions: opts.clipboard ? ['clipboard-read', 'clipboard-write'] : [],
  });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  await ctx.addInitScript(() => {
    window.__geoCalls = 0;
    if (navigator.geolocation) {
      const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...a) => { window.__geoCalls++; return orig(...a); };
    }
  });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.__errors = []; page.__dialogs = 0; page.__tracks = []; page.__creates = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('dialog', (d) => { page.__dialogs++; d.dismiss(); });
  page.on('request', (r) => {
    if (r.url().endsWith('/rpc/fiila_track')) page.__tracks.push(r.postData());
    if (r.url().endsWith('/rpc/fiila_create_place')) page.__creates.push(r.postData());
  });
  page.on('response', async (res) => {
    if (!res.url().endsWith('/rpc/fiila_create_place') || res.status() !== 200) return;
    try { const b = await res.json(); CREATED.push({ id: b.id, owner: b.owner_token }); } catch {}
  });
  return { ctx, page };
}
const shot = (page, name, full = true) => page.screenshot({ path: `${SHOTS}/discovery-${name}.png`, fullPage: full });
const tracks = (page) => page.__tracks.map((b) => JSON.parse(b));
const waitTrack = (page, ev, variant) => page.waitForRequest((r) => r.url().endsWith('/rpc/fiila_track') && r.postData().includes(`"${ev}"`) && r.postData().includes(`"${variant}"`), { timeout: 8000 });
async function pastePoint(page, coords) {
  await page.getByRole('button', { name: 'Depuis Google Maps' }).first().click();
  await page.locator('input[placeholder^="Collez"]').first().fill(`${coords.lat}, ${coords.lng}`);
  await page.getByRole('button', { name: 'Placer ce point' }).first().click();
  const v = page.getByRole('button', { name: 'Valider ce point' });
  if (await v.count()) await v.first().click();
}
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const contrast = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
async function discoverContrast(page) {
  return page.evaluate(() => {
    const box = document.getElementById('discover');
    const bg = getComputedStyle(box).backgroundColor;
    const pick = (el) => getComputedStyle(el).color;
    const cta = document.getElementById('discover-cta');
    return {
      title: [pick(box.querySelector('h2')), bg], body: [pick(box.querySelector('p')), bg], hint: [pick(box.querySelector('.hint')), bg],
      cta: [pick(cta), getComputedStyle(cta).backgroundColor],
      ctaBg: getComputedStyle(cta).backgroundColor, navBg: getComputedStyle(document.querySelector('.route a.btn')).backgroundColor,
    };
  });
}
const CONTRASTS = {};

// ================================================================== 1. accès destinataire anonyme
const anon = await newPhone();
const R = anon.page;
await t('destinataire anonyme : fiche, photo et itinéraire visibles sans compte ni invite', async () => {
  await R.goto(addrUrl);
  await R.getByRole('heading', { name: SENDER.label }).waitFor();
  assert.ok(await R.locator('img.door').evaluate((i) => i.complete && i.naturalWidth > 100), 'photo absente');
  await R.getByRole('link', { name: 'Y aller' }).first().waitFor();
  assert.equal(await R.evaluate(() => localStorage.length), 0, 'stockage local utilisé sans action');
  assert.equal(await R.evaluate(() => window.__geoCalls), 0, 'position demandée');
  assert.equal(R.__dialogs, 0, 'boîte de dialogue affichée');
  assert.equal(await R.locator('#install-slot, .install').count(), 0, 'installation proposée au destinataire');
  const visible = await R.locator('body').innerText();
  for (const txt of ['Se connecter', 'S’inscrire', 'Inscription', 'Créer un compte', 'Abonnement', 'Télécharger l’application', 'App Store', 'Google Play'])
    assert.ok(!visible.includes(txt), 'invite visible : ' + txt);
});

await t('bloc découverte : après les informations d’arrivée, secondaire, sans recouvrement', async () => {
  const d = R.locator('#discover');
  await d.getByRole('heading', { name: 'Votre adresse aussi, en une photo' }).waitFor();
  await d.getByText('La porte, un repère, où se garer. Un lien à envoyer.').waitFor();
  const order = await R.evaluate(() => {
    const f = document.querySelector('article.fiche'), b = document.getElementById('discover');
    return { after: !!(f.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), ficheBottom: f.getBoundingClientRect().bottom + scrollY,
      blockTop: b.getBoundingClientRect().top + scrollY, fixed: ['fixed', 'sticky'].includes(getComputedStyle(b).position) };
  });
  assert.ok(order.after, 'bloc avant la fiche');
  assert.ok(order.blockTop >= order.ficheBottom, 'bloc qui recouvre la fiche');
  assert.equal(order.fixed, false, 'bloc flottant');
  const c = await discoverContrast(R);
  assert.notEqual(c.ctaBg, c.navBg, 'le bouton de découverte a le même poids que l’itinéraire');
  CONTRASTS.light = Object.fromEntries(Object.entries(c).filter(([k]) => !k.endsWith('Bg')).map(([k, [a, b]]) => [k, +contrast(a, b).toFixed(2)]));
  for (const [k, v] of Object.entries(CONTRASTS.light)) assert.ok(v >= 4.5, `contraste ${k} = ${v}`);
  await shot(R, 'destinataire-adresse-light');
});

await t('mesure : affichage compté quand le bloc est visible, sans aucune donnée de fiche', async () => {
  await R.locator('#discover').scrollIntoViewIfNeeded();
  await waitTrack(R, 'discovery_shown', 'address');
  for (const b of R.__tracks) {
    assert.deepEqual(Object.keys(JSON.parse(b)).sort(), ['p_event', 'p_variant']);
    for (const s of SENDER_SECRETS) assert.ok(!b.includes(s), 'donnée dans la mesure : ' + s.slice(0, 20));
  }
});

await t('clavier : le bouton de découverte est atteignable et le focus est visible', async () => {
  await R.evaluate(() => window.scrollTo(0, 0));
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    await R.keyboard.press('Tab');
    found = await R.evaluate(() => document.activeElement && document.activeElement.id === 'discover-cta');
  }
  assert.ok(found, 'CTA non atteint au clavier');
  const o = await R.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, w: parseFloat(s.outlineWidth) }; });
  assert.ok(o.style !== 'none' && o.w >= 2, 'focus invisible');
  await R.locator('#discover').screenshot({ path: `${SHOTS}/discovery-focus-clavier.png` });
});

// ================================================================== 2. CTA adresse → création vierge → retour
let newId;
await t('CTA adresse : ouvre la création existante, vierge (aucune donnée de l’expéditeur)', async () => {
  const cta = waitTrack(R, 'discovery_cta', 'address');
  await R.locator('#discover-cta').click();
  await cta;
  await R.getByRole('heading', { name: 'Où est l’entrée ?' }).waitFor();
  assert.match(R.url(), /#\/new\?retour=/);
  assert.equal(await R.locator('.pt').first().getAttribute('data-point'), '', 'coordonnées pré-remplies');
  assert.equal(await R.evaluate(() => localStorage.getItem('fiila.draft.address')), null, 'brouillon pré-rempli');
  await shot(R, 'creation-depuis-decouverte');
});

await t('retour à la fiche reçue depuis la création', async () => {
  await R.getByRole('link', { name: '← Revenir à la fiche reçue' }).click();
  await R.getByRole('heading', { name: SENDER.label }).waitFor();
  await R.locator('#discover-cta').click();
  await R.getByRole('heading', { name: 'Où est l’entrée ?' }).waitFor();
});

await t('création complète : aucune donnée de l’expéditeur dans la nouvelle fiche', async () => {
  await pastePoint(R, { lat: 14.6901, lng: -17.4467 });
  await R.locator('#wizard-next').click();
  await R.getByLabel('Oui').check();
  await R.getByRole('link', { name: 'Revenir à la fiche reçue (le brouillon est gardé)' }).waitFor();
  await R.locator('#wizard-next').click();
  await R.locator('#add-locality').waitFor();
  for (const id of ['label', 'instruction']) assert.equal(await R.locator('#' + id).inputValue(), '', id + ' pré-rempli');
  assert.equal(await R.locator('img.photo-prev').count(), 0, 'photo pré-remplie');
  await R.locator('#label').fill('Ma boutique (test)');
  await R.locator('#instruction').fill('Porte jaune, à côté du tailleur');
  await R.locator('#wizard-next').click();
  const created = waitTrack(R, 'fiche_created', 'address_discovery');
  await R.locator('#wizard-next').click();
  await R.getByRole('heading', { name: 'Partager' }).waitFor();
  await created;
  const body = R.__creates.at(-1);
  for (const s of SENDER_SECRETS) assert.ok(!body.includes(s), 'donnée de l’expéditeur envoyée : ' + s.slice(0, 20));
  newId = R.url().match(/#\/m\/([0-9a-f-]{36})/)[1];
  const rec = (await R.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned'))))[0];
  const stored = await rpc(local.db, 'fiila_get_owned', { p_id: newId, p_owner: rec.owner });
  assert.equal(stored.body.label, 'Ma boutique (test)');
  assert.equal(stored.body.photo, undefined);
  assert.deepEqual(stored.body.entry, { lat: 14.6901, lng: -17.4467 });
  assert.notEqual(stored.body.share_token, sAddr.share_token);
  await shot(R, 'gestion-apres-decouverte');
});

await t('après création : retour à la fiche reçue toujours possible', async () => {
  await R.getByRole('link', { name: '← Revenir à la fiche reçue' }).click();
  await R.getByRole('heading', { name: SENDER.label }).waitFor();
  await R.goBack();
  await R.getByRole('heading', { name: 'Partager' }).waitFor();
});

await t('environnement sans installation possible : aucune proposition, rien de bloqué', async () => {
  assert.equal(await R.locator('#install-btn').count(), 0);
  assert.equal(await R.locator('.install').count(), 0);
  assert.equal(await R.locator('a[href*="apps.apple.com"], a[href*="play.google.com"]').count(), 0);
});

await t('mesure : partage WhatsApp ouvert et lien copié, distingués, sans contenu', async () => {
  await anon.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(URL0).origin });
  const wa = waitTrack(R, 'share_initiated', 'whatsapp_address');
  const [popup] = await Promise.all([R.waitForEvent('popup').catch(() => null), R.locator('#share-whatsapp').click()]);
  await wa;
  if (popup) await popup.close().catch(() => {});
  const cp = waitTrack(R, 'link_copied', 'address');
  await R.locator('#copy-link').click();
  await R.getByText('Lien copié.').waitFor();
  await cp;
  const evs = tracks(R).map((x) => x.p_event + ':' + x.p_variant);
  for (const e of ['discovery_shown:address', 'discovery_cta:address', 'fiche_created:address_discovery', 'share_initiated:whatsapp_address', 'link_copied:address'])
    assert.ok(evs.includes(e), 'manque ' + e);
  assert.ok(!evs.some((e) => /sent|envoy/.test(e)), 'événement « envoyé » non vérifiable');
  const own = (await R.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned'))))[0];
  for (const b of R.__tracks) for (const s of [own.owner, own.id]) assert.ok(!b.includes(s), 'clé ou id dans la mesure');
  await new Promise((r) => setTimeout(r, 300));
  const m = await local.db.query(`select event, variant, n::int from fiila.metrics order by event, variant`);
  writeFileSync('docs/discovery-metrics-local.json', JSON.stringify(m.rows, null, 2));
  assert.ok(m.rows.find((x) => x.event === 'fiche_created' && x.variant === 'address_discovery'));
});

// ================================================================== 3. rendez-vous
const anon2 = await newPhone();
const M = anon2.page;
await t('CTA rendez-vous : texte adapté, ouvre la création de rendez-vous, vierge', async () => {
  await M.goto(meetUrl);
  await M.getByRole('heading', { name: 'Baptême EXPEDITEUR' }).waitFor();
  await M.locator('#discover').getByRole('heading', { name: 'Votre prochain rendez-vous' }).waitFor();
  await M.getByText('Le lieu, l’heure et le chemin dans un seul lien.').waitFor();
  await shot(M, 'destinataire-rendez-vous-light');
  await M.getByRole('link', { name: 'Créer un rendez-vous' }).click();
  await M.getByRole('heading', { name: 'Créer un rendez-vous' }).waitFor();
  assert.match(M.url(), /#\/rdv\/nouveau\?retour=/);
  assert.equal(await M.locator('#m-label').inputValue(), '');
  assert.equal(await M.locator('#m-instr').inputValue(), '');
  assert.equal(await M.locator('.pt').first().getAttribute('data-point'), '', 'lieu pré-rempli');
  await M.getByRole('link', { name: '← Revenir à la fiche reçue' }).click();
  await M.getByRole('heading', { name: 'Baptême EXPEDITEUR' }).waitFor();
});

await t('rendez-vous créé depuis la découverte : mesuré, sans donnée de l’expéditeur, retour possible', async () => {
  await M.getByRole('link', { name: 'Créer un rendez-vous' }).click();
  await M.locator('#m-label').fill('Anniversaire (test)');
  await pastePoint(M, { lat: 14.68, lng: -17.45 });
  const created = waitTrack(M, 'fiche_created', 'meeting_discovery');
  await M.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await M.getByRole('heading', { name: 'Partager' }).waitFor();
  await created;
  const body = M.__creates.at(-1);
  for (const s of SENDER_SECRETS) assert.ok(!body.includes(s), 'donnée de l’expéditeur envoyée : ' + s.slice(0, 20));
  await M.getByRole('link', { name: '← Revenir à la fiche reçue' }).click();
  await M.getByRole('heading', { name: 'Baptême EXPEDITEUR' }).waitFor();
});

// ================================================================== 4. thème sombre, texte long, largeurs
await t('thème sombre : bloc lisible (contrastes AA) et vrai fond sombre', async () => {
  const p = await newPhone({ dark: true });
  await p.page.goto(addrUrl);
  await p.page.locator('#discover').waitFor();
  const bg = await p.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.ok(lum(rgb(bg)) < 0.05, 'fond non sombre : ' + bg);
  const c = await discoverContrast(p.page);
  CONTRASTS.dark = Object.fromEntries(Object.entries(c).filter(([k]) => !k.endsWith('Bg')).map(([k, [a, b]]) => [k, +contrast(a, b).toFixed(2)]));
  for (const [k, v] of Object.entries(CONTRASTS.dark)) assert.ok(v >= 4.5, `contraste ${k} = ${v}`);
  await shot(p.page, 'destinataire-adresse-dark');
  await p.page.goto(meetUrl);
  await p.page.locator('#discover').waitFor();
  await shot(p.page, 'destinataire-rendez-vous-dark');
  await p.ctx.close();
});

await t('texte long et petit écran (320 px) : aucun débordement horizontal', async () => {
  for (const viewport of [{ width: 320, height: 640 }, phone.viewport]) {
    const p = await newPhone({ viewport });
    await p.page.goto(URL0 + '#/a/' + sLong.share_token);
    await p.page.locator('#discover').waitFor();
    const over = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `débordement ${over}px à ${viewport.width}px`);
    const w = await p.page.locator('#discover').evaluate((e) => e.getBoundingClientRect().right <= document.documentElement.clientWidth);
    assert.ok(w, 'bloc qui dépasse');
    if (viewport.width === 320) await shot(p.page, 'texte-long-320');
    await p.ctx.close();
  }
});

await t('ordinateur (1 280 px), Light et Dark : bloc sous la fiche', async () => {
  for (const dark of [false, true]) {
    const p = await newPhone({ desktop: true, viewport: { width: 1280, height: 900 }, dark });
    await p.page.goto(addrUrl);
    await p.page.locator('#discover').waitFor();
    await shot(p.page, 'desktop-' + (dark ? 'dark' : 'light'));
    await p.ctx.close();
  }
});

// ================================================================== 5. mesure en échec ou refusée
await t('mesure en panne (requêtes rejetées ou sans réponse) : affichage et création intacts', async () => {
  for (const mode of ['abort', 'hang']) {
    const p = await newPhone();
    await p.ctx.route('**/rpc/fiila_track', (r) => (mode === 'abort' ? r.abort() : new Promise(() => {})));
    await p.page.goto(meetUrl);
    await p.page.getByRole('heading', { name: 'Baptême EXPEDITEUR' }).waitFor();
    await p.page.locator('#discover').scrollIntoViewIfNeeded();
    await p.page.getByRole('link', { name: 'Créer un rendez-vous' }).click();
    await p.page.locator('#m-label').fill('Test panne mesure ' + mode);
    await pastePoint(p.page, { lat: 14.69, lng: -17.44 });
    await p.page.getByRole('button', { name: 'Créer le rendez-vous' }).click();
    await p.page.getByRole('heading', { name: 'Partager' }).waitFor();
    assert.deepEqual(p.page.__errors, []);
    await p.ctx.close();
  }
});

await t('signal « ne pas suivre » (GPC) : aucune mesure envoyée', async () => {
  const p = await newPhone({ init: () => Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }) });
  await p.page.goto(addrUrl);
  await p.page.locator('#discover').scrollIntoViewIfNeeded();
  await p.page.locator('#discover-cta').click();
  await p.page.getByRole('heading', { name: 'Où est l’entrée ?' }).waitFor();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(p.page.__tracks.length, 0);
  await p.ctx.close();
});

// ================================================================== 6. installation
async function firstSave(p) {
  await p.page.goto(URL0 + '#/rdv/nouveau');
  await p.page.locator('#m-label').fill('Installation (test)');
  await pastePoint(p.page, { lat: 14.7, lng: -17.45 });
  await p.page.getByRole('button', { name: 'Créer le rendez-vous' }).click();
  await p.page.getByRole('heading', { name: 'Partager' }).waitFor();
}
const fakePrompt = () => {
  window.__prompted = 0;
  window.__fireInstall = (outcome) => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  };
};

await t('installation : jamais avant une première fiche enregistrée, même si le navigateur la permet', async () => {
  const p = await newPhone({ init: fakePrompt });
  await p.page.goto(addrUrl);
  await p.page.evaluate(() => window.__fireInstall('accepted'));
  await p.page.locator('#discover').waitFor();
  assert.equal(await p.page.locator('#install-btn').count(), 0);
  await p.ctx.close();
});

await t('installation (navigateur compatible) : proposée après la 1re fiche, lance l’invite native puis disparaît', async () => {
  const p = await newPhone({ init: fakePrompt });
  await firstSave(p);
  await p.page.evaluate(() => window.__fireInstall('accepted'));
  await p.page.locator('#install-btn').waitFor();
  await shot(p.page, 'installation-proposee');
  await p.page.locator('#install-btn').click();
  await p.page.waitForFunction(() => window.__prompted === 1);
  await p.page.locator('#install-btn').waitFor({ state: 'detached' });
  await p.ctx.close();
});

await t('installation refusée (« Plus tard ») : masquée durablement, l’application reste utilisable', async () => {
  const p = await newPhone({ init: fakePrompt });
  await firstSave(p);
  await p.page.evaluate(() => window.__fireInstall('dismissed'));
  await p.page.locator('#install-later').click();
  assert.equal(await p.page.locator('.install').count(), 0);
  await p.page.reload();
  await p.page.evaluate(() => window.__fireInstall('dismissed'));
  await p.page.getByRole('heading', { name: 'Partager' }).waitFor();
  assert.equal(await p.page.locator('.install').count(), 0);
  await p.page.goto(URL0 + '#/rdv/nouveau');
  await p.page.getByRole('heading', { name: 'Créer un rendez-vous' }).waitFor();
  await p.ctx.close();
});

await t('iPhone (Safari) : consigne « Sur l’écran d’accueil », sans faux lien de store', async () => {
  const p = await newPhone({ init: () => Object.defineProperty(navigator, 'standalone', { get: () => false }) });
  await firstSave(p);
  await p.page.getByText('touchez le bouton Partager du navigateur, puis « Sur l’écran d’accueil »', { exact: false }).waitFor();
  assert.equal(await p.page.locator('#install-btn').count(), 0);
  assert.equal(await p.page.locator('a[href*="apps.apple.com"], a[href*="play.google.com"]').count(), 0);
  await p.page.locator('.install').screenshot({ path: `${SHOTS}/discovery-installation-ios.png` });
  await p.ctx.close();
});

await t('déjà installée (mode application) : aucune proposition', async () => {
  const p = await newPhone({ init: () => Object.defineProperty(navigator, 'standalone', { get: () => true }) });
  await firstSave(p);
  assert.equal(await p.page.locator('.install').count(), 0);
  await p.ctx.close();
});

let installability = null;
await t('installabilité réelle (Chromium, service worker actif) : manifeste valide, aucune erreur', async () => {
  const p = await newPhone({ sw: true });
  await p.page.goto(URL0);
  await p.page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cdp = await p.ctx.newCDPSession(p.page);
  const man = await cdp.send('Page.getAppManifest');
  const inst = await cdp.send('Page.getInstallabilityErrors');
  installability = { manifestErrors: man.errors, installabilityErrors: inst.installabilityErrors };
  assert.deepEqual(man.errors, []);
  assert.deepEqual(inst.installabilityErrors, []);
  // Le service worker ne met en cache ni l'API ni le contenu des fiches.
  await p.page.goto(addrUrl);
  await p.page.getByRole('heading', { name: SENDER.label }).waitFor();
  const cached = await p.page.evaluate(async () => {
    const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url); return out;
  });
  assert.ok(cached.length > 0, 'coquille non mise en cache');
  assert.ok(!cached.some((u) => u.includes('/rest/') || u.includes('#')), 'API en cache');
  assert.deepEqual(p.page.__errors, []);
  await p.ctx.close();
});

// ------------------------------------------------------------------ nettoyage et rapport
for (const c of CREATED) await rpc(local.db, 'fiila_delete_place', { p_id: c.id, p_owner: c.owner });
for (const s of [sAddr, sMeet, sLong]) await rpc(local.db, 'fiila_delete_place', { p_id: s.id, p_owner: s.owner_token });
await browser.close();
local.server.close();
const report = { moteur: 'chromium', version, date: new Date().toISOString(), reussis: results.filter((r) => r.ok).length, total: results.length,
  contrastes_bloc_decouverte: CONTRASTS, installabilite: installability, results };
writeFileSync('docs/discovery-test-report.json', JSON.stringify(report, null, 2));
console.log('contrastes', JSON.stringify(CONTRASTS));
console.log(`\n${report.reussis}/${report.total} tests découverte réussis — chromium ${version}`);
process.exit(failed ? 1 : 0);
