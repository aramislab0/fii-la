# Proposition — Algorithmes utiles à Fii, maintenant et plus tard

> v1, 22/10/2026, par le Builder (Claude), à la demande du fondateur (23:48) : « les algorithmes pertinents maintenant et plus tard ; j'ai besoin de l'avis de ChatGPT ».
> **Rien n'est construit avant l'avis du VP (ChatGPT) et la validation du fondateur.** L'avis du VP s'ajoute en haut de `docs/REVUE-VP.md`, et la v2 intègre ses changements.
> Base lue : `main` au commit `0988e5d`. Les seuils et les poids sont des hypothèses de départ, pas des valeurs démontrées.

## 1. Verdict

**Maintenant : des règles explicites et un peu de statistique, pas d'apprentissage automatique.** Au pilote (une vingtaine de boutiques), aucun modèle entraîné ne battrait une règle lisible. Il serait impossible à vérifier et à expliquer à une commerçante comme à la CDP.

Deux familles d'algorithmes ont de la valeur dès maintenant :
- **ceux qui rendent l'adresse plus sûre** : le cœur de la promesse de Fii, et un avantage difficile à copier ;
- **ceux qui protègent l'argent** : les récompenses des Agents, et les commandes payées à la livraison qui ne sont pas honorées.

**Plus tard**, quand le volume le justifiera, viendront :
- l'ordre de passage d'un livreur ;
- les délais estimés ;
- les recommandations d'articles ;
- les prévisions.

Chaque algorithme a un **déclencheur chiffré**. On ne le construit pas avant.

Règles communes à tous :
- résultat **explicable en une phrase** à la personne concernée ;
- **aucune décision automatique défavorable** : on propose, on signale, l'humain décide ;
- **back-office** à chaque fois (règle 8) : voir, agir, tracer, régler, tester ;
- **un interrupteur** de retour arrière.

## 2. Maintenant (pilote)

### A1. Note de fiabilité d'une adresse

- **Problème.** Le commerçant et le livreur ne savent pas si une adresse est bonne avant de partir. Celui qui la crée ne sait pas ce qui la rendrait meilleure.
- **Données disponibles (FAIT, table `fiila.places`) :** `entry_acc` (précision du point), `photo`, `instruction`, `voice`, `stop_lat`/`stop_lng` (arrêt voiture), `vehicle_ok`. Livraisons liées : `fiila.orders` (`place_id`, `delivered_at`), `fiila.courier_reviews`.
- **Calcul proposé (sur 100, poids à valider) :**

  | Élément | Points |
  |---|---|
  | Précision du point ≤ 15 m | 25 |
  | Précision de 15 à 40 m | 15 |
  | Photo de l'entrée | 25 |
  | Repère écrit (au moins 20 caractères) | 15 |
  | Repère vocal | 10 |
  | Arrêt voiture distinct ou « accessible en voiture » renseigné | 5 |
  | Livraisons réussies (5 par livraison, au plus 20) | 20 |

  Une note de livreur de 2/5 ou moins sur cette adresse retire 10 points.
- **Affichage :**
  - pour celui qui crée l'adresse, une seule suggestion, la plus utile (« Ajoutez une photo de l'entrée ») ;
  - pour le commerçant et le livreur, une mention sobre : « Adresse sûre · livrée 3 fois ».

  Pas de note chiffrée affichée au public.
- **Back-office.** Répartition des notes ; adresses fragiles qui portent des commandes ouvertes ; poids réglables (bornés) et journalisés ; aperçu sur cas fictifs.
- **CDP.** Aucune donnée nouvelle : le calcul se fait sur des champs existants.
- **Mesure.** Part des commandes livrées sans « adresse à redemander », selon la note de l'adresse.
- **Effort (hypothèse).** Environ une demi-journée.

### A2. Entrée confirmée par les livraisons

- **Problème.** À Dakar, le point GPS d'une adresse est souvent à 20 à 60 m de la vraie porte. Le livreur qui trouve la bonne entrée ne transmet ce savoir à personne.
- **Contrainte (FAIT).** `fiila.trackers` garde la position du livreur pendant la course seulement. Elle est **effacée à l'arrivée**, et c'est l'engagement pris dans `docs/CONFORMITE-CDP.md` (ligne « Suivi en direct »). **Je ne propose pas de conserver ces traces.**
- **Mécanisme proposé :**
  1. À l'arrivée, le livreur touche **« Je suis à la bonne porte »**. C'est un geste explicite, une seule fois.
  2. Ce point est enregistré **sur l'adresse**, sans identifiant de livreur ni trace, comme « point d'arrivée confirmé ».
  3. Quand au moins 2 points confirmés, à des dates différentes, se regroupent à plus de 25 m du point de l'adresse, Fii propose au **propriétaire de l'adresse** : « Les livreurs trouvent votre porte ici. Mettre à jour ? ».
  4. **Rien n'est déplacé automatiquement.**
