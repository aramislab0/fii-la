# Fii La — données personnelles : lecture de la loi sénégalaise

*Note de travail du 15/10/2026, établie à partir des textes officiels et du fonctionnement réel de l’application au commit `9576bc8`. Ce n’est pas un avis juridique, et Fii La n’a reçu aucune validation. À faire relire par un juriste ou un délégué à la protection des données avant toute démarche.*

## 0. Correction

Les versions précédentes de `LIVRAISON.md` affirmaient qu’« une demande d’autorisation à la CDP est à prévoir avant d’ouvrir le service à de vrais utilisateurs ». **Cette affirmation n’est pas établie** et elle est retirée.

- La loi ne soumet à autorisation qu’une liste fermée de traitements (article 20), et aucun ne correspond à Fii La (section 3).
- La formalité de droit commun est la **déclaration** (article 18).
- L’hébergement des données en France relève des **règles de transfert vers un pays tiers** (articles 49 à 51).
- Dans une réponse publiée, la CDP oriente l’hébergement hors du Sénégal vers son **formulaire de demande d’autorisation**. C’est une pratique administrative publiée, pas une catégorie de l’article 20. Elle doit être confirmée pour le cas précis de Fii La.

## 1. Textes consultés

| Source | Statut |
|---|---|
| Loi n° 2008-12 du 25 janvier 2008 sur la protection des données à caractère personnel : texte publié par la CDP et copie AFAPDP | Texte officiel en vigueur. Une réforme est annoncée mais n’était pas adoptée selon les sources de mars 2026 |
| CDP, avis trimestriel n° 03-2025 (juillet à septembre 2025), annexe 7 « questions reçues du grand public » | Document public de la CDP |
| Conseil de l’Europe : adhésion du Sénégal à la Convention 108 (2016) | Fait vérifié |
| Décret n° 2008-721 du 30 juin 2008 (application de la loi) | Repéré, **non lu** : à consulter (procédure et formulaires) |

## 2. Ce que Fii La traite réellement

Constaté dans le code au commit `9576bc8`.

| Donnée | Personnes concernées | Finalité | Où | Durée de conservation (code) | Destinataires |
|---|---|---|---|---|---|
| Point d’entrée et point d’arrêt voiture (coordonnées) d’une adresse | Créateur de la fiche et occupants du lieu | Guider un visiteur jusqu’à l’entrée | Supabase, région Paris (`eu-west-3`) | Jusqu’à la suppression par le propriétaire : **pas de durée maximale** | Toute personne qui a le lien |
| Nom du lieu, quartier, repère, trajet à pied (texte libre) | Idem | Idem | Idem | Idem | Idem |
| Photo de l’entrée (métadonnées GPS retirées) | Idem, et toute personne visible sur la photo | Reconnaître la porte | Idem | Idem | Idem |
| Rendez-vous : lieu, date, indications, photo | Organisateur et invités (indirectement) | Lieu temporaire | Idem | Effacé 30 jours après la fin d’affichage | Toute personne qui a le lien |
| Demande d’adresse : nom du demandeur, objet, référence | Demandeur (souvent un commerce) | Recevoir l’adresse d’un client | Idem | Effacée 30 jours après expiration (7 jours de validité) | Le client qui a le lien voit le nom et l’objet ; seul le demandeur voit la réponse |
| Réponse à une demande (lien vers la fiche du client) | Client | Livraison | Idem | Tant que la demande existe ; disparaît si le client supprime ou désactive | Le demandeur seulement |
| Lien court Google Maps collé par l’utilisateur | Créateur de la fiche | Lire le point désigné (fonction `fiila-resolve-maps`) | Fonction Supabase (Paris) qui interroge Google | Non conservé : traité le temps de la requête | Google (reçoit la requête du serveur, pas l’adresse IP de l’utilisateur) |
| **Suivi en direct (ajout du 17/10)** : dernière position GPS et courte trace (30 points max) d’un livreur ou d’un invité de rendez-vous ; prénom de l’invité | Livreurs, invités | Indiquer l’heure d’arrivée à l’expéditeur et au client (livraison) ou au seul organisateur (rendez-vous) | Idem | Position effacée à l’arrivée ou à l’arrêt ; suivi supprimé 1 jour après expiration (livraison : 12 h ; rendez-vous : fin d’affichage) | Détenteurs du lien de suivi (livraison) ; organisateur seul (rendez-vous) |
| Empreinte salée de l’adresse IP (limite anti-abus) | Toute personne qui crée une fiche ou déclenche un compteur | Sécurité | Idem | 24 heures | Personne |
| Jetons (partage, gestion haché, anciens liens) | Créateurs | Contrôle d’accès | Idem | Anciens liens : 180 jours | Personne |
| Compteurs agrégés (jour, événement, variante, nombre) | Aucune personne identifiable | Mesure d’usage | Idem | Sans limite | Administrateur |
| Journaux techniques des prestataires (IP, date, page) | Visiteurs | Fonctionnement des services | GitHub Pages, Supabase | Selon chaque prestataire : **non vérifié** | Prestataires |

