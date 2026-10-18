/* Fii La — application web (sans framework, sans étape de build).
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
      h('div', { class: 'foot-links' }, h('a', { href: '#/', class: 'foot-brand' }, 'Fii La'), h('a', { href: '#/confidentialite' }, 'Données et confidentialité')));
    return h('footer', { class: 'foot' },
      themeSwitch(),
      h('div', { class: 'foot-links' },
        h('a', { href: '#/' }, 'Fii La'),
        h('a', { href: '#/compte', id: 'foot-account' }, authed() ? 'Mon compte' : 'Se connecter'),
        h('a', { href: '#/livreur', id: 'foot-courier' }, 'Espace livreur'),
        h('a', { href: '#/confidentialite' }, 'Données et confidentialité'),
        h('a', { href: '#/cle' }, 'Restaurer une clé de gestion')));
  }
  // Thème : Automatique (réglage du téléphone, par défaut), Clair ou Sombre. Choix gardé sur ce téléphone.
  function currentTheme() { var t = document.documentElement.getAttribute('data-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }
  function setTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    try { if (t === 'light' || t === 'dark') localStorage.setItem('fiila-theme', t); else localStorage.removeItem('fiila-theme'); } catch (e) { /* navigation privée */ }
    syncThemeColor();
  }
  function syncThemeColor() {
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      if (currentTheme() === 'auto') metas[i].setAttribute('content', /dark/.test(metas[i].media) ? '#0D1310' : '#F5F2EA');
      else if (bg) metas[i].setAttribute('content', bg);
    }
  }
  function themeSwitch() {
    var cur = currentTheme();
    function opt(val, text) {
      return h('label', null, h('input', { type: 'radio', name: 'theme', value: val, checked: cur === val ? 'checked' : null,
        onchange: function () { setTheme(val); } }), text);
    }
    return h('fieldset', { class: 'theme-switch' }, h('legend', null, 'Thème'),
      h('div', { class: 'segs' }, opt('light', 'Clair'), opt('dark', 'Sombre'), opt('auto', 'Automatique')));
  }
  // En-tête discret des pages reçues par lien : de quoi il s'agit, en un coup d'œil.
  function brandBar(kind) {
    return h('div', { class: 'brand-bar' }, h('span', { class: 'mark small', 'aria-label': 'Fii La' }, 'Fii', h('span', null, 'La')), kind ? h('span', { class: 'brand-kind' }, kind) : null);
  }
  var STATE_ICONS = { '?': 'help', '!': 'alert', '⦸': 'ban', '⌛': 'hourglass', '✓': 'check' };
  function stateCard(glyph, title, text, extra) {
    return h('div', { class: 'card state' + (glyph === '!' ? ' error' : '') },
      h('div', { class: 'big', 'aria-hidden': 'true' }, icon(STATE_ICONS[glyph] || 'help', 26)),
      h('h2', null, title), text ? h('p', { class: 'muted' }, text) : null, extra || null);
  }
  function loading(text) { return h('p', { class: 'loading', role: 'status' }, text || 'Chargement…'); }

  /* ================================================================ format & liens */
  function fmt(p) { return Number(p.lat).toFixed(6) + ', ' + Number(p.lng).toFixed(6); }
  function gmSearch(p) { return 'https://www.google.com/maps/search/?api=1&query=' + Number(p.lat).toFixed(6) + '%2C' + Number(p.lng).toFixed(6); }
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
    expiry_too_far: 'Un rendez-vous peut rester visible 31 jours au plus.',
    start_too_far: 'La date est trop lointaine.',
    invalid_date: 'Date non valide.',
    name_required: 'Indiquez votre nom ou celui de votre commerce.',
    purpose_required: 'Indiquez pourquoi vous demandez l’adresse.',
    already_fulfilled: 'Cette demande a déjà reçu une réponse.',
    expired: 'Cette demande a expiré.',
    place_revoked: 'Cette adresse est désactivée. Choisissez-en une autre.',
    not_an_address: 'Choisissez une adresse, pas un rendez-vous.',
    invalid_kind: 'Type de fiche non valide.',
    invalid_payload: 'Données non valides.',
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
    not_allowed: 'Action non autorisée.'
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
  function pkceStart(kind) {
    var v = new Uint8Array(32); crypto.getRandomValues(v);
    var verifier = b64url(v);
    LS.set('fiila.pkce', { verifier: verifier, kind: kind, at: Date.now() });
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (d) {
      return { code_challenge: b64url(new Uint8Array(d)), code_challenge_method: 's256' };
    });
  }
  var account = {
    signUp: function (email, password, name, source) {
      return pkceStart('signup').then(function (pk) {
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
    setPassword: function (pw) { return freshToken().then(function () { return authCall('/user', 'PUT', { password: pw }, true); }); },
    recover: function (email) {
      return pkceStart('recovery').then(function (pk) {
        return authCall('/recover?redirect_to=' + encodeURIComponent(baseUrl()), 'POST', Object.assign({ email: email }, pk));
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
      clean(pk.kind === 'recovery' ? '#/compte?mdp=1' : '#/compte?bienvenue=1');
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
    owned_reopened: ['address', 'meeting', 'request']
  };
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
          h('p', null, h('strong', { id: 'install-title' }, 'Installer Fii La'), ' (facultatif) : retrouvez vos fiches depuis l’écran d’accueil. C’est le même site, rien à télécharger depuis un store.'),
          h('div', { class: 'install-actions' },
            h('button', { class: 'btn ghost small', type: 'button', id: 'install-btn', onclick: function () {
              var ev = deferredInstall; deferredInstall = null;
              if (!ev) { draw(); return; }
              Promise.resolve().then(function () { return ev.prompt(); }).then(function () { return ev.userChoice; })
                .then(function (c) { if (c && c.outcome === 'accepted') LS.set('fiila.install.done', true); draw(); }, function () { draw(); });
            } }, 'Installer Fii La'),
            later)));
      } else if (iosManualInstall()) {
        add(slot, h('section', { class: 'install', 'aria-labelledby': 'install-title' },
          h('p', null, h('strong', { id: 'install-title' }, 'Ajouter Fii La à l’écran d’accueil'), ' (facultatif) : touchez le bouton Partager du navigateur, puis « Sur l’écran d’accueil ».'),
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
    if (p.src === 'reused') return ['mid', 'Point repris du rendez-vous précédent : vérifiez-le, puis validez.'];
    return ['neutral', 'Placé à la main sur la carte.'];
  }

  // opts: { get(), set(p|null), what: 'l’entrée', id }
  function mapPicker(opts) {
    var current = opts.get();
    // opts.initial : point repris (rendez-vous similaire) affiché mais NON validé tant que l'utilisateur ne confirme pas.
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
          h('p', null, IS_IOS ? 'Ouvrez Fii La dans Safari : touchez « ⋯ » ou le menu de l’application, puis « Ouvrir dans Safari » (ou « Ouvrir dans le navigateur »).'
            : 'Ouvrez Fii La dans Chrome : touchez « ⋮ » ou le menu de l’application, puis « Ouvrir dans Chrome » (ou « Ouvrir dans le navigateur »).'),
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
      else if (!opts.get() && opts.initial) say('Point repris du rendez-vous précédent. Vérifiez qu’il est toujours juste, puis validez.', 'info');
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
        compressPhoto(f, opts.maxSide).then(function (d) { opts.set(d); msg.textContent = ''; draw(); },
          function (e) { msg.textContent = e.message; msg.className = 'msg err'; });
        inp.value = '';
      }
    });
    function draw() {
      var p = opts.get();
      setKids(box, 
        h('span', { class: 'label' }, (opts.label || 'Photo de l’entrée') + ' ', h('span', { class: 'hint' }, opts.optional ? '(facultatif)' : '(conseillé)')),
        p ? h('img', { class: 'photo-prev', src: p, alt: 'Aperçu : ' + (opts.label || 'photo de l’entrée') }) : null,
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
    var place = isMeeting ? 'Lieu du rendez-vous' : 'Entrée';
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
          isMeeting ? h('p', { class: 'eyebrow' }, 'Rendez-vous') : (p.locality ? h('p', { class: 'eyebrow wrapword' }, p.locality) : null),
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
  // state : { action: 'keep'|'set'|'clear', b64, url, secs, existing: { secs, token } }
  function voiceRecorder(state, onChange) {
    var box = h('div', { class: 'stack tight', id: 'voice-box' });
    var rec = null, chunks = [], timer = null, started = 0, stream = null, audio = null;
    function stopAll() { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* rien */ } if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); clearInterval(timer); }
    function draw() {
      var has = state.action === 'set' || (state.action === 'keep' && state.existing);
      if (has) {
        var secs = state.action === 'set' ? state.secs : state.existing.secs;
        var playBtn = h('button', { class: 'btn vbtn', type: 'button', id: 'voice-play', 'aria-label': 'Écouter' }, icon('play', 24));
        playBtn.onclick = function () {
          if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; setKids(playBtn, icon('play', 24)); return; }
          var go = function (src) { audio = new Audio(src); audio.onended = function () { setKids(playBtn, icon('play', 24)); }; audio.play().then(null, function () {}); setKids(playBtn, icon('stop', 24)); };
          if (state.action === 'set') go(state.url);
          else api('fiila_voice', { p_token: state.existing.token, p_via: 'share' }).then(function (r) { if (r.state === 'ok') go(r.voice); }, function (e) { toast(errText(e)); });
        };
        setKids(box, h('div', { class: 'voice' }, playBtn,
          h('div', { class: 'vtxt' }, h('strong', null, 'Repère vocal'), h('span', { class: 'muted' }, secsText(secs))),
          iconBtn('button', { class: 'btn ghost small', type: 'button', id: 'voice-redo', onclick: start }, 'mic', 'Refaire', 18),
          h('button', { class: 'btn quiet danger-text', type: 'button', id: 'voice-remove', 'aria-label': 'Retirer le repère vocal', style: 'min-height:44px;padding:0 6px',
            onclick: function () { state.action = state.existing ? 'clear' : 'keep'; state.existing = null; state.b64 = null; state.url = null; onChange(); draw(); } }, icon('trash', 20))));
        return;
      }
      if (!voiceSupported()) { setKids(box); return; }
      setKids(box, h('div', { class: 'voice' },
        h('button', { class: 'btn vbtn', type: 'button', id: 'voice-record', 'aria-label': 'Enregistrer un message vocal', onclick: start }, icon('mic', 24)),
        h('div', { class: 'vtxt' }, h('strong', null, 'Repère vocal'), h('span', { class: 'muted' }, 'Facultatif. 30 secondes, dans votre langue.'))));
    }
    function start() {
      if (!voiceSupported()) return;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s; chunks = [];
        var types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
        var mime = types.filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0];
        try { rec = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }); }
        catch (e) { rec = new MediaRecorder(s); }
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          clearInterval(timer);
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
          var secs = Math.min(VOICE_MAX, (Date.now() - started) / 1000);
          var blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
          if (secs < 1 || !blob.size) { toast('Enregistrement trop court.'); draw(); return; }
          blobToB64(blob).then(function (b64) {
            state.action = 'set'; state.b64 = b64; state.secs = Math.round(secs); state.url = URL.createObjectURL(blob);
            onChange(); draw();
          });
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
        setKids(box, h('div', { class: 'voice' }, h('span', { class: 'vbtn btn ghost', 'aria-hidden': 'true' }, icon('mic', 24)),
          h('div', { class: 'vtxt' }, h('strong', null, 'Micro non autorisé'), h('span', { class: 'muted' }, 'Autorisez le micro dans les réglages du navigateur, puis réessayez.'))));
        setTimeout(draw, 5000);
      });
    }
    draw();
    box.stop = stopAll;
    return box;
  }
  // Lecteur pour la personne qui reçoit : rien n'est chargé avant le toucher.
  function voicePlayer(token, via, secs) {
    var audio = null;
    var btn = h('button', { class: 'btn vbtn', type: 'button', id: 'voice-listen', 'aria-label': 'Écouter le repère vocal' }, icon('play', 24));
    var status = h('span', { class: 'muted' }, secsText(secs));
    btn.onclick = function () {
      if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; setKids(btn, icon('play', 24)); return; }
      if (audio) { audio.play().then(null, function () {}); setKids(btn, icon('stop', 24)); return; }
      status.textContent = 'Chargement…';
      api('fiila_voice', { p_token: token, p_via: via }).then(function (r) {
        if (r.state !== 'ok') { status.textContent = 'Indisponible.'; return; }
        status.textContent = secsText(r.secs);
        audio = new Audio(r.voice);
        audio.onended = function () { setKids(btn, icon('play', 24)); };
        audio.play().then(null, function () {});
        setKids(btn, icon('stop', 24));
      }, function (e) { status.textContent = errText(e); });
    };
    return h('div', { class: 'voice', id: 'voice-player' }, btn, h('div', { class: 'vtxt' }, h('strong', null, 'Écouter le repère'), status));
  }
  function voiceOwnerBox(pl) {
    return h('section', { class: 'stack tight' }, voicePlayer(pl.share_token, 'share', pl.voice_secs));
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
    var cart = {}; // id → quantité
    var byId = {}; products.forEach(function (p) { byId[p.id] = p; });
    var bar = h('div', { class: 'cartbar', hidden: true });
    var root = h('div', { class: 'stack' });
    function count() { return Object.keys(cart).reduce(function (n, k) { return n + cart[k]; }, 0); }
    function total() { return Object.keys(cart).reduce(function (n, k) { return n + cart[k] * byId[k].price; }, 0); }
    function refreshBar() {
      var n = count();
      bar.hidden = !n;
      setKids(bar, iconBtn('button', { class: 'btn big', type: 'button', id: 'cart-go', onclick: checkout }, 'box',
        'Commander · ' + n + ' article' + (n > 1 ? 's' : '') + ' · ' + fcfa(total())));
    }
    function stepper(p) {
      var box = h('div', { class: 'qty' });
      function draw() {
        var n = cart[p.id] || 0;
        setKids(box, n ? [
          h('button', { class: 'qbtn', type: 'button', 'aria-label': 'Retirer un ' + p.name, onclick: function () { if (--cart[p.id] <= 0) delete cart[p.id]; draw(); refreshBar(); } }, '−'),
          h('span', { class: 'qn', 'aria-live': 'polite' }, String(n)),
          h('button', { class: 'qbtn', type: 'button', 'aria-label': 'Ajouter un ' + p.name, onclick: function () { if (cart[p.id] < 99) cart[p.id]++; draw(); refreshBar(); } }, '+')]
          : iconBtn('button', { class: 'btn small add-btn', type: 'button', 'data-add': p.id, onclick: function () { cart[p.id] = 1; draw(); refreshBar(); } }, 'plus', 'Ajouter', 18));
      }
      draw();
      return box;
    }
    function card(p) {
      var img = h('div', { class: 'vimg' + (p.has_photo ? ' loading-skel' : ''), 'aria-hidden': p.has_photo ? null : 'true' }, p.has_photo ? null : icon('shop', 32));
      if (p.has_photo) lazyPhoto(img, function () {
        return api('fiila_vitrine_photo', { p_slug: slug, p_id: p.id }).then(function (x) { return x.photo; });
      }, p.name);
      return h('article', { class: 'vcard' + (q.a === p.id ? ' focus' : ''), id: 'p-' + p.id },
        img,
        h('div', { class: 'vbody' },
          h('h3', { class: 'wrapword' }, p.name),
          h('p', { class: 'vprice' }, fcfa(p.price)),
          p.reviews ? ratingEl(p.rating, p.reviews) : null,
          p.description ? h('p', { class: 'small muted vdesc' }, p.description) : null,
          stepper(p)));
    }
    function list() {
      setKids(root,
        h('header', { class: 'vhead' },
          h('span', { class: 'vavatar', 'aria-hidden': 'true' }, (shop.name || '?').trim().charAt(0).toUpperCase()),
          h('div', null, h('h1', { class: 'wrapword' }, shop.name),
            shop.reviews ? ratingEl(shop.rating, shop.reviews) : null,
            shop.about ? h('p', { class: 'muted wrapword' }, shop.about) : null)),
        products.length ? h('div', { class: 'vgrid', id: 'vitrine-products' }, products.map(card))
          : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Aucun article pour le moment.')),
        h('p', { class: 'safe-line' }, icon('lock', 18), 'Commande sans compte. Vous donnez votre adresse à la dernière étape.'));
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
        api('fiila_vitrine_order', { p_slug: slug, p: { items: Object.keys(cart).map(function (k) { return { product_id: k, qty: cart[k] }; }),
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
            return h('div', { class: 'total-row' }, h('span', { class: 'wrapword' }, cart[k] + ' × ' + byId[k].name), h('span', null, fcfa(cart[k] * byId[k].price)));
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
  // Réglages : ouvrir, fermer et présenter sa vitrine.
  function vitrineSection(shop) {
    var box = h('section', { class: 'card', id: 'vitrine-section' });
    var state = { public: !!shop.public, slug: shop.slug, about: shop.about || '', theme: shop.theme || 'galerie', accent: shop.accent || 'foret', cover: null };
    sapi('fiila_shop_vitrine', { p: null }).then(function (r) { state.cover = r.cover || null; state.theme = r.theme || state.theme; state.accent = r.accent || state.accent; draw(); }, function () {});
    var err = h('div', { role: 'alert' });
    function save(p, okText) {
      return sapi('fiila_shop_vitrine', { p: p }).then(function (r) {
        state.public = !!r.public; state.slug = r.slug; state.about = r.about || ''; state.theme = r.theme || 'galerie'; state.accent = r.accent || 'foret'; state.cover = r.cover || null;
        toast(okText); draw();
      }, function (e) { errBox(err, e); });
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
        iconBtn('button', { class: 'btn ghost small', type: 'button', id: 'vitrine-about-save', onclick: function () { save({ about: state.about }, 'Présentation enregistrée.'); } }, 'check', 'Enregistrer la présentation', 18),
        err);
    }
    draw();
    return box;
  }

  /* ================================================================ ORIGINE ET PARRAINAGE
     Chaque lien Fii La reçu dit d'où vient la personne. On garde la première origine (30 jours) sur ce téléphone,
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
  // « Qui vous a parlé de Fii La ? » : replié, facultatif ; absent si la personne arrive par un lien de parrainage.
  function referralAsk(id) {
    var val = '';
    var t = touchGet();
    var el = t && t.src === 'link' ? null : h('details', { class: 'ref-ask', id: id },
      h('summary', null, 'Quelqu’un vous a recommandé Fii La ?'),
      textField({ id: id + '-input', label: 'Son numéro ou son code', optional: true, inputmode: 'text', max: 30,
        placeholder: 'Ex. : 77 123 45 67 ou K7M2QD', onInput: function (v) { val = v; } }));
    return { el: el, value: function () { return val; } };
  }
  function referralUrl(code) { return baseUrl() + '#/r/' + code; }
  function referralMessage(kind, code) {
    var url = referralUrl(code);
    if (kind === 'shop') return 'Je reçois l’adresse de mes clientes en une photo avec Fii La : la bonne porte, un repère, le livreur arrive du premier coup. Crée ta boutique, c’est gratuit : ' + url;
    if (kind === 'courier') return 'Avec Fii La, les boutiques m’envoient l’adresse exacte avec la photo de l’entrée. Plus besoin d’appeler pour trouver. Essaie : ' + url;
    return 'J’envoie mon adresse en une photo avec Fii La : la bonne porte, un repère, où se garer. C’est gratuit : ' + url;
  }
  // Bandeau d'arrivée par lien de parrainage (accueil), tant que rien n'a été créé sur ce téléphone.
  function inviteBanner() {
    var t = touchGet();
    if (!t || t.src !== 'link' || owned.all().length || shopKey() || courierKey()) return null;
    var box = h('section', { class: 'card invite', id: 'invite-banner', hidden: true });
    api('fiila_referral_public', { p_code: t.token }).then(function (r) {
      if (r.state !== 'ok' || !r.name) return;
      setKids(box, h('p', null, h('strong', null, r.name), ' vous invite sur Fii La.'),
        h('p', { class: 'small muted' }, r.kind === 'shop' || r.kind === 'courier'
          ? 'Recevez l’adresse exacte de vos clients en une photo. Gratuit, sans compte.'
          : 'Créez votre adresse une fois, envoyez-la par un lien. Gratuit, sans compte.'),
        r.kind === 'shop' || r.kind === 'courier'
          ? h('div', { class: 'row' }, iconBtn('a', { class: 'btn', href: '#/boutique', id: 'invite-shop' }, 'shop', 'Créer ma boutique'),
              iconBtn('a', { class: 'btn ghost', href: '#/livreur' }, 'moto', 'Je suis livreur'))
          : null);
      box.hidden = false;
    }, function () { /* hors ligne : pas de bandeau */ });
    return box;
  }

  var REF_KIND = { shop: 'Boutique', courier: 'Livreur', address: 'Adresse', meeting: 'Rendez-vous' };
  function viewReferral(q) {
    var forWho = q.pour === 'boutique' ? 'shop' : q.pour === 'livreur' ? 'courier' : 'person';
    var key = forWho === 'shop' ? shopKey() : forWho === 'courier' ? courierKey() : ((LS.get(REF_LS, null) || {}).key || null);
    var back = forWho === 'shop' ? backBtn('Ma boutique', '#/boutique') : forWho === 'courier' ? backBtn('Espace livreur', '#/livreur') : backBtn();
    return api('fiila_referral_me', { p_for: forWho, p_key: key }).then(function (r) {
      return r.referrer ? referralPage(forWho, r.referrer, back) : referralCardForm(back);
    }, function (e) {
      if (e.code === 'shop_required') { go('#/boutique'); return loading(); }
      if (e.code === 'courier_required') { go('#/livreur'); return loading(); }
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
        h('p', { class: 'muted' }, 'Votre code et votre lien comptent chaque personne qui rejoint Fii La grâce à vous.')),
      textField({ id: 'ref-name', label: 'Votre nom', max: 60, autocomplete: 'name', onInput: function (v) { f.name = v; } }),
      textField({ id: 'ref-phone', label: 'Votre numéro', optional: true, type: 'tel', inputmode: 'tel', onInput: function (v) { f.phone = v; },
        hint: 'Vos proches pourront taper votre numéro au lieu du code. Il n’est jamais affiché.' }),
      err, btn, footer());
  }
  function referralPage(forWho, ref, back) {
    var msg = referralMessage(forWho, ref.code);
    var intro = forWho === 'shop' ? 'Invitez d’autres boutiques et vos clientes. Chaque personne qui rejoint Fii La par votre lien, votre code ou votre numéro est comptée pour vous.'
      : forWho === 'courier' ? 'Invitez les boutiques que vous livrez et d’autres livreurs. Chaque arrivée par votre lien, votre code ou votre numéro est comptée pour vous.'
      : 'Invitez vos proches. Chaque personne qui rejoint Fii La par votre lien ou votre code est comptée pour vous.';
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
    function logged() {
      sapi('fiila_post_log', { p_product_id: pr.id }).then(function (r) { count = r.posts; countEl.textContent = 'Publié ' + count + ' fois.'; }, function () { /* sans effet */ });
    }
    function fallback() {
      setKids(more,
        h('p', { class: 'small' }, 'Enregistrez la photo, puis collez la légende dans votre publication.'),
        h('div', { class: 'row' },
          pr.photo ? h('a', { class: 'btn ghost', id: 'post-download', href: pr.photo, download: slugName(pr.name), onclick: logged }, 'Enregistrer la photo') : null,
          h('button', { class: 'btn ghost', type: 'button', id: 'post-copy', onclick: function () { copy(text, 'Légende'); if (!pr.photo) logged(); } }, 'Copier la légende')),
        h('pre', { class: 'caption', id: 'post-caption' }, text));
    }
    function publish() {
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(null, function () { /* rien */ }); } catch (e) { /* rien */ }
      var file = pr.photo ? dataUrlFile(pr.photo, slugName(pr.name)) : null;
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
    address: 'Adresse reçue', meeting: 'Rendez-vous reçu', course: 'Course livreur', watch: 'Suivi de livraison', courier_invite: 'Invitation livreur',
    post: 'Publication', direct: 'Direct' };
  function viewStats() {
    if (!authed()) return page(backBtn(), stateCard('!', 'Accès réservé', 'Connectez-vous avec le compte autorisé.', h('a', { class: 'btn', href: '#/compte' + qs({ retour: 'stats' }) }, 'Se connecter')), footer());
    return api('fiila_admin_stats', {}).then(function (s) {
      var T = s.totals;
      function tile(n, label) { return h('div', { class: 'tile' }, h('strong', null, String(n || 0)), h('span', null, label)); }
      var src = Object.keys(s.sources || {}).sort(function (a, b) { return s.sources[b] - s.sources[a]; });
      return page(backBtn(),
        h('div', { class: 'stack tight' }, h('p', { class: 'eyebrow' }, 'Fondateur'), h('h1', null, 'Croissance')),
        h('div', { class: 'tiles', id: 'stats-totals' },
          tile(T.shops, 'boutiques'), tile(T.couriers, 'livreurs'), tile(T.addresses, 'adresses actives'), tile(T.meetings, 'rendez-vous actifs'),
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
      raw.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
      raw = raw.slice(0, qi);
    }
    var parts = raw.split('/').filter(Boolean);
    return { parts: parts, q: q };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function render() {
    var seq = ++renderSeq;
    staleToast();
    var r = parseHash(), p = r.parts, view;
    noteTouch(p);
    try {
      if (!p.length) view = viewHome();
      else if (p[0] === 'r' && p[1]) { try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch (e) { /* rien */ } view = viewHome(); }
      else if (p[0] === 'parrainer') view = viewReferral(r.q);
      else if (p[0] === 'stats') view = viewStats();
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
      else if (p[0] === 'boutique' && p[1] === 'reglages') view = viewShopSettings();
      else if (p[0] === 'boutique' && p[1] === 'articles') view = viewProducts();
      else if (p[0] === 'livreur' && !p[1]) view = viewCourierHome();
      else if (p[0] === 'livreur' && p[1] === 'invitation' && p[2]) view = viewCourierInvite(p[2]);
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
      setKids(app, node);
      window.scrollTo(0, 0);
    });
  }
  window.addEventListener('hashchange', render);

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
              onclick: function () { track('share_initiated', 'whatsapp_address'); } }, 'chat', 'Envoyer'),
            iconBtn('button', { class: 'btn ghost mid', type: 'button', onclick: function () { copy(url, 'Lien', function () { track('link_copied', 'address'); }); } }, 'link', 'Copier')) : null);
      }
      setKids(listBox, 
        offlineMsg ? h('p', { class: 'alert' }, offlineMsg) : null,
        h('section', { class: 'stack', id: 'mes-adresses', 'aria-labelledby': 'h-adr' },
          h('h2', { id: 'h-adr' }, 'Mes adresses'),
          addrs.length ? h('div', { class: 'list' }, addrs.map(addrCard)) : h('div', { class: 'card' },
            h('p', null, authed() ? 'Aucune adresse pour l’instant.' : 'Aucune adresse sur ce téléphone.'),
            authed() ? null : h('p', { class: 'small muted' }, 'Connectez-vous pour retrouver vos adresses sur tous vos téléphones.'))),
        reqs.length ? h('section', { class: 'stack', 'aria-labelledby': 'h-req' }, h('h2', { id: 'h-req' }, 'Mes demandes'),
          h('div', { class: 'list' }, reqs.map(function (x) {
            return item(x, '#/demande/' + x.id, x.purpose || 'Demande', x.requester_name ? 'De : ' + x.requester_name : null,
              x.cached ? null : x.state === 'fulfilled' ? chip('ok', 'Adresse reçue') : x.state === 'expired' ? chip('off', 'Expirée') : chip('wait', 'En attente'));
          }))) : null,
        meets.length ? h('section', { class: 'stack', 'aria-labelledby': 'h-rdv' }, h('h2', { id: 'h-rdv' }, 'Mes rendez-vous'),
          h('div', { class: 'list' }, meets.map(function (x) {
            return item(x, '#/m/' + x.id, x.label || 'Rendez-vous', x.starts_at ? whenText(x.starts_at) : null,
              x.cached ? null : x.expired ? chip('off', 'Expiré') : x.status === 'active' ? chip('ok', 'Actif') : chip('off', 'Lien désactivé'));
          }))) : null);
    }

    var who = authed() ? h('a', { class: 'who', id: 'account-link', href: '#/compte' }, avatarEl(null, 32), 'Mon compte') : null;
    if (authed()) account.me().then(function (me) {
      if (!me) { setKids(who, 'Se connecter'); return; }
      setKids(who, avatarEl(me, 32), h('span', { class: 'who-name' }, me.display_name || 'Mon compte'));
      if (me.shop && shopBtn) shopBtn.setAttribute('aria-label', 'Ma boutique : ' + me.shop.name);
    }, function () { /* hors ligne : on garde le lien */ });
    function tile4(href, name, label, attrs) {
      return h('a', Object.assign({ class: 'ttile', href: href }, attrs || {}), h('span', { class: 'ttile-ic', 'aria-hidden': 'true' }, icon(name, 26)), h('span', { class: 'pro-name' }, label));
    }
    var shopBtn = CFG.shop === false ? null : tile4('#/boutique', 'shop', 'Boutique', { id: 'shop-link', 'aria-label': 'Ma boutique' });
    return page(
      h('header', { class: 'stack tight' },
        h('div', { class: 'brand-row' },
          h('div', { class: 'brand' }, h('span', { class: 'mark', 'aria-label': 'Fii La' }, 'Fii', h('span', null, 'La'))),
          who),
        h('p', { class: 'promise' }, 'Votre adresse, en une photo.')),
      inviteBanner(),
      // Une grande action ; quatre raccourcis avec pictogramme ; puis les adresses (proposition validée le 18/10).
      h('a', { class: 'hero', href: '#/new', id: 'create-address', 'aria-label': 'Créer mon adresse' },
        h('span', { class: 'hero-ic', 'aria-hidden': 'true' }, icon('cam', 32)),
        h('span', null, h('b', null, 'Créer mon adresse'), h('small', null, 'Photo de la porte · repère · lien'))),
      h('nav', { class: 'tiles4', 'aria-label': 'Autres actions' },
        tile4('#/demande/nouvelle', 'ask', 'Demander', { 'aria-label': 'Demander une adresse' }),
        tile4('#/rdv/nouveau', 'cal', 'Rendez-vous', { 'aria-label': 'Créer un rendez-vous' }),
        CFG.shop === false ? null : shopBtn,
        tile4('#/livreur', 'moto', 'Livreur', { id: 'courier-link', 'aria-label': 'Espace livreur' })),
      accountNudge(),
      listBox,
      h('a', { class: 'invite-row', id: 'invite-link', href: '#/parrainer' }, icon('gift', 24), h('span', null, 'Inviter un proche'),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))),
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
          voice: pl.has_voice ? { secs: pl.voice_secs, token: pl.share_token } : null });
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
        if (voiceBox && voiceBox.stop && step === 3) voiceBox.stop();
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
        step > 1 ? h('button', { class: 'back', type: 'button', onclick: function () { step--; draw(); } }, '← Étape précédente')
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
    function sendVoice(id, owner) {
      if (voice.action === 'set') return api('fiila_voice_set', { p_id: id, p_owner: owner, p_voice: voice.b64, p_secs: voice.secs }).then(null, function (e) { toast('Repère vocal non enregistré : ' + errText(e)); });
      if (voice.action === 'clear') return api('fiila_voice_set', { p_id: id, p_owner: owner, p_voice: '', p_secs: 0 }).then(null, function () {});
      return Promise.resolve();
    }
    function publish() {
      if (ctx.editId) {
        return api('fiila_update_place', { p_id: ctx.editId, p_owner: ctx.owner || null, p: payload() }).then(function (pl) { return sendVoice(ctx.editId, ctx.owner || null).then(function () { return pl; }); }).then(function (pl) {
          owned.patch('place', ctx.editId, { label: pl.label });
          if (d.photo !== ctx.originalPhoto) makeThumb(d.photo).then(function (t) { owned.patch('place', ctx.editId, { thumb: t || undefined }); });
          toast('Modifications enregistrées. Le lien reste le même.');
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
        else toast('Adresse enregistrée.');
        if (ctx.reqToken && ctx.requester) {
          return api('fiila_fulfill_request', { p_token: ctx.reqToken, p_place_id: r.id, p_place_owner: r.owner_token }).then(function () {
            setKids(app, sentView(ctx.requester, r.share_token, r.id, ctx.f)); window.scrollTo(0, 0);
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
      ? pl.label + ', ' + whenText(pl.starts_at) + '. Le lieu et le chemin : ' + url
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
        h('p', { class: 'eyebrow' }, isMeeting ? 'Mon rendez-vous' : 'Mon adresse'),
        h('div', { class: 'addr-top' },
          pl.photo ? h('img', { class: 'vthumb', src: pl.photo, alt: '', style: 'width:64px;height:64px' }) : null,
          h('div', null, h('h1', { class: 'wrapword' }, pl.label),
            isMeeting ? h('p', { class: 'muted' }, whenText(pl.starts_at)) : null)),
        justSaved && active ? h('p', { class: 'saved-ok', role: 'status', id: 'saved-ok' }, icon('check', 18), 'Enregistré.') : null,
        h('div', { class: 'row', style: 'align-items:center' },
          h('span', { class: 'chip ' + (active ? 'ok' : 'off'), style: 'flex:0 0 auto' }, icon(active ? 'check' : expired ? 'hourglass' : 'ban', 12),
            expired ? 'Expiré' : pl.status === 'active' ? 'Lien actif' : 'Lien désactivé'),
          h('span', { class: 'small muted' }, isMeeting && !expired ? 'Visible jusqu’au ' + shortDate(pl.expires_at) : 'Modifiée le ' + shortDate(pl.updated_at)))),
      active ? sharePanel({ kind: variant, url: url, msg: msg, title: pl.label, when: isMeeting ? whenText(pl.starts_at) : '', photo: pl.photo || null, qr: qrBox,
        ids: { url: 'share-url', copy: 'copy-link', native: 'share-native' } }) : null,
      pl.has_voice && active ? voiceOwnerBox(pl) : null,
      isMeeting && active ? guestsPanel(pl, owner) : null,
      installSlot(),
      expired ? h('div', { class: 'notice' }, 'Ce rendez-vous a expiré : le lien n’affiche plus le lieu.') : null,
      isMeeting ? iconBtn('a', { class: expired ? 'btn' : 'btn ghost', id: 'similar', href: '#/rdv/nouveau' + qs({ depuis: pl.id }) }, 'cal', 'Créer un rendez-vous similaire') : null,
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
            iconBtn('a', { class: 'btn ghost small', href: waLink('Ma clé de gestion Fii La pour « ' + pl.label + ' » (ne pas partager) : ' + key), target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'M’envoyer la clé sur WhatsApp', 18),
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
    users: 'M5.5 8a3.5 3.5 0 1 0 7.0 0a3.5 3.5 0 1 0 -7.0 0M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3 6',
    user: 'M8 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M4 21a8 8 0 0 1 16 0',
    plus: 'M12 5v14M5 12h14',
    cash: 'M5.5 6h13A2.5 2.5 0 0 1 21 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 15.5v-7A2.5 2.5 0 0 1 5.5 6ZM9.5 12a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0',
    mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
    play: 'M8 5.5v13l11-6.5-11-6.5Z',
    stop: 'M7 7h10v10H7z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    share: 'M15.5 5a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0M3.5 12a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0M15.5 19a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4',
    print: 'M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z',
    home: 'M4 11 12 4l8 7v9H4v-9ZM10 20v-5h4v5',
    settings: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5',
    back: 'M15 6l-6 6 6 6',
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
  function sharePanel(o) {
    var text = o.msg.replace(o.url, '').trim().replace(/\s*:$/, '');
    var visualBox = h('div', { class: 'visual-box', id: 'visual-box', hidden: true });
    var fbHelp = h('p', { class: 'hint', id: 'fb-help', hidden: true },
      'Fii La n’est pas relié à Facebook : le lien est seulement copié. Ouvrez Facebook, créez une publication ou un message, puis collez le lien. Facebook affichera un aperçu générique de Fii La.');
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
        navigator.share({ title: o.title || 'Fii La', text: text, url: o.url }).catch(function (e) {
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
      iconBtn('a', { class: 'btn big', href: waLink(o.msg), target: '_blank', rel: 'noopener noreferrer', id: 'share-whatsapp',
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
    function fileName() { return 'fii-la-' + (o.kind === 'meeting' ? 'rendez-vous' : o.kind === 'request' ? 'demande' : 'adresse') + '.png'; }
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

  // Image verticale 1080 × 1920, déterministe (canvas, polices et couleurs de Fii La).
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
    return Promise.all([fontsReady, photoReady, loadQr()]).then(function (r) {
      var photo = r[1], qrcode = r[2];
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
      font(800, 72);
      var fiiW = g.measureText('Fii').width;
      text('Fii', M, 170, C.ink);
      rr(M + fiiW + 12, 104, g.measureText('La').width + 28, 86, 18, C.lime);
      text('La', M + fiiW + 26, 170, C.ink);
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
      text(o.kind === 'meeting' ? 'RENDEZ-VOUS' : o.kind === 'request' ? 'DEMANDE D’ADRESSE' : 'ADRESSE', M, y, C.muted);
      g.letterSpacing = '0px';
      y += 30;
      // Titre (ou formule neutre)
      var title = opts.showTitle && o.title ? o.title : (o.kind === 'meeting' ? 'Un rendez-vous partagé avec Fii La' : o.kind === 'request' ? 'Une demande d’adresse Fii La' : 'Une adresse partagée avec Fii La');
      font(800, 84);
      var tl = wrap(title, CW, photo ? 2 : 3);
      tl.forEach(function (l) { y += 96; text(l, M, y, C.ink); });
      meta.titleLines = tl;
      if (o.kind === 'meeting' && opts.showWhen && o.when) { y += 18; font(600, 40); wrap(o.when, CW, 2).forEach(function (l) { y += 56; text(l, M, y, C.muted); }); }
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
      emit('starting'); keepAwake(); lastSent = 0; last = null;
      watchId = navigator.geolocation.watchPosition(function (p) {
        var c = p.coords, now = Date.now(), here = { lat: c.latitude, lng: c.longitude };
        if (dest && distM(here, dest) <= 60) { sh.arrive(); return; }
        var moved = last ? distM({ lat: last.latitude, lng: last.longitude }, here) : Infinity;
        if (lastSent && now - lastSent < 20000 && moved < 40) return;
        last = c; lastSent = now;
        send('live', c).then(function () { emit('live', { at: new Date().toISOString() }); }, function (e) { emit('error', e.code); });
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
          o.kind === 'guest' ? h('a', { class: 'btn ghost', id: 'guest-create', href: '#/rdv/nouveau' }, 'Créer votre rendez-vous')
            : h('a', { class: 'btn ghost', id: 'courier-more', href: '#/livreur' }, courierKey() ? 'Mes courses' : 'Recevoir les courses de vos boutiques'));
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
          h('a', { class: 'btn lime', id: 'send-courier', target: '_blank', rel: 'noopener noreferrer',
            href: waLink('Livraison : l’adresse exacte avec la photo de l’entrée. Ouvrez le lien et touchez « Démarrer la livraison » : ' + courierUrl) }, 'Envoyer au livreur (WhatsApp)'),
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
        fiche(r.place, { wide: true, voice: r.place.has_voice ? voicePlayer(token, 'course', r.place.voice_secs) : null }), footer(true));
      pg.classList.add('wide');
      return pg;
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher la livraison', errText(e), retryBtn())); });
  }

  // Lien de suivi envoyé au client.
  function viewWatch(token) {
    return Promise.resolve(page(brandBar('Livraison'), h('h1', null, 'Votre livraison'), deliveryWatch(token), footer(true)));
  }

  // Invité d'un rendez-vous : accepte de partager son trajet avec l'organisateur.
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
    var create = h('a', { class: 'btn ghost small', href: '#/new' }, 'Créer mon Fii La');
    return api('fiila_get_public', { p_token: token }).then(function (r) {
      var cta = h('div', { class: 'row', style: 'justify-content:center' }, h('div', { style: 'flex:0 1 auto' }, create));
      if (r.state === 'ok') {
        document.title = 'Fii La';
        var mine = owned.all().filter(function (x) { return x.type === 'place' && x.share === token; })[0];
        var isMeet = r.place.kind === 'meeting';
        var joined = isMeet && LS.get('fiila.guest.' + token, null);
        // Rendez-vous : « Créer le vôtre » seulement après l'arrivée de l'invité, pas avant qu'il ait agi.
        var showDiscover = !mine && (!joined || joined.arrived);
        var pg = page(brandBar(isMeet ? 'Rendez-vous' : 'Adresse'),
          fiche(r.place, { wide: true, voice: r.place.has_voice ? voicePlayer(token, 'share', r.place.voice_secs) : null }),
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
        expired: ['⌛', 'Ce rendez-vous est terminé', 'Le lieu n’est plus affiché.'],
        not_found: ['?', 'Lien introuvable', 'Cette fiche n’existe pas ou a été supprimée.'],
        invalid: ['?', 'Lien non valide', 'Vérifiez que le lien a été copié en entier.']
      }[r.state] || ['?', 'Lien introuvable', ''];
      if (r.state === 'expired') cta = h('div', { class: 'row', style: 'justify-content:center' }, h('div', { style: 'flex:0 1 auto' },
        h('a', { class: 'btn ghost small', href: '#/rdv/nouveau' }, 'Créer mon rendez-vous')));
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
      h('h2', { id: 'discover-title' }, isMeeting ? 'Votre prochain rendez-vous' : 'Votre adresse aussi, en une photo'),
      h('p', null, isMeeting
        ? 'Le lieu, l’heure et le chemin dans un seul lien.'
        : 'La porte, un repère, où se garer. Un lien à envoyer.'),
      h('a', { class: 'btn ghost discover-cta', id: 'discover-cta', href: (isMeeting ? '#/rdv/nouveau' : '#/new') + qs({ retour: token }),
        onclick: function () { track('discovery_cta', variant); } }, icon(isMeeting ? 'cal' : 'cam', 22), h('span', null, isMeeting ? 'Créer un rendez-vous' : 'Créer mon adresse')),
      h('p', { class: 'hint' }, 'Gratuit. Sans compte.'));
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
      var msg = q.requester_name + ' vous demande votre adresse pour : ' + q.purpose + (q.order_ref ? ' (réf. ' + q.order_ref + ')' : '') + '.\nRépondez ici : ' + url;
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
          fiche(q.place)];
      } else if (q.state === 'pending') {
        stateBlock = [h('span', { class: 'chip wait', style: 'align-self:flex-start' }, icon('clock', 12), 'En attente de réponse'),
          sharePanel({ kind: 'request', url: url, msg: msg, title: q.purpose, ids: { url: 'request-url', copy: 'copy-request', native: 'share-request' } }),
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
      h('section', { class: 'card state', id: 'sent' },
        h('div', { class: 'big', 'aria-hidden': 'true' }, icon('check', 26)),
        h('h2', null, name + ' a votre adresse.'),
        backInvoice ? iconBtn('a', { class: 'btn', id: 'back-invoice', href: '#/f/' + backInvoice }, 'back', 'Revenir à ma commande') : null),
      url ? h('section', { class: 'card', id: 'share-close' },
        h('h2', null, 'Votre adresse est prête'),
        h('p', { class: 'small muted' }, 'Envoyez-la à vos proches : ils vous trouveront sans appeler.'),
        h('a', { class: 'btn lime', id: 'share-relatives', href: waLink('Mon adresse, avec la photo de l’entrée : ' + url), target: '_blank', rel: 'noopener noreferrer',
          onclick: function () { track('share_initiated', 'whatsapp_address'); } }, 'Envoyer sur WhatsApp'),
        h('a', { class: 'btn link', href: '#/m/' + placeId, style: 'align-self:flex-start' }, 'Voir mon adresse')) : null,
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
      var head = h('section', { class: 'card' },
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
              setKids(app, sentView(r.requester_name, pl.share_token || (owned.find('place', sel) || {}).share, sel, backInvoice));
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
      if (!rec) return page(backBtn(), stateCard('?', 'Rendez-vous introuvable sur ce téléphone', ''));
      return api('fiila_get_owned', { p_id: editId, p_owner: rec.owner || null }).then(function (pl) {
        var s = dakarParts(pl.starts_at);
        var hours = Math.round((new Date(pl.expires_at) - new Date(pl.starts_at)) / 3600e3);
        return meetingForm({
          label: pl.label, date: s.date, time: s.time, entry: { lat: pl.entry.lat, lng: pl.entry.lng, src: 'saved' },
          hasStop: pl.vehicle_ok === false, stop: pl.stop ? { lat: pl.stop.lat, lng: pl.stop.lng, src: 'saved' } : null,
          walk: pl.walk || '', instruction: pl.instruction || '', photo: pl.photo || null,
          exp: String([2, 24, 168].indexOf(hours) >= 0 ? hours : 24)
        }, { editId: editId, owner: rec.owner, originalPhoto: pl.photo || null });
      }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger le rendez-vous', errText(e), retryBtn())); });
    }
    if (q && q.depuis) return viewSimilarMeeting(q.depuis);
    var key = MEETING_DRAFT;
    var saved = LS.get(key, null);
    var today = new Date(Date.now() + 3600e3).toISOString();
    return meetingForm(saved || { label: '', date: today.slice(0, 10), time: '19:00', entry: null, hasStop: false, stop: null, walk: '', instruction: '', photo: null, exp: '24' },
      { retour: tokenParam(q && q.retour), draftKey: key, restored: !!saved });
  }
  var MEETING_DRAFT = 'fiila.draft.meeting';
  // « Créer un rendez-vous similaire » : nouveau brouillon, enregistré comme une fiche distincte.
  // Repris : lieu (à reconfirmer), arrêt voiture (à reconfirmer), trajet à pied, indications, photo, durée d'affichage.
  // Jamais repris : nom, date et heure, liens, clé de gestion, statut (désactivé, expiré).
  function viewSimilarMeeting(sourceId) {
    var rec = owned.get('place', sourceId);
    if (!rec) return page(backBtn(), stateCard('?', 'Rendez-vous introuvable sur ce téléphone', 'Ouvrez sa clé de gestion pour le réutiliser ici.'));
    var key = MEETING_DRAFT + '.similaire.' + sourceId;
    var saved = LS.get(key, null);
    return api('fiila_get_owned', { p_id: sourceId, p_owner: rec.owner || null }).then(function (pl) {
      if (pl.kind !== 'meeting') return page(backBtn(), stateCard('?', 'Ce n’est pas un rendez-vous', ''));
      var hours = Math.round((new Date(pl.expires_at) - new Date(pl.starts_at)) / 3600e3);
      var f = saved || {
        label: '', date: '', time: '', entry: null, entryInitial: { lat: pl.entry.lat, lng: pl.entry.lng },
        hasStop: pl.vehicle_ok === false, stop: null, stopInitial: pl.stop ? { lat: pl.stop.lat, lng: pl.stop.lng } : null,
        walk: pl.walk || '', instruction: pl.instruction || '', photo: pl.photo || null,
        exp: String([2, 24, 168].indexOf(hours) >= 0 ? hours : 24)
      };
      return meetingForm(f, { similarOf: sourceId, sourceLabel: pl.label, draftKey: key, restored: !!saved });
    }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger le rendez-vous', errText(e), retryBtn())); });
  }
  function meetingForm(f, ctx) {
    var err = h('div', { role: 'alert' });
    var why = h('p', { class: 'hint', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'button', onclick: submit }, ctx.editId ? 'Enregistrer les modifications' : 'Créer le rendez-vous');
    function times() {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !/^\d{2}:\d{2}$/.test(f.time)) return null;
      var start = new Date(f.date + 'T' + f.time + ':00Z');
      if (isNaN(start)) return null;
      return { start: start, end: new Date(start.getTime() + Number(f.exp) * 3600e3) };
    }
    function problem() {
      if (!f.label.trim()) return 'Donnez un nom au rendez-vous.';
      var t = times();
      if (!t) return 'Indiquez la date et l’heure.';
      if (t.end <= new Date()) return 'Avec cette date, la fiche aurait déjà disparu. Choisissez une date future ou une durée plus longue.';
      if (!f.entry && f.entryInitial) return 'Confirmez le lieu repris en appuyant sur « Valider ce point ».';
      if (!f.entry) return 'Validez le point de rendez-vous sur la carte.';
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
        if (ctx.editId) { owned.patch('place', ctx.editId, { label: p.label }); toast('Rendez-vous mis à jour. Le lien reste le même.'); go('#/m/' + ctx.editId); return; }
        var stored = owned.put({ type: 'place', kind: 'meeting', id: r.id, owner: r.owner_token, share: r.share_token, label: p.label, created: Date.now() });
        attribute('meeting', r.id, r.owner_token, '', ctx.retour ? { src: 'address', token: ctx.retour } : null);
        if (ctx.draftKey) LS.del(ctx.draftKey);
        LS.set('fiila.saved', true);
        track('fiche_created', ctx.similarOf ? 'meeting_similar' : ctx.retour ? 'meeting_discovery' : 'meeting_direct');
        toast('Rendez-vous enregistré.');
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
      : ctx.similarOf ? backBtn('Retour au rendez-vous d’origine', '#/m/' + ctx.similarOf)
      : backBtn(ctx.editId ? 'Retour au rendez-vous' : 'Accueil', ctx.editId ? '#/m/' + ctx.editId : '#/'),
      h('h1', null, ctx.editId ? 'Modifier le rendez-vous' : ctx.similarOf ? 'Rendez-vous similaire' : 'Créer un rendez-vous'),
      ctx.similarOf
        ? h('div', { class: 'notice', id: 'similar-notice' }, 'À partir de « ' + ctx.sourceLabel + ' ». Le lieu, l’arrêt voiture, les indications et la photo sont repris. Choisissez un nom, une nouvelle date et confirmez le lieu sur la carte. Le rendez-vous d’origine ne change pas.')
        : h('p', { class: 'muted' }, 'Une fiche de lieu temporaire pour un rendez-vous ou un événement. Elle cesse d’afficher le lieu à la date choisie.'),
      ctx.restored ? h('div', { class: 'row', style: 'align-items:center' },
        h('p', { class: 'hint', style: 'flex:1 1 200px' }, 'Brouillon repris là où vous l’aviez laissé.'),
        h('button', { class: 'btn link', type: 'button', id: 'clear-draft', style: 'flex:0 0 auto', onclick: function () { LS.del(ctx.draftKey); render(); } }, 'Recommencer')) : null,
      textField({ id: 'm-label', label: 'Nom du rendez-vous', max: 60, value: f.label, placeholder: 'Ex. : Baptême chez Awa', onInput: function (v) { f.label = v; changed(); } }),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'm-date' }, ctx.similarOf ? 'Nouvelle date' : 'Date'), h('input', { type: 'date', id: 'm-date', value: f.date, oninput: function (e) { f.date = e.target.value; changed(); } })),
        h('div', { class: 'field' }, h('label', { for: 'm-time' }, 'Heure'), h('input', { type: 'time', id: 'm-time', value: f.time, oninput: function (e) { f.time = e.target.value; changed(); } }))),
      h('p', { class: 'hint' }, 'Heure de Dakar (GMT), quel que soit le fuseau de votre téléphone.'),
      h('h2', null, 'Point de rendez-vous'),
      mapPicker({ id: 'm-entry', what: 'le lieu du rendez-vous', initial: f.entryInitial, get: function () { return f.entry; }, set: function (p) { f.entry = p; changed(); } }),
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
        restore(m[1]).then(function (node) { setKids(app, node); });
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
     Rali dans Fii La : un compte (facultatif) qui garde les adresses de l'utilisateur sur tous ses
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
  function safeRetour(v) { return v && /^[a-z0-9\/-]{1,40}$/i.test(v) ? '#/' + v.replace(/^\/+/, '') : '#/'; }
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
      if (e.code === 'shop_required') { go('#/boutique'); return loading(); }
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
    if (q.lien === 'invalide') return page(backBtn(), stateCard('!', 'Lien expiré ou déjà utilisé', 'Demandez un nouveau lien depuis la page de connexion.', h('a', { class: 'btn', href: '#/compte' }, 'Se connecter')), footer());
    if (!authed()) return authForm(q);
    return account.me().then(function (me) {
      if (!me) return authForm(q);
      return profileView(me, q);
    }, failPage('Impossible de charger votre compte', 'compte'));
  }

  function authForm(q) {
    var mode = q.mode === 'inscription' ? 'signup' : 'login';
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
          if (mode === 'forgot') {
            setKids(root, backBtn(), stateCard('✓', 'Vérifiez vos e-mails', 'Si un compte existe pour ' + email + ', un lien pour choisir un nouveau mot de passe vient d’être envoyé.'), footer());
            return;
          }
          if (r && r.confirm) {
            setKids(root, backBtn(), stateCard('✓', 'Vérifiez vos e-mails', 'Ouvrez le lien envoyé à ' + email + ' pour activer votre compte.'), footer());
            return;
          }
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
      h('section', { class: 'card' },
        h('h2', null, 'Profil'),
        textField({ id: 'me-name', label: 'Nom affiché', max: 60, value: f.display_name, autocomplete: 'name', onInput: function (v) { f.display_name = v; } }),
        textField({ id: 'me-phone', label: 'Téléphone', optional: true, type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
        iconBtn('button', { class: 'btn', type: 'button', id: 'me-save', onclick: function () { save(null); } }, 'check', 'Enregistrer')),
      h('nav', { class: 'list', 'aria-label': 'Raccourcis' },
        h('a', { class: 'item', href: '#/' }, h('div', null, h('div', { class: 't' }, 'Mes adresses'), h('div', { class: 'small muted' }, 'Maison, bureau, boutique…')), h('span', { class: 'chev' }, icon('chev', 18))),
        h('a', { class: 'item', href: '#/boutique', id: 'go-shop' }, h('div', null, h('div', { class: 't' }, me.shop ? me.shop.name : 'Ma boutique'),
          h('div', { class: 'small muted' }, me.shop ? 'Commandes, clients, factures' : 'Vendre et livrer avec Fii La')), h('span', { class: 'chev' }, icon('chev', 18)))),
      pwBox,
      h('button', { class: 'btn ghost', type: 'button', id: 'logout', onclick: function () { account.signOut().then(function () { toast('Déconnecté.'); go('#/'); }); } }, 'Se déconnecter'),
      h('details', null, h('summary', null, 'Supprimer mon compte'),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          h('p', { class: 'small' }, 'Les fiches restées seulement sur un téléphone, sans compte, ne sont pas concernées.'),
          h('button', { class: 'btn danger', type: 'button', id: 'delete-account', onclick: askDelete }, 'Supprimer mon compte'), delZone)),
      footer());
  }

  /* ----- boutique */
  function viewShop(q) {
    return sapi('fiila_shop_get', {}).then(function (r) {
      return r.shop ? shopDashboard(r, q || {}) : shopForm(null);
    }, failPage('Impossible de charger la boutique', 'boutique'));
  }
  function viewShopSettings() {
    return sapi('fiila_shop_get', {}).then(function (r) { return shopForm(r.shop); }, failPage('Impossible de charger la boutique', 'boutique'));
  }
  function shopForm(shop) {
    var f = { name: shop ? shop.name : '', phone: shop ? shop.phone || '' : '', ninea: shop ? shop.ninea || '' : '' };
    var err = h('div', { role: 'alert' });
    var ask = shop ? null : referralAsk('shop-ref');
    var btn = h('button', { class: 'btn', type: 'button', id: 'shop-save', onclick: function () {
      btn.disabled = true; setKids(err);
      sapi('fiila_shop_save', { p: { name: f.name.trim(), phone: f.phone.trim() || null, ninea: f.ninea.trim() || null } }).then(function (r) {
        if (r && r.key) LS.set(SHOP_LS, { id: r.shop.id, key: r.key, linked: authed() || undefined });
        if (!shop) { track('shop_created', authed() ? 'account' : 'no_account'); bumpTx(); attribute('shop', null, r.key || shopKey(), ask.value()); }
        ME = null; toast(shop ? 'Boutique mise à jour.' : 'Boutique créée.'); go('#/boutique');
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, shop ? 'Enregistrer' : 'Créer ma boutique');
    var pg = page(backBtn(shop ? 'Ma boutique' : 'Accueil', shop ? '#/boutique' : '#/'),
      h('div', { class: 'stack tight' },
        h('h1', null, shop ? 'Réglages de la boutique' : 'Créer ma boutique'),
        shop ? null : h('p', { class: 'muted' }, 'Ces informations apparaissent sur vos factures.')),
      textField({ id: 'shop-name', label: 'Nom de la boutique', max: 60, value: f.name, placeholder: 'Ex. : Boutique Ndèye', onInput: function (v) { f.name = v; } }),
      textField({ id: 'shop-phone', label: 'Téléphone', optional: true, type: 'tel', inputmode: 'tel', value: f.phone, onInput: function (v) { f.phone = v; } }),
      textField({ id: 'shop-ninea', label: 'NINEA', optional: true, max: 30, value: f.ninea, onInput: function (v) { f.ninea = v; } }),
      ask ? ask.el : null,
      err, btn,
      shop ? vitrineSection(shop) : null,
      shop ? courierSection(shop) : null,
      shop ? shopDeleteBox() : null,
      footer());
    return shop ? shopTabs(pg, 'settings') : pg;
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
        h('button', { class: 'btn ghost small', type: 'button', id: 'courier-remove', style: 'align-self:flex-start', onclick: function () { act('remove', 'Livreur retiré.'); } }, 'Retirer ce livreur'),
        err]);
      return box;
    }
    var f = { name: inv ? inv.name || '' : '', phone: inv ? inv.phone || '' : '' };
    var sendBox = h('div', { class: 'stack' });
    add(box, [
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
          var wa = waTo(f.phone, shop.name + ' vous invite à livrer ses commandes avec Fii La. Acceptez ici : ' + link);
          track('courier_invited', 'whatsapp');
          // un seul bouton à la fois : l'invitation prête remplace « Inviter »
          b.hidden = true;
          setKids(sendBox, iconBtn('a', { class: 'btn lime', id: 'courier-invite-send', href: wa, target: '_blank', rel: 'noopener noreferrer' }, 'chat', 'Envoyer sur WhatsApp'),
            iconBtn('button', { class: 'btn ghost small', type: 'button', style: 'align-self:flex-start', onclick: function () { copy(link, 'Lien'); } }, 'link', 'Copier le lien'));
        }, function (e) { b.disabled = false; errBox(err, e); });
      } }, 'Inviter sur WhatsApp'),
      sendBox,
      inv ? h('button', { class: 'btn link', type: 'button', style: 'align-self:flex-start', onclick: function () { act('cancel_invite', 'Invitation annulée.'); } }, 'Annuler l’invitation') : null]);
    return box;
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
    function load() {
      sapi('fiila_orders', { p_filter: vue === 'all' ? null : vue }).then(function (rows) {
        setKids(listBox, rows.length ? rows.map(orderItem) : h('div', { class: 'card' },
          h('p', { class: 'muted' }, vue === 'open' ? 'Aucune commande en cours.' : vue === 'unpaid' ? 'Rien à encaisser.' : 'Aucune commande.')));
      }, function (e) { errBox(listBox, e); });
    }
    if (st.orders) load();
    function tile(n, label, href, name, kind) {
      return h('a', { class: 'tile kpi', href: href }, statePill(kind, name), h('span', null, h('strong', null, String(n || 0)), h('span', null, label)));
    }
    return shopTabs(page(backBtn(),
      h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, 'Ma boutique'),
        h('h1', { class: 'wrapword', id: 'shop-title' }, shop.name)),
      // Boutique neuve : une seule première étape, pas de tableau de bord vide.
      !st.orders && !st.products ? h('section', { class: 'card', id: 'first-product' },
        h('h2', null, 'Ajoutez votre premier article'),
        h('p', { class: 'small muted' }, 'Une photo, un prix. Il sera prêt pour vos commandes.'),
        iconBtn('a', { class: 'btn', href: '#/boutique/article/nouveau' }, 'cam', 'Ajouter un article')) : null,
      iconBtn('a', { class: !st.orders && !st.products ? 'btn ghost full' : 'btn big full', id: 'new-order', href: '#/commande/nouvelle' }, 'plus', 'Nouvelle commande'),
      // Compte proposé quand la boutique tourne (3 commandes), pas dès sa création.
      shop.account || authed() || (st.orders || 0) < 3 ? null : shopAccountCard(),
      st.orders ? h('div', { class: 'tiles' },
        tile(st.open, 'en cours', '#/boutique?vue=open', 'clock', 'wait'),
        tile(st.unpaid, 'à encaisser', '#/boutique?vue=unpaid', 'cash', 'go')) : null,
      st.orders ? segField({ name: 'vue', id: 'orders-filter', value: vue,
        options: [['open', 'En cours'], ['unpaid', 'À encaisser'], ['done', 'Terminées'], ['all', 'Toutes']],
        onChange: function (v) { vue = v; try { history.replaceState(null, '', location.pathname + location.search + '#/boutique?vue=' + v); } catch (e) { /* rien */ } setKids(listBox, loading()); load(); } }) : null,
      st.orders ? listBox : null,
      st.products ? (shop.public && shop.slug
        ? h('a', { class: 'invite-row', id: 'vitrine-link', href: '#/b/' + shop.slug }, icon('shop', 24), h('span', null, 'Ma vitrine en ligne'), h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18)))
        : h('a', { class: 'invite-row', id: 'vitrine-open-link', href: '#/boutique/reglages' }, icon('shop', 24), h('span', null, 'Ouvrir ma vitrine en ligne'), h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18)))) : null,
      h('a', { class: 'invite-row', id: 'shop-referral', href: '#/parrainer?pour=boutique' }, icon('gift', 24), h('span', null, 'Parrainer une boutique'),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chev', 18))),
      footer()), 'orders');
  }

  /* ----- clients */
  function viewCustomers(q) {
    var term = (q && q.q) || '';
    var listBox = h('div', { class: 'list', id: 'customers' }, loading());
    var timer;
    function load() {
      sapi('fiila_customers', { p_query: term.trim() || null }).then(function (rows) {
        setKids(listBox, rows.length ? rows.map(function (c) {
          return h('a', { class: 'item', href: '#/clients/' + c.id },
            h('div', null, h('div', { class: 't' }, c.name), h('div', { class: 'small muted' }, [c.phone, c.orders ? c.orders + ' commande' + (c.orders > 1 ? 's' : '') : null].filter(Boolean).join(' · '))),
            h('span', { class: 'item-end' }, c.has_address ? h('span', { class: 'chip ok' }, icon('check', 12), 'Adresse') : null, h('span', { class: 'chev' }, icon('chev', 18))));
        }) : h('div', { class: 'card' }, h('p', { class: 'muted' }, term ? 'Aucun client trouvé.' : 'Vos clients apparaissent ici dès leur première commande.')));
      }, function (e) {
        if (e.code === 'shop_required') { go('#/boutique'); return; }
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
            h('button', { class: 'btn danger', type: 'button', id: 'customer-delete', onclick: function () {
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
      if (e.code === 'shop_required') { go('#/boutique'); return loading(); }
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
    function refresh(next) { if (next) o = next; setKids(app, orderView(o, shop, {})); }
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
        h('details', { id: 'order-address' }, h('summary', null, 'Voir l’adresse'), h('div', { style: 'margin-top:12px' }, o.place ? fiche(o.place) : null))];
    } else if (o.address_state === 'pending') {
      addr = [h('span', { class: 'chip wait', style: 'align-self:flex-start' }, icon('clock', 12), 'En attente de l’adresse')];
    } else {
      addr = [h('div', { class: 'notice' }, o.address_state === 'expired' ? 'La demande d’adresse a expiré.' : o.address_state === 'revoked' ? 'Le client a retiré son adresse.' : 'Aucune adresse pour cette commande.'),
        closed ? null : h('button', { class: 'btn', type: 'button', id: 'ask-address', onclick: function (ev) { ev.currentTarget.disabled = true; call('fiila_order_request_address', null, 'Nouvelle demande prête. Renvoyez le lien au client.').catch(function () {}); } }, 'Redemander l’adresse')];
    }

    // 2. Envoyer au client
    var send = closed && o.status === 'cancelled' ? null : h('section', { class: 'card', id: 'send-client' },
      h('h2', null, 'Envoyer au client'),
      h('a', { class: 'btn lime', id: 'send-invoice', href: waTo(o.customer_phone, msgClient), target: '_blank', rel: 'noopener noreferrer',
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
        cour && !o.courier ? h('a', { class: 'btn lime', id: 'send-courier', target: '_blank', rel: 'noopener noreferrer',
          href: waLink('Livraison N° ' + o.ref + ' pour ' + o.customer_name + ' : adresse exacte et photo de l’entrée. Ouvrez le lien et touchez « Démarrer la livraison » : ' + courierUrl) }, 'Envoyer le lien au livreur (WhatsApp)') : null,
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
  function productForm(pr, shop, fresh) {
    var f = { name: pr ? pr.name : '', price: pr ? String(pr.price) : '', description: pr ? pr.description || '' : '', active: pr ? pr.active : true, photo: pr ? pr.photo || null : null };
    var original = f.photo;
    var err = h('div', { role: 'alert' });
    var zone = h('div', { class: 'stack' });
    var photoBox = photoField({ id: 'product-photo', optional: true, label: 'Photo de l’article', get: function () { return f.photo; }, set: function (v) { f.photo = v; }, maxSide: 720 });
    var btn = h('button', { class: 'btn', type: 'button', id: 'product-save', onclick: function () {
      setKids(err);
      var price = parseInt(String(f.price).replace(/\D/g, ''), 10);
      if (!f.name.trim()) return errBox(err, new ApiError('item_label_required'));
      if (!(price >= 0)) return errBox(err, new ApiError('invalid_price'));
      var p = { id: pr ? pr.id : undefined, name: f.name.trim(), price: price, description: f.description.trim() || null, active: f.active };
      if (f.photo !== original) p.photo = f.photo ? f.photo.replace(/^data:[^,]+,/, '') : '';
      btn.disabled = true;
      sapi('fiila_product_save', { p: p }).then(function (res) {
        if (!pr) track('product_created', f.photo ? 'photo' : 'no_photo');
        var nid = res && (res.id || (res.product && res.product.id));
        if (!pr && nid && p.active !== false) { go('#/boutique/article/' + nid + '?publier=1'); return; }
        toast(pr ? 'Article mis à jour.' : 'Article ajouté.'); go('#/boutique/articles');
      }, function (e) { btn.disabled = false; errBox(err, e); });
    } }, pr ? 'Enregistrer' : 'Ajouter l’article');
    return page(backBtn('Mes articles', '#/boutique/articles'),
      pr && pr.active ? publishBox(pr, shop, fresh) : null,
      h('h1', null, pr ? 'Modifier l’article' : 'Nouvel article'),
      photoBox,
      textField({ id: 'product-name', label: 'Nom', max: 80, value: f.name, placeholder: 'Ex. : Robe wax taille M', onInput: function (v) { f.name = v; } }),
      textField({ id: 'product-price', label: 'Prix (FCFA)', inputmode: 'numeric', value: f.price, placeholder: 'Ex. : 12500', onInput: function (v) { f.price = v; } }),
      textField({ id: 'product-desc', label: 'Description', optional: true, multiline: true, max: 300, value: f.description, onInput: function (v) { f.description = v; } }),
      pr ? segField({ name: 'product-active', id: 'product-active', value: f.active ? 'on' : 'off', options: [['on', 'Visible'], ['off', 'Masqué']], onChange: function (v) { f.active = v === 'on'; } }) : null,
      err, btn,
      pr ? h('button', { class: 'btn danger', type: 'button', id: 'product-delete', onclick: function () {
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
        document.title = (n.courses.length ? '(' + n.courses.length + ') ' : '') + 'Fii La · Livreur';
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
      return page(
        h('div', { class: 'stack tight' }, h('p', { class: 'eyebrow' }, 'Invitation'),
          h('h1', { class: 'wrapword' }, r.shop + ' vous propose d’être son livreur attitré'),
          h('p', { class: 'muted' }, 'Ses courses arrivent ici, avec la photo de l’entrée.')),
        courierKey() ? iconBtn('button', { class: 'btn big', type: 'button', id: 'courier-accept', onclick: function (ev) { ev.currentTarget.disabled = true; accept(); } }, 'check', 'Accepter') :
          courierForm({ name: r.name, phone: r.phone }, function () { accept(); }),
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
              s.phone ? h('p', { class: 'small muted' }, s.phone) : null, s.ninea ? h('p', { class: 'small muted' }, 'NINEA ' + s.ninea) : null),
            h('div', { class: 'inv-meta' }, h('strong', null, 'N° ' + o.ref), h('span', { class: 'small muted' }, shortDate(o.created_at)))),
          h('p', null, 'Client : ', h('strong', { class: 'wrapword' }, o.customer_name)),
          invoiceTable(o.items, o.total),
          o.paid ? h('div', { class: 'total-row' }, h('span', null, 'Déjà payé'), h('span', null, fcfa(o.paid))) : null,
          h('div', { class: 'total-row big' }, h('span', null, remaining ? 'Reste à payer' : 'Statut'), h('strong', { id: 'inv-remaining' }, remaining ? fcfa(remaining) : 'Payée')),
          o.note ? h('p', { class: 'small muted wrapword' }, o.note) : null),
        iconBtn('button', { class: 'btn ghost no-print', type: 'button', id: 'print', onclick: function () { window.print(); } }, 'print', 'Télécharger ou imprimer'),
        delivered && !shopKey() ? h('a', { class: 'btn link no-print', id: 'sell-too', href: '#/boutique', style: 'align-self:center' }, 'Vous vendez aussi sur WhatsApp ? Créez votre boutique') : null,
        footer(true));
      return pg;
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher la commande', errText(e), retryBtn())); });
  }

  /* ================================================================ CONFIDENTIALITÉ */
  function viewPrivacy() {
    return page(backBtn(),
      h('div', { class: 'prose' },
        h('h1', null, 'Données et confidentialité'),
        h('p', null, 'Fii La est en phase pilote. Cette page décrit ce que le service enregistre et comment le supprimer.'),
        h('h2', null, 'Ce qui est enregistré'),
        h('ul', null,
          h('li', null, 'Ce que vous saisissez : nom du lieu, quartier, repère, point d’entrée, point d’arrêt voiture, photo, et pour un rendez-vous sa date.'),
          h('li', null, 'Pour une demande d’adresse : le nom du demandeur, la raison et la référence éventuelle.'),
          h('li', null, 'Pour limiter les abus : une empreinte non réversible de l’adresse IP lors des créations, effacée après 24 heures.'),
          h('li', null, 'Si vous collez un lien court Google Maps, il est envoyé à notre serveur uniquement pour en lire le point, puis oublié : il n’est pas enregistré.'),
          h('li', null, 'Si vous créez un compte (facultatif) : votre e-mail, votre mot de passe (géré par Supabase Auth, jamais visible en clair), et si vous les ajoutez votre nom, votre téléphone et votre photo de profil.'),
          h('li', null, 'Si vous ouvrez une boutique : son nom, son téléphone et son NINEA s’ils sont indiqués ; vos clients (nom, téléphone), vos commandes, factures et les paiements que vous enregistrez. Pour ces données clients, le commerçant décide de ce qu’il saisit et en répond auprès de ses clients ; Fii La les héberge pour lui.'),
          h('li', null, 'Si vous êtes livreur : votre nom, et si vous les indiquez votre téléphone, votre moyen de livraison et votre zone. Vos boutiques voient votre nom, votre téléphone et votre note ; les clients voient votre prénom.'),
          h('li', null, 'Si vous notez un article reçu : la note (1 à 5), rattachée à la commande, sans votre nom. Le commerçant voit la moyenne de ses articles.'),
          h('li', null, 'Origine et parrainage : quand vous créez une adresse, un rendez-vous, une boutique ou un espace livreur, Fii La note d’où vous venez (lien reçu, lien ou code de parrainage, ou numéro de la personne qui vous a recommandé, si vous le tapez). La personne qui vous a parrainé voit qu’une arrivée a eu lieu : le nom d’une boutique, le prénom d’un livreur, jamais le nom ni l’adresse d’un particulier.'),
          h('li', null, 'Si vous créez un code de parrainage : votre nom et, si vous l’indiquez, votre numéro. Le numéro n’est jamais affiché ; il sert seulement à vous reconnaître quand quelqu’un le tape. Les personnes qui ouvrent votre lien voient votre prénom.'),
          h('li', null, 'Repère vocal (facultatif) : l’enregistrement de 30 secondes au plus que vous ajoutez à votre adresse. Le micro n’est utilisé que lorsque vous appuyez sur « Enregistrer ». Toute personne qui a le lien, et le livreur d’une course, peuvent l’écouter. Il est supprimé avec la fiche, ou dès que vous le retirez.'),
          h('li', null, 'Vitrine d’une boutique (si elle l’ouvre) : ses articles visibles par toute personne qui a le lien. Une commande passée sur la vitrine transmet votre nom, votre numéro et votre commande à cette boutique seulement ; votre adresse n’est donnée qu’ensuite, par vous.'),
          h('li', null, 'Publication d’un article : Fii La compte seulement qu’une publication a été faite, pas le réseau choisi.'),
          h('li', null, 'Suivi en direct (livreur ou invité d’un rendez-vous), seulement si vous le démarrez : votre dernière position et une courte trace, visibles par l’expéditeur et le client (livraison) ou par le seul organisateur (rendez-vous). Effacées dès l’arrivée ou l’arrêt, et au plus tard un jour après la fin de la livraison ou du rendez-vous. Pour un rendez-vous, votre prénom.')),
        h('h2', null, 'Ce qui est obligatoire'),
        h('p', null, 'Pour une adresse : un nom de lieu, le point d’entrée, et une photo ou un repère écrit. Pour un rendez-vous : un nom, le lieu et la date. Tout le reste est facultatif. Sans les éléments obligatoires, la fiche ne peut pas être créée.'),
        h('h2', null, 'Où sont stockées les données'),
        h('p', null, 'Les fiches sont enregistrées dans une base de données hébergée par Supabase sur des serveurs situés à Paris (France), donc hors du Sénégal. Supabase agit comme prestataire technique et ne les utilise pas pour son propre compte. Le site lui-même est servi par GitHub Pages, qui ne reçoit aucune donnée de fiche.'),
        h('h2', null, 'Combien de temps'),
        h('ul', null,
          h('li', null, 'Adresse : jusqu’à ce que vous la supprimiez.'),
          h('li', null, 'Rendez-vous : le lieu cesse d’être affiché à la date choisie, puis la fiche est effacée 30 jours plus tard.'),
          h('li', null, 'Demande d’adresse : valable 7 jours, effacée 30 jours après son expiration.'),
          h('li', null, 'Empreinte de l’adresse IP : 24 heures.'),
          h('li', null, 'Commandes, factures et clients d’une boutique : 24 mois au plus, ou moins si le commerçant les supprime. Compte et boutique : jusqu’à leur suppression.'),
          h('li', null, 'Origine d’une arrivée : autant que la fiche, la boutique ou l’espace livreur concerné. Code de parrainage : jusqu’à ce que vous le supprimiez (page « Inviter un proche »).'),
          h('li', null, 'Adresse donnée à un commerçant pour une commande : il peut la réutiliser pour vos commandes suivantes tant que son lien reste actif. La désactiver ou la supprimer la lui retire.')),
        h('h2', null, 'Vos droits'),
        h('p', null, 'Depuis le téléphone qui a créé la fiche (ou avec sa clé de gestion), vous pouvez à tout moment la consulter, la modifier, désactiver son lien ou la supprimer définitivement.'),
        h('h2', null, 'Ce qui n’est pas collecté'),
        h('ul', null,
          h('li', null, 'Pas de compte obligatoire, pas d’accès à vos contacts, pas de pièce d’identité. Aucun paiement en ligne n’est traité par Fii La pour le moment.'),
          h('li', null, 'Pas de suivi de position : votre position n’est lue qu’au moment où vous appuyez sur « Utiliser ma position ».'),
          h('li', null, 'Les données de localisation contenues dans les photos sont retirées avant l’envoi, et le serveur refuse les photos qui en contiennent encore.'),
          h('li', null, 'Pas de publicité ni d’outil de suivi. Fii La compte seulement, par jour et sans aucun identifiant, quelques actions (par exemple « une fiche a été créée » ou « un lien a été copié »), pour savoir si le service est utile. Si votre navigateur envoie le signal « ne pas suivre », rien n’est compté.')),
        h('h2', null, 'Qui peut voir une fiche'),
        h('p', null, 'Toute personne qui a le lien peut voir la fiche et le transférer. Les fiches ne sont jamais listées publiquement. Une réponse à une demande n’est visible que par le demandeur.'),
        h('h2', null, 'Désactiver et supprimer'),
        h('p', null, 'Depuis « Mes adresses », vous pouvez désactiver un lien (il n’affiche plus rien) ou supprimer la fiche et sa photo. Les rendez-vous cessent d’afficher le lieu à la date choisie, puis sont effacés 30 jours plus tard. Les copies d’écran ou messages déjà envoyés ne peuvent pas être rappelés. Les sauvegardes techniques de la base peuvent conserver une copie pendant quelques jours avant d’être écrasées.'),
        h('h2', null, 'Clé de gestion'),
        h('p', null, 'Vos fiches sont gérées depuis le téléphone qui les a créées. Si vous le perdez ou effacez ses données, seule la clé de gestion permet de les modifier ou de les supprimer. Sans elle, Fii La ne peut pas vérifier que la fiche vous appartient.'),
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
