// Tests SQL : Réglages et Fii Studio v2 (fondateur, 27/10/2026 ; migration 20261028200000). Écrans seulement : les mesures
// anonymes des nouveaux écrans (settings_ui, studio_ui) sont acceptées, les autres refusées, et lues au back-office.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const F = (await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'f@example.test') returning id`)).rows[0].id;
await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Fondateur')`, [F]);
await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [F]);

await t('Réglages v2 : bouton « Compléter » par étape, tuiles, partage ; variante inconnue refusée', async () => {
  for (const v of ['cta:site', 'cta:product', 'cta:logo', 'cta:cover', 'cta:policies', 'cta:owner', 'tile:info', 'tile:policies', 'tile:team', 'tile:courier', 'tile:identity', 'tile:agent', 'share']) {
    await ok('fiila_track', { p_event: 'settings_ui', p_variant: v });
  }
  await ko('fiila_track', { p_event: 'settings_ui', p_variant: 'cta:hack' }, 'invalid_event');
  await ko('fiila_track', { p_event: 'settings_ui', p_variant: 'tile:<b>' }, 'invalid_event');
});

await t('Studio v2 : mode, comparaison, « Publier », « Terminé » ; variante inconnue refusée', async () => {
  for (const v of ['mode:fidele', 'mode:premium', 'compare', 'publish', 'finish']) await ok('fiila_track', { p_event: 'studio_ui', p_variant: v });
  await ko('fiila_track', { p_event: 'studio_ui', p_variant: 'keep' }, 'invalid_event');
});

await t('back-office (Croissance) : compteurs des 30 derniers jours, réservés à l’équipe', async () => {
  await ok('fiila_track', { p_event: 'studio_ui', p_variant: 'publish' });
  const b = await ok('fiila_bo_onboarding', {}, { uid: F });
  assert.equal(b.settings_ui['cta:logo'], 1); assert.equal(b.settings_ui.share, 1);
  assert.equal(b.studio_ui.publish, 2); assert.equal(b.studio_ui['mode:premium'], 1);
  await ko('fiila_bo_onboarding', {});
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n  ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL Réglages et Studio v2 réussis`);
process.exit(passed === results.length ? 0 : 1);
