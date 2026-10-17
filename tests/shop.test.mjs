// Comptes, carnet d'adresses et boutique (Rali dans Fii La), de bout en bout.
// Chromium (ou ENGINE=webkit), émulation iPhone 13, vrai Postgres local (PGlite) + émulation de Supabase Auth.
// Simulations : [SIMULÉ AUTH] inscription et connexion par le serveur de test ; [SIMULÉ GPS] position du livreur.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const { PNG } = require('pngjs');
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/boutique';
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
const ENTRY = { lat: 14.758140, lng: -17.470320 };
const FAR = { latitude: 14.7167, longitude: -17.4677 };
const pages = [];
async function newPhone(opts = {}) {
  const ctx = await browser.newContext({
    viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', timezoneId: 'Africa/Dakar', serviceWorkers: 'block', colorScheme: opts.dark ? 'dark' : 'light',
    geolocation: { ...FAR, accuracy: 12 }, permissions: ['geolocation'],
  });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (opts.fakeGeo) await ctx.addInitScript((start) => {
    const subs = new Map(); let n = 0; const cur = start;
    const pos = () => ({ coords: { latitude: cur.latitude, longitude: cur.longitude, accuracy: 10 }, timestamp: Date.now() });
    navigator.geolocation.watchPosition = (ok) => { n++; subs.set(n, ok); setTimeout(() => ok(pos()), 50); return n; };
    navigator.geolocation.clearWatch = (id) => subs.delete(id);
  }, FAR);
  if (opts.owned) await ctx.addInitScript((o) => { if (!localStorage.getItem('fiila.owned')) localStorage.setItem('fiila.owned', JSON.stringify(o)); }, opts.owned);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('dialog', (d) => d.dismiss());
  pages.push(page);
  return { ctx, page };
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
const waHref = async (page, sel) => page.locator(sel).getAttribute('href');
const waText = (href) => decodeURIComponent(new URL(href).searchParams.get('text'));
function pngFile() {
  const png = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 30; png.data[i + 1] = 74; png.data[i + 2] = 52; png.data[i + 3] = 255; }
  return { name: 'avatar.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };
}

// ------------------------------------------------------------------ données synthétiques
const EMAIL = 'commercant.test@example.invalid', PASS = 'motdepasse-test-1';
const before = await ok('fiila_create_place', { p: { kind: 'address', label: 'Atelier (test)', entry: ENTRY, vehicle_ok: true, instruction: 'Porte grise [TEST]' } });
const clientPlace = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez la cliente (test)', entry: ENTRY, vehicle_ok: true, instruction: 'Portail bleu [TEST]' } });

// ------------------------------------------------------------------ compte
const A = await newPhone({ owned: [{ type: 'place', kind: 'address', id: before.id, owner: before.owner_token, share: before.share_token, label: 'Atelier (test)' }] });
const M = A.page;

await t('accueil sans compte : « Se connecter » et « Ma boutique » visibles, rien n’est imposé', async () => {
  await M.goto(URL0);
  await M.getByRole('link', { name: 'Se connecter' }).waitFor();
  await M.getByRole('link', { name: 'Ma boutique' }).waitFor();
  await M.getByRole('link', { name: 'Créer mon adresse' }).waitFor();
});

await t('inscription : compte créé, fiche du téléphone rattachée, nom affiché sur l’accueil', async () => {
  await M.getByRole('link', { name: 'Se connecter' }).click();
  await M.getByRole('tab', { name: 'Créer un compte' }).click();
  await M.fill('#acc-name', 'Awa Test');
  await M.fill('#acc-email', EMAIL);
  await M.fill('#acc-pass', 'court');
  await M.click('#auth-submit');
  await M.getByText('8 caractères au moins').first().waitFor();
  await M.fill('#acc-pass', PASS);
  await shot(M, '01-inscription');
  await M.click('#auth-submit');
  await M.getByText(/Compte créé\. 1 fiche de ce téléphone rattachée/).waitFor();
  await M.locator('#account-link').getByText('Awa Test').waitFor();
  const r = await local.db.query('select p.user_id is not null as linked from fiila.places p where p.id = $1', [before.id]);
  assert.equal(r.rows[0].linked, true);
});

await t('profil : téléphone et photo enregistrés ; mauvais numéro refusé', async () => {
  await M.goto(URL0 + '#/compte');
  await M.locator('#me-email').getByText(EMAIL).waitFor();
  await M.fill('#me-phone', 'pas un numéro');
  await M.click('#me-save');
  await M.getByText('Numéro de téléphone non valide.').waitFor();
  await M.fill('#me-phone', '77 000 00 00');
  await M.click('#me-save');
  await M.getByText('Profil enregistré.').waitFor();
  await M.setInputFiles('#avatar-in', pngFile());
  await M.getByText('Photo enregistrée.').waitFor();
  await M.locator('.avatar-box img.avatar').waitFor();
  await shot(M, '02-profil');
});

await t('carnet : classer l’adresse « Maison », visible dans « Mes adresses »', async () => {
  await M.goto(URL0 + '#/m/' + before.id);
  await M.locator('#tag-pick').getByText('Maison').click();
  await M.getByText('Classée : Maison.').waitFor();
  await M.goto(URL0);
  await M.locator('#mes-adresses').getByText('Maison').waitFor();
});

await t('second téléphone : connexion, l’adresse du compte est là et se gère sans clé', async () => {
  const B = await newPhone();
  await B.page.goto(URL0 + '#/compte');
  await B.page.fill('#acc-email', EMAIL);
  await B.page.fill('#acc-pass', 'mauvais-mot-de-passe');
  await B.page.click('#auth-submit');
  await B.page.getByText('E-mail ou mot de passe incorrect.').waitFor();
  await B.page.fill('#acc-pass', PASS);
  await B.page.click('#auth-submit');
  await B.page.getByText('Connecté.').waitFor();
  await B.page.locator('#mes-adresses').getByText('Atelier (test)').click();
  await B.page.getByRole('heading', { name: 'Atelier (test)' }).waitFor();
  await B.page.getByText('Fiche rattachée à votre compte').waitFor();
  await B.page.getByRole('link', { name: 'Modifier' }).click();
  await B.page.getByText('Étape 1 sur 4').waitFor();
  await B.ctx.close();
});

await t('session expirée : le jeton est rafraîchi sans que l’utilisateur le voie', async () => {
  await fetch(URL0 + '__test/expire-tokens');
  await M.goto(URL0 + '#/compte');
  await M.locator('#me-email').getByText(EMAIL).waitFor();
  await M.evaluate(() => { location.hash = '#/'; });
  await M.locator('#mes-adresses').getByText('Atelier (test)').waitFor();
});

// ------------------------------------------------------------------ boutique
let orderId, invoiceUrl;
await t('boutique : création, tableau de bord vide', async () => {
  await M.goto(URL0 + '#/boutique');
  await M.fill('#shop-name', 'Boutique Awa (test)');
  await M.fill('#shop-phone', '33 800 00 00');
  await M.click('#shop-save');
  await M.locator('#shop-title').getByText('Boutique Awa (test)').waitFor();
  await M.getByText('Aucune commande en cours.').waitFor();
});

await t('nouvelle commande : client, deux articles, total calculé, numéro 0001', async () => {
  await M.click('#new-order');
  await M.fill('#cust-name', 'Fatou (test)');
  await M.fill('#cust-phone', '70 111 11 11');
  await M.locator('.li-label').first().fill('Robe wax');
  await M.locator('.li-qty').first().fill('2');
  await M.locator('.li-price').first().fill('12500');
  await M.click('#add-item');
  await M.locator('.li-label').nth(1).fill('Foulard');
  await M.locator('.li-price').nth(1).fill('3000');
  await M.locator('#order-total').getByText('28 000 FCFA').waitFor();
  await shot(M, '03-nouvelle-commande');
  await M.click('#order-create');
  await M.locator('#order-created').waitFor();
  await M.getByText('Commande N° 0001').waitFor();
  await M.getByText('Adresse attendue').first().waitFor();
  orderId = new URL(M.url()).hash.match(/#\/commande\/([0-9a-f-]+)/)[1];
  const href = await waHref(M, '#send-invoice');
  assert.match(href, /^https:\/\/wa\.me\/221701111111\?text=/, 'WhatsApp direct vers le client');
  const txt = waText(href);
  assert.match(txt, /N° 0001/); assert.match(txt, /28 000 FCFA/);
  invoiceUrl = txt.match(/https?:\/\/\S+/)[0];
  assert.match(invoiceUrl, /#\/f\/[A-Za-z0-9_-]{20,}$/);
  await shot(M, '04-commande');
});

const C = await newPhone({ owned: [{ type: 'place', kind: 'address', id: clientPlace.id, owner: clientPlace.owner_token, share: clientPlace.share_token, label: 'Chez la cliente (test)' }] });
await t('cliente : la facture s’ouvre sans compte, sans téléphone affiché, avec « Donner mon adresse »', async () => {
  await C.page.goto(invoiceUrl);
  await C.page.getByRole('heading', { name: 'Boutique Awa (test)' }).waitFor();
  await C.page.getByText('Robe wax').waitFor();
  await C.page.locator('#inv-remaining').getByText('28 000 FCFA').waitFor();
  assert.equal(await C.page.getByText('70 111').count(), 0, 'téléphone du client affiché');
  await shot(C.page, '05-facture-cliente');
  await C.page.click('#give-address-btn');
  await C.page.getByText('Boutique Awa (test) vous demande votre adresse').waitFor();
  await C.page.getByText(/pourra réutiliser l’adresse/).waitFor();
  await C.page.click('#send-address');
  await C.page.getByText('Adresse envoyée').waitFor();
  await C.page.click('#back-invoice');
  await C.page.locator('#address-ok').waitFor();
});

await t('commerçant : adresse reçue, livraison lancée, lien livreur prêt', async () => {
  await M.reload();
  await M.getByText('Adresse reçue').waitFor();
  await M.getByText('À livrer').first().waitFor();
  await M.click('#start-delivery');
  await M.locator('#send-courier').waitFor();
});

await t('livreur puis cliente : la position du livreur apparaît sur la facture de la cliente', async () => {
  const courierUrl = waText(await waHref(M, '#send-courier')).match(/https?:\/\/\S+/)[0];
  assert.match(courierUrl, /#\/l\/[A-Za-z0-9_-]{20,}$/);
  const L = await newPhone({ fakeGeo: true });
  await L.page.goto(courierUrl);
  await L.page.getByRole('heading', { name: 'Chez la cliente (test)' }).waitFor();
  await L.page.getByRole('button', { name: 'Démarrer la livraison' }).click();
  await L.page.getByText('Position partagée').waitFor();
  await C.page.reload();
  await C.page.getByText(/En route · environ \d+ min/).waitFor();
  await shot(C.page, '06-facture-suivi');
  await L.ctx.close();
});

await t('paiement Wave puis livraison : la commande passe « Terminée »', async () => {
  await M.reload();
  await M.locator('#pay-add summary').click();
  await M.locator('#pay-method').getByText('Wave').click();
  await M.click('#pay-save');
  await M.getByText('Paiement enregistré.').waitFor();
  await M.locator('#remaining').getByText('Payée').waitFor();
  await M.click('#mark-delivered');
  await M.getByText('Commande livrée.').waitFor();
  await M.getByText('Terminée').first().waitFor();
  const tr = (await local.db.query(`select lat, status from fiila.trackers order by created_at desc limit 1`)).rows[0];
  assert.equal(tr.lat, null, 'position du livreur effacée');
  await C.page.reload();
  await C.page.locator('#inv-remaining').getByText('Payée').waitFor();
  await C.page.getByText('Livrée').first().waitFor();
});

await t('client connu : la deuxième commande reprend son adresse, sans la redemander', async () => {
  await M.goto(URL0 + '#/clients');
  await M.locator('#customers').getByText('Fatou (test)').click();
  await M.getByText('Adresse connue').waitFor();
  await M.click('#customer-order');
  await M.locator('#picked-name').getByText('Fatou (test)').waitFor();
  await M.locator('.li-label').first().fill('Sac');
  await M.locator('.li-price').first().fill('5000');
  await M.click('#order-create');
  await M.getByText('L’adresse du client est déjà connue.').waitFor();
  await M.getByText('Commande N° 0002').waitFor();
  await M.getByText('À livrer').first().waitFor();
});

await t('tableau de bord : compteurs et filtres', async () => {
  await M.goto(URL0 + '#/boutique');
  await M.locator('#orders').getByText('N° 0002 · Fatou (test)').waitFor();
  await M.locator('#orders-filter').getByText('Terminées').click();
  await M.locator('#orders').getByText('N° 0001 · Fatou (test)').waitFor();
  await shot(M, '07-tableau-de-bord');
});

await t('annulation : la cliente voit « Commande annulée »', async () => {
  await M.goto(URL0 + '#/boutique');
  await M.locator('#orders').getByText('N° 0002').click();
  const href = await waHref(M, '#send-invoice');
  const url2 = waText(href).match(/https?:\/\/\S+/)[0];
  await M.click('#cancel-order');
  await M.click('#confirm-cancel');
  await M.getByText('Commande annulée.').waitFor();
  await C.page.goto(url2);
  await C.page.getByRole('heading', { name: 'Commande annulée' }).waitFor();
});

await t('mode sombre : facture lisible', async () => {
  const D = await newPhone({ dark: true });
  await D.page.goto(invoiceUrl);
  await D.page.getByText('Robe wax').waitFor();
  await shot(D.page, '08-facture-sombre');
  await D.ctx.close();
});

await t('déconnexion : les fiches du téléphone restent, la boutique demande une connexion', async () => {
  await M.goto(URL0 + '#/compte');
  await M.click('#logout');
  await M.getByText('Déconnecté.').waitFor();
  await M.getByRole('link', { name: 'Se connecter' }).waitFor();
  await M.locator('#mes-adresses').getByText('Atelier (test)').waitFor();
  await M.goto(URL0 + '#/boutique');
  await M.locator('#login-cta').waitFor();
});

await t('suppression du compte : tout ce qui est rattaché est effacé', async () => {
  await M.goto(URL0 + '#/compte');
  await M.fill('#acc-email', EMAIL);
  await M.fill('#acc-pass', PASS);
  await M.click('#auth-submit');
  await M.getByText('Connecté.').waitFor();
  await M.locator('#account-link img.avatar').waitFor(); // accueil, avec la photo de profil
  await M.goto(URL0 + '#/compte');
  await M.locator('details').filter({ hasText: 'Supprimer mon compte' }).locator('summary').click();
  await M.click('#delete-account');
  await M.click('#confirm-delete-account');
  await M.getByText('Compte supprimé.').waitFor();
  const n = async (sql) => (await local.db.query(sql)).rows[0].n;
  assert.equal(await n(`select count(*)::int n from fiila.shops`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.orders`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.customers`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.places where id = '${before.id}'`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.places where id = '${clientPlace.id}'`), 1, 'l’adresse de la cliente lui appartient');
});

await t('aucune erreur JavaScript', async () => {
  assert.deepEqual(pages.flatMap((p) => p.__errors || []), []);
});

await ok('fiila_delete_place', { p_id: clientPlace.id, p_owner: clientPlace.owner_token });
await browser.close();
local.server.close();
const report = { moteur: ENGINE, version, date: new Date().toISOString(), reussis: results.filter((r) => r.ok).length, total: results.length, results };
writeFileSync(`docs/shop-test-report-${ENGINE}.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.reussis}/${report.total} tests comptes/boutique réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
