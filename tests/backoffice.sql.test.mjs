// Tests SQL : back-office — rôles et droits, invitations nominatives, garde-fous d'équipe, suspension de boutique,
// fil, commandes, comptes, finances, réglages bornés, journal de toutes les actions.
import assert from 'node:assert/strict';
import { createDb, rpc, createUser } from './db.mjs';

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
  assert.equal(r.status, 400, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
async function user(email, name, admin = false) {
  const id = await createUser(db, email);
  await db.query(`insert into fiila.profiles (user_id, display_name, is_admin) values ($1, $2, $3)`, [id, name, admin]);
  return { uid: id };
}
const old = (u) => ({ ...u, loginAt: Math.floor(Date.now() / 1000) - 3600 });

// Le fondateur existait avant la migration : on simule l'état de production (case administrateur, rôle absent).
const FOUNDER = await user('fondateur@example.invalid', 'Assane Test', true);
await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [FOUNDER.uid]);
const NOBODY = await user('client@example.invalid', 'Client Test');
const KEY = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique BO [TEST]', phone: '77 500 00 01' } })).key;
const SHOP_ID = (await db.query(`select id from fiila.shops where name = 'Boutique BO [TEST]'`)).rows[0].id;
await ok('fiila_product_save', { p_key: KEY, p: { name: 'Article BO [TEST]', price: 5000 } });
await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true } });
const SLUG = (await db.query(`select slug from fiila.shops where id = $1`, [SHOP_ID])).rows[0].slug;

await t('portail : un compte sans rôle n’est pas de l’équipe ; le fondateur est super admin avec tous les droits', async () => {
  assert.deepEqual(await ok('fiila_bo_me', {}), { staff: false, auth: false });
  assert.equal((await ok('fiila_bo_me', {}, NOBODY)).staff, false);
  const me = await ok('fiila_bo_me', {}, FOUNDER);
  assert.equal(me.role, 'super_admin'); assert.ok(me.perms.includes('team') && me.perms.includes('settings'));
  await ko('fiila_bo_overview', {}, 'not_allowed', NOBODY);
  await ko('fiila_bo_overview', {}, 'auth_required');
});

let MOD;
await t('invitation nominative : lien à usage unique, pour cet e-mail seulement, valable 7 jours', async () => {
  await ko('fiila_bo_invite', { p_email: 'mod@example.invalid', p_role: 'moderation' }, 'reauth_required', old(FOUNDER));
  await ko('fiila_bo_invite', { p_email: 'pas-un-email', p_role: 'moderation' }, 'email_invalid', FOUNDER);
  await ko('fiila_bo_invite', { p_email: 'mod@example.invalid', p_role: 'roi' }, 'invalid_role', FOUNDER);
  await ko('fiila_bo_invite', { p_email: 'mod@example.invalid', p_role: 'moderation' }, 'not_allowed', NOBODY);
  const inv = await ok('fiila_bo_invite', { p_email: 'Mod@Example.invalid', p_role: 'moderation' }, FOUNDER);
  const pub = await ok('fiila_bo_invite_get', { p_token: inv.token });
  assert.equal(pub.state, 'ok'); assert.equal(pub.role, 'moderation'); assert.equal(pub.email, 'm•••@example.invalid');
  const raw = JSON.stringify((await db.query(`select * from fiila.staff_invites`)).rows);
  assert.ok(!raw.includes(inv.token), 'le lien n’est jamais gardé en clair');
  await ko('fiila_bo_invite_accept', { p_token: inv.token }, 'invite_email_mismatch', NOBODY);
  MOD = await user('mod@example.invalid', 'Mariama Test');
  assert.deepEqual(await ok('fiila_bo_invite_accept', { p_token: inv.token }, MOD), { role: 'moderation' });
  assert.equal((await ok('fiila_bo_invite_get', { p_token: inv.token })).state, 'used');
  await ko('fiila_bo_invite_accept', { p_token: inv.token }, 'invite_invalid', MOD);
  await ko('fiila_bo_invite', { p_email: 'mod@example.invalid', p_role: 'support' }, 'already_staff', FOUNDER);
  const inv2 = await ok('fiila_bo_invite', { p_email: 'expire@example.invalid', p_role: 'support' }, FOUNDER);
  await db.query(`update fiila.staff_invites set expires_at = now() - interval '1 minute' where id = $1`, [inv2.id]);
  assert.equal((await ok('fiila_bo_invite_get', { p_token: inv2.token })).state, 'expired');
  const inv3 = await ok('fiila_bo_invite', { p_email: 'annule@example.invalid', p_role: 'support' }, FOUNDER);
  await ok('fiila_bo_invite_revoke', { p_id: inv3.id }, FOUNDER);
  assert.equal((await ok('fiila_bo_invite_get', { p_token: inv3.token })).state, 'expired');
});

