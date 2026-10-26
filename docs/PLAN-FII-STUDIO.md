# Fii Studio — niveau 1 (retouche « pro » fidèle)

> v1, 26/10/2026, Builder. Demande du fondateur (26/10, 19:29) : « passons à Fii Studio ». Cadre validé le 19/10 (`docs/PROPOSITION-SITES-STUDIO-ASSISTANT.md` §3) : niveaux 1 et 2 d'abord, fournisseur unique fal.ai payé à l'usage, budget d'essai plafonné, offert aux 25 boutiques fondatrices pendant le test. Critère d'arrêt : moins de 30 % des boutiques fondatrices l'utilisent en 30 jours → pas de mannequins ni de vidéo.

## 1. Ce que voit la boutique

1. Sur l'écran d'un article qui a une photo : une ligne **Studio** (étincelle, couleur Marketing) avec les crédits restants.
2. **5 styles** de décor, chacun avec sa pastille de couleur : Blanc, Minimal, Luxe, Soleil, Fête.
3. **« Créer 3 versions »** (environ 10 s) : 3 versions au format 4:5, à côté de l'original.
4. Elle touche une version, puis **« Garder cette version »**. Cette version devient la photo principale (vitrine, Publier, fil, factures) et l'originale reste la photo suivante. **1 crédit.**
5. Une série non gardée ne coûte rien à la boutique. Quand elle n'a plus de crédit, le bouton de création disparaît et un message clair le remplace. Dans l'app mobile, aucun achat (règles Apple et Google).

**Fidélité du produit :** le modèle **Bria Product Shot** (via fal) détoure le produit et ne génère que le décor, la lumière et l'ombre. Les motifs du produit (wax, broderies, logos) ne sont pas redessinés. Le nom et le prix ne sont jamais écrits par l'IA : ils sont ajoutés par les modèles de Publier.

## 2. Garde-fous de coût et de sécurité

| Garde-fou | Réglage (Back-office → Réglages) | Défaut |
|---|---|---|
| Studio ouvert ou fermé | `studio_ready` | **0 : fermé** (ouvert après la clé fal) |
| Budget du mois (USD) ; au-delà, pause automatique | `studio_budget_usd` | 50 |
| Séries par boutique et par jour | `studio_daily` | 10 |
| Une seule série en cours par boutique ; une série bloquée est close après 3 min | — | — |
| Crédits : essai partenaire (pack Ambassadeur `studio_credits`) d'abord, puis crédits de la boutique | — | 0 |

- **Coût réel :** 0,04 USD par image, soit 0,12 USD par série de 3 versions (environ 75 FCFA). Le budget de 50 USD couvre environ 400 séries.
- **Clé fal :** dans la fonction serveur seulement, jamais dans l'application ni dans le dépôt. L'écriture du résultat est réservée à la clé de service.
- **Adresses :** seules les adresses `*.fal.media` sont enregistrées ; le téléphone reçoit l'image gardée par la fonction serveur.

## 3. Ce qui est construit

| Pièce | Où |
|---|---|
| Base | `supabase/migrations/20261026200000_fiila_studio.sql` : séries, crédits, budget, limites, back-office, mesure |
| Fonction serveur | `supabase/functions/fiila-studio/` : `render` (ouvre la série, appelle fal, enregistre) et `take` (renvoie l'image gardée) |
| Application | `web/app.js` : ligne Studio sur l'article, feuille Studio, version gardée enregistrée comme photo principale |
| Back-office | Section **Studio** : ouvert ou fermé, dépense du mois face au budget, séries, versions gardées, échecs, boutiques ; crédits des boutiques ; **accorder ou retirer des crédits** (motif obligatoire, au journal) ; dernières séries avec style, statut, coût, erreur |
| Tests | `studio.sql` 10/10, `studiofn.sql` 5/5, `studio` 3/3 (navigateur, fal simulé), `backoffice` 13/13 |

## 4. Pour l'ouvrir — actions du fondateur

1. **Compte fal.ai** au nom d'Aramis Lab. Charger **20 USD** de crédit prépayé : c'est la seule dépense réelle, et rien n'est dépensé tant que le Studio est fermé.
2. Créer une clé d'API fal. La saisir soi-même dans Supabase → Edge Functions → Secrets, sous le nom **`FAL_KEY`**.
3. Me le dire. Je déploie la fonction et fais **une série de test sur un article de test**, soit 0,12 USD.
4. Back-office → Réglages → `studio_ready` = 1. Puis Back-office → Studio : accorder des crédits aux boutiques fondatrices, par exemple 10 chacune.

## 5. Suite (après le critère des 30 jours)

- **Niveau 2 :** visuel pub (nom, prix, logo) avec le décor Studio comme fond des cartes de Publier. Petit travail : les modèles existent déjà.
- **Packs de crédits** vendus sur le web, avec les paiements Orange Money et Wave (grille du 21/10, action #59).
- **Niveaux 3 et 4** (mannequins, vidéo) : seulement si le critère d'arrêt est passé.
