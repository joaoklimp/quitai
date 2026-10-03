// Fonte de dados real: Supabase (Postgres com RLS por empresa + Edge Functions para IA, WhatsApp e cobrança).
import { createClient, type EmailOtpType, type SupabaseClient } from '@supabase/supabase-js';
import type { AdminOverview, AuthProvider, CheckoutInput, DataSource, IntegrationAction, OnboardInput, SignUpInput } from '../source';
import type { AgentReply, AiSettings, Company, ValueReport, DailyStat, Filter, ImportResult, Me, Member, Query, Quote, QuoteItem, RowMap, TableName, UsageMonth, WhatsAppAccount, Role } from '../types';
import type { ProductRow } from '../sheet';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
export const hasSupabase = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export class AppError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

const FRIENDLY: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail pelo link que enviamos antes de entrar.',
  'User already registered': 'Já existe uma conta com esse e-mail. Tente entrar ou recuperar a senha.',
  'Password should be at least 6 characters': 'A senha precisa ter pelo menos 8 caracteres.',
  'For security purposes, you can only request this': 'Por segurança, aguarde um minuto antes de pedir outro link.',
  'Email rate limit exceeded': 'Muitos e-mails enviados em pouco tempo. Tente de novo em alguns minutos.',
  'provider is not enabled': 'Esse jeito de entrar ainda não foi ativado. Use o e-mail por enquanto.',
};
function friendly(e: unknown): AppError {
  const msg = (e as { message?: string })?.message ?? String(e);
  for (const [k, v] of Object.entries(FRIENDLY)) if (msg.includes(k)) return new AppError(v);
  if (/row-level security|permission denied/i.test(msg)) return new AppError('Você não tem permissão para fazer isso (ou a assinatura está inativa).', 'forbidden');
  if (/Failed to fetch|NetworkError/i.test(msg)) return new AppError('Sem conexão com o servidor. Confira sua internet e tente de novo.', 'network');
  return new AppError(msg);
}

function applyQuery<Q extends { eq: Function }>(qb: Q, q?: Query): Q {
  let b = qb as unknown as Record<string, Function> & Q;
  for (const f of q?.filters ?? []) b = apply(b, f);
  if (q?.search?.term?.trim()) {
    const t = q.search.term.replace(/[%,()]/g, ' ').trim();
    const digits = t.replace(/\D/g, '');
    const ors = q.search.cols.map((c) => (c === 'tags' ? `tags.cs.{${t.toLowerCase()}}` : `${c}.ilike.%${t}%`));
    if (digits.length >= 4 && q.search.cols.includes('phone')) ors.push(`phone.ilike.%${digits}%`);
    b = b.or(ors.join(','));
  }
  for (const o of q?.order ?? []) b = b.order(o.col, { ascending: o.asc !== false, nullsFirst: false });
  if (q?.limit) b = b.limit(q.limit);
  return b;
}
function apply(b: Record<string, Function>, f: Filter) {
  switch (f.op) {
    case 'is': return b.is(f.col, null);
    case 'not_null': return b.not(f.col, 'is', null);
    case 'in': return b.in(f.col, f.value);
    default: return b[f.op](f.col, f.value);
  }
}

const LINK_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

export class SupabaseSource implements DataSource {
  readonly mode = 'supabase' as const;
  sb: SupabaseClient;
  private companyId: string | null = null;
  private linkReady: Promise<void>;
  private linkNotice: string | null = null;

  constructor() {
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
    this.linkReady = this.consumeEmailLink();
  }

