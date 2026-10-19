// Fii La Carrière de bout en bout : inscription de l'ambassadeur (compte, charte), formation, test, validation par le fondateur,
// code tapé par un commerçant à la création de sa boutique, missions et portefeuille, versement marqué par le fondateur.
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
const SHOTS = 'docs/screenshots/ambassadeurs';
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
async function newPhone() {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
async function signup(p, name, email, retour) {
  await p.goto(URL0 + '#/compte?mode=inscription' + (retour ? '&retour=' + retour : ''));
  await p.getByRole('tab', { name: 'Créer un compte' }).click().catch(() => {});
  await p.fill('#acc-name', name);
  await p.fill('#acc-email', email);
  await p.fill('#acc-pass', 'motdepasse-test-123');
  await p.click('#auth-submit');
  await p.getByText('Compte créé.').waitFor();
}
const GOOD = [1, 1, 0, 1, 0, 1, 1, 1, 1, 0];
let CODE;
const A = await newPhone();
const F = await newPhone();

await t('accueil → « Devenir ambassadeur » : les 3 niveaux et leurs montants, compte demandé', async () => {
  await A.goto(URL0 + '#/');
  await A.locator('#amb-link-home').click();
  await A.locator('#amb-levels').waitFor();
  const txt = await A.locator('#amb-levels').textContent();
  assert.match(txt.replace(/\s/g, ' '), /2 000 FCFA[\s\S]*5 000 FCFA[\s\S]*10 000 FCFA/);
  assert.match(txt, /jamais pour une inscription/);
  await A.locator('#amb-login').waitFor();
  await shot(A, '01-presentation');
});

await t('inscription : charte obligatoire, puis formation en 6 fiches et test réussi → en attente de validation', async () => {
  await signup(A, 'Moussa Diop', 'moussa.amb@example.invalid', 'ambassadeur');
  await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#amb-register').waitFor();
  await A.fill('#amb-phone', '77 500 00 01');
  await A.fill('#amb-zone', 'Yoff');
  await A.click('#amb-register');
  await A.getByText('Acceptez la charte').waitFor();
  await A.check('#amb-charter');
  await A.click('#amb-register');
  await A.getByText('Formation · 1 sur 6').waitFor().catch(async (e) => {
    const why = await A.evaluate(() => [...document.querySelectorAll('[role=alert], #toast')].map((x) => x.textContent).join(' | ') + ' @ ' + location.hash);
    throw new Error('formation absente : ' + why);
  });
  await shot(A, '02-formation');
  for (let i = 0; i < 6; i++) await A.click('#amb-next');
  await A.getByRole('heading', { name: 'Test de passage' }).waitFor();
  for (let q = 0; q < 10; q++) await A.locator(`#q${q} input[value="${GOOD[q]}"]`).check();
  await shot(A, '03-test');
  await A.click('#amb-quiz-send');
  await A.getByText('Test réussi : 10/10').waitFor();
});

await t('fondateur : valide l’inscription depuis « Ambassadeurs »', async () => {
  await signup(F, 'Fondateur', 'fondateur.amb@example.invalid');
  await local.db.query(`update fiila.profiles set is_admin = true where user_id = (select id from auth.users where email = 'fondateur.amb@example.invalid')`);
  await F.goto(URL0 + '#/admin/ambassadeurs');
  await F.locator('#adm-review').getByText('Moussa Diop').waitFor();
  await F.locator('#adm-review').getByRole('button', { name: 'Valider' }).click();
  await F.getByText('Enregistré.').waitFor();
  CODE = (await local.db.query(`select code from fiila.ambassadors`)).rows[0].code;
});

await t('ambassadeur : code, portefeuille, aucun commerçant ; un commerçant tape le code en créant sa boutique', async () => {
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#amb-code').getByText(CODE).waitFor();
  await A.getByText('Aucun commerçant pour l’instant').waitFor();
  const M = await newPhone();
  await M.goto(URL0 + '#/boutique');
  await M.fill('#shop-name', 'Boutique Awa (test)');
  await M.selectOption('#shop-type', 'mode');
  await M.fill('#shop-amb', CODE);
  await M.click('#shop-save');
  await M.getByText('accompagnée par Moussa').waitFor();
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#amb-shops').getByText('Boutique Awa (test)').waitFor();
  assert.match(await A.locator('#amb-shops').textContent(), /5 article\(s\) avec photo/);
  await shot(A, '04-missions');
});

await t('niveau 1 atteint → gain en vérification ; après 30 jours le fondateur le verse ; l’ambassadeur le voit reçu', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
  const owner = (await local.db.query(`select id from fiila.shops where name = 'Boutique Awa (test)'`)).rows[0].id;
  // [SIMULÉ] articles et vitrine ajoutés directement en base pour la boutique du commerçant.
  for (let i = 0; i < 5; i++) await local.db.query(`insert into fiila.products (shop_id, name, price, photo, photo_type) values ($1, $2, 1000, decode($3, 'base64'), 'image/png')`, [owner, 'Article ' + i, photo]);
  await local.db.query(`update fiila.shops set public = true, slug = 'boutique-awa-test' where id = $1`, [owner]);
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#amb-wallet').getByText('2 000 FCFA').first().waitFor();
  await local.db.query(`update fiila.ambassador_rewards set validate_after = now() - interval '1 minute'`);
  await F.goto(URL0 + '#/'); await F.goto(URL0 + '#/admin/ambassadeurs');
  await F.locator('#adm-pay').getByText('Wave 77 500 00 01').waitFor();
  await F.locator('#adm-pay').getByRole('button', { name: /J’ai versé 2 000/ }).click();
  await F.getByText('Marqué versé.').waitFor();
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  const w = (await A.locator('#amb-wallet').textContent()).replace(/\s/g, ' ');
  assert.match(w, /Déjà reçu\s*2 000 FCFA/);
  await shot(A, '05-portefeuille');
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests ambassadeurs réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
