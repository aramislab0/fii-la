// Fii — copie des photos publiques (articles, couvertures de vitrine) de la base vers le seau Supabase Storage « media ».
// Appelée toutes les minutes par la base (pg_cron) et depuis le back-office (« Copier maintenant »). Déployée sans
// vérification JWT par la passerelle, elle exige elle-même (audit du 27/10) : soit l'en-tête x-sync-token envoyé par pg_cron
// (jeton aléatoire de fiila.settings, vérifié par la base avec fiila_media_sync_auth), soit la session d'un membre de
// l'équipe (fiila_bo_me) ; sinon 401.
// Chaque photo est déposée à une adresse qui contient l'empreinte de son contenu (mise en cache d'un an sans risque),
// puis l'adresse est enregistrée par fiila_media_done, seulement si la photo n'a pas changé entre-temps.
// Les photos du seau qui ne servent plus (article supprimé, photo remplacée) sont retirées.
// Miniatures (28/10) : la photo principale JPEG de chaque article, lue dans le seau, réduite à 640 px (thumb.mjs), déposée sous t/.
// Retrait de la copie de la base (28/10, accord du fondateur) : le fichier publié est téléchargé, son empreinte SHA-256
// comparée à celle de la base ; la copie n'est retirée (fiila_media_purged) que si elles sont identiques.
// Studio (28/10) : copies des résultats (seau privé « studio ») effacées après 7 jours (fiila_studio_purgeable / _forget).
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase. Module sans dépendance (testé sous Node).
import { corsFor } from '../_shared/http.mjs';

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

export const THUMBS = 3;
export const thumbPathFor = (item) => `t/${item.ref}-${item.hash}.jpg`;
export const PURGES = 8;
export async function sha256hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

// thumb (facultatif) : octets JPEG → octets de la miniature (thumb.mjs) ; absent = pas d'étape miniatures.
export function makeHandler({ env, fetch, thumb }) {
  const base = () => String(env('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = () => env('SUPABASE_SERVICE_ROLE_KEY');
  const auth = () => ({ apikey: key(), Authorization: 'Bearer ' + key() });
  // token : session d'une personne (clé publique + son JWT) ; absent = clé de service.
  async function rpc(fn, args, token) {
    const headers = token ? { apikey: env('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + token } : auth();
    const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(args || {}) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error((body && body.message) || 'rpc ' + r.status);
    return body;
  }
  // pg_cron (x-sync-token) ou membre connecté de l'équipe ; toute erreur de vérification vaut refus.
  async function allowed(req) {
    const sync = String(req.headers.get('x-sync-token') || '');
    if (sync) return (await rpc('fiila_media_sync_auth', { p_token: sync }).catch(() => false)) === true;
    const token = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return false;
    const me = await rpc('fiila_bo_me', {}, token).catch(() => null);
    return !!(me && me.staff);
  }
  return async (req) => {
    const cors = corsFor(req);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    if (!key() || !base()) return json(500, { error: 'not_configured' });
    if (!(await allowed(req))) return json(401, { error: 'unauthorized' });
    let copied = 0, failed = 0, removed = 0, thumbs = 0, purged = 0;
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
      // Miniatures, à partir de la photo déjà copiée dans le seau (adresse publique), quelques-unes par passage.
      if (thumb) {
        for (const it of (await rpc('fiila_media_thumbs_pending', { p_limit: THUMBS })) || []) {
          const path = thumbPathFor(it);
          try {
            const src = await fetch(`${base()}/storage/v1/object/public/${BUCKET}/${it.src}`);
            if (!src.ok) throw new Error('lecture ' + src.status);
            const bytes = thumb(new Uint8Array(await src.arrayBuffer()));
            const up = await fetch(`${base()}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST',
              headers: { ...auth(), 'Content-Type': 'image/jpeg', 'cache-control': 'max-age=31536000', 'x-upsert': 'true' }, body: bytes });
            if (!up.ok) throw new Error('stockage ' + up.status);
            await rpc('fiila_media_done', { p_kind: 'thumb', p_ref: it.ref, p_hash: it.hash, p_path: path, p_bytes: bytes.length });
            thumbs++;
          } catch (e) {
            failed++;
            await rpc('fiila_media_report', { p_action: 'failed', p_ref: 'thumb:' + it.ref, p_detail: 'miniature : ' + String((e && e.message) || e) }).catch(() => {});
          }
        }
      }
      // Retrait des copies de la base, après vérification du fichier publié (jamais à l'aveugle).
      for (const it of (await rpc('fiila_media_purge_pending', { p_limit: PURGES })) || []) {
        try {
          const src = await fetch(`${base()}/storage/v1/object/public/${BUCKET}/${it.path}`);
          if (!src.ok) throw new Error('lecture ' + src.status);
          if ((await sha256hex(new Uint8Array(await src.arrayBuffer()))) !== it.sha) throw new Error('fichier du stockage différent de la base');
          if ((await rpc('fiila_media_purged', { p_kind: it.kind, p_ref: it.ref, p_path: it.path, p_sha: it.sha })).purged) purged++;
        } catch (e) {
          failed++;
          await rpc('fiila_media_report', { p_action: 'failed', p_ref: 'purge:' + it.kind + ':' + it.ref, p_detail: 'retrait de la base : ' + String((e && e.message) || e) }).catch(() => {});
        }
      }
      const orphans = await rpc('fiila_media_orphans', { p_limit: 50 });
      if (orphans && orphans.length) {
        const del = await fetch(`${base()}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: orphans }) });
        if (del.ok) removed = (await rpc('fiila_media_forget', { p_paths: orphans })).removed || 0;
        else await rpc('fiila_media_report', { p_action: 'failed', p_ref: 'nettoyage', p_detail: 'suppression refusée ' + del.status }).catch(() => {});
      }
      // Copies des résultats du Studio de plus de 7 jours (seau privé) : effacées, puis oubliées par la base.
      let studio = 0;
      const old = await rpc('fiila_studio_purgeable', { p_limit: 50 }).catch(() => []);
      if (old && old.length) {
        const del = await fetch(`${base()}/storage/v1/object/studio`, { method: 'DELETE', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: old }) });
        if (del.ok) studio = (await rpc('fiila_studio_forget', { p_paths: old })).forgotten || 0;
        else await rpc('fiila_media_report', { p_action: 'failed', p_ref: 'studio', p_detail: 'effacement des copies Studio refusé ' + del.status }).catch(() => {});
      }
      removed += studio;
      const did = copied || failed || removed || thumbs || purged;
      await rpc('fiila_media_report', { p_action: 'run', p_ref: null,
        p_detail: did ? `${copied} copiée(s), ${thumbs} miniature(s), ${purged} retirée(s) de la base, ${failed} échec(s), ${removed} retirée(s) du stockage` : null });
      return json(200, thumb ? { ok: true, copied, thumbs, purged, failed, removed } : { ok: true, copied, purged, failed, removed });
    } catch (e) {
      console.log(JSON.stringify({ media_sync: 'failed', error: String((e && e.message) || e).slice(0, 200) }));
      return json(502, { error: 'failed', copied, failed, removed });
    }
  };
}
