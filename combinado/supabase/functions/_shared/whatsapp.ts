// WhatsApp Cloud API (Meta): enviar texto, botões e modelos, marcar como lida, baixar mídia,
// validar a assinatura do webhook e concluir a conexão do número (cadastro incorporado).
import { db } from './db.ts';
import { open } from './crypto.ts';
import { TEMPLATE_LIST } from './templates.ts';

const VERSION = Deno.env.get('META_GRAPH_VERSION') || 'v23.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export interface WaAccount { company_id: string; phone_number_id: string; access_token: string; display_phone: string | null }

export class WaError extends Error {
  constructor(public code: number | null, public detail: string, public status: number) { super(`WhatsApp ${status}${code ? ` (${code})` : ''}: ${detail}`); }
  /** Mensagem para mostrar no painel. */
  get friendly(): string {
    switch (this.code) {
      case 131047: return 'Já passaram 24 horas desde a última mensagem do cliente. Para escrever agora, o WhatsApp exige um modelo de mensagem aprovado.';
      case 190: return 'A conexão com o WhatsApp expirou. Conecte de novo em Configurações → WhatsApp.';
      case 132001: return 'O modelo de mensagem não existe ou ainda não foi aprovado pela Meta.';
      case 131026: return 'O WhatsApp não conseguiu entregar a mensagem para este número.';
      case 130429: case 131056: return 'O WhatsApp limitou os envios por alguns instantes. Tente de novo daqui a pouco.';
      case 133010: return 'Este número ainda não foi registrado na API do WhatsApp.';
      default: return 'O WhatsApp recusou o envio. Tente de novo em instantes.';
    }
  }
}

async function graph<T = Record<string, unknown>>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* corpo não-JSON */ }
  if (!res.ok) {
    const err = (data.error ?? {}) as { code?: number; message?: string; error_data?: { details?: string } };
    throw new WaError(err.code ?? null, err.error_data?.details ?? err.message ?? text.slice(0, 300), res.status);
  }
  return data as T;
}

/** Conta conectada da empresa (com o token), ou nulo se não houver. */
export async function loadAccount(companyId: string): Promise<WaAccount | null> {
  const [{ data: acc }, { data: cred }] = await Promise.all([
    db.from('whatsapp_accounts').select('phone_number_id, display_phone, status').eq('company_id', companyId).maybeSingle(),
    db.from('whatsapp_credentials').select('access_token').eq('company_id', companyId).maybeSingle(),
  ]);
  if (!acc || acc.status !== 'conectado' || !acc.phone_number_id || !cred?.access_token) return null;
  return { company_id: companyId, phone_number_id: acc.phone_number_id, access_token: await open(cred.access_token), display_phone: acc.display_phone };
}

async function send(acc: WaAccount, to: string, payload: Record<string, unknown>): Promise<string> {
  const r = await graph<{ messages?: { id: string }[] }>(`${acc.phone_number_id}/messages`, acc.access_token, {
    method: 'POST', body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload },
  });
  return r.messages?.[0]?.id ?? '';
}

export function sendText(acc: WaAccount, to: string, body: string) {
  return send(acc, to, { type: 'text', text: { body: body.slice(0, 4096), preview_url: /https?:\/\//.test(body) } });
}

/** Até 3 botões de resposta rápida (título com até 20 caracteres). */
export function sendButtons(acc: WaAccount, to: string, body: string, buttons: { id: string; title: string }[]) {
  return send(acc, to, {
    type: 'interactive',
    interactive: { type: 'button', body: { text: body.slice(0, 1024) }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } },
  });
}

// a Meta recusa variáveis com quebra de linha, tabulação ou mais de 4 espaços seguidos
const cleanParam = (t: string) => (t || '-').replace(/[\n\t\r]+/g, ' · ').replace(/ {4,}/g, '   ').slice(0, 1000);

/** Modelo aprovado (necessário fora da janela de 24 horas). */
export function sendTemplate(acc: WaAccount, to: string, name: string, params: string[], lang = 'pt_BR') {
  return send(acc, to, {
    type: 'template',
    template: { name, language: { code: lang }, components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: cleanParam(text) })) }] : [] },
  });
}

