# Fii La — Design system v1.1 (Light + Dark)

> Statut : **validé par le fondateur le 17/10/2026 comme référence de la refonte d'interface.** À appliquer par l'agent Builder, avec contrôle de l'agent VP.
> v1.1 (17/10/2026, soir) : intègre les fonctions ajoutées au code après les maquettes du 15/10 (§7).
> Maquettes : canvas privé du fondateur « Fii La — Refonte UI Light + Dark » (12 planches, dont « 12 · Nouveautés du 17/10 »). Ce dossier est la version exploitable par un agent : **ce sont ces fichiers qui font foi**, pas la mémoire des maquettes.

| Fichier | Rôle |
|---|---|
| `tokens.css` | Bloc de tokens à coller à la place des deux blocs `:root` de `web/styles.css` (Light, Dark, `data-theme`) |
| `tokens.json` | Mêmes valeurs, plus typographie, espacements, rayons, cibles, couples de contraste |
| `components.css` | Règles de composants écrites sur les classes **existantes** du code ; nouvelles classes marquées « NOUVEAU » |
| `check-contrast.mjs` | `node docs/design-system/check-contrast.mjs` : vérifie tous les couples dans les deux thèmes (code 1 si échec) |

---

## 1. Brief d'exécution (agent Builder)

**RÔLE** — Builder front-end de Fii La. Tu appliques un design system validé ; tu ne redessines pas.

**MISSION** — Appliquer le design system v1 à `web/` : tokens Light + Dark, 6 types de cartes, sélecteur de thème, corrections d'accessibilité. Résultat : même application, mêmes parcours, nouvelle apparence, deux thèmes complets.

**SOURCE OF TRUTH**
1. Ce dossier (`docs/design-system/`).
2. Pour tout ce qui n'y est pas décrit, le **comportement actuel du code** prévaut. Les fonctions ajoutées le 17/10 sont désormais spécifiées (§7).
3. Textes français : ceux de `web/app.js`, inchangés. Les propositions de formulation du §9 ne sont **pas** à intégrer sans accord du fondateur.

**CONSTRAINTS**
- Périmètre fonctionnel gelé (HANDOFF §3) : aucun nouvel écran, aucune nouvelle fonction. Le sélecteur de thème est la seule addition, demandée par le fondateur.
- CSP de `index.html` : `script-src 'self'` → **aucun script inline**. Le script anti-flash du thème va dans un fichier (`web/theme.js`), chargé dans `<head>` avant `styles.css`.
- `web/sw.js` : ajouter `theme.js` à `SHELL` et incrémenter `CACHE` (`fiila-shell-v2`).
- Aucune couleur en dur dans `styles.css` : uniquement des tokens. Exceptions documentées : SVG data-URI du repère `.map-pin` (carte toujours claire, mêmes valeurs que `--pin`/`--lime`), cercle de précision Leaflet `#1E4A34`, image d'export social (`C = {…}` dans `app.js`, image figée en Light — ne pas toucher).
- Performance fiche destinataire : pas de `backdrop-filter`, pas d'ombre autre que `--shadow-card` (Light), aucune image décorative.
- Mouvement réduit : conserver `@media (prefers-reduced-motion: no-preference)` pour les transitions ; squelettes statiques.

**WORKFLOW** — inspecter → plan court → appliquer par lots sûrs (ordre ci-dessous) → tests → captures Light/Dark → HANDOFF.
1. Tokens (`tokens.css`) + `npm run test:*` : rien ne doit casser.
2. Thème : `web/theme.js` + sélecteur en pied de page (§5).
3. Composants (`components.css`) : fusionner dans `styles.css` en remplaçant les règles de même sélecteur (ne pas empiler deux définitions).
4. Petites modifications de `app.js` (§4, colonne « à faire dans app.js ») : icônes de puces, pictogrammes d'étape, icônes d'état, `danger-fill`, `item.missing`, classe `wide` desktop, icône coche de `.saved-ok`, `aria-expanded` sur « Depuis Google Maps ».
5. Captures : régénérer `docs/screenshots/` en Light **et** Dark (les tests ont déjà des captures `-dark`).

