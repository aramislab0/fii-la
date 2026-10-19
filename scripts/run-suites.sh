#!/usr/bin/env bash
# Lance des suites de tests et échoue si l'une échoue. Sur GitHub, chaque test en échec devient une annotation lisible
# dans l'onglet Actions (::error::), avec le nom de la suite et la raison.
# Usage : scripts/run-suites.sh sql            → toutes les suites SQL
#         scripts/run-suites.sh browser        → toutes les suites navigateur (sauf deployed)
#         scripts/run-suites.sh list a b c     → tests/a.test.mjs, tests/b.test.mjs… (ENGINE=webkit possible)
set -uo pipefail
mode=${1:-}; shift || true
case "$mode" in
  sql) files=(tests/sql.test.mjs tests/*.sql.test.mjs) ;;
  browser) files=(); for f in tests/*.test.mjs; do case "$f" in *.sql.test.mjs|*/sql.test.mjs|*/deployed.test.mjs) ;; *) files+=("$f") ;; esac; done ;;
  list) files=(); for s in "$@"; do files+=("tests/$s.test.mjs"); done ;;
  *) echo "usage: $0 sql|browser|list <suites…>"; exit 2 ;;
esac
fail=0
for f in "${files[@]}"; do
  out=$(node "$f" 2>&1); code=$?
  echo "$out" | tail -1
  if [ $code -ne 0 ]; then
    fail=1
    echo "$out" | grep -E '^(FAIL|    )' | head -12 | while IFS= read -r l; do
      if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error title=$(basename "$f")${ENGINE:+ ($ENGINE)}::$l"; else echo "  $l"; fi
    done
  fi
done
exit $fail