**Prestataires et tiers**
- **Supabase Inc.** : base de données, hébergée sur AWS à Paris. C’est un sous-traitant au sens de l’article 4.16 (« traite des données pour le compte du responsable »). Société américaine : un accès depuis les États-Unis (support, administration) n’est pas exclu, et n’a pas été vérifié.
- **GitHub Inc.** : hébergement des fichiers du site uniquement, sans aucune donnée de fiche. Reçoit l’adresse IP des visiteurs.
- **Fondation OpenStreetMap** : reçoit l’adresse IP et la zone de carte affichée, seulement pendant la création d’une fiche. Ce n’est pas un sous-traitant de Fii La : c’est un service tiers.
- **Google Maps, WhatsApp, Telegram, Facebook, Instagram, TikTok** : n’interviennent que si la personne le choisit (itinéraire, partage). Fii La leur transmet alors le lien ou, pour l’itinéraire, les coordonnées du point.

**Ce que Fii La ne traite pas** : comptes, numéros de téléphone, contacts, pièces d’identité, données biométriques, données de santé, suivi de position (la position n’est lue qu’à la demande), cookies de suivi. Le texte libre peut toutefois contenir n’importe quoi, si l’utilisateur l’écrit.

## 2 bis. Compléments à déclarer (traitements ajoutés depuis le dépôt du 17/10)

> Préparé le 18/10/2026 pour le fondateur, qui dépose le complément auprès de la CDP. Le Builder ne contacte pas la CDP. Validé par le fondateur le 18/10 23:14 (« je valide tout »).
>
> **Attention :** la phrase « Ce que Fii La ne traite pas : comptes, numéros de téléphone… » du §2 n'est plus exacte. Ce complément la remplace.

