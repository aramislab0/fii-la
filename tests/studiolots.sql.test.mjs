// Tests SQL : Studio, lots de crédits datés et bonus de bienvenue (29/10/2026, OFFRE-COMMERCIALE-001 §3 ; fondateur
// « Par compte »). Bonus coupé par défaut ; une seule fois par compte propriétaire, seulement pour une boutique publique avec un
// article photographié ; comptes déjà servis rapprochés ; lots consommés du plus proche de l'expiration au plus lointain, puis
// essai, puis portefeuille ; échec = chaque part rendue à son lot ; lot expiré ignoré ; lots Business et achats par la clé de
// service, idempotents ; back-office.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const SR = { role: 'service_role' };
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
const F = await user('fondateur.lots@example.test', 'super_admin');
const SUP = await user('support.lots@example.test', 'support');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
async function shop(name, owner, { pub = true, photo = true } = {}) {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name, business_type: 'mode' } });
  const p = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Robe ' + name, price: 10000 } });
  if (photo) await db.query(`update fiila.products set photo = $2, photo_type = 'image/jpeg' where id = $1`, [p.id, jpeg]);
  await db.query(`update fiila.shops set user_id = $2, public = $3 where id = $1`, [s.shop.id, owner ? owner.uid : null, pub]);
  return { key: s.key, id: s.shop.id, pid: p.id };
}
const state = (S) => ok('fiila_studio_state', { p_key: S.key, p_product: S.pid });
const PATH = (id) => `s/${id}.jpg`;
async function series(S, end) {
  const j = await ok('fiila_studio_reserve', { p_key: S.key, p_product: S.pid, p_style: 'blanc' });
  if (end === 'failed') await ok('fiila_studio_complete', { p_job: j.job, p: { error: 'provider_error' } }, SR);
  else await ok('fiila_studio_complete', { p_job: j.job, p: { results: ['https://v3.fal.media/files/t/1.jpg'], path: PATH(j.job), cost_usd: 0.04 } }, SR);
  return j;
}
const lot = (S, source) => one(`select * from fiila.studio_credit_lots where shop_id = $1 and source = $2 order by created_at desc limit 1`, [S.id, source]);

const O1 = await user('proprio.un@example.test'), O2 = await user('proprio.deux@example.test'), O3 = await user('proprio.trois@example.test');
await ok('fiila_bo_setting_set', { p_key: 'studio_ready', p_value: 1 }, F);
await ok('fiila_bo_setting_set', { p_key: 'studio_daily', p_value: 100 }, F);
await ok('fiila_bo_setting_set', { p_key: 'studio_budget_usd', p_value: 50 }, F);
const A = await shop('Lots A [TEST]', O1);

await t('bonus coupé par défaut : aucun crédit, aucune trace ; crédits inchangés (essai, portefeuille, total)', async () => {
  const st = await state(A);
  assert.equal(st.welcome, null); assert.deepEqual(st.credits, { trial: 0, wallet: 0, total: 0 });
  assert.equal((await one(`select count(*)::int n from fiila.studio_welcome`)).n, 0);
  assert.equal((await one(`select value from fiila.settings where key = 'studio_welcome'`)).value, '0');
});

await t('bonus activé : 10 crédits pour 30 jours, une seule fois par compte, même sur une boutique recréée', async () => {
  await ko('fiila_bo_setting_set', { p_key: 'studio_welcome', p_value: 1 }, null, SUP);
  await ko('fiila_bo_setting_set', { p_key: 'studio_welcome_days', p_value: 400 }, null, F);
  await ok('fiila_bo_setting_set', { p_key: 'studio_welcome', p_value: 1 }, F);
  const st = await state(A);
  assert.equal(st.welcome.credits, 10);
  assert.equal(st.credits.total, 10); assert.equal(st.credits.lots, 10); assert.equal(st.credits.expiring.credits, 10);
  const days = (new Date(st.credits.expiring.at) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `expire dans 30 jours (${days})`);
  assert.equal((await state(A)).welcome, null, 'annoncé une seule fois');
  // Un compte n'a qu'une boutique : boutique recréée par le même compte (ancienne détachée) = pas de second bonus.
  await db.query(`update fiila.shops set user_id = null where id = $1`, [A.id]);
  const A2 = await shop('Lots A bis [TEST]', O1);
  await db.query(`update fiila.shops set user_id = null where id = $1`, [A2.id]);
  await db.query(`update fiila.shops set user_id = $2 where id = $1`, [A.id, O1.uid]);
  const st2 = await state(A2);
  assert.equal(st2.welcome, null); assert.equal(st2.credits.total, 0, 'même compte : pas de second bonus');
});

