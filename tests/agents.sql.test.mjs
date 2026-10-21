// Tests SQL : mandat AGENTS-AMBASSADEURS-001, lot 2 — programme rémunéré devenu « Agents » : données conservées, gains selon la
// date d'éligibilité (jamais selon le jour d'ouverture de l'espace), pas d'auto-rémunération ni de double attribution.
import assert from 'node:assert/strict';
import { createDb, rpc, applyMigrations } from './db.mjs';

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
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const user = async (email) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  return { uid: id };
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
let AG, CODE, AG_ID;
async function agent(email, phone) {
  const U = await user(email);
  const r = await ok('fiila_ambassador_register', { p: { name: 'Agent ' + email.split('@')[0], phone, zone: 'Yoff', payout_method: 'wave', charter: true } }, U);
  await db.query(`update fiila.ambassadors set status = 'active', quiz_passed_at = now() where code = $1`, [r.ambassador.code]);
  return { U, code: r.ambassador.code, id: (await one(`select id from fiila.ambassadors where code = $1`, [r.ambassador.code])).id };
}
// Boutique rattachée à l'agent, puis rendue éligible au niveau 1 (type, vitrine ouverte, 5 articles avec photo).
async function eligibleShop(code, name) {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name, business_type: 'mode' } });
  await ok('fiila_ambassador_link', { p_key: s.key, p_code: code });
  for (let i = 0; i < 5; i++) await ok('fiila_product_save', { p_key: s.key, p: { name: 'Article ' + i + ' [TEST]', price: 1000, photo } });
  await ok('fiila_shop_vitrine', { p_key: s.key, p: { public: true } });
  return s;
}
const rewards = async (agId) => (await db.query(`select level from fiila.ambassador_rewards where ambassador_id = $1 order by level`, [agId])).rows.map((x) => x.level);

await t('éligible au jour 6, espace ouvert pour la première fois au jour 8 : le gain du niveau 1 est dû', async () => {
  ({ U: AG, code: CODE, id: AG_ID } = await agent('moussa@example.test', '77 600 00 01'));
  const s = await eligibleShop(CODE, 'Boutique Jour 6 [TEST]');
  const l = await one(`select id, l1_at from fiila.ambassador_shops where shop_id = $1`, [s.shop.id]);
  assert.ok(l.l1_at, 'date d’éligibilité enregistrée au moment où elle est atteinte');
  // Le temps passe : lien il y a 8 jours, éligibilité atteinte au jour 6.
  await db.query(`update fiila.ambassador_shops set linked_at = now() - interval '8 days', l1_at = now() - interval '2 days' where id = $1`, [l.id]);
  assert.deepEqual(await rewards(AG_ID), [], 'aucun gain avant le calcul');
  const me = await ok('fiila_ambassador_me', {}, AG);
  assert.deepEqual(await rewards(AG_ID), [1]);
  assert.equal(me.ambassador.shops.find((x) => x.shop === 'Boutique Jour 6 [TEST]').level, 1);
});

await t('éligible au jour 8 seulement : pas de gain (délai de 7 jours inchangé)', async () => {
  const s = await eligibleShop(CODE, 'Boutique Jour 8 [TEST]');
  await db.query(`update fiila.ambassador_shops set linked_at = now() - interval '9 days', l1_at = now() - interval '1 day' where shop_id = $1`, [s.shop.id]);
  await ok('fiila_ambassador_me', {}, AG);
  const r = await one(`select count(*)::int n from fiila.ambassador_rewards where shop_id = $1`, [s.shop.id]);
  assert.equal(r.n, 0);
});

