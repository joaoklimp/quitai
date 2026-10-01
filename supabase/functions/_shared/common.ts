import Stripe from 'npm:stripe@18';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://usequitai.com.br';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://usequitai.com.br,https://www.usequitai.com.br,https://joaoklimp.github.io')
  .split(',').map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
}

export const admin: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// sem a chave cadastrada, a função continua de pé e só as chamadas à Stripe falham
export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || 'sk_test_missing', { httpClient: Stripe.createFetchHttpClient() });

export type Member = { user_id: string; company_id: string; email: string; name: string; role: string; active: boolean };

/** Confere o login de quem chamou e devolve o cadastro dele na equipe. */
export async function caller(req: Request): Promise<Member | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: m } = await admin.from('members').select('*').eq('user_id', data.user.id).maybeSingle();
  return m && m.active ? (m as Member) : null;
}

export const PLAN_IDS = ['basico', 'pro', 'empresa'] as const;
export const CYCLES = ['mensal', 'anual'] as const;
