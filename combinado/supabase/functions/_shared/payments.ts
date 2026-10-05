// Cobrança dos clientes da empresa pelo Asaas DA PRÓPRIA EMPRESA (a chave de cada empresa fica em integration_credentials).
// Diferente de asaas.ts, que cobra a assinatura da ORBYTA com a chave da plataforma.
// Fluxo: cria (ou acha) o cliente no Asaas, gera a cobrança (Pix, boleto ou os dois), guarda o link e o Pix copia e cola,
// lança o valor a receber no financeiro e, se pedido, manda o link no WhatsApp. O webhook avisa o pagamento.
import { db, audit, notify } from './db.ts';
import { open } from './crypto.ts';
import { brl, fmtDate, firstName, normalizePhone } from './format.ts';
import type { Base } from './context.ts';
import { deliverToContact } from './conversation.ts';
import { TEMPLATES } from './templates.ts';
import type { Charge, ChargeMethod, Contact } from './types.ts';

export class ProviderError extends Error {
  constructor(public status: number, public body: string, public friendly: string) { super(`${status}: ${body.slice(0, 300)}`); }
}

/** Mensagem do Asaas para a pessoa (vem em errors[].description). */
function asaasMessage(body: string): string {
  try { const j = JSON.parse(body); const d = j?.errors?.map((e: { description?: string }) => e.description).filter(Boolean).join(' '); if (d) return d; } catch { /* texto */ }
  return 'O Asaas recusou o pedido.';
}

export interface Creds { api_key: string; webhook_token: string; environment: 'producao' | 'testes' }

export async function credsFor(companyId: string, provider: 'asaas' | 'focusnfe'): Promise<Creds | null> {
  const [{ data: c }, { data: i }] = await Promise.all([
    db.from('integration_credentials').select('api_key, webhook_token').eq('company_id', companyId).eq('provider', provider).maybeSingle(),
    db.from('company_integrations').select('environment, status, config').eq('company_id', companyId).eq('provider', provider).maybeSingle(),
  ]);
  if (!c || !i || i.status === 'desconectado') return null;
  return { api_key: await open(c.api_key), webhook_token: c.webhook_token, environment: i.environment };
}

