// Tests SQL : contrôles des Agents avant tout versement (algorithmes v2.1, lot 1 / A3, validé le 23/10/2026).
// Appels directs des fonctions du serveur (pas seulement les boutons). Données synthétiques uniquement.
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
const user = async (email, staff) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (staff) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, staff]);
  return { uid: id };
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
async function agent(email, phone) {
  const U = await user(email);
  const r = await ok('fiila_ambassador_register', { p: { name: 'Agent ' + email.split('@')[0] + ' [TEST]', phone, zone: 'Yoff', payout_method: 'wave', charter: true } }, U);
  await db.query(`update fiila.ambassadors set status = 'active', quiz_passed_at = now() where code = $1`, [r.ambassador.code]);
  return { U, code: r.ambassador.code, id: (await one(`select id from fiila.ambassadors where code = $1`, [r.ambassador.code])).id };
}
async function eligibleShop(code, name, phone) {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name, business_type: 'mode', phone } });
  await ok('fiila_ambassador_link', { p_key: s.key, p_code: code });
  for (let i = 0; i < 5; i++) await ok('fiila_product_save', { p_key: s.key, p: { name: 'Article ' + i + ' [TEST]', price: 1000, photo } });
  await ok('fiila_shop_vitrine', { p_key: s.key, p: { public: true } });
  return s;
}
const reward = async (shopId, level) => one(`select * from fiila.ambassador_rewards where shop_id = $1 and level = $2`, [shopId, level]);
const logs = async (target) => (await db.query(`select action, detail from fiila.admin_log where target_id = $1 order by at, id`, [target])).rows;
const decide = (id, d, note, who) => rpc(db, 'fiila_admin_ambassador_decide', { p_id: id, p_decision: d, p_note: note }, who);

const ADMIN = await user('fondatrice@example.test', 'super_admin');
const AG = await agent('khady@example.test', '77 700 00 01');

await t('1. numéro partagé légitime : deux boutiques familiales au même numéro gagnent chacune leur niveau 1, sans blocage ni score', async () => {
  const a = await eligibleShop(AG.code, 'Boutique Famille A [TEST]', '76 111 11 11');
  const b = await eligibleShop(AG.code, 'Boutique Famille B [TEST]', '76 111 11 11');
  await ok('fiila_ambassador_me', {}, AG.U);
  assert.equal((await reward(a.shop.id, 1)).status, 'pending');
  assert.equal((await reward(b.shop.id, 1)).status, 'pending');
});

await t('2. recrutement groupé légitime : trois boutiques rattachées dans l’heure, trois gains en attente normale', async () => {
  const G = await agent('groupe@example.test', '77 700 00 02');
  const ids = [];
  for (let i = 1; i <= 3; i++) ids.push((await eligibleShop(G.code, 'Boutique Groupe ' + i + ' [TEST]')).shop.id);
  await ok('fiila_ambassador_me', {}, G.U);
  for (const id of ids) {
    const r = await reward(id, 1);
    assert.equal(r.status, 'pending');
    assert.ok(new Date(r.validate_after) - new Date(r.earned_at) >= 29 * 864e5, 'délai de 30 jours inchangé');
  }
});

await t('3. retrait ou livraison hors Fii : une commande marquée livrée sans livreur Fii compte pour le niveau 2', async () => {
  const s = await eligibleShop(AG.code, 'Boutique Retrait [TEST]');
  for (let i = 1; i <= 3; i++) {
    const o = await ok('fiila_order_create', { p_key: s.key, p: { customer: { name: 'Cliente ' + i + ' [TEST]', phone: '70 300 00 0' + i }, items: [{ label: 'Robe', qty: 1, price: 5000 }] } });
    if (i === 1) await ok('fiila_order_set_status', { p_key: s.key, p_id: o.id, p_status: 'delivered' });
  }
  await ok('fiila_ambassador_me', {}, AG.U);
  assert.ok(await reward(s.shop.id, 2), 'niveau 2 atteint');
});

