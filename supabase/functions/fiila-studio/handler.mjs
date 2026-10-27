// Fii Studio : une version « studio » d'une photo d'article (docs/PLAN-FII-STUDIO.md).
// Appelée par l'application avec la clé de la boutique (ou la session) :
//   { action: 'render', key, product, style, mode }  ouvre une série (droits, crédits, budget vérifiés par la base ; prompt
//                                             composé par la base depuis les packs Aramis Studio), envoie la photo à fal selon
//                                             le mode, enregistre l'adresse et le coût réel (clé de service) ;
//   { action: 'take', key, job, index }        renvoie l'image choisie en base64 (l'application l'enregistre comme photo de
//                                             l'article, avec les contrôles habituels) — évite tout accès direct à fal depuis
//                                             le téléphone.
// Secret (Supabase → Edge Functions → Secrets, saisi par le fondateur, jamais dans le dépôt) : FAL_KEY.
// Sans FAL_KEY : { configured: false } et rien n'est ouvert. SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY : fournis.

export const MODEL = 'bria/replace-background';            // mode « fidele »
export const PRICE_USD = 0.04;                              // par image (fal, consulté le 27/10/2026)
export const MODEL_PREMIUM = 'fal-ai/nano-banana-pro/edit'; // mode « premium »
export const PRICE_PREMIUM_USD = 0.15;                      // par image 1K/2K (fal, consulté le 27/10/2026)
// Décors : description en anglais (exigence du modèle), sans caractères spéciaux. Le texte (nom, prix) n'est jamais écrit par
// l'IA : il est ajouté par les modèles de Fii (Publier).
export const SCENES = {
  blanc: 'pure white seamless studio background, soft natural contact shadow, even diffused light, ecommerce product photo',
  minimal: 'minimalist warm beige studio set, soft daylight from a window, subtle shadow, clean premium catalog photo',
  luxe: 'elegant dark marble surface, warm soft spotlight, luxury boutique ambiance, refined shadows',
  soleil: 'bright sunny outdoor terrace, warm golden hour light, soft palm leaf shadows, summer mood',
  fete: 'festive celebration table, warm golden lights bokeh, rich fabric textures, elegant holiday atmosphere'
};
const FAL_HOST = /^https:\/\/[a-z0-9.-]+\.fal\.(media|ai|run)\//;

export function makeHandler({ env, fetch }) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  const base = () => String(env('SUPABASE_URL') || '').replace(/\/$/, '');
  // caller : { auth } = identité de la personne (session, ou aucune : clé publique seule, droits par la clé de boutique) ;
  // null = clé de service.
  async function rpc(fn, args, caller) {
    const key = caller ? env('SUPABASE_ANON_KEY') : env('SUPABASE_SERVICE_ROLE_KEY');
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (!caller) headers.Authorization = 'Bearer ' + key;
    else if (caller.auth) headers.Authorization = caller.auth;
    const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args || {}) });
    const body = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((body && body.message) || 'rpc ' + r.status); e.status = r.status; e.code = /fiila:([a-z_]+)/.exec((body && body.message) || '')?.[1]; throw e; }
    return body;
  }
  // Deux modes (bench du 27/10/2026, base privée XEL) : « fidele » = Bria replace-background (le produit garde ses pixels,
  // 0,04 USD) ; « premium » = Nano Banana Pro 2K (rendu studio hyperréaliste, 0,15 USD). Une version par série.
  async function fal(image, prompt, mode) {
    const premium = mode === 'premium';
    const model = premium ? MODEL_PREMIUM : MODEL;
    const input = premium
      ? { prompt, image_urls: [image], num_images: 1, aspect_ratio: '4:5', resolution: '2K', output_format: 'jpeg' }
      : { image_url: image, prompt };
    const r = await fetch(`https://fal.run/${model}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + env('FAL_KEY') }, body: JSON.stringify(input) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { error: String((body && (body.detail && (body.detail[0]?.msg || body.detail))) || body.error || ('fal ' + r.status)).slice(0, 200) };
    const imgs = body.images || (body.image ? [body.image] : []);
    const urls = imgs.map((x) => x && x.url).filter((u) => typeof u === 'string' && FAL_HOST.test(u)).slice(0, 1);
    const cost = Math.max(imgs.length, urls.length) * (premium ? PRICE_PREMIUM_USD : PRICE_USD);
    return urls.length ? { results: urls, cost_usd: cost } : { error: 'Aucune image renvoyée', cost_usd: cost };
  }
  const configured = () => !!env('FAL_KEY');

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    // Sans session (boutique sans compte, clé publique au nouveau format) : pas d'en-tête Authorization ; la base vérifie
    // alors les droits par la clé de la boutique.
    const auth = { auth: req.headers.get('authorization') || '' };
    let b; try { b = await req.json(); } catch { return json(400, { error: 'invalid' }); }
    if (!b || !['render', 'take'].includes(b.action)) return json(400, { error: 'invalid' });
    if (!configured()) return json(200, { configured: false });
    if (b.action === 'take') {
      let r; try { r = await rpc('fiila_studio_result', { p_key: b.key || null, p_job: b.job, p_index: b.index }, auth); }
      catch (e) { return json(e.status === 400 ? 403 : 502, { error: e.code || 'not_allowed' }); }
      if (!r || !FAL_HOST.test(r.url || '')) return json(404, { error: 'not_found' });
      const img = await fetch(r.url);
      if (!img.ok) return json(410, { error: 'expired' });
      const type = (img.headers.get('content-type') || 'image/png').split(';')[0];
      if (!/^image\/(png|jpeg|webp)$/.test(type)) return json(502, { error: 'bad_image' });
      const buf = new Uint8Array(await img.arrayBuffer());
      if (buf.length > 12e6) return json(502, { error: 'too_large' });
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return json(200, { configured: true, image: `data:${type};base64,${btoa(s)}` });
    }
    let job;
    try { job = await rpc('fiila_studio_reserve', { p_key: b.key || null, p_product: b.product, p_style: b.style, p_mode: b.mode === 'premium' ? 'premium' : 'fidele' }, auth); }
    catch (e) { return json(e.status === 400 ? 409 : 502, { error: e.code || 'not_allowed' }); }
    let out;
    // Décor : prompt du pack de la catégorie (base, règle R2 d'Aramis Studio) ; repli sur les décors génériques.
    const scene = job.prompt || SCENES[job.style];
    try { out = scene ? await fal(job.image, scene, job.mode) : { error: 'Décor inconnu' }; } catch { out = { error: 'Fournisseur indisponible' }; }
    const done = await rpc('fiila_studio_complete', { p_job: job.job, p: out }, null);
    return json(200, { configured: true, job: job.job, status: done.status, results: done.results || [], error: done.error || null });
  };
}
