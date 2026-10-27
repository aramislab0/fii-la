// Tests SQL : origine des arrivées, parrainage par code, numéro et lien, garde-fous, publications, statistiques fondateur.
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
  assert.equal(r.status, 400, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code), `${fn}: ${r.body.message}`);
};
const addr = (label) => ({ kind: 'address', label, entry: { lat: 14.75814, lng: -17.47032 }, vehicle_ok: true, instruction: 'Portail bleu [TEST]' });
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

let SA, SB, CODE_A, PK, CODE_P;

await t('boutique : code de parrainage créé à la première ouverture, 6 caractères sans 0/O/1/I, stable', async () => {
  SA = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Awa [TEST]', phone: '77 100 00 01' } })).key;
  const me = await ok('fiila_referral_me', { p_for: 'shop', p_key: SA });
  CODE_A = me.referrer.code;
  assert.match(CODE_A, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(me.referrer.kind, 'shop'); assert.equal(me.referrer.joined, 0);
  assert.equal((await ok('fiila_referral_me', { p_for: 'shop', p_key: SA })).referrer.code, CODE_A);
  await ko('fiila_referral_me', { p_for: 'shop', p_key: 'mauvaise-cle' }, 'shop_required');
});

await t('lien public : seulement le nom de la boutique et le type, jamais le numéro', async () => {
  const p = await ok('fiila_referral_public', { p_code: CODE_A.toLowerCase() });
  assert.deepEqual(p, { state: 'ok', name: 'Boutique Awa [TEST]', kind: 'shop' });
  assert.equal((await ok('fiila_referral_public', { p_code: 'ZZZZZZ' })).state, 'unknown');
});

await t('code tapé : la nouvelle boutique est comptée pour sa marraine', async () => {
  SB = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Boutique Binta [TEST]', phone: '77 100 00 02' } })).key;
  assert.deepEqual(await ok('fiila_attribute', { p_kind: 'shop', p_id: null, p_key: SB, p: { code: CODE_A } }), { ok: true });
  const me = (await ok('fiila_referral_me', { p_for: 'shop', p_key: SA })).referrer;
  assert.equal(me.joined, 1); assert.equal(me.active, 0);
  assert.equal(me.recent[0].label, 'Boutique Binta [TEST]'); assert.equal(me.recent[0].kind, 'shop');
});

await t('une seule origine par arrivée : un second appel ne change rien', async () => {
  const other = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Autre [TEST]' } })).key;
  const codeO = (await ok('fiila_referral_me', { p_for: 'shop', p_key: other })).referrer.code;
  await ok('fiila_attribute', { p_kind: 'shop', p_id: null, p_key: SB, p: { code: codeO } });
  assert.equal((await ok('fiila_referral_me', { p_for: 'shop', p_key: SA })).referrer.joined, 1);
  assert.equal((await ok('fiila_referral_me', { p_for: 'shop', p_key: other })).referrer.joined, 0);
});

await t('pas de parrainage de soi-même (son propre code, son propre numéro)', async () => {
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Soi [TEST]', phone: '77 100 00 09' } })).key;
  const code = (await ok('fiila_referral_me', { p_for: 'shop', p_key: k })).referrer.code;
  await ok('fiila_attribute', { p_kind: 'shop', p_id: null, p_key: k, p: { code } });
  const row = await one(`select r.referrer_id, r.source from fiila.referrals r join fiila.shops s on s.id = r.shop_id where s.name = 'Soi [TEST]'`);
  assert.equal(row.referrer_id, null); assert.equal(row.source, 'code');
  assert.equal((await ok('fiila_referral_me', { p_for: 'shop', p_key: k })).referrer.joined, 0);
  const k2 = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Soi 2 [TEST]', phone: '+221 77 100 00 08' } })).key;
  await ok('fiila_attribute', { p_kind: 'shop', p_id: null, p_key: k2, p: { phone: '771000008' } });
  const r2 = await one(`select r.referrer_id, r.phone_key from fiila.referrals r join fiila.shops s on s.id = r.shop_id where s.name = 'Soi 2 [TEST]'`);
  assert.equal(r2.referrer_id, null); assert.equal(r2.phone_key, null);
});

await t('numéro tapé : retrouve la boutique qui porte ce numéro (formats +221, 00221, espaces)', async () => {
  const k = (await ok('fiila_courier_register', { p: { name: 'Moussa Ba [TEST]', phone: '76 300 00 03' } })).key;
  await ok('fiila_attribute', { p_kind: 'courier', p_id: null, p_key: k, p: { phone: '00221 77 100 00 01' } });
  const me = (await ok('fiila_referral_me', { p_for: 'shop', p_key: SA })).referrer;
  assert.equal(me.joined, 2); assert.equal(me.by_kind.courier, 1);
  assert.equal(me.recent[0].label, 'Moussa', 'prénom seul pour un livreur');
});

await t('numéro pas encore inscrit : réponse neutre, puis rattaché quand la personne crée sa fiche de parrainage', async () => {
  const P = await ok('fiila_create_place', { p: addr('Chez Fatou [TEST]') });
  const r = await ok('fiila_attribute', { p_kind: 'address', p_id: P.id, p_key: P.owner_token, p: { phone: '78 555 55 55' } });
  assert.deepEqual(r, { ok: true }, 'on ne révèle pas si le numéro est inscrit');
  const card = await ok('fiila_referral_card_save', { p_key: null, p: { name: 'Khady Ndiaye', phone: '+221 78 555 55 55' } });
  PK = card.key; CODE_P = card.referrer.code;
  assert.ok(PK.length > 40); assert.equal(card.referrer.kind, 'person');
  assert.equal(card.referrer.joined, 1, 'l’adresse donnée avec son numéro lui revient');
  assert.equal(card.referrer.active, 1, 'une adresse active compte tout de suite');
  assert.equal(card.referrer.recent[0].label, undefined, 'aucun libellé pour l’adresse d’un particulier');
  const pub = await ok('fiila_referral_public', { p_code: CODE_P });
  assert.deepEqual(pub, { state: 'ok', name: 'Khady', kind: 'person' });
  const again = await ok('fiila_referral_card_save', { p_key: PK, p: { name: 'Khady N.' } });
  assert.equal(again.key, null); assert.equal(again.referrer.code, CODE_P);
  await ko('fiila_referral_card_save', { p_key: null, p: { name: '' } }, 'name_required');
  assert.equal((await ok('fiila_referral_me', { p_for: 'person', p_key: null })).referrer, null);
});

await t('lien de parrainage : rendez-vous créé après un lien /r/CODE', async () => {
  const M = await ok('fiila_create_place', { p: { kind: 'meeting', label: 'Baptême [TEST]', entry: { lat: 14.7, lng: -17.4 }, starts_at: new Date(Date.now() + 864e5).toISOString(), expires_at: new Date(Date.now() + 2 * 864e5).toISOString() } });
  await ok('fiila_attribute', { p_kind: 'meeting', p_id: M.id, p_key: M.owner_token, p: { src: 'link', token: CODE_P } });
  const me = (await ok('fiila_referral_me', { p_for: 'person', p_key: PK })).referrer;
  assert.equal(me.joined, 2); assert.equal(me.by_kind.meeting, 1);
  await ko('fiila_attribute', { p_kind: 'address', p_id: M.id, p_key: M.owner_token, p: {} }, 'not_found');
});

await t('lien reçu : la cliente qui crée son adresse depuis une demande de la boutique est comptée pour la boutique', async () => {
  const O = await ok('fiila_order_create', { p_key: SA, p: { customer: { name: 'Awa [TEST]', phone: '70 000 00 01' }, items: [{ label: 'Sac', qty: 1, price: 5000 }] } });
  const P = await ok('fiila_create_place', { p: addr('Chez Awa [TEST]') });
  await ok('fiila_attribute', { p_kind: 'address', p_id: P.id, p_key: P.owner_token, p: { src: 'request', token: O.request_token } });
  const P2 = await ok('fiila_create_place', { p: addr('Voisine [TEST]') });
  await ok('fiila_attribute', { p_kind: 'address', p_id: P2.id, p_key: P2.owner_token, p: { src: 'invoice', token: O.share_token } });
  const me = (await ok('fiila_referral_me', { p_for: 'shop', p_key: SA })).referrer;
  assert.equal(me.by_kind.address, 2);
  const src = (await db.query(`select source from fiila.referrals where place_id in ($1, $2) order by source`, [P.id, P2.id])).rows.map((x) => x.source);
  assert.deepEqual(src, ['invoice', 'request']);
});

await t('sans rien : origine « direct », sans parrain ; trop tard (plus d’une heure) : rien n’est enregistré', async () => {
  const P = await ok('fiila_create_place', { p: addr('Direct [TEST]') });
  await ok('fiila_attribute', { p_kind: 'address', p_id: P.id, p_key: P.owner_token, p: null });
  assert.equal((await one(`select source, referrer_id from fiila.referrals where place_id = $1`, [P.id])).source, 'direct');
  const P2 = await ok('fiila_create_place', { p: addr('Ancienne [TEST]') });
  await db.query(`update fiila.places set created_at = now() - interval '2 hours' where id = $1`, [P2.id]);
  await ok('fiila_attribute', { p_kind: 'address', p_id: P2.id, p_key: P2.owner_token, p: { code: CODE_A } });
  assert.equal(await one(`select 1 x from fiila.referrals where place_id = $1`, [P2.id]), undefined);
  await ko('fiila_attribute', { p_kind: 'address', p_id: P.id, p_key: 'pas-la-cle', p: {} }, 'not_found');
});

await t('boutique active : 3 clientes différentes et une commande livrée', async () => {
  for (const [i, n] of ['Aïda', 'Coumba', 'Dior'].entries()) {
    const o = await ok('fiila_order_create', { p_key: SB, p: { customer: { name: n + ' [TEST]', phone: '70 000 10 0' + i }, items: [{ label: 'Robe', qty: 1, price: 9000 }] } });
    if (i === 0) await ok('fiila_order_set_status', { p_key: SB, p_id: o.id, p_status: 'delivered' });
    if (i === 1) {
      const me = (await ok('fiila_referral_me', { p_for: 'shop', p_key: SA })).referrer;
      assert.equal(me.recent.find((x) => x.label === 'Boutique Binta [TEST]').active, false);
    }
  }
  const me = (await ok('fiila_referral_me', { p_for: 'shop', p_key: SA })).referrer;
  assert.equal(me.recent.find((x) => x.label === 'Boutique Binta [TEST]').active, true);
});

await t('publication : journalisée pour l’article de la boutique seulement, comptée dans la liste', async () => {
  const pr = await ok('fiila_product_save', { p_key: SA, p: { name: 'Sac wax [TEST]', price: 15000 } });
  const id = pr.id || pr.product?.id;
  assert.equal((await ok('fiila_post_log', { p_key: SA, p_product_id: id })).posts, 1);
  assert.equal((await ok('fiila_post_log', { p_key: SA, p_product_id: id })).posts, 2);
  await ko('fiila_post_log', { p_key: SB, p_product_id: id }, 'not_found');
  const list = await ok('fiila_products', { p_key: SA, p_all: true });
  assert.equal(list.find((x) => x.id === id).posts, 2);
});

await t('statistiques : refusées sans compte administrateur, agrégées pour le fondateur', async () => {
  await ko('fiila_admin_stats', {}, 'auth_required|not_authenticated|login|permission denied'); // audit du 27/10 : fermé à anon
  const uid = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'fondateur@example.test') returning id`)).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Fondateur')`, [uid]);
  await ko('fiila_admin_stats', {}, 'not_allowed', { uid });
  await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [uid]);
  const s = await ok('fiila_admin_stats', {}, { uid });
  assert.ok(s.totals.shops >= 4); assert.ok(s.totals.referred >= 6); assert.equal(s.totals.posts, 2);
  assert.ok(s.sources.code >= 1 && s.sources.phone >= 1 && s.sources.request === 1 && s.sources.direct >= 1);
  assert.equal(s.top[0].name, 'Boutique Awa [TEST]');
  assert.ok(Array.isArray(s.weeks) && s.weeks[0].total >= 6);
  assert.ok(!JSON.stringify(s).includes('77 100'), 'aucun numéro dans les statistiques');
});

