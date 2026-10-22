// Tests SQL : mandat WHATSAPP-001, lot 1 — registre des 6 modèles (rien soumis à Meta), mesure anonyme du partage de la
// carte, réglage wa_card_media, état Meta saisi par l'équipe (droit « settings ») et journalisé.
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
  assert.notEqual(r.status, 200, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
const F = await user('assane@example.test', 'super_admin');
const SUP = await user('aide@example.test', 'support');
const CLI = await user('cliente@example.test');

await t('registre : les 6 modèles du catalogue, aucun soumis à Meta ; demande d’adresse et événement en pilote avec une carte', async () => {
  const d = await ok('fiila_bo_wa', {}, F);
  assert.deepEqual(d.templates.map((x) => x.id), ['fiila_address_request_v1', 'fiila_ambassador_invite_v1', 'fiila_agent_invite_v1',
    'fiila_order_recorded_v1', 'fiila_delivery_started_v1', 'fiila_event_invite_v1']);
  assert.ok(d.templates.every((x) => x.meta === 'NOT_SUBMITTED'));
  assert.deepEqual(d.templates.filter((x) => x.media).map((x) => [x.id, x.integration, x.cta]), [['fiila_address_request_v1', 'MANUAL_PILOT', 'Indiquer mon entrée'],
    ['fiila_event_invite_v1', 'MANUAL_PILOT', 'Voir l’événement']], '22/10 : l’événement passe en pilote avec sa carte');
  assert.equal(d.media_on, true);
});

await t('mesure : variantes de la carte acceptées, le reste refusé', async () => {
  for (const v of ['request:file', 'request:text', 'request:download', 'request:failed']) await ok('fiila_track', { p_event: 'wa_card', p_variant: v });
  for (const v of ['address:file', 'event:text', 'vitrine:download', 'address:failed']) await ok('fiila_track', { p_event: 'wa_card', p_variant: v });
  await ko('fiila_track', { p_event: 'wa_card', p_variant: 'adresse:file' });
  await ko('fiila_track', { p_event: 'wa_card', p_variant: 'request:sent' });
  await ko('fiila_track', { p_event: 'wa_card', p_variant: 'request:file;drop' });
  const d = await ok('fiila_bo_wa', {}, F);
  assert.deepEqual(d.shares, { 'request:file': 1, 'request:text': 1, 'request:download': 1, 'request:failed': 1,
    'address:file': 1, 'event:text': 1, 'vitrine:download': 1, 'address:failed': 1 });
});

await t('accès : registre réservé à l’équipe ; état Meta réservé au droit « settings », valeur contrôlée, journalisé', async () => {
  await ko('fiila_bo_wa', {}, null, CLI);
  await ko('fiila_bo_wa', {});
  await ok('fiila_bo_wa', {}, SUP);
  await ko('fiila_bo_wa_status', { p_id: 'fiila_address_request_v1', p_meta: 'SUBMITTED' }, null, SUP);
  await ko('fiila_bo_wa_status', { p_id: 'fiila_address_request_v1', p_meta: 'ENVOYÉ' }, 'invalid', F);
  await ko('fiila_bo_wa_status', { p_id: 'inconnu', p_meta: 'SUBMITTED' }, 'not_found', F);
  assert.equal((await ok('fiila_bo_wa_status', { p_id: 'fiila_address_request_v1', p_meta: 'SUBMITTED' }, F)).changed, true);
  assert.equal((await ok('fiila_bo_wa_status', { p_id: 'fiila_address_request_v1', p_meta: 'SUBMITTED' }, F)).changed, false, 'idempotent');
  const log = await one(`select count(*)::int n from fiila.admin_log where action = 'wa_template_status' and target_id = 'fiila_address_request_v1'`);
  assert.equal(log.n, 1);
  await ok('fiila_bo_wa_status', { p_id: 'fiila_address_request_v1', p_meta: 'NOT_SUBMITTED' }, F);
});

await t('réglage wa_card_media : borné 0/1, listé dans les réglages, lu par l’application', async () => {
  assert.equal((await ok('fiila_app_flags', {})).wa_card, true);
  const s = await ok('fiila_bo_settings', {}, F);
  assert.ok(JSON.stringify(s).includes('wa_card_media'));
  await ko('fiila_bo_setting_set', { p_key: 'wa_card_media', p_value: 2 }, null, F);
  await ok('fiila_bo_setting_set', { p_key: 'wa_card_media', p_value: 0 }, F);
  assert.equal((await ok('fiila_app_flags', {})).wa_card, false);
  assert.equal((await ok('fiila_bo_wa', {}, F)).media_on, false);
  await ok('fiila_bo_setting_set', { p_key: 'wa_card_media', p_value: 1 }, F);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL cartes WhatsApp réussis`);
process.exit(passed === results.length ? 0 : 1);