await t('droits par rôle : la modération voit la modération et le vide-dressing, pas les ambassadeurs ni l’équipe', async () => {
  const me = await ok('fiila_bo_me', {}, MOD);
  assert.equal(me.role, 'moderation');
  await ok('fiila_bo_overview', {}, MOD);
  await ok('fiila_admin_comments', {}, MOD);
  await ok('fiila_admin_vd', {}, MOD);
  await ko('fiila_admin_ambassadors', {}, 'not_allowed', MOD);
  await ko('fiila_bo_team', {}, 'not_allowed', MOD);
  await ko('fiila_bo_orders', {}, 'not_allowed', MOD);
  await ko('fiila_bo_accounts', {}, 'not_allowed', MOD);
  await ko('fiila_bo_settings', {}, 'not_allowed', MOD);
  const ov = await ok('fiila_bo_overview', {}, MOD);
  assert.equal(ov.queues.ambassadors, undefined, 'files hors de ses droits masquées');
  assert.equal(typeof ov.queues.vide_dressing, 'number');
  await ok('fiila_admin_ambassadors', {}, FOUNDER);
  await ok('fiila_admin_stats', {}, FOUNDER);
});

await t('équipe : jamais soi-même, jamais le dernier super admin ; changement de rôle puis retrait', async () => {
  await ko('fiila_bo_staff_set', { p_user: FOUNDER.uid, p_role: 'support' }, 'not_self', FOUNDER);
  const sup = await user('sup@example.invalid', 'Seydou Test');
  const inv = await ok('fiila_bo_invite', { p_email: 'sup@example.invalid', p_role: 'super_admin' }, FOUNDER);
  await ok('fiila_bo_invite_accept', { p_token: inv.token }, sup);
  await ko('fiila_bo_staff_set', { p_user: MOD.uid, p_role: 'support' }, 'reauth_required', old(FOUNDER));
  await ok('fiila_bo_staff_set', { p_user: MOD.uid, p_role: 'support' }, FOUNDER);
  assert.equal((await ok('fiila_bo_me', {}, MOD)).role, 'support');
  await ok('fiila_bo_staff_set', { p_user: sup.uid, p_role: null }, FOUNDER);
  assert.equal((await ok('fiila_bo_me', {}, sup)).staff, false);
  const team = await ok('fiila_bo_team', {}, FOUNDER);
  assert.deepEqual(team.members.map((m) => m.role).sort(), ['super_admin', 'support']);
  assert.equal(team.members.find((m) => m.me).email, 'fondateur@example.invalid');
  // un autre super admin peut rétrograder le fondateur ; le fondateur, alors sans droit d'équipe, ne peut plus rien changer
  const s2 = await user('s2@example.invalid', 'Deux Test');
  await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [s2.uid]);
  await ok('fiila_bo_staff_set', { p_user: FOUNDER.uid, p_role: 'operations' }, s2);
  assert.equal((await db.query(`select is_admin from fiila.profiles where user_id = $1`, [FOUNDER.uid])).rows[0].is_admin, false);
  await ko('fiila_bo_staff_set', { p_user: s2.uid, p_role: 'support' }, 'not_allowed', FOUNDER);
  await ok('fiila_bo_staff_set', { p_user: FOUNDER.uid, p_role: 'super_admin' }, s2);
  await ok('fiila_bo_staff_set', { p_user: s2.uid, p_role: null }, FOUNDER);
  assert.equal((await db.query(`select is_admin from fiila.profiles where user_id = $1`, [FOUNDER.uid])).rows[0].is_admin, true, 'case tenue à jour');
});

