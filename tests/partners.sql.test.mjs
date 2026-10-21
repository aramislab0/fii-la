// Tests SQL : mandat AGENTS-AMBASSADEURS-001, lot 3 — programme Ambassadeurs (marques invitées) : invitations, packs versionnés,
// essai exact appliqué par le serveur, droits de l'équipe, aucune double acceptation ni double avantage, aucun gain d'agent.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => {
  const r = await rpc(db, fn, args, opt);
  assert.notEqual(r.status, 200, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
let FOUNDER, STRAT, SUPPORT, INV, SHOP, SHOP2;

await t('packs : versions créées par le super admin seulement ; un pack « Studio » reste BLOCKED_DEPENDENCY tant que le Studio n’est pas prêt', async () => {
  FOUNDER = await user('assane@example.test', 'super_admin'); STRAT = await user('head@example.test', 'strategy'); SUPPORT = await user('aide@example.test', 'support');
  await ko('fiila_bo_pack_save', { p: { code: 'complet', name: 'X', benefits: ['A'] } }, 'not_allowed', STRAT);
  await ko('fiila_bo_pack_save', { p: { code: 'complet', name: 'Pack complet', benefits: [] } }, 'pack_benefits_required', FOUNDER);
  const p1 = await ok('fiila_bo_pack_save', { p: { code: 'complet', name: 'Pack complet', benefits: ['Vitrine mise en avant [TEST]', 'Retouches photo [TEST]'], limits: { studio_credits: 20 }, exclusions: ['Publicité payante [TEST]'] } }, FOUNDER);
  assert.equal(p1.version, 1); assert.equal(p1.ready, false); assert.equal(p1.blocked, 'BLOCKED_DEPENDENCY');
  const p2 = await ok('fiila_bo_pack_save', { p: { code: 'complet', name: 'Pack complet sans Studio', benefits: ['Vitrine mise en avant [TEST]'] } }, FOUNDER);
  assert.equal(p2.version, 2); assert.equal(p2.ready, true);
});

await t('inviter une marque : droit « partners » (pas le support) ; jeton rendu une fois, seule son empreinte est gardée', async () => {
  await ko('fiila_bo_partner_invite', { p: { brand: 'Marque X', months: 1 } }, 'not_allowed', SUPPORT);
  await ko('fiila_bo_partner_invite', { p: { brand: 'Marque X', months: 3 } }, 'invalid_payload', STRAT);
  INV = await ok('fiila_bo_partner_invite', { p: { brand: 'Maison Diallo [TEST]', activity: 'Prêt-à-porter', whatsapp: '77 700 00 01', months: 1 } }, STRAT);
  assert.match(INV.token, /^[A-Za-z0-9_-]{32}$/); assert.equal(INV.pack.version, 2, 'dernière version du pack');
  const raw = await one(`select count(*)::int n from fiila.partner_invites where token_hash::text like '%' || $1 || '%'`, [INV.token]);
  assert.equal(raw.n, 0, 'le jeton n’est pas stocké en clair');
  const log = await one(`select count(*)::int n from fiila.admin_log where action = 'partner_invite'`);
  assert.equal(log.n, 1, 'invitation tracée au journal');
});

await t('lire l’invitation ne change rien (aperçus WhatsApp, ouvertures répétées)', async () => {
  const before = await one(`select status, expires_at, token_hash from fiila.partner_invites where id = $1`, [INV.id]);
  for (let i = 0; i < 3; i++) { const v = await ok('fiila_partner_invite', { p_token: INV.token }); assert.equal(v.state, 'valid'); assert.equal(v.brand, 'Maison Diallo [TEST]'); }
  const after = await one(`select status, expires_at, token_hash from fiila.partner_invites where id = $1`, [INV.id]);
  assert.deepEqual(after, before);
  assert.equal((await ok('fiila_partner_invite', { p_token: 'x'.repeat(32) })).state, 'not_found');
});

await t('acceptation : preuve de propriété (clé), une seule fois ; même boutique = sans effet ; autre boutique refusée', async () => {
  SHOP = await ok('fiila_shop_save', { p_key: null, p: { name: 'Maison Diallo [TEST]', business_type: 'mode' } });
  SHOP2 = await ok('fiila_shop_save', { p_key: null, p: { name: 'Autre boutique [TEST]', business_type: 'mode' } });
  await ko('fiila_partner_accept', { p_token: INV.token, p_key: 'cle-fausse' }, 'shop_required');
  const a = await ok('fiila_partner_accept', { p_token: INV.token, p_key: SHOP.key });
  assert.equal(a.trial.status, 'ready'); assert.equal(a.trial.activated_at, undefined, 'l’essai ne démarre pas à l’acceptation');
  const again = await ok('fiila_partner_accept', { p_token: INV.token, p_key: SHOP.key });
  assert.equal(again.again, true);
  await ko('fiila_partner_accept', { p_token: INV.token, p_key: SHOP2.key }, 'invite_used');
  assert.equal((await one(`select count(*)::int n from fiila.partner_trials`)).n, 1, 'un seul essai');
  assert.equal((await ok('fiila_partner_invite', { p_token: INV.token })).state, 'accepted');
});

await t('activation : « Activer mon essai » idempotente ; dates du serveur en mois calendaires (Dakar)', async () => {
  const a1 = await ok('fiila_partner_activate', { p_key: SHOP.key });
  assert.equal(a1.trial.status, 'active');
  const a2 = await ok('fiila_partner_activate', { p_key: SHOP.key });
  assert.equal(a2.again, true); assert.equal(a2.trial.ends_at, a1.trial.ends_at, 'aucune date recalculée');
  const r = await one(`select fiila.trial_end('2027-01-31 10:00+00', 1) e1, fiila.trial_end('2028-01-31 23:59+00', 1) e2`);
  assert.equal(r.e1.toISOString(), '2027-03-01T00:00:00.000Z', '31 janvier + 1 mois → fin le 28 février inclus');
  assert.equal(r.e2.toISOString(), '2028-03-01T00:00:00.000Z', 'année bissextile → 29 février inclus');
  assert.equal((await one(`select fiila.partner_active($1) a`, [SHOP.shop.id])).a, true);
});

await t('échéance : avantages retirés, boutique et catalogue intacts ; prolongation réservée au super admin et tracée', async () => {
  await ok('fiila_product_save', { p_key: SHOP.key, p: { name: 'Robe [TEST]', price: 10000 } });
  await db.query(`update fiila.partner_trials set ends_at = now() - interval '1 minute' where shop_id = $1`, [SHOP.shop.id]);
  const m = await ok('fiila_partner_mine', { p_key: SHOP.key });
  assert.equal(m.trial.status, 'ended');
  assert.equal((await one(`select fiila.partner_active($1) a`, [SHOP.shop.id])).a, false);
  assert.equal((await one(`select count(*)::int n from fiila.products where shop_id = $1`, [SHOP.shop.id])).n, 1, 'catalogue conservé');
  await ko('fiila_bo_partner_action', { p_id: INV.id, p_action: 'extend', p_reason: null }, 'not_allowed', STRAT);
  await ok('fiila_bo_partner_action', { p_id: INV.id, p_action: 'extend', p_reason: 'Bon démarrage' }, FOUNDER);
  assert.equal((await one(`select months from fiila.partner_trials where shop_id = $1`, [SHOP.shop.id])).months, 2);
  assert.equal((await one(`select count(*)::int n from fiila.admin_log where action = 'partner_extend'`)).n, 1);
});

await t('pack bloqué : activation refusée (BLOCKED_DEPENDENCY) ; boutique désignée : seule elle peut accepter', async () => {
  const inv = await ok('fiila_bo_partner_invite', { p: { brand: 'Studio Marque [TEST]', months: 2 } }, FOUNDER);
  await db.query(`update fiila.partner_invites set pack_version = 1 where id = $1`, [inv.id]);
  const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Studio Marque [TEST]', business_type: 'beaute' } });
  await ok('fiila_partner_accept', { p_token: inv.token, p_key: s.key });
  await db.query(`update fiila.partner_trials set pack_version = 1 where shop_id = $1`, [s.shop.id]);
  await ko('fiila_partner_activate', { p_key: s.key }, 'pack_blocked_dependency');
  await db.query(`update fiila.shops set slug = 'boutique-designee', public = true where id = $1`, [SHOP2.shop.id]);
  const inv2 = await ok('fiila_bo_partner_invite', { p: { brand: 'Désignée [TEST]', months: 1, shop_slug: 'boutique-designee' } }, FOUNDER);
  const s3 = await ok('fiila_shop_save', { p_key: null, p: { name: 'Intruse [TEST]', business_type: 'mode' } });
  await ko('fiila_partner_accept', { p_token: inv2.token, p_key: s3.key }, 'invite_other_shop');
  await ok('fiila_partner_accept', { p_token: inv2.token, p_key: SHOP2.key });
});

await t('révocation et expiration échouent proprement ; régénérer invalide l’ancien lien', async () => {
  const inv = await ok('fiila_bo_partner_invite', { p: { brand: 'Révoquée [TEST]', months: 1 } }, FOUNDER);
  const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Révoquée [TEST]', business_type: 'mode' } });
  const re = await ok('fiila_bo_partner_action', { p_id: inv.id, p_action: 'regenerate', p_reason: null }, STRAT);
  assert.equal((await ok('fiila_partner_invite', { p_token: inv.token })).state, 'not_found', 'ancien lien inactif');
  assert.equal((await ok('fiila_partner_invite', { p_token: re.token })).state, 'valid');
  await ko('fiila_bo_partner_action', { p_id: inv.id, p_action: 'revoke', p_reason: '' }, 'reason_required', FOUNDER);
  await ok('fiila_bo_partner_action', { p_id: inv.id, p_action: 'revoke', p_reason: 'Erreur de marque' }, FOUNDER);
  await ko('fiila_partner_accept', { p_token: re.token, p_key: s.key }, 'invite_revoked');
  const old = await ok('fiila_bo_partner_invite', { p: { brand: 'Expirée [TEST]', months: 1 } }, FOUNDER);
  await db.query(`update fiila.partner_invites set expires_at = now() - interval '1 second' where id = $1`, [old.id]);
  assert.equal((await ok('fiila_partner_invite', { p_token: old.token })).state, 'expired');
  await ko('fiila_partner_accept', { p_token: old.token, p_key: s.key }, 'invite_expired');
});

await t('aucun gain d’agent pour une boutique partenaire ; un agent peut aussi être commerçant et acheteur sans fuite de droits', async () => {
  const A = await user('agent@example.test');
  const reg = await ok('fiila_ambassador_register', { p: { name: 'Agent Test', phone: '77 700 00 09', payout_method: 'wave', charter: true } }, A);
  await db.query(`update fiila.ambassadors set status = 'active' where code = $1`, [reg.ambassador.code]);
  await ok('fiila_ambassador_link', { p_key: SHOP.key, p_code: reg.ambassador.code }).catch(() => {});
  await db.query(`insert into fiila.ambassador_shops (ambassador_id, shop_id) select id, $1 from fiila.ambassadors where code = $2 on conflict do nothing`, [SHOP.shop.id, reg.ambassador.code]);
  await db.query(`update fiila.ambassador_shops set l1_at = linked_at where shop_id = $1`, [SHOP.shop.id]);
  await ok('fiila_ambassador_me', {}, A);
  assert.equal((await one(`select count(*)::int n from fiila.ambassador_rewards where shop_id = $1`, [SHOP.shop.id])).n, 0);
  await ko('fiila_bo_partners', {}, 'not_allowed', A);
  await ko('fiila_partner_activate', { p_key: null }, 'shop_required', A);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL ambassadeurs (marques) réussis`);
process.exit(passed === results.length ? 0 : 1);
