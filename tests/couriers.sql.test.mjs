// Tests SQL : livreur attitré (invitation, acceptation), courses automatiques, fin de course, notes, suppression de boutique.
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
  if (code) assert.match(r.body.message, new RegExp(code), `${fn}: ${r.body.message}`);
};
const addr = (label) => ({ kind: 'address', label, entry: { lat: 14.75814, lng: -17.47032 }, vehicle_ok: true, instruction: 'Portail [TEST]' });

let SK, CK, CK2, INV, O1, O2, P1;
await t('livreur : inscription sans compte, clé renvoyée une fois ; véhicule inventé refusé', async () => {
  const r = await ok('fiila_courier_register', { p: { name: 'Moussa Diallo [TEST]', phone: '77 222 22 22', vehicle: 'moto', zone: 'Yoff' } });
  CK = r.key; assert.ok(CK.length > 40); assert.equal(r.courier.name, 'Moussa Diallo [TEST]');
  await ko('fiila_courier_register', { p: { name: 'X', vehicle: 'fusée' } }, 'invalid_vehicle');
  await ko('fiila_courier_me', { p_key: 'mauvaise-cle-123' }, 'courier_required');
  const me = await ok('fiila_courier_me', { p_key: CK });
  assert.deepEqual(me.courses, []); assert.deepEqual(me.shops, []);
  CK2 = (await ok('fiila_courier_register', { p: { name: 'Autre livreur [TEST]' } })).key;
});

await t('invitation : le commerçant invite, seul celui qui a le lien l’accepte', async () => {
  SK = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Livraison [TEST]' } })).key;
  INV = (await ok('fiila_courier_invite', { p_key: SK, p_name: 'Moussa', p_phone: '77 222 22 22' })).token;
  const g = await ok('fiila_courier_invite_get', { p_token: INV });
  assert.equal(g.state, 'ok'); assert.equal(g.shop, 'Boutique Livraison [TEST]');
  const shop1 = await ok('fiila_shop_get', { p_key: SK });
  assert.ok(shop1.shop.courier_invite); assert.equal(shop1.shop.courier, undefined);
  await ko('fiila_courier_accept', { p_token: 'x'.repeat(22), p_courier_key: CK }, 'not_found');
  const a = await ok('fiila_courier_accept', { p_token: INV, p_courier_key: CK });
  assert.equal(a.shop, 'Boutique Livraison [TEST]');
  const pend = await ok('fiila_shop_get', { p_key: SK });
  assert.equal(pend.shop.courier_confirmed, false, 'livreur en attente de confirmation par la boutique');
  await ok('fiila_shop_courier', { p_key: SK, p_action: 'confirm' });
  await ko('fiila_courier_accept', { p_token: INV, p_courier_key: CK2 }, 'already_used');
  const shop = await ok('fiila_shop_get', { p_key: SK });
  assert.equal(shop.shop.courier.name, 'Moussa Diallo [TEST]'); assert.equal(shop.shop.courier_auto, true);
  assert.equal(shop.shop.courier_invite, undefined);
  const me = await ok('fiila_courier_me', { p_key: CK });
  assert.equal(me.shops[0].name, 'Boutique Livraison [TEST]');
});

await t('course automatique : dès que la cliente donne son adresse, la course apparaît chez le livreur', async () => {
  O1 = await ok('fiila_order_create', { p_key: SK, p: { customer: { name: 'Awa [TEST]', phone: '70 000 00 01' }, items: [{ label: 'Sac', qty: 1, price: 5000 }] } });
  assert.equal(O1.address_state, 'pending');
  assert.equal((await ok('fiila_courier_me', { p_key: CK })).courses.length, 0);
  P1 = await ok('fiila_create_place', { p: addr('Chez Awa [TEST]') });
  await ok('fiila_fulfill_request', { p_token: O1.request_token, p_place_id: P1.id, p_place_owner: P1.owner_token });
  const me = await ok('fiila_courier_me', { p_key: CK });
  assert.equal(me.courses.length, 1);
  const c = me.courses[0];
  assert.equal(c.ref, '0001'); assert.equal(c.dest, 'Chez Awa [TEST]'); assert.equal(c.shop, 'Boutique Livraison [TEST]');
  assert.ok(c.token);
  const view = await ok('fiila_courier_view', { p_token: c.token });
  assert.equal(view.state, 'ok'); assert.equal(view.place.label, 'Chez Awa [TEST]');
  const o = await ok('fiila_order_get', { p_key: SK, p_id: O1.id });
  assert.equal(o.courier.name, 'Moussa Diallo [TEST]'); assert.equal(o.delivery_state, 'courier_ready');
  const pub = await ok('fiila_order_public', { p_token: O1.share_token });
  assert.equal(pub.order.courier.name, 'Moussa'); assert.ok(pub.order.watch_token);
  assert.ok(!JSON.stringify(pub).includes('77 222'), 'téléphone du livreur exposé sur la facture');
  assert.equal((await ok('fiila_courier_me', { p_key: CK2 })).courses.length, 0, 'autre livreur ne voit rien');
});

