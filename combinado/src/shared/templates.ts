// Modelos de mensagem do WhatsApp (precisam ser cadastrados e aprovados na Meta, em português do Brasil).
// Fonte única: o painel mostra estes textos para cadastrar e o servidor envia exatamente estas variáveis.
// Fora da janela de 24 horas, o WhatsApp só deixa a empresa escrever com um modelo aprovado.

export interface WaTemplate {
  name: string;
  category: 'Utilidade' | 'Marketing';
  body: string; // {{1}}, {{2}}... na ordem dos parâmetros
  params: string[]; // o que vai em cada variável
  use: string; // quando o Combinado usa
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
    body: 'Olá, {{1}}! Passando para lembrar do seu horário de {{2}} {{3}}, às {{4}}. Responda SIM para confirmar ou me avise se precisar remarcar.',
    params: ['primeiro nome', 'serviço', 'dia (ex.: amanhã)', 'hora'],
    use: 'Lembrete automático antes do horário marcado.',
  },
  acompanhamento: {
    name: 'acompanhamento_orcamento', category: 'Utilidade',
    body: 'Olá, {{1}}! Passando para saber se ficou alguma dúvida sobre o orçamento nº {{2}} ({{3}}). O link continua aqui: {{4}}',
    params: ['primeiro nome', 'número do orçamento', 'valor total', 'link do orçamento'],
    use: 'Acompanhamento de orçamento sem resposta.',
  },
  posAtendimento: {
    name: 'pos_atendimento', category: 'Marketing',
    body: 'Olá, {{1}}! Obrigado por escolher a {{2}}. {{3}}',
    params: ['primeiro nome', 'nome da empresa', 'pedido de avaliação'],
    use: 'Agradecimento e pedido de avaliação depois do serviço.',
  },
  reativacao: {
    name: 'reativacao_cliente', category: 'Marketing',
    body: 'Olá, {{1}}! Sentimos sua falta na {{2}}. {{3}}',
    params: ['primeiro nome', 'nome da empresa', 'convite ou desconto'],
    use: 'Convite para clientes que não compram há muito tempo.',
  },
  resumo: {
    name: 'resumo_diario', category: 'Utilidade',
    body: 'Resumo de hoje na {{1}}: {{2}}. Responda esta mensagem para ver os detalhes.',
    params: ['nome da empresa', 'números do dia'],
    use: 'Resumo do dia para o dono e gerentes (quando não falaram com o número nas últimas 24 horas).',
  },
  tarefa: {
    name: 'lembrete_tarefa', category: 'Utilidade',
    body: 'Lembrete do Combinado: {{1}}. Responda esta mensagem se precisar de algo.',
    params: ['tarefa'],
    use: 'Lembretes das tarefas pedidas à IA ("me lembra de...").',
  },
  avisoEquipe: {
    name: 'aviso_equipe', category: 'Utilidade',
    body: 'Aviso do Combinado: {{1}}. Abra o painel para ver os detalhes.',
    params: ['aviso'],
    use: 'Avisar a equipe que um cliente precisa de atendimento.',
  },
} satisfies Record<string, WaTemplate>;

export const TEMPLATE_LIST: WaTemplate[] = Object.values(TEMPLATES);
