// Tests SQL : Ma boutique → Marketing (22/10/2026). Visites de la vitrine comptées par jour, réseaux de la boutique
// (identifiants nettoyés, affichés sur la vitrine), statistiques sur 7 / 30 / 90 jours, back-office et mesure anonyme.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
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
let S, A, B, slug;

await t('statistiques d’une boutique neuve : tout à zéro, période bornée à 7 / 30 / 90 jours', async () => {
  S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Marketing [TEST]', business_type: 'mode' } });
  const r = await ok('fiila_shop_stats', { p_key: S.key, p_days: 30 });
  assert.equal(r.days, 30); assert.equal(r.orders, 0); assert.equal(r.revenue, 0); assert.equal(r.views, 0); assert.deepEqual(r.top, []);
  assert.equal((await ok('fiila_shop_stats', { p_key: S.key, p_days: 7 })).days, 7);
  assert.equal((await ok('fiila_shop_stats', { p_key: S.key, p_days: 365 })).days, 30, 'valeur hors liste → 30 jours');
  await ko('fiila_shop_stats', { p_key: 'mauvaise-cle', p_days: 30 });
});

await t('réseaux : « @nom », lien collé ou nom → identifiant ; vide = retiré ; valeur invalide refusée', async () => {
  let r = await ok('fiila_shop_vitrine', { p_key: S.key, p: { socials: { instagram: '@atelier.test', tiktok: 'https://www.tiktok.com/@atelier_test?lang=fr', facebook: 'facebook.com/AtelierTest/' } } });
  assert.deepEqual(r.socials, { instagram: 'atelier.test', tiktok: 'atelier_test', facebook: 'AtelierTest' });
  r = await ok('fiila_shop_vitrine', { p_key: S.key, p: { socials: { instagram: 'atelier.test', tiktok: '', facebook: null } } });
  assert.deepEqual(r.socials, { instagram: 'atelier.test' });
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { socials: { instagram: 'mon compte <script>' } } }, 'invalid_social');
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { socials: 'atelier' } }, 'invalid_payload');
  assert.deepEqual((await ok('fiila_shop_vitrine', { p_key: S.key, p: null })).socials, { instagram: 'atelier.test' }, 'refus : rien n’a changé');
});

await t('vitrine publique : chaque ouverture compte une visite du jour ; les réseaux sont affichés', async () => {
  A = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe [TEST]', price: 10000 } });
  B = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Foulard [TEST]', price: 2000 } });
  slug = (await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } })).slug;
  for (let i = 0; i < 3; i++) { const v = await ok('fiila_vitrine', { p_slug: slug }); assert.deepEqual(v.shop.socials, { instagram: 'atelier.test' }); }
  const row = await one(`select n from fiila.shop_views where shop_id = $1`, [S.shop.id]);
  assert.equal(row.n, 3, 'une seule ligne par jour, compteur incrémenté');
  assert.equal((await ok('fiila_shop_stats', { p_key: S.key, p_days: 30 })).views, 3);
});

await t('ventes, panier moyen, commandes vitrine, nouveaux clients, articles les plus vendus ; annulées exclues', async () => {
  await ok('fiila_vitrine_order', { p_slug: slug, p: { items: [{ product_id: A.id, qty: 1 }, { product_id: B.id, qty: 3 }], customer: { name: 'Awa Test', phone: '770000001' } } });
  await ok('fiila_vitrine_order', { p_slug: slug, p: { items: [{ product_id: B.id, qty: 1 }], customer: { name: 'Fatou Test', phone: '770000002' } } });
  const cancel = await ok('fiila_vitrine_order', { p_slug: slug, p: { items: [{ product_id: A.id, qty: 5 }], customer: { name: 'Awa Test', phone: '770000001' } } });
  await db.query(`update fiila.orders set status = 'cancelled' where share_token = $1`, [cancel.invoice]);
  // Une commande ancienne (période précédente) : comptée dans la comparaison, pas dans la période.
  await db.query(`insert into fiila.orders (shop_id, number, customer_name, items, total, source, share_token, created_at)
    values ($1, 99, 'Ancienne Test', '[]'::jsonb, 5000, 'shop', 'tok-ancienne-test-0001', now() - interval '40 days')`, [S.shop.id]);
  const r = await ok('fiila_shop_stats', { p_key: S.key, p_days: 30 });
  assert.equal(r.orders, 2); assert.equal(r.revenue, 18000); assert.equal(r.basket, 9000); assert.equal(r.vitrine_orders, 2);
  assert.equal(r.new_customers, 2);
  assert.equal(r.prev_orders, 1); assert.equal(r.prev_revenue, 5000);
  assert.deepEqual(r.top.map((x) => [x.name, x.qty, x.amount]), [['Foulard [TEST]', 4, 8000], ['Robe [TEST]', 1, 10000]]);
  assert.deepEqual(r.vitrine, { public: true, slug });
  const w = await ok('fiila_shop_stats', { p_key: S.key, p_days: 7 });
  assert.equal(w.prev_orders, 0, 'sur 7 jours, la commande de 40 jours n’entre pas dans la comparaison');
});

await t('back-office : fiche boutique → marketing (visites, commandes vitrine, réseaux) ; réservé à l’équipe', async () => {
  const F = await user('fondateur@example.test', 'super_admin');
  const CLI = await user('cliente@example.test');
  const d = await ok('fiila_bo_shop', { p_id: S.shop.id }, F);
  assert.equal(d.marketing.views_30, 3); assert.equal(d.marketing.vitrine_orders_30, 3); assert.equal(d.marketing.posts_30, 0);
  assert.deepEqual(d.marketing.socials, { instagram: 'atelier.test' });
  await ko('fiila_bo_shop', { p_id: S.shop.id }, null, CLI);
});

await t('mesure anonyme « marketing » : variantes prévues acceptées, le reste refusé', async () => {
  for (const v of ['open', 'period:7', 'period:90', 'share:wa', 'share:copy', 'share:qr', 'socials:open', 'socials:save', 'publish:click', 'vitrine:open',
    'publish:open', 'publish:post', 'publish:story', 'publish:shared', 'publish:saved', 'publish:instagram', 'publish:facebook', 'publish:whatsapp', 'publish:tiktok', 'publish:snapchat']) {
    await ok('fiila_track', { p_event: 'marketing', p_variant: v });
  }
  await ko('fiila_track', { p_event: 'marketing', p_variant: 'period:365' });
  const F2 = await user('analyste@example.test', 'super_admin');
  const o = await ok('fiila_bo_onboarding', {}, F2);
  assert.equal(o.marketing.open, 1); assert.equal(o.marketing['share:wa'], 1);
  await ko('fiila_track', { p_event: 'marketing', p_variant: 'share:sms' });
  await ko('fiila_track', { p_event: 'marketing', p_variant: 'publish:reel' });
  assert.equal(o.marketing['publish:story'], 1);
});

await t('droits : statistiques ouvertes à anon / authenticated (clé de boutique) ; tables et aides internes non exposées', async () => {
  const g = await one(`select has_function_privilege('anon', 'public.fiila_shop_stats(text, int)', 'execute') a,
    has_function_privilege('anon', 'fiila.socials_in(jsonb)', 'execute') b, has_table_privilege('anon', 'fiila.shop_views', 'select') c`);
  assert.equal(g.a, true); assert.equal(g.b, false); assert.equal(g.c, false);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL marketing réussis`);
process.exit(passed === results.length ? 0 : 1);
