// Dados de demonstração: "Vida Plena Odontologia", clínica fictícia em Brasília, com três dentistas.
// Tudo é gerado em relação a "agora", com sorteio determinístico (mesma semente = mesmos dados).
import type {
  AiSettings, Appointment, AuditEntry, Automation, AutomationRun, Company, Contact, Conversation, DailyStat, Invoice,
  Member, Message, Notification, Quote, QuoteItem, Sale, Service, Task, UsageMonth, WhatsAppAccount, Stage, Temperature,
  PayMethod, ContactSource, AutomationKind, ActionReceipt, PendingAction, Professional,
} from '../types';
import { addDays, fromLocal, localDate, localParts, normalizePhone, weekdayOf } from '../../../shared/format';
import type { Charge, CompanyIntegration, FinanceEntry, FiscalNote, Product, StockMovement, WaitlistEntry } from '../types';
import { buildGestao, DEMO_FAQ } from './gestao';

export const DEMO_COMPANY_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_USER_ID = '00000000-0000-4000-8000-0000000000aa';
const TZ = 'America/Sao_Paulo';

export interface DemoDB {
  version: number;
  seededAt: string;
  company: Company;
  ai: AiSettings;
  whatsapp: WhatsAppAccount;
  members: Member[];
  contacts: Contact[];
  services: Service[];
  professionals: Professional[];
  quotes: Quote[];
  quote_items: QuoteItem[];
  appointments: Appointment[];
  sales: Sale[];
  tasks: Task[];
  conversations: Conversation[];
  messages: Message[];
  pending_actions: PendingAction[];
  audit_log: AuditEntry[];
  automations: Automation[];
  automation_runs: AutomationRun[];
  notifications: Notification[];
  invoices: Invoice[];
  usage_monthly: UsageMonth[];
  finance_entries: FinanceEntry[];
  products: Product[];
  stock_movements: StockMovement[];
  charges: Charge[];
  fiscal_notes: FiscalNote[];
  company_integrations: CompanyIntegration[];
  waitlist: WaitlistEntry[];
  /** campos de mensagens por dia (o resto do agregado vem das linhas) */
  msgStats: Record<string, Pick<DailyStat, 'msgs_in' | 'msgs_ai' | 'msgs_team' | 'conversations' | 'response_sum' | 'response_count' | 'handoffs'>>;
  /** agregados de vendas/orçamentos para dias anteriores à janela de linhas */
  oldStats: Record<string, Pick<DailyStat, 'new_contacts' | 'quotes_created' | 'quotes_sent' | 'quotes_approved' | 'quotes_value' | 'sales_count' | 'sales_amount' | 'sales_ia' | 'sales_equipe' | 'sales_balcao' | 'appointments'>>;
  seq: { quote: number; id: number };
}

export const DEMO_VERSION = 8;
const HISTORY_DAYS = 365;
const RAW_DAYS = 75;
const AI_START = 120; // a empresa começou a usar a IA há 120 dias

/* ---------- sorteio determinístico ---------- */
function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let rnd = mulberry32(20261002);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rnd() < p;
function weighted<T>(pairs: [T, number][]): T { const total = pairs.reduce((s, [, w]) => s + w, 0); let r = rnd() * total; for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][0]; }

let idCounter = 1;
export function demoId(prefix = 'd'): string {
  const n = (idCounter++).toString(16).padStart(12, '0');
  return `${prefix === 'd' ? '0000d000' : prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${n}`;
}
const token = () => Array.from({ length: 24 }, () => '0123456789abcdef'[int(0, 15)]).join('');

