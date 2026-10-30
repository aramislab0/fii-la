// Modèle Premium « Concept » dans le navigateur (fondateur, 29/10/2026 20:38) : rayons qui défilent de côté, une rangée
// par rubrique propre à la boutique, « Tout voir » en grille, carte allégée, fiche avec « Ajouter », boutons noirs par
// défaut, animations (cœur, envol vers le panier) ; côté boutique : rubrique en pastilles dans la fiche article, style du
// modèle dans « Personnaliser mon site ». Captures iPhone : docs/screenshots/concept/.
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
const SHOTS = 'docs/screenshots/concept';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const phone = devices['iPhone 13'];
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone(opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent,
    locale: 'fr-FR', serviceWorkers: 'block', colorScheme: 'light' }, opts || {}));
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name, full) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: !!full });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');

// Boutique synthétique (supprimée à l'arrêt du serveur de test) : Premium, modèle Concept, 3 rubriques.
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Concept Démo (test)', business_type: 'mode' } });
const KEY = S.key;
const save = (p) => ok('fiila_product_save', { p_key: KEY, p: Object.assign({ photo }, p) });
const RUB = { Sacs: 12, 'Gourdes & mugs': 5, Beauté: 3 };
const ids = {};
for (const [r, n] of Object.entries(RUB)) for (let i = 1; i <= n; i++) { const x = await save({ name: r + ' ' + i + ' (test)', price: 1000 * i, rubric: r, category: 'accessoires' }); ids[r + i] = x.id; }
await save({ name: 'Sans rubrique (test)', price: 500, category: 'accessoires' });
await local.db.query(`update fiila.products set created_at = now() - interval '30 days' where shop_id = $1`, [S.shop.id]);
await local.db.query(`update fiila.shops set plan = 'premium' where id = $1`, [S.shop.id]);
const V = await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true, theme: 'concept', accent: 'noir' } });
const SITE = URL0 + '#/b/' + V.slug;

const C = await newPhone();
await t('rayons : Derniers ajouts puis une rangée par rubrique (la plus grande d’abord), « Autres articles » en dernier', async () => {
  await C.goto(SITE);
  await C.locator('#rail-nav').waitFor();
  assert.deepEqual(await C.locator('.vrail-h h2').allTextContents(), ['Derniers ajouts', 'Sacs', 'Gourdes & mugs', 'Beauté', 'Autres articles']);
  assert.deepEqual(await C.locator('#rail-nav .opt').allTextContents(), ['Derniers ajouts', 'Sacs', 'Gourdes & mugs', 'Beauté', 'Autres articles']);
  assert.equal(await C.locator('[data-rail="Sacs"]').count(), 0);
  assert.equal(await C.locator('section[data-rail="r:Sacs"] .rcard').count(), 10, '10 articles par rangée (site_rail)');
  assert.equal(await C.locator('section[data-rail="r:Sacs"] [data-all]').textContent(), 'Tout voir · 12');
  assert.equal(await C.locator('section[data-rail="r:Beauté"] [data-all]').count(), 0, 'rubrique courte : pas de « Tout voir »');
  assert.equal(await C.locator('.vrail-track').first().evaluate((el) => getComputedStyle(el).overflowX), 'auto', 'la rangée défile de côté');
  assert.equal(await C.locator('.add-btn').count(), 0, 'carte allégée : pas de bouton Ajouter');
  assert.equal(await C.locator('.brand-bar .logo').count(), 0, 'Premium : pas de logo Fii en tête (fondateur, 30/10)');
  assert.match(await C.locator('#made-by .made-by').getAttribute('aria-label'), /Conçu par Fii Boutique/);
  const bg = await C.locator('#rail-nav .rind').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(14, 14, 14)', 'boutons noirs par défaut');
  await C.waitForTimeout(500);
  await shot(C, '01-rayons');
});

