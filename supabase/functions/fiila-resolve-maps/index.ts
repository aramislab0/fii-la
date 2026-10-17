// Fii La — lit un lien court Google Maps (maps.app.goo.gl) et renvoie le point qu'il désigne.
// Le navigateur ne peut pas suivre ce lien lui-même (redirections vers un autre domaine).
// Sécurité : seuls les liens courts Google Maps sont acceptés, et seules les redirections vers Google
// sont suivies. Rien n'est enregistré. Aucune clé privilégiée.
import { extractFromUrl, extractFromHtml, isShortMapsUrl, isGoogleHost } from './extract.mjs';

// Origines autorisées : le site public et le développement local (audit S8 : pas de relais ouvert à tous).
const ORIGINS = ['https://aramislab0.github.io', 'http://localhost', 'http://127.0.0.1'];
const originOk = (o: string | null) => !!o && ORIGINS.some((a) => o === a || o.startsWith(a + ':') || o.startsWith(a + '/'));
// Limite simple par adresse IP et par instance : 30 lectures par minute.
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 30;
}
const CORS = {
  'Access-Control-Allow-Origin': 'https://aramislab0.github.io',
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, accept, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = { ...CORS, 'Access-Control-Allow-Origin': originOk(origin) ? (origin as string) : CORS['Access-Control-Allow-Origin'] };
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!originOk(origin)) return json({ error: 'origin' }, 403);
  const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',').pop()!.trim() || 'unknown';
  if (limited(ip)) return json({ error: 'rate_limited' }, 429);
  let input = '';
  try { const b = await req.json(); input = String(b?.url ?? '').trim().slice(0, 600); } catch { return json({ error: 'invalid' }, 400); }

  const direct = extractFromUrl(input);
  if (direct) return json(direct);

  let current: URL;
  try { current = new URL(input); } catch { return json({ error: 'invalid' }, 400); }
  if (!isShortMapsUrl(current)) return json({ error: 'unsupported' }, 400);

  try {
    for (let hop = 0; hop < 4; hop++) {
      const r = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+' },
        signal: AbortSignal.timeout(6000),
      });
      const loc = r.headers.get('location');
      if (loc) {
        await r.body?.cancel();
        const c = extractFromUrl(loc);
        if (c) return json(c);
        let next: URL;
        try { next = new URL(loc, current); } catch { break; }
        // Page de consentement : l'adresse réelle est dans « continue ».
        const cont = next.hostname === 'consent.google.com' ? next.searchParams.get('continue') : null;
        if (cont) { const c2 = extractFromUrl(cont); if (c2) return json(c2); try { next = new URL(cont); } catch { break; } }
        if (!isGoogleHost(next)) break;
        current = next;
        continue;
      }
      if (r.ok) {
        const c = extractFromHtml(await r.text());
        if (c) return json(c);
      } else {
        await r.body?.cancel();
      }
      break;
    }
  } catch {
    return json({ error: 'upstream' }, 502);
  }
  return json({ error: 'not_found' }, 422);
});
