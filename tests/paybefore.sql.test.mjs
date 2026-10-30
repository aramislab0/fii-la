// Tests SQL : paiement avant la livraison et article sans prix (fondateur, 30/10/2026 16:15 ; migration 20261030100000).
// Modes de la boutique (à la livraison, Wave ou Orange Money avant la livraison, numéro obligatoire), choix de la cliente
// à la commande, numéro jamais montré sur le site mais sur la facture, réglage pay_before ; article à 0 jamais publié.
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
const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Paiement Test [TEST]', business_type: 'mode' } });
const v = await ok('fiila_shop_vitrine', { p_key: s.key, p: { public: true } });
const P = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Sac', price: 10000 } });
const order = (pay) => ({ p_slug: v.slug, p: { items: [{ product_id: P.id, qty: 1 }], customer: { name: 'Awa Test', phone: '77 000 00 01' }, pay } });

await t('boutique sans mode choisi : commande sans mode, comme avant', async () => {
  const r = await ok('fiila_vitrine_order', order(undefined));
  assert.equal(r.pay_mode ?? null, null);
});

await t('modes : Wave ou OM exigent leur numéro ; le numéro n’apparaît pas sur le site', async () => {
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { policies: { pay: ['livraison', 'wave'] } } }, 'pay_number_required');
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { policies: { pay: ['wave'], wave_to: '12' } } }, 'pay_number_required|phone_invalid');
  const r = await ok('fiila_shop_vitrine', { p_key: s.key, p: { policies: { pay: ['livraison', 'wave', 'om'], wave_to: '77 111 22 33', om_to: '78 444 55 66' } } });
  assert.deepEqual(r.policies.pay, ['livraison', 'wave', 'om']); assert.ok(r.policies.wave_to, 'la boutique voit son numéro');
  const site = await ok('fiila_vitrine', { p_slug: v.slug });
  assert.deepEqual(site.shop.policies.pay, ['livraison', 'wave', 'om']);
  assert.equal(site.shop.policies.wave_to, undefined); assert.equal(site.shop.policies.om_to, undefined);
  const r2 = await ok('fiila_shop_vitrine', { p_key: s.key, p: { policies: { pay: ['livraison'], wave_to: '77 111 22 33' } } });
  assert.equal(r2.policies.wave_to, undefined, 'numéro gardé seulement pour un mode choisi');
  await ok('fiila_shop_vitrine', { p_key: s.key, p: { policies: { pay: ['livraison', 'wave'], wave_to: '77 111 22 33' } } });
});

await t('commande : mode obligatoire et parmi ceux de la boutique ; la facture montre le numéro Wave à payer', async () => {
  await ko('fiila_vitrine_order', order(undefined), 'pay_required');
  await ko('fiila_vitrine_order', order('om'), 'invalid_pay');
  const c = await ok('fiila_vitrine_order', order('livraison'));
  assert.equal(c.pay_mode, 'livraison');
  const w = await ok('fiila_vitrine_order', order('wave'));
  assert.equal(w.pay_mode, 'wave');
  const f = await ok('fiila_order_public', { p_token: w.invoice });
  assert.equal(f.order.pay_mode, 'wave'); assert.match(f.order.pay_to, /77\s?111\s?22\s?33|771112233/); assert.equal(f.order.pay_state, 'unpaid');
  const fc = await ok('fiila_order_public', { p_token: c.invoice });
  assert.equal(fc.order.pay_to, undefined, 'pas de numéro pour un paiement à la livraison');
  const mine = await ok('fiila_orders', { p_key: s.key, p_filter: null });
  assert.ok(mine.some((o) => o.pay_mode === 'wave'), 'la boutique voit le mode de paiement');
});

await t('réglage pay_before = 0 : le paiement avant la livraison est refusé et signalé au site', async () => {
  await ok('fiila_bo_setting_set', { p_key: 'pay_before', p_value: 0 }, F);
  assert.equal((await ok('fiila_vitrine', { p_slug: v.slug })).shop.pay_before_off, true);
  await ko('fiila_vitrine_order', order('wave'), 'invalid_pay');
  await ok('fiila_vitrine_order', order('livraison'));
  await ok('fiila_bo_setting_set', { p_key: 'pay_before', p_value: 1 }, F);
  assert.ok('pay_before' in (await ok('fiila_bo_settings', {}, F)));
});

await t('article sans prix : enregistré masqué, jamais publié ; absent du site', async () => {
  await ko('fiila_product_save', { p_key: s.key, p: { name: 'Sans prix', price: 0 } }, 'price_required');
  const m = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Sans prix', price: 0, active: false } });
  assert.equal(m.active, false);
  await ko('fiila_product_save', { p_key: s.key, p: { id: m.id, name: 'Sans prix', price: 0, active: true } }, 'price_required');
  await ko('fiila_product_save', { p_key: s.key, p: { id: P.id, name: 'Sac', price: 0 } }, 'price_required');
  const pub = await ok('fiila_product_save', { p_key: s.key, p: { id: m.id, name: 'Sans prix', price: 2500, active: true } });
  assert.equal(pub.active, true);
  await db.query(`update fiila.products set price = 0 where id = $1`, [pub.id]);
  const site = await ok('fiila_vitrine', { p_slug: v.slug });
  assert.equal(site.products.some((x) => x.id === pub.id), false, 'un article à 0 n’est jamais servi au site');
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL paiement avant livraison réussis`);
process.exit(passed === results.length ? 0 : 1);
