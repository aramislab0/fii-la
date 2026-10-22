/* Fii — application web (sans framework, sans étape de build).
   Toutes les données passent par les fonctions RPC Supabase `fiila_*`.
   Aucun contenu saisi n'est injecté en HTML : tout passe par textContent. */
(function () {
  'use strict';

  var CFG = window.FIILA_CONFIG || {};
  var API_URL = (CFG.supabaseUrl || '').replace(/\/$/, '');
  var API_KEY = CFG.supabaseKey || '';
  var app = document.getElementById('app');

  /* ================================================================ outils DOM */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function setKids(el) {
    el.replaceChildren();
    for (var i = 1; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function page() {
    var w = h('div', { class: 'wrap' });
    for (var i = 0; i < arguments.length; i++) add(w, arguments[i]);
    return w;
  }
  function backBtn(label, href) {
    return h('a', { class: 'btn back', href: href || '#/' }, '← ' + (label || 'Accueil'));
  }
  // Pied de page : complet sur les écrans de gestion ; réduit sur les pages reçues par lien.
  function footer(minimal) {
    if (minimal) return h('footer', { class: 'foot foot-min' },
      h('div', { class: 'foot-links' }, h('a', { href: '#/', class: 'foot-brand' }, 'Fii'), h('a', { href: '#/confidentialite' }, 'Données et confidentialité')));
    return h('footer', { class: 'foot' },
      h('div', { class: 'foot-links' },
        h('a', { href: '#/' }, 'Fii'),
        h('a', { href: '#/compte', id: 'foot-account' }, authed() ? 'Mon compte' : 'Se connecter'),
        h('a', { href: '#/livreur', id: 'foot-courier' }, 'Espace livreur'),
        h('a', { href: '#/confidentialite' }, 'Données et confidentialité'),
        h('a', { href: '#/cle' }, 'Restaurer une clé de gestion')));
  }
  // Thème : toujours celui du téléphone (clair ou sombre), sans réglage dans l'application (fondateur, 20/10).
  // En-tête discret des pages reçues par lien : de quoi il s'agit, en un coup d'œil.
  // Logo Fii (validé par le fondateur le 21/10/2026, docs/brand/) : sans fond, posé sur l'écran ; épingle lime, lettres
  // vertes sur fond clair, ivoires sur fond sombre ou vert (deux masques colorés en CSS). size : '' | 'small' | 'tiny'.
  function brandLogo(size, label) {
    var named = label == null || label !== '';
    return h('span', { class: 'logo' + (size ? ' ' + size : ''), role: named ? 'img' : null, 'aria-label': named ? (label || 'Fii') : null, 'aria-hidden': named ? null : 'true' });
  }
  function brandBar(kind) {
    return h('div', { class: 'brand-bar' }, brandLogo('small'), kind ? h('span', { class: 'brand-kind' }, kind) : null);
  }
  var STATE_ICONS = { '?': 'help', '!': 'alert', '⦸': 'ban', '⌛': 'hourglass', '✓': 'check' };
  function stateCard(glyph, title, text, extra) {
    return h('div', { class: 'card state' + (glyph === '!' ? ' error' : '') },
      h('div', { class: 'big', 'aria-hidden': 'true' }, icon(STATE_ICONS[glyph] || 'help', 26)),
      h('h2', null, title), text ? h('p', { class: 'muted' }, text) : null, extra || null);
  }
  /* Feuille du bas commune (audit 19/10) : Échap ferme, le focus entre dans la feuille et y reste (Tab), puis revient sur
     l'élément qui l'a ouverte ; fermée aussi en changeant d'écran. Renvoie la fonction de fermeture. */
  function openSheet(back, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    function focusables() {
      return Array.prototype.slice.call(back.querySelectorAll('button:not([disabled]),a[href],input:not([type=hidden]):not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'))
        .filter(function (x) { return x.offsetParent !== null || x === document.activeElement; });
    }
    function key(e) {
      if (!back.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!back.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function close() {
      if (!back.isConnected) return;
      back.remove(); document.removeEventListener('keydown', key, true);
      if (prev && prev.focus && prev.isConnected) { try { prev.focus({ preventScroll: true }); } catch (e) { /* rien */ } }
      if (opts.onClose) opts.onClose();
    }
    document.addEventListener('keydown', key, true);
    document.body.append(back);
    onMedia(close);
    setTimeout(function () { var t = back.querySelector('[data-autofocus]') || focusables()[0]; if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* rien */ } } }, 0);
    return close;
  }
  function loading(text) { return h('p', { class: 'loading', role: 'status' }, text || 'Chargement…'); }

  /* ================================================================ format & liens */
  function fmt(p) { return Number(p.lat).toFixed(6) + ', ' + Number(p.lng).toFixed(6); }
  function gmDir(p, mode) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + Number(p.lat).toFixed(6) + '%2C' + Number(p.lng).toFixed(6) + '&travelmode=' + (mode || 'driving');
  }
  /* Plateforme. Sur iPhone, un lien https vers Google Maps passe souvent par une page « Ouvrir l'app »
     puis l'App Store, et l'application s'ouvre sans la destination. Le schéma officiel comgooglemaps://
     ouvre directement l'application installée avec la destination ; Plans (Apple) sert de repli. */
  var UA = navigator.userAgent || '';
  var IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var IS_ANDROID = /Android/.test(UA);
  // Navigateurs intégrés d'applications (Facebook, Instagram, TikTok, Snapchat, LINE, appli Google, WebView Android) :
  // ils n'ont souvent pas accès à la position, faute d'autorisation de l'application hôte.
  var IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|musical_ly|TikTok|BytedanceWebview|GSA\/|; wv\)/.test(UA);
  function ll(p) { return Number(p.lat).toFixed(6) + ',' + Number(p.lng).toFixed(6); }
  function iosGmDir(p, mode) { return 'comgooglemaps://?daddr=' + ll(p) + '&directionsmode=' + (mode || 'driving'); }
  function wazeDir(p) { return 'https://waze.com/ul?ll=' + ll(p) + '&navigate=yes'; }
  function appleDir(p, mode) { return 'https://maps.apple.com/?daddr=' + ll(p) + '&dirflg=' + (mode === 'walking' ? 'w' : 'd'); }
  function gmOpenApp() {
    return IS_IOS ? 'comgooglemaps://?center=14.7167,-17.4677&zoom=14' : 'https://www.google.com/maps/@14.7167,-17.4677,14z';
  }
  var SHORT_MAPS = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[^\s"'<>]+/i;
  function resolveMapsLink(url) {
    if (!API_URL) return Promise.reject(new ApiError('not_configured'));
    return fetch(API_URL + '/functions/v1/fiila-resolve-maps', {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify({ url: url }), cache: 'no-store', credentials: 'omit'
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (b) {
        if (res.ok && b && isFinite(b.lat) && isFinite(b.lng)) return { lat: +b.lat, lng: +b.lng };
        throw new ApiError((b && b.error) || 'server');
      });
    }, function () { throw new ApiError('network'); });
  }
  function baseUrl() { return CFG.publicUrl ? CFG.publicUrl.replace(/\/?$/, '/') : location.origin + location.pathname; }
  function shareUrl(token) { return baseUrl() + '#/a/' + token; }
  function requestUrl(token) { return baseUrl() + '#/d/' + token; }
  function keyUrl(type, id, owner) { return baseUrl() + '#/k/' + (type === 'request' ? 'r' : 'p') + '.' + id + '.' + owner; }
  function waLink(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }
  var DAKAR = 'Africa/Dakar';
  function whenText(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: DAKAR }) + ' à ' +
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: DAKAR }) + ' (heure de Dakar)';
  }
  function shortDate(iso) {
    return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: DAKAR });
  }

  /* ================================================================ stockage local */
  var LS = {
    get: function (k, d) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* rien */ } }
  };
  var owned = {
    all: function () { return LS.get('fiila.owned', []); },
    find: function (type, id) { return owned.all().filter(function (r) { return r.type === type && r.id === id; })[0] || null; },
    put: function (rec) {
      var list = owned.all().filter(function (r) { return !(r.type === rec.type && r.id === rec.id); });
      list.unshift(rec);
      return LS.set('fiila.owned', list);
    },
    patch: function (type, id, fields) {
      var list = owned.all().map(function (r) { return r.type === type && r.id === id ? Object.assign({}, r, fields) : r; });
      LS.set('fiila.owned', list);
    },
    remove: function (type, id) { LS.set('fiila.owned', owned.all().filter(function (r) { return !(r.type === type && r.id === id); })); },
    // Fiche gérable ici : clé de ce téléphone, ou compte connecté (le serveur vérifie, owner = null).
    get: function (type, id) {
      var r = owned.find(type, id);
      if (r) return r;
      return authed() ? { type: type, id: id, owner: null, account: true } : null;
    },
    // Mise à jour qui crée l'entrée locale si la fiche n'est connue que par le compte.
    upsert: function (type, id, fields) {
      var r = owned.find(type, id);
      if (r) owned.patch(type, id, fields);
      else owned.put(Object.assign({ type: type, id: id, owner: null, created: Date.now() }, fields));
    }
  };

  /* ================================================================ API */
  var ERRORS = {
    network: 'Connexion impossible. Vérifiez votre réseau puis réessayez. Vos saisies sont conservées.',
    timeout: 'Le serveur met trop de temps à répondre. Réessayez. Vos saisies sont conservées.',
    server: 'Le service a rencontré un problème. Réessayez dans un instant.',
    not_configured: 'Le service n’est pas configuré.',
    not_found: 'Fiche introuvable, ou clé de gestion non valide sur cet appareil.',
    rate_limited: 'Trop de créations depuis cette connexion. Réessayez dans une heure.',
    label_required: 'Donnez un nom au lieu.',
    photo_or_instruction_required: 'Ajoutez une photo de l’entrée ou un repère.',
    point_required: 'Choisissez le point de l’entrée.',
    point_invalid: 'Ce point n’est pas valide. Replacez-le sur la carte.',
    invalid_number: 'Coordonnées non valides.',
    stop_required: 'Choisissez le point d’arrêt de la voiture.',
    too_long: 'Un des textes est trop long.',
    photo_too_large: 'La photo est trop lourde. Choisissez-en une autre.',
    photo_invalid: 'Ce fichier n’est pas une photo valide (JPEG, PNG ou WebP).',
    photo_metadata: 'La photo contient encore des métadonnées. Réessayez de l’ajouter.',
    date_required: 'Indiquez la date et l’heure.',
    expiry_before_start: 'La fin doit être après le début.',
    expiry_in_past: 'Cette date est déjà passée.',
    expiry_too_far: 'Un événement peut rester visible 31 jours au plus.',
    start_too_far: 'La date est trop lointaine.',
    invalid_date: 'Date non valide.',
    name_required: 'Indiquez votre nom ou celui de votre commerce.',
    purpose_required: 'Indiquez pourquoi vous demandez l’adresse.',
    already_fulfilled: 'Cette demande a déjà reçu une réponse.',
    expired: 'Cette demande a expiré.',
    place_revoked: 'Cette adresse est désactivée. Choisissez-en une autre.',
    not_an_address: 'Choisissez une adresse, pas un événement.',
    invalid_kind: 'Type de fiche non valide.',
    invalid_payload: 'Données non valides.',
    invalid_theme: 'Modèle ou couleur non reconnu. Choisissez dans la liste.',
    invalid_social: 'Identifiant non reconnu. Écrivez seulement le nom du compte, par exemple : maboutique.',
    invalid_category: 'Catégorie non reconnue. Choisissez dans la liste.',
    invalid_business_type: 'Type de commerce non reconnu. Choisissez dans la liste.',
    charter_required: 'Acceptez la charte de l’agent pour continuer.',
    phone_taken: 'Ce numéro est déjà inscrit comme agent.',
    invalid_payout: 'Choisissez Wave ou Orange Money.',
    quiz_done: 'Le test est déjà réussi.',
    quiz_wait: 'Deux essais par jour : réessayez demain.',
    quiz_incomplete: 'Répondez aux 10 questions.',
    ambassador_unknown: 'Code agent inconnu ou pas encore actif.',
    invite_not_found: 'Invitation introuvable. Vérifiez que le lien a été copié en entier.',
    invite_used: 'Cette invitation a déjà été acceptée par une autre boutique.',
    invite_revoked: 'Cette invitation a été retirée par Fii.',
    invite_expired: 'Cette invitation a expiré. Demandez un nouveau lien à Fii.',
    invite_other_shop: 'Cette invitation est réservée à une autre boutique. Ouvrez le lien sur le téléphone qui gère la boutique invitée.',
    trial_already: 'Cette boutique a déjà eu un essai Ambassadeur.',
    trial_none: 'Aucun essai pour cette boutique.',
    trial_not_ready: 'L’essai ne peut pas être activé dans son état actuel.',
    pack_blocked_dependency: 'Le pack n’est pas encore disponible : un service qu’il inclut n’est pas prêt. Fii vous prévient dès qu’il l’est.',
    pack_not_ready: 'Le pack n’est pas encore prêt.',
    pack_none: 'Aucun pack défini. Créez d’abord une version du pack.',
    pack_benefits_required: 'Indiquez au moins un avantage du pack.',
    brand_required: 'Indiquez le nom de la marque.',
    message_required: 'Écrivez votre message.',
    ambassador_already: 'Cette boutique a déjà un agent.',
    ambassador_too_late: 'Le code agent se tape dans les 7 jours qui suivent la création de la boutique.',
    ambassador_self: 'Un agent ne peut pas être accompagné par lui-même.',
    ambassador_cap: 'Cet agent a atteint son nombre de commerçants pour ce mois.',
    invalid_state: 'Action impossible dans cet état.',
    ambassador_has_payouts: 'Cet agent a déjà reçu un versement : la trace doit rester. Excluez-le plutôt.',
    reason_required: 'Indiquez un motif.',
    vd_photo_rule: 'Confirmez qu’aucune personne n’est reconnaissable sur la photo.',
    vd_photo_required: 'Ajoutez une photo de l’article.',
    vd_category_required: 'Choisissez la catégorie de l’article.',
    vd_gender_required: 'Choisissez fille, garçon ou mixte.',
    vd_age_required: 'Choisissez la tranche d’âge.',
    vd_condition_required: 'Indiquez l’état de l’article.',
    vd_blocked: 'Plusieurs articles ont été refusés récemment : réessayez dans quelques semaines.',
    business_type_required: 'Choisissez votre type de commerce.',
    invalid_stock: 'Stock : indiquez un nombre (0 ou plus), ou laissez vide.',
    size_required: 'Choisissez votre taille ou pointure.',
    color_required: 'Choisissez une couleur.',
    out_of_stock: 'Un article n’est plus disponible en quantité suffisante. Modifiez la commande.',
    invalid_phone: 'Numéro non reconnu. Exemple : 77 123 45 67.',
    invalid_event: 'Action non reconnue.',
    not_a_meeting: 'Ce lien n’est pas un événement.',
    // comptes
    auth_required: 'Connectez-vous pour continuer.',
    session_expired: 'Votre session a expiré. Reconnectez-vous.',
    invalid_credentials: 'E-mail ou mot de passe incorrect.',
    user_already_exists: 'Un compte existe déjà avec cet e-mail. Connectez-vous.',
    email_exists: 'Un compte existe déjà avec cet e-mail. Connectez-vous.',
    weak_password: 'Mot de passe trop court : 8 caractères au moins.',
    same_password: 'Choisissez un mot de passe différent de l’actuel.',
    email_address_invalid: 'Cette adresse e-mail n’est pas valide.',
    validation_failed: 'Vérifiez l’e-mail et le mot de passe.',
    email_not_confirmed: 'Confirmez d’abord votre e-mail : ouvrez le lien reçu par e-mail.',
    over_email_send_rate_limit: 'Trop d’e-mails envoyés. Réessayez dans une heure.',
    over_request_rate_limit: 'Trop de tentatives. Réessayez dans quelques minutes.',
    signup_disabled: 'Les inscriptions sont fermées pour le moment.',
    phone_invalid: 'Numéro de téléphone non valide.',
    invalid_tag: 'Étiquette non valide.',
    // boutique
    shop_required: 'Créez d’abord votre boutique.',
    shop_name_required: 'Donnez un nom à votre boutique.',
    photo_ratio: 'Photo hors format : rechargez l’application, elle recadre les photos au format des cartes (4:5).',
    shop_admin_only: 'Réservé au propriétaire et aux administrateurs de la boutique.',
    shop_owner_only: 'Seul le propriétaire peut faire cela.',
    team_full: 'L’équipe compte déjà 10 personnes (invitations comprises).',
    invalid_role: 'Choisissez un rôle.',
    already_member: 'Vous faites déjà partie de cette boutique.',
    phone_verify_required: 'Confirmez d’abord ce numéro avec le code reçu par SMS.',
    phone_mismatch: 'Le numéro confirmé sur votre compte n’est pas celui qui a reçu l’invitation.',
    phone_exists: 'Ce numéro est déjà confirmé sur un autre compte.',
    otp_expired: 'Code incorrect ou expiré. Demandez un nouveau code.',
    sms_send_failed: 'L’envoi du SMS a échoué. Réessayez dans un instant.',
    over_sms_send_rate_limit: 'Trop de codes demandés. Réessayez plus tard.',
    phone_provider_disabled: 'La vérification par SMS n’est pas encore activée.',
    has_shop: 'Ce compte a déjà une boutique : utilisez un autre compte pour rejoindre celle-ci.',
    customer_name_required: 'Indiquez le nom du client.',
    your_name_required: 'Indiquez votre nom.',
    phone_required: 'Indiquez votre numéro WhatsApp.',
    voice_invalid: 'Enregistrement non reconnu. Réessayez.',
    voice_too_large: 'Enregistrement trop long (30 secondes au plus).',
    slug_unavailable: 'Nom de vitrine indisponible. Réessayez.',
    customer_not_found: 'Client introuvable.',
    order_not_found: 'Commande introuvable.',
    items_required: 'Ajoutez au moins un article.',
    item_label_required: 'Chaque article doit avoir un nom.',
    invalid_qty: 'Quantité non valide.',
    invalid_price: 'Montant non valide.',
    invalid_method: 'Moyen de paiement non valide.',
    invalid_status: 'Statut non valide.',
    not_fulfilled: 'Le client n’a pas encore donné son adresse.',
    order_closed: 'Cette commande est clôturée.',
    address_already: 'L’adresse est déjà reçue ou demandée.',
    payment_not_found: 'Paiement introuvable.',
    too_many: 'Limite atteinte.',
    product_not_found: 'Article introuvable.',
    not_delivered: 'Vous pourrez noter vos articles une fois la commande livrée.',
    invalid_rating: 'Note non valide.',
    courier_required: 'Espace livreur introuvable sur ce téléphone.',
    invalid_vehicle: 'Moyen de livraison non valide.',
    already_used: 'Cette invitation a déjà été acceptée.',
    no_courier: 'Aucun livreur attitré disponible.',
    reauth_required: 'Saisissez à nouveau votre mot de passe.',
    not_allowed: 'Action non autorisée.',
    comment_contact: 'Pas de lien ni de numéro dans un commentaire : la commande se fait sur Fii.',
    comment_too_long: 'Commentaire trop long (300 caractères au plus).',
    comment_empty: 'Écrivez votre commentaire.',
    name_required: 'Ajoutez votre prénom dans votre compte pour commenter.',
    device_required: 'Action impossible sur ce navigateur. Réessayez.',
    invalid_value: 'Valeur hors des limites autorisées.',
    invalid_setting: 'Réglage inconnu.',
    reason_required: 'Indiquez un motif.',
    shop_suspended: 'Votre boutique est suspendue par l’équipe Fii. Contactez-nous pour la réactiver.',
    invite_invalid: 'Invitation expirée, annulée ou déjà utilisée.',
    invite_email_mismatch: 'Cette invitation a été créée pour une autre adresse e-mail.',
    already_staff: 'Cette personne fait déjà partie de l’équipe.',
    not_self: 'Vous ne pouvez pas modifier votre propre rôle.',
    last_super_admin: 'Il faut garder au moins un super admin.',
    invalid_role: 'Rôle non valide.',
    email_invalid: 'Adresse e-mail non valide.',
    email_unconfirmed: 'Confirmez d’abord votre adresse e-mail (lien reçu par e-mail), puis rouvrez l’invitation.',
    mfa_required: 'Saisissez le code de votre application d’authentification.',
    mfa_verification_failed: 'Code incorrect. Vérifiez qu’il est à jour (il change toutes les 30 secondes) et que l’heure du téléphone est automatique.',
    mfa_challenge_expired: 'Code expiré. Saisissez le nouveau code affiché.',
    insufficient_aal: 'Saisissez d’abord le code de votre application d’authentification.',
    payout_pending: 'Un versement vous est encore dû. Contactez Fii pour le recevoir avant de supprimer votre compte.'
  };
  function ApiError(code) { this.code = code; this.message = ERRORS[code] || ERRORS.server; }
  ApiError.prototype = Object.create(Error.prototype);
  function errText(e) { return (e && e.message) || ERRORS.server; }

  function apiHeaders() {
    var headers = { 'Content-Type': 'application/json', apikey: API_KEY, Accept: 'application/json' };
    if (SESSION && SESSION.access_token) headers.Authorization = 'Bearer ' + SESSION.access_token;
    else if (/^eyJ/.test(API_KEY)) headers.Authorization = 'Bearer ' + API_KEY;
    return headers;
  }

  /* ================================================================ COMPTE (Supabase Auth, sans bibliothèque)
     Le compte est facultatif. Connecté, chaque appel porte le jeton d'accès : le serveur reconnaît
     alors les fiches du compte (auth.uid()) en plus des clés de gestion du téléphone. */
  var SESSION_KEY = 'fiila.session';
  var SESSION = LS.get(SESSION_KEY, null);
  var ME = null; // profil chargé : { email, display_name, avatar, shop }
  function authed() { return !!(SESSION && SESSION.access_token); }
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function saveSession(s) {
    if (!s || !s.access_token) { SESSION = null; ME = null; LS.del(SESSION_KEY); return null; }
    SESSION = { access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at || (nowSec() + (s.expires_in || 3600)),
      user: s.user ? { id: s.user.id, email: s.user.email } : (SESSION && SESSION.user) || null };
    LS.set(SESSION_KEY, SESSION);
    return SESSION;
  }
  function authCall(path, method, body, withToken) {
    if (!API_URL) return Promise.reject(new ApiError('not_configured'));
    if (navigator.onLine === false) return Promise.reject(new ApiError('network'));
    var headers = { 'Content-Type': 'application/json', apikey: API_KEY };
    if (withToken && SESSION) headers.Authorization = 'Bearer ' + SESSION.access_token;
    return fetch(API_URL + '/auth/v1' + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit'
    }).then(function (res) {
      return res.text().then(function (txt) {
        var b = null;
        try { b = txt ? JSON.parse(txt) : null; } catch (e) { b = null; }
        if (res.ok) return b;
        var code = (b && (b.error_code || b.code || b.error)) || 'server';
        if (code === 'invalid_grant' && /confirm/i.test((b && (b.error_description || b.msg)) || '')) code = 'email_not_confirmed';
        if (code === 'invalid_grant') code = 'invalid_credentials';
        if (res.status === 429) code = 'over_request_rate_limit';
        throw new ApiError(typeof code === 'string' ? code : 'server');
      });
    }, function () { throw new ApiError('network'); });
  }
  var refreshing = null;
  function refreshSession() {
    if (!SESSION || !SESSION.refresh_token) return Promise.reject(new ApiError('session_expired'));
    if (refreshing) return refreshing;
    refreshing = authCall('/token?grant_type=refresh_token', 'POST', { refresh_token: SESSION.refresh_token }).then(function (s) {
      refreshing = null; saveSession(s); return s;
    }, function (e) {
      refreshing = null;
      if (e.code !== 'network' && e.code !== 'timeout') { saveSession(null); throw new ApiError('session_expired'); }
      throw e;
    });
    return refreshing;
  }
  function freshToken() {
    if (!SESSION || SESSION.expires_at - 60 > nowSec()) return Promise.resolve();
    return refreshSession().then(function () {}, function () {});
  }
  // Ce que ce téléphone pourrait rattacher au compte : fiches dont il a la clé, boutique non rattachée.
  // Jamais automatique : l'utilisateur confirme (audit S1, un lien piégé ne doit rien pouvoir rattacher).
  function pendingClaims() {
    var items = owned.all().filter(function (r) { return r.owner && !r.claimed; });
    var sk = LS.get('fiila.shop', null);
    return { items: items, shop: sk && sk.key && !sk.linked ? sk : null, count: items.length + (sk && sk.key && !sk.linked ? 1 : 0) };
  }
  function claimNow() {
    var pc = pendingClaims();
    var items = pc.items.map(function (r) { return { type: r.type, id: r.id, owner: r.owner }; });
    return (items.length ? api('fiila_claim', { p_items: items.slice(0, 200) }) : Promise.resolve({ claimed: 0 })).then(function (c) {
      LS.set('fiila.owned', owned.all().map(function (r) { return r.owner ? Object.assign({}, r, { claimed: true }) : r; }));
      return pc.shop ? api('fiila_shop_claim', { p_key: pc.shop.key }).then(function (r) {
        if (r && r.claimed) LS.set('fiila.shop', Object.assign({}, pc.shop, { linked: true }));
        return c;
      }, function () { return c; }) : c;
    });
  }
  function afterLogin(name) {
    return (name ? api('fiila_profile_save', { p: { display_name: name } }) : api('fiila_me', {})).then(function (me) { ME = me; return me; });
  }
  // PKCE : le lien reçu par e-mail ne contient qu'un code, échangé avec un secret resté sur ce téléphone.
  // Un lien fabriqué par un tiers ne peut donc ouvrir aucune session ici.
  function b64url(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function pkceStart(kind, after) {
    var v = new Uint8Array(32); crypto.getRandomValues(v);
    var verifier = b64url(v);
    LS.set('fiila.pkce', { verifier: verifier, kind: kind, at: Date.now(), after: after || undefined });
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (d) {
      return { code_challenge: b64url(new Uint8Array(d)), code_challenge_method: 's256' };
    });
  }
  var account = {
    signUp: function (email, password, name, source, after) {
      return pkceStart('signup', after).then(function (pk) {
        return authCall('/signup?redirect_to=' + encodeURIComponent(baseUrl()), 'POST',
          Object.assign({ email: email, password: password, data: { display_name: name || undefined } }, pk));
      }).then(function (r) {
        if (r && r.access_token) {
          LS.del('fiila.pkce'); saveSession(r);
          track('account_created', source === 'nudge' || source === 'shop' ? source : 'account');
          return afterLogin(name).then(function () { return { session: true }; });
        }
        return { confirm: true };
      });
    },
    signIn: function (email, password) {
      return authCall('/token?grant_type=password', 'POST', { email: email, password: password }).then(function (r) {
        saveSession(r); return afterLogin(null);
      });
    },
    signOut: function () {
      var done = function () {
        saveSession(null);
        // On garde sur ce téléphone les fiches dont il a la clé ; celles du compte seul disparaissent d'ici.
        LS.set('fiila.owned', owned.all().filter(function (r) { return r.owner; }));
        // Boutique rattachée au compte : elle reste accessible par le compte, plus par ce téléphone.
        var sk = LS.get('fiila.shop', null);
        if (sk && sk.linked) LS.del('fiila.shop');
      };
      return authCall('/logout', 'POST', null, true).then(done, done);
    },
    // Double authentification (application d'authentification, code à 6 chiffres) : API MFA de Supabase Auth.
    mfaFactors: function () { return authCall('/user', 'GET', null, true).then(function (u) { return (u && u.factors) || []; }); },
    mfaEnroll: function () {
      return authCall('/factors', 'POST', { factor_type: 'totp', issuer: 'Fii', friendly_name: 'Fii ' + new Date().toISOString().slice(0, 16) }, true);
    },
    mfaRemove: function (id) { return authCall('/factors/' + id, 'DELETE', null, true); },
    mfaVerify: function (factorId, code) {
      return authCall('/factors/' + factorId + '/challenge', 'POST', {}, true).then(function (c) {
        return authCall('/factors/' + factorId + '/verify', 'POST', { challenge_id: c.id, code: String(code).replace(/\s/g, '') }, true);
      }).then(function (r) { saveSession(r); return r; });
    },
    // Numéro du compte confirmé par un code SMS (Supabase Auth, changement de numéro ; envoi par Africa's Talking).
    phoneStart: function (e164) { return freshToken().then(function () { return authCall('/user', 'PUT', { phone: e164 }, true); }); },
    phoneVerify: function (e164, code) {
      return authCall('/verify', 'POST', { type: 'phone_change', phone: e164, token: String(code).replace(/\s/g, '') }, true).then(function (r) {
        if (r && r.access_token) saveSession(r);
        ME = null; return r;
      });
    },
    setPassword: function (pw) { return freshToken().then(function () { return authCall('/user', 'PUT', { password: pw }, true); }); },
    recover: function (email) {
      return pkceStart('recovery').then(function (pk) {
        return authCall('/recover?redirect_to=' + encodeURIComponent(baseUrl()), 'POST', Object.assign({ email: email }, pk));
      });
    },
    // Code reçu par e-mail : 'recovery' (mot de passe oublié) ou 'signup' (activation). Ouvre la session.
    emailVerify: function (kind, email, code) {
      return authCall('/verify', 'POST', { type: kind === 'recovery' ? 'recovery' : 'email', email: email, token: code }).then(function (r) {
        if (!r || !r.access_token) throw new ApiError('otp_expired');
        LS.del('fiila.pkce'); saveSession(r); return afterLogin(null);
      });
    },
    me: function () {
      if (!authed()) return Promise.resolve(null);
      if (ME) return Promise.resolve(ME);
      return api('fiila_me', {}).then(function (m) { ME = m; return m; }, function (e) { if (e.code === 'session_expired' || e.code === 'auth_required') { saveSession(null); return null; } throw e; });
    }
  };
  // Retour d'un lien e-mail : seul « ?code=… » (PKCE) est accepté, avec le secret gardé sur ce téléphone.
  // Tout jeton passé dans l'URL (#access_token=…) est ignoré et effacé.
  var authBoot = (function () {
    var hs = (location.hash || '').replace(/^#/, '');
    if (/(^|&)(access_token|refresh_token|error)=/.test(hs)) {
      try { history.replaceState(null, '', location.pathname + '#/compte?lien=invalide'); } catch (e) { location.hash = '#/compte?lien=invalide'; }
      return Promise.resolve();
    }
    var qp = new URLSearchParams(location.search || '');
    var code = qp.get('code');
    if (!code) return Promise.resolve();
    var pk = LS.get('fiila.pkce', null);
    LS.del('fiila.pkce');
    var clean = function (dest) { try { history.replaceState(null, '', location.pathname + dest); } catch (e) { location.hash = dest; } };
    if (!pk || !pk.verifier || Date.now() - pk.at > 3600e3) { clean('#/compte?lien=invalide'); return Promise.resolve(); }
    return authCall('/token?grant_type=pkce', 'POST', { auth_code: code, code_verifier: pk.verifier }).then(function (r) {
      saveSession(r);
      clean(pk.kind === 'recovery' ? '#/compte?mdp=1' : pk.after && /^#\/[a-z0-9\/-]{1,40}$/.test(pk.after) ? pk.after : '#/compte?bienvenue=1');
    }, function () { clean('#/compte?lien=invalide'); });
  })();

  function api(fn, args, retried) {
    return freshToken().then(function () { return rawApi(fn, args); }).catch(function (e) {
      if (e.code === 'jwt_expired' && !retried && SESSION) return refreshSession().then(function () { return api(fn, args, true); });
      throw e;
    });
  }
  function rawApi(fn, args) {
    if (!API_URL) return Promise.reject(new ApiError('not_configured'));
    if (navigator.onLine === false) return Promise.reject(new ApiError('network'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
    return fetch(API_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify(args || {}),
      signal: ctrl ? ctrl.signal : undefined, cache: 'no-store', credentials: 'omit'
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
        if (res.ok) return body;
        if (res.status === 401) throw new ApiError(SESSION ? 'jwt_expired' : 'server');
        var m = body && body.message && /fiila:([a-z_]+)/.exec(body.message);
        throw new ApiError(m ? m[1] : 'server');
      });
    }, function (e) {
      clearTimeout(timer);
      throw new ApiError(e && e.name === 'AbortError' ? 'timeout' : 'network');
    });
  }

  /* ================================================================ toast & copie */
  var toastTimer;
  function toast(text, fallbackText) {
    var t = document.getElementById('toast');
    clearTimeout(toastTimer);
    var box = h('div', { role: 'status' }, h('span', null, text));
    if (fallbackText) {
      var inp = h('input', { type: 'text', readonly: true, value: fallbackText, 'aria-label': 'Texte à copier' });
      box.append(inp, h('button', { class: 'btn small lime', type: 'button', onclick: function () { t.hidden = true; } }, 'Fermer'));
      setKids(t, box); t.hidden = false; inp.focus(); inp.select();
      return;
    }
    setKids(t, box); t.hidden = false;
    t.dataset.seq = String(renderSeq);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  // Un message ne survit qu'à la page qui suit l'action (jamais deux changements de page).
  function staleToast() {
    var t = document.getElementById('toast');
    if (t && !t.hidden && +t.dataset.seq < renderSeq - 1) t.hidden = true;
  }
  function copy(text, label, onDone) {
    var done = function () { toast((label || 'Texte') + ' copié.'); if (onDone) onDone(); };
    var fail = function () { toast('Copie automatique impossible. Sélectionnez et copiez :', text); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    } catch (e) { fail(); }
  }

  /* ================================================================ mesure agrégée (sans identifiant)
     Compteurs journaliers anonymes côté serveur : nom d'événement + variante, rien d'autre.
     Jamais d'adresse, de coordonnées, de photo, de clé ni de jeton de lien.
     Envoi silencieux : un échec n'a aucun effet sur l'affichage ou la création. */
  var TRACKABLE = {
    account_created: ['account', 'shop', 'nudge'],
    account_nudge: ['shown', 'dismissed'],
    shop_created: ['shop', 'no_account', 'account'],
    product_created: ['photo', 'no_photo'],
    review_left: ['1', '2', '3', '4', '5'],
    courier_review: ['1', '2', '3', '4', '5'],
    courier_registered: ['direct', 'invite'],
    courier_invited: ['whatsapp'],
    courier_linked: ['invite'],
    courier_done: ['courier'],
    shop_deleted: ['shop'],
    order_created: ['new_customer', 'known_customer', 'known_address'],
    invoice_opened: ['order'],
    payment_recorded: ['cash', 'wave', 'orange_money', 'card', 'other'],
    discovery_shown: ['address', 'meeting'],
    discovery_cta: ['address', 'meeting'],
    fiche_created: ['address_direct', 'address_discovery', 'address_request', 'meeting_direct', 'meeting_discovery', 'meeting_similar'],
    request_created: ['request'],
    share_initiated: ['native', 'whatsapp', 'telegram', 'facebook', 'instagram', 'tiktok'].reduce(function (a, c) {
      return a.concat([c + '_address', c + '_meeting', c + '_request']);
    }, []),
    link_copied: ['address', 'meeting', 'request'],
    delivery_started: ['request', 'place', 'order', 'courier'],
    tracking_shared: ['courier', 'guest'],
    meeting_joined: ['guest'],
    visual_exported: ['download_address', 'download_meeting', 'download_request', 'share_address', 'share_meeting', 'share_request'],
    owned_reopened: ['address', 'meeting', 'request'],
    nudge: [],
    onboarding: []
  };
  /* ----- Découverte progressive (fondateur, 20/10 06:59 : « la personne ne doit pas sentir l'onboarding ; elle découvre au fur et
     à mesure tout le potentiel de l'app selon ses usages ; des appels à l'action incitatifs sans être agressifs »).
     Règles : une seule suggestion par écran, jamais au premier geste ; 3 au plus par jour ; « Plus tard » = 7 jours de silence,
     deux fois = plus jamais ; suggestion suivie = plus jamais. Réglable dans le back-office (nudges = 0 coupe tout). */
  var NUDGE_IDS = ['home_shop', 'shop_more_products', 'shop_share_vitrine', 'shop_courier', 'shop_team', 'shop_photos'];
  NUDGE_IDS.forEach(function (id) { ['shown', 'click', 'dismiss'].forEach(function (a) { TRACKABLE.nudge.push(id + ':' + a); }); });
  var NUDGE_SEQ = -1, NUDGE_FLAGS = null;
  // passive : lecture du cache seulement (pages reçues par lien : rien n'est écrit sur le téléphone sans action).
  function nudgeFlags(passive) {
    var c = LS.get('fiila.flags', null);
    if (c && Date.now() - c.at < 6 * 3600e3) NUDGE_FLAGS = c.v;
    if (passive) return (c && c.v) || { nudges: true, onboarding: true, discover: true };
    if (!c || Date.now() - c.at >= 6 * 3600e3) api('fiila_app_flags', {}).then(function (v) { NUDGE_FLAGS = v; LS.set('fiila.flags', { at: Date.now(), v: v }); }, function () {});
    return NUDGE_FLAGS || { nudges: true, onboarding: true, discover: true };
  }
  function nudgeState() {
    var st = LS.get('fiila.nudges', null) || {};
    var today = new Date().toISOString().slice(0, 10);
    if (st.day !== today) { st.day = today; st.n = 0; st.seen = {}; }
    st.ids = st.ids || {};
    return st;
  }
  // o : { icon, title, text, cta, href, external }
  function nudge(id, o) {
    if (!nudgeFlags().nudges || NUDGE_SEQ === renderSeq) return null;
    var st = nudgeState(), me = st.ids[id] || {};
    if (me.done || (me.d || 0) >= 2 || (me.until && Date.now() < me.until)) return null;
    if (!st.seen[id] && st.n >= 3) return null;
    NUDGE_SEQ = renderSeq;
    if (!st.seen[id]) { st.seen[id] = 1; st.n++; track('nudge', id + ':shown'); }
    LS.set('fiila.nudges', st);
    function save(fn) { var x = nudgeState(); x.ids[id] = fn(x.ids[id] || {}); LS.set('fiila.nudges', x); }
    var card = h('aside', { class: 'nudge2', id: 'nudge-' + id, 'aria-label': 'Suggestion' },
      h('span', { class: 'nudge2-ic', 'aria-hidden': 'true' }, icon(o.icon || 'star', 18)),
      h('div', { class: 'nudge2-t' }, h('b', null, o.title), o.text ? h('span', null, o.text) : null,
        h('a', { class: 'nudge2-cta', href: o.href, id: 'nudge-' + id + '-go', target: o.external ? '_blank' : null, rel: o.external ? 'noopener noreferrer' : null, onclick: function () {
          track('nudge', id + ':click'); save(function (m) { m.done = true; return m; }); if (o.external) card.remove();
        } }, o.cta, icon('chev', 14))),
      h('button', { class: 'nudge2-x', type: 'button', 'aria-label': 'Plus tard', id: 'nudge-' + id + '-later', onclick: function () {
        track('nudge', id + ':dismiss'); save(function (m) { m.d = (m.d || 0) + 1; m.until = Date.now() + 7 * 864e5; return m; });
        card.classList.add('out'); setTimeout(function () { card.remove(); }, REDUCED ? 0 : 200);
      } }, icon('close', 16)));
    return card;
  }
  // Accueil : quelqu'un qui a déjà créé une adresse et qui n'a pas de boutique découvre la boutique gratuite.
  function homeNudge() {
    if (CFG.shop === false || shopKey() || (ME && ME.shop) || (LS.get('fiila.tx', 0) || 0) < 1) return null;
    return nudge('home_shop', { icon: 'shop', title: 'Vous vendez quelque chose ?', text: 'Votre boutique en ligne est gratuite : commandes, factures et adresse exacte de vos clientes.', cta: 'Créer ma boutique', href: '#/boutique' });
  }
  /* ----- Parcours d'accueil v2 (proposition validée par le fondateur le 20/10 23:36, docs/PROPOSITION-ONBOARDING.md).
     Rien ne s'« installe » : chaque service est disponible ; son premier usage ajoute son raccourci dans « Mes activités ».
     Action principale : « Reprendre… » si une adresse est en cours, sinon l'activité la plus utilisée sur 14 jours, sinon
     « Créer mon adresse ». Retirer un raccourci ne retire aucun accès. Réglage du back-office onboarding_v2 (0 = ancien accueil). */
  var SERVICES = [
    { id: 'boutique', icon: 'shop', label: 'Boutique', hero: 'Ma boutique', sub: 'Commandes, articles, vitrine', href: '#/boutique',
      text: 'Vendez en ligne : vitrine, commandes, factures et adresse exacte de vos clientes.' },
    { id: 'demander', icon: 'ask', label: 'Demander', hero: 'Demander une adresse', sub: 'Un lien, l’adresse exacte en retour', href: '#/demande/nouvelle',
      text: 'Recevez l’adresse exacte d’un client en lui envoyant un lien.' },
    { id: 'evenement', icon: 'cal', label: 'Événement', hero: 'Créer un événement', sub: 'Un lien pour tous vos invités', href: '#/rdv/nouveau',
      text: 'Mariage, baptême, réunion : un seul lien pour que tous vos invités trouvent le lieu.' },
    { id: 'livreur', icon: 'moto', label: 'Livreur', hero: 'Espace livreur', sub: 'Vos courses avec l’adresse exacte', href: '#/livreur',
      text: 'Recevez les courses de vos commerçants, avec l’adresse exacte et le chemin.' },
    { id: 'vide_dressing', icon: 'users', label: 'Vide-dressing', hero: 'Vide-dressing', sub: 'Vendre ou acheter d’occasion', href: '#/vide-dressing',
      text: 'Proposez vos articles d’occasion à Fii, ou achetez près de chez vous.' },
    { id: 'ambassadeur', icon: 'cash', label: 'Agent', hero: 'Fii Carrière', sub: 'Missions, gains, classement', href: '#/agent',
      text: 'Gagnez de l’argent en installant Fii chez les commerçants, après une formation et une validation.' }];
  var ACT_LS = 'fiila.acts';
  ['hero_reprendre', 'hero_adresse', 'services'].concat(SERVICES.map(function (x) { return 'hero_' + x.id; })).forEach(function (k) { TRACKABLE.onboarding.push(k === 'services' ? 'services:open' : k + ':click'); });
  SERVICES.forEach(function (x) { TRACKABLE.onboarding.push('act_' + x.id + ':click', 'svc_' + x.id + ':click', 'svc_' + x.id + ':hide'); });
  function onboardingOn() { var f = nudgeFlags(); return f.onboarding !== false; }
  function svcOf(id) { for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i]; return null; }
  function actState() { var st = LS.get(ACT_LS, null) || {}; st.log = st.log || {}; st.hidden = st.hidden || {}; st.used = st.used || {}; return st; }
  // Écran ouvert → activité utilisée (une fois toutes les 10 minutes au plus).
  function noteActivity(p) {
    var id = !p.length ? null : p[0] === 'new' ? 'adresse' : p[0] === 'boutique' ? 'boutique' : p[0] === 'livreur' ? 'livreur'
      : p[0] === 'rdv' && p[1] === 'nouveau' ? 'evenement' : p[0] === 'demande' ? 'demander' : p[0] === 'vide-dressing' ? 'vide_dressing'
      : p[0] === 'ambassadeur' || p[0] === 'agent' ? 'ambassadeur' : null;
    if (!id) return;
    var st = actState(), now = Date.now(), log = (st.log[id] || []).filter(function (t) { return now - t < 14 * 864e5; });
    if (log.length && now - log[log.length - 1] < 10 * 60e3) return;
    log.push(now); st.log[id] = log.slice(-60); st.used[id] = 1; delete st.hidden[id];
    LS.set(ACT_LS, st);
  }
  // Activités de cette personne : ce qu'elle a utilisé, et ce qui existe déjà sur ce téléphone ou dans son compte.
  function myActivities() {
    var st = actState(), has = {};
    Object.keys(st.used).forEach(function (k) { has[k] = 1; });
    if (shopKey() || (ME && ME.shop)) has.boutique = 1;
    if (LS.get(COURIER_LS, null)) has.livreur = 1;
    owned.all().forEach(function (r) { if (r.type === 'request') has.demander = 1; else if (r.kind === 'meeting') has.evenement = 1; });
    return SERVICES.filter(function (s) { return has[s.id] && !st.hidden[s.id] && !(s.id === 'boutique' && CFG.shop === false); });
  }
  function topActivity() {
    var st = actState(), now = Date.now(), best = null, n = 0;
    Object.keys(st.log).forEach(function (k) {
      var c = st.log[k].filter(function (t) { return now - t < 14 * 864e5; }).length;
      if (c > n || (c === n && best === 'adresse')) { best = k; n = c; }
    });
    return n >= 2 ? best : null;
  }
  function addressDraftStarted() {
    var d = LS.get(DRAFT_KEY, null);
    return !!(d && (d.entry || d.photo || (d.label || '').trim() || (d.instruction || '').trim()));
  }
  function homeHero() {
    if (addressDraftStarted()) return h('a', { class: 'hero', href: '#/new', id: 'create-address', 'data-hero': 'reprendre',
      onclick: function () { track('onboarding', 'hero_reprendre:click'); } },
      h('span', { class: 'hero-ic', 'aria-hidden': 'true' }, icon('cam', 32)),
      h('span', null, h('b', null, 'Reprendre mon adresse'), h('small', null, 'Là où vous vous étiez arrêté')));
    if (setupPending()) return h('a', { class: 'hero', href: '#/boutique/demarrer', id: 'home-hero', 'data-hero': 'boutique',
      onclick: function () { track('onboarding', 'hero_boutique:click'); track('shop_setup', 'resume:open'); } },
      h('span', { class: 'hero-ic', 'aria-hidden': 'true' }, icon('shop', 32)),
      h('span', null, h('b', null, 'Reprendre ma boutique'), h('small', null, 'Encore quelques secondes pour l’ouvrir')));
    // Commerçant : « Ma boutique » est l'action principale ; ses raccourcis suivent (fondateur, 22/10).
    if (hasShop()) return shopHero();
    var top = topActivity(), s = top && top !== 'adresse' ? svcOf(top) : null;
    if (s && myActivities().indexOf(s) >= 0) return h('a', { class: 'hero', href: s.href, id: 'home-hero', 'data-hero': s.id,
      onclick: function () { track('onboarding', 'hero_' + s.id + ':click'); } },
      h('span', { class: 'hero-ic', 'aria-hidden': 'true' }, icon(s.icon, 32)),
      h('span', null, h('b', null, s.hero), h('small', null, s.sub)));
    return h('a', { class: 'hero', href: '#/new', id: 'create-address', 'data-hero': 'adresse', 'aria-label': 'Créer mon adresse',
      onclick: function () { track('onboarding', 'hero_adresse:click'); } },
      h('span', { class: 'hero-ic', 'aria-hidden': 'true' }, icon('cam', 32)),
      h('span', null, h('b', null, 'Créer mon adresse'), h('small', null, 'Photo de la porte · repère · lien')));
  }
  function hasShop() { return CFG.shop !== false && !!(shopKey() || (ME && ME.shop)); }
  // Accueil du commerçant : « Ma boutique » (nom et commandes en cours), puis « Mon commerce » : Commandes, Articles,
  // Marketing, Clients. Les compteurs arrivent après coup ; hors ligne, les liens restent.
  var SHOP_HOME = null;
  function shopHero() {
    var sub = h('small', { id: 'home-shop-sub' }, SHOP_HOME ? shopHomeLine(SHOP_HOME) : 'Commandes, articles, vitrine');
    var hero = h('a', { class: 'hero', href: '#/boutique', id: 'home-hero', 'data-hero': 'boutique', 'aria-label': 'Ma boutique',
      onclick: function () { track('onboarding', 'hero_boutique:click'); } },
      h('span', { class: 'hero-ic', 'aria-hidden': 'true' }, icon('shop', 32)),
      h('span', null, h('b', null, 'Ma boutique'), sub));
    sapi('fiila_shop_get', {}).then(function (r) {
      if (!r.shop) return;
      SHOP_HOME = { name: r.shop.name, open: (r.stats || {}).open || 0, unpaid: (r.stats || {}).unpaid || 0 };
      sub.textContent = shopHomeLine(SHOP_HOME);
      hero.setAttribute('aria-label', 'Ma boutique : ' + r.shop.name);
      var b = document.getElementById('biz-orders-n');
      if (b) { b.textContent = SHOP_HOME.open > 99 ? '99+' : String(SHOP_HOME.open); b.hidden = !SHOP_HOME.open; }
    }, function () { /* hors ligne : le lien reste */ });
    return hero;
  }
  function shopHomeLine(x) {
    var bits = [x.name];
    if (x.open) bits.push(x.open + (x.open > 1 ? ' commandes en cours' : ' commande en cours'));
    else if (x.unpaid) bits.push(x.unpaid + ' à encaisser');
    return bits.join(' · ');
  }
  function shopHomeTiles() {
    function tile(id, href, name, label, badge) {
      return h('a', { class: 'ttile', href: href, id: 'biz-' + id, onclick: function () { track('onboarding', 'biz_' + id + ':click'); } },
        h('span', { class: 'ttile-ic', 'aria-hidden': 'true' }, icon(name, 26), badge || null), h('span', { class: 'pro-name' }, label));
    }
    var n = SHOP_HOME ? SHOP_HOME.open : 0;
    return h('section', { class: 'stack tight', id: 'my-shop', 'aria-labelledby': 'h-biz' },
      h('h2', { id: 'h-biz', class: 'acts-h' }, 'Mon commerce'),
      h('nav', { class: 'tiles4 acts', 'aria-label': 'Mon commerce' },
        tile('orders', '#/boutique?vue=open', 'box', 'Commandes', h('span', { class: 'tbadge', id: 'biz-orders-n', hidden: !n || null }, n > 99 ? '99+' : String(n))),
        tile('products', '#/boutique/articles', 'cam', 'Articles'),
        tile('marketing', '#/boutique/marketing', 'megaphone', 'Marketing'),
        tile('customers', '#/clients', 'users', 'Clients')));
  }
  ['orders', 'products', 'marketing', 'customers'].forEach(function (k) { TRACKABLE.onboarding.push('biz_' + k + ':click'); });
  function homeActivities(hero) {
    var heroId = hero.getAttribute('data-hero');
    var acts = myActivities().filter(function (s) { return s.id !== heroId; });
    var tiles = acts.map(function (s) {
      return h('a', { class: 'ttile', href: s.href, id: 'act-' + s.id, onclick: function () { track('onboarding', 'act_' + s.id + ':click'); } },
        h('span', { class: 'ttile-ic', 'aria-hidden': 'true' }, icon(s.icon, 26)), h('span', { class: 'pro-name' }, s.label));
    });
    // L'adresse reste à portée quand l'action principale est une autre activité.
    if (heroId !== 'adresse' && heroId !== 'reprendre') tiles.unshift(h('a', { class: 'ttile', href: '#/new', id: 'create-address' },
      h('span', { class: 'ttile-ic', 'aria-hidden': 'true' }, icon('cam', 26)), h('span', { class: 'pro-name' }, 'Mon adresse')));
    return tiles.length ? h('section', { class: 'stack tight', id: 'my-acts', 'aria-labelledby': 'h-acts' },
      h('h2', { id: 'h-acts', class: 'acts-h' }, 'Mes activités'), h('nav', { class: 'tiles4 acts', 'aria-label': 'Mes activités' }, tiles)) : null;
  }
  function servicesButton() {
    return h('button', { class: 'svc-open', type: 'button', id: 'services-open', onclick: function () { servicesSheet(); } },
      h('span', { class: 'svc-open-ic', 'aria-hidden': 'true' }, icon('plus', 20)), h('span', null, 'Découvrir les services'));
  }
  function servicesSheet() {
    track('onboarding', 'services:open');
    var mine = myActivities();
    var back = h('div', { class: 'sheet-back', id: 'services-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'services-h',
      onclick: function (e) { if (e.target === back) close(); } });
    var list = SERVICES.filter(function (s) { return !(s.id === 'boutique' && CFG.shop === false); });
    var close;
    back.append(h('div', { class: 'sheet svc-sheet' },
      h('div', { class: 'svc-head' }, h('h2', { id: 'services-h' }, 'Les services Fii'),
        h('button', { class: 'svc-x', type: 'button', 'aria-label': 'Fermer', id: 'services-close', onclick: function () { close(); } }, icon('close', 18))),
      h('div', { class: 'svc-list' }, list.map(function (s) {
        var on = mine.indexOf(s) >= 0;
        return h('div', { class: 'svc-card', id: 'svc-' + s.id },
          h('span', { class: 'svc-ic', 'aria-hidden': 'true' }, icon(s.icon, 24)),
          h('div', { class: 'svc-t' }, h('b', null, s.hero), h('span', null, s.text),
            on ? h('button', { class: 'svc-hide', type: 'button', onclick: function () {
              var st = actState(); st.hidden[s.id] = 1; LS.set(ACT_LS, st); track('onboarding', 'svc_' + s.id + ':hide'); close(); toast('Retiré de l’accueil. Le service reste ici.'); render();
            } }, 'Retirer de l’accueil') : null),
          h('a', { class: 'btn small svc-go', id: 'svc-' + s.id + '-go', href: s.href, onclick: function () { track('onboarding', 'svc_' + s.id + ':click'); close(); } }, 'Ouvrir'));
      })),
      h('a', { class: 'invite-row', id: 'invite-link', href: '#/parrainer', onclick: function () { close(); } }, icon('gift', 24), h('span', null, 'Inviter un proche'),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18)))));
    close = openSheet(back);
  }
  /* ----- Découverte après une action (accueil v2, lot 3). La tâche du lien reste l'action principale ; dessous, une seule
     proposition discrète et masquable, plus « Voir tous les services » (arbitrage A2 du fondateur, 20/10 23:36).
     « × » = 7 jours de silence pour ce contexte, deux fois = plus jamais. Réglage du back-office discover_after (0 = rien). */
  var AFTER_LS = 'fiila.after';
  var AFTER_CTX = ['order', 'sent', 'course'];
  TRACKABLE.discover = [];
  AFTER_CTX.forEach(function (c) { ['shown', 'click', 'hide', 'all'].forEach(function (a) { TRACKABLE.discover.push(c + ':' + a); }); });
  ['fiche', 'event'].forEach(function (c) { TRACKABLE.discover.push(c + ':all'); });
  function afterOn() { var f = nudgeFlags(true); return f.onboarding !== false && f.discover !== false; }
  function servicesLink(ctx) {
    return h('button', { class: 'after-all', type: 'button', id: 'after-all', onclick: function () { track('discover', ctx + ':all'); servicesSheet(); } }, 'Voir tous les services');
  }
  // o : { icon, title, cta, href }
  function afterTask(ctx, o) {
    if (!afterOn()) return null;
    var st = LS.get(AFTER_LS, null) || {}, me = st[ctx] || {};
    if ((me.d || 0) >= 2 || (me.until && Date.now() < me.until)) return null;
    var box = h('aside', { class: 'after', id: 'after-' + ctx, 'aria-label': 'Suggestion' },
      h('span', { class: 'after-ic', 'aria-hidden': 'true' }, icon(o.icon, 20)),
      h('div', { class: 'after-t' }, h('b', null, o.title),
        h('div', { class: 'after-row' },
          h('a', { class: 'after-cta', id: 'after-' + ctx + '-go', href: o.href, onclick: function () { track('discover', ctx + ':click'); } }, o.cta, icon('chev', 14)),
          servicesLink(ctx))),
      h('button', { class: 'after-x', type: 'button', 'aria-label': 'Masquer', id: 'after-' + ctx + '-hide', onclick: function () {
        var x = LS.get(AFTER_LS, null) || {}; var m = x[ctx] || {}; m.d = (m.d || 0) + 1; m.until = Date.now() + 7 * 864e5; x[ctx] = m; LS.set(AFTER_LS, x);
        track('discover', ctx + ':hide'); box.remove();
      } }, icon('close', 16)));
    trackWhenVisible(box, 'discover', ctx + ':shown');
    return box;
  }
  // « Installer l'app » : à partir de la deuxième visite (une visite = une session du navigateur).
  function visitCount() {
    var n = Number(LS.get('fiila.visits', 0)) || 0;
    try { if (!sessionStorage.getItem('fiila.v')) { sessionStorage.setItem('fiila.v', '1'); n++; LS.set('fiila.visits', n); } } catch (e) { /* rien */ }
    return n;
  }
  // Tableau de bord de la boutique : la prochaine fonction utile selon l'avancement, une seule à la fois.
  function shopNudge(shop, st) {
    var p = st.products || 0, o = st.orders || 0;
    if (p >= 1 && p < 3) return nudge('shop_more_products', { icon: 'cam', title: 'Encore 2 ou 3 articles', text: 'Une vitrine bien remplie inspire confiance à vos clientes.', cta: 'Ajouter un article', href: '#/boutique/article/nouveau' });
    if (p >= 3 && shop.public && shop.slug && o === 0) return nudge('shop_share_vitrine', { icon: 'share', title: 'Faites connaître votre vitrine', text: 'Un lien dans votre statut WhatsApp suffit pour recevoir vos premières commandes.', cta: 'Partager sur WhatsApp',
      href: waLink('Découvrez ma boutique ' + shop.name + ' : ' + baseUrl() + '#/b/' + shop.slug), external: true });
    if (o >= 2 && !shop.courier && !shop.courier_invite && SHOP_ROLE !== 'editor') return nudge('shop_courier', { icon: 'moto', title: 'Un livreur de confiance ?', text: 'Invitez-le : il reçoit l’adresse exacte et le chemin à chaque course.', cta: 'Inviter mon livreur', href: '#/boutique/reglages' });
    if (p >= 3 && o >= 1) return nudge('shop_photos', { icon: 'cam', title: 'Plusieurs photos par article', text: 'Jusqu’à 5 photos qui défilent : vos articles se vendent mieux.', cta: 'Voir mes articles', href: '#/boutique/articles' });
    if (o >= 10 && SHOP_ROLE === 'owner') return nudge('shop_team', { icon: 'users', title: 'Vous travaillez à plusieurs ?', text: 'Ajoutez un membre d’équipe : chacun avec son rôle, sans partager de mot de passe.', cta: 'Ajouter un membre', href: '#/boutique/reglages' });
    return null;
  }
  function privacyOptOut() {
    try { return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1'; }
    catch (e) { return false; }
  }
  function track(event, variant) {
    if (event === 'fiche_created' || event === 'request_created' || event === 'order_created') bumpTx();
    try {
      if (!API_URL || CFG.analytics === false || privacyOptOut()) return;
      if (!TRACKABLE[event] || TRACKABLE[event].indexOf(variant) < 0) return;
      fetch(API_URL + '/rest/v1/rpc/fiila_track', {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ p_event: event, p_variant: variant }),
        keepalive: true, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
      }).catch(function () { /* ignoré */ });
    } catch (e) { /* ignoré */ }
  }
  // Compte un affichage seulement quand le bloc est réellement visible à l'écran, une fois par page.
  function trackWhenVisible(el, event, variant) {
    var sent = false;
    function send() { if (!sent) { sent = true; track(event, variant); } }
    try {
      if (!('IntersectionObserver' in window)) { setTimeout(send, 0); return; }
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; })) { send(); io.disconnect(); }
      }, { threshold: 0.5 });
      io.observe(el);
    } catch (e) { /* ignoré */ }
  }

  /* ================================================================ installation (facultative) */
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    window.dispatchEvent(new Event('fiila:installable'));
  });
  window.addEventListener('appinstalled', function () {
    deferredInstall = null;
    LS.set('fiila.install.done', true);
    window.dispatchEvent(new Event('fiila:installable'));
  });
  function isStandalone() {
    try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
    catch (e) { return false; }
  }
  // iOS : aucune API d'installation ; seul Safari (et les navigateurs iOS récents) proposent « Sur l'écran d'accueil ».
  function iosManualInstall() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent || '') && 'standalone' in navigator && navigator.standalone === false;
  }
  /* Bouton « Installer l'app » de l'accueil (fondateur, 19/10) : simple et visible, tant que l'app n'est pas installée.
     Android (Chrome) : la fenêtre d'installation du téléphone. iPhone : 3 étapes en images. Autres navigateurs
     (WhatsApp, Facebook, ordinateur) : ouvrir dans Chrome ou Safari, lien à copier. « × » le masque 30 jours. */
  function installCta() {
    var box = h('div', { id: 'install-cta' });
    function hidden() { return isStandalone() || LS.get('fiila.install.done', false) || (Number(LS.get('fiila.install.hide', 0)) > Date.now()); }
    function draw() {
      if (!box.isConnected && box.__drawn) { window.removeEventListener('fiila:installable', draw); return; }
      box.__drawn = true;
      if (hidden()) { setKids(box); return; }
      setKids(box, h('div', { class: 'install-cta' },
        h('button', { class: 'install-go', type: 'button', id: 'install-app', onclick: open },
          h('span', { class: 'install-ic', 'aria-hidden': 'true' }, brandLogo('tiny', '')),
          h('span', { class: 'install-t' }, h('b', null, 'Installer l’app'), h('small', null, 'L’icône Fii sur votre téléphone')),
          icon('down', 20)),
        h('button', { class: 'install-x', type: 'button', 'aria-label': 'Masquer', onclick: function () { LS.set('fiila.install.hide', Date.now() + 30 * 864e5); draw(); } }, '×')));
    }
    function open() {
      if (deferredInstall) {
        var ev = deferredInstall; deferredInstall = null;
        Promise.resolve().then(function () { return ev.prompt(); }).then(function () { return ev.userChoice; })
          .then(function (c) { if (c && c.outcome === 'accepted') { LS.set('fiila.install.done', true); toast('Fii est sur votre écran d’accueil.'); } draw(); }, function () { draw(); });
        return;
      }
      sheet();
    }
    function sheet() {
      var ios = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
      var inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|TikTok|; wv\)/i.test(navigator.userAgent || '');
      var steps = ios && !inApp ? [
        ['share', 'Touchez le bouton Partager', 'en bas de l’écran (le carré avec une flèche).'],
        ['plus', 'Choisissez « Sur l’écran d’accueil »', 'faites défiler la liste si besoin.'],
        ['check', 'Touchez « Ajouter »', 'l’icône Fii apparaît avec vos autres apps.']]
        : inApp || !('serviceWorker' in navigator) ? [
        ['link', 'Copiez le lien', 'avec le bouton ci-dessous.'],
        ['eye', 'Ouvrez-le dans ' + (ios ? 'Safari' : 'Chrome'), 'l’installation n’est pas possible depuis cette application.'],
        ['down', 'Touchez « Installer l’app »', 'sur l’accueil de Fii.']]
        : [
        ['dots', 'Ouvrez le menu du navigateur', 'les trois points en haut à droite.'],
        ['plus', 'Choisissez « Installer l’application »', 'ou « Ajouter à l’écran d’accueil ».'],
        ['check', 'Confirmez', 'l’icône Fii apparaît avec vos autres apps.']];
      var back = h('div', { class: 'sheet-back', id: 'install-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'install-sheet-h',
        onclick: function (e) { if (e.target === back) close(); } },
        h('div', { class: 'sheet' },
          h('h2', { id: 'install-sheet-h' }, 'Mettre Fii sur votre écran d’accueil'),
          h('ol', { class: 'steps-pic' }, steps.map(function (st, i) {
            return h('li', { class: 'spic' }, h('span', { class: 'spic-n' }, String(i + 1)), h('span', { class: 'spic-ic', 'aria-hidden': 'true' }, icon(st[0], 22)),
              h('span', null, h('b', null, st[1]), h('span', { class: 'small muted' }, ' ' + st[2])));
          })),
          inApp || !('serviceWorker' in navigator) ? iconBtn('button', { class: 'btn', type: 'button', onclick: function () { copy(baseUrl(), 'Lien'); } }, 'link', 'Copier le lien de Fii') : null,
          h('button', { class: 'btn ghost', type: 'button', id: 'install-sheet-close', onclick: close }, 'J’ai compris')));
      function close() { back.remove(); document.removeEventListener('keydown', esc); }
      function esc(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', esc);
      document.body.append(back);
      onMedia(close);
      var b = back.querySelector('button.btn'); if (b) b.focus();
    }
    window.addEventListener('fiila:installable', draw);
    draw();
    return box;
  }
  function installSlot() {
    var slot = h('div', { id: 'install-slot' });
    function draw() {
      if (!slot.isConnected && slot.__drawn) { window.removeEventListener('fiila:installable', draw); return; }
      slot.__drawn = true;
      setKids(slot);
      if (!LS.get('fiila.saved', false) || LS.get('fiila.install.dismissed', false) || LS.get('fiila.install.done', false) || isStandalone()) return;
      var later = h('button', { class: 'btn link', type: 'button', id: 'install-later', onclick: function () { LS.set('fiila.install.dismissed', true); draw(); } }, 'Plus tard');
      if (deferredInstall) {
        add(slot, h('section', { class: 'install', 'aria-labelledby': 'install-title' },
          h('p', null, h('strong', { id: 'install-title' }, 'Installer Fii'), ' (facultatif) : retrouvez vos fiches depuis l’écran d’accueil. C’est le même site, rien à télécharger depuis un store.'),
          h('div', { class: 'install-actions' },
            h('button', { class: 'btn ghost small', type: 'button', id: 'install-btn', onclick: function () {
              var ev = deferredInstall; deferredInstall = null;
              if (!ev) { draw(); return; }
              Promise.resolve().then(function () { return ev.prompt(); }).then(function () { return ev.userChoice; })
                .then(function (c) { if (c && c.outcome === 'accepted') LS.set('fiila.install.done', true); draw(); }, function () { draw(); });
            } }, 'Installer Fii'),
            later)));
      } else if (iosManualInstall()) {
        add(slot, h('section', { class: 'install', 'aria-labelledby': 'install-title' },
          h('p', null, h('strong', { id: 'install-title' }, 'Ajouter Fii à l’écran d’accueil'), ' (facultatif) : touchez le bouton Partager du navigateur, puis « Sur l’écran d’accueil ».'),
          h('div', { class: 'install-actions' }, later)));
      }
    }
    window.addEventListener('fiila:installable', draw);
    draw();
    return slot;
  }
  function tokenParam(v) { return v && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null; }
  function qs(params) {
    var parts = [];
    for (var k in params) if (params[k]) parts.push(k + '=' + encodeURIComponent(params[k]));
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* ================================================================ chargement à la demande */
  var leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      var css = h('link', { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css' });
      document.head.appendChild(css);
      var s = h('script', { src: 'vendor/leaflet/leaflet.js' });
      s.onload = function () { window.L ? resolve(window.L) : reject(new Error('leaflet')); };
      s.onerror = function () { leafletPromise = null; reject(new Error('leaflet')); };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }
  var qrPromise = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrPromise) return qrPromise;
    qrPromise = new Promise(function (resolve, reject) {
      var s = h('script', { src: 'vendor/qrcode.js' });
      s.onload = function () { window.qrcode ? resolve(window.qrcode) : reject(new Error('qr')); };
      s.onerror = function () { qrPromise = null; reject(new Error('qr')); };
      document.head.appendChild(s);
    });
    return qrPromise;
  }

  /* ================================================================ sélecteur de point (carte) */
  var DAKAR_VIEW = [14.7167, -17.4677];
  function parseCoords(s) {
    s = String(s || '');
    try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { /* texte brut */ }
    var m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
      s.match(/(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }
  function accInfo(p) {
    if (!p) return null;
    if (p.src === 'gps' && p.acc != null) {
      var a = Math.round(p.acc);
      if (a <= 15) return ['good', 'Position précise.'];
      if (a <= 50) return ['mid', 'Position approximative : vérifiez le repère sur la carte.'];
      return ['bad', 'Position peu précise : déplacez la carte pour mettre le repère sur l’entrée.'];
    }
    if (p.src === 'paste') return ['neutral', 'Point récupéré. Vérifiez-le sur la carte.'];
    if (p.src === 'saved') return ['neutral', 'Point déjà enregistré.'];
    if (p.src === 'reused') return ['mid', 'Point repris de l’événement précédent : vérifiez-le, puis validez.'];
    return ['neutral', 'Placé à la main sur la carte.'];
  }

  // opts: { get(), set(p|null), what: 'l’entrée', id }
  function mapPicker(opts) {
    var current = opts.get();
    // opts.initial : point repris (événement similaire) affiché mais NON validé tant que l'utilisateur ne confirme pas.
    var start = current || opts.initial || null;
    var center = start ? { lat: start.lat, lng: start.lng } : null;
    var src = current ? current.src || 'manual' : opts.initial ? 'reused' : null;
    var acc = current ? current.acc : null;
    var map = null, accCircle = null, zoomOk = !!start, programmatic = false;

    var msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    var ptBox = h('div', { class: 'pt' });
    var confirmBtn = h('button', { class: 'btn', type: 'button', onclick: confirm, hidden: opts.onePress || null }, 'Valider ce point');
    var mapEl = h('div', { class: 'map', id: (opts.id || 'map') + '-canvas' });
    var mapBox = h('div', { class: 'map-box', 'aria-label': 'Carte : déplacez-la pour placer le repère au centre sur ' + opts.what },
      mapEl, h('div', { class: 'map-pin' }), h('div', { class: 'map-dot' }));
    var pid = (opts.id || 'map') + '-paste';
    var pasteIn = h('input', { type: 'text', id: pid, placeholder: 'Collez ici le lien Google Maps', autocomplete: 'off', inputmode: 'url' });
    pasteIn.addEventListener('paste', function () { setTimeout(usePaste, 0); });
    var clipBtn = h('button', { class: 'btn', type: 'button', onclick: fromClipboard }, 'Coller le lien');
    var paste = h('div', { class: 'stack gm-panel', id: pid + '-panel', hidden: true },
      h('ol', { class: 'howto' },
        h('li', null, 'Ouvrez Google Maps.'),
        h('li', null, 'Faites un appui long exactement sur ' + opts.what + ' : un repère rouge apparaît.'),
        h('li', null, 'Touchez « Partager », puis « Copier » (ou « Copier le lien »).'),
        h('li', null, 'Revenez ici et touchez « Coller le lien ».')),
      h('div', { class: 'row' },
        h('a', { class: 'btn ghost', href: gmOpenApp(), target: IS_IOS ? null : '_blank', rel: 'noopener noreferrer' }, 'Ouvrir Google Maps'),
        clipBtn),
      h('label', { for: pid }, 'Ou collez le lien vous-même'),
      pasteIn,
      h('button', { class: 'btn small ghost', type: 'button', onclick: usePaste }, 'Placer ce point'));
    var help = h('div', { class: 'stack', hidden: true });
    var gmBtn = h('button', { class: 'btn ghost', type: 'button', 'aria-expanded': 'false', 'aria-controls': pid + '-panel', onclick: function () {
      paste.hidden = !paste.hidden; if (!paste.hidden) help.hidden = true;
      gmBtn.setAttribute('aria-expanded', paste.hidden ? 'false' : 'true');
    } }, 'Depuis Google Maps');

    function say(t, cls) { msg.textContent = t || ''; msg.className = 'msg ' + (cls || 'info'); }
    function draw() {
      var c = opts.get();
      ptBox.className = 'pt' + (c ? ' set' : '');
      ptBox.setAttribute('data-point', center ? fmt(center) : ''); // pour les tests ; jamais affiché
      var ai = accInfo(c || (center ? { src: src, acc: acc } : null));
      if (opts.onePress) setKids(ptBox, ai && center && ai[0] !== 'neutral' ? h('p', { class: 'acc ' + ai[0] }, ai[1]) : null);
      else setKids(ptBox,
        c ? h('p', { class: 'acc good' }, icon('check', 18), 'Point validé pour ' + opts.what) : h('p', { class: 'acc neutral' }, center ? 'Point pas encore validé' : 'Aucun point choisi'),
        ai && center ? h('p', { class: 'acc ' + ai[0] }, ai[1]) : null);
      confirmBtn.disabled = !center || !zoomOk || !!c;
      if (typeof locBtn !== 'undefined' && locBtn) locBtn.className = center ? 'btn ghost' : 'btn'; // une seule action principale à la fois
      confirmBtn.textContent = c ? 'Point validé' : 'Valider ce point';
      if (opts.onMove) opts.onMove();
    }
    function moved(newSrc) {
      if (opts.get()) { opts.set(null); if (!opts.onePress) say('Le repère a bougé : validez à nouveau.', 'info'); }
      if (newSrc) { src = newSrc; if (newSrc !== 'gps') acc = null; }
      draw();
    }
    function goTo(lat, lng, zoom, newSrc) {
      center = { lat: lat, lng: lng };
      if (map) { programmatic = true; map.setView([lat, lng], zoom || 18, { animate: false }); programmatic = false; zoomOk = map.getZoom() >= 16; }
      else zoomOk = true;
      moved(newSrc);
      // Point exact connu (position du téléphone, lien Google Maps) : retenu tel quel, sans dérive de la carte.
      if (opts.onePress && (newSrc === 'gps' || newSrc === 'paste')) confirm();
    }
    function confirm() {
      if (!center || !zoomOk) return;
      opts.set({ lat: +center.lat.toFixed(7), lng: +center.lng.toFixed(7), acc: src === 'gps' ? acc : null, src: src || 'manual' });
      if (!opts.onePress) say('Point validé.', 'ok');
      draw();
    }
    function placeFrom(c, how) {
      goTo(c.lat, c.lng, 18, 'paste');
      paste.hidden = true; help.hidden = true; gmBtn.setAttribute('aria-expanded', 'false');
      say((how || 'Point récupéré.') + ' Vérifiez le repère.', 'info');
    }
    function usePaste() {
      var v = String(pasteIn.value || '').trim();
      if (!v) { say('Collez d’abord le lien copié dans Google Maps.', 'err'); return; }
      var c = parseCoords(v);
      if (c) { placeFrom(c); return; }
      var m = v.match(SHORT_MAPS);
      if (m) {
        say('Lecture du lien Google Maps…', 'info');
        clipBtn.disabled = true;
        resolveMapsLink(m[0]).then(function (c2) { clipBtn.disabled = false; placeFrom(c2, 'Point récupéré depuis Google Maps.'); }, function (e) {
          clipBtn.disabled = false;
          if (e && e.code === 'network') say('Pas de connexion pour lire ce lien. Réessayez dans un instant.', 'err');
          else say('Ce lien ne contient pas de point précis. Dans Google Maps, faites un appui long sur ' + opts.what + ' pour poser un repère rouge, puis partagez ce repère.', 'err');
        });
        return;
      }
      say('Ce lien n’est pas reconnu. Dans Google Maps, touchez « Partager », puis « Copier », et collez ici.', 'err');
    }
    function fromClipboard() {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) {
          if (!t) { pasteIn.focus(); say('Rien à coller : copiez d’abord le lien dans Google Maps.', 'err'); return; }
          pasteIn.value = t; usePaste();
        }, function () { pasteIn.focus(); say('Appuyez longuement dans le champ ci-dessous, puis « Coller ».', 'info'); });
      } else { pasteIn.focus(); say('Appuyez longuement dans le champ ci-dessous, puis « Coller ».', 'info'); }
    }
    function showGm() { paste.hidden = false; help.hidden = true; gmBtn.setAttribute('aria-expanded', 'true'); }
    function deniedHelp() {
      var steps;
      if (IN_APP) {
        steps = [h('p', null, h('strong', null, 'Vous êtes dans le navigateur d’une application'), ', qui n’a pas accès à votre position.'),
          h('p', null, IS_IOS ? 'Ouvrez Fii dans Safari : touchez « ⋯ » ou le menu de l’application, puis « Ouvrir dans Safari » (ou « Ouvrir dans le navigateur »).'
            : 'Ouvrez Fii dans Chrome : touchez « ⋮ » ou le menu de l’application, puis « Ouvrir dans Chrome » (ou « Ouvrir dans le navigateur »).'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: function () { copy(location.href, 'Lien de la page'); } }, 'Copier le lien de cette page')];
      } else if (IS_IOS) {
        steps = [h('p', null, h('strong', null, 'Autoriser la position sur iPhone')),
          h('ol', { class: 'howto' },
            h('li', null, 'Réglages › Confidentialité et sécurité › Service de localisation : activé.'),
            h('li', null, 'Dans la même liste : Sites web Safari › « Lorsque l’app est active ».'),
            h('li', null, 'Dans Safari, touchez « aA » (ou l’icône à gauche de l’adresse) › Réglages du site web › Position › Autoriser.'),
            h('li', null, 'Revenez ici et touchez « Réessayer ».'))];
      } else if (IS_ANDROID) {
        steps = [h('p', null, h('strong', null, 'Autoriser la position sur Android')),
          h('ol', { class: 'howto' },
            h('li', null, 'Vérifiez que la localisation du téléphone est activée (volet des réglages rapides).'),
            h('li', null, 'Dans Chrome, touchez l’icône à gauche de l’adresse › Autorisations › Position › Autoriser.'),
            h('li', null, 'Revenez ici et touchez « Réessayer ».'))];
      } else {
        steps = [h('p', null, 'Autorisez la position pour ce site dans les réglages du navigateur, puis réessayez.')];
      }
      setKids(help, h('p', { class: 'msg err', role: 'alert' }, 'Accès à la position refusé. Voici comment l’autoriser, ou prenez le point dans Google Maps.'),
        h('div', { class: 'notice' }, steps),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: locate }, 'Réessayer'),
          h('button', { class: 'btn ghost', type: 'button', onclick: showGm }, 'Prendre le point dans Google Maps')));
      help.hidden = false;
    }
    function locate() {
      if (!('geolocation' in navigator)) { say('La position n’est pas disponible sur cet appareil. Placez le repère sur la carte ou prenez le point dans Google Maps.', 'err'); return; }
      say('Recherche de votre position…', 'info');
      locBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(function (pos) {
        locBtn.disabled = false; help.hidden = true;
        acc = pos.coords.accuracy;
        goTo(pos.coords.latitude, pos.coords.longitude, 18, 'gps');
        if (map && window.L) {
          if (accCircle) accCircle.remove();
          accCircle = window.L.circle([pos.coords.latitude, pos.coords.longitude], { radius: Math.min(acc, 2000), color: '#1E4A34', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
        }
        var ai = accInfo({ src: 'gps', acc: acc });
        say(opts.onePress ? '' : ai[1], ai[0] === 'bad' ? 'err' : 'info');
      }, function (err) {
        locBtn.disabled = false;
        if (err.code === 1) { say(''); deniedHelp(); }
        else if (err.code === 3) say('La recherche de position a pris trop de temps. Réessayez, ou placez le repère à la main.', 'err');
        else say('Position indisponible pour le moment. Placez le repère à la main sur la carte.', 'err');
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    }
    var locBtn = iconBtn('button', { class: 'btn', type: 'button', onclick: locate }, 'nav', 'Utiliser ma position');

    loadLeaflet().then(function (L) {
      var start = center ? [center.lat, center.lng] : DAKAR_VIEW;
      map = L.map(mapEl, { zoomControl: true, attributionControl: true, tap: true }).setView(start, center ? 18 : 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(map);
      map.attributionControl.setPrefix(false);
      zoomOk = map.getZoom() >= 16;
      map.on('move', function () {
        if (programmatic) return;
        var c = map.getCenter(); center = { lat: c.lat, lng: c.lng };
      });
      map.on('dragstart', function () { moved('manual'); });
      map.on('moveend zoomend', function () {
        if (programmatic) return;
        var c = map.getCenter(); center = { lat: c.lat, lng: c.lng };
        zoomOk = map.getZoom() >= 16;
        if (!zoomOk && !opts.get()) say('Zoomez davantage pour placer le repère précisément.', 'info');
        draw();
      });
      setTimeout(function () { programmatic = true; map.invalidateSize(); programmatic = false; }, 60); // recalage d'affichage : ne doit pas déplacer le point
      if (!center) say('', 'info');
      else if (!opts.get() && opts.initial) say('Point repris de l’événement précédent. Vérifiez qu’il est toujours juste, puis validez.', 'info');
      draw();
    }, function () {
      mapBox.replaceWith(h('p', { class: 'alert' }, 'La carte n’a pas pu se charger. Utilisez votre position ou prenez le point dans Google Maps.'));
      paste.hidden = false;
      zoomOk = true;
      draw();
    });

    draw();
    var el = h('div', { class: 'stack' },
      mapBox,
      h('div', { class: 'row' }, locBtn,
        gmBtn),
      help, paste, ptBox, confirmBtn, msg);
    // Mode « un seul geste » : le bouton de l'étape valide le point affiché au centre de la carte.
    el.ready = function () { return !!opts.get() || (!!center && zoomOk); };
    el.commit = function () { if (!opts.get() && center && zoomOk) confirm(); return !!opts.get(); };
    return el;
  }

  /* ================================================================ photo */
  function blobToImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return imgFromFile(file); });
    }
    return imgFromFile(file);
  }
  function imgFromFile(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Impossible de lire cette image.')); };
      img.src = url;
    });
  }
  // Retire d'un JPEG tous les segments de métadonnées (APP1 à APP15 : EXIF, XMP, IPTC… et commentaires).
  // Nécessaire car certains navigateurs (Safari/WebKit) écrivent un bloc EXIF même dans un JPEG issu d'un canvas.
  function stripJpegMetadata(dataUrl) {
    var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    var bin = atob(b64), n = bin.length, src = new Uint8Array(n);
    for (var i = 0; i < n; i++) src[i] = bin.charCodeAt(i);
    if (src[0] !== 0xFF || src[1] !== 0xD8) return dataUrl;
    var out = [src.subarray(0, 2)], pos = 2;
    while (pos + 4 <= n) {
      if (src[pos] !== 0xFF) return dataUrl; // structure inattendue : on laisse le serveur décider
      var marker = src[pos + 1];
      if (marker === 0xDA) { out.push(src.subarray(pos)); break; } // début des données image
      var len = (src[pos + 2] << 8) | src[pos + 3];
      var drop = (marker >= 0xE1 && marker <= 0xEF) || marker === 0xFE;
      if (!drop) out.push(src.subarray(pos, pos + 2 + len));
      pos += 2 + len;
    }
    var total = 0; out.forEach(function (p) { total += p.length; });
    var res = new Uint8Array(total), off = 0;
    out.forEach(function (p) { res.set(p, off); off += p.length; });
    var s = '', CH = 0x8000;
    for (var j = 0; j < res.length; j += CH) s += String.fromCharCode.apply(null, res.subarray(j, j + CH));
    return 'data:image/jpeg;base64,' + btoa(s);
  }

  /* ----- format des photos d'articles : portrait 4:5 (règle du 20/10), 864 × 1080. Recadrage automatique au centre à l'ajout,
     ajustable (glisser, zoomer) ; le serveur refuse une photo d'article hors format. */
  var PHOTO_RATIO = 0.8, PHOTO_H = 1080;
  function jpegUnder(c) {
    var q = 0.82, url = c.toDataURL('image/jpeg', q);
    while (url.length > 380000 && q > 0.4) { q -= 0.08; url = c.toDataURL('image/jpeg', q); }
    return stripJpegMetadata(url);
  }
  // Découpe { sx, sy, sw, sh } de l'image source vers une photo 4:5 (au plus 864 × 1080).
  function cropToRatio(img, rect) {
    var W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
    var r = rect || (function () {
      var sw = Math.min(W, H * PHOTO_RATIO), sh = sw / PHOTO_RATIO;
      return { sx: (W - sw) / 2, sy: (H - sh) / 2, sw: sw, sh: sh };
    })();
    var oh = Math.min(PHOTO_H, Math.round(r.sh)), ow = Math.round(oh * PHOTO_RATIO);
    var c = document.createElement('canvas'); c.width = ow; c.height = oh;
    var g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, ow, oh);
    return jpegUnder(c);
  }
  function urlToImage(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      if (/^https?:/.test(src)) i.crossOrigin = 'anonymous'; // photo du stockage : lisible par le canevas (recadrage)
      i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('Impossible de lire cette image.')); }; i.src = src;
    });
  }
  // Photo servie par le stockage (adresse) ou par la base (data:) : contenu en data: pour l'envoi ou le partage.
  function srcToDataUrl(src) {
    if (!src || /^data:/.test(src)) return Promise.resolve(src || '');
    return fetch(src, { mode: 'cors', credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('Photo indisponible.'); return r.blob(); }).then(function (b) {
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(new Error('Photo indisponible.')); }; fr.readAsDataURL(b); });
    });
  }
  function isRatio(img) { var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height; return H > 0 && Math.abs(W / H - PHOTO_RATIO) <= 0.016; }
  // Photo d'article ajoutée : l'original réduit (pour recadrer plus tard) et la photo 4:5 recadrée au centre.
  function importProductPhoto(file) {
    if (!file || !/^image\//.test(file.type || '')) return Promise.reject(new Error('Ce fichier n’est pas une image.'));
    if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('Image trop lourde (25 Mo maximum).'));
    return blobToImage(file).then(function (img) {
      var W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
      if (!W || !H) throw new Error('Impossible de lire cette image.');
      var s = Math.min(1, 1800 / Math.max(W, H));
      var c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(H * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      if (img.close) img.close();
      var orig = stripJpegMetadata(c.toDataURL('image/jpeg', 0.85));
      return { orig: orig, photo: cropToRatio(c) };
    });
  }
  // Recadrage au format 4:5 : glisser pour cadrer, curseur pour zoomer. Résout avec la nouvelle photo (ou null).
  function cropSheet(origSrc) {
    return urlToImage(origSrc).then(function (img) {
      return new Promise(function (resolve) {
        var W = img.naturalWidth, H = img.naturalHeight, z = 1, x = 0, y = 0, fw = 0, fh = 0, base = 1, drag = null;
        var pic = h('img', { src: origSrc, alt: '', draggable: 'false', class: 'crop-img' });
        var frame = h('div', { class: 'crop-frame', id: 'crop-frame', 'aria-label': 'Cadre de la photo : glissez pour cadrer' }, pic, h('span', { class: 'crop-grid', 'aria-hidden': 'true' }));
        var zoom = h('input', { type: 'range', min: '1', max: '3', step: '0.01', value: '1', id: 'crop-zoom', 'aria-label': 'Zoom', oninput: function () {
          var cx = (fw / 2 - x) / (base * z), cy = (fh / 2 - y) / (base * z);
          z = parseFloat(zoom.value); x = fw / 2 - cx * base * z; y = fh / 2 - cy * base * z; clamp(); paint();
        } });
        function clamp() { var dw = W * base * z, dh = H * base * z; x = Math.min(0, Math.max(fw - dw, x)); y = Math.min(0, Math.max(fh - dh, y)); }
        function paint() { pic.style.width = (W * base * z) + 'px'; pic.style.height = (H * base * z) + 'px'; pic.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
        function layout() {
          fw = frame.clientWidth; fh = frame.clientHeight; base = Math.max(fw / W, fh / H);
          x = (fw - W * base * z) / 2; y = (fh - H * base * z) / 2; clamp(); paint();
        }
        frame.addEventListener('pointerdown', function (e) { drag = { px: e.clientX, py: e.clientY, x: x, y: y }; try { frame.setPointerCapture(e.pointerId); } catch (er) { /* rien */ } });
        frame.addEventListener('pointermove', function (e) { if (!drag) return; x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; clamp(); paint(); });
        ['pointerup', 'pointercancel'].forEach(function (ev) { frame.addEventListener(ev, function () { drag = null; }); });
        frame.addEventListener('keydown', function (e) {
          var d = { ArrowLeft: [12, 0], ArrowRight: [-12, 0], ArrowUp: [0, 12], ArrowDown: [0, -12] }[e.key];
          if (d) { e.preventDefault(); x += d[0]; y += d[1]; clamp(); paint(); }
        });
        frame.tabIndex = 0;
        var done = false;
        function finish(v) { if (done) return; done = true; closeSheet(); resolve(v); }
        var back = h('div', { class: 'sheet-back', id: 'crop-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'crop-h', onclick: function (e) { if (e.target === back) finish(null); } },
          h('div', { class: 'sheet crop-sheet' }, h('h2', { id: 'crop-h' }, 'Recadrer la photo'),
            h('p', { class: 'small muted' }, 'Format des cartes de la vitrine (4:5). Glissez pour cadrer, zoomez avec le curseur.'),
            frame, h('label', { class: 'crop-zoom' }, icon('plus', 18), zoom),
            iconBtn('button', { class: 'btn', type: 'button', id: 'crop-ok', onclick: function () {
              var s = base * z;
              finish(cropToRatio(img, { sx: -x / s, sy: -y / s, sw: fw / s, sh: fh / s }));
            } }, 'check', 'Valider le cadrage'),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { finish(null); } }, 'Annuler')));
        var closeSheet = openSheet(back, { onClose: function () { if (!done) { done = true; resolve(null); } } });
        requestAnimationFrame(layout);
      });
    });
  }
  // Réduit, recompresse en JPEG puis retire les métadonnées (dont la position GPS).
  function compressPhoto(file, maxSide) {
    if (!file || !/^image\//.test(file.type || '')) return Promise.reject(new Error('Ce fichier n’est pas une image.'));
    if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('Image trop lourde (25 Mo maximum).'));
    return blobToImage(file).then(function (img) {
      var w = img.width || img.naturalWidth, hh = img.height || img.naturalHeight;
      if (!w || !hh) throw new Error('Impossible de lire cette image.');
      var max = maxSide || 1280, s = Math.min(1, max / Math.max(w, hh));
      var c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(hh * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      if (img.close) img.close();
      var q = 0.78, url = c.toDataURL('image/jpeg', q);
      while (url.length > 380000 && q > 0.4) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
      if (url.length > 380000) {
        var c2 = document.createElement('canvas');
        c2.width = Math.round(c.width * 0.6); c2.height = Math.round(c.height * 0.6);
        c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height);
        url = c2.toDataURL('image/jpeg', 0.7);
      }
      return stripJpegMetadata(url);
    });
  }
  // opts: get(), set(dataUrl|null), id, optional
  function photoField(opts) {
    var box = h('div', { class: 'stack' });
    var msg = h('p', { class: 'msg', role: 'status' });
    var inp = h('input', {
      type: 'file', accept: 'image/*', id: opts.id || 'photo', hidden: true, onchange: function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        msg.textContent = 'Préparation de la photo…'; msg.className = 'msg info';
        (opts.ratio ? importProductPhoto(f).then(function (x) { return x.photo; }) : compressPhoto(f, opts.maxSide)).then(function (d) { opts.set(d); msg.textContent = ''; draw(); },
          function (e) { msg.textContent = e.message; msg.className = 'msg err'; });
        inp.value = '';
      }
    });
    function draw() {
      var p = opts.get();
      setKids(box, 
        h('span', { class: 'label' }, (opts.label || 'Photo de l’entrée') + ' ', h('span', { class: 'hint' }, opts.optional ? '(facultatif)' : '(conseillé)')),
        p ? h('img', { class: 'photo-prev' + (opts.ratio ? ' r45' : ''), src: p, alt: 'Aperçu : ' + (opts.label || 'photo de l’entrée') }) : null,
        h('div', { class: 'row' },
          h('button', { class: p || opts.optional ? 'btn ghost' : 'btn', type: 'button', onclick: function () { inp.click(); } }, icon('cam', 22), h('span', null, p ? 'Remplacer la photo' : 'Prendre ou choisir une photo')),
          p ? h('button', { class: 'btn ghost', type: 'button', onclick: function () { opts.set(null); draw(); } }, 'Retirer') : null),
        opts.label ? null : h('p', { class: 'hint' }, 'La porte, pas la maison.'),
        inp, msg);
    }
    draw();
    return box;
  }

  function textField(o) {
    // Compteur affiché seulement près de la limite (80 %).
    var near = function (n) { return o.max && n >= o.max * 0.8; };
    var counter = o.max ? h('span', { class: 'counter', 'aria-hidden': 'true', hidden: !near((o.value || '').length) || null }, (o.value || '').length + ' / ' + o.max) : null;
    var input = h(o.multiline ? 'textarea' : 'input', {
      id: o.id, type: o.multiline ? null : (o.type || 'text'), maxlength: o.max ? String(o.max) : null, placeholder: o.placeholder || null,
      value: o.value || '', autocomplete: o.autocomplete || 'off', inputmode: o.inputmode || null, required: o.required || null,
      'aria-describedby': o.hint ? o.id + '-hint' : null,
      oninput: function (e) { if (counter) { counter.textContent = e.target.value.length + ' / ' + o.max; counter.hidden = !near(e.target.value.length); } o.onInput(e.target.value); }
    });
    return h('div', { class: 'field' },
      h('label', { for: o.id }, o.label, o.optional ? h('span', { class: 'hint' }, ' (facultatif)') : null),
      input,
      o.hint ? h('p', { class: 'hint', id: o.id + '-hint' }, o.hint) : null,
      counter);
  }

  /* ================================================================ fiche (vue destinataire) */
  // Aucune coordonnée affichée : l'itinéraire s'ouvre directement dans l'application de navigation.
  // Lien d'itinéraire : Google Maps (application directe sur iPhone, avec repli proposé vers Plans).
  function routeLink(p, mode, cls, name, label, note) {
    if (!IS_IOS) return iconBtn('a', { class: cls, href: gmDir(p, mode), target: '_blank', rel: 'noopener noreferrer' }, name, label);
    function tried() {
      var t = setTimeout(function () { if (document.visibilityState === 'visible' && note) note.hidden = false; }, 1600);
      var stop = function () { clearTimeout(t); document.removeEventListener('visibilitychange', stop); window.removeEventListener('pagehide', stop); };
      document.addEventListener('visibilitychange', stop); window.addEventListener('pagehide', stop);
    }
    return iconBtn('a', { class: cls, href: iosGmDir(p, mode), onclick: tried }, name, label);
  }
  // Fiche (vue destinataire) : photo, nom, repère, étapes en pictogrammes, une grande action « Y aller ».
  function fiche(p, opts) {
    opts = opts || {};
    var hasStop = p.vehicle_ok === false && p.stop;
    var isMeeting = p.kind === 'meeting';
    var place = isMeeting ? 'Lieu de l’événement' : 'Entrée';
    var note = h('p', { class: 'hint', hidden: true, role: 'status' }, 'Google Maps ne s’est pas ouvert ? Il n’est peut-être pas installé : touchez « Autre appli ».');
    var target = hasStop ? p.stop : p.entry;
    var others = h('div', { class: 'stack tight', id: 'other-apps', hidden: true },
      IS_IOS ? iconBtn('a', { class: 'btn ghost small', href: appleDir(target, 'driving'), target: '_blank', rel: 'noopener noreferrer' }, 'pin', 'Ouvrir dans Plans', 18) : null,
      IS_IOS && hasStop ? iconBtn('a', { class: 'btn ghost small', href: appleDir(p.entry, 'walking'), target: '_blank', rel: 'noopener noreferrer' }, 'walk', 'Plans : à pied jusqu’à l’entrée', 18) : null,
      iconBtn('a', { class: 'btn ghost small', href: wazeDir(target), target: '_blank', rel: 'noopener noreferrer' }, 'nav', 'Ouvrir dans Waze', 18));
    var otherBtn = iconBtn('button', { class: 'btn ghost', type: 'button', id: 'other-app', 'aria-expanded': 'false', 'aria-controls': 'other-apps',
      onclick: function (e) { others.hidden = !others.hidden; e.currentTarget.setAttribute('aria-expanded', others.hidden ? 'false' : 'true'); } }, 'pin', 'Autre appli');
    function step(name, title, txt) {
      return h('div', { class: 'spic' }, h('span', { class: 'spic-ic', 'aria-hidden': 'true' }, icon(name, 20)),
        h('div', null, h('strong', null, title), txt ? h('p', { class: 'note' }, txt) : null));
    }
    return h('article', { class: 'fiche' + (opts.wide && p.photo ? ' wide' : '') },
      p.photo ? h('img', { class: 'door', src: p.photo, alt: 'Photo de l’entrée' + (p.label ? ' : ' + p.label : ''), decoding: 'async' }) : null,
      h('div', { class: 'fiche-body' },
        h('div', { class: 'stack tight' },
          isMeeting ? h('p', { class: 'eyebrow' }, 'Événement') : (p.locality ? h('p', { class: 'eyebrow wrapword' }, p.locality) : null),
          h('h1', { class: 'wrapword' }, p.label || 'Sans nom'),
          isMeeting && p.starts_at ? h('p', { class: 'muted' }, whenText(p.starts_at)) : null),
        p.instruction ? h('p', { class: 'instr' }, p.instruction) : null,
        opts.voice || null,
        h('div', { class: 'steps-pic' },
          hasStop ? step('car', 'Arrêt voiture', p.walk ? 'Ensuite, à pied : ' + p.walk : 'La voiture ne peut pas aller jusqu’à l’entrée.') : null,
          step(isMeeting ? 'pin' : 'door', place, null)),
        h('div', { class: 'stack tight route' },
          routeLink(target, 'driving', 'btn big', 'nav', 'Y aller', note),
          hasStop ? routeLink(p.entry, 'walking', 'btn ghost', 'walk', (isMeeting ? 'À pied jusqu’au lieu' : 'À pied jusqu’à l’entrée'), null) : null,
          otherBtn, others, note),
        opts.footer || null));
  }



  /* ================================================================ REPÈRE VOCAL
     L'expéditeur enregistre au plus 30 secondes (dans sa langue). L'audio n'est chargé qu'au toucher « Écouter ». */
  var VOICE_MAX = 30;
  function voiceSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function secsText(n) { n = Math.max(0, Math.round(n || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); }
  function blobToB64(blob) {
    return new Promise(function (ok, ko) { var fr = new FileReader(); fr.onload = function () { ok(String(fr.result).replace(/^data:[^,]+,/, '')); }; fr.onerror = ko; fr.readAsDataURL(blob); });
  }
  // state : { action: 'keep'|'set'|'clear', b64, url, secs, existing: { secs, load } }
  function voiceRecorder(state, onChange) {
    var box = h('div', { class: 'stack tight', id: 'voice-box' });
    var rec = null, chunks = [], timer = null, started = 0, stream = null, audio = null, asking = false, waiters = [];
    function release() { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; clearInterval(timer); }
    function settle() { var w = waiters; waiters = []; w.forEach(function (f) { f(); }); }
    // Arrête l'enregistrement en cours ; la promesse se résout quand le son est prêt (ou tout de suite s'il n'y a rien).
    function finish() {
      if (audio && !audio.paused) audio.pause();
      if (!rec || rec.state === 'inactive') { release(); return Promise.resolve(); }
      return new Promise(function (resolve) { waiters.push(resolve); try { rec.stop(); } catch (e) { release(); settle(); } });
    }
    // Changement d'écran : on coupe le micro et le son, sans garder l'enregistrement interrompu.
    function abandon() { if (rec) { rec.onstop = function () { release(); settle(); }; } finish(); }
    function draw() {
      var has = state.action === 'set' || (state.action === 'keep' && state.existing);
      if (has) {
        var secs = state.action === 'set' ? state.secs : state.existing.secs;
        var playBtn = h('button', { class: 'btn vbtn', type: 'button', id: 'voice-play', 'aria-label': 'Écouter' }, icon('play', 24));
        playBtn.onclick = function () {
          if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; setKids(playBtn, icon('play', 24)); return; }
          if (audio) { playAudio(audio, playBtn, null, secs); return; }
          var go = function (src) { audio = new Audio(src); playAudio(audio, playBtn, null, secs); };
          if (state.action === 'set') go(state.url);
          else if (state.existing.load) state.existing.load().then(function (r) { if (r.state === 'ok') go(r.voice); else toast('Repère vocal indisponible.'); }, function (e) { toast(errText(e)); });
        };
        setKids(box, h('div', { class: 'voice' }, playBtn,
          h('div', { class: 'vtxt' }, h('strong', null, 'Repère vocal'), h('span', { class: 'muted' }, secsText(secs))),
          iconBtn('button', { class: 'btn ghost small', type: 'button', id: 'voice-redo', onclick: start }, 'mic', 'Refaire', 18),
          h('button', { class: 'btn quiet danger-text', type: 'button', id: 'voice-remove', 'aria-label': 'Retirer le repère vocal', style: 'min-height:44px;padding:0 6px',
            onclick: function () { if (audio) audio.pause(); audio = null; state.action = state.existing ? 'clear' : 'keep'; state.existing = null; state.b64 = null; state.url = null; onChange(); draw(); } }, icon('trash', 20))));
        return;
      }
      // Jamais masqué en silence : certains navigateurs intégrés (WhatsApp, Instagram, Facebook) n'ont pas le micro.
      if (!voiceSupported()) { setKids(box, h('p', { class: 'small muted', id: 'voice-unsupported' }, icon('mic', 14), ' Repère vocal : ouvrez Fii dans Safari ou Chrome pour l’enregistrer.')); return; }
      setKids(box, h('div', { class: 'voice' },
        h('button', { class: 'btn vbtn', type: 'button', id: 'voice-record', 'aria-label': 'Enregistrer un message vocal', onclick: start }, icon('mic', 24)),
        h('div', { class: 'vtxt' }, h('strong', null, 'Repère vocal'), h('span', { class: 'muted' }, 'Facultatif. 30 secondes, dans votre langue.'))));
    }
    function start() {
      if (!voiceSupported() || asking || (rec && rec.state === 'recording')) return;
      if (audio) { audio.pause(); audio = null; }
      asking = true;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        asking = false;
        stream = s; chunks = [];
        onMedia(abandon);
        var types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
        var mime = types.filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0];
        try { rec = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }); }
        catch (e) { rec = new MediaRecorder(s); }
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          release();
          var secs = Math.min(VOICE_MAX, (Date.now() - started) / 1000);
          var blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
          if (secs < 1 || !blob.size) { toast('Enregistrement trop court.'); draw(); settle(); return; }
          blobToB64(blob).then(function (b64) {
            state.action = 'set'; state.b64 = b64; state.secs = Math.round(secs); state.url = URL.createObjectURL(blob);
            onChange(); draw(); settle();
          }, function () { draw(); settle(); });
        };
        started = Date.now();
        rec.start();
        var bar = h('i'), clock = h('span', { class: 'muted', id: 'voice-clock' }, '0:00 / ' + secsText(VOICE_MAX));
        setKids(box, h('div', { class: 'voice rec' },
          h('button', { class: 'btn vbtn', type: 'button', id: 'voice-stop', 'aria-label': 'Arrêter', onclick: function () { try { rec.stop(); } catch (e) { /* rien */ } } }, icon('stop', 24)),
          h('div', { class: 'vtxt' }, h('strong', null, 'Parlez maintenant…'), clock, h('div', { class: 'vbar' }, bar))));
        timer = setInterval(function () {
          var el = (Date.now() - started) / 1000;
          clock.textContent = secsText(el) + ' / ' + secsText(VOICE_MAX);
          bar.style.width = Math.min(100, el / VOICE_MAX * 100) + '%';
          if (el >= VOICE_MAX) { try { rec.stop(); } catch (e) { /* rien */ } }
        }, 250);
      }, function () {
        asking = false;
        setKids(box, h('div', { class: 'voice' }, h('span', { class: 'vbtn btn ghost', 'aria-hidden': 'true' }, icon('mic', 24)),
          h('div', { class: 'vtxt' }, h('strong', null, 'Micro non autorisé'), h('span', { class: 'muted' }, 'Autorisez le micro dans les réglages du navigateur, puis réessayez.'))));
        setTimeout(draw, 5000);
      });
    }
    draw();
    box.stop = finish;
    return box;
  }
  // Sources du repère vocal : lien reçu (fiche ou course) ou accès privé (propriétaire, demandeur, boutique).
  function voiceFrom(token, via) { return function () { return api('fiila_voice', { p_token: token, p_via: via }); }; }
  function voicePrivate(kind, id, key) { return function () { return api('fiila_voice_private', { p_kind: kind, p_id: id, p_key: key || null }); }; }
  // Joue un son ; si le téléphone refuse (iPhone : le son est arrivé après le toucher), on demande un second toucher.
  function playAudio(audio, btn, status, secs) {
    onMedia(function () { audio.pause(); });
    audio.onended = function () { setKids(btn, icon('play', 24)); };
    setKids(btn, icon('stop', 24));
    var pr = audio.play();
    if (pr && pr.then) pr.then(function () { if (status) status.textContent = secsText(secs); }, function () {
      setKids(btn, icon('play', 24));
      if (status) status.textContent = 'Touchez encore pour écouter.';
    });
  }
  // Lecteur : rien n'est chargé avant le toucher.
  function voicePlayer(load, secs) {
    var audio = null, loading = false;
    var btn = h('button', { class: 'btn vbtn', type: 'button', id: 'voice-listen', 'aria-label': 'Écouter le repère vocal' }, icon('play', 24));
    var status = h('span', { class: 'muted' }, secsText(secs));
    btn.onclick = function () {
      if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; setKids(btn, icon('play', 24)); return; }
      if (audio) { playAudio(audio, btn, status, secs); return; }
      if (loading) return;
      loading = true; status.textContent = 'Chargement…';
      load().then(function (r) {
        loading = false;
        if (!r || r.state !== 'ok') { status.textContent = 'Indisponible.'; return; }
        secs = r.secs || secs;
        audio = new Audio(r.voice);
        playAudio(audio, btn, status, secs);
      }, function (e) { loading = false; status.textContent = errText(e); });
    };
    return h('div', { class: 'voice', id: 'voice-player' }, btn, h('div', { class: 'vtxt' }, h('strong', null, 'Écouter le repère'), status));
  }
  function voiceOwnerBox(pl, owner) {
    return h('section', { class: 'stack tight' }, voicePlayer(voicePrivate('place', pl.id, owner), pl.voice_secs));
  }


  /* ================================================================ VITRINE PUBLIQUE DE LA BOUTIQUE
     #/b/<slug> : articles visibles, panier en mémoire (rien n'est écrit sur le téléphone), commande en ligne.
     La commande crée la demande d'adresse : la personne donne son adresse depuis la facture. */
  // Modèles et couleurs de vitrine (palette fermée : texte blanc lisible sur chaque couleur).
  var VT_THEMES = [['galerie', 'Galerie', 'Grandes vignettes, deux par ligne'], ['catalogue', 'Catalogue', 'Liste compacte, beaucoup d’articles'],
    ['magazine', 'Magazine', 'Une grande photo par article']];
  var VT_ACCENTS = { foret: ['Forêt', '#1E4A34'], nuit: ['Nuit', '#1F2A37'], indigo: ['Indigo', '#2F3E9E'], prune: ['Prune', '#5B2A86'],
    bordeaux: ['Bordeaux', '#7A1F3D'], terre: ['Terre', '#8A4B1F'] };
  function vitrineUrl(slug, productId) { return baseUrl() + '#/b/' + slug + (productId ? '?a=' + productId : ''); }
  function viewVitrine(slug, q) {
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return page(brandBar('Boutique'), stateCard('?', 'Vitrine introuvable', 'Vérifiez que le lien a été copié en entier.'), footer(true));
    return api('fiila_vitrine', { p_slug: slug }).then(function (r) {
      if (r.state === 'closed') return page(brandBar('Boutique'), stateCard('⦸', r.shop.name, 'La vitrine est fermée pour le moment.'), footer(true));
      if (r.state !== 'ok') return page(brandBar('Boutique'), stateCard('?', 'Vitrine introuvable', 'Vérifiez que le lien a été copié en entier.'), footer(true));
      return vitrinePage(slug, r.shop, r.products, q || {});
    }, function (e) { return page(brandBar('Boutique'), stateCard('!', 'Impossible d’afficher la vitrine', errText(e), retryBtn()), footer(true)); });
  }
  function vitrinePage(slug, shop, products, q) {
    var cart = {}; // ligne (article, taille, couleur) → { id, size, color, qty }
    var byId = {}; products.forEach(function (p) { byId[p.id] = p; });
    var filter = { cat: '', size: '', gender: '', age: '' };
    function lineKey(id, size, color) { return id + '|' + (size || '') + '|' + (color || ''); }
    function qtyOf(id) { return Object.keys(cart).reduce(function (n, k) { return n + (cart[k].id === id ? cart[k].qty : 0); }, 0); }
    function lineLabel(l) { var v = [l.size, l.color].filter(Boolean).join(' · '); return byId[l.id].name + (v ? ' (' + v + ')' : ''); }
    var bar = h('div', { class: 'cartbar', hidden: true });
    var root = h('div', { class: 'stack' });
    function count() { return Object.keys(cart).reduce(function (n, k) { return n + cart[k].qty; }, 0); }
    function total() { return Object.keys(cart).reduce(function (n, k) { return n + cart[k].qty * byId[cart[k].id].price; }, 0); }
    function refreshBar() {
      var n = count();
      bar.hidden = !n;
      setKids(bar, iconBtn('button', { class: 'btn big', type: 'button', id: 'cart-go', onclick: checkout }, 'box',
        'Commander · ' + n + ' article' + (n > 1 ? 's' : '') + ' · ' + fcfa(total())));
    }
    function maxQty(p) { return p.stock != null ? Math.min(99, p.stock) : 99; }
    function stepper(p) {
      var box = h('div', { class: 'qty' });
      var one = { size: p.sizes && p.sizes.length === 1 ? p.sizes[0] : null, color: p.colors && p.colors.length === 1 ? p.colors[0] : null };
      var k = lineKey(p.id, one.size, one.color);
      function draw() {
        var n = cart[k] ? cart[k].qty : 0;
        setKids(box, n ? [
          h('button', { class: 'qbtn', type: 'button', 'aria-label': 'Retirer un ' + p.name, onclick: function () { if (--cart[k].qty <= 0) delete cart[k]; draw(); refreshBar(); } }, '−'),
          h('span', { class: 'qn', 'aria-live': 'polite' }, String(n)),
          h('button', { class: 'qbtn', type: 'button', 'aria-label': 'Ajouter un ' + p.name, onclick: function () { if (qtyOf(p.id) < maxQty(p)) cart[k].qty++; draw(); refreshBar(); } }, '+')]
          : iconBtn('button', { class: 'btn small add-btn', type: 'button', 'data-add': p.id, onclick: function () { cart[k] = { id: p.id, size: one.size, color: one.color, qty: 1 }; draw(); refreshBar(); } }, 'plus', 'Ajouter', 18));
      }
      draw();
      return box;
    }
    // Article avec tailles ou couleurs : on choisit, puis « Ajouter » ; chaque choix fait sa ligne de commande.
    // Article avec plusieurs tailles ou couleurs : la carte reste simple (« Ajouter ») ; le choix se fait dans une feuille.
    function variantPicker(p) {
      var box = h('div', { class: 'stack tight vpick' });
      function draw() {
        var inCart = qtyOf(p.id);
        setKids(box,
          iconBtn('button', { class: 'btn small add-btn', type: 'button', 'data-add': p.id, onclick: function () { if (inCart >= maxQty(p)) { toast('Plus de stock disponible.'); return; } choose(p, draw); } }, 'plus', 'Ajouter', 18),
          inCart ? h('p', { class: 'small vin' }, icon('check', 14), ' ' + inCart + (inCart > 1 ? ' ajoutés' : ' ajouté')) : null);
      }
      draw();
      return box;
    }
    function choose(p, done) {
      var pick = { size: p.sizes && p.sizes.length === 1 ? p.sizes[0] : (filter.size && p.sizes && p.sizes.indexOf(filter.size) >= 0 ? filter.size : ''),
                   color: p.colors && p.colors.length === 1 ? p.colors[0] : '' };
      var note = h('p', { class: 'small', role: 'alert' });
      var body = h('div', { class: 'stack' });
      function chips(list, key, label) {
        return h('div', { class: 'stack tight' }, h('p', { class: 'small muted' }, label), h('div', { class: 'opt-row', role: 'group', 'aria-label': label }, list.map(function (v) {
          return h('button', { class: 'opt' + (pick[key] === v ? ' on' : ''), type: 'button', 'aria-pressed': pick[key] === v ? 'true' : 'false', onclick: function () { pick[key] = v; draw(); } }, v);
        })));
      }
      function draw() {
        // Une option unique s'affiche en texte (règle 7), jamais en bouton.
        var fixed = [p.sizes && p.sizes.length === 1 ? 'Taille ' + p.sizes[0] : '', p.colors && p.colors.length === 1 ? p.colors[0] : ''].filter(Boolean);
        setKids(body,
          fixed.length ? h('p', { class: 'small muted', id: 'variant-fixed' }, fixed.join(' · ')) : null,
          p.sizes && p.sizes.length > 1 ? chips(p.sizes, 'size', 'Taille ou pointure') : null,
          p.colors && p.colors.length > 1 ? chips(p.colors, 'color', 'Couleur') : null);
      }
      draw();
      var back = h('div', { class: 'sheet-back', id: 'variant-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'variant-h', onclick: function (e) { if (e.target === back) close(); } },
        h('div', { class: 'sheet' }, h('h2', { id: 'variant-h', class: 'wrapword' }, p.name), h('p', { class: 'vprice' }, fcfa(p.price)), body, note,
          iconBtn('button', { class: 'btn', type: 'button', id: 'variant-add', onclick: function () {
            if (p.sizes && p.sizes.length && !pick.size) { note.textContent = 'Choisissez votre taille ou pointure.'; return; }
            if (p.colors && p.colors.length && !pick.color) { note.textContent = 'Choisissez une couleur.'; return; }
            var k = lineKey(p.id, pick.size, pick.color);
            if (cart[k]) cart[k].qty++; else cart[k] = { id: p.id, size: pick.size || null, color: pick.color || null, qty: 1 };
            close(); done(); refreshBar();
          } }, 'plus', 'Ajouter à la commande'),
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Annuler')));
      var closeSheet; function close() { closeSheet(); }
      closeSheet = openSheet(back);
    }
    function card(p) {
      var img;
      if (p.has_photo && p.photos > 1) {
        img = photoCarousel(p.photos, function (k) { return api('fiila_vitrine_photo', { p_slug: slug, p_id: k ? p.id + ':' + k : p.id }).then(function (x) { return x.photo; }); }, p.name, 'vimg');
      } else {
        img = h('div', { class: 'vimg' + (p.has_photo ? ' loading-skel' : ''), 'aria-hidden': p.has_photo ? null : 'true' }, p.has_photo ? null : icon('shop', 32));
        if (p.has_photo) lazyPhoto(img, function () {
          return api('fiila_vitrine_photo', { p_slug: slug, p_id: p.id }).then(function (x) { return x.photo; });
        }, p.name);
      }
      return h('article', { class: 'vcard' + (q.a === p.id ? ' focus' : ''), id: 'p-' + p.id },
        img,
        h('div', { class: 'vbody' },
          h('h3', { class: 'wrapword' }, p.name),
          h('p', { class: 'vprice' }, fcfa(p.price)),
          p.reviews ? ratingEl(p.rating, p.reviews) : null,
          // Une seule ligne d'informations, discrète (âge, taille, état) ; le genre est déjà dans le filtre.
          (function () {
            var one = p.sizes && p.sizes.length === 1 && !(p.colors && p.colors.length > 1);
            var bits = [lbl(VD_AGES, p.age_band), one ? (p.age_band ? p.sizes[0] : 'Taille ' + p.sizes[0]) : null, one && p.colors && p.colors.length === 1 ? p.colors[0] : null, lbl(VD_CONDITIONS, p.condition)].filter(Boolean);
            return bits.length ? h('p', { class: 'small muted vinfo' }, bits.join(' · ')) : null;
          })(),
          p.description ? h('p', { class: 'small muted vdesc' }, p.description) : null,
          p.stock === 0 ? h('span', { class: 'chip off', style: 'align-self:flex-start' }, 'Épuisé')
            : (p.sizes && p.sizes.length > 1) || (p.colors && p.colors.length > 1) ? variantPicker(p) : stepper(p),
          p.stock > 0 && p.stock <= 3 && !shop.platform ? h('p', { class: 'small muted' }, 'Plus que ' + p.stock + ' en stock') : null));
    }
    // Filtres : catégories (s'il y en a au moins deux) et « ma taille / pointure ».
    var grid = h('div', { class: 'vgrid', id: 'vitrine-products' });
    var filters = h('div', { class: 'stack tight', id: 'vitrine-filters' });
    function shown() {
      return products.filter(function (p) { return (!filter.cat || p.category === filter.cat) && (!filter.size || (p.sizes && p.sizes.indexOf(filter.size) >= 0))
        && (!filter.gender || p.gender === filter.gender || p.gender === 'mixte') && (!filter.age || p.age_band === filter.age); });
    }
    function drawGrid() {
      var l = shown();
      setKids(grid, l.length ? l.map(card) : h('p', { class: 'muted', style: 'grid-column:1/-1' }, 'Aucun article pour ce choix.'));
    }
    // Règle « simple et intuitif » (fondateur, 19/10) : une seule rangée de filtres visible ; le reste dans « Filtres ».
    function drawFilters() {
      var cats = []; products.forEach(function (p) { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
      var sizes = []; products.forEach(function (p) { (p.sizes || []).forEach(function (z) { if (sizes.indexOf(z) < 0) sizes.push(z); }); });
      var ages = VD_AGES.filter(function (a) { return products.some(function (p) { return p.age_band === a[0]; }); });
      var byGender = products.some(function (p) { return p.gender; });
      function chip(on, label, fn) { return h('button', { class: 'opt' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label); }
      function set(k, v) { filter[k] = v; drawFilters(); drawGrid(); }
      // Catégorie d'abord quand il y en a plusieurs (vide-dressing ouvert à tout article, 20/10) ; sinon « Pour » (enfants).
      var primary = cats.length >= 2 ? h('div', { class: 'opt-row scroll', role: 'group', 'aria-label': 'Catégorie', id: 'filter-cat' },
            chip(!filter.cat, 'Tout', function () { set('cat', ''); }),
            cats.map(function (c) { return chip(filter.cat === c, catLabel(c) || c, function () { set('cat', c); }); }))
        : byGender ? h('div', { class: 'opt-row', role: 'group', 'aria-label': 'Pour', id: 'filter-gender' },
            chip(!filter.gender, 'Tous', function () { set('gender', ''); }),
            VD_GENDERS.filter(function (g) { return g[0] !== 'mixte'; }).map(function (g) { return chip(filter.gender === g[0], g[1], function () { set('gender', g[0]); }); }))
        : null;
      // Filtres secondaires : dans une feuille, jamais affichés en rangées.
      var more = [];
      if (byGender && cats.length >= 2) more.push(['gender', 'Pour (enfants)', VD_GENDERS.filter(function (g) { return g[0] !== 'mixte'; })]);
      if (ages.length >= 2) more.push(['age', 'Âge', ages]);
      if (sizes.length >= 2) more.push(['size', 'Taille ou pointure', sizes.map(function (z) { return [z, z]; })]);
      var active = more.filter(function (m) { return filter[m[0]]; }).length;
      var btn = more.length ? h('button', { class: 'opt filt-btn' + (active ? ' on' : ''), type: 'button', id: 'filter-more', 'aria-haspopup': 'dialog', onclick: function () { sheet(more); } },
        icon('settings', 16), active ? 'Filtres · ' + active : 'Filtres') : null;
      setKids(filters, primary || btn ? h('div', { class: 'filt-bar' }, primary, btn) : null);
    }
    function sheet(more) {
      var draft = {}; more.forEach(function (m) { draft[m[0]] = filter[m[0]]; });
      var back = h('div', { class: 'sheet-back', id: 'filter-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'filter-sheet-h', onclick: function (e) { if (e.target === back) close(); } },
        h('div', { class: 'sheet' }, h('h2', { id: 'filter-sheet-h' }, 'Filtres'),
          more.map(function (m) {
            return h('div', { class: 'field' }, h('label', { for: 'fs-' + m[0] }, m[1]),
              h('select', { id: 'fs-' + m[0], onchange: function (e) { draft[m[0]] = e.target.value; } },
                h('option', { value: '' }, 'Tous'), m[2].map(function (o) { return h('option', { value: o[0], selected: draft[m[0]] === o[0] || null }, o[1]); })));
          }),
          h('button', { class: 'btn', type: 'button', id: 'filter-apply', onclick: function () { Object.keys(draft).forEach(function (k) { filter[k] = draft[k] || ''; }); close(); drawFilters(); drawGrid(); } }, 'Voir les articles'),
          h('button', { class: 'btn ghost', type: 'button', id: 'filter-clear', onclick: function () { Object.keys(draft).forEach(function (k) { filter[k] = ''; }); close(); drawFilters(); drawGrid(); } }, 'Effacer les filtres')));
      var closeSheet; function close() { closeSheet(); }
      closeSheet = openSheet(back);
    }
    function list() {
      setKids(root,
        h('header', { class: 'vhead' },
          h('span', { class: 'vavatar', 'aria-hidden': 'true' }, (shop.name || '?').trim().charAt(0).toUpperCase()),
          h('div', null, h('h1', { class: 'wrapword' }, shop.name),
            shop.reviews ? ratingEl(shop.rating, shop.reviews) : null,
            shop.about ? h('p', { class: 'muted wrapword' }, shop.about) : null)),
        shop.demo ? h('div', { class: 'demo-banner', id: 'vitrine-demo' }, h('span', null, h('b', null, 'Boutique fictive de démonstration.'), ' Les commandes passées ici ne sont pas livrées.')) : null,
        q.a && !byId[q.a] ? h('p', { class: 'msg', id: 'vitrine-gone' }, 'Cet article n’est plus proposé. Voici les autres articles de la boutique.') : null,
        products.length ? [filters, grid] : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Aucun article pour le moment.')),
        h('p', { class: 'safe-line' }, icon('lock', 18), 'Commande sans compte. Vous donnez votre adresse à la dernière étape.'),
        shop.socials ? h('nav', { class: 'vsocials', id: 'vitrine-socials', 'aria-label': 'Suivre ' + shop.name },
          h('span', { class: 'small muted' }, 'Suivre la boutique'),
          SOCIALS.filter(function (o) { return shop.socials[o[0]]; }).map(function (o) {
            return h('a', { class: 'vsoc', href: socialUrl(o[0], shop.socials[o[0]]), target: '_blank', rel: 'noopener noreferrer', 'aria-label': o[1] + ' : @' + shop.socials[o[0]] }, icon(o[0], 20));
          })) : null);
      if (products.length) { drawFilters(); drawGrid(); }
      refreshBar();
      if (q.a && byId[q.a]) setTimeout(function () { var el = document.getElementById('p-' + q.a); if (el) el.scrollIntoView({ block: 'center' }); }, 60);
    }
    function checkout() {
      var f = { name: '', phone: '', note: '' };
      var err = h('div', { role: 'alert' });
      var send = iconBtn('button', { class: 'btn big', type: 'button', id: 'order-send', onclick: function () {
        setKids(err);
        if (!f.name.trim()) return errBox(err, new ApiError('your_name_required'));
        if (f.phone.replace(/\D/g, '').length < 9) return errBox(err, new ApiError('phone_required'));
        send.disabled = true;
        api('fiila_vitrine_order', { p_slug: slug, p: { items: Object.keys(cart).map(function (k) { var l = cart[k]; return { product_id: l.id, qty: l.qty, size: l.size || undefined, color: l.color || undefined }; }),
          customer: { name: f.name.trim(), phone: f.phone.trim() }, note: f.note.trim() || null } }).then(function (r) {
          go('#/f/' + r.invoice + '?nouvelle=1');
        }, function (e) { send.disabled = false; errBox(err, e); });
      } }, 'send', 'Envoyer la commande');
      bar.hidden = true;
      setKids(root,
        h('button', { class: 'back', type: 'button', onclick: list }, '← Modifier la commande'),
        h('h1', null, 'Votre commande'),
        h('section', { class: 'card' },
          Object.keys(cart).map(function (k) {
            var l = cart[k];
            return h('div', { class: 'total-row' }, h('span', { class: 'wrapword' }, l.qty + ' × ' + lineLabel(l)), h('span', null, fcfa(l.qty * byId[l.id].price)));
          }),
          h('div', { class: 'total-row big' }, h('span', null, 'Total'), h('strong', { id: 'order-total' }, fcfa(total())))),
        textField({ id: 'v-name', label: 'Votre nom', max: 60, autocomplete: 'name', onInput: function (v) { f.name = v; } }),
        textField({ id: 'v-phone', label: 'Votre numéro WhatsApp', type: 'tel', inputmode: 'tel', autocomplete: 'tel', onInput: function (v) { f.phone = v; } }),
        textField({ id: 'v-note', label: 'Précision pour la boutique', optional: true, max: 200, placeholder: 'Ex. : taille M, couleur bleue', onInput: function (v) { f.note = v; } }),
        h('p', { class: 'safe-line' }, icon('lock', 18), 'Votre nom et votre numéro vont uniquement à ' + shop.name + '.'),
        err, send);
      window.scrollTo(0, 0);
    }
    list();
    var theme = ['galerie', 'catalogue', 'magazine'].indexOf(shop.theme) >= 0 ? shop.theme : 'galerie';
    var cover = shop.has_cover ? h('div', { class: 'vcover loading-skel', id: 'vitrine-cover' }) : null;
    if (cover) lazyPhoto(cover, function () { return api('fiila_vitrine_photo', { p_slug: slug, p_id: 'cover' }).then(function (x) { return x.photo; }); }, '');
    var pg = page(brandBar('Boutique'), cover, root, h('div', { style: 'height:80px' }), footer(true));
    pg.classList.add('vt', 'vt-' + theme);
    pg.style.setProperty('--accent', (VT_ACCENTS[shop.accent] || VT_ACCENTS.foret)[1]);
    pg.appendChild(bar);
    return pg;
  }
  // Photo chargée quand la carte arrive à l'écran (page légère sur réseau lent).

  /* ----- carrousel des photos d'un article (2 à 5 photos) : glisser au doigt, points, défilement automatique doux quand
     la carte est bien visible, arrêté dès qu'on y touche ; photos chargées une à une, à l'approche. */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function photoCarousel(n, load, alt, cls) {
    var slides = [], loaded = [], dots = [], idx = 0, visible = false, pausedUntil = 0;
    var track = h('div', { class: 'pc-track', tabindex: '0', role: 'group', 'aria-roledescription': 'carrousel', 'aria-label': (alt || 'Article') + ' : ' + n + ' photos' });
    for (var i = 0; i < n; i++) {
      var sl = h('div', { class: 'pc-slide loading-skel', role: 'group', 'aria-roledescription': 'photo', 'aria-label': (i + 1) + ' sur ' + n });
      slides.push(sl); track.appendChild(sl);
    }
    var count = h('span', { class: 'pc-count', 'aria-hidden': 'true' }, '1/' + n);
    var dotsBox = h('div', { class: 'pc-dots' });
    for (var j = 0; j < n; j++) (function (k) {
      var d = h('button', { type: 'button', class: 'pc-dot' + (k === 0 ? ' on' : ''), 'aria-label': 'Photo ' + (k + 1) + ' sur ' + n, 'aria-current': k === 0 ? 'true' : null,
        onclick: function (e) { e.stopPropagation(); pause(); go(k); } });
      dots.push(d); dotsBox.appendChild(d);
    })(j);
    var wrap = h('div', { class: (cls || '') + ' pc' }, track, count, dotsBox);
    function ensure(k) {
      if (k < 0 || k >= n || loaded[k]) return;
      loaded[k] = true;
      load(k).then(function (src) {
        slides[k].classList.remove('loading-skel');
        if (src) setKids(slides[k], h('img', { src: src, alt: k === 0 ? (alt || '') : '', decoding: 'async', draggable: 'false' }));
      }, function () { slides[k].classList.remove('loading-skel'); loaded[k] = false; });
    }
    function mark(k) {
      if (k === idx && slides[k].classList.contains('on')) return;
      idx = k;
      slides.forEach(function (x, m) { x.classList.toggle('on', m === k); });
      dots.forEach(function (x, m) { x.classList.toggle('on', m === k); if (m === k) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
      count.textContent = (k + 1) + '/' + n;
      ensure(k); ensure(k + 1);
    }
    function go(k) {
      ensure(k);
      track.scrollTo({ left: k * track.clientWidth, behavior: REDUCED ? 'auto' : 'smooth' });
    }
    function pause() { pausedUntil = Date.now() + 9000; }
    var raf = 0;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; var w = track.clientWidth || 1; mark(Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / w)))); });
    }, { passive: true });
    ['pointerdown', 'touchstart', 'wheel', 'focusin'].forEach(function (ev) { track.addEventListener(ev, pause, { passive: true }); });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); pause(); go(Math.min(n - 1, idx + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); go(Math.max(0, idx - 1)); }
    });
    mark(0);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { visible = e.intersectionRatio >= 0.6; if (e.isIntersecting) { ensure(0); ensure(1); } }); },
        { threshold: [0, 0.6], rootMargin: '200px 0px' });
      setTimeout(function () { io.observe(wrap); }, 0);
      onMedia(function () { io.disconnect(); });
    } else { ensure(0); ensure(1); visible = true; }
    if (!REDUCED) {
      var timer = setInterval(function () {
        if (!visible || Date.now() < pausedUntil || document.visibilityState === 'hidden' || !wrap.isConnected) return;
        if (!loaded[(idx + 1) % n]) { ensure((idx + 1) % n); return; }
        go((idx + 1) % n);
      }, 3800);
      onMedia(function () { clearInterval(timer); });
    }
    return wrap;
  }
  // Photos de l'article dans la boutique : 5 au plus, la première est la principale (factures, fil), toutes au format 4:5.
  function productPhotos(pr) {
    // items : { src (photo 4:5 ou ancienne photo), orig (pour recadrer), off (hors format) }
    var st = { list: pr && pr.photo ? [{ src: pr.photo, orig: pr.photo }] : [], ready: !(pr && pr.photos > 1), changed: false, failed: false };
    var box = h('div', { class: 'stack', id: 'product-photos' });
    var msg = h('p', { class: 'msg', role: 'status' });
    function check(it) {
      urlToImage(it.src).then(function (im) { var off = !isRatio(im); if (off !== !!it.off) { it.off = off; draw(); } }, function () {});
    }
    var inp = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'product-photo', hidden: true, onchange: function () {
      var files = Array.prototype.slice.call(inp.files || []).slice(0, 5 - st.list.length);
      inp.value = '';
      if (!files.length) return;
      msg.textContent = files.length > 1 ? 'Préparation des photos…' : 'Préparation de la photo…'; msg.className = 'msg info';
      files.reduce(function (pp, fl) {
        return pp.then(function () { return importProductPhoto(fl).then(function (d) { if (st.list.length < 5) { st.list.push({ src: d.photo, orig: d.orig }); st.changed = true; draw(); } }); });
      }, Promise.resolve()).then(function () { msg.textContent = ''; }, function (e) { msg.textContent = e.message; msg.className = 'msg err'; });
    } });
    st.list.forEach(check);
    if (!st.ready) sapi('fiila_product_photos', { p_id: pr.id }).then(function (l) {
      (l || []).forEach(function (src) { var it = { src: src, orig: src }; st.list.push(it); check(it); });
      st.ready = true; draw();
    }, function () { st.failed = true; draw(); });
    function recrop(it) {
      cropSheet(it.orig).then(function (d) { if (d) { it.src = d; it.off = false; st.changed = true; draw(); } }, function (e) { msg.textContent = e.message; msg.className = 'msg err'; });
    }
    function draw() {
      var tiles = st.list.map(function (it, i) {
        return h('div', { class: 'pp-tile' + (i === 0 ? ' main' : '') + (it.off ? ' off' : '') },
          h('button', { type: 'button', class: 'pp-img', 'aria-label': i === 0 ? 'Photo principale' : 'Mettre la photo ' + (i + 1) + ' en principale',
            disabled: i === 0 || !st.ready || null, onclick: function () { st.list.unshift(st.list.splice(i, 1)[0]); st.changed = true; draw(); } },
            h('img', { src: it.src, alt: '' })),
          i === 0 && st.list.length > 1 && !it.off ? h('span', { class: 'pp-badge' }, 'Principale') : null,
          it.off ? h('span', { class: 'pp-badge warn' }, 'À recadrer') : null,
          st.ready ? h('button', { type: 'button', class: 'pp-crop', 'aria-label': 'Recadrer la photo ' + (i + 1), onclick: function () { recrop(it); } }, icon('edit', 16)) : null,
          st.ready ? h('button', { type: 'button', class: 'pp-del', 'aria-label': 'Retirer la photo ' + (i + 1), onclick: function () { st.list.splice(i, 1); st.changed = true; draw(); } }, icon('trash', 16)) : null);
      });
      if (!st.ready && !st.failed) tiles.push(h('div', { class: 'pp-tile loading-skel', 'aria-hidden': 'true' }));
      if (st.ready && st.list.length < 5) tiles.push(h('button', { type: 'button', class: 'pp-add', id: 'product-photo-add', onclick: function () { inp.click(); } },
        icon('cam', 24), h('span', null, st.list.length ? 'Ajouter' : 'Ajouter des photos')));
      var offN = st.list.filter(function (x) { return x.off; }).length;
      setKids(box,
        h('span', { class: 'label' }, 'Photos de l’article ', h('span', { class: 'hint' }, '(facultatif, 5 au plus, format 4:5)')),
        h('div', { class: 'pp-grid', id: 'product-photo-grid' }, tiles),
        st.failed ? h('p', { class: 'msg err' }, 'Photos supplémentaires indisponibles : rechargez la page pour les modifier.') : null,
        offN ? h('p', { class: 'hint', id: 'product-photo-off' }, offN === 1 ? 'Une photo n’est pas au format des cartes : elle sera recadrée au centre à l’enregistrement, ou recadrez-la vous-même.'
          : offN + ' photos ne sont pas au format des cartes : elles seront recadrées au centre à l’enregistrement, ou recadrez-les vous-même.')
          : st.list.length > 1 && st.ready ? h('p', { class: 'hint' }, 'Touchez une photo pour la mettre en principale.') : null,
        inp, msg);
    }
    draw();
    return {
      el: box, count: function () { return st.list.length; },
      // Photos à envoyer (null si rien n'a changé) ; les photos hors format sont recadrées au centre avant l'envoi.
      payload: function () {
        var off = st.list.filter(function (x) { return x.off; });
        if ((!st.changed && !off.length) || !st.ready) return Promise.resolve(null);
        return Promise.all(off.map(function (it) { return urlToImage(it.src).then(function (im) { it.src = cropToRatio(im); it.off = false; }); })).then(function () {
          return Promise.all(st.list.map(function (it) { return srcToDataUrl(it.src); }));
        }).then(function (all) {
          var b = function (d) { return d.replace(/^data:[^,]+,/, ''); };
          return { photo: all[0] ? b(all[0]) : '', photos: all.slice(1).map(b) };
        });
      }
    };
  }
  function lazyPhoto(box, load, alt) {
    function go() {
      load().then(function (src) {
        if (!src) { box.classList.remove('loading-skel'); return; }
        setKids(box, h('img', { src: src, alt: alt || '', decoding: 'async' })); box.classList.remove('loading-skel');
      }, function () { box.classList.remove('loading-skel'); });
    }
    if (!('IntersectionObserver' in window)) { go(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); go(); } }, { rootMargin: '200px' });
    setTimeout(function () { io.observe(box); }, 0);
  }
  /* ----- fil des boutiques : les 25 premières boutiques ouvertes, mises en avant gratuitement (fondateur, 19/10).
     Une image par boutique (couverture, sinon dernier article), chargée au défilement : peu de données mobiles. */
  var FEED_CACHE = null;
  // Mode démo (#/demo) : ce téléphone voit aussi les boutiques fictives de démonstration, toujours marquées « Démo ».
  var DEMO_LS = 'fiila.demo';
  function demoMode() { return LS.get(DEMO_LS, false) === true; }
  function loadFeed() {
    var demo = demoMode();
    if (FEED_CACHE && FEED_CACHE.demo === demo && Date.now() - FEED_CACHE.at < 120000) return Promise.resolve(FEED_CACHE.data);
    return api('fiila_feed', demo ? { p_demo: true } : {}).then(function (d) { FEED_CACHE = { at: Date.now(), demo: demo, data: d }; return d; });
  }
  function demoBanner() {
    if (!demoMode()) return null;
    return h('div', { class: 'demo-banner', id: 'demo-banner' }, h('span', null, h('b', null, 'Mode démo'), ' : les boutiques fictives sont visibles, marquées « Démo ».'),
      h('a', { href: '#/demo?off=1', class: 'btn link' }, 'Quitter'));
  }
  function viewDemo(q) {
    if (q && q.off) { LS.del(DEMO_LS); FEED_CACHE = null; toast('Mode démo désactivé.'); redirect('#/'); return loading(); }
    LS.set(DEMO_LS, true); FEED_CACHE = null; toast('Mode démo activé : boutiques fictives visibles.'); redirect('#/boutiques'); return loading();
  }
  function feedCard(s) {
    var img = h('span', { class: 'fimg loading-skel', 'aria-hidden': 'true' }, icon('shop', 28));
    if (s.has_cover || s.photo_id) lazyPhoto(img, function () {
      return api('fiila_vitrine_photo', { p_slug: s.slug, p_id: s.has_cover ? 'cover' : s.photo_id }).then(function (r) { return r.photo || null; });
    }, '');
    else img.classList.remove('loading-skel');
    var acc = (VT_ACCENTS[s.accent] || VT_ACCENTS.foret)[1];
    return h('a', { class: 'fcard', href: '#/b/' + s.slug, style: '--accent:' + acc, 'aria-label': 'Voir la boutique ' + s.name, 'data-cats': (s.categories || []).join(' ') },
      s.demo || s.platform ? h('span', { class: 'fwrap' }, img, h('span', { class: 'demo-tag' + (s.platform ? ' fl-tag' : '') }, s.demo ? 'Démo' : 'Par Fii')) : img,
      h('span', { class: 'fbody' },
        h('span', { class: 'fname wrapword' }, s.name),
        s.type ? h('span', { class: 'ftype' }, typeLabel(s.type)) : null,
        s.reviews ? ratingEl(s.rating, s.reviews) : null,
        s.about ? h('span', { class: 'small muted wrapword fabout' }, s.about) : null,
        h('span', { class: 'fitems' }, (s.products || []).map(function (p) {
          return h('span', { class: 'fitem' }, h('span', { class: 'wrapword' }, p.name), h('b', null, fcfa(p.price)));
        })),
        h('span', { class: 'fgo' }, s.count > 1 ? s.count + ' articles' : '1 article', icon('chev', 16))));
  }
  /* Carrousel apaisant : une boutique à la fois, la suivante qui dépasse ; avance seul toutes les 6 s avec un glissement
     lent, la photo s'approche doucement. S'arrête dès qu'on touche, quand il sort de l'écran ou quand l'onglet est caché.
     « Réduire les animations » du téléphone : pas de défilement automatique ni de mouvement de photo. */
  var CAROUSEL_MS = 6000;
  function carousel(cards) {
    var track = h('div', { class: 'feed-list car-track', role: 'group', 'aria-roledescription': 'carrousel', 'aria-label': 'Boutiques' }, cards);
    var dots = h('div', { class: 'car-dots', role: 'tablist', 'aria-label': 'Choisir une boutique' });
    var wrap = h('div', { class: 'car' }, track, cards.length > 1 ? dots : null);
    var idx = 0, timer = null, held = false, visible = true;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Points créés une fois (le focus clavier reste sur le point choisi) ; seules leurs classes changent.
    var dotEls = cards.map(function (c, i) {
      return h('button', { class: 'car-dot', type: 'button', role: 'tab', 'aria-label': 'Boutique ' + (i + 1) + ' sur ' + cards.length,
        style: '--car-ms:' + CAROUSEL_MS + 'ms', onclick: function () { held = true; go(i); } }, h('i'));
    });
    setKids(dots, dotEls);
    function drawDots() {
      dotEls.forEach(function (d, i) {
        d.classList.toggle('on', i === idx); d.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        d.classList.remove('run');
        if (i === idx && !calm && !held) { void d.offsetWidth; d.classList.add('run'); }
      });
    }
    // Cartes hors écran : « inert » (ni lues ni atteignables au clavier), plutôt qu'aria-hidden sur un lien focalisable.
    function mark() { cards.forEach(function (c, i) { c.classList.toggle('is-active', i === idx); c.inert = i !== idx; c.removeAttribute('aria-hidden'); }); drawDots(); }
    function go(i, auto) {
      idx = (i + cards.length) % cards.length;
      var c = cards[idx];
      track.scrollTo({ left: c.offsetLeft - 16, behavior: calm ? 'auto' : 'smooth' });
      mark(); plan();
    }
    function plan() {
      clearTimeout(timer);
      if (calm || held || cards.length < 2) return;
      timer = setTimeout(function () {
        if (!wrap.isConnected) return; // écran quitté : on s'arrête
        if (!visible || document.hidden) { plan(); return; }
        go(idx + 1, true);
      }, CAROUSEL_MS);
    }
    // Glisser à la main : on suit, et le défilement automatique s'arrête (la personne a pris la main).
    var scrollT = null;
    track.addEventListener('scroll', function () {
      clearTimeout(scrollT);
      scrollT = setTimeout(function () {
        var x = track.scrollLeft, best = 0, d = Infinity;
        cards.forEach(function (c, i) { var dd = Math.abs(c.offsetLeft - 16 - x); if (dd < d) { d = dd; best = i; } });
        if (best !== idx) { idx = best; mark(); }
      }, 90);
    }, { passive: true });
    ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) {
      track.addEventListener(ev, function () { if (!held) { held = true; clearTimeout(timer); drawDots(); } }, { passive: true });
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { visible = es.some(function (e) { return e.isIntersecting; }); }, { threshold: 0.5 });
      setTimeout(function () { io.observe(track); }, 0);
    }
    wrap.carousel = { go: go, index: function () { return idx; } };
    setTimeout(function () { mark(); plan(); }, 0);
    return wrap;
  }
  // Bloc du fil : sur l'accueil (3 boutiques) et à la fin d'une tâche (2 boutiques). Absent s'il n'y a encore aucune boutique.
  function feedSection(limit, o) {
    o = o || {};
    var box = h('section', { class: 'stack feed-block', id: o.id || 'feed-block', hidden: true, 'aria-labelledby': (o.id || 'feed-block') + '-h' });
    loadFeed().then(function (d) {
      var list = (d && d.shops) || [];
      if (!list.length) return;
      setKids(box,
        h('div', { class: 'feed-head' }, h('h2', { id: (o.id || 'feed-block') + '-h' }, o.title || 'Boutiques à découvrir'),
          list.length > limit ? h('a', { class: 'btn link', href: '#/boutiques', id: (o.id || 'feed-block') + '-all' }, 'Voir le fil') : null),
        o.sub ? h('p', { class: 'small muted' }, o.sub) : null,
        carousel(list.slice(0, limit).map(feedCard)));
      box.hidden = false;
    }, function () { /* hors ligne : le bloc reste caché */ });
    return box;
  }
  /* ----- Fil façon Instagram (fondateur, 19/10 09:34) : une publication par article avec photo des boutiques du fil.
     J'aime et Enregistrer sans compte (identifiant aléatoire du téléphone, créé au premier geste seulement) ;
     commenter avec un compte. Onglets : Pour vous, Meilleures ventes (commandes livrées), Coups de cœur. */
  var DEVICE_LS = 'fiila.device';
  function deviceId(create) {
    var d = LS.get(DEVICE_LS, null);
    if (d || !create) return d;
    var b = new Uint8Array(18); (window.crypto || window.msCrypto).getRandomValues(b);
    d = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    LS.set(DEVICE_LS, d);
    return d;
  }
  var FEED_TABS = [['pour-vous', 'Pour vous'], ['ventes', 'Best-sellers'], ['coeur', 'Coups de cœur']];
  function countText(n, one, many) { return n === 1 ? '1 ' + one : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + many; }
  function postCard(p) {
    var st = { liked: !!p.liked, saved: !!p.saved, likes: p.likes || 0, saves: p.saves || 0, comments: p.comments || 0 };
    var acc = (VT_ACCENTS[p.shop.accent] || VT_ACCENTS.foret)[1];
    var shopHref = '#/b/' + p.shop.slug, buyHref = shopHref + qs({ a: p.id });
    var img;
    if (p.photos > 1) img = photoCarousel(p.photos, function (k) { return api('fiila_vitrine_photo', { p_slug: p.shop.slug, p_id: k ? p.id + ':' + k : p.id }).then(function (r) { return r.photo || null; }); }, p.name, 'post-img');
    else {
      img = h('div', { class: 'post-img loading-skel' });
      lazyPhoto(img, function () { return api('fiila_vitrine_photo', { p_slug: p.shop.slug, p_id: p.id }).then(function (r) { return r.photo || null; }); }, p.name);
    }
    var burst = h('span', { class: 'post-burst', 'aria-hidden': 'true' }, icon('heart', 72));
    var likeBtn = h('button', { class: 'post-act', type: 'button', id: 'like-' + p.id, onclick: function () { react('like', !st.liked); } });
    var saveBtn = h('button', { class: 'post-act', type: 'button', id: 'save-' + p.id, onclick: function () { react('save', !st.saved); } });
    var likesLine = h('p', { class: 'post-likes' });
    var cLink = h('button', { class: 'post-more', type: 'button', id: 'comments-' + p.id, onclick: function () { openComments(p, st, draw); } });
    function draw() {
      likeBtn.className = 'post-act' + (st.liked ? ' on' : ''); likeBtn.setAttribute('aria-pressed', st.liked ? 'true' : 'false');
      likeBtn.setAttribute('aria-label', st.liked ? 'Je n’aime plus' : 'J’aime'); setKids(likeBtn, icon('heart', 26));
      saveBtn.className = 'post-act' + (st.saved ? ' on' : ''); saveBtn.setAttribute('aria-pressed', st.saved ? 'true' : 'false');
      saveBtn.setAttribute('aria-label', st.saved ? 'Retirer des enregistrés' : 'Enregistrer'); setKids(saveBtn, icon('bookmark', 26));
      likesLine.textContent = [st.likes ? countText(st.likes, 'j’aime', 'j’aime') : '', st.saves ? countText(st.saves, 'enregistrement', 'enregistrements') : ''].filter(Boolean).join(' · ');
      likesLine.hidden = !st.likes && !st.saves;
      cLink.textContent = st.comments ? (st.comments === 1 ? 'Voir le commentaire' : 'Voir les ' + st.comments + ' commentaires') : 'Ajouter un commentaire';
    }
    var reactSeq = { like: 0, save: 0 };
    function react(kind, on) {
      var key = kind === 'like' ? 'liked' : 'saved', cnt = kind === 'like' ? 'likes' : 'saves', mine = ++reactSeq[kind];
      var before = { v: st[key], n: st[cnt] };
      st[key] = on; st[cnt] = Math.max(0, st[cnt] + (on ? 1 : -1)); draw();
      if (kind === 'save') toast(on ? 'Enregistré. Retrouvez-le dans vos enregistrés.' : 'Retiré des enregistrés.');
      api('fiila_react', { p_product: p.id, p_kind: kind, p_on: on, p_device: deviceId(true), p_demo: demoMode() }).then(function (r) {
        if (mine !== reactSeq[kind]) return; // un toucher plus récent fait foi
        st.likes = r.likes; st.saves = r.saves; st.comments = r.comments; st.liked = !!r.liked; st.saved = !!r.saved; draw();
      }, function (e) { if (mine !== reactSeq[kind]) return; st[key] = before.v; st[cnt] = before.n; draw(); toast(errText(e)); });
    }
    // Double toucher sur la photo : j'aime (comme Instagram), avec un cœur qui apparaît puis s'efface.
    var lastTap = 0;
    img.addEventListener('click', function () {
      var now = Date.now();
      if (now - lastTap < 350) { burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go'); if (!st.liked) react('like', true); lastTap = 0; }
      else lastTap = now;
    });
    function share() {
      var url = baseUrl() + buyHref;
      if (navigator.share) navigator.share({ title: p.name, text: p.name + ' · ' + fcfa(p.price) + ' chez ' + p.shop.name, url: url }).catch(function () {});
      else copy(url, 'Lien');
    }
    draw();
    var badges = [p.best ? h('span', { class: 'post-badge best' }, icon('star', 14), ' Best-seller' + (p.sold ? ' · ' + countText(p.sold, 'vendu', 'vendus') : '')) : null,
      p.heart ? h('span', { class: 'post-badge heart' }, icon('heart', 14), ' Coup de cœur') : null].filter(Boolean);
    return h('article', { class: 'post', id: 'post-' + p.id, style: '--accent:' + acc },
      h('a', { class: 'post-head', href: shopHref },
        h('span', { class: 'post-av', 'aria-hidden': 'true' }, (p.shop.name || '?').trim().charAt(0).toUpperCase()),
        h('span', { class: 'post-who' }, h('b', { class: 'wrapword' }, p.shop.name), p.shop.type ? h('span', { class: 'small muted' }, typeLabel(p.shop.type)) : null),
        p.shop.demo || p.shop.platform ? h('span', { class: 'demo-tag' + (p.shop.platform ? ' fl-tag' : '') }, p.shop.demo ? 'Démo' : 'Par Fii') : null),
      h('div', { class: 'post-media' }, img, burst),
      h('div', { class: 'post-bar' }, likeBtn,
        h('button', { class: 'post-act', type: 'button', 'aria-label': 'Commenter', onclick: function () { openComments(p, st, draw); } }, icon('bubble', 25)),
        h('button', { class: 'post-act', type: 'button', 'aria-label': 'Partager', onclick: share }, icon('share', 26)),
        h('span', { class: 'grow' }), h('a', { class: 'post-buy', href: buyHref, id: 'buy-' + p.id }, 'Commander'), saveBtn),
      h('div', { class: 'post-body' }, likesLine,
        h('p', { class: 'post-cap' }, h('b', { class: 'wrapword' }, p.name), h('span', { class: 'post-price' }, fcfa(p.price))),
        badges.length ? h('p', { class: 'post-badges' }, badges) : null,
        cLink));
  }
  // Commentaires : feuille du bas. Lire sans compte ; écrire avec un compte ; la boutique et l'auteur suppriment ; tout le monde signale.
  function openComments(p, st, redraw) {
    var list = h('div', { class: 'stack tight cm-list', id: 'cm-list', 'aria-live': 'polite' }, h('p', { class: 'muted small' }, 'Chargement…'));
    var foot = h('div', { class: 'stack tight' });
    var back = h('div', { class: 'sheet-back', id: 'comments-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cm-h', onclick: function (e) { if (e.target === back) close(); } },
      h('div', { class: 'sheet cm-sheet' }, h('div', { class: 'cm-top' }, h('h2', { id: 'cm-h' }, 'Commentaires'),
        h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Fermer', onclick: close }, '×')), list, foot));
    var closeSheet; function close() { closeSheet(); }
    function load() {
      return api('fiila_comments', { p_product: p.id, p_key: shopKey(), p_device: deviceId(false), p_demo: demoMode() }).then(function (r) {
        if (r.state !== 'ok') { setKids(list, h('p', { class: 'muted' }, 'Cette publication n’est plus disponible.')); setKids(foot); return; }
        st.comments = r.comments.length;
        setKids(list, r.comments.length ? r.comments.map(function (c) {
          var acts = h('span', { class: 'cm-acts' },
            c.can_delete ? h('button', { class: 'btn link small', type: 'button', onclick: function () {
              if (window.confirm && !window.confirm('Supprimer ce commentaire ?')) return;
              this.disabled = true;
              api('fiila_comment_delete', { p_id: c.id, p_key: shopKey() }).then(function (x) { st.comments = x.comments; toast('Commentaire supprimé.'); load(); }, function (e) { toast(errText(e)); });
            } }, 'Supprimer') : null,
            r.can_comment && !c.mine && !c.reported ? h('button', { class: 'btn link small muted', type: 'button', 'aria-label': 'Signaler ce commentaire', onclick: function () {
              api('fiila_comment_report', { p_id: c.id, p_device: deviceId(true) }).then(function () { toast('Merci. Le commentaire sera vérifié.'); load(); }, function (e) { toast(errText(e)); });
            } }, 'Signaler') : null);
          return h('div', { class: 'cm' }, h('p', null, h('b', null, c.author), ' ', h('span', { class: 'wrapword' }, c.body)),
            h('p', { class: 'small muted cm-meta' }, agoLong(c.at), acts));
        }) : h('p', { class: 'muted', id: 'cm-empty' }, 'Aucun commentaire pour le moment. Soyez la première personne à donner votre avis.'));
        if (!r.can_comment) {
          setKids(foot, iconBtn('a', { class: 'btn ghost', href: '#/compte' + qs({ retour: 'boutiques' }), id: 'cm-login' }, 'user', 'Se connecter pour commenter'));
          return;
        }
        var err = h('div', { role: 'alert' });
        var input = h('textarea', { id: 'cm-input', rows: 2, maxlength: 300, placeholder: 'Votre commentaire…', 'aria-label': 'Votre commentaire' });
        var send = h('button', { class: 'btn', type: 'button', id: 'cm-send', onclick: function () {
          send.disabled = true; setKids(err);
          api('fiila_comment_add', { p_product: p.id, p_body: input.value, p_demo: demoMode() }).then(function (x) {
            st.comments = x.comments; input.value = ''; send.disabled = false; load();
          }, function (e) { send.disabled = false; errBox(err, e); });
        } }, 'Publier');
        setKids(foot, err, h('div', { class: 'cm-form' }, input, send),
          h('p', { class: 'small muted' }, 'Votre prénom est affiché. Pas de lien ni de numéro.'));
      }, function (e) { setKids(list, h('p', { class: 'muted' }, errText(e))); });
    }
    closeSheet = openSheet(back, { onClose: redraw });
    load();
  }
  function agoLong(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s) || s < 60) return 'à l’instant';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return Math.round(s / 3600) + ' h';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' j';
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function viewFeed(q) {
    var tab = FEED_TABS.some(function (t) { return t[0] === (q && q.tab); }) ? q.tab : 'pour-vous';
    var listBox = h('div', { class: 'posts', id: 'posts', 'aria-live': 'polite' }, loading());
    var moreBox = h('div');
    var tabs = h('div', { class: 'feed-tabs', role: 'tablist', 'aria-label': 'Fil', id: 'feed-tabs' }, FEED_TABS.map(function (t) {
      return h('a', { class: 'ftab' + (t[0] === tab ? ' on' : ''), role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false',
        href: '#/boutiques' + (t[0] === 'pour-vous' ? '' : qs({ tab: t[0] })), id: 'tab-' + t[0] }, t[1]);
    }));
    var empty = { 'pour-vous': 'Les premières publications arrivent bientôt.',
      ventes: 'Pas encore de meilleure vente : le classement se fait sur les commandes livrées des 30 derniers jours.',
      coeur: 'Pas encore de coup de cœur : touchez ♥ ou Enregistrer sur les articles que vous aimez.' };
    var pageNo = 0;
    function fetchPage() {
      return api('fiila_posts', { p_tab: tab, p_device: deviceId(false), p_demo: demoMode(), p_page: pageNo });
    }
    fetchPage().then(function (r) {
      var posts = r.posts || [];
      setKids(listBox, posts.length ? posts.map(postCard) : h('div', { class: 'card', id: 'posts-empty' }, h('p', { class: 'muted' }, empty[tab])));
      function more(n) {
        setKids(moreBox, n === 30 ? h('button', { class: 'btn ghost', type: 'button', id: 'posts-more', onclick: function () {
          pageNo++; setKids(moreBox, loading());
          fetchPage().then(function (x) { (x.posts || []).forEach(function (p) { listBox.appendChild(postCard(p)); }); more((x.posts || []).length); },
            function (e) { setKids(moreBox, h('p', { class: 'muted' }, errText(e))); });
        } }, 'Voir plus') : null);
      }
      more(posts.length);
    }, function (e) { setKids(listBox, stateCard('!', 'Impossible de charger le fil', errText(e), retryBtn())); });
    var join = h('div');
    loadFeed().then(function (d) {
      var mine = shopKey(), n = ((d && d.shops) || []).length;
      setKids(join,
        n ? h('a', { class: 'btn link', href: '#/boutiques/liste', id: 'feed-shops' }, 'Toutes les boutiques (' + n + ')') : null,
        d && d.free_left > 0 ? h('section', { class: 'card', id: 'feed-join' },
          h('h2', null, mine ? 'Votre boutique ici' : 'Vous vendez ?'),
          h('p', { class: 'small muted' }, (d.free_left === 1 ? 'Encore 1 place gratuite' : 'Encore ' + d.free_left + ' places gratuites') +
            ' pour les 25 premières boutiques. Ouvrez votre vitrine avec au moins un article.'),
          iconBtn('a', { class: 'btn', href: mine ? '#/boutique/reglages' : '#/boutique', id: 'feed-join-btn' }, 'shop', mine ? 'Ouvrir ma vitrine' : 'Créer ma boutique')) : null);
    }, function () {});
    return page(backBtn(), demoBanner(),
      h('header', { class: 'feed-top' }, h('h1', null, 'Fil Fii'),
        h('a', { class: 'btn quiet icon-only', href: '#/enregistres', id: 'saved-link', 'aria-label': 'Mes enregistrés' }, icon('bookmark', 24))),
      tabs, listBox, moreBox, join, footer(true));
  }
  function viewSaved() {
    return api('fiila_saved', { p_device: deviceId(false) }).then(function (list) {
      return page(backBtn('Fil', '#/boutiques'), h('h1', null, 'Mes enregistrés'),
        list.length ? h('div', { class: 'saved-grid', id: 'saved-grid' }, list.map(function (p) {
          var img = h('span', { class: 'saved-img loading-skel' });
          lazyPhoto(img, function () { return api('fiila_vitrine_photo', { p_slug: p.shop.slug, p_id: p.id }).then(function (r) { return r.photo || null; }); }, '');
          return h('a', { class: 'saved-tile', href: '#/b/' + p.shop.slug + qs({ a: p.id }), 'aria-label': p.name + ', ' + fcfa(p.price) + ', ' + p.shop.name },
            img, h('span', { class: 'saved-cap' }, h('b', { class: 'wrapword' }, p.name), h('span', null, fcfa(p.price))));
        })) : h('div', { class: 'card', id: 'saved-empty' }, h('p', { class: 'muted' }, 'Touchez l’icône Enregistrer sous une publication pour la retrouver ici.'),
          h('a', { class: 'btn', href: '#/boutiques' }, 'Voir le fil')),
        footer(true));
    }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger vos enregistrés', errText(e), retryBtn()), footer()); });
  }
  function viewShops() {
    return loadFeed().then(function (d) {
      var list = (d && d.shops) || [];
      var mine = shopKey();
      // Filtre par type de commerce (la catégorie des articles sert seulement si la boutique n'a pas de type).
      function kinds(s) { return s.type ? [s.type] : (s.categories || []); }
      var cats = []; list.forEach(function (s) { kinds(s).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); }); });
      var cat = '';
      var listBox = h('div', { class: 'feed-list', id: 'feed-list' });
      var chipsBox = h('div', { class: 'opt-row scroll', role: 'group', 'aria-label': 'Catégorie', id: 'feed-cats' });
      function drawList() {
        var l = list.filter(function (s) { return !cat || kinds(s).indexOf(cat) >= 0; });
        setKids(listBox, l.length ? l.map(feedCard) : h('p', { class: 'muted' }, 'Aucune boutique dans cette catégorie pour le moment.'));
        setKids(chipsBox, [['', 'Tout']].concat(cats.map(function (c) { return [c, (typeLabel(c) || catLabel(c) || c).split(',')[0]]; })).map(function (c) {
          return h('button', { class: 'opt' + (cat === c[0] ? ' on' : ''), type: 'button', 'aria-pressed': cat === c[0] ? 'true' : 'false', onclick: function () { cat = c[0]; drawList(); } }, c[1]);
        }));
      }
      drawList();
      return page(backBtn(),
        demoBanner(),
        h('header', { class: 'stack tight' }, h('h1', null, 'Boutiques Fii'),
          h('p', { class: 'muted' }, 'Commandez sans compte. Vous donnez votre adresse à la fin, la boutique livre à la bonne porte.')),
        cats.length >= 2 ? chipsBox : null,
        list.length ? listBox : h('div', { class: 'card' }, h('p', null, 'Les premières boutiques arrivent bientôt.')),
        d && d.free_left > 0 ? h('section', { class: 'card', id: 'feed-join' },
          h('h2', null, mine ? 'Votre boutique ici' : 'Vous vendez ?'),
          h('p', { class: 'small muted' }, (d.free_left === 1 ? 'Encore 1 place gratuite' : 'Encore ' + d.free_left + ' places gratuites') +
            ' pour les 25 premières boutiques. Ouvrez votre vitrine avec au moins un article.'),
          iconBtn('a', { class: 'btn', href: mine ? '#/boutique/reglages' : '#/boutique', id: 'feed-join-btn' }, 'shop', mine ? 'Ouvrir ma vitrine' : 'Créer ma boutique')) : null,
        footer(true));
    }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger les boutiques', errText(e), retryBtn()), footer()); });
  }
  // Réglages : ouvrir, fermer et présenter sa vitrine.
  function vitrineSection(shop) {
    var box = h('section', { class: 'card', id: 'vitrine-section' });
    var state = { public: !!shop.public, slug: shop.slug, about: shop.about || '', theme: shop.theme || 'galerie', accent: shop.accent || 'foret', cover: null };
    var saved = { cover: null }, lookOpen = false;
    // La couverture n'arrive qu'ici : on ne redessine que si elle change (une saisie en cours n'est pas effacée).
    sapi('fiila_shop_vitrine', { p: null }).then(function (r) {
      var changed = (r.cover || null) !== state.cover || (r.theme && r.theme !== state.theme) || (r.accent && r.accent !== state.accent);
      state.cover = r.cover || null; state.theme = r.theme || state.theme; state.accent = r.accent || state.accent;
      saved.cover = state.cover;
      if (changed) draw();
    }, function () {});
    var err = h('div', { role: 'alert' });
    // Fil Fii : place gratuite (25 premières boutiques) et choix d'y apparaître.
    var feedBox = h('div', { class: 'stack tight', id: 'feed-settings' }), feedState = null;
    function loadFeedState() { sapi('fiila_shop_feed', { p_on: null }).then(function (r) { feedState = r; drawFeed(); }, function () {}); }
    function drawFeed() {
      var f = feedState;
      if (!f) { setKids(feedBox); return; }
      var line = !f.public ? (f.rank ? 'Votre place gratuite n° ' + f.rank + ' est gardée. Rouvrez la vitrine pour réapparaître dans le fil.'
          : f.free_left > 0 ? 'Ouvrez votre vitrine : les 25 premières boutiques sont mises en avant gratuitement dans le fil Fii (encore ' + f.free_left + ').'
          : 'Les 25 places gratuites du fil Fii sont prises.')
        : f.rank ? (f.feed ? 'Place gratuite n° ' + f.rank + ' sur 25 : votre boutique apparaît dans le fil Fii.' : 'Place gratuite n° ' + f.rank + ' gardée, mais vous n’apparaissez pas dans le fil.')
        : 'Les 25 places gratuites du fil Fii sont prises.';
      setKids(feedBox, h('h3', null, 'Fil Fii'),
        h('p', { class: 'small muted', id: 'feed-status' }, line),
        f.rank ? segField({ name: 'feed-on', id: 'feed-on', value: f.feed ? 'on' : 'off', options: [['on', 'Apparaître'], ['off', 'Ne pas apparaître']],
          onChange: function (v) {
            sapi('fiila_shop_feed', { p_on: v === 'on' }).then(function (r) { feedState = r; FEED_CACHE = null; toast(v === 'on' ? 'Votre boutique apparaît dans le fil.' : 'Votre boutique n’apparaît plus dans le fil.'); drawFeed(); },
              function (e) { drawFeed(); errBox(err, e); });
          } }) : null,
        f.public && f.rank && f.feed ? iconRow('#/boutiques', 'eye', 'Voir le fil', { id: 'feed-view' }) : null);
    }
    loadFeedState();
    function save(p, okText) {
      setKids(err);
      return sapi('fiila_shop_vitrine', { p: p }).then(function (r) {
        state.public = !!r.public; state.slug = r.slug; state.theme = r.theme || 'galerie'; state.accent = r.accent || 'foret'; state.cover = r.cover || null;
        if ('about' in p) state.about = r.about || ''; // un texte tapé mais pas encore enregistré est gardé
        saved.cover = state.cover;
        if ('public' in p) { FEED_CACHE = null; loadFeedState(); }
        toast(okText); draw();
      }, function (e) {
        // Rien n'a changé sur le serveur : les choix reviennent à l'état enregistré.
        if ('cover' in p) state.cover = saved.cover;
        draw(); errBox(err, e);
      });
    }
    function draw() {
      var url = state.slug ? vitrineUrl(state.slug) : null;
      setKids(box, h('h2', null, 'Ma vitrine en ligne'),
        h('p', { class: 'small muted' }, 'Vos articles visibles sur une page à partager. Vos clientes commandent sans compte et donnent leur adresse à la fin.'),
        segField({ name: 'vitrine-open', id: 'vitrine-open', value: state.public ? 'on' : 'off', options: [['off', 'Fermée'], ['on', 'Ouverte']],
          onChange: function (v) { save({ public: v === 'on' }, v === 'on' ? 'Vitrine ouverte.' : 'Vitrine fermée.'); } }),
        state.public && url ? [
          h('p', { class: 'sharelink', id: 'vitrine-url' }, url),
          h('div', { class: 'duo' },
            iconBtn('a', { class: 'btn mid', id: 'vitrine-wa', href: waLink('Ma boutique en ligne : choisissez vos articles et commandez ici, sans compte : ' + url), target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'Envoyer'),
            iconBtn('button', { class: 'btn ghost mid', type: 'button', onclick: function () { copy(url, 'Lien'); } }, 'link', 'Copier')),
          iconRow('#/b/' + state.slug, 'eye', 'Voir ma vitrine', { id: 'vitrine-view' })] : null,
        // Apparence repliée par défaut (règle « simple ») ; reste ouverte pendant qu'on la règle.
        h('details', { class: 'more-details', id: 'vitrine-look', open: lookOpen || null, ontoggle: function (e) { lookOpen = e.target.open; } },
          h('summary', null, 'Personnaliser l’apparence'),
          h('div', { class: 'stack', style: 'margin-top:12px' },
        h('fieldset', { class: 'vt-pick', id: 'vitrine-theme' }, h('legend', null, 'Modèle'),
          VT_THEMES.map(function (t) {
            return h('label', { class: 'vt-opt' + (state.theme === t[0] ? ' on' : '') },
              h('input', { type: 'radio', name: 'vt-theme', value: t[0], checked: state.theme === t[0] || null,
                onchange: function () { save({ theme: t[0] }, 'Modèle « ' + t[1] + ' » appliqué.'); } }),
              h('span', { class: 'vt-mini vt-mini-' + t[0], 'aria-hidden': 'true', style: '--accent:' + VT_ACCENTS[state.accent][1] }, h('i'), h('i'), h('i'), h('i')),
              h('span', { class: 'vt-name' }, t[1]), h('span', { class: 'small muted' }, t[2]));
          })),
        h('fieldset', { class: 'vt-colors', id: 'vitrine-accent' }, h('legend', null, 'Couleur'),
          Object.keys(VT_ACCENTS).map(function (k) {
            return h('label', { class: 'swatch' + (state.accent === k ? ' on' : ''), title: VT_ACCENTS[k][0] },
              h('input', { type: 'radio', name: 'vt-accent', value: k, 'aria-label': VT_ACCENTS[k][0], checked: state.accent === k || null,
                onchange: function () { save({ accent: k }, 'Couleur « ' + VT_ACCENTS[k][0] + ' » appliquée.'); } }),
              h('span', { style: 'background:' + VT_ACCENTS[k][1] }));
          })),
        photoField({ id: 'vitrine-cover', optional: true, label: 'Photo de couverture', maxSide: 1280,
          get: function () { return state.cover; },
          set: function (v) { state.cover = v; save({ cover: v ? v.replace(/^data:[^,]+,/, '') : '' }, v ? 'Couverture enregistrée.' : 'Couverture retirée.'); } }),
        textField({ id: 'vitrine-about', label: 'Présentation', optional: true, max: 160, value: state.about, placeholder: 'Ex. : Robes wax et foulards, livrés à Dakar.',
          onInput: function (v) { state.about = v; } }),
        iconBtn('button', { class: 'btn ghost small', type: 'button', id: 'vitrine-about-save', onclick: function () { save({ about: state.about }, 'Présentation enregistrée.'); } }, 'check', 'Enregistrer la présentation', 18))),
        feedBox, err);
    }
    draw();
    return box;
  }

  /* ================================================================ ORIGINE ET PARRAINAGE
     Chaque lien Fii reçu dit d'où vient la personne. On garde la première origine (30 jours) sur ce téléphone,
     et on l'envoie au serveur juste après une création (boutique, livreur, adresse, rendez-vous).
     Un lien de parrainage (#/r/CODE) remplace toujours une origine passive. Rien de personnel n'est stocké ici. */
  var TOUCH_LS = 'fiila.touch', REF_LS = 'fiila.ref';
  var TOUCH_DAYS = 30;
  // Une page reçue n'écrit rien sur le téléphone sans action : l'origine d'un lien reçu reste en mémoire,
  // et n'est gardée que si la personne passe à une création (adresse, rendez-vous, boutique, livreur, parrainage).
  var touchMem = null;
  function touchGet() {
    var t = LS.get(TOUCH_LS, null);
    if (t && t.at > Date.now() - TOUCH_DAYS * 864e5) return t;
    return touchMem;
  }
  // Ses propres codes (boutique, livreur, particulier) : ouvrir son lien ne compte jamais comme une invitation.
  var MYCODES_LS = 'fiila.mycodes';
  function myCodes() { var l = LS.get(MYCODES_LS, []); return Array.isArray(l) ? l : []; }
  function rememberMyCode(code) {
    var l = myCodes().filter(function (c) { return c !== code; }); l.unshift(code); LS.set(MYCODES_LS, l.slice(0, 5));
    var cur = touchGet(); if (cur && cur.src === 'link' && cur.token === code) forgetTouch();
  }
  function forgetTouch() { touchMem = null; LS.del(TOUCH_LS); }
  function checkTouchCode() {
    var t = touchGet();
    if (!t || t.src !== 'link') return;
    api('fiila_referral_public', { p_code: t.token }).then(function (r) {
      var c = touchGet();
      if (r.state !== 'ok' && c && c.token === t.token) forgetTouch();
    }, function () { /* hors ligne : on garde */ });
  }
  function noteTouch(p) {
    var src = null, token = null;
    if (p[0] === 'r' && p[1]) { src = 'link'; token = p[1].toUpperCase(); }
    else if (p[0] === 'd' && p[1]) { src = 'request'; token = p[1]; }
    else if (p[0] === 'f' && p[1]) { src = 'invoice'; token = p[1]; }
    else if (p[0] === 'a' && p[1]) { src = 'address'; token = p[1]; }
    else if (p[0] === 'l' && p[1]) { src = 'course'; token = p[1]; }
    else if (p[0] === 's' && p[1]) { src = 'watch'; token = p[1]; }
    else if (p[0] === 'livreur' && p[1] === 'invitation' && p[2]) { src = 'courier_invite'; token = p[2]; }
    else if (p[0] === 'b' && p[1] && /^[a-z0-9-]{3,40}$/i.test(p[1])) { src = 'vitrine'; token = p[1].toLowerCase(); }
    var creating = p[0] === 'new' || p[0] === 'boutique' || p[0] === 'livreur' || p[0] === 'parrainer' || (p[0] === 'rdv' && p[1] === 'nouveau');
    if (creating && touchMem && !LS.get(TOUCH_LS, null)) LS.set(TOUCH_LS, touchMem);
    if (!src || !(src === 'vitrine' ? /^[a-z0-9-]{3,40}$/.test(token) : /^[A-Za-z0-9_-]{6,100}$/.test(token))) return;
    if (src === 'address' && owned.all().some(function (r) { return r.share === token; })) return; // sa propre fiche
    if (src === 'link' && myCodes().indexOf(token) >= 0) return; // son propre code
    var cur = touchGet();
    if (cur && src !== 'link') return;
    if (cur && cur.src === 'link' && cur.token === token) return;
    var t = { src: src, token: token, at: Date.now() };
    // Un lien de parrainage est une invitation ouverte volontairement : gardé tout de suite.
    if (src === 'link') { touchMem = t; LS.set(TOUCH_LS, t); } else touchMem = t;
  }
  // Envoie l'origine d'une création. typed : numéro ou code tapé ; fallback : contexte de la page si aucune origine n'est gardée.
  function attribute(kind, id, key, typed, fallback) {
    var p = {}, t = touchGet() || fallback || null;
    typed = String(typed || '').trim();
    if (typed) {
      if (typed.replace(/\D/g, '').length >= 7) p.phone = typed;
      else p.code = typed.replace(/[\s-]/g, '').toUpperCase();
    }
    if (t && t.src && t.token) { p.src = t.src; p.token = t.token; }
    return api('fiila_attribute', { p_kind: kind, p_id: id || null, p_key: key || null, p: p }).then(null, function () { /* sans effet */ });
  }
  // « Qui vous a parlé de Fii ? » : replié, facultatif ; absent si la personne arrive par un lien de parrainage.
  function referralAsk(id) {
    var val = '';
    var t = touchGet();
    var el = t && t.src === 'link' ? null : h('details', { class: 'ref-ask', id: id },
      h('summary', null, 'Quelqu’un vous a recommandé Fii ?'),
      textField({ id: id + '-input', label: 'Son numéro ou son code', optional: true, inputmode: 'text', max: 30,
        placeholder: 'Ex. : 77 123 45 67 ou K7M2QD', onInput: function (v) { val = v; } }));
    return { el: el, value: function () { return val; } };
  }
  function referralUrl(code) { return baseUrl() + '#/r/' + code; }
  function referralMessage(kind, code) {
    var url = referralUrl(code);
    if (kind === 'shop') return 'Je reçois l’adresse de mes clientes en une photo avec Fii : la bonne porte, un repère, le livreur arrive du premier coup. Crée ta boutique, c’est gratuit : ' + url;
    if (kind === 'courier') return 'Avec Fii, les boutiques m’envoient l’adresse exacte avec la photo de l’entrée. Plus besoin d’appeler pour trouver. Essaie : ' + url;
    return 'J’envoie mon adresse en une photo avec Fii : la bonne porte, un repère, où se garer. C’est gratuit : ' + url;
  }
  // Bandeau d'arrivée par lien de parrainage (accueil), tant que rien n'a été créé sur ce téléphone.
  function inviteBanner() {
    var t = touchGet();
    if (!t || t.src !== 'link' || owned.all().length || shopKey() || courierKey()) return null;
    var box = h('div', { id: 'invite-banner', hidden: true });
    api('fiila_referral_public', { p_code: t.token }).then(function (r) {
      // Code inconnu ou supprimé : on l'oublie, pour ne bloquer ni une autre origine ni la question « recommandé ? ».
      if (r.state === 'unknown' || r.state === 'invalid') { var c = touchGet(); if (c && c.token === t.token) forgetTouch(); return; }
      if (r.state !== 'ok' || !r.name) return;
      var pro = r.kind === 'shop' || r.kind === 'courier';
      setKids(box, inviteCard({ compact: true, kind: 'Invitation', from: r.name, title: 'Vous êtes invité(e) sur Fii',
        sub: pro ? 'Recevez l’adresse exacte de vos clients en une photo. Gratuit, sans compte.' : 'Créez votre adresse une fois, envoyez-la par un lien. Gratuit, sans compte.',
        cta: pro ? ivcBtn('a', { href: '#/boutique', id: 'invite-shop' }, 'Créer ma boutique') : ivcBtn('a', { href: '#/new', id: 'invite-address' }, 'Créer mon adresse'),
        more: pro ? h('a', { class: 'ivc-link', href: '#/livreur' }, 'Je suis livreur') : null }));
      box.hidden = false;
    }, function () { /* hors ligne : pas de bandeau */ });
    return box;
  }

  var REF_KIND = { shop: 'Boutique', courier: 'Livreur', address: 'Adresse', meeting: 'Événement' };
  function viewReferral(q) {
    var forWho = q.pour === 'boutique' ? 'shop' : q.pour === 'livreur' ? 'courier' : 'person';
    var key = forWho === 'shop' ? shopKey() : forWho === 'courier' ? courierKey() : ((LS.get(REF_LS, null) || {}).key || null);
    var back = forWho === 'shop' ? backBtn('Ma boutique', '#/boutique') : forWho === 'courier' ? backBtn('Espace livreur', '#/livreur') : backBtn();
    return api('fiila_referral_me', { p_for: forWho, p_key: key }).then(function (r) {
      if (r.referrer && r.referrer.code) rememberMyCode(r.referrer.code);
      return r.referrer ? referralPage(forWho, r.referrer, back) : referralCardForm(back);
    }, function (e) {
      if (e.code === 'shop_required') { redirect('#/boutique'); return loading(); }
      if (e.code === 'courier_required') { redirect('#/livreur'); return loading(); }
      return page(back, stateCard('!', 'Impossible de charger le parrainage', errText(e), retryBtn()), footer());
    });
  }
  function referralCardForm(back) {
    var f = { name: '', phone: '' };
    var err = h('div', { role: 'alert' });
    var btn = h('button', { class: 'btn', type: 'button', id: 'ref-create', onclick: function () {
      setKids(err);
      if (!f.name.trim()) return errBox(err, new ApiError('name_required'));
      btn.disabled = true;
      api('fiila_referral_card_save', { p_key: null, p: { name: f.name.trim(), phone: f.phone.trim() || null } }).then(function (r) {
        if (r.key) LS.set(REF_LS, { key: r.key });
        render();
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, 'Créer mon code');
    return page(back,
      h('div', { class: 'stack tight' }, h('h1', null, 'Inviter vos proches'),
        h('p', { class: 'muted' }, 'Votre code et votre lien comptent chaque personne qui rejoint Fii grâce à vous.')),
      textField({ id: 'ref-name', label: 'Votre nom', max: 60, autocomplete: 'name', onInput: function (v) { f.name = v; } }),
      textField({ id: 'ref-phone', label: 'Votre numéro', optional: true, type: 'tel', inputmode: 'tel', onInput: function (v) { f.phone = v; },
        hint: 'Vos proches pourront taper votre numéro au lieu du code. Il n’est jamais affiché.' }),
      err, btn, footer());
  }
  function referralPage(forWho, ref, back) {
    var msg = referralMessage(forWho, ref.code);
    var intro = forWho === 'shop' ? 'Invitez d’autres boutiques et vos clientes. Chaque personne qui rejoint Fii par votre lien, votre code ou votre numéro est comptée pour vous.'
      : forWho === 'courier' ? 'Invitez les boutiques que vous livrez et d’autres livreurs. Chaque arrivée par votre lien, votre code ou votre numéro est comptée pour vous.'
      : 'Invitez vos proches. Chaque personne qui rejoint Fii par votre lien ou votre code est comptée pour vous.';
    var recent = ref.recent || [];
    return page(back,
      h('div', { class: 'stack tight' }, h('p', { class: 'eyebrow' }, 'Parrainage'), h('h1', null, forWho === 'person' ? 'Inviter vos proches' : 'Parrainer'),
        h('p', { class: 'muted' }, intro)),
      h('section', { class: 'card ref-card' },
        h('p', { class: 'small muted' }, 'Votre code'),
        h('p', { class: 'ref-code', id: 'ref-code' }, ref.code),
        h('p', { class: 'small muted wrapword', id: 'ref-link' }, referralUrl(ref.code)),
        h('div', { class: 'row' },
          iconBtn('a', { class: 'btn', id: 'ref-whatsapp', href: waLink(msg), target: '_blank', rel: 'noopener' }, 'chat', 'Envoyer sur WhatsApp'),
          iconBtn('button', { class: 'btn ghost', type: 'button', id: 'ref-copy', onclick: function () { copy(referralUrl(ref.code), 'Lien'); } }, 'link', 'Copier le lien')),
        ref.has_phone ? h('p', { class: 'small muted' }, 'À l’inscription, on peut aussi taper votre numéro.') : null),
      h('div', { class: 'tiles', id: 'ref-stats' },
        h('div', { class: 'tile' }, h('strong', null, String(ref.joined || 0)), h('span', null, (ref.joined || 0) > 1 ? 'arrivées grâce à vous' : 'arrivée grâce à vous')),
        h('div', { class: 'tile' }, h('strong', null, String(ref.active || 0)), h('span', null, (ref.active || 0) > 1 ? 'actives' : 'active'))),
      recent.length ? h('section', { class: 'stack tight' }, h('h2', null, 'Dernières arrivées'),
        h('div', { class: 'list', id: 'ref-recent' }, recent.map(function (x) {
          return h('div', { class: 'item' },
            h('div', null, h('div', { class: 't' }, x.label || REF_KIND[x.kind] || ''), h('div', { class: 'small muted' }, (x.label ? REF_KIND[x.kind] + ' · ' : '') + shortDate(x.at))),
            h('span', { class: 'chip ' + (x.active ? 'ok' : 'wait') }, x.active ? 'Active' : 'Pas encore active'));
        })),
        recent.some(function (x) { return x.kind === 'shop'; }) ? h('p', { class: 'small muted' }, 'Une boutique est active après 3 commandes de clientes différentes, dont une livrée.') : null)
        : h('p', { class: 'small muted' }, 'Personne pour l’instant. Envoyez votre lien à quelqu’un qui envoie ou reçoit des colis.'),
      forWho === 'person' ? h('details', null, h('summary', null, 'Supprimer mon code'),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          h('p', { class: 'small' }, 'Votre nom et votre numéro sont effacés. Votre lien ne marchera plus.'),
          h('button', { class: 'btn danger', type: 'button', id: 'ref-delete', onclick: function () {
            api('fiila_referral_card_delete', { p_key: (LS.get(REF_LS, null) || {}).key || null }).then(function () { LS.del(REF_LS); toast('Code supprimé.'); go('#/'); },
              function (e) { toast(errText(e)); });
          } }, 'Supprimer'))) : null,
      footer());
  }

  /* ----- publication d'un article sur les réseaux de la boutique (partage natif : aucun compte relié) */
  function productCaption(pr, shop) {
    var lines = [pr.name, fcfa(pr.price)];
    if (pr.description) lines.push(pr.description.length > 160 ? pr.description.slice(0, 157).trim() + '…' : pr.description);
    var n = shop && waNumber(shop.phone);
    lines.push('', shop && shop.public && shop.slug ? 'Pour commander : ' + vitrineUrl(shop.slug, pr.id)
      : n ? 'Pour commander sur WhatsApp : https://wa.me/' + n : 'Pour commander, écrivez-nous en message privé.');
    return lines.join('\n');
  }
  function dataUrlFile(dataUrl, name) {
    var m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || '');
    if (!m) return null;
    try {
      var bin = atob(m[2]), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
      return new File([arr], name + '.' + ext, { type: m[1] });
    } catch (e) { return null; }
  }
  function slugName(s) { return String(s || 'article').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'article'; }
  function publishBox(pr, shop, fresh) {
    var count = pr.posts || 0;
    var countEl = h('p', { class: 'small muted', id: 'post-count' }, count ? 'Publié ' + count + ' fois.' : '');
    var more = h('div', { class: 'stack' });
    var text = productCaption(pr, shop);
    // Photo servie par le stockage : préparée d'avance, car le partage doit partir du geste même (pas après un chargement).
    var photoFile = pr.photo && /^data:/.test(pr.photo) ? dataUrlFile(pr.photo, slugName(pr.name)) : null, photoHref = pr.photo && /^data:/.test(pr.photo) ? pr.photo : null;
    if (pr.photo && !photoFile) srcToDataUrl(pr.photo).then(function (d) { photoFile = dataUrlFile(d, slugName(pr.name)); photoHref = d; var a = document.getElementById('post-download'); if (a) a.href = d; }, function () { /* lien direct */ });
    function logged() {
      sapi('fiila_post_log', { p_product_id: pr.id }).then(function (r) { count = r.posts; countEl.textContent = 'Publié ' + count + ' fois.'; }, function () { /* sans effet */ });
    }
    function fallback() {
      setKids(more,
        h('p', { class: 'small' }, 'Enregistrez la photo, puis collez la légende dans votre publication.'),
        h('div', { class: 'row' },
          pr.photo ? h('a', { class: 'btn ghost', id: 'post-download', href: photoHref || pr.photo, download: slugName(pr.name), onclick: logged }, 'Enregistrer la photo') : null,
          h('button', { class: 'btn ghost', type: 'button', id: 'post-copy', onclick: function () { copy(text, 'Légende'); if (!pr.photo) logged(); } }, 'Copier la légende')),
        h('pre', { class: 'caption', id: 'post-caption' }, text));
    }
    function publish() {
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(null, function () { /* rien */ }); } catch (e) { /* rien */ }
      var file = photoFile;
      var data = { text: text };
      var canFiles = false;
      try { canFiles = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canFiles = false; }
      if (canFiles) data.files = [file];
      if (navigator.share && (canFiles || !file)) {
        navigator.share(data).then(function () { logged(); toast('Publié. La légende est aussi copiée.'); }, function (e) {
          if (e && e.name === 'AbortError') return;
          fallback();
        });
      } else fallback();
    }
    return h('section', { class: 'card', id: 'publish-box' },
      h('h2', null, fresh ? 'Article ajouté. Publiez-le' : 'Publier sur vos réseaux'),
      h('p', { class: 'small muted' }, 'La photo et la légende, prêtes pour Instagram, Facebook, TikTok ou votre statut WhatsApp.'),
      iconBtn('button', { class: 'btn', type: 'button', id: 'product-publish', onclick: publish }, 'share', 'Publier'),
      countEl, more);
  }

  /* ----- statistiques de croissance (compte administrateur seulement) */
  var SOURCE_LABEL = { code: 'Code tapé', phone: 'Numéro tapé', link: 'Lien de parrainage', request: 'Demande d’adresse', invoice: 'Facture',
    address: 'Adresse reçue', meeting: 'Événement reçu', course: 'Course livreur', watch: 'Suivi de livraison', courier_invite: 'Invitation livreur',
    post: 'Publication', vitrine: 'Vitrine de boutique', direct: 'Direct' };
  function viewStats() {
    if (!authed()) return page(backBtn(), stateCard('!', 'Accès réservé', 'Connectez-vous avec le compte autorisé.', h('a', { class: 'btn', href: '#/compte' + qs({ retour: 'stats' }) }, 'Se connecter')), footer());
    return api('fiila_admin_stats', {}).then(function (s) {
      var T = s.totals;
      function tile(n, label) { return h('div', { class: 'tile' }, h('strong', null, String(n || 0)), h('span', null, label)); }
      var src = Object.keys(s.sources || {}).sort(function (a, b) { return s.sources[b] - s.sources[a]; });
      return page(backBtn(),
        h('div', { class: 'tiles', id: 'stats-totals' },
          tile(T.shops, 'boutiques'), tile(T.couriers, 'livreurs'), tile(T.addresses, 'adresses actives'), tile(T.meetings, 'événements actifs'),
          tile(T.orders, 'commandes'), tile(T.delivered, 'livrées'), tile(T.referred, 'arrivées parrainées'), tile(T.posts, 'publications')),
        T.pending_phone ? h('p', { class: 'small muted' }, T.pending_phone + ' arrivée(s) avec un numéro pas encore inscrit comme parrain.') : null,
        h('section', { class: 'stack tight' }, h('h2', null, 'D’où viennent les arrivées (30 jours)'),
          src.length ? h('div', { class: 'list', id: 'stats-sources' }, src.map(function (k) {
            return h('div', { class: 'item' }, h('div', { class: 't' }, SOURCE_LABEL[k] || k), h('strong', null, String(s.sources[k])));
          })) : h('p', { class: 'small muted' }, 'Aucune arrivée enregistrée.')),
        h('section', { class: 'stack tight' }, h('h2', null, 'Par semaine'),
          s.weeks.length ? h('div', { class: 'list', id: 'stats-weeks' }, s.weeks.map(function (w) {
            return h('div', { class: 'item' },
              h('div', null, h('div', { class: 't' }, 'Semaine du ' + new Date(w.week + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })),
                h('div', { class: 'small muted' }, Object.keys(w.kinds).map(function (k) { var n = w.kinds[k], l = (REF_KIND[k] || k).toLowerCase(); return n + ' ' + (n > 1 ? l.replace('rendez-vous', 'rendez-vous').replace(/(boutique|adresse|livreur)$/, '$1s') : l); }).join(' · '))),
              h('strong', null, String(w.total)));
          })) : h('p', { class: 'small muted' }, '—')),
        h('section', { class: 'stack tight' }, h('h2', null, 'Meilleurs parrains'),
          s.top.length ? h('div', { class: 'list', id: 'stats-top' }, s.top.map(function (x) {
            return h('div', { class: 'item' },
              h('div', null, h('div', { class: 't' }, x.name || x.code), h('div', { class: 'small muted' }, ({ shop: 'Boutique', courier: 'Livreur', person: 'Particulier' })[x.kind] + ' · ' + x.code)),
              h('span', { class: 'item-end' }, h('strong', null, String(x.joined)), h('span', { class: 'small muted' }, ' dont ' + x.active + (x.active > 1 ? ' actives' : ' active'))));
          })) : h('p', { class: 'small muted' }, 'Aucun parrainage pour l’instant.')),
        footer());
    }, function (e) {
      if (e.code === 'not_allowed') return page(backBtn(), stateCard('!', 'Accès réservé', 'Ce compte n’a pas accès aux statistiques.'), footer());
      return page(backBtn(), stateCard('!', 'Impossible de charger les statistiques', errText(e), retryBtn()), footer());
    });
  }

  /* ================================================================ routeur */
  var renderSeq = 0;
  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var q = {}, qi = raw.indexOf('?');
    if (qi >= 0) {
      // Adresse mal formée (%E0%A4…) : on garde le texte brut au lieu de bloquer l'application.
      var dec = function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } };
      raw.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[dec(p[0])] = dec(p[1] || ''); });
      raw = raw.slice(0, qi);
    }
    var parts = raw.split('/').filter(Boolean);
    return { parts: parts, q: q };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  // Redirection décidée pendant l'affichage : remplace l'entrée d'historique (le bouton Retour ne ramène pas sur une page
  // qui redirige aussitôt).
  function redirect(hash) {
    try { history.replaceState(null, '', location.pathname + location.search + hash); lastHash = hash; } catch (e) { location.replace(hash); return; }
    setTimeout(render, 0);
  }
  function render() {
    var seq = ++renderSeq;
    stopMedia();
    staleToast();
    var r = parseHash(), p = r.parts, view;
    noteTouch(p);
    try { noteActivity(p); } catch (e) { /* stockage indisponible */ }
    try {
      if (!p.length) view = viewHome();
      else if (p[0] === 'r' && p[1]) { try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch (e) { /* rien */ } checkTouchCode(); view = viewHome(); }
      else if (p[0] === 'parrainer') view = viewReferral(r.q);
      else if (p[0] === 'bo') view = viewBo(p, r.q);
      // Anciennes adresses d'administration : elles mènent au back-office.
      else if (p[0] === 'stats' || (p[0] === 'admin' && p[1])) { var boSec = p[0] === 'stats' ? 'croissance' : p[1] === 'ambassadeurs' ? 'agents' : p[1]; try { history.replaceState(null, '', location.pathname + location.search + '#/bo/' + boSec); } catch (e) { /* rien */ } view = viewBo(['bo', boSec], r.q); }
      else if (p[0] === 'a' && p[1]) view = viewRecipient(p[1]);
      else if (p[0] === 'new') view = viewAddressForm(null, r.q);
      else if (p[0] === 'edit' && p[1]) view = viewAddressForm(p[1], r.q);
      else if (p[0] === 'm' && p[1]) view = viewManage(p[1]);
      else if (p[0] === 'demande' && p[1] === 'nouvelle') view = viewRequestNew(r.q);
      else if (p[0] === 'demande' && p[1]) view = viewRequestOwner(p[1]);
      else if (p[0] === 'd' && p[1]) view = viewRequestPublic(p[1], r.q);
      else if (p[0] === 'rdv' && p[1] === 'nouveau') view = viewMeetingForm(null, r.q);
      else if (p[0] === 'rdv' && p[1] === 'modifier' && p[2]) view = viewMeetingForm(p[2]);
      else if (p[0] === 'k' && p[1]) view = viewRestore(p[1]);
      else if (p[0] === 'l' && p[1]) view = viewCourier(p[1]);
      else if (p[0] === 's' && p[1]) view = viewWatch(p[1]);
      else if (p[0] === 'cle') view = viewRestore(null);
      else if (p[0] === 'compte') view = viewAccount(r.q);
      else if (p[0] === 'boutique' && !p[1]) view = viewShop(r.q);
      else if (p[0] === 'invitation' && p[1]) view = viewPartnerInvite(p[1]);
      else if (p[0] === 'boutiques' && !p[1]) view = viewFeed(r.q);
      else if (p[0] === 'boutiques' && p[1] === 'liste') view = viewShops();
      else if (p[0] === 'enregistres' && !p[1]) view = viewSaved();
      else if (p[0] === 'demo' && !p[1]) view = viewDemo(r.q);
      else if ((p[0] === 'agent' || p[0] === 'ambassadeur' || p[0] === 'carriere') && !p[1]) view = viewAmbassador();
      else if (p[0] === 'vide-dressing' && !p[1]) view = viewVideDressing();
      else if (p[0] === 'vide-dressing' && p[1] === 'vendre') view = viewVdSell(r.q);
      else if (p[0] === 'boutique' && p[1] === 'reglages') view = viewShopSettings();
      else if (p[0] === 'boutique' && p[1] === 'marketing') view = viewShopMarketing(r.q || {});
      else if (p[0] === 'boutique' && p[1] === 'demarrer') view = viewShopSetup();
      else if (p[0] === 'boutique' && p[1] === 'articles') view = viewProducts();
      else if (p[0] === 'livreur' && !p[1]) view = viewCourierHome();
      else if (p[0] === 'livreur' && p[1] === 'invitation' && p[2]) view = viewCourierInvite(p[2]);
      else if (p[0] === 'equipe' && p[1]) view = viewTeamInvite(p[1]);
      else if (p[0] === 'boutique' && p[1] === 'article' && p[2]) view = viewProductForm(p[2], r.q);
      else if (p[0] === 'clients' && !p[1]) view = viewCustomers(r.q);
      else if (p[0] === 'clients' && p[1]) view = viewCustomer(p[1]);
      else if (p[0] === 'commande' && p[1] === 'nouvelle') view = viewOrderNew(r.q);
      else if (p[0] === 'commande' && p[1]) view = viewOrder(p[1], r.q);
      else if (p[0] === 'f' && p[1]) view = viewInvoice(p[1], r.q);
      else if (p[0] === 'b' && p[1]) view = viewVitrine(p[1].toLowerCase(), r.q);
      else if (p[0] === 'confidentialite') view = viewPrivacy();
      else view = page(backBtn(), stateCard('?', 'Page introuvable', 'Ce lien n’est pas valide.'));
    } catch (e) {
      view = page(backBtn(), stateCard('!', 'Une erreur est survenue', 'Rechargez la page.'));
    }
    Promise.resolve(view).then(function (node) {
      if (seq !== renderSeq) return;
      ensureWayBack(node, r);
      setKids(app, node);
      window.scrollTo(0, 0);
    }, function (e) {
      if (seq !== renderSeq) return;
      var node = page(backBtn(), stateCard('!', 'Chargement impossible', errText(e)),
        h('button', { class: 'btn', type: 'button', onclick: render }, 'Réessayer'));
      ensureWayBack(node, r);
      setKids(app, node);
    });
  }
  // Micro et sons en cours : arrêtés à chaque changement d'écran (jamais de micro ouvert sur un autre écran).
  var MEDIA = [];
  function onMedia(stop) { MEDIA.push(stop); }
  function stopMedia() { var l = MEDIA || []; MEDIA = []; l.forEach(function (f) { try { f(); } catch (e) { /* rien */ } }); }
  /* ----- navigation : chaque écran a une sortie
     On garde en mémoire les écrans vus dans cette session (jamais sur le téléphone). Un écran sans bouton retour
     en reçoit un : retour à l'écran précédent de l'application s'il existe, sinon à l'écran « parent » logique. */
  var NAV = [];
  var lastHash = location.hash || '#/';
  window.addEventListener('hashchange', function () {
    var cur = location.hash || '#/';
    if (NAV.length && NAV[NAV.length - 1] === cur) NAV.pop(); // retour arrière
    else if (lastHash !== cur) NAV.push(lastHash);
    if (NAV.length > 50) NAV.shift();
    lastHash = cur;
    focusNext = true;
    render();
  });
  function parentOf(parts, q) {
    var a = parts[0], b = parts[1];
    if (!a) return null;
    if (a === 'enregistres' || (a === 'boutiques' && b)) return ['#/boutiques', 'Fil'];
    if (a === 'boutique' && b === 'article') return ['#/boutique/articles', 'Mes articles'];
    if (a === 'boutique' && b) return ['#/boutique', 'Ma boutique'];
    if (a === 'clients' && b) return ['#/clients', 'Clients'];
    if (a === 'clients' || a === 'commande') return ['#/boutique', 'Ma boutique'];
    if (a === 'edit' && b) return ['#/m/' + b, 'Retour à la fiche'];
    if (a === 'livreur' && b) return ['#/livreur', 'Espace livreur'];
    if (a === 'parrainer' && q && q.pour === 'boutique') return ['#/boutique', 'Ma boutique'];
    if (a === 'parrainer' && q && q.pour === 'livreur') return ['#/livreur', 'Espace livreur'];
    return ['#/', 'Accueil'];
  }
  // Après un changement d'écran, le focus va au début du nouvel écran (lecteurs d'écran, clavier) ; pas lors d'un simple rafraîchissement.
  var focusNext = false;
  function showView(node) {
    stopMedia(); ensureWayBack(node, parseHash()); setKids(app, node);
    if (focusNext) { focusNext = false; try { app.focus({ preventScroll: true }); } catch (e) { /* rien */ } }
  }
  function ensureWayBack(node, r) {
    if (!node || !node.querySelector || !r.parts.length) return;
    if (node.classList && node.classList.contains('bo-shell')) return; // le back-office a sa propre navigation
    // Portail du back-office (connexion, code, accès refusé, invitation) : une flèche retour en haut à gauche.
    if (node.classList && node.classList.contains('bo-portal')) {
      if (node.querySelector('.bo-back')) return;
      var pv = NAV.length ? NAV[NAV.length - 1] : null;
      var bb = backBtn(pv ? 'Retour' : authed() ? 'Mon compte' : 'Accueil', pv || (authed() ? '#/compte' : '#/'));
      bb.classList.add('bo-back'); bb.id = 'bo-back';
      if (pv) bb.onclick = function (e) { e.preventDefault(); history.back(); };
      node.insertBefore(bb, node.firstChild);
      return;
    }
    var prev = NAV.length ? NAV[NAV.length - 1] : null;
    var bar = node.querySelector('.brand-bar');
    // Pages reçues par lien : le logo ramène à l'accueil ; une flèche apparaît si l'on vient d'un autre écran de l'application.
    if (bar) {
      var mark = bar.querySelector('.logo');
      if (mark && !mark.closest('a')) {
        var link = h('a', { class: 'brand-home', href: '#/', 'aria-label': 'Fii, accueil' }, brandLogo('small', ''));
        mark.replaceWith(link);
      }
      if (prev && !bar.querySelector('.bar-back')) {
        bar.insertBefore(h('button', { class: 'bar-back', type: 'button', 'aria-label': 'Retour', onclick: function () { history.back(); } }, icon('back', 22)), bar.firstChild);
      }
      return;
    }
    if (node.querySelector('.back')) return;
    var par = parentOf(r.parts, r.q);
    var btn = backBtn(par[1], par[0]);
    btn.classList.add('auto-back');
    if (prev) btn.onclick = function (e) { e.preventDefault(); history.back(); };
    if (prev) btn.textContent = '← Retour';
    node.insertBefore(btn, node.firstChild);
  }

  /* ================================================================ ACCUEIL */
  function viewHome() {
    var listBox = h('div', { class: 'stack' });
    var recs = owned.all();
    if (recs.length || authed()) {
      listBox.append(loading('Chargement de vos fiches…'));
      api('fiila_owned_summaries', { p_items: recs.map(function (r) { return { type: r.type, id: r.id, owner: r.owner }; }) })
        .then(function (rows) { drawLists(rows, false); }, function (e) {
          drawLists(recs.map(function (r) { return { type: r.type, id: r.id, kind: r.kind, label: r.label, cached: true }; }), errText(e));
        });
    } else drawLists([], false);

    function drawLists(rows, offlineMsg) {
      var addrs = rows.filter(function (x) { return x.type === 'place' && (x.kind || 'address') === 'address'; });
      var meets = rows.filter(function (x) { return x.type === 'place' && x.kind === 'meeting'; });
      var reqs = rows.filter(function (x) { return x.type === 'request'; });
      function item(x, href, title, sub, chip) {
        if (x.missing) {
          return h('div', { class: 'item missing' },
            h('div', null, h('div', { class: 't' }, 'Fiche introuvable'), h('div', { class: 'small muted' }, 'Supprimée, ou clé non valide.')),
            h('button', { class: 'btn ghost small', type: 'button', onclick: function () { owned.remove(x.type, x.id); render(); } }, 'Retirer'));
        }
        var kind = x.type === 'request' ? 'request' : (x.kind || 'address');
        return h('a', { class: 'item', href: href, onclick: function () { track('owned_reopened', kind); } },
          h('div', null, h('div', { class: 't' }, title), sub ? h('div', { class: 'small muted wrapword' }, sub) : null),
          h('span', { class: 'item-end' }, chip, h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))));
      }
      function chip(cls, text) { return h('span', { class: 'chip ' + cls }, icon(cls === 'ok' ? 'check' : cls === 'wait' ? 'clock' : 'ban', 12), text); }
      // Adresse : vignette de la porte, état, et les deux gestes les plus fréquents (envoyer, copier).
      function addrCard(x) {
        if (x.missing) return item(x);
        var rec = owned.find('place', x.id) || {};
        var share = x.share_token || rec.share;
        var url = share ? shareUrl(share) : null;
        var active = !x.cached && x.status === 'active';
        return h('div', { class: 'card addr-card' },
          h('a', { class: 'addr-top', href: '#/m/' + x.id, onclick: function () { track('owned_reopened', 'address'); } },
            rec.thumb ? h('img', { class: 'vthumb', src: rec.thumb, alt: '' }) : h('span', { class: 'vthumb', 'aria-hidden': 'true' }, icon('door', 24)),
            h('div', null, h('div', { class: 't' }, x.label || 'Adresse'),
              h('div', { class: 'small muted wrapword' }, [x.tag ? TAGS[x.tag] : null, x.locality].filter(Boolean).join(' · '))),
            x.cached ? null : active ? chip('ok', 'Lien actif') : chip('off', 'Lien désactivé')),
          active && url ? h('div', { class: 'duo' },
            iconBtn('a', { class: 'btn mid', href: waLink((x.label || 'Mon adresse') + '. L’entrée, avec la photo : ' + url), target: '_blank', rel: 'noopener noreferrer',
              onclick: waCardClick('address', (x.label || 'Mon adresse') + '. L’entrée, avec la photo : ' + url, 'address') }, 'chat', 'Envoyer'),
            iconBtn('button', { class: 'btn ghost mid', type: 'button', onclick: function () { copy(url, 'Lien', function () { track('link_copied', 'address'); }); } }, 'link', 'Copier')) : null);
      }
      setKids(listBox, 
        offlineMsg ? h('p', { class: 'alert' }, offlineMsg) : null,
        !addrs.length && onboardingOn() ? null : h('section', { class: 'stack', id: 'mes-adresses', 'aria-labelledby': 'h-adr' },
          h('h2', { id: 'h-adr' }, 'Mes adresses'),
          addrs.length ? h('div', { class: 'list' }, addrs.map(addrCard)) : h('div', { class: 'card' },
            h('p', null, authed() ? 'Aucune adresse pour l’instant.' : 'Aucune adresse sur ce téléphone.'),
            authed() ? null : h('p', { class: 'small muted' }, 'Connectez-vous pour retrouver vos adresses sur tous vos téléphones.'))),
        reqs.length ? h('section', { class: 'stack', 'aria-labelledby': 'h-req' }, h('h2', { id: 'h-req' }, 'Mes demandes'),
          h('div', { class: 'list' }, reqs.map(function (x) {
            return item(x, '#/demande/' + x.id, x.purpose || 'Demande', x.requester_name ? 'De : ' + x.requester_name : null,
              x.cached ? null : x.state === 'fulfilled' ? chip('ok', 'Adresse reçue') : x.state === 'expired' ? chip('off', 'Expirée') : chip('wait', 'En attente'));
          }))) : null,
        meets.length ? h('section', { class: 'stack', 'aria-labelledby': 'h-rdv' }, h('h2', { id: 'h-rdv' }, 'Mes événements'),
          h('div', { class: 'list' }, meets.map(function (x) {
            return item(x, '#/m/' + x.id, x.label || 'Événement', x.starts_at ? whenText(x.starts_at) : null,
              x.cached ? null : x.expired ? chip('off', 'Expiré') : x.status === 'active' ? chip('ok', 'Actif') : chip('off', 'Lien désactivé'));
          }))) : null);
    }

    // Compte : la photo seule, grande et ronde, en haut à droite ; le prénom dans le bonjour, sous le logo (19/10).
    var who = authed() ? h('a', { class: 'me-btn', id: 'account-link', href: '#/compte', 'aria-label': 'Mon compte' }, avatarEl(null, 48)) : null;
    var hello = authed() ? h('p', { class: 'hello', id: 'hello' }, 'Bonjour') : null;
    if (authed()) account.me().then(function (me) {
      if (!me) { setKids(who, h('span', { class: 'me-login' }, 'Se connecter')); who.className = 'who'; hello.remove(); return; }
      setKids(who, avatarEl(me, 48));
      who.setAttribute('aria-label', 'Mon compte : ' + (me.display_name || me.email || ''));
      var first = String(me.display_name || '').trim().split(/\s+/)[0];
      hello.textContent = first ? 'Bonjour, ' + first : 'Bonjour';
      if (me.shop && shopBtn) shopBtn.setAttribute('aria-label', 'Ma boutique : ' + me.shop.name);
    }, function () { /* hors ligne : on garde le lien */ });
    function tile4(href, name, label, attrs) {
      return h('a', Object.assign({ class: 'ttile', href: href }, attrs || {}), h('span', { class: 'ttile-ic', 'aria-hidden': 'true' }, icon(name, 26)), h('span', { class: 'pro-name' }, label));
    }
    var shopBtn = CFG.shop === false ? null : tile4('#/boutique', 'shop', 'Boutique', { id: 'shop-link', 'aria-label': 'Ma boutique' });
    var visits = visitCount();
    if (onboardingOn()) {
      // Accueil léger (v2) : l'action principale, mes activités, « Découvrir les services », mes listes, puis le fil en bas.
      var hero = homeHero();
      return page(
        h('header', { class: 'stack tight' },
          h('div', { class: 'brand-row' },
            h('div', { class: 'brand' }, brandLogo()),
            who),
          hello,
          h('p', { class: 'promise' + (hello ? ' small-promise' : '') }, 'Votre adresse, en une photo.')),
        inviteBanner(),
        hero,
        hero.getAttribute('data-hero') === 'boutique' && hasShop() && !setupPending() ? shopHomeTiles() : null,
        homeActivities(hero),
        servicesButton(),
        accountNudge() || homeNudge(),
        demoBanner(),
        visits >= 2 ? installCta() : null,
        listBox,
        feedSection(3, { id: 'home-feed' }),
        footer());
    }
    return page(
      h('header', { class: 'stack tight' },
        h('div', { class: 'brand-row' },
          h('div', { class: 'brand' }, brandLogo()),
          who),
        hello,
        h('p', { class: 'promise' + (hello ? ' small-promise' : '') }, 'Votre adresse, en une photo.')),
      inviteBanner(),
      // Une grande action ; quatre raccourcis avec pictogramme ; puis les adresses (proposition validée le 18/10).
      h('a', { class: 'hero', href: '#/new', id: 'create-address', 'aria-label': 'Créer mon adresse' },
        h('span', { class: 'hero-ic', 'aria-hidden': 'true' }, icon('cam', 32)),
        h('span', null, h('b', null, 'Créer mon adresse'), h('small', null, 'Photo de la porte · repère · lien'))),
      h('nav', { class: 'tiles4', 'aria-label': 'Autres actions' },
        tile4('#/demande/nouvelle', 'ask', 'Demander', { 'aria-label': 'Demander une adresse' }),
        tile4('#/rdv/nouveau', 'cal', 'Événement', { 'aria-label': 'Créer un événement' }),
        CFG.shop === false ? null : shopBtn,
        tile4('#/livreur', 'moto', 'Livreur', { id: 'courier-link', 'aria-label': 'Espace livreur' })),
      h('p', { class: 'small muted home-hint', id: 'event-hint' }, h('b', null, 'Événement'), ' : mariage, baptême, réunion… un seul lien pour que tous vos invités trouvent le lieu.'),
      installCta(),
      accountNudge() || homeNudge(),
      demoBanner(),
      listBox,
      feedSection(3, { id: 'home-feed' }),
      // Règle « simple et intuitif » (19/10) : les propositions secondaires dans une seule section repliée.
      h('details', { class: 'more-home', id: 'home-more' }, h('summary', null, 'Plus sur Fii'),
        h('div', { class: 'stack tight' },
          h('a', { class: 'invite-row', id: 'vd-link-home', href: '#/vide-dressing' }, icon('users', 24), h('span', null, 'Vide-dressing : acheter ou vendre'),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))),
          h('a', { class: 'invite-row', id: 'amb-link-home', href: '#/agent' }, icon('cash', 24), h('span', null, 'Devenir agent Fii'),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))),
          h('a', { class: 'invite-row', id: 'invite-link', href: '#/parrainer' }, icon('gift', 24), h('span', null, 'Inviter un proche'),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))))),
      footer());
  }

  /* ================================================================ CRÉER / MODIFIER UNE ADRESSE */
  var DRAFT_KEY = 'fiila.draft.address';
  function blankAddress() { return { label: '', locality: '', entry: null, vehicle_ok: null, stop: null, walk: '', instruction: '', photo: null }; }

  function viewAddressForm(editId, q) {
    var reqToken = q && q.d && /^[A-Za-z0-9_-]{16,64}$/.test(q.d) ? q.d : null;
    if (editId) {
      var rec = owned.get('place', editId);
      if (!rec) return page(backBtn(), stateCard('?', 'Fiche introuvable sur ce téléphone', 'Utilisez sa clé de gestion pour la gérer ici.'));
      return api('fiila_get_owned', { p_id: editId, p_owner: rec.owner || null }).then(function (pl) {
        var d = { label: pl.label || '', locality: pl.locality || '', entry: { lat: pl.entry.lat, lng: pl.entry.lng, acc: pl.entry_acc, src: 'saved' },
          vehicle_ok: pl.vehicle_ok, stop: pl.stop ? { lat: pl.stop.lat, lng: pl.stop.lng, src: 'saved' } : null,
          walk: pl.walk || '', instruction: pl.instruction || '', photo: pl.photo || null };
        return addressWizard(d, { editId: editId, owner: rec.owner || null, originalPhoto: pl.photo || null,
          voice: pl.has_voice ? { secs: pl.voice_secs, load: voicePrivate('place', editId, rec.owner || null) } : null });
      }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger la fiche', errText(e), retryBtn())); });
    }
    var draft = LS.get(DRAFT_KEY, null) || blankAddress();
    var ctx0 = { reqToken: reqToken, f: tokenParam(q && q.f), retour: tokenParam(q && q.retour) };
    if (!reqToken) return addressWizard(draft, ctx0);
    // Réponse à une demande : le dernier bouton envoie directement l'adresse au demandeur.
    return api('fiila_get_request_public', { p_token: reqToken }).then(function (r) {
      if (r.state === 'pending') ctx0.requester = r.requester_name;
      return addressWizard(draft, ctx0);
    }, function () { return addressWizard(draft, ctx0); });
  }
  function retryBtn() { return h('button', { class: 'btn', type: 'button', onclick: render }, 'Réessayer'); }

  function addressWizard(d, ctx) {
    // Origine : demandée seulement pour une adresse créée d'elle-même (pas en réponse à une demande, pas en modification).
    var refAsk = ctx.editId || ctx.reqToken || ctx.retour ? null : referralAsk('add-ref');
    // Repère vocal : gardé hors brouillon (trop lourd), envoyé après l'enregistrement de la fiche.
    var voice = { action: 'keep', existing: ctx.voice || null };
    var voiceBox = null;
    var step = 1;
    var root = h('div', { class: 'wrap' });
    function saveDraft() {
      if (ctx.editId) return;
      if (!LS.set(DRAFT_KEY, d)) { var copyD = Object.assign({}, d, { photo: null }); LS.set(DRAFT_KEY, copyD); }
    }
    var pickers = {};
    function valid() {
      if (step === 1) return d.entry || (pickers.entry && pickers.entry.ready()) ? '' : 'point';
      if (step === 2) {
        if (d.vehicle_ok == null) return 'choice';
        if (d.vehicle_ok === false && !(d.stop || (pickers.stop && pickers.stop.ready()))) return 'stop';
        return '';
      }
      if (step === 3) {
        if (!d.label.trim()) return 'label';
        if (!d.photo && !d.instruction.trim()) return 'photo';
        return '';
      }
      return '';
    }
    function draw() {
      var why = h('p', { class: 'hint', role: 'status' });
      var finalLabel = ctx.editId ? 'Enregistrer' : ctx.requester ? 'Envoyer à ' + ctx.requester : 'Enregistrer et partager';
      var next = h('button', { class: 'btn', type: 'button', id: 'wizard-next', onclick: onNext }, step === 1 ? 'C’est l’entrée' : step < 4 ? 'Continuer' : finalLabel);
      var err = h('div', { role: 'alert' });
      // Pas de phrase d'aide : le bouton reste grisé tant qu'il manque quelque chose (audit : moins de texte).
      function refresh() { var w = valid(); next.disabled = !!w; why.textContent = w === 'label' ? 'Donnez un nom au lieu.' : w === 'photo' ? 'Ajoutez une photo ou un repère.' : ''; }
      function onChange() { saveDraft(); refresh(); }
      var body;
      if (step === 1) {
        pickers.entry = mapPicker({ id: 'entry', what: 'l’entrée', onePress: true, onMove: function () { refresh(); },
          get: function () { return d.entry; }, set: function (p) { d.entry = p; onChange(); } });
        body = [h('h1', null, 'Où est l’entrée ?'),
          h('p', { class: 'muted' }, 'Le repère devant la porte.'),
          pickers.entry];
      } else if (step === 2) {
        var stopBox = h('div', { class: 'stack' });
        var drawStop = function () {
          setKids(stopBox);
          pickers.stop = null;
          if (d.vehicle_ok === false) add(stopBox, [
            h('h2', null, 'Où la voiture doit-elle s’arrêter ?'),
            (pickers.stop = mapPicker({ id: 'stop', what: 'l’arrêt voiture', onePress: true, onMove: function () { refresh(); },
              get: function () { return d.stop; }, set: function (p) { d.stop = p; onChange(); } })),
            textField({ id: 'walk', label: 'Du point d’arrêt jusqu’à l’entrée', multiline: true, max: 200, value: d.walk, placeholder: 'Ex. : prendre la ruelle à gauche de la pharmacie, 3e porte', onInput: function (v) { d.walk = v; onChange(); } })]);
        };
        var pick = function (v) { return function () { d.vehicle_ok = v; if (v) { d.stop = null; d.walk = ''; } drawStop(); onChange(); }; };
        body = [h('h1', null, 'Une voiture peut-elle arriver devant l’entrée ?'),
          h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Accès voiture' },
            h('label', null, h('input', { type: 'radio', name: 'veh', id: 'veh-yes', checked: d.vehicle_ok === true, onchange: pick(true) }), 'Oui'),
            h('label', null, h('input', { type: 'radio', name: 'veh', id: 'veh-no', checked: d.vehicle_ok === false, onchange: pick(false) }), 'Non')),
          stopBox];
        drawStop();
      } else if (step === 3) {
        // La photo d'abord : c'est elle qui fait reconnaître l'entrée.
        var locBox = h('div', { class: 'stack' });
        var drawLoc = function (open) {
          setKids(locBox, open || d.locality ? textField({ id: 'locality', label: 'Quartier', optional: true, max: 60, value: d.locality, placeholder: 'Ex. : Yoff Virage', onInput: function (v) { d.locality = v; onChange(); } })
            : h('button', { class: 'btn link', type: 'button', id: 'add-locality', style: 'align-self:flex-start', onclick: function () { drawLoc(true); var i = document.getElementById('locality'); if (i) i.focus(); } }, 'Ajouter le quartier'));
        };
        drawLoc(false);
        body = [h('h1', null, 'Comment reconnaître l’entrée ?'),
          photoField({ id: 'photo', get: function () { return d.photo; }, set: function (p) { d.photo = p; onChange(); } }),
          (voiceBox = voiceRecorder(voice, function () {})),
          textField({ id: 'instruction', label: 'Repère', multiline: true, max: 280, value: d.instruction, placeholder: 'Ex. : porte verte après le manguier', onInput: function (v) { d.instruction = v; onChange(); } }),
          textField({ id: 'label', label: 'Nom du lieu', max: 60, value: d.label, placeholder: 'Ex. : Chez Awa', onInput: function (v) { d.label = v; onChange(); } }),
          locBox];
      } else {
        body = [h('h1', null, ctx.requester ? 'Ce que ' + ctx.requester + ' va recevoir' : 'Ce que verra la personne'),
          fiche({ kind: 'address', label: d.label.trim(), locality: d.locality.trim(), instruction: d.instruction.trim(), entry: d.entry, vehicle_ok: d.vehicle_ok, stop: d.stop, walk: d.walk.trim(), photo: d.photo },
            { voice: voice.action === 'set' || (voice.action === 'keep' && voice.existing) ? h('div', { class: 'voice' }, h('span', { class: 'btn vbtn', 'aria-hidden': 'true' }, icon('play', 24)),
              h('div', { class: 'vtxt' }, h('strong', null, 'Écouter le repère'), h('span', { class: 'muted' }, secsText(voice.action === 'set' ? voice.secs : voice.existing.secs)))) : null }),
          h('p', { class: 'hint' }, 'Modifiable à tout moment.'),
          refAsk ? refAsk.el : null];
      }
      function onNext() {
        // Étape du repère : on attend que l'enregistrement en cours soit prêt avant d'afficher l'aperçu.
        if (voiceBox && voiceBox.stop && step === 3 && !onNext.waiting) {
          onNext.waiting = true; next.disabled = true;
          voiceBox.stop().then(function () { next.disabled = false; onNext(); onNext.waiting = false; });
          return;
        }
        if (step === 1 && pickers.entry) pickers.entry.commit();
        if (step === 2 && pickers.stop) pickers.stop.commit();
        if (valid()) return;
        if (step < 4) { step++; draw(); window.scrollTo(0, 0); return; }
        next.disabled = true; next.textContent = 'Enregistrement…'; setKids(err);
        publish().then(null, function (e) {
          next.disabled = false; next.textContent = 'Réessayer l’enregistrement';
          setKids(err, h('p', { class: 'alert' }, errText(e)));
        });
      }
      refresh();
      setKids(root, 
        step > 1 ? h('button', { class: 'back', type: 'button', onclick: function () {
          (step === 3 && voiceBox && voiceBox.stop ? voiceBox.stop() : Promise.resolve()).then(function () { step--; draw(); });
        } }, '← Étape précédente')
          : ctx.retour ? backBtn('Revenir à la fiche reçue', '#/a/' + ctx.retour)
          : backBtn(ctx.reqToken ? 'Retour à la demande' : ctx.editId ? 'Retour à la fiche' : 'Accueil', ctx.reqToken ? '#/d/' + ctx.reqToken + qs({ f: ctx.f }) : ctx.editId ? '#/m/' + ctx.editId : '#/'),
        h('div', { class: 'stack tight' },
          h('p', { class: 'eyebrow step' }, (ctx.editId ? 'Modifier · ' : '') + 'Étape ' + step + ' sur 4'),
          h('div', { class: 'steps', 'aria-hidden': 'true' }, [1, 2, 3, 4].map(function (i) { return h('i', { class: i <= step ? 'on' : '' }); }))),
        h('div', { class: 'stack' }, body), err, h('div', { class: 'stack' }, next, why),
        ctx.retour && step > 1 ? h('a', { class: 'btn link', href: '#/a/' + ctx.retour, style: 'align-self:flex-start' }, 'Revenir à la fiche reçue (le brouillon est gardé)') : null);
    }
    function payload() {
      var p = {
        kind: 'address', label: d.label.trim(), locality: d.locality.trim() || null, instruction: d.instruction.trim() || null,
        entry: { lat: d.entry.lat, lng: d.entry.lng, acc: d.entry.acc == null ? null : d.entry.acc },
        vehicle_ok: d.vehicle_ok !== false,
        stop: d.vehicle_ok === false && d.stop ? { lat: d.stop.lat, lng: d.stop.lng } : null,
        walk: d.vehicle_ok === false ? (d.walk.trim() || null) : null
      };
      if (!ctx.editId || d.photo !== ctx.originalPhoto) p.photo = d.photo ? d.photo.replace(/^data:[^,]+,/, '') : null;
      return p;
    }
    // Résout avec un message d'échec (affiché après « Adresse enregistrée »), ou null.
    var voiceFail = null;
    function sendVoice(id, owner) {
      voiceFail = null;
      var fail = function (e) { voiceFail = 'Adresse enregistrée, mais le repère vocal ne l’est pas : ' + errText(e) + ' Réessayez depuis « Modifier ».'; };
      if (voice.action === 'set') return api('fiila_voice_set', { p_id: id, p_owner: owner, p_voice: voice.b64, p_secs: voice.secs }).then(null, fail);
      if (voice.action === 'clear') return api('fiila_voice_set', { p_id: id, p_owner: owner, p_voice: '', p_secs: 0 }).then(null, fail);
      return Promise.resolve();
    }
    function publish() {
      if (ctx.editId) {
        return api('fiila_update_place', { p_id: ctx.editId, p_owner: ctx.owner || null, p: payload() }).then(function (pl) { return sendVoice(ctx.editId, ctx.owner || null).then(function () { return pl; }); }).then(function (pl) {
          owned.patch('place', ctx.editId, { label: pl.label });
          if (d.photo !== ctx.originalPhoto) makeThumb(d.photo).then(function (t) { owned.patch('place', ctx.editId, { thumb: t || undefined }); });
          toast(voiceFail || 'Modifications enregistrées. Le lien reste le même.');
          go('#/m/' + ctx.editId);
        });
      }
      return api('fiila_create_place', { p: payload() }).then(function (r) { return sendVoice(r.id, r.owner_token).then(function () { return r; }); }).then(function (r) {
        var stored = owned.put({ type: 'place', kind: 'address', id: r.id, owner: r.owner_token, share: r.share_token, label: d.label.trim(), created: Date.now() });
        if (stored && d.photo) makeThumb(d.photo).then(function (t) { if (t) owned.patch('place', r.id, { thumb: t }); });
        attribute('address', r.id, r.owner_token, refAsk ? refAsk.value() : '',
          ctx.reqToken ? { src: 'request', token: ctx.reqToken } : ctx.retour ? { src: 'address', token: ctx.retour } : null);
        LS.del(DRAFT_KEY);
        LS.set('fiila.saved', true);
        track('fiche_created', ctx.reqToken ? 'address_request' : ctx.retour ? 'address_discovery' : 'address_direct');
        if (!stored) toast('Fiche enregistrée, mais ce téléphone n’a pas pu garder la clé de gestion. Copiez-la sur la page suivante.');
        else toast(voiceFail || 'Adresse enregistrée.');
        if (ctx.reqToken && ctx.requester) {
          return api('fiila_fulfill_request', { p_token: ctx.reqToken, p_place_id: r.id, p_place_owner: r.owner_token }).then(function () {
            showView(sentView(ctx.requester, r.share_token, r.id, ctx.f)); window.scrollTo(0, 0);
          }, function () { go('#/d/' + ctx.reqToken + qs({ sel: r.id, f: ctx.f })); });
        }
        if (ctx.reqToken) go('#/d/' + ctx.reqToken + qs({ sel: r.id, f: ctx.f }));
        else go('#/m/' + r.id + qs({ k: stored ? null : r.owner_token, retour: ctx.retour, nouveau: '1' }));
      });
    }
    draw();
    return root;
  }

  /* ================================================================ GESTION D'UNE FICHE (propriétaire) */
  function viewManage(id) {
    var q = parseHash().q;
    var rec = owned.find('place', id);
    var owner = rec ? rec.owner : q.k;
    if (!owner && !authed()) return page(backBtn(), stateCard('?', 'Cette fiche n’est pas gérée sur ce téléphone', 'Ouvrez sa clé de gestion sur ce téléphone pour la gérer ici.', h('a', { class: 'btn', href: '#/cle' }, 'Restaurer une clé')));
    return api('fiila_get_owned', { p_id: id, p_owner: owner || null }).then(function (pl) {
      if (rec && rec.share !== pl.share_token) owned.patch('place', id, { share: pl.share_token, label: pl.label });
      owner = owner || null;
      return manageView(pl, owner, tokenParam(q.retour), q.nouveau === '1');
    }, function (e) {
      if (e.code === 'not_found') {
        return page(backBtn(), stateCard('?', 'Fiche introuvable', 'Elle a peut-être été supprimée.',
          h('button', { class: 'btn ghost', type: 'button', onclick: function () { owned.remove('place', id); go('#/'); } }, 'La retirer de ce téléphone')));
      }
      return page(backBtn(), stateCard('!', 'Impossible de charger la fiche', errText(e), retryBtn()));
    });
  }

  function manageView(pl, owner, retour, justSaved) {
    var isMeeting = pl.kind === 'meeting';
    var expired = isMeeting && new Date(pl.expires_at) <= new Date();
    var active = pl.status === 'active' && !expired;
    var url = shareUrl(pl.share_token);
    var msg = isMeeting
      ? 'Vous êtes invité(e) : ' + pl.label + ', ' + whenText(pl.starts_at) + '. Le lieu et le chemin : ' + url
      : pl.label + '. L’entrée, avec la photo : ' + url;
    var zone = h('div', { class: 'stack' });
    var busy = false;

    function act(fn, okText, then) {
      if (busy) return; busy = true;
      api(fn, { p_id: pl.id, p_owner: owner || null }).then(function (res) {
        busy = false; toast(okText); then(res);
      }, function (e) { busy = false; setKids(zone, h('p', { class: 'alert' }, errText(e))); });
    }
    function askDelete() {
      setKids(zone, h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirmer la suppression' },
        h('p', null, h('strong', null, 'Supprimer définitivement cette fiche ?')),
        h('p', { class: 'small' }, 'La fiche et sa photo seront effacées du serveur et le lien ne fonctionnera plus. Les copies déjà téléchargées ou les captures d’écran ne peuvent pas être rappelées.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn danger-fill', type: 'button', id: 'confirm-delete', onclick: function () {
            act('fiila_delete_place', 'Fiche supprimée.', function () { owned.remove('place', pl.id); go('#/'); });
          } }, 'Supprimer définitivement'),
          h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(zone); } }, 'Annuler'))));
    }
    var qrBox = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code du lien de la fiche' });
    if (active) {
      loadQr().then(function (qrcode) {
        var qr = qrcode(0, 'M'); qr.addData(url); qr.make();
        setKids(qrBox, h('img', { src: qr.createDataURL(6), alt: 'QR code : ' + url, id: 'qr-img' }));
      }, function () { qrBox.replaceWith(h('p', { class: 'small muted' }, 'QR code indisponible pour le moment.')); });
    }
    var key = owner ? keyUrl('place', pl.id, owner) : null;

    var variant = isMeeting ? 'meeting' : 'address';
    function sumRow(name, label) { return h('summary', null, h('span', { class: 'irow-ic', 'aria-hidden': 'true' }, icon(name, 20)), h('span', { class: 'irow-t' }, label)); }
    return page(
      retour ? backBtn('Revenir à la fiche reçue', '#/a/' + retour) : backBtn(),
      h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, isMeeting ? 'Mon événement' : 'Mon adresse'),
        h('div', { class: 'addr-top' },
          pl.photo ? h('img', { class: 'vthumb', src: pl.photo, alt: '', style: 'width:64px;height:64px' }) : null,
          h('div', null, h('h1', { class: 'wrapword' }, pl.label),
            isMeeting ? h('p', { class: 'muted' }, whenText(pl.starts_at)) : null)),
        justSaved && active ? h('p', { class: 'saved-ok', role: 'status', id: 'saved-ok' }, icon('check', 18), 'Enregistré.') : null,
        h('div', { class: 'row', style: 'align-items:center' },
          h('span', { class: 'chip ' + (active ? 'ok' : 'off'), style: 'flex:0 0 auto' }, icon(active ? 'check' : expired ? 'hourglass' : 'ban', 12),
            expired ? 'Expiré' : pl.status === 'active' ? 'Lien actif' : 'Lien désactivé'),
          h('span', { class: 'small muted' }, isMeeting && !expired ? 'Visible jusqu’au ' + shortDate(pl.expires_at) : 'Modifiée le ' + shortDate(pl.updated_at)))),
      active ? sharePanel({ kind: variant, card: isMeeting ? 'event' : 'address', url: url, msg: msg, title: pl.label, when: isMeeting ? whenText(pl.starts_at) : '', photo: pl.photo || null, qr: qrBox,
        ids: { url: 'share-url', copy: 'copy-link', native: 'share-native' } }) : null,
      pl.has_voice ? voiceOwnerBox(pl, owner) : null,
      isMeeting && active ? guestsPanel(pl, owner) : null,
      installSlot(),
      expired ? h('div', { class: 'notice' }, 'Cet événement a expiré : le lien n’affiche plus le lieu.') : null,
      isMeeting ? iconBtn('a', { class: expired ? 'btn' : 'btn ghost', id: 'similar', href: '#/rdv/nouveau' + qs({ depuis: pl.id }) }, 'cal', 'Créer un événement similaire') : null,
      // Lignes avec icône ; actions sensibles à part, en bas.
      h('nav', { class: 'ilist' },
        iconRow(isMeeting ? '#/rdv/modifier/' + pl.id : '#/edit/' + pl.id, 'edit', 'Modifier', { id: 'edit-link' }),
        active ? iconRow(url, 'eye', 'Voir comme le destinataire', { target: '_blank', rel: 'noopener', id: 'public-link' }) : null,
        active && !isMeeting ? h('details', { class: 'more', id: 'more' }, sumRow('moto', 'Livraison et étiquette'),
          h('div', { class: 'stack', style: 'margin-top:12px' },
            deliveryPanel({ id: pl.id, owner: owner }, 'place'),
            tagPicker(pl, owner))) : null,
        !key ? null : h('details', { id: 'key-box' }, sumRow('key', 'Clé de gestion'),
          h('div', { class: 'stack', style: 'margin-top:10px' },
            h('p', { class: 'small' }, 'Cette fiche est gérée depuis ce téléphone. Si vous le perdez ou effacez les données du navigateur, seule la clé de gestion permet encore de la modifier ou de la supprimer. Gardez-la pour vous : elle donne tous les droits sur la fiche.'),
            iconBtn('button', { class: 'btn ghost small', type: 'button', onclick: function () { copy(key, 'Clé de gestion'); } }, 'link', 'Copier la clé de gestion', 18),
            iconBtn('a', { class: 'btn ghost small', href: waLink('Ma clé de gestion Fii pour « ' + pl.label + ' » (ne pas partager) : ' + key), target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'M’envoyer la clé sur WhatsApp', 18),
            h('p', { class: 'hint' }, 'Choisissez votre propre discussion WhatsApp, pas celle d’une autre personne.')))),
      !key ? h('p', { class: 'hint' }, 'Fiche rattachée à votre compte : retrouvez-la sur tous vos téléphones en vous connectant.') : null,
      h('section', { class: 'sensitive', 'aria-labelledby': 'h-sensitive' },
        h('h2', { id: 'h-sensitive', class: 'eyebrow' }, 'Actions sensibles'),
        pl.status === 'active' && !expired
          ? h('button', { class: 'btn quiet', type: 'button', id: 'revoke', onclick: function () { act('fiila_revoke_place', 'Lien désactivé. Il n’affiche plus rien.', function () { render(); }); } }, 'Désactiver le lien')
          : !expired ? h('button', { class: 'btn quiet', type: 'button', id: 'new-link', onclick: function () { act('fiila_new_link', 'Nouveau lien créé. L’ancien reste inactif.', function () { render(); }); } }, 'Créer un nouveau lien') : null,
        h('button', { class: 'btn quiet danger-text', type: 'button', id: 'delete', onclick: askDelete }, 'Supprimer'),
        pl.status !== 'active' && !expired ? h('p', { class: 'hint' }, 'Le lien désactivé n’affiche plus aucune information. Un nouveau lien le remplacera définitivement.') : null,
        zone),
      !isMeeting && !active ? tagPicker(pl, owner) : null,
      footer());
  }

  /* ================================================================ PARTAGE SOCIAL
     Un seul panneau pour adresse, rendez-vous et demande. Seule l'URL destinataire est partagée.
     Telegram : https://core.telegram.org/widgets/share (url + text encodés).
     Facebook : Share Dialog officiel si un identifiant d'application est configuré (CFG.facebookAppId),
     sinon une simple copie du lien, nommée comme telle ; aucun message prérempli, aucun SDK.
     Instagram / TikTok : pas de partage de lien par URL ; image verticale + lien à copier + consigne honnête. */
  var ICONS = {
    telegram: 'M21 4 3 11l6 2 2 6 3-4 5 4 2-15ZM9 13l9-6-7 8',
    facebook: 'M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v6h4v-6h3l1-4h-4V8Z',
    instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm5.5-1.5h.01',
    tiktok: 'M14 3v11a3 3 0 1 1-3-3M14 3c0 3 2 5 5 5',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
    hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9',
    help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
    alert: 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    car: 'M5 16h14M6 16l1.5-5h9L18 16M5 16v3h2v-2M19 16v3h-2v-2M8 13.5h.01M16 13.5h.01',
    door: 'M6 21V4h12v17M3 21h18M14.5 12.5h.01',
    chev: 'M9 6l6 6-6 6',
    bubble: 'M20 11.5a8 8 0 0 1-11.6 7.1L4 19.8l1.3-4.1A8 8 0 1 1 20 11.5Z',
    heart: 'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z',
    bookmark: 'M7 3.8h10a1 1 0 0 1 1 1V20l-6-4.2L6 20V4.8a1 1 0 0 1 1-1Z',
    flag: 'M5.5 21V4.5m0 0h11.5l-2.2 4 2.2 4H5.5',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z',
    pin: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21ZM9.5 9.5a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0',
    ask: 'M4 5h16v11H9l-5 4V5ZM12 8.5v.01M12 11v2.5',
    cal: 'M7 5h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3ZM8 3v4M16 3v4M4 10h16M9 15l2 2 4-4',
    shop: 'M4 9 5.5 4h13L20 9M4 9h16v1.5a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0 2.7 2.7 0 0 1-5.3 0V9ZM5.5 13v7h13v-7M10 20v-4h4v4',
    moto: 'M2.5 16.5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M15.5 16.5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M8.5 16.5h5l3-6h-4M14 7h3l1.5 3.5M5.5 16.5 9 11h4',
    gift: 'M6 9h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM3 9h18M12 9v11M12 9S10.5 4 8 5s1 4 4 4ZM12 9s1.5-5 4-4-1 4-4 4Z',
    chat: 'M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6ZM9 10.5c.5 2 2 3.5 4.5 4.3l1.3-1.3 1.7.8',
    qr: 'M5 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM15 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM5 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1ZM14 14h2v2M20 14v6h-6v-2M17 17h.01',
    dots: 'M4.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M16.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0',
    cam: 'M4 8h3l2-3h6l2 3h3v11H4V8ZM8.5 13a3.5 3.5 0 1 0 7.0 0a3.5 3.5 0 1 0 -7.0 0',
    lock: 'M7.5 10h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5v-5A2.5 2.5 0 0 1 7.5 10ZM8 10V7a4 4 0 0 1 8 0v3',
    nav: 'm4 11 16-7-7 16-2-7-7-2Z',
    walk: 'M11.2 4.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0M9 21l2.5-6 2.5 2v4M11.5 15l1-5-3 1.5-1.5 3M12.5 10l2.5 2.5 2.5.5',
    phone: 'M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
    edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
    key: 'M4 15a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M11 12l8-8M16 7l2 2M14 9l2 2',
    box: 'M4 8 12 4l8 4v8l-8 4-8-4V8ZM4 8l8 4 8-4M12 12v8',
    megaphone: 'M4 10v4h3l8 4.5v-13L7 10H4ZM18.5 9a4 4 0 0 1 0 6M7 14l1.2 5H11l-1-4.6',
    users: 'M5.5 8a3.5 3.5 0 1 0 7.0 0a3.5 3.5 0 1 0 -7.0 0M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3 6',
    user: 'M8 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M4 21a8 8 0 0 1 16 0',
    plus: 'M12 5v14M5 12h14',
    cash: 'M5.5 6h13A2.5 2.5 0 0 1 21 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 15.5v-7A2.5 2.5 0 0 1 5.5 6ZM9.5 12a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0',
    mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
    play: 'M8 5.5v13l11-6.5-11-6.5Z',
    stop: 'M7 7h10v10H7z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    send: 'M4 12 20 4l-4 16-4.5-6.5ZM11.5 13.5 20 4',
    share: 'M15.5 5a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0M3.5 12a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0M15.5 19a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4',
    print: 'M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z',
    home: 'M4 11 12 4l8 7v9H4v-9ZM10 20v-5h4v5',
    settings: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5',
    back: 'M15 6l-6 6 6 6',
    close: 'M6 6l12 12M18 6 6 18',
    search: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M20 20l-4-4',
    down: 'M6 9l6 6 6-6'
  };
  function icon(name, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size || 20)); svg.setAttribute('height', String(size || 20));
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }
  // Vignette de la porte gardée sur ce téléphone pour la liste « Mes adresses » (≈ 3 Ko, jamais envoyée).
  function makeThumb(dataUrl) {
    return new Promise(function (ok) {
      if (!dataUrl) return ok(null);
      var img = new Image();
      img.onload = function () {
        try {
          var S = 112, c = document.createElement('canvas'); c.width = S; c.height = S;
          var r = Math.max(S / img.width, S / img.height), w = img.width * r, hh = img.height * r;
          c.getContext('2d').drawImage(img, (S - w) / 2, (S - hh) / 2, w, hh);
          ok(c.toDataURL('image/jpeg', 0.7));
        } catch (e) { ok(null); }
      };
      img.onerror = function () { ok(null); };
      img.src = dataUrl;
    });
  }
  // Bouton avec icône et un mot (v1.2 : « une icône + un mot »).
  function iconBtn(tag, attrs, name, label, size) { return h(tag, attrs, icon(name, size || 22), h('span', null, label)); }
  // Raccourci rond : pictogramme dans un cercle, un mot dessous.
  function roundBtn(tag, attrs, name, label) {
    attrs = Object.assign({}, attrs); attrs['class'] = 'rnd' + (attrs['class'] ? ' ' + attrs['class'] : '');
    return h(tag, attrs, h('span', { class: 'rnd-ic', 'aria-hidden': 'true' }, icon(name, 22)), h('span', { class: 'rnd-t' }, label));
  }
  // Ligne avec icône et chevron (navigation).
  function iconRow(href, name, label, attrs) {
    return h('a', Object.assign({ class: 'irow', href: href }, attrs || {}), h('span', { class: 'irow-ic', 'aria-hidden': 'true' }, icon(name, 20)),
      h('span', { class: 'irow-t' }, label), h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18)));
  }
  // Pastille d'état : un pictogramme dans un cercle de couleur, compris sans lire.
  function statePill(kind, name) { return h('span', { class: 'spill ' + kind, 'aria-hidden': 'true' }, icon(name, 20)); }
  function telegramLink(url, text) {
    return 'https://t.me/share/url?url=' + encodeURIComponent(url) + (text ? '&text=' + encodeURIComponent(text) : '');
  }
  // Facebook : uniquement le Share Dialog documenté, et seulement si son identifiant d'application est configuré.
  // Sans configuration, aucun lien vers Facebook : une action de copie, nommée comme telle.
  function facebookAppId() { return CFG.facebookAppId && /^\d{5,20}$/.test(String(CFG.facebookAppId)) ? String(CFG.facebookAppId) : null; }
  function facebookLink(url) {
    return 'https://www.facebook.com/dialog/share?app_id=' + encodeURIComponent(facebookAppId()) + '&display=page&href=' +
      encodeURIComponent(url) + '&redirect_uri=' + encodeURIComponent(baseUrl());
  }
  var PRIVACY_NOTICE = 'Seules les personnes qui ont le lien voient la fiche.';
  var REQUEST_NOTICE = 'Seule la personne qui a ce lien peut vous répondre.';

  // o : { kind: 'address'|'meeting'|'request', url, msg, title, when, photo, ids: { url, copy, native } }
  /* Cartes WhatsApp (mandat WHATSAPP-001) : image de marque rendue d'avance (scripts/render_wa_cards.py), partagée AVEC le texte
     quand le téléphone sait partager un fichier ; sinon lien WhatsApp texte et « Télécharger l'image ». Aucune donnée personnelle
     dans l'image ; le lien et le nom du demandeur restent dans le texte. Réglage du back-office wa_card_media (0 = texte seul). */
  // Cartes image jointes aux messages WhatsApp (rendu scripts/render_wa_cards.py). 22/10 : adresse, événement et vitrine
  // s'ajoutent à la demande d'adresse ; l'aperçu de lien (og-fii.jpg) couvre les envois en texte seul.
  var WA_CARDS = {
    request: { src: 'media/wa/demande-adresse.jpg', file: 'fii-demande-adresse.jpg', alt: 'Carte Fii « Livrer à la bonne porte » : une cliente ouvre son portail à un livreur' },
    address: { src: 'media/wa/adresse.jpg', file: 'fii-adresse.jpg', alt: 'Carte Fii « Trouvez la bonne porte » : une cliente ouvre son portail à un livreur' },
    event: { src: 'media/wa/evenement.jpg', file: 'fii-evenement.jpg', alt: 'Carte Fii « On se retrouve au bon endroit » : une hôte accueille une invitée à son portail' },
    vitrine: { src: 'media/wa/vitrine.jpg', file: 'fii-boutique.jpg', alt: 'Carte Fii « Commandez en quelques gestes » : une commerçante prépare un colis' } };
  TRACKABLE.wa_card = [];
  Object.keys(WA_CARDS).forEach(function (k) { ['file', 'text', 'download', 'failed'].forEach(function (a) { TRACKABLE.wa_card.push(k + ':' + a); }); });
  var WA_FILES = {};
  function waCardFile(kind) {
    var c = WA_CARDS[kind];
    if (!c || typeof File !== 'function') return Promise.resolve(null);
    if (WA_FILES[kind]) return Promise.resolve(WA_FILES[kind]);
    return fetch(c.src).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      return b ? (WA_FILES[kind] = new File([b], c.file, { type: 'image/jpeg' })) : null;
    }, function () { return null; });
  }
  // Bouton WhatsApp simple (sans aperçu de carte) : image + texte quand le téléphone sait partager un fichier, sinon texte.
  // Le fichier est préparé à l'affichage : le partage doit partir du toucher lui-même.
  function waCardClick(card, msg, kind) {
    var on = !!WA_CARDS[card] && nudgeFlags().wa_card !== false;
    if (on) waCardFile(card);
    return function (e) {
      if (kind) track('share_initiated', 'whatsapp_' + kind);
      if (!on) return;
      var f = WA_FILES[card];
      if (!canShareFile(f)) { track('wa_card', card + ':text'); return; }
      e.preventDefault();
      track('wa_card', card + ':file');
      navigator.share({ files: [f], text: msg }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        track('wa_card', card + ':failed');
        toast('Envoi avec l’image impossible ici : le texte seul s’ouvre.');
        location.href = waLink(msg);
      });
    };
  }
  function canShareFile(f) { try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
  function waCardBlock(o) {
    var c = WA_CARDS[o.card], ready = null;
    var link = h('p', { class: 'small wa-alt', id: 'wa-card-alt' });
    var main = iconBtn('a', { class: 'btn big', href: waLink(o.msg), target: '_blank', rel: 'noopener noreferrer', id: 'share-whatsapp',
      onclick: function (e) {
        track('share_initiated', 'whatsapp_' + o.kind);
        if (!canShareFile(ready)) { track('wa_card', o.card + ':text'); return; }
        e.preventDefault();
        track('wa_card', o.card + ':file');
        navigator.share({ files: [ready], text: o.msg }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          track('wa_card', o.card + ':failed');
          toast('Envoi avec l’image impossible ici. Touchez « Envoyer le texte seul ».');
        });
      } }, 'chat', 'Envoyer sur WhatsApp');
    function alt() {
      setKids(link, canShareFile(ready)
        ? h('a', { href: waLink(o.msg), target: '_blank', rel: 'noopener noreferrer', id: 'wa-text-only', onclick: function () { track('wa_card', o.card + ':text'); } }, 'Envoyer le texte seul')
        : h('a', { href: c.src, download: c.file, id: 'wa-card-download', onclick: function () { track('wa_card', o.card + ':download'); } }, 'Télécharger l’image'));
    }
    alt();
    waCardFile(o.card).then(function (f) { ready = f; alt(); });
    return [h('img', { class: 'wa-card', id: 'wa-card', src: c.src, alt: c.alt, width: 1200, height: 800, decoding: 'async' }), main, link];
  }
  function sharePanel(o) {
    var text = o.text || o.msg.replace(o.url, '').trim().replace(/\s*:$/, '');
    var withCard = !!(o.card && WA_CARDS[o.card] && nudgeFlags().wa_card !== false);
    var visualBox = h('div', { class: 'visual-box', id: 'visual-box', hidden: true });
    var fbHelp = h('p', { class: 'hint', id: 'fb-help', hidden: true },
      'Fii n’est pas relié à Facebook : le lien est seulement copié. Ouvrez Facebook, créez une publication ou un message, puis collez le lien. Facebook affichera un aperçu générique de Fii.');
    var openChannel = null;
    // Instagram / TikTok : rond (raccourci) ou bouton à icône (dans « Autres »).
    function channelBtn(ch, label, round) {
      var attrs = { type: 'button', id: 'share-' + ch, 'aria-expanded': 'false', 'aria-controls': 'visual-box', 'data-chan': '1',
        onclick: function (e) {
          var btn = e.currentTarget;
          if (openChannel === ch) { visualBox.hidden = true; openChannel = null; btn.setAttribute('aria-expanded', 'false'); return; }
          Array.prototype.forEach.call(panel.querySelectorAll('[data-chan]'), function (b) { b.setAttribute('aria-expanded', 'false'); });
          btn.setAttribute('aria-expanded', 'true');
          openChannel = ch;
          track('share_initiated', ch + '_' + o.kind);
          setKids(visualBox, visualPanel(o, ch));
          visualBox.hidden = false;
        } };
      return round ? roundBtn('button', attrs, ch === 'instagram' ? 'cam' : 'tiktok', label)
        : iconBtn('button', Object.assign({ class: 'btn ghost small chan' }, attrs), ch, label, 18);
    }
    var nativeShare = navigator.share ? iconBtn('button', { class: 'btn ghost small chan', type: 'button', id: o.ids.native || 'share-native', onclick: function () {
      track('share_initiated', 'native_' + o.kind);
      try {
        navigator.share({ title: o.title || 'Fii', text: text, url: o.url }).catch(function (e) {
          if (e && e.name !== 'AbortError') toast('Partage indisponible ici. Utilisez « Copier ».');
        });
      } catch (e) { toast('Partage indisponible ici. Utilisez « Copier ».'); }
    } }, 'share', 'Partager…', 18) : null;
    var facebook = facebookAppId()
      ? iconBtn('a', { class: 'btn ghost small chan', id: 'share-facebook', href: facebookLink(o.url), target: '_blank', rel: 'noopener noreferrer',
          onclick: function () { track('share_initiated', 'facebook_' + o.kind); } }, 'facebook', 'Facebook', 18)
      : iconBtn('button', { class: 'btn ghost small chan', type: 'button', id: 'share-facebook-copy', 'aria-describedby': 'fb-help',
          onclick: function () {
            track('share_initiated', 'facebook_' + o.kind);
            copy(o.url, 'Lien', function () { track('link_copied', o.kind); });
            fbHelp.hidden = false;
          } }, 'facebook', 'Facebook', 18);
    var qrWrap = o.qr ? h('div', { class: 'stack tight', id: 'share-qr-box', hidden: true },
      o.qr, h('p', { class: 'small muted' }, 'À imprimer près de la porte.')) : null;
    var moreBox = h('div', { class: 'chan-grid', id: 'share-more-box', hidden: true },
      o.qr ? channelBtn('tiktok', 'TikTok') : null, facebook, nativeShare);
    function toggle(btn, box) {
      var open = box.hidden; box.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    var panel = h('section', { class: 'card share-panel', 'aria-labelledby': 'h-share' },
      h('h2', { id: 'h-share' }, o.kind === 'request' ? 'Envoyer la demande au client' : 'Partager'),
      withCard ? waCardBlock(o) : iconBtn('a', { class: 'btn big', href: waLink(o.msg), target: '_blank', rel: 'noopener noreferrer', id: 'share-whatsapp',
        onclick: function () { track('share_initiated', 'whatsapp_' + o.kind); } }, 'chat', 'Envoyer sur WhatsApp'),
      h('div', { class: 'rnd-row' },
        roundBtn('button', { type: 'button', id: o.ids.copy, onclick: function () { copy(o.url, 'Lien', function () { track('link_copied', o.kind); }); } }, 'link', 'Copier'),
        roundBtn('a', { id: 'share-telegram', href: telegramLink(o.url, text), target: '_blank', rel: 'noopener noreferrer',
          onclick: function () { track('share_initiated', 'telegram_' + o.kind); } }, 'telegram', 'Telegram'),
        channelBtn('instagram', 'Story', true),
        o.qr ? roundBtn('button', { type: 'button', id: 'share-qr', 'aria-expanded': 'false', 'aria-controls': 'share-qr-box',
          onclick: function (e) { toggle(e.currentTarget, qrWrap); } }, 'qr', 'QR code') : channelBtn('tiktok', 'TikTok', true),
        roundBtn('button', { type: 'button', id: 'share-more', 'aria-expanded': 'false', 'aria-controls': 'share-more-box',
          onclick: function (e) { toggle(e.currentTarget, moreBox); } }, 'dots', 'Autres')),
      moreBox, fbHelp, qrWrap, visualBox,
      h('p', { class: 'safe-line', id: 'privacy-note' }, icon('lock', 18), o.kind === 'request' ? REQUEST_NOTICE : PRIVACY_NOTICE),
      h('p', { class: 'sharelink', id: o.ids.url }, o.url));
    return panel;
  }

  // Panneau Instagram / TikTok : image verticale, lien séparé, consigne honnête.
  function visualPanel(o, ch) {
    var opts = { showTitle: true, showWhen: o.kind === 'meeting', withPhoto: false };
    var preview = h('img', { class: 'visual-preview', id: 'visual-preview', alt: 'Aperçu de l’image verticale à partager' });
    var status = h('p', { class: 'msg', role: 'status' });
    var fallback = h('div', { class: 'stack', id: 'visual-fallback', hidden: true });
    var current = null, seq = 0;
    function redraw() {
      var mine = ++seq; // seul le dernier rendu demandé est affiché
      status.textContent = 'Préparation de l’aperçu…'; status.className = 'msg info';
      buildShareVisual(o, Object.assign({}, opts)).then(function (canvas) {
        if (mine !== seq) return;
        current = canvas;
        preview.src = canvas.toDataURL('image/png');
        preview.dataset.meta = JSON.stringify(canvas.__meta);
        status.textContent = '';
      }, function () { status.textContent = 'Aperçu impossible sur ce téléphone. Utilisez « Copier le lien ».'; status.className = 'msg err'; });
    }
    function checkbox(id, label, key) {
      return h('label', null, h('input', { type: 'checkbox', id: id, checked: opts[key], onchange: function (e) { opts[key] = e.target.checked; redraw(); } }), label);
    }
    function fileName() { return 'fii-' + (o.kind === 'meeting' ? 'evenement' : o.kind === 'request' ? 'demande' : 'adresse') + '.png'; }
    function download() {
      if (!current) return;
      var supportsDownload = 'download' in HTMLAnchorElement.prototype;
      current.toBlob(function (blob) {
        if (!blob) { status.textContent = 'Export impossible sur ce téléphone.'; status.className = 'msg err'; return; }
        var href = URL.createObjectURL(blob);
        if (supportsDownload) {
          var a = h('a', { href: href, download: fileName(), hidden: true });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
          track('visual_exported', 'download_' + o.kind);
          status.textContent = 'Image enregistrée dans vos téléchargements.'; status.className = 'msg ok';
        } else {
          setKids(fallback, h('p', { class: 'hint' }, 'Votre navigateur ne télécharge pas directement : appuyez longuement sur l’image ci-dessous, puis « Enregistrer l’image ».'),
            h('img', { class: 'visual-preview', src: href, alt: 'Image verticale à enregistrer' }));
          fallback.hidden = false;
          track('visual_exported', 'download_' + o.kind);
        }
      }, 'image/png');
    }
    function shareFile() {
      if (!current) return;
      current.toBlob(function (blob) {
        var file = new File([blob], fileName(), { type: 'image/png' });
        track('visual_exported', 'share_' + o.kind);
        navigator.share({ files: [file] }).catch(function (e) {
          if (e && e.name !== 'AbortError') toast('Partage de l’image indisponible ici. Téléchargez-la plutôt.');
        });
      }, 'image/png');
    }
    var canShareFiles = false;
    try { canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); } catch (e) { canShareFiles = false; }
    var guide = ch === 'instagram'
      ? 'L’image ne contient pas de lien cliquable. Dans votre Story, ajoutez le sticker « Lien » et collez le lien copié. Instagram ne propose pas ce sticker aux comptes très récents ; le QR code reste alors un accès de secours.'
      : 'Ni l’image ni la légende d’une vidéo TikTok ne rendent le lien cliquable. Le QR code permet d’ouvrir la fiche. Si votre compte propose le champ « Site web » dans « Modifier le profil », vous pouvez y coller le lien : TikTok ne le propose pas à tous les comptes.';
    redraw();
    return h('div', { class: 'stack' },
      h('h3', null, ch === 'instagram' ? 'Instagram / Story' : 'TikTok'),
      h('div', { class: 'choice one' },
        checkbox('v-title', o.kind === 'request' ? 'Afficher l’objet de la demande' : 'Afficher le nom de la fiche', 'showTitle'),
        o.kind === 'meeting' ? checkbox('v-when', 'Afficher la date et l’heure', 'showWhen') : null,
        o.photo ? checkbox('v-photo', 'Inclure la photo de l’entrée (désactivé par défaut)', 'withPhoto') : null),
      preview, status,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'visual-download', onclick: download }, 'Télécharger l’image'),
        canShareFiles ? h('button', { class: 'btn ghost', type: 'button', id: 'visual-share', onclick: shareFile }, 'Partager l’image…') : null),
      iconBtn('button', { class: 'btn ghost', type: 'button', id: 'visual-copy', onclick: function () { copy(o.url, 'Lien', function () { track('link_copied', o.kind); }); } }, 'link', 'Copier le lien'),
      fallback,
      h('p', { class: 'hint' }, guide),
      h('p', { class: 'hint' }, 'Une image téléchargée ou publiée ne peut pas être rappelée, même si vous désactivez ou supprimez la fiche ensuite.'));
  }

  // Image verticale 1080 × 1920, déterministe (canvas, polices et couleurs de Fii).
  // Jamais : clé de gestion, coordonnées, réponse privée. La photo n'apparaît que si l'utilisateur la coche,
  // entière (jamais recadrée) et sans texte par-dessus.
  function buildShareVisual(o, opts) {
    var W = 1080, H = 1920, M = 96, CW = W - 2 * M;
    var C = { bg: '#F5F2EA', ink: '#17201B', muted: '#55605A', green: '#1E4A34', lime: '#C9E265', soft: '#E9EFE1', white: '#FFFFFF' };
    var fontsReady = document.fonts && document.fonts.load
      ? Promise.all(['800 84px Montserrat', '600 40px Montserrat', '400 30px Montserrat'].map(function (f) { return document.fonts.load(f); })).catch(function () {})
      : Promise.resolve();
    var photoReady = opts.withPhoto && o.photo ? new Promise(function (res) {
      var img = new Image(); img.onload = function () { res(img); }; img.onerror = function () { res(null); }; img.src = o.photo;
    }) : Promise.resolve(null);
    function loadImg(src) { return new Promise(function (res) { var img = new Image(); img.onload = function () { res(img); }; img.onerror = function () { res(null); }; img.src = src; }); }
    var logoReady = Promise.all([loadImg('media/brand/fii-letters.png'), loadImg('media/brand/fii-pin.png')]).then(function (r) { return r[0] && r[1] ? r : null; });
    return Promise.all([fontsReady, photoReady, loadQr(), logoReady]).then(function (r) {
      var photo = r[1], qrcode = r[2], logo = r[3];
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var g = cv.getContext('2d');
      var meta = { width: W, height: H, texts: [], includesPhoto: false, qrText: o.url };
      function font(w, size, fam) { g.font = w + ' ' + size + 'px ' + (fam || 'Montserrat, system-ui, sans-serif'); }
      function wrap(text, maxW, maxLines) {
        var words = String(text).split(/\s+/), lines = [], line = '';
        function pushLong(word) { // mots plus larges que la ligne : coupe par caractères
          var part = '';
          for (var i = 0; i < word.length; i++) {
            if (g.measureText(part + word[i]).width > maxW && part) { lines.push(part); part = ''; }
            part += word[i];
          }
          return part;
        }
        words.forEach(function (w) {
          var test = line ? line + ' ' + w : w;
          if (g.measureText(test).width <= maxW) { line = test; return; }
          if (line) lines.push(line);
          line = g.measureText(w).width > maxW ? pushLong(w) : w;
        });
        if (line) lines.push(line);
        if (lines.length > maxLines) {
          lines = lines.slice(0, maxLines);
          var last = lines[maxLines - 1];
          while (g.measureText(last + '…').width > maxW && last.length) last = last.slice(0, -1);
          lines[maxLines - 1] = last.replace(/\s+$/, '') + '…';
        }
        return lines;
      }
      function rr(x, y, w, hh, rad, fill) { g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + hh, rad); g.arcTo(x + w, y + hh, x, y + hh, rad); g.arcTo(x, y + hh, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } }
      function text(t, x, y, color) { g.fillStyle = color; g.fillText(t, x, y); meta.texts.push(t); }

      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      g.textBaseline = 'alphabetic';
      // Marque
      // Marque : le logo validé (pastille), sinon le nom en texte si l'image n'a pas pu être chargée.
      if (logo) {
        // Logo sans fond, version claire (fond ivoire) : lettres vertes, épingle lime.
        var lh = 120, lw = Math.round(logo[0].naturalWidth * lh / logo[0].naturalHeight);
        [[logo[0], C.green], [logo[1], C.lime]].forEach(function (x) {
          var lc = document.createElement('canvas'); lc.width = lw; lc.height = lh;
          var lg = lc.getContext('2d'); lg.drawImage(x[0], 0, 0, lw, lh); lg.globalCompositeOperation = 'source-in'; lg.fillStyle = x[1]; lg.fillRect(0, 0, lw, lh);
          g.drawImage(lc, M, 72);
        });
        meta.texts.push('Fii');
      }
      else { font(800, 72); text('Fii', M, 170, C.ink); }
      var y = 250;
      if (photo) {
        var boxH = 520;
        g.save(); rr(M, y, CW, boxH, 28); g.clip(); g.fillStyle = C.soft; g.fillRect(M, y, CW, boxH);
        var s = Math.min(CW / photo.naturalWidth, boxH / photo.naturalHeight);
        var pw = photo.naturalWidth * s, ph = photo.naturalHeight * s;
        var px = M + (CW - pw) / 2, py = y + (boxH - ph) / 2;
        g.drawImage(photo, px, py, pw, ph); g.restore();
        meta.includesPhoto = true; meta.photoRect = { x: px, y: py, w: pw, h: ph }; meta.photoAspect = photo.naturalWidth / photo.naturalHeight;
        y += boxH + 70;
      } else { y += 60; }
      // Type de fiche
      font(600, 34); g.letterSpacing = '3px';
      text(o.kind === 'meeting' ? 'ÉVÉNEMENT' : o.kind === 'request' ? 'DEMANDE D’ADRESSE' : 'ADRESSE', M, y, C.muted);
      g.letterSpacing = '0px';
      y += 30;
      // Titre (ou formule neutre)
      var title = opts.showTitle && o.title ? o.title : (o.kind === 'meeting' ? 'Un événement partagé avec Fii' : o.kind === 'request' ? 'Une demande d’adresse Fii' : 'Une adresse partagée avec Fii');
      font(800, 84);
      var tl = wrap(title, CW, photo ? 2 : 3);
      tl.forEach(function (l) { y += 96; text(l, M, y, C.ink); });
      meta.titleLines = tl;
      if (o.kind === 'meeting' && opts.showWhen && o.when) {
        // « (heure de Dakar) » jamais coupé en deux lignes : la date d'abord, le fuseau sur sa propre ligne si besoin.
        y += 18; font(600, 40);
        var tz = ' (heure de Dakar)', day = o.when.replace(tz, ''), wl = wrap(day, CW, 2);
        if (day !== o.when) {
          var lastL = wl[wl.length - 1] + tz;
          if (g.measureText(lastL).width <= CW) wl[wl.length - 1] = lastL; else wl.push(tz.trim());
        }
        wl.forEach(function (l) { y += 56; text(l, M, y, C.muted); });
      }
      // Invitation
      y += 40; font(600, 44);
      var inv = o.kind === 'meeting' ? 'Ouvre la fiche : le lieu exact, l’heure et comment arriver.'
        : o.kind === 'request' ? 'Ouvre le lien pour m’envoyer ton adresse avec ta photo d’entrée.'
        : 'Ouvre la fiche pour trouver l’entrée exacte, avec photo et repères.';
      wrap(inv, CW, 3).forEach(function (l) { y += 58; text(l, M, y, C.green); });
      meta.contentBottom = y;
      // Bloc QR + lien, ancré en bas
      var qr = qrcode(0, 'M'); qr.addData(o.url); qr.make();
      var n = qr.getModuleCount();
      font(400, 30, 'ui-monospace, Menlo, Consolas, monospace');
      var urlLines = wrap(o.url, CW - 40, 3);
      var below = 64 + urlLines.length * 40;
      var room = H - 70 - below - (y + 60);
      var cell = Math.max(5, Math.min(12, Math.floor((Math.min(room, 560) - 2 * 4) / (n + 8))));
      var qs2 = cell * (n + 8); // zone de silence de 4 modules de chaque côté
      var qy = H - 70 - below - qs2;
      var qx = (W - qs2) / 2;
      rr(qx - 16, qy - 16, qs2 + 32, qs2 + 32, 28, C.white);
      g.fillStyle = '#000000';
      for (var rI = 0; rI < n; rI++) for (var cI = 0; cI < n; cI++) if (qr.isDark(rI, cI)) g.fillRect(qx + (cI + 4) * cell, qy + (rI + 4) * cell, cell, cell);
      meta.qr = { x: qx, y: qy, size: qs2, cell: cell, modules: n, overlapsContent: qy - 16 < y + 20 };
      font(600, 32); g.textAlign = 'center';
      text('Scanne le QR code ou ouvre le lien', W / 2, qy + qs2 + 56, C.ink);
      font(400, 30, 'ui-monospace, Menlo, Consolas, monospace');
      urlLines.forEach(function (l, i) { text(l, W / 2, qy + qs2 + 56 + 44 * (i + 1), C.muted); });
      g.textAlign = 'left';
      cv.__meta = meta;
      return cv;
    });
  }


  /* ================================================================ SUIVI EN DIRECT
     Livreur et invités partagent leur position tant que leur page est ouverte (écran gardé allumé si possible).
     Seule la dernière position et une courte trace sont gardées, effacées à l'arrivée. L'heure d'arrivée est une
     estimation locale (distance × détour / vitesse moyenne) : aucun service payant. */
  function distM(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function etaMin(pos, dest) {
    var d = distM(pos, dest) * 1.35;              // détour moyen des rues
    var kmh = d < 1200 ? 4.5 : 18;                 // à pied près du lieu, sinon circulation urbaine
    return Math.max(1, Math.round(d / 1000 / kmh * 60));
  }
  function etaText(m) {
    if (m >= 60) return 'environ ' + Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
    return 'environ ' + (m > 20 ? Math.round(m / 5) * 5 : m) + ' min';
  }
  function agoText(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s) || s < 60) return 'à l’instant';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    return 'il y a plus d’une heure';
  }
  function poll(el, fn, ms) {
    function tick() {
      if (!document.contains(el)) return;
      if (document.visibilityState === 'visible') fn();
      setTimeout(tick, ms);
    }
    setTimeout(tick, ms);
  }

  // Un seul partage actif par jeton, conservé si la vue est redessinée.
  var SHARERS = {};
  function positionSharer(token, dest) {
    if (SHARERS[token]) return SHARERS[token];
    var sh = { state: 'idle', listeners: [] };
    var watchId = null, last = null, lastSent = 0, wake = null;
    function emit(st, info) { sh.state = st; sh.info = info; sh.listeners.forEach(function (f) { f(st, info); }); }
    function send(status, c) {
      return api('fiila_position', { p_token: token, p_status: status, p_lat: c ? c.latitude : null, p_lng: c ? c.longitude : null, p_acc: c ? c.accuracy : null });
    }
    function keepAwake() {
      try { if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }, function () {}); } catch (e) { /* facultatif */ }
    }
    document.addEventListener('visibilitychange', function () { if (sh.state === 'live' && document.visibilityState === 'visible') keepAwake(); });
    function halt() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      if (wake) { try { wake.release(); } catch (e) { /* déjà libéré */ } wake = null; }
    }
    sh.start = function () {
      if (!('geolocation' in navigator)) { emit('error', 'unavailable'); return; }
      halt(); // jamais deux suivis en même temps (« Reprendre » après une erreur)
      emit('starting'); keepAwake(); lastSent = 0; last = null;
      watchId = navigator.geolocation.watchPosition(function (p) {
        var c = p.coords, now = Date.now(), here = { lat: c.latitude, lng: c.longitude };
        if (dest && distM(here, dest) <= 60) { sh.arrive(); return; }
        var moved = last ? distM({ lat: last.latitude, lng: last.longitude }, here) : Infinity;
        if (lastSent && now - lastSent < 20000 && moved < 40) return;
        last = c; lastSent = now;
        send('live', c).then(function () { emit('live', { at: new Date().toISOString() }); }, function (e) {
          // Coupure réseau passagère : le suivi continue, la prochaine position réessaie.
          if (e.code === 'network' || e.code === 'timeout') { lastSent = 0; return; }
          halt(); emit('error', e.code);
        });
      }, function (err) { halt(); emit('error', err.code === 1 ? 'denied' : 'unavailable'); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
    };
    sh.arrive = function () { halt(); emit('arrived'); return send('arrived').catch(function () {}); };
    sh.stop = function () { halt(); emit('stopped'); return send('stopped').catch(function () {}); };
    SHARERS[token] = sh;
    return sh;
  }

  // Bloc « partager mon trajet » (livreur ou invité).
  function liveShare(token, dest, o) {
    var sh = positionSharer(token, dest);
    var box = h('section', { class: 'card live', 'aria-live': 'polite' });
    function draw() {
      var st = sh.state, info = sh.info;
      if (st === 'idle' && o.initial === 'arrived') st = 'arrived';
      if (st === 'idle' || st === 'stopped' || st === 'error') {
        setKids(box, h('h2', null, o.title),
          st === 'error' ? h('p', { class: 'msg err' }, info === 'denied' ? 'Position refusée. Autorisez-la dans les réglages du téléphone, puis réessayez.' : 'Position indisponible. Réessayez dans un instant.') : null,
          st === 'stopped' ? h('p', { class: 'muted' }, 'Partage arrêté.') : null,
          h('button', { class: 'btn big', type: 'button', id: 'live-start', onclick: function () { track('tracking_shared', o.kind); sh.start(); } }, st === 'idle' ? o.startLabel : 'Reprendre le partage'),
          h('p', { class: 'hint' }, o.who + ' votre position jusqu’à l’arrivée, puis elle est effacée.'));
      } else if (st === 'arrived') {
        setKids(box, h('p', { class: 'live-big' }, icon('check', 22), 'Arrivée confirmée'),
          // Fin de parcours : le bon moment pour proposer la suite (rétention).
          o.kind === 'guest' ? h('a', { class: 'btn ghost', id: 'guest-create', href: '#/rdv/nouveau' }, 'Créer votre événement')
            : h('a', { class: 'btn ghost', id: 'courier-more', href: '#/livreur' }, courierKey() ? 'Mes courses' : 'Recevoir les courses de vos boutiques'),
          feedSection(2, { id: 'done-feed' }));
      } else {
        setKids(box,
          h('p', { class: 'live-big' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), st === 'starting' ? 'Recherche de votre position…' : 'Position partagée'),
          h('p', { class: 'hint' }, 'Gardez cette page ouverte pendant le trajet.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', id: 'live-arrived', onclick: function () { sh.arrive(); } }, 'Je suis arrivé'),
            h('button', { class: 'btn ghost', type: 'button', id: 'live-stop', onclick: function () { sh.stop(); } }, 'Arrêter')));
      }
    }
    sh.listeners.push(function () { if (document.contains(box)) draw(); });
    draw();
    return box;
  }

  // Carte de suivi : destination fixe + personnes en mouvement. La carte reste claire (tuiles OSM).
  function liveMap(dest) {
    var el = h('div', { class: 'map live-map' });
    var box = h('div', { class: 'map-box' }, el);
    var map = null, L = null, layer = null, pending = null, fitted = false;
    function whenShown(fn) { // Leaflet a besoin d'un conteneur affiché pour calculer la carte
      var seen = false;
      (function wait() { if (el.isConnected) seen = true; if (el.isConnected && el.offsetWidth) fn(); else if (seen && !el.isConnected) return; else setTimeout(wait, 150); })();
    }
    loadLeaflet().then(function (LL) { whenShown(function () {
      L = LL;
      map = L.map(el, { zoomControl: true, attributionControl: true }).setView([dest.lat, dest.lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
      map.attributionControl.setPrefix(false);
      L.circleMarker([dest.lat, dest.lng], { radius: 10, color: '#1E4A34', weight: 3, fillColor: '#C9E265', fillOpacity: 1 }).addTo(map);
      layer = L.layerGroup().addTo(map);
      if (pending) update(pending);
    }); }, function () { box.hidden = true; });
    function update(people) {
      if (!map) { pending = people; return; }
      map.invalidateSize();   // la carte a pu être masquée ou insérée après sa création
      layer.clearLayers();
      var pts = [[dest.lat, dest.lng]];
      people.forEach(function (p) {
        if (!p.pos) return;
        if (p.trail && p.trail.length > 1) L.polyline(p.trail, { color: '#1E4A34', weight: 4, opacity: 0.55 }).addTo(layer);
        var m = L.circleMarker([p.pos.lat, p.pos.lng], { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1E4A34', fillOpacity: 1 }).addTo(layer);
        if (p.label) m.bindTooltip(p.label, { permanent: true, direction: 'top', offset: [0, -8] });
        pts.push([p.pos.lat, p.pos.lng]);
      });
      if (!el.offsetWidth) { pending = people; fitted = false; return; }
      var outside = pts.some(function (pt) { return !map.getBounds().contains(pt); });
      if (pts.length > 1 && (!fitted || outside)) { map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 }); fitted = true; }
    }
    return { el: box, update: update };
  }

  function statusLine(t, dest, name) {
    var big, small = null, cls = 'live-big';
    if (t.status === 'arrived') big = [icon('check', 20), name ? name + ' est arrivé' : 'Livreur arrivé'];
    else if (t.status === 'stopped') { big = name ? name + ' a arrêté le partage' : 'Partage arrêté'; cls += ' muted'; }
    else if (!t.pos) { big = name ? name + ' n’est pas encore parti' : 'Pas encore parti'; cls += ' muted'; }
    else {
      big = [h('span', { class: 'live-dot', 'aria-hidden': 'true' }), (name ? name + ' en route · ' : 'En route · ') + etaText(etaMin(t.pos, dest))];
      small = 'Position ' + agoText(t.pos.at);
    }
    return h('div', { class: 'stack tight' }, h('p', { class: cls }, big), small ? h('p', { class: 'hint' }, small) : null);
  }

  // Suivi d'une livraison (lien de suivi, ou intégré chez le demandeur).
  // La carte n'apparaît que lorsque le livreur roule ; avant, une seule ligne d'état.
  function deliveryWatch(watchToken, courierName) {
    var status = h('div', { role: 'status' }, loading('Chargement du suivi…'));
    var mapW = null;
    var box = h('section', { class: 'card live', id: 'delivery-watch' }, status);
    function load() {
      api('fiila_watch', { p_token: watchToken }).then(function (r) {
        if (r.state !== 'ok') { setKids(status, h('p', { class: 'muted' }, r.state === 'expired' ? 'Livraison terminée.' : 'Suivi indisponible.')); if (mapW) mapW.el.hidden = true; return; }
        var t = r.tracker;
        if (t.pos && !mapW) { mapW = liveMap(r.dest.entry); box.append(mapW.el); }
        if (mapW) { mapW.el.hidden = !t.pos; mapW.update(t.pos ? [{ id: t.id, pos: t.pos, trail: t.trail }] : []); }
        setKids(status, statusLine(t, r.dest.stop || r.dest.entry, courierName || null));
      }, function (e) { setKids(status, h('p', { class: 'alert' }, errText(e))); });
    }
    load(); poll(box, load, 15000);
    return box;
  }

  // Création des liens livreur et suivi (demandeur d'une adresse reçue, ou propriétaire d'une adresse).
  function deliveryPanel(rec, type) {
    var kindParam = type === 'request' ? 'request' : 'place';
    var box = h('div', { class: 'stack', id: 'delivery' });
    var err = h('div', { role: 'alert' });
    function create(ev) {
      var b = ev && ev.currentTarget; if (b) b.disabled = true; setKids(err);
      api('fiila_start_delivery', { p_kind: kindParam, p_id: rec.id, p_owner: rec.owner || null }).then(function (r) {
        owned.upsert(type, rec.id, { delivery: { courier: r.courier_token, watch: r.watch_token } });
        track('delivery_started', kindParam);
        draw();
      }, function (e) { if (b) b.disabled = false; setKids(err, h('p', { class: 'alert' }, errText(e))); });
    }
    function draw() {
      var cur = owned.find(type, rec.id) || {};
      var d = cur.delivery;
      if (!d) {
        setKids(box, h('button', { class: type === 'request' ? 'btn big' : 'btn ghost', type: 'button', id: 'start-delivery', onclick: create }, type === 'request' ? 'Envoyer au livreur' : 'Faire venir un livreur'), err);
        return;
      }
      var courierUrl = baseUrl() + '#/l/' + d.courier, watchUrl = baseUrl() + '#/s/' + d.watch;
      setKids(box,
        h('section', { class: 'card' }, h('h2', null, 'Livraison'),
          iconBtn('a', { class: 'btn', id: 'send-courier', target: '_blank', rel: 'noopener noreferrer',
            href: waLink('Livraison : l’adresse exacte avec la photo de l’entrée. Ouvrez le lien et touchez « Démarrer la livraison » : ' + courierUrl) }, 'moto', 'Envoyer au livreur (WhatsApp)'),
          type === 'request' ? h('a', { class: 'btn ghost', id: 'send-watch', target: '_blank', rel: 'noopener noreferrer',
            href: waLink('Suivez votre livraison en direct : ' + watchUrl) }, 'Envoyer le suivi au client (WhatsApp)') : null,
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost small', type: 'button', id: 'copy-courier', onclick: function () { copy(courierUrl, 'Lien livreur'); } }, 'Copier le lien livreur'),
            h('button', { class: 'btn ghost small', type: 'button', id: 'new-courier', onclick: create }, 'Autre livreur'))),
        err, deliveryWatch(d.watch));
    }
    draw();
    return box;
  }

  // Page du livreur : démarrer la livraison, puis la fiche d'arrivée.
  function viewCourier(token) {
    return api('fiila_courier_view', { p_token: token }).then(function (r) {
      if (r.state === 'expired') return page(stateCard('⌛', 'Livraison terminée', 'Ce lien n’est plus actif.'), footer());
      if (r.state !== 'ok') return page(stateCard('⦸', 'Lien livreur indisponible', 'L’adresse a été désactivée ou le lien n’est pas valide.'), footer());
      var pg = page(courierKey() ? backBtn('Mes courses', '#/livreur') : null, h('p', { class: 'eyebrow' }, 'Livraison'),
        liveShare(token, r.place.entry, { kind: 'courier', title: 'Prêt à partir ?', startLabel: 'Démarrer la livraison', who: 'L’expéditeur et le client voient', initial: r.status }),
        fiche(r.place, { wide: true, voice: r.place.has_voice ? voicePlayer(voiceFrom(token, 'course'), r.place.voice_secs) : null }),
        courierKey() ? null : afterTask('course', { icon: 'moto', title: 'Vous livrez souvent ?', cta: 'Mon espace livreur : toutes vos courses', href: '#/livreur' }),
        footer(true));
      pg.classList.add('wide');
      return pg;
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher la livraison', errText(e), retryBtn())); });
  }

  // Lien de suivi envoyé au client.
  function viewWatch(token) {
    return Promise.resolve(page(brandBar('Livraison'), h('h1', null, 'Votre livraison'), deliveryWatch(token), footer(true)));
  }

  // Invité d'un événement : accepte de partager son trajet avec l'organisateur.
  function guestBlock(shareToken, place) {
    var KEY = 'fiila.guest.' + shareToken;
    var box = h('div', { class: 'stack', id: 'guest' });
    function draw() {
      var g = LS.get(KEY, null);
      if (g && g.token) { setKids(box, liveShare(g.token, place.entry, { kind: 'guest', title: 'Prévenir l’organisateur', startLabel: 'Je pars maintenant', who: 'Seul l’organisateur voit' })); return; }
      var nameIn = h('input', { type: 'text', id: 'guest-name', maxlength: '40', autocomplete: 'given-name', placeholder: 'Votre prénom' });
      var err = h('div', { role: 'alert' });
      setKids(box, h('section', { class: 'card' },
        h('h2', null, 'Prévenir l’organisateur'),
        h('label', { for: 'guest-name' }, 'Votre prénom'), nameIn,
        h('button', { class: 'btn', type: 'button', id: 'guest-join', onclick: function (ev) {
          var b = ev.currentTarget; b.disabled = true; setKids(err);
          api('fiila_join_meeting', { p_share_token: shareToken, p_name: nameIn.value }).then(function (r) {
            LS.set(KEY, { token: r.guest_token, name: nameIn.value.trim() }); track('meeting_joined', 'guest'); draw();
          }, function (e) { b.disabled = false; setKids(err, h('p', { class: 'alert' }, errText(e))); });
        } }, 'Je viens'),
        err));
    }
    draw();
    return box;
  }

  // Organisateur : qui arrive, et quand.
  function guestsPanel(pl, owner) {
    var list = h('div', { class: 'stack', role: 'status' }, loading('Chargement…'));
    var mapW = liveMap(pl.entry);
    mapW.el.hidden = true;
    var box = h('section', { class: 'card live', id: 'guests' }, h('h2', null, 'Qui arrive'), list, mapW.el);
    function load() {
      api('fiila_meeting_guests', { p_id: pl.id, p_owner: owner }).then(function (r) {
        var gs = r.guests || [];
        if (!gs.length) { setKids(list, h('p', { class: 'muted' }, 'Personne pour l’instant.')); mapW.el.hidden = true; return; }
        setKids(list, gs.map(function (g) {
          return h('div', { class: 'guest' }, statusLine(g, pl.entry, g.name),
            h('button', { class: 'btn link small', type: 'button', 'aria-label': 'Retirer ' + g.name, onclick: function () {
              api('fiila_meeting_guest_remove', { p_id: pl.id, p_owner: owner, p_guest_id: g.id }).then(function () { toast(g.name + ' retiré.'); load(); }, function (e) { toast(errText(e)); });
            } }, 'Retirer'));
        }));
        var moving = gs.filter(function (g) { return g.pos; });
        mapW.el.hidden = !moving.length;
        mapW.update(moving.map(function (g) { return { id: g.id, pos: g.pos, trail: g.trail, label: g.name }; }));
      }, function (e) { setKids(list, h('p', { class: 'alert' }, errText(e))); });
    }
    load(); poll(box, load, 15000);
    return box;
  }

  /* ================================================================ VUE DESTINATAIRE */
  function viewRecipient(token) {
    var create = h('a', { class: 'btn ghost small', href: '#/new' }, 'Créer mon Fii');
    return api('fiila_get_public', { p_token: token }).then(function (r) {
      var cta = h('div', { class: 'row', style: 'justify-content:center' }, h('div', { style: 'flex:0 1 auto' }, create));
      if (r.state === 'ok') {
        document.title = 'Fii';
        var mine = owned.all().filter(function (x) { return x.type === 'place' && x.share === token; })[0];
        var isMeet = r.place.kind === 'meeting';
        var joined = isMeet && LS.get('fiila.guest.' + token, null);
        // Rendez-vous : « Créer le vôtre » seulement après l'arrivée de l'invité, pas avant qu'il ait agi.
        var showDiscover = !mine && (!joined || joined.arrived);
        var pg = page(brandBar(isMeet ? 'Événement' : 'Adresse'),
          fiche(r.place, { wide: true, voice: r.place.has_voice ? voicePlayer(voiceFrom(token, 'share'), r.place.voice_secs) : null }),
          h('p', { class: 'safe-line', id: 'recipient-safe' }, icon('lock', 18), 'Lien privé : seules les personnes qui l’ont reçu voient cette fiche.'),
          !mine && isMeet ? guestBlock(token, r.place) : null,
          mine ? ownerBlock(mine) : showDiscover ? discoveryBlock(r.place.kind, token) : null,
          footer(true));
        pg.classList.add('wide');
        return pg;
      }
      var map = {
        revoked: ['⦸', 'Ce lien a été désactivé', 'La personne qui l’a partagé l’a désactivé. Aucune information n’est affichée.'],
        replaced: ['⦸', 'Ce lien a été remplacé', 'La personne qui l’a partagé a créé un nouveau lien. Demandez-le-lui.'],
        expired: ['⌛', 'Cet événement est terminé', 'Le lieu n’est plus affiché.'],
        not_found: ['?', 'Lien introuvable', 'Cette fiche n’existe pas ou a été supprimée.'],
        invalid: ['?', 'Lien non valide', 'Vérifiez que le lien a été copié en entier.']
      }[r.state] || ['?', 'Lien introuvable', ''];
      if (r.state === 'expired') cta = h('div', { class: 'row', style: 'justify-content:center' }, h('div', { style: 'flex:0 1 auto' },
        h('a', { class: 'btn ghost small', href: '#/rdv/nouveau' }, 'Créer mon événement')));
      return page(stateCard(map[0], map[1], map[2]), cta);
    }, function (e) {
      return page(stateCard('!', 'Impossible d’afficher la fiche', errText(e), retryBtn()), create);
    });
  }

  // Le propriétaire qui ouvre son propre lien (depuis WhatsApp, par exemple) retrouve sa gestion, pas une invitation à créer.
  function ownerBlock(rec) {
    return h('section', { class: 'discover', id: 'owner-block', 'aria-labelledby': 'owner-title' },
      h('h2', { id: 'owner-title' }, 'C’est votre fiche'),
      iconBtn('a', { class: 'btn ghost discover-cta', id: 'owner-manage', href: '#/m/' + rec.id }, 'share', 'Gérer et partager'));
  }

  // Bloc de découverte, placé après les informations d'arrivée. Il ouvre le parcours de création
  // existant, vierge : rien de la fiche reçue n'est transmis, sauf le lien de retour (qui reste sur l'appareil).
  function discoveryBlock(kind, token) {
    var isMeeting = kind === 'meeting';
    var variant = isMeeting ? 'meeting' : 'address';
    var block = h('section', { class: 'discover', id: 'discover', 'aria-labelledby': 'discover-title' },
      h('h2', { id: 'discover-title' }, isMeeting ? 'Votre prochain événement' : 'Votre adresse aussi, en une photo'),
      h('p', null, isMeeting
        ? 'Le lieu, l’heure et le chemin dans un seul lien.'
        : 'La porte, un repère, où se garer. Un lien à envoyer.'),
      h('a', { class: 'btn ghost discover-cta', id: 'discover-cta', href: (isMeeting ? '#/rdv/nouveau' : '#/new') + qs({ retour: token }),
        onclick: function () { track('discovery_cta', variant); } }, icon(isMeeting ? 'cal' : 'cam', 22), h('span', null, isMeeting ? 'Créer un événement' : 'Créer mon adresse')),
      h('p', { class: 'hint' }, 'Gratuit. Sans compte.'),
      afterOn() ? servicesLink(isMeeting ? 'event' : 'fiche') : null);
    trackWhenVisible(block, 'discovery_shown', variant);
    return block;
  }

  /* ================================================================ DEMANDE D'ADRESSE */
  function viewRequestNew(q) {
    var src = q && q.depuis ? owned.get('request', q.depuis) : null;
    if (src) {
      return api('fiila_get_request_owner', { p_id: src.id, p_owner: src.owner || null }).then(function (old) {
        return requestForm({ requester_name: old.requester_name || '', purpose: old.purpose || '', order_ref: '' });
      }, function () { return requestForm({ requester_name: '', purpose: '', order_ref: '' }); });
    }
    return requestForm({ requester_name: '', purpose: '', order_ref: '' });
  }
  function requestForm(f) {
    var err = h('div', { role: 'alert' });
    var btn = iconBtn('button', { class: 'btn', type: 'button', disabled: !(f.requester_name.trim() && f.purpose.trim()), onclick: submit }, 'send', 'Créer la demande');
    function chk() { btn.disabled = !(f.requester_name.trim() && f.purpose.trim()); }
    function submit() {
      btn.disabled = true; btn.textContent = 'Création…'; setKids(err);
      api('fiila_create_request', { p: { requester_name: f.requester_name.trim(), purpose: f.purpose.trim(), order_ref: f.order_ref.trim() || null } })
        .then(function (r) {
          owned.put({ type: 'request', id: r.id, owner: r.owner_token, label: f.purpose.trim(), created: Date.now() });
          track('request_created', 'request');
          go('#/demande/' + r.id);
        }, function (e) {
          btn.textContent = 'Réessayer'; chk();
          setKids(err, h('p', { class: 'alert' }, errText(e)));
        });
    }
    return page(backBtn(),
      h('h1', null, 'Demander une adresse'),
      h('p', { class: 'muted' }, 'Pour une livraison, un rendez-vous client ou une visite : la personne répond avec sa fiche, et vous seul la voyez.'),
      textField({ id: 'rq-name', label: 'Votre nom ou celui de votre commerce', max: 60, value: f.requester_name, placeholder: 'Ex. : Boutique Ndèye', onInput: function (v) { f.requester_name = v; chk(); } }),
      textField({ id: 'rq-purpose', label: 'Pourquoi demandez-vous l’adresse ?', max: 80, value: f.purpose, placeholder: 'Ex. : Livraison de votre commande', onInput: function (v) { f.purpose = v; chk(); } }),
      textField({ id: 'rq-ref', label: 'Référence de commande', optional: true, max: 30, placeholder: 'Ex. : CMD-1042', hint: 'N’indiquez jamais de code de paiement ni de mot de passe.', onInput: function (v) { f.order_ref = v; } }),
      err, btn,
      h('p', { class: 'hint' }, 'La demande reste ouverte 7 jours et accepte une seule réponse.'),
      footer());
  }

  function viewRequestOwner(id) {
    var rec = owned.get('request', id);
    if (!rec) return page(backBtn(), stateCard('?', 'Demande introuvable sur ce téléphone', 'Ouvrez sa clé de gestion pour la voir ici.'));
    return api('fiila_get_request_owner', { p_id: id, p_owner: rec.owner || null }).then(function (q) {
      var url = requestUrl(q.share_token);
      // Texte du modèle fiila_address_request_v1 (catalogue WHATSAPP-001) : le vrai demandeur, le motif, une seule action.
      var lead = 'Bonjour,\n' + q.requester_name + ' vous demande votre adresse pour : ' + q.purpose + (q.order_ref ? ' (réf. ' + q.order_ref + ')' : '') +
        '.\nIndiquez votre entrée et, si utile, ajoutez une photo ou un repère.';
      var msg = lead + '\n\nIndiquer mon entrée :\n' + url + '\n\nVotre adresse sert uniquement à cette demande.';
      var zone = h('div', { class: 'stack' });
      var key = rec.owner ? keyUrl('request', q.id, rec.owner) : null;
      var head = h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, 'Demande d’adresse'),
        h('h1', { class: 'wrapword' }, q.purpose),
        h('p', { class: 'muted wrapword' }, 'De : ' + q.requester_name + (q.order_ref ? ' · Réf. ' + q.order_ref : '')));
      var del = h('button', { class: 'btn danger', type: 'button', onclick: function () {
        setKids(zone, h('div', { class: 'confirm' },
          h('p', null, h('strong', null, 'Supprimer cette demande ?')),
          h('p', { class: 'small' }, 'Vous ne verrez plus la réponse. L’adresse du client n’est pas supprimée : elle lui appartient.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn danger-fill', type: 'button', onclick: function () {
              api('fiila_delete_request', { p_id: q.id, p_owner: rec.owner || null }).then(function () { owned.remove('request', q.id); toast('Demande supprimée.'); go('#/'); },
                function (e) { setKids(zone, h('p', { class: 'alert' }, errText(e))); });
            } }, 'Supprimer'),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(zone); } }, 'Annuler'))));
      } }, 'Supprimer la demande');
      var keyBox = !key ? null : h('details', null, h('summary', null, 'Clé de gestion de la demande'),
        h('div', { class: 'stack', style: 'margin-top:10px' },
          h('p', { class: 'small' }, 'Permet de consulter la réponse depuis un autre téléphone. Ne la partagez pas.'),
          iconBtn('button', { class: 'btn ghost small', type: 'button', onclick: function () { copy(key, 'Clé de gestion'); } }, 'link', 'Copier la clé de gestion')));
      var stateBlock;
      if (q.state === 'fulfilled') {
        stateBlock = [h('span', { class: 'chip ok', style: 'align-self:flex-start' }, icon('check', 12), 'Adresse reçue le ' + shortDate(q.fulfilled_at)),
          h('p', { class: 'small muted' }, 'Visible uniquement par vous, avec ce téléphone ou la clé de gestion. Le client peut la désactiver à tout moment.'),
          deliveryPanel(rec, 'request'),
          fiche(q.place, { voice: q.place && q.place.has_voice ? voicePlayer(voicePrivate('request', q.id, rec.owner), q.place.voice_secs) : null })];
      } else if (q.state === 'pending') {
        stateBlock = [h('span', { class: 'chip wait', style: 'align-self:flex-start' }, icon('clock', 12), 'En attente de réponse'),
          sharePanel({ kind: 'request', url: url, msg: msg, text: lead, title: q.purpose, card: 'request', ids: { url: 'request-url', copy: 'copy-request', native: 'share-request' } }),
          h('p', { class: 'hint' }, 'Le client voit votre nom et la raison de la demande, jamais d’autres réponses.'),
          h('button', { class: 'btn', type: 'button', id: 'refresh', onclick: render }, 'Vérifier si le client a répondu')];
      } else if (q.state === 'expired') {
        stateBlock = [h('div', { class: 'notice' }, 'Cette demande a expiré sans réponse.'),
          h('a', { class: 'btn', id: 'request-again', href: '#/demande/nouvelle' + qs({ depuis: q.id }) }, 'Refaire la demande')];
      } else if (q.state === 'place_revoked') {
        stateBlock = [h('div', { class: 'notice' }, 'Le client a désactivé l’adresse qu’il vous avait envoyée. Elle n’est plus visible.')];
      } else {
        stateBlock = [h('div', { class: 'notice' }, 'Le client a supprimé l’adresse qu’il vous avait envoyée.')];
      }
      return page(backBtn(), head, stateBlock, del, zone, keyBox, footer());
    }, function (e) {
      if (e.code === 'not_found') return page(backBtn(), stateCard('?', 'Demande introuvable', 'Elle a peut-être été supprimée.',
        h('button', { class: 'btn ghost', type: 'button', onclick: function () { owned.remove('request', id); go('#/'); } }, 'La retirer de ce téléphone')));
      return page(backBtn(), stateCard('!', 'Impossible de charger la demande', errText(e), retryBtn()));
    });
  }

  // Adresse envoyée : confirmation courte, puis le meilleur moment pour la partager à ses proches.
  function sentView(name, shareToken, placeId, backInvoice) {
    var sent = Number(LS.get('fiila.sent', 0) || 0) + 1;
    LS.set('fiila.sent', sent);
    var url = shareToken ? shareUrl(shareToken) : null;
    return page(
      brandBar('Adresse envoyée'),
      h('section', { class: 'card state', id: 'sent' },
        h('div', { class: 'big', 'aria-hidden': 'true' }, icon('check', 26)),
        h('h2', null, name + ' a votre adresse.'),
        backInvoice ? iconBtn('a', { class: 'btn', id: 'back-invoice', href: '#/f/' + backInvoice }, 'back', 'Revenir à ma commande') : null),
      url ? h('section', { class: 'card', id: 'share-close' },
        h('h2', null, 'Votre adresse est prête'),
        h('p', { class: 'small muted' }, 'Envoyez-la à vos proches : ils vous trouveront sans appeler.'),
        iconBtn('a', { class: 'btn', id: 'share-relatives', href: waLink('Mon adresse, avec la photo de l’entrée : ' + url), target: '_blank', rel: 'noopener noreferrer',
          onclick: waCardClick('address', 'Mon adresse, avec la photo de l’entrée : ' + url, 'address') }, 'chat', 'Envoyer sur WhatsApp'),
        h('a', { class: 'btn link', href: '#/m/' + placeId, style: 'align-self:flex-start' }, 'Voir mon adresse')) : null,
      backInvoice ? (shopKey() || (ME && ME.shop) ? null : afterTask('order', { icon: 'shop', title: 'Vous vendez aussi ?', cta: 'Ouvrir ma boutique gratuite', href: '#/boutique' }))
        : afterTask('sent', { icon: 'ask', title: 'Vous livrez ou vendez ?', cta: 'Demander l’adresse de vos clients', href: '#/demande/nouvelle' }),
      feedSection(2, { id: 'done-feed', title: 'Boutiques à découvrir', sub: 'Commandez sans compte, livré à la bonne porte.' }),
      !authed() && sent >= 2 ? nudgeCard('sent-nudge', 'Gardez vos adresses', 'Retrouvez-les même si vous changez de téléphone.',
        '#/compte' + qs({ mode: 'inscription', source: 'nudge' }), function () { LS.set('fiila.nudge.until', Date.now() + 14 * 864e5); }) : null,
      footer(true));
  }

  function viewRequestPublic(token, q) {
    return api('fiila_get_request_public', { p_token: token }).then(function (r) {
      if (r.state === 'fulfilled') return page(stateCard('✓', 'Demande déjà traitée', 'Cette demande a déjà reçu une adresse.'), footer());
      if (r.state === 'expired') return page(stateCard('⌛', 'Demande expirée', 'Demandez un nouveau lien à la personne.'), footer());
      if (r.state !== 'pending') return page(stateCard('?', 'Demande introuvable', 'Vérifiez que le lien a été copié en entier.'), footer());

      var fromInvoice = !!tokenParam(q && q.f);
      var showRef = r.order_ref && r.purpose.indexOf(r.order_ref.replace(/^N° /, '')) < 0;
      var head = h('section', { class: 'card arrive', id: 'request-arrive' },
        h('p', { class: 'eyebrow' }, 'Votre entrée'),
        h('h1', { class: 'wrapword', style: 'font-size:24px' }, r.requester_name + ' vous demande votre adresse'),
        h('p', { class: 'wrapword' }, (r.shop ? r.purpose.replace(/^Livraison de la commande/, 'Pour la commande') : 'Pour : ' + r.purpose) + (showRef ? ' · ' + r.order_ref : '')),
        h('p', { class: 'safe-line', id: 'request-safe' }, icon('lock', 18), 'Votre adresse ira uniquement à ' + r.requester_name + '. Vous pourrez la retirer à tout moment.'));
      var listBox = h('div', { class: 'stack' }, loading('Recherche de vos adresses sur ce téléphone…'));
      var prev = h('div', { class: 'stack' });
      var err = h('div', { role: 'alert' });
      var mine = owned.all().filter(function (x) { return x.type === 'place' && (x.kind || 'address') === 'address'; });
      var sel = q && q.sel;
      var backInvoice = tokenParam(q && q.f);

      function showPreview() {
        setKids(prev);
        if (!sel) return;
        var rec = owned.get('place', sel);
        if (!rec) return;
        prev.append(loading('Préparation de l’aperçu…'));
        api('fiila_get_owned', { p_id: sel, p_owner: rec.owner || null }).then(function (pl) {
          var send = h('button', { class: 'btn', type: 'button', id: 'send-address', onclick: function () {
            send.disabled = true; send.textContent = 'Envoi…'; setKids(err);
            api('fiila_fulfill_request', { p_token: token, p_place_id: sel, p_place_owner: rec.owner || null }).then(function () {
              showView(sentView(r.requester_name, pl.share_token || (owned.find('place', sel) || {}).share, sel, backInvoice));
              window.scrollTo(0, 0);
            }, function (e) {
              send.disabled = false; send.textContent = 'Réessayer l’envoi';
              setKids(err, h('p', { class: 'alert' }, errText(e)));
            });
          } }, icon('send', 22), h('span', null, 'Envoyer à ' + r.requester_name));
          setKids(prev, send, err, h('details', null, h('summary', null, 'Voir ce qui sera envoyé'), h('div', { style: 'margin-top:12px' }, fiche(pl))));
        }, function (e) { setKids(prev, h('p', { class: 'alert' }, errText(e))); });
      }

      if (mine.length || authed()) {
        api('fiila_owned_summaries', { p_items: mine.map(function (x) { return { type: 'place', id: x.id, owner: x.owner }; }) }).then(function (rows) {
          var usable = rows.filter(function (x) { return !x.missing && x.status === 'active' && (x.kind || 'address') === 'address'; });
          if (sel && !usable.some(function (x) { return x.id === sel; })) sel = null;
          if (!sel && usable.length === 1) sel = usable[0].id;
          setKids(listBox);
          add(listBox, usable.length ? [h('h2', null, 'Choisir une de mes adresses'),
            h('div', { class: 'choice one', role: 'radiogroup' }, usable.map(function (x) {
              return h('label', null, h('input', { type: 'radio', name: 'pick', value: x.id, checked: x.id === sel, onchange: function () { sel = x.id; showPreview(); } }),
                h('span', { class: 'wrapword' }, (x.tag ? TAGS[x.tag] + ' · ' : '') + x.label + (x.locality ? ' · ' + x.locality : '')));
            }))] : null);
          showPreview();
        }, function (e) { setKids(listBox, h('p', { class: 'alert' }, errText(e))); });
      } else setKids(listBox);

      return page(brandBar('Demande d’adresse'), head,
        listBox,
        h('a', { class: mine.length ? 'btn ghost' : 'btn', id: 'new-address-for-request', href: '#/new' + qs({ d: token, f: backInvoice || undefined }) }, icon(mine.length ? 'plus' : 'cam', 22), h('span', null, mine.length ? 'Créer une autre adresse' : 'Créer mon adresse')),
        prev,
        r.shop ? h('p', { class: 'hint' }, 'La boutique pourra la réutiliser. Vous pouvez l’arrêter.') : null,
        footer(true));
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher la demande', errText(e), retryBtn())); });
  }

  /* ================================================================ RENDEZ-VOUS */
  function dakarParts(iso) {
    var d = new Date(iso);
    return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; // Dakar = UTC+0 toute l'année
  }
  function viewMeetingForm(editId, q) {
    if (editId) {
      var rec = owned.get('place', editId);
      if (!rec) return page(backBtn(), stateCard('?', 'Événement introuvable sur ce téléphone', ''));
      return api('fiila_get_owned', { p_id: editId, p_owner: rec.owner || null }).then(function (pl) {
        var s = dakarParts(pl.starts_at);
        var hours = Math.round((new Date(pl.expires_at) - new Date(pl.starts_at)) / 3600e3);
        return meetingForm({
          label: pl.label, date: s.date, time: s.time, entry: { lat: pl.entry.lat, lng: pl.entry.lng, src: 'saved' },
          hasStop: pl.vehicle_ok === false, stop: pl.stop ? { lat: pl.stop.lat, lng: pl.stop.lng, src: 'saved' } : null,
          walk: pl.walk || '', instruction: pl.instruction || '', photo: pl.photo || null,
          exp: String([2, 24, 168].indexOf(hours) >= 0 ? hours : 24)
        }, { editId: editId, owner: rec.owner, originalPhoto: pl.photo || null });
      }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger l’événement', errText(e), retryBtn())); });
    }
    if (q && q.depuis) return viewSimilarMeeting(q.depuis);
    var key = MEETING_DRAFT;
    var saved = LS.get(key, null);
    var today = new Date(Date.now() + 3600e3).toISOString();
    return meetingForm(saved || { label: '', date: today.slice(0, 10), time: '19:00', entry: null, hasStop: false, stop: null, walk: '', instruction: '', photo: null, exp: '24' },
      { retour: tokenParam(q && q.retour), draftKey: key, restored: !!saved });
  }
  var MEETING_DRAFT = 'fiila.draft.meeting';
  // « Créer un événement similaire » : nouveau brouillon, enregistré comme une fiche distincte.
  // Repris : lieu (à reconfirmer), arrêt voiture (à reconfirmer), trajet à pied, indications, photo, durée d'affichage.
  // Jamais repris : nom, date et heure, liens, clé de gestion, statut (désactivé, expiré).
  function viewSimilarMeeting(sourceId) {
    var rec = owned.get('place', sourceId);
    if (!rec) return page(backBtn(), stateCard('?', 'Événement introuvable sur ce téléphone', 'Ouvrez sa clé de gestion pour le réutiliser ici.'));
    var key = MEETING_DRAFT + '.similaire.' + sourceId;
    var saved = LS.get(key, null);
    return api('fiila_get_owned', { p_id: sourceId, p_owner: rec.owner || null }).then(function (pl) {
      if (pl.kind !== 'meeting') return page(backBtn(), stateCard('?', 'Ce n’est pas un événement', ''));
      var hours = Math.round((new Date(pl.expires_at) - new Date(pl.starts_at)) / 3600e3);
      var f = saved || {
        label: '', date: '', time: '', entry: null, entryInitial: { lat: pl.entry.lat, lng: pl.entry.lng },
        hasStop: pl.vehicle_ok === false, stop: null, stopInitial: pl.stop ? { lat: pl.stop.lat, lng: pl.stop.lng } : null,
        walk: pl.walk || '', instruction: pl.instruction || '', photo: pl.photo || null,
        exp: String([2, 24, 168].indexOf(hours) >= 0 ? hours : 24)
      };
      return meetingForm(f, { similarOf: sourceId, sourceLabel: pl.label, draftKey: key, restored: !!saved });
    }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger l’événement', errText(e), retryBtn())); });
  }
  // Types d'événement : un toucher remplit le début du nom (le type n'est pas enregistré à part).
  var EVENT_TYPES = [['Mariage', 'Mariage de ', 'gift'], ['Baptême', 'Baptême de ', 'users'], ['Anniversaire', 'Anniversaire de ', 'star'],
    ['Condoléances', 'Condoléances – famille ', 'home'], ['Réunion', 'Réunion ', 'cal'], ['Autre', '', 'plus']];
  function eventTypes(f, done) {
    var box = h('div', { class: 'ev-types', role: 'group', 'aria-label': 'Type d’événement', id: 'ev-types' });
    function draw() {
      setKids(box, EVENT_TYPES.map(function (t) {
        var on = t[1] && f.label.indexOf(t[1]) === 0;
        return h('button', { class: 'ev-type' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: function () {
          var prev = EVENT_TYPES.filter(function (x) { return x[1] && f.label.indexOf(x[1]) === 0; })[0];
          var rest = prev ? f.label.slice(prev[1].length) : (f.label.trim() ? f.label : '');
          f.label = t[1] + rest; draw(); done();
        } }, h('span', { class: 'ev-ic', 'aria-hidden': 'true' }, icon(t[2], 22)), h('span', null, t[0]));
      }));
    }
    draw();
    return box;
  }
  function meetingForm(f, ctx) {
    var err = h('div', { role: 'alert' });
    var why = h('p', { class: 'hint', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'button', onclick: submit }, ctx.editId ? 'Enregistrer les modifications' : 'Créer l’événement');
    function times() {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !/^\d{2}:\d{2}$/.test(f.time)) return null;
      var start = new Date(f.date + 'T' + f.time + ':00Z');
      if (isNaN(start)) return null;
      return { start: start, end: new Date(start.getTime() + Number(f.exp) * 3600e3) };
    }
    function problem() {
      if (!f.label.trim()) return 'Donnez un nom à l’événement.';
      var t = times();
      if (!t) return 'Indiquez la date et l’heure.';
      if (t.end <= new Date()) return 'Avec cette date, la fiche aurait déjà disparu. Choisissez une date future ou une durée plus longue.';
      if (!f.entry && f.entryInitial) return 'Confirmez le lieu repris en appuyant sur « Valider ce point ».';
      if (!f.entry) return 'Validez le lieu de l’événement sur la carte.';
      if (f.hasStop && !f.stop) return 'Validez le point d’arrêt voiture, ou décochez l’option.';
      return '';
    }
    function saveDraft() {
      if (!ctx.draftKey) return;
      if (!LS.set(ctx.draftKey, f)) LS.set(ctx.draftKey, Object.assign({}, f, { photo: null }));
    }
    function chk() { var p = problem(); btn.disabled = !!p; why.textContent = p; }
    function changed() { saveDraft(); chk(); }
    function submit() {
      if (problem()) return;
      var t = times();
      var p = {
        kind: 'meeting', label: f.label.trim(), instruction: f.instruction.trim() || null,
        entry: { lat: f.entry.lat, lng: f.entry.lng, acc: f.entry.acc == null ? null : f.entry.acc },
        vehicle_ok: !f.hasStop, stop: f.hasStop && f.stop ? { lat: f.stop.lat, lng: f.stop.lng } : null,
        walk: f.hasStop ? (f.walk.trim() || null) : null,
        starts_at: t.start.toISOString(), expires_at: t.end.toISOString()
      };
      if (!ctx.editId || f.photo !== ctx.originalPhoto) p.photo = f.photo ? f.photo.replace(/^data:[^,]+,/, '') : null;
      btn.disabled = true; btn.textContent = 'Enregistrement…'; setKids(err);
      var call = ctx.editId ? api('fiila_update_place', { p_id: ctx.editId, p_owner: ctx.owner || null, p: p }) : api('fiila_create_place', { p: p });
      call.then(function (r) {
        if (ctx.editId) { owned.patch('place', ctx.editId, { label: p.label }); toast('Événement mis à jour. Le lien reste le même.'); go('#/m/' + ctx.editId); return; }
        var stored = owned.put({ type: 'place', kind: 'meeting', id: r.id, owner: r.owner_token, share: r.share_token, label: p.label, created: Date.now() });
        attribute('meeting', r.id, r.owner_token, '', ctx.retour ? { src: 'address', token: ctx.retour } : null);
        if (ctx.draftKey) LS.del(ctx.draftKey);
        LS.set('fiila.saved', true);
        track('fiche_created', ctx.similarOf ? 'meeting_similar' : ctx.retour ? 'meeting_discovery' : 'meeting_direct');
        toast('Événement enregistré.');
        go('#/m/' + r.id + qs({ k: stored ? null : r.owner_token, retour: ctx.retour, nouveau: '1' }));
      }, function (e) {
        btn.textContent = 'Réessayer'; chk();
        setKids(err, h('p', { class: 'alert' }, errText(e)));
      });
    }
    var stopBox = h('div', { class: 'stack' });
    function drawStop() {
      setKids(stopBox);
      if (f.hasStop) add(stopBox, [
        mapPicker({ id: 'm-stop', what: 'l’arrêt voiture', initial: f.stopInitial, get: function () { return f.stop; }, set: function (p) { f.stop = p; changed(); } }),
        textField({ id: 'm-walk', label: 'Du point d’arrêt jusqu’au lieu', multiline: true, max: 200, value: f.walk, onInput: function (v) { f.walk = v; saveDraft(); } })]);
    }
    drawStop(); chk();
    return page(ctx.retour ? backBtn('Revenir à la fiche reçue', '#/a/' + ctx.retour)
      : ctx.similarOf ? backBtn('Retour à l’événement d’origine', '#/m/' + ctx.similarOf)
      : backBtn(ctx.editId ? 'Retour à l’événement' : 'Accueil', ctx.editId ? '#/m/' + ctx.editId : '#/'),
      h('h1', null, ctx.editId ? 'Modifier l’événement' : ctx.similarOf ? 'Événement similaire' : 'Créer un événement'),
      ctx.similarOf
        ? h('div', { class: 'notice', id: 'similar-notice' }, 'À partir de « ' + ctx.sourceLabel + ' ». Le lieu, l’arrêt voiture, les indications et la photo sont repris. Choisissez un nom, une nouvelle date et confirmez le lieu sur la carte. L’événement d’origine ne change pas.')
        : h('p', { class: 'muted' }, 'Mariage, baptême, anniversaire, réunion : un seul lien pour que tous vos invités trouvent le lieu. Il cesse de s’afficher après la date.'),
      ctx.restored ? h('div', { class: 'row', style: 'align-items:center' },
        h('p', { class: 'hint', style: 'flex:1 1 200px' }, 'Brouillon repris là où vous l’aviez laissé.'),
        h('button', { class: 'btn link', type: 'button', id: 'clear-draft', style: 'flex:0 0 auto', onclick: function () { LS.del(ctx.draftKey); render(); } }, 'Recommencer')) : null,
      ctx.editId || ctx.similarOf ? null : eventTypes(f, function () { var i = document.getElementById('m-label'); if (i) { i.value = f.label; i.focus(); i.setSelectionRange(i.value.length, i.value.length); } changed(); }),
      textField({ id: 'm-label', label: 'Nom de l’événement', max: 60, value: f.label, placeholder: 'Ex. : Baptême chez Awa', onInput: function (v) { f.label = v; changed(); } }),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'm-date' }, ctx.similarOf ? 'Nouvelle date' : 'Date'), h('input', { type: 'date', id: 'm-date', value: f.date, oninput: function (e) { f.date = e.target.value; changed(); } })),
        h('div', { class: 'field' }, h('label', { for: 'm-time' }, 'Heure'), h('input', { type: 'time', id: 'm-time', value: f.time, oninput: function (e) { f.time = e.target.value; changed(); } }))),
      h('p', { class: 'hint' }, 'Heure de Dakar (GMT), quel que soit le fuseau de votre téléphone.'),
      h('h2', null, 'Lieu de l’événement'),
      mapPicker({ id: 'm-entry', what: 'le lieu de l’événement', initial: f.entryInitial, get: function () { return f.entry; }, set: function (p) { f.entry = p; changed(); } }),
      textField({ id: 'm-instr', label: 'Indications sur place', optional: true, multiline: true, max: 280, value: f.instruction, placeholder: 'Ex. : tente blanche derrière la mosquée', onInput: function (v) { f.instruction = v; saveDraft(); } }),
      photoField({ id: 'm-photo', optional: true, get: function () { return f.photo; }, set: function (p) { f.photo = p; saveDraft(); } }),
      h('div', { class: 'choice one' },
        h('label', null, h('input', { type: 'checkbox', id: 'm-hasstop', checked: f.hasStop, onchange: function (e) { f.hasStop = e.target.checked; if (!f.hasStop) f.stop = null; drawStop(); changed(); } }), 'Ajouter un point d’arrêt voiture distinct')),
      stopBox,
      h('div', { class: 'field' }, h('label', { for: 'm-exp' }, 'Le lieu cesse d’être affiché'),
        h('select', { id: 'm-exp', onchange: function (e) { f.exp = e.target.value; changed(); } },
          h('option', { value: '2', selected: f.exp === '2' }, '2 heures après le début'),
          h('option', { value: '24', selected: f.exp === '24' }, '24 heures après le début'),
          h('option', { value: '168', selected: f.exp === '168' }, '7 jours après le début'))),
      err, btn, why,
      h('p', { class: 'hint' }, 'Les invités voient vos modifications en rouvrant le lien. Aucune notification n’est envoyée.'),
      footer());
  }

  /* ================================================================ CLÉ DE GESTION */
  function viewRestore(payload) {
    if (payload) {
      // Retire immédiatement la clé de l'adresse affichée et de l'historique.
      try { history.replaceState(null, '', location.pathname + '#/cle'); } catch (e) { /* rien */ }
      return restore(payload);
    }
    var val = '';
    var err = h('div', { role: 'alert' });
    return page(backBtn(),
      h('h1', null, 'Restaurer une clé de gestion'),
      h('p', { class: 'muted' }, 'Collez la clé de gestion d’une fiche pour la gérer depuis ce téléphone.'),
      textField({ id: 'key-in', label: 'Clé de gestion', placeholder: 'https://…#/k/…', onInput: function (v) { val = v; } }),
      err,
      h('button', { class: 'btn', type: 'button', onclick: function () {
        var m = /#\/k\/([^\s]+)/.exec(val) || /^([pr]\.[^\s]+)$/.exec(val.trim());
        if (!m) { setKids(err, h('p', { class: 'alert' }, 'Clé non reconnue. Collez-la en entier.')); return; }
        restore(m[1]).then(function (node) { showView(node); });
      } }, 'Restaurer'),
      footer());
  }
  function restore(payload) {
    var parts = String(payload).split('.');
    if (parts.length !== 3 || (parts[0] !== 'p' && parts[0] !== 'r')) return Promise.resolve(page(backBtn(), stateCard('?', 'Clé non valide', 'Vérifiez que la clé a été copiée en entier.')));
    var type = parts[0] === 'r' ? 'request' : 'place', id = parts[1], owner = parts[2];
    var fn = type === 'request' ? 'fiila_get_request_owner' : 'fiila_get_owned';
    return api(fn, { p_id: id, p_owner: owner }).then(function (x) {
      owned.put({ type: type, kind: x.kind || undefined, id: id, owner: owner, label: x.label || x.purpose, created: Date.now() });
      toast('Clé restaurée sur ce téléphone.');
      location.hash = type === 'request' ? '#/demande/' + id : '#/m/' + id;
      return loading();
    }, function (e) {
      return page(backBtn(), stateCard('?', 'Clé non valide', e.code === 'not_found' ? 'Cette clé ne correspond à aucune fiche. La fiche a peut-être été supprimée.' : errText(e)));
    });
  }

  /* ================================================================ COMPTE, CARNET D'ADRESSES, BOUTIQUE
     Rali dans Fii : un compte (facultatif) qui garde les adresses de l'utilisateur sur tous ses
     téléphones, et pour un commerçant une boutique : clients, commandes, facture partageable,
     demande d'adresse liée, livraison suivie, paiements enregistrés. Paiement en ligne : plus tard. */
  // Boutique sans compte obligatoire : sa clé reste sur ce téléphone (comme la clé d'une fiche).
  var SHOP_LS = 'fiila.shop';
  function shopKey() { var x = LS.get(SHOP_LS, null); return (x && x.key) || null; }
  function sapi(fn, args) { return api(fn, Object.assign({ p_key: shopKey() }, args || {})); }
  var TAGS = { home: 'Maison', work: 'Bureau', shop: 'Boutique', other: 'Autre' };
  var PAY_METHODS = { cash: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', other: 'Autre' };
  function fcfa(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA'; }
  function initials(me) {
    var n = ((me && (me.display_name || me.email)) || '').trim();
    return n ? n.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() : '';
  }
  function avatarEl(me, size) {
    var st = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px';
    if (me && me.avatar) return h('img', { class: 'avatar', src: me.avatar, alt: '', style: st });
    return h('span', { class: 'avatar', style: st, 'aria-hidden': 'true' }, initials(me));
  }
  // Numéro pour un lien WhatsApp direct : 9 chiffres sénégalais → indicatif 221 ajouté.
  function waNumber(phone) {
    var d = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
    if (/^[37]\d{8}$/.test(d)) d = '221' + d;
    return d.length >= 8 && d.length <= 15 ? d : '';
  }
  function waTo(phone, text) { var n = waNumber(phone); return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(text) : waLink(text); }
  function invoiceUrl(token) { return baseUrl() + '#/f/' + token; }
  function safeRetour(v) { return v && /^[a-z0-9\/_-]{1,90}$/i.test(v) && !/\/\//.test(v) ? '#/' + v.replace(/^\/+/, '') : '#/'; }
  function segField(o) {
    // o : { legend, name, options: [[value, label]], value, onChange, id }
    return h('fieldset', { class: 'segfield', id: o.id || null }, o.legend ? h('legend', null, o.legend) : null,
      h('div', { class: 'segs' }, o.options.map(function (opt) {
        return h('label', null, h('input', { type: 'radio', name: o.name, value: opt[0], checked: o.value === opt[0] ? 'checked' : null,
          onchange: function () { o.onChange(opt[0]); } }), opt[1]);
      })));
  }
  function passwordField(id, label, ac, onInput) {
    var inp = h('input', { id: id, type: 'password', autocomplete: ac, maxlength: '72', oninput: function (e) { onInput(e.target.value); } });
    var tog = h('button', { class: 'btn ghost small pw-toggle', type: 'button', 'aria-controls': id, 'aria-pressed': 'false', onclick: function () {
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      tog.textContent = show ? 'Masquer' : 'Afficher';
      tog.setAttribute('aria-pressed', String(show));
    } }, 'Afficher');
    return h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'pw-row' }, inp, tog));
  }
  function needLogin(retour, title, text) {
    return page(backBtn(), stateCard('?', title, text,
      h('a', { class: 'btn', id: 'login-cta', href: '#/compte' + qs({ retour: retour }) }, 'Se connecter ou créer un compte')), footer());
  }
  function failPage(title, retour) {
    return function (e) {
      if (e.code === 'shop_required') { redirect('#/boutique'); return loading(); }
      if (e.code === 'session_expired' || e.code === 'auth_required') return needLogin(retour, 'Reconnectez-vous', 'Votre session a expiré.');
      return page(backBtn(), stateCard('!', title, errText(e), retryBtn()), footer());
    };
  }
  function errBox(box, e) { setKids(box, h('p', { class: 'alert' }, errText(e))); }

  // Classement d'une adresse dans le carnet (maison, bureau, boutique, autre).
  function tagPicker(pl, owner) {
    var opts = Object.keys(TAGS).map(function (k) { return [k, TAGS[k]]; });
    return segField({ legend: 'Classer cette adresse', name: 'tag', id: 'tag-pick', options: opts, value: pl.tag || null, onChange: function (k) {
      api('fiila_set_tag', { p_id: pl.id, p_owner: owner || null, p_tag: k }).then(function () { toast('Classée : ' + TAGS[k] + '.'); }, function (e) { toast(errText(e)); });
    } });
  }

  /* ----- compte : connexion, inscription, mot de passe oublié */
  function viewAccount(q) {
    q = q || {};
    if (q.lien === 'invalide') return page(backBtn(), stateCard('!', 'Ce lien ne s’ouvre pas ici', 'Il a expiré, ou il a été ouvert ailleurs que là où la demande a été faite (par exemple Safari au lieu de l’icône Fii). Refaites la demande depuis le navigateur où vous ouvrez vos e-mails.', h('a', { class: 'btn', href: '#/compte' }, 'Se connecter')), footer());
    if (!authed()) return authForm(q);
    return account.me().then(function (me) {
      if (!me) return authForm(q);
      return profileView(me, q);
    }, failPage('Impossible de charger votre compte', 'compte'));
  }

  function authForm(q) {
    var mode = q.mode === 'inscription' ? 'signup' : q.mode === 'oubli' ? 'forgot' : 'login';
    var f = { email: '', password: '', name: '' };
    var retour = safeRetour(q.retour);
    var root = h('div', { class: 'wrap' });
    function draw() {
      var err = h('div', { role: 'alert' });
      var btn = h('button', { class: 'btn', type: 'submit', id: 'auth-submit' },
        mode === 'signup' ? 'Créer mon compte' : mode === 'forgot' ? 'Recevoir un lien' : 'Se connecter');
      function submit(ev) {
        ev.preventDefault();
        setKids(err);
        var email = f.email.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errBox(err, new ApiError('email_address_invalid'));
        if (mode === 'signup' && f.password.length < 8) return errBox(err, new ApiError('weak_password'));
        if (mode === 'login' && !f.password) return errBox(err, new ApiError('invalid_credentials'));
        btn.disabled = true;
        var label = btn.textContent; btn.textContent = 'Un instant…';
        var p = mode === 'signup' ? account.signUp(email, f.password, f.name.trim(), q.source)
          : mode === 'forgot' ? account.recover(email) : account.signIn(email, f.password);
        p.then(function (r) {
          if (mode === 'forgot') { emailCodeStep(root, 'recovery', email); return; }
          if (r && r.confirm) { emailCodeStep(root, 'signup', email); return; }
          toast(mode === 'signup' ? 'Compte créé.' : 'Connecté.');
          if (pendingClaims().count) go('#/compte' + qs({ rattacher: '1', retour: q.retour }));
          else go(retour);
        }, function (e) {
          btn.disabled = false; btn.textContent = label;
          errBox(err, e);
        });
      }
      var tabs = mode === 'forgot' ? null : h('div', { class: 'tabs', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', id: 'tab-login', 'aria-selected': String(mode === 'login'), onclick: function () { mode = 'login'; draw(); } }, 'Se connecter'),
        h('button', { type: 'button', role: 'tab', id: 'tab-signup', 'aria-selected': String(mode === 'signup'), onclick: function () { mode = 'signup'; draw(); } }, 'Créer un compte'));
      setKids(root, backBtn(),
        h('div', { class: 'stack tight' },
          h('h1', null, mode === 'forgot' ? 'Mot de passe oublié' : 'Mon compte'),
          h('p', { class: 'muted' }, mode === 'forgot' ? 'Recevez un lien par e-mail pour en choisir un nouveau.' : 'Vos adresses et votre boutique, sur tous vos téléphones.')),
        tabs,
        h('form', { class: 'stack', novalidate: true, onsubmit: submit },
          mode === 'signup' ? textField({ id: 'acc-name', label: 'Votre nom', max: 60, value: f.name, autocomplete: 'name', onInput: function (v) { f.name = v; } }) : null,
          textField({ id: 'acc-email', label: 'E-mail', type: 'email', autocomplete: 'email', inputmode: 'email', max: 254, value: f.email, onInput: function (v) { f.email = v; } }),
          mode !== 'forgot' ? passwordField('acc-pass', 'Mot de passe',
            mode === 'signup' ? 'new-password' : 'current-password', function (v) { f.password = v; }) : null,
          err, btn),
        mode === 'login' ? h('button', { class: 'btn link', type: 'button', id: 'forgot', style: 'align-self:flex-start', onclick: function () { mode = 'forgot'; draw(); } }, 'Mot de passe oublié ?') : null,
        mode === 'forgot' ? h('button', { class: 'btn link', type: 'button', style: 'align-self:flex-start', onclick: function () { mode = 'login'; draw(); } }, 'Revenir à la connexion') : null,
        mode === 'signup' ? h('p', { class: 'hint' }, 'Les fiches déjà créées sur ce téléphone rejoindront votre compte.') : null,
        footer());
    }
    draw();
    return root;
  }

  // Code à 6 chiffres reçu par e-mail (mot de passe oublié, activation du compte). Il marche quel que soit l'endroit
  // où l'e-mail est ouvert ; le lien du même e-mail, lui, ne marche que dans le navigateur qui a fait la demande.
  function emailCodeStep(root, kind, email, after) {
    var err = h('div', { role: 'alert' });
    var code = '';
    var input = h('input', { type: 'text', id: 'mail-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 10, pattern: '[0-9 ]*',
      class: 'bo-code', placeholder: '123456', 'aria-label': 'Code reçu par e-mail', oninput: function (ev) { code = ev.target.value; } });
    var btn = iconBtn('button', { class: 'btn', type: 'button', id: 'mail-code-ok', onclick: function () {
      setKids(err);
      var c = code.replace(/\s/g, '');
      if (!/^\d{6,10}$/.test(c)) return errBox(err, new ApiError('otp_expired'));
      btn.disabled = true;
      account.emailVerify(kind, email, c).then(function () {
        if (kind === 'recovery') go('#/compte?mdp=1');
        else { track('account_created', 'code'); go(after || '#/compte?bienvenue=1'); }
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, 'check', 'Valider');
    // Le lien reste la voie principale ; le code (si l'e-mail en contient un) se saisit dans une section repliée.
    setKids(root, backBtn(),
      h('div', { class: 'stack tight' }, h('h1', null, 'Vérifiez vos e-mails'),
        h('p', { class: 'muted', id: 'mail-code-sent' }, (kind === 'recovery' ? 'Si un compte existe pour ' + email + ', un e-mail vient d’être envoyé.' : 'E-mail envoyé à ' + email + '.')
          + ' Ouvrez le lien dans ce même navigateur.')),
      h('details', { id: 'mail-code-box' }, h('summary', null, 'L’e-mail contient un code ?'),
        h('div', { class: 'stack', style: 'margin-top:12px' }, h('div', { class: 'field' }, h('label', { for: 'mail-code' }, 'Code reçu par e-mail'), input), err, btn)),
      h('p', { class: 'small muted' }, 'Pas d’e-mail ? Regardez dans les indésirables.'),
      footer());
  }

  // Rattachement explicite des fiches et de la boutique de ce téléphone au compte connecté.
  function claimCard(me, q) {
    var pc = pendingClaims();
    if (!pc.count || Date.now() < (LS.get('fiila.claim.later', 0) || 0)) return null;
    var parts = [];
    var n = pc.items.length;
    if (n) parts.push(n + (n > 1 ? ' fiches' : ' fiche'));
    if (pc.shop) parts.push('votre boutique');
    var card = h('section', { class: 'card nudge', id: 'claim-card' },
      h('h2', null, 'Rattacher à votre compte ?'),
      h('p', { class: 'small' }, parts.join(' et ') + ' de ce téléphone, au compte ' + (me.email || '') + '.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', id: 'claim-yes', onclick: function (ev) {
          ev.currentTarget.disabled = true;
          claimNow().then(function () { toast('Rattaché à votre compte.'); go(q.retour ? safeRetour(q.retour) : '#/compte'); }, function (e) { toast(errText(e)); });
        } }, 'Rattacher'),
        h('button', { class: 'btn ghost small', type: 'button', id: 'claim-no', onclick: function () {
          LS.set('fiila.claim.later', Date.now() + 30 * 864e5); card.remove(); if (q.retour) go(safeRetour(q.retour));
        } }, 'Pas maintenant')));
    return card;
  }
  // Fii Carrière depuis le compte : l'état de l'ambassadeur en un coup d'œil, ou l'invitation à le devenir.
  function ambEntry() {
    var AMB_STATE = { training: 'formation en cours', review: 'validation en cours', active: 'agent actif', suspended: 'suspendu', excluded: 'programme terminé' };
    var box = h('div', null, iconRow('#/carriere', 'star', 'Fii Carrière', { id: 'amb-entry' }));
    api('fiila_ambassador_me', {}).then(function (r) {
      var a = r && r.ambassador;
      var label = a ? 'Fii Carrière · ' + (AMB_STATE[a.status] || a.status) + (a.status === 'training' && a.quiz_passed ? ' (test réussi)' : '') : 'Fii Carrière · devenir agent';
      setKids(box, iconRow('#/carriere', 'star', label, { id: 'amb-entry' }));
    }, function () {});
    return box;
  }
  // Lien vers le back-office, seulement pour les membres de l'équipe.
  function boEntry() {
    var box = h('div');
    api('fiila_bo_me', {}).then(function (m) {
      if (m.staff) setKids(box, iconRow('#/bo', 'key', 'Back-office · ' + (BO_ROLES[m.role] || m.role), { id: 'bo-entry' }));
    }, function () {});
    return box;
  }

  // Numéro au format international (+221 par défaut pour un numéro à 9 chiffres).
  function toE164(v) {
    var d = String(v || '').replace(/\D/g, '').replace(/^00/, '');
    if (d.length === 9) d = '221' + d;
    return d.length >= 11 && d.length <= 15 ? '+' + d : null;
  }
  function prettyPhone(e) { var m = /^\+221(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e || ''); return m ? '+221 ' + m.slice(1).join(' ') : e; }
  // Vérification d'un numéro par code SMS : numéro → code → confirmé. Une seule action visible à chaque étape.
  function phoneVerifyBox(o) {
    var box = h('div', { class: 'stack', id: o.id || 'phone-verify' });
    var num = o.prefill || '';
    function stepNumber(err0) {
      var err = h('div', { role: 'alert' });
      var btn = iconBtn('button', { class: 'btn', type: 'button', id: 'pv-send', onclick: function () {
        setKids(err);
        var e = toE164(num);
        if (!e) return errBox(err, new ApiError('phone_invalid'));
        btn.disabled = true;
        account.phoneStart(e).then(function () { track('phone_code_sent', 'sms'); stepCode(e); }, function (x) { btn.disabled = false; errBox(err, x); });
      } }, 'chat', 'Recevoir le code par SMS');
      setKids(box,
        textField({ id: 'pv-phone', label: 'Numéro de téléphone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: num, onInput: function (v) { num = v; } }),
        err, btn);
      if (err0) errBox(err, err0);
    }
    function stepCode(e) {
      var err = h('div', { role: 'alert' });
      var code = '';
      var input = h('input', { type: 'text', id: 'pv-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, pattern: '[0-9 ]*',
        class: 'bo-code', placeholder: '123456', 'aria-label': 'Code reçu par SMS', oninput: function (ev) { code = ev.target.value; } });
      var ok = iconBtn('button', { class: 'btn', type: 'button', id: 'pv-ok', onclick: function () {
        setKids(err);
        if (!/^\d{4,8}$/.test(code.replace(/\s/g, ''))) return errBox(err, new ApiError('otp_expired'));
        ok.disabled = true;
        account.phoneVerify(e, code).then(function () {
          track('phone_verified', 'sms');
          setKids(box, h('p', { class: 'saved-ok', id: 'pv-done' }, icon('check', 18), 'Numéro confirmé : ' + prettyPhone(e)));
          if (o.onDone) o.onDone(e);
        }, function (x) { ok.disabled = false; errBox(err, x); });
      } }, 'check', 'Confirmer');
      var again = h('button', { class: 'btn link small', type: 'button', id: 'pv-again', disabled: true, onclick: function () {
        again.disabled = true;
        account.phoneStart(e).then(function () { toast('Nouveau code envoyé.'); setTimeout(function () { again.disabled = false; }, 60000); }, function (x) { again.disabled = false; errBox(err, x); });
      } }, 'Renvoyer le code');
      setTimeout(function () { again.disabled = false; }, 60000);
      setKids(box,
        h('p', { class: 'small', id: 'pv-sent' }, 'Code envoyé par SMS au ', h('strong', null, prettyPhone(e)), '.'),
        h('div', { class: 'field' }, h('label', { for: 'pv-code' }, 'Code reçu par SMS'), input),
        err, ok,
        h('div', { class: 'row', style: 'gap:12px' }, again,
          h('button', { class: 'btn link small', type: 'button', onclick: function () { stepNumber(); } }, 'Changer de numéro')));
      setTimeout(function () { try { input.focus(); } catch (x) { /* rien */ } }, 0);
    }
    stepNumber();
    return box;
  }
  function profileView(me, q) {
    var f = { display_name: me.display_name || '', phone: me.phone || '' };
    var msg = h('div', { role: 'status' });
    var avatarBox = h('div', { class: 'avatar-box' });
    function drawAvatar() {
      var file = h('input', { type: 'file', accept: 'image/*', id: 'avatar-in', hidden: true, onchange: function () {
        var fl = file.files && file.files[0];
        if (!fl) return;
        compressPhoto(fl, 360).then(function (d) { return save({ avatar: d.replace(/^data:[^,]+,/, '') }, 'Photo enregistrée.'); },
          function (e) { setKids(msg, h('p', { class: 'alert' }, e.message || errText(e))); });
      } });
      setKids(avatarBox, avatarEl(me, 72),
        h('div', { class: 'stack tight' },
          h('strong', { class: 'wrapword' }, me.display_name || 'Sans nom'),
          h('span', { class: 'small muted wrapword', id: 'me-email' }, me.email || ''),
          h('div', { class: 'row', style: 'gap:8px' },
            h('label', { class: 'btn ghost small', for: 'avatar-in', id: 'avatar-pick' }, me.avatar ? 'Changer la photo' : 'Ajouter une photo'),
            me.avatar ? h('button', { class: 'btn ghost small', type: 'button', onclick: function () { save({ avatar: '' }, 'Photo retirée.'); } }, 'Retirer') : null)),
        file);
    }
    function save(extra, okText) {
      setKids(msg);
      return api('fiila_profile_save', { p: Object.assign({ display_name: f.display_name.trim() || null, phone: f.phone.trim() || null }, extra || {}) })
        .then(function (m) { ME = me = m; drawAvatar(); toast(okText || 'Profil enregistré.'); },
          function (e) { setKids(msg, h('p', { class: 'alert' }, errText(e))); });
    }
    drawAvatar();

    var pw = '';
    var pwMsg = h('div', { role: 'status' });
    var pwBox = h('details', { id: 'pw-box', open: q.mdp === '1' ? true : null },
      h('summary', null, 'Changer le mot de passe'),
      h('form', { class: 'stack', style: 'margin-top:12px', novalidate: true, onsubmit: function (ev) {
        ev.preventDefault();
        if (pw.length < 8) return errBox(pwMsg, new ApiError('weak_password'));
        var b = ev.currentTarget.querySelector('button[type=submit]'); b.disabled = true;
        account.setPassword(pw).then(function () {
          b.disabled = false; setKids(pwMsg, h('p', { class: 'saved-ok' }, icon('check', 18), 'Mot de passe changé.'));
          if (q.mdp === '1') history.replaceState(null, '', location.pathname + location.search + '#/compte');
        }, function (e) { b.disabled = false; errBox(pwMsg, e); });
      } },
        passwordField('new-pass', 'Nouveau mot de passe', 'new-password', function (v) { pw = v; }),
        pwMsg, h('button', { class: 'btn', type: 'submit', id: 'pw-save' }, 'Enregistrer le mot de passe')));

    var delZone = h('div', { class: 'stack' });
    function askDelete() {
      var pw = '';
      var dErr = h('div', { role: 'alert' });
      setKids(delZone, h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirmer la suppression du compte' },
        h('p', null, h('strong', null, 'Supprimer définitivement votre compte ?')),
        h('p', { class: 'small' }, 'Adresses du compte, boutique, clients, commandes et factures seront effacés.'),
        passwordField('delete-pass', 'Votre mot de passe', 'current-password', function (v) { pw = v; }),
        dErr,
        h('div', { class: 'row' },
          h('button', { class: 'btn danger-fill', type: 'button', id: 'confirm-delete-account', onclick: function (ev) {
            var b = ev.currentTarget; b.disabled = true; setKids(dErr);
            // connexion récente exigée par le serveur : on revérifie le mot de passe
            account.signIn(me.email, pw).then(function () {
              return api('fiila_delete_account', {});
            }).then(function () {
              return account.signOut();
            }).then(function () { toast('Compte supprimé.'); go('#/'); }, function (e) { b.disabled = false; errBox(dErr, e); });
          } }, 'Supprimer mon compte'),
          h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(delZone); } }, 'Annuler'))));
    }

    return page(backBtn(),
      q.bienvenue === '1' ? h('p', { class: 'saved-ok', role: 'status' }, icon('check', 18), 'Compte activé.') : null,
      claimCard(me, q),
      q.mdp === '1' ? h('div', { class: 'notice' }, 'Choisissez maintenant votre nouveau mot de passe.') : null,
      h('section', { class: 'card' }, avatarBox, msg),
      boEntry(),
      ambEntry(),
      h('section', { class: 'card' },
        h('h2', null, 'Profil'),
        textField({ id: 'me-name', label: 'Nom affiché', max: 60, value: f.display_name, autocomplete: 'name', onInput: function (v) { f.display_name = v; } }),
        textField({ id: 'me-phone', label: 'Téléphone', optional: true, type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
        iconBtn('button', { class: 'btn', type: 'button', id: 'me-save', onclick: function () { save(null); } }, 'check', 'Enregistrer')),
      h('nav', { class: 'list', 'aria-label': 'Raccourcis' },
        h('a', { class: 'item', href: '#/' }, h('div', null, h('div', { class: 't' }, 'Mes adresses'), h('div', { class: 'small muted' }, 'Maison, bureau, boutique…')), h('span', { class: 'chev' }, icon('chev', 18))),
        h('a', { class: 'item', href: '#/boutique', id: 'go-shop' }, h('div', null, h('div', { class: 't' }, me.shop ? me.shop.name : 'Ma boutique'),
          h('div', { class: 'small muted' }, me.shop ? 'Commandes, clients, factures' : 'Vendre et livrer avec Fii')), h('span', { class: 'chev' }, icon('chev', 18)))),
      h('details', { id: 'phone-box', open: q.numero === '1' ? true : null },
        h('summary', null, me.phone_verified ? 'Numéro confirmé : ' + prettyPhone(me.phone_verified) : 'Confirmer mon numéro par SMS'),
        h('div', { style: 'margin-top:12px' }, phoneVerifyBox({ id: 'me-phone-verify', prefill: me.phone_verified || me.phone || '' }))),
      pwBox,
      h('button', { class: 'btn ghost', type: 'button', id: 'logout', onclick: function () { account.signOut().then(function () { toast('Déconnecté.'); go('#/'); }); } }, 'Se déconnecter'),
      h('details', null, h('summary', null, 'Supprimer mon compte'),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          h('p', { class: 'small' }, 'Les fiches restées seulement sur un téléphone, sans compte, ne sont pas concernées.'),
          h('button', { class: 'btn danger', type: 'button', id: 'delete-account', onclick: askDelete }, 'Supprimer mon compte'), delZone)),
      footer());
  }

  /* ----- boutique */
  // Rôle dans la boutique ('owner', 'admin', 'editor') : l'interface masque ce que le serveur refuserait.
  var SHOP_ROLE = null;
  function viewShop(q) {
    return sapi('fiila_shop_get', {}).then(function (r) {
      SHOP_ROLE = r.shop ? r.shop.role || 'owner' : null;
      return r.shop ? shopDashboard(r, q || {}) : onboardingOn() ? setupStepName() : shopForm(null);
    }, failPage('Impossible de charger la boutique', 'boutique'));
  }
  // Types de commerce (19/10) : choisis à la création, ils serviront aux outils propres à chaque métier.
  var BUSINESS_TYPES = [['mode', 'Vêtements, mode'], ['chaussures', 'Chaussures'], ['beaute', 'Beauté, cosmétiques'], ['coiffure', 'Salon de coiffure, barbier'],
    ['esthetique', 'Institut, onglerie'], ['restauration', 'Restaurant, traiteur'], ['patisserie', 'Pâtisserie, boulangerie'], ['epicerie', 'Épicerie, alimentation'],
    ['electronique', 'Téléphones, électronique'], ['maison', 'Maison, déco'], ['bijoux', 'Bijoux, accessoires'], ['enfants', 'Enfants, bébé'],
    ['fleurs', 'Fleurs, événements'], ['couture', 'Couture, retouches'], ['services', 'Services, réparations'], ['autre', 'Autre commerce']];
  function typeLabel(k) { var t = BUSINESS_TYPES.filter(function (x) { return x[0] === k; })[0]; return t ? t[1] : ''; }
  function viewShopSettings() {
    return sapi('fiila_shop_get', {}).then(function (r) {
      SHOP_ROLE = r.shop ? r.shop.role || 'owner' : null;
      return r.shop && SHOP_ROLE === 'editor' ? memberSettings(r.shop) : shopForm(r.shop);
    }, failPage('Impossible de charger la boutique', 'boutique'));
  }
  function shopForm(shop) {
    var f = { name: shop ? shop.name : '', phone: shop ? shop.phone || '' : '', type: shop ? shop.business_type || '' : '' };
    var err = h('div', { role: 'alert' });
    var ask = shop ? null : referralAsk('shop-ref');
    var ambCode = '';
    var btn = h('button', { class: 'btn', type: 'button', id: 'shop-save', onclick: function () {
      setKids(err);
      if (!f.type) return errBox(err, new ApiError('business_type_required'));
      btn.disabled = true;
      sapi('fiila_shop_save', { p: { name: f.name.trim(), phone: f.phone.trim() || null, ninea: null, business_type: f.type } }).then(function (r) {
        if (r && r.key) LS.set(SHOP_LS, { id: r.shop.id, key: r.key, linked: authed() || undefined });
        if (!shop) { track('shop_created', authed() ? 'account' : 'no_account'); bumpTx(); attribute('shop', null, r.key || shopKey(), ask.value()); }
        if (!shop && ambCode.trim()) api('fiila_ambassador_link', { p_key: r.key || shopKey(), p_code: ambCode.trim() }).then(function (x) { toast('Boutique créée, accompagnée par ' + x.ambassador + '.'); }, function (e) { toast('Boutique créée. Code agent : ' + errText(e)); });
        ME = null; toast(shop ? 'Boutique mise à jour.' : 'Boutique créée.'); go('#/boutique');
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, shop ? 'Enregistrer' : 'Créer ma boutique');
    var pg = page(backBtn(shop ? 'Ma boutique' : 'Accueil', shop ? '#/boutique' : '#/'),
      h('div', { class: 'stack tight' },
        h('h1', null, shop ? 'Réglages de la boutique' : 'Créer ma boutique'),
        shop ? null : h('p', { class: 'muted' }, 'Ces informations apparaissent sur vos factures.')),
      textField({ id: 'shop-name', label: 'Nom de la boutique', max: 60, value: f.name, placeholder: 'Ex. : Boutique Ndèye', onInput: function (v) { f.name = v; } }),
      textField({ id: 'shop-phone', label: 'Téléphone', optional: true, type: 'tel', inputmode: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
      h('div', { class: 'field' }, h('label', { for: 'shop-type' }, 'Type de commerce'),
        h('select', { id: 'shop-type', onchange: function (e) { f.type = e.target.value; } },
          h('option', { value: '' }, 'Choisir…'), BUSINESS_TYPES.map(function (t) { return h('option', { value: t[0], selected: f.type === t[0] || null }, t[1]); })),
        h('p', { class: 'hint' }, 'Il nous permet de vous proposer les outils adaptés à votre métier.')),
      shop ? null : textField({ id: 'shop-amb', label: 'Code agent', optional: true, max: 10, placeholder: 'Si un agent Fii vous aide', onInput: function (v) { ambCode = v; } }),
      ask ? ask.el : null,
      err, btn,
      shop ? ambassadorShopBox() : null,
      shop ? vitrineSection(shop) : null,
      shop ? teamSection(shop) : null,
      shop ? courierSection(shop) : null,
      shop ? h('a', { class: 'invite-row', id: 'shop-referral', href: '#/parrainer?pour=boutique' }, icon('gift', 24), h('span', null, 'Parrainer une boutique'),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))) : null,
      shop ? (SHOP_ROLE === 'admin' ? leaveShopBox() : shopDeleteBox()) : null,
      footer());
    return shop ? shopTabs(pg, 'settings') : pg;
  }

  /* ----- Démarrage guidé de la boutique (accueil v2, lot 2 ; proposition validée le 20/10 23:36).
     1. Nom et type → 2. Premier article (nom, prix, photo facultative ; « Plus tard » possible) → 3. Aperçu, ouverture
     explicite de la vitrine, puis partage. Une boutique sans article n'est pas proposée au partage. Chaque étape est
     enregistrée sur le serveur ; l'étape suivante se déduit de l'état réel (reprise après interruption). */
  var SETUP_LS = 'fiila.shop.setup';
  ['name:done', 'product:done', 'product:skip', 'vitrine:open', 'share:click', 'resume:open'].forEach(function (v) { (TRACKABLE.shop_setup = TRACKABLE.shop_setup || []).push(v); });
  function setupState() { return LS.get(SETUP_LS, null) || {}; }
  function setupPending() { var st = setupState(); return !!(st.started && !st.done && (shopKey() || (ME && ME.shop))); }
  // Trois badges qui se débloquent (fondateur, 21/10 00:47 : « des cartes dynamiques gratifiantes… rendre ça amusant »).
  var SETUP_BADGES = [['shop', 'Boutique'], ['cam', 'Article'], ['eye', 'Vitrine']];
  function setupBadges(n) {
    return h('ol', { class: 'setup-badges', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': '3', 'aria-valuenow': String(n), 'aria-label': 'Étape ' + n + ' sur 3' },
      SETUP_BADGES.map(function (b, i) {
        var st = i + 1 < n ? 'done' : i + 1 === n ? 'now' : 'next';
        return h('li', { class: 'sb sb-' + st }, h('span', { class: 'sb-ic', 'aria-hidden': 'true' }, icon(st === 'done' ? 'check' : b[0], 20)), h('span', { class: 'sb-l' }, b[1]));
      }));
  }
  // Carte de félicitations de l'étape qui vient d'être franchie (une seule fois).
  function setupWin(n) {
    var st = setupState();
    if (!st.just || st.just.step !== n - 1) return null;
    var j = st.just; delete st.just; LS.set(SETUP_LS, st);
    var t = n === 2 ? ['Étape 1 réussie', '« ' + j.name + ' » est créée', 'Prochaine étape : votre premier article. Une photo et un prix suffisent.']
      : ['Étape 2 réussie', 'Votre premier article est prêt', 'Dernière étape : ouvrir votre vitrine. Vos clientes pourront commander.'];
    return h('section', { class: 'setup-win', id: 'setup-win', role: 'status' },
      h('span', { class: 'setup-win-ic', 'aria-hidden': 'true' }, icon('check', 24),
        h('span', { class: 'setup-win-spark' }, h('i'), h('i'), h('i'), h('i'), h('i'))),
      h('div', null, h('p', { class: 'setup-win-k' }, t[0]), h('b', { class: 'wrapword' }, t[1]), h('span', null, t[2])));
  }
  function setupFrame(n, title, text, body) {
    return page(backBtn(n === 1 ? 'Accueil' : 'Ma boutique', n === 1 ? '#/' : '#/boutique'),
      h('section', { class: 'setup', id: 'shop-setup', 'data-step': String(n) },
        setupBadges(n),
        setupWin(n),
        h('p', { class: 'setup-step' }, 'Étape ' + n + ' sur 3'),
        h('h1', null, title), text ? h('p', { class: 'muted' }, text) : null,
        body),
      footer(true));
  }
  function setupStepName() {
    var f = { name: '', phone: '', type: '' }, ambCode = '';
    var ask = referralAsk('shop-ref');
    var err = h('div', { role: 'alert' });
    var btn = h('button', { class: 'btn big', type: 'button', id: 'shop-save', onclick: function () {
      setKids(err);
      if (!f.name.trim()) return errBox(err, new ApiError('shop_name_required'));
      if (!f.type) return errBox(err, new ApiError('business_type_required'));
      btn.disabled = true;
      sapi('fiila_shop_save', { p: { name: f.name.trim(), phone: f.phone.trim() || null, ninea: null, business_type: f.type } }).then(function (r) {
        if (r && r.key) LS.set(SHOP_LS, { id: r.shop.id, key: r.key, linked: authed() || undefined });
        track('shop_created', authed() ? 'account' : 'no_account'); bumpTx(); attribute('shop', null, r.key || shopKey(), ask.value());
        track('shop_setup', 'name:done'); LS.set(SETUP_LS, { started: Date.now(), just: { step: 1, name: f.name.trim() } });
        var inv = LS.get(PARTNER_LS, null);
        if (inv && inv.token) api('fiila_partner_accept', { p_token: inv.token, p_key: r.key || shopKey() }).then(function () { LS.del(PARTNER_LS); toast('Invitation acceptée : votre essai vous attend dans votre boutique.'); }, function (e) { LS.del(PARTNER_LS); toast(errText(e)); });
        if (ambCode.trim()) api('fiila_ambassador_link', { p_key: r.key || shopKey(), p_code: ambCode.trim() }).then(function (x) { toast('Boutique créée, accompagnée par ' + x.ambassador + '.'); }, function (e) { toast('Boutique créée. Code agent : ' + errText(e)); });
        ME = null; go('#/boutique/demarrer');
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, 'Continuer');
    return setupFrame(1, 'Votre boutique', 'Son nom apparaît sur votre vitrine et vos factures.', h('div', { class: 'stack' },
      textField({ id: 'shop-name', label: 'Nom de la boutique', max: 60, placeholder: 'Ex. : Boutique Ndèye', onInput: function (v) { f.name = v; } }),
      h('div', { class: 'field' }, h('label', { for: 'shop-type' }, 'Type de commerce'),
        h('select', { id: 'shop-type', onchange: function (e) { f.type = e.target.value; } },
          h('option', { value: '' }, 'Choisir…'), BUSINESS_TYPES.map(function (t) { return h('option', { value: t[0] }, t[1]); }))),
      h('details', { class: 'more-details', id: 'shop-more' }, h('summary', null, 'Téléphone, code agent (facultatif)'),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          textField({ id: 'shop-phone', label: 'Téléphone', optional: true, type: 'tel', inputmode: 'tel', onInput: function (v) { f.phone = v; } }),
          textField({ id: 'shop-amb', label: 'Code agent', optional: true, max: 10, placeholder: 'Si un agent Fii vous aide', onInput: function (v) { ambCode = v; } }),
          ask ? ask.el : null)),
      err, btn));
  }
  function viewShopSetup() {
    return Promise.all([sapi('fiila_shop_get', {}), sapi('fiila_products', { p_all: true })]).then(function (rr) {
      var shop = rr[0].shop, prods = rr[1] || [];
      if (!shop) return onboardingOn() ? setupStepName() : shopForm(null);
      SHOP_ROLE = shop.role || 'owner';
      if (SHOP_ROLE === 'editor') { redirect('#/boutique'); return page(); }
      if (!prods.length) return setupStepProduct(shop);
      return setupStepVitrine(shop, prods);
    }, failPage('Impossible de charger la boutique', 'boutique'));
  }
  function setupStepProduct(shop) {
    var f = { name: '', price: '' };
    var photos = productPhotos(null);
    var err = h('div', { role: 'alert' });
    var btn = h('button', { class: 'btn big', type: 'button', id: 'setup-product-save', onclick: function () {
      setKids(err);
      var price = parseInt(String(f.price).replace(/\D/g, ''), 10);
      if (!f.name.trim()) return errBox(err, new ApiError('item_label_required'));
      if (!(price >= 0)) return errBox(err, new ApiError('invalid_price'));
      var p = { name: f.name.trim(), price: price, active: true };
      btn.disabled = true;
      photos.payload().then(function (pp) {
        if (pp) { p.photo = pp.photo; p.photos = pp.photos; }
        return sapi('fiila_product_save', { p: p });
      }).then(function () {
        track('product_created', photos.count() ? 'photo' : 'no_photo'); track('shop_setup', 'product:done');
        var st = setupState(); st.just = { step: 2 }; LS.set(SETUP_LS, st);
        render();
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, 'Continuer');
    return setupFrame(2, 'Votre premier article', 'Une photo, un nom, un prix. Vous en ajouterez d’autres ensuite.', h('div', { class: 'stack' },
      photos.el,
      textField({ id: 'product-name', label: 'Nom de l’article', max: 80, placeholder: 'Ex. : Robe wax taille M', onInput: function (v) { f.name = v; } }),
      textField({ id: 'product-price', label: 'Prix (FCFA)', inputmode: 'numeric', placeholder: 'Ex. : 12500', onInput: function (v) { f.price = v; } }),
      err, btn,
      h('a', { class: 'setup-later', id: 'setup-later', href: '#/boutique', onclick: function () { track('shop_setup', 'product:skip'); } }, 'Plus tard')));
  }
  function setupStepVitrine(shop, prods) {
    var err = h('div', { role: 'alert' });
    if (shop.public && shop.slug) return setupDone(shop);
    var first = prods[0];
    var btn = h('button', { class: 'btn big', type: 'button', id: 'setup-open', onclick: function () {
      setKids(err); btn.disabled = true;
      sapi('fiila_shop_vitrine', { p: { public: true } }).then(function (r) {
        FEED_CACHE = null; track('shop_setup', 'vitrine:open');
        shop.public = true; shop.slug = r.slug;
        // Grande carte de félicitations, avec la place gratuite du fil si la boutique en obtient une.
        sapi('fiila_shop_feed', { p_on: null }).then(null, function () { return null; }).then(function (fd) {
          celebrate({ icon: 'star', kicker: 'Boutique ouverte', title: 'Bravo, ' + shop.name + ' est en ligne !',
            gain: fd && fd.rank ? 'Place n° ' + fd.rank + ' / 25' : null,
            sub: (fd && fd.rank ? 'Votre place offerte dans le fil Fii. ' : '') + 'Vos clientes peuvent commander dès maintenant, sans compte, et vous donner leur adresse exacte.',
            cta: 'Partager ma vitrine', onClose: function () { render(); } });
        });
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, 'Ouvrir ma vitrine');
    return setupFrame(3, 'Votre vitrine', 'Voici ce que verront vos clientes. Elles commandent sans compte et donnent leur adresse à la fin.', h('div', { class: 'stack' },
      h('div', { class: 'setup-preview', id: 'setup-preview' },
        h('div', { class: 'setup-pv-head' }, h('span', { class: 'vavatar', 'aria-hidden': 'true' }, (shop.name || '?').trim().charAt(0).toUpperCase()), h('b', { class: 'wrapword' }, shop.name)),
        h('div', { class: 'setup-pv-grid' }, prods.slice(0, 2).map(function (x) {
          return h('div', { class: 'setup-pv-card' },
            x.photo ? h('img', { src: x.photo, alt: '' }) : h('span', { class: 'setup-pv-ph', 'aria-hidden': 'true' }, icon('cam', 26)),
            h('span', { class: 'wrapword' }, x.name), h('b', null, fcfa(x.price)));
        }))),
      first && !first.photo ? h('p', { class: 'small muted' }, 'Astuce : un article avec photo se vend mieux. Vous pourrez en ajouter une dans « Mes articles ».') : null,
      err, btn,
      h('a', { class: 'setup-later', id: 'setup-later', href: '#/boutique' }, 'Plus tard')));
  }
  function setupDone(shop) {
    var url = vitrineUrl(shop.slug);
    function finish() { var st = setupState(); st.done = Date.now(); LS.set(SETUP_LS, st); }
    finish();
    return page(
      h('section', { class: 'setup setup-ok', id: 'setup-done' },
        h('span', { class: 'setup-ok-ic', 'aria-hidden': 'true' }, icon('check', 34)),
        h('h1', null, 'Votre boutique est prête'),
        h('p', { class: 'muted' }, 'Envoyez le lien de votre vitrine à vos clientes, ou mettez-le dans votre statut WhatsApp.'),
        h('p', { class: 'sharelink', id: 'setup-url' }, url),
        iconBtn('a', { class: 'btn big', id: 'setup-share', href: waLink('Ma boutique en ligne : choisissez vos articles et commandez ici, sans compte : ' + url), target: '_blank', rel: 'noopener noreferrer',
          onclick: function () { track('shop_setup', 'share:click'); } }, 'chat', 'Partager sur WhatsApp'),
        h('a', { class: 'setup-later', id: 'setup-to-shop', href: '#/boutique' }, 'Aller à ma boutique')),
      footer(true));
  }
  /* ----- Programme Ambassadeurs (marques invitées par le fondateur ; mandat AGENTS-AMBASSADEURS-001, lot 3).
     Lien privé #/invitation/<jeton> → acceptation avec la boutique de ce téléphone (ou création guidée) → essai « prêt » →
     « Activer mon essai » dans le tableau de bord. Le partenariat vit dans le tableau de bord normal de la boutique. */
  var PARTNER_LS = 'fiila.partner.invite';
  function packDetails(pk, months) {
    return h('div', { class: 'stack tight pk' },
      h('p', { class: 'pk-name' }, pk.name + (months ? ' · ' + months + ' mois' : '')),
      h('ul', { class: 'pk-list' }, (pk.benefits || []).map(function (b) { return h('li', null, icon('check', 16), h('span', null, b)); })),
      pk.limits && pk.limits.studio_credits != null ? h('p', { class: 'small' }, 'Retouches Studio incluses : ' + pk.limits.studio_credits) : null,
      (pk.exclusions || []).length ? h('p', { class: 'small muted' }, 'Non inclus : ' + pk.exclusions.join(' · ')) : null);
  }
  function viewPartnerInvite(token) {
    return api('fiila_partner_invite', { p_token: token }).then(function (r) {
      if (r.state === 'not_found') return page(brandBar('Invitation'), stateCard('?', 'Invitation introuvable', 'Vérifiez que le lien a été copié en entier.'), footer(true));
      if (r.state === 'revoked') return page(brandBar('Invitation'), stateCard('⦸', 'Invitation retirée', 'Cette invitation n’est plus valable.'), footer(true));
      if (r.state === 'expired') return page(brandBar('Invitation'), stateCard('⌛', 'Invitation expirée', 'Demandez un nouveau lien à Fii.'), footer(true));
      var err = h('div', { role: 'alert' });
      var hasShop = !!(shopKey() || (ME && ME.shop));
      var btn = h('button', { class: 'btn big', type: 'button', id: 'invite-accept', onclick: function () {
        setKids(err);
        if (!hasShop && !r.existing_shop) { LS.set(PARTNER_LS, { token: token, at: Date.now() }); go('#/boutique'); return; }
        btn.disabled = true;
        api('fiila_partner_accept', { p_token: token, p_key: shopKey() }).then(function () { LS.del(PARTNER_LS); toast('Invitation acceptée.'); go('#/boutique'); },
          function (e) { btn.disabled = false; errBox(err, e); });
      } }, r.state === 'accepted' ? 'Ouvrir ma boutique' : hasShop || r.existing_shop ? 'Accepter avec ma boutique' : 'Accepter et créer ma boutique');
      if (r.state === 'accepted') btn.onclick = function () { go('#/boutique'); };
      return page(brandBar('Invitation'),
        h('section', { class: 'ivc pinv', id: 'partner-invite' },
          h('div', { class: 'ivc-glow', 'aria-hidden': 'true' }),
          h('div', { class: 'ivc-top' }, h('span', { class: 'logo ivc-brand', 'aria-hidden': 'true' }), h('span', { class: 'ivc-kind' }, 'Ambassadeur Fii')),
          h('h1', { class: 'ivc-title wrapword' }, r.brand),
          h('p', { class: 'ivc-sub' }, 'Fii vous invite à essayer gratuitement le pack complet pendant ' + r.months + ' mois. Sans engagement, sans paiement à la fin.')),
        r.pack ? h('section', { class: 'card stack tight' }, h('h2', null, 'Ce que comprend votre essai'), packDetails(r.pack, r.months),
          h('p', { class: 'small muted' }, 'L’essai commence seulement quand vous touchez « Activer mon essai » dans votre boutique.')) : null,
        r.existing_shop && !hasShop ? h('p', { class: 'notice' }, 'Invitation pour la boutique « ' + r.existing_shop + ' ». Ouvrez ce lien sur le téléphone qui la gère, ou restaurez sa clé de gestion.') : null,
        err, r.existing_shop && !hasShop ? h('a', { class: 'btn ghost', href: '#/cle' }, 'Restaurer ma clé de gestion') : btn,
        footer(true));
    }, function (e) { return page(brandBar('Invitation'), stateCard('!', 'Impossible d’ouvrir l’invitation', errText(e), retryBtn()), footer(true)); });
  }
  // Conversation de la boutique partenaire avec le Manager (et l'équipe). Réponses sans IA ; escalade visible.
  function partnerChatSheet() {
    var list = h('div', { class: 'pmsg-list', id: 'pmsg-list', 'aria-live': 'polite' }, loading());
    var body = '', err = h('div', { role: 'alert' });
    function draw(msgs) {
      setKids(list, msgs.length ? msgs.map(function (m) {
        return h('div', { class: 'pmsg pmsg-' + m.author },
          h('span', { class: 'pmsg-who' }, m.author === 'brand' ? 'Vous' : m.author === 'staff' ? 'Équipe Fii' : 'Manager'),
          h('p', { class: 'wrapword' }, m.body),
          m.escalate ? h('span', { class: 'small muted' }, 'Transmis à l’équipe') : null);
      }) : h('p', { class: 'small muted' }, 'Posez votre question : configuration, articles, vitrine, commandes ou suite de l’essai.'));
      list.scrollTop = list.scrollHeight;
    }
    sapi('fiila_partner_messages', {}).then(function (r) { draw(r.messages); }, function (e) { errBox(err, e); });
    var input = h('textarea', { id: 'pmsg-input', rows: 2, maxlength: 1000, placeholder: 'Votre message', oninput: function (e) { body = e.target.value; } });
    var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pmsg-h', id: 'pmsg-sheet' });
    var close;
    back.append(h('form', { class: 'sheet stack pmsg-sheet', onsubmit: function (e) {
      e.preventDefault(); setKids(err);
      if (!body.trim()) return;
      var b = e.submitter; if (b) b.disabled = true;
      sapi('fiila_partner_message_send', { p_body: body.trim() }).then(function (r) { body = ''; input.value = ''; draw(r.messages); if (b) b.disabled = false; },
        function (x) { if (b) b.disabled = false; errBox(err, x); });
    } },
      h('div', { class: 'svc-head' }, h('h2', { id: 'pmsg-h' }, 'Le Manager Fii'),
        h('button', { class: 'svc-x', type: 'button', 'aria-label': 'Fermer', onclick: function () { close(); } }, icon('close', 18))),
      list, err, input, h('button', { class: 'btn', type: 'submit', id: 'pmsg-send' }, 'Envoyer')));
    close = openSheet(back);
  }
  // Carte de l'essai dans le tableau de bord de la boutique (rien si la boutique n'est pas partenaire).
  function partnerSlot() {
    var box = h('div', { id: 'partner-slot' });
    sapi('fiila_partner_mine', {}).then(function (r) {
      var t = r && r.trial;
      if (!t) return;
      var err = h('div', { role: 'alert' });
      function dateFr(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; } }
      var head = h('div', { class: 'ptn-head' }, h('span', { class: 'ptn-ic', 'aria-hidden': 'true' }, icon('star', 20)),
        h('div', null, h('p', { class: 'eyebrow' }, 'Ambassadeur Fii'),
          h('b', null, t.status === 'active' ? 'Essai en cours jusqu’au ' + dateFr(t.ends_on) : t.status === 'ready' ? 'Votre essai de ' + t.months + ' mois vous attend'
            : t.status === 'ended' ? 'Votre essai est terminé' : t.status === 'suspended' ? 'Essai suspendu' : 'Essai arrêté')));
      var body = [];
      if (t.status === 'ready') {
        if (t.pack && t.pack.ready) {
          var act = h('button', { class: 'btn', type: 'button', id: 'trial-activate', onclick: function () {
            act.disabled = true; setKids(err);
            sapi('fiila_partner_activate', {}).then(function () {
              celebrate({ icon: 'star', kicker: 'Ambassadeur Fii', title: 'Votre essai commence', sub: 'Pendant ' + t.months + ' mois, profitez du pack complet. Fii vous accompagne.', cta: 'Continuer', onClose: function () { render(); } });
            }, function (e) { act.disabled = false; errBox(err, e); });
          } }, 'Activer mon essai');
          body.push(packDetails(t.pack, t.months), h('p', { class: 'small muted' }, 'L’essai dure ' + t.months + ' mois à partir de l’activation. Rien à payer à la fin.'), act);
        } else body.push(h('p', { class: 'small muted', id: 'trial-blocked' }, 'Votre pack se prépare. Vous pourrez activer l’essai dès qu’il est disponible : rien ne démarre avant.'));
      } else if (t.status === 'active') {
        body.push(h('details', { class: 'more-details' }, h('summary', null, 'Mes avantages'), packDetails(t.pack)),
          t.studio_left != null ? h('p', { class: 'small' }, 'Retouches Studio restantes : ' + t.studio_left) : null);
      } else if (t.status === 'ended') {
        body.push(h('p', { class: 'small muted' }, 'Votre boutique, vos articles, vos commandes et vos photos restent. Les avantages de l’essai sont arrêtés.'),
          r.manager ? iconBtn('a', { class: 'btn ghost', id: 'trial-next', href: 'https://wa.me/' + r.manager + '?text=' + encodeURIComponent('Bonjour, mon essai Ambassadeur Fii est terminé. J’aimerais connaître la suite.'), target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'Demander la suite au Manager')
            : h('p', { class: 'small' }, 'Pour la suite, écrivez à l’équipe Fii.'));
      }
      if (t.status !== 'revoked') body.push(h('button', { class: 'ptn-chat', type: 'button', id: 'partner-chat', onclick: partnerChatSheet }, icon('chat', 16), 'Écrire au Manager'));
      setKids(box, h('section', { class: 'card stack tight ptn ptn-' + t.status, id: 'partner-card' }, head, body, err));
    }, function () {});
    return box;
  }
  // Livreur attitré : invitation par WhatsApp, acceptation par le livreur, envoi automatique des courses.
  var VEHICLES = { moto: 'Moto', voiture: 'Voiture', velo: 'Vélo', pied: 'À pied' };
  function courierSection(shop) {
    var box = h('section', { class: 'card', id: 'courier-section' }, h('h2', null, 'Livreur attitré'));
    var err = h('div', { role: 'alert' });
    function act(action, okText) {
      sapi('fiila_shop_courier', { p_action: action }).then(function () { toast(okText); render(); }, function (e) { errBox(err, e); });
    }
    var c = shop.courier, inv = shop.courier_invite;
    if (c && !shop.courier_confirmed) {
      // Audit S4 : le livreur qui a ouvert l'invitation n'est actif qu'après confirmation par la boutique.
      add(box, [
        h('p', { id: 'courier-to-confirm' }, h('strong', null, c.name), ' a accepté votre invitation.'),
        h('p', { class: 'small muted' }, [c.phone, VEHICLES[c.vehicle]].filter(Boolean).join(' · ')),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', id: 'courier-confirm', onclick: function () { act('confirm', c.name + ' est votre livreur.'); } }, 'C’est bien lui'),
          h('button', { class: 'btn ghost', type: 'button', id: 'courier-refuse', onclick: function () { act('remove', 'Refusé.'); } }, 'Ce n’est pas lui')),
        err]);
      return box;
    }
    if (c) {
      add(box, [
        h('p', null, h('strong', null, c.name), ' · ', VEHICLES[c.vehicle] || '', c.reviews ? [' · ', ratingEl(c.rating, c.reviews)] : null),
        c.active === false ? h('p', { class: 'notice' }, 'Indisponible : les courses ne lui sont pas envoyées.') : null,
        segField({ legend: 'Envoi des courses', name: 'courier-auto', id: 'courier-auto', value: shop.courier_auto ? 'on' : 'off',
          options: [['on', 'Automatique'], ['off', 'Manuel']],
          onChange: function (v) { act(v === 'on' ? 'auto_on' : 'auto_off', v === 'on' ? 'Envoi automatique.' : 'Envoi manuel.'); } }),
        h('button', { class: 'btn ghost small', type: 'button', id: 'courier-remove', style: 'align-self:flex-start', onclick: function () { if (window.confirm && !window.confirm('Retirer ' + c.name + ' ? Les courses ne lui seront plus envoyées.')) return; act('remove', 'Livreur retiré.'); } }, 'Retirer ce livreur'),
        err]);
      return box;
    }
    var f = { name: inv ? inv.name || '' : '', phone: inv ? inv.phone || '' : '' };
    var sendBox = h('div', { class: 'stack' });
    // Pas encore de livreur : section repliée (règle « simple et intuitif »), ouverte si une invitation attend.
    var form = h('div', { class: 'stack', style: 'margin-top:12px' });
    box = h('details', { class: 'card more-sec', id: 'courier-section', open: inv ? true : null }, h('summary', null, 'Livreur attitré'), form);
    add(form, [
      inv ? h('p', { class: 'small muted', id: 'courier-pending' }, 'Invitation envoyée' + (inv.name ? ' à ' + inv.name : '') + '.') : null,
      textField({ id: 'courier-name', label: 'Nom', max: 60, value: f.name, onInput: function (v) { f.name = v; } }),
      textField({ id: 'courier-phone', label: 'WhatsApp', type: 'tel', inputmode: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
      err,
      h('button', { class: 'btn', type: 'button', id: 'courier-invite', onclick: function (ev) {
        setKids(err);
        if (!f.phone.trim()) return errBox(err, new ApiError('phone_invalid'));
        var b = ev.currentTarget; b.disabled = true;
        sapi('fiila_courier_invite', { p_name: f.name.trim() || null, p_phone: f.phone.trim() }).then(function (r) {
          b.disabled = false;
          var link = baseUrl() + '#/livreur/invitation/' + r.token;
          var wa = waTo(f.phone, shop.name + ' vous invite à livrer ses commandes avec Fii. Acceptez ici : ' + link);
          track('courier_invited', 'whatsapp');
          // un seul bouton à la fois : l'invitation prête remplace « Inviter »
          b.hidden = true;
          setKids(sendBox, iconBtn('a', { class: 'btn', id: 'courier-invite-send', href: wa, target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'Envoyer sur WhatsApp'),
            iconBtn('button', { class: 'btn ghost small', type: 'button', style: 'align-self:flex-start', onclick: function () { copy(link, 'Lien'); } }, 'link', 'Copier le lien'));
        }, function (e) { b.disabled = false; errBox(err, e); });
      } }, 'Inviter sur WhatsApp'),
      sendBox,
      inv ? h('button', { class: 'btn link', type: 'button', style: 'align-self:flex-start', onclick: function () { act('cancel_invite', 'Invitation annulée.'); } }, 'Annuler l’invitation') : null]);
    return box;
  }


  /* ----- carte d'invitation (équipe de boutique, livreur attitré, équipe Fii, parrainage) : une seule carte premium.
     o : { id, kind (petit titre), from (qui invite), title, sub, points: [[icône, texte]], cta (élément), more (élément), compact } */
  function inviteCard(o) {
    var initial = String(o.from || 'F').trim().charAt(0).toUpperCase() || 'F';
    return h('section', { class: 'ivc' + (o.compact ? ' compact' : ''), id: o.id || null },
      h('div', { class: 'ivc-glow', 'aria-hidden': 'true' }),
      h('div', { class: 'ivc-top' },
        h('span', { class: 'logo ivc-brand', 'aria-hidden': 'true' }),
        h('span', { class: 'ivc-kind' }, o.kind || 'Invitation')),
      o.from ? h('div', { class: 'ivc-from' },
        h('span', { class: 'ivc-mono', 'aria-hidden': 'true' }, h('span', null, initial)),
        h('span', { class: 'ivc-who' }, h('span', { class: 'ivc-who-l' }, 'De la part de'), h('strong', { class: 'wrapword' }, o.from))) : null,
      h(o.compact ? 'p' : 'h1', { class: 'ivc-title wrapword' }, o.title),
      o.sub ? h('p', { class: 'ivc-sub', id: o.subId || null }, o.sub) : null,
      o.points && o.points.length ? h('ul', { class: 'ivc-points' }, o.points.map(function (pt) {
        return h('li', null, h('span', { class: 'ivc-ico', 'aria-hidden': 'true' }, icon(pt[0], 18)), h('span', null, pt[1]));
      })) : null,
      o.cta ? h('div', { class: 'ivc-cta' }, o.cta) : null,
      o.more || null);
  }
  // Bouton d'action de la carte : clair sur fond sombre, flèche qui avance.
  function ivcBtn(tag, attrs, label) {
    attrs = Object.assign({}, attrs); attrs['class'] = 'ivc-btn' + (attrs['class'] ? ' ' + attrs['class'] : '');
    if (tag === 'button' && !attrs.type) attrs.type = 'button';
    return h(tag, attrs, h('span', null, label), h('span', { class: 'ivc-arrow', 'aria-hidden': 'true' }, icon('chev', 20)));
  }
  /* ----- équipe de la boutique : invitation par WhatsApp (nom, numéro, rôle), rôles, retrait, départ */
  var ROLE_LABEL = { owner: 'Propriétaire', admin: 'Administrateur', editor: 'Éditeur' };
  function fill(el, kids) { add(el, kids); return el; }
  var ROLE_HINT = { admin: 'Tout gérer, sauf supprimer la boutique.', editor: 'Commandes, articles et clients. Pas les réglages.' };
  function teamSection(shop) {
    var body = h('div', { class: 'stack', style: 'margin-top:12px' });
    var box = h('details', { class: 'card more-sec', id: 'team-section' }, h('summary', null, 'Équipe'), body);
    var loaded = false;
    box.addEventListener('toggle', function () { if (box.open && !loaded) { loaded = true; load(); } });
    function load() {
      setKids(body, h('p', { class: 'small muted' }, 'Chargement…'));
      sapi('fiila_shop_team', {}).then(draw, function (e) { setKids(body); errBox(body, e); });
    }
    function draw(t) {
      var err = h('div', { role: 'alert' });
      function act(fn, args, okText) {
        sapi(fn, args).then(function (nt) { toast(okText); draw(nt); }, function (e) { errBox(err, e); });
      }
      var rows = [h('li', { class: 'team-row' }, h('span', { class: 'team-name' }, t.owner.name), h('span', { class: 'small muted' }, ROLE_LABEL.owner))];
      t.members.forEach(function (m) {
        var edit = h('div', { class: 'stack', hidden: true });
        rows.push(h('li', { class: 'team-row' },
          h('span', { class: 'team-name' }, m.name + (m.me ? ' (vous)' : ''), m.verified ? h('span', { class: 'small muted', title: 'Numéro confirmé par SMS' }, ' · numéro confirmé') : null),
          h('span', { class: 'small muted' }, ROLE_LABEL[m.role]),
          m.me ? null : h('button', { class: 'btn link small', type: 'button', 'aria-expanded': 'false', onclick: function (ev) {
            edit.hidden = !edit.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!edit.hidden));
          } }, 'Modifier'),
          m.me ? null : fill(edit, [
            segField({ legend: 'Rôle', name: 'role-' + m.id, value: m.role, options: [['admin', ROLE_LABEL.admin], ['editor', ROLE_LABEL.editor]],
              onChange: function (v) { act('fiila_shop_member_set', { p_user: m.id, p_action: v }, m.name + ' : ' + ROLE_LABEL[v].toLowerCase() + '.'); } }),
            h('button', { class: 'btn danger small', type: 'button', style: 'align-self:flex-start', onclick: function () {
              if (window.confirm && !window.confirm('Retirer ' + m.name + ' de l’équipe ? Son accès à la boutique s’arrête aussitôt.')) return;
              act('fiila_shop_member_set', { p_user: m.id, p_action: 'remove' }, m.name + ' a été retiré(e) de l’équipe.');
            } }, 'Retirer de l’équipe')])));
      });
      t.invites.forEach(function (i) {
        rows.push(h('li', { class: 'team-row pending' },
          h('span', { class: 'team-name' }, (i.name || i.phone)), h('span', { class: 'small muted' }, 'Invité · ' + ROLE_LABEL[i.role]),
          h('button', { class: 'btn link small', type: 'button', onclick: function () { act('fiila_shop_invite_cancel', { p_id: i.id }, 'Invitation annulée.'); } }, 'Annuler')));
      });
      var f = { name: '', phone: '', role: 'editor' };
      var hint = h('p', { class: 'hint', id: 'team-role-hint' }, ROLE_HINT.editor);
      var sendBox = h('div', { class: 'stack' });
      var inviteBtn = iconBtn('button', { class: 'btn', type: 'button', id: 'team-invite', onclick: function (ev) {
        setKids(err);
        if (!f.phone.trim()) return errBox(err, new ApiError('phone_invalid'));
        var b = ev.currentTarget; b.disabled = true;
        sapi('fiila_shop_invite', { p_name: f.name.trim() || null, p_phone: f.phone.trim(), p_role: f.role }).then(function (r) {
          var link = baseUrl() + '#/equipe/' + r.token;
          var who = f.name.trim() ? f.name.trim().split(' ')[0] : '';
          var msg = 'Bonjour' + (who ? ' ' + who : '') + ', ' + shop.name + ' vous invite à rejoindre son équipe sur Fii (' + ROLE_LABEL[f.role].toLowerCase() + '). Ouvrez ce lien pour accepter : ' + link;
          track('team_invited', f.role);
          b.hidden = true;
          setKids(sendBox, iconBtn('a', { class: 'btn', id: 'team-invite-send', href: waTo(f.phone, msg), target: '_blank', rel: 'noopener noreferrer',
              onclick: function () { setTimeout(function () { draw(r.team); }, 400); } }, 'chat', 'Envoyer sur WhatsApp'),
            iconBtn('button', { class: 'btn ghost small', type: 'button', id: 'team-invite-copy', style: 'align-self:flex-start', onclick: function () { copy(link, 'Lien'); } }, 'link', 'Copier le lien'),
            h('p', { class: 'small muted' }, 'Lien personnel, valable 7 jours, utilisable une seule fois.'));
        }, function (e) { b.disabled = false; errBox(err, e); });
      } }, 'chat', 'Inviter sur WhatsApp');
      setKids(body,
        h('ul', { class: 'team-list', id: 'team-list' }, rows),
        h('h3', { class: 'small' }, 'Ajouter une personne'),
        textField({ id: 'team-name', label: 'Nom', max: 60, onInput: function (v) { f.name = v; } }),
        textField({ id: 'team-phone', label: 'WhatsApp', type: 'tel', inputmode: 'tel', onInput: function (v) { f.phone = v; } }),
        segField({ legend: 'Rôle', name: 'team-role', id: 'team-role', value: f.role, options: [['editor', ROLE_LABEL.editor], ['admin', ROLE_LABEL.admin]],
          onChange: function (v) { f.role = v; hint.textContent = ROLE_HINT[v]; } }),
        hint, err, inviteBtn, sendBox);
    }
    return box;
  }
  function leaveShopBox() {
    var zone = h('div', { class: 'stack' });
    return h('details', { id: 'shop-leave-box' }, h('summary', null, 'Quitter la boutique'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        h('p', { class: 'small' }, 'Vous n’aurez plus accès aux commandes, articles et clients de la boutique. Le propriétaire pourra vous réinviter.'),
        h('button', { class: 'btn danger', type: 'button', id: 'shop-leave', onclick: function (ev) {
          ev.currentTarget.disabled = true;
          api('fiila_shop_leave', {}).then(function () { ME = null; SHOP_ROLE = null; track('team_left', 'member'); toast('Vous avez quitté la boutique.'); go('#/'); },
            function (e) { errBox(zone, e); });
        } }, 'Quitter la boutique'), zone));
  }
  // Réglages vus par un éditeur : son rôle, et la sortie.
  function memberSettings(shop) {
    var pg = page(backBtn('Ma boutique', '#/boutique'),
      h('div', { class: 'stack tight' }, h('h1', null, 'Réglages'),
        h('p', { class: 'muted', id: 'member-role' }, 'Vous êtes ' + ROLE_LABEL.editor.toLowerCase() + ' de ' + shop.name + '.')),
      h('p', { class: 'small muted' }, 'Les réglages sont gérés par le propriétaire et les administrateurs de la boutique.'),
      leaveShopBox(), footer());
    return shopTabs(pg, 'settings');
  }
  function viewTeamInvite(token) {
    return api('fiila_shop_invite_get', { p_token: token }).then(function (r) {
      if (r.state !== 'ok') return page(stateCard(r.state === 'used' ? '✓' : '⌛', r.state === 'used' ? 'Invitation déjà acceptée' : 'Invitation expirée ou introuvable',
        r.state === 'used' ? 'Ouvrez votre boutique.' : 'Demandez une nouvelle invitation à la boutique.', h('a', { class: 'btn', href: '#/boutique' }, 'Ma boutique')), footer());
      var err = h('div', { role: 'alert' });
      var verifyZone = h('div', { class: 'stack' });
      function join(b) {
        if (b) b.disabled = true;
        return api('fiila_shop_invite_accept', { p_token: token }).then(function (x) {
          ME = null; SHOP_ROLE = x.role; track('team_joined', x.role); toast('Vous avez rejoint ' + x.shop + '.'); go('#/boutique');
        }, function (e) {
          if (b) b.disabled = false;
          // Vérification par SMS exigée : on confirme le numéro invité, puis on rejoint aussitôt.
          if (e.code === 'phone_verify_required' || e.code === 'phone_mismatch') {
            if (b) b.hidden = true;
            var note = document.getElementById('team-verify-note'); if (note) note.hidden = true;
            setKids(verifyZone, e.code === 'phone_mismatch' ? h('p', { class: 'small' }, errText(e)) : null,
              phoneVerifyBox({ id: 'team-phone-verify', prefill: r.phone || '', onDone: function () { join(null); } }));
            return;
          }
          errBox(err, e);
        });
      }
      return page(
        inviteCard({ id: 'team-invite-card', kind: 'Équipe · ' + ROLE_LABEL[r.role], from: r.shop, title: 'Vous êtes invité(e) à rejoindre son équipe',
          sub: ROLE_LABEL[r.role] + ' : ' + ROLE_HINT[r.role].charAt(0).toLowerCase() + ROLE_HINT[r.role].slice(1), subId: 'team-invite-role',
          cta: authed() ? ivcBtn('button', { id: 'team-accept', onclick: function (ev) { join(ev.currentTarget); } }, 'Rejoindre la boutique')
            : ivcBtn('a', { id: 'team-login', href: '#/compte' + qs({ retour: 'equipe/' + token }) }, 'Rejoindre l’équipe'),
          more: authed() ? (r.verify ? h('p', { class: 'ivc-note', id: 'team-verify-note' }, 'Votre numéro sera confirmé par un code SMS.') : null)
            : h('p', { class: 'ivc-note' }, 'Un compte Fii gratuit suffit. Pas encore de compte ? Créez-le en un instant.') }),
        verifyZone, err, footer());
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher l’invitation', errText(e), retryBtn())); });
  }

  function shopDeleteBox() {
    var zone = h('div', { class: 'stack' });
    return h('details', { id: 'shop-delete-box' }, h('summary', null, 'Supprimer la boutique'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        h('p', { class: 'small' }, 'Les articles, clients, commandes, factures et paiements de la boutique seront effacés. Les liens déjà envoyés ne fonctionneront plus. Les adresses de vos clients leur appartiennent : elles ne sont pas touchées.'),
        h('button', { class: 'btn danger', type: 'button', id: 'shop-delete', onclick: function () {
          setKids(zone, h('div', { class: 'confirm', role: 'alertdialog' },
            h('p', null, h('strong', null, 'Supprimer définitivement la boutique ?')),
            h('div', { class: 'row' },
              h('button', { class: 'btn danger-fill', type: 'button', id: 'shop-delete-confirm', onclick: function (ev) {
                ev.currentTarget.disabled = true;
                sapi('fiila_shop_delete', {}).then(function () {
                  LS.del(SHOP_LS); LS.del(ORDER_DRAFT); ME = null; track('shop_deleted', 'shop'); toast('Boutique supprimée.'); go('#/');
                }, function (e) { errBox(zone, e); });
              } }, 'Supprimer'),
              h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(zone); } }, 'Annuler'))));
        } }, 'Supprimer la boutique'), zone));
  }

  // L'étape suivante d'une commande, en un seul repère.
  function orderStage(o) {
    if (o.status === 'cancelled') return ['off', 'Annulée'];
    var paid = o.pay_state === 'paid';
    if (o.delivery_state === 'delivered') return paid ? ['ok', 'Terminée'] : ['wait', 'À encaisser'];
    if (o.address_state === 'pending') return ['wait', 'Adresse attendue'];
    if (o.address_state !== 'received') return ['off', 'Adresse à redemander'];
    if (o.delivery_state === 'on_the_way') return ['wait', 'En route'];
    if (o.delivery_state === 'arrived') return ['ok', 'Livreur arrivé'];
    return ['wait', 'À livrer'];
  }
  // Pastille d'état d'une commande (pictogramme compris sans lire) : [classe, icône].
  function stageIcon(o) {
    if (o.status === 'cancelled') return ['off', 'ban'];
    var paid = o.pay_state === 'paid';
    if (o.delivery_state === 'delivered') return paid ? ['ok', 'check'] : ['wait', 'cash'];
    if (o.address_state === 'pending') return ['wait', 'pin'];
    if (o.address_state !== 'received') return ['off', 'pin'];
    if (o.delivery_state === 'on_the_way') return ['go', 'moto'];
    if (o.delivery_state === 'arrived') return ['ok', 'door'];
    return ['go', 'box'];
  }
  // Barre d'onglets de la boutique (pages principales).
  function shopTabs(pg, active) {
    function tab(key, href, name, label) {
      return h('a', { class: 'tab', href: href, id: 'tab-' + key, 'aria-current': active === key ? 'page' : null },
        h('span', { class: 'p', 'aria-hidden': 'true' }, icon(name, 22)), label);
    }
    pg.classList.add('has-tabs');
    pg.appendChild(h('div', { class: 'tabbar' }, h('nav', { 'aria-label': 'Boutique' },
      tab('orders', '#/boutique', 'box', 'Commandes'), tab('products', '#/boutique/articles', 'shop', 'Articles'),
      tab('marketing', '#/boutique/marketing', 'megaphone', 'Marketing'),
      tab('customers', '#/clients', 'users', 'Clients'), tab('settings', '#/boutique/reglages', 'settings', 'Réglages'))));
    return pg;
  }
  function stageChip(o) {
    var st = orderStage(o);
    return h('span', { class: 'chip ' + st[0] }, icon(st[0] === 'ok' ? 'check' : st[0] === 'wait' ? 'clock' : 'ban', 12), st[1]);
  }
  function orderItem(o) {
    var si = stageIcon(o), st = orderStage(o);
    return h('a', { class: 'order-row', href: '#/commande/' + o.id },
      statePill(si[0], si[1]),
      h('div', null,
        h('div', { class: 't' }, 'N° ' + o.ref + ' · ' + o.customer_name),
        h('div', { class: 'small muted' }, st[1] + (o.pay_state === 'partial' ? ' · acompte ' + fcfa(o.paid) : '') + ' · ' + shortDate(o.created_at))),
      h('span', { class: 'amt' }, fcfa(o.total)));
  }
  function shopDashboard(r, q) {
    var shop = r.shop, st = r.stats || {};
    var vue = ['open', 'unpaid', 'done', 'all'].indexOf(q.vue) >= 0 ? q.vue : 'open';
    var listBox = h('div', { class: 'list', id: 'orders' }, loading('Chargement des commandes…'));
    var seq = 0;
    function load() {
      var mine = ++seq;
      sapi('fiila_orders', { p_filter: vue === 'all' ? null : vue }).then(function (rows) {
        if (mine !== seq) return; // un filtre plus récent fait foi
        setKids(listBox, rows.length ? rows.map(orderItem) : h('div', { class: 'card' },
          h('p', { class: 'muted' }, vue === 'open' ? 'Aucune commande en cours.' : vue === 'unpaid' ? 'Rien à encaisser.' : 'Aucune commande.')));
      }, function (e) { errBox(listBox, e); });
    }
    if (st.orders) load();
    return shopTabs(page(backBtn(),
      h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, 'Ma boutique'),
        h('h1', { class: 'wrapword', id: 'shop-title' }, shop.name)),
      partnerSlot(),
      // Boutique neuve : une seule première étape, pas de tableau de bord vide.
      !st.orders && !st.products ? h('section', { class: 'card', id: 'first-product' },
        h('h2', null, 'Ajoutez votre premier article'),
        h('p', { class: 'small muted' }, 'Une photo, un prix. Il sera prêt pour vos commandes.'),
        iconBtn('a', { class: 'btn', href: '#/boutique/article/nouveau' }, 'cam', 'Ajouter un article')) : null,
      iconBtn('a', { class: !st.orders && !st.products ? 'btn ghost full' : 'btn big full', id: 'new-order', href: '#/commande/nouvelle' }, 'plus', 'Nouvelle commande'),
      // Compte proposé quand la boutique tourne (3 commandes), pas dès sa création.
      (shop.account || authed() || (st.orders || 0) < 3 ? null : shopAccountCard()) || shopNudge(shop, st),
      // Les compteurs sont dans les onglets (plus de tuiles qui répètent la même chose).
      st.orders ? segField({ name: 'vue', id: 'orders-filter', value: vue,
        options: [['open', 'En cours' + (st.open ? ' · ' + st.open : '')], ['unpaid', 'À encaisser' + (st.unpaid ? ' · ' + st.unpaid : '')], ['done', 'Terminées'], ['all', 'Toutes']],
        onChange: function (v) { vue = v; try { history.replaceState(null, '', location.pathname + location.search + '#/boutique?vue=' + v); } catch (e) { /* rien */ } setKids(listBox, loading()); load(); } }) : null,
      st.orders ? listBox : null,
      st.products ? (shop.public && shop.slug
        ? h('a', { class: 'invite-row', id: 'vitrine-link', href: '#/b/' + shop.slug }, icon('shop', 24), h('span', null, 'Ma vitrine en ligne'), h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18)))
        : h('a', { class: 'invite-row', id: 'vitrine-open-link', href: '#/boutique/reglages' }, icon('shop', 24), h('span', null, 'Ouvrir ma vitrine en ligne'), h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18)))) : null,
      footer()), 'orders');
  }

  /* ----- clients */
  function viewCustomers(q) {
    var term = (q && q.q) || '';
    var listBox = h('div', { class: 'list', id: 'customers' }, loading());
    var timer, seq = 0;
    function load() {
      var mine = ++seq;
      sapi('fiila_customers', { p_query: term.trim() || null }).then(function (rows) {
        if (mine !== seq) return; // une recherche plus récente fait foi
        setKids(listBox, rows.length ? rows.map(function (c) {
          return h('a', { class: 'item', href: '#/clients/' + c.id },
            h('div', null, h('div', { class: 't' }, c.name), h('div', { class: 'small muted' }, [c.phone, c.orders ? c.orders + ' commande' + (c.orders > 1 ? 's' : '') : null].filter(Boolean).join(' · '))),
            h('span', { class: 'item-end' }, c.has_address ? h('span', { class: 'chip ok' }, icon('check', 12), 'Adresse') : null, h('span', { class: 'chev' }, icon('chev', 18))));
        }) : h('div', { class: 'card' }, h('p', { class: 'muted' }, term ? 'Aucun client trouvé.' : 'Vos clients apparaissent ici dès leur première commande.')));
      }, function (e) {
        if (e.code === 'shop_required') { redirect('#/boutique'); return; }
        errBox(listBox, e);
      });
    }
    load();
    var search = h('input', { type: 'search', id: 'customer-search', placeholder: 'Nom ou téléphone', value: term, 'aria-label': 'Rechercher un client',
      oninput: function (e) { term = e.target.value; clearTimeout(timer); timer = setTimeout(load, 250); } });
    return shopTabs(page(backBtn('Ma boutique', '#/boutique'), h('h1', null, 'Clients'), search, listBox, footer()), 'customers');
  }

  function viewCustomer(id) {
    return sapi('fiila_customer_get', { p_id: id }).then(function (c) {
      var f = { name: c.name, phone: c.phone || '' };
      var err = h('div', { role: 'alert' });
      var zone = h('div', { class: 'stack' });
      return page(backBtn('Clients', '#/clients'),
        h('div', { class: 'stack tight' }, h('p', { class: 'eyebrow' }, 'Client'), h('h1', { class: 'wrapword' }, c.name),
          c.has_address ? h('span', { class: 'chip ok', style: 'align-self:flex-start' }, icon('check', 12), 'Adresse connue : pas besoin de la redemander')
            : h('p', { class: 'small muted' }, 'L’adresse sera demandée à la prochaine commande.')),
        h('a', { class: 'btn', id: 'customer-order', href: '#/commande/nouvelle' + qs({ client: c.id }) }, 'Nouvelle commande'),
        c.phone ? h('a', { class: 'btn ghost', href: waTo(c.phone, ''), target: '_blank', rel: 'noopener noreferrer' }, 'Écrire sur WhatsApp') : null,
        c.order_list.length ? h('section', { class: 'stack' }, h('h2', null, 'Commandes'), h('div', { class: 'list' }, c.order_list.map(orderItem))) : null,
        h('details', null, h('summary', null, 'Modifier le client'),
          h('div', { class: 'stack', style: 'margin-top:12px' },
            textField({ id: 'cu-name', label: 'Nom', max: 60, value: f.name, onInput: function (v) { f.name = v; } }),
            textField({ id: 'cu-phone', label: 'Téléphone', optional: true, type: 'tel', inputmode: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
            err,
            h('button', { class: 'btn', type: 'button', onclick: function () {
              sapi('fiila_customer_save', { p: { id: c.id, name: f.name.trim(), phone: f.phone.trim() || null } }).then(function () { toast('Client mis à jour.'); render(); }, function (e) { errBox(err, e); });
            } }, 'Enregistrer'),
            SHOP_ROLE === 'editor' ? null : h('button', { class: 'btn danger', type: 'button', id: 'customer-delete', onclick: function () {
              setKids(zone, h('div', { class: 'confirm' },
                h('p', null, h('strong', null, 'Retirer ce client de votre fichier ?')),
                h('p', { class: 'small' }, 'Ses commandes passées restent, avec son nom. Son adresse n’est plus mémorisée par la boutique.'),
                h('div', { class: 'row' },
                  h('button', { class: 'btn danger-fill', type: 'button', onclick: function () {
                    sapi('fiila_customer_delete', { p_id: c.id }).then(function () { toast('Client retiré.'); go('#/clients'); }, function (e) { errBox(zone, e); });
                  } }, 'Retirer'),
                  h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(zone); } }, 'Annuler'))));
            } }, 'Retirer ce client'), zone)),
        footer());
    }, failPage('Client introuvable', 'clients'));
  }

  /* ----- nouvelle commande */
  var ORDER_DRAFT = 'fiila.draft.order';
  function viewOrderNew(q) {
    return Promise.all([sapi('fiila_customers', { p_query: null }), sapi('fiila_products', { p_all: false })]).then(function (res) {
      var customers = res[0];
      var pre = q && q.client ? customers.filter(function (c) { return c.id === q.client; })[0] : null;
      return orderForm(customers, pre || null, res[1]);
    }, function (e) {
      if (e.code === 'shop_required') { redirect('#/boutique'); return loading(); }
      return failPage('Impossible de préparer la commande', 'commande/nouvelle')(e);
    });
  }
  function orderForm(customers, pre, products) {
    products = products || [];
    var saved = pre ? null : LS.get(ORDER_DRAFT, null);
    var d = saved || { cust: null, name: '', phone: '', items: [{ label: '', qty: '1', price: '' }], note: '' };
    if (pre) d.cust = { id: pre.id, name: pre.name, phone: pre.phone, has_address: pre.has_address };
    var root = h('div', { class: 'wrap' });
    var custBox = h('div', { class: 'stack' });
    var itemsBox = h('div', { class: 'stack', id: 'items' });
    var totalEl = h('strong', { id: 'order-total' });
    var err = h('div', { role: 'alert' });
    var btn = iconBtn('button', { class: 'btn', type: 'button', id: 'order-create', onclick: submit }, 'check', 'Créer la commande');
    function keep() { LS.set(ORDER_DRAFT, d); }
    function num(v) { var n = parseInt(String(v).replace(/[\s  .]/g, ''), 10); return isFinite(n) ? n : NaN; }
    function total() {
      return d.items.reduce(function (a, it) { var q = num(it.qty), p = num(it.price); return a + (q > 0 && p >= 0 ? q * p : 0); }, 0);
    }
    function refreshTotal() { totalEl.textContent = fcfa(total()); keep(); }

    function drawCustomer() {
      if (d.cust) {
        setKids(custBox, h('div', { class: 'picked' },
          h('div', null, h('div', { class: 't', id: 'picked-name' }, d.cust.name), h('div', { class: 'small muted' },
            [d.cust.phone, d.cust.has_address ? 'adresse connue' : 'adresse à demander'].filter(Boolean).join(' · '))),
          h('button', { class: 'btn ghost small', type: 'button', onclick: function () { d.cust = null; keep(); drawCustomer(); } }, 'Changer')));
        return;
      }
      var matches = h('div', { class: 'list', id: 'customer-matches' });
      function showMatches() {
        var t = (d.name + ' ' + d.phone).trim().toLowerCase();
        var dn = d.phone.replace(/\D/g, '');
        var found = !t ? [] : customers.filter(function (c) {
          return (d.name.trim() && c.name.toLowerCase().indexOf(d.name.trim().toLowerCase()) >= 0) ||
            (dn.length >= 4 && (c.phone || '').replace(/\D/g, '').indexOf(dn) >= 0);
        }).slice(0, 4);
        setKids(matches, found.map(function (c) {
          return h('button', { class: 'item', type: 'button', onclick: function () { d.cust = { id: c.id, name: c.name, phone: c.phone, has_address: c.has_address }; keep(); drawCustomer(); } },
            h('div', null, h('div', { class: 't' }, c.name), h('div', { class: 'small muted' }, [c.phone, c.has_address ? 'adresse connue' : null].filter(Boolean).join(' · '))),
            h('span', { class: 'small' }, 'Choisir'));
        }));
      }
      setKids(custBox,
        textField({ id: 'cust-name', label: 'Nom du client', max: 60, value: d.name, autocomplete: 'off', onInput: function (v) { d.name = v; keep(); showMatches(); } }),
        textField({ id: 'cust-phone', label: 'Téléphone (WhatsApp)', optional: true, type: 'tel', inputmode: 'tel', value: d.phone, onInput: function (v) { d.phone = v; keep(); showMatches(); } }),
        matches);
      showMatches();
    }

    var byId = {};
    products.forEach(function (pr) { byId[pr.id] = pr; });
    function addProduct(pr) {
      var empty = d.items.length === 1 && !d.items[0].label && !String(d.items[0].price);
      var line = { product_id: pr.id, label: pr.name, qty: '1', price: String(pr.price) };
      if (empty) d.items[0] = line; else d.items.push(line);
      drawItems(); refreshTotal();
    }
    var picker = products.length ? h('div', { class: 'stack tight', id: 'product-picker' },
      h('span', { class: 'label' }, 'Ajouter depuis mes articles'),
      h('div', { class: 'pick-row' }, products.map(function (pr) {
        return h('button', { class: 'pick', type: 'button', onclick: function () { addProduct(pr); } },
          pr.photo ? h('img', { src: pr.photo, alt: '' }) : null,
          h('span', null, h('strong', null, pr.name), h('span', { class: 'small muted' }, fcfa(pr.price))));
      }))) : null;
    function drawItems() {
      setKids(itemsBox, d.items.map(function (it, i) {
        var pr = it.product_id ? byId[it.product_id] : null;
        return h('div', { class: 'line-item' + (pr && pr.photo ? ' has-photo' : '') },
          pr && pr.photo ? h('img', { class: 'li-photo', src: pr.photo, alt: '' }) : null,
          h('input', { type: 'text', class: 'li-label', placeholder: 'Article', maxlength: '80', value: it.label, 'aria-label': 'Article ' + (i + 1),
            oninput: function (e) { it.label = e.target.value; keep(); } }),
          h('input', { type: 'text', class: 'li-qty', inputmode: 'numeric', value: it.qty, placeholder: 'Qté', 'aria-label': 'Quantité', oninput: function (e) { it.qty = e.target.value; refreshTotal(); } }),
          h('input', { type: 'text', class: 'li-price', inputmode: 'numeric', placeholder: 'Prix unitaire (FCFA)', value: it.price, 'aria-label': 'Prix unitaire en FCFA', oninput: function (e) { it.price = e.target.value; refreshTotal(); } }),
          d.items.length > 1 ? h('button', { class: 'btn ghost small li-del', type: 'button', 'aria-label': 'Retirer cet article', onclick: function () { d.items.splice(i, 1); drawItems(); refreshTotal(); } }, '×') : h('span', { class: 'li-del' }));
      }), h('button', { class: 'btn ghost small', type: 'button', id: 'add-item', style: 'align-self:flex-start', onclick: function () {
        d.items.push({ label: '', qty: '1', price: '' }); drawItems(); keep();
        var all = itemsBox.querySelectorAll('.li-label'); if (all.length) all[all.length - 1].focus();
      } }, '+ Ajouter un article'));
    }

    function submit() {
      setKids(err);
      var items = d.items.filter(function (it) { return it.label.trim() || String(it.price).trim(); }).map(function (it) {
        return { product_id: it.product_id && byId[it.product_id] ? it.product_id : undefined, label: it.label.trim(), qty: num(it.qty), price: num(it.price) };
      });
      if (!d.cust && !d.name.trim()) return errBox(err, new ApiError('customer_name_required'));
      if (!items.length) return errBox(err, new ApiError('items_required'));
      for (var i = 0; i < items.length; i++) {
        if (!items[i].label) return errBox(err, new ApiError('item_label_required'));
        if (!(items[i].qty >= 1)) return errBox(err, new ApiError('invalid_qty'));
        if (!(items[i].price >= 0)) return errBox(err, new ApiError('invalid_price'));
      }
      btn.disabled = true; btn.textContent = 'Création…';
      var p = { items: items, note: d.note.trim() || null };
      if (d.cust) p.customer_id = d.cust.id; else p.customer = { name: d.name.trim(), phone: d.phone.trim() || null };
      sapi('fiila_order_create', { p: p }).then(function (o) {
        LS.del(ORDER_DRAFT);
        track('order_created', o.address_state === 'received' ? 'known_address' : d.cust ? 'known_customer' : 'new_customer');
        go('#/commande/' + o.id + '?nouveau=1');
      }, function (e) { btn.disabled = false; btn.textContent = 'Réessayer'; errBox(err, e); });
    }

    drawCustomer(); drawItems(); refreshTotal();
    setKids(root, backBtn('Ma boutique', '#/boutique'),
      h('h1', null, 'Nouvelle commande'),
      h('section', { class: 'card' }, h('h2', null, 'Client'), custBox),
      h('section', { class: 'card' }, h('h2', null, 'Articles'), picker,
        h('div', { class: 'line-head', 'aria-hidden': 'true' }, h('span', null, 'Article'), h('span', null, 'Qté'), h('span', null, 'Prix (FCFA)'), h('span')),
        itemsBox,
        h('div', { class: 'total-row' }, h('span', null, 'Total'), totalEl)),
      textField({ id: 'order-note', label: 'Note pour le client', optional: true, max: 200, value: d.note, onInput: function (v) { d.note = v; keep(); } }),
      err, btn,
      saved ? h('button', { class: 'btn link', type: 'button', style: 'align-self:flex-start', onclick: function () { LS.del(ORDER_DRAFT); render(); } }, 'Effacer le brouillon') : null,
      footer());
    return root;
  }

  /* ----- une commande (commerçant) */
  function viewOrder(id, q) {
    return Promise.all([sapi('fiila_order_get', { p_id: id }), sapi('fiila_shop_get', {})]).then(function (res) {
      return orderView(res[0], (res[1] && res[1].shop) || {}, q || {});
    }, failPage('Commande introuvable', 'boutique'));
  }
  function orderView(o, shop, q) {
    var COURIER_KEY = 'fiila.order.courier.' + o.id;
    var link = invoiceUrl(o.share_token);
    var closed = o.status !== 'open';
    var shopName = shop.name || 'votre boutique';
    function refresh(next) { if (next) o = next; showView(orderView(o, shop, {})); }
    function call(fn, args, okText) {
      return sapi(fn, Object.assign({ p_id: o.id }, args || {})).then(function () {
        return sapi('fiila_order_get', { p_id: o.id });
      }).then(function (next) { if (okText) toast(okText); refresh(next); return next; },
        function (e) { toast(errText(e)); throw e; });
    }
    var msgClient = 'Bonjour ' + o.customer_name + ', voici votre commande N° ' + o.ref + ' chez ' + shopName + ' : ' + fcfa(o.total) + '.\n' +
      (o.address_state === 'pending' ? 'Indiquez votre adresse de livraison ici : ' : 'Détail et suivi de la livraison : ') + link;

    // 1. Client et adresse
    var addr;
    if (o.address_state === 'received') {
      addr = [h('span', { class: 'chip ok', style: 'align-self:flex-start' }, icon('check', 12), 'Adresse reçue'),
        h('details', { id: 'order-address' }, h('summary', null, 'Voir l’adresse'), h('div', { style: 'margin-top:12px' }, o.place ? fiche(o.place, { voice: o.place.has_voice ? voicePlayer(voicePrivate('order', o.id, shopKey()), o.place.voice_secs) : null }) : null))];
    } else if (o.address_state === 'pending') {
      addr = [h('span', { class: 'chip wait', style: 'align-self:flex-start' }, icon('clock', 12), 'En attente de l’adresse')];
    } else {
      addr = [h('div', { class: 'notice' }, o.address_state === 'expired' ? 'La demande d’adresse a expiré.' : o.address_state === 'revoked' ? 'Le client a retiré son adresse.' : 'Aucune adresse pour cette commande.'),
        closed ? null : h('button', { class: 'btn', type: 'button', id: 'ask-address', onclick: function (ev) { ev.currentTarget.disabled = true; call('fiila_order_request_address', null, 'Nouvelle demande prête. Renvoyez le lien au client.').catch(function () {}); } }, 'Redemander l’adresse')];
    }

    // 2. Envoyer au client
    var send = closed && o.status === 'cancelled' ? null : h('section', { class: 'card', id: 'send-client' },
      h('h2', null, 'Envoyer au client'),
      h('a', { class: 'btn', id: 'send-invoice', href: waTo(o.customer_phone, msgClient), target: '_blank', rel: 'noopener noreferrer',
        onclick: function () { track('share_initiated', 'whatsapp'); } }, icon('chat', 22), h('span', null, o.address_state === 'pending' ? 'Envoyer la commande et demander l’adresse' : 'Envoyer la facture')),
      h('div', { class: 'row' },
        iconBtn('button', { class: 'btn ghost small', type: 'button', id: 'copy-invoice', onclick: function () { copy(link, 'Lien'); } }, 'link', 'Copier le lien'),
        iconBtn('a', { class: 'btn ghost small', href: '#/f/' + o.share_token, id: 'open-invoice' }, 'eye', 'Voir la facture')));

    // 3. Livraison
    var deliv = null;
    if (!closed && o.address_state === 'received') {
      var cour = LS.get(COURIER_KEY, null);
      var dErr = h('div', { role: 'alert' });
      var startBtn = h('button', { class: cour ? 'btn ghost small' : 'btn big', type: 'button', id: 'start-delivery', onclick: function () {
        startBtn.disabled = true;
        sapi('fiila_order_delivery', { p_id: o.id }).then(function (r) {
          LS.set(COURIER_KEY, r.courier_token); track('delivery_started', 'order');
          sapi('fiila_order_get', { p_id: o.id }).then(function (n) { refresh(n); }, function () { render(); });
        }, function (e) { startBtn.disabled = false; errBox(dErr, e); });
      } }, cour ? 'Autre livreur' : 'Envoyer au livreur');
      var courierUrl = cour ? baseUrl() + '#/l/' + cour : null;
      var att = shop.courier;
      var attBlock = null;
      if (att && o.courier) {
        var stx = { waiting: 'Course reçue, pas encore partie', live: 'En route', arrived: 'Arrivé chez le client' }[o.courier.status] || 'Course envoyée';
        attBlock = h('div', { class: 'stack tight', id: 'att-course' },
          h('p', null, h('strong', null, o.courier.name), ' · ', stx),
          o.courier.phone ? h('a', { class: 'btn ghost small', href: 'tel:' + o.courier.phone.replace(/\s/g, ''), style: 'align-self:flex-start' }, 'Appeler le livreur') : null);
        startBtn.textContent = 'Envoyer à un autre livreur (lien)'; startBtn.className = 'btn ghost small';
      } else if (att) {
        attBlock = h('button', { class: 'btn big', type: 'button', id: 'dispatch-att', onclick: function (ev) {
          ev.currentTarget.disabled = true;
          call('fiila_order_dispatch', null, 'Course envoyée à ' + att.name + '.').catch(function () {});
        } }, icon('moto', 22), h('span', null, 'Envoyer à ' + att.name));
        startBtn.textContent = 'Autre livreur (lien)'; startBtn.className = 'btn ghost small';
      }
      deliv = h('section', { class: 'card', id: 'order-delivery' }, h('h2', null, 'Livraison'),
        attBlock,
        cour && !o.courier ? iconBtn('a', { class: 'btn', id: 'send-courier', target: '_blank', rel: 'noopener noreferrer',
          href: waLink('Livraison N° ' + o.ref + ' pour ' + o.customer_name + ' : adresse exacte et photo de l’entrée. Ouvrez le lien et touchez « Démarrer la livraison » : ' + courierUrl) }, 'moto', 'Envoyer le lien au livreur (WhatsApp)') : null,
        cour && !o.courier ? h('button', { class: 'btn ghost small', type: 'button', id: 'copy-courier', onclick: function () { copy(courierUrl, 'Lien livreur'); } }, 'Copier le lien livreur') : null,
        startBtn, dErr,
        o.watch_token ? deliveryWatch(o.watch_token) : null,
        h('button', { class: 'btn', type: 'button', id: 'mark-delivered', onclick: function (ev) { ev.currentTarget.disabled = true; LS.del(COURIER_KEY); call('fiila_order_set_status', { p_status: 'delivered' }, 'Commande livrée.').catch(function () {}); } }, 'Marquer comme livrée'),
        null);
    } else if (o.status === 'delivered') {
      deliv = h('section', { class: 'card', id: 'order-delivery' }, h('h2', null, 'Livraison'),
        h('span', { class: 'chip ok', style: 'align-self:flex-start' }, icon('check', 12), 'Livrée le ' + shortDate(o.delivered_at)),
        h('button', { class: 'btn link', type: 'button', style: 'align-self:flex-start', onclick: function () { call('fiila_order_set_status', { p_status: 'open' }, 'Commande rouverte.').catch(function () {}); } }, 'Ce n’est pas encore livré'));
    }

    // 4. Paiement
    var remaining = Math.max(0, o.total - o.paid);
    var pay = { amount: remaining ? String(remaining) : '', method: 'cash' };
    var pErr = h('div', { role: 'alert' });
    var payments = o.payments || [];
    var paySec = o.status === 'cancelled' ? null : h('section', { class: 'card', id: 'order-payment' },
      h('h2', null, 'Paiement'),
      h('div', { class: 'total-row' }, h('span', null, 'Total'), h('strong', null, fcfa(o.total))),
      o.paid ? h('div', { class: 'total-row' }, h('span', null, 'Reçu'), h('span', null, fcfa(o.paid))) : null,
      h('div', { class: 'total-row' }, h('span', null, 'Reste'), h('strong', { id: 'remaining' }, remaining ? fcfa(remaining) : 'Payée')),
      payments.length ? h('ul', { class: 'pay-list' }, payments.map(function (pm) {
        return h('li', null, h('span', null, fcfa(pm.amount) + ' · ' + (PAY_METHODS[pm.method] || pm.method) + ' · ' + shortDate(pm.created_at)),
          pm.source === 'manual' ? h('button', { class: 'btn link', type: 'button', onclick: function () { call('fiila_order_payment_delete', { p_payment_id: pm.id }, 'Paiement retiré.').catch(function () {}); } }, 'Retirer') : null);
      })) : null,
      remaining ? h('details', { id: 'pay-add' },
        h('summary', null, 'Enregistrer un paiement reçu'),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          textField({ id: 'pay-amount', label: 'Montant (FCFA)', inputmode: 'numeric', value: pay.amount, max: 12, onInput: function (v) { pay.amount = v; } }),
          segField({ name: 'pay-method', id: 'pay-method', value: pay.method, options: Object.keys(PAY_METHODS).map(function (k) { return [k, PAY_METHODS[k]]; }), onChange: function (v) { pay.method = v; } }),
          pErr,
          h('button', { class: 'btn', type: 'button', id: 'pay-save', onclick: function (ev) {
            var n = parseInt(String(pay.amount).replace(/\D/g, ''), 10);
            if (!(n > 0)) return errBox(pErr, new ApiError('invalid_price'));
            ev.currentTarget.disabled = true;
            call('fiila_order_payment_add', { p_amount: n, p_method: pay.method }, 'Paiement enregistré.').then(function () { track('payment_recorded', pay.method); }, function () {});
          } }, 'Enregistrer'))) : null);

    // 5. Articles
    var items = h('section', { class: 'card' }, h('h2', null, 'Articles'), invoiceTable(o.items, o.total), o.note ? h('p', { class: 'small muted wrapword' }, o.note) : null);

    var zone = h('div', { class: 'stack' });
    var endActions = o.status === 'cancelled'
      ? h('button', { class: 'btn ghost', type: 'button', onclick: function () { call('fiila_order_set_status', { p_status: 'open' }, 'Commande rouverte.').catch(function () {}); } }, 'Rouvrir la commande')
      : o.status === 'open' ? h('button', { class: 'btn quiet danger-text', type: 'button', id: 'cancel-order', onclick: function () {
        setKids(zone, h('div', { class: 'confirm' },
          h('p', null, h('strong', null, 'Annuler la commande N° ' + o.ref + ' ?')),
          h('p', { class: 'small' }, 'Le lien envoyé au client affichera « commande annulée ». Le suivi du livreur s’arrête.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn danger-fill', type: 'button', id: 'confirm-cancel', onclick: function () { LS.del(COURIER_KEY); call('fiila_order_set_status', { p_status: 'cancelled' }, 'Commande annulée.').catch(function () {}); } }, 'Annuler la commande'),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(zone); } }, 'Retour'))));
      } }, 'Annuler la commande') : null;

    return page(backBtn('Ma boutique', '#/boutique'),
      h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, 'Commande N° ' + o.ref),
        h('h1', { class: 'wrapword' }, o.customer_id ? h('a', { href: '#/clients/' + o.customer_id, class: 'plain' }, o.customer_name) : o.customer_name),
        h('div', { class: 'row', style: 'align-items:center;gap:10px' }, stageChip(o), h('span', { class: 'small muted' }, fcfa(o.total) + ' · ' + shortDate(o.created_at)))),
      q.nouveau === '1' ? h('p', { class: 'saved-ok', role: 'status', id: 'order-created' }, icon('check', 18),
        o.address_state === 'pending' ? 'Commande créée.' : 'Commande créée. Adresse déjà connue.') : null,
      h('section', { class: 'card', id: 'order-client' }, h('h2', null, 'Adresse de livraison'), addr),
      send, deliv, paySec, items, endActions, zone, footer());
  }

  function invoiceTable(items, total) {
    return h('table', { class: 'inv' },
      h('thead', null, h('tr', null, h('th', null, 'Article'), h('th', { class: 'n' }, 'Qté'), h('th', { class: 'n' }, 'Prix'), h('th', { class: 'n' }, 'Montant'))),
      h('tbody', null, (items || []).map(function (it) {
        return h('tr', null, h('td', { class: 'wrapword' }, it.photo ? h('span', { class: 'lbl' }, h('img', { class: 'inv-photo', src: it.photo, alt: '' }), h('span', null, it.label)) : it.label), h('td', { class: 'n' }, String(it.qty)), h('td', { class: 'n' }, fcfa(it.price)), h('td', { class: 'n' }, fcfa(it.qty * it.price)));
      })),
      h('tfoot', null, h('tr', null, h('td', { colspan: '3' }, 'Total'), h('td', { class: 'n' }, fcfa(total)))));
  }

  /* ----- compte proposé, jamais imposé */
  // Compte des actions utiles sur ce téléphone (fiche, demande, boutique, commande).
  function bumpTx() { LS.set('fiila.tx', (LS.get('fiila.tx', 0) || 0) + 1); }
  function nudgeCard(id, title, text, href, onLater) {
    var card = h('section', { class: 'card nudge', id: id },
      h('h2', null, title), h('p', { class: 'small muted' }, text),
      h('div', { class: 'row' },
        h('a', { class: 'btn small', href: href, id: id + '-yes' }, 'Créer un compte'),
        h('button', { class: 'btn ghost small', type: 'button', id: id + '-later', onclick: function () { onLater(); card.remove(); } }, 'Plus tard')));
    return card;
  }
  // Après 3 actions, sans compte : une proposition discrète, jamais bloquante.
  function accountNudge() {
    if (authed() || (LS.get('fiila.tx', 0) || 0) < 3) return null;
    var until = LS.get('fiila.nudge.until', 0) || 0;
    if (Date.now() < until) return null;
    track('account_nudge', 'shown');
    return nudgeCard('account-nudge', 'Ne perdez rien', 'Un compte garde vos adresses et votre boutique, même si vous changez de téléphone. Facultatif.',
      '#/compte' + qs({ mode: 'inscription', source: 'nudge' }), function () {
        LS.set('fiila.nudge.until', Date.now() + 14 * 864e5); track('account_nudge', 'dismissed');
      });
  }
  function shopAccountCard() {
    if (Date.now() < (LS.get('fiila.nudge.shop', 0) || 0)) return null;
    return nudgeCard('shop-nudge', 'Votre boutique est sur ce téléphone', 'Créez un compte pour la retrouver sur tous vos téléphones. Vous pouvez continuer sans.',
      '#/compte' + qs({ mode: 'inscription', retour: 'boutique', source: 'shop' }), function () { LS.set('fiila.nudge.shop', Date.now() + 7 * 864e5); });
  }

  /* ----- articles de la boutique (catalogue) */
  // Note : une étoile dessinée + « 4,8 (12) », sans caractères ★ ☆.
  function ratingText(r, n) { return String(Number(r).toFixed(1)).replace('.', ',') + ' (' + n + ')'; }
  function ratingEl(r, n) { return h('span', { class: 'rating' }, icon('star', 14), ratingText(r, n)); }
  /* ----- Ma boutique → Marketing (fondateur, 22/10/2026 : « gérer les créas et campagnes + pages sur les réseaux.
     Statistiques et tout compris »). Lot 1 : statistiques, partage de la vitrine, réseaux de la boutique.
     Une seule rangée de filtres (la période) ; une seule action principale (partager la vitrine). */
  var SOCIALS = [['instagram', 'Instagram', 'https://www.instagram.com/'], ['tiktok', 'TikTok', 'https://www.tiktok.com/@'], ['facebook', 'Facebook', 'https://www.facebook.com/']];
  function socialUrl(k, v) { var x = SOCIALS.filter(function (o) { return o[0] === k; })[0]; return x && v ? x[2] + encodeURIComponent(v) : null; }
  TRACKABLE.marketing = ['open', 'period:7', 'period:30', 'period:90', 'share:wa', 'share:copy', 'share:qr', 'socials:open', 'socials:save', 'publish:click', 'vitrine:open'];
  function trendText(cur, prev) {
    if (!prev) return ''; // rien à comparer : pas de mention (une ligne discrète plutôt que trois)
    var d = Math.round((cur - prev) * 100 / prev);
    return d === 0 ? 'Stable' : (d > 0 ? '+' : '−') + Math.abs(d) + ' % vs période précédente';
  }
  function viewShopMarketing(q) {
    var days = [7, 30, 90].indexOf(Number(q.p)) >= 0 ? Number(q.p) : 30;
    return sapi('fiila_shop_stats', { p_days: days }).then(function (r) {
      track('marketing', 'open');
      var statsBox = h('div', { class: 'stack', id: 'mk-stats' });
      var socials = Object.assign({}, r.socials || {});
      var socialBox = h('div', { class: 'list', id: 'mk-socials' });
      var canEdit = r.role !== 'editor';
      function kpi(id, value, label, sub) {
        return h('div', { class: 'tile mk-kpi', id: id }, h('strong', null, value), h('span', null, label), sub ? h('small', { class: 'mk-trend' }, sub) : null);
      }
      function drawStats(x) {
        setKids(statsBox,
          h('div', { class: 'tiles mk-kpis' },
            kpi('mk-revenue', fcfa(x.revenue), 'Ventes', trendText(x.revenue, x.prev_revenue)),
            kpi('mk-orders', String(x.orders), x.orders > 1 ? 'Commandes' : 'Commande', trendText(x.orders, x.prev_orders)),
            kpi('mk-views', String(x.views), x.views > 1 ? 'Visites de la vitrine' : 'Visite de la vitrine', trendText(x.views, x.prev_views)),
            kpi('mk-customers', String(x.new_customers), x.new_customers > 1 ? 'Nouveaux clients' : 'Nouveau client')),
          // Une ligne d'informations discrète.
          h('p', { class: 'small muted', id: 'mk-line' }, [x.orders ? 'Panier moyen ' + fcfa(x.basket) : null,
            x.vitrine_orders ? x.vitrine_orders + ' via la vitrine' : null,
            x.posts ? x.posts + (x.posts > 1 ? ' publications' : ' publication') : null].filter(Boolean).join(' · ') || 'Les chiffres se remplissent avec vos premières commandes.'),
          x.top && x.top.length ? h('section', { class: 'stack tight', id: 'mk-top' },
            h('h2', null, 'Les plus vendus'),
            h('div', { class: 'list' }, x.top.map(function (t) {
              return h('a', { class: 'item', href: '#/boutique/article/' + t.id + '?publier=1', onclick: function () { track('marketing', 'publish:click'); } },
                h('div', null, h('div', { class: 't wrapword' }, t.name), h('div', { class: 'small muted' }, t.qty + (t.qty > 1 ? ' vendus' : ' vendu') + ' · ' + fcfa(t.amount))),
                h('span', { class: 'item-end' }, h('span', { class: 'small mk-pub' }, 'Publier'), h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))));
            }))) : null);
      }
      drawStats(r);
      var seq = 0;
      function setPeriod(v) {
        days = Number(v); track('marketing', 'period:' + v);
        try { history.replaceState(null, '', location.pathname + location.search + '#/boutique/marketing?p=' + v); } catch (e) { /* rien */ }
        var mine = ++seq;
        statsBox.classList.add('loading-dim');
        sapi('fiila_shop_stats', { p_days: days }).then(function (x) { if (mine !== seq) return; statsBox.classList.remove('loading-dim'); drawStats(x); },
          function (e) { if (mine !== seq) return; statsBox.classList.remove('loading-dim'); errBox(statsBox, e); });
      }
      // Partage de la vitrine : l'action principale de l'écran.
      var url = r.vitrine && r.vitrine.public && r.vitrine.slug ? vitrineUrl(r.vitrine.slug) : null;
      var qrBox = h('div', { class: 'stack tight', id: 'mk-qr', hidden: true });
      var share = url ? h('section', { class: 'stack tight', id: 'mk-share' },
        iconBtn('a', { class: 'btn big full', id: 'mk-share-wa', href: waLink('Ma boutique en ligne : choisissez vos articles et commandez ici, sans compte : ' + url), target: '_blank', rel: 'noopener noreferrer',
          onclick: (function (go) { return function (e) { track('marketing', 'share:wa'); go(e); }; })(waCardClick('vitrine', 'Ma boutique en ligne : choisissez vos articles et commandez ici, sans compte : ' + url)) }, 'chat', 'Partager ma vitrine sur WhatsApp'),
        h('div', { class: 'rnd-row' },
          roundBtn('button', { type: 'button', id: 'mk-copy', onclick: function () { copy(url, 'Lien', function () { track('marketing', 'share:copy'); }); } }, 'link', 'Copier'),
          roundBtn('button', { type: 'button', id: 'mk-qr-btn', 'aria-expanded': 'false', 'aria-controls': 'mk-qr', onclick: function (e) {
            var btn = e.currentTarget, open = qrBox.hidden; qrBox.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open && !qrBox.firstChild) {
              track('marketing', 'share:qr');
              loadQr().then(function (qrcode) {
                var qr = qrcode(0, 'M'); qr.addData(url); qr.make();
                setKids(qrBox, h('div', { class: 'qr' }, h('img', { src: qr.createDataURL(6), alt: 'QR code de la vitrine : ' + url, id: 'mk-qr-img' })),
                  h('p', { class: 'small muted' }, 'À imprimer près de la caisse ou sur vos sacs.'));
              }, function () { setKids(qrBox, h('p', { class: 'small muted' }, 'QR code indisponible pour le moment.')); });
            }
          } }, 'qr', 'QR code'),
          roundBtn('a', { id: 'mk-vitrine', href: '#/b/' + r.vitrine.slug, onclick: function () { track('marketing', 'vitrine:open'); } }, 'eye', 'Voir')),
        qrBox, h('p', { class: 'sharelink', id: 'mk-url' }, url))
        : h('section', { class: 'card stack tight', id: 'mk-closed' },
          h('h2', null, 'Ouvrez votre vitrine en ligne'),
          h('p', { class: 'small muted' }, 'Vos articles sur une page à partager : vos clientes commandent sans compte.'),
          iconBtn('a', { class: 'btn big full', id: 'mk-open-vitrine', href: '#/boutique/reglages' }, 'shop', 'Ouvrir ma vitrine'));
      // Réseaux de la boutique : affichés en bas de la vitrine.
      function drawSocials() {
        setKids(socialBox, SOCIALS.map(function (o) {
          var v = socials[o[0]];
          var inner = [h('span', { class: 'irow-ic', 'aria-hidden': 'true' }, icon(o[0], 20)),
            h('span', { class: 'irow-t' }, o[1], h('small', { class: 'muted mk-handle' }, v ? '@' + v : canEdit ? 'Ajouter' : '—')),
            canEdit ? h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18)) : null];
          return canEdit ? h('button', { class: 'irow', type: 'button', id: 'mk-social-' + o[0], onclick: socialSheet }, inner)
            : h('div', { class: 'irow', id: 'mk-social-' + o[0] }, inner);
        }));
      }
      function socialSheet() {
        track('marketing', 'socials:open');
        var draft = Object.assign({}, socials), err = h('div', { role: 'alert' });
        var save = h('button', { class: 'btn', type: 'button', id: 'mk-socials-save', onclick: function () {
          setKids(err); save.disabled = true;
          var p = {}; SOCIALS.forEach(function (o) { p[o[0]] = (draft[o[0]] || '').trim(); });
          sapi('fiila_shop_vitrine', { p: { socials: p } }).then(function (x) {
            socials = x.socials || {}; track('marketing', 'socials:save'); close(); toast('Réseaux enregistrés. Ils apparaissent sur votre vitrine.'); drawSocials();
          }, function (e) { save.disabled = false; errBox(err, e); });
        } }, 'Enregistrer');
        var back = h('div', { class: 'sheet-back', id: 'mk-socials-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mk-socials-h', onclick: function (e) { if (e.target === back) close(); } },
          h('div', { class: 'sheet' }, h('h2', { id: 'mk-socials-h' }, 'Mes réseaux'),
            h('p', { class: 'small muted' }, 'Le nom de chaque compte, ou son lien. Laissez vide pour retirer.'),
            SOCIALS.map(function (o) {
              return textField({ id: 'mk-in-' + o[0], label: o[1], optional: true, max: 120, value: draft[o[0]] ? '@' + draft[o[0]] : '', placeholder: '@maboutique',
                autocomplete: 'off', onInput: function (v) { draft[o[0]] = v; } });
            }),
            err, save, h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler')));
        var closeSheet; function close() { closeSheet(); }
        closeSheet = openSheet(back);
      }
      drawSocials();
      return shopTabs(page(backBtn('Ma boutique', '#/boutique'),
        h('div', { class: 'stack tight' }, h('p', { class: 'eyebrow wrapword' }, r.name || 'Ma boutique'), h('h1', null, 'Marketing')),
        segField({ name: 'mk-period', id: 'mk-period', value: String(days), options: [['7', '7 jours'], ['30', '30 jours'], ['90', '90 jours']], onChange: setPeriod }),
        statsBox,
        share,
        h('section', { class: 'stack tight', id: 'mk-networks' }, h('h2', null, 'Mes réseaux'), socialBox,
          h('p', { class: 'small muted' }, 'Affichés en bas de votre vitrine, pour qu’on vous suive.')),
        h('p', { class: 'small muted', id: 'mk-soon' }, 'Bientôt ici : promotions, campagnes WhatsApp et créations Fii Studio.'),
        footer()), 'marketing');
    }, failPage('Impossible de charger le marketing', 'boutique/marketing'));
  }
  function viewProducts() {
    return sapi('fiila_products', { p_all: true }).then(function (rows) {
      return shopTabs(page(backBtn('Ma boutique', '#/boutique'),
        h('div', { class: 'brand-row' }, h('h1', null, 'Mes articles'), iconBtn('a', { class: 'btn small', id: 'product-new', href: '#/boutique/article/nouveau' }, 'plus', 'Ajouter', 18)),
        rows.length ? h('div', { class: 'list', id: 'products' }, rows.map(function (pr) {
          return h('a', { class: 'item product-item', href: '#/boutique/article/' + pr.id },
            pr.photo ? h('img', { class: 'thumb', src: pr.photo, alt: '' }) : h('span', { class: 'thumb empty', 'aria-hidden': 'true' }),
            h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 't' }, pr.name),
              h('div', { class: 'small muted' }, fcfa(pr.price), pr.reviews ? [' · ', ratingEl(pr.rating, pr.reviews)] : null)),
            h('span', { class: 'item-end' }, pr.active ? null : h('span', { class: 'chip neutral' }, 'Masqué'), h('span', { class: 'chev' }, icon('chev', 18))));
        })) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Ajoutez vos articles avec leur photo et leur prix : vous les choisirez en un geste dans vos commandes.')),
        footer()), 'products');
    }, failPage('Impossible de charger les articles', 'boutique/articles'));
  }
  function viewProductForm(id, q) {
    if (id === 'nouveau') return productForm(null);
    return Promise.all([sapi('fiila_products', { p_all: true }), sapi('fiila_shop_get', {}).then(null, function () { return {}; })]).then(function (rr) {
      var pr = rr[0].filter(function (x) { return x.id === id; })[0];
      return pr ? productForm(pr, rr[1].shop, q && q.publier === '1') : page(backBtn('Mes articles', '#/boutique/articles'), stateCard('?', 'Article introuvable', ''), footer());
    }, failPage('Impossible de charger l’article', 'boutique/articles'));
  }
  var CATEGORIES = [['mode', 'Vêtements'], ['chaussures', 'Chaussures'], ['beaute', 'Beauté'], ['alimentation', 'Alimentation'], ['maison', 'Maison'],
    ['electronique', 'Électronique'], ['accessoires', 'Accessoires'], ['enfants', 'Enfants'], ['autre', 'Autre']];
  function catLabel(k) { var c = CATEGORIES.filter(function (x) { return x[0] === k; })[0]; return c ? c[1] : ''; }
  function splitTags(t) {
    var seen = {}; return String(t || '').split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; });
  }
  // Détails de l'article (facultatifs) : catégorie, tailles ou pointures, couleurs, stock. Ouverts s'ils sont déjà remplis.
  function productDetails(f) {
    var sizesBox = textField({ id: 'product-sizes', label: 'Tailles ou pointures', optional: true, max: 120, value: f.sizes, placeholder: 'Ex. : S, M, L ou 40, 41, 42', onInput: function (v) { f.sizes = v; } });
    function preset(label, val) {
      return h('button', { class: 'btn ghost small', type: 'button', onclick: function () { f.sizes = val; var i = document.getElementById('product-sizes'); if (i) i.value = val; } }, label);
    }
    var sel = h('select', { id: 'product-cat', onchange: function (e) { f.category = e.target.value; } },
      h('option', { value: '' }, 'Choisir…'), CATEGORIES.map(function (c) { return h('option', { value: c[0], selected: f.category === c[0] || null }, c[1]); }));
    return h('details', { class: 'more-details', id: 'product-details', open: f.category || f.sizes || f.colors || f.stock ? true : null },
      h('summary', null, 'Catégorie, tailles, couleurs, stock'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        h('div', { class: 'field' }, h('label', { for: 'product-cat' }, 'Catégorie'), sel),
        sizesBox,
        h('div', { class: 'row' }, preset('Tailles S à XL', 'S, M, L, XL'), preset('Pointures 38 à 45', '38, 39, 40, 41, 42, 43, 44, 45')),
        textField({ id: 'product-colors', label: 'Couleurs', optional: true, max: 160, value: f.colors, placeholder: 'Ex. : Rouge, Bleu nuit', onInput: function (v) { f.colors = v; } }),
        textField({ id: 'product-stock', label: 'Stock', optional: true, inputmode: 'numeric', value: f.stock, placeholder: 'Laisser vide si vous ne comptez pas', onInput: function (v) { f.stock = v; } }),
        h('p', { class: 'hint' }, 'Vos clientes choisissent leur taille et leur couleur en commandant. Avec un stock, l’article passe « Épuisé » à zéro.')));
  }
  // Une ligne discrète : ce que le fil dit de l'article (j'aime, commentaires, enregistrements, ventes livrées sur 30 jours).
  function productStats(id) {
    var line = h('p', { class: 'small muted', id: 'product-stats', hidden: true });
    sapi('fiila_product_stats', { p_id: id }).then(function (r) {
      var parts = [r.likes ? countText(r.likes, 'j’aime', 'j’aime') : '', r.comments ? countText(r.comments, 'commentaire', 'commentaires') : '',
        r.saves ? countText(r.saves, 'enregistrement', 'enregistrements') : '', r.sold ? countText(r.sold, 'vendu', 'vendus') + ' (30 j)' : ''].filter(Boolean);
      if (parts.length) { line.textContent = 'Dans le fil : ' + parts.join(' · '); line.hidden = false; }
    }, function () {});
    return line;
  }
  function productForm(pr, shop, fresh) {
    var f = { name: pr ? pr.name : '', price: pr ? String(pr.price) : '', description: pr ? pr.description || '' : '', active: pr ? pr.active : true, photo: pr ? pr.photo || null : null };
    f.category = pr && pr.category || ''; f.sizes = (pr && pr.sizes || []).join(', '); f.colors = (pr && pr.colors || []).join(', ');
    f.stock = pr && pr.stock != null ? String(pr.stock) : '';
    var err = h('div', { role: 'alert' });
    var zone = h('div', { class: 'stack' });
    var photos = productPhotos(pr);
    var photoBox = photos.el;
    var btn = h('button', { class: 'btn', type: 'button', id: 'product-save', onclick: function () {
      setKids(err);
      var price = parseInt(String(f.price).replace(/\D/g, ''), 10);
      if (!f.name.trim()) return errBox(err, new ApiError('item_label_required'));
      if (!(price >= 0)) return errBox(err, new ApiError('invalid_price'));
      var stock = f.stock.trim() === '' ? null : parseInt(f.stock.replace(/\D/g, ''), 10);
      if (stock !== null && !(stock >= 0)) return errBox(err, new ApiError('invalid_stock'));
      var p = { id: pr ? pr.id : undefined, name: f.name.trim(), price: price, description: f.description.trim() || null, active: f.active,
        category: f.category || null, sizes: splitTags(f.sizes), colors: splitTags(f.colors), stock: stock };
      btn.disabled = true;
      photos.payload().then(function (pp) {
        if (pp) { p.photo = pp.photo; p.photos = pp.photos; }
        return sapi('fiila_product_save', { p: p });
      }).then(function (res) {
        if (!pr) track('product_created', photos.count() ? 'photo' : 'no_photo');
        var nid = res && (res.id || (res.product && res.product.id));
        if (!pr && nid && p.active !== false) { go('#/boutique/article/' + nid + '?publier=1'); return; }
        toast(pr ? 'Article mis à jour.' : 'Article ajouté.'); go('#/boutique/articles');
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, pr ? 'Enregistrer' : 'Ajouter l’article');
    return page(backBtn('Mes articles', '#/boutique/articles'),
      pr && pr.active ? publishBox(pr, shop, fresh) : null,
      h('h1', null, pr ? 'Modifier l’article' : 'Nouvel article'),
      pr ? productStats(pr.id) : null,
      photoBox,
      textField({ id: 'product-name', label: 'Nom', max: 80, value: f.name, placeholder: 'Ex. : Robe wax taille M', onInput: function (v) { f.name = v; } }),
      textField({ id: 'product-price', label: 'Prix (FCFA)', inputmode: 'numeric', value: f.price, placeholder: 'Ex. : 12500', onInput: function (v) { f.price = v; } }),
      textField({ id: 'product-desc', label: 'Description', optional: true, multiline: true, max: 300, value: f.description, onInput: function (v) { f.description = v; } }),
      productDetails(f),
      pr ? segField({ name: 'product-active', id: 'product-active', value: f.active ? 'on' : 'off', options: [['on', 'Visible'], ['off', 'Masqué']], onChange: function (v) { f.active = v === 'on'; } }) : null,
      err, btn,
      pr && SHOP_ROLE !== 'editor' ? h('button', { class: 'btn danger', type: 'button', id: 'product-delete', onclick: function () {
        setKids(zone, h('div', { class: 'confirm' },
          h('p', null, h('strong', null, 'Supprimer cet article ?')),
          h('p', { class: 'small' }, 'Les commandes passées gardent son nom et son prix. Ses notes sont effacées. Pour le retirer sans perdre ses notes, choisissez plutôt « Masqué ».'),
          h('div', { class: 'row' },
            h('button', { class: 'btn danger-fill', type: 'button', onclick: function () {
              sapi('fiila_product_delete', { p_id: pr.id }).then(function () { toast('Article supprimé.'); go('#/boutique/articles'); }, function (e) { errBox(zone, e); });
            } }, 'Supprimer'),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(zone); } }, 'Annuler'))));
      } }, 'Supprimer l’article') : null,
      zone, footer());
  }

  // Notes de l'acheteur, sur la facture d'une commande livrée.
  function reviewBox(token, items, shopName, courier) {
    var box = h('section', { class: 'card no-print', id: 'reviews' }, h('h2', null, 'Votre avis'));
    if (courier) box.append(courierRateRow(token, courier));
    items.forEach(function (it) {
      var cur = it.my_rating || 0;
      var row = h('div', { class: 'rate-row' });
      function draw() {
        setKids(row, h('span', { class: 'wrapword' }, it.label),
          h('span', { class: 'stars', role: 'radiogroup', 'aria-label': 'Note pour ' + it.label }, [1, 2, 3, 4, 5].map(function (n) {
            return h('button', { type: 'button', class: 'star' + (n <= cur ? ' on' : ''), role: 'radio', 'aria-checked': String(n === cur), 'aria-label': n + ' sur 5',
              onclick: function () {
                api('fiila_review', { p_token: token, p_product_id: it.product_id, p_rating: n, p_comment: null }).then(function () {
                  cur = n; draw(); track('review_left', String(n)); toast('Merci pour votre note.');
                }, function (e) { toast(errText(e)); });
              } }, icon('star', 28));
          })));
      }
      draw();
      box.append(row);
    });
    return box;
  }

  /* ----- espace livreur (sans compte : clé gardée sur son téléphone) */
  var COURIER_LS = 'fiila.courier';
  function courierKey() { var x = LS.get(COURIER_LS, null); return (x && x.key) || null; }
  function courierForm(pre, onDone) {
    var f = { name: (pre && pre.name) || '', phone: (pre && pre.phone) || '', vehicle: 'moto', zone: '' };
    var err = h('div', { role: 'alert' });
    var ask = pre ? null : referralAsk('cr-ref');
    var btn = h('button', { class: 'btn', type: 'button', id: 'courier-register', onclick: function () {
      setKids(err);
      if (!f.name.trim()) return errBox(err, new ApiError('name_required'));
      btn.disabled = true;
      api('fiila_courier_register', { p: { name: f.name.trim(), phone: f.phone.trim() || null, vehicle: f.vehicle, zone: f.zone.trim() || null } }).then(function (r) {
        LS.set(COURIER_LS, { key: r.key });
        track('courier_registered', pre ? 'invite' : 'direct');
        attribute('courier', null, r.key, ask ? ask.value() : '');
        onDone(r);
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, 'Créer mon espace livreur');
    return h('div', { class: 'stack' },
      textField({ id: 'cr-name', label: 'Votre nom', max: 60, value: f.name, autocomplete: 'name', onInput: function (v) { f.name = v; } }),
      textField({ id: 'cr-phone', label: 'Téléphone', optional: true, type: 'tel', inputmode: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
      segField({ legend: 'Vous livrez en', name: 'cr-vehicle', id: 'cr-vehicle', value: f.vehicle, options: Object.keys(VEHICLES).map(function (k) { return [k, VEHICLES[k]]; }), onChange: function (v) { f.vehicle = v; } }),
      textField({ id: 'cr-zone', label: 'Zone', optional: true, max: 60, value: f.zone, placeholder: 'Ex. : Yoff, Ngor, Almadies', onInput: function (v) { f.zone = v; } }),
      ask ? ask.el : null,
      err, btn);
  }
  function viewCourierHome() {
    if (!courierKey()) {
      var wrap = h('div', { class: 'wrap' });
      setKids(wrap, backBtn(),
        h('div', { class: 'stack tight' }, h('h1', null, 'Espace livreur'),
          h('p', { class: 'muted' }, 'Recevez les courses de vos boutiques, avec l’adresse exacte et la photo de l’entrée. Sans compte.')),
        courierForm(null, function () { render(); }), footer());
      return wrap;
    }
    return api('fiila_courier_me', { p_key: courierKey() }).then(function (r) { return courierInbox(r); }, function (e) {
      if (e.code === 'courier_required') { LS.del(COURIER_LS); return viewCourierHome(); }
      return page(backBtn(), stateCard('!', 'Impossible de charger vos courses', errText(e), retryBtn()), footer());
    });
  }
  function courierInbox(r) {
    var c = r.courier;
    var list = h('div', { class: 'list', id: 'courses' });
    var seen = r.courses.length;
    function draw(courses) {
      setKids(list, courses.length ? courses.map(function (k) {
        var due = Math.max(0, (k.total || 0) - (k.paid || 0));
        var st = { waiting: ['wait', 'À récupérer'], live: ['wait', 'En route'], arrived: ['ok', 'Arrivé'] }[k.status] || ['wait', 'À récupérer'];
        return h('section', { class: 'card course' },
          h('div', { class: 'brand-row' }, h('strong', null, k.shop + ' · N° ' + k.ref), h('span', { class: 'chip ' + st[0] }, st[1])),
          h('p', { class: 'wrapword' }, k.customer + ' · ' + k.dest + (k.locality ? ', ' + k.locality : '')),
          due ? h('p', { class: 'small' }, 'À encaisser : ', h('strong', null, fcfa(due))) : h('p', { class: 'small muted' }, 'Déjà payée'),
          h('div', { class: 'row' },
            iconBtn('a', { class: 'btn', href: '#/l/' + k.token }, 'nav', 'Ouvrir la course'),
            k.customer_phone ? iconBtn('a', { class: 'btn ghost', href: 'tel:' + k.customer_phone.replace(/\s/g, '') }, 'phone', 'Appeler le client') : null),
          h('button', { class: 'btn ghost small', type: 'button', style: 'align-self:flex-start', onclick: function (ev) {
            ev.currentTarget.disabled = true;
            api('fiila_courier_done', { p_key: courierKey(), p_send: k.token }).then(function () { track('courier_done', 'courier'); toast('Livraison confirmée.'); load(); },
              function (e) { toast(errText(e)); });
          } }, 'C’est livré'));
      }) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Aucune course pour l’instant. Gardez cette page ouverte : les nouvelles courses s’affichent toutes seules.')));
    }
    function load() {
      api('fiila_courier_me', { p_key: courierKey() }).then(function (n) {
        if (n.courses.length > seen) { try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* rien */ } toast('Nouvelle course.'); }
        seen = n.courses.length;
        document.title = (n.courses.length ? '(' + n.courses.length + ') ' : '') + 'Fii · Livreur';
        draw(n.courses);
      }, function () { /* hors ligne : on réessaie au prochain tour */ });
    }
    draw(r.courses);
    var pg = page(backBtn(),
      h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, 'Espace livreur'),
        h('h1', { class: 'wrapword' }, c.name),
        h('p', { class: 'small muted' }, [VEHICLES[c.vehicle], c.zone, r.done_today ? r.done_today + ' livrée' + (r.done_today > 1 ? 's' : '') + ' aujourd’hui' : null].filter(Boolean).join(' · '),
          c.reviews ? [' · ', ratingEl(c.rating, c.reviews)] : null)),
      segField({ name: 'cr-active', id: 'cr-active', value: c.active === false ? 'off' : 'on', options: [['on', 'Disponible'], ['off', 'Indisponible']], onChange: function (v) {
        api('fiila_courier_update', { p_key: courierKey(), p: { active: v === 'on' } }).then(function () { toast(v === 'on' ? 'Vous recevez les courses.' : 'Plus de nouvelles courses pour l’instant.'); }, function (e) { toast(errText(e)); });
      } }),
      h('h2', null, 'Mes courses'), list,
      r.shops.length ? h('p', { class: 'small muted' }, 'Livreur attitré de : ' + r.shops.map(function (s) { return s.name; }).join(', ') + '.')
        : h('p', { class: 'small muted' }, 'Aucune boutique pour l’instant. Demandez à la boutique de vous inviter.'),
      h('a', { class: 'btn link', id: 'courier-referral', href: '#/parrainer?pour=livreur', style: 'align-self:flex-start' }, 'Parrainer une boutique ou un livreur'),
      h('details', null, h('summary', null, 'Supprimer mon espace livreur'),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          h('p', { class: 'small' }, 'Vos boutiques ne pourront plus vous envoyer de courses.'),
          h('button', { class: 'btn danger', type: 'button', onclick: function () {
            api('fiila_courier_delete', { p_key: courierKey() }).then(function () { LS.del(COURIER_LS); toast('Espace livreur supprimé.'); go('#/'); }, function (e) { toast(errText(e)); });
          } }, 'Supprimer'))),
      footer());
    poll(pg, load, 20000);
    return pg;
  }
  function viewCourierInvite(token) {
    return api('fiila_courier_invite_get', { p_token: token }).then(function (r) {
      if (r.state !== 'ok') return page(stateCard(r.state === 'used' ? '✓' : '⌛', r.state === 'used' ? 'Invitation déjà acceptée' : 'Invitation expirée ou introuvable',
        r.state === 'used' ? 'Ouvrez votre espace livreur.' : 'Demandez une nouvelle invitation à la boutique.', h('a', { class: 'btn', href: '#/livreur' }, 'Espace livreur')), footer());
      var err = h('div', { role: 'alert' });
      function accept() {
        return api('fiila_courier_accept', { p_token: token, p_courier_key: courierKey() }).then(function () {
          track('courier_linked', 'invite'); toast('Vous êtes le livreur attitré de ' + r.shop + '.'); go('#/livreur');
        }, function (e) { errBox(err, e); });
      }
      var reg = courierKey();
      return page(
        inviteCard({ id: 'courier-invite-card', kind: 'Livreur attitré', from: r.shop, title: 'Devenez son livreur attitré',
          points: [['moto', 'Ses courses arrivent ici, automatiquement'], ['door', 'La photo de l’entrée, le bon repère'], ['nav', 'L’itinéraire en un geste']],
          cta: reg ? ivcBtn('button', { id: 'courier-accept', onclick: function (ev) { ev.currentTarget.disabled = true; accept(); } }, 'Accepter') : null,
          more: reg ? null : h('p', { class: 'ivc-note' }, 'Dernière étape : présentez-vous ci-dessous, puis acceptez.') }),
        reg ? null : courierForm({ name: r.name, phone: r.phone }, function () { accept(); }),
        err, footer());
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher l’invitation', errText(e), retryBtn())); });
  }
  // Note de la livraison par le client.
  function courierRateRow(token, cour) {
    var cur = cour.my_rating || 0;
    var box = h('div', { id: 'courier-rate' });
    function draw() {
      setKids(box,
        h('div', { class: 'rate-row' }, h('span', null, 'Livraison · ' + cour.name),
          h('span', { class: 'stars', role: 'radiogroup', 'aria-label': 'Note de la livraison' }, [1, 2, 3, 4, 5].map(function (n) {
            return h('button', { type: 'button', class: 'star' + (n <= cur ? ' on' : ''), role: 'radio', 'aria-checked': String(n === cur), 'aria-label': 'Livraison ' + n + ' sur 5',
              onclick: function () {
                api('fiila_courier_review', { p_token: token, p_rating: n }).then(function () { cur = n; draw(); track('courier_review', String(n)); toast('Merci pour votre note.'); },
                  function (e) { toast(errText(e)); });
              } }, icon('star', 28));
          }))));
    }
    draw();
    return box;
  }

  /* ----- facture vue par le client (lien partagé) */
  function viewInvoice(token, q) {
    return api('fiila_order_public', { p_token: token }).then(function (r) {
      if (r.state === 'cancelled') return page(stateCard('⦸', 'Commande annulée', 'La commande N° ' + r.ref + ' de ' + r.shop.name + ' a été annulée.'), footer());
      if (r.state !== 'ok') return page(stateCard('?', 'Commande introuvable', 'Vérifiez que le lien a été copié en entier.'), footer());
      track('invoice_opened', 'order');
      var o = r.order, s = r.shop;
      var remaining = Math.max(0, o.total - o.paid);
      var delivered = o.delivery_state === 'delivered';
      var stateText = delivered ? 'Livrée' : o.delivery_state === 'on_the_way' ? 'En route' : o.delivery_state === 'arrived' ? 'Livreur arrivé'
        : o.address_state === 'pending' ? 'Adresse attendue' : 'En préparation';
      var act = [];
      // Juste après une commande passée sur la vitrine : confirmation calme, puis l'étape suivante.
      if (q && q.nouvelle === '1') {
        var invUrl = invoiceUrl(token);
        act.push(h('section', { class: 'card highlight no-print', id: 'order-sent' },
          h('p', { class: 'saved-ok' }, icon('check', 18), 'Commande envoyée à ' + s.name + '.'),
          h('p', { class: 'small muted' }, o.address_state === 'pending' ? 'Dernière étape : donnez votre adresse de livraison.' : 'La boutique a votre commande.'),
          s.phone ? iconBtn('a', { class: 'btn ghost', id: 'notify-shop', href: waTo(s.phone, 'Bonjour, je viens de commander (N° ' + o.ref + ') : ' + invUrl), target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'Prévenir la boutique sur WhatsApp') : null));
      }
      if (q && q.nouvelle === '1' && o.address_state !== 'pending' && !shopKey() && !(ME && ME.shop)) {
        var at = afterTask('order', { icon: 'shop', title: 'Vous vendez aussi ?', cta: 'Ouvrir ma boutique gratuite', href: '#/boutique' });
        if (at) act.push(h('div', { class: 'no-print' }, at));
      }
      if (o.address_state === 'pending' && o.request_token && !delivered) {
        act.push(iconBtn('a', { class: 'btn big no-print', id: 'give-address-btn', href: '#/d/' + o.request_token + qs({ f: token }) }, 'pin', 'Donner mon adresse de livraison'));
      }
      if (o.watch_token) act.push(h('div', { class: 'no-print' }, deliveryWatch(o.watch_token, o.courier && o.courier.name)));
      // « Votre avis » : articles et livraison dans un seul bloc, une fois la commande livrée.
      var rateable = (o.items || []).filter(function (it) { return it.product_id; });
      var canCourier = o.courier && o.courier.can_rate;
      if (o.can_review && (rateable.length || canCourier)) act.push(reviewBox(token, rateable, s.name, canCourier ? o.courier : null));
      var pg = page(
        brandBar('Commande'),
        h('header', { class: 'stack tight no-print', id: 'order-head' },
          h('h1', { class: 'wrapword' }, s.name),
          h('div', { class: 'row', style: 'align-items:center;gap:10px' },
            h('span', { class: 'chip ' + (delivered ? 'ok' : 'wait') }, icon(delivered ? 'check' : 'clock', 12), stateText),
            h('span', { class: 'small muted' }, 'N° ' + o.ref + ' · ' + fcfa(o.total))),
          o.address_state === 'received' && !delivered ? h('p', { class: 'small muted', id: 'address-ok' }, 'Adresse reçue par la boutique.') : null),
        act,
        h('article', { class: 'card invoice', id: 'invoice' },
          h('header', { class: 'inv-head' },
            h('div', null, h('p', { class: 'eyebrow' }, 'Facture'), h('h2', { class: 'wrapword' }, s.name),
              s.phone ? h('p', { class: 'small muted' }, s.phone) : null),
            h('div', { class: 'inv-meta' }, h('strong', null, 'N° ' + o.ref), h('span', { class: 'small muted' }, shortDate(o.created_at)))),
          h('p', null, 'Client : ', h('strong', { class: 'wrapword' }, o.customer_name)),
          invoiceTable(o.items, o.total),
          o.paid ? h('div', { class: 'total-row' }, h('span', null, 'Déjà payé'), h('span', null, fcfa(o.paid))) : null,
          h('div', { class: 'total-row big' }, h('span', null, remaining ? 'Reste à payer' : 'Statut'), h('strong', { id: 'inv-remaining' }, remaining ? fcfa(remaining) : 'Payée')),
          o.note ? h('p', { class: 'small muted wrapword' }, o.note) : null),
        iconBtn('button', { class: 'btn ghost no-print', type: 'button', id: 'print', onclick: function () { window.print(); } }, 'print', 'Télécharger ou imprimer'),
        delivered && !shopKey() ? h('a', { class: 'btn link no-print', id: 'sell-too', href: '#/boutique', style: 'align-self:center' }, 'Vous vendez aussi sur WhatsApp ? Créez votre boutique') : null,
        delivered || (o.address_state === 'received' && q && q.nouvelle !== '1') ? h('div', { class: 'no-print' }, feedSection(2, { id: 'done-feed', title: 'D’autres boutiques' })) : null,
        footer(true));
      return pg;
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher la commande', errText(e), retryBtn())); });
  }

  /* ================================================================ FII CARRIÈRE : AMBASSADEURS
     Parcours : présentation → inscription (compte, charte) → 6 fiches → test (8/10) → validation par l'équipe → missions.
     Règle affichée partout : on est payé pour un commerçant actif, jamais pour une inscription. */
  // Les 6 fiches : une démonstration animée de l'écran, deux phrases simples, une chose à retenir.
  var AMB_LESSONS = [
    { t: 'Fii, c’est quoi ?', say: 'Une boutique en ligne gratuite pour le commerçant. Ses clientes voient ses articles, commandent, et il reçoit leur adresse exacte en une photo.', keep: 'Gratuit pour le commerçant, simple pour ses clientes.' },
    { t: 'On crée la boutique ensemble', say: 'Toujours sur le téléphone du commerçant, jamais sur le vôtre. Il choisit le nom et le type de commerce, puis tape votre code.', keep: 'Votre code va dans « Code agent », au plus tard 7 jours après.' },
    { t: 'Des photos qui donnent envie', say: 'L’article seul, à la lumière du jour, sur un fond simple. L’application recadre chaque photo au bon format.', keep: '5 articles avec photo : c’est le début du niveau 1.' },
    { t: 'On ouvre la vitrine', say: 'Dans les réglages, la vitrine passe à « Ouverte ». Le commerçant envoie le lien à ses clientes sur WhatsApp et dans son statut.', keep: 'Type de commerce + 5 photos + vitrine ouverte = niveau 1.' },
    { t: 'Les premières commandes', say: 'Montrez-lui « Nouvelle commande » et « Demander l’adresse ». Ensuite, ce sont ses vraies clientes qui commandent.', keep: 'Niveau 2 : 3 clientes différentes, dont 1 commande livrée, en 30 jours.' },
    { t: 'Ce qui ne se fait jamais', say: 'Commander soi-même ou par des proches, inventer une boutique, promettre des ventes, garder les numéros des clientes.', keep: 'Une fraude, et les gains sont annulés : exclusion du programme.' }];
  // Questions du test (l'ordre des réponses suit la correction gardée par le serveur, qui n'est jamais envoyée d'avance).
  var AMB_QUIZ = [
    ['Quand êtes-vous payé pour un commerçant ?', ['Dès qu’il crée sa boutique', 'Quand il atteint un niveau vérifié par Fii', 'Quand il vous paie']],
    ['Combien d’articles avec photo pour le niveau 1 ?', ['3', '5', '10']],
    ['Le niveau 2 demande :', ['3 commandes de 3 clientes différentes, dont 1 livrée', '1 commande', '10 visites de la vitrine']],
    ['Pouvez-vous passer des commandes vous-même pour l’aider ?', ['Oui, ça l’aide à démarrer', 'Non : elles ne comptent pas et peuvent vous faire exclure']],
    ['Où le commerçant tape-t-il votre code ?', ['Dans « Code agent », en créant sa boutique', 'Dans WhatsApp', 'Nulle part']],
    ['Une bonne photo d’article, c’est :', ['Prise de nuit, au flash', 'L’article seul, bien éclairé, fond simple', 'Avec le prix écrit à la main']],
    ['Que pouvez-vous promettre à un commerçant ?', ['Des ventes garanties', 'Ce que Fii offre vraiment : boutique, vitrine et adresses gratuites', 'Un prêt']],
    ['Vos gains sont versés :', ['Tout de suite', 'Après 30 jours de vérification, une fois par mois', 'Jamais']],
    ['Les numéros des clientes du commerçant :', ['Vous pouvez les garder', 'Restent confidentiels : vous ne les copiez pas', 'Vous pouvez les revendre']],
    ['Un commerçant arrête après une semaine :', ['Vous gardez les niveaux déjà validés, pas les suivants', 'Vous perdez tout', 'Vous êtes exclu']]];
  var GRADES = { ambassadeur: 'Agent', confirme: 'Agent confirmé', certifie: 'Agent certifié Fii' };
  var PAYOUT = { wave: 'Wave', orange_money: 'Orange Money' };

  // Le parcours en 5 étapes, l'étape en cours mise en avant (inscription → formation → test → validation → missions).
  var AMB_PATH = [['user', 'Inscription'], ['book', 'Formation'], ['check', 'Test'], ['clock', 'Validation'], ['star', 'Missions']];
  function ambPath(step) {
    return h('ol', { class: 'amb-path', id: 'amb-path', 'aria-label': 'Votre parcours : étape ' + (step + 1) + ' sur ' + AMB_PATH.length },
      AMB_PATH.map(function (x, k) {
        return h('li', { class: k < step ? 'done' : k === step ? 'now' : '', 'aria-current': k === step ? 'step' : null },
          h('span', { class: 'amb-path-dot', 'aria-hidden': 'true' }, icon(k < step ? 'check' : x[0] === 'book' ? 'edit' : x[0], 16)), h('span', { class: 'amb-path-l' }, x[1]));
      }));
  }

  // Portail Fii Carrière : connexion ou inscription sur place, retour direct à l'espace ambassadeur.
  function ambAccess() {
    var mode = 'signup', f = { name: '', email: '', password: '' };
    var root = h('section', { class: 'card stack', id: 'amb-access' });
    function draw() {
      var err = h('div', { role: 'alert' });
      var btn = h('button', { class: 'btn', type: 'submit', id: 'amb-auth-submit' }, mode === 'signup' ? 'Créer mon compte agent' : 'Me connecter');
      function submit(ev) {
        ev.preventDefault(); setKids(err);
        var email = f.email.trim().toLowerCase();
        if (mode === 'signup' && !f.name.trim()) return errBox(err, new ApiError('your_name_required'));
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errBox(err, new ApiError('email_address_invalid'));
        if (mode === 'signup' && f.password.length < 8) return errBox(err, new ApiError('weak_password'));
        if (mode === 'login' && !f.password) return errBox(err, new ApiError('invalid_credentials'));
        btn.disabled = true;
        (mode === 'signup' ? account.signUp(email, f.password, f.name.trim(), 'ambassador', '#/agent') : account.signIn(email, f.password)).then(function (r) {
          if (r && r.confirm) { emailCodeStep(root, 'signup', email, '#/agent'); return; }
          toast(mode === 'signup' ? 'Compte créé. Bienvenue dans Fii Carrière.' : 'Connecté.'); render();
        }, function (e) { btn.disabled = false; errBox(err, e); });
      }
      setKids(root,
        h('h2', null, 'Accès agent'),
        h('div', { class: 'tabs', role: 'tablist' },
          h('button', { type: 'button', role: 'tab', id: 'amb-tab-signup', 'aria-selected': String(mode === 'signup'), onclick: function () { mode = 'signup'; draw(); } }, 'Je commence'),
          h('button', { type: 'button', role: 'tab', id: 'amb-tab-login', 'aria-selected': String(mode === 'login'), onclick: function () { mode = 'login'; draw(); } }, 'Me connecter')),
        h('form', { class: 'stack', novalidate: true, onsubmit: submit },
          mode === 'signup' ? textField({ id: 'amb-acc-name', label: 'Nom complet', max: 60, value: f.name, autocomplete: 'name', onInput: function (v) { f.name = v; } }) : null,
          textField({ id: 'amb-acc-email', label: 'E-mail', type: 'email', inputmode: 'email', autocomplete: 'email', max: 254, value: f.email, onInput: function (v) { f.email = v; } }),
          passwordField('amb-acc-pass', 'Mot de passe', mode === 'signup' ? 'new-password' : 'current-password', function (v) { f.password = v; }),
          err, btn),
        mode === 'login' ? h('a', { class: 'btn link small', href: '#/compte' + qs({ mode: 'oubli', retour: 'ambassadeur' }), style: 'align-self:flex-start' }, 'Mot de passe oublié ?')
          : h('p', { class: 'hint' }, 'Votre compte porte vos gains et vos commerçants. Le même compte sert pour toute l’application.'));
    }
    draw();
    return root;
  }
  function viewAmbassador() {
    function hero(cta) {
      return inviteCard({ id: 'amb-hero', kind: 'Fii Carrière', title: 'Devenez agent Fii',
        sub: 'Aidez les commerçants de votre quartier à ouvrir leur boutique. Vous êtes payé quand ils vendent vraiment.',
        points: [['shop', 'Vous les installez sur leur téléphone, en 20 minutes'], ['cash', 'Payé à chaque niveau atteint par vos commerçants'], ['star', 'Trois grades : agent, confirmé, certifié']],
        cta: cta || null });
    }
    if (!authed()) {
      return page(backBtn(), hero(ivcBtn('a', { id: 'amb-login', href: '#amb-access', onclick: function (e) { e.preventDefault(); var el = document.getElementById('amb-access'); if (el) { el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); var i = el.querySelector('input'); if (i) setTimeout(function () { try { i.focus({ preventScroll: true }); } catch (x) { /* rien */ } }, 350); } } }, 'Accéder à mon espace')),
        ambAccess(), ambPath(0), ambLevels(null), footer());
    }
    var intro = hero(ivcBtn('a', { href: '#amb-form', id: 'amb-start', onclick: function (e) { e.preventDefault(); var el = document.getElementById('amb-form'); if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); } }, 'Commencer l’inscription'));
    return api('fiila_ambassador_me', {}).then(function (r) {
      var a = r.ambassador;
      if (!a) return ambRegister(intro);
      if (a.status === 'training') return a.quiz_passed ? ambWaiting(a) : ambTraining(a);
      if (a.status === 'review') return ambWaiting(a);
      if (a.status === 'excluded') return page(backBtn(), stateCard('⦸', 'Programme terminé', a.note ? 'Motif : ' + a.note : 'Votre participation au programme a pris fin.'), footer());
      return ambDashboard(a);
    }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger votre espace', errText(e), retryBtn()), footer()); });
  }
  // Les 3 niveaux et leur montant, en une carte simple.
  function ambLevels(amounts) {
    var m = amounts || [2000, 5000, 10000];
    var rows = [['1', 'Installé', 'Boutique, type de commerce, 5 articles avec photo, vitrine ouverte', '7 jours'],
      ['2', 'Actif', '3 commandes de 3 clientes différentes, dont 1 livrée', '30 jours'],
      ['3', 'Autonome', 'Toujours actif : des commandes 4 semaines sur 8', 'après 60 jours']];
    return h('section', { class: 'card stack tight', id: 'amb-levels' }, h('h2', null, 'Vos gains par commerçant'),
      h('ol', { class: 'amb-lv' }, rows.map(function (x, i) {
        return h('li', null, h('span', { class: 'amb-n' }, x[0]),
          h('span', { class: 'amb-lt' }, h('b', null, x[1] + ' · ' + fcfa(m[i])), h('span', { class: 'small muted' }, x[2] + ' (' + x[3] + ')')));
      })),
      h('p', { class: 'safe-line' }, icon('lock', 18), 'Payé pour un commerçant actif, jamais pour une inscription. Gains vérifiés 30 jours, versés chaque mois.'));
  }
  function ambRegister(intro) {
    var f = { name: '', phone: '', zone: '', method: 'wave', payout: '', charter: false };
    if (ME && ME.display_name) f.name = ME.display_name;
    if (ME && ME.phone) f.phone = ME.phone;
    // Profil pas encore chargé (première visite) : on remplit le nom et le numéro dès qu'il arrive, sans écraser une saisie.
    if (!ME) account.me().then(function (me) {
      if (!me) return;
      var n = document.getElementById('amb-name'), t = document.getElementById('amb-phone');
      if (n && !f.name && me.display_name) { f.name = me.display_name; n.value = me.display_name; }
      if (t && !f.phone && me.phone) { f.phone = me.phone; t.value = me.phone; }
    }, function () {});
    var err = h('div', { role: 'alert' });
    var btn = iconBtn('button', { class: 'btn big', type: 'button', id: 'amb-register', onclick: function () {
      setKids(err);
      if (!f.charter) return errBox(err, new ApiError('charter_required'));
      btn.disabled = true;
      api('fiila_ambassador_register', { p: { name: f.name.trim(), phone: f.phone.trim(), zone: f.zone.trim() || null, payout_method: f.method, payout_phone: f.payout.trim() || null, charter: true } })
        .then(function () {
          render();
          celebrate({ icon: 'user', kicker: 'Inscription réussie', title: 'Bienvenue, ' + (f.name.trim().split(/\s+/)[0] || 'agent'),
            sub: 'Six fiches courtes, puis un test de 10 questions. Comptez un quart d’heure.', cta: 'Commencer la formation' });
        }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, 'check', 'M’inscrire');
    return page(backBtn(), intro, ambPath(0), ambLevels(null),
      h('section', { class: 'card stack', id: 'amb-form' }, h('h2', null, 'Inscription'),
        textField({ id: 'amb-name', label: 'Nom complet', max: 60, value: f.name, onInput: function (v) { f.name = v; } }),
        textField({ id: 'amb-phone', label: 'Téléphone', type: 'tel', inputmode: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
        textField({ id: 'amb-zone', label: 'Quartier ou ville', optional: true, max: 60, value: f.zone, placeholder: 'Ex. : Yoff, Thiès', onInput: function (v) { f.zone = v; } }),
        segField({ name: 'amb-method', id: 'amb-method', legend: 'Recevoir mes gains par', value: f.method, options: [['wave', 'Wave'], ['orange_money', 'Orange Money']], onChange: function (v) { f.method = v; } }),
        textField({ id: 'amb-payout', label: 'Numéro de versement', optional: true, type: 'tel', inputmode: 'tel', value: f.payout, placeholder: 'Le même que ci-dessus si vide', onInput: function (v) { f.payout = v; } }),
        h('details', { class: 'more-details' }, h('summary', null, 'Lire la charte de l’agent'),
          h('ul', { class: 'small' },
            h('li', null, 'Je suis indépendant : je ne suis pas salarié de Fii.'),
            h('li', null, 'Je n’aide que de vrais commerçants, avec leur accord, sur leur propre téléphone.'),
            h('li', null, 'Je ne passe jamais de commande moi-même ou par mes proches pour atteindre un niveau.'),
            h('li', null, 'Je ne promets ni ventes ni argent au commerçant.'),
            h('li', null, 'Je garde confidentielles les informations du commerçant et de ses clientes.'),
            h('li', null, 'En cas de fraude : gains annulés et exclusion du programme.'))),
        h('label', { class: 'check-line' }, h('input', { type: 'checkbox', id: 'amb-charter', onchange: function (e) { f.charter = e.target.checked; } }), 'J’accepte la charte de l’agent'),
        err, btn),
      footer());
  }
  /* ----- Fii Carrière : démonstrations animées des fiches (un mini-écran qui montre le geste, en boucle).
     Chaque élément porte data-at : l'étape à laquelle il apparaît. Mouvement réduit : l'écran final, sans boucle. */
  function dmPop(at, kids, cls) { return h('div', { class: 'pop ' + (cls || ''), 'data-at': String(at) }, kids); }
  function ambDemo(i, code) {
    var screen, steps;
    if (i === 0) {
      steps = 5;
      var tones = ['#E9C8A8,#C98E62', '#BFD8C4,#6FA585', '#E7D9A4,#C4A243', '#D4C4E2,#9277B5', '#F1C5C0,#D47F76', '#C8D6E8,#6E8DB8'];
      screen = [h('div', { class: 'dm-h' }, 'Boutique Awa', h('span', { class: 'dm-chip' }, 'Ouverte')),
        h('div', { class: 'dm-grid' }, tones.map(function (c, k) {
          return dmPop(1 + Math.floor(k / 2), [h('div', { class: 'dm-img', style: 'background:linear-gradient(160deg,' + c + ')' }), h('i')], 'dm-tile');
        })),
        h('div', { class: 'dm-toast', 'data-at': '4' }, icon('pin', 16), h('span', null, 'Adresse reçue : Yoff, porte verte'))];
    } else if (i === 1) {
      steps = 7;
      screen = [h('div', { class: 'dm-h' }, 'Créer ma boutique'),
        h('div', { class: 'dm-field' }, h('small', null, 'Nom de la boutique'), h('span', { class: 'dm-in', 'data-at': '1', 'data-type': 'Boutique Awa' })),
        h('div', { class: 'dm-field' }, h('small', null, 'Type de commerce'), h('span', { class: 'dm-in', 'data-at': '3', 'data-type': 'Mode et beauté' })),
        h('div', { class: 'dm-field dm-hl', 'data-at': '4' }, h('small', null, 'Code agent ', h('em', null, 'votre code')), h('span', { class: 'dm-in', 'data-at': '4', 'data-type': code || 'K7M2QD' })),
        h('div', { class: 'dm-btn', 'data-at': '6' }, 'Créer la boutique')];
    } else if (i === 2) {
      steps = 9;
      screen = [h('div', { class: 'dm-h' }, 'Photo de l’article'),
        h('div', { class: 'dm-shots' },
          dmPop(1, [h('div', { class: 'dm-shot good' }, h('b', { class: 'dm-obj' }), h('span', { class: 'dm-mark ok' }, icon('check', 12))), h('small', null, 'Oui')]),
          dmPop(2, [h('div', { class: 'dm-shot flash' }, h('b', { class: 'dm-obj' }), h('span', { class: 'dm-mark no' }, '×')), h('small', null, 'Flash')]),
          dmPop(3, [h('div', { class: 'dm-shot busy' }, h('b', { class: 'dm-obj' }), h('span', { class: 'dm-mark no' }, '×')), h('small', null, 'Fond chargé')])),
        h('div', { class: 'dm-count' }, h('small', null, 'Articles avec photo'),
          h('div', { class: 'dm-dots' }, [4, 5, 6, 7, 8].map(function (n) { return h('i', { 'data-at': String(n) }); }))),
        dmPop(8, h('span', { class: 'dm-chip big' }, '5 sur 5'), 'dm-center')];
    } else if (i === 3) {
      steps = 6;
      screen = [h('div', { class: 'dm-h' }, 'Réglages'),
        h('div', { class: 'dm-row' }, h('span', null, 'Ma vitrine en ligne'),
          h('span', { class: 'dm-st', 'data-at': '1' }, h('small', { class: 'no' }, 'Fermée'), h('small', { class: 'yes' }, 'Ouverte'), h('span', { class: 'dm-sw' }))),
        h('div', { class: 'dm-chat' },
          dmPop(2, ['Ma boutique est en ligne ! Regardez :', h('span', { class: 'dm-link' }, icon('link', 12), 'Voir la vitrine')], 'dm-bub me'),
          dmPop(4, 'J’aime la robe bleue. Je commande !', 'dm-bub'),
          dmPop(5, 'Elle arrive demain à votre porte.', 'dm-bub me'))];
    } else if (i === 4) {
      steps = 7;
      var cl = [['F', 'Fatou', '8 500', '#C98E62'], ['A', 'Aminata', '12 000', '#6FA585'], ['K', 'Khady', '5 000', '#9277B5']];
      screen = [h('div', { class: 'dm-h' }, 'Commandes'),
        cl.map(function (c, k) {
          return dmPop(k + 1, [h('span', { class: 'dm-av', style: 'background:' + c[3] }, c[0]), h('span', { class: 'dm-on' }, h('b', null, c[1]), h('small', null, c[2] + ' FCFA')),
            k === 0 ? h('span', { class: 'dm-stat', 'data-at': '5' }, h('small', { class: 'no' }, 'En route'), h('small', { class: 'yes' }, 'Livrée')) : h('span', { class: 'dm-stat' }, h('small', { class: 'no' }, 'Nouvelle'))], 'dm-order');
        }),
        dmPop(6, [icon('star', 14), 'Niveau 2 atteint'], 'dm-badge')];
    } else {
      steps = 7;
      screen = [h('div', { class: 'dm-h' }, 'Jamais'),
        ['Commander soi-même', 'Une boutique inventée', 'Promettre des ventes', 'Garder les numéros'].map(function (x, k) {
          return h('div', { class: 'dm-ban', 'data-at': String(k + 1) }, h('span', null, x), h('b', { class: 'dm-x' }, '×'));
        }),
        dmPop(6, [icon('lock', 14), 'Payé pour un vrai commerçant actif'], 'dm-foot')];
    }
    var root = h('div', { class: 'dm', 'aria-hidden': 'true' }, h('div', { class: 'dm-phone' }, h('div', { class: 'dm-screen' }, screen)));
    ambDemoRun(root, steps);
    return root;
  }
  function ambDemoRun(root, steps) {
    var items = [].slice.call(root.querySelectorAll('[data-at]'));
    function typeIn(el, on) {
      var full = el.getAttribute('data-type'), n = 0;
      if (!on) { el.textContent = ''; return; }
      if (REDUCED) { el.textContent = full; return; }
      (function next() { if (!el.classList.contains('on')) return; el.textContent = full.slice(0, ++n); if (n < full.length) setTimeout(next, 75); })();
    }
    function set(s) {
      items.forEach(function (el) {
        var on = s >= Number(el.getAttribute('data-at'));
        if (el.classList.contains('on') === on) return;
        el.classList.toggle('on', on);
        if (el.hasAttribute('data-type')) typeIn(el, on);
      });
    }
    if (REDUCED) { set(steps); return; }
    var s = 0, seen = false, born = Date.now();
    var timer = setInterval(function () {
      if (!root.isConnected) { if (seen || Date.now() - born > 15000) clearInterval(timer); return; }
      seen = true; s = s >= steps + 3 ? 0 : s + 1; set(s);
    }, 850);
  }

  /* ----- chiffres qui montent, anneau de progression, confettis, carte de félicitations */
  function countUp(el, to, fmt) {
    fmt = fmt || String;
    if (REDUCED || !to) { el.textContent = fmt(to || 0); return el; }
    var t0 = null;
    el.textContent = fmt(0);
    requestAnimationFrame(function f(t) { if (!t0) t0 = t; var k = Math.min(1, (t - t0) / 1000); el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(f); });
    return el;
  }
  function svgEl(tag, attrs) { var el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in attrs) el.setAttribute(k, attrs[k]); return el; }
  function ring(value, max, size, label) {
    var r = (size - 12) / 2, c = 2 * Math.PI * r, k = max ? Math.min(1, value / max) : 0;
    var svg = svgEl('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, class: 'ring', role: 'img', 'aria-label': label || (value + ' sur ' + max) });
    svg.appendChild(svgEl('circle', { cx: size / 2, cy: size / 2, r: r, fill: 'none', 'stroke-width': 10, class: 'ring-bg' }));
    var fg = svgEl('circle', { cx: size / 2, cy: size / 2, r: r, fill: 'none', 'stroke-width': 10, 'stroke-linecap': 'round', class: 'ring-fg',
      'stroke-dasharray': c, 'stroke-dashoffset': REDUCED ? c * (1 - k) : c, transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')' });
    svg.appendChild(fg);
    var t = svgEl('text', { x: '50%', y: '50%', 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'ring-t', 'font-size': Math.round(size / 4.2) });
    t.textContent = value + '/' + max;
    svg.appendChild(t);
    if (!REDUCED) setTimeout(function () { fg.setAttribute('stroke-dashoffset', c * (1 - k)); }, 120);
    return svg;
  }
  function confetti(canvas) {
    if (REDUCED || !canvas.getContext) return;
    var ctx = canvas.getContext('2d'), W, H, dpr = Math.min(2, window.devicePixelRatio || 1), t0 = null;
    function size() { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    var colors = ['#CFE7A6', '#7ECC9A', '#F6F4EE', '#E8B95E', '#2E7D55', '#F1C5C0'];
    var ps = [];
    for (var i = 0; i < 150; i++) {
      var left = i % 2 === 0;
      ps.push({ x: left ? -10 : W + 10, y: H * (0.55 + Math.random() * 0.3), vx: (left ? 1 : -1) * (4 + Math.random() * 7), vy: -(9 + Math.random() * 9),
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], d: Math.random() * 300 });
    }
    requestAnimationFrame(function f(t) {
      if (!canvas.isConnected) return;
      if (!t0) t0 = t;
      var el = t - t0;
      ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        if (el < p.d) return;
        p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - el / 3600);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); ctx.restore();
      });
      if (el < 3600) requestAnimationFrame(f); else ctx.clearRect(0, 0, W, H);
    });
  }
  // Félicitations : carte en plein écran, confettis, une seule action. o : {icon, kicker, title, sub, gain, card, cta, onClose}
  function celebrate(o) {
    var prev = document.getElementById('cel'); if (prev) prev.remove();
    var back = document.activeElement, done = false;
    function close(silent) {
      if (done) return; done = true;
      window.removeEventListener('hashchange', onHash); document.removeEventListener('keydown', onKey);
      ov.classList.add('out');
      setTimeout(function () { ov.remove(); if (silent !== true && o.onClose) o.onClose(); else if (back && back.focus && back.isConnected) try { back.focus({ preventScroll: true }); } catch (e) { /* rien */ } }, REDUCED ? 0 : 200);
    }
    function onHash() { close(true); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    var btn = ivcBtn('button', { id: 'cel-close', onclick: function () { close(); } }, o.cta || 'Continuer');
    var canvas = h('canvas', { class: 'cel-fx', 'aria-hidden': 'true' });
    var inner = o.card
      ? h('div', { class: 'cel-inner' }, h('div', { class: 'cel-head' }, h('p', { class: 'cel-kicker' }, o.kicker), h('h2', { id: 'cel-t' }, o.title), o.sub ? h('p', null, o.sub) : null), o.card, btn)
      : h('div', { class: 'cel-inner' }, h('div', { class: 'ivc cel-card' },
          h('div', { class: 'ivc-glow', 'aria-hidden': 'true' }),
          h('div', { class: 'ivc-top' }, h('span', { class: 'logo ivc-brand', 'aria-hidden': 'true' }), h('span', { class: 'ivc-kind' }, o.kicker || 'Bravo')),
          h('div', { class: 'cel-badge', 'aria-hidden': 'true' }, h('span', null, icon(o.icon || 'star', 38))),
          h('h2', { class: 'ivc-title', id: 'cel-t' }, o.title),
          o.gain ? h('p', { class: 'cel-gain' }, o.gain) : null,
          o.sub ? h('p', { class: 'ivc-sub' }, o.sub) : null,
          h('div', { class: 'ivc-cta' }, btn)));
    var ov = h('div', { class: 'cel', id: 'cel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cel-t' }, canvas, inner);
    document.body.appendChild(ov);
    window.addEventListener('hashchange', onHash); document.addEventListener('keydown', onKey);
    try { btn.focus({ preventScroll: true }); } catch (e) { /* rien */ }
    confetti(canvas);
    return close;
  }

  // Carte ambassadeur : photo, nom, grade, code, et les chiffres qui comptent. opts.cta : bouton d'envoi du code.
  function ambAgentCard(a, opts) {
    opts = opts || {};
    var shops = a.shops || [];
    var ph = h('span', { class: 'agc-ph' }, avatarEl(ME, 66));
    var addPhoto = opts.cta && !(ME && ME.avatar) ? h('a', { class: 'agc-photo-link', href: '#/compte', id: 'amb-photo' }, 'Ajouter ma photo') : null;
    if (!ME) account.me().then(function (me) { if (me) { setKids(ph, avatarEl(me, 66)); if (me.avatar && addPhoto) addPhoto.remove(); } }, function () {});
    var stat = function (n, label, fmt) { return h('div', null, countUp(h('b'), n, fmt), h('small', null, label)); };
    return h('section', { class: 'ivc agc', id: opts.id || null },
      h('div', { class: 'ivc-glow', 'aria-hidden': 'true' }),
      h('div', { class: 'ivc-top' }, h('span', { class: 'logo ivc-brand', 'aria-hidden': 'true' }), h('span', { class: 'ivc-kind' }, 'Carte agent')),
      h('div', { class: 'agc-id' }, ph,
        h('div', { class: 'agc-who' }, h('strong', { class: 'wrapword' }, a.name),
          h('span', { class: 'agc-grade', id: opts.cta ? 'amb-grade' : null }, icon('star', 12), GRADES[a.grade] || 'Agent'),
          a.zone ? h('span', { class: 'agc-zone' }, a.zone) : null, addPhoto)),
      h('div', { class: 'agc-code' }, h('small', null, 'Code agent'), h('p', { class: 'amb-codev2' }, a.code)),
      h('div', { class: 'agc-stats' },
        stat(shops.length, 'commerçants'),
        stat(shops.filter(function (s) { return s.level >= 2; }).length, 'actifs'),
        stat((a.rewards && a.rewards.paid) || 0, 'FCFA reçus', function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); })),
      opts.cta || null);
  }

  // Moments à fêter depuis la dernière visite : profil validé, nouveau grade, commerçant qui passe un niveau, versement reçu.
  var GRADE_RANK = { ambassadeur: 0, confirme: 1, certifie: 2 };
  function ambMoments(a) {
    var key = 'fiila.amb.seen.' + a.code, seen = null;
    try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { seen = null; }
    var hist = (a.history || []).filter(function (x) { return x.status !== 'cancelled'; });
    var now = { active: true, grade: a.grade, paid: (a.rewards && a.rewards.paid) || 0, levels: hist.map(function (x) { return x.shop + '|' + x.level; }) };
    // Première visite sur ce téléphone : on fête la validation, pas l'historique déjà connu.
    if (!seen || typeof seen !== 'object') seen = { active: false, grade: now.grade, paid: now.paid, levels: now.levels };
    var q = [];
    if (!seen.active) q.push({ kind: 'validated' });
    if ((GRADE_RANK[now.grade] || 0) > (GRADE_RANK[seen.grade] || 0)) q.push({ kind: 'grade' });
    hist.filter(function (x) { return (seen.levels || []).indexOf(x.shop + '|' + x.level) < 0; }).reverse().forEach(function (x) { q.push({ kind: 'level', x: x }); });
    if (now.paid > (seen.paid || 0)) q.push({ kind: 'paid', amount: now.paid - (seen.paid || 0) });
    try { localStorage.setItem(key, JSON.stringify(now)); } catch (e) { /* rien */ }
    return q.slice(0, 4);
  }
  function ambCelebrate(a, q) {
    var hash = location.hash;
    (function next() {
      var m = q.shift();
      if (!m || location.hash !== hash) return;
      var o = { onClose: function () { setTimeout(next, 250); } };
      if (m.kind === 'validated') Object.assign(o, { kicker: 'Profil validé', title: 'Bienvenue dans l’équipe Fii', sub: 'Voici votre carte. Envoyez votre code au premier commerçant.',
        card: ambAgentCard(a, {}), cta: 'Ouvrir mon tableau de bord' });
      else if (m.kind === 'grade') Object.assign(o, { icon: 'star', kicker: 'Nouveau grade', title: GRADES[a.grade], sub: 'Vos commerçants actifs vous ont fait monter d’un grade. Bravo.' });
      else if (m.kind === 'level') Object.assign(o, { icon: 'shop', kicker: 'Niveau ' + m.x.level + ' atteint', title: m.x.shop + ' passe au niveau ' + m.x.level, gain: '+ ' + fcfa(m.x.amount),
        sub: 'Gain en vérification pendant 30 jours, puis versé avec le mois.' });
      else Object.assign(o, { icon: 'cash', kicker: 'Versement reçu', title: fcfa(m.amount) + ' versés', sub: 'Sur ' + (PAYOUT[a.payout_method] || '') + ' ' + a.payout_phone + '. Merci pour votre travail.' });
      celebrate(o);
    })();
  }

  function ambTraining(a) {
    var root = h('div', { class: 'stack' });
    var i = 0;
    function lesson() {
      var l = AMB_LESSONS[i];
      var last = i === AMB_LESSONS.length - 1;
      setKids(root,
        ambPath(1),
        h('section', { class: 'ivc amb-lesson-card', id: 'amb-lesson', 'aria-live': 'polite' },
          h('div', { class: 'ivc-glow', 'aria-hidden': 'true' }),
          h('div', { class: 'ivc-top' }, h('span', { class: 'ivc-kind', style: 'text-align:left' }, 'Formation · ' + (i + 1) + ' sur ' + AMB_LESSONS.length),
            h('span', { class: 'logo ivc-brand', 'aria-hidden': 'true' })),
          h('div', { class: 'amb-prog', 'aria-hidden': 'true' }, AMB_LESSONS.map(function (x, k) { return h('i', { class: k < i ? 'on' : k === i ? 'now' : '' }); })),
          ambDemo(i, a.code),
          h('h2', { class: 'ivc-title' }, l.t),
          h('p', { class: 'ivc-sub amb-ltext' }, l.say),
          h('p', { class: 'amb-keep' }, icon('star', 16), h('span', null, h('b', null, 'À retenir : '), l.keep)),
          h('div', { class: 'ivc-cta' }, ivcBtn('button', { id: 'amb-next', onclick: function () { if (!last) { i++; lesson(); } else quiz(); window.scrollTo(0, 0); } },
            last ? 'Passer le test' : 'Fiche suivante')),
          i > 0 ? h('button', { class: 'ivc-link', type: 'button', style: 'background:none;border:0;font:inherit;cursor:pointer', onclick: function () { i--; lesson(); } }, 'Fiche précédente') : null));
    }
    // Test : une question par écran, « Vérifier », la correction tout de suite, puis « Continuer ».
    var GOOD_FB = ['Exactement.', 'Bien vu.', 'C’est ça.', 'Parfait.', 'Juste.'];
    var BAD_FB = ['Pas tout à fait.', 'Presque.', 'Ce n’est pas ça.'];
    function quiz() {
      var run = null, q = 0, picked = null, streak = 0, res = {}, attempts = 0;
      setKids(root, h('div', { class: 'qz-load', role: 'status' }, 'Préparation du test…'));
      api('fiila_ambassador_quiz_start', {}).then(function (r) {
        run = r.run; attempts = r.attempts_today || 0;
        (r.answered || []).forEach(function (x) { res[x.q] = x; });
        q = 0; while (res[q] && q < 9) q++;
        draw();
      }, function (e) {
        setKids(root, stateCard(e && e.code === 'quiz_wait' ? '⌛' : '!', e && e.code === 'quiz_wait' ? 'Deux essais par jour' : 'Test indisponible', errText(e),
          h('button', { class: 'btn', type: 'button', onclick: function () { i = 0; lesson(); } }, 'Relire les fiches')));
      });
      function answeredCount() { return Object.keys(res).length; }
      function draw() {
        picked = null;
        var item = AMB_QUIZ[q];
        var bar = h('i', { style: 'width:' + (answeredCount() * 10) + '%' });
        var check = h('button', { class: 'qz-cta', type: 'button', id: 'qz-check', disabled: true, onclick: verify }, 'Vérifier');
        var foot = h('div', { class: 'qz-foot', id: 'qz-foot' }, h('div', { class: 'qz-foot-in' }, check));
        var tiles = item[1].map(function (opt, k) {
          return h('button', { type: 'button', class: 'qz-opt', id: 'qz-opt-' + k, role: 'radio', 'aria-checked': 'false', onclick: function () {
            if (check.hasAttribute('data-done')) return;
            picked = k;
            tiles.forEach(function (t, n) { t.setAttribute('aria-checked', String(n === k)); });
            check.disabled = false;
          } }, h('span', { class: 'qz-key', 'aria-hidden': 'true' }, 'ABCD'.charAt(k)), h('span', null, opt));
        });
        function verify() {
          if (picked === null) return;
          check.disabled = true; check.setAttribute('data-done', '');
          tiles.forEach(function (t) { t.disabled = true; });
          api('fiila_ambassador_quiz_answer', { p_run: run, p_q: q, p_answer: picked }).then(function (r) {
            res[q] = r;
            streak = r.correct ? streak + 1 : 0;
            bar.style.width = (answeredCount() * 10) + '%';
            if (tiles[r.right]) tiles[r.right].classList.add('right');
            if (!r.correct && tiles[r.answer]) tiles[r.answer].classList.add('wrong');
            var nextBtn = h('button', { class: 'qz-cta', type: 'button', id: 'qz-next', onclick: function () {
              if (r.done) return finish(r);
              q = q + 1; while (res[q] && q < 9) q++;
              draw(); window.scrollTo(0, 0);
            } }, r.done ? 'Voir mon résultat' : 'Continuer');
            foot.className = 'qz-foot ' + (r.correct ? 'good' : 'bad');
            setKids(foot, h('div', { class: 'qz-foot-in' },
              h('div', { class: 'qz-fb', role: 'status' },
                h('span', { class: 'qz-fb-ic', 'aria-hidden': 'true' }, r.correct ? icon('check', 22) : icon('close', 20)),
                h('div', null, h('h2', null, (r.correct ? GOOD_FB : BAD_FB)[q % (r.correct ? GOOD_FB.length : BAD_FB.length)]),
                  h('p', null, r.why))),
              nextBtn));
            try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* rien */ }
          }, function (e) {
            check.disabled = false; check.removeAttribute('data-done');
            tiles.forEach(function (t) { t.disabled = false; });
            toast(errText(e));
          });
        }
        setKids(root, h('section', { class: 'qz', id: 'qz' },
          h('div', { class: 'qz-top' },
            h('button', { class: 'qz-quit', type: 'button', 'aria-label': 'Quitter le test et revoir les fiches', onclick: function () { i = 0; lesson(); window.scrollTo(0, 0); } }, icon('close', 18)),
            h('div', { class: 'qz-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '10', 'aria-valuenow': String(answeredCount()), 'aria-label': 'Questions répondues' }, bar),
            streak >= 2 ? h('span', { class: 'qz-streak', title: 'Bonnes réponses d’affilée' }, icon('star', 14), String(streak)) : null),
          h('p', { class: 'qz-n' }, 'Question ' + (q + 1) + ' sur 10'),
          h('h1', { class: 'qz-q', id: 'qz-q' }, item[0]),
          h('div', { class: 'qz-opts', role: 'radiogroup', 'aria-labelledby': 'qz-q' }, tiles),
          foot));
      }
      function finish(r) {
        if (r.passed) {
          render();
          celebrate({ icon: 'check', kicker: 'Test réussi', title: 'Test réussi : ' + r.score + '/10', sub: 'Bravo ! L’équipe Fii valide votre profil, en général sous 48 heures. Vous recevrez alors votre carte et votre code.', cta: 'Continuer' });
          return;
        }
        var missed = Object.keys(res).map(Number).filter(function (n) { return !res[n].correct; }).sort(function (x, y) { return x - y; });
        var left = Math.max(0, 2 - (attempts + 1));
        setKids(root, h('section', { class: 'card stack qz-res', id: 'qz-result' },
          ring(r.score, 10, 132, 'Score : ' + r.score + ' sur 10'),
          h('h1', null, 'Score : ' + r.score + '/10'),
          h('p', { class: 'muted' }, 'Il faut 8 bonnes réponses. ' + (left ? 'Relisez les fiches, il vous reste ' + left + ' essai aujourd’hui.' : 'Relisez les fiches : prochain essai demain.')),
          missed.length ? h('details', { class: 'more-details' }, h('summary', null, 'Revoir mes erreurs (' + missed.length + ')'),
            h('ul', { class: 'qz-miss' }, missed.map(function (n) { return h('li', null, h('b', null, AMB_QUIZ[n][0]), h('span', null, res[n].why)); }))) : null,
          h('button', { class: 'btn big', type: 'button', id: 'qz-reread', onclick: function () { i = 0; lesson(); window.scrollTo(0, 0); } }, 'Relire les fiches')));
      }
    }
    lesson();
    return page(backBtn(), root, footer());
  }
  function ambWaiting(a) {
    return page(backBtn(), ambPath(3),
      inviteCard({ id: 'amb-waiting', kind: 'Fii Carrière', title: 'Test réussi : ' + (a.quiz_score || 8) + '/10',
        sub: 'L’équipe Fii valide votre profil, en général sous 48 heures. Vous recevrez alors votre carte agent et votre code.',
        points: [['key', 'Votre code : ' + a.code + ' (actif après la validation)'], ['shop', 'Repérez déjà 3 commerçants de votre quartier'], ['cam', 'Préparez-les : 5 articles à photographier']] }),
      ambManagerCard(a),
      footer());
  }
  /* ----- Manager Fii Carrière : missions du jour, cap du mois, conversation (réponse sans IA immédiate ; avec IA, la fonction
     fiila-manager rédige ; si elle ne répond pas, la base répond à la lecture suivante, une minute après). */
  function ambManagerCall(id) {
    if (!API_URL || !SESSION || !SESSION.access_token) return Promise.reject(new Error('offline'));
    return freshToken().then(function () {
      return fetch(API_URL + '/functions/v1/fiila-manager', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ action: 'reply', message: id }) });
    }).then(function (r) { if (!r.ok) throw new Error('manager ' + r.status); return r.json(); });
  }
  function ambMgrAv(size) { return h('span', { class: 'mgr-av', style: size ? 'width:' + size + 'px;height:' + size + 'px' : null, 'aria-hidden': 'true' }, icon('star', Math.round((size || 40) * 0.45))); }
  function ambChat(onClose) {
    var list = h('div', { class: 'mgr-thread', id: 'mgr-thread', 'aria-live': 'polite' }, h('p', { class: 'mgr-sys' }, 'Chargement…'));
    var input = h('textarea', { id: 'mgr-input', rows: 1, maxlength: 1000, placeholder: 'Écrire à votre Manager…', 'aria-label': 'Votre message' });
    var send = h('button', { class: 'mgr-send', type: 'button', id: 'mgr-send', 'aria-label': 'Envoyer', disabled: true }, icon('send', 20));
    var typing = false, retry = null;
    var SUGG = ['Comment convaincre un commerçant ?', 'Quand suis-je payé ?', 'J’ai un problème dans l’application'];
    function bubble(m) {
      return h('div', { class: 'mgr-msg ' + (m.author === 'agent' ? 'me' : m.author) },
        m.author === 'staff' ? h('small', null, 'Équipe Fii') : null, h('p', null, m.body),
        h('time', null, (m.channel === 'whatsapp' ? 'via WhatsApp · ' : '') + (m.at ? new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '')));
    }
    function draw(msgs) {
      var waiting = msgs.length && msgs[msgs.length - 1].author === 'agent';
      setKids(list, msgs.map(bubble), (typing || waiting) ? h('div', { class: 'mgr-msg manager typing', 'aria-label': 'Le Manager écrit' }, h('i'), h('i'), h('i')) : null,
        msgs.length <= 1 ? h('div', { class: 'mgr-sugg' }, SUGG.map(function (x) { return h('button', { type: 'button', class: 'opt', onclick: function () { input.value = x; send.disabled = false; post(); } }, x); })) : null);
      list.scrollTop = list.scrollHeight;
      clearTimeout(retry);
      if (waiting && back.isConnected) retry = setTimeout(load, 65000);
    }
    function load() { return api('fiila_amb_messages', {}).then(draw, function (e) { setKids(list, h('p', { class: 'mgr-sys' }, errText(e))); }); }
    function post() {
      var body = input.value.trim();
      if (!body || send.disabled) return;
      send.disabled = true; input.value = ''; typing = true;
      list.insertBefore(bubble({ author: 'agent', body: body, at: new Date().toISOString() }), list.querySelector('.mgr-sugg') || null);
      list.scrollTop = list.scrollHeight;
      api('fiila_amb_message_send', { p_body: body }).then(function (r) {
        if (!r.pending) { typing = false; return load(); }
        return ambManagerCall(r.id).then(function () { typing = false; return load(); }, function () { typing = false; return load(); });
      }, function (e) { typing = false; toast(errText(e)); input.value = body; load(); });
    }
    input.addEventListener('input', function () { send.disabled = !input.value.trim(); input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } });
    send.addEventListener('click', post);
    var back = h('div', { class: 'sheet-back', id: 'mgr-chat', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mgr-h' },
      h('div', { class: 'sheet mgr-sheet' },
        h('header', { class: 'mgr-head' }, ambMgrAv(40), h('div', { class: 'stack tight', style: 'gap:0;flex:1' }, h('b', { id: 'mgr-h' }, 'Votre Manager'), h('small', { class: 'muted' }, 'Fii Carrière · répond tout de suite')),
          h('button', { class: 'qz-quit', type: 'button', 'aria-label': 'Fermer', id: 'mgr-close', onclick: function () { close(); } }, icon('close', 18))),
        list, h('div', { class: 'mgr-compose' }, input, send)));
    var close = openSheet(back, { onClose: function () { clearTimeout(retry); if (onClose) onClose(); } });
    load();
  }
  function ambManagerCard(a, compact) {
    var box = h('section', { class: 'card mgr-card', id: 'amb-manager' }, h('div', { class: 'bo-skel', style: 'border:0;padding:0' }, h('div', { class: 'bo-skel-row' }, h('i', { class: 'av' }), h('i', { class: 'l1' }))));
    function draw(d) {
      var done = d.tasks.filter(function (t) { return t.done; }).length;
      var unread = h('span', { class: 'mgr-badge', hidden: !d.unread }, String(d.unread || ''));
      setKids(box,
        h('div', { class: 'mgr-top' }, ambMgrAv(44),
          h('div', { class: 'stack tight', style: 'gap:0;flex:1;min-width:0' }, h('p', { class: 'eyebrow' }, 'Votre Manager'), h('h2', null, done === d.tasks.length && d.tasks.length ? 'Missions du jour faites. Bravo !' : 'Vos missions du jour')),
          d.tasks.length ? ring(done, d.tasks.length, 52, done + ' missions faites sur ' + d.tasks.length) : null),
        d.objective && d.objective.brief ? h('p', { class: 'mgr-brief' }, icon('flag', 14), h('span', null, h('b', null, 'Cap du mois : '), d.objective.brief)) : null,
        h('ul', { class: 'mgr-tasks' }, d.tasks.map(function (t) {
          return h('li', { class: t.done ? 'done' : '' },
            h('button', { type: 'button', class: 'mgr-check', 'aria-pressed': String(!!t.done), 'aria-label': (t.done ? 'Faite : ' : 'Marquer comme faite : ') + t.title, disabled: t.done || null, onclick: function () { finish(t); } }, t.done ? icon('check', 14) : null),
            h('div', { class: 'stack tight', style: 'gap:2px;min-width:0' }, h('b', { class: 'wrapword' }, t.title), t.body ? h('span', { class: 'small muted' }, t.body) : null));
        })),
        h('div', { class: 'mgr-foot' },
          d.streak ? h('span', { class: 'small muted' }, icon('star', 12), ' ' + d.streak + ' jour' + (d.streak > 1 ? 's' : '') + ' actif' + (d.streak > 1 ? 's' : '') + ' ce mois-ci') : h('span'),
          h('div', { class: 'row', style: 'gap:8px' },
            h('button', { class: 'btn ghost small', type: 'button', id: 'amb-chat-open', onclick: function () { ambChat(load); } }, icon('chat', 16), ' Écrire à mon Manager', unread),
            d.whatsapp ? h('a', { class: 'btn ghost small mgr-wa', id: 'amb-wa', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Écrire à mon Manager sur WhatsApp',
              href: 'https://wa.me/' + d.whatsapp + '?text=' + encodeURIComponent('Bonjour, c’est ' + String(a.name || '').split(' ')[0] + ' (agent, code ' + a.code + ').') }, icon('phone', 16), ' WhatsApp') : null)));
    }
    function finish(t) {
      var fb = h('textarea', { id: 'mgr-feedback', rows: 3, maxlength: 500, placeholder: 'Facultatif : ce qui s’est passé, ce qui a bloqué, une idée…' });
      var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mgr-done-h', id: 'mgr-done' },
        h('div', { class: 'sheet stack' }, h('h2', { id: 'mgr-done-h' }, 'Mission faite'), h('p', { class: 'small muted wrapword' }, t.title),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Un retour du terrain ?'), fb),
          h('button', { class: 'btn', type: 'button', id: 'mgr-done-ok', onclick: function () {
            this.disabled = true;
            api('fiila_amb_task_done', { p_id: t.id, p_feedback: fb.value.trim() || null }).then(function (r) {
              close(); toast(r.left ? 'Bien joué. Encore ' + r.left + ' mission' + (r.left > 1 ? 's' : '') + ' aujourd’hui.' : 'Toutes vos missions du jour sont faites. Bravo !'); load();
            }, function (e) { toast(errText(e)); close(); });
          } }, 'Valider'),
          h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler')));
      var close = openSheet(back);
    }
    function load() { return api('fiila_amb_today', {}).then(draw, function () { box.hidden = true; }); }
    load();
    return box;
  }
  function ambDashboard(a) {
    var codeMsg = 'Bonjour ! Je vous aide à ouvrir votre boutique en ligne gratuite avec Fii : vitrine, commandes, factures et l’adresse exacte de vos clientes. ' +
      'Ouvrez ' + baseUrl() + '#/boutique et, à « Code agent », tapez : ' + a.code;
    var shops = a.shops || [];
    var amounts = a.amounts || [2000, 5000, 10000];
    var next = a.grade === 'ambassadeur' ? ['Agent confirmé', a.l2 || 0, 10, 'commerçants actifs (niveau 2)']
      : a.grade === 'confirme' ? ['Agent certifié Fii', a.l3 || 0, 25, 'commerçants autonomes (niveau 3)'] : null;
    function todoList(s) {
      return s.level === 0 ? [['Type de commerce choisi', !!s.typed], [s.photos >= 5 ? '5 articles avec photo' : (5 - (s.photos || 0)) + ' article(s) avec photo à ajouter', s.photos >= 5], ['Vitrine ouverte', !!s.public]]
        : s.level === 1 ? [[s.clients >= 3 ? '3 clientes différentes' : (3 - (s.clients || 0)) + ' cliente(s) de plus', s.clients >= 3], ['1 commande livrée', !!s.delivered]]
        : s.level === 2 ? [['Des commandes 4 semaines sur 8 (' + Math.min(4, s.active_weeks || 0) + ' sur 4)', (s.active_weeks || 0) >= 4]] : [];
    }
    function shopCard(s) {
      var todo = todoList(s), doneN = todo.filter(function (x) { return x[1]; }).length;
      return h('article', { class: 'card shp' },
        h('div', { class: 'shp-head' }, h('span', { class: 'shp-av', 'aria-hidden': 'true' }, String(s.shop || '?').trim().charAt(0).toUpperCase()),
          h('div', { class: 'stack tight', style: 'flex:1;min-width:0' }, h('b', { class: 'wrapword' }, s.shop),
            h('span', { class: 'small muted' }, s.expired ? 'Délai dépassé pour le niveau suivant' : s.level === 3 ? 'Tous les niveaux atteints' : 'Niveau ' + s.level + ' sur 3')),
          s.level < 3 && !s.expired ? h('span', { class: 'shp-gain' }, '+ ' + fcfa(amounts[s.level])) : null),
        h('div', { class: 'shp-track', 'aria-label': 'Niveau ' + s.level + ' sur 3' }, ['Installé', 'Actif', 'Autonome'].map(function (n, k) {
          var on = k < s.level, now = k === s.level && !s.expired;
          return h('div', { class: 'shp-step' + (on ? ' on' : now ? ' now' : '') }, h('i', null, now && todo.length ? h('b', { style: 'width:' + Math.round(doneN / todo.length * 100) + '%' }) : null), h('span', null, n));
        })),
        todo.length && !s.expired ? h('ul', { class: 'shp-todo' }, todo.map(function (x) {
          return h('li', { class: x[1] ? 'ok' : '' }, h('span', { class: 'ck', 'aria-hidden': 'true' }, x[1] ? icon('check', 12) : null), h('span', null, x[0]));
        })) : null);
    }
    var board = h('section', { class: 'card stack tight', id: 'amb-board', hidden: true });
    api('fiila_ambassador_board', {}).then(function (l) {
      if (!l.length) return;
      var top = l.slice(0, 3), rest = l.slice(3);
      var order = [top[1], top[0], top[2]];
      setKids(board, h('h2', null, 'Classement (90 jours)'),
        h('div', { class: 'pod' }, order.map(function (x, k) {
          if (!x) return h('div');
          var p = k === 1 ? 1 : k === 0 ? 2 : 3;
          return h('div', { class: 'pod-c p' + p }, h('span', { class: 'pod-av' }, String(x.name || '?').charAt(0).toUpperCase()),
            h('span', { class: 'pod-name' }, x.name), x.zone ? h('span', { class: 'pod-s' }, x.zone) : null,
            h('div', { class: 'pod-blk' }, h('span', null, String(p)), h('small', null, x.score + ' pts')));
        })),
        rest.length ? h('ol', { class: 'amb-board', start: '4' }, rest.map(function (x) {
          return h('li', null, h('b', null, x.name), x.zone ? h('span', { class: 'small muted' }, ' · ' + x.zone) : null, h('span', { class: 'amb-score' }, x.score));
        })) : null);
      board.hidden = false;
    }, function () {});
    // La prochaine action utile, en une carte : premier commerçant à trouver, ou ce qui manque au plus avancé.
    // Portefeuille : le total gagné qui monte, une barre en trois couleurs, la légende.
    var rw = a.rewards || { pending: 0, validated: 0, paid: 0 };
    var total = rw.pending + rw.validated + rw.paid;
    var segs = [['paid', 'Déjà reçu', rw.paid], ['ok2', 'À verser', rw.validated], ['wait', 'En vérification', rw.pending]];
    var bars = segs.map(function (x) { return h('i', { class: x[0], style: 'width:0' }); });
    if (total) setTimeout(function () { bars.forEach(function (b, k) { b.style.width = (segs[k][2] / total * 100) + '%'; }); }, REDUCED ? 0 : 150);
    var wallet = h('section', { class: 'card stack', id: 'amb-wallet' },
      h('h2', null, 'Mes gains'),
      h('div', { class: 'wal-total' }, countUp(h('b'), total, fcfa), h('span', null, 'gagnés au total')),
      total ? h('div', { class: 'wal-bar', 'aria-hidden': 'true' }, bars) : h('p', { class: 'small muted' }, 'Votre premier gain arrive quand votre premier commerçant atteint le niveau 1 : ' + fcfa(amounts[0]) + '.'),
      h('ul', { class: 'wal-leg' }, segs.map(function (x) { return h('li', null, h('span', { class: 'dot ' + x[0], 'aria-hidden': 'true' }), h('span', null, x[1]), h('b', null, fcfa(x[2]))); })),
      h('p', { class: 'small muted' }, 'Versements une fois par mois sur ' + (PAYOUT[a.payout_method] || '') + ' ' + a.payout_phone + '.'),
      (a.history || []).length ? h('details', { class: 'more-details' }, h('summary', null, 'Historique'),
        h('div', { class: 'stack tight' }, a.history.map(function (x) {
          var st = { pending: 'en vérification jusqu’au ' + shortDate(x.validate_after), validated: 'à verser', paid: 'versé', cancelled: 'annulé' + (x.reason ? ' : ' + x.reason : '') }[x.status];
          return h('div', { class: 'total-row' }, h('span', { class: 'wrapword' }, x.shop + ' · niveau ' + x.level + ' · ' + st), h('span', null, fcfa(x.amount)));
        }))) : null);
    var moments = ambMoments(a);
    if (moments.length) setTimeout(function () { ambCelebrate(a, moments); }, REDUCED ? 50 : 500);
    return page(backBtn(),
      h('h1', null, 'Mon espace agent'),
      a.status === 'suspended' ? h('div', { class: 'notice' }, 'Compte suspendu : vos nouveaux gains sont en pause.' + (a.note ? ' Motif : ' + a.note : '')) : null,
      ambAgentCard(a, { id: 'amb-code', cta: h('div', { class: 'stack tight' },
        h('div', { class: 'ivc-cta' }, ivcBtn('a', { href: waLink(codeMsg), target: '_blank', rel: 'noopener noreferrer', id: 'amb-send' }, 'Envoyer mon code')),
        h('button', { class: 'ivc-link', type: 'button', style: 'background:none;border:0;font:inherit;cursor:pointer', onclick: function () { copy(a.code, 'Code'); } }, 'Copier le code')) }),
      ambManagerCard(a),
      wallet,
      next ? h('section', { class: 'card grd', id: 'amb-next-grade' }, ring(Math.min(next[1], next[2]), next[2], 92, next[1] + ' sur ' + next[2]),
        h('div', { class: 'stack tight' }, h('p', { class: 'eyebrow' }, 'Prochain grade'), h('h2', null, next[0]),
          h('p', { class: 'small muted' }, next[1] >= next[2] ? 'Objectif atteint : le grade arrive à la prochaine mise à jour.' : 'Encore ' + (next[2] - next[1]) + ' ' + next[3] + '.'))) : null,
      h('section', { class: 'stack tight', id: 'amb-shops' }, h('h2', null, 'Mes commerçants (' + shops.length + ')'),
        shops.length ? h('div', { class: 'stack tight' }, shops.map(shopCard))
          : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Aucun commerçant pour l’instant. Envoyez votre code au premier !'))),
      board,
      h('details', { class: 'card more-sec' }, h('summary', null, 'Comment je suis payé'), ambLevels(a.amounts)),
      footer());
  }
  // Boutique : rattacher son ambassadeur (7 jours au plus après la création).
  function ambassadorShopBox() {
    var box = h('section', { class: 'card stack tight', id: 'shop-ambassador', hidden: true });
    sapi('fiila_shop_ambassador', {}).then(function (r) {
      if (r.ambassador) { setKids(box, h('h2', null, 'Agent'), h('p', { class: 'small muted' }, 'Accompagné par ' + r.ambassador + '.')); box.hidden = false; return; }
      if (!r.can_link) return;
      var code = '', err = h('div', { role: 'alert' });
      setKids(box, h('h2', null, 'Un agent vous aide ?'),
        textField({ id: 'amb-code-input', label: 'Code agent', max: 10, placeholder: 'Ex. : K7M2QD', onInput: function (v) { code = v; } }),
        err, h('button', { class: 'btn ghost small', type: 'button', id: 'amb-link', onclick: function () {
          setKids(err);
          sapi('fiila_ambassador_link', { p_code: code }).then(function (x) { toast('Accompagné par ' + x.ambassador + '.'); render(); }, function (e) { errBox(err, e); });
        } }, 'Valider le code'));
      box.hidden = false;
    }, function () {});
    return box;
  }
  /* ================================================================ VIDE-DRESSING (pilote tenu par Fii ; tout type d'article depuis le 20/10)
     Chacun propose ; Fii valide, publie dans sa vitrine, coordonne la livraison et reverse le prix moins la commission. */
  var VD_AGES = [['0-6m', '0-6 mois'], ['6-12m', '6-12 mois'], ['1-2a', '1-2 ans'], ['2-4a', '2-4 ans'], ['4-6a', '4-6 ans'], ['6-8a', '6-8 ans'], ['8-10a', '8-10 ans'], ['10-12a', '10-12 ans'], ['12-14a', '12-14 ans']];
  var VD_GENDERS = [['fille', 'Fille'], ['garcon', 'Garçon'], ['mixte', 'Mixte']];
  // Catégories du vide-dressing (20/10 23:36 : ouvert à tout type d'article ; « Enfants » est une catégorie).
  var VD_CATS = [['mode', 'Vêtements'], ['chaussures', 'Chaussures'], ['accessoires', 'Sacs, bijoux, accessoires'], ['beaute', 'Beauté (non entamé)'],
    ['maison', 'Maison, déco'], ['electronique', 'Téléphones, électronique'], ['enfants', 'Enfants, bébé'], ['autre', 'Autre']];
  var VD_CONDITIONS = [['neuf', 'Neuf avec étiquette'], ['tres_bon', 'Très bon état'], ['bon', 'Bon état']];
  function lbl(list, k) { var x = list.filter(function (y) { return y[0] === k; })[0]; return x ? x[1] : ''; }
  var VD_STATUS = { pending: ['wait', 'En vérification'], changes: ['wait', 'Correction demandée'], approved: ['ok', 'En vente'], rejected: ['off', 'Refusé'], sold: ['ok', 'Vendu'] };
  function vdRules() {
    return h('details', { class: 'more-details', id: 'vd-rules' }, h('summary', null, 'Règles du vide-dressing'),
      h('ul', { class: 'small' },
        h('li', null, 'Photo de l’article seul : à plat, sur cintre, sur mannequin ou posé. Jamais de personne reconnaissable, ni enfant ni adulte.'),
        h('li', null, 'Article propre, complet et en état de marche. Un article par annonce.'),
        h('li', null, 'Interdits : sous-vêtements portés, cosmétiques et produits de soin entamés, médicaments, sièges auto et lits pour bébé, contrefaçons, armes, animaux.'),
        h('li', null, 'Fii vérifie chaque annonce avant de la publier, et peut la refuser.'),
        h('li', null, 'Article vendu : un livreur le récupère chez vous. Vous recevez le prix moins la commission Fii, après la livraison.')));
  }
  function viewVideDressing() {
    var mine = h('section', { class: 'stack tight', id: 'vd-mine', hidden: true });
    if (authed()) api('fiila_vd_mine', {}).then(function (d) {
      if (!d.items.length) return;
      setKids(mine, h('h2', null, 'Mes articles déposés'), h('div', { class: 'list' }, d.items.map(function (x) {
        var st = VD_STATUS[x.status] || ['off', x.status];
        return h('div', { class: 'item vd-item' },
          x.photo ? h('img', { class: 'vthumb', src: x.photo, alt: '' }) : null,
          h('div', { class: 'stack tight', style: 'flex:1;min-width:0' }, h('div', { class: 't wrapword' }, x.title),
            h('div', { class: 'small muted' }, fcfa(x.price) + ' · vous recevrez ' + fcfa(x.net) + (x.paid_at ? ' · reversé' : '')),
            x.reason ? h('div', { class: 'small' }, 'Motif : ' + x.reason) : null,
            x.status === 'changes' ? h('a', { class: 'btn ghost small', href: '#/vide-dressing/vendre?id=' + x.id, style: 'align-self:flex-start' }, 'Corriger') : null),
          h('span', { class: 'chip ' + st[0] }, st[1]));
      })));
      mine.hidden = false;
    }, function () {});
    return page(backBtn(),
      h('section', { class: 'card stack tight amb-hero' }, h('p', { class: 'eyebrow' }, 'Fii'), h('h1', null, 'Vide-dressing'),
        h('p', null, 'Articles de seconde main vérifiés par Fii : vêtements, chaussures, maison, électronique, enfants… Livrés à la bonne porte.')),
      h('div', { class: 'duo' },
        iconBtn('a', { class: 'btn', href: '#/b/vide-dressing', id: 'vd-buy' }, 'shop', 'Acheter'),
        iconBtn('a', { class: 'btn ghost', href: '#/vide-dressing/vendre', id: 'vd-sell' }, 'cam', 'Vendre')),
      vdRules(), mine, footer());
  }
  function viewVdSell(q) {
    if (!authed()) return page(backBtn('Vide-dressing', '#/vide-dressing'), stateCard('!', 'Un compte est nécessaire', 'Pour être payée quand votre article est vendu.',
      h('a', { class: 'btn', href: '#/compte' + qs({ mode: 'inscription', retour: 'vide-dressing/vendre' }) }, 'Créer mon compte')), footer());
    return api('fiila_vd_mine', {}).then(function (d) {
      var ed = q && q.id ? d.items.filter(function (x) { return x.id === q.id && x.status === 'changes'; })[0] : null;
      var f = ed ? { cat: ed.category || 'enfants', title: ed.title, gender: ed.gender, age: ed.age_band, size: ed.size || '', condition: ed.condition, price: String(ed.price), quartier: ed.quartier || '', photo: ed.photo || null }
        : { cat: '', title: '', gender: '', age: '', size: '', condition: '', price: '', quartier: '', photo: null };
      var original = f.photo, photoOk = false;
      // Genre et âge : seulement pour la catégorie « Enfants ».
      var kidBox = h('div', { class: 'stack', id: 'vd-kid', hidden: f.cat !== 'enfants' },
        segField({ name: 'vd-gender', id: 'vd-gender', legend: 'Pour', value: f.gender, options: VD_GENDERS, onChange: function (v) { f.gender = v; } }),
        h('div', { class: 'field' }, h('label', { for: 'vd-age' }, 'Âge'),
          h('select', { id: 'vd-age', onchange: function (e) { f.age = e.target.value; } }, h('option', { value: '' }, 'Choisir…'),
            VD_AGES.map(function (a) { return h('option', { value: a[0], selected: f.age === a[0] || null }, a[1]); }))));
      var err = h('div', { role: 'alert' });
      var net = h('p', { class: 'small muted', id: 'vd-net' });
      function drawNet() { var p = parseInt(String(f.price).replace(/\D/g, ''), 10); net.textContent = p ? 'Vous recevrez ' + fcfa(p - Math.floor(p * d.commission / 100)) + ' (commission Fii ' + d.commission + ' %).' : ''; }
      drawNet();
      var send = iconBtn('button', { class: 'btn big', type: 'button', id: 'vd-send', onclick: function () {
        setKids(err);
        if (!f.photo) return errBox(err, new ApiError('vd_photo_required'));
        if (!photoOk) return errBox(err, new ApiError('vd_photo_rule'));
        if (!f.cat) return errBox(err, new ApiError('vd_category_required'));
        send.disabled = true;
        var kid = f.cat === 'enfants';
        var p = { id: ed ? ed.id : undefined, category: f.cat, title: f.title.trim(), gender: kid ? f.gender : null, age_band: kid ? f.age : null, size: f.size.trim() || null, condition: f.condition,
          price: parseInt(String(f.price).replace(/\D/g, ''), 10), quartier: f.quartier.trim() || null, photo_ok: true };
        if (f.photo !== original) p.photo = f.photo.replace(/^data:[^,]+,/, '');
        api('fiila_vd_submit', { p: p }).then(function () { toast('Article envoyé. Fii le vérifie avant de le publier.'); go('#/vide-dressing'); },
          function (e) { send.disabled = false; errBox(err, e); });
      } }, 'send', ed ? 'Renvoyer l’article corrigé' : 'Envoyer pour vérification');
      return page(backBtn('Vide-dressing', '#/vide-dressing'),
        h('h1', null, ed ? 'Corriger l’article' : 'Vendre un article'),
        ed && ed.reason ? h('div', { class: 'notice' }, 'Correction demandée : ' + ed.reason) : null,
        photoField({ id: 'vd-photo', label: 'Photo de l’article', ratio: true, get: function () { return f.photo; }, set: function (v) { f.photo = v; }, maxSide: 960 }),
        h('label', { class: 'check-line' }, h('input', { type: 'checkbox', id: 'vd-photo-ok', onchange: function (e) { photoOk = e.target.checked; } }),
          'L’article seul : aucune personne reconnaissable sur la photo'),
        h('div', { class: 'field' }, h('label', { for: 'vd-cat' }, 'Catégorie'),
          h('select', { id: 'vd-cat', onchange: function (e) { f.cat = e.target.value; kidBox.hidden = f.cat !== 'enfants'; } }, h('option', { value: '' }, 'Choisir…'),
            VD_CATS.map(function (c) { return h('option', { value: c[0], selected: f.cat === c[0] || null }, c[1]); }))),
        textField({ id: 'vd-title', label: 'Article', max: 80, value: f.title, placeholder: 'Ex. : Robe en coton, ventilateur, sac à main', onInput: function (v) { f.title = v; } }),
        kidBox,
        textField({ id: 'vd-size', label: 'Taille ou pointure', optional: true, max: 12, value: f.size, placeholder: 'Ex. : M, 42, 3 ans', onInput: function (v) { f.size = v; } }),
        segField({ name: 'vd-cond', id: 'vd-cond', legend: 'État', value: f.condition, options: VD_CONDITIONS, onChange: function (v) { f.condition = v; } }),
        textField({ id: 'vd-price', label: 'Prix (FCFA)', inputmode: 'numeric', value: f.price, placeholder: 'Ex. : 4000', onInput: function (v) { f.price = v; drawNet(); } }),
        net,
        textField({ id: 'vd-quartier', label: 'Votre quartier', optional: true, max: 60, value: f.quartier, placeholder: 'Pour organiser l’enlèvement', onInput: function (v) { f.quartier = v; } }),
        vdRules(), err, send, footer());
    }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger', errText(e), retryBtn()), footer()); });
  }
  /* ================================================================ BACK-OFFICE (#/bo)
     Portail unique de l'équipe Fii (fondateur, 19/10 10:41). Chaque membre a son propre compte et un rôle ;
     la base décide de chaque droit (fiila.staff_can) : l'interface ne fait que masquer ce qui n'est pas permis.
     Ordinateur : barre latérale ; téléphone : barre du haut et menu. Règle « simple et intuitif » : une action principale
     et une seule rangée de filtres par écran. */
  var BO = { me: null, at: 0 };
  var BO_ROLES = { super_admin: 'Super admin', strategy: 'Head of Stratégie', operations: 'Opérations', moderation: 'Modération', support: 'Support', finance: 'Finances' };
  var BO_ROLE_HELP = {
    super_admin: 'Tout, y compris l’équipe, les réglages et le journal.',
    strategy: 'Head of Stratégie et Développement : fixe le cap de Fii Carrière, décide des propositions du Manager, crée les missions.',
    operations: 'Boutiques, commandes, comptes, fil, modération, vide-dressing, agents, finances.',
    moderation: 'Modération des commentaires, vérification du vide-dressing, suspension des boutiques.',
    support: 'Lecture des boutiques, commandes et comptes pour aider les utilisateurs.',
    finance: 'Commandes, finances, versements des agents et du vide-dressing.' };
  // [chemin, icône, libellé, droit, file d'attente du tableau de bord]
  // [chemin, icône, libellé, droit, file d'attente du tableau de bord, groupe]
  var BO_NAV = [
    ['', 'home', 'Tableau de bord', 'dashboard', null, 'Pilotage'],
    ['croissance', 'star', 'Croissance', 'dashboard', null, 'Pilotage'],
    ['finances', 'cash', 'Finances', 'finance', null, 'Pilotage'],
    ['boutiques', 'shop', 'Boutiques', 'shops', 'suspended', 'Opérations'],
    ['commandes', 'box', 'Commandes', 'orders', null, 'Opérations'],
    ['comptes', 'user', 'Comptes', 'accounts', null, 'Opérations'],
    ['fil', 'heart', 'Fil (25 places)', 'feed', null, 'Opérations'],
    ['ambassadeurs', 'star', 'Ambassadeurs', 'partners', null, 'Programmes'],
    ['agents', 'gift', 'Agents', 'ambassadors', 'ambassadors', 'Programmes'],
    ['carriere', 'chat', 'Manager Carrière', 'ambassadors', 'career', 'Programmes'],
    ['vide-dressing', 'users', 'Vide-dressing', ['vide_dressing', 'finance'], 'vide_dressing', 'Programmes'],
    ['moderation', 'flag', 'Modération', 'moderation', 'comments', 'Programmes'],
    ['equipe', 'key', 'Équipe', 'team', null, 'Administration'],
    ['journal', 'clock', 'Journal', 'audit', null, 'Administration'],
    ['reglages', 'settings', 'Réglages', 'settings', null, 'Administration']];
  function boCan(perm) {
    if (Array.isArray(perm)) return perm.some(boCan);
    return !!(BO.me && BO.me.perms && BO.me.perms.indexOf(perm) >= 0);
  }
  // Profil d'équipe gardé 60 s seulement s'il donne accès (un refus est toujours revérifié) ; la base reste juge de chaque geste.
  function boMe(force) {
    if (!force && BO.me && BO.me.staff && Date.now() - BO.at < 60000) return Promise.resolve(BO.me);
    return api('fiila_bo_me', {}).then(function (m) { BO.me = m; BO.at = Date.now(); return m; });
  }
  function boDate(iso, time) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + (time ? ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
  }
  function boBadge(kind, text) { return h('span', { class: 'bo-badge ' + kind }, text); }
  // Indicateur : pastille d'icône, chiffre, libellé, détail ; tone = couleur de la pastille.
  function boKpi(id, ic, value, label, sub, tone) {
    return h('div', { class: 'bo-kpi' + (tone ? ' ' + tone : ''), id: id ? 'kpi-' + id : null },
      h('span', { class: 'bo-kpi-ic', 'aria-hidden': 'true' }, icon(ic, 18)),
      h('strong', null, value), h('span', null, label), sub ? h('small', { class: 'muted' }, sub) : null);
  }
  // Initiale dans une pastille (boutiques, comptes, ambassadeurs).
  function boAv(name, cls) { return h('span', { class: 'bo-av' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, String(name || '?').trim().charAt(0).toUpperCase() || '?'); }
  // En-tête de fiche : pastille, nom, badges, une ligne d'informations.
  function boHero(name, badges, line, id) {
    return h('section', { class: 'bo-hero', id: id || null }, boAv(name, 'big'),
      h('div', { class: 'bo-hero-t' }, h('div', { class: 'bo-hero-b' }, badges), line ? h('p', { class: 'small muted wrapword' }, line) : null));
  }
  function boNum(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  // Tableau : lignes de cellules ; sur téléphone, chaque ligne devient une carte (libellé à gauche, valeur à droite).
  function boTable(cols, rows, o) {
    o = o || {};
    if (!rows.length) return h('div', { class: 'bo-empty', id: o.emptyId || null }, o.empty || 'Rien à afficher.');
    return h('table', { class: 'bo-table', id: o.id || null },
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { scope: 'col', class: c.cls || null }, c.label); }))),
      h('tbody', null, rows.map(function (r) {
        var tr = h('tr', { class: o.href ? 'link' : null }, cols.map(function (c, i) {
          var v = c.get(r);
          return h('td', { 'data-label': c.label, class: c.cls || null }, i === 0 && o.href ? h('a', { href: o.href(r) }, v) : v);
        }));
        if (o.href) tr.addEventListener('click', function (e) { if (e.target.closest('a,button,select,input')) return; go(o.href(r)); });
        return tr;
      })));
  }
  function boChips(list, value, onPick, id) {
    return h('div', { class: 'opt-row scroll bo-chips', role: 'group', id: id || null }, list.map(function (c) {
      return h('button', { class: 'opt' + (value === c[0] ? ' on' : ''), type: 'button', 'aria-pressed': value === c[0] ? 'true' : 'false', onclick: function () { onPick(c[0]); } }, c[1]);
    }));
  }
  function boSearch(value, placeholder, onSearch) {
    var input = h('input', { type: 'search', class: 'bo-search', value: value || '', placeholder: placeholder, 'aria-label': placeholder, id: 'bo-search' });
    var t = null;
    input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { onSearch(input.value.trim()); }, 300); });
    return input;
  }
  // Geste sensible refusé faute de connexion récente : on redemande le mot de passe, puis on rejoue.
  function boSensitive(fn) {
    return fn().then(null, function (e) {
      if (!e || e.code !== 'reauth_required') throw e;
      return new Promise(function (resolve, reject) {
        var settled = false;
        function done(ok, v) { if (settled) return; settled = true; (ok ? resolve : reject)(v); }
        var pw = h('input', { type: 'password', id: 'bo-reauth-pw', autocomplete: 'current-password', 'data-autofocus': '1' });
        var code = h('input', { type: 'text', id: 'bo-reauth-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, placeholder: '123 456', class: 'bo-code' });
        var err = h('div', { role: 'alert' });
        var ok = h('button', { class: 'btn', type: 'submit', id: 'bo-reauth-ok' }, 'Confirmer');
        var back = h('div', { class: 'sheet-back', id: 'bo-reauth', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-reauth-h' },
          h('form', { class: 'sheet', onsubmit: function (ev) {
            ev.preventDefault(); setKids(err); ok.disabled = true;
            // Le mot de passe d'abord (erreur affichée dans la feuille) ; puis le geste lui-même (erreur remontée à l'écran).
            // Mot de passe, puis code : la session reste au niveau « double authentification ».
            account.signIn(BO.me.email, pw.value).then(function () {
              return account.mfaFactors().then(function (fs) {
                var f = fs.filter(function (x) { return x.status === 'verified'; })[0];
                return f ? account.mfaVerify(f.id, code.value) : null;
              });
            }).then(function () {
              return fn().then(function (r) { done(true, r); close(); }, function (x) { done(false, x); close(); });
            }, function (x) { ok.disabled = false; errBox(err, x); pw.select(); });
          } }, h('h2', { id: 'bo-reauth-h' }, 'Confirmez votre mot de passe'),
            h('p', { class: 'small muted' }, 'Ce geste touche à l’équipe ou aux réglages : il demande une connexion de moins de 15 minutes (mot de passe et code).'),
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Mot de passe'), pw),
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Code de l’application'), code), err, ok,
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler')));
        var close = openSheet(back, { onClose: function () { done(false, e); } });
      });
    });
  }
  // Geste du back-office : une seule fois à la fois (bouton désactivé), compteurs rafraîchis, et retour arrière de l'affichage
  // (liste déroulante…) si le geste échoue ou est annulé.
  function boAct(fn, okText, after, onFail, btn) {
    if (btn) { if (btn.disabled) return Promise.resolve(); btn.disabled = true; }
    return boSensitive(fn).then(function (r) {
      BO.overview = null;
      if (okText) toast(okText);
      if (after) after(r); else render();
      return r;
    }, function (e) {
      if (btn) btn.disabled = false;
      if (onFail) onFail(e);
      if (e && e.code !== 'reauth_required') toast(errText(e));
    });
  }
  // Récupère le contenu d'un écran d'administration existant (sans son bouton retour ni son pied de page) pour l'afficher dans le cadre.
  function boEmbed(viewFn) {
    return Promise.resolve(viewFn()).then(function (pg) {
      var box = h('div', { class: 'bo-embed stack' });
      box.addEventListener('click', function (e) { if (e.target.closest('button')) BO.overview = null; }, true);
      Array.prototype.slice.call(pg.childNodes).forEach(function (n) {
        if (n.nodeType === 1 && (n.classList.contains('back') || n.tagName === 'FOOTER' || n.tagName === 'H1')) return;
        box.appendChild(n);
      });
      return box;
    });
  }
  // Squelette de chargement : quelques lignes qui scintillent, à la place d'un simple « Chargement… ».
  function boSkel(n) {
    return h('div', { class: 'bo-skel', role: 'status', 'aria-label': 'Chargement' }, Array.apply(null, Array(n || 5)).map(function () {
      return h('div', { class: 'bo-skel-row' }, h('i', { class: 'av' }), h('i', { class: 'l1' }), h('i', { class: 'l2' }));
    }));
  }
  /* Recherche globale (⌘K, Ctrl+K ou « / ») : rubriques, boutiques, comptes, commandes, ambassadeurs, selon les droits. */
  function boPalette() {
    if (document.getElementById('bo-pal')) return;
    var input = h('input', { type: 'search', id: 'bo-pal-q', 'data-autofocus': '1', placeholder: 'Boutique, compte, commande, rubrique…', 'aria-label': 'Rechercher dans le back-office', autocomplete: 'off',
      role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'bo-pal-list' });
    var list = h('div', { class: 'bo-pal-list', id: 'bo-pal-list', role: 'listbox' });
    var items = [], sel = 0, seq = 0, ambs = null, timer = null;
    function pick(i) { var it = items[i]; if (it) { close(); go(it.href); } }
    function mark() { items.forEach(function (it, i) { it.el.setAttribute('aria-selected', String(i === sel)); if (i === sel) it.el.scrollIntoView({ block: 'nearest' }); }); }
    function draw(groups, pending) {
      items = []; sel = 0;
      var kids = groups.filter(function (g) { return g[1].length; }).map(function (g) {
        return h('div', { class: 'bo-pal-g' }, h('p', { class: 'bo-pal-gt' }, g[0]), g[1].map(function (r) {
          var idx = items.length;
          var el = h('a', { class: 'bo-pal-it', href: r.href, role: 'option', 'aria-selected': 'false', onclick: function (e) { e.preventDefault(); pick(idx); }, onmousemove: function () { if (sel !== idx) { sel = idx; mark(); } } },
            h('span', { class: 'bo-pal-ic', 'aria-hidden': 'true' }, icon(r.icon, 16)),
            h('span', { class: 'bo-pal-t' }, h('b', { class: 'wrapword' }, r.title), r.sub ? h('small', null, r.sub) : null), icon('chev', 14));
          items.push({ el: el, href: r.href });
          return el;
        }));
      });
      setKids(list, kids.length ? kids : h('p', { class: 'bo-pal-empty' }, pending ? 'Recherche…' : 'Aucun résultat.'), pending && kids.length ? h('p', { class: 'bo-pal-empty' }, 'Recherche…') : null);
      mark();
    }
    function navGroup(t) {
      return BO_NAV.filter(function (n) { return boCan(n[3]) && (!t || (n[2] + ' ' + n[5]).toLowerCase().indexOf(t) >= 0); })
        .map(function (n) { return { icon: n[1], title: n[2], sub: n[5], href: '#/bo' + (n[0] ? '/' + n[0] : '') }; });
    }
    function search() {
      var raw = input.value.trim(), t = raw.toLowerCase(), mine = ++seq;
      var nav = navGroup(t).slice(0, t ? 4 : BO_NAV.length);
      if (t.length < 2) { draw([['Aller à', nav]]); return; }
      draw([['Aller à', nav]], true);
      var calls = [];
      if (boCan('shops')) calls.push(api('fiila_bo_shops', { p_q: raw, p_filter: null, p_page: 0 }).then(function (r) { return ['Boutiques', r.shops.slice(0, 5).map(function (x) { return { icon: 'shop', title: x.name, sub: [typeLabel(x.type), x.public ? 'ouverte' : 'fermée'].filter(Boolean).join(' · '), href: '#/bo/boutiques/' + x.id }; })]; }, function () { return ['Boutiques', []]; }));
      if (boCan('accounts')) calls.push(api('fiila_bo_accounts', { p_q: raw, p_page: 0 }).then(function (r) { return ['Comptes', r.accounts.slice(0, 5).map(function (x) { return { icon: 'user', title: x.name || x.email, sub: x.email, href: '#/bo/comptes/' + x.id }; })]; }, function () { return ['Comptes', []]; }));
      if (boCan('orders')) calls.push(api('fiila_bo_orders', { p_q: raw, p_status: null, p_page: 0 }).then(function (r) { return ['Commandes', r.orders.slice(0, 5).map(function (x) { return { icon: 'box', title: 'N° ' + String(x.number).padStart(4, '0') + ' · ' + x.customer, sub: x.shop + ' · ' + fcfa(x.total), href: '#/bo/commandes/' + x.id }; })]; }, function () { return ['Commandes', []]; }));
      if (boCan('ambassadors')) calls.push((ambs || (ambs = api('fiila_admin_ambassadors', {}).then(function (d) { return d.ambassadors; }, function () { return []; }))).then(function (l) {
        return ['Agents', l.filter(function (a) { return [a.name, a.code, a.phone, a.email].join(' ').toLowerCase().indexOf(t) >= 0; }).slice(0, 5)
          .map(function (a) { return { icon: 'gift', title: a.name, sub: a.code + ' · ' + ((AMB_ST[a.status] || [])[1] || a.status), href: '#/bo/agents/' + a.id }; })];
      }));
      Promise.all(calls).then(function (gs) { if (mine === seq && list.isConnected) draw([['Aller à', nav]].concat(gs)); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(search, 220); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { sel = (sel + 1) % items.length; mark(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; mark(); } }
      else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    });
    var back = h('div', { class: 'bo-pal-back', id: 'bo-pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Recherche', onclick: function (e) { if (e.target === back) close(); } },
      h('div', { class: 'bo-pal' }, h('div', { class: 'bo-pal-in' }, icon('search', 18), input, h('kbd', null, 'Échap')), list,
        h('p', { class: 'bo-pal-foot' }, h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), ' choisir'), h('span', null, h('kbd', null, '↵'), ' ouvrir'))));
    var close = openSheet(back);
    search();
  }
  // Raccourcis clavier du back-office (posés une seule fois) : ⌘K / Ctrl+K / « / » ouvrent la recherche.
  var BO_KEYS = false;
  function boKeys() {
    if (BO_KEYS) return; BO_KEYS = true;
    document.addEventListener('keydown', function (e) {
      if (!/^#\/bo(\/|$)/.test(location.hash) || !document.querySelector('.bo-shell')) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if (((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) || (e.key === '/' && !typing)) { e.preventDefault(); boPalette(); }
    });
  }
  function boShell(sec, title, body, o) {
    o = o || {};
    var me = BO.me, q = (BO.overview && BO.overview.queues) || {};
    var lastGroup = null, cur = BO_NAV.filter(function (n) { return n[0] === sec; })[0];
    var nav = h('nav', { class: 'bo-nav', 'aria-label': 'Back-office' }, BO_NAV.filter(function (n) { return boCan(n[3]); }).map(function (n) {
      var count = n[4] ? q[n[4]] : 0;
      var head = n[5] !== lastGroup ? h('p', { class: 'bo-group' }, n[5]) : null;
      lastGroup = n[5];
      return [head, h('a', { href: '#/bo' + (n[0] ? '/' + n[0] : ''), class: 'bo-link' + (sec === n[0] ? ' on' : ''), 'aria-current': sec === n[0] ? 'page' : null, id: 'bo-nav-' + (n[0] || 'accueil') },
        icon(n[1], 20), h('span', null, n[2]), count ? h('span', { class: 'bo-count', 'aria-label': count + ' à traiter' }, String(count)) : null)];
    }));
    var shell = h('div', { class: 'bo-shell' });
    var side = h('aside', { class: 'bo-side', id: 'bo-side' },
      h('div', { class: 'bo-brand' }, brandLogo('small'), h('span', { class: 'bo-brand-t' }, 'Back-office')),
      nav,
      h('div', { class: 'bo-user' },
        h('div', { class: 'bo-user-id' }, h('span', { class: 'bo-av', 'aria-hidden': 'true' }, ((me.name || me.email || 'M').trim().charAt(0) || 'M').toUpperCase()),
          h('div', null, h('b', { class: 'wrapword' }, (me.name || me.email || '').split(' ')[0] || 'Membre'), h('span', { class: 'small muted' }, BO_ROLES[me.role] || me.role))),
        h('a', { class: 'btn link small', href: '#/' }, 'Voir le site'),
        h('button', { class: 'btn link small', type: 'button', id: 'bo-logout', onclick: function () { account.signOut().then(function () { BO.me = null; go('#/bo'); }); } }, 'Se déconnecter')));
    var top = h('header', { class: 'bo-top' },
      h('button', { class: 'bo-menu-btn', type: 'button', id: 'bo-menu', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': 'bo-side', onclick: function () {
        var open = !shell.classList.contains('menu-open'); shell.classList.toggle('menu-open', open); this.setAttribute('aria-expanded', open ? 'true' : 'false');
      } }, h('span', { class: 'bo-burger', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
      brandLogo('small'), h('span', { class: 'bo-brand-t' }, 'Back-office'),
      h('button', { class: 'bo-top-search', type: 'button', 'aria-label': 'Rechercher', onclick: boPalette }, icon('search', 20)));
    var scrim = h('div', { class: 'bo-scrim', onclick: function () { shell.classList.remove('menu-open'); } });
    boKeys();
    var crumbs = h('nav', { class: 'bo-crumbs', 'aria-label': 'Fil d’Ariane' }, h('span', null, (cur && cur[5]) || 'Back-office'),
      o.back ? [icon('chev', 12), h('a', { href: o.back[0] }, o.back[1])] : null, icon('chev', 12), h('b', { class: 'wrapword' }, title));
    var glass = h('div', { class: 'bo-glass' }, crumbs,
      h('button', { class: 'bo-find', type: 'button', id: 'bo-find', onclick: boPalette }, icon('search', 16), h('span', null, 'Rechercher'), h('kbd', null, /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K')));
    var tabs = h('nav', { class: 'bo-tabs', 'aria-label': 'Raccourcis' }, [['', 'home', 'Accueil', 'dashboard'], ['boutiques', 'shop', 'Boutiques', 'shops'], ['commandes', 'box', 'Commandes', 'orders'], ['agents', 'gift', 'Agents', 'ambassadors']]
      .filter(function (n) { return boCan(n[3]); }).slice(0, 3).map(function (n) {
        var count = n[0] === 'agents' ? (q.ambassadors || 0) + (q.rewards || 0) : n[0] === 'boutiques' ? 0 : 0;
        return h('a', { href: '#/bo' + (n[0] ? '/' + n[0] : ''), class: 'bo-tab' + (sec === n[0] ? ' on' : ''), 'aria-current': sec === n[0] ? 'page' : null }, icon(n[1], 20), h('span', null, n[2]), count ? h('i', { class: 'bo-tab-dot' }) : null);
      }), h('button', { class: 'bo-tab', type: 'button', onclick: boPalette }, icon('search', 20), h('span', null, 'Chercher')));
    var main = h('main', { class: 'bo-main', id: 'bo-main' },
      glass,
      o.back ? h('a', { class: 'btn back', href: o.back[0] }, '← ' + o.back[1]) : null,
      h('div', { class: 'bo-head' }, h('div', { class: 'stack tight' }, h('p', { class: 'bo-eyebrow' }, o.eyebrow || (cur && cur[5]) || 'Back-office'), h('h1', { class: 'wrapword' }, title),
        o.sub ? h('p', { class: 'bo-sub' }, o.sub) : null), o.action || null),
      body);
    add(shell, [top, side, scrim, main, tabs]);
    return shell;
  }
  function viewBo(parts, q) {
    var sec = parts[1] || '';
    if (sec === 'invitation') return viewBoInvite(parts[2]);
    if (!authed()) return boLogin();
    // Profil vérifié à chaque écran (un rôle retiré se voit tout de suite), en même temps que les compteurs : pas d'attente en plus.
    var ov = BO.me && BO.me.staff && !(BO.overview && Date.now() - BO.overview.at < 30000)
      ? api('fiila_bo_overview', {}).then(function (o) { o.at = Date.now(); BO.overview = o; }, function () { BO.overview = null; }) : Promise.resolve();
    return Promise.all([boMe(true), ov]).then(function (rr) {
      var me = rr[0];
      if (!me.staff) { BO.overview = null; return boDenied(me); }
      if (!me.mfa) { BO.overview = null; return boMfa(me); }
      var nav = BO_NAV.filter(function (n) { return n[0] === sec; })[0];
      if (!nav) return boShell('', 'Introuvable', stateCard('?', 'Page introuvable', 'Cette page n’existe pas dans le back-office.'));
      if (!boCan(nav[3])) return boShell(sec, nav[2], stateCard('⦸', 'Accès non autorisé', 'Votre rôle (' + (BO_ROLES[me.role] || me.role) + ') ne donne pas accès à cette page.'));
      var pre = BO.overview ? Promise.resolve() : api('fiila_bo_overview', {}).then(function (o) { o.at = Date.now(); BO.overview = o; }, function () {});
      return pre.then(function () {
        var id = parts[2];
        switch (sec) {
          case '': return boDashboard();
          case 'boutiques': return id ? boShop(id) : boShops(q);
          case 'commandes': return id ? boOrder(id) : boOrders(q);
          case 'comptes': return id ? boAccount(id) : boAccounts(q);
          case 'moderation': return boEmbed(viewAdminComments).then(function (b) { return boShell(sec, 'Modération', b); });
          case 'vide-dressing': return boEmbed(viewAdminVd).then(function (b) { return boShell(sec, 'Vide-dressing', b); });
          case 'agents': return id ? boAmbassador(id) : boAmbassadors(q);
          // Anciennes fiches d'agent (#/bo/ambassadeurs/<id>) : toujours valides ; la rubrique devient celle des marques invitées.
          case 'ambassadeurs': return id ? boAmbassador(id) : q && q.f ? boAmbassadors(q) : boPartners();
          case 'carriere': return id ? boCareerThread(id) : boCareer();
          case 'croissance': return Promise.all([boEmbed(viewStats), api('fiila_bo_nudges', {}).then(null, function () { return null; }), api('fiila_bo_onboarding', {}).then(null, function () { return null; }),
            api('fiila_bo_wa', {}).then(null, function () { return null; })]).then(function (rr) { return boShell(sec, 'Croissance', [boOnboardingPanel(rr[2]), boWaPanel(rr[3]), boNudgePanel(rr[1]), rr[0]]); });
          case 'fil': return boFeed();
          case 'finances': return boFinance();
          case 'equipe': return boTeam();
          case 'journal': return boAudit(q);
          case 'reglages': return boSettings();
        }
      });
    }, function (e) { return page(stateCard('!', 'Back-office indisponible', errText(e), retryBtn())); });
  }
  // Portail de connexion de l'équipe.
  function boLogin() {
    var f = { email: '', password: '' };
    var err = h('div', { role: 'alert' });
    var btn = h('button', { class: 'btn', type: 'submit', id: 'bo-login-btn' }, 'Se connecter');
    return h('div', { class: 'bo-portal' }, h('form', { class: 'bo-login card stack', id: 'bo-login', onsubmit: function (e) {
        e.preventDefault(); setKids(err); btn.disabled = true;
        account.signIn(f.email.trim(), f.password).then(function () { btn.disabled = false; render(); }, function (x) { btn.disabled = false; errBox(err, x); });
      } },
      h('div', { class: 'bo-brand' }, brandLogo(), h('span', { class: 'bo-brand-t' }, 'Back-office')),
      h('h1', null, 'Connexion de l’équipe'),
      h('p', { class: 'small muted' }, 'Accès réservé à l’équipe Fii. Chaque membre se connecte avec son propre compte.'),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Adresse e-mail'), h('input', { type: 'email', id: 'bo-email', autocomplete: 'username', required: true, oninput: function (e) { f.email = e.target.value; } })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Mot de passe'), h('input', { type: 'password', id: 'bo-pass', autocomplete: 'current-password', required: true, oninput: function (e) { f.password = e.target.value; } })),
      err, btn,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('a', { class: 'btn link small', href: '#/compte' + qs({ mode: 'oubli', retour: 'bo' }) }, 'Mot de passe oublié ?'),
        h('a', { class: 'btn link small', href: '#/', id: 'bo-portal-home' }, 'Retour au site'))));
  }
  /* Double authentification de l'équipe : à la première connexion, activation (QR code ou clé à saisir dans l'application,
     puis premier code) ; ensuite, le code à chaque connexion. */
  // QR code renvoyé par l'API Supabase : du SVG brut (« <?xml…><svg… », sans préfixe « data: » ; c'est supabase-js qui en ajoute un).
  // On accepte les deux formes et on réencode toujours le SVG (les « # » des couleurs couperaient une URL « data: »).
  function mfaQrSrc(q) {
    var raw = String(q || '');
    if (/^data:/i.test(raw)) {
      var c = raw.indexOf(',');
      raw = raw.slice(c + 1);
      if (/^\s*%3C/i.test(raw)) { try { raw = decodeURIComponent(raw); } catch (e) { /* tel quel */ } }
    }
    var i = raw.search(/<svg[\s>]/i);
    if (i < 0) return '';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(raw.slice(i));
  }
  function boMfa(me) {
    function card() { return h('div', { class: 'bo-portal' }, h('div', { class: 'bo-login card stack', id: 'bo-mfa' },
      h('div', { class: 'bo-brand' }, brandLogo(), h('span', { class: 'bo-brand-t' }, 'Back-office')),
      Array.prototype.slice.call(arguments))); }
    function codeForm(factorId, label, okText) {
      var err = h('div', { role: 'alert' });
      var input = h('input', { type: 'text', id: 'bo-mfa-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, pattern: '[0-9 ]*', 'data-autofocus': '1',
        placeholder: '123 456', 'aria-label': 'Code à 6 chiffres', class: 'bo-code' });
      var btn = h('button', { class: 'btn', type: 'submit', id: 'bo-mfa-ok' }, label);
      return h('form', { class: 'stack', onsubmit: function (e) {
        e.preventDefault(); setKids(err);
        if (!/^\d{6}$/.test(input.value.replace(/\s/g, ''))) { errBox(err, new ApiError('mfa_verification_failed')); input.focus(); return; }
        btn.disabled = true;
        account.mfaVerify(factorId, input.value).then(function () { BO.me = null; toast(okText); render(); },
          function (x) { btn.disabled = false; input.value = ''; input.focus(); errBox(err, x); });
      } }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Code à 6 chiffres'), input), err, btn);
    }
    var leave = h('button', { class: 'btn link small', type: 'button', onclick: function () { account.signOut().then(function () { BO.me = null; render(); }); } }, 'Changer de compte');
    return account.mfaFactors().then(function (fs) {
      var ok = fs.filter(function (f) { return f.status === 'verified'; })[0];
      if (ok) return card(h('h1', null, 'Code de vérification'),
        h('p', { class: 'small muted' }, 'Ouvrez votre application d’authentification et saisissez le code « Fii ».'),
        codeForm(ok.id, 'Valider', 'Connexion vérifiée.'),
        h('details', { class: 'small' }, h('summary', null, 'Téléphone perdu ?'),
          h('p', { class: 'small muted' }, (me.role === 'super_admin' ? 'Retirez votre facteur dans le tableau de bord Supabase (Authentication → Users → votre compte), puis reconnectez-vous ici pour en activer un nouveau.'
            : 'Demandez au super admin de réinitialiser votre double authentification, puis reconnectez-vous ici.'))),
        leave);
      // Première fois : on repart d'un facteur neuf (les essais inachevés sont retirés).
      return Promise.all(fs.filter(function (f) { return f.status !== 'verified'; }).map(function (f) { return account.mfaRemove(f.id).catch(function () {}); }))
        .then(function () { return account.mfaEnroll(); }).then(function (en) {
          var secret = (en.totp && en.totp.secret) || '';
          return card(h('h1', null, 'Activer la double authentification'),
            h('p', { class: 'small muted' }, 'Obligatoire pour l’équipe : un mot de passe volé ne suffit plus pour entrer.'),
            h('ol', { class: 'bo-steps' },
              h('li', null, 'Installez une application d’authentification : Google Authenticator, Microsoft Authenticator, ou « Mots de passe » sur iPhone.'),
              h('li', null, 'Scannez ce QR code avec l’application.', h('img', { src: mfaQrSrc(en.totp.qr_code), alt: 'QR code de la double authentification', class: 'bo-qr', id: 'bo-mfa-qr', width: 180, height: 180 }),
                en.totp.uri ? h('a', { class: 'btn ghost small', href: en.totp.uri, id: 'bo-mfa-open', style: 'align-self:flex-start' }, 'Sur ce téléphone : ajouter à l’application') : null,
                h('span', { class: 'small muted' }, 'Sans QR code : dans l’application, choisissez « Saisir une clé de configuration » (type « basé sur l’heure ») et recopiez cette clé. Elle ne se tape pas ici.'), h('code', { id: 'bo-mfa-secret', class: 'wrapword' }, secret.replace(/(.{4})/g, '$1 ').trim())),
              h('li', null, 'Recopiez ici le code à 6 chiffres que l’application affiche pour « Fii » (il change toutes les 30 secondes).')),
            codeForm(en.id, 'Activer', 'Double authentification activée.'),
            leave);
        });
    }, function (e) { return card(h('h1', null, 'Double authentification'), stateCard('!', 'Impossible de continuer', errText(e), retryBtn()), leave); });
  }
  function boDenied(me) {
    return h('div', { class: 'bo-portal' }, h('div', { class: 'bo-login card stack', id: 'bo-denied' },
      h('div', { class: 'bo-brand' }, brandLogo(), h('span', { class: 'bo-brand-t' }, 'Back-office')),
      h('h1', null, 'Accès non autorisé'),
      h('p', { class: 'muted' }, 'Ce compte ne fait pas partie de l’équipe Fii. Pour rejoindre l’équipe, ouvrez le lien d’invitation reçu.'),
      h('a', { class: 'btn', href: '#/' }, 'Retour au site'),
      h('button', { class: 'btn ghost', type: 'button', onclick: function () { account.signOut().then(function () { BO.me = null; render(); }); } }, 'Changer de compte')));
  }
  function viewBoInvite(token) {
    return api('fiila_bo_invite_get', { p_token: token || '' }).then(function (r) {
      var box = function () { return h('div', { class: 'bo-portal' }, h('div', { class: 'bo-login card stack', id: 'bo-invite' },
        h('div', { class: 'bo-brand' }, brandLogo(), h('span', { class: 'bo-brand-t' }, 'Back-office')),
        Array.prototype.slice.call(arguments))); };
      if (r.state !== 'ok') return box(h('h1', null, r.state === 'used' ? 'Invitation déjà utilisée' : 'Invitation expirée ou non valide'),
        h('p', { class: 'muted' }, r.state === 'used' ? 'Connectez-vous au back-office avec votre compte.' : 'Demandez une nouvelle invitation à la personne qui vous l’a envoyée.'),
        h('a', { class: 'btn', href: '#/bo' }, 'Aller au back-office'));
      var back = 'bo/invitation/' + token;
      var err = h('div', { role: 'alert' });
      return h('div', { class: 'bo-portal' }, h('div', { class: 'stack', id: 'bo-invite', style: 'width:100%;max-width:460px' },
        inviteCard({ id: 'bo-invite-card', kind: 'Équipe Fii · ' + (BO_ROLES[r.role] || r.role), from: 'Fii', title: 'Rejoindre l’équipe Fii',
          sub: BO_ROLE_HELP[r.role] || '',
          points: [['key', 'Accès au back-office selon votre rôle'], ['lock', 'Double authentification à la première connexion']],
          cta: authed() ? ivcBtn('button', { id: 'bo-invite-accept', onclick: function () {
              api('fiila_bo_invite_accept', { p_token: token }).then(function () { toast('Bienvenue dans l’équipe.'); BO.me = null; go('#/bo'); }, function (e) {
                if (e.code === 'invite_email_mismatch') setKids(err, h('p', { class: 'msg' }, 'Ce lien a été créé pour une autre adresse e-mail. Déconnectez-vous puis connectez-vous avec le bon compte.'));
                else errBox(err, e);
              });
            } }, 'Rejoindre l’équipe')
            : ivcBtn('a', { href: '#/compte' + qs({ mode: 'inscription', retour: back }), id: 'bo-invite-signup' }, 'Créer mon compte'),
          more: h('div', { class: 'stack tight' },
            authed() ? null : h('a', { class: 'ivc-link', href: '#/compte' + qs({ retour: back }), id: 'bo-invite-login' }, 'J’ai déjà un compte'),
            h('p', { class: 'ivc-note' }, 'Invitation nominative pour ' + r.email + '. Utilisez le compte qui porte cette adresse.')) }),
        err));
    }, function (e) { return page(stateCard('!', 'Invitation indisponible', errText(e), retryBtn())); });
  }

  // ----- Tableau de bord
  function boDashboard() {
    var o = BO.overview || { kpis: {}, queues: {}, days: [] }, k = o.kpis;
    var QUEUE = [['comments', 'flag', 'Commentaires signalés', '#/bo/moderation'], ['vide_dressing', 'users', 'Articles de vide-dressing à vérifier', '#/bo/vide-dressing'],
      ['ambassadors', 'gift', 'Agents à valider', '#/bo/agents'], ['career', 'chat', 'Messages d’agents à lire', '#/bo/carriere'], ['proposals', 'star', 'Propositions du Manager à décider', '#/bo/carriere'], ['rewards', 'cash', 'Gains d’agents à verser', '#/bo/agents'], ['suspended', 'ban', 'Boutiques suspendues', '#/bo/boutiques?f=suspended']];
    var queues = QUEUE.filter(function (x) { return o.queues[x[0]] != null; });
    var todo = queues.reduce(function (n, x) { return n + (x[0] === 'suspended' ? 0 : (o.queues[x[0]] || 0)); }, 0);
    var max = Math.max.apply(null, [1].concat(o.days.map(function (d) { return d.orders; })));
    var total14 = o.days.reduce(function (n, d) { return n + d.orders; }, 0);
    var dayLine = h('p', { class: 'small', id: 'bo-day', 'aria-live': 'polite' }, total14 + ' commande(s) sur 14 jours. Touchez une barre pour le détail du jour.');
    var chart = h('div', { class: 'bo-bars', role: 'img', 'aria-label': 'Commandes par jour sur 14 jours : ' + o.days.map(function (d) { return d.orders; }).join(', ') },
      o.days.map(function (d, i) {
        var dt = new Date(d.day + 'T12:00:00Z');
        var txt = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' : ' + d.orders + ' commande(s), ' + d.shops + ' boutique(s), ' + d.accounts + ' compte(s)';
        return h('button', { class: 'bo-bar' + (i === o.days.length - 1 ? ' today' : ''), type: 'button', title: txt, 'aria-label': txt, onclick: function () { dayLine.textContent = txt; } },
          d.orders ? h('b', null, String(d.orders)) : null, h('i', { style: 'height:' + Math.max(2, Math.round(d.orders / max * 100)) + '%' }), h('span', null, dt.getDate()));
      }));
    var me = BO.me || {}, first = (me.name || me.email || '').split(' ')[0];
    var today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    function mini(id, ic, value, label) { return h('div', { class: 'bo-mini', id: 'kpi-' + id }, h('span', { class: 'bo-mini-ic', 'aria-hidden': 'true' }, icon(ic, 16)), h('b', null, value), h('span', null, label)); }
    return boShell('', 'Tableau de bord', [
      h('section', { class: 'bo-kpis', id: 'bo-kpis' },
        boKpi('shops', 'shop', boNum(k.shops_open) + ' / ' + boNum(k.shops), 'boutiques ouvertes', '+' + (k.shops_7d || 0) + ' en 7 jours', 'green'),
        boKpi('orders', 'box', boNum(k.orders_30d), 'commandes (30 j)', boNum(k.delivered_30d) + ' livrées', 'blue'),
        boKpi('gmv', 'cash', fcfa(k.gmv_30d || 0), 'volume livré (30 j)', null, 'amber'),
        boKpi('accounts', 'user', boNum(k.accounts), 'comptes', '+' + (k.accounts_7d || 0) + ' en 7 jours', 'violet')),
      h('section', { class: 'bo-minis', 'aria-label': 'Autres indicateurs' },
        mini('addresses', 'pin', boNum(k.addresses), 'adresses actives · ' + boNum(k.meetings) + ' événements'),
        mini('couriers', 'moto', boNum(k.couriers), 'livreurs · ' + boNum(k.ambassadors) + ' agents actifs'),
        mini('members', 'users', boNum(k.shop_members || 0), 'membres d’équipe · ' + boNum(k.phones_verified || 0) + ' numéros confirmés'),
        mini('photos', 'cam', boNum(k.multi_photos || 0), 'articles à plusieurs photos · ' + (k.off_format ? boNum(k.off_format) + ' hors format 4:5' : 'toutes au format 4:5')),
        mini('feed', 'heart', boNum(k.feed_left), 'places gratuites restantes sur 25 dans le fil')),
      h('div', { class: 'bo-grid2' },
        h('section', { class: 'card stack tight bo-panel', id: 'bo-queues' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'À traiter'), todo ? boBadge('danger', todo + ' en attente') : boBadge('ok', 'Tout est à jour')),
          queues.length ? queues.map(function (x) {
            var n = o.queues[x[0]];
            return h('a', { class: 'bo-queue' + (n ? '' : ' zero'), href: x[3] }, h('span', { class: 'bo-queue-ic', 'aria-hidden': 'true' }, icon(x[1], 16)), h('span', null, x[2]), h('b', null, String(n)), icon('chev', 16));
          }) : h('p', { class: 'muted small' }, 'Rien pour votre rôle.')),
        h('section', { class: 'card stack tight bo-panel' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'Commandes par jour'), h('span', { class: 'small muted' }, '14 jours')), chart,
          dayLine, h('p', { class: 'small muted' }, 'Hors boutiques de démonstration.')))], { eyebrow: today.charAt(0).toUpperCase() + today.slice(1), sub: 'Bonjour' + (first ? ' ' + first : '') + '. ' + (todo ? todo + ' élément(s) à traiter.' : 'Rien en attente pour le moment.') });
  }

  // ----- Boutiques
  var BO_SHOP_FILTERS = [['', 'Toutes'], ['open', 'Ouvertes'], ['closed', 'Fermées'], ['suspended', 'Suspendues'], ['feed', 'Dans le fil'], ['demo', 'Démo']];
  function boShopState(s) {
    if (s.suspended || s.suspended_at) return boBadge('danger', 'Suspendue');
    if (s.platform) return boBadge('info', 'Fii');
    if (s.demo) return boBadge('muted', 'Démo');
    return s.public ? boBadge('ok', 'Ouverte') : boBadge('muted', 'Fermée');
  }
  function boList(sec, title, fn, args, key, cols, href, filters, q, placeholder) {
    var st = { q: (q && q.q) || '', f: (q && q.f) || '', page: 0 };
    var box = h('div', { class: 'stack', id: 'bo-list' }, boSkel(6));
    var more = h('div');
    var rows = [];
    var seq = 0;
    function load(reset) {
      if (reset) { st.page = 0; rows = []; setKids(box, boSkel(6)); }
      var a = Object.assign({}, args(st), { p_page: st.page }), mine = ++seq;
      api(fn, a).then(function (r) {
        // Réponse périmée (recherche plus récente) ou écran quitté : on ne touche ni à la liste ni à l'adresse.
        if (mine !== seq || !box.isConnected) return;
        rows = rows.concat(r[key]);
        setKids(box, rows.length ? h('p', { class: 'bo-count-line', id: 'bo-count-line' }, rows.length + (r[key].length === 50 ? '+' : '') + ' résultat' + (rows.length > 1 ? 's' : '')) : null,
          boTable(cols, rows, { href: href, id: 'bo-table', emptyId: 'bo-empty', empty: st.q || st.f ? 'Aucun résultat pour cette recherche.' : 'Rien pour le moment.' }));
        setKids(more, r[key].length === 50 ? h('button', { class: 'btn ghost', type: 'button', onclick: function () { st.page++; load(false); } }, 'Voir plus') : null);
        try { history.replaceState(null, '', location.pathname + location.search + '#/bo/' + sec + qs({ q: st.q || undefined, f: st.f || undefined })); } catch (e) { /* rien */ }
      }, function (e) { if (mine === seq && box.isConnected) errBox(box, e); });
    }
    var chips = filters ? h('div') : null;
    function drawChips() { if (chips) setKids(chips, boChips(filters, st.f, function (v) { st.f = v; drawChips(); load(true); }, 'bo-filters')); }
    drawChips(); load(true);
    return boShell(sec, title, [h('div', { class: 'bo-tools' }, boSearch(st.q, placeholder, function (v) { st.q = v; load(true); }), chips), box, more]);
  }
  function boShops(q) {
    return boList('boutiques', 'Boutiques', 'fiila_bo_shops', function (st) { return { p_q: st.q || null, p_filter: st.f || null }; }, 'shops', [
      { label: 'Boutique', get: function (s) { return h('span', { class: 'bo-cell' }, boAv(s.name), h('span', null, s.name)); } },
      { label: 'Type', get: function (s) { return typeLabel(s.type) || '—'; }, cls: 'hide-s' },
      { label: 'État', get: boShopState },
      { label: 'Fil', get: function (s) { return s.rank ? 'Place ' + s.rank : '—'; } },
      { label: 'Articles', get: function (s) { return String(s.products); }, cls: 'num' },
      { label: 'Commandes', get: function (s) { return String(s.orders); }, cls: 'num' },
      { label: 'Créée', get: function (s) { return boDate(s.created_at); } }],
      function (s) { return '#/bo/boutiques/' + s.id; }, BO_SHOP_FILTERS, q, 'Nom, lien ou téléphone');
  }
  function boShop(id) {
    return api('fiila_bo_shop', { p_id: id }).then(function (s) {
      var st = s.stats;
      function row(label, value) { return h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, label), h('span', { class: 'wrapword' }, value)); }
      var reason = h('input', { type: 'text', id: 'bo-suspend-reason', maxlength: 300, placeholder: 'Motif (visible dans le journal)' });
      var actions = (boCan('shops_suspend') || boCan('feed')) && !s.platform ? h('section', { class: 'card stack tight', id: 'bo-shop-actions' }, h('h2', null, 'Actions'),
        !boCan('shops_suspend') ? null : s.suspended_at ? [h('p', { class: 'small' }, 'Suspendue le ' + boDate(s.suspended_at, true) + ' : ' + (s.suspended_reason || '')),
            h('button', { class: 'btn', type: 'button', id: 'bo-unsuspend', onclick: function () { boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: 'unsuspend' }); }, 'Boutique réactivée. Elle peut rouvrir sa vitrine.', null, null, this); } }, 'Réactiver la boutique')]
          : [h('p', { class: 'small muted' }, 'La suspension ferme la vitrine et la retire du fil. La boutique ne peut pas la rouvrir elle-même.'),
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Motif de suspension'), reason),
            h('button', { class: 'btn danger', type: 'button', id: 'bo-suspend', onclick: function () {
              if (!reason.value.trim()) { toast('Indiquez un motif.'); reason.focus(); return; }
              boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: 'suspend', p_value: reason.value }); }, 'Boutique suspendue.', null, null, this);
            } }, 'Suspendre la boutique')],
        boCan('feed') && s.rank ? h('div', { class: 'row' },
          h('button', { class: 'btn ghost small', type: 'button', id: 'bo-feed-toggle', onclick: function () { boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: s.feed ? 'feed_off' : 'feed_on' }); }, s.feed ? 'Retirée du fil.' : 'Remise dans le fil.', null, null, this); } }, s.feed ? 'Retirer du fil' : 'Remettre dans le fil'),
          h('button', { class: 'btn quiet danger-text', type: 'button', id: 'bo-free-place', onclick: function () {
            if (!window.confirm || window.confirm('Libérer la place n° ' + s.rank + ' ? Elle ira à la plus ancienne boutique en attente.')) boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: 'free_place' }); }, 'Place libérée.', null, null, this);
          } }, 'Libérer la place n° ' + s.rank)) : null) : null;
      var typeSel = boCan('shops_write') ? h('select', { id: 'bo-shop-type', 'aria-label': 'Type de commerce', onchange: function (e) {
          var sel = e.target, v = sel.value || null;
          boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: 'set_type', p_value: v }); }, 'Type enregistré.', function () { s.type = v; },
            function () { sel.value = s.type || ''; });
        } }, h('option', { value: '' }, '—'), BUSINESS_TYPES.map(function (t) { return h('option', { value: t[0], selected: s.type === t[0] || null }, t[1]); })) : (typeLabel(s.type) || '—');
      return boShell('boutiques', s.name, [
        boHero(s.name, [boShopState(s), s.rank ? boBadge('info', 'Fil · place ' + s.rank + (s.feed ? '' : ' (masquée)')) : null, s.type ? boBadge('muted', typeLabel(s.type)) : null],
          [s.slug ? '/b/' + s.slug : 'Vitrine sans lien', s.phone, 'créée le ' + boDate(s.created_at)].filter(Boolean).join(' · ')),
        h('div', { class: 'bo-kpis small' },
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.products)), h('span', null, 'articles'), st.multi_photos ? h('small', { class: 'muted' }, boNum(st.multi_photos) + ' à plusieurs photos') : null,
            st.off_format ? h('small', { class: 'bo-warn', id: 'bo-shop-off-format' }, boNum(st.off_format) + ' hors format 4:5 (recadrées à la prochaine modification)') : null),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.orders)), h('span', null, 'commandes'), h('small', { class: 'muted' }, boNum(st.delivered) + ' livrées')),
          h('div', { class: 'bo-kpi' }, h('strong', null, fcfa(st.gmv)), h('span', null, 'volume livré')),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.customers)), h('span', null, 'clients')),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.likes) + ' ♥'), h('span', null, boNum(st.comments) + ' commentaires'))),
        h('div', { class: 'bo-grid2' },
          h('section', { class: 'card stack tight', id: 'bo-shop-info' }, h('h2', null, 'Informations'),
            row('Vitrine', s.slug ? h('a', { href: '#/b/' + s.slug }, '/b/' + s.slug) : '—'),
            row('Téléphone', s.phone || '—'),
            row('Type', typeSel),
            row('Accès', s.access === 'account' ? 'Compte' : 'Clé du téléphone (sans compte)'),
            s.owner ? row('Propriétaire', h('a', { href: '#/bo/comptes/' + s.owner.id }, s.owner.email)) : null,
            s.ambassador ? row('Agent', s.ambassador) : null,
            row('Créée', boDate(s.created_at, true)),
            s.about ? row('Présentation', s.about) : null),
          actions),
        s.marketing ? h('section', { class: 'card stack tight', id: 'bo-shop-marketing' }, h('h2', null, 'Marketing · 30 jours'),
          row('Visites de la vitrine', boNum(s.marketing.views_30)),
          row('Commandes via la vitrine', boNum(s.marketing.vitrine_orders_30)),
          row('Publications', boNum(s.marketing.posts_30)),
          row('Réseaux', s.marketing.socials ? h('span', null, SOCIALS.filter(function (o) { return s.marketing.socials[o[0]]; }).map(function (o, i) {
            return [i ? ' · ' : null, h('a', { href: socialUrl(o[0], s.marketing.socials[o[0]]), target: '_blank', rel: 'noopener noreferrer' }, o[1] + ' @' + s.marketing.socials[o[0]])];
          })) : '—')) : null,
        boShopTeam(s, id),
        s.recent_orders ? h('section', { class: 'stack tight' }, h('h2', null, 'Dernières commandes'),
          boTable([{ label: 'N°', get: function (o) { return String(o.number).padStart(4, '0'); } }, { label: 'Total', get: function (o) { return fcfa(o.total); }, cls: 'num' },
            { label: 'Statut', get: boOrderState }, { label: 'Date', get: function (o) { return boDate(o.created_at, true); } }], s.recent_orders || [],
            { href: function (o) { return '#/bo/commandes/' + o.id; }, empty: 'Aucune commande.' })) : null,
        s.log ? h('section', { class: 'stack tight', id: 'bo-shop-log' }, h('h2', null, 'Historique de l’équipe'),
          s.log.map(function (l) { return h('p', { class: 'small' }, h('span', { class: 'muted' }, boDate(l.at, true) + ' · ' + boActor(l.actor) + ' · '), boActionLabel(l.action, l.detail)); })) : null
      ], { back: ['#/bo/boutiques', 'Boutiques'] });
    }, function (e) { return boShell('boutiques', 'Boutique', stateCard('!', 'Boutique introuvable', errText(e)), { back: ['#/bo/boutiques', 'Boutiques'] }); });
  }

  // ----- Commandes
  function boOrderState(o) { return o.status === 'delivered' ? boBadge('ok', 'Livrée') : o.status === 'cancelled' ? boBadge('muted', 'Annulée') : boBadge('warn', 'En cours'); }
  function boOrders(q) {
    return boList('commandes', 'Commandes', 'fiila_bo_orders', function (st) { return { p_q: st.q || null, p_status: st.f || null }; }, 'orders', [
      { label: 'N°', get: function (o) { return String(o.number).padStart(4, '0'); } },
      { label: 'Boutique', get: function (o) { return o.shop + (o.demo ? ' (démo)' : ''); } },
      { label: 'Client', get: function (o) { return o.customer; } },
      { label: 'Total', get: function (o) { return fcfa(o.total); }, cls: 'num' },
      { label: 'Statut', get: boOrderState },
      { label: 'Date', get: function (o) { return boDate(o.created_at, true); } }],
      function (o) { return '#/bo/commandes/' + o.id; }, [['', 'Toutes'], ['open', 'En cours'], ['delivered', 'Livrées'], ['cancelled', 'Annulées']], q, 'Boutique, client, numéro ou téléphone');
  }
  function boOrder(id) {
    return api('fiila_bo_order', { p_id: id }).then(function (o) {
      function row(label, value) { return h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, label), h('span', { class: 'wrapword' }, value)); }
      return boShell('commandes', 'Commande n° ' + String(o.number).padStart(4, '0'), [
        boHero(o.customer || 'Client', [boOrderState(o), h('b', { class: 'bo-amount' }, fcfa(o.total))], o.shop.name + ' · ' + boDate(o.created_at, true)),
        h('div', { class: 'bo-grid2' },
          h('section', { class: 'card stack tight', id: 'bo-order-info' }, h('h2', null, 'Commande'),
            row('Boutique', h('a', { href: '#/bo/boutiques/' + o.shop.id }, o.shop.name)),
            row('Client', o.customer), row('Téléphone', o.phone || '—'),
            row('Adresse', o.address === 'received' ? 'Reçue' : o.address === 'pending' ? 'Demandée, pas encore donnée' : 'Aucune'),
            row('Créée', boDate(o.created_at, true)),
            o.delivered_at ? row('Livrée', boDate(o.delivered_at, true)) : null,
            o.cancelled_at ? row('Annulée', boDate(o.cancelled_at, true)) : null,
            o.note ? row('Note', o.note) : null),
          h('section', { class: 'card stack tight', id: 'bo-order-items' }, h('h2', null, 'Articles'),
            (o.items || []).map(function (it) { return row((it.qty || 1) + ' × ' + (it.label || ''), fcfa((it.price || 0) * (it.qty || 1))); }),
            row(h('b', null, 'Total'), h('b', null, fcfa(o.total))),
            row('Encaissé', fcfa(o.paid)),
            (o.payments || []).map(function (p) { return h('p', { class: 'small muted' }, boDate(p.at, true) + ' · ' + fcfa(p.amount) + ' · ' + (({ cash: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', card: 'Carte', other: 'Autre' })[p.method] || p.method)); })))
      ], { back: ['#/bo/commandes', 'Commandes'] });
    }, function (e) { return boShell('commandes', 'Commande', stateCard('!', 'Commande introuvable', errText(e)), { back: ['#/bo/commandes', 'Commandes'] }); });
  }

  // ----- Comptes
  function boAccounts(q) {
    return boList('comptes', 'Comptes', 'fiila_bo_accounts', function (st) { return { p_q: st.q || null }; }, 'accounts', [
      { label: 'Nom', get: function (a) { return h('span', { class: 'bo-cell' }, boAv(a.name || a.email), h('span', null, a.name || '—')); } },
      { label: 'E-mail', get: function (a) { return a.email; } },
      { label: 'Boutique', get: function (a) { return a.shop || '—'; }, cls: 'hide-s' },
      { label: 'Rôle', get: function (a) { return a.role ? boBadge('info', BO_ROLES[a.role]) : a.ambassador ? boBadge('muted', 'Agent') : '—'; } },
      { label: 'Créé', get: function (a) { return boDate(a.created_at); } }],
      function (a) { return '#/bo/comptes/' + a.id; }, null, q, 'Nom ou e-mail');
  }
  // Équipe de la boutique (membres invités par le commerçant) : rôle, numéro confirmé, retrait par l'équipe Fii.
  var SHOP_ROLE_LABEL = { admin: 'Administrateur', editor: 'Éditeur' };
  function boShopTeam(s, id) {
    var t = s.team || { members: [] };
    if (!t.members.length && !t.invites) return null;
    return h('section', { class: 'stack tight', id: 'bo-shop-team' }, h('h2', null, 'Équipe de la boutique'),
      boTable([
        { label: 'Membre', get: function (m) { return m.email && boCan('accounts') ? h('a', { href: '#/bo/comptes/' + m.id }, m.name) : m.name; } },
        { label: 'Rôle', get: function (m) { return SHOP_ROLE_LABEL[m.role] || m.role; } },
        { label: 'Numéro', get: function (m) { return m.verified ? boBadge('ok', 'Confirmé par SMS') : boBadge('muted', 'Non confirmé'); } },
        { label: 'Depuis', get: function (m) { return boDate(m.since); } },
        { label: '', get: function (m) {
          return boCan('shops_write') ? h('button', { class: 'btn quiet danger-text small', type: 'button', onclick: function () {
            if (window.confirm && !window.confirm('Retirer ' + m.name + ' de l’équipe de ' + s.name + ' ? Son accès s’arrête aussitôt.')) return;
            boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: 'member_remove', p_value: m.id }); }, m.name + ' retiré(e) de l’équipe.', null, null, this);
          } }, 'Retirer') : '';
        } }], t.members, { id: 'bo-shop-members', empty: 'Aucun membre.' }),
      t.invites ? h('p', { class: 'small muted' }, t.invites + ' invitation(s) en attente (valables 7 jours).') : null);
  }
  function boAccount(id) {
    return api('fiila_bo_account', { p_id: id }).then(function (a) {
      function row(label, value) { return h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, label), h('span', { class: 'wrapword' }, value)); }
      var AMB = { training: 'En formation', review: 'À valider', active: 'Actif', suspended: 'Suspendu', excluded: 'Exclu' };
      return boShell('comptes', a.name || a.email, [
        boHero(a.name || a.email, [a.role ? boBadge('info', BO_ROLES[a.role]) : null, a.ambassador ? boBadge('muted', 'Agent') : null, a.shop ? boBadge('ok', 'Commerçant') : null, a.phone_verified ? boBadge('ok', 'Numéro confirmé') : null],
          a.email + ' · inscrit le ' + boDate(a.created_at)),
        h('section', { class: 'card stack tight', id: 'bo-account-info' },
          row('E-mail', a.email), row('Téléphone', a.phone || '—'), row('Créé', boDate(a.created_at, true)),
          row('Équipe', a.role ? BO_ROLES[a.role] : '—'),
          row('Numéro confirmé', a.phone_verified ? boBadge('ok', a.phone_verified) : '—'),
          row('Boutique', a.shop ? h('a', { href: '#/bo/boutiques/' + a.shop.id }, a.shop.name) : a.member_of ? h('span', null, h('a', { href: '#/bo/boutiques/' + a.member_of.id }, a.member_of.name), ' · ' + (SHOP_ROLE_LABEL[a.member_of.role] || a.member_of.role)) : '—'),
          row('Agent', a.ambassador ? (AMB[a.ambassador.status] || a.ambassador.status) + ' · code ' + a.ambassador.code : '—'),
          row('Adresses', boNum(a.counts.addresses)), row('Événements', boNum(a.counts.meetings)),
          row('Commentaires', boNum(a.counts.comments)), row('Articles de vide-dressing', boNum(a.counts.vide_dressing))),
        a.role && boCan('team') ? h('a', { class: 'btn ghost', href: '#/bo/equipe' }, 'Gérer son rôle dans l’équipe') : null
      ], { back: ['#/bo/comptes', 'Comptes'] });
    }, function (e) { return boShell('comptes', 'Compte', stateCard('!', 'Compte introuvable', errText(e)), { back: ['#/bo/comptes', 'Comptes'] }); });
  }

  // ----- Ambassadeurs (Fii Carrière) : files « à valider » et « à verser », liste filtrable, fiche avec toutes les actions.
  var AMB_ST = { training: ['muted', 'En formation'], review: ['warn', 'À valider'], active: ['ok', 'Actif'], suspended: ['danger', 'Suspendu'], excluded: ['muted', 'Exclu'] };
  function boAmbState(a) { var x = AMB_ST[a.status] || ['muted', a.status]; return boBadge(x[0], x[1]); }
  function boAmbDecide(a, decision, note, btn, okText, after) {
    return boAct(function () { return api('fiila_admin_ambassador_decide', { p_id: a.id, p_decision: decision, p_note: note || null }); }, okText || 'Enregistré.', after || null, null, btn);
  }
  function boAmbassadors(q) {
    return api('fiila_admin_ambassadors', {}).then(function (d) {
      var st = { q: (q && q.q) || '', f: (q && q.f) || '' };
      var all = d.ambassadors, review = all.filter(function (a) { return a.status === 'review'; });
      var toPay = d.to_pay.reduce(function (n, r) { return n + r.amount; }, 0);
      var paid = all.reduce(function (n, a) { return n + (a.paid || 0); }, 0);
      var byAmb = {}; d.to_pay.forEach(function (r) { var k = r.ambassador + '|' + r.payout_method + '|' + r.payout_phone; (byAmb[k] = byAmb[k] || []).push(r); });
      var FILTERS = [['', 'Tous'], ['active', 'Actifs'], ['review', 'À valider'], ['training', 'En formation'], ['suspended', 'Suspendus'], ['excluded', 'Exclus']];
      var listBox = h('div', { class: 'stack tight' }), chips = h('div');
      function draw() {
        var t = st.q.toLowerCase();
        var rows = all.filter(function (a) { return (!st.f || a.status === st.f) && (!t || [a.name, a.code, a.phone, a.email, a.zone].join(' ').toLowerCase().indexOf(t) >= 0); });
        setKids(chips, boChips(FILTERS, st.f, function (v) { st.f = v; draw(); }, 'bo-amb-filters'));
        setKids(listBox, rows.length ? h('p', { class: 'bo-count-line' }, rows.length + ' agent' + (rows.length > 1 ? 's' : '')) : null,
          boTable([
            { label: 'Agent', get: function (a) { return h('span', { class: 'bo-cell' }, boAv(a.name), h('span', { class: 'stack tight', style: 'gap:0' }, h('span', null, a.name), h('small', { class: 'muted' }, a.code))); } },
            { label: 'Statut', get: boAmbState },
            { label: 'Grade', get: function (a) { return GRADES[a.grade] || '—'; }, cls: 'hide-s' },
            { label: 'Commerçants', get: function (a) { return a.shops + (a.active_shops ? ' · ' + a.active_shops + ' actifs' : ''); }, cls: 'num' },
            { label: 'Gains', get: function (a) { return fcfa(a.earned || 0); }, cls: 'num' },
            { label: 'Inscrit', get: function (a) { return boDate(a.created_at); } }],
            rows, { href: function (a) { return '#/bo/agents/' + a.id; }, id: 'bo-amb-table', empty: st.q || st.f ? 'Aucun agent pour cette recherche.' : 'Aucun agent pour le moment.' }));
        try { history.replaceState(null, '', location.pathname + location.search + '#/bo/agents' + qs({ q: st.q || undefined, f: st.f || undefined })); } catch (e) { /* rien */ }
      }
      draw();
      var qs10 = (d.quiz_stats || []).slice().sort(function (x, y) { return y.wrong - x.wrong; }), runs = qs10.length ? qs10[0].answered : 0;
      return boShell('agents', 'Agents', [
        h('section', { class: 'bo-kpis' },
          boKpi('amb-active', 'star', boNum(all.filter(function (a) { return a.status === 'active'; }).length), 'agents actifs', boNum(all.filter(function (a) { return a.status === 'training'; }).length) + ' en formation', 'green'),
          boKpi('amb-review', 'clock', boNum(review.length), 'à valider', review.length ? 'test réussi, en attente' : 'aucune attente', review.length ? 'amber' : 'blue'),
          boKpi('amb-topay', 'cash', fcfa(toPay), 'à verser', d.pending.length + ' gain(s) en vérification', 'violet'),
          boKpi('amb-paid', 'check', fcfa(paid), 'déjà versés', null, 'blue')),
        review.length ? h('section', { class: 'card stack tight bo-panel', id: 'adm-review' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'À valider'), boBadge('warn', String(review.length))),
          review.map(function (a) {
            var note = h('input', { type: 'text', id: 'note-' + a.id, placeholder: 'Note (facultatif)', maxlength: 200 });
            return h('div', { class: 'bo-req' }, boAv(a.name),
              h('div', { class: 'stack tight', style: 'flex:1;min-width:0' }, h('b', { class: 'wrapword' }, a.name),
                h('span', { class: 'small muted wrapword' }, [a.phone, a.zone, 'test ' + a.quiz_score + '/10', a.email].filter(Boolean).join(' · ')), note,
                h('div', { class: 'row' },
                  h('button', { class: 'btn small', type: 'button', onclick: function () { boAmbDecide(a, 'approve', note.value, this, a.name + ' validé.'); } }, 'Valider'),
                  h('button', { class: 'btn quiet danger-text small', type: 'button', onclick: function () { if (!window.confirm || window.confirm('Refuser ' + a.name + ' ? Son profil sera exclu du programme.')) boAmbDecide(a, 'exclude', note.value || 'Inscription refusée', this, 'Inscription refusée.'); } }, 'Refuser'),
                  h('a', { class: 'btn link small', href: '#/bo/agents/' + a.id }, 'Voir la fiche'))));
          })) : null,
        Object.keys(byAmb).length ? h('section', { class: 'card stack tight bo-panel', id: 'adm-pay' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'À verser'), h('b', null, fcfa(toPay))),
          Object.keys(byAmb).map(function (k) {
            var l = byAmb[k], p = k.split('|'), sum = l.reduce(function (n, r) { return n + r.amount; }, 0);
            return h('div', { class: 'bo-req' }, boAv(p[0]),
              h('div', { class: 'stack tight', style: 'flex:1;min-width:0' }, h('b', null, p[0] + ' · ' + fcfa(sum)), h('span', { class: 'small muted' }, (PAYOUT[p[1]] || p[1]) + ' ' + p[2]),
                l.map(function (r) { return h('span', { class: 'small' }, r.shop + ' · niveau ' + r.level + ' · ' + fcfa(r.amount)); }),
                h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', onclick: function () {
                  if (window.confirm && !window.confirm('Confirmer le versement de ' + fcfa(sum) + ' à ' + p[0] + ' sur ' + (PAYOUT[p[1]] || p[1]) + ' ' + p[2] + ' ?')) return;
                  boAct(function () { return api('fiila_admin_reward', { p_ids: l.map(function (r) { return r.id; }), p_action: 'paid', p_reason: null }); }, 'Marqué versé.', null, null, this);
                } }, 'J’ai versé ' + fcfa(sum))));
          })) : null,
        h('div', { class: 'bo-tools' }, boSearch(st.q, 'Nom, code, téléphone ou e-mail', function (v) { st.q = v; draw(); }), chips),
        listBox,
        h('details', { class: 'card more-sec', id: 'adm-pending' }, h('summary', null, 'Gains en vérification (' + d.pending.length + ')'),
          h('div', { class: 'stack tight', style: 'margin-top:10px' }, d.pending.length ? d.pending.map(function (r) {
            var reason = h('input', { type: 'text', placeholder: 'Motif', maxlength: 200, style: 'max-width:160px' });
            return h('div', { class: 'item' }, h('span', { class: 'small wrapword', style: 'flex:1' }, r.ambassador + ' · ' + r.shop + ' · niveau ' + r.level + ' · ' + fcfa(r.amount) + ' · le ' + shortDate(r.validate_after)), reason,
              h('button', { class: 'btn quiet danger-text small', type: 'button', onclick: function () {
                if (!reason.value.trim()) { toast('Indiquez un motif.'); reason.focus(); return; }
                boAct(function () { return api('fiila_admin_reward', { p_ids: [r.id], p_action: 'cancel', p_reason: reason.value }); }, 'Gain annulé.', null, null, this);
              } }, 'Annuler'));
          }) : h('p', { class: 'muted small' }, 'Aucun gain en vérification.'))),
        h('details', { class: 'card more-sec', id: 'adm-quiz' }, h('summary', null, 'Test de passage : questions manquées'),
          !runs ? h('p', { class: 'muted', style: 'margin-top:10px' }, 'Aucun test terminé pour l’instant.') : h('div', { class: 'stack tight', style: 'margin-top:10px' },
            h('p', { class: 'small muted' }, runs + ' test(s) terminé(s). Une question souvent manquée : la fiche correspondante est à clarifier.'),
            qs10.map(function (x) {
              var pct = Math.round(x.wrong / runs * 100);
              return h('div', { class: 'stack tight' }, h('div', { class: 'total-row' }, h('span', { class: 'small wrapword' }, (x.q + 1) + '. ' + AMB_QUIZ[x.q][0]), h('b', { class: 'small' }, pct + ' %')),
                h('div', { class: 'wal-bar', 'aria-hidden': 'true' }, h('i', { class: pct >= 40 ? 'wait' : 'paid', style: 'width:' + pct + '%' })));
            }))),
        h('p', { class: 'small muted' }, 'Gains : ' + d.settings.rewards.map(fcfa).join(' · ') + ' par niveau. Plafond : ' + d.settings.monthly_cap + ' commerçants par mois et par agent (Réglages).')
      ], { sub: 'Inscriptions, gains et versements de Fii Carrière.' });
    }, function (e) { return boShell('agents', 'Agents', stateCard('!', 'Chargement impossible', errText(e))); });
  }
  function boAmbassador(id) {
    var back = ['#/bo/agents', 'Agents'];
    return api('fiila_admin_ambassadors', {}).then(function (d) {
      var a = d.ambassadors.filter(function (x) { return x.id === id; })[0];
      if (!a) return boShell('agents', 'Agent', stateCard('?', 'Profil introuvable', 'Ce profil a peut-être été supprimé.'), { back: back });
      function row(label, value) { return h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, label), h('span', { class: 'wrapword' }, value)); }
      var note = h('input', { type: 'text', id: 'bo-amb-note', maxlength: 200, placeholder: 'Motif ou note (visible par l’agent)' });
      function btn(decision, label, cls, ask, okText, idx) {
        return h('button', { class: 'btn ' + cls, type: 'button', id: 'bo-amb-' + (idx || decision), onclick: function () {
          if (ask && window.confirm && !window.confirm(ask)) return;
          boAmbDecide(a, decision, note.value, this, okText);
        } }, label);
      }
      var acts = [];
      if (a.status === 'review') acts.push(btn('approve', 'Valider le profil', '', null, 'Profil validé.'), btn('exclude', 'Refuser', 'quiet danger-text', 'Refuser ' + a.name + ' ? Son profil sera exclu.', 'Inscription refusée.'));
      if (a.status === 'active') acts.push(btn('suspend', 'Suspendre', 'ghost', 'Suspendre ' + a.name + ' ? Ses nouveaux gains sont mis en pause.', 'Agent suspendu.'));
      if (a.status === 'suspended') acts.push(btn('reactivate', 'Réactiver', '', null, 'Agent réactivé.'));
      if (['review', 'active', 'suspended'].indexOf(a.status) >= 0) acts.push(btn('training', 'Renvoyer en formation', 'ghost', a.name + ' devra refaire la formation et le test. Continuer ?', 'Renvoyé en formation.'));
      if (a.status === 'active' || a.status === 'suspended') acts.push(btn('exclude', 'Exclure', 'quiet danger-text', 'Exclure ' + a.name + ' ? Les gains non versés seront annulés.', 'Agent exclu.', 'exclude2'));
      var canDelete = !(a.paid > 0);
      var del = h('section', { class: 'card stack tight bo-danger', id: 'bo-amb-danger' }, h('h2', null, 'Zone sensible'),
        canDelete ? [h('p', { class: 'small' }, 'Supprimer le profil efface l’inscription, les tests, les liens avec les commerçants et les gains non versés. Le compte de la personne reste : elle pourra recommencer l’inscription.'),
          h('button', { class: 'btn danger', type: 'button', id: 'bo-amb-delete', onclick: function () {
            if (window.confirm && !window.confirm('Supprimer définitivement le profil agent de ' + a.name + ' (code ' + a.code + ') ?')) return;
            boAmbDecide(a, 'delete', null, this, 'Profil agent supprimé.', function () { go('#/bo/agents'); });
          } }, 'Supprimer le profil agent')]
          : h('p', { class: 'small' }, 'Ce profil a déjà reçu ' + fcfa(a.paid) + ' de versements : il ne peut pas être supprimé (trace financière). Excluez-le si besoin.'));
      return boShell('agents', a.name, [
        boHero(a.name, [boAmbState(a), boBadge('info', GRADES[a.grade] || 'Agent'), h('span', { class: 'bo-code-tag' }, a.code)], [a.email, a.phone, a.zone].filter(Boolean).join(' · ')),
        h('div', { class: 'bo-kpis' },
          boKpi(null, 'shop', boNum(a.shops), 'commerçants', boNum(a.month) + ' ce mois-ci', 'green'),
          boKpi(null, 'star', boNum(a.active_shops || 0), 'commerçants actifs', 'niveau 2 atteint', 'blue'),
          boKpi(null, 'cash', fcfa(a.earned || 0), 'gains', a.cancelled ? a.cancelled + ' annulé(s)' : null, 'amber'),
          boKpi(null, 'check', fcfa(a.paid || 0), 'déjà versés', null, 'violet')),
        h('div', { class: 'bo-grid2' },
          h('section', { class: 'card stack tight', id: 'bo-amb-info' }, h('h2', null, 'Profil'),
            row('Code', a.code), row('E-mail du compte', a.email || '—'), row('Téléphone', a.phone), row('Quartier', a.zone || '—'),
            row('Versements', (PAYOUT[a.payout_method] || a.payout_method) + ' ' + a.payout_phone),
            row('Inscrit', boDate(a.created_at, true)), row('Validé', a.approved_at ? boDate(a.approved_at, true) : '—'),
            row('Test', a.quiz_score != null ? a.quiz_score + '/10 · ' + (a.attempts || 0) + ' essai(s)' : (a.attempts ? a.attempts + ' essai(s), pas encore réussi' : 'pas encore passé')),
            a.note ? row('Note', a.note) : null),
          h('section', { class: 'card stack tight', id: 'bo-amb-actions' }, h('h2', null, 'Actions'),
            acts.length ? [h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Motif ou note'), note), h('div', { class: 'row wrap' }, acts)]
              : h('p', { class: 'small muted' }, a.status === 'training' ? 'En formation : rien à décider tant que le test n’est pas réussi.' : 'Profil exclu : aucune action possible.'))),
        del
      ], { back: back });
    }, function (e) { return boShell('agents', 'Agent', stateCard('!', 'Chargement impossible', errText(e)), { back: back }); });
  }

  // ----- Manager Fii Carrière (back-office) : cap du mois, propositions, conversations, missions.
  var NOTE_KIND = { training: ['info', 'Formation'], mission: ['ok', 'Mission'], insight: ['muted', 'Constat'] };
  function boCareer() {
    return api('fiila_bo_career', {}).then(function (d) {
      var o = d.objective, rep = (d.report && d.report.data) || {};
      function pct(n, t) { return t ? Math.min(100, Math.round(n / t * 100)) + ' %' : '—'; }
      function objectiveSheet() {
        var f = { target_active: o ? o.target_active : 0, target_new: o ? o.target_new : 0, types: (o && o.focus_types) || [], zones: ((o && o.focus_zones) || []).join(', '), brief: (o && o.brief) || '' };
        var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-obj-h', id: 'bo-obj-sheet' },
          h('form', { class: 'sheet stack bo-sheet', onsubmit: function (e) {
            e.preventDefault();
            boAct(function () { return api('fiila_bo_objective_set', { p: { target_active: parseInt(f.target_active, 10) || 0, target_new: parseInt(f.target_new, 10) || 0, focus_types: f.types,
              focus_zones: f.zones.split(',').map(function (z) { return z.trim(); }).filter(Boolean), brief: f.brief } }); }, 'Cap du mois enregistré.', function () { close(); render(); }, null, e.submitter);
          } }, h('h2', { id: 'bo-obj-h' }, 'Cap du mois'),
            h('p', { class: 'small muted' }, 'Le Manager oriente chaque jour les missions des agents selon ce cap. Chacun lit la phrase du cap dans son espace.'),
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Le cap, en une phrase'), h('textarea', { id: 'bo-obj-brief', rows: 2, maxlength: 300, placeholder: 'Ex. : priorité aux restaurants de Yoff et Ouakam.', oninput: function (e) { f.brief = e.target.value; } }, f.brief)),
            h('div', { class: 'duo' },
              h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Commerçants actifs visés'), h('input', { type: 'number', min: 0, id: 'bo-obj-active', value: f.target_active, oninput: function (e) { f.target_active = e.target.value; } })),
              h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Nouveaux commerçants visés'), h('input', { type: 'number', min: 0, id: 'bo-obj-new', value: f.target_new, oninput: function (e) { f.target_new = e.target.value; } }))),
            h('fieldset', { class: 'bo-fs' }, h('legend', { class: 'lbl' }, 'Types de commerce prioritaires (6 au plus)'),
              h('div', { class: 'bo-type-chips' }, BUSINESS_TYPES.map(function (t) {
                var b = h('button', { type: 'button', class: 'opt' + (f.types.indexOf(t[0]) >= 0 ? ' on' : ''), 'aria-pressed': String(f.types.indexOf(t[0]) >= 0), onclick: function () {
                  var i = f.types.indexOf(t[0]); if (i >= 0) f.types.splice(i, 1); else if (f.types.length < 6) f.types.push(t[0]);
                  b.classList.toggle('on', f.types.indexOf(t[0]) >= 0); b.setAttribute('aria-pressed', String(f.types.indexOf(t[0]) >= 0));
                } }, t[1]);
                return b;
              }))),
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Quartiers prioritaires (séparés par des virgules)'), h('input', { type: 'text', id: 'bo-obj-zones', value: f.zones, maxlength: 200, oninput: function (e) { f.zones = e.target.value; } })),
            h('button', { class: 'btn', type: 'submit', id: 'bo-obj-save' }, 'Enregistrer le cap'),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler')));
        var close = openSheet(back);
      }
      function missionSheet() {
        var f = { kind: 'daily', audience: 'active', title: '', body: '' };
        var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-mis-h', id: 'bo-mis-sheet' },
          h('form', { class: 'sheet stack bo-sheet', onsubmit: function (e) {
            e.preventDefault();
            boAct(function () { return api('fiila_bo_mission_save', { p: f }); }, 'Mission ajoutée.', function () { close(); render(); }, null, e.submitter);
          } }, h('h2', { id: 'bo-mis-h' }, 'Nouvelle mission'),
            segField({ name: 'bo-mis-kind', id: 'bo-mis-kind', legend: 'Type', value: f.kind, options: [['daily', 'Terrain'], ['training', 'Formation']], onChange: function (v) { f.kind = v; } }),
            textField({ id: 'bo-mis-title', label: 'Mission, en une phrase d’action', max: 120, onInput: function (v) { f.title = v; } }),
            textField({ id: 'bo-mis-body', label: 'Précision', optional: true, max: 400, onInput: function (v) { f.body = v; } }),
            segField({ name: 'bo-mis-aud', id: 'bo-mis-aud', legend: 'Pour', value: f.audience, options: [['active', 'Agents actifs'], ['all', 'Tous']], onChange: function (v) { f.audience = v; } }),
            h('button', { class: 'btn', type: 'submit', id: 'bo-mis-save' }, 'Ajouter'),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler')));
        var close = openSheet(back);
      }
      var open = d.notes.filter(function (n) { return n.status === 'open'; }), infos = d.notes.filter(function (n) { return n.status === 'info'; });
      var analyse = d.can_strategy && d.llm ? h('button', { class: 'btn ghost small', type: 'button', id: 'bo-career-ai', onclick: function () {
        var b = this; b.disabled = true; b.textContent = 'Analyse en cours…';
        freshToken().then(function () { return fetch(API_URL + '/functions/v1/fiila-manager', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ action: 'digest' }) }); })
          .then(function (r) { return r.json(); }).then(function (r) { toast(r.items ? r.items + ' proposition(s) du Manager.' : 'Analyse faite : rien de nouveau.'); render(); }, function () { b.disabled = false; b.textContent = 'Analyser avec l’IA'; toast('Analyse indisponible pour le moment.'); });
      } }, icon('star', 14), ' Analyser avec l’IA') : null;
      return boShell('carriere', 'Manager Carrière', [
        h('section', { class: 'bo-kpis' },
          boKpi('car-active', 'star', (d.progress.active || 0) + (o && o.target_active ? ' / ' + o.target_active : ''), 'commerçants actifs ce mois', o && o.target_active ? pct(d.progress.active, o.target_active) + ' de l’objectif' : 'objectif à fixer', 'green'),
          boKpi('car-new', 'shop', (d.progress.new || 0) + (o && o.target_new ? ' / ' + o.target_new : ''), 'nouveaux commerçants', o && o.target_new ? pct(d.progress.new, o.target_new) + ' de l’objectif' : null, 'blue'),
          boKpi('car-tasks', 'check', (rep.done_7d || 0) + ' / ' + (rep.tasks_7d || 0), 'missions faites (7 j)', rep.tasks_7d ? pct(rep.done_7d, rep.tasks_7d) : null, 'amber'),
          boKpi('car-msg', 'chat', boNum(rep.messages_7d || 0), 'messages d’agents (7 j)', Object.keys(rep.tags_7d || {}).length ? Object.keys(rep.tags_7d).map(function (k) { return k + ' ' + rep.tags_7d[k]; }).join(' · ') : null, 'violet')),
        h('div', { class: 'bo-grid2' },
          h('section', { class: 'card stack tight bo-panel', id: 'bo-objective' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'Cap du mois'),
              d.can_strategy ? h('button', { class: 'btn ghost small', type: 'button', id: 'bo-obj-open', onclick: objectiveSheet }, o ? 'Modifier' : 'Fixer le cap') : null),
            o ? [h('p', { class: 'mgr-brief' }, icon('flag', 14), h('span', null, o.brief || 'Sans phrase de cap.')),
                h('p', { class: 'small muted' }, [o.focus_types.length ? 'Types : ' + o.focus_types.map(typeLabel).join(', ') : null, o.focus_zones.length ? 'Quartiers : ' + o.focus_zones.join(', ') : null, 'fixé le ' + boDate(o.at)].filter(Boolean).join(' · '))]
              : h('p', { class: 'muted small' }, d.can_strategy ? 'Aucun cap ce mois-ci : le Manager oriente vers les commerçants déjà accompagnés et la prospection libre.' : 'Le Head of Stratégie n’a pas encore fixé le cap du mois.')),
          h('section', { class: 'card stack tight bo-panel', id: 'bo-proposals' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'Propositions du Manager'), open.length ? boBadge('warn', String(open.length)) : boBadge('ok', 'À jour')),
            open.length ? open.map(function (n) {
              var k = NOTE_KIND[n.kind] || ['muted', n.kind];
              return h('div', { class: 'bo-req', style: 'flex-direction:column' },
                h('div', { class: 'bo-hero-b' }, boBadge(k[0], k[1]), n.ia ? boBadge('info', 'IA') : null, h('span', { class: 'small muted' }, boDate(n.at))),
                h('b', { class: 'wrapword' }, n.title), n.body ? h('p', { class: 'small', style: 'margin:0' }, n.body) : null,
                d.can_strategy ? h('div', { class: 'row' },
                  h('button', { class: 'btn small', type: 'button', onclick: function () { boAct(function () { return api('fiila_bo_note_decide', { p_id: n.id, p_decision: 'accepted' }); }, n.kind === 'mission' ? 'Mission créée.' : 'Proposition acceptée.', null, null, this); } }, n.kind === 'mission' ? 'Créer la mission' : 'Accepter'),
                  h('button', { class: 'btn quiet small', type: 'button', onclick: function () { boAct(function () { return api('fiila_bo_note_decide', { p_id: n.id, p_decision: 'rejected' }); }, 'Proposition écartée.', null, null, this); } }, 'Écarter')) : null);
            }) : h('p', { class: 'muted small' }, 'Aucune proposition en attente. Le Manager analyse chaque jour les retours du terrain et les résultats du test.'),
            infos.length ? h('details', { class: 'more-details' }, h('summary', null, 'Constats récents (' + infos.length + ')'),
              infos.map(function (n) { return h('p', { class: 'small' }, h('b', null, n.title + ' : '), n.body || ''); })) : null,
            analyse)),
        h('section', { class: 'card bo-panel bo-wa', id: 'bo-wa' },
          h('span', { class: 'bo-queue-ic', style: 'background:color-mix(in srgb,#25D366 16%,var(--surface));color:#128C4B', 'aria-hidden': 'true' }, icon('phone', 16)),
          h('div', { class: 'stack tight', style: 'gap:2px;flex:1;min-width:0' }, h('b', null, 'Canal WhatsApp du Manager'),
            h('span', { class: 'small muted' }, d.whatsapp ? '+' + d.whatsapp + ' · ' + (d.wa_api ? 'API branchée : le Manager répond sur WhatsApp' : 'lien direct : l’équipe répond depuis ce numéro') : 'Aucun numéro : les agents écrivent seulement dans l’application.')),
          d.can_strategy ? h('button', { class: 'btn ghost small', type: 'button', id: 'bo-wa-edit', onclick: function () {
            var v = window.prompt ? window.prompt('Numéro WhatsApp du Manager (vide pour retirer)', d.whatsapp ? '+' + d.whatsapp : '') : null;
            if (v === null) return;
            boAct(function () { return api('fiila_bo_manager_whatsapp_set', { p_phone: v }); }, v.trim() ? 'Numéro WhatsApp enregistré.' : 'Numéro retiré.', null, null, this);
          } }, d.whatsapp ? 'Modifier' : 'Ajouter le numéro') : null),
        h('section', { class: 'stack tight', id: 'bo-threads' }, h('h2', null, 'Conversations'),
          boTable([
            { label: 'Agent', get: function (x) { return h('span', { class: 'bo-cell' }, boAv(x.name), h('span', { class: 'stack tight', style: 'gap:0;min-width:0' }, h('span', null, x.name), h('small', { class: 'muted wrapword' }, x.last || ''))); } },
            { label: 'À lire', get: function (x) { return x.escalated ? boBadge('danger', x.escalated + ' à traiter') : x.waiting ? boBadge('warn', String(x.waiting)) : boBadge('muted', 'Lu'); } },
            { label: 'Missions (7 j)', get: function (x) { return String(x.done_7d); }, cls: 'num hide-s' },
            { label: 'Dernier message', get: function (x) { return boDate(x.last_at, true); } }],
            d.threads, { href: function (x) { return '#/bo/carriere/' + x.id; }, id: 'bo-threads-table', empty: 'Aucune conversation pour le moment.' })),
        h('details', { class: 'card more-sec', id: 'bo-missions' }, h('summary', null, 'Missions du catalogue (' + d.missions.filter(function (m) { return m.status === 'active'; }).length + ' actives)'),
          h('div', { class: 'stack tight', style: 'margin-top:10px' },
            d.can_strategy ? h('button', { class: 'btn ghost small', type: 'button', id: 'bo-mis-open', style: 'align-self:flex-start', onclick: missionSheet }, icon('plus', 14), ' Nouvelle mission') : null,
            boTable([
              { label: 'Mission', get: function (m) { return h('span', { class: 'stack tight', style: 'gap:0' }, h('span', null, m.title), m.body ? h('small', { class: 'muted' }, m.body) : null); } },
              { label: 'Type', get: function (m) { return boBadge(m.kind === 'training' ? 'info' : 'ok', m.kind === 'training' ? 'Formation' : 'Terrain'); } },
              { label: 'Faites', get: function (m) { return m.done + ' / ' + m.given; }, cls: 'num' },
              { label: '', get: function (m) { return d.can_strategy && m.status === 'active' ? h('button', { class: 'btn quiet small', type: 'button', onclick: function () { boAct(function () { return api('fiila_bo_mission_save', { p: { id: m.id, status: 'retired' } }); }, 'Mission retirée.', null, null, this); } }, 'Retirer') : m.status === 'retired' ? boBadge('muted', 'Retirée') : ''; } }],
              d.missions, { id: 'bo-missions-table', empty: 'Aucune mission.' }))),
        h('p', { class: 'small muted' }, d.llm ? 'IA activée : le Manager rédige ses réponses avec le modèle (Réglages).' : 'IA désactivée : le Manager répond selon les règles du programme. Pour l’activer : la clé d’API dans Supabase, puis « Manager avec IA » dans Réglages.')
      ], { sub: 'Le Manager encadre chaque agent au quotidien. Le Head of Stratégie fixe le cap et décide de ses propositions.' });
    }, function (e) { return boShell('carriere', 'Manager Carrière', stateCard('!', 'Chargement impossible', errText(e))); });
  }
  function boCareerThread(id) {
    var back = ['#/bo/carriere', 'Manager Carrière'];
    return api('fiila_bo_career_thread', { p_amb: id }).then(function (t) {
      var a = t.ambassador, body = '';
      var input = h('textarea', { id: 'bo-career-input', rows: 2, maxlength: 1500, placeholder: 'Répondre au nom de l’équipe Fii…', oninput: function (e) { body = e.target.value; } });
      var TAGL = { question: 'question', objection: 'objection', probleme: 'problème', gains: 'gains', idee: 'idée', positif: 'positif', retour: 'retour de mission', formation: 'formation', motivation: 'motivation' };
      var waBtn = a.wa ? h('a', { class: 'btn ghost small', id: 'bo-career-wa', target: '_blank', rel: 'noopener noreferrer',
        href: 'https://wa.me/' + a.wa + '?text=' + encodeURIComponent('Bonjour ' + String(a.name).split(' ')[0] + ', c’est votre Manager Fii Carrière.') }, icon('phone', 14), ' WhatsApp') : null;
      return boShell('carriere', a.name, [
        boHero(a.name, [boAmbState(a), h('span', { class: 'bo-code-tag' }, a.code), a.wa_open ? boBadge('ok', 'WhatsApp ouvert 24 h') : null], [a.zone, h('a', { href: '#/bo/agents/' + a.id }, 'Fiche agent')].filter(Boolean).map(function (x, i) { return [i ? ' · ' : '', x]; })),
        h('div', { class: 'bo-grid2' },
          h('section', { class: 'card stack tight bo-panel', id: 'bo-career-thread' }, h('h2', null, 'Conversation'),
            h('div', { class: 'mgr-thread', style: 'max-height:520px;border-radius:14px' }, t.messages.map(function (m) {
              return h('div', { class: 'mgr-msg ' + (m.author === 'agent' ? 'staff-in' : m.author === 'staff' ? 'me' : 'manager') },
                h('small', null, (m.author === 'agent' ? a.name : m.author === 'staff' ? 'Équipe Fii' : 'Manager') + (m.channel === 'whatsapp' ? ' · WhatsApp' : '')),
                h('p', null, m.body),
                m.tags && m.tags.length ? h('div', { class: 'bo-hero-b' }, m.tags.map(function (x) { return boBadge(x === 'probleme' ? 'danger' : x === 'objection' ? 'warn' : 'muted', TAGL[x] || x); })) : null,
                h('time', null, boDate(m.at, true)));
            })),
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Répondre'), input),
            h('button', { class: 'btn', type: 'button', id: 'bo-career-send', style: 'align-self:flex-start', onclick: function () {
              if (!body.trim()) { toast('Écrivez un message.'); return; }
              boAct(function () { return api('fiila_bo_career_reply', { p_amb: a.id, p_body: body }); }, a.wa_open ? 'Message envoyé (application et WhatsApp).' : 'Message envoyé.', function () {
                if (!a.wa_open) return render();
                freshToken().then(function () { return fetch(API_URL + '/functions/v1/fiila-whatsapp', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ action: 'push', ambassador: a.id }) }); })
                  .then(function () { render(); }, function () { toast('Envoi WhatsApp impossible : message visible dans l’application.'); render(); });
              }, null, this);
            } }, 'Envoyer')),
          h('section', { class: 'card stack tight bo-panel', id: 'bo-career-tasks' }, h('h2', null, 'Missions récentes'),
            t.tasks.length ? t.tasks.map(function (x) {
              return h('div', { class: 'bo-dl' }, h('span', { class: 'wrapword' }, (x.done ? '✓ ' : '○ ') + x.title + (x.feedback ? ' — « ' + x.feedback + ' »' : '')), h('span', { class: 'muted' }, boDate(x.day)));
            }) : h('p', { class: 'muted small' }, 'Aucune mission pour le moment.')))
      ], { back: back, action: waBtn });
    }, function (e) { return boShell('carriere', 'Conversation', stateCard('!', 'Introuvable', errText(e)), { back: back }); });
  }

  // Croissance : parcours d'accueil v2 — gestes de découverte et tâches réussies (30 jours, compteurs anonymes et agrégés).
  function boOnboardingPanel(d) {
    if (!d) return null;
    var g = d.gestures || {}, t = d.tasks || {};
    function n(k) { return Number(g[k] || 0); }
    var rows = SERVICES.map(function (s) {
      return { id: s.id, label: s.hero, hero: n('hero_' + s.id + ':click'), act: n('act_' + s.id + ':click'), svc: n('svc_' + s.id + ':click'), hide: n('svc_' + s.id + ':hide') };
    });
    var tasks = [['Adresses créées', t.address], ['Événements créés', t.meeting], ['Demandes d’adresse', t.request], ['Boutiques créées', t.shop],
      ['Articles ajoutés', t.product], ['Commandes', t.order], ['Livreurs inscrits', t.courier]];
    return h('section', { class: 'card stack tight bo-panel', id: 'bo-onboarding' },
      h('div', { class: 'bo-panel-h' }, h('h2', null, 'Parcours d’accueil'), d.on ? boBadge('ok', 'Nouvel accueil actif') : boBadge('muted', 'Ancien accueil (Réglages)')),
      h('p', { class: 'small muted' }, 'Compteurs anonymes et agrégés, 30 derniers jours. « Services » ouverts : ' + boNum(n('services:open')) +
        ' · « Créer mon adresse » touché : ' + boNum(n('hero_adresse:click')) + ' · « Reprendre » touché : ' + boNum(n('hero_reprendre:click')) + '.'),
      boTable([
        { label: 'Service', get: function (x) { return x.label; } },
        { label: 'Découvert (feuille)', get: function (x) { return boNum(x.svc); }, cls: 'num' },
        { label: 'Raccourci touché', get: function (x) { return boNum(x.act + x.hero); }, cls: 'num' },
        { label: 'Retiré de l’accueil', get: function (x) { return boNum(x.hide); }, cls: 'num' }], rows, { id: 'bo-onboarding-table' }),
      (function () {
        var su = d.setup || {};
        var steps = [['Nom et type', su['name:done']], ['Premier article', su['product:done']], ['Vitrine ouverte', su['vitrine:open']], ['Partage WhatsApp touché', su['share:click']]];
        var top = Number(su['name:done'] || 0);
        return h('div', { class: 'stack tight', id: 'bo-setup' },
          h('h3', null, 'Démarrage guidé de la boutique'),
          h('p', { class: 'small muted' }, '« Plus tard » à l’article : ' + boNum(su['product:skip'] || 0) + ' · « Reprendre ma boutique » touché : ' + boNum(su['resume:open'] || 0) + '. « Partage touché » ne prouve pas qu’un message est parti.'),
          steps.map(function (x) {
            var n = Number(x[1] || 0), pct = top ? Math.round(n / top * 100) : 0;
            return h('div', { class: 'stack tight' }, h('div', { class: 'total-row' }, h('span', { class: 'small' }, x[0]), h('b', { class: 'small' }, boNum(n) + (top ? ' · ' + pct + ' %' : ''))),
              h('div', { class: 'wal-bar', 'aria-hidden': 'true' }, h('i', { class: 'paid', style: 'width:' + pct + '%' })));
          }));
      })(),
      (function () {
        var mk = d.marketing || {};
        function m(k) { return boNum(Number(mk[k] || 0)); }
        return h('div', { class: 'stack tight', id: 'bo-marketing-use' },
          h('h3', null, 'Ma boutique et Marketing (22/10)'),
          h('p', { class: 'small', id: 'bo-marketing-line' }, 'Raccourcis de l’accueil : Commandes ' + boNum(n('biz_orders:click')) + ' · Articles ' + boNum(n('biz_products:click')) +
            ' · Marketing ' + boNum(n('biz_marketing:click')) + ' · Clients ' + boNum(n('biz_customers:click')) + '. Écran Marketing ouvert : ' + m('open') +
            ' · partage WhatsApp touché : ' + m('share:wa') + ' · lien copié : ' + m('share:copy') + ' · QR code : ' + m('share:qr') +
            ' · réseaux enregistrés : ' + m('socials:save') + ' · « Publier » touché : ' + m('publish:click') + '.'),
          h('p', { class: 'small muted' }, 'Un partage touché ne prouve pas qu’un message est parti.'));
      })(),
      (function () {
        var dv = d.discover || {};
        var ctx = [['order', 'Après une commande → ouvrir sa boutique'], ['sent', 'Après une adresse envoyée → demander une adresse'], ['course', 'Après une course → espace livreur'],
          ['fiche', 'Fiche reçue'], ['event', 'Événement reçu']];
        function v(c, a) { return Number(dv[c + ':' + a] || 0); }
        return h('div', { class: 'stack tight', id: 'bo-discover' },
          h('div', { class: 'bo-panel-h' }, h('h3', null, 'Découverte après une action'), d.discover_on === false ? boBadge('muted', 'Coupée (Réglages)') : boBadge('ok', 'Active')),
          boTable([
            { label: 'Contexte', get: function (x) { return x[1]; } },
            { label: 'Vue', get: function (x) { return x[0] === 'fiche' || x[0] === 'event' ? '—' : boNum(v(x[0], 'shown')); }, cls: 'num' },
            { label: 'Suivie', get: function (x) { return x[0] === 'fiche' || x[0] === 'event' ? '—' : boNum(v(x[0], 'click')); }, cls: 'num' },
            { label: 'Tous les services', get: function (x) { return boNum(v(x[0], 'all')); }, cls: 'num' },
            { label: 'Masquée', get: function (x) { return x[0] === 'fiche' || x[0] === 'event' ? '—' : boNum(v(x[0], 'hide')); }, cls: 'num' }], ctx, { id: 'bo-discover-table' }));
      })(),
      h('p', { class: 'small muted' }, 'Tâches réussies sur la même période (tous parcours confondus) :'),
      h('div', { class: 'bo-type-chips' }, tasks.map(function (x) { return h('span', { class: 'chip' }, x[0] + ' : ' + boNum(x[1] || 0)); })),
      h('div', { class: 'row' },
        h('a', { class: 'btn ghost small', href: '#/bo/reglages', id: 'bo-onboarding-setting' }, 'Réglage : nouvel ou ancien accueil'),
        h('a', { class: 'btn ghost small', href: '#/', target: '_blank', rel: 'noopener', id: 'bo-onboarding-preview' }, 'Voir l’accueil')));
  }
  // Croissance : la découverte progressive (suggestions dans l'application), taux de suivi sur 30 jours.
  var NUDGE_LABEL = { home_shop: 'Accueil → créer sa boutique', shop_more_products: 'Boutique → ajouter des articles', shop_share_vitrine: 'Boutique → partager la vitrine',
    shop_courier: 'Boutique → inviter un livreur', shop_team: 'Boutique → ajouter un membre', shop_photos: 'Boutique → plusieurs photos' };
  // Messages WhatsApp (mandat WHATSAPP-001) : registre des modèles, aperçu de la carte, mesures du partage, état Meta saisi à la main.
  var WA_META = { NOT_SUBMITTED: 'Non soumis', SUBMITTED: 'Soumis à Meta', APPROVED: 'Approuvé', REJECTED: 'Refusé', PAUSED: 'En pause' };
  var WA_INTEG = { TO_IMPLEMENT: 'À intégrer', MANUAL_PILOT: 'Pilote (partage manuel)', MANUAL: 'Partage manuel', API: 'API' };
  function boWaPanel(d) {
    if (!d) return null;
    var sh = d.shares || {};
    function n(k) { return Number(sh['request:' + k] || 0); }
    function c(card, k) { return Number(sh[card + ':' + k] || 0); }
    var CARD_ROWS = [['request', 'Demande d’adresse'], ['address', 'Mon adresse'], ['event', 'Événement'], ['vitrine', 'Vitrine (Marketing)']];
    var canEdit = boCan('settings');
    return h('section', { class: 'card stack tight bo-panel', id: 'bo-wa' },
      h('div', { class: 'bo-panel-h' }, h('h2', null, 'Messages WhatsApp'), d.media_on ? boBadge('ok', 'Carte image active') : boBadge('muted', 'Texte seul (Réglages)')),
      h('p', { class: 'small muted' }, 'Demande d’adresse, 30 derniers jours : ' + boNum(d.requests || 0) + ' demande(s) · image + texte ouverts : ' + boNum(n('file')) +
        ' · texte seul : ' + boNum(n('text')) + ' · image téléchargée : ' + boNum(n('download')) + ' · échecs : ' + boNum(n('failed')) +
        '. Un partage ouvert ne prouve pas qu’un message est parti ni qu’il a été lu. Aucun envoi par l’API : modèles non soumis à Meta.'),
      boTable([
        { label: 'Carte', get: function (x) { return x[1]; } },
        { label: 'Image + texte', get: function (x) { return boNum(c(x[0], 'file')); }, cls: 'num' },
        { label: 'Texte seul', get: function (x) { return boNum(c(x[0], 'text')); }, cls: 'num' },
        { label: 'Image téléchargée', get: function (x) { return boNum(c(x[0], 'download')); }, cls: 'num' },
        { label: 'Échecs', get: function (x) { return boNum(c(x[0], 'failed')); }, cls: 'num' }], CARD_ROWS, { id: 'bo-wa-cards' }),
      h('details', { id: 'bo-wa-preview' }, h('summary', null, 'Aperçu des cartes envoyées'),
        h('div', { class: 'stack tight', style: 'margin-top:10px' }, CARD_ROWS.map(function (x) {
          var w = WA_CARDS[x[0]];
          return h('img', { class: 'wa-card', src: w.src, alt: w.alt, width: 1200, height: 800, loading: 'lazy', style: 'max-width:420px' });
        }), h('img', { class: 'wa-card', src: 'media/wa/og-fii.jpg', alt: 'Aperçu des liens Fii (og:image)', width: 1200, height: 630, loading: 'lazy', style: 'max-width:420px' }),
          h('p', { class: 'small muted' }, 'Dernière image : aperçu affiché par WhatsApp sous un lien Fii envoyé en texte seul.'))),
      boTable([
        { label: 'Message', get: function (t) { return t.usage; } },
        { label: 'Action', get: function (t) { return t.cta; } },
        { label: 'Intégration', get: function (t) { return WA_INTEG[t.integration] || t.integration; } },
        { label: 'Meta', get: function (t) {
          if (!canEdit) return WA_META[t.meta] || t.meta;
          return h('select', { 'aria-label': 'État Meta : ' + t.usage, 'data-wa': t.id, onchange: function (e) {
            var sel = e.target;
            api('fiila_bo_wa_status', { p_id: t.id, p_meta: sel.value }).then(function () { toast('État Meta enregistré.'); }, function (err) { sel.value = t.meta; toast(errText(err)); });
          } }, Object.keys(WA_META).map(function (k) { return h('option', { value: k, selected: k === t.meta }, WA_META[k]); }));
        } }], d.templates || [], { id: 'bo-wa-table' }));
  }
  function boNudgePanel(d) {
    if (!d) return null;
    return h('section', { class: 'card stack tight bo-panel', id: 'bo-nudges' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'Découverte progressive'), d.on ? boBadge('ok', 'Active') : boBadge('muted', 'Coupée (Réglages)')),
      h('p', { class: 'small muted' }, 'Une suggestion à la fois, selon l’usage ; 3 au plus par jour ; « Plus tard » = 7 jours de silence. 30 derniers jours :'),
      d.items.length ? boTable([
        { label: 'Suggestion', get: function (x) { return NUDGE_LABEL[x.id] || x.id; } },
        { label: 'Vue', get: function (x) { return boNum(x.shown); }, cls: 'num' },
        { label: 'Suivie', get: function (x) { return boNum(x.click) + ' · ' + (x.shown ? Math.round(x.click / x.shown * 100) : 0) + ' %'; }, cls: 'num' },
        { label: 'Plus tard', get: function (x) { return boNum(x.dismiss); }, cls: 'num' }], d.items, { id: 'bo-nudges-table' })
        : h('p', { class: 'muted small' }, 'Aucune suggestion vue pour le moment.'));
  }
  // ----- Ambassadeurs (marques invitées par le fondateur) : invitations, essais, packs versionnés.
  var PTN_STATE = { valid: ['warn', 'Invitation envoyée'], accepted: ['ok', 'Acceptée'], expired: ['muted', 'Expirée'], revoked: ['muted', 'Retirée'] };
  var TRIAL_STATE = { ready: ['warn', 'Essai à activer'], active: ['ok', 'Essai en cours'], ended: ['muted', 'Essai terminé'], suspended: ['warn', 'Suspendu'], revoked: ['muted', 'Arrêté'] };
  function boPartners() {
    return api('fiila_bo_partners', {}).then(function (d) {
      var packs = d.packs || [], last = packs.filter(function (x) { return x.code === 'complet'; })[0];
      function inviteSheet() {
        var f = { brand: '', activity: '', whatsapp: '', months: 1, shop_slug: '', note: '' };
        var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-inv-h', id: 'bo-invite-sheet' });
        var close;
        var form = h('form', { class: 'sheet stack bo-sheet', onsubmit: function (e) {
          e.preventDefault();
          boAct(function () { return api('fiila_bo_partner_invite', { p: { brand: f.brand, activity: f.activity, whatsapp: f.whatsapp, months: f.months, shop_slug: f.shop_slug || null, note: f.note || null } }); },
            null, function (r) { close(); shareSheet(r); }, null, e.submitter);
        } },
          h('h2', { id: 'bo-inv-h' }, 'Inviter une marque'),
          textField({ id: 'inv-brand', label: 'Nom de la marque', max: 60, onInput: function (v) { f.brand = v; } }),
          textField({ id: 'inv-activity', label: 'Activité', max: 80, placeholder: 'Ex. : prêt-à-porter, cosmétiques', onInput: function (v) { f.activity = v; } }),
          textField({ id: 'inv-wa', label: 'WhatsApp', type: 'tel', inputmode: 'tel', onInput: function (v) { f.whatsapp = v; } }),
          segField({ name: 'inv-months', id: 'inv-months', legend: 'Durée de l’essai', value: '1', options: [['1', '1 mois'], ['2', '2 mois']], onChange: function (v) { f.months = parseInt(v, 10); } }),
          last ? h('p', { class: 'small muted' }, 'Pack : ' + last.name + ' (version ' + last.version + ')' + (last.blocked ? ' · activation bloquée tant qu’un service inclus n’est pas prêt' : '')) : h('p', { class: 'notice' }, 'Créez d’abord une version du pack (plus bas).'),
          h('details', { class: 'more-details' }, h('summary', null, 'Boutique existante, note (facultatif)'),
            h('div', { class: 'stack', style: 'margin-top:12px' },
              textField({ id: 'inv-shop', label: 'Lien de sa vitrine Fii', optional: true, max: 40, placeholder: 'Ex. : maison-diallo', onInput: function (v) { f.shop_slug = v.replace(/^.*#\/b\//, '').trim(); } }),
              textField({ id: 'inv-note', label: 'Note interne', optional: true, multiline: true, max: 300, onInput: function (v) { f.note = v; } }))),
          h('button', { class: 'btn', type: 'submit', id: 'inv-create' }, 'Préparer l’invitation'),
          h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler'));
        back.append(form);
        close = openSheet(back);
      }
      // Aperçu personnalisé et lien privé : le lien n'est montré qu'une fois. Ouvrir WhatsApp ne prouve pas l'envoi.
      function shareSheet(r) {
        var url = baseUrl() + '#/invitation/' + r.token;
        var msg = 'Bonjour, ici Assane, fondateur de Fii. J’aime le travail de ' + r.brand + ' et je vous invite à essayer gratuitement le pack complet de Fii pendant ' + r.months + ' mois, sans engagement : ' + url;
        var wa = r.whatsapp ? 'https://wa.me/' + (r.whatsapp.replace(/\D/g, '').length === 9 ? '221' : '') + r.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent(msg) : waLink(msg);
        var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-share-h', id: 'bo-share-sheet' });
        var close;
        back.append(h('div', { class: 'sheet stack bo-sheet' },
          h('h2', { id: 'bo-share-h' }, 'Invitation prête'),
          h('div', { class: 'card', id: 'inv-preview' }, h('p', { class: 'small wrapword' }, msg)),
          h('p', { class: 'small muted' }, 'Ce lien n’est affiché qu’une fois. Perdu ? « Nouveau lien » le remplace (l’ancien ne marche plus). Expire dans 30 jours.'),
          iconBtn('a', { class: 'btn', id: 'inv-wa-go', href: wa, target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'Partager sur WhatsApp'),
          iconBtn('button', { class: 'btn ghost', type: 'button', onclick: function () { copy(url, 'Lien'); } }, 'link', 'Copier le lien'),
          h('button', { class: 'btn ghost', type: 'button', id: 'inv-done', onclick: function () { close(); render(); } }, 'Terminé')));
        close = openSheet(back);
      }
      function packSheet() {
        var f = { name: last ? last.name : 'Pack complet', benefits: last ? last.benefits.join('\n') : '', exclusions: last ? (last.exclusions || []).join('\n') : '', studio: last && last.limits && last.limits.studio_credits != null ? String(last.limits.studio_credits) : '' };
        var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-pack-h', id: 'bo-pack-sheet' });
        var close;
        back.append(h('form', { class: 'sheet stack bo-sheet', onsubmit: function (e) {
          e.preventDefault();
          var lines = function (t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
          var limits = {}; if (String(f.studio).trim() !== '') limits.studio_credits = parseInt(f.studio, 10) || 0;
          boAct(function () { return api('fiila_bo_pack_save', { p: { code: 'complet', name: f.name, benefits: lines(f.benefits), exclusions: lines(f.exclusions), limits: limits } }); },
            'Nouvelle version du pack enregistrée.', function () { close(); render(); }, null, e.submitter);
        } },
          h('h2', { id: 'bo-pack-h' }, 'Nouvelle version du pack'),
          h('p', { class: 'small muted' }, 'Les invitations déjà envoyées gardent leur version. Exactement ce qui sera affiché avant l’activation.'),
          textField({ id: 'pack-name', label: 'Nom', max: 60, value: f.name, onInput: function (v) { f.name = v; } }),
          textField({ id: 'pack-benefits', label: 'Avantages (un par ligne)', multiline: true, max: 1200, value: f.benefits, onInput: function (v) { f.benefits = v; } }),
          textField({ id: 'pack-exclusions', label: 'Non inclus (un par ligne)', optional: true, multiline: true, max: 600, value: f.exclusions, onInput: function (v) { f.exclusions = v; } }),
          textField({ id: 'pack-studio', label: 'Retouches Studio incluses', optional: true, inputmode: 'numeric', value: f.studio, placeholder: 'Vide = pas de Studio', onInput: function (v) { f.studio = v; } }),
          h('button', { class: 'btn', type: 'submit', id: 'pack-save' }, 'Enregistrer la version'),
          h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler')));
        close = openSheet(back);
      }
      function run(x, action, label, reason, btn) {
        return boAct(function () { return api('fiila_bo_partner_action', { p_id: x.id, p_action: action, p_reason: reason }); }, action === 'regenerate' ? null : label + ' : fait.',
          action === 'regenerate' ? function (r) { shareSheet({ token: r.token, brand: x.brand, months: x.months, whatsapp: x.whatsapp }); } : null, null, btn);
      }
      // Conversation de la marque avec le Manager : lecture (marquée lue) et réponse de l'équipe, tracée.
      function threadSheet(x) {
        var list = h('div', { class: 'pmsg-list', id: 'bo-pmsg-list' }, loading()), body = '';
        function draw(msgs) {
          setKids(list, msgs.map(function (m) {
            return h('div', { class: 'pmsg pmsg-' + (m.author === 'brand' ? 'staff' : 'brand') },
              h('span', { class: 'pmsg-who' }, m.author === 'brand' ? x.brand : m.author === 'staff' ? 'Équipe' : 'Manager (règles)'),
              h('p', { class: 'wrapword' }, m.body), m.escalate ? h('span', { class: 'chip wait' }, 'À traiter') : null);
          }));
        }
        api('fiila_bo_partner_thread', { p_invite: x.id }).then(function (r) { draw(r.messages); }, function (e) { errBox(list, e); });
        var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-pmsg-h', id: 'bo-pmsg-sheet' });
        var close;
        back.append(h('form', { class: 'sheet stack bo-sheet', onsubmit: function (e) {
          e.preventDefault(); if (!body.trim()) return;
          boAct(function () { return api('fiila_bo_partner_reply', { p_invite: x.id, p_body: body.trim() }); }, 'Réponse envoyée.', function (r) { body = ''; ta.value = ''; draw(r.messages); }, null, e.submitter);
        } }, h('h2', { id: 'bo-pmsg-h' }, x.brand), list,
          h('p', { class: 'small muted' }, 'Le Manager ne fixe ni prix, ni prolongation, ni quota : ces questions vous sont transmises.'),
          ta = h('textarea', { id: 'bo-pmsg-input', rows: 3, maxlength: 1500, placeholder: 'Réponse de l’équipe', oninput: function (e) { body = e.target.value; } }),
          h('button', { class: 'btn', type: 'submit', id: 'bo-pmsg-send' }, 'Répondre'),
          h('button', { class: 'btn ghost', type: 'button', id: 'bo-pmsg-close', onclick: function () { close(); render(); } }, 'Fermer')));
        var ta;
        close = openSheet(back);
      }
      // Motif obligatoire (retrait, suspension) : demandé dans une feuille, gardé au journal.
      function act(x, action, label, needReason) {
        return h('button', { class: 'btn ghost small', type: 'button', 'data-act': action, onclick: function () {
          if (!needReason) return run(x, action, label, null, this);
          var reason = '';
          var back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bo-reason-h', id: 'bo-reason-sheet' });
          var close;
          back.append(h('form', { class: 'sheet stack bo-sheet', onsubmit: function (e) { e.preventDefault(); if (!reason.trim()) return; run(x, action, label, reason.trim(), e.submitter).then(function () { close(); }); } },
            h('h2', { id: 'bo-reason-h' }, label + ' : ' + x.brand),
            textField({ id: 'bo-reason', label: 'Motif (gardé au journal)', max: 200, onInput: function (v) { reason = v; } }),
            h('button', { class: 'btn', type: 'submit', id: 'bo-reason-ok' }, label),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { close(); } }, 'Annuler')));
          close = openSheet(back);
        } }, label);
      }
      var rows = (d.invites || []).map(function (x) {
        var st = x.trial ? TRIAL_STATE[x.trial.status] : PTN_STATE[x.state];
        var tools = [];
        var ms = x.trial && x.trial.milestones;
        if (x.trial) tools.push(h('button', { class: 'btn ghost small', type: 'button', 'data-act': 'thread', onclick: function () { threadSheet(x); } }, 'Conversation' + (ms && ms.to_read ? ' · ' + ms.to_read : '')));
        if (x.state === 'valid') tools.push(act(x, 'regenerate', 'Nouveau lien'));
        if (d.can_admin) {
          if (x.trial && (x.trial.status === 'active' || x.trial.status === 'ended')) tools.push(act(x, 'extend', 'Prolonger d’un mois'));
          if (x.trial && x.trial.status === 'active') tools.push(act(x, 'suspend', 'Suspendre', true));
          if (x.trial && x.trial.status === 'suspended') tools.push(act(x, 'resume', 'Reprendre'));
          if (x.state !== 'revoked') tools.push(act(x, 'revoke', 'Retirer', true));
        }
        return h('div', { class: 'item bo-ptn', id: 'ptn-' + x.id },
          h('div', { class: 'stack tight', style: 'flex:1;min-width:0' },
            h('div', { class: 't wrapword' }, x.brand, x.shop ? h('span', { class: 'small muted' }, ' · ' + x.shop) : null),
            h('div', { class: 'small muted' }, [x.activity, x.months + ' mois', x.pack, x.trial && x.trial.ends_on ? 'jusqu’au ' + x.trial.ends_on : null].filter(Boolean).join(' · ')),
            ms ? h('div', { class: 'bo-ms', 'aria-label': 'Jalons' }, [['configured', 'Boutique'], ['first_product', '1er article'], ['storefront', 'Vitrine ouverte'], ['orders', 'Commande'], ['delivered', 'Livrée'], ['returned', 'Retour']].map(function (k) {
              var v = ms[k[0]], on = v === true || v > 0;
              return h('span', { class: 'chip ' + (on ? 'ok' : 'off') }, k[1] + (typeof v === 'number' && v > 1 ? ' · ' + v : ''));
            }), ms.escalated ? h('span', { class: 'chip wait' }, 'À traiter · ' + ms.escalated) : null) : null,
            tools.length ? h('details', { class: 'more-details' }, h('summary', null, 'Actions'), h('div', { class: 'row', style: 'flex-wrap:wrap;margin-top:8px' }, tools)) : null),
          st ? boBadge(st[0], st[1]) : null);
      });
      return boShell('ambassadeurs', 'Ambassadeurs', [
        h('p', { class: 'small muted' }, 'Boutiques et marques que vous choisissez, invitées à essayer le pack complet 1 ou 2 mois. Distinct du programme Agents (rémunéré).'),
        h('button', { class: 'btn', type: 'button', id: 'bo-invite-brand', onclick: inviteSheet, disabled: last ? null : true }, 'Inviter une marque'),
        h('section', { class: 'card stack tight bo-panel', id: 'bo-partners' }, h('div', { class: 'bo-panel-h' }, h('h2', null, 'Invitations et essais'), boBadge('muted', String(rows.length))),
          rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'muted small' }, 'Aucune invitation pour l’instant.')),
        h('details', { class: 'card more-sec', id: 'bo-packs' }, h('summary', null, 'Pack (versions)'),
          h('div', { class: 'stack tight', style: 'margin-top:10px' },
            packs.length ? packs.map(function (pk) {
              return h('div', { class: 'item' }, h('div', { class: 'stack tight', style: 'flex:1;min-width:0' }, h('b', null, pk.name + ' · v' + pk.version), h('span', { class: 'small muted wrapword' }, (pk.benefits || []).join(' · '))),
                pk.blocked ? boBadge('warn', 'BLOCKED_DEPENDENCY') : pk.ready ? boBadge('ok', 'Prêt') : boBadge('muted', 'Incomplet'));
            }) : h('p', { class: 'small muted' }, 'Aucune version : le contenu du pack est à définir (action #56).'),
            d.can_admin ? h('button', { class: 'btn ghost small', type: 'button', id: 'bo-pack-new', onclick: packSheet }, 'Nouvelle version') : null))]);
    }, function (e) { return boShell('ambassadeurs', 'Ambassadeurs', stateCard('!', 'Chargement impossible', errText(e))); });
  }
  // ----- Fil
  function boFeed() {
    return api('fiila_bo_feed', {}).then(function (d) {
      return boShell('fil', 'Fil (25 places gratuites)', [
        h('p', { class: 'small muted' }, d.places.length + ' places attribuées sur 25 · ' + d.waiting.length + ' boutique(s) en attente d’une place.'),
        boTable([
          { label: 'Place', get: function (p) { return 'n° ' + p.rank; } },
          { label: 'Boutique', get: function (p) { return p.name; } },
          { label: 'État', get: function (p) { return p.suspended ? boBadge('danger', 'Suspendue') : !p.public ? boBadge('muted', 'Vitrine fermée') : !p.feed ? boBadge('warn', 'Masquée du fil') : boBadge('ok', 'Visible'); } },
          { label: 'Publications', get: function (p) { return String(p.products); }, cls: 'num' }],
          d.places, { href: function (p) { return '#/bo/boutiques/' + p.id; }, id: 'bo-feed', empty: 'Aucune place attribuée.' }),
        d.waiting.length ? h('section', { class: 'stack tight' }, h('h2', null, 'En attente'),
          boTable([{ label: 'Boutique', get: function (w) { return w.name; } }, { label: 'Depuis', get: function (w) { return boDate(w.since); } }], d.waiting,
            { href: function (w) { return '#/bo/boutiques/' + w.id; } })) : null]);
    });
  }

  // ----- Finances
  function boFinance() {
    return api('fiila_bo_finance', {}).then(function (f) {
      var rate = f.vd_commission || 0;
      return boShell('finances', 'Finances', [
        h('div', { class: 'bo-kpis' },
          h('div', { class: 'bo-kpi' }, h('strong', null, fcfa(f.rewards.validated)), h('span', null, 'gains agents à verser'), h('small', { class: 'muted' }, fcfa(f.rewards.pending) + ' en attente (30 jours)')),
          h('div', { class: 'bo-kpi' }, h('strong', null, fcfa(f.rewards.paid)), h('span', null, 'gains déjà versés')),
          h('div', { class: 'bo-kpi' }, h('strong', null, String(f.vd_to_pay)), h('span', null, 'ventes de vide-dressing à reverser'), h('small', { class: 'muted' }, 'commission ' + rate + ' %'))),
        h('section', { class: 'stack tight' }, h('h2', null, 'Par mois (6 derniers mois)'),
          boTable([
            { label: 'Mois', get: function (m) { return new Date(m.month + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); } },
            { label: 'Commandes', get: function (m) { return boNum(m.orders); }, cls: 'num' },
            { label: 'Livrées', get: function (m) { return boNum(m.delivered); }, cls: 'num' },
            { label: 'Volume livré', get: function (m) { return fcfa(m.gmv); }, cls: 'num' },
            { label: 'Commission vide-dressing', get: function (m) { return fcfa(Math.round(m.vd_gmv * rate / 100)); }, cls: 'num' }], f.months, { id: 'bo-months' }),
          h('p', { class: 'small muted' }, 'Le volume est celui des commandes livrées, hors boutiques de démonstration. Fii n’encaisse pas encore les paiements en ligne : la commission de vide-dressing est retenue au reversement.'))]);
    });
  }

  // ----- Équipe
  function boTeam() {
    return api('fiila_bo_team', {}).then(function (t) {
      var form = h('div');
      function openInvite() {
        var f = { email: '', role: 'support' };
        var err = h('div', { role: 'alert' }), out = h('div');
        var roleSel = h('select', { id: 'bo-inv-role', onchange: function (e) { f.role = e.target.value; help.textContent = BO_ROLE_HELP[f.role]; } },
          Object.keys(BO_ROLES).map(function (r) { return h('option', { value: r, selected: r === f.role || null }, BO_ROLES[r]); }));
        var help = h('p', { class: 'small muted' }, BO_ROLE_HELP[f.role]);
        setKids(form, h('section', { class: 'card stack tight', id: 'bo-invite-form' }, h('h2', null, 'Inviter un membre'),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Adresse e-mail de la personne'), h('input', { type: 'email', id: 'bo-inv-email', oninput: function (e) { f.email = e.target.value; } })),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Rôle'), roleSel), help, err,
          h('button', { class: 'btn', type: 'button', id: 'bo-inv-send', onclick: function () {
            var btn = this;
            if (btn.disabled) return;
            setKids(err); btn.disabled = true;
            boSensitive(function () { return api('fiila_bo_invite', { p_email: f.email, p_role: f.role }); }).then(function (r) {
              btn.disabled = false;
              var link = baseUrl() + '#/bo/invitation/' + r.token;
              setKids(out, h('div', { class: 'msg stack tight', id: 'bo-inv-link' },
                h('p', null, h('b', null, 'Invitation créée. '), 'Envoyez ce lien à la personne : il fonctionne une seule fois, pendant 7 jours, avec son adresse e-mail.'),
                h('code', { class: 'wrapword' }, link),
                h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: function () { copy(link, 'Lien'); } }, 'Copier le lien'),
                  h('a', { class: 'btn ghost small', href: 'https://wa.me/?text=' + encodeURIComponent('Invitation au back-office Fii (' + BO_ROLES[f.role] + ') : ' + link), target: '_blank', rel: 'noopener' }, 'WhatsApp'))));
            }, function (e) { btn.disabled = false; if (e && e.code !== 'reauth_required') errBox(err, e); });
          } }, 'Créer le lien d’invitation'), out));
      }
      var members = boTable([
        { label: 'Membre', get: function (m) { return (m.name || '—') + (m.me ? ' (vous)' : ''); } },
        { label: 'E-mail', get: function (m) { return m.email; } },
        { label: 'Rôle', get: function (m) {
          if (m.me) return BO_ROLES[m.role];
          return h('select', { 'aria-label': 'Rôle de ' + (m.name || m.email), class: 'bo-role', 'data-user': m.user_id, onchange: function (e) {
            var sel = e.target, v = sel.value;
            boAct(function () { return api('fiila_bo_staff_set', { p_user: m.user_id, p_role: v }); }, 'Rôle modifié.', null, function () { sel.value = m.role; });
          } }, Object.keys(BO_ROLES).map(function (r) { return h('option', { value: r, selected: r === m.role || null }, BO_ROLES[r]); }));
        } },
        { label: 'Dernière activité', get: function (m) { return m.last_seen_at ? boDate(m.last_seen_at, true) : 'Jamais'; } },
        { label: '', get: function (m) { return m.me ? '' : h('button', { class: 'btn quiet danger-text small', type: 'button', 'data-remove': m.user_id, onclick: function () {
          if (!window.confirm || window.confirm('Retirer ' + (m.name || m.email) + ' de l’équipe ? Son compte reste, sans accès au back-office.')) boAct(function () { return api('fiila_bo_staff_set', { p_user: m.user_id, p_role: null }); }, 'Membre retiré.', null, null, this);
        } }, 'Retirer'); } }], t.members, { id: 'bo-members' });
      var invites = t.invites.length ? h('section', { class: 'stack tight', id: 'bo-invites' }, h('h2', null, 'Invitations en attente'),
        boTable([{ label: 'E-mail', get: function (i) { return i.email; } }, { label: 'Rôle', get: function (i) { return BO_ROLES[i.role]; } },
          { label: 'Expire', get: function (i) { return boDate(i.expires_at, true); } },
          { label: '', get: function (i) { return h('button', { class: 'btn quiet danger-text small', type: 'button', onclick: function () { if (window.confirm && !window.confirm('Annuler l’invitation de ' + i.email + ' ? Le lien ne fonctionnera plus.')) return; boAct(function () { return api('fiila_bo_invite_revoke', { p_id: i.id }); }, 'Invitation annulée.', null, null, this); } }, 'Annuler'); } }], t.invites)) : null;
      return boShell('equipe', 'Équipe', [
        h('p', { class: 'small muted' }, 'Chaque membre se connecte avec son propre compte sur le portail du back-office. Personne ne partage de mot de passe.'),
        form, members, invites,
        h('details', { class: 'card', id: 'bo-roles-help' }, h('summary', null, 'Ce que permet chaque rôle'),
          h('div', { class: 'stack tight', style: 'margin-top:8px' }, Object.keys(BO_ROLES).map(function (r) { return h('p', { class: 'small' }, h('b', null, BO_ROLES[r] + ' : '), BO_ROLE_HELP[r]); })))
      ], { action: iconBtn('button', { class: 'btn', type: 'button', id: 'bo-invite-open', onclick: function () { openInvite(); var i = document.getElementById('bo-inv-email'); if (i) i.focus(); } }, 'plus', 'Inviter') });
    });
  }
  // ----- Journal
  var BO_ACTIONS = { partner_reply: 'a répondu à la marque', partner_invite: 'a invité la marque', partner_regenerate: 'a renouvelé le lien d’invitation de', partner_revoke: 'a retiré l’invitation de', partner_extend: 'a prolongé l’essai de',
    partner_suspend: 'a suspendu l’essai de', partner_resume: 'a repris l’essai de', pack_saved: 'a enregistré une version du pack', shop_suspend: 'a suspendu la boutique', shop_unsuspend: 'a réactivé la boutique', shop_feed_off: 'a retiré la boutique du fil',
    shop_feed_on: 'a remis la boutique dans le fil', shop_free_place: 'a libéré la place du fil', shop_set_type: 'a changé le type de la boutique',
    team_invite: 'a invité', team_invite_revoke: 'a annulé l’invitation de', team_join: 'a rejoint l’équipe', team_role: 'a changé le rôle de',
    team_remove: 'a retiré de l’équipe', setting: 'a modifié le réglage', comment_delete: 'a supprimé un commentaire', comment_hide: 'a masqué un commentaire',
    comment_restore: 'a rétabli un commentaire', vd_approved: 'a publié un article de vide-dressing', vd_rejected: 'a refusé un article de vide-dressing',
    vd_changes: 'a demandé une correction', vd_paid: 'a marqué un reversement de vide-dressing', reward_paid: 'a marqué un gain d’agent versé',
    reward_cancelled: 'a annulé un gain d’agent', reward_validated: 'a validé un gain d’agent', ambassador_active: 'a activé un agent',
    ambassador_suspended: 'a suspendu un agent', ambassador_excluded: 'a exclu un agent', ambassador_training: 'a renvoyé un agent en formation', ambassador_deleted: 'a supprimé le profil agent de',
    view_order: 'a consulté la commande', view_account: 'a consulté le compte', shop_member_remove: 'a retiré un membre de l’équipe de la boutique',
    career_reply: 'a répondu à l’agent', career_objective: 'a fixé le cap du mois :', career_mission: 'a modifié la mission', career_note_accepted: 'a accepté la proposition du Manager', career_note_rejected: 'a écarté la proposition du Manager' };
  var BO_SETTINGS = { vd_commission: ['Commission du vide-dressing', '%'], amb_reward_1: ['Gain agent, niveau 1', 'FCFA'], amb_reward_2: ['Gain agent, niveau 2', 'FCFA'],
    amb_reward_3: ['Gain agent, niveau 3', 'FCFA'], amb_monthly_cap: ['Plafond de commerçants par agent et par mois', ''],
    sms_verify: ['Code SMS obligatoire pour rejoindre une équipe de boutique', '0 = non, 1 = oui'],
    amb_manager_llm: ['Manager Fii Carrière avec IA (clé d’API à saisir dans Supabase)', '0 = non, 1 = oui'],
    nudges: ['Suggestions discrètes dans l’application (découverte progressive)', '0 = non, 1 = oui'],
    onboarding_v2: ['Nouvel accueil (mes activités, « Découvrir les services »)', '1 = nouvel accueil, 0 = ancien'],
    discover_after: ['Suggestion discrète après une action (commande, adresse envoyée, course)', '0 = non, 1 = oui'],
    wa_card_media: ['Carte image avec la demande d’adresse sur WhatsApp', '0 = texte seul, 1 = image + texte'],
    media_cdn: ['Photos servies par le stockage (adresse fixe, mise en cache)', '0 = servies par la base, 1 = stockage'] };
  // « Prénom · rôle » tel que gardé au journal, avec le rôle en clair.
  function boActor(a) { return String(a || '—').replace(/ · ([a-z_]+)$/, function (m, r) { return ' · ' + (BO_ROLES[r] || r); }); }
  function boActionLabel(a, d) {
    d = d || {};
    var who = a === 'view_order' ? 'n° ' + String(d.number || '').padStart(4, '0') + ' de ' + (d.shop || '') : d.name || d.email || d.title || d.shop || (d.body ? '« ' + d.body + ' »' : '') || '';
    var txt = (BO_ACTIONS[a] || a) + (who ? ' ' + who : '');
    if (a === 'team_role' && d.to) txt += ' (' + (BO_ROLES[d.from] || d.from) + ' → ' + (BO_ROLES[d.to] || d.to) + ')';
    if (a === 'shop_member_remove' && d.value) txt += ' (' + d.value + ')';
    if (a === 'team_invite' && d.role) txt += ' (' + (BO_ROLES[d.role] || d.role) + ')';
    if (a === 'shop_suspend' && d.value) txt += ' : ' + d.value;
    if (a === 'shop_set_type' && d.value) txt += ' : ' + (typeLabel(d.value) || d.value);
    return txt;
  }
  function boAudit(q) {
    var pageNo = 0, box = h('div', { class: 'stack', id: 'bo-audit' }, loading()), more = h('div'), rows = [];
    function load() {
      api('fiila_bo_audit', { p_page: pageNo }).then(function (r) {
        rows = rows.concat(r);
        setKids(box, boTable([
          { label: 'Date', get: function (l) { return boDate(l.at, true); } },
          { label: 'Membre', get: function (l) { return boActor(l.actor); } },
          { label: 'Action', get: function (l) { return l.action === 'setting' ? 'a modifié « ' + ((BO_SETTINGS[l.target_id] || [l.target_id])[0]) + ' » : ' + l.detail.from + ' → ' + l.detail.to : boActionLabel(l.action, l.detail); } }],
          rows, { empty: 'Aucune action pour le moment.' }));
        setKids(more, r.length === 50 ? h('button', { class: 'btn ghost', type: 'button', onclick: function () { pageNo++; load(); } }, 'Voir plus') : null);
      }, function (e) { errBox(box, e); });
    }
    load();
    return boShell('journal', 'Journal', [h('p', { class: 'small muted' }, 'Toutes les actions de l’équipe : qui, quoi, quand. Rien ne peut y être modifié ni effacé depuis le back-office.'), box, more]);
  }

  // ----- Réglages
  // Photos (stockage) : copie des photos publiques vers Supabase Storage (22/10), état, erreurs, copie manuelle.
  function boMediaPanel(m) {
    if (!m) return null;
    var mb = (Number(m.bytes || 0) / 1048576).toFixed(1).replace('.', ',');
    var status = h('p', { class: 'small', role: 'status', id: 'bo-media-status' });
    return h('section', { class: 'card stack tight bo-panel', id: 'bo-media' },
      h('div', { class: 'bo-panel-h' }, h('h2', null, 'Photos (stockage)'),
        !m.ready ? boBadge('muted', 'Stockage non configuré') : m.on ? boBadge('ok', 'Servies par le stockage') : boBadge('muted', 'Servies par la base (media_cdn = 0)')),
      h('p', { class: 'small muted' }, 'Photos d’articles et couvertures de vitrine. Copiées : ' + boNum(m.copied) + ' (' + mb + ' Mo) · en attente : ' + boNum(m.pending) +
        ' · dernière copie : ' + (m.last_run ? shortDate(m.last_run) + ' ' + new Date(m.last_run).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'jamais') +
        '. Les photos de porte et les repères vocaux restent dans la base, jamais publics.'),
      (m.errors || []).length ? h('ul', { class: 'small', id: 'bo-media-errors' }, m.errors.map(function (e) { return h('li', null, shortDate(e.at) + ' · ' + (e.ref || '') + ' · ' + (e.detail || '')); })) : null,
      m.ready ? h('button', { class: 'btn ghost small', type: 'button', id: 'bo-media-run', onclick: function (ev) {
        var b = ev.currentTarget; b.disabled = true; status.textContent = 'Copie en cours…';
        fetch(API_URL + '/functions/v1/fiila-media-sync', { method: 'POST', headers: apiHeaders(), body: '{}' }).then(function (r) { return r.json(); }).then(function (x) {
          b.disabled = false; status.textContent = x && x.ok ? (x.copied + ' copiée(s), ' + x.failed + ' échec(s), ' + x.removed + ' retirée(s).') : 'Copie impossible pour le moment.';
        }, function () { b.disabled = false; status.textContent = 'Copie impossible pour le moment.'; });
      } }, 'Copier maintenant') : null, status);
  }
  function boSettings() {
    return Promise.all([api('fiila_bo_settings', {}), api('fiila_bo_media', {}).then(null, function () { return null; })]).then(function (rr) {
      var s = rr[0];
      return boShell('reglages', 'Réglages de la plateforme', [boMediaPanel(rr[1]),
        h('p', { class: 'small muted' }, 'Chaque modification est appliquée aussitôt, tracée dans le journal, et demande une connexion récente.'),
        h('div', { class: 'stack', id: 'bo-settings' }, Object.keys(BO_SETTINGS).map(function (k) {
          var input = h('input', { type: 'number', inputmode: 'numeric', id: 'bo-set-' + k, value: s[k] != null ? s[k] : '', min: 0 });
          return h('div', { class: 'card bo-setting' },
            h('label', { class: 'field' }, h('span', { class: 'lbl' }, BO_SETTINGS[k][0] + (BO_SETTINGS[k][1] ? ' (' + BO_SETTINGS[k][1] + ')' : '')), input),
            h('button', { class: 'btn ghost small', type: 'button', id: 'bo-save-' + k, onclick: function () {
              boAct(function () { return api('fiila_bo_setting_set', { p_key: k, p_value: parseInt(input.value, 10) }); }, 'Réglage enregistré.', null, null, this);
            } }, 'Enregistrer'));
        })),
        h('p', { class: 'small muted' }, 'Le nombre de places gratuites du fil (25) et le prix après ces places restent à décider : ils seront ajoutés ici.')]);
    });
  }

  // Modération des commentaires du fil : masqués (3 signalements) d'abord, puis signalés. Rétablir ou supprimer.
  function viewAdminComments() {
    if (!authed()) return page(backBtn(), stateCard('!', 'Accès réservé', 'Connectez-vous avec le compte autorisé.'), footer());
    return api('fiila_admin_comments', {}).then(function (list) {
      function act(id, a) { api('fiila_admin_comment_decide', { p_id: id, p_action: a }).then(function () { toast(a === 'restore' ? 'Commentaire rétabli.' : 'Commentaire supprimé.'); render(); }, function (e) { toast(errText(e)); }); }
      return page(backBtn('Statistiques', '#/stats'), h('h1', null, 'Commentaires signalés'),
        h('p', { class: 'small muted' }, 'Masqué automatiquement après 3 signalements. Rétablir le rend visible et efface ses signalements.'),
        h('div', { class: 'stack', id: 'mod-list' }, list.length ? list.map(function (c) {
          return h('div', { class: 'card stack tight', id: 'mod-' + c.id },
            h('p', { class: 'small muted' }, (c.hidden ? 'Masqué' : 'Visible') + ' · ' + c.reports + (c.reports > 1 ? ' signalements' : ' signalement') + ' · ' + agoLong(c.at)),
            h('p', { class: 'wrapword' }, h('b', null, c.author), ' ', c.body),
            h('a', { class: 'btn link small', href: '#/b/' + c.slug + qs({ a: c.product_id }), style: 'align-self:flex-start' }, c.product + ' · ' + c.shop),
            h('div', { class: 'row' }, h('button', { class: 'btn ghost small', type: 'button', onclick: function () { act(c.id, 'restore'); } }, 'Rétablir'),
              h('button', { class: 'btn quiet danger-text', type: 'button', onclick: function () { act(c.id, 'delete'); } }, 'Supprimer')));
        }) : h('p', { class: 'muted', id: 'mod-empty' }, 'Aucun commentaire signalé.')),
        footer());
    }, function (e) { return page(backBtn('Statistiques', '#/stats'), stateCard('!', 'Accès refusé', errText(e)), footer()); });
  }
  function viewAdminVd() {
    if (!authed()) return page(backBtn(), stateCard('!', 'Accès réservé', 'Connectez-vous avec le compte autorisé.'), footer());
    return api('fiila_admin_vd', {}).then(function (d) {
      // Droits (audit 19/10) : vérifier = modération ; « livré » et « reversé » = finances. Une confirmation pour ce qui engage de l'argent.
      var canReview = d.can_review !== false, canPay = d.can_pay !== false;
      var ASK = { sold: 'Confirmer que cet article a été livré ? Il sera retiré de la vente.', paid: 'Confirmer que la vendeuse a été payée ?', unpublish: 'Retirer cet article de la vente ?' };
      function act(id, decision, needReason, btn) {
        var r = (document.getElementById('vdr-' + id) || {}).value || '';
        if (needReason && !r.trim()) { toast('Indiquez un motif.'); return; }
        if (ASK[decision] && window.confirm && !window.confirm(ASK[decision])) return;
        if (btn) { if (btn.disabled) return; btn.disabled = true; }
        api('fiila_admin_vd_decide', { p_id: id, p_decision: decision, p_reason: r || null }).then(function () { BO.overview = null; toast('Enregistré.'); render(); },
          function (e) { if (btn) btn.disabled = false; toast(errText(e)); });
      }
      function phone(p) { return p ? ' · ' + p : ''; }
      function desc(x) { return [lbl(VD_CATS, x.category), lbl(VD_GENDERS, x.gender), lbl(VD_AGES, x.age_band), x.size, lbl(VD_CONDITIONS, x.condition)].filter(Boolean).join(' · '); }
      return page(backBtn('Statistiques', '#/stats'),
        h('h1', null, 'Vide-dressing'), h('p', { class: 'small muted' }, 'Commission : ' + d.commission + ' %.'),
        canReview ? h('section', { class: 'stack tight', id: 'vd-queue' }, h('h2', null, 'À vérifier (' + d.queue.length + ')'),
          d.queue.length ? d.queue.map(function (x) {
            return h('div', { class: 'card stack tight' },
              h('img', { src: x.photo, alt: '', class: 'vd-photo' }),
              h('b', null, x.title + ' · ' + fcfa(x.price)), h('span', { class: 'small muted' }, desc(x)),
              h('span', { class: 'small' }, 'Vendeuse : ' + x.seller + phone(x.phone) + (x.quartier ? ' · ' + x.quartier : '')),
              h('p', { class: 'hint' }, 'Vérifier : aucune personne reconnaissable, article autorisé, photo nette, prix cohérent.'),
              h('input', { type: 'text', id: 'vdr-' + x.id, placeholder: 'Motif (correction ou refus)', maxlength: 200 }),
              h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: function () { act(x.id, 'approve', false, this); } }, 'Publier'),
                h('button', { class: 'btn ghost small', type: 'button', onclick: function () { act(x.id, 'changes', true, this); } }, 'Correction'),
                h('button', { class: 'btn quiet danger-text', type: 'button', onclick: function () { act(x.id, 'reject', true, this); } }, 'Refuser')));
          }) : h('p', { class: 'muted' }, 'Rien à vérifier.')) : null,
        d.orders.length || canPay ? h('section', { class: 'stack tight', id: 'vd-orders' }, h('h2', null, 'Commandes'),
          d.orders.length ? d.orders.map(function (o) {
            return h('div', { class: 'card stack tight' }, h('b', null, o.ref + ' · ' + o.customer + ' · ' + fcfa(o.total)),
              (o.items || []).map(function (it) { return h('span', { class: 'small' }, it.label + (it.seller ? ' — à récupérer chez ' + it.seller + ' (' + it.seller_phone + (it.quartier ? ', ' + it.quartier : '') + ')' : '')); }),
              h('a', { class: 'btn link', href: '#/f/' + o.invoice, style: 'align-self:flex-start' }, 'Voir la facture et l’adresse'));
          }) : h('p', { class: 'muted' }, 'Aucune commande.')) : null,
        h('section', { class: 'stack tight', id: 'vd-live' }, h('h2', null, 'En vente (' + d.live.length + ')'),
          d.live.map(function (x) {
            return h('div', { class: 'item' }, h('span', { class: 'small wrapword', style: 'flex:1' }, x.title + ' · ' + fcfa(x.price) + ' · ' + x.seller + (x.stock === 0 ? ' · commandé' : '')),
              canPay ? h('button', { class: 'btn ghost small', type: 'button', onclick: function () { act(x.id, 'sold', false, this); } }, 'Livré') : null,
              canReview ? h('button', { class: 'btn quiet danger-text', type: 'button', onclick: function () { act(x.id, 'unpublish', false, this); } }, 'Retirer') : null);
          })),
        canPay ? h('section', { class: 'stack tight', id: 'vd-pay' }, h('h2', null, 'À reverser'),
          d.to_pay.length ? d.to_pay.map(function (x) {
            return h('div', { class: 'item' }, h('span', { class: 'small wrapword', style: 'flex:1' }, x.seller + phone(x.phone) + ' · ' + x.title + ' · ' + fcfa(x.net)),
              h('button', { class: 'btn small', type: 'button', onclick: function () { act(x.id, 'paid', false, this); } }, 'Reversé'));
          }) : h('p', { class: 'muted' }, 'Rien à reverser.')) : null,
        footer());
    }, function (e) { return page(backBtn(), stateCard('!', 'Accès réservé', errText(e)), footer()); });
  }

  /* ================================================================ CONFIDENTIALITÉ */
  function viewPrivacy() {
    return page(backBtn(),
      h('div', { class: 'prose' },
        h('h1', null, 'Données et confidentialité'),
        h('p', null, 'Fii est en phase pilote. Cette page décrit ce que le service enregistre et comment le supprimer.'),
        h('h2', null, 'Ce qui est enregistré'),
        h('ul', null,
          h('li', null, 'Ce que vous saisissez : nom du lieu, quartier, repère, point d’entrée, point d’arrêt voiture, photo, et pour un événement sa date.'),
          h('li', null, 'Pour une demande d’adresse : le nom du demandeur, la raison et la référence éventuelle.'),
          h('li', null, 'Pour limiter les abus : une empreinte non réversible de l’adresse IP lors des créations, effacée après 24 heures.'),
          h('li', null, 'Si vous collez un lien court Google Maps, il est envoyé à notre serveur uniquement pour en lire le point, puis oublié : il n’est pas enregistré.'),
          h('li', null, 'Si vous créez un compte (facultatif) : votre e-mail, votre mot de passe (géré par Supabase Auth, jamais visible en clair), et si vous les ajoutez votre nom, votre téléphone et votre photo de profil.'),
          h('li', null, 'Si vous ouvrez une boutique : son nom et son téléphone s’il est indiqué ; vos clients (nom, téléphone), vos commandes, factures et les paiements que vous enregistrez. Pour ces données clients, le commerçant décide de ce qu’il saisit et en répond auprès de ses clients ; Fii les héberge pour lui.'),
          h('li', null, 'Si vous êtes livreur : votre nom, et si vous les indiquez votre téléphone, votre moyen de livraison et votre zone. Vos boutiques voient votre nom, votre téléphone et votre note ; les clients voient votre prénom.'),
          h('li', null, 'Si vous notez un article reçu : la note (1 à 5), rattachée à la commande, sans votre nom. Le commerçant voit la moyenne de ses articles.'),
          h('li', null, 'Origine et parrainage : quand vous créez une adresse, un événement, une boutique ou un espace livreur, Fii note d’où vous venez (lien reçu, lien ou code de parrainage, ou numéro de la personne qui vous a recommandé, si vous le tapez). La personne qui vous a parrainé voit qu’une arrivée a eu lieu : le nom d’une boutique, le prénom d’un livreur, jamais le nom ni l’adresse d’un particulier.'),
          h('li', null, 'Si vous créez un code de parrainage : votre nom et, si vous l’indiquez, votre numéro. Le numéro n’est jamais affiché ; il sert seulement à vous reconnaître quand quelqu’un le tape. Les personnes qui ouvrent votre lien voient votre prénom.'),
          h('li', null, 'Repère vocal (facultatif) : l’enregistrement de 30 secondes au plus que vous ajoutez à votre adresse. Le micro n’est utilisé que lorsque vous appuyez sur « Enregistrer ». Toute personne qui a le lien, et le livreur d’une course, peuvent l’écouter. Il est supprimé avec la fiche, ou dès que vous le retirez.'),
          h('li', null, 'Vitrine d’une boutique (si elle l’ouvre) : ses articles visibles par toute personne qui a le lien. Une commande passée sur la vitrine transmet votre nom, votre numéro et votre commande à cette boutique seulement ; votre adresse n’est donnée qu’ensuite, par vous.'),
          h('li', null, 'Fil des boutiques : les 25 premières boutiques qui ouvrent leur vitrine y apparaissent gratuitement (nom, présentation, articles, prix, note). La boutique peut en sortir à tout moment dans ses réglages. Aucune donnée de client n’y figure.'),
          h('li', null, 'Programme Agents (facultatif, avec un compte) : votre nom, votre téléphone, votre quartier, votre numéro de versement, votre résultat au test, les boutiques que vous accompagnez et vos gains. Une boutique accompagnée voit le prénom de son agent ; l’agent voit le nom de la boutique et ses indicateurs (nombre d’articles, de commandes et de clientes), jamais le nom ni le numéro des clientes.'),
          h('li', null, 'Vide-dressing : pour vendre, votre nom, votre téléphone, votre quartier et les informations de l’article (photo, catégorie, taille, état, prix ; genre et âge pour un article d’enfant). Ils ne sont visibles que de l’équipe Fii, pour vérifier l’article et organiser l’enlèvement ; l’acheteur ne voit que l’article. Les photos ne doivent montrer aucune personne reconnaissable.'),
          h('li', null, 'Publication d’un article : Fii compte seulement qu’une publication a été faite, pas le réseau choisi.'),
          h('li', null, 'Suivi en direct (livreur ou invité d’un événement), seulement si vous le démarrez : votre dernière position et une courte trace, visibles par l’expéditeur et le client (livraison) ou par le seul organisateur (rendez-vous). Effacées dès l’arrivée ou l’arrêt, et au plus tard un jour après la fin de la livraison ou de l’événement. Pour un événement, votre prénom.')),
        h('h2', null, 'Ce qui est obligatoire'),
        h('p', null, 'Pour une adresse : un nom de lieu, le point d’entrée, et une photo ou un repère écrit. Pour un événement : un nom, le lieu et la date. Tout le reste est facultatif. Sans les éléments obligatoires, la fiche ne peut pas être créée.'),
        h('h2', null, 'Où sont stockées les données'),
        h('p', null, 'Les fiches sont enregistrées dans une base de données hébergée par Supabase sur des serveurs situés à Paris (France), donc hors du Sénégal. Supabase agit comme prestataire technique et ne les utilise pas pour son propre compte. Le site lui-même est servi par GitHub Pages, qui ne reçoit aucune donnée de fiche.'),
        h('h2', null, 'Combien de temps'),
        h('ul', null,
          h('li', null, 'Adresse : jusqu’à ce que vous la supprimiez.'),
          h('li', null, 'Événement : le lieu cesse d’être affiché à la date choisie, puis la fiche est effacée 30 jours plus tard.'),
          h('li', null, 'Demande d’adresse : valable 7 jours, effacée 30 jours après son expiration.'),
          h('li', null, 'Empreinte de l’adresse IP : 24 heures.'),
          h('li', null, 'Commandes, factures et clients d’une boutique : 24 mois au plus, ou moins si le commerçant les supprime. Compte et boutique : jusqu’à leur suppression.'),
          h('li', null, 'Origine d’une arrivée : autant que la fiche, la boutique ou l’espace livreur concerné. Code de parrainage : jusqu’à ce que vous le supprimiez (page « Inviter un proche »).'),
          h('li', null, 'Adresse donnée à un commerçant pour une commande : il peut la réutiliser pour vos commandes suivantes tant que son lien reste actif. La désactiver ou la supprimer la lui retire.')),
        h('h2', null, 'Vos droits'),
        h('p', null, 'Depuis le téléphone qui a créé la fiche (ou avec sa clé de gestion), vous pouvez à tout moment la consulter, la modifier, désactiver son lien ou la supprimer définitivement.'),
        h('h2', null, 'Ce qui n’est pas collecté'),
        h('ul', null,
          h('li', null, 'Pas de compte obligatoire, pas d’accès à vos contacts, pas de pièce d’identité. Aucun paiement en ligne n’est traité par Fii pour le moment.'),
          h('li', null, 'Pas de suivi de position : votre position n’est lue qu’au moment où vous appuyez sur « Utiliser ma position ».'),
          h('li', null, 'Les données de localisation contenues dans les photos sont retirées avant l’envoi, et le serveur refuse les photos qui en contiennent encore.'),
          h('li', null, 'Pas de publicité ni d’outil de suivi. Fii compte seulement, par jour et sans aucun identifiant, quelques actions (par exemple « une fiche a été créée » ou « un lien a été copié »), pour savoir si le service est utile. Si votre navigateur envoie le signal « ne pas suivre », rien n’est compté.')),
        h('h2', null, 'Qui peut voir une fiche'),
        h('p', null, 'Toute personne qui a le lien peut voir la fiche et le transférer. Les fiches ne sont jamais listées publiquement. Une réponse à une demande n’est visible que par le demandeur.'),
        h('h2', null, 'Désactiver et supprimer'),
        h('p', null, 'Depuis « Mes adresses », vous pouvez désactiver un lien (il n’affiche plus rien) ou supprimer la fiche et sa photo. Les événements cessent d’afficher le lieu à la date choisie, puis sont effacés 30 jours plus tard. Les copies d’écran ou messages déjà envoyés ne peuvent pas être rappelés. Les sauvegardes techniques de la base peuvent conserver une copie pendant quelques jours avant d’être écrasées.'),
        h('h2', null, 'Clé de gestion'),
        h('p', null, 'Vos fiches sont gérées depuis le téléphone qui les a créées. Si vous le perdez ou effacez ses données, seule la clé de gestion permet de les modifier ou de les supprimer. Sans elle, Fii ne peut pas vérifier que la fiche vous appartient.'),
        h('h2', null, 'Services tiers'),
        h('p', null, 'La carte utilise les tuiles OpenStreetMap, chargées uniquement pendant la création d’une fiche. Les itinéraires s’ouvrent dans Google Maps, selon ses propres conditions.')),
      footer());
  }

  /* ================================================================ réseau */
  function netState() { var n = document.getElementById('net'); if (n) n.hidden = navigator.onLine !== false; }
  window.addEventListener('online', netState);
  window.addEventListener('offline', netState);
  netState();

  // Service worker : coquille de l'application disponible hors ligne, condition d'installation.
  // Il ne met jamais en cache les appels à l'API ni le contenu des fiches.
  try {
    if ('serviceWorker' in navigator && CFG.serviceWorker !== false &&
        (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
      window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* facultatif */ }); });
    }
  } catch (e) { /* facultatif */ }

  authBoot.then(render, render);
})();
