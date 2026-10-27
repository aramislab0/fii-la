// Tests SQL : Fii Édition, lot V1 (fondateur, 27/10/2026 19:50 ; migration 20261028100000). Prix barré (rubrique Promos),
// tailles épuisées (barrées et refusées à la commande), conditions de la boutique en liste fermée (livraison, paiement,
// échange), nombre d'articles de « Complétez le look » réglé au back-office, carte « Fiche article », mesures anonymes.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const F = { uid: (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'f@example.test') returning id`)).id };
await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Fondateur')`, [F.uid]);
await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [F.uid]);

const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Édition V1 [TEST]', business_type: 'enfants' } });
const slug = (await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } })).slug;
const save = (p) => ok('fiila_product_save', { p_key: S.key, p });
const vitrine = () => ok('fiila_vitrine', { p_slug: slug });
const order = (items) => rpc(db, 'fiila_vitrine_order', { p_slug: slug, p: { items, customer: { name: 'Cliente test', phone: '770000001' } } });

await t('prix barré : enregistré s’il dépasse le prix, retiré par null ou 0, refusé s’il est plus bas ou égal', async () => {
  const p = await save({ name: 'Robe promo', price: 9000, price_was: 12000 });
  assert.equal(p.price_was, 12000);
  await ko('fiila_product_save', { p_key: S.key, p: { id: p.id, name: 'Robe promo', price: 9000, price_was: 9000 } }, 'invalid_price_was');
  await ko('fiila_product_save', { p_key: S.key, p: { id: p.id, name: 'Robe promo', price: 9000, price_was: 'abc' } }, 'invalid_price_was');
  await ko('fiila_product_save', { p_key: S.key, p: { name: 'Neuf', price: 9000, price_was: 5000 } }, 'invalid_price_was');
  let r = await save({ id: p.id, name: 'Robe promo', price: 8000 });
  assert.equal(r.price_was, 12000, 'absent = inchangé');
  r = await save({ id: p.id, name: 'Robe promo', price: 8000, price_was: 0 });
  assert.equal(r.price_was, undefined, '0 = retiré');
  r = await save({ id: p.id, name: 'Robe promo', price: 8000, price_was: 11000 });
  r = await save({ id: p.id, name: 'Robe promo', price: 15000 });
  assert.equal(r.price_was, undefined, 'prix monté au-dessus du prix barré : promotion effacée, sans erreur');
  r = await save({ id: p.id, name: 'Robe promo', price: 10000, price_was: 14000 });
  const v = (await vitrine()).products.find((x) => x.id === p.id);
  assert.equal(v.price_was, 14000, 'visible sur le site');
});

let SZ;
await t('tailles épuisées : seulement parmi les tailles, visibles sur le site, effacées avec la taille', async () => {
  SZ = await save({ name: 'Baskets', price: 15000, sizes: ['26', '27', '28'], sizes_out: ['28', '40'] });
  assert.deepEqual(SZ.sizes_out, ['28'], 'une taille hors liste est ignorée');
  const v = (await vitrine()).products.find((x) => x.id === SZ.id);
  assert.deepEqual(v.sizes_out, ['28']);
  let r = await save({ id: SZ.id, name: 'Baskets', price: 15000, sizes: ['26', '27'] });
  assert.equal(r.sizes_out, undefined, 'taille retirée = plus épuisée');
  r = await save({ id: SZ.id, name: 'Baskets', price: 15000, sizes: ['26', '27', '28'], sizes_out: ['27'] });
  assert.deepEqual(r.sizes_out, ['27']);
  r = await save({ id: SZ.id, name: 'Baskets', price: 15000 });
  assert.deepEqual(r.sizes_out, ['27'], 'absent = inchangé');
});

await t('commande : une taille épuisée est refusée par le serveur, une autre passe', async () => {
  const bad = await order([{ product_id: SZ.id, qty: 1, size: '27' }]);
  assert.notEqual(bad.status, 200); assert.match(bad.body.message, /size_sold_out/);
  const good = await order([{ product_id: SZ.id, qty: 1, size: '26' }]);
  assert.equal(good.status, 200, JSON.stringify(good.body));
});

