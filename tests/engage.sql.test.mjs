// Tests SQL : fil façon Instagram — publications, j'aime, enregistrements, commentaires, classements, garde-fous.
import assert from 'node:assert/strict';
import { createDb, rpc, createUser } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => {
  const r = await rpc(db, fn, args, opt);
  assert.equal(r.status, 400, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
const dev = (n) => ('device' + n).padEnd(24, 'x');
async function user(email, name) {
  const id = await createUser(db, email);
  await db.query(`insert into fiila.profiles (user_id, display_name, is_admin) values ($1, $2, $3)`, [id, name, false]);
  return { uid: id };
}

const KA = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Mode Awa [TEST]', phone: '77 300 00 01' } })).key;
const A1 = await ok('fiila_product_save', { p_key: KA, p: { name: 'Robe [TEST]', price: 15000, photo } });
const A2 = await ok('fiila_product_save', { p_key: KA, p: { name: 'Foulard [TEST]', price: 3000, photo } });
const A3 = await ok('fiila_product_save', { p_key: KA, p: { name: 'Sans photo [TEST]', price: 1000 } });
await ok('fiila_shop_vitrine', { p_key: KA, p: { public: true } });
const KB = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Bijoux Fatou [TEST]', phone: '77 300 00 02' } })).key;
const B1 = await ok('fiila_product_save', { p_key: KB, p: { name: 'Collier [TEST]', price: 8000, photo } });
await ok('fiila_shop_vitrine', { p_key: KB, p: { public: true } });
const SLUG_A = (await db.query(`select slug from fiila.shops where name = 'Mode Awa [TEST]'`)).rows[0].slug;

await t('fil : un article avec photo = une publication, chiffres à zéro, rien de privé', async () => {
  const f = await ok('fiila_posts', { p_tab: 'pour-vous', p_device: dev(1) });
  const ids = f.posts.map((p) => p.id);
  assert.ok(ids.includes(A1.id) && ids.includes(A2.id) && ids.includes(B1.id));
  assert.ok(!ids.includes(A3.id), 'pas de publication sans photo');
  const p = f.posts.find((x) => x.id === A1.id);
  assert.equal(p.likes, 0); assert.equal(p.saves, 0); assert.equal(p.comments, 0); assert.equal(p.sold, undefined);
  assert.equal(p.shop.name, 'Mode Awa [TEST]'); assert.equal(p.shop.slug, SLUG_A);
  const txt = JSON.stringify(f);
  assert.ok(!txt.includes('77 300'), 'aucun numéro'); assert.ok(!txt.includes('base64'), 'aucune photo');
});

await t('j’aime sans compte : compté une fois par téléphone, retiré, « liked » propre à chacun', async () => {
  let r = await ok('fiila_react', { p_product: A1.id, p_kind: 'like', p_on: true, p_device: dev(1) });
  assert.equal(r.likes, 1); assert.equal(r.liked, true);
  r = await ok('fiila_react', { p_product: A1.id, p_kind: 'like', p_on: true, p_device: dev(1) });
  assert.equal(r.likes, 1, 'deux fois le même téléphone = 1');
  await ok('fiila_react', { p_product: A1.id, p_kind: 'like', p_on: true, p_device: dev(2) });
  let f = await ok('fiila_posts', { p_device: dev(1) });
  let p = f.posts.find((x) => x.id === A1.id);
  assert.equal(p.likes, 2); assert.equal(p.liked, true);
  f = await ok('fiila_posts', { p_device: dev(3) });
  assert.equal(f.posts.find((x) => x.id === A1.id).liked, undefined);
  r = await ok('fiila_react', { p_product: A1.id, p_kind: 'like', p_on: false, p_device: dev(2) });
  assert.equal(r.likes, 1);
  await ko('fiila_react', { p_product: A1.id, p_kind: 'like', p_on: true, p_device: 'court' }, 'device_required');
  await ko('fiila_react', { p_product: A3.id, p_kind: 'like', p_on: true, p_device: dev(1) }, 'not_found');
  const raw = (await db.query(`select who from fiila.likes`)).rows.map((x) => x.who).join(' ');
  assert.ok(!raw.includes(dev(1)), 'identifiant de l’appareil jamais gardé en clair');
});

await t('enregistrer : liste « Enregistrés » du téléphone ; avec un compte, suivi sur tous ses appareils', async () => {
  await ok('fiila_react', { p_product: B1.id, p_kind: 'save', p_on: true, p_device: dev(1) });
  const mine = await ok('fiila_saved', { p_device: dev(1) });
  assert.deepEqual(mine.map((x) => x.id), [B1.id]);
  assert.deepEqual(await ok('fiila_saved', { p_device: dev(2) }), []);
  const u = await user('saveur@example.invalid', 'Saveur Test');
  await ok('fiila_react', { p_product: A2.id, p_kind: 'save', p_on: true, p_device: dev(7) }, u);
  assert.deepEqual((await ok('fiila_saved', { p_device: dev(8) }, u)).map((x) => x.id), [A2.id], 'autre téléphone, même compte');
});

const U1 = await user('awa.c@example.invalid', 'Awa Ndiaye');
const U2 = await user('moussa.c@example.invalid', 'Moussa Fall');
let C1;
await t('commenter : compte obligatoire, prénom affiché, pas de lien ni de numéro, 300 caractères', async () => {
  await ko('fiila_comment_add', { p_product: A1.id, p_body: 'Super !' }, 'auth_required');
  C1 = await ok('fiila_comment_add', { p_product: A1.id, p_body: '  Très belle robe, la couleur est superbe.  ' }, U1);
  assert.equal(C1.comments, 1);
  await ko('fiila_comment_add', { p_product: A1.id, p_body: 'Appelez-moi au 77 123 45 67' }, 'comment_contact', U2);
  await ko('fiila_comment_add', { p_product: A1.id, p_body: 'Moins cher sur www.autre-site.sn' }, 'comment_contact', U2);
  await ko('fiila_comment_add', { p_product: A1.id, p_body: 'x'.repeat(301) }, 'comment_too_long', U2);
  await ko('fiila_comment_add', { p_product: A1.id, p_body: '   ' }, 'comment_empty', U2);
  const nameless = { uid: await createUser(db, 'sansnom@example.invalid') };
  await ko('fiila_comment_add', { p_product: A1.id, p_body: 'Bonjour' }, 'name_required', nameless);
  const l = await ok('fiila_comments', { p_product: A1.id }, U2);
  assert.equal(l.comments.length, 1);
  assert.equal(l.comments[0].author, 'Awa', 'prénom seulement');
  assert.equal(l.comments[0].body, 'Très belle robe, la couleur est superbe.');
  assert.equal(l.comments[0].can_delete, undefined, 'un autre membre ne peut pas supprimer');
  assert.ok(!JSON.stringify(l).includes('Ndiaye') && !JSON.stringify(l).includes('example.invalid'), 'ni nom de famille ni e-mail');
  assert.equal((await ok('fiila_comments', { p_product: A1.id }, U1)).comments[0].mine, true);
});

await t('supprimer : l’auteur, la boutique (sa clé), jamais une autre boutique', async () => {
  const c2 = await ok('fiila_comment_add', { p_product: A1.id, p_body: 'Disponible en L ?' }, U2);
  await ko('fiila_comment_delete', { p_id: c2.id, p_key: KB }, 'not_allowed');
  await ko('fiila_comment_delete', { p_id: c2.id }, 'not_allowed', U1);
  const asShop = await ok('fiila_comments', { p_product: A1.id, p_key: KA });
  assert.equal(asShop.shop, true); assert.ok(asShop.comments.every((c) => c.can_delete));
  let r = await ok('fiila_comment_delete', { p_id: c2.id, p_key: KA });
  assert.equal(r.comments, 1);
  const c3 = await ok('fiila_comment_add', { p_product: A1.id, p_body: 'Je me suis trompée' }, U2);
  r = await ok('fiila_comment_delete', { p_id: c3.id }, U2);
  assert.equal(r.comments, 1);
});

await t('signaler : 3 personnes différentes masquent le commentaire ; le même téléphone ne compte qu’une fois', async () => {
  const c = await ok('fiila_comment_add', { p_product: B1.id, p_body: 'Commentaire désagréable' }, U2);
  await ok('fiila_comment_report', { p_id: c.id, p_device: dev(1) });
  await ok('fiila_comment_report', { p_id: c.id, p_device: dev(1) });
  await ok('fiila_comment_report', { p_id: c.id, p_device: dev(2) });
  assert.equal((await ok('fiila_comments', { p_product: B1.id })).comments.length, 1, 'encore visible à 2');
  const r = await ok('fiila_comment_report', { p_id: c.id, p_device: dev(3) });
  assert.equal(r.hidden, true);
  assert.equal((await ok('fiila_comments', { p_product: B1.id })).comments.length, 0);
  const f = await ok('fiila_posts', {});
  assert.equal(f.posts.find((x) => x.id === B1.id).comments, 0, 'masqué = non compté');
});

await t('meilleures ventes : seulement les commandes livrées, 5 au plus par commande ; badge « best »', async () => {
  const mk = async (pid, qty) => (await ok('fiila_vitrine_order', { p_slug: SLUG_A, p: { items: [{ product_id: pid, qty }], customer: { name: 'Cliente [TEST]', phone: '70 000 00 0' + qty } } })).invoice;
  const i1 = await mk(A2.id, 9); const i2 = await mk(A2.id, 2); await mk(A1.id, 3);   // la 3e reste ouverte
  await db.query(`update fiila.orders set status = 'delivered', delivered_at = now() where share_token = any($1)`, [[i1, i2]]);
  const f = await ok('fiila_posts', { p_tab: 'ventes' });
  assert.deepEqual(f.posts.map((p) => p.id), [A2.id], 'commande ouverte non comptée');
  assert.equal(f.posts[0].sold, 7, '5 (plafond) + 2'); assert.equal(f.posts[0].best, true);
  assert.equal((await ok('fiila_product_stats', { p_key: KA, p_id: A2.id })).sold, 7);
  await ko('fiila_product_stats', { p_key: KB, p_id: A2.id }, 'not_found');
});

await t('coups de cœur : j’aime + 2 × enregistrements + 2 × commentaires, sur 14 jours', async () => {
  // A1 : 1 j'aime + 1 commentaire visible = 3 ; B1 : 1 enregistrement = 2 ; A2 : 1 enregistrement (compte) = 2
  await ok('fiila_react', { p_product: A1.id, p_kind: 'save', p_on: true, p_device: dev(4) });   // A1 = 5
  const f = await ok('fiila_posts', { p_tab: 'coeur' });
  assert.equal(f.posts[0].id, A1.id); assert.equal(f.posts[0].heart, true);
  await db.query(`update fiila.likes set created_at = now() - interval '20 days'`);
  await db.query(`update fiila.saves set created_at = now() - interval '20 days'`);
  await db.query(`update fiila.comments set created_at = now() - interval '20 days'`);
  const old = await ok('fiila_posts', { p_tab: 'coeur' });
  assert.equal(old.posts.length, 0, 'réactions de plus de 14 jours : plus de coup de cœur');
  assert.equal((await ok('fiila_posts', {})).posts.find((p) => p.id === A1.id).likes, 1, 'le total reste affiché');
});

await t('boutique sortie du fil ou vitrine fermée : ses publications disparaissent, plus de réaction possible', async () => {
  await ok('fiila_shop_vitrine', { p_key: KB, p: { public: false } });
  const f = await ok('fiila_posts', {});
  assert.ok(!f.posts.some((p) => p.id === B1.id));
  await ko('fiila_react', { p_product: B1.id, p_kind: 'like', p_on: true, p_device: dev(1) }, 'not_found');
  assert.deepEqual(await ok('fiila_saved', { p_device: dev(1) }), [], 'enregistrement masqué tant que la vitrine est fermée');
  await ok('fiila_shop_vitrine', { p_key: KB, p: { public: true } });
});

await t('« pour vous » : 3 articles au plus par boutique en tête, puis le reste', async () => {
  for (let i = 0; i < 4; i++) await ok('fiila_product_save', { p_key: KA, p: { name: `Nouveau ${i} [TEST]`, price: 100 + i, photo } });
  const f = await ok('fiila_posts', {});
  const head = f.posts.slice(0, 4).map((p) => p.shop.name);
  assert.ok(head.includes('Bijoux Fatou [TEST]'), 'l’autre boutique apparaît avant le 4e article de la première');
});

await t('modération : file réservée à l’admin (masqués et signalés), rétablir efface les signalements, supprimer', async () => {
  const id = await createUser(db, 'admin.fil@example.invalid');
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Admin Test')`, [id]);
  await db.query(`insert into fiila.staff (user_id, role) values ($1, 'moderation')`, [id]);
  const ADM = { uid: id };
  await ko('fiila_admin_comments', {}, 'not_allowed', U2);
  await ko('fiila_admin_comments', {}, 'auth_required');
  const c = await ok('fiila_comment_add', { p_product: A2.id, p_body: 'Signalé une fois' }, U2);
  await ok('fiila_comment_report', { p_id: c.id, p_device: dev(5) });
  let q = await ok('fiila_admin_comments', {}, ADM);
  assert.equal(q[0].hidden, true, 'le masqué (3 signalements) en tête');
  assert.equal(q[0].reports, 3);
  const once = q.find((x) => x.id === c.id);
  assert.equal(once.reports, 1); assert.equal(once.hidden, false); assert.equal(once.product, 'Foulard [TEST]');
  await ok('fiila_admin_comment_decide', { p_id: q[0].id, p_action: 'restore' }, ADM);
  assert.equal((await ok('fiila_comments', { p_product: B1.id })).comments.length, 1, 'rétabli et visible');
  await ok('fiila_admin_comment_decide', { p_id: c.id, p_action: 'delete' }, ADM);
  q = await ok('fiila_admin_comments', {}, ADM);
  assert.equal(q.length, 0, 'file vide');
  await ko('fiila_admin_comment_decide', { p_id: c.id, p_action: 'delete' }, 'not_found', ADM);
});

await t('suppression d’un compte : ses commentaires partent avec lui', async () => {
  await db.query(`delete from auth.users where id = $1`, [U1.uid]);
  assert.equal((await ok('fiila_comments', { p_product: A1.id })).comments.length, 0);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL fil social réussis`);
process.exit(passed === results.length ? 0 : 1);
