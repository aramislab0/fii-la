// Fii Studio : 3 versions « pro » d'une photo d'article (docs/PLAN-FII-STUDIO.md).
// Appelée par l'application avec la clé de la boutique (ou la session) :
//   { action: 'render', key, product, style }  ouvre une série (droits, crédits, budget vérifiés par la base), envoie la photo
//                                             à fal (Bria Product Shot : le produit garde ses pixels, seul le décor est créé),
//                                             enregistre les 3 adresses et le coût réel (clé de service) ;
//   { action: 'take', key, job, index }        renvoie l'image choisie en base64 (l'application l'enregistre comme photo de
//                                             l'article, avec les contrôles habituels) — évite tout accès direct à fal depuis
//                                             le téléphone.
// Secret (Supabase → Edge Functions → Secrets, saisi par le fondateur, jamais dans le dépôt) : FAL_KEY.
// Sans FAL_KEY : { configured: false } et rien n'est ouvert. SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY : fournis.

export const MODEL = 'fal-ai/bria/product-shot';
export const PRICE_USD = 0.04;   // par image (fal, consulté le 26/10/2026)
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
  async function fal(image, style) {
    const r = await fetch(`https://fal.run/${MODEL}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + env('FAL_KEY') },
      body: JSON.stringify({ image_url: image, scene_description: SCENES[style], optimize_description: true, num_results: 3, fast: true,
        placement_type: 'automatic', shot_size: [880, 1100], sync_mode: false }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { error: String((body && (body.detail && (body.detail[0]?.msg || body.detail))) || body.error || ('fal ' + r.status)).slice(0, 200) };
    const urls = (body.images || []).map((x) => x && x.url).filter((u) => typeof u === 'string' && FAL_HOST.test(u)).slice(0, 3);
    return urls.length ? { results: urls, cost_usd: urls.length * PRICE_USD } : { error: 'Aucune image renvoyée' };
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
    try { job = await rpc('fiila_studio_reserve', { p_key: b.key || null, p_product: b.product, p_style: b.style }, auth); }
    catch (e) { return json(e.status === 400 ? 409 : 502, { error: e.code || 'not_allowed' }); }
    let out;
    try { out = await fal(job.image, job.style); } catch { out = { error: 'Fournisseur indisponible' }; }
    const done = await rpc('fiila_studio_complete', { p_job: job.job, p: out }, null);
    return json(200, { configured: true, job: job.job, status: done.status, results: done.results || [], error: done.error || null });
  };
}
