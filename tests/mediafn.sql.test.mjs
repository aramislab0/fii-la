// Fonction fiila-media-sync : dépôt dans le seau (chemin à empreinte, cache d'un an), adresse enregistrée, échec journalisé
// sans bloquer les autres, orphelines retirées, refus hors POST, appel réservé à pg_cron (x-sync-token) ou à l'équipe connectée,
// CORS limité aux origines de Fii. Supabase est simulé (aucun appel réel, aucune clé réelle).
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { makeHandler, pathFor, decode, thumbPathFor, sha256hex } from '../supabase/functions/fiila-media-sync/handler.mjs';
import { makeThumb, shrink } from '../supabase/functions/fiila-media-sync/thumb.mjs';

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
const ID = '2f6bd807-a43e-412f-ac96-24b5c6b51518', H = 'd5c881e6e40fefe3cbe7878f30de64a5';
function sim({ pending = [], orphans = [], uploadStatus = () => 200, deleteStatus = 200, me = null, thumbs = [], purges = [], studioOld = [], source = () => null }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/storage/v1/object/public/')) { const b = source(url); return b ? new Response(b, { status: 200 }) : new Response('absent', { status: 404 }); }
    if (url.includes('/storage/v1/object/')) {
      if (init.method === 'DELETE') return new Response('[]', { status: deleteStatus });
      return new Response('{}', { status: uploadStatus(url) });
    }
    const fn = url.split('/rpc/')[1];
    if (fn === 'fiila_media_sync_auth') return new Response(JSON.stringify(JSON.parse(init.body).p_token === 'sync-test'), { status: 200 });
    if (fn === 'fiila_bo_me') return new Response(JSON.stringify(me), { status: 200 });
    if (fn === 'fiila_media_pending') return new Response(JSON.stringify(pending), { status: 200 });
    if (fn === 'fiila_media_thumbs_pending') return new Response(JSON.stringify(thumbs), { status: 200 });
    if (fn === 'fiila_media_purge_pending') return new Response(JSON.stringify(purges), { status: 200 });
    if (fn === 'fiila_studio_purgeable') return new Response(JSON.stringify(studioOld), { status: 200 });
    if (fn === 'fiila_studio_forget') return new Response(JSON.stringify({ ok: true, forgotten: JSON.parse(init.body).p_paths.length }), { status: 200 });
    if (fn === 'fiila_media_purged') return new Response(JSON.stringify({ ok: true, purged: true }), { status: 200 });
    if (fn === 'fiila_media_orphans') return new Response(JSON.stringify(orphans), { status: 200 });
    if (fn === 'fiila_media_forget') return new Response(JSON.stringify({ ok: true, removed: JSON.parse(init.body).p_paths.length }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, linked: true }), { status: 200 });
  };
  return { fetch, calls, rpcs: (name) => calls.filter((c) => c.url.endsWith('/rpc/' + name)).map((c) => JSON.parse(c.init.body)) };
}
const post = (headers = { 'x-sync-token': 'sync-test' }) => new Request('https://x/functions/v1/fiila-media-sync', { method: 'POST', body: '{}', headers });
const env = (k) => ENV[k];
const B64 = Buffer.from('photo de test').toString('base64');

await t('chemins : empreinte du contenu dans l’adresse, extension selon le type', async () => {
  assert.equal(pathFor({ kind: 'product', ref: ID, hash: H, ctype: 'image/jpeg' }), `p/${ID}-${H}.jpg`);
  assert.equal(pathFor({ kind: 'product_extra', ref: ID + ':3', hash: H, ctype: 'image/webp' }), `p/${ID}-3-${H}.webp`);
  assert.equal(pathFor({ kind: 'cover', ref: ID, hash: H, ctype: 'image/png' }), `c/${ID}-${H}.png`);
  assert.equal(Buffer.from(decode(B64)).toString(), 'photo de test');
});

