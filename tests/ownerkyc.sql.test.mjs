// Tests SQL : propriétaire de la boutique et pièce d'identité (fondateur, 27/10/2026 16:20 ; migration 20261027200000).
// Nom et numéro du propriétaire (propriétaire seulement, numéro vérifié) ; pièce exigée après la première vente, blocage
// immédiat de toute nouvelle commande (application et site) tant qu'elle n'est pas envoyée ; refus = images effacées et
// nouveau blocage ; réglage kyc_required ; lecture des images par l'équipe (shops_write) journalisée ; tables fermées.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb({ kyc: true });
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
const F = await user('fondateur@example.test', 'super_admin');
const SUP = await user('support@example.test', 'support');
const ED = await user('editeur@example.test');
async function shop(name) {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name, business_type: 'enfants' } });
  const p = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Robe ' + name, price: 10000 } });
  return { key: s.key, id: s.shop.id, pid: p.id };
}
const A = await shop('Testo A [TEST]'), B = await shop('Testo B [TEST]');
const order = (k) => rpc(db, 'fiila_order_create', { p_key: k, p: { customer: { name: 'Awa [TEST]' }, items: [{ label: 'Robe', qty: 1, price: 10000 }] } });
// Image JPEG de test (> 2 Ko) : en-tête JPEG suivi de remplissage.
const IMG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]).toString('base64');

await t('nom et numéro du propriétaire : demandés tant qu’ils manquent, numéro sénégalais normalisé, réservé au propriétaire', async () => {
  let id = await ok('fiila_shop_identity', { p_key: A.key });
  assert.equal(id.need_owner, true); assert.equal(id.blocked, false); assert.equal(id.kyc.needed, false);
  await ko('fiila_shop_owner_save', { p_key: A.key, p_name: ' ', p_phone: '77 123 45 67' }, 'owner_name_required');
  await ko('fiila_shop_owner_save', { p_key: A.key, p_name: 'Aminata Diop', p_phone: '123' }, 'phone_invalid');
  id = await ok('fiila_shop_owner_save', { p_key: A.key, p_name: 'Aminata Diop', p_phone: '77 123 45 67' });
  assert.equal(id.owner_phone, '+221771234567'); assert.equal(id.owner_name, 'Aminata Diop'); assert.equal(id.need_owner, false);
  await ko('fiila_shop_owner_save', { p_key: B.key + 'x', p_name: 'X', p_phone: '771234567' }, 'shop_required');
});

await t('éditeur : ne voit ni le nom ni le numéro, ne peut pas les changer ni envoyer de pièce', async () => {
  const inv = await ok('fiila_shop_invite', { p_key: A.key, p_name: 'Éditrice', p_phone: '770000001', p_role: 'editor' });
  await db.query(`update auth.users set phone = '221770000001', phone_confirmed_at = now() where id = $1`, [ED.uid]);
  const acc = await rpc(db, 'fiila_shop_invite_accept', { p_token: inv.token }, ED);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const id = await ok('fiila_shop_identity', { p_key: null }, ED);
  assert.equal(id.owner_phone, undefined); assert.equal(id.role, 'editor');
  await ko('fiila_shop_owner_save', { p_key: null, p_name: 'Moi', p_phone: '771111111' }, 'shop_owner_only', ED);
  await ko('fiila_shop_kyc_submit', { p_key: null, p_doc_type: 'passport', p_front: IMG }, 'shop_owner_only', ED);
});

await t('avant la première vente : commandes libres ; après une livraison, blocage immédiat (application et site)', async () => {
  const o1 = await order(A.key); assert.equal(o1.status, 200);
  const o2 = await order(A.key); assert.equal(o2.status, 200, 'pas encore de vente : une 2ᵉ commande ouverte passe');
  await ok('fiila_order_set_status', { p_key: A.key, p_id: o1.body.id, p_status: 'delivered' });
  const id = await ok('fiila_shop_identity', { p_key: A.key });
  assert.equal(id.kyc.needed, true); assert.equal(id.blocked, true);
  const o3 = await order(A.key); assert.notEqual(o3.status, 200); assert.match(o3.body.message, /shop_kyc_required/);
  const v = await ok('fiila_shop_vitrine', { p_key: A.key, p: { public: true } });
  await ko('fiila_vitrine_order', { p_slug: v.slug, p: { items: [{ product_id: A.pid, qty: 1 }], customer: { name: 'Client [TEST]', phone: '70 000 00 09' } } }, 'shop_kyc_required');
  assert.equal((await order(B.key)).status, 200, 'une autre boutique n’est pas touchée');
});

await t('paiement confirmé sur une commande non annulée = vente', async () => {
  const o = await order(B.key);
  await db.query(`insert into fiila.payments (order_id, amount, method) values ($1, 5000, 'cash')`, [o.body.id]);
  assert.equal((await ok('fiila_shop_identity', { p_key: B.key })).blocked, true);
  await db.query(`update fiila.payments set status = 'refunded' where order_id = $1`, [o.body.id]);
  assert.equal((await ok('fiila_shop_identity', { p_key: B.key })).blocked, false, 'paiement remboursé : plus une vente');
});

