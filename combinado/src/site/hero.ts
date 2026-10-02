// Hero da landing: céu de partículas em 3D, portal que abre com a rolagem e um celular mostrando a IA
// trabalhando em três situações reais (o visitante escolhe). Tudo leve: canvas 2D e CSS, sem bibliotecas.

type Tone = 'green' | 'blue' | 'violet' | 'orange';
interface Sat { icon: string; title: string; text: string; tone?: Tone }
type Step =
  | { k: 'me' | 'them'; text: string; who?: string; buttons?: [string, string]; sat?: Sat; wait?: number }
  | { k: 'audio'; secs: string; sat?: Sat; wait?: number }
  | { k: 'sys'; text: string; sat?: Sat; wait?: number }
  | { k: 'sat'; sat: Sat; wait?: number };
interface Scene { av: string; avLogo?: boolean; title: string; subtitle: string; link: string; linkText: string; steps: Step[] }

const SCENES: Scene[] = [
  {
    av: 'BL', title: 'Brilho Lar Higienização', subtitle: 'online', link: '/app/?demo#/simulador', linkText: 'Conversar com a IA na demonstração',
    steps: [
      { k: 'audio', secs: '0:09', sat: { icon: 'audio-lines', title: 'Áudio entendido', text: '“Tem horário amanhã à tarde?”', tone: 'violet' } },
      { k: 'them', text: 'Oi, Juliana! 😊 Amanhã à tarde tenho <b>14h</b> ou <b>16h</b> para a limpeza do sofá. Qual prefere?', sat: { icon: 'calendar-search', title: 'Consultou a agenda', text: '14h e 16h livres amanhã', tone: 'blue' } },
      { k: 'me', text: '16h, por favor 🙏' },
      { k: 'them', text: 'Prontinho! ✅ Reservei <b>amanhã às 16h</b>. Na véspera eu te mando um lembrete.', sat: { icon: 'calendar-check', title: 'Horário marcado', text: 'Agenda atualizada sozinha' } },
    ],
  },
  {
    av: '', avLogo: true, title: 'ORBYTA', subtitle: 'sua assistente · conta verificada', link: '/app/?demo#/cobrancas', linkText: 'Ver cobranças na demonstração',
    steps: [
      { k: 'me', text: 'Cobra R$ 250 da Juliana pra sexta' },
      { k: 'them', who: 'ORBYTA', text: 'Gero Pix e boleto de <b>R$ 250,00</b>, vencendo sexta, e mando no WhatsApp dela. Confirma?', buttons: ['Confirmar', 'Cancelar'], sat: { icon: 'qr-code', title: 'Cobrança preparada', text: 'Pix + boleto · vence sexta', tone: 'blue' } },
      { k: 'me', text: 'Confirmar' },
      { k: 'them', who: 'ORBYTA', text: 'Feito! Link de pagamento enviado para a Juliana. 📨' },
      { k: 'sys', text: '💰 Juliana pagou R$ 250,00 no Pix', sat: { icon: 'banknote', title: 'Pagamento recebido', text: 'R$ 250,00 · Pix', tone: 'orange' }, wait: 1700 },
      { k: 'them', who: 'ORBYTA', text: 'Recebido! Dei baixa no financeiro e registrei a venda. ✅', sat: { icon: 'check', title: 'Baixa automática', text: 'Venda registrada no painel' } },
    ],
  },
  {
    av: 'BL', title: 'Brilho Lar Higienização', subtitle: 'online', link: '/app/?demo#/agenda?espera=1', linkText: 'Ver a lista de espera na demonstração',
    steps: [
      { k: 'sat', sat: { icon: 'user-x', title: 'Marcos desmarcou', text: 'Amanhã 15h ficaria vazio', tone: 'orange' }, wait: 1300 },
      { k: 'sat', sat: { icon: 'list-ordered', title: 'Lista de espera', text: 'Fernanda é a próxima', tone: 'violet' }, wait: 900 },
      { k: 'them', text: 'Olá, Fernanda! Boa notícia: abriu um horário <b>amanhã às 15h</b> para a limpeza do sofá. Quer ficar com ele?' },
      { k: 'me', text: 'SIM!! 😍' },
      { k: 'them', text: 'Marcado! ✨ Te espero amanhã às 15h.', sat: { icon: 'calendar-check', title: 'Encaixe feito', text: 'Horário que seria perdido' } },
    ],
  },
];

