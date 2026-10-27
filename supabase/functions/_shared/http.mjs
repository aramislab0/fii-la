// Fii — outils HTTP communs aux fonctions Edge appelées par le navigateur (audit du 27/10) :
//   - CORS limité aux origines de Fii (plus de « * ») : getfii.app et ses sous-domaines, l'ancienne adresse GitHub Pages,
//     l'application mobile (Capacitor) et le développement local (tests). Une origine inconnue ne reçoit aucun en-tête
//     Access-Control-Allow-Origin : le navigateur bloque la lecture ; les appels de serveur à serveur (sans Origin) passent.
//   - lecture bornée du corps : refus avant lecture si Content-Length dépasse la limite, puis lecture arrêtée à la limite.
// Module sans dépendance (testé sous Node, déployé sous Deno avec chaque fonction qui l'importe).

export const MB = 1024 * 1024;
const EXACT = new Set(['https://getfii.app', 'https://aramislab0.github.io', 'capacitor://localhost', 'https://localhost']);
const SUB = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.getfii\.app$/;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export const originOk = (o) => !!o && (EXACT.has(o) || SUB.test(o) || LOCAL.test(o));

// En-têtes CORS pour la requête : l'origine n'est renvoyée que si elle est autorisée.
export function corsFor(req, methods = 'POST, OPTIONS') {
  const o = req.headers.get('origin');
  const h = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': methods, 'Vary': 'Origin' };
  if (originOk(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}

// Corps de la requête en texte, ou null s'il dépasse max octets (la lecture s'arrête dès le dépassement).
export async function readText(req, max) {
  const len = Number(req.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => { /* flux déjà fermé : rien à libérer */ }); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}
