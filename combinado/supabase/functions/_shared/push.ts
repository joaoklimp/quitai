// Notificações nos aparelhos (celular e computador): chaves do servidor, aparelhos de cada pessoa e entrega dos avisos.
import { db, rateLimit } from './db.ts';
import { open, seal } from './crypto.ts';
import { generateVapidKeys, sendWebPush, type PushOptions, type PushSender, type PushTarget, type VapidKeys } from './webpush.ts';
import type { Notification, Role } from './types.ts';

export const MAX_DEVICES = 10;
/** Avisos de dinheiro e da assinatura: só para quem vê o financeiro (mesma regra do sino no painel). */
export const MANAGER_KINDS: Notification['kind'][] = ['venda', 'financeiro', 'assinatura'];
const MANAGERS: Role[] = ['dono', 'gerente'];
export const ALL_KINDS: Notification['kind'][] = ['atendimento', 'agendamento', 'orcamento', 'venda', 'tarefa', 'estoque', 'financeiro', 'assinatura', 'sistema'];

/** Texto da tela bloqueada no modo discreto (padrão): sem nome de paciente, valor ou detalhe. */
const DISCREET: Record<Notification['kind'], string> = {
  atendimento: 'Um paciente precisa de atendimento',
  agendamento: 'Novidade na agenda',
  orcamento: 'Novidade em um orçamento',
  venda: 'Pagamento recebido',
  tarefa: 'Lembrete de tarefa',
  estoque: 'Aviso do estoque',
  financeiro: 'Aviso do financeiro',
  assinatura: 'Aviso sobre a assinatura',
  sistema: 'Aviso da ORBYTA',
};

export const vapidSubject = () => (Deno.env.get('VAPID_SUBJECT') || Deno.env.get('SITE_URL') || 'https://combinado-roan.vercel.app').replace(/\/$/, '');

let vapidCache: Promise<VapidKeys> | null = null;
/** Chaves VAPID do projeto: criadas na primeira vez e guardadas criptografadas (a privada nunca sai do servidor). */
export function vapidKeys(): Promise<VapidKeys> {
  vapidCache ??= (async () => {
    const read = async () => {
      const { data, error } = await db.from('app_secrets').select('value').eq('name', 'vapid').maybeSingle();
      if (error) throw new Error(`chaves das notificações: ${error.message}`);
      return data ? JSON.parse(await open(data.value)) as VapidKeys : null;
    };
    const found = await read();
    if (found) return found;
    const fresh = await generateVapidKeys();
    // duas chamadas ao mesmo tempo: fica a primeira gravada
    await db.from('app_secrets').upsert({ name: 'vapid', value: await seal(JSON.stringify(fresh)) }, { onConflict: 'name', ignoreDuplicates: true });
    const saved = await read();
    if (!saved) throw new Error('chaves das notificações não foram gravadas');
    return saved;
  })().catch((e) => { vapidCache = null; throw e; });
  return vapidCache;
}

export interface PushPrefs { muted: Notification['kind'][]; details: boolean }
export async function getPrefs(userId: string): Promise<PushPrefs> {
  const { data } = await db.from('push_prefs').select('muted, details').eq('user_id', userId).maybeSingle();
  return { muted: (data?.muted ?? []) as Notification['kind'][], details: !!data?.details };
}

type NotificationRow = Pick<Notification, 'id' | 'company_id' | 'user_id' | 'kind' | 'title' | 'body' | 'link' | 'created_at'>;

