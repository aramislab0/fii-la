// Tests de bout en bout dans un vrai navigateur (Chromium, et WebKit s'il est installé).
// Chaque « téléphone » est un contexte de navigation isolé : stockage, cookies et cache séparés.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const BASE = process.env.FIILA_URL || null;          // URL déployée (sinon serveur local)
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = process.env.SHOTS || 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

const local = BASE ? null : await startServer(0);
const URL0 = BASE || local.url;
const engine = ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const version = browser.version();

const results = [];
const CREATED = []; // tout ce que les tests créent, supprimé à la fin
let failed = 0;
async function t(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ ok: true, name, ms: Date.now() - t0 }); console.log('PASS', name); }
  catch (e) { failed++; results.push({ ok: false, name, err: String(e.message || e).slice(0, 400) }); console.log('FAIL', name, '\n   ', e.message); }
}

const ENTRY = { latitude: 14.758140, longitude: -17.470320 };
const STOP = { lat: 14.757905, lng: -17.469880 };
const phone = devices['iPhone 13'];
async function newPhone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE !== 'webkit' ? true : phone.isMobile, hasTouch: true,
    userAgent: phone.userAgent, locale: 'fr-FR', timezoneId: 'Africa/Dakar', serviceWorkers: 'block',
    geolocation: opts.geo === false ? undefined : { ...ENTRY, accuracy: opts.accuracy ?? 9 },
    permissions: opts.geo === false ? [] : ['geolocation'],
    ...(opts.ctx || {}),
  });
  if (ENGINE === 'chromium' && opts.clipboard !== false) {
    // Attention : accorder des droits pour une origine remplace ceux du contexte pour cette origine.
    const perms = ['clipboard-read', 'clipboard-write'].concat(opts.geo === false ? [] : ['geolocation']);
    try { await ctx.grantPermissions(perms, { origin: new URL(URL0).origin }); } catch {}
  }
  await ctx.addInitScript(() => {
    window.__geoCalls = 0;
    if (navigator.geolocation) {
      const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...a) => { window.__geoCalls++; return orig(...a); };
    }
    window.__alerts = 0;
    window.alert = () => { window.__alerts++; };
  });
  if (!BASE) await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(BASE ? 20000 : 12000);
  page.on('response', async (res) => {
    const m = res.url().match(/rpc\/(fiila_create_place|fiila_create_request)$/);
    if (!m || res.status() !== 200) return;
    try { const b = await res.json(); CREATED.push({ fn: m[1], id: b.id, owner: b.owner_token }); } catch {}
  });
  page.on('pageerror', (e) => { page.__errors = (page.__errors || []).concat(String(e)); });
  page.on('dialog', (d) => { page.__dialogs = (page.__dialogs || 0) + 1; d.dismiss(); });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
