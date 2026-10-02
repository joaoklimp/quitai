import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Site em várias páginas: landing estática, painel (SPA), orçamento público e páginas legais.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        site: page('./index.html'),
        app: page('./app/index.html'),
        orcamento: page('./orcamento/index.html'),
        termos: page('./termos/index.html'),
        privacidade: page('./privacidade/index.html'),
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
