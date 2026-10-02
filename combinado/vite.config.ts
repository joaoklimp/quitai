import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wordmarkHtml } from './src/shared/brand';
import { SITE_FOOTER, SITE_HEADER } from './src/site/chrome';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Endereço público do site (usado nas tags de compartilhamento). Defina VITE_SITE_URL no deploy.
const SITE_URL = (process.env.VITE_SITE_URL || 'https://orbyta.com.br').replace(/\/$/, '');

/** Páginas estáticas (landing, institucionais e legais): monta cabeçalho e rodapé compartilhados, troca <i data-icon="nome"></i> pelo SVG do Lucide, <i data-wordmark="altura"></i> pelo logotipo e __SITE_URL__ pelo endereço do site. */
function staticHtml(): Plugin {
  const dir = page('./node_modules/lucide-react/dist/esm/icons/');
  const cache = new Map<string, string>();
  const icon = (name: string) => {
    let inner = cache.get(name);
    if (inner === undefined) {
      let src = readFileSync(`${dir}${name}.mjs`, 'utf8');
      const alias = src.match(/export \{ default \} from '\.\/([a-z0-9-]+)\.mjs'/); // nomes antigos apontam para o novo
      if (alias) src = readFileSync(`${dir}${alias[1]}.mjs`, 'utf8');
      const m = src.match(/const __iconData = (\{[\s\S]*?\});\s*\n__iconData\.node;/);
      if (!m) throw new Error(`Ícone do Lucide não encontrado: ${name}`);
      const nodes = (new Function(`return ${m[1]}`)() as { node: [string, Record<string, string>][] }).node;
      inner = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
      cache.set(name, inner);
    }
    return inner;
  };
  return {
    name: 'orbyta-static-html',
    transformIndexHtml(html) {
      return html
        .replace('<header data-site-header></header>', SITE_HEADER)
        .replace('<footer data-site-footer></footer>', SITE_FOOTER)
        .replace(/<i data-icon="([a-z0-9-]+)"(?:\s+class="([^"]*)")?\s*><\/i>/g, (_, name: string, cls?: string) =>
          `<svg class="${['ic', cls].filter(Boolean).join(' ')}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(name)}</svg>`)
        .replace(/<i data-wordmark="(\d+)"><\/i>/g, (_, h: string) => wordmarkHtml(Number(h)))
        .replaceAll('__SITE_URL__', SITE_URL);
    },
  };
}

// Site em várias páginas: landing estática, painel (SPA), orçamento público e páginas legais.
export default defineConfig({
  plugins: [react(), staticHtml()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        site: page('./index.html'),
        app: page('./app/index.html'),
        orcamento: page('./orcamento/index.html'),
        termos: page('./termos/index.html'),
        privacidade: page('./privacidade/index.html'),
        seguranca: page('./seguranca/index.html'),
        sobre: page('./sobre/index.html'),
        naoEncontrada: page('./404.html'),
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