await t('envoi de la pièce : formats contrôlés, verso requis pour la carte ; une fois envoyée, les commandes reprennent', async () => {
  await ko('fiila_shop_kyc_submit', { p_key: A.key, p_doc_type: 'permis', p_front: IMG }, 'invalid_payload');
  await ko('fiila_shop_kyc_submit', { p_key: A.key, p_doc_type: 'cni', p_front: IMG }, 'kyc_back_required');
  await ko('fiila_shop_kyc_submit', { p_key: A.key, p_doc_type: 'passport', p_front: Buffer.from('pas une image du tout, juste du texte').toString('base64') }, 'kyc_image_invalid');
  await ko('fiila_shop_kyc_submit', { p_key: A.key, p_doc_type: 'passport', p_front: Buffer.alloc(800000, 1).toString('base64') }, 'kyc_image_invalid');
  const id = await ok('fiila_shop_kyc_submit', { p_key: A.key, p_doc_type: 'cni', p_front: 'data:image/jpeg;base64,' + IMG, p_back: IMG });
  assert.equal(id.kyc.status, 'submitted'); assert.equal(id.blocked, false);
  assert.equal((await order(A.key)).status, 200);
});

await t('back-office : file, lecture des images journalisée (shops_write), refus = images effacées et nouveau blocage, puis validation', async () => {
  await ko('fiila_bo_kyc_list', {}, 'not_allowed', SUP);
  await ko('fiila_bo_kyc_doc', { p_shop: A.id }, 'not_allowed', SUP);
  await ko('fiila_bo_kyc_doc', { p_shop: A.id }, null);
  const l = await ok('fiila_bo_kyc_list', {}, F);
  assert.deepEqual(l.pending.map((x) => x.shop), ['Testo A [TEST]']); assert.equal(l.pending[0].owner_phone, '+221771234567');
  assert.ok(l.blocked.some((x) => x.shop === 'Testo B [TEST]') === false);
  const doc = await ok('fiila_bo_kyc_doc', { p_shop: A.id }, F);
  assert.match(doc.front, /^data:image\/jpeg;base64,/); assert.match(doc.back, /^data:image\/jpeg;base64,/);
  assert.equal(Number((await one(`select count(*) n from fiila.admin_log where action = 'kyc_view' and target_id = $1`, [A.id])).n), 1);
  await ko('fiila_bo_kyc_decide', { p_shop: A.id, p_ok: false, p_reason: ' ' }, 'reason_required', F);
  let bi = await ok('fiila_bo_kyc_decide', { p_shop: A.id, p_ok: false, p_reason: 'Photo floue' }, F);
  assert.equal(bi.kyc.status, 'rejected'); assert.equal(bi.kyc.has_images, false); assert.equal(bi.blocked, true);
  assert.equal((await one(`select front is null and back is null x from fiila.shop_kyc where shop_id = $1`, [A.id])).x, true);
  const id = await ok('fiila_shop_identity', { p_key: A.key });
  assert.equal(id.kyc.status, 'rejected'); assert.equal(id.kyc.reason, 'Photo floue');
  assert.match((await order(A.key)).body.message, /shop_kyc_required/);
  await ok('fiila_shop_kyc_submit', { p_key: A.key, p_doc_type: 'passport', p_front: IMG });
  bi = await ok('fiila_bo_kyc_decide', { p_shop: A.id, p_ok: true }, F);
  assert.equal(bi.kyc.status, 'verified'); assert.equal(bi.blocked, false);
  await ko('fiila_shop_kyc_submit', { p_key: A.key, p_doc_type: 'passport', p_front: IMG }, 'kyc_already_verified');
  const log = (await db.query(`select action from fiila.admin_log where target_id = $1 and action like 'kyc_%' order by at`, [A.id])).rows.map((r) => r.action);
  assert.deepEqual(log, ['kyc_view', 'kyc_rejected', 'kyc_verified']);
  const ov = await ok('fiila_bo_overview', {}, F);
  assert.equal(ov.queues.kyc, 0);
});

await t('réglage kyc_required : 0 lève l’exigence sans toucher aux pièces ; borné à 0/1 au back-office', async () => {
  const C = await shop('Testo C [TEST]');
  const o = await order(C.key); await ok('fiila_order_set_status', { p_key: C.key, p_id: o.body.id, p_status: 'delivered' });
  assert.match((await order(C.key)).body.message, /shop_kyc_required/);
  await ko('fiila_bo_setting_set', { p_key: 'kyc_required', p_value: '2', p_reason: 'test' }, null, F);
  await db.query(`update fiila.settings set value = '0' where key = 'kyc_required'`);
  assert.equal((await order(C.key)).status, 200);
  assert.equal((await ok('fiila_shop_identity', { p_key: C.key })).kyc.needed, false);
  await db.query(`update fiila.settings set value = '1' where key = 'kyc_required'`);
  const st = await ok('fiila_bo_settings', {}, F);
  assert.ok(JSON.stringify(st).includes('kyc_required'));
});

await t('boutiques de démonstration et boutique Fii : jamais bloquées', async () => {
  const D = await shop('Démo [TEST]');
  await db.query(`update fiila.shops set demo = true where id = $1`, [D.id]);
  const o = await order(D.key); await ok('fiila_order_set_status', { p_key: D.key, p_id: o.body.id, p_status: 'delivered' });
  assert.equal((await order(D.key)).status, 200);
  assert.equal((await ok('fiila_shop_identity', { p_key: D.key })).need_owner, false);
});

await t('table des pièces fermée : aucun accès direct pour anon ni authenticated', async () => {
  for (const role of ['anon', 'authenticated']) {
    let denied = false;
    try { await db.exec(`set role ${role}; select * from fiila.shop_kyc;`); } catch { denied = true; }
    await db.exec('reset role');
    assert.equal(denied, true, role);
  }
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests propriétaire et pièce d’identité réussis`);
process.exit(passed === results.length ? 0 : 1);
