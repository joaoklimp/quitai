// GERADO por scripts/sync-functions.mjs a partir de src/app/data/types.ts. Não edite aqui: edite o original e rode "npm run sync:functions".
// Tipos do domínio — espelham as tabelas do Supabase (supabase/migrations).
import type { Cycle, PlanId } from './plans.ts';

export type UUID = string;
export type ISO = string; // instante (timestamptz) em ISO 8601
export type DateStr = string; // "2026-10-02"

export type Role = 'dono' | 'gerente' | 'atendente';
export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'blocked';

/** Dia da semana (0 = domingo) → intervalos ["08:00","12:00"] */
export type BusinessHours = Record<string, [string, string][]>;

export interface Company {
  id: UUID;
  name: string;
  segment: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  business_hours: BusinessHours;
  slot_minutes: number;
  capacity_per_slot: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  monthly_goal: number;
  plan: PlanId;
  billing_status: BillingStatus;
  billing_cycle: Cycle | null;
  billing_method: 'cartao' | 'pix_boleto' | null;
  trial_ends_at: ISO;
  current_period_end: DateStr | null;
  canceled_at: ISO | null;
  complimentary: boolean;
  created_at: ISO;
}

export type Tone = 'amigavel' | 'profissional' | 'descontraido';
export interface AiSettings {
  company_id: UUID;
  enabled: boolean;
  assistant_name: string;
  tone: Tone;
  use_emojis: boolean;
  instructions: string;
  greeting: string;
  schedule_mode: 'sempre' | 'fora_do_horario' | 'horario_comercial';
  booking_mode: 'automatico' | 'confirmar';
  can_quote: boolean;
  max_discount_pct: number;
  handoff_on_complaint: boolean;
  /** perguntas e respostas cadastradas pelo dono: a IA responde com base nelas */
  faq: FaqItem[];
  /** pesquisa na internet para dúvidas gerais (nunca para preço, horário ou regra da empresa) */
  web_search: boolean;
  updated_at?: ISO;
}
export interface FaqItem { q: string; a: string }

export interface WhatsAppAccount {
  company_id: UUID;
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone: string | null;
  verified_name: string | null;
  status: 'desconectado' | 'conectado' | 'erro';
  last_error: string | null;
  connected_at: ISO | null;
}

export interface Member {
  company_id: UUID;
  user_id: UUID;
  role: Role;
  name: string;
  email: string;
  phone: string | null;
  phone_verified_at: ISO | null;
  active: boolean;
  invited?: boolean;
  created_at: ISO;
}

export type Stage = 'novo' | 'conversando' | 'orcamento' | 'fechado' | 'perdido';
export type Temperature = 'quente' | 'morno' | 'frio';
export type ContactSource = 'whatsapp' | 'manual' | 'indicacao' | 'instagram' | 'site' | 'outro';

export interface Contact {
  id: UUID;
  company_id: UUID;
  name: string;
  phone: string | null;
  wa_name?: string | null; // nome do perfil no WhatsApp
  email: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  stage: Stage;
  temperature: Temperature;
  score: number;
  source: ContactSource;
  opt_in: boolean;
  birthday: DateStr | null;
  last_interaction_at: ISO | null;
  total_spent: number;
  created_via: Channel;
  created_at: ISO;
  updated_at: ISO;
  document?: string | null; // CPF ou CNPJ, só números
}

export type PriceType = 'fixo' | 'a_partir_de' | 'sob_consulta';
export interface Service {
  id: UUID;
  company_id: UUID;
  name: string;
  description: string | null;
  price: number;
  price_type: PriceType;
  duration_min: number;
  category: string | null;
  active: boolean;
  sort: number;
  created_at: ISO;
}

