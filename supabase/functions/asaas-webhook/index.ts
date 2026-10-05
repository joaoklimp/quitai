// Recebe os avisos do Asaas (checkout, assinaturas e cobranças) e mantém o plano da empresa em dia.
import { admin } from '../_shared/common.ts';
import { adoptFromCheckout, adoptSubscription, courtesyForever, revokeCompany, syncCompany } from '../_shared/asaas.ts';
import { billingMail } from '../_shared/billing-mail.ts';

type Sub = { id: string; customer: string; status: string; billingType?: string; checkoutSession?: string | null };
type Pay = { id: string; subscription?: string; customer: string; status: string; value: number; dueDate: string; billingType: string; invoiceUrl?: string; transactionReceiptUrl?: string | null };
type Ev = { id: string; event: string; checkout?: { id: string; customer?: string | null }; subscription?: Sub; payment?: Pay };

async function companyBy(field: string, value: string | null | undefined) {
  if (!value) return null;
  const { data } = await admin.from('companies').select('id,asaas_subscription_id,asaas_customer_id,complimentary,comp_until').eq(field, value).maybeSingle();
  return data;
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
      // a assinatura do Checkout traz o mesmo id em "checkoutSession"
      const c = await companyBy('asaas_checkout_id', ev.checkout.id);
      if (c && !courtesyForever(c)) {
        await adoptFromCheckout(c.id);
        await syncCompany(c.id);
      }
    } else if (ev.subscription) {
      const s = ev.subscription;
      let c = await companyBy('asaas_subscription_id', s.id);
      if (!c && s.checkoutSession) {
        // assinatura nova criada pelo Checkout de cartão
        c = await companyBy('asaas_checkout_id', s.checkoutSession);
        if (c && !courtesyForever(c) && s.status === 'ACTIVE') await adoptSubscription(c.id, s);
      }
      if (c && !courtesyForever(c)) await syncCompany(c.id);
    } else if (ev.payment) {
      const p = ev.payment;
      const c = await companyBy('asaas_subscription_id', p.subscription);
      if (c && !courtesyForever(c)) {
        if (ev.event === 'PAYMENT_REFUNDED' || ev.event === 'PAYMENT_CHARGEBACK_REQUESTED') {
          await revokeCompany(c.id, ev.event === 'PAYMENT_REFUNDED' ? 'reembolsada' : 'contestada', p.id);
        } else {
          await syncCompany(c.id);
        }
        // e-mail da cobrança enviado pelo Quitaí (no lugar das notificações pagas do Asaas)
        try { await billingMail(ev.event, p, c); } catch (e) { console.error('e-mail da cobrança', e); }
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
