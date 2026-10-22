# Proposition — Rétention par suggestions au bon moment (v2)

> **v2, 22/10/2026**, par le Builder (Claude). Elle intègre les cinq changements R1 à R5 de la revue du VP (ChatGPT) du 22/10, verdict « ALIGNÉ AVEC RÉSERVES » (`docs/REVUE-VP.md`).
> La v1 (moteur et échelles complètes) reste lisible dans l'historique Git (`fb2bf8c`).
>
> **Statut : à valider par le fondateur. Rien n'est construit.** Les seuils ci-dessous sont des règles de pilote proposées. Ce ne sont ni des références externes ni des performances prouvées.

## 1. Verdict

Le but n'est pas de faire adopter toutes les fonctions. Il est de **faire réussir puis répéter une tâche utile** : une commande traitée, une adresse obtenue, une adresse réutilisée.

Le lot 1 se limite à trois choses :
- **les 6 suggestions qui existent déjà**, réécrites avec des conditions indépendantes et une mesure honnête ;
- **la demande d'adresse d'une commande**, traitée comme une tâche de la commande et non comme une découverte ;
- **un arbitre commun** avec un budget d'expositions.

Restent en dehors du lot 1 :
- le catalogue élargi et le parcours « 5 étapes sur 9 » ;
- les parcours particulier et livreur ;
- la synchronisation avec le compte ;
- la mise en avant du Premium.

Les fonctions restent toutes accessibles dans « Découvrir les services ».

| Changement du VP | Réponse de la v2 |
|---|---|
| R1 — conditions indépendantes, priorité au besoin réel | Plus d'échelle obligatoire. Chaque suggestion a sa condition propre. La demande d'adresse d'une commande passe avant tout, même sans article, sans site ni logo. Les droits du membre sont vérifiés avant d'afficher (§3). |
| R2 — clic ≠ refus ≠ connu ≠ utilisé | Quatre états séparés. « Utilisé » = un succès confirmé par le serveur ou par l'état réel ; ouvrir un écran ou WhatsApp ne compte pas. Les anciens « done » ne sont pas convertis (§4). |
| R3 — arbitre et budget communs | Une exposition par session, deux au plus sur 7 jours glissants par téléphone, partagées entre les suggestions et la découverte après une action. Une exposition n'est comptée que si la carte est vue à 50 % ou plus. L'état d'une commande est hors budget (§5). |
| R4 — lot 1 réduit | 6 suggestions + l'adresse de commande, sans « 5/9 », avec un back-office minimal (§7). |
| R5 — mesure | Exposition visible, clic, premier succès sous 7 jours, répétition. Agrégats seulement. Fenêtre de 7 jours marquée incomplète tant qu'elle n'est pas écoulée. Seuil 200 vues / 3 % retiré ; règle du pilote fondée sur les boutiques suivies sur le terrain (§6). |

## 2. Ce qui existe (FAIT, `web/app.js` au commit `240317f`)

- **`nudge()`**
  - Il affiche une carte au plus par rendu.
  - Le clic pose `done = true`, et la carte disparaît pour toujours.
  - « × » donne 7 jours de silence ; deux « × » valent plus jamais.
  - Au plus 3 nouveaux identifiants par jour, mais leurs réaffichages ne sont pas limités.
  - « Vue » est comptée au rendu.
- **`afterTask()`**
  - Son état est séparé (`fiila.after`), sans plafond commun avec `nudge()`.
  - « Vue » n'est comptée que si la carte est visible (`trackWhenVisible`, seuil de 50 %).
- **La demande d'adresse d'une commande** existe déjà dans la commande :
  - adresse en attente → le lien de la facture la demande ;
  - adresse expirée, retirée ou absente → bouton « Redemander l'adresse » (`fiila_order_request_address`, ouvert aussi aux éditeurs).
  - Le tableau de bord marque « Adresse attendue » ou « Adresse à redemander ».

## 3. Matrice du lot 1 : conditions, succès, mesure

Les conditions sont lues dans l'état réel, sur le téléphone et dans `fiila_shop_get`. Aucune nouvelle donnée personnelle n'est créée.