export type QuoteStatus = 'rascunho' | 'enviado' | 'aprovado' | 'recusado' | 'expirado';
export interface QuoteItem {
  id: UUID;
  quote_id: UUID;
  company_id: UUID;
  service_id: UUID | null;
  description: string;
  qty: number;
  unit_price: number;
  sort: number;
}
export interface Quote {
  id: UUID;
  company_id: UUID;
  number: number;
  contact_id: UUID;
  title: string | null;
  status: QuoteStatus;
  subtotal: number;
  discount: number;
  total: number;
  valid_until: DateStr | null;
  notes: string | null;
  public_token: string;
  sent_at: ISO | null;
  responded_at: ISO | null;
  followup_sent_at: ISO | null;
  created_via: Channel;
  created_at: ISO;
  updated_at: ISO;
  items?: QuoteItem[];
}

export type AppointmentStatus = 'pendente' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou';
export interface Appointment {
  id: UUID;
  company_id: UUID;
  contact_id: UUID | null;
  service_id: UUID | null;
  title: string;
  starts_at: ISO;
  ends_at: ISO;
  status: AppointmentStatus;
  address: string | null;
  notes: string | null;
  price: number | null;
  created_via: Channel;
  reminder_sent_at: ISO | null;
  created_at: ISO;
  updated_at: ISO;
}

export type PayMethod = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'boleto' | 'transferencia' | 'outro';
export type SaleOrigin = 'ia' | 'equipe' | 'balcao';
export interface Sale {
  id: UUID;
  company_id: UUID;
  contact_id: UUID | null;
  quote_id: UUID | null;
  appointment_id: UUID | null;
  description: string;
  amount: number;
  method: PayMethod;
  origin: SaleOrigin;
  paid_at: ISO;
  created_via: Channel;
  created_at: ISO;
}

export interface Task {
  id: UUID;
  company_id: UUID;
  title: string;
  due_at: ISO | null;
  done_at: ISO | null;
  contact_id: UUID | null;
  reminded_at: ISO | null;
  created_via: Channel;
  created_at: ISO;
}

/** De onde veio a ação: painel, IA atendendo cliente, IA a pedido do dono, automação... */
export type Channel = 'painel' | 'ia_cliente' | 'ia_dono' | 'automacao' | 'site' | 'whatsapp';

export type ConversationKind = 'cliente' | 'dono';
export interface Conversation {
  id: UUID;
  company_id: UUID;
  contact_id: UUID | null;
  member_user_id: UUID | null;
  kind: ConversationKind;
  channel: 'whatsapp' | 'painel' | 'simulador';
  handler: 'ia' | 'humano';
  status: 'aberta' | 'resolvida';
  needs_attention: boolean;
  attention_reason: string | null;
  unread: number;
  last_message_at: ISO | null;
  last_message_preview: string | null;
  last_inbound_at: ISO | null;
  created_at: ISO;
}

export type MessageSender = 'contato' | 'ia' | 'equipe' | 'sistema' | 'dono';
export interface ActionReceipt {
  tool: string;
  label: string;
  status: 'ok' | 'erro' | 'aguardando' | 'cancelada' | 'negada';
  detail?: string;
  link?: string;
  pending_id?: UUID;
}
export interface MediaInfo {
  type: 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location';
  path?: string | null;
  url?: string | null;
  mime?: string | null;
  caption?: string | null;
  filename?: string | null;
}
export interface Message {
  id: UUID;
  company_id: UUID;
  conversation_id: UUID;
  direction: 'in' | 'out';
  sender: MessageSender;
  sender_name: string | null;
  body: string;
  media: MediaInfo | null;
  wa_status: 'enviada' | 'entregue' | 'lida' | 'falhou' | null;
  actions: ActionReceipt[] | null;
  response_seconds: number | null;
  channel: 'whatsapp' | 'painel' | 'simulador' | null;
  created_at: ISO;
}

export interface PendingAction {
  id: UUID;
  company_id: UUID;
  conversation_id: UUID;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  status: 'pendente' | 'confirmada' | 'cancelada' | 'expirada' | 'erro';
  expires_at: ISO;
  created_at: ISO;
  resolved_at: ISO | null;
}

