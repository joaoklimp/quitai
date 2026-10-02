// Dados de demonstração: "Brilho Lar Higienização", empresa fictícia de limpeza de estofados em Brasília.
// Tudo é gerado em relação a "agora", com sorteio determinístico (mesma semente = mesmos dados).
import type {
  AiSettings, Appointment, AuditEntry, Automation, AutomationRun, Company, Contact, Conversation, DailyStat, Invoice,
  Member, Message, Notification, Quote, QuoteItem, Sale, Service, Task, UsageMonth, WhatsAppAccount, Stage, Temperature,
  PayMethod, ContactSource, AutomationKind, ActionReceipt, PendingAction,
} from '../types';
import { addDays, fromLocal, localDate, localParts, normalizePhone, weekdayOf } from '../../../shared/format';
import type { FinanceEntry, Product, StockMovement } from '../types';
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
  /** campos de mensagens por dia (o resto do agregado vem das linhas) */
  msgStats: Record<string, Pick<DailyStat, 'msgs_in' | 'msgs_ai' | 'msgs_team' | 'conversations' | 'response_sum' | 'response_count' | 'handoffs'>>;
  /** agregados de vendas/orçamentos para dias anteriores à janela de linhas */
  oldStats: Record<string, Pick<DailyStat, 'new_contacts' | 'quotes_created' | 'quotes_sent' | 'quotes_approved' | 'quotes_value' | 'sales_count' | 'sales_amount' | 'sales_ia' | 'sales_equipe' | 'sales_balcao' | 'appointments'>>;
  seq: { quote: number; id: number };
}

export const DEMO_VERSION = 4;
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
const BAIRROS = ['Asa Sul', 'Asa Norte', 'Águas Claras', 'Taguatinga', 'Guará', 'Sudoeste', 'Lago Sul', 'Lago Norte', 'Vicente Pires', 'Ceilândia', 'Samambaia', 'Sobradinho', 'Noroeste', 'Park Way', 'Cruzeiro', 'Jardim Botânico', 'Núcleo Bandeirante', 'Riacho Fundo', 'Gama', 'Valparaíso'];
const STREETS = ['SQS 308 Bloco C', 'SQN 214 Bloco F', 'Rua 12 Norte, Lote 4', 'QE 38 Conjunto H', 'CLN 404 Bloco B', 'QS 7 Rua 820', 'Quadra 104, Lote 8', 'SHIS QI 15 Conjunto 3', 'QNM 12 Conjunto F', 'Rua das Pitangueiras, 31', 'Avenida das Araucárias, 1500', 'QNL 7 Conjunto C', 'SQSW 304 Bloco J', 'Quadra 3 Conjunto 7', 'SMPW Quadra 26'];

/* ---------- empresa e catálogo ---------- */
function serviceRows(now: string): Service[] {
  const s = (name: string, price: number, price_type: Service['price_type'], duration_min: number, category: string, description: string, sort: number): Service => ({
    id: demoId('5e'), company_id: DEMO_COMPANY_ID, name, price, price_type, duration_min, category, description, active: true, sort, created_at: now,
  });
  return [
    s('Limpeza de sofá 2 lugares', 150, 'fixo', 90, 'Sofás', 'Higienização a seco e extração. Secagem de 4 a 6 horas.', 1),
    s('Limpeza de sofá 3 lugares', 180, 'a_partir_de', 120, 'Sofás', 'Higienização completa com extratora. Valor varia com o tecido e o estado.', 2),
    s('Limpeza de sofá retrátil ou reclinável', 240, 'a_partir_de', 150, 'Sofás', 'Inclui assento retrátil e encosto reclinável.', 3),
    s('Impermeabilização de sofá', 290, 'a_partir_de', 120, 'Sofás', 'Proteção contra líquidos por até 12 meses.', 4),
    s('Higienização de colchão casal', 160, 'fixo', 60, 'Colchões', 'Remove ácaros, fungos e manchas. Os dois lados.', 5),
    s('Higienização de colchão solteiro', 120, 'fixo', 45, 'Colchões', 'Remove ácaros, fungos e manchas. Os dois lados.', 6),
    s('Limpeza de tapete (por m²)', 25, 'a_partir_de', 60, 'Tapetes', 'Lavagem no local. Mínimo de 4 m².', 7),
    s('Limpeza de cadeira (unidade)', 35, 'fixo', 15, 'Cadeiras', 'Assento e encosto estofados.', 8),
    s('Limpeza de poltrona', 90, 'fixo', 45, 'Sofás', 'Poltronas e puffs grandes.', 9),
    s('Higienização de banco automotivo', 220, 'fixo', 120, 'Automotivo', 'Bancos, teto e carpete do carro.', 10),
    s('Visita técnica para orçamento', 0, 'sob_consulta', 30, 'Outros', 'Para condomínios, empresas e peças especiais.', 11),
  ];
}

