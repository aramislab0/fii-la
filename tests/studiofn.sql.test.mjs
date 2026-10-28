// Fonction fiila-studio : droits vérifiés avec l'identité de l'appelant, fal simulé (aucun appel réel, aucune clé réelle).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeHandler, SCENES, MODEL } from '../supabase/functions/fiila-studio/handler.mjs';
import { maskFromCutout, pngAlpha } from '../supabase/functions/fiila-studio/mask.mjs';
import { makeHandler as makeExport } from '../supabase/functions/fiila-studio-export/handler.mjs';

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', FAL_KEY: 'fal-test' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
function sim({ reserve = { job: 'j1', style: 'luxe', image: 'data:image/jpeg;base64,AAA' }, fal = null, result = 'https://v3.fal.media/files/x/1.png', media = null, storage = null } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (url.startsWith('https://rest.alpha.fal.ai/storage/upload/initiate')) return json({ upload_url: 'https://upload.fal.media/put/1', file_url: 'https://v3.fal.media/files/up/photo.jpeg' });
    if (url === 'https://upload.fal.media/put/1') return new Response(null, { status: 200 });
    if (url.startsWith('https://fal.run/')) return fal ? fal(url) : json({ images: [1, 2, 3].map((i) => ({ url: `https://v3.fal.media/files/x/${i}.png` })) });
    if (url.startsWith('https://p.supabase.co/storage/') && storage) return storage(url, init);
    if (url.startsWith('https://v3.fal.media/') && media) return media(url);
    if (url.startsWith('https://v3.fal.media/')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    const fn = url.split('/rpc/')[1];
    if (fn === 'fiila_studio_reserve') return reserve ? json(reserve) : json({ message: 'fiila:studio_no_credits' }, 400);
    if (fn === 'fiila_studio_complete') { const p = calls.at(-1).body.p; const ok = !!(p.results && p.path); return json({ id: 'j1', status: ok ? 'done' : 'failed', results: p.results || [], error: ok ? null : p.error || 'provider_store', credits: { total: 2 } }); }
    if (fn === 'fiila_studio_result') return result ? json(typeof result === 'string' ? { url: result } : result) : json({ message: 'fiila:not_found' }, 400);
    if (fn === 'fiila_studio_lost') return json({ refunded: true, credits: { total: 3 } });
    return json({});
  };
  return { fetch, calls };
}
const req = (body, auth = 'Bearer anon-test') => new Request('https://x/functions/v1/fiila-studio', { method: 'POST', body: JSON.stringify(body), headers: auth ? { authorization: auth } : {} });

await t('sans session (clé de boutique seule) : droits demandés à la base sans en-tête Authorization ; action inconnue refusée ; sans FAL_KEY → configured:false', async () => {
  const s0 = sim();
  const r0 = await makeHandler({ env: (k) => ENV[k], fetch: s0.fetch })(req({ action: 'render', key: 'cle', product: 'p', style: 'blanc' }, null));
  assert.equal(r0.status, 200);
  const rv = s0.calls.find((c) => c.url.endsWith('fiila_studio_reserve'));
  assert.equal(rv.init.headers.Authorization, undefined); assert.equal(rv.init.headers.apikey, 'anon-test');
  const s = sim();
  assert.equal((await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'zap' }))).status, 400);
  const r = await makeHandler({ env: (k) => ({ ...ENV, FAL_KEY: '' })[k], fetch: s.fetch })(req({ action: 'render', key: 'k', product: 'p', style: 'luxe' }));
  assert.equal((await r.json()).configured, false);
  assert.equal(s.calls.length, 0);
});

await t('série « fidèle » : droits avec l’identité de la personne ; Bria replace-background avec la photo et le décor ; 1 version (0,04 USD) écrite avec la clé de service', async () => {
  const s = sim();
  const r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'luxe' }, 'Bearer jwt-user'));
  const b = await r.json();
  assert.equal(b.status, 'done'); assert.equal(b.results.length, 1);
  const res = s.calls.find((c) => c.url.endsWith('fiila_studio_reserve'));
  assert.equal(res.init.headers.Authorization, 'Bearer jwt-user'); assert.deepEqual(res.body, { p_key: 'cle', p_product: 'p1', p_style: 'luxe', p_mode: 'fidele' });
  const f = s.calls.find((c) => c.url.startsWith('https://fal.run/'));
  assert.equal(f.url, 'https://fal.run/' + MODEL); assert.equal(MODEL, 'bria/replace-background'); assert.equal(f.init.headers.Authorization, 'Key fal-test');
  assert.equal(f.body.image_url, 'https://v3.fal.media/files/up/photo.jpeg', 'Bria refuse les data URI : photo déposée sur le stockage fal');
  const put = s.calls.find((c) => c.url === 'https://upload.fal.media/put/1');
  assert.equal(put.init.method, 'PUT'); assert.equal(put.init.headers['Content-Type'], 'image/jpeg'); assert.equal(put.init.body.length, 2);
  assert.equal(f.body.prompt, SCENES.luxe);
  const c = s.calls.find((x) => x.url.endsWith('fiila_studio_complete'));
  assert.equal(c.init.headers.Authorization, 'Bearer service-test'); assert.equal(c.body.p.cost_usd, 0.12, 'les 3 images renvoyées par le simulateur sont toutes comptées');
});

