// SEO do site público (roda só no build): páginas indexáveis, robots.txt, sitemap.xml, llms.txt, dados estruturados (JSON-LD) e tags de compartilhamento.
import { PAID_PLANS, PLANS, TRIAL_DAYS } from '../shared/plans';

export interface SeoPage {
  path: string; // URL canônica relativa, sempre com barra no fim
  file: string; // HTML de origem (relativo à raiz do projeto)
  type: 'WebPage' | 'AboutPage';
  crumb: string; // nome curto na trilha (breadcrumb)
  priority: string;
  changefreq: 'weekly' | 'monthly' | 'yearly';
}

/** Só o que deve aparecer no Google. Painel (/app/), orçamentos públicos (/orcamento/) e a 404 ficam de fora. */
export const SEO_PAGES: SeoPage[] = [
  { path: '/', file: 'index.html', type: 'WebPage', crumb: 'Início', priority: '1.0', changefreq: 'weekly' },
  { path: '/sobre/', file: 'sobre/index.html', type: 'AboutPage', crumb: 'Sobre', priority: '0.8', changefreq: 'monthly' },
  { path: '/seguranca/', file: 'seguranca/index.html', type: 'WebPage', crumb: 'Segurança', priority: '0.7', changefreq: 'monthly' },
  { path: '/termos/', file: 'termos/index.html', type: 'WebPage', crumb: 'Termos de uso', priority: '0.3', changefreq: 'yearly' },
  { path: '/privacidade/', file: 'privacidade/index.html', type: 'WebPage', crumb: 'Privacidade', priority: '0.3', changefreq: 'yearly' },
];

const CONTACT = 'contato@orbyta.com.br';
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = (html: string) => decode(html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function pageMeta(html: string) {
  return {
    title: text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'ORBYTA'),
    description: decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''),
  };
}

const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function orgAndSite(site: string) {
  return [
    {
      '@type': 'Organization', '@id': `${site}/#org`, name: 'ORBYTA', url: `${site}/`,
      logo: { '@type': 'ImageObject', url: `${site}/icon-512.png`, width: 512, height: 512 },
      email: CONTACT,
      description: 'Plataforma brasileira de gestão empresarial com inteligência artificial que trabalha pelo WhatsApp.',
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: CONTACT, availableLanguage: 'Portuguese' },
    },
    { '@type': 'WebSite', '@id': `${site}/#site`, name: 'ORBYTA', url: `${site}/`, inLanguage: 'pt-BR', publisher: { '@id': `${site}/#org` } },
  ];
}

/** JSON-LD de cada página: organização e site em todas; produto, preços e perguntas frequentes na inicial; trilha nas internas. */
export function jsonLd(site: string, page: SeoPage, html: string): string {
  const { title, description } = pageMeta(html);
  const url = `${site}${page.path}`;
  const graph: Record<string, unknown>[] = [
    ...orgAndSite(site),
    {
      '@type': page.type, '@id': `${url}#pagina`, url, name: title, description, inLanguage: 'pt-BR',
      isPartOf: { '@id': `${site}/#site` }, about: { '@id': `${site}/#org` },
      primaryImageOfPage: { '@type': 'ImageObject', url: `${site}/img/og.png`, width: 1200, height: 630 },
      ...(page.path !== '/' ? { breadcrumb: { '@id': `${url}#trilha` } } : {}),
    },
  ];
  if (page.path === '/') {
    graph.push({
      '@type': 'SoftwareApplication', '@id': `${site}/#app`, name: 'ORBYTA', url: `${site}/`,
      applicationCategory: 'BusinessApplication', applicationSubCategory: 'Atendimento e gestão pelo WhatsApp com IA',
      operatingSystem: 'Web', inLanguage: 'pt-BR', image: `${site}/img/og.png`, publisher: { '@id': `${site}/#org` },
      description,
      featureList: [
        'Atendimento 24h no WhatsApp com inteligência artificial', 'Entende áudios e responde por texto', 'Agenda com lembretes automáticos',
        'Orçamentos com link para aprovação', 'Cobrança por Pix, boleto e cartão', 'Encaixe automático com lista de espera',
        'Resumo diário e relatório semanal no WhatsApp', 'Comandos do dono por mensagem, com confirmação antes de ações sensíveis',
      ],
      offers: [
        { '@type': 'Offer', name: `Teste grátis (${TRIAL_DAYS} dias)`, price: '0', priceCurrency: 'BRL', url: `${site}/#precos`, availability: 'https://schema.org/InStock' },
        ...PAID_PLANS.map((id) => ({
          '@type': 'Offer', name: `Plano ${PLANS[id].name}`, description: PLANS[id].blurb, price: String(PLANS[id].monthly), priceCurrency: 'BRL',
          url: `${site}/#precos`, availability: 'https://schema.org/InStock',
          priceSpecification: { '@type': 'UnitPriceSpecification', price: PLANS[id].monthly, priceCurrency: 'BRL', unitText: 'MONTH', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' } },
        })),
      ],
    });
    const faq = [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({
      '@type': 'Question', name: text(m[1]), acceptedAnswer: { '@type': 'Answer', text: text(m[2]) },
    }));
    if (faq.length) graph.push({ '@type': 'FAQPage', '@id': `${site}/#duvidas`, url: `${site}/#duvidas`, inLanguage: 'pt-BR', mainEntity: faq });
  } else {
    graph.push({
      '@type': 'BreadcrumbList', '@id': `${url}#trilha`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Início', item: `${site}/` },
        { '@type': 'ListItem', position: 2, name: page.crumb, item: url },
      ],
    });
  }
  return ld({ '@context': 'https://schema.org', '@graph': graph });
}

