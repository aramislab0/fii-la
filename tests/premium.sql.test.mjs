// Tests SQL : vitrine premium (22/10/2026). Logo de la boutique, Snapchat, modèles premium réservés aux boutiques Premium
// (refus clair sinon ; retour à Galerie si l’abonnement s’arrête), abonnement réglé au back-office et journalisé.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
let S, slug, F;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
const photo = (n) => Buffer.concat([png, Buffer.alloc(200 + n)]).toString('base64');

await t('logo : ajouté, servi par la vitrine (data URL), retiré ; trop lourd refusé', async () => {
  S = await ok('fiila_shop_save', { p_key: null, p: { name: 'Maison Premium [TEST]', business_type: 'mode' } });
  let r = await ok('fiila_shop_vitrine', { p_key: S.key, p: { public: true, logo: photo(1) } });
  assert.match(r.logo, /^data:image\/png;base64,iVBOR/);
  slug = r.slug;
  assert.match((await ok('fiila_vitrine', { p_slug: slug })).shop.logo, /^data:image\/png;base64,/);
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { logo: photo(90000) } }, 'photo_too_large');
  r = await ok('fiila_shop_vitrine', { p_key: S.key, p: { logo: '' } });
  assert.equal(r.logo, undefined);
  assert.equal((await ok('fiila_vitrine', { p_slug: slug })).shop.logo, undefined);
});

await t('réseaux : Snapchat accepté (nom ou lien snapchat.com/add/…)', async () => {
  const r = await ok('fiila_shop_vitrine', { p_key: S.key, p: { socials: { instagram: '@maison', snapchat: 'https://www.snapchat.com/add/maison.snap' } } });
  assert.deepEqual(r.socials, { instagram: 'maison', snapchat: 'maison.snap' });
});

await t('modèles premium : refusés pour une boutique gratuite ; acceptés une fois Premium ; retour à Galerie si l’abonnement s’arrête', async () => {
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { theme: 'atelier' } }, 'premium_required');
  await ko('fiila_shop_vitrine', { p_key: S.key, p: { theme: 'luxe' } }, 'invalid_theme');
  F = await user('fondateur@example.test', 'super_admin');
  await ko('fiila_bo_shop_action', { p_id: S.shop.id, p_action: 'set_plan', p_value: 'gold' }, 'invalid_value', F);
  await ok('fiila_bo_shop_action', { p_id: S.shop.id, p_action: 'set_plan', p_value: 'premium' }, F);
  let r = await ok('fiila_shop_vitrine', { p_key: S.key, p: { theme: 'maison' } });
  assert.equal(r.theme, 'maison'); assert.equal(r.shown_theme, 'maison'); assert.equal(r.plan, 'premium');
  assert.equal((await ok('fiila_vitrine', { p_slug: slug })).shop.theme, 'maison');
  await ok('fiila_bo_shop_action', { p_id: S.shop.id, p_action: 'set_plan', p_value: 'free' }, F);
  r = await ok('fiila_shop_vitrine', { p_key: S.key, p: null });
  assert.equal(r.theme, 'maison', 'le choix est gardé'); assert.equal(r.shown_theme, 'galerie');
  assert.equal((await ok('fiila_vitrine', { p_slug: slug })).shop.theme, 'galerie');
  const d = await ok('fiila_bo_shop', { p_id: S.shop.id }, F);
  assert.equal(d.plan, 'free'); assert.equal(d.theme, 'maison'); assert.equal(d.shown_theme, 'galerie');
  const log = await one(`select count(*)::int n from fiila.admin_log where action = 'shop_set_plan' and target_id = $1`, [S.shop.id]);
  assert.equal(log.n, 2, 'les deux changements réussis sont journalisés');
});

await t('abonnement : réservé à l’équipe (droit boutiques) ; mesure anonyme « premium »', async () => {
  const CLI = await user('cliente@example.test');
  await ko('fiila_bo_shop_action', { p_id: S.shop.id, p_action: 'set_plan', p_value: 'premium' }, null, CLI);
  for (const v of ['atelier:locked', 'comptoir:preview', 'maison:interest', 'atelier:applied']) await ok('fiila_track', { p_event: 'premium', p_variant: v });
  await ko('fiila_track', { p_event: 'premium', p_variant: 'luxe:locked' });
  const o = await ok('fiila_bo_onboarding', {}, F);
  assert.equal(o.premium['atelier:locked'], 1); assert.equal(o.premium_shops, 0);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL vitrine premium réussis`);
process.exit(passed === results.length ? 0 : 1);
