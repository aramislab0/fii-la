// App mobile (Capacitor) : la même application, avec la coquille native simulée dans le navigateur (window.Capacitor et
// ses modules). Vérifie : démarrage et mesure par plateforme, stockage recopié et restauré, bouton retour Android,
// liens externes confiés au téléphone, liens https de Fii ouverts dans l'app, partage natif d'images,
// aucune incitation à acheter un abonnement dans l'app, pas d'invitation à installer. docs/PLAN-APP-MOBILE.md.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/app-mobile';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['Pixel 7'] || devices['iPhone 13'];
let failed = 0, passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };

// Coquille native simulée : modules Capacitor en mémoire, observables par le test.
function fakeNative({ platform, prefs }) {
  window.__prefs = Object.assign({}, prefs || {}); window.__listeners = {}; window.__shared = []; window.__files = []; window.__opened = []; window.__app = [];
  const P = (v) => Promise.resolve(v);
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => platform,
    Plugins: {
      Preferences: { keys: () => P({ keys: Object.keys(window.__prefs) }), get: (o) => P({ value: o.key in window.__prefs ? window.__prefs[o.key] : null }),
        set: (o) => { window.__prefs[o.key] = o.value; return P(); }, remove: (o) => { delete window.__prefs[o.key]; return P(); } },
      App: { addListener: (n, fn) => { window.__listeners[n] = fn; return P({ remove() {} }); }, exitApp: () => { window.__app.push('exit'); return P(); }, minimizeApp: () => { window.__app.push('minimize'); return P(); } },
      Share: { share: (o) => { window.__shared.push(o); return P({}); } },
      Filesystem: { writeFile: (o) => { window.__files.push({ path: o.path, dir: o.directory, size: o.data.length }); return P({ uri: 'file:///cache/' + o.path }); } },
      AppLauncher: { openUrl: (o) => { window.__opened.push(o.url); return P({ completed: true }); } },
      SplashScreen: { hide: () => { window.__app.push('splash-hidden'); return P(); } }
    }
  };
}
async function newApp({ platform = 'android', prefs = {}, local: ls = {} } = {}) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR' });
  await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `window.FIILA_CONFIG={supabaseUrl:location.origin,supabaseKey:'local-test-key',publicUrl:'https://fii.app/',serviceWorker:false,native:true};` }));
  await ctx.addInitScript(fakeNative, { platform, prefs });
  if (Object.keys(ls).length) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in x) localStorage.setItem(k, x[k]); } }, ls);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${ENGINE}-${n}.png`, fullPage: true });

const S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Mobile (test)', business_type: 'mode', phone: '771000002' } });
const A = await ok('fiila_product_save', { p_key: S.key, p: { name: 'Robe mobile (test)', price: 9000 } });
await local.db.query(`update fiila.products set photo = $2, photo_type = 'image/jpeg' where id = $1`, [A.id, readFileSync('tests/fixtures/article-4x5.jpg')]);
const SLUG = (await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true } })).slug;
const SHOP = JSON.stringify({ id: S.shop.id, key: S.key });

await t('démarrage Android : classe native, écran de démarrage masqué, ouverture comptée « android », pas d’invitation à installer', async () => {
  const p = await newApp();
  await p.goto(URL0 + '#/');
  await p.locator('#app h1, #app h2').first().waitFor();
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains('native-android')));
  await p.waitForFunction(() => window.__app.includes('splash-hidden'));
  assert.equal(await p.locator('#install-cta .install-cta, #install-app').count(), 0);
  await p.waitForTimeout(400);
  const n = (await local.db.query(`select coalesce(sum(n),0)::int n from fiila.metrics where event = 'app' and variant = 'android'`)).rows[0].n;
  assert.ok(n >= 1, 'ouverture comptée');
  await shot(p, '01-accueil');
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('stockage : la boutique revient depuis les préférences du téléphone si la WebView a été vidée ; écritures recopiées', async () => {
  const p = await newApp({ prefs: { 'fiila.shop': SHOP } });
  await p.goto(URL0 + '#/boutique');
  await p.locator('#shop-title').waitFor();
  assert.match(await p.locator('#shop-title').textContent(), /Boutique Mobile \(test\)/);
  assert.equal(await p.evaluate(() => localStorage.getItem('fiila.shop')), SHOP);
  await p.evaluate(() => localStorage.setItem('fiila.test', '"x"'));
  assert.equal(await p.evaluate(() => window.__prefs['fiila.test']), '"x"');
  await p.evaluate(() => localStorage.removeItem('fiila.test'));
  assert.equal(await p.evaluate(() => 'fiila.test' in window.__prefs), false);
  await p.evaluate(() => localStorage.setItem('autre.cle', '1'));
  assert.equal(await p.evaluate(() => 'autre.cle' in window.__prefs), false, 'seules les données de Fii sont recopiées');
  await p.context().close();
});

await t('bouton retour Android : écran précédent ; feuille ouverte → fermée ; à l’accueil → l’app passe en arrière-plan', async () => {
  const p = await newApp({ local: { 'fiila.shop': SHOP } });
  await p.goto(URL0 + '#/');
  await p.locator('#app h1, #app h2').first().waitFor();
  await p.evaluate(() => { location.hash = '#/boutique'; });
  await p.locator('#shop-title').waitFor();
  await p.evaluate(() => { location.hash = '#/boutique/reglages'; });
  await p.waitForFunction(() => location.hash === '#/boutique/reglages');
  await p.evaluate(() => window.__listeners.backButton());
  await p.waitForFunction(() => location.hash === '#/boutique');
  await p.locator('#shop-title').waitFor();
  // Feuille : Publier un article
  await p.goto(URL0 + '#/boutique/marketing'); await p.locator('#mk-strip').waitFor();
  await p.evaluate(() => { Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  await p.waitForFunction((id) => document.getElementById('mk-pub-' + id).classList.contains('ready'), A.id);
  await p.click('#pub-tiktok-' + A.id);
  await p.locator('#pub-sheet').waitFor();
  await p.evaluate(() => window.__listeners.backButton());
  await p.locator('#pub-sheet').waitFor({ state: 'detached' });
  assert.equal(await p.evaluate(() => location.hash), '#/boutique/marketing', 'la feuille se ferme, l’écran reste');
  await p.evaluate(() => { location.hash = '#/'; });
  await p.waitForFunction(() => location.hash === '#/');
  await p.evaluate(() => window.__listeners.backButton());
  assert.deepEqual(await p.evaluate(() => window.__app.filter((x) => x !== 'splash-hidden')), ['minimize']);
  await p.context().close();
});

await t('partage natif : image écrite dans le cache puis confiée au partage du téléphone (Instagram : image seule ; WhatsApp : image + texte)', async () => {
  const p = await newApp({ local: { 'fiila.shop': SHOP } });
  await p.goto(URL0 + '#/boutique/marketing'); await p.locator('#mk-strip').waitFor();
  await p.waitForFunction((id) => document.getElementById('mk-pub-' + id).classList.contains('ready'), A.id);
  await p.click('#pub-instagram-' + A.id);
  await p.getByText(/Texte copié : collez-le dans Instagram/).waitFor();
  await p.click('#pub-whatsapp-' + A.id);
  await p.waitForFunction(() => window.__shared.length >= 2);
  const sh = await p.evaluate(() => window.__shared), files = await p.evaluate(() => window.__files);
  assert.equal(files.length, 2); assert.equal(files[0].dir, 'CACHE'); assert.match(files[0].path, /^share\/\d+-0-robe-mobile-test\.jpg$/); assert.ok(files[0].size > 1000);
  assert.deepEqual(sh[0].files, ['file:///cache/' + files[0].path]); assert.equal(sh[0].text, undefined);
  assert.match(sh[1].files[0], /robe-mobile-test-story\.jpg$/); assert.match(sh[1].text, /Robe mobile \(test\)[\s\S]*Pour commander : https:\/\/fii\.app\/#\/b\//, 'lien public, pas l’adresse interne de l’app');
  await p.context().close();
});

await t('liens externes : WhatsApp ouvert par le téléphone, l’app reste ; liens https de Fii ouverts dans l’app (retour de paiement, liens partagés)', async () => {
  const p = await newApp({ local: { 'fiila.shop': SHOP } });
  await p.goto(URL0 + '#/boutique/reglages');
  await p.locator('#vitrine-wa').waitFor();
  // « Envoyer » sur WhatsApp : carte image + texte par le partage du téléphone.
  await p.click('#vitrine-wa');
  await p.waitForFunction(() => window.__shared.length === 1);
  assert.equal((await p.evaluate(() => window.__shared[0].files)).length, 1);
  // Tout lien externe (WhatsApp, cartes, réseaux) : ouvert par le téléphone, l'app reste sur son écran.
  await p.evaluate(() => { const a = document.createElement('a'); a.id = 'x-ext'; a.href = 'https://wa.me/221770000000'; a.target = '_blank'; a.textContent = 'x'; document.getElementById('app').append(a); });
  await p.click('#x-ext');
  await p.waitForFunction(() => window.__opened.length === 1);
  assert.equal(await p.evaluate(() => window.__opened[0]), 'https://wa.me/221770000000');
  assert.equal(await p.evaluate(() => location.hash), '#/boutique/reglages');
  await p.evaluate(() => { const a = document.createElement('a'); a.id = 'x-fii'; a.href = 'https://fii.app/#/confidentialite'; a.textContent = 'y'; document.getElementById('app').append(a); });
  await p.click('#x-fii');
  await p.waitForFunction(() => location.hash === '#/confidentialite');
  assert.equal(await p.evaluate(() => window.__opened.length), 1, 'lien de Fii : dans l’app');
  await p.evaluate((slug) => window.__listeners.appUrlOpen({ url: 'https://fii.app/#/b/' + slug }), SLUG);
  await p.waitForFunction((slug) => location.hash === '#/b/' + slug, SLUG);
  await p.getByText('Robe mobile (test)').first().waitFor();
  await p.evaluate(() => window.__listeners.appUrlOpen({ url: 'fii://boutique' }));
  await p.waitForFunction(() => location.hash === '#/boutique');
  await p.evaluate(() => window.__listeners.appUrlOpen({ url: 'https://evil.example/#/compte' }));
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => location.hash), '#/boutique', 'adresse étrangère ignorée');
  await p.context().close();
});

await t('iPhone : aucune incitation à acheter un abonnement (modèles Premium visibles, sans « Je veux ce modèle »)', async () => {
  const p = await newApp({ platform: 'ios', local: { 'fiila.shop': SHOP } });
  await p.goto(URL0 + '#/boutique/vitrine');
  await p.locator('#vitrine-theme-premium [data-theme="atelier"]').click();
  await p.locator('#premium-sheet').waitFor();
  assert.equal(await p.locator('#premium-interest').count(), 0);
  assert.equal(await p.locator('#premium-preview').count(), 1, 'l’aperçu reste');
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains('native-ios')));
  await shot(p, '02-ios-premium');
  assert.deepEqual(p.__errors, []);
  await p.context().close();
});

await t('web (sans coquille native) : rien ne change — « Je veux ce modèle » présent, aucune classe native', async () => {
  const ctx = await browser.newContext({ viewport: phone.viewport, locale: 'fr-FR' });
  await ctx.addInitScript((x) => localStorage.setItem('fiila.shop', x), SHOP);
  const p = await ctx.newPage();
  await p.goto(URL0 + '#/boutique/vitrine');
  await p.locator('#vitrine-theme-premium [data-theme="atelier"]').click();
  await p.locator('#premium-interest').waitFor();
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains('native')), false);
  await ctx.close();
});

await local.db.query(`delete from fiila.metrics where event = 'app'`);
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests app mobile réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