/** Completa as tags de compartilhamento que faltarem (título, descrição, URL, idioma, cartão do X/Twitter). */
export function socialTags(site: string, page: SeoPage, html: string): string {
  const { title, description } = pageMeta(html);
  const want: [string, string][] = [
    ['property="og:type"', 'website'], ['property="og:locale"', 'pt_BR'], ['property="og:site_name"', 'ORBYTA'],
    ['property="og:title"', title], ['property="og:description"', description], ['property="og:url"', `${site}${page.path}`],
    ['property="og:image"', `${site}/img/og.png`], ['name="twitter:card"', 'summary_large_image'],
  ];
  return want.filter(([attr]) => !html.includes(`<meta ${attr}`)).map(([attr, v]) => `<meta ${attr} content="${v.replace(/"/g, '&quot;')}">`).join('\n');
}

export function robotsTxt(site: string): string {
  return [
    '# ORBYTA: páginas públicas liberadas para buscadores e assistentes de IA.',
    'User-agent: *',
    'Allow: /',
    '# painel (exige login) e orçamentos enviados a clientes (links privados)',
    'Disallow: /app/',
    'Disallow: /orcamento/',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    `# Resumo para IA: ${site}/llms.txt`,
    '',
  ].join('\n');
}

export function sitemapXml(site: string, lastmod: string): string {
  const urls = SEO_PAGES.map((p) => `  <url>\n    <loc>${xml(`${site}${p.path}`)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** llms.txt (formato llmstxt.org): o que é a ORBYTA, para quem, preços e as páginas que valem a pena ler. */
export function llmsTxt(site: string, metas: Map<string, { title: string; description: string }>): string {
  const link = (p: SeoPage) => `- [${metas.get(p.path)?.title ?? p.crumb}](${site}${p.path}): ${metas.get(p.path)?.description ?? ''}`;
  const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`;
  return `# ORBYTA

> ORBYTA é uma plataforma brasileira de gestão empresarial com inteligência artificial que trabalha pelo WhatsApp oficial (API da Meta). A IA atende os clientes da empresa 24 horas, entende áudios, marca horários, monta orçamentos, cobra por Pix, boleto ou cartão e encaixa quem está na lista de espera quando alguém desmarca. O dono administra tudo por mensagens e por um painel web, e confirma antes de qualquer ação que mexa com dinheiro ou cancele algo.

- Público: pequenas e médias empresas de serviços e comércio no Brasil (salões, clínicas, oficinas, higienização, assistência técnica, lojas, entre outras).
- Idioma: português do Brasil.
- Diferença para assistentes de IA genéricos: a ORBYTA executa o trabalho dentro da empresa (agenda, orçamentos, cobranças, estoque, financeiro e equipe), com regras, permissões e histórico de cada ação, em vez de só responder perguntas.
- Teste grátis: ${TRIAL_DAYS} dias, sem cartão.
- Contato: ${CONTACT}

## Páginas principais

${SEO_PAGES.filter((p) => p.path === '/' || p.path === '/sobre/' || p.path === '/seguranca/').map(link).join('\n')}

## Planos (preço mensal; o plano anual custa o equivalente a 10 meses)

${PAID_PLANS.map((id) => `- ${PLANS[id].name}: ${brl(PLANS[id].monthly)}/mês. ${PLANS[id].blurb} ${PLANS[id].aiReplies.toLocaleString('pt-BR')} respostas da IA por mês, até ${PLANS[id].users} pessoas na equipe.`).join('\n')}
- Detalhes e comparação: ${site}/#precos

## Como começar

- Criar conta: ${site}/app/?real#/cadastro
- Demonstração sem cadastro: ${site}/app/?demo

## Optional

${SEO_PAGES.filter((p) => p.path === '/termos/' || p.path === '/privacidade/').map(link).join('\n')}
- [Contato de segurança](${site}/.well-known/security.txt): como relatar uma vulnerabilidade.
`;
}
