// Fonte de dados do modo demonstração (tudo no navegador).
import type { DataSource, AdminOverview } from '../source';
import type { AiSettings, Company, DailyStat, FinanceEntry, ImportResult, Me, Member, Product, Query, Quote, QuoteItem, RowMap, StockMovement, TableName, UsageMonth, WhatsAppAccount } from '../types';
import type { ProductRow } from '../sheet';
import { audit, contactById, demoDb, emit, newId, notify, onChange, pushMessage, resetDemoDb, runQuery, table } from './db';
import { DEMO_COMPANY_ID, DEMO_USER_ID } from './seed';
import { resolvePendingDemo, runOwnerCommand, runSimulator, suggestReplyDemo } from './agent';
import { ZERO } from '../metrics';
import { addDays, brl, localDate } from '../../../shared/format';

const TZ = 'America/Sao_Paulo';
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));
const quoteLink = (q: Pick<Quote, 'public_token'>) => `${location.origin}/orcamento/#${q.public_token}`;

export class DemoSource implements DataSource {
  readonly mode = 'demo' as const;

  async me(): Promise<Me> {
    const d = demoDb();
    return { user_id: DEMO_USER_ID, email: 'voce@brilholar.com.br', name: 'Você (demonstração)', role: 'dono', company: structuredClone(d.company), isPlatformAdmin: true };
  }
  async signIn() { await wait(); }
  async signUp() { await wait(); return { needsConfirmation: false }; }
  async signOut() { await wait(); }
  async requestPasswordReset() { await wait(); }
  async updatePassword() { await wait(); }
  async onboard() { await wait(); }
  onAuthChange() { return () => {}; }

