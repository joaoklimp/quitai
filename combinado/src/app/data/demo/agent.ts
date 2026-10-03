// Agente local do modo demonstração. Entende comandos comuns em português e executa as mesmas ações
// que a IA de verdade (Claude + ferramentas) faz no servidor. Serve para experimentar o produto sem chaves.
import type { ActionReceipt, AgentReply, Appointment, Contact, Conversation, FinanceEntry, PayMethod, PendingAction, Product, Quote, Sale, Service } from '../types';
import { audit, autoAssign, contactById, demoDb, emit, newId, notify, pushMessage, table } from './db';
import { DEMO_COMPANY_ID, DEMO_USER_ID } from './seed';
import { applyMovement, demoCreateCharge, demoEmitNote } from './demoSource';
import { isFree, slotsForDate, type SlotOpts } from '../availability';
import { parseDate, parseMethod, parseMoneyIn, parsePhone, parseTime } from '../../../shared/parse';
export { parseDate, parseMethod, parseMoneyIn, parsePhone, parseTime };
import {
  addDays, brl, firstName, fmtDate, fmtLong, fold, formatPhone, fromLocal, localDate, localTime, normalizePhone, parseMoney, weekdayOf, WEEKDAYS,
} from '../../../shared/format';

const TZ = 'America/Sao_Paulo';
let instant = false;
/** Desliga as pausas que imitam o tempo de resposta (usado nos testes). */
export function setInstant(v = true) { instant = v; }
const pause = (ms: number) => (instant ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const AI_NAME = () => `${demoDb().ai.assistant_name} (IA)`;
/** Profissionais na regra de horários livres (a mesma do servidor). */
const po = (serviceId?: string | null, professionalId?: string | null): SlotOpts => ({ professionals: table('professionals'), serviceId: serviceId ?? null, professionalId: professionalId ?? null });
const proName = (id?: string | null) => (id ? table('professionals').find((p) => p.id === id)?.name : undefined);
/** "com a Dra. Marina", "com o Rafael": o profissional citado na mensagem. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matchPro(f: string): string | null {
  for (const p of table('professionals').filter((x) => x.active)) {
    const toks = fold(p.name).replace(/^(dra?|prof(a)?)\.?\s+/, '').split(/\s+/);
    // nosemgrep -- o nome do profissional passa por escapeRe antes de entrar na expressão
    if (toks.some((t) => t.length > 2 && new RegExp(`\\bcom (a |o )?(dra?\\.? |doutora? |dr )?${escapeRe(t)}\\b`).test(f))) return p.id;
  }
  return null;
}
const qn = (n: number) => String(n).padStart(4, '0');

/* extração de dados do texto: src/shared/parse.ts */
const METHOD_LABEL: Record<PayMethod, string> = { pix: 'Pix', dinheiro: 'dinheiro', cartao_credito: 'cartão de crédito', cartao_debito: 'cartão de débito', boleto: 'boleto', transferencia: 'transferência', outro: 'outro' };
const titleCase = (s: string) => s.split(/\s+/).map((w) => (/^(da|de|do|das|dos|e)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');

/** Nome logo depois de um verbo de cadastro. */
function nameAfterVerb(raw: string): string | null {
  const m = raw.match(/(?:[Cc]adastr|[Aa]dicion|[Ii]nclu|[Ss]alv|[Rr]egistr|[Aa]not|[Aa]gend|[Mm]arc|[Rr]eserv)\w*\s+(?:(?:[Aa]|[Oo]|um|uma)\s+)?(?:(?:nova|novo)\s+)?(?:paciente\s+)?(?:(?:a|o)\s+)?([A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ']+){0,3})/);
  if (!m) return null;
  let name = m[1].replace(/\s+(telefone|tel|fone|celular|numero|número|whats|zap|email|e-mail)\b.*$/i, '').trim();
  if (!name || /^(cliente|venda|orcamento|orçamento)$/i.test(name)) return null;
  // se veio tudo minúsculo, pega no máximo duas palavras
  if (name === name.toLowerCase()) name = name.split(/\s+/).slice(0, 2).join(' ');
  return titleCase(name);
}
/** Nome depois de "para a", "pra", "da", "do", "de"... */
function nameAfterPrep(raw: string): string | null {
  const m = raw.match(/(?:^|\s)(?:[Pp]ara|[Pp]ra|[Pp]ro|ao|à|a|da|do|de|com)\s+(?:(?:a|o)\s+)?(?:paciente\s+)?([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ']+){0,3})/);
  if (m && !/^(Pix|Sim|Não|Nao|Orçamento|Orcamento|Segunda|Terça|Quarta|Quinta|Sexta|Sábado|Domingo|Hoje|Amanhã|R)$/.test(m[1])) return m[1];
  const f = fold(raw).match(/\b(?:para|pra|pro|da|do)\s+(?:a|o)\s+([a-z]+)\b/);
  if (f && !/^(ela|ele|semana|tarde|manha|noite|mes|dia|cliente|venda|agenda)$/.test(f[1])) return titleCase(f[1]);
  return null;
}
export function findContacts(name: string): Contact[] {
  const toks = fold(name).split(/\s+/).filter((t) => t.length > 1 && !['da', 'de', 'do', 'das', 'dos'].includes(t));
  if (!toks.length) return [];
  return table('contacts')
    .filter((c) => { const parts = fold(c.name).split(/\s+/); return toks.every((t) => parts.some((p) => p.startsWith(t))); })
    .sort((a, b) => ((b.last_interaction_at ?? '') > (a.last_interaction_at ?? '') ? 1 : -1));
}
function matchService(f: string): Service | null {
  const svcs = table('services').filter((s) => s.active);
  const rules: [RegExp, string][] = [
    [/manutencao.*aparelho|manter o aparelho|ajustar o aparelho/, 'Manutenção de aparelho'], [/colocar aparelho|instal\w* .*aparelho|aparelho fixo|por aparelho/, 'Instalação de aparelho'],
    [/ortodon|aparelho/, 'Avaliação ortodôntica'], [/clareamento caseiro|moldeira/, 'Clareamento caseiro'], [/clare(ar|amento)|dente(s)? (mais )?branco/, 'Clareamento a laser'],
    [/implante/, 'Implante'], [/canal|endodon/, 'Tratamento de canal'], [/extra(ir|cao|ção)|tirar (o |um )?dente|siso/, 'Extração'],
    [/restaura|obtura|carie|dente quebr/, 'Restauração'], [/limpeza|profilax|tartaro/, 'Limpeza'], [/dor|urgencia|inchad|quebrou/, 'Urgência'],
    [/avaliacao|consulta|check.?up|revisao/, 'Avaliação ('],
  ];
  for (const [re, prefix] of rules) if (re.test(f)) { const s = svcs.find((x) => x.name.startsWith(prefix)); if (s) return s; }
  return null;
}

/* ================= ações (as mesmas "ferramentas" do servidor) ================= */
function ownerConversation(): Conversation {
  const convs = table('conversations');
  let c = convs.find((x) => x.kind === 'dono' && x.member_user_id === DEMO_USER_ID);
  if (!c) {
    c = { id: newId(), company_id: DEMO_COMPANY_ID, contact_id: null, member_user_id: DEMO_USER_ID, kind: 'dono', channel: 'painel', handler: 'ia', status: 'aberta', needs_attention: false, attention_reason: null, unread: 0, last_message_at: null, last_message_preview: null, last_inbound_at: null, created_at: new Date().toISOString() };
    convs.push(c);
  }
  return c;
}

function createContact(name: string, phone: string | null, via: Contact['created_via'], extra: Partial<Contact> = {}): { contact: Contact; existed: boolean } {
  const contacts = table('contacts');
  if (phone) { const ex = contacts.find((c) => c.phone && normalizePhone(c.phone) === phone); if (ex) return { contact: ex, existed: true }; }
  const now = new Date().toISOString();
  const c: Contact = {
    id: newId(), company_id: DEMO_COMPANY_ID, name, phone, email: null, address: null, notes: null, tags: [], stage: 'novo', temperature: 'morno', score: 50,
    source: 'manual', opt_in: true, birthday: null, last_interaction_at: now, total_spent: 0, created_via: via, created_at: now, updated_at: now, ...extra,
  };
  contacts.unshift(c);
  emit('contacts');
  return { contact: c, existed: false };
}

function createQuote(contact: Contact, items: { description: string; qty: number; unit_price: number; service_id: string | null }[], via: Quote['created_via'], discount = 0, status: Quote['status'] = 'rascunho'): Quote {
  const d = demoDb();
  d.seq.quote++;
  const now = new Date().toISOString();
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const q: Quote = {
    id: newId(), company_id: DEMO_COMPANY_ID, number: d.seq.quote, contact_id: contact.id, title: items[0]?.description ?? 'Orçamento', status, subtotal, discount, total: Math.max(0, subtotal - discount),
    valid_until: addDays(localDate(new Date(), TZ), 7), notes: null, public_token: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2), sent_at: status === 'enviado' ? now : null,
    responded_at: null, followup_sent_at: null, created_via: via, created_at: now, updated_at: now,
  };
  table('quotes').unshift(q);
  items.forEach((it, i) => table('quote_items').push({ id: newId(), quote_id: q.id, company_id: DEMO_COMPANY_ID, sort: i, ...it }));
  if (contact.stage === 'novo' || contact.stage === 'conversando') contact.stage = 'orcamento';
  emit('quotes'); emit('contacts');
  return q;
}

function createAppointment(contact: Contact, startsAt: string, service: Service | null, via: Appointment['created_via'], extra: Partial<Appointment> = {}): Appointment {
  const dur = service?.duration_min ?? demoDb().company.slot_minutes;
  const now = new Date().toISOString();
  const ins = contact.insurance && (demoDb().company.insurances ?? []).includes(contact.insurance) && service && !['Ortodontia', 'Estética', 'Implantes'].includes(service.category ?? '') ? contact.insurance : null;
  const a: Appointment = {
    id: newId(), company_id: DEMO_COMPANY_ID, contact_id: contact.id, service_id: service?.id ?? null, title: service?.name ?? 'Consulta', starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + dur * 60000).toISOString(), status: demoDb().ai.booking_mode === 'confirmar' && via === 'ia_cliente' ? 'pendente' : 'confirmado',
    address: null, notes: null, price: service && service.price_type !== 'sob_consulta' && !ins ? service.price : null, created_via: via, reminder_sent_at: null, created_at: now, updated_at: now,
    professional_id: null, payment_kind: ins ? 'convenio' : 'particular', insurance: ins, patient_confirmed_at: null, ...extra,
  };
  table('appointments').push(a);
  emit('appointments');
  return a;
}

function registerSale(input: { amount: number; method: PayMethod; contact_id: string | null; description: string; origin: Sale['origin']; via: Sale['created_via'] }): Sale {
  const now = new Date().toISOString();
  const s: Sale = { id: newId(), company_id: DEMO_COMPANY_ID, contact_id: input.contact_id, quote_id: null, appointment_id: null, description: input.description, amount: input.amount, method: input.method, origin: input.origin, paid_at: now, created_via: input.via, created_at: now };
  table('sales').unshift(s);
  const c = contactById(input.contact_id);
  if (c) { c.total_spent += input.amount; c.stage = 'fechado'; }
  emit('sales'); emit('contacts');
  return s;
}

function nextAppointmentOf(contact: Contact): Appointment | undefined {
  const now = Date.now();
  return table('appointments').filter((a) => a.contact_id === contact.id && Date.parse(a.starts_at) > now && a.status !== 'cancelado').sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))[0];
}

/* ================= resumos ================= */
function periodRange(f: string, today: string): { from: string; to: string; label: string } {
  if (/\bontem\b/.test(f)) { const d = addDays(today, -1); return { from: d, to: d, label: 'ontem' }; }
  if (/\bsemana passada\b/.test(f)) { let s = today; while (weekdayOf(s) !== 1) s = addDays(s, -1); return { from: addDays(s, -7), to: addDays(s, -1), label: 'na semana passada' }; }
  if (/\bsemana\b/.test(f)) { let s = today; while (weekdayOf(s) !== 1) s = addDays(s, -1); return { from: s, to: today, label: 'nesta semana (desde segunda)' }; }
  if (/\bmes passado\b/.test(f)) { const [y, m] = today.split('-').map(Number); const s = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); const e = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10); return { from: s, to: e, label: 'no mês passado' }; }
  if (/\bmes\b/.test(f)) return { from: `${today.slice(0, 7)}-01`, to: today, label: 'neste mês' };
  if (/\bano\b/.test(f)) return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'neste ano' };
  return { from: today, to: today, label: 'hoje' };
}
function salesSummary(f: string): { text: string } {
  const today = localDate(new Date(), TZ);
  const r = periodRange(f, today);
  const list = table('sales').filter((s) => { const d = localDate(s.paid_at, TZ); return d >= r.from && d <= r.to; });
  const total = list.reduce((s, x) => s + x.amount, 0);
  if (!list.length) return { text: `Ainda não há pagamentos registrados ${r.label}.` };
  const by = (m: (s: Sale) => boolean) => list.filter(m).reduce((s, x) => s + x.amount, 0);
  const ia = list.filter((s) => s.origin === 'ia');
  return {
    text: `${r.label[0].toUpperCase() + r.label.slice(1)} a clínica recebeu ${brl(total)} em ${list.length} ${list.length === 1 ? 'pagamento' : 'pagamentos'} particulares. 📈\n• Pix: ${brl(by((s) => s.method === 'pix'))}\n• Cartão: ${brl(by((s) => s.method.startsWith('cartao')))}\n• Dinheiro e outros: ${brl(by((s) => !['pix', 'cartao_credito', 'cartao_debito'].includes(s.method)))}\n• De consultas marcadas pela IA: ${ia.length} (${brl(ia.reduce((s, x) => s + x.amount, 0))})\nRepasses de convênio aparecem no Financeiro.`,
  };
}
function agendaOf(date: string): string {
  const list = table('appointments').filter((a) => localDate(a.starts_at, TZ) === date && a.status !== 'cancelado').sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const label = date === localDate(new Date(), TZ) ? 'Hoje' : fmtLong(date)[0].toUpperCase() + fmtLong(date).slice(1);
  if (!list.length) return `${label} a agenda está livre. 🙌`;
  const pending = list.filter((a) => !a.patient_confirmed_at && a.status !== 'concluido' && a.status !== 'faltou').length;
  return `${label} são ${list.length} ${list.length === 1 ? 'consulta' : 'consultas'}${pending ? ` (${pending} sem confirmar)` : ''}:\n` + list.map((a) => `• ${localTime(a.starts_at, TZ)} — ${contactById(a.contact_id)?.name ?? 'Paciente'} · ${a.title}${proName(a.professional_id) ? ` · ${proName(a.professional_id)!.split(' ').slice(0, 2).join(' ')}` : ''}${a.status === 'concluido' ? ' · atendido' : a.status === 'faltou' ? ' · faltou' : a.patient_confirmed_at ? ' ✅' : ' · sem confirmar'}`).join('\n');
}

/* ================= confirmação de ações sensíveis ================= */
function createPending(conv: Conversation, tool: string, args: Record<string, unknown>, summary: string): PendingAction {
  const p: PendingAction = { id: newId(), company_id: DEMO_COMPANY_ID, conversation_id: conv.id, tool, args, summary, status: 'pendente', expires_at: new Date(Date.now() + 30 * 60000).toISOString(), created_at: new Date().toISOString(), resolved_at: null };
  table('pending_actions').push(p);
  audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: tool, summary: `Pediu confirmação: ${summary}`, target_type: null, target_id: null, status: 'aguardando' });
  emit('pending_actions');
  return p;
}
function executePending(p: PendingAction): ActionReceipt {
  const a = p.args as Record<string, never>;
  if (p.tool === 'registrar_venda') {
    const s = registerSale({ amount: a.amount, method: a.method, contact_id: a.contact_id ?? null, description: a.description ?? 'Venda', origin: 'equipe', via: 'ia_dono' });
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'registrar_venda', summary: `Registrou venda de ${brl(s.amount)} (${METHOD_LABEL[s.method]})${a.contact_name ? ` para ${a.contact_name}` : ''} — confirmada pelo dono`, target_type: 'sale', target_id: s.id, status: 'ok' });
    notify({ kind: 'venda', title: 'Venda registrada pelo assistente', body: `${brl(s.amount)} · ${METHOD_LABEL[s.method]}${a.contact_name ? ` · ${a.contact_name}` : ''}`, link: '#/vendas' });
    return { tool: 'registrar_venda', label: `Venda de ${brl(s.amount)} registrada`, status: 'ok', detail: `${METHOD_LABEL[s.method]}${a.contact_name ? ` · ${a.contact_name}` : ''}` };
  }
  if (p.tool === 'cancelar_agendamento') {
    const ap = table('appointments').find((x) => x.id === a.appointment_id);
    if (!ap) return { tool: p.tool, label: 'Agendamento não encontrado', status: 'erro' };
    ap.status = 'cancelado'; ap.updated_at = new Date().toISOString(); emit('appointments');
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'cancelar_agendamento', summary: `Cancelou o horário de ${a.contact_name} (${fmtDate(ap.starts_at)} ${localTime(ap.starts_at, TZ)}) — confirmado pelo dono`, target_type: 'appointment', target_id: ap.id, status: 'ok' });
    return { tool: p.tool, label: 'Agendamento cancelado', status: 'ok', detail: `${a.contact_name} · ${fmtDate(ap.starts_at)} às ${localTime(ap.starts_at, TZ)}` };
  }
  if (p.tool === 'atualizar_servico') {
    const s = table('services').find((x) => x.id === a.service_id);
    if (!s) return { tool: p.tool, label: 'Serviço não encontrado', status: 'erro' };
    const old = s.price; s.price = a.price; emit('services');
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'atualizar_servico', summary: `Alterou o valor de "${s.name}" de ${brl(old)} para ${brl(s.price)} — confirmado pelo dono`, target_type: 'service', target_id: s.id, status: 'ok' });
    return { tool: p.tool, label: 'Valor atualizado', status: 'ok', detail: `${s.name}: ${brl(s.price)}` };
  }
  if (p.tool === 'criar_orcamento') {
    const c = contactById(a.contact_id);
    if (!c) return { tool: p.tool, label: 'Paciente não encontrado', status: 'erro' };
    const q = createQuote(c, a.items, 'ia_dono', a.discount);
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'criar_orcamento', summary: `Criou o orçamento nº ${qn(q.number)} de ${brl(q.total)} com desconto acima do limite — confirmado pelo dono`, target_type: 'quote', target_id: q.id, status: 'ok' });
    return { tool: p.tool, label: `Orçamento nº ${qn(q.number)} criado`, status: 'ok', detail: `${brl(q.total)} · desconto de ${brl(q.discount)}` };
  }
  if (p.tool === 'baixar_conta') {
    const e = table('finance_entries').find((x) => x.id === a.entry_id);
    if (!e) return { tool: p.tool, label: 'Conta não encontrada', status: 'erro' };
    if (e.paid_at) return { tool: p.tool, label: 'Conta já estava baixada', status: 'ok' };
    const now = new Date().toISOString();
    e.paid_at = now; e.method = a.method ?? 'pix'; e.updated_at = now;
    if (e.recurrence === 'mensal') {
      const [y, m, d] = e.due_date.split('-').map(Number);
      const next = new Date(Date.UTC(y, m, Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
      if (!table('finance_entries').some((x) => x.description === e.description && x.due_date === next)) table('finance_entries').unshift({ ...e, id: newId(), due_date: next, paid_at: null, method: null, created_via: 'automacao', created_at: now, updated_at: now });
    }
    emit('finance_entries');
    const verb = e.kind === 'pagar' ? 'paga' : 'recebida';
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'baixar_conta', summary: `Marcou como ${verb}: ${e.description} (${brl(e.amount)}) — confirmado pelo dono`, target_type: 'finance', target_id: e.id, status: 'ok' });
    return { tool: p.tool, label: `Conta ${verb}`, status: 'ok', detail: `${e.description} · ${brl(e.amount)}`, link: '#/financeiro' };
  }
  if (p.tool === 'cobrar_cliente') {
    try {
      const r = demoCreateCharge({ ...p.args, send: true }, 'ia_dono');
      return { tool: p.tool, label: `Cobrança de ${brl(r.charge.amount)} ${r.sent ? 'enviada' : 'criada'}`, status: 'ok', detail: `${a.contact_name} · vence ${fmtDate(r.charge.due_date).slice(0, 5)}${r.sent ? ' · link no WhatsApp' : ''}`, link: '#/cobrancas' };
    } catch (e) { return { tool: p.tool, label: 'Não deu para cobrar', status: 'erro', detail: (e as Error).message }; }
  }
  if (p.tool === 'emitir_nota') {
    try {
      const n = demoEmitNote(p.args, 'ia_dono');
      return { tool: p.tool, label: 'Nota enviada para a prefeitura', status: 'ok', detail: `${n.taker.name} · ${brl(n.amount)} · aviso quando autorizar`, link: '#/cobrancas?aba=notas' };
    } catch (e) { return { tool: p.tool, label: 'Não deu para emitir a nota', status: 'erro', detail: (e as Error).message }; }
  }
  return { tool: p.tool, label: 'Ação desconhecida', status: 'erro' };
}