function companyRow(nowIso: string, today: string): Company {
  return {
    id: DEMO_COMPANY_ID,
    name: 'Brilho Lar Higienização',
    segment: 'limpeza',
    document: '12.345.678/0001-90',
    phone: '5561998765432',
    email: 'contato@brilholar.com.br',
    address: 'SIA Trecho 3, Lote 1250',
    city: 'Brasília',
    state: 'DF',
    timezone: TZ,
    business_hours: { '0': [], '1': [['08:00', '18:00']], '2': [['08:00', '18:00']], '3': [['08:00', '18:00']], '4': [['08:00', '18:00']], '5': [['08:00', '18:00']], '6': [['08:00', '13:00']] },
    slot_minutes: 60,
    capacity_per_slot: 2,
    min_notice_minutes: 120,
    max_days_ahead: 45,
    monthly_goal: 32000,
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
    name: 'Juliana Ribeiro', minutesAgo: 4, stage: 'fechado', temp: 'quente', tags: ['sofá'], unread: 0,
    lines: [
      ['c', 'Oi! Quanto custa uma limpeza de sofá?'],
      ['ia', 'Olá, Juliana! 😊 A limpeza de sofá de 3 lugares começa em R$ 180, conforme a nossa tabela. O de 2 lugares sai por R$ 150. Quer consultar os horários disponíveis?', 0.4],
      ['c', 'Quero sexta-feira às 14h.', 1.5],
      ['ia', 'Temos esse horário disponível! Posso reservar para você? Só preciso do seu nome completo e do endereço.', 0.3],
      ['c', 'Juliana Ribeiro, SQS 308 Bloco C apto 204, Asa Sul', 2],
      ['ia', 'Combinado, Juliana! ✅ Reservei sexta-feira às 14h para a limpeza do sofá de 3 lugares (a partir de R$ 180). O técnico chega com tudo, você só precisa deixar o sofá livre. Qualquer coisa, é só me chamar por aqui!', 0.4, [
        { tool: 'agendar_horario', label: 'Horário reservado na agenda', status: 'ok', detail: 'Sexta às 14:00 · Limpeza de sofá 3 lugares' },
        { tool: 'atualizar_meus_dados', label: 'Cadastro atualizado', status: 'ok', detail: 'Endereço salvo' },
      ]],
    ],
  },
  {
    name: 'Ricardo Almeida', minutesAgo: 18, stage: 'orcamento', temp: 'quente', tags: ['tapete'], unread: 0,
    lines: [
      ['c', 'Boa tarde, vocês lavam tapete? O meu tem 2 por 3 metros'],
      ['ia', 'Boa tarde, Ricardo! Lavamos sim, no seu endereço mesmo. Um tapete de 2 × 3 m tem 6 m², e a limpeza fica em R$ 150 (R$ 25 por m²). Quer que eu monte o orçamento?', 0.5],
      ['c', 'Pode montar sim', 3],
      ['ia', 'Prontinho! Montei o orçamento nº 0412 de R$ 150,00 para a limpeza do tapete de 6 m². Ele vale por 7 dias. Quer aproveitar e já escolher um horário?', 0.4, [
        { tool: 'solicitar_orcamento', label: 'Orçamento nº 0412 criado', status: 'ok', detail: 'R$ 150,00 · Limpeza de tapete (6 m²)' },
      ]],
      ['c', 'Vou ver o melhor dia com minha esposa e te falo', 4],
      ['ia', 'Perfeito! Fico no aguardo. Quando decidirem, é só mandar o dia que eu vejo os horários. 😉', 0.3],
    ],
  },
  {
    name: 'Débora Cardoso', minutesAgo: 26, stage: 'conversando', temp: 'morno', tags: ['reclamação'], handler: 'humano', attention: 'Cliente relatou atraso do técnico', unread: 2,
    lines: [
      ['c', 'O técnico ficou de vir às 9h e até agora nada. Já são 10h20'],
      ['ia', 'Débora, peço desculpas pelo transtorno. 😔 Já chamei uma pessoa da equipe para verificar com o técnico agora mesmo e te dar uma posição. Só um instante, por favor.', 0.3, [
        { tool: 'chamar_atendente', label: 'Atendimento passado para a equipe', status: 'ok', detail: 'Motivo: atraso do técnico' },
      ]],
      ['c', 'Ok, aguardo', 2],
      ['c', 'Alguém?', 9],
    ],
  },
  {
    name: 'Fernanda Lopes', minutesAgo: 47, stage: 'orcamento', temp: 'quente', tags: ['impermeabilização'], handler: 'humano', attention: 'Pediu desconto acima do limite (20%)', unread: 1,
    lines: [
      ['c', 'Oi, quanto fica a impermeabilização de um sofá de 3 lugares?'],
      ['ia', 'Oi, Fernanda! A impermeabilização começa em R$ 290 e protege contra líquidos por até 12 meses. Para um sofá de 3 lugares em bom estado, normalmente fica nesse valor. Quer agendar?', 0.4],
      ['c', 'Faz por 230? Se fizer eu fecho hoje', 2],
      ['ia', 'Entendo, Fernanda! Esse desconto passa do que eu posso autorizar por aqui, então já pedi para o responsável avaliar. Ele te responde em instantes. 🙏', 0.3, [
        { tool: 'chamar_atendente', label: 'Desconto enviado para aprovação', status: 'aguardando', detail: 'Pedido de 20% (limite da IA: 10%)' },
      ]],
    ],
  },
  {
    name: 'Marcos Teixeira', minutesAgo: 95, stage: 'fechado', temp: 'quente', tags: ['automotivo'],
    lines: [
      ['c', 'Bom dia. Vcs fazem higienização de banco de carro?'],
      ['ia', 'Bom dia, Marcos! Fazemos sim: a higienização completa de bancos, teto e carpete sai por R$ 220 e leva umas 2 horas. Quer ver os horários?', 0.4],
      ['c', 'Sábado de manhã tem?', 5],
      ['ia', 'No sábado tenho às 8h, 9h e 10h. Qual fica melhor?', 0.3],
      ['c', '9h. Pode ser aqui no Lago Norte', 2],
      ['ia', 'Combinado! ✅ Sábado às 9h, higienização automotiva no Lago Norte. Me passa o endereço completo para eu deixar anotado?', 0.3],
      ['c', 'SHIN QI 9 Conjunto 4 Casa 12', 1],
      ['ia', 'Anotado, Marcos! Até sábado. 🚗✨', 0.2, [
        { tool: 'agendar_horario', label: 'Horário reservado na agenda', status: 'ok', detail: 'Sábado às 09:00 · Banco automotivo' },
      ]],
    ],
  },
  {
    name: 'Patrícia Gomes', minutesAgo: 140, stage: 'conversando', temp: 'morno', tags: ['colchão'],
    lines: [
      ['c', 'Olá! Qual o valor pra higienizar colchão de casal?'],
      ['ia', 'Olá, Patrícia! A higienização do colchão de casal custa R$ 160 e cuida dos dois lados, removendo ácaros, fungos e manchas. Leva cerca de 1 hora. Posso ver um horário para você?', 0.4],
      ['c', 'Vou falar com meu marido primeiro', 6],
      ['ia', 'Claro! Fico à disposição. Se quiserem, dá para fazer o colchão e o sofá no mesmo horário, assim o técnico vem uma vez só. 😉', 0.3],
    ],
  },
  {
    name: 'Condomínio Parque das Águas', minutesAgo: 210, stage: 'orcamento', temp: 'quente', tags: ['condomínio', 'empresa'], handler: 'humano', attention: 'Pedido grande: 12 sofás do salão de festas',
    lines: [
      ['c', 'Boa tarde! Sou a síndica do Parque das Águas. Precisamos limpar os 12 sofás do salão de festas e 40 cadeiras. Vocês fazem preço para condomínio?'],
      ['ia', 'Boa tarde! Fazemos sim, e para condomínio a gente monta um orçamento especial. Para um volume desses, o ideal é uma visita técnica sem custo. Já avisei o responsável, que vai falar com você ainda hoje para combinar. Pode me passar o seu nome?', 0.5, [
        { tool: 'chamar_atendente', label: 'Pedido grande encaminhado à equipe', status: 'ok', detail: '12 sofás + 40 cadeiras' },
      ]],
      ['c', 'Sou a Helena, síndica. Obrigada!', 4],
    ],
  },
  {
    name: 'Bruno Carvalho', minutesAgo: 320, stage: 'fechado', temp: 'quente', tags: ['cadeiras'],
    lines: [
      ['c', 'Quanto custa pra limpar 8 cadeiras de jantar?'],
      ['ia', 'Oi, Bruno! Cada cadeira sai por R$ 35, então as 8 ficam em R$ 280. Montei o orçamento pra você, quer que eu envie o link?', 0.4, [
        { tool: 'solicitar_orcamento', label: 'Orçamento nº 0409 criado', status: 'ok', detail: 'R$ 280,00 · 8 cadeiras' },
      ]],
      ['c', 'Fechado! Pode marcar quarta às 16h?', 3],
      ['ia', 'Combinado! ✅ Quarta às 16h, limpeza de 8 cadeiras. Seu orçamento nº 0409 está aprovado. Até lá!', 0.3, [
        { tool: 'agendar_horario', label: 'Horário reservado na agenda', status: 'ok', detail: 'Quarta às 16:00 · 8 cadeiras' },
        { tool: 'responder_orcamento', label: 'Orçamento nº 0409 aprovado', status: 'ok' },
      ]],
    ],
  },
  {
    name: 'Larissa Moreira', minutesAgo: 400, stage: 'conversando', temp: 'morno', tags: ['sofá'],
    media: { 0: { type: 'image', url: '/img/demo-sofa.svg', mime: 'image/svg+xml', caption: 'Esse aqui' } },
    lines: [
      ['c', 'Esse aqui, quanto fica?'],
      ['ia', 'Que sofá bonito, Larissa! Pela foto é um retrátil de 3 lugares em suede. A limpeza de sofá retrátil começa em R$ 240. Essa mancha no assento costuma sair bem com a extração. Quer agendar uma data?', 0.6],
      ['c', 'Tem pra amanhã?', 7],
      ['ia', 'Amanhã tenho às 10h, 13h e 15h. Qual prefere?', 0.3],
    ],
  },
  {
    name: 'Gustavo Pereira', minutesAgo: 600, stage: 'fechado', temp: 'morno', tags: ['sofá', 'remarcação'],
    lines: [
      ['c', 'Preciso remarcar a limpeza de amanhã para segunda, pode ser?'],
      ['ia', 'Pode sim, Gustavo! Na segunda tenho às 9h, 11h e 14h. Qual horário fica melhor?', 0.3],
      ['c', '11h', 2],
      ['ia', 'Combinado! ✅ Remarquei para segunda às 11h. Já está tudo certo na agenda.', 0.3, [
        { tool: 'remarcar_meu_agendamento', label: 'Agendamento remarcado', status: 'ok', detail: 'Segunda às 11:00' },
      ]],
    ],
  },
  {
    name: 'Aline Fernandes', minutesAgo: 900, stage: 'fechado', temp: 'quente', tags: ['sofá', 'recorrente'],
    lines: [
      ['c', 'Ficou maravilhoso o sofá!! Muito obrigada'],
      ['ia', 'Que alegria ler isso, Aline! 💙 Obrigada pela confiança. Se puder, deixa uma avaliação pra gente no Google, ajuda muito: g.page/brilholar. E lembrando: a impermeabilização protege por até 12 meses, se quiser fazer depois é só chamar!', 0.4],
    ],
  },
  {
    name: 'Thiago Martins', minutesAgo: 1300, stage: 'novo', temp: 'frio', tags: [], handler: 'humano', unread: 0,
    media: { 0: { type: 'audio', url: null, mime: 'audio/ogg', caption: null } },
    lines: [
      ['c', '[áudio de 0:42]'],
      ['ia', 'Oi! Ainda não consigo ouvir áudios por aqui. 🙏 Pode me mandar por escrito? Ou, se preferir, uma pessoa da equipe vai ouvir e te responder.', 0.2, [
        { tool: 'chamar_atendente', label: 'Áudio encaminhado para a equipe', status: 'ok' },
      ]],
      ['eq', 'Oi Thiago, aqui é a Carla! Ouvi seu áudio: temos horário quinta às 15h para o colchão. Posso confirmar?', 22],
    ],
  },
  {
    name: 'Simone Barbosa', minutesAgo: 1500, stage: 'conversando', temp: 'morno', tags: [],
    lines: [
      ['c', 'Vocês atendem em Valparaíso?'],
      ['ia', 'Atendemos sim, Simone! Valparaíso fica no Entorno, então tem uma taxa de deslocamento de R$ 30. Qual serviço você precisa?', 0.3],
      ['c', 'Sofá e 2 colchões', 4],
      ['ia', 'Ótimo! Fica assim: sofá de 3 lugares a partir de R$ 180, 2 colchões de casal a R$ 160 cada (R$ 320) e a taxa de R$ 30. Total a partir de R$ 530. Quer que eu monte o orçamento?', 0.5],
    ],
  },
  {
    name: 'Eduardo Nunes', minutesAgo: 2100, stage: 'perdido', temp: 'frio', tags: ['sofá'],
    lines: [
      ['c', 'Achei caro, vou ver outros lugares'],
      ['ia', 'Tudo bem, Eduardo! Se mudar de ideia, nosso orçamento vale por 7 dias e eu sigo por aqui. Ah, e no Pix tem 5% de desconto. 😉', 0.3],
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

  const company = companyRow(nowIso, today);
  const services = serviceRows(company.created_at);
  const svc = (name: string) => services.find((s) => s.name.startsWith(name))!;

  const ai: AiSettings = {
    company_id: DEMO_COMPANY_ID, enabled: true, assistant_name: 'Bia', tone: 'amigavel', use_emojis: true,
    instructions: 'Atendemos todo o DF. Entorno (Valparaíso, Águas Lindas, Luziânia) tem taxa de deslocamento de R$ 30.\nPagamento: Pix (5% de desconto), cartão em até 3x sem juros ou dinheiro.\nSecagem: de 4 a 8 horas, dependendo do tecido.\nGarantia: se alguma mancha voltar em até 7 dias, refazemos sem custo.\nNão atendemos aos domingos.',
    greeting: 'Oi! Aqui é a Bia, da Brilho Lar. Como posso te ajudar?',
    schedule_mode: 'sempre', booking_mode: 'automatico', can_quote: true, max_discount_pct: 10, handoff_on_complaint: true,
    faq: DEMO_FAQ, web_search: false,
  };
  const whatsapp: WhatsAppAccount = {
    company_id: DEMO_COMPANY_ID, phone_number_id: '109876543210987', waba_id: '102938475610293', display_phone: '+55 61 99876-5432',
    verified_name: 'Brilho Lar Higienização', status: 'conectado', last_error: null, connected_at: new Date(now.getTime() - 120 * 86400000).toISOString(),
  };
  const members: Member[] = [
    { company_id: DEMO_COMPANY_ID, user_id: DEMO_USER_ID, role: 'dono', name: 'Você (demonstração)', email: 'voce@brilholar.com.br', phone: '5561999990000', phone_verified_at: new Date(now.getTime() - 119 * 86400000).toISOString(), active: true, created_at: company.created_at },
    { company_id: DEMO_COMPANY_ID, user_id: demoId('ab'), role: 'gerente', name: 'Rafael Souza', email: 'rafael@brilholar.com.br', phone: '5561988887777', phone_verified_at: new Date(now.getTime() - 90 * 86400000).toISOString(), active: true, created_at: company.created_at },
    { company_id: DEMO_COMPANY_ID, user_id: demoId('ab'), role: 'atendente', name: 'Carla Mendes', email: 'carla@brilholar.com.br', phone: null, phone_verified_at: null, active: true, created_at: company.created_at },
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
  const addr = () => `${pick(STREETS)}, ${pick(BAIRROS)}`;

  const makeContact = (createdAt: string, opts: Partial<Contact> = {}): Contact => {
    const c: Contact = {
      id: demoId('c0'), company_id: DEMO_COMPANY_ID, name: opts.name ?? newName(), phone: opts.phone ?? newPhone(), email: null,
      address: chance(0.7) ? addr() : null, notes: null, tags: opts.tags ?? [], stage: opts.stage ?? 'novo', temperature: opts.temperature ?? 'frio',
      score: 0, source: opts.source ?? weighted<ContactSource>([['whatsapp', 78], ['instagram', 9], ['indicacao', 8], ['manual', 5]]), opt_in: true,
      birthday: null, last_interaction_at: createdAt, total_spent: 0, created_via: opts.created_via ?? 'ia_cliente', created_at: createdAt, updated_at: createdAt,
    };
    if (c.name && chance(0.25)) c.email = `${c.name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${c.name.split(' ')[1]?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') ?? 'cliente'}@gmail.com`;
    contacts.push(c);
    return c;
  };

  const pickServices = (): { service: Service; qty: number }[] => {
    const main = weighted<string>([['Limpeza de sofá 3', 30], ['Limpeza de sofá 2', 14], ['Higienização de colchão casal', 16], ['Limpeza de sofá retrátil', 10], ['Impermeabilização', 7], ['Limpeza de tapete', 8], ['Higienização de banco', 6], ['Limpeza de cadeira', 6], ['Higienização de colchão solteiro', 5], ['Limpeza de poltrona', 4]]);
    const list = [{ service: svc(main), qty: main === 'Limpeza de tapete' ? int(4, 12) : main === 'Limpeza de cadeira' ? int(4, 10) : 1 }];
    if (chance(0.22)) { const extra = svc(pick(['Higienização de colchão casal', 'Limpeza de poltrona', 'Impermeabilização'])); if (extra.id !== list[0].service.id) list.push({ service: extra, qty: 1 }); }
    return list;
  };
  const priceOf = (s: Service) => s.price_type === 'a_partir_de' ? Math.round(s.price * between(1, 1.25) / 5) * 5 : s.price;

  // dias do histórico (do mais antigo ao mais novo)
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const day = addDays(today, -back);
    const wd = weekdayOf(day);
    const progress = (HISTORY_DAYS - back) / HISTORY_DAYS; // 0 → 1
    const wf = [0.22, 1.0, 1.05, 1.0, 1.1, 1.15, 0.72][wd];
    const season = 1 + 0.12 * Math.sin((progress * 2 * Math.PI) - 0.6);
    // crescimento ao longo do ano, salto quando a IA entrou e um embalo nas últimas 4 semanas
    const growth = 0.5 + 0.6 * progress + (back < AI_START ? 0.25 : 0) + (back < 28 ? 0.1 * (28 - back) / 28 : 0);
    const isToday = back === 0;
    const dayFraction = isToday ? Math.min(1, Math.max(0.05, (localParts(now, TZ).h * 60 + localParts(now, TZ).mi - 7 * 60) / (12 * 60))) : 1;
    const conv = Math.max(0, Math.round(15 * wf * season * growth * between(0.8, 1.2) * dayFraction));
    const aiOn = back < AI_START;
    const msgsIn = Math.round(conv * between(3.8, 5.2));
    const replies = Math.round(msgsIn * 0.92);
    const msgsAi = aiOn ? Math.round(replies * between(0.82, 0.9)) : 0;
    const msgsTeam = replies - msgsAi;
    const respCount = Math.round(conv * 1.6);
    const avgResp = aiOn ? between(38, 75) + (msgsTeam / Math.max(1, replies)) * between(300, 700) : between(1300, 2400);
    msgStats[day] = { msgs_in: msgsIn, msgs_ai: msgsAi, msgs_team: msgsTeam, conversations: conv, response_sum: Math.round(avgResp * respCount), response_count: respCount, handoffs: aiOn ? Math.round(conv * between(0.05, 0.11)) : 0 };

    // conversões do dia
    const newContacts = Math.round(conv * between(0.42, 0.55));
    const quoteRate = aiOn ? 0.34 : 0.24;
    const nQuotes = Math.round(conv * quoteRate * between(0.85, 1.15));
    if (back >= RAW_DAYS) {
      // só agregados para dias antigos (e alguns clientes antigos para reativação)
      let approved = 0, value = 0, salesAmt = 0, ia = 0, eq = 0, bal = 0, nSales = 0;
      for (let q = 0; q < nQuotes; q++) {
        const total = pickServices().reduce((s, it) => s + priceOf(it.service) * it.qty, 0);
        if (chance(aiOn ? 0.58 : 0.5)) { approved++; value += total; salesAmt += total; nSales++; if (aiOn && chance(0.62)) ia += total; else eq += total; }
      }
      const walk = chance(0.35) ? int(1, 2) : 0;
      for (let k = 0; k < walk; k++) { const v = priceOf(svc(pick(['Limpeza de sofá 2', 'Limpeza de poltrona', 'Higienização de colchão solteiro']))); salesAmt += v; bal += v; nSales++; }
      oldStats[day] = { new_contacts: newContacts, quotes_created: nQuotes, quotes_sent: nQuotes, quotes_approved: approved, quotes_value: value, sales_count: nSales, sales_amount: salesAmt, sales_ia: ia, sales_equipe: eq, sales_balcao: bal, appointments: approved };
      if (chance(0.35)) {
        const ca = at(day, `${String(int(8, 18)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`);
        const c = makeContact(ca, { stage: 'fechado', temperature: 'frio', created_via: aiOn ? 'ia_cliente' : 'painel' });
        c.total_spent = Math.round(between(150, 900));
        c.last_interaction_at = ca;
        if (chance(0.3)) c.tags = ['recorrente'];
      }
      continue;
    }

    // dias recentes: linhas de verdade
    const dayContacts: Contact[] = [];
    for (let k = 0; k < newContacts; k++) {
      const hh = String(int(7, 20)).padStart(2, '0'), mm = String(int(0, 59)).padStart(2, '0');
      let ca = at(day, `${hh}:${mm}`);
      if (Date.parse(ca) > now.getTime()) ca = minutesAgo(int(5, 60));
      dayContacts.push(makeContact(ca, { stage: 'conversando', temperature: back < 3 ? 'quente' : back < 14 ? 'morno' : 'frio' }));
    }
    const pool = dayContacts.length ? dayContacts : contacts.slice(-20);
    for (let q = 0; q < nQuotes && pool.length; q++) {
      const contact = pick(pool);
      const createdAt = (() => { const t = Date.parse(contact.created_at) + int(5, 180) * 60000; return new Date(Math.min(t, now.getTime() - 60000)).toISOString(); })();
      const its = pickServices();
      const id = demoId('a0');
      let subtotal = 0;
      its.forEach((it, idx) => {
        const unit = priceOf(it.service);
        subtotal += unit * it.qty;
        quote_items.push({ id: demoId('a1'), quote_id: id, company_id: DEMO_COMPANY_ID, service_id: it.service.id, description: it.service.name + (it.qty > 1 && it.service.name.includes('tapete') ? ` (${it.qty} m²)` : ''), qty: it.qty, unit_price: unit, sort: idx });
      });
      const discount = chance(0.15) ? Math.round(subtotal * pick([0.05, 0.1])) : 0;
      const total = subtotal - discount;
      const via = aiOn ? weighted<Quote['created_via']>([['ia_cliente', 62], ['ia_dono', 12], ['painel', 26]]) : 'painel';
      let status: Quote['status'];
      if (back <= 1) status = weighted([['enviado', 62], ['rascunho', 8], ['aprovado', 30]]);
      else if (back <= 7) status = weighted([['enviado', 30], ['aprovado', 52], ['recusado', 12], ['rascunho', 6]]);
      else status = weighted([['aprovado', 56], ['recusado', 18], ['expirado', 26]]);
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
      if (contact.tags.length === 0) contact.tags = [its[0].service.category?.toLowerCase().replace('sofás', 'sofá').replace('colchões', 'colchão').replace('tapetes', 'tapete').replace('cadeiras', 'cadeiras') ?? 'outros'];

      if (status === 'aprovado' && respondedAt) {
        // agendamento: entre 1 e 6 dias depois da aprovação
        const apDay = addDays(localDate(respondedAt, TZ), int(1, 6));
        const apWd = weekdayOf(apDay);
        const hour = apWd === 6 ? int(8, 11) : apWd === 0 ? null : int(8, 16);
        if (hour != null) {
          const dur = its.reduce((m, it) => Math.max(m, it.service.duration_min), 60);
          const starts = at(apDay, `${String(hour).padStart(2, '0')}:00`);
          const ends = new Date(Date.parse(starts) + dur * 60000).toISOString();
          const future = Date.parse(starts) > now.getTime();
          const apStatus: Appointment['status'] = future ? weighted([['confirmado', 85], ['pendente', 15]]) : weighted([['concluido', 88], ['faltou', 4], ['cancelado', 8]]);
          const ap: Appointment = {
            id: demoId('b0'), company_id: DEMO_COMPANY_ID, contact_id: contact.id, service_id: its[0].service.id, title: its.map((i) => i.service.name.replace(' (por m²)', '')).join(' + '),
            starts_at: starts, ends_at: ends, status: apStatus, address: contact.address ?? addr(), notes: null, price: total, created_via: via === 'painel' ? 'painel' : 'ia_cliente',
            reminder_sent_at: future ? null : new Date(Date.parse(starts) - 86400000).toISOString(), created_at: respondedAt, updated_at: respondedAt,
          };
          appointments.push(ap);
          // venda quando o serviço foi feito
          if (apStatus === 'concluido') {
            const method = weighted<PayMethod>([['pix', 55], ['cartao_credito', 22], ['cartao_debito', 9], ['dinheiro', 10], ['transferencia', 4]]);
            const paidAt = ends;
            sales.push({
              id: demoId('e0'), company_id: DEMO_COMPANY_ID, contact_id: contact.id, quote_id: id, appointment_id: ap.id, description: ap.title, amount: total, method,
              origin: via === 'painel' ? 'equipe' : 'ia', paid_at: paidAt, created_via: chance(0.3) ? 'ia_dono' : 'painel', created_at: paidAt,
            });
            contact.total_spent += total;
            contact.last_interaction_at = paidAt;
          }
        }
      }
    }
    // vendas de balcão (sem conversa)
    if (back > 0 && chance(0.3)) {
      const s = svc(pick(['Limpeza de sofá 2', 'Limpeza de poltrona', 'Higienização de colchão solteiro', 'Limpeza de cadeira']));
      const paid = at(day, `${String(int(9, 17)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`);
      sales.push({ id: demoId('e0'), company_id: DEMO_COMPANY_ID, contact_id: null, quote_id: null, appointment_id: null, description: s.name, amount: s.price, method: pick(['pix', 'dinheiro', 'cartao_debito'] as PayMethod[]), origin: 'balcao', paid_at: paid, created_via: 'painel', created_at: paid });
    }
  }

  // agenda de hoje e próximos dias: garante um dia cheio e bonito
  const futureSlots: [number, string, string, Appointment['status']][] = [
    [0, '09:00', 'Limpeza de sofá 3', 'concluido'], [0, '11:00', 'Higienização de colchão casal', 'concluido'], [0, '14:00', 'Limpeza de sofá retrátil', 'confirmado'],
    [0, '16:00', 'Limpeza de cadeira', 'confirmado'], [1, '08:00', 'Impermeabilização', 'confirmado'], [1, '10:00', 'Limpeza de sofá 2', 'confirmado'], [1, '13:00', 'Limpeza de tapete', 'pendente'],
    [2, '09:00', 'Higienização de banco', 'confirmado'], [2, '15:00', 'Limpeza de sofá 3', 'confirmado'], [3, '11:00', 'Higienização de colchão casal', 'confirmado'],
  ];
  for (const [plus, hhmm, sname, st] of futureSlots) {
    let d = addDays(today, plus); if (weekdayOf(d) === 0) d = addDays(d, 1);
    const s = svc(sname); const starts = at(d, hhmm);
    const contact = pick(contacts.slice(-60));
    const done = Date.parse(starts) + s.duration_min * 60000 < now.getTime();
    appointments.push({ id: demoId('b0'), company_id: DEMO_COMPANY_ID, contact_id: contact.id, service_id: s.id, title: s.name.replace(' (unidade)', 's').replace(' (por m²)', ''), starts_at: starts, ends_at: new Date(Date.parse(starts) + s.duration_min * 60000).toISOString(), status: done ? st : st === 'concluido' ? 'confirmado' : st, address: contact.address ?? addr(), notes: null, price: priceOf(s), created_via: chance(0.7) ? 'ia_cliente' : 'painel', reminder_sent_at: plus <= 1 ? minutesAgo(int(60, 600)) : null, created_at: minutesAgo(int(600, 5000)), updated_at: minutesAgo(int(60, 600)) });
  }

  // conversas recentes escritas à mão
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  for (const sc of SCRIPTS) {
    const firstLineAt = now.getTime() - sc.minutesAgo * 60000 - sc.lines.reduce((s, l) => s + (l[2] ?? 0), 0) * 60000;
    const contact = makeContact(new Date(firstLineAt - int(0, 20) * 86400000).toISOString(), { name: sc.name, stage: sc.stage, temperature: sc.temp, tags: sc.tags });
    if (sc.name.startsWith('Condomínio')) { contact.source = 'indicacao'; }
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
        sender: inbound ? 'contato' : who === 'ia' ? 'ia' : who === 'eq' ? 'equipe' : 'sistema', sender_name: who === 'eq' ? 'Carla Mendes' : who === 'ia' ? 'Bia (IA)' : null,
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
  // algumas conversas antigas resolvidas, só com prévia
  for (let k = 0; k < 10; k++) {
    const c = contacts[contacts.length - 40 - k * 3]; if (!c) break;
    const t = new Date(now.getTime() - int(2, 9) * 86400000 - int(0, 600) * 60000).toISOString();
    const conv: Conversation = { id: demoId('f0'), company_id: DEMO_COMPANY_ID, contact_id: c.id, member_user_id: null, kind: 'cliente', channel: 'whatsapp', handler: 'ia', status: 'resolvida', needs_attention: false, attention_reason: null, unread: 0, last_message_at: t, last_message_preview: pick(['Combinado! Até lá 😊', 'Obrigada, até mais!', 'Perfeito, fico no aguardo', 'Show, obrigado!']), last_inbound_at: t, created_at: t };
    conversations.push(conv);
    messages.push({ id: demoId('f1'), company_id: DEMO_COMPANY_ID, conversation_id: conv.id, direction: 'in', sender: 'contato', sender_name: null, body: pick(['Qual o valor da limpeza de colchão?', 'Tem horário amanhã?', 'Vocês fazem tapete?']), media: null, wa_status: null, actions: null, response_seconds: null, channel: 'whatsapp', created_at: new Date(Date.parse(t) - 4 * 60000).toISOString() });
    messages.push({ id: demoId('f1'), company_id: DEMO_COMPANY_ID, conversation_id: conv.id, direction: 'out', sender: 'ia', sender_name: 'Bia (IA)', body: conv.last_message_preview!, media: null, wa_status: 'lida', actions: null, response_seconds: 38, channel: 'whatsapp', created_at: t });
  }

  // conversa do dono com a IA (assistente)
  const ownerConv: Conversation = { id: demoId('f0'), company_id: DEMO_COMPANY_ID, contact_id: null, member_user_id: DEMO_USER_ID, kind: 'dono', channel: 'whatsapp', handler: 'ia', status: 'aberta', needs_attention: false, attention_reason: null, unread: 0, last_message_at: minutesAgo(70), last_message_preview: 'Combinado! Venda registrada.', last_inbound_at: minutesAgo(71), created_at: minutesAgo(5000) };
  conversations.push(ownerConv);
  const maria = makeContact(minutesAgo(190), { name: 'Maria Oliveira', phone: '5561999999999', stage: 'orcamento', temperature: 'quente', created_via: 'ia_dono', source: 'manual', tags: ['sofá'] });
  quoteSeq++;
  const mariaQuote: Quote = { id: demoId('a0'), company_id: DEMO_COMPANY_ID, number: quoteSeq, contact_id: maria.id, title: 'Orçamento combinado por telefone', status: 'enviado', subtotal: 350, discount: 0, total: 350, valid_until: addDays(today, 7), notes: null, public_token: token(), sent_at: minutesAgo(189), responded_at: null, followup_sent_at: null, created_via: 'ia_dono', created_at: minutesAgo(190), updated_at: minutesAgo(189) };
  quotes.push(mariaQuote);
  quote_items.push({ id: demoId('a1'), quote_id: mariaQuote.id, company_id: DEMO_COMPANY_ID, service_id: null, description: 'Serviço combinado com a cliente', qty: 1, unit_price: 350, sort: 0 });
  const ownerLines: [boolean, string, number, ActionReceipt[]?][] = [
    [true, 'Cadastra a Maria, telefone 61999999999, e cria um orçamento de R$ 350 para ela.', 191],
    [false, 'Combinado! ✅ Fiz assim:\n• Cadastrei a Maria Oliveira — (61) 99999-9999\n• Criei o orçamento nº ' + String(mariaQuote.number).padStart(4, '0') + ' de R$ 350,00 e deixei pronto para enviar\nQuer que eu mande o link do orçamento para ela no WhatsApp?', 190, [
      { tool: 'cadastrar_cliente', label: 'Cliente Maria cadastrada', status: 'ok', detail: '(61) 99999-9999' },
      { tool: 'criar_orcamento', label: `Orçamento de R$ 350 criado`, status: 'ok', detail: `nº ${String(mariaQuote.number).padStart(4, '0')}` },
      { tool: 'painel', label: 'Painel comercial atualizado', status: 'ok' },
    ]],
    [true, 'Manda sim', 189],
    [false, 'Enviado! 📨 A Maria recebeu o link do orçamento nº ' + String(mariaQuote.number).padStart(4, '0') + '. Te aviso quando ela responder.', 189, [{ tool: 'enviar_orcamento', label: 'Orçamento enviado no WhatsApp', status: 'ok' }]],
    [true, 'Quanto vendi essa semana?', 75],
    [false, '', 74],
    [true, 'Registra uma venda de R$ 180 no Pix para o Bruno Carvalho', 72],
    [false, 'Vou registrar uma venda de R$ 180,00 no Pix para Bruno Carvalho. Como é uma movimentação financeira, preciso da sua confirmação: responda SIM para confirmar ou NÃO para cancelar.', 71.5, [{ tool: 'registrar_venda', label: 'Venda aguardando confirmação', status: 'aguardando', detail: 'R$ 180,00 · Pix · Bruno Carvalho' }]],
    [true, 'SIM', 71],
    [false, 'Combinado! Venda registrada. ✅ R$ 180,00 no Pix para Bruno Carvalho.', 70, [{ tool: 'registrar_venda', label: 'Venda de R$ 180 registrada', status: 'ok', detail: 'Pix · Bruno Carvalho' }]],
  ];
  // resumo da semana calculado com os dados gerados
  const weekStart = (() => { let d = today; while (weekdayOf(d) !== 1) d = addDays(d, -1); return d; })();
  const weekSales = sales.filter((s) => localDate(s.paid_at, TZ) >= weekStart);
  const weekTotal = weekSales.reduce((s, x) => s + x.amount, 0);
  const brlx = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  ownerLines[5][1] = `Nesta semana (desde segunda) você vendeu ${brlx(weekTotal)} em ${weekSales.length} vendas. 📈\n• Pix: ${brlx(weekSales.filter((s) => s.method === 'pix').reduce((a, b) => a + b.amount, 0))}\n• Cartão: ${brlx(weekSales.filter((s) => s.method.startsWith('cartao')).reduce((a, b) => a + b.amount, 0))}\n• Vendas fechadas pela IA: ${weekSales.filter((s) => s.origin === 'ia').length}`;
  ownerLines[5][3] = [{ tool: 'resumo_vendas', label: 'Relatório de vendas consultado', status: 'ok' }];
  for (const [inbound, text, mAgo, actions] of ownerLines) {
    messages.push({ id: demoId('f1'), company_id: DEMO_COMPANY_ID, conversation_id: ownerConv.id, direction: inbound ? 'in' : 'out', sender: inbound ? 'dono' : 'ia', sender_name: inbound ? 'Você' : 'Bia (IA)', body: text, media: null, wa_status: inbound ? null : 'lida', actions: actions ?? null, response_seconds: inbound ? null : 6, channel: 'whatsapp', created_at: minutesAgo(mAgo) });
  }
  const bruno = contacts.find((c) => c.name === 'Bruno Carvalho');
  sales.push({ id: demoId('e0'), company_id: DEMO_COMPANY_ID, contact_id: bruno?.id ?? null, quote_id: null, appointment_id: null, description: 'Limpeza de cadeiras', amount: 180, method: 'pix', origin: 'ia', paid_at: minutesAgo(70), created_via: 'ia_dono', created_at: minutesAgo(70) });

  // pontuação dos leads
  for (const c of contacts) {
    const ageDays = (now.getTime() - Date.parse(c.last_interaction_at ?? c.created_at)) / 86400000;
    c.score = Math.max(5, Math.min(98, Math.round((c.temperature === 'quente' ? 82 : c.temperature === 'morno' ? 55 : 24) + between(-10, 10) - Math.min(20, ageDays / 3))));
    if (ageDays > 30 && c.temperature !== 'frio') c.temperature = 'frio';
  }

  // tarefas do dono
  const tasks: Task[] = [
    { title: 'Ligar para o fornecedor de produtos (reposição de shampoo neutro)', due: at(today, '17:00'), done: false },
    { title: 'Visita técnica no Condomínio Parque das Águas', due: at(addDays(today, 1), '10:00'), done: false },
    { title: 'Conferir pagamento da Juliana Ribeiro', due: at(addDays(today, 3), '09:00'), done: false },
    { title: 'Revisar preços da impermeabilização', due: at(addDays(today, 5), '09:00'), done: false },
    { title: 'Postar fotos do antes e depois no Instagram', due: at(addDays(today, -1), '18:00'), done: true },
    { title: 'Renovar o seguro da van', due: at(addDays(today, -3), '12:00'), done: true },
  ].map((t, i) => ({ id: demoId('70'), company_id: DEMO_COMPANY_ID, title: t.title, due_at: t.due, done_at: t.done ? t.due : null, contact_id: null, reminded_at: null, created_via: i % 2 ? 'painel' : 'ia_dono', created_at: minutesAgo(3000 + i * 400) }));

  // automações
  const autos: [AutomationKind, boolean, Automation['config'], string | null][] = [
    ['lembrete_agendamento', true, { horas_antes: 24, pedir_confirmacao: true }, 'lembrete_agendamento'],
    ['followup_orcamento', true, { dias_depois: 2, max_tentativas: 2 }, 'acompanhamento_orcamento'],
    ['resumo_diario', true, { horario: '19:00', incluir_agenda: true }, 'resumo_diario'],
    ['pos_atendimento', true, { horas_depois: 3, pedir_avaliacao: true, link_avaliacao: 'g.page/brilholar' }, 'pos_atendimento'],
    ['reativacao', false, { dias_sem_compra: 120, desconto_pct: 10 }, 'reativacao_cliente'],
    ['lembrete_tarefa', true, { minutos_antes: 30 }, null],
  ];
  const automations: Automation[] = autos.map(([kind, enabled, config, template_name]) => ({ id: demoId('9a'), company_id: DEMO_COMPANY_ID, kind, enabled, config, template_name, last_run_at: enabled ? minutesAgo(int(5, 300)) : null, created_at: company.created_at }));
  const automation_runs: AutomationRun[] = [];
  for (let k = 0; k < 26; k++) {
    const a = pick(automations.filter((x) => x.enabled && x.kind !== 'lembrete_tarefa'));
    const c = pick(contacts.slice(-120));
    automation_runs.push({ id: demoId('9b'), company_id: DEMO_COMPANY_ID, automation_id: a.id, kind: a.kind, ran_at: minutesAgo(k * 170 + int(5, 120)), target_label: a.kind === 'resumo_diario' ? 'Você (dono)' : c.name, status: weighted([['enviado', 90], ['ignorado', 7], ['falhou', 3]]), detail: a.kind === 'followup_orcamento' ? 'Orçamento sem resposta há 2 dias' : a.kind === 'lembrete_agendamento' ? 'Horário amanhã' : a.kind === 'pos_atendimento' ? 'Pedido de avaliação' : 'Resumo do dia' });
  }
  automation_runs.sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1));

  // histórico de ações
  const audit_log: AuditEntry[] = [];
  const auditOf = (minutes: number, actor_type: AuditEntry['actor_type'], actor_name: string, channel: AuditEntry['channel'], action: string, summary: string, status: AuditEntry['status'] = 'ok') =>
    audit_log.push({ id: demoId('99'), company_id: DEMO_COMPANY_ID, actor_type, actor_name, channel, action, summary, target_type: null, target_id: null, status, created_at: minutesAgo(minutes) });
  auditOf(4, 'ia', 'Bia (IA)', 'ia_cliente', 'agendar_horario', 'Reservou sexta às 14:00 para Juliana Ribeiro (sofá 3 lugares)');
  auditOf(19, 'ia', 'Bia (IA)', 'ia_cliente', 'solicitar_orcamento', 'Criou o orçamento nº 0412 de R$ 150,00 para Ricardo Almeida');
  auditOf(27, 'ia', 'Bia (IA)', 'ia_cliente', 'chamar_atendente', 'Passou o atendimento de Débora Cardoso para a equipe (atraso do técnico)');
  auditOf(48, 'ia', 'Bia (IA)', 'ia_cliente', 'chamar_atendente', 'Pedido de desconto de 20% de Fernanda Lopes enviado para aprovação', 'aguardando');
  auditOf(70, 'ia', 'Bia (IA)', 'ia_dono', 'registrar_venda', 'Registrou venda de R$ 180,00 (Pix) para Bruno Carvalho — confirmada pelo dono');
  auditOf(72, 'ia', 'Bia (IA)', 'ia_dono', 'registrar_venda', 'Pediu confirmação para registrar venda de R$ 180,00', 'aguardando');
  auditOf(75, 'ia', 'Bia (IA)', 'ia_dono', 'resumo_vendas', 'Consultou o resumo de vendas da semana');
  auditOf(96, 'ia', 'Bia (IA)', 'ia_cliente', 'agendar_horario', 'Reservou sábado às 09:00 para Marcos Teixeira (banco automotivo)');
  auditOf(130, 'usuario', 'Carla Mendes', 'painel', 'atualizar_cliente', 'Atualizou o endereço de Patrícia Gomes');
  auditOf(189, 'ia', 'Bia (IA)', 'ia_dono', 'enviar_orcamento', `Enviou o orçamento nº ${String(mariaQuote.number).padStart(4, '0')} para Maria Oliveira`);
  auditOf(190, 'ia', 'Bia (IA)', 'ia_dono', 'criar_orcamento', `Criou o orçamento nº ${String(mariaQuote.number).padStart(4, '0')} de R$ 350,00 para Maria Oliveira`);
  auditOf(190, 'ia', 'Bia (IA)', 'ia_dono', 'cadastrar_cliente', 'Cadastrou Maria Oliveira — (61) 99999-9999');
  auditOf(211, 'ia', 'Bia (IA)', 'ia_cliente', 'chamar_atendente', 'Encaminhou pedido de condomínio (12 sofás + 40 cadeiras)');
  auditOf(320, 'ia', 'Bia (IA)', 'ia_cliente', 'agendar_horario', 'Reservou quarta às 16:00 para Bruno Carvalho (8 cadeiras)');
  auditOf(321, 'ia', 'Bia (IA)', 'ia_cliente', 'solicitar_orcamento', 'Criou o orçamento nº 0409 de R$ 280,00 para Bruno Carvalho');
  auditOf(380, 'sistema', 'Automação', 'automacao', 'followup_orcamento', 'Enviou acompanhamento do orçamento para 3 clientes');
  auditOf(600, 'ia', 'Bia (IA)', 'ia_cliente', 'remarcar_meu_agendamento', 'Remarcou o horário de Gustavo Pereira para segunda às 11:00');
  auditOf(720, 'usuario', 'Rafael Souza', 'painel', 'atualizar_servico', 'Alterou o preço de "Limpeza de poltrona" de R$ 80,00 para R$ 90,00');
  auditOf(1100, 'sistema', 'Automação', 'automacao', 'resumo_diario', 'Enviou o resumo do dia para o dono');
  auditOf(1300, 'ia', 'Bia (IA)', 'ia_cliente', 'chamar_atendente', 'Encaminhou áudio de Thiago Martins para a equipe');
  auditOf(1440, 'sistema', 'Automação', 'automacao', 'lembrete_agendamento', 'Enviou 6 lembretes de horário para amanhã');
  auditOf(2000, 'ia', 'Bia (IA)', 'ia_dono', 'cancelar_agendamento', 'Pedido para cancelar o horário de Lucas Dias foi recusado pelo dono', 'cancelado');

  // avisos
  const notifications: Notification[] = [
    { kind: 'atendimento', title: 'Débora Cardoso precisa de você', body: 'Cliente relatou atraso do técnico. A IA passou o atendimento para a equipe.', link: '#/conversas', m: 26, read: false },
    { kind: 'orcamento', title: 'Pedido de desconto aguardando aprovação', body: 'Fernanda Lopes pediu 20% na impermeabilização.', link: '#/conversas', m: 47, read: false },
    { kind: 'agendamento', title: 'Novo horário reservado pela IA', body: 'Juliana Ribeiro · sexta às 14:00', link: '#/agenda', m: 4, read: false },
    { kind: 'venda', title: 'Venda registrada pelo WhatsApp', body: 'R$ 180,00 no Pix · Bruno Carvalho', link: '#/vendas', m: 70, read: true },
    { kind: 'orcamento', title: 'Orçamento aprovado', body: 'Bruno Carvalho aprovou o orçamento nº 0409 (R$ 280,00).', link: '#/orcamentos', m: 320, read: true },
    { kind: 'sistema', title: 'Resumo do dia enviado no seu WhatsApp', body: null, link: null, m: 1100, read: true },
  ].map((n) => ({ id: demoId('9c'), company_id: DEMO_COMPANY_ID, user_id: null, kind: n.kind as Notification['kind'], title: n.title, body: n.body, link: n.link, read_at: n.read ? minutesAgo(n.m - 1) : null, created_at: minutesAgo(n.m) }));

  // faturas e uso
  const invoices: Invoice[] = [0, 1, 2, 3, 4].map((k) => {
    const due = addDays(today, 17 - 30 * (k + 1));
    return { id: demoId('9d'), company_id: DEMO_COMPANY_ID, amount: 299, status: 'paga', due_date: due, paid_at: fromLocal(due, '09:12', TZ).toISOString(), method: 'cartao', url: null, description: 'Combinado · Plano Profissional · mensal', created_at: fromLocal(addDays(due, -10), '08:00', TZ).toISOString() };
  });
  const month = today.slice(0, 7);
  const monthAi = Object.entries(msgStats).filter(([d]) => d.startsWith(month)).reduce((s, [, v]) => s + v.msgs_ai, 0);
  const usage_monthly: UsageMonth[] = [{ company_id: DEMO_COMPANY_ID, month, ai_replies: Math.min(1480, Math.round(monthAi * 0.42)), wa_sent: Math.round(monthAi * 0.5), ai_input_tokens: 0, ai_output_tokens: 0 }];

  contacts.sort((a, b) => ((b.last_interaction_at ?? '') > (a.last_interaction_at ?? '') ? 1 : -1));
  const gestao = buildGestao(now, today, contacts);
  return {
    ...gestao,
    version: DEMO_VERSION, seededAt: nowIso, company, ai, whatsapp, members, contacts, services, quotes, quote_items, appointments, sales, tasks,
    conversations, messages, pending_actions: [], audit_log, automations, automation_runs, notifications, invoices, usage_monthly, msgStats, oldStats,
    seq: { quote: quoteSeq, id: idCounter },
  };
}

export { SCRIPTS as DEMO_SCRIPTS };