**DELIVERABLES** — `web/styles.css`, `web/theme.js`, `web/index.html`, `web/sw.js`, `web/app.js` (modifs ciblées), captures, `docs/HANDOFF.md` à jour.

**ACCEPTANCE CRITERIA**
- `node docs/design-system/check-contrast.mjs` → 0 échec ; toutes les suites de tests vertes (local + production).
- Chaque écran listé en §6 est rendu dans les deux thèmes sans élément illisible ; QR toujours sur fond blanc ; tuiles OSM non filtrées en Dark.
- `grep -E '#[0-9A-Fa-f]{3,6}' web/styles.css` ne renvoie que les tokens et les exceptions listées.
- Sélecteur : Automatique par défaut ; Clair/Sombre persistent après rechargement ; aucun flash de mauvais thème au chargement ; fonctionne si `localStorage` est indisponible (navigation privée).
- Focus clavier visible partout (anneau `--focus`) ; aucune information portée par la seule couleur (puces avec icône + texte).
- Fiche destinataire : un livreur repère en < 3 s la photo, « 1. Arrêt voiture », « 2. Entrée ».

**FORBIDDEN**
- Modifier parcours, ordre des étapes, textes, logo, recadrage de la photo (4:3, entrée visible), texte ou voile sur la photo.
- Inverser les couleurs pour obtenir le Dark ; glassmorphism, dégradés, néon, emojis décoratifs, illustrations.
- Ajouter dépendance, framework CSS ou police.
- Traduire en wolof.

---

## 2. Tokens

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg` | `#F5F2EA` | `#0D1310` | Fond des écrans (Dark : vert-noir, jamais noir pur) |
| `--surface` | `#FFFFFF` | `#151D18` | Cartes (niveau 1) |
| `--surface-2` | `#F3F0E8` | `#1C2620` | Blocs dans une carte : étapes, lien, coordonnées — **nouveau** |
| `--surface-3` | `#E8E4D8` | `#25312A` | Appui, désactivé, squelette — **nouveau** |
| `--ink` | `#17201B` | `#EDF1EC` | Texte principal |
| `--muted` | `#545E58` | `#A4B0A8` | Texte secondaire |
| `--line` | `#E2DDD0` | `#2A352E` | Bordures décoratives |
| `--line-strong` | `#7F857E` | `#66756B` | Bordures de champs, contours porteurs de sens — **nouveau** |
| `--green` | `#1E4A34` | `#2E7D55` | Actions |
| `--green-press` | `#163828` | `#276B48` | Action appuyée (`--green-hover` devient un alias) — **nouveau** |
| `--on-green` | `#FFFFFF` | `#FFFFFF` | Texte sur `--green` |
| `--lime` / `--on-lime` | `#C9E265` / `#17201B` | idem | Accent rare : logo, pastilles d'étape, WhatsApp |
| `--soft` | `#E9EFE1` | `#1B2A21` | Encadrés, choix sélectionné, bloc Découverte |
| `--danger` / `--on-danger` | `#A3302A` / `#FFFFFF` | `#F08A80` / `#17201B` | Suppression, erreurs (`--on-danger` nouveau) |
| `--warn` / `--on-warn` | `#7A4F00` / `#FFFFFF` | `#E8B95E` / `#17201B` | En attente, hors connexion (`--on-warn` nouveau) |
| `--ok` | `#1E6B43` | `#7FCB9C` | Lien actif, point validé |
| `--link` | `#1E4A34` | `#C9E265` | Liens |
| `--focus` | `#1E4A34` | `#C9E265` | Anneau de focus — **nouveau** |
| `--shadow-card` | ombre douce (voir `tokens.css`) | `none` | Élévation : en Dark, la hiérarchie passe par les surfaces et `--line` |
| `--radius-card` | `20px` | `20px` | Rayon des cartes |
| `--map`, `--pin`, `--qr-bg`, `--qr-ink` | fixes | fixes | Carte OSM et QR restent clairs dans les deux thèmes |

