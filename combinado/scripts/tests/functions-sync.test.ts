// As Edge Functions usam cópias do código compartilhado (formatos, planos, agenda). Este teste garante
// que ninguém editou o original sem atualizar as cópias (rode "npm run sync:functions").
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('código compartilhado com as Edge Functions', () => {
  it('as cópias em supabase/functions/_shared estão em dia', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    expect(() => execFileSync('node', ['scripts/sync-functions.mjs', '--check'], { cwd: root, stdio: 'pipe' })).not.toThrow();
  });
});
