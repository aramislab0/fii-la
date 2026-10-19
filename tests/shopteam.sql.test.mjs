// Tests SQL : équipe de la boutique — invitation (nom, numéro, rôle), acceptation par un compte, droits du propriétaire,
// de l'administrateur et de l'éditeur, retrait, départ, garde-fous (un compte = une boutique, 10 personnes au plus).
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
async function user(email, name) {
  const id = await createUser(db, email);
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, name]);
  return { uid: id };
}
const OWNER = await user('proprio.team@example.invalid', 'Awa Proprio');
const ADMIN = await user('admin.team@example.invalid', 'Moussa Admin');
const EDITOR = await user('editeur.team@example.invalid', 'Fatou Editrice');
const OTHER = await user('autre.team@example.invalid', 'Autre Boutique');
const NOBODY = await user('client.team@example.invalid', 'Client');
await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Équipe [TEST]', phone: '77 500 00 09' } }, OWNER);
await ok('fiila_shop_save', { p_key: null, p: { name: 'Autre Boutique [TEST]' } }, OTHER);
const P1 = (await ok('fiila_product_save', { p_key: null, p: { name: 'Article Équipe [TEST]', price: 5000 } }, OWNER)).product?.id
  ?? (await db.query(`select id from fiila.products where name = 'Article Équipe [TEST]'`)).rows[0].id;
let TOK_ADMIN, TOK_EDITOR;

await t('propriétaire : rôle « owner », équipe vide ; un compte sans boutique ne voit rien', async () => {
  assert.equal((await ok('fiila_shop_get', { p_key: null }, OWNER)).shop.role, 'owner');
  const team = await ok('fiila_shop_team', { p_key: null }, OWNER);
  assert.deepEqual(team.members, []); assert.deepEqual(team.invites, []); assert.equal(team.owner.name, 'Awa Proprio');
  await ko('fiila_shop_team', { p_key: null }, 'shop_required', NOBODY);
  await ko('fiila_shop_team', { p_key: null }, 'shop_required');
});

await t('invitation : nom, numéro et rôle ; numéro et rôle obligatoires ; une seule invitation en attente par numéro', async () => {
  await ko('fiila_shop_invite', { p_key: null, p_name: 'X', p_phone: '', p_role: 'admin' }, 'phone_invalid', OWNER);
  await ko('fiila_shop_invite', { p_key: null, p_name: 'X', p_phone: '77 000 00 00', p_role: 'owner' }, 'invalid_role', OWNER);
  TOK_ADMIN = (await ok('fiila_shop_invite', { p_key: null, p_name: 'Moussa', p_phone: '77 111 11 11', p_role: 'admin' }, OWNER)).token;
  const again = await ok('fiila_shop_invite', { p_key: null, p_name: 'Moussa D.', p_phone: '77 111 11 11', p_role: 'admin' }, OWNER);
  assert.equal(again.team.invites.length, 1, 'la nouvelle invitation remplace l’ancienne');
  await ok('fiila_shop_invite_get', { p_token: TOK_ADMIN }).then((r) => assert.equal(r.state, 'not_found', 'ancien lien annulé'));
  TOK_ADMIN = again.token;
  TOK_EDITOR = (await ok('fiila_shop_invite', { p_key: null, p_name: 'Fatou', p_phone: '77 222 22 22', p_role: 'editor' }, OWNER)).token;
  const g = await ok('fiila_shop_invite_get', { p_token: TOK_EDITOR });
  assert.deepEqual(g, { state: 'ok', shop: 'Boutique Équipe [TEST]', role: 'editor', name: 'Fatou', phone: '77 222 22 22' });
  const hashed = (await db.query(`select count(*)::int n from fiila.shop_invites where token_hash = convert_to($1, 'UTF8')`, [TOK_EDITOR])).rows[0].n;
  assert.equal(hashed, 0, 'le jeton n’est jamais stocké en clair');
});

await t('acceptation : compte obligatoire ; un compte qui a déjà une boutique ne peut pas rejoindre', async () => {
  await ko('fiila_shop_invite_accept', { p_token: TOK_ADMIN }, 'auth_required|not_authenticated|login');
  await ko('fiila_shop_invite_accept', { p_token: TOK_ADMIN }, 'has_shop', OTHER);
  await ko('fiila_shop_invite_accept', { p_token: TOK_ADMIN }, 'already_member', OWNER);
  const a = await ok('fiila_shop_invite_accept', { p_token: TOK_ADMIN }, ADMIN);
  assert.deepEqual(a, { shop: 'Boutique Équipe [TEST]', role: 'admin' });
  await ko('fiila_shop_invite_accept', { p_token: TOK_ADMIN }, 'already_used', EDITOR);
  assert.equal((await ok('fiila_shop_invite_get', { p_token: TOK_ADMIN })).state, 'used');
  await ok('fiila_shop_invite_accept', { p_token: TOK_EDITOR }, EDITOR);
  const me = await ok('fiila_me', {}, EDITOR);
  assert.equal(me.shop.name, 'Boutique Équipe [TEST]'); assert.equal(me.shop.role, 'editor');
  const team = await ok('fiila_shop_team', { p_key: null }, OWNER);
  assert.deepEqual(team.members.map((m) => [m.name, m.role, m.phone]), [['Moussa Admin', 'admin', '77 111 11 11'], ['Fatou Editrice', 'editor', '77 222 22 22']]);
  assert.deepEqual(team.invites, []);
});