## 3. Typographie, espacements, cibles

Montserrat 400 / 600 / 800 (fichiers déjà dans `web/fonts/`).

| Rôle | Taille / graisse / interligne |
|---|---|
| Titre d'écran (h1) | 28 / 800 / 1.15, -0.02em |
| Nom de la fiche | 26 / 800 / 1.15 (32 en desktop) |
| Section (h2) | 22 / 800 / 1.2 |
| Titre d'étape | 18 / 800 / 1.3 |
| Repère, bouton principal | 18 / 600 / 1.45 |
| Corps, bouton | 16 / 400–600 / 1.5 |
| Libellé | 14 / 600 |
| Aide, pied de page | 13 / 400 / 1.45 (minimum pour un texte utile) |
| Surtitre | 12 / 600, majuscules, 0.08em |
| Coordonnées | 15, mono, chiffres tabulaires |

Espacements : 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48. Gouttière 16 px (390), 48 px (1 280). Intérieur carte 20, bloc 16.
Rayons : champ 12 · bouton 14 · bloc/élément de liste 16 · carte 20 · puce 999.
Cibles : 44 min · bouton 52 · bouton principal 64 · élément de liste 72.

## 4. Les 6 cartes

| Carte | Rôle | Classes | Variantes | À faire dans `app.js` |
|---|---|---|---|---|
| 1. Fiche | Ce que voit le destinataire. Photo 4:3 pleine largeur en tête, la plus visible | `.fiche`, `.fiche-body`, `.instr` | Avec photo · sans photo (`.card`) · chargement (squelette) · nom long (retour à la ligne, jamais tronqué) | Ajouter `wide` sur `.wrap` et `.fiche` pour la vue destinataire (2 colonnes ≥ 960 px) |
| 2. Étape | Ordre de déplacement : « 1. Arrêt voiture » puis « 2. Entrée ». Bloc `--surface-2` **dans** la fiche, sans bordure | `.leg`, `.leg-h`, `.leg-n` | Repos · appui (bouton `--green-press`) · focus · étape unique non numérotée | Ajouter `.leg-ico` (pictogramme voiture pour 1, porte pour 2, `aria-hidden`) ; boutons Itinéraire en 64 px |
| 3. Partage | Lien, mention de confidentialité, « Partager… » natif (plein), WhatsApp (seul accent citron), copie, autres applications, panneau Instagram / TikTok ; QR dans **sa propre carte** | `.card` + `.sharelink`, `.privacy-note`, `.btn.lime`, `.chan-grid`, `.visual-box`, `.qr` | Repos · focus · canal ouvert (`aria-expanded`) · lien désactivé · partage indisponible | Icône coche devant `.saved-ok` |
| 4. Élément de liste | Mes adresses / demandes / rendez-vous | `.item`, `.chip` | Repos · appui · focus · lien désactivé · erreur « Fiche introuvable » | Icône SVG dans chaque `.chip` (coche ok, interdit off, horloge wait) ; classe `missing` sur l'élément introuvable ; chevron à droite |
| 5. État | Lien désactivé, remplacé, expiré, introuvable, erreur | `.card.state` | Neutre · erreur (`.state.error`) | Remplacer les glyphes `⦸ ⌛ ? !` de `stateCard()` par des SVG trait 26 px (interdit, lien, sablier, point d'interrogation, alerte) ; ajouter `error` pour les cas `!` |
| 6. Confirmation destructive | Suppression définitive, en place (pas de fenêtre modale) | `.confirm` | Repos · focus · erreur (`.alert` dedans) | « Supprimer définitivement » : `btn danger-fill` |

Tout ne doit pas être une carte : texte courant, aides et titres restent sur le fond.

## 5. Thème : implémentation

- `web/theme.js` (chargé dans `<head>`, avant `styles.css`, sans `defer`) :
  ```js
  (function(){try{var t=localStorage.getItem('fiila-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
  ```
- Sélecteur en pied de page, dans `footer()` de `app.js` : `fieldset.theme-switch` > `legend` « Thème » > `.segs` > 3 `label` + `input type=radio name=theme` : « Clair », « Sombre », « Automatique » (défaut). Le choix « Automatique » retire l'attribut et la clé `localStorage` (try/catch partout).
- `<meta name="theme-color">` : mettre à jour à `--bg` du thème actif (deux balises avec `media="(prefers-color-scheme: …)"` + mise à jour JS si thème forcé).
- `color-scheme` est déjà porté par les tokens (contrôles natifs, barres de défilement).

## 6. Passation écran par écran

| Écran | Ce qui change |
|---|---|
| Fiche destinataire | Une seule carte ; étapes en blocs `--surface-2` ; pastille 32 px + titre 18/800 + pictogramme ; Itinéraire 64 px (+ « Ouvrir dans Plans » compact sur iPhone) ; coordonnées repliées ; bloc Découverte après la fiche ; desktop 2 colonnes (photo à gauche) |
| Accueil | « Créer mon adresse » seul en 64 px ; « Mes adresses » et « Demander une adresse » en tuiles secondaires avec pictogramme ; « Créer un rendez-vous » pleine largeur ; listes en cartes élément de liste ; desktop 2 colonnes (actions à gauche, listes en grille de 2) |
| Création (4 étapes) | Étape 1 : « Utiliser ma position » / « Depuis Google Maps », aide position refusée (§7). Barre d'étapes 6 px (le texte « Étape N sur 4 » porte l'info) ; champs bordés `--line-strong` ; Oui/Non avec pastille radio + fond `--soft` ; point validé = bordure pleine + coche ; « Continuer » 64 px ; bouton désactivé `--surface-3` (plus d'opacité) |
| Gestion | Confirmation « Enregistré… » persistante ; carte partage (voir §7) ; QR dans sa carte ; installation facultative ; actions en grille 2 colonnes avec pictogrammes ; « Supprimer » contour danger ; confirmation en carte destructive |
| Demande d'adresse | Statut en puce avec icône sous le titre ; vue client : carte d'en-tête + choix radio + aperçu en carte fiche sans photo |
| Rendez-vous | Même carte fiche, surtitre « Rendez-vous » + date ; « Prendre ou choisir une photo » en bouton secondaire (ne concurrence pas « Créer le rendez-vous ») |
| États | Carte état unique ; bandeau hors connexion `--warn`/`--on-warn` ; squelette statique ; liste vide en carte à bordure tiretée |

## 7. Fonctions ajoutées le 17/10 (spécifiées en v1.1)

Planches de référence : « 03 · Fiche », « 08 · Gestion », « 12 · Nouveautés du 17/10 ». Règles CSS : fin de `components.css`.

| Fonction (code) | Spécification |
|---|---|
| Coordonnées repliées (`.coords-more`) | Sous chaque itinéraire, dans le bloc étape ; summary 44 px, 13/600 `--muted`, chevron qui pivote à l'ouverture ; replié par défaut |
| « Ouvrir dans Plans » (iPhone) | `.btn.ghost.small` (44 px) sous le bouton Itinéraire, jamais au même niveau |
| Bloc Découverte (`.discover`) | Après la fiche ; fond `--soft`, rayon 16, aucune ombre ni bordure ; titre 18/800 ; bouton secondaire sur `--surface` ; aide 13 px (au lieu de 12,5) |
| Confirmation après enregistrement (`.saved-ok`) | `--ok`, 14/600, précédée d'une icône coche, sous le titre |
| Mention de confidentialité (`.privacy-note`) | Encadré `--soft` rayon 12, texte 13 px `--ink` ; **plus de bordure gauche** |
| « Partager… » natif | Bouton plein `--green` ; WhatsApp reste l'unique accent citron |
| Autres applications (`.chan-grid`, `.chan`) | Grille 2 colonnes (1 sous 340 px), boutons secondaires 48 px, icône `--muted` ; canal ouvert = bordure 2 px `--green` + fond `--soft` |
| Panneau Instagram / TikTok (`.visual-box`) | Séparé par `--line` ; options en cases à cocher 56 px (cochée = bordure 2 px `--green`) ; aperçu cadré `--line` ; « Télécharger l'image » plein, « Copier le lien » secondaire |
| Image d'export social (canvas, constante `C`) | **Figée en Light dans les deux thèmes** (c'est un fichier publié) ; valeurs dans `tokens.json` › `export` ; ne pas thématiser |
| QR code | Dans sa propre carte, sous la carte Partager ; `--qr-bg` blanc dans les deux thèmes |
| Installation facultative (`.install`) | Bloc tireté `--line-strong` 1,5 px, rayon 16 ; « Installer Fii La » secondaire compact + « Plus tard » en lien |
| Position refusée | Message `.msg.err` en `--danger` avec icône alerte ; aide pas à pas dans un `.notice` (liste numérotée 14 px) ; « Réessayer » plein + « Prendre le point dans Google Maps » secondaire |
| Depuis Google Maps (`.gm-panel`) | Bouton déclencheur ouvert = bordure 2 px `--green` + fond `--soft` (**ajouter `aria-expanded` dans `app.js`**) ; panneau `--surface-2` rayon 16 sans bordure ; « Coller le lien » plein, « Ouvrir Google Maps » secondaire ; « Placer ce point » secondaire compact |
| « Créer un rendez-vous similaire » | Bouton secondaire pleine largeur, au-dessus de la grille d'actions de gestion |

