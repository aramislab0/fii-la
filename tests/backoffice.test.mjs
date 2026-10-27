// Back-office de bout en bout, sur ordinateur (1440 × 900) et sur téléphone (iPhone 13) :
// portail de connexion, refus d'un compte hors équipe, navigation dans toutes les sections, boutiques (recherche, suspension),
// commandes, comptes, invitation d'un membre (lien, inscription, rôle limité), retrait, réglages, journal, anciennes adresses.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { passMfa } from './bo-mfa.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/back-office';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message.split('\n')[0], (e.stack.match(/backoffice.test.mjs:\d+/) || [''])[0]); }
}
const pages = [];
async function newPage(kind = 'desktop', scheme = 'light') {
  const opts = kind === 'desktop'
    ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme }
    : { viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme };
  const ctx = await browser.newContext(opts);
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  pages.push(page);
  return page;
}
const shot = (p, name, full = false) => p.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: full });
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
async function signup(p, name, email, retour) {
  await p.goto(URL0 + '#/compte?mode=inscription' + (retour ? '&retour=' + retour : ''));
  await p.getByRole('tab', { name: 'Créer un compte' }).click().catch(() => {});
  await p.fill('#acc-name', name);
  await p.fill('#acc-email', email);
  await p.fill('#acc-pass', 'motdepasse-test-123');
  await p.click('#auth-submit');
  await p.getByText('Compte créé.').waitFor();
}
const heading = (p) => p.locator('#bo-main h1');

// Données synthétiques : une boutique ouverte avec un article et une commande.
const KEY = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Couture Awa (test)', phone: '77 600 00 01', business_type: 'mode' } })).key;
const PR = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Robe (test)', price: 12000 } });
await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true } });
const SLUG = (await local.db.query(`select slug from fiila.shops where name = 'Couture Awa (test)'`)).rows[0].slug;
await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: PR.id, qty: 2 }], customer: { name: 'Khady Cliente (test)', phone: '70 600 00 02' } } });

const D = await newPage('desktop');
await t('portail : connexion de l’équipe ; un compte hors équipe est refusé', async () => {
  await D.goto(URL0 + '#/bo');
  await D.locator('#bo-login').waitFor();
  await D.locator('#bo-back').waitFor(); // flèche retour sur le portail
  assert.equal(await D.locator('#bo-back').getAttribute('href'), '#/');
  await shot(D, '01-portail');
  await signup(D, 'Client Test', 'client.bo@example.invalid');
  await D.goto(URL0 + '#/bo');
  await D.locator('#bo-denied').getByText('Accès non autorisé').waitFor();
  await D.locator('#bo-back').waitFor();
  await D.locator('#bo-denied').getByRole('button', { name: 'Changer de compte' }).click();
  await D.locator('#bo-login').waitFor();
  // Le fondateur : compte créé puis super admin (comme en production après la migration).
  const F = await newPage('mobile');
  await signup(F, 'Assane Test', 'fondateur.bo@example.invalid');
  await local.db.query(`insert into fiila.staff (user_id, role) select id, 'super_admin' from auth.users where email = 'fondateur.bo@example.invalid'`);
  await D.fill('#bo-email', 'fondateur.bo@example.invalid');
  await D.fill('#bo-pass', 'mauvais-mot-de-passe');
  await D.click('#bo-login-btn');
  await D.locator('#bo-login [role="alert"]').getByText(/./).waitFor();
  await D.fill('#bo-pass', 'motdepasse-test-123');
  await D.click('#bo-login-btn');
  // Double authentification obligatoire : activation à la première connexion (QR code ou clé), refus d'un code faux.
  await D.locator('#bo-mfa').getByText('Activer la double authentification').waitFor();
  await D.locator('#bo-mfa-qr').waitFor();
  assert.ok(await D.locator('#bo-mfa-qr').evaluate((img) => img.complete && img.naturalWidth > 0), 'le QR code s’affiche (format réel de Supabase)');
  await shot(D, '00-double-authentification');
  await D.fill('#bo-mfa-code', '000000');
  await D.click('#bo-mfa-ok');
  await D.locator('#bo-mfa [role="alert"]').getByText(/Code incorrect/).waitFor();
  assert.equal((await rpc(local.db, 'fiila_bo_overview', {}, { uid: (await local.db.query(`select id from auth.users where email = 'fondateur.bo@example.invalid'`)).rows[0].id, aal: 'aal1' })).body.message, 'fiila:mfa_required');
  await passMfa(D, 'fondateur.bo@example.invalid');
  await D.locator('#bo-kpis').waitFor();
  assert.equal(await heading(D).textContent(), 'Tableau de bord');
});