await t('conditions : boutique sans compte, non publique, sans photo, de démonstration → rien', async () => {
  const K = await shop('Sans compte [TEST]', null);
  assert.equal((await state(K)).credits.total, 0);
  const P = await shop('Privée [TEST]', O2, { pub: false });
  assert.equal((await state(P)).credits.total, 0);
  const N = await shop('Sans photo [TEST]', O3, { photo: false });
  assert.equal((await state(N)).credits.total, 0);
  await db.query(`update fiila.shops set public = true, demo = true where id = $1`, [P.id]);
  assert.equal((await state(P)).credits.total, 0);
  await db.query(`update fiila.shops set demo = false where id = $1`, [P.id]);
  assert.equal((await state(P)).welcome.credits, 10, 'conditions réunies : accordé');
});

await t('ordre : le lot qui expire le plus tôt d’abord, puis le portefeuille ; un échec rend chaque part à son lot', async () => {
  await ok('fiila_bo_studio_grant', { p_shop: A.id, p_delta: 4, p_reason: 'Tests lots [TEST]' }, F);
  const end = new Date(Date.now() + 5 * 86400000).toISOString();
  assert.equal((await ok('fiila_studio_lot_add', { p_shop: A.id, p_source: 'business', p_credits: 1, p_expires: end, p_ref: 'A-2026-10', p_note: 'Business [TEST]' }, SR)).created, true);
  // Business (5 jours) avant bienvenue (30 jours) ; série premium coûte 3 (1 Business + 2 bienvenue).
  const c0 = (await state(A)).credits; assert.equal(c0.total, 15);
  const j = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc', p_mode: 'premium' });
  assert.equal(j.credits.total, 12);
  const job = await one(`select credit_from, credits_lots from fiila.studio_jobs where id = $1`, [j.job]);
  assert.equal(job.credit_from, 'lot'); assert.equal(job.credits_lots.length, 2);
  assert.equal((await lot(A, 'business')).remaining, 0); assert.equal((await lot(A, 'welcome')).remaining, 8);
  await ok('fiila_studio_complete', { p_job: j.job, p: { error: 'provider_error' } }, SR);
  assert.equal((await lot(A, 'business')).remaining, 1); assert.equal((await lot(A, 'welcome')).remaining, 10);
  assert.equal((await state(A)).credits.total, 15, 'tout rendu');
  // Réussites : lots épuisés, puis portefeuille.
  for (let i = 0; i < 11; i++) await series(A, 'done');
  const c = (await state(A)).credits;
  assert.equal(c.lots, undefined); assert.equal(c.wallet, 4); assert.equal(c.total, 4);
  const w = await series(A, 'done');
  assert.equal((await one(`select credit_from from fiila.studio_jobs where id = $1`, [w.job])).credit_from, 'wallet');
  assert.equal((await state(A)).credits.wallet, 3);
});

await t('lot expiré : ne compte plus et n’est jamais débité ; achat sans expiration passe après les lots datés', async () => {
  const B = await shop('Lots B [TEST]', null);
  await ok('fiila_studio_lot_add', { p_shop: B.id, p_source: 'purchase', p_credits: 5, p_expires: null, p_ref: 'cmd-1' }, SR);
  await ok('fiila_studio_lot_add', { p_shop: B.id, p_source: 'business', p_credits: 2, p_expires: new Date(Date.now() + 86400000).toISOString(), p_ref: 'B-2026-10' }, SR);
  assert.equal((await state(B)).credits.total, 7);
  await series(B, 'done');
  assert.equal((await lot(B, 'business')).remaining, 1); assert.equal((await lot(B, 'purchase')).remaining, 5);
  await db.query(`update fiila.studio_credit_lots set expires_at = now() - interval '1 minute' where shop_id = $1 and source = 'business'`, [B.id]);
  const c = (await state(B)).credits;
  assert.equal(c.total, 5); assert.equal(c.expiring, undefined, 'achat : pas d’expiration annoncée');
  await series(B, 'done');
  assert.equal((await lot(B, 'business')).remaining, 1, 'lot expiré intact'); assert.equal((await lot(B, 'purchase')).remaining, 4);
});