await t('copie : dépôt avec la clé de service, cache d’un an, puis adresse enregistrée ; compteurs', async () => {
  const s = sim({ pending: [{ kind: 'product', ref: ID, hash: H, ctype: 'image/jpeg', b64: B64 }] });
  const r = await makeHandler({ env, fetch: s.fetch })(post());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, copied: 1, purged: 0, failed: 0, removed: 0 });
  const up = s.calls.find((c) => c.url.includes('/storage/v1/object/media/'));
  assert.equal(up.url, `https://p.supabase.co/storage/v1/object/media/p/${ID}-${H}.jpg`);
  assert.equal(up.init.headers.Authorization, 'Bearer service-test');
  assert.equal(up.init.headers['cache-control'], 'max-age=31536000');
  assert.equal(up.init.headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(s.rpcs('fiila_media_done')[0], { p_kind: 'product', p_ref: ID, p_hash: H, p_path: `p/${ID}-${H}.jpg`, p_bytes: 13 });
  assert.equal(s.rpcs('fiila_media_report').at(-1).p_action, 'run');
});

await t('échec d’un dépôt : journalisé, les autres photos continuent, pas d’adresse enregistrée pour l’échec', async () => {
  const s = sim({ pending: [{ kind: 'product', ref: ID, hash: H, ctype: 'image/jpeg', b64: B64 }, { kind: 'cover', ref: ID, hash: H, ctype: 'image/png', b64: B64 }],
    uploadStatus: (url) => (url.includes('/p/') ? 500 : 200) });
  const r = await makeHandler({ env, fetch: s.fetch })(post());
  assert.deepEqual(await r.json(), { ok: true, copied: 1, purged: 0, failed: 1, removed: 0 });
  assert.equal(s.rpcs('fiila_media_done').length, 1);
  const fail = s.rpcs('fiila_media_report').find((x) => x.p_action === 'failed');
  assert.match(fail.p_detail, /stockage 500/); assert.equal(fail.p_ref, 'product:' + ID);
});

await t('orphelines : supprimées du seau puis oubliées ; refus de suppression journalisé', async () => {
  let s = sim({ orphans: [`p/${ID}-${H}.jpg`] });
  let r = await makeHandler({ env, fetch: s.fetch })(post());
  assert.deepEqual(await r.json(), { ok: true, copied: 0, purged: 0, failed: 0, removed: 1 });
  const del = s.calls.find((c) => c.init.method === 'DELETE');
  assert.deepEqual(JSON.parse(del.init.body), { prefixes: [`p/${ID}-${H}.jpg`] });
  s = sim({ orphans: [`p/${ID}-${H}.jpg`], deleteStatus: 403 });
  r = await makeHandler({ env, fetch: s.fetch })(post());
  assert.equal((await r.json()).removed, 0);
  assert.equal(s.rpcs('fiila_media_forget').length, 0);
});

await t('rien à faire : aucun dépôt, « dernière copie » mise à jour sans entrée au journal ; GET refusé ; non configurée', async () => {
  const s = sim({});
  const r = await makeHandler({ env, fetch: s.fetch })(post());
  assert.deepEqual(await r.json(), { ok: true, copied: 0, purged: 0, failed: 0, removed: 0 });
  assert.deepEqual(s.rpcs('fiila_media_report'), [{ p_action: 'run', p_ref: null, p_detail: null }]);
  assert.equal((await makeHandler({ env, fetch: s.fetch })(new Request('https://x/', { method: 'GET' }))).status, 405);
  assert.equal((await makeHandler({ env: () => undefined, fetch: s.fetch })(post())).status, 500);
});

await t('accès : sans jeton ni session → 401, rien n’est copié ; mauvais jeton de pg_cron → 401 ; jeton vérifié par la base avec la clé de service', async () => {
  for (const h of [{}, { 'x-sync-token': 'faux' }, { authorization: 'Bearer ' }]) {
    const s = sim({ pending: [{ kind: 'product', ref: ID, hash: H, ctype: 'image/jpeg', b64: B64 }] });
    const r = await makeHandler({ env, fetch: s.fetch })(post(h));
    assert.equal(r.status, 401, JSON.stringify(h)); assert.deepEqual(await r.json(), { error: 'unauthorized' });
    assert.equal(s.rpcs('fiila_media_pending').length, 0); assert.ok(!s.calls.some((c) => c.url.includes('/storage/')));
  }
  const s = sim({});
  await makeHandler({ env, fetch: s.fetch })(post());
  const a = s.calls.find((c) => c.url.endsWith('/rpc/fiila_media_sync_auth'));
  assert.equal(a.init.headers.Authorization, 'Bearer service-test'); assert.deepEqual(JSON.parse(a.init.body), { p_token: 'sync-test' });
});