| # | Suggestion | Montrée quand (toutes les conditions) | Jamais quand | Où | « Utilisé » = succès confirmé | Résultat métier (distinct) |
|---|---|---|---|---|---|---|
| S0 | **Adresse d'une commande** (état de la commande, hors budget) | Au moins une commande ouverte avec l'adresse en attente, expirée, retirée ou absente | Commande fermée ou annulée | En tête de Ma boutique : « 2 commandes attendent une adresse » → la première commande concernée ; dans la commande, comme aujourd'hui | Demande enregistrée par le serveur (`fiila_order_request_address` réussi), ou facture envoyée au client (WhatsApp ouvert = `share_initiated` seulement) | Adresse reçue (`address_state = received`) |
| S1 | Ouvrir sa boutique (`home_shop`) | Pas de boutique sur ce téléphone ni dans le compte ; au moins une action réussie (adresse, demande ou commande) ; boutique activée | Démarrage guidé en cours | Accueil | Boutique créée (réponse du serveur) | Premier article enregistré |
| S2 | Ajouter des articles (`shop_more_products`) | De 1 à 2 articles actifs | Rôle sans droit d'ajout ; démarrage en cours | Ma boutique | Article enregistré après l'exposition | Article commandé |
| S3 | Partager le site (`shop_share_vitrine`) | Site en ligne ; au moins 1 article ; aucune commande passée par le site | Site hors ligne : la boutique peut travailler par commandes, sans site public ; on ne la pousse pas | Ma boutique | **Au moins une visite du site** dans les 7 jours (`shop_views`, état réel). Le clic WhatsApp reste un clic | Commande passée par le site |
| S4 | Inviter un livreur (`shop_courier`) | Au moins 2 commandes ; ni livreur ni invitation en cours ; rôle propriétaire ou administrateur | Éditeur | Ma boutique | Invitation créée (serveur) | Livreur rattaché |
| S5 | Plusieurs photos (`shop_photos`) | Au moins 3 articles et au moins 1 commande ; **aucun article** n'a encore 2 photos ou plus | Éditeur sans droit sur les articles | Ma boutique | Article enregistré avec 2 photos ou plus | — |
| S6 | Ajouter un membre (`shop_team`) | Au moins 10 commandes ; rôle propriétaire ; aucun membre ni invitation | Tout rôle autre que propriétaire | Ma boutique | Invitation créée (serveur) | Membre ayant rejoint |

Une seule suggestion du budget est affichée par écran, dans l'ordre S2 → S3 → S5 → S4 → S6. S0 s'affiche **en plus**, puisque c'est une tâche de la commande. Cet ordre n'est pas une échelle : chaque suggestion reste éligible sans que les autres soient faites.

Scénarios de test exigés par R1, sous Chrome et WebKit :
- commande sans adresse alors que la boutique n'a aucun article : S0 visible ;
- boutique sans site public : S3 jamais affichée ; S0, S2, S4 et S5 restent possibles ;
- site prêt sans logo : rien ne demande de logo ;
- éditeur : ni S4 ni S6 ; S0 visible ;
- démarrage guidé ou création de commande en cours : aucune carte du budget.

## 4. États et compatibilité (R2)

- **Par suggestion et par téléphone :**
  - `shown` (dernière exposition visible) ;
  - `clicked` ;
  - `dismissed` (nombre de refus et date de fin du silence) ;
  - `known` ;
  - `used` (date du premier succès) ;
  - `repeated` (un deuxième succès, au moins un jour plus tard).
