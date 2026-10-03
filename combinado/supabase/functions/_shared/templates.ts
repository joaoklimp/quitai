// GERADO por scripts/sync-functions.mjs a partir de src/shared/templates.ts. Não edite aqui: edite o original e rode "npm run sync:functions".
// Modelos de mensagem do WhatsApp (precisam ser cadastrados e aprovados na Meta, em português do Brasil).
// Fonte única: o painel mostra estes textos para cadastrar e o servidor envia exatamente estas variáveis.
// Fora da janela de 24 horas, o WhatsApp só deixa a empresa escrever com um modelo aprovado.

export interface WaTemplate {
  name: string;
  category: 'Utilidade' | 'Marketing';
  body: string; // {{1}}, {{2}}... na ordem dos parâmetros
  params: string[]; // o que vai em cada variável
  use: string; // quando a ORBYTA usa
}

export const TEMPLATES = {
  orcamento: {
    name: 'orcamento_enviado', category: 'Utilidade',
    body: 'Olá, {{1}}! Segue o seu orçamento nº {{2}} no valor de {{3}}: {{4}} É só abrir o link para conferir e aprovar.',
    params: ['primeiro nome', 'número do orçamento', 'valor total', 'link do orçamento'],
    use: 'Enviar um orçamento para quem não escreveu nas últimas 24 horas.',
  },
  lembrete: {
    name: 'lembrete_agendamento', category: 'Utilidade',
    body: 'Olá, {{1}}! Lembrete da sua consulta de {{2}} {{3}}, às {{4}}. Responda SIM para confirmar presença ou me avise se precisar remarcar.',
    params: ['primeiro nome', 'procedimento (e profissional)', 'dia (ex.: amanhã)', 'hora'],
    use: 'Lembrete automático antes da consulta, pedindo confirmação de presença.',
  },
  acompanhamento: {
    name: 'acompanhamento_orcamento', category: 'Utilidade',
    body: 'Olá, {{1}}! Passando para saber se ficou alguma dúvida sobre o orçamento nº {{2}} ({{3}}). O link continua aqui: {{4}}',
    params: ['primeiro nome', 'número do orçamento', 'valor total', 'link do orçamento'],
    use: 'Acompanhamento de orçamento sem resposta.',
  },
  posAtendimento: {
    name: 'pos_atendimento', category: 'Marketing',
    body: 'Olá, {{1}}! Obrigado pela confiança na {{2}}. {{3}}',
    params: ['primeiro nome', 'nome da clínica', 'pedido de avaliação'],
    use: 'Agradecimento e pedido de avaliação depois da consulta.',
  },
  reativacao: {
    name: 'reativacao_cliente', category: 'Marketing',
    body: 'Olá, {{1}}! Faz tempo que não te vemos na {{2}}. {{3}}',
    params: ['primeiro nome', 'nome da clínica', 'convite'],
    use: 'Convite para pacientes que não voltam há muito tempo.',
  },
  retorno: {
    name: 'lembrete_retorno', category: 'Utilidade',
    body: 'Olá, {{1}}! Está chegando a hora do seu retorno de {{2}} na {{3}}. Quer que eu veja um horário para você? É só responder por aqui.',
    params: ['primeiro nome', 'procedimento', 'nome da clínica'],
    use: 'Convite para marcar o retorno, no prazo definido em cada procedimento.',
  },
  resumo: {
    name: 'resumo_diario', category: 'Utilidade',
    body: 'Resumo de hoje na {{1}}: {{2}}. Responda esta mensagem para ver os detalhes.',
    params: ['nome da empresa', 'números do dia'],
    use: 'Resumo do dia para o dono e gerentes (quando não falaram com o número nas últimas 24 horas).',
  },
  tarefa: {
    name: 'lembrete_tarefa', category: 'Utilidade',
    body: 'Lembrete da ORBYTA: {{1}}. Responda esta mensagem se precisar de algo.',
    params: ['tarefa'],
    use: 'Lembretes das tarefas pedidas à IA ("me lembra de...").',
  },
  cobranca: {
    name: 'cobranca_cliente', category: 'Utilidade',
    body: 'Olá, {{1}}! Segue a cobrança de {{2}} referente a {{3}}, com vencimento em {{4}}. Para pagar com Pix ou boleto, é só abrir o link: {{5}}',
    params: ['primeiro nome', 'valor', 'descrição', 'vencimento', 'link de pagamento'],
    use: 'Enviar uma cobrança (Pix ou boleto) para quem não escreveu nas últimas 24 horas.',
  },
  encaixe: {
    name: 'encaixe_disponivel', category: 'Utilidade',
    body: 'Olá, {{1}}! Abriu um horário {{2}} às {{3}} para {{4}}. Quer ficar com ele? É só responder SIM por aqui.',
    params: ['primeiro nome', 'dia (ex.: amanhã)', 'hora', 'procedimento'],
    use: 'Avisar quem está na lista de espera que um horário foi liberado.',
  },
  relatorio: {
    name: 'relatorio_semanal', category: 'Utilidade',
    body: 'Sua semana na {{1}} com a ORBYTA: {{2}}. Responda esta mensagem para ver o relatório completo.',
    params: ['nome da empresa', 'números da semana'],
    use: 'Relatório semanal do que a ORBYTA fez pela clínica (para o dono e gerentes).',
  },
  avisoEquipe: {
    name: 'aviso_equipe', category: 'Utilidade',
    body: 'Aviso da ORBYTA: {{1}}. Abra o painel para ver os detalhes.',
    params: ['aviso'],
    use: 'Avisar a equipe que um paciente precisa de atendimento.',
  },
} satisfies Record<string, WaTemplate>;

export const TEMPLATE_LIST: WaTemplate[] = Object.values(TEMPLATES);