const SECTIONS = [['', 'Tableau de bord'], ['boutiques', 'Boutiques'], ['commandes', 'Commandes'], ['domaines', 'Domaines'], ['studio', 'Studio'], ['identites', 'Identités'], ['comptes', 'Comptes'], ['moderation', 'Modération'],
  ['vide-dressing', 'Vide-dressing'], ['ambassadeurs', 'Ambassadeurs'], ['agents', 'Agents'], ['carriere', 'Manager Carrière'], ['fil', 'Fil (25 places gratuites)'], ['finances', 'Finances'], ['croissance', 'Croissance'],
  ['equipe', 'Équipe'], ['journal', 'Journal'], ['reglages', 'Réglages de la plateforme']];
await t('ordinateur : barre latérale avec les 18 sections du super admin, chacune s’ouvre sans erreur', async () => {
  assert.equal(await D.locator('.bo-nav .bo-link').count(), 18);
  assert.ok(await D.locator('#bo-side').isVisible());
  assert.equal(await D.locator('#bo-menu').isVisible(), false, 'pas de bouton menu sur ordinateur');
  await shot(D, '02-tableau-de-bord');
  for (const [path, title] of SECTIONS) {
    await D.click('#bo-nav-' + (path || 'accueil'));
    await D.locator(`#bo-nav-${path || 'accueil'}[aria-current="page"]`).waitFor();
    await D.waitForFunction((t) => document.querySelector('#bo-main h1') && document.querySelector('#bo-main h1').textContent === t, title);
    assert.equal(await D.locator('#bo-main .back').count(), 0, 'pas de bouton retour sur une section : la barre latérale suffit');
  }
  await D.locator('#bo-settings').waitFor();
  await shot(D, '03-reglages');
});
await t('Ambassadeurs (marques) : nouvelle version du pack, « Inviter une marque », aperçu et lien WhatsApp, invitation listée', async () => {
  await D.click('#bo-nav-ambassadeurs');
  await D.locator('#bo-packs summary').click();
  await D.click('#bo-pack-new');
  await D.fill('#pack-name', 'Pack complet (test)');
  await D.fill('#pack-benefits', 'Vitrine mise en avant\nAccompagnement du Manager');
  await D.click('#pack-save');
  await D.locator('#bo-packs').getByText('Pack complet (test) · v1').waitFor({ state: 'attached' });
  await D.click('#bo-invite-brand');
  await D.fill('#inv-brand', 'Maison Test (test)');
  await D.fill('#inv-wa', '77 700 00 01');
  await D.click('#inv-create');
  await D.locator('#bo-share-sheet').waitFor();
  assert.match(await D.locator('#inv-wa-go').getAttribute('href'), /^https:\/\/wa\.me\/221777000001\?text=.*invitation/);
  await shot(D, '20-invitation-marque');
  await D.click('#inv-done');
  await D.locator('#bo-partners').getByText('Maison Test (test)').waitFor();
  // Une marque partenaire écrit au Manager : l'équipe voit les jalons, lit et répond.
  const pid = (await local.db.query(`select id from fiila.partner_invites where brand = 'Maison Test (test)'`)).rows[0].id;
  const shop = (await rpc(local.db, 'fiila_shop_save', { p_key: null, p: { name: 'Maison Test (test)', business_type: 'mode' } })).body;
  await local.db.query(`insert into fiila.partner_trials (invite_id, shop_id, pack_code, pack_version, months) select id, $2, pack_code, pack_version, months from fiila.partner_invites where id = $1`, [pid, shop.shop.id]);
  await local.db.query(`update fiila.partner_invites set status = 'accepted', accepted_shop = $2 where id = $1`, [pid, shop.shop.id]);
  await rpc(local.db, 'fiila_partner_message_send', { p_key: shop.key, p_body: 'Combien coûte la suite ?' });
  await D.reload();
  const item = D.locator('#ptn-' + pid);
  await item.getByText('À traiter · 1').waitFor();
  await item.locator('summary').click();
  await item.locator('[data-act="thread"]').click();
  await D.locator('#bo-pmsg-list').getByText('Combien coûte la suite ?').waitFor();
  await D.fill('#bo-pmsg-input', 'Bonjour, nous vous appelons demain.');
  await D.click('#bo-pmsg-send');
  await D.locator('#bo-pmsg-list').getByText('Bonjour, nous vous appelons demain.').waitFor();
  await shot(D, '21-conversation-marque');
  await D.click('#bo-pmsg-close');
  await D.locator('#bo-pmsg-sheet').waitFor({ state: 'detached' });
});
await t('Croissance : « Parcours d’accueil » (gestes et tâches réussies) ; réglage du nouvel accueil dans Réglages', async () => {
  await D.click('#bo-nav-croissance');
  await D.locator('#bo-onboarding').waitFor();
  await D.locator('#bo-onboarding-table').waitFor();
  assert.match(await D.locator('#bo-onboarding').textContent(), /Nouvel accueil actif/);
  await D.locator('#bo-setup').getByText('Démarrage guidé de la boutique').waitFor();
  await D.locator('#bo-discover-table').waitFor();
  // Accueil adaptatif (UX-ADAPTATIVE-001) : état, version, table, aperçu sur cas fictifs.
  assert.match(await D.locator('#bo-adaptive').textContent(), /Accueil adaptatif.*adaptive_v1/s);
  await D.locator('#bo-adaptive-table').waitFor();
  await D.click('#bo-adaptive-preview summary');
  await D.locator('#bo-adaptive-preview').getByText('3 événements créés en 10 jours → Créer un événement').waitFor();
  await D.locator('#bo-adaptive-preview').getByText('Ouvre « Demander » 6 fois sans rien envoyer → Créer mon adresse (par défaut)').waitFor();
  assert.match(await D.locator('#bo-marketing-use').textContent(), /Ma boutique et Marketing.*Raccourcis de l’accueil : Commandes \d+.*Écran Marketing ouvert : \d+/s);
  // Suggestions (rétention lot 1) : table, fenêtre incomplète, commandes sans adresse, interrupteur par suggestion.
  await D.locator('#bo-sugg-table').waitFor();
  assert.match(await D.locator('#bo-sugg-window').textContent(), /Fenêtre incomplète/);
  assert.match(await D.locator('#bo-order-address').textContent(), /commandes ouvertes en attente maintenant : \d+/);
  await D.selectOption('#bo-sugg-table select[data-sugg="shop_team"]', '0');
  await D.getByText('Suggestion coupée.').waitFor();
  await D.selectOption('#bo-sugg-table select[data-sugg="shop_team"]', '1');
  await D.getByText('Suggestion activée.').waitFor();
  assert.match(await D.locator('#bo-premium-line').textContent(), /Modèles Premium \(30 jours\) : Atelier.*Boutiques Premium : \d+/);
  // Messages WhatsApp (WHATSAPP-001) : registre, aperçu, état Meta saisi à la main et journalisé.
  await D.locator('#bo-wa-table').waitFor();
  assert.equal(await D.locator('#bo-wa-table tbody tr').count(), 6);
  assert.match(await D.locator('#bo-wa').textContent(), /Carte image active.*Aucun envoi par l’API/s);
  await D.click('#bo-wa-preview summary');
  await D.waitForFunction(() => document.querySelector('#bo-wa-preview img').naturalWidth === 1200);
  await D.selectOption('select[data-wa="fiila_address_request_v1"]', 'SUBMITTED');
  await D.getByText('État Meta enregistré.').waitFor();
  assert.equal((await local.db.query(`select meta_status from fiila.wa_templates where id = 'fiila_address_request_v1'`)).rows[0].meta_status, 'SUBMITTED');
  await D.selectOption('select[data-wa="fiila_address_request_v1"]', 'NOT_SUBMITTED');
  await D.getByText('État Meta enregistré.').first().waitFor();
  await D.click('#bo-nav-reglages');
  await D.locator('#bo-settings').getByText('Nouvel accueil', { exact: false }).waitFor();
  await D.locator('#bo-settings').getByText('Carte image avec la demande d’adresse', { exact: false }).waitFor();
  // Photos (stockage) : état visible ; sans seau configuré (environnement local), pas de bouton de copie.
  await D.locator('#bo-media').getByText('Stockage non configuré').waitFor();
  assert.match(await D.locator('#bo-media').textContent(), /Copiées : 0 .*en attente : \d+/s);
  assert.equal(await D.locator('#bo-media-run').count(), 0);
  await D.locator('#bo-settings').getByText('Photos servies par le stockage', { exact: false }).waitFor();
});