/** "muda o valor da limpeza para R$ 270", "a limpeza agora custa 270", "reajusta o preço do clareamento" */
const PRICE_CHANGE = /\b(muda|mude|altera|altere|atualiza|atualize|aumenta|aumente|reajusta|reajuste|baixa|baixe|abaixa|coloca|coloque|poe|deixa|deixe|troca|troque)\w*\b.*\b(preco|valor|custo)\b|\b(preco|valor)\b.*\b(passa|vai|fica|agora)\b.*\d|\b(agora|passa a)\s+(custa|custar|e|sai)\b.*\d/;

/* ================= financeiro e estoque (comandos) ================= */
const STOP = new Set(['para', 'pra', 'com', 'uma', 'umas', 'uns', 'dos', 'das', 'que', 'conta', 'contas', 'estoque', 'produto', 'produtos', 'entrada', 'saida', 'baixa', 'chegou', 'chegaram', 'usei', 'gastei', 'vendi', 'unidades', 'unidade', 'litros', 'galao', 'galoes', 'frasco', 'frascos', 'pacote', 'pacotes', 'caixa', 'caixas', 'mais', 'registra', 'lanca', 'paguei', 'recebi', 'quanto', 'tenho', 'temos', 'ainda', 'hoje']);
const words = (t: string) => fold(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
function bestMatch<T>(items: T[], text: (x: T) => string, query: string): T | null {
  const q = words(query);
  let best: T | null = null, score = 0;
  for (const it of items) {
    const w = words(text(it));
    const hits = q.filter((x) => w.some((y) => y.startsWith(x.slice(0, Math.max(4, x.length - 2))) || x.startsWith(y.slice(0, Math.max(4, y.length - 2))))).length;
    if (hits > score) { score = hits; best = it; }
  }
  return score > 0 ? best : null;
}
const qtyIn = (f: string) => { const m = f.match(/(\d+(?:[.,]\d+)?)\s*(?:un|unidades?|litros?|l\b|galo(?:es|ns)?|galao|frascos?|pacotes?|caixas?|pares?|kits?|kg)?/); return m ? Number(m[1].replace(',', '.')) : null; };

function handleGestao(ctx: Ctx, clause: string, f: string): boolean {
  const today = ctx.today;
  // lista de espera
  if (/\blista de espera\b/.test(f) && !/\b(coloca|poe|adiciona|bota)\b/.test(f)) {
    const list = table('waitlist').filter((w) => w.status === 'aguardando' || w.status === 'oferecido');
    ctx.lines.push(list.length ? `Na lista de espera (${list.length}):\n` + list.map((w) => `• ${contactById(w.contact_id)?.name ?? 'Paciente'} · ${w.desired_date ? fmtDate(w.desired_date).slice(0, 5) : 'qualquer dia'}${w.status === 'oferecido' ? ' · encaixe oferecido, esperando resposta' : ''}`).join('\n') + '\nQuando alguém cancelar, eu ofereço o horário na ordem da lista.' : 'Ninguém na lista de espera agora. 👌');
    ctx.actions.push({ tool: 'lista_espera', label: 'Consultou a lista de espera', status: 'ok', detail: `${list.length} ${list.length === 1 ? 'cliente' : 'clientes'}`, link: '#/agenda?espera=1' });
    return true;
  }
  // cobrar paciente com Pix/boleto (sensível)
  if (/\bcobr(a|ar|e|ança|anca)\b/.test(f) && parseMoneyIn(clause) && !/\?\s*$/.test(clause) && !/\b(quanto|qual)\b/.test(f)) {
    const amount = parseMoneyIn(clause)!;
    const c = resolveContact(ctx, clause);
    if (!c || c === 'ambiguous') { ctx.lines.push('De quem é a cobrança? Ex.: "cobra R$ 250 da Juliana para sexta".'); return true; }
    const docIn = clause.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/)?.[1]?.replace(/\D/g, '');
    const doc = docIn || c.document;
    if (!doc) { ctx.lines.push(`Para gerar Pix e boleto, o Asaas pede o CPF ou CNPJ de ${c.name}. Me manda junto: "cobra ${brl(amount)} da ${firstName(c.name)}, CPF 000.000.000-00".`); return true; }
    const due = parseDate(f, today) ?? addDays(today, 3);
    const svc = matchService(f);
    const description = svc?.name ?? 'Serviço';
    ctx.pending = createPending(ctx.conv, 'cobrar_cliente', { contact_id: c.id, contact_name: c.name, document: doc, amount, due_date: due, description, method: 'pix_boleto' }, `Cobrar ${brl(amount)} de ${c.name} (Pix ou boleto, vence ${fmtDate(due)})`);
    ctx.actions.push({ tool: 'cobrar_cliente', label: 'Cobrança aguardando confirmação', status: 'aguardando', detail: `${c.name} · ${brl(amount)} · ${fmtDate(due).slice(0, 5)}`, pending_id: ctx.pending.id });
    ctx.lines.push(`Vou gerar uma cobrança de ${brl(amount)} para ${c.name} (${description}), com Pix e boleto e vencimento em ${fmtDate(due)}, e mandar o link no WhatsApp de ${firstName(c.name)}. Confirma? Responda SIM ou NÃO.`);
    return true;
  }
  // emitir nota fiscal de serviço (sensível)
  if (/\b(emit|ger|tir|fa[zc]|solt)\w*\b.*\bnota\b|\bnota fiscal\b.*\b(para|pra|da|do)\b/.test(f)) {
    const c = resolveContact(ctx, clause);
    if (!c || c === 'ambiguous') { ctx.lines.push('A nota é para qual paciente? Ex.: "emite a nota da Juliana".'); return true; }
    const paid = table('charges').find((x) => x.contact_id === c.id && x.status === 'paga' && !table('fiscal_notes').some((n) => n.charge_id === x.id));
    const sale = table('sales').filter((x) => x.contact_id === c.id).sort((x, y) => (x.paid_at < y.paid_at ? 1 : -1))[0];
    const amount = parseMoneyIn(clause) ?? paid?.amount ?? sale?.amount;
    if (!amount) { ctx.lines.push(`Não achei venda de ${c.name}. Qual o valor da nota? Ex.: "emite a nota da ${firstName(c.name)} de R$ 180".`); return true; }
    const description = matchService(f)?.name ?? paid?.description ?? sale?.description ?? 'Prestação de serviço';
    ctx.pending = createPending(ctx.conv, 'emitir_nota', { contact_id: c.id, amount, description, charge_id: paid?.id ?? null, sale_id: paid ? paid.sale_id : sale?.id ?? null }, `Emitir NFS-e de ${brl(amount)} para ${c.name} (${description})`);
    ctx.actions.push({ tool: 'emitir_nota', label: 'Nota fiscal aguardando confirmação', status: 'aguardando', detail: `${c.name} · ${brl(amount)}`, pending_id: ctx.pending.id });
    ctx.lines.push(`Vou emitir a nota fiscal de serviço de ${brl(amount)} para ${c.name}${c.document ? '' : ' (sem CPF cadastrado)'}, descrição "${description}". Nota fiscal pede confirmação: responda SIM ou NÃO.`);
    return true;
  }
  // dar baixa numa conta (sensível)
  if (/\b(paguei|recebi|pago|quitei|baixa)\b.*\b(conta|aluguel|boleto|salario|fornecedor|luz|energia|internet|contrato)\b|\bmarca\b.*\b(paga|recebida)\b/.test(f)) {
    const open = table('finance_entries').filter((e) => !e.paid_at);
    const e = bestMatch(open, (x) => `${x.description} ${x.counterpart ?? ''} ${x.category}`, clause);
    if (!e) { ctx.lines.push('Qual conta? Ex.: "paguei o aluguel" ou "recebi o contrato da clínica".'); return true; }
    const method = parseMethod(f) ?? 'pix';
    ctx.pending = createPending(ctx.conv, 'baixar_conta', { entry_id: e.id, method }, `Marcar como ${e.kind === 'pagar' ? 'paga' : 'recebida'}: ${e.description} (${brl(e.amount)})`);
    ctx.actions.push({ tool: 'baixar_conta', label: 'Baixa aguardando confirmação', status: 'aguardando', detail: `${e.description} · ${brl(e.amount)}`, pending_id: ctx.pending.id });
    ctx.lines.push(`Encontrei ${e.description} de ${brl(e.amount)}, vencimento ${fmtDate(e.due_date)}. Confirma que foi ${e.kind === 'pagar' ? 'paga' : 'recebida'}${method !== 'pix' ? ` no ${METHOD_LABEL[method]}` : ''}? Responda SIM ou NÃO.`);
    return true;
  }
  // lançar conta
  if (/\b(lanc|anot|registr|cadastr|coloc|bot)\w*\b.*\b(conta|despesa|boleto|aluguel|salario|fornecedor|receber|a pagar)\b|\bconta (de|do|da)\b.*\d/.test(f) && parseMoneyIn(clause)) {
    const amount = parseMoneyIn(clause)!;
    const kind: FinanceEntry['kind'] = /\b(receber|recebimento|cliente me deve|entrada de)\b/.test(f) ? 'receber' : 'pagar';
    const day = f.match(/\bdia (\d{1,2})\b/);
    let due = parseDate(f, today) ?? today;
    if (day) { const d = Number(day[1]); const cand = `${today.slice(0, 8)}${String(d).padStart(2, '0')}`; due = cand >= today ? cand : addDays(`${today.slice(0, 8)}01`, 32).slice(0, 8) + String(d).padStart(2, '0'); }
    const desc = clause.replace(/^(.*?\b(lanca|lança|anota|registra|cadastra|coloca|bota)\w*\s+(uma\s+)?)/i, '').replace(/\b(de\s+)?R\$\s*[\d.,]+.*$/i, '').replace(/\b(a pagar|a receber)\b/i, '').replace(/^(conta|despesa)\s+(de|do|da)\s+/i, '').trim() || (kind === 'pagar' ? 'Conta' : 'Recebimento');
    const monthly = /\b(todo mes|mensal|todos os meses|por mes|todo dia \d{1,2})\b/.test(f);
    const now = new Date().toISOString();
    const e: FinanceEntry = { id: newId(), company_id: DEMO_COMPANY_ID, kind, description: desc[0].toUpperCase() + desc.slice(1), category: kind === 'pagar' ? (/aluguel/.test(f) ? 'Aluguel' : /salario/.test(f) ? 'Pessoal' : /luz|energia|agua|internet|telefone/.test(f) ? 'Contas da casa' : /imposto|das\b|simples/.test(f) ? 'Impostos' : /fornecedor|produto|compra/.test(f) ? 'Fornecedores' : 'Outros') : 'Serviços', amount, due_date: due, paid_at: null, method: null, contact_id: null, counterpart: null, recurrence: monthly ? 'mensal' : 'nenhuma', notes: null, created_via: 'ia_dono', created_at: now, updated_at: now };
    table('finance_entries').unshift(e); emit('finance_entries');
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'lancar_conta', summary: `Lançou conta a ${kind}: ${e.description} (${brl(amount)}, vence ${fmtDate(due)})`, target_type: 'finance', target_id: e.id, status: 'ok' });
    ctx.actions.push({ tool: 'lancar_conta', label: `Conta a ${kind} lançada`, status: 'ok', detail: `${e.description} · ${brl(amount)} · ${fmtDate(due).slice(0, 5)}`, link: '#/financeiro' });
    ctx.lines.push(`• Lancei ${e.description} (${brl(amount)}) a ${kind}, vencimento ${fmtDate(due)}${monthly ? ', repetindo todo mês' : ''}`);
    return true;
  }
  // consultar contas
  if (/\b(contas?|boletos?)\b.*\b(pagar|vence|vencid|abert|receber|semana|mes)\w*|\b(o que|quanto)\b.*\b(vence|tenho a pagar|tenho a receber|a pagar|a receber)\b|\bfinanceiro\b/.test(f)) {
    const open = table('finance_entries').filter((e) => !e.paid_at && (/\breceber\b/.test(f) ? e.kind === 'receber' : /\bpagar\b/.test(f) ? e.kind === 'pagar' : true));
    const horizon = /\bsemana\b/.test(f) ? addDays(today, 7) : null;
    const list = open.filter((e) => !horizon || e.due_date <= horizon).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    const late = list.filter((e) => e.due_date < today);
    const sum = (l: FinanceEntry[], k: string) => l.filter((e) => e.kind === k).reduce((t, e) => t + e.amount, 0);
    ctx.lines.push(list.length ? `${horizon ? 'Até o fim da semana' : 'Em aberto'}: ${brl(sum(list, 'pagar'))} a pagar e ${brl(sum(list, 'receber'))} a receber.${late.length ? ` ⚠️ ${late.length} ${late.length === 1 ? 'está vencida' : 'estão vencidas'}.` : ''}\n` + list.slice(0, 7).map((e) => `• ${fmtDate(e.due_date).slice(0, 5)} — ${e.description}: ${e.kind === 'pagar' ? '−' : '+'}${brl(e.amount)}${e.due_date < today ? ' (vencida)' : ''}`).join('\n') : 'Nenhuma conta em aberto nesse período. 👌');
    ctx.actions.push({ tool: 'consultar_contas', label: 'Contas consultadas', status: 'ok', link: '#/financeiro' });
    return true;
  }
  // estoque: consultar
  if (/\b(o que|quais|precis)\w*\b.*\brepor\b|\bestoque\b.*\b(baixo|acabando|repor|como esta|como ta)\b|\bcomo (esta|ta) o estoque\b|\b(quanto|quantos?|quantas?)\b.*\b(tem|temos|tenho|sobrou|resta)\b.*\b(estoque)?\b/.test(f) && !/\b(vend|fatur|orcament|agenda|horario)\w*/.test(f)) {
    const products = table('products').filter((p) => p.active);
    const specific = /\b(quanto|quantos?|quantas?)\b/.test(f) ? bestMatch(products, (p) => `${p.name} ${p.sku ?? ''}`, clause) : null;
    if (specific) { ctx.lines.push(`${specific.name}: ${specific.stock} ${specific.unit} em estoque${specific.min_stock > 0 ? ` (mínimo ${specific.min_stock})` : ''}.${specific.stock <= specific.min_stock && specific.min_stock > 0 ? ' Já está na hora de repor.' : ''}`); }
    else {
      const low = products.filter((p) => p.min_stock > 0 && p.stock <= p.min_stock);
      ctx.lines.push(low.length ? `${low.length} ${low.length === 1 ? 'produto precisa' : 'produtos precisam'} de reposição:\n` + low.map((p) => `• ${p.name}: ${p.stock} ${p.unit} (mínimo ${p.min_stock})`).join('\n') : 'Estoque em dia: nenhum produto abaixo do mínimo. 👌');
    }
    ctx.actions.push({ tool: 'consultar_estoque', label: 'Estoque consultado', status: 'ok', link: '#/estoque' });
    return true;
  }
  // estoque: entrada e saída
  const entrada = /\b(chegou|chegaram|entrada|comprei|repus|recebi)\b/.test(f);
  const saida = /\b(saida|baixa|usei|usamos|gastei|gastamos|vendi|perdi|quebrou|tira|retira)\b/.test(f);
  if ((entrada || saida) && qtyIn(f) != null) {
    const p = bestMatch(table('products').filter((x) => x.active), (x) => `${x.name} ${x.sku ?? ''}`, clause) as Product | null;
    if (!p) { ctx.lines.push('Qual produto? Ex.: "dá baixa de 2 removedores de mancha" ou "chegaram 10 panos de microfibra".'); return true; }
    const qty = qtyIn(f)!;
    try {
      const m = { id: newId(), company_id: DEMO_COMPANY_ID, product_id: p.id, kind: (entrada ? 'entrada' : 'saida') as 'entrada' | 'saida', qty, balance_after: null, unit_cost: null, note: null, created_by: DEMO_USER_ID, created_via: 'ia_dono' as const, created_at: new Date().toISOString() };
      applyMovement(m);
      table('stock_movements').unshift(m); emit('stock_movements'); emit('products');
      audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'movimentar_estoque', summary: `${entrada ? 'Entrada' : 'Saída'} de ${qty} ${p.unit} de ${p.name} (saldo: ${p.stock})`, target_type: 'product', target_id: p.id, status: 'ok' });
      ctx.actions.push({ tool: 'movimentar_estoque', label: `${entrada ? 'Entrada' : 'Saída'} de estoque`, status: 'ok', detail: `${qty} ${p.unit} · ${p.name} · saldo ${p.stock}`, link: '#/estoque' });
      ctx.lines.push(`• ${entrada ? 'Entrada' : 'Saída'} de ${qty} ${p.unit} de ${p.name}. Saldo agora: ${p.stock} ${p.unit}${p.min_stock > 0 && p.stock <= p.min_stock ? ' ⚠️ abaixo do mínimo, vale repor' : ''}`);
    } catch (e) { ctx.lines.push((e as Error).message); }
    return true;
  }
  return false;
}

