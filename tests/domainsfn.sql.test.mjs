// Fonction fiila-domains (Cloudflare for SaaS) et Worker (domaines) : tests sans réseau. Supabase, Cloudflare et le cache
// du Worker sont simulés ; aucun jeton réel. docs/PLAN-DOMAINES-FII.md §3-§4.
import assert from 'node:assert/strict';
import { makeHandler, recordsOf, errorOf } from '../supabase/functions/fiila-domains/handler.mjs';
import { handle, mainIndex, siteIndex, resolveHost } from '../worker/index.mjs';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
const CF_ENV = { ...ENV, CF_API_TOKEN: 'cf-test', CF_ZONE_ID: 'zone1', CF_SAAS_TARGET: 'sites.fii.shop' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const DOM = { id: 'd1', hostname: 'www.maison-awa.sn', status: 'pending', by: 'shop' };
const CF_PENDING = { id: 'cf-1', hostname: 'www.maison-awa.sn', status: 'pending', ownership_verification: { type: 'txt', name: '_cf-custom-hostname.www.maison-awa.sn', value: 'abc' },
  ssl: { status: 'pending_validation', validation_records: [{ txt_name: '_acme-challenge.www.maison-awa.sn', txt_value: 'tok' }] } };
function sim({ target = DOM, cf = {} } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('api.cloudflare.com')) {
      const m = init.method || 'GET', k = m + ' ' + url.replace(/^.*\/zones\/zone1/, '');
      for (const [p, r] of Object.entries(cf)) if (k.startsWith(p)) return typeof r === 'function' ? r() : json(r.body, r.status || 200);
      return json({ success: false, errors: [{ message: 'non simulé ' + k }] }, 500);
    }
    const fn = url.split('/rpc/')[1];
    if (fn === 'fiila_domain_target') return target ? json(target) : json({ message: 'fiila:not_found' }, 400);
    if (fn === 'fiila_domain_cf_update') return json({ ...target, ...calls.at(-1).body.p, status: 'verifying' });
    return json({});
  };
  return { fetch, calls };
}
const req = (body, auth = 'Bearer anon-test') => new Request('https://x/functions/v1/fiila-domains', { method: 'POST', body: JSON.stringify(body), headers: auth ? { authorization: auth } : {} });

await t('fonction : sans session refusée ; action inconnue refusée ; domaine d’une autre boutique → 403', async () => {
  const s = sim({ target: null });
  const h = makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch });
  assert.equal((await h(req({ action: 'sync', id: 'd1' }, null))).status, 401);
  assert.equal((await h(req({ action: 'delete', id: 'd1' }))).status, 400);
  assert.equal((await h(req({ action: 'sync', id: 'd1', key: 'k' }))).status, 403);
  assert.ok(!s.calls.some((c) => c.url.includes('cloudflare')), 'rien n’est envoyé à Cloudflare');
});

await t('fonction : droit vérifié avec l’identité de la personne (pas la clé de service) ; sans secrets → configured:false', async () => {
  const s = sim();
  const r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'sync', id: 'd1', key: 'cle-boutique' }, 'Bearer jwt-user'));
  assert.equal(r.status, 200); assert.equal((await r.json()).configured, false);
  const c = s.calls.find((x) => x.url.endsWith('fiila_domain_target'));
  assert.equal(c.init.headers.Authorization, 'Bearer jwt-user'); assert.equal(c.init.headers.apikey, 'anon-test');
  assert.deepEqual(c.body, { p_key: 'cle-boutique', p_id: 'd1' });
  assert.ok(!s.calls.some((x) => x.url.includes('cloudflare') || x.url.endsWith('fiila_domain_cf_update')));
});

await t('fonction : crée le nom chez Cloudflare (validation HTTP, TLS 1.2), écrit le résultat avec la clé de service', async () => {
  const s = sim({ cf: { 'POST /custom_hostnames': { body: { success: true, result: CF_PENDING } } } });
  const r = await makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch })(req({ action: 'sync', id: 'd1', key: 'k' }));
  assert.equal(r.status, 200);
  const post = s.calls.find((c) => c.url.includes('cloudflare'));
  assert.equal(post.init.headers.Authorization, 'Bearer cf-test');
  assert.deepEqual(post.body, { hostname: 'www.maison-awa.sn', ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } });
  const up = s.calls.find((c) => c.url.endsWith('fiila_domain_cf_update'));
  assert.equal(up.init.headers.Authorization, 'Bearer service-test');
  assert.equal(up.body.p.cf_id, 'cf-1'); assert.equal(up.body.p.cf_status, 'pending'); assert.equal(up.body.p.ssl_status, 'pending_validation');
  assert.deepEqual(up.body.p.records.map((x) => x.purpose), ['route', 'ownership', 'certificate']);
  assert.equal(up.body.p.records[0].value, 'sites.fii.shop');
});

