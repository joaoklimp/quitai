/* =====================================================================
   "Na maca": braço sem tatuagem; a tatuagem aparece só por onde o cursor passa.
   - Mouse: cada movimento sobre o braço "pinta" a tatuagem com um pincel de
     tinta que se espalha um pouco; ao sair do braço, a tinta some devagar.
   - Toque: segure o dedo no braço por um instante e arraste para pintar
     (enquanto pinta, a página não rola); ao soltar, a tinta some.
     Um toque rápido ou um arrasto direto continuam rolando a página.
   - Teclado / leitor de tela: botão "Ver a tatuagem" mostra a peça inteira.
   - Sem JS: o CSS mostra a tatuagem no :hover e no :focus-within.
   - Movimento reduzido: sem a tinta "crescendo" e sem esmaecer.
   Para trocar o braço: substitua as duas imagens e o contorno ARM abaixo
   (coordenadas em pixels da imagem de 554 x 742).
   ===================================================================== */
(function () {
  'use strict';

  var d = document, w = window;
  var stage = d.querySelector('[data-skin]');
  if (!stage) return;

  var W = 554, H = 742;
  // contorno do antebraço, 14 px mais largo que a borda real (não pisca na borda)
  var ARM = [[460,0],[460,30],[460,60],[461,90],[464,120],[465,150],[464,180],[461,210],[456,240],[452,270],[449,300],[444,330],[439,360],[434,390],[426,420],[416,450],[409,480],[406,510],[404,540],[404,570],[405,600],[403,630],[398,660],[394,690],[396,720],[398,741],[187,741],[187,720],[186,690],[182,660],[183,630],[182,600],[174,570],[169,540],[164,510],[165,480],[159,450],[154,420],[147,390],[144,360],[145,330],[145,300],[146,270],[147,240],[148,210],[147,180],[144,150],[143,120],[142,90],[143,60],[147,30],[153,0]];

  var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = stage.querySelector('.skin__canvas');
  var inkImg = stage.querySelector('.skin__ink');
  var btn = d.querySelector('[data-skin-toggle]');
  var status = d.querySelector('[data-skin-status]');
  var cursor = d.querySelector('.cursor');
  if (!canvas || !canvas.getContext || !inkImg) return;

  stage.classList.add('is-live');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  var mask = d.createElement('canvas'); mask.width = W; mask.height = H; // tinta já assentada
  var mctx = mask.getContext('2d');
  var tmp = d.createElement('canvas'); tmp.width = W; tmp.height = H;   // composição do quadro
  var tctx = tmp.getContext('2d');

  /* ---------- imagem da tatuagem: carrega quando a seção se aproxima ---------- */
  var tattoo = new Image(), ready = false;
  tattoo.decoding = 'async';
  tattoo.onload = function () { ready = true; kick(); };
  function load() { if (!tattoo.src) tattoo.src = inkImg.getAttribute('data-src') || inkImg.src; }
  if ('IntersectionObserver' in w) {
    var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { load(); io.disconnect(); } }, { rootMargin: '600px 0px' });
    io.observe(stage);
  } else load();

  /* ---------- geometria ---------- */
  function inside(x, y) {
    var c = false;
    for (var i = 0, j = ARM.length - 1; i < ARM.length; j = i++) {
      var xi = ARM[i][0], yi = ARM[i][1], xj = ARM[j][0], yj = ARM[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function toImg(cx, cy) {
    var r = canvas.getBoundingClientRect();
    return { x: (cx - r.left) * W / r.width, y: (cy - r.top) * H / r.height, s: W / r.width };
  }

  /* ---------- pincel de tinta ---------- */
  var seed = 7;
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
  var drops = [];       // gotas ainda crescendo (desenhadas a cada quadro)
  var GROW = reduce ? 0 : 260;  // ms para a gota se espalhar
  function blob(c, x, y, r, a) {
    if (r <= 0.5) return;
    var g = c.createRadialGradient(x, y, r * 0.35, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  function stamp(x, y, r, now) {
    drops.push({ x: x, y: y, r: r * (0.85 + rnd() * 0.3), t: now, a: 0.95 });
    // respingos pequenos em volta, para a borda parecer tinta e não um círculo
    for (var i = 0; i < 2; i++) {
      var ang = rnd() * Math.PI * 2, dist = r * (0.55 + rnd() * 0.45);
      drops.push({ x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist, r: r * (0.28 + rnd() * 0.3), t: now + 40 + rnd() * 80, a: 0.8 });
    }
  }
  var last = null;
  function paint(x, y, r) {
    var now = performance.now();
    if (last) {
      var dx = x - last.x, dy = y - last.y, dist = Math.hypot(dx, dy), step = r * 0.35;
      for (var k = step; k < dist; k += step) stamp(last.x + dx * k / dist, last.y + dy * k / dist, r, now);
    }
    stamp(x, y, r, now);
    last = { x: x, y: y };
    if (!painted) { painted = true; setState(true); }
    fadeTo(1, 0);
    kick();
  }

  /* ---------- quadro: tinta assentada + gotas crescendo, recorta a tatuagem ---------- */
  var alpha = 1, alphaFrom = 1, alphaTo = 1, fadeT0 = 0, fadeDur = 0, full = false;
  var raf = 0;
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function fadeTo(to, ms) {
    if (to === 1 && alpha < 1) { // voltou durante o esmaecer: assenta o que já sumiu, sem pulo
      mctx.globalCompositeOperation = 'destination-in';
      mctx.fillStyle = 'rgba(0,0,0,' + alpha + ')'; mctx.fillRect(0, 0, W, H);
      mctx.globalCompositeOperation = 'source-over';
      alpha = 1;
    }
    alphaFrom = alpha; alphaTo = to; fadeT0 = performance.now(); fadeDur = reduce ? 0 : ms;
    if (!fadeDur) alpha = to;
  }
  function frame(now) {
    raf = 0;
    // esmaecer
    if (alpha !== alphaTo) {
      var k = fadeDur ? Math.min(1, (now - fadeT0) / fadeDur) : 1;
      alpha = alphaFrom + (alphaTo - alphaFrom) * (1 - Math.pow(1 - k, 2));
      if (k >= 1 && alphaTo === 0) { mctx.clearRect(0, 0, W, H); tctx.clearRect(0, 0, W, H); drops = []; full = false; last = null; painted = false; setState(false); alpha = 1; alphaFrom = alphaTo = 1; draw(); return; }
    }
    // gotas: crescem e depois são assentadas na máscara
    tctx.clearRect(0, 0, W, H);
    tctx.drawImage(mask, 0, 0);
    var keep = [];
    for (var i = 0; i < drops.length; i++) {
      var dr = drops[i], age = now - dr.t;
      if (age < 0) { keep.push(dr); continue; }
      var g = GROW ? Math.min(1, age / GROW) : 1, e = 1 - Math.pow(1 - g, 3);
      if (g >= 1) blob(mctx, dr.x, dr.y, dr.r, dr.a);
      else { blob(tctx, dr.x, dr.y, dr.r * e, dr.a); keep.push(dr); }
    }
    if (keep.length !== drops.length) { tctx.clearRect(0, 0, W, H); tctx.drawImage(mask, 0, 0); keep.forEach(function (dr) { var age = now - dr.t; if (age >= 0) blob(tctx, dr.x, dr.y, dr.r * (1 - Math.pow(1 - Math.min(1, age / GROW), 3)), dr.a); }); }
    drops = keep;
    draw();
    if (drops.length || alpha !== alphaTo) kick();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!ready || (!painted && !full)) return;
    ctx.globalAlpha = alpha;
    if (full) { ctx.drawImage(tattoo, 0, 0, W, H); ctx.globalAlpha = 1; return; }
    ctx.drawImage(tattoo, 0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(tmp, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function clearInk(ms) { if ((painted || full) && alphaTo !== 0) { fadeTo(0, ms); kick(); } }

  /* ---------- estados (rótulo, dica, leitor de tela) ---------- */
  var painted = false, held = false;
  function setState(v) {
    stage.classList.toggle('is-inked', v);
    if (btn) { btn.setAttribute('aria-pressed', v && full ? 'true' : 'false'); btn.querySelector('[data-skin-label]').textContent = v && full ? 'Esconder a tatuagem' : 'Ver a tatuagem'; }
    if (status) status.textContent = v ? 'Tatuagem aparecendo: leão em realismo preto e cinza (foto real).' : 'Braço sem tatuagem (simulação digital).';
  }

  /* ---------- mouse: pinta por onde passa ---------- */
  var BRUSH = 48; // raio do pincel em pixels da imagem
  stage.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' || held) return;
    var q = toImg(e.clientX, e.clientY), on = inside(q.x, q.y);
    if (cursor) cursor.classList.toggle('is-ink', on);
    stage.classList.toggle('is-over-arm', on);
    if (on) paint(q.x, q.y, BRUSH);
    else { last = null; clearInk(900); }
  });
  stage.addEventListener('pointerleave', function (e) {
    if (cursor) cursor.classList.remove('is-ink');
    stage.classList.remove('is-over-arm');
    if (e.pointerType === 'mouse' && !held) { last = null; clearInk(900); }
  });

  /* ---------- toque: segurar um instante e arrastar para pintar ---------- */
  var touch = null, HOLD = 160;
  stage.addEventListener('touchstart', function (e) {
    if (held || e.touches.length !== 1) return;
    var t = e.touches[0], q = toImg(t.clientX, t.clientY);
    if (!inside(q.x, q.y)) return;
    touch = { id: t.identifier, x0: t.clientX, y0: t.clientY, armed: false };
    touch.timer = setTimeout(function () {
      if (!touch) return;
      touch.armed = true;
      stage.classList.add('is-painting');
      if (w.navigator.vibrate) { try { w.navigator.vibrate(12); } catch (err) {} }
      var p = toImg(touch.x0, touch.y0); last = null; paint(p.x, p.y, BRUSH * 1.25);
    }, HOLD);
  }, { passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (!touch) return;
    var t = null;
    for (var i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === touch.id) t = e.touches[i];
    if (!t) return;
    if (!touch.armed) { // ainda não segurou: se o dedo andou, é rolagem da página
      if (Math.hypot(t.clientX - touch.x0, t.clientY - touch.y0) > 8) { clearTimeout(touch.timer); touch = null; }
      return;
    }
    if (e.cancelable) e.preventDefault(); // pintando: a página não rola
    var q = toImg(t.clientX, t.clientY);
    if (inside(q.x, q.y)) paint(q.x, q.y, BRUSH * 1.25); else last = null;
  }, { passive: false });
  function endTouch() {
    if (!touch) return;
    clearTimeout(touch.timer);
    var wasArmed = touch.armed; touch = null; last = null;
    stage.classList.remove('is-painting');
    if (wasArmed) setTimeout(function () { if (!touch) clearInk(1100); }, 450);
  }
  stage.addEventListener('touchend', endTouch);
  stage.addEventListener('touchcancel', endTouch);
  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); }); // sem menu "salvar imagem" ao segurar

  /* ---------- botão: mostra/esconde a peça inteira ---------- */
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () {
      if (full) { held = false; clearInk(700); return; }
      held = true; full = true; painted = true;
      fadeTo(1, 0);
      if (!reduce) { alpha = 0; alphaFrom = 0; alphaTo = 1; fadeT0 = performance.now(); fadeDur = 700; }
      setState(true); load(); kick();
    });
  }

  setState(false);
})();