/* ================= comandos do dono ================= */
interface Ctx { raw: string; f: string; today: string; lastContact: Contact | null; lastQuote: Quote | null; actions: ActionReceipt[]; lines: string[]; pending: PendingAction | null; conv: Conversation }

function resolveContact(ctx: Ctx, clause: string): Contact | null | 'ambiguous' {
  const f = fold(clause);
  if (/\b(ela|ele|dela|dele|esse cliente|essa cliente|a mesma|o mesmo)\b/.test(f) && ctx.lastContact) return ctx.lastContact;
  const n = nameAfterPrep(clause) ?? nameAfterVerb(clause);
  if (!n) return ctx.lastContact;
  const found = findContacts(n);
  if (!found.length) return null;
  ctx.lastContact = found[0];
  return found[0];
}

const HELP = `Posso fazer muita coisa por você, é só pedir do seu jeito. Por exemplo:\n• "Cadastra a Maria, telefone 61 99999-9999, e cria um orçamento de R$ 3.500 do implante para ela"\n• "Marca o João sexta às 14h para limpeza com a Dra. Marina"\n• "Quem ainda não confirmou amanhã?"\n• "O que temos na agenda amanhã?"\n• "Quanto recebemos essa semana?"\n• "Muda o valor da limpeza para R$ 270"\n• "Quais orçamentos estão parados?"\n• "Registra o pagamento de R$ 280 no Pix da Juliana"\n• "Me lembra de enviar as guias do convênio amanhã às 9h"\n• "Lança o aluguel de R$ 4.200 todo dia 5"\n• "O que vence essa semana?"\n• "Dá baixa de 2 caixas de luvas"\n• "O que preciso repor?"\n• "Quem está na lista de espera?"\n• "Cobra R$ 600 do Ricardo para sexta"\n• "Emite a nota do Bruno"\nAções sensíveis (pagamentos, cobranças, notas fiscais, baixa de contas, desmarcações, valores, descontos altos) sempre pedem sua confirmação.`;

