// Domaines (mandat du 24/10/2026, docs/PLAN-DOMAINES-FII.md) dans un vrai navigateur :
//   - site d'une boutique sur son propre domaine (le vrai Worker, devant le serveur de test) : vitrine seule, nom de la
//     boutique, pas de marque Fii ni de service worker ; gestion renvoyée vers le domaine principal ; autre vitrine refusée ;
//   - domaine inconnu (Worker) et hôte non autorisé (garde de l'application) : « Site introuvable » ;
//   - changement de domaine principal : fiches et clé de boutique transmises d'une origine à l'autre par message direct ;
//     jamais dans l'adresse ; la session n'est pas transmise ; une ouverture sans l'ancienne fenêtre ne reçoit rien ;
//   - « Mon domaine » (boutique Premium) et la page Domaines du back-office.
// Les origines sont de vrais serveurs locaux distincts (ports différents) ; le nom d'hôte vu par le Worker est simulé.
import { createRequire } from 'node:module';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';
import { handle } from '../worker/index.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/domaines';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
let failed = 0, passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

// Origine de test : relaie la base et l'authentification au serveur de test ; sert soit le Worker (host), soit
// l'application telle quelle ; config.js remplacé si demandé (adresse principale, hôtes autorisés, transfert).
const servers = [];
async function origin({ host = null, config = null } = {}) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = null;
    if (req.method === 'POST') { body = ''; for await (const c of req) body += c; }
    const send = async (r) => {
      const h = {}; r.headers.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding)$/.test(k)) h[k] = v; });
      res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
    };
    if (config && u.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end('window.FIILA_CONFIG=' + JSON.stringify({ supabaseUrl: 'http://' + req.headers.host, supabaseKey: 'local-test-key', publicUrl: '', ...config }) + ';');
    }
    const relay = () => fetch(URL0 + u.pathname.slice(1) + u.search, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', authorization: req.headers.authorization || '' }, body });
    if (!host || /^\/(rest|auth|functions)\/v1\//.test(u.pathname)) return send(await relay());
    const env = { FII_HOSTS: 'fii.app', CANONICAL_HOST: 'fii.app', SHOP_ZONE: 'fii.shop', SUPABASE_URL: URL0, SUPABASE_ANON_KEY: 'local-test-key',
      ASSETS: { fetch: (r) => fetch(URL0 + new URL(r.url).pathname.slice(1)) } };
    return send(await handle(new Request('https://' + host + u.pathname + u.search), env, { cache: null }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
async function newPhone(init) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR' });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  return page;
}
const ok = async (fn, args, opt) => { const r = await rpc(local.db, fn, args, opt); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });

// Boutique Premium en ligne, avec un article ; son domaine est actif (résultat Cloudflare simulé, clé de service).
const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Maison Awa (test)', business_type: 'mode', phone: '771000001' } });
const KEY = S.key;
await local.db.query(`update fiila.shops set plan = 'premium' where id = $1`, [S.shop.id]);
const SLUG = (await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true } })).slug;
await ok('fiila_product_save', { p_key: KEY, p: { name: 'Robe wax (test)', price: 15000 } });
const OTHER = (await ok('fiila_shop_vitrine', { p_key: (await ok('fiila_shop_save', { p_key: null, p: { name: 'Autre (test)', business_type: 'mode' } })).key, p: { public: true } })).slug;
const D1 = await ok('fiila_domain_add', { p_key: KEY, p_host: 'www.maison-awa.sn' });
await ok('fiila_domain_cf_update', { p_id: D1.id, p: { cf_id: 'cf-1', cf_status: 'active', ssl_status: 'active' } }, { role: 'service_role' });

const SITE = await origin({ host: 'www.maison-awa.sn', config: { publicUrl: URL0 } });
const UNKNOWN = await origin({ host: 'inconnu.sn' });

