// Ma boutique (22/10/2026) : accueil du commerçant (« Ma boutique » + Commandes, Articles, Marketing, Clients), onglet
// Marketing (statistiques par période, partage de la vitrine, QR code, réseaux) et réseaux affichés sur la vitrine.
// Chromium (ou ENGINE=webkit), iPhone 13, vrai Postgres local (PGlite). Données synthétiques.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/marketing';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url.replace(/\/?$/, '/');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const pages = [];
async function newPhone(shop, opts = {}) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (shop) await ctx.addInitScript((x) => { localStorage.setItem('fiila.shop', JSON.stringify(x)); }, { id: shop.shop.id, key: shop.key });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Atelier Marketing (test)', business_type: 'mode' } });
const A = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe Ndella (test)', price: 12000 } });
const SLUG = (await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } })).slug;
// Photo 4:5 de l'article (image de la marque Fii, recadrée) : pour un aperçu réaliste de « Publier ».
await local.db.query(`update fiila.products set photo = $2, photo_type = 'image/jpeg' where id = $1`, [A.id, readFileSync('tests/fixtures/article-4x5.jpg')]);
await ok('fiila_vitrine', { p_slug: SLUG });
await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: A.id, qty: 2 }], customer: { name: 'Awa (test)', phone: '770000011' } } });
const P = await newPhone(S);

await t('accueil du commerçant : « Ma boutique » en action principale, puis Commandes (en cours), Articles, Marketing, Clients', async () => {
  await P.goto(URL0 + '#/');
  const hero = P.locator('#home-hero[data-hero="boutique"]');
  await hero.waitFor();
  assert.equal(await hero.locator('b').textContent(), 'Ma boutique');
  await P.locator('#home-shop-sub').getByText('Atelier Marketing (test) · 1 commande en cours').waitFor();
  assert.deepEqual(await P.locator('#my-shop .ttile .pro-name').allTextContents(), ['Commandes', 'Articles', 'Marketing', 'Clients']);
  await P.locator('#biz-orders-n').getByText('1').waitFor();
  assert.equal(await P.locator('#act-boutique').count(), 0, 'la boutique n’est pas répétée dans « Mes activités »');
  assert.ok(await noOverflow(P));
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-01-accueil.png` });
  await P.click('#biz-orders');
  await P.locator('#orders .order-row').first().waitFor();
  assert.equal(await P.locator('#tab-orders').getAttribute('aria-current'), 'page');
});

await t('barre de la boutique : 5 onglets lisibles (Commandes, Articles, Marketing, Clients, Réglages), sans débordement', async () => {
  assert.deepEqual((await P.locator('.tabbar .tab').allTextContents()).map((x) => x.trim()), ['Commandes', 'Articles', 'Marketing', 'Clients', 'Réglages']);
  const boxes = await P.locator('.tabbar .tab').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, e.scrollWidth <= e.clientWidth + 1]; }));
  assert.ok(boxes.every((b) => b[2]), 'aucun libellé coupé');
  assert.ok(boxes[4][1] <= 390, 'le dernier onglet tient dans l’écran');
  assert.ok(await noOverflow(P));
});

await t('Marketing : chiffres de la période, comparaison, panier moyen ; changement de période sans rechargement', async () => {
  await P.click('#tab-marketing');
  await P.locator('#mk-revenue').waitFor();
  assert.equal(await P.locator('#tab-marketing').getAttribute('aria-current'), 'page');
  assert.match(await P.locator('#mk-revenue').textContent(), /^Ventes.*24\s000\sFCFA/);
  await P.locator('#mk-revenue svg.mk-spark').waitFor();
  assert.match(await P.locator('#mk-orders').textContent(), /^Commande1/);
  assert.match(await P.locator('#mk-views').textContent(), /^Visite1/);
  assert.match(await P.locator('#mk-line').textContent(), /Panier moyen24\s000\sFCFA.*Via le site1/);
  // Publier : une carte par article, les plus vendus d'abord.
  assert.equal(await P.locator('#mk-strip .pub-card').first().getAttribute('id'), 'mk-pub-' + A.id);
  await P.locator('#mk-period').getByText('7 jours').click();
  await P.waitForFunction(() => location.hash === '#/boutique/marketing?p=7');
  await P.locator('#mk-revenue').waitFor();
  assert.equal(await P.locator('#mk-period input:checked').getAttribute('value'), '7');
  // Une seule action principale (toucher un article pour le publier), aucun grand bouton concurrent, une seule rangée de filtres (règle 7).
  assert.equal(await P.locator('#app .btn.big').count(), 0);
  assert.equal(await P.locator('#app .segfield').count(), 1);
  assert.ok(await noOverflow(P));
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-02-marketing.png`, fullPage: true });
});