  /**
   * Links dos e-mails de acesso (confirmação de cadastro, convite da equipe, nova senha):
   * - modelos da ORBYTA (supabase/templates): ?token_hash=…&type=…, confirmado aqui e válido em qualquer aparelho;
   * - convite com o modelo padrão do Supabase: a sessão vem no fim do endereço (#…access_token=…),
   *   formato que o cliente em modo PKCE não aceita sozinho;
   * - ?code=… (cadastro e nova senha pedidos neste mesmo navegador): o próprio cliente resolve.
   */
  private async consumeEmailLink(): Promise<void> {
    if (typeof location === 'undefined') return;
    const url = new URL(location.href);
    const q = url.searchParams;
    const cut = url.hash.lastIndexOf('#'); // o painel usa rotas com # e o Supabase acrescenta outro #
    const frag = new URLSearchParams(cut >= 0 ? url.hash.slice(cut + 1) : '');
    const tokenHash = q.get('token_hash');
    const access = frag.get('access_token');
    const refresh = frag.get('refresh_token');
    if (!tokenHash && !access && !q.get('error_description') && !frag.get('error_description')) return;
    const type = (q.get('type') ?? frag.get('type')) as EmailOtpType | null;
    let ok = false;
    try {
      await this.sb.auth.initialize();
      if (tokenHash && type && LINK_TYPES.includes(type)) ok = !(await this.sb.auth.verifyOtp({ token_hash: tokenHash, type })).error;
      else if (access && refresh) ok = !(await this.sb.auth.setSession({ access_token: access, refresh_token: refresh })).error;
    } catch { ok = false; }
    // erro do login social (Google, Microsoft) é diferente de link de e-mail vencido
    const errDesc = q.get('error_description') ?? frag.get('error_description');
    const errCode = q.get('error_code') ?? frag.get('error_code') ?? '';
    const oauthError = !tokenHash && !access && errDesc && !/otp|email link/i.test(`${errCode} ${errDesc}`) ? errDesc : null;
    if (oauthError) this.linkNotice = /provider is not enabled|unsupported provider/i.test(oauthError) ? 'Esse jeito de entrar ainda não foi ativado. Use o e-mail por enquanto.' : /cancel|denied/i.test(oauthError) ? 'Você cancelou o acesso. Tente de novo quando quiser.' : 'Não foi possível entrar com essa conta. Tente de novo ou use o e-mail.';
    else if (!ok) this.linkNotice = 'Este link expirou ou já foi usado. Entre com seu e-mail e senha ou peça um novo em “Esqueci minha senha”.';
    for (const k of ['token_hash', 'type', 'error', 'error_code', 'error_description']) q.delete(k);
    url.hash = ok && (type === 'invite' || type === 'recovery') ? '#/nova-senha' : '#/';
    history.replaceState(history.state, '', url.toString());
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); // avisa as rotas do painel
  }
  /** Aviso sobre um link de e-mail que não funcionou (entregue uma vez só). */
  authNotice(): string | null {
    const n = this.linkNotice;
    this.linkNotice = null;
    return n;
  }

  private async fn<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.functions.invoke(name, { body });
    if (error) {
      // a função devolve { error, message } com status de erro; tenta ler a mensagem amigável
      let detail: { error?: string; message?: string } | null = null;
      try { detail = await (error as { context?: Response }).context?.json(); } catch { /* sem corpo */ }
      throw new AppError(detail?.message ?? detail?.error ?? 'Não foi possível concluir. Tente de novo.', detail?.error);
    }
    return data as T;
  }

  /* ---------- sessão ---------- */
  async me(): Promise<Me | null> {
    await this.linkReady;
    const { data: s } = await this.sb.auth.getSession();
    const user = s.session?.user;
    if (!user) return null;
    const { data: m, error } = await this.sb.from('members').select('*').eq('user_id', user.id).eq('active', true).maybeSingle();
    if (error) throw friendly(error);
    const { data: adm } = await this.sb.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (!m) {
      // Google e Microsoft mandam o nome como full_name; o cadastro da empresa usa "name"
      const meta = user.user_metadata ?? {};
      const name = (meta.name as string) || (meta.full_name as string) || '';
      if (!meta.name && name) await this.sb.auth.updateUser({ data: { name } });
      return { user_id: user.id, email: user.email ?? '', name, role: 'dono', company: null as unknown as Company, isPlatformAdmin: !!adm };
    }
    const { data: c, error: ce } = await this.sb.from('companies').select('*').eq('id', m.company_id).single();
    if (ce) throw friendly(ce);
    this.companyId = c.id;
    return { user_id: user.id, email: user.email ?? m.email, name: m.name, role: m.role, company: c as Company, isPlatformAdmin: !!adm };
  }
  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw friendly(error);
  }
  async signUp(input: SignUpInput) {
    const { data, error } = await this.sb.auth.signUp({
      email: input.email.trim().toLowerCase(), password: input.password,
      options: { data: { name: input.name.trim() }, emailRedirectTo: `${location.origin}/app/` },
    });
    if (error) throw friendly(error);
    return { needsConfirmation: !data.session };
  }
  async signInWithProvider(provider: AuthProvider) {
    const { error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/app/`, ...(provider === 'azure' ? { scopes: 'email' } : {}) } });
    if (error) throw friendly(error);
  }
  async signInWithEmailLink(email: string, name?: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: `${location.origin}/app/`, shouldCreateUser: true, data: name?.trim() ? { name: name.trim() } : undefined } });
    if (error) throw friendly(error);
  }
  async signOut() { await this.sb.auth.signOut(); this.companyId = null; }
  async requestPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}/app/#/nova-senha` });
    if (error) throw friendly(error);
  }
  async updatePassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw friendly(error);
  }
  async onboard(input: OnboardInput) {
    const { data: id, error } = await this.sb.rpc('onboard_company', { p_name: input.company, p_segment: input.segment, p_phone: input.phone, p_city: input.city ?? null, p_preset: input.preset ?? true });
    if (error) throw friendly(error);
    if (input.modules?.length) await this.sb.from('companies').update({ modules: input.modules }).eq('id', id as string);
  }
  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => { if (event !== 'TOKEN_REFRESHED') cb(); });
    return () => data.subscription.unsubscribe();
  }

  /* ---------- empresa ---------- */
  private cid() { if (!this.companyId) throw new AppError('Sessão expirada. Entre de novo.'); return this.companyId; }
  async updateCompany(patch: Partial<Company>) {
    const allowed: (keyof Company)[] = ['name', 'segment', 'document', 'phone', 'email', 'address', 'city', 'state', 'timezone', 'business_hours', 'slot_minutes', 'capacity_per_slot', 'min_notice_minutes', 'max_days_ahead', 'monthly_goal', 'insurances'];
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof Company)));
    const { data, error } = await this.sb.from('companies').update(clean).eq('id', this.cid()).select('*').single();
    if (error) throw friendly(error);
    return data as Company;
  }
  async aiSettings() {
    const { data, error } = await this.sb.from('ai_settings').select('*').eq('company_id', this.cid()).single();
    if (error) throw friendly(error);
    return data as AiSettings;
  }
  async updateAiSettings(patch: Partial<AiSettings>) {
    const { company_id: _c, updated_at: _u, ...clean } = patch;
    void _c; void _u;
    const { data, error } = await this.sb.from('ai_settings').update(clean).eq('company_id', this.cid()).select('*').single();
    if (error) throw friendly(error);
    return data as AiSettings;
  }
  async whatsapp() {
    const { data, error } = await this.sb.from('whatsapp_accounts').select('*').eq('company_id', this.cid()).maybeSingle();
    if (error) throw friendly(error);
    return (data ?? { company_id: this.cid(), phone_number_id: null, waba_id: null, display_phone: null, verified_name: null, status: 'desconectado', last_error: null, connected_at: null }) as WhatsAppAccount;
  }
  async connectWhatsApp(input: { phone_number_id: string; waba_id: string; access_token: string; pin?: string }) {
    const r = await this.fn<{ account: WhatsAppAccount }>('whatsapp', { action: 'connect', ...input });
    return r.account;
  }
  async disconnectWhatsApp() { await this.fn('whatsapp', { action: 'disconnect' }); }
  async ownerLinkCode() {
    const { data, error } = await this.sb.rpc('owner_link_code');
    if (error) throw friendly(error);
    return data as { code: string; number: string | null; expires_at: string };
  }
  async inviteMember(input: { name: string; email: string; role: Role }) {
    const r = await this.fn<{ member: Member }>('team', { action: 'invite', ...input, redirect: `${location.origin}/app/#/nova-senha` });
    return r.member;
  }
  async updateMember(user_id: string, patch: Partial<Member>) {
    const clean: Partial<Member> = {};
    if (patch.role) clean.role = patch.role;
    if (patch.active !== undefined) clean.active = patch.active;
    if (patch.name) clean.name = patch.name;
    if (patch.phone !== undefined) { clean.phone = patch.phone; }
    const { error } = await this.sb.from('members').update(clean).eq('company_id', this.cid()).eq('user_id', user_id);
    if (error) throw friendly(error);
  }
  async removeMember(user_id: string) { await this.fn('team', { action: 'remove', user_id }); }

  /* ---------- tabelas ---------- */
  async list<T extends TableName>(table: T, q?: Query): Promise<RowMap[T][]> {
    const { data, error } = await applyQuery(this.sb.from(table).select('*'), q);
    if (error) throw friendly(error);
    return (data ?? []) as RowMap[T][];
  }
  async get<T extends TableName>(table: T, id: string): Promise<RowMap[T] | null> {
    const { data, error } = await this.sb.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw friendly(error);
    return data as RowMap[T] | null;
  }
  async insert<T extends TableName>(table: T, row: Partial<RowMap[T]>): Promise<RowMap[T]> {
    const { data, error } = await this.sb.from(table).insert({ ...row, company_id: this.cid() }).select('*').single();
    if (error) throw friendly(error);
    return data as RowMap[T];
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<RowMap[T]>): Promise<RowMap[T]> {
    const { id: _i, company_id: _c, created_at: _ca, ...clean } = patch as Record<string, unknown>;
    void _i; void _c; void _ca;
    const { data, error } = await this.sb.from(table).update(clean).eq('id', id).select('*').single();
    if (error) throw friendly(error);
    return data as RowMap[T];
  }
  async remove(table: TableName, id: string) {
    const { error } = await this.sb.from(table).delete().eq('id', id);
    if (error) throw friendly(error);
  }
  async valueReport(from: string, to: string): Promise<ValueReport> {
    const { data, error } = await this.sb.rpc('value_report', { p_from: from, p_to: to });
    if (error) throw friendly(error);
    return data as ValueReport;
  }
  async integrations<T = Record<string, unknown>>(action: IntegrationAction, payload: Record<string, unknown> = {}) {
    return this.fn<T>('integrations', { action, ...payload });
  }
  async importProducts(rows: ProductRow[]) {
    const { data, error } = await this.sb.rpc('import_products', { p_rows: rows });
    if (error) throw friendly(error);
    return data as ImportResult;
  }

  /* ---------- orçamentos ---------- */
  async getQuote(id: string) {
    const { data, error } = await this.sb.from('quotes').select('*, items:quote_items(*)').eq('id', id).maybeSingle();
    if (error) throw friendly(error);
    if (!data) return null;
    const q = data as Quote & { items: QuoteItem[] };
    q.items = [...(q.items ?? [])].sort((a, b) => a.sort - b.sort);
    return q;
  }
  async saveQuote(quote: Partial<Quote>, items: Partial<QuoteItem>[]) {
    const { data, error } = await this.sb.rpc('save_quote', {
      p_quote: { id: quote.id ?? null, contact_id: quote.contact_id, title: quote.title ?? null, status: quote.status ?? 'rascunho', discount: quote.discount ?? 0, valid_until: quote.valid_until ?? null, notes: quote.notes ?? null },
      p_items: items.map((i, idx) => ({ service_id: i.service_id ?? null, description: i.description ?? '', qty: Number(i.qty ?? 1), unit_price: Number(i.unit_price ?? 0), sort: idx })),
    });
    if (error) throw friendly(error);
    return (await this.getQuote(data as string))!;
  }
  async sendQuote(id: string) {
    return this.fn<{ sent: boolean; link: string; reason?: string }>('whatsapp', { action: 'send_quote', quote_id: id, origin: location.origin });
  }

  /* ---------- conversas ---------- */
  async mediaUrl(path: string) {
    const { data } = await this.sb.storage.from('whatsapp-media').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }
  async sendMessage(conversationId: string, text: string) { await this.fn('whatsapp', { action: 'send', conversation_id: conversationId, text }); }
  async setHandler(conversationId: string, handler: 'ia' | 'humano') {
    const patch = handler === 'ia' ? { handler, needs_attention: false, attention_reason: null } : { handler };
    const { error } = await this.sb.from('conversations').update(patch).eq('id', conversationId);
    if (error) throw friendly(error);
  }
  async markRead(conversationId: string) {
    const { error } = await this.sb.from('conversations').update({ unread: 0 }).eq('id', conversationId).gt('unread', 0);
    if (error) throw friendly(error);
  }
  async suggestReply(conversationId: string) {
    const r = await this.fn<{ text: string }>('agent', { action: 'suggest', conversation_id: conversationId });
    return r.text;
  }

  /* ---------- IA ---------- */
  assistant(text: string) { return this.fn<AgentReply>('agent', { action: 'assistant', text }); }
  resolvePending(pendingId: string, approve: boolean) { return this.fn<AgentReply>('agent', { action: 'resolve', pending_id: pendingId, approve }); }
  simulate(text: string, opts: { reset?: boolean; name?: string }) { return this.fn<AgentReply>('agent', { action: 'simulate', text, ...opts }); }

  /* ---------- números ---------- */
  async dailyStats(from: string, to: string) {
    const { data, error } = await this.sb.rpc('daily_stats', { p_from: from, p_to: to });
    if (error) throw friendly(error);
    return ((data ?? []) as DailyStat[]).map((r) => {
      const out = { ...r } as Record<string, unknown>;
      for (const [k, v] of Object.entries(out)) if (k !== 'day' && v != null) out[k] = Number(v);
      return out as unknown as DailyStat;
    });
  }
  async peakHours(from: string, to: string): Promise<number[][]> {
    const { data, error } = await this.sb.rpc('peak_hours', { p_from: from, p_to: to });
    if (error) throw friendly(error);
    const m = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const r of (data ?? []) as { dow: number; hour: number; total: number }[]) m[r.dow][r.hour] = Number(r.total);
    return m;
  }
  async usage(): Promise<UsageMonth> {
    const { data, error } = await this.sb.rpc('usage_current');
    if (error) throw friendly(error);
    return data as UsageMonth;
  }

  /* ---------- assinatura ---------- */
  checkout(input: CheckoutInput) { return this.fn<{ url?: string | null; scheduled?: string; message?: string }>('billing', { action: 'checkout', ...input, origin: location.origin }); }
  async cancelSubscription() { await this.fn('billing', { action: 'cancel' }); }
  syncBilling() { return this.fn<{ status: string }>('billing', { action: 'sync' }); }

  /* ---------- outros ---------- */
  async exportAll() {
    const tables: TableName[] = ['contacts', 'services', 'quotes', 'quote_items', 'appointments', 'sales', 'tasks', 'audit_log'];
    const out: Record<string, unknown> = {};
    const { data: company } = await this.sb.from('companies').select('*').eq('id', this.cid()).single();
    out.empresa = company;
    for (const t of tables) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await this.sb.from(t).select('*').range(from, from + 999);
        if (error) throw friendly(error);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      out[t] = rows;
    }
    return out;
  }
  async deleteAccount() { await this.fn('team', { action: 'delete_account' }); await this.signOut(); }
  async adminOverview() {
    const { data, error } = await this.sb.rpc('admin_overview');
    if (error) throw friendly(error);
    return data as AdminOverview;
  }
  subscribe(cb: (t: TableName) => void) {
    const cid = this.companyId;
    if (!cid) return () => {};
    const ch = this.sb.channel(`empresa-${cid}`);
    for (const t of ['messages', 'conversations', 'notifications', 'appointments', 'quotes', 'pending_actions', 'contacts', 'sales', 'tasks', 'finance_entries', 'products', 'stock_movements', 'charges', 'fiscal_notes', 'waitlist', 'professionals'] as TableName[]) {
      ch.on('postgres_changes' as never, { event: '*', schema: 'public', table: t, filter: `company_id=eq.${cid}` } as never, () => cb(t));
    }
    ch.subscribe();
    return () => { void this.sb.removeChannel(ch); };
  }
}