export function initHero(head: HTMLElement, reduced: boolean) {
  const hero = document.querySelector<HTMLElement>('.hx');
  if (!hero) return;
  const icons = new Map<string, string>();
  document.querySelector<HTMLTemplateElement>('#hx-icons')?.content.querySelectorAll<HTMLElement>('[data-n]').forEach((el: HTMLElement) => icons.set(el.dataset.n!, el.innerHTML));
  const icon = (n: string) => icons.get(n) ?? '';

  /* ---------- rolagem: o portal abre e leva ao site claro ---------- */
  const pinMq = matchMedia('(min-width: 1024px) and (min-height: 620px)');
  let pinned = false;
  const setPinned = () => { pinned = pinMq.matches && !reduced; document.documentElement.classList.toggle('hx-pin', pinned); onScroll(); };
  const onScroll = () => {
    const top = hero.offsetTop, h = hero.offsetHeight, vh = innerHeight;
    const p = pinned ? Math.min(1, Math.max(0, (scrollY - top) / Math.max(1, h - vh))) : 0;
    hero.style.setProperty('--p', p.toFixed(4));
    head.classList.toggle('on-dark', scrollY < top + h - 160);
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  pinMq.addEventListener('change', setPinned);
  setPinned();

  /* ---------- céu de partículas em 3D ---------- */
  const canvas = hero.querySelector<HTMLCanvasElement>('.hx-stars')!;
  const ctx = canvas.getContext('2d');
  let visible = true;
  if (ctx) {
    const COLORS = ['255,255,255', '170,200,255', '196,168,255', '143,227,255'];
    let w = 0, h = 0, dpr = 1;
    let stars: { x: number; y: number; z: number; c: string; s: number }[] = [];
    let mx = 0, my = 0, tx = 0, ty = 0;
    const size = () => {
      dpr = Math.min(1.5, devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const n = Math.round(Math.min(320, (w * h) / 5200));
      stars = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random(), c: COLORS[Math.floor(Math.random() * (Math.random() < 0.7 ? 1 : COLORS.length))], s: Math.random() }));
    };
    const draw = (dt: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      mx += (tx - mx) * 0.04; my += (ty - my) * 0.04;
      const cx = w * (w >= 1024 ? 0.7 : 0.5), cy = h * 0.52, f = Math.max(w, h) * 0.5;
      for (const st of stars) {
        st.z -= dt * 0.000035 * (0.6 + st.s);
        if (st.z <= 0.02) { st.z = 1; st.x = (Math.random() - 0.5) * 2; st.y = (Math.random() - 0.5) * 2; }
        const k = 1 / st.z;
        const x = cx + (st.x + mx * (1 - st.z) * 0.08) * f * k * 0.5;
        const y = cy + (st.y + my * (1 - st.z) * 0.08) * f * k * 0.5;
        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
        const a = Math.min(1, (1 - st.z) * 1.4) * (0.35 + st.s * 0.65);
        const r = Math.max(0.35, (1 - st.z) * 1.9 * (0.5 + st.s));
        ctx.beginPath(); ctx.fillStyle = `rgba(${st.c},${a.toFixed(3)})`; ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    };
    size();
    new ResizeObserver(size).observe(canvas);
    if (reduced) draw(0);
    else {
      addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
      let last = performance.now();
      const loop = (t: number) => { const dt = Math.min(64, t - last); last = t; if (visible && !document.hidden) draw(dt); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }).observe(hero);

  /* ---------- a IA trabalhando: três situações ---------- */
  const chat = hero.querySelector<HTMLElement>('[data-chat]')!;
  const av = hero.querySelector<HTMLElement>('[data-av]')!;
  const title = hero.querySelector<HTMLElement>('[data-title]')!;
  const subtitle = hero.querySelector<HTMLElement>('[data-subtitle]')!;
  const sats = Array.from(hero.querySelectorAll<HTMLElement>('[data-sat]'));
  const tryLink = hero.querySelector<HTMLAnchorElement>('[data-try-link]')!;
  const tabs = Array.from(hero.querySelectorAll<HTMLButtonElement>('[data-scene]'));
  const logo = document.querySelector('.site-brand svg')?.outerHTML ?? '';
  let timers: number[] = [];
  let current = 0, run = 0, userPicked = false;
  const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, reduced ? 0 : ms)); };
  const clearAll = () => { timers.forEach(clearTimeout); timers = []; };
  const keep = () => { while (chat.children.length > 7) chat.firstElementChild?.remove(); };
  const add = (html: string, cls: string) => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; chat.appendChild(el); keep(); return el; };
  const satHtml = (s: Sat) => `<span class="si ${s.tone ?? ''}">${icon(s.icon)}</span><span><b>${s.title}</b><small>${s.text}</small></span>`;

  const play = (i: number) => {
    clearAll();
    const my = ++run;
    current = i;
    const sc = SCENES[i];
    tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(j === i)); t.tabIndex = j === i ? 0 : -1; t.style.setProperty('--prog', '0'); });
    chat.innerHTML = '';
    sats.forEach((s) => s.classList.remove('on'));
    tryLink.classList.remove('on');
    tryLink.href = sc.link; tryLink.firstChild!.textContent = sc.linkText;
    av.innerHTML = sc.avLogo ? logo : sc.av;
    av.style.background = sc.avLogo ? '#04060D' : '';
    title.textContent = sc.title; subtitle.textContent = sc.subtitle;
    let t = 500, slot = 0;
    sc.steps.forEach((st, n) => {
      if (st.k === 'them') {
        later(t, () => { if (my !== run) return; const ty = add('<i></i><i></i><i></i>', 'hx-typing'); later(900, () => ty.remove()); });
        t += 900;
      }
      later(t, () => {
        if (my !== run) return;
        if (st.k === 'me' || st.k === 'them') add(`${st.who ? `<span class="who">${st.who}</span>` : ''}${st.text}${st.buttons ? `<span class="hx-btns"><span>${st.buttons[0]}</span><span>${st.buttons[1]}</span></span>` : ''}<time>${clock()}</time>`, `hx-b ${st.k}`);
        else if (st.k === 'audio') add(`<span class="hx-audio"><span class="pl">${icon('play')}</span><span class="wave">${Array.from({ length: 26 }, (_, j) => `<i style="height:${30 + Math.round(Math.abs(Math.sin(j * 1.7)) * 70)}%"></i>`).join('')}</span><small>${st.secs}</small></span><time>${clock()}</time>`, 'hx-b me');
        else if (st.k === 'sys') add(st.text, 'hx-b sys');
        if (st.sat) { const el = sats[slot++ % sats.length]; el.classList.remove('on'); el.innerHTML = satHtml(st.sat); requestAnimationFrame(() => el.classList.add('on')); }
        tabs[i].style.setProperty('--prog', String((n + 1) / sc.steps.length));
      });
      t += st.wait ?? (st.k === 'me' ? 1300 : 1500);
    });
    later(t, () => { if (my === run) tryLink.classList.add('on'); });
    // passa sozinho para a próxima situação (enquanto a pessoa não escolhe uma)
    later(t + (userPicked ? 9000 : 4200), () => { if (my === run && visible && !reduced) play((current + 1) % SCENES.length); });
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => { userPicked = true; play(i); });
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tabs[n].focus(); userPicked = true; play(n);
    });
  });
  play(0);
}
