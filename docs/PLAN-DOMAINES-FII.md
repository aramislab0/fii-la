# Plan — Domaine principal de Fii et domaines des boutiques

> v1, 24/10/2026, Builder (Claude Code). Mandat du fondateur du 24/10 (domaine principal + domaine propre d'une boutique).
> **Rien n'est acheté, aucun DNS n'est modifié, aucun service payant n'est activé sans accord du fondateur.**
> Chaque fait est marqué : **FAIT** (vérifié, avec source et date), **À CONFIRMER** (non vérifiable d'ici), **HYPOTHÈSE**.

## 1. Verdict

**Architecture retenue : Cloudflare de bout en bout pour l'adresse (DNS, hébergement, HTTPS, domaines des boutiques), Supabase inchangé, code de l'application inchangé dans sa structure.**

- **Domaine principal : `fiila.app`** chez Cloudflare Registrar, décision du fondateur du 19/10, conservée. Disponibilité **À CONFIRMER** au moment de l'achat.
- **Hébergement :** un Worker Cloudflare avec les fichiers de `web/` en ressources statiques. Il remplace GitHub Pages pour le domaine principal. GitHub Pages reste en ligne pendant la migration, puis renvoie vers le nouveau domaine.
- **Domaines des boutiques :** Cloudflare for SaaS sur la zone `fiila.app`. La boutique ajoute **un enregistrement CNAME** sur `www.saboutique.com` vers `sites.fiila.app`. Cloudflare vérifie la propriété et émet le certificat HTTPS.
- **Domaine nu (`saboutique.com` sans `www`) : non pris en charge directement.** L'offre gratuite ne propose pas le « apex proxying ». Exception : un hébergeur DNS qui accepte un CNAME à la racine (« aplatissement »). Sinon, la boutique redirige le domaine nu vers `www` chez son registraire.

## 2. Domaine principal

| Point | État |
|---|---|
| Domaines déjà détenus par Aramis | **FAIT** (boîte mail du fondateur, 24/10) : compte LWS `LWS-454015` avec `somoonhotel.com` actif ; `aramisplay.com` et `betagroupesn.com` expirés. **Aucun domaine Fii trouvé.** Aucun courriel de Cloudflare dans cette boîte : pas de compte Cloudflare connu à cette adresse (**À CONFIRMER**) |
| `fii-la.com` | **FAIT** (19/10, RDAP Verisign) : enregistré par un tiers chez LWS depuis le 25/08/2026. Écarté |
| `fii.com` | **FAIT** (19/10) : pris depuis 1998. Écarté |
| `fiila.app` | Choisi par le fondateur le 19/10 (HANDOFF §3). Sans enregistrement DNS le 19/10. **Disponibilité au 24/10 : À CONFIRMER** (le registre `.app` n'est pas joignable depuis mon environnement) |
| Prix `.app` chez Cloudflare | **8,20 USD la 1ʳᵉ année, 14,20 USD par an ensuite** (domainoffer.net, mis à jour le 23/10/2026). Taxes éventuelles : **À CONFIRMER** au paiement. `.app` impose HTTPS, ce que l'architecture fait déjà |
| Cohérence avec la marque « Fii » | `fiila.app` se lit « Fii la ». Si `fii.app` est libre au moment de l'achat, c'est l'option la plus courte. **À CONFIRMER**, sans rouvrir la décision du 19/10 si le fondateur la garde |
| Registraire | Cloudflare Registrar : prix coûtant, DNS déjà chez Cloudflare. Il ne vend pas le `.sn` |
| Propriétaire du compte | Compte Cloudflare **au nom d'Aramis Lab**, ouvert par le fondateur, carte du fondateur. Le Builder reçoit un jeton d'API limité, jamais le mot de passe |

**Courriel (séparé) :** 2 adresses Zoho Mail Lite, décidées le 19/10, à brancher après l'achat (MX, SPF, DKIM). Le nouveau domaine n'a encore aucun enregistrement à préserver. L'ajout d'enregistrements web ne touche jamais les enregistrements MX, SPF ou DKIM.

**Domaine neutre des sites offerts :** le principe a été validé le 19/10 ; le nom n'est pas choisi. **Conservé.** L'architecture sert aussi `nom-boutique.<domaine-neutre>` dès qu'il existe : une seconde zone avec un enregistrement générique.

## 3. Architecture

```
Visiteur ─┬─ fiila.app ───────────────┐
          ├─ www.saboutique.com ──CNAME──> sites.fiila.app ─┐
          │                           │                    │
          └─ aramislab0.github.io/fii-la (ancienne adresse, migration puis renvoi)
                                      ▼                    ▼
                         Worker « fii » (Cloudflare) : fichiers de web/ + règle par nom d'hôte
                                      │
                                      ▼
                         Supabase (inchangé : base, fonctions, Auth)
```

**Règle du Worker par nom d'hôte** (`worker/index.mjs`) :

| Hôte reçu | Réponse |
|---|---|
| `fiila.app`, `www.fiila.app` (`www` renvoie vers `fiila.app`) | L'application complète, comme aujourd'hui |
| Domaine de boutique **vérifié et actif** | **Site seulement** : la vitrine de cette boutique, son panier, l'envoi de commande et sa facture. Titre, icône et aperçu de partage à son nom. Aucune gestion, aucun compte, aucune clé |
| Hôte inconnu, non vérifié, déconnecté ou en attente | Page « Site introuvable » sobre, sans l'application ni aucune donnée |

**Isolation :** la page HTML d'un domaine de boutique n'est **jamais mise en cache partagé**. Le cache des correspondances hôte → boutique est indexé par nom d'hôte et dure 60 secondes. Une boutique ne peut donc pas servir le contenu d'une autre. Chaque domaine est une origine distincte du navigateur : pas de stockage commun avec `fiila.app`.

**Coûts (FAIT, documentation Cloudflare consultée le 24/10/2026) :**

| Poste | Offre | Coût |
|---|---|---|
| Zone DNS `fiila.app` | Free | 0 |
| Worker | Free : 100 000 requêtes par jour ; fichiers statiques gratuits et illimités | 0. Au-delà : Workers Paid, 5 USD par mois minimum |
| Cloudflare for SaaS | 100 noms d'hôte inclus (Free, Pro, Business), puis **0,10 USD par nom d'hôte et par mois**, 50 000 au plus | 0 jusqu'à 100 domaines de boutique (un domaine avec `www` et domaine nu = 2 noms d'hôte) |
| Apex proxying (domaine nu natif) | Enterprise uniquement, module payant | **Non retenu** |
| Domaine `.app` | Cloudflare Registrar | 8,20 USD puis 14,20 USD par an (+ taxes **À CONFIRMER**) |

**À CONFIRMER dans le tableau de bord :** l'activation de Cloudflare for SaaS sur l'offre Free demande peut-être un moyen de paiement enregistré, même sans facturation. **Je ne l'active pas** sans accord.

## 4. Domaine propre d'une boutique (Site Pro)

**Qui :** réservé aux boutiques **Premium** (décision du 22/10 : le domaine propre fait partie du Site Pro payant). Le propriétaire ou un administrateur de la boutique, pas un éditeur.

**Parcours (Réglages → Mon site → « Mon domaine ») :**
1. Taper son domaine. `www.saboutique.com` est recommandé. `saboutique.com` est accepté avec une consigne : le DNS doit accepter un CNAME à la racine, sinon relier `www`.
2. Fii affiche **seulement les enregistrements réellement demandés** : le CNAME vers `sites.fiila.app`, plus les enregistrements de vérification que Cloudflare renvoie pour ce nom (TXT ou HTTP). Fii n'invente aucune valeur.
3. Statut lisible : *En attente du DNS* → *Vérification* (propriété puis certificat) → **Actif** seulement quand les deux sont validés. En cas d'erreur, la raison donnée par Cloudflare, avec « Vérifier » et « Déconnecter ». Deux domaines au plus par boutique.
4. Une fois actif, le site répond sur `https://www.saboutique.com`. L'adresse Fii de la boutique (`fiila.app/#/b/…`) **continue de marcher**.

**Garde-fous :**
- un nom d'hôte appartient à **une seule** boutique ; une demande en double est refusée ;
- une demande non vérifiée **expire après 72 heures** et libère le nom (contre le blocage d'un domaine par quelqu'un qui ne le possède pas) ;
- les noms de Fii, les adresses IP, les noms sans point et `localhost` sont refusés ;
- **réattribution** seulement après déconnexion, depuis le back-office, avec motif tracé ;
- la gestion, les comptes et les fonctions sensibles restent sur `fiila.app`.

**Back-office :** liste des domaines (boutique, statut de vérification et de certificat, dernière erreur, dates). Actions « Revérifier » et « Déconnecter » avec motif, toutes au journal.

## 5. Changement de domaine principal : ne rien perdre

**Problème :** les clés de gestion des fiches, de la boutique et du livreur sont gardées **dans le navigateur, par origine**. `fiila.app` ne voit pas ce que `aramislab0.github.io` a gardé.

**Solution (sans jamais mettre une clé dans une adresse, des journaux ou les mesures) :**
1. Après la bascule, l'ancienne adresse reçoit `movedTo = https://fiila.app`.
2. S'il n'y a rien de local, l'ancienne adresse renvoie tout de suite vers la nouvelle, **avec le même chemin** : un lien de fiche, de demande, de facture ou de vitrine déjà partagé continue de marcher.
3. S'il y a des fiches, une boutique ou un compte livreur sur ce téléphone, l'écran affiche « Fii change d'adresse » et un bouton **« Continuer »**.
   - Le bouton ouvre `fiila.app/#/migrer`. La nouvelle page signale qu'elle est prête à l'ancienne.
   - L'ancienne lui transmet les données locales de Fii par **message direct entre les deux fenêtres**. L'origine est vérifiée des deux côtés.
   - Les sessions de connexion ne sont pas transférées : on se reconnecte.
   - La nouvelle page fusionne sans rien écraser, confirme, et l'ancienne se ferme ou renvoie.
4. Un compte connecté retrouve tout par la connexion. Les fiches liées à un compte ne dépendent pas du téléphone.
5. Secours : « Restaurer une clé de gestion » marche toujours sur la nouvelle adresse.

**Autres points de la bascule :** URL publique (`publicUrl`) utilisée par les liens, les QR codes et les cartes WhatsApp ; aperçu `og:image` ; nouveau service worker sur la nouvelle origine, et cache de l'ancien vidé par une nouvelle version ; URL du site et adresses de retour dans Supabase Auth ; origines autorisées des fonctions serveur.

## 6. Accès nécessaires

| Accès | Qui | Pour quoi |
|---|---|---|
| Compte Cloudflare (Aramis Lab) | Fondateur | Achat de `fiila.app`, zone DNS, Worker, Cloudflare for SaaS |
| Jeton d'API Cloudflare limité à la zone : Workers (édition), DNS (édition), Custom Hostnames et SSL (édition) | Fondateur → secret GitHub `CLOUDFLARE_API_TOKEN` et secret Supabase `CF_API_TOKEN` | Mise en ligne du Worker par la CI ; création et suivi des domaines des boutiques. Jamais dans le dépôt ni la conversation |
| Identifiants de compte et de zone (non secrets) | Fondateur → variables GitHub `CLOUDFLARE_ACCOUNT_ID`, `CF_ZONE_ID` | Configuration |
| Supabase Auth (URL du site, adresses de retour) | Fondateur, ou le Builder avec son accord | Connexion sur la nouvelle adresse |
| Zoho Mail | Fondateur | Courriels (séparé) |

**Accès manquants au 24/10 :** compte Cloudflare, achat du domaine et jetons. Tout le reste peut être construit et testé sans eux.

## 7. Étapes

1. **Construire et tester (branche `domaines`, sans effet sur la production). FAIT le 24/10 : voir `docs/GUIDE-DOMAINES.md`.** Worker, mode « site seul », migration des clés, réglage « Mon domaine », back-office, tests SQL et navigateur avec des boutiques et domaines synthétiques.
2. **Fondateur :** ouvrir le compte Cloudflare, vérifier et acheter `fiila.app`. Je présente avant le paiement le domaine exact, le prix et le renouvellement.
3. **Préproduction :** mettre le Worker en ligne sur une adresse de test du compte (`*.workers.dev`), sans toucher `fiila.app`. Tests en ligne Chrome et Safari, plus un test sur vrai téléphone par le fondateur.
4. **Bascule (accord du fondateur requis) :**
   - brancher `fiila.app` sur le Worker ;
   - mettre à jour Supabase Auth ;
   - activer Cloudflare for SaaS (fallback `sites.fiila.app`) ;
   - publier sur l'ancienne adresse la version qui migre puis renvoie.
5. **Premier domaine de boutique** (Premium) avec le fondateur, suivi dans le back-office.

## 8. Retour arrière

- **Avant l'étape 4 :** rien ne change pour les utilisateurs.
- **Domaine principal :** remettre `movedTo` à vide sur l'ancienne adresse. GitHub Pages sert de nouveau l'application complète, et les données locales restées sur l'ancienne origine sont intactes (la migration copie, elle ne supprime rien). Les données copiées sur `fiila.app` y restent sans effet.
- **Domaines de boutique :** déconnecter (back-office) ou couper l'interrupteur `custom_domains`. Le site répond « introuvable » sur le domaine propre et reste disponible à son adresse Fii.
- **Worker :** revenir à la version précédente en un clic dans Cloudflare, ou par `wrangler rollback`.

## Sources (consultées le 24/10/2026)

- [Cloudflare for SaaS — offres](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)
- [Apex proxying](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/apex-proxying/)
- [Worker comme origine](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/)
- [Validation des noms d'hôte](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/)
- [Workers — tarifs](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers — ressources statiques](https://developers.cloudflare.com/workers/static-assets/binding)
- [Prix .app chez Cloudflare (domainoffer.net)](https://domainoffer.net/tld/app/cloudflare)
- [Prix et démarches .sn (kolonell.com)](https://kolonell.com/fr/blog/nom-de-domaine-sn-prix-demarches-nic-senegal-2026)
