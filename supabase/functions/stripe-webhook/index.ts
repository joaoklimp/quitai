// Recebe os avisos da Stripe e atualiza plano, situação da assinatura e faturas da empresa.
import Stripe from 'npm:stripe@18';
import { admin, stripe } from '../_shared/common.ts';
import { companyFor, syncSubscription, isoDate } from '../_shared/sync.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function recordInvoice(inv: Stripe.Invoice) {
  const customer = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;
  const company = await companyFor(customer, inv.parent?.subscription_details?.metadata as Record<string, string> | undefined);
  if (!company) return;
  const list = Array.isArray(company.invoices) ? company.invoices : [];
  if (list.some((x: { id: string }) => x.id === inv.id)) return;
  const line = inv.lines?.data?.[0] as unknown as { pricing?: { price_details?: { price?: string } }; price?: { id?: string } } | undefined;
  const priceId = line?.pricing?.price_details?.price ?? line?.price?.id;
  let desc = 'Assinatura Quitaí';
  if (priceId) {
    const price = await stripe.prices.retrieve(priceId).catch(() => null);
    const m = /^quitai_(basico|pro|empresa)_(mensal|anual)$/.exec(price?.lookup_key ?? '');
    if (m) desc = `Plano ${{ basico: 'Básico', pro: 'Pro', empresa: 'Empresa' }[m[1]]} · ${m[2]}`;
  }
  const entry = {
    id: inv.id,
    date: isoDate(inv.status_transitions?.paid_at ?? inv.created),
    desc,
    amount: inv.amount_paid,
    status: 'paga',
    method: 'cartao',
    url: inv.hosted_invoice_url ?? null,
  };
  await admin.from('companies').update({ invoices: [entry, ...list].slice(0, 60) }).eq('id', company.id);
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig ?? '', Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '', undefined, cryptoProvider);
  } catch (e) {
    console.error('assinatura do aviso inválida', e);
    return new Response('invalid signature', { status: 400 });
  }
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.metadata?.app !== 'quitai' || !s.subscription) break;
        const sub = await stripe.subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
        await syncSubscription(sub);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await recordInvoice(event.data.object as Stripe.Invoice);
        break;
    }
  } catch (e) {
    console.error(event.type, e);
    return new Response('error', { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
