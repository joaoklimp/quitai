// Assinatura do Quitaí pelo Asaas: assinar (cartão ou Pix/boleto), cancelar e conferir pagamento.
// Empresas antigas da Stripe (se houver) ainda podem abrir o portal da Stripe.
import { admin, caller, cors, CYCLES, json, PLAN_IDS, SITE_URL, stripe } from '../_shared/common.ts';
import { adoptFromCheckout, asaas, AsaasError, CHECKOUT_BASE, PRICES, revokeCompany, syncCompany, todaySP } from '../_shared/asaas.ts';
import { LOGO_PNG_BASE64 } from '../_shared/logo.ts';

function onlyDigits(s: unknown): string { return String(s ?? '').replace(/\D/g, ''); }
function validCpfCnpj(d: string): boolean {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    // checagem de configuração: só diz se as chaves existem e o ambiente, nunca o valor
    const peek = await req.clone().json().catch(() => ({}));
    if (peek.action === 'health') {
      let asaasOk = false;
      try { await asaas('/myAccount/status'); asaasOk = true; } catch (_) { asaasOk = false; }
      return json(req, {
        asaasEnv: Deno.env.get('ASAAS_ENV') === 'production' ? 'production' : 'sandbox',
        asaasKey: asaasOk,
        asaasWebhookToken: (Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '').length >= 32,
        resend: (Deno.env.get('RESEND_API_KEY') ?? '').startsWith('re_'),
        resendWebhook: (Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '').startsWith('whsec_'),
        ai: (Deno.env.get('ANTHROPIC_API_KEY') ?? '').startsWith('sk-ant-'),
      });
    }
    const me = await caller(req);
    if (!me) return json(req, { error: 'not_authenticated' }, 401);
    const body = await req.json().catch(() => ({}));

    // Administração do Quitaí: cancelar a assinatura de uma empresa e bloquear o painel na hora
    if (body.action === 'admin_revoke') {
      const { data: adm } = await admin.from('platform_admins').select('user_id').eq('user_id', me.user_id).maybeSingle();
      if (!adm) return json(req, { error: 'not_allowed' }, 403);
      const { data: target } = await admin.from('companies').select('id,complimentary').eq('id', String(body.company_id ?? '')).maybeSingle();
      if (!target) return json(req, { error: 'not_found' }, 404);
      if (target.complimentary) return json(req, { error: 'complimentary' }, 409);
      await revokeCompany(target.id, 'reembolsada');
      return json(req, { ok: true });
    }
    const { data: company } = await admin.from('companies').select('*').eq('id', me.company_id).single();
    if (!company) return json(req, { error: 'no_company' }, 404);

    // "Já paguei e meu plano não liberou": confere direto no Asaas
    if (body.action === 'sync') {
      // assinatura de cartão que ainda não foi ligada (o aviso do Asaas pode ter se perdido)
      try { await adoptFromCheckout(company.id); } catch (e) { console.error('ligar assinatura do checkout', e); }
      const { data: fresh } = await admin.from('companies').select('asaas_subscription_id').eq('id', company.id).single();
      if (!fresh?.asaas_subscription_id) return json(req, { ok: true, found: false });
      await syncCompany(company.id);
      const { data: c2 } = await admin.from('companies').select('billing_status').eq('id', company.id).single();
      return json(req, { ok: true, found: true, status: c2?.billing_status });
    }

    if (me.role !== 'owner') return json(req, { error: 'not_owner' }, 403);
    const origin = cors(req)['Access-Control-Allow-Origin'] === req.headers.get('origin') ? req.headers.get('origin') : SITE_URL;
    const page = `${origin}/`;

    // assinaturas antigas da Stripe
    if (body.action === 'portal') {
      if (!company.stripe_customer_id) return json(req, { error: 'no_subscription' }, 400);
      const configuration = Deno.env.get('STRIPE_PORTAL_CONFIG') || undefined;
      const s = await stripe.billingPortal.sessions.create({ customer: company.stripe_customer_id, return_url: `${page}#assinatura`, configuration });
      return json(req, { url: s.url });
    }

    if (body.action === 'cancel') {
      if (!company.asaas_subscription_id) return json(req, { error: 'no_subscription' }, 400);
      await asaas(`/subscriptions/${company.asaas_subscription_id}`, { method: 'DELETE' });
      await syncCompany(company.id);
      return json(req, { ok: true });
    }

    if (body.action === 'checkout') {
      if (company.complimentary) return json(req, { error: 'complimentary' }, 409);
      // no site oficial, só com o Asaas de produção (impede assinar no ambiente de testes)
      // (contas de teste listadas em ASAAS_SANDBOX_TESTERS podem testar o sandbox no site oficial)
      const testers = (Deno.env.get('ASAAS_SANDBOX_TESTERS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (Deno.env.get('ASAAS_ENV') !== 'production' && /usequitai\.com\.br$/.test(new URL(page).hostname) && !testers.includes(me.email.toLowerCase())) return json(req, { error: 'payments_soon' }, 503);
      const plan = String(body.plan);
      const cycle = String(body.cycle) as 'mensal' | 'anual';
      const method = body.method === 'pix' ? 'pix' : 'cartao';
      if (!PLAN_IDS.includes(plan as never) || !CYCLES.includes(cycle as never)) return json(req, { error: 'invalid_plan' }, 400);
      const doc = onlyDigits(body.cpfCnpj);
      if (doc && !validCpfCnpj(doc)) return json(req, { error: 'invalid_doc' }, 400);
      if (method === 'pix' && !doc) return json(req, { error: 'doc_required' }, 400);

      const value = PRICES[plan][cycle];
      const asaasCycle = cycle === 'anual' ? 'YEARLY' : 'MONTHLY';
      const today = todaySP();
      // já tem período pago (troca de plano ou reativação): a nova assinatura começa quando ele acabar
      const paidUntil = !company.access_revoked && ['active', 'past_due', 'canceled'].includes(company.billing_status) && company.current_period_end && company.current_period_end > today ? company.current_period_end : null;
      const firstDue = paidUntil ?? today;
      const desc = `Quitaí · Plano ${PRICES[plan].name} · ${cycle}`;
      const name = String((company.data?.name as string) || me.name).slice(0, 100);

      if (method === 'cartao') {
        const checkout = await asaas<{ id: string; link?: string }>('/checkouts', {
          method: 'POST',
          body: {
            billingTypes: ['CREDIT_CARD'],
            chargeTypes: ['RECURRENT'],
            minutesToExpire: 60,
            externalReference: company.id,
            callback: { successUrl: `${page}#assinatura-ok`, cancelUrl: `${page}#assinatura`, expiredUrl: `${page}#assinatura` },
            items: [{ name: `Quitaí ${PRICES[plan].name}`.slice(0, 30), description: desc.slice(0, 150), quantity: 1, value, imageBase64: LOGO_PNG_BASE64 }],
            // sem customerData: quando enviado, o Asaas exige o cadastro completo (telefone, endereço...);
            // a própria página do Checkout pede esses dados ao pagador
            subscription: { cycle: asaasCycle, nextDueDate: `${firstDue} 12:00:00` },
          },
        });
        await admin.from('companies').update({ asaas_checkout_id: checkout.id }).eq('id', company.id);
        return json(req, { url: checkout.link || `${CHECKOUT_BASE}/checkoutSession/show?id=${checkout.id}` });
      }

      // clicou de novo no mesmo plano antes de pagar: reaproveita a cobrança em aberto em vez de criar outra assinatura
      if (company.asaas_subscription_id && !paidUntil) {
        try {
          const cur = await asaas<{ status: string; deleted?: boolean; value: number; cycle: string }>(`/subscriptions/${company.asaas_subscription_id}`);
          if (!cur.deleted && cur.status === 'ACTIVE' && Math.abs(cur.value - value) < 0.01 && cur.cycle === asaasCycle) {
            const open = await asaas<{ data: { invoiceUrl?: string; status: string }[] }>(`/subscriptions/${company.asaas_subscription_id}/payments?limit=10`);
            const pending = (open.data ?? []).find((p) => ['PENDING', 'OVERDUE'].includes(p.status) && p.invoiceUrl);
            if (pending) return json(req, { url: pending.invoiceUrl, ok: true, reused: true });
          }
        } catch (e) { console.error('conferir assinatura atual', e); }
      }

      // Pix ou boleto: o Quitaí cria o cliente e a assinatura; cada cobrança tem QR Code Pix e boleto
      let customer = company.asaas_customer_id as string | null;
      if (!customer) {
        const c = await asaas<{ id: string }>('/customers', { method: 'POST', body: { name, cpfCnpj: doc, email: me.email, externalReference: company.id } });
        customer = c.id;
      } else {
        await asaas(`/customers/${customer}`, { method: 'POST', body: { cpfCnpj: doc } }).catch(() => {});
      }
      const subBody = { customer, billingType: 'UNDEFINED', value, nextDueDate: firstDue, cycle: asaasCycle, description: desc, externalReference: company.id };
      let sub: { id: string };
      try {
        // depois de pagar, a página da cobrança leva o cliente de volta ao Quitaí
        sub = await asaas<{ id: string }>('/subscriptions', { method: 'POST', body: { ...subBody, callback: { successUrl: `${page}#assinatura-ok`, autoRedirect: true } } });
      } catch (e) {
        // o Asaas recusa o retorno se o domínio não estiver cadastrado na conta: cria sem o retorno
        if (!(e instanceof AsaasError) || e.status !== 400 || !/callback|successUrl|dom[ií]nio|site/i.test(e.body)) throw e;
        console.error('retorno automático recusado pelo Asaas', e.body.slice(0, 200));
        sub = await asaas<{ id: string }>('/subscriptions', { method: 'POST', body: subBody });
      }
      const old = company.asaas_subscription_id;
      await admin.from('companies').update({ asaas_customer_id: customer, asaas_subscription_id: sub.id, billing_provider: 'asaas', billing_method: 'pix', access_revoked: false }).eq('id', company.id);
      if (old && old !== sub.id) await asaas(`/subscriptions/${old}`, { method: 'DELETE' }).catch((e) => console.error('remover assinatura anterior', e));
      if (paidUntil) return json(req, { ok: true, scheduled: firstDue });
      const pays = await asaas<{ data: { invoiceUrl?: string }[] }>(`/subscriptions/${sub.id}/payments?limit=1`);
      return json(req, { url: pays.data?.[0]?.invoiceUrl ?? null, ok: true });
    }

    return json(req, { error: 'invalid_action' }, 400);
  } catch (e) {
    if (e instanceof AsaasError) {
      console.error(e.message);
      return json(req, { error: e.status === 401 ? 'payments_not_configured' : 'payment_error', detail: e.body.slice(0, 300) }, 502);
    }
    console.error(e);
    return json(req, { error: 'server_error' }, 500);
  }
});
