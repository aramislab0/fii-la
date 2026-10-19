// Tests SQL : boutiques de démonstration (scripts/demo-seed.sql) — invisibles sans le mode démo, jamais dans les 25 places,
// vitrine marquée « démo », effacement complet par scripts/demo-clear.sql.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const ok = async (fn, args) => { const r = await rpc(db, fn, args); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const one = async (sql) => (await db.query(sql)).rows[0];
let REAL;

await t('chargement : 14 boutiques de démonstration, toutes catégories, sans place gratuite', async () => {
  REAL = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Vraie boutique [TEST]' } })).key;
  await ok('fiila_product_save', { p_key: REAL, p: { name: 'Article [TEST]', price: 1000 } });
  await ok('fiila_shop_vitrine', { p_key: REAL, p: { public: true } });
  await db.exec(readFileSync('scripts/demo-seed.sql', 'utf8'));
  assert.equal((await one(`select count(*)::int n from fiila.shops where demo`)).n, 14);
  assert.equal((await one(`select count(*)::int n from fiila.shops where demo and featured_rank is not null`)).n, 0);
  assert.equal((await one(`select count(distinct category)::int n from fiila.products p join fiila.shops s on s.id = p.shop_id where s.demo`)).n, 9);
  assert.equal((await ok('fiila_shop_feed', { p_key: REAL, p_on: null })).free_left, 24, 'les 25 places restent aux vraies boutiques');
});

await t('fil : sans mode démo, seulement les vraies boutiques ; en mode démo, les fictives après, marquées', async () => {
  const f = await ok('fiila_feed', {});
  assert.deepEqual(f.shops.map((s) => s.name), ['Vraie boutique [TEST]']);
  const d = await ok('fiila_feed', { p_demo: true });
  assert.equal(d.shops.length, 15);
  assert.equal(d.shops[0].name, 'Vraie boutique [TEST]', 'les vraies boutiques d’abord');
  assert.ok(d.shops.slice(1).every((s) => s.demo === true && /\(démo\)$/.test(s.name)));
  assert.ok(d.shops.some((s) => s.reviews >= 3 && s.rating < 5), 'notes variées');
});

await t('vitrine d’une boutique de démonstration : marquée, articles avec tailles et stock, photo lisible', async () => {
  const v = await ok('fiila_vitrine', { p_slug: 'demo-sneakers-medina' });
  assert.equal(v.state, 'ok'); assert.equal(v.shop.demo, true);
  const b = v.products.find((p) => p.name === 'Baskets blanches');
  assert.ok(b.sizes.includes('42')); assert.equal(b.stock, 6);
  assert.match((await ok('fiila_vitrine_photo', { p_slug: 'demo-sneakers-medina', p_id: b.id })).photo, /^data:image\/png;base64,/);
  assert.equal((await ok('fiila_vitrine', { p_slug: (await one(`select slug from fiila.shops where name = 'Vraie boutique [TEST]'`)).slug })).shop.demo, undefined);
});

await t('effacement : plus aucune boutique de démonstration, ni article, ni note ; la vraie boutique reste', async () => {
  await db.exec(readFileSync('scripts/demo-clear.sql', 'utf8'));
  assert.equal((await one(`select count(*)::int n from fiila.shops where demo`)).n, 0);
  assert.equal((await one(`select count(*)::int n from fiila.reviews`)).n, 0);
  assert.equal((await one(`select count(*)::int n from fiila.shops`)).n, 1);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL boutiques de démonstration réussis`);
process.exit(passed === results.length ? 0 : 1);
