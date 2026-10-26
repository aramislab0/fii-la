// Tests SQL : domaine propre des boutiques (mandat du 24/10/2026, docs/PLAN-DOMAINES-FII.md §4).
// Deux boutiques, noms invalides, doublons, limite, Premium, expiration à 72 h, écriture réservée à la clé de service,
// actif seulement si propriété ET certificat, résolution (aucune fuite), déconnexion et réattribution, back-office et journal.
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const SR = { role: 'service_role' };
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
const F = await user('fondateur@example.test', 'super_admin');
const SUP = await user('support@example.test', 'support');
async function shop(name) {
  const s = await ok('fiila_shop_save', { p_key: null, p: { name, business_type: 'mode' } });
  const v = await ok('fiila_shop_vitrine', { p_key: s.key, p: { public: true } });
  return { key: s.key, id: s.shop.id, slug: v.slug };
}
const A = await shop('Maison Awa [TEST]'), B = await shop('Atelier Binta [TEST]');
const premium = (s, plan = 'premium') => ok('fiila_bo_shop_action', { p_id: s.id, p_action: 'set_plan', p_value: plan }, F);
let dA;

await t('boutique gratuite : liste visible, ajout refusé (Premium requis)', async () => {
  const r = await ok('fiila_domains', { p_key: A.key });
  assert.equal(r.plan, 'free'); assert.deepEqual(r.domains, []); assert.equal(r.can_edit, true);
  await ko('fiila_domain_add', { p_key: A.key, p_host: 'www.maison-awa.sn' }, 'premium_required');
});

await t('noms refusés : IP, domaines de Fii, hébergeurs, localhost, sans extension, caractères invalides', async () => {
  await premium(A); await premium(B);
  for (const h of ['1.2.3.4', 'getfii.app', 'www.fii.com', 'maison.getfii.app', 'fiila.app', 'shop.fiila.app', 'x.github.io', 'abc.supabase.co', 'a.workers.dev', 'localhost', 'boutique', 'ma boutique.sn', 'a..sn', '-a.sn', 'x.test'])
    await ko('fiila_domain_add', { p_key: A.key, p_host: h }, 'domain_invalid');
});

await t('ajout normalisé (protocole, chemin, port, majuscules retirés) ; en attente ; apex signalé', async () => {
  dA = await ok('fiila_domain_add', { p_key: A.key, p_host: 'HTTPS://WWW.Maison-Awa.sn:443/boutique?x=1' });
  assert.equal(dA.hostname, 'www.maison-awa.sn'); assert.equal(dA.status, 'pending'); assert.equal(dA.apex, undefined);
  const apex = await ok('fiila_domain_add', { p_key: A.key, p_host: 'maison-awa.sn' });
  assert.equal(apex.apex, true);
  await ko('fiila_domain_add', { p_key: A.key, p_host: 'shop.maison-awa.sn' }, 'domain_limit');
  await ok('fiila_domain_remove', { p_key: A.key, p_id: apex.id });
});

await t('doublon : un nom vivant n’appartient qu’à une boutique (même casse différente)', async () => {
  await ko('fiila_domain_add', { p_key: B.key, p_host: 'WWW.MAISON-AWA.SN' }, 'domain_taken');
  await ko('fiila_domain_add', { p_key: A.key, p_host: 'www.maison-awa.sn' }, 'domain_taken');
  const n = await one(`select count(*)::int n from fiila.shop_domains where hostname = 'www.maison-awa.sn' and status in ('pending','verifying','active')`);
  assert.equal(n.n, 1);
});

await t('autre boutique : ni retrait ni cible sur le domaine d’une autre ; personne sans clé refusée', async () => {
  await ko('fiila_domain_remove', { p_key: B.key, p_id: dA.id }, 'not_found');
  await ko('fiila_domain_target', { p_key: B.key, p_id: dA.id }, 'not_found');
  await ko('fiila_domain_target', { p_key: null, p_id: dA.id });
  const own = await ok('fiila_domain_target', { p_key: A.key, p_id: dA.id });
  assert.equal(own.by, 'shop'); assert.equal(own.hostname, 'www.maison-awa.sn');
  assert.equal((await ok('fiila_domain_target', { p_key: null, p_id: dA.id }, F)).by, 'staff');
  await ko('fiila_domain_target', { p_key: null, p_id: dA.id }, null, SUP);   // support : lecture seule
});

