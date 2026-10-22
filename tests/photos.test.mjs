// Photos d'article de bout en bout : la boutique ajoute 3 photos (en une fois), choisit la principale, enregistre ;
// la vitrine et le fil montrent un carrousel (points, compteur, glisser, défilement automatique) ; une photo seule
// reste une image simple. Données synthétiques.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { startServer } from './dev-server.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/photos';
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
async function newPhone(width) {
  const ctx = await browser.newContext({ viewport: width ? { width, height: 800 } : phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium',
    hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
// Images de couleurs franches, pour reconnaître l'ordre.
function pngFile(name, rgb) {
  const png = new PNG({ width: 96, height: 96 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255; }
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(png) };
}
const RED = [200, 40, 40], GREEN = [30, 140, 70], BLUE = [40, 70, 200];
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const S = await newPhone();
let SLUG;

await t('boutique : 3 photos ajoutées en une fois, la 3e devient principale, enregistrement', async () => {
  await S.goto(URL0 + '#/boutique');
  await S.fill('#shop-name', 'Boutique Photos (test)');
  await S.selectOption('#shop-type', 'mode');
  await S.click('#shop-save');
  await S.locator('#shop-setup[data-step="2"]').waitFor();
  await S.goto(URL0 + '#/boutique/article/nouveau');
  await S.locator('#product-photo-add').waitFor();
  await S.setInputFiles('#product-photo', [pngFile('rouge.png', RED), pngFile('vert.png', GREEN), pngFile('bleu.png', BLUE)]);
  await S.locator('#product-photo-grid .pp-tile').nth(2).waitFor();
  assert.equal(await S.locator('#product-photo-grid .pp-tile').count(), 3);
  await S.getByRole('button', { name: 'Mettre la photo 3 en principale' }).click();
  assert.match(await S.locator('#product-photo-grid .pp-tile.main').textContent(), /Principale/);
  await S.fill('#product-name', 'Robe trois photos (test)');
  await S.fill('#product-price', '15000');
  await shot(S, '01-ajout-photos');
  await S.click('#product-save');
  await S.waitForFunction(() => /#\/boutique\/article\/[0-9a-f-]{36}/.test(location.hash));
  await S.locator('#publish-box').waitFor(); // écran de modification affiché (après l'enregistrement)
  // les photos supplémentaires se chargent après l'écran : on attend la fin du chargement
  await S.waitForFunction(() => !document.querySelector('#product-photo-grid .loading-skel')
    && document.querySelectorAll('#product-photo-grid .pp-tile').length === 3, null, { timeout: 15000 })
    .catch(async () => { throw new Error('les 3 photos reviennent à la modification : ' + await S.locator('#product-photo-grid .pp-tile').count()); });
  const rows = (await local.db.query(`select (select count(*)::int from fiila.product_photos x where x.product_id = p.id) n from fiila.products p where p.name = 'Robe trois photos (test)'`)).rows;
  assert.equal(rows[0].n, 2);
});

await t('retirer une photo puis en remettre : 5 au plus', async () => {
  await S.getByRole('button', { name: 'Retirer la photo 2' }).click();
  assert.equal(await S.locator('#product-photo-grid .pp-tile').count(), 2);
  await S.setInputFiles('#product-photo', [pngFile('a.png', RED), pngFile('b.png', GREEN), pngFile('c.png', BLUE), pngFile('d.png', RED)]);
  await S.locator('#product-photo-grid .pp-tile').nth(4).waitFor();
  assert.equal(await S.locator('#product-photo-grid .pp-tile').count(), 5);
  assert.equal(await S.locator('#product-photo-add').count(), 0, 'plus de bouton « Ajouter » à 5 photos');
  await S.click('#product-save');
  await S.getByText('Article mis à jour.').waitFor();
});

await t('vitrine : carrousel (5 points, compteur 1/5), glisser, défilement automatique', async () => {
  await S.goto(URL0 + '#/boutique/reglages');
  await S.click('#vitrine-switch');
  await S.getByText(/Vitrine (ouverte|en ligne)/).first().waitFor().catch(() => {});
  SLUG = (await local.db.query(`select slug from fiila.shops where name = 'Boutique Photos (test)'`)).rows[0].slug;
  await local.db.query(`update fiila.shops set public = true where slug = $1`, [SLUG]);
  const V = await newPhone();
  await V.goto(URL0 + '#/b/' + SLUG);
  const car = V.locator('.vcard .pc').first();
  await car.waitFor();
  assert.equal(await car.locator('.pc-dot').count(), 5);
  assert.equal(await car.locator('.pc-count').textContent(), '1/5');
  await car.locator('.pc-slide').first().locator('img').waitFor();
  await shot(V, '02-vitrine-carrousel');
  // glisser (défilement horizontal) vers la 2e photo
  await car.locator('.pc-track').evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: 'auto' }));
  await V.waitForFunction(() => document.querySelector('.vcard .pc-count').textContent === '2/5');
  await car.locator('.pc-slide').nth(1).locator('img').waitFor();
  // point « 4 » : va à la 4e photo
  await car.getByRole('button', { name: 'Photo 4 sur 5' }).click();
  await V.waitForFunction(() => document.querySelector('.vcard .pc-count').textContent === '4/5');
  // défilement automatique (reprend après la pause d'interaction)
  await V.evaluate(() => { const el = document.querySelector('.vcard .pc-track'); el.scrollTo({ left: 0, behavior: 'auto' }); });
  await V.waitForFunction(() => document.querySelector('.vcard .pc-count').textContent === '1/5');
  await V.waitForFunction(() => document.querySelector('.vcard .pc-count').textContent !== '1/5', null, { timeout: 16000 });
  assert.ok(await noOverflow(V));
});

await t('fil : carrousel sur la carte ; double toucher = j’aime ; article à une photo = image simple', async () => {
  await local.db.query(`update fiila.shops set feed = true, featured_rank = 1 where slug = $1`, [SLUG]);
  await S.goto(URL0 + '#/boutique/article/nouveau');
  await S.setInputFiles('#product-photo', [pngFile('seule.png', GREEN)]);
  await S.locator('#product-photo-grid .pp-tile').first().waitFor();
  await S.fill('#product-name', 'Sac une photo (test)');
  await S.fill('#product-price', '5000');
  await S.click('#product-save');
  await S.waitForFunction(() => /#\/boutique\/article\/[0-9a-f-]{36}/.test(location.hash));
  const F = await newPhone();
  await F.goto(URL0 + '#/boutiques');
  const post = F.locator('article', { hasText: 'Robe trois photos (test)' }).first();
  await post.locator('.post-img.pc .pc-dot').first().waitFor();
  assert.equal(await post.locator('.pc-dot').count(), 5);
  const single = F.locator('article', { hasText: 'Sac une photo (test)' }).first();
  await single.locator('.post-img').waitFor();
  assert.equal(await single.locator('.pc').count(), 0, 'une photo : pas de carrousel');
  await post.locator('.post-img').dblclick();
  await post.locator('.post-act.on').first().waitFor();
  await shot(F, '03-fil-carrousel');
});

await t('format 4:5 : photo carrée recadrée à l’ajout ; recadrage ajustable (glisser, zoom) ; cartes en 4:5', async () => {
  await S.setViewportSize(phone.viewport);
  await S.goto(URL0 + '#/boutique/article/nouveau');
  await S.setInputFiles('#product-photo', [pngFile('carre.png', RED)]);
  const img = S.locator('#product-photo-grid .pp-tile img').first();
  await img.waitFor();
  await S.waitForFunction(() => { const i = document.querySelector('#product-photo-grid .pp-tile img'); return i && i.naturalWidth > 0; });
  const [w, hh] = await img.evaluate((i) => [i.naturalWidth, i.naturalHeight]);
  assert.ok(Math.abs(w / hh - 0.8) < 0.02, 'photo recadrée en 4:5 : ' + w + '×' + hh);
  await S.getByRole('button', { name: 'Recadrer la photo 1' }).click();
  await S.locator('#crop-frame').waitFor();
  await S.locator('#crop-zoom').fill('2');
  const box = await S.locator('#crop-frame').boundingBox();
  await S.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await S.mouse.down();
  await S.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30); await S.mouse.up();
  await S.waitForTimeout(500);
  await S.screenshot({ path: `${SHOTS}/${ENGINE}-05-recadrage.png` }); // écran visible (feuille du bas)
  await S.click('#crop-ok');
  await S.locator('#crop-sheet').waitFor({ state: 'detached' });
  await S.fill('#product-name', 'Article carré (test)');
  await S.fill('#product-price', '2000');
  await S.click('#product-save');
  await S.waitForFunction(() => /#\/boutique\/article\/[0-9a-f-]{36}/.test(location.hash));
  const ok = (await local.db.query(`select fiila.ratio_ok(photo) ok from fiila.products where name = 'Article carré (test)'`)).rows[0].ok;
  assert.equal(ok, true, 'photo enregistrée au format 4:5');
  // cartes de la vitrine : 4:5
  const V = await newPhone();
  await V.goto(URL0 + '#/b/' + SLUG);
  const r = await V.locator('.vcard .vimg').first().evaluate((el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
  assert.ok(Math.abs(r - 0.8) < 0.02, 'carte de vitrine en 4:5 : ' + r);
});

await t('ancienne photo hors format : signalée « À recadrer », recadrée au centre à l’enregistrement', async () => {
  // [SIMULÉ] photo carrée enregistrée avant la règle (directement en base)
  const sq = Buffer.from((await (async () => { const { PNG } = await import('pngjs'); const p = new PNG({ width: 40, height: 40 }); p.data.fill(120); return PNG.sync.write(p); })()));
  const id = (await local.db.query(`select id from fiila.products where name = 'Sac une photo (test)'`)).rows[0].id;
  await local.db.query(`update fiila.products set photo = $1, photo_type = 'image/png' where id = $2`, [sq, id]);
  await S.goto(URL0 + '#/boutique/article/' + id);
  await S.locator('#product-photo-grid .pp-badge.warn').waitFor();
  await S.locator('#product-photo-off').waitFor();
  await shot(S, '06-a-recadrer');
  await S.click('#product-save');
  await S.getByText('Article mis à jour.').waitFor();
  assert.equal((await local.db.query(`select fiila.ratio_ok(photo) ok from fiila.products where id = $1`, [id])).rows[0].ok, true);
});

await t('aucun débordement à 320 px (édition des photos)', async () => {
  const N = await newPhone(320);
  await N.goto(URL0 + '#/'); 
  await S.setViewportSize({ width: 320, height: 800 });
  await S.goto(URL0 + '#/boutique/articles');
  await S.getByText('Robe trois photos (test)').first().click();
  await S.locator('#product-photo-grid .pp-tile').nth(4).waitFor();
  assert.ok(await noOverflow(S));
  await shot(S, '04-edition-320');
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests photos d’articles réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
