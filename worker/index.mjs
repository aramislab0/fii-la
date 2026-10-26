// Fii — Worker Cloudflare : sert l'application (fichiers de web/) et les sites des boutiques sur leur propre domaine.
// docs/PLAN-DOMAINES-FII.md §3. Règle par nom d'hôte :
//   - domaine principal (FII_HOSTS) : l'application complète ; www.<principal> renvoie vers le principal ;
//   - domaine de boutique vérifié et actif (fiila_domain_resolve) : le site de cette boutique seulement (la page porte
//     <meta name="fii-site">, l'application démarre alors en mode « site » : vitrine, panier, commande, facture) ;
//   - <lien>.fii.shop (SHOP_ZONE) : le site de la boutique au lien correspondant ; fii.shop et www.fii.shop → domaine principal ;
//   - tout autre hôte : « Site introuvable », sans l'application ni aucune donnée.
// La page HTML d'un domaine de boutique n'est jamais mise en cache partagé ; la correspondance hôte → boutique est gardée
// 60 secondes, indexée par nom d'hôte. Aucun secret ici : SUPABASE_ANON_KEY est la clé publique déjà servie par config.js.
// Variables (wrangler.jsonc) : FII_HOSTS (liste séparée par des virgules), CANONICAL_HOST, SUPABASE_URL, SUPABASE_ANON_KEY,
// LEGACY_PREFIX (ancienne adresse à remplacer dans les aperçus, ex. https://aramislab0.github.io/fii-la/).

const RESOLVE_TTL = 60;
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' };

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hostsOf = (env) => String(env.FII_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

// Page du domaine principal : les aperçus de partage pointent vers l'adresse canonique.
export function mainIndex(html, env) {
  const canon = `https://${env.CANONICAL_HOST}/`;
  return env.LEGACY_PREFIX ? html.split(env.LEGACY_PREFIX).join(canon) : html;
}
// Page d'un site de boutique : nom de la boutique partout, aucune marque Fii (Site Pro), pas d'application installable.
export function siteIndex(html, site) {
  const name = esc(site.name), meta = esc(JSON.stringify({ slug: site.slug, name: site.name, host: site.host }));
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${name}">`)
    .replace(/<meta property="og:site_name" content="[^"]*">/, `<meta property="og:site_name" content="${name}">`)
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*">/, `<meta name="apple-mobile-web-app-title" content="${name}">`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${name}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${name}">`)
    .replace(/<meta property="og:image[^>]*>\n?/g, '')
    .replace(/<meta name="twitter:card"[^>]*>\n?/, '')
    .replace(/<link rel="manifest"[^>]*>\n?/, '');
  out = out.replace('</head>', `<meta name="fii-site" content="${meta}">\n<meta property="og:url" content="https://${esc(site.host)}/">\n</head>`);
  return out;
}

export function notFound() {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Site introuvable</title><style>body{font-family:system-ui,sans-serif;background:#F5F2EA;color:#17201B;' +
    'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}h1{font-size:22px}</style></head>' +
    '<body><main><h1>Site introuvable</h1><p>Cette adresse n’est reliée à aucune boutique.</p></main></body></html>';
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY } });
}

// Boutique d'un nom d'hôte : { state: 'ok', slug, name, host } ou { state: 'unknown' }. Cache par hôte.
export async function resolveHost(host, env, deps) {
  const cache = deps.cache, key = new Request(`https://resolve.fii.invalid/${encodeURIComponent(host)}`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit.json(); }
  let out = { state: 'unknown' };
  try {
    const r = await deps.fetch(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/rpc/fiila_domain_resolve`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ p_host: host }) });
    if (r.ok) { const b = await r.json(); if (b && b.state === 'ok' && b.slug && b.host === host) out = { state: 'ok', slug: b.slug, name: b.name, host }; }
    else return { state: 'error' };   // base indisponible : on ne met rien en cache
  } catch { return { state: 'error' }; }
  if (cache) await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + RESOLVE_TTL } }));
  return out;
}

async function indexHtml(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL('/index.html', req.url), { method: 'GET' }));
  return r.text();
}

export async function handle(req, env, deps = {}) {
  deps = { fetch: deps.fetch || fetch, cache: 'cache' in deps ? deps.cache : (typeof caches !== 'undefined' ? caches.default : null) };
  const url = new URL(req.url), host = url.hostname.toLowerCase(), path = url.pathname;
  const hosts = hostsOf(env), canonical = String(env.CANONICAL_HOST || '').toLowerCase();
  if (canonical && host === 'www.' + canonical) return Response.redirect(`https://${canonical}${path}${url.search}`, 301);
  const zone = String(env.SHOP_ZONE || '').toLowerCase();
  if (zone && canonical && (host === zone || host === 'www.' + zone)) return Response.redirect(`https://${canonical}/`, 301);
  const isMain = hosts.includes(host) || host.endsWith('.workers.dev');
  if (isMain) {
    // Liens universels iPhone : fichier sans extension, servi en JSON (exigence d'Apple).
    if (path === '/.well-known/apple-app-site-association') {
      const r = await env.ASSETS.fetch(new Request(new URL(path, req.url), { method: 'GET' }));
      if (!r.ok) return new Response('Not found', { status: 404 });
      return new Response(await r.text(), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600', ...SECURITY } });
    }
    if (path === '/' || path === '/index.html') {
      return new Response(mainIndex(await indexHtml(env, req), env), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY } });
    }
    return env.ASSETS.fetch(req);
  }
  // Domaine de boutique : rien n'est servi avant la vérification.
  const site = await resolveHost(host, env, deps);
  if (site.state === 'error') return new Response('Service momentanément indisponible.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30', ...SECURITY } });
  if (site.state !== 'ok') return notFound();
  if (path === '/sw.js' || path === '/manifest.webmanifest' || path === '/config.js.map') return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (path === '/' || path === '/index.html') {
    return new Response(siteIndex(await indexHtml(env, req), site), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Host', ...SECURITY } });
  }
  return env.ASSETS.fetch(req);   // fichiers identiques pour tous (app.js, styles, polices, images)
}

export default { fetch: (req, env, ctx) => handle(req, env) };
