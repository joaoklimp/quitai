// IA do suporte: rascunho para o painel e decisão do assistente automático (responder ou encaminhar).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { admin } from './common.ts';
import { TOPICS } from './mail.ts';

export const KNOWLEDGE = `O Quitaí é um sistema on-line de cobrança e fechamento financeiro para pequenos negócios no Brasil (site usequitai.com.br).

O que o Quitaí faz:
- Cadastro de clientes e cobranças, mensalidades automáticas, multa e juros por atraso, Pix copia e cola e QR Code, recibo em PDF, cobrança pelo WhatsApp (abre o WhatsApp com a mensagem pronta), baixa automática pelo extrato do banco, conferência das taxas da maquininha, acordos de pagamento, relatórios em PDF e Excel, equipe com permissões (plano Empresa) e fechamento do período.
- O Quitaí não recebe dinheiro em nome do cliente: os pagamentos dos clientes dele vão direto para a conta dele.
- Envio automático de WhatsApp e e-mail e Pix/boleto com baixa na hora ainda NÃO existem (estão marcados como "em breve").

Planos (preço mensal; no anual o valor por mês fica menor, pago de uma vez por 12 meses):
- Básico: R$ 59/mês (ou R$ 49/mês no anual). Até 50 clientes, 10 análises com IA por mês, suporte por e-mail.
- Pro: R$ 129/mês (ou R$ 109/mês no anual). Até 200 clientes, 100 análises com IA, extrato, maquininha, WhatsApp, acordos e relatórios.
- Empresa: R$ 249/mês (ou R$ 209/mês no anual). Clientes ilimitados, 400 análises com IA, equipe com permissões e régua de cobrança.
- Toda conta nova tem 7 dias de teste grátis, sem cartão. Depois do teste, se não assinar, o painel fica em modo leitura e os dados continuam guardados.
- Pagamento da assinatura: cartão de crédito, pela Stripe.

Como fazer as coisas mais comuns:
- Assinar ou mudar de plano: menu Assinatura → Assinar. Com assinatura ativa: Assinatura → Gerenciar assinatura (troca de plano, troca de cartão, faturas, cancelamento).
- Cancelar: Assinatura → Gerenciar assinatura → Cancelar assinatura. O acesso continua até o fim do período já pago.
- Pagou e o plano não liberou: Assinatura → "Já paguei e não liberou", ou no menu do usuário → Ajuda e suporte → "Verificar meu pagamento".
- Esqueceu a senha: na tela Entrar → "Esqueci minha senha"; o link chega por e-mail (confira o spam).
- Pessoa da equipe sem acesso: o dono ou um administrador redefine a senha em Equipe.
- Backup dos dados: Configurações → Backup e portabilidade.
- Excluir dados ou a conta: Configurações → Privacidade e exclusão (só o proprietário).`;

const STYLE = `Regras de escrita:
- Português do Brasil, tom cordial e direto, frases curtas. Comece com "Olá, <primeiro nome>!" e termine com "Abraço,\\nEquipe Quitaí".
- Responda só ao que a pessoa perguntou, com o passo a passo quando ajudar.
- Nunca prometa reembolso, desconto, prazo de correção ou funcionalidade que não está descrita acima.
- Não invente dados sobre a conta da pessoa.`;

export type ThreadMsg = { direction: 'in' | 'out'; body: string; created_at: string; auto?: boolean };
export type Ticket = { id: string; name: string; email: string; topic: string; company_id: string | null; message: string; created_at: string };

export async function accountContext(ticket: Ticket): Promise<string> {
  if (!ticket.company_id) return 'A mensagem veio do site sem login (a pessoa pode não ter conta).';
  const { data: c } = await admin.from('companies').select('plan,billing_status,trial_ends_at,current_period_end').eq('id', ticket.company_id).maybeSingle();
  if (!c) return 'Conta não encontrada.';
  return `Conta da pessoa no Quitaí: plano ${c.plan}, situação ${c.billing_status}${c.billing_status === 'trial' ? `, teste até ${c.trial_ends_at}` : c.current_period_end ? `, período até ${c.current_period_end}` : ''}.`;
}

function transcript(ticket: Ticket, thread: ThreadMsg[]): string {
  return thread.map((m) => `${m.direction === 'in' ? `CLIENTE (${ticket.name})` : m.auto ? 'QUITAÍ (assistente automático)' : 'QUITAÍ (equipe)'}:\n${m.body}`).join('\n\n---\n\n');
}

