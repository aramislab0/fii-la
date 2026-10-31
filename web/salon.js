// Fii — salons (beauté & bien-être, 31/10/2026) : page du salon, réservation, page du rendez-vous, agenda et réglages.
// Chargé à la première page de salon (loadSalon dans app.js), comme bo.js : les autres pages ne le téléchargent pas.
// Ce fichier ne voit pas la closure de app.js : chaque outil utilisé lui est passé (salonShared dans app.js, contrôlé
// par scripts/check-bo.mjs).
window.FiiSalon = function (F) {
  var api = F.api, ApiError = F.ApiError, backBtn = F.backBtn, baseUrl = F.baseUrl, brandBar = F.brandBar, cardPhoto = F.cardPhoto, compressPhoto = F.compressPhoto, copy = F.copy, COVER_P = F.COVER_P, coverLoad = F.coverLoad, deferSrc = F.deferSrc, dkAdd = F.dkAdd, dkIso = F.dkIso, dkNow = F.dkNow, durText = F.durText, errBox = F.errBox, ERRORS = F.ERRORS, errText = F.errText, failPage = F.failPage, fcfa = F.fcfa, fill = F.fill, footer = F.footer, go = F.go, h = F.h, hm = F.hm, icon = F.icon, iconBtn = F.iconBtn, identitySlot = F.identitySlot, isPremiumTheme = F.isPremiumTheme, lazyPhoto = F.lazyPhoto, loading = F.loading, LS = F.LS, madeBy = F.madeBy, markSalon = F.markSalon, openSheet = F.openSheet, page = F.page, partnerSlot = F.partnerSlot, PAY_SHORT = F.PAY_SHORT, render = F.render, retryBtn = F.retryBtn, sapi = F.sapi, secHead = F.secHead, SEEN_KEY = F.SEEN_KEY, setAgendaBadge = F.setAgendaBadge, setKids = F.setKids, shopTabs = F.shopTabs, SITE = F.SITE, socialUrl = F.socialUrl, stateCard = F.stateCard, statePill = F.statePill, textField = F.textField, toast = F.toast, vitrineUrl = F.vitrineUrl, VT_ACCENTS = F.VT_ACCENTS, waTo = F.waTo, REDUCED = F.REDUCED, buzz = F.buzz, fxOnce = F.fxOnce, fxShop = F.fxShop, fxTicket = F.fxTicket, shopCardFile = F.shopCardFile, shopShareMsg = F.shopShareMsg, canShareFile = F.canShareFile;
  var DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function openState(hours) {
    var now = dkNow(), d = now.getUTCDay(), cur = now.getUTCHours() * 60 + now.getUTCMinutes();
    var t = hours && hours[String(d)];
    var mins = function (s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; };
    if (t && cur >= mins(t[0]) && cur < mins(t[1])) return { open: true, text: 'Ouvert · ferme à ' + t[1] };
    if (t && cur < mins(t[0])) return { open: false, text: 'Fermé · ouvre à ' + t[0] };
    for (var i = 1; i <= 7; i++) { var n = hours && hours[String((d + i) % 7)]; if (n) return { open: false, text: 'Fermé · ouvre ' + (i === 1 ? 'demain' : DAYS_FR[(d + i) % 7]) + ' à ' + n[0] }; }
    return null;
  }
  function bookDateText(iso) {
    var d = new Date(iso);
    return DAYS_FR[d.getUTCDay()].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + d.getUTCDate() + ' ' + MONTHS_FR[d.getUTCMonth()] + ' · ' + hm(d.getUTCHours() * 60 + d.getUTCMinutes());
  }

  // Lecteur des réalisations : plein écran vertical, une à la fois (glisser ou toucher à droite / à gauche), vidéo
  // chargée seulement à l'ouverture (preload none), muette au départ comme Instagram ; « Réserver ce style ».
  function reelViewer(reels, start, onBook) {
    var idx = start, vid = null, timer = null;
    var stage = h('div', { class: 'rv-stage' }), cap = h('p', { class: 'rv-cap' });
    var bars = h('div', { class: 'rv-bars' }, reels.map(function () { return h('span', null, h('i')); }));
    var mute = h('button', { class: 'rv-mute', type: 'button', 'aria-label': 'Activer le son', hidden: true, onclick: function (e) {
      e.stopPropagation(); if (!vid) return; vid.muted = !vid.muted; mute.setAttribute('aria-label', vid.muted ? 'Activer le son' : 'Couper le son'); mute.classList.toggle('on', !vid.muted); } }, icon('mic', 18));
    var back = h('div', { class: 'rv-back', id: 'reel-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Réalisations' },
      bars, stage,
      h('button', { class: 'rv-close', type: 'button', 'aria-label': 'Fermer', onclick: function () { close(); } }, icon('close', 22)),
      mute,
      h('div', { class: 'rv-foot' }, cap, iconBtn('button', { class: 'btn big', type: 'button', id: 'reel-book', onclick: function () { close(); onBook(); } }, 'cal', 'Réserver')));
    function fill(k, f) { var i = bars.children[k] && bars.children[k].firstChild; if (i) i.style.width = Math.round(f * 100) + '%'; }
    function show(k) {
      clearInterval(timer); if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); vid = null; }
      idx = (k + reels.length) % reels.length;
      for (var j = 0; j < reels.length; j++) fill(j, j < idx ? 1 : 0);
      var r = reels[idx];
      cap.textContent = r.caption || '';
      var img = h('img', { src: r.poster, alt: r.caption || 'Réalisation', class: 'rv-media', decoding: 'async' });
      setKids(stage, img);
      mute.hidden = !r.video;
      if (r.video) {
        vid = h('video', { class: 'rv-media', playsinline: '', 'webkit-playsinline': '', muted: '', autoplay: '', preload: 'auto', poster: r.poster });
        vid.muted = true; vid.src = r.video;
        vid.addEventListener('playing', function () { if (img.isConnected) img.remove(); });
        vid.addEventListener('timeupdate', function () { if (vid && vid.duration) fill(idx, vid.currentTime / vid.duration); });
        vid.addEventListener('ended', function () { show(idx + 1); });
        stage.appendChild(vid);
        var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {});
      } else {
        var t0 = Date.now();
        timer = setInterval(function () { var f = (Date.now() - t0) / 5000; fill(idx, Math.min(1, f)); if (f >= 1) show(idx + 1); }, 80);
      }
    }
    var x0 = null;
    stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
    });
    stage.addEventListener('click', function (e) { var w = stage.clientWidth || 1; show(idx + (e.clientX - stage.getBoundingClientRect().left < w / 3 ? -1 : 1)); });
    var closeSheet = openSheet(back, { onClose: function () { clearInterval(timer); if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); } } });
    function close() { window.removeEventListener('hashchange', close); if (back.isConnected) closeSheet(); }
    window.addEventListener('hashchange', close);
    show(idx);
  }

  function salonPage(slug, shop, products, q) {
    var theme = ['galerie', 'catalogue', 'magazine', 'atelier', 'comptoir', 'maison', 'edition', 'concept', 'rituel'].indexOf(shop.theme) >= 0 ? shop.theme : 'galerie';
    var reels = (shop.reels || []).filter(function (r) { return r.poster; });
    var byId = {}; products.forEach(function (p) { byId[p.id] = p; });
    // Ordre : rubriques dans l'ordre où le salon les a créées, puis le prix croissant (simple, prévisible).
    var first = {};
    products.forEach(function (p) { var k = p.rubric || ''; if (first[k] == null || (p.added || 0) < first[k]) first[k] = p.added || 0; });
    var rubs = Object.keys(first).filter(Boolean).sort(function (a, b) { return first[a] - first[b]; });
    var list = products.slice().sort(function (a, b) {
      var ra = a.rubric ? rubs.indexOf(a.rubric) : 99, rb = b.rubric ? rubs.indexOf(b.rubric) : 99;
      return ra - rb || (a.price || 0) - (b.price || 0);
    });
    var tab = '';
    var st = openState(shop.hours);
    var cover = shop.has_cover ? h('div', { class: 'sl-cover loading-skel', id: 'vitrine-cover' }) : null;
    if (cover) lazyPhoto(cover, function () { return coverLoad(slug); }, '');
    else delete COVER_P[slug];
    var wa = shop.phone ? waTo(shop.phone, 'Bonjour ' + shop.name + ', ') : null;
    var ig = shop.socials && shop.socials.instagram ? socialUrl('instagram', shop.socials.instagram) : null;
    function round(attrs, ic, label) { return h('a', Object.assign({ class: 'sl-ib', 'aria-label': label }, attrs), icon(ic, 20)); }
    // En-tête : nom, une ligne d'information (ouverture → horaires), petits ronds d'action.
    var head = h('header', { class: 'sl-head' },
      shop.logo ? h('img', { class: 'sl-logo', src: shop.logo, alt: '' }) : null,
      h('h1', { class: 'sl-name' }, shop.name),
      h('div', { class: 'sl-ibs' },
        st ? h('button', { class: 'sl-open' + (st.open ? ' on' : ''), type: 'button', id: 'salon-open', onclick: hoursSheet }, h('i', { 'aria-hidden': 'true' }), st.text) : null,
        shop.place ? round({ href: '#/a/' + shop.place.token, id: 'salon-route' }, 'nav', 'Itinéraire') : null,
        wa ? round({ href: wa, target: '_blank', rel: 'noopener noreferrer', id: 'salon-wa' }, 'whatsapp', 'WhatsApp') : null,
        ig ? round({ href: ig, target: '_blank', rel: 'noopener noreferrer', id: 'salon-ig' }, 'instagram', 'Instagram') : null));
    // Réalisations : des bulles comme les « stories à la une » d'Instagram ; un toucher ouvre le lecteur.
    // Anneau or qui tourne tant que la réalisation n'a pas été vue sur ce téléphone (animations, 31/10).
    var SEEN = LS.get('fiila.reels.seen', []); if (!Array.isArray(SEEN)) SEEN = [];
    var reelRow = reels.length ? h('div', { class: 'sl-bubbles', id: 'salon-reels', role: 'list', 'aria-label': 'Réalisations' }, reels.map(function (r, i) {
      var im = h('img', { alt: '', decoding: 'async' }); deferSrc(im, r.poster);
      return h('button', { class: 'sl-bub' + (SEEN.indexOf(r.id) >= 0 ? ' seen' : ''), type: 'button', role: 'listitem', 'data-reel': i, style: '--fx-i:' + i, onclick: function (e) {
        e.currentTarget.classList.add('seen'); if (r.id && SEEN.indexOf(r.id) < 0) { SEEN = SEEN.concat(r.id).slice(-60); LS.set('fiila.reels.seen', SEEN); }
        reelViewer(reels, i, function () { book(null); }); } },
        h('span', { class: 'sl-bub-img' }, im), h('span', { class: 'sl-bub-t' }, r.caption || 'Réalisation'));
    })) : null;
    var tabs = rubs.length > 1 ? h('div', { class: 'opt-row sl-tabs', id: 'salon-tabs', role: 'tablist' }) : null;
    // Prochain créneau libre de chaque prestation (14 jours), affiché sur sa carte ; la réservation s'ouvre sur ce jour.
    var NEXT = {};
    api('fiila_vitrine_next', { p_slug: slug }).then(function (r) { NEXT = r || {}; if (grid.isConnected) draw(); }, function () {});
    function nextText(n) {
      if (!n) return '';
      var i = Math.round((Date.parse(n.day + 'T12:00:00Z') - Date.parse(dkIso(dkAdd(0)) + 'T12:00:00Z')) / 864e5);
      return (i === 0 ? 'Dispo à ' : i === 1 ? 'Demain ' : DAYS_FR[new Date(n.day + 'T12:00:00Z').getUTCDay()].slice(0, 3) + '. ' + Number(n.day.slice(8)) + ' à ') + n.time.replace(':', 'h');
    }
    var grid = h('div', { class: 'sl-grid', id: 'salon-menu' });
    function card(p) {
      var img = h('div', { class: 'sl-cimg' + (p.has_photo ? ' loading-skel' : '') }, p.has_photo ? null : h('span', { class: 'sl-cph', 'aria-hidden': 'true' }, p.name.charAt(0)));
      if (p.has_photo) cardPhoto(img, p.img, function () { return api('fiila_vitrine_photo', { p_slug: slug, p_id: p.id }).then(function (x) { return x.photo; }); }, p.name, true);
      return h('article', { class: 'sl-card', 'data-svc': p.id },
        img,
        h('div', { class: 'sl-cbody' },
          h('h3', null, p.name),
          h('p', { class: 'sl-cmeta' }, h('b', null, fcfa(p.price)), p.duration ? h('span', null, ' · ' + durText(p.duration)) : null),
          NEXT[p.id] ? h('p', { class: 'sl-next', 'data-next': p.id }, h('i', { 'aria-hidden': 'true' }), nextText(NEXT[p.id])) : null,
          h('button', { class: 'btn sl-cbtn', type: 'button', 'data-book': p.id, onclick: function () { book(p); } }, 'Réserver')));
    }
    function draw() {
      if (tabs) setKids(tabs, [['', 'Tout']].concat(rubs.map(function (r) { return [r, r]; })).map(function (t) {
        var on = tab === t[0];
        return h('button', { type: 'button', class: 'opt' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', 'data-tab': t[0], onclick: function () { tab = t[0]; draw(); } }, t[1]);
      }));
      setKids(grid, list.filter(function (p) { return !tab || p.rubric === tab; }).map(card));
    }
    draw();
    function hoursSheet() {
      var back = h('div', { class: 'sheet-back', id: 'hours-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hours-h', onclick: function (e) { if (e.target === back) close(); } },
        h('div', { class: 'sheet sl-sheet' },
          h('button', { class: 'iconbtn vsheet-close', type: 'button', 'aria-label': 'Fermer', onclick: function () { close(); } }, icon('close', 20)),
          h('h2', { id: 'hours-h' }, 'Horaires'),
          h('div', { class: 'sl-hours' }, [1, 2, 3, 4, 5, 6, 0].map(function (d) {
            var t = shop.hours && shop.hours[String(d)];
            return h('div', { class: 'sl-hr' + (d === dkNow().getUTCDay() ? ' on' : '') }, h('span', null, DAYS_FR[d].replace(/^./, function (c) { return c.toUpperCase(); })), h('span', null, t ? t[0] + ' – ' + t[1] : 'Fermé'));
          })),
          shop.place ? iconBtn('a', { class: 'btn ghost full', href: '#/a/' + shop.place.token }, 'nav', [shop.place.label, shop.place.locality].filter(Boolean).join(', ')) : null));
      back.classList.add('vt', 'vt-' + theme, 'sl');
      back.style.setProperty('--accent', (VT_ACCENTS[shop.accent] || VT_ACCENTS.noir)[1]);
      var close = openSheet(back);
    }
    // Barre « Réserver » collante (animations, 31/10) : visible une fois l'en-tête dépassé, cachée en bas de page.
    var prices = products.map(function (p) { return p.price || 0; }).filter(Boolean);
    var dock = h('div', { class: 'fx-dock', id: 'salon-dock', hidden: true }, h('div', { class: 'fx-dock-in' },
      h('div', { class: 'fx-dock-t' }, h('small', null, shop.name), h('b', null, prices.length ? 'Dès ' + fcfa(Math.min.apply(null, prices)) : 'Réservation en ligne')),
      h('button', { class: 'btn', type: 'button', id: 'dock-book', onclick: function () { book(null); } }, 'Réserver')));
    var sec = h('section', { class: 'sl-sec', 'aria-label': 'Prestations' }, tabs, grid);
    var foot = isPremiumTheme(theme) && !SITE ? madeBy() : footer(true);
    function dockState() {
      if (!dock.isConnected) { window.removeEventListener('scroll', dockState); return; }
      var show = sec.getBoundingClientRect().top < 80 && foot.getBoundingClientRect().top > window.innerHeight - 40;
      if (show === dock.hidden) dock.hidden = !show;
    }
    window.addEventListener('scroll', dockState, { passive: true });
    var pg = page(h('div', { class: 'brand-bar nobrand' }), cover, head, reelRow, sec,
      h('div', { style: 'height:24px' }), foot, dock);
    pg.classList.add('vt', 'vt-' + theme, 'sl');
    if (isPremiumTheme(theme)) { pg.classList.add('vt-premium'); document.documentElement.setAttribute('data-vt', theme); }
    pg.style.setProperty('--accent', (VT_ACCENTS[shop.accent] || VT_ACCENTS.noir)[1]);
    if (q && q.s && byId[q.s]) setTimeout(function () { if (pg.isConnected) book(byId[q.s]); }, 80);
    fxShop(pg, shop);

    // Réservation en trois temps dans une feuille : prestation → jour et heure → coordonnées (et caution).
    function book(pre) {
      var f = { p: pre, day: null, time: null, name: LS.get('fiila.rdv.name', ''), phone: LS.get('fiila.rdv.phone', ''), pay: '' };
      var payModes = shop.pay_before_off ? [] : ((shop.policies && shop.policies.pay) || []).filter(function (k) { return k === 'wave' || k === 'om'; });
      var body = h('div', { class: 'stack' }), err = h('div', { role: 'alert' });
      var title = h('h2', { id: 'book-h' });
      // Trois étapes visibles en haut de la feuille : prestation, jour et heure, coordonnées.
      var steps = h('div', { class: 'fx-steps', id: 'book-steps', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
      function step(n) { Array.prototype.forEach.call(steps.children, function (x, k) { x.className = k === n ? 'on' : k < n ? 'done' : ''; }); body.classList.remove('fx-view'); void body.offsetWidth; body.classList.add('fx-view'); }
      var back = h('div', { class: 'sheet-back vt-sheet', id: 'book-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'book-h', onclick: function (e) { if (e.target === back) close(); } },
        h('div', { class: 'sheet vsheet sl-sheet' },
          h('button', { class: 'iconbtn vsheet-close', type: 'button', 'aria-label': 'Fermer', id: 'book-close', onclick: function () { close(); } }, icon('close', 20)),
          steps, title, body, err));
      back.classList.add('vt', 'vt-' + theme, 'sl'); if (isPremiumTheme(theme)) back.classList.add('vt-premium');
      back.style.setProperty('--accent', (VT_ACCENTS[shop.accent] || VT_ACCENTS.noir)[1]);
      var closeSheet = openSheet(back);
      function close() { window.removeEventListener('hashchange', close); if (back.isConnected) closeSheet(); }
      window.addEventListener('hashchange', close);
      // En-tête de la réservation : la photo de la prestation, son nom, son prix, « Changer ».
      function chosen() {
        var ph = f.p.img ? h('img', { src: f.p.img, alt: '', decoding: 'async' }) : h('span', { class: 'sl-cph', 'aria-hidden': 'true' }, f.p.name.charAt(0));
        return h('div', { class: 'sl-hero', id: 'book-hero' }, ph,
          h('div', { class: 'sl-hero-t' }, h('b', null, f.p.name), h('span', null, [fcfa(f.p.price), durText(f.p.duration)].filter(Boolean).join(' · '))),
          h('button', { class: 'sl-hero-chg', type: 'button', id: 'book-change', onclick: function () { f.p = null; f.day = null; f.time = null; draw(); } }, 'Changer'));
      }
      function draw() {
        setKids(err);
        if (!f.p) {
          title.textContent = 'Choisir une prestation'; step(0);
          setKids(body, products.slice().sort(function (a, b) { return (a.price || 0) - (b.price || 0); }).map(function (p) {
            return h('button', { class: 'sl-svc', type: 'button', 'data-pick': p.id, onclick: function () { f.p = p; draw(); } },
              p.img ? h('img', { class: 'sl-svc-im', src: p.img, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'sl-svc-im sl-cph', 'aria-hidden': 'true' }, p.name.charAt(0)),
              h('span', { class: 'sl-svc-t' }, h('b', null, p.name), h('span', { class: 'small muted' }, durText(p.duration))), h('span', { class: 'sl-svc-p' }, fcfa(p.price)));
          }));
          return;
        }
        if (!f.day || !f.time) { drawWhen(); return; }
        drawWho();
      }
      function drawWhen() {
        title.textContent = 'Jour et heure'; step(1);
        if (!f.day) f.day = NEXT[f.p.id] ? NEXT[f.p.id].day : dkIso(dkAdd(0));
        var slotsBox = h('div', { class: 'sl-slotbox', id: 'book-slots' }, loading('Créneaux…'));
        var days = h('div', { class: 'sl-days', id: 'book-days', role: 'radiogroup', 'aria-label': 'Jour' });
        for (var i = 0; i < 21; i++) (function (i) {
          var d = dkAdd(i), iso = dkIso(d), open = shop.hours && shop.hours[String(d.getUTCDay())], on = f.day === iso;
          days.appendChild(h('button', { type: 'button', class: 'sl-day' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-day': iso, disabled: open ? null : '',
            onclick: function () { f.day = iso; f.time = null; drawWhen(); } },
            h('span', null, i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : DAYS_FR[d.getUTCDay()].slice(0, 3) + '.'), h('b', null, String(d.getUTCDate())), h('span', null, MONTHS_FR[d.getUTCMonth()])));
        })(i);
        setKids(body, chosen(), days, slotsBox);
        setTimeout(function () { var on = days.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 0);
        api('fiila_vitrine_slots', { p_slug: slug, p_product: f.p.id, p_day: f.day }).then(function (r) {
          if (!slotsBox.isConnected) return;
          if (r.closed || !r.slots.length) { setKids(slotsBox, h('p', { class: 'muted small', id: 'book-none' }, r.closed ? 'Le salon est fermé ce jour-là.' : 'Plus de créneau libre ce jour-là. Essayez un autre jour.')); return; }
          // Créneaux groupés : Matin, Après-midi, Soir.
          var parts = [['Matin', function (t) { return t < '12:00'; }], ['Après-midi', function (t) { return t >= '12:00' && t < '17:00'; }], ['Soir', function (t) { return t >= '17:00'; }]];
          var ci = 0;
          setKids(slotsBox, parts.map(function (pp) {
            var l = r.slots.filter(pp[1]);
            return l.length ? h('div', { class: 'sl-part' }, h('p', { class: 'sl-part-h' }, pp[0]),
              h('div', { class: 'sl-slots-g' }, l.map(function (t) {
                return h('button', { type: 'button', class: 'sl-slot fx-casc', style: '--fx-i:' + Math.min(ci++, 16), 'data-time': t, onclick: function (e) { e.currentTarget.classList.add('on'); buzz(8); f.time = t; setTimeout(draw, REDUCED ? 0 : 140); } }, t);
              }))) : null;
          }));
        }, function (e) { setKids(slotsBox); errBox(err, e); });
      }
      function drawWho() {
        title.textContent = 'Vos coordonnées'; step(2);
        if (f.p.deposit && payModes.length === 1) f.pay = payModes[0];
        var dep = f.p.deposit && payModes.length;
        var when = h('div', { class: 'sl-when' }, icon('cal', 18), h('span', null, bookDateText(f.day + 'T' + f.time + ':00Z')),
          h('button', { class: 'btn link small', type: 'button', id: 'book-when', onclick: function () { f.time = null; draw(); } }, 'Changer'));
        var payBox = h('div', { class: 'field', id: 'book-pay' });
        function drawPay() {
          if (!dep) { setKids(payBox); return; }
          setKids(payBox, h('span', { class: 'lbl', id: 'book-pay-l' }, 'Caution de ' + fcfa(f.p.deposit)),
            payModes.length === 1 ? h('p', { class: 'small' }, PAY_SHORT[payModes[0]])
              : h('div', { class: 'opt-row', role: 'radiogroup', 'aria-labelledby': 'book-pay-l' }, payModes.map(function (k) {
                var on = f.pay === k;
                return h('button', { type: 'button', class: 'opt' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-pay': k, onclick: function () { f.pay = k; drawPay(); } }, PAY_SHORT[k]);
              })),
            h('p', { class: 'small muted' }, 'Elle réserve votre créneau et sera déduite du prix. Le numéro s’affiche à l’étape suivante.'));
        }
        drawPay();
        var send = iconBtn('button', { class: 'btn big full', type: 'button', id: 'book-send', onclick: function () {
          setKids(err);
          if (!f.name.trim()) return errBox(err, new ApiError('your_name_required'), 'book-name');
          if (f.phone.replace(/\D/g, '').length < 9) return errBox(err, new ApiError('phone_required'), 'book-phone');
          if (dep && !f.pay) return errBox(err, new ApiError('pay_required'));
          send.disabled = true;
          LS.set('fiila.rdv.name', f.name.trim()); LS.set('fiila.rdv.phone', f.phone.trim());
          api('fiila_vitrine_book', { p_slug: slug, p: { product_id: f.p.id, day: f.day, time: f.time, pay: f.pay || undefined, customer: { name: f.name.trim(), phone: f.phone.trim() } } }).then(function (r) {
            close(); go('#/rdv/' + r.token + '?nouveau=1');
          }, function (e) {
            send.disabled = false;
            if (e && e.code === 'slot_taken') { f.time = null; toast('Ce créneau vient d’être pris. Choisissez-en un autre.'); draw(); return; }
            errBox(err, e);
          });
        } }, 'check', dep ? 'Réserver et payer la caution' : 'Confirmer le rendez-vous');
        var rules = h('div', { class: 'sl-rules', id: 'book-rules' },
          h('p', null, 'Annulation gratuite jusqu’à 2 h avant le rendez-vous.'),
          dep ? h('p', null, 'La caution est déduite du prix. Sans elle, le créneau est libéré après ' + (shop.hold || 60) + ' min.') : null,
          shop.rules ? h('p', null, shop.rules) : null);
        setKids(body, chosen(), when,
          textField({ id: 'book-name', label: 'Votre nom', value: f.name, autocomplete: 'name', onInput: function (v) { f.name = v; } }),
          textField({ id: 'book-phone', label: 'Votre numéro WhatsApp', type: 'tel', value: f.phone, autocomplete: 'tel', onInput: function (v) { f.phone = v; } }),
          payBox, rules, send);
      }
      draw();
    }
    return pg;
  }

  // Page du rendez-vous (lien gardé par la cliente) : statut, caution à payer (numéro, montant, délai), adresse, annulation.
  function viewBooking(token, q) {
    return api('fiila_booking_public', { p_token: token }).then(function (r) {
      if (r.state !== 'ok') return page(brandBar('Rendez-vous'), stateCard('?', 'Rendez-vous introuvable', 'Vérifiez que le lien a été copié en entier.'), footer(true));
      var b = r.booking, s = r.shop;
      var ST = { pending: ['wait', 'clock', 'En attente de la caution'], confirmed: ['ok', 'check', 'Rendez-vous confirmé'], cancelled: ['no', 'ban', 'Rendez-vous annulé'],
        expired: ['no', 'hourglass', 'Caution non reçue à temps'], done: ['ok', 'check', 'Prestation réalisée'], no_show: ['no', 'ban', 'Rendez-vous manqué'] }[b.status] || ['wait', 'clock', ''];
      var payCard = b.pay_to ? h('div', { class: 'card sl-pay', id: 'rdv-pay' },
        h('p', null, 'Envoyez ', h('b', null, fcfa(b.deposit)), ' par ', h('b', null, PAY_SHORT[b.pay_mode]), ' au :'),
        h('div', { class: 'pay-to' }, h('b', { id: 'rdv-pay-to' }, b.pay_to),
          iconBtn('button', { class: 'btn ghost small', type: 'button', id: 'rdv-pay-copy', onclick: function () { copy(b.pay_to.replace(/\s/g, ''), 'Numéro'); } }, 'copy', 'Copier')),
        h('p', { class: 'small muted' }, 'Le salon confirme dès réception. Sans caution avant ' + hm(new Date(b.hold_until).getUTCHours() * 60 + new Date(b.hold_until).getUTCMinutes()) + ', le créneau est libéré.')) : null;
      var err = h('div', { role: 'alert' });
      var cancel = b.can_cancel ? h('button', { class: 'btn link', type: 'button', id: 'rdv-cancel', onclick: function () {
        if (cancel.getAttribute('data-sure') !== '1') { cancel.setAttribute('data-sure', '1'); cancel.textContent = 'Confirmer l’annulation'; return; }
        cancel.disabled = true;
        api('fiila_booking_cancel', { p_token: token }).then(function () { toast('Rendez-vous annulé.'); render(); }, function (e) { cancel.disabled = false; errBox(err, e); });
      } }, 'Annuler le rendez-vous') : null;
      var pg = page(brandBar('Rendez-vous'),
        h('div', { class: 'card sl-rdv', id: 'rdv-card' },
          s.logo ? h('img', { class: 'sl-logo sm', src: s.logo, alt: '' }) : null,
          h('p', { class: 'small muted' }, s.name + ' · ' + b.ref),
          h('h1', { id: 'rdv-status', 'data-status': b.status }, statePill(ST[0], ST[1]), ' ', ST[2]),
          h('div', { class: 'sl-when big' }, icon('cal', 20), h('span', { id: 'rdv-when' }, bookDateText(b.start_at))),
          h('p', null, h('b', null, b.service), ' · ', durText(b.duration), ' · ', fcfa(b.price))),
        payCard,
        s.place ? iconBtn('a', { class: 'btn ghost full', href: '#/a/' + s.place.token, id: 'rdv-route' }, 'nav', 'Itinéraire jusqu’au salon') : null,
        // Nouvelle réservation (recommandation A1) : la cliente prévient le salon sur WhatsApp, message prérempli.
        s.phone && q && q.nouveau && (b.status === 'pending' || b.status === 'confirmed') ? iconBtn('a', { class: 'btn big full', id: 'rdv-notify', target: '_blank', rel: 'noopener noreferrer',
          href: waTo(s.phone, 'Bonjour ' + s.name + ', je viens de réserver sur votre page Fii : ' + b.service + ', ' + bookDateText(b.start_at) + ' (' + b.ref + ').' + (b.pay_to ? ' J’envoie la caution de ' + fcfa(b.deposit) + ' par ' + PAY_SHORT[b.pay_mode] + '.' : '') + ' ' + baseUrl() + '#/rdv/' + token) },
          'whatsapp', 'Prévenir le salon sur WhatsApp') : null,
        s.phone && !(q && q.nouveau) ? iconBtn('a', { class: 'btn ghost full', href: waTo(s.phone, 'Bonjour, c’est au sujet de mon rendez-vous ' + b.ref + '.'), target: '_blank', rel: 'noopener noreferrer', id: 'rdv-wa' }, 'whatsapp', 'Écrire au salon') : null,
        s.slug ? h('a', { class: 'btn link', href: '#/b/' + s.slug }, 'Voir le salon') : null,
        cancel, err, footer(true));
      // Carte de félicitations (animations, 31/10) : une fois, juste après la réservation ; un seul bouton, prévenir le salon.
      if (q && q.nouveau && fxOnce('fiila.yay.' + token)) setTimeout(function () {
        if (!pg.isConnected) return;
        var n = document.getElementById('rdv-notify');
        fxTicket({ title: 'C’est réservé !', sub: b.status === 'pending' && b.pay_to ? s.name + ' vous attend. Envoyez la caution pour confirmer.' : s.name + ' vous attend.',
          rows: [['Prestation', b.service], ['Quand', bookDateText(b.start_at)], [b.pay_to ? 'Caution ' + PAY_SHORT[b.pay_mode] : 'Prix', fcfa(b.pay_to ? b.deposit : b.price)], ['Référence', b.ref]],
          cta: n ? iconBtn('a', { class: 'btn big full fx-wa', id: 'fx-yay-go', href: n.getAttribute('href'), target: '_blank', rel: 'noopener noreferrer' }, 'whatsapp', 'Prévenir le salon sur WhatsApp') : null,
          more: 'Voir mon rendez-vous', accent: '#1F8F4E' });
      }, 250);
      else if (q && q.nouveau) setTimeout(function () { toast(b.status === 'pending' ? 'Créneau réservé. Payez la caution pour le confirmer.' : 'Rendez-vous confirmé.'); }, 200);
      return pg;
    }, function (e) { return page(brandBar('Rendez-vous'), stateCard('!', 'Impossible d’afficher le rendez-vous', errText(e), retryBtn()), footer(true)); });
  }


  /* ----- salon : agenda et réglages de réservation (31/10) */
  var BK_ST = { pending: ['wait', 'Caution attendue'], confirmed: ['ok', 'Confirmé'], cancelled: ['off', 'Annulé'], expired: ['off', 'Caution non reçue'], done: ['ok', 'Venu(e)'], no_show: ['off', 'Absent(e)'] };
  function bkChip(b) { var st = BK_ST[b.status] || ['wait', b.status]; return h('span', { class: 'chip ' + st[0] }, st[1]); }
  function salonAgenda(r, q) {
    var shop = r.shop;
    var today = dkIso(dkAdd(0)), day = q.j && /^\d{4}-\d{2}-\d{2}$/.test(q.j) ? q.j : today;
    var days = h('div', { class: 'sl-days', id: 'agenda-days', role: 'radiogroup', 'aria-label': 'Jour' });
    var listBox = h('div', { class: 'stack', id: 'agenda' }, loading('Chargement des rendez-vous…'));
    var banner = h('div', { id: 'agenda-banner' });
    var items = [];
    // Partage du lien de réservation avec la carte d'invitation du salon (photos, logo, nom), préparée dès l'affichage :
    // le partage doit partir du toucher lui-même.
    var site = null, card = null;
    sapi('fiila_shop_vitrine', { p: null }).then(function (v) {
      if (!v.slug || !v.public) return;
      site = { slug: v.slug, url: vitrineUrl(v.slug) };
      shopCardFile(v.slug).then(function (f) { card = f; });
    }, function () {});
    var share = iconBtn('button', { class: 'btn big full', type: 'button', id: 'agenda-share', onclick: function () {
      if (!site) { go('#/boutique/vitrine'); return; }
      var msg = shopShareMsg(shop.name, site.url);
      if (canShareFile(card)) { navigator.share({ files: [card], text: msg }).catch(function () {}); return; }
      if (navigator.share) navigator.share({ title: shop.name, text: msg.replace(site.url, '').replace(/\s*:\s*$/, ''), url: site.url }).catch(function () {});
      else copy(site.url, 'Lien');
    } }, 'share', 'Partager mon lien de réservation');
    function drawDays() {
      setKids(days, Array.apply(null, Array(14)).map(function (_, i) {
        var d = dkAdd(i), iso = dkIso(d), on = iso === day;
        var n = items.filter(function (b) { return b.start_at.slice(0, 10) === iso && (b.status === 'pending' || b.status === 'confirmed'); }).length;
        return h('button', { type: 'button', class: 'sl-day' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-day': iso,
          onclick: function () { day = iso; drawDays(); drawList(); } },
          h('span', null, i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : DAYS_FR[d.getUTCDay()].slice(0, 3) + '.'), h('b', null, String(d.getUTCDate())), h('span', null, n ? n + ' rdv' : '–'));
      }));
    }
    // Réservations arrivées depuis la dernière visite de l'agenda (recommandation A1) : marquées « Nouveau ».
    var seen = LS.get(SEEN_KEY, 0);
    function isNew(b) { return seen && Date.parse(b.created_at) > seen; }
    function drawList() {
      var l = items.filter(function (b) { return b.start_at.slice(0, 10) === day; });
      setKids(listBox, l.length ? h('div', { class: 'list', id: 'agenda-list' }, l.map(function (b) {
        return h('button', { class: 'item bk-row', type: 'button', 'data-bk': b.id, onclick: function () { bkSheet(b); } },
          h('span', { class: 'bk-time' }, hm(new Date(b.start_at).getUTCHours() * 60 + new Date(b.start_at).getUTCMinutes())),
          h('div', { style: 'flex:1;min-width:0;text-align:left' }, h('div', { class: 't' }, b.customer_name, isNew(b) ? h('span', { class: 'bk-new' }, 'Nouveau') : null), h('div', { class: 'small muted' }, b.service + ' · ' + durText(b.duration))),
          bkChip(b));
      })) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Aucun rendez-vous ce jour-là.')));
    }
    function load() {
      return sapi('fiila_bookings', { p_from: today, p_days: 14 }).then(function (res) {
        items = res.items || [];
        LS.set(SEEN_KEY, Date.now()); setAgendaBadge(0);
        setKids(banner, res.waiting ? h('div', { class: 'card warn', id: 'agenda-waiting' }, h('p', null, h('b', null, res.waiting + (res.waiting > 1 ? ' cautions' : ' caution') + ' à vérifier.'),
          ' Vérifiez la réception sur Wave ou Orange Money, puis touchez « Caution reçue ».')) : null);
        drawDays(); drawList();
      }, function (e) { errBox(listBox, e); });
    }
    function act(b, a, close) {
      return sapi('fiila_booking_set', { p_id: b.id, p_action: a }).then(function () {
        toast({ deposit: 'Caution reçue : rendez-vous confirmé.', confirm: 'Rendez-vous confirmé.', cancel: 'Rendez-vous annulé.', done: 'C’est noté.', no_show: 'Absence notée.' }[a]);
        close(); load();
      }, function (e) { toast(errText(e)); });
    }
    function bkSheet(b) {
      var live = b.status === 'pending' || b.status === 'confirmed';
      var acts = h('div', { class: 'stack' });
      var back = h('div', { class: 'sheet-back', id: 'bk-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bk-h', onclick: function (e) { if (e.target === back) close(); } },
        h('div', { class: 'sheet' },
          h('button', { class: 'iconbtn vsheet-close', type: 'button', 'aria-label': 'Fermer', onclick: function () { close(); } }, icon('close', 20)),
          h('h2', { id: 'bk-h' }, b.customer_name), h('p', { class: 'small muted' }, b.ref + ' · ' + bookDateText(b.start_at)),
          h('p', null, h('b', null, b.service), ' · ', durText(b.duration), ' · ', fcfa(b.price)),
          b.deposit ? h('p', { class: 'small' }, 'Caution ' + fcfa(b.deposit) + ' par ' + (PAY_SHORT[b.pay_mode] || '—') + (b.deposit_paid ? ' · reçue' : ' · pas encore reçue')) : null,
          bkChip(b), acts));
      var close = openSheet(back);
      setKids(acts,
        b.status === 'pending' && b.deposit && !b.deposit_paid ? iconBtn('button', { class: 'btn big full', type: 'button', id: 'bk-deposit', onclick: function () { act(b, 'deposit', close); } }, 'check', 'Caution reçue') : null,
        b.status === 'confirmed' ? iconBtn('button', { class: 'btn big full', type: 'button', id: 'bk-done', onclick: function () { act(b, 'done', close); } }, 'check', 'Client(e) venu(e)') : null,
        // Rappel (recommandation A7) : message prêt à envoyer la veille ou le jour même.
        live && Date.parse(b.start_at) > Date.now() ? iconBtn('a', { class: 'btn ghost full', target: '_blank', rel: 'noopener noreferrer', id: 'bk-remind',
          href: waTo(b.customer_phone, 'Bonjour ' + b.customer_name.split(' ')[0] + ', petit rappel de ' + shop.name + ' : votre rendez-vous ' + b.service + ' est prévu ' + bookDateText(b.start_at) + '. À bientôt !') }, 'clock', 'Rappeler le rendez-vous') : null,
        iconBtn('a', { class: 'btn ghost full', href: waTo(b.customer_phone, 'Bonjour ' + b.customer_name.split(' ')[0] + ', c’est ' + shop.name + ' au sujet de votre rendez-vous du ' + bookDateText(b.start_at) + '.'), target: '_blank', rel: 'noopener noreferrer', id: 'bk-wa' }, 'whatsapp', 'Écrire sur WhatsApp'),
        live && b.status === 'confirmed' ? h('button', { class: 'btn link', type: 'button', id: 'bk-noshow', onclick: function () { act(b, 'no_show', close); } }, 'Absent(e)') : null,
        live ? h('button', { class: 'btn link danger', type: 'button', id: 'bk-cancel', onclick: function (e) {
          var x = e.currentTarget; if (x.getAttribute('data-sure') !== '1') { x.setAttribute('data-sure', '1'); x.textContent = 'Confirmer l’annulation'; return; }
          act(b, 'cancel', close); } }, 'Annuler le rendez-vous') : null);
    }
    load();
    return shopTabs(page(backBtn(),
      secHead('orders', 'cal', shop.name, { id: 'shop-title' }),
      identitySlot(), partnerSlot(),
      share, banner, days, listBox,
      h('a', { class: 'btn link', href: '#/boutique/salon', id: 'agenda-settings' }, 'Horaires, adresse et réalisations'),
      footer()), 'orders');
  }

  // Réglages de réservation : horaires par jour (interrupteur + heures), postes, intervalle, adresse Fii, réalisations.
  function viewSalonSettings() {
    return sapi('fiila_shop_salon', { p: null }).then(function (d) {
      if (d.salon) markSalon();
      var hours = {}; [0, 1, 2, 3, 4, 5, 6].forEach(function (k) { hours[k] = d.hours && d.hours[k] ? d.hours[k].slice() : null; });
      var f = { seats: d.seats || 1, step: d.step || 30, place: d.place ? d.place.token : '', rules: d.rules || '' };
      var err = h('div', { role: 'alert' }), hoursBox = h('div', { class: 'stack tight', id: 'salon-hours-edit' });
      function drawHours() {
        setKids(hoursBox, [1, 2, 3, 4, 5, 6, 0].map(function (k) {
          var t = hours[k], name = DAYS_FR[k].replace(/^./, function (c) { return c.toUpperCase(); });
          return h('div', { class: 'hr-row', 'data-d': String(k) },
            h('button', { type: 'button', class: 'switch-row mini' + (t ? ' on' : ''), role: 'switch', 'aria-checked': t ? 'true' : 'false', 'aria-label': name + (t ? ' ouvert' : ' fermé'),
              onclick: function () { hours[k] = t ? null : ['09:00', '19:00']; drawHours(); } }, h('span', { class: 'sw', 'aria-hidden': 'true' }, h('i'))),
            h('span', { class: 'hr-day' }, name),
            t ? h('span', { class: 'hr-t' },
              h('input', { type: 'time', value: t[0], step: '900', 'aria-label': name + ' ouverture', oninput: function (e) { hours[k][0] = e.target.value; } }), '–',
              h('input', { type: 'time', value: t[1], step: '900', 'aria-label': name + ' fermeture', oninput: function (e) { hours[k][1] = e.target.value; } }))
              : h('span', { class: 'muted small' }, 'Fermé'));
        }));
      }
      drawHours();
      function pills(id, label, list, key) {
        var box = h('div', { class: 'pills', role: 'radiogroup', 'aria-label': label, id: id });
        function draw() { setKids(box, list.map(function (x) { var on = f[key] === x[0]; return h('button', { type: 'button', class: 'pill sm' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-v': String(x[0]), onclick: function () { f[key] = x[0]; draw(); } }, x[1]); })); }
        draw();
        return h('div', { class: 'field' }, h('span', { class: 'lbl' }, label), box);
      }
      var save = h('button', { class: 'btn big full', type: 'button', id: 'salon-save', onclick: function () {
        setKids(err); save.disabled = true;
        var hh = {}; Object.keys(hours).forEach(function (k) { if (hours[k]) hh[k] = hours[k]; });
        sapi('fiila_shop_salon', { p: { hours: hh, seats: f.seats, step: String(f.step), place: f.place.trim(), rules: f.rules.trim() } }).then(function () {
          save.disabled = false; toast('Réservations enregistrées.');
        }, function (e) { save.disabled = false; errBox(err, e); });
      } }, 'Enregistrer');
      // Réalisations : photo (et vidéo MP4 courte, facultative) ; la vidéo est copiée dans le stockage en une minute environ.
      var reels = d.reels || [], reelBox = h('div', { class: 'sl-reels mine', id: 'salon-reels-edit' });
      function drawReels() {
        setKids(reelBox, reels.map(function (r) {
          return h('div', { class: 'sl-reel' }, h('img', { src: r.poster, alt: r.caption || '' }), r.video || r.video_pending ? h('span', { class: 'sl-play', 'aria-hidden': 'true' }, icon('play', 16)) : null,
            h('button', { class: 'iconbtn reel-del', type: 'button', 'aria-label': 'Retirer cette réalisation', 'data-del': r.id, onclick: function () {
              sapi('fiila_reel_delete', { p_id: r.id }).then(function (l) { reels = l; drawReels(); toast('Réalisation retirée.'); }, function (e) { toast(errText(e)); }); } }, icon('trash', 16)));
        }), reels.length < 24 ? h('label', { class: 'sl-reel add', id: 'reel-add' }, icon('plus', 22), h('span', null, 'Photo ou vidéo'),
          h('input', { type: 'file', accept: 'image/*,video/mp4', hidden: true, onchange: function (e) { var file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) addReel(file); } })) : null);
      }
      function fileB64(file) { return new Promise(function (ok, ko) { var rd = new FileReader(); rd.onload = function () { ok(String(rd.result).replace(/^data:[^,]+,/, '')); }; rd.onerror = ko; rd.readAsDataURL(file); }); }
      function posterOf(file) {
        return new Promise(function (ok, ko) {
          var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
          v.onloadeddata = function () { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
          v.onseeked = function () {
            var c = document.createElement('canvas'), w = 540, hh = Math.round(w * (v.videoHeight / v.videoWidth || 16 / 9)); c.width = w; c.height = hh;
            c.getContext('2d').drawImage(v, 0, 0, w, hh); URL.revokeObjectURL(v.src); ok(c.toDataURL('image/jpeg', 0.82).replace(/^data:[^,]+,/, ''));
          };
          v.onerror = function () { ko(new ApiError('invalid_video')); };
        });
      }
      function addReel(file) {
        var isVid = /^video\//.test(file.type);
        if (isVid && file.type !== 'video/mp4') return toast(ERRORS.invalid_video);
        if (isVid && file.size > 4200000) return toast(ERRORS.video_too_large);
        toast(isVid ? 'Envoi de la vidéo…' : 'Envoi de la photo…');
        (isVid ? Promise.all([posterOf(file), fileB64(file)]) : compressPhoto(file, 1080).then(function (u) { return [u.replace(/^data:[^,]+,/, ''), null]; })).then(function (x) {
          return sapi('fiila_reel_add', { p: { poster: x[0], video: x[1] || undefined } });
        }).then(function (l) { reels = l; drawReels(); toast('Réalisation ajoutée.'); }, function (e) { toast(errText(e)); });
      }
      drawReels();
      return shopTabs(page(backBtn('Réglages', '#/boutique/reglages'),
        secHead('settings', 'cal', 'Réservations'),
        h('section', { class: 'card' }, h('h2', null, 'Horaires'), hoursBox),
        h('section', { class: 'card' }, h('h2', null, 'Rendez-vous'),
          pills('salon-seats', 'Rendez-vous en même temps', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], 'seats'),
          pills('salon-step', 'Créneaux toutes les', [[15, '15 min'], [30, '30 min'], [60, '1 h']], 'step'),
          textField({ id: 'salon-place', label: 'Adresse du salon (lien de votre fiche Fii)', optional: true, value: f.place ? baseUrl() + '#/a/' + f.place : '',
            hint: d.place ? d.place.label + (d.place.locality ? ', ' + d.place.locality : '') : 'Créez la fiche de votre salon (entrée, photo), puis collez son lien ici.', onInput: function (v) { f.place = v; } }),
          textField({ id: 'salon-rules', label: 'Vos règles (montrées avant de réserver)', optional: true, multiline: true, max: 200, value: f.rules,
            placeholder: 'Ex. : merci d’arriver 5 minutes avant ; au-delà de 15 min de retard, le rendez-vous est décalé.', onInput: function (v) { f.rules = v; } })),
        err, save,
        h('section', { class: 'card' }, h('h2', null, 'Réalisations'), h('p', { class: 'small muted' }, 'Vos plus beaux résultats, en photo ou en vidéo courte (MP4, 4 Mo).'), reelBox),
        footer()), 'settings');
    }, failPage('Impossible de charger les réservations', 'boutique'));
  }

  return { salonPage: salonPage, viewBooking: viewBooking, salonAgenda: salonAgenda, viewSalonSettings: viewSalonSettings };
};
