// Navigation de bout en bout : chaque écran de la plateforme (propriétaire, boutique, livreur, pages reçues, erreurs)
// offre une sortie (bouton retour ou logo vers l'accueil), sans texte cassé, sans débordement à 360 px, sans erreur JS.
// Puis parcours enchaînés : la flèche de retour ramène à l'écran précédent.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };

// ---------- données de test
const addr = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez Awa (test)', locality: 'Ouakam', instruction: 'Portail vert [TEST]', entry: { lat: 14.72, lng: -17.48 }, vehicle_ok: true } });
const meet = await ok('fiila_create_place', { p: { kind: 'meeting', label: 'Baptême (test)', instruction: 'Salle [TEST]', entry: { lat: 14.7, lng: -17.4 }, vehicle_ok: true,
  starts_at: new Date(Date.now() + 864e5).toISOString(), expires_at: new Date(Date.now() + 2 * 864e5).toISOString() } });
const req = await ok('fiila_create_request', { p: { requester_name: 'Boutique Ndèye (test)', purpose: 'Livraison', order_ref: 'CMD-1' } });
const shop = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Awa (test)', phone: '77 100 00 01' } });
const prod = await ok('fiila_product_save', { p_key: shop.key, p: { name: 'Robe (test)', price: 15000 } });
const order = await ok('fiila_order_create', { p_key: shop.key, p: { customer: { name: 'Fatou (test)', phone: '70 000 00 01' }, items: [{ label: 'Robe', qty: 1, price: 15000 }] } });
const custId = (await local.db.query(`select id from fiila.customers limit 1`)).rows[0].id;
const vit = await ok('fiila_shop_vitrine', { p_key: shop.key, p: { public: true } });
const courier = await ok('fiila_courier_register', { p: { name: 'Ibou (test)', phone: '76 300 00 03' } });
const invite = await ok('fiila_courier_invite', { p_key: shop.key, p_name: 'Moussa', p_phone: '76 000 00 00' });
const deliv = await ok('fiila_start_delivery', { p_kind: 'place', p_id: addr.id, p_owner: addr.owner_token });
const refc = (await ok('fiila_referral_me', { p_for: 'shop', p_key: shop.key })).referrer.code;
const BAD = 'x'.repeat(22);

const OWNED = [
  { type: 'place', kind: 'address', id: addr.id, owner: addr.owner_token, share: addr.share_token, label: 'Chez Awa (test)' },
  { type: 'place', kind: 'meeting', id: meet.id, owner: meet.owner_token, share: meet.share_token, label: 'Baptême (test)' },
  { type: 'request', id: req.id, owner: req.owner_token, label: 'Livraison' }];
