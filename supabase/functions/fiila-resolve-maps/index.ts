// Fii La — lit un lien court Google Maps (maps.app.goo.gl) et renvoie le point qu'il désigne.
// Le navigateur ne peut pas suivre ce lien lui-même (redirections vers un autre domaine).
// Sécurité : seuls les liens courts Google Maps sont acceptés, et seules les redirections vers Google
// sont suivies. Rien n'est enregistré. Aucune clé privilégiée.
import { extractFromUrl, extractFromHtml, isShortMapsUrl, isGoogleHost } from './extract.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, accept, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
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
