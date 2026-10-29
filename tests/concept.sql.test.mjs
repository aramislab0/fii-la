// Tests SQL : modèle Premium « Concept » (fondateur, 29/10/2026 20:38 ; migration 20261029300000). Rubriques propres à
// la boutique, modèle réservé au Premium, couleurs noir et rose, style du site (coins, animations, saison), corrections
// #85 (article créé masqué, description gardée), site jusqu'à 500 articles, carte « Site » et réglage au back-office.
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
const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Concept Test [TEST]', business_type: 'mode' } });
const v = await ok('fiila_shop_vitrine', { p_key: s.key, p: { public: true } });
const SID = s.shop.id;

await t('rubrique : enregistrée, nettoyée, 30 caractères au plus (au-delà refusée) ; gardée si absente ; effacée par une valeur vide', async () => {
  const a = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Gourde Stitch', price: 12000, rubric: '  Gourdes & mugs ', description: 'Une gourde' } });
  assert.equal(a.rubric, 'Gourdes & mugs');
  const b = await ok('fiila_product_save', { p_key: s.key, p: { id: a.id, name: 'Gourde Stitch', price: 13000 } });
  assert.equal(b.rubric, 'Gourdes & mugs', 'rubrique gardée');
  assert.equal(b.description, 'Une gourde', 'description gardée quand elle est absente (#85)');
  await ko('fiila_product_save', { p_key: s.key, p: { id: a.id, name: 'Gourde Stitch', price: 13000, rubric: 'R'.repeat(45) } }, 'too_long');
  const c = await ok('fiila_product_save', { p_key: s.key, p: { id: a.id, name: 'Gourde Stitch', price: 13000, rubric: 'R'.repeat(30), description: '' } });
  assert.equal(c.rubric.length, 30); assert.equal(c.description, undefined, 'description vidée quand elle est envoyée vide');
  const d = await ok('fiila_product_save', { p_key: s.key, p: { id: a.id, name: 'Gourde Stitch', price: 13000, rubric: '' } });
  assert.equal(d.rubric, undefined);
});

await t('article créé avec active: false : reste masqué (#85) ; sans le champ : visible', async () => {
  const h = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Masqué', price: 1000, active: false } });
  assert.equal(h.active, false);
  const w = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Visible', price: 1000, rubric: 'Sacs' } });
  assert.equal(w.active, true);
  const site = await ok('fiila_vitrine', { p_slug: v.slug });
  assert.equal(site.products.some((p) => p.name === 'Masqué'), false);
  const vis = site.products.find((p) => p.name === 'Visible');
  assert.equal(vis.rubric, 'Sacs'); assert.equal(typeof vis.added, 'number');
});

await t('modèle Concept : réservé au Premium ; servi tel quel une fois Premium, sinon modèle de base', async () => {
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { theme: 'concept' } }, 'premium_required');
  await db.query(`update fiila.shops set plan = 'premium' where id = $1`, [SID]);
  const r = await ok('fiila_shop_vitrine', { p_key: s.key, p: { theme: 'concept', accent: 'noir' } });
  assert.equal(r.theme, 'concept'); assert.equal(r.accent, 'noir');
  const site = await ok('fiila_vitrine', { p_slug: v.slug });
  assert.equal(site.shop.theme, 'concept'); assert.equal(site.shop.accent, 'noir'); assert.equal(site.shop.rail, 10);
  await db.query(`update fiila.shops set plan = 'free' where id = $1`, [SID]);
  assert.equal((await ok('fiila_vitrine', { p_slug: v.slug })).shop.theme, 'galerie');
  await db.query(`update fiila.shops set plan = 'premium' where id = $1`, [SID]);
});

await t('couleurs : noir et rose acceptées, couleur inconnue refusée ; anciens modèles et couleurs inchangés', async () => {
  assert.equal((await ok('fiila_shop_vitrine', { p_key: s.key, p: { accent: 'rose' } })).accent, 'rose');
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { accent: 'fuchsia' } }, 'invalid_theme');
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { theme: 'inconnu' } }, 'invalid_theme');
  assert.equal((await ok('fiila_shop_vitrine', { p_key: s.key, p: { theme: 'edition', accent: 'foret' } })).theme, 'edition');
  await ok('fiila_shop_vitrine', { p_key: s.key, p: { theme: 'concept', accent: 'noir' } });
});

