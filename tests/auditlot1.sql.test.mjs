// Tests SQL : corrections de l'audit du 27/10/2026 côté base (migration 20261028300000, HANDOFF #78). Stock rendu à
// l'annulation d'une commande du site, journal des commandes et des paiements, RLS partout, back-office fermé à anon,
// purges, identifiant d'appareil salé et « effacer mes favoris », pièce d'identité effacée à la validation, crédits Studio,
// NINEA, gains des Agents calculés pour tous, jeton de la copie des photos, erreurs du navigateur comptées.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const F = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'f@example.test') returning id`)).id;
await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Fondateur')`, [F]);
await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [F]);

const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Audit [TEST]', business_type: 'mode', ninea: '123456789' } });
const slug = (await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } })).slug;
const P = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe', price: 10000, stock: 5 } });
const stock = async () => Number((await one(`select stock from fiila.products where id = $1`, [P.id])).stock);
const order = async (qty) => (await ok('fiila_vitrine_order', { p_slug: slug, p: { items: [{ product_id: P.id, qty }], customer: { name: 'Cliente', phone: '770000009' } } }));
const orderId = async (inv) => (await one(`select id from fiila.orders where share_token = $1`, [inv])).id;

await t('stock : décompté à la commande du site, rendu à l’annulation, repris à la réouverture ; journal des états', async () => {
  const o = await order(2);
  assert.equal(await stock(), 3);
  const id = await orderId(o.invoice);
  await ok('fiila_order_set_status', { p_key: S.key, p_id: id, p_status: 'cancelled' });
  assert.equal(await stock(), 5, 'rendu');
  await ok('fiila_order_set_status', { p_key: S.key, p_id: id, p_status: 'cancelled' });
  assert.equal(await stock(), 5, 'deux annulations = un seul retour');
  await ok('fiila_order_set_status', { p_key: S.key, p_id: id, p_status: 'open' });
  assert.equal(await stock(), 3, 'repris');
  await ok('fiila_order_set_status', { p_key: S.key, p_id: id, p_status: 'delivered' });
  assert.equal(await stock(), 3, 'livrée : rien ne bouge');
  const ev = (await db.query(`select from_status, to_status, actor from fiila.order_events where order_id = $1 and kind = 'status' order by id`, [id])).rows;
  assert.deepEqual(ev.map((e) => e.from_status + '>' + e.to_status), ['open>cancelled', 'cancelled>open', 'open>delivered']);
  assert.equal(ev[0].actor, 'cle');
});

await t('commande saisie dans l’application : le stock ne bouge pas à l’annulation', async () => {
  const o = await ok('fiila_order_create', { p_key: S.key, p: { customer: { name: 'Cliente app' }, items: [{ label: 'Robe', qty: 1, price: 10000, product_id: P.id }] } });
  const before = await stock();
  await ok('fiila_order_set_status', { p_key: S.key, p_id: o.id, p_status: 'cancelled' });
  assert.equal(await stock(), before);
});

await t('paiements : ajout et suppression journalisés, le reste ne bouge pas', async () => {
  const o = await order(1);
  const id = await orderId(o.invoice);
  const pay = await ok('fiila_order_payment_add', { p_key: S.key, p_id: id, p_amount: 10000, p_method: 'wave' });
  const pid = (await one(`select id from fiila.payments where order_id = $1`, [id])).id;
  await ok('fiila_order_payment_delete', { p_key: S.key, p_id: id, p_payment_id: pid });
  const ev = (await db.query(`select kind, amount, method from fiila.order_events where order_id = $1 and kind like 'payment%' order by id`, [id])).rows;
  assert.deepEqual(ev.map((e) => e.kind + ':' + e.amount + ':' + e.method), ['payment_add:10000:wave', 'payment_delete:10000:wave']);
  const h = await ok('fiila_bo_order_events', { p_order: id }, { uid: F });
  assert.equal(h.length, 2); assert.equal(h[0].actor, 'boutique');
  await ko('fiila_bo_order_events', { p_order: id });
});

await t('RLS sur toutes les tables du schéma fiila', async () => {
  const r = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fiila' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
  assert.deepEqual(r, []);
});

