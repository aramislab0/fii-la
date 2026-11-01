// Audit UX à 360° (fondateur, 01/11/2026) : parcourt les écrans de chaque type d'utilisateur sur un serveur local
// (données synthétiques, supprimées à l'arrêt), sur iPhone 13 et petit Android, en clair et en sombre, et relève :
// boutons de fermeture (X : présence, position, taille), zones à toucher < 44 px, débordement horizontal, boutons
// d'action masqués par une barre fixe, erreurs JavaScript. Captures et relevé JSON dans le dossier donné (hors dépôt).
// Usage : node scripts/audit-ux.mjs <dossier>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { startServer } from '../tests/dev-server.mjs';
import { rpc } from '../tests/db.mjs';

const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, devices } = pw;
const OUT = process.argv[2] || 'audit-ux';
mkdirSync(OUT, { recursive: true });
const local = await startServer(0);
const U = local.url;
const browser = await chromium.launch();
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); if (r.status !== 200) throw new Error(fn + ' ' + JSON.stringify(r.body)); return r.body; };

// Photos de démonstration (fichiers locaux passés en argument d'environnement, sinon un pixel).
const PH = (process.env.AUDIT_PHOTOS || '').split(',').filter(Boolean).map((f) => readFileSync(f).toString('base64'));
const pix = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64'), Buffer.alloc(200)]).toString('base64');
const photo = (i) => PH.length ? PH[i % PH.length] : pix;

// ---------------------------------------------------------------- données synthétiques
const ALL = {}; for (let d = 0; d <= 6; d++) ALL[d] = ['08:00', '22:00'];
const shop = await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Awa (test)', business_type: 'mode', phone: '77 100 00 01' } });
const SK = shop.key;
const prods = [];
for (const [i, n, p, r] of [[0, 'Robe wax', 15000, 'Robes'], [1, 'Boubou brodé', 25000, 'Robes'], [2, 'Foulard soie', 3000, 'Accessoires'], [3, 'Sac en cuir', 18000, 'Accessoires'], [4, 'Chemise lin', 12000, 'Hommes'], [5, 'Sandales', 9000, 'Hommes']])
  prods.push(await ok('fiila_product_save', { p_key: SK, p: { name: n + ' (test)', price: p, rubric: r, photo: photo(i), sizes: i < 2 ? ['S', 'M', 'L'] : undefined } }));
const V = await ok('fiila_shop_vitrine', { p_key: SK, p: { public: true, about: 'Mode wax et accessoires faits à Dakar.', policies: { pay: ['livraison', 'wave'], wave_to: '77 111 22 33' } } });
const salon = await ok('fiila_shop_save', { p_key: null, p: { name: 'Salon Démo (test)', business_type: 'coiffure', phone: '77 000 00 09' } });
await local.db.query(`update fiila.shops set plan = 'premium' where id = $1`, [salon.shop.id]);
const SV = await ok('fiila_shop_vitrine', { p_key: salon.key, p: { public: true, theme: 'rituel', accent: 'noir', about: 'Coupes, barbe et soins.', policies: { pay: ['wave'], wave_to: '77 111 22 33' } } });
await ok('fiila_shop_salon', { p_key: salon.key, p: { hours: ALL, seats: 2, step: '30', rules: 'Merci d’arriver 5 minutes avant.' } });
const svc = [];
for (const [i, n, p, d, dep, r] of [[6, 'Coupe homme', 5000, 30, 0, 'Coupes'], [7, 'Coupe + barbe', 8000, 60, 2000, 'Coupes'], [8, 'Soin visage', 15000, 60, 3000, 'Soins'], [9, 'Manucure', 6000, 45, 0, 'Beauté']])
  svc.push(await ok('fiila_product_save', { p_key: salon.key, p: { name: n + ' (test)', price: p, duration: d, deposit: dep || undefined, rubric: r, photo: photo(i) } }));
