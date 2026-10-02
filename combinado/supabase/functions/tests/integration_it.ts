// Roda pelo teste de integração (supabase/tests/functions.it.test.ts), que sobe Postgres + PostgREST
// e passa SUPABASE_URL, a chave de serviço e a empresa de teste. Aqui as ferramentas agem no banco de verdade.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

const { loadBase } = await import('../_shared/context.ts');
const { CUSTOMER_TOOLS, OWNER_TOOLS } = await import('../_shared/tools.ts');
const { customerTurn, ownerTurn, resolvePending } = await import('../_shared/agent.ts');
const { buildHistory, findOrCreateContact, findOrCreateConversation, insertMessage } = await import('../_shared/conversation.ts');
const { __setClientForTests } = await import('../_shared/ai.ts');
const { db } = await import('../_shared/db.ts');
const { addDays, localDate } = await import('../_shared/format.ts');

type AnyTool = { name: string; run: (i: Record<string, unknown>, c: never) => Promise<{ content: string; error?: boolean; receipt?: { status: string; label: string; pending_id?: string } }> };
const CID = Deno.env.get('IT_COMPANY_ID')!;
const UID = Deno.env.get('IT_USER_ID')!;
const TZ = 'America/Sao_Paulo';
const DAY = addDays(localDate(new Date(), TZ), 3);
const tool = (list: unknown[], name: string) => (list as AnyTool[]).find((t) => t.name === name)!;
const run = (list: unknown[], name: string, input: Record<string, unknown>, ctx: unknown) => tool(list, name).run(input, ctx as never);
const opts = { sanitizeOps: false, sanitizeResources: false };
// a formatação brasileira usa espaço inseparável em "R$ 1,00"
const has = (text: string, part: string) => assertStringIncludes(text.replace(/\u00a0/g, ' '), part);
const member = { userId: UID, name: 'Ana Duarte', role: 'dono' as const };

function fakeClaude(script: { stop_reason: string; content: Record<string, unknown>[] }[]) {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  __setClientForTests({ beta: { messages: { create: (p: Record<string, unknown>) => { calls.push(structuredClone(p)); const r = script[Math.min(i++, script.length - 1)]; return Promise.resolve({ ...r, usage: { input_tokens: 10, output_tokens: 5 } }); } } } });
  return calls;
}