/** Marca como lida e mostra "digitando..." para o cliente enquanto a IA pensa. */
export async function markRead(acc: WaAccount, messageId: string, typing = true) {
  try {
    await graph(`${acc.phone_number_id}/messages`, acc.access_token, {
      method: 'POST', body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId, ...(typing ? { typing_indicator: { type: 'text' } } : {}) },
    });
  } catch (e) { console.error('marcar como lida', (e as Error).message); }
}

export async function downloadMedia(acc: WaAccount, mediaId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const meta = await graph<{ url: string; mime_type: string }>(mediaId, acc.access_token);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${acc.access_token}` } });
  if (!res.ok) throw new WaError(null, `download ${res.status}`, res.status);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: meta.mime_type };
}

/** O cliente escreveu nas últimas 24 horas? (fora disso só vale modelo aprovado) */
export function withinWindow(lastInboundAt: string | null | undefined, now = Date.now()): boolean {
  return !!lastInboundAt && now - Date.parse(lastInboundAt) < 24 * 3600 * 1000 - 60_000;
}

/** Confere o cabeçalho X-Hub-Signature-256 (HMAC-SHA256 do corpo com o App Secret). */
export async function verifySignature(raw: Uint8Array<ArrayBuffer>, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=') || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
  const got = header.slice(7).toLowerCase();
  if (got.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/* ---------- conexão do número ---------- */
export async function exchangeCode(code: string): Promise<string> {
  const appId = Deno.env.get('META_APP_ID') ?? '';
  const secret = Deno.env.get('META_APP_SECRET') ?? '';
  const res = await fetch(`${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new WaError(data?.error?.code ?? null, data?.error?.message ?? 'troca do código falhou', res.status);
  return data.access_token as string;
}
export const phoneInfo = (phoneNumberId: string, token: string) =>
  graph<{ display_phone_number?: string; verified_name?: string }>(`${phoneNumberId}?fields=display_phone_number,verified_name`, token);
export const subscribeApp = (wabaId: string, token: string) => graph(`${wabaId}/subscribed_apps`, token, { method: 'POST' });
export const registerNumber = (phoneNumberId: string, token: string, pin: string) =>
  graph(`${phoneNumberId}/register`, token, { method: 'POST', body: { messaging_product: 'whatsapp', pin } });

/* ---------- modelos de mensagem: a ORBYTA cadastra sozinha na conta da clínica ---------- */
export type TemplateStatus = { name: string; status: 'aprovado' | 'em_analise' | 'recusado' | 'pausado' | 'erro'; reason?: string };
const STATUS: Record<string, TemplateStatus['status']> = { APPROVED: 'aprovado', PENDING: 'em_analise', IN_APPEAL: 'em_analise', REJECTED: 'recusado', PAUSED: 'pausado', DISABLED: 'recusado', LIMIT_EXCEEDED: 'erro' };

/** Cria na conta (WABA) os modelos da ORBYTA que ainda não existem e devolve a situação de cada um. Pode rodar quantas vezes quiser. */
export async function ensureTemplates(wabaId: string, token: string): Promise<TemplateStatus[]> {
  const have = await graph<{ data?: { name: string; language: string; status: string; rejected_reason?: string }[] }>(
    `${wabaId}/message_templates?fields=name,language,status,rejected_reason&limit=200`, token);
  const existing = new Map((have.data ?? []).filter((t) => t.language === 'pt_BR').map((t) => [t.name, t]));
  const out: TemplateStatus[] = [];
  for (const t of TEMPLATE_LIST) {
    const found = existing.get(t.name);
    if (found) {
      out.push({ name: t.name, status: STATUS[found.status] ?? 'em_analise', ...(found.rejected_reason && found.rejected_reason !== 'NONE' ? { reason: found.rejected_reason } : {}) });
      continue;
    }
    try {
      const r = await graph<{ status?: string }>(`${wabaId}/message_templates`, token, {
        method: 'POST',
        body: {
          name: t.name, language: 'pt_BR', category: t.category === 'Marketing' ? 'MARKETING' : 'UTILITY',
          components: [{ type: 'BODY', text: t.body, ...(t.example.length ? { example: { body_text: [t.example] } } : {}) }],
        },
      });
      out.push({ name: t.name, status: STATUS[r.status ?? 'PENDING'] ?? 'em_analise' });
    } catch (e) {
      out.push({ name: t.name, status: 'erro', reason: e instanceof WaError ? e.detail.slice(0, 160) : String(e) });
    }
  }
  return out;
}
