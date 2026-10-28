/* Fii — back-office (#/bo), chargé à part depuis le 27/10/2026 (HANDOFF #75) : la page reçue par les clientes ne
   télécharge plus le code de l’équipe (≈ 36 Ko compressés). app.js le charge à l’ouverture de #/bo et lui passe ses
   outils partagés (BO_SHARED dans app.js). Contrôle : tests/bosplit.sql.test.mjs (tout nom utilisé ici est fourni). */
window.FiiBO = function (F) {
  'use strict';
  var ADAPT = F.ADAPT, AMB_QUIZ = F.AMB_QUIZ, API_URL = F.API_URL, ApiError = F.ApiError, BO_ROLES = F.BO_ROLES, BUSINESS_TYPES = F.BUSINESS_TYPES, GRADES = F.GRADES, NUDGE_IDS = F.NUDGE_IDS, PAYOUT = F.PAYOUT, POLICY_DELIVERY = F.POLICY_DELIVERY, POLICY_EXCHANGE = F.POLICY_EXCHANGE, POLICY_PAY = F.POLICY_PAY, RET_TEXT = F.RET_TEXT, SERVICES = F.SERVICES, SOCIALS = F.SOCIALS, SUCC_SVC = F.SUCC_SVC, VD_AGES = F.VD_AGES, VD_CATS = F.VD_CATS, VD_CONDITIONS = F.VD_CONDITIONS, VD_GENDERS = F.VD_GENDERS, VT_PREMIUM = F.VT_PREMIUM, VT_THEMES = F.VT_THEMES, WA_CARDS = F.WA_CARDS, account = F.account, adaptPick = F.adaptPick, add = F.add, agoLong = F.agoLong, api = F.api, apiHeaders = F.apiHeaders, authed = F.authed, backBtn = F.backBtn, baseUrl = F.baseUrl, brandLogo = F.brandLogo, copy = F.copy, errBox = F.errBox, errText = F.errText, fcfa = F.fcfa, footer = F.footer, freshToken = F.freshToken, go = F.go, h = F.h, icon = F.icon, iconBtn = F.iconBtn, inviteCard = F.inviteCard, ivcBtn = F.ivcBtn, lbl = F.lbl, loading = F.loading, openSheet = F.openSheet, page = F.page, qs = F.qs, render = F.render, retryBtn = F.retryBtn, segField = F.segField, setKids = F.setKids, shortDate = F.shortDate, socialUrl = F.socialUrl, stateCard = F.stateCard, svcOf = F.svcOf, textField = F.textField, toast = F.toast, typeLabel = F.typeLabel, viewStats = F.viewStats, waLink = F.waLink;

  /* ================================================================ BACK-OFFICE (#/bo)
     Portail unique de l'équipe Fii (fondateur, 19/10 10:41). Chaque membre a son propre compte et un rôle ;
     la base décide de chaque droit (fiila.staff_can) : l'interface ne fait que masquer ce qui n'est pas permis.
     Ordinateur : barre latérale ; téléphone : barre du haut et menu. Règle « simple et intuitif » : une action principale
     et une seule rangée de filtres par écran. */
  var BO = { me: null, at: 0 };
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
    ['domaines', 'globe', 'Domaines', 'shops', null, 'Opérations'],
    ['studio', 'spark', 'Studio', 'shops', null, 'Opérations'],
    ['identites', 'lock', 'Identités', 'shops_write', 'kyc', 'Opérations'],
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
          case 'domaines': return boDomains();
          case 'studio': return boStudio();
          case 'identites': return boKyc();
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
      ['ambassadors', 'gift', 'Agents à valider', '#/bo/agents'], ['career', 'chat', 'Messages d’agents à lire', '#/bo/carriere'], ['proposals', 'star', 'Propositions du Manager à décider', '#/bo/carriere'], ['rewards', 'cash', 'Gains d’agents à verser', '#/bo/agents'], ['kyc', 'lock', 'Pièces d’identité à vérifier', '#/bo/identites'], ['suspended', 'ban', 'Boutiques suspendues', '#/bo/boutiques?f=suspended']];
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
    // Santé (audit du 27/10) : erreurs du navigateur par écran, copies de photos et séries Studio en échec, 7 jours.
    var health = h('p', { class: 'small', id: 'bo-health', hidden: true });
    api('fiila_bo_health', {}).then(function (x) {
      var js = Object.keys(x.js_errors || {}).map(function (k) { return k + ' ' + x.js_errors[k]; });
      var bad = js.length || x.media_failed || x.studio_failed;
      setKids(health, bad ? boBadge('warn', 'À regarder') : boBadge('ok', 'Rien à signaler'), ' Santé, 7 jours : erreurs de l’application ' + (js.length ? js.join(', ') : '0') +
        ' · copies de photos en échec ' + boNum(x.media_failed || 0) + ' · séries Studio en échec ' + boNum(x.studio_failed || 0) + '.');
      health.hidden = false;
    }, function () { /* droit « dashboard » absent : la ligne reste cachée */ });
    return boShell('', 'Tableau de bord', [
      health,
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
  // ----- Domaines des boutiques (Site Pro) : nom d'hôte, boutique, statut de vérification et de certificat, erreur ;
  // revérifier (fonction fiila-domains) et déconnecter avec motif (journal). docs/PLAN-DOMAINES-FII.md §4.
  // ----- Fii Studio : ouvert ou non, dépense du mois face au budget, séries (gardées, en échec), crédits des boutiques ;
  // accorder ou retirer des crédits (motif obligatoire, au journal). docs/PLAN-FII-STUDIO.md.
  var STUDIO_ST = { running: ['warn', 'En cours'], done: ['info', 'Proposée'], kept: ['ok', 'Gardée'], failed: ['danger', 'Échec'] };
  var STUDIO_ENGINE = { bria: 'Bria', nano: 'Nano Banana Pro', fibo: 'FIBO', fibo_mask: 'FIBO + masque' };
  // Facturation des séries (28/10) : crédits retenus à la création, débités si l'image est copiée, rendus une fois sinon.
  var STUDIO_CHARGE = { held: 'retenus', charged: 'débités', refunded: 'rendus' };
  var STUDIO_REFUND = { failed: 'échec', timeout: 'délai dépassé', result_lost: 'image perdue' };
  // Audience (Fii Édition, 27/10) : abonnés et favoris de la boutique, total et 30 jours, articles les plus mis en favori.
  function boShopAudience(id) {
    var box = h('section', { class: 'card stack tight', id: 'bo-shop-audience' }, h('h2', null, 'Audience'), loading());
    api('fiila_bo_shop_audience', { p_shop: id }).then(function (a) {
      setKids(box, h('h2', null, 'Audience'),
        h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, 'Abonnés'), h('span', { id: 'bo-followers' }, boNum(a.followers) + (a.followers_30 ? ' (+' + boNum(a.followers_30) + ' en 30 j)' : ''))),
        h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, 'Favoris'), h('span', { id: 'bo-favs' }, boNum(a.favs) + (a.favs_30 ? ' (+' + boNum(a.favs_30) + ' en 30 j)' : ''))),
        a.top.length ? h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, 'Les plus aimés'), h('span', null, a.top.map(function (x) { return x.name + ' (' + x.favs + ')'; }).join(' · '))) : null);
    }, function (e) { setKids(box, h('h2', null, 'Audience'), h('p', { class: 'small muted' }, errText(e))); });
    return box;
  }
  // Fiche article du site (Fii Édition V1) : conditions choisies par la boutique, articles en promo, tailles épuisées.
  function boShopSheet(id) {
    var box = h('section', { class: 'card stack tight', id: 'bo-shop-sheet' }, h('h2', null, 'Fiche article'), loading());
    api('fiila_bo_shop_sheet', { p_shop: id }).then(function (a) {
      var po = a.policies || {};
      function lbl(list, k) { var x = list.filter(function (o) { return o[0] === k; })[0]; return x ? x[1] : 'Non indiqué'; }
      setKids(box, h('h2', null, 'Fiche article'),
        h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, 'Livraison'), h('span', { id: 'bo-sheet-delivery' }, po.delivery ? lbl(POLICY_DELIVERY, po.delivery) : 'Non indiquée')),
        h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, 'Paiement'), h('span', { id: 'bo-sheet-pay' }, po.pay && po.pay.length ? po.pay.map(function (k) { return lbl(POLICY_PAY, k); }).join(', ') : 'Non indiqué')),
        h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, 'Échange'), h('span', { id: 'bo-sheet-exchange' }, po.exchange ? lbl(POLICY_EXCHANGE, po.exchange) : 'Non indiqué')),
        h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, 'Articles'), h('span', { id: 'bo-sheet-counts' }, boNum(a.promos) + ' en promo · ' + boNum(a.sold_out_sizes) + ' avec des tailles épuisées (sur ' + boNum(a.with_sizes) + ' à tailles)')),
        h('p', { class: 'small muted' }, 'Choisis par la boutique dans « Personnaliser mon site » et sur chaque article.'));
    }, function (e) { setKids(box, h('h2', null, 'Fiche article'), h('p', { class: 'small muted' }, errText(e))); });
    return box;
  }
  // Propriétaire et pièce d'identité d'une boutique (fondateur, 27/10) : voir, ouvrir la pièce (journalisé), valider ou refuser.
  function boShopIdentity(id) {
    var box = h('section', { class: 'card stack tight', id: 'bo-shop-identity' }, h('h2', null, 'Propriétaire et identité'), loading());
    function row(label, value) { return h('div', { class: 'bo-dl' }, h('span', { class: 'muted' }, label), h('span', { class: 'wrapword' }, value)); }
    var KST = { submitted: ['warn', 'À vérifier'], verified: ['ok', 'Validée'], rejected: ['danger', 'Refusée'] };
    function draw(r) {
      var k = r.kyc, docBox = h('div', { class: 'kyc-doc', id: 'bo-kyc-doc' });
      var reason = h('input', { type: 'text', id: 'bo-kyc-reason', maxlength: 200, placeholder: 'Motif du refus (visible par la boutique)' });
      setKids(box, h('h2', null, 'Propriétaire et identité'),
        row('Propriétaire', r.owner_name || h('span', { class: 'bo-warn' }, 'Non renseigné')),
        row('Téléphone', r.owner_phone ? h('a', { href: 'tel:' + r.owner_phone }, r.owner_phone) : '—'),
        row('Pièce', k ? h('span', null, boBadge(KST[k.status][0], KST[k.status][1]), ' ', k.doc_type === 'cni' ? 'Carte d’identité' : 'Passeport', ' · ', boDate(k.submitted_at, true),
            k.reason ? ' · motif : ' + k.reason : '') : r.needed ? boBadge('danger', 'Exigée, non envoyée') : h('span', { class: 'muted' }, r.sold ? 'Non exigée (réglage coupé)' : 'Pas encore exigée (aucune vente)')),
        r.blocked ? h('p', { class: 'small bo-warn', id: 'bo-kyc-blocked' }, 'Nouvelles commandes bloquées tant que la pièce n’est pas envoyée.') : null,
        k && k.has_images ? h('div', { class: 'row' }, h('button', { class: 'btn ghost small', type: 'button', id: 'bo-kyc-open', onclick: function (ev) {
          var b = ev.currentTarget; b.disabled = true;
          api('fiila_bo_kyc_doc', { p_shop: id }).then(function (d) {
            setKids(docBox, h('img', { src: d.front, alt: 'Pièce, recto' }), d.back ? h('img', { src: d.back, alt: 'Pièce, verso' }) : null);
            b.hidden = true;
          }, function (e) { b.disabled = false; toast(errText(e)); });
        } }, icon('eye', 16), h('span', null, 'Voir la pièce (consultation journalisée)'))) : null,
        docBox,
        k && k.status === 'submitted' ? h('div', { class: 'stack tight' },
          h('button', { class: 'btn', type: 'button', id: 'bo-kyc-ok', onclick: function () {
            boAct(function () { return api('fiila_bo_kyc_decide', { p_shop: id, p_ok: true }); }, 'Pièce validée.', draw, null, this);
          } }, 'Valider la pièce'),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Refuser'), reason),
          h('button', { class: 'btn danger', type: 'button', id: 'bo-kyc-no', onclick: function () {
            if (!reason.value.trim()) { toast('Indiquez un motif.'); reason.focus(); return; }
            boAct(function () { return api('fiila_bo_kyc_decide', { p_shop: id, p_ok: false, p_reason: reason.value }); }, 'Pièce refusée : la boutique est prévenue et ses commandes sont bloquées.', draw, null, this);
          } }, 'Refuser la pièce')) : null);
    }
    api('fiila_bo_shop_identity', { p_shop: id }).then(draw, function (e) { setKids(box, h('h2', null, 'Propriétaire et identité'), h('p', { class: 'small muted' }, errText(e))); });
    return box;
  }
  // Identités : pièces à vérifier et boutiques bloquées faute de pièce ; réglage kyc_required dans Réglages.
  function boKyc() {
    return api('fiila_bo_kyc_list', {}).then(function (r) {
      return boShell('identites', 'Identités', [
        h('p', { class: 'small muted' }, 'Pièce d’identité du propriétaire exigée après la première vente (réglage « kyc_required »). Sans pièce, les nouvelles commandes sont bloquées. ' + boNum(r.verified) + ' pièce(s) validée(s).'),
        h('section', { class: 'stack tight', id: 'bo-kyc-pending' }, h('h2', null, 'À vérifier'),
          boTable([{ label: 'Boutique', get: function (x) { return h('a', { href: '#/bo/boutiques/' + x.shop_id }, x.shop); } },
            { label: 'Propriétaire', get: function (x) { return x.owner_name || '—'; } }, { label: 'Téléphone', get: function (x) { return x.owner_phone || '—'; } },
            { label: 'Pièce', get: function (x) { return x.doc_type === 'cni' ? 'Carte d’identité' : 'Passeport'; } }, { label: 'Envoyée', get: function (x) { return boDate(x.at, true); } }],
            r.pending, { href: function (x) { return '#/bo/boutiques/' + x.shop_id; }, empty: 'Aucune pièce à vérifier.' })),
        h('section', { class: 'stack tight', id: 'bo-kyc-blocked-list' }, h('h2', null, 'Bloquées faute de pièce'),
          boTable([{ label: 'Boutique', get: function (x) { return h('a', { href: '#/bo/boutiques/' + x.shop_id }, x.shop); } },
            { label: 'Propriétaire', get: function (x) { return x.owner_name || '—'; } }, { label: 'Téléphone', get: function (x) { return x.owner_phone || '—'; } },
            { label: 'État', get: function (x) { return x.rejected ? boBadge('danger', 'Refusée') : boBadge('warn', 'Non envoyée'); } }],
            r.blocked, { href: function (x) { return '#/bo/boutiques/' + x.shop_id; }, empty: 'Aucune boutique bloquée.' }))]);
    }, function (e) { return boShell('identites', 'Identités', stateCard('!', 'Impossible de charger', errText(e))); });
  }
  function boStudio() {
    return Promise.all([api('fiila_bo_studio', {}), api('fiila_bo_studio_scenes', {}).catch(function () { return []; })]).then(function (both) {
      var d = both[0], scenes = both[1] || [];
      var sceneLabel = {}; scenes.forEach(function (c) { sceneLabel[c.id] = c.label; });
      var sReason = h('input', { type: 'text', id: 'bo-scene-reason', maxlength: 200, placeholder: 'Motif (journal)' });
      // Décors par catégorie (packs Aramis Studio, base privée XEL) : ce que les boutiques gardent, et l'interrupteur de chaque décor.
      var scenesBox = h('details', { class: 'card', id: 'bo-studio-scenes' }, h('summary', null, h('b', null, 'Décors par catégorie'),
        h('small', { class: 'muted' }, ' · ' + scenes.filter(function (c) { return c.active; }).length + ' actifs' +
          (scenes.some(function (c) { return c.alert; }) ? ' · ' + scenes.filter(function (c) { return c.alert; }).length + ' à revoir' : ''))),
        h('p', { class: 'small muted' }, 'Six décors visibles par boutique (ses favoris, puis au plus un candidat de la semaine), les autres dans « Plus de décors ». Une alerte demande une revue ; rien n’est retiré ni promu automatiquement.'),
        boCan('shops_write') ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Motif d’un changement'), sReason) : null,
        boTable([
          { label: 'Catégorie', get: function (x) { return x.category ? typeLabel(x.category) || x.category : 'Générique'; } },
          { label: 'Décor', get: function (x) { return h('span', { class: 'row', style: 'gap:6px' }, h('span', { class: 'sw', style: 'background:' + x.swatch + ';width:14px;height:14px;border-radius:50%;border:1px solid var(--line);display:inline-block' }), x.label); } },
          // Mesures par version et mode (28/10) : vues, livrées, pannes, rejets, gardées, partagées ; alerte = revue humaine.
          { label: 'Mesures', get: function (x) {
            var st = x.stats || [];
            if (!st.length) return '—';
            return h('span', { class: 'stack tight', style: 'gap:2px' }, st.map(function (m) {
              return h('small', { 'data-stat': x.id + ':' + m.mode },
                (m.mode === 'premium' ? 'Premium' : 'Fidèle') + ' v' + m.version + ' · ' + boNum(m.shown) + ' vues · ' + boNum(m.delivered) + ' livrées · ' +
                boNum(m.kept) + ' gardées' + (m.keep_rate != null ? ' (' + Math.round(m.keep_rate * 100) + ' %)' : '') + ' · ' + boNum(m.rejected) + ' rejets · ' +
                boNum(m.failed) + ' pannes · ' + boNum(m.shared) + ' partagées · ' + boNum(m.shops) + ' boutiques');
            }), x.alert ? boBadge('warn', 'À revoir : moins de 40 % gardées') : null);
          } },
          { label: 'Candidat', get: function (x) {
            if (!boCan('shops_write')) return x.candidate ? boBadge('info', 'Candidat') : '—';
            return h('button', { class: 'btn ghost small', type: 'button', 'data-candidate': x.id, onclick: function () {
              if (!sReason.value.trim()) { toast('Indiquez un motif.'); sReason.focus(); return; }
              boAct(function () { return api('fiila_bo_studio_scene_candidate', { p_id: x.id, p_candidate: !x.candidate, p_reason: sReason.value }); }, x.candidate ? 'Décor retiré des candidats.' : 'Décor proposé en candidat.', null, null, this);
            } }, x.candidate ? 'Retirer' : 'Proposer');
          }, cls: 'hide-s' },
          { label: '', get: function (x) {
            if (!boCan('shops_write')) return x.active ? boBadge('ok', 'Actif') : boBadge('muted', 'Coupé');
            return h('button', { class: 'btn ghost small', type: 'button', 'data-scene': x.id, onclick: function () {
              if (!sReason.value.trim()) { toast('Indiquez un motif.'); sReason.focus(); return; }
              boAct(function () { return api('fiila_bo_studio_scene_set', { p_id: x.id, p_active: !x.active, p_reason: sReason.value }); }, x.active ? 'Décor coupé.' : 'Décor activé.', null, null, this);
            } }, x.active ? 'Couper' : 'Activer');
          } }], scenes, { id: 'bo-studio-scenes-t', empty: 'Aucun décor.' }));
      var m = d.month || {}, spent = Number(d.spent_usd || 0), budget = Number(d.budget_usd || 0);
      var pct = budget ? Math.min(100, Math.round(spent / budget * 100)) : 100;
      var q = h('input', { type: 'search', id: 'bo-studio-shop', placeholder: 'Nom de la boutique', autocomplete: 'off' });
      var found = h('div', { id: 'bo-studio-found' }), chosen = null;
      var delta = h('input', { type: 'text', inputmode: 'numeric', id: 'bo-studio-delta', placeholder: 'Ex. : 10 ou -5' });
      var reason = h('input', { type: 'text', id: 'bo-studio-reason', maxlength: 200, placeholder: 'Motif (journal)' });
      q.addEventListener('input', function () {
        var v = q.value.trim(); chosen = null;
        if (v.length < 2) { setKids(found); return; }
        api('fiila_bo_shops', { p_q: v, p_filter: null, p_page: 0 }).then(function (r) {
          setKids(found, h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, (r.shops || []).slice(0, 6).map(function (x) {
            return h('button', { type: 'button', class: 'chip neutral', 'data-shop': x.id, onclick: function () { chosen = x; q.value = x.name; setKids(found, h('small', { class: 'muted' }, 'Boutique choisie : ' + x.name)); } }, x.name);
          })));
        }, function () {});
      });
      var grant = boCan('shops_write') ? h('section', { class: 'card stack tight', id: 'bo-studio-grant' }, h('h3', null, 'Accorder des crédits'),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Boutique'), q), found,
        h('div', { class: 'row', style: 'gap:8px' }, h('label', { class: 'field', style: 'flex:1' }, h('span', { class: 'lbl' }, 'Crédits'), delta),
          h('label', { class: 'field', style: 'flex:2' }, h('span', { class: 'lbl' }, 'Motif'), reason)),
        h('button', { class: 'btn', type: 'button', id: 'bo-studio-go', onclick: function () {
          var n = parseInt(String(delta.value).replace(/[^\d-]/g, ''), 10);
          if (!chosen) { toast('Choisissez une boutique.'); return; }
          if (!n) { toast('Indiquez un nombre de crédits.'); return; }
          if (!reason.value.trim()) { toast('Indiquez un motif.'); reason.focus(); return; }
          boAct(function () { return api('fiila_bo_studio_grant', { p_shop: chosen.id, p_delta: n, p_reason: reason.value }); }, 'Crédits mis à jour.', null, null, this);
        } }, 'Enregistrer')) : null;
      return boShell('studio', 'Studio', [
        h('p', { class: 'small', id: 'bo-studio-state' }, d.ready ? boBadge('ok', 'Ouvert') : boBadge('muted', 'Fermé'),
          ' Ouvert ou fermé, budget du mois et séries par boutique : Réglages (studio_ready, studio_budget_usd, studio_daily).'),
        d.fibo != null ? h('p', { class: 'small muted', id: 'bo-studio-engine' }, d.fibo
          ? 'Moteurs : FIBO 2.0 avec masque pour les bijoux, les plats et le premium des objets ; FIBO 2.0 sans masque pour les vêtements portés ; Bria pour le mode fidèle des autres catégories. Retour aux moteurs d’avant : Réglages (studio_fibo = 0).'
          : 'Moteurs d’avant : Bria (fidèle) et Nano Banana Pro (premium) ; FIBO coupé (studio_fibo = 0).') : null,
        h('div', { class: 'bo-kpis small' },
          h('div', { class: 'bo-kpi' }, h('strong', { id: 'bo-studio-spent' }, '$' + spent.toFixed(2)), h('span', null, 'dépensés ce mois sur $' + budget + ' (' + pct + ' %)' + (Number(d.reserved_usd) > 0 ? ', dont $' + Number(d.reserved_usd).toFixed(2) + ' réservés par les séries en cours' : ''))),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(m.series || 0)), h('span', null, 'séries')),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(m.kept || 0)), h('span', null, 'versions gardées')),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(m.failed || 0)), h('span', null, 'échecs')),
          m.charged_credits != null ? h('div', { class: 'bo-kpi', id: 'bo-studio-credits-kpi' }, h('strong', null, boNum(m.charged_credits)), h('span', null, 'crédits débités · ' + boNum(m.refunded_credits || 0) + ' rendus')) : null,
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(m.shops || 0)), h('span', null, 'boutiques'))),
        grant,
        scenesBox,
        h('h3', null, 'Crédits des boutiques'),
        boTable([
          { label: 'Boutique', get: function (x) { return h('a', { href: '#/bo/boutiques/' + x.shop_id }, x.shop); } },
          { label: 'Disponibles', get: function (x) { return boNum(x.credits) + (x.trial ? ' + ' + boNum(x.trial) + ' d’essai' : ''); } },
          { label: 'Réservés', get: function (x) { return boNum(x.reserved || 0); }, cls: 'hide-s' },
          { label: 'Mis à jour', get: function (x) { return boDate(x.updated_at); }, cls: 'hide-s' }], d.wallets || [], { id: 'bo-studio-wallets', empty: 'Aucun crédit accordé.' }),
        h('h3', null, 'Dernières séries'),
        boTable([
          { label: 'Boutique', get: function (x) { return h('span', { class: 'stack tight', style: 'gap:0' }, h('a', { href: '#/bo/boutiques/' + x.shop_id }, x.shop), h('small', { class: 'muted' }, x.product)); } },
          { label: 'Décor', get: function (x) { return (sceneLabel[x.style] || x.style) + (x.mode === 'premium' ? ' · premium' : ''); } },
          { label: 'Moteur', get: function (x) { return STUDIO_ENGINE[x.engine] || '—'; }, cls: 'hide-s' },
          { label: 'Crédits', get: function (x) { return x.charge === 'legacy' || !x.credits ? '—' : x.credits + ' ' + (STUDIO_CHARGE[x.charge] || x.charge) + (x.charge === 'refunded' && x.refund_reason ? ' (' + (STUDIO_REFUND[x.refund_reason] || x.refund_reason) + ')' : '') + (x.credit_from === 'trial' ? ' · essai' : ''); } },
          { label: 'Statut', get: function (x) { var t = STUDIO_ST[x.status] || ['muted', x.status]; return h('span', null, boBadge(t[0], t[1]), x.error ? h('small', { class: 'muted' }, ' ' + x.error) : null); } },
          { label: 'Coût', get: function (x) { return '$' + Number(x.cost_usd || 0).toFixed(2); }, cls: 'hide-s' },
          { label: 'Date', get: function (x) { return boDate(x.created_at); }, cls: 'hide-s' }], d.jobs || [], { id: 'bo-studio-jobs', empty: 'Aucune série pour le moment.' })
      ]);
    }, function (e) { return boShell('studio', 'Studio', stateCard('!', 'Chargement impossible', errText(e))); });
  }
  function boDomains() {
    return api('fiila_bo_domains', {}).then(function (d) {
      var ST = { pending: ['warn', 'En attente du DNS'], verifying: ['warn', 'Vérification'], active: ['ok', 'Actif'], failed: ['danger', 'Erreur'],
        expired: ['muted', 'Expiré'], disconnected: ['muted', 'Déconnecté'] };
      var reason = h('input', { type: 'text', id: 'bo-dom-reason', maxlength: 200, placeholder: 'Motif (journal)' });
      return boShell('domaines', 'Domaines', [
        d.enabled ? null : h('p', { class: 'notice' }, 'Domaines propres coupés (Réglages → custom_domains).'),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Motif d’une déconnexion'), reason),
        boTable([
          { label: 'Domaine', get: function (x) { return h('span', { class: 'stack tight', style: 'gap:0' }, h('b', { class: 'wrapword' }, x.hostname), x.last_error ? h('small', { style: 'color:var(--danger)' }, x.last_error) : null); } },
          { label: 'Boutique', get: function (x) { return h('a', { href: '#/bo/boutiques/' + x.shop_id }, x.shop + (x.plan === 'premium' ? '' : ' (gratuit)')); } },
          { label: 'Statut', get: function (x) { var t = ST[x.status] || ['muted', x.status]; return boBadge(t[0], t[1]); } },
          { label: 'Certificat', get: function (x) { return x.ssl_status || '—'; }, cls: 'hide-s' },
          { label: 'Depuis', get: function (x) { return boDate(x.verified_at || x.created_at); }, cls: 'hide-s' },
          { label: '', get: function (x) {
            if (['pending', 'verifying', 'active', 'failed'].indexOf(x.status) < 0) return x.ended_reason || '';
            return h('span', { class: 'row', style: 'gap:6px' },
              h('button', { class: 'btn ghost small', type: 'button', onclick: function () {
                var b = this; b.disabled = true;
                freshToken().then(function () { return fetch(API_URL + '/functions/v1/fiila-domains', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ action: 'sync', id: x.id }) }); })
                  .then(function (r) { return r.json(); }).then(function (o) { toast(o.configured === false ? 'Cloudflare pas encore relié.' : 'Revérifié.'); render(); }, function () { b.disabled = false; toast('Vérification impossible.'); });
              } }, 'Revérifier'),
              boCan('shops_write') ? h('button', { class: 'btn quiet danger-text small', type: 'button', onclick: function () {
                if (!reason.value.trim()) { toast('Indiquez un motif.'); reason.focus(); return; }
                boAct(function () { return api('fiila_bo_domain_action', { p_id: x.id, p_action: 'disconnect', p_reason: reason.value }); }, 'Domaine déconnecté.', function () {
                  freshToken().then(function () { return fetch(API_URL + '/functions/v1/fiila-domains', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ action: 'cleanup', id: x.id }) }); }).catch(function () {});
                  render();
                }, null, this);
              } }, 'Déconnecter') : null);
          } }], d.domains, { id: 'bo-domains', empty: 'Aucun domaine relié pour le moment.' })
      ]);
    }, function (e) { return boShell('domaines', 'Domaines', stateCard('!', 'Chargement impossible', errText(e))); });
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
            h('button', { class: 'btn', type: 'button', id: 'bo-unsuspend', onclick: function () { boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: 'unsuspend' }); }, 'Boutique réactivée. Elle peut remettre son site en ligne.', null, null, this); } }, 'Réactiver la boutique')]
          : [h('p', { class: 'small muted' }, 'La suspension met le site hors ligne et la retire du fil. La boutique ne peut pas le remettre en ligne elle-même.'),
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
      // Abonnement (22/10) : Gratuit / Premium, réglé à la main (aucun paiement en ligne) ; journalisé.
      var planSel = boCan('shops_write') ? h('select', { id: 'bo-shop-plan', 'aria-label': 'Abonnement', onchange: function (e) {
          var sel = e.target, val = sel.value;
          boAct(function () { return api('fiila_bo_shop_action', { p_id: id, p_action: 'set_plan', p_value: val }); }, val === 'premium' ? 'Abonnement Premium activé.' : 'Abonnement gratuit.',
            function () { s.plan = val; }, function () { sel.value = s.plan || 'free'; });
        } }, h('option', { value: 'free', selected: s.plan !== 'premium' || null }, 'Gratuit'), h('option', { value: 'premium', selected: s.plan === 'premium' || null }, 'Premium'))
        : (s.plan === 'premium' ? 'Premium' : 'Gratuit');
      var themeName = function (k) { var x = VT_THEMES.concat(VT_PREMIUM).filter(function (t) { return t[0] === k; })[0]; return x ? x[1] : k || 'Galerie'; };
      return boShell('boutiques', s.name, [
        boHero(s.name, [boShopState(s), s.rank ? boBadge('info', 'Fil · place ' + s.rank + (s.feed ? '' : ' (masquée)')) : null, s.type ? boBadge('muted', typeLabel(s.type)) : null],
          [s.slug ? '/b/' + s.slug : 'Site sans lien', s.phone, 'créée le ' + boDate(s.created_at)].filter(Boolean).join(' · ')),
        h('div', { class: 'bo-kpis small' },
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.products)), h('span', null, 'articles'), st.multi_photos ? h('small', { class: 'muted' }, boNum(st.multi_photos) + ' à plusieurs photos') : null,
            st.off_format ? h('small', { class: 'bo-warn', id: 'bo-shop-off-format' }, boNum(st.off_format) + ' hors format 4:5 (recadrées à la prochaine modification)') : null),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.orders)), h('span', null, 'commandes'), h('small', { class: 'muted' }, boNum(st.delivered) + ' livrées')),
          h('div', { class: 'bo-kpi' }, h('strong', null, fcfa(st.gmv)), h('span', null, 'volume livré')),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.customers)), h('span', null, 'clients')),
          h('div', { class: 'bo-kpi' }, h('strong', null, boNum(st.likes) + ' ♥'), h('span', null, boNum(st.comments) + ' commentaires'))),
        h('div', { class: 'bo-grid2' },
          h('section', { class: 'card stack tight', id: 'bo-shop-info' }, h('h2', null, 'Informations'),
            row('Site', s.slug ? h('a', { href: '#/b/' + s.slug }, '/b/' + s.slug) : '—'),
            row('Téléphone', s.phone || '—'),
            row('Type', typeSel),
            row('Abonnement', planSel),
            row('Modèle du site', themeName(s.shown_theme) + (s.theme !== s.shown_theme ? ' (choix « ' + themeName(s.theme) + ' » gardé, réservé Premium)' : '') + (s.has_logo ? ' · logo' : ' · sans logo')),
            row('Accès', s.access === 'account' ? 'Compte' : 'Clé du téléphone (sans compte)'),
            s.owner ? row('Propriétaire', h('a', { href: '#/bo/comptes/' + s.owner.id }, s.owner.email)) : null,
            s.ambassador ? row('Agent', s.ambassador) : null,
            row('Créée', boDate(s.created_at, true)),
            s.about ? row('Présentation', s.about) : null),
          actions),
        s.marketing ? h('section', { class: 'card stack tight', id: 'bo-shop-marketing' }, h('h2', null, 'Marketing · 30 jours'),
          row('Visites du site', boNum(s.marketing.views_30)),
          row('Commandes via le site', boNum(s.marketing.vitrine_orders_30)),
          row('Publications', boNum(s.marketing.posts_30)),
          row('Réseaux', s.marketing.socials ? h('span', null, SOCIALS.filter(function (o) { return s.marketing.socials[o[0]]; }).map(function (o, i) {
            return [i ? ' · ' : null, h('a', { href: socialUrl(o[0], s.marketing.socials[o[0]]), target: '_blank', rel: 'noopener noreferrer' }, o[1] + ' @' + s.marketing.socials[o[0]])];
          })) : '—')) : null,
        boShopTeam(s, id),
        boCan('shops_write') && !s.platform ? boShopIdentity(id) : null,
        boShopAudience(id),
        boShopSheet(id),
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
            (o.payments || []).map(function (p) { return h('p', { class: 'small muted' }, boDate(p.at, true) + ' · ' + fcfa(p.amount) + ' · ' + (({ cash: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', card: 'Carte', other: 'Autre' })[p.method] || p.method)); }))),
        boOrderEvents(o.id)
      ], { back: ['#/bo/commandes', 'Commandes'] });
    }, function (e) { return boShell('commandes', 'Commande', stateCard('!', 'Commande introuvable', errText(e)), { back: ['#/bo/commandes', 'Commandes'] }); });
  }
  // Historique d'une commande (audit du 27/10) : changements d'état, paiements ajoutés ou supprimés, par la boutique ou un compte.
  var BO_ORDER_STATE = { open: 'En cours', delivered: 'Livrée', cancelled: 'Annulée' };
  function boOrderEvents(id) {
    var box = h('section', { class: 'card stack tight', id: 'bo-order-events' }, h('h2', null, 'Historique'), loading());
    api('fiila_bo_order_events', { p_order: id }).then(function (l) {
      setKids(box, h('h2', null, 'Historique'), l.length ? h('ul', { class: 'small', style: 'margin:0;padding-left:18px' }, l.map(function (e) {
        var what = e.kind === 'status' ? (BO_ORDER_STATE[e.from] || e.from) + ' → ' + (BO_ORDER_STATE[e.to] || e.to)
          : (e.kind === 'payment_add' ? 'Paiement ajouté : ' : 'Paiement supprimé : ') + fcfa(e.amount || 0) + (e.method ? ' (' + e.method + ')' : '');
        return h('li', null, boDate(e.at, true) + ' · ' + what + ' · par ' + (e.actor === 'compte' ? 'un compte' : 'la boutique'));
      })) : h('p', { class: 'small muted' }, 'Aucun changement depuis la création (journal tenu depuis le 28/10).'));
    }, function (e) { setKids(box, h('h2', null, 'Historique'), h('p', { class: 'small muted' }, errText(e))); });
    return box;
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
      var byAmb = {}; d.to_pay.forEach(function (r) { var k = r.ambassador + '|' + r.payout_method + '|' + r.payout_phone + '|' + (r.payout_verified ? 1 : 0); (byAmb[k] = byAmb[k] || []).push(r); });
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
                p[3] === '1' ? null : h('span', { class: 'small' }, boBadge('warn', 'Numéro non confirmé par SMS'), ' L’agent le confirme depuis son espace.'),
                l.map(function (r) { return h('span', { class: 'small' }, r.shop + ' · niveau ' + r.level + ' · ' + fcfa(r.amount)); }),
                h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', disabled: p[3] === '1' ? null : true, onclick: function () {
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
          if (['suspend', 'exclude', 'reinstate'].indexOf(decision) >= 0 && !note.value.trim()) { toast('Indiquez un motif.'); note.focus(); return; }
          if (ask && window.confirm && !window.confirm(ask)) return;
          boAmbDecide(a, decision, note.value, this, okText);
        } }, label);
      }
      var acts = [];
      if (a.status === 'review') acts.push(btn('approve', 'Valider le profil', '', null, 'Profil validé.'), btn('exclude', 'Refuser', 'quiet danger-text', 'Refuser ' + a.name + ' ? Son profil sera exclu.', 'Inscription refusée.'));
      if (a.status === 'active') acts.push(btn('suspend', 'Suspendre', 'ghost', 'Suspendre ' + a.name + ' ? Ses nouveaux gains sont mis en pause.', 'Agent suspendu.'));
      if (a.status === 'suspended') acts.push(btn('reactivate', 'Réactiver', '', null, 'Agent réactivé.'));
      if (['review', 'active', 'suspended'].indexOf(a.status) >= 0) acts.push(btn('training', 'Renvoyer en formation', 'ghost', a.name + ' devra refaire la formation et le test. Continuer ?', 'Renvoyé en formation.'));
      if (['training', 'active', 'suspended'].indexOf(a.status) >= 0) acts.push(btn('exclude', 'Exclure', 'quiet danger-text', 'Exclure ' + a.name + ' ? Les gains non versés seront annulés.', 'Agent exclu.', 'exclude2'));
      if (a.status === 'excluded') acts.push(btn('reinstate', 'Réintégrer', 'ghost', 'Réintégrer ' + a.name + ' ? Le profil passe en « suspendu » ; la réactivation reste une seconde décision. Les gains annulés ne reviennent pas d’eux-mêmes.', 'Agent réintégré (suspendu).'));
      // Historique de l'agent : décisions et gains (journal du serveur), gains annulés à rétablir un par un, avec motif.
      var hist = h('section', { class: 'card stack tight', id: 'bo-amb-history' }, h('h2', null, 'Historique'), loading());
      api('fiila_bo_ambassador_history', { p_id: a.id }).then(function (x) {
        setKids(hist, h('h2', null, 'Historique'),
          x.cancelled.length ? h('div', { class: 'stack tight', id: 'bo-amb-cancelled' }, h('p', { class: 'eyebrow' }, 'Gains annulés'),
            x.cancelled.map(function (r) {
              var why = h('input', { type: 'text', maxlength: 200, placeholder: 'Motif du rétablissement', 'aria-label': 'Motif du rétablissement', style: 'max-width:200px' });
              return h('div', { class: 'item', id: 'bo-rw-' + r.id }, h('span', { class: 'small wrapword', style: 'flex:1' }, r.shop + ' · niveau ' + r.level + ' · ' + fcfa(r.amount) + (r.reason ? ' · ' + r.reason : '')),
                a.status === 'excluded' ? null : [why, h('button', { class: 'btn ghost small', type: 'button', onclick: function () {
                  if (!why.value.trim()) { toast('Indiquez un motif.'); why.focus(); return; }
                  boAct(function () { return api('fiila_admin_reward', { p_ids: [r.id], p_action: 'restore', p_reason: why.value }); }, 'Gain rétabli.', null, null, this);
                } }, 'Rétablir')]);
            }), a.status === 'excluded' ? h('p', { class: 'small muted' }, 'Réintégrez d’abord l’agent pour rétablir un gain.') : null) : null,
          x.events.length ? h('ul', { class: 'stack tight bo-hist' }, x.events.map(function (e) {
            return h('li', { class: 'small' }, h('span', { class: 'muted' }, boDate(e.at, true) + ' · ' + boActor(e.actor) + ' '), boActionLabel(e.action, e.detail));
          })) : h('p', { class: 'small muted' }, 'Aucune décision enregistrée pour cet agent.'));
      }, function (e) { setKids(hist, h('h2', null, 'Historique'), h('p', { class: 'small muted' }, errText(e))); });
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
            row('Versements', [(PAYOUT[a.payout_method] || a.payout_method) + ' ' + a.payout_phone + ' ', a.payout_verified ? boBadge('ok', 'confirmé par SMS') : boBadge('warn', 'non confirmé')]),
            row('Inscrit', boDate(a.created_at, true)), row('Validé', a.approved_at ? boDate(a.approved_at, true) : '—'),
            row('Test', a.quiz_score != null ? a.quiz_score + '/10 · ' + (a.attempts || 0) + ' essai(s)' : (a.attempts ? a.attempts + ' essai(s), pas encore réussi' : 'pas encore passé')),
            a.note ? row('Note', a.note) : null),
          h('section', { class: 'card stack tight', id: 'bo-amb-actions' }, h('h2', null, 'Actions'),
            acts.length ? [h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Motif ou note'), note), h('div', { class: 'row' }, acts)]
              : h('p', { class: 'small muted' }, 'Rien à décider pour l’instant.'))),
        hist,
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
        var steps = [['Nom et type', su['name:done']], ['Premier article', su['product:done']], ['Site en ligne', su['vitrine:open']], ['Partage WhatsApp touché', su['share:click']]];
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
        var ad = d.adaptive;
        if (!ad) return null;
        var hr = ad.hero || {}, pf = ad.pref || {}, rs = ad.resume || {};
        function q(o, k) { return boNum(Number(o[k] || 0)); }
        var now = Date.now(), day = 864e5;
        // Aperçu sur cas fictifs : même fonction que l'application (adaptPick), paramètres en vigueur.
        var cases = [
          ['Nouvel utilisateur, rien fait', {}, null],
          ['3 événements créés en 10 jours', { evenement: [now - 9 * day, now - 4 * day, now - day] }, null],
          ['Ouvre « Demander » 6 fois sans rien envoyer', {}, null],
          ['2 adresses et 2 demandes réussies (la demande plus récente)', { adresse: [now - 6 * day, now - 5 * day], demander: [now - 3 * day, now - 2 * day] }, null],
          ['A épinglé « Livreur »', { adresse: [now - 2 * day, now - day] }, 'livreur']];
        return h('div', { class: 'stack tight', id: 'bo-adaptive' },
          h('div', { class: 'bo-panel-h' }, h('h3', null, 'Accueil adaptatif (UX-ADAPTATIVE-001)'), ad.on ? boBadge('ok', 'Actif · ' + ad.version) : boBadge('muted', 'Coupé (Réglages) · règle d’avant')),
          h('p', { class: 'small muted' }, 'Le bouton principal apprend des tâches réussies, pas des écrans ouverts. Paramètres (hypothèses) : demi-vie ' + ADAPT.halfLife + ' j, bonus de répétition ' + ADAPT.bonus + ', seuil ' + ADAPT.threshold + ', fenêtre ' + ADAPT.windowDays + ' j. 30 derniers jours, installations observées :'),
          boTable([
            { label: 'Bouton principal', get: function (x) { var sv = svcOf(x); return sv ? sv.hero : x; } },
            { label: 'Vu', get: function (x) { return q(hr, x + ':shown'); }, cls: 'num' },
            { label: 'Touché', get: function (x) { return q(hr, x + ':click'); }, cls: 'num' },
            { label: 'Tâche réussie ensuite', get: function (x) { return q(hr, x + ':success'); }, cls: 'num' }], SUCC_SVC, { id: 'bo-adaptive-table' }),
          h('p', { class: 'small', id: 'bo-adaptive-pref' }, '« Mettre en premier » : ' + q(pf, 'pin') + ' · retour au choix automatique : ' + q(pf, 'unpin') + ' · remises à zéro : ' + q(pf, 'reset') +
            '. Reprises en haut de Ma boutique : commande vue ' + q(rs, 'order:shown') + ', reprise ' + q(rs, 'order:click') + ', enregistrée ' + q(rs, 'order:success') +
            ' · article vu ' + q(rs, 'product:shown') + ', repris ' + q(rs, 'product:click') + ', enregistré ' + q(rs, 'product:success') + '.'),
          h('details', { id: 'bo-adaptive-preview' }, h('summary', null, 'Aperçu sur 5 cas fictifs'),
            h('ul', { class: 'small', style: 'margin:8px 0 0;padding-left:18px' }, cases.map(function (c) {
              var p = adaptPick(c[1], c[2], {}, c[0].indexOf('Demander') >= 0 ? { demander: 6 } : {}, now);
              return h('li', null, c[0] + ' → ' + (p ? svcOf(p.svc).hero + (p.why === 'pin' ? ' (épinglé)' : '') : 'Créer mon adresse (par défaut)'));
            }))));
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
          h('p', { class: 'small', id: 'bo-publish-line' }, 'Publier un article (cartes et logos, 23/10) : Instagram ' + m('publish:instagram') + ' · Facebook ' + m('publish:facebook') +
            ' · statut WhatsApp ' + m('publish:whatsapp') + ' · TikTok ' + m('publish:tiktok') + ' · Snapchat ' + m('publish:snapchat') +
            ' · partage envoyé au téléphone ' + m('publish:shared') + ' · image à enregistrer (sans partage) ' + m('publish:saved') + '.'),
          h('p', { class: 'small', id: 'bo-premium-line' }, 'Modèles Premium (30 jours) : ' + VT_PREMIUM.map(function (t) {
            var pm = d.premium || {}; function q(a) { return boNum(Number(pm[t[0] + ':' + a] || 0)); }
            return t[1] + ' — touché verrouillé ' + q('locked') + ', aperçu ' + q('preview') + ', « Je veux ce modèle » ' + q('interest') + ', appliqué ' + q('applied');
          }).join(' · ') + '. Boutiques Premium : ' + boNum(d.premium_shops || 0) + '.'),
          h('p', { class: 'small', id: 'bo-site-line' }, (function () {
            var st = d.site || {}; function c(k) { return boNum(Number(st[k] || 0)); }
            return 'Sites des boutiques (Fii Édition V1, 30 jours) : fiche article ouverte ' + c('sheet:open') + ' · ajout depuis la fiche ' + c('sheet:add') +
              ' · guide des tailles ' + c('guide:open') + ' · « Complétez le look » touché ' + c('look:click') + ' · rubriques Nouveautés ' + c('tab:new') +
              ', catégorie ' + c('tab:cat') + ', Promos ' + c('tab:promos') + '. Nombre d’articles du look : réglage « site_look ».';
          })()),
          h('p', { class: 'small', id: 'bo-settings-line' }, (function () {
            var st = d.settings_ui || {}, su = d.studio_ui || {}; function c(o, k) { return boNum(Number(o[k] || 0)); }
            function sum(o, re) { return boNum(Object.keys(o).filter(function (k) { return re.test(k); }).reduce(function (n, k) { return n + Number(o[k] || 0); }, 0)); }
            return 'Réglages v2 (30 jours) : bouton « Compléter » ' + sum(st, /^cta:/) + ' (site ' + c(st, 'cta:site') + ', article ' + c(st, 'cta:product') + ', logo ' + c(st, 'cta:logo') +
              ', couverture ' + c(st, 'cta:cover') + ', livraison ' + c(st, 'cta:policies') + ', propriétaire ' + c(st, 'cta:owner') + ') · tuiles ' + sum(st, /^tile:/) +
              ' · « Partager mon site » ' + c(st, 'share') + '. Studio v2 : Fidèle ' + c(su, 'mode:fidele') + ' · Premium ' + c(su, 'mode:premium') + ' · comparaison ' + c(su, 'compare') +
              ' · « Publier » après « Bravo » ' + c(su, 'publish') + ' · « Terminé » ' + c(su, 'finish') + '.';
          })()),
          h('p', { class: 'small', id: 'bo-app-line' }, 'App mobile (ouvertures, 30 jours) : Android ' + boNum(Number((d.app_opens || {}).android || 0)) +
            ' · iPhone ' + boNum(Number((d.app_opens || {}).ios || 0)) + '.'),
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
  var NUDGE_LABEL = { home_shop: 'Accueil → créer sa boutique', shop_more_products: 'Boutique → ajouter des articles', shop_share_vitrine: 'Boutique → partager le site',
    shop_courier: 'Boutique → inviter un livreur', shop_team: 'Boutique → ajouter un membre', shop_photos: 'Boutique → plusieurs photos',
    addr_photo: 'Mon adresse → photo de l’entrée', addr_mark: 'Mon adresse → repère écrit ou vocal' };
  // Messages WhatsApp (mandat WHATSAPP-001) : registre des modèles, aperçu de la carte, mesures du partage, état Meta saisi à la main.
  var WA_META = { NOT_SUBMITTED: 'Non soumis', SUBMITTED: 'Soumis à Meta', APPROVED: 'Approuvé', REJECTED: 'Refusé', PAUSED: 'En pause' };
  var WA_INTEG = { TO_IMPLEMENT: 'À intégrer', MANUAL_PILOT: 'Pilote (partage manuel)', MANUAL: 'Partage manuel', API: 'API' };
  function boWaPanel(d) {
    if (!d) return null;
    var sh = d.shares || {};
    function n(k) { return Number(sh['request:' + k] || 0); }
    function c(card, k) { return Number(sh[card + ':' + k] || 0); }
    var CARD_ROWS = [['request', 'Demande d’adresse'], ['address', 'Mon adresse'], ['event', 'Événement'], ['vitrine', 'Site (Marketing)']];
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
  // Croissance → Suggestions (rétention lot 1, v2 validée le 22/10 19:20). Nombres bruts, « installations observées »,
  // 7 derniers jours = fenêtre de succès incomplète. Interrupteur par suggestion (droit « settings », journalisé).
  function boNudgePanel(d) {
    if (!d) return null;
    var canSet = boCan('settings');
    var rows = d.suggestions || [];
    function v(x, k) { return Number((x.d30 || {})[k] || 0); }
    function sw(x) {
      if (!canSet) return x.on ? 'Active' : 'Coupée';
      return h('select', { 'aria-label': 'Suggestion ' + (NUDGE_LABEL[x.id] || x.id), 'data-sugg': x.id, onchange: function (e) {
        var sel = e.target, val = Number(sel.value);
        api('fiila_bo_setting_set', { p_key: 'sugg_' + x.id, p_value: val }).then(function () { toast(val ? 'Suggestion activée.' : 'Suggestion coupée.'); x.on = !!val; },
          function (err) { sel.value = x.on ? '1' : '0'; toast(errText(err)); });
      } }, h('option', { value: '1', selected: x.on || null }, 'Active'), h('option', { value: '0', selected: !x.on || null }, 'Coupée'));
    }
    var oa = d.order_address || {};
    return h('section', { class: 'card stack tight bo-panel', id: 'bo-nudges' },
      h('div', { class: 'bo-panel-h' }, h('h2', null, 'Suggestions'), d.on ? boBadge('ok', 'Actives') : boBadge('muted', 'Toutes coupées (Réglages)')),
      h('p', { class: 'small muted' }, 'Une exposition par session, deux au plus sur 7 jours par téléphone ; comptée seulement si la carte est vue. Un clic n’est jamais un usage : « Succès » = état réel relu sous 7 jours (article ajouté, visite du site, livreur invité, article à plusieurs photos, membre invité, boutique créée, photo ou repère enregistré sur l’adresse où la suggestion a été vue). 30 derniers jours, installations observées (pas des personnes ni des boutiques uniques).'),
      boTable([
        { label: 'Suggestion', get: function (x) { return NUDGE_LABEL[x.id] || x.id; } },
        { label: 'Vues', get: function (x) { return boNum(v(x, 'shown')); }, cls: 'num' },
        { label: 'Clics', get: function (x) { return boNum(v(x, 'click')); }, cls: 'num' },
        { label: 'Refus', get: function (x) { return boNum(v(x, 'dismiss')); }, cls: 'num' },
        { label: 'Succès ≤ 7 j', get: function (x) { return boNum(v(x, 'used')); }, cls: 'num' },
        { label: 'Répétés', get: function (x) { return boNum(v(x, 'repeat')); }, cls: 'num' },
        { label: 'État', get: sw }], rows, { id: 'bo-sugg-table' }),
      h('p', { class: 'small muted', id: 'bo-sugg-window' }, 'Fenêtre incomplète : ' + boNum(rows.reduce(function (n, x) { return n + Number((x.d7 || {}).shown || 0); }, 0)) +
        ' vue(s) des 7 derniers jours ont encore le temps d’aboutir à un succès.'),
      h('p', { class: 'small', id: 'bo-order-address' }, 'Commandes sans adresse (tâche de la commande, hors budget) : carte vue ' + boNum(oa.shown || 0) + ' fois, adresse redemandée ' + boNum(oa.used || 0) +
        ' fois (30 jours) ; adresses reçues pour des commandes sur 30 jours : ' + boNum(oa.received_30 || 0) + ' ; commandes ouvertes en attente maintenant : ' + boNum(oa.waiting_now || 0) + '.'),
      h('details', { id: 'bo-sugg-preview' }, h('summary', null, 'Aperçu des cartes'),
        h('div', { class: 'stack tight', style: 'margin-top:10px;max-width:420px' }, NUDGE_IDS.map(function (id) {
          var t = RET_TEXT[id];
          return h('aside', { class: 'nudge2' }, h('span', { class: 'nudge2-ic', 'aria-hidden': 'true' }, icon(t.icon, 18)),
            h('div', { class: 'nudge2-t' }, h('b', null, t.title), h('span', null, t.text), h('span', { class: 'nudge2-cta' }, t.cta, icon('chev', 14))));
        }))),
      d.items && d.items.length ? h('details', null, h('summary', null, 'Ancienne mesure (avant le 22/10)'),
        boTable([{ label: 'Suggestion', get: function (x) { return NUDGE_LABEL[x.id] || x.id; } }, { label: 'Vue', get: function (x) { return boNum(x.shown); }, cls: 'num' },
          { label: 'Suivie', get: function (x) { return boNum(x.click); }, cls: 'num' }, { label: 'Plus tard', get: function (x) { return boNum(x.dismiss); }, cls: 'num' }], d.items, {})) : null);
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
              textField({ id: 'inv-shop', label: 'Lien de son site Fii', optional: true, max: 40, placeholder: 'Ex. : maison-diallo', onInput: function (v) { f.shop_slug = v.replace(/^.*#\/b\//, '').trim(); } }),
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
            ms ? h('div', { class: 'bo-ms', 'aria-label': 'Jalons' }, [['configured', 'Boutique'], ['first_product', '1er article'], ['storefront', 'Site en ligne'], ['orders', 'Commande'], ['delivered', 'Livrée'], ['returned', 'Retour']].map(function (k) {
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
          { label: 'État', get: function (p) { return p.suspended ? boBadge('danger', 'Suspendue') : !p.public ? boBadge('muted', 'Site hors ligne') : !p.feed ? boBadge('warn', 'Masquée du fil') : boBadge('ok', 'Visible'); } },
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
    domain_disconnect: 'a déconnecté le domaine', studio_scene: 'a modifié le décor Studio', studio_grant: 'a modifié les crédits Studio de', kyc_view: 'a consulté la pièce d’identité de la boutique', kyc_verified: 'a validé la pièce d’identité de la boutique', kyc_rejected: 'a refusé la pièce d’identité de la boutique', ambassador_suspended: 'a suspendu un agent', ambassador_excluded: 'a exclu un agent', ambassador_reinstated: 'a réintégré un agent', reward_restored: 'a rétabli un gain d’agent', ambassador_training: 'a renvoyé un agent en formation', ambassador_deleted: 'a supprimé le profil agent de',
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
    media_cdn: ['Photos servies par le stockage (adresse fixe, mise en cache)', '0 = servies par la base, 1 = stockage'],
    custom_domains: ['Domaines propres des boutiques Premium (Site Pro)', '0 = coupés, 1 = ouverts'],
    shop_subdomains: ['Adresses <lien>.getfii.app des boutiques', '0 = coupées, 1 = ouvertes'],
    studio_ready: ['Fii Studio ouvert aux boutiques', '0 = fermé, 1 = ouvert (après la clé du fournisseur)'],
    studio_budget_usd: ['Budget mensuel du Studio', 'USD (au-delà, le Studio se met en pause)'],
    studio_daily: ['Séries Studio par boutique et par jour', 'séries'],
    studio_premium: ['Mode Studio premium (rendu de studio hyperréaliste)', '0 = coupé, 1 = proposé'], studio_premium_credits: ['Crédits pour garder une version Studio premium', 'crédits'],
    studio_fibo: ['Moteur FIBO 2.0 du Studio (bijoux, plats, premium)', '1 = FIBO, 0 = retour à Bria et Nano Banana Pro'],
    kyc_required: ['Pièce d’identité exigée après la première vente', '0 = non exigée, 1 = exigée (nouvelles commandes bloquées sans pièce)'],
    site_look: ['« Complétez le look » sur la fiche article', 'Nombre d’articles de la même boutique proposés (0 = masqué, 6 au plus)'] };
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
    if (/^reward_/.test(a) && d.amount) txt += ' (' + fcfa(d.amount) + (d.level ? ', niveau ' + d.level : '') + ')';
    if (/^(reward_|ambassador_)/.test(a) && (d.reason || d.note)) txt += ' : ' + (d.reason || d.note);
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
      h('p', { class: 'small muted' }, 'Photos d’articles et couvertures de site. Copiées : ' + boNum(m.copied) + ' (' + mb + ' Mo) · en attente : ' + boNum(m.pending) +
        ' · dernière copie : ' + (m.last_run ? shortDate(m.last_run) + ' ' + new Date(m.last_run).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'jamais') +
        '. Les photos de porte et les repères vocaux restent dans la base, jamais publics.'),
      m.thumbs != null ? h('p', { class: 'small muted', id: 'bo-media-thumbs' }, 'Miniatures des grilles (640 px) : ' + boNum(m.thumbs) + ' (' +
        Math.round(Number(m.thumb_bytes || 0) / 1024) + ' Ko) · à faire : ' + boNum(m.thumbs_pending) + '. Photos PNG ou WebP : pas de miniature, la photo d’origine est affichée.') : null,
      m.purged != null ? h('p', { class: 'small muted', id: 'bo-media-purge' }, 'Copies retirées de la base : ' + boNum(m.purged) + ' · reste dans la base : ' +
        Math.round(Number(m.db_bytes || 0) / 1024) + ' Ko' + (m.purge_on ? '' : ' (retrait arrêté : media_purge = 0)') +
        '. Une copie n’est retirée qu’après vérification du fichier en ligne, identique octet pour octet.') : null,
      (m.errors || []).length ? h('ul', { class: 'small', id: 'bo-media-errors' }, m.errors.map(function (e) { return h('li', null, shortDate(e.at) + ' · ' + (e.ref || '') + ' · ' + (e.detail || '')); })) : null,
      m.ready ? h('button', { class: 'btn ghost small', type: 'button', id: 'bo-media-run', onclick: function (ev) {
        var b = ev.currentTarget; b.disabled = true; status.textContent = 'Copie en cours…';
        fetch(API_URL + '/functions/v1/fiila-media-sync', { method: 'POST', headers: apiHeaders(), body: '{}' }).then(function (r) { return r.json(); }).then(function (x) {
          b.disabled = false; status.textContent = x && x.ok ? (x.copied + ' copiée(s), ' + (x.thumbs != null ? x.thumbs + ' miniature(s), ' : '') + (x.purged != null ? x.purged + ' retirée(s) de la base, ' : '') + x.failed + ' échec(s), ' + x.removed + ' retirée(s).') : 'Copie impossible pour le moment.';
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

  return { viewBo: viewBo };
};
