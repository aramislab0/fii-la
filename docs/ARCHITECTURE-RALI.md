# Rali dans Fii La : architecture

> 17/10/2026. Décision du fondateur : le produit Rali (boutique, commandes, factures, clients, demande d'adresse, livraison, paiement) est intégré à Fii La. Le paiement en ligne (Wave, Orange Money) vient en dernier : le modèle est prêt, l'intégration ne l'est pas.

## 1. Principe

Fii La reste utilisable sans compte. Le compte ajoute une seconde façon de prouver qu'une fiche vous appartient : en plus de la clé de gestion stockée sur le téléphone, le serveur reconnaît `auth.uid()`.

Les fonctions existantes n'ont donc pas été dupliquées. Seules `fiila.owned_place` et `fiila.owned_request` ont changé : elles acceptent la clé **ou** le compte. Tout le reste en hérite (modifier, désactiver, supprimer, livraison, invités d'un rendez-vous).

## 2. Briques

| Brique | Ce qui existait | Ce qui a été ajouté |
|---|---|---|
| Identité | Clé de gestion par fiche | Supabase Auth (e-mail + mot de passe), client REST minimal dans `app.js`, sans bibliothèque. Rafraîchissement automatique du jeton. Retour des liens e-mail (`#access_token=…`). |
| Profil | — | `fiila.profiles` : nom, téléphone, photo (≤ 150 Ko, métadonnées refusées). |
| Carnet d'adresses | « Mes adresses » sur le téléphone | `places.user_id` et `places.tag` (maison, bureau, boutique, autre). À la connexion, les fiches du téléphone rejoignent le compte (`fiila_claim`, clé valide obligatoire). Une adresse reste privée tant que son lien n'est pas envoyé. |
| Boutique | Demande d'adresse anonyme | `fiila.shops` : une boutique par compte (MVP). |
| Clients | — | `fiila.customers` : nom, téléphone, dernière adresse reçue. Même numéro dans la boutique = même client (+221 normalisé). |
| Commandes et factures | Référence libre dans une demande | `fiila.orders` : numéro par boutique (0001…), articles, total calculé côté serveur en FCFA, lien de facture (jeton 128 bits). |
| Adresse de livraison | Demande d'adresse | Chaque commande crée une demande au nom de la boutique, sauf si le client a déjà une adresse active. La réponse remonte sur la commande et sur la fiche client. |
| Livraison | Liens livreur et suivi | `fiila_order_delivery` : lien livreur. Le client suit directement sur sa facture. Position effacée à la livraison ou à l'annulation. |
| Paiement | — | `fiila.payments` : saisie manuelle aujourd'hui (espèces, Wave, Orange Money, autre). Colonnes `source` (`manual` / `provider`), `status`, `provider_ref` prêtes pour l'opérateur. |

## 3. Parcours

**Commerçant**

1. Il crée sa boutique.
2. Il crée une commande : client et articles.
3. Il envoie la commande sur WhatsApp, directement au numéro du client.
4. Le client ouvre la facture, sans compte.
5. Le client touche « Donner mon adresse de livraison ».
6. Le commerçant envoie le lien au livreur.
7. Le client suit le livreur sur sa facture.
8. Le commerçant enregistre le paiement et marque la commande livrée.

**Client connu.** Sa commande suivante reprend son adresse, sans la redemander. S'il désactive son adresse, la boutique ne la voit plus et peut la redemander.

**État d'une commande.** Il est calculé sur trois axes indépendants : adresse (attendue, reçue, expirée, retirée), livraison (à livrer, en route, arrivé, livrée, annulée) et paiement (impayée, acompte, payée). L'écran n'affiche que l'étape suivante, en un seul repère : « Adresse attendue », « À livrer », « En route », « À encaisser » ou « Terminée ».

## 4. Sécurité

- Toutes les tables restent dans le schéma privé `fiila`. Les rôles `anon` et `authenticated` n'ont aucun droit direct. Tout passe par des fonctions `security definer` avec `search_path` vide.
- Chaque fonction de boutique vérifie `auth.uid()` puis l'appartenance (`fiila.my_shop`, `fiila.my_order`). Tests d'isolation entre deux comptes.
- La facture publique ne contient ni le téléphone du client ni aucun identifiant interne.
- Supprimer le compte efface la boutique, les clients, les commandes, les paiements, les fiches rattachées et le profil. Les fiches restées seulement sur un téléphone ne sont pas touchées.

## 5. Paiement en ligne : ce qu'il restera à faire

Rien n'est activé et aucun contrat n'est engagé.

1. Accord opérateur. Wave Business API (checkout et webhook) et Orange Money Web Payment ou un agrégateur (PayDunya, CinetPay, etc.).
   - Frais et conditions à confirmer par le fondateur.
   - Rien n'est activé sans son accord (CLAUDE.md, règle 6).
2. Une fonction Edge `fiila-pay`. Elle crée la session de paiement et reçoit le webhook signé.
   - Elle écrit dans `fiila.payments` avec `source = 'provider'`, `status`, `provider_ref`.
   - Les secrets restent dans les secrets Supabase, jamais dans le dépôt.
3. Sur la facture : un bouton « Payer avec Wave / Orange Money » quand la boutique a activé un moyen.
   - L'état de paiement existe déjà, l'écran s'en sert sans autre changement.

## 6. Ce qui est volontairement hors MVP

- Plusieurs boutiques par compte, ou plusieurs vendeurs par boutique.
- Catalogue produits et stocks.
- TVA et mentions légales complètes de facture.
- Avoirs.
- Connexion par téléphone et SMS : service payant, à décider.
- Envoi automatique de messages : WhatsApp Business API, payant.

## 7. Réglages Supabase à faire par le fondateur (tableau de bord)

**Authentication → URL Configuration**
- Site URL : `https://aramislab0.github.io/fii-la/`.
- Redirect URLs : la même adresse.

**Authentication → Providers → Email**, pour le pilote :
- soit garder « Confirm email » activé, avec un SMTP personnalisé ;
- soit le désactiver. L'envoi d'e-mails intégré de Supabase est très limité et réservé aux adresses de l'équipe.

**Mot de passe oublié.** Il a besoin d'un SMTP qui fonctionne : Resend, Brevo… Les offres gratuites suffisent pour le pilote, à confirmer par le fondateur.