await t('« Tout voir » : toute la rubrique en grille ; « Tous les rayons » revient aux rangées', async () => {
  await C.locator('section[data-rail="r:Sacs"] [data-all]').click();
  await C.locator('#rail-back').waitFor();
  assert.equal(await C.locator('#vitrine-products .rcard').count(), 12);
  assert.equal(await C.locator('#filter-cat .opt.on').textContent(), 'Sacs');
  await shot(C, '02-tout-voir');
  await C.click('#rail-back');
  await C.locator('#rail-nav').waitFor();
});

await t('cœur : favori avec éclats de petits cœurs (animations du modèle)', async () => {
  const heart = C.locator('section[data-rail="r:Sacs"] .vheart').first();
  await heart.click();
  assert.ok(await C.locator('.vmini').count() > 0, 'éclats');
  await C.waitForTimeout(800);
  assert.equal(await C.locator('.vmini').count(), 0, 'éclats retirés');
  assert.equal(await heart.getAttribute('aria-pressed'), 'true');
});

await t('fiche : « Ajouter à la commande », la photo s’envole vers le panier, barre « Commander »', async () => {
  await C.locator('section[data-rail="r:Gourdes & mugs"] .rname').first().click();
  await C.locator('#product-sheet').waitFor();
  await C.click('#sheet-add');
  await C.locator('#cart-go').getByText('1 article').waitFor();
  await C.waitForTimeout(800);
  assert.equal(await C.locator('.vfly').count(), 0, 'image volante retirée');
  await shot(C, '03-panier');
});

await t('animations coupées par la boutique : pas d’éclats ; coins droits', async () => {
  await ok('fiila_shop_vitrine', { p_key: KEY, p: { style: { anim: false, corners: 'nets' } } });
  const D = await newPhone();
  await D.goto(SITE);
  await D.locator('#rail-nav').waitFor();
  assert.equal(await D.locator('.vt-anim').count(), 0);
  assert.equal(await D.locator('.vt-sharp').count(), 1);
  await D.locator('.vheart').first().click();
  assert.equal(await D.locator('.vmini').count(), 0);
  await ok('fiila_shop_vitrine', { p_key: KEY, p: { style: {} } });
});

await t('fiche article de la boutique : rubrique en pastilles (celles déjà utilisées) et nouvelle rubrique', async () => {
  const B = await newPhone();
  await B.goto(URL0);
  await B.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), KEY);
  await B.goto(URL0 + '#/boutique/article/' + ids.Beauté1);
  await B.locator('#product-rubric [data-v="Sacs"]').waitFor();
  assert.equal(await B.locator('#product-rubric [data-v="Beauté"]').getAttribute('aria-checked'), 'true');
  await B.fill('#product-rubric-add', 'Bijoux');
  await B.press('#product-rubric-add', 'Enter');
  assert.equal(await B.locator('#product-rubric [data-v="Bijoux"]').getAttribute('aria-checked'), 'true');
  await shot(B, '04-fiche-rubrique');
  await B.click('#product-save');
  await B.waitForURL(/#\/boutique\/articles/);
  const r = (await local.db.query(`select rubric from fiila.products where id = $1`, [ids.Beauté1])).rows[0];
  assert.equal(r.rubric, 'Bijoux');

  await t('Personnaliser mon site : style du modèle Concept (coins, animations, cœurs) enregistré', async () => {
    await B.goto(URL0 + '#/boutique/vitrine');
    await B.locator('#look-style').waitFor();
    assert.equal(await B.locator('#look-corners [data-v="doux"]').getAttribute('aria-checked'), 'true');
    await B.click('#look-season');
    await B.click('#look-save');
    await B.getByText('Site enregistré.').waitFor();
    const st = (await local.db.query(`select style from fiila.shops where id = $1`, [S.shop.id])).rows[0].style;
    assert.deepEqual(st, { corners: 'doux', anim: true, season: true });
    await B.locator('#look-style').scrollIntoViewIfNeeded();
    await shot(B, '05-style');
  });
});

await t('aucune erreur JavaScript', async () => {
  const errs = pages.flatMap((p) => p.__errors);
  assert.deepEqual(errs, []);
});

await browser.close();
local.server.close();
console.log(`\n${failed ? 'ÉCHEC' : 'OK'} — modèle Concept (navigateur, ${ENGINE})`);
process.exit(failed ? 1 : 0);
