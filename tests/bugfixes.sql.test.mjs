// Tests SQL : correctifs de la revue de bugs du 19/10/2026 (migration 20261019200000_fiila_bugfixes).
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
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const addr = (label) => ({ kind: 'address', label, entry: { lat: 14.7, lng: -17.4 }, vehicle_ok: true, instruction: 'Porte [TEST]' });
// Faux webm (signature EBML) assez long pour passer le contrôle de taille.
const voice = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400)]).toString('base64');

let SK, SLUG, P1;
await t('vitrine : l’adresse donnée pour une commande en ligne ne remplace jamais celle d’un client connu', async () => {
  SK = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Correctifs [TEST]', phone: '77 100 00 21' } })).key;
  SLUG = (await ok('fiila_shop_vitrine', { p_key: SK, p: { public: true } })).slug;
  P1 = await ok('fiila_product_save', { p_key: SK, p: { name: 'Sac [TEST]', price: 2000 } });
  const real = await ok('fiila_create_place', { p: addr('Chez Fatou [TEST]') });
  const o1 = await ok('fiila_order_create', { p_key: SK, p: { customer: { name: 'Fatou [TEST]', phone: '70 000 00 31' }, items: [{ label: 'Sac', qty: 1, price: 1000 }] } });
  await ok('fiila_fulfill_request', { p_token: o1.request_token, p_place_id: real.id, p_place_owner: real.owner_token });
  // Quelqu'un d'autre commande sur la vitrine avec le numéro de Fatou, puis donne sa propre adresse.
  const o2 = await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: P1.id, qty: 1 }], customer: { name: 'Autre [TEST]', phone: '70 000 00 31' } } });
  const pub = await ok('fiila_order_public', { p_token: o2.invoice });
  const other = await ok('fiila_create_place', { p: addr('Ailleurs [TEST]') });
  await ok('fiila_fulfill_request', { p_token: pub.order.request_token, p_place_id: other.id, p_place_owner: other.owner_token });
  await ok('fiila_order_public', { p_token: o2.invoice });
  const c = await one(`select place_id from fiila.customers where name = 'Fatou [TEST]'`);
  assert.equal(c.place_id, real.id, 'l’adresse de Fatou reste la sienne');
  const o2row = await one(`select place_id from fiila.orders where share_token = $1`, [o2.invoice]);
  assert.equal(o2row.place_id, other.id, 'la commande en ligne garde l’adresse donnée pour elle');
  // Commande de la boutique : l'adresse reçue est toujours retenue pour la suite (comportement inchangé).
  const o3 = await ok('fiila_order_create', { p_key: SK, p: { customer: { name: 'Binta [TEST]', phone: '70 000 00 32' }, items: [{ label: 'Sac', qty: 1, price: 1000 }] } });
  const b = await ok('fiila_create_place', { p: addr('Chez Binta [TEST]') });
  await ok('fiila_fulfill_request', { p_token: o3.request_token, p_place_id: b.id, p_place_owner: b.owner_token });
  await ok('fiila_order_get', { p_key: SK, p_id: o3.id });
  assert.equal((await one(`select place_id from fiila.customers where name = 'Binta [TEST]'`)).place_id, b.id);
});

await t('commande sans « items » : refusée (vitrine et boutique), aucune commande vide créée', async () => {
  const before = (await one(`select count(*)::int n from fiila.orders`)).n;
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: { name: 'X [TEST]', phone: '70 000 00 33' } } }, 'items_required');
  await ko('fiila_order_create', { p_key: SK, p: { customer: { name: 'X [TEST]', phone: '70 000 00 33' } } }, 'items_required');
  assert.equal((await one(`select count(*)::int n from fiila.orders`)).n, before);
});

