// Gera os ícones do app e a imagem de compartilhamento (Open Graph) a partir da marca.
// Uso: node scripts/gen-assets.mjs   (precisa do Playwright com Chromium instalado)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pub = `${root}public/`;
const b64 = (f) => readFileSync(f).toString('base64');
const jakarta = b64(`${root}node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2`);
const playfair = b64(`${root}node_modules/@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff2`);
const sky = b64(`${pub}img/ceu.webp`);

// marca sem o quadrado de fundo (só os dois balões), para compor ícones "maskable" de fundo inteiro
const bubbles = `<defs><clipPath id="l"><path d="M19.5 9.5a10.5 10.5 0 1 1-6.9 18.4L8.6 30l1.3-4.6A10.5 10.5 0 0 1 19.5 9.5Z"/></clipPath>
<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B9BFF"/><stop offset="1" stop-color="#2F6FF0"/></linearGradient>
<linearGradient id="o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFA061"/><stop offset="1" stop-color="#FF6A1F"/></linearGradient></defs>
<path d="M19.5 9.5a10.5 10.5 0 1 1-6.9 18.4L8.6 30l1.3-4.6A10.5 10.5 0 0 1 19.5 9.5Z" fill="url(#b)"/>
<path d="M28.5 17.5a10.5 10.5 0 1 0 6.9 18.4l4 2.1-1.3-4.6A10.5 10.5 0 0 0 28.5 17.5Z" fill="url(#o)"/>
<path d="M28.5 17.5a10.5 10.5 0 1 0 6.9 18.4l4 2.1-1.3-4.6A10.5 10.5 0 0 0 28.5 17.5Z" fill="#fff" clip-path="url(#l)"/>`;
const icon = (size, scale) => `<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0B0D12"/>
<g transform="translate(${24 - 24 * scale} ${24 - 24 * scale}) scale(${scale})">${bubbles}</g></svg></body></html>`;

const og = `<!doctype html><html><head><style>
@font-face { font-family: J; src: url(data:font/woff2;base64,${jakarta}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: P; src: url(data:font/woff2;base64,${playfair}) format('woff2'); font-style: italic; font-weight: 700; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; font-family: J; color: #0B0D12; background: #EEF3FA url(data:image/webp;base64,${sky}) center 22% / 1500px auto no-repeat; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; position: relative; overflow: hidden; }
.brand { display: flex; align-items: center; gap: 14px; font-weight: 800; font-size: 34px; letter-spacing: -0.035em; }
.brand svg { width: 58px; height: 58px; border-radius: 18px; box-shadow: 0 10px 24px rgba(11,13,18,.25); }
h1 { margin-top: 34px; font-size: 76px; font-weight: 600; letter-spacing: -0.045em; line-height: 1.02; }
em { font-family: P; font-style: italic; font-weight: 700; letter-spacing: -0.01em; position: relative; }
em::after { content: ""; position: absolute; left: 3%; right: 6%; bottom: -6px; height: 6px; border-radius: 6px; background: #FF7A30; transform: rotate(-1.2deg); }
p { margin-top: 30px; font-size: 26px; color: #394154; font-weight: 500; }
.chips { margin-top: 30px; display: flex; gap: 12px; }
.chips span { padding: 10px 20px; border-radius: 999px; background: rgba(255,255,255,.88); box-shadow: 0 6px 18px rgba(30,60,120,.12); font-size: 20px; font-weight: 650; color: #23283A; }
</style></head><body>
<div class="brand"><svg viewBox="0 0 48 48"><rect width="48" height="48" rx="14" fill="#0B0D12"/>${bubbles}</svg>Combinado</div>
<h1>Sua empresa funcionando<br>por uma <em>conversa.</em></h1>
<p>IA no WhatsApp que atende, orça e agenda pela sua empresa.</p>
<div class="chips"><span>Atendimento 24h</span><span>Orçamentos</span><span>Agenda</span><span>Comandos do dono</span></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, scale] of [['icon-512.png', 512, 0.78], ['icon-192.png', 192, 0.78], ['apple-touch-icon.png', 180, 0.82]]) {
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
