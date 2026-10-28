// Tests SQL : Studio, mesures par décor et affichage « 6 + Plus » (28/10/2026, MANDAT-STUDIO-FIABLE-001 §3). Ordre des décors
// (favoris, au plus un candidat de la semaine, 6 visibles), exposition réelle comptée par jour, rejet explicite, partage réussi,
// mesures par version et mode au back-office, alerte de revue sans retrait automatique, interrupteur « candidat » journalisé.
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
const F = await user('fondateur.mesures@example.test', 'super_admin');
const SUP = await user('support.mesures@example.test', 'support');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Mesures Studio [TEST]', business_type: 'mode' } });
const P = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe [TEST]', price: 9000 } });
await db.query(`update fiila.products set photo = $2, photo_type = 'image/jpeg' where id = $1`, [P.id, jpeg]);
await ok('fiila_bo_setting_set', { p_key: 'studio_ready', p_value: 1 }, F);
await ok('fiila_bo_studio_grant', { p_shop: S.shop.id, p_delta: 50, p_reason: 'Tests mesures [TEST]' }, F);
await ok('fiila_bo_setting_set', { p_key: 'studio_daily', p_value: 100 }, F);
await ok('fiila_bo_setting_set', { p_key: 'studio_budget_usd', p_value: 50 }, F);
// 9 décors « mode » de test (rangs 1 à 9) ; la base de test n'en a pas d'autres pour cette catégorie.
await db.query(`delete from fiila.studio_scenes where category = 'mode'`);
for (let i = 1; i <= 9; i++) await db.query(`insert into fiila.studio_scenes (id, category, label, swatch, prompt, rank, version) values ($1, 'mode', $2, '#EFEAE0', 'test scene prompt [TEST]', $3, '0.2.0')`, ['tm-' + i, 'Décor ' + i, i]);
const state = () => ok('fiila_studio_state', { p_key: S.key, p_product: P.id });
const ids = (st) => st.scenes.map((x) => x.id);
const top = (st) => st.scenes.filter((x) => x.top).map((x) => x.id);
const PATH = (id) => `s/${id}.jpg`;
async function series(style, end, mode = 'fidele') {
  const j = await ok('fiila_studio_reserve', { p_key: S.key, p_product: P.id, p_style: style, p_mode: mode });
  if (end === 'failed') await ok('fiila_studio_complete', { p_job: j.job, p: { error: 'provider_error' } }, SR);
  else await ok('fiila_studio_complete', { p_job: j.job, p: { results: ['https://v3.fal.media/files/t/1.jpg'], path: PATH(j.job), cost_usd: 0.04 } }, SR);
  if (end === 'kept') await ok('fiila_studio_keep', { p_key: S.key, p_job: j.job, p_index: 0 });
  return j.job;
}

await t('affichage : 6 décors visibles par rang, les autres dans « Plus » ; aucun candidat tant que le fondateur n’en promeut pas', async () => {
  const st = await state();
  assert.deepEqual(ids(st), ['tm-1', 'tm-2', 'tm-3', 'tm-4', 'tm-5', 'tm-6', 'tm-7', 'tm-8', 'tm-9']);
  assert.deepEqual(top(st), ['tm-1', 'tm-2', 'tm-3', 'tm-4', 'tm-5', 'tm-6']);
  assert.ok(st.scenes.every((x) => !x.candidate));
});

await t('candidat : au plus un parmi les six, le même toute la semaine ; les autres candidats dans « Plus » ; interrupteur réservé, motif, journal', async () => {
  await ko('fiila_bo_studio_scene_candidate', { p_id: 'tm-8', p_candidate: true, p_reason: 'Pilote' }, null, SUP);
  await ko('fiila_bo_studio_scene_candidate', { p_id: 'tm-8', p_candidate: true, p_reason: ' ' }, 'reason_required', F);
  await ok('fiila_bo_studio_scene_candidate', { p_id: 'tm-8', p_candidate: true, p_reason: 'Pilote [TEST]' }, F);
  await ok('fiila_bo_studio_scene_candidate', { p_id: 'tm-9', p_candidate: true, p_reason: 'Pilote [TEST]' }, F);
  assert.ok(await one(`select 1 from fiila.admin_log where action = 'studio_scene' and target_id = 'tm-8' and detail ->> 'candidate' = 'true'`));
  const st = await state();
  const cands = st.scenes.filter((x) => x.candidate);
  assert.equal(cands.length, 1, 'un seul candidat de la semaine');
  assert.equal(st.scenes.findIndex((x) => x.candidate), 0, 'sans favori, le candidat passe en tête');
  assert.ok(cands[0].top);
  const other = cands[0].id === 'tm-8' ? 'tm-9' : 'tm-8';
  assert.ok(!top(st).includes(other), 'l’autre candidat est dans « Plus »');
  assert.deepEqual(ids(await state()), ids(st), 'ordre stable (même semaine)');
});

