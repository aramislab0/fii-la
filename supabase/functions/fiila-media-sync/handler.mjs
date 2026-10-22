// Fii — copie des photos publiques (articles, couvertures de vitrine) de la base vers le seau Supabase Storage « media ».
// Appelée toutes les minutes par la base (pg_cron) et depuis le back-office (« Copier maintenant »). Sans vérification JWT :
// elle ne fait que vider une file d'attente idempotente (rien n'est lu ni renvoyé hors des compteurs).
// Chaque photo est déposée à une adresse qui contient l'empreinte de son contenu (mise en cache d'un an sans risque),
// puis l'adresse est enregistrée par fiila_media_done, seulement si la photo n'a pas changé entre-temps.
// Les photos du seau qui ne servent plus (article supprimé, photo remplacée) sont retirées.
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase. Module sans dépendance (testé sous Node).

export const BUCKET = 'media';
export const BATCH = 8;
export const ext = (ctype) => (ctype === 'image/png' ? 'png' : ctype === 'image/webp' ? 'webp' : 'jpg');
export function pathFor(item) {
  const [id, pos] = String(item.ref).split(':');
  const e = ext(item.ctype);
  if (item.kind === 'cover') return `c/${id}-${item.hash}.${e}`;
  if (item.kind === 'product_extra') return `p/${id}-${pos}-${item.hash}.${e}`;
  return `p/${id}-${item.hash}.${e}`;
}
export function decode(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function makeHandler({ env, fetch }) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  const base = () => String(env('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = () => env('SUPABASE_SERVICE_ROLE_KEY');
  const auth = () => ({ apikey: key(), Authorization: 'Bearer ' + key() });
  async function rpc(fn, args) {
    const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(args || {}) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error((body && body.message) || 'rpc ' + r.status);
    return body;
  }
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    if (!key() || !base()) return json(500, { error: 'not_configured' });
    let copied = 0, failed = 0, removed = 0;
    try {
      const items = await rpc('fiila_media_pending', { p_limit: BATCH });
      for (const it of items || []) {
        const path = pathFor(it);
        try {
          const bytes = decode(it.b64);
          const up = await fetch(`${base()}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST',
            headers: { ...auth(), 'Content-Type': it.ctype || 'image/jpeg', 'cache-control': 'max-age=31536000', 'x-upsert': 'true' }, body: bytes });
          if (!up.ok) throw new Error('stockage ' + up.status + ' ' + String(await up.text().catch(() => '')).slice(0, 120));
          await rpc('fiila_media_done', { p_kind: it.kind, p_ref: it.ref, p_hash: it.hash, p_path: path, p_bytes: bytes.length });
          copied++;
        } catch (e) {
          failed++;
          await rpc('fiila_media_report', { p_action: 'failed', p_ref: it.kind + ':' + it.ref, p_detail: String((e && e.message) || e) }).catch(() => {});
        }
      }
      const orphans = await rpc('fiila_media_orphans', { p_limit: 50 });
      if (orphans && orphans.length) {
        const del = await fetch(`${base()}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: orphans }) });
        if (del.ok) removed = (await rpc('fiila_media_forget', { p_paths: orphans })).removed || 0;
        else await rpc('fiila_media_report', { p_action: 'failed', p_ref: 'nettoyage', p_detail: 'suppression refusée ' + del.status }).catch(() => {});
      }
      const did = copied || failed || removed;
      await rpc('fiila_media_report', { p_action: 'run', p_ref: null, p_detail: did ? `${copied} copiée(s), ${failed} échec(s), ${removed} retirée(s)` : null });
      return json(200, { ok: true, copied, failed, removed });
    } catch (e) {
      console.log(JSON.stringify({ media_sync: 'failed', error: String((e && e.message) || e).slice(0, 200) }));
      return json(502, { error: 'failed', copied, failed, removed });
    }
  };
}
