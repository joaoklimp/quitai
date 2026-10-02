// Copia para as Edge Functions (Deno) o código compartilhado com o painel: formatos, datas, interpretação
// de texto, planos, tipos e horários livres. Assim, preço, limite e regra de agenda são os mesmos nos dois lados.
// Uso: node scripts/sync-functions.mjs [--check]   (--check só confere se as cópias estão em dia)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const FILES = [
  ['src/shared/format.ts', 'format.ts'],
  ['src/shared/parse.ts', 'parse.ts'],
  ['src/shared/plans.ts', 'plans.ts'],
  ['src/shared/templates.ts', 'templates.ts'],
  ['src/app/data/types.ts', 'types.ts'],
  ['src/app/data/availability.ts', 'availability.ts'],
];
const IMPORTS = {
  "'./format'": "'./format.ts'",
  "'../app/data/types'": "'./types.ts'",
  "'../../shared/plans'": "'./plans.ts'",
  "'../../shared/format'": "'./format.ts'",
  "'./types'": "'./types.ts'",
};

export function render(src) {
  let code = readFileSync(root + src, 'utf8');
  for (const [from, to] of Object.entries(IMPORTS)) code = code.replaceAll(`from ${from}`, `from ${to}`);
  return `// GERADO por scripts/sync-functions.mjs a partir de ${src}. Não edite aqui: edite o original e rode "npm run sync:functions".\n${code}`;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [src, dst] of FILES) {
  const out = `${root}supabase/functions/_shared/${dst}`;
  const next = render(src);
  if (check) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== next) { console.error(`desatualizado: supabase/functions/_shared/${dst}`); stale++; }
  } else writeFileSync(out, next);
}
if (check && stale) process.exit(1);
if (!check) console.log(`${FILES.length} arquivos copiados para supabase/functions/_shared`);