await t('ajout de lots : clé de service seulement, idempotent sur la référence, règles d’expiration par source', async () => {
  const end = new Date(Date.now() + 86400000).toISOString();
  await ko('fiila_studio_lot_add', { p_shop: A.id, p_source: 'business', p_credits: 60, p_expires: end, p_ref: 'x' });
  await ko('fiila_studio_lot_add', { p_shop: A.id, p_source: 'business', p_credits: 60, p_expires: end, p_ref: 'x' }, null, F);
  await ko('fiila_studio_lot_add', { p_shop: A.id, p_source: 'welcome', p_credits: 10, p_expires: end, p_ref: 'x' }, 'invalid_payload', SR);
  await ko('fiila_studio_lot_add', { p_shop: A.id, p_source: 'business', p_credits: 60, p_expires: null, p_ref: 'x' }, 'invalid_payload', SR);
  await ko('fiila_studio_lot_add', { p_shop: A.id, p_source: 'purchase', p_credits: 10, p_expires: end, p_ref: 'x' }, 'invalid_payload', SR);
  await ko('fiila_studio_lot_add', { p_shop: A.id, p_source: 'purchase', p_credits: 0, p_expires: null, p_ref: 'x' }, 'invalid_payload', SR);
  const a = await ok('fiila_studio_lot_add', { p_shop: A.id, p_source: 'business', p_credits: 60, p_expires: end, p_ref: 'A-2026-11' }, SR);
  const b = await ok('fiila_studio_lot_add', { p_shop: A.id, p_source: 'business', p_credits: 60, p_expires: end, p_ref: 'A-2026-11' }, SR);
  assert.equal(b.created, false); assert.equal(b.lot, a.lot);
  await ko('fiila_studio_lot_add', { p_shop: (await shop('Autre [TEST]', null)).id, p_source: 'business', p_credits: 60, p_expires: end, p_ref: 'A-2026-11' }, 'invalid_payload', SR);
});

await t('rapprochement : un compte dont la boutique avait déjà des crédits offerts ne reçoit pas de bonus', async () => {
  // Rapprochement de la migration rejoué sur une boutique servie avant l'activation.
  const O4 = await user('proprio.quatre@example.test');
  const R = await shop('Déjà servie [TEST]', O4);
  await db.query(`insert into fiila.studio_welcome (user_id, shop_id, status) values ($1, $2, 'reconciled')`, [O4.uid, R.id]);
  assert.equal((await state(R)).welcome, null);
  assert.equal((await state(R)).credits.total, 0);
});

await t('back-office : bonus (réglage, accordés, rapprochés, utilisés), lots par boutique ; équipe seulement', async () => {
  await ko('fiila_bo_studio', {});
  const bo = await ok('fiila_bo_studio', {}, SUP);
  assert.equal(bo.welcome.on, true); assert.equal(bo.welcome.credits, 10); assert.equal(bo.welcome.days, 30);
  assert.equal(bo.welcome.granted, 2); assert.equal(bo.welcome.reconciled, 1); assert.equal(bo.welcome.used, 10);
  const wa = bo.wallets.find((x) => x.shop_id === A.id);
  assert.equal(wa.credits, 3);
  assert.deepEqual(wa.lots.map((l) => [l.source, l.remaining]).sort(), [['business', 0], ['business', 60], ['welcome', 0]].sort());
  const s = await ok('fiila_bo_settings', {}, F);
  assert.equal(s.studio_welcome, 1); assert.equal(s.studio_welcome_credits, 10); assert.equal(s.studio_welcome_days, 30);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL lots de crédits du Studio réussis`);
process.exit(passed === results.length ? 0 : 1);
