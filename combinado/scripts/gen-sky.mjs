// Gera as imagens de céu com nuvens usadas no site e no painel.
// Uso: node scripts/gen-sky.mjs [arquivo.webp ...]   (precisa do Playwright com Chromium instalado; sem argumentos gera todos)
// Nuvens procedurais: cada nuvem é um cacho de "algodões" (gaussianas) com base achatada,
// bordas corroídas por ruído fBm e sombreamento pelo campo de densidade (topo claro, base azulada).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/img/', import.meta.url));
mkdirSync(out, { recursive: true });

const pageCode = /* js */ `
function makeNoise(seed) {
  const grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512); for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return (xin, yin) => {
    const s = (xin + yin) * F2; const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2; const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255; let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { const g = grad[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { const g = grad[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { const g = grad[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  };
}
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

window.render = function render(opts) {
  const { w, h, seed, stops, clouds, haze, night } = opts;
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const noise = makeNoise(seed * 13 + 1);
  const fbm = (x, y, oct) => { let a = 0.5, f = 1, sum = 0, norm = 0; for (let o = 0; o < oct; o++) { sum += a * noise(x * f, y * f); norm += a; a *= 0.5; f *= 2.1; } return sum / norm; };

  // 1) campo de densidade em meia resolução: soma de gaussianas (algodões)
  const sw = Math.round(w / 2), sh = Math.round(h / 2);
  const dc = document.createElement('canvas'); dc.width = sw; dc.height = sh;
  const dx = dc.getContext('2d'); dx.fillStyle = '#000'; dx.fillRect(0, 0, sw, sh); dx.globalCompositeOperation = 'lighter';
  // cada nuvem é desenhada numa camada própria, com a base achatada por uma máscara, e somada ao campo
  const lc = document.createElement('canvas'); lc.width = sw; lc.height = sh; const lx = lc.getContext('2d');
  const puff = (x, y, r, a) => { const g = lx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(0.55, 'rgba(255,255,255,' + (a * 0.55) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); lx.fillStyle = g; lx.beginPath(); lx.arc(x, y, r, 0, Math.PI * 2); lx.fill(); };
  for (const c of clouds) {
    const cx = c.x * sw, base = c.y * sh, cw = c.w * sw, ch = c.h * sh;
    lx.globalCompositeOperation = 'source-over'; lx.clearRect(0, 0, sw, sh);
    lx.globalCompositeOperation = 'lighter';
    const n = Math.round(c.puffs ?? 40);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;                          // posição horizontal na nuvem (-1..1)
      const dome = Math.sqrt(Math.max(0, 1 - u * u));   // cúpula: mais alta no meio
      const px = cx + u * cw * 0.5;
      const py = base - rnd() * dome * ch * 0.85;
      const r = (0.18 + 0.30 * dome * (0.5 + rnd() * 0.7)) * ch;
      puff(px, py, r, 0.22 + 0.18 * rnd());
    }
    // base achatada: some suavemente abaixo da linha de base desta nuvem
    lx.globalCompositeOperation = 'destination-in';
    const soft = ch * 0.16; const gm = lx.createLinearGradient(0, base - soft * 0.3, 0, base + soft);
    gm.addColorStop(0, 'rgba(0,0,0,1)'); gm.addColorStop(1, 'rgba(0,0,0,0)');
    lx.fillStyle = gm; lx.fillRect(0, 0, sw, sh);
    dx.drawImage(lc, 0, 0);
  }
  const D = dx.getImageData(0, 0, sw, sh).data;
  const den = (x, y) => { // amostragem bilinear do campo (0..1+)
    const fx = clamp(x * (sw - 1), 0, sw - 1), fy = clamp(y * (sh - 1), 0, sh - 1);
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const v = (xx, yy) => D[(yy * sw + xx) * 4] / 255;
    return mix(mix(v(x0, y0), v(x1, y0), tx), mix(v(x0, y1), v(x1, y1), tx), ty);
  };

  // 2) composição em resolução cheia
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const st = stops.map(([pos, col]) => [pos, hex(col)]);
  const sky = (t) => { for (let k = 1; k < st.length; k++) if (t <= st[k][0]) { const [p0, c0] = st[k - 1], [p1, c1] = st[k]; const u = (t - p0) / (p1 - p0); return [mix(c0[0], c1[0], u), mix(c0[1], c1[1], u), mix(c0[2], c1[2], u)]; } return st[st.length - 1][1]; };
  const aspect = w / h; const off = 0.018;
  const lightC = night ? [150, 170, 210] : [255, 255, 255];
  const shadeC = night ? [52, 66, 104] : [168, 194, 232];
  for (let py = 0; py < h; py++) {
    const y = py / h; const base = sky(y);
    for (let px = 0; px < w; px++) {
      const x = px / w;
      let r = base[0], g = base[1], b = base[2];
      const glow = Math.exp(-(((x - 0.5) ** 2) / 0.12 + ((y - 0.28) ** 2) / 0.10)) * (night ? 0.05 : 0.16);
      r = mix(r, 255, glow); g = mix(g, 255, glow); b = mix(b, 255, glow);
      const raw = den(x, y);
      if (raw > 0.01) {
        const nz = fbm(x * aspect * 7.0, y * 7.0, 5);           // corrosão das bordas
        const fine = fbm(x * aspect * 26.0 + 9, y * 26.0 + 3, 3); // textura fina
        const field = raw * (0.82 + 0.34 * nz);
        const a = smooth(0.28, 0.72, field + fine * 0.05);
        if (a > 0.001) {
          const up = den(x, y - off), down = den(x, y + off * 0.6);
          let light = clamp(0.60 + (raw - up) * 2.4 - (down - raw) * 0.35 + nz * 0.24 + fine * 0.08);
          light = mix(light, 1, smooth(0.9, 1.4, raw) * 0.15);
          const cr = mix(shadeC[0], lightC[0], light), cg = mix(shadeC[1], lightC[1], light), cb = mix(shadeC[2], lightC[2], light);
          const op = a * (night ? 0.5 : 0.98);
          r = mix(r, cr, op); g = mix(g, cg, op); b = mix(b, cb, op);
        }
      }
      const hz = smooth(haze.from, 1.0, y) * haze.amount;
      r = mix(r, haze.color[0], hz); g = mix(g, haze.color[1], hz); b = mix(b, haze.color[2], hz);
      const i = (py * w + px) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/webp', opts.quality ?? 0.84);
};
`;

