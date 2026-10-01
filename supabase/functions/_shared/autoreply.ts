// Chamado a cada mensagem nova do cliente (formulário ou e-mail).
// Assistente ligado: responde sozinho ou encaminha para uma pessoa. Desligado: só confirma e avisa o dono.
import { admin } from './common.ts';
import { decide, type ThreadMsg, type Ticket } from './ai.ts';
import { brandedHtml, notifyOwner, protocol, sendEmail, ticketSubject, TOPICS } from './mail.ts';

const MAX_AUTO = 3;
const WANTS_HUMAN = /\b(atendente|humano|humana|pessoa de verdade|falar com (algu[eé]m|uma pessoa|a equipe|o suporte|o dono)|suporte humano)\b/i;
const FOOTER_AUTO = 'Esta é uma resposta do assistente virtual do Quitaí. Quer falar com uma pessoa da equipe? Responda este e-mail escrevendo ATENDENTE.';

async function send(ticket: Ticket, text: string, footer: string, auto: boolean) {
  const sent = await sendEmail({
    to: [ticket.email],
    subject: `Re: ${ticketSubject(ticket.id, ticket.topic)}`,
    html: brandedHtml(text, `${footer}<br>Protocolo #${protocol(ticket.id)}.`),
    text: `${text}\n\n—\n${footer.replace(/<[^>]+>/g, '')}\nProtocolo #${protocol(ticket.id)}.`,
  });
  if (sent.ok) await admin.from('support_messages').insert({ ticket_id: ticket.id, direction: 'out', body: text, email_id: sent.id ?? null, auto });
  return sent.ok;
}

async function escalate(ticket: Ticket & { escalated?: boolean }, summary: string, reason: string, lastText: string) {
  await admin.from('support_tickets').update({ escalated: true, status: 'aberto', summary }).eq('id', ticket.id);
  const first = ticket.name.split(' ')[0];
  await send(ticket, `Olá, ${first}!\n\nEncaminhei sua mensagem para a nossa equipe. Uma pessoa vai responder por aqui, normalmente no mesmo dia útil.\n\nAbraço,\nEquipe Quitaí`, 'Para acrescentar algo, é só responder este e-mail.', true);
  await notifyOwner(
    `[Suporte Quitaí] Precisa de você: ${ticket.name} (#${protocol(ticket.id)})`,
    [['Resumo', summary], ['Motivo', reason], ['Nome', ticket.name], ['E-mail', ticket.email], ['Assunto', TOPICS[ticket.topic] ?? ticket.topic], ['Protocolo', `#${protocol(ticket.id)}`]],
    `Última mensagem do cliente:\n\n${lastText}`,
  );
}

export async function handleIncoming(ticketId: string, isNew: boolean) {
  try {
    const { data: ticket } = await admin.from('support_tickets').select('*').eq('id', ticketId).single();
    if (!ticket) return;
    const { data: msgs } = await admin.from('support_messages').select('direction,body,created_at,auto').eq('ticket_id', ticket.id).order('created_at');
    const thread: ThreadMsg[] = [{ direction: 'in', body: ticket.message, created_at: ticket.created_at }, ...((msgs ?? []) as ThreadMsg[])];
    const lastIn = [...thread].reverse().find((m) => m.direction === 'in')?.body ?? ticket.message;
    const { data: settings } = await admin.from('support_settings').select('auto_reply').eq('id', 1).maybeSingle();
    const first = ticket.name.split(' ')[0];

    // assistente desligado: confirmação simples e aviso para o dono
    if (!settings?.auto_reply || !Deno.env.get('ANTHROPIC_API_KEY')) {
      if (isNew) await send(ticket, `Olá, ${first}!\n\nRecebemos sua mensagem e já estamos olhando. Respondemos por aqui, normalmente no mesmo dia útil.\n\nSeu protocolo é #${protocol(ticket.id)}.`, 'Para acrescentar algo, é só responder este e-mail.', true);
      await notifyOwner(`[Suporte Quitaí] ${isNew ? (TOPICS[ticket.topic] ?? 'Mensagem') : 'Resposta'} · ${ticket.name} (#${protocol(ticket.id)})`,
        [['Nome', ticket.name], ['E-mail', ticket.email], ['Assunto', TOPICS[ticket.topic] ?? ticket.topic], ['Protocolo', `#${protocol(ticket.id)}`]], lastIn);
      return;
    }

    // já está com uma pessoa: só avisa o dono
    if (ticket.escalated) {
      await notifyOwner(`[Suporte Quitaí] ${ticket.name} respondeu (#${protocol(ticket.id)})`,
        [['Resumo', ticket.summary ?? '-'], ['Nome', ticket.name], ['E-mail', ticket.email], ['Protocolo', `#${protocol(ticket.id)}`]], lastIn);
      return;
    }

    if (WANTS_HUMAN.test(lastIn)) return await escalate(ticket, ticket.summary || `${first} pediu para falar com uma pessoa.`, 'pediu atendimento humano', lastIn);
    if ((ticket.auto_replies ?? 0) >= MAX_AUTO) return await escalate(ticket, ticket.summary || 'O assistente já respondeu várias vezes sem resolver.', `${MAX_AUTO} respostas automáticas sem solução`, lastIn);

    let d;
    try { d = await decide(ticket, thread); } catch (e) {
      console.error('IA do suporte falhou', e);
      return await escalate(ticket, 'O assistente estava indisponível; a mensagem precisa de resposta.', 'IA indisponível', lastIn);
    }
    if (d.action === 'escalate') return await escalate(ticket, d.summary, d.reason, lastIn);

    const ok = await send(ticket, d.reply, FOOTER_AUTO, true);
    if (!ok) return await escalate(ticket, d.summary, 'falha ao enviar a resposta automática', lastIn);
    await admin.from('support_tickets').update({ status: 'respondido', summary: d.summary, auto_replies: (ticket.auto_replies ?? 0) + 1 }).eq('id', ticket.id);
  } catch (e) {
    console.error('assistente do suporte', e);
  }
}

/** Mantém a função viva até o assistente terminar, sem atrasar a resposta HTTP. */
export function inBackground(p: Promise<unknown>) {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {});
}
