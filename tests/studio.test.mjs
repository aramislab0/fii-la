// Fii Studio dans un vrai navigateur (fal simulé par le serveur de test, aucun appel réel) : la ligne Studio n'apparaît que
// Studio ouvert ; 5 styles ; 3 versions ; la version gardée devient la photo principale et l'originale reste la suivante ;
// 1 crédit débité ; sans crédit, pas de bouton de création. docs/PLAN-FII-STUDIO.md.
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

await t('Studio ouvert : ligne avec crédits ; 5 styles ; 3 versions ; la version gardée devient la photo principale, 1 crédit débité', async () => {
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
  await p.click('#studio-run');
  await p.locator('#studio-res-2').waitFor();
  assert.equal(await p.locator('#studio-keep').isDisabled(), true, 'il faut choisir une version');
  await p.click('#studio-res-1');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/${ENGINE}-03-versions.png` });
  await p.click('#studio-keep');
  await p.getByText('Photo Studio enregistrée.').waitFor();
  await p.locator('#studio-sheet').waitFor({ state: 'detached' });
  const n = (await local.db.query(`select count(*)::int n from fiila.product_photos where product_id = $1`, [A.id])).rows[0].n;
  assert.equal(n, 1, 'l’originale reste comme photo supplémentaire');
  const job = (await local.db.query(`select status, kept, style, credit_from from fiila.studio_jobs where product_id = $1`, [A.id])).rows[0];
  assert.deepEqual(job, { status: 'kept', kept: 1, style: 'luxe', credit_from: 'wallet' });
  await p.locator('#studio-credits').getByText('1 crédit').waitFor();
  const m = (await local.db.query(`select variant from fiila.metrics where event = 'studio' order by variant`)).rows.map((x) => x.variant);
  assert.ok(m.includes('run:luxe') && m.includes('kept:luxe'), JSON.stringify(m));
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('sans crédit : pas de bouton de création, message clair', async () => {
  await ok('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: -5, p_reason: 'Test' }, { uid: F });
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
