// Webhook do Asaas (checkout, assinaturas e cobranças): mantém plano, situação e faturas em dia.
// Configure no Asaas: URL https://SEU-PROJETO.supabase.co/functions/v1/asaas-webhook e o token ASAAS_WEBHOOK_TOKEN.
import { db } from '../_shared/db.ts';
import { adoptFromCheckout, adoptSubscription, revokeCompany, syncCompany } from '../_shared/asaas.ts';

type Sub = { id: string; customer: string; status: string; checkoutSession?: string | null };
type Pay = { id: string; subscription?: string; customer: string; status: string };
type Ev = { id: string; event: string; checkout?: { id: string }; subscription?: Sub; payment?: Pay };

async function companyBy(field: 'asaas_subscription_id' | 'asaas_checkout_id', value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const { data } = await db.from('billing_accounts').select('company_id').eq(field, value).maybeSingle();
  if (!data) return null;
  const { data: c } = await db.from('companies').select('complimentary').eq('id', data.company_id).maybeSingle();
  return c && !c.complimentary ? data.company_id : null;
}

Deno.serve(async (req) => {
  const token = (Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '').trim();
  if (!token || (req.headers.get('asaas-access-token') ?? '').trim() !== token) return new Response('unauthorized', { status: 401 });
  let ev: Ev;
  try { ev = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  if (!ev?.id || !ev.event) return new Response('bad event', { status: 400 });

  // entrega "pelo menos uma vez": cada aviso é processado uma vez só
  const { error: dup } = await db.from('webhook_events').insert({ id: `asaas:${ev.id}`, provider: 'asaas' });
  if (dup) return Response.json({ received: true, duplicate: true });

  try {
    if (ev.event === 'CHECKOUT_PAID' && ev.checkout) {
      const cid = await companyBy('asaas_checkout_id', ev.checkout.id);
      if (cid) { await adoptFromCheckout(cid); await syncCompany(cid); }
    } else if (ev.subscription) {
      const s = ev.subscription;
      let cid = await companyBy('asaas_subscription_id', s.id);
      if (!cid && s.checkoutSession) {
        // assinatura nova criada pelo Checkout de cartão
        cid = await companyBy('asaas_checkout_id', s.checkoutSession);
        if (cid && s.status === 'ACTIVE') await adoptSubscription(cid, s);
      }
      if (cid) await syncCompany(cid);
    } else if (ev.payment) {
      const p = ev.payment;
      const cid = await companyBy('asaas_subscription_id', p.subscription);
      if (cid) {
        if (ev.event === 'PAYMENT_REFUNDED' || ev.event === 'PAYMENT_CHARGEBACK_REQUESTED') await revokeCompany(cid, ev.event === 'PAYMENT_REFUNDED' ? 'reembolsada' : 'contestada', p.id);
        else await syncCompany(cid);
      }
    }
  } catch (e) {
    console.error(ev.event, e);
    await db.from('webhook_events').delete().eq('id', `asaas:${ev.id}`); // libera para o Asaas tentar de novo
    return new Response('error', { status: 500 });
  }
  return Response.json({ received: true });
});
