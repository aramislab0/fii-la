// Tests SQL : fil des boutiques (25 places gratuites, ouverture de vitrine, sortie du fil, rien de privé).
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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
async function shop(i, open = true, product = true) {
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: `Boutique ${i} [TEST]`, phone: '77 200 00 ' + String(i).padStart(2, '0') } })).key;
  if (product) await ok('fiila_product_save', { p_key: k, p: { name: `Article ${i} [TEST]`, price: 1000 + i, photo: i === 1 ? photo : undefined } });
  if (open) await ok('fiila_shop_vitrine', { p_key: k, p: { public: true, about: `Présentation ${i}` } });
  return k;
}
const K = [];

await t('vitrine fermée : pas de place ; ouverture : place n°1, visible dans le fil, sans photo ni numéro', async () => {
  const k0 = await shop(0, false);
  assert.equal((await ok('fiila_shop_feed', { p_key: k0, p_on: null })).rank, undefined);
  K.push(await shop(1));
  const me = await ok('fiila_shop_feed', { p_key: K[0], p_on: null });
  assert.equal(me.rank, 1); assert.equal(me.feed, true); assert.equal(me.free_left, 24);
  const f = await ok('fiila_feed', {});
  assert.equal(f.shops.length, 1);
  const s = f.shops[0];
  assert.equal(s.name, 'Boutique 1 [TEST]'); assert.equal(s.rank, 1); assert.equal(s.products[0].price, 1001); assert.ok(s.photo_id);
  const txt = JSON.stringify(f);
  assert.ok(!txt.includes('base64'), 'aucune photo dans le fil'); assert.ok(!txt.includes('77 200'), 'aucun numéro');
  assert.ok(!txt.includes('"key"') && !txt.includes('"id":"' + 'x'), 'pas de clé');
});

await t('25 places seulement, dans l’ordre d’arrivée ; la 26e boutique n’apparaît pas', async () => {
  for (let i = 2; i <= 26; i++) K.push(await shop(i));
  const f = await ok('fiila_feed', {});
  assert.equal(f.shops.length, 25);
  assert.ok(!f.shops.some((s) => s.name === 'Boutique 26 [TEST]'));
  const last = await ok('fiila_shop_feed', { p_key: K[25], p_on: null });
  assert.equal(last.rank, undefined); assert.equal(last.free_left, 0);
  assert.equal((await ok('fiila_shop_feed', { p_key: K[24], p_on: null })).rank, 25);
});

await t('sortir du fil : la boutique disparaît mais garde sa place ; fermer la vitrine aussi', async () => {
  await ok('fiila_shop_feed', { p_key: K[1], p_on: false });
  let f = await ok('fiila_feed', {});
  assert.ok(!f.shops.some((s) => s.name === 'Boutique 2 [TEST]'));
  const back = await ok('fiila_shop_feed', { p_key: K[1], p_on: true });
  assert.equal(back.rank, 2, 'place gardée');
  await ok('fiila_shop_vitrine', { p_key: K[2], p: { public: false } });
  f = await ok('fiila_feed', {});
  assert.ok(!f.shops.some((s) => s.name === 'Boutique 3 [TEST]'));
  assert.equal(f.shops.length, 24);
  await ok('fiila_shop_vitrine', { p_key: K[2], p: { public: true } });
  assert.equal((await ok('fiila_shop_feed', { p_key: K[2], p_on: null })).rank, 3);
});

await t('boutique supprimée : sa place revient à la première boutique qui attend ; vitrine sans article : absente du fil', async () => {
  await ok('fiila_shop_delete', { p_key: K[3] });
  assert.equal((await ok('fiila_shop_feed', { p_key: K[25], p_on: null })).rank, 4, 'la boutique qui attendait reçoit la place');
  const k27 = await shop(27);
  assert.equal((await ok('fiila_shop_feed', { p_key: k27, p_on: null })).rank, undefined);
  await ok('fiila_shop_delete', { p_key: K[4] });
  assert.equal((await ok('fiila_shop_feed', { p_key: k27, p_on: null })).rank, 5);
  await ok('fiila_shop_delete', { p_key: K[5] });
  const empty = await shop(28, true, false);
  assert.equal((await ok('fiila_shop_feed', { p_key: empty, p_on: null })).rank, 6);
  assert.ok(!(await ok('fiila_feed', {})).shops.some((s) => s.name === 'Boutique 28 [TEST]'), 'rien à montrer');
  await ko('fiila_shop_feed', { p_key: 'pas-la-cle', p_on: false }, 'shop_required');
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL fil des boutiques réussis`);
process.exit(passed === results.length ? 0 : 1);