const byText = (page, text) => page.getByRole('button', { name: text }).or(page.getByRole('link', { name: text })).first();
async function confirmPointByPaste(page, scopeIdx, coords) {
  const pasteBtns = page.getByRole('button', { name: 'Depuis Google Maps' });
  await pasteBtns.nth(scopeIdx).click();
  const inputs = page.locator('input[placeholder^="14.758140"]');
  await inputs.nth(scopeIdx).fill(`${coords.lat}, ${coords.lng}`);
  await page.getByRole('button', { name: 'Placer ce point' }).nth(scopeIdx).click();
  await page.getByRole('button', { name: 'Valider ce point' }).nth(scopeIdx).click();
}
async function rpcFromPage(page, fn, args) {
  return page.evaluate(async ([fn, args]) => {
    const c = window.FIILA_CONFIG;
    const headers = { 'Content-Type': 'application/json', apikey: c.supabaseKey };
    if (/^eyJ/.test(c.supabaseKey)) headers.Authorization = 'Bearer ' + c.supabaseKey;
    const r = await fetch(c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [fn, args]);
}
function decodeQr(pngBuf) {
  const png = PNG.sync.read(pngBuf);
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return code && code.data;
}

// --------------------------------------------------------------------------- scénario
const owner = await newPhone();
const A = owner.page;
let shareUrl, placeId, createBody;

await t('accueil : 4 actions, création en premier', async () => {
  await A.goto(URL0);
  await A.getByText('Ton adresse, expliquée une seule fois.').waitFor();
  for (const n of ['Créer mon adresse', 'Mes adresses', 'Demander une adresse', 'Créer un rendez-vous']) await byText(A, n).waitFor();
  await shot(A, '01-accueil');
});

await t('création : géolocalisation après action explicite, précision affichée, point validé', async () => {
  await byText(A, 'Créer mon adresse').click();
  await A.getByRole('heading', { name: 'Où est l’entrée ?' }).waitFor();
  assert.equal(await A.evaluate(() => window.__geoCalls), 0, 'position demandée sans action');
  await A.getByRole('button', { name: 'Utiliser ma position' }).click();
  await A.getByText('Position précise : à environ 9 m près.').first().waitFor();
  await A.getByText('14.758140, -17.470320').first().waitFor();
  await shot(A, '02-carte-entree');
  await A.getByRole('button', { name: 'Valider ce point' }).click();
  await A.getByText('✓ Point validé pour l’entrée').waitFor();
});

await t('correction manuelle : déplacer la carte invalide le point et change les coordonnées', async () => {
  await A.locator('.map').scrollIntoViewIfNeeded();
  const box = await A.locator('.map').boundingBox();
  await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await A.mouse.down();
  await A.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 + 30, { steps: 5 });
  await A.mouse.up();
  await A.getByText('Le repère a bougé : validez à nouveau.').waitFor();
  await A.waitForFunction(() => { const c = document.querySelector('.pt .coords'); return c && c.textContent !== '14.758140, -17.470320'; });
  // retour au point exact pour la suite du test
  await A.getByRole('button', { name: 'Utiliser ma position' }).click();
  await A.getByText('14.758140, -17.470320').first().waitFor();
  await A.getByRole('button', { name: 'Valider ce point' }).click();
  await A.getByText('✓ Point validé pour l’entrée').waitFor();
  await byText(A, 'Continuer').click();
});

await t('arrêt voiture distinct + instructions à pied', async () => {
  await A.getByRole('heading', { name: /Une voiture peut-elle arriver/ }).waitFor();
  await A.getByLabel('Non').check();
  await confirmPointByPaste(A, 0, STOP);
  await A.getByText('✓ Point validé pour l’arrêt voiture').waitFor();
  await A.getByLabel('Du point d’arrêt jusqu’à l’entrée').fill('Prendre la ruelle à gauche de la boutique de tissus, 40 m.');
  await shot(A, '03-arret-voiture');
  await byText(A, 'Continuer').click();
});

const LONG = 'Porte-verte-après-le-manguier-' + 'x'.repeat(220);
await t('photo : compressée, métadonnées GPS retirées avant envoi ; fichier non image refusé', async () => {
  await A.getByLabel('Nom du lieu').fill('Atelier <img src=x onerror=alert(1)> Ndèye « Ébène »');
  await A.getByLabel(/Quartier ou localité/).fill('Yoff Virage');
  await A.locator('#photo').setInputFiles('tests/fixtures/not-image.txt');
  await A.getByText('Ce fichier n’est pas une image.').waitFor();
  await A.locator('#photo').setInputFiles('tests/fixtures/door-with-exif.jpg');
  await A.locator('img.photo-prev').waitFor();
  await A.getByLabel('Repère et accès').fill(LONG);
  await shot(A, '04-reperes');
  await byText(A, 'Continuer').click();
  await A.getByRole('heading', { name: 'Voici ce que verra la personne' }).waitFor();
  await shot(A, '05-apercu');
});

await t('enregistrement en échec réseau : message clair, saisie conservée, puis réussite', async () => {
  await A.route('**/rest/v1/rpc/fiila_create_place', (r) => r.abort('failed'));
  await byText(A, 'Enregistrer et obtenir mon lien').click();
  await A.getByText(/Connexion impossible/).waitFor();
  assert.equal(await A.getByText('Adresse enregistrée.').count(), 0, '« enregistrée » affiché à tort');
  const draft = await A.evaluate(() => JSON.parse(localStorage.getItem('fiila.draft.address')));
  assert.ok(draft && draft.entry && draft.photo, 'brouillon perdu');
  await A.unroute('**/rest/v1/rpc/fiila_create_place');
  const reqP = A.waitForRequest((r) => r.url().includes('fiila_create_place'));
  await byText(A, 'Réessayer l’enregistrement').click();
  createBody = (await reqP).postData();
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
});

await t('photo envoyée sans aucune métadonnée EXIF/GPS et allégée', async () => {
  const p = JSON.parse(createBody).p;
  const bytes = Buffer.from(p.photo, 'base64');
  assert.equal(bytes.includes(Buffer.from('Exif')), false, 'EXIF présent');
  assert.equal(bytes.includes(Buffer.from('FiiLaTestCam')), false, 'métadonnée appareil présente');
  assert.ok(bytes.length < 300000, 'photo trop lourde: ' + bytes.length);
  assert.equal(readFileSync('tests/fixtures/door-with-exif.jpg').includes(Buffer.from('Exif')), true);
});

await t('lien de partage sans clé propriétaire ; clé gardée localement', async () => {
  shareUrl = await A.locator('#share-url').textContent();
  assert.match(shareUrl, /#\/a\/[A-Za-z0-9_-]{20,}$/);
  const owned = await A.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned')));
  placeId = owned[0].id;
  assert.ok(!shareUrl.includes(owned[0].owner), 'clé propriétaire dans le lien');
  assert.ok(!shareUrl.includes(placeId), 'identifiant interne dans le lien');
  assert.equal(await A.evaluate(() => localStorage.getItem('fiila.draft.address')), null, 'brouillon non nettoyé');
  await shot(A, '06-gestion-partage');
});

await t('QR code : se décode exactement en lien de la fiche', async () => {
  const img = A.locator('#qr-img');
  await img.waitFor();
  await A.waitForFunction(() => { const i = document.querySelector('#qr-img'); return i && i.complete && i.naturalWidth > 0; });
  await A.locator('#toast').waitFor({ state: 'hidden', timeout: 8000 });
  const buf = await A.locator('.qr').screenshot({ path: `${SHOTS}/${ENGINE}-qr.png` });
  const decoded = decodeQr(buf);
  assert.equal(decoded, shareUrl);
});

await t('copie du lien (presse-papiers) et lien WhatsApp avec la vraie URL', async () => {
  const wa = await A.getByRole('link', { name: 'Préparer un message WhatsApp' }).getAttribute('href');
  assert.ok(decodeURIComponent(wa).includes(shareUrl));
  await A.locator('#copy-link').click();
  if (ENGINE === 'chromium') {
    await A.getByText('Lien copié.').waitFor();
    assert.equal(await A.evaluate(() => navigator.clipboard.readText()), shareUrl);
  } else {
    await A.locator('.toast').waitFor();
  }
});

// ----- deuxième téléphone (destinataire)
const other = await newPhone({ geo: false });
let B = other.page;
// Ouvre un lien comme le ferait le destinataire : dans un nouvel onglet du même téléphone.
async function openB(url) {
  const old = B;
  B = await other.ctx.newPage();
  B.setDefaultTimeout(BASE ? 20000 : 12000);
  B.on('pageerror', (e) => { B.__errors = (B.__errors || []).concat(String(e)); });
  B.on('dialog', (d) => { B.__dialogs = (B.__dialogs || 0) + 1; d.dismiss(); });
  if (old) { errorsSeen.push(...(old.__errors || [])); await old.close().catch(() => {}); }
  await B.goto(url);
}
const errorsSeen = [];
await t('2e téléphone : la fiche s’ouvre sans compte, photo et instructions visibles', async () => {
  await openB(shareUrl);
  await B.getByRole('heading', { name: /Atelier/ }).waitFor();
  const ok = await B.locator('img.door').evaluate((i) => i.complete && i.naturalWidth > 100);
  assert.ok(ok, 'photo non chargée');
  await B.getByText('Arrêt voiture').waitFor();
  await B.getByText('Entrée', { exact: true }).waitFor();
  await B.getByText(/Ensuite, à pied : Prendre la ruelle/).waitFor();
  await shot(B, '07-destinataire');
});

await t('destinataire : aucune demande de position, aucun script injecté exécuté', async () => {
  assert.equal(await B.evaluate(() => window.__geoCalls), 0);
  assert.equal(await B.evaluate(() => window.__alerts), 0);
  assert.equal(B.__dialogs || 0, 0);
  assert.equal(await B.locator('img[src="x"]').count(), 0);
  await B.getByText('Atelier <img src=x onerror=alert(1)> Ndèye « Ébène »').waitFor();
});

await t('texte long : aucune largeur de page débordante (390 px)', async () => {
  const over = await B.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'débordement horizontal de ' + over + ' px');
});

await t('itinéraires et coordonnées copiées = points enregistrés', async () => {
  const links = await B.getByRole('link', { name: /Itinéraire/ }).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert.equal(links.length, 2);
  // iPhone : application Google Maps ouverte directement (schéma officiel), Plans en repli
  assert.deepEqual(links, ['comgooglemaps://?daddr=14.757905,-17.469880&directionsmode=driving', 'comgooglemaps://?daddr=14.758140,-17.470320&directionsmode=walking']);
  assert.equal(await B.getByRole('link', { name: 'Ouvrir dans Plans' }).count(), 2);
  const coords = await B.locator('.coords').allTextContents();
  assert.deepEqual(coords, ['14.757905, -17.469880', '14.758140, -17.470320']);
});

await t('le destinataire ne peut ni gérer ni modifier la fiche', async () => {
  await openB(URL0 + '#/m/' + placeId);
  await B.getByText('Cette fiche n’est pas gérée sur ce téléphone').waitFor();
  const token = shareUrl.split('#/a/')[1];
  const r1 = await rpcFromPage(B, 'fiila_update_place', { p_id: placeId, p_owner: token, p: { label: 'piraté', entry: { lat: 1, lng: 1 }, instruction: 'x' } });
  assert.equal(r1.status, 400);
  const r2 = await rpcFromPage(B, 'fiila_delete_place', { p_id: placeId, p_owner: 'devine' });
  assert.equal(r2.status, 400);
  const r3 = await rpcFromPage(B, 'fiila_get_public', { p_token: token });
  assert.equal(r3.body.place.label.startsWith('Atelier'), true);
});

await t('modification : même lien, contenu mis à jour chez le destinataire', async () => {
  await A.goto(URL0 + '#/m/' + placeId);
  await A.getByRole('heading', { level: 1, name: /Atelier/ }).waitFor();
  await byText(A, 'Modifier').click();
  await A.getByText('Étape 1 sur 4').waitFor();
  await byText(A, 'Continuer').click();
  await byText(A, 'Continuer').click();
  await A.getByLabel('Repère et accès').fill('Porte verte, sonner deux fois.');
  await byText(A, 'Continuer').click();
  await byText(A, 'Enregistrer les modifications').click();
  await A.getByText('Modifications enregistrées. Le lien reste le même.').waitFor();
  assert.equal(await A.locator('#share-url').textContent(), shareUrl);
  await openB(shareUrl);
  await B.getByText('Porte verte, sonner deux fois.').waitFor();
  assert.ok(await B.locator('img.door').count() === 1, 'photo perdue après modification');
});

await t('clé de gestion : restaurée sur un autre téléphone, elle donne la gestion', async () => {
  const owned = await A.evaluate(() => JSON.parse(localStorage.getItem('fiila.owned')));
  const key = URL0 + '#/k/p.' + owned[0].id + '.' + owned[0].owner;
  const third = await newPhone();
  await third.page.goto(key);
  await third.page.getByRole('heading', { name: 'Partager' }).waitFor();
  assert.ok(!third.page.url().includes(owned[0].owner), 'clé restée dans l’adresse affichée');
  await third.ctx.close();
});

// ----- géolocalisation : refus, délai dépassé, faible précision
await t('géolocalisation refusée : marche à suivre iPhone, réessayer, et point pris dans Google Maps', async () => {
  const p = await newPhone({ geo: false });
  await p.page.goto(URL0 + '#/new');
  await p.page.getByRole('button', { name: 'Utiliser ma position' }).click();
  await p.page.getByText(/Accès à la position refusé/).waitFor();
  await p.page.getByText('Autoriser la position sur iPhone').waitFor();
  await p.page.getByText(/Sites web Safari/).waitFor();
  await p.page.getByRole('button', { name: 'Réessayer' }).waitFor();
  await shot(p.page, '08-position-refusee');
  await p.page.getByRole('button', { name: 'Prendre le point dans Google Maps' }).click();
  await p.page.getByText('Faites un appui long exactement sur l’entrée : un repère rouge apparaît.').waitFor();
  const open = await p.page.getByRole('link', { name: 'Ouvrir Google Maps' }).getAttribute('href');
  assert.ok(open.startsWith('comgooglemaps://'), 'iPhone : ouverture directe de l’application');
  // Lien court copié depuis « Partager » dans Google Maps (lien de test simulé par le serveur local)
  const input = p.page.locator('input[placeholder^="14.758140"]').first();
  if (!BASE) {
    // Local : lien court simulé par le serveur de test. En production, aucun lien court réel n'est inventé :
    // on colle un lien long Google Maps (la lecture des liens courts réels se vérifie sur téléphone).
    await input.fill('Repère placé https://maps.app.goo.gl/fiilaTestPin');
    await p.page.getByRole('button', { name: 'Placer ce point' }).first().click();
    await p.page.getByText(/Point récupéré depuis Google Maps/).waitFor();
  } else {
    await input.fill('https://www.google.com/maps/search/14.758140,+-17.470320?entry=tts');
    await p.page.getByRole('button', { name: 'Placer ce point' }).first().click();
    await p.page.getByText(/Vérifiez que le repère est bien sur l’entrée/).waitFor();
  }
  await p.page.getByRole('button', { name: 'Valider ce point' }).first().click();
  await p.page.getByText('✓ Point validé pour l’entrée').waitFor();
  assert.equal(await p.page.locator('.pt .coords').first().textContent(), '14.758140, -17.470320');
  await p.ctx.close();
});
await t('Google Maps : lien sans point précis → consigne claire ; coordonnées et lien long acceptés', async () => {
  const p = await newPhone();
  await p.page.goto(URL0 + '#/new');
  await p.page.getByRole('button', { name: 'Depuis Google Maps' }).first().click();
  const input = p.page.locator('input[placeholder^="14.758140"]').first();
  await input.fill('https://maps.app.goo.gl/inconnu123');
  await p.page.getByRole('button', { name: 'Placer ce point' }).first().click();
  await p.page.getByText(/ne contient pas de point précis/).waitFor();
  await input.fill('https://www.google.com/maps/search/14.746500,+-17.493000?entry=tts');
  await p.page.getByRole('button', { name: 'Placer ce point' }).first().click();
  await p.page.getByText(/Vérifiez que le repère est bien sur l’entrée/).waitFor();
  assert.equal(await p.page.locator('.pt .coords').first().textContent(), '14.746500, -17.493000');
  await p.ctx.close();
});
await t('Android : itinéraire par lien Google Maps https (ouvre l’application), sans Plans', async () => {
  const p = await newPhone({ ctx: { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' } });
  await p.page.goto(shareUrl);
  await p.page.getByRole('link', { name: /Itinéraire/ }).first().waitFor();
  const links = await p.page.getByRole('link', { name: /Itinéraire/ }).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert.ok(links.length >= 1 && links.every((l) => l.startsWith('https://www.google.com/maps/dir/?api=1&destination=')));
  assert.equal(await p.page.getByRole('link', { name: 'Ouvrir dans Plans' }).count(), 0);
  await p.ctx.close();
});
await t('géolocalisation trop lente : message de délai dépassé', async () => {
  const p = await newPhone();
  await p.ctx.addInitScript(() => { navigator.geolocation.getCurrentPosition = (ok, err) => setTimeout(() => err({ code: 3, message: 'timeout' }), 50); });
  await p.page.goto(URL0 + '#/new');
  await p.page.getByRole('button', { name: 'Utiliser ma position' }).click();
  await p.page.getByText(/a pris trop de temps/).waitFor();
  await p.ctx.close();
});
await t('géolocalisation imprécise : avertissement', async () => {
  const p = await newPhone({ accuracy: 140 });
  await p.page.goto(URL0 + '#/new');
  await p.page.getByRole('button', { name: 'Utiliser ma position' }).click();
  await p.page.getByText(/Position peu précise : à environ 140 m près/).first().waitFor();
  await p.ctx.close();
});

// ----- demande d'adresse
let requestUrl;
const client = await newPhone();
const C = client.page;
await t('demande : le commerçant crée la demande', async () => {
  await A.goto(URL0 + '#/demande/nouvelle');
  await A.getByLabel('Votre nom ou celui de votre commerce').fill('Boutique Ndèye');
  await A.getByLabel('Pourquoi demandez-vous l’adresse ?').fill('Livraison de votre commande');
  await A.getByLabel(/Référence de commande/).fill('CMD-1042');
  await byText(A, 'Créer la demande').click();
  await A.getByText('En attente de réponse').waitFor();
  requestUrl = await A.locator('#request-url').textContent();
  assert.match(requestUrl, /#\/d\/[A-Za-z0-9_-]{20,}$/);
  await shot(A, '09-demande-creee');
});

await t('demande : le client voit qui demande, crée son adresse, prévisualise et envoie', async () => {
  await C.goto(requestUrl);
  await C.getByText('Boutique Ndèye vous demande votre adresse').waitFor();
  await C.getByText(/Identité non vérifiée/).waitFor();
  await shot(C, '10-demande-client');
  await byText(C, 'Créer une nouvelle adresse').click();
  await C.getByRole('button', { name: 'Utiliser ma position' }).click();
  await C.getByText('14.758140, -17.470320').first().waitFor();
  await C.getByRole('button', { name: 'Valider ce point' }).click();
  await byText(C, 'Continuer').click();
  await C.getByLabel('Oui').check();
  await byText(C, 'Continuer').click();
  await C.getByLabel('Nom du lieu').fill('Maison du client (test)');
  await C.getByLabel('Repère et accès').fill('Portail bleu face à l’école');
  await byText(C, 'Continuer').click();
  await byText(C, 'Enregistrer et obtenir mon lien').click();
  await C.getByText('Voici exactement ce qui sera envoyé').waitFor();
  await C.getByText('Portail bleu face à l’école').waitFor();
  await C.locator('#send-address').click();
  await C.getByText('Adresse envoyée').waitFor();
});

await t('demande : un visiteur du lien public ne voit jamais la réponse', async () => {
  const v = await newPhone({ geo: false });
  await v.page.goto(requestUrl);
  await v.page.getByText('Demande déjà traitée').waitFor();
  assert.equal(await v.page.getByText('Portail bleu').count(), 0);
  const token = requestUrl.split('#/d/')[1];
  const r = await rpcFromPage(v.page, 'fiila_get_request_public', { p_token: token });
  assert.ok(!JSON.stringify(r.body).includes('Portail'), 'réponse exposée');
  await v.ctx.close();
});

await t('demande : le commerçant récupère l’adresse dans sa vue privée', async () => {
  await A.reload();
  await A.getByText(/Adresse reçue le/).waitFor();
  await A.getByText('Portail bleu face à l’école').waitFor();
  await shot(A, '11-demande-recue');
});

// ----- rendez-vous
let meetingUrl, meetingId;
await t('rendez-vous : création avec date, lieu et expiration', async () => {
  await A.goto(URL0 + '#/rdv/nouveau');
  await A.getByLabel('Nom du rendez-vous').fill('Baptême chez Awa (test)');
  const now = new Date();
  await A.locator('#m-date').fill(now.toISOString().slice(0, 10));
  await A.locator('#m-time').fill(now.toISOString().slice(11, 16));
  await confirmPointByPaste(A, 0, { lat: 14.7461, lng: -17.4925 });
  await A.getByLabel(/Indications sur place/).fill('Tente blanche derrière la mosquée');
  await A.locator('#m-exp').selectOption('2');
  await shot(A, '12-rendez-vous-form');
  await byText(A, 'Créer le rendez-vous').click();
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
  meetingUrl = await A.locator('#share-url').textContent();
  meetingId = A.url().split('#/m/')[1].split('?')[0];
});

await t('rendez-vous : mise à jour visible sur le même lien', async () => {
  await openB(meetingUrl);
  await B.getByText('Tente blanche derrière la mosquée').waitFor();
  await byText(A, 'Modifier').click();
  await A.getByLabel(/Indications sur place/).fill('Tente BLEUE, entrée côté plage');
  await byText(A, 'Enregistrer les modifications').click();
  await A.getByText(/Rendez-vous mis à jour/).waitFor();
  assert.equal(await A.locator('#share-url').textContent(), meetingUrl);
  await openB(meetingUrl);
  await B.getByText('Tente BLEUE, entrée côté plage').waitFor();
  await shot(B, '13-rendez-vous-invite');
});

await t('rendez-vous expiré : le serveur ne renvoie plus le lieu', async () => {
  if (local) {
    await local.db.query(`update fiila.places set expires_at = now() - interval '1 minute' where id = $1`, [meetingId]);
  } else {
    console.log('   (déployé : expiration testée côté SQL uniquement)');
    return;
  }
  await openB(meetingUrl);
  await B.getByText('Ce rendez-vous est terminé').waitFor();
  const r = await rpcFromPage(B, 'fiila_get_public', { p_token: meetingUrl.split('#/a/')[1] });
  assert.deepEqual(r.body, { state: 'expired' });
});

// ----- désactivation, nouveau lien, suppression
let newUrl;
await t('désactivation : la fiche et sa photo ne sont plus servies', async () => {
  await A.goto(URL0 + '#/m/' + placeId);
  // Attendre la fiche demandée : la vue précédente (rendez-vous) reste affichée pendant le chargement réseau.
  await A.getByRole('heading', { level: 1, name: /Atelier/ }).waitFor();
  await A.locator('#revoke').click();
  await A.getByText('Lien désactivé', { exact: true }).waitFor();
  await openB(shareUrl);
  await B.getByText('Ce lien a été désactivé').waitFor();
  assert.equal(await B.locator('img.door').count(), 0);
  const r = await rpcFromPage(B, 'fiila_get_public', { p_token: shareUrl.split('#/a/')[1] });
  assert.deepEqual(r.body, { state: 'revoked' });
  await shot(B, '14-lien-desactive');
});

await t('nouveau lien : l’ancien affiche « remplacé »', async () => {
  await A.locator('#new-link').click();
  await A.getByRole('heading', { name: 'Partager' }).waitFor();
  newUrl = await A.locator('#share-url').textContent();
  assert.notEqual(newUrl, shareUrl);
  await openB(shareUrl);
  await B.getByText('Ce lien a été remplacé').waitFor();
  await openB(newUrl);
  await B.getByText('Porte verte, sonner deux fois.').waitFor();
});

await t('suppression : confirmation, puis fiche et photo inaccessibles', async () => {
  await A.locator('#delete').click();
  await A.locator('#confirm-delete').click();
  await A.getByText('Fiche supprimée.').waitFor();
  await openB(newUrl);
  await B.getByText('Lien introuvable').waitFor();
  if (local) {
    const n = await local.db.query('select count(*)::int n from fiila.places where id = $1', [placeId]);
    assert.equal(n.rows[0].n, 0);
  }
});

await t('liens invalides : réponse sûre', async () => {
  for (const [h, txt] of [['#/a/abc', 'Lien non valide'], ['#/a/AAAAAAAAAAAAAAAAAAAAAA', 'Lien introuvable'], ['#/zzz', 'Page introuvable'], ['#/d/%3Cscript%3E', 'Demande introuvable'], ['#/k/p.x.y', 'Clé non valide']]) {
    await openB(URL0 + h);
    await B.getByText(txt).first().waitFor();
  }
});

await t('hors connexion : message clair sur la page destinataire', async () => {
  const p = await newPhone({ geo: false });
  await p.page.goto(URL0);
  await p.ctx.setOffline(true);
  await p.page.goto(URL0 + '#/a/AAAAAAAAAAAAAAAAAAAAAA').catch(() => {});
  await p.page.evaluate(() => window.dispatchEvent(new Event('hashchange')));
  await p.page.getByText(/Connexion impossible/).first().waitFor();
  await p.ctx.close();
});

await t('presse-papiers refusé : texte à copier affiché', async () => {
  const p = await newPhone({ clipboard: false });
  await p.ctx.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('refusé')) } }); });
  await p.page.goto(URL0);
  const c = await rpcFromPage(p.page, 'fiila_create_place', { p: { kind: 'address', label: 'Copie', entry: { lat: 14.75, lng: -17.47 }, instruction: 'Test copie' } });
  await p.page.goto(URL0 + '#/a/' + c.body.share_token);
  await p.page.locator('.coords-more summary').first().click();
  await p.page.getByRole('button', { name: 'Copier' }).first().click();
  await p.page.getByText('Copie automatique impossible. Sélectionnez et copiez :').waitFor();
  assert.equal(await p.page.locator('.toast input').inputValue(), '14.750000, -17.470000');
  await p.ctx.close();
});