function handleClause(ctx: Ctx, clause: string) {
  const f = fold(clause);
  const company = demoDb().company, ai = demoDb().ai;

  // ajuda
  if (/\b(ajuda|o que (voce|vc) (faz|sabe|consegue)|comandos|como (te|funciona))\b/.test(f)) { ctx.lines.push(HELP); return; }

  // financeiro e estoque
  if (handleGestao(ctx, clause, f)) return;

  // registrar venda (sensível)
  if (/\b(registr|lanc|anot|bot)\w*\b.*\bvenda\b|\bvend(i|emos)\b.*\d/.test(f)) {
    const amount = parseMoneyIn(clause);
    if (!amount) { ctx.lines.push('Qual o valor da venda? Ex.: "registra uma venda de R$ 180 no Pix para a Juliana".'); return; }
    const method = parseMethod(f) ?? 'pix';
    const c = resolveContact(ctx, clause);
    const contact = c && c !== 'ambiguous' ? c : null;
    const svc = matchService(f);
    const summary = `Registrar venda de ${brl(amount)} no ${METHOD_LABEL[method]}${contact ? ` para ${contact.name}` : ''}${svc ? ` · ${svc.name}` : ''}`;
    ctx.pending = createPending(ctx.conv, 'registrar_venda', { amount, method, contact_id: contact?.id ?? null, contact_name: contact?.name ?? null, description: svc?.name ?? 'Venda registrada pelo assistente' }, summary);
    ctx.actions.push({ tool: 'registrar_venda', label: 'Venda aguardando confirmação', status: 'aguardando', detail: `${brl(amount)} · ${METHOD_LABEL[method]}${contact ? ` · ${contact.name}` : ''}`, pending_id: ctx.pending.id });
    ctx.lines.push(`Vou registrar uma venda de ${brl(amount)} no ${METHOD_LABEL[method]}${contact ? ` para ${contact.name}` : ''}. Como é uma movimentação financeira, preciso da sua confirmação: responda SIM para confirmar ou NÃO para cancelar.`);
    return;
  }

  // resumo de vendas
  if (/\b(quanto|qual)\b.*\b(vend|fatur|receb|entrou)|\b(vendas?|recebimentos?|pagamentos?)\b.*\b(hoje|ontem|semana|mes|ano)\b|\bfaturamento\b/.test(f)) {
    ctx.lines.push(salesSummary(f).text);
    ctx.actions.push({ tool: 'resumo_vendas', label: 'Recebimentos consultados', status: 'ok' });
    return;
  }

  // conversas aguardando
  if (/\b(conversas?|clientes?|quem)\b.*\b(esperando|aguardando|pendentes?|sem resposta|precisa)\b/.test(f)) {
    const list = table('conversations').filter((c) => c.kind === 'cliente' && (c.needs_attention || c.handler === 'humano') && c.status === 'aberta');
    ctx.lines.push(list.length ? `${list.length} ${list.length === 1 ? 'conversa precisa' : 'conversas precisam'} de você:\n` + list.map((c) => `• ${contactById(c.contact_id)?.name ?? 'Paciente'} — ${c.attention_reason ?? 'atendimento com a equipe'}`).join('\n') : 'Nenhuma conversa esperando por você agora. A IA está dando conta! 🙌');
    ctx.actions.push({ tool: 'conversas_pendentes', label: 'Conversas pendentes consultadas', status: 'ok' });
    return;
  }

  // orçamentos parados
  if (/\borcamentos?\b.*\b(parad|pendent|abert|sem resposta|enviad|esperando)\w*/.test(f) || /\bquais\b.*\borcamentos\b/.test(f)) {
    const cutoff = Date.now() - 2 * 86400000;
    const list = table('quotes').filter((q) => q.status === 'enviado' && Date.parse(q.sent_at ?? q.created_at) < cutoff).slice(0, 6);
    const total = list.reduce((s, q) => s + q.total, 0);
    ctx.lines.push(list.length ? `Encontrei ${list.length} orçamentos enviados há mais de 2 dias sem resposta (${brl(total)} no total):\n` + list.map((q) => `• nº ${qn(q.number)} — ${contactById(q.contact_id)?.name ?? 'Paciente'} · ${brl(q.total)} · enviado ${fmtDate(q.sent_at ?? q.created_at)}`).join('\n') + '\nQuer que eu mande uma mensagem de acompanhamento para eles?' : 'Nenhum orçamento parado. Todos foram respondidos ou ainda estão no prazo. 👌');
    ctx.actions.push({ tool: 'listar_orcamentos', label: 'Orçamentos parados consultados', status: 'ok' });
    return;
  }

  // status de orçamento
  if (/\borcamento\b.*\b(aprovad|recusad|cancelad|fechad)\w*|\b(aprova|recusa)\w*\b.*\borcamento\b/.test(f)) {
    const status: Quote['status'] = /recus|cancel|perd/.test(f) ? 'recusado' : 'aprovado';
    const c = resolveContact(ctx, clause);
    const num = f.match(/\b(?:n|no|numero|nº)?\s*0*(\d{2,6})\b/);
    let q = num ? table('quotes').find((x) => x.number === +num[1]) : undefined;
    if (!q && c && c !== 'ambiguous') q = table('quotes').filter((x) => x.contact_id === c.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    if (!q) { ctx.lines.push('Não encontrei esse orçamento. Me diga o número ou o nome do paciente.'); return; }
    q.status = status; q.responded_at = new Date().toISOString(); q.updated_at = q.responded_at;
    const ct = contactById(q.contact_id); if (ct) ct.stage = status === 'aprovado' ? 'fechado' : 'perdido';
    emit('quotes'); emit('contacts');
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'atualizar_orcamento', summary: `Marcou o orçamento nº ${qn(q.number)} (${ct?.name ?? ''}) como ${status}`, target_type: 'quote', target_id: q.id, status: 'ok' });
    ctx.actions.push({ tool: 'atualizar_orcamento', label: `Orçamento nº ${qn(q.number)} ${status}`, status: 'ok', detail: `${ct?.name ?? ''} · ${brl(q.total)}` });
    ctx.lines.push(`Combinado! ✅ O orçamento nº ${qn(q.number)} de ${ct?.name ?? 'paciente'} (${brl(q.total)}) agora está ${status}.${status === 'aprovado' ? ' Quer que eu já agende o serviço?' : ''}`);
    return;
  }

  // enviar orçamento
  if (/\b(manda|envia|mande|envie)\w*\b.*\borcamento\b|\b(manda|envia)\s+(sim|ele|pra ela|pra ele)\b|^manda sim$/.test(f)) {
    const q = ctx.lastQuote ?? table('quotes').filter((x) => x.created_via === 'ia_dono' && x.status === 'rascunho').sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    if (!q) { ctx.lines.push('Qual orçamento você quer enviar? Me diga o número ou o nome do paciente.'); return; }
    q.status = 'enviado'; q.sent_at = new Date().toISOString(); emit('quotes');
    const ct = contactById(q.contact_id);
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'enviar_orcamento', summary: `Enviou o orçamento nº ${qn(q.number)} para ${ct?.name ?? 'paciente'}`, target_type: 'quote', target_id: q.id, status: 'ok' });
    ctx.actions.push({ tool: 'enviar_orcamento', label: 'Orçamento enviado no WhatsApp', status: 'ok', detail: `nº ${qn(q.number)} · ${ct?.name ?? ''}` });
    ctx.lines.push(`Enviado! 📨 ${ct ? firstName(ct.name) : 'O paciente'} recebeu o link do orçamento nº ${qn(q.number)}. Te aviso quando responder.`);
    return;
  }

  // criar orçamento
  if (/\borcamento\b/.test(f) && /\b(cri|fa[zc]|mont|ger|abr|prepar|lanc)\w*\b|\borcamento de\b/.test(f)) {
    let c = resolveContact(ctx, clause);
    if (c === 'ambiguous') c = null;
    if (!c) {
      const n = nameAfterPrep(clause);
      if (n) { const res = createContact(n, parsePhone(clause), 'ia_dono'); c = res.contact; ctx.actions.push({ tool: 'cadastrar_cliente', label: `Paciente ${firstName(n)} cadastrado`, status: 'ok' }); }
    }
    if (!c) { ctx.lines.push('Para quem é o orçamento? Ex.: "cria um orçamento de R$ 350 para a Maria".'); return; }
    const svc = matchService(f);
    let amount = parseMoneyIn(clause);
    const qty = Number(f.match(/\b(\d{1,3})\s*(?:m2|m²|metros|cadeiras|unidades|lugares)\b/)?.[1] ?? 1);
    if (!amount && svc && svc.price_type !== 'sob_consulta') amount = svc.price * (svc.name.includes('tapete') || svc.name.includes('cadeira') ? qty : 1);
    if (!amount) { ctx.lines.push(`Qual o valor do orçamento para ${firstName(c.name)}?`); return; }
    const pctMatch = f.match(/(\d{1,2})\s*%\s*de desconto|desconto de (\d{1,2})\s*%/);
    const pct = pctMatch ? +(pctMatch[1] ?? pctMatch[2]) : 0;
    const items = [{ description: svc ? svc.name : 'Tratamento combinado com o paciente', qty: 1, unit_price: amount, service_id: svc?.id ?? null }];
    const discount = Math.round(amount * pct) / 100;
    if (pct > ai.max_discount_pct) {
      ctx.pending = createPending(ctx.conv, 'criar_orcamento', { contact_id: c.id, items, discount }, `Orçamento de ${brl(amount - discount)} para ${c.name} com ${pct}% de desconto`);
      ctx.actions.push({ tool: 'criar_orcamento', label: 'Desconto acima do limite: aguardando confirmação', status: 'aguardando', detail: `${pct}% (limite ${ai.max_discount_pct}%)`, pending_id: ctx.pending.id });
      ctx.lines.push(`O desconto de ${pct}% passa do limite de ${ai.max_discount_pct}% configurado. Confirma o orçamento de ${brl(amount - discount)} para ${c.name}? Responda SIM ou NÃO.`);
      return;
    }
    const q = createQuote(c, items, 'ia_dono', discount);
    ctx.lastQuote = q; ctx.lastContact = c;
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'criar_orcamento', summary: `Criou o orçamento nº ${qn(q.number)} de ${brl(q.total)} para ${c.name}`, target_type: 'quote', target_id: q.id, status: 'ok' });
    ctx.actions.push({ tool: 'criar_orcamento', label: `Orçamento de ${brl(q.total)} criado`, status: 'ok', detail: `nº ${qn(q.number)} · ${c.name}`, link: `#/orcamentos/${q.id}` });
    ctx.lines.push(`• Criei o orçamento nº ${qn(q.number)} de ${brl(q.total)} para ${firstName(c.name)}${svc ? ` (${svc.name})` : ''} e deixei pronto para enviar`);
    return;
  }

  // quem ainda não confirmou a consulta
  if (/\b(nao|ainda nao|falta|faltam)\b.*\bconfirm\w*|\bsem confirm\w*/.test(f)) {
    const d = parseDate(f, ctx.today) ?? addDays(ctx.today, 1);
    const list = table('appointments').filter((a) => localDate(a.starts_at, TZ) === d && (a.status === 'confirmado' || a.status === 'pendente') && !a.patient_confirmed_at).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    ctx.lines.push(list.length ? `${list.length} ${list.length === 1 ? 'paciente ainda não confirmou' : 'pacientes ainda não confirmaram'} ${d === addDays(ctx.today, 1) ? 'amanhã' : `em ${fmtDate(d)}`}:\n` + list.map((a) => `• ${localTime(a.starts_at, TZ)} ${contactById(a.contact_id)?.name ?? 'Paciente'} — ${a.title}${proName(a.professional_id) ? ` (${proName(a.professional_id)!.split(' ').slice(0, 2).join(' ')})` : ''}`).join('\n') + '\nO lembrete com pedido de confirmação sai 24 horas antes. Quem não puder vir já remarca pelo WhatsApp.' : `Todos os pacientes ${d === addDays(ctx.today, 1) ? 'de amanhã' : `de ${fmtDate(d)}`} já confirmaram. ✅`);
    ctx.actions.push({ tool: 'consultar_agenda', label: 'Confirmações consultadas', status: 'ok', detail: `${list.length} sem confirmar`, link: '#/agenda' });
    return;
  }

  // agenda (consulta)
  if (/\b(agenda|horarios?|compromissos?|servicos?)\b.*\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}\/\d{1,2})\b|\bo que (eu )?(tenho|temos)\b/.test(f) && !/\b(agend|marc|reserv)\w*\s+(?:a|o)\s/.test(f)) {
    const d = parseDate(f, ctx.today) ?? ctx.today;
    ctx.lines.push(agendaOf(d));
    ctx.actions.push({ tool: 'consultar_agenda', label: 'Agenda consultada', status: 'ok', detail: fmtDate(d) });
    return;
  }

  // cancelar agendamento (sensível)
  if (/\b(cancel|desmarc)\w*\b/.test(f) && /\b(agendamento|horario|consulta|limpeza|atendimento|sessao)\b/.test(f)) {
    const c = resolveContact(ctx, clause);
    if (!c || c === 'ambiguous') { ctx.lines.push('De qual paciente é a consulta que você quer desmarcar?'); return; }
    const ap = nextAppointmentOf(c);
    if (!ap) { ctx.lines.push(`${firstName(c.name)} não tem horário marcado.`); return; }
    const when = `${fmtLong(ap.starts_at)} às ${localTime(ap.starts_at, TZ)}`;
    ctx.pending = createPending(ctx.conv, 'cancelar_agendamento', { appointment_id: ap.id, contact_name: c.name }, `Cancelar o horário de ${c.name} (${when})`);
    ctx.actions.push({ tool: 'cancelar_agendamento', label: 'Cancelamento aguardando confirmação', status: 'aguardando', detail: `${c.name} · ${when}`, pending_id: ctx.pending.id });
    ctx.lines.push(`Encontrei o horário de ${c.name}: ${when} (${ap.title}). Cancelamentos pedem confirmação: responda SIM para cancelar ou NÃO para manter.`);
    return;
  }

  // remarcar
  if (/\b(remarc|transfer|adi[ae])\w*\b/.test(f)) {
    const c = resolveContact(ctx, clause);
    if (!c || c === 'ambiguous') { ctx.lines.push('De qual paciente é a consulta que você quer remarcar?'); return; }
    const ap = nextAppointmentOf(c);
    const d = parseDate(f, ctx.today), t = parseTime(f);
    if (!ap) { ctx.lines.push(`${firstName(c.name)} não tem horário marcado para remarcar.`); return; }
    if (!d || !t) { ctx.lines.push(`Para quando você quer remarcar o horário de ${firstName(c.name)}? Ex.: "segunda às 10h".`); return; }
    const start = fromLocal(d, t, TZ).toISOString();
    const dur = (Date.parse(ap.ends_at) - Date.parse(ap.starts_at)) / 60000;
    const others = table('appointments').filter((x) => x.id !== ap.id);
    let ok = isFree(start, dur, company, others, new Date(), po(ap.service_id, ap.professional_id));
    if (!ok.ok) ok = isFree(start, dur, company, others, new Date(), po(ap.service_id));
    if (!ok.ok) { const alt = slotsForDate(d, company, others, dur, new Date(), po(ap.service_id)).slice(0, 4).map((s) => s.time); ctx.lines.push(`${ok.reason} ${alt.length ? `Livres nesse dia: ${alt.join(', ')}.` : 'Não há horários livres nesse dia.'}`); return; }
    if (ok.professionalId) ap.professional_id = ok.professionalId;
    ap.patient_confirmed_at = null;
    ap.starts_at = start; ap.ends_at = new Date(Date.parse(start) + dur * 60000).toISOString(); ap.updated_at = new Date().toISOString(); emit('appointments');
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'remarcar', summary: `Remarcou o horário de ${c.name} para ${fmtDate(d)} às ${t}`, target_type: 'appointment', target_id: ap.id, status: 'ok' });
    ctx.actions.push({ tool: 'remarcar', label: 'Agendamento remarcado', status: 'ok', detail: `${c.name} · ${fmtDate(d)} às ${t}` });
    ctx.lines.push(`Combinado! ✅ Remarquei ${firstName(c.name)} para ${fmtLong(d)} às ${t}.`);
    return;
  }

  // agendar
  if (/\b(agend|marc|reserv)\w*\b/.test(f)) {
    let c = resolveContact(ctx, clause);
    if (c === 'ambiguous') c = null;
    if (!c) { const n = nameAfterVerb(clause); if (n) { const found = findContacts(n); c = found[0] ?? createContact(n, parsePhone(clause), 'ia_dono').contact; } }
    if (!c) { ctx.lines.push('Para qual paciente é a consulta?'); return; }
    const d = parseDate(f, ctx.today), t = parseTime(f);
    if (!d || !t) { ctx.lines.push(`Qual dia e horário para ${firstName(c.name)}? Ex.: "sexta às 14h".`); return; }
    const svc = matchService(f);
    const wantPro = matchPro(f);
    const start = fromLocal(d, t, TZ).toISOString();
    const ok = isFree(start, svc?.duration_min ?? company.slot_minutes, company, table('appointments'), new Date(), po(svc?.id, wantPro));
    if (!ok.ok) { const alt = slotsForDate(d, company, table('appointments'), svc?.duration_min ?? 30, new Date(), po(svc?.id, wantPro)).slice(0, 5).map((s) => s.time); ctx.lines.push(`${ok.reason} ${alt.length ? `Livres em ${fmtDate(d)}: ${alt.join(', ')}.` : 'Esse dia está sem horários livres.'}`); return; }
    const ap = createAppointment(c, start, svc, 'ia_dono', { professional_id: ok.professionalId ?? wantPro });
    ctx.lastContact = c;
    const who = proName(ap.professional_id);
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'agendar', summary: `Marcou ${c.name} para ${fmtDate(d)} às ${t}${svc ? ` (${svc.name}${who ? ` com ${who}` : ''})` : ''}`, target_type: 'appointment', target_id: ap.id, status: 'ok' });
    ctx.actions.push({ tool: 'agendar', label: 'Consulta marcada', status: 'ok', detail: `${c.name} · ${WEEKDAYS[weekdayOf(d)]} ${fmtDate(d)} às ${t}${who ? ` · ${who}` : ''}`, link: '#/agenda' });
    ctx.lines.push(`• Marquei ${firstName(c.name)} para ${fmtLong(d)} às ${t}${svc ? ` — ${svc.name}` : ''}${who ? ` com ${who}` : ''}${ap.payment_kind === 'convenio' ? ` (${ap.insurance})` : ''}`);
    return;
  }

  // tarefa / lembrete
  if (/\b(me lembr|lembrete|lembra de|anota|tarefa|nao me deixa esquecer)\w*/.test(f)) {
    const title = clause.replace(/^.*?(me lembr\w*\s+(de\s+)?|lembrete\s+(de\s+|para\s+)?|anota\w*\s+(que\s+|a tarefa\s+)?|tarefa\s+(de\s+|para\s+)?|lembra de\s+)/i, '').replace(/\s+(hoje|amanh[ãa]|depois de amanh[ãa]|(na |no )?(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?|[àa]s\s+\d{1,2}(h|:\d{2})?\d*|dia \d{1,2})\b.*$/i, '').replace(/[.!]+$/, '').trim();
    const d = parseDate(f, ctx.today) ?? ctx.today; const t = parseTime(f) ?? '09:00';
    const due = fromLocal(d, t, TZ).toISOString();
    const task = { id: newId(), company_id: DEMO_COMPANY_ID, title: title ? title[0].toUpperCase() + title.slice(1) : 'Lembrete', due_at: due, done_at: null, contact_id: null, reminded_at: null, created_via: 'ia_dono' as const, created_at: new Date().toISOString() };
    table('tasks').unshift(task); emit('tasks');
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'criar_tarefa', summary: `Criou o lembrete "${task.title}" para ${fmtDate(d)} às ${t}`, target_type: 'task', target_id: task.id, status: 'ok' });
    ctx.actions.push({ tool: 'criar_tarefa', label: 'Lembrete criado', status: 'ok', detail: `${fmtDate(d)} às ${t}` });
    ctx.lines.push(`Combinado! ⏰ Vou te lembrar de "${task.title}" ${d === ctx.today ? 'hoje' : d === addDays(ctx.today, 1) ? 'amanhã' : `em ${fmtDate(d)}`} às ${t}, aqui no WhatsApp.`);
    return;
  }

  // relatório geral
  if (/\b(relatorio|resumo|como (foi|esta|estao|anda)|desempenho|numeros)\b/.test(f)) {
    const r = periodRange(f, ctx.today);
    const inRange = (iso: string) => { const d = localDate(iso, TZ); return d >= r.from && d <= r.to; };
    const qs = table('quotes').filter((q) => inRange(q.created_at));
    const ss = table('sales').filter((s) => inRange(s.paid_at));
    const aps = table('appointments').filter((a) => inRange(a.starts_at) && a.status !== 'cancelado');
    const ms = demoDb().msgStats;
    let conv = 0, ia = 0, team = 0;
    for (const [d, v] of Object.entries(ms)) if (d >= r.from && d <= r.to) { conv += v.conversations; ia += v.msgs_ai; team += v.msgs_team; }
    ctx.lines.push(`Resumo ${r.label}:\n• ${conv} conversas no WhatsApp (${Math.round((ia / Math.max(1, ia + team)) * 100)}% respondidas pela IA)\n• ${qs.length} orçamentos criados, ${qs.filter((q) => q.status === 'aprovado').length} aprovados\n• ${aps.length} horários na agenda\n• ${brl(ss.reduce((s, x) => s + x.amount, 0))} em vendas (${ss.length})`);
    ctx.actions.push({ tool: 'relatorio', label: 'Relatório gerado', status: 'ok' });
    return;
  }

  // pausar / retomar IA numa conversa
  if (/\b(pausa|para|desliga|assum)\w*\b.*\b(ia|robo|assistente|atendimento)\b|\b(volta|retoma|liga)\w*\b.*\b(ia|robo|assistente)\b/.test(f)) {
    const c = resolveContact(ctx, clause);
    if (!c || c === 'ambiguous') { ctx.lines.push('Em qual conversa? Me diga o nome do paciente.'); return; }
    const conv = table('conversations').find((x) => x.contact_id === c.id && x.kind === 'cliente');
    if (!conv) { ctx.lines.push(`Não encontrei conversa com ${c.name}.`); return; }
    const back = /\b(volta|retoma|liga)\w*\b/.test(f);
    conv.handler = back ? 'ia' : 'humano'; conv.needs_attention = !back && conv.needs_attention; emit('conversations');
    ctx.actions.push({ tool: 'pausar_ia', label: back ? 'IA voltou a atender' : 'IA pausada nesta conversa', status: 'ok', detail: c.name });
    ctx.lines.push(back ? `Combinado! A IA voltou a atender ${firstName(c.name)}.` : `Combinado! Pausei a IA na conversa com ${firstName(c.name)}. Agora é com você.`);
    return;
  }

  // alterar preço (sensível)
  if (PRICE_CHANGE.test(f)) {
    const svc = matchService(f);
    const price = parseMoneyIn(clause) ?? (() => { const m = f.match(/\b(?:para|pra|por|custar|custando|custa|sai|fica|e)\s+(?:a\s+|de\s+)?(\d{2,6}(?:[.,]\d{1,2})?)\b/); return m ? parseMoney(m[1]) : null; })();
    if (!svc || !price) { ctx.lines.push(svc ? `Qual o novo valor de "${svc.name}"? Hoje está ${brl(svc.price)}. Ex.: "muda o valor da ${svc.name.split(' (')[0].toLowerCase()} para R$ 270".` : 'Qual procedimento e qual o novo valor? Ex.: "muda o valor da limpeza para R$ 270".'); return; }
    if (price === svc.price) { ctx.lines.push(`"${svc.name}" já está ${brl(price)}. Nada para mudar. 👍`); return; }
    ctx.pending = createPending(ctx.conv, 'atualizar_servico', { service_id: svc.id, price }, `Mudar o preço de "${svc.name}" de ${brl(svc.price)} para ${brl(price)}`);
    ctx.actions.push({ tool: 'atualizar_servico', label: 'Mudança de preço aguardando confirmação', status: 'aguardando', detail: `${svc.name}: ${brl(svc.price)} → ${brl(price)}`, pending_id: ctx.pending.id });
    ctx.lines.push(`Vou mudar o valor de "${svc.name}" de ${brl(svc.price)} para ${brl(price)}. A IA passa a usar o novo valor com os pacientes na hora. Confirma? Responda SIM ou NÃO.`);
    return;
  }

  // cadastrar paciente
  if (/\b(cadastr|adicion|inclu|salv|registr|anot)\w*\b/.test(f)) {
    const name = nameAfterVerb(clause);
    if (!name) { ctx.lines.push('Qual o nome do paciente? Ex.: "cadastra a Maria, telefone 61 99999-9999".'); return; }
    const phone = parsePhone(clause);
    const email = clause.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
    const { contact, existed } = createContact(name, phone, 'ia_dono', email ? { email } : {});
    ctx.lastContact = contact;
    if (existed) { ctx.lines.push(`• ${contact.name} já estava cadastrada com esse telefone, então usei o cadastro existente`); return; }
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'cadastrar_cliente', summary: `Cadastrou ${contact.name}${phone ? ` — ${formatPhone(phone)}` : ''}`, target_type: 'contact', target_id: contact.id, status: 'ok' });
    ctx.actions.push({ tool: 'cadastrar_cliente', label: `Paciente ${firstName(contact.name)} cadastrad${/a$/i.test(firstName(contact.name)) ? 'a' : 'o'}`, status: 'ok', detail: phone ? formatPhone(phone) : undefined, link: '#/clientes' });
    ctx.lines.push(`• Cadastrei ${contact.name}${phone ? ` — ${formatPhone(phone)}` : ''}`);
    return;
  }

  ctx.lines.push(`Ainda não entendi esse pedido. 🤔 No modo demonstração eu reconheço os comandos mais comuns. ${HELP.split('\n').slice(1, 5).join(' ')}`);
}

