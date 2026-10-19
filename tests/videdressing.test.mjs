// Vide-dressing enfants de bout en bout : une maman propose un vêtement (règle photo), Fii La le publie, une cliente filtre
// « Fille · 2-4 ans » et commande ; le fondateur voit chez qui récupérer l'article ; la vendeuse suit son article.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/vide-dressing';
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
async function signup(p, name, email) {
  await p.goto(URL0 + '#/compte?mode=inscription');
  await p.getByRole('tab', { name: 'Créer un compte' }).click().catch(() => {});
  await p.fill('#acc-name', name); await p.fill('#acc-email', email); await p.fill('#acc-pass', 'motdepasse-test-123');
  await p.click('#auth-submit'); await p.getByText('Compte créé.').waitFor();
}
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function pngFile() { const W = 200, row = Buffer.alloc(1 + W * 3, 0); for (let x = 0; x < W; x++) { row[1 + 3 * x] = 230; row[2 + 3 * x] = 120; row[3 + 3 * x] = 160; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(W, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: W }, () => row)))), chunk('IEND', Buffer.alloc(0))]); }

const V = await newPhone(), F = await newPhone(), C = await newPhone();

await t('vendeuse : compte, photo du vêtement seul (case obligatoire), fille 2-4 ans, prix et montant reçu affiché', async () => {
  await signup(V, 'Fatou Sow', 'fatou.vd@example.invalid');
  await local.db.query(`update fiila.profiles set phone = '77 700 00 01' where display_name = 'Fatou Sow'`);
  await V.goto(URL0 + '#/'); await V.locator('#vd-link-home').click();
  await V.locator('#vd-sell').click();
  await V.locator('#vd-photo input[type=file], input[type=file]').first().setInputFiles({ name: 'robe.png', mimeType: 'image/png', buffer: pngFile() });
  await V.fill('#vd-title', 'Robe fleurie (test)');
  await V.locator('#vd-gender').getByText('Fille').click();
  await V.selectOption('#vd-age', '2-4a');
  await V.fill('#vd-size', '3 ans');
  await V.locator('#vd-cond').getByText('Très bon état').click();
  await V.fill('#vd-price', '4000');
  await V.getByText('Vous recevrez 3 400 FCFA').waitFor();
  await V.click('#vd-send');
  await V.getByText('Confirmez qu’aucun enfant').waitFor();
  await V.check('#vd-photo-ok');
  await shot(V, '01-depot');
  await V.click('#vd-send');
  await V.locator('#vd-mine').getByText('En vérification').waitFor();
});

await t('Fii La : vérifie et publie ; la vitrine « Vide-dressing Fii La » se filtre par genre et âge', async () => {
  await signup(F, 'Fondateur', 'fondateur.vd@example.invalid');
  await local.db.query(`update fiila.profiles set is_admin = true where display_name = 'Fondateur'`);
  await F.goto(URL0 + '#/admin/vide-dressing');
  await F.locator('#vd-queue').getByText('Robe fleurie (test)').waitFor();
  await F.locator('#vd-queue').getByRole('button', { name: 'Publier' }).click();
  await F.getByText('Enregistré.').waitFor();
  await C.goto(URL0 + '#/b/vide-dressing');
  await C.locator('#filter-gender').waitFor();
  await C.locator('#filter-gender').getByRole('button', { name: 'Garçon' }).click();
  await C.getByText('Aucun article pour ce choix.').waitFor();
  await C.locator('#filter-gender').getByRole('button', { name: 'Fille' }).click();
  await C.locator('#filter-age').getByRole('button', { name: '2-4 ans' }).click();
  await C.getByText('Fille · 2-4 ans · Très bon état').waitFor();
  assert.ok(!/Fatou|77 700/.test(await C.locator('body').textContent()), 'vendeuse invisible');
  await shot(C, '02-vitrine');
});

await t('cliente commande ; le fondateur voit chez qui récupérer ; « Livré » puis « Reversé » ; la vendeuse voit « Vendu »', async () => {
  const card = C.locator('article', { hasText: 'Robe fleurie (test)' });
  await card.getByRole('button', { name: '3 ans', exact: true }).click().catch(() => {});
  await card.locator('[data-add]').click();
  await C.click('#cart-go');
  await C.fill('#v-name', 'Cliente (test)'); await C.fill('#v-phone', '70 000 00 81');
  await C.click('#order-send');
  await C.locator('#order-sent').waitFor();
  await F.goto(URL0 + '#/'); await F.goto(URL0 + '#/admin/vide-dressing');
  await F.locator('#vd-orders').getByText('à récupérer chez Fatou Sow (77 700 00 01, ').waitFor().catch(async () => { await F.locator('#vd-orders').getByText('à récupérer chez Fatou Sow').waitFor(); });
  await F.locator('#vd-live').getByRole('button', { name: 'Livré' }).click();
  await F.getByText('Enregistré.').waitFor();
  await F.locator('#vd-pay').getByRole('button', { name: 'Reversé' }).click();
  await F.getByText('Enregistré.').waitFor();
  await shot(F, '03-admin');
  await V.goto(URL0 + '#/'); await V.goto(URL0 + '#/vide-dressing');
  await V.locator('#vd-mine').getByText('Vendu').waitFor();
  await V.locator('#vd-mine').getByText('reversé').waitFor();
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests vide-dressing réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
