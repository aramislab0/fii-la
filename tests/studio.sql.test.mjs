// Tests SQL : Fii Studio niveau 1 (26/10/2026, docs/PLAN-FII-STUDIO.md). Interrupteur, photo requise, crédits (essai partenaire
// puis boutique), budget mensuel, limite du jour, une série à la fois, écriture du résultat réservée à la clé de service,
// adresses filtrées (fal uniquement), version gardée = 1 crédit (une seule fois), droits entre boutiques, back-office et journal.
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
  const p = await ok('fiila_product_save', { p_key: s.key, p: { name: 'Robe ' + name, price: 10000 } });
  return { key: s.key, id: s.shop.id, pid: p.id };
}
const A = await shop('Studio A [TEST]'), B = await shop('Studio B [TEST]');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
await db.query(`update fiila.products set photo = $2, photo_type = 'image/jpeg' where id = $1`, [A.pid, jpeg]);
const URLS = ['https://v3.fal.media/files/a/1.png', 'https://v3.fal.media/files/a/2.png', 'https://v3.fal.media/files/a/3.png'];
let J;

await t('fermé par défaut : l’état le dit, aucune série possible', async () => {
  const st = await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid });
  assert.equal(st.ready, false); assert.deepEqual(st.credits, { trial: 0, wallet: 0, total: 0 });
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc' }, 'studio_off');
});

await t('ouvert : photo requise, style connu, crédits requis ; un autre article ou une autre boutique refusés', async () => {
  await ok('fiila_bo_setting_set', { p_key: 'studio_ready', p_value: 1 }, F);
  await ko('fiila_studio_reserve', { p_key: B.key, p_product: B.pid, p_style: 'blanc' }, 'studio_no_photo');
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'neon' }, 'invalid_payload');
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc' }, 'studio_no_credits');
  await ko('fiila_studio_reserve', { p_key: B.key, p_product: A.pid, p_style: 'blanc' }, 'product_not_found');
  await ko('fiila_studio_state', { p_key: B.key, p_product: A.pid }, 'product_not_found');
});

await t('crédits : accordés par l’équipe (droit d’écriture, motif obligatoire, au journal), jamais négatifs', async () => {
  await ko('fiila_bo_studio_grant', { p_shop: A.id, p_delta: 5, p_reason: 'Essai' }, null, SUP);
  await ko('fiila_bo_studio_grant', { p_shop: A.id, p_delta: 5, p_reason: ' ' }, 'reason_required', F);
  await ko('fiila_bo_studio_grant', { p_shop: A.id, p_delta: 0, p_reason: 'x' }, 'invalid_value', F);
  assert.equal((await ok('fiila_bo_studio_grant', { p_shop: A.id, p_delta: 3, p_reason: 'Boutique fondatrice' }, F)).credits, 3);
  assert.equal((await ok('fiila_bo_studio_grant', { p_shop: A.id, p_delta: -10, p_reason: 'Correction' }, F)).credits, 0);
  assert.equal((await ok('fiila_bo_studio_grant', { p_shop: A.id, p_delta: 2, p_reason: 'Boutique fondatrice' }, F)).credits, 2);
  assert.equal((await one(`select count(*)::int n from fiila.admin_log where action = 'studio_grant' and target_id = $1`, [A.id])).n, 3);
});

await t('série : ouverte avec la photo d’origine ; une seule à la fois ; rien n’est débité à l’ouverture', async () => {
  J = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'luxe' });
  assert.match(J.image, /^data:image\/jpeg;base64,\/9j\//); assert.equal(J.style, 'luxe');
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc' }, 'studio_busy');
  assert.equal((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).credits.total, 2);
});

await t('résultat : écriture réservée à la clé de service ; seules les adresses fal sont gardées (3 au plus) ; coût plafonné', async () => {
  await ko('fiila_studio_complete', { p_job: J.job, p: { results: URLS } }, 'permission denied');
  await ko('fiila_studio_complete', { p_job: J.job, p: { results: URLS } }, 'permission denied', F);
  const r = await ok('fiila_studio_complete', { p_job: J.job, p: { results: [URLS[0], 'https://evil.example/x.png', 'javascript:alert(1)', URLS[1], URLS[2], 'https://v3.fal.media/files/a/4.png'], cost_usd: 99 } }, SR);
  assert.equal(r.status, 'done'); assert.deepEqual(r.results, URLS);
  assert.equal(Number((await one(`select cost_usd from fiila.studio_jobs where id = $1`, [J.job])).cost_usd), 5);
  await db.query(`update fiila.studio_jobs set cost_usd = 0.12 where id = $1`, [J.job]);
  const again = await ok('fiila_studio_complete', { p_job: J.job, p: { results: [] } }, SR);
  assert.equal(again.status, 'done', 'une série close ne se réécrit pas');
});