await ok('fiila_reel_add', { p_key: salon.key, p: { poster: photo(6), caption: 'Low fade' } });
await ok('fiila_reel_add', { p_key: salon.key, p: { poster: photo(8), caption: 'Soin visage' } });
const order = await ok('fiila_vitrine_order', { p_slug: V.slug, p: { items: [{ product_id: prods[0].id, qty: 1, size: 'M' }], customer: { name: 'Coumba (test)', phone: '770000005' }, pay: 'wave' } });
const place = await ok('fiila_create_place', { p: { kind: 'address', label: 'Maison (test)', entry: { lat: 14.75814, lng: -17.47032, acc: 10 }, vehicle_ok: true, instruction: 'Portail vert à droite de la boutique (test)' } });
const req = await ok('fiila_create_request', { p: { requester_name: 'Boutique Awa (test)', purpose: 'Livraison de votre commande', order_ref: 'CMD-9' } });
const inv = (await ok('fiila_courier_invite', { p_key: SK, p_name: 'Moussa (test)', p_phone: '77 222 22 22' })).token;
const day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const bk = await ok('fiila_vitrine_book', { p_slug: SV.slug, p: { product_id: svc[1].id, day, time: '10:00', pay: 'wave', customer: { name: 'Awa (test)', phone: '77 000 00 01' } } });
const owned = JSON.stringify([{ type: 'place', kind: 'address', id: place.id, owner: place.owner_token, share: place.share_token, label: 'Maison (test)' }]);

// ---------------------------------------------------------------- relevé injecté dans la page
const AUDIT = () => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
  const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  const sel = (e) => e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const inter = [...document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=radio],[role=switch],input:not([type=hidden]),select,summary,label[for]')].filter(vis);
  const closes = inter.filter((e) => /fermer|close|annuler la feuille/i.test(e.getAttribute('aria-label') || '') || /close|vsheet-close|rv-close|sheet-x/.test(typeof e.className === 'string' ? e.className : '') || /^[×✕✖xX]$/.test(e.textContent.trim()));
  const small = inter.filter((e) => {
    const r = e.getBoundingClientRect();
    if (e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p,li,span')) return false; // lien dans une phrase
    if (e.tagName === 'INPUT' && /checkbox|radio/.test(e.type)) return false;
    return r.width < 40 || r.height < 40;
  }).map((e) => ({ s: sel(e), n: name(e), ...box(e) }));
  const off = inter.filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; })
    .filter((e) => !e.closest('[class*=rail],[class*=scroll],.vrail-track,.sl-bubbles,.sl-tabs,.sl-days,.opt-row,.mk-strip,.chan-grid,.bubbles,.days,.tabs,.vtabs,.rnd-row'))
    .map((e) => ({ s: sel(e), n: name(e), ...box(e) }));
  // Boutons d'action recouverts par un autre élément (barre fixe, onglets, bandeau) au centre.
  const covered = inter.filter((e) => e.matches('.btn,button[type=submit]') && !e.disabled).filter((e) => {
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (y < 0 || y > vh) return false;
    const t = document.elementFromPoint(x, y); return t && t !== e && !e.contains(t) && !t.contains(e);
  }).map((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { s: sel(e), n: name(e), by: t ? sel(t) : '?' }; });
  const fixed = [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).position === 'fixed' && vis(e)).map((e) => ({ s: sel(e), ...box(e) })).slice(0, 8);
  return { url: location.hash, title: (document.querySelector('h1') || {}).textContent || '', hscroll: document.documentElement.scrollWidth > vw + 1, scrollW: document.documentElement.scrollWidth,
    closes: closes.map((e) => ({ s: sel(e), n: name(e), ...box(e) })), small, off, covered, fixed, nBtn: inter.length };
};

// ---------------------------------------------------------------- parcours
const results = [];
async function ctxFor(dev, scheme, extra = {}) {
  const d = dev === 'android' ? { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 5'].userAgent }
    : { viewport: devices['iPhone 13'].viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent };
  const ctx = await browser.newContext({ ...d, locale: 'fr-FR', colorScheme: scheme, serviceWorkers: 'block', geolocation: { latitude: 14.75814, longitude: -17.47032, accuracy: 9 }, permissions: ['geolocation'], ...extra });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.abort());
  return ctx;
}
let n = 0;
async function screen(page, role, id, label, ctxInfo) {
  await page.waitForTimeout(700);
  const a = await page.evaluate(AUDIT).catch((e) => ({ error: String(e) }));
  const file = `${String(++n).padStart(3, '0')}-${ctxInfo}-${id}.png`;
  await page.screenshot({ path: `${OUT}/${file}` }).catch(() => {});
  results.push({ n, role, id, label, ctx: ctxInfo, file, errors: page.__errors.splice(0), ...a });
}
async function run(dev, scheme, role, steps, extra) {
  const ctx = await ctxFor(dev, scheme, extra);
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e).slice(0, 200)));
  const info = `${dev}-${scheme}`;
  for (const [id, label, act] of steps) {
    try { await act(page); await screen(page, role, id, label, info); }
    catch (e) { results.push({ role, id, label, ctx: info, fail: String(e.message || e).split('\n')[0].slice(0, 200) }); }
  }
  await ctx.close();
}
const go = (h) => async (p) => { await p.goto(U + h); await p.waitForLoadState('domcontentloaded'); };
const asShop = (key) => async (p) => { await p.goto(U + '#/x'); await p.evaluate((k) => localStorage.setItem('fiila.shop', JSON.stringify({ key: k })), key); };
const click = (s) => async (p) => { await p.locator(s).first().click(); };

