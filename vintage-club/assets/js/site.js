/* Vintage Club · site.js
   Aprimoramento progressivo: todo o conteúdo já está no HTML. Este arquivo só adiciona
   comportamento (ticket, menu, vídeos, perguntas, mapa) e movimento (GSAP, ScrollTrigger, SplitText, Lenis). */
(function () {
  'use strict';

  var d = document, w = window, html = d.documentElement;
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

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function headH() { var h = $('.head'); return h ? h.offsetHeight : 64; }
  function brl(v) { return 'R$ ' + Number(v).toLocaleString('pt-BR'); }
  function showIntro() { html.classList.remove('js-intro'); }
  function refreshST(delay) { if (hasG) setTimeout(function () { ST.refresh(); }, delay || 0); }

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

  function scrollToEl(el, instant) {
    if (!el) return;
    var off = -(headH() + 12);
    /* o ticket entra com transform; mede pelo invólucro, que não se move */
    if (el.id === 'ficha' && el.parentNode) el = el.parentNode;
    if (instant) {
      var y0 = el.getBoundingClientRect().top + w.pageYOffset + off;
      if (lenis) lenis.scrollTo(y0, { immediate: true, force: true }); else w.scrollTo(0, y0);
      return;
    }
    if (lenis) { lenis.scrollTo(el, { offset: off, duration: 1.2 }); return; }
    var y = el.getBoundingClientRect().top + w.pageYOffset + off;
    w.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ------------------------------------------------------------------
     Menu em tela cheia (celular e tablet): trava o scroll, prende o foco,
     deixa o resto da página inerte e fecha com Esc ou ao tocar num link
  ------------------------------------------------------------------ */
  var menu = $('#menu'), menuBtn = $('#menu-btn');
  var menuLbl = menuBtn ? $('.menu-btn-l', menuBtn) : null;
  var inertEls = [$('#conteudo'), $('.foot'), $('.mbar'), $('.pill'), $('.skip'), $('.brand'), $('.rail')];

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
    var wasOpen = menu && !menu.hidden;
    if (wasOpen) closeMenu(false);
    setTimeout(function () { scrollToEl(t); }, wasOpen ? 40 : 0);
    if (w.history && history.replaceState) history.replaceState(null, '', id);
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    try { t.focus({ preventScroll: true }); } catch (err) { /* sem foco */ }
  });

  /* ------------------------------------------------------------------
     Palavras que se alternam no título do hero + cota que mede a palavra
  ------------------------------------------------------------------ */
  var heroInView = true;
  (function swapWords() {
    var swap = $('.swap');
    if (!swap || reduce) return;
    var words = $$('.swap-w', swap), cota = $('.swap-cota', swap);
    if (words.length < 2) return;
    html.classList.add('swap-on');
    var i = 0;
    function measure() { if (cota) cota.style.setProperty('--cw', Math.round(words[i].offsetWidth) + 'px'); }
    function first() { words[0].classList.add('is-on'); setTimeout(measure, 380); }
    function next() {
      if (d.hidden || !heroInView) return;
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
    }
    if (hasG) setTimeout(first, 380); else first();
    setInterval(next, 2600);
    w.addEventListener('resize', measure);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(measure);
    var hero = $('.hero');
    if (hero && 'IntersectionObserver' in w) {
      new IntersectionObserver(function (es) { heroInView = es[0].isIntersecting; }).observe(hero);
    }
  })();

  /* ------------------------------------------------------------------
     Transferidor do trilho: 0° no topo, 90° no fim da página
  ------------------------------------------------------------------ */
  (function rail() {
    var secs = $$('main [data-label]');
    var needle = $('#rail-needle'), sweep = $('#rail-sweep'), deg = $('#rail-deg');
    var railN = $('#rail-n'), railL = $('#rail-l');
    var miniN = $('#mini-needle'), miniD = $('#mini-deg');
    var navLinks = $$('.nav a');
    var NAV = { metodo: '#metodo', servicos: '#servicos', equipe: '#equipe', formacao: '#formacao', agendar: '#agendar', contato: '#contato' };
    var last = -1, queued = false;
    function update() {
      queued = false;
      var max = Math.max(1, html.scrollHeight - w.innerHeight);
      var p = Math.min(1, Math.max(0, w.pageYOffset / max));
      var a = p * 90, r = a * Math.PI / 180;
      var txt = Math.round(a) + '°';
      if (needle) needle.setAttribute('transform', 'rotate(' + (-a).toFixed(2) + ' 12 12)');
      if (sweep) sweep.setAttribute('d', 'M12 12L12 108A96 96 0 0 0 ' + (12 + Math.sin(r) * 96).toFixed(2) + ' ' + (12 + Math.cos(r) * 96).toFixed(2) + 'Z');
      if (deg) deg.textContent = txt;
      if (miniN) miniN.setAttribute('transform', 'rotate(' + (-a).toFixed(2) + ' 3 3)');
      if (miniD) miniD.textContent = txt;
      var mid = w.innerHeight * 0.42, idx = 0;
      for (var k = 0; k < secs.length; k++) { if (secs[k].getBoundingClientRect().top <= mid) idx = k; }
      if (idx !== last && secs[idx]) {
        last = idx;
        if (railN) railN.textContent = 'Folha ' + (idx + 1 < 10 ? '0' : '') + (idx + 1);
        if (railL) railL.textContent = secs[idx].getAttribute('data-label');
        var href = NAV[secs[idx].id] || '';
        navLinks.forEach(function (l) { l.classList.toggle('is-active', l.getAttribute('href') === href); });
      }
    }
    function onScroll() { if (!queued) { queued = true; w.requestAnimationFrame(update); } }
    w.addEventListener('scroll', onScroll, { passive: true });
    w.addEventListener('resize', onScroll);
    update();
  })();

  /* ------------------------------------------------------------------
     Vídeos: pausam fora da tela, só um toca por vez, botão de pausa
  ------------------------------------------------------------------ */
  (function videos() {
    var vids = $$('video[data-vid]');
    if (!vids.length) return;
    var ratio = [];
    vids.forEach(function (v, i) {
      ratio[i] = 0;
      v._user = !!reduce;           /* com movimento reduzido, nada toca sozinho */
      v.muted = true;
      if (reduce) { v.removeAttribute('autoplay'); v.pause(); }
    });
    function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    function sync() {
      var best = -1, br = 0;
      vids.forEach(function (v, i) { if (!v._user && ratio[i] > 0.2 && ratio[i] > br) { best = i; br = ratio[i]; } });
      vids.forEach(function (v, i) {
        if (i === best && !d.hidden) { if (v.paused) play(v); }
        else if (!v.paused) v.pause();
      });
    }
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
        }
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
    var ficha = $('#ficha');
    var list = $('#t-list'), totalEl = $('#t-total'), waBtn = $('#t-wa'), live = $('#t-live'), countEl = $('#board-count');
    var pill = $('#pill'), pillN = $('#pill-n'), pillT = $('#pill-t');
    var mbar = $('#mbar'), mbarBtn = $('#mbar-btn'), mbarL = $('#mbar-l'), mbarN = $('#mbar-n'), mbarT = $('#mbar-t'), mbarWa = $('#mbar-wa');
    var cmpLen = $('#cmp-len'), cmpDim = $('#cmp-dim'), cmpDiff = $('#cmp-diff');
    var cmpBars = $$('.cmp-bar[data-k]'), cmpVals = $$('.cmp-v[data-k]');
    var picked = [], cur = 1, newId = null, shownTotal = 0, fichaVisible = false;

    rows.forEach(function (r, i) { r.style.setProperty('--d', i); });

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

    board.addEventListener('click', function (e) {
      var pc = e.target.closest('.pc');
      if (!pc) return;
      var row = pc.closest('.svc'), id = row.getAttribute('data-id');
      var was = pc.getAttribute('aria-pressed') === 'true';
      $$('.pc', row).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      var idx = -1;
      picked.forEach(function (p, k) { if (p.id === id) idx = k; });
      if (was) {
        if (idx > -1) picked.splice(idx, 1);
        row.classList.remove('is-picked');
        announce(row.getAttribute('data-name') + ' saiu do ticket.');
      } else {
        pc.setAttribute('aria-pressed', 'true');
        row.classList.add('is-picked');
        var item = { id: id, name: row.getAttribute('data-name'), len: pc.getAttribute('data-len'), v: pc.getAttribute('data-v') === '' ? null : +pc.getAttribute('data-v') };
        if (idx > -1) picked[idx] = item; else picked.push(item);
        newId = id;
        announce(item.name + (item.len ? ', ' + item.len.toLowerCase() : '') + ' entrou no ticket.');
      }
      render();
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
        announce('Serviço removido. ' + (picked.length ? 'Total estimado ' + totalLabel() + '.' : 'O ticket está vazio.'));
        var nextBtn = $('.t-rm', list);
        if (nextBtn) nextBtn.focus(); else { var lnk = $('.ficha-empty a', list); if (lnk) lnk.focus(); }
      }
      if (hasG && !reduce && li) {
        li.style.overflow = 'hidden';
        G.to(li, { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0, duration: 0.35, ease: 'power2.inOut', onComplete: go });
      } else go();
    }

    var lastTotal = { total: 0, consult: false };
    function totalLabel() {
      if (!lastTotal.total && lastTotal.consult) return 'a consultar';
      return brl(lastTotal.total) + (lastTotal.consult ? ' +' : '');
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
        }).join('\n') + '\n\nTotal estimado: ' + tt;
      }
      var href = WA + encodeURIComponent(msg);
      waBtn.href = href;
      if (ficha) ficha.classList.toggle('has-items', n > 0);
      if (pillN) pillN.textContent = lbl;
      if (pillT) pillT.textContent = ttCap;
      if (mbar) mbar.classList.toggle('has-items', n > 0);
      if (mbarBtn) mbarBtn.setAttribute('href', n ? '#ficha' : '#agendar');
      if (mbarL) mbarL.textContent = n ? 'Ver ticket' : 'Agendar horário';
      if (mbarN) mbarN.textContent = n ? '\u00a0· ' + lbl : '';
      if (mbarT) mbarT.textContent = n ? ttCap : '';
      if (mbarWa) {
        mbarWa.href = href;
        mbarWa.setAttribute('aria-label', n ? 'Enviar o ticket pelo WhatsApp' : 'Agendar pelo WhatsApp');
      }
      paintPill();
    }

    function paintPill() {
      if (!pill) return;
      var show = picked.length > 0 && !fichaVisible;
      if (show && pill.hidden) {
        pill.hidden = false;
        if (hasG && !reduce) G.fromTo(pill, { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: 'expo.out', clearProps: 'transform,opacity,visibility' });
      } else if (!show && !pill.hidden) {
        pill.hidden = true;
      }
    }
    if (ficha && 'IntersectionObserver' in w) {
      new IntersectionObserver(function (es) { fichaVisible = es[0].isIntersecting; paintPill(); }, { threshold: 0.25 }).observe(ficha);
    }

    var no = $('#t-no');
    if (no) {
      var dt = new Date();
      no.textContent = String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + String(dt.getFullYear()).slice(2);
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
    function setQA(q, a, open, anim) {
      q.setAttribute('aria-expanded', open ? 'true' : 'false');
      var inner = a.firstElementChild;
      if (open) {
        a.removeAttribute('hidden');
        if (anim && hasG && !reduce && inner) {
          G.fromTo(inner, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.55, ease: 'expo.out', onComplete: function () { G.set(inner, { clearProps: 'height,opacity' }); refreshST(0); } });
        } else refreshST(0);
      } else {
        var shut = function () {
          if (untilFound) a.setAttribute('hidden', 'until-found'); else a.hidden = true;
          if (hasG && inner) G.set(inner, { clearProps: 'height,opacity' });
          refreshST(0);
        };
        if (anim && hasG && !reduce && inner) G.to(inner, { height: 0, opacity: 0, duration: 0.4, ease: 'power3.inOut', onComplete: shut });
        else shut();
      }
    }
    items.forEach(function (it, i) {
      var q = $('.faq-q', it), a = $('.faq-a', it);
      if (!q || !a) return;
      setQA(q, a, i === 0, false);
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
     Etapas do método: etapa ativa calculada pela posição (robusto a saltos)
  ------------------------------------------------------------------ */
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
      var line = w.innerHeight * 0.62, idx = 0;
      steps.forEach(function (s, k) { if (s.getBoundingClientRect().top <= line) idx = k; });
      setStep(idx);
    }
    if (reduce || !hasG) return function () {};
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
  function rise(targets, vars, trigger, start) {
    var els = G.utils.toArray(targets);
    if (!els.length) return;
    var base = { y: 28, opacity: 0, duration: 1.1, ease: 'expo.out', clearProps: 'transform,opacity' };
    for (var k in vars) base[k] = vars[k];
    els.forEach(function (el) {
      var v = {}; for (var j in base) v[j] = base[j];
      v.scrollTrigger = { trigger: trigger || el, start: start || 'top 90%', end: END, toggleActions: 'play none none none' };
      G.from(el, v);
    });
  }

  function whenFonts(cb) {
    var called = false;
    function go() { if (!called) { called = true; cb(); } }
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(go);
    setTimeout(go, 700);
  }

  whenFonts(function () {
    var mm = G.matchMedia();

    /* ---------- Entrada orquestrada da capa ---------- */
    (function heroIntro() {
      var tl = G.timeline({ defaults: { ease: 'expo.out' } });
      var split = null, lines = $$('.hero-t-a'), mastSplit = null, chars = $$('.mast-t > *');
      if (Split) {
        split = new Split('.hero-t-a', { type: 'lines', mask: 'lines' }); lines = split.lines;
        mastSplit = new Split('.mast-t .mast-a, .mast-t .mast-b', { type: 'chars' }); chars = mastSplit.chars;
      }
      tl.from('.hero-meta', { clipPath: 'inset(0% 100% 0% 0%)', duration: 1.2, ease: 'expo.inOut' }, 0)
        .from('.mast-cota', { scaleX: 0, transformOrigin: '50% 50%', duration: 1.1, ease: 'expo.inOut' }, 0.1)
        .from('.mast-cota-l', { opacity: 0, y: 6, duration: 0.7 }, 0.75)
        .from(chars, { yPercent: 55, opacity: 0, duration: 1.1, stagger: 0.04 }, 0.12)
        .from(lines, { yPercent: 110, duration: 1.1, stagger: 0.08 }, 0.4)
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
        if (mastSplit) mastSplit.revert();
        G.set('.hero-meta, .hero-frame, .hero-cota, .mast-cota', { clearProps: 'clipPath,transform' });
      });
      showIntro();
    })();

    /* ---------- Régua corrida: acelera e inverte com o scroll ---------- */
    (function rulerSpeed() {
      var ruler = $('.ruler'), track = ruler && $('.ruler-track', ruler), set = ruler && $('.ruler-set', ruler);
      if (!track || !set) return;
      var x = 0, dir = 1, boost = 0, lastY = w.pageYOffset, width = set.offsetWidth, on = true;
      if ('IntersectionObserver' in w) new IntersectionObserver(function (es) { on = es[0].isIntersecting; }).observe(ruler);
      w.addEventListener('resize', function () { width = set.offsetWidth; });
      G.ticker.add(function (time, dt) {
        var y = w.pageYOffset, dy = y - lastY;
        lastY = y;
        if (!on || !width) return;
        if (dy) dir = dy > 0 ? 1 : -1;
        boost += (Math.min(Math.abs(dy), 40) - boost) * 0.08;
        x -= (0.6 + boost * 0.45) * dir * (dt / 16.67);
        if (x <= -width) x += width;
        if (x > 0) x -= width;
        track.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
      });
    })();

    /* ---------- Títulos: linhas sobem por trás de uma máscara ---------- */
    $$('.sh-t, .step-t, .slide-q p, .cmp-t').forEach(function (el) {
      var split = Split ? new Split(el, { type: 'lines', mask: 'lines' }) : null;
      G.from(split ? split.lines : el, {
        yPercent: 110, opacity: split ? 1 : 0, duration: 1.15, ease: 'expo.out', stagger: 0.09,
        scrollTrigger: { trigger: el, start: 'top 90%', end: END, toggleActions: 'play none none none' },
        onComplete: function () { if (split) split.revert(); }
      });
    });

    /* Réguas das seções se desenham da esquerda para a direita */
    $$('.sh-k').forEach(function (el) {
      G.from(el, { clipPath: 'inset(0% 100% 0% 0%)', duration: 1.3, ease: 'expo.inOut', clearProps: 'clipPath', scrollTrigger: { trigger: el, start: 'top 92%', end: END, toggleActions: 'play none none none' } });
    });

    /* Manifesto: revelação palavra a palavra ligada ao scroll; fotos cruzam a composição */
    (function manifesto() {
      var el = $('.mani-t');
      if (el && Split) {
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
    rise('.sh-lede, .cmp, .mani-sub, .mani-note, .step-d, .step-tag, .step-note, .fund-role, .fund-bio p, .fund-cta, .facts, .schools li, .form-kicker, .form-p, .form-ask, .form-cta, .form-placa, .slide-k, .slide-c, .quote, .score-n, .link-out, .howto li, .book-wa, .faq-item, .addr, .visit-cta, .info-row, .planta, .stamp, .foot-nav, .board-foot, .gal-item figcaption');
    rise('.svc', { y: 22, duration: 0.9 });
    rise('.team li', { y: 44 }, null, 'top 92%');

    /* Ticket: entra como um papel destacado */
    G.from('.ficha', { y: 50, rotation: -3, opacity: 0, transformOrigin: '50% 100%', duration: 1.2, ease: 'expo.out', clearProps: 'transform,opacity',
      scrollTrigger: { trigger: '.ficha-wrap', start: 'top 88%', end: END, toggleActions: 'play none none none' } });

    /* Imagens revelam com clip-path dentro das marcas de corte */
    $$('.rv-img img, .form-placa-ph img').forEach(function (img) {
      /* dentro das marcas de corte a moldura não recorta, então a foto não cresce */
      var sc = getComputedStyle(img.parentNode).overflow === 'hidden' ? 1.12 : 1;
      G.fromTo(img, { clipPath: 'inset(100% 0% 0% 0%)', scale: sc }, {
        clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 1.1, ease: 'expo.inOut', clearProps: 'clipPath,transform',
        scrollTrigger: { trigger: img.parentNode, start: 'top 90%', end: END, toggleActions: 'play none none none' }
      });
    });

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
    $$('.count').forEach(function (el) {
      var to = parseFloat(el.getAttribute('data-to')), dec = +(el.getAttribute('data-dec') || 0), suf = el.getAttribute('data-suffix') || '';
      var final = el.textContent, o = { v: 0 };
      ST.create({
        trigger: el, start: 'top 90%', end: END, once: true,
        onEnter: function () {
          G.to(o, { v: to, duration: 1.8, ease: 'power3.out',
            onUpdate: function () { el.textContent = o.v.toFixed(dec).replace('.', ',') + suf; },
            onComplete: function () { el.textContent = final; } });
        }
      });
    });

    /* Estrelas */
    $$('.stars').forEach(function (s) {
      if (s.closest('.hero')) return;
      G.from($$('svg', s), { scale: 0, rotation: -70, transformOrigin: '50% 50%', duration: 0.8, ease: 'back.out(2.4)', stagger: 0.09,
        scrollTrigger: { trigger: s, start: 'top 92%', end: END, toggleActions: 'play none none none' } });
    });

    /* Rodapé: o nome sobe letra a letra */
    (function footMark() {
      var el = $('.foot-mark');
      if (!el || !Split) return;
      var s = new Split(el, { type: 'chars' });
      G.from(s.chars, { yPercent: 100, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.035, onComplete: function () { s.revert(); },
        scrollTrigger: { trigger: el, start: 'top 95%', end: END, toggleActions: 'play none none none' } });
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

    /* ---------- A prancha do método se desenha conforme o scroll ---------- */
    (function plate() {
      var svg = $('.plate'), stepsEl = $('.steps');
      if (!svg || !stepsEl) return;
      var lupa = $('.lupa');
      var tl = G.timeline({ scrollTrigger: { trigger: stepsEl, start: 'top 75%', end: 'bottom 70%', scrub: 0.8 } });
      $$('.pl-layer', svg).forEach(function (layer, i) {
        var draws = $$('.pl-ink, .pl-fine, .pl-ray, .pl-red, .pl-cut, .pl-cut-fine, .pl-lead, .pl-mirror', layer);
        var dashes = $$('.pl-guide, .pl-sec, .pl-det', layer);
        var texts = $$('text', layer);
        var pivots = $$('.pl-pivot', layer);
        var rays = $$('.pl-ray', layer);
        draws.forEach(function (p) {
          var L = Math.ceil(p.getTotalLength ? p.getTotalLength() : 0) + 2;
          p.style.strokeDasharray = L + ' ' + L;
          p.style.strokeDashoffset = L;
        });
        var at = 'l' + i;
        tl.addLabel(at);
        tl.to(draws, { strokeDashoffset: 0, duration: 1, ease: 'none', stagger: 0.1 }, at);
        if (dashes.length) tl.fromTo(dashes, { opacity: 0 }, { opacity: 1, duration: 0.5, stagger: 0.12 }, at + '+=0.15');
        if (pivots.length) tl.fromTo(pivots, { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.3 }, at + '+=0.1');
        if (rays.length) tl.from(rays, { rotation: function (k, el) { return +el.getAttribute('data-ang'); }, svgOrigin: '492 330', duration: 1.1, ease: 'power2.inOut', stagger: 0.12 }, at + '+=0.25');
        if (texts.length) tl.fromTo(texts, { opacity: 0 }, { opacity: 1, duration: 0.35, stagger: 0.08 }, at + '+=0.55');
        if (i === 1 && lupa) tl.fromTo(lupa, { scale: 0.4, autoAlpha: 0, rotation: -30 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.8, ease: 'back.out(1.6)' }, at + '+=0.7');
        tl.to({}, { duration: 0.7 });
      });
      setStepFromScroll();
    })();

    /* ---------- Desktop: galeria horizontal com pin + scrub ---------- */
    mm.add('(min-width: 1024px)', function () {
      var sec = $('.gal-sec'), pin = sec && $('.gal-pin', sec), view = sec && $('.gal-view', sec), track = sec && $('.gal-track', sec);
      if (!track) return;
      sec.classList.add('is-pinned');
      var dist = function () { return Math.max(0, track.scrollWidth - view.clientWidth); };
      var tw = G.to(track, {
        x: function () { return -dist(); }, ease: 'none',
        scrollTrigger: { trigger: pin, start: function () { return 'top ' + headH() + 'px'; }, end: function () { return '+=' + dist(); }, pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1 }
      });
      $$('.gal-item', track).forEach(function (it, i) {
        G.fromTo(it, { y: i % 2 ? 36 : -12 }, { y: i % 2 ? -12 : 30, ease: 'none',
          scrollTrigger: { trigger: it, containerAnimation: tw, start: 'left right', end: 'right left', scrub: true } });
      });
      return function () { sec.classList.remove('is-pinned'); G.set(track, { clearProps: 'transform' }); };
    });

    /* link direto (#agendar etc.): depois que o pin muda a altura da página, volta ao alvo */
    function jumpToHash() {
      var id = w.location.hash && w.location.hash.length > 1 ? w.location.hash.slice(1) : '';
      var t = id ? d.getElementById(decodeURIComponent(id)) : null;
      if (t) scrollToEl(t, true);
    }
    var loaded = d.readyState === 'complete';
    w.addEventListener('load', function () { ST.refresh(); jumpToHash(); });
    ST.refresh();
    if (loaded) jumpToHash();
  });
})();