- **Algorithme.** Regroupement par distance : médiane géographique des points confirmés, écart des points inférieur à 15 m.
- **Valeur stratégique.** Avec le temps, une carte des vraies entrées de Dakar. Personne d'autre ne l'a ; elle se construit par l'usage et ne se copie pas.
- **CDP.** **Nouveau traitement à déclarer avant toute utilisation réelle** : le point d'arrivée confirmé par un livreur, rattaché à une adresse, ni à une personne ni à une trace. Prévoir la durée de conservation (proposition : 12 mois, ou effacement avec l'adresse).
- **Back-office.** Propositions de correction en attente, acceptées et refusées ; écart moyen avant et après ; interrupteur.
- **Mesure.** Écart entre le point initial et le point confirmé ; livraisons sans appel après correction.
- **Effort (hypothèse).** Environ une journée, plus le complément au dossier CDP.

### A3. Détection de fraude avant toute récompense en argent (Agents)

- **Problème.** Le programme Agents paie au niveau atteint par les boutiques accompagnées. Les fraudes simples sont faciles : fausses boutiques, commandes passées à soi-même, clientes qui sont toutes la même personne. L'action #34 interdit déjà toute récompense en argent avant la vérification du numéro.
- **Données (FAIT) :** `ambassador_shops`, `shops` (`phone`, `created_at`), `customers` (`phone`), `orders`, `referrals` (`phone_key`), normalisation du numéro existante (`fiila.phone_key`).
- **Règles proposées.** Chaque règle ajoute des points à un score de risque :
  - même numéro pour la boutique et pour l'Agent ou une autre boutique de cet Agent ;
  - au moins 3 boutiques créées par le même Agent en moins d'une heure ;
  - plus de 50 % des clientes d'une boutique qui partagent un numéro avec l'Agent ou la boutique ;
  - des commandes livrées sans adresse reçue ni livreur, en série ;
  - un niveau atteint en moins de 48 h après la création.
- **Effet.** Au-delà d'un seuil, le gain passe **« en vérification »** dans la file existante du back-office, avec la liste des règles déclenchées. **Jamais de refus ni d'exclusion automatique** : l'équipe décide.
- **Back-office.** File « À vérifier » avec les motifs ; seuils réglables et journalisés ; taux de faux positifs suivi.
- **CDP.** Aucune donnée nouvelle. Un traitement de contrôle sur des données existantes, à mentionner dans le dossier (finalité : prévention de la fraude).
- **Effort (hypothèse).** Environ une demi-journée. **À faire avant le premier versement.**

### A4. Risque de commande non honorée et proposition d'acompte

- **Problème.** Le paiement à la livraison domine, et une commande annulée à l'arrivée coûte une course.
- **Données (FAIT) :** `orders` (`status`, `cancelled_at`, `customer_id`), paiements enregistrés. **Seulement à l'intérieur d'une boutique** : jamais d'historique partagé entre boutiques.
- **Calcul.** Estimation lissée : (annulations + 1) / (commandes + 4). Au début, une cliente inconnue est donc à 25 %. Au-delà de 40 %, avec au moins 2 annulations, le commerçant voit : « Cette cliente a annulé 2 commandes sur 3 : demander un acompte ? ».
- **Garde-fous.**
  - Le message n'est vu que par la boutique, jamais par la cliente.
  - Aucune liste noire.
  - Aucun partage entre boutiques.
  - Le commerçant reste libre.
- **CDP.** Un profilage léger, limité à la relation entre une boutique et sa cliente : à décrire au dossier.
- **Mesure.** Annulations sur les commandes qui ont reçu un acompte, comparées à celles qui n'en ont pas reçu.
- **Effort (hypothèse).** Environ une demi-journée.

### A5. Notes justes (avis)