await t('éditeur : commandes, articles, clients ; ni réglages, ni suppression, ni équipe, ni vitrine', async () => {
  assert.equal((await ok('fiila_shop_get', { p_key: null }, EDITOR)).shop.role, 'editor');
  const o = await ok('fiila_order_create', { p_key: null, p: { customer: { name: 'Cliente Équipe [TEST]', phone: '+221 70 333 33 33' },
    items: [{ label: 'Robe', qty: 1, price: 5000 }] } }, EDITOR);
  assert.ok(o.order || o.id || o.ref, 'commande créée par l’éditeur');
  assert.ok((await ok('fiila_orders', { p_key: null, p_filter: null }, EDITOR)));
  await ok('fiila_product_save', { p_key: null, p: { name: 'Article Éditeur [TEST]', price: 2000 } }, EDITOR);
  assert.ok((await ok('fiila_customers', { p_key: null, p_query: null }, EDITOR)));
  await ko('fiila_shop_save', { p_key: null, p: { name: 'Piratée' } }, 'shop_admin_only', EDITOR);
  assert.equal((await db.query(`select count(*)::int n from fiila.shops where user_id = $1`, [EDITOR.uid])).rows[0].n, 0, 'aucune seconde boutique créée');
  await ko('fiila_product_delete', { p_key: null, p_id: P1 }, 'shop_admin_only', EDITOR);
  await ko('fiila_shop_delete', { p_key: null }, 'shop_owner_only', EDITOR);
  await ko('fiila_shop_team', { p_key: null }, 'shop_admin_only', EDITOR);
  await ko('fiila_shop_invite', { p_key: null, p_name: 'X', p_phone: '77 333 00 00', p_role: 'admin' }, 'shop_admin_only', EDITOR);
  await ko('fiila_shop_vitrine', { p_key: null, p: { public: true } }, 'shop_admin_only', EDITOR);
  assert.ok(await ok('fiila_shop_vitrine', { p_key: null, p: null }, EDITOR), 'lecture de la vitrine permise');
  await ko('fiila_shop_courier', { p_key: null, p_action: 'auto_on' }, 'shop_admin_only', EDITOR);
  await ko('fiila_courier_invite', { p_key: null, p_name: 'L', p_phone: '77 444 44 44' }, 'shop_admin_only', EDITOR);
});

await t('administrateur : réglages, équipe, suppressions ; pas la suppression de la boutique', async () => {
  await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Équipe [TEST]', phone: '77 500 00 10' } }, ADMIN);
  await ok('fiila_product_delete', { p_key: null, p_id: P1 }, ADMIN);
  await ok('fiila_shop_vitrine', { p_key: null, p: { public: true } }, ADMIN);
  const team = await ok('fiila_shop_team', { p_key: null }, ADMIN);
  assert.equal(team.role, 'admin'); assert.equal(team.members.find((m) => m.me).name, 'Moussa Admin');
  await ko('fiila_shop_delete', { p_key: null }, 'shop_owner_only', ADMIN);
  // changer le rôle de l'éditeur, puis le remettre
  const ed = team.members.find((m) => m.role === 'editor');
  let t2 = await ok('fiila_shop_member_set', { p_key: null, p_user: ed.id, p_action: 'admin' }, ADMIN);
  assert.equal(t2.members.find((m) => m.id === ed.id).role, 'admin');
  t2 = await ok('fiila_shop_member_set', { p_key: null, p_user: ed.id, p_action: 'editor' }, OWNER);
  assert.equal(t2.members.find((m) => m.id === ed.id).role, 'editor');
  await ko('fiila_shop_member_set', { p_key: null, p_user: OWNER.uid, p_action: 'remove' }, 'not_found', ADMIN);
  await ko('fiila_shop_member_set', { p_key: null, p_user: ed.id, p_action: 'owner' }, 'invalid_role', ADMIN);
});

await t('une autre boutique ne voit ni ne modifie cette équipe', async () => {
  const team = await ok('fiila_shop_team', { p_key: null }, OTHER);
  assert.deepEqual(team.members, []);
  await ko('fiila_shop_member_set', { p_key: null, p_user: EDITOR.uid, p_action: 'remove' }, 'not_found', OTHER);
});

