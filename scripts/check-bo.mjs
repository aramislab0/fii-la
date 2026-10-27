// Contrôle du back-office chargé à part (HANDOFF #75) : bo.js ne voit pas la closure de app.js. Tout nom déclaré au
// premier niveau de app.js et utilisé dans bo.js doit lui être passé (boShared dans app.js, « var … = F.… » dans bo.js).
// Usage : node scripts/check-bo.mjs   (code de sortie 1 si un nom manque).
import { readFileSync } from 'node:fs';
import { tokens, refs } from './js-tokens.mjs';

export function topDecls(text) {
  const out = new Set();
  for (const l of text.split('\n')) { const m = /^  function ([A-Za-z_$][\w$]*)/.exec(l); if (m) out.add(m[1]); }
  let pos = 0;
  for (const l of text.split('\n')) {
    if (/^  var /.test(l)) {
      const tk = tokens(text.slice(pos + 2, pos + 20000)); let depth = 0, expect = true;
      for (let k = 1; k < tk.length; k++) { const x = tk[k];
        if (x.t === 'p' && '([{'.includes(x.v)) depth++; else if (x.t === 'p' && ')]}'.includes(x.v)) depth--;
        if (depth < 0 || (depth === 0 && x.t === 'p' && x.v === ';')) break;
        if (depth === 0 && expect && x.t === 'id') { out.add(x.v); expect = false; } else if (depth === 0 && x.t === 'p' && x.v === ',') expect = true; }
    }
    pos += l.length + 1;
  }
  return out;
}
export function checkBo(root = new URL('../web/', import.meta.url)) {
  const app = readFileSync(new URL('app.js', root), 'utf8'), bo = readFileSync(new URL('bo.js', root), 'utf8');
  const given = new Set((/^  var (.*) = F\.[^;]*;$/m.exec(bo) || [, ''])[1] ? [...bo.matchAll(/([A-Za-z_$][\w$]*) = F\.\1\b/g)].map((m) => m[1]) : []);
  const shared = new Set([...(/function boShared\(\) \{\s*return \{([^}]*)\}/.exec(app) || [, ''])[1].matchAll(/([A-Za-z_$][\w$]*): \1\b/g)].map((m) => m[1]));
  const appD = topDecls(app), boD = topDecls(bo), used = refs(bo);
  const missing = [...appD].filter((n) => used.has(n) && !boD.has(n) && !given.has(n)).sort();
  const notShared = [...given].filter((n) => !shared.has(n)).sort();
  const notDeclared = [...given].filter((n) => !appD.has(n)).sort();
  return { missing, notShared, notDeclared, given: given.size };
}
if (process.argv[1] && process.argv[1].endsWith('check-bo.mjs')) {
  const r = checkBo(); console.log(JSON.stringify(r));
  process.exit(r.missing.length || r.notShared.length || r.notDeclared.length ? 1 : 0);
}