  async updateCompany(patch: Partial<Company>): Promise<Company> {
    const d = demoDb();
    Object.assign(d.company, patch);
    audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'atualizar_empresa', summary: 'Atualizou os dados da empresa', target_type: 'company', target_id: d.company.id, status: 'ok' });
    emit('members');
    return structuredClone(d.company);
  }
  async aiSettings(): Promise<AiSettings> { return structuredClone(demoDb().ai); }
  async updateAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
    const d = demoDb();
    Object.assign(d.ai, patch);
    audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'atualizar_ia', summary: 'Atualizou as configurações do assistente', target_type: null, target_id: null, status: 'ok' });
    emit('members');
    return structuredClone(d.ai);
  }
  async whatsapp(): Promise<WhatsAppAccount> { return structuredClone(demoDb().whatsapp); }
  async connectWhatsApp(input: { phone_number_id: string; waba_id: string; access_token: string; pin?: string }): Promise<WhatsAppAccount> {
    await wait(900);
    const d = demoDb();
    Object.assign(d.whatsapp, { phone_number_id: input.phone_number_id, waba_id: input.waba_id, status: 'conectado', connected_at: new Date().toISOString(), last_error: null });
    emit('members');
    return structuredClone(d.whatsapp);
  }
  async disconnectWhatsApp() { const d = demoDb(); Object.assign(d.whatsapp, { status: 'desconectado', connected_at: null }); emit('members'); }
  async ownerLinkCode() {
    await wait();
    return { code: `ATIVAR ${Math.floor(100000 + Math.random() * 899999)}`, number: demoDb().whatsapp.display_phone, expires_at: new Date(Date.now() + 15 * 60000).toISOString() };
  }
  async inviteMember(input: { name: string; email: string; role: Member['role'] }): Promise<Member> {
    await wait(500);
    const m: Member = { company_id: DEMO_COMPANY_ID, user_id: newId(), role: input.role, name: input.name, email: input.email, phone: null, phone_verified_at: null, active: true, invited: true, created_at: new Date().toISOString() };
    demoDb().members.push(m);
    audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'convidar_membro', summary: `Convidou ${input.name} (${input.email}) como ${input.role}`, target_type: null, target_id: null, status: 'ok' });
    emit('members');
    return structuredClone(m);
  }
  async updateMember(user_id: string, patch: Partial<Member>) { const m = demoDb().members.find((x) => x.user_id === user_id); if (m) Object.assign(m, patch); emit('members'); }
  async removeMember(user_id: string) { const d = demoDb(); d.members = d.members.filter((x) => x.user_id !== user_id); emit('members'); }

  async list<T extends TableName>(name: T, q?: Query): Promise<RowMap[T][]> {
    await wait(60);
    if (name === 'members') return runQuery(demoDb().members, q) as RowMap[T][];
    return runQuery(table(name), q);
  }
  async get<T extends TableName>(name: T, id: string): Promise<RowMap[T] | null> {
    await wait(40);
    const row = (table(name) as { id?: string }[]).find((r) => r.id === id);
    return row ? (structuredClone(row) as RowMap[T]) : null;
  }
  async insert<T extends TableName>(name: T, row: Partial<RowMap[T]>): Promise<RowMap[T]> {
    await wait(120);
    const now = new Date().toISOString();
    const full = { id: newId(), company_id: DEMO_COMPANY_ID, created_at: now, ...(['contacts', 'appointments', 'quotes', 'finance_entries', 'products'].includes(name) ? { updated_at: now } : {}), ...row } as unknown as RowMap[T];
    if (name === 'stock_movements') applyMovement(full as unknown as StockMovement); // valida e atualiza o saldo (no servidor é um gatilho)
    const rows = table(name) as unknown as RowMap[T][];
    rows.unshift(full);
    this.afterWrite(name, full as never, 'insert');
    emit(name);
    return structuredClone(full);
  }
  async update<T extends TableName>(name: T, id: string, patch: Partial<RowMap[T]>): Promise<RowMap[T]> {
    await wait(100);
    const row = (table(name) as unknown as { id: string }[]).find((r) => r.id === id) as unknown as RowMap[T] | undefined;
    if (!row) throw new Error('Registro não encontrado');
    const before = structuredClone(row);
    Object.assign(row as object, patch, 'updated_at' in (row as object) ? { updated_at: new Date().toISOString() } : {});
    this.afterWrite(name, row as never, 'update', before as never);
    emit(name);
    return structuredClone(row);
  }
  async remove(name: TableName, id: string): Promise<void> {
    await wait(100);
    const rows = table(name) as unknown as { id: string }[];
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) {
      const [row] = rows.splice(i, 1);
      if (name === 'quotes') { const d = demoDb(); d.quote_items = d.quote_items.filter((it) => it.quote_id !== id); }
      const label = (row as unknown as { name?: string; title?: string; description?: string }).name ?? (row as unknown as { title?: string }).title ?? '';
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: `excluir_${name}`, summary: `Excluiu ${LABEL[name] ?? 'registro'}${label ? ` "${label}"` : ''}`, target_type: name, target_id: id, status: 'ok' });
    }
    emit(name);
  }

  /** Efeitos que no Supabase são gatilhos e regras. */
  private afterWrite(name: TableName, row: Record<string, unknown>, op: 'insert' | 'update', before?: Record<string, unknown>) {
    if (name === 'sales' && op === 'insert') {
      const c = contactById(row.contact_id as string);
      if (c) { c.total_spent += Number(row.amount); c.stage = 'fechado'; emit('contacts'); }
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'registrar_venda', summary: `Registrou venda de ${brl(Number(row.amount))}${c ? ` para ${c.name}` : ''}`, target_type: 'sale', target_id: row.id as string, status: 'ok' });
    }
    if (name === 'contacts') {
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: op === 'insert' ? 'cadastrar_cliente' : 'atualizar_cliente', summary: `${op === 'insert' ? 'Cadastrou' : 'Atualizou'} ${row.name}`, target_type: 'contact', target_id: row.id as string, status: 'ok' });
    }
    if (name === 'appointments') {
      const c = contactById(row.contact_id as string);
      const what = op === 'insert' ? 'Agendou' : before && before.status !== row.status ? `Marcou como ${row.status}` : 'Atualizou o horário de';
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: op === 'insert' ? 'agendar' : 'atualizar_agendamento', summary: `${what} ${c?.name ?? row.title}`, target_type: 'appointment', target_id: row.id as string, status: 'ok' });
    }
    if (name === 'services' && op === 'update' && before && before.price !== row.price) {
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'atualizar_servico', summary: `Alterou o preço de "${row.name}" de ${brl(Number(before.price))} para ${brl(Number(row.price))}`, target_type: 'service', target_id: row.id as string, status: 'ok' });
    }
    if (name === 'products' && op === 'insert') {
      const p = row as unknown as Product;
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'cadastrar_produto', summary: `Cadastrou o produto ${p.name}`, target_type: 'product', target_id: p.id, status: 'ok' });
      if (Number(p.stock)) { table('stock_movements').unshift({ id: newId(), company_id: DEMO_COMPANY_ID, product_id: p.id, kind: 'ajuste', qty: Number(p.stock), balance_after: Number(p.stock), unit_cost: null, note: 'Saldo inicial', created_by: DEMO_USER_ID, created_via: 'painel', created_at: new Date().toISOString() }); emit('stock_movements'); }
    }
    if (name === 'stock_movements') {
      const m = row as unknown as StockMovement;
      const p = table('products').find((x) => x.id === m.product_id);
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'movimentar_estoque', summary: `${m.kind[0].toUpperCase() + m.kind.slice(1)} de ${m.qty} ${p?.name ?? 'produto'} (saldo: ${m.balance_after})`, target_type: 'product', target_id: m.product_id, status: 'ok' });
      emit('products');
    }
    if (name === 'finance_entries') {
      const f = row as unknown as FinanceEntry;
      if (op === 'insert') audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'lancar_conta', summary: `Lançou conta a ${f.kind}: ${f.description} (${brl(f.amount)})`, target_type: 'finance', target_id: f.id, status: 'ok' });
      if (op === 'update' && f.paid_at && !before?.paid_at) {
        audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'baixar_conta', summary: `Marcou como ${f.kind === 'pagar' ? 'paga' : 'recebida'}: ${f.description} (${brl(f.amount)})`, target_type: 'finance', target_id: f.id, status: 'ok' });
        if (f.recurrence === 'mensal') {
          const next = addMonth(f.due_date);
          if (!table('finance_entries').some((x) => x.description === f.description && x.kind === f.kind && x.due_date === next)) {
            const now = new Date().toISOString();
            table('finance_entries').unshift({ ...f, id: newId(), due_date: next, paid_at: null, method: null, created_via: 'automacao', created_at: now, updated_at: now });
          }
        }
      }
    }
    if (name === 'tasks' && op === 'insert') {
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'criar_tarefa', summary: `Criou a tarefa "${row.title}"`, target_type: 'task', target_id: row.id as string, status: 'ok' });
    }
  }

  async importProducts(rows: ProductRow[]): Promise<ImportResult> {
    await wait(300);
    let created = 0, updated = 0, skipped = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
      const name = r.name?.trim();
      if (!name || name.length > 120) { skipped++; continue; }
      const sku = r.sku?.trim() || null;
      const stock = r.stock != null && r.stock !== '' ? Math.max(0, Number(r.stock)) : null;
      const p = table('products').find((x) => (sku ? x.sku?.toLowerCase() === sku.toLowerCase() : x.name.toLowerCase() === name.toLowerCase()));
      if (!p) {
        const np: Product = { id: newId(), company_id: DEMO_COMPANY_ID, name, sku, unit: r.unit?.trim() || 'un', category: r.category?.trim() || 'Geral', stock: stock ?? 0, min_stock: Number(r.min_stock ?? 0) || 0, cost: r.cost != null ? Number(r.cost) : null, price: r.price != null ? Number(r.price) : null, active: true, created_at: now, updated_at: now };
        table('products').unshift(np);
        if (np.stock) table('stock_movements').unshift({ id: newId(), company_id: DEMO_COMPANY_ID, product_id: np.id, kind: 'ajuste', qty: np.stock, balance_after: np.stock, unit_cost: null, note: 'Importação de planilha', created_by: DEMO_USER_ID, created_via: 'painel', created_at: now });
        created++;
      } else {
        Object.assign(p, { name, unit: r.unit?.trim() || p.unit, category: r.category?.trim() || p.category, min_stock: r.min_stock != null ? Number(r.min_stock) : p.min_stock, cost: r.cost != null ? Number(r.cost) : p.cost, price: r.price != null ? Number(r.price) : p.price, updated_at: now });
        if (stock != null) { p.stock = stock; table('stock_movements').unshift({ id: newId(), company_id: DEMO_COMPANY_ID, product_id: p.id, kind: 'ajuste', qty: stock, balance_after: stock, unit_cost: null, note: 'Importação de planilha', created_by: DEMO_USER_ID, created_via: 'painel', created_at: now }); }
        updated++;
      }
    }
    audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'importar_produtos', summary: `Importou uma planilha de produtos: ${created} novos, ${updated} atualizados`, target_type: null, target_id: null, status: 'ok' });
    emit('products'); emit('stock_movements');
    return { created, updated, skipped };
  }

  async getQuote(id: string): Promise<Quote | null> {
    await wait(60);
    const q = table('quotes').find((x) => x.id === id);
    if (!q) return null;
    return { ...structuredClone(q), items: runQuery(table('quote_items').filter((i) => i.quote_id === id), { order: [{ col: 'sort' }] }) };
  }
  async saveQuote(quote: Partial<Quote>, items: Partial<QuoteItem>[]): Promise<Quote> {
    await wait(200);
    const d = demoDb();
    const now = new Date().toISOString();
    const subtotal = items.reduce((s, i) => s + Number(i.qty ?? 1) * Number(i.unit_price ?? 0), 0);
    const discount = Math.min(subtotal, Number(quote.discount ?? 0));
    let q = quote.id ? table('quotes').find((x) => x.id === quote.id) : undefined;
    if (!q) {
      d.seq.quote++;
      q = {
        id: newId(), company_id: DEMO_COMPANY_ID, number: d.seq.quote, contact_id: quote.contact_id!, title: quote.title ?? null, status: quote.status ?? 'rascunho', subtotal, discount, total: subtotal - discount,
        valid_until: quote.valid_until ?? addDays(localDate(new Date(), TZ), 7), notes: quote.notes ?? null, public_token: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
        sent_at: null, responded_at: null, followup_sent_at: null, created_via: 'painel', created_at: now, updated_at: now,
      };
      table('quotes').unshift(q);
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'criar_orcamento', summary: `Criou o orçamento nº ${String(q.number).padStart(4, '0')} de ${brl(q.total)} para ${contactById(q.contact_id)?.name ?? 'cliente'}`, target_type: 'quote', target_id: q.id, status: 'ok' });
      const c = contactById(q.contact_id); if (c && (c.stage === 'novo' || c.stage === 'conversando')) { c.stage = 'orcamento'; emit('contacts'); }
    } else {
      const prevStatus = q.status;
      Object.assign(q, { contact_id: quote.contact_id ?? q.contact_id, title: quote.title ?? q.title, status: quote.status ?? q.status, valid_until: quote.valid_until ?? q.valid_until, notes: quote.notes ?? q.notes, subtotal, discount, total: subtotal - discount, updated_at: now });
      if (prevStatus !== q.status && (q.status === 'aprovado' || q.status === 'recusado')) {
        q.responded_at = now;
        const c = contactById(q.contact_id); if (c) { c.stage = q.status === 'aprovado' ? 'fechado' : 'perdido'; emit('contacts'); }
      }
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'atualizar_orcamento', summary: `Atualizou o orçamento nº ${String(q.number).padStart(4, '0')} (${q.status})`, target_type: 'quote', target_id: q.id, status: 'ok' });
    }
    d.quote_items = d.quote_items.filter((i) => i.quote_id !== q!.id);
    items.forEach((it, idx) => d.quote_items.push({ id: newId(), quote_id: q!.id, company_id: DEMO_COMPANY_ID, service_id: it.service_id ?? null, description: it.description ?? 'Item', qty: Number(it.qty ?? 1), unit_price: Number(it.unit_price ?? 0), sort: idx }));
    emit('quotes');
    return (await this.getQuote(q.id))!;
  }
  async sendQuote(id: string) {
    await wait(500);
    const q = table('quotes').find((x) => x.id === id);
    if (!q) throw new Error('Orçamento não encontrado');
    q.status = q.status === 'rascunho' ? 'enviado' : q.status; q.sent_at = new Date().toISOString(); q.updated_at = q.sent_at;
    const c = contactById(q.contact_id);
    const conv = table('conversations').find((x) => x.contact_id === q.contact_id && x.kind === 'cliente');
    if (conv) pushMessage(conv, { direction: 'out', sender: 'equipe', sender_name: 'Você', body: `Olá, ${c?.name.split(' ')[0] ?? ''}! Segue o seu orçamento nº ${String(q.number).padStart(4, '0')} no valor de ${brl(q.total)}: ${quoteLink(q)}`, media: null, wa_status: 'enviada', actions: null, response_seconds: null, channel: 'whatsapp' });
    audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: 'enviar_orcamento', summary: `Enviou o orçamento nº ${String(q.number).padStart(4, '0')} para ${c?.name ?? 'cliente'}`, target_type: 'quote', target_id: q.id, status: 'ok' });
    emit('quotes');
    return { sent: true, link: quoteLink(q) };
  }

  async sendMessage(conversationId: string, text: string) {
    await wait(250);
    const conv = table('conversations').find((c) => c.id === conversationId);
    if (!conv) throw new Error('Conversa não encontrada');
    const lastIn = table('messages').filter((m) => m.conversation_id === conversationId && m.direction === 'in').pop();
    const m = pushMessage(conv, { direction: 'out', sender: 'equipe', sender_name: 'Você', body: text, media: null, wa_status: 'enviada', actions: null, response_seconds: lastIn ? Math.round((Date.now() - Date.parse(lastIn.created_at)) / 1000) : null, channel: conv.channel === 'simulador' ? 'simulador' : 'whatsapp' });
    conv.unread = 0; conv.needs_attention = false; conv.attention_reason = null;
    emit('conversations');
    setTimeout(() => { m.wa_status = 'entregue'; emit('messages'); }, 1200);
    setTimeout(() => { m.wa_status = 'lida'; emit('messages'); }, 3500);
  }
  async setHandler(conversationId: string, handler: 'ia' | 'humano') {
    const conv = table('conversations').find((c) => c.id === conversationId);
    if (conv) {
      conv.handler = handler;
      if (handler === 'ia') { conv.needs_attention = false; conv.attention_reason = null; }
      audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'painel', action: handler === 'ia' ? 'devolver_para_ia' : 'assumir_conversa', summary: `${handler === 'ia' ? 'Devolveu para a IA' : 'Assumiu'} a conversa com ${contactById(conv.contact_id)?.name ?? 'cliente'}`, target_type: 'conversation', target_id: conv.id, status: 'ok' });
      emit('conversations');
    }
  }
  async markRead(conversationId: string) {
    const conv = table('conversations').find((c) => c.id === conversationId);
    if (conv && conv.unread) { conv.unread = 0; emit('conversations'); }
  }
  async suggestReply(conversationId: string) { await wait(900); return suggestReplyDemo(conversationId); }

  assistant(text: string) { return runOwnerCommand(text); }
  resolvePending(id: string, approve: boolean) { return resolvePendingDemo(id, approve); }
  simulate(text: string, opts: { reset?: boolean; name?: string }) { return runSimulator(text, opts); }

  async dailyStats(from: string, to: string): Promise<DailyStat[]> {
    await wait(80);
    const d = demoDb();
    const rows = new Map<string, DailyStat>();
    const row = (day: string) => { let r = rows.get(day); if (!r) { r = { day, ...ZERO }; rows.set(day, r); } return r; };
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const r = row(day);
      Object.assign(r, d.msgStats[day] ?? {});
      if (d.oldStats[day]) Object.assign(r, d.oldStats[day]);
    }
    const inRange = (iso: string | null) => { if (!iso) return null; const day = localDate(iso, TZ); return day >= from && day <= to ? day : null; };
    const firstRaw = addDays(localDate(new Date(), TZ), -75);
    for (const c of d.contacts) { const day = inRange(c.created_at); if (day && day >= firstRaw) row(day).new_contacts++; }
    for (const q of d.quotes) {
      const day = inRange(q.created_at); if (day && day >= firstRaw) { const r = row(day); r.quotes_created++; if (q.sent_at) r.quotes_sent++; }
      const rday = q.status === 'aprovado' ? inRange(q.responded_at) : null; if (rday && rday >= firstRaw) { const r = row(rday); r.quotes_approved++; r.quotes_value += q.total; }
    }
    for (const s of d.sales) { const day = inRange(s.paid_at); if (day && day >= firstRaw) { const r = row(day); r.sales_count++; r.sales_amount += s.amount; if (s.origin === 'ia') r.sales_ia += s.amount; else if (s.origin === 'equipe') r.sales_equipe += s.amount; else r.sales_balcao += s.amount; } }
    for (const a of d.appointments) { const day = inRange(a.created_at); if (day && day >= firstRaw) row(day).appointments++; }
    // mensagens trocadas depois que a demonstração foi carregada (simulador e assistente)
    for (const m of d.messages) {
      if (m.created_at <= d.seededAt) continue;
      const day = inRange(m.created_at); if (!day) continue;
      const r = row(day);
      if (m.direction === 'in') r.msgs_in++; else if (m.sender === 'ia') r.msgs_ai++; else if (m.sender === 'equipe') r.msgs_team++;
      if (m.response_seconds) { r.response_sum += m.response_seconds; r.response_count++; }
    }
    return [...rows.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }
  async peakHours(from: string, to: string): Promise<number[][]> {
    // distribuição típica de quem chama no WhatsApp (pico no fim da manhã e à noite), escalada pelo volume real do período
    const d = demoDb();
    const curve = [0.2, 0.1, 0.05, 0.03, 0.03, 0.06, 0.2, 0.55, 0.9, 1.15, 1.25, 1.2, 0.95, 0.85, 1.0, 1.05, 1.0, 0.95, 1.05, 1.25, 1.35, 1.1, 0.7, 0.4];
    const byWd = [0, 0, 0, 0, 0, 0, 0];
    for (const [day, v] of Object.entries(d.msgStats)) if (day >= from && day <= to) byWd[new Date(day + 'T12:00:00Z').getUTCDay()] += v.msgs_in;
    const total = curve.reduce((a, b) => a + b, 0);
    return byWd.map((n, wd) => curve.map((c, h) => Math.round((n * c) / total * (wd === 0 && h < 9 ? 0.6 : 1) * (0.92 + ((wd * 7 + h * 13) % 17) / 100))));
  }
  async usage(): Promise<UsageMonth> {
    const d = demoDb();
    const month = localDate(new Date(), TZ).slice(0, 7);
    const extra = d.messages.filter((m) => m.created_at > d.seededAt && m.sender === 'ia').length;
    const u = d.usage_monthly.find((x) => x.month === month) ?? { company_id: DEMO_COMPANY_ID, month, ai_replies: 0, wa_sent: 0, ai_input_tokens: 0, ai_output_tokens: 0 };
    return { ...u, ai_replies: u.ai_replies + extra };
  }

  async checkout() { await wait(700); return { message: 'No modo demonstração a assinatura não é cobrada. Na sua conta real, você vai para a página segura de pagamento do Asaas (cartão, Pix ou boleto).' }; }
  async cancelSubscription() { await wait(500); }
  async syncBilling() { await wait(500); return { status: demoDb().company.billing_status }; }

  async exportAll() {
    const d = demoDb();
    return { empresa: d.company, assistente: d.ai, clientes: d.contacts, servicos: d.services, orcamentos: d.quotes, itens_orcamento: d.quote_items, agenda: d.appointments, vendas: d.sales, tarefas: d.tasks, historico: d.audit_log };
  }
  async deleteAccount() { resetDemoDb(); }
  async adminOverview(): Promise<AdminOverview> {
    await wait(300);
    const d = demoDb();
    const fake = (name: string, plan: string, status: string, days: number, members: number, ai: number, wa: boolean, mrr: number) => ({ id: newId(), name, plan, billing_status: status, created_at: new Date(Date.now() - days * 86400000).toISOString(), members, ai_replies_month: ai, whatsapp: wa, last_activity: new Date(Date.now() - Math.random() * 3 * 86400000).toISOString(), mrr });
    const companies = [
      { id: d.company.id, name: d.company.name, plan: d.company.plan, billing_status: d.company.billing_status, created_at: d.company.created_at, members: d.members.length, ai_replies_month: (await this.usage()).ai_replies, whatsapp: true, last_activity: new Date().toISOString(), mrr: 299 },
      fake('Studio Bella Estética', 'profissional', 'active', 64, 4, 1120, true, 299), fake('Oficina do Zé Auto Center', 'essencial', 'active', 41, 2, 388, true, 149),
      fake('Pet Feliz Banho & Tosa', 'profissional', 'past_due', 90, 3, 940, true, 299), fake('Clínica Sorriso Leve', 'empresa', 'active', 120, 9, 3012, true, 699),
      fake('Reforma Já Construções', 'teste', 'trialing', 3, 1, 42, false, 0), fake('Doce Encanto Confeitaria', 'teste', 'trialing', 5, 1, 77, true, 0),
      fake('Climatiza Ar-Condicionado', 'essencial', 'canceled', 150, 1, 0, false, 0), fake('Fit Personal Studio', 'essencial', 'active', 22, 1, 260, true, 149),
    ];
    const active = companies.filter((c) => c.billing_status === 'active' || c.billing_status === 'past_due');
    return { companies, mrr: active.reduce((s, c) => s + c.mrr, 0), active: active.length, trialing: companies.filter((c) => c.billing_status === 'trialing').length, canceled: companies.filter((c) => c.billing_status === 'canceled').length };
  }
  subscribe(cb: (t: TableName) => void) { return onChange(cb); }
  resetDemo() { resetDemoDb(); }
}

