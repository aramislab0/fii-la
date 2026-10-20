// Tests SQL : programme Ambassadeurs — inscription, test, validation, lien commerçant, 3 niveaux, gains, garde-fous, admin.
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
  await db.query(`insert into fiila.profiles (user_id, display_name, is_admin) values ($1, $2, $3)`, [id, email.split('@')[0], admin]);
  if (admin) await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [id]);
  return { uid: id };
};
const GOOD = [1, 1, 0, 1, 0, 1, 1, 1, 1, 0];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
let A, ADMIN, CODE, AMB_ID;

await t('inscription : compte et charte obligatoires ; un numéro = un ambassadeur', async () => {
  await ko('fiila_ambassador_register', { p: { name: 'X', phone: '77 500 00 01', payout_method: 'wave', charter: true } }, 'auth_required');
  A = await user('moussa@example.test'); ADMIN = await user('admin@example.test', true);
  await ko('fiila_ambassador_register', { p: { name: 'Moussa Diop', phone: '77 500 00 01', payout_method: 'wave' } }, 'charter_required', A);
  const r = await ok('fiila_ambassador_register', { p: { name: 'Moussa Diop', phone: '77 500 00 01', zone: 'Yoff', payout_method: 'wave', charter: true } }, A);
  assert.equal(r.ambassador.status, 'training'); assert.match(r.ambassador.code, /^[A-Z2-9]{6}$/);
  CODE = r.ambassador.code;
  AMB_ID = (await one(`select id from fiila.ambassadors where code = $1`, [CODE])).id;
  const B = await user('autre@example.test');
  await ko('fiila_ambassador_register', { p: { name: 'Autre', phone: '+221 77 500 00 01', payout_method: 'wave', charter: true } }, 'phone_taken', B);
});

