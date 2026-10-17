// Vérifie les contrastes WCAG 2.2 des tokens Fii La dans les deux thèmes.
// Usage : node docs/design-system/check-contrast.mjs   (code de sortie 1 si un couple échoue)
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

let fail = 0;
console.log('couple'.padEnd(28), 'light'.padStart(7), 'dark'.padStart(7), ' seuil');
for (const [fg, bgk, min] of spec.contrastPairs) {
  const row = ['light', 'dark'].map((t) => ratio(spec.color[fg][t], spec.color[bgk][t]));
  const ok = row.every((v) => v >= min);
  if (!ok) fail++;
  console.log(`${fg} / ${bgk}`.padEnd(28), ...row.map((v) => v.toFixed(2).padStart(7)), ` ${min}:1 ${ok ? 'OK' : 'ÉCHEC'}`);
}
console.log(fail ? `\n${fail} couple(s) en échec` : '\nTous les couples atteignent le seuil AA.');
process.exit(fail ? 1 : 0);