/** O que aparece no aparelho. Sem `details`, a tela bloqueada não mostra nomes nem valores. */
export function payloadFor(n: NotificationRow, details: boolean): Record<string, unknown> {
  const link = typeof n.link === 'string' && /^#\/[\w\-/?=&%.]*$/.test(n.link) ? n.link : '#/';
  const clip = (s: string | null | undefined, max: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
  return {
    title: details ? clip(n.title, 120) || DISCREET[n.kind] : DISCREET[n.kind] ?? 'Aviso da ORBYTA',
    body: details ? clip(n.body, 280) : 'Toque para ver na ORBYTA.',
    link,
    kind: n.kind,
    // avisos do mesmo assunto (ex.: a mesma conversa) se substituem em vez de empilhar
    tag: link !== '#/' ? `${n.kind}:${link}` : n.id,
    at: n.created_at,
  };
}

const urgency = (k: Notification['kind']): PushOptions['urgency'] => (k === 'atendimento' || k === 'agendamento' ? 'high' : 'normal');

export interface DeliverResult { sent: number; failed: number; removed: number; skipped?: string }

/** Entrega um aviso do painel nos aparelhos de quem deve vê-lo (chamado pelo banco a cada aviso novo). */
export async function deliver(id: string, send: PushSender = sendWebPush): Promise<DeliverResult> {
  const out: DeliverResult = { sent: 0, failed: 0, removed: 0 };
  const { data: n } = await db.from('notifications').select('id, company_id, user_id, kind, title, body, link, created_at').eq('id', id).maybeSingle();
  if (!n) return { ...out, skipped: 'aviso não encontrado' };
  // avisos antigos (fila atrasada) não viram notificação fora de hora
  if (Date.now() - Date.parse(n.created_at) > 2 * 3600_000) return { ...out, skipped: 'aviso antigo' };
  // cada aviso é entregue uma vez só, mesmo se o banco chamar de novo
  try { await rateLimit(`push:${n.id}`, 1, 86_400); } catch { return { ...out, skipped: 'já entregue' }; }

  let q = db.from('members').select('user_id, role').eq('company_id', n.company_id).eq('active', true);
  if (n.user_id) q = q.eq('user_id', n.user_id);
  const { data: members } = await q;
  const people = (members ?? []).filter((m) => !MANAGER_KINDS.includes(n.kind) || MANAGERS.includes(m.role as Role)).map((m) => m.user_id as string);
  if (!people.length) return { ...out, skipped: 'ninguém para avisar' };

  const [{ data: prefs }, { data: subs }] = await Promise.all([
    db.from('push_prefs').select('user_id, muted, details').in('user_id', people),
    db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, failures').eq('company_id', n.company_id).in('user_id', people),
  ]);
  const pref = new Map((prefs ?? []).map((p) => [p.user_id as string, p as { muted: string[]; details: boolean }]));
  const targets = (subs ?? []).filter((s) => !(pref.get(s.user_id)?.muted ?? []).includes(n.kind));
  if (!targets.length) return { ...out, skipped: 'nenhum aparelho' };
  return await sendTo(targets, (s) => payloadFor(n as NotificationRow, !!pref.get(s.user_id)?.details), { urgency: urgency(n.kind) }, send);
}

type SubRow = PushTarget & { id: string; user_id: string; failures: number };

/** Envia para vários aparelhos ao mesmo tempo e faz a faxina: inscrição cancelada some; falha repetida também. */
export async function sendTo(targets: SubRow[], payload: (s: SubRow) => Record<string, unknown>, opts: PushOptions, send: PushSender = sendWebPush): Promise<DeliverResult> {
  const out: DeliverResult = { sent: 0, failed: 0, removed: 0 };
  const keys = await vapidKeys();
  const subject = vapidSubject();
  await Promise.all(targets.map(async (s) => {
    let r;
    try { r = await send(s, payload(s), keys, subject, opts); } catch (e) { console.error('push', (e as Error).message); r = { ok: false, status: 0, gone: false }; }
    if (r.ok) {
      out.sent++;
      await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq('id', s.id);
    } else if (r.gone || s.failures + 1 >= 5) {
      out.removed++;
      await db.from('push_subscriptions').delete().eq('id', s.id);
    } else {
      out.failed++;
      if (r.status) console.error('push recusado', r.status, new URL(s.endpoint).host);
      await db.from('push_subscriptions').update({ failures: s.failures + 1 }).eq('id', s.id);
    }
  }));
  return out;
}
