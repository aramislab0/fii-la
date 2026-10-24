# Guide d'exploitation — domaines de Fii

> v1, 24/10/2026, Builder (Claude Code). Complète `docs/PLAN-DOMAINES-FII.md` (le pourquoi) : ici, le comment.
> **État :** code et tests prêts sur la branche `domaines`. Rien n'est en ligne. Aucun achat, aucun DNS modifié, aucun service payant activé.
> Les étapes marquées **[Fondateur]** demandent un accès ou un accord qu'il est seul à donner.

## 1. Ce qui est construit

| Pièce | Fichier | Rôle |
|---|---|---|
| Worker | `worker/index.mjs`, `worker/wrangler.jsonc` | Sert `web/`. Domaine principal → l'application. Domaine de boutique actif → le site de cette boutique seulement. Tout autre hôte → « Site introuvable » |
| Base | `supabase/migrations/20261024100000_fiila_shop_domains.sql` | Table `fiila.shop_domains`, règles (Premium, 2 domaines, unicité, expiration 72 h), résolution pour le Worker, back-office |
| Fonction serveur | `supabase/functions/fiila-domains/` | Crée et suit le nom d'hôte chez Cloudflare, écrit le résultat (clé de service). Sans secrets : ne fait rien et le dit |
| Application | `web/app.js` | Réglages → « Mon domaine » ; mode « site » (vitrine, panier, facture) ; écran de transfert vers la nouvelle adresse |
| Back-office | `web/app.js` (« Domaines ») | Liste, statut, certificat, erreur ; « Revérifier » ; « Déconnecter » avec motif, au journal |
| CI | `.github/workflows/pages.yml` | Variables `APP_HOSTS`, `MOVED_TO`, `LEGACY_ORIGINS` (vides aujourd'hui : aucun effet) |

**Interrupteur :** Back-office → Réglages → `custom_domains` (1 ouvert, 0 coupé). Coupé : aucun domaine de boutique ne sert de site, aucune demande nouvelle.

## 2. Preuves (tests)

| Suite | Contenu | Résultat local (24/10) |
|---|---|---|
| `tests/domains.sql.test.mjs` | Deux boutiques, noms invalides, doublons (casse comprise), limite de 2, Premium, expiration 72 h, écriture réservée à la clé de service, HTTPS en attente non servi, mauvais DNS, actif = propriété ET certificat, résolution sans fuite, coupure (gratuite, hors ligne, suspendue, interrupteur), déconnexion et réattribution, journal | 13/13 |
| `tests/domainsfn.sql.test.mjs` | Fonction : droits vérifiés avec l'identité de l'appelant, Cloudflare simulé (création, reprise, relecture, panne, nettoyage). Worker : domaine principal, `www`, hôte inconnu, page au nom de la boutique échappée, pas de service worker, **cache par hôte sans mélange**, base indisponible → 503 non mis en cache | 12/12 |
| `tests/domains.test.mjs` (Chrome ; Safari en CI) | Vrai Worker devant le serveur de test : site d'une boutique, retour à sa vitrine, gestion renvoyée au domaine principal, hôte inconnu, garde de l'application, **transfert entre deux origines** (clé jamais dans une adresse, session non transmise, origine non autorisée ignorée), « Mon domaine », boutique gratuite | 7/7 |
| `tests/backoffice.test.mjs` | 16 sections, dont « Domaines » | voir CI |

**Non testable d'ici (à faire sur vrai téléphone, après mise en ligne de test) :** iPhone Safari et Android Chrome, sur le domaine de test : ouverture du site d'une boutique, commande, facture ; transfert depuis l'ancienne adresse avec fenêtre bloquée puis autorisée ; ajout à l'écran d'accueil sur `fiila.app`.

## 3. Instructions DNS données aux boutiques

Fii affiche dans « Mon domaine » **les enregistrements renvoyés par Cloudflare pour ce nom**, avec un bouton pour copier chaque valeur. En pratique :

| Cas | Ce que la boutique ajoute chez son hébergeur DNS |
|---|---|
| `www.saboutique.com` (recommandé) | `CNAME` · nom `www` · valeur `sites.fiila.app` |
| Vérification de propriété, si Cloudflare la demande | `TXT` · nom et valeur affichés par Fii (copiés de Cloudflare) |
| Certificat, si Cloudflare demande une validation DNS | `TXT` ou `CNAME` affiché par Fii |
| `saboutique.com` (sans www) | Seulement si l'hébergeur DNS accepte un CNAME à la racine (« CNAME flattening », « ALIAS »). Sinon : relier `www`, et rediriger `saboutique.com` vers `www` chez le registraire |

Fii ne donne **jamais** d'adresse IP à recopier. Délai habituel : quelques minutes à quelques heures. Sans vérification en 72 heures, la demande expire ; la boutique recommence.

**Réponses types (support) :**
- *« Erreur » avec « CNAME absent »* : l'enregistrement n'existe pas encore, ou il pointe ailleurs. Vérifier le nom (`www`) et la valeur exacte.
- *« Vérification » depuis plus d'une journée* : un enregistrement `CAA` peut bloquer le certificat. Le retirer ou autoriser l'autorité indiquée par Cloudflare.
- *Domaine pris* : un nom n'appartient qu'à une boutique. Si la boutique prouve qu'il est à elle, l'équipe le déconnecte dans le back-office (motif obligatoire) ; la boutique refait la demande.

## 4. Mise en ligne — étapes et rollback

### 4.1 [Fondateur] Accès (aucun secret dans le dépôt ni la conversation)
1. Ouvrir un compte Cloudflare au nom d'Aramis Lab.
2. Acheter le domaine **après validation** du nom exact, du prix et du renouvellement (voir le message de livraison).
3. Créer un jeton d'API limité à la zone : Workers Scripts (édition), DNS (édition), SSL and Certificates (édition), Custom Hostnames (édition).
4. Le saisir soi-même : secret GitHub `CLOUDFLARE_API_TOKEN` ; secret Supabase (Edge Functions) `CF_API_TOKEN`. Variables non secrètes : `CLOUDFLARE_ACCOUNT_ID`, `CF_ZONE_ID`, `CF_SAAS_TARGET=sites.fiila.app`.

### 4.2 Préproduction (sans toucher `fiila.app`)
1. Ajouter à la CI une étape `wrangler deploy` après l'écriture de `config.js`, avec `--var SUPABASE_ANON_KEY:<clé publique>` (clé déjà publique dans `config.js`). Adresse : `fii.<compte>.workers.dev`.
2. Lancer les tests en ligne (`tests/e2e.test.mjs`, Chrome et Safari) sur cette adresse.
3. Déployer la fonction `fiila-domains` (sans les secrets : elle répond « non configuré »).
4. Recette sur vrai téléphone (§2).

### 4.3 Bascule — **accord du fondateur requis**, avec le résultat des tests
| # | Action | Vérification |
|---|---|---|
| 1 | Route `fiila.app/*` et `www.fiila.app/*` vers le Worker ; `PUBLIC_URL=https://fiila.app/`, `APP_HOSTS=fiila.app` | `https://fiila.app` ouvre l'application ; `www` renvoie vers `fiila.app` |
| 2 | Supabase Auth : URL du site `https://fiila.app`, adresses de retour `https://fiila.app/**` (garder l'ancienne pendant la transition) | Connexion, mot de passe oublié, double authentification du back-office |
| 3 | Ancienne adresse : `MOVED_TO=https://fiila.app/`, `LEGACY_ORIGINS=https://aramislab0.github.io` | Un lien de fiche partagé avant la bascule s'ouvre sur `fiila.app` au même écran ; un téléphone avec une boutique voit « Fii change d'adresse » |
| 4 | Cloudflare for SaaS : origine de secours `sites.fiila.app` (AAAA `100::`, proxifié), route Worker `*/*`. **Activation à valider** (moyen de paiement possiblement demandé) | Un domaine de test Premium passe « Actif » ; un hôte inconnu répond « Site introuvable » |

### 4.4 Retour arrière
| Situation | Geste | Effet |
|---|---|---|
| Problème sur `fiila.app` | Vider `MOVED_TO` et relancer la CI | GitHub Pages sert de nouveau l'application complète ; les données locales y sont intactes (le transfert copie, il n'efface rien) |
| Mauvaise version du Worker | `wrangler rollback` ou version précédente dans Cloudflare | Immédiat |
| Domaine de boutique en cause | Back-office → Domaines → Déconnecter (motif) | Le domaine répond « Site introuvable » ; la vitrine reste à son adresse Fii |
| Tous les domaines de boutique | Back-office → Réglages → `custom_domains` = 0 | Sous 60 secondes (cache du Worker) |

## 5. Exploitation courante
- **Back-office → Domaines :** les domaines en erreur ou en vérification sont en tête. « Revérifier » relit Cloudflare. « Déconnecter » demande un motif, l'écrit au journal et retire le nom chez Cloudflare.
- **Coût :** 100 noms d'hôte inclus, puis 0,10 USD par nom et par mois (`www` et domaine nu comptent pour deux). À surveiller au-delà de 80.
- **Sécurité :** la fonction qui écrit le résultat de Cloudflare n'est ouverte qu'à la clé de service. Le Worker ne lit que `slug`, `nom` et `hôte`. La page d'un site de boutique n'est jamais mise en cache partagé.
