// Partage social : panneau unique (adresse, rendez-vous, demande), liens par plateforme, image verticale.
// Automatisation Chromium, émulation iPhone 13, base Postgres locale réelle. AUCUNE publication réelle :
// les adresses wa.me, t.me et facebook.com sont interceptées et jamais ouvertes.
// Simulations signalées : [SIMULÉ partage natif] navigator.share remplacé ; [SIMULÉ temps] expiration forcée en base.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const sharp = (() => { try { return require('sharp'); } catch { return require('/opt/npm-tools/node_modules/sharp'); } })();

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

// ------------------------------------------------------------------ données synthétiques
const photo = (await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#6d8a5a' } }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
const LONG = 'Réunion « Ndèye & Fils » #2 — l’après-midi à Ouakam, près de l’école élémentaire';
async function seed(p) { const r = await rpc(local.db, 'fiila_create_place', { p }, { ip: '192.0.2.90' }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }
const addr = await seed({ kind: 'address', label: 'Atelier Ndèye', instruction: 'Porte verte après le manguier', entry: { lat: 14.758140, lng: -17.470320 }, vehicle_ok: true, photo });
const meet = await seed({ kind: 'meeting', label: LONG.slice(0, 60), instruction: 'Tente blanche', entry: { lat: 14.7461, lng: -17.4925 },
  starts_at: new Date(Date.now() + 2 * 86400e3).toISOString(), expires_at: new Date(Date.now() + 3 * 86400e3).toISOString(), photo });
const req = (await rpc(local.db, 'fiila_create_request', { p: { requester_name: 'Boutique Ndèye', purpose: 'Livraison de votre commande', order_ref: 'CMD-9' } }, { ip: '192.0.2.90' })).body;
const OWNED = [
  { type: 'place', kind: 'address', id: addr.id, owner: addr.owner_token, share: addr.share_token, label: 'Atelier Ndèye' },
  { type: 'place', kind: 'meeting', id: meet.id, owner: meet.owner_token, share: meet.share_token, label: LONG.slice(0, 60) },
  { type: 'request', id: req.id, owner: req.owner_token, label: 'Livraison de votre commande' },
];
const SECRETS = OWNED.flatMap((o) => [o.owner, o.id]);
const recipientUrl = { address: URL0 + '#/a/' + addr.share_token, meeting: URL0 + '#/a/' + meet.share_token, request: URL0 + '#/d/' + req.share_token };

async function newPhone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', timezoneId: 'Africa/Dakar', colorScheme: opts.dark ? 'dark' : 'light', serviceWorkers: 'block', acceptDownloads: true,
    permissions: ENGINE === 'chromium' && opts.clipboard !== false ? ['clipboard-read', 'clipboard-write'] : [],
  });
  for (const host of ['https://wa.me/**', 'https://t.me/**', 'https://www.facebook.com/**', 'https://tile.openstreetmap.org/**']) await ctx.route(host, (r) => r.abort());
  if (opts.fbAppId) await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `window.FIILA_CONFIG={supabaseUrl:location.origin,supabaseKey:'local-test-key',publicUrl:'',facebookAppId:'${opts.fbAppId}'};` }));
  if (opts.init) await ctx.addInitScript(opts.init);
  if (opts.owned !== false) await ctx.addInitScript((o) => { if (!localStorage.getItem('fiila.owned')) localStorage.setItem('fiila.owned', JSON.stringify(o)); }, OWNED);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.__tracks = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('request', (r) => { if (r.url().endsWith('/rpc/fiila_track')) page.__tracks.push(JSON.parse(r.postData())); });
  return { ctx, page };
}
const shot = (page, name, full = true) => page.screenshot({ path: `${SHOTS}/social-${ENGINE}-${name}.png`, fullPage: full });
const waitTrack = (page, ev, v) => { const p = page.waitForRequest((r) => r.url().endsWith('/rpc/fiila_track') && r.postData().includes(`"${ev}"`) && r.postData().includes(`"${v}"`), { timeout: 8000 }); p.catch(() => {}); return p; };
function decodePng(buf) { const png = PNG.sync.read(buf); const c = jsQR(new Uint8ClampedArray(png.data), png.width, png.height); return c && c.data; }
// Facebook, partage natif et (avec QR code) TikTok sont rangés sous « Autres ».
async function reveal(page, sel) { await page.locator(sel).waitFor({ state: 'attached' }); if (!(await page.locator(sel).isVisible())) await page.locator('#share-more').click(); await page.locator(sel).waitFor(); }
async function panelHrefs(page) { return page.locator('.share-panel a[href]').evaluateAll((as) => as.map((a) => a.href)); }

