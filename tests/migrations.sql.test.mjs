// Garde-fou des migrations (audit du 27/10/2026, HANDOFF #78). Depuis 20261028300000, une fonction modifiée est réécrite en
// entier : plus de « pg_get_functiondef(...) + replace(...) », dont un remplacement qui ne trouve pas sa cible passe en
// silence et dont la définition réelle n'existe nulle part dans le dépôt. Les migrations plus anciennes restent telles quelles
// (elles sont déjà appliquées en production). Une nouvelle fonction publique doit aussi fixer ses droits (revoke … from public).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const CUTOFF = '20261028300000';
const dir = 'supabase/migrations';
let passed = 0;
const results = [];
function t(name, fn) { try { fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const recent = readdirSync(dir).filter((f) => f.endsWith('.sql') && f.split('_')[0] >= CUTOFF).sort();

t('aucune migration récente ne réécrit une fonction par remplacement de texte', () => {
  const bad = recent.filter((f) => /pg_get_functiondef/i.test(readFileSync(`${dir}/${f}`, 'utf8')));
  assert.deepEqual(bad, [], 'réécrire la fonction en entier (create or replace function … complète)');
});

t('chaque migration récente qui crée une fonction publique fixe ses droits', () => {
  const bad = recent.filter((f) => { const s = readFileSync(`${dir}/${f}`, 'utf8'); return /create or replace function public\./i.test(s) && !/revoke execute on function/i.test(s); });
  assert.deepEqual(bad, [], 'ajouter revoke … from public, puis grant aux rôles voulus (anon seulement si nécessaire)');
});

t('le garde-fou voit bien les migrations à partir du lot 1 de l’audit', () => {
  assert.ok(recent.includes('20261028300000_fiila_audit_lot1.sql'));
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n  ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests du garde-fou des migrations réussis`);
process.exit(passed === results.length ? 0 : 1);