- **`known`** : la fonction était déjà utilisée avant la première exposition (état réel), par exemple un article à plusieurs photos existe déjà. Elle n'est jamais montrée et n'entre pas dans les nouvelles adoptions.
- **`used`** n'est posé que par la réponse réussie du serveur ou par l'état réel relu. Il compte une seule fois, localement, et seulement dans les 7 jours qui suivent une exposition. Au-delà, il vaut `known`, sans attribution.
- **Une erreur du serveur n'est pas un succès.** Un clic suivi d'un abandon laisse la suggestion éligible, sous le budget.
- **Anciens `done` (clics d'avant la v2).** Ils ne sont pas convertis en usages.
  - Si l'état réel montre la fonction utilisée, elle devient `known`.
  - Sinon, le clic est gardé comme historique et la suggestion n'est **pas relancée** au déploiement.
- **Les tests actuels « clic = terminé »** (`tests/nudges.test.mjs`) sont réécrits selon ces règles.

## 5. Arbitre et budget communs (R3)

- **Une seule fonction décide** de ce qui s'affiche, pour `nudge()`, pour `afterTask()` et pour toute autre invitation à découvrir. « Voir tous les services » ne change pas.
- **Budget par téléphone :**
  - une exposition par session (`sessionStorage`) ;
  - deux expositions au plus sur 7 jours glissants (`localStorage`).
  - Une carte compte seulement quand elle est visible à 50 % ou plus. Une carte affichée hors écran ne compte pas, et un rechargement ne la remontre pas dans la même session.
- **Silences** : un refus vaut 7 jours ; deux refus, plus jamais.
- **Jamais** pendant le démarrage guidé, la création d'une commande, un formulaire en cours, ni sur une page reçue par lien. Ces pages ne doivent rien écrire sur le téléphone sans action de la personne.
- **Interrupteurs existants respectés** : `nudges`, `discover_after`, et le refus des mesures (signal de confidentialité du navigateur). S0 reste hors budget, car c'est l'état de la commande.

## 6. Mesure et règle de décision du pilote (R5)

- **Événements anonymes**, sans clé de boutique, sans client et sans identifiant stable :
  - `retention` × (`S1`…`S6`) × (`shown`, `click`, `dismiss`, `used`, `repeat`) ;
  - pour S0 : `order_address` × (`shown`, `used`).
- **L'attribution** (exposition suivie d'un succès sous 7 jours) est calculée sur le téléphone. Seuls des agrégats quotidiens sont envoyés.
- **Back-office**, Croissance → **Suggestions** :
  - par suggestion : expositions visibles, clics, refus, premiers succès sous 7 jours, répétitions ;
  - toujours en nombres bruts, avec la mention « installations observées » (pas des personnes ni des boutiques uniques) ;
  - les 7 derniers jours marqués « fenêtre incomplète ».
  - S0 : nombre de commandes passées d'une adresse attendue ou expirée à une adresse reçue sur 30 jours. C'est un agrégat calculé par le serveur sur les commandes, sans aucune donnée de client.
- **Règle du pilote (hypothèse, sans valeur statistique)**, suivie dans `docs/FICHE-TEST-TERRAIN.md` avec l'accord des boutiques, hors des compteurs anonymes :
  - condition : au moins **5 boutiques distinctes** éligibles ont réellement vu une suggestion, et 7 jours complets d'observation se sont écoulés ;
  - si **aucun succès** : diagnostic, une seule réécriture, nouvelle observation ;
  - si encore aucun succès : retrait de la suggestion du pilote.
- **Indicateur suivi** : nouvelle commande traitée, ou adresse réutilisée à une occasion ultérieure. Le nombre de fonctions utilisées sert au diagnostic, pas d'indicateur principal.

## 7. Lot 1 : périmètre et back-office (R4)

- **Code :**
  - l'arbitre ;
  - les 6 suggestions migrées selon la matrice du §3 ;
  - la carte S0 en tête de Ma boutique ;
  - les états du §4 ;
  - la reprise des anciens `done`.
  - Le démarrage guidé existant est conservé tel quel.
- **Base :**
  - mesure `retention` et `order_address` (liste blanche de `fiila_track`) ;
  - agrégat S0 ;
  - interrupteur par suggestion (réglages bornés 0/1) en plus de l'interrupteur général `nudges`.
- **Back-office :**
  - **Voir** : la matrice et les compteurs.
  - **Agir** : interrupteurs par suggestion et général.
  - **Tracer** : chaque changement dans le journal de l'équipe.
  - **Tester** : aperçu de chaque carte.
- **Tests** : scénarios du §3, budget et rechargements (§5), clic sans succès et erreur du serveur (§4), sous Chrome et WebKit ; recette sur téléphone réel avant tout élargissement.
- **Retour arrière** : l'interrupteur général coupe tout ; les anciennes cartes ne reviennent pas.
- **Hors lot 1** : catalogue élargi, « 5/9 », parcours particulier et livreur, synchronisation avec le compte, Premium, rappels WhatsApp ou e-mail.

## 8. À valider par le fondateur

1. Le périmètre du lot 1 (§7) et la matrice (§3).
2. La règle du pilote (§6) : 5 boutiques distinctes, 7 jours, une réécriture, puis retrait.
3. L'ordre d'affichage S2 → S3 → S5 → S4 → S6 quand plusieurs suggestions sont possibles.