await t('repère vocal : le propriétaire l’écoute même lien coupé ; la demande et la boutique l’écoutent ; un inconnu non', async () => {
  const P = await ok('fiila_create_place', { p: addr('Avec vocal [TEST]') });
  await ok('fiila_voice_set', { p_id: P.id, p_owner: P.owner_token, p_voice: voice, p_secs: 7 });
  const mine = await ok('fiila_voice_private', { p_kind: 'place', p_id: P.id, p_key: P.owner_token });
  assert.equal(mine.state, 'ok'); assert.equal(mine.secs, 7); assert.match(mine.voice, /^data:audio\/webm;base64,/);
  await ko('fiila_voice_private', { p_kind: 'place', p_id: P.id, p_key: 'pas-la-cle' }, 'not_found');
  await ko('fiila_voice_private', { p_kind: 'autre', p_id: P.id, p_key: P.owner_token }, 'invalid_payload');
  // Demande d'adresse : le demandeur écoute la réponse.
  const R = await ok('fiila_create_request', { p: { requester_name: 'Boutique [TEST]', purpose: 'Livraison [TEST]' } });
  await ok('fiila_fulfill_request', { p_token: R.share_token, p_place_id: P.id, p_place_owner: P.owner_token });
  assert.equal((await ok('fiila_voice_private', { p_kind: 'request', p_id: R.id, p_key: R.owner_token })).state, 'ok');
  await ko('fiila_voice_private', { p_kind: 'request', p_id: R.id, p_key: 'pas-la-cle' }, 'not_found');
  // Commande : la boutique écoute l'adresse de sa cliente.
  const o = await ok('fiila_order_create', { p_key: SK, p: { customer: { name: 'Coumba [TEST]', phone: '70 000 00 34' }, items: [{ label: 'Sac', qty: 1, price: 1000 }] } });
  await ok('fiila_fulfill_request', { p_token: o.request_token, p_place_id: P.id, p_place_owner: P.owner_token });
  assert.equal((await ok('fiila_voice_private', { p_kind: 'order', p_id: o.id, p_key: SK })).state, 'ok');
  await ko('fiila_voice_private', { p_kind: 'order', p_id: o.id, p_key: 'pas-la-cle' });
  // Lien coupé : le propriétaire écoute encore, les autres non.
  await ok('fiila_revoke_place', { p_id: P.id, p_owner: P.owner_token });
  assert.equal((await ok('fiila_voice_private', { p_kind: 'place', p_id: P.id, p_key: P.owner_token })).state, 'ok');
  assert.equal((await ok('fiila_voice_private', { p_kind: 'request', p_id: R.id, p_key: R.owner_token })).state, 'not_found');
  assert.equal((await ok('fiila_voice_private', { p_kind: 'order', p_id: o.id, p_key: SK })).state, 'not_found');
});

await t('parrainage par numéro : la boutique qui porte le numéro passe avant une fiche anonyme créée avant elle', async () => {
  await ok('fiila_referral_card_save', { p_key: null, p: { name: 'Squatteur [TEST]', phone: '77 100 00 41' } });
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Vraie boutique [TEST]', phone: '77 100 00 41' } })).key;
  const k2 = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Filleule [TEST]' } })).key;
  await ok('fiila_attribute', { p_kind: 'shop', p_id: null, p_key: k2, p: { phone: '771000041' } });
  const me = (await ok('fiila_referral_me', { p_for: 'shop', p_key: k })).referrer;
  assert.equal(me.joined, 1, 'l’arrivée revient à la boutique');
});

await t('compte : après « Supprimer mon code », la fiche n’est plus recréée d’office ; la recréer reste possible', async () => {
  const uid = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'optout@example.test') returning id`)).id;
  await db.query(`insert into fiila.profiles (user_id, display_name, phone) values ($1, 'Ndeye Fall', '77 555 00 01')`, [uid]);
  const me = (await ok('fiila_referral_me', { p_for: 'person', p_key: null }, { uid })).referrer;
  assert.equal(me.name, 'Ndeye Fall');
  await ok('fiila_referral_card_delete', { p_key: null }, { uid });
  assert.equal((await ok('fiila_referral_me', { p_for: 'person', p_key: null }, { uid })).referrer, null);
  const k = (await ok('fiila_courier_register', { p: { name: 'Livreur [TEST]' } })).key;
  await ok('fiila_attribute', { p_kind: 'courier', p_id: null, p_key: k, p: { phone: '775550001' } });
  assert.equal(await one(`select 1 x from fiila.referrers where user_id = $1`, [uid]), undefined, 'son numéro tapé ne recrée pas la fiche');
  const again = await ok('fiila_referral_card_save', { p_key: null, p: { name: 'Ndeye F.' } }, { uid });
  assert.equal(again.referrer.name, 'Ndeye F.');
  assert.equal((await ok('fiila_referral_me', { p_for: 'person', p_key: null }, { uid })).referrer.name, 'Ndeye F.');
});

await t('vitrine : photos comptées à part des lectures ; jusqu’à 200 articles', async () => {
  for (let i = 0; i < 65; i++) await db.query(`insert into fiila.products (shop_id, name, price) select shop_id, 'Art ' || $1 || ' [TEST]', 100 from fiila.products where id = $2`, [i, P1.id]);
  const v = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.ok(v.products.length > 60, `${v.products.length} articles`);
  await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: P1.id });
  const n = (await one(`select count(*)::int n from fiila.rate_events where action = 'vitrine_photo'`)).n;
  assert.ok(n >= 1);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL correctifs réussis`);
process.exit(passed === results.length ? 0 : 1);