await t('boutiques : recherche, filtre, fiche ; suspension (motif) qui ferme la vitrine ; réactivation ; journal', async () => {
  await D.click('#bo-nav-boutiques');
  await D.locator('#bo-table').waitFor();
  await D.fill('#bo-search', '77 600');
  await D.waitForFunction(() => document.querySelectorAll('#bo-table tbody tr').length === 1);
  await D.locator('#bo-table tbody tr').filter({ hasText: 'Couture Awa (test)' }).waitFor();
  await D.locator('#bo-filters').getByRole('button', { name: 'Suspendues' }).click();
  await D.locator('#bo-empty').waitFor();
  await D.locator('#bo-filters').getByRole('button', { name: 'Ouvertes' }).click();
  await D.locator('#bo-table tbody tr').first().waitFor();
  await shot(D, '04-boutiques');
  await D.locator('#bo-table tbody tr').filter({ hasText: 'Couture Awa (test)' }).locator('td').nth(2).click();
  await D.locator('#bo-shop-info').waitFor();
  assert.equal(await heading(D).textContent(), 'Couture Awa (test)');
  // Abonnement (22/10) : Gratuit / Premium, journalisé.
  assert.equal(await D.locator('#bo-shop-plan').inputValue(), 'free');
  await D.selectOption('#bo-shop-plan', 'premium');
  await D.getByText('Abonnement Premium activé.').waitFor();
  await D.selectOption('#bo-shop-plan', 'free');
  await D.getByText('Abonnement gratuit.').waitFor();
  // Marketing de la boutique (22/10) : visites, commandes vitrine, publications, réseaux sur 30 jours.
  assert.match(await D.locator('#bo-shop-marketing').textContent(), /Marketing · 30 jours.*Visites du site\d+.*Commandes via le site\d+.*Réseaux/s);
  await D.locator('#bo-main .bo-crumbs').getByRole('link', { name: 'Boutiques' }).waitFor(); // ordinateur : le fil d’Ariane remplace le bouton retour
  await D.click('#bo-suspend');
  await D.getByText('Indiquez un motif.').waitFor();
  await D.fill('#bo-suspend-reason', 'Photos trompeuses (test)');
  await D.click('#bo-suspend');
  await D.getByText('Boutique suspendue.').waitFor();
  await D.locator('#bo-unsuspend').waitFor();
  await D.locator('#bo-shop-log').getByText('a suspendu la boutique Couture Awa (test) : Photos trompeuses (test)').waitFor();
  await shot(D, '05-boutique-suspendue', true);
  const v = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.equal(v.state, 'closed');
  await D.click('#bo-unsuspend');
  await D.getByText('Boutique réactivée.').waitFor();
  await D.locator('#bo-suspend').waitFor();
});