await t('aucune erreur JavaScript pendant les parcours', async () => {
  const errs = [...(A.__errors || []), ...errorsSeen, ...(B.__errors || []), ...(C.__errors || [])];
  assert.deepEqual(errs, []);
});

// ----- performance de la page destinataire (réseau lent)
await t('page destinataire sur réseau lent (3G simulée) : poids et temps mesurés', async () => {
  if (ENGINE !== 'chromium') return;
  // nouvelle fiche avec photo pour la mesure
  const p = await newPhone();
  const created = await rpcFromPage(A, 'fiila_create_place', { p: { kind: 'address', label: 'Mesure', entry: { lat: 14.75, lng: -17.47 }, instruction: 'Mesure de performance', photo: JSON.parse(createBody).p.photo } });
  const url = URL0 + '#/a/' + created.body.share_token;
  const cdp = await p.ctx.newCDPSession(p.page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: (750 * 1024) / 8, uploadThroughput: (250 * 1024) / 8 });
  let bytes = 0; const urls = [];
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  p.page.on('request', (r) => urls.push(r.url()));
  const t0 = Date.now();
  await p.page.goto(url);
  await p.page.locator('img.door').waitFor();
  await p.page.waitForFunction(() => document.querySelector('img.door').complete);
  const ms = Date.now() - t0;
  const perf = { profil: '3G lente simulée : 750 kbit/s, 300 ms de latence', total_ko: Math.round(bytes / 1024), affichage_complet_ms: ms,
    leaflet_charge: urls.some((u) => u.includes('leaflet')), qr_charge: urls.some((u) => u.includes('qrcode')) };
  writeFileSync(`${SHOTS}/../perf-${ENGINE}.json`, JSON.stringify(perf, null, 2));
  console.log('   perf', perf);
  assert.equal(perf.leaflet_charge, false, 'Leaflet chargé inutilement');
  assert.ok(perf.total_ko < 400, 'page trop lourde');
  await p.ctx.close();
});

// --------------------------------------------------------------------------- nettoyage
{
  const { page } = await newPhone({ geo: false });
  await page.goto(URL0);
  let removed = 0;
  for (const c of CREATED) {
    const fn = c.fn === 'fiila_create_request' ? 'fiila_delete_request' : 'fiila_delete_place';
    const r = await rpcFromPage(page, fn, { p_id: c.id, p_owner: c.owner });
    if (r.status === 200) removed++;
  }
  console.log(`nettoyage : ${removed} élément(s) de test supprimé(s) sur ${CREATED.length} créés (les autres l’avaient déjà été par les tests)`);
}

// --------------------------------------------------------------------------- rapport
await browser.close();
if (local) local.server.close();
const report = { moteur: ENGINE, version, cible: BASE ? 'déployée' : 'locale', date: new Date().toISOString(),
  reussis: results.filter((r) => r.ok).length, total: results.length, results };
writeFileSync(`${SHOTS}/../e2e-${ENGINE}-${BASE ? 'deploye' : 'local'}.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.reussis}/${report.total} tests E2E réussis — ${ENGINE} ${version} — cible ${report.cible}`);
process.exit(failed ? 1 : 0);