await t('suspension : motif obligatoire, vitrine fermée et non réouvrable par la boutique, réactivation', async () => {
  await ko('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'suspend' }, 'reason_required', FOUNDER);
  await ko('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'suspend', p_value: 'Test' }, 'not_allowed', MOD);  // support désormais
  await ok('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'suspend', p_value: 'Articles interdits (test)' }, FOUNDER);
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).state, 'closed');
  await ko('fiila_shop_vitrine', { p_key: KEY, p: { public: true } }, 'shop_suspended');
  const d = await ok('fiila_bo_shop', { p_id: SHOP_ID }, FOUNDER);
  assert.equal(d.suspended_reason, 'Articles interdits (test)');
  assert.equal(d.log[0].action, 'shop_suspend');
  assert.equal((await ok('fiila_bo_shops', { p_filter: 'suspended' }, FOUNDER)).shops.length, 1);
  await ok('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'unsuspend' }, FOUNDER);
  await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true } });
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).state, 'ok');
});

await t('recherche de boutiques (nom, téléphone), fiche, type ; boutique de la plateforme non suspendable', async () => {
  assert.equal((await ok('fiila_bo_shops', { p_q: 'bo [test' }, FOUNDER)).shops[0].id, SHOP_ID);
  assert.equal((await ok('fiila_bo_shops', { p_q: '+221 77 500 00 01' }, FOUNDER)).shops[0].id, SHOP_ID);
  await ok('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'set_type', p_value: 'mode' }, FOUNDER);
  assert.equal((await ok('fiila_bo_shop', { p_id: SHOP_ID }, FOUNDER)).type, 'mode');
  const pf = (await db.query(`select id from fiila.shops where platform`)).rows[0].id;
  await ko('fiila_bo_shop_action', { p_id: pf, p_action: 'suspend', p_value: 'x' }, 'not_allowed', FOUNDER);
});

await t('fil : liste des 25 places ; libérer une place la donne à la boutique suivante', async () => {
  const k2 = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Attente [TEST]' } })).key;
  await ok('fiila_product_save', { p_key: k2, p: { name: 'A [TEST]', price: 100 } });
  // Remplit les places restantes avec des boutiques factices pour tester l'attente.
  for (let i = 0; i < 30; i++) {
    const k = (await ok('fiila_shop_save', { p_key: null, p: { name: `Rempl ${i} [TEST]` } })).key;
    await ok('fiila_product_save', { p_key: k, p: { name: 'x', price: 100 } });
    await ok('fiila_shop_vitrine', { p_key: k, p: { public: true } });
  }
  await ok('fiila_shop_vitrine', { p_key: k2, p: { public: true } });
  const f = await ok('fiila_bo_feed', {}, FOUNDER);
  assert.equal(f.places.length, 25);
  assert.ok(f.waiting.length >= 1);
  const first = f.waiting[0];
  const ourRank = f.places.find((p) => p.id === SHOP_ID).rank;
  await ok('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'free_place' }, FOUNDER);
  const f2 = await ok('fiila_bo_feed', {}, FOUNDER);
  assert.equal(f2.places.find((p) => p.rank === ourRank).id, first.id, 'place donnée à la plus ancienne en attente');
  assert.ok(!f2.places.some((p) => p.id === SHOP_ID));
});

await t('commandes et comptes : recherche, fiche ; vue support sans droit sur l’équipe', async () => {
  const o = await ok('fiila_vitrine_order', { p_slug: SLUG, p: { items: [{ product_id: (await db.query(`select id from fiila.products where shop_id = $1`, [SHOP_ID])).rows[0].id, qty: 1 }], customer: { name: 'Awa Cliente [TEST]', phone: '70 111 22 33' } } });
  const list = await ok('fiila_bo_orders', { p_q: '70 111 22 33' }, MOD);
  assert.equal(list.orders.length, 1); assert.equal(list.orders[0].customer, 'Awa Cliente [TEST]');
  const od = await ok('fiila_bo_order', { p_id: list.orders[0].id }, MOD);
  assert.equal(od.total, 5000); assert.equal(od.address, 'pending');
  assert.equal(od.invoice, undefined, 'jamais le lien de facture au back-office');
  assert.equal((await ok('fiila_bo_orders', { p_status: 'delivered' }, MOD)).orders.length, 0);
  const acc = await ok('fiila_bo_accounts', { p_q: 'mariama' }, MOD);
  assert.equal(acc.accounts[0].email, 'mod@example.invalid'); assert.equal(acc.accounts[0].role, 'support');
  const a = await ok('fiila_bo_account', { p_id: MOD.uid }, MOD);
  assert.equal(a.role, 'support'); assert.equal(a.counts.comments, 0);
  await ko('fiila_bo_finance', {}, 'not_allowed', MOD);
  void o;
});

await t('finances et tableau de bord : chiffres hors boutiques de démonstration', async () => {
  const fin = await ok('fiila_bo_finance', {}, FOUNDER);
  assert.equal(fin.months.length, 6); assert.equal(fin.vd_commission, 15);
  const ov = await ok('fiila_bo_overview', {}, FOUNDER);
  assert.equal(ov.days.length, 14);
  assert.ok(ov.kpis.shops >= 32); assert.equal(ov.kpis.orders_30d, 1);
});

await t('réglages : liste fermée, bornes, reconnexion récente ; appliqués aussitôt', async () => {
  const s = await ok('fiila_bo_settings', {}, FOUNDER);
  assert.equal(s.vd_commission, 15); assert.equal(s.amb_reward_1, 2000);
  await ko('fiila_bo_setting_set', { p_key: 'vd_commission', p_value: 80 }, 'invalid_value', FOUNDER);
  await ko('fiila_bo_setting_set', { p_key: 'rate_salt', p_value: 1 }, 'invalid_setting', FOUNDER);
  await ko('fiila_bo_setting_set', { p_key: 'vd_commission', p_value: 20 }, 'reauth_required', old(FOUNDER));
  await ok('fiila_bo_setting_set', { p_key: 'vd_commission', p_value: 20 }, FOUNDER);
  assert.equal((await ok('fiila_bo_finance', {}, FOUNDER)).vd_commission, 20);
  await ok('fiila_bo_setting_set', { p_key: 'vd_commission', p_value: 15 }, FOUNDER);
});

await t('journal : chaque action est tracée (qui, quoi) ; réservé au super admin', async () => {
  const log = await ok('fiila_bo_audit', {}, FOUNDER);
  const actions = log.map((l) => l.action);
  for (const a of ['setting', 'shop_free_place', 'shop_set_type', 'shop_unsuspend', 'shop_suspend', 'team_role', 'team_remove', 'team_join', 'team_invite', 'team_invite_revoke']) {
    assert.ok(actions.includes(a), 'manque ' + a);
  }
  assert.match(log[0].actor, /^Assane · super_admin$/);
  await ko('fiila_bo_audit', {}, 'not_allowed', MOD);
});

await t('modération tracée : un commentaire supprimé par l’équipe apparaît au journal', async () => {
  const pid = (await db.query(`select id from fiila.products where shop_id = $1`, [SHOP_ID])).rows[0].id;
  await db.query(`update fiila.products set photo = decode('89504e470d0a1a0a', 'hex') where id = $1`, [pid]);
  const plat = (await db.query(`select id from fiila.shops where platform`)).rows[0].id;
  await db.query(`update fiila.products set shop_id = $1 where id = $2`, [plat, pid]);
  const c = await ok('fiila_comment_add', { p_product: pid, p_body: 'Commentaire test' }, NOBODY);
  await db.query(`update fiila.staff set role = 'moderation' where user_id = $1`, [MOD.uid]);
  await ok('fiila_admin_comment_decide', { p_id: c.id, p_action: 'delete' }, MOD);
  const log = await ok('fiila_bo_audit', {}, FOUNDER);
  assert.equal(log[0].action, 'comment_delete');
  assert.match(log[0].actor, /Mariama · moderation/);
});


await t('audit : invitation refusée à un compte sans e-mail ou à l’e-mail non confirmé', async () => {
  const inv = await ok('fiila_bo_invite', { p_email: 'nonconf@example.invalid', p_role: 'support' }, FOUNDER);
  const noMail = { uid: (await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), null) returning id`)).rows[0].id };
  await ko('fiila_bo_invite_accept', { p_token: inv.token }, 'invite_email_mismatch', noMail);
  const nc = await user('nonconf@example.invalid', 'Non Confirmé');
  await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [nc.uid]);
  await ko('fiila_bo_invite_accept', { p_token: inv.token }, 'email_unconfirmed', nc);
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [nc.uid]);
  assert.equal((await ok('fiila_bo_invite_accept', { p_token: inv.token }, nc)).role, 'support');
  await ok('fiila_bo_staff_set', { p_user: nc.uid, p_role: null }, FOUNDER);
});

await t('audit : le dernier super admin ne peut ni supprimer son compte ni disparaître de l’équipe', async () => {
  await ko('fiila_delete_account', {}, 'last_super_admin', FOUNDER);
  const r = await db.query(`select count(*)::int n from fiila.staff where role = 'super_admin'`);
  assert.equal(r.rows[0].n, 1);
  let threw = false;
  try { await db.query(`delete from fiila.staff where user_id = $1`, [FOUNDER.uid]); } catch (e) { threw = /last_super_admin/.test(e.message); }
  assert.ok(threw, 'même en direct, la base refuse');
});

await t('audit : modération = suspendre oui, changer le type non ; pas de téléphones au vide-dressing ; la finance reverse sans valider', async () => {
  await db.query(`update fiila.staff set role = 'moderation' where user_id = $1`, [MOD.uid]);
  await ok('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'suspend', p_value: 'Contrôle (test)' }, MOD);
  await ok('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'unsuspend' }, MOD);
  await ko('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'set_type', p_value: 'mode' }, 'not_allowed', MOD);
  await ko('fiila_bo_shop_action', { p_id: SHOP_ID, p_action: 'set_type', p_value: 'inconnu' }, 'invalid_value', FOUNDER);
  await db.query(`update fiila.profiles set phone = '77 999 00 01' where user_id = $1`, [NOBODY.uid]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64');
  const sub = await ok('fiila_vd_submit', { p: { title: 'Robe [TEST]', gender: 'fille', age_band: '2-4a', size: '3 ans', condition: 'bon', price: 2000,
    quartier: 'Yoff', photo: Buffer.concat([png, Buffer.alloc(200)]).toString('base64'), photo_ok: true } }, NOBODY);
  assert.ok(sub);
  const vdMod = await ok('fiila_admin_vd', {}, MOD);
  assert.ok(!JSON.stringify(vdMod).includes('77 999'), 'aucun téléphone pour la modération');
  assert.deepEqual(vdMod.orders, []);
  const fin = await user('fin@example.invalid', 'Fatim Finance');
  await db.query(`insert into fiila.staff (user_id, role) values ($1, 'finance')`, [fin.uid]);
  const vdFin = await ok('fiila_admin_vd', {}, fin);
  assert.equal(vdFin.can_pay, true); assert.equal(vdFin.can_review, false); assert.deepEqual(vdFin.queue, []);
  assert.equal(vdMod.queue.length, 1, 'l’article attend la vérification');
  {
    await ko('fiila_admin_vd_decide', { p_id: vdMod.queue[0].id, p_decision: 'approve', p_reason: null }, 'not_allowed', fin);
    await ok('fiila_admin_vd_decide', { p_id: vdMod.queue[0].id, p_decision: 'approve', p_reason: null }, MOD);
    const live = (await ok('fiila_admin_vd', {}, FOUNDER)).live[0];
    await ko('fiila_admin_vd_decide', { p_id: live.id, p_decision: 'sold', p_reason: null }, 'not_allowed', MOD);
    await ok('fiila_admin_vd_decide', { p_id: live.id, p_decision: 'sold', p_reason: null }, fin);
    // Un versement est dû à la vendeuse : elle ne peut pas supprimer son compte avant d'être payée.
    await ko('fiila_delete_account', {}, 'payout_pending', NOBODY);
    await ok('fiila_admin_vd_decide', { p_id: live.id, p_decision: 'paid', p_reason: null }, fin);
  }
});

await t('audit : la consultation d’une commande ou d’un compte est journalisée', async () => {
  const o = (await ok('fiila_bo_orders', {}, FOUNDER)).orders[0];
  await ok('fiila_bo_order', { p_id: o.id }, FOUNDER);
  await ok('fiila_bo_account', { p_id: NOBODY.uid }, FOUNDER);
  const log = await ok('fiila_bo_audit', {}, FOUNDER);
  assert.equal(log[0].action, 'view_account'); assert.equal(log[1].action, 'view_order');
});

await t('audit : suppression de compte ordinaire — réactions effacées, articles de vide-dressing retirés', async () => {
  const u = await user('quitte@example.invalid', 'Quitte Test');
  await db.query(`insert into fiila.likes (product_id, who) select id, 'u:' || $1 from fiila.products limit 1`, [u.uid]);
  await ok('fiila_delete_account', {}, u);
  assert.equal((await db.query(`select count(*)::int n from fiila.likes where who = 'u:' || $1`, [u.uid])).rows[0].n, 0);
});


await t('double authentification : sans le code (aal1), le portail le demande et chaque action est refusée', async () => {
  const a1 = { ...FOUNDER, aal: 'aal1' };
  const me = await ok('fiila_bo_me', {}, a1);
  assert.equal(me.staff, true); assert.equal(me.mfa, false); assert.equal(me.perms, undefined, 'aucun droit annoncé avant le code');
  for (const fn of ['fiila_bo_overview', 'fiila_bo_team', 'fiila_bo_shops', 'fiila_admin_comments', 'fiila_admin_vd', 'fiila_admin_ambassadors', 'fiila_admin_stats', 'fiila_bo_audit']) {
    await ko(fn, {}, 'mfa_required', a1);
  }
  await ko('fiila_bo_setting_set', { p_key: 'vd_commission', p_value: 15 }, 'mfa_required', a1);
  const shop = (await db.query(`select id from fiila.shops where not platform limit 1`)).rows[0].id;
  await ko('fiila_bo_shop_action', { p_id: shop, p_action: 'feed_off' }, 'mfa_required', a1);
  assert.equal((await ok('fiila_bo_me', {}, FOUNDER)).mfa, true, 'avec le code : accès normal');
  await ok('fiila_bo_overview', {}, FOUNDER);
  // Un compte hors équipe n'est pas concerné (rien ne change pour les utilisateurs).
  assert.equal((await ok('fiila_bo_me', {}, { ...NOBODY, aal: 'aal1' })).staff, false);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL back-office réussis`);
process.exit(passed === results.length ? 0 : 1);