await t('annuler une invitation ; 10 personnes au plus (membres et invitations en attente)', async () => {
  const inv = await ok('fiila_shop_invite', { p_key: null, p_name: 'Temp', p_phone: '77 555 55 55', p_role: 'editor' }, OWNER);
  const id = inv.team.invites[0].id;
  assert.deepEqual((await ok('fiila_shop_invite_cancel', { p_key: null, p_id: id }, OWNER)).invites, []);
  for (let i = 0; i < 8; i++) await ok('fiila_shop_invite', { p_key: null, p_name: 'N' + i, p_phone: '77 600 00 0' + i, p_role: 'editor' }, OWNER);
  await ko('fiila_shop_invite', { p_key: null, p_name: 'Trop', p_phone: '77 699 99 99', p_role: 'editor' }, 'team_full', OWNER);
  await db.query(`delete from fiila.shop_invites`);
});

await t('retrait et départ : l’accès s’arrête aussitôt', async () => {
  await ok('fiila_shop_member_set', { p_key: null, p_user: ADMIN.uid, p_action: 'remove' }, OWNER);
  assert.equal((await ok('fiila_shop_get', { p_key: null }, ADMIN)).shop, null);
  await ko('fiila_orders', { p_key: null, p_filter: null }, 'shop_required', ADMIN);
  assert.deepEqual(await ok('fiila_shop_leave', {}, EDITOR), { left: true });
  assert.equal((await ok('fiila_me', {}, EDITOR)).shop, undefined);
  await ko('fiila_shop_leave', {}, 'not_found', EDITOR);
  // Après son départ, l'éditrice peut créer sa propre boutique.
  await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique de Fatou [TEST]' } }, EDITOR);
});

await t('propriétaire sans compte (clé) : il invite aussi ; suppression du compte d’un membre = départ', async () => {
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Sans Compte [TEST]' } })).key;
  const tok = (await ok('fiila_shop_invite', { p_key: k, p_name: 'Aïda', p_phone: '77 700 00 00', p_role: 'admin' })).token;
  const M = await user('aida.team@example.invalid', 'Aïda');
  await ok('fiila_shop_invite_accept', { p_token: tok }, M);
  assert.equal((await ok('fiila_shop_team', { p_key: k })).members.length, 1);
  await db.query(`delete from auth.users where id = $1`, [M.uid]);
  assert.equal((await ok('fiila_shop_team', { p_key: k })).members.length, 0);
});

await t('suppression de la boutique par le propriétaire : membres et invitations effacés', async () => {
  const tok = (await ok('fiila_shop_invite', { p_key: null, p_name: 'Z', p_phone: '77 800 00 00', p_role: 'editor' }, OWNER)).token;
  await ok('fiila_shop_invite_accept', { p_token: tok }, NOBODY);
  await ok('fiila_shop_delete', { p_key: null }, OWNER);
  assert.equal((await db.query(`select count(*)::int n from fiila.shop_members`)).rows[0].n, 0);
  assert.equal((await ok('fiila_me', {}, NOBODY)).shop, undefined);
});

await t('vérification par SMS exigée (réglage sms_verify = 1) : numéro confirmé et identique à celui invité', async () => {
  await db.query(`update fiila.settings set value = '1' where key = 'sms_verify'`);
  const S = await user('sms.team@example.invalid', 'Proprio SMS');
  await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique SMS [TEST]' } }, S);
  const tok = (await ok('fiila_shop_invite', { p_key: null, p_name: 'Ibou', p_phone: '77 900 00 01', p_role: 'editor' }, S)).token;
  const g = await ok('fiila_shop_invite_get', { p_token: tok });
  assert.equal(g.verify, true); assert.equal(g.phone, '77 900 00 01');
  const M = await user('ibou.team@example.invalid', 'Ibou');
  await ko('fiila_shop_invite_accept', { p_token: tok }, 'phone_verify_required', M);
  await db.query(`update auth.users set phone = '221779000099', phone_confirmed_at = now() where id = $1`, [M.uid]);
  await ko('fiila_shop_invite_accept', { p_token: tok }, 'phone_mismatch', M);
  await db.query(`update auth.users set phone = '221779000001', phone_confirmed_at = null where id = $1`, [M.uid]);
  await ko('fiila_shop_invite_accept', { p_token: tok }, 'phone_verify_required', M);
  await db.query(`update auth.users set phone_confirmed_at = now() where id = $1`, [M.uid]);
  assert.equal((await ok('fiila_me', {}, M)).phone_verified, '+221779000001');
  await ok('fiila_shop_invite_accept', { p_token: tok }, M);
  const team = await ok('fiila_shop_team', { p_key: null }, S);
  assert.equal(team.members[0].verified, true); assert.equal(team.members[0].phone, '+221779000001');
  await db.query(`update fiila.settings set value = '0' where key = 'sms_verify'`);
  assert.equal((await ok('fiila_shop_invite_get', { p_token: (await ok('fiila_shop_invite', { p_key: null, p_name: 'X', p_phone: '77 900 00 02', p_role: 'editor' }, S)).token })).verify, undefined);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL équipe de boutique réussis`);
process.exit(passed === results.length ? 0 : 1);
