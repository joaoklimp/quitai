// Recebe os avisos da Stripe e atualiza plano, situação da assinatura e faturas da empresa.
import Stripe from 'npm:stripe@18';
import { admin, stripe } from '../_shared/common.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

function isoDate(sec: number | null | undefined): string | null {
  if (!sec) return null;
  return new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

async function companyFor(customer: string | null, meta: Record<string, string> | null | undefined) {
  if (meta?.app === 'quitai' && meta.company_id) {
    const { data } = await admin.from('companies').select('*').eq('id', meta.company_id).maybeSingle();
    if (data) return data;
  }
  if (!customer) return null;
  const { data } = await admin.from('companies').select('*').eq('stripe_customer_id', customer).maybeSingle();
  return data;
}

async function syncSubscription(sub: Stripe.Subscription) {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const company = await companyFor(customer, sub.metadata);
  if (!company) return;
  // uma assinatura antiga encerrando não mexe numa assinatura nova
  if (company.stripe_subscription_id && company.stripe_subscription_id !== sub.id && ['canceled', 'incomplete_expired'].includes(sub.status)) return;
  if (sub.status === 'incomplete') return;

  const item = sub.items.data[0];
  const key = item?.price?.lookup_key ?? '';
  const m = /^quitai_(basico|pro|empresa)_(mensal|anual)$/.exec(key);
  const periodEnd = isoDate((item as unknown as { current_period_end?: number })?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end);

  const patch: Record<string, unknown> = { stripe_subscription_id: sub.id, stripe_customer_id: customer, updated_at: new Date().toISOString() };
  if (m) { patch.plan = m[1]; patch.billing_cycle = m[2]; }
  if (['active', 'trialing'].includes(sub.status)) {
    const ending = sub.cancel_at_period_end || !!sub.cancel_at;
    patch.billing_status = ending ? 'canceled' : 'active';
    patch.current_period_end = ending && sub.cancel_at ? isoDate(sub.cancel_at) : periodEnd;
    patch.canceled_at = ending ? new Date((sub.canceled_at ?? Date.now() / 1000) * 1000).toISOString() : null;
  } else if (sub.status === 'past_due') {
    patch.billing_status = 'past_due';
    patch.current_period_end = periodEnd;
  } else {
    // canceled, unpaid, incomplete_expired, paused: acesso termina agora
    patch.billing_status = 'canceled';
    patch.current_period_end = isoDate(sub.ended_at ?? Math.floor(Date.now() / 1000));
    patch.canceled_at = new Date((sub.canceled_at ?? Date.now() / 1000) * 1000).toISOString();
  }
  await admin.from('companies').update(patch).eq('id', company.id);
}

async function recordInvoice(inv: Stripe.Invoice) {
  const customer = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;
  const company = await companyFor(customer, inv.parent?.subscription_details?.metadata as Record<string, string> | undefined);
  if (!company) return;
  const list = Array.isArray(company.invoices) ? company.invoices : [];
  if (list.some((x: { id: string }) => x.id === inv.id)) return;
  const line = inv.lines?.data?.[0];
  const entry = {
    id: inv.id,
    date: isoDate(inv.status_transitions?.paid_at ?? inv.created),
    desc: line?.description || 'Assinatura Quitaí',
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
