// Tests SQL : accueil adaptatif (UX-ADAPTATIVE-001, 22/10/2026). Réglage adaptive_home borné et lu par l’application,
// mesure anonyme home_hero / home_pref / resume, back-office Parcours d’accueil.
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
let F;

await t('réglage adaptive_home : actif par défaut, borné 0/1, lu par l’application, listé', async () => {
  F = await user('fondateur@example.test', 'super_admin');
  assert.equal((await ok('fiila_app_flags', {})).adaptive, true);
  await ko('fiila_bo_setting_set', { p_key: 'adaptive_home', p_value: 3 }, null, F);
  await ok('fiila_bo_setting_set', { p_key: 'adaptive_home', p_value: 0 }, F);
  assert.equal((await ok('fiila_app_flags', {})).adaptive, false);
  assert.ok(JSON.stringify(await ok('fiila_bo_settings', {}, F)).includes('adaptive_home'));
  await ok('fiila_bo_setting_set', { p_key: 'adaptive_home', p_value: 1 }, F);
});

await t('mesure anonyme : variantes prévues acceptées, le reste refusé ; back-office', async () => {
  for (const [e, v] of [['home_hero', 'evenement:shown'], ['home_hero', 'evenement:click'], ['home_hero', 'evenement:success'], ['home_pref', 'pin'], ['home_pref', 'reset'], ['resume', 'order:click'], ['resume', 'product:success']]) await ok('fiila_track', { p_event: e, p_variant: v });
  await ko('fiila_track', { p_event: 'home_hero', p_variant: 'boutique:click' });
  await ko('fiila_track', { p_event: 'home_pref', p_variant: 'hack' });
  await ko('fiila_track', { p_event: 'resume', p_variant: 'client:click' });
  const d = await ok('fiila_bo_onboarding', {}, F);
  assert.equal(d.adaptive.on, true); assert.equal(d.adaptive.version, 'adaptive_v1');
  assert.deepEqual(d.adaptive.hero, { 'evenement:shown': 1, 'evenement:click': 1, 'evenement:success': 1 });
  assert.deepEqual(d.adaptive.pref, { pin: 1, reset: 1 });
  assert.deepEqual(d.adaptive.resume, { 'order:click': 1, 'product:success': 1 });
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL accueil adaptatif réussis`);
process.exit(passed === results.length ? 0 : 1);