await t('back-office fermé à anon, sauf l’ouverture d’une invitation et le portail ; l’équipe connectée garde l’accès', async () => {
  const r = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname ~ '^fiila_(bo|admin)_' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map((x) => x.proname);
  assert.deepEqual(r, ['fiila_bo_invite_get', 'fiila_bo_me']);
  const a = (await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname ~ '^fiila_(bo|admin)_' and not has_function_privilege('authenticated', p.oid, 'execute')`)).rows[0].n;
  assert.equal(a, 0);
  assert.ok((await ok('fiila_bo_me', {}, { uid: F })).staff);
});

await t('appareil : empreinte salée, « effacer mes favoris » efface favoris et suivis de ce téléphone seulement', async () => {
  const D = 'appareil-audit-numero-un-00000001', D2 = 'appareil-audit-numero-deux-0000002';
  await ok('fiila_fav', { p_product: P.id, p_on: true, p_device: D });
  await ok('fiila_follow', { p_slug: slug, p_on: true, p_device: D });
  await ok('fiila_fav', { p_product: P.id, p_on: true, p_device: D2 });
  const w = (await one(`select who from fiila.saves where who like 'd:%' limit 1`)).who;
  const plain = (await one(`select 'd:' || encode(extensions.digest($1, 'sha256'), 'hex') h`, [D])).h;
  assert.notEqual(w, plain, 'plus le simple hachage recalculable');
  const r = await ok('fiila_forget_device', { p_device: D });
  assert.deepEqual(r, { favs: 1, follows: 1, reports: 0 });
  assert.equal(Number((await one(`select count(*) n from fiila.saves`)).n), 1, 'l’autre téléphone garde son favori');
  await ko('fiila_forget_device', { p_device: 'court' }, 'device_required');
});

await t('purges : empreinte IP des favoris après 30 jours, séries Studio après 6 mois, invitations d’équipe après 90 jours', async () => {
  await db.query(`update fiila.saves set src = 'x', created_at = now() - interval '31 days'`);
  await db.query(`insert into fiila.studio_jobs (shop_id, product_id, style, status, created_at) values ($1, $2, 'blanc', 'failed', now() - interval '7 months')`, [S.shop.id, P.id]);
  await db.query(`insert into fiila.shop_invites (token_hash, shop_id, role, phone, expires_at, created_at) values (extensions.digest('t', 'sha256'), $1, 'editor', '770000001', now() - interval '100 days', now() - interval '107 days')`, [S.shop.id]);
  await db.query(`update fiila.settings set value = (now() - interval '1 hour')::text where key = 'housekeeping_at'`);
  await db.query(`select fiila.housekeeping()`);
  assert.equal(Number((await one(`select count(*) n from fiila.saves where src is not null`)).n), 0);
  assert.equal(Number((await one(`select count(*) n from fiila.studio_jobs`)).n), 0);
  assert.equal(Number((await one(`select count(*) n from fiila.shop_invites`)).n), 0);
});

await t('pièce d’identité : images effacées dès la validation, décision gardée', async () => {
  await db.query(`insert into fiila.shop_kyc (shop_id, doc_type, front, front_type, status, submitted_at) values ($1, 'passport', '\\x01', 'image/jpeg', 'submitted', now())`, [S.shop.id]);
  await ok('fiila_bo_kyc_decide', { p_shop: S.shop.id, p_ok: true }, { uid: F });
  const k = await one(`select status, front, doc_type from fiila.shop_kyc where shop_id = $1`, [S.shop.id]);
  assert.equal(k.status, 'verified'); assert.equal(k.front, null); assert.equal(k.doc_type, 'passport');
});

await t('crédits Studio : retrait au-delà du solde refusé, journal = retrait appliqué ; NINEA plus enregistré', async () => {
  await ok('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: 3, p_reason: 'Test' }, { uid: F });
  await ko('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: -5, p_reason: 'Test' }, 'not_enough_credits', { uid: F });
  assert.equal((await ok('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: -3, p_reason: 'Test' }, { uid: F })).credits, 0);
  assert.equal((await one(`select ninea from fiila.shops where id = $1`, [S.shop.id])).ninea, null);
});

await t('gains des Agents : évaluation de tous les liens actifs en un appel (tâche de nuit)', async () => {
  assert.equal(typeof (await one(`select fiila.amb_eval_all() n`)).n, 'number');
});

await t('copie des photos : jeton du planificateur vérifié par la base, fonction réservée à la clé de service', async () => {
  const tok = (await one(`select value from fiila.settings where key = 'media_sync_token'`)).value;
  assert.ok(tok.length >= 32);
  assert.equal((await one(`select public.fiila_media_sync_auth($1) ok`, [tok])).ok, true);
  assert.equal((await one(`select public.fiila_media_sync_auth($1) ok`, ['x'.repeat(40)])).ok, false);
  assert.equal((await one(`select public.fiila_media_sync_auth(null) ok`)).ok, false);
  const r = await one(`select has_function_privilege('anon', 'public.fiila_media_sync_auth(text)', 'execute') a, has_function_privilege('authenticated', 'public.fiila_media_sync_auth(text)', 'execute') b`);
  assert.equal(r.a, false); assert.equal(r.b, false);
});

await t('santé : erreurs du navigateur comptées par écran (sans contenu), lues par l’équipe', async () => {
  await ok('fiila_track', { p_event: 'js_error', p_variant: 'boutique' });
  await ko('fiila_track', { p_event: 'js_error', p_variant: 'TypeError: x is null' }, 'invalid_event');
  const h = await ok('fiila_bo_health', {}, { uid: F });
  assert.equal(h.js_errors.boutique, 1); assert.equal(typeof h.media_failed, 'number');
  await ko('fiila_bo_health', {});
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n  ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL de l’audit (lot 1) réussis`);
process.exit(passed === results.length ? 0 : 1);