await t('série « premium » : Nano Banana Pro 2K, 4:5, une image, prompt de la base ; coût 0,15 USD par image', async () => {
  const s = sim({ reserve: { job: 'j1', style: 'beaute-p1', mode: 'premium', prompt: 'CAM KEEP scene [TEST]', image: 'data:image/jpeg;base64,AAA' },
    fal: () => json({ images: [{ url: 'https://v3.fal.media/files/x/p.jpg' }] }) });
  const r = await (await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'beaute-p1', mode: 'premium' }))).json();
  assert.equal(r.status, 'done');
  assert.equal(s.calls.find((c) => c.url.endsWith('fiila_studio_reserve')).body.p_mode, 'premium');
  const f = s.calls.find((c) => c.url.startsWith('https://fal.run/'));
  assert.equal(f.url, 'https://fal.run/fal-ai/nano-banana-pro/edit');
  assert.deepEqual(f.body, { prompt: 'CAM KEEP scene [TEST]', image_urls: ['data:image/jpeg;base64,AAA'], num_images: 1, aspect_ratio: '4:5', resolution: '2K', output_format: 'jpeg' });
  assert.equal(s.calls.find((x) => x.url.endsWith('fiila_studio_complete')).body.p.cost_usd, 0.15);
});

// Détourage simulé : PNG RVBA 20 × 25 dont le rectangle central (8 × 10) est opaque (le produit).
const { PNG } = createRequire(import.meta.url)('pngjs');
function cutoutPng(w = 20, h = 25) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, inside = x >= 6 && x < 14 && y >= 8 && y < 18;
    p.data[i] = 200; p.data[i + 1] = 100; p.data[i + 2] = 50; p.data[i + 3] = inside ? 255 : (x + y) % 2 ? 40 : 0;
  }
  return PNG.sync.write(p);
}

await t('masque FIBO : produit (opacité ≥ 50 %) en noir, décor en blanc, même taille ; PNG relu par une bibliothèque indépendante ; détourage vide refusé', async () => {
  const m = await maskFromCutout(cutoutPng());
  assert.equal(m.width, 20); assert.equal(m.height, 25); assert.equal(m.share, 80 / 500);
  const back = PNG.sync.read(Buffer.from(m.png));
  assert.equal(back.width, 20); assert.equal(back.height, 25);
  assert.equal(back.data[(10 * 20 + 8) * 4], 0, 'produit gardé : noir'); assert.equal(back.data[(1 * 20 + 1) * 4], 255, 'décor refait : blanc');
  assert.equal((await pngAlpha(cutoutPng())).alpha[(10 * 20 + 8)], 255);
  const empty = new PNG({ width: 10, height: 10 }); // tout transparent
  await assert.rejects(() => maskFromCutout(PNG.sync.write(empty)), /mask_unusable/);
  await assert.rejects(() => maskFromCutout(new Uint8Array([1, 2, 3])), /png_invalid/);
});

