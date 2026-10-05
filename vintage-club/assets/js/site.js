/* Vintage Club · site.js
   Aprimoramento progressivo: todo o conteúdo já está no HTML. Este arquivo só adiciona
   comportamento (ticket, menu, vídeos, perguntas, mapa) e movimento (GSAP, ScrollTrigger, SplitText, Lenis). */
(function () {
  'use strict';

  var d = document, w = window, html = d.documentElement;
  var introPending = html.classList.contains('js-intro');
  html.classList.add('ready');

  var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = w.matchMedia && w.matchMedia('(hover: none)').matches;
  var G = w.gsap, ST = w.ScrollTrigger, Split = w.SplitText;
  var hasG = !!(G && ST);
  if (hasG) {
    G.registerPlugin(ST);
    if (Split) G.registerPlugin(Split);
    html.classList.add('gsap');
    ST.config({ ignoreMobileResize: true });
  }

  /* hash com que a pessoa chegou; se ela mexer na página antes do load, não a levamos de volta */
  var arrivalHash = w.location.hash, userMoved = false;
  function moved() { userMoved = true; }
  ['wheel', 'touchstart', 'keydown'].forEach(function (t) { w.addEventListener(t, moved, { passive: true, once: true }); });

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function headH() { var h = $('.head'); return h ? h.offsetHeight : 64; }
  function brl(v) { return 'R$ ' + Number(v).toLocaleString('pt-BR'); }
  function showIntro() { html.classList.remove('js-intro'); }
  function refreshST(delay) { if (hasG) setTimeout(function () { ST.refresh(); }, delay || 0); }
  function fontsLoading() { return !!(d.fonts && d.fonts.status === 'loading'); }

  /* ------------------------------------------------------------------
     Scroll suave (Lenis) integrado ao ScrollTrigger
  ------------------------------------------------------------------ */
  var lenis = null;
  if (hasG && w.Lenis && !reduce) {
    try {
      lenis = new w.Lenis({ lerp: 0.11, smoothWheel: true });
      lenis.on('scroll', ST.update);
      G.ticker.add(function (t) { lenis.raf(t * 1000); });
      G.ticker.lagSmoothing(0);
    } catch (err) { lenis = null; }
  }
  function goTo(y, instant) {
    y = Math.max(0, Math.round(y));
    if (lenis) { lenis.scrollTo(y, instant ? { immediate: true, force: true } : { duration: 1.2, force: true }); return; }
    w.scrollTo(instant || reduce ? { top: y } : { top: y, behavior: 'smooth' });
  }
  /* posição de um descendente no documento, sem contar transformações (o ticket entra com transform) */
  function layoutTop(el, upTo) {
    var t = 0, n = el;
    while (n && n !== upTo) { t += n.offsetTop; n = n.offsetParent; }
    return t;
  }

  function scrollToEl(el, instant) {
    if (!el) return;
    var off = headH() + 12;
    if (el.id === 'ficha' && el.parentNode) {
      /* mede pelo invólucro, que não se move */
      var wrap = el.parentNode;
      var top = wrap.getBoundingClientRect().top + w.pageYOffset - off;
      /* celular e tablet: o total e o botão "Enviar pelo WhatsApp" ficam na tela, acima da borda */
      var wa = $('#t-wa', el);
      if (w.innerWidth < 1024 && wa) {
        var waBottom = wrap.getBoundingClientRect().top + w.pageYOffset + layoutTop(wa, wrap) + wa.offsetHeight;
        top = Math.max(top, waBottom - (w.innerHeight - 16));
      }
      goTo(top, instant);
      return;
    }
    goTo(el.getBoundingClientRect().top + w.pageYOffset - off, instant);
  }

  /* ------------------------------------------------------------------
     Menu em tela cheia (celular e tablet): trava o scroll, prende o foco,
     deixa o resto da página inerte e fecha com Esc ou ao tocar num link
  ------------------------------------------------------------------ */
  var menu = $('#menu'), menuBtn = $('#menu-btn');
  var menuLbl = menuBtn ? $('.menu-btn-l', menuBtn) : null;
  var inertEls = [$('#conteudo'), $('.foot'), $('.quick'), $('.skip'), $('.brand'), $('.rail')];

  function setInert(on) {
    inertEls.forEach(function (el) {
      if (!el) return;
      if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); if (!el.classList.contains('rail')) el.removeAttribute('aria-hidden'); }
    });
  }
  function menuFocusables() { return [menuBtn].concat($$('a[href], button', menu)); }
  function onMenuKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
    if (e.key !== 'Tab') return;
    var f = menuFocusables(), i = f.indexOf(d.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
  function openMenu() {
    if (!menu || !menu.hidden) return;
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    if (menuLbl) menuLbl.textContent = 'Fechar';
    html.classList.add('is-locked');
    setInert(true);
    if (lenis) lenis.stop();
    if (hasG && !reduce) {
      G.killTweensOf(menu);
      G.fromTo(menu, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.75, ease: 'expo.out' });
      G.fromTo($$('.menu-nav li', menu), { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.05, delay: 0.08 });
      G.fromTo($('.menu-foot', menu), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.35, ease: 'power2.out' });
    }
    d.addEventListener('keydown', onMenuKey);
    var first = $('.menu-nav a', menu);
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu(returnFocus) {
    if (!menu || menu.hidden) return;
    menuBtn.setAttribute('aria-expanded', 'false');
    if (menuLbl) menuLbl.textContent = 'Menu';
    html.classList.remove('is-locked');
    setInert(false);
    if (lenis) lenis.start();
    d.removeEventListener('keydown', onMenuKey);
    var done = function () { menu.hidden = true; if (hasG) G.set(menu, { clearProps: 'clipPath' }); };
    if (hasG && !reduce) {
      G.killTweensOf(menu);
      G.to(menu, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.45, ease: 'power3.in', onComplete: done });
    } else done();
    if (returnFocus) menuBtn.focus({ preventScroll: true });
  }
  if (menu && menuBtn) {
    menuBtn.addEventListener('click', function () { if (menu.hidden) openMenu(); else closeMenu(true); });
    var mqDesk = w.matchMedia('(min-width: 1024px)');
    var onDesk = function (e) { if (e.matches) closeMenu(false); };
    if (mqDesk.addEventListener) mqDesk.addEventListener('change', onDesk);
  }

  /* Âncoras: rolam com offset do cabeçalho (Lenis quando ativo) */
  d.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id.length < 2) return;
    var t = d.getElementById(id.slice(1));
    if (!t) return;
    e.preventDefault();
    userMoved = true;
    var wasOpen = menu && !menu.hidden;
    if (wasOpen) closeMenu(false);
    setTimeout(function () { scrollToEl(t); }, wasOpen ? 40 : 0);
    if (w.history && history.replaceState) history.replaceState(null, '', id);
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    try { t.focus({ preventScroll: true }); } catch (err) { /* sem foco */ }
  });

  /* ------------------------------------------------------------------
     Foco pelo teclado nunca fica embaixo do que é fixo: cabeçalho, barra de
     filtros grudada, barra do celular ou pílula do ticket (WCAG 2.4.11).
     Um bloco que ainda ia aparecer com animação aparece na hora.
  ------------------------------------------------------------------ */
  (function focusGuard() {
    var kbd = false;
    d.addEventListener('keydown', function (e) { if (e.key === 'Tab') kbd = true; }, true);
    d.addEventListener('pointerdown', function () { kbd = false; }, true);
    d.addEventListener('focusin', function (e) {
      var el = e.target;
      if (!kbd || !el || el === d.body || !el.getBoundingClientRect) return;
      if (el.closest('.head, .menu, .mbar, .pill, .controls') || (el.closest('.gal-track') && el.closest('.is-pinned'))) return;
      var wait = el.closest('.rv-wait');
      if (wait && w.gsap) { wait.classList.remove('rv-wait'); w.gsap.killTweensOf(wait); w.gsap.set(wait, { clearProps: 'transform,opacity' }); }
      w.requestAnimationFrame(function () {
        var r = el.getBoundingClientRect();
        if (!r.height) return;
        var top = headH() + 8, bottom = w.innerHeight - 8;
        var ctl = $('#controls'), mb = $('#mbar'), pl = $('#pill');
        if (ctl && el.closest('.svc-main') && getComputedStyle(ctl).position === 'sticky') {
          var cb = ctl.getBoundingClientRect();
          if (cb.top <= headH() + 1) top = Math.max(top, cb.bottom + 8);
        }
        if (mb && mb.offsetHeight && getComputedStyle(mb).position === 'fixed' && !mb.classList.contains('is-away')) bottom = Math.min(bottom, mb.getBoundingClientRect().top - 8);
        if (pl && !pl.hidden && pl.offsetHeight) bottom = Math.min(bottom, pl.getBoundingClientRect().top - 8);
        var dy = 0;
        if (r.top < top) dy = r.top - top;
        else if (r.bottom > bottom) dy = Math.min(r.bottom - bottom, r.top - top);
        if (dy) goTo(w.pageYOffset + dy, true);
      });
    });
  })();

  /* ------------------------------------------------------------------
     Palavras que se alternam no título do hero + cota que mede a palavra.
     Uma volta completa (cerca de 10 s) e para em "rosto."; também para
     quando a pessoa pausa o vídeo da capa (pausa o movimento decorativo).
  ------------------------------------------------------------------ */
  var heroInView = true;
  (function swapWords() {
    var swap = $('.swap');
    if (!swap || reduce) { html.classList.remove('swap-on'); return; }
    var words = $$('.swap-w', swap), cota = $('.swap-cota', swap);
    if (words.length < 2) { html.classList.remove('swap-on'); return; }
    html.classList.add('swap-on');
    var i = 0, turns = 0, timer = null;
    function measure() { if (cota) cota.style.setProperty('--cw', Math.round(words[i].offsetWidth) + 'px'); }
    function first() { words[0].classList.add('is-on'); setTimeout(measure, 380); }
    function next() {
      if (d.hidden || !heroInView || html.classList.contains('motion-paused')) return;
      var cur = words[i];
      i = (i + 1) % words.length;
      var nx = words[i];
      cur.classList.remove('is-on');
      cur.classList.add('is-out');
      nx.style.transition = 'none';
      nx.classList.remove('is-out');
      void nx.offsetWidth;
      nx.style.transition = '';
      nx.classList.add('is-on');
      measure();
      turns++;
      if (i === 0 && turns >= words.length) clearInterval(timer);
    }
    /* com a capa já à mostra (sem GSAP ou intro perdida), a primeira palavra fica onde está */
    if (hasG && introPending) setTimeout(first, 380); else first();
    timer = setInterval(next, 2600);
    w.addEventListener('resize', measure);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(measure);
    var hero = $('.hero');
    if (hero && 'IntersectionObserver' in w) {
      new IntersectionObserver(function (es) { heroInView = es[0].isIntersecting; }).observe(hero);
    }
  })();

  /* ------------------------------------------------------------------
     Transferidor do trilho: 0° no topo, 90° no fim da página.
     As posições das seções ficam em cache (só leituras baratas por quadro).
  ------------------------------------------------------------------ */
  (function rail() {
    var secs = $$('main [data-label]');
    var needle = $('#rail-needle'), sweep = $('#rail-sweep'), deg = $('#rail-deg');
    var railN = $('#rail-n'), railL = $('#rail-l');
    var miniN = $('#mini-needle'), miniD = $('#mini-deg');
    var navLinks = $$('.nav a');
    var NAV = { metodo: '#metodo', servicos: '#servicos', equipe: '#equipe', formacao: '#formacao', agendar: '#agendar', contato: '#contato' };
    var last = -1, lastTxt = '', queued = false, tops = [], maxS = 1, vh = w.innerHeight, cached = false;
    function measure() {
      var y = w.pageYOffset;
      tops = secs.map(function (s) { return s.getBoundingClientRect().top + y; });
      vh = w.innerHeight;
      maxS = Math.max(1, html.scrollHeight - vh);
      cached = true;
    }
    function update() {
      queued = false;
      if (!cached) measure();
      /* leituras */
      var y = lenis ? lenis.scroll : w.pageYOffset;
      var p = Math.min(1, Math.max(0, y / maxS));
      var mid = y + vh * 0.42, idx = 0;
      for (var k = 0; k < tops.length; k++) { if (tops[k] <= mid) idx = k; }
      /* escritas */
      var a = p * 90, r = a * Math.PI / 180;
      var txt = Math.round(a) + '°';
      if (needle) needle.setAttribute('transform', 'rotate(' + (-a).toFixed(2) + ' 12 12)');
      if (sweep) sweep.setAttribute('d', 'M12 12L12 108A96 96 0 0 0 ' + (12 + Math.sin(r) * 96).toFixed(2) + ' ' + (12 + Math.cos(r) * 96).toFixed(2) + 'Z');
      if (miniN) miniN.setAttribute('transform', 'rotate(' + (-a).toFixed(2) + ' 3 3)');
      if (txt !== lastTxt) { lastTxt = txt; if (deg) deg.textContent = txt; if (miniD) miniD.textContent = txt; }
      if (idx !== last && secs[idx]) {
        last = idx;
        if (railN) railN.textContent = 'Folha ' + (idx + 1 < 10 ? '0' : '') + (idx + 1);
        if (railL) railL.textContent = secs[idx].getAttribute('data-label');
        var href = NAV[secs[idx].id] || '';
        navLinks.forEach(function (l) { l.classList.toggle('is-active', l.getAttribute('href') === href); });
      }
    }
    function onScroll() { if (!queued) { queued = true; w.requestAnimationFrame(update); } }
    function remeasure() { cached = false; onScroll(); }
    w.addEventListener('scroll', onScroll, { passive: true });
    w.addEventListener('resize', remeasure);
    w.addEventListener('load', remeasure);
    if ('ResizeObserver' in w) new ResizeObserver(remeasure).observe(d.body);
    else w.addEventListener('scroll', function () { cached = false; }, { passive: true });
    if (hasG) ST.addEventListener('refresh', remeasure);
    update();
  })();

  /* ------------------------------------------------------------------
     Vídeos: só começam depois do load (e nunca com dados reduzidos ou
     movimento reduzido), pausam fora da tela, um toca por vez, botão de pausa
  ------------------------------------------------------------------ */
  (function videos() {
    var vids = $$('video[data-vid]');
    if (!vids.length) return;
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    var lowData = !!(conn && (conn.saveData || /(^|-)2g$|^3g$/.test(conn.effectiveType || '')));
    var loaded = d.readyState === 'complete';
    var ratio = [];
    vids.forEach(function (v, i) {
      ratio[i] = 0;
      v._user = !!(reduce || lowData);   /* nada toca sozinho com movimento ou dados reduzidos */
      v.muted = true;
      v.removeAttribute('autoplay');
      if (v._user && !v.paused) v.pause();
    });
    function play(v) {
      if (v.preload !== 'auto') v.preload = 'auto';
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    }
    function sync() {
      if (!loaded) return;
      var best = -1, br = 0;
      vids.forEach(function (v, i) { if (!v._user && ratio[i] > 0.2 && ratio[i] > br) { best = i; br = ratio[i]; } });
      vids.forEach(function (v, i) {
        if (i === best && !d.hidden) { if (v.paused) play(v); }
        else if (!v.paused) v.pause();
      });
    }
    if (!loaded) w.addEventListener('load', function () { loaded = true; sync(); });
    if ('IntersectionObserver' in w) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { var i = vids.indexOf(e.target); if (i > -1) ratio[i] = e.isIntersecting ? e.intersectionRatio : 0; });
        sync();
      }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
      vids.forEach(function (v) { io.observe(v); });
    } else { ratio[0] = 1; }
    d.addEventListener('visibilitychange', sync);
    $$('[data-vid-btn]').forEach(function (b) {
      var v = d.getElementById(b.getAttribute('data-vid-btn'));
      if (!v) return;
      var lbl = $('span', b);
      function paint() {
        b.setAttribute('data-paused', v._user ? 'true' : 'false');
        if (lbl) lbl.textContent = v._user ? 'Reproduzir vídeo' : 'Pausar vídeo';
      }
      b.addEventListener('click', function () {
        v._user = !v._user;
        if (!v._user) {
          var i = vids.indexOf(v);
          vids.forEach(function (o, k) { if (k !== i && !o.paused) o.pause(); });
          ratio[i] = Math.max(ratio[i], 0.21);
          loaded = true;
        }
        /* pausar o vídeo da capa também pausa a régua corrida e a troca de palavras */
        if (v.id === 'vid-hero') html.classList.toggle('motion-paused', v._user);
        paint();
        sync();
      });
      paint();
    });
    sync();
  })();

  /* ------------------------------------------------------------------
     Serviços & valores: comprimento, filtros, comparativo, ticket, WhatsApp
  ------------------------------------------------------------------ */
  (function services() {
    var sec = $('#servicos'), board = $('#board');
    if (!sec || !board) return;
    var WA = 'https://wa.me/556132578428?text=';
    var BASE = 'Olá! Vim pelo site e gostaria de agendar na Vintage Club.';
    var LENS = ['curto', 'médio', 'longo'];
    var CMP = { 'cm-al': [80, 120, 150], 'cm-eq': [60, 80, 100], 'cf-al': [120, 150, 180], 'ci-eq': [60, 80, 100] };
    var CMP_MAX = 180;
    var rows = $$('.svc', board);
    var radios = $$('.lens [role="radio"]');
    var chips = $$('.chip');
    var controls = $('#controls'), svcMain = $('.svc-main', sec), chipBox = $('.chips', sec);
    var ficha = $('#ficha'), foot = $('.foot');
    var list = $('#t-list'), totalEl = $('#t-total'), waBtn = $('#t-wa'), live = $('#t-live'), countEl = $('#board-count');
    var pill = $('#pill'), pillN = $('#pill-n'), pillT = $('#pill-t');
    var mbar = $('#mbar'), mbarBtn = $('#mbar-btn'), mbarL = $('#mbar-l'), mbarN = $('#mbar-n'), mbarT = $('#mbar-t'), mbarWa = $('#mbar-wa');
    var cmpLen = $('#cmp-len'), cmpDim = $('#cmp-dim'), cmpDiff = $('#cmp-diff');
    var cmpBars = $$('.cmp-bar[data-k]'), cmpVals = $$('.cmp-v[data-k]');
    var picked = [], cur = 1, newId = null, shownTotal = 0, fichaVisible = false, footVisible = false;

    rows.forEach(function (r, i) { r.style.setProperty('--d', i); });

    /* altura da barra de filtros fixa: o valor focado pelo teclado para abaixo dela */
    if (controls && 'ResizeObserver' in w) {
      new ResizeObserver(function () {
        var sticky = getComputedStyle(controls).position === 'sticky';
        html.style.setProperty('--ctl-h', (sticky ? controls.offsetHeight : 0) + 'px');
      }).observe(controls);
    }
    /* chips que rolam no celular: o degradê da borda some no fim */
    if (chipBox) {
      var chipEnd = function () { chipBox.classList.toggle('is-end', chipBox.scrollLeft + chipBox.clientWidth >= chipBox.scrollWidth - 4); };
      chipBox.addEventListener('scroll', chipEnd, { passive: true });
      w.addEventListener('resize', chipEnd);
      chipEnd();
    }

    function countTo(el, from, to, pre, suf) {
      if (!el) return;
      pre = pre || ''; suf = suf || '';
      var token = (el._count || 0) + 1;
      el._count = token;                       /* uma contagem nova cancela a anterior */
      if (reduce || from === to) { el.textContent = pre + to.toLocaleString('pt-BR') + suf; return; }
      var t0 = null, dur = 650;
      function step(t) {
        if (el._count !== token) return;
        if (t0 === null) t0 = t;
        var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = pre + Math.round(from + (to - from) * e).toLocaleString('pt-BR') + suf;
        if (k < 1) w.requestAnimationFrame(step);
      }
      w.requestAnimationFrame(step);
    }
    function pct(v) { return (v / CMP_MAX * 100).toFixed(3) + '%'; }

    function setLen(i, focus) {
      var prev = cur;
      cur = i;
      sec.setAttribute('data-len', String(i));
      radios.forEach(function (b, k) {
        var on = k === i;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      if (cmpLen) cmpLen.textContent = LENS[i];
      cmpBars.forEach(function (b) { var k = b.getAttribute('data-k'); if (CMP[k]) b.style.width = pct(CMP[k][i]); });
      cmpVals.forEach(function (v) { var k = v.getAttribute('data-k'); if (CMP[k]) countTo(v, CMP[k][prev], CMP[k][i], 'R$ '); });
      var al = CMP['cm-al'][i], eq = CMP['cm-eq'][i];
      if (cmpDim) { cmpDim.style.left = pct(eq); cmpDim.style.width = ((al - eq) / CMP_MAX * 100).toFixed(3) + '%'; }
      countTo(cmpDiff, CMP['cm-al'][prev] - CMP['cm-eq'][prev], al - eq, '+ R$ ');
    }
    var lens = $('.lens');
    if (lens) {
      lens.addEventListener('click', function (e) {
        var b = e.target.closest('[role="radio"]');
        if (b && +b.getAttribute('data-i') !== cur) setLen(+b.getAttribute('data-i'));
      });
      lens.addEventListener('keydown', function (e) {
        var k = e.key, n = cur;
        if (k === 'ArrowRight' || k === 'ArrowDown') n = (cur + 1) % 3;
        else if (k === 'ArrowLeft' || k === 'ArrowUp') n = (cur + 2) % 3;
        else if (k === 'Home') n = 0;
        else if (k === 'End') n = 2;
        else return;
        e.preventDefault();
        setLen(n, true);
      });
    }

    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        var f = c.getAttribute('data-f'), n = 0;
        /* com a barra grudada no topo, a lista filtrada recomeça logo abaixo dela */
        var hh = headH();
        var stuck = controls && getComputedStyle(controls).position === 'sticky' && Math.abs(controls.getBoundingClientRect().top - hh) <= 1;
        chips.forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
        rows.forEach(function (r) {
          var show = f === 'all' || r.getAttribute('data-cat') === f;
          r.classList.remove('is-in');
          r.hidden = !show;
          if (show) { r.style.setProperty('--d', n); n++; }
        });
        if (!reduce) {
          void board.offsetWidth;
          rows.forEach(function (r) { if (!r.hidden) r.classList.add('is-in'); });
        }
        if (countEl) countEl.textContent = 'Mostrando ' + n + ' de ' + rows.length + ' serviços';
        if (stuck && svcMain) goTo(svcMain.getBoundingClientRect().top + w.pageYOffset - hh, true);
        refreshST(0);
      });
    });

    function announce(t) { if (live) { live.textContent = ''; setTimeout(function () { live.textContent = t; }, 40); } }
    function pulse(el) {
      if (!el || reduce) return;
      el.classList.remove('is-pulse');
      void el.offsetWidth;
      el.classList.add('is-pulse');
    }

    var lastTotal = { total: 0, consult: false };
    /* rótulo curto (pílula, ticket): "R$ 180 +" */
    function totalLabel() {
      if (!lastTotal.total && lastTotal.consult) return 'a consultar';
      return brl(lastTotal.total) + (lastTotal.consult ? ' +' : '');
    }
    /* rótulo por extenso (mensagem e leitor de tela): "R$ 180 + itens a consultar" */
    function totalLong(sep) {
      if (!lastTotal.total && lastTotal.consult) return 'a consultar';
      return brl(lastTotal.total) + (lastTotal.consult ? sep + 'itens a consultar' : '');
    }

    board.addEventListener('click', function (e) {
      var pc = e.target.closest('.pc');
      if (!pc) return;
      var row = pc.closest('.svc'), id = row.getAttribute('data-id');
      var was = pc.getAttribute('aria-pressed') === 'true';
      $$('.pc', row).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      var idx = -1, item = null;
      picked.forEach(function (p, k) { if (p.id === id) idx = k; });
      if (was) {
        if (idx > -1) picked.splice(idx, 1);
        row.classList.remove('is-picked');
      } else {
        pc.setAttribute('aria-pressed', 'true');
        row.classList.add('is-picked');
        item = { id: id, name: row.getAttribute('data-name'), len: pc.getAttribute('data-len'), v: pc.getAttribute('data-v') === '' ? null : +pc.getAttribute('data-v') };
        if (idx > -1) picked[idx] = item; else picked.push(item);
        newId = id;
      }
      render();
      var tot = picked.length ? ' Total estimado: ' + totalLong(' mais ') + '.' : ' O ticket está vazio.';
      if (item) announce(item.name + (item.len ? ' (' + item.len.toLowerCase() + ')' : '') + ' entrou no ticket.' + tot);
      else announce(row.getAttribute('data-name') + ' saiu do ticket.' + tot);
      if (!was) { pulse(mbarBtn); pulse(pill); }
    });

    function remove(id, li) {
      function go() {
        picked = picked.filter(function (p) { return p.id !== id; });
        var row = board.querySelector('.svc[data-id="' + id + '"]');
        if (row) {
          row.classList.remove('is-picked');
          $$('.pc', row).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        }
        render();
        announce('Serviço removido. ' + (picked.length ? 'Total estimado: ' + totalLong(' mais ') + '.' : 'O ticket está vazio.'));
        var nextBtn = $('.t-rm', list);
        if (nextBtn) nextBtn.focus(); else { var lnk = $('.ficha-empty a', list); if (lnk) lnk.focus(); }
      }
      if (hasG && !reduce && li) {
        li.style.overflow = 'hidden';
        G.to(li, { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0, duration: 0.35, ease: 'power2.inOut', onComplete: go });
      } else go();
    }

    function render() {
      var total = 0, consult = false;
      list.innerHTML = '';
      if (!picked.length) {
        list.innerHTML = '<li class="ficha-empty">Nenhum serviço ainda. Em <a href="#servicos">Serviços &amp; valores</a>, toque no valor do que você quer fazer.</li>';
      }
      picked.forEach(function (p) {
        if (p.v === null) consult = true; else total += p.v;
        var li = d.createElement('li');
        if (p.id === newId && !reduce) li.className = 'is-new';
        var nm = d.createElement('span'); nm.className = 't-name'; nm.textContent = p.name;
        var val = d.createElement('span'); val.className = 't-val'; val.textContent = p.v === null ? 'a consultar' : brl(p.v);
        var meta = d.createElement('span'); meta.className = 't-meta'; meta.textContent = p.len ? p.len : 'Valor único';
        var rm = d.createElement('button'); rm.type = 'button'; rm.className = 't-rm'; rm.textContent = 'Remover';
        rm.setAttribute('aria-label', 'Remover ' + p.name + ' do ticket');
        rm.addEventListener('click', function () { remove(p.id, li); });
        li.appendChild(nm); li.appendChild(val); li.appendChild(meta); li.appendChild(rm);
        list.appendChild(li);
      });
      newId = null;
      lastTotal = { total: total, consult: consult };
      var onlyConsult = !total && consult;
      var tt = totalLabel();
      var ttCap = onlyConsult ? 'A consultar' : tt;
      if (onlyConsult) {
        totalEl._count = (totalEl._count || 0) + 1;
        totalEl.textContent = ttCap;
      } else {
        countTo(totalEl, shownTotal, total, 'R$ ', consult ? ' +' : '');
      }
      totalEl.classList.toggle('is-txt', onlyConsult);
      shownTotal = total;
      totalEl.setAttribute('data-final', ttCap);
      var n = picked.length, lbl = n + (n === 1 ? ' serviço' : ' serviços');
      var msg = BASE;
      if (n) {
        msg += '\n\nServiços:\n' + picked.map(function (p) {
          return '• ' + p.name + (p.len ? ' (' + p.len.toLowerCase() + ')' : '') + ' – ' + (p.v === null ? 'a consultar' : brl(p.v));
        }).join('\n') + '\n\nTotal estimado: ' + totalLong(' + ');
      }
      var href = WA + encodeURIComponent(msg);
      waBtn.href = href;
      if (ficha) ficha.classList.toggle('has-items', n > 0);
      if (pillN) pillN.textContent = lbl;
      if (pillT) pillT.textContent = ttCap;
      if (mbar) mbar.classList.toggle('has-items', n > 0);
      if (mbarBtn) mbarBtn.setAttribute('href', n ? '#ficha' : '#agendar');
      if (mbarL) mbarL.textContent = n ? 'Ver ticket' : 'Agendar horário';
      if (mbarN) mbarN.textContent = n ? ' · ' + lbl : '';
      if (mbarT) mbarT.textContent = n ? ttCap : '';
      if (mbarWa) {
        mbarWa.href = href;
        mbarWa.setAttribute('aria-label', n ? 'Enviar o ticket pelo WhatsApp' : 'Agendar pelo WhatsApp');
      }
      paintPill();
    }

    /* pílula (tablet e desktop): some com o ticket ou o rodapé na tela;
       barra do celular: some com o ticket na tela, que já tem os botões */
    function paintPill() {
      if (mbar) mbar.classList.toggle('is-away', fichaVisible);
      if (!pill) return;
      var show = picked.length > 0 && !fichaVisible && !footVisible;
      html.classList.toggle('has-pill', show);
      if (show && pill.hidden) {
        pill.hidden = false;
        if (hasG && !reduce) G.fromTo(pill, { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: 'expo.out', clearProps: 'transform,opacity,visibility' });
      } else if (!show && !pill.hidden) {
        pill.hidden = true;
      }
    }
    if ('IntersectionObserver' in w) {
      /* o ticket conta como visível com um quarto dele na tela ou com o canhoto (total e botões) na tela */
      var stub = ficha && $('.ficha-stub', ficha), seen = { f: false, s: false };
      if (ficha) new IntersectionObserver(function (es) { seen.f = es[0].isIntersecting; fichaVisible = seen.f || seen.s; paintPill(); }, { threshold: 0.25 }).observe(ficha);
      if (stub) new IntersectionObserver(function (es) { seen.s = es[0].isIntersecting; fichaVisible = seen.f || seen.s; paintPill(); }, { threshold: 0.6 }).observe(stub);
      if (foot) new IntersectionObserver(function (es) { footVisible = es[0].isIntersecting; paintPill(); }, { rootMargin: '0px 0px -40px 0px' }).observe(foot);
    }
    render();
  })();

  /* ------------------------------------------------------------------
     Perguntas frequentes: acordeão acessível; respostas fechadas ficam com
     hidden="until-found", então a busca do navegador (Ctrl+F) abre a resposta
  ------------------------------------------------------------------ */
  (function faq() {
    var items = $$('.faq-item');
    var untilFound = 'onbeforematch' in d.body;
    function setQA(q, a, open, anim, quiet) {
      q.setAttribute('aria-expanded', open ? 'true' : 'false');
      var inner = a.firstElementChild;
      var refresh = function () { if (!quiet) refreshST(0); };
      if (open) {
        a.removeAttribute('hidden');
        if (anim && hasG && !reduce && inner) {
          G.fromTo(inner, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.55, ease: 'expo.out', onComplete: function () { G.set(inner, { clearProps: 'height,opacity' }); refresh(); } });
        } else refresh();
      } else {
        var shut = function () {
          if (untilFound) a.setAttribute('hidden', 'until-found'); else a.hidden = true;
          if (hasG && inner) G.set(inner, { clearProps: 'height,opacity' });
          refresh();
        };
        if (anim && hasG && !reduce && inner) G.to(inner, { height: 0, opacity: 0, duration: 0.4, ease: 'power3.inOut', onComplete: shut });
        else shut();
      }
    }
    items.forEach(function (it, i) {
      var q = $('.faq-q', it), a = $('.faq-a', it);
      if (!q || !a) return;
      setQA(q, a, i === 0, false, true);           /* estado inicial: sem recalcular o ScrollTrigger */
      q.addEventListener('click', function () { setQA(q, a, q.getAttribute('aria-expanded') !== 'true', true); });
      a.addEventListener('beforematch', function () { setQA(q, a, true, false); });
    });
  })();

  /* ------------------------------------------------------------------
     Copiar telefone e mapa do Google sob demanda
  ------------------------------------------------------------------ */
  (function copyPhone() {
    var b = $('#copy-fone'), live = $('#copy-live');
    if (!b) return;
    var lbl = $('span', b), timer = null;
    function done() {
      b.classList.add('is-done');
      if (lbl) lbl.textContent = 'Copiado';
      if (live) live.textContent = 'Telefone (61) 3257-8428 copiado.';
      clearTimeout(timer);
      timer = setTimeout(function () { b.classList.remove('is-done'); if (lbl) lbl.textContent = 'Copiar'; }, 2000);
    }
    function fallback() {
      var el = $('#fone');
      if (el) { var r = d.createRange(); r.selectNodeContents(el); var s = w.getSelection(); s.removeAllRanges(); s.addRange(r); }
      var ok = false;
      try { ok = d.execCommand && d.execCommand('copy'); } catch (err) { ok = false; }
      if (ok) { done(); return; }
      if (live) live.textContent = 'Telefone selecionado. Use copiar do seu aparelho.';
    }
    b.addEventListener('click', function () {
      try { navigator.clipboard.writeText('(61) 3257-8428').then(done, fallback); }
      catch (err) { fallback(); }
    });
  })();

  (function mapToggle() {
    var b = $('#map-btn'), box = $('#planta-box');
    if (!b || !box) return;
    var frame = null, svg = $('.planta-svg', box);
    b.addEventListener('click', function () {
      if (!frame) {
        frame = d.createElement('iframe');
        frame.src = 'https://www.google.com/maps?q=SIND%20Qi%2001%2C%20Lote%201700%2C%20Gama%2C%20Bras%C3%ADlia%20-%20DF&output=embed';
        frame.title = 'Mapa da Vintage Club no Google Maps';
        frame.setAttribute('loading', 'lazy');
        frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        box.appendChild(frame);
        if (svg) svg.setAttribute('aria-hidden', 'true');
        b.textContent = 'Ver a ficha do endereço';
        return;
      }
      frame.hidden = !frame.hidden;
      if (svg) { if (frame.hidden) svg.removeAttribute('aria-hidden'); else svg.setAttribute('aria-hidden', 'true'); }
      b.textContent = frame.hidden ? 'Mostrar o mapa aqui' : 'Ver a ficha do endereço';
    });
  })();

  /* ------------------------------------------------------------------
     Equipe no toque: a foto que passa pelo centro da tela ganha cor
  ------------------------------------------------------------------ */
  (function teamTouch() {
    if (!touch || !('IntersectionObserver' in w)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle('is-color', e.isIntersecting); });
    }, { rootMargin: '-38% 0px -38% 0px' });
    $$('.member').forEach(function (m) { io.observe(m); });
  })();

  /* ------------------------------------------------------------------
     Etapas do método: etapa ativa calculada pela posição (robusto a saltos).
     No celular e no tablet a prancha fica grudada no topo; a linha de leitura
     começa abaixo dela, onde o texto da etapa está de fato visível.
  ------------------------------------------------------------------ */
  var stick = $('.plate-stick'), stickBottom = 0;
  function measureStick() {
    stickBottom = (w.innerWidth < 1024 && stick && getComputedStyle(stick).position === 'sticky') ? headH() + stick.offsetHeight : 0;
  }
  function stepLine() {
    var H = w.innerHeight;
    return stickBottom ? stickBottom + (H - stickBottom) * 0.35 : H * 0.62;
  }
  var setStepFromScroll = (function steps() {
    var stepsEl = $('.steps'), svg = $('.plate');
    if (!stepsEl) return function () {};
    var steps = $$('.step', stepsEl), tag = $('#plate-step');
    var names = ['Leitura', 'Corte', 'Detalhe'], curStep = -1;
    function setStep(i) {
      if (i === curStep) return;
      curStep = i;
      steps.forEach(function (s, k) { s.classList.toggle('is-dim', k !== i); });
      if (tag) tag.textContent = 'Etapa ' + (i + 1) + ' · ' + names[i];
      if (svg) svg.setAttribute('data-step', String(i + 1));
    }
    function fromScroll() {
      var line = stepLine(), idx = 0;
      steps.forEach(function (s, k) { if (s.getBoundingClientRect().top <= line) idx = k; });
      setStep(idx);
    }
    if (reduce || !hasG) return function () {};
    measureStick();
    w.addEventListener('resize', measureStick);
    var q = false;
    w.addEventListener('scroll', function () { if (!q) { q = true; w.requestAnimationFrame(function () { q = false; fromScroll(); }); } }, { passive: true });
    fromScroll();
    return fromScroll;
  })();

  /* ------------------------------------------------------------------
     Movimento (GSAP). Sem GSAP ou com movimento reduzido: página estática e completa.
  ------------------------------------------------------------------ */
  if (!hasG) { showIntro(); return; }
  if (reduce) { showIntro(); return; }

  var END = 'max';

  /* Revelação ao entrar na tela com um IntersectionObserver por grupo (sem um
     ScrollTrigger por elemento). O que já ficou para trás aparece sem animar. */
  function onReveal(els, cb, line) {
    if (!els.length) return;
    if (!('IntersectionObserver' in w)) { els.forEach(function (el) { cb([el], false); }); return; }
    var io = new IntersectionObserver(function (es) {
      var now = [], past = [];
      es.forEach(function (e) {
        var bottom = e.rootBounds ? e.rootBounds.bottom : w.innerHeight * line;
        if (e.isIntersecting) now.push(e.target);
        else if (e.boundingClientRect.top < bottom) past.push(e.target);
        else return;
        io.unobserve(e.target);
      });
      if (past.length) cb(past, false);
      if (now.length) {
        now.sort(function (a, b) { return a.compareDocumentPosition(b) & 4 ? -1 : 1; });
        cb(now, true);
      }
    }, { rootMargin: '0px 0px -' + Math.round((1 - line) * 100) + '% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }
  function rise(sel, vars, line) {
    var els = $$(sel);
    if (!els.length) return;
    var y = (vars && vars.y) || 28, dur = (vars && vars.duration) || 1.1;
    G.set(els, { y: y, opacity: 0 });
    els.forEach(function (el) { el.classList.add('rv-wait'); });
    onReveal(els, function (batch, anim) {
      batch.forEach(function (el) { el.classList.remove('rv-wait'); });
      if (!anim) { G.set(batch, { clearProps: 'transform,opacity' }); return; }
      G.to(batch, { y: 0, opacity: 1, duration: dur, ease: 'expo.out', stagger: 0.08, overwrite: 'auto', clearProps: 'transform,opacity' });
    }, line || 0.9);
  }

  function whenFonts(cb) {
    var called = false;
    function go() { if (!called) { called = true; cb(); } }
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(go);
    setTimeout(go, 700);
  }

  whenFonts(function () {
    var mm = G.matchMedia();

    /* ---------- Entrada orquestrada da capa ----------
       Se o timer de segurança do <head> já mostrou a capa (rede lenta), não reanima. */
    (function heroIntro() {
      if (!introPending || !html.classList.contains('js-intro')) { showIntro(); return; }
      var tl = G.timeline({ defaults: { ease: 'expo.out' } });
      var canSplit = Split && !fontsLoading();
      var split = null, lines = $$('.hero-t-a'), chars = $$('.mast-t > *');
      if (canSplit) {
        split = new Split('.hero-t-a', { type: 'lines', mask: 'lines' }); lines = split.lines;
        /* o nome (aria-hidden) fica dividido em letras: reverter criaria um novo candidato a LCP */
        chars = new Split('.mast-t .mast-a, .mast-t .mast-b', { type: 'chars' }).chars;
      }
      tl.from('.hero-meta', { clipPath: 'inset(0% 100% 0% 0%)', duration: 1.2, ease: 'expo.inOut' }, 0)
        .from('.mast-cota', { scaleX: 0, transformOrigin: '50% 50%', duration: 1.1, ease: 'expo.inOut' }, 0.1)
        .from('.mast-cota-l', { opacity: 0, y: 6, duration: 0.7 }, 0.75)
        .from(chars, { yPercent: 55, opacity: 0, duration: 1.1, stagger: canSplit ? 0.04 : 0.12 }, 0.12)
        .from(lines, { yPercent: canSplit ? 110 : 30, opacity: canSplit ? 1 : 0, duration: 1.1, stagger: 0.08 }, 0.4)
        .from('.hero-frame', { clipPath: 'inset(100% 0% 0% 0%)', duration: 1.2, ease: 'expo.inOut' }, 0.3)
        .fromTo('.hero-frame', { '--g': '46px' }, { '--g': '8px', duration: 1.4, ease: 'expo.out', onComplete: function () { var f = $('.hero-frame'); if (f) f.style.removeProperty('--g'); } }, 0.45)
        .from('.hero-cota', { scaleY: 0, transformOrigin: '50% 0%', duration: 1.2, ease: 'expo.inOut' }, 0.6)
        .from('.hero-fig figcaption', { opacity: 0, y: 10, duration: 0.8 }, 0.9)
        .from('[data-intro="up"]', { y: 24, opacity: 0, duration: 1, stagger: 0.08 }, 0.55)
        .from('.rail-pro', { autoAlpha: 0, x: -20, duration: 1 }, 0.3)
        .from('.rail-sheet', { autoAlpha: 0, duration: 0.8 }, 0.5)
        .from('.hero-rating .stars svg', { scale: 0, rotation: -70, transformOrigin: '50% 50%', duration: 0.8, ease: 'back.out(2.4)', stagger: 0.08 }, 0.95);
      tl.eventCallback('onComplete', function () {
        if (split) split.revert();
        G.set('.hero-meta, .hero-frame, .hero-cota, .mast-cota', { clearProps: 'clipPath,transform' });
        G.set(lines.concat(chars), { clearProps: 'transform,opacity' });
      });
      showIntro();
    })();

    /* ---------- Régua corrida: acelera e inverte com o scroll; pausa no hover ---------- */
    (function rulerSpeed() {
      var ruler = $('.ruler'), track = ruler && $('.ruler-track', ruler), set = ruler && $('.ruler-set', ruler);
      if (!track || !set) return;
      var x = 0, dir = 1, boost = 0, curY = w.pageYOffset, lastY = curY, width = set.offsetWidth, on = true, hover = false;
      if ('IntersectionObserver' in w) new IntersectionObserver(function (es) { on = es[0].isIntersecting; }).observe(ruler);
      if (!lenis) w.addEventListener('scroll', function () { curY = w.pageYOffset; }, { passive: true });
      w.addEventListener('resize', function () { width = set.offsetWidth; });
      ruler.addEventListener('mouseenter', function () { hover = true; });
      ruler.addEventListener('mouseleave', function () { hover = false; });
      G.ticker.add(function (time, dt) {
        if (!on || !width) return;
        var y = lenis ? lenis.scroll : curY, dy = y - lastY;
        lastY = y;
        if (hover || html.classList.contains('motion-paused')) return;
        if (dy) dir = dy > 0 ? 1 : -1;
        boost += (Math.min(Math.abs(dy), 40) - boost) * 0.08;
        x -= (0.6 + boost * 0.45) * dir * (dt / 16.67);
        if (x <= -width) x += width;
        if (x > 0) x -= width;
        track.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
      });
    })();

    /* ---------- Títulos: linhas sobem por trás de uma máscara ----------
       A divisão em linhas é feita na hora de revelar, na largura e com a fonte do momento. */
    (function titles() {
      var els = $$('.sh-t, .step-t, .slide-q p, .cmp-t');
      G.set(els, { opacity: 0 });
      onReveal(els, function (batch, anim) {
        batch.forEach(function (el, k) {
          if (!anim) { G.set(el, { clearProps: 'opacity' }); return; }
          if (Split && !fontsLoading()) {
            var split = new Split(el, { type: 'lines', mask: 'lines' });
            G.set(el, { clearProps: 'opacity' });
            G.from(split.lines, { yPercent: 110, duration: 1.15, ease: 'expo.out', stagger: 0.09, delay: k * 0.08, onComplete: function () { split.revert(); } });
          } else {
            G.fromTo(el, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', delay: k * 0.08, clearProps: 'transform,opacity' });
          }
        });
      }, 0.9);
    })();

    /* Réguas das seções se desenham da esquerda para a direita */
    (function rulers() {
      var els = $$('.sh-k');
      G.set(els, { clipPath: 'inset(0% 100% 0% 0%)' });
      onReveal(els, function (batch, anim) {
        if (!anim) { G.set(batch, { clearProps: 'clipPath' }); return; }
        G.to(batch, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut', stagger: 0.08, clearProps: 'clipPath' });
      }, 0.92);
    })();

    /* Manifesto: revelação palavra a palavra ligada ao scroll; fotos cruzam a composição */
    (function manifesto() {
      var el = $('.mani-t');
      if (el && Split && !fontsLoading()) {
        var s = new Split(el, { type: 'words' });
        G.fromTo(s.words, { opacity: 0.1, yPercent: 14 }, {
          opacity: 1, yPercent: 0, ease: 'none', stagger: 0.18,
          scrollTrigger: { trigger: el, start: 'top 85%', end: 'bottom 50%', scrub: 0.6 }
        });
      }
      $$('.mani-fig img').forEach(function (img, i) {
        G.fromTo(img, { clipPath: 'inset(100% 0% 0% 0%)' }, {
          clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1, ease: 'expo.inOut', delay: i * 0.15, clearProps: 'clipPath,transform',
          scrollTrigger: { trigger: '.mani-stage', start: 'top 80%', end: END, toggleActions: 'play none none none' }
        });
      });
    })();
    mm.add('(min-width: 768px)', function () {
      G.fromTo('.mani-fig--a', { yPercent: 0 }, { yPercent: -18, ease: 'none', scrollTrigger: { trigger: '.mani-stage', start: 'top bottom', end: 'bottom top', scrub: true } });
      G.fromTo('.mani-fig--b', { yPercent: 0 }, { yPercent: 12, ease: 'none', scrollTrigger: { trigger: '.mani-stage', start: 'top bottom', end: 'bottom top', scrub: true } });
      G.fromTo('.fc--b', { y: 24 }, { y: -24, ease: 'none', scrollTrigger: { trigger: '.form-collage', start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    /* Blocos que sobem ao entrar na tela */
    rise('.sh-lede, .cmp, .mani-sub, .mani-note, .step-d, .step-tag, .step-note, .fund-role, .fund-bio p, .fund-cta, .facts, .schools li, .form-p, .form-ask, .form-cta, .form-placa, .slide-k, .slide-c, .quote, .score-n, .link-out, .howto li, .book-wa, .faq-item, .addr, .visit-cta, .info-row, .planta, .stamp, .foot-nav, .board-foot, .gal-item figcaption');
    rise('.svc', { y: 22, duration: 0.9 });
    rise('.team li', { y: 44 }, 0.92);

    /* Ticket: entra como um papel destacado */
    G.from('.ficha', { y: 50, rotation: -3, opacity: 0, transformOrigin: '50% 100%', duration: 1.2, ease: 'expo.out', clearProps: 'transform,opacity',
      scrollTrigger: { trigger: '.ficha-wrap', start: 'top 88%', end: END, toggleActions: 'play none none none' } });

    /* Imagens revelam com clip-path dentro das marcas de corte */
    (function images() {
      var imgs = $$('.rv-img img, .form-placa-ph img');
      imgs.forEach(function (img) {
        /* dentro das marcas de corte a moldura não recorta, então a foto não cresce */
        img._sc = getComputedStyle(img.parentNode).overflow === 'hidden' ? 1.12 : 1;
        G.set(img, { clipPath: 'inset(100% 0% 0% 0%)', scale: img._sc });
      });
      onReveal(imgs.map(function (img) { return img.parentNode; }), function (batch, anim) {
        batch.forEach(function (box, k) {
          var img = $('img', box);
          if (!anim) { G.set(img, { clearProps: 'clipPath,transform' }); return; }
          G.to(img, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 1.1, ease: 'expo.inOut', delay: k * 0.12, clearProps: 'clipPath,transform' });
        });
      }, 0.9);
    })();

    /* Fundador: retrato revela, o nome vazado aparece por cima e as linhas derivam em sentidos opostos */
    (function founder() {
      var stage = $('.fd-stage');
      if (!stage) return;
      var tl = G.timeline({ scrollTrigger: { trigger: stage, start: 'top 85%', end: END, toggleActions: 'play none none none' } });
      tl.from('.fd-name:not(.fd-ghost) .fd-l', { yPercent: 40, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12 }, 0)
        .fromTo('.fd-photo img', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut', clearProps: 'clipPath,transform' }, 0.15)
        .from('.fd-ghost', { opacity: 0, duration: 0.9, ease: 'power2.out' }, 1.1)
        .from('.fd-cap', { opacity: 0, x: -10, duration: 0.8 }, 1.2);
      G.fromTo($$('.fd-l1', stage), { xPercent: 5 }, { xPercent: 0, ease: 'none', scrollTrigger: { trigger: stage, start: 'top bottom', end: 'bottom top', scrub: true } });
      G.fromTo($$('.fd-l2', stage), { xPercent: -5 }, { xPercent: 0, ease: 'none', scrollTrigger: { trigger: stage, start: 'top bottom', end: 'bottom top', scrub: true } });
    })();

    /* Contadores: o HTML já tem o valor final, a animação só roda na tela */
    onReveal($$('.count'), function (batch, anim) {
      if (!anim) return;
      batch.forEach(function (el) {
        var to = parseFloat(el.getAttribute('data-to')), dec = +(el.getAttribute('data-dec') || 0), suf = el.getAttribute('data-suffix') || '';
        var final = el.textContent, o = { v: 0 };
        G.to(o, { v: to, duration: 1.8, ease: 'power3.out',
          onUpdate: function () { el.textContent = o.v.toFixed(dec).replace('.', ',') + suf; },
          onComplete: function () { el.textContent = final; } });
      });
    }, 0.9);

    /* Estrelas */
    (function stars() {
      var groups = $$('.stars').filter(function (s) { return !s.closest('.hero'); });
      groups.forEach(function (s) { G.set($$('svg', s), { scale: 0, rotation: -70, transformOrigin: '50% 50%' }); });
      onReveal(groups, function (batch, anim) {
        batch.forEach(function (s) {
          var svgs = $$('svg', s);
          if (!anim) { G.set(svgs, { clearProps: 'transform' }); return; }
          G.to(svgs, { scale: 1, rotation: 0, duration: 0.8, ease: 'back.out(2.4)', stagger: 0.09, clearProps: 'transform' });
        });
      }, 0.92);
    })();

    /* Rodapé: o nome sobe letra a letra */
    (function footMark() {
      var el = $('.foot-mark');
      if (!el || !Split) return;
      var go = function () {
        if (fontsLoading()) { G.from(el, { yPercent: 30, opacity: 0, duration: 1.2, ease: 'expo.out', clearProps: 'transform,opacity' }); return; }
        var s = new Split(el, { type: 'chars' });
        G.from(s.chars, { yPercent: 100, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.035, onComplete: function () { s.revert(); } });
      };
      G.set(el, { opacity: 0 });
      onReveal([el], function (batch, anim) { G.set(el, { clearProps: 'opacity' }); if (anim) go(); }, 0.95);
    })();

    /* Ficha de localização: o retículo se desenha */
    (function planta() {
      var svg = $('.planta-svg');
      if (!svg) return;
      var paths = $$('.pt-ring, .pt-lead, .pt-target', svg);
      paths.forEach(function (p) { var L = Math.ceil(p.getTotalLength ? p.getTotalLength() : 0) + 2; p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = L; });
      var tl = G.timeline({ scrollTrigger: { trigger: svg, start: 'top 80%', end: END, toggleActions: 'play none none none' },
        onComplete: function () { paths.forEach(function (p) { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }); } });
      tl.to(paths, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut', stagger: 0.08 }, 0)
        .from($$('text', svg), { opacity: 0, duration: 0.6, stagger: 0.05 }, 0.6);
    })();

    /* ---------- A prancha do método se desenha conforme o scroll ----------
       Cada camada (pelo data-layer; o espelho da etapa 3 fica embaixo dos rótulos no SVG)
       se desenha enquanto a sua etapa passa pela linha de leitura. No celular e no tablet
       essa linha fica abaixo da prancha grudada, onde o texto da etapa está visível. */
    (function plate() {
      var svg = $('.plate'), stepsEl = $('.steps');
      if (!svg || !stepsEl) return;
      var lupa = $('.lupa'), stepEls = $$('.step', stepsEl);
      var groups = {};
      $$('.pl-layer', svg).forEach(function (g) { var n = g.getAttribute('data-layer'); (groups[n] = groups[n] || []).push(g); });
      measureStick();
      function drawLine() { return stickBottom ? Math.round(stepLine()) + 'px' : '75%'; }
      ['1', '2', '3'].forEach(function (n, i) {
        var layer = groups[n] || [], step = stepEls[i] || stepsEl;
        function q(sel) { return layer.reduce(function (a, g) { return a.concat($$(sel, g)); }, []); }
        var draws = q('.pl-ink, .pl-fine, .pl-ray, .pl-red, .pl-cut, .pl-cut-fine, .pl-lead, .pl-mirror');
        var dashes = q('.pl-guide, .pl-sec, .pl-det');
        var texts = q('text');
        var pivots = q('.pl-pivot');
        var rays = q('.pl-ray');
        draws.forEach(function (p) {
          var L = Math.ceil(p.getTotalLength ? p.getTotalLength() : 0) + 2;
          p.style.strokeDasharray = L + ' ' + L;
          p.style.strokeDashoffset = L;
        });
        /* sem invalidateOnRefresh: start/end já são recalculados a cada refresh e os estados iniciais ficam */
        var tl = G.timeline({ scrollTrigger: {
          trigger: step, scrub: 0.8,
          start: function () { if (i === 0) measureStick(); return 'top ' + drawLine(); },
          end: function () { return 'bottom ' + drawLine(); }
        } });
        if (draws.length) tl.to(draws, { strokeDashoffset: 0, duration: 1, ease: 'none', stagger: 0.1 }, 0);
        if (dashes.length) tl.fromTo(dashes, { opacity: 0 }, { opacity: 1, duration: 0.5, stagger: 0.12 }, 0.15);
        if (pivots.length) tl.fromTo(pivots, { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.3 }, 0.1);
        if (rays.length) tl.from(rays, { rotation: function (k, el) { return +el.getAttribute('data-ang'); }, svgOrigin: '492 330', duration: 1.1, ease: 'power2.inOut', stagger: 0.12 }, 0.25);
        if (texts.length) tl.fromTo(texts, { opacity: 0 }, { opacity: 1, duration: 0.35, stagger: 0.08 }, 0.55);
        if (i === 1 && lupa) tl.fromTo(lupa, { scale: 0.4, autoAlpha: 0, rotation: -30 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.8, ease: 'back.out(1.6)' }, 0.7);
        tl.to({}, { duration: 0.5 });
      });
      ST.addEventListener('refresh', function () { measureStick(); setStepFromScroll(); });
      setStepFromScroll();
    })();

    /* ---------- Desktop: galeria horizontal com pin + scrub ---------- */
    mm.add('(min-width: 1024px) and (min-height: 600px)', function () {
      var sec = $('.gal-sec'), pin = sec && $('.gal-pin', sec), view = sec && $('.gal-view', sec), track = sec && $('.gal-track', sec);
      if (!track) return;
      sec.classList.add('is-pinned');
      var dist = function () { return Math.max(0, track.scrollWidth - view.clientWidth); };
      var tw = G.to(track, {
        x: function () { return -dist(); }, ease: 'none',
        scrollTrigger: { trigger: pin, start: function () { return 'top ' + headH() + 'px'; }, end: function () { return '+=' + dist(); }, pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1 }
      });
      $$('.gal-item', track).forEach(function (it, i) {
        G.fromTo(it, { y: i % 2 ? 16 : -8 }, { y: i % 2 ? -8 : 14, ease: 'none',
          scrollTrigger: { trigger: it, containerAnimation: tw, start: 'left right', end: 'right left', scrub: true } });
      });
      /* teclado: o Tab dentro da faixa leva a página até o quadro focado */
      function onFocus(e) {
        var it = e.target.closest ? e.target.closest('.gal-item') : null, st = tw.scrollTrigger;
        if (!it || !st) return;
        var x = Math.min(dist(), Math.max(0, it.offsetLeft - (view.clientWidth - it.offsetWidth) / 2));
        goTo(st.start + x, true);
        ST.update();
        var sc = st.getTween && st.getTween();
        if (sc) sc.progress(1);
      }
      track.addEventListener('focusin', onFocus);
      return function () {
        track.removeEventListener('focusin', onFocus);
        sec.classList.remove('is-pinned');
        G.set(track, { clearProps: 'transform' });
      };
    });

    /* link direto (#agendar etc.): depois que o pin muda a altura da página, volta ao alvo,
       a menos que a pessoa já tenha rolado ou tocado em outra âncora */
    function jumpToHash() {
      if (userMoved) return;
      var id = arrivalHash && arrivalHash.length > 1 ? arrivalHash.slice(1) : '';
      var t = id ? d.getElementById(decodeURIComponent(id)) : null;
      if (t) scrollToEl(t, true);
    }
    var loaded = d.readyState === 'complete';
    w.addEventListener('load', function () { ST.refresh(); jumpToHash(); });
    ST.refresh();
    if (loaded) jumpToHash();
  });
})();
