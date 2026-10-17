// Tests SQL : comptes, coffre d'adresses, boutique (clients, commandes, factures, paiements, livraison).
import assert from 'node:assert/strict';
import { createDb, createUser, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const ok = async (fn, args, opt) => {
  const r = await rpc(db, fn, args, opt);
  assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`);
  return r.body;
};
const ko = async (fn, args, code, opt) => {
  const r = await rpc(db, fn, args, opt);
  assert.equal(r.status, 400, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code), `${fn}: ${r.body.message}`);
  return r.body;
};
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0'), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);
const addr = (label, extra = {}) => ({ kind: 'address', label, entry: { lat: 14.75814, lng: -17.47032, acc: 10 },
  vehicle_ok: true, instruction: 'Portail bleu [TEST]', ...extra });

const U1 = await createUser(db, 'u1@test.invalid');
const U2 = await createUser(db, 'u2@test.invalid');
const as1 = { uid: U1 }, as2 = { uid: U2 };

let P1, P2;
await t('compte : une fiche créée connecté est rattachée au compte, retrouvée sans clé', async () => {
  P1 = await ok('fiila_create_place', { p: addr('Maison [TEST]', { tag: 'home' }) }, as1);
  const r = await ok('fiila_get_owned', { p_id: P1.id, p_owner: null }, as1);
  assert.equal(r.label, 'Maison [TEST]');
  assert.equal(r.tag, 'home');
  assert.equal(r.account, true);
  // la clé de gestion marche toujours, sans compte
  await ok('fiila_get_owned', { p_id: P1.id, p_owner: P1.owner_token });
});

await t('compte : un autre compte ou un visiteur anonyme sans clé n’y a pas accès', async () => {
  await ko('fiila_get_owned', { p_id: P1.id, p_owner: null }, 'not_found', as2);
  await ko('fiila_get_owned', { p_id: P1.id, p_owner: null }, 'not_found');
  await ko('fiila_update_place', { p_id: P1.id, p_owner: null, p: addr('Pirate') }, 'not_found', as2);
  await ko('fiila_delete_place', { p_id: P1.id, p_owner: null }, 'not_found', as2);
});

await t('coffre : les résumés incluent les fiches du compte, avec leur étiquette', async () => {
  const rows = await ok('fiila_owned_summaries', { p_items: [] }, as1);
  const mine = rows.find((x) => x.id === P1.id);
  assert.ok(mine && mine.tag === 'home' && mine.account === true);
  const other = await ok('fiila_owned_summaries', { p_items: [] }, as2);
  assert.equal(other.find((x) => x.id === P1.id), undefined);
});

await t('coffre : étiquette modifiable, valeurs inventées refusées', async () => {
  await ok('fiila_set_tag', { p_id: P1.id, p_owner: null, p_tag: 'work' }, as1);
  await ko('fiila_set_tag', { p_id: P1.id, p_owner: null, p_tag: 'bunker' }, 'invalid_tag', as1);
  await ko('fiila_create_place', { p: addr('X', { tag: 'bunker' }) }, 'invalid_tag', as1);
});

await t('rattachement : les fiches du téléphone passent au compte avec une clé valide seulement', async () => {
  P2 = await ok('fiila_create_place', { p: addr('Bureau anonyme [TEST]') });
  const R = await ok('fiila_create_request', { p: { requester_name: 'Moi', purpose: 'Test [TEST]' } });
  const bad = await ok('fiila_claim', { p_items: [{ type: 'place', id: P2.id, owner: 'faux-jeton-123' }] }, as2);
  assert.equal(bad.claimed, 0);
  const r = await ok('fiila_claim', { p_items: [{ type: 'place', id: P2.id, owner: P2.owner_token }, { type: 'request', id: R.id, owner: R.owner_token }] }, as1);
  assert.equal(r.claimed, 2);
  await ok('fiila_get_owned', { p_id: P2.id, p_owner: null }, as1);
  // déjà rattachée : un autre compte ne peut pas la reprendre, même avec la clé
  const again = await ok('fiila_claim', { p_items: [{ type: 'place', id: P2.id, owner: P2.owner_token }] }, as2);
  assert.equal(again.claimed, 0);
  await ko('fiila_claim', { p_items: [] }, 'auth_required');
});

await t('profil : nom, téléphone, photo ; téléphone invalide refusé ; anonyme refusé', async () => {
  await ko('fiila_me', {}, 'auth_required');
  const me = await ok('fiila_profile_save', { p: { display_name: 'Awa [TEST]', phone: '+221 77 000 00 00', avatar: jpeg.toString('base64') } }, as1);
  assert.equal(me.email, 'u1@test.invalid');
  assert.equal(me.display_name, 'Awa [TEST]');
  assert.match(me.avatar, /^data:image\/jpeg;base64,/);
  const kept = await ok('fiila_profile_save', { p: { display_name: 'Awa', phone: null } }, as1);
  assert.ok(kept.avatar, 'photo conservée si absente du formulaire');
  const gone = await ok('fiila_profile_save', { p: { display_name: 'Awa', avatar: '' } }, as1);
  assert.equal(gone.avatar, undefined);
  await ko('fiila_profile_save', { p: { phone: 'appelle-moi' } }, 'phone_invalid', as1);
});

let SHOP, O1, O2, C1;
await t('boutique : création, une seule par compte, nom obligatoire', async () => {
  await ko('fiila_order_create', { p_key: null, p: { customer: { name: 'X' }, items: [{ label: 'a', qty: 1, price: 1 }] } }, 'shop_required', as1);
  await ko('fiila_shop_save', { p_key: null, p: { name: '' } }, 'shop_name_required', as1);
  SHOP = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Test [TEST]', phone: '77 000 00 01' } }, as1)).shop;
  const again = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Test 2 [TEST]', ninea: '0000000 2G3' } }, as1)).shop;
  assert.equal(again.id, SHOP.id);
  const g = await ok('fiila_shop_get', { p_key: null,}, as1);
  assert.equal(g.shop.name, 'Boutique Test 2 [TEST]');
  assert.equal((await ok('fiila_shop_get', { p_key: null,}, as2)).shop, null);
});

await t('commande : numéro par boutique, total calculé par le serveur, demande d’adresse créée', async () => {
  O1 = await ok('fiila_order_create', { p_key: null, p: { customer: { name: 'Fatou [TEST]', phone: '+221 70 111 11 11' },
    items: [{ label: 'Robe wax', qty: 2, price: 12500 }, { label: 'Foulard', qty: 1, price: 3000 }], total: 1 } }, as1);
  assert.equal(O1.number, 1);
  assert.equal(O1.ref, '0001');
  assert.equal(O1.total, 28000);
  assert.equal(O1.address_state, 'pending');
  assert.equal(O1.pay_state, 'unpaid');
  assert.equal(O1.delivery_state, 'to_ship');
  assert.ok(O1.request_token && O1.share_token);
  C1 = O1.customer_id;
  O2 = await ok('fiila_order_create', { p_key: null, p: { customer: { name: 'Fatou D. [TEST]', phone: '70 111 11 11' }, items: [{ label: 'Sac', qty: 1, price: 5000 }] } }, as1);
  assert.equal(O2.number, 2);
  assert.equal(O2.customer_id, C1, 'même numéro = même client');
});

await t('commande : validations (articles, quantités, prix)', async () => {
  await ko('fiila_order_create', { p_key: null, p: { customer: { name: 'A' }, items: [] } }, 'items_required', as1);
  await ko('fiila_order_create', { p_key: null, p: { customer: { name: 'A' }, items: [{ label: '', qty: 1, price: 1 }] } }, 'item_label_required', as1);
  await ko('fiila_order_create', { p_key: null, p: { customer: { name: 'A' }, items: [{ label: 'a', qty: 0, price: 1 }] } }, 'invalid_qty', as1);
  await ko('fiila_order_create', { p_key: null, p: { customer: { name: 'A' }, items: [{ label: 'a', qty: 1, price: -5 }] } }, 'invalid_price', as1);
  await ko('fiila_order_create', { p_key: null, p: { customer: { name: 'A' }, items: [{ label: 'a', qty: 'x', price: 1 }] } }, 'invalid_number', as1);
  await ko('fiila_order_create', { p_key: null, p: { items: [{ label: 'a', qty: 1, price: 1 }] } }, 'customer_name_required', as1);
});

await t('isolation : un autre compte ne voit ni les commandes ni les clients', async () => {
  await ok('fiila_shop_save', { p_key: null, p: { name: 'Autre boutique [TEST]' } }, as2);
  await ko('fiila_order_get', { p_key: null, p_id: O1.id }, 'order_not_found', as2);
  await ko('fiila_customer_get', { p_key: null, p_id: C1 }, 'customer_not_found', as2);
  assert.equal((await ok('fiila_orders', { p_key: null, p_filter: null }, as2)).length, 0);
  assert.equal((await ok('fiila_customers', { p_key: null, p_query: null }, as2)).length, 0);
  await ko('fiila_order_create', { p_key: null, p: { customer_id: C1, items: [{ label: 'a', qty: 1, price: 1 }] } }, 'customer_not_found', as2);
  await ko('fiila_order_get', { p_key: null, p_id: O1.id }, 'shop_required');
});

await t('facture publique : contenu utile, sans téléphone ni identifiant interne', async () => {
  const r = await ok('fiila_order_public', { p_token: O1.share_token });
  assert.equal(r.state, 'ok');
  assert.equal(r.shop.name, 'Boutique Test 2 [TEST]');
  assert.equal(r.order.total, 28000);
  assert.equal(r.order.items.length, 2);
  assert.equal(r.order.request_token, O1.request_token);
  const s = JSON.stringify(r);
  for (const k of ['customer_phone', '70 111', '"id"', 'customer_id', 'share_token']) assert.ok(!s.includes(k), `fuite: ${k}`);
  assert.equal((await ok('fiila_order_public', { p_token: 'x'.repeat(22) })).state, 'not_found');
});

await t('demande d’adresse de la commande : le client répond, l’adresse arrive sur la commande et la fiche client', async () => {
  const pub = await ok('fiila_get_request_public', { p_token: O1.request_token });
  assert.equal(pub.state, 'pending');
  assert.equal(pub.shop, true);
  assert.match(pub.purpose, /0001/);
  const clientPlace = await ok('fiila_create_place', { p: addr('Chez Fatou [TEST]') });
  await ok('fiila_fulfill_request', { p_token: O1.request_token, p_place_id: clientPlace.id, p_place_owner: clientPlace.owner_token });
  const o = await ok('fiila_order_get', { p_key: null, p_id: O1.id }, as1);
  assert.equal(o.address_state, 'received');
  assert.equal(o.place.label, 'Chez Fatou [TEST]');
  assert.equal(o.request_token, undefined);
  const c = await ok('fiila_customer_get', { p_key: null, p_id: C1 }, as1);
  assert.equal(c.has_address, true);
  // la demande liée à une commande ne pollue pas « Mes demandes »
  const sums = await ok('fiila_owned_summaries', { p_items: [] }, as1);
  assert.ok(!sums.some((x) => x.type === 'request' && x.purpose && /commande N°/.test(x.purpose)));
});

await t('client connu : la commande suivante réutilise son adresse, sans nouvelle demande', async () => {
  const o3 = await ok('fiila_order_create', { p_key: null, p: { customer_id: C1, items: [{ label: 'Chaussures', qty: 1, price: 15000 }] } }, as1);
  assert.equal(o3.address_state, 'received');
  assert.equal(o3.request_token, undefined);
  assert.equal(o3.number, 3);
});

await t('livraison : lien livreur, suivi visible sur la facture, arrêt à la livraison', async () => {
  await ko('fiila_order_delivery', { p_key: null, p_id: O2.id }, 'not_fulfilled', as1); // O2 : adresse redemandée (O1 répondue)… O2 a sa propre demande
  const d = await ok('fiila_order_delivery', { p_key: null, p_id: O1.id }, as1);
  assert.ok(d.courier_token && d.watch_token);
  let pub = await ok('fiila_order_public', { p_token: O1.share_token });
  assert.equal(pub.order.delivery_state, 'courier_ready');
  assert.equal(pub.order.watch_token, d.watch_token);
  await ok('fiila_position', { p_token: d.courier_token, p_status: 'live', p_lat: 14.75, p_lng: -17.46, p_acc: 10 });
  pub = await ok('fiila_order_public', { p_token: O1.share_token });
  assert.equal(pub.order.delivery_state, 'on_the_way');
  const w = await ok('fiila_watch', { p_token: d.watch_token });
  assert.ok(w.tracker.pos);
  const done = await ok('fiila_order_set_status', { p_key: null, p_id: O1.id, p_status: 'delivered' }, as1);
  assert.equal(done.delivery_state, 'delivered');
  const t2 = await db.query('select lat, trail from fiila.trackers where watch_token = $1', [d.watch_token]);
  assert.equal(t2.rows[0].lat, null, 'position effacée à la livraison');
  pub = await ok('fiila_order_public', { p_token: O1.share_token });
  assert.equal(pub.order.watch_token, undefined);
});

await t('paiements : partiel puis complet, retrait d’un paiement manuel, méthode inventée refusée', async () => {
  let o = await ok('fiila_order_payment_add', { p_key: null, p_id: O1.id, p_amount: 10000, p_method: 'wave' }, as1);
  assert.equal(o.pay_state, 'partial');
  assert.equal(o.paid, 10000);
  o = await ok('fiila_order_payment_add', { p_key: null, p_id: O1.id, p_amount: 18000, p_method: 'cash' }, as1);
  assert.equal(o.pay_state, 'paid');
  await ko('fiila_order_payment_add', { p_key: null, p_id: O1.id, p_amount: 1, p_method: 'bitcoin' }, 'invalid_method', as1);
  await ko('fiila_order_payment_add', { p_key: null, p_id: O1.id, p_amount: 0, p_method: 'cash' }, 'invalid_price', as1);
  o = await ok('fiila_order_payment_delete', { p_key: null, p_id: O1.id, p_payment_id: o.payments[1].id }, as1);
  assert.equal(o.pay_state, 'partial');
  const unpaid = await ok('fiila_orders', { p_key: null, p_filter: 'unpaid' }, as1);
  assert.ok(unpaid.some((x) => x.id === O1.id));
  const pub = await ok('fiila_order_public', { p_token: O1.share_token });
  assert.equal(pub.order.paid, 10000);
});

await t('adresse retirée par le client : la commande le voit et peut redemander', async () => {
  // O2 : sa demande est encore en attente → refus de redemander
  await ko('fiila_order_request_address', { p_key: null, p_id: O2.id }, 'address_already', as1);
  await db.query(`update fiila.requests set expires_at = now() - interval '1 minute' where id = (select request_id from fiila.orders where id = $1)`, [O2.id]);
  let o = await ok('fiila_order_get', { p_key: null, p_id: O2.id }, as1);
  assert.equal(o.address_state, 'expired');
  o = await ok('fiila_order_request_address', { p_key: null, p_id: O2.id }, as1);
  assert.equal(o.address_state, 'pending');
  assert.ok(o.request_token);
});

await t('annulation : la facture publique n’affiche plus le détail', async () => {
  await ok('fiila_order_set_status', { p_key: null, p_id: O2.id, p_status: 'cancelled' }, as1);
  const pub = await ok('fiila_order_public', { p_token: (await ok('fiila_order_get', { p_key: null, p_id: O2.id }, as1)).share_token });
  assert.equal(pub.state, 'cancelled');
  assert.equal(pub.order, undefined);
  await ko('fiila_order_set_status', { p_key: null, p_id: O2.id, p_status: 'lost' }, 'invalid_status', as1);
});

await t('clients : recherche, modification, suppression (les commandes restent)', async () => {
  const found = await ok('fiila_customers', { p_key: null, p_query: 'fatou' }, as1);
  assert.equal(found.length, 1);
  assert.equal((await ok('fiila_customers', { p_key: null, p_query: '70 111' }, as1)).length, 1);
  const c = await ok('fiila_customer_save', { p_key: null, p: { id: C1, name: 'Fatou Diop [TEST]', phone: '+221 70 111 11 11' } }, as1);
  assert.equal(c.name, 'Fatou Diop [TEST]');
  await ok('fiila_customer_delete', { p_key: null, p_id: C1 }, as1);
  const o = await ok('fiila_order_get', { p_key: null, p_id: O1.id }, as1);
  assert.equal(o.customer_name, 'Fatou [TEST]', 'le nom reste recopié sur la commande');
});

await t('rôles : authenticated ne lit pas les tables du schéma privé', async () => {
  await assert.rejects(db.transaction(async (tx) => { await tx.exec('set local role authenticated'); await tx.query('select * from fiila.orders'); }));
  await assert.rejects(db.transaction(async (tx) => { await tx.exec('set local role authenticated'); await tx.query('select * from fiila.profiles'); }));
});

await t('mesure : nouveaux événements acceptés, variantes inventées refusées', async () => {
  for (const [e, v] of [['account_created', 'account'], ['shop_created', 'shop'], ['order_created', 'known_address'], ['invoice_opened', 'order'],
    ['payment_recorded', 'wave'], ['delivery_started', 'order']]) await ok('fiila_track', { p_event: e, p_variant: v });
  await ko('fiila_track', { p_event: 'order_created', p_variant: '28000' }, 'invalid_event');
});

await t('suppression du compte : fiches, boutique, clients, commandes et profil effacés ; fiches anonymes intactes', async () => {
  const anon = await ok('fiila_create_place', { p: addr('Anonyme [TEST]') });
  await ok('fiila_delete_account', {}, as1);
  for (const [tbl, col] of [['places', 'user_id'], ['requests', 'user_id'], ['shops', 'user_id'], ['profiles', 'user_id']]) {
    const r = await db.query(`select count(*)::int n from fiila.${tbl} where ${col} = $1`, [U1]);
    assert.equal(r.rows[0].n, 0, tbl);
  }
  assert.equal((await db.query('select count(*)::int n from fiila.orders o join fiila.shops s on s.id = o.shop_id where s.user_id = $1', [U1])).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from auth.users where id = $1', [U1])).rows[0].n, 0);
  await ok('fiila_get_owned', { p_id: anon.id, p_owner: anon.owner_token });
});

// ------------------------------------------------------------------ boutique sans compte, articles, notes
let K, SK, PR1, PR2, OK1;
await t('boutique sans compte : créée avec une clé, gérée avec la clé seule', async () => {
  await ko('fiila_order_create', { p_key: null, p: { customer: { name: 'X' }, items: [{ label: 'a', qty: 1, price: 1 }] } }, 'shop_required');
  const r = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique sans compte [TEST]' } });
  K = r.key; SK = r.shop.id;
  assert.ok(K && K.length >= 40);
  const g = await ok('fiila_shop_get', { p_key: K });
  assert.equal(g.shop.name, 'Boutique sans compte [TEST]');
  assert.equal(g.shop.account, false);
  assert.equal((await ok('fiila_shop_get', { p_key: 'mauvaise-cle-123' })).shop, null);
  const again = await ok('fiila_shop_save', { p_key: K, p: { name: 'Boutique sans compte 2 [TEST]' } });
  assert.equal(again.shop.id, SK); assert.equal(again.key, undefined, 'la clé n’est donnée qu’une fois');
});

await t('articles : création avec photo, prix, liste ; mauvaise clé refusée', async () => {
  PR1 = await ok('fiila_product_save', { p_key: K, p: { name: 'Robe wax [TEST]', price: 12500, photo: jpeg.toString('base64') } });
  assert.match(PR1.photo, /^data:image\/jpeg;base64,/);
  PR2 = await ok('fiila_product_save', { p_key: K, p: { name: 'Foulard [TEST]', price: 3000 } });
  const list = await ok('fiila_products', { p_key: K, p_all: false });
  assert.equal(list.length, 2);
  await ko('fiila_products', { p_key: 'mauvaise-cle-123', p_all: false }, 'shop_required');
  await ko('fiila_product_save', { p_key: K, p: { name: '', price: 1 } }, 'item_label_required');
  await ko('fiila_product_save', { p_key: K, p: { name: 'x', price: -1 } }, 'invalid_price');
  const off = await ok('fiila_product_save', { p_key: K, p: { id: PR2.id, name: 'Foulard [TEST]', price: 3000, active: false } });
  assert.equal(off.active, false);
  assert.equal((await ok('fiila_products', { p_key: K, p_all: false })).length, 1);
  assert.equal((await ok('fiila_products', { p_key: K, p_all: true })).length, 2);
});

await t('commande depuis le catalogue : la facture montre la photo de l’article', async () => {
  OK1 = await ok('fiila_order_create', { p_key: K, p: { customer: { name: 'Awa [TEST]' }, items: [{ product_id: PR1.id, label: 'Robe wax [TEST]', qty: 1, price: 12500 }, { label: 'Retouche', qty: 1, price: 1000 }] } });
  assert.equal(OK1.total, 13500);
  const pub = await ok('fiila_order_public', { p_token: OK1.share_token });
  assert.match(pub.order.items[0].photo, /^data:image\/jpeg/);
  assert.equal(pub.order.items[1].photo, undefined);
  assert.equal(pub.order.can_review, false);
  await ko('fiila_order_create', { p_key: K, p: { customer: { name: 'A' }, items: [{ product_id: O1.id, label: 'x', qty: 1, price: 1 }] } }, 'product_not_found');
});

await t('notes : seulement après livraison, seulement les articles achetés, modifiables', async () => {
  await ko('fiila_review', { p_token: OK1.share_token, p_product_id: PR1.id, p_rating: 5, p_comment: null }, 'not_delivered');
  await ok('fiila_order_set_status', { p_key: K, p_id: OK1.id, p_status: 'delivered' });
  await ko('fiila_review', { p_token: OK1.share_token, p_product_id: PR2.id, p_rating: 5, p_comment: null }, 'product_not_found');
  await ko('fiila_review', { p_token: OK1.share_token, p_product_id: PR1.id, p_rating: 9, p_comment: null }, 'invalid_rating');
  await ok('fiila_review', { p_token: OK1.share_token, p_product_id: PR1.id, p_rating: 3, p_comment: 'Bien [TEST]' });
  await ok('fiila_review', { p_token: OK1.share_token, p_product_id: PR1.id, p_rating: 5, p_comment: null });
  const pub = await ok('fiila_order_public', { p_token: OK1.share_token });
  assert.equal(pub.order.items[0].my_rating, 5);
  assert.equal(pub.order.can_review, true);
  const list = await ok('fiila_products', { p_key: K, p_all: true });
  const p1 = list.find((x) => x.id === PR1.id);
  assert.equal(Number(p1.rating), 5); assert.equal(p1.reviews, 1);
});

await t('compte proposé après coup : la boutique du téléphone rejoint le compte', async () => {
  const U3 = await createUser(db, 'u3@test.invalid');
  await ko('fiila_shop_claim', { p_key: K }, 'auth_required');
  const c = await ok('fiila_shop_claim', { p_key: K }, { uid: U3 });
  assert.equal(c.claimed, true);
  const g = await ok('fiila_shop_get', { p_key: null }, { uid: U3 });
  assert.equal(g.shop.id, SK); assert.equal(g.shop.account, true);
  await ok('fiila_shop_get', { p_key: K }); // la clé du téléphone marche toujours
  const other = await ok('fiila_shop_claim', { p_key: K }, as2);
  assert.equal(other.claimed, false);
});

for (const r of results) console.log(r.join(' | '));
console.log(`\n${passed}/${results.length} tests SQL comptes/boutique réussis`);
process.exit(passed === results.length ? 0 : 1);