await t('test : corrigé par le serveur, 2 essais par 24 h, 8/10 pour réussir, bonnes réponses jamais renvoyées', async () => {
  const bad = await ok('fiila_ambassador_quiz', { p_answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, A);
  assert.equal(bad.passed, false); assert.ok(!('answers' in bad));
  const mid = await ok('fiila_ambassador_quiz', { p_answers: [1, 1, 0, 1, 0, 1, 1, 0, 0, 1] }, A);
  assert.equal(mid.score, 7);
  await ko('fiila_ambassador_quiz', { p_answers: GOOD }, 'quiz_wait', A);
  await db.query(`update fiila.ambassador_quiz set at = at - interval '25 hours'`);
  const okq = await ok('fiila_ambassador_quiz', { p_answers: GOOD }, A);
  assert.deepEqual(okq, { score: 10, passed: true });
  assert.equal((await ok('fiila_ambassador_me', {}, A)).ambassador.status, 'review');
});

await t('validation par le fondateur seulement ; avant, le code ne marche pas', async () => {
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Trop tôt [TEST]', business_type: 'mode' } })).key;
  await ko('fiila_ambassador_link', { p_key: k, p_code: CODE }, 'ambassador_unknown');
  await ko('fiila_admin_ambassador_decide', { p_id: AMB_ID, p_decision: 'approve', p_note: null }, 'not_allowed', A);
  await ok('fiila_admin_ambassador_decide', { p_id: AMB_ID, p_decision: 'approve', p_note: 'Échange au téléphone OK' }, ADMIN);
  assert.equal((await ok('fiila_ambassador_me', {}, A)).ambassador.status, 'active');
});

let SK;
await t('lien : par le commerçant, 7 jours au plus, une seule fois ; jamais soi-même', async () => {
  SK = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Awa [TEST]', phone: '77 600 00 01', business_type: 'mode' } })).key;
  const r = await ok('fiila_ambassador_link', { p_key: SK, p_code: CODE.toLowerCase() });
  assert.deepEqual(r, { linked: true, ambassador: 'Moussa' });
  await ko('fiila_ambassador_link', { p_key: SK, p_code: CODE }, 'ambassador_already');
  assert.equal((await ok('fiila_shop_ambassador', { p_key: SK })).ambassador, 'Moussa');
  const self = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Ma boutique [TEST]', phone: '77 500 00 01', business_type: 'mode' } })).key;
  await ko('fiila_ambassador_link', { p_key: self, p_code: CODE }, 'ambassador_self');
  const old = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Ancienne [TEST]', business_type: 'mode' } })).key;
  await db.query(`update fiila.shops set created_at = now() - interval '8 days' where name = 'Ancienne [TEST]'`);
  await ko('fiila_ambassador_link', { p_key: old, p_code: CODE }, 'ambassador_too_late');
});

await t('niveau 1 : type, 5 articles avec photo, vitrine ouverte → 2 000 FCFA en attente 30 jours', async () => {
  let me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(me.shops[0].level, 0); assert.equal(me.shops[0].photos, 0);
  for (let i = 0; i < 5; i++) await ok('fiila_product_save', { p_key: SK, p: { name: 'Article ' + i + ' [TEST]', price: 1000, photo } });
  await ok('fiila_shop_vitrine', { p_key: SK, p: { public: true } });
  me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(me.shops[0].level, 1);
  assert.deepEqual(me.rewards, { pending: 2000, validated: 0, paid: 0 });
});

await t('niveau 2 : 3 clientes différentes dont 1 livrée ; les commandes au numéro de l’ambassadeur ne comptent pas', async () => {
  const mk = async (phone) => (await ok('fiila_order_create', { p_key: SK, p: { customer: { name: 'C [TEST]', phone }, items: [{ label: 'X', qty: 1, price: 1000 }] } })).id;
  await mk('77 500 00 01'); await mk('77 500 00 01'); await mk('70 100 00 01');
  let me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(me.shops[0].clients, 1, 'la cliente au numéro de l’ambassadeur est ignorée');
  const o2 = await mk('70 100 00 02'); await mk('70 100 00 03');
  me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(me.shops[0].level, 1, 'pas encore de commande livrée');
  await ok('fiila_order_set_status', { p_key: SK, p_id: o2, p_status: 'delivered' });
  me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(me.shops[0].level, 2); assert.equal(me.rewards.pending, 7000);
});

await t('gains : validés après 30 jours ; le fondateur les marque versés ; annulation avec motif', async () => {
  await db.query(`update fiila.ambassador_rewards set validate_after = now() - interval '1 minute' where level = 1`);
  const me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.deepEqual(me.rewards, { pending: 5000, validated: 2000, paid: 0 });
  const adm = await ok('fiila_admin_ambassadors', {}, ADMIN);
  assert.equal(adm.to_pay.length, 1); assert.equal(adm.to_pay[0].payout_phone, '77 500 00 01');
  await ok('fiila_admin_reward', { p_ids: [adm.to_pay[0].id], p_action: 'paid', p_reason: null }, ADMIN);
  const pend = (await ok('fiila_admin_ambassadors', {}, ADMIN)).pending[0];
  await ko('fiila_admin_reward', { p_ids: [pend.id], p_action: 'cancel', p_reason: '' }, 'reason_required', ADMIN);
  await ok('fiila_admin_reward', { p_ids: [pend.id], p_action: 'cancel', p_reason: 'Commandes suspectes' }, ADMIN);
  const me2 = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.deepEqual(me2.rewards, { pending: 0, validated: 0, paid: 2000 });
  assert.equal(me2.history.find((h) => h.level === 2).reason, 'Commandes suspectes');
  await ko('fiila_admin_ambassadors', {}, 'not_allowed', A);
});

await t('niveau 3 : 60 jours après, au moins 4 semaines actives sur 8 ; délais dépassés = pas de gain', async () => {
  // (le niveau 2 annulé au test précédent bloquerait la suite : on le rétablit pour tester le niveau 3)
  await db.query(`update fiila.ambassador_rewards set status = 'validated', reason = null where level = 2`);
  for (const ph of ['70 100 00 04', '70 100 00 05']) await ok('fiila_order_create', { p_key: SK, p: { customer: { name: 'C [TEST]', phone: ph }, items: [{ label: 'X', qty: 1, price: 1000 }] } });
  await db.query(`update fiila.ambassador_shops set linked_at = now() - interval '70 days'`);
  await db.query(`update fiila.orders set created_at = now() - (interval '1 week' * (row_number)) from (select id, row_number() over (order by created_at) from fiila.orders) x where x.id = fiila.orders.id`);
  const me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.ok(me.shops[0].active_weeks >= 4, 'semaines ' + me.shops[0].active_weeks);
  assert.equal(me.shops[0].level, 3); assert.equal(me.rewards.pending, 10000);
  // Fraude constatée sur le niveau 2 : le niveau 3 n'est plus versé non plus.
  await db.query(`update fiila.ambassador_rewards set status = 'cancelled', reason = 'test' where level = 2`);
  await db.query(`delete from fiila.ambassador_rewards where level = 3`);
  const mx = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(mx.shops[0].level, 1); assert.equal(mx.rewards.pending, 0);
  // Une nouvelle boutique jamais installée en 7 jours : expirée, aucun gain.
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Lente [TEST]', business_type: 'mode' } })).key;
  await ok('fiila_ambassador_link', { p_key: k, p_code: CODE });
  await db.query(`update fiila.ambassador_shops set linked_at = now() - interval '8 days' where shop_id = (select id from fiila.shops where name = 'Lente [TEST]')`);
  const me2 = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(me2.shops.find((s) => s.shop === 'Lente [TEST]').expired, true);
});

await t('plafond mensuel ; classement : prénom et zone seulement ; exclusion : gains non versés annulés', async () => {
  await db.query(`update fiila.settings set value = '1' where key = 'amb_monthly_cap'`);
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'En trop [TEST]', business_type: 'mode' } })).key;
  await ko('fiila_ambassador_link', { p_key: k, p_code: CODE }, 'ambassador_cap');
  const board = await ok('fiila_ambassador_board', {});
  assert.equal(board.length, 0, 'le gain de niveau 2 a été annulé : pas classé');
  await ok('fiila_admin_ambassador_decide', { p_id: AMB_ID, p_decision: 'exclude', p_note: 'Fraude' }, ADMIN);
  const me = (await ok('fiila_ambassador_me', {}, A)).ambassador;
  assert.equal(me.status, 'excluded'); assert.deepEqual(me.rewards, { pending: 0, validated: 0, paid: 2000 });
  await ko('fiila_ambassador_register', { p: { name: 'Moussa', phone: '77 500 00 01', payout_method: 'wave', charter: true } }, 'not_allowed', A);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL ambassadeurs réussis`);
process.exit(passed === results.length ? 0 : 1);