export async function runOwnerCommand(text: string): Promise<AgentReply> {
  const conv = ownerConversation();
  pushMessage(conv, { direction: 'in', sender: 'dono', sender_name: 'Você', body: text, media: null, wa_status: null, actions: null, response_seconds: null, channel: 'painel' });
  conv.unread = 0;
  await pause(700 + Math.random() * 500);
  const f = fold(text).replace(/[!?.]+$/, '');
  const today = localDate(new Date(), TZ);

  // confirmação de ação pendente por texto
  const open = table('pending_actions').filter((p) => p.conversation_id === conv.id && p.status === 'pendente' && Date.parse(p.expires_at) > Date.now()).pop();
  if (open && /^(sim|s|confirmo|confirma|confirmar|pode|pode sim|ok|isso|claro|manda ver|fechado)\b/.test(f)) return finishPending(conv, open, true);
  if (open && /^(nao|n|cancela|cancelar|negativo|deixa|esquece)\b/.test(f)) return finishPending(conv, open, false);

  const ctx: Ctx = { raw: text, f, today, lastContact: null, lastQuote: null, actions: [], lines: [], pending: null, conv };
  const clauses = text.split(/\s*(?:,\s*e\s+|\s+e\s+(?=(?:cri|crie|cria|faz|faça|agend|marc|registr|mand|envi|cadastr|me lembr|lembr)\w*)|;\s*|\.\s+(?=[A-ZÀ-Ý]))/i).filter((s) => s.trim().length > 1);
  for (const cl of clauses.length ? clauses : [text]) handleClause(ctx, cl);

  const did = ctx.actions.filter((a) => a.status === 'ok' && !['resumo_vendas', 'consultar_agenda', 'listar_orcamentos', 'conversas_pendentes', 'relatorio'].includes(a.tool));
  if (did.length && ctx.actions.some((a) => a.tool === 'cadastrar_cliente' || a.tool === 'criar_orcamento')) ctx.actions.push({ tool: 'painel', label: 'Painel comercial atualizado', status: 'ok' });
  let reply = ctx.lines.join('\n');
  const bullets = ctx.lines.filter((l) => l.startsWith('• '));
  if (bullets.length && bullets.length === ctx.lines.length) {
    reply = `Combinado! ✅ Fiz assim:\n${bullets.join('\n')}${ctx.lastQuote && ctx.lastQuote.status === 'rascunho' ? `\nQuer que eu mande o link do orçamento para ${firstName(contactById(ctx.lastQuote.contact_id)?.name ?? 'o paciente')} no WhatsApp?` : ''}`;
  }
  const msg = pushMessage(conv, { direction: 'out', sender: 'ia', sender_name: AI_NAME(), body: reply, media: null, wa_status: null, actions: ctx.actions.length ? ctx.actions : null, response_seconds: 1, channel: 'painel' });
  conv.unread = 0;
  return { conversation_id: conv.id, reply: msg.body, actions: ctx.actions, pending: ctx.pending };
}

