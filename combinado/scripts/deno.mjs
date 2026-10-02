// Roda o Deno (via npx) nas Edge Functions, isolado do package.json do painel.
// Uso: node scripts/deno.mjs check | test
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] === 'test' ? 'test' : 'check';
const cwd = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
const common = ['--no-config', '--node-modules-dir=none', '--min-dep-age=0'];
const fns = ['agent', 'whatsapp-webhook', 'whatsapp', 'billing', 'asaas-webhook', 'team', 'cron'].map((f) => `${f}/index.ts`);
const args = mode === 'test' ? ['test', ...common, '--allow-env', '--allow-net=127.0.0.1', 'tests/'] : ['check', ...common, ...fns];
const r = spawnSync('npx', ['--yes', 'deno@2', ...args], { cwd, stdio: 'inherit', env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' }, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