await t('écriture du résultat Cloudflare : refusée aux rôles publics, permise à la clé de service', async () => {
  await ko('fiila_domain_cf_update', { p_id: dA.id, p: { cf_status: 'active', ssl_status: 'active' } }, 'permission denied');
  await ko('fiila_domain_cf_update', { p_id: dA.id, p: { cf_status: 'active', ssl_status: 'active' } }, 'permission denied', F);
  const r = await ok('fiila_domain_cf_update', { p_id: dA.id, p: { cf_id: 'cf-1', cf_status: 'pending', ssl_status: 'pending_validation',
    records: [{ type: 'CNAME', name: 'www.maison-awa.sn', value: 'sites.getfii.app', purpose: 'route' }] } }, SR);
  assert.equal(r.status, 'verifying'); assert.equal(r.records.length, 1);
});

await t('HTTPS en attente : propriété active mais certificat non émis → toujours en vérification, non servi', async () => {
  const r = await ok('fiila_domain_cf_update', { p_id: dA.id, p: { cf_status: 'active', ssl_status: 'pending_validation' } }, SR);
  assert.equal(r.status, 'verifying');
  assert.deepEqual(await ok('fiila_domain_resolve', { p_host: 'www.maison-awa.sn' }), { state: 'unknown' });
});

await t('mauvais DNS : erreur de Cloudflare gardée et affichée, statut en erreur, la boutique peut recommencer', async () => {
  const r = await ok('fiila_domain_cf_update', { p_id: dA.id, p: { cf_status: 'pending', ssl_status: 'validation_timed_out', error: 'CNAME absent' } }, SR);
  assert.equal(r.status, 'failed'); assert.equal(r.last_error, 'CNAME absent');
  // « failed » n'est pas « vivant » pour l'unicité : une autre boutique pourrait le demander ; la boutique A peut recommencer.
  const again = await ok('fiila_domain_add', { p_key: A.key, p_host: 'www.maison-awa.sn' });
  assert.equal(again.status, 'pending');
  assert.equal((await one(`select status from fiila.shop_domains where id = $1`, [dA.id])).status, 'disconnected');
  dA = again;
});

await t('actif : propriété ET certificat ; la résolution ne renvoie que slug, nom et hôte', async () => {
  const r = await ok('fiila_domain_cf_update', { p_id: dA.id, p: { cf_id: 'cf-2', cf_status: 'active', ssl_status: 'active' } }, SR);
  assert.equal(r.status, 'active'); assert.ok(r.verified_at);
  const s = await ok('fiila_domain_resolve', { p_host: 'WWW.maison-awa.sn.' });
  assert.deepEqual(Object.keys(s).sort(), ['host', 'name', 'slug', 'state']);
  assert.deepEqual(s, { state: 'ok', slug: A.slug, name: 'Maison Awa [TEST]', host: 'www.maison-awa.sn' });
  for (const h of ['maison-awa.sn', 'shop.maison-awa.sn', 'inconnu.sn', '', 'getfii.app'])
    assert.equal((await ok('fiila_domain_resolve', { p_host: h })).state, 'unknown', h);
});

await t('résolution coupée si la boutique n’est plus Premium, plus en ligne, suspendue, ou si l’interrupteur est coupé', async () => {
  const st = () => ok('fiila_domain_resolve', { p_host: 'www.maison-awa.sn' }).then((x) => x.state);
  await premium(A, 'free'); assert.equal(await st(), 'unknown'); await premium(A);
  await ok('fiila_shop_vitrine', { p_key: A.key, p: { public: false } }); assert.equal(await st(), 'unknown');
  await ok('fiila_shop_vitrine', { p_key: A.key, p: { public: true } });
  await db.query(`update fiila.shops set suspended_at = now() where id = $1`, [A.id]); assert.equal(await st(), 'unknown');
  await db.query(`update fiila.shops set suspended_at = null where id = $1`, [A.id]);
  await ok('fiila_bo_setting_set', { p_key: 'custom_domains', p_value: 0 }, F); assert.equal(await st(), 'unknown');
  await ko('fiila_domain_add', { p_key: B.key, p_host: 'www.atelier-binta.sn' }, 'domains_off');
  await ok('fiila_bo_setting_set', { p_key: 'custom_domains', p_value: 1 }, F); assert.equal(await st(), 'ok');
});

