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
  function footer() {
    return h('footer', { class: 'foot' },
      h('a', { href: '#/' }, 'Fii La'),
      h('a', { href: '#/confidentialite' }, 'Données et confidentialité'),
      h('a', { href: '#/cle' }, 'Restaurer une clé de gestion'));
  }
  function stateCard(icon, title, text, extra) {
    return h('div', { class: 'card state' },
      h('div', { class: 'big', 'aria-hidden': 'true' }, icon),
      h('h2', null, title), text ? h('p', { class: 'muted' }, text) : null, extra || null);
  }
  function loading(text) { return h('p', { class: 'loading', role: 'status' }, text || 'Chargement…'); }

  /* ================================================================ format & liens */
  function fmt(p) { return Number(p.lat).toFixed(6) + ', ' + Number(p.lng).toFixed(6); }
  function gmSearch(p) { return 'https://www.google.com/maps/search/?api=1&query=' + Number(p.lat).toFixed(6) + '%2C' + Number(p.lng).toFixed(6); }
  function gmDir(p, mode) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + Number(p.lat).toFixed(6) + '%2C' + Number(p.lng).toFixed(6) + '&travelmode=' + (mode || 'driving');
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
    remove: function (type, id) { LS.set('fiila.owned', owned.all().filter(function (r) { return !(r.type === type && r.id === id); })); }
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
    invalid_payload: 'Données non valides.'
  };
  function ApiError(code) { this.code = code; this.message = ERRORS[code] || ERRORS.server; }
  ApiError.prototype = Object.create(Error.prototype);
  function errText(e) { return (e && e.message) || ERRORS.server; }

  function apiHeaders() {
    var headers = { 'Content-Type': 'application/json', apikey: API_KEY, Accept: 'application/json' };
    if (/^eyJ/.test(API_KEY)) headers.Authorization = 'Bearer ' + API_KEY;
    return headers;
  }
  function api(fn, args) {
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
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
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
    discovery_shown: ['address', 'meeting'],
    discovery_cta: ['address', 'meeting'],
    fiche_created: ['address_direct', 'address_discovery', 'address_request', 'meeting_direct', 'meeting_discovery', 'meeting_similar'],
    request_created: ['request'],
    share_initiated: ['native_address', 'native_meeting', 'native_request', 'whatsapp_address', 'whatsapp_meeting', 'whatsapp_request'],
    link_copied: ['address', 'meeting', 'request'],
    owned_reopened: ['address', 'meeting', 'request']
  };
  function privacyOptOut() {
    try { return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1'; }
    catch (e) { return false; }
  }
  function track(event, variant) {
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
      if (a <= 15) return ['good', 'Position précise : à environ ' + a + ' m près.'];
      if (a <= 50) return ['mid', 'Position approximative : à environ ' + a + ' m près. Vérifiez le repère sur la carte.'];
      return ['bad', 'Position peu précise : à environ ' + a + ' m près. Déplacez la carte pour corriger.'];
    }
    if (p.src === 'paste') return ['neutral', 'Coordonnées collées. Vérifiez-les sur la carte.'];
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
    var confirmBtn = h('button', { class: 'btn', type: 'button', onclick: confirm }, 'Valider ce point');
    var mapEl = h('div', { class: 'map', id: (opts.id || 'map') + '-canvas' });
    var mapBox = h('div', { class: 'map-box', 'aria-label': 'Carte : déplacez-la pour placer le repère au centre sur ' + opts.what },
      mapEl, h('div', { class: 'map-pin' }), h('div', { class: 'map-dot' }));
    var pasteIn = h('input', { type: 'text', id: (opts.id || 'map') + '-paste', placeholder: '14.758140, -17.470320 ou lien Google Maps', autocomplete: 'off' });
    var paste = h('div', { class: 'stack', hidden: true },
      h('label', { for: (opts.id || 'map') + '-paste' }, 'Coordonnées ou lien Google Maps'),
      pasteIn,
      h('button', { class: 'btn small', type: 'button', onclick: usePaste }, 'Aller à ces coordonnées'),
      h('p', { class: 'hint' }, 'Dans Google Maps : appui long sur le lieu, puis copiez les chiffres affichés.'));

    function say(t, cls) { msg.textContent = t || ''; msg.className = 'msg ' + (cls || 'info'); }
    function draw() {
      var c = opts.get();
      ptBox.className = 'pt' + (c ? ' set' : '');
      var ai = accInfo(c || (center ? { src: src, acc: acc } : null));
      setKids(ptBox, 
        c ? h('p', { class: 'acc good' }, '✓ Point validé pour ' + opts.what) : h('p', { class: 'acc neutral' }, center ? 'Point pas encore validé' : 'Aucun point choisi'),
        center ? h('p', { class: 'coords' }, fmt(center)) : null,
        ai && center ? h('p', { class: 'acc ' + ai[0] }, ai[1]) : null);
      confirmBtn.disabled = !center || !zoomOk || !!c;
      confirmBtn.textContent = c ? 'Point validé' : 'Valider ce point';
    }
    function moved(newSrc) {
      if (opts.get()) { opts.set(null); say('Le repère a bougé : validez à nouveau.', 'info'); }
      if (newSrc) { src = newSrc; if (newSrc !== 'gps') acc = null; }
      draw();
    }
    function goTo(lat, lng, zoom, newSrc) {
      center = { lat: lat, lng: lng };
      if (map) { programmatic = true; map.setView([lat, lng], zoom || 18, { animate: false }); programmatic = false; zoomOk = map.getZoom() >= 16; }
      else zoomOk = true;
      moved(newSrc);
    }
    function confirm() {
      if (!center || !zoomOk) return;
      opts.set({ lat: +center.lat.toFixed(7), lng: +center.lng.toFixed(7), acc: src === 'gps' ? acc : null, src: src || 'manual' });
      say('Point validé.', 'ok');
      draw();
    }
    function usePaste() {
      var c = parseCoords(pasteIn.value);
      if (!c) { say('Coordonnées non reconnues. Exemple : 14.758140, -17.470320', 'err'); return; }
      goTo(c.lat, c.lng, 18, 'paste');
      paste.hidden = true;
      say('Vérifiez que le repère est bien sur ' + opts.what + ', puis validez.', 'info');
    }
    function locate() {
      if (!('geolocation' in navigator)) { say('La position n’est pas disponible sur cet appareil. Placez le repère sur la carte ou collez des coordonnées.', 'err'); return; }
      say('Recherche de votre position…', 'info');
      locBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(function (pos) {
        locBtn.disabled = false;
        acc = pos.coords.accuracy;
        goTo(pos.coords.latitude, pos.coords.longitude, 18, 'gps');
        if (map && window.L) {
          if (accCircle) accCircle.remove();
          accCircle = window.L.circle([pos.coords.latitude, pos.coords.longitude], { radius: Math.min(acc, 2000), color: '#1E4A34', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
        }
        var ai = accInfo({ src: 'gps', acc: acc });
        say(ai[1] + ' Ajustez la carte si le repère n’est pas exactement sur ' + opts.what + '.', ai[0] === 'bad' ? 'err' : 'info');
      }, function (err) {
        locBtn.disabled = false;
        if (err.code === 1) say('Accès à la position refusé. Déplacez la carte pour placer le repère, ou collez des coordonnées.', 'err');
        else if (err.code === 3) say('La recherche de position a pris trop de temps. Réessayez, ou placez le repère à la main.', 'err');
        else say('Position indisponible pour le moment. Placez le repère à la main sur la carte.', 'err');
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    }
    var locBtn = h('button', { class: 'btn ghost', type: 'button', onclick: locate }, 'Utiliser ma position');

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
      if (!center) say('Utilisez votre position, ou déplacez et zoomez la carte jusqu’à ' + opts.what + '.', 'info');
      else if (!opts.get() && opts.initial) say('Point repris du rendez-vous précédent. Vérifiez qu’il est toujours juste, puis validez.', 'info');
      draw();
    }, function () {
      mapBox.replaceWith(h('p', { class: 'alert' }, 'La carte n’a pas pu se charger. Utilisez votre position ou collez des coordonnées.'));
      paste.hidden = false;
      zoomOk = true;
      draw();
    });

    draw();
    return h('div', { class: 'stack' },
      mapBox,
      h('div', { class: 'row' }, locBtn,
        h('button', { class: 'btn ghost', type: 'button', onclick: function () { paste.hidden = !paste.hidden; if (!paste.hidden) pasteIn.focus(); } }, 'Coller des coordonnées')),
      paste, ptBox, confirmBtn, msg);
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
  function compressPhoto(file) {
    if (!file || !/^image\//.test(file.type || '')) return Promise.reject(new Error('Ce fichier n’est pas une image.'));
    if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('Image trop lourde (25 Mo maximum).'));
    return blobToImage(file).then(function (img) {
      var w = img.width || img.naturalWidth, hh = img.height || img.naturalHeight;
      if (!w || !hh) throw new Error('Impossible de lire cette image.');
      var max = 1280, s = Math.min(1, max / Math.max(w, hh));
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
        compressPhoto(f).then(function (d) { opts.set(d); msg.textContent = ''; draw(); },
          function (e) { msg.textContent = e.message; msg.className = 'msg err'; });
        inp.value = '';
      }
    });
    function draw() {
      var p = opts.get();
      setKids(box, 
        h('span', { class: 'label' }, 'Photo de l’entrée ', h('span', { class: 'hint' }, opts.optional ? '(facultatif)' : '(conseillé)')),
        p ? h('img', { class: 'photo-prev', src: p, alt: 'Aperçu de la photo de l’entrée' }) : null,
        h('div', { class: 'row' },
          h('button', { class: p ? 'btn ghost' : 'btn', type: 'button', onclick: function () { inp.click(); } }, p ? 'Remplacer la photo' : 'Prendre ou choisir une photo'),
          p ? h('button', { class: 'btn ghost', type: 'button', onclick: function () { opts.set(null); draw(); } }, 'Retirer') : null),
        h('p', { class: 'hint' }, 'Photographiez la porte, pas toute la maison, et évitez les visages et plaques. La photo est réduite et ses données de localisation sont retirées avant l’envoi.'),
        inp, msg);
    }
    draw();
    return box;
  }

  function textField(o) {
    var counter = o.max ? h('span', { class: 'counter', 'aria-hidden': 'true' }, (o.value || '').length + ' / ' + o.max) : null;
    var input = h(o.multiline ? 'textarea' : 'input', {
      id: o.id, type: o.multiline ? null : 'text', maxlength: o.max ? String(o.max) : null, placeholder: o.placeholder || null,
      value: o.value || '', autocomplete: 'off', 'aria-describedby': o.hint ? o.id + '-hint' : null,
      oninput: function (e) { if (counter) counter.textContent = e.target.value.length + ' / ' + o.max; o.onInput(e.target.value); }
    });
    return h('div', { class: 'field' },
      h('label', { for: o.id }, o.label, o.optional ? h('span', { class: 'hint' }, ' (facultatif)') : null),
      input,
      o.hint ? h('p', { class: 'hint', id: o.id + '-hint' }, o.hint) : null,
      counter);
  }

  /* ================================================================ fiche (vue destinataire) */
  // Repli secondaire : on partage une fiche nommée, pas des chiffres. Les coordonnées restent accessibles
  // (lien qui ne s'ouvre pas, autre application) mais repliées.
  function coordLine(p) {
    return h('details', { class: 'coords-more' },
      h('summary', null, 'Coordonnées GPS (si le lien ne s’ouvre pas)'),
      h('div', { class: 'coordline' },
        h('span', { class: 'coords' }, fmt(p)),
        h('button', { class: 'btn ghost small', type: 'button', onclick: function () { copy(fmt(p), 'Coordonnées'); } }, 'Copier')));
  }
  function leg(n, title, p, mode, note) {
    return h('section', { class: 'leg', 'aria-label': title },
      h('div', { class: 'leg-h' }, n ? h('span', { class: 'leg-n', 'aria-hidden': 'true' }, n) : null, h('h3', null, title)),
      note ? h('p', { class: 'note' }, note) : null,
      h('a', { class: 'btn', href: gmDir(p, mode), target: '_blank', rel: 'noopener noreferrer' }, mode === 'walking' ? 'Itinéraire à pied (Google Maps)' : 'Itinéraire (Google Maps)'),
      coordLine(p));
  }
  function fiche(p, opts) {
    opts = opts || {};
    var hasStop = p.vehicle_ok === false && p.stop;
    var isMeeting = p.kind === 'meeting';
    return h('article', { class: 'fiche' },
      p.photo ? h('img', { class: 'door', src: p.photo, alt: 'Photo de l’entrée' + (p.label ? ' : ' + p.label : ''), decoding: 'async' }) : null,
      h('div', { class: 'fiche-body' },
        h('div', { class: 'stack tight' },
          isMeeting ? h('p', { class: 'eyebrow' }, 'Rendez-vous') : (p.locality ? h('p', { class: 'eyebrow wrapword' }, p.locality) : null),
          h('h1', { class: 'wrapword', style: 'font-size:26px' }, p.label || 'Sans nom'),
          isMeeting && p.starts_at ? h('p', { class: 'muted' }, whenText(p.starts_at)) : null),
        p.instruction ? h('p', { class: 'instr' }, p.instruction) : null,
        hasStop
          ? [leg('1', 'Arrêt voiture', p.stop, 'driving', p.walk ? 'Ensuite, à pied : ' + p.walk : 'La voiture ne peut pas aller jusqu’à l’entrée.'),
             leg('2', isMeeting ? 'Lieu du rendez-vous' : 'Entrée', p.entry, 'walking')]
          : leg(null, isMeeting ? 'Lieu du rendez-vous' : 'Entrée', p.entry, 'driving'),
        h('p', { class: 'hint' }, 'L’itinéraire est calculé par Google Maps. Fii La indique le point exact ; le trajet proposé peut varier.'),
        opts.footer || null));
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
    var r = parseHash(), p = r.parts, view;
    try {
      if (!p.length) view = viewHome();
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
      else if (p[0] === 'cle') view = viewRestore(null);
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
    if (recs.length) {
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
          return h('div', { class: 'item', style: 'cursor:default' },
            h('div', null, h('div', { class: 't' }, 'Fiche introuvable'), h('div', { class: 'small muted' }, 'Supprimée, ou clé non valide.')),
            h('button', { class: 'btn ghost small', type: 'button', onclick: function () { owned.remove(x.type, x.id); render(); } }, 'Retirer'));
        }
        var kind = x.type === 'request' ? 'request' : (x.kind || 'address');
        return h('a', { class: 'item', href: href, style: 'text-decoration:none', onclick: function () { track('owned_reopened', kind); } },
          h('div', null, h('div', { class: 't' }, title), sub ? h('div', { class: 'small muted wrapword' }, sub) : null), chip);
      }
      function chip(cls, text) { return h('span', { class: 'chip ' + cls }, text); }
      setKids(listBox, 
        offlineMsg ? h('p', { class: 'alert' }, offlineMsg) : null,
        h('section', { class: 'stack', id: 'mes-adresses', 'aria-labelledby': 'h-adr' },
          h('h2', { id: 'h-adr' }, 'Mes adresses'),
          addrs.length ? h('div', { class: 'list' }, addrs.map(function (x) {
            return item(x, '#/m/' + x.id, x.label || 'Adresse', x.locality,
              x.cached ? null : x.status === 'active' ? chip('ok', 'Lien actif') : chip('off', 'Lien désactivé'));
          })) : h('div', { class: 'card' },
            h('p', null, 'Aucune adresse sur ce téléphone.'),
            h('p', { class: 'small muted' }, 'Vos fiches sont liées à ce téléphone. Pour en gérer une depuis un autre appareil, utilisez sa clé de gestion.'))),
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

    return page(
      h('header', { class: 'stack tight' },
        h('div', { class: 'brand' }, h('span', { class: 'mark', 'aria-label': 'Fii La' }, 'Fii', h('span', null, 'La'))),
        h('p', { class: 'promise' }, 'Ton adresse, expliquée une seule fois.'),
        h('p', { class: 'muted small' }, 'La porte exacte, une photo, un repère, et l’endroit où la voiture peut s’arrêter.')),
      h('nav', { class: 'actions', 'aria-label': 'Actions principales' },
        h('a', { class: 'btn big full', href: '#/new' }, 'Créer mon adresse'),
        h('a', { class: 'btn ghost', href: '#/', onclick: function (e) { e.preventDefault(); var el = document.getElementById('mes-adresses'); if (el) el.scrollIntoView(); } }, 'Mes adresses'),
        h('a', { class: 'btn ghost', href: '#/demande/nouvelle' }, 'Demander une adresse'),
        h('a', { class: 'btn ghost full', href: '#/rdv/nouveau' }, 'Créer un rendez-vous')),
      listBox,
      footer());
  }

  /* ================================================================ CRÉER / MODIFIER UNE ADRESSE */
  var DRAFT_KEY = 'fiila.draft.address';
  function blankAddress() { return { label: '', locality: '', entry: null, vehicle_ok: null, stop: null, walk: '', instruction: '', photo: null }; }

  function viewAddressForm(editId, q) {
    var reqToken = q && q.d && /^[A-Za-z0-9_-]{16,64}$/.test(q.d) ? q.d : null;
    if (editId) {
      var rec = owned.find('place', editId);
      if (!rec) return page(backBtn(), stateCard('?', 'Fiche introuvable sur ce téléphone', 'Utilisez sa clé de gestion pour la gérer ici.'));
      return api('fiila_get_owned', { p_id: editId, p_owner: rec.owner }).then(function (pl) {
        var d = { label: pl.label || '', locality: pl.locality || '', entry: { lat: pl.entry.lat, lng: pl.entry.lng, acc: pl.entry_acc, src: 'saved' },
          vehicle_ok: pl.vehicle_ok, stop: pl.stop ? { lat: pl.stop.lat, lng: pl.stop.lng, src: 'saved' } : null,
          walk: pl.walk || '', instruction: pl.instruction || '', photo: pl.photo || null };
        return addressWizard(d, { editId: editId, owner: rec.owner, originalPhoto: pl.photo || null });
      }, function (e) { return page(backBtn(), stateCard('!', 'Impossible de charger la fiche', errText(e), retryBtn())); });
    }
    var draft = LS.get(DRAFT_KEY, null) || blankAddress();
    return addressWizard(draft, { reqToken: reqToken, retour: tokenParam(q && q.retour) });
  }
  function retryBtn() { return h('button', { class: 'btn', type: 'button', onclick: render }, 'Réessayer'); }

  function addressWizard(d, ctx) {
    var step = 1;
    var root = h('div', { class: 'wrap' });
    function saveDraft() {
      if (ctx.editId) return;
      if (!LS.set(DRAFT_KEY, d)) { var copyD = Object.assign({}, d, { photo: null }); LS.set(DRAFT_KEY, copyD); }
    }
    function valid() {
      if (step === 1) return d.entry ? '' : 'Validez d’abord le point de l’entrée.';
      if (step === 2) {
        if (d.vehicle_ok == null) return 'Répondez Oui ou Non.';
        if (d.vehicle_ok === false && !d.stop) return 'Validez le point d’arrêt de la voiture.';
        return '';
      }
      if (step === 3) {
        if (!d.label.trim()) return 'Donnez un nom au lieu.';
        if (!d.photo && !d.instruction.trim()) return 'Ajoutez une photo de l’entrée ou un repère.';
        return '';
      }
      return '';
    }
    function draw() {
      var why = h('p', { class: 'hint', role: 'status' });
      var next = h('button', { class: 'btn', type: 'button', onclick: onNext }, step < 4 ? 'Continuer' : (ctx.editId ? 'Enregistrer les modifications' : 'Enregistrer et obtenir mon lien'));
      var err = h('div', { role: 'alert' });
      function refresh() { var w = valid(); next.disabled = !!w; why.textContent = w; }
      function onChange() { saveDraft(); refresh(); }
      var body;
      if (step === 1) {
        body = [h('h1', null, 'Où est l’entrée ?'),
          h('p', { class: 'muted' }, 'Placez le repère devant la porte d’entrée, pas au milieu de la rue.'),
          mapPicker({ id: 'entry', what: 'l’entrée', get: function () { return d.entry; }, set: function (p) { d.entry = p; onChange(); } })];
      } else if (step === 2) {
        var stopBox = h('div', { class: 'stack' });
        var drawStop = function () {
          setKids(stopBox);
          if (d.vehicle_ok === false) add(stopBox, [
            h('h2', null, 'Où la voiture doit-elle s’arrêter ?'),
            mapPicker({ id: 'stop', what: 'l’arrêt voiture', get: function () { return d.stop; }, set: function (p) { d.stop = p; onChange(); } }),
            textField({ id: 'walk', label: 'Du point d’arrêt jusqu’à l’entrée', multiline: true, max: 200, value: d.walk, placeholder: 'Ex. : prendre la ruelle à gauche de la pharmacie, 3e porte', onInput: function (v) { d.walk = v; onChange(); } })]);
        };
        var pick = function (v) { return function () { d.vehicle_ok = v; if (v) { d.stop = null; d.walk = ''; } drawStop(); onChange(); }; };
        body = [h('h1', null, 'Une voiture peut-elle arriver devant l’entrée ?'),
          h('p', { class: 'muted' }, 'Taxi, livreur en voiture ou chauffeur.'),
          h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Accès voiture' },
            h('label', null, h('input', { type: 'radio', name: 'veh', id: 'veh-yes', checked: d.vehicle_ok === true, onchange: pick(true) }), 'Oui'),
            h('label', null, h('input', { type: 'radio', name: 'veh', id: 'veh-no', checked: d.vehicle_ok === false, onchange: pick(false) }), 'Non')),
          stopBox];
        drawStop();
      } else if (step === 3) {
        body = [h('h1', null, 'Comment reconnaître l’entrée ?'),
          textField({ id: 'label', label: 'Nom du lieu', max: 60, value: d.label, placeholder: 'Ex. : Mon atelier', onInput: function (v) { d.label = v; onChange(); } }),
          textField({ id: 'locality', label: 'Quartier ou localité', optional: true, max: 60, value: d.locality, placeholder: 'Ex. : Yoff Virage', onInput: function (v) { d.locality = v; onChange(); } }),
          photoField({ id: 'photo', get: function () { return d.photo; }, set: function (p) { d.photo = p; onChange(); } }),
          textField({ id: 'instruction', label: 'Repère et accès', multiline: true, max: 280, value: d.instruction, placeholder: 'Ex. : porte verte après le manguier, sonner deux fois', hint: 'Dans la langue de votre choix.', onInput: function (v) { d.instruction = v; onChange(); } })];
      } else {
        body = [h('h1', null, 'Voici ce que verra la personne'),
          fiche({ kind: 'address', label: d.label.trim(), locality: d.locality.trim(), instruction: d.instruction.trim(), entry: d.entry, vehicle_ok: d.vehicle_ok, stop: d.stop, walk: d.walk.trim(), photo: d.photo }),
          h('div', { class: 'notice' }, 'Toute personne qui reçoit le lien peut l’ouvrir et le transférer. Vous pourrez modifier la fiche, désactiver le lien ou tout supprimer à tout moment.')];
      }
      function onNext() {
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
          : backBtn(ctx.reqToken ? 'Retour à la demande' : ctx.editId ? 'Retour à la fiche' : 'Accueil', ctx.reqToken ? '#/d/' + ctx.reqToken : ctx.editId ? '#/m/' + ctx.editId : '#/'),
        h('div', { class: 'stack tight' },
          h('p', { class: 'eyebrow' }, (ctx.editId ? 'Modifier · ' : '') + 'Étape ' + step + ' sur 4'),
          h('div', { class: 'steps', 'aria-hidden': 'true' }, [1, 2, 3, 4].map(function (i) { return h('i', { class: i <= step ? 'on' : '' }); }))),
        h('div', { class: 'stack' }, body), err, h('div', { class: 'stack' }, next, why),
        !ctx.editId ? h('p', { class: 'hint' }, 'Votre brouillon reste sur ce téléphone jusqu’à l’enregistrement.') : null,
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
    function publish() {
      if (ctx.editId) {
        return api('fiila_update_place', { p_id: ctx.editId, p_owner: ctx.owner, p: payload() }).then(function (pl) {
          owned.patch('place', ctx.editId, { label: pl.label });
          toast('Modifications enregistrées. Le lien reste le même.');
          go('#/m/' + ctx.editId);
        });
      }
      return api('fiila_create_place', { p: payload() }).then(function (r) {
        var stored = owned.put({ type: 'place', kind: 'address', id: r.id, owner: r.owner_token, share: r.share_token, label: d.label.trim(), created: Date.now() });
        LS.del(DRAFT_KEY);
        LS.set('fiila.saved', true);
        track('fiche_created', ctx.reqToken ? 'address_request' : ctx.retour ? 'address_discovery' : 'address_direct');
        if (!stored) toast('Fiche enregistrée, mais ce téléphone n’a pas pu garder la clé de gestion. Copiez-la sur la page suivante.');
        else toast('Adresse enregistrée.');
        if (ctx.reqToken) go('#/d/' + ctx.reqToken + '?sel=' + r.id);
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
    if (!owner) return page(backBtn(), stateCard('?', 'Cette fiche n’est pas gérée sur ce téléphone', 'Ouvrez sa clé de gestion sur ce téléphone pour la gérer ici.', h('a', { class: 'btn', href: '#/cle' }, 'Restaurer une clé')));
    return api('fiila_get_owned', { p_id: id, p_owner: owner }).then(function (pl) {
      if (rec && rec.share !== pl.share_token) owned.patch('place', id, { share: pl.share_token, label: pl.label });
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
      ? pl.label + ' — ' + whenText(pl.starts_at) + '\nLe lieu exact et comment arriver : ' + url
      : pl.label + ' — voici comment trouver l’entrée : ' + url;
    var zone = h('div', { class: 'stack' });
    var busy = false;

    function act(fn, okText, then) {
      if (busy) return; busy = true;
      api(fn, { p_id: pl.id, p_owner: owner }).then(function (res) {
        busy = false; toast(okText); then(res);
      }, function (e) { busy = false; setKids(zone, h('p', { class: 'alert' }, errText(e))); });
    }
    function askDelete() {
      setKids(zone, h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirmer la suppression' },
        h('p', null, h('strong', null, 'Supprimer définitivement cette fiche ?')),
        h('p', { class: 'small' }, 'La fiche et sa photo seront effacées du serveur et le lien ne fonctionnera plus. Les copies déjà téléchargées ou les captures d’écran ne peuvent pas être rappelées.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn danger', type: 'button', id: 'confirm-delete', onclick: function () {
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
    var key = keyUrl('place', pl.id, owner);

    var variant = isMeeting ? 'meeting' : 'address';
    return page(
      retour ? backBtn('Revenir à la fiche reçue', '#/a/' + retour) : backBtn(),
      h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, isMeeting ? 'Mon rendez-vous' : 'Mon adresse'),
        h('h1', { class: 'wrapword' }, pl.label),
        isMeeting ? h('p', { class: 'muted' }, whenText(pl.starts_at)) : null,
        justSaved && active ? h('p', { class: 'saved-ok', role: 'status', id: 'saved-ok' }, '✓ Enregistré. Envoyez maintenant le lien à vos visiteurs ou livreurs.') : null,
        h('div', { class: 'row', style: 'align-items:center' },
          h('span', { class: 'chip ' + (active ? 'ok' : 'off'), style: 'flex:0 0 auto' },
            expired ? 'Expiré' : pl.status === 'active' ? 'Lien actif' : 'Lien désactivé'),
          h('span', { class: 'small muted' }, isMeeting && !expired ? 'Visible jusqu’au ' + shortDate(pl.expires_at) : 'Modifiée le ' + shortDate(pl.updated_at)))),
      active ? h('section', { class: 'card', 'aria-labelledby': 'h-share' },
        h('h2', { id: 'h-share' }, 'Partager'),
        h('p', { class: 'sharelink', id: 'share-url' }, url),
        navigator.share ? h('button', { class: 'btn', type: 'button', onclick: function () {
          track('share_initiated', 'native_' + variant);
          navigator.share({ title: pl.label, text: msg.replace(url, '').trim(), url: url }).catch(function (e) {
            if (e && e.name !== 'AbortError') toast('Partage indisponible ici. Utilisez « Copier le lien ».');
          });
        } }, 'Partager…') : null,
        h('a', { class: 'btn lime', href: waLink(msg), target: '_blank', rel: 'noopener noreferrer', onclick: function () { track('share_initiated', 'whatsapp_' + variant); } }, 'Préparer un message WhatsApp'),
        h('button', { class: 'btn ghost', type: 'button', id: 'copy-link', onclick: function () { copy(url, 'Lien', function () { track('link_copied', variant); }); } }, 'Copier le lien'),
        h('p', { class: 'hint' }, 'WhatsApp s’ouvre avec le message prêt : c’est vous qui l’envoyez. Toute personne qui reçoit le lien peut le transférer.'),
        h('div', { class: 'sep' }),
        h('p', { class: 'small' }, h('strong', null, 'QR code'), ' : à afficher ou imprimer près de l’entrée ou sur une commande.'),
        qrBox) : null,
      installSlot(),
      expired ? h('div', { class: 'notice' }, 'Ce rendez-vous a expiré : le lien n’affiche plus le lieu.') : null,
      isMeeting ? h('a', { class: expired ? 'btn' : 'btn ghost', id: 'similar', href: '#/rdv/nouveau' + qs({ depuis: pl.id }) }, 'Créer un rendez-vous similaire') : null,
      h('div', { class: 'row' },
        active ? h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener' }, 'Voir la fiche publique') : null,
        h('a', { class: 'btn ghost', href: isMeeting ? '#/rdv/modifier/' + pl.id : '#/edit/' + pl.id }, 'Modifier')),
      h('div', { class: 'row' },
        pl.status === 'active' && !expired
          ? h('button', { class: 'btn ghost', type: 'button', id: 'revoke', onclick: function () { act('fiila_revoke_place', 'Lien désactivé. Il n’affiche plus rien.', function () { render(); }); } }, 'Désactiver le lien')
          : !expired ? h('button', { class: 'btn ghost', type: 'button', id: 'new-link', onclick: function () { act('fiila_new_link', 'Nouveau lien créé. L’ancien reste inactif.', function () { render(); }); } }, 'Créer un nouveau lien') : null,
        h('button', { class: 'btn danger', type: 'button', id: 'delete', onclick: askDelete }, 'Supprimer')),
      pl.status !== 'active' && !expired ? h('p', { class: 'hint' }, 'Le lien désactivé n’affiche plus aucune information. Un nouveau lien le remplacera définitivement.') : null,
      zone,
      h('details', null,
        h('summary', null, 'Clé de gestion (pour un autre téléphone)'),
        h('div', { class: 'stack', style: 'margin-top:10px' },
          h('p', { class: 'small' }, 'Cette fiche est gérée depuis ce téléphone. Si vous le perdez ou effacez les données du navigateur, seule la clé de gestion permet encore de la modifier ou de la supprimer. Gardez-la pour vous : elle donne tous les droits sur la fiche.'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: function () { copy(key, 'Clé de gestion'); } }, 'Copier la clé de gestion'),
          h('a', { class: 'btn ghost small', href: waLink('Ma clé de gestion Fii La pour « ' + pl.label + ' » (ne pas partager) : ' + key), target: '_blank', rel: 'noopener noreferrer' }, 'M’envoyer la clé sur WhatsApp'),
          h('p', { class: 'hint' }, 'Choisissez votre propre discussion WhatsApp, pas celle d’une autre personne.'))),
      footer());
  }

  /* ================================================================ VUE DESTINATAIRE */
  function viewRecipient(token) {
    var create = h('a', { class: 'btn ghost small', href: '#/new' }, 'Créer mon Fii La');
    return api('fiila_get_public', { p_token: token }).then(function (r) {
      var cta = h('div', { class: 'row', style: 'justify-content:center' }, h('div', { style: 'flex:0 1 auto' }, create));
      if (r.state === 'ok') {
        document.title = 'Fii La';
        var mine = owned.all().filter(function (x) { return x.type === 'place' && x.share === token; })[0];
        return page(fiche(r.place), mine ? ownerBlock(mine) : discoveryBlock(r.place.kind, token),
          h('p', { class: 'hint', style: 'text-align:center' }, 'Fiche partagée avec Fii La. Fii La ne demande pas votre position pour l’afficher.'));
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
      h('h2', { id: 'owner-title' }, 'Cette fiche est la vôtre'),
      h('p', null, 'Vous l’avez créée sur ce téléphone. Vous pouvez la partager à nouveau, la modifier ou la désactiver.'),
      h('a', { class: 'btn ghost discover-cta', id: 'owner-manage', href: '#/m/' + rec.id }, 'Gérer et partager'));
  }

  // Bloc de découverte, placé après les informations d'arrivée. Il ouvre le parcours de création
  // existant, vierge : rien de la fiche reçue n'est transmis, sauf le lien de retour (qui reste sur l'appareil).
  function discoveryBlock(kind, token) {
    var isMeeting = kind === 'meeting';
    var variant = isMeeting ? 'meeting' : 'address';
    var block = h('section', { class: 'discover', id: 'discover', 'aria-labelledby': 'discover-title' },
      h('h2', { id: 'discover-title' }, isMeeting ? 'Tu organises aussi un rassemblement ?' : 'Et si on te trouvait aussi facilement ?'),
      h('p', null, isMeeting
        ? 'Partage le lieu, l’heure et les indications dans une seule fiche.'
        : 'Crée ton adresse avec ta photo d’entrée et tes repères. Partage-la à tes visiteurs et livreurs.'),
      h('a', { class: 'btn ghost discover-cta', id: 'discover-cta', href: (isMeeting ? '#/rdv/nouveau' : '#/new') + qs({ retour: token }),
        onclick: function () { track('discovery_cta', variant); } }, isMeeting ? 'Créer mon rendez-vous' : 'Créer mon Fii La'),
      h('p', { class: 'hint' }, 'Gratuit, sans compte et sans application à installer. Ta fiche se gère depuis ce téléphone.'));
    trackWhenVisible(block, 'discovery_shown', variant);
    return block;
  }

  /* ================================================================ DEMANDE D'ADRESSE */
  function viewRequestNew(q) {
    var src = q && q.depuis ? owned.find('request', q.depuis) : null;
    if (src) {
      return api('fiila_get_request_owner', { p_id: src.id, p_owner: src.owner }).then(function (old) {
        return requestForm({ requester_name: old.requester_name || '', purpose: old.purpose || '', order_ref: '' });
      }, function () { return requestForm({ requester_name: '', purpose: '', order_ref: '' }); });
    }
    return requestForm({ requester_name: '', purpose: '', order_ref: '' });
  }
  function requestForm(f) {
    var err = h('div', { role: 'alert' });
    var btn = h('button', { class: 'btn', type: 'button', disabled: !(f.requester_name.trim() && f.purpose.trim()), onclick: submit }, 'Créer la demande');
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
    var rec = owned.find('request', id);
    if (!rec) return page(backBtn(), stateCard('?', 'Demande introuvable sur ce téléphone', 'Ouvrez sa clé de gestion pour la voir ici.'));
    return api('fiila_get_request_owner', { p_id: id, p_owner: rec.owner }).then(function (q) {
      var url = requestUrl(q.share_token);
      var msg = q.requester_name + ' vous demande votre adresse pour : ' + q.purpose + (q.order_ref ? ' (réf. ' + q.order_ref + ')' : '') + '.\nRépondez ici : ' + url;
      var zone = h('div', { class: 'stack' });
      var key = keyUrl('request', q.id, rec.owner);
      var head = h('div', { class: 'stack tight' },
        h('p', { class: 'eyebrow' }, 'Demande d’adresse'),
        h('h1', { class: 'wrapword' }, q.purpose),
        h('p', { class: 'muted wrapword' }, 'De : ' + q.requester_name + (q.order_ref ? ' · Réf. ' + q.order_ref : '')));
      var del = h('button', { class: 'btn danger', type: 'button', onclick: function () {
        setKids(zone, h('div', { class: 'confirm' },
          h('p', null, h('strong', null, 'Supprimer cette demande ?')),
          h('p', { class: 'small' }, 'Vous ne verrez plus la réponse. L’adresse du client n’est pas supprimée : elle lui appartient.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn danger', type: 'button', onclick: function () {
              api('fiila_delete_request', { p_id: q.id, p_owner: rec.owner }).then(function () { owned.remove('request', q.id); toast('Demande supprimée.'); go('#/'); },
                function (e) { setKids(zone, h('p', { class: 'alert' }, errText(e))); });
            } }, 'Supprimer'),
            h('button', { class: 'btn ghost', type: 'button', onclick: function () { setKids(zone); } }, 'Annuler'))));
      } }, 'Supprimer la demande');
      var keyBox = h('details', null, h('summary', null, 'Clé de gestion de la demande'),
        h('div', { class: 'stack', style: 'margin-top:10px' },
          h('p', { class: 'small' }, 'Permet de consulter la réponse depuis un autre téléphone. Ne la partagez pas.'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: function () { copy(key, 'Clé de gestion'); } }, 'Copier la clé de gestion')));
      var stateBlock;
      if (q.state === 'fulfilled') {
        stateBlock = [h('span', { class: 'chip ok', style: 'align-self:flex-start' }, 'Adresse reçue le ' + shortDate(q.fulfilled_at)),
          h('p', { class: 'small muted' }, 'Visible uniquement par vous, avec ce téléphone ou la clé de gestion. Le client peut la désactiver à tout moment.'),
          fiche(q.place)];
      } else if (q.state === 'pending') {
        stateBlock = [h('span', { class: 'chip wait', style: 'align-self:flex-start' }, 'En attente de réponse'),
          h('section', { class: 'card' },
            h('h2', null, 'Envoyer la demande au client'),
            h('p', { class: 'sharelink', id: 'request-url' }, url),
            navigator.share ? h('button', { class: 'btn', type: 'button', id: 'share-request', onclick: function () {
              track('share_initiated', 'native_request');
              navigator.share({ title: 'Demande d’adresse', text: msg.replace(url, '').trim(), url: url }).catch(function (e) {
                if (e && e.name !== 'AbortError') toast('Partage indisponible ici. Utilisez « Copier le lien ».');
              });
            } }, 'Partager…') : null,
            h('a', { class: 'btn lime', href: waLink(msg), target: '_blank', rel: 'noopener noreferrer', onclick: function () { track('share_initiated', 'whatsapp_request'); } }, 'Préparer un message WhatsApp'),
            h('button', { class: 'btn ghost', type: 'button', id: 'copy-request', onclick: function () { copy(url, 'Lien', function () { track('link_copied', 'request'); }); } }, 'Copier le lien'),
            h('p', { class: 'hint' }, 'Le client voit votre nom et la raison de la demande, jamais d’autres réponses.')),
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

  function viewRequestPublic(token, q) {
    return api('fiila_get_request_public', { p_token: token }).then(function (r) {
      if (r.state === 'fulfilled') return page(stateCard('✓', 'Demande déjà traitée', 'Cette demande a déjà reçu une adresse.'), footer());
      if (r.state === 'expired') return page(stateCard('⌛', 'Demande expirée', 'Demandez un nouveau lien à la personne.'), footer());
      if (r.state !== 'pending') return page(stateCard('?', 'Demande introuvable', 'Vérifiez que le lien a été copié en entier.'), footer());

      var head = h('section', { class: 'card' },
        h('p', { class: 'eyebrow' }, 'Demande d’adresse'),
        h('h1', { class: 'wrapword', style: 'font-size:24px' }, r.requester_name + ' vous demande votre adresse'),
        h('p', { class: 'wrapword' }, 'Pour : ' + r.purpose + (r.order_ref ? ' (réf. ' + r.order_ref + ')' : '')),
        h('p', { class: 'small muted' }, 'Identité non vérifiée par Fii La. Répondez seulement si vous attendez cette demande.'));
      var listBox = h('div', { class: 'stack' }, loading('Recherche de vos adresses sur ce téléphone…'));
      var prev = h('div', { class: 'stack' });
      var err = h('div', { role: 'alert' });
      var mine = owned.all().filter(function (x) { return x.type === 'place' && (x.kind || 'address') === 'address'; });
      var sel = q && q.sel;

      function showPreview() {
        setKids(prev);
        if (!sel) return;
        var rec = owned.find('place', sel);
        if (!rec) return;
        prev.append(loading('Préparation de l’aperçu…'));
        api('fiila_get_owned', { p_id: sel, p_owner: rec.owner }).then(function (pl) {
          var send = h('button', { class: 'btn', type: 'button', id: 'send-address', onclick: function () {
            send.disabled = true; send.textContent = 'Envoi…'; setKids(err);
            api('fiila_fulfill_request', { p_token: token, p_place_id: sel, p_place_owner: rec.owner }).then(function () {
              setKids(app, page(stateCard('✓', 'Adresse envoyée', r.requester_name + ' peut maintenant voir votre fiche. Vous pouvez la désactiver ou la supprimer à tout moment depuis « Mes adresses ».',
                h('a', { class: 'btn', href: '#/m/' + sel }, 'Gérer mon adresse')), footer()));
              window.scrollTo(0, 0);
            }, function (e) {
              send.disabled = false; send.textContent = 'Réessayer l’envoi';
              setKids(err, h('p', { class: 'alert' }, errText(e)));
            });
          } }, 'Envoyer mon adresse à ' + r.requester_name);
          setKids(prev, h('h2', null, 'Voici exactement ce qui sera envoyé'), fiche(pl), err, send);
        }, function (e) { setKids(prev, h('p', { class: 'alert' }, errText(e))); });
      }

      if (mine.length) {
        api('fiila_owned_summaries', { p_items: mine.map(function (x) { return { type: 'place', id: x.id, owner: x.owner }; }) }).then(function (rows) {
          var usable = rows.filter(function (x) { return !x.missing && x.status === 'active'; });
          if (sel && !usable.some(function (x) { return x.id === sel; })) sel = null;
          if (!sel && usable.length === 1) sel = usable[0].id;
          setKids(listBox);
          add(listBox, usable.length ? [h('h2', null, 'Choisir une de mes adresses'),
            h('div', { class: 'choice one', role: 'radiogroup' }, usable.map(function (x) {
              return h('label', null, h('input', { type: 'radio', name: 'pick', value: x.id, checked: x.id === sel, onchange: function () { sel = x.id; showPreview(); } }),
                h('span', { class: 'wrapword' }, x.label + (x.locality ? ' · ' + x.locality : '')));
            }))] : h('p', { class: 'muted' }, 'Aucune adresse active sur ce téléphone.'));
          showPreview();
        }, function (e) { setKids(listBox, h('p', { class: 'alert' }, errText(e))); });
      } else setKids(listBox, h('p', { class: 'muted' }, 'Vous n’avez pas encore d’adresse Fii La sur ce téléphone.'));

      return page(head, listBox,
        h('a', { class: mine.length ? 'btn ghost' : 'btn', href: '#/new?d=' + token }, 'Créer une nouvelle adresse'),
        prev, footer());
    }, function (e) { return page(stateCard('!', 'Impossible d’afficher la demande', errText(e), retryBtn())); });
  }

  /* ================================================================ RENDEZ-VOUS */
  function dakarParts(iso) {
    var d = new Date(iso);
    return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; // Dakar = UTC+0 toute l'année
  }
  function viewMeetingForm(editId, q) {
    if (editId) {
      var rec = owned.find('place', editId);
      if (!rec) return page(backBtn(), stateCard('?', 'Rendez-vous introuvable sur ce téléphone', ''));
      return api('fiila_get_owned', { p_id: editId, p_owner: rec.owner }).then(function (pl) {
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
    var rec = owned.find('place', sourceId);
    if (!rec) return page(backBtn(), stateCard('?', 'Rendez-vous introuvable sur ce téléphone', 'Ouvrez sa clé de gestion pour le réutiliser ici.'));
    var key = MEETING_DRAFT + '.similaire.' + sourceId;
    var saved = LS.get(key, null);
    return api('fiila_get_owned', { p_id: sourceId, p_owner: rec.owner }).then(function (pl) {
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
      var call = ctx.editId ? api('fiila_update_place', { p_id: ctx.editId, p_owner: ctx.owner, p: p }) : api('fiila_create_place', { p: p });
      call.then(function (r) {
        if (ctx.editId) { owned.patch('place', ctx.editId, { label: p.label }); toast('Rendez-vous mis à jour. Le lien reste le même.'); go('#/m/' + ctx.editId); return; }
        var stored = owned.put({ type: 'place', kind: 'meeting', id: r.id, owner: r.owner_token, share: r.share_token, label: p.label, created: Date.now() });
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
          h('li', null, 'Pour limiter les abus : une empreinte non réversible de l’adresse IP lors des créations, effacée après 24 heures.')),
        h('h2', null, 'Ce qui n’est pas collecté'),
        h('ul', null,
          h('li', null, 'Pas de compte, pas de numéro de téléphone, pas de contacts, pas de pièce d’identité.'),
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

  render();
})();
