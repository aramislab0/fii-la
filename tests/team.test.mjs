// Équipe de la boutique de bout en bout : le propriétaire invite une personne (nom, WhatsApp, rôle), le message part sur
// WhatsApp avec un lien personnel ; la personne se connecte, rejoint la boutique comme éditrice (commandes, articles,
// clients, sans réglages ni suppression) ; le propriétaire change son rôle, puis la retire ; l'accès s'arrête aussitôt.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { passMfa } from './bo-mfa.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/equipe';
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
async function newPhone(width) {
  const ctx = await browser.newContext({ viewport: width ? { width, height: 800 } : phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium',
    hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true });
async function signup(p, name, email, retour) {
  await p.goto(URL0 + '#/compte?mode=inscription' + (retour ? '&retour=' + encodeURIComponent(retour) : ''));
  await p.getByRole('tab', { name: 'Créer un compte' }).click().catch(() => {});
  await p.fill('#acc-name', name);
  await p.fill('#acc-email', email);
  await p.fill('#acc-pass', 'motdepasse-test-123');
  await p.click('#auth-submit');
  await p.getByText('Compte créé.').waitFor();
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const O = await newPhone();
const E = await newPhone();
let LINK;

await t('propriétaire : Réglages → Équipe (section repliée), invitation avec nom, WhatsApp et rôle', async () => {
  await signup(O, 'Awa Ndiaye', 'awa.equipe@example.invalid');
  await O.goto(URL0 + '#/boutique');
  await O.fill('#shop-name', 'Boutique Awa (test)');
  await O.selectOption('#shop-type', 'mode');
  await O.click('#shop-save');
  await O.locator('#shop-setup[data-step="2"]').waitFor();
  await O.goto(URL0 + '#/boutique/reglages');
  // Réglages v2 : l'équipe s'ouvre depuis sa tuile, dans une feuille.
  await O.locator('#tile-team').getByText('Vous seul(e)').waitFor();
  await O.click('#tile-team');
  await O.locator('#team-section').waitFor();
  await O.locator('#team-list').getByText('Awa Ndiaye').waitFor();
  assert.match(await O.locator('#team-list').textContent(), /Propriétaire/);
  await O.click('#team-add');
  await O.locator('#team-sheet').waitFor();
  await O.fill('#team-name', 'Fatou Sow');
  await O.fill('#team-phone', '77 222 22 22');
  assert.match(await O.locator('#team-role-hint').textContent(), /Commandes, articles et clients/);
  await shot(O, '01-invitation');
  await O.click('#team-invite');
  const a = O.locator('#team-invite-send');
  await a.waitFor();
  const href = await a.getAttribute('href');
  const u = new URL(href);
  assert.equal(u.hostname, 'wa.me'); assert.match(u.pathname, /221772222222$/);
  const msg = u.searchParams.get('text');
  assert.match(msg, /^Bonjour Fatou, Boutique Awa \(test\) vous invite à rejoindre son équipe sur Fii \(éditeur\)/);
  LINK = msg.match(/https?:\S+#\/equipe\/[A-Za-z0-9_-]+/)[0];
  assert.ok(await noOverflow(O));
  await shot(O, '02-envoyer');
  await a.click();
  await O.locator('#team-list').getByText('Invité · Éditeur').waitFor();
});

await t('invitée : le lien explique le rôle ; connexion demandée, puis « Rejoindre la boutique »', async () => {
  await E.goto(LINK.replace(/^https?:\/\/[^#]+/, URL0));
  await E.getByRole('heading', { name: 'Vous êtes invité(e) à rejoindre son équipe' }).waitFor();
  await E.locator('#team-invite-card').getByText('Boutique Awa (test)', { exact: true }).waitFor();
  assert.match(await E.locator('#team-invite-role').textContent(), /Éditeur : commandes, articles et clients/);
  await E.locator('#team-login').waitFor();
  await shot(E, '03-lien-sans-compte');
  const retour = new URL((await E.locator('#team-login').getAttribute('href')).replace('#/compte', 'http://x/compte')).searchParams.get('retour');
  await signup(E, 'Fatou Sow', 'fatou.equipe@example.invalid', retour);
  await E.goto(LINK.replace(/^https?:\/\/[^#]+/, URL0));
  await E.click('#team-accept');
  await E.getByText('Vous avez rejoint Boutique Awa (test).').waitFor();
  await E.waitForFunction(() => location.hash === '#/boutique');
  await shot(E, '04-boutique-editrice');
});

await t('éditrice : crée un article ; pas de suppression ; Réglages réduits à son rôle et à la sortie', async () => {
  await E.goto(URL0 + '#/boutique/article/nouveau');
  await E.fill('#product-name', 'Robe wax (test)');
  await E.fill('#product-price', '12500');
  await E.click('#product-save');
  await E.waitForFunction(() => /#\/boutique\/article\/[0-9a-f-]{36}/.test(location.hash));
  await E.locator('#product-name').waitFor();
  assert.equal(await E.locator('#product-name').inputValue(), 'Robe wax (test)');
  assert.equal(await E.locator('#product-delete').count(), 0, 'pas de bouton Supprimer pour une éditrice');
  await E.goto(URL0 + '#/boutique/reglages');
  await E.locator('#member-role').getByText('Vous êtes éditeur de Boutique Awa (test).').waitFor();
  assert.equal(await E.locator('#shop-name').count(), 0, 'pas de réglages modifiables');
  assert.equal(await E.locator('#team-section').count(), 0);
  assert.equal(await E.locator('#shop-delete').count(), 0);
  await E.locator('#shop-leave-box').waitFor();
  await shot(E, '05-reglages-editrice');
});

await t('propriétaire : voit Fatou, la passe administratrice, puis la retire ; l’accès s’arrête aussitôt', async () => {
  await O.goto(URL0 + '#/'); await O.goto(URL0 + '#/boutique/reglages');
  await O.click('#tile-team');
  const row = O.locator('#team-list li', { hasText: 'Fatou Sow' });
  await row.locator('.small.muted').getByText('Éditeur').waitFor();
  await row.getByRole('button', { name: 'Modifier' }).click();
  await row.getByText('Administrateur').click();
  await O.getByText('Fatou Sow : administrateur.').waitFor();
  await O.locator('#team-list li', { hasText: 'Fatou Sow' }).locator('.small.muted').getByText('Administrateur', { exact: true }).waitFor();
  await shot(O, '06-equipe');
  // Administratrice : elle voit les réglages et l'équipe, mais pas la suppression de la boutique.
  await E.goto(URL0 + '#/'); await E.goto(URL0 + '#/boutique/reglages');
  await E.locator('#tile-info').waitFor();
  await E.click('#tile-team');
  await E.locator('#team-section').waitFor();
  assert.equal(await E.locator('#shop-delete-box').count(), 0);
  await E.locator('#shop-leave-box').waitFor();
  O.once('dialog', (d) => d.accept());
  const row2 = O.locator('#team-list li', { hasText: 'Fatou Sow' });
  await row2.getByRole('button', { name: 'Modifier' }).click();
  await row2.getByRole('button', { name: 'Retirer de l’équipe' }).click();
  await O.getByText('Fatou Sow a été retiré(e) de l’équipe.').waitFor();
  await E.goto(URL0 + '#/'); await E.goto(URL0 + '#/boutique');
  await E.locator('#shop-name').waitFor(); // plus de boutique : formulaire de création
});

await t('lien déjà utilisé ; aucun débordement à 320 px', async () => {
  const S = await newPhone(320);
  await S.goto(LINK.replace(/^https?:\/\/[^#]+/, URL0));
  await S.getByText('Invitation déjà acceptée').waitFor();
  assert.ok(await noOverflow(S));
  await O.setViewportSize({ width: 320, height: 800 });
  await O.goto(URL0 + '#/'); await O.goto(URL0 + '#/boutique/reglages');
  await O.click('#tile-team');
  await O.click('#team-add');
  await O.locator('#team-phone').waitFor();
  assert.ok(await noOverflow(O), 'réglages et équipe sans débordement à 320 px');
});

await t('compte : confirmer son numéro par code SMS (mauvais code refusé, puis confirmé)', async () => {
  const P = await newPhone();
  await signup(P, 'Ibou Fall', 'ibou.sms@example.invalid');
  await P.goto(URL0 + '#/compte?numero=1');
  await P.fill('#pv-phone', '77 900 00 01');
  await P.click('#pv-send');
  await P.locator('#pv-sent').getByText('+221 77 900 00 01').waitFor();
  const sms = local.auth.lastSms();
  assert.equal(sms.phone, '+221779000001');
  await P.fill('#pv-code', '000000');
  await P.click('#pv-ok');
  await P.getByText('Code incorrect ou expiré').waitFor();
  await P.fill('#pv-code', sms.otp);
  await P.click('#pv-ok');
  await P.locator('#pv-done').waitFor();
  await shot(P, '07-numero-confirme');
  await P.goto(URL0 + '#/'); await P.goto(URL0 + '#/compte');
  await P.locator('#phone-box summary').getByText('Numéro confirmé : +221 77 900 00 01').waitFor();
});

await t('code SMS exigé (réglage) : l’invitée confirme le numéro invité, puis rejoint la boutique', async () => {
  await local.db.query(`update fiila.settings set value = '1' where key = 'sms_verify'`);
  await O.setViewportSize(phone.viewport);
  await O.goto(URL0 + '#/'); await O.goto(URL0 + '#/boutique/reglages');
  await O.click('#tile-team');
  await O.click('#team-add');
  await O.fill('#team-name', 'Mame Diarra');
  await O.fill('#team-phone', '77 333 44 55');
  await O.click('#team-invite');
  const msg = new URL(await O.locator('#team-invite-send').getAttribute('href')).searchParams.get('text');
  const link = msg.match(/https?:\S+#\/equipe\/[A-Za-z0-9_-]+/)[0].replace(/^https?:\/\/[^#]+/, URL0);
  const M = await newPhone();
  await signup(M, 'Mame Diarra', 'mame.sms@example.invalid');
  await M.goto(link);
  await M.locator('#team-verify-note').waitFor();
  await M.click('#team-accept');
  assert.equal(await M.locator('#pv-phone').inputValue(), '77 333 44 55', 'numéro invité prérempli');
  await M.click('#pv-send');
  await M.locator('#pv-sent').waitFor();
  await M.fill('#pv-code', local.auth.lastSms().otp);
  await shot(M, '08-invitation-code-sms');
  await M.click('#pv-ok');
  await M.getByText('Vous avez rejoint Boutique Awa (test).').waitFor();
  await O.goto(URL0 + '#/'); await O.goto(URL0 + '#/boutique/reglages');
  await O.click('#tile-team');
  await O.locator('#team-list li', { hasText: 'Mame Diarra' }).getByText('numéro confirmé').waitFor();
  await local.db.query(`update fiila.settings set value = '0' where key = 'sms_verify'`);
});

await t('back-office : l’équipe de la boutique (rôle, numéro confirmé) et le retrait d’un membre, tracé au journal', async () => {
  await local.db.query(`insert into fiila.staff (user_id, role) select id, 'super_admin' from auth.users where email = 'awa.equipe@example.invalid'`);
  const shopId = (await local.db.query(`select id from fiila.shops where name = 'Boutique Awa (test)'`)).rows[0].id;
  await O.setViewportSize({ width: 1280, height: 900 });
  await O.goto(URL0 + '#/bo/boutiques/' + shopId);
  await passMfa(O, 'awa.equipe@example.invalid');
  const team = O.locator('#bo-shop-team');
  await team.getByText('Mame Diarra').waitFor();
  await team.getByText('Confirmé par SMS').waitFor();
  await O.locator('#bo-shop-team').scrollIntoViewIfNeeded();
  await shot(O, '09-back-office-equipe');
  O.once('dialog', (d) => d.accept());
  await team.getByRole('button', { name: 'Retirer' }).first().click();
  await O.getByText('Mame Diarra retiré(e) de l’équipe.').waitFor();
  await O.goto(URL0 + '#/bo/journal');
  await O.getByText(/a retiré un membre de l’équipe de la boutique Boutique Awa \(test\) \(Mame Diarra\)/).first().waitFor();
  await O.goto(URL0 + '#/bo');
  await O.locator('#kpi-members').waitFor();
  await O.locator('#kpi-photos').waitFor();
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests équipe de boutique réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