const views = { address: '#/m/' + addr.id, meeting: '#/m/' + meet.id, request: '#/demande/' + req.id };
const P = await newPhone();
const O = P.page;

// ================================================================== 1. panneau et liens
for (const kind of ['address', 'meeting', 'request']) {
  await t(`panneau ${kind} : actions présentes, avertissement de confidentialité, lien destinataire seul`, async () => {
    await O.goto(URL0 + views[kind]);
    await O.locator('.share-panel').waitFor();
    for (const n of ['Envoyer sur WhatsApp', 'Copier', 'Telegram', 'Story', 'Autres'])
      await O.locator('.share-panel').getByText(n, { exact: true }).first().waitFor();
    assert.equal(await O.locator('.share-panel .rnd svg').count() >= 5, true, 'chaque raccourci a son pictogramme');
    await reveal(O, '#share-facebook-copy');
    await O.locator('#share-tiktok').waitFor();
    assert.equal(await O.locator('#privacy-note').textContent(), kind === 'request' ? 'Seule la personne qui a ce lien peut vous répondre.' : 'Seules les personnes qui ont le lien voient la fiche.');
    const url = await O.locator('.share-panel .sharelink').textContent();
    assert.equal(url, recipientUrl[kind]);
    const hrefs = await panelHrefs(O);
    for (const href of hrefs) for (const sec of SECRETS) assert.ok(!decodeURIComponent(href).includes(sec), 'clé ou identifiant interne dans ' + href.slice(0, 60));
    const tg = new URL(hrefs.find((x) => x.startsWith('https://t.me/')));
    assert.equal(tg.origin + tg.pathname, 'https://t.me/share/url');
    assert.equal(tg.searchParams.get('url'), recipientUrl[kind]);
    assert.ok(!tg.searchParams.get('text').includes(recipientUrl[kind]), 'URL répétée dans le texte Telegram');
    assert.ok(!hrefs.some((x) => x.includes('facebook.com')), 'lien Facebook sans configuration');
    assert.ok(!hrefs.some((x) => /#\/(m|demande|k|edit)\//.test(decodeURIComponent(x))), 'URL de gestion ou privée dans un lien');
    assert.equal(await O.locator('#share-facebook').count(), 0);
    const wa = decodeURIComponent(hrefs.find((x) => x.startsWith('https://wa.me/')));
    assert.ok(wa.includes(recipientUrl[kind]));
  });
}

await t('encodage : accents, guillemets, « & », « # » et titre long conservés dans le texte Telegram', async () => {
  await O.goto(URL0 + views.meeting);
  await O.getByRole('heading', { name: LONG.slice(0, 60) }).waitFor();
  const tg = new URL(await O.locator('#share-telegram').getAttribute('href'));
  assert.ok(!/:\s*$/.test(tg.searchParams.get('text')), 'deux-points final dans le texte');
  assert.ok(tg.searchParams.get('text').startsWith('Vous êtes invité(e) : ' + LONG.slice(0, 60)), tg.searchParams.get('text'));
  assert.ok(/%C3%A8|%E2%80%99/.test(tg.search), 'accents non encodés');
  assert.ok(!/[ «»&#]/.test(tg.search.slice(1).replace(/&text=/, '').replace(/^url=/, '')), 'caractères non encodés dans la requête');
});

await t('Facebook avec identifiant d’application configuré : Share Dialog officiel, sans message prérempli', async () => {
  const p = await newPhone({ fbAppId: '1234567890' });
  await p.page.goto(URL0 + views.address);
  const fb = new URL(await p.page.locator('#share-facebook').getAttribute('href'));
  assert.equal(fb.origin + fb.pathname, 'https://www.facebook.com/dialog/share');
  assert.equal(fb.searchParams.get('app_id'), '1234567890');
  assert.equal(fb.searchParams.get('href'), recipientUrl.address);
  assert.equal(fb.searchParams.get('quote'), null);
  assert.equal(await p.page.locator('#share-facebook-copy').count(), 0, 'copie affichée alors que le Share Dialog est configuré');
  await p.ctx.close();
});

await t('Facebook sans configuration : action de copie honnête, consigne affichée, aucune ouverture de Facebook', async () => {
  await O.goto(URL0 + views.request);
  await reveal(O, '#share-facebook-copy');
  assert.equal(await O.locator('#fb-help').isVisible(), false, 'consigne affichée avant le clic');
  const popups = [];
  O.on('popup', (pp) => popups.push(pp));
  const copied = waitTrack(O, 'link_copied', 'request');
  await O.locator('#share-facebook-copy').click();
  await O.locator('#fb-help').getByText('Fii La n’est pas relié à Facebook : le lien est seulement copié.', { exact: false }).waitFor();
  if (ENGINE === 'chromium') { await copied; assert.equal(await O.evaluate(() => navigator.clipboard.readText()), recipientUrl.request); }
  await O.waitForTimeout(400);
  assert.equal(popups.length, 0, 'une fenêtre s’est ouverte');
});

await t('vue destinataire : aucun bouton de réseau social, l’itinéraire reste l’action principale', async () => {
  const p = await newPhone({ owned: false });
  await p.page.goto(recipientUrl.address);
  await p.page.getByRole('link', { name: 'Y aller' }).first().waitFor();
  assert.equal(await p.page.locator('a[href*="t.me"], a[href*="facebook.com"], #share-instagram, #share-tiktok, .share-panel').count(), 0);
  await p.ctx.close();
});

// ================================================================== 2. partage natif et presse-papiers
await t('partage natif absent (navigateur sans Web Share) : bouton masqué, autres actions disponibles', async () => {
  await O.goto(URL0 + views.address);
  await O.locator('.share-panel').waitFor();
  assert.equal(await O.locator('#share-native').count(), 0);
  await O.locator('#copy-link').waitFor();
});

await t('partage natif [SIMULÉ partage natif] : réussi, annulé, refusé', async () => {
  const p = await newPhone({ init: () => {
    window.__shared = []; window.__mode = 'ok';
    navigator.share = (d) => { window.__shared.push(d); if (window.__mode === 'cancel') return Promise.reject(new DOMException('annulé', 'AbortError'));
      if (window.__mode === 'deny') return Promise.reject(new DOMException('refusé', 'NotAllowedError')); return Promise.resolve(); };
  } });
  await p.page.goto(URL0 + views.meeting);
  await reveal(p.page, '#share-native');
  await p.page.locator('#share-native').click();
  const d = await p.page.evaluate(() => window.__shared[0]);
  assert.equal(d.url, recipientUrl.meeting);
  for (const sec of SECRETS) assert.ok(!JSON.stringify(d).includes(sec));
  await p.page.evaluate(() => { window.__mode = 'cancel'; });
  await p.page.locator('#share-native').click();
  await p.page.waitForTimeout(400);
  assert.equal(await p.page.locator('#toast').isVisible(), false, 'message affiché après une annulation');
  await p.page.evaluate(() => { window.__mode = 'deny'; });
  await p.page.locator('#share-native').click();
  await p.page.getByText('Partage indisponible ici. Utilisez « Copier ».').waitFor();
  await p.ctx.close();
});

await t('presse-papiers refusé : le lien destinataire est proposé à copier à la main', async () => {
  const p = await newPhone({ clipboard: false, init: () => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('refusé')) } }) });
  await p.page.goto(URL0 + views.request);
  await p.page.locator('#copy-request').click();
  await p.page.getByText('Copie automatique impossible. Sélectionnez et copiez :').waitFor();
  assert.equal(await p.page.locator('.toast input').inputValue(), recipientUrl.request);
  await p.ctx.close();
});