await t('fonction : nom déjà présent chez Cloudflare → reprise de l’entrée existante ; création refusée sans entrée → erreur lisible', async () => {
  let s = sim({ cf: { 'POST /custom_hostnames': { status: 409, body: { success: false, errors: [{ message: 'Duplicate' }] } },
    'GET /custom_hostnames?hostname=': { body: { success: true, result: [{ ...CF_PENDING, id: 'cf-old' }] } } } });
  await makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch })(req({ action: 'sync', id: 'd1', key: 'k' }));
  assert.equal(s.calls.find((c) => c.url.endsWith('fiila_domain_cf_update')).body.p.cf_id, 'cf-old');
  s = sim({ cf: { 'POST /custom_hostnames': { status: 400, body: { success: false, errors: [{ message: 'Hostname invalide' }] } },
    'GET /custom_hostnames?hostname=': { body: { success: true, result: [] } } } });
  await makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch })(req({ action: 'sync', id: 'd1', key: 'k' }));
  assert.equal(s.calls.find((c) => c.url.endsWith('fiila_domain_cf_update')).body.p.error, 'Hostname invalide');
});

await t('fonction : nom connu → relu (GET), pas recréé ; Cloudflare en panne → erreur lisible enregistrée', async () => {
  let s = sim({ target: { ...DOM, cf_id: 'cf-1', status: 'verifying' }, cf: { 'GET /custom_hostnames/cf-1': { body: { success: true, result: { ...CF_PENDING, status: 'active', ssl: { status: 'active' } } } } } });
  await makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch })(req({ action: 'sync', id: 'd1', key: 'k' }));
  assert.ok(!s.calls.some((c) => (c.init.method || 'GET') === 'POST' && c.url.includes('cloudflare')));
  const p = s.calls.find((c) => c.url.endsWith('fiila_domain_cf_update')).body.p;
  assert.equal(p.cf_status, 'active'); assert.equal(p.records.length, 1, 'une fois actif : seul le CNAME reste affiché');
  s = sim({ target: { ...DOM, cf_id: 'cf-1' }, cf: { 'GET /custom_hostnames/cf-1': { status: 503, body: {} } } });
  await makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch })(req({ action: 'sync', id: 'd1', key: 'k' }));
  assert.equal(s.calls.find((c) => c.url.endsWith('fiila_domain_cf_update')).body.p.error, 'Cloudflare indisponible (503)');
});

await t('fonction : nettoyage seulement d’un domaine clos ; un domaine vivant n’est jamais supprimé chez Cloudflare', async () => {
  let s = sim({ target: { ...DOM, status: 'active', cf_id: 'cf-1' }, cf: { 'DELETE /custom_hostnames/cf-1': { body: { success: true } } } });
  let r = await makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch })(req({ action: 'cleanup', id: 'd1', key: 'k' }));
  assert.equal(r.status, 409); assert.ok(!s.calls.some((c) => c.init.method === 'DELETE'));
  s = sim({ target: { ...DOM, status: 'disconnected', cf_id: 'cf-1' }, cf: { 'DELETE /custom_hostnames/cf-1': { body: { success: true } } } });
  r = await makeHandler({ env: (k) => CF_ENV[k], fetch: s.fetch })(req({ action: 'cleanup', id: 'd1', key: 'k' }));
  assert.equal(r.status, 200); assert.ok(s.calls.some((c) => c.init.method === 'DELETE'));
  r = await makeHandler({ env: (k) => CF_ENV[k], fetch: sim({ target: { ...DOM, status: 'expired' } }).fetch })(req({ action: 'sync', id: 'd1', key: 'k' }));
  assert.equal(r.status, 409, 'pas de synchronisation d’un domaine clos');
});

await t('enregistrements : seulement ceux renvoyés par Cloudflare ; erreurs regroupées', async () => {
  assert.deepEqual(recordsOf('a.sn', 't.app', null), [{ type: 'CNAME', name: 'a.sn', value: 't.app', purpose: 'route' }]);
  assert.equal(recordsOf('a.sn', 't.app', { ssl: { validation_records: [{ cname: 'x', cname_target: 'y' }, { emails: ['a@b'] }] } }).length, 2);
  assert.equal(errorOf({ verification_errors: ['CNAME absent'], ssl: { validation_errors: [{ message: 'CAA bloque' }] } }), 'CNAME absent ; CAA bloque');
  assert.equal(errorOf({}), null);
});

// ------------------------------------------------------------------ Worker
const HTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const WENV = { FII_HOSTS: 'fii.app', CANONICAL_HOST: 'fii.app', SHOP_ZONE: 'fii.shop', LEGACY_PREFIX: 'https://aramislab0.github.io/fii-la/', SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon-test',
  ASSETS: { fetch: async (r) => { const p = new URL(r.url).pathname; return p === '/index.html' ? new Response(HTML, { headers: { 'Content-Type': 'text/html' } }) : new Response('asset ' + p); } } };