await t('moteur « fibo_mask » : détourage, masque déposé sur le stockage fal, FIBO 2.0 avec mask_url ; coût 0,058 USD ; sans détourage : échec propre, détourage compté', async () => {
  const urls = [];
  const s = sim({ reserve: { job: 'j1', style: 'bijoux-p2', mode: 'fidele', engine: 'fibo_mask', prompt: 'CAM scene [TEST]', image: 'data:image/jpeg;base64,AAA' },
    fal: (u) => { urls.push(u); return json(u.endsWith('/fal-ai/bria/background/remove') ? { image: { url: 'https://v3.fal.media/files/x/cut.png' } }
      : { image: { url: 'https://v3.fal.media/files/x/fibo.jpg' }, images: [{ url: 'https://v3.fal.media/files/x/fibo.jpg' }], vgl: { edit_instruction: 'x' } }); },
    media: () => new Response(cutoutPng(), { headers: { 'content-type': 'image/png' } }) });
  const r = await (await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'bijoux-p2' }))).json();
  assert.equal(r.status, 'done'); assert.deepEqual(r.results, ['https://v3.fal.media/files/x/fibo.jpg']);
  assert.deepEqual(urls, ['https://fal.run/fal-ai/bria/background/remove', 'https://fal.run/bria/fibo-2/edit']);
  const cut = s.calls.find((c) => c.url.endsWith('/background/remove'));
  assert.deepEqual(cut.body, { image_url: 'https://v3.fal.media/files/up/photo.jpeg' });
  const puts = s.calls.filter((c) => c.url === 'https://upload.fal.media/put/1');
  assert.equal(puts.length, 2, 'photo puis masque déposés');
  assert.equal(puts[1].init.headers['Content-Type'], 'image/png');
  const m = PNG.sync.read(Buffer.from(puts[1].init.body));
  assert.equal(m.data[(10 * 20 + 8) * 4], 0); assert.equal(m.data[0], 255);
  const f = s.calls.find((c) => c.url.endsWith('/bria/fibo-2/edit'));
  assert.deepEqual(f.body, { image_urls: ['https://v3.fal.media/files/up/photo.jpeg'], mask_url: 'https://v3.fal.media/files/up/photo.jpeg', instruction: 'CAM scene [TEST]' });
  assert.equal(s.calls.find((x) => x.url.endsWith('fiila_studio_complete')).body.p.cost_usd, 0.058);
  // Détourage refusé par fal : pas d'appel FIBO, échec « provider_mask », le détourage reste compté.
  const s2 = sim({ reserve: { job: 'j1', style: 'bijoux-p2', engine: 'fibo_mask', prompt: 'P', image: 'https://exemple/p.jpg' }, fal: () => json({ detail: 'x' }, 500) });
  const r2 = await (await makeHandler({ env: (k) => ENV[k], fetch: s2.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'bijoux-p2' }))).json();
  assert.equal(r2.status, 'failed'); assert.equal(r2.error, 'provider_mask');
  assert.equal(s2.calls.filter((c) => c.url.startsWith('https://fal.run/')).length, 1);
  assert.equal(s2.calls.find((x) => x.url.endsWith('fiila_studio_complete')).body.p.cost_usd, 0.018);
});

await t('moteur « fibo » (vêtement porté) : FIBO 2.0 sans masque, 4:5, prompt de la base ; 0,04 USD ; moteur absent = moteur d’avant selon le mode', async () => {
  const s = sim({ reserve: { job: 'j1', style: 'mode-2', mode: 'premium', engine: 'fibo', prompt: 'CAM WEAR scene [TEST]', image: 'data:image/jpeg;base64,AAA' },
    fal: () => json({ image: { url: 'https://v3.fal.media/files/x/w.jpg' }, images: [{ url: 'https://v3.fal.media/files/x/w.jpg' }] }) });
  const r = await (await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'mode-2', mode: 'premium' }))).json();
  assert.equal(r.status, 'done');
  const f = s.calls.filter((c) => c.url.startsWith('https://fal.run/'));
  assert.equal(f.length, 1); assert.equal(f[0].url, 'https://fal.run/bria/fibo-2/edit');
  assert.deepEqual(f[0].body, { image_urls: ['https://v3.fal.media/files/up/photo.jpeg'], instruction: 'CAM WEAR scene [TEST]', aspect_ratio: '4:5' });
  assert.equal(s.calls.find((x) => x.url.endsWith('fiila_studio_complete')).body.p.cost_usd, 0.04);
  const s2 = sim({ reserve: { job: 'j1', style: 'mode-2', mode: 'premium', prompt: 'P', image: 'data:image/jpeg;base64,AAA' }, fal: () => json({ images: [{ url: 'https://v3.fal.media/files/x/p.jpg' }] }) });
  await makeHandler({ env: (k) => ENV[k], fetch: s2.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'mode-2', mode: 'premium' }));
  assert.equal(s2.calls.find((c) => c.url.startsWith('https://fal.run/')).url, 'https://fal.run/fal-ai/nano-banana-pro/edit');
});

