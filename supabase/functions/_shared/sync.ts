// Copia a situação de uma assinatura da Stripe para a empresa no banco.
// Usada pelo webhook e pelo botão "Já paguei e meu plano não liberou".
import Stripe from 'npm:stripe@18';
import { admin } from './common.ts';

export function isoDate(sec: number | null | undefined): string | null {
  if (!sec) return null;
  return new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export async function companyFor(customer: string | null, meta: Record<string, string> | null | undefined) {
  if (meta?.app === 'quitai' && meta.company_id) {
    const { data } = await admin.from('companies').select('*').eq('id', meta.company_id).maybeSingle();
    if (data) return data;
  }
  if (!customer) return null;
  const { data } = await admin.from('companies').select('*').eq('stripe_customer_id', customer).maybeSingle();
  return data;
}

export async function syncSubscription(sub: Stripe.Subscription) {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const company = await companyFor(customer, sub.metadata);
  if (!company || company.complimentary) return; // conta cortesia não depende da Stripe
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