function finishPending(conv: Conversation, p: PendingAction, approve: boolean): AgentReply {
  p.status = approve ? 'confirmada' : 'cancelada'; p.resolved_at = new Date().toISOString();
  emit('pending_actions');
  let actions: ActionReceipt[]; let reply: string;
  if (approve) {
    const r = executePending(p);
    actions = [r];
    reply = r.status === 'ok' ? `Combinado! ✅ ${r.label}${r.detail ? ` — ${r.detail}` : ''}.` : `Não consegui concluir: ${r.label}.`;
  } else {
    audit({ actor_type: 'usuario', actor_name: 'Você', channel: 'ia_dono', action: p.tool, summary: `Cancelou: ${p.summary}`, target_type: null, target_id: null, status: 'cancelado' });
    actions = [{ tool: p.tool, label: 'Ação cancelada', status: 'cancelada', detail: p.summary }];
    reply = 'Tudo certo, cancelei. Nada foi alterado. 👍';
  }
  // atualiza o recibo "aguardando" da mensagem original
  for (const m of table('messages')) if (m.actions?.some((a) => a.pending_id === p.id)) m.actions = m.actions.map((a) => (a.pending_id === p.id ? { ...a, status: approve ? 'ok' : 'cancelada', label: approve ? 'Confirmado' : 'Cancelado' } : a));
  const msg = pushMessage(conv, { direction: 'out', sender: 'ia', sender_name: AI_NAME(), body: reply, media: null, wa_status: null, actions, response_seconds: 1, channel: 'painel' });
  conv.unread = 0;
  return { conversation_id: conv.id, reply: msg.body, actions, pending: null };
}

