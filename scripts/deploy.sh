#!/usr/bin/env bash
# Fii La — déploiement complet en une commande, à lancer sur le Mac (Supabase CLI et gh connectés).
#
#   cd ~/Projects/fii-la && git pull && ./scripts/deploy.sh
#
# Étapes : projet Supabase (création ou réutilisation) → migrations → vérification des droits
# → variables GitHub (URL + clé publique uniquement) → déploiement GitHub Pages → tests en production
# (parcours complet Chromium + WebKit, suite complète Chromium) → rapport dans docs/.
#
# Secrets : le mot de passe de la base reste dans ~/Projects/fii-la-ops/.env.ops (droits 600).
# Il n'est jamais affiché, jamais envoyé à GitHub, jamais écrit dans le dépôt.
# Aucune clé privilégiée (service_role / secret) n'est utilisée.
#
# Options : FIILA_PROJECT_REF=<ref> pour réutiliser un projet existant ; FIILA_ORG_ID=<id> pour une autre organisation.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OPS="$HOME/Projects/fii-la-ops"; mkdir -p "$OPS"; chmod 700 "$OPS"
ENVF="$OPS/.env.ops"; touch "$ENVF"; chmod 600 "$ENVF"
REPO="aramislab0/fii-la"
ORG_ID="${FIILA_ORG_ID:-twnwhtbjkydbsoubrmso}"
REGION="eu-west-3"
PUBLIC_URL="https://aramislab0.github.io/fii-la/"
log() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit "${2:-1}"; }
jsonpick() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=($1)(JSON.parse(s));process.stdout.write(v==null?'':String(v))}catch(e){process.exit(3)}})"; }

for c in supabase gh node npm openssl curl; do command -v "$c" >/dev/null || die "Outil manquant : $c"; done
gh auth status >/dev/null 2>&1 || die "GitHub CLI non connecté : lancez « gh auth login »."
supabase projects list >/dev/null 2>&1 || die "Supabase CLI non connecté : lancez « supabase login »."

grep -q '^SUPABASE_DB_PASSWORD=' "$ENVF" || printf 'SUPABASE_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "$ENVF"
set -a; . "$ENVF"; set +a

# ------------------------------------------------------------------ 1. projet Supabase
REF="${FIILA_PROJECT_REF:-${FIILA_REF:-}}"
if [ -z "$REF" ]; then
  REF=$(supabase projects list -o json 2>/dev/null | jsonpick 'a=>{const p=(Array.isArray(a)?a:[]).find(x=>x.name==="fii-la");return p&&(p.ref||p.id)}' || true)
fi
if [ -z "$REF" ]; then
  log "Création du projet Supabase « fii-la » (région $REGION)"
  if ! OUT=$(supabase projects create fii-la --org-id "$ORG_ID" --db-password "$SUPABASE_DB_PASSWORD" --region "$REGION" -o json 2>&1); then
    if echo "$OUT" | grep -qi "overdue invoice"; then
      die "Supabase refuse : facture en retard sur l'organisation. Réglez-la dans le tableau de bord (Organization → Billing → Invoices), puis relancez." 2
    elif echo "$OUT" | grep -qiE "maximum|limit|free project"; then
      die "Supabase refuse : limite de 2 projets gratuits actifs atteinte. Mettez en pause un projet inutilisé (gratuit) ou passez l'organisation en Pro (25 \$/mois), puis relancez." 3
    fi
    echo "$OUT" | grep -v -i password >&2; die "Création du projet impossible (message ci-dessus)."
  fi
  REF=$(echo "$OUT" | jsonpick 'p=>p.ref||p.id' 2>/dev/null || true)
  [ -n "$REF" ] || REF=$(supabase projects list -o json 2>/dev/null | jsonpick 'a=>{const p=a.find(x=>x.name==="fii-la");return p&&(p.ref||p.id)}' || true)
  [ -n "$REF" ] || die "Projet créé mais référence introuvable : relancez avec FIILA_PROJECT_REF=<ref>."
fi
grep -q "^FIILA_REF=$REF$" "$ENVF" || { sed -i '' '/^FIILA_REF=/d' "$ENVF" 2>/dev/null || true; echo "FIILA_REF=$REF" >> "$ENVF"; }
echo "Projet : $REF"

log "Attente de la disponibilité du projet"
for i in $(seq 1 60); do
  ST=$(supabase projects list -o json 2>/dev/null | jsonpick "a=>{const p=a.find(x=>(x.ref||x.id)==='$REF');return p&&p.status}" || true)
  [ "$ST" = "ACTIVE_HEALTHY" ] && break
  [ "$ST" = "INACTIVE" ] && die "Le projet $REF est en pause : relancez-le depuis le tableau de bord Supabase."
  printf '.'; sleep 10
done
[ "$ST" = "ACTIVE_HEALTHY" ] || die "Projet pas prêt après 10 minutes (état : ${ST:-inconnu})."

