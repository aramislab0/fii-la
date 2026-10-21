// Fii — extraction de coordonnées depuis une URL Google Maps (partagé entre la fonction et les tests).
// Aucune donnée n'est conservée : on lit une URL, on renvoie un point.

const PAIR = /(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*\+?\s*(-?\d{1,3}\.\d{3,})/;

function valid(lat, lng) {
  return isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001);
}
function pick(m) {
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  return valid(lat, lng) ? { lat, lng } : null;
}
function decodeAll(s) {
  let out = String(s || '');
  for (let i = 0; i < 3; i++) {
    try { const d = decodeURIComponent(out.replace(/\+/g, ' ')); if (d === out) break; out = d; } catch { break; }
  }
  return out;
}

// Coordonnées dans une URL (après décodage). Ordre : point exact du lieu, paramètres explicites, centre de carte.
export function extractFromUrl(raw) {
  const s = decodeAll(raw);
  return pick(s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)) ||
    pick(s.match(/[?&](?:q|query|ll|daddr|destination|center)=\s*(-?\d{1,2}\.\d+)\s*,\s*\+?\s*(-?\d{1,3}\.\d+)/)) ||
    pick(s.match(/\/(?:search|place|dir\/[^/]*)\/\s*(-?\d{1,2}\.\d+)\s*,\s*\+?\s*(-?\d{1,3}\.\d+)/)) ||
    pick(s.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    pick(s.match(PAIR));
}

// Dans une page HTML : seulement les motifs propres à Google Maps (jamais une paire de nombres quelconque).
export function extractFromHtml(html) {
  const s = String(html || '').slice(0, 400000);
  return pick(s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)) ||
    pick(s.match(/https?:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^"'\s]*@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/)) ||
    pick(s.match(/center=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/));
}

export function isShortMapsUrl(u) {
  return u.protocol === 'https:' && (u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps')));
}
export function isGoogleHost(u) {
  return u.protocol === 'https:' && (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(u.hostname) || u.hostname === 'maps.app.goo.gl' || u.hostname === 'goo.gl');
}
