// Fii La Carrière de bout en bout : inscription de l'ambassadeur (compte, charte), formation, test, validation par le fondateur,
// code tapé par un commerçant à la création de sa boutique, missions et portefeuille, versement marqué par le fondateur.
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
const SHOTS = 'docs/screenshots/ambassadeurs';
mkdirSync(SHOTS, { recursive: true });
const local = await startServer(0);
const URL0 = local.url;
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const version = browser.version();
const phone = devices['iPhone 13'];
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const pages = [];
async function newPhone() {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(1200); return page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true }); }; // après les animations d'entrée
async function signup(p, name, email, retour) {
  await p.goto(URL0 + '#/compte?mode=inscription' + (retour ? '&retour=' + retour : ''));
  await p.getByRole('tab', { name: 'Créer un compte' }).click().catch(() => {});
  await p.fill('#acc-name', name);
  await p.fill('#acc-email', email);
  await p.fill('#acc-pass', 'motdepasse-test-123');
  await p.click('#auth-submit');
  await p.getByText('Compte créé.').waitFor();
}
const GOOD = [1, 1, 0, 1, 0, 1, 1, 1, 1, 0];
let CODE;
const A = await newPhone();
const F = await newPhone();

await t('accueil → « Devenir ambassadeur » : les 3 niveaux et leurs montants, compte demandé', async () => {
  await A.goto(URL0 + '#/');
  await A.locator('#services-open').click();
  await A.locator('#svc-ambassadeur-go').click();
  await A.locator('#amb-levels').waitFor();
  const txt = await A.locator('#amb-levels').textContent();
  assert.match(txt.replace(/\s/g, ' '), /2 000 FCFA[\s\S]*5 000 FCFA[\s\S]*10 000 FCFA/);
  assert.match(txt, /jamais pour une inscription/);
  await A.locator('#amb-login').waitFor();
  await shot(A, '01-presentation');
});