// ================================================================== 3. image verticale
async function openVisual(page, view, ch) {
  await page.goto(URL0 + view);
  await page.locator('#share-' + ch).click();
  await page.waitForFunction(() => { const i = document.getElementById('visual-preview'); return i && i.dataset.meta; });
  return JSON.parse(await page.locator('#visual-preview').getAttribute('data-meta'));
}
async function lineWidths(page, lines) {
  return page.evaluate((ls) => { const c = document.createElement('canvas').getContext('2d'); c.font = '800 84px Montserrat, system-ui, sans-serif'; return ls.map((l) => c.measureText(l).width); }, lines);
}

let exportedMeeting;
await t('Instagram / Story : aperçu 1080 × 1920, consigne du sticker Lien, sans photo par défaut', async () => {
  const meta = await openVisual(O, views.meeting, 'instagram');
  assert.equal(await O.locator('#share-instagram').getAttribute('aria-expanded'), 'true');
  assert.deepEqual([meta.width, meta.height], [1080, 1920]);
  assert.equal(meta.includesPhoto, false, 'photo incluse par défaut');
  assert.equal(meta.qrText, recipientUrl.meeting);
  assert.ok(meta.titleLines.length <= 3);
  for (const w of await lineWidths(O, meta.titleLines)) assert.ok(w <= 888.5, 'ligne trop large ' + w);
  assert.equal(meta.qr.overlapsContent, false, 'QR code sur le texte');
  assert.ok(meta.qr.cell >= 5);
  const all = meta.texts.join(' | ');
  for (const sec of SECRETS) assert.ok(!all.includes(sec), 'donnée privée dans l’image');
  assert.ok(!/\d+\.\d{4,}/.test(all.replace(/https?:\S+/g, '')), 'coordonnées dans l’image');
  assert.ok(meta.texts.some((x) => /heure de Dakar/.test(x)), 'date absente');
  await O.getByText('L’image ne contient pas de lien cliquable', { exact: false }).waitFor();
  await O.getByText('sticker « Lien »', { exact: false }).waitFor();
  await shot(O, '01-panneau-instagram');
});