await t('niveau 2 : 3 clientes et une livraison dans les 30 jours, calcul au jour 40 : gain dû', async () => {
  const s = await eligibleShop(CODE, 'Boutique Niveau 2 [TEST]');
  for (let i = 1; i <= 3; i++) {
    const o = await ok('fiila_order_create', { p_key: s.key, p: { customer: { name: 'Cliente ' + i + ' [TEST]', phone: '70 100 00 0' + i }, items: [{ label: 'Robe', qty: 1, price: 5000 }] } });
    if (i === 1) await db.query(`update fiila.orders set status = 'delivered' where id = $1`, [o.id || o.order.id]);
  }
  await db.query(`update fiila.ambassador_shops set linked_at = linked_at - interval '40 days', l1_at = l1_at - interval '39 days' where shop_id = $1`, [s.shop.id]);
  await db.query(`update fiila.orders set created_at = created_at - interval '25 days' where shop_id = $1`, [s.shop.id]);
  await ok('fiila_ambassador_me', {}, AG);
  const lv = (await db.query(`select level from fiila.ambassador_rewards where shop_id = $1 order by level`, [s.shop.id])).rows.map((x) => x.level);
  assert.deepEqual(lv, [1, 2]);
});

await t('pas d’auto-rémunération ni de double attribution ; gains déjà acquis jamais recréés', async () => {
  const mine = await ok('fiila_shop_save', { p_key: null, p: { name: 'Ma propre boutique [TEST]', business_type: 'mode', phone: '77 600 00 01' } });
  await ko('fiila_ambassador_link', { p_key: mine.key, p_code: CODE }, 'ambassador_self');
  const other = await agent('awa@example.test', '77 600 00 02');
  const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Disputée [TEST]', business_type: 'mode' } });
  await ok('fiila_ambassador_link', { p_key: s.key, p_code: CODE });
  await ko('fiila_ambassador_link', { p_key: s.key, p_code: other.code }, 'ambassador_already');
  const before = (await one(`select count(*)::int n from fiila.ambassador_rewards`)).n;
  await ok('fiila_ambassador_me', {}, AG); await ok('fiila_ambassador_me', {}, AG);
  assert.equal((await one(`select count(*)::int n from fiila.ambassador_rewards`)).n, before, 'aucun gain en double');
});

await t('migration : agent, code, rattachement, gains (dont versé), quiz et messages créés AVANT sont intacts APRÈS', async () => {
  const MIG = '20261021700000';
  const old = await createDb({ before: MIG });
  const okO = async (fn, args, opt) => { const r = await rpc(old, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
  const oneO = async (sql, a) => (await old.query(sql, a)).rows[0];
  const uid = (await oneO(`insert into auth.users (id, email) values (gen_random_uuid(), 'ancien@example.test') returning id`)).id;
  await old.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Ancien')`, [uid]);
  const reg = await okO('fiila_ambassador_register', { p: { name: 'Ancien Agent', phone: '77 600 00 09', payout_method: 'wave', charter: true } }, { uid });
  await old.query(`update fiila.ambassadors set status = 'active', quiz_passed_at = now() where code = $1`, [reg.ambassador.code]);
  const s = await okO('fiila_shop_save', { p_key: null, p: { name: 'Boutique Historique [TEST]', business_type: 'mode' } });
  await okO('fiila_ambassador_link', { p_key: s.key, p_code: reg.ambassador.code });
  const aid = (await oneO(`select id from fiila.ambassadors where code = $1`, [reg.ambassador.code])).id;
  await old.query(`insert into fiila.ambassador_rewards (ambassador_id, shop_id, shop_name, level, amount, status, paid_at) values ($1, $2, 'Boutique Historique [TEST]', 1, 2000, 'paid', now())`, [aid, s.shop.id]);
  await okO('fiila_amb_message_send', { p_body: 'Bonjour Manager [TEST]' }, { uid });
  const snap = async (d) => (await d.query(`select (select count(*) from fiila.ambassadors) a, (select code from fiila.ambassadors where id = $1) c,
    (select count(*) from fiila.ambassador_shops) l, (select coalesce(sum(amount), 0) from fiila.ambassador_rewards where status = 'paid') p,
    (select count(*) from fiila.amb_messages) m`, [aid])).rows[0];
  const before = await snap(old);
  await applyMigrations(old, MIG, null);
  const after = await snap(old);
  assert.deepEqual(after, before);
  const me = await okO('fiila_ambassador_me', {}, { uid });
  assert.equal(me.ambassador.code, reg.ambassador.code, 'le code historique reste valide');
  assert.equal(me.ambassador.rewards.paid, 2000);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL agents réussis`);
process.exit(passed === results.length ? 0 : 1);
