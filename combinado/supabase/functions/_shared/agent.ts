// Turnos do agente: responder um cliente, executar comandos da equipe, resolver confirmações
// e o simulador do painel. Usado pelas funções "agent" (painel) e "whatsapp-webhook".
import { db, audit } from './db.ts';
import { runAgent, aiConfigured, aiErrorMessage, CUSTOMER_MODEL } from './ai.ts';
import { customerDynamic, customerSystem, ownerDynamic, ownerSystem, type Base } from './context.ts';
import { buildHistory } from './conversation.ts';
import { CUSTOMER_TOOLS, EXECUTORS, OWNER_TOOLS, type AgentCtx } from './tools.ts';
import type { ActionReceipt, Contact, Conversation, Role } from './types.ts';

export interface Member { userId: string; name: string; role: Role }
export interface TurnResult {
  reply: string;
  actions: ActionReceipt[];
  handoff: boolean;
  usage: { input: number; output: number };
  skipped?: string; // motivo para não responder (IA pausada, fora do horário, limite...)
}
const ZERO = { input: 0, output: 0 };

export const AUDIO_REPLY = 'Oi! Ainda não consigo ouvir áudios por aqui. Pode me mandar por escrito? 🙂';
const FAIL_REPLY = 'Desculpe, tive um probleminha para responder agora. Já chamei alguém da equipe para continuar com você. 🙏';

/** Uso do mês e limite do plano. */
export async function usageLeft(b: Base): Promise<number> {
  const month = new Date().toLocaleDateString('en-CA', { timeZone: b.tz }).slice(0, 7);
  const { data } = await db.from('usage_monthly').select('ai_replies').eq('company_id', b.company.id).eq('month', month).maybeSingle();
  return b.plan.ai_replies - (data?.ai_replies ?? 0);
}

export async function countUsage(b: Base, usage: { input: number; output: number }, replies = 1) {
  const { error } = await db.rpc('bump_usage', { p_company: b.company.id, p_ai: replies, p_in: usage.input, p_out: usage.output });
  if (error) console.error('uso', error.message);
}

