// Função "whatsapp" (painel): conectar e desconectar o número, a equipe responder clientes e enviar orçamentos.
import { bad, forbidden, json, readJson, serve, str } from '../_shared/http.ts';
import { audit, caller, db, requireRole } from '../_shared/db.ts';
import { loadBase } from '../_shared/context.ts';
import { insertMessage, sendQuote } from '../_shared/conversation.ts';
import { ensureTemplates, exchangeCode, loadAccount, phoneInfo, registerNumber, sendText, subscribeApp, WaError, withinWindow } from '../_shared/whatsapp.ts';
import { normalizePhone } from '../_shared/format.ts';

serve(async (req) => {
  const me = await caller(req);
  const body = await readJson(req);

  switch (body.action) {
    case 'connect': {
      requireRole(me, 'dono', 'gerente');
      const phoneNumberId = str(body.phone_number_id, 40);
      const wabaId = str(body.waba_id, 40);
      let token = str(body.access_token, 2000);
      if (!/^\d{5,}$/.test(phoneNumberId) || !/^\d{5,}$/.test(wabaId) || !token) throw bad('Informe o ID do número, o ID da conta (WABA) e o token de acesso.');
      const { data: other } = await db.from('whatsapp_accounts').select('company_id').eq('phone_number_id', phoneNumberId).maybeSingle();
      if (other && other.company_id !== me.companyId) throw bad('Este número já está conectado a outra empresa.');
      try {
        // cadastro incorporado: o painel manda o código do login da Meta, que vira um token da empresa
        if (token.startsWith('code:')) token = await exchangeCode(token.slice(5));
        const info = await phoneInfo(phoneNumberId, token);
        await subscribeApp(wabaId, token); // a Meta passa a mandar as mensagens deste número para o nosso webhook
        if (body.pin || token !== str(body.access_token, 2000)) {
          // números novos do cadastro incorporado precisam ser registrados na Cloud API (PIN de 6 dígitos)
          const pin = /^\d{6}$/.test(str(body.pin)) ? str(body.pin) : String(Math.floor(100000 + Math.random() * 900000));
          try { await registerNumber(phoneNumberId, token, pin); } catch (e) {
            console.error('registrar número', (e as Error).message);
            if (body.pin) throw e; // a pessoa informou o PIN: mostra o motivo da recusa
          }
        }
        await db.from('whatsapp_credentials').upsert({ company_id: me.companyId, access_token: token });
        const { data: account, error } = await db.from('whatsapp_accounts').upsert({
          company_id: me.companyId, phone_number_id: phoneNumberId, waba_id: wabaId, display_phone: info.display_phone_number ? normalizePhone(info.display_phone_number) : null,
          verified_name: info.verified_name ?? null, status: 'conectado', last_error: null, connected_at: new Date().toISOString(),
        }).select('*').single();
        if (error) throw new Error(error.message);
        await audit({ company_id: me.companyId, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'conectar_whatsapp', summary: `Conectou o WhatsApp ${info.display_phone_number ?? phoneNumberId}` });
        // modelos de mensagem (lembrete, retorno, cobrança...): cadastrados na conta da clínica sem ela precisar fazer nada
        let templates: Awaited<ReturnType<typeof ensureTemplates>> = [];
        try { templates = await ensureTemplates(wabaId, token); } catch (e) { console.error('modelos', (e as Error).message); }
        return json({ account, templates }, 200, req);
      } catch (e) {
        if (e instanceof WaError) {
          await db.from('whatsapp_accounts').upsert({ company_id: me.companyId, status: 'erro', last_error: e.detail.slice(0, 300) });
          throw bad(e.code === 190 ? 'O token de acesso é inválido ou expirou.' : `A Meta recusou a conexão: ${e.detail.slice(0, 200)}`);
        }
        throw e;
      }
    }

    /* situação dos modelos de mensagem na Meta (e cadastra os que faltarem) */
    case 'templates': {
      requireRole(me, 'dono', 'gerente');
      const { data: acc } = await db.from('whatsapp_accounts').select('waba_id, status').eq('company_id', me.companyId).maybeSingle();
      const { data: cred } = await db.from('whatsapp_credentials').select('access_token').eq('company_id', me.companyId).maybeSingle();
      if (!acc?.waba_id || acc.status !== 'conectado' || !cred) throw bad('Conecte o WhatsApp primeiro.');
      try { return json({ templates: await ensureTemplates(acc.waba_id, cred.access_token) }, 200, req); }
      catch (e) { if (e instanceof WaError) throw bad(e.friendly); throw e; }
    }

    case 'disconnect': {
      requireRole(me, 'dono', 'gerente');
      await db.from('whatsapp_credentials').delete().eq('company_id', me.companyId);
      await db.from('whatsapp_accounts').update({ status: 'desconectado', connected_at: null }).eq('company_id', me.companyId);
      await audit({ company_id: me.companyId, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'desconectar_whatsapp', summary: 'Desconectou o WhatsApp da empresa' });
      return json({ ok: true }, 200, req);
    }

    /* a equipe responde um cliente pela caixa de conversas */
    case 'send': {
      const text = str(body.text, 4000);
      if (!text) throw bad('Escreva a mensagem.');
      const { data: conv } = await db.from('conversations').select('*').eq('id', str(body.conversation_id, 64)).eq('company_id', me.companyId).maybeSingle();
      if (!conv || conv.kind !== 'cliente') throw bad('Conversa não encontrada.');
      const { data: writable } = await db.rpc('company_writable', { cid: me.companyId });
      if (!writable) throw forbidden('A assinatura está inativa: reative para responder os clientes.');
      if (conv.channel === 'simulador') {
        await insertMessage({ company_id: me.companyId, conversation_id: conv.id, direction: 'out', sender: 'equipe', sender_name: me.name, body: text, channel: 'simulador' });
      } else {
        const { data: contact } = await db.from('contacts').select('phone').eq('id', conv.contact_id).single();
        if (!contact?.phone) throw bad('O cliente não tem telefone.');
        if (!withinWindow(conv.last_inbound_at)) throw bad('Já passaram 24 horas desde a última mensagem do cliente. O WhatsApp só permite escrever agora com um modelo aprovado (por exemplo, enviando um orçamento ou lembrete).');
        const acc = await loadAccount(me.companyId);
        if (!acc) throw bad('O WhatsApp da empresa não está conectado.');
        let waId = '';
        try { waId = await sendText(acc, contact.phone, text); } catch (e) { if (e instanceof WaError) throw bad(e.friendly); throw e; }
        await insertMessage({ company_id: me.companyId, conversation_id: conv.id, direction: 'out', sender: 'equipe', sender_name: me.name, body: text, wa_message_id: waId || null, wa_status: 'enviada', channel: 'whatsapp' });
        await db.rpc('bump_usage', { p_company: me.companyId, p_wa: 1 });
      }
      await db.from('conversations').update({ unread: 0, needs_attention: false, attention_reason: null }).eq('id', conv.id);
      return json({ ok: true }, 200, req);
    }

    case 'send_quote': {
      const b = await loadBase(me.companyId, str(body.origin, 200) || req.headers.get('origin'));
      if (!b.writable) throw forbidden('A assinatura está inativa: reative para enviar orçamentos.');
      const r = await sendQuote(b, str(body.quote_id, 64), { type: 'usuario', name: me.name, userId: me.userId, channel: 'painel' });
      return json(r, 200, req);
    }
  }
  throw bad('Ação desconhecida.');
});
