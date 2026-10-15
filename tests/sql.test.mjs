// Tests de l'API SQL (sécurité, validation, cycles de vie) sur un vrai Postgres local.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const ok = async (fn, args, opt) => {
  const r = await rpc(db, fn, args, opt);
  assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`);
  return r.body;
};
const ko = async (fn, args, code, opt) => {
  const r = await rpc(db, fn, args, opt);
  assert.equal(r.status, 400, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code), `${fn}: ${r.body.message}`);
  return r.body;
};

// JPEG minimal (seuls les marqueurs sont contrôlés côté serveur)
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0'), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);
const jpegExif = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 30]), Buffer.from('Exif\0\0'), Buffer.alloc(300, 7)]);
const b64 = (b) => b.toString('base64');

const base = {
  kind: 'address', label: 'Atelier test', locality: 'Yoff',
  entry: { lat: 14.75814, lng: -17.47032, acc: 12 },
  vehicle_ok: true, instruction: 'Porte verte après le manguier', photo: b64(jpeg),
};

let A; // adresse principale
await t('création d’une adresse : jetons distincts et longs', async () => {
  A = await ok('fiila_create_place', { p: base });
  assert.ok(A.id && A.share_token && A.owner_token);
  assert.ok(A.share_token.length >= 21 && A.owner_token.length >= 42);
  assert.notEqual(A.share_token, A.owner_token);
});

await t('vue publique : contenu présent, aucun identifiant ni jeton propriétaire', async () => {
  const r = await ok('fiila_get_public', { p_token: A.share_token });
  assert.equal(r.state, 'ok');
  assert.equal(r.place.label, 'Atelier test');
  assert.match(r.place.photo, /^data:image\/jpeg;base64,/);
  const s = JSON.stringify(r);
  for (const k of ['"id"', 'share_token', 'owner', 'status', 'entry_acc']) assert.ok(!s.includes(k), `fuite: ${k}`);
});

await t('le rôle anon ne peut pas lire les tables directement', async () => {
  await assert.rejects(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query('select * from fiila.places'); }));
  await assert.rejects(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query('select fiila.h($1)', ['x']); }));
});

await t('accès propriétaire refusé avec un mauvais jeton, un jeton de partage ou un id invalide', async () => {
  await ko('fiila_get_owned', { p_id: A.id, p_owner: 'mauvais' }, 'not_found');
  await ko('fiila_get_owned', { p_id: A.id, p_owner: A.share_token }, 'not_found');
  await ko('fiila_get_owned', { p_id: 'pas-un-uuid', p_owner: A.owner_token }, 'not_found');
  await ko('fiila_update_place', { p_id: A.id, p_owner: A.share_token, p: base }, 'not_found');
  await ko('fiila_delete_place', { p_id: A.id, p_owner: 'x' }, 'not_found');
  await ko('fiila_revoke_place', { p_id: A.id, p_owner: 'x' }, 'not_found');
});

await t('modification : même lien, contenu mis à jour, photo conservée si absente du message', async () => {
  const p = { ...base, instruction: 'Porte BLEUE maintenant' }; delete p.photo;
  const r = await ok('fiila_update_place', { p_id: A.id, p_owner: A.owner_token, p });
  assert.equal(r.share_token, A.share_token);
  const pub = await ok('fiila_get_public', { p_token: A.share_token });
  assert.equal(pub.place.instruction, 'Porte BLEUE maintenant');
  assert.ok(pub.place.photo, 'photo conservée');
});

await t('arrêt voiture distinct de l’entrée', async () => {
  const p = { ...base, vehicle_ok: false, stop: { lat: 14.7579, lng: -17.4698 }, walk: 'Ruelle à gauche, 40 m' };
  const r = await ok('fiila_create_place', { p });
  const pub = await ok('fiila_get_public', { p_token: r.share_token });
  assert.equal(pub.place.vehicle_ok, false);
  assert.deepEqual(pub.place.stop, { lat: 14.7579, lng: -17.4698 });
  assert.deepEqual(pub.place.entry, { lat: 14.75814, lng: -17.47032 });
  assert.equal(pub.place.walk, 'Ruelle à gauche, 40 m');
});

await t('arrêt voiture ignoré quand la voiture peut arriver', async () => {
  const r = await ok('fiila_create_place', { p: { ...base, vehicle_ok: true, stop: { lat: 14.7, lng: -17.4 }, walk: 'x' } });
  const pub = await ok('fiila_get_public', { p_token: r.share_token });
  assert.equal(pub.place.stop, undefined);
  assert.equal(pub.place.walk, undefined);
});

await t('validation des champs', async () => {
  await ko('fiila_create_place', { p: { ...base, label: '   ' } }, 'label_required');
  await ko('fiila_create_place', { p: { ...base, photo: null, instruction: '' } }, 'photo_or_instruction_required');
  await ko('fiila_create_place', { p: { ...base, entry: { lat: 120, lng: 0 } } }, 'point_invalid');
  await ko('fiila_create_place', { p: { ...base, entry: { lat: 0, lng: 0 } } }, 'point_invalid');
  await ko('fiila_create_place', { p: { ...base, entry: { lat: 'abc', lng: 1 } } }, 'invalid_number');
  await ko('fiila_create_place', { p: { ...base, entry: null } }, 'point_required');
  await ko('fiila_create_place', { p: { ...base, label: 'x'.repeat(61) } }, 'too_long');
  await ko('fiila_create_place', { p: { ...base, instruction: 'é'.repeat(281) } }, 'too_long');
  await ko('fiila_create_place', { p: { ...base, vehicle_ok: false } }, 'stop_required');
  await ko('fiila_create_place', { p: { ...base, kind: 'autre' } }, 'invalid_kind');
});

await t('photos refusées : pas une image, métadonnées EXIF, trop lourde, base64 invalide', async () => {
  await ko('fiila_create_place', { p: { ...base, photo: b64(Buffer.from('<script>alert(1)</script>'.repeat(10))) } }, 'photo_invalid');
  await ko('fiila_create_place', { p: { ...base, photo: b64(jpegExif) } }, 'photo_metadata');
  await ko('fiila_create_place', { p: { ...base, photo: b64(Buffer.concat([jpeg, Buffer.alloc(420000)])) } }, 'photo_too_large');
  await ko('fiila_create_place', { p: { ...base, photo: '%%%pas du base64%%%' } }, 'photo_invalid');
});

await t('accents et caractères de contrôle : accents gardés, contrôles retirés', async () => {
  const r = await ok('fiila_create_place', { p: { ...base, label: 'Chez Ndèye\u0007 « Ébène »', instruction: '<b>gras</b>\u0000? non' .replace('\u0000', '') } });
  const pub = await ok('fiila_get_public', { p_token: r.share_token });
  assert.equal(pub.place.label, 'Chez Ndèye « Ébène »');
  assert.equal(pub.place.instruction, '<b>gras</b>? non'); // stocké tel quel, échappé à l’affichage
});

await t('désactivation : la vue publique ne renvoie plus rien', async () => {
  await ok('fiila_revoke_place', { p_id: A.id, p_owner: A.owner_token });
  const pub = await ok('fiila_get_public', { p_token: A.share_token });
  assert.deepEqual(pub, { state: 'revoked' });
});

let A2;
await t('nouveau lien : l’ancien est « remplacé », le nouveau fonctionne', async () => {
  A2 = await ok('fiila_new_link', { p_id: A.id, p_owner: A.owner_token });
  assert.notEqual(A2.share_token, A.share_token);
  assert.deepEqual(await ok('fiila_get_public', { p_token: A.share_token }), { state: 'replaced' });
  assert.equal((await ok('fiila_get_public', { p_token: A2.share_token })).state, 'ok');
});

await t('jetons invalides : réponse sûre', async () => {
  for (const tok of ['', 'abc', "x' or 1=1 --", 'A'.repeat(200), '../../etc/passwd']) {
    const r = await ok('fiila_get_public', { p_token: tok });
    assert.equal(r.state, 'invalid');
  }
  assert.equal((await ok('fiila_get_public', { p_token: 'AAAAAAAAAAAAAAAAAAAAAA' })).state, 'not_found');
});

// ----- demandes
let R, B;
await t('demande d’adresse : création et vue publique sans adresse', async () => {
  R = await ok('fiila_create_request', { p: { requester_name: 'Boutique Ndèye', purpose: 'Livraison de votre commande', order_ref: 'CMD-1042' } });
  const pub = await ok('fiila_get_request_public', { p_token: R.share_token });
  assert.equal(pub.state, 'pending');
  assert.equal(pub.requester_name, 'Boutique Ndèye');
  assert.ok(!JSON.stringify(pub).includes('place'));
  await ko('fiila_create_request', { p: { requester_name: '', purpose: 'x' } }, 'name_required');
  await ko('fiila_create_request', { p: { requester_name: 'x', purpose: '' } }, 'purpose_required');
});

await t('réponse : impossible avec l’adresse de quelqu’un d’autre', async () => {
  B = await ok('fiila_create_place', { p: { ...base, label: 'Maison client' } });
  await ko('fiila_fulfill_request', { p_token: R.share_token, p_place_id: B.id, p_place_owner: 'faux' }, 'not_found');
  await ko('fiila_fulfill_request', { p_token: R.share_token, p_place_id: A.id, p_place_owner: B.owner_token }, 'not_found');
});

await t('réponse acceptée une seule fois', async () => {
  await ok('fiila_fulfill_request', { p_token: R.share_token, p_place_id: B.id, p_place_owner: B.owner_token });
  await ko('fiila_fulfill_request', { p_token: R.share_token, p_place_id: B.id, p_place_owner: B.owner_token }, 'already_fulfilled');
});

await t('le lien public de la demande ne révèle jamais la réponse', async () => {
  const pub = await ok('fiila_get_request_public', { p_token: R.share_token });
  assert.deepEqual(pub, { state: 'fulfilled', requester_name: 'Boutique Ndèye' });
});

await t('le demandeur récupère l’adresse avec son jeton privé uniquement', async () => {
  await ko('fiila_get_request_owner', { p_id: R.id, p_owner: R.share_token }, 'not_found');
  const own = await ok('fiila_get_request_owner', { p_id: R.id, p_owner: R.owner_token });
  assert.equal(own.state, 'fulfilled');
  assert.equal(own.place.label, 'Maison client');
});

await t('si le client désactive ou supprime son adresse, le demandeur ne la voit plus', async () => {
  await ok('fiila_revoke_place', { p_id: B.id, p_owner: B.owner_token });
  assert.equal((await ok('fiila_get_request_owner', { p_id: R.id, p_owner: R.owner_token })).state, 'place_revoked');
  await ok('fiila_delete_place', { p_id: B.id, p_owner: B.owner_token });
  const own = await ok('fiila_get_request_owner', { p_id: R.id, p_owner: R.owner_token });
  assert.equal(own.state, 'place_deleted');
  assert.equal(own.place, undefined);
});

await t('suppression : fiche et photo effacées de la base', async () => {
  const C = await ok('fiila_create_place', { p: base });
  await ok('fiila_delete_place', { p_id: C.id, p_owner: C.owner_token });
  assert.equal((await ok('fiila_get_public', { p_token: C.share_token })).state, 'not_found');
  const n = await db.query('select count(*)::int n from fiila.places where id = $1', [C.id]);
  assert.equal(n.rows[0].n, 0);
});

// ----- rendez-vous
let M;
await t('rendez-vous : création, mise à jour sur le même lien', async () => {
  const start = new Date(Date.now() + 3600e3).toISOString();
  const exp = new Date(Date.now() + 5 * 3600e3).toISOString();
  M = await ok('fiila_create_place', { p: { kind: 'meeting', label: 'Baptême', entry: base.entry, instruction: 'Tente blanche', starts_at: start, expires_at: exp } });
  await ok('fiila_update_place', { p_id: M.id, p_owner: M.owner_token, p: { label: 'Baptême', entry: base.entry, instruction: 'Tente bleue', starts_at: start, expires_at: exp } });
  const pub = await ok('fiila_get_public', { p_token: M.share_token });
  assert.equal(pub.place.instruction, 'Tente bleue');
  assert.equal(pub.place.kind, 'meeting');
});

await t('rendez-vous : dates contrôlées', async () => {
  const now = Date.now();
  const m = (s, e) => ({ kind: 'meeting', label: 'x', entry: base.entry, starts_at: new Date(now + s).toISOString(), expires_at: new Date(now + e).toISOString() });
  await ko('fiila_create_place', { p: m(3600e3, 1800e3) }, 'expiry_before_start');
  await ko('fiila_create_place', { p: m(-7200e3, -3600e3) }, 'expiry_in_past');
  await ko('fiila_create_place', { p: m(3600e3, 40 * 86400e3) }, 'expiry_too_far');
  await ko('fiila_create_place', { p: { kind: 'meeting', label: 'x', entry: base.entry } }, 'date_required');
});

await t('rendez-vous expiré : refusé par le serveur, aucun lieu renvoyé', async () => {
  await db.query(`update fiila.places set expires_at = now() - interval '1 minute' where id = $1`, [M.id]);
  const pub = await ok('fiila_get_public', { p_token: M.share_token });
  assert.deepEqual(pub, { state: 'expired' });
});

await t('résumés « Mes adresses » : seulement avec le bon jeton, sans photo', async () => {
  const s = await ok('fiila_owned_summaries', { p_items: [
    { type: 'place', id: A.id, owner: A.owner_token },
    { type: 'place', id: A.id, owner: 'faux' },
    { type: 'request', id: R.id, owner: R.owner_token },
    { type: 'place', id: M.id, owner: M.owner_token },
  ] });
  assert.equal(s[0].label, 'Atelier test');
  assert.equal(s[1].missing, true);
  assert.equal(s[2].state, 'fulfilled');
  assert.equal(s[3].expired, true);
  assert.ok(!JSON.stringify(s).includes('base64'));
});

await t('limite d’abus : 40 créations par heure et par IP', async () => {
  const ip = '198.51.100.9';
  let blocked = 0;
  for (let i = 0; i < 42; i++) {
    const r = await rpc(db, 'fiila_create_request', { p: { requester_name: 'x', purpose: 'y' } }, { ip });
    if (r.status === 400 && /rate_limited/.test(r.body.message)) blocked++;
  }
  assert.equal(blocked, 2);
  await ok('fiila_create_request', { p: { requester_name: 'x', purpose: 'y' } }, { ip: '198.51.100.10' });
});

await t('l’adresse IP n’est jamais stockée en clair', async () => {
  const r = await db.query(`select count(*)::int n from fiila.rate_events where bucket like '%198.51%'`);
  assert.equal(r.rows[0].n, 0);
});

await t('fonctions internes et inconnues inaccessibles', async () => {
  const r = await rpc(db, 'fiila_nope', {});
  assert.equal(r.status, 400);
});

for (const r of results) console.log(r.join(' | '));
console.log(`\n${passed}/${results.length} tests SQL réussis`);
process.exit(passed === results.length ? 0 : 1);