/** A IA pode responder clientes agora? (ligada, assinatura ativa, horário escolhido e limite do plano) */
export async function customerGate(b: Base): Promise<string | null> {
  if (!aiConfigured()) return 'A IA não está configurada no servidor.';
  if (!b.ai.enabled) return 'A IA está pausada.';
  if (!b.writable) return 'A assinatura está inativa.';
  if (b.ai.schedule_mode !== 'sempre') {
    const now = new Date();
    const local = now.toLocaleString('en-CA', { timeZone: b.tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const wd = new Date(now.toLocaleDateString('en-CA', { timeZone: b.tz }) + 'T12:00:00Z').getUTCDay();
    const hm = local.slice(-5).replace('24:', '00:');
    const open = (b.company.business_hours?.[String(wd)] ?? []).some(([a, z]) => hm >= a && hm < z);
    if (b.ai.schedule_mode === 'fora_do_horario' && open) return 'Em horário comercial a equipe atende.';
    if (b.ai.schedule_mode === 'horario_comercial' && !open) return 'Fora do horário de atendimento da IA.';
  }
  if ((await usageLeft(b)) <= 0) return 'O limite de respostas da IA do plano acabou neste mês.';
  return null;
}

async function firstContact(conversationId: string): Promise<boolean> {
  const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('direction', 'out');
  return !count;
}

/** Responde o cliente (WhatsApp ou simulador). Não envia nada: devolve o texto e as ações. */
export async function customerTurn(b: Base, conv: Conversation, contact: Contact, channel: 'whatsapp' | 'simulador'): Promise<TurnResult> {
  const { history, unanswered } = await buildHistory(conv.id, 'cliente', b.tz);
  if (!history.length || history[history.length - 1].role !== 'user') return { reply: '', actions: [], handoff: false, usage: ZERO, skipped: 'Nada novo para responder.' };
  if (unanswered.length && unanswered.every((m) => m.media?.type === 'audio' && !m.body?.trim())) return { reply: AUDIO_REPLY, actions: [], handoff: false, usage: ZERO };

  const ctx: AgentCtx = { ...b, mode: 'cliente', channel, conversationId: conv.id, contact };
  try {
    const run = await runAgent({
      system: customerSystem(b), dynamic: await customerDynamic(b, contact, await firstContact(conv.id)),
      history, tools: CUSTOMER_TOOLS, ctx, effort: 'low', model: CUSTOMER_MODEL, webSearch: b.ai.web_search === true, maxTokens: 6000, maxSteps: 7,
    });
    const handoff = run.receipts.some((r) => r.tool === 'chamar_atendente');
    if (run.text) return { reply: run.text, actions: run.receipts, handoff, usage: run.usage };
    // recusa ou resposta vazia: passa para a equipe com um aviso educado
    await db.from('conversations').update({ handler: 'humano', needs_attention: true, attention_reason: run.refused ? 'A IA não pôde responder este assunto' : 'A IA não conseguiu responder' }).eq('id', conv.id);
    return { reply: handoff ? 'Vou chamar alguém da equipe para continuar com você, tudo bem? 🙂' : FAIL_REPLY, actions: run.receipts, handoff: true, usage: run.usage };
  } catch (e) {
    console.error('IA (cliente)', e);
    await db.from('conversations').update({ needs_attention: true, attention_reason: 'A IA ficou indisponível e não respondeu' }).eq('id', conv.id);
    return { reply: '', actions: [], handoff: true, usage: ZERO, skipped: aiErrorMessage(e) };
  }
}

const ATENDENTE_SEM = ['atualizar_servico', 'criar_servico', 'pausar_ia', 'lancar_conta', 'consultar_contas', 'baixar_conta', 'cadastrar_produto', 'cobrar_cliente', 'emitir_nota', 'consultar_cobrancas'];

/** Executa um pedido da equipe (pelo WhatsApp ou pelo assistente do painel). */
export async function ownerTurn(b: Base, conv: Conversation, member: Member, channel: 'whatsapp' | 'painel'): Promise<TurnResult> {
  if (!aiConfigured()) return { reply: 'A IA não está configurada no servidor (falta a chave ANTHROPIC_API_KEY).', actions: [], handoff: false, usage: ZERO };
  if ((await usageLeft(b)) <= 0) return { reply: 'O limite de respostas da IA do seu plano acabou neste mês. Mude de plano em Configurações → Assinatura para continuar usando os comandos.', actions: [], handoff: false, usage: ZERO };
  const { history } = await buildHistory(conv.id, 'dono', b.tz, 30);
  if (!history.length) return { reply: '', actions: [], handoff: false, usage: ZERO };
  const ctx: AgentCtx = { ...b, mode: 'dono', channel, conversationId: conv.id, member };
  const tools = member.role === 'atendente' ? OWNER_TOOLS.filter((t) => !ATENDENTE_SEM.includes(t.name)) : OWNER_TOOLS;
  try {
    const run = await runAgent({ system: ownerSystem(b), dynamic: ownerDynamic(b, member, channel), history, tools, ctx, effort: 'medium', maxTokens: 12000, maxSteps: 10 });
    const reply = run.text || (run.refused ? 'Não posso ajudar com esse pedido.' : run.receipts.length ? 'Pronto!' : 'Não entendi bem. Pode repetir de outro jeito?');
    return { reply, actions: run.receipts, handoff: false, usage: run.usage };
  } catch (e) {
    console.error('IA (dono)', e);
    return { reply: aiErrorMessage(e), actions: [], handoff: false, usage: ZERO };
  }
}

/** Confirma ou cancela uma ação pendente. Só quem pediu, o dono ou um gerente pode decidir. */
export async function resolvePending(b: Base, pendingId: string, approve: boolean, member: Member, channel: 'whatsapp' | 'painel'): Promise<{ conversationId: string | null; reply: string; actions: ActionReceipt[] }> {
  const { data: p } = await db.from('pending_actions').select('*').eq('id', pendingId).eq('company_id', b.company.id).maybeSingle();
  if (!p) return { conversationId: null, reply: 'Não encontrei esse pedido.', actions: [] };
  if (p.status !== 'pendente') return { conversationId: p.conversation_id, reply: `Esse pedido já foi ${p.status}.`, actions: [] };
  if (p.requested_by && p.requested_by !== member.userId && !['dono', 'gerente'].includes(member.role)) return { conversationId: p.conversation_id, reply: 'Só quem pediu, o dono ou um gerente pode confirmar este pedido.', actions: [] };
  if (Date.parse(p.expires_at) < Date.now()) {
    await db.from('pending_actions').update({ status: 'expirada', resolved_at: new Date().toISOString() }).eq('id', p.id);
    return finish(b, p, 'Esse pedido expirou (passou de 30 minutos). Se ainda quiser, é só pedir de novo.', { tool: p.tool, label: p.summary, status: 'cancelada', detail: 'expirou' }, 'cancelada');
  }
  // reserva o pedido antes de executar, para um clique duplo não executar duas vezes
  const { data: claimed } = await db.from('pending_actions').update({ status: approve ? 'confirmada' : 'cancelada', resolved_at: new Date().toISOString(), resolved_by: member.userId }).eq('id', p.id).eq('status', 'pendente').select('id').maybeSingle();
  if (!claimed) return { conversationId: p.conversation_id, reply: 'Esse pedido já foi resolvido.', actions: [] };

  if (!approve) {
    await audit({ company_id: b.company.id, actor_type: 'usuario', actor_name: member.name, actor_user_id: member.userId, channel: channel === 'whatsapp' ? 'whatsapp' : 'painel', action: p.tool, summary: `Cancelou o pedido: ${p.summary}`, target_type: 'pending_action', target_id: p.id, status: 'cancelado' });
    return finish(b, p, 'Tudo bem, não fiz nada.', { tool: p.tool, label: p.summary, status: 'cancelada' }, 'cancelada');
  }
  const ctx: AgentCtx = { ...b, mode: 'dono', channel, conversationId: p.conversation_id, member };
  const exec = EXECUTORS[p.tool];
  const r = exec ? await exec(ctx, p.args ?? {}) : { content: 'Ação desconhecida.', error: true };
  if (r.error) {
    await db.from('pending_actions').update({ status: 'erro' }).eq('id', p.id);
    return finish(b, p, `Não consegui concluir: ${r.content}`, { tool: p.tool, label: p.summary, status: 'erro', detail: r.content.slice(0, 120) }, 'erro');
  }
  return finish(b, p, r.content.replace(/ \(use enviar_orcamento.*\)$/, ''), r.receipt ?? { tool: p.tool, label: p.summary, status: 'ok' }, 'ok');
}

async function finish(b: Base, p: { id: string; conversation_id: string }, reply: string, receipt: ActionReceipt, status: ActionReceipt['status']) {
  // atualiza o recibo da mensagem que pediu a confirmação (os botões somem no painel)
  const { data: asked } = await db.from('messages').select('id, actions').eq('conversation_id', p.conversation_id).contains('actions', JSON.stringify([{ pending_id: p.id }])).limit(1); // jsonb: o filtro vai como texto JSON
  for (const m of asked ?? []) {
    const actions = (m.actions as ActionReceipt[]).map((a) => (a.pending_id === p.id ? { ...a, status } : a));
    await db.from('messages').update({ actions }).eq('id', m.id);
  }
  void b; // quem chamou registra a resposta na conversa (e manda pelo WhatsApp, se for o caso)
  return { conversationId: p.conversation_id, reply, actions: [receipt] };
}

/** Respostas "sim" / "não" escritas no WhatsApp para a única confirmação aberta da conversa. */
export function yesNo(text: string): boolean | null {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[!.]+$/, '');
  if (/^(sim|s|confirmo|confirma|confirmar|pode|pode sim|ok|isso|manda|fechado|beleza|claro)$/.test(t)) return true;
  if (/^(nao|n|cancela|cancelar|nao quero|deixa|esquece|para)$/.test(t)) return false;
  return null;
}
