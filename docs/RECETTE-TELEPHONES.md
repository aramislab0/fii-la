# Recette sur téléphones réels — Fii La

**À faire uniquement sur l’URL déployée**, avec de vrais téléphones et de vrais comptes de test (jamais un compte personnel ou professionnel public). Ne rien publier publiquement : utiliser une discussion privée, une Story visible par « Amis proches » ou un brouillon.

Rien n’a encore été exécuté : toutes les cases de résultat sont vides. Une case se remplit seulement après avoir réellement fait l’essai.

**Légende** : OK / KO / N.D. (non disponible sur ce téléphone ou ce compte) + remarque courte.

## Téléphones

| Code | Modèle | Système | Navigateur par défaut | Applications installées (versions) | Testeur | Date |
|---|---|---|---|---|---|---|
| T1 | | iOS | Safari | | | |
| T2 | | Android | Chrome | | | |
| T3 (entrée de gamme) | | Android | | | | |

## Préparation

1. Sur T1, créer une adresse de test (« Atelier test recette »), avec photo de porte et arrêt voiture distinct.
2. Créer un rendez-vous de test pour demain.
3. Créer une demande d’adresse de test.

## A. Diffusion par canal → parcours du destinataire

Pour chaque ligne, le téléphone **expéditeur** partage depuis la page de gestion ; le téléphone **destinataire** ouvre ce qu’il reçoit.

Colonnes :
1. Le partage s’ouvre (l’application cible s’ouvre ou propose l’envoi ; pour une copie, le lien se colle correctement).
2. Le lien reçu est cliquable et ouvre la fiche.
3. Photo de l’entrée visible.
4. « Itinéraire » ouvre Google Maps sur le bon point (arrêt puis entrée).
5. « Créer mon Fii La » ouvre une fiche vierge.
6. La nouvelle fiche se partage à nouveau.

| Canal | Expéditeur → Destinataire | 1. Partage s’ouvre | 2. Lien ouvre la fiche | 3. Photo | 4. Itinéraire | 5. Fiche vierge | 6. Repartage | Remarques |
|---|---|---|---|---|---|---|---|---|
| WhatsApp | T1 → T2 | | | | | | | |
| WhatsApp | T2 → T1 | | | | | | | |
| Telegram | T1 → T2 | | | | | | | |
| Telegram | T2 → T1 | | | | | | | |
| Facebook — « Facebook : copier le lien » puis collage dans une publication « Moi uniquement » (sans identifiant Meta) | T1 → T2 | | | | | | | |
| Facebook — idem, ou bouton « Facebook » (Share Dialog) si `FACEBOOK_APP_ID` est configuré | T2 → T1 | | | | | | | Préciser le mode |
| Instagram Story (sticker Lien, « Amis proches ») | T1 → T2 | | | | | | | |
| Instagram Story (QR code scanné) | T1 → T3 | | | | | | | |
| TikTok (champ « Site web » du profil, si disponible) | T2 → T1 | | | | | | | |
| TikTok (QR code scanné) | T2 → T3 | | | | | | | |
| Partage natif « Partager… » | T1 → T2 | | | | | | | Noter les applications proposées |
| Partage natif « Partager… » | T2 → T1 | | | | | | | Noter les applications proposées |
| Copier le lien + SMS | T3 → T1 | | | | | | | |

## B. Image verticale (Instagram / TikTok)

| Vérification | T1 | T2 | T3 | Remarques |
|---|---|---|---|---|
| « Télécharger l’image » enregistre bien un fichier (ou affiche la consigne « appui long ») | | | | |
| L’image s’ouvre dans la galerie, en 1080 × 1920 | | | | |
| Le QR code de l’image, scanné par un autre téléphone, ouvre la bonne fiche | | | | |
| « Partager l’image… » (si présent) propose Instagram ou TikTok | | | | |
| Sans « Inclure la photo », aucune photo dans l’image | | | | |
| Avec « Inclure la photo », la porte est entière et sans texte dessus | | | | |
| Instagram : le sticker « Lien » est disponible sur le compte de test | | — | — | |
| TikTok : le champ « Site web » existe dans « Modifier le profil » du compte de test | — | | — | |

## C. Aperçus dans les applications

| Vérification | WhatsApp | Telegram | Facebook | Remarques |
|---|---|---|---|---|
| L’aperçu du lien montre seulement « Fii La » et le texte générique, sans nom, photo ni lieu de la fiche | | | | |

## D. Désactivation et suppression

| Vérification | Résultat | Remarques |
|---|---|---|
| Après « Désactiver le lien », le lien déjà envoyé (WhatsApp, Telegram, Facebook, Story) affiche « Ce lien a été désactivé » | | |
| Après « Supprimer », le lien affiche « Lien introuvable » | | |
| Une image déjà téléchargée ou publiée reste visible (comportement attendu : elle ne peut pas être rappelée) | | |

## E. Conditions réelles

| Vérification | T1 | T2 | T3 | Remarques |
|---|---|---|---|---|
| Fiche destinataire en 3G ou réseau faible : temps d’affichage de la photo (secondes) | | | | |
| Lisibilité au soleil (fiche destinataire) | | | | |
| Thème sombre du téléphone : panneau de partage lisible | | | | |

## F. App Android (APK de test, 26/10)

Installer `fii-android-test.apk` (autoriser « sources inconnues » une fois). Données de test uniquement.

| # | Geste | Attendu | OK ? |
|---|---|---|---|
| F1 | Ouvrir l'app | Écran vert Fii puis l'accueil, sans barre d'adresse ; le haut et le bas ne passent pas sous l'encoche ni la barre de navigation | |
| F2 | Créer une boutique test, un article avec photo | Appareil photo demandé au moment de la photo ; photo enregistrée | |
| F3 | Marketing → logo Instagram sur un article | Feuille de partage Android avec l'image ; Instagram s'ouvre avec la photo | |
| F4 | Logo WhatsApp | WhatsApp avec l'image et le texte (lien `https://…/#/b/…`) | |
| F5 | Bouton retour du téléphone : sur une feuille, sur un écran, à l'accueil | Ferme la feuille ; écran précédent ; l'app passe en arrière-plan | |
| F6 | Fermer l'app (balayer), la rouvrir | La boutique est toujours là | |
| F7 | Mon adresse → « Utiliser ma position » ; repère vocal | Position demandée puis placée ; micro demandé puis enregistrement | |
| F8 | Itinéraire, Waze, lien d'un réseau | S'ouvre dans l'app concernée ; retour à Fii au même écran | |
| F9 | Modèle Premium verrouillé | Aperçu possible ; aucun bouton d'achat | |

## Bilan

| Point bloquant trouvé | Canal / téléphone | Gravité | Décision |
|---|---|---|---|
| | | | |