Deno.test({ name: 'cliente: horários, agendamento, conflito, remarcação, orçamento, cadastro, presença e passagem para a equipe', ...opts, fn: async () => {
  const b = await loadBase(CID, 'https://combinado.test');
  const { contact } = await findOrCreateContact(CID, '5561912345678', 'Juliana Ribeiro');
  const conv = await findOrCreateConversation({ companyId: CID, kind: 'cliente', channel: 'whatsapp', contactId: contact.id });
  const ctx = { ...b, mode: 'cliente', channel: 'whatsapp', conversationId: conv.id, contact };
  const sofa = b.services.find((s) => s.name.startsWith('Limpeza de sofá 3'))!;

  let r = await run(CUSTOMER_TOOLS, 'consultar_horarios', { data: DAY, servico_id: sofa.id }, ctx);
  assertStringIncludes(r.content, '08:00');
  r = await run(CUSTOMER_TOOLS, 'agendar_horario', { servico_id: sofa.id, data: DAY, hora: '14:00', nome: 'Juliana Ribeiro', endereco: 'SQS 308 Bloco C' }, ctx);
  assert(!r.error, r.content);
  assertEquals(r.receipt?.label, 'Horário agendado');
  r = await run(CUSTOMER_TOOLS, 'agendar_horario', { servico_id: sofa.id, data: DAY, hora: '15:00' }, ctx);
  assert(r.error, 'deveria recusar horário sobreposto');
  r = await run(CUSTOMER_TOOLS, 'consultar_horarios', { data: DAY, servico_id: sofa.id }, ctx);
  assert(!/\b13:00\b|\b14:00\b|\b15:00\b/.test(r.content), r.content); // serviço de 2h: 13h e 15h também colidem

  r = await run(CUSTOMER_TOOLS, 'meus_horarios', {}, ctx);
  const apptId = r.content.match(/\[([0-9a-f-]{36})\]/)![1];
  r = await run(CUSTOMER_TOOLS, 'remarcar_horario', { agendamento_id: apptId, data: DAY, hora: '16:00' }, ctx);
  assert(!r.error, r.content);
  const { data: appt } = await db.from('appointments').select('starts_at, address, created_via, status').eq('id', apptId).single();
  assertEquals(new Date(appt!.starts_at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }), '16:00');
  assertEquals([appt!.address, appt!.created_via, appt!.status], ['SQS 308 Bloco C', 'ia_cliente', 'confirmado']);

  r = await run(CUSTOMER_TOOLS, 'criar_orcamento', { itens: [{ servico_id: sofa.id }], desconto_percentual: 5 }, ctx);
  assert(!r.error, r.content);
  assertStringIncludes(r.content, 'https://combinado.test/orcamento/#');
  const { data: quote } = await db.from('quotes').select('number, total, discount, status, created_via').eq('contact_id', contact.id).single();
  assertEquals([Number(quote!.total), Number(quote!.discount), quote!.status, quote!.created_via], [171, 9, 'enviado', 'ia_cliente']);
  r = await run(CUSTOMER_TOOLS, 'criar_orcamento', { itens: [{ servico_id: sofa.id }], desconto_percentual: 15 }, ctx);
  assert(r.error && /acima do permitido/.test(r.content), r.content);

  r = await run(CUSTOMER_TOOLS, 'atualizar_cadastro', { email: 'ju@exemplo.com' }, ctx);
  assert(!r.error);
  r = await run(CUSTOMER_TOOLS, 'confirmar_presenca', { agendamento_id: apptId }, ctx);
  assert(!r.error, r.content);
  r = await run(CUSTOMER_TOOLS, 'chamar_atendente', { motivo: 'Quer negociar o preço' }, ctx);
  assert(!r.error);
  const { data: c2 } = await db.from('conversations').select('handler, needs_attention, attention_reason').eq('id', conv.id).single();
  assertEquals(c2, { handler: 'humano', needs_attention: true, attention_reason: 'Quer negociar o preço' });
  const { data: notes } = await db.from('appointments').select('notes').eq('id', apptId).single();
  assertStringIncludes(notes!.notes ?? '', 'Cliente confirmou presença');
  const { data: audits } = await db.from('audit_log').select('action').eq('company_id', CID).eq('channel', 'ia_cliente');
  const actions = (audits ?? []).map((a) => a.action);
  for (const a of ['agendar', 'remarcar', 'criar_orcamento', 'confirmar_presenca', 'chamar_atendente']) assert(actions.includes(a), `faltou ${a} no histórico`);
}});

