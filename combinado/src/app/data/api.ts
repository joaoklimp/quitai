// Escolhe a fonte de dados: Supabase (quando configurado) ou demonstração.
import type { DataSource } from './source';
import { DemoSource } from './demo/demoSource';
import { SupabaseSource, hasSupabase } from './supabase/supaSource';

const FLAG = 'combinado-modo';

function pickMode(): 'demo' | 'supabase' {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) localStorage.setItem(FLAG, 'demo');
    if (params.has('real')) localStorage.removeItem(FLAG);
    if (!hasSupabase()) return 'demo';
    return localStorage.getItem(FLAG) === 'demo' ? 'demo' : 'supabase';
  } catch {
    return hasSupabase() ? 'supabase' : 'demo';
  }
}

export const api: DataSource = pickMode() === 'demo' ? new DemoSource() : new SupabaseSource();
export const isDemo = api.mode === 'demo';
export const canUseRealAccount = hasSupabase();

export function leaveDemo() {
  try { localStorage.removeItem(FLAG); } catch { /* ignora */ }
  location.href = '/app/?real';
}
export function enterDemo() {
  try { localStorage.setItem(FLAG, 'demo'); } catch { /* ignora */ }
  location.href = '/app/?demo';
}
