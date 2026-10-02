// Captura telas do painel para revisão visual.
// Uso: node scripts/shot.mjs <url> <saida.png> [largura] [altura] [--full] [--dark] [--wait=ms] [--click=seletor]
import { chromium } from 'playwright';

const [, , url, out, w = '1440', h = '900', ...flags] = process.argv;
const full = flags.includes('--full');
const dark = flags.includes('--dark');
const wait = Number(flags.find((f) => f.startsWith('--wait='))?.slice(7) ?? 1200);
const clicks = flags.filter((f) => f.startsWith('--click=')).map((f) => f.slice(8));
const types = flags.filter((f) => f.startsWith('--type=')).map((f) => f.slice(7));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);
for (const c of clicks) { await page.click(c); await page.waitForTimeout(600); }
for (const t of types) { const [sel, text] = t.split('::'); await page.fill(sel, text); await page.keyboard.press('Enter'); await page.waitForTimeout(2500); }
await page.screenshot({ path: out, fullPage: full });
if (errors.length) console.log(errors.join('\n'));
await browser.close();