Deno.test({ name: 'dono: cadastro, orçamento, confirmações, venda, agenda, tarefas, serviço, resumo e pausa da IA', ...opts, fn: async () => {
  const b = await loadBase(CID, 'https://combinado.test');
  const conv = await findOrCreateConversation({ companyId: CID, kind: 'dono', channel: 'painel', memberUserId: UID });
  const ctx = { ...b, mode: 'dono', channel: 'painel', conversationId: conv.id, member };

  let r = await run(OWNER_TOOLS, 'cadastrar_cliente', { nome: 'Maria Souza', telefone: '61 99999-9999' }, ctx);
  assert(!r.error, r.content);
  assertEquals(r.receipt?.label, 'Cliente Maria cadastrado');
  r = await run(OWNER_TOOLS, 'cadastrar_cliente', { nome: 'Maria S.', telefone: '(61) 99999-9999' }, ctx);
  assertStringIncludes(r.content, 'Já existe');
  r = await run(OWNER_TOOLS, 'buscar_clientes', { busca: 'maria' }, ctx);
  const maria = r.content.match(/\[([0-9a-f-]{36})\] Maria Souza/)![1];

  r = await run(OWNER_TOOLS, 'criar_orcamento', { cliente_id: maria, itens: [{ descricao: 'Limpeza completa', valor_unitario: 350 }] }, ctx);
  assert(!r.error, r.content);
  has(r.receipt!.label, 'de R$ 350,00 criado');
  r = await run(OWNER_TOOLS, 'criar_orcamento', { cliente_id: maria, itens: [{ descricao: 'Pacote', valor_unitario: 500 }], desconto_percentual: 20 }, ctx);
  assertEquals(r.receipt?.status, 'aguardando');
  let res = await resolvePending(b, r.receipt!.pending_id!, true, member, 'painel');
  has(res.reply, 'R$ 400,00');

  r = await run(OWNER_TOOLS, 'registrar_venda', { valor: 1200, metodo: 'pix', cliente_id: maria, descricao: 'Limpeza do condomínio' }, ctx);
  assertEquals(r.receipt?.status, 'aguardando');
  const pid = r.receipt!.pending_id!;
  res = await resolvePending(b, pid, true, member, 'painel');
  assertEquals(res.actions[0].status, 'ok');
  res = await resolvePending(b, pid, true, member, 'painel');
  assertStringIncludes(res.reply, 'já foi');
  const { data: mc } = await db.from('contacts').select('total_spent, stage').eq('id', maria).single();
  assertEquals([Number(mc!.total_spent), mc!.stage], [1200, 'fechado']);

  r = await run(OWNER_TOOLS, 'consultar_agenda', { data_inicio: DAY }, ctx);
  assertStringIncludes(r.content, 'Juliana Ribeiro');
  const apptId = r.content.match(/\[([0-9a-f-]{36})\]/)![1];
  r = await run(OWNER_TOOLS, 'cancelar_horario', { agendamento_id: apptId, motivo: 'chuva' }, ctx);
  res = await resolvePending(b, r.receipt!.pending_id!, false, member, 'painel');
  assertEquals(res.actions[0].status, 'cancelada');
  const { data: still } = await db.from('appointments').select('status').eq('id', apptId).single();
  assertEquals(still!.status, 'confirmado');

  r = await run(OWNER_TOOLS, 'agendar_horario', { cliente_id: maria, titulo: 'Visita técnica', data: DAY, hora: '16:30', duracao_min: 30 }, ctx);
  assert(r.error, 'deveria avisar do conflito com o horário da Juliana');
  r = await run(OWNER_TOOLS, 'agendar_horario', { cliente_id: maria, titulo: 'Visita técnica', data: DAY, hora: '16:30', duracao_min: 30, encaixar: true }, ctx);
  assert(!r.error, r.content);

  r = await run(OWNER_TOOLS, 'listar_orcamentos', {}, ctx);
  assertStringIncludes(r.content, 'Maria Souza');
  r = await run(OWNER_TOOLS, 'criar_tarefa', { titulo: 'Comprar produto', data: DAY, hora: '10:00' }, ctx);
  assert(!r.error, r.content);
  r = await run(OWNER_TOOLS, 'listar_tarefas', {}, ctx);
  const taskId = r.content.match(/\[([0-9a-f-]{36})\] Comprar produto/)![1];
  r = await run(OWNER_TOOLS, 'concluir_tarefa', { tarefa_id: taskId }, ctx);
  assert(!r.error);

  const svc = b.services[0];
  r = await run(OWNER_TOOLS, 'atualizar_servico', { servico_id: svc.id, preco: 200 }, ctx);
  res = await resolvePending(b, r.receipt!.pending_id!, true, member, 'painel');
  const { data: s2 } = await db.from('services').select('price').eq('id', svc.id).single();
  assertEquals(Number(s2!.price), 200);

  r = await run(OWNER_TOOLS, 'resumo', { periodo: 'hoje' }, ctx);
  has(r.content, 'Vendas: 1 · R$');
  r = await run(OWNER_TOOLS, 'conversas_pendentes', {}, ctx);
  assertStringIncludes(r.content, 'Juliana Ribeiro');
  r = await run(OWNER_TOOLS, 'pausar_ia', { pausar: true }, ctx);
  const { data: ai } = await db.from('ai_settings').select('enabled').eq('company_id', CID).single();
  assertEquals(ai!.enabled, false);
  await run(OWNER_TOOLS, 'pausar_ia', { pausar: false }, ctx);
  r = await run(OWNER_TOOLS, 'enviar_orcamento', { numero: 2 }, ctx);
  assert(r.error && /não está conectado/.test(r.content) && /orcamento\/#/.test(r.content), r.content);
}});

Deno.test({ name: 'agente completo: o cliente pede um horário e a IA consulta, agenda e responde', ...opts, fn: async () => {
  const b = await loadBase(CID, 'https://combinado.test');
  const { contact } = await findOrCreateContact(CID, '5561955554444', 'Pedro Lima');
  const conv = await findOrCreateConversation({ companyId: CID, kind: 'cliente', channel: 'whatsapp', contactId: contact.id });
  await insertMessage({ company_id: CID, conversation_id: conv.id, direction: 'in', sender: 'contato', sender_name: 'Pedro Lima', body: 'Quero limpar meu colchão, pode ser às 10h?', channel: 'whatsapp' });
  const colchao = b.services.find((s) => s.name.startsWith('Higienização de colchão'))!;
  const calls = fakeClaude([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'consultar_horarios', input: { data: DAY, servico_id: colchao.id } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'agendar_horario', input: { servico_id: colchao.id, data: DAY, hora: '10:00', nome: 'Pedro Lima', endereco: 'Rua das Flores, 10' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Prontinho, Pedro! Agendado às 10h.' }] },
  ]);
  const t = await customerTurn(b, conv, contact, 'whatsapp');
  assertEquals(t.reply, 'Prontinho, Pedro! Agendado às 10h.');
  assertEquals(t.actions.map((a) => a.label), ['Horário agendado']);
  const first = calls[0] as { system: { text: string }[]; messages: { role: string }[]; tools: { name: string }[] };
  assertStringIncludes(first.system[0].text, colchao.id);
  assertStringIncludes(first.system[1].text, 'Pedro Lima');
  assertEquals(first.tools.map((x) => x.name).includes('agendar_horario'), true);
  const second = calls[1] as { messages: { role: string; content: { type: string; content?: string }[] }[] };
  assertStringIncludes(second.messages[second.messages.length - 1].content[0].content ?? '', '10:00');
  const { data: appts } = await db.from('appointments').select('created_via, address').eq('contact_id', contact.id);
  assertEquals(appts, [{ created_via: 'ia_cliente', address: 'Rua das Flores, 10' }]);
}});

Deno.test({ name: 'dono pelo agente: a venda vira confirmação e o recibo da mensagem muda depois', ...opts, fn: async () => {
  const b = await loadBase(CID, 'https://combinado.test');
  const conv = await findOrCreateConversation({ companyId: CID, kind: 'dono', channel: 'painel', memberUserId: UID });
  await insertMessage({ company_id: CID, conversation_id: conv.id, direction: 'in', sender: 'dono', sender_name: 'Ana', body: 'Registra uma venda de 300 no dinheiro', channel: 'painel' });
  fakeClaude([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'v1', name: 'registrar_venda', input: { valor: 300, metodo: 'dinheiro', descricao: 'Balcão' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Confirma o registro de R$ 300,00 no dinheiro?' }] },
  ]);
  const t = await ownerTurn(b, conv, member, 'painel');
  const pending = t.actions.find((a) => a.status === 'aguardando')!;
  assert(pending?.pending_id);
  const msg = await insertMessage({ company_id: CID, conversation_id: conv.id, direction: 'out', sender: 'ia', sender_name: 'ORBYTA', body: t.reply, actions: t.actions, channel: 'painel' });
  await resolvePending(b, pending.pending_id!, true, member, 'painel');
  const { data: after } = await db.from('messages').select('actions').eq('id', msg.id).single();
  assertEquals((after!.actions as { status: string }[])[0].status, 'ok');
  const { data: sale } = await db.from('sales').select('amount, origin, method').eq('company_id', CID).eq('description', 'Balcão').single();
  assertEquals([Number(sale!.amount), sale!.origin, sale!.method], [300, 'balcao', 'dinheiro']);
}});

Deno.test({ name: 'dono: financeiro e estoque pelos comandos (conta mensal, baixa com confirmação, entrada e saída)', ...opts, fn: async () => {
  const b = await loadBase(CID);
  const conv = await findOrCreateConversation({ companyId: CID, kind: 'dono', channel: 'painel', memberUserId: UID });
  const ctx = { ...b, mode: 'dono', channel: 'painel', conversationId: conv.id, member };
  let r = await run(OWNER_TOOLS, 'lancar_conta', { tipo: 'pagar', descricao: 'Aluguel da sala', valor: 1800, vencimento: DAY, categoria: 'Aluguel', mensal: true }, ctx);
  assert(!r.error, r.content);
  r = await run(OWNER_TOOLS, 'consultar_contas', { filtro: 'abertas', tipo: 'pagar' }, ctx);
  has(r.content, 'Aluguel da sala · R$ 1.800,00');
  const contaId = r.content.match(/\[([0-9a-f-]{36})\] A PAGAR · Aluguel da sala/)![1];
  r = await run(OWNER_TOOLS, 'baixar_conta', { conta_id: contaId, metodo: 'pix' }, ctx);
  assertEquals(r.receipt?.status, 'aguardando');
  const res = await resolvePending(b, r.receipt!.pending_id!, true, member, 'painel');
  assertEquals(res.actions[0].status, 'ok');
  const { data: rows } = await db.from('finance_entries').select('due_date, paid_at').eq('company_id', CID).eq('description', 'Aluguel da sala').order('due_date');
  assertEquals(rows!.map((x) => !!x.paid_at), [true, false]); // a do mês seguinte já ficou lançada

  r = await run(OWNER_TOOLS, 'cadastrar_produto', { nome: 'Removedor de manchas 1L', unidade: 'frasco', saldo: 5, minimo: 3 }, ctx);
  assert(!r.error, r.content);
  r = await run(OWNER_TOOLS, 'consultar_estoque', { busca: 'removedor' }, ctx);
  const prodId = r.content.match(/\[([0-9a-f-]{36})\]/)![1];
  r = await run(OWNER_TOOLS, 'movimentar_estoque', { produto_id: prodId, tipo: 'saida', quantidade: 9 }, ctx);
  assert(r.error); has(r.content, 'Estoque insuficiente');
  r = await run(OWNER_TOOLS, 'movimentar_estoque', { produto_id: prodId, tipo: 'saida', quantidade: 3, observacao: 'Serviço do condomínio' }, ctx);
  has(r.content, 'Saldo agora: 2 frasco');
  r = await run(OWNER_TOOLS, 'consultar_estoque', {}, ctx);
  has(r.content, 'REPOR');
  const { data: n } = await db.from('notifications').select('title').eq('company_id', CID).eq('kind', 'estoque');
  assertEquals(n!.map((x) => x.title), ['Estoque baixo: Removedor de manchas 1L']);
}});

Deno.test({ name: 'histórico: conversa iniciada pela empresa ganha um turno inicial do cliente', ...opts, fn: async () => {
  const { contact } = await findOrCreateContact(CID, '5561933332222', 'Bianca');
  const conv = await findOrCreateConversation({ companyId: CID, kind: 'cliente', channel: 'whatsapp', contactId: contact.id });
  await insertMessage({ company_id: CID, conversation_id: conv.id, direction: 'out', sender: 'ia', sender_name: 'Lembrete', body: 'Olá, Bianca! Lembrete do seu horário amanhã às 9h. Responda SIM para confirmar.', channel: 'whatsapp' });
  await insertMessage({ company_id: CID, conversation_id: conv.id, direction: 'in', sender: 'contato', sender_name: 'Bianca', body: 'SIM', channel: 'whatsapp' });
  const { history, unanswered } = await buildHistory(conv.id, 'cliente', TZ);
  assertEquals(history.map((h) => h.role), ['user', 'assistant', 'user']);
  assertEquals(unanswered.length, 1);
}});

/* ---------- WhatsApp de ponta a ponta (API da Meta simulada) e automações ---------- */
Deno.env.set('META_APP_SECRET', 'segredo-do-app');
Deno.env.set('META_VERIFY_TOKEN', 'token-verificacao');
Deno.env.set('WA_DEBOUNCE_MS', '0');
Deno.env.set('CRON_SECRET', 'segredo-cron');
const { handleWebhook } = await import('../whatsapp-webhook/handler.ts');
const { runCron } = await import('../cron/handler.ts');

const graph: { url: string; body: Record<string, any> }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://graph.facebook.com/')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    graph.push({ url, body });
    return Promise.resolve(Response.json(body.status === 'read' ? { success: true } : { messages: [{ id: `wamid.out${graph.length}` }] }));
  }
  return realFetch(input, init);
}) as typeof fetch;

