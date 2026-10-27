// Petit tokeniseur JS (commentaires, chaînes, gabarits, expressions régulières) : identifiants avec leur contexte.
export function tokens(src) {
  const out = []; let i = 0, prev = null; const n = src.length;
  const isId = (c) => /[A-Za-z0-9_$À-￿]/.test(c);
  const regexOk = () => !prev || (prev.t === 'p' && /^[(,=:[!&|?{};+\-*%<>~^]$|^=>$|^\)$/.test(prev.v) && prev.v !== ')') || (prev.t === 'id' && /^(return|typeof|case|do|else|in|of|new|delete|void|throw)$/.test(prev.v));
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; } continue; }
    if (c === "'" || c === '"') { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; prev = { t: 's' }; out.push(prev); continue; }
    if (c === '`') { i++; while (i < n && src[i] !== '`') { if (src[i] === '\\') i++; i++; } i++; prev = { t: 's' }; out.push(prev); continue; }
    if (c === '/' && regexOk()) { i++; let cls = false; while (i < n) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; i++; } i++; while (i < n && /[a-z]/.test(src[i])) i++; prev = { t: 'r' }; out.push(prev); continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && isId(src[j])) j++; prev = { t: 'id', v: src.slice(i, j), at: i }; out.push(prev); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9a-fA-FxX._e]/.test(src[j])) j++; prev = { t: 'n' }; out.push(prev); i = j; continue; }
    if (c === '=' && src[i + 1] === '>') { prev = { t: 'p', v: '=>' }; out.push(prev); i += 2; continue; }
    prev = { t: 'p', v: c }; out.push(prev); i++;
  }
  return out;
}
// Identifiants utilisés comme variables (ni propriété « a.x », ni clé d'objet « x: »).
export function refs(src) {
  const t = tokens(src), s = new Set();
  for (let k = 0; k < t.length; k++) {
    const x = t[k]; if (x.t !== 'id') continue;
    const before = t[k - 1], after = t[k + 1];
    if (before && before.t === 'p' && before.v === '.') continue;
    if (after && after.t === 'p' && after.v === ':' && before && before.t === 'p' && (before.v === '{' || before.v === ',')) continue;
    s.add(x.v);
  }
  return s;
}