const visitor = [
  ['accueil', 'Accueil (première visite)', go('#/')],
  ['accueil-bas', 'Accueil, bas de page', async (p) => { await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); }],
  ['nouvelle-adresse', 'Créer une adresse', go('#/new')],
  ['demande-nouvelle', 'Demander une adresse', go('#/demande/nouvelle')],
  ['evenement', 'Créer un événement', go('#/rdv/nouveau')],
  ['fil', 'Fil Fii (boutiques)', go('#/boutiques')],
  ['fil-commentaires', 'Fil : commentaires', async (p) => { await p.locator('.post-more').first().click(); }],
  ['boutiques-liste', 'Liste des boutiques', go('#/boutiques/liste')],
  ['compte', 'Connexion (actuelle)', go('#/compte')],
  ['inscription', 'Inscription (actuelle)', go('#/compte?mode=inscription')],
  ['oubli', 'Mot de passe oublié', async (p) => { await p.goto(U + '#/compte'); await p.click('#forgot'); }],
  ['enregistres', 'Mes favoris / enregistrés', go('#/enregistres')],
  ['carriere', 'Fii Carrière (ambassadeurs)', go('#/carriere')],
  ['vide-dressing', 'Vide-dressing', go('#/vide-dressing')],
  ['vide-dressing-vendre', 'Vide-dressing : vendre', go('#/vide-dressing/vendre')],
  ['confidentialite', 'Confidentialité', go('#/confidentialite')],
  ['parrainer', 'Parrainer', go('#/parrainer')],
  ['livreur', 'Espace livreur (sans invitation)', go('#/livreur')],
  ['lien-invalide', 'Lien inconnu', go('#/a/inconnu123')],
];
const client = [
  ['adresse-recue', 'Adresse reçue (destinataire)', go('#/a/' + place.share_token)],
  ['demande-recue', 'Demande d’adresse reçue', go('#/d/' + req.share_token)],
  ['vitrine', 'Boutique (galerie)', go('#/b/' + V.slug)],
  ['vitrine-bas', 'Boutique, bas', async (p) => { await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); }],
  ['fiche-article', 'Fiche article', async (p) => { await p.goto(U + '#/b/' + V.slug + '?a=' + prods[0].id); await p.locator('.sheet').first().waitFor(); }],
  ['panier', 'Panier (barre)', async (p) => { await p.keyboard.press('Escape'); await p.goto(U + '#/b/' + V.slug); await p.locator('.vcard .add-btn, .vcard .btn').first().click().catch(() => {}); await p.waitForTimeout(400); const sz = p.locator('.sheet [data-size], .sheet .opt').first(); if (await sz.count()) { await sz.click(); await p.locator('.sheet .btn').last().click().catch(() => {}); } }],
  ['commande', 'Commande : coordonnées', async (p) => { await p.locator('#cart-go').click(); }],
  ['facture', 'Commande envoyée (facture)', go('#/f/' + order.invoice + '?nouvelle=1')],
  ['facture-ferme', 'Facture après félicitations', async (p) => { await p.locator('#fx-yay-close').click().catch(() => {}); }],
  ['salon', 'Salon (Rituel)', go('#/b/' + SV.slug)],
  ['salon-horaires', 'Salon : horaires', click('#salon-open')],
  ['salon-realisation', 'Salon : réalisation plein écran', async (p) => { await p.keyboard.press('Escape'); await p.locator('[data-reel="0"]').click(); }],
  ['salon-resa-1', 'Réservation : prestation', async (p) => { await p.goto(U + '#/b/' + SV.slug); await p.locator('#salon-menu').evaluate((el) => el.scrollIntoView()); await p.locator('#dock-book').click({ timeout: 4000 }); }],
  ['salon-resa-2', 'Réservation : jour et heure', async (p) => { await p.locator('[data-pick]').nth(1).click(); }],
  ['salon-resa-3', 'Réservation : coordonnées', async (p) => { await p.locator('[data-day]').nth(1).click(); await p.locator('#book-slots .sl-slot').nth(4).click(); }],
  ['rdv', 'Page du rendez-vous', go('#/rdv/' + bk.token + '?nouveau=1')],
];
const merchantNew = [
  ['boutique-creer', 'Créer sa boutique (sans compte)', go('#/boutique')],
  ['boutique-type', 'Créer : type choisi (salon)', async (p) => { await p.fill('#shop-name', 'Nouveau salon (test)'); await p.click('#shop-type [data-v="coiffure"]'); }],
  ['boutique-creee', 'Après création : étapes', async (p) => { await p.click('#shop-save'); }],
  ['boutique-etapes-suite', 'Étapes (défilées)', async (p) => { await p.evaluate(() => scrollTo(0, 600)); }],
];
const merchant = [
  ['b-accueil', 'Commerçant : commandes', async (p) => { await asShop(SK)(p); await p.goto(U + '#/boutique'); }],
  ['b-articles', 'Commerçant : articles', go('#/boutique/articles')],
  ['b-article-nouveau', 'Nouvel article', go('#/boutique/article/nouveau')],
  ['b-article-bas', 'Nouvel article (bas)', async (p) => { await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); }],
  ['b-commande', 'Détail d’une commande', async (p) => { await p.goto(U + '#/boutique'); await p.locator('.order-row').first().click(); }],
  ['b-nouvelle-commande', 'Nouvelle commande (manuelle)', go('#/commande/nouvelle')],
  ['b-clients', 'Clients', go('#/clients')],
  ['b-marketing', 'Marketing', go('#/boutique/marketing')],
  ['b-reglages', 'Réglages', go('#/boutique/reglages')],
  ['b-reglages-bas', 'Réglages (bas)', async (p) => { await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); }],
  ['b-vitrine', 'Personnaliser le site', go('#/boutique/vitrine')],
  ['b-identite', 'Identité du propriétaire', go('#/boutique/identite')],
  ['s-agenda', 'Salon : agenda', async (p) => { await asShop(salon.key)(p); await p.goto(U + '#/boutique'); }],
  ['s-agenda-jour', 'Salon : agenda (demain)', async (p) => { await p.locator('[data-day="' + day + '"]').click(); }],
  ['s-rdv-fiche', 'Salon : fiche rendez-vous', async (p) => { await p.locator('.bk-row').first().click(); }],
  ['s-prestations', 'Salon : prestations', async (p) => { await p.keyboard.press('Escape'); await p.goto(U + '#/boutique/articles'); }],
  ['s-prestation', 'Salon : modifier une prestation', go('#/boutique/article/' + svc[0].id)],
  ['s-reglages-resa', 'Salon : réglages réservation', go('#/boutique/salon')],
];
const courier = [['livreur-invite', 'Livreur : invitation', go('#/livreur/invitation/' + inv)]];
const owner = [['ma-fiche', 'Ma fiche (créateur de l’adresse)', async (p) => { await p.goto(U + '#/x'); await p.evaluate((o) => localStorage.setItem('fiila.owned', o), owned); await p.goto(U + '#/m/' + place.id); }],
  ['accueil-avec-fiche', 'Accueil (avec une fiche)', go('#/')]];

for (const [dev, scheme] of [['iphone', 'light'], ['android', 'light'], ['iphone', 'dark']]) {
  const full = !(dev === 'iphone' && scheme === 'dark') || true;
  await run(dev, scheme, 'visiteur', visitor);
  await run(dev, scheme, 'client', client);
  await run(dev, scheme, 'commerçant (création)', merchantNew);
  await run(dev, scheme, 'commerçant', merchant);
  await run(dev, scheme, 'livreur', courier);
  await run(dev, scheme, 'créateur d’adresse', owner);
}
writeFileSync(`${OUT}/audit.json`, JSON.stringify(results, null, 1));
console.log('écrans', results.length, 'échecs', results.filter((r) => r.fail).length);
await browser.close();
local.server.close();
process.exit(0);