await t('compte : la fiche de parrainage suit le compte ; suppression de la boutique : son code disparaît', async () => {
  const uid = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'parrain@example.test') returning id`)).id;
  await db.query(`insert into fiila.profiles (user_id, display_name, phone) values ($1, 'Mame Diarra Sow', '77 444 44 44')`, [uid]);
  const me = (await ok('fiila_referral_me', { p_for: 'person', p_key: null }, { uid })).referrer;
  assert.equal(me.name, 'Mame Diarra Sow');
  const k = (await ok('fiila_courier_register', { p: { name: 'Ibou [TEST]' } })).key;
  await ok('fiila_attribute', { p_kind: 'courier', p_id: null, p_key: k, p: { phone: '774444444' } });
  assert.equal((await ok('fiila_referral_me', { p_for: 'person', p_key: null }, { uid })).referrer.joined, 1);
  await ok('fiila_shop_delete', { p_key: SA });
  assert.equal((await ok('fiila_referral_public', { p_code: CODE_A })).state, 'unknown');
  assert.equal(await one(`select 1 x from fiila.referrals where shop_id is not null and referrer_id is null and shop_id = (select id from fiila.shops where name = 'Boutique Binta [TEST]') and source = 'code'`) !== undefined, true,
    'l’arrivée reste (origine conservée), sans parrain');
});

await t('fiche de parrainage : suppression par sa clé seulement ; nom et numéro effacés, arrivées gardées sans parrain', async () => {
  await ko('fiila_referral_card_delete', { p_key: 'pas-la-cle' }, 'not_found');
  await ok('fiila_referral_card_delete', { p_key: PK });
  assert.equal((await ok('fiila_referral_public', { p_code: CODE_P })).state, 'unknown');
  assert.equal(await one(`select 1 x from fiila.referrers where phone_key = '785555555'`), undefined);
  assert.ok((await one(`select count(*)::int n from fiila.referrals where source = 'link'`)).n >= 1);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL parrainage réussis`);
process.exit(passed === results.length ? 0 : 1);
