// Fii Studio — export quotidien vers la base privée Aramis Studio (dépôt XEL). Appelée par le flux planifié du dépôt XEL avec
// l'en-tête « x-export-token » ; le jeton (STUDIO_EXPORT_TOKEN) est saisi par le fondateur dans Supabase et dans XEL, jamais
// dans un dépôt. Renvoie le résumé de fiila_studio_export (clé de service) : aucune donnée de client final.
export function makeHandler({ env, fetch }) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const same = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
  return async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const token = env('STUDIO_EXPORT_TOKEN');
    if (!token || token.length < 32) return json(503, { error: 'not_configured' });
    if (!same(req.headers.get('x-export-token') || '', token)) return json(401, { error: 'unauthorized' });
    let days = 3650;
    try { const b = await req.json(); if (b && Number.isInteger(b.days)) days = b.days; } catch { /* corps vide : tout l'historique */ }
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    const r = await fetch(`${String(env('SUPABASE_URL') || '').replace(/\/$/, '')}/rest/v1/rpc/fiila_studio_export`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key }, body: JSON.stringify({ p_days: days }) });
    if (!r.ok) return json(502, { error: 'export_failed' });
    return json(200, await r.json());
  };
}
