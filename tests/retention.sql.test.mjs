// Tests SQL : rétention lot 1 (22/10/2026). Compteurs d’état réel dans fiila_shop_get, commandes en attente d’adresse,
// interrupteurs par suggestion, mesure anonyme retention / order_address, back-office Suggestions.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
let S, F, P;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = (n) => Buffer.concat([png, Buffer.alloc(200 + n)]).toString('base64');

await t('fiila_shop_get : compteurs d’état réel à zéro pour une boutique neuve', async () => {
  S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Rétention [TEST]', business_type: 'mode' } });
  const st = (await ok('fiila_shop_get', { p_key: S.key })).stats;
  for (const k of ['views', 'vitrine_orders', 'multi_photos', 'members', 'need_address']) assert.equal(st[k], 0, k);
  assert.ok(st.need_address_order == null);
});

await t('S0 : commande sans adresse comptée (même sans article) ; commande annulée → plus comptée', async () => {
  const o = await ok('fiila_order_create', { p_key: S.key, p: { customer: { name: 'Awa [TEST]', phone: '770000031' }, items: [{ label: 'Robe', qty: 1, price: 5000 }] } });
  let st = (await ok('fiila_shop_get', { p_key: S.key })).stats;
  assert.equal(st.need_address, 1); assert.equal(st.need_address_order, o.id || o.order?.id || st.need_address_order);
  await db.query(`update fiila.orders set status = 'cancelled' where shop_id = $1`, [S.shop.id]);
  st = (await ok('fiila_shop_get', { p_key: S.key })).stats;
  assert.equal(st.need_address, 0, 'commande annulée : plus rien à demander');
});

await t('états réels : visites, commandes par le site, articles à plusieurs photos', async () => {
  P = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe [TEST]', price: 5000, photo: photo(1), photos: [photo(2)] } });
  const slug = (await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } })).slug;
  await ok('fiila_vitrine', { p_slug: slug });
  await ok('fiila_vitrine_order', { p_slug: slug, p: { items: [{ product_id: P.id, qty: 1 }], customer: { name: 'Fatou [TEST]', phone: '770000032' } } });
  const st = (await ok('fiila_shop_get', { p_key: S.key })).stats;
  assert.equal(st.views, 1); assert.equal(st.vitrine_orders, 1); assert.equal(st.multi_photos, 1);
});

await t('interrupteurs par suggestion : bornés 0/1, listés, lus par l’application ; mesure anonyme', async () => {
  F = await user('fondateur@example.test', 'super_admin');
  assert.deepEqual((await ok('fiila_app_flags', {})).sugg_off, []);
  await ok('fiila_bo_setting_set', { p_key: 'sugg_shop_team', p_value: 0 }, F);
  await ko('fiila_bo_setting_set', { p_key: 'sugg_shop_team', p_value: 2 }, null, F);
  assert.deepEqual((await ok('fiila_app_flags', {})).sugg_off, ['shop_team']);
  assert.ok(JSON.stringify(await ok('fiila_bo_settings', {}, F)).includes('sugg_shop_photos'));
  for (const v of ['shop_photos:shown', 'shop_photos:click', 'shop_photos:used', 'shop_photos:repeat', 'home_shop:dismiss']) await ok('fiila_track', { p_event: 'retention', p_variant: v });
  await ok('fiila_track', { p_event: 'order_address', p_variant: 'used' });
  await ko('fiila_track', { p_event: 'retention', p_variant: 'shop_photos:sent' });
  await ko('fiila_track', { p_event: 'retention', p_variant: 'logo:shown' });
  const d = await ok('fiila_bo_nudges', {}, F);
  const ph = d.suggestions.find((x) => x.id === 'shop_photos');
  assert.deepEqual(ph.d30, { shown: 1, click: 1, used: 1, repeat: 1 }); assert.deepEqual(ph.d7, ph.d30);
  assert.equal(d.suggestions.find((x) => x.id === 'shop_team').on, false);
  assert.equal(d.order_address.used, 1); assert.equal(typeof d.order_address.received_30, 'number'); assert.equal(typeof d.order_address.waiting_now, 'number');
  await ko('fiila_bo_nudges', {}, null, await user('cliente@example.test'));
});

await t('aide de complétude d’adresse (A1) : addr_photo et addr_mark mesurés sans identifiant d’adresse, interrupteurs, panneau', async () => {
  for (const v of ['addr_photo:shown', 'addr_photo:used', 'addr_mark:dismiss']) await ok('fiila_track', { p_event: 'retention', p_variant: v });
  await ko('fiila_track', { p_event: 'retention', p_variant: 'addr_stop:shown' });
  await ko('fiila_track', { p_event: 'retention', p_variant: 'addr_photo:12345' });
  assert.equal((await one(`select count(*)::int n from fiila.metrics where event = 'retention' and variant ~ '^addr_' and variant !~ '^addr_(photo|mark):(shown|click|dismiss|used|repeat)$'`)).n, 0);
  await ok('fiila_bo_setting_set', { p_key: 'sugg_addr_mark', p_value: 0 }, F);
  assert.deepEqual((await ok('fiila_app_flags', {})).sugg_off, ['shop_team', 'addr_mark']);
  const d = await ok('fiila_bo_nudges', {}, F);
  assert.deepEqual(d.suggestions.find((x) => x.id === 'addr_photo').d30, { shown: 1, used: 1 });
  assert.equal(d.suggestions.find((x) => x.id === 'addr_mark').on, false);
  assert.ok(JSON.stringify(await ok('fiila_bo_settings', {}, F)).includes('sugg_addr_photo'));
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL rétention réussis`);
process.exit(passed === results.length ? 0 : 1);