export async function resolvePendingDemo(id: string, approve: boolean): Promise<AgentReply> {
  const p = table('pending_actions').find((x) => x.id === id);
  const conv = ownerConversation();
  if (!p || p.status !== 'pendente') return { conversation_id: conv.id, reply: 'Essa ação já foi resolvida.', actions: [] };
  pushMessage(conv, { direction: 'in', sender: 'dono', sender_name: 'Você', body: approve ? 'SIM' : 'NÃO', media: null, wa_status: null, actions: null, response_seconds: null, channel: 'painel' });
  await pause(450);
  return finishPending(conv, p, approve);
}

/* ================= simulador de paciente (a IA atendendo) ================= */
interface SimState { convId: string | null; contactId: string | null; service: string | null; date: string | null; time: string | null; askedData: boolean; booked: boolean; pro: string | null }
let sim: SimState = { convId: null, contactId: null, service: null, date: null, time: null, askedData: false, booked: false, pro: null };

function simConversation(name: string): Conversation {
  const convs = table('conversations');
  let c = sim.convId ? convs.find((x) => x.id === sim.convId) : undefined;
  if (!c) {
    const { contact } = createContact(name, null, 'ia_cliente', { source: 'whatsapp', stage: 'conversando', tags: ['teste'] });
    sim.contactId = contact.id;
    c = { id: newId(), company_id: DEMO_COMPANY_ID, contact_id: contact.id, member_user_id: null, kind: 'cliente', channel: 'simulador', handler: 'ia', status: 'aberta', needs_attention: false, attention_reason: null, unread: 0, last_message_at: null, last_message_preview: null, last_inbound_at: null, created_at: new Date().toISOString() };
    convs.unshift(c);
    sim.convId = c.id;
  }
  return c;
}

/** Pergunta do paciente (não é nome nem endereço). */
const isQuestion = (text: string, f: string) => text.includes('?') || /^(qual|quais|quanto|quantos|como|onde|quando|porque|por que|voces|vcs|voce|aceita|aceitam|tem|da pra|e possivel|pode|posso|faz|fazem|precisa|preciso|serve|demora|funciona)\b/.test(f);
const FAQ_STOP = new Set(['qual', 'quais', 'como', 'voces', 'voce', 'para', 'pra', 'esse', 'essa', 'isso', 'tenho', 'quero', 'sobre', 'mais', 'muito', 'fazer', 'fazem', 'pode', 'posso', 'preciso', 'precisa', 'algum', 'alguma', 'quanto', 'tempo', 'serve', 'onde', 'quando', 'tambem', 'aqui']);
const sig = (t: string) => fold(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !FAQ_STOP.has(w));
/** Resposta da base de conhecimento cadastrada pelo dono, quando a pergunta bate com uma delas. */
export function faqAnswer(f: string): string | null {
  const q = sig(f);
  if (!q.length) return null;
  let best: { a: string } | null = null, score = 0;
  for (const item of demoDb().ai.faq ?? []) {
    const w = [...sig(item.q), ...sig(item.a).slice(0, 12)];
    const hits = q.filter((x) => w.some((y) => y.slice(0, 5) === x.slice(0, 5))).length;
    const sc = hits / Math.min(q.length, Math.max(1, sig(item.q).length));
    if (hits && sc > score) { score = sc; best = item; }
  }
  return best && score >= 0.5 ? best.a : null;
}

function priceLine(s: Service): string {
  if (s.price_type === 'sob_consulta') return `${s.name}: o valor depende da avaliação, que é gratuita`;
  return `${s.name} ${s.price_type === 'a_partir_de' ? 'começa em' : s.price === 0 ? 'é' : 'sai por'} ${s.price === 0 ? 'gratuita' : brl(s.price)}`;
}

/** Sinais de urgência ou de assunto clínico: a secretária não orienta, encaminha. */
const URGENT = /\b(falta de ar|desmai|convuls|dor no peito|sangr\w* (muito|forte|sem parar)|nao para de sangrar|inchad\w* .*(olho|pescoco|garganta)|febre alta|nao consigo (respirar|engolir)|me machucar|suicid|me matar)\b/;
const CLINICAL = /\b(dor|doendo|doi|inchad\w*|inflamad\w*|sangr\w*|febre|pus|remedio|antibiotico|dipirona|ibuprofeno|tomar algum|e normal|resultado do exame|raio.?x|sintoma)\b/;

