// Respostas HTTP, CORS e erros com mensagem amigável (o painel mostra o campo "message").

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function cors(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin') ?? '';
  // sem lista configurada, aceita qualquer origem (as funções exigem login de qualquer forma)
  const allow = !ALLOWED.length ? '*' : ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
}

/** Erro esperado: vira { error, message } com o status certo. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const bad = (message: string, code = 'invalido') => new HttpError(400, code, message);
export const forbidden = (message = 'Você não tem permissão para fazer isso.') => new HttpError(403, 'sem_permissao', message);

/** Envolve o handler: responde ao preflight, transforma erros em JSON e registra o inesperado. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status, req);
      console.error(e);
      return json({ error: 'erro_interno', message: 'Algo deu errado do nosso lado. Tente de novo em instantes.' }, 500, req);
    }
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw bad('Pedido inválido.'); }
}

/** IP de quem chamou (o Supabase repassa no x-forwarded-for). */
export function clientIp(req: Request): string {
  return (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0]).trim() || 'desconhecido';
}

export const str = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