# ------------------------------------------------------------------ 2. migrations
log "Liaison et migrations"
supabase link --project-ref "$REF" -p "$SUPABASE_DB_PASSWORD" >/dev/null
printf 'y\n' | supabase db push -p "$SUPABASE_DB_PASSWORD"
supabase migration list -p "$SUPABASE_DB_PASSWORD" 2>&1 | grep -vi password | tee "$ROOT/docs/deploy-migrations.txt" || true

POOLER=$(cat supabase/.temp/pooler-url 2>/dev/null || true)
[ -n "$POOLER" ] || die "URL de connexion introuvable (supabase/.temp/pooler-url)."
export DATABASE_URL=$(POOLER="$POOLER" node -e 'const u=new URL(process.env.POOLER);u.password=encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);process.stdout.write(u.toString())')

log "Installation des dépendances de test"
npm install --no-audit --no-fund --silent
npx playwright install chromium webkit >/dev/null

log "Vérification des droits d'accès de la base"
node scripts/verify-db.mjs || die "La base ne respecte pas les droits attendus : déploiement arrêté."

# ------------------------------------------------------------------ 3. configuration publique + Pages
log "Variables GitHub (URL et clé publique uniquement)"
KEY=$(supabase projects api-keys --project-ref "$REF" -o json | jsonpick 'a=>{const k=a.find(x=>x.type==="publishable")||a.find(x=>x.name==="anon");return k&&k.api_key}')
[ -n "$KEY" ] || die "Clé publique introuvable."
case "$KEY" in sb_secret_*) die "Clé secrète détectée : refus de la publier.";; esac
if [[ "$KEY" == eyJ* ]]; then
  ROLE=$(KEY="$KEY" node -e 'process.stdout.write(JSON.parse(Buffer.from(process.env.KEY.split(".")[1],"base64url")).role)')
  [ "$ROLE" = "anon" ] || die "La clé choisie n'est pas la clé anon (rôle : $ROLE)."
fi
gh variable set SUPABASE_URL --repo "$REPO" --body "https://$REF.supabase.co"
gh variable set SUPABASE_PUBLISHABLE_KEY --repo "$REPO" --body "$KEY"
gh variable set PUBLIC_URL --repo "$REPO" --body "$PUBLIC_URL"
unset KEY

log "Déploiement GitHub Pages"
COMMIT=$(git rev-parse HEAD)
gh workflow run pages.yml --repo "$REPO" --ref main
sleep 8
RUN=$(gh run list --repo "$REPO" --workflow pages.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --repo "$REPO" --exit-status >/dev/null || die "Le déploiement Pages a échoué : gh run view $RUN --repo $REPO --log-failed"
for i in $(seq 1 30); do
  curl -fsS "${PUBLIC_URL}config.js?nocache=$RANDOM" | grep -q "$REF" && curl -fsS "${PUBLIC_URL}?nocache=$RANDOM" | grep -q "build $COMMIT" && break
  sleep 10
done
curl -fsS "${PUBLIC_URL}?nocache=$RANDOM" | grep -q "build $COMMIT" || die "Le site ne sert pas encore le commit $COMMIT."
echo "En ligne : $PUBLIC_URL (commit $COMMIT)"

# ------------------------------------------------------------------ 4. tests en production
log "Parcours complet en production — Chromium"
FIILA_URL="$PUBLIC_URL" ENGINE=chromium node tests/deployed.test.mjs | tee "$OPS/journey-chromium.log"; J1=${PIPESTATUS[0]}
log "Parcours complet en production — WebKit"
FIILA_URL="$PUBLIC_URL" ENGINE=webkit node tests/deployed.test.mjs | tee "$OPS/journey-webkit.log"; J2=${PIPESTATUS[0]}
log "Suite complète en production — Chromium"
FIILA_URL="$PUBLIC_URL" ENGINE=chromium node tests/e2e.test.mjs | tee "$OPS/e2e-deploye.log"; J3=${PIPESTATUS[0]}
unset DATABASE_URL

cat > docs/deploy-status.json <<JSON
{ "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "url": "$PUBLIC_URL", "commit": "$COMMIT", "supabase_ref": "$REF", "region": "$REGION",
  "parcours_chromium_ok": $([ $J1 = 0 ] && echo true || echo false), "parcours_webkit_ok": $([ $J2 = 0 ] && echo true || echo false),
  "suite_complete_chromium_ok": $([ $J3 = 0 ] && echo true || echo false) }
JSON
git add docs/deploy-status.json docs/deploy-migrations.txt docs/deploy-db-checks.json docs/journey-deploye-*.json docs/e2e-chromium-deploye.json docs/screenshots/deploye-* 2>/dev/null || true
git -c user.name="Aramis Lab" -c user.email="aramissenegal@gmail.com" commit -q -m "Rapport de déploiement (production)" && git push -q origin main || true

if [ $J1 = 0 ] && [ $J2 = 0 ] && [ $J3 = 0 ]; then log "Tout passe en production : $PUBLIC_URL"; else die "Des tests échouent en production : voir $OPS/*.log" 4; fi
