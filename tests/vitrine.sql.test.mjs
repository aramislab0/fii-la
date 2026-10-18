// Tests SQL : vitrine publique de la boutique (ouverture, lecture, photos, commande en ligne, garde-fous).
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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
let SK, SLUG, P1, P2, HIDDEN;

await t('vitrine fermée par défaut ; ouverture : identifiant lisible tiré du nom, sans accents', async () => {
  SK = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Ndèye Ébène [TEST]', phone: '77 100 00 01' } })).key;
  const r0 = await ok('fiila_shop_vitrine', { p_key: SK, p: null });
  assert.equal(r0.public, false); assert.equal(r0.slug, undefined);
  const r = await ok('fiila_shop_vitrine', { p_key: SK, p: { public: true, about: 'Robes wax et foulards, livrés à Dakar.' } });
  SLUG = r.slug;
  assert.equal(SLUG, 'boutique-ndeye-ebene-test'); assert.equal(r.public, true);
  const k2 = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Ndèye Ébène [TEST]' } })).key;
  const r2 = await ok('fiila_shop_vitrine', { p_key: k2, p: { public: true } });
  assert.match(r2.slug, /^boutique-ndeye-ebene-test-[0-9a-f]{4}$/, 'homonyme : identifiant distinct');
  await ko('fiila_shop_vitrine', { p_key: 'pas-la-cle', p: { public: true } }, 'shop_required');
});

await t('lecture publique : articles visibles seulement, sans photo ni numéro de client ; fermée = « closed »', async () => {
  P1 = await ok('fiila_product_save', { p_key: SK, p: { name: 'Robe wax [TEST]', price: 15000, photo } });
  P2 = await ok('fiila_product_save', { p_key: SK, p: { name: 'Foulard [TEST]', price: 3000 } });
  HIDDEN = await ok('fiila_product_save', { p_key: SK, p: { name: 'Caché [TEST]', price: 1 } });
  await ok('fiila_product_save', { p_key: SK, p: { id: HIDDEN.id, name: 'Caché [TEST]', price: 1, active: false } });
  const v = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.equal(v.state, 'ok'); assert.equal(v.shop.name, 'Boutique Ndèye Ébène [TEST]');
  assert.deepEqual(v.products.map((x) => x.name).sort(), ['Foulard [TEST]', 'Robe wax [TEST]']);
  assert.equal(v.products.find((x) => x.name === 'Robe wax [TEST]').has_photo, true);
  assert.ok(!JSON.stringify(v).includes('base64'), 'pas de photo dans la liste');
  const ph = await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: P1.id });
  assert.match(ph.photo, /^data:image\/png;base64,/);
  assert.equal((await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: HIDDEN.id })).photo, undefined);
  assert.equal((await ok('fiila_vitrine', { p_slug: 'nexiste-pas' })).state, 'not_found');
  assert.equal((await ok('fiila_vitrine', { p_slug: "x'; drop table" })).state, 'not_found');
});

let ORD;
await t('commande en ligne : prix pris dans la base, demande d’adresse créée, commande visible par la boutique', async () => {
  ORD = await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: P1.id, qty: 2, price: 1 }, { product_id: P2.id, qty: 1 }],
    customer: { name: 'Awa [TEST]', phone: '70 000 00 01' }, note: 'Taille M' } });
  assert.equal(ORD.total, 33000, 'le prix envoyé par le client est ignoré');
  assert.equal(ORD.shop.name, 'Boutique Ndèye Ébène [TEST]');
  const pub = await ok('fiila_order_public', { p_token: ORD.invoice });
  assert.equal(pub.state, 'ok'); assert.equal(pub.order.address_state, 'pending'); assert.ok(pub.order.request_token);
  const list = await ok('fiila_orders', { p_key: SK, p_filter: 'open' });
  assert.equal(list[0].customer_name, 'Awa [TEST]');
  const row = (await db.query(`select source from fiila.orders where share_token = $1`, [ORD.invoice])).rows[0];
  assert.equal(row.source, 'vitrine');
});

