// Tests SQL : catégorie, tailles ou pointures, couleurs et stock des articles ; commande de vitrine avec taille et couleur.
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
let SK, SLUG, ROBE, BASK, SAC;
const cust = { name: 'Awa [TEST]', phone: '70 000 00 61' };

await t('article : catégorie, tailles (sans doublon), couleurs, stock ; valeurs inventées refusées', async () => {
  SK = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Attributs [TEST]' } })).key;
  ROBE = await ok('fiila_product_save', { p_key: SK, p: { name: 'Robe [TEST]', price: 15000, category: 'mode', sizes: ['S', 'M', 'M', ' L '], colors: ['Rouge', 'Bleu'], stock: 3 } });
  assert.equal(ROBE.category, 'mode'); assert.deepEqual(ROBE.sizes, ['S', 'M', 'L']); assert.deepEqual(ROBE.colors, ['Rouge', 'Bleu']); assert.equal(ROBE.stock, 3);
  BASK = await ok('fiila_product_save', { p_key: SK, p: { name: 'Baskets [TEST]', price: 25000, category: 'chaussures', sizes: ['41', '42', '43'] } });
  SAC = await ok('fiila_product_save', { p_key: SK, p: { name: 'Sac [TEST]', price: 5000 } });
  assert.equal(SAC.sizes, undefined); assert.equal(SAC.stock, undefined);
  await ko('fiila_product_save', { p_key: SK, p: { name: 'X', price: 1, category: 'armes' } }, 'invalid_category');
  await ko('fiila_product_save', { p_key: SK, p: { name: 'X', price: 1, stock: -2 } }, 'invalid_stock');
  await ko('fiila_product_save', { p_key: SK, p: { name: 'X', price: 1, sizes: Array.from({ length: 21 }, (_, i) => 'T' + i) } }, 'too_many');
  // Modification sans ces champs : ils restent ; stock null = non suivi.
  const r = await ok('fiila_product_save', { p_key: SK, p: { id: ROBE.id, name: 'Robe wax [TEST]', price: 15000 } });
  assert.deepEqual(r.sizes, ['S', 'M', 'L']); assert.equal(r.stock, 3);
  const r2 = await ok('fiila_product_save', { p_key: SK, p: { id: SAC.id, name: 'Sac [TEST]', price: 5000, stock: null, sizes: [] } });
  assert.equal(r2.stock, undefined);
});

await t('vitrine : attributs visibles ; commande avec taille et couleur obligatoires, libellé de la ligne complet', async () => {
  SLUG = (await ok('fiila_shop_vitrine', { p_key: SK, p: { public: true } })).slug;
  const v = await ok('fiila_vitrine', { p_slug: SLUG });
  const robe = v.products.find((p) => p.id === ROBE.id);
  assert.deepEqual(robe.sizes, ['S', 'M', 'L']); assert.equal(robe.category, 'mode'); assert.equal(robe.stock, 3);
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: ROBE.id, qty: 1 }] } }, 'size_required');
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: ROBE.id, qty: 1, size: 'XXL', color: 'Rouge' }] } }, 'size_required');
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: ROBE.id, qty: 1, size: 'M' }] } }, 'color_required');
  const o = await ok('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: ROBE.id, qty: 2, size: 'M', color: 'Rouge' }, { product_id: BASK.id, qty: 1, size: '43' }, { product_id: SAC.id, qty: 1, size: 'L' }] } });
  const pub = await ok('fiila_order_public', { p_token: o.invoice });
  assert.deepEqual(pub.order.items.map((i) => i.label), ['Robe wax [TEST] (M · Rouge)', 'Baskets [TEST] (43)', 'Sac [TEST]']);
});

await t('stock : décompté à la commande, jamais en dessous de zéro ; épuisé = commande refusée', async () => {
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).products.find((p) => p.id === ROBE.id).stock, 1);
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: ROBE.id, qty: 2, size: 'S', color: 'Bleu' }] } }, 'out_of_stock');
  await ok('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: ROBE.id, qty: 1, size: 'S', color: 'Bleu' }] } });
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).products.find((p) => p.id === ROBE.id).stock, 0);
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: ROBE.id, qty: 1, size: 'S', color: 'Bleu' }] } }, 'out_of_stock');
  // Une commande refusée ne décompte rien (tout ou rien).
  await ko('fiila_vitrine_order', { p_slug: SLUG, p: { customer: cust, items: [{ product_id: BASK.id, qty: 1, size: '42' }, { product_id: ROBE.id, qty: 1, size: 'S', color: 'Bleu' }] } }, 'out_of_stock');
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL attributs d’articles réussis`);
process.exit(passed === results.length ? 0 : 1);