## 8. Contrastes (WCAG 2.2)

Tous les couples atteignent au moins AA dans les deux thèmes. Valeurs recalculées par `check-contrast.mjs`.

| Couple | Light | Dark | Seuil |
|---|---|---|---|
| ink / bg | 14,91 | 16,46 | 4,5 |
| muted / surface | 6,73 | 7,66 | 4,5 |
| muted / surface-3 (désactivé) | 5,30 | 6,03 | 4,5 |
| on-green / green | 10,08 | 5,02 | 4,5 |
| on-lime / lime | 11,56 | 11,56 | 4,5 |
| on-danger / danger | 6,97 | 6,87 | 4,5 |
| on-warn / warn | 7,13 | 9,16 | 4,5 |
| ok / bg | 5,79 | 9,77 | 4,5 |
| focus / bg | 9,01 | 13,02 | 3 (UI) |
| line-strong / bg | 3,38 | 3,87 | 3 (UI) |
| qr-ink / qr-bg | 16,68 | 16,68 | 4,5 |

Corrections par rapport à l'existant : anneau de focus citron sur fond clair (1,3:1) ; bordures de champs `--line` (< 3:1) ; boutons désactivés en `opacity:.5` ; bandeau hors connexion `#fff` sur `--warn` clair en Dark ; aide du bloc Découverte à 12,5 px.

## 9. Propositions de formulation (non intégrées — décision fondateur)

- Fiche : intitulé « Repère » au-dessus du texte du repère.
- « Itinéraire à pied (Google Maps) » → « À pied jusqu'à l'entrée », mention Google Maps sous le bouton.
- Accueil vide : « Aucune adresse sur ce téléphone. » → « Pas encore d'adresse sur ce téléphone. »
- « Lien introuvable » et « Lien non valide » : même titre côté destinataire.