await t('domaine de boutique : la vitrine seule, au nom de la boutique, sans marque Fii ni service worker', async () => {
  const p = await newPhone();
  await p.goto(SITE + '/');
  await p.waitForURL(new RegExp('#/b/' + SLUG + '$'));
  await p.getByText('Robe wax (test)').first().waitFor();
  assert.equal(await p.title(), 'Maison Awa (test)');
  assert.equal(await p.locator('.brandbar .brand, header .brand-logo').count(), 0, 'pas de logo Fii');
  assert.equal(await p.evaluate(() => navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0), 0);
  assert.equal(await p.locator('link[rel="manifest"]').count(), 0);
  await shot(p, 'site-boutique');
  // une autre vitrine ou l'accueil : retour à la sienne
  await p.goto(SITE + '/#/b/' + OTHER); await p.waitForURL(new RegExp('#/b/' + SLUG + '$'));
  await p.goto(SITE + '/#/r/ABCDEF'); await p.waitForURL(new RegExp('#/b/' + SLUG + '$'));
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('domaine de boutique : la gestion part vers le domaine principal, au même écran', async () => {
  const p = await newPhone();
  await p.goto(SITE + '/#/boutique');
  await p.waitForURL((u) => u.href.startsWith(URL0) && u.hash === '#/boutique');
  await p.context().close();
});

await t('domaine inconnu (Worker) : « Site introuvable » sans l’application ; hôte non autorisé (application) : idem', async () => {
  const p = await newPhone();
  const r = await p.goto(UNKNOWN + '/');
  assert.equal(r.status(), 404);
  await p.getByRole('heading', { name: 'Site introuvable' }).waitFor();
  assert.equal(await p.locator('script[src*="app.js"]').count(), 0);
  const guarded = await origin({ config: { appHosts: ['fii.app'] } });
  await p.goto(guarded + '/#/boutique');
  await p.locator('#app').getByText('Site introuvable').waitFor();
  assert.equal(await p.locator('#shop-name').count(), 0);
  await p.context().close();
});

// Changement de domaine principal : OLD (ancienne adresse, movedTo) → NEW (legacyOrigins = [OLD]).
const cfgNew = {};
const NEW2 = await origin({ config: cfgNew });
const OLD2 = await origin({ config: { movedTo: NEW2 + '/' } });
cfgNew.legacyOrigins = [OLD2];
const seed = { fn: ({ old, key }) => {
  if (location.origin === old && !localStorage.getItem('fiila.seeded')) {
    localStorage.setItem('fiila.seeded', '1');
    localStorage.setItem('fiila.shop', JSON.stringify({ key, name: 'Maison Awa (test)' }));
    localStorage.setItem('fiila.owned', JSON.stringify([{ type: 'order', id: 'o-1', token: 't-1' }]));
    localStorage.setItem('fiila.session', JSON.stringify({ access_token: 'ne-doit-pas-partir' }));
  }
}, arg: { old: OLD2, key: KEY } };

await t('transfert : un bouton, données passées par message direct (jamais dans l’adresse), session non transmise', async () => {
  const p = await newPhone(seed);
  const urls = []; p.context().on('request', (r) => urls.push(r.url()));
  await p.goto(OLD2 + '/#/boutique');
  await p.locator('#move-go').waitFor();
  await shot(p, 'transfert');
  const [pop] = await Promise.all([p.context().waitForEvent('page'), p.click('#move-go')]);
  await p.waitForURL((u) => u.href.startsWith(NEW2) && u.hash === '#/boutique', { timeout: 20000 });
  await pop.waitForEvent('close', { timeout: 5000 }).catch(() => {});
  const got = await p.evaluate(() => ({ shop: localStorage.getItem('fiila.shop'), owned: localStorage.getItem('fiila.owned'), session: localStorage.getItem('fiila.session') }));
  assert.equal(JSON.parse(got.shop).key, KEY);
  assert.equal(JSON.parse(got.owned)[0].id, 'o-1');
  assert.equal(got.session, null, 'la session de connexion ne part pas');
  assert.ok(!urls.some((u) => u.includes(KEY)), 'la clé n’apparaît dans aucune adresse');
  await p.locator('#shop-title').waitFor();
  // retour sur l'ancienne adresse : renvoi direct, rien n'a été effacé là-bas
  await p.goto(OLD2 + '/#/');
  await p.waitForURL((u) => u.href.startsWith(NEW2));
  await p.context().close();
});

await t('transfert : écran d’arrivée ouvert seul (sans l’ancienne fenêtre) → rien reçu ; origine non autorisée ignorée', async () => {
  const p = await newPhone();
  await p.goto(NEW2 + '/#/migrer');
  await p.getByText('Rien à transférer').waitFor();
  // une fenêtre d'une origine non autorisée ouvre l'écran d'arrivée et lui envoie des données : ignorées
  const evil = await origin({ config: {} });
  await p.goto(evil + '/#/');
  const [pop] = await Promise.all([p.context().waitForEvent('page'), p.evaluate((u) => { window.__w = window.open(u + '/#/migrer'); }, NEW2)]);
  await pop.locator('#migrate').waitFor();
  await p.evaluate((k) => window.__w.postMessage({ type: 'fii-migrate', data: { 'fiila.shop': JSON.stringify({ key: k }) } }, '*'), 'cle-piratee');
  await pop.waitForTimeout(500);
  assert.equal(await pop.evaluate(() => localStorage.getItem('fiila.shop')), null);
  await pop.locator('#migrate').getByText('Transfert de vos fiches').waitFor();
  await p.context().close();
});

await t('Mon domaine : enregistrements affichés tels que renvoyés, copier, vérifier, déconnecter', async () => {
  const D2 = await ok('fiila_domain_add', { p_key: KEY, p_host: 'maison-awa.sn' });
  await ok('fiila_domain_cf_update', { p_id: D2.id, p: { cf_id: 'cf-2', cf_status: 'pending', ssl_status: 'pending_validation', records: [
    { type: 'CNAME', name: 'maison-awa.sn', value: 'sites.fii.shop', purpose: 'route' },
    { type: 'TXT', name: '_cf-custom-hostname.maison-awa.sn', value: 'verif-123', purpose: 'ownership' }] } }, { role: 'service_role' });
  const p = await newPhone({ fn: (k) => { if (!localStorage.getItem('fiila.shop')) localStorage.setItem('fiila.shop', JSON.stringify({ key: k })); }, arg: KEY });
  await p.goto(URL0 + '#/boutique/reglages');
  await p.click('#vitrine-domain');
  await p.locator('#domain-' + D2.id).waitFor();
  const card = p.locator('#domain-' + D2.id);
  assert.match(await card.locator('#domain-status').textContent(), /Vérification/);
  assert.equal(await card.locator('#domain-recs tbody tr').count(), 2);
  assert.match(await card.textContent(), /verif-123/);
  assert.match(await card.textContent(), /CNAME à la racine/, 'domaine nu : limite expliquée');
  assert.match(await p.locator('#domain-' + D1.id).textContent(), /Actif/);
  assert.equal(await p.locator('#domain-form').count(), 0, 'deux domaines : pas de troisième');
  await shot(p, 'mon-domaine');
  await card.locator('#domain-remove').click();
  await p.locator('#domain-form').waitFor();
  assert.equal(await p.locator('#domain-' + D2.id).count(), 0);
  assert.equal((await local.db.query(`select status from fiila.shop_domains where id = $1`, [D2.id])).rows[0].status, 'disconnected');
  await p.fill('#domain-in', 'awa.github.io');
  await p.click('#domain-add');
  await p.getByRole('alert').getByText(/domaine/i).waitFor();
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('boutique gratuite : « Mon domaine » montre le Premium, sans formulaire', async () => {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Gratuite (test)', business_type: 'mode' } });
  const p = await newPhone({ fn: (k) => { if (!localStorage.getItem('fiila.shop')) localStorage.setItem('fiila.shop', JSON.stringify({ key: k })); }, arg: s.key });
  await p.goto(URL0 + '#/boutique/domaine');
  await p.locator('#domain-premium').waitFor();
  assert.equal(await p.locator('#domain-in').count(), 0);
  await p.context().close();
});

await t('zone des sites en service : lien partagé <lien>.fii.shop ; sans domaines en service, pas de ligne « Mon domaine »', async () => {
  const live = await origin({ config: { shopZone: 'fii.shop' } });
  const p = await newPhone({ fn: (k) => { if (!localStorage.getItem('fiila.shop')) localStorage.setItem('fiila.shop', JSON.stringify({ key: k })); }, arg: KEY });
  await p.goto(live + '/#/boutique/reglages');
  await p.locator('#vitrine-url').waitFor();
  assert.equal((await p.locator('#vitrine-url').textContent()).trim(), 'https://' + SLUG + '.fii.shop/#/b/' + SLUG);
  assert.equal(await p.locator('#vitrine-domain').count(), 0);
  await p.context().close();
});

await local.db.query(`delete from fiila.shop_domains`);
for (const s of servers) s.close();
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests domaines réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