await t('recherche globale (Ctrl+K) : rubriques, boutiques, commandes ; clavier jusqu’à la fiche', async () => {
  await D.click('#bo-nav-accueil'); await D.locator('#bo-kpis').waitFor();
  await D.keyboard.press('Control+k');
  await D.locator('#bo-pal-q').waitFor();
  await D.locator('#bo-pal').getByText('Réglages').waitFor(); // sans saisie : les rubriques
  await D.fill('#bo-pal-q', 'Couture');
  await D.locator('#bo-pal').getByText('Boutiques', { exact: true }).waitFor();
  await D.locator('#bo-pal .bo-pal-it').filter({ hasText: 'Couture Awa (test)' }).first().waitFor();
  await shot(D, '04b-recherche');
  // Premier résultat utile : la boutique ; flèche bas jusqu'à elle puis Entrée.
  const idx = await D.evaluate(() => [...document.querySelectorAll('#bo-pal .bo-pal-it')].findIndex((x) => /Couture Awa/.test(x.textContent) && /\/boutiques\//.test(x.getAttribute('href'))));
  for (let i = 0; i < idx; i++) await D.keyboard.press('ArrowDown');
  await D.keyboard.press('Enter');
  await D.locator('#bo-shop-info').waitFor();
  assert.equal(await D.locator('#bo-pal').count(), 0, 'la recherche se ferme');
  await D.click('#bo-find'); await D.locator('#bo-pal-q').waitFor();
  await D.keyboard.press('Escape'); await D.locator('#bo-pal').waitFor({ state: 'detached' });
});

await t('commandes et comptes : liste, recherche par téléphone, fiche ; lien vers la boutique', async () => {
  await D.click('#bo-nav-commandes');
  await D.fill('#bo-search', '70 600 00 02');
  await D.waitForFunction(() => document.querySelectorAll('#bo-table tbody tr').length === 1);
  await D.locator('#bo-table tbody tr').filter({ hasText: 'Khady Cliente (test)' }).waitFor();
  await D.locator('#bo-table tbody tr').first().click();
  await D.locator('#bo-order-items').getByText('24 000 FCFA').first().waitFor();
  await D.locator('#bo-order-info').getByText('Demandée, pas encore donnée').waitFor();
  await shot(D, '06-commande');
  await D.locator('#bo-order-info').getByRole('link', { name: 'Couture Awa (test)' }).click();
  await D.locator('#bo-shop-info').waitFor();
  await D.click('#bo-nav-comptes');
  await D.fill('#bo-search', 'fondateur.bo');
  await D.waitForFunction(() => document.querySelectorAll('#bo-table tbody tr').length === 1);
  await D.locator('#bo-table tbody tr').first().click();
  await D.locator('#bo-account-info').getByText('Super admin').waitFor();
});

let INVITE;
await t('équipe : inviter un membre (lien à usage unique), il s’inscrit avec son e-mail et n’a que les droits de son rôle', async () => {
  await D.click('#bo-nav-equipe');
  await D.click('#bo-invite-open');
  await D.fill('#bo-inv-email', 'mariama.bo@example.invalid');
  await D.selectOption('#bo-inv-role', 'moderation');
  await D.locator('#bo-invite-form').getByText('Modération des commentaires, vérification du vide-dressing, suspension des boutiques.').waitFor();
  await D.click('#bo-inv-send');
  INVITE = (await D.locator('#bo-inv-link code').textContent()).trim();
  assert.match(INVITE, /#\/bo\/invitation\/[A-Za-z0-9_-]{20,}$/);
  await shot(D, '07-invitation');
  const M = await newPage('mobile');
  await M.goto(INVITE.replace(/^.*#/, URL0 + '#'));
  assert.match(await M.locator('#bo-invite .ivc-kind').textContent(), /Modération$/);
  await M.locator('#bo-invite').getByText('m•••@example.invalid').waitFor();
  await shot(M, '08-invitation-recue');
  await M.click('#bo-invite-signup');
  await M.fill('#acc-name', 'Mariama Test');
  await M.fill('#acc-email', 'mariama.bo@example.invalid');
  await M.fill('#acc-pass', 'motdepasse-test-123');
  await M.click('#auth-submit');
  await M.locator('#bo-invite-accept').click();
  await M.getByText('Bienvenue dans l’équipe.').waitFor();
  await passMfa(M, 'mariama.bo@example.invalid');
  await M.locator('#bo-kpis').waitFor();
  // Téléphone : menu à ouvrir ; seules les sections de la modération.
  assert.equal(await M.locator('#bo-side').isVisible(), true, 'panneau présent');
  await M.click('#bo-menu');
  await M.waitForTimeout(300);
  const labels = (await M.locator('.bo-nav .bo-link').allTextContents()).map((s) => s.replace(/\d+$/, '').trim());
  assert.deepEqual(labels, ['Tableau de bord', 'Croissance', 'Boutiques', 'Domaines', 'Studio', 'Vide-dressing', 'Modération']);
  await shot(M, '09-mobile-menu-moderation');
  await M.click('#bo-nav-moderation');
  await M.waitForFunction(() => document.querySelector('#bo-main h1').textContent === 'Modération');
  assert.equal(await M.locator('.bo-shell.menu-open').count(), 0, 'le menu se ferme après un choix');
  await M.goto(URL0 + '#/bo/equipe');
  await M.locator('#bo-main').getByText('Accès non autorisé').waitFor();
  await shot(M, '10-mobile-refus-section');
  // Retour chez le fondateur : le membre apparaît ; changement de rôle ; retrait.
  await D.click('#bo-nav-accueil'); await D.locator('#bo-kpis').waitFor();
  await D.click('#bo-nav-equipe');
  const row = D.locator('#bo-members tbody tr').filter({ hasText: 'mariama.bo@example.invalid' });
  await row.waitFor();
  await row.locator('select').selectOption('support');
  await D.getByText('Rôle modifié.').waitFor();
  await D.locator('#bo-members tbody tr').filter({ hasText: 'mariama.bo@example.invalid' }).getByRole('button', { name: 'Retirer' }).click();
  await D.getByText('Membre retiré.').waitFor();
  await M.goto(URL0 + '#/bo');
  await M.locator('#bo-denied').waitFor();
});

await t('réglages et journal : modification bornée, tracée avec le nom et le rôle', async () => {
  await D.click('#bo-nav-reglages');
  await D.fill('#bo-set-vd_commission', '60');
  await D.click('#bo-save-vd_commission');
  await D.getByText('Valeur hors des limites autorisées.').waitFor();
  await D.fill('#bo-set-vd_commission', '18');
  await D.click('#bo-save-vd_commission');
  await D.getByText('Réglage enregistré.').waitFor();
  await D.click('#bo-nav-journal');
  await D.locator('#bo-audit tbody tr').first().waitFor();
  const first = await D.locator('#bo-audit tbody tr').first().textContent();
  assert.match(first, /Assane · Super admin/);
  assert.match(first, /Commission du vide-dressing.*15 → 18/);
  const all = await D.locator('#bo-audit').textContent();
  for (const s of ['a retiré de l’équipe', 'a changé le rôle de', 'a rejoint l’équipe', 'a invité', 'a réactivé la boutique', 'a suspendu la boutique']) assert.ok(all.includes(s), 'manque : ' + s);
  await shot(D, '11-journal');
  await ok('fiila_bo_setting_set', { p_key: 'vd_commission', p_value: 15 }).catch(() => {});
});

await t('anciennes adresses (#/stats, #/admin/…) : elles ouvrent la section du back-office', async () => {
  await D.goto(URL0 + '#/stats');
  await D.waitForFunction(() => document.querySelector('#bo-main h1') && document.querySelector('#bo-main h1').textContent === 'Croissance');
  assert.match(D.url(), /#\/bo\/croissance$/);
  await D.goto(URL0 + '#/admin/vide-dressing');
  await D.waitForFunction(() => document.querySelector('#bo-main h1').textContent === 'Vide-dressing');
  await D.goto(URL0 + '#/compte');
  await D.locator('#bo-entry').getByText('Back-office · Super admin').waitFor();
});

await t('téléphone et mode sombre : tableau de bord, liste en cartes, fiche lisible', async () => {
  const P = await newPage('mobile', 'dark');
  await P.goto(URL0 + '#/bo');
  await P.fill('#bo-email', 'fondateur.bo@example.invalid');
  await P.fill('#bo-pass', 'motdepasse-test-123');
  await P.click('#bo-login-btn');
  await P.locator('#bo-mfa').getByText('Code de vérification').waitFor();
  await passMfa(P, 'fondateur.bo@example.invalid');
  await P.locator('#bo-kpis').waitFor();
  assert.equal(await P.locator('#bo-menu').isVisible(), true);
  const width = await P.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390 + 1, 'pas de défilement horizontal (' + width + ')');
  await shot(P, '12-mobile-sombre-tableau', true);
  await P.goto(URL0 + '#/bo/boutiques');
  await P.locator('#bo-table tbody tr').first().waitFor();
  assert.equal(await P.locator('#bo-table thead').isVisible(), false, 'en-têtes masqués : chaque ligne est une carte');
  assert.ok(await P.evaluate(() => document.documentElement.scrollWidth) <= 391);
  await shot(P, '13-mobile-sombre-boutiques', true);
  const DD = await newPage('desktop', 'dark');
  await DD.goto(URL0 + '#/bo');
  await DD.fill('#bo-email', 'fondateur.bo@example.invalid');
  await DD.fill('#bo-pass', 'motdepasse-test-123');
  await DD.click('#bo-login-btn');
  await passMfa(DD, 'fondateur.bo@example.invalid');
  await DD.locator('#bo-kpis').waitFor();
  await shot(DD, '14-ordinateur-sombre');
});

await t('identité du propriétaire (27/10) : fiche boutique, file « Identités », pièce ouverte (journalisée) puis validée', async () => {
  await local.db.query(`update fiila.settings set value = '1' where key = 'kyc_required'`);
  await ok('fiila_shop_owner_save', { p_key: KEY, p_name: 'Awa Couture', p_phone: '77 600 00 01' });
  const o = await ok('fiila_order_create', { p_key: KEY, p: { customer: { name: 'Cliente (test)' }, items: [{ label: 'Robe', qty: 1, price: 12000 }] } });
  await ok('fiila_order_set_status', { p_key: KEY, p_id: o.id, p_status: 'delivered' });
  const SID = (await local.db.query(`select id from fiila.shops where name = 'Couture Awa (test)'`)).rows[0].id;
  await D.goto(URL0 + '#/bo/boutiques/' + SID);
  await D.locator('#bo-shop-identity').getByText('Exigée, non envoyée').waitFor();
  await D.locator('#bo-kyc-blocked').waitFor();
  const IMG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]).toString('base64');
  await ok('fiila_shop_kyc_submit', { p_key: KEY, p_doc_type: 'passport', p_front: IMG });
  await D.goto(URL0 + '#/bo/identites');
  await D.locator('#bo-kyc-pending').getByText('Couture Awa (test)').waitFor();
  await D.locator('#bo-kyc-pending').getByText('Couture Awa (test)').click();
  await D.locator('#bo-shop-identity').getByText('À vérifier').waitFor();
  await D.click('#bo-kyc-open');
  await D.locator('#bo-kyc-doc img').first().waitFor({ state: 'attached' });
  await shot(D, '20-identite');
  await D.click('#bo-kyc-ok');
  await D.locator('#bo-shop-identity').getByText('Validée').waitFor();
  const log = (await local.db.query(`select action from fiila.admin_log where target_id = $1 and action like 'kyc_%' order by at`, [SID])).rows.map((r) => r.action);
  assert.deepEqual(log, ['kyc_view', 'kyc_verified']);
  await local.db.query(`update fiila.settings set value = '0' where key = 'kyc_required'`);
});

await t('déconnexion depuis le back-office : retour au portail', async () => {
  await D.goto(URL0 + '#/bo');
  await D.click('#bo-logout');
  await D.locator('#bo-login').waitFor();
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });

await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests back-office réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
