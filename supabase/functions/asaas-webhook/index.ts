// Recebe os avisos do Asaas (checkout, assinaturas e cobranças) e mantém o plano da empresa em dia.
import { admin } from '../_shared/common.ts';
import { asaas, revokeCompany, syncCompany } from '../_shared/asaas.ts';

type Ev = { id: string; event: string; checkout?: { id: string; customer?: string }; subscription?: { id: string; customer: string; status: string }; payment?: { id: string; subscription?: string; customer: string; status: string } };

async function companyBy(field: string, value: string | null | undefined) {
  if (!value) return null;
  const { data } = await admin.from('companies').select('id,asaas_subscription_id,asaas_customer_id,complimentary').eq(field, value).maybeSingle();
  return data;
}

/** Depois do Checkout de cartão: acha a assinatura criada para o cliente e adota na empresa. */
async function adoptFromCustomer(companyId: string, customer: string) {
  const { data: company } = await admin.from('companies').select('asaas_subscription_id').eq('id', companyId).single();
  const subs = await asaas<{ data: { id: string; status: string; dateCreated: string }[] }>(`/subscriptions?customer=${customer}&status=ACTIVE&limit=10`);
  const newest = (subs.data ?? []).sort((a, b) => (a.dateCreated < b.dateCreated ? 1 : -1))[0];
  if (!newest) return;
  const old = company?.asaas_subscription_id;
  await admin.from('companies').update({ asaas_customer_id: customer, asaas_subscription_id: newest.id, billing_provider: 'asaas', billing_method: 'cartao' }).eq('id', companyId);
  // troca de plano ou de forma de pagamento: a assinatura anterior é encerrada (o novo plano começa no fim do período pago)
  if (old && old !== newest.id) {
    try { await asaas(`/subscriptions/${old}`, { method: 'DELETE' }); } catch (e) { console.error('remover assinatura anterior', e); }
  }
}

Deno.serve(async (req) => {
  const token = (Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '').trim();
  if (!token || (req.headers.get('asaas-access-token') ?? '').trim() !== token) return new Response('unauthorized', { status: 401 });
  let ev: Ev;
  try { ev = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  // entrega "pelo menos uma vez": cada aviso é processado uma vez só
  const { error: dup } = await admin.from('asaas_events').insert({ id: ev.id, event: ev.event });
  if (dup) return new Response(JSON.stringify({ received: true, duplicate: true }), { headers: { 'Content-Type': 'application/json' } });

  try {
    if (ev.event === 'CHECKOUT_PAID' && ev.checkout) {
      const c = await companyBy('asaas_checkout_id', ev.checkout.id);
      if (c && !c.complimentary && ev.checkout.customer) {
        await adoptFromCustomer(c.id, ev.checkout.customer);
        await syncCompany(c.id);
      }
    } else if (ev.subscription) {
      const c = (await companyBy('asaas_subscription_id', ev.subscription.id)) ?? null;
      if (c) await syncCompany(c.id);
    } else if (ev.payment) {
      const p = ev.payment;
      const c = (await companyBy('asaas_subscription_id', p.subscription)) ?? null;
      if (c) {
        if (ev.event === 'PAYMENT_REFUNDED' || ev.event === 'PAYMENT_CHARGEBACK_REQUESTED') {
          await revokeCompany(c.id, ev.event === 'PAYMENT_REFUNDED' ? 'reembolsada' : 'contestada', p.id);
        } else {
          await syncCompany(c.id);
        }
      }
    }
  } catch (e) {
    console.error(ev.event, e);
    // libera para o Asaas tentar de novo
    await admin.from('asaas_events').delete().eq('id', ev.id);
    return new Response('error', { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
