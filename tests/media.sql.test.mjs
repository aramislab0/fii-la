// Tests SQL : photos publiques dans Supabase Storage (22/10/2026). File d'attente réservée à la clé de service, adresse
// enregistrée seulement si la photo n'a pas changé, adresse servie à la place du base64, retour arrière par réglage,
// photo modifiée = nouvelle copie, photos orphelines retirées, état au back-office (droit « settings »).
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { createHash } from 'node:crypto';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const SVC = { role: 'service_role' };
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = (n) => Buffer.concat([png, Buffer.alloc(200 + n)]).toString('base64');
const BASE = 'https://exemple.supabase.co/storage/v1/object/public/media/';
let S, P, item, F;

await t('file d’attente : photo principale et supplémentaire en attente, lisibles par la clé de service seulement', async () => {
  S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Photos [TEST]', business_type: 'mode' } });
  P = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe [TEST]', price: 1000, photo: photo(1), photos: [photo(2)] } });
  const q = await ok('fiila_media_pending', { p_limit: 8 }, SVC);
  assert.deepEqual(q.map((x) => x.kind).sort(), ['product', 'product_extra']);
  item = q.find((x) => x.kind === 'product');
  assert.equal(item.ref, P.id); assert.equal(item.ctype, 'image/png'); assert.match(item.hash, /^[0-9a-f]{32}$/);
  assert.equal(Buffer.from(item.b64, 'base64').toString('base64'), photo(1));
  await ko('fiila_media_pending', { p_limit: 8 });
  await ko('fiila_media_done', { p_kind: 'product', p_ref: P.id, p_hash: item.hash, p_path: `p/${P.id}-${item.hash}.png`, p_bytes: 10 });
});

await t('copie faite : adresse enregistrée si l’empreinte correspond ; chemin contrôlé ; lecture par adresse fixe', async () => {
  await ko('fiila_media_done', { p_kind: 'product', p_ref: P.id, p_hash: item.hash, p_path: '../../secret.png', p_bytes: 10 }, 'invalid', SVC);
  let r = await ok('fiila_media_done', { p_kind: 'product', p_ref: P.id, p_hash: '0'.repeat(32), p_path: `p/${P.id}-${'0'.repeat(32)}.png`, p_bytes: 10 }, SVC);
  assert.equal(r.linked, false, 'empreinte périmée : pas d’adresse');
  r = await ok('fiila_media_done', { p_kind: 'product', p_ref: P.id, p_hash: item.hash, p_path: `p/${P.id}-${item.hash}.png`, p_bytes: 321 }, SVC);
  assert.equal(r.linked, true);
  // Sans adresse de base (environnement local), la photo reste servie comme avant.
  let list = await ok('fiila_products', { p_key: S.key, p_all: true });
  assert.match(list.find((x) => x.id === P.id).photo, /^data:image\/png;base64,/);
  await db.query(`insert into fiila.settings (key, value) values ('media_base', $1)`, [BASE]);
  list = await ok('fiila_products', { p_key: S.key, p_all: true });
  assert.equal(list.find((x) => x.id === P.id).photo, `${BASE}p/${P.id}-${item.hash}.png`);
  F = await user('fondateur@example.test', 'super_admin');
  await ok('fiila_bo_setting_set', { p_key: 'media_cdn', p_value: 0 }, F);
  list = await ok('fiila_products', { p_key: S.key, p_all: true });
  assert.match(list.find((x) => x.id === P.id).photo, /^data:/, 'media_cdn = 0 : retour à la base');
  await db.query(`update fiila.settings set value = '1' where key = 'media_cdn'`);
});

