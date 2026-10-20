// Parcours d'accueil v2 (proposition validée le 20/10 23:36) : nouvel accueil léger ; un service utilisé devient un raccourci ;
// action principale = activité la plus utilisée sur 14 jours, ou « Reprendre mon adresse » ; retirer un raccourci ne retire
// aucun accès ; réglage du back-office onboarding_v2 = 0 → ancien accueil ; mesure anonyme ; back-office « Parcours d'accueil ».
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
const SHOTS = 'docs/screenshots/accueil-v2';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone(init, scheme) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme || 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(700); return page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true }); };
const metric = async (v) => Number((await local.db.query(`select coalesce(sum(n), 0) n from fiila.metrics where event = 'onboarding' and variant = $1`, [v])).rows[0].n);
const key = (await rpc(local.db, 'fiila_shop_save', { p_key: null, p: { name: 'Boutique Accueil (test)', business_type: 'mode' } })).body.key;

await t('nouveau visiteur : « Créer mon adresse » + « Découvrir les services », aucune activité, pas d’installation au 1er passage', async () => {
  const P = await newPhone();
  await P.goto(URL0 + '#/'); await P.locator('#services-open').waitFor(); await P.waitForTimeout(500);
  assert.equal(await P.locator('a.hero').getAttribute('data-hero'), 'adresse');
  assert.equal(await P.locator('#my-acts').count(), 0);
  assert.equal(await P.locator('#install-app').count(), 0, 'installation proposée à partir de la 2ᵉ visite');
  assert.equal(await P.locator('#home-more, #event-hint, .theme-switch').count(), 0, 'anciens éléments retirés');
  await shot(P, '01-nouveau');
});

await t('un service ouvert depuis « Découvrir » devient un raccourci ; mesure anonyme', async () => {
  const P = await newPhone();
  await P.goto(URL0 + '#/');
  await P.click('#services-open'); await P.locator('#services-sheet').waitFor();
  await shot(P, '02-services');
  await P.click('#svc-evenement-go');
  await P.getByRole('heading', { name: 'Créer un événement' }).waitFor();
  await P.goto(URL0 + '#/'); await P.locator('#act-evenement').waitFor();
  assert.equal(await metric('services:open'), 1);
  assert.equal(await metric('svc_evenement:click'), 1);
});

await t('activité la plus utilisée sur 14 jours = action principale ; « Retirer de l’accueil » garde l’accès', async () => {
  const now = Date.now();
  const P = await newPhone(`localStorage.setItem('fiila.shop', JSON.stringify({ key: ${JSON.stringify(key)} }));
    localStorage.setItem('fiila.acts', JSON.stringify({ log: { boutique: [${now - 9e6}, ${now - 6e6}, ${now - 3e6}], evenement: [${now - 2e6}], demander: [${now - 20 * 864e5}, ${now - 19 * 864e5}, ${now - 18 * 864e5}] }, used: { evenement: 1 }, hidden: {} }));
    localStorage.setItem('fiila.visits', '3');`);
  await P.goto(URL0 + '#/'); await P.locator('#home-hero').waitFor();
  assert.equal(await P.locator('#home-hero').getAttribute('data-hero'), 'boutique', 'les usages de plus de 14 jours ne comptent pas');
  await P.locator('#act-evenement').waitFor();
  assert.equal(await P.locator('#my-acts #create-address').count(), 1, 'l’adresse reste à portée');
  await shot(P, '03-commercante');
  await P.click('#services-open');
  await P.locator('#svc-evenement .svc-hide').click();
  await P.locator('#act-evenement').waitFor({ state: 'detached' });
  await P.click('#services-open');
  await P.click('#svc-evenement-go');
  await P.getByRole('heading', { name: 'Créer un événement' }).waitFor();
  assert.equal(await metric('svc_evenement:hide'), 1);
});

await t('adresse commencée : « Reprendre mon adresse » en action principale', async () => {
  const P = await newPhone(`localStorage.setItem('fiila.draft.address', JSON.stringify({ label: 'Chez Awa', locality: '', entry: null, vehicle_ok: null, stop: null, walk: '', instruction: '', photo: null }))`);
  await P.goto(URL0 + '#/');
  await P.locator('a.hero[data-hero="reprendre"]').waitFor();
  assert.match(await P.locator('a.hero').textContent(), /Reprendre mon adresse/);
});

await t('sombre : suit le téléphone, sans débordement', async () => {
  const P = await newPhone(`localStorage.setItem('fiila.shop', JSON.stringify({ key: ${JSON.stringify(key)} }))`, 'dark');
  await P.goto(URL0 + '#/'); await P.locator('#act-boutique').waitFor();
  assert.equal(await P.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 19, 16)');
  const over = await P.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, 'débordement ' + over);
  await shot(P, '04-sombre');
});

await t('réglage du back-office onboarding_v2 = 0 : retour à l’ancien accueil', async () => {
  await local.db.query(`update fiila.settings set value = '0' where key = 'onboarding_v2'`);
  const P = await newPhone();
  await P.goto(URL0 + '#/'); await P.locator('#create-address').waitFor();
  await P.waitForFunction(() => !!localStorage.getItem('fiila.flags'));
  await P.reload(); await P.locator('.tiles4 .ttile').first().waitFor();
  assert.equal(await P.locator('#services-open').count(), 0);
  assert.equal(await P.locator('#home-more').count(), 1);
  await local.db.query(`update fiila.settings set value = '1' where key = 'onboarding_v2'`);
});

await t('back-office : fiila_bo_onboarding réservé à l’équipe, compteurs agrégés', async () => {
  const r = await rpc(local.db, 'fiila_bo_onboarding', {});
  assert.notEqual(r.status, 200, 'refusé sans compte de l’équipe');
  const f = await rpc(local.db, 'fiila_app_flags', {});
  assert.equal(f.body.onboarding, true);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests parcours d’accueil réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
