// Função "billing" (painel): assinar (cartão ou Pix/boleto), cancelar e conferir o pagamento no Asaas.
import { bad, json, readJson, serve, str, HttpError } from '../_shared/http.ts';
import { audit, caller, db, requireRole } from '../_shared/db.ts';
import { adoptFromCheckout, asaas, AsaasError, billingAccount, CHECKOUT_BASE, plans, saveBilling, syncCompany, todaySP, validCpfCnpj } from '../_shared/asaas.ts';

serve(async (req) => {
  const me = await caller(req);
  const body = await readJson(req);
  const { data: company } = await db.from('companies').select('*').eq('id', me.companyId).single();
  if (!company) throw bad('Empresa não encontrada.');

  try {
    /* "Já paguei e o plano não liberou": confere direto no Asaas */
    if (body.action === 'sync') {
      try { await adoptFromCheckout(company.id); } catch (e) { console.error('ligar assinatura do checkout', e); }
      const acct = await billingAccount(company.id);
      if (acct?.asaas_subscription_id) await syncCompany(company.id);
      const { data: fresh } = await db.from('companies').select('billing_status').eq('id', company.id).single();
      return json({ status: fresh?.billing_status ?? company.billing_status }, 200, req);
    }

    requireRole(me, 'dono');

    if (body.action === 'cancel') {
      const acct = await billingAccount(company.id);
      if (!acct?.asaas_subscription_id) throw bad('Não há assinatura ativa para cancelar.');
      await asaas(`/subscriptions/${acct.asaas_subscription_id}`, { method: 'DELETE' });
      await syncCompany(company.id);
      await audit({ company_id: company.id, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'cancelar_assinatura', summary: 'Cancelou a assinatura' });
      return json({ ok: true }, 200, req);
    }

    if (body.action === 'checkout') {
      if (company.complimentary) throw bad('Sua conta é cortesia: não precisa assinar.');
      if (!Deno.env.get('ASAAS_API_KEY')) throw bad('Os pagamentos ainda não foram configurados (falta a chave do Asaas).', 'pagamentos_nao_configurados');
      const list = await plans();
      const plan = list.find((p) => p.id === str(body.plan));
      const cycle = body.cycle === 'anual' ? 'anual' : 'mensal';
      if (!plan) throw bad('Plano inválido.');
      const method = body.method === 'pix_boleto' ? 'pix_boleto' : 'cartao';
      const doc = str(body.cpfCnpj).replace(/\D/g, '');
      if (doc && !validCpfCnpj(doc)) throw bad('CPF ou CNPJ inválido.');
      if (method === 'pix_boleto' && !doc) throw bad('Para Pix ou boleto, informe o CPF ou CNPJ de quem paga.');

      const origin = (Deno.env.get('SITE_URL') || str(body.origin, 200) || req.headers.get('origin') || '').replace(/\/$/, '');
      const page = `${origin}/app/#/configuracoes/assinatura`;
      const value = cycle === 'anual' ? plan.yearly : plan.monthly;
      const asaasCycle = cycle === 'anual' ? 'YEARLY' : 'MONTHLY';
      const today = todaySP();
      const acct = await billingAccount(company.id);
      // já tem período pago (troca de plano ou reativação): a nova assinatura começa quando ele acabar
      const paidUntil = !acct?.access_revoked && ['active', 'past_due', 'canceled'].includes(company.billing_status) && company.current_period_end && company.current_period_end > today ? company.current_period_end : null;
      const firstDue = paidUntil ?? today;
      const desc = `ORBYTA · Plano ${plan.name} · ${cycle}`;

      if (method === 'cartao') {
        const checkout = await asaas<{ id: string; link?: string }>('/checkouts', {
          method: 'POST',
          body: {
            billingTypes: ['CREDIT_CARD'],
            chargeTypes: ['RECURRENT'],
            minutesToExpire: 60,
            externalReference: company.id,
            callback: { successUrl: page, cancelUrl: page, expiredUrl: page },
            items: [{ name: `ORBYTA ${plan.name}`.slice(0, 30), description: desc.slice(0, 150), quantity: 1, value }],
            // sem customerData: a própria página do Checkout pede os dados do pagador
            subscription: { cycle: asaasCycle, nextDueDate: `${firstDue} 12:00:00` },
          },
        });
        await saveBilling(company.id, { asaas_checkout_id: checkout.id, pending: { plan: plan.id, cycle, method } });
        return json({ url: checkout.link || `${CHECKOUT_BASE}/checkoutSession/show?id=${checkout.id}` }, 200, req);
      }

      // clicou de novo no mesmo plano antes de pagar: reaproveita a cobrança em aberto
      if (acct?.asaas_subscription_id && !paidUntil) {
        try {
          const cur = await asaas<{ status: string; deleted?: boolean; value: number; cycle: string }>(`/subscriptions/${acct.asaas_subscription_id}`);
          if (!cur.deleted && cur.status === 'ACTIVE' && Math.abs(cur.value - value) < 0.01 && cur.cycle === asaasCycle) {
            const open = await asaas<{ data: { invoiceUrl?: string; status: string }[] }>(`/subscriptions/${acct.asaas_subscription_id}/payments?limit=10`);
            const pending = (open.data ?? []).find((p) => ['PENDING', 'OVERDUE'].includes(p.status) && p.invoiceUrl);
            if (pending) return json({ url: pending.invoiceUrl }, 200, req);
          }
        } catch (e) { console.error('conferir assinatura atual', e); }
      }

      // Pix ou boleto: cria o cliente e a assinatura no Asaas
      let customer = acct?.asaas_customer_id ?? null;
      const name = String(company.name || me.name).slice(0, 100);
      if (!customer) {
        const c = await asaas<{ id: string }>('/customers', { method: 'POST', body: { name, cpfCnpj: doc, email: me.email, externalReference: company.id } });
        customer = c.id;
      } else {
        await asaas(`/customers/${customer}`, { method: 'PUT', body: { cpfCnpj: doc } }).catch((e) => console.error('atualizar cliente', e));
      }
      const subBody = { customer, billingType: 'UNDEFINED', value, nextDueDate: firstDue, cycle: asaasCycle, description: desc, externalReference: company.id };
      let sub: { id: string };
      try {
        sub = await asaas<{ id: string }>('/subscriptions', { method: 'POST', body: { ...subBody, callback: { successUrl: page, autoRedirect: true } } });
      } catch (e) {
        // o Asaas recusa o retorno se o domínio não estiver cadastrado na conta: cria sem o retorno
        if (!(e instanceof AsaasError) || e.status !== 400 || !/callback|successUrl|dom[ií]nio|site/i.test(e.body)) throw e;
        sub = await asaas<{ id: string }>('/subscriptions', { method: 'POST', body: subBody });
      }
      const old = acct?.asaas_subscription_id;
      await saveBilling(company.id, { asaas_customer_id: customer, asaas_subscription_id: sub.id, access_revoked: false, pending: { plan: plan.id, cycle, method } });
      if (old && old !== sub.id) await asaas(`/subscriptions/${old}`, { method: 'DELETE' }).catch((e) => console.error('remover assinatura anterior', e));
      await audit({ company_id: company.id, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'assinar', summary: `Escolheu o plano ${plan.name} (${cycle}, Pix ou boleto)` });
      if (paidUntil) return json({ scheduled: firstDue, message: `O plano ${plan.name} começa em ${firstDue.split('-').reverse().join('/')}, quando termina o período já pago.` }, 200, req);
      const pays = await asaas<{ data: { invoiceUrl?: string }[] }>(`/subscriptions/${sub.id}/payments?limit=1`);
      return json({ url: pays.data?.[0]?.invoiceUrl ?? null }, 200, req);
    }
  } catch (e) {
    if (e instanceof AsaasError) {
      console.error(e.message);
      throw new HttpError(502, e.status === 401 ? 'pagamentos_nao_configurados' : 'erro_pagamento', e.status === 401 ? 'Os pagamentos ainda não foram configurados.' : 'O Asaas não conseguiu concluir agora. Tente de novo em instantes.');
    }
    throw e;
  }
  throw bad('Ação desconhecida.');
});