export interface AuditEntry {
  id: UUID;
  company_id: UUID;
  actor_type: 'usuario' | 'ia' | 'sistema' | 'cliente';
  actor_name: string | null;
  channel: Channel;
  action: string;
  summary: string;
  target_type: string | null;
  target_id: UUID | null;
  status: 'ok' | 'erro' | 'negado' | 'aguardando' | 'cancelado';
  created_at: ISO;
}

export type AutomationKind = 'lembrete_agendamento' | 'followup_orcamento' | 'resumo_diario' | 'pos_atendimento' | 'reativacao' | 'lembrete_tarefa';
export interface Automation {
  id: UUID;
  company_id: UUID;
  kind: AutomationKind;
  enabled: boolean;
  config: Record<string, number | string | boolean>;
  template_name: string | null;
  last_run_at: ISO | null;
  created_at: ISO;
}
export interface AutomationRun {
  id: UUID;
  company_id: UUID;
  automation_id: UUID | null;
  kind: AutomationKind;
  ran_at: ISO;
  target_label: string;
  status: 'enviado' | 'falhou' | 'ignorado';
  detail: string | null;
}

export interface Notification {
  id: UUID;
  company_id: UUID;
  user_id: UUID | null;
  kind: 'atendimento' | 'agendamento' | 'orcamento' | 'venda' | 'sistema' | 'tarefa' | 'assinatura' | 'estoque' | 'financeiro';
  title: string;
  body: string | null;
  link: string | null;
  read_at: ISO | null;
  created_at: ISO;
}

export interface Invoice {
  id: UUID;
  company_id: UUID;
  amount: number;
  status: 'paga' | 'pendente' | 'vencida' | 'reembolsada' | 'contestada' | 'cancelada';
  due_date: DateStr;
  paid_at: ISO | null;
  method: 'cartao' | 'pix' | 'boleto' | null;
  url: string | null;
  description: string;
  created_at: ISO;
}

export interface UsageMonth {
  company_id: UUID;
  month: string; // "2026-10"
  ai_replies: number;
  wa_sent: number;
  ai_input_tokens: number;
  ai_output_tokens: number;
}

/** Agregado diário (view daily_stats). */
export interface DailyStat {
  day: DateStr;
  msgs_in: number;
  msgs_ai: number;
  msgs_team: number;
  conversations: number;
  new_contacts: number;
  quotes_created: number;
  quotes_sent: number;
  quotes_approved: number;
  quotes_value: number;
  sales_count: number;
  sales_amount: number;
  sales_ia: number;
  sales_equipe: number;
  sales_balcao: number;
  appointments: number;
  response_sum: number;
  response_count: number;
  handoffs: number;
}

export interface Me {
  user_id: UUID;
  email: string;
  name: string;
  role: Role;
  company: Company;
  isPlatformAdmin: boolean;
}

/** Resposta do assistente (comandos do dono) e do simulador de cliente. */
export interface AgentReply {
  conversation_id: UUID;
  reply: string;
  actions: ActionReceipt[];
  pending?: PendingAction | null;
  handoff?: boolean;
}

/* ---------- gestão: financeiro e estoque ---------- */
export type FinanceKind = 'pagar' | 'receber';
export interface FinanceEntry {
  id: UUID;
  company_id: UUID;
  kind: FinanceKind;
  description: string;
  category: string;
  amount: number;
  due_date: DateStr;
  paid_at: ISO | null;
  method: PayMethod | null;
  contact_id: UUID | null;
  counterpart: string | null; // fornecedor ou pagador sem cadastro
  sale_id?: UUID | null; // recebimento que virou venda (não conta duas vezes no caixa)
  recurrence: 'nenhuma' | 'mensal';
  notes: string | null;
  created_via: Channel;
  created_at: ISO;
  updated_at: ISO;
}
export interface Product {
  id: UUID;
  company_id: UUID;
  name: string;
  sku: string | null;
  unit: string;
  category: string;
  stock: number;
  min_stock: number;
  cost: number | null;
  price: number | null;
  active: boolean;
  created_at: ISO;
  updated_at: ISO;
}
export type StockKind = 'entrada' | 'saida' | 'ajuste';
export interface StockMovement {
  id: UUID;
  company_id: UUID;
  product_id: UUID;
  kind: StockKind;
  qty: number;
  balance_after: number | null;
  unit_cost: number | null;
  note: string | null;
  created_by: UUID | null;
  created_via: Channel;
  created_at: ISO;
}
export interface ImportResult { created: number; updated: number; skipped: number }

