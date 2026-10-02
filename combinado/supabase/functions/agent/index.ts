// Função "agent" (chamada pelo painel): assistente de comandos, confirmações, simulador do WhatsApp
// e sugestão de resposta para a equipe na caixa de conversas.
import { bad, json, readJson, serve, str } from '../_shared/http.ts';
import { caller, db } from '../_shared/db.ts';
import { loadBase } from '../_shared/context.ts';
import { countUsage, customerGate, customerTurn, ownerTurn, resolvePending, usageLeft, type Member } from '../_shared/agent.ts';
import { buildHistory, findOrCreateConversation, insertMessage } from '../_shared/conversation.ts';
import { aiConfigured, aiErrorMessage, complete, CUSTOMER_MODEL } from '../_shared/ai.ts';
import type { Contact } from '../_shared/types.ts';

serve(async (req) => {
  const me = await caller(req);
  const body = await readJson(req);
  const b = await loadBase(me.companyId, req.headers.get('origin'));
  const member: Member = { userId: me.userId, name: me.name, role: me.role };

  switch (body.action) {
    /* ---------- assistente de comandos do painel ---------- */
    case 'assistant': {
      const text = str(body.text, 2000);
      if (!text) throw bad('Escreva o que você precisa.');
      const conv = await findOrCreateConversation({ companyId: me.companyId, kind: 'dono', channel: 'painel', memberUserId: me.userId });
      await insertMessage({ company_id: me.companyId, conversation_id: conv.id, direction: 'in', sender: 'dono', sender_name: me.name, body: text, channel: 'painel' });
      const r = await ownerTurn(b, conv, member, 'painel');
      if (r.usage.input) await countUsage(b, r.usage);
      await insertMessage({ company_id: me.companyId, conversation_id: conv.id, direction: 'out', sender: 'ia', sender_name: 'ORBYTA', body: r.reply, actions: r.actions.length ? r.actions : null, channel: 'painel' });
      const pendingId = r.actions.find((a) => a.status === 'aguardando' && a.pending_id)?.pending_id;
      const { data: pending } = pendingId ? await db.from('pending_actions').select('*').eq('id', pendingId).single() : { data: null };
      return json({ conversation_id: conv.id, reply: r.reply, actions: r.actions, pending }, 200, req);
    }

    /* ---------- botões Confirmar / Cancelar ---------- */
    case 'resolve': {
      const r = await resolvePending(b, str(body.pending_id, 64), body.approve === true, member, 'painel');
      if (r.conversationId) await insertMessage({ company_id: me.companyId, conversation_id: r.conversationId, direction: 'out', sender: 'ia', sender_name: 'ORBYTA', body: r.reply, actions: r.actions.length ? r.actions : null, channel: 'painel' });
      return json({ conversation_id: r.conversationId, reply: r.reply, actions: r.actions }, 200, req);
    }

    /* ---------- simulador: conversa de teste como se fosse um cliente ---------- */
    case 'simulate': {
      const name = str(body.name, 80) || 'Cliente de teste';
      let contact = await simContact(me.companyId);
      if (body.reset === true || !contact) contact = await resetSim(me.companyId, contact, name);
      const conv = await findOrCreateConversation({ companyId: me.companyId, kind: 'cliente', channel: 'simulador', contactId: contact.id });
      const text = str(body.text, 2000);
      if (!text) return json({ conversation_id: conv.id, reply: '', actions: [] }, 200, req);
      await insertMessage({ company_id: me.companyId, conversation_id: conv.id, direction: 'in', sender: 'contato', sender_name: contact.name, body: text, channel: 'simulador' });
      if (conv.handler === 'humano') {
        return json({ conversation_id: conv.id, reply: '', actions: [], handoff: true, note: 'A conversa foi passada para a equipe. Reinicie o simulador para testar de novo.' }, 200, req);
      }
      const gate = await customerGate({ ...b, ai: { ...b.ai, enabled: true, schedule_mode: 'sempre' } }); // no simulador a IA sempre responde
      if (gate) {
        await insertMessage({ company_id: me.companyId, conversation_id: conv.id, direction: 'out', sender: 'sistema', body: gate, channel: 'simulador' });
        return json({ conversation_id: conv.id, reply: '', actions: [], note: gate }, 200, req);
      }
      const r = await customerTurn(b, conv, contact, 'simulador');
      if (r.usage.input) await countUsage(b, r.usage);
      if (r.reply) await insertMessage({ company_id: me.companyId, conversation_id: conv.id, direction: 'out', sender: 'ia', sender_name: b.ai.assistant_name || 'IA', body: r.reply, actions: r.actions.length ? r.actions : null, channel: 'simulador' });
      return json({ conversation_id: conv.id, reply: r.reply, actions: r.actions, handoff: r.handoff, note: r.skipped }, 200, req);
    }

    /* ---------- sugestão de resposta para a equipe ---------- */
    case 'suggest': {
      if (!aiConfigured()) throw bad('A IA não está configurada no servidor.');
      if ((await usageLeft(b)) <= 0) throw bad('O limite de respostas da IA do plano acabou neste mês.');
      const { data: conv } = await db.from('conversations').select('id, contact_id, kind').eq('id', str(body.conversation_id, 64)).eq('company_id', me.companyId).maybeSingle();
      if (!conv || conv.kind !== 'cliente') throw bad('Conversa não encontrada.');
      const { history } = await buildHistory(conv.id, 'cliente', b.tz, 30);
      if (!history.length) throw bad('Ainda não há mensagens do cliente.');
      try {
        const sys = `Você ajuda a equipe da ${b.company.name} a responder clientes no WhatsApp. Escreva UMA sugestão de resposta curta (até 3 frases), em português do Brasil, no tom ${b.ai.tone}, para a equipe enviar agora. Use só fatos da conversa e da tabela abaixo; se faltar informação, sugira uma pergunta ao cliente. Responda apenas com o texto da mensagem, sem aspas.\n\nServiços: ${b.services.map((s) => `${s.name} (${s.price_type === 'sob_consulta' ? 'sob consulta' : `${s.price_type === 'a_partir_de' ? 'a partir de ' : ''}R$ ${s.price}`})`).join('; ')}\nRegras da empresa: ${b.ai.instructions || '—'}`;
        const last = history[history.length - 1];
        const hist = last.role === 'user' ? history : [...history, { role: 'user' as const, content: '(Sugira a próxima mensagem da equipe para continuar a conversa.)' }];
        const r = await complete({ system: sys, history: hist, effort: 'low', model: CUSTOMER_MODEL, maxTokens: 3000 });
        await countUsage(b, r.usage);
        return json({ text: r.text || 'Olá! Como posso ajudar?' }, 200, req);
      } catch (e) {
        throw bad(aiErrorMessage(e));
      }
    }
  }
  throw bad('Ação desconhecida.');
});

/** O cliente de teste do simulador (um por empresa, marcado com a etiqueta "simulador"). */
async function simContact(companyId: string): Promise<Contact | null> {
  const { data } = await db.from('contacts').select('*').eq('company_id', companyId).contains('tags', ['simulador']).limit(1);
  return (data?.[0] as Contact | undefined) ?? null;
}

/** Apaga a conversa de teste e o que a IA criou nela (horários e orçamentos) e começa de novo. */
async function resetSim(companyId: string, old: Contact | null, name: string): Promise<Contact> {
  if (old) {
    await db.from('appointments').delete().eq('contact_id', old.id);
    await db.from('contacts').delete().eq('id', old.id); // orçamentos e conversas vão junto
  }
  const { data, error } = await db.from('contacts').insert({ company_id: companyId, name, tags: ['simulador'], source: 'outro', created_via: 'painel', notes: 'Cliente de teste do simulador. Some ao reiniciar.' }).select('*').single();
  if (error) throw new Error(error.message);
  return data as Contact;
}
