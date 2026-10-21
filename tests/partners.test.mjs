// Programme Ambassadeurs (marques invitées) de bout en bout, côté marque : lien d'invitation (lecture sans effet), acceptation
// avec création guidée de la boutique, essai « prêt » dans le tableau de bord, « Activer mon essai », pack bloqué, lien retiré.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
import { rpc } from './db.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, webkit, devices } = pw;
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = 'docs/screenshots/ambassadeurs-marques';
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
const ok = async (fn, args, opt) => { const r = await rpc(local.db, fn, args, opt); assert.equal(r.status, 200, fn + ' ' + JSON.stringify(r.body)); return r.body; };
const pages = [];
async function newPhone(scheme) {
  const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: 2, isMobile: ENGINE === 'chromium', hasTouch: true, userAgent: phone.userAgent, locale: 'fr-FR', serviceWorkers: 'block', colorScheme: scheme || 'light' });
  await ctx.route('https://wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  pages.push(page);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(700); return page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png`, fullPage: true }); };

const uid = (await local.db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'fondateur@example.test') returning id`)).rows[0].id;
await local.db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Assane')`, [uid]);
await local.db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [uid]);
const F = { uid };
await ok('fiila_bo_pack_save', { p: { code: 'complet', name: 'Pack complet (test)', benefits: ['Vitrine mise en avant dans le fil', 'Accompagnement du Manager'], exclusions: ['Publicité payante'] } }, F);
const INV = await ok('fiila_bo_partner_invite', { p: { brand: 'Maison Diallo (test)', activity: 'Prêt-à-porter', whatsapp: '77 700 00 01', months: 2 } }, F);

let P;
await t('lien d’invitation : la marque, la durée et le contenu exact du pack ; ouvrir ne change rien', async () => {
  P = await newPhone();
  await P.goto(URL0 + '#/invitation/' + INV.token);
  await P.locator('#partner-invite').getByText('Maison Diallo (test)').waitFor();
  assert.match(await P.locator('body').textContent(), /2 mois/);
  await P.getByText('Accompagnement du Manager').waitFor();
  await P.getByText('Non inclus : Publicité payante').waitFor();
  await shot(P, '01-invitation');
  await P.reload(); await P.locator('#partner-invite').waitFor();
  assert.equal((await ok('fiila_partner_invite', { p_token: INV.token })).state, 'valid');
});

await t('accepter sans boutique : création guidée, invitation acceptée ; l’essai attend « Activer mon essai »', async () => {
  await P.click('#invite-accept');
  await P.locator('#shop-setup[data-step="1"]').waitFor();
  await P.fill('#shop-name', 'Maison Diallo (test)'); await P.selectOption('#shop-type', 'mode');
  await P.click('#shop-save');
  await P.locator('#shop-setup[data-step="2"]').waitFor();
  await P.waitForFunction(() => !localStorage.getItem('fiila.partner.invite'));
  assert.equal((await ok('fiila_partner_invite', { p_token: INV.token })).state, 'accepted');
  await P.click('#setup-later');
  await P.locator('#partner-card').getByText('Votre essai de 2 mois vous attend').waitFor();
  await shot(P, '02-essai-a-activer');
  await P.click('#trial-activate');
  await P.locator('#cel').getByText('Votre essai commence').waitFor();
  await P.click('#cel-close');
  await P.locator('#partner-card').getByText(/Essai en cours jusqu’au/).waitFor();
  await shot(P, '03-essai-en-cours');
  await P.click('#partner-chat');
  await P.fill('#pmsg-input', 'Je commence par quoi ?');
  await P.click('#pmsg-send');
  await P.locator('#pmsg-list').getByText(/premier article/).waitFor();
  await P.fill('#pmsg-input', 'Et après, combien ça coûte ?');
  await P.click('#pmsg-send');
  await P.locator('#pmsg-list').getByText('Transmis à l’équipe').waitFor();
  await shot(P, '03b-manager');
});

await t('pack bloqué (Studio non prêt) : rien ne s’active, message clair', async () => {
  await ok('fiila_bo_pack_save', { p: { code: 'complet', name: 'Pack avec Studio (test)', benefits: ['Retouches photo'], limits: { studio_credits: 10 } } }, F);
  const inv = await ok('fiila_bo_partner_invite', { p: { brand: 'Studio Beauté (test)', months: 1 } }, F);
  const Q = await newPhone('dark');
  await Q.goto(URL0 + '#/invitation/' + inv.token);
  await Q.click('#invite-accept');
  await Q.fill('#shop-name', 'Studio Beauté (test)'); await Q.selectOption('#shop-type', 'beaute');
  await Q.click('#shop-save');
  await Q.locator('#shop-setup[data-step="2"]').waitFor();
  await Q.click('#setup-later');
  await Q.locator('#trial-blocked').waitFor();
  assert.equal(await Q.locator('#trial-activate').count(), 0);
  await shot(Q, '04-pack-bloque-sombre');
});

await t('lien retiré : message « Invitation retirée », aucune action possible', async () => {
  const inv = await ok('fiila_bo_partner_invite', { p: { brand: 'Retirée (test)', months: 1 } }, F);
  await ok('fiila_bo_partner_action', { p_id: inv.id, p_action: 'revoke', p_reason: 'Test' }, F);
  const R = await newPhone();
  await R.goto(URL0 + '#/invitation/' + inv.token);
  await R.getByText('Invitation retirée').waitFor();
  assert.equal(await R.locator('#invite-accept').count(), 0);
});

await t('aucune erreur JavaScript', async () => { assert.deepEqual(pages.flatMap((p) => p.__errors), []); });
await browser.close();
local.server.close();
console.log(`\n${passed}/${passed + failed} tests ambassadeurs (marques) réussis — ${ENGINE} ${version}`);
process.exit(failed ? 1 : 0);