await t('photo supplémentaire et couverture : copie puis adresse ; vitrine publique servie par adresse', async () => {
  const q = await ok('fiila_media_pending', {}, SVC);
  const ex = q.find((x) => x.kind === 'product_extra');
  assert.equal(ex.ref, P.id + ':1');
  assert.equal((await ok('fiila_media_done', { p_kind: 'product_extra', p_ref: ex.ref, p_hash: ex.hash, p_path: `p/${P.id}-1-${ex.hash}.png`, p_bytes: 300 }, SVC)).linked, true);
  assert.equal((await one(`select value from fiila.settings where key = 'media_cdn'`)).value, '1');
  const extra = await ok('fiila_product_photos', { p_key: S.key, p_id: P.id });
  assert.deepEqual(extra, [`${BASE}p/${P.id}-1-${ex.hash}.png`]);
  await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true, cover: photo(3) } });
  const c = (await ok('fiila_media_pending', {}, SVC)).find((x) => x.kind === 'cover');
  await ok('fiila_media_done', { p_kind: 'cover', p_ref: c.ref, p_hash: c.hash, p_path: `c/${c.ref}-${c.hash}.png`, p_bytes: 300 }, SVC);
  const slug = (await one(`select slug from fiila.shops where id = $1`, [c.ref])).slug;
  assert.equal((await ok('fiila_vitrine_photo', { p_slug: slug, p_id: 'cover' })).photo, `${BASE}c/${c.ref}-${c.hash}.png`);
  assert.equal((await ok('fiila_vitrine_photo', { p_slug: slug, p_id: P.id })).photo, `${BASE}p/${P.id}-${item.hash}.png`);
  assert.deepEqual(await ok('fiila_media_pending', {}, SVC), []);
});

await t('photo remplacée : nouvelle copie ; l’ancienne devient orpheline puis est retirée', async () => {
  await ok('fiila_product_save', { p_key: S.key, p: { id: P.id, name: 'Robe [TEST]', price: 1000, photo: photo(9) } });
  const q = await ok('fiila_media_pending', {}, SVC);
  assert.ok(q.some((x) => x.kind === 'product' && x.ref === P.id), 'nouvelle version en attente');
  assert.deepEqual(await ok('fiila_media_orphans', {}, SVC), [], 'pas avant 10 minutes');
  await db.query(`update fiila.media_objects set created_at = now() - interval '1 hour'`);
  const orphans = await ok('fiila_media_orphans', {}, SVC);
  assert.ok(orphans.includes(`p/${P.id}-${item.hash}.png`));
  assert.equal((await ok('fiila_media_forget', { p_paths: orphans }, SVC)).removed, orphans.length);
  assert.deepEqual(await ok('fiila_media_orphans', {}, SVC), []);
});

await t('back-office : état réservé au droit « settings » ; journal des échecs et dernière copie', async () => {
  const SUP = await user('aide@example.test', 'support');
  await ok('fiila_media_report', { p_action: 'failed', p_ref: 'product:x', p_detail: 'stockage 500' }, SVC);
  await ok('fiila_media_report', { p_action: 'run', p_ref: null, p_detail: null }, SVC);
  await ko('fiila_media_report', { p_action: 'run', p_ref: null, p_detail: null });
  const m = await ok('fiila_bo_media', {}, F);
  assert.equal(m.ready, true); assert.equal(m.on, true);
  assert.ok(m.copied >= 2); assert.ok(m.pending >= 1); assert.ok(m.last_run);
  assert.equal(m.errors[0].detail, 'stockage 500');
  await ko('fiila_bo_media', {}, null, SUP);
  assert.ok(JSON.stringify(await ok('fiila_bo_settings', {}, F)).includes('media_cdn'));
});