await t('export : fichier PNG 1080 × 1920 téléchargé, QR décodé = lien destinataire', async () => {
  const dl = O.waitForEvent('download');
  const ev = waitTrack(O, 'visual_exported', 'download_meeting');
  await O.locator('#visual-download').click();
  const d = await dl; await ev;
  const path = `${SHOTS}/social-${ENGINE}-export-rendez-vous.png`;
  await d.saveAs(path);
  const buf = readFileSync(path);
  const m = await sharp(buf).metadata();
  assert.deepEqual([m.width, m.height, m.format], [1080, 1920, 'png']);
  assert.equal(decodePng(buf), recipientUrl.meeting);
  assert.equal(d.suggestedFilename(), 'fii-la-evenement.png');
  exportedMeeting = path;
});

await t('photo cochée par le propriétaire : entière (non recadrée), sans texte par-dessus ; QR toujours lisible', async () => {
  await O.locator('#v-photo').check();
  await O.waitForFunction(() => JSON.parse(document.getElementById('visual-preview').dataset.meta).includesPhoto === true);
  const meta = JSON.parse(await O.locator('#visual-preview').getAttribute('data-meta'));
  assert.ok(Math.abs(meta.photoRect.w / meta.photoRect.h - meta.photoAspect) < 0.01, 'photo recadrée ou déformée');
  assert.ok(meta.photoRect.y + meta.photoRect.h <= 250 + 520 + 0.5, 'photo hors de son cadre');
  assert.ok(meta.titleLines.length <= 2);
  assert.equal(meta.qr.overlapsContent, false);
  const dl = O.waitForEvent('download');
  await O.locator('#visual-download').click();
  const path = `${SHOTS}/social-${ENGINE}-export-rendez-vous-avec-photo.png`;
  await (await dl).saveAs(path);
  assert.equal(decodePng(readFileSync(path)), recipientUrl.meeting);
});

await t('TikTok : consigne du champ « Site web » (non garanti), formule neutre si le nom est masqué', async () => {
  await reveal(O, '#share-tiktok');
  await O.locator('#share-tiktok').click();
  await O.getByText('Ni l’image ni la légende d’une vidéo TikTok ne rendent le lien cliquable', { exact: false }).waitFor();
  await O.getByText('TikTok ne le propose pas à tous les comptes', { exact: false }).waitFor();
  await O.locator('#v-title').uncheck();
  await O.locator('#v-when').uncheck();
  await O.waitForFunction(() => /partagé avec Fii La/.test(document.getElementById('visual-preview').dataset.meta));
  const meta = JSON.parse(await O.locator('#visual-preview').getAttribute('data-meta'));
  assert.equal(meta.titleLines.join(' '), 'Un événement partagé avec Fii La');
  assert.ok(!meta.texts.some((x) => x.includes('Ndèye')), 'nom affiché malgré le choix');
  assert.ok(!meta.texts.some((x) => /heure de Dakar/.test(x)), 'date affichée malgré le choix');
});

