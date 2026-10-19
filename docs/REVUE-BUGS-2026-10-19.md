# Revue des parcours et des bugs (19/10/2026)

> Document interne. Demande du fondateur (19/10 03:29) : « des fenêtres n'offrent pas de flèche retour, vérifie toutes les logiques et parcours, crée les interconnexions, vérifie tout autre bug ».

## 1. Navigation

**Constat.** Plusieurs écrans n'avaient aucune sortie :
- invitation livreur (`#/livreur/invitation/…`) ;
- lien de course (`#/l/…`) ;
- états d'erreur des pages reçues (`#/a`, `#/d`, `#/f`, `#/l` : lien expiré, coupé, introuvable) ;
- écran « Adresse envoyée ».

**Correctif.**
- Tout écran sans bouton retour reçoit une flèche automatique :
  - vers l'écran précédent, si on vient de l'application ;
  - sinon vers l'écran parent logique (article → articles → boutique, client → clients, livreur → espace livreur).
- Le logo Fii La ramène à l'accueil sur toutes les pages reçues.
- Une flèche apparaît dans l'en-tête quand on arrive sur une page reçue depuis l'application (par exemple vitrine → facture → retour à la vitrine).
- Ouverte directement depuis WhatsApp, une page reçue n'a pas de flèche (il n'y a rien derrière), seulement le logo.

**Preuve.** `tests/navigation.test.mjs`, 47/47 :
- 28 écrans propriétaire et 14 écrans publics ou d'erreur, à 360 px ;
- chaque écran a une sortie, aucun texte « undefined » ou « NaN », aucun débordement horizontal ;
- parcours enchaînés.

## 2. Bugs trouvés et traitement

| # | Gravité | Bug | Traitement |
|---|---|---|---|
| 1 | Bloquant | Commande de vitrine passée avec le numéro d'une cliente connue : l'adresse donnée remplaçait celle de la cliente (colis livré chez un tiers à la commande suivante) | Corrigé. L'adresse d'une commande de vitrine reste sur cette commande, jamais copiée sur le client |
| 2 | Important | Parrainage par numéro : la première fiche créée avec un numéro recevait les arrivées de ce numéro | Atténué. La boutique, le livreur ou le compte qui porte le numéro passe avant une fiche anonyme. **Limite** : le numéro reste déclaratif ; une vérification par SMS est nécessaire avant toute récompense en argent (action #34) |
| 3 | Important | Commande sans articles (appel direct au serveur) : commande vide créée | Corrigé (vitrine et boutique) |
| 4 | Important | Quotas par adresse IP : les abonnés mobiles partagent souvent la même IP ; une grande vitrine épuisait le quota de lecture | Photos de vitrine comptées à part ; quota de commandes en ligne passé de 10 à 40 par heure ; vitrine jusqu'à 200 articles. À suivre avec le trafic réel |
| 5 | Important | « Supprimer mon code » avec un compte : la fiche était recréée à la visite suivante | Corrigé. Elle revient seulement si la personne la recrée |
| 6 | Important | Échec d'envoi du repère vocal masqué par « Adresse enregistrée » | Corrigé. Le message dit que le vocal n'est pas enregistré et invite à réessayer depuis « Modifier » |
| 7 | Important | Repère vocal inaudible pour la boutique (commande) et pour le demandeur d'une adresse | Corrigé. Accès privé par la clé de la boutique ou de la demande |
| 8 | Important | « Reprendre le partage » après une erreur lançait un second suivi GPS ; « Arrêter » n'arrêtait que le second | Corrigé. Un seul suivi à la fois ; une coupure réseau passagère n'interrompt plus le partage |
| 9 | Important | Ouvrir son propre lien de parrainage comptait comme une invitation | Corrigé sur le téléphone. **Limite** : un particulier qui crée plusieurs adresses compte plusieurs arrivées, à traiter avec les règles de récompense |
| 10 | Important | iPhone : le premier toucher sur « Écouter » pouvait ne rien jouer, avec une icône trompeuse | Corrigé. Si le téléphone refuse, l'écran affiche « Touchez encore pour écouter ». **À vérifier sur un vrai iPhone** |
| 11 | Mineur | Micro : double toucher, micro resté ouvert en changeant d'étape ou d'écran, enregistrement perdu en touchant « Continuer » | Corrigé. Micro coupé à chaque changement d'écran ; « Continuer » attend que l'enregistrement soit prêt |
| 12 | Mineur | Son qui continue après un changement d'écran | Corrigé |
| 13 | Mineur | Quatre codes d'erreur sans message clair | Corrigé |
| 14 | Mineur | Icône manquante sur « Envoyer la commande », « Créer la demande », « Envoyer à… » | Corrigé |
| 15 | Mineur | Un code de parrainage erroné bloquait toute autre origine pendant 30 jours | Corrigé. Le code est vérifié ; s'il est inconnu, il est oublié |
| 16 | Mineur | Réglages de la vitrine : texte en cours de saisie effacé ; choix affiché alors que l'enregistrement avait échoué | Corrigé |
| 17 | Mineur | Lien d'un article qui n'est plus proposé : vitrine sans explication | Corrigé. Message « Cet article n'est plus proposé » |
| 18 | Mineur | Origine « vitrine » affichée brute dans les statistiques | Corrigé |
| 19 | Mineur | Erreur de chargement d'un écran : l'écran précédent restait figé | Corrigé. Message et bouton « Réessayer » |
| 20 | Mineur | Le propriétaire ne pouvait plus écouter son vocal après avoir coupé le lien | Corrigé |

**Autres corrections.**
- Les derniers boutons citron sont passés en vert avec icône : envoi au livreur, invitation livreur, envoi de la facture.
- Image Story : « (heure de Dakar) » n'est plus coupé entre deux lignes. Le test échouait selon la longueur du jour de la semaine.

## 3. Preuves

Tests locaux sur Chromium, tous verts :

| Suite | Résultat |
|---|---|
| sql | 37/37 |
| accounts | 26/26 |
| couriers (SQL) | 11/11 |
| security | 6/6 |
| referrals (SQL) | 15/15 |
| voice (SQL) | 6/6 |
| vitrine (SQL) | 7/7 |
| **bugfixes (SQL, nouveau)** | **6/6** |
| e2e | 38/38 |
| circuit | 20/20 |
| discovery | 23/23 |
| social | 23/23 |
| tracking | 12/12 |
| shop | 26/26 |
| couriers | 8/8 |
| referrals | 8/8 |
| **voice (2 tests ajoutés)** | **7/7** |
| vitrine | 7/7 |
| **navigation (nouveau)** | **47/47** |
