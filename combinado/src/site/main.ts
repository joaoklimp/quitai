// Landing da ORBYTA: HTML estático + este script leve (sem framework).
// Faz: menu do celular, cabeçalho de vidro ao rolar, prévia do painel em escala, conversas animadas,
// preços gerados a partir de shared/plans.ts e entrada suave das seções.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/playfair-display/latin-700-italic.css';
import '../app/styles/tokens.css';
import '../app/styles/base.css';
import '../app/styles/ui.css';
import '../app/styles/charts.css';
import '../app/styles/chat.css';
import './site.css';
import './hero.css';
import { initHero } from './hero';
import { PLANS, PAID_PLANS, TRIAL_DAYS, monthlyEquivalent, type Cycle, type PaidPlanId } from '../shared/plans';
import { brl0, fmtLong, MONTHS, MONTHS_SHORT, num, todayLocal } from '../shared/format';

// link de e-mail de acesso que caiu aqui (endereço de retorno não liberado no Supabase): segue para o painel
if (/[?&#](code|token_hash|access_token|error_description)=/.test(location.search + location.hash)) location.replace(`/app/${location.search}${location.hash}`);

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T & Element>(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CHECK = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

document.documentElement.classList.add('js');

/* ---------- cabeçalho e menu do celular ---------- */
const head = $('.site-head')!;
const onScroll = () => head.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

const menuBtn = $<HTMLButtonElement>('.head-menu')!;
const menu = $('#menu-movel')!;
const setMenu = (open: boolean) => {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  head.classList.toggle('menu-open', open);
  document.body.style.overflow = open ? 'hidden' : '';
};
menuBtn.addEventListener('click', () => setMenu(Boolean(menu.hidden)));
menu.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) setMenu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
matchMedia('(min-width: 961px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

/* ---------- hero: portal, partículas e a IA trabalhando ---------- */
initHero(head, reduced);

/* ---------- prévia do painel ---------- */
const today = todayLocal('America/Sao_Paulo');
const monthIdx = Number(today.slice(5, 7)) - 1;
const long = fmtLong(today, 'America/Sao_Paulo');
$$('[data-today]').forEach((el) => { el.textContent = long[0].toUpperCase() + long.slice(1); });
$$('[data-goal-title]').forEach((el) => { el.textContent = `Meta de faturamento de ${MONTHS[monthIdx]}`; });

function pairBars(el: HTMLElement) {
  const conv = [182, 204, 196, 238, 251, 276, 262, 298, 314, 342, 365, 388];
  const sales = [41, 47, 44, 55, 61, 66, 63, 74, 79, 88, 94, 103];
  const max = 400, ticks = [0, 100, 200, 300, 400];
  const labels = conv.map((_, i) => MONTHS_SHORT[(monthIdx - 11 + i + 12) % 12]);
  // nosemgrep -- HTML montado só com textos fixos deste arquivo (cenas, planos, números do exemplo); nada vem do visitante
  el.innerHTML =
    `<div class="pb-y">${ticks.map((t) => `<span style="bottom:${(t / max) * 100}%">${num(t)}</span>`).join('')}</div>` +
    `<div class="pb-plot">${ticks.map((t) => `<div class="pb-grid" style="bottom:${(t / max) * 100}%"></div>`).join('')}` +
    `<div class="pb-cols">${conv.map((c, i) => `<div class="pb-col${i === conv.length - 1 ? ' hover' : ''}"><div class="pb-track"><div class="pb-bar a" style="height:${(c / max) * 100}%;animation-delay:${300 + i * 40}ms"></div></div><div class="pb-track"><div class="pb-bar b" style="height:${(sales[i] / max) * 100}%;animation-delay:${360 + i * 40}ms"></div></div></div>`).join('')}</div>` +
    `<div class="chart-tip pv-tip" style="left:${((conv.length - 0.5) / conv.length) * 100}%;top:${(1 - conv[conv.length - 1] / max) * 100}%"><div class="tt">${MONTHS[monthIdx][0].toUpperCase() + MONTHS[monthIdx].slice(1)} até agora</div><div class="tr"><i style="background:var(--c1)"></i>Conversas<span class="sp"></span><b>${num(conv[11])}</b></div><div class="tr"><i style="background:var(--c2)"></i>Consultas<span class="sp"></span><b>${num(sales[11])}</b></div></div></div>` +
    `<div class="pb-x">${labels.map((l) => `<span>${l}</span>`).join('')}</div>`;
}

function gauge(el: HTMLElement) {
  const parts = [{ v: 412, c: 'var(--c1)' }, { v: 21, c: 'var(--c2)' }, { v: 18, c: 'var(--c-muted)' }];
  const total = parts.reduce((s, p) => s + p.v, 0);
  const N = 66, start = 135, sweep = 270, r1 = 70, r2 = 92;
  let acc = 0;
  const bounds = parts.map((p) => ({ c: p.c, until: (acc += p.v / total) }));
  const lines = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    const seg = bounds.find((b) => t <= b.until + 1e-9) ?? bounds[bounds.length - 1];
    const a = ((start + t * sweep) * Math.PI) / 180;
    const rr1 = i % 6 === 0 ? r1 - 4 : r1;
    const f = (n: number) => n.toFixed(2);
    return `<line class="tick" x1="${f(100 + rr1 * Math.cos(a))}" y1="${f(100 + rr1 * Math.sin(a))}" x2="${f(100 + r2 * Math.cos(a))}" y2="${f(100 + r2 * Math.sin(a))}" stroke="${seg.c}" style="animation-delay:${400 + i * 12}ms"/>`;
  }).join('');
  el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 200 178" aria-hidden="true">${lines}</svg>`);
}

$$('[data-pairbars]').forEach(pairBars);
$$('[data-gauge]').forEach(gauge);

// a prévia é desenhada em tamanho de computador e reduzida para caber na largura disponível
const preview = $('.preview');
const scaleBox = $('.pv-scale');
const stage = $('.pv-stage');
if (preview && scaleBox && stage) {
  const fit = () => {
    const w = scaleBox.clientWidth;
    preview.toggleAttribute('data-compact', w < 900);
    const s = Math.min(1, w / stage.offsetWidth);
    scaleBox.style.setProperty('--pv-s', String(s));
    scaleBox.style.height = `${Math.round(stage.offsetHeight * s)}px`;
  };
  new ResizeObserver(fit).observe(scaleBox);
  fit();
}

// mapa de calor do card de análises (dias x horas)
$$('[data-heat]').forEach((el) => {
  const days = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const hours = 12; // 8h às 19h
  let html = '';
  days.forEach((d, di) => {
    html += `<span class="hl">${d}</span>`;
    for (let h = 0; h < hours; h++) {
      const peak = Math.exp(-((h - 2) ** 2) / 5) + 0.9 * Math.exp(-((h - 7) ** 2) / 6);
      const weekend = di >= 5 ? (di === 5 ? 0.55 : 0.25) : 1;
      const wave = 0.15 * Math.sin((h + di * 2) * 1.7);
      const v = Math.max(0.06, Math.min(1, (peak * weekend + wave) * 0.85));
      html += `<i style="--v:${v.toFixed(2)}"></i>`;
    }
  });
  // nosemgrep -- HTML montado só com textos fixos deste arquivo (cenas, planos, números do exemplo); nada vem do visitante
  el.innerHTML = html;
});

/* ---------- conversas animadas ---------- */
interface Chat { root: HTMLElement; steps: number; timer: number; step: number; running: boolean; visible: boolean }
const chats: Chat[] = $$('[data-chat]').map((el) => {
  const root = (el.closest('.show-visual') as HTMLElement) ?? el;
  const steps = Math.max(...$$('[data-step],[data-press]', root).map((n) => Number(n.dataset.step ?? n.dataset.press)));
  return { root, steps, timer: 0, step: -1, running: false, visible: false };
});

function render(c: Chat) {
  $$('[data-step]', c.root).forEach((n) => n.classList.toggle('on', Number(n.dataset.step) <= c.step));
  $$('[data-until]', c.root).forEach((n) => n.classList.toggle('gone', c.step >= Number(n.dataset.until)));
  $$('[data-press]', c.root).forEach((n) => n.classList.toggle('pressed', c.step >= Number(n.dataset.press)));
  const body = $('.wa-body, .cmd-body', c.root);
  if (body) body.scrollTo({ top: body.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
}

function delayFor(c: Chat, next: number): number {
  const el = $(`[data-step="${next}"]`, c.root);
  const prevTyping = $(`.wa-typing[data-step="${next - 1}"]`, c.root);
  if (!el) return 1500;                         // passo só de clique (confirmar)
  if (el.classList.contains('wa-typing')) return 650;
  if (prevTyping) return 1500;                  // tempo "digitando"
  if (el.classList.contains('out')) return 1700; // cliente/dono lendo e respondendo
  return 1300;
}

function tick(c: Chat) {
  if (!c.visible) { c.running = false; return; }
  if (c.step >= c.steps) {
    // fim: espera, apaga e recomeça
    c.timer = window.setTimeout(() => {
      c.root.classList.add('resetting');
      c.timer = window.setTimeout(() => { c.step = -1; render(c); c.root.classList.remove('resetting'); c.timer = window.setTimeout(() => tick(c), 500); }, 450);
    }, 6000);
    return;
  }
  const next = c.step + 1;
  c.timer = window.setTimeout(() => { c.step = next; render(c); tick(c); }, c.step < 0 ? 300 : delayFor(c, next));
}

if (reduced || !('IntersectionObserver' in window)) {
  chats.forEach((c) => { c.step = c.steps; render(c); });
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const c = chats.find((x) => x.root === e.target);
      if (!c) continue;
      c.visible = e.isIntersecting;
      if (c.visible && !c.running) { c.running = true; window.clearTimeout(c.timer); tick(c); }
      if (!c.visible) { window.clearTimeout(c.timer); c.running = false; }
    }
  }, { threshold: 0.35 });
  chats.forEach((c) => { render(c); io.observe(c.root); });
}