await t('adresse <lien>.getfii.app : toute boutique en ligne (même gratuite) ; hors ligne, suspendue, inconnue ou interrupteur coupé → rien', async () => {
  const st = (h) => ok('fiila_domain_resolve', { p_host: h });
  assert.deepEqual(await st(B.slug + '.GETFII.app'), { state: 'ok', slug: B.slug, name: 'Atelier Binta [TEST]', host: B.slug + '.getfii.app' });
  await premium(B, 'free');
  assert.equal((await st(B.slug + '.getfii.app')).state, 'ok', 'gratuite comprise');
  for (const h of ['inconnue-xyz.getfii.app', 'a.b.getfii.app', 'getfii.app', 'www.getfii.app', 'sites.getfii.app', 'api.getfii.app', B.slug + '.fii.shop', B.slug + '.getfii.app.evil.sn', B.slug + '.fii-shop.sn'])
    assert.equal((await st(h)).state, 'unknown', h);
  await ok('fiila_shop_vitrine', { p_key: B.key, p: { public: false } }); assert.equal((await st(B.slug + '.getfii.app')).state, 'unknown');
  await ok('fiila_shop_vitrine', { p_key: B.key, p: { public: true } });
  await ok('fiila_bo_setting_set', { p_key: 'shop_subdomains', p_value: 0 }, F); assert.equal((await st(B.slug + '.getfii.app')).state, 'unknown');
  await ok('fiila_bo_setting_set', { p_key: 'shop_subdomains', p_value: 1 }, F);
  await premium(B);
});

await t('expiration : une demande non vérifiée de plus de 72 h est libérée', async () => {
  const d = await ok('fiila_domain_add', { p_key: B.key, p_host: 'www.atelier-binta.sn' });
  await db.query(`update fiila.shop_domains set created_at = now() - interval '73 hours' where id = $1`, [d.id]);
  const r = await ok('fiila_domains', { p_key: B.key });
  assert.equal(r.domains.length, 0);
  assert.equal((await one(`select status from fiila.shop_domains where id = $1`, [d.id])).status, 'expired');
  // un résultat Cloudflare tardif ne ranime pas une demande close
  assert.equal((await ok('fiila_domain_cf_update', { p_id: d.id, p: { cf_status: 'active', ssl_status: 'active' } }, SR)).status, 'expired');
});

await t('back-office : liste réservée à l’équipe ; déconnexion avec motif (droit d’écriture), journalisée ; réattribution', async () => {
  await ko('fiila_bo_domains', {}, null);
  const list = await ok('fiila_bo_domains', {}, SUP);
  const row = list.domains.find((x) => x.id === dA.id);
  assert.equal(row.shop, 'Maison Awa [TEST]'); assert.equal(row.status, 'active');
  await ko('fiila_bo_domain_action', { p_id: dA.id, p_action: 'disconnect', p_reason: 'Litige' }, null, SUP);
  await ko('fiila_bo_domain_action', { p_id: dA.id, p_action: 'disconnect', p_reason: '  ' }, 'reason_required', F);
  const r = await ok('fiila_bo_domain_action', { p_id: dA.id, p_action: 'disconnect', p_reason: 'Propriété contestée' }, F);
  assert.equal(r.status, 'disconnected'); assert.equal(r.ended_reason, 'Propriété contestée');
  const log = await one(`select count(*)::int n from fiila.admin_log where action = 'domain_disconnect' and target_id = $1`, [dA.id]);
  assert.equal(log.n, 1);
  assert.equal((await ok('fiila_domain_resolve', { p_host: 'www.maison-awa.sn' })).state, 'unknown');
  const b = await ok('fiila_domain_add', { p_key: B.key, p_host: 'www.maison-awa.sn' });   // le vrai propriétaire peut le reprendre
  assert.equal(b.status, 'pending');
  await ko('fiila_bo_domain_action', { p_id: dA.id, p_action: 'disconnect', p_reason: 'x' }, 'invalid_state', F);
});

await t('réglage custom_domains dans le back-office ; mesure anonyme de transfert acceptée', async () => {
  const s = await ok('fiila_bo_settings', {}, F);
  assert.ok(JSON.stringify(s).includes('custom_domains'));
  await ok('fiila_track', { p_event: 'migrate', p_variant: 'merged' });
  await ko('fiila_track', { p_event: 'migrate', p_variant: 'cle-abc' });
});

await db.query(`delete from fiila.shop_domains`);
for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL domaines réussis`);
process.exit(passed === results.length ? 0 : 1);