await t('portail Fii La Carrière (#/carriere) : inscription sur place, puis connexion ; retour direct à l’espace ambassadeur', async () => {
  const P = await newPhone();
  await P.goto(URL0 + '#/carriere');
  await P.locator('#amb-access').waitFor();
  await P.click('#amb-login'); // « Accéder à mon espace » mène au formulaire
  await P.fill('#amb-acc-name', 'Awa Portail');
  await P.fill('#amb-acc-email', 'awa.portail@example.invalid');
  await P.fill('#amb-acc-pass', 'motdepasse-test-123');
  await shot(P, '00-portail');
  await P.click('#amb-auth-submit');
  await P.locator('#amb-register').waitFor();
  assert.ok(/#\/carriere$/.test(P.url()), 'on reste dans Fii La Carrière');
  await P.waitForFunction(() => document.getElementById('amb-name').value === 'Awa Portail');
  // déconnexion puis connexion par l'onglet « J’ai déjà un compte »
  await P.evaluate(() => localStorage.removeItem('fiila.session'));
  await P.reload();
  await P.click('#amb-tab-login');
  await P.fill('#amb-acc-email', 'awa.portail@example.invalid');
  await P.fill('#amb-acc-pass', 'motdepasse-test-123');
  await P.click('#amb-auth-submit');
  await P.locator('#amb-register').waitFor();
  await P.context().close();
});

await t('inscription : charte obligatoire, puis formation en 6 fiches et test réussi → en attente de validation', async () => {
  await signup(A, 'Moussa Diop', 'moussa.amb@example.invalid', 'ambassadeur');
  await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#amb-register').waitFor();
  await A.waitForFunction(() => document.getElementById('amb-name').value === 'Moussa Diop'); // pré-rempli depuis le compte
  await A.fill('#amb-phone', '77 500 00 01');
  await A.fill('#amb-zone', 'Yoff');
  await A.click('#amb-register');
  await A.getByText('Acceptez la charte').waitFor();
  await A.check('#amb-charter');
  await A.click('#amb-register');
  await A.locator('#cel').getByRole('heading', { name: 'Bienvenue, Moussa' }).waitFor();
  await shot(A, '01b-bienvenue');
  await A.click('#cel-close');
  await A.locator('#cel').waitFor({ state: 'detached' });
  await A.getByText('Formation · 1 sur 6').waitFor().catch(async (e) => {
    const why = await A.evaluate(() => [...document.querySelectorAll('[role=alert], #toast')].map((x) => x.textContent).join(' | ') + ' @ ' + location.hash);
    throw new Error('formation absente : ' + why);
  });
  // La démonstration animée de la fiche 2 tape le vrai code de l'ambassadeur.
  await A.click('#amb-next');
  const code0 = (await local.db.query(`select code from fiila.ambassadors where name = 'Moussa Diop'`)).rows[0].code;
  await A.waitForFunction((c) => [...document.querySelectorAll('.dm-in')].some((x) => x.textContent === c), code0, { timeout: 12000 });
  await shot(A, '02-formation');
  for (let i = 1; i < 6; i++) await A.click('#amb-next');
  // Test : une question par écran, « Vérifier », correction immédiate (une erreur volontaire à la question 4).
  const PICK = GOOD.map((g, q) => (q === 3 ? 0 : g));
  for (let q = 0; q < 10; q++) {
    await A.locator('#qz-q').waitFor();
    assert.equal(await A.locator('#qz-check').isDisabled(), true, 'Vérifier attend un choix');
    await A.click(`#qz-opt-${PICK[q]}`);
    await A.click('#qz-check');
    await A.locator('#qz-next').waitFor();
    if (q === 0) { assert.match(await A.locator('#qz-foot').textContent(), /niveau vérifié/); await shot(A, '03-test-correct'); }
    if (q === 3) { assert.match(await A.locator('#qz-foot').textContent(), /vos commandes ou celles de vos proches/); await shot(A, '03b-test-erreur'); }
    await A.click('#qz-next');
  }
  await A.locator('#cel').getByRole('heading', { name: 'Test réussi : 9/10' }).waitFor();
  await shot(A, '03c-test-reussi');
  await A.click('#cel-close');
  await A.locator('#amb-waiting').waitFor();
});

await t('fondateur : valide l’inscription depuis « Ambassadeurs »', async () => {
  await signup(F, 'Fondateur', 'fondateur.amb@example.invalid');
  await local.db.query(`insert into fiila.staff (user_id, role) select id, 'super_admin' from auth.users where email = 'fondateur.amb@example.invalid'`);
  await F.goto(URL0 + '#/admin/ambassadeurs');
  await passMfa(F, 'fondateur.amb@example.invalid');
  await F.locator('#adm-review').getByText('Moussa Diop').waitFor();
  // Back-office : taux d'erreur par question du test (Moussa a manqué la question 4).
  await F.locator('#adm-quiz summary').click();
  assert.match((await F.locator('#adm-quiz').textContent()).replace(/\s/g, ' '), /1 test\(s\) terminé\(s\)[\s\S]*4\. Pouvez-vous passer des commandes[^%]*100 %/);
  await shot(F, '06-bo-ambassadeurs');
  await F.locator('#adm-review').getByRole('button', { name: 'Valider' }).click();
  await F.getByText('Moussa Diop validé.').waitFor();
  // Fiche : actions selon l'état, zone sensible pour supprimer le profil.
  await F.locator('#bo-amb-table tbody tr').filter({ hasText: 'Moussa Diop' }).locator('td').nth(1).click();
  await F.locator('#bo-amb-actions').getByRole('button', { name: 'Suspendre' }).waitFor();
  await F.locator('#bo-amb-delete').waitFor();
  await shot(F, '07-bo-fiche-ambassadeur');
  // Supprimer un profil (synthétique) depuis sa fiche : confirmation, puis retour à la liste ; la personne peut recommencer.
  const sid = (await local.db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'suppr.amb@example.invalid') returning id`)).rows[0].id;
  await local.db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Essai Suppr')`, [sid]);
  const reg = await rpc(local.db, 'fiila_ambassador_register', { p: { name: 'Essai Suppr', phone: '77 500 00 06', payout_method: 'wave', charter: true } }, { uid: sid });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  await F.goto(URL0 + '#/bo/agents?f=training');
  await F.locator('#bo-amb-table tbody tr').filter({ hasText: 'Essai Suppr' }).locator('td').nth(1).click();
  F.once('dialog', (d) => d.accept());
  await F.click('#bo-amb-delete');
  await F.getByText('Profil agent supprimé.').waitFor();
  assert.equal((await local.db.query(`select count(*)::int n from fiila.ambassadors where name = 'Essai Suppr'`)).rows[0].n, 0);
  await local.db.query(`delete from auth.users where id = $1`, [sid]);
  CODE = (await local.db.query(`select code from fiila.ambassadors`)).rows[0].code;
});