await t('garder une version : 1 crédit, une seule fois ; l’adresse n’est lisible que par la boutique', async () => {
  await ko('fiila_studio_keep', { p_key: A.key, p_job: J.job, p_index: 3 }, 'invalid_state');
  await ko('fiila_studio_keep', { p_key: B.key, p_job: J.job, p_index: 0 }, 'not_found');
  const k = await ok('fiila_studio_keep', { p_key: A.key, p_job: J.job, p_index: 1 });
  assert.equal(k.status, 'kept'); assert.equal(k.url, URLS[1]); assert.equal(k.credits.total, 1);
  const k2 = await ok('fiila_studio_keep', { p_key: A.key, p_job: J.job, p_index: 2 });
  assert.equal(k2.kept, 1); assert.equal(k2.credits.total, 1, 'pas de second débit');
  assert.equal((await ok('fiila_studio_result', { p_key: A.key, p_job: J.job, p_index: 0 })).url, URLS[0]);
  await ko('fiila_studio_result', { p_key: B.key, p_job: J.job, p_index: 0 }, 'not_found');
  const st = await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid });
  assert.equal(st.jobs[0].status, 'kept'); assert.equal(st.jobs[0].kept, 1);
});

await t('échec du fournisseur : série en échec, aucun crédit débité ; série bloquée close après 3 minutes', async () => {
  const j = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc' });
  const r = await ok('fiila_studio_complete', { p_job: j.job, p: { error: 'fal 500' } }, SR);
  assert.equal(r.status, 'failed'); assert.equal(r.error, 'fal 500');
  await ko('fiila_studio_keep', { p_key: A.key, p_job: j.job, p_index: 0 }, 'invalid_state');
  const j2 = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'minimal' });
  await db.query(`update fiila.studio_jobs set created_at = now() - interval '4 minutes' where id = $1`, [j2.job]);
  const j3 = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'minimal' });
  assert.equal((await one(`select status from fiila.studio_jobs where id = $1`, [j2.job])).status, 'failed');
  await ok('fiila_studio_complete', { p_job: j3.job, p: { results: URLS } }, SR);
  assert.equal((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).credits.total, 1);
});

await t('garde-fous de coût : budget du mois atteint → pause ; limite de séries par jour', async () => {
  await ok('fiila_bo_setting_set', { p_key: 'studio_budget_usd', p_value: 0 }, F);
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc' }, 'studio_budget');
  await ok('fiila_bo_setting_set', { p_key: 'studio_budget_usd', p_value: 50 }, F);
  await ok('fiila_bo_setting_set', { p_key: 'studio_daily', p_value: 4 }, F);
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc' }, 'studio_daily_limit');
  await ok('fiila_bo_setting_set', { p_key: 'studio_daily', p_value: 10 }, F);
});

await t('crédits d’essai d’un partenaire utilisés d’abord, puis ceux de la boutique', async () => {
  await db.query(`insert into fiila.partner_packs (code, version, name, benefits, limits) values ('tstudio', 1, 'Pack test', '["Studio"]'::jsonb, '{"studio_credits": 2}'::jsonb)`);
  const inv = await one(`insert into fiila.partner_invites (token_hash, brand, pack_code, pack_version, months) values (extensions.gen_random_bytes(16), 'Marque test', 'tstudio', 1, 1) returning id`);
  await db.query(`insert into fiila.partner_trials (invite_id, shop_id, pack_code, pack_version, months, status, activated_at, ends_at) values ($1, $2, 'tstudio', 1, 1, 'active', now(), now() + interval '20 days')`, [inv.id, A.id]);
  const c = await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid });
  assert.deepEqual(c.credits, { trial: 2, wallet: 1, total: 3 });
  const j = (await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).jobs.find((x) => x.status === 'done');
  const k = await ok('fiila_studio_keep', { p_key: A.key, p_job: j.id, p_index: 0 });
  assert.deepEqual(k.credits, { trial: 1, wallet: 1, total: 2 });
  assert.equal((await one(`select credit_from from fiila.studio_jobs where id = $1`, [j.id])).credit_from, 'trial');
});