await t('accès back-office : membre de l’équipe (session vérifiée par fiila_bo_me) → copie ; personne connectée hors équipe → 401', async () => {
  let s = sim({ me: { staff: true, perms: [] } });
  let r = await makeHandler({ env, fetch: s.fetch })(post({ authorization: 'Bearer jwt-staff' }));
  assert.equal(r.status, 200);
  const me = s.calls.find((c) => c.url.endsWith('/rpc/fiila_bo_me'));
  assert.equal(me.init.headers.Authorization, 'Bearer jwt-staff'); assert.equal(me.init.headers.apikey, 'anon-test');
  s = sim({ me: { staff: false } });
  r = await makeHandler({ env, fetch: s.fetch })(post({ authorization: 'Bearer jwt-client' }));
  assert.equal(r.status, 401); assert.equal(s.rpcs('fiila_media_pending').length, 0);
});

await t('CORS : origine de Fii renvoyée telle quelle, origine inconnue sans Access-Control-Allow-Origin', async () => {
  const h = makeHandler({ env, fetch: sim({}).fetch });
  const ok = await h(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://admin.getfii.app' } }));
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://admin.getfii.app');
  const no = await h(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(no.headers.get('access-control-allow-origin'), null);
  const sneaky = await h(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://getfii.app.evil.example' } }));
  assert.equal(sneaky.headers.get('access-control-allow-origin'), null);
});

// Photo de test synthétique : dégradé 1200 × 900 encodé en JPEG.
function sampleJpeg(w = 1200, hgt = 900) {
  const d = new Uint8Array(w * hgt * 4);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 4; d[k] = x % 256; d[k + 1] = y % 256; d[k + 2] = 128; d[k + 3] = 255; }
  return new Uint8Array(jpeg.encode({ data: d, width: w, height: hgt }, 85).data);
}

await t('miniature : 640 px au plus côté long, proportions gardées, JPEG lisible, bien plus légère ; petite photo réencodée sans agrandir', async () => {
  const big = sampleJpeg(), out = makeThumb(jpeg)(big);
  const im = jpeg.decode(out, { useTArray: true });
  assert.equal(im.width, 640); assert.equal(im.height, 480);
  assert.ok(out.length < big.length / 2, `${out.length} vs ${big.length}`);
  const small = jpeg.decode(makeThumb(jpeg)(sampleJpeg(300, 200)), { useTArray: true });
  assert.deepEqual([small.width, small.height], [300, 200]);
  // Moyenne de zone : un damier noir et blanc réduit de moitié donne un gris uniforme (pas de crénelage).
  const src = new Uint8Array(4 * 4 * 4).map((_, i) => ((Math.floor(i / 4) % 4 + Math.floor(i / 16)) % 2 ? 255 : 0));
  const half = shrink(src, 4, 4, 2, 2);
  for (let i = 0; i < 4; i++) assert.equal(half[i * 4], 128);
  assert.throws(() => makeThumb(jpeg)(new Uint8Array([1, 2, 3])));
});

await t('miniatures : lues depuis le seau public, déposées sous t/ (cache d’un an), adresse enregistrée ; compteur « thumbs »', async () => {
  const big = sampleJpeg();
  const s = sim({ thumbs: [{ ref: ID, src: `p/${ID}-${H}.jpg`, hash: H }], source: (u) => (u.endsWith(`/public/media/p/${ID}-${H}.jpg`) ? big : null) });
  const r = await makeHandler({ env, fetch: s.fetch, thumb: makeThumb(jpeg) })(post());
  assert.deepEqual(await r.json(), { ok: true, copied: 0, thumbs: 1, purged: 0, failed: 0, removed: 0 });
  assert.equal(thumbPathFor({ ref: ID, hash: H }), `t/${ID}-${H}.jpg`);
  const up = s.calls.find((c) => c.url.endsWith(`/storage/v1/object/media/t/${ID}-${H}.jpg`));
  assert.equal(up.init.headers['Content-Type'], 'image/jpeg'); assert.equal(up.init.headers['cache-control'], 'max-age=31536000');
  assert.equal(up.init.headers.Authorization, 'Bearer service-test');
  const done = s.rpcs('fiila_media_done')[0];
  assert.deepEqual({ ...done, p_bytes: 0 }, { p_kind: 'thumb', p_ref: ID, p_hash: H, p_path: `t/${ID}-${H}.jpg`, p_bytes: 0 });
  assert.equal(done.p_bytes, up.init.body.length);
  assert.match(s.rpcs('fiila_media_report').at(-1).p_detail, /1 miniature/);
});

await t('miniatures : photo absente du seau ou illisible → échec journalisé « thumb:<article> », rien d’enregistré, la suite continue', async () => {
  const ID2 = '3a6bd807-a43e-412f-ac96-24b5c6b51519';
  const s = sim({ thumbs: [{ ref: ID, src: `p/${ID}-${H}.jpg`, hash: H }, { ref: ID2, src: `p/${ID2}-${H}.jpg`, hash: H }],
    source: (u) => (u.includes(ID2) ? new Uint8Array([0xff, 0xd8, 0, 1]) : null) });
  const r = await makeHandler({ env, fetch: s.fetch, thumb: makeThumb(jpeg) })(post());
  assert.deepEqual(await r.json(), { ok: true, copied: 0, thumbs: 0, purged: 0, failed: 2, removed: 0 });
  const fails = s.rpcs('fiila_media_report').filter((x) => x.p_action === 'failed');
  assert.deepEqual(fails.map((f) => f.p_ref), ['thumb:' + ID, 'thumb:' + ID2]);
  assert.match(fails[0].p_detail, /lecture 404/);
  assert.equal(s.rpcs('fiila_media_done').length, 0);
});

await t('retrait de la base : seulement si le fichier publié a la même empreinte SHA-256 ; sinon journalisé, rien retiré', async () => {
  const good = Buffer.from('photo publiée'), bad = Buffer.from('autre contenu');
  const sha = await sha256hex(new Uint8Array(good));
  assert.equal(sha, (await import('node:crypto')).createHash('sha256').update(good).digest('hex'));
  const p1 = `p/${ID}-${H}.jpg`, p2 = `c/${ID}-${H}.png`;
  const s = sim({ purges: [{ kind: 'product', ref: ID, path: p1, sha }, { kind: 'cover', ref: ID, path: p2, sha }],
    source: (url) => (url.endsWith(p1) ? good : url.endsWith(p2) ? bad : null) });
  const r = await makeHandler({ env, fetch: s.fetch })(post());
  assert.deepEqual(await r.json(), { ok: true, copied: 0, purged: 1, failed: 1, removed: 0 });
  assert.ok(s.calls.some((c) => c.url === `https://p.supabase.co/storage/v1/object/public/media/${p1}`));
  assert.deepEqual(s.rpcs('fiila_media_purged'), [{ p_kind: 'product', p_ref: ID, p_path: p1, p_sha: sha }]);
  const fail = s.rpcs('fiila_media_report').find((x) => x.p_action === 'failed');
  assert.equal(fail.p_ref, 'purge:cover:' + ID); assert.match(fail.p_detail, /différent/);
  assert.match(s.rpcs('fiila_media_report').at(-1).p_detail, /1 retirée\(s\) de la base/);
  // Fichier absent du stockage : rien n'est retiré.
  const s2 = sim({ purges: [{ kind: 'product', ref: ID, path: p1, sha }] });
  assert.equal((await (await makeHandler({ env, fetch: s2.fetch })(post())).json()).purged, 0);
  assert.equal(s2.rpcs('fiila_media_purged').length, 0);
});

await t('Studio : copies des résultats de plus de 7 jours effacées du seau privé puis oubliées ; refus journalisé', async () => {
  const p = 's/2f6bd807-a43e-412f-ac96-24b5c6b51518.jpg';
  let s = sim({ studioOld: [p] });
  let r = await (await makeHandler({ env, fetch: s.fetch })(post())).json();
  assert.equal(r.removed, 1);
  const del = s.calls.find((c) => c.init.method === 'DELETE' && c.url.endsWith('/storage/v1/object/studio'));
  assert.deepEqual(JSON.parse(del.init.body), { prefixes: [p] }); assert.equal(del.init.headers.Authorization, 'Bearer service-test');
  assert.deepEqual(s.rpcs('fiila_studio_forget')[0], { p_paths: [p] });
  s = sim({ studioOld: [p], deleteStatus: 403 });
  r = await (await makeHandler({ env, fetch: s.fetch })(post())).json();
  assert.equal(r.removed, 0); assert.equal(s.rpcs('fiila_studio_forget').length, 0);
  assert.equal(s.rpcs('fiila_media_report').find((x) => x.p_action === 'failed').p_ref, 'studio');
});

console.log(`\n${passed}/${passed + failed} tests fonction de copie des photos réussis`);
process.exit(failed ? 1 : 0);
