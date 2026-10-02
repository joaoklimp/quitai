// Gera os ícones do app, o favicon e a imagem de compartilhamento (Open Graph) a partir da marca (src/shared/brand.ts).
// Uso: npm run assets   (precisa do Node 22.18+ e do Playwright com Chromium: npm i -D playwright && npx playwright install chromium)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logoSvg, markSvg, wordmarkHtml, BRAND } from '../src/shared/brand.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const pub = `${root}public/`;
const b64 = (f) => readFileSync(f).toString('base64');
const jakarta = b64(`${root}node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2`);
const playfair = b64(`${root}node_modules/@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff2`);
const orbit = readFileSync(`${root}src/app/styles/orbit.css`, 'utf8');
const base = readFileSync(`${root}src/app/styles/base.css`, 'utf8').replace(/^@import.*$/m, '');

writeFileSync(`${pub}favicon.svg`, `${logoSvg(48).replace(' width="48" height="48"', '')}\n`);
console.log('favicon.svg');

// ícone de fundo inteiro ("maskable"): o símbolo centralizado sobre o azul-marinho
const icon = (size, scale) => `<!doctype html><html><body style="margin:0;background:#050A1A;width:${size}px;height:${size}px;display:grid;place-items:center">
<div style="width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px">${markSvg(Math.round(size * scale))}</div></body></html>`;

const og = `<!doctype html><html data-theme="dark"><head><style>
@font-face { font-family: J; src: url(data:font/woff2;base64,${jakarta}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: P; src: url(data:font/woff2;base64,${playfair}) format('woff2'); font-style: italic; font-weight: 700; }
${orbit}
${base}
:root { --ink: #F2F4FA; }
* { box-sizing: border-box; margin: 0; }
.orbit-bg *, .orbit-bg *::before, .orbit-bg *::after { animation-play-state: paused !important; }
body { width: 1200px; height: 630px; font-family: J; color: #F2F4FA; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; background: transparent; }
h1 { margin-top: 40px; font-size: 70px; font-weight: 650; letter-spacing: -0.045em; line-height: 1.04; }
em { font-family: P; font-style: italic; font-weight: 700; color: #6FB0FF; letter-spacing: -0.01em; }
p { margin-top: 26px; font-size: 25px; color: #B8C4E6; font-weight: 500; }
.chips { margin-top: 30px; display: flex; gap: 12px; }
.chips span { padding: 10px 20px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(140,180,255,.25); font-size: 19px; font-weight: 650; color: #DCE6FF; }
</style></head><body>
<div class="orbit-bg"><i class="stars"></i><i class="arc a1"></i><i class="arc a2"></i><i class="arc a3"></i></div>
${wordmarkHtml(56)}
<h1>Administre sua empresa<br><em>conversando</em> com uma IA.</h1>
<p>${BRAND.description.split(' que ')[0]}.</p>
<div class="chips"><span>Atendimento 24h</span><span>Orçamentos</span><span>Agenda</span><span>Financeiro</span><span>Estoque</span></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, scale] of [['icon-512.png', 512, 0.62], ['icon-192.png', 192, 0.62], ['apple-touch-icon.png', 180, 0.66]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(icon(size, scale));
  writeFileSync(pub + file, await page.screenshot({ type: 'png' }));
  console.log(file);
}
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(og, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
writeFileSync(`${pub}img/og.png`, await page.screenshot({ type: 'png' }));
console.log('img/og.png');
await browser.close();
