// Fii Studio — bench interne TEMPORAIRE (fondateur, 27/10/2026 : « oui » au bench < 15 USD sur 20 produits).
// Relais vers fal avec la clé de bench FAL_BENCH_KEY (saisie par le fondateur, supprimée après le bench). Protégé par un jeton
// de session dont seule l'empreinte SHA-256 est connue du serveur (BENCH_NONCE_SHA256). Modèles limités à une liste.
// Aucune donnée de boutique : les photos d'entrée sont synthétiques. À retirer (ou neutraliser) à la fin du bench.
export const ALLOWED = /^(fal-ai\/flux\/dev|fal-ai\/bria\/product-shot|bria\/replace-background|bria\/fibo-2\/edit|google\/nano-banana-2\.1\/edit|fal-ai\/nano-banana\/edit|fal-ai\/nano-banana-2\/edit|fal-ai\/bytedance\/seedream\/v5\/lite\/edit|minimax\/h3-max\/image-to-video|minimax\/h3\/image-to-video)$/;
export function makeHandler({ env, fetch, digest }) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const want = env('BENCH_NONCE_SHA256'), key = env('FAL_BENCH_KEY');
    if (!want || !key) return json(503, { error: 'not_configured' });
    const nonce = req.headers.get('x-bench-nonce') || '';
    if (nonce.length < 32 || (await digest(nonce)) !== want) return json(401, { error: 'unauthorized' });
    let b; try { b = await req.json(); } catch { return json(400, { error: 'invalid' }); }
    const auth = { Authorization: 'Key ' + key };
    if (b.op === 'get') {   // statut ou résultat d'une requête en file (vidéo)
      if (typeof b.url !== 'string' || !/^https:\/\/queue\.fal\.run\//.test(b.url)) return json(400, { error: 'url' });
      const r = await fetch(b.url, { headers: auth });
      return json(r.status, await r.json().catch(() => ({})));
    }
    if (typeof b.model !== 'string' || !ALLOWED.test(b.model) || !b.input || typeof b.input !== 'object') return json(400, { error: 'model' });
    const base = b.op === 'submit' ? 'https://queue.fal.run/' : 'https://fal.run/';
    const t0 = Date.now();
    const r = await fetch(base + b.model, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(b.input) });
    const body = await r.json().catch(() => ({}));
    return json(r.status, { ms: Date.now() - t0, result: body });
  };
}
