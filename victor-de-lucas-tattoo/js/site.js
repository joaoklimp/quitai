/* =====================================================================
   Estúdio Victor de Lucas Tattoo · comportamento da página
   - Sem JS tudo funciona (links, fotos, formulário com link direto).
   - Com prefers-reduced-motion: nada se move sozinho, revelações instantâneas.
   - Um único laço de animação: o gsap.ticker (dirige o Lenis, a hero e a lanterna).
   Cada módulo roda dentro de safe(): se um falhar, os outros continuam.
   ===================================================================== */
(function () {
  'use strict';

  var d = document, w = window, root = d.documentElement;
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var mq = function (q) { return w.matchMedia(q); };

  var reduce = mq('(prefers-reduced-motion: reduce)').matches;
  var fineMQ = mq('(hover: hover) and (pointer: fine)');
  var mobileMQ = mq('(max-width: 820px)');
  var menuMQ = mq('(max-width: 820px)');
  var gsap = w.gsap, ST = w.ScrollTrigger;
  var hasGsap = !!gsap, hasST = hasGsap && !!ST;
  var WA = 'https://wa.me/5561998043597?text=';

  if (reduce) root.classList.add('reduced');
  if (hasST) gsap.registerPlugin(ST);

  function safe(name, fn) {
    try { fn(); } catch (err) { if (w.console) console.warn('[site] módulo "' + name + '" falhou:', err); }
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* Numerais romanos (contador do lightbox) */
  function roman(n) {
    var m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']], s = '';
    for (var i = 0; i < m.length; i++) while (n >= m[i][0]) { s += m[i][1]; n -= m[i][0]; }
    return s;
  }

  /* Laço único: tudo que precisa de quadro a quadro se registra aqui (gsap.ticker; sem GSAP, rAF) */
  var loop = (function () {
    var fns = [], rafId = 0, last = 0;
    function rafTick(t) { var dt = last ? t - last : 16; last = t; fns.slice().forEach(function (f) { f(t / 1000, dt); }); rafId = fns.length ? requestAnimationFrame(rafTick) : 0; if (!rafId) last = 0; }
    return {
      add: function (f) {
        if (fns.indexOf(f) > -1) return;
        fns.push(f);
        if (hasGsap) gsap.ticker.add(f); else if (!rafId) rafId = requestAnimationFrame(rafTick);
      },
      remove: function (f) {
        var i = fns.indexOf(f); if (i < 0) return;
        fns.splice(i, 1);
        if (hasGsap) gsap.ticker.remove(f);
      }
    };
  })();

  /* Estado compartilhado que pausa a hero */
  var state = { menuOpen: false, lbOpen: false };
  var heroApi = { sync: function () {} };
  var lenis = null;

  /* =============== Revelações ao rolar (IntersectionObserver) =============== */
  safe('reveal', function () {
    if (!root.classList.contains('motion')) return;
    if (!('IntersectionObserver' in w)) { root.classList.remove('motion'); return; }
    var io = new IntersectionObserver(function (entries) {
      var k = 0;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        // pequeno escalonamento para o que entra junto
        if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', (k * 0.08).toFixed(2) + 's');
        k++;
        el.classList.add('is-in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    w.__revealIO = io;
    $$('[data-reveal],[data-rise],.seam,.ba__fig,.lamp,.reviews__score,.final,.work').forEach(function (el) { io.observe(el); });
    // limpa o atraso depois da entrada, para hovers não herdarem o delay
    d.addEventListener('transitionend', function (e) {
      var el = e.target;
      if (el.classList && el.classList.contains('is-in') && el.hasAttribute('data-reveal')) el.style.removeProperty('--d');
    });
  });
  w.__vdlReady = true;

  /* =============== Lenis + ScrollTrigger =============== */
  safe('lenis', function () {
    if (reduce || !hasGsap || !w.Lenis) return;
    lenis = new w.Lenis({ lerp: 0.11, smoothWheel: true, wheelMultiplier: 1 });
    root.classList.add('smooth-js');
    if (hasST) lenis.on('scroll', ST.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
  });

  /* Rolagem suave para âncoras internas, com compensação do cabeçalho e foco no destino */
  function scrollToEl(el, focus) {
    var off = el === d.body || el.id === 'topo' ? 0 : (mobileMQ.matches ? 72 : 88);
    if (lenis) lenis.scrollTo(el === d.body ? 0 : el, { offset: -off, duration: 1.15 });
    else {
      var y = el === d.body ? 0 : el.getBoundingClientRect().top + w.scrollY - off;
      w.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    }
    if (focus && el.focus) {
      if (!el.matches('a,button,input,select,textarea,[tabindex]')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
  }

  /* =============== Cabeçalho, progresso, botão flutuante =============== */
  var header = $('#site-header');
  var waFloat = $('.wa-float');
  var floatBlock = { hero: true, end: false };
  function updateFloat() {
    if (!waFloat) return;
    waFloat.classList.toggle('is-on', !floatBlock.hero && !floatBlock.end && !state.menuOpen && !state.lbOpen);
  }

  safe('header', function () {
    var bar = $('.progress i');
    var lastY = w.scrollY, acc = 0, ticking = false, maxScroll = 1;
    function measure() { maxScroll = Math.max(1, root.scrollHeight - w.innerHeight); }
    measure();
    w.addEventListener('resize', measure);
    if ('ResizeObserver' in w) new ResizeObserver(measure).observe(d.body);

    function update() {
      ticking = false;
      var y = w.scrollY, dy = y - lastY;
      header.classList.toggle('is-scrolled', y > 40);
      // esconde ao descer, volta ao subir (com uma folga para não piscar)
      acc = (dy > 0) === (acc > 0) ? acc + dy : dy;
      if (!state.menuOpen && !header.contains(d.activeElement)) {
        if (y < 160 || acc < -24) header.classList.remove('is-hidden');
        else if (acc > 36 && y > 520) header.classList.add('is-hidden');
      }
      lastY = y;
      if (bar) bar.style.transform = 'scaleX(' + clamp(y / maxScroll, 0, 1).toFixed(4) + ')';
    }
    w.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    header.addEventListener('focusin', function () { header.classList.remove('is-hidden'); });
    update();

    // botão flutuante: some na hero e no final da página
    if ('IntersectionObserver' in w && waFloat) {
      new IntersectionObserver(function (en) { floatBlock.hero = en[0].isIntersecting; updateFloat(); }, { rootMargin: '0px 0px -30% 0px' }).observe($('.hero'));
      var ends = [$('#final'), $('#rodape')], vis = new Map();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { vis.set(en.target, en.isIntersecting); });
        floatBlock.end = Array.from(vis.values()).some(Boolean); updateFloat();
      });
      ends.forEach(function (el) { if (el) io.observe(el); });
    }

    // link do menu da seção atual
    var links = $$('.nav__list a');
    if ('IntersectionObserver' in w) {
      var secIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) {
            if (a.getAttribute('href') === '#' + en.target.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
          });
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      links.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) secIO.observe(s); });
    }
  });

  /* =============== Menu de tela cheia =============== */
  safe('menu', function () {
    var btn = $('.menu-btn'), nav = $('#menu'), label = $('[data-menu-label]', btn);
    var outside = [$('main'), $('footer'), $('.skip'), waFloat];
    nav.setAttribute('data-lenis-prevent', '');
    function setMenu(open, returnFocus) {
      if (state.menuOpen === open) return;
      state.menuOpen = open;
      nav.classList.toggle('is-open', open);
      header.classList.toggle('menu-open', open);
      header.classList.remove('is-hidden');
      btn.setAttribute('aria-expanded', String(open));
      label.textContent = open ? 'Fechar menu' : 'Abrir menu';
      root.classList.toggle('is-locked', open);
      if (lenis) open ? lenis.stop() : lenis.start();
      // o resto da página fica inerte: o foco não sai do cabeçalho enquanto o menu está aberto
      outside.forEach(function (el) { if (el) el.inert = open; });
      if (!open && returnFocus) btn.focus();
      updateFloat(); heroApi.sync();
    }
    btn.addEventListener('click', function () { setMenu(!state.menuOpen); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.menuOpen) setMenu(false, true); });
    var onMQ = function () { if (!menuMQ.matches) setMenu(false); };
    menuMQ.addEventListener ? menuMQ.addEventListener('change', onMQ) : menuMQ.addListener(onMQ);
    w.__setMenu = setMenu;
  });

  /* =============== Âncoras internas =============== */
  safe('anchors', function () {
    d.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = decodeURIComponent(a.getAttribute('href').slice(1));
      if (!id) return;
      var target = id === 'topo' ? d.body : d.getElementById(id);
      if (!target) return;
      e.preventDefault();
      // link para um serviço: abre a linha correspondente
      if (target.classList.contains('svc__btn') && w.__openSvc) w.__openSvc(target, true);
      var dest = target.classList.contains('svc__btn') ? target.closest('.svc') : target;
      scrollToEl(dest, false);
      setTimeout(function () {
        var f = target === d.body ? $('#conteudo') : target;
        if (!f.matches('a,button,input,select,textarea,[tabindex]')) f.setAttribute('tabindex', '-1');
        f.focus({ preventScroll: true });
      }, lenis ? 650 : 0);
      if (history.pushState) history.pushState(null, '', id === 'topo' ? location.pathname + location.search : '#' + id);
    });
  });

  /* =============== Lightbox (hero + portfólio) =============== */
  var works = $$('#works-grid .work').map(function (li) {
    var a = $('.work__a', li), img = $('img', li);
    return {
      id: a.getAttribute('data-work'), el: li, a: a, img: img,
      cats: (li.getAttribute('data-cat') || '').split(/\s+/).filter(Boolean),
      title: $('.work__t', li).textContent, area: $('.work__p', li).textContent,
      full: a.getAttribute('href')
    };
  });
  var openLightbox = function () {};

  safe('lightbox', function () {
    var dlg = $('#lightbox');
    if (!dlg || typeof dlg.showModal !== 'function') return; // sem <dialog>: os links abrem a foto
    dlg.setAttribute('data-lenis-prevent', '');
    var img = $('.lb__img', dlg), fig = $('.lb__fig', dlg), stage = $('[data-lb-stage]', dlg);
    var tEl = $('.lb__t', dlg), pEl = $('.lb__p', dlg), iEl = $('[data-lb-i]', dlg), nEl = $('[data-lb-n]', dlg), live = $('[data-lb-live]', dlg);
    var list = works, idx = 0, opener = null;

    function render(dir) {
      var it = list[idx];
      img.removeAttribute('src');
      img.srcset = it.img.getAttribute('srcset');
      img.sizes = '(max-width: 640px) 92vw, 554px';
      img.src = it.full;
      img.width = +it.img.getAttribute('width'); img.height = +it.img.getAttribute('height');
      img.alt = it.img.alt;
      tEl.textContent = it.title; pEl.textContent = it.area;
      iEl.textContent = roman(idx + 1); nEl.textContent = roman(list.length);
      live.textContent = 'Foto ' + (idx + 1) + ' de ' + list.length + ': ' + it.title + '.';
      if (dir && hasGsap && !reduce) gsap.fromTo(fig, { x: dir * 48, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55, ease: 'expo.out', overwrite: true });
      else if (hasGsap) gsap.set(fig, { x: 0, opacity: 1 });
      // pré-carrega vizinhas
      [idx + 1, idx - 1].forEach(function (j) { var n = list[(j + list.length) % list.length]; if (n) { var p = new Image(); p.src = n.full; } });
    }
    function step(dir) { idx = (idx + dir + list.length) % list.length; render(dir); }

    openLightbox = function (id, fromGrid) {
      list = fromGrid ? works.filter(function (x) { return !x.el.hidden; }) : works;
      idx = Math.max(0, list.findIndex(function (x) { return x.id === id; }));
      opener = d.activeElement;
      render(0);
      dlg.showModal();
      state.lbOpen = true;
      root.classList.add('is-locked');
      if (lenis) lenis.stop();
      updateFloat(); heroApi.sync();
      if (hasGsap && !reduce) gsap.fromTo(fig, { scale: 0.96, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: 'expo.out' });
      $('[data-lb-close]', dlg).focus();
    };
    dlg.addEventListener('close', function () {
      state.lbOpen = false;
      root.classList.remove('is-locked');
      if (lenis) lenis.start();
      updateFloat(); heroApi.sync();
      if (opener && opener.focus) opener.focus({ preventScroll: true });
    });
    $('[data-lb-close]', dlg).addEventListener('click', function () { dlg.close(); });
    $('[data-lb-prev]', dlg).addEventListener('click', function () { step(-1); });
    $('[data-lb-next]', dlg).addEventListener('click', function () { step(1); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); idx = 0; render(-1); }
      else if (e.key === 'End') { e.preventDefault(); idx = list.length - 1; render(1); }
    });

    // deslizar (toque e mouse): horizontal troca de foto; vertical deixa a página em paz
    var sx = 0, sy = 0, dx = 0, pid = null, dragging = false, t0 = 0;
    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      pid = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; dragging = false; t0 = performance.now();
    });
    stage.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid) return;
      var mx = e.clientX - sx, my = e.clientY - sy;
      if (!dragging) {
        if (Math.abs(mx) < 8) return;
        if (Math.abs(my) > Math.abs(mx)) { pid = null; return; }
        dragging = true;
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      }
      dx = mx;
      fig.style.transform = 'translate3d(' + dx + 'px,0,0)';
      fig.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 600));
    });
    function end(e) {
      if (e.pointerId !== pid) return;
      pid = null;
      if (dragging) {
        var v = Math.abs(dx) / Math.max(1, performance.now() - t0);
        fig.style.transform = ''; fig.style.opacity = '';
        if (Math.abs(dx) > 60 || v > 0.5) step(dx < 0 ? 1 : -1);
        else if (hasGsap) gsap.fromTo(fig, { x: dx }, { x: 0, duration: 0.4, ease: 'expo.out' });
      } else if (e.type === 'pointerup' && !e.target.closest('.lb__img,.lb__cap')) {
        dlg.close(); // toque fora da foto fecha
      }
      dragging = false;
    }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    img.addEventListener('dragstart', function (e) { e.preventDefault(); });

    // abrir: fotos da hero (todas) e da grade (só as do filtro atual)
    d.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-work]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      openLightbox(a.getAttribute('data-work'), !!a.closest('#works-grid'));
    });
  });

  /* =============== Hero: galeria viva + frase que gira =============== */
  safe('hero', function () {
    var hero = $('.hero'), gallery = $('.gallery'), tilt = $('.gallery__tilt');
    var toggle = $('.motion-toggle'), toggleLabel = $('.motion-toggle__label');
    var axis = mobileMQ.matches ? 'x' : 'y';

    var cols = $$('.col', gallery).map(function (el) {
      var track = $('.track', el);
      var items = $$('.shot', track);
      // Trilha = [cópias A][originais][cópias B]. Com cópias dos dois lados, qualquer foto original
      // pode ser centralizada quando recebe foco de teclado, e o loop continua sem emenda.
      // As cópias são aria-hidden, fora do Tab, usam a mesma URL (cache de memória) e continuam lazy.
      var cloneA = null;
      if (!reduce) {
        var mk = function (n) {
          var c = n.cloneNode(true);
          c.setAttribute('aria-hidden', 'true');
          c.setAttribute('data-clone', '');
          $$('a', c).forEach(function (a) { a.setAttribute('tabindex', '-1'); });
          $$('img', c).forEach(function (im) { im.alt = ''; im.removeAttribute('fetchpriority'); });
          return c;
        };
        items.forEach(function (n) { track.insertBefore(mk(n), items[0]); });
        items.forEach(function (n) { track.appendChild(mk(n)); });
        cloneA = track.children[0];
      }
      return {
        el: el, track: track, first: items[0], clone: cloneA, focusX: null,
        speed: parseFloat(el.dataset.speed) || 1, depth: parseFloat(el.dataset.depth) || 16,
        start: parseFloat(el.dataset.start) || 0, off: 0, period: 1, factor: 1, target: 1
      };
    });
    $$('.shot__a', gallery).forEach(function (a) { a.setAttribute('data-cursor', 'view'); });

    var BASE = function () { return axis === 'y' ? 30 : 24; }; // px/s
    var INTRO_MS = 2200, INTRO_GAIN = 12;
    // distância extra percorrida durante a intro (integral da curva de aceleração), em segundos de cruzeiro
    var INTRO_EXTRA = INTRO_GAIN * (INTRO_MS / 1000) / 4;

    function measure() {
      axis = mobileMQ.matches ? 'x' : 'y';
      cols.forEach(function (c) {
        c.el.style.transform = '';
        if (!c.clone) return;
        var p = axis === 'y' ? c.first.offsetTop - c.clone.offsetTop : c.first.offsetLeft - c.clone.offsetLeft;
        c.period = p > 0 ? p : 1;
      });
      tilt.style.transform = '';
    }
    function dirOf(c) { return axis === 'x' ? -c.speed : c.speed; }
    function render(c) {
      // focusX: posição livre usada enquanto uma foto está com foco de teclado
      var p = c.period, o = c.focusX !== null ? c.focusX : ((c.off % p) + p) % p;
      c.track.style.transform = axis === 'y' ? 'translate3d(0,' + (-o).toFixed(2) + 'px,0)' : 'translate3d(' + (-o).toFixed(2) + 'px,0,0)';
    }
    function placeStart(withIntro) {
      cols.forEach(function (c) {
        var travel = withIntro ? BASE() * dirOf(c) * INTRO_EXTRA : 0;
        if (axis === 'x') {
          // celular: a peça em destaque termina a intro a ~20% da faixa, bem visível
          var target = -(c.el.offsetWidth * 0.2);
          c.off = target - travel;
        } else c.off = c.start - travel;
        render(c);
      });
    }

    /* ----- pausa: botão (WCAG 2.2.2), foco dentro da hero, fora da tela, aba oculta, menu/lightbox ----- */
    var userPaused = false, focusIn = false, offscreen = false;
    function isPaused() { return userPaused || focusIn || offscreen || d.hidden || state.menuOpen || state.lbOpen; }

    var run = 1, runTarget = 1, introStart = 0, introOn = false;
    var tmx = 0, tmy = 0, mx = 0, my = 0, boost = 0, boostT = 0, lastPX = null, lastPY = 0, lastPT = 0;

    function tick(time, dtMs) {
      var dt = Math.min(0.05, (dtMs || 16) / 1000);
      var now = performance.now();
      var intro = 1;
      if (introOn) {
        var k = Math.min(1, (now - introStart) / INTRO_MS);
        intro = 1 + INTRO_GAIN * Math.pow(1 - k, 3);
        if (k >= 1) introOn = false;
      }
      run += (runTarget - run) * Math.min(1, dt * (runTarget ? 3 : 9));
      if (runTarget === 0 && run < 0.02) run = 0;
      boostT *= Math.pow(0.04, dt);
      boost += (boostT - boost) * Math.min(1, dt * 5);
      var e = Math.min(1, dt * 4);
      mx += (tmx - mx) * e; my += (tmy - my) * e;
      var desktopFx = axis === 'y' && fineMQ.matches;
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        c.factor += (c.target - c.factor) * Math.min(1, dt * 6);
        c.off += BASE() * dirOf(c) * dt * c.factor * run * (introOn ? intro : 1 + boost);
        render(c);
        if (desktopFx) c.el.style.transform = 'translate3d(' + (mx * -c.depth).toFixed(2) + 'px,' + (my * -c.depth * 0.7).toFixed(2) + 'px,0)';
      }
      if (desktopFx) tilt.style.transform = 'translate3d(' + (mx * -14).toFixed(2) + 'px,' + (my * -10).toFixed(2) + 'px,0) rotate(' + (-7 + mx * 1).toFixed(3) + 'deg)';
      // parado e sem nada para assentar: sai do laço (CPU zero)
      var settled = Math.abs(tmx - mx) < 0.001 && Math.abs(tmy - my) < 0.001;
      if (runTarget === 0 && run === 0 && settled) loop.remove(tick);
    }
    function wake() { if (!reduce && cols[0].clone) loop.add(tick); }

    /* ----- frase que gira ----- */
    var rot = $('.rotator'), words = $$('.rotator__w', rot);
    var current = 0, swapTl = null, auto = null, hoverLock = false, under = null, widths = [], maxW = 1;
    var rotLive = !reduce && hasGsap && words.length > 1;
    function measureWords() {
      if (!under) return;
      maxW = rot.getBoundingClientRect().width || 1;
      widths = words.map(function (wEl) { return wEl.getBoundingClientRect().width; });
      gsap.set(under, { scaleX: widths[current] / maxW, transformOrigin: '0% 50%' });
    }
    function finishSwap() { if (swapTl) swapTl.progress(1); }
    function scheduleAuto(delay) {
      if (!rotLive) return;
      if (auto) auto.kill();
      auto = gsap.delayedCall(delay || 3.4, function () {
        if (isPaused() || hoverLock) { scheduleAuto(1.5); return; }
        goTo((current + 1) % words.length);
      });
    }
    // troca em "rolo": a frase inteira sobe e a próxima entra por baixo, dentro da máscara.
    // Em qualquer quadro as duas frases estão inteiras (nada de letras soltas pelo caminho).
    function goTo(nx) {
      if (!rotLive || nx === current) return;
      finishSwap();
      var out = words[current], inn = words[nx];
      current = nx;
      if (auto) auto.kill();
      inn.classList.add('is-on');
      swapTl = gsap.timeline({ onComplete: function () { swapTl = null; scheduleAuto(); } });
      swapTl.to(under, { scaleX: 0, transformOrigin: '100% 50%', duration: 0.32, ease: 'power3.in' }, 0)
        .fromTo(out, { yPercent: 0 }, { yPercent: -112, duration: 0.6, ease: 'power3.inOut', immediateRender: false }, 0.08)
        .fromTo(inn, { yPercent: 112 }, { yPercent: 0, duration: 0.75, ease: 'power3.inOut' }, 0.14)
        .add(function () { out.classList.remove('is-on'); gsap.set(out, { yPercent: 0 }); })
        .fromTo(under, { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: function () { return widths[nx] / maxW; }, duration: 0.7, ease: 'expo.out', immediateRender: false }, 0.8);
    }
    if (rotLive) {
      rot.classList.add('is-live');
      under = d.createElement('i'); under.className = 'rotator__u'; under.setAttribute('aria-hidden', 'true');
      rot.appendChild(under);
      rot.style.clipPath = 'inset(-0.12em -0.45em -0.28em -0.16em)';
      measureWords();
      if (d.fonts && d.fonts.ready) d.fonts.ready.then(measureWords);
    }

    /* ----- sincroniza tudo com o estado de pausa ----- */
    function sync() {
      var p = isPaused();
      runTarget = p ? 0 : 1;
      if (!p) wake();
      hero.classList.toggle('is-still', p);
      if (p) finishSwap();
      else if (rotLive && !swapTl && !hoverLock) scheduleAuto(2.4);
    }
    heroApi.sync = sync;

    if (reduce) { measure(); return; }

    toggle.hidden = false;
    toggle.addEventListener('click', function () {
      userPaused = !userPaused;
      toggle.setAttribute('aria-pressed', String(userPaused));
      toggleLabel.textContent = userPaused ? 'Retomar' : 'Pausar';
      sync();
    });
    hero.addEventListener('focusin', function (e) {
      // só foco de teclado pausa (clique no botão não)
      var kb = false; try { kb = e.target.matches(':focus-visible'); } catch (_) { kb = true; }
      if (e.target === toggle) return;
      focusIn = kb; sync();
    });
    hero.addEventListener('focusout', function (e) {
      if (!gallery.contains(e.relatedTarget)) { gallery.classList.remove('is-focusing'); releaseFocus(); }
      if (!hero.contains(e.relatedTarget)) { focusIn = false; sync(); }
    });
    d.addEventListener('visibilitychange', sync);
    if ('IntersectionObserver' in w) {
      new IntersectionObserver(function (en) { offscreen = !en[0].isIntersecting; sync(); }, { threshold: 0.02 }).observe(hero);
    }

    // ponteiro (desktop): paralaxe + "mexer a tinta" acelera as colunas por um instante
    w.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || axis !== 'y' || offscreen) return;
      tmx = (e.clientX / w.innerWidth) * 2 - 1;
      tmy = (e.clientY / w.innerHeight) * 2 - 1;
      var now = performance.now();
      if (lastPX !== null && !isPaused()) {
        var v = Math.hypot(e.clientX - lastPX, e.clientY - lastPY) / Math.max(8, now - lastPT);
        boostT = Math.min(2.2, Math.max(boostT, v * 0.9));
      }
      lastPX = e.clientX; lastPY = e.clientY; lastPT = now;
      wake();
    }, { passive: true });

    // passar o mouse numa foto para a coluna dela e puxa a frase do tema
    var themeT = 0;
    cols.forEach(function (c) {
      c.el.addEventListener('pointerover', function (e) {
        if (e.pointerType !== 'mouse' || !e.target.closest('.shot')) return;
        c.target = 0; gallery.classList.add('is-hovering');
        hoverLock = true; if (auto) auto.kill();
        var fig = e.target.closest('.shot'), t = fig.getAttribute('data-theme');
        clearTimeout(themeT);
        if (t !== null) themeT = setTimeout(function () { goTo(+t); }, 160);
      });
      c.el.addEventListener('pointerleave', function () {
        c.target = 1; gallery.classList.remove('is-hovering');
        hoverLock = false; clearTimeout(themeT);
        if (!swapTl && !isPaused()) scheduleAuto(2.2);
      });
    });

    // teclado: Tab entra numa foto; setas percorrem; Enter amplia (foco = estado de hover)
    var origLinks = function () { return $$('.shot:not([data-clone]) .shot__a', gallery).filter(function (a) { return a.offsetParent !== null; }); };
    function bringIntoView(a) {
      var fig = a.closest('.shot'), col = a.closest('.col');
      var c = cols.find(function (x) { return x.el === col; });
      if (!c) return;
      var gr = (axis === 'y' ? gallery : col).getBoundingClientRect(), fr = fig.getBoundingClientRect();
      var delta = axis === 'y' ? (fr.top + fr.height / 2) - (gr.top + gr.height / 2) : (fr.left + fr.width / 2) - (gr.left + gr.width / 2);
      var p = c.period, cur = c.focusX !== null ? c.focusX : ((c.off % p) + p) % p;
      if (c.focusX === null) c.focusX = cur;
      if (Math.abs(delta) < 4) return;
      if (hasGsap) gsap.to(c, { focusX: cur + delta, duration: 0.8, ease: 'expo.out', overwrite: true, onUpdate: function () { render(c); } });
      else { c.focusX = cur + delta; render(c); }
    }
    // foco saiu da galeria: o loop continua exatamente de onde a foto focada ficou (cópia idêntica)
    function releaseFocus() {
      cols.forEach(function (c) {
        if (c.focusX === null) return;
        if (hasGsap) gsap.killTweensOf(c);
        c.off = c.focusX; c.focusX = null; render(c);
      });
    }
    // Ao entrar com Tab, a foto que recebe o foco é a mais próxima do centro da galeria (visível),
    // e qualquer rolagem automática que o navegador faça para "mostrar" o foco é desfeita.
    var beforeY = w.scrollY;
    function pickVisible() {
      var gr = gallery.getBoundingClientRect(), cy = gr.top + gr.height / 2, cx = gr.left + gr.width / 2, best = null, bd = 1e9;
      origLinks().forEach(function (x) {
        var r = x.getBoundingClientRect(), dd = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (dd < bd) { bd = dd; best = x; }
      });
      if (best) { origLinks().forEach(function (x) { x.setAttribute('tabindex', x === best ? '0' : '-1'); }); }
    }
    d.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      beforeY = w.scrollY;
      if (!gallery.contains(d.activeElement)) pickVisible();
    }, true);
    gallery.addEventListener('focusin', function (e) {
      var a = e.target.closest('.shot__a');
      if (!a) return;
      if (Math.abs(w.scrollY - beforeY) > 2) { if (lenis) lenis.scrollTo(beforeY, { immediate: true, force: true }); w.scrollTo(0, beforeY); }
      // o navegador pode "rolar" contêineres com overflow ao focar; zera isso (quem posiciona é o loop)
      [gallery, tilt, a.closest('.col'), hero].forEach(function (el) { if (el) { el.scrollTop = 0; el.scrollLeft = 0; } });
      gallery.classList.add('is-focusing');
      var t = a.closest('.shot').getAttribute('data-theme');
      if (t !== null) goTo(+t);
      bringIntoView(a);
    });
    gallery.addEventListener('keydown', function (e) {
      var a = e.target.closest('.shot__a');
      if (!a) return;
      var list = origLinks(), i = list.indexOf(a), n = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = i + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = i - 1;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = list.length - 1;
      else if (e.key === ' ') { e.preventDefault(); a.click(); return; }
      else return;
      e.preventDefault();
      n = (n + list.length) % list.length;
      list.forEach(function (x) { x.setAttribute('tabindex', '-1'); });
      list[n].setAttribute('tabindex', '0');
      list[n].focus({ preventScroll: true });
    });

    // medidas, troca celular/desktop
    var rT = 0;
    w.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(function () { measure(); cols.forEach(render); measureWords(); }, 140); });
    // tabindex itinerante: só uma foto da galeria entra na ordem do Tab; as setas fazem o resto
    function resetRoving() { var first = origLinks()[0]; if (first) { $$('.shot__a', gallery).forEach(function (x) { x.setAttribute('tabindex', '-1'); }); first.setAttribute('tabindex', '0'); } }
    resetRoving();
    var onMQ = function () { measure(); placeStart(false); measureWords(); resetRoving(); };
    mobileMQ.addEventListener ? mobileMQ.addEventListener('change', onMQ) : mobileMQ.addListener(onMQ);

    // Depois do load, as fotos que estão de fato na tela (inclusive cópias, que vêm do cache de memória)
    // deixam de ser lazy, para nenhuma moldura entrar vazia na faixa. Fotos escondidas (coluna 3 e
    // data-m-hide no celular) continuam lazy e não são baixadas.
    function warm() {
      $$('.track img', gallery).forEach(function (im) {
        if (im.loading === 'lazy' && im.closest('.shot').offsetParent !== null) im.loading = 'eager';
      });
    }
    if (d.readyState === 'complete') setTimeout(warm, 300);
    else w.addEventListener('load', function () { setTimeout(warm, 300); });
    mobileMQ.addEventListener ? mobileMQ.addEventListener('change', warm) : mobileMQ.addListener(warm);

    // início: a "bobina" gira rápido e assenta (~2,2 s), sem esconder nada do texto
    measure();
    placeStart(true);
    introStart = performance.now(); introOn = true;
    sync();
    wake();
    if (rotLive) scheduleAuto(3.4);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { measure(); });
  });

  /* =============== Manifesto: palavra por palavra (scrub) =============== */
  safe('manifesto', function () {
    if (!hasST || reduce) return;
    var p = $('[data-words]');
    if (!p) return;
    var words = [];
    function splitNode(node, parent) {
      Array.from(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = d.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(d.createTextNode(part)); return; }
            var s = d.createElement('span'); s.className = 'w'; s.textContent = part; words.push(s); frag.appendChild(s);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) splitNode(n, node);
      });
    }
    splitNode(p);
    gsap.fromTo(words, { opacity: 0.16 }, {
      opacity: 1, ease: 'none', stagger: 0.1,
      scrollTrigger: { trigger: p, start: 'top 86%', end: 'bottom 68%', scrub: 0.6 }
    });
  });

  /* =============== Portfólio: filtros + ritmo da grade =============== */
  safe('works', function () {
    var grid = $('#works-grid'), status = $('#works-status');
    var btns = $$('.filter');
    var labels = { todos: 'todos', animais: 'Animais', fe: 'Fé', mitologia: 'Mitologia e guerreiros', retratos: 'Retratos e homenagens', grandes: 'Projetos grandes' };
    $$('.work__a').forEach(function (a) { a.setAttribute('data-cursor', 'view'); });
    // contagens reais por filtro (se trocar fotos, os números se ajustam sozinhos)
    btns.forEach(function (b) {
      var f = b.getAttribute('data-filter');
      var n = f === 'todos' ? works.length : works.filter(function (x) { return x.cats.indexOf(f) > -1; }).length;
      var sup = $('[data-count]', b); if (sup) sup.textContent = n;
    });
    function apply(f) {
      btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === f)); });
      var show = works.filter(function (x) { return f === 'todos' || x.cats.indexOf(f) > -1; });
      function swap() {
        works.forEach(function (x) { x.el.hidden = show.indexOf(x) < 0; });
        show.forEach(function (x, i) {
          x.el.dataset.d = i % 12; x.el.dataset.t = i % 6; x.el.dataset.m = i % 5;
          if (root.classList.contains('motion') && w.__revealIO) {
            x.el.classList.remove('is-in');
            x.el.style.setProperty('--d', (Math.min(i, 8) * 0.07).toFixed(2) + 's');
            w.__revealIO.observe(x.el);
          }
        });
        status.textContent = (f === 'todos' ? 'Mostrando todos os ' + show.length + ' trabalhos.' : 'Mostrando ' + show.length + ' trabalhos: ' + labels[f] + '.');
        if (hasST) ST.refresh();
      }
      if (hasGsap && !reduce) {
        gsap.to(grid, { opacity: 0, y: 12, duration: 0.25, ease: 'power2.in', onComplete: function () {
          swap(); gsap.to(grid, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', clearProps: 'transform,opacity' });
        } });
      } else swap();
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { if (b.getAttribute('aria-pressed') !== 'true') apply(b.getAttribute('data-filter')); }); });
  });

  /* =============== Especialidade: lanterna sobre a obra =============== */
  safe('lamp', function () {
    var lamp = $('[data-lamp]');
    if (!lamp || reduce) return; // movimento reduzido: fica a luz parada do CSS
    var stage = $('.lamp__stage', lamp), photo = $('.lamp__photo', lamp), glow = $('.lamp__glow', lamp);
    var G = { w: 1, h: 1, ox: 0, oy: 0 };
    var REST = { x: 0.415, y: 0.32 }; // íris do olho
    var L = { x: 0, y: 0, r: 0 }, T = { x: 0, y: 0, r: 0 }, running = false;
    function geo() {
      G.w = photo.offsetWidth; G.h = photo.offsetHeight;
      G.ox = (stage.offsetWidth - G.w) / 2; G.oy = (stage.offsetHeight - G.h) / 2;
    }
    function paint() {
      photo.style.setProperty('--lx', L.x.toFixed(1) + 'px');
      photo.style.setProperty('--ly', L.y.toFixed(1) + 'px');
      photo.style.setProperty('--rx', L.r.toFixed(1) + 'px');
      photo.style.setProperty('--ry', L.r.toFixed(1) + 'px');
      glow.style.setProperty('--gx', (G.ox + L.x).toFixed(1) + 'px');
      glow.style.setProperty('--gy', (G.oy + L.y).toFixed(1) + 'px');
    }
    function step(time, dtMs) {
      var k = Math.min(1, ((dtMs || 16) / 1000) * 7);
      L.x += (T.x - L.x) * k; L.y += (T.y - L.y) * k; L.r += (T.r - L.r) * k;
      paint();
      if (Math.abs(T.x - L.x) < 0.4 && Math.abs(T.y - L.y) < 0.4 && Math.abs(T.r - L.r) < 0.4) { running = false; loop.remove(step); }
    }
    function go() { if (!running) { running = true; loop.add(step); } }
    function aim(cx, cy) {
      var r = photo.getBoundingClientRect();
      // a luz fica presa dentro da foto
      T.x = clamp(cx - r.left, 0, G.w); T.y = clamp(cy - r.top, 0, G.h);
      T.r = G.w * 0.42; go();
    }
    function rest() { T.x = G.w * REST.x; T.y = G.h * REST.y; T.r = G.w * 0.5; go(); }
    geo();
    L.x = T.x = G.w * REST.x; L.y = T.y = G.h * REST.y; L.r = T.r = G.w * 0.5;
    paint();
    lamp.classList.add('is-live');

    stage.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.buttons) aim(e.clientX, e.clientY); });
    stage.addEventListener('pointerdown', function (e) { aim(e.clientX, e.clientY); });
    stage.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') rest(); });
    w.addEventListener('resize', function () { var px = L.x / G.w, py = L.y / G.h; geo(); L.x = T.x = px * G.w; L.y = T.y = py * G.h; L.r = T.r = G.w * 0.5; paint(); });

    // ao entrar na tela pela primeira vez: uma varredura de luz (2,4 s) que termina na íris
    if ('IntersectionObserver' in w && hasGsap) {
      var io = new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        geo();
        var s = { x: G.w * 0.92, y: G.h * 0.9, r: G.w * 0.26 };
        gsap.timeline({ delay: 0.3, onUpdate: function () { L.x = T.x = s.x; L.y = T.y = s.y; L.r = T.r = s.r; paint(); } })
          .to(s, { x: G.w * 0.12, y: G.h * 0.55, r: G.w * 0.34, duration: 1.2, ease: 'sine.inOut' })
          .to(s, { x: G.w * REST.x, y: G.h * REST.y, r: G.w * 0.5, duration: 1.2, ease: 'expo.out' });
      }, { threshold: 0.45 });
      io.observe(stage);
    }
  });

  /* =============== Serviços: linhas expansíveis + prévia flutuante =============== */
  safe('services', function () {
    var btns = $$('.svc__btn');
    var refreshT = 0;
    function setOpen(b, open) {
      b.setAttribute('aria-expanded', String(open));
      b.closest('.svc').classList.toggle('is-open', open);
      clearTimeout(refreshT);
      if (hasST) refreshT = setTimeout(function () { ST.refresh(); }, 600);
    }
    btns.forEach(function (b) {
      setOpen(b, false);
      b.addEventListener('click', function () { setOpen(b, b.getAttribute('aria-expanded') !== 'true'); });
    });
    w.__openSvc = function (b, open) { setOpen(b, open); };

    // prévia que segue o cursor: só desktop, só quando existe foto real do serviço
    if (!fineMQ.matches || reduce || !hasGsap) return;
    var pv = $('.svc-preview'), cur = 0, onRow = null;
    // as duas imagens da prévia (troca cruzada) só existem no desktop
    var imgs = [0, 1].map(function () { var im = d.createElement('img'); im.alt = ''; im.width = 277; im.height = 371; im.decoding = 'async'; pv.appendChild(im); return im; });
    var xTo = gsap.quickTo(pv, 'x', { duration: 0.55, ease: 'power3' });
    var yTo = gsap.quickTo(pv, 'y', { duration: 0.55, ease: 'power3' });
    var rTo = gsap.quickTo(pv, 'rotation', { duration: 0.8, ease: 'power3' });
    var lastX = 0;
    function place(e, instant) {
      var W = pv.offsetWidth, H = pv.offsetHeight;
      var x = clamp(e.clientX + 36, 12, w.innerWidth - W - 12), y = clamp(e.clientY - H * 0.6, 80, w.innerHeight - H - 12);
      if (instant) { gsap.set(pv, { x: x, y: y }); xTo(x); yTo(y); } else { xTo(x); yTo(y); }
      rTo(clamp((e.clientX - lastX) * 0.4, -6, 6)); lastX = e.clientX;
    }
    $$('.svc').forEach(function (row) {
      var src = row.getAttribute('data-preview');
      var btn = $('.svc__btn', row);
      btn.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse') return;
        // sem foto real, ou linha já aberta (a prévia cobriria o texto): nada de prévia
        if (!src || row.classList.contains('is-open')) { pv.classList.remove('is-on'); onRow = null; return; }
        if (onRow !== src) {
          var next = imgs[1 - cur];
          next.src = src; next.classList.add('is-on'); imgs[cur].classList.remove('is-on'); cur = 1 - cur;
        }
        var wasOff = !pv.classList.contains('is-on');
        onRow = src; pv.classList.add('is-on'); place(e, wasOff);
      });
      btn.addEventListener('pointermove', function (e) { if (onRow && e.pointerType === 'mouse') place(e); });
      btn.addEventListener('pointerleave', function () { pv.classList.remove('is-on'); onRow = null; });
      btn.addEventListener('click', function () { if (row.classList.contains('is-open')) { pv.classList.remove('is-on'); onRow = null; } });
    });
  });

  /* =============== Processo: trilho que se desenha com a rolagem =============== */
  safe('process', function () {
    var steps = $$('.step');
    if (!hasST || reduce) { steps.forEach(function (s) { s.classList.add('is-on'); }); return; }
    var rail = $('.steps__rail i');
    if (rail) {
      gsap.fromTo(rail, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.steps', start: 'top 72%', end: 'bottom 55%', scrub: 0.5 } });
    }
    steps.forEach(function (s, i) {
      ST.create({ trigger: s, start: 'top ' + (72 - i * 4) + '%', onEnter: function () { s.classList.add('is-on'); }, onLeaveBack: function () { s.classList.remove('is-on'); } });
    });
  });

  /* =============== Orçamento: monta a mensagem do WhatsApp =============== */
  safe('quote', function () {
    var form = $('#quote-form'), send = $('#quote-send'), bubble = $('#quote-preview');
    var ideia = $('#f-ideia'), err = $('#f-ideia-err');
    if (!form) return;
    function val(n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; }
    function build() {
      var L = ['Olá, Victor! Vim pelo site e quero fazer um orçamento.'];
      var rows = [['Nome', val('nome')], ['Ideia', val('ideia')], ['Local do corpo', val('local')], ['Tamanho', val('tamanho')], ['Serviço', val('servico')], ['Cidade', val('cidade')]];
      var any = rows.some(function (r) { return r[1]; });
      if (any) L.push('');
      rows.forEach(function (r) { if (r[1]) L.push('*' + r[0] + ':* ' + r[1]); });
      if (form.elements.referencias.checked) { if (!any) L.push(''); L.push('Tenho fotos de referência e vou mandar aqui.'); }
      return L.join('\n');
    }
    function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function renderPreview(text) {
      var html = text.split('\n').map(function (line) {
        if (!line) return '<p aria-hidden="true">&nbsp;</p>';
        return '<p>' + esc(line).replace(/\*([^*]+)\*/g, '<b>$1</b>') + '</p>';
      }).join('');
      if (!val('ideia')) html += '<p class="muted">Sua ideia aparece aqui…</p>';
      bubble.innerHTML = html;
    }
    var t = 0;
    function update() {
      var text = build();
      send.href = WA + encodeURIComponent(text); // link real, atualizado a cada digitação
      clearTimeout(t); t = setTimeout(function () { renderPreview(text); }, 120);
      if (val('ideia') && ideia.getAttribute('aria-invalid') === 'true') { ideia.removeAttribute('aria-invalid'); err.textContent = ''; }
    }
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', function (e) { e.preventDefault(); send.click(); });
    send.addEventListener('click', function (e) {
      if (!val('ideia')) {
        e.preventDefault();
        ideia.setAttribute('aria-invalid', 'true');
        err.textContent = 'Conte a sua ideia para o Victor poder fazer o orçamento.';
        scrollToEl(ideia.closest('.field'), false);
        ideia.focus({ preventScroll: true });
      }
    });
    update(); renderPreview(build());
  });

  /* =============== Perguntas frequentes: <details> com abertura animada =============== */
  safe('faq', function () {
    if (reduce || !Element.prototype.animate) return; // sem animação: o <details> nativo funciona igual
    $$('.qa').forEach(function (det) {
      var sum = $('summary', det), body = $('.qa__a', det), anim = null;
      sum.addEventListener('click', function (e) {
        e.preventDefault();
        if (anim) { anim.cancel(); anim = null; }
        var refresh = function () { if (hasST) ST.refresh(); };
        if (det.open && !det.classList.contains('is-closing')) {
          det.classList.add('is-closing');
          anim = body.animate([{ height: body.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.65,0,.35,1)' });
          anim.onfinish = function () { det.open = false; det.classList.remove('is-closing'); anim = null; refresh(); };
        } else {
          det.classList.remove('is-closing');
          det.open = true;
          anim = body.animate([{ height: '0px', opacity: 0 }, { height: body.offsetHeight + 'px', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' });
          anim.onfinish = function () { anim = null; refresh(); };
        }
      });
    });
  });

  /* =============== Contato: copiar endereço + mapa =============== */
  safe('contact', function () {
    $$('[data-copy]').forEach(function (btn) {
      var label = $('[data-copy-label]', btn), status = $('[data-copy-status]'), orig = label.textContent, t = 0;
      btn.addEventListener('click', function () {
        var text = $(btn.getAttribute('data-copy')).textContent.replace(/\s+/g, ' ').trim();
        function done(ok) {
          label.textContent = ok ? 'Endereço copiado' : 'Selecione e copie';
          btn.classList.toggle('is-done', ok);
          if (status) status.textContent = ok ? 'Endereço copiado para a área de transferência.' : 'Não foi possível copiar. O endereço foi selecionado.';
          clearTimeout(t); t = setTimeout(function () { label.textContent = orig; btn.classList.remove('is-done'); if (status) status.textContent = ''; }, 2600);
        }
        function fallback() {
          var ta = d.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          d.body.appendChild(ta); ta.select();
          var ok = false; try { ok = d.execCommand('copy'); } catch (_) {}
          d.body.removeChild(ta);
          if (!ok) { var r = d.createRange(); r.selectNodeContents($(btn.getAttribute('data-copy'))); var s = w.getSelection(); s.removeAllRanges(); s.addRange(r); }
          done(ok);
        }
        if (navigator.clipboard && w.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        else fallback();
      });
    });
    var frame = $('.map__frame');
    if (frame) frame.addEventListener('load', function () { frame.classList.add('is-loaded'); });
  });

  /* =============== Cursor customizado (mouse, sem movimento reduzido) =============== */
  safe('cursor', function () {
    if (!fineMQ.matches || reduce || !hasGsap) return;
    var c = $('.cursor');
    root.classList.add('has-cursor');
    var xTo = gsap.quickTo(c, 'x', { duration: 0.32, ease: 'power3' }), yTo = gsap.quickTo(c, 'y', { duration: 0.32, ease: 'power3' });
    var shown = false;
    d.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      if (!shown) { gsap.set(c, { x: e.clientX, y: e.clientY }); shown = true; }
      xTo(e.clientX); yTo(e.clientY);
      var t = e.target;
      c.classList.toggle('is-view', !!(t.closest && t.closest('[data-cursor="view"]')));
      c.classList.toggle('is-hidden', !!(t.closest && t.closest('input,textarea,select,iframe,label,.lb')));
    }, { passive: true });
    d.documentElement.addEventListener('pointerleave', function () { c.classList.add('is-hidden'); });
  });

  /* =============== Pequenos acabamentos =============== */
  safe('misc', function () {
    var y = $('[data-year]'); if (y) y.textContent = String(new Date().getFullYear());
    if (hasST) {
      if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { ST.refresh(); });
      w.addEventListener('load', function () { ST.refresh(); });
    }
  });
})();
