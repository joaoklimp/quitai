// Integração com o Asaas: chamadas da API e sincronização da assinatura com a empresa no banco.
import { admin } from './common.ts';

const PROD = Deno.env.get('ASAAS_ENV') === 'production';
const BASE = PROD ? 'https://api.asaas.com' : 'https://api-sandbox.asaas.com';
export const CHECKOUT_BASE = PROD ? 'https://asaas.com' : 'https://sandbox.asaas.com';

export class AsaasError extends Error {
  constructor(public status: number, public body: string) { super(`Asaas ${status}: ${body.slice(0, 300)}`); }
}

export async function asaas<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}/v3${path}`, {
    method: init.method ?? 'GET',
    headers: {
      access_token: Deno.env.get('ASAAS_API_KEY') ?? '',
      'Content-Type': 'application/json',
      'User-Agent': 'Quitai/1.0',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new AsaasError(res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Preços (em reais) por plano e ciclo: o mesmo valor identifica o plano nas assinaturas criadas pelo Checkout. */
export const PRICES: Record<string, { mensal: number; anual: number; name: string }> = {
  basico: { mensal: 59, anual: 588, name: 'Básico' },
  pro: { mensal: 129, anual: 1308, name: 'Pro' },
  empresa: { mensal: 249, anual: 2508, name: 'Empresa' },
};
export function planFromValue(value: number, cycle: string): { plan: string; cycle: 'mensal' | 'anual' } | null {
  const cy = cycle === 'YEARLY' ? 'anual' : 'mensal';
  for (const [plan, p] of Object.entries(PRICES)) if (Math.abs(p[cy] - Number(value)) < 0.01) return { plan, cycle: cy };
  return null;
}

export function todaySP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function addPeriod(iso: string, cycle: string, extraDays = 0): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (cycle === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(d.getUTCDate() + extraDays);
  return d.toISOString().slice(0, 10);
}
function plusDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias de tolerância depois do vencimento antes de bloquear o painel. */
export const GRACE_DAYS = 5;

type Payment = { id: string; status: string; dueDate: string; paymentDate?: string | null; confirmedDate?: string | null; value: number; billingType: string; invoiceUrl?: string };
type Subscription = { id: string; status: string; deleted?: boolean; cycle: string; value: number; nextDueDate: string; billingType: string; customer: string };

const PAID = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const REVERSED = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];

function invoiceStatus(s: string): string {
  if (PAID.includes(s)) return 'paga';
  if (s === 'OVERDUE') return 'vencida';
  if (s.startsWith('REFUND')) return 'reembolsada';
  if (s.includes('CHARGEBACK')) return 'contestada';
  return 'pendente';
}
function method(billingType: string): string {
  return billingType === 'CREDIT_CARD' ? 'cartao' : billingType === 'BOLETO' ? 'boleto' : 'pix';
}

/** Cortesia valendo hoje (sem prazo, ou com prazo ainda não vencido). */
export function courtesyActive(c: { complimentary?: boolean | null; comp_until?: string | null } | null | undefined): boolean {
  return !!c?.complimentary && (!c.comp_until || c.comp_until >= todaySP());
}
/** Cortesia sem prazo (conta da casa, parceiros permanentes): nunca passa pela cobrança. */
export function courtesyForever(c: { complimentary?: boolean | null; comp_until?: string | null } | null | undefined): boolean {
  return !!c?.complimentary && !c.comp_until;
}

/** Dá cortesia: plano liberado sem cobrança até a data (ou sem prazo). Encerra a assinatura paga, se houver. */
export async function grantCourtesy(companyId: string, opts: { plan: string; until: string | null; note: string | null }) {
  const { data: company } = await admin.from('companies').select('*').eq('id', companyId).maybeSingle();
  if (!company) throw new Error('empresa não encontrada');
  let hadSubscription = false;
  if (company.asaas_subscription_id) {
    try {
      const s = await asaas<{ deleted?: boolean; status: string }>(`/subscriptions/${company.asaas_subscription_id}`);
      hadSubscription = !s.deleted && s.status === 'ACTIVE';
      if (hadSubscription) await asaas(`/subscriptions/${company.asaas_subscription_id}`, { method: 'DELETE' });
    } catch (e) {
      // assinatura que já não existe no Asaas não impede a cortesia; qualquer outro erro, sim (para não continuar cobrando)
      if (!(e instanceof AsaasError) || e.status !== 404) throw e;
    }
  }
  const today = todaySP();
  // se ainda havia período pago depois do fim da cortesia, ele continua valendo
  const paidEnd = !company.complimentary && ['active', 'past_due', 'canceled'].includes(company.billing_status) && company.current_period_end && company.current_period_end > today ? company.current_period_end : null;
  const after = opts.until ? (paidEnd && paidEnd > opts.until ? paidEnd : opts.until) : '2099-12-31';
  const { error } = await admin.from('companies').update({
    complimentary: true, comp_until: opts.until, comp_note: opts.note, plan: opts.plan,
    // sem prazo: fica "ativa" (como a conta da casa); com prazo: "cancelada até" a data, para bloquear quando vencer
    billing_status: opts.until ? 'canceled' : 'active', current_period_end: after, canceled_at: null, access_revoked: false,
    asaas_subscription_id: null, asaas_checkout_id: null, updated_at: new Date().toISOString(),
  }).eq('id', companyId);
  if (error) throw new Error(`não consegui salvar a cortesia: ${error.message}`);
  return { hadSubscription };
}

/** Tira a cortesia agora: o painel fica em modo leitura até a empresa assinar. */
export async function removeCourtesy(companyId: string) {
  const { error } = await admin.from('companies').update({
    complimentary: false, comp_until: null, comp_note: null,
    billing_status: 'canceled', current_period_end: todaySP(), canceled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', companyId);
  if (error) throw new Error(`não consegui remover a cortesia: ${error.message}`);
}

/** Quando a empresa assina, a cortesia sai; se ela ainda valia, a assinatura começa no fim dela. */
export function courtesyHandoff(company: { complimentary?: boolean | null; comp_until?: string | null }): Record<string, unknown> {
  if (!company.complimentary) return {};
  const patch: Record<string, unknown> = { complimentary: false, comp_until: null, comp_note: null };
  if (company.comp_until && company.comp_until > todaySP()) { patch.billing_status = 'active'; patch.current_period_end = company.comp_until; patch.canceled_at = null; }
  return patch;
}

/** Lê a assinatura e as cobranças no Asaas e atualiza plano, situação e faturas da empresa. */
export async function syncCompany(companyId: string): Promise<void> {
  const { data: company } = await admin.from('companies').select('*').eq('id', companyId).maybeSingle();
  if (!company || courtesyActive(company) || !company.asaas_subscription_id) return;
  const sub = await asaas<Subscription>(`/subscriptions/${company.asaas_subscription_id}`);
  const list = await asaas<{ data: Payment[] }>(`/subscriptions/${sub.id}/payments?limit=50`);
  const payments = (list.data ?? []).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  const today = todaySP();
  const mapped = planFromValue(sub.value, sub.cycle);
  const paid = payments.filter((p) => PAID.includes(p.status));
  const lastPaid = paid[0];
  const coverEnd = lastPaid ? addPeriod(lastPaid.dueDate, sub.cycle) : null;
  const overdue = payments.filter((p) => p.status === 'OVERDUE').sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];

  const current = payments.slice(0, 36).map((p) => ({
      id: p.id,
      date: p.paymentDate ?? p.confirmedDate ?? p.dueDate,
      desc: `Plano ${mapped ? PRICES[mapped.plan].name : ''} · ${mapped?.cycle ?? ''}`.replace(/\s+·\s*$/, ''),
      amount: Math.round(Number(p.value) * 100),
      status: invoiceStatus(p.status),
      method: method(p.billingType),
      url: p.invoiceUrl ?? null,
  }));
  // mantém no histórico as faturas de assinaturas anteriores (troca de plano ou de forma de pagamento)
  const ids = new Set(current.map((i) => i.id));
  const older = (Array.isArray(company.invoices) ? company.invoices : []).filter((i: { id: string }) => !ids.has(i.id));
  const invoices = [...current, ...older].sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1)).slice(0, 60);
  const patch: Record<string, unknown> = { billing_provider: 'asaas', updated_at: new Date().toISOString(), invoices };
  // o plano novo só vale quando a assinatura nova tem pagamento; até lá continua o plano já pago
  if (mapped && (lastPaid || !['active', 'past_due'].includes(company.billing_status))) { patch.plan = mapped.plan; patch.billing_cycle = mapped.cycle; }
  if (lastPaid) patch.billing_method = method(lastPaid.billingType);

  const ended = sub.deleted || sub.status === 'INACTIVE' || sub.status === 'EXPIRED';
  if (company.access_revoked) {
    // bloqueado por estorno, contestação ou pelo administrador: não devolve o acesso
    patch.billing_status = 'canceled';
    patch.current_period_end = company.current_period_end && company.current_period_end < today ? company.current_period_end : today;
  } else if (ended) {
    patch.billing_status = 'canceled';
    patch.current_period_end = coverEnd && coverEnd > today ? coverEnd : today;
    patch.canceled_at = company.canceled_at ?? new Date().toISOString();
  } else if (!lastPaid && !overdue) {
    // primeira cobrança ainda não paga: mantém a situação atual (teste grátis, por exemplo)
  } else if (overdue && (!coverEnd || coverEnd <= today)) {
    const limit = plusDays(overdue.dueDate, GRACE_DAYS);
    patch.billing_status = limit > today ? 'past_due' : 'canceled';
    patch.current_period_end = limit;
    patch.canceled_at = limit > today ? null : new Date().toISOString();
  } else {
    patch.billing_status = 'active';
    patch.current_period_end = coverEnd && coverEnd > (sub.nextDueDate ?? '') ? coverEnd : (sub.nextDueDate ?? coverEnd);
    patch.canceled_at = null;
  }
  const { error } = await admin.from('companies').update(patch).eq('id', company.id);
  if (error) throw new Error(`não consegui salvar a assinatura: ${error.message}`);
}

/** Liga à empresa uma assinatura nova (vinda do Checkout de cartão) e encerra a anterior, se houver. */
export async function adoptSubscription(companyId: string, sub: { id: string; customer: string; billingType?: string }) {
  const { data: company } = await admin.from('companies').select('asaas_subscription_id,complimentary,comp_until').eq('id', companyId).single();
  const old = company?.asaas_subscription_id;
  const { error } = await admin.from('companies').update({
    asaas_customer_id: sub.customer, asaas_subscription_id: sub.id, billing_provider: 'asaas', access_revoked: false,
    billing_method: sub.billingType === 'CREDIT_CARD' ? 'cartao' : 'pix',
    ...(company ? courtesyHandoff(company) : {}),
  }).eq('id', companyId);
  if (error) throw new Error(`não consegui ligar a assinatura: ${error.message}`);
  // os e-mails da cobrança saem pelo Quitaí: desliga as notificações pagas do Asaas para este cliente
  try { await asaas(`/customers/${sub.customer}`, { method: 'PUT', body: { notificationDisabled: true } }); } catch (e) { console.error('desligar notificações do cliente', e); }
  // troca de plano ou de forma de pagamento: a anterior é encerrada (o novo plano começa no fim do período pago)
  if (old && old !== sub.id) {
    try { await asaas(`/subscriptions/${old}`, { method: 'DELETE' }); } catch (e) { console.error('remover assinatura anterior', e); }
  }
}

/** Procura a assinatura criada pelo último Checkout da empresa (campo checkoutSession) e liga à empresa. */
export async function adoptFromCheckout(companyId: string): Promise<boolean> {
  const { data: company } = await admin.from('companies').select('asaas_checkout_id,asaas_subscription_id').eq('id', companyId).single();
  if (!company?.asaas_checkout_id) return false;
  const list = await asaas<{ data: { id: string; customer: string; billingType: string; status: string; checkoutSession?: string | null }[] }>('/subscriptions?limit=50');
  const sub = (list.data ?? []).find((s) => s.checkoutSession === company.asaas_checkout_id && s.status === 'ACTIVE');
  if (!sub || sub.id === company.asaas_subscription_id) return false;
  await adoptSubscription(companyId, sub);
  return true;
}

/** Reembolso ou contestação: encerra a assinatura e bloqueia o painel na hora. */
export async function revokeCompany(companyId: string, reason: 'reembolsada' | 'contestada', paymentId?: string) {
  const { data: company } = await admin.from('companies').select('*').eq('id', companyId).maybeSingle();
  if (!company || courtesyActive(company)) return;
  if (company.asaas_subscription_id) {
    try { await asaas(`/subscriptions/${company.asaas_subscription_id}`, { method: 'DELETE' }); } catch (e) { console.error('remover assinatura', e); }
  }
  const invoices = (Array.isArray(company.invoices) ? company.invoices : []).map((i: { id: string; status: string }) => (i.id === paymentId ? { ...i, status: reason } : i));
  await admin.from('companies').update({
    billing_status: 'canceled', current_period_end: todaySP(), canceled_at: new Date().toISOString(), invoices, access_revoked: true, updated_at: new Date().toISOString(),
  }).eq('id', company.id);
}

export function isReversal(status: string) { return REVERSED.includes(status); }
