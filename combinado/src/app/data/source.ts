// Interface única de dados do painel. Há duas implementações:
// - demo (localStorage, sem servidor) para quem quer ver o produto funcionando na hora;
// - Supabase (banco real com RLS + Edge Functions com a IA e o WhatsApp).
import type { TemplateStatus,
  AgentReply, AiSettings, Company, ModuleKey, ValueReport, DailyStat, ImportResult, Me, Member, Query, Quote, QuoteItem, RowMap, TableName, UsageMonth, WhatsAppAccount, Role,
} from './types';
import type { ProductRow } from './sheet';
import type { Cycle, PaidPlanId } from '../../shared/plans';

export type IntegrationAction = 'connect_asaas' | 'connect_focus' | 'disconnect' | 'webhook_info' | 'charge_create' | 'charge_send' | 'charge_cancel' | 'charge_sync' | 'note_emit' | 'note_sync' | 'note_cancel' | 'demo_pay';
export interface SignUpInput { name: string; email: string; password: string }
/** Login social. 'azure' é a conta Microsoft (Outlook, Hotmail, Microsoft 365). */
export type AuthProvider = 'google' | 'apple' | 'azure';
export interface OnboardInput { company: string; segment: string; phone: string; city?: string; preset?: boolean; modules?: ModuleKey[] }
export interface CheckoutInput { plan: PaidPlanId; cycle: Cycle; method: 'cartao' | 'pix_boleto'; cpfCnpj?: string }

export interface DataSource {
  readonly mode: 'demo' | 'supabase';

  /* sessão */
  me(): Promise<Me | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<{ needsConfirmation: boolean }>;
  /** Entrar ou criar conta com Google ou Microsoft (Apple opcional; sai do site e volta já com a sessão). */
  signInWithProvider(provider: AuthProvider, intent?: 'entrar' | 'cadastro'): Promise<void>;
  /** Link de acesso por e-mail, sem senha (também cria a conta se for a primeira vez). */
  signInWithEmailLink(email: string, name?: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  onboard(input: OnboardInput): Promise<void>;
  onAuthChange(cb: () => void): () => void;
  /** Aviso sobre um link de e-mail (confirmação, convite, nova senha) que expirou ou já foi usado. */
  authNotice?(): string | null;

  /* empresa e configurações */
  updateCompany(patch: Partial<Company>): Promise<Company>;
  aiSettings(): Promise<AiSettings>;
  updateAiSettings(patch: Partial<AiSettings>): Promise<AiSettings>;
  whatsapp(): Promise<WhatsAppAccount>;
  connectWhatsApp(input: { phone_number_id: string; waba_id: string; access_token: string; pin?: string }): Promise<WhatsAppAccount>;
  disconnectWhatsApp(): Promise<void>;
  /** Modelos de mensagem na Meta: cadastra os que faltam e devolve a situação de cada um. */
  whatsappTemplates(): Promise<TemplateStatus[]>;
  ownerLinkCode(): Promise<{ code: string; number: string | null; expires_at: string }>;
  inviteMember(input: { name: string; email: string; role: Role }): Promise<Member>;
  updateMember(user_id: string, patch: Partial<Member>): Promise<void>;
  removeMember(user_id: string): Promise<void>;

  /* tabelas */
  list<T extends TableName>(table: T, q?: Query): Promise<RowMap[T][]>;
  get<T extends TableName>(table: T, id: string): Promise<RowMap[T] | null>;
  insert<T extends TableName>(table: T, row: Partial<RowMap[T]>): Promise<RowMap[T]>;
  update<T extends TableName>(table: T, id: string, patch: Partial<RowMap[T]>): Promise<RowMap[T]>;
  remove(table: TableName, id: string): Promise<void>;
  /** Importa produtos de planilha: cria ou atualiza (pelo código ou nome) e acerta o saldo. */
  importProducts(rows: ProductRow[]): Promise<ImportResult>;
  /** Cobrança dos clientes (Asaas) e nota fiscal (Focus NFe): conectar, cobrar, emitir, consultar e cancelar. */
  integrations<T = Record<string, unknown>>(action: IntegrationAction, payload?: Record<string, unknown>): Promise<T>;
  /** O que a ORBYTA fez pela empresa no período (respostas, horários, orçamentos, cobranças, tempo economizado). */
  valueReport(from: string, to: string): Promise<ValueReport>;

  /* orçamentos */
  getQuote(id: string): Promise<Quote | null>;
  saveQuote(quote: Partial<Quote>, items: Partial<QuoteItem>[]): Promise<Quote>;
  sendQuote(id: string): Promise<{ sent: boolean; link: string; reason?: string }>;

  /* conversas */
  /** Link temporário de um arquivo recebido pelo WhatsApp (guardado em pasta privada da empresa). */
  mediaUrl?(path: string): Promise<string | null>;
  sendMessage(conversationId: string, text: string): Promise<void>;
  setHandler(conversationId: string, handler: 'ia' | 'humano'): Promise<void>;
  markRead(conversationId: string): Promise<void>;
  suggestReply(conversationId: string): Promise<string>;

  /* IA */
  assistant(text: string): Promise<AgentReply>;
  resolvePending(pendingId: string, approve: boolean): Promise<AgentReply>;
  simulate(text: string, opts: { reset?: boolean; name?: string }): Promise<AgentReply>;

  /* números */
  dailyStats(from: string, to: string): Promise<DailyStat[]>;
  /** Mensagens recebidas por dia da semana (0 = domingo) e hora: matriz 7 × 24. */
  peakHours(from: string, to: string): Promise<number[][]>;
  usage(): Promise<UsageMonth>;

  /* assinatura */
  checkout(input: CheckoutInput): Promise<{ url?: string | null; scheduled?: string; message?: string }>;
  cancelSubscription(): Promise<void>;
  syncBilling(): Promise<{ status: string }>;

  /* outros */
  exportAll(): Promise<Record<string, unknown>>;
  deleteAccount(): Promise<void>;
  adminOverview(): Promise<AdminOverview>;
  adminHistory(companyId?: string): Promise<AdminHistoryRow[]>;
  adminAction(companyId: string, action: AdminAction, value?: string): Promise<{ detail: string }>;
  subscribe(cb: (table: TableName) => void): () => void;
  resetDemo?(): void;
}

export interface AdminCompanyRow {
  id: string; name: string; segment: string; city: string | null; state: string | null; phone: string | null;
  plan: string; billing_status: string; billing_cycle: string | null; billing_method: string | null;
  trial_ends_at: string; current_period_end: string | null; canceled_at: string | null; complimentary: boolean; created_at: string;
  owner_name: string; owner_email: string; owner_phone: string | null;
  members: number; professionals: number; contacts: number; appointments_month: number; ai_replies_month: number;
  whatsapp: boolean; last_activity: string | null; paid_total: number; note: string; mrr: number;
}
export interface AdminOverview {
  companies: AdminCompanyRow[]; mrr: number; active: number; trialing: number; trial_ending: number; past_due: number; canceled: number;
  complimentary: number; new_month: number; received_month: number;
}
export type AdminAction = 'cortesia' | 'estender_teste' | 'plano' | 'bloquear' | 'desbloquear' | 'nota';
export interface AdminHistoryRow { id: string; company_id: string | null; company_name: string | null; action: string; detail: string; admin_email: string | null; created_at: string }