async function phone(withOwner) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 1, isMobile: ENGINE === 'chromium', hasTouch: true,
    locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  if (withOwner) await ctx.addInitScript(([o, s, c]) => {
    if (!localStorage.getItem('fiila.owned')) {
      localStorage.setItem('fiila.owned', JSON.stringify(o)); localStorage.setItem('fiila.shop', JSON.stringify(s)); localStorage.setItem('fiila.courier', JSON.stringify(c));
    }
  }, [OWNED, { id: shop.shop.id, key: shop.key }, { key: courier.key }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  return page;
}

const OWNER_ROUTES = ['#/new', '#/edit/' + addr.id, '#/m/' + addr.id, '#/m/' + meet.id, '#/demande/nouvelle', '#/demande/' + req.id,
  '#/rdv/nouveau', '#/rdv/modifier/' + meet.id, '#/cle', '#/compte', '#/boutique', '#/boutique/reglages', '#/boutique/articles',
  '#/boutique/article/nouveau', '#/boutique/article/' + prod.id, '#/clients', '#/clients/' + custId, '#/commande/nouvelle', '#/commande/' + order.id,
  '#/livreur', '#/livreur/invitation/' + invite.token, '#/parrainer', '#/parrainer?pour=boutique', '#/parrainer?pour=livreur', '#/stats', '#/confidentialite', '#/boutiques',
  '#/m/00000000-0000-0000-0000-000000000000', '#/page-inconnue'];
const PUBLIC_ROUTES = ['#/a/' + addr.share_token, '#/a/' + meet.share_token, '#/d/' + req.share_token, '#/f/' + order.share_token,
  '#/l/' + deliv.courier_token, '#/s/' + deliv.watch_token, '#/b/' + vit.slug, '#/a/' + BAD, '#/d/' + BAD, '#/f/' + BAD, '#/l/' + BAD, '#/s/' + BAD,
  '#/b/nexiste-pas', '#/k/p.x.y'];

async function check(page, hash) {
  await page.goto(URL0 + '#/'); await page.locator('.hero').waitFor();
  await page.goto(URL0 + hash);
  await page.waitForFunction(() => { const w = document.querySelector('#app > .wrap'); return w && !w.querySelector(':scope > .loading') && w.textContent.trim().length > 20; });
  await page.waitForTimeout(250);
  const info = await page.evaluate(() => {
    const w = document.querySelector('#app > .wrap');
    const back = w.querySelector('.back, .bar-back');
    const logo = w.querySelector('.brand-bar a.brand-home');
    return { auto: !!w.querySelector('.auto-back'), back: back ? (back.getAttribute('href') || 'history') : null, logo: !!logo, text: w.innerText,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth, hash: location.hash };
  });
  if (process.env.DEBUG && info.auto) console.log('    (retour ajouté automatiquement)', hash.slice(0, 40));
  assert.ok(info.back || info.logo, 'aucune sortie (ni retour, ni logo)');
  if (info.back && info.back !== 'history') assert.notEqual(info.back, info.hash.split('?')[0], 'le retour pointe sur la page elle-même');
  const bad = info.text.match(/\bundefined\b|\bNaN\b|\[object \w+\]|\bnull\b/);
  assert.equal(bad, null, 'texte cassé : ' + (bad && bad[0]));
  assert.ok(info.over <= 0, 'débordement horizontal de ' + info.over + ' px');
  return info;
}

const P = await phone(true);
for (const r of OWNER_ROUTES) await t('sortie et affichage : ' + r.replace(/[0-9a-f-]{36}|[A-Za-z0-9_-]{20,}/g, '…'), async () => { await check(P, r); });
const V = await phone(false);
for (const r of PUBLIC_ROUTES) await t('page reçue : ' + r.replace(/[0-9a-f-]{36}|[A-Za-z0-9_-]{20,}/g, '…'), async () => { await check(V, r); });
await t('lien de parrainage : ramène à l’accueil avec le bandeau', async () => {
  await V.goto(URL0 + '#/r/' + refc);
  await V.locator('#invite-banner').waitFor();
  assert.ok(V.url().endsWith('#/'));
});

await t('parcours enchaîné : accueil → boutique → article → retour → retour', async () => {
  await P.goto(URL0 + '#/'); await P.locator('.hero').waitFor();
  await P.locator('#shop-link').click(); await P.locator('#shop-title').waitFor();
  await P.locator('#tab-products').click(); await P.getByRole('heading', { name: 'Mes articles' }).waitFor();
  await P.locator('#products a').first().click(); await P.getByRole('heading', { name: 'Modifier l’article' }).waitFor();
  await P.locator('.back').first().click(); await P.getByRole('heading', { name: 'Mes articles' }).waitFor();
});

await t('parcours vitrine → facture : la flèche de l’en-tête revient à la vitrine', async () => {
  const C = await phone(false);
  await C.goto(URL0 + '#/b/' + vit.slug);
  await C.locator('[data-add]').first().click();
  await C.locator('#cart-go').click();
  await C.getByRole('heading', { name: 'Votre commande' }).waitFor();
  await C.fill('#v-name', 'Coumba (test)'); await C.fill('#v-phone', '70 000 00 07');
  await C.click('#order-send');
  await C.locator('#order-sent').waitFor();
  await C.locator('.brand-bar .bar-back').click();
  await C.locator('#vitrine-products').waitFor();
});

await t('page reçue ouverte directement (depuis WhatsApp) : pas de flèche, logo vers l’accueil', async () => {
  const C = await phone(false);
  await C.goto(URL0 + '#/a/' + addr.share_token);
  await C.getByRole('link', { name: 'Y aller' }).waitFor();
  assert.equal(await C.locator('.bar-back').count(), 0);
  await C.locator('.brand-home').click();
  await C.locator('.hero').waitFor();
});

await t('« Événement » : tuile et exemples sur l’accueil ; un toucher sur un type remplit le nom', async () => {
  await P.goto(URL0 + '#/');
  await P.getByRole('link', { name: 'Créer un événement' }).waitFor();
  assert.match(await P.locator('#event-hint').textContent(), /mariage, baptême/);
  await P.getByRole('link', { name: 'Créer un événement' }).click();
  await P.getByRole('heading', { name: 'Créer un événement' }).waitFor();
  await P.locator('#ev-types').getByText('Baptême').click();
  assert.equal(await P.locator('#m-label').inputValue(), 'Baptême de ');
  await P.locator('#m-label').fill('Baptême de Awa');
  await P.locator('#ev-types').getByText('Mariage').click();
  assert.equal(await P.locator('#m-label').inputValue(), 'Mariage de Awa', 'le reste du nom est gardé');
  assert.equal(await P.locator('#ev-types .ev-type.on').textContent(), 'Mariage');
  await P.evaluate(() => localStorage.removeItem('fiila.draft.meeting'));
});

await t('« Installer l’app » : visible sur l’accueil, explique les étapes, se masque', async () => {
  await P.goto(URL0 + '#/');
  await P.locator('#install-app').waitFor();
  await P.locator('#mes-adresses').waitFor();
  const order = await P.evaluate(() => [...document.querySelectorAll('#create-address, #install-cta, #mes-adresses')].map((e) => e.id));
  assert.deepEqual(order, ['create-address', 'install-cta', 'mes-adresses']);
  await P.locator('#install-app').click();
  await P.locator('#install-sheet').waitFor();
  assert.equal(await P.locator('#install-sheet .spic').count(), 3);
  await P.waitForTimeout(500);
  await P.screenshot({ path: 'docs/screenshots/installer-app.png' });
  await P.locator('#install-sheet-close').click();
  assert.equal(await P.locator('#install-sheet').count(), 0);
  await P.locator('#install-cta .install-x').click();
  assert.equal(await P.locator('#install-app').count(), 0, 'masqué');
  await P.evaluate(() => localStorage.removeItem('fiila.install.hide'));
  // iPhone (Safari) : les 3 étapes de l’écran d’accueil
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: ENGINE === 'chromium', hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const I = await ctx.newPage();
  await I.goto(URL0 + '#/');
  await I.locator('#install-app').click();
  await I.getByText('Touchez le bouton Partager').waitFor();
  await I.getByText('Choisissez « Sur l’écran d’accueil »').waitFor();
  await ctx.close();
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual([...P.__errors, ...V.__errors], []); });

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests navigation réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