export async function runSimulator(text: string, opts: { reset?: boolean; name?: string }): Promise<AgentReply> {
  if (opts.reset) sim = { convId: null, contactId: null, service: null, date: null, time: null, askedData: false, booked: false, pro: null };
  const conv = simConversation(opts.name || 'Paciente de teste');
  const contact = contactById(sim.contactId)!;
  pushMessage(conv, { direction: 'in', sender: 'contato', sender_name: contact.name, body: text, media: null, wa_status: null, actions: null, response_seconds: null, channel: 'simulador' });
  const t0 = Date.now();
  await pause(900 + Math.random() * 700);
  const f = fold(text);
  const d = demoDb(); const company = d.company; const ai = d.ai; const emo = ai.use_emojis;
  const today = localDate(new Date(), TZ);
  const actions: ActionReceipt[] = [];
  let reply = '';
  let handoff = '';

  const svcFound = matchService(f);
  if (svcFound) sim.service = svcFound.id;
  const proFound = matchPro(f);
  if (proFound) sim.pro = proFound;
  const date = parseDate(f, today); const time = parseTime(f);
  if (date) sim.date = date;
  if (time) sim.time = time;
  const service = table('services').find((s) => s.id === sim.service) ?? null;
  const opts2 = po(service?.id, sim.pro);
  const insList = company.insurances ?? [];
  const askedIns = insList.find((x) => f.includes(fold(x).split(' ')[0]));

  if (conv.handler === 'humano') {
    reply = '';
  } else if (URGENT.test(f)) {
    handoff = 'Possível urgência: orientado a procurar o pronto-socorro';
    reply = `Isso pode ser uma urgência${emo ? ' ⚠️' : ''}. Por favor, ligue agora para o SAMU (192) ou vá ao pronto-socorro mais próximo. Já avisei a equipe da clínica, que também vai falar com você.`;
  } else if (CLINICAL.test(f) && !/\b(quanto|valor|preco|horario|marcar|agendar)\b/.test(f)) {
    handoff = 'Dúvida clínica: precisa de avaliação do profissional';
    const urg = table('services').find((s) => s.name.startsWith('Urgência'));
    reply = `Sinto muito${emo ? ' 😔' : ''}. Não consigo avaliar sintomas por aqui: quem pode te orientar é o profissional. Já avisei a equipe, e se quiser eu vejo um horário de ${urg ? 'urgência ainda hoje' : 'consulta o quanto antes'}. Se piorar muito, procure o pronto-socorro.`;
  } else if (/\blista de espera\b|\bme (avisa|coloca)\b.*\b(desmarcar|vaga|lista)\b/.test(f)) {
    const now = new Date().toISOString();
    const open = table('waitlist').find((w) => w.contact_id === contact.id && (w.status === 'aguardando' || w.status === 'oferecido'));
    if (!open) table('waitlist').push({ id: newId(), company_id: DEMO_COMPANY_ID, contact_id: contact.id, service_id: sim.service, desired_date: sim.date, period: 'qualquer', notes: null, status: 'aguardando', offered_at: null, offered_starts_at: null, appointment_id: null, created_via: 'ia_cliente', created_at: now, updated_at: now });
    emit('waitlist');
    actions.push({ tool: 'entrar_lista_espera', label: 'Paciente na lista de espera', status: 'ok', detail: `${contact.name}${sim.date ? ` · ${fmtDate(sim.date).slice(0, 5)}` : ''}`, link: '#/agenda?espera=1' });
    reply = `Prontinho! ${emo ? '📝 ' : ''}Você está na lista de espera${sim.date ? ` para ${fmtDate(sim.date).slice(0, 5)}` : ''}. Se alguém desmarcar, eu te mando uma mensagem aqui na hora.`;
  } else if (/\b(atendente|humano|pessoa|alguem da (equipe|recepcao)|falar com (o|a) (dono|responsavel|dentista|doutor|doutora|recepcao))\b/.test(f)) {
    handoff = 'Paciente pediu para falar com a equipe';
    reply = `Claro! Já chamei alguém da recepção para falar com você. ${emo ? '🙋' : ''}`;
  } else if (/\b(reclama|absurdo|pessimo|horrivel|atras|demora|reembolso|devolv|procon)\w*/.test(f)) {
    handoff = 'Reclamação';
    reply = `Sinto muito por isso${emo ? ' 😔' : ''}. Já passei seu caso para a responsável da clínica, que vai te responder o quanto antes.`;
  } else if (/\b(convenio|plano|unimed|amil|bradesco|odontoprev|sulamerica|hapvida|porto)\b/.test(f) && !sim.askedData) {
    if (askedIns) { reply = `Atendemos ${askedIns}, sim! ${emo ? '😊 ' : ''}Traga a carteirinha e um documento com foto no dia. Quer marcar uma avaliação?`; contact.insurance = askedIns; emit('contacts'); actions.push({ tool: 'atualizar_cadastro', label: 'Ficha do paciente atualizada', status: 'ok', detail: `convênio ${askedIns}` }); }
    else if (insList.length) reply = `Atendemos estes convênios: ${insList.join(', ')}. Se o seu não estiver na lista, a consulta pode ser particular. Quer marcar?`;
    else reply = 'Por enquanto a clínica atende só particular. Quer saber os valores?';
  } else if (/\b(desconto|mais barato|faz por|abaixa|negocia|melhor preco)\b/.test(f)) {
    const pct = Number(f.match(/(\d{1,2})\s*%/)?.[1] ?? 0);
    if (pct > ai.max_discount_pct || !pct) { handoff = `Pediu desconto${pct ? ` de ${pct}%` : ''}`; reply = `Entendo! Condições especiais quem avalia é a responsável da clínica, então já pedi para ela te responder. Os tratamentos acima de R$ 1.000 podem ser parcelados em até 10x sem juros${emo ? ' 🙏' : '.'}`; }
    else reply = `Consigo sim: ${pct}% de desconto${service ? `, então ${service.name.toLowerCase()} sai por ${brl(service.price * (1 - pct / 100))}` : ''}. Quer que eu marque a consulta?`;
  } else if (isQuestion(text, f) && !date && !time && !/\b(quanto|valor|preco|custa)\b/.test(f) && faqAnswer(f)) {
    reply = faqAnswer(f)!;
  } else if (sim.askedData && !sim.booked && sim.date && sim.time && !isQuestion(text, f) && (/^(sim|s|pode|pode sim|isso|confirmo|ok|fechado|claro)\b/.test(f) || text.trim().split(/\s+/).length >= 2)) {
    // paciente mandou o nome (ou confirmou)
    const isYes = /^(sim|s|pode|pode sim|isso|confirmo|ok|fechado|claro)\b/.test(f);
    const nameGuess = text.split(/[,\n]/)[0].trim();
    if (!isYes && nameGuess.split(/\s+/).length >= 2 && nameGuess.length < 60) { contact.name = titleCase(nameGuess); }
    contact.updated_at = new Date().toISOString(); emit('contacts');
    const start = fromLocal(sim.date, sim.time, TZ).toISOString();
    const ok = isFree(start, service?.duration_min ?? company.slot_minutes, company, table('appointments'), new Date(), opts2);
    if (!ok.ok) {
      const alt = slotsForDate(sim.date, company, table('appointments'), service?.duration_min ?? 30, new Date(), opts2).slice(0, 4).map((s) => s.time);
      reply = `Poxa, esse horário acabou de ser ocupado. ${alt.length ? `Ainda tenho ${alt.join(', ')} nesse dia. Qual prefere?` : 'Quer tentar outro dia?'}`;
      sim.time = null;
    } else {
      const ap = createAppointment(contact, start, service, 'ia_cliente', { professional_id: ok.professionalId ?? sim.pro });
      sim.booked = true;
      contact.stage = 'fechado'; contact.temperature = 'quente'; emit('contacts');
      const who = proName(ap.professional_id);
      actions.push({ tool: 'agendar_horario', label: 'Consulta marcada', status: 'ok', detail: `${WEEKDAYS[weekdayOf(sim.date)]} às ${sim.time}${service ? ` · ${service.name}` : ''}${who ? ` · ${who}` : ''}` });
      audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_cliente', action: 'agendar', summary: `Marcou ${fmtDate(sim.date)} às ${sim.time} para ${contact.name}${service ? ` (${service.name}${who ? ` com ${who}` : ''})` : ''}`, target_type: 'appointment', target_id: ap.id, status: 'ok' });
      notify({ kind: 'agendamento', title: 'Nova consulta marcada pela IA', body: `${contact.name} · ${fmtDate(sim.date)} às ${sim.time}${who ? ` · ${who}` : ''}`, link: '#/agenda' });
      reply = `Prontinho, ${firstName(contact.name)}! ${emo ? '✅ ' : ''}${service ? service.name : 'Consulta'} marcada para ${fmtLong(sim.date)} às ${sim.time}${who ? ` com ${who}` : ''}${ap.payment_kind === 'convenio' ? `, pelo ${ap.insurance} (traga a carteirinha)` : service && service.price > 0 && service.price_type !== 'sob_consulta' ? ` (${service.price_type === 'a_partir_de' ? 'a partir de ' : ''}${brl(service.price)})` : ''}. ${ap.status === 'pendente' ? 'A recepção confirma em instantes.' : 'Na véspera eu te mando um lembrete para confirmar.'}`;
    }
  } else if ((date || time) && (sim.service || /\b(horario|agend|marc|pode ser|quero|tem|consulta)\b/.test(f) || sim.date)) {
    const day = sim.date ?? today;
    const dur = service?.duration_min ?? company.slot_minutes;
    const slots = slotsForDate(day, company, table('appointments'), dur, new Date(), opts2);
    const proTxt = sim.pro ? ` com ${proName(sim.pro)}` : '';
    if (!slots.length && !(company.business_hours[String(weekdayOf(day))] ?? []).length) reply = `Não atendemos ${WEEKDAYS[weekdayOf(day)]}. ${emo ? '😕 ' : ''}Que tal outro dia?`;
    else if (sim.time) {
      const startIso = fromLocal(day, sim.time, TZ).toISOString();
      const slot = slots.find((s) => s.startsAt === startIso);
      if (slot) {
        const who = proName(sim.pro ?? slot.pros[0]);
        if (!sim.pro && slot.pros[0]) sim.pro = slot.pros[0];
        reply = `Tenho sim! ${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} às ${sim.time}${who ? ` com ${who}` : ''}. Para eu marcar, me diz o seu nome completo?`;
        sim.askedData = true;
      }
      else reply = slots.length ? `Esse horário não está livre${proTxt}. ${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} ainda tenho ${slots.slice(0, 4).map((s) => s.time).join(', ')}. Algum desses serve?` : `${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} está lotado${proTxt}. Quer ver outro dia, ou prefere entrar na lista de espera? Se alguém desmarcar, te aviso na hora.`;
    } else reply = slots.length ? `${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)}${proTxt} tenho ${slots.slice(0, 5).map((s) => s.time).join(', ')}. Qual fica melhor?` : `${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} não tenho horários livres${proTxt}. Quer tentar outro dia, ou prefere entrar na lista de espera? Se alguém desmarcar, te aviso na hora.`;
  } else if (/\b(quanto|valor|preco|custa|cobra|orcamento)\b/.test(f) || svcFound) {
    if (service) {
      const who = table('professionals').filter((p) => p.active && (!p.service_ids.length || p.service_ids.includes(service.id))).map((p) => p.name);
      reply = `${priceLine(service)}${service.description ? `. ${service.description}` : '.'}${who.length === 1 ? ` Quem faz é ${who[0]}.` : ''} Quer ver os horários disponíveis?`;
    } else {
      reply = `Claro! Me conta o que você precisa (limpeza, clareamento, aparelho, restauração, implante...) que eu já te passo o valor. A primeira avaliação é gratuita.`;
    }
  } else if (/\b(endereco|onde fica|localiza|estacionamento)\b/.test(f)) {
    reply = `Ficamos na ${company.address}${company.city ? `, ${company.city}` : ''}. Tem estacionamento rotativo em frente ao prédio.`;
  } else if (/\b(pagamento|pagar|pix|cartao|parcel|dinheiro)\b/.test(f)) {
    reply = 'Particular: Pix, cartão de débito ou crédito, em até 10x sem juros nos tratamentos acima de R$ 1.000. Também atendemos convênios.';
  } else if (/\b(horario de funcionamento|que horas|abre|fecha|funcionam)\b/.test(f)) {
    reply = 'Atendemos de segunda a sexta, das 8h às 19h, e aos sábados das 8h às 12h.';
  } else if (/\b(obrigad|valeu|show|perfeito|otimo|maravilh)\w*/.test(f)) {
    reply = `Imagina${emo ? '! 💙' : '!'} Qualquer coisa, é só chamar por aqui.`;
  } else if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|hello)\b/.test(f)) {
    reply = ai.greeting || `Oi! Aqui é ${ai.assistant_name}, da ${company.name}. Como posso te ajudar?`;
  } else {
    reply = `Posso te ajudar com valores, convênios e horários${emo ? ' 😊' : '.'} O que você precisa?`;
  }

  // respondeu uma dúvida no meio do agendamento: lembra o que falta para marcar
  if (reply && !handoff && !sim.booked && sim.askedData && sim.date && sim.time && isQuestion(text, f) && !/marcar|nome completo/.test(reply)) {
    reply += ` E para eu marcar ${fmtLong(sim.date)} às ${sim.time}, só preciso do seu nome completo.`;
  }

  if (handoff) {
    conv.handler = 'humano'; conv.needs_attention = true; conv.attention_reason = handoff; autoAssign(conv); emit('conversations');
    actions.push({ tool: 'chamar_atendente', label: 'Atendimento passado para a equipe', status: 'ok', detail: handoff });
    notify({ kind: 'atendimento', title: `${contact.name} precisa de você`, body: handoff, link: '#/conversas' });
  }
  if (reply) pushMessage(conv, { direction: 'out', sender: 'ia', sender_name: AI_NAME(), body: reply, media: null, wa_status: 'lida', actions: actions.length ? actions : null, response_seconds: Math.round((Date.now() - t0) / 1000), channel: 'simulador' });
  conv.unread = 0;
  return { conversation_id: conv.id, reply, actions, handoff: !!handoff };
}

/* ================= sugestão de resposta (caixa de entrada) ================= */
export function suggestReplyDemo(convId: string): string {
  const conv = table('conversations').find((c) => c.id === convId);
  const contact = contactById(conv?.contact_id);
  const last = table('messages').filter((m) => m.conversation_id === convId && m.direction === 'in').pop();
  const f = fold(last?.body ?? '');
  const name = firstName(contact?.name) || '';
  if (/dor|inch|horario ainda hoje|urgencia/.test(f)) return `Oi, ${name}! Conseguimos te encaixar hoje às 16h30 com a Dra. Marina, como urgência. Pode vir? Se o inchaço aumentar muito antes disso, procure o pronto-socorro.`;
  if (/desconto|faz por|2\.?800|a vista/.test(f)) return `Oi, ${name}! A Dra. Luiza liberou uma condição à vista: o implante sai por R$ 3.150 no Pix (10% de desconto). Quer que eu já reserve a cirurgia?`;
  if (/siso|sangr/.test(f)) return `Oi, ${name}! Aqui é a Dra. Luiza. Um pouco de sangramento no primeiro dia é esperado. Morda uma gaze por 30 minutos e evite bochechar hoje. Se não parar, me chame aqui ou venha à clínica.`;
  if (/audio/.test(f)) return `Oi, ${name}! Ouvi seu áudio. Temos horário quinta às 15h com a Dra. Marina. Posso confirmar?`;
  return `Oi, ${name}! Obrigado pela mensagem. Posso te ajudar com mais alguma coisa?`;
}