await t('client connu : sa commande suivante part directement au livreur', async () => {
  O2 = await ok('fiila_order_create', { p_key: SK, p: { customer_id: O1.customer_id, items: [{ label: 'Ceinture', qty: 1, price: 2000 }] } });
  assert.equal(O2.address_state, 'received');
  assert.equal(O2.delivery_state, 'courier_ready');
  assert.equal((await ok('fiila_courier_me', { p_key: CK })).courses.length, 2);
});

await t('fin de course par le livreur : commande livrée, position effacée, lien livreur retiré', async () => {
  const me = await ok('fiila_courier_me', { p_key: CK });
  const tok = me.courses.find((c) => c.ref === '0001').token;
  await ok('fiila_position', { p_token: tok, p_status: 'live', p_lat: 14.75, p_lng: -17.46, p_acc: 10 });
  await ko('fiila_courier_done', { p_key: CK2, p_send: tok }, 'not_found');
  await ok('fiila_courier_done', { p_key: CK, p_send: tok });
  const o = await ok('fiila_order_get', { p_key: SK, p_id: O1.id });
  assert.equal(o.status, 'delivered');
  const row = (await db.query(`select lat, courier_send from fiila.trackers where order_id = $1`, [O1.id])).rows[0];
  assert.equal(row.lat, null); assert.equal(row.courier_send, null);
  const after = await ok('fiila_courier_me', { p_key: CK });
  assert.equal(after.courses.length, 1); assert.equal(Number(after.done_today), 1);
});

await t('note de la livraison : par le client après livraison, moyenne visible du livreur', async () => {
  await ko('fiila_courier_review', { p_token: O2.share_token, p_rating: 5 }, 'not_delivered');
  await ko('fiila_courier_review', { p_token: O1.share_token, p_rating: 0 }, 'invalid_rating');
  await ok('fiila_courier_review', { p_token: O1.share_token, p_rating: 4 });
  const pub = await ok('fiila_order_public', { p_token: O1.share_token });
  assert.equal(pub.order.courier.my_rating, 4);
  const me = await ok('fiila_courier_me', { p_key: CK });
  assert.equal(Number(me.courier.rating), 4); assert.equal(me.courier.reviews, 1);
});

await t('envoi automatique coupé : rien ne part ; envoi manuel au livreur attitré possible', async () => {
  await ok('fiila_shop_courier', { p_key: SK, p_action: 'auto_off' });
  const o3 = await ok('fiila_order_create', { p_key: SK, p: { customer_id: O1.customer_id, items: [{ label: 'Pagne', qty: 1, price: 3000 }] } });
  assert.equal(o3.delivery_state, 'to_ship');
  const d = await ok('fiila_order_dispatch', { p_key: SK, p_id: o3.id });
  assert.equal(d.delivery_state, 'courier_ready'); assert.equal(d.courier.name, 'Moussa Diallo [TEST]');
  await ok('fiila_shop_courier', { p_key: SK, p_action: 'remove' });
  await ko('fiila_order_dispatch', { p_key: SK, p_id: o3.id }, 'no_courier');
});

