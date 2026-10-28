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

import { corsFor, readText, MB } from '../_shared/http.mjs';
import { maskFromCutout } from './mask.mjs';
// Corps limité à 14 Mo (marge pour une photo en base64 ; aujourd'hui l'image est lue en base, le corps reste petit).
const MAX_BODY = 14 * MB;

export const MODEL = 'bria/replace-background';            // mode « fidele »
export const PRICE_USD = 0.04;                              // par image (fal, consulté le 27/10/2026)
export const MODEL_PREMIUM = 'fal-ai/nano-banana-pro/edit'; // mode « premium »
export const PRICE_PREMIUM_USD = 0.15;                      // par image 1K/2K (fal, consulté le 27/10/2026)
// Comparatif du 28/10/2026 (base privée XEL, bench/FIBO.md) : FIBO 2.0 Edit, avec masque (produit gardé au pixel près,
// décor refait) ou sans masque (vêtement porté). Le moteur de chaque série est choisi par la base (fiila.studio_engine).
export const MODEL_FIBO = 'bria/fibo-2/edit';
export const PRICE_FIBO_USD = 0.04;                         // par image (fal, consulté le 28/10/2026)
export const MODEL_CUTOUT = 'fal-ai/bria/background/remove';
export const PRICE_CUTOUT_USD = 0.018;                      // détourage qui donne le masque (fal, 28/10/2026)
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
  // Deux modes vus par la boutique (« fidele », « premium ») ; le moteur de chaque série est choisi par la base (28/10/2026) :
  // Bria replace-background, Nano Banana Pro 2K, FIBO 2.0 avec ou sans masque. Une version par série.
  // Bria (mode fidèle) refuse les images en data URI : la photo est d'abord déposée sur le stockage de fal (adresse
  // temporaire), même protocole que le client officiel. Repli sur la data URI si le dépôt échoue.
  async function upload(image) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(image || '');
    if (!m) return image;
    try {
      const auth = { Authorization: 'Key ' + env('FAL_KEY') };
      const r = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', { method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ content_type: m[1], file_name: 'photo.' + m[1].split('/')[1] }) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.upload_url || !FAL_HOST.test(t.file_url || '')) return image;
      const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      const p = await fetch(t.upload_url, { method: 'PUT', headers: { 'Content-Type': m[1] }, body: bin });
      return p.ok ? t.file_url : image;
    } catch { return image; }
  }
  async function run(model, input) {
    const r = await fetch(`https://fal.run/${model}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + env('FAL_KEY') }, body: JSON.stringify(input) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Le message de fal reste dans le journal (statut, modèle, détail court ; ni photo, ni prompt, ni donnée de boutique) ;
      // la base et l'application ne reçoivent qu'un code interne.
      const detail = (body && (body.detail && (body.detail[0]?.msg || body.detail))) || body.error || null;
      console.log(JSON.stringify({ studio_fal: 'failed', model, status: r.status, detail: detail == null ? null : String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 200) }));
      return null;
    }
    const imgs = body.images || (body.image ? [body.image] : []);
    return { count: imgs.length, urls: imgs.map((x) => x && x.url).filter((u) => typeof u === 'string' && FAL_HOST.test(u)).slice(0, 1) };
  }
  // Masque FIBO : détourage Bria (PNG transparent) → noir = produit gardé, blanc = décor refait ; déposé sur le stockage de fal.
  async function mask(image) {
    const cut = await run(MODEL_CUTOUT, { image_url: image });
    if (!cut || !cut.urls.length) return null;
    const r = await fetch(cut.urls[0]);
    if (!r.ok) return null;
    const m = await maskFromCutout(new Uint8Array(await r.arrayBuffer()));
    let s = ''; for (let i = 0; i < m.png.length; i += 0x8000) s += String.fromCharCode.apply(null, m.png.subarray(i, i + 0x8000));
    const url = await upload('data:image/png;base64,' + btoa(s));
    return FAL_HOST.test(url) ? url : null;
  }
  // engine (fiila.studio_engine) : bria | nano | fibo | fibo_mask ; absent (base pas encore à jour) = moteur d'avant selon le mode.
  async function fal(image, prompt, mode, engine) {
    const eng = engine || (mode === 'premium' ? 'nano' : 'bria');
    if (eng !== 'nano') image = await upload(image);
    let cost = 0, model, input;
    if (eng === 'nano') { model = MODEL_PREMIUM; input = { prompt, image_urls: [image], num_images: 1, aspect_ratio: '4:5', resolution: '2K', output_format: 'jpeg' }; }
    else if (eng === 'fibo') { model = MODEL_FIBO; input = { image_urls: [image], instruction: prompt, aspect_ratio: '4:5' }; }
    else if (eng === 'fibo_mask') {
      cost += PRICE_CUTOUT_USD;
      let m = null;
      try { m = await mask(image); } catch (e) { console.log(JSON.stringify({ studio_mask: 'failed', error: String((e && e.message) || e).slice(0, 60) })); }
      if (!m) return { error: 'provider_mask', cost_usd: cost };
      model = MODEL_FIBO; input = { image_urls: [image], mask_url: m, instruction: prompt };
    } else { model = MODEL; input = { image_url: image, prompt }; }
    const out = await run(model, input);
    if (!out) return cost ? { error: 'provider_error', cost_usd: cost } : { error: 'provider_error' };
    cost += Math.max(out.count, out.urls.length) * (eng === 'nano' ? PRICE_PREMIUM_USD : eng === 'bria' ? PRICE_USD : PRICE_FIBO_USD);
    return out.urls.length ? { results: out.urls, cost_usd: +cost.toFixed(4) } : { error: 'provider_no_image', cost_usd: +cost.toFixed(4) };
  }
  const configured = () => !!env('FAL_KEY');

  return async (req) => {
    const cors = corsFor(req);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    // Sans session (boutique sans compte, clé publique au nouveau format) : pas d'en-tête Authorization ; la base vérifie
    // alors les droits par la clé de la boutique.
    const auth = { auth: req.headers.get('authorization') || '' };
    const raw = await readText(req, MAX_BODY);
    if (raw === null) return json(413, { error: 'too_large' });
    let b; try { b = JSON.parse(raw); } catch { return json(400, { error: 'invalid' }); }
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
    try { out = scene ? await fal(job.image, scene, job.mode, job.engine) : { error: 'unknown_scene' }; }
    catch (e) {
      console.log(JSON.stringify({ studio_fal: 'unreachable', error: String((e && e.name) || 'error').slice(0, 60) }));
      out = { error: 'provider_unavailable' };
    }
    const done = await rpc('fiila_studio_complete', { p_job: job.job, p: out }, null);
    return json(200, { configured: true, job: job.job, status: done.status, results: done.results || [], error: done.error || null });
  };
}
