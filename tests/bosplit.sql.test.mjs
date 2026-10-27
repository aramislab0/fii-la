// Back-office chargé à part (HANDOFF #75, 27/10/2026) : bo.js ne voit pas la closure de app.js. Ce test échoue si bo.js
// utilise un nom de app.js qui ne lui est pas passé (boShared), ou si un nom passé n'existe plus dans app.js.
// Il tourne avec les suites SQL (rapide, sans navigateur). Script équivalent : node scripts/check-bo.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { checkBo } from '../scripts/check-bo.mjs';

let passed = 0;
const results = [];
function t(name, fn) { try { fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }

t('bo.js reçoit tous les noms de app.js qu’il utilise, et seulement des noms qui existent', () => {
  const r = checkBo();
  assert.deepEqual(r.missing, [], 'noms à ajouter à boShared() et à « var … = F.… »');
  assert.deepEqual(r.notShared, []); assert.deepEqual(r.notDeclared, []);
  assert.ok(r.given > 30);
});

t('le contrôle attrape un oubli (bo.js qui utiliserait « shopKey » sans le recevoir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bosplit-'));
  writeFileSync(join(dir, 'app.js'), readFileSync('web/app.js', 'utf8'));
  writeFileSync(join(dir, 'bo.js'), readFileSync('web/bo.js', 'utf8').replace("  return { viewBo: viewBo };", "  function oubli() { return shopKey(); }\n  return { viewBo: viewBo };"));
  const r = checkBo(pathToFileURL(dir + '/'));
  assert.deepEqual(r.missing, ['shopKey']);
});

t('app.js ne contient plus le code du back-office (seulement le chargeur)', () => {
  const app = readFileSync('web/app.js', 'utf8');
  assert.ok(!/function boShops\(/.test(app) && /function loadBo\(/.test(app) && /src: 'bo\.js'/.test(app));
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n  ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests du back-office chargé à part réussis`);
process.exit(passed === results.length ? 0 : 1);
