// Tests SQL : repère vocal (enregistrement par le propriétaire, écoute par le lien de la fiche ou de la course).
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
const ko = async (fn, args, code) => {
  const r = await rpc(db, fn, args);
  assert.equal(r.status, 400, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(3000, 7)]).toString('base64');
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(3000, 3)]).toString('base64');
const P = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez Awa [TEST]', entry: { lat: 14.72, lng: -17.48 }, vehicle_ok: true, instruction: 'Portail vert [TEST]' } });

await t('sans repère vocal : la fiche ne signale rien, l’écoute répond « introuvable »', async () => {
  const pub = await ok('fiila_get_public', { p_token: P.share_token });
  assert.equal(pub.place.has_voice, undefined);
  assert.equal((await ok('fiila_voice', { p_token: P.share_token, p_via: 'share' })).state, 'not_found');
});

await t('enregistrement par le propriétaire (webm), la fiche dit qu’il existe sans le charger', async () => {
  await ko('fiila_voice_set', { p_id: P.id, p_owner: 'pas-la-cle', p_voice: webm, p_secs: 12 }, 'not_found');
  const r = await ok('fiila_voice_set', { p_id: P.id, p_owner: P.owner_token, p_voice: webm, p_secs: 12 });
  assert.deepEqual(r, { has_voice: true, voice_secs: 12 });
  const pub = await ok('fiila_get_public', { p_token: P.share_token });
  assert.equal(pub.place.has_voice, true); assert.equal(pub.place.voice_secs, 12);
  assert.ok(!JSON.stringify(pub).includes('audio/'), 'l’audio n’est pas dans la fiche');
  const v = await ok('fiila_voice', { p_token: P.share_token, p_via: 'share' });
  assert.equal(v.state, 'ok'); assert.match(v.voice, /^data:audio\/webm;base64,GkXfo/); assert.equal(v.secs, 12);
});

await t('format reconnu par sa signature (mp4 d’iPhone accepté, faux fichier refusé), taille et durée bornées', async () => {
  await ok('fiila_voice_set', { p_id: P.id, p_owner: P.owner_token, p_voice: mp4, p_secs: 99 });
  const v = await ok('fiila_voice', { p_token: P.share_token, p_via: 'share' });
  assert.match(v.voice, /^data:audio\/mp4;/); assert.equal(v.secs, 30);
  await ko('fiila_voice_set', { p_id: P.id, p_owner: P.owner_token, p_voice: Buffer.from('<script>alert(1)</script>'.repeat(20)).toString('base64'), p_secs: 5 }, 'voice_invalid');
  await ko('fiila_voice_set', { p_id: P.id, p_owner: P.owner_token, p_voice: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(420000)]).toString('base64'), p_secs: 5 }, 'voice_too_large');
  await ko('fiila_voice_set', { p_id: P.id, p_owner: P.owner_token, p_voice: '%%%pas du base64', p_secs: 5 }, 'voice_invalid');
});

await t('livreur : écoute avec le lien de sa course ; jeton inconnu refusé', async () => {
  const d = await ok('fiila_start_delivery', { p_kind: 'place', p_id: P.id, p_owner: P.owner_token });
  const v = await ok('fiila_voice', { p_token: d.courier_token, p_via: 'course' });
  assert.equal(v.state, 'ok');
  const cv = await ok('fiila_courier_view', { p_token: d.courier_token });
  assert.equal(cv.place.has_voice, true);
  assert.equal((await ok('fiila_voice', { p_token: 'x'.repeat(22), p_via: 'course' })).state, 'not_found');
});

await t('lien désactivé : plus d’écoute ; retrait du repère par le propriétaire', async () => {
  const P2 = await ok('fiila_create_place', { p: { kind: 'address', label: 'Autre [TEST]', entry: { lat: 14.7, lng: -17.4 }, vehicle_ok: true, instruction: 'Porte [TEST]' } });
  await ok('fiila_voice_set', { p_id: P2.id, p_owner: P2.owner_token, p_voice: webm, p_secs: 4 });
  await ok('fiila_revoke_place', { p_id: P2.id, p_owner: P2.owner_token });
  assert.equal((await ok('fiila_voice', { p_token: P2.share_token, p_via: 'share' })).state, 'not_found');
  assert.deepEqual(await ok('fiila_voice_set', { p_id: P.id, p_owner: P.owner_token, p_voice: '', p_secs: 0 }), { has_voice: false });
  assert.equal((await ok('fiila_get_public', { p_token: P.share_token })).place.has_voice, undefined);
});

await t('« Mes adresses » : le lien de partage revient pour « Envoyer » et « Copier »', async () => {
  const rows = await ok('fiila_owned_summaries', { p_items: [{ type: 'place', id: P.id, owner: P.owner_token }] });
  assert.equal(rows[0].share_token, P.share_token);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL repère vocal réussis`);
process.exit(passed === results.length ? 0 : 1);