let PAID_ID, CANCEL_ID, FUTURE_ID;
await t('4. gain versé intouchable, y compris après exclusion ; versement refusé sans numéro confirmé (#34)', async () => {
  const s = (await one(`select shop_id from fiila.ambassador_rewards where shop_name = 'Boutique Famille A [TEST]' and level = 1`)).shop_id;
  await db.query(`update fiila.ambassador_rewards set validate_after = now() - interval '1 minute' where ambassador_id = $1`, [AG.id]);
  await ok('fiila_ambassador_me', {}, AG.U);   // passage automatique à « à verser »
  PAID_ID = (await reward(s, 1)).id;
  await ko('fiila_admin_reward', { p_ids: [PAID_ID], p_action: 'paid', p_reason: null }, 'payout_unverified', ADMIN);
  // Le numéro du compte est confirmé, mais différent du numéro de versement : toujours refusé.
  await db.query(`update auth.users set phone = '221770009999', phone_confirmed_at = now() where id = $1`, [AG.U.uid]);
  await ko('fiila_admin_reward', { p_ids: [PAID_ID], p_action: 'paid', p_reason: null }, 'payout_unverified', ADMIN);
  await db.query(`update auth.users set phone = '221777000001' where id = $1`, [AG.U.uid]);
  assert.equal((await ok('fiila_admin_reward', { p_ids: [PAID_ID], p_action: 'paid', p_reason: null }, ADMIN)).updated, 1);
  // Changer le numéro de versement annule la vérification.
  await db.query(`update fiila.ambassadors set payout_phone = '77 700 99 99' where id = $1`, [AG.id]);
  assert.equal((await ok('fiila_ambassador_me', {}, AG.U)).ambassador.payout_verified, false);
  await db.query(`update fiila.ambassadors set payout_phone = '77 700 00 01' where id = $1`, [AG.id]);
  assert.equal((await ok('fiila_ambassador_me', {}, AG.U)).ambassador.payout_verified, true);
  assert.equal((await ok('fiila_admin_reward', { p_ids: [PAID_ID], p_action: 'cancel', p_reason: 'Essai [TEST]' }, ADMIN)).updated, 0);
  CANCEL_ID = (await one(`select r.id from fiila.ambassador_rewards r where r.shop_name = 'Boutique Famille B [TEST]' and level = 1`)).id;
  FUTURE_ID = (await one(`select r.id from fiila.ambassador_rewards r where r.shop_name = 'Boutique Retrait [TEST]' and level = 2`)).id;
  await db.query(`update fiila.ambassador_rewards set validate_after = now() + interval '20 days', status = 'pending' where id = $1`, [FUTURE_ID]);
  assert.equal((await decide(AG.id, 'exclude', null, ADMIN)).status, 400, 'motif obligatoire pour exclure');
  await ok('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'exclude', p_note: 'Contrôle [TEST]' }, ADMIN);
  assert.equal((await one(`select status from fiila.ambassador_rewards where id = $1`, [PAID_ID])).status, 'paid');
  assert.equal((await one(`select status, reason from fiila.ambassador_rewards where id = $1`, [CANCEL_ID])).reason, 'Contrôle [TEST]');
});

await t('5. un exclu ne redevient actif que par « réintégrer » (motif) puis « réactiver » ; aucun détour', async () => {
  for (const d of ['suspend', 'reactivate', 'approve', 'training', 'exclude']) {
    const r = await decide(AG.id, d, 'Détour [TEST]', ADMIN);
    assert.equal(r.status, 400, d + ' depuis exclu aurait dû être refusé'); assert.match(r.body.message, /invalid_state/);
  }
  await ko('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'reinstate', p_note: '  ' }, 'reason_required', ADMIN);
  await ko('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'reinstate', p_note: 'Erreur [TEST]' }, 'not_allowed', AG.U);
  await ok('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'reinstate', p_note: 'Erreur de contrôle [TEST]' }, ADMIN);
  assert.equal((await one(`select status from fiila.ambassadors where id = $1`, [AG.id])).status, 'suspended');
  await ko('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'reinstate', p_note: 'Encore [TEST]' }, 'invalid_state', ADMIN);
  await ok('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'reactivate', p_note: null }, ADMIN);
  assert.equal((await one(`select status from fiila.ambassadors where id = $1`, [AG.id])).status, 'active');
  // Suspendre : motif obligatoire, depuis « actif » seulement.
  await ko('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'suspend', p_note: null }, 'reason_required', ADMIN);
  const T = await agent('formation@example.test', '77 700 00 03');
  await db.query(`update fiila.ambassadors set status = 'training' where id = $1`, [T.id]);
  await ko('fiila_admin_ambassador_decide', { p_id: T.id, p_decision: 'suspend', p_note: 'x [TEST]' }, 'invalid_state', ADMIN);
});

await t('6. rétablir un gain : un seul, avec motif ; même gain, même montant, mêmes dates ; statut selon le délai ; répéter sans effet', async () => {
  const before = await one(`select * from fiila.ambassador_rewards where id = $1`, [CANCEL_ID]);
  await ko('fiila_admin_reward', { p_ids: [CANCEL_ID], p_action: 'restore', p_reason: '' }, 'reason_required', ADMIN);
  await ko('fiila_admin_reward', { p_ids: [CANCEL_ID, FUTURE_ID], p_action: 'restore', p_reason: 'x [TEST]' }, 'invalid_payload', ADMIN);
  const n0 = (await one(`select count(*)::int n from fiila.ambassador_rewards`)).n;
  assert.equal((await ok('fiila_admin_reward', { p_ids: [CANCEL_ID], p_action: 'restore', p_reason: 'Exclusion levée [TEST]' }, ADMIN)).updated, 1);
  const after = await one(`select * from fiila.ambassador_rewards where id = $1`, [CANCEL_ID]);
  assert.equal(after.status, 'validated', 'délai déjà écoulé → à verser');
  assert.equal(after.amount, before.amount); assert.equal(+after.earned_at, +before.earned_at); assert.equal(+after.validate_after, +before.validate_after);
  assert.equal((await ok('fiila_admin_reward', { p_ids: [FUTURE_ID], p_action: 'restore', p_reason: 'Exclusion levée [TEST]' }, ADMIN)).updated, 1);
  assert.equal((await one(`select status from fiila.ambassador_rewards where id = $1`, [FUTURE_ID])).status, 'pending', 'délai pas écoulé → en vérification');
  assert.equal((await ok('fiila_admin_reward', { p_ids: [CANCEL_ID], p_action: 'restore', p_reason: 'Encore [TEST]' }, ADMIN)).updated, 0, 'répéter : sans effet');
  assert.equal((await ok('fiila_admin_reward', { p_ids: [PAID_ID], p_action: 'restore', p_reason: 'x [TEST]' }, ADMIN)).updated, 0, 'versé : intouchable');
  assert.equal((await one(`select count(*)::int n from fiila.ambassador_rewards`)).n, n0, 'aucun nouveau gain');
  // Rétablissement et versement lancés ensemble : un seul effet chacun, jamais deux versements.
  await ok('fiila_admin_reward', { p_ids: [CANCEL_ID], p_action: 'cancel', p_reason: 'Re-contrôle [TEST]' }, ADMIN);
  const [r1, r2, r3] = await Promise.all([
    rpc(db, 'fiila_admin_reward', { p_ids: [CANCEL_ID], p_action: 'restore', p_reason: 'Course [TEST]' }, ADMIN),
    rpc(db, 'fiila_admin_reward', { p_ids: [CANCEL_ID], p_action: 'paid', p_reason: null }, ADMIN),
    rpc(db, 'fiila_admin_reward', { p_ids: [CANCEL_ID], p_action: 'paid', p_reason: null }, ADMIN)]);
  assert.equal(r1.body.updated, 1);
  assert.ok(r2.body.updated + r3.body.updated <= 1, 'au plus un versement');
  assert.ok((await logs(CANCEL_ID)).filter((l) => l.action === 'reward_paid').length <= 1);
  // Exclu : aucun rétablissement possible.
  await ok('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'suspend', p_note: 'Pause [TEST]' }, ADMIN);
  await ok('fiila_admin_ambassador_decide', { p_id: AG.id, p_decision: 'exclude', p_note: 'Fin [TEST]' }, ADMIN);
  await ko('fiila_admin_reward', { p_ids: [FUTURE_ID], p_action: 'restore', p_reason: 'x [TEST]' }, 'invalid_state', ADMIN);
});

await t('7. journal : un événement par gain changé, avec ancien statut et motif ; rien pour un gain inchangé, une répétition ou le passage automatique', async () => {
  const G = await agent('journal@example.test', '77 700 00 04');
  const s1 = await eligibleShop(G.code, 'Boutique Journal 1 [TEST]'), s2 = await eligibleShop(G.code, 'Boutique Journal 2 [TEST]');
  await ok('fiila_ambassador_me', {}, G.U);
  const a = (await reward(s1.shop.id, 1)).id, b = (await reward(s2.shop.id, 1)).id;
  await db.query(`update fiila.ambassador_rewards set validate_after = now() - interval '1 minute' where id = $1`, [b]);
  await ok('fiila_admin_ambassadors', {}, ADMIN);   // le back-office déclenche le passage automatique de b à « à verser »
  assert.equal((await one(`select status from fiila.ambassador_rewards where id = $1`, [b])).status, 'validated');
  assert.deepEqual(await logs(b), [], 'passage automatique : pas une décision, pas de journal');
  await db.query(`update auth.users set phone = '221777000004', phone_confirmed_at = now() where id = $1`, [G.U.uid]);
  await ok('fiila_admin_reward', { p_ids: [b], p_action: 'paid', p_reason: null }, ADMIN);
  // Lot mixte : a (en attente) annulé, b (versé) inchangé.
  assert.equal((await ok('fiila_admin_reward', { p_ids: [a, b], p_action: 'cancel', p_reason: 'Doublon [TEST]' }, ADMIN)).updated, 1);
  await ok('fiila_admin_reward', { p_ids: [a, b], p_action: 'cancel', p_reason: 'Doublon [TEST]' }, ADMIN);
  const la = await logs(a), lb = await logs(b);
  assert.equal(la.length, 1); assert.equal(la[0].action, 'reward_cancelled');
  assert.equal(la[0].detail.from, 'pending'); assert.equal(la[0].detail.to, 'cancelled'); assert.equal(la[0].detail.reason, 'Doublon [TEST]');
  assert.equal(lb.length, 1); assert.equal(lb[0].action, 'reward_paid'); assert.equal(lb[0].detail.from, 'validated');
  await ok('fiila_admin_reward', { p_ids: [a], p_action: 'restore', p_reason: 'Vérifié [TEST]' }, ADMIN);
  const lr = (await logs(a)).at(-1);
  assert.equal(lr.action, 'reward_restored'); assert.equal(lr.detail.from, 'cancelled'); assert.equal(lr.detail.reason, 'Vérifié [TEST]');
  // Décisions sur l'agent : ancien statut et motif.
  await ok('fiila_admin_ambassador_decide', { p_id: G.id, p_decision: 'suspend', p_note: 'Vérification [TEST]' }, ADMIN);
  const ls = (await logs(G.id)).at(-1);
  assert.equal(ls.action, 'ambassador_suspended'); assert.equal(ls.detail.from, 'active'); assert.equal(ls.detail.note, 'Vérification [TEST]');
  // Historique de la fiche : seulement cet agent, réservé à l'équipe.
  const hst = await ok('fiila_bo_ambassador_history', { p_id: G.id }, ADMIN);
  assert.deepEqual(hst.events.map((e) => e.action).sort(), ['ambassador_suspended', 'reward_cancelled', 'reward_paid', 'reward_restored']);
  assert.ok(hst.events.every((e) => e.actor));
  assert.deepEqual(hst.cancelled, []);
  const hAg = await ok('fiila_bo_ambassador_history', { p_id: AG.id }, ADMIN);
  assert.ok(hAg.events.some((e) => e.action === 'ambassador_reinstated'));
  assert.ok(hAg.cancelled.length >= 1);
  await ko('fiila_bo_ambassador_history', { p_id: G.id }, 'not_allowed', G.U);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL contrôles des agents réussis`);
process.exit(passed === results.length ? 0 : 1);
