// Marca do produto num lugar só: para trocar o nome, mude aqui (e o <title> dos HTML).
export const BRAND = {
  name: 'ORBYTA',
  tagline: 'Sua empresa funcionando por uma conversa.',
  description:
    'Plataforma com inteligência artificial integrada ao WhatsApp que atende clientes, cria orçamentos, marca horários e executa tarefas administrativas por comandos simples.',
  supportEmail: 'contato@orbyta.com.br',
};

/** Símbolo da ORBYTA: um anel em órbita com uma lua. Ele também é o "O" do nome (símbolo + RBYTΛ). */
const MARK = (id: string) => `<defs><linearGradient id="${id}g" x1=".15" y1=".9" x2=".85" y2=".1"><stop offset="0" stop-color="#1747F5"/><stop offset=".55" stop-color="#1E7BFF"/><stop offset="1" stop-color="#36C2FF"/></linearGradient>
<radialGradient id="${id}d" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#9BE7FF"/><stop offset="1" stop-color="#2FA8FF"/></radialGradient>
<mask id="${id}m"><rect width="48" height="48" fill="#fff"/><circle cx="25.2" cy="23.4" r="9.6" fill="#000"/><path d="M23.5 25 L51.32 13.76 L34.74 -2.82 Z" fill="#000"/></mask></defs>
<circle cx="23.5" cy="25" r="14" fill="url(#${id}g)" mask="url(#${id}m)"/><circle cx="33.4" cy="15.1" r="3.2" fill="url(#${id}d)"/>`;

/** Ícone com fundo (favicon, app, avatar da marca). */
export function logoSvg(size = 40, opts: { bg?: string; title?: boolean } = {}): string {
  const bg = opts.bg ?? '#050A1A';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" ${opts.title === false ? 'aria-hidden="true"' : 'role="img" aria-label="ORBYTA"'}><rect width="48" height="48" rx="14" fill="${bg}"/>${MARK('ob')}</svg>`;
}

/** Só o símbolo, sem fundo. */
export function markSvg(size = 40): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="9 11 30 30" aria-hidden="true">${MARK('om')}</svg>`;
}

/** Logotipo completo: o símbolo faz o "O" e o "A" final é um Λ, como na marca. */
export function wordmarkHtml(height = 28): string {
  const lambda = `<svg class="wm-a" viewBox="0 0 20 24" aria-hidden="true"><path d="M1.5 24 10 2.2 18.5 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linejoin="miter"/></svg>`;
  return `<span class="wordmark" style="--wm:${height}px" role="img" aria-label="ORBYTA">${markSvg(height)}<span class="wm-t" aria-hidden="true">RBYT</span>${lambda}</span>`;
}
