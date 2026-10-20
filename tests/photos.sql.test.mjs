// Tests SQL : jusqu'à 5 photos par article (principale + 4), ordre, retrait, promotion de la première, lecture publique
// photo par photo (vitrine et fil), écran de la boutique, droits (autre boutique, article masqué).
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
// Petites images PNG distinctes (un octet de remplissage différent pour les reconnaître).
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const ph = (n) => Buffer.concat([png, Buffer.alloc(120, n)]).toString('base64');
const tag = (dataUrl) => Buffer.from(dataUrl.replace(/^data:[^,]+,/, ''), 'base64').at(-1);
let SK, SLUG, P;

await t('5 photos : principale + 4 supplémentaires, dans l’ordre ; plus de 4 supplémentaires refusé', async () => {
  SK = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Photos [TEST]' } })).key;
  await ok('fiila_shop_vitrine', { p_key: SK, p: { public: true } });
  SLUG = (await db.query(`select slug from fiila.shops where name = 'Boutique Photos [TEST]'`)).rows[0].slug;
  P = await ok('fiila_product_save', { p_key: SK, p: { name: 'Robe [TEST]', price: 15000, photo: ph(1), photos: [ph(2), ph(3), ph(4), ph(5)] } });
  assert.equal(P.photos, 5);
  const extra = await ok('fiila_product_photos', { p_key: SK, p_id: P.id });
  assert.deepEqual(extra.map(tag), [2, 3, 4, 5]);
  await ko('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe [TEST]', price: 15000, photos: [ph(2), ph(3), ph(4), ph(5), ph(6)] } }, 'too_many_photos');
  // sans « photos » : inchangées
  const again = await ok('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe bleue [TEST]', price: 15000 } });
  assert.equal(again.photos, 5);
});

await t('vitrine et fil : nombre de photos, chaque photo lue à part (« id:n »)', async () => {
  const v = await ok('fiila_vitrine', { p_slug: SLUG });
  const it = v.products.find((x) => x.id === P.id);
  assert.equal(it.photos, 5); assert.equal(it.has_photo, true);
  assert.equal(tag((await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: P.id })).photo), 1);
  for (let n = 1; n <= 4; n++) assert.equal(tag((await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: P.id + ':' + n })).photo), n + 1);
  assert.deepEqual(await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: P.id + ':5' }), {}, 'position inexistante');
  assert.deepEqual(await ok('fiila_vitrine_photo', { p_slug: 'autre', p_id: P.id + ':1' }), {}, 'autre vitrine');
  // fil : la boutique y apparaît si elle est mise en avant
  await db.query(`update fiila.shops set feed = true, featured_rank = 1 where slug = $1`, [SLUG]);
  const posts = (await ok('fiila_posts', {})).posts;
  assert.equal(posts.find((x) => x.id === P.id).photos, 5);
});

await t('réordonner, retirer ; sans principale, la première supplémentaire la remplace', async () => {
  let r = await ok('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe [TEST]', price: 15000, photo: ph(4), photos: [ph(1), ph(2)] } });
  assert.equal(r.photos, 3); assert.equal(tag(r.photo), 4);
  r = await ok('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe [TEST]', price: 15000, photo: '', photos: [ph(7), ph(8)] } });
  assert.equal(r.photos, 2); assert.equal(tag(r.photo), 7, 'promue');
  assert.deepEqual((await ok('fiila_product_photos', { p_key: SK, p_id: P.id })).map(tag), [8]);
  r = await ok('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe [TEST]', price: 15000, photos: [] } });
  assert.equal(r.photos, undefined, 'une seule photo : pas de carrousel');
  // une seule photo : la vitrine n'annonce pas de carrousel
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).products.find((x) => x.id === P.id).photos, undefined);
});

await t('droits : autre boutique, article masqué, photo trop lourde ou invalide', async () => {
  await ok('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe [TEST]', price: 15000, photos: [ph(2)] } });
  const K2 = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Autre [TEST]' } })).key;
  await ko('fiila_product_photos', { p_key: K2, p_id: P.id }, 'product_not_found');
  await ok('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe [TEST]', price: 15000, active: false } });
  assert.deepEqual(await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: P.id + ':1' }), {}, 'article masqué');
  await ko('fiila_product_save', { p_key: SK, p: { id: P.id, name: 'Robe [TEST]', price: 15000, photos: [Buffer.from('pas une image'.repeat(20)).toString('base64')] } }, 'photo_invalid');
  // suppression de l'article : ses photos partent avec lui
  await ok('fiila_product_delete', { p_key: SK, p_id: P.id });
  assert.equal((await db.query(`select count(*)::int n from fiila.product_photos`)).rows[0].n, 0);
});

await t('format 4:5 : photo carrée ou paysage refusée (principale, supplémentaire) ; dimensions JPEG et PNG lues', async () => {
  const sq = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const square = Buffer.concat([sq, Buffer.alloc(120, 9)]).toString('base64');
  await ko('fiila_product_save', { p_key: SK, p: { name: 'Carré [TEST]', price: 1000, photo: square } }, 'photo_ratio');
  await ko('fiila_product_save', { p_key: SK, p: { name: 'Carré [TEST]', price: 1000, photo: ph(1), photos: [square] } }, 'photo_ratio');
  // JPEG minimal : FFD8, APP0, puis SOF0 (hauteur 1350, largeur 1080) ; puis 1080 × 1080
  const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const d = (await db.query(`select (fiila.img_dims($1)).*, fiila.ratio_ok($1) ok`, [jpeg(1080, 1350)])).rows[0];
  assert.deepEqual([d.w, d.h, d.ok], [1080, 1350, true]);
  assert.equal((await db.query(`select fiila.ratio_ok($1) ok`, [jpeg(1080, 1080)])).rows[0].ok, false);
  assert.equal((await db.query(`select fiila.ratio_ok($1) ok`, [jpeg(864, 1080)])).rows[0].ok, true);
  const p = (await db.query(`select (fiila.img_dims($1)).*`, [Buffer.from(ph(1), 'base64')])).rows[0];
  assert.deepEqual([p.w, p.h], [4, 5]);
});

await t('back-office : articles hors format comptés sur la fiche boutique et au tableau de bord', async () => {
  const id = await createUser(db, 'staff.photos@example.invalid');
  await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [id]);
  const STAFF = { uid: id };
  const P2 = await ok('fiila_product_save', { p_key: SK, p: { name: 'Ancien [TEST]', price: 1000, photo: ph(3) } });
  const shopId = (await db.query(`select shop_id from fiila.products where id = $1`, [P2.id])).rows[0].shop_id;
  assert.equal((await ok('fiila_bo_shop', { p_id: shopId }, STAFF)).stats.off_format, 0);
  const sq = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(120, 9)]);
  await db.query(`update fiila.products set photo = $1 where id = $2`, [sq, P2.id]); // [SIMULÉ] photo d'avant la règle
  assert.equal((await ok('fiila_bo_shop', { p_id: shopId }, STAFF)).stats.off_format, 1);
  assert.ok((await ok('fiila_bo_overview', {}, STAFF)).kpis.off_format >= 1);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL photos d’articles réussis`);
process.exit(passed === results.length ? 0 : 1);
