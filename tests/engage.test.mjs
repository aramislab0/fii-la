// Fil façon Instagram de bout en bout : publications, j'aime (bouton et double toucher), enregistrés, onglets
// Meilleures ventes et Coups de cœur, commentaires (compte, garde-fous, suppression par la boutique, signalement).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { passMfa } from './bo-mfa.mjs';
import { rpc, createUser } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { PNG } = require('pngjs');
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/fil-social';
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
  page.on('dialog', (d) => d.accept());
  pages.push(page);
  return page;
}
const shot = (page, name, full = false) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: full });
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
// Photo synthétique : dégradé de deux couleurs (PNG sans métadonnées).
function photo(c1, c2) {
  const png = new PNG({ width: 240, height: 300 }); // format 4:5
  for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) {
    const k = (x + y) / 480, i = (y * 240 + x) * 4;
    for (let j = 0; j < 3; j++) png.data[i + j] = Math.round(c1[j] * (1 - k) + c2[j] * k);
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}
async function signup(p, name, email) {
  await p.goto(URL0 + '#/compte?mode=inscription&retour=boutiques');
  await p.getByRole('tab', { name: 'Créer un compte' }).click().catch(() => {});
  await p.fill('#acc-name', name);
  await p.fill('#acc-email', email);
  await p.fill('#acc-pass', 'motdepasse-test-123');
  await p.click('#auth-submit');
  await p.getByText('Compte créé.').waitFor();
}

const KEY = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Mode Awa (test)', phone: '77 400 00 01', business_type: 'mode' } })).key;
const P1 = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Robe wax (test)', price: 15000, photo: photo([196, 84, 46], [242, 190, 90]) } });
const P2 = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Boubou brodé (test)', price: 25000, photo: photo([30, 74, 52], [201, 226, 101]) } });
await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true, accent: 'terre' } });
const SLUG = (await local.db.query(`select slug from fiila.shops where name = 'Mode Awa (test)'`)).rows[0].slug;
// Une vente livrée de P2 (le classement ne compte que les commandes livrées).
const inv = (await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: P2.id, qty: 1 }], customer: { name: 'Cliente (test)', phone: '70 000 00 41' } } })).invoice;
await local.db.query(`update fiila.orders set status = 'delivered', delivered_at = now() where share_token = $1`, [inv]);

const A = await newPhone();
await t('fil : une publication par article (boutique, photo, actions, prix, « Commander »), une seule rangée d’onglets', async () => {
  await A.goto(URL0 + '#/boutiques');
  await A.locator(`#post-${P2.id} .post-img img`).waitFor();
  assert.equal(await A.locator('#posts .post').count(), 2);
  assert.equal(await A.locator('#feed-tabs [role="tab"]').count(), 3);
  assert.equal(await A.locator('.opt-row').count(), 0, 'les onglets sont la seule rangée de choix');
  const post = A.locator(`#post-${P1.id}`);
  await post.getByText('Mode Awa (test)').waitFor();
  await post.getByText('15 000 FCFA').waitFor();
  await post.getByText('Ajouter un commentaire').waitFor();
  assert.match(await A.getAttribute(`#buy-${P1.id}`, 'href'), new RegExp('#/b/' + SLUG + '\\?a=' + P1.id));
  assert.equal(await A.evaluate(() => localStorage.getItem('fiila.device')), null, 'aucun identifiant créé avant un geste');
  await shot(A, '01-fil');
});

await t('favori (un seul cœur, Fii Édition) : bouton, puis double toucher sur la photo ; gardé après rechargement', async () => {
  assert.equal(await A.locator(`#save-${P1.id}`).count(), 0, 'plus de bouton « Enregistrer » séparé');
  await A.click(`#like-${P1.id}`);
  await A.locator(`#post-${P1.id} .post-likes`).getByText('1 favori').waitFor();
  assert.equal(await A.getAttribute(`#like-${P1.id}`, 'aria-pressed'), 'true');
  await A.locator(`#post-${P2.id} .post-img`).dblclick();
  await A.locator(`#post-${P2.id} .post-likes`).getByText('1 favori').waitFor();
  await A.waitForTimeout(400);
  await A.reload();
  await A.locator(`#like-${P1.id}[aria-pressed="true"]`).waitFor();
  await A.locator(`#like-${P2.id}[aria-pressed="true"]`).waitFor();
  await A.click(`#like-${P2.id}`);
  await A.locator(`#like-${P2.id}[aria-pressed="false"]`).waitFor();
  await A.locator(`#post-${P2.id} .post-likes`).waitFor({ state: 'hidden' });
});

