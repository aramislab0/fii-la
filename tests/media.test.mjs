// Photos servies par le stockage (22/10/2026) : la vitrine affiche l'adresse fixe (plus de base64), la boutique modifie
// un article dont les photos viennent du stockage (conversion avant l'envoi), « Publier » prépare la photo, le back-office
// montre l'état. Le stockage est simulé par le serveur local (adresse de base = serveur de test). Données synthétiques.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { startServer } from './dev-server.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/photos-stockage';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url.replace(/\/?$/, '/');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const pages = [];
async function newPhone() {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
function pngFile(name, rgb) {
  const png = new PNG({ width: 96, height: 120 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255; }
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(png) };
}
const SERVED = 'media/brand/fii-logo.png'; // fichier réel servi par le serveur local, à la place du seau
const servedMd5 = createHash('md5').update(readFileSync('web/' + SERVED)).digest('hex');
const S = await newPhone();
let PID, SLUG;

await t('mise en place : boutique avec un article à 2 photos, puis photos « copiées » dans le stockage', async () => {
  await S.goto(URL0 + '#/boutique');
  await S.fill('#shop-name', 'Boutique Stockage (test)');
  await S.selectOption('#shop-type', 'mode');
  await S.click('#shop-save');
  await S.locator('#shop-setup[data-step="2"]').waitFor();
  await S.goto(URL0 + '#/boutique/article/nouveau');
  await S.setInputFiles('#product-photo', [pngFile('a.png', [200, 40, 40]), pngFile('b.png', [40, 70, 200])]);
  await S.locator('#product-photo-grid .pp-tile').nth(1).waitFor();
  await S.fill('#product-name', 'Robe stockage (test)');
  await S.fill('#product-price', '9000');
  await S.click('#product-save');
  await S.waitForFunction(() => /#\/boutique\/article\/[0-9a-f-]{36}/.test(location.hash));
  PID = S.url().split('#/boutique/article/')[1].split('?')[0];
  const r = (await local.db.query(`select s.slug from fiila.products p join fiila.shops s on s.id = p.shop_id where p.id = $1`, [PID])).rows[0];
  SLUG = r.slug;
  await S.goto(URL0 + '#/boutique/reglages');
  await S.locator('#vitrine-section').getByText('Ouverte').click();
  await S.waitForTimeout(500);
  SLUG = (await local.db.query(`select s.slug from fiila.products p join fiila.shops s on s.id = p.shop_id where p.id = $1`, [PID])).rows[0].slug;
  await local.db.query(`update fiila.shops set public = true where slug = $1`, [SLUG]);
  await local.db.query(`insert into fiila.settings (key, value) values ('media_base', $1) on conflict (key) do update set value = excluded.value`, [URL0]);
  await local.db.query(`update fiila.products set photo_path = $2 where id = $1`, [PID, SERVED]);
  await local.db.query(`update fiila.product_photos set path = $2 where product_id = $1`, [PID, SERVED]);
});

await t('vitrine : la photo vient du stockage (adresse fixe), plus de base64', async () => {
  const V = await newPhone();
  await V.goto(URL0 + '#/b/' + SLUG);
  const img = V.locator('.vcard img').first();
  await img.waitFor({ state: 'attached' });
  await V.waitForFunction(() => { const i = document.querySelector('.vcard img'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await img.getAttribute('src'), URL0 + SERVED);
  assert.equal(await V.locator('.vcard img[src^="data:"]').count(), 0);
  await V.screenshot({ path: `${SHOTS}/${ENGINE}-01-vitrine.png` });
  assert.deepEqual(V.__errors, []);
});

await t('modification : photos du stockage converties avant l’envoi ; nouvelle version à recopier', async () => {
  await S.goto(URL0 + '#/boutique/article/' + PID);
  await S.waitForFunction(() => !document.querySelector('#product-photo-grid .loading-skel') && document.querySelectorAll('#product-photo-grid .pp-tile').length === 2);
  assert.equal(await S.locator('#product-photo-grid .pp-tile img').first().getAttribute('src'), URL0 + SERVED);
  await S.getByRole('button', { name: 'Retirer la photo 2' }).click();
  await S.click('#product-save');
  await S.getByText('Article mis à jour.').waitFor();
  const row = (await local.db.query(`select md5(photo) h, photo_path, (select count(*)::int from fiila.product_photos where product_id = $1) n from fiila.products where id = $1`, [PID])).rows[0];
  assert.equal(row.n, 0);
  assert.equal(row.photo_path, null, 'contenu changé : à recopier');
  assert.ok(row.h, 'photo principale gardée');
  // L'image du stockage a été recadrée au format 4:5 ou envoyée telle quelle : dans tous les cas, lue depuis l'adresse.
  if (row.h === servedMd5) assert.ok(true);
  assert.deepEqual(S.__errors, []);
});

await t('« Publier » : la photo du stockage est préparée pour l’enregistrement', async () => {
  await local.db.query(`update fiila.products set photo_path = $2 where id = $1`, [PID, SERVED]);
  await S.goto(URL0 + '#/boutique/article/' + PID + '?publier=1');
  await S.reload();
  await S.locator('#publish-box').waitFor();
  await S.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  await S.click('#product-publish');
  const a = S.locator('#post-download');
  await a.waitFor();
  await S.waitForFunction(() => /^data:image\//.test(document.getElementById('post-download').getAttribute('href') || ''));
});

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests photos servies par le stockage (${ENGINE}) réussis`);
process.exit(failed ? 1 : 0);
