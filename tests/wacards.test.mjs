// Mandat WHATSAPP-001, lot 1 : carte pilote « Indiquer mon entrée » (demande d'adresse).
// Le message nomme le vrai demandeur, garde le lien destinataire (jamais la clé de gestion) ; l'image de marque part AVEC le
// texte quand le téléphone sait partager un fichier [SIMULÉ partage de fichier], sinon lien WhatsApp texte + « Télécharger
// l'image ». Réglage wa_card_media = 0 → texte seul. Page d'arrivée : entrée courte, coupée si « réduire les animations ».
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
const SHOTS = 'docs/screenshots/whatsapp-pilote';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const pages = [];
async function newPhone(init, extra) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block', ...(extra || {}) });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(500); return page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true }); };
const metric = async (v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = 'wa_card' and variant = $1`, [v])).rows[0].n);

const REQ = await ok('fiila_create_request', { p: { requester_name: 'Boutique Ndèye (test)', purpose: 'Livraison de votre commande', order_ref: 'CMD-77' } });
const recipientUrl = '#/d/' + REQ.share_token;
const OWN = `localStorage.setItem('fiila.owned', JSON.stringify([{ type: 'request', id: ${JSON.stringify(REQ.id)}, owner: ${JSON.stringify(REQ.owner_token)}, share: ${JSON.stringify(REQ.share_token)}, label: 'Livraison (test)', created: Date.now() }]))`;
// Téléphone qui sait partager un fichier : on garde ce qui est passé à navigator.share. __mode : 'ok' | 'cancel' | 'deny'.
const FILE_SHARE = OWN + `;window.__shared = []; window.__mode = 'ok';
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!(d && d.files && d.files.length) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => {
    if (window.__mode === 'cancel') return Promise.reject(new DOMException('annulé', 'AbortError'));
    if (window.__mode === 'deny') return Promise.reject(new DOMException('refusé', 'NotAllowedError'));
    return Promise.all((d.files || []).map((f) => f.arrayBuffer().then((b) => ({ name: f.name, type: f.type, size: b.byteLength }))))
      .then((files) => { window.__shared.push({ text: d.text, url: d.url, files }); });
  } });`;
// Téléphone (ou ordinateur) sans partage de fichier.
const NO_FILE_SHARE = OWN + `;Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });`;

await t('message : le vrai demandeur, le motif, une seule action et le lien destinataire — jamais la clé de gestion', async () => {
  const P = await newPhone(NO_FILE_SHARE);
  await P.goto(URL0 + '#/demande/' + REQ.id);
  await P.locator('#wa-card').waitFor();
  await P.waitForFunction(() => document.querySelector('#wa-card').naturalWidth > 0);
  assert.deepEqual(await P.evaluate(() => [document.querySelector('#wa-card').naturalWidth, document.querySelector('#wa-card').naturalHeight]), [1200, 800]);
  const msg = decodeURIComponent((await P.locator('#share-whatsapp').getAttribute('href')).split('?text=')[1]);
  assert.match(msg, /^Bonjour,\nBoutique Ndèye \(test\) vous demande votre adresse pour : Livraison de votre commande \(réf\. CMD-77\)\./);
  assert.match(msg, /Indiquer mon entrée :\n.*#\/d\//);
  assert.ok(msg.includes(recipientUrl), 'lien destinataire');
  assert.ok(!msg.includes(REQ.owner_token), 'clé de gestion absente du message');
  assert.match(msg, /Votre adresse sert uniquement à cette demande\.$/);
  assert.equal((msg.match(/https?:\/\//g) || []).length, 1, 'une seule action (un seul lien)');
  await shot(P, '01-demande-carte');
  assert.deepEqual(P.__errors, []);
});

await t('sans partage de fichier : WhatsApp en texte, « Télécharger l’image » ; mesures texte et téléchargement', async () => {
  const P = pages[0];
  await P.locator('#wa-card-download').waitFor();
  assert.equal(await P.locator('#wa-text-only').count(), 0);
  assert.equal(await P.locator('#wa-card-download').getAttribute('download'), 'fii-demande-adresse.jpg');
  const [dl] = await Promise.all([P.waitForEvent('download'), P.click('#wa-card-download')]);
  assert.equal(dl.suggestedFilename(), 'fii-demande-adresse.jpg');
  await P.click('#share-whatsapp');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await metric('request:download'), 1);
  assert.equal(await metric('request:text'), 1);
});

await t('partage de fichier [SIMULÉ] : l’image JPEG et le texte partent ensemble ; annuler ne dit rien ; échec → message clair', async () => {
  const P = await newPhone(FILE_SHARE);
  await P.goto(URL0 + '#/demande/' + REQ.id);
  await P.locator('#wa-text-only').waitFor(); // le fichier est prêt : repli « texte seul »
  await P.click('#share-whatsapp');
  await P.waitForFunction(() => window.__shared.length === 1);
  const s = await P.evaluate(() => window.__shared[0]);
  assert.equal(s.files.length, 1);
  assert.equal(s.files[0].name, 'fii-demande-adresse.jpg');
  assert.equal(s.files[0].type, 'image/jpeg');
  assert.ok(s.files[0].size > 50000, 'image complète');
  assert.ok(s.text.includes(recipientUrl) && s.text.includes('Boutique Ndèye (test)'));
  assert.equal(await metric('request:file'), 1);
  await P.evaluate(() => { window.__mode = 'cancel'; });
  await P.click('#share-whatsapp');
  await P.waitForTimeout(400);
  assert.equal(await P.locator('#toast').isVisible(), false, 'rien après une annulation');
  await P.evaluate(() => { window.__mode = 'deny'; });
  await P.click('#share-whatsapp');
  await P.getByText('Envoi avec l’image impossible ici. Touchez « Envoyer le texte seul ».').waitFor();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await metric('request:failed'), 1);
  const alt = decodeURIComponent((await P.locator('#wa-text-only').getAttribute('href')).split('?text=')[1]);
  assert.ok(alt.includes(recipientUrl));
  assert.deepEqual(P.__errors, []);
});

await t('réglage wa_card_media = 0 : texte seul, pas d’image', async () => {
  await local.db.query(`update fiila.settings set value = '0' where key = 'wa_card_media'`);
  const P = await newPhone(FILE_SHARE);
  await P.goto(URL0 + '#/demande/' + REQ.id);
  await P.locator('#share-whatsapp').waitFor();
  await P.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('fiila.flags')).v.wa_card === false; } catch (e) { return false; } });
  await P.reload();
  await P.locator('#share-whatsapp').waitFor();
  assert.equal(await P.locator('#wa-card').count(), 0);
  assert.match(await P.locator('#share-whatsapp').getAttribute('href'), /^https:\/\/wa\.me\/\?text=/);
  await local.db.query(`update fiila.settings set value = '1' where key = 'wa_card_media'`);
});

await t('page d’arrivée du client : le demandeur en titre, entrée courte ; aucune animation si « réduire les animations »', async () => {
  const P = await newPhone();
  await P.goto(URL0 + recipientUrl);
  await P.locator('#request-arrive').getByText('Boutique Ndèye (test) vous demande votre adresse').waitFor();
  assert.match(await P.locator('#request-arrive').evaluate((e) => getComputedStyle(e).animationName), /fiila-arrive/);
  await shot(P, '02-arrivee-client');
  const R = await newPhone(null, { reducedMotion: 'reduce' });
  await R.goto(URL0 + recipientUrl);
  await R.locator('#request-arrive').waitFor();
  assert.equal(await R.locator('#request-arrive').evaluate((e) => getComputedStyle(e).animationName), 'none');
  assert.equal(await local.db.query(`select fulfilled_at from fiila.requests where id = $1`, [REQ.id]).then((r) => r.rows[0].fulfilled_at), null, 'ouvrir ne change rien');
  assert.deepEqual([...P.__errors, ...R.__errors], []);
});

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests carte WhatsApp (${ENGINE}) réussis`);
process.exit(failed ? 1 : 0);