/* ---------- faixa de segmentos (rolagem contínua) ---------- */
$$('.marquee-track').forEach((track) => {
  const clone = track.cloneNode(true) as HTMLElement;
  clone.setAttribute('aria-hidden', 'true');
  track.after(clone);
});

/* ---------- preços ---------- */
const plansBox = $('#planos');
let cycle: Cycle = 'mensal';
function renderPlans() {
  if (!plansBox) return;
  // nosemgrep -- HTML montado só com textos fixos deste arquivo (cenas, planos, números do exemplo); nada vem do visitante
  plansBox.innerHTML = PAID_PLANS.map((id: PaidPlanId) => {
    const p = PLANS[id];
    const per = monthlyEquivalent(id, cycle);
    const [int, cents] = per.toFixed(2).split('.');
    const saving = p.monthly * 12 - p.yearly;
    return `<article class="plan${p.highlight ? ' hl' : ''}">
      ${p.highlight ? '<span class="plan-tag">Mais escolhido</span>' : ''}
      <h3>${p.name}</h3>
      <p class="plan-blurb">${p.blurb}</p>
      <div class="plan-price"><span class="cur">R$</span><b>${num(Number(int))}</b>${cents !== '00' ? `<span class="cents">,${cents}</span>` : ''}<span class="per">/mês</span></div>
      <p class="plan-bill">${cycle === 'anual' ? `${brl0(p.yearly)} por ano · você economiza ${brl0(saving)}` : 'cobrado todo mês · sem fidelidade'}</p>
      <a class="btn ${p.highlight ? 'hl-btn' : 'solid'} lg block" href="/app/?real#/cadastro">Testar ${TRIAL_DAYS} dias grátis</a>
      <ul class="plan-feats">${p.features.map((f) => `<li>${CHECK}<span>${f}</span></li>`).join('')}</ul>
    </article>`;
  }).join('');
}
$$<HTMLButtonElement>('[data-cycle]').forEach((b) => b.addEventListener('click', () => {
  cycle = b.dataset.cycle as Cycle;
  $$('[data-cycle]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  renderPlans();
}));
// setas do teclado no seletor mensal/anual (padrão de grupo de rádio)
$('.cycle')?.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const btns = $$<HTMLButtonElement>('[data-cycle]');
  const i = btns.findIndex((x) => x.getAttribute('aria-checked') === 'true');
  const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
  n.click(); n.focus();
});
renderPlans();

/* ---------- entrada suave das seções ---------- */
const reveals = $$('.reveal');
if (reduced || !('IntersectionObserver' in window)) reveals.forEach((el) => el.classList.add('in'));
else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  reveals.forEach((el) => io.observe(el));
}

$$('[data-year]').forEach((el) => { el.textContent = today.slice(0, 4); });