await t('« Mes favoris » montre l’article (un cœur = J’aime + Enregistrer), qui ouvre la vitrine sur lui', async () => {
  await A.click(`#like-${P2.id}`);
  await A.getByText('Ajouté à vos favoris.').waitFor();
  await A.locator(`#post-${P2.id} .post-likes`).getByText('1 favori').waitFor();
  await A.click('#saved-link');
  await A.locator('#saved-grid .saved-tile').first().waitFor();
  assert.equal(await A.locator('#saved-grid .saved-tile').count(), 2, 'P1 et P2 en favoris');
  await A.locator('#saved-grid .saved-img img').first().waitFor();
  await shot(A, '02-enregistres');
  await A.locator('#saved-grid .saved-tile').first().click();
  await A.locator(`#p-${P2.id}.focus`).waitFor();
});

await t('onglets : Meilleures ventes (commande livrée) et Coups de cœur, avec leurs badges', async () => {
  await A.goto(URL0 + '#/boutiques');
  await A.click('#tab-ventes');
  await A.locator('#tab-ventes[aria-selected="true"]').waitFor();
  await A.locator(`#post-${P2.id}`).getByText('Best-seller · 1 vendu').waitFor();
  assert.equal(await A.locator('#posts .post').count(), 1, 'seul l’article livré');
  await shot(A, '03-meilleures-ventes');
  await A.click('#tab-coeur');
  await A.locator('#tab-coeur[aria-selected="true"]').waitFor();
  await A.locator(`#post-${P1.id}`).waitFor();
  assert.equal(await A.locator('#posts .post').count(), 2, 'P1 et P2 en favoris');
  await A.locator(`#post-${P1.id}`).getByText('Coup de cœur').waitFor();
  await shot(A, '04-coups-de-coeur');
});

const C = await newPhone();
let SHOP;
await t('commentaires : lecture sans compte, compte demandé pour écrire ; prénom affiché ; ni lien ni numéro', async () => {
  await C.goto(URL0 + '#/boutiques');
  await C.click(`#comments-${P1.id}`);
  await C.locator('#cm-empty').waitFor();
  await C.locator('#cm-login').waitFor();
  await signup(C, 'Coumba Sarr', 'coumba.fil@example.invalid');
  await C.locator('#feed-tabs').waitFor();
  await C.click(`#comments-${P1.id}`);
  await C.fill('#cm-input', 'Appelez-moi au 77 123 45 67');
  await C.click('#cm-send');
  await C.getByText('Pas de lien ni de numéro dans un commentaire').waitFor();
  await C.fill('#cm-input', 'Très jolie, la coupe est belle.');
  await C.click('#cm-send');
  await C.locator('#cm-list').getByText('Très jolie, la coupe est belle.').waitFor();
  await C.locator('#cm-list').getByText('Coumba', { exact: true }).waitFor();
  assert.equal(await C.locator('#cm-list').getByText('Sarr').count(), 0, 'prénom seulement');
  await shot(C, '05-commentaires');
  await C.locator('#comments-sheet .cm-top button').click();
  await C.locator(`#comments-${P1.id}`).getByText('Voir le commentaire').waitFor();
});

await t('la boutique supprime un commentaire sur son article ; une autre personne peut signaler', async () => {
  const R = await newPhone();
  await R.goto(URL0 + '#/boutiques');
  await R.click(`#comments-${P1.id}`);
  await R.locator('#cm-list').getByText('Très jolie').waitFor();
  assert.equal(await R.locator('#cm-list').getByRole('button', { name: 'Signaler ce commentaire' }).count(), 0, 'signaler demande un compte');
  await signup(R, 'Rokhaya Test', 'rokhaya.fil@example.invalid');
  await R.goto(URL0 + '#/boutiques');
  await R.click(`#comments-${P1.id}`);
  await R.locator('#cm-list').getByText('Très jolie').waitFor();
  assert.equal(await R.locator('#cm-list').getByRole('button', { name: 'Supprimer' }).count(), 0, 'pas de suppression pour une autre personne');
  await R.locator('#cm-list').getByRole('button', { name: 'Signaler ce commentaire' }).click();
  await R.getByText('Merci. Le commentaire sera vérifié.').waitFor();
  const S = SHOP = await newPhone();
  await S.goto(URL0 + '#/');
  await S.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), KEY);
  await S.goto(URL0 + '#/boutiques');
  await S.click(`#comments-${P1.id}`);
  await S.locator('#cm-list').getByRole('button', { name: 'Supprimer' }).click();
  await S.getByText('Commentaire supprimé.').waitFor();
  await S.locator('#cm-empty').waitFor();
});

