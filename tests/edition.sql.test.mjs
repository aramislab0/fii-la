// Tests SQL : Fii Édition, lot 1 (fondateur, 27/10/2026 18:12 ; migration 20261027300000). Un seul cœur « Favoris »
// (fusion J'aime + Enregistrer, aussi sur le site), « Suivre » une boutique sans compte, boutiques suivies en tête de
// « Pour vous », modèle premium « Édition » réservé au Premium, chiffres d'audience au back-office, table fermée.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const F = { uid: (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'f@example.test') returning id`)).id };
await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Fondateur')`, [F.uid]);
await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [F.uid]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function shop(name, feed) {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name, business_type: 'enfants' } });
  const p = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Robe ' + name, price: 10000 } });
  await db.query(`update fiila.products set photo = $2, photo_type = 'image/png' where id = $1`, [p.id, PNG]);
  const v = await ok('fiila_shop_vitrine', { p_key: s.key, p: { public: true } });
  if (feed) await db.query(`update fiila.shops set featured_rank = $2, feed = true where id = $1`, [s.shop.id, feed]);
  return { key: s.key, id: s.shop.id, pid: p.id, slug: v.slug };
}
const A = await shop('Testo A [TEST]', 1), B = await shop('Testo B [TEST]', 2), C = await shop('Hors fil [TEST]', null);
const D1 = 'appareil-de-test-numero-un-000001', D2 = 'appareil-de-test-numero-deux-00002';

await t('migration : un ancien « J’aime » seul et un ancien « Enregistrer » seul deviennent tous deux des favoris', async () => {
  const fresh = await (await import('./db.mjs')).createDb({ before: '20261027300000' });
  const s = (await rpc(fresh, 'fiila_shop_save', { p_key: null, p: { name: 'Avant [TEST]' } })).body;
  const p = (await rpc(fresh, 'fiila_product_save', { p_key: s.key, p: { name: 'X', price: 1 } })).body;
  await fresh.query(`insert into fiila.likes (product_id, who) values ($1, 'd:aa')`, [p.id]);
  await fresh.query(`insert into fiila.saves (product_id, who) values ($1, 'd:bb')`, [p.id]);
  const { applyMigrations } = await import('./db.mjs');
  await applyMigrations(fresh, '20261027300000');
  const l = (await fresh.query(`select who from fiila.likes where product_id = $1 order by who`, [p.id])).rows.map((r) => r.who);
  const v = (await fresh.query(`select who from fiila.saves where product_id = $1 order by who`, [p.id])).rows.map((r) => r.who);
  assert.deepEqual(l, ['d:aa', 'd:bb']); assert.deepEqual(v, ['d:aa', 'd:bb']);
});

await t('cœur : un geste écrit J’aime et Enregistrer, aussi pour une boutique hors du fil ; retiré d’un geste ; appareil requis', async () => {
  await ko('fiila_fav', { p_product: A.pid, p_on: true }, 'device_required');
  let r = await ok('fiila_fav', { p_product: C.pid, p_on: true, p_device: D1 });
  assert.equal(r.fav, true); assert.equal(r.favs, 1); assert.equal(r.likes, 1); assert.equal(r.saves, 1);
  assert.deepEqual(await ok('fiila_favs_in', { p_slug: C.slug, p_device: D1 }), [C.pid]);
  assert.equal((await ok('fiila_saved', { p_device: D1 })).length, 1, 'visible dans « Mes favoris »');
  r = await ok('fiila_fav', { p_product: C.pid, p_on: false, p_device: D1 });
  assert.equal(r.fav, false); assert.equal(r.likes, 0); assert.equal(r.saves, 0);
  await db.query(`update fiila.products set active = false where id = $1`, [C.pid]);
  await ko('fiila_fav', { p_product: C.pid, p_on: true, p_device: D1 }, 'not_found');
  await db.query(`update fiila.products set active = true where id = $1`, [C.pid]);
});

