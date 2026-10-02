// Assinatura pelo Asaas: chamadas da API e sincronização da assinatura com a empresa no banco.
// Cartão: Checkout do Asaas com cobrança recorrente. Pix/boleto: cliente + assinatura (cada cobrança tem Pix e boleto).
import { db, notify } from './db.ts';

const PROD = Deno.env.get('ASAAS_ENV') === 'production';
const BASE = PROD ? 'https://api.asaas.com' : 'https://api-sandbox.asaas.com';
export const CHECKOUT_BASE = PROD ? 'https://asaas.com' : 'https://sandbox.asaas.com';

/** Dias de tolerância depois do vencimento antes de o painel ficar só para consulta. */
export const GRACE_DAYS = 5;

export class AsaasError extends Error {
  constructor(public status: number, public body: string) { super(`Asaas ${status}: ${body.slice(0, 300)}`); }
}

export async function asaas<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}/v3${path}`, {
    method: init.method ?? 'GET',
    headers: { access_token: Deno.env.get('ASAAS_API_KEY') ?? '', 'Content-Type': 'application/json', 'User-Agent': 'ORBYTA/1.0' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new AsaasError(res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface PlanRow { id: string; name: string; monthly: number; yearly: number }
export async function plans(): Promise<PlanRow[]> {
  const { data } = await db.from('plans').select('id, name, monthly, yearly').neq('id', 'teste');
  return (data ?? []).map((p) => ({ ...p, monthly: Number(p.monthly), yearly: Number(p.yearly) }));
}
/** O valor da assinatura identifica o plano (o Checkout não guarda referência própria). */
export function planFromValue(list: PlanRow[], value: number, cycle: string): { plan: string; cycle: 'mensal' | 'anual' } | null {
  const cy = cycle === 'YEARLY' ? 'anual' : 'mensal';
  for (const p of list) if (Math.abs((cy === 'anual' ? p.yearly : p.monthly) - Number(value)) < 0.01) return { plan: p.id, cycle: cy };
  return null;
}

export function todaySP(): string { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function addPeriod(iso: string, cycle: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (cycle === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function plusDays(iso: string, n: number): string { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

type Payment = { id: string; status: string; dueDate: string; paymentDate?: string | null; confirmedDate?: string | null; value: number; billingType: string; invoiceUrl?: string; description?: string };
type Subscription = { id: string; status: string; deleted?: boolean; cycle: string; value: number; nextDueDate: string; billingType: string; customer: string; checkoutSession?: string | null };

const PAID = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const REVERSED = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];
export const isReversal = (status: string) => REVERSED.includes(status);

function invoiceStatus(s: string): string {
  if (PAID.includes(s)) return 'paga';
  if (s === 'OVERDUE') return 'vencida';
  if (s.startsWith('REFUND')) return 'reembolsada';
  if (s.includes('CHARGEBACK')) return 'contestada';
  if (s === 'DELETED' || s === 'CANCELED') return 'cancelada';
  return 'pendente';
}
const method = (billingType: string) => (billingType === 'CREDIT_CARD' ? 'cartao' : billingType === 'BOLETO' ? 'boleto' : 'pix');

export async function billingAccount(companyId: string) {
  const { data } = await db.from('billing_accounts').select('*').eq('company_id', companyId).maybeSingle();
  return data as { company_id: string; asaas_customer_id: string | null; asaas_subscription_id: string | null; asaas_checkout_id: string | null; access_revoked: boolean } | null;
}
export async function saveBilling(companyId: string, patch: Record<string, unknown>) {
  const { error } = await db.from('billing_accounts').upsert({ company_id: companyId, ...patch });
  if (error) throw new Error(`cobrança: ${error.message}`);
}

/** Lê a assinatura e as cobranças no Asaas e atualiza plano, situação e faturas da empresa. */
export async function syncCompany(companyId: string): Promise<void> {
  const { data: company } = await db.from('companies').select('*').eq('id', companyId).maybeSingle();
  const acct = await billingAccount(companyId);
  if (!company || company.complimentary || !acct?.asaas_subscription_id) return;
  const list = await plans();
  const sub = await asaas<Subscription>(`/subscriptions/${acct.asaas_subscription_id}`);
  const pays = await asaas<{ data: Payment[] }>(`/subscriptions/${sub.id}/payments?limit=50`);
  const payments = (pays.data ?? []).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  const today = todaySP();
  const mapped = planFromValue(list, sub.value, sub.cycle);
  const planName = list.find((p) => p.id === mapped?.plan)?.name ?? '';

  // faturas (mantém as de assinaturas anteriores)
  if (payments.length) {
    const { error } = await db.from('invoices').upsert(payments.slice(0, 36).map((p) => ({
      company_id: companyId, asaas_payment_id: p.id, amount: Number(p.value), status: invoiceStatus(p.status), due_date: p.dueDate,
      paid_at: PAID.includes(p.status) ? new Date((p.paymentDate ?? p.confirmedDate ?? p.dueDate) + 'T12:00:00Z').toISOString() : null,
      method: method(p.billingType), url: p.invoiceUrl ?? null, description: `ORBYTA ${planName}${mapped ? ` · ${mapped.cycle}` : ''}`.trim(),
    })), { onConflict: 'asaas_payment_id' });
    if (error) console.error('faturas', error.message);
  }

  const paid = payments.filter((p) => PAID.includes(p.status));
  const lastPaid = paid[0];
  const coverEnd = lastPaid ? addPeriod(lastPaid.dueDate, sub.cycle) : null;
  const overdue = payments.filter((p) => p.status === 'OVERDUE').sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const patch: Record<string, unknown> = {};
  // o plano novo só vale quando a assinatura nova tem pagamento; até lá continua o plano já pago
  if (mapped && (lastPaid || !['active', 'past_due'].includes(company.billing_status))) { patch.plan = mapped.plan; patch.billing_cycle = mapped.cycle; }
  if (lastPaid) patch.billing_method = lastPaid.billingType === 'CREDIT_CARD' ? 'cartao' : 'pix_boleto';
  const ended = sub.deleted || sub.status === 'INACTIVE' || sub.status === 'EXPIRED';

  if (acct.access_revoked) {
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
  const before = company.billing_status;
  const { error } = await db.from('companies').update(patch).eq('id', companyId);
  if (error) throw new Error(`não consegui salvar a assinatura: ${error.message}`);
  if (patch.billing_status && patch.billing_status !== before) {
    const msg: Record<string, [string, string]> = {
      active: ['Assinatura ativa', `Plano ${planName} liberado. Obrigado!`],
      past_due: ['Pagamento em atraso', 'Regularize para a IA continuar atendendo seus clientes.'],
      canceled: ['Assinatura encerrada', 'O painel fica disponível para consulta. Reative quando quiser.'],
    };
    const m = msg[String(patch.billing_status)];
    if (m) await notify(companyId, 'assinatura', m[0], m[1], '#/configuracoes/assinatura');
  }
}

/** Liga à empresa uma assinatura nova (vinda do Checkout de cartão) e encerra a anterior, se houver. */
export async function adoptSubscription(companyId: string, sub: { id: string; customer: string }) {
  const acct = await billingAccount(companyId);
  const old = acct?.asaas_subscription_id;
  await saveBilling(companyId, { asaas_customer_id: sub.customer, asaas_subscription_id: sub.id, access_revoked: false });
  if (old && old !== sub.id) {
    try { await asaas(`/subscriptions/${old}`, { method: 'DELETE' }); } catch (e) { console.error('remover assinatura anterior', e); }
  }
}

/** Procura a assinatura criada pelo último Checkout da empresa (campo checkoutSession) e liga à empresa. */
export async function adoptFromCheckout(companyId: string): Promise<boolean> {
  const acct = await billingAccount(companyId);
  if (!acct?.asaas_checkout_id) return false;
  const list = await asaas<{ data: Subscription[] }>('/subscriptions?limit=50');
  const sub = (list.data ?? []).find((s) => s.checkoutSession === acct.asaas_checkout_id && s.status === 'ACTIVE');
  if (!sub || sub.id === acct.asaas_subscription_id) return false;
  await adoptSubscription(companyId, sub);
  return true;
}

/** Reembolso ou contestação: encerra a assinatura e deixa o painel só para consulta na hora. */
export async function revokeCompany(companyId: string, reason: 'reembolsada' | 'contestada', paymentId?: string) {
  const { data: company } = await db.from('companies').select('complimentary').eq('id', companyId).maybeSingle();
  if (!company || company.complimentary) return;
  const acct = await billingAccount(companyId);
  if (acct?.asaas_subscription_id) {
    try { await asaas(`/subscriptions/${acct.asaas_subscription_id}`, { method: 'DELETE' }); } catch (e) { console.error('remover assinatura', e); }
  }
  await saveBilling(companyId, { access_revoked: true });
  if (paymentId) await db.from('invoices').update({ status: reason }).eq('asaas_payment_id', paymentId);
  await db.from('companies').update({ billing_status: 'canceled', current_period_end: todaySP(), canceled_at: new Date().toISOString() }).eq('id', companyId);
  await notify(companyId, 'assinatura', 'Assinatura encerrada', reason === 'reembolsada' ? 'O pagamento foi reembolsado.' : 'O pagamento foi contestado no cartão.', '#/configuracoes/assinatura');
}

export function validCpfCnpj(d: string): boolean {
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return calc(9) === +d[9] && calc(10) === +d[10];
  }
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (n: number) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += +d[i] * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === +d[12] && calc(13) === +d[13];
  }
  return false;
}