await t('favoris : les décors gardés passent en tête, le candidat juste après ; 6 favoris → plus de candidat', async () => {
  await series('tm-3', 'kept'); await series('tm-3', 'kept'); await series('tm-5', 'kept');
  let st = await state();
  assert.deepEqual(ids(st).slice(0, 2), ['tm-3', 'tm-5']);
  assert.ok(st.scenes[2].candidate, 'candidat juste après les favoris');
  for (const x of ['tm-1', 'tm-2', 'tm-4', 'tm-6']) await series(x, 'kept');
  st = await state();
  assert.ok(st.scenes.every((x) => !x.candidate), '6 favoris : aucun candidat');
  assert.equal(top(st).length, 6);
});

await t('exposition réelle : décors affichés comptés par jour, version et mode ; décor inconnu ou d’une autre catégorie ignoré ; liste bornée', async () => {
  await db.query(`insert into fiila.studio_scenes (id, category, label, prompt) values ('tb-1', 'bijoux', 'Bijou', 'test scene prompt [TEST]')`);
  assert.equal((await ok('fiila_studio_seen', { p_key: S.key, p_scenes: ['tm-1', 'tm-2', 'tb-1', 'inconnu'], p_mode: 'fidele' })).counted, 2);
  await ok('fiila_studio_seen', { p_key: S.key, p_scenes: ['tm-1'], p_mode: 'fidele' });
  await ok('fiila_studio_seen', { p_key: S.key, p_scenes: ['tm-1'], p_mode: 'premium' });
  const v = await one(`select n from fiila.studio_scene_views where shop_id = $1 and scene_id = 'tm-1' and mode = 'fidele'`, [S.shop.id]);
  assert.equal(v.n, 2);
  await ko('fiila_studio_seen', { p_key: S.key, p_scenes: Array.from({ length: 31 }, (_, i) => 'x' + i) }, 'invalid_payload');
  await ko('fiila_studio_seen', { p_key: S.key, p_scenes: ['tm-1'], p_mode: 'video' }, 'invalid_payload');
  await ko('fiila_studio_seen', { p_key: 'mauvaise-cle', p_scenes: ['tm-1'] });
});

await t('rejet explicite et partage : une fois chacun, seulement par la boutique ; partage sans version gardée = rien', async () => {
  const j = await series('tm-7', 'done');
  assert.equal((await ok('fiila_studio_reject', { p_key: S.key, p_job: j })).rejected, true);
  assert.equal((await ok('fiila_studio_reject', { p_key: S.key, p_job: j })).rejected, false);
  const other = await ok('fiila_shop_save', { p_key: null, p: { name: 'Autre [TEST]', business_type: 'mode' } });
  await ko('fiila_studio_reject', { p_key: other.key, p_job: j }, 'not_found');
  const P2 = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Sans Studio [TEST]', price: 1000 } });
  assert.equal((await ok('fiila_studio_shared', { p_key: S.key, p_product: P2.id })).shared, false);
  assert.equal((await ok('fiila_studio_shared', { p_key: S.key, p_product: P.id })).shared, true);
  assert.equal((await ok('fiila_studio_shared', { p_key: S.key, p_product: P.id })).shared, false, 'une seule fois');
});

await t('back-office : mesures par décor, version et mode ; alerte de revue sous 40 % après 20 livrées, sans retrait automatique', async () => {
  for (let i = 0; i < 20; i++) await series('tm-7', i < 6 ? 'kept' : 'done');
  await series('tm-7', 'failed');
  await ko('fiila_bo_studio_scenes', {});
  const l = await ok('fiila_bo_studio_scenes', {}, SUP);
  const d7 = l.find((x) => x.id === 'tm-7');
  const f = d7.stats.find((x) => x.mode === 'fidele' && x.version === '0.2.0');
  assert.equal(f.delivered, 21); assert.equal(f.kept, 6); assert.equal(f.failed, 1); assert.equal(f.rejected, 1); assert.equal(f.shops, 1);
  assert.equal(f.keep_rate, 0.29); assert.equal(f.alert, true); assert.equal(d7.alert, true);
  assert.equal(d7.active, true, 'alerte = revue humaine, pas de retrait');
  const d1 = l.find((x) => x.id === 'tm-1');
  const v1 = d1.stats.find((x) => x.mode === 'fidele');
  assert.equal(v1.shown, 2); assert.equal(v1.kept, 1); assert.equal(d1.alert, false);
  assert.equal(d1.stats.find((x) => x.mode === 'premium').shown, 1, 'exposition premium comptée à part');
  // Dernière version gardée de l'article au moment du partage : décor tm-6 (dernier favori gardé).
  assert.equal(l.find((x) => x.id === 'tm-6').stats.find((x) => x.mode === 'fidele').shared, 1, 'partage compté sur la dernière version gardée de l’article');
  assert.equal(l.find((x) => x.id === 'tm-3').stats.find((x) => x.mode === 'fidele').shared, 0);
  assert.equal(l.find((x) => x.id === 'tm-8').candidate, true);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL mesures du Studio réussis`);
process.exit(passed === results.length ? 0 : 1);