await t('suivre : sans compte, compteur d’abonnés, idempotent, désabonnement ; boutique hors ligne refusée', async () => {
  await ko('fiila_follow', { p_slug: B.slug, p_on: true }, 'device_required');
  let r = await ok('fiila_follow', { p_slug: B.slug, p_on: true, p_device: D1 });
  assert.deepEqual(r, { following: true, followers: 1 });
  r = await ok('fiila_follow', { p_slug: B.slug, p_on: true, p_device: D1 });
  assert.equal(r.followers, 1, 'deux fois = un abonné');
  assert.deepEqual(await ok('fiila_follow_state', { p_slug: B.slug, p_device: D2 }), { following: false, followers: 1 });
  const list = await ok('fiila_follows', { p_device: D1 });
  assert.deepEqual(list.map((x) => x.name), ['Testo B [TEST]']);
  await ok('fiila_follow', { p_slug: C.slug, p_on: true, p_device: D2 });
  assert.deepEqual(await ok('fiila_follow', { p_slug: C.slug, p_on: false, p_device: D2 }), { following: false, followers: 0 });
  await ok('fiila_shop_vitrine', { p_key: C.key, p: { public: false } });
  await ko('fiila_follow', { p_slug: C.slug, p_on: true, p_device: D2 }, 'not_found');
});

await t('fil « Pour vous » : les articles des boutiques suivies passent en tête', async () => {
  await db.query(`update fiila.products set updated_at = now() - interval '5 days' where id = $1`, [B.pid]);
  await db.query(`update fiila.products set updated_at = now() where id = $1`, [A.pid]);
  const other = await ok('fiila_posts', { p_tab: 'pour-vous', p_device: D2 });
  assert.equal(other.posts[0].id, A.pid, 'sans abonnement : le plus récent d’abord');
  const mine = await ok('fiila_posts', { p_tab: 'pour-vous', p_device: D1 });
  assert.equal(mine.posts[0].id, B.pid, 'abonné à B : B d’abord');
});

await t('modèle « Édition » : réservé au Premium, affiché tel quel une fois Premium', async () => {
  await ko('fiila_shop_vitrine', { p_key: A.key, p: { theme: 'edition' } }, 'premium_required');
  await ko('fiila_shop_vitrine', { p_key: A.key, p: { theme: 'inconnu' } }, 'invalid_theme');
  await db.query(`update fiila.shops set plan = 'premium' where id = $1`, [A.id]);
  const r = await ok('fiila_shop_vitrine', { p_key: A.key, p: { theme: 'edition' } });
  assert.equal(r.theme, 'edition');
  assert.equal((await ok('fiila_vitrine', { p_slug: A.slug })).shop.theme, 'edition');
  await db.query(`update fiila.shops set plan = 'free' where id = $1`, [A.id]);
  assert.equal((await ok('fiila_vitrine', { p_slug: A.slug })).shop.theme, 'galerie', 'plus Premium : modèle de base servi');
});

await t('back-office : abonnés et favoris de la boutique (droit « boutiques ») ; table des abonnements fermée', async () => {
  await ok('fiila_fav', { p_product: B.pid, p_on: true, p_device: D2 });
  const a = await ok('fiila_bo_shop_audience', { p_shop: B.id }, F);
  assert.equal(a.followers, 1); assert.equal(a.favs, 1); assert.equal(a.favs_30, 1); assert.deepEqual(a.top, [{ name: 'Robe Testo B [TEST]', favs: 1 }]);
  await ko('fiila_bo_shop_audience', { p_shop: B.id }, null);
  for (const role of ['anon', 'authenticated']) {
    let denied = false;
    try { await db.exec(`set role ${role}; select * from fiila.follows;`); } catch { denied = true; }
    await db.exec('reset role');
    assert.equal(denied, true, role);
  }
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL Fii Édition réussis`);
process.exit(passed === results.length ? 0 : 1);
