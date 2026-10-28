// Fii Studio dans un vrai navigateur (fal simulé par le serveur de test, aucun appel réel) : la ligne Studio n'apparaît que
// Studio ouvert ; 5 styles ; 3 versions ; la version gardée devient la photo principale et l'originale reste la suivante ;
// crédits utilisés à la création (règle du 28/10), « garder » gratuit ; dernière création reprise ; sans crédit, pas de bouton. docs/PLAN-FII-STUDIO.md.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/studio';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
let failed = 0, passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ok = async (fn, args, opt) => { const r = await rpc(local.db, fn, args, opt); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const PNG = readFileSync('tests/fixtures/article-4x5.jpg');
async function newPhone(shop) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://v3.fal.media/**', (r) => r.fulfill({ contentType: 'image/jpeg', body: PNG }));
  await ctx.addInitScript((x) => localStorage.setItem('fiila.shop', x), JSON.stringify(shop));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  return page;
}
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Atelier Studio (test)', business_type: 'mode' } });
const A = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Sac wax (test)', price: 22000 } });
await local.db.query(`update fiila.products set photo = $2, photo_type = 'image/jpeg' where id = $1`, [A.id, PNG]);
const SHOP = { id: S.shop.id, key: S.key };
const F = (await local.db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'fondateur.studio@example.test') returning id`)).rows[0].id;
await local.db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Fondateur')`, [F]);
await local.db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [F]);

await t('Studio fermé : aucune ligne Studio sur l’article', async () => {
  const p = await newPhone(SHOP);
  await p.goto(URL0 + '#/boutique/article/' + A.id);
  await p.locator('#product-name').waitFor(); await p.waitForTimeout(800);
  assert.equal(await p.locator('#studio-open').count(), 0);
  await p.context().close();
});