async function post(payload: unknown, secret = 'segredo-do-app') {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, raw)), (b) => b.toString(16).padStart(2, '0')).join('');
  return handleWebhook(new Request('http://local/whatsapp-webhook', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': `sha256=${sig}` } }));
}
const wa = (from: string, name: string, message: Record<string, unknown>) => ({
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1001' }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, timestamp: '1790000000', ...message }] } }] }],
});

Deno.test({ name: 'WhatsApp: cliente escreve, a IA responde pelo número da empresa', ...opts, fn: async () => {
  await db.from('whatsapp_accounts').upsert({ company_id: CID, phone_number_id: '1001', waba_id: '2002', display_phone: '5561999990000', status: 'conectado' });
  await db.from('whatsapp_credentials').upsert({ company_id: CID, access_token: 'token-da-meta' });

  const verify = await handleWebhook(new Request('http://local/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=token-verificacao&hub.challenge=4242'));
  assertEquals(await verify.text(), '4242');
  assertEquals((await post(wa('5561977776666', 'Carlos', { id: 'x', type: 'text', text: { body: 'oi' } }), 'outro-segredo')).status, 401);

  fakeClaude([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi, Carlos! A limpeza de sofá de 3 lugares fica a partir de R$ 180.' }] }]);
  const res = await post(wa('5561977776666', 'Carlos Mendes', { id: 'wamid.in1', type: 'text', text: { body: 'Oi, quanto custa limpar sofá?' } }));
  assertEquals(res.status, 200);
  assert(graph.some((c) => c.body.status === 'read' && c.body.message_id === 'wamid.in1' && c.body.typing_indicator), 'marcou como lida com "digitando"');
  const sent = graph.filter((c) => c.body.type === 'text').at(-1)!;
  assertEquals([sent.url.endsWith('/1001/messages'), sent.body.to], [true, '5561977776666']);
  has(sent.body.text.body, 'a partir de R$ 180');
  const { data: contact } = await db.from('contacts').select('id, name, wa_name, source').eq('company_id', CID).eq('phone', '5561977776666').single();
  assertEquals([contact!.name, contact!.wa_name, contact!.source], ['Carlos Mendes', 'Carlos Mendes', 'whatsapp']);
  const { data: msgs } = await db.from('messages').select('direction, sender, wa_message_id, wa_status, response_seconds').eq('company_id', CID).in('wa_message_id', ['wamid.in1', sent.body && `wamid.out${graph.indexOf(sent) + 1}`]).order('created_at');
  assertEquals(msgs!.map((m) => [m.direction, m.sender]), [['in', 'contato'], ['out', 'ia']]);
  assertEquals(msgs![1].wa_status, 'enviada');
  assert(Number(msgs![1].response_seconds) >= 0);

  // a Meta reentrega o mesmo aviso: ignorado
  await post(wa('5561977776666', 'Carlos Mendes', { id: 'wamid.in1', type: 'text', text: { body: 'Oi, quanto custa limpar sofá?' } }));
  const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('wa_message_id', 'wamid.in1');
  assertEquals(count, 1);

  // status de leitura da resposta
  const outId = msgs![1].wa_message_id;
  await post({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1001' }, statuses: [{ id: outId, status: 'read', recipient_id: '5561977776666' }] } }] }] });
  await post({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1001' }, statuses: [{ id: outId, status: 'delivered', recipient_id: '5561977776666' }] } }] }] });
  const { data: st } = await db.from('messages').select('wa_status').eq('wa_message_id', outId).single();
  assertEquals(st!.wa_status, 'lida'); // "entregue" atrasado não volta o status
}});

Deno.test({ name: 'WhatsApp: o dono verifica o número com ATIVAR e confirma uma venda pelo botão', ...opts, fn: async () => {
  await db.from('owner_link_codes').insert({ code: '654321', company_id: CID, user_id: UID, expires_at: new Date(Date.now() + 600_000).toISOString() });
  await post(wa('5561988880000', 'Ana', { id: 'wamid.o1', type: 'text', text: { body: 'ATIVAR 654321' } }));
  has(graph.at(-1)!.body.text.body, 'Pronto, Ana!');
  const { data: m } = await db.from('members').select('phone, phone_verified_at').eq('user_id', UID).single();
  assertEquals(m!.phone, '5561988880000');
  assert(m!.phone_verified_at);

  fakeClaude([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'v', name: 'registrar_venda', input: { valor: 50, metodo: 'pix', descricao: 'Taxa de deslocamento' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Confirma o registro de R$ 50,00 no Pix?' }] },
  ]);
  await post(wa('5561988880000', 'Ana', { id: 'wamid.o2', type: 'text', text: { body: 'registra uma venda de 50 no pix, taxa de deslocamento' } }));
  const ask = graph.at(-1)!;
  assertEquals(ask.body.type, 'interactive');
  const ok = ask.body.interactive.action.buttons[0].reply;
  assertEquals(ok.title, 'Confirmar');
  await post(wa('5561988880000', 'Ana', { id: 'wamid.o3', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: ok.id, title: 'Confirmar' } } }));
  has(graph.at(-1)!.body.text.body, '✓ Venda de R$ 50,00 registrada');
  has(graph.at(-1)!.body.text.body, '✓ Painel atualizado');
  const { data: sale } = await db.from('sales').select('amount, method').eq('company_id', CID).eq('description', 'Taxa de deslocamento').single();
  assertEquals([Number(sale!.amount), sale!.method], [50, 'pix']);
}});

Deno.test({ name: 'automações: lembrete de horário sai uma vez, com o modelo aprovado fora da janela de 24h', ...opts, fn: async () => {
  const { contact } = await findOrCreateContact(CID, '5561966665555', 'Rita Alves');
  const start = new Date(Date.now() + 6 * 3600_000), end = new Date(start.getTime() + 3600_000);
  await db.from('appointments').insert({ company_id: CID, contact_id: contact.id, title: 'Limpeza de tapete', starts_at: start.toISOString(), ends_at: end.toISOString(), status: 'confirmado', created_via: 'painel', created_at: new Date(Date.now() - 2 * 86400_000).toISOString() });
  assertEquals((await runCron(new Request('http://local/cron', { method: 'POST' }))).status, 401);
  const res = await runCron(new Request('http://local/cron', { method: 'POST', headers: { 'x-cron-secret': 'segredo-cron' } }));
  const body = await res.json();
  assertEquals(body.sent.lembrete_agendamento, 1);
  const tpl = graph.filter((c) => c.body.type === 'template' && c.body.template.name === 'lembrete_agendamento');
  assertEquals(tpl.length, 1);
  const params = tpl[0].body.template.components[0].parameters.map((p: { text: string }) => p.text);
  assertEquals([params.length, params[0], params[1]], [4, 'Rita', 'Limpeza de tapete']);
  const again = await (await runCron(new Request('http://local/cron', { method: 'POST', headers: { 'x-cron-secret': 'segredo-cron' } }))).json();
  assertEquals(again.sent.lembrete_agendamento ?? 0, 0);
  const { data: runs } = await db.from('automation_runs').select('status, target_label').eq('company_id', CID).eq('kind', 'lembrete_agendamento');
  assertEquals(runs, [{ status: 'enviado', target_label: 'Rita Alves' }]);

  // orçamento enviado há 3 dias e sem resposta: acompanhamento automático com o link
  const { data: ju } = await db.from('contacts').select('id').eq('company_id', CID).eq('phone', '5561912345678').single();
  await db.from('quotes').update({ sent_at: new Date(Date.now() - 3 * 86400_000).toISOString() }).eq('contact_id', ju!.id).eq('status', 'enviado');
  const f = await (await runCron(new Request('http://local/cron', { method: 'POST', headers: { 'x-cron-secret': 'segredo-cron' } }))).json();
  assertEquals(f.sent.followup_orcamento, 1);
  const follow = graph.filter((c) => c.body.type === 'template' && c.body.template.name === 'acompanhamento_orcamento').at(-1)!;
  const fp = follow.body.template.components[0].parameters.map((p: { text: string }) => p.text);
  assertEquals([fp[0], fp.length], ['Juliana', 4]);
  assertStringIncludes(fp[3], 'https://combinado.test/orcamento/#');
}});

/* ---------- cobrança (Asaas da empresa) e nota fiscal (Focus NFe), com as APIs simuladas ---------- */
Deno.test({ name: 'cobrança: IA cobra com confirmação, o Asaas avisa o pagamento e vira venda; nota fiscal autorizada', ...opts, fn: async () => {
  const { handleChargeWebhook } = await import('../cobranca-webhook/index.ts');
  const { syncNote } = await import('../_shared/fiscal.ts');
  const calls: { url: string; method: string; body: Record<string, any> }[] = [];
  let focusStatus = 'processando_autorizacao';
  const prev = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.startsWith('https://api-sandbox.asaas.com/v3/')) {
      calls.push({ url, method: init?.method ?? 'GET', body });
      if (url.includes('/customers?cpfCnpj=')) return Promise.resolve(Response.json({ data: [] }));
      if (url.endsWith('/customers')) return Promise.resolve(Response.json({ id: 'cus_1' }));
      if (url.endsWith('/payments')) return Promise.resolve(Response.json({ id: 'pay_1', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' }));
      if (url.endsWith('/pixQrCode')) return Promise.resolve(Response.json({ payload: '00020126pixcopiaecola' }));
    }
    if (url.startsWith('https://homologacao.focusnfe.com.br/v2/nfse')) {
      calls.push({ url, method: init?.method ?? 'GET', body });
      if ((init?.method ?? 'GET') === 'POST') return Promise.resolve(Response.json({ status: 'processando_autorizacao' }, { status: 202 }));
      return Promise.resolve(Response.json(focusStatus === 'autorizado' ? { status: 'autorizado', numero: '123', codigo_verificacao: 'ABC', url: 'https://nfse.exemplo/123' } : { status: focusStatus }));
    }
    return prev(input, init);
  }) as typeof fetch;
  try {
    for (const r0 of [await db.from('integration_credentials').insert([{ company_id: CID, provider: 'asaas', api_key: 'chave-asaas-teste' }, { company_id: CID, provider: 'focusnfe', api_key: 'token-focus' }])]) assertEquals(r0.error, null);
    const ins = await db.from('company_integrations').insert([
      { company_id: CID, provider: 'asaas', environment: 'testes', config: {} },
      { company_id: CID, provider: 'focusnfe', environment: 'testes', config: { cnpj: '11222333000181', inscricao_municipal: '123', codigo_municipio: '5300108', item_lista_servico: '0702', aliquota: 2 } },
    ]);
    assertEquals(ins.error, null);
    const b = await loadBase(CID);
    const conv = await findOrCreateConversation({ companyId: CID, kind: 'dono', channel: 'painel', memberUserId: UID });
    const ctx = { ...b, mode: 'dono', channel: 'painel', conversationId: conv.id, member };
    const { contact } = await findOrCreateContact(CID, '5561977776666', 'Carlos Pagador');

    let r = await run(OWNER_TOOLS, 'cobrar_cliente', { cliente_id: contact.id, valor: 180, descricao: 'Limpeza de sofá' }, ctx);
    assert(r.error); has(r.content, 'CPF ou CNPJ');
    r = await run(OWNER_TOOLS, 'cobrar_cliente', { cliente_id: contact.id, valor: 180, descricao: 'Limpeza de sofá', cpf_cnpj: '529.982.247-25', enviar: false }, ctx);
    assertEquals(r.receipt?.status, 'aguardando', r.content);
    const res = await resolvePending(b, r.receipt!.pending_id!, true, member, 'painel');
    assertEquals(res.actions[0].status, 'ok');
    const { data: ch } = await db.from('charges').select('*').eq('company_id', CID).eq('description', 'Limpeza de sofá').single();
    assertEquals([ch!.provider_id, ch!.invoice_url, ch!.pix_code, ch!.status, Number(ch!.amount)], ['pay_1', 'https://sandbox.asaas.com/i/pay_1', '00020126pixcopiaecola', 'pendente', 180]);
    const pay = calls.find((x) => x.url.endsWith('/payments'))!;
    assertEquals([pay.body.customer, pay.body.billingType, pay.body.value, pay.body.externalReference], ['cus_1', 'UNDEFINED', 180, ch!.id]);
    const { data: doc } = await db.from('contacts').select('document').eq('id', contact.id).single();
    assertEquals(doc!.document, '52998224725');

    // aviso do Asaas: token errado é recusado; o certo vira venda (uma vez só)
    const { data: cred } = await db.from('integration_credentials').select('webhook_token').eq('company_id', CID).eq('provider', 'asaas').single();
    const hook = (token: string, id = 'evt_1') => handleChargeWebhook(new Request(`http://local/cobranca-webhook?empresa=${CID}`, { method: 'POST', headers: { 'asaas-access-token': token }, body: JSON.stringify({ id, event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', billingType: 'PIX', externalReference: ch!.id, clientPaymentDate: '2030-01-05' } }) }));
    assertEquals((await hook('errado')).status, 401);
    assertEquals((await hook(cred!.webhook_token)).status, 200);
    assertEquals((await hook(cred!.webhook_token)).status, 200);
    const { data: paid } = await db.from('charges').select('status, sale_id, finance_entry_id').eq('id', ch!.id).single();
    assertEquals(paid!.status, 'paga');
    const { data: sales } = await db.from('sales').select('amount, method').eq('company_id', CID).eq('description', 'Limpeza de sofá');
    assertEquals(sales!.map((s) => [Number(s.amount), s.method]), [[180, 'pix']]);
    const { data: fe } = await db.from('finance_entries').select('paid_at, sale_id').eq('id', paid!.finance_entry_id).single();
    assert(fe!.paid_at && fe!.sale_id === paid!.sale_id);

    // nota fiscal: vai para a prefeitura, fica processando e depois é autorizada
    r = await run(OWNER_TOOLS, 'emitir_nota', { cliente_id: contact.id, valor: 180, descricao: 'Limpeza de sofá 3 lugares', venda_id: paid!.sale_id }, ctx);
    const nres = await resolvePending(b, r.receipt!.pending_id!, true, member, 'painel');
    assertEquals(nres.actions[0].status, 'ok');
    const sent = calls.find((x) => x.method === 'POST' && x.url.includes('/v2/nfse?ref='))!;
    assertEquals([sent.body.tomador.cpf, sent.body.servico.valor_servicos, sent.body.prestador.codigo_municipio], ['52998224725', 180, '5300108']);
    const { data: note } = await db.from('fiscal_notes').select('*').eq('company_id', CID).single();
    assertEquals(note!.status, 'processando');
    focusStatus = 'autorizado';
    const done = await syncNote(note!);
    assertEquals([done!.status, done!.number, done!.pdf_url], ['autorizada', '123', 'https://nfse.exemplo/123']);
  } finally {
    globalThis.fetch = prev;
  }
}});
