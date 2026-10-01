// Atendimento pelo painel de Administração: ver a conversa, pedir um rascunho à IA e enviar a resposta.
// Só administradores do Quitaí (tabela platform_admins).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { admin, caller, cors, json } from '../_shared/common.ts';
import { brandedHtml, protocol, sendEmail, ticketSubject } from '../_shared/mail.ts';
import { suggestReply } from '../_shared/ai.ts';

type Msg = { direction: 'in' | 'out'; body: string; created_at: string; auto?: boolean };

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    const me = await caller(req);
    if (!me || !(await isAdmin(me.user_id))) return json(req, { error: 'not_allowed' }, 403);
    const body = await req.json().catch(() => ({}));
    const { data: ticket } = await admin.from('support_tickets').select('*').eq('id', String(body.ticket_id ?? '')).maybeSingle();
    if (!ticket) return json(req, { error: 'not_found' }, 404);
    const { data: msgs } = await admin.from('support_messages').select('direction,body,created_at,auto').eq('ticket_id', ticket.id).order('created_at');
    const thread: Msg[] = [{ direction: 'in', body: ticket.message, created_at: ticket.created_at }, ...((msgs ?? []) as Msg[])];

    if (body.action === 'thread') return json(req, { ok: true, thread });

    if (body.action === 'suggest') {
      if (!Deno.env.get('ANTHROPIC_API_KEY')) return json(req, { error: 'ai_not_configured' }, 503);
      const draft = await suggestReply(ticket, thread);
      if (!draft) return json(req, { error: 'ai_refused' }, 422);
      return json(req, { ok: true, draft });
    }

    if (body.action === 'reply') {
      const text = String(body.text ?? '').trim().slice(0, 8000);
      if (text.length < 5) return json(req, { error: 'invalid' }, 400);
      const sent = await sendEmail({
        to: [ticket.email],
        subject: `Re: ${ticketSubject(ticket.id, ticket.topic)}`,
        html: brandedHtml(text, `Protocolo #${protocol(ticket.id)}. Para continuar a conversa, é só responder este e-mail.`),
        text,
      });
      if (!sent.ok) return json(req, { error: 'send_failed' }, 502);
      await admin.from('support_messages').insert({ ticket_id: ticket.id, direction: 'out', body: text, email_id: sent.id ?? null });
      // depois que uma pessoa respondeu, o assistente automático não responde mais nesta conversa
      await admin.from('support_tickets').update({ status: 'respondido', escalated: true }).eq('id', ticket.id);
      return json(req, { ok: true });
    }

    return json(req, { error: 'invalid_action' }, 400);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json(req, { error: 'ai_not_configured' }, 503);
    if (e instanceof Anthropic.RateLimitError) return json(req, { error: 'ai_busy' }, 429);
    if (e instanceof Anthropic.APIError) { console.error('IA', e.status, e.message); return json(req, { error: 'ai_error' }, 502); }
    console.error(e);
    return json(req, { error: 'server_error' }, 500);
  }
});
