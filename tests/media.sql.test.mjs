// Tests SQL : photos publiques dans Supabase Storage (22/10/2026). File d'attente réservée à la clé de service, adresse
// enregistrée seulement si la photo n'a pas changé, adresse servie à la place du base64, retour arrière par réglage,
// photo modifiée = nouvelle copie, photos orphelines retirées, état au back-office (droit « settings »).
import assert from 'node:assert/strict';
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

await t('photos privées inchangées : la porte d’une adresse reste servie par la base', async () => {
  const a = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez test', locality: 'Yoff', instruction: 'Portail vert', entry: { lat: 14.7, lng: -17.4 }, photo: photo(4) } });
  const g = await ok('fiila_get_owned', { p_id: a.id, p_owner: a.owner_token });
  assert.match(g.photo, /^data:image\/png;base64,/);
  assert.ok(!(await ok('fiila_media_pending', { p_limit: 20 }, SVC)).some((x) => x.ref === a.id));
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL photos (stockage) réussis`);
process.exit(passed === results.length ? 0 : 1);