await t('copie durable : image de fal copiée dans le seau privé « studio » (s/<série>.<ext>, clé de service) avant la fin ; sans copie : la base rend les crédits', async () => {
  const s = sim({ reserve: { job: '2f6bd807-a43e-412f-ac96-24b5c6b51518', style: 'luxe', engine: 'bria', prompt: 'P', image: 'data:image/jpeg;base64,AAA' },
    fal: () => json({ images: [{ url: 'https://v3.fal.media/files/x/r.jpg' }] }),
    media: () => new Response(new Uint8Array([255, 216, 255, 1, 2]), { headers: { 'content-type': 'image/jpeg' } }) });
  const r = await (await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'luxe' }))).json();
  assert.equal(r.status, 'done'); assert.deepEqual(r.credits, { total: 2 });
  const up = s.calls.find((c) => c.url.startsWith('https://p.supabase.co/storage/v1/object/studio/'));
  assert.equal(up.url, 'https://p.supabase.co/storage/v1/object/studio/s/2f6bd807-a43e-412f-ac96-24b5c6b51518.jpg');
  assert.equal(up.init.headers.Authorization, 'Bearer service-test'); assert.equal(up.init.headers['Content-Type'], 'image/jpeg'); assert.equal(up.init.body.length, 5);
  assert.equal(s.calls.find((x) => x.url.endsWith('fiila_studio_complete')).body.p.path, 's/2f6bd807-a43e-412f-ac96-24b5c6b51518.jpg');
  // Seau indisponible : pas de chemin envoyé, la base classe la série en échec (crédits rendus), l'application ne reçoit pas d'image.
  const s2 = sim({ reserve: { job: 'j1', style: 'luxe', engine: 'bria', prompt: 'P', image: 'https://exemple/p.jpg' },
    fal: () => json({ images: [{ url: 'https://v3.fal.media/files/x/r.jpg' }] }),
    media: () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/jpeg' } }), storage: () => new Response('{}', { status: 500 }) });
  const r2 = await (await makeHandler({ env: (k) => ENV[k], fetch: s2.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'luxe' }))).json();
  assert.equal(r2.status, 'failed'); assert.deepEqual(r2.results, []); assert.equal(r2.error, 'provider_store');
  assert.equal(s2.calls.find((x) => x.url.endsWith('fiila_studio_complete')).body.p.path, undefined);
});

await t('reprendre l’image (« take ») : copie durable lue avec la clé de service ; introuvable → crédits rendus une fois (410) ; sans copie : adresse fal comme avant', async () => {
  const path = 's/2f6bd807-a43e-412f-ac96-24b5c6b51518.png';
  const s = sim({ result: { url: 'https://v3.fal.media/files/x/1.png', path, job: '2f6bd807-a43e-412f-ac96-24b5c6b51518' },
    storage: () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }) });
  const b = await (await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'take', key: 'cle', job: '2f6bd807-a43e-412f-ac96-24b5c6b51518', index: 0 }))).json();
  assert.equal(b.image, 'data:image/png;base64,iVBORw==');
  const g = s.calls.find((c) => c.url.startsWith('https://p.supabase.co/storage/'));
  assert.equal(g.url, 'https://p.supabase.co/storage/v1/object/studio/' + path); assert.equal(g.init.headers.Authorization, 'Bearer service-test');
  assert.ok(!s.calls.some((c) => c.url.startsWith('https://v3.fal.media/')), 'fal pas sollicité');
  const s2 = sim({ result: { url: 'https://v3.fal.media/files/x/1.png', path, job: 'j1' }, storage: () => new Response('{"error":"not_found"}', { status: 404 }) });
  const r2 = await makeHandler({ env: (k) => ENV[k], fetch: s2.fetch })(req({ action: 'take', key: 'cle', job: 'j1', index: 0 }));
  assert.equal(r2.status, 410); assert.deepEqual(await r2.json(), { error: 'expired', refunded: true, credits: { total: 3 } });
  const lost = s2.calls.find((c) => c.url.endsWith('fiila_studio_lost'));
  assert.deepEqual(lost.body, { p_job: 'j1' }); assert.equal(lost.init.headers.Authorization, 'Bearer service-test');
  const s3 = sim({ result: { url: 'https://v3.fal.media/files/x/1.png' } });
  assert.equal((await (await makeHandler({ env: (k) => ENV[k], fetch: s3.fetch })(req({ action: 'take', key: 'cle', job: 'j1', index: 0 }))).json()).image, 'data:image/png;base64,iVBORw==');
});