export async function asaasCall<T = Record<string, unknown>>(cr: Pick<Creds, 'api_key' | 'environment'>, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const base = cr.environment === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { access_token: cr.api_key, 'Content-Type': 'application/json', 'User-Agent': 'ORBYTA/1.0' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(res.status, text, res.status === 401 ? 'A chave do Asaas é inválida ou foi revogada.' : asaasMessage(text));
  return (text ? JSON.parse(text) : {}) as T;
}

export const WEBHOOK_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED'];

/** Endereço do aviso de pagamento desta empresa (o token confere que veio do Asaas dela). */
export const webhookUrl = (companyId: string) => `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1/cobranca-webhook?empresa=${companyId}`;

const BILLING: Record<ChargeMethod, string> = { pix: 'PIX', boleto: 'BOLETO', pix_boleto: 'UNDEFINED' };

async function asaasCustomer(cr: Creds, contact: Contact): Promise<string> {
  const doc = contact.document!;
  const found = await asaasCall<{ data: { id: string }[] }>(cr, `/customers?cpfCnpj=${doc}&limit=1`);
  if (found.data?.[0]) return found.data[0].id;
  const phone = contact.phone ? normalizePhone(contact.phone).replace(/^55/, '') : undefined;
  const c = await asaasCall<{ id: string }>(cr, '/customers', { method: 'POST', body: { name: contact.name, cpfCnpj: doc, email: contact.email ?? undefined, mobilePhone: phone, externalReference: contact.id, notificationDisabled: true } });
  return c.id;
}

export interface NewCharge { contactId: string; amount: number; description: string; dueDate: string; method: ChargeMethod; document?: string | null; quoteId?: string | null; send: boolean }
export type Actor = { type: 'usuario' | 'ia'; name: string; userId?: string | null; channel: string; via: 'painel' | 'ia_dono' | 'ia_cliente' };

/** Cria a cobrança. Devolve a linha salva e, se pedido, o resultado do envio pelo WhatsApp. */
export async function createCharge(b: Base, n: NewCharge, actor: Actor): Promise<{ charge: Charge; sent: boolean; reason?: string }> {
  const cr = await credsFor(b.company.id, 'asaas');
  if (!cr) throw new ProviderError(400, 'sem integração', 'Conecte o Asaas da empresa em Integrações para cobrar clientes.');
  const { data: contact } = await db.from('contacts').select('*').eq('company_id', b.company.id).eq('id', n.contactId).maybeSingle();
  if (!contact) throw new ProviderError(404, 'cliente', 'Cliente não encontrado.');
  const doc = (n.document ?? contact.document ?? '').replace(/\D/g, '');
  if (!/^(\d{11}|\d{14})$/.test(doc)) throw new ProviderError(400, 'documento', `Para cobrar, preciso do CPF ou CNPJ de ${contact.name}.`);
  if (doc !== contact.document) { await db.from('contacts').update({ document: doc }).eq('id', contact.id); contact.document = doc; }
  const amount = Math.round(n.amount * 100) / 100;
  if (!(amount >= 5)) throw new ProviderError(400, 'valor', 'O valor mínimo de uma cobrança é R$ 5,00.');

  const { data: row, error } = await db.from('charges').insert({
    company_id: b.company.id, contact_id: contact.id, quote_id: n.quoteId ?? null, description: n.description.slice(0, 300), amount, due_date: n.dueDate, method: n.method, created_via: actor.via,
  }).select('*').single();
  if (error) throw new Error(error.message);
  try {
    const customer = await asaasCustomer(cr, contact as Contact);
    const pay = await asaasCall<{ id: string; invoiceUrl?: string }>(cr, '/payments', { method: 'POST', body: { customer, billingType: BILLING[n.method], value: amount, dueDate: n.dueDate, description: n.description.slice(0, 500), externalReference: row.id } });
    let pix: string | null = null;
    if (n.method !== 'boleto') { try { pix = (await asaasCall<{ payload?: string }>(cr, `/payments/${pay.id}/pixQrCode`)).payload ?? null; } catch (e) { console.error('pix', (e as Error).message); } }
    const { data: entry } = await db.from('finance_entries').insert({ company_id: b.company.id, kind: 'receber', description: `Cobrança: ${n.description}`.slice(0, 200), category: 'Cobranças', amount, due_date: n.dueDate, contact_id: contact.id, counterpart: contact.name, created_via: actor.via === 'painel' ? 'painel' : 'ia_dono' }).select('id').single();
    const { data: saved } = await db.from('charges').update({ provider_id: pay.id, invoice_url: pay.invoiceUrl ?? null, pix_code: pix, finance_entry_id: entry?.id ?? null }).eq('id', row.id).select('*').single();
    await audit({ company_id: b.company.id, actor_type: actor.type, actor_name: actor.name, actor_user_id: actor.userId ?? null, channel: actor.channel, action: 'criar_cobranca', summary: `Gerou cobrança de ${brl(amount)} para ${contact.name} (${n.description}), vence ${fmtDate(n.dueDate + 'T12:00:00Z', b.tz)}`, target_type: 'charge', target_id: row.id });
    let sent = false, reason: string | undefined;
    if (n.send) ({ sent, reason } = await sendCharge(b, saved as Charge, actor));
    return { charge: (sent ? { ...saved, sent_at: new Date().toISOString() } : saved) as Charge, sent, reason };
  } catch (e) {
    await db.from('charges').delete().eq('id', row.id); // não deixa cobrança pela metade
    throw e;
  }
}

/** Manda o link de pagamento ao cliente (texto na janela de 24h; fora dela, o modelo "cobranca_cliente"). */
export async function sendCharge(b: Base, ch: Charge, actor: Actor): Promise<{ sent: boolean; reason?: string }> {
  if (!ch.invoice_url || !ch.contact_id) return { sent: false, reason: 'Cobrança sem link.' };
  const { data: contact } = await db.from('contacts').select('*').eq('id', ch.contact_id).single();
  const first = firstName(contact?.name) || 'tudo bem';
  const due = fmtDate(ch.due_date + 'T12:00:00Z', b.tz);
  const text = `Olá, ${first}! Segue a cobrança de ${brl(ch.amount)} referente a ${ch.description}, com vencimento em ${due}. Para pagar com Pix ou boleto, é só abrir o link: ${ch.invoice_url}${ch.pix_code ? `\n\nSe preferir, Pix copia e cola:\n${ch.pix_code}` : ''}`;
  const r = await deliverToContact(b, contact as Contact, text, { sender: actor.type === 'ia' ? 'ia' : 'equipe', senderName: actor.name, template: { name: TEMPLATES.cobranca.name, params: [first, brl(ch.amount), ch.description, due, ch.invoice_url] } });
  if (r.sent) await db.from('charges').update({ sent_at: new Date().toISOString() }).eq('id', ch.id);
  return { sent: r.sent, reason: r.reason };
}

export async function cancelCharge(b: Base, ch: Charge, actor: Actor): Promise<void> {
  if (ch.status === 'paga') throw new ProviderError(400, 'paga', 'Essa cobrança já foi paga: para devolver o dinheiro, faça o estorno no Asaas.');
  const cr = await credsFor(b.company.id, 'asaas');
  if (cr && ch.provider_id) await asaasCall(cr, `/payments/${ch.provider_id}`, { method: 'DELETE' });
  await db.from('charges').update({ status: 'cancelada' }).eq('id', ch.id);
  if (ch.finance_entry_id) await db.from('finance_entries').delete().eq('id', ch.finance_entry_id).is('paid_at', null);
  await audit({ company_id: b.company.id, actor_type: actor.type, actor_name: actor.name, actor_user_id: actor.userId ?? null, channel: actor.channel, action: 'cancelar_cobranca', summary: `Cancelou a cobrança de ${brl(ch.amount)} (${ch.description})`, target_type: 'charge', target_id: ch.id });
}

const PAID_BY: Record<string, 'pix' | 'boleto' | 'cartao_credito'> = { PIX: 'pix', BOLETO: 'boleto', CREDIT_CARD: 'cartao_credito' };

/** Pagamento confirmado: vira venda, a conta a receber é baixada e a equipe é avisada. Idempotente. */
export async function markChargePaid(chargeId: string, billingType?: string, paidAt?: string): Promise<void> {
  const { data: ch } = await db.from('charges').select('*').eq('id', chargeId).maybeSingle();
  if (!ch || ch.status === 'paga') return;
  const when = paidAt ? new Date(paidAt + (paidAt.length === 10 ? 'T12:00:00Z' : '')).toISOString() : new Date().toISOString();
  const method = PAID_BY[billingType ?? ''] ?? 'pix';
  const { data: sale } = await db.from('sales').insert({ company_id: ch.company_id, contact_id: ch.contact_id, quote_id: ch.quote_id, description: ch.description, amount: ch.amount, method, origin: ch.created_via === 'ia_cliente' ? 'ia' : 'equipe', paid_at: when, created_via: 'automacao' }).select('id').single();
  await db.from('charges').update({ status: 'paga', paid_at: when, sale_id: sale?.id ?? null }).eq('id', ch.id);
  if (ch.finance_entry_id) await db.from('finance_entries').update({ paid_at: when, method, sale_id: sale?.id ?? null }).eq('id', ch.finance_entry_id);
  const { data: c } = ch.contact_id ? await db.from('contacts').select('name').eq('id', ch.contact_id).single() : { data: null };
  await audit({ company_id: ch.company_id, actor_type: 'sistema', actor_name: 'Asaas', actor_user_id: null, channel: 'automacao', action: 'cobranca_paga', summary: `${c?.name ?? 'Cliente'} pagou a cobrança de ${brl(Number(ch.amount))} (${ch.description})`, target_type: 'charge', target_id: ch.id });
  await notify(ch.company_id, 'venda', `Pagamento recebido: ${brl(Number(ch.amount))}`, `${c?.name ?? 'Cliente'} · ${ch.description}`, '#/cobrancas');
}
