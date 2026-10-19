// Tests SQL : vide-dressing enfants (dépôt, règles, validation, vitrine Fii La, vente, reversement, garde-fous).
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
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const user = async (email, admin = false) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name, phone, is_admin) values ($1, $2, '77 700 00 01', $3)`, [id, 'Fatou', admin]);
  return { uid: id };
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
const item = (x = {}) => ({ title: 'Robe fillette [TEST]', gender: 'fille', age_band: '2-4a', size: '3 ans', condition: 'tres_bon', price: 4000, quartier: 'Yoff', photo, photo_ok: true, ...x });
let V, ADMIN, S1;

await t('dépôt : compte obligatoire, règle photo, genre, âge, état et prix contrôlés', async () => {
  await ko('fiila_vd_submit', { p: item() }, 'auth_required');
  V = await user('vendeuse@example.test'); ADMIN = await user('admin@example.test', true);
  await ko('fiila_vd_submit', { p: item({ photo_ok: false }) }, 'vd_photo_rule', V);
  await ko('fiila_vd_submit', { p: item({ gender: 'x' }) }, 'vd_gender_required', V);
  await ko('fiila_vd_submit', { p: item({ age_band: '20a' }) }, 'vd_age_required', V);
  await ko('fiila_vd_submit', { p: item({ price: 10 }) }, 'invalid_price', V);
  await ko('fiila_vd_submit', { p: item({ photo: '' }) }, 'vd_photo_required', V);
  S1 = await ok('fiila_vd_submit', { p: item() }, V);
  assert.equal(S1.status, 'pending'); assert.equal(S1.net, 3400, 'commission 15 %');
});

await t('rien n’est publié sans validation ; seule l’équipe valide ; publié dans la vitrine Fii La, vendeuse invisible', async () => {
  let v = await ok('fiila_vitrine', { p_slug: 'vide-dressing' });
  assert.equal(v.products.length, 0); assert.equal(v.shop.platform, true);
  await ko('fiila_admin_vd_decide', { p_id: S1.id, p_decision: 'approve', p_reason: null }, 'not_allowed', V);
  const adm = await ok('fiila_admin_vd', {}, ADMIN);
  assert.equal(adm.queue.length, 1); assert.match(adm.queue[0].photo, /^data:image\/png/);
  await ok('fiila_admin_vd_decide', { p_id: S1.id, p_decision: 'approve', p_reason: null }, ADMIN);
  v = await ok('fiila_vitrine', { p_slug: 'vide-dressing' });
  const p = v.products[0];
  assert.equal(p.name, 'Robe fillette [TEST]'); assert.equal(p.gender, 'fille'); assert.equal(p.age_band, '2-4a'); assert.equal(p.condition, 'tres_bon'); assert.equal(p.stock, 1);
  assert.ok(!JSON.stringify(v).includes('77 700'), 'aucun numéro de la vendeuse');
  assert.ok(!JSON.stringify(v).includes('Fatou'), 'aucun nom de la vendeuse');
  const feed = await ok('fiila_feed', {});
  assert.ok(feed.shops.some((s) => s.platform && s.name === 'Vide-dressing Fii La'), 'dans le fil, sans prendre une des 25 places');
  assert.equal((await one(`select featured_rank from fiila.shops where platform`)).featured_rank, null);
});

await t('commande : exemplaire unique ; la vendeuse apparaît seulement côté Fii La ; vendu puis reversé', async () => {
  const v = await ok('fiila_vitrine', { p_slug: 'vide-dressing' });
  const o = await ok('fiila_vitrine_order', { p_slug: 'vide-dressing', p: { customer: { name: 'Acheteuse [TEST]', phone: '70 900 00 01' }, items: [{ product_id: v.products[0].id, qty: 1, size: '3 ans' }] } });
  await ko('fiila_vitrine_order', { p_slug: 'vide-dressing', p: { customer: { name: 'Autre [TEST]', phone: '70 900 00 02' }, items: [{ product_id: v.products[0].id, qty: 1, size: '3 ans' }] } }, 'out_of_stock');
  const adm = await ok('fiila_admin_vd', {}, ADMIN);
  assert.equal(adm.orders[0].items[0].seller_phone, '77 700 00 01');
  assert.equal(adm.orders[0].invoice, o.invoice);
  await ok('fiila_admin_vd_decide', { p_id: S1.id, p_decision: 'sold', p_reason: null }, ADMIN);
  assert.equal((await ok('fiila_admin_vd', {}, ADMIN)).to_pay[0].net, 3400);
  await ok('fiila_admin_vd_decide', { p_id: S1.id, p_decision: 'paid', p_reason: null }, ADMIN);
  const mine = await ok('fiila_vd_mine', {}, V);
  assert.equal(mine.items[0].status, 'sold'); assert.ok(mine.items[0].paid_at);
});

await t('correction demandée puis renvoyée ; refus avec motif ; 3 refus en 30 jours bloquent le compte ; retrait', async () => {
  const s = await ok('fiila_vd_submit', { p: item({ title: 'Baskets [TEST]', gender: 'garcon', age_band: '6-8a' }) }, V);
  await ko('fiila_admin_vd_decide', { p_id: s.id, p_decision: 'changes', p_reason: '' }, 'reason_required', ADMIN);
  await ok('fiila_admin_vd_decide', { p_id: s.id, p_decision: 'changes', p_reason: 'Photo floue' }, ADMIN);
  assert.equal((await ok('fiila_vd_mine', {}, V)).items.find((x) => x.id === s.id).reason, 'Photo floue');
  const re = await ok('fiila_vd_submit', { p: item({ id: s.id, title: 'Baskets [TEST]', gender: 'garcon', age_band: '6-8a', photo: '' }) }, V);
  assert.equal(re.status, 'pending');
  for (let i = 0; i < 3; i++) {
    const x = await ok('fiila_vd_submit', { p: item({ title: 'Refus ' + i }) }, V);
    await ok('fiila_admin_vd_decide', { p_id: x.id, p_decision: 'reject', p_reason: 'Article interdit' }, ADMIN);
  }
  await ko('fiila_vd_submit', { p: item() }, 'vd_blocked', V);
  await ok('fiila_vd_withdraw', { p_id: s.id }, V);
  assert.ok(!(await ok('fiila_vd_mine', {}, V)).items.some((x) => x.id === s.id));
  const other = await user('autre@example.test');
  await ko('fiila_vd_withdraw', { p_id: S1.id }, 'not_found', other);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL vide-dressing réussis`);
process.exit(passed === results.length ? 0 : 1);
