// Atendimento pelo painel de Administração: ver a conversa, pedir um rascunho à IA e enviar a resposta.
// Só administradores do Quitaí (tabela platform_admins).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { admin, caller, cors, json } from '../_shared/common.ts';
import { brandedHtml, protocol, sendEmail, ticketSubject, TOPICS } from '../_shared/mail.ts';

const SYSTEM = `Você escreve respostas de suporte do Quitaí, um sistema on-line de cobrança e fechamento financeiro para pequenos negócios no Brasil. O dono do Quitaí revisa cada rascunho antes de enviar.

O que o Quitaí é e faz:
- Cadastro de clientes e cobranças, mensalidades automáticas, multa e juros por atraso, Pix copia e cola e QR Code, recibo em PDF, cobrança pelo WhatsApp, baixa automática pelo extrato do banco, conferência das taxas da maquininha, acordos de pagamento, relatórios em PDF e Excel, equipe com permissões (plano Empresa) e fechamento do período.
- O Quitaí não recebe dinheiro em nome do cliente: os pagamentos dos clientes dele vão direto para a conta dele.

Planos (preço mensal; no anual o valor por mês fica menor, pago de uma vez por 12 meses):
- Básico: R$ 59/mês (ou R$ 49/mês no anual). Até 50 clientes, 10 análises com IA por mês, suporte por e-mail.
- Pro: R$ 129/mês (ou R$ 109/mês no anual). Até 200 clientes, 100 análises com IA, extrato, maquininha, WhatsApp, acordos e relatórios.
- Empresa: R$ 249/mês (ou R$ 209/mês no anual). Clientes ilimitados, 400 análises com IA, equipe com permissões e régua de cobrança.
- Toda conta nova tem 7 dias de teste grátis, sem cartão. Depois do teste, se não assinar, o painel fica em modo leitura e os dados continuam guardados.

Como fazer as coisas mais comuns:
- Assinar ou mudar de plano: menu Assinatura → Assinar (pagamento pela Stripe, no cartão). Com assinatura ativa: Assinatura → Gerenciar assinatura (troca de plano, troca de cartão, faturas, cancelamento).
- Cancelar: Assinatura → Gerenciar assinatura → Cancelar assinatura. O acesso continua até o fim do período já pago.
- Pagou e o plano não liberou: Assinatura → "Já paguei e não liberou", ou no menu Ajuda e suporte → "Verificar meu pagamento".
- Esqueceu a senha: na tela Entrar → "Esqueci minha senha"; o link chega por e-mail (confira o spam).
- Pessoa da equipe sem acesso: o dono ou um administrador redefine a senha em Equipe.
- Backup: Configurações → Backup e portabilidade.

Regras da resposta:
- Português do Brasil, tom cordial e direto, frases curtas. Comece com "Olá, <primeiro nome>!" e termine com "Abraço,\nEquipe Quitaí".
- Responda só ao que a pessoa perguntou, com o passo a passo quando ajudar.
- Nunca prometa reembolso, desconto, prazo de correção ou funcionalidade que não está na lista acima. Nesses casos, diga que a equipe vai analisar e retornar.
- Se faltar informação para resolver (ex.: e-mail usado no pagamento, print do erro), peça de forma objetiva.
- Não invente dados sobre a conta da pessoa.
- Escreva só o texto do e-mail, sem assunto e sem comentários para o revisor.`;

type Msg = { direction: 'in' | 'out'; body: string; created_at: string };

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
    const { data: msgs } = await admin.from('support_messages').select('direction,body,created_at').eq('ticket_id', ticket.id).order('created_at');
    const thread: Msg[] = [{ direction: 'in', body: ticket.message, created_at: ticket.created_at }, ...((msgs ?? []) as Msg[])];

    if (body.action === 'thread') return json(req, { ok: true, thread });

    if (body.action === 'suggest') {
      if (!Deno.env.get('ANTHROPIC_API_KEY')) return json(req, { error: 'ai_not_configured' }, 503);
      let context = '';
      if (ticket.company_id) {
        const { data: c } = await admin.from('companies').select('plan,billing_status,trial_ends_at,current_period_end,complimentary').eq('id', ticket.company_id).maybeSingle();
        if (c) context = `Conta do cliente no Quitaí: plano ${c.plan}, situação ${c.billing_status}${c.billing_status === 'trial' ? `, teste até ${c.trial_ends_at}` : c.current_period_end ? `, período até ${c.current_period_end}` : ''}.`;
      } else context = 'A mensagem veio do site sem login (pode não ter conta).';
      const transcript = thread.map((m) => `${m.direction === 'in' ? `CLIENTE (${ticket.name})` : 'QUITAÍ'}:\n${m.body}`).join('\n\n---\n\n');
      const client = new Anthropic();
      const response = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `Assunto escolhido pelo cliente: ${TOPICS[ticket.topic] ?? ticket.topic}\n${context}\n\nConversa até agora (a última mensagem do cliente é a que precisa de resposta):\n\n${transcript}\n\nEscreva a próxima resposta do Quitaí.`,
        }],
      } as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;
      if (response.stop_reason === 'refusal') return json(req, { error: 'ai_refused' }, 422);
      const draft = response.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join('\n').trim();
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
      await admin.from('support_tickets').update({ status: 'respondido' }).eq('id', ticket.id);
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