/* ---------- cobrança dos clientes e nota fiscal ---------- */
export type IntegrationProvider = 'asaas' | 'focusnfe';
export interface CompanyIntegration {
  company_id: UUID;
  provider: IntegrationProvider;
  status: 'conectado' | 'erro' | 'desconectado';
  environment: 'producao' | 'testes';
  config: Record<string, unknown>;
  account_name: string | null;
  last_error: string | null;
  connected_at: ISO | null;
  updated_at: ISO;
}
export type ChargeMethod = 'pix' | 'boleto' | 'pix_boleto';
export type ChargeStatus = 'pendente' | 'paga' | 'vencida' | 'cancelada' | 'estornada';
export interface Charge {
  id: UUID;
  company_id: UUID;
  contact_id: UUID | null;
  quote_id: UUID | null;
  description: string;
  amount: number;
  due_date: DateStr;
  method: ChargeMethod;
  status: ChargeStatus;
  provider_id: string | null;
  invoice_url: string | null;
  pix_code: string | null;
  paid_at: ISO | null;
  sent_at: ISO | null;
  sale_id: UUID | null;
  finance_entry_id: UUID | null;
  created_via: Channel;
  created_at: ISO;
  updated_at: ISO;
}
export type FiscalStatus = 'processando' | 'autorizada' | 'erro' | 'cancelada';
export interface FiscalNote {
  id: UUID;
  company_id: UUID;
  ref: string;
  contact_id: UUID | null;
  sale_id: UUID | null;
  charge_id: UUID | null;
  amount: number;
  description: string;
  taker: { name?: string; document?: string; email?: string; address?: string };
  status: FiscalStatus;
  number: string | null;
  verification_code: string | null;
  pdf_url: string | null;
  xml_url: string | null;
  error: string | null;
  issued_at: ISO | null;
  created_via: Channel;
  created_at: ISO;
  updated_at: ISO;
}

export type TableName =
  | 'contacts' | 'services' | 'quotes' | 'quote_items' | 'appointments' | 'sales' | 'tasks'
  | 'conversations' | 'messages' | 'pending_actions' | 'audit_log' | 'automations' | 'automation_runs'
  | 'notifications' | 'members' | 'invoices' | 'usage_monthly' | 'finance_entries' | 'products' | 'stock_movements'
  | 'charges' | 'fiscal_notes' | 'company_integrations';

export interface RowMap {
  contacts: Contact; services: Service; quotes: Quote; quote_items: QuoteItem; appointments: Appointment;
  sales: Sale; tasks: Task; conversations: Conversation; messages: Message; pending_actions: PendingAction;
  audit_log: AuditEntry; automations: Automation; automation_runs: AutomationRun; notifications: Notification;
  members: Member; invoices: Invoice; usage_monthly: UsageMonth;
  finance_entries: FinanceEntry; products: Product; stock_movements: StockMovement;
  charges: Charge; fiscal_notes: FiscalNote; company_integrations: CompanyIntegration;
}

export type Filter =
  | { col: string; op: 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt'; value: string | number | boolean }
  | { col: string; op: 'in'; value: (string | number)[] }
  | { col: string; op: 'is'; value: null }
  | { col: string; op: 'not_null' };

export interface Query {
  filters?: Filter[];
  order?: { col: string; asc?: boolean }[];
  limit?: number;
  search?: { cols: string[]; term: string };
}