await t('miniatures : JPEG copié seulement, clé de service seule ; vitrine, fil et liste du commerçant reçoivent l’adresse de la carte', async () => {
  const px = new Uint8Array(40 * 50 * 4).fill(200);
  const jpg = Buffer.from(jpeg.encode({ data: px, width: 40, height: 50 }, 80).data).toString('base64');
  const J = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Pagne [TEST]', price: 2000, photo: jpg } });
  assert.ok(!(await ok('fiila_media_thumbs_pending', {}, SVC)).some((x) => x.ref === J.id), 'pas avant la copie dans le seau');
  const c = (await ok('fiila_media_pending', {}, SVC)).find((x) => x.ref === J.id);
  assert.equal(c.ctype, 'image/jpeg');
  await ok('fiila_media_done', { p_kind: 'product', p_ref: J.id, p_hash: c.hash, p_path: `p/${J.id}-${c.hash}.jpg`, p_bytes: 900 }, SVC);
  const slug = (await one(`select slug from fiila.shops where id = (select shop_id from fiila.products where id = $1)`, [J.id])).slug;
  let v = await ok('fiila_vitrine', { p_slug: slug });
  assert.equal(v.products.find((x) => x.id === J.id).img, `${BASE}p/${J.id}-${c.hash}.jpg`, 'sans miniature : photo du seau');
  const q = await ok('fiila_media_thumbs_pending', {}, SVC);
  const th = createHash('md5').update(`p/${J.id}-${c.hash}.jpg`).digest('hex');
  assert.deepEqual(q.filter((x) => x.ref === J.id), [{ ref: J.id, src: `p/${J.id}-${c.hash}.jpg`, hash: th }]);
  assert.ok(!q.some((x) => x.ref === P.id), 'photo PNG : pas de miniature');
  await ko('fiila_media_thumbs_pending', {});
  await ko('fiila_media_thumbs_pending', {}, null, F);
  await ko('fiila_media_done', { p_kind: 'thumb', p_ref: J.id, p_hash: th, p_path: `t/${J.id}-${th}.png`, p_bytes: 10 }, 'invalid', SVC);
  await ko('fiila_media_done', { p_kind: 'product', p_ref: J.id, p_hash: c.hash, p_path: `t/${J.id}-${th}.jpg`, p_bytes: 10 }, 'invalid', SVC);
  assert.equal((await ok('fiila_media_done', { p_kind: 'thumb', p_ref: J.id, p_hash: th, p_path: `t/${J.id}-${th}.jpg`, p_bytes: 120 }, SVC)).linked, true);
  v = await ok('fiila_vitrine', { p_slug: slug });
  assert.equal(v.products.find((x) => x.id === J.id).img, `${BASE}t/${J.id}-${th}.jpg`);
  await db.query(`update fiila.shops set platform = true, feed = true where slug = $1`, [slug]);
  const posts = (await ok('fiila_posts', { p_tab: 'pour-vous' })).posts;
  assert.equal(posts.find((x) => x.id === J.id).img, `${BASE}p/${J.id}-${c.hash}.jpg`, 'fil pleine largeur : photo du seau');
  const mine = (await ok('fiila_products', { p_key: S.key, p_all: true })).find((x) => x.id === J.id);
  assert.equal(mine.thumb, `${BASE}t/${J.id}-${th}.jpg`); assert.equal(mine.photo, `${BASE}p/${J.id}-${c.hash}.jpg`);
  const m = await ok('fiila_bo_media', {}, F);
  assert.ok(m.thumbs >= 1); assert.equal(m.thumb_bytes, 120);
  // Photo remplacée : miniature à refaire, l'ancienne devient orpheline ; réglage media_cdn = 0 : plus d'adresse, retour à l'appel d'avant.
  await ok('fiila_product_save', { p_key: S.key, p: { id: J.id, name: 'Pagne [TEST]', price: 2000, photo: photo(11) } });
  assert.equal((await one(`select thumb_path from fiila.products where id = $1`, [J.id])).thumb_path, null);
  await db.query(`update fiila.media_objects set created_at = now() - interval '1 hour'`);
  assert.ok((await ok('fiila_media_orphans', {}, SVC)).includes(`t/${J.id}-${th}.jpg`));
  await db.query(`update fiila.settings set value = '0' where key = 'media_cdn'`);
  v = await ok('fiila_vitrine', { p_slug: slug });
  assert.ok(v.products.every((x) => !x.img));
  await db.query(`update fiila.settings set value = '1' where key = 'media_cdn'`);
});