await t('livreur indisponible : aucune course ne lui est envoyée', async () => {
  const inv = (await ok('fiila_courier_invite', { p_key: SK, p_name: null, p_phone: null })).token;
  await ok('fiila_courier_accept', { p_token: inv, p_courier_key: CK });
  await ok('fiila_shop_courier', { p_key: SK, p_action: 'confirm' });
  await ok('fiila_shop_courier', { p_key: SK, p_action: 'auto_on' });
  await ok('fiila_courier_update', { p_key: CK, p: { active: false } });
  const o4 = await ok('fiila_order_create', { p_key: SK, p: { customer_id: O1.customer_id, items: [{ label: 'Boucles', qty: 1, price: 1000 }] } });
  assert.equal(o4.delivery_state, 'to_ship');
  await ok('fiila_courier_update', { p_key: CK, p: { active: true } });
});

await t('sécurité : livreur non confirmé ne reçoit rien ; remplacé, il perd ses courses et ne peut plus clôturer', async () => {
  const SK2 = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique S5 [TEST]' } })).key;
  const inv1 = (await ok('fiila_courier_invite', { p_key: SK2, p_name: null, p_phone: null })).token;
  await ok('fiila_courier_accept', { p_token: inv1, p_courier_key: CK2 });
  const pl = await ok('fiila_create_place', { p: addr('Adresse S5 [TEST]') });
  const o = await ok('fiila_order_create', { p_key: SK2, p: { customer: { name: 'S5 [TEST]' }, items: [{ label: 'x', qty: 1, price: 1 }] } });
  await ok('fiila_fulfill_request', { p_token: o.request_token, p_place_id: pl.id, p_place_owner: pl.owner_token });
  assert.equal((await ok('fiila_courier_me', { p_key: CK2 })).courses.length, 0, 'aucune course avant confirmation');
  await ok('fiila_shop_courier', { p_key: SK2, p_action: 'confirm' });
  const me = await ok('fiila_courier_me', { p_key: CK2 });
  assert.equal(me.courses.length, 1, 'la confirmation envoie les commandes prêtes');
  const oldTok = me.courses[0].token;
  await ok('fiila_shop_courier', { p_key: SK2, p_action: 'remove' });
  assert.equal((await ok('fiila_courier_me', { p_key: CK2 })).courses.length, 0);
  assert.equal((await ok('fiila_courier_view', { p_token: oldTok })).state, 'expired');
  await ko('fiila_courier_done', { p_key: CK2, p_send: oldTok }, 'not_found');
  const st = await ok('fiila_order_get', { p_key: SK2, p_id: o.id });
  assert.equal(st.status, 'open');
  await ko('fiila_courier_review', { p_token: o.share_token, p_rating: 1 }, 'not_delivered');
  await ok('fiila_order_set_status', { p_key: SK2, p_id: o.id, p_status: 'delivered' });
  await ko('fiila_courier_review', { p_token: o.share_token, p_rating: 1 }, 'no_courier'); // pas clôturée par le livreur
  await ok('fiila_shop_delete', { p_key: SK2 });
});

await t('suppression de la boutique : commandes, demandes, articles effacés ; adresse de la cliente intacte ; livreur intact', async () => {
  await ko('fiila_shop_delete', { p_key: 'mauvaise-cle-123' }, 'shop_required');
  await ok('fiila_shop_delete', { p_key: SK });
  const n = async (sql, a) => (await db.query(sql, a)).rows[0].n;
  assert.equal(await n(`select count(*)::int n from fiila.shops where name = 'Boutique Livraison [TEST]'`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.orders`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.requests where purpose like 'Livraison de la commande%'`), 0);
  assert.equal(await n(`select count(*)::int n from fiila.places where id = $1`, [P1.id]), 1);
  assert.equal((await ok('fiila_courier_me', { p_key: CK })).courses.length, 0);
  await ok('fiila_courier_delete', { p_key: CK });
  await ko('fiila_courier_me', { p_key: CK }, 'courier_required');
});

await t('rôles : anon ne lit ni les livreurs ni les invitations', async () => {
  await assert.rejects(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query('select * from fiila.couriers'); }));
  await assert.rejects(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query('select fiila.order_create_base(null, null)'); }));
});

for (const r of results) console.log(r.join(' | '));
console.log(`\n${passed}/${results.length} tests SQL livreurs réussis`);
process.exit(passed === results.length ? 0 : 1);
