// Assinatura: abre o pagamento da Stripe (checkout) ou o portal para gerenciar a assinatura.
import { admin, caller, cors, CYCLES, json, PLAN_IDS, SITE_URL, stripe } from '../_shared/common.ts';
import { syncSubscription } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    // checagem de configuração: só diz o modo das chaves, nunca o valor
    const peek = await req.clone().json().catch(() => ({}));
    if (peek.action === 'health') {
      const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
      let account: string | null = null;
      let prices = 0;
      try {
        account = (await stripe.accounts.retrieve()).id;
        prices = (await stripe.prices.list({ lookup_keys: ['quitai_basico_mensal', 'quitai_pro_mensal', 'quitai_empresa_mensal', 'quitai_basico_anual', 'quitai_pro_anual', 'quitai_empresa_anual'], active: true, limit: 10 })).data.length;
      } catch (_) { /* chave inválida */ }
      return json(req, {
        mode: key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : key.startsWith('rk_live_') ? 'live-restricted' : 'unknown',
        account, prices,
        webhookSecret: (Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '').startsWith('whsec_'),
        resend: (Deno.env.get('RESEND_API_KEY') ?? '').startsWith('re_'),
      });
    }
    const me = await caller(req);
    if (!me) return json(req, { error: 'not_authenticated' }, 401);
    const body = await req.json().catch(() => ({}));
    const { data: company } = await admin.from('companies').select('*').eq('id', me.company_id).single();
    if (!company) return json(req, { error: 'no_company' }, 404);

    // "Já paguei e meu plano não liberou": busca a assinatura direto na Stripe
    if (body.action === 'sync') {
      if (!company.stripe_customer_id) return json(req, { ok: true, found: false });
      const subs = await stripe.subscriptions.list({ customer: company.stripe_customer_id, status: 'all', limit: 10 });
      const mine = subs.data.filter((s) => s.metadata?.app === 'quitai');
      const best = mine.find((s) => ['active', 'trialing', 'past_due'].includes(s.status)) ?? mine[0];
      if (!best) return json(req, { ok: true, found: false });
      await syncSubscription(best);
      return json(req, { ok: true, found: true, status: best.status });
    }

    if (me.role !== 'owner') return json(req, { error: 'not_owner' }, 403);
    // volta para o endereço de onde a pessoa veio (site publicado ou teste local)
    const origin = cors(req)['Access-Control-Allow-Origin'] === req.headers.get('origin') ? req.headers.get('origin') : SITE_URL;
    const page = origin === 'https://joaoklimp.github.io' ? `${origin}/quitai/` : `${origin}/`;
    const returnUrl = `${page}#assinatura`;

    if (body.action === 'portal') {
      if (!company.stripe_customer_id) return json(req, { error: 'no_subscription' }, 400);
      const configuration = Deno.env.get('STRIPE_PORTAL_CONFIG') || undefined;
      const s = await stripe.billingPortal.sessions.create({ customer: company.stripe_customer_id, return_url: returnUrl, configuration });
      return json(req, { url: s.url });
    }

    if (body.action === 'checkout') {
      // no site oficial, só aceita pagamento com a chave real (impede assinar com cartão de teste)
      const liveKey = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_live_');
      if (!liveKey && /usequitai\.com\.br$/.test(new URL(page).hostname)) return json(req, { error: 'payments_soon' }, 503);
      const plan = String(body.plan);
      const cycle = String(body.cycle);
      if (!PLAN_IDS.includes(plan as never) || !CYCLES.includes(cycle as never)) return json(req, { error: 'invalid_plan' }, 400);
      if (company.stripe_subscription_id && ['active', 'past_due'].includes(company.billing_status)) return json(req, { error: 'already_subscribed' }, 409);
      const prices = await stripe.prices.list({ lookup_keys: [`quitai_${plan}_${cycle}`], active: true, limit: 1 });
      const price = prices.data[0];
      if (!price) return json(req, { error: 'price_not_found' }, 500);

      let customer = company.stripe_customer_id as string | null;
      if (!customer) {
        const c = await stripe.customers.create({
          email: me.email,
          name: (company.data?.name as string) || me.name,
          metadata: { app: 'quitai', company_id: company.id },
        });
        customer = c.id;
        await admin.from('companies').update({ stripe_customer_id: customer }).eq('id', company.id);
      }
      const meta = { app: 'quitai', company_id: company.id, plan, cycle };
      const s = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: company.id,
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: meta,
        subscription_data: { metadata: meta },
        locale: 'pt-BR',
        allow_promotion_codes: true,
        success_url: `${page}#assinatura-ok`,
        cancel_url: returnUrl,
      });
      return json(req, { url: s.url });
    }

    return json(req, { error: 'invalid_action' }, 400);
  } catch (e) {
    console.error(e);
    const err = e as { type?: string; code?: string; rawType?: string };
    return json(req, { error: 'server_error', detail: err.code || err.rawType || err.type || 'unknown' }, 500);
  }
});