await t('modération : le fondateur voit le commentaire masqué (3 signalements) et le rétablit', async () => {
  const uid = await createUser(local.db, 'ndeye.fil@example.invalid');
  await local.db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Ndèye Test')`, [uid]);
  const c = await rpc(local.db, 'fiila_comment_add', { p_product: P2.id, p_body: 'Avis à vérifier' }, { uid });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  for (const n of ['r1', 'r2', 'r3']) {
    const rid = await createUser(local.db, n + '.fil@example.invalid');
    const rr = await rpc(local.db, 'fiila_comment_report', { p_id: c.body.id }, { uid: rid });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
  }
  const F = await newPhone();
  await signup(F, 'Fondateur Test', 'fondateur.fil@example.invalid');
  await local.db.query(`insert into fiila.staff (user_id, role) select id, 'super_admin' from auth.users where email = 'fondateur.fil@example.invalid'`);
  await F.goto(URL0 + '#/bo');
  await passMfa(F, 'fondateur.fil@example.invalid');
  await F.click('#bo-menu');
  await F.click('#bo-nav-moderation');
  const card = F.locator('#mod-' + c.body.id);
  await card.getByText('Masqué · 3 signalements').waitFor();
  await shot(F, '06-moderation', true);
  await card.getByRole('button', { name: 'Rétablir' }).click();
  await F.getByText('Commentaire rétabli.').waitFor();
  await F.locator('#mod-empty').waitFor();
  const l = await ok('fiila_comments', { p_product: P2.id });
  assert.equal(l.comments.length, 1);
});

await t('page de l’article (boutique) : une ligne « Dans le fil »', async () => {
  const S = SHOP;
  await S.goto(URL0 + '#/boutique/article/' + P2.id);
  await S.locator('#product-stats').getByText(/Dans le fil : .*1 favori.*1 vendu/).waitFor();
});

await t('Fii Édition : « Suivre » la boutique depuis son site (abonnés), cœur sur le site, « Boutiques suivies » ; modèle Édition', async () => {
  const V = await newPhone();
  await V.goto(URL0 + '#/b/' + SLUG);
  await V.locator('#vitrine-follow .follow-btn').waitFor();
  assert.equal(await V.textContent('#vitrine-follow .follow-btn'), 'Suivre');
  await V.click('#vitrine-follow .follow-btn');
  await V.locator('#vitrine-follow .follow-btn[aria-pressed="true"]').getByText('Suivi').waitFor();
  await V.locator('#vitrine-follow [data-followers]').getByText('1 abonné').waitFor();
  await V.click(`.vheart[data-fav="${P1.id}"]`);
  await V.locator(`.vheart[data-fav="${P1.id}"][aria-pressed="true"]`).waitFor();
  await V.reload();
  await V.locator(`.vheart[data-fav="${P1.id}"][aria-pressed="true"]`).waitFor();
  await V.locator('#vitrine-follow .follow-btn[aria-pressed="true"]').waitFor();
  await V.goto(URL0 + '#/enregistres');
  await V.locator('#followed .followed').getByText('Mode Awa (test)').waitFor();
  await V.locator('#saved-grid .saved-tile').first().waitFor();
  await shot(V, '06-favoris-suivies');
  await local.db.query(`update fiila.shops set plan = 'premium', theme = 'edition' where slug = $1`, [SLUG]);
  await V.goto(URL0 + '#/'); await V.goto(URL0 + '#/b/' + SLUG);
  await V.locator('.vt-edition #vitrine-products').waitFor();
  assert.equal(await V.evaluate(() => document.documentElement.getAttribute('data-vt')), 'edition');
  await shot(V, '07-modele-edition');
  await local.db.query(`update fiila.shops set plan = 'free', theme = 'galerie' where slug = $1`, [SLUG]);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests fil social réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
