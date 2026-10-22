// Fonction fiila-media-sync : dépôt dans le seau (chemin à empreinte, cache d'un an), adresse enregistrée, échec journalisé
// sans bloquer les autres, orphelines retirées, refus hors POST. Supabase est simulé (aucun appel réel, aucune clé réelle).
import assert from 'node:assert/strict';
import { makeHandler, pathFor, decode } from '../supabase/functions/fiila-media-sync/handler.mjs';

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
const ID = '2f6bd807-a43e-412f-ac96-24b5c6b51518', H = 'd5c881e6e40fefe3cbe7878f30de64a5';
function sim({ pending = [], orphans = [], uploadStatus = () => 200, deleteStatus = 200 }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/storage/v1/object/')) {
      if (init.method === 'DELETE') return new Response('[]', { status: deleteStatus });
      return new Response('{}', { status: uploadStatus(url) });
    }
    const fn = url.split('/rpc/')[1];
    if (fn === 'fiila_media_pending') return new Response(JSON.stringify(pending), { status: 200 });
    if (fn === 'fiila_media_orphans') return new Response(JSON.stringify(orphans), { status: 200 });
    if (fn === 'fiila_media_forget') return new Response(JSON.stringify({ ok: true, removed: JSON.parse(init.body).p_paths.length }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, linked: true }), { status: 200 });
  };
  return { fetch, calls, rpcs: (name) => calls.filter((c) => c.url.endsWith('/rpc/' + name)).map((c) => JSON.parse(c.init.body)) };
}
const post = () => new Request('https://x/functions/v1/fiila-media-sync', { method: 'POST', body: '{}' });
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
  assert.deepEqual(await r.json(), { ok: true, copied: 1, failed: 0, removed: 0 });
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
  assert.deepEqual(await r.json(), { ok: true, copied: 1, failed: 1, removed: 0 });
  assert.equal(s.rpcs('fiila_media_done').length, 1);
  const fail = s.rpcs('fiila_media_report').find((x) => x.p_action === 'failed');
  assert.match(fail.p_detail, /stockage 500/); assert.equal(fail.p_ref, 'product:' + ID);
});

await t('orphelines : supprimées du seau puis oubliées ; refus de suppression journalisé', async () => {
  let s = sim({ orphans: [`p/${ID}-${H}.jpg`] });
  let r = await makeHandler({ env, fetch: s.fetch })(post());
  assert.deepEqual(await r.json(), { ok: true, copied: 0, failed: 0, removed: 1 });
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
  assert.deepEqual(await r.json(), { ok: true, copied: 0, failed: 0, removed: 0 });
  assert.deepEqual(s.rpcs('fiila_media_report'), [{ p_action: 'run', p_ref: null, p_detail: null }]);
  assert.equal((await makeHandler({ env, fetch: s.fetch })(new Request('https://x/', { method: 'GET' }))).status, 405);
  assert.equal((await makeHandler({ env: () => undefined, fetch: s.fetch })(post())).status, 500);
});

console.log(`\n${passed}/${passed + failed} tests fonction de copie des photos réussis`);
process.exit(failed ? 1 : 0);
