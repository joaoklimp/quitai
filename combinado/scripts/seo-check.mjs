#!/usr/bin/env node
// Confere o SEO do site publicado (robots, sitemap, llms.txt, title, description, canonical, H1, JSON-LD e noindex).
// Uso: npm run seo:check -- https://seu-site.com.br   (2º argumento opcional: endereço canônico esperado, se diferente)
const [base, canon] = [process.argv[2].replace(/\/$/, ''), (process.argv[3] || process.argv[2]).replace(/\/$/, '')];
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) fail++; };
const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual' }); return { s: r.status, t: await r.text(), ct: r.headers.get('content-type') || '' }; };
const robots = await get('/robots.txt');
ok(robots.s === 200 && robots.ct.includes('text/plain'), `robots.txt ${robots.s} ${robots.ct}`);
ok(robots.t.includes(`Sitemap: ${canon}/sitemap.xml`), 'robots aponta para o sitemap');
const sm = await get('/sitemap.xml');
ok(sm.s === 200 && /xml/.test(sm.ct), `sitemap.xml ${sm.s} ${sm.ct}`);
const locs = [...sm.t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(locs.length >= 5, `sitemap com ${locs.length} URLs`);
const llms = await get('/llms.txt');
ok(llms.s === 200 && llms.t.startsWith('# ORBYTA') && llms.t.includes(canon), `llms.txt ${llms.s} ${llms.ct}`);
for (const loc of locs) {
  const path = loc.replace(canon, '');
  const r = await get(path); const h = r.t;
  const title = h.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const desc = h.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  const can = h.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  const h1 = (h.match(/<h1[\s>]/g) || []).length;
  const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
  const types = lds.flatMap((j) => (j?.['@graph'] ?? [j]).map((n) => n?.['@type']));
  let prev = 0, skip = 0; for (const m of h.matchAll(/<h([1-6])[\s>]/g)) { const l = +m[1]; if (l > prev + 1) skip++; prev = l; }
  console.log(`\n${path}  [${r.s}]`);
  ok(r.s === 200, 'responde 200');
  ok(title.length >= 20 && title.length <= 65, `title (${title.length}): ${title}`);
  ok(desc.length >= 90 && desc.length <= 165, `description (${desc.length})`);
  ok(can === loc, `canonical ${can}`);
  ok(!/name="robots" content="noindex/.test(h), 'indexável (sem noindex)');
  ok(h1 === 1, `um único H1 (${h1})`);
  ok(skip === 0, 'hierarquia de títulos sem pular nível');
  ok(lds.length > 0 && !lds.includes(null), `JSON-LD válido: ${types.join(', ')}`);
  ok(/og:url" content="([^"]*)"/.test(h) && h.match(/og:url" content="([^"]*)"/)[1] === loc, 'og:url = canonical');
}
for (const p of ['/app/', '/orcamento/', '/404.html']) { const r = await get(p); ok(/noindex/.test(r.t), `${p} fica fora do Google (noindex)`); }
const nf = await get('/pagina-que-nao-existe'); ok(nf.s === 404, `página inexistente responde ${nf.s}`);
console.log(fail ? `\n${fail} falha(s)` : '\nTudo certo'); process.exit(fail ? 1 : 0);