- **Problème (FAIT).** La note affichée est une moyenne brute (`round(avg(rating))`, vitrine et fiche boutique). Une boutique à 5/5 sur un seul avis passe devant une 4,6/5 sur 40 avis.
- **Calcul.** Moyenne ajustée : (somme des notes + 4 × m) / (nombre d'avis + 4), où m est la moyenne de toutes les boutiques. On affiche toujours le nombre d'avis.
- **Le fil Fii ne change pas.** L'ordre des 25 places gratuites reste un tirage du jour (`md5(id || date)`) : c'est la règle d'équité actuelle, et cette proposition ne la touche pas.
- **Effort (hypothèse).** Une heure.

## 3. Plus tard (déclencheurs chiffrés)

| Algorithme | Déclencheur | Méthode envisagée | Pourquoi pas avant |
|---|---|---|---|
| Ordre de passage d'un livreur | Au moins 20 % des livreurs actifs avec 3 courses ou plus en même temps | Le plus proche d'abord, puis amélioration par échange de deux étapes, sur les points des adresses | Aujourd'hui, une course à la fois |
| Délai de livraison estimé | 200 livraisons avec heure de départ et heure d'arrivée | Durée médiane par quartier et par tranche horaire, puis régression simple | Pas assez de livraisons |
| « Souvent commandés ensemble » | 50 commandes à plusieurs articles dans une même boutique | Articles commandés ensemble, avec un minimum de 3 occurrences | Recommandations vides ou absurdes |
| Prévision de demande et de stock | Boutiques avec stock suivi et 3 mois d'historique | Moyenne mobile et saisonnalité de la semaine | Rien à apprendre |
| Zones de livraison et tarifs suggérés | 100 livraisons par commune | Grille par quartier à partir des livraisons réelles | Il faut d'abord des livraisons réelles |

## 4. À éviter

- **Apprentissage profond, recommandations par IA, « score client » opaque.** Sans volume, c'est du bruit présenté comme de l'intelligence. Un score sur des personnes est aussi un traitement à déclarer, et il n'est pas défendable s'il n'est pas explicable.
- **Toute décision automatique défavorable à une personne** : exclusion, refus de gain, liste noire.
- **Tout historique de clientes partagé entre boutiques.**
- **Toute conservation des traces GPS des livreurs** au-delà de l'engagement actuel (effacement à l'arrivée).

## 5. Ordre proposé

1. **A3, fraude des Agents** : avant le premier versement (bloquant pour l'argent).
2. **A1, note de fiabilité**, puis **A5, notes justes** : sans donnée nouvelle, faible effort.
3. **A2, entrée confirmée par les livraisons** : après le complément au dossier CDP.
4. **A4, acompte suggéré** : quand les boutiques du pilote auront au moins 10 commandes chacune.

## 6. Questions pour le VP (ChatGPT)

1. **Ordre.** A3 avant A1 est-il le bon arbitrage, sachant qu'aucun Agent n'est encore payé ?
2. **A2.** Le geste explicite « Je suis à la bonne porte » est-il suffisant pour la CDP et pour la confiance ? Le seuil de 2 points confirmés à des dates différentes est-il raisonnable ?
3. **A4.** Le message d'acompte risque-t-il d'abîmer la relation entre la commerçante et sa cliente, ou de créer une discrimination de fait ? Faut-il le garder pour plus tard ?
4. **A1.** Faut-il montrer la note de fiabilité au livreur et au commerçant, ou seulement des conseils à celui qui crée l'adresse ?
5. **Ce qui manque ou ce qui est en trop**, au stade pilote.

---

## Message à transmettre à ChatGPT (copier-coller)

> Tu es VP produit de Fii, avec le Builder (Claude Code). Le fondateur demande ton avis sur les algorithmes à construire maintenant et plus tard. Lis la proposition :
> https://raw.githubusercontent.com/aramislab0/fii-la/main/docs/PROPOSITION-ALGORITHMES.md
> Contexte et décisions en vigueur : https://raw.githubusercontent.com/aramislab0/fii-la/main/docs/HANDOFF.md
> et `docs/CONFORMITE-CDP.md` pour la position des livreurs.
>
> Rends un avis au format de `docs/REVUE-VP.md` :
> - un verdict (valider / valider avec changements / refaire) ;
> - au plus 5 changements, classés bloquant / important / plus tard, chacun exécutable sans deviner ;
> - une réponse courte aux 5 questions du §6.
>
> Distingue FAIT / ANALYSE / HYPOTHÈSE. Défends la solution simple (pilote, une vingtaine de boutiques). Ne rouvre pas les décisions de HANDOFF §3. Français, registre direct.