await t('back-office : réservé à l’équipe ; dépense, séries, crédits ; réglages bornés ; mesure anonyme', async () => {
  await ko('fiila_bo_studio', {}, null);
  const d = await ok('fiila_bo_studio', {}, SUP);
  assert.equal(d.ready, true); assert.ok(Number(d.spent_usd) > 0); assert.ok(d.month.series >= 4); assert.ok(d.month.kept >= 1);
  assert.ok(d.jobs.some((x) => x.shop === 'Studio A [TEST]' && x.status === 'kept'));
  assert.ok(d.wallets.some((x) => x.shop === 'Studio A [TEST]'));
  await ko('fiila_bo_setting_set', { p_key: 'studio_budget_usd', p_value: 5000 }, null, F);
  const s = JSON.stringify(await ok('fiila_bo_settings', {}, F));
  assert.ok(s.includes('studio_ready') && s.includes('studio_budget_usd') && s.includes('studio_daily'));
  await ok('fiila_track', { p_event: 'studio', p_variant: 'kept:luxe' });
  await ok('fiila_track', { p_event: 'studio', p_variant: 'kept:mode-3' });
  await ko('fiila_track', { p_event: 'studio', p_variant: 'kept:Néon !' });
});

await t('décors par catégorie : ceux du pack de la boutique (sinon génériques), ordonnés par ses versions gardées ; services sans Studio', async () => {
  await db.query(`insert into fiila.studio_scenes (id, category, label, swatch, prompt, rank, version) values
    ('mode-1', 'mode', 'Mur chaulé', '#EFEAE0', 'minimalist limewashed wall, soft window light [TEST]', 1, '0.1.0'),
    ('mode-2', 'mode', 'Portant bois', '#E3D2B8', 'light wooden clothing rail, soft morning daylight [TEST]', 2, '0.1.0'),
    ('bijoux-1', 'bijoux', 'Velours noir', '#151515', 'deep black velvet surface [TEST]', 1, '0.1.0')`);
  const st = await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid });
  assert.deepEqual(st.scenes.map((x) => x.id), ['mode-1', 'mode-2'], 'pack « mode », pas les génériques');
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'bijoux-1' }, 'invalid_payload');
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'blanc' }, 'invalid_payload');
  await db.query(`update fiila.studio_jobs set status = 'failed' where shop_id = $1 and status = 'running'`, [A.id]);
  const r = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'mode-2' });
  assert.match(r.prompt, /wooden clothing rail/); assert.equal(r.style, 'mode-2');
  assert.equal((await one(`select scene_version from fiila.studio_jobs where id = $1`, [r.job])).scene_version, '0.1.0');
  await db.query(`update fiila.studio_jobs set status = 'kept', kept = 0 where id = $1`, [r.job]);
  assert.deepEqual((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).scenes.map((x) => x.id), ['mode-2', 'mode-1'], 'le décor gardé passe en tête');
  await db.query(`update fiila.shops set business_type = 'coiffure' where id = $1`, [A.id]);
  assert.equal((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).ready, false);
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'mode-1' }, 'studio_off');
  await db.query(`update fiila.shops set business_type = 'chaussures' where id = $1`, [A.id]);
  assert.deepEqual((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).scenes.map((x) => x.id).sort(), ['blanc', 'fete', 'luxe', 'minimal', 'soleil'], 'catégorie sans pack → génériques');
  await db.query(`update fiila.shops set business_type = 'mode' where id = $1`, [A.id]);
});

await t('back-office des décors : résultats par décor ; couper/activer réservé, motif obligatoire, au journal', async () => {
  await ko('fiila_bo_studio_scenes', {}, null);
  const l = await ok('fiila_bo_studio_scenes', {}, SUP);
  const m2 = l.find((x) => x.id === 'mode-2'); assert.equal(m2.kept, 1); assert.equal(m2.series, 1);
  await ko('fiila_bo_studio_scene_set', { p_id: 'mode-1', p_active: false, p_reason: 'x' }, null, SUP);
  await ko('fiila_bo_studio_scene_set', { p_id: 'mode-1', p_active: false, p_reason: '' }, 'reason_required', F);
  await ok('fiila_bo_studio_scene_set', { p_id: 'mode-1', p_active: false, p_reason: 'Peu gardé [TEST]' }, F);
  assert.deepEqual((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).scenes.map((x) => x.id), ['mode-2']);
  assert.ok(await one(`select 1 from fiila.admin_log where action = 'studio_scene' and target_id = 'mode-1'`));
});