await t('Publier : une carte par article, logos des réseaux en couleur ; un toucher = image au bon format + texte ; repli sans partage', async () => {
  await P.goto(URL0 + '#/boutique/marketing'); await P.locator('#mk-strip').waitFor();
  const card = P.locator('#mk-pub-' + A.id);
  assert.match(await card.textContent(), /Robe Ndella \(test\)12\s000\sFCFA2 vendus/);
  assert.deepEqual(await card.locator('.pub-net').evaluateAll((b) => b.map((x) => x.dataset.net)), ['instagram', 'facebook', 'whatsapp', 'tiktok', 'snapchat']);
  const bg = await card.locator('.pub-net[data-net="facebook"]').evaluate((b) => getComputedStyle(b).backgroundColor);
  assert.equal(bg, 'rgb(24, 119, 242)', 'Facebook dans sa couleur');
  await P.waitForFunction((id) => document.getElementById('mk-pub-' + id).classList.contains('ready'), A.id);
  await P.evaluate(() => {
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared.push({ text: d.text, files: (d.files || []).map((f) => f.name + '|' + f.type) }); return Promise.resolve(); } });
  });
  const posts0 = (await local.db.query(`select count(*)::int n from fiila.posts where product_id = $1`, [A.id])).rows[0].n;
  await P.click('#pub-instagram-' + A.id);
  await P.getByText(/Texte copié : collez-le dans Instagram/).waitFor();
  await P.click('#pub-whatsapp-' + A.id);
  const sh = await P.evaluate(() => window.__shared);
  assert.match(sh[0].files[0], /^robe-ndella-test\.jpg\|image\/jpeg$/, 'Instagram : publication 4:5');
  assert.match(sh[1].files[0], /^robe-ndella-test-story\.jpg\|image\/jpeg$/, 'statut WhatsApp : 9:16');
  assert.match(sh[0].text, /Robe Ndella \(test\)[\s\S]*12\s000 FCFA[\s\S]*Pour commander : .*#\/b\//);
  await P.waitForTimeout(600);
  assert.equal((await local.db.query(`select count(*)::int n from fiila.posts where product_id = $1`, [A.id])).rows[0].n, posts0 + 2, 'publications comptées');
  await card.scrollIntoViewIfNeeded();
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-06-publier-cartes.png` });
  // Ordinateur (pas de partage de fichiers) : image à enregistrer, texte à copier, réseau à ouvrir.
  await P.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }); });
  await P.click('#pub-tiktok-' + A.id);
  await P.locator('#pub-sheet').waitFor();
  assert.match(await P.locator('#post-download').getAttribute('href'), /^data:image\/jpeg/);
  assert.equal(await P.locator('#post-open').getAttribute('href'), 'https://www.tiktok.com/');
  await P.locator('#post-caption').getByText(/Robe Ndella/).waitFor();
  await P.waitForTimeout(400);
  await P.screenshot({ path: `${SHOTS}/${ENGINE}-07-publier-repli.png` });
  await P.click('#pub-close');
  const m = (await local.db.query(`select variant, sum(n)::int n from fiila.metrics where event = 'marketing' and variant like 'publish:%' group by 1`)).rows;
  const by = Object.fromEntries(m.map((x) => [x.variant, x.n]));
  assert.ok(by['publish:instagram'] >= 1 && by['publish:whatsapp'] >= 1 && by['publish:tiktok'] >= 1 && by['publish:shared'] >= 2 && by['publish:saved'] >= 1, JSON.stringify(by));
});

await t('partage de la vitrine : WhatsApp avec le lien, copie, QR code à imprimer, aperçu', async () => {
  const href = await P.locator('#mk-share-wa').getAttribute('href');
  const text = decodeURIComponent(new URL(href).searchParams.get('text'));
  assert.ok(text.includes('#/b/' + SLUG), text);
  await P.click('#mk-qr-btn');
  await P.waitForFunction(() => { const i = document.getElementById('mk-qr-img'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await P.locator('#mk-qr-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(await P.locator('#mk-vitrine').getAttribute('href'), '#/b/' + SLUG);
});

await t('réseaux : saisie « @nom » ou lien, refus clair d’une valeur invalide, affichage sur la vitrine', async () => {
  await P.click('#mk-social-instagram');
  await P.locator('#mk-socials-sheet').waitFor();
  await P.fill('#mk-in-instagram', 'mon compte !');
  await P.click('#mk-socials-save');
  await P.locator('#mk-socials-sheet [role="alert"]').getByText(/Identifiant non reconnu/).waitFor();
  await P.fill('#mk-in-instagram', '@atelier.test');
  await P.fill('#mk-in-tiktok', 'https://www.tiktok.com/@atelier_test');
  await P.click('#mk-socials-save');
  await P.locator('#mk-socials-sheet').waitFor({ state: 'detached' });
  assert.equal(await P.locator('#mk-social-instagram .mk-handle').textContent(), '@atelier.test');
  assert.equal(await P.locator('#mk-social-tiktok .mk-handle').textContent(), '@atelier_test');
  assert.equal(await P.locator('#mk-social-facebook .mk-handle').textContent(), 'Ajouter');
  const V = await newPhone(null);
  await V.goto(URL0 + '#/b/' + SLUG);
  await V.locator('#vitrine-socials').waitFor();
  assert.deepEqual(await V.locator('#vitrine-socials a').evaluateAll((a) => a.map((x) => x.href)),
    ['https://www.instagram.com/atelier.test', 'https://www.tiktok.com/@atelier_test']);
  await V.locator('#vitrine-socials').scrollIntoViewIfNeeded();
  await V.screenshot({ path: `${SHOTS}/${ENGINE}-03-vitrine-reseaux.png` });
  assert.deepEqual(V.__errors, []);
});

await t('mode sombre : accueil et Marketing lisibles, aucune erreur', async () => {
  const D = await newPhone(S, { dark: true });
  await D.goto(URL0 + '#/');
  await D.locator('#my-shop').waitFor();
  await D.screenshot({ path: `${SHOTS}/${ENGINE}-04-accueil-sombre.png` });
  await D.goto(URL0 + '#/boutique/marketing');
  await D.locator('#mk-revenue').waitFor();
  await D.screenshot({ path: `${SHOTS}/${ENGINE}-05-marketing-sombre.png`, fullPage: true });
  assert.deepEqual(D.__errors, []);
  assert.deepEqual(P.__errors, []);
});

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests Ma boutique / Marketing (${ENGINE}) réussis`);
process.exit(failed ? 1 : 0);
