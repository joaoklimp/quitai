/* =====================================================================
   "Na maca": braço sem tatuagem que recebe a tatuagem ao passar o mouse.
   - Mouse: a tinta se espalha a partir do ponto onde o cursor entra no braço
     e recolhe quando ele sai.
   - Toque: tocar e segurar no braço mostra a tatuagem; soltar esconde.
     Rolar a página com o dedo continua funcionando (touch-action: pan-y).
   - Teclado / leitor de tela: botão "Ver a tatuagem" (aria-pressed).
   - Sem JS: o CSS mostra a tatuagem no :hover e no :focus-within.
   - Movimento reduzido: troca direta, sem a tinta se espalhando.
   Para trocar o braço: substitua as duas imagens e o contorno ARM abaixo
   (coordenadas em pixels da imagem de 554 x 742).
   ===================================================================== */
(function () {
  'use strict';

  var d = document, w = window;
  var stage = d.querySelector('[data-skin]');
  if (!stage) return;

  var W = 554, H = 742;
  // contorno do antebraço (justo) e uma versão 14 px mais larga, para não piscar na borda
  var ARM = [[446,0],[446,30],[446,60],[447,90],[450,120],[451,150],[450,180],[447,210],[442,240],[438,270],[435,300],[430,330],[425,360],[420,390],[412,420],[402,450],[395,480],[392,510],[390,540],[390,570],[391,600],[389,630],[384,660],[380,690],[382,720],[384,741],[201,741],[201,720],[200,690],[196,660],[197,630],[196,600],[188,570],[183,540],[178,510],[179,480],[173,450],[168,420],[161,390],[158,360],[159,330],[159,300],[160,270],[161,240],[162,210],[161,180],[158,150],[157,120],[156,90],[157,60],[161,30],[167,0]];
  var ARM_OUT = [[460,0],[460,30],[460,60],[461,90],[464,120],[465,150],[464,180],[461,210],[456,240],[452,270],[449,300],[444,330],[439,360],[434,390],[426,420],[416,450],[409,480],[406,510],[404,540],[404,570],[405,600],[403,630],[398,660],[394,690],[396,720],[398,741],[187,741],[187,720],[186,690],[182,660],[183,630],[182,600],[174,570],[169,540],[164,510],[165,480],[159,450],[154,420],[147,390],[144,360],[145,330],[145,300],[146,270],[147,240],[148,210],[147,180],[144,150],[143,120],[142,90],[143,60],[147,30],[153,0]];

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
  var mask = d.createElement('canvas'); mask.width = W; mask.height = H;
  var mctx = mask.getContext('2d');

  /* ---------- imagem da tatuagem: carrega quando a seção se aproxima ---------- */
  var tattoo = new Image(), ready = false, pending = null;
  tattoo.decoding = 'async';
  tattoo.onload = function () { ready = true; if (pending) { var p = pending; pending = null; show(p.x, p.y, p.instant); } };
  function load() { if (!tattoo.src) tattoo.src = inkImg.getAttribute('data-src') || inkImg.currentSrc || inkImg.src; }
  if ('IntersectionObserver' in w) {
    var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { load(); io.disconnect(); } }, { rootMargin: '600px 0px' });
    io.observe(stage);
  } else load();

  /* ---------- geometria ---------- */
  function inside(poly, x, y) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function toImg(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  function far(x, y) { // distância até o canto mais distante: raio que cobre a imagem toda
    return Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
  }

  /* ---------- a tinta: uma mancha principal + gotas que se espalham em volta ---------- */
  var p = 0, target = 0, origin = { x: W / 2, y: H / 2 }, rMax = far(W / 2, H / 2), drops = [];
  var t0 = 0, p0 = 0, dur = 0, raf = 0;
  function seed(x, y) {
    origin = { x: x, y: y }; rMax = far(x, y) * 1.08; drops = [];
    var n = 16, s = (x * 7 + y * 13) | 0; // pseudo-aleatório estável
    function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
    for (var i = 0; i < n; i++) {
      drops.push({ a: (i / n) * Math.PI * 2 + rnd() * 0.5, d: 0.45 + rnd() * 0.5, s: 0.18 + rnd() * 0.3, lag: rnd() * 0.35 });
    }
  }
  function blob(cx, cy, r) {
    if (r <= 0.5) return;
    var g = mctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    mctx.fillStyle = g; mctx.beginPath(); mctx.arc(cx, cy, r, 0, Math.PI * 2); mctx.fill();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!ready || p <= 0.001) return;
    if (p >= 0.999) { ctx.drawImage(tattoo, 0, 0, W, H); return; }
    var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad no raio
    var R = e * rMax;
    mctx.clearRect(0, 0, W, H);
    blob(origin.x, origin.y, R);
    for (var i = 0; i < drops.length; i++) {
      var dr = drops[i], k = Math.max(0, Math.min(1, (p - dr.lag) / (1 - dr.lag)));
      var dist = dr.d * R * 1.05;
      blob(origin.x + Math.cos(dr.a) * dist, origin.y + Math.sin(dr.a) * dist, dr.s * rMax * k);
    }
    ctx.drawImage(tattoo, 0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  function tick(now) {
    var k = dur ? Math.min(1, (now - t0) / dur) : 1;
    p = p0 + (target - p0) * k;
    draw();
    raf = k < 1 ? requestAnimationFrame(tick) : 0;
  }
  function animate(to, ms) {
    target = to; p0 = p; t0 = performance.now();
    dur = reduce ? 0 : ms * Math.abs(to - p);
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  /* ---------- estados ---------- */
  var on = false, held = false; // held: ligada pelo botão (o mouse não desliga)
  function setState(v) {
    on = v;
    stage.classList.toggle('is-inked', v);
    if (btn) { btn.setAttribute('aria-pressed', v ? 'true' : 'false'); btn.querySelector('[data-skin-label]').textContent = v ? 'Esconder a tatuagem' : 'Ver a tatuagem'; }
    if (status) status.textContent = v ? 'Tatuagem visível: leão em realismo preto e cinza, com um leão caminhando na paisagem.' : 'Tatuagem escondida: braço sem tatuagem.';
  }
  function show(x, y, instant) {
    if (!ready) { pending = { x: x, y: y, instant: instant }; load(); setState(true); return; }
    if (p <= 0.001) seed(x, y);
    setState(true);
    if (instant) { p = 1; target = 1; draw(); return; }
    animate(1, 950);
  }
  function hide(x, y) {
    pending = null;
    if (p >= 0.999 && x != null) seed(x, y); // recolhe em direção ao ponto de saída
    setState(false);
    animate(0, 650);
  }

  /* ---------- mouse ---------- */
  stage.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var q = toImg(e);
    var inArm = inside(on ? ARM_OUT : ARM, q.x, q.y);
    if (cursor) cursor.classList.toggle('is-ink', inArm);
    stage.classList.toggle('is-over-arm', inArm);
    if (inArm && !on) show(q.x, q.y);
    else if (!inArm && on && !held) hide(q.x, q.y);
  });
  stage.addEventListener('pointerleave', function (e) {
    if (cursor) cursor.classList.remove('is-ink');
    stage.classList.remove('is-over-arm');
    if (e.pointerType === 'mouse' && on && !held) { var q = toImg(e); hide(q.x, q.y); }
  });

  /* ---------- toque: segurar mostra, soltar esconde ---------- */
  var touchId = null;
  stage.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    var q = toImg(e);
    if (!inside(ARM_OUT, q.x, q.y)) return;
    touchId = e.pointerId;
    if (w.navigator.vibrate) { try { w.navigator.vibrate(12); } catch (err) {} }
    show(q.x, q.y);
  });
  function endTouch(e) {
    if (touchId === null || e.pointerId !== touchId) return;
    touchId = null;
    var q = toImg(e); hide(q.x, q.y);
  }
  stage.addEventListener('pointerup', endTouch);
  stage.addEventListener('pointercancel', endTouch); // o dedo começou a rolar a página
  stage.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'mouse') endTouch(e); });
  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); }); // sem menu de "salvar imagem" ao segurar

  /* ---------- botão (teclado, leitor de tela, ou quem preferir clicar) ---------- */
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () {
      held = !on;
      if (on) hide(W / 2, H * 0.42); else show(W / 2 + 10, H * 0.42);
    });
  }

  setState(false);
})();
