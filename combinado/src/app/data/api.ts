// Escolhe a fonte de dados: Supabase (quando configurado) ou demonstração.
import type { DataSource } from './source';
import { DemoSource, demoSession, setDemoSession } from './demo/demoSource';
import { SupabaseSource, hasSupabase } from './supabase/supaSource';

const FLAG = 'orbyta-modo';

function pickMode(): 'demo' | 'supabase' {
  try {
    const params = new URLSearchParams(location.search);
    // link dos e-mails de acesso (confirmação, convite, nova senha) é sempre da conta real
    const authLink = /[?&#](code|token_hash|access_token|error_description)=/.test(location.search + location.hash);
    if (params.has('demo') && !authLink) localStorage.setItem(FLAG, 'demo');
    if (params.has('real') || authLink) localStorage.removeItem(FLAG);
    if (!hasSupabase()) return 'demo';
    return localStorage.getItem(FLAG) === 'demo' ? 'demo' : 'supabase';
  } catch {
    return hasSupabase() ? 'supabase' : 'demo';
  }
}

const mode = pickMode();
// Sem servidor configurado, o site funciona como vitrine: "Entrar" e "Teste grátis" (?real) mostram a tela de acesso
// simulada; "Ver demonstração" (?demo) entra direto na empresa de exemplo.
try {
  const params = new URLSearchParams(location.search);
  if (mode === 'demo' && params.has('demo')) setDemoSession({ ...demoSession(), state: demoSession().state === 'onboarding' ? 'onboarding' : 'on' });
  if (mode === 'demo' && params.has('real') && !hasSupabase()) setDemoSession({ state: 'off' });
  if (params.has('demo') || params.has('real')) {
    params.delete('demo'); params.delete('real');
    const q = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  }
} catch { /* ignora */ }
export const api: DataSource = mode === 'demo' ? new DemoSource() : new SupabaseSource();
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
