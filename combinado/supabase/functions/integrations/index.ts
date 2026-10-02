// Função "integrations" (painel): conectar o Asaas e a Focus NFe da empresa, cobrar clientes e emitir notas fiscais.
import { bad, HttpError, json, readJson, serve, str } from '../_shared/http.ts';
import { audit, caller, db, requireRole } from '../_shared/db.ts';
import { loadBase } from '../_shared/context.ts';
import { asaasCall, cancelCharge, createCharge, credsFor, markChargePaid, ProviderError, sendCharge, WEBHOOK_EVENTS, webhookUrl, type Actor } from '../_shared/payments.ts';
import { cancelNote, checkFocusToken, emitNote, syncNote, type FiscalConfig } from '../_shared/fiscal.ts';
import type { Charge, ChargeMethod, FiscalNote } from '../_shared/types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const env = (v: unknown) => (v === 'producao' ? 'producao' : 'testes') as 'producao' | 'testes';

serve(async (req) => {
  const me = await caller(req);
  const body = await readJson(req);
  const actor: Actor = { type: 'usuario', name: me.name, userId: me.userId, channel: 'painel', via: 'painel' };
  const action = str(body.action, 40);
  try {
    /* ---------- conectar e desconectar ---------- */
    if (action === 'connect_asaas') {
      requireRole(me, 'dono');
      const key = str(body.api_key, 300);
      if (key.length < 20) throw bad('Cole a chave da API do Asaas (Integrações → Chaves de API, no Asaas).');
      const cr = { api_key: key, environment: env(body.environment) };
      await asaasCall(cr, '/customers?limit=1'); // confere a chave
      const { data: old } = await db.from('integration_credentials').select('webhook_token').eq('company_id', me.companyId).eq('provider', 'asaas').maybeSingle();
      const { data: saved } = await db.from('integration_credentials').upsert({ company_id: me.companyId, provider: 'asaas', api_key: key, ...(old ? { webhook_token: old.webhook_token } : {}) }).select('webhook_token').single();
      // tenta cadastrar o aviso de pagamento sozinho; se o Asaas não deixar, a tela mostra como fazer à mão
      let webhook = 'automatico';
      try {
        await asaasCall(cr, '/webhooks', { method: 'POST', body: { name: 'ORBYTA', url: webhookUrl(me.companyId), email: me.email || undefined, enabled: true, interrupted: false, apiVersion: 3, authToken: saved!.webhook_token, sendType: 'SEQUENTIALLY', events: WEBHOOK_EVENTS } });
      } catch (e) { console.error('webhook asaas', (e as Error).message); webhook = 'manual'; }
      const { data: integration } = await db.from('company_integrations').upsert({ company_id: me.companyId, provider: 'asaas', status: 'conectado', environment: cr.environment, config: { webhook }, account_name: null, last_error: null, connected_at: new Date().toISOString() }).select('*').single();
      await audit({ company_id: me.companyId, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'conectar_asaas', summary: `Conectou o Asaas da empresa (${cr.environment === 'producao' ? 'produção' : 'testes'})` });
      return json({ integration, webhook: webhook === 'manual' ? { url: webhookUrl(me.companyId), token: saved!.webhook_token, events: WEBHOOK_EVENTS } : null }, 200, req);
    }

    if (action === 'webhook_info') {
      requireRole(me, 'dono');
      const { data } = await db.from('integration_credentials').select('webhook_token').eq('company_id', me.companyId).eq('provider', 'asaas').maybeSingle();
      if (!data) throw bad('O Asaas não está conectado.');
      return json({ url: webhookUrl(me.companyId), token: data.webhook_token, events: WEBHOOK_EVENTS }, 200, req);
    }

    if (action === 'connect_focus') {
      requireRole(me, 'dono');
      const token = str(body.token, 300);
      if (token.length < 10) throw bad('Cole o token da Focus NFe (painel da Focus → Empresas → Tokens).');
      const c = (body.config ?? {}) as Record<string, unknown>;
      const config: FiscalConfig = {
        cnpj: str(c.cnpj, 20).replace(/\D/g, ''), inscricao_municipal: str(c.inscricao_municipal, 30).replace(/\D/g, ''), codigo_municipio: str(c.codigo_municipio, 7).replace(/\D/g, ''),
        item_lista_servico: str(c.item_lista_servico, 10).replace(/\D/g, ''), aliquota: Math.max(0, Math.min(5, Number(c.aliquota) || 0)),
        codigo_tributario_municipio: str(c.codigo_tributario_municipio, 20) || undefined, optante_simples_nacional: c.optante_simples_nacional !== false, natureza_operacao: str(c.natureza_operacao, 2) || '1',
      };
      if (config.cnpj.length !== 14) throw bad('CNPJ da empresa inválido.');
      if (!config.inscricao_municipal) throw bad('Informe a inscrição municipal.');
      if (config.codigo_municipio.length !== 7) throw bad('O código do município é o código IBGE de 7 números (ex.: Brasília 5300108).');
      if (!config.item_lista_servico) throw bad('Informe o item da lista de serviço (LC 116), ex.: 0702. Seu contador sabe qual é.');
      const cr = { api_key: token, environment: env(body.environment) };
      await checkFocusToken(cr);
      await db.from('integration_credentials').upsert({ company_id: me.companyId, provider: 'focusnfe', api_key: token });
      const { data: integration } = await db.from('company_integrations').upsert({ company_id: me.companyId, provider: 'focusnfe', status: 'conectado', environment: cr.environment, config, account_name: null, last_error: null, connected_at: new Date().toISOString() }).select('*').single();
      await audit({ company_id: me.companyId, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'conectar_focusnfe', summary: `Conectou a emissão de nota fiscal (${cr.environment === 'producao' ? 'produção' : 'homologação'})` });
      return json({ integration }, 200, req);
    }

    if (action === 'disconnect') {
      requireRole(me, 'dono');
      const provider = body.provider === 'focusnfe' ? 'focusnfe' : 'asaas';
      await db.from('integration_credentials').delete().eq('company_id', me.companyId).eq('provider', provider);
      await db.from('company_integrations').update({ status: 'desconectado' }).eq('company_id', me.companyId).eq('provider', provider);
      await audit({ company_id: me.companyId, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: `desconectar_${provider}`, summary: `Desconectou ${provider === 'asaas' ? 'o Asaas' : 'a emissão de nota fiscal'}` });
      return json({ ok: true }, 200, req);
    }

    /* ---------- cobranças ---------- */
    requireRole(me, 'dono', 'gerente');
    const b = await loadBase(me.companyId);
    if (!b.writable && !['charge_sync', 'note_sync'].includes(action)) throw bad('A assinatura está inativa: só é possível consultar.');
    const charge = async () => {
      const { data } = await db.from('charges').select('*').eq('company_id', me.companyId).eq('id', str(body.id, 64)).maybeSingle();
      if (!data) throw bad('Cobrança não encontrada.');
      return data as Charge;
    };

    if (action === 'charge_create') {
      const method = (['pix', 'boleto', 'pix_boleto'].includes(String(body.method)) ? body.method : 'pix_boleto') as ChargeMethod;
      const due = str(body.due_date, 10);
      if (!DATE.test(due)) throw bad('Informe o vencimento.');
      const r = await createCharge(b, { contactId: str(body.contact_id, 64), amount: Number(body.amount), description: str(body.description, 300) || 'Serviço', dueDate: due, method, document: str(body.document, 20) || null, quoteId: str(body.quote_id, 64) || null, send: body.send === true }, actor);
      return json(r, 200, req);
    }
    if (action === 'charge_send') return json(await sendCharge(b, await charge(), actor), 200, req);
    if (action === 'charge_cancel') { await cancelCharge(b, await charge(), actor); return json({ ok: true }, 200, req); }
    if (action === 'charge_sync') {
      const ch = await charge();
      const cr = await credsFor(me.companyId, 'asaas');
      if (cr && ch.provider_id && ch.status !== 'paga') {
        const p = await asaasCall<{ status: string; billingType?: string; paymentDate?: string; clientPaymentDate?: string }>(cr, `/payments/${ch.provider_id}`);
        if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status)) await markChargePaid(ch.id, p.billingType, p.clientPaymentDate ?? p.paymentDate);
        else if (p.status === 'OVERDUE') await db.from('charges').update({ status: 'vencida' }).eq('id', ch.id);
      }
      const { data } = await db.from('charges').select('*').eq('id', ch.id).single();
      return json({ charge: data }, 200, req);
    }

    /* ---------- notas fiscais ---------- */
    const note = async () => {
      const { data } = await db.from('fiscal_notes').select('*').eq('company_id', me.companyId).eq('id', str(body.id, 64)).maybeSingle();
      if (!data) throw bad('Nota não encontrada.');
      return data as FiscalNote;
    };
    if (action === 'note_emit') {
      const t = (body.taker ?? {}) as Record<string, unknown>;
      let name = str(t.name, 115), doc = str(t.document, 20), email = str(t.email, 120);
      const contactId = str(body.contact_id, 64) || null;
      if (contactId) {
        const { data: c } = await db.from('contacts').select('name, document, email').eq('company_id', me.companyId).eq('id', contactId).maybeSingle();
        if (c) { name ||= c.name; doc ||= c.document ?? ''; email ||= c.email ?? ''; if (doc && doc.replace(/\D/g, '') !== c.document) await db.from('contacts').update({ document: doc.replace(/\D/g, '') }).eq('id', contactId); }
      }
      if (!name) throw bad('Informe o nome do cliente (tomador).');
      const n = await emitNote(b, { contactId, saleId: str(body.sale_id, 64) || null, chargeId: str(body.charge_id, 64) || null, amount: Number(body.amount), description: str(body.description, 2000), taker: { name, document: doc || null, email: email || null } }, actor);
      return json({ note: n }, 200, req);
    }
    if (action === 'note_sync') return json({ note: (await syncNote(await note())) ?? (await note()) }, 200, req);
    if (action === 'note_cancel') {
      const reason = str(body.reason, 255);
      if (reason.length < 15) throw bad('Escreva o motivo do cancelamento (pelo menos 15 caracteres).');
      return json({ note: await cancelNote(b, await note(), reason, actor) }, 200, req);
    }
    throw bad('Ação desconhecida.');
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError(e.status >= 500 ? 502 : 400, 'integracao', e.friendly);
    throw e;
  }
});