await t('garde-fous : article masqué ou d’une autre boutique, quantité, numéro obligatoire, vitrine fermée', async () => {
  const base = { customer: { name: 'X [TEST]', phone: '70 000 00 02' } };
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { ...base, items: [{ product_id: HIDDEN.id, qty: 1 }] } }, 'product_not_found');
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { ...base, items: [{ product_id: P1.id, qty: 500 }] } }, 'invalid_qty');
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: { name: 'X' }, items: [{ product_id: P1.id, qty: 1 }] } }, 'phone_required');
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { ...base, items: [] } }, 'items_required');
  await ok('fiila_shop_vitrine', { p_key: SK, p: { public: false } });
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).state, 'closed');
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { ...base, items: [{ product_id: P1.id, qty: 1 }] } }, 'not_found');
  assert.equal((await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: P1.id })).photo, undefined);
  await ok('fiila_shop_vitrine', { p_key: SK, p: { public: true } });
});

await t('un numéro tapé ne suffit pas à livrer chez quelqu’un : l’adresse connue n’est jamais reprise', async () => {
  // Client connu de la boutique avec une adresse enregistrée
  const P = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez Fatou [TEST]', entry: { lat: 14.7, lng: -17.4 }, vehicle_ok: true, instruction: 'Porte [TEST]' } });
  const o1 = await ok('fiila_order_create', { p_key: SK, p: { customer: { name: 'Fatou [TEST]', phone: '70 000 00 09' }, items: [{ label: 'Sac', qty: 1, price: 1000 }] } });
  await ok('fiila_fulfill_request', { p_token: o1.request_token, p_place_id: P.id, p_place_owner: P.owner_token });
  const o2 = await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: P2.id, qty: 1 }], customer: { name: 'Quelqu’un [TEST]', phone: '+221 70 000 00 09' } } });
  const pub = await ok('fiila_order_public', { p_token: o2.invoice });
  assert.equal(pub.order.address_state, 'pending');
  const cust = (await db.query(`select name from fiila.customers where phone like '%00 09%' or phone like '%0000009%'`)).rows;
  assert.equal(cust[0].name, 'Fatou [TEST]', 'le nom enregistré par la boutique n’est pas écrasé');
});

await t('parrainage : une boutique ouverte depuis la vitrine d’une autre est comptée pour celle-ci', async () => {
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Nouvelle [TEST]' } })).key;
  await ok('fiila_attribute', { p_kind: 'shop', p_id: null, p_key: k, p: { src: 'vitrine', token: SLUG } });
  const me = (await ok('fiila_referral_me', { p_for: 'shop', p_key: SK })).referrer;
  assert.equal(me.recent[0].label, 'Nouvelle [TEST]');
});

await t('modèles et personnalisation : thème, couleur, couverture ; valeurs inventées refusées', async () => {
  const r0 = await ok('fiila_shop_vitrine', { p_key: SK, p: null });
  assert.equal(r0.theme, 'galerie'); assert.equal(r0.accent, 'foret');
  const r = await ok('fiila_shop_vitrine', { p_key: SK, p: { theme: 'magazine', accent: 'prune', cover: photo } });
  assert.equal(r.theme, 'magazine'); assert.equal(r.accent, 'prune'); assert.match(r.cover, /^data:image\/png;base64,/);
  const v = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.equal(v.shop.theme, 'magazine'); assert.equal(v.shop.accent, 'prune'); assert.equal(v.shop.has_cover, true);
  assert.ok(!JSON.stringify(v).includes('base64'), 'couverture chargée à part');
  assert.match((await ok('fiila_vitrine_photo', { p_slug: SLUG, p_id: 'cover' })).photo, /^data:image\/png/);
  await ko('fiila_shop_vitrine', { p_key: SK, p: { theme: '<script>' } }, 'invalid_theme');
  await ko('fiila_shop_vitrine', { p_key: SK, p: { accent: '#ff0000' } }, 'invalid_theme');
  await ko('fiila_shop_vitrine', { p_key: SK, p: { cover: Buffer.from('pas une image'.repeat(20)).toString('base64') } }, 'photo_invalid');
  const r2 = await ok('fiila_shop_vitrine', { p_key: SK, p: { cover: '' } });
  assert.equal(r2.cover, undefined);
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).shop.has_cover, undefined);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL vitrine réussis`);
process.exit(passed === results.length ? 0 : 1);