await t('conditions de la boutique : liste fermée, doublons retirés, relues par la boutique et montrées sur le site', async () => {
  const r = await ok('fiila_shop_vitrine', { p_key: S.key, p: { policies: { delivery: '24h', pay: ['livraison', 'wave', 'wave'], exchange: '3j' } } });
  assert.deepEqual(r.policies, { delivery: '24h', pay: ['livraison', 'wave'], exchange: '3j' });
  assert.deepEqual((await vitrine()).shop.policies, r.policies);
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { policies: { delivery: 'demain' } } }, 'invalid_payload');
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { policies: { pay: ['carte'] } } }, 'invalid_payload');
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { policies: { exchange: '30j' } } }, 'invalid_payload');
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { policies: 'tout' } }, 'invalid_payload');
  const off = await ok('fiila_shop_vitrine', { p_key: S.key, p: { about: 'Sans changer les conditions' } });
  assert.deepEqual(off.policies, r.policies, 'absent = inchangé');
  await ok('fiila_shop_vitrine', { p_key: S.key, p: { policies: {} } });
  assert.equal((await vitrine()).shop.policies, undefined, 'vidées : rien sur le site');
  await ok('fiila_shop_vitrine', { p_key: S.key, p: { policies: { delivery: 'jour', pay: ['om'], exchange: 'non' } } });
});

await t('« Complétez le look » : 3 par défaut, réglé de 0 à 6 au back-office (journalisé), hors bornes refusé', async () => {
  assert.equal((await vitrine()).shop.look, 3);
  assert.equal((await ok('fiila_bo_settings', {}, { uid: F.uid })).site_look, 3);
  await ok('fiila_bo_setting_set', { p_key: 'site_look', p_value: 0 }, { uid: F.uid });
  assert.equal((await vitrine()).shop.look, 0);
  await ko('fiila_bo_setting_set', { p_key: 'site_look', p_value: 9 }, null, { uid: F.uid });
  await ok('fiila_bo_setting_set', { p_key: 'site_look', p_value: 3 }, { uid: F.uid });
  assert.ok(Number((await one(`select count(*) n from fiila.admin_log where action = 'setting' and target_id = 'site_look'`)).n) >= 2, 'journal');
});

await t('back-office : carte « Fiche article » réservée à l’équipe', async () => {
  const shopId = (await one(`select id from fiila.shops where slug = $1`, [slug])).id;
  await ko('fiila_bo_shop_sheet', { p_shop: shopId });
  const r = await ok('fiila_bo_shop_sheet', { p_shop: shopId }, { uid: F.uid });
  assert.deepEqual(r.policies, { delivery: 'jour', pay: ['om'], exchange: 'non' });
  assert.equal(r.promos, 1); assert.equal(r.sold_out_sizes, 1); assert.equal(r.with_sizes, 1);
});

await t('mesures : événements « site » acceptés, inconnus refusés ; « Édition » compté dans les modèles Premium', async () => {
  for (const v of ['sheet:open', 'sheet:add', 'guide:open', 'look:click', 'tab:new', 'tab:cat', 'tab:promos']) await ok('fiila_track', { p_event: 'site', p_variant: v });
  await ko('fiila_track', { p_event: 'site', p_variant: 'sheet:hack' }, 'invalid_event');
  await ok('fiila_track', { p_event: 'premium', p_variant: 'edition:preview' });
  const b = await ok('fiila_bo_onboarding', {}, { uid: F.uid });
  assert.equal(b.site['sheet:open'], 1);
});

await t('table produits fermée : aucun droit direct d’anon sur les nouvelles colonnes', async () => {
  const r = await one(`select has_table_privilege('anon', 'fiila.products', 'select') a, has_table_privilege('anon', 'fiila.shops', 'select') b`);
  assert.equal(r.a, false); assert.equal(r.b, false);
  const f = await one(`select has_function_privilege('anon', 'public.fiila_bo_shop_sheet(uuid)', 'execute') a, has_function_privilege('authenticated', 'public.fiila_bo_shop_sheet(uuid)', 'execute') b`);
  assert.equal(f.a, false, 'back-office fermé à anon (migration 20261028100100)'); assert.equal(f.b, true);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n  ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL Fii Édition V1 réussis`);
process.exit(passed === results.length ? 0 : 1);