const heroClouds = [
  // laterais grandes (esquerda e direita), como molduras
  { x: 0.02, y: 0.82, w: 0.32, h: 0.40, puffs: 66 },
  { x: 0.98, y: 0.78, w: 0.34, h: 0.44, puffs: 70 },
  { x: 0.10, y: 0.46, w: 0.20, h: 0.18, puffs: 30 },
  { x: 0.90, y: 0.36, w: 0.22, h: 0.20, puffs: 32 },
  // faixa de base, por trás da prévia do painel
  { x: 0.24, y: 1.04, w: 0.34, h: 0.30, puffs: 52 },
  { x: 0.50, y: 1.06, w: 0.36, h: 0.24, puffs: 48 },
  { x: 0.76, y: 1.04, w: 0.34, h: 0.30, puffs: 52 },
  // pequenas no alto
  { x: 0.80, y: 0.15, w: 0.10, h: 0.07, puffs: 12 },
  { x: 0.17, y: 0.18, w: 0.08, h: 0.05, puffs: 9 },
];
const panelClouds = [
  { x: 0.03, y: 0.62, w: 0.26, h: 0.40, puffs: 46 },
  { x: 0.20, y: 0.80, w: 0.22, h: 0.26, puffs: 30 },
  { x: 0.82, y: 0.78, w: 0.24, h: 0.30, puffs: 34 },
  { x: 0.98, y: 0.58, w: 0.24, h: 0.42, puffs: 46 },
  { x: 0.62, y: 0.86, w: 0.18, h: 0.18, puffs: 22 },
];

const variants = [
  {
    file: 'ceu.webp', w: 2400, h: 1500, seed: 11, quality: 0.84, clouds: heroClouds,
    stops: [[0, '#2E79E8'], [0.30, '#579BF1'], [0.60, '#9CC8F8'], [0.84, '#D6E8FC'], [1, '#EEF4FC']],
    haze: { from: 0.80, amount: 0.65, color: [238, 244, 252] },
  },
  {
    file: 'ceu-painel.webp', w: 2400, h: 900, seed: 5, quality: 0.82, clouds: panelClouds,
    stops: [[0, '#4A8DEE'], [0.38, '#7FB4F5'], [0.72, '#C9E1FB'], [1, '#EEF3FA']],
    haze: { from: 0.55, amount: 1.0, color: [238, 243, 250] },
  },
  {
    file: 'ceu-noite-hero.webp', w: 2400, h: 1500, seed: 11, quality: 0.82, night: true, clouds: heroClouds,
    stops: [[0, '#0B1A40'], [0.40, '#10204A'], [0.72, '#0C1530'], [1, '#070A12']],
    haze: { from: 0.78, amount: 1.0, color: [7, 10, 18] },
  },
  {
    file: 'ceu-noite.webp', w: 2400, h: 900, seed: 5, quality: 0.82, night: true, clouds: panelClouds,
    stops: [[0, '#0C1C44'], [0.45, '#0E1A38'], [0.8, '#0A1226'], [1, '#070A12']],
    haze: { from: 0.55, amount: 1.0, color: [7, 10, 18] },
  },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: pageCode });
const only = process.argv.slice(2);
for (const v of variants.filter((x) => !only.length || only.includes(x.file))) {
  const t = Date.now();
  const url = await page.evaluate((o) => window.render(o), v);
  const buf = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(out + v.file, buf);
  console.log(v.file, `${(buf.length / 1024).toFixed(0)} KB`, `${Date.now() - t} ms`);
}
await browser.close();
