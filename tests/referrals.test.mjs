// Parrainage de bout en bout, sur plusieurs téléphones : code de la boutique, lien de parrainage avec bandeau,
// numéro tapé, fiche de parrainage d'un particulier, arrivée par une demande d'adresse, livreur parrainé,
// statistiques du fondateur. Données synthétiques uniquement.
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
const SHOTS = 'docs/screenshots/parrainage';
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
  catch (e) { failed++; results.push({ ok: false, name }); console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone() {
  const ctx = await browser.newContext({
    viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', timezoneId: 'Africa/Dakar', serviceWorkers: 'block',
    geolocation: { latitude: 14.75814, longitude: -17.47032, accuracy: 9 }, permissions: ['geolocation'],
  });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  if (process.env.DEBUG) page.on('response', async (r) => { if (/attribute|referral/.test(r.url())) console.log('   ', r.url().split('/').pop(), r.status(), (await r.text()).slice(0, 300)); });
  pages.push(page);
  return page;
}
const ok = async (fn, args, opt) => { const r = await rpc(local.db, fn, args, opt); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
const waText = async (page, sel) => decodeURIComponent(new URL(await page.locator(sel).getAttribute('href')).searchParams.get('text'));
const q1 = async (sql, p = []) => (await local.db.query(sql, p)).rows;

async function makeAddress(P, label, typed) {
  await P.goto(URL0 + '#/new');
  await P.getByRole('button', { name: 'Utiliser ma position' }).click();
  await P.getByText('Position précise.').first().waitFor();
  await P.locator('#wizard-next').click();
  await P.getByLabel('Oui').check();
  await P.locator('#wizard-next').click();
  await P.locator('#label').fill(label);
  await P.locator('#instruction').fill('Portail vert [TEST]');
  await P.locator('#wizard-next').click();
  if (typed) { await P.locator('#add-ref summary').click(); await P.fill('#add-ref-input', typed); }
  await P.locator('#wizard-next').click();
  await P.getByRole('heading', { name: 'Partager' }).waitFor();
}
// Recharge réelle de l'espace (aller à la même adresse ne relance pas l'affichage).
async function openRef(P, pour) { await P.goto(URL0 + '#/'); await P.locator('#invite-link').waitFor(); await P.goto(URL0 + '#/parrainer' + (pour ? '?pour=' + pour : '')); }
async function refStats(P, pour) {
  await openRef(P, pour);
  await P.locator('#ref-code').waitFor();
  return { code: await P.locator('#ref-code').textContent(), joined: +(await P.locator('#ref-stats .tile strong').first().textContent()) };
}

const A = await newPhone();   // boutique marraine
let CODE, LINK;

await t('boutique : « Parrainer une boutique », code, lien et message WhatsApp prêts', async () => {
  await A.goto(URL0 + '#/boutique');
  await A.fill('#shop-name', 'Boutique Awa (test)');
  await A.selectOption('#shop-type', 'mode');
  await A.fill('#shop-phone', '77 100 00 01');
  await A.click('#shop-save');
  await A.locator('#shop-title').waitFor();
  await A.click('#shop-referral');
  await A.locator('#ref-code').waitFor();
  CODE = await A.locator('#ref-code').textContent();
  assert.match(CODE, /^[A-HJ-NP-Z2-9]{6}$/);
  LINK = await A.locator('#ref-link').textContent();
  assert.ok(LINK.endsWith('#/r/' + CODE));
  const msg = await waText(A, '#ref-whatsapp');
  assert.ok(msg.includes(LINK) && /Crée ta boutique/.test(msg), msg);
  assert.ok(!msg.includes('77 100'), 'le numéro de la boutique n’est pas dans le message');
  await A.getByText('À l’inscription, on peut aussi taper votre numéro.').waitFor();
  await A.getByText('Personne pour l’instant.').waitFor();
  await shot(A, '01-parrainer-boutique');
});

await t('lien de parrainage : bandeau « Boutique Awa vous invite », boutique créée et comptée', async () => {
  const B = await newPhone();
  await B.goto(LINK);
  await B.locator('#invite-banner').getByText('Boutique Awa (test)').waitFor();
  assert.ok(B.url().endsWith('#/'), 'le code ne reste pas dans la barre d’adresse');
  await shot(B, '02-bandeau-invitation');
  await B.click('#invite-shop');
  assert.equal(await B.locator('#shop-ref').count(), 0, 'pas de question « qui vous a parlé » : le lien suffit');
  await B.fill('#shop-name', 'Boutique Binta (test)');
  await B.selectOption('#shop-type', 'mode');
  await B.click('#shop-save');
  await B.locator('#shop-title').waitFor();
  await B.goto(URL0 + '#/');
  assert.equal(await B.locator('#invite-banner').count(), 0, 'plus de bandeau une fois la boutique créée');
  await openRef(A, 'boutique');
  await A.locator('#ref-recent').getByText('Boutique Binta (test)').waitFor();
  assert.equal(await A.locator('#ref-stats .tile strong').first().textContent(), '1');
  await A.locator('#ref-recent').getByText('Pas encore active').waitFor();
  await shot(A, '03-arrivee-comptee');
});

await t('numéro tapé : une particulière crée son adresse en donnant le numéro de la boutique', async () => {
  const C = await newPhone();
  await makeAddress(C, 'Chez Coumba (test)', '+221 77 100 00 01');
  const s = await refStats(A, 'boutique');
  assert.equal(s.joined, 2);
  await A.locator('#ref-recent').getByText('Adresse', { exact: true }).waitFor();
});

let PCODE;
await t('particulier : « Inviter un proche », fiche de parrainage, un proche arrive par son lien', async () => {
  const D = await newPhone();
  await D.goto(URL0 + '#/');
  await D.click('#invite-link');
  await D.fill('#ref-name', 'Khady Ndiaye (test)');
  await D.fill('#ref-phone', '78 555 55 55');
  await D.click('#ref-create');
  await D.locator('#ref-code').waitFor();
  PCODE = await D.locator('#ref-code').textContent();
  const msg = await waText(D, '#ref-whatsapp');
  assert.match(msg, /J’envoie mon adresse en une photo/);
  await shot(D, '04-inviter-proche');
  const E = await newPhone();
  await E.goto(URL0 + '#/r/' + PCODE.toLowerCase());
  await E.locator('#invite-banner').getByText('Khady').waitFor();
  assert.equal(await E.locator('#invite-shop').count(), 0, 'un particulier invite à créer une adresse, pas une boutique');
  assert.ok(!(await E.locator('#invite-banner').textContent()).includes('Ndiaye'), 'prénom seulement');
  await makeAddress(E, 'Chez Mame (test)');
  assert.equal(await E.locator('#add-ref').count(), 0);
  await openRef(D);
  await D.locator('#ref-recent').waitFor();
  assert.equal(await D.locator('#ref-stats .tile strong').first().textContent(), '1');
  await D.reload();
  await D.locator('#ref-code').getByText(PCODE).waitFor();
});

await t('demande d’adresse : la cliente qui répond est comptée pour la boutique, sans rien taper', async () => {
  const shopKey = await A.evaluate(() => JSON.parse(localStorage.getItem('fiila.shop')).key);
  const o = await ok('fiila_order_create', { p_key: shopKey, p: { customer: { name: 'Aïda (test)', phone: '70 000 00 07' }, items: [{ label: 'Sac', qty: 1, price: 5000 }] } });
  const F = await newPhone();
  await F.goto(URL0 + '#/d/' + o.request_token);
  await F.locator('#new-address-for-request').click();
  await F.getByRole('button', { name: 'Utiliser ma position' }).click();
  await F.getByText('Position précise.').first().waitFor();
  await F.locator('#wizard-next').click();
  await F.getByLabel('Oui').check();
  await F.locator('#wizard-next').click();
  await F.locator('#label').fill('Chez Aïda (test)');
  await F.locator('#instruction').fill('Porte bleue [TEST]');
  await F.locator('#wizard-next').click();
  assert.equal(await F.locator('#add-ref').count(), 0, 'pas de question en réponse à une demande');
  await F.locator('#wizard-next').click();
  await F.getByText('a votre adresse.').waitFor();
  const rows = await q1(`select source from fiila.referrals x join fiila.places p on p.id = x.place_id where p.label = 'Chez Aïda (test)'`);
  assert.deepEqual(rows.map((r) => r.source), ['request']);
  assert.equal((await refStats(A, 'boutique')).joined, 3);
});

await t('livreur : inscription avec le code tapé, puis son propre espace « Parrainer »', async () => {
  const L = await newPhone();
  await L.goto(URL0 + '#/livreur');
  await L.fill('#cr-name', 'Ibou Fall (test)');
  await L.locator('#cr-ref summary').click();
  await L.fill('#cr-ref-input', CODE.toLowerCase());
  await L.click('#courier-register');
  await L.locator('#courier-referral').click();
  await L.locator('#ref-code').waitFor();
  assert.match(await waText(L, '#ref-whatsapp'), /les boutiques m’envoient l’adresse exacte/);
  await openRef(A, 'boutique');
  await A.locator('#ref-recent').getByText('Ibou', { exact: true }).waitFor();
  assert.equal(await A.locator('#ref-stats .tile strong').first().textContent(), '4');
  await shot(A, '05-boutique-4-arrivees');
});

await t('statistiques : refusées sans compte autorisé ; le fondateur voit origines et meilleurs parrains', async () => {
  const G = await newPhone();
  await G.goto(URL0 + '#/stats');
  await G.getByText('Accès réservé').waitFor();
  await G.goto(URL0 + '#/compte');
  await G.getByRole('tab', { name: 'Créer un compte' }).click();
  await G.fill('#acc-name', 'Fondateur Test');
  await G.fill('#acc-email', 'fondateur.test@example.test');
  await G.fill('#acc-pass', 'Motdepasse-test-123');
  await G.click('#auth-submit');
  await G.waitForFunction(() => { try { return !!localStorage.getItem('fiila.session') || document.querySelector('#account-link, .who'); } catch (e) { return false; } });
  await G.waitForTimeout(500);
  await G.goto(URL0 + '#/stats');
  await G.getByText('Ce compte n’a pas accès aux statistiques.').waitFor();
  const uid = (await q1(`select id from auth.users where email = 'fondateur.test@example.test'`))[0].id;
  await local.db.query(`insert into fiila.profiles (user_id) values ($1) on conflict (user_id) do nothing`, [uid]);
  await local.db.query(`update fiila.profiles set is_admin = true where user_id = $1`, [uid]);
  await G.goto(URL0 + '#/');
  await G.goto(URL0 + '#/stats');
  await G.locator('#stats-totals').waitFor();
  await G.locator('#stats-sources').getByText('Lien de parrainage').waitFor();
  await G.locator('#stats-sources').getByText('Numéro tapé').waitFor();
  await G.locator('#stats-sources').getByText('Demande d’adresse').waitFor();
  await G.locator('#stats-top .item').first().getByText('Boutique Awa (test)').waitFor();
  assert.ok(!(await G.content()).includes('77 100 00 01'), 'aucun numéro affiché');
  await shot(G, '06-statistiques');
});

await t('aucune erreur JavaScript', async () => {
  const errs = pages.flatMap((p) => p.__errors);
  assert.deepEqual(errs, []);
});

await browser.close();
local.server.close();
console.log(`\n${results.length - failed}/${results.length} tests parrainage réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
