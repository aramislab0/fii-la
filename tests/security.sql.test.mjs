// Tests SQL des correctifs de l'audit du 17/10/2026 (S3, S8, S10, S12, S13, S14).
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
  assert.equal(r.status, 400, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
const ipOf = async (headers) => (await db.query(`select set_config('request.headers', $1, false), fiila.client_ip() ip`, [JSON.stringify(headers)])).rows[0].ip;
const jpeg = (extra) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0'), Buffer.from(extra || ''), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]).toString('base64');
const addr = (extra) => ({ kind: 'address', label: 'Sécurité [TEST]', entry: { lat: 14.75, lng: -17.47 }, vehicle_ok: true, instruction: 'x', ...extra });

await t('S3 : IP = en-tête Cloudflare, sinon dernier saut de x-forwarded-for (jamais celui du client) ; IPv6 par /64', async () => {
  assert.equal(await ipOf({ 'cf-connecting-ip': '41.82.1.2', 'x-forwarded-for': '1.1.1.1, 41.82.1.2' }), '41.82.1.2');
  assert.equal(await ipOf({ 'x-forwarded-for': '6.6.6.6, 41.82.1.2' }), '41.82.1.2');
  assert.equal(await ipOf({ 'x-forwarded-for': '9.9.9.9, 41.82.1.2' }), '41.82.1.2', 'changer le premier saut ne change pas l’IP');
  assert.equal(await ipOf({ 'cf-connecting-ip': '2c0f:f0f8:1234:5678:aaaa:bbbb:cccc:dddd' }), '2c0f:f0f8:1234:5678::/64');
});

await t('S12 : photo avec métadonnées XMP refusée', async () => {
  await ko('fiila_create_place', { p: addr({ photo: jpeg('http://ns.adobe.com/xap/1.0/<x:xmpmeta GPS>') }) }, 'photo_metadata');
  await ok('fiila_create_place', { p: addr({ photo: jpeg() }) });
});

await t('S13 : caractères invisibles et d’inversion retirés des textes', async () => {
  const r = await ok('fiila_create_place', { p: addr({ label: 'Bou‮tique​ Awa⁦' }) });
  const g = await ok('fiila_get_public', { p_token: r.share_token });
  assert.equal(g.place.label, 'Boutique Awa');
});

await t('S8 : les lectures publiques ont une limite (3000/h par adresse IP)', async () => {
  const salt = (await db.query(`select value from fiila.settings where key = 'rate_salt'`)).rows[0].value;
  const bucket = (await db.query(`select encode(extensions.digest($1 || ':' || '198.51.100.9', 'sha256'), 'hex') b`, [salt])).rows[0].b;
  await db.query(`insert into fiila.rate_events (bucket, action) select $1, 'read' from generate_series(1, 3000)`, [bucket]);
  await ko('fiila_get_public', { p_token: 'x'.repeat(22) }, 'rate_limited', { ip: '198.51.100.9' });
  await ok('fiila_get_public', { p_token: 'x'.repeat(22) }, { ip: '198.51.100.10' });
});

await t('S10 : l’organisateur retire un invité ; 10 inscriptions par heure et par IP', async () => {
  const m = await ok('fiila_create_place', { p: { kind: 'meeting', label: 'RDV [TEST]', entry: { lat: 14.75, lng: -17.47 }, vehicle_ok: true,
    starts_at: new Date(Date.now() + 3600e3).toISOString(), expires_at: new Date(Date.now() + 7200e3).toISOString() } });
  const g = await ok('fiila_join_meeting', { p_share_token: m.share_token, p_name: 'Faux' }, { ip: '198.51.100.20' });
  await ok('fiila_meeting_guest_remove', { p_id: m.id, p_owner: m.owner_token, p_guest_id: g.id });
  assert.equal((await ok('fiila_meeting_guests', { p_id: m.id, p_owner: m.owner_token })).guests.length, 0);
  await ko('fiila_meeting_guest_remove', { p_id: m.id, p_owner: 'mauvaise-cle', p_guest_id: g.id }, 'not_found');
  for (let i = 0; i < 9; i++) await ok('fiila_join_meeting', { p_share_token: m.share_token, p_name: 'I' + i }, { ip: '198.51.100.21' });
  await ok('fiila_join_meeting', { p_share_token: m.share_token, p_name: 'I9' }, { ip: '198.51.100.21' });
  await ko('fiila_join_meeting', { p_share_token: m.share_token, p_name: 'I10' }, 'rate_limited', { ip: '198.51.100.21' });
});

await t('S7 + S14 : ménage espacé de 10 min ; commandes de plus de 24 mois effacées', async () => {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Vieille boutique [TEST]' } });
  const o = await ok('fiila_order_create', { p_key: s.key, p: { customer: { name: 'Ancien [TEST]' }, items: [{ label: 'x', qty: 1, price: 1 }] } });
  await db.query(`update fiila.orders set created_at = now() - interval '25 months' where id = $1`, [o.id]);
  await db.query(`update fiila.customers set updated_at = now() - interval '25 months'`);
  await db.query(`update fiila.settings set value = now()::text where key = 'housekeeping_at'`);
  await db.query(`select fiila.housekeeping()`);
  assert.equal((await db.query(`select count(*)::int n from fiila.orders where id = $1`, [o.id])).rows[0].n, 1, 'ménage pas encore dû');
  await db.query(`update fiila.settings set value = '1970-01-01T00:00:00Z' where key = 'housekeeping_at'`);
  await db.query(`select fiila.housekeeping()`);
  assert.equal((await db.query(`select count(*)::int n from fiila.orders where id = $1`, [o.id])).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from fiila.customers where name = 'Ancien [TEST]'`)).rows[0].n, 0);
});

for (const r of results) console.log(r.join(' | '));
console.log(`\n${passed}/${results.length} tests SQL sécurité réussis`);
process.exit(passed === results.length ? 0 : 1);