await t('ambassadeur : code, portefeuille, aucun commerçant ; un commerçant tape le code en créant sa boutique', async () => {
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  // Profil validé : la carte ambassadeur s'affiche une fois, en grand, avec le code.
  await A.locator('#cel').getByRole('heading', { name: 'Bienvenue dans l’équipe Fii La' }).waitFor();
  await A.locator('#cel').getByText(CODE).waitFor();
  await shot(A, '03d-profil-valide');
  await A.click('#cel-close');
  await A.locator('#cel').waitFor({ state: 'detached' });
  await A.locator('#amb-code').getByText(CODE).waitFor();
  await A.getByText('Aucun commerçant pour l’instant').waitFor();
  // Le Manager : missions du jour, conversation (réponse immédiate selon les règles), mission faite avec un retour.
  await A.locator('#amb-manager').getByText('Vos missions du jour').waitFor();
  await A.locator('#amb-manager .mgr-tasks li').first().waitFor();
  await A.click('#amb-chat-open');
  await A.locator('#mgr-thread').getByText(/profil est validé/).waitFor();
  await A.fill('#mgr-input', 'Quand suis-je payé ?');
  await A.click('#mgr-send');
  await A.locator('#mgr-thread').getByText(/vérifié 30 jours/).waitFor();
  await shot(A, '04c-manager-conversation');
  await A.click('#mgr-close');
  await A.locator('#amb-manager .mgr-check').first().click();
  await A.fill('#mgr-feedback', 'Le commerçant hésite, il veut voir une vraie vitrine');
  await A.click('#mgr-done-ok');
  await A.getByText(/Bien joué|Toutes vos missions/).first().waitFor();
  await A.locator('#amb-manager .mgr-tasks li.done').first().waitFor();
  await shot(A, '04d-manager-missions');
  await A.reload(); await A.locator('#amb-code').waitFor(); await A.waitForTimeout(900);
  assert.equal(await A.locator('#cel').count(), 0, 'la carte de validation ne revient pas');
  const M = await newPhone();
  await M.goto(URL0 + '#/boutique');
  await M.fill('#shop-name', 'Boutique Awa (test)');
  await M.selectOption('#shop-type', 'mode');
  if (!(await M.locator('#shop-more').evaluate((d) => d.open))) await M.locator('#shop-more > summary').click();
  await M.fill('#shop-amb', CODE);
  await M.click('#shop-save');
  await M.getByText('accompagnée par Moussa').waitFor();
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#amb-shops').getByText('Boutique Awa (test)').waitFor();
  assert.match(await A.locator('#amb-shops').textContent(), /5 article\(s\) avec photo/);
  await shot(A, '04-missions');
});

