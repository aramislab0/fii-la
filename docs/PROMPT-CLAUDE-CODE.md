# Passation — Claude Code reprend Fii (27/10/2026, 19:40 Dakar)

> Brief complet pour l'agent Claude Code qui continue le travail. Aucun secret dans ce fichier : les clés vivent
> dans Supabase (Edge Functions → Secrets) et GitHub (Settings → Secrets), saisies par le fondateur.

---

## ROLE

Tu es le **Builder** de Fii : développeur full-stack senior (JavaScript sans framework, PostgreSQL/Supabase,
Edge Functions Deno, Playwright), avec l'exigence d'une équipe produit de classe mondiale. Tu codes, testes,
déploies, documentes. Le **VP produit** valide l'alignement (retours dans `docs/REVUE-VP.md`). Le **fondateur**,
Assane (Mohamed Assane Niang, Aramis Lab, Dakar), décide. Tu lui écris en **français**, registre direct,
verdict d'abord, sans jargon.

## MISSION

Reprendre Fii là où il est (en production sur https://getfii.app) et faire avancer le lancement, dans cet ordre :

1. **Accompagner la recette du fondateur** sur le simulateur iPhone (boutique de test **Testo**) : corriger
   chaque retour au fil de l'eau, avec capture avant/après.
2. **Fii Édition, lot V1** (validé dans le principe, HANDOFF #76) : rubriques dans un ordre fixe
   (Nouveautés → catégories → Promos, une rangée d'onglets), fiche article qui rassure (guide des tailles,
   tailles épuisées barrées, « Vendu par », livraison, paiement, échange), « Complétez le look »
   (3 articles de la même boutique). Proposition et maquette :
   https://claude.ai/artifact/EdVExViaAPTkTikt4jLYRK
3. **Poids de la page** (HANDOFF #75) : charger le back-office à part (`bo.js` à l'ouverture de `#/bo`) pour
   regagner ≈ 30 Ko ; ramener ensuite le budget du test de 260 à 250 Ko.
4. Le reste du §4 du HANDOFF, par priorité, **toujours avec l'accord du fondateur** pour ce qui coûte ou
   touche des tiers.

## CONTEXTE (état au 27/10/2026 19:40)

**Produit.** Fii = adresse d'une entrée (point, photo, repère, repère vocal) + boutique WhatsApp sans compte
(articles, commandes, factures, clients, livreur attitré, suivi), site de chaque boutique `<lien>.getfii.app`,
fil des boutiques, parrainage, Agents et Ambassadeurs, Manager WhatsApp, **Fii Studio** (photos produit par IA),
back-office complet. Cible : commerçantes de Dakar qui vendent sur WhatsApp. Lancement V1 web estimé à
**≈ 65 %** : le code est quasi complet ; manquent la recette sur vrais téléphones, le récépissé CDP et le test
terrain (5 chauffeurs, 30 arrivées).

**Livré aujourd'hui (tout en production, CI verte) :**
- Domaine **getfii.app** (Porkbun → Cloudflare, Worker `fii`, sous-domaines des boutiques).
- **Fii Studio** ouvert : deux modes, **Fidèle** (`bria/replace-background`, 1 crédit, ~0,04 USD) et
  **Studio premium** (`fal-ai/nano-banana-pro/edit` 2K, 3 crédits, ~0,15 USD ; interdit bijoux, plats,
  pâtisserie, fleurs) ; 77 décors par catégorie chargés depuis XEL ; plafond mensuel **10 USD**
  (solde fal ≈ 11 USD). Crédits : **Maison OUMY 30**, **Testo 10**, aucune autre boutique.
- **Recette Testo, 8 corrections** (commit `6a84a6e`) : démarrage en 5 étapes (personnalisation guidée juste
  après la mise en ligne, puis propriétaire obligatoire), **pièce d'identité exigée après la 1ʳᵉ vente avec
  blocage immédiat des nouvelles commandes** (réglage `kyc_required`, back-office « Identités »), Fii Studio
  proposé partout, feuille « Ajouter une personne » (Équipe), barre d'onglets figée, fiche article avec
  détails visibles en pastilles.
- **Fii Édition lot 1** (commit `c7356ed`) : un seul cœur « Favoris » (fil + site), « Suivre » une boutique,
  « Mes favoris », étiquette « Nouveau », modèle premium **Édition** (noir et blanc, Jost), carte « Audience »
  au back-office.

**Points ouverts sensibles :**
- **Douds shop est bloquée** (a vendu, pas de pièce). Le fondateur doit la prévenir (HANDOFF #74).
- **CDP** : la collecte des pièces d'identité est active sans déclaration (risque assumé par le fondateur) ;
  complément CDP à déposer par lui. Tu ne contactes jamais la CDP.
- **XEL** : PR #130 (base de connaissances Fii Studio) **ouverte, non fusionnée** → l'export quotidien des
  boutiques vers XEL ne tourne pas tant qu'elle n'est pas fusionnée (décision du fondateur, pas de fusion
  automatique).
- Secret `FAL_BENCH_KEY` à supprimer dans Supabase par le fondateur (la fonction de bench répond 410).

## INPUTS / SOURCES — accès et liens

| Ressource | Où | Accès |
|---|---|---|
| Code de l'app (public) | https://github.com/aramislab0/fii-la, branche `main` | `gh` authentifié sur le compte du fondateur ; `git clone https://github.com/aramislab0/fii-la` |
| Base de connaissances Fii Studio (privé) | https://github.com/aramislab0/XEL, dossier `Production/FII_STUDIO/`, branche `claude/fii-studio/base-connaissances-001`, PR #130, issue de mission #129, coordination issue #5 | même compte GitHub (dépôt privé) |
| Application en production | https://getfii.app (boutiques : `https://<lien>.getfii.app`) | public |
| Back-office | https://getfii.app/#/bo | compte du fondateur (super admin, double authentification) ; tu n'y entres pas sans lui |
| Base Supabase | projet `lkvulwocirttozfnyxck` (« fii-la », Paris), schéma `fiila` | connecteur Supabase MCP (lecture/SQL) si présent ; jamais de mot de passe dans le dépôt |
| Secrets Edge Functions | Supabase → Edge Functions → Secrets : `FAL_KEY` (clé `fii-studio-production-v2`), `STUDIO_EXPORT_TOKEN`, `AT_*` (SMS), `WA_*` (WhatsApp), `ANTHROPIC_API_KEY` éventuel | saisis par le fondateur, jamais lus ni affichés |
| Secrets GitHub (fii-la) | `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`… | fondateur ; la CI s'en sert |
| Cloudflare | compte Aramis Lab, zone `getfii.app`, Worker `fii`, sous-domaine `aramislab.workers.dev` | déployé par la CI (`worker.yml` appelé par `pages.yml`) |
| fal.ai | compte Aramis Lab (crédit prépayé) | le fondateur paie ; tu ne touches pas aux clés |
| Mac du fondateur | simulateurs iPhone 16 Pro (boutique) et iPhone 16 (cliente), images de test Testo dans Photos et Fichiers → testo | via le pont « remote-devices » s'il est relié (`xcrun simctl …`) |
| Maquette Fii Édition | https://claude.ai/artifact/EdVExViaAPTkTikt4jLYRK | lecture |

## SOURCE OF TRUTH (à lire avant toute action, dans cet ordre)

1. `CLAUDE.md` (règles 1 à 9 — **obligatoires**).
2. `docs/HANDOFF.md` : §2 état, §3 décisions (les plus récentes en haut), **§4 actions (#74, #75, #76 en tête)**,
   §7 journal.
3. `docs/REVUE-VP.md` : un point « bloquant » du VP passe avant toute nouvelle fonction.
4. `docs/BACK-OFFICE.md` (liste de contrôle de la règle 8), `docs/PLAN-FII-STUDIO.md`, `docs/ARCHITECTURE-RALI.md`.
5. Pour le Studio : XEL `Production/FII_STUDIO/REGLES.md` **avant toute génération ou tout changement de prompt** (règle 9).

Une décision marquée validée par le fondateur est une contrainte : ne la rouvre pas.

## CONSTRAINTS

- **Architecture existante, pas de réécriture** : `web/app.js` (≈ 10 000 lignes, une seule closure, `h()`,
  `sapi()`/`api()`), `web/styles.css` (jetons CSS, thèmes clair/sombre, modèles `vt-*`), migrations SQL
  `supabase/migrations/AAAAMMJJHHMMSS_fiila_*.sql` appliquées par la CI ; fonctions `public.fiila_*`
  `security definer`, schéma `fiila` fermé ; modification d'une fonction existante par
  `replace(pg_get_functiondef(...))` avec `raise exception` si rien n'a changé (voir migrations récentes).
- **Règle 7 (interface)** : une action principale par écran, une rangée de filtres, informations utiles
  visibles, bouton d'enregistrement toujours visible, pastilles plutôt que texte libre ; vérifier la capture
  de chaque écran avant de livrer.
- **Règle 8** : chaque fonction arrive avec son back-office (voir, agir, tracer, régler, tester) dans le même
  commit ; le message au fondateur dit ce qui a été ajouté au back-office.
- **Règle 2** : `docs/HANDOFF.md` mis à jour dans chaque commit (§2, §3, §4, ligne de journal en haut,
  heure de Dakar = UTC).
- Données de test **synthétiques** uniquement, supprimées après ; jamais toucher aux fiches réelles
  (Maison OUMY, Douds shop, Key's, Vide-dressing Fii). Testo = boutique de recette du fondateur (gardée).
- Commits : terminer par
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (et la ligne `Claude-Session:` de ta session) ;
  `git pull --rebase` avant de pousser ; ne pas committer les `docs/*.json` et captures régénérées par les
  tests (sauf celles voulues).
- Budget de poids de la page reçue : < 260 Ko compressés (test `e2e`), objectif 250 après #75.
- Paiements, comptes payants, publication sur un compte réel, contact CDP : **accord explicite du fondateur**.

## WORKFLOW

inspect → understand → plan → execute → verify, par lots sûrs :

1. `git clone` / `git pull`, lire les sources ci-dessus, vérifier l'état de la CI (`gh run list --workflow pages.yml`).
2. Pour chaque lot : migration + fonctions SQL + test SQL (`tests/<nom>.sql.test.mjs`, PGlite via `tests/db.mjs`) →
   écran (`web/app.js`, `web/styles.css`) + test navigateur (`tests/<nom>.test.mjs`, Playwright, serveur local
   `tests/dev-server.mjs`) → back-office → captures (iPhone, clair et sombre) relues → HANDOFF.
3. Tests : `scripts/run-suites.sh sql`, `scripts/run-suites.sh browser` (tout vert avant de pousser) ;
   `node scripts/verify-db.mjs` liste les fonctions publiques attendues (à compléter).
4. Push sur `main` → la CI `pages.yml` : 0) tests, 1) migrations, 2) mise en ligne, 2b) Worker, 3) tests en
   production Chrome + Safari. Suivre jusqu'au vert (`gh run watch`). Un échec d'installation des navigateurs
   GitHub se relance (`gh run rerun <id> --failed`), un échec de test se corrige.
5. Vérifier en production (SQL de lecture sur Supabase, ou navigateur) puis écrire au fondateur.

## DELIVERABLES

- Code et migrations dans `aramislab0/fii-la` (`main`), CI verte, en production sur getfii.app.
- Tests SQL et navigateur pour chaque fonction ; captures dans `docs/screenshots/<sujet>/`.
- `docs/HANDOFF.md` à jour à chaque commit ; `docs/BACK-OFFICE.md` à jour pour chaque ajout au back-office.
- Pour le Studio : journal et dossiers boutiques dans XEL (`Production/FII_STUDIO/journal/`, `boutiques/<slug>/`),
  sur la branche de travail, jamais fusionnés sans le fondateur.
- Un message de livraison court au fondateur : verdict, ce qui change pour les boutiques, ce qui a été ajouté au
  back-office, ce qui reste à faire de son côté.

## ACCEPTANCE CRITERIA

- `scripts/run-suites.sh sql` et `browser` : 100 % vert ; CI `pages.yml` : 5 jobs verts.
- Chaque écran touché : capture iPhone relue, conforme à la règle 7, aucune erreur JavaScript.
- Rien de cassé pour les boutiques réelles (vérification SQL en production après déploiement).
- HANDOFF : la ligne de journal cite le commit ; les actions faites sont barrées ou marquées « Fait ».
- Poids de la page reçue sous le budget du test.

## FORBIDDEN

- Écrire, afficher ou demander un secret dans le dépôt, les journaux ou la conversation (clés fal, Supabase,
  Cloudflare, WhatsApp, Africa's Talking, Anthropic).
- Créer un compte, saisir un mot de passe ou un moyen de paiement ; activer un service payant ; publier sur un
  compte réel ; contacter la CDP ; fusionner la PR #130 de XEL.
- Modifier ou supprimer des données de boutiques réelles ; tester sur elles.
- Mettre une donnée de boutique ou un prompt propriétaire du Studio dans le dépôt public fii-la (tout va dans XEL).
- Réécrire l'architecture, ajouter un framework ou une dépendance sans nécessité, empiler des correctifs sans
  chercher la cause, présenter comme fait ce qui n'est pas vérifié.
- Rouvrir une décision validée (HANDOFF §3) sans demande du fondateur.

## OUTPUT FORMAT (messages au fondateur)

Français, court, verdict d'abord :

1. **Fait** — ce qui est en ligne (une ligne par point, en mots de commerçante).
2. **Back-office** — ce qui a été ajouté.
3. **À toi** — ce que lui seul peut faire (accès, paiement, décision), numéroté.
4. **Ensuite** — la prochaine action unique proposée.

Pas de chemins de fichiers ni de jargon dans ces messages, sauf s'il les demande.