function textOf(r: Anthropic.Beta.BetaMessage): string {
  return r.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join('\n').trim();
}

async function ask(system: string, user: string, format?: Record<string, unknown>): Promise<Anthropic.Beta.BetaMessage> {
  const client = new Anthropic();
  const params: Record<string, unknown> = {
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: format ? { effort: 'low', format } : { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  };
  return await client.beta.messages.create(params as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;
}

/** Rascunho para o dono revisar no painel. */
export async function suggestReply(ticket: Ticket, thread: ThreadMsg[]): Promise<string | null> {
  const r = await ask(
    `Você escreve respostas de suporte do Quitaí. O dono do Quitaí revisa cada rascunho antes de enviar.\n\n${KNOWLEDGE}\n\n${STYLE}\n- Nesses casos sensíveis (reembolso, desconto, contestação), diga que a equipe vai analisar e retornar.\n- Escreva só o texto do e-mail, sem assunto e sem comentários para o revisor.`,
    `Assunto escolhido pelo cliente: ${TOPICS[ticket.topic] ?? ticket.topic}\n${await accountContext(ticket)}\n\nConversa até agora (a última mensagem do cliente é a que precisa de resposta):\n\n${transcript(ticket, thread)}\n\nEscreva a próxima resposta do Quitaí.`,
  );
  if (r.stop_reason === 'refusal') return null;
  return textOf(r) || null;
}

export type Decision = { action: 'reply' | 'escalate'; reply: string; summary: string; reason: string };

const DECISION_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['reply', 'escalate'] },
      reply: { type: 'string', description: 'Texto do e-mail para o cliente quando action = reply. Vazio quando escalate.' },
      summary: { type: 'string', description: 'Resumo em 1 a 3 frases do que a pessoa quer, para o dono do Quitaí.' },
      reason: { type: 'string', description: 'Por que respondeu ou encaminhou, em poucas palavras.' },
    },
    required: ['action', 'reply', 'summary', 'reason'],
    additionalProperties: false,
  },
};

/** Assistente automático: responde sozinho só quando é seguro; senão encaminha para uma pessoa. */
export async function decide(ticket: Ticket, thread: ThreadMsg[]): Promise<Decision> {
  const r = await ask(
    `Você é o assistente virtual de suporte do Quitaí. Você responde sozinho, sem revisão humana, então só responde quando tem certeza.\n\n${KNOWLEDGE}\n\n${STYLE}\n\nQuando ENCAMINHAR para uma pessoa (action = "escalate", reply vazio):
- a pessoa pede para falar com alguém da equipe, atendente, humano ou pessoa;
- envolve reembolso, estorno, contestação, cobrança indevida ou em dobro, desconto, negociação de preço;
- reclamação, irritação, ameaça de Procon, processo, advogado ou Reclame Aqui;
- pede algo que exige mexer na conta por trás (trocar e-mail de acesso, recuperar conta sem acesso ao e-mail, apagar dados por pedido da LGPD, transferir conta);
- relata erro, falha ou dado errado no sistema que o passo a passo acima não resolve;
- parceria, imprensa, venda, contrato ou qualquer assunto fora do uso do Quitaí;
- a mensagem não está clara ou você não tem certeza da resposta;
- a conversa já teve respostas automáticas e a pessoa continua sem solução.
Nos outros casos (dúvida de uso, preços, planos, teste grátis, como assinar, cancelar, recuperar senha, "já paguei e não liberou"), responda (action = "reply").
O resumo é sempre para o dono do Quitaí, em terceira pessoa.`,
    `Assunto escolhido pelo cliente: ${TOPICS[ticket.topic] ?? ticket.topic}\n${await accountContext(ticket)}\n\nConversa até agora (responda à última mensagem do cliente):\n\n${transcript(ticket, thread)}`,
    DECISION_SCHEMA,
  );
  if (r.stop_reason === 'refusal') return { action: 'escalate', reply: '', summary: 'O assistente não conseguiu analisar a mensagem.', reason: 'recusa da IA' };
  try {
    const d = JSON.parse(textOf(r)) as Decision;
    if (d.action === 'reply' && d.reply.trim().length < 20) return { ...d, action: 'escalate', reason: 'resposta vazia' };
    return d;
  } catch {
    return { action: 'escalate', reply: '', summary: 'O assistente não conseguiu analisar a mensagem.', reason: 'resposta inválida da IA' };
  }
}
