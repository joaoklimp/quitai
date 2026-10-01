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

/** Lê a assinatura e as cobranças no Asaas e atualiza plano, situação e faturas da empresa. */
export async function syncCompany(companyId: string): Promise<void> {
  const { data: company } = await admin.from('companies').select('*').eq('id', companyId).maybeSingle();
  if (!company || company.complimentary || !company.asaas_subscription_id) return;
  const sub = await asaas<Subscription>(`/subscriptions/${company.asaas_subscription_id}`);
  const list = await asaas<{ data: Payment[] }>(`/subscriptions/${sub.id}/payments?limit=50`);
  const payments = (list.data ?? []).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  const today = todaySP();
  const mapped = planFromValue(sub.value, sub.cycle);
  const paid = payments.filter((p) => PAID.includes(p.status));
  const lastPaid = paid[0];
  const coverEnd = lastPaid ? addPeriod(lastPaid.dueDate, sub.cycle) : null;
  const overdue = payments.filter((p) => p.status === 'OVERDUE').sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];

  const patch: Record<string, unknown> = {
    billing_provider: 'asaas',
    updated_at: new Date().toISOString(),
    invoices: payments.slice(0, 36).map((p) => ({
      id: p.id,
      date: p.paymentDate ?? p.confirmedDate ?? p.dueDate,
      desc: `Plano ${mapped ? PRICES[mapped.plan].name : ''} · ${mapped?.cycle ?? ''}`.replace(/\s+·\s*$/, ''),
      amount: Math.round(Number(p.value) * 100),
      status: invoiceStatus(p.status),
      method: method(p.billingType),
      url: p.invoiceUrl ?? null,
    })),
  };
  if (mapped) { patch.plan = mapped.plan; patch.billing_cycle = mapped.cycle; }
  if (lastPaid) patch.billing_method = method(lastPaid.billingType);

  const ended = sub.deleted || sub.status === 'INACTIVE' || sub.status === 'EXPIRED';
  if (ended) {
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

/** Reembolso ou contestação: encerra a assinatura e bloqueia o painel na hora. */
export async function revokeCompany(companyId: string, reason: 'reembolsada' | 'contestada', paymentId?: string) {
  const { data: company } = await admin.from('companies').select('*').eq('id', companyId).maybeSingle();
  if (!company || company.complimentary) return;
  if (company.asaas_subscription_id) {
    try { await asaas(`/subscriptions/${company.asaas_subscription_id}`, { method: 'DELETE' }); } catch (e) { console.error('remover assinatura', e); }
  }
  const invoices = (Array.isArray(company.invoices) ? company.invoices : []).map((i: { id: string; status: string }) => (i.id === paymentId ? { ...i, status: reason } : i));
  await admin.from('companies').update({
    billing_status: 'canceled', current_period_end: todaySP(), canceled_at: new Date().toISOString(), invoices, updated_at: new Date().toISOString(),
  }).eq('id', company.id);
}

export function isReversal(status: string) { return REVERSED.includes(status); }