await t('Studio ouvert : ligne avec crédits ; décors ; mode premium proposé (mode : mannequin) ; une version comparée à l’original ; gardée = photo principale, 1 crédit', async () => {
  await ok('fiila_bo_setting_set', { p_key: 'studio_ready', p_value: 1 }, { uid: F });
  await ok('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: 2, p_reason: 'Boutique fondatrice (test)' }, { uid: F });
  const p = await newPhone(SHOP);
  await p.goto(URL0 + '#/boutique/article/' + A.id);
  await p.locator('#studio-open').waitFor();
  assert.match(await p.locator('#studio-credits').textContent(), /2 crédits/);
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-01-article.png` });
  await p.click('#studio-open');
  await p.locator('#studio-sheet').waitFor();
  assert.deepEqual(await p.locator('.studio-style').evaluateAll((b) => b.map((x) => x.dataset.style)), ['blanc', 'minimal', 'luxe', 'soleil', 'fete']);
  await p.click('.studio-style[data-style="luxe"]');
  assert.equal(await p.locator('.studio-style[data-style="luxe"]').getAttribute('aria-checked'), 'true');
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-02-styles.png` });
  // Studio v2 : Fidèle / Premium en sélecteur, crédits dans l'en-tête, 3 étapes.
  assert.match(await p.locator('.studio-mode').textContent(), /Fidèle[\s\S]*1 crédit[\s\S]*Premium[\s\S]*3 crédits/);
  assert.match(await p.locator('#studio-credits-pill').textContent(), /2 crédits/);
  assert.match(await p.locator('#studio-rule').textContent(), /création réussie[\s\S]*« Garder » est gratuit/, 'boutiques prévenues du nouveau débit');
  assert.equal(await p.locator('#studio-steps li[aria-current="step"]').textContent(), 'Décor');
  await p.click('#studio-mode-premium');
  assert.match(await p.locator('#studio-mode-hint').textContent(), /mannequin/);
  assert.equal(await p.locator('#studio-run').count(), 0, '2 crédits < 3 : pas de premium');
  await p.locator('#studio-empty').getByText('Pas assez de crédits').waitFor();
  await p.click('#studio-mode-fidele');
  await p.click('#studio-run');
  await p.locator('#studio-res-0').waitFor();
  await p.locator('#studio-credits-pill').getByText('1 crédit').waitFor();
  assert.match(await p.locator('#studio-again').textContent(), /Autre proposition · 1 crédit/);
  assert.equal(await p.locator('.studio-compare figure').count(), 2, 'original et version côte à côte');
  assert.equal(await p.locator('#studio-check').count(), 0, 'question de fidélité seulement en premium');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-03-versions.png` });
  await p.click('#studio-keep');
  await p.locator('#studio-done').getByText('Votre photo pro est prête').waitFor();
  assert.match(await p.locator('#studio-left').textContent(), /1 crédit/);
  assert.equal(await p.locator('#studio-publish').getAttribute('href'), '#/boutique/article/' + A.id + '?publier=1');
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-06-bravo.png` });
  await p.click('#studio-finish');
  await p.locator('#studio-sheet').waitFor({ state: 'detached' });
  const n = (await local.db.query(`select count(*)::int n from fiila.product_photos where product_id = $1`, [A.id])).rows[0].n;
  assert.equal(n, 1, 'l’originale reste comme photo supplémentaire');
  const job = (await local.db.query(`select status, kept, style, credit_from, charge, result_path from fiila.studio_jobs where product_id = $1`, [A.id])).rows[0];
  assert.deepEqual(job, { status: 'kept', kept: 0, style: 'luxe', credit_from: 'wallet', charge: 'charged', result_path: job.result_path });
  assert.match(job.result_path, /^s\/[0-9a-f-]{36}\.png$/, 'copie durable dans le seau privé');
  await p.locator('#studio-credits').getByText('1 crédit').waitFor();
  const m = (await local.db.query(`select variant from fiila.metrics where event = 'studio' order by variant`)).rows.map((x) => x.variant);
  assert.ok(m.includes('run:luxe') && m.includes('kept:luxe'), JSON.stringify(m));
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('Studio premium : comparaison avec la question de fidélité ; 3 crédits utilisés à la création, garder gratuit', async () => {
  await ok('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: 4, p_reason: 'Test premium' }, { uid: F });
  const p = await newPhone(SHOP);
  await p.goto(URL0 + '#/boutique/article/' + A.id);
  await p.click('#studio-open');
  await p.click('#studio-mode-premium');
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-04-premium.png` });
  await p.click('#studio-run');
  await p.locator('#studio-check').waitFor();
  assert.equal((await p.locator('#studio-keep').textContent()).trim(), 'Oui, garder', 'garder ne coûte plus rien (règle du 28/10)');
  assert.match(await p.locator('#studio-again').textContent(), /Non, autre proposition · 3 crédits/);
  await p.locator('#studio-credits-pill').getByText('2 crédits').waitFor();
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-05-premium-compare.png` });
  await p.click('#studio-keep');
  await p.locator('#studio-done').waitFor();
  await p.click('#studio-finish');
  await p.locator('#studio-sheet').waitFor({ state: 'detached' });
  await p.locator('#studio-credits').getByText('2 crédits').waitFor();
  const j = (await local.db.query(`select mode, status from fiila.studio_jobs where product_id = $1 order by created_at desc limit 1`, [A.id])).rows[0];
  assert.deepEqual(j, { mode: 'premium', status: 'kept' });
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('dernière création : version payée puis fenêtre fermée → reprise depuis la copie durable, gardée sans nouveau débit', async () => {
  const p = await newPhone(SHOP);
  await p.goto(URL0 + '#/boutique/article/' + A.id);
  await p.click('#studio-open');
  await p.click('#studio-mode-fidele');
  await p.click('#studio-run');
  await p.locator('#studio-res-0').waitFor();
  await p.locator('#studio-credits-pill').getByText('1 crédit').waitFor();
  await p.click('#studio-close');
  await p.locator('#studio-sheet').waitFor({ state: 'detached' });
  await p.reload();
  await p.click('#studio-open');
  await p.locator('#studio-resume').getByText('Dernière création').waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-07-reprise.png` });
  await p.click('#studio-resume');
  await p.locator('#studio-res-0').waitFor();
  await p.click('#studio-keep');
  await p.locator('#studio-done').waitFor();
  assert.match(await p.locator('#studio-left').textContent(), /1 crédit/, 'garder ne débite rien');
  await p.click('#studio-finish');
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('sans crédit : pas de bouton de création, message clair', async () => {
  // Retrait du solde exact (audit du 27/10 : un retrait plus grand que le solde est refusé).
  const left = (await local.db.query(`select credits from fiila.studio_wallets where shop_id = $1`, [S.shop.id])).rows[0].credits;
  await ok('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: -left, p_reason: 'Test' }, { uid: F });
  const p = await newPhone(SHOP);
  await p.goto(URL0 + '#/boutique/article/' + A.id);
  await p.click('#studio-open');
  await p.locator('#studio-empty').waitFor();
  assert.equal(await p.locator('#studio-run').count(), 0);
  await p.context().close();
});

await local.db.exec(`delete from fiila.studio_jobs; delete from fiila.studio_wallets`);
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests Studio réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