/* ---------- vocabulário ---------- */
const FIRST = ['Maria', 'Ana', 'Juliana', 'Fernanda', 'Patrícia', 'Aline', 'Camila', 'Amanda', 'Bruna', 'Letícia', 'Larissa', 'Gabriela', 'Renata', 'Vanessa', 'Carla', 'Débora', 'Tatiane', 'Priscila', 'Luciana', 'Simone', 'Beatriz', 'Mariana', 'Rafaela', 'Isabela', 'Raquel', 'Cláudia', 'Sandra', 'Adriana', 'Helena', 'Lívia', 'João', 'José', 'Carlos', 'Paulo', 'Pedro', 'Lucas', 'Marcos', 'Rafael', 'Felipe', 'Bruno', 'Eduardo', 'Rodrigo', 'Gustavo', 'Thiago', 'André', 'Fábio', 'Diego', 'Leandro', 'Ricardo', 'Márcio', 'Daniel', 'Vinícius', 'Gabriel', 'Mateus', 'Leonardo', 'Henrique', 'Sérgio', 'Roberto', 'Antônio', 'Francisco', 'Caio', 'Igor', 'Murilo', 'Otávio', 'Samuel', 'Heloísa', 'Natália', 'Joana', 'Sofia', 'Alice'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas', 'Cardoso', 'Ramos', 'Gonçalves', 'Santana', 'Teixeira', 'Araújo', 'Pinto', 'Moraes', 'Campos', 'Correia', 'Batista', 'Cavalcanti', 'Monteiro', 'Duarte', 'Peixoto', 'Brandão', 'Siqueira', 'Xavier', 'Farias', 'Queiroz'];
export const DEMO_INSURANCES = ['Unimed Odonto', 'Amil Dental', 'OdontoPrev', 'Bradesco Dental'];

/* ---------- clínica, procedimentos e profissionais ---------- */
function serviceRows(now: string): Service[] {
  const s = (name: string, price: number, price_type: Service['price_type'], duration_min: number, category: string, description: string, sort: number, return_days: number | null = null): Service => ({
    id: demoId('5e'), company_id: DEMO_COMPANY_ID, name, price, price_type, duration_min, category, description, active: true, sort, return_days, created_at: now,
  });
  return [
    s('Avaliação (primeira consulta)', 0, 'fixo', 30, 'Consultas', 'Exame clínico e plano de tratamento. Sem custo.', 1),
    s('Limpeza (profilaxia)', 220, 'fixo', 40, 'Prevenção', 'Remoção de tártaro e polimento. Recomendado a cada 6 meses.', 2, 180),
    s('Restauração', 280, 'a_partir_de', 60, 'Tratamentos', 'Resina na cor do dente. Valor por face, depende do tamanho.', 3),
    s('Tratamento de canal', 900, 'a_partir_de', 90, 'Tratamentos', 'Endodontia. Valor depende do dente; pode precisar de mais de uma sessão.', 4, 15),
    s('Extração simples', 300, 'a_partir_de', 45, 'Cirurgia', 'Inclui retorno para retirar os pontos.', 5, 7),
    s('Clareamento a laser', 1200, 'a_partir_de', 60, 'Estética', 'Duas sessões no consultório.', 6, 14),
    s('Clareamento caseiro (moldeira)', 750, 'fixo', 30, 'Estética', 'Moldeiras personalizadas e gel para 3 semanas.', 7, 21),
    s('Implante dentário', 3500, 'a_partir_de', 120, 'Implantes', 'Valor por implante, sem a coroa. Depende de avaliação e exames.', 8, 90),
    s('Avaliação ortodôntica', 0, 'fixo', 30, 'Ortodontia', 'Exame e indicação do aparelho. Sem custo.', 9),
    s('Instalação de aparelho', 1800, 'a_partir_de', 90, 'Ortodontia', 'Aparelho fixo metálico ou estético.', 10, 30),
    s('Manutenção de aparelho', 200, 'fixo', 30, 'Ortodontia', 'Mensal.', 11, 30),
    s('Urgência (dor)', 250, 'fixo', 30, 'Urgência', 'Atendimento no mesmo dia para dor ou trauma.', 12),
  ];
}

function professionalRows(now: string, services: Service[]): Professional[] {
  const ids = (...names: string[]) => names.map((n) => services.find((x) => x.name.startsWith(n))!.id);
  const p = (name: string, specialty: string, council: string, color: string, service_ids: string[], business_hours: Professional['business_hours'], sort: number): Professional => ({
    id: demoId('9f'), company_id: DEMO_COMPANY_ID, name, specialty, council, color, business_hours, service_ids, member_user_id: null, active: true, sort, created_at: now,
  });
  return [
    p('Dra. Marina Costa', 'Clínica geral e estética', 'CRO-DF 8421', '#3D86F0', ids('Avaliação (', 'Limpeza', 'Restauração', 'Tratamento de canal', 'Extração', 'Clareamento a laser', 'Clareamento caseiro', 'Urgência'), null, 1),
    p('Dr. Rafael Nunes', 'Ortodontia', 'CRO-DF 9137', '#8B5CF6', ids('Avaliação ortodôntica', 'Instalação de aparelho', 'Manutenção de aparelho'), { '1': [['08:00', '12:00'], ['13:00', '18:00']], '3': [['08:00', '12:00'], ['13:00', '18:00']], '5': [['08:00', '12:00'], ['13:00', '18:00']], '6': [['08:00', '12:00']] }, 2),
    p('Dra. Luiza Prado', 'Implantes e cirurgia', 'CRO-DF 7710', '#10B981', ids('Avaliação (', 'Implante', 'Extração', 'Urgência'), { '2': [['08:00', '18:00']], '4': [['08:00', '18:00']] }, 3),
  ];
}

function companyRow(nowIso: string, today: string): Company {
  return {
    id: DEMO_COMPANY_ID,
    name: 'Vida Plena Odontologia',
    segment: 'odontologia',
    document: '12.345.678/0001-90',
    phone: '5561998765432',
    email: 'contato@vidaplena.odo.br',
    address: 'SCS Quadra 2, Bloco C, sala 410, Asa Sul',
    city: 'Brasília',
    state: 'DF',
    timezone: TZ,
    business_hours: { '0': [], '1': [['08:00', '19:00']], '2': [['08:00', '19:00']], '3': [['08:00', '19:00']], '4': [['08:00', '19:00']], '5': [['08:00', '19:00']], '6': [['08:00', '12:00']] },
    slot_minutes: 30,
    capacity_per_slot: 1,
    min_notice_minutes: 60,
    max_days_ahead: 60,
    monthly_goal: 68000,
    modules: ['estoque', 'cobrancas'],
    insurances: DEMO_INSURANCES,
    plan: 'profissional',
    billing_status: 'active',
    billing_cycle: 'mensal',
    billing_method: 'cartao',
    trial_ends_at: new Date(Date.parse(nowIso) - 150 * 86400000).toISOString(),
    current_period_end: addDays(today, 17),
    canceled_at: null,
    complimentary: false,
    created_at: new Date(Date.parse(nowIso) - 157 * 86400000).toISOString(),
  };
}

/* ---------- conversas escritas à mão (caixa de entrada recente) ---------- */
type Line = [who: 'c' | 'ia' | 'eq' | 'sis', text: string, minutesAfter?: number, actions?: ActionReceipt[]];
interface Script { name: string; minutesAgo: number; stage: Stage; temp: Temperature; tags: string[]; handler?: 'ia' | 'humano'; attention?: string; unread?: number; lines: Line[]; media?: Record<number, Message['media']> }

const SCRIPTS: Script[] = [
  {
    name: 'Juliana Ribeiro', minutesAgo: 4, stage: 'fechado', temp: 'quente', tags: ['limpeza', 'convênio'], unread: 0,
    media: { 0: { type: 'audio', url: null, mime: 'audio/ogg', caption: null, transcript: 'Oi, boa tarde! Queria marcar uma limpeza. Pode ser sexta à tarde? Eu tenho Unimed Odonto.' } },
    lines: [
      ['c', 'Oi, boa tarde! Queria marcar uma limpeza. Pode ser sexta à tarde? Eu tenho Unimed Odonto.'],
      ['ia', 'Boa tarde, Juliana! 😊 Atendemos Unimed Odonto, sim. Na sexta à tarde a Dra. Marina tem 14h e 16h30. Qual fica melhor?', 0.4, [
        { tool: 'consultar_horarios', label: 'Consultou a agenda de sexta', status: 'ok', detail: '14:00 e 16:30 com a Dra. Marina' },
      ]],
      ['c', '14h', 1.5],
      ['ia', 'Prontinho, Juliana! ✅ Limpeza marcada para sexta às 14h com a Dra. Marina Costa, pelo Unimed Odonto. Traga a carteirinha e um documento com foto. Na véspera eu te mando um lembrete.', 0.4, [
        { tool: 'agendar_horario', label: 'Consulta marcada', status: 'ok', detail: 'Sexta às 14:00 · Limpeza com a Dra. Marina · Unimed Odonto' },
        { tool: 'atualizar_cadastro', label: 'Ficha do paciente atualizada', status: 'ok', detail: 'convênio' },
      ]],
    ],
  },
  {
    name: 'Ricardo Almeida', minutesAgo: 18, stage: 'orcamento', temp: 'quente', tags: ['clareamento'], unread: 0,
    lines: [
      ['c', 'Boa tarde, quanto custa o clareamento?'],
      ['ia', 'Boa tarde, Ricardo! Temos dois tipos: o clareamento a laser, no consultório, a partir de R$ 1.200 (duas sessões), e o caseiro com moldeira, R$ 750. Antes, a dentista faz uma avaliação, que é gratuita. Quer que eu monte o orçamento do laser?', 0.5],
      ['c', 'Pode montar sim', 3],
      ['ia', 'Prontinho! Montei o orçamento nº 0412 de R$ 1.200,00 para o clareamento a laser. Ele vale por 7 dias. Quer aproveitar e já marcar a avaliação?', 0.4, [
        { tool: 'criar_orcamento', label: 'Orçamento nº 0412 criado', status: 'ok', detail: 'R$ 1.200,00 · Clareamento a laser' },
      ]],
      ['c', 'Vou ver com minha esposa e te falo', 4],
      ['ia', 'Perfeito! Fico no aguardo. Quando decidirem, é só mandar o melhor dia. 😉', 0.3],
    ],
  },
  {
    name: 'Débora Cardoso', minutesAgo: 26, stage: 'conversando', temp: 'quente', tags: ['urgência'], handler: 'humano', attention: 'Dor forte e rosto inchado: encaixe de urgência', unread: 2,
    lines: [
      ['c', 'Estou com muita dor num dente desde ontem e o rosto começou a inchar'],
      ['ia', 'Débora, sinto muito. 😔 Não consigo avaliar por aqui, mas já chamei a equipe para te encaixar hoje como urgência. Se o inchaço aumentar rápido, tiver febre alta ou dificuldade para engolir ou respirar, vá agora ao pronto-socorro ou ligue 192.', 0.3, [
        { tool: 'chamar_atendente', label: 'Atendimento passado para a equipe', status: 'ok', detail: 'Dor forte e inchaço: urgência' },
      ]],
      ['c', 'Ok, aguardo', 2],
      ['c', 'Tem horário ainda hoje?', 9],
    ],
  },
  {
    name: 'Fernanda Lopes', minutesAgo: 47, stage: 'orcamento', temp: 'quente', tags: ['implante'], handler: 'humano', attention: 'Pediu desconto acima do limite (20%) no implante', unread: 1,
    lines: [
      ['c', 'Oi, recebi o orçamento do implante. Faz por 2.800 à vista?'],
      ['ia', 'Oi, Fernanda! Esse desconto passa do que eu posso autorizar por aqui, então já pedi para a Dra. Luiza avaliar a condição à vista. Ela te responde ainda hoje. 🙏', 0.4, [
        { tool: 'chamar_atendente', label: 'Desconto enviado para aprovação', status: 'aguardando', detail: 'Pedido de 20% (limite da IA: 10%)' },
      ]],
    ],
  },
  {
    name: 'Marcos Teixeira', minutesAgo: 95, stage: 'fechado', temp: 'quente', tags: ['ortodontia'],
    lines: [
      ['c', 'Bom dia. Preciso marcar a manutenção do aparelho'],
      ['ia', 'Bom dia, Marcos! O Dr. Rafael tem sábado às 8h, 8h30 e 9h. Qual fica melhor?', 0.4, [
        { tool: 'consultar_horarios', label: 'Consultou a agenda do Dr. Rafael', status: 'ok', detail: 'Sábado: 08:00, 08:30, 09:00' },
      ]],
      ['c', '9h', 2],
      ['ia', 'Combinado! ✅ Sábado às 9h, manutenção do aparelho com o Dr. Rafael Nunes. Até lá!', 0.2, [
        { tool: 'agendar_horario', label: 'Consulta marcada', status: 'ok', detail: 'Sábado às 09:00 · Manutenção de aparelho' },
      ]],
    ],
  },
  {
    name: 'Patrícia Gomes', minutesAgo: 140, stage: 'conversando', temp: 'morno', tags: ['convênio'],
    lines: [
      ['c', 'Olá! Vocês aceitam Bradesco Dental?'],
      ['ia', 'Olá, Patrícia! Aceitamos sim: Unimed Odonto, Amil Dental, OdontoPrev e Bradesco Dental. Também atendemos particular. Quer marcar uma avaliação?', 0.4],
      ['c', 'Vou ver minha agenda e te falo', 6],
      ['ia', 'Claro! Fico à disposição. Quando souber o melhor dia, é só me mandar por aqui. 😉', 0.3],
    ],
  },
  {
    name: 'Helena Duarte', minutesAgo: 210, stage: 'fechado', temp: 'quente', tags: ['cirurgia'], handler: 'humano', attention: 'Dúvida pós-cirurgia (extração do siso)',
    lines: [
      ['c', 'Tirei o siso ontem e ainda está sangrando um pouco. É normal?'],
      ['ia', 'Helena, essa avaliação precisa ser da dentista, então já avisei a Dra. Luiza, que te responde em instantes. Se o sangramento ficar forte e não parar com a compressa de gaze, procure o pronto-socorro.', 0.4, [
        { tool: 'chamar_atendente', label: 'Dúvida clínica encaminhada à equipe', status: 'ok', detail: 'Pós-cirurgia · Dra. Luiza' },
      ]],
      ['c', 'Obrigada!', 4],
    ],
  },
  {
    name: 'Bruno Carvalho', minutesAgo: 320, stage: 'fechado', temp: 'quente', tags: ['restauração'],
    lines: [
      ['c', 'A dentista disse que preciso de 2 restaurações. Quanto fica?'],
      ['ia', 'Oi, Bruno! A restauração começa em R$ 280 por dente, então as 2 ficam a partir de R$ 560. Montei o orçamento pra você, quer que eu envie o link?', 0.4, [
        { tool: 'criar_orcamento', label: 'Orçamento nº 0409 criado', status: 'ok', detail: 'R$ 560,00 · 2 restaurações' },
      ]],
      ['c', 'Fechado! Pode marcar quarta às 16h?', 3],
      ['ia', 'Combinado! ✅ Quarta às 16h com a Dra. Marina. Seu orçamento nº 0409 está aprovado. Até lá!', 0.3, [
        { tool: 'agendar_horario', label: 'Consulta marcada', status: 'ok', detail: 'Quarta às 16:00 · Restauração' },
        { tool: 'responder_orcamento', label: 'Orçamento nº 0409 aprovado', status: 'ok' },
      ]],
    ],
  },
  {
    name: 'Simone Barbosa', minutesAgo: 400, stage: 'fechado', temp: 'morno', tags: ['infantil'],
    lines: [
      ['c', 'Vocês atendem criança? Meu filho tem 7 anos'],
      ['ia', 'Atendemos sim, Simone! A Dra. Marina atende crianças, com o responsável junto na consulta. Quer marcar uma avaliação para ele? Qual o nome dele?', 0.4],
      ['c', 'Pedro. Pode ser segunda de manhã?', 5],
      ['ia', 'Prontinho! ✅ Avaliação do Pedro marcada para segunda às 9h com a Dra. Marina. Deixei você como responsável na ficha.', 0.3, [
        { tool: 'agendar_horario', label: 'Consulta marcada', status: 'ok', detail: 'Segunda às 09:00 · Avaliação (Pedro, 7 anos)' },
        { tool: 'atualizar_cadastro', label: 'Ficha do paciente atualizada', status: 'ok', detail: 'responsável' },
      ]],
    ],
  },
  {
    name: 'Gustavo Pereira', minutesAgo: 600, stage: 'fechado', temp: 'morno', tags: ['remarcação'],
    lines: [
      ['ia', 'Olá, Gustavo! Lembrete da sua consulta de Restauração com a Dra. Marina Costa amanhã, às 10:00. Pode confirmar sua presença respondendo *SIM*? Se não puder vir, me avise por aqui que eu remarco.'],
      ['c', 'Não vou conseguir amanhã. Pode ser segunda?', 30],
      ['ia', 'Sem problema, Gustavo! Na segunda a Dra. Marina tem 9h, 11h e 14h. Qual fica melhor?', 0.3],
      ['c', '11h', 2],
      ['ia', 'Combinado! ✅ Remarquei para segunda às 11h. O horário de amanhã já foi oferecido para quem estava na lista de espera.', 0.3, [
        { tool: 'remarcar_horario', label: 'Consulta remarcada', status: 'ok', detail: 'Segunda às 11:00' },
      ]],
    ],
  },
  {
    name: 'Thiago Martins', minutesAgo: 1300, stage: 'fechado', temp: 'quente', tags: ['ortodontia'], unread: 0,
    lines: [
      ['ia', 'Olá, Thiago! Lembrete da sua consulta de Manutenção de aparelho com o Dr. Rafael Nunes amanhã, às 08:30. Pode confirmar sua presença respondendo *SIM*?'],
      ['c', 'SIM', 12],
      ['ia', 'Presença confirmada, Thiago! ✅ Até amanhã às 8h30.', 0.2, [
        { tool: 'confirmar_presenca', label: 'Paciente confirmou presença', status: 'ok', detail: 'Amanhã às 08:30 · Manutenção de aparelho' },
      ]],
    ],
  },
  {
    name: 'Aline Fernandes', minutesAgo: 900, stage: 'fechado', temp: 'quente', tags: ['clareamento', 'recorrente'],
    lines: [
      ['c', 'Amei o resultado do clareamento!! Muito obrigada'],
      ['ia', 'Que alegria ler isso, Aline! 💙 Obrigada pela confiança. Se puder, deixe uma avaliação pra gente no Google, ajuda muito: g.page/vidaplena. E lembre da limpeza a cada 6 meses: eu te aviso quando chegar a hora!', 0.4],
    ],
  },
  {
    name: 'Larissa Moreira', minutesAgo: 1500, stage: 'conversando', temp: 'morno', tags: ['ortodontia'],
    lines: [
      ['c', 'Quanto custa colocar aparelho?'],
      ['ia', 'Oi, Larissa! A instalação do aparelho fixo começa em R$ 1.800 e a manutenção mensal é R$ 200. Antes, o Dr. Rafael faz uma avaliação ortodôntica gratuita para indicar o melhor tipo. Quer marcar?', 0.4],
      ['c', 'Tem pra amanhã?', 7],
      ['ia', 'Amanhã o Dr. Rafael tem às 10h, 14h e 16h30. Qual prefere?', 0.3],
    ],
  },
  {
    name: 'Eduardo Nunes', minutesAgo: 2100, stage: 'perdido', temp: 'frio', tags: ['implante'],
    lines: [
      ['c', 'Achei caro o implante, vou ver outros lugares'],
      ['ia', 'Tudo bem, Eduardo! O orçamento vale por 7 dias e dá para parcelar em até 10x no cartão. Se quiser conversar com a Dra. Luiza sobre as opções, é só me chamar. 😉', 0.3],
    ],
  },
];

/* ---------- geração ---------- */
export function buildDemo(now = new Date()): DemoDB {
  rnd = mulberry32(20261002);
  idCounter = 1;
  const nowIso = now.toISOString();
  const today = localDate(now, TZ);
  const at = (date: string, hhmm: string) => fromLocal(date, hhmm, TZ).toISOString();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
  const hhmm = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  const company = companyRow(nowIso, today);
  const services = serviceRows(company.created_at);
  const professionals = professionalRows(company.created_at, services);
  const svc = (name: string) => services.find((s) => s.name.startsWith(name))!;
  const pro = (name: string) => professionals.find((p) => p.name.includes(name))!;
  const proFor = (s: Service) => { const list = professionals.filter((p) => !p.service_ids.length || p.service_ids.includes(s.id)); return list.length ? pick(list) : professionals[0]; };

  const ai: AiSettings = {
    company_id: DEMO_COMPANY_ID, enabled: true, assistant_name: 'Lia', tone: 'amigavel', use_emojis: true,
    instructions: 'Pagamento particular: Pix, cartão de débito ou crédito em até 10x sem juros nos tratamentos acima de R$ 1.000.\nConvênio: o paciente traz a carteirinha e um documento com foto. Procedimentos que precisam de autorização do convênio são liberados pela recepção.\nCrianças são atendidas pela Dra. Marina, sempre com o responsável.\nChegar 10 minutos antes. Atrasos acima de 15 minutos podem precisar ser remarcados.\nEstacionamento rotativo em frente ao prédio.',
    greeting: 'Oi! Aqui é a Lia, da Vida Plena Odontologia. Como posso te ajudar?',
    schedule_mode: 'sempre', booking_mode: 'automatico', can_quote: true, max_discount_pct: 10, handoff_on_complaint: true,
    faq: DEMO_FAQ, web_search: false,
  };
  const whatsapp: WhatsAppAccount = {
    company_id: DEMO_COMPANY_ID, phone_number_id: '109876543210987', waba_id: '102938475610293', display_phone: '+55 61 99876-5432',
    verified_name: 'Vida Plena Odontologia', status: 'conectado', last_error: null, connected_at: new Date(now.getTime() - 120 * 86400000).toISOString(),
  };
  const members: Member[] = [
    { company_id: DEMO_COMPANY_ID, user_id: DEMO_USER_ID, role: 'dono', name: 'Você (demonstração)', email: 'voce@vidaplena.odo.br', phone: '5561999990000', phone_verified_at: new Date(now.getTime() - 119 * 86400000).toISOString(), active: true, created_at: company.created_at },
    { company_id: DEMO_COMPANY_ID, user_id: demoId('ab'), role: 'gerente', name: 'Patrícia Lemos', email: 'patricia@vidaplena.odo.br', phone: '5561988887777', phone_verified_at: new Date(now.getTime() - 90 * 86400000).toISOString(), active: true, created_at: company.created_at },
    { company_id: DEMO_COMPANY_ID, user_id: demoId('ab'), role: 'atendente', name: 'Carla Mendes', email: 'recepcao@vidaplena.odo.br', phone: null, phone_verified_at: null, active: true, created_at: company.created_at },
  ];

  const contacts: Contact[] = [];
  const quotes: Quote[] = [];
  const quote_items: QuoteItem[] = [];
  const appointments: Appointment[] = [];
  const sales: Sale[] = [];
  const msgStats: DemoDB['msgStats'] = {};
  const oldStats: DemoDB['oldStats'] = {};
  let quoteSeq = 260;

  const usedNames = new Set<string>();
  const newName = () => { for (let i = 0; i < 50; i++) { const n = `${pick(FIRST)} ${pick(LAST)}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } } return `${pick(FIRST)} ${pick(LAST)} ${int(2, 9)}`; };
  const newPhone = () => normalizePhone(`61 9${int(8100, 9999)}${String(int(0, 9999)).padStart(4, '0')}`);
  const birthday = () => `${int(1955, 2016)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;

  const makeContact = (createdAt: string, opts: Partial<Contact> = {}): Contact => {
    const insured = chance(0.38);
    const c: Contact = {
      id: demoId('c0'), company_id: DEMO_COMPANY_ID, name: opts.name ?? newName(), phone: opts.phone ?? newPhone(), email: null,
      address: null, notes: null, tags: opts.tags ?? [], stage: opts.stage ?? 'novo', temperature: opts.temperature ?? 'frio',
      score: 0, source: opts.source ?? weighted<ContactSource>([['whatsapp', 72], ['instagram', 12], ['indicacao', 12], ['manual', 4]]), opt_in: true,
      birthday: chance(0.7) ? birthday() : null, last_interaction_at: createdAt, total_spent: 0, created_via: opts.created_via ?? 'ia_cliente', created_at: createdAt, updated_at: createdAt,
      insurance: insured ? pick(DEMO_INSURANCES) : null, insurance_card: insured ? String(int(10000000, 99999999)) : null, guardian_name: null,
    };
    if (c.name && chance(0.3)) c.email = `${c.name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${c.name.split(' ')[1]?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') ?? 'paciente'}@gmail.com`;
    contacts.push(c);
    return c;
  };

  // tratamentos que viram orçamento
  const pickTreatment = (): { service: Service; qty: number }[] => {
    const main = weighted<string>([['Restauração', 34], ['Clareamento a laser', 14], ['Tratamento de canal', 14], ['Instalação de aparelho', 12], ['Implante', 8], ['Clareamento caseiro', 10], ['Extração', 8]]);
    return [{ service: svc(main), qty: main === 'Restauração' ? int(1, 3) : 1 }];
  };
  // consultas do dia a dia (sem orçamento)
  const pickVisit = () => svc(weighted<string>([['Avaliação (', 26], ['Limpeza', 30], ['Manutenção de aparelho', 22], ['Avaliação ortodôntica', 8], ['Urgência', 6], ['Restauração', 8]]));
  const priceOf = (s: Service) => s.price_type === 'a_partir_de' ? Math.round(s.price * between(1, 1.3) / 10) * 10 : s.price;
  const payKind = (c: Contact, s: Service) => (c.insurance && ['Limpeza (profilaxia)', 'Restauração', 'Avaliação (primeira consulta)', 'Urgência (dor)', 'Tratamento de canal', 'Extração simples'].includes(s.name) && chance(0.85) ? 'convenio' as const : 'particular' as const);

  // agenda de cada profissional, sem sobreposição (passos de 30 minutos)
  const busy = new Map<string, [number, number][]>();
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const proHours = (p: Professional, day: string) => (p.business_hours ?? company.business_hours)[String(weekdayOf(day))] ?? [];
  const isBusy = (p: Professional, day: string, a: number, b: number) => (busy.get(`${p.id}:${day}`) ?? []).some(([x, y]) => x < b && a < y);
  const reserve = (p: Professional, day: string, a: number, b: number) => { const k = `${p.id}:${day}`; busy.set(k, [...(busy.get(k) ?? []), [a, b]]); };
  const freeAt = (p: Professional, day: string, dur: number, from = 0): number | null => {
    for (const [o, c] of proHours(p, day)) for (let m = Math.max(toMin(o), Math.ceil(from / 30) * 30); m + dur <= toMin(c); m += 30) if (!isBusy(p, day, m, m + dur)) return m;
    return null;
  };
  const book = (sv: Service, day: string, from: number, p = proFor(sv)): { pro: Professional; starts: string } | null => {
    const m = freeAt(p, day, sv.duration_min, from);
    if (m == null) return null;
    reserve(p, day, m, m + sv.duration_min);
    return { pro: p, starts: at(day, hhmm(Math.floor(m / 60), m % 60)) };
  };
  // consultas citadas nas conversas: o horário fica reservado antes de montar o resto da agenda
  const nextWd = (target: number) => { let d = addDays(today, 1); while (weekdayOf(d) !== target) d = addDays(d, 1); return d; };
  const scripted: [string, string, string, string, string][] = [
    ['Juliana Ribeiro', 'Marina', 'Limpeza', nextWd(5), '14:00'], ['Marcos Teixeira', 'Rafael', 'Manutenção de aparelho', nextWd(6), '09:00'],
    ['Bruno Carvalho', 'Marina', 'Restauração', nextWd(3), '16:00'], ['Pedro Barbosa', 'Marina', 'Avaliação (', nextWd(1), '09:00'], ['Gustavo Pereira', 'Marina', 'Restauração', nextWd(1), '11:00'],
  ];
  for (const [, who, sname, d, time] of scripted) reserve(pro(who), d, toMin(time), toMin(time) + svc(sname).duration_min);
  const VISIT_W: Record<string, number> = { 'Avaliação (primeira consulta)': 6, 'Limpeza (profilaxia)': 9, 'Manutenção de aparelho': 12, 'Avaliação ortodôntica': 4, 'Urgência (dor)': 2, 'Restauração': 4, 'Extração simples': 2, 'Implante dentário': 1, 'Tratamento de canal': 2 };

  const pushAppt = (contact: Contact, s: Service, starts: string, status: Appointment['status'], via: Appointment['created_via'], createdAt: string, price: number | null, title?: string, p = proFor(s)): Appointment => {
    const kind = payKind(contact, s);
    const ends = new Date(Date.parse(starts) + s.duration_min * 60000).toISOString();
    const future = Date.parse(starts) > now.getTime();
    const confirmed = status === 'concluido' || (status !== 'cancelado' && status !== 'faltou' && (future ? Date.parse(starts) - now.getTime() < 30 * 3600000 && chance(0.62) : true));
    const ap: Appointment = {
      id: demoId('b0'), company_id: DEMO_COMPANY_ID, contact_id: contact.id, service_id: s.id, title: title ?? s.name, starts_at: starts, ends_at: ends, status, address: null, notes: null,
      price: kind === 'convenio' ? null : price, created_via: via, reminder_sent_at: future && Date.parse(starts) - now.getTime() > 24 * 3600000 ? null : new Date(Date.parse(starts) - 86400000).toISOString(),
      created_at: createdAt, updated_at: createdAt, professional_id: p.id, payment_kind: kind, insurance: kind === 'convenio' ? contact.insurance : null,
      patient_confirmed_at: confirmed && (status !== 'concluido' || chance(0.82)) ? new Date(Math.min(Date.parse(starts) - int(2, 20) * 3600000, now.getTime() - 60000)).toISOString() : null,
    };
    appointments.push(ap);
    return ap;
  };
  const paySale = (contact: Contact, ap: Appointment, amount: number, via: 'ia' | 'equipe', quoteId: string | null = null) => {
    const method = weighted<PayMethod>([['pix', 46], ['cartao_credito', 32], ['cartao_debito', 16], ['dinheiro', 6]]);
    sales.push({ id: demoId('e0'), company_id: DEMO_COMPANY_ID, contact_id: contact.id, quote_id: quoteId, appointment_id: ap.id, description: ap.title, amount, method, origin: via, paid_at: ap.ends_at, created_via: chance(0.3) ? 'ia_dono' : 'painel', created_at: ap.ends_at });
    contact.total_spent += amount;
    contact.last_interaction_at = ap.ends_at;
  };

  /** Preenche a agenda de um dia: cada profissional, nos seus horários, com consultas que ele faz. */
  const fillDay = (day: string, aiOn: boolean, noShow: number, pool: Contact[], fill = 0.72) => {
    for (const p of professionals) {
      const mine = services.filter((sv) => (!p.service_ids.length || p.service_ids.includes(sv.id)) && VISIT_W[sv.name]);
      if (!mine.length) continue;
      for (const [o, c] of proHours(p, day)) {
        let m = toMin(o);
        while (m < toMin(c)) {
          const sv = weighted<Service>(mine.map((x) => [x, VISIT_W[x.name]]));
          if (m + sv.duration_min > toMin(c)) break;
          if (isBusy(p, day, m, m + sv.duration_min) || !chance(fill)) { m += 30; continue; }
          reserve(p, day, m, m + sv.duration_min);
          const starts = at(day, hhmm(Math.floor(m / 60), m % 60));
          const future = Date.parse(starts) > now.getTime();
          const contact = chance(0.55) && contacts.length > 40 ? pick(contacts.slice(-260)) : pick(pool.length ? pool : contacts.slice(-40));
          const via: Appointment['created_via'] = aiOn ? weighted([['ia_cliente', 68], ['painel', 32]]) : 'painel';
          const status: Appointment['status'] = future ? (chance(0.08) ? 'pendente' : 'confirmado') : weighted([['concluido', 1 - noShow - 0.05], ['faltou', noShow], ['cancelado', 0.05]]);
          const createdAt = new Date(Math.min(Date.parse(starts) - int(1, 12) * 86400000, now.getTime() - 3600000)).toISOString();
          const ap = pushAppt(contact, sv, starts, status, via, createdAt, priceOf(sv), undefined, p);
          if (status === 'faltou') ap.patient_confirmed_at = null;
          if (status === 'concluido' && ap.price && ap.price > 0) paySale(contact, ap, ap.price, via === 'ia_cliente' ? 'ia' : 'equipe');
          if (contact.tags.length === 0) contact.tags = [(sv.category ?? 'consulta').toLowerCase()];
          if (contact.stage === 'novo' || contact.stage === 'conversando') contact.stage = 'fechado';
          m += sv.duration_min;
        }
      }
    }
  };

  // dias do histórico (do mais antigo ao mais novo)
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const day = addDays(today, -back);
    const wd = weekdayOf(day);
    const progress = (HISTORY_DAYS - back) / HISTORY_DAYS; // 0 → 1
    const wf = [0.15, 1.1, 1.05, 1.0, 1.05, 0.95, 0.55][wd];
    const season = 1 + 0.1 * Math.sin((progress * 2 * Math.PI) - 0.6);
    // crescimento ao longo do ano, salto quando a IA entrou e um embalo nas últimas 4 semanas
    const growth = 0.55 + 0.55 * progress + (back < AI_START ? 0.22 : 0) + (back < 28 ? 0.1 * (28 - back) / 28 : 0);
    const isToday = back === 0;
    const dayFraction = isToday ? Math.min(1, Math.max(0.05, (localParts(now, TZ).h * 60 + localParts(now, TZ).mi - 7 * 60) / (12 * 60))) : 1;
    const conv = Math.max(0, Math.round(16 * wf * season * growth * between(0.8, 1.2) * dayFraction));
    const aiOn = back < AI_START;
    const msgsIn = Math.round(conv * between(3.4, 4.6));
    const replies = Math.round(msgsIn * 0.93);
    const msgsAi = aiOn ? Math.round(replies * between(0.84, 0.92)) : 0;
    const msgsTeam = replies - msgsAi;
    const respCount = Math.round(conv * 1.6);
    const avgResp = aiOn ? between(30, 65) + (msgsTeam / Math.max(1, replies)) * between(300, 700) : between(1500, 3000);
    msgStats[day] = { msgs_in: msgsIn, msgs_ai: msgsAi, msgs_team: msgsTeam, conversations: conv, response_sum: Math.round(avgResp * respCount), response_count: respCount, handoffs: aiOn ? Math.round(conv * between(0.06, 0.12)) : 0 };

    const newContacts = Math.round(conv * between(0.38, 0.5));
    const nQuotes = Math.round(conv * (aiOn ? 0.16 : 0.11) * between(0.85, 1.15));
    const nVisits = wd === 0 ? 0 : Math.round((wd === 6 ? 7 : 16) * season * growth * between(0.85, 1.15) * dayFraction);
    const noShow = aiOn ? 0.05 : 0.15; // com lembrete e confirmação, as faltas caem
    if (back >= RAW_DAYS) {
      // só agregados para dias antigos (e alguns pacientes antigos para retorno e reativação)
      let approved = 0, value = 0, salesAmt = 0, ia = 0, eq = 0, nSales = 0, appts = 0;
      for (let q = 0; q < nQuotes; q++) {
        const total = pickTreatment().reduce((s, it) => s + priceOf(it.service) * it.qty, 0);
        if (chance(aiOn ? 0.55 : 0.46)) { approved++; value += total; salesAmt += total; nSales++; appts++; if (aiOn && chance(0.55)) ia += total; else eq += total; }
      }
      for (let k = 0; k < nVisits; k++) {
        if (chance(noShow)) continue;
        appts++;
        const v = pickVisit(); const amt = chance(0.4) ? 0 : v.price; // parte é convênio (pago depois pelo plano)
        if (amt > 0) { salesAmt += amt; nSales++; if (aiOn && chance(0.5)) ia += amt; else eq += amt; }
      }
      oldStats[day] = { new_contacts: newContacts, quotes_created: nQuotes, quotes_sent: nQuotes, quotes_approved: approved, quotes_value: value, sales_count: nSales, sales_amount: salesAmt, sales_ia: ia, sales_equipe: eq, sales_balcao: 0, appointments: appts };
      if (chance(0.4)) {
        const ca = at(day, hhmm(int(8, 18), int(0, 59)));
        const c = makeContact(ca, { stage: 'fechado', temperature: 'frio', created_via: aiOn ? 'ia_cliente' : 'painel' });
        c.total_spent = Math.round(between(220, 2400));
        c.last_interaction_at = ca;
        if (chance(0.3)) c.tags = ['recorrente'];
        // limpeza há uns 6 meses: o retorno automático convida de novo
        if (back > 165 && back < 200 && chance(0.6)) pushAppt(c, svc('Limpeza'), at(day, hhmm(int(8, 17))), 'concluido', 'painel', ca, svc('Limpeza').price);
      }
      continue;
    }

    // dias recentes: linhas de verdade
    const dayContacts: Contact[] = [];
    for (let k = 0; k < newContacts; k++) {
      let ca = at(day, hhmm(int(7, 21), int(0, 59)));
      if (Date.parse(ca) > now.getTime()) ca = minutesAgo(int(5, 60));
      dayContacts.push(makeContact(ca, { stage: 'conversando', temperature: back < 3 ? 'quente' : back < 14 ? 'morno' : 'frio' }));
    }
    const pool = dayContacts.length ? dayContacts : contacts.slice(-20);
    // consultas do dia na agenda de cada profissional (marcadas antes, a maioria pela IA)
    fillDay(day, aiOn, noShow, pool);
    // orçamentos de tratamento
    for (let q = 0; q < nQuotes && pool.length; q++) {
      const contact = pick(pool);
      const createdAt = (() => { const t = Date.parse(contact.created_at) + int(5, 180) * 60000; return new Date(Math.min(t, now.getTime() - 60000)).toISOString(); })();
      const its = pickTreatment();
      const id = demoId('a0');
      let subtotal = 0;
      its.forEach((it, idx) => {
        const unit = priceOf(it.service);
        subtotal += unit * it.qty;
        quote_items.push({ id: demoId('a1'), quote_id: id, company_id: DEMO_COMPANY_ID, service_id: it.service.id, description: it.service.name, qty: it.qty, unit_price: unit, sort: idx });
      });
      const discount = chance(0.15) ? Math.round(subtotal * pick([0.05, 0.1])) : 0;
      const total = subtotal - discount;
      const via = aiOn ? weighted<Quote['created_via']>([['ia_cliente', 55], ['ia_dono', 15], ['painel', 30]]) : 'painel';
      let status: Quote['status'];
      if (back <= 1) status = weighted([['enviado', 62], ['rascunho', 8], ['aprovado', 30]]);
      else if (back <= 7) status = weighted([['enviado', 30], ['aprovado', 50], ['recusado', 14], ['rascunho', 6]]);
      else status = weighted([['aprovado', 54], ['recusado', 20], ['expirado', 26]]);
      const respondedAt = status === 'aprovado' || status === 'recusado' ? new Date(Math.min(Date.parse(createdAt) + int(1, 72) * 3600000, now.getTime() - 30000)).toISOString() : null;
      quoteSeq++;
      quotes.push({
        id, company_id: DEMO_COMPANY_ID, number: quoteSeq, contact_id: contact.id, title: its[0].service.name, status, subtotal, discount, total,
        valid_until: addDays(localDate(createdAt, TZ), 7), notes: null, public_token: token(), sent_at: status === 'rascunho' ? null : createdAt,
        responded_at: respondedAt, followup_sent_at: status === 'enviado' && back >= 2 ? new Date(Date.parse(createdAt) + 2 * 86400000).toISOString() : null,
        created_via: via, created_at: createdAt, updated_at: respondedAt ?? createdAt,
      });
      contact.stage = status === 'aprovado' ? 'fechado' : status === 'recusado' || status === 'expirado' ? (chance(0.6) ? 'perdido' : 'conversando') : 'orcamento';
      if (status === 'enviado') contact.temperature = back <= 2 ? 'quente' : 'morno';
      contact.tags = [its[0].service.category?.toLowerCase() ?? 'tratamento'];
      if (status === 'aprovado' && respondedAt) {
        const apDay = addDays(localDate(respondedAt, TZ), int(1, 8));
        const apWd = weekdayOf(apDay);
        const slot = apWd !== 0 ? book(its[0].service, apDay, int(8, 16) * 60) : null;
        if (slot) {
          const starts = slot.starts;
          const future = Date.parse(starts) > now.getTime();
          const apStatus: Appointment['status'] = future ? weighted([['confirmado', 88], ['pendente', 12]]) : weighted([['concluido', 90], ['faltou', 3], ['cancelado', 7]]);
          const ap = pushAppt(contact, its[0].service, starts, apStatus, via === 'painel' ? 'painel' : 'ia_cliente', respondedAt, total, its.map((i) => (i.qty > 1 ? `${i.service.name} (${i.qty})` : i.service.name)).join(' + '), slot.pro);
          ap.payment_kind = 'particular'; ap.insurance = null; ap.price = total;
          if (apStatus === 'concluido') paySale(contact, ap, total, via === 'painel' ? 'equipe' : 'ia', id);
        }
      }
    }
  }

  // conversas recentes escritas à mão
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  for (const sc of SCRIPTS) {
    const firstLineAt = now.getTime() - sc.minutesAgo * 60000 - sc.lines.reduce((s, l) => s + (l[2] ?? 0), 0) * 60000;
    const contact = makeContact(new Date(firstLineAt - int(0, 20) * 86400000).toISOString(), { name: sc.name, stage: sc.stage, temperature: sc.temp, tags: sc.tags });
    if (sc.name === 'Juliana Ribeiro') { contact.insurance = 'Unimed Odonto'; contact.insurance_card = '00871234'; }
    if (sc.name === 'Simone Barbosa') { contact.guardian_name = 'Simone Barbosa'; contact.name = 'Pedro Barbosa (filho de Simone)'; contact.birthday = `${Number(today.slice(0, 4)) - 7}-05-12`; }
    const conv: Conversation = {
      id: demoId('f0'), company_id: DEMO_COMPANY_ID, contact_id: contact.id, member_user_id: null, kind: 'cliente', channel: 'whatsapp', handler: sc.handler ?? 'ia', status: 'aberta',
      needs_attention: !!sc.attention, attention_reason: sc.attention ?? null, unread: sc.unread ?? 0, last_message_at: null, last_message_preview: null, last_inbound_at: null, created_at: new Date(firstLineAt).toISOString(),
    };
    let t = firstLineAt; let lastInbound: number | null = null;
    sc.lines.forEach(([who, text, after, actions], i) => {
      t += (after ?? 0) * 60000;
      const iso = new Date(t).toISOString();
      const inbound = who === 'c';
      messages.push({
        id: demoId('f1'), company_id: DEMO_COMPANY_ID, conversation_id: conv.id, direction: inbound ? 'in' : 'out',
        sender: inbound ? 'contato' : who === 'ia' ? 'ia' : who === 'eq' ? 'equipe' : 'sistema', sender_name: who === 'eq' ? 'Carla Mendes' : who === 'ia' ? 'Lia (IA)' : null,
        body: text, media: sc.media?.[i] ?? null, wa_status: inbound ? null : 'lida', actions: actions ?? null,
        response_seconds: !inbound && lastInbound ? Math.round((t - lastInbound) / 1000) : null, channel: 'whatsapp', created_at: iso,
      });
      if (inbound) lastInbound = t; else lastInbound = null;
      conv.last_message_at = iso; conv.last_message_preview = text.slice(0, 120);
      if (inbound) conv.last_inbound_at = iso;
    });
    contact.last_interaction_at = conv.last_message_at;
    conversations.push(conv);
  }
  // consultas citadas nas conversas (os horários já estavam reservados)
  const named = (n: string) => contacts.find((c) => c.name.startsWith(n))!;
  for (const [n, who, sname, d, time] of scripted) {
    const c = named(n); const sv = svc(sname);
    const ap = pushAppt(c, sv, at(d, time), 'confirmado', 'ia_cliente', minutesAgo(30), sname === 'Restauração' && n === 'Bruno Carvalho' ? 560 : priceOf(sv), sname === 'Restauração' && n === 'Bruno Carvalho' ? 'Restauração (2)' : undefined, pro(who));
    ap.patient_confirmed_at = null;
    if (n === 'Juliana Ribeiro') { ap.payment_kind = 'convenio'; ap.insurance = 'Unimed Odonto'; ap.price = null; }
    else { ap.payment_kind = 'particular'; ap.insurance = null; }
  }
  // próximos dias: a agenda vai ficando mais vazia quanto mais longe
  for (let plus = 1; plus <= 5; plus++) fillDay(addDays(today, plus), true, 0.05, contacts.slice(-120), [0.66, 0.55, 0.45, 0.36, 0.28][plus - 1]);

  // algumas conversas antigas resolvidas, só com prévia
  for (let k = 0; k < 10; k++) {
    const c = contacts[contacts.length - 40 - k * 3]; if (!c) break;
    const t = new Date(now.getTime() - int(2, 9) * 86400000 - int(0, 600) * 60000).toISOString();
    const conv: Conversation = { id: demoId('f0'), company_id: DEMO_COMPANY_ID, contact_id: c.id, member_user_id: null, kind: 'cliente', channel: 'whatsapp', handler: 'ia', status: 'resolvida', needs_attention: false, attention_reason: null, unread: 0, last_message_at: t, last_message_preview: pick(['Combinado! Até lá 😊', 'Obrigada, até mais!', 'Presença confirmada ✅', 'Perfeito, obrigado!']), last_inbound_at: t, created_at: t };
    conversations.push(conv);
    messages.push({ id: demoId('f1'), company_id: DEMO_COMPANY_ID, conversation_id: conv.id, direction: 'in', sender: 'contato', sender_name: null, body: pick(['Tem horário para limpeza amanhã?', 'Vocês aceitam Amil Dental?', 'SIM', 'Quanto custa a avaliação?']), media: null, wa_status: null, actions: null, response_seconds: null, channel: 'whatsapp', created_at: new Date(Date.parse(t) - 4 * 60000).toISOString() });
    messages.push({ id: demoId('f1'), company_id: DEMO_COMPANY_ID, conversation_id: conv.id, direction: 'out', sender: 'ia', sender_name: 'Lia (IA)', body: conv.last_message_preview!, media: null, wa_status: 'lida', actions: null, response_seconds: 34, channel: 'whatsapp', created_at: t });
  }

  // conversa do dono com a IA (assistente)
  const ownerConv: Conversation = { id: demoId('f0'), company_id: DEMO_COMPANY_ID, contact_id: null, member_user_id: DEMO_USER_ID, kind: 'dono', channel: 'whatsapp', handler: 'ia', status: 'aberta', needs_attention: false, attention_reason: null, unread: 0, last_message_at: minutesAgo(70), last_message_preview: 'Pagamento registrado.', last_inbound_at: minutesAgo(71), created_at: minutesAgo(5000) };
  conversations.push(ownerConv);
  const maria = makeContact(minutesAgo(190), { name: 'Maria Oliveira', phone: '5561999999999', stage: 'orcamento', temperature: 'quente', created_via: 'ia_dono', source: 'manual', tags: ['implante'] });
  maria.insurance = null; maria.insurance_card = null;
  quoteSeq++;
  const mariaQuote: Quote = { id: demoId('a0'), company_id: DEMO_COMPANY_ID, number: quoteSeq, contact_id: maria.id, title: 'Implante dentário', status: 'enviado', subtotal: 3500, discount: 0, total: 3500, valid_until: addDays(today, 7), notes: 'Parcelamos em até 10x no cartão.', public_token: token(), sent_at: minutesAgo(189), responded_at: null, followup_sent_at: null, created_via: 'ia_dono', created_at: minutesAgo(190), updated_at: minutesAgo(189) };
  quotes.push(mariaQuote);
  quote_items.push({ id: demoId('a1'), quote_id: mariaQuote.id, company_id: DEMO_COMPANY_ID, service_id: svc('Implante').id, description: 'Implante dentário (sem a coroa)', qty: 1, unit_price: 3500, sort: 0 });
  const tomorrow = (() => { let d = addDays(today, 1); if (weekdayOf(d) === 0) d = addDays(d, 1); return d; })();
  const ownerLines: [boolean, string, number, ActionReceipt[]?][] = [
    [true, 'Cadastra a Maria Oliveira, 61999999999, e manda o orçamento do implante de R$ 3.500 pra ela.', 191],
    [false, 'Feito! ✅\n• Cadastrei a paciente Maria Oliveira — (61) 99999-9999\n• Criei o orçamento nº ' + String(mariaQuote.number).padStart(4, '0') + ' de R$ 3.500,00 (implante) e enviei o link no WhatsApp dela\nTe aviso quando ela responder.', 190, [
      { tool: 'cadastrar_cliente', label: 'Paciente Maria cadastrada', status: 'ok', detail: '(61) 99999-9999' },
      { tool: 'criar_orcamento', label: 'Orçamento de R$ 3.500 criado', status: 'ok', detail: `nº ${String(mariaQuote.number).padStart(4, '0')}` },
      { tool: 'enviar_orcamento', label: 'Orçamento enviado no WhatsApp', status: 'ok' },
    ]],
    [true, 'Quem ainda não confirmou amanhã?', 75],
    [false, '', 74],
    [true, 'Registra o pagamento de R$ 280 no Pix do Bruno Carvalho', 72],
    [false, 'Vou registrar o recebimento de R$ 280,00 no Pix de Bruno Carvalho. Como é uma movimentação financeira, preciso da sua confirmação: responda SIM para confirmar ou NÃO para cancelar.', 71.5, [{ tool: 'registrar_venda', label: 'Recebimento aguardando confirmação', status: 'aguardando', detail: 'R$ 280,00 · Pix · Bruno Carvalho' }]],
    [true, 'SIM', 71],
    [false, 'Pagamento registrado. ✅ R$ 280,00 no Pix de Bruno Carvalho.', 70, [{ tool: 'registrar_venda', label: 'Recebimento de R$ 280 registrado', status: 'ok', detail: 'Pix · Bruno Carvalho' }]],
  ];
  // quem ainda não confirmou amanhã, calculado com a agenda gerada
  const tomorrowList = appointments.filter((x) => localDate(x.starts_at, TZ) === tomorrow && x.status !== 'cancelado').sort((x, y) => (x.starts_at < y.starts_at ? -1 : 1));
  const pending = tomorrowList.filter((x) => !x.patient_confirmed_at);
  const nameOf = (id: string | null) => contacts.find((c) => c.id === id)?.name ?? 'Paciente';
  const proFirst = (id?: string | null) => professionals.find((p) => p.id === id)?.name.split(' ').slice(0, 2).join(' ') ?? '';
  ownerLines[3][1] = pending.length
    ? `Amanhã são ${tomorrowList.length} consultas. ${pending.length} ainda não ${pending.length === 1 ? 'confirmou' : 'confirmaram'}:\n${pending.slice(0, 6).map((x) => `• ${localParts(new Date(x.starts_at), TZ).h.toString().padStart(2, '0')}:${String(localParts(new Date(x.starts_at), TZ).mi).padStart(2, '0')} ${nameOf(x.contact_id)} — ${x.title} (${proFirst(x.professional_id)})`).join('\n')}\nO lembrete com pedido de confirmação sai hoje às 19h. Quer que eu mande agora?`
    : `Amanhã são ${tomorrowList.length} consultas e todos já confirmaram. ✅`;
  ownerLines[3][3] = [{ tool: 'consultar_agenda', label: 'Agenda de amanhã consultada', status: 'ok', detail: `${pending.length} sem confirmar` }];
  for (const [inbound, text, mAgo, actions] of ownerLines) {
    messages.push({ id: demoId('f1'), company_id: DEMO_COMPANY_ID, conversation_id: ownerConv.id, direction: inbound ? 'in' : 'out', sender: inbound ? 'dono' : 'ia', sender_name: inbound ? 'Você' : 'Lia (IA)', body: text, media: null, wa_status: inbound ? null : 'lida', actions: actions ?? null, response_seconds: inbound ? null : 6, channel: 'whatsapp', created_at: minutesAgo(mAgo) });
  }
  const bruno = contacts.find((c) => c.name === 'Bruno Carvalho');
  sales.push({ id: demoId('e0'), company_id: DEMO_COMPANY_ID, contact_id: bruno?.id ?? null, quote_id: null, appointment_id: null, description: 'Restauração (sinal)', amount: 280, method: 'pix', origin: 'ia', paid_at: minutesAgo(70), created_via: 'ia_dono', created_at: minutesAgo(70) });

  // pontuação dos leads
  for (const c of contacts) {
    const ageDays = (now.getTime() - Date.parse(c.last_interaction_at ?? c.created_at)) / 86400000;
    c.score = Math.max(5, Math.min(98, Math.round((c.temperature === 'quente' ? 82 : c.temperature === 'morno' ? 55 : 24) + between(-10, 10) - Math.min(20, ageDays / 3))));
    if (ageDays > 30 && c.temperature !== 'frio') c.temperature = 'frio';
  }

  // tarefas da equipe
  const tasks: Task[] = [
    { title: 'Repor anestésico e resina A2 (estoque baixo)', due: at(today, '17:00'), done: false },
    { title: 'Enviar as guias do mês para o Amil Dental (faturamento)', due: at(addDays(today, 1), '10:00'), done: false },
    { title: 'Ligar para a Débora Cardoso depois da urgência', due: at(addDays(today, 1), '09:00'), done: false },
    { title: 'Revisar os valores do clareamento', due: at(addDays(today, 5), '09:00'), done: false },
    { title: 'Postar antes e depois autorizado no Instagram', due: at(addDays(today, -1), '18:00'), done: true },
    { title: 'Renovar o alvará da vigilância sanitária', due: at(addDays(today, -3), '12:00'), done: true },
  ].map((t, i) => ({ id: demoId('70'), company_id: DEMO_COMPANY_ID, title: t.title, due_at: t.due, done_at: t.done ? t.due : null, contact_id: null, reminded_at: null, created_via: i % 2 ? 'painel' : 'ia_dono', created_at: minutesAgo(3000 + i * 400) }));

  // automações
  const autos: [AutomationKind, boolean, Automation['config'], string | null][] = [
    ['lembrete_agendamento', true, { horas_antes: 24, pedir_confirmacao: true }, 'lembrete_agendamento'],
    ['followup_orcamento', true, { dias_depois: 2, max_tentativas: 2 }, 'acompanhamento_orcamento'],
    ['resumo_diario', true, { horario: '19:00', incluir_agenda: true }, 'resumo_diario'],
    ['pos_atendimento', true, { horas_depois: 3, pedir_avaliacao: true, link_avaliacao: 'g.page/vidaplena' }, 'pos_atendimento'],
    ['reativacao', false, { dias_sem_compra: 210, desconto_pct: 0 }, 'reativacao_cliente'],
    ['lembrete_tarefa', true, { minutos_antes: 30 }, null],
    ['relatorio_semanal', true, { dia: 1, horario: '08:00' }, 'relatorio_semanal'],
    ['encaixe', true, { antecedencia_horas: 2 }, 'encaixe_disponivel'],
    ['retorno', true, { horario: '10:00' }, 'lembrete_retorno'],
  ];
  const automations: Automation[] = autos.map(([kind, enabled, config, template_name]) => ({ id: demoId('9a'), company_id: DEMO_COMPANY_ID, kind, enabled, config, template_name, last_run_at: enabled ? minutesAgo(int(5, 300)) : null, created_at: company.created_at }));
  const automation_runs: AutomationRun[] = [];
  const runDetail: Partial<Record<AutomationKind, string>> = { followup_orcamento: 'Orçamento sem resposta há 2 dias', lembrete_agendamento: 'Consulta amanhã · pediu confirmação', pos_atendimento: 'Pedido de avaliação', retorno: 'Retorno de Limpeza (profilaxia) (180 dias)', encaixe: 'Horário desmarcado oferecido', relatorio_semanal: 'Relatório da semana', resumo_diario: 'Resumo do dia' };
  for (let k = 0; k < 30; k++) {
    const a = pick(automations.filter((x) => x.enabled && x.kind !== 'lembrete_tarefa'));
    const c = pick(contacts.slice(-120));
    automation_runs.push({ id: demoId('9b'), company_id: DEMO_COMPANY_ID, automation_id: a.id, kind: a.kind, ran_at: minutesAgo(k * 150 + int(5, 120)), target_label: a.kind === 'resumo_diario' || a.kind === 'relatorio_semanal' ? 'Você (dono)' : c.name, status: weighted([['enviado', 90], ['ignorado', 7], ['falhou', 3]]), detail: runDetail[a.kind] ?? 'Enviado' });
  }
  automation_runs.sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1));

  // histórico de ações
  const audit_log: AuditEntry[] = [];
  const auditOf = (minutes: number, actor_type: AuditEntry['actor_type'], actor_name: string, channel: AuditEntry['channel'], action: string, summary: string, status: AuditEntry['status'] = 'ok') =>
    audit_log.push({ id: demoId('99'), company_id: DEMO_COMPANY_ID, actor_type, actor_name, channel, action, summary, target_type: null, target_id: null, status, created_at: minutesAgo(minutes) });
  auditOf(4, 'ia', 'Lia (IA)', 'ia_cliente', 'agendar', 'Marcou sexta às 14:00 para Juliana Ribeiro (Limpeza com a Dra. Marina · Unimed Odonto)');
  auditOf(19, 'ia', 'Lia (IA)', 'ia_cliente', 'criar_orcamento', 'Criou o orçamento nº 0412 de R$ 1.200,00 para Ricardo Almeida');
  auditOf(27, 'ia', 'Lia (IA)', 'ia_cliente', 'chamar_atendente', 'Passou o atendimento de Débora Cardoso para a equipe (dor e inchaço: urgência)');
  auditOf(48, 'ia', 'Lia (IA)', 'ia_cliente', 'chamar_atendente', 'Pedido de desconto de 20% de Fernanda Lopes enviado para aprovação', 'aguardando');
  auditOf(70, 'ia', 'Lia (IA)', 'ia_dono', 'registrar_venda', 'Registrou recebimento de R$ 280,00 (Pix) de Bruno Carvalho — confirmado pelo dono');
  auditOf(72, 'ia', 'Lia (IA)', 'ia_dono', 'registrar_venda', 'Pediu confirmação para registrar recebimento de R$ 280,00', 'aguardando');
  auditOf(75, 'ia', 'Lia (IA)', 'ia_dono', 'consultar_agenda', 'Consultou quem ainda não confirmou as consultas de amanhã');
  auditOf(96, 'ia', 'Lia (IA)', 'ia_cliente', 'agendar', 'Marcou sábado às 09:00 para Marcos Teixeira (Manutenção de aparelho com o Dr. Rafael)');
  auditOf(130, 'usuario', 'Carla Mendes', 'painel', 'atualizar_cliente', 'Atualizou a carteirinha do convênio de Patrícia Gomes');
  auditOf(189, 'ia', 'Lia (IA)', 'ia_dono', 'enviar_orcamento', `Enviou o orçamento nº ${String(mariaQuote.number).padStart(4, '0')} para Maria Oliveira`);
  auditOf(190, 'ia', 'Lia (IA)', 'ia_dono', 'criar_orcamento', `Criou o orçamento nº ${String(mariaQuote.number).padStart(4, '0')} de R$ 3.500,00 para Maria Oliveira`);
  auditOf(190, 'ia', 'Lia (IA)', 'ia_dono', 'cadastrar_cliente', 'Cadastrou a paciente Maria Oliveira — (61) 99999-9999');
  auditOf(211, 'ia', 'Lia (IA)', 'ia_cliente', 'chamar_atendente', 'Encaminhou dúvida pós-cirurgia de Helena Duarte para a Dra. Luiza');
  auditOf(320, 'ia', 'Lia (IA)', 'ia_cliente', 'agendar', 'Marcou quarta às 16:00 para Bruno Carvalho (Restauração com a Dra. Marina)');
  auditOf(321, 'ia', 'Lia (IA)', 'ia_cliente', 'criar_orcamento', 'Criou o orçamento nº 0409 de R$ 560,00 para Bruno Carvalho');
  auditOf(380, 'sistema', 'Automação', 'automacao', 'followup_orcamento', 'Enviou acompanhamento do orçamento para 3 pacientes');
  auditOf(600, 'ia', 'Lia (IA)', 'ia_cliente', 'remarcar', 'Remarcou a consulta de Gustavo Pereira para segunda às 11:00');
  auditOf(720, 'usuario', 'Patrícia Lemos', 'painel', 'atualizar_servico', 'Alterou o valor de "Limpeza (profilaxia)" de R$ 200,00 para R$ 220,00');
  auditOf(1100, 'sistema', 'Automação', 'automacao', 'resumo_diario', 'Enviou o resumo do dia para o dono');
  auditOf(1290, 'ia', 'Lia (IA)', 'ia_cliente', 'confirmar_presenca', 'Thiago Martins confirmou presença na manutenção do aparelho');
  auditOf(1440, 'sistema', 'Automação', 'automacao', 'lembrete_agendamento', 'Enviou 14 lembretes com pedido de confirmação para amanhã');
  auditOf(1500, 'sistema', 'Automação', 'automacao', 'retorno', 'Convidou 4 pacientes para o retorno da limpeza');
  auditOf(2000, 'ia', 'Lia (IA)', 'ia_dono', 'cancelar_agendamento', 'Pedido para desmarcar a consulta de Lucas Dias foi recusado pelo dono', 'cancelado');

  // avisos
  const notifications: Notification[] = [
    { kind: 'atendimento', title: 'Débora Cardoso precisa de você', body: 'Dor forte e rosto inchado. A IA pediu encaixe de urgência.', link: '#/conversas', m: 26, read: false },
    { kind: 'orcamento', title: 'Pedido de desconto aguardando aprovação', body: 'Fernanda Lopes pediu 20% no implante.', link: '#/conversas', m: 47, read: false },
    { kind: 'agendamento', title: 'Nova consulta marcada pela IA', body: 'Juliana Ribeiro · sexta às 14:00 · Dra. Marina', link: '#/agenda', m: 4, read: false },
    { kind: 'atendimento', title: 'Dúvida pós-cirurgia', body: 'Helena Duarte · encaminhada para a Dra. Luiza', link: '#/conversas', m: 210, read: true },
    { kind: 'venda', title: 'Recebimento registrado pelo WhatsApp', body: 'R$ 280,00 no Pix · Bruno Carvalho', link: '#/vendas', m: 70, read: true },
    { kind: 'sistema', title: 'Resumo do dia enviado no seu WhatsApp', body: null, link: null, m: 1100, read: true },
  ].map((n) => ({ id: demoId('9c'), company_id: DEMO_COMPANY_ID, user_id: null, kind: n.kind as Notification['kind'], title: n.title, body: n.body, link: n.link, read_at: n.read ? minutesAgo(n.m - 1) : null, created_at: minutesAgo(n.m) }));

  // faturas e uso
  const invoices: Invoice[] = [0, 1, 2, 3, 4].map((k) => {
    const due = addDays(today, 17 - 30 * (k + 1));
    return { id: demoId('9d'), company_id: DEMO_COMPANY_ID, amount: 299, status: 'paga', due_date: due, paid_at: fromLocal(due, '09:12', TZ).toISOString(), method: 'cartao', url: null, description: 'ORBYTA · Plano Profissional · mensal', created_at: fromLocal(addDays(due, -10), '08:00', TZ).toISOString() };
  });
  const month = today.slice(0, 7);
  const monthAi = Object.entries(msgStats).filter(([d]) => d.startsWith(month)).reduce((s, [, v]) => s + v.msgs_ai, 0);
  const usage_monthly: UsageMonth[] = [{ company_id: DEMO_COMPANY_ID, month, ai_replies: Math.min(1480, Math.round(monthAi * 0.42)), wa_sent: Math.round(monthAi * 0.5), ai_input_tokens: 0, ai_output_tokens: 0 }];

  contacts.sort((a, b) => ((b.last_interaction_at ?? '') > (a.last_interaction_at ?? '') ? 1 : -1));
  const gestao = buildGestao(now, today, contacts);
  return {
    ...gestao,
    version: DEMO_VERSION, seededAt: nowIso, company, ai, whatsapp, members, contacts, services, professionals, quotes, quote_items, appointments, sales, tasks,
    conversations, messages, pending_actions: [], audit_log, automations, automation_runs, notifications, invoices, usage_monthly, msgStats, oldStats,
    seq: { quote: quoteSeq, id: idCounter },
  };
}

export { SCRIPTS as DEMO_SCRIPTS };