const SITES = { 'www.maison-awa.sn': { slug: 'maison-awa', name: 'Maison <Awa> & Co' }, 'shop.binta.sn': { slug: 'binta', name: 'Binta' }, 'binta.fii.shop': { slug: 'binta', name: 'Binta' } };
function wsim({ down = false } = {}) {
  const calls = [], store = new Map();
  const cache = { match: async (k) => { const v = store.get(k.url); return v ? new Response(v) : undefined; }, put: async (k, r) => { store.set(k.url, await r.text()); } };
  const fetch = async (url, init) => {
    const h = JSON.parse(init.body).p_host; calls.push(h);
    if (down) return new Response('{}', { status: 503 });
    return json(SITES[h] ? { state: 'ok', ...SITES[h], host: h } : { state: 'unknown' });
  };
  return { deps: { fetch, cache }, calls, store };
}
const get = (u, d) => handle(new Request(u), WENV, d);

await t('Worker : domaine principal → l’application, aperçus vers l’adresse canonique ; www → redirection 301', async () => {
  const w = wsim();
  const r = await get('https://fii.app/', w.deps);
  const body = await r.text();
  assert.equal(r.status, 200); assert.ok(!body.includes('aramislab0.github.io'), 'ancienne adresse remplacée');
  assert.ok(!body.includes('fii-site'));
  assert.equal((await get('https://fii.app/app.js', w.deps)).status, 200);
  const red = await get('https://www.fii.app/x?y=1', w.deps);
  assert.equal(red.status, 301); assert.equal(red.headers.get('location'), 'https://fii.app/x?y=1');
  for (const z of ['https://fii.shop/', 'https://www.fii.shop/abc']) {
    const rz = await get(z, w.deps); assert.equal(rz.status, 301); assert.equal(rz.headers.get('location'), 'https://fii.app/');
  }
  assert.equal(w.calls.length, 0, 'le domaine principal ne consulte pas la base');
});

await t('Worker : domaine inconnu ou non vérifié → « Site introuvable » 404, sans l’application', async () => {
  const w = wsim();
  for (const u of ['https://inconnu.sn/', 'https://inconnu.sn/index.html', 'https://inconnu.sn/app.js', 'https://maison-awa.sn/']) {
    const r = await get(u, w.deps), b = await r.text();
    assert.equal(r.status, 404, u); assert.match(b, /Site introuvable/); assert.ok(!b.includes('app.js'));
  }
});

await t('Worker : domaine de boutique → page au nom de la boutique (échappé), sans marque Fii ni application installable', async () => {
  const w = wsim();
  const r = await get('https://www.maison-awa.sn/', w.deps), b = await r.text();
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(b, /<title>Maison &lt;Awa&gt; &amp; Co<\/title>/);
  assert.ok(!/<title>[^<]*Fii/.test(b)); assert.ok(!b.includes('rel="manifest"')); assert.ok(!b.includes('og:image'));
  const meta = JSON.parse(/<meta name="fii-site" content="([^"]+)">/.exec(b)[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.deepEqual(meta, { slug: 'maison-awa', name: 'Maison <Awa> & Co', host: 'www.maison-awa.sn' });
  assert.equal((await get('https://www.maison-awa.sn/sw.js', w.deps)).status, 404, 'pas de service worker');
  assert.match(await (await get('https://binta.fii.shop/', w.deps)).text(), /<title>Binta<\/title>/, 'adresse <lien>.fii.shop');
  assert.equal((await get('https://www.maison-awa.sn/manifest.webmanifest', w.deps)).status, 404);
  assert.equal(await (await get('https://www.maison-awa.sn/styles.css', w.deps)).text(), 'asset /styles.css');
});

await t('Worker : cache par nom d’hôte (aucun mélange entre boutiques) ; base indisponible → 503 non mis en cache', async () => {
  const w = wsim();
  const a = await (await get('https://www.maison-awa.sn/', w.deps)).text();
  const b = await (await get('https://shop.binta.sn/', w.deps)).text();
  await get('https://www.maison-awa.sn/', w.deps);
  assert.match(a, /"slug&quot;:&quot;maison-awa|maison-awa/); assert.ok(!a.includes('binta')); assert.ok(b.includes('binta') && !b.includes('maison-awa'));
  assert.deepEqual(w.calls, ['www.maison-awa.sn', 'shop.binta.sn'], 'la seconde visite vient du cache');
  const d = wsim({ down: true });
  assert.equal((await get('https://www.maison-awa.sn/', d.deps)).status, 503);
  assert.equal(d.store.size, 0);
  assert.deepEqual(await resolveHost('www.maison-awa.sn', WENV, { fetch: async () => json({ state: 'ok', slug: 'x', name: 'X', host: 'autre.sn' }), cache: null }), { state: 'unknown' }, 'hôte différent dans la réponse → refusé');
});

await t('Worker : remplacement de l’ancienne adresse et page de site pures (fonctions exportées)', async () => {
  assert.equal(mainIndex('<a href="https://aramislab0.github.io/fii-la/x">', WENV), '<a href="https://fii.app/x">');
  const s = siteIndex('<head><title>Fii</title></head>', { slug: 'a', name: 'A"B', host: 'a.sn' });
  assert.match(s, /<title>A&quot;B<\/title>/); assert.match(s, /og:url" content="https:\/\/a.sn\/"/);
});

console.log(`\n${passed}/${passed + failed} tests fonction domaines et Worker réussis`);
process.exit(failed ? 1 : 0);
