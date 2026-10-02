// Marca do produto num lugar só: para trocar o nome, mude aqui (e o <title> dos HTML).
export const BRAND = {
  name: 'Combinado',
  tagline: 'Sua empresa funcionando por uma conversa.',
  description:
    'Plataforma com inteligência artificial integrada ao WhatsApp que atende clientes, cria orçamentos, marca horários e executa tarefas administrativas por comandos simples.',
  supportEmail: 'contato@combinado.app',
};

/** Marca: dois balões de conversa (você e seu cliente) que se encontram — o encontro é o "combinado". */
export function logoSvg(size = 40, opts: { bg?: string; title?: boolean } = {}): string {
  const bg = opts.bg ?? '#0B0D12';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" ${opts.title === false ? 'aria-hidden="true"' : 'role="img" aria-label="Combinado"'}>
<defs><clipPath id="cb-l"><path d="M19.5 9.5a10.5 10.5 0 1 1-6.9 18.4L8.6 30l1.3-4.6A10.5 10.5 0 0 1 19.5 9.5Z"/></clipPath>
<linearGradient id="cb-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B9BFF"/><stop offset="1" stop-color="#2F6FF0"/></linearGradient>
<linearGradient id="cb-o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFA061"/><stop offset="1" stop-color="#FF6A1F"/></linearGradient></defs>
<rect width="48" height="48" rx="14" fill="${bg}"/>
<path d="M19.5 9.5a10.5 10.5 0 1 1-6.9 18.4L8.6 30l1.3-4.6A10.5 10.5 0 0 1 19.5 9.5Z" fill="url(#cb-b)"/>
<path d="M28.5 17.5a10.5 10.5 0 1 0 6.9 18.4l4 2.1-1.3-4.6A10.5 10.5 0 0 0 28.5 17.5Z" fill="url(#cb-o)"/>
<path d="M28.5 17.5a10.5 10.5 0 1 0 6.9 18.4l4 2.1-1.3-4.6A10.5 10.5 0 0 0 28.5 17.5Z" fill="#fff" clip-path="url(#cb-l)"/>
</svg>`;
}