const LABEL: Partial<Record<TableName, string>> = { contacts: 'o cliente', services: 'o serviço', quotes: 'o orçamento', appointments: 'o agendamento', sales: 'a venda', tasks: 'a tarefa', automations: 'a automação' };

/** Saída maior que o saldo é recusada; avisa quando o produto fica abaixo do mínimo (como o gatilho do banco). */
export function applyMovement(m: StockMovement) {
  const p = table('products').find((x) => x.id === m.product_id);
  if (!p) throw new Error('Produto não encontrado.');
  const qty = Number(m.qty);
  if (!(qty > 0) && m.kind !== 'ajuste') throw new Error('Informe uma quantidade maior que zero.');
  const novo = m.kind === 'entrada' ? p.stock + qty : m.kind === 'saida' ? p.stock - qty : qty;
  if (novo < 0) throw new Error(`Estoque insuficiente de ${p.name}: há ${p.stock} ${p.unit}.`);
  if (novo <= p.min_stock && p.min_stock > 0 && p.stock > p.min_stock) notify({ kind: 'estoque', title: `Estoque baixo: ${p.name}`, body: `Restam ${novo} ${p.unit} (mínimo: ${p.min_stock}).`, link: '#/estoque' });
  m.balance_after = novo;
  p.stock = novo;
  p.updated_at = new Date().toISOString();
}
function addMonth(d: string): string {
  const [y, mo, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(y, mo, Math.min(day, last)));
  return dt.toISOString().slice(0, 10);
}