await t('refus de la base (crédits) → 409 lisible, fal jamais appelé ; échec de fal → série en échec, code interne (jamais le message de fal)', async () => {
  let s = sim({ reserve: null });
  let r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'k', product: 'p', style: 'blanc' }));
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'studio_no_credits');
  assert.ok(!s.calls.some((c) => c.url.startsWith('https://fal.run/')));
  s = sim({ fal: () => json({ detail: 'Image too small' }, 422) });
  r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'k', product: 'p', style: 'blanc' }));
  const b = await r.json();
  assert.equal(b.status, 'failed'); assert.equal(b.error, 'provider_error', 'code interne seulement pour l’application');
  assert.equal(s.calls.find((c) => c.url.endsWith('fiila_studio_complete')).body.p.error, 'provider_error', 'le message brut de fal n’est pas enregistré');
  assert.ok(!JSON.stringify(s.calls.find((c) => c.url.endsWith('fiila_studio_complete')).body).includes('Image too small'));
  s = sim({ fal: () => { throw new TypeError('network'); } });
  r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'k', product: 'p', style: 'blanc' }));
  assert.equal((await r.json()).error, 'provider_unavailable');
});

await t('images hors de fal ignorées (aucune adresse étrangère enregistrée)', async () => {
  const s = sim({ fal: () => json({ images: [{ url: 'https://evil.example/x.png' }, { url: 'https://v3.fal.media/files/ok.png' }] }) });
  await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'k', product: 'p', style: 'blanc' }));
  assert.deepEqual(s.calls.find((c) => c.url.endsWith('fiila_studio_complete')).body.p.results, ['https://v3.fal.media/files/ok.png']);
});

await t('reprise de la version : droit vérifié par la base, image renvoyée en base64 ; autre boutique → 403', async () => {
  let s = sim();
  let r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'take', key: 'k', job: 'j1', index: 1 }));
  assert.match((await r.json()).image, /^data:image\/png;base64,iVBORw==$/);
  s = sim({ result: null });
  r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'take', key: 'autre', job: 'j1', index: 1 }));
  assert.equal(r.status, 403);
  s = sim({ result: 'https://evil.example/x.png' });
  r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'take', key: 'k', job: 'j1', index: 0 }));
  assert.equal(r.status, 404);
});

await t('décor du pack : le prompt renvoyé par la base est envoyé à fal (pas un décor codé ici)', async () => {
  const s = sim({ reserve: { job: 'j1', style: 'mode-2', prompt: 'light wooden clothing rail [TEST]', image: 'data:image/jpeg;base64,AAA' } });
  await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'mode-2' }));
  assert.equal(s.calls.find((c) => c.url.startsWith('https://fal.run/')).body.prompt, 'light wooden clothing rail [TEST]');
  const s2 = sim({ reserve: { job: 'j1', style: 'inconnu', image: 'data:image/jpeg;base64,AAA' } });
  const r2 = await (await makeHandler({ env: (k) => ENV[k], fetch: s2.fetch })(req({ action: 'render', key: 'cle', product: 'p1', style: 'inconnu' }))).json();
  assert.equal(r2.status, 'failed'); assert.ok(!s2.calls.some((c) => c.url.startsWith('https://fal.run/')), 'aucun appel payant sans décor');
});

await t('export quotidien : jeton requis (absent, court ou faux → refusé), base appelée avec la clé de service', async () => {
  const TOK = 'a'.repeat(64);
  const calls = []; const fetch = async (url, init) => { calls.push({ url, init }); return json({ generated_at: 'x', shops: [] }); };
  const exp = (env) => makeExport({ env: (k) => ({ ...ENV, ...env })[k], fetch });
  const r = (h) => new Request('https://x/functions/v1/fiila-studio-export', { method: 'POST', headers: h || {}, body: '{}' });
  assert.equal((await exp({})(r({ 'x-export-token': TOK }))).status, 503, 'non configuré');
  assert.equal((await exp({ STUDIO_EXPORT_TOKEN: 'court' })(r({ 'x-export-token': 'court' }))).status, 503);
  assert.equal((await exp({ STUDIO_EXPORT_TOKEN: TOK })(r({}))).status, 401);
  assert.equal((await exp({ STUDIO_EXPORT_TOKEN: TOK })(r({ 'x-export-token': 'b'.repeat(64) }))).status, 401);
  assert.equal(calls.length, 0);
  const ok = await exp({ STUDIO_EXPORT_TOKEN: TOK })(r({ 'x-export-token': TOK }));
  assert.equal(ok.status, 200); assert.ok(calls[0].url.endsWith('/rpc/fiila_studio_export')); assert.equal(calls[0].init.headers.Authorization, 'Bearer service-test');
});

console.log(`\n${passed}/${passed + failed} tests fonction Studio réussis`);
process.exit(failed ? 1 : 0);
