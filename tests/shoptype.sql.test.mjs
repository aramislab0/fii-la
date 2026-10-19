// Tests SQL : type de commerce des boutiques (liste fermée), visible dans le fil, statistiques fondateur.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

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
let K;
await t('création avec un type ; modification ; type inventé refusé ; sans le champ, le type reste', async () => {
  const r = await ok('fiila_shop_save', { p_key: null, p: { name: 'Salon Khady [TEST]', business_type: 'coiffure' } });
  K = r.key; assert.equal(r.shop.business_type, 'coiffure');
  assert.equal((await ok('fiila_shop_save', { p_key: K, p: { name: 'Salon Khady [TEST]', business_type: 'esthetique' } })).shop.business_type, 'esthetique');
  assert.equal((await ok('fiila_shop_save', { p_key: K, p: { name: 'Salon Khady 2 [TEST]' } })).shop.business_type, 'esthetique');
  await ko('fiila_shop_save', { p_key: K, p: { name: 'X', business_type: 'casino' } }, 'invalid_business_type');
  assert.equal((await ok('fiila_shop_get', { p_key: K })).shop.business_type, 'esthetique');
});
await t('fil : le type de la boutique est fourni (pour le filtre)', async () => {
  await ok('fiila_product_save', { p_key: K, p: { name: 'Tresses [TEST]', price: 10000 } });
  await ok('fiila_shop_vitrine', { p_key: K, p: { public: true } });
  assert.equal((await ok('fiila_feed', {})).shops[0].type, 'esthetique');
});
await t('statistiques par type : réservées au fondateur', async () => {
  await ko('fiila_admin_shop_types', {}, 'auth_required|not_allowed');
  const uid = (await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'admin@example.test') returning id`)).rows[0].id;
  await db.query(`insert into fiila.profiles (user_id, display_name, is_admin) values ($1, 'Admin', true)`, [uid]);
  assert.deepEqual(await ok('fiila_admin_shop_types', {}, { uid }), { esthetique: 1 });
});
for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL types de commerce réussis`);
process.exit(passed === results.length ? 0 : 1);