await t('copie de la base retirée (étape 3) : après vérification de l’empreinte seulement ; la photo reste affichée partout', async () => {
  const sha = (b64) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
  const S2 = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Retrait [TEST]', business_type: 'mode' } });
  const px = new Uint8Array(40 * 50 * 4).fill(90);
  const jpg = Buffer.from(jpeg.encode({ data: px, width: 40, height: 50 }, 80).data).toString('base64');
  S2.id = (await one(`select id from fiila.shops where name = 'Boutique Retrait [TEST]'`)).id;
  const R = await ok('fiila_product_save', { p_key: S2.key, p: { name: 'Boubou [TEST]', price: 5000, photo: jpg, photos: [photo(21)] } });
  await ok('fiila_shop_vitrine', { p_key: S2.key, p: { public: true, cover: photo(22) } });
  const paths = {};
  for (const c of (await ok('fiila_media_pending', { p_limit: 20 }, SVC)).filter((x) => x.ref.startsWith(R.id) || x.ref === S2.id)) {
    const ext = c.ctype === 'image/jpeg' ? 'jpg' : 'png';
    paths[c.kind] = c.kind === 'cover' ? `c/${c.ref}-${c.hash}.${ext}` : c.kind === 'product_extra' ? `p/${R.id}-1-${c.hash}.${ext}` : `p/${R.id}-${c.hash}.${ext}`;
    await ok('fiila_media_done', { p_kind: c.kind, p_ref: c.ref, p_hash: c.hash, p_path: paths[c.kind], p_bytes: 100 }, SVC);
  }
  assert.deepEqual(Object.keys(paths).sort(), ['cover', 'product', 'product_extra']);
  let q = (await ok('fiila_media_purge_pending', { p_limit: 20 }, SVC)).filter((x) => x.ref.startsWith(R.id) || x.ref === S2.id);
  assert.deepEqual(q.map((x) => x.kind).sort(), ['cover', 'product_extra'], 'photo principale JPEG : pas avant sa miniature');
  await ko('fiila_media_purge_pending', {});
  await ko('fiila_media_purge_pending', {}, null, F);
  await ko('fiila_media_purged', { p_kind: 'cover', p_ref: S2.id, p_path: paths.cover, p_sha: sha(photo(22)) });
  const th = createHash('md5').update(paths.product).digest('hex');
  await ok('fiila_media_done', { p_kind: 'thumb', p_ref: R.id, p_hash: th, p_path: `t/${R.id}-${th}.jpg`, p_bytes: 50 }, SVC);
  q = (await ok('fiila_media_purge_pending', { p_limit: 20 }, SVC)).filter((x) => x.ref.startsWith(R.id) || x.ref === S2.id);
  assert.deepEqual(q.find((x) => x.kind === 'product'), { kind: 'product', ref: R.id, path: paths.product, sha: sha(jpg) });
  const before = (await ok('fiila_bo_media', {}, F)).db_bytes;
  // Empreinte ou adresse différente : rien n'est retiré.
  assert.equal((await ok('fiila_media_purged', { p_kind: 'product', p_ref: R.id, p_path: paths.product, p_sha: '0'.repeat(64) }, SVC)).purged, false);
  assert.equal((await ok('fiila_media_purged', { p_kind: 'product', p_ref: R.id, p_path: paths.cover, p_sha: sha(jpg) }, SVC)).purged, false);
  await ko('fiila_media_purged', { p_kind: 'product', p_ref: R.id, p_path: paths.product, p_sha: 'abc' }, 'invalid', SVC);
  for (const x of q) assert.equal((await ok('fiila_media_purged', { p_kind: x.kind, p_ref: x.ref, p_path: x.path, p_sha: x.sha }, SVC)).purged, true);
  const row = await one(`select photo, photo_path, thumb_path from fiila.products where id = $1`, [R.id]);
  assert.equal(row.photo, null); assert.equal(row.photo_path, paths.product); assert.ok(row.thumb_path, 'miniature gardée');
  assert.equal((await one(`select data, path from fiila.product_photos where product_id = $1`, [R.id])).data, null);
  assert.equal((await one(`select cover, cover_path from fiila.shops where id = $1`, [S2.id])).cover_path, paths.cover);
  const m = await ok('fiila_bo_media', {}, F);
  assert.ok(m.purged >= 3); assert.ok(m.db_bytes < before); assert.equal(m.purge_on, true);
  assert.equal((await one(`select count(*)::int n from fiila.media_log where action = 'purged' and ref like $1`, ['%' + R.id + '%'])).n, 2);
  assert.ok(!(await ok('fiila_media_pending', { p_limit: 20 }, SVC)).some((x) => x.ref.startsWith(R.id) || x.ref === S2.id), 'pas de nouvelle copie');
  // Affichage : vitrine, photos, couverture, liste du commerçant, fil — même avec media_cdn = 0.
  const slug = (await one(`select slug from fiila.shops where id = $1`, [S2.id])).slug;
  const check = async () => {
    const v = await ok('fiila_vitrine', { p_slug: slug });
    const card = v.products.find((x) => x.id === R.id);
    assert.equal(card.has_photo, true); assert.equal(card.photos, 2); assert.equal(v.shop.has_cover ?? v.has_cover, true);
    assert.equal((await ok('fiila_vitrine_photo', { p_slug: slug, p_id: R.id })).photo, BASE + paths.product);
    assert.equal((await ok('fiila_vitrine_photo', { p_slug: slug, p_id: R.id + ':1' })).photo, BASE + paths.product_extra);
    assert.equal((await ok('fiila_vitrine_photo', { p_slug: slug, p_id: 'cover' })).photo, BASE + paths.cover);
    assert.equal((await ok('fiila_products', { p_key: S2.key, p_all: true })).find((x) => x.id === R.id).photo, BASE + paths.product);
    assert.deepEqual(await ok('fiila_product_photos', { p_key: S2.key, p_id: R.id }), [BASE + paths.product_extra]);
    assert.equal((await ok('fiila_shop_vitrine', { p_key: S2.key, p: null })).cover, BASE + paths.cover);
  };
  await check();
  await db.query(`update fiila.shops set platform = true, feed = true where id = $1`, [S2.id]);
  assert.ok((await ok('fiila_posts', { p_tab: 'pour-vous' })).posts.some((x) => x.id === R.id), 'toujours dans le fil');
  await db.query(`update fiila.settings set value = '0' where key = 'media_cdn'`);
  await check();
  await db.query(`update fiila.settings set value = '1' where key = 'media_cdn'`);
  // Modification sans toucher aux photos : rien ne bouge.
  await ok('fiila_product_save', { p_key: S2.key, p: { id: R.id, name: 'Boubou bleu [TEST]', price: 5500 } });
  assert.equal((await one(`select photo_path from fiila.products where id = $1`, [R.id])).photo_path, paths.product);
  // Photo principale retirée : la supplémentaire (déjà retirée de la base) devient principale avec son adresse.
  await ok('fiila_product_save', { p_key: S2.key, p: { id: R.id, name: 'Boubou bleu [TEST]', price: 5500, photo: '' } });
  let r2 = await one(`select photo, photo_path, thumb_path from fiila.products where id = $1`, [R.id]);
  assert.equal(r2.photo_path, paths.product_extra); assert.equal(r2.thumb_path, null);
  assert.equal((await one(`select count(*)::int n from fiila.product_photos where product_id = $1`, [R.id])).n, 0);
  assert.equal((await ok('fiila_vitrine_photo', { p_slug: slug, p_id: R.id })).photo, BASE + paths.product_extra);
  // Photo retirée sans autre photo : l'article n'a plus de photo (adresse effacée aussi).
  await ok('fiila_product_save', { p_key: S2.key, p: { id: R.id, name: 'Boubou bleu [TEST]', price: 5500, photo: '' } });
  r2 = await one(`select photo, photo_path from fiila.products where id = $1`, [R.id]);
  assert.equal(r2.photo_path, null);
  assert.equal((await ok('fiila_vitrine', { p_slug: slug })).products.find((x) => x.id === R.id).has_photo, false);
  // Nouvelle photo : nouvelle copie ; couverture retirée : plus de couverture.
  await ok('fiila_product_save', { p_key: S2.key, p: { id: R.id, name: 'Boubou bleu [TEST]', price: 5500, photo: photo(23) } });
  assert.ok((await ok('fiila_media_pending', { p_limit: 20 }, SVC)).some((x) => x.ref === R.id));
  await ok('fiila_shop_vitrine', { p_key: S2.key, p: { cover: '' } });
  assert.equal((await one(`select cover_path from fiila.shops where id = $1`, [S2.id])).cover_path, null);
  // Réglage media_purge = 0 : plus aucun retrait.
  await db.query(`insert into fiila.settings (key, value) values ('media_purge', '0') on conflict (key) do update set value = '0'`);
  assert.deepEqual(await ok('fiila_media_purge_pending', { p_limit: 20 }, SVC), []);
  await db.query(`update fiila.settings set value = '1' where key = 'media_purge'`);
});

await t('photos privées inchangées : la porte d’une adresse reste servie par la base', async () => {
  const a = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez test', locality: 'Yoff', instruction: 'Portail vert', entry: { lat: 14.7, lng: -17.4 }, photo: photo(4) } });
  const g = await ok('fiila_get_owned', { p_id: a.id, p_owner: a.owner_token });
  assert.match(g.photo, /^data:image\/png;base64,/);
  assert.ok(!(await ok('fiila_media_pending', { p_limit: 20 }, SVC)).some((x) => x.ref === a.id));
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL photos (stockage) réussis`);
process.exit(passed === results.length ? 0 : 1);