await t('niveau 1 atteint → gain en vérification ; après 30 jours le fondateur le verse ; l’ambassadeur le voit reçu', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
  const photo = Buffer.concat([png, Buffer.alloc(200)]).toString('base64');
  const owner = (await local.db.query(`select id from fiila.shops where name = 'Boutique Awa (test)'`)).rows[0].id;
  // [SIMULÉ] articles et vitrine ajoutés directement en base pour la boutique du commerçant.
  for (let i = 0; i < 5; i++) await local.db.query(`insert into fiila.products (shop_id, name, price, photo, photo_type) values ($1, $2, 1000, decode($3, 'base64'), 'image/png')`, [owner, 'Article ' + i, photo]);
  await local.db.query(`update fiila.shops set public = true, slug = 'boutique-awa-test' where id = $1`, [owner]);
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#cel').getByText('+ 2 000 FCFA').waitFor(); // le commerçant passe le niveau 1
  await shot(A, '04b-niveau');
  await A.click('#cel-close');
  await A.locator('#amb-wallet').getByText('2 000 FCFA').first().waitFor();
  await local.db.query(`update fiila.ambassador_rewards set validate_after = now() - interval '1 minute'`);
  await F.goto(URL0 + '#/'); await F.goto(URL0 + '#/admin/ambassadeurs');
  await F.locator('#adm-pay').getByText('Wave 77 500 00 01').waitFor();
  F.once('dialog', (d) => d.accept());
  await F.locator('#adm-pay').getByRole('button', { name: /J’ai versé 2 000/ }).click();
  await F.getByText('Marqué versé.').waitFor();
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#cel').getByRole('heading', { name: /2 000 FCFA versés/ }).waitFor();
  await A.click('#cel-close');
  const w = (await A.locator('#amb-wallet').textContent()).replace(/\s/g, ' ');
  assert.match(w, /Déjà reçu\s*2 000 FCFA/);
  // Depuis le compte : l'entrée « Fii La Carrière » montre l'état de l'ambassadeur
  await A.goto(URL0 + '#/compte');
  await A.locator('#amb-entry').getByText('Fii La Carrière · agent actif').waitFor();
  await A.click('#amb-entry');
  await A.locator('#amb-code').waitFor();
  await shot(A, '05-portefeuille');
});

await t('back-office : Manager Carrière — cap du mois, conversation de l’ambassadeur, réponse de l’équipe', async () => {
  await F.goto(URL0 + '#/bo/carriere');
  await F.locator('#bo-objective').waitFor();
  await F.click('#bo-obj-open');
  await F.fill('#bo-obj-brief', 'Priorité aux restaurants de Yoff.');
  await F.locator('#bo-obj-sheet').getByRole('button', { name: 'Restaurant, traiteur' }).click();
  await F.fill('#bo-obj-active', '10');
  await F.click('#bo-obj-save');
  await F.getByText('Cap du mois enregistré.').waitFor();
  await F.locator('#bo-objective').getByText('Priorité aux restaurants de Yoff.').waitFor();
  // Canal WhatsApp du Manager : numéro réglé par le Head of Stratégie (ici le super admin).
  F.once('dialog', (d) => d.accept('+221 77 999 00 00'));
  await F.click('#bo-wa-edit');
  await F.getByText('Numéro WhatsApp enregistré.').waitFor();
  await F.locator('#bo-wa').getByText('+221779990000').waitFor();
  await F.locator('#bo-threads-table tbody tr').filter({ hasText: 'Moussa Diop' }).locator('td').nth(1).click();
  await F.locator('#bo-career-thread').getByText('Quand suis-je payé ?').waitFor();
  await F.locator('#bo-career-thread').getByText(/vraie vitrine/).waitFor();
  assert.equal(await F.locator('#bo-career-wa').getAttribute('href'), 'https://wa.me/221775000001?text=' + encodeURIComponent('Bonjour Moussa, c’est votre Manager Fii La Carrière.'));
  await F.fill('#bo-career-input', 'Bravo Moussa, continuez !');
  await F.click('#bo-career-send');
  await F.getByText('Message envoyé.').waitFor();
  await shot(F, '08-bo-manager');
  await A.goto(URL0 + '#/'); await A.goto(URL0 + '#/ambassadeur');
  await A.locator('#amb-manager').getByText('Priorité aux restaurants de Yoff.').waitFor();
  assert.match(await A.locator('#amb-wa').getAttribute('href'), /^https:\/\/wa\.me\/221779990000\?text=Bonjour%2C%20c%E2%80%99est%20Moussa/);
  await A.click('#amb-chat-open');
  await A.locator('#mgr-thread').getByText('Bravo Moussa, continuez !').waitFor();
  await A.click('#mgr-close');
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests ambassadeurs réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