| Donnée | Personnes concernées | Finalité | Durée de conservation | Destinataires |
|---|---|---|---|---|
| Compte (facultatif) : e-mail, mot de passe géré par Supabase Auth, nom, téléphone, photo de profil | Utilisateurs qui créent un compte | Retrouver ses fiches et sa boutique sur plusieurs téléphones | Jusqu'à la suppression du compte (fonction disponible dans l'application) | Personne d'autre |
| Boutique : nom, téléphone, NINEA ; clients du commerçant (nom, téléphone) ; commandes, factures, paiements enregistrés | Commerçants ; leurs clients | Gestion des commandes et des livraisons | 24 mois au plus pour commandes et clients (décision du 17/10), ou jusqu'à suppression par le commerçant | Le commerçant ; le client voit sa propre facture par son lien |
| Livreur : nom, téléphone, moyen de livraison, zone ; courses ; notes reçues | Livreurs | Recevoir les courses des boutiques | Jusqu'à la suppression de l'espace livreur | Les boutiques qui l'ont choisi ; le client voit le prénom |
| Notes d'articles et de livraisons (1 à 5, sans nom) | Acheteurs | Qualité | Avec la commande | Le commerçant voit la moyenne |
| **Origine et parrainage** : d'où vient une nouvelle boutique, un livreur, une adresse ou un rendez-vous (lien reçu, code, numéro tapé) ; fiche de parrainage (nom, numéro facultatif, jamais affiché) | Nouveaux utilisateurs ; parrains | Mesurer le bouche-à-oreille ; récompenses futures | Autant que la fiche, la boutique ou l'espace livreur concerné ; code supprimable par son titulaire | Le parrain voit qu'une arrivée a eu lieu (nom d'une boutique, prénom d'un livreur, rien pour un particulier) ; le fondateur voit des chiffres agrégés |
| Publication d'un article (date seulement, pas le réseau choisi) | Commerçants | Mesure | Avec l'article | Le commerçant |
| **Repère vocal** (facultatif) : enregistrement audio de 30 s au plus, lié à une adresse | Créateur de la fiche ; toute personne dont la voix est enregistrée | Guider le visiteur ou le livreur, notamment pour les personnes qui lisent peu | Jusqu'au retrait par le propriétaire ou la suppression de la fiche | Toute personne qui a le lien de la fiche ; le livreur de la course |
| **Vitrine** (si la boutique l'ouvre) : articles publics ; commande en ligne (nom, numéro, articles, précision) | Commerçants ; clientes qui commandent | Vente en ligne | Comme les commandes (24 mois au plus) | La boutique concernée ; les articles sont visibles par toute personne qui a le lien |
| **Ambassadeurs (19/10)** : nom, téléphone, quartier, numéro de versement Wave ou Orange Money, résultat au test, boutiques accompagnées, gains et versements | Ambassadeurs (indépendants) ; commerçants accompagnés | Programme d'acquisition rémunéré à la mission ; prévention de la fraude | Durée du programme, puis selon les obligations comptables (à confirmer avec le comptable) | L'équipe Fii La ; le commerçant voit le prénom de son ambassadeur ; l'ambassadeur voit le nom de la boutique et des indicateurs, jamais les clientes |
| **Vide-dressing enfants (19/10)** : nom, téléphone, quartier de la vendeuse ; photo et description de l'article (genre, âge, taille, état, prix) ; commandes | Vendeuses ; acheteuses | Vente de seconde main tenue par Fii La (intermédiaire), enlèvement et livraison, reversement | Comme les commandes (24 mois au plus) ; article retiré ou vendu : photo gardée avec la commande | L'équipe Fii La ; l'acheteuse voit seulement l'article |
| **Fil social (19/10)** : j'aime et enregistrements (empreinte d'un identifiant aléatoire de l'appareil, ou compte) ; commentaires (texte, compte, prénom affiché) ; signalements | Visiteurs ; membres qui commentent | Réactions et avis publics sur les articles des boutiques, classements (best-sellers sur commandes livrées, coups de cœur) | Tant que l'article existe ; commentaires supprimés avec le compte ; l'auteur, la boutique et l'administrateur peuvent supprimer | Public : le prénom et le commentaire ; jamais le nom complet, l'e-mail ni le numéro |
| **Back-office et équipe (19/10)** : compte, e-mail, prénom, rôle et dernière activité de chaque membre ; e-mail des personnes invitées ; journal des actions de l'équipe (qui, quoi, quand, sur quelle fiche), y compris les consultations de commandes et de comptes | Membres de l'équipe Fii La ; personnes invitées ; utilisateurs dont la fiche est consultée | Gestion de la plateforme, sécurité, traçabilité des accès aux données personnelles | Journal : 24 mois ; invitations : 90 jours après expiration ou usage ; membre retiré : le compte reste, l'accès cesse aussitôt | Équipe Fii La selon le rôle ; le journal seulement par le super admin |
| **Équipe de la boutique (19/10)** : nom et numéro WhatsApp de la personne invitée, rôle (administrateur ou éditeur), compte qui accepte, qui a invité | Commerçants ; membres de leur équipe | Permettre à plusieurs personnes de gérer une même boutique, avec des droits limités | Invitation : 7 jours ; membre : jusqu'à son retrait, son départ, la suppression de son compte ou de la boutique | Le propriétaire et les administrateurs de la boutique ; l'invitation part du WhatsApp du commerçant (aucun envoi par Fii La) |
| Statistiques de croissance (agrégées) | Aucune personne identifiable | Pilotage | Sans limite | Comptes administrateurs (le fondateur) |

**Points à signaler dans le complément**
- **Micro.** Il n'est activé qu'à l'appui sur « Enregistrer », après l'autorisation du navigateur. Un repère vocal peut contenir des données que la personne choisit de dire.
- **Numéro du parrain.** Le numéro tapé pour un parrain est conservé, même si cette personne n'est pas encore inscrite, pour lui rattacher l'arrivée plus tard. Il n'est jamais affiché.
- **Responsables des données clients.** Le commerçant est responsable des données de ses propres clients ; Fii La les héberge pour lui.
- **Ambassadeurs.** Fii La paie des personnes à la mission : vérifier le statut (indépendant), la retenue éventuelle et la durée de conservation des justificatifs avec un comptable.
- **Vide-dressing.** Fii La devient intermédiaire de vente entre particuliers. Les photos d'articles ne doivent montrer aucun enfant reconnaissable (contrôlé à la validation).
- **Fil social.** Les commentaires sont des contenus publics : ni lien ni numéro de téléphone acceptés (pas de démarchage ni de vente hors plateforme), masquage automatique après 3 signalements, suppression par l'auteur, la boutique ou l'administrateur. Les j'aime et enregistrements sans compte sont liés à l'empreinte d'un identifiant aléatoire du téléphone (et, pour le classement, à l'empreinte de la connexion) : c'est une donnée pseudonyme, qui relie les réactions d'un même téléphone. Elle n'est jamais affichée et n'est pas croisée avec un compte. Signaler un commentaire demande un compte.
- **Équipe de la boutique.** Le numéro de la personne invitée est saisi par le commerçant, qui envoie lui-même le lien depuis son WhatsApp ; Fii La n'envoie aucun message. Le lien est personnel, valable 7 jours et utilisable une seule fois ; il n'est stocké qu'haché.
- **Vérification des numéros par SMS (19/10).** Le numéro d'un compte peut être confirmé par un code à 6 chiffres. Le code est créé et contrôlé par Supabase Auth ; le SMS est envoyé par **Africa's Talking** (nouveau sous-traitant, siège au Kenya : à déclarer avec le transfert de données hors du Sénégal). Seuls le numéro et le code lui sont transmis ; Fii La ne conserve aucun code. Le numéro confirmé reste dans le compte jusqu'à sa suppression.
- **Manager Fii La Carrière (20/10).** Conversation entre chaque ambassadeur et le Manager (et l'équipe) : messages, missions du jour, retours écrits sur les missions ; classement automatique des messages (question, objection, problème…). Conservés tant que le profil ambassadeur existe (supprimés avec lui). **Si l'IA est activée** (réglage, désactivé par défaut) : le message et le contexte de l'ambassadeur (prénom, quartier, statut, code, avancement de ses commerçants, sans aucun numéro de téléphone ni donnée de cliente) sont envoyés à **Anthropic** (API Claude, États-Unis) pour rédiger la réponse : nouveau sous-traitant et transfert hors du Sénégal à déclarer avant activation ; prévenir les ambassadeurs dans la charte.
- **Découverte progressive (20/10).** Suggestions dans l'application selon l'usage, décidées sur le téléphone (aucun profil côté serveur) ; mesure anonyme par jour (suggestion vue, suivie, écartée).
- **Prestataires.** Supabase (Paris), GitHub Pages, OpenStreetMap ; Africa's Talking pour les SMS (19/10) ; Anthropic (IA du Manager, seulement si activée).

## 3. Lecture des dispositions

**Application de la loi**
- Art. 4.6 : la donnée personnelle est « toute information relative à une personne physique identifiée ou identifiable directement ou indirectement ». Une porte d’entrée localisée et photographiée rend son occupant identifiable : la loi s’applique très probablement aux fiches d’adresse.
- Art. 2 : la loi vise les traitements mis en œuvre sur le territoire sénégalais, et les responsables établis à l’étranger qui recourent à des moyens situés au Sénégal.
- **Les compteurs agrégés** ne contiennent aucune information relative à une personne identifiable : ils semblent hors du champ de l’article 4.6. **L’empreinte d’IP**, elle, reste vraisemblablement une donnée personnelle, même hachée et salée, car elle est rattachable à une connexion pendant 24 heures.

**Exemptions**
- Art. 3 : exclusions limitées aux activités personnelles ou domestiques et aux copies techniques temporaires. Un service ouvert à des tiers ne relève pas du cadre « domestique ». **Non applicable**, selon cette lecture.
- Art. 17 : dispenses pour certains registres publics et pour certaines associations à but non lucratif. **Non applicable**, sauf si le responsable était une telle association, ce qui n’est pas le cas connu.
- Art. 19 : la CDP peut publier des **normes simplifiées** qui allègent ou suppriment la déclaration. **Question ouverte** : aucune norme couvrant ce type de service n’a été trouvée, mais la recherche n’a pas été exhaustive.

**Déclaration (art. 18)**
- « En dehors des cas prévus aux articles 17, 20 et 21 […] les traitements de données à caractère personnel font l’objet d’une déclaration auprès de la Commission des Données Personnelles. »
- « Toutefois, seule la réception du récépissé donne droit à la mise en œuvre d’un traitement. » La CDP délivre ce récépissé « dans un délai d’un (1) mois ».
- Contenu du dossier : art. 22, 11 rubriques, dont la durée de conservation, la sécurité, le recours à un sous-traitant et les transferts vers un pays tiers.

**Autorisation (art. 20)** : la liste est fermée. Elle couvre les données génétiques et la recherche en santé, les infractions et condamnations, l’interconnexion de fichiers, le numéro national d’identification ou un identifiant de portée générale, les données biométriques, et les traitements d’intérêt public à des fins historiques, statistiques ou scientifiques.
- **Aucune ne correspond** aux traitements de Fii La. Point de vigilance : une photo d’entrée n’est pas une donnée biométrique, mais une photo qui montrerait des visages ne doit faire l’objet d’aucun traitement biométrique. Fii La n’en fait aucun.
- Les compteurs agrégés ne sont pas des traitements d’intérêt public à des fins statistiques au sens du 6° : c’est une mesure interne d’usage, sans donnée personnelle.

**Transfert vers un pays tiers (art. 49 à 51)**
- Art. 4.12 : « Pays tiers : tout Etat autre que le Sénégal. » L’hébergement à Paris est donc un transfert vers un pays tiers.
- Art. 49 : transfert permis « que si cet Etat assure un niveau de protection suffisant » ; « avant tout transfert […] le responsable du traitement doit préalablement informer la Commission des Données Personnelles ». Le caractère suffisant s’apprécie selon la sécurité, la finalité, la durée, la nature, l’origine et la destination des données.
- Art. 50 : exceptions, dont le transfert « ponctuel, non massif » avec consentement exprès. Elles sont **inadaptées** à un hébergement permanent.
- Art. 51 : la CDP peut autoriser un transfert ou un ensemble de transferts « sur la base d’une demande dûment motivée ».
- Contexte : le Sénégal a adhéré à la Convention 108 du Conseil de l’Europe en 2016, et la France y est partie. Cela peut peser dans l’appréciation du niveau de protection. **Le texte ne dit pas** que cela dispense de l’information préalable de l’article 49, ni qui tranche le caractère suffisant.
- Pratique publiée de la CDP (avis trimestriel 03-2025, annexe 7) : « Si les données sont hébergées en dehors du territoire sénégalais, il doit remplir le formulaire de demande d’autorisation. » Cette réponse vise une base de données clients ; elle est la meilleure indication disponible de la procédure attendue pour un hébergement à l’étranger.

**Autres obligations qui s’appliquent quelle que soit la formalité**
- Art. 33 : licéité, notamment par le consentement de la personne.
- Art. 35 : conservation limitée à la durée nécessaire. **Écart actuel** : aucune durée maximale pour les fiches d’adresse.
- Art. 39 : contrat écrit avec le sous-traitant, qui ne doit agir que sur instruction. Il faut vérifier et conserver les conditions de traitement de Supabase.
- Art. 58 : information des personnes « au plus tard, lors de la collecte ». Depuis le 17/10/2026 (commit `3419094`), la page « Données et confidentialité » indique les champs obligatoires, l’hébergement en France, les durées de conservation et les droits. **Écart restant** : l’identité et le contact du responsable du traitement, à ajouter dès qu’ils sont communiqués.

## 4. Questions non résolues

1. **Qui est le responsable du traitement** : l’ami à l’origine du projet, Aramis Lab, ou les deux conjointement ? Tout le reste en dépend : dossier, information des personnes, contrats.
2. **Quelle formalité exacte** : une déclaration (art. 18) accompagnée de l’information préalable du transfert (art. 49), ou le formulaire de demande d’autorisation que la CDP indique pour l’hébergement à l’étranger ? À confirmer auprès de la CDP par le responsable.
3. **Le test terrain** avec 5 chauffeurs et de vraies adresses consenties est-il déjà une « mise en œuvre » soumise au récépissé de l’article 18 ? Lecture prudente : oui, puisque l’article ne prévoit pas d’exception pour un test.
4. **Normes simplifiées** (art. 19) : en existe-t-il une applicable ?
5. **Durée maximale** de conservation des fiches d’adresse à fixer (par exemple, suppression après N mois sans consultation). Ce serait une décision de produit, hors du gel actuel.
6. **Sous-traitance Supabase** : conditions de traitement, lieu d’accès du support, sous-traitants ultérieurs. **Journaux** de GitHub et Supabase : durées.
7. **Décret 2008-721** : formulaires, délais et pièces à joindre, non lus.

## 5. Prochaine étape recommandée

1. **Fondateur et ami** : désigner le responsable du traitement.
2. **Juriste ou délégué à la protection des données sénégalais** : relire cette note et le décret 2008-721.
3. **Le responsable lui-même**, et non Claude : interroger la CDP sur la formalité applicable à un service hébergé à Paris. Le dossier se prépare avec les 11 rubriques de l’article 22, que la section 2 de cette note couvre déjà en grande partie.
4. **D’ici là** : données synthétiques uniquement, et aucun test terrain avec de vraies adresses avant d’avoir clarifié le point 3 de la section 4.
5. **Après la formalité** : compléter la page « Données et confidentialité » avec l’identité et le contact du responsable (art. 58). Cette mise à jour de contenu est prévue hors du gel fonctionnel.

**Nouveau traitement à signaler à la CDP (17/10/2026)** : le suivi en direct de la position des livreurs et des invités, activé seulement par la personne suivie, avec effacement à l’arrivée. À ajouter au dossier en cours avant toute utilisation avec de vrais livreurs.

**Statut au 17/10/2026** : demande CDP en cours, déposée par le fondateur. Une fiche descriptive du traitement, rubrique par rubrique (art. 22), a été préparée dans un document partagé pour l’accompagner. Claude n’a pris aucun contact avec la CDP.

**Sources**
- [Loi n° 2008-12, texte publié par l’AFAPDP](https://www.afapdp.org/wp-content/uploads/2018/05/Senegal-texte-de-loi-2008.pdf)
- [Loi n° 2008-12, fiche WIPO Lex](https://www.wipo.int/wipolex/fr/legislation/details/6229)
- [CDP, avis trimestriel n° 03-2025](https://sppsyrftszniuaicadvk.supabase.co/storage/v1/object/public/public_docs/avis-trimestriels/avis-trimestriel-1763029761225.pdf)
- [Conseil de l’Europe, adhésion du Sénégal à la Convention 108](https://www.coe.int/fr/web/portal/news-2016/-/asset_publisher/StEVosr24HJ2/content/senegal-becomes-the-50th-state-to-accede-to-the-data-protection-convention-convention-108-)
- [Décret n° 2008-721 (référence Osiris)](https://osiris.sn/Decret-no-2008-721-du-30-juin-2008.html)
