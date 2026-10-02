// Aviso de pagamento do Asaas DA EMPRESA (cobranças dos clientes dela). Cada empresa tem o próprio endereço
// (?empresa=<id>) e o próprio token, cadastrados no Asaas dela quando conecta. Pago → vira venda e baixa a conta.
import { db } from '../_shared/db.ts';
import { markChargePaid } from '../_shared/payments.ts';

type Ev = { id?: string; event?: string; payment?: { id: string; status?: string; billingType?: string; externalReference?: string; paymentDate?: string; clientPaymentDate?: string } };

export async function handleChargeWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const company = new URL(req.url).searchParams.get('empresa') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(company)) return new Response('bad request', { status: 400 });
  const { data: cred } = await db.from('integration_credentials').select('webhook_token').eq('company_id', company).eq('provider', 'asaas').maybeSingle();
  const token = (req.headers.get('asaas-access-token') ?? '').trim();
  if (!cred || !token || token !== cred.webhook_token) return new Response('unauthorized', { status: 401 });
  let ev: Ev;
  try { ev = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const p = ev.payment;
  if (!ev.event || !p?.id) return Response.json({ ignored: true });

  const key = `cobranca:${company}:${ev.id ?? `${p.id}:${ev.event}`}`;
  const { error: dup } = await db.from('webhook_events').insert({ id: key, provider: 'asaas-empresa' });
  if (dup) return Response.json({ received: true, duplicate: true });
  try {
    let q = db.from('charges').select('id, status').eq('company_id', company);
    q = p.externalReference && /^[0-9a-f-]{36}$/.test(p.externalReference) ? q.eq('id', p.externalReference) : q.eq('provider_id', p.id);
    const { data: ch } = await q.maybeSingle();
    if (!ch) return Response.json({ ignored: true }); // cobrança feita fora da ORBYTA
    if (ev.event === 'PAYMENT_RECEIVED' || ev.event === 'PAYMENT_CONFIRMED') await markChargePaid(ch.id, p.billingType, p.clientPaymentDate ?? p.paymentDate);
    else if (ev.event === 'PAYMENT_OVERDUE' && ch.status === 'pendente') await db.from('charges').update({ status: 'vencida' }).eq('id', ch.id);
    else if (ev.event === 'PAYMENT_DELETED' && ch.status !== 'paga') await db.from('charges').update({ status: 'cancelada' }).eq('id', ch.id);
    else if (ev.event === 'PAYMENT_REFUNDED') await db.from('charges').update({ status: 'estornada' }).eq('id', ch.id);
  } catch (e) {
    console.error('cobranca-webhook', e);
    await db.from('webhook_events').delete().eq('id', key); // o Asaas tenta de novo
    return new Response('error', { status: 500 });
  }
  return Response.json({ received: true });
}

if (import.meta.main) Deno.serve(handleChargeWebhook);
