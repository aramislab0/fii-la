// Tests SQL : mandat AGENTS-AMBASSADEURS-001, lot 4 — un seul Manager, deux contextes : conversation de la marque invitée
// (règles, escalade visible), réponse de l'équipe, jalons réels ; WhatsApp : contexte vérifié par le serveur, question si
// le numéro est à la fois celui d'un agent et d'une marque. Le Manager ne fixe ni prix, ni prolongation, ni quota.
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
  assert.notEqual(r.status, 200, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const SVC = { role: 'service_role' };
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
let F, SUP, INV, SHOP;

await t('marque : le Manager répond selon l’état réel ; prix et prolongation transmis à l’équipe, jamais inventés', async () => {
  F = await user('assane@example.test', 'super_admin'); SUP = await user('aide@example.test', 'support');
  await ok('fiila_bo_pack_save', { p: { code: 'complet', name: 'Pack (test)', benefits: ['Accompagnement'] } }, F);
  INV = await ok('fiila_bo_partner_invite', { p: { brand: 'Maison Sow [TEST]', whatsapp: '77 800 00 01', months: 1 } }, F);
  SHOP = await ok('fiila_shop_save', { p_key: null, p: { name: 'Maison Sow [TEST]', business_type: 'mode' } });
  await ok('fiila_partner_accept', { p_token: INV.token, p_key: SHOP.key });
  let r = await ok('fiila_partner_message_send', { p_key: SHOP.key, p_body: 'Bonjour, je commence par quoi ?' });
  assert.match(r.reply, /Activer mon essai/); assert.equal(r.escalate, false);
  assert.equal(r.messages.length, 2, 'la conversation renvoyée contient le message et la réponse');
  await ok('fiila_partner_activate', { p_key: SHOP.key });
  r = await ok('fiila_partner_message_send', { p_key: SHOP.key, p_body: 'Et après l’essai, combien ça coûte ?' });
  assert.equal(r.escalate, true); assert.doesNotMatch(r.reply, /FCFA|\d+ ?F/); assert.match(r.reply, /équipe/);
  r = await ok('fiila_partner_message_send', { p_key: SHOP.key, p_body: 'Je mets quoi en premier ?' });
  assert.match(r.reply, /premier article/);
  await ko('fiila_partner_message_send', { p_key: 'mauvaise-cle', p_body: 'x' }, 'shop_required');
});

await t('équipe : droit « partners » ; lecture marque comme lu ; réponse tracée ; jalons réels', async () => {
  await ko('fiila_bo_partner_thread', { p_invite: INV.id }, 'not_allowed', SUP);
  let d = await ok('fiila_bo_partners', {}, F);
  let m = d.invites[0].trial.milestones;
  assert.equal(m.configured, true); assert.equal(m.first_product, false); assert.equal(m.storefront, false); assert.equal(m.to_read, 3); assert.equal(m.escalated, 1);
  const th = await ok('fiila_bo_partner_thread', { p_invite: INV.id }, F);
  assert.equal(th.messages.length, 6);
  await ok('fiila_bo_partner_reply', { p_invite: INV.id, p_body: 'Bonjour, l’équipe vous rappelle demain pour la suite.' }, F);
  assert.equal((await one(`select count(*)::int n from fiila.admin_log where action = 'partner_reply'`)).n, 1);
  await ok('fiila_product_save', { p_key: SHOP.key, p: { name: 'Robe [TEST]', price: 9000 } });
  await ok('fiila_shop_vitrine', { p_key: SHOP.key, p: { public: true } });
  d = await ok('fiila_bo_partners', {}, F);
  m = d.invites[0].trial.milestones;
  assert.equal(m.first_product, true); assert.equal(m.storefront, true); assert.equal(m.to_read, 0);
  const mine = await ok('fiila_partner_messages', { p_key: SHOP.key });
  assert.equal(mine.messages.at(-1).author, 'staff');
});

await t('WhatsApp : numéro de la marque seule → conversation de sa boutique, réponse du Manager', async () => {
  await db.query(`update fiila.settings set value = '1' where key = 'amb_whatsapp'`);
  const r = await ok('fiila_wa_inbound', { p_phone: '221778000001', p_body: 'Comment ouvrir ma vitrine ?', p_wamid: 'p.1' }, SVC);
  assert.equal(r.partner, true); assert.ok(r.reply);
  const wa = (await db.query(`select author from fiila.partner_messages where channel = 'whatsapp' order by author`)).rows.map((x) => x.author);
  assert.deepEqual(wa, ['brand', 'manager'], 'message de la marque et réponse du Manager, tous deux sur WhatsApp');
});

await t('WhatsApp : numéro à la fois agent et marque → question 1/2 ; « 2 » = boutique pendant 24 h ; rien d’enregistré côté agent', async () => {
  const A = await user('double@example.test');
  const reg = await ok('fiila_ambassador_register', { p: { name: 'Double Casquette', phone: '77 800 00 02', payout_method: 'wave', charter: true } }, A);
  await db.query(`update fiila.ambassadors set status = 'active' where code = $1`, [reg.ambassador.code]);
  const inv = await ok('fiila_bo_partner_invite', { p: { brand: 'Boutique Double [TEST]', whatsapp: '77 800 00 02', months: 1 } }, F);
  const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Double [TEST]', business_type: 'beaute' } });
  await ok('fiila_partner_accept', { p_token: inv.token, p_key: s.key });
  const agentMsgs = async () => (await one(`select count(*)::int n from fiila.amb_messages m join fiila.ambassadors a on a.id = m.ambassador_id where a.code = $1`, [reg.ambassador.code])).n;
  const before = await agentMsgs();
  let r = await ok('fiila_wa_inbound', { p_phone: '221778000002', p_body: 'Bonjour', p_wamid: 'd.1' }, SVC);
  assert.match(r.reply, /1\. votre activité d’Agent.*2\. votre boutique Boutique Double/);
  r = await ok('fiila_wa_inbound', { p_phone: '221778000002', p_body: '2', p_wamid: 'd.2' }, SVC);
  assert.match(r.reply, /boutique Boutique Double/);
  r = await ok('fiila_wa_inbound', { p_phone: '221778000002', p_body: 'Je veux ouvrir ma vitrine', p_wamid: 'd.3' }, SVC);
  assert.equal(r.partner, true);
  assert.equal(await agentMsgs(), before, 'rien dans la conversation d’agent');
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL Manager des Ambassadeurs réussis`);
process.exit(passed === results.length ? 0 : 1);