await t('adresse et demande : titre neutre réellement appliqué, photo non incluse par défaut, nom du demandeur jamais exporté', async () => {
  const cases = { address: { name: 'Atelier Ndèye', neutral: 'Une adresse partagée avec Fii La' },
    request: { name: 'Livraison de votre commande', neutral: 'Une demande d’adresse Fii La' } };
  for (const kind of ['address', 'request']) {
    let meta = await openVisual(O, views[kind], 'instagram');
    assert.equal(meta.includesPhoto, false, 'photo incluse par défaut');
    if (kind === 'address') assert.equal(await O.locator('#v-photo').isChecked(), false);
    assert.ok(meta.texts.some((x) => x.includes(cases[kind].name.split(' ')[0])), 'nom absent alors qu’il est demandé');
    assert.ok(!meta.texts.join(' ').includes('Boutique Ndèye') && !meta.texts.join(' ').includes('CMD-9'), 'nom du demandeur ou référence exportés');
    await O.locator('#v-title').uncheck();
    await O.waitForFunction((n) => JSON.parse(document.getElementById('visual-preview').dataset.meta).titleLines.join(' ') === n, cases[kind].neutral);
    meta = JSON.parse(await O.locator('#visual-preview').getAttribute('data-meta'));
    const all = meta.texts.join(' | ');
    for (const word of [cases[kind].name, 'Ndèye', 'Boutique', 'CMD-9', 'Porte verte', 'Livraison']) assert.ok(!all.includes(word), 'donnée personnelle exportée : ' + word);
    assert.ok(!/#\/(m|demande|k|edit)\//.test(all + meta.qrText), 'URL de gestion ou privée dans l’image');
    const dl = O.waitForEvent('download');
    await O.locator('#visual-download').click();
    const path = `${SHOTS}/social-${ENGINE}-export-${kind}-neutre.png`;
    await (await dl).saveAs(path);
    assert.equal(decodePng(readFileSync(path)), recipientUrl[kind]);
  }
});

await t('adresse et demande : image avec le bon lien, sans réponse privée', async () => {
  for (const kind of ['address', 'request']) {
    const meta = await openVisual(O, views[kind], 'instagram');
    assert.equal(meta.qrText, recipientUrl[kind]);
    const dl = O.waitForEvent('download');
    await O.locator('#visual-download').click();
    const path = `${SHOTS}/social-${ENGINE}-export-${kind}.png`;
    await (await dl).saveAs(path);
    assert.equal(decodePng(readFileSync(path)), recipientUrl[kind]);
  }
});

await t('téléchargement direct impossible : image affichée avec la consigne « appui long »', async () => {
  const p = await newPhone({ init: () => { delete HTMLAnchorElement.prototype.download; } });
  await openVisual(p.page, views.address, 'instagram');
  await p.page.locator('#visual-download').click();
  await p.page.locator('#visual-fallback').getByText('appuyez longuement sur l’image', { exact: false }).waitFor();
  await p.page.locator('#visual-fallback img').waitFor();
  await p.ctx.close();
});

// ================================================================== 4. thème sombre, clavier, petit écran
await t('thème sombre : panneau et aperçu lisibles', async () => {
  const p = await newPhone({ dark: true });
  await openVisual(p.page, views.meeting, 'instagram');
  const c = await p.page.evaluate(() => [getComputedStyle(document.getElementById('privacy-note')).color, getComputedStyle(document.querySelector('.share-panel')).backgroundColor]);
  const lum = (s) => { const [r, g, b] = s.match(/\d+/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (Math.max(lum(c[0]), lum(c[1])) + 0.05) / (Math.min(lum(c[0]), lum(c[1])) + 0.05);
  assert.ok(ratio >= 4.5, 'contraste avertissement ' + ratio.toFixed(2));
  await shot(p.page, '02-panneau-dark');
  await p.ctx.close();
});

await t('clavier : Instagram / Story s’ouvre avec Entrée, focus visible', async () => {
  const p = await newPhone();
  await p.page.goto(URL0 + views.address);
  await p.page.locator('.share-panel').waitFor();
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { await p.page.keyboard.press('Tab'); ok = await p.page.evaluate(() => document.activeElement && document.activeElement.id === 'share-instagram'); }
  assert.ok(ok, 'bouton non atteint');
  assert.notEqual(await p.page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
  await p.page.keyboard.press('Enter');
  await p.page.locator('#visual-preview').waitFor();
  assert.equal(await p.page.locator('#share-instagram').getAttribute('aria-expanded'), 'true');
  await p.ctx.close();
});

await t('320 px : panneau sans débordement horizontal', async () => {
  const p = await newPhone({ viewport: { width: 320, height: 640 } });
  await openVisual(p.page, views.meeting, 'instagram');
  const over = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'débordement ' + over);
  await shot(p.page, '03-panneau-320');
  await p.ctx.close();
});

// ================================================================== 5. destinations désactivées / expirées
await t('lien désactivé ou rendez-vous expiré [SIMULÉ temps] : plus de panneau de partage ni d’image', async () => {
  await O.goto(URL0 + views.address);
  await O.locator('#revoke').click();
  await O.getByText('Lien désactivé', { exact: true }).waitFor();
  assert.equal(await O.locator('.share-panel, #share-instagram').count(), 0);
  await local.db.query(`update fiila.places set starts_at = now() - interval '3 days', expires_at = now() - interval '1 day' where id = $1`, [meet.id]);
  await O.goto(URL0 + views.meeting);
  await O.getByText('Cet événement a expiré', { exact: false }).waitFor();
  assert.equal(await O.locator('.share-panel, #share-instagram').count(), 0);
  const p = await newPhone({ owned: false });
  await p.page.goto(recipientUrl.address);
  await p.page.getByText('Ce lien a été désactivé').waitFor();
  await p.page.goto(recipientUrl.meeting); await p.page.reload();
  await p.page.getByText('Cet événement est terminé').waitFor();
  await p.ctx.close();
});

// ================================================================== 6. mesure
await t('mesure : canal choisi, lien copié et image exportée distingués ; rien de privé', async () => {
  await O.goto(URL0 + views.request);
  await reveal(O, '#share-facebook-copy');
  for (const id of ['share-telegram', 'share-facebook-copy']) {
    const [popup] = await Promise.all([O.waitForEvent('popup', { timeout: 4000 }).catch(() => null), O.locator('#' + id).click()]);
    if (popup) await popup.close().catch(() => {});
  }
  if (ENGINE === 'chromium') { await O.locator('#copy-request').click(); await O.getByText('Lien copié.').waitFor(); }
  await O.waitForTimeout(500);
  const ev = O.__tracks.map((x) => x.p_event + ':' + x.p_variant);
  for (const k of ['share_initiated:instagram_meeting', 'share_initiated:tiktok_meeting', 'visual_exported:download_meeting', 'share_initiated:telegram_request', 'share_initiated:facebook_request'])
    assert.ok(ev.includes(k), 'manque ' + k);
  if (ENGINE === 'chromium') assert.ok(ev.includes('link_copied:request'));
  assert.ok(!ev.some((e) => /publi|sent|envoy|view|arriv/.test(e)), 'événement non vérifiable');
  for (const b of O.__tracks) { assert.deepEqual(Object.keys(b).sort(), ['p_event', 'p_variant']); for (const s of SECRETS) assert.ok(!JSON.stringify(b).includes(s)); }
  const m = await local.db.query(`select event, variant, n::int from fiila.metrics order by 1, 2`);
  writeFileSync(`docs/social-metrics-local-${ENGINE}.json`, JSON.stringify(m.rows, null, 2));
  assert.ok(m.rows.some((r) => r.event === 'visual_exported'));
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(O.__errors, []); });

for (const o of OWNED) await rpc(local.db, o.type === 'request' ? 'fiila_delete_request' : 'fiila_delete_place', { p_id: o.id, p_owner: o.owner });
await browser.close();
local.server.close();
const report = { moteur: ENGINE, version, mode: 'automatisation Playwright, émulation iPhone 13, base locale ; aucune publication sur un réseau social',
  date: new Date().toISOString(), reussis: results.filter((r) => r.ok).length, total: results.length, results };
writeFileSync(`docs/social-test-report-${ENGINE}.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.reussis}/${report.total} tests partage social réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