await t('export quotidien : réservé à la clé de service ; résumé par boutique sans donnée client', async () => {
  await ko('fiila_studio_export', {}, null);
  const e = await ok('fiila_studio_export', {}, SR);
  const a = e.shops.find((x) => x.name === 'Studio A [TEST]');
  assert.ok(a); assert.equal(a.category, 'mode'); assert.ok(a.series >= 1); assert.ok(a.styles['mode-2']);
  assert.ok(a.journal.length >= 1); assert.ok('product' in a.journal[0]);
  const keys = JSON.stringify(e); assert.ok(!/phone|whatsapp|address|key/i.test(Object.keys(a).join(',')), 'aucun champ sensible');
});

await t('modes : premium proposé selon la catégorie (jamais bijoux), prompt = caméra + gabarit + décor, garder en premium coûte 3 crédits', async () => {
  for (const [k, v] of [['studio_tpl_camera', 'CAM. '], ['studio_tpl_keep', 'KEEP. '], ['studio_tpl_wear', 'WEAR. ']]) await db.query(`update fiila.settings set value = $2 where key = $1`, [k, v]);
  await db.query(`update fiila.studio_jobs set status = 'failed' where shop_id = $1 and status = 'running'`, [A.id]);
  await db.query(`delete from fiila.studio_jobs where shop_id = $1 and created_at > now() - interval '1 day' and status = 'failed'`, [A.id]);
  const st = await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid });
  assert.deepEqual(st.premium, { credits: 3, wear: true }, 'mode : mannequin');
  await db.query(`update fiila.studio_wallets set credits = 2 where shop_id = $1`, [A.id]);
  await db.query(`update fiila.partner_trials set status = 'ended' where shop_id = $1`, [A.id]);
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'mode-2', p_mode: 'premium' }, 'studio_no_credits');
  await db.query(`update fiila.studio_wallets set credits = 5 where shop_id = $1`, [A.id]);
  const r = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'mode-2', p_mode: 'premium' });
  assert.equal(r.mode, 'premium'); assert.match(r.prompt, /^CAM\. WEAR\. light wooden clothing rail/);
  await ok('fiila_studio_complete', { p_job: r.job, p: { results: ['https://v3.fal.media/files/x/p.jpg'], cost_usd: 0.15 } }, SR);
  const k = await ok('fiila_studio_keep', { p_key: A.key, p_job: r.job, p_index: 0 });
  assert.equal(k.credits.wallet, 2, '3 crédits débités');
  const f = await ok('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'mode-2' });
  assert.equal(f.mode, 'fidele'); assert.match(f.prompt, /^CAM\. light wooden/, 'fidèle : pas de gabarit premium');
  await db.query(`update fiila.studio_jobs set status = 'failed' where id = $1`, [f.job]);
  await db.query(`update fiila.shops set business_type = 'bijoux' where id = $1`, [A.id]);
  assert.equal((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).premium, null, 'bijoux : jamais de premium');
  await db.query(`update fiila.shops set business_type = 'mode' where id = $1`, [A.id]);
  await ok('fiila_bo_setting_set', { p_key: 'studio_premium', p_value: 0 }, F);
  assert.equal((await ok('fiila_studio_state', { p_key: A.key, p_product: A.pid })).premium, null);
  await ko('fiila_studio_reserve', { p_key: A.key, p_product: A.pid, p_style: 'mode-2', p_mode: 'premium' }, 'studio_premium_off');
  await ok('fiila_bo_setting_set', { p_key: 'studio_premium', p_value: 1 }, F);
  await ko('fiila_bo_setting_set', { p_key: 'studio_premium_credits', p_value: 50 }, null, F);
  assert.ok((await ok('fiila_bo_studio', {}, SUP)).jobs.some((x) => x.mode === 'premium'));
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL Studio réussis`);
process.exit(passed === results.length ? 0 : 1);
