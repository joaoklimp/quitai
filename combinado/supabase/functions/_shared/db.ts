// Acesso ao banco com a chave de serviço (ignora o RLS: as funções conferem permissões antes de agir).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { HttpError } from './http.ts';
import type { Role } from './types.ts';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
export const db: SupabaseClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface Caller { userId: string; companyId: string; role: Role; name: string; email: string }

/** Confere o login de quem chamou (token do painel) e devolve o cadastro na equipe. */
export async function caller(req: Request): Promise<Caller> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'nao_autenticado', 'Entre na sua conta para continuar.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'nao_autenticado', 'Sua sessão expirou. Entre de novo.');
  const { data: m } = await db.from('members').select('company_id, role, name, email, active').eq('user_id', data.user.id).maybeSingle();
  if (!m || !m.active) throw new HttpError(403, 'sem_empresa', 'Seu acesso a esta empresa não está ativo.');
  return { userId: data.user.id, companyId: m.company_id, role: m.role, name: m.name || data.user.email || 'Equipe', email: m.email || data.user.email || '' };
}

export function requireRole(c: Caller, ...roles: Role[]) {
  if (!roles.includes(c.role)) throw new HttpError(403, 'sem_permissao', roles.length === 1 && roles[0] === 'dono' ? 'Só o dono da conta pode fazer isso.' : 'Seu papel na equipe não permite fazer isso.');
}

/** Lança o erro do Supabase como erro interno (com contexto no log). */
export function check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export async function audit(row: {
  company_id: string; action: string; summary: string; actor_type?: 'usuario' | 'ia' | 'sistema' | 'cliente'; actor_name?: string | null; actor_user_id?: string | null;
  channel?: string; target_type?: string | null; target_id?: string | null; status?: string; meta?: Record<string, unknown> | null;
}) {
  const { error } = await db.from('audit_log').insert({ actor_type: 'ia', channel: 'ia_cliente', status: 'ok', ...row });
  if (error) console.error('histórico', error.message);
}

export async function notify(company_id: string, kind: string, title: string, body?: string | null, link?: string | null, user_id?: string | null) {
  const { error } = await db.from('notifications').insert({ company_id, kind, title, body: body ?? null, link: link ?? null, user_id: user_id ?? null });
  if (error) console.error('aviso', error.message);
}
