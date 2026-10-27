// Compression du code de l'application à la mise en ligne (fondateur, 21/10/2026 01:07 : « ok » à la recommandation #54).
// app.js et styles.css sont réduits (espaces, commentaires, noms internes) sans rien changer au fonctionnement ;
// le serveur de test sert la même version, pour que les tests et la mesure de poids correspondent à la production.
// Usage : node scripts/minify.mjs web   (remplace les fichiers sur place, dans le dossier de mise en ligne)
import { transformSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function minifyJs(src) { return transformSync(src, { loader: 'js', minify: true, legalComments: 'none', charset: 'utf8' }).code; }
export function minifyCss(src) { return transformSync(src, { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' }).code; }

if (process.argv[1] && process.argv[1].endsWith('minify.mjs')) {
  const dir = process.argv[2] || 'web';
  for (const [f, fn] of [['app.js', minifyJs], ['bo.js', minifyJs], ['styles.css', minifyCss], ['theme.js', minifyJs]]) {
    const p = join(dir, f), before = readFileSync(p, 'utf8'), after = fn(before);
    writeFileSync(p, after);
    console.log(`${f} : ${before.length} → ${after.length} octets`);
  }
}