await t('style : liste fermée (coins, animations, saison), renvoyé au site ; valeur inconnue refusée', async () => {
  const r = await ok('fiila_shop_vitrine', { p_key: s.key, p: { style: { corners: 'nets', anim: false, season: true } } });
  assert.deepEqual(r.style, { corners: 'nets', anim: false, season: true });
  assert.deepEqual((await ok('fiila_vitrine', { p_slug: v.slug })).shop.style, { corners: 'nets', anim: false, season: true });
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { style: { corners: 'ronds' } } }, 'invalid_style');
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { style: { couleur: 'x' } } }, 'invalid_style');
  await ko('fiila_shop_vitrine', { p_key: s.key, p: { style: { anim: 'oui' } } }, 'invalid_style');
  const z = await ok('fiila_shop_vitrine', { p_key: s.key, p: { style: {} } });
  assert.equal(z.style, undefined, 'style vide = valeurs du modèle');
});

await t('réglages : site_anim = 0 coupe les animations, site_rail borné (4 à 20)', async () => {
  await ok('fiila_bo_setting_set', { p_key: 'site_anim', p_value: 0 }, F);
  assert.equal((await ok('fiila_vitrine', { p_slug: v.slug })).shop.anim_off, true);
  await ok('fiila_bo_setting_set', { p_key: 'site_anim', p_value: 1 }, F);
  assert.equal((await ok('fiila_vitrine', { p_slug: v.slug })).shop.anim_off, undefined);
  await ok('fiila_bo_setting_set', { p_key: 'site_rail', p_value: 6 }, F);
  assert.equal((await ok('fiila_vitrine', { p_slug: v.slug })).shop.rail, 6);
  await ko('fiila_bo_setting_set', { p_key: 'site_rail', p_value: 30 }, null, F);
  const all = await ok('fiila_bo_settings', {}, F);
  assert.ok('site_rail' in all && 'site_anim' in all, 'réglages listés');
});

await t('site : jusqu’à 500 articles servis (plus de coupure à 200)', async () => {
  await db.query(`insert into fiila.products (shop_id, name, price) select $1, 'Lot ' || g, 1000 from generate_series(1, 230) g`, [SID]);
  const site = await ok('fiila_vitrine', { p_slug: v.slug });
  assert.ok(site.products.length > 200, String(site.products.length));
});

await t('back-office : carte « Site » (rubriques comptées) ; réglage par l’équipe tracé ; refus sans droit ou Premium', async () => {
  const a = await ok('fiila_bo_shop_site', { p_shop: SID }, F);
  assert.equal(a.theme, 'concept'); assert.deepEqual(a.rubrics, [{ name: 'Sacs', n: 1 }]); assert.ok(a.no_rubric > 200);
  const b = await ok('fiila_bo_shop_look', { p_shop: SID, p: { accent: 'rose', style: { corners: 'doux' } } }, F);
  assert.equal(b.accent, 'rose'); assert.deepEqual(b.style, { corners: 'doux' });
  const log = await one(`select action, detail from fiila.admin_log where action = 'shop_look' order by at desc limit 1`);
  assert.equal(log.action, 'shop_look'); assert.equal(log.detail.to.accent, 'rose');
  await ko('fiila_bo_shop_look', { p_shop: SID, p: { plan: 'premium' } }, 'invalid_payload', F);
  await ko('fiila_bo_shop_site', { p_shop: SID }, null);
  await db.query(`update fiila.shops set plan = 'free' where id = $1`, [SID]);
  await ko('fiila_bo_shop_look', { p_shop: SID, p: { theme: 'concept' } }, 'premium_required', F);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL modèle Concept réussis`);
process.exit(passed === results.length ? 0 : 1);
