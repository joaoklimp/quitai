// Agente local do modo demonstração. Entende comandos comuns em português e executa as mesmas ações
// que a IA de verdade (Claude + ferramentas) faz no servidor. Serve para experimentar o produto sem chaves.
import type { ActionReceipt, AgentReply, Appointment, Contact, Conversation, PayMethod, PendingAction, Quote, Sale, Service } from '../types';
import { audit, contactById, demoDb, emit, newId, notify, pushMessage, table } from './db';
import { DEMO_COMPANY_ID, DEMO_USER_ID } from './seed';
import { isFree, slotsForDate } from '../availability';
import { parseDate, parseMethod, parseMoneyIn, parsePhone, parseTime } from '../../../shared/parse';
export { parseDate, parseMethod, parseMoneyIn, parsePhone, parseTime };
import {
  addDays, brl, firstName, fmtDate, fmtLong, fold, formatPhone, fromLocal, localDate, localTime, normalizePhone, weekdayOf, WEEKDAYS,
} from '../../../shared/format';

const TZ = 'America/Sao_Paulo';
let instant = false;
/** Desliga as pausas que imitam o tempo de resposta (usado nos testes). */
export function setInstant(v = true) { instant = v; }
const pause = (ms: number) => (instant ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const AI_NAME = () => `${demoDb().ai.assistant_name} (IA)`;
const qn = (n: number) => String(n).padStart(4, '0');

/* extração de dados do texto: src/shared/parse.ts */
const METHOD_LABEL: Record<PayMethod, string> = { pix: 'Pix', dinheiro: 'dinheiro', cartao_credito: 'cartão de crédito', cartao_debito: 'cartão de débito', boleto: 'boleto', transferencia: 'transferência', outro: 'outro' };
const titleCase = (s: string) => s.split(/\s+/).map((w) => (/^(da|de|do|das|dos|e)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');

/** Nome logo depois de um verbo de cadastro. */
function nameAfterVerb(raw: string): string | null {
  const m = raw.match(/(?:[Cc]adastr|[Aa]dicion|[Ii]nclu|[Ss]alv|[Rr]egistr|[Aa]not|[Aa]gend|[Mm]arc|[Rr]eserv)\w*\s+(?:(?:[Aa]|[Oo]|um|uma)\s+)?(?:(?:nova|novo)\s+)?(?:cliente\s+)?(?:(?:a|o)\s+)?([A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ']+){0,3})/);
  if (!m) return null;
  let name = m[1].replace(/\s+(telefone|tel|fone|celular|numero|número|whats|zap|email|e-mail)\b.*$/i, '').trim();
  if (!name || /^(cliente|venda|orcamento|orçamento)$/i.test(name)) return null;
  // se veio tudo minúsculo, pega no máximo duas palavras
  if (name === name.toLowerCase()) name = name.split(/\s+/).slice(0, 2).join(' ');
  return titleCase(name);
}
/** Nome depois de "para a", "pra", "da", "do", "de"... */
function nameAfterPrep(raw: string): string | null {
  const m = raw.match(/(?:^|\s)(?:[Pp]ara|[Pp]ra|[Pp]ro|ao|à|a|da|do|de|com)\s+(?:(?:a|o)\s+)?(?:cliente\s+)?([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ']+){0,3})/);
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
    [/impermeabiliz/, 'Impermeabilização'], [/retratil|reclinavel/, 'Limpeza de sofá retrátil'], [/sofa.*\b2\b|2 lugares|dois lugares/, 'Limpeza de sofá 2'],
    [/sofa.*\b3\b|3 lugares|tres lugares/, 'Limpeza de sofá 3'], [/colchao.*(solteiro)|solteiro/, 'Higienização de colchão solteiro'], [/colchao|cama/, 'Higienização de colchão casal'],
    [/tapete/, 'Limpeza de tapete'], [/cadeira/, 'Limpeza de cadeira'], [/poltrona|puff/, 'Limpeza de poltrona'], [/carro|automotiv|banco do carro|veiculo/, 'Higienização de banco'],
    [/visita|condominio|empresa/, 'Visita técnica'], [/sofa/, 'Limpeza de sofá 3'],
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
  const a: Appointment = {
    id: newId(), company_id: DEMO_COMPANY_ID, contact_id: contact.id, service_id: service?.id ?? null, title: service?.name ?? 'Atendimento', starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + dur * 60000).toISOString(), status: demoDb().ai.booking_mode === 'confirmar' && via === 'ia_cliente' ? 'pendente' : 'confirmado',
    address: contact.address, notes: null, price: service && service.price_type !== 'sob_consulta' ? service.price : null, created_via: via, reminder_sent_at: null, created_at: now, updated_at: now, ...extra,
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
  if (!list.length) return { text: `Ainda não há vendas registradas ${r.label}.` };
  const by = (m: (s: Sale) => boolean) => list.filter(m).reduce((s, x) => s + x.amount, 0);
  const ia = list.filter((s) => s.origin === 'ia');
  return {
    text: `${r.label[0].toUpperCase() + r.label.slice(1)} você vendeu ${brl(total)} em ${list.length} ${list.length === 1 ? 'venda' : 'vendas'}. 📈\n• Pix: ${brl(by((s) => s.method === 'pix'))}\n• Cartão: ${brl(by((s) => s.method.startsWith('cartao')))}\n• Dinheiro e outros: ${brl(by((s) => !['pix', 'cartao_credito', 'cartao_debito'].includes(s.method)))}\n• Fechadas pela IA: ${ia.length} (${brl(ia.reduce((s, x) => s + x.amount, 0))})`,
  };
}
function agendaOf(date: string): string {
  const list = table('appointments').filter((a) => localDate(a.starts_at, TZ) === date && a.status !== 'cancelado').sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const label = date === localDate(new Date(), TZ) ? 'Hoje' : fmtLong(date)[0].toUpperCase() + fmtLong(date).slice(1);
  if (!list.length) return `${label} a agenda está livre. 🙌`;
  return `${label} você tem ${list.length} ${list.length === 1 ? 'horário' : 'horários'}:\n` + list.map((a) => `• ${localTime(a.starts_at, TZ)} — ${contactById(a.contact_id)?.name ?? 'Cliente'} · ${a.title}${a.status === 'pendente' ? ' (a confirmar)' : a.status === 'concluido' ? ' ✓' : ''}`).join('\n');
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
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'atualizar_servico', summary: `Alterou o preço de "${s.name}" de ${brl(old)} para ${brl(s.price)} — confirmado pelo dono`, target_type: 'service', target_id: s.id, status: 'ok' });
    return { tool: p.tool, label: 'Preço atualizado', status: 'ok', detail: `${s.name}: ${brl(s.price)}` };
  }
  if (p.tool === 'criar_orcamento') {
    const c = contactById(a.contact_id);
    if (!c) return { tool: p.tool, label: 'Cliente não encontrado', status: 'erro' };
    const q = createQuote(c, a.items, 'ia_dono', a.discount);
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'criar_orcamento', summary: `Criou o orçamento nº ${qn(q.number)} de ${brl(q.total)} com desconto acima do limite — confirmado pelo dono`, target_type: 'quote', target_id: q.id, status: 'ok' });
    return { tool: p.tool, label: `Orçamento nº ${qn(q.number)} criado`, status: 'ok', detail: `${brl(q.total)} · desconto de ${brl(q.discount)}` };
  }
  return { tool: p.tool, label: 'Ação desconhecida', status: 'erro' };
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

const HELP = `Posso fazer muita coisa por você, é só pedir do seu jeito. Por exemplo:\n• "Cadastra a Maria, telefone 61 99999-9999, e cria um orçamento de R$ 350 para ela"\n• "Agenda o João sexta às 14h para limpeza de sofá"\n• "Quanto vendi essa semana?"\n• "O que tenho na agenda amanhã?"\n• "Quais orçamentos estão parados?"\n• "Registra uma venda de R$ 180 no Pix para a Juliana"\n• "Me lembra de ligar para o fornecedor amanhã às 9h"\nAções sensíveis (vendas, cancelamentos, preços, descontos altos) sempre pedem sua confirmação.`;

function handleClause(ctx: Ctx, clause: string) {
  const f = fold(clause);
  const company = demoDb().company, ai = demoDb().ai;

  // ajuda
  if (/\b(ajuda|o que (voce|vc) (faz|sabe|consegue)|comandos|como (te|funciona))\b/.test(f)) { ctx.lines.push(HELP); return; }

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
  if (/\b(quanto|qual)\b.*\b(vend|fatur)|\bvendas?\b.*\b(hoje|ontem|semana|mes|ano)\b|\bfaturamento\b/.test(f)) {
    ctx.lines.push(salesSummary(f).text);
    ctx.actions.push({ tool: 'resumo_vendas', label: 'Relatório de vendas consultado', status: 'ok' });
    return;
  }

  // conversas aguardando
  if (/\b(conversas?|clientes?|quem)\b.*\b(esperando|aguardando|pendentes?|sem resposta|precisa)\b/.test(f)) {
    const list = table('conversations').filter((c) => c.kind === 'cliente' && (c.needs_attention || c.handler === 'humano') && c.status === 'aberta');
    ctx.lines.push(list.length ? `${list.length} ${list.length === 1 ? 'conversa precisa' : 'conversas precisam'} de você:\n` + list.map((c) => `• ${contactById(c.contact_id)?.name ?? 'Cliente'} — ${c.attention_reason ?? 'atendimento com a equipe'}`).join('\n') : 'Nenhuma conversa esperando por você agora. A IA está dando conta! 🙌');
    ctx.actions.push({ tool: 'conversas_pendentes', label: 'Conversas pendentes consultadas', status: 'ok' });
    return;
  }

  // orçamentos parados
  if (/\borcamentos?\b.*\b(parad|pendent|abert|sem resposta|enviad|esperando)\w*/.test(f) || /\bquais\b.*\borcamentos\b/.test(f)) {
    const cutoff = Date.now() - 2 * 86400000;
    const list = table('quotes').filter((q) => q.status === 'enviado' && Date.parse(q.sent_at ?? q.created_at) < cutoff).slice(0, 6);
    const total = list.reduce((s, q) => s + q.total, 0);
    ctx.lines.push(list.length ? `Encontrei ${list.length} orçamentos enviados há mais de 2 dias sem resposta (${brl(total)} no total):\n` + list.map((q) => `• nº ${qn(q.number)} — ${contactById(q.contact_id)?.name ?? 'Cliente'} · ${brl(q.total)} · enviado ${fmtDate(q.sent_at ?? q.created_at)}`).join('\n') + '\nQuer que eu mande uma mensagem de acompanhamento para eles?' : 'Nenhum orçamento parado. Todos foram respondidos ou ainda estão no prazo. 👌');
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
    if (!q) { ctx.lines.push('Não encontrei esse orçamento. Me diga o número ou o nome do cliente.'); return; }
    q.status = status; q.responded_at = new Date().toISOString(); q.updated_at = q.responded_at;
    const ct = contactById(q.contact_id); if (ct) ct.stage = status === 'aprovado' ? 'fechado' : 'perdido';
    emit('quotes'); emit('contacts');
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'atualizar_orcamento', summary: `Marcou o orçamento nº ${qn(q.number)} (${ct?.name ?? ''}) como ${status}`, target_type: 'quote', target_id: q.id, status: 'ok' });
    ctx.actions.push({ tool: 'atualizar_orcamento', label: `Orçamento nº ${qn(q.number)} ${status}`, status: 'ok', detail: `${ct?.name ?? ''} · ${brl(q.total)}` });
    ctx.lines.push(`Combinado! ✅ O orçamento nº ${qn(q.number)} de ${ct?.name ?? 'cliente'} (${brl(q.total)}) agora está ${status}.${status === 'aprovado' ? ' Quer que eu já agende o serviço?' : ''}`);
    return;
  }

  // enviar orçamento
  if (/\b(manda|envia|mande|envie)\w*\b.*\borcamento\b|\b(manda|envia)\s+(sim|ele|pra ela|pra ele)\b|^manda sim$/.test(f)) {
    const q = ctx.lastQuote ?? table('quotes').filter((x) => x.created_via === 'ia_dono' && x.status === 'rascunho').sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    if (!q) { ctx.lines.push('Qual orçamento você quer enviar? Me diga o número ou o nome do cliente.'); return; }
    q.status = 'enviado'; q.sent_at = new Date().toISOString(); emit('quotes');
    const ct = contactById(q.contact_id);
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'enviar_orcamento', summary: `Enviou o orçamento nº ${qn(q.number)} para ${ct?.name ?? 'cliente'}`, target_type: 'quote', target_id: q.id, status: 'ok' });
    ctx.actions.push({ tool: 'enviar_orcamento', label: 'Orçamento enviado no WhatsApp', status: 'ok', detail: `nº ${qn(q.number)} · ${ct?.name ?? ''}` });
    ctx.lines.push(`Enviado! 📨 ${ct ? firstName(ct.name) : 'O cliente'} recebeu o link do orçamento nº ${qn(q.number)}. Te aviso quando responder.`);
    return;
  }

  // criar orçamento
  if (/\borcamento\b/.test(f) && /\b(cri|fa[zc]|mont|ger|abr|prepar|lanc)\w*\b|\borcamento de\b/.test(f)) {
    let c = resolveContact(ctx, clause);
    if (c === 'ambiguous') c = null;
    if (!c) {
      const n = nameAfterPrep(clause);
      if (n) { const res = createContact(n, parsePhone(clause), 'ia_dono'); c = res.contact; ctx.actions.push({ tool: 'cadastrar_cliente', label: `Cliente ${firstName(n)} cadastrado`, status: 'ok' }); }
    }
    if (!c) { ctx.lines.push('Para quem é o orçamento? Ex.: "cria um orçamento de R$ 350 para a Maria".'); return; }
    const svc = matchService(f);
    let amount = parseMoneyIn(clause);
    const qty = Number(f.match(/\b(\d{1,3})\s*(?:m2|m²|metros|cadeiras|unidades|lugares)\b/)?.[1] ?? 1);
    if (!amount && svc && svc.price_type !== 'sob_consulta') amount = svc.price * (svc.name.includes('tapete') || svc.name.includes('cadeira') ? qty : 1);
    if (!amount) { ctx.lines.push(`Qual o valor do orçamento para ${firstName(c.name)}?`); return; }
    const pctMatch = f.match(/(\d{1,2})\s*%\s*de desconto|desconto de (\d{1,2})\s*%/);
    const pct = pctMatch ? +(pctMatch[1] ?? pctMatch[2]) : 0;
    const items = [{ description: svc ? svc.name : 'Serviço combinado com o cliente', qty: 1, unit_price: amount, service_id: svc?.id ?? null }];
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

  // agenda (consulta)
  if (/\b(agenda|horarios?|compromissos?|servicos?)\b.*\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}\/\d{1,2})\b|\bo que (eu )?(tenho|temos)\b/.test(f) && !/\b(agend|marc|reserv)\w*\s+(?:a|o)\s/.test(f)) {
    const d = parseDate(f, ctx.today) ?? ctx.today;
    ctx.lines.push(agendaOf(d));
    ctx.actions.push({ tool: 'consultar_agenda', label: 'Agenda consultada', status: 'ok', detail: fmtDate(d) });
    return;
  }

  // cancelar agendamento (sensível)
  if (/\bcancel\w*\b/.test(f) && /\b(agendamento|horario|visita|servico|limpeza|atendimento)\b/.test(f)) {
    const c = resolveContact(ctx, clause);
    if (!c || c === 'ambiguous') { ctx.lines.push('De qual cliente é o horário que você quer cancelar?'); return; }
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
    if (!c || c === 'ambiguous') { ctx.lines.push('De qual cliente é o horário que você quer remarcar?'); return; }
    const ap = nextAppointmentOf(c);
    const d = parseDate(f, ctx.today), t = parseTime(f);
    if (!ap) { ctx.lines.push(`${firstName(c.name)} não tem horário marcado para remarcar.`); return; }
    if (!d || !t) { ctx.lines.push(`Para quando você quer remarcar o horário de ${firstName(c.name)}? Ex.: "segunda às 10h".`); return; }
    const start = fromLocal(d, t, TZ).toISOString();
    const dur = (Date.parse(ap.ends_at) - Date.parse(ap.starts_at)) / 60000;
    const ok = isFree(start, dur, company, table('appointments').filter((x) => x.id !== ap.id));
    if (!ok.ok) { const alt = slotsForDate(d, company, table('appointments'), dur).slice(0, 4).map((s) => s.time); ctx.lines.push(`${ok.reason} ${alt.length ? `Livres nesse dia: ${alt.join(', ')}.` : 'Não há horários livres nesse dia.'}`); return; }
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
    if (!c) { ctx.lines.push('Para qual cliente é o horário?'); return; }
    const d = parseDate(f, ctx.today), t = parseTime(f);
    if (!d || !t) { ctx.lines.push(`Qual dia e horário para ${firstName(c.name)}? Ex.: "sexta às 14h".`); return; }
    const svc = matchService(f);
    const start = fromLocal(d, t, TZ).toISOString();
    const ok = isFree(start, svc?.duration_min ?? company.slot_minutes, company, table('appointments'));
    if (!ok.ok) { const alt = slotsForDate(d, company, table('appointments'), svc?.duration_min ?? 60).slice(0, 5).map((s) => s.time); ctx.lines.push(`${ok.reason} ${alt.length ? `Livres em ${fmtDate(d)}: ${alt.join(', ')}.` : 'Esse dia está sem horários livres.'}`); return; }
    const ap = createAppointment(c, start, svc, 'ia_dono');
    ctx.lastContact = c;
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'agendar', summary: `Agendou ${c.name} para ${fmtDate(d)} às ${t}${svc ? ` (${svc.name})` : ''}`, target_type: 'appointment', target_id: ap.id, status: 'ok' });
    ctx.actions.push({ tool: 'agendar', label: 'Horário reservado na agenda', status: 'ok', detail: `${c.name} · ${WEEKDAYS[weekdayOf(d)]} ${fmtDate(d)} às ${t}`, link: '#/agenda' });
    ctx.lines.push(`• Agendei ${firstName(c.name)} para ${fmtLong(d)} às ${t}${svc ? ` — ${svc.name}` : ''}`);
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
    if (!c || c === 'ambiguous') { ctx.lines.push('Em qual conversa? Me diga o nome do cliente.'); return; }
    const conv = table('conversations').find((x) => x.contact_id === c.id && x.kind === 'cliente');
    if (!conv) { ctx.lines.push(`Não encontrei conversa com ${c.name}.`); return; }
    const back = /\b(volta|retoma|liga)\w*\b/.test(f);
    conv.handler = back ? 'ia' : 'humano'; conv.needs_attention = !back && conv.needs_attention; emit('conversations');
    ctx.actions.push({ tool: 'pausar_ia', label: back ? 'IA voltou a atender' : 'IA pausada nesta conversa', status: 'ok', detail: c.name });
    ctx.lines.push(back ? `Combinado! A IA voltou a atender ${firstName(c.name)}.` : `Combinado! Pausei a IA na conversa com ${firstName(c.name)}. Agora é com você.`);
    return;
  }

  // alterar preço (sensível)
  if (/\b(muda|altera|atualiza|aumenta|reajusta|baixa)\w*\b.*\bpreco\b/.test(f)) {
    const svc = matchService(f); const price = parseMoneyIn(clause);
    if (!svc || !price) { ctx.lines.push('Qual serviço e qual o novo preço? Ex.: "muda o preço da limpeza de poltrona para R$ 95".'); return; }
    ctx.pending = createPending(ctx.conv, 'atualizar_servico', { service_id: svc.id, price }, `Mudar o preço de "${svc.name}" de ${brl(svc.price)} para ${brl(price)}`);
    ctx.actions.push({ tool: 'atualizar_servico', label: 'Mudança de preço aguardando confirmação', status: 'aguardando', detail: `${svc.name}: ${brl(svc.price)} → ${brl(price)}`, pending_id: ctx.pending.id });
    ctx.lines.push(`Vou mudar o preço de "${svc.name}" de ${brl(svc.price)} para ${brl(price)}. A IA passa a usar o novo valor com os clientes na hora. Confirma? Responda SIM ou NÃO.`);
    return;
  }

  // cadastrar cliente
  if (/\b(cadastr|adicion|inclu|salv|registr|anot)\w*\b/.test(f)) {
    const name = nameAfterVerb(clause);
    if (!name) { ctx.lines.push('Qual o nome do cliente? Ex.: "cadastra a Maria, telefone 61 99999-9999".'); return; }
    const phone = parsePhone(clause);
    const email = clause.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
    const { contact, existed } = createContact(name, phone, 'ia_dono', email ? { email } : {});
    ctx.lastContact = contact;
    if (existed) { ctx.lines.push(`• ${contact.name} já estava cadastrada com esse telefone, então usei o cadastro existente`); return; }
    audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_dono', action: 'cadastrar_cliente', summary: `Cadastrou ${contact.name}${phone ? ` — ${formatPhone(phone)}` : ''}`, target_type: 'contact', target_id: contact.id, status: 'ok' });
    ctx.actions.push({ tool: 'cadastrar_cliente', label: `Cliente ${firstName(contact.name)} cadastrad${/a$/i.test(firstName(contact.name)) ? 'a' : 'o'}`, status: 'ok', detail: phone ? formatPhone(phone) : undefined, link: '#/clientes' });
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
    reply = `Combinado! ✅ Fiz assim:\n${bullets.join('\n')}${ctx.lastQuote && ctx.lastQuote.status === 'rascunho' ? `\nQuer que eu mande o link do orçamento para ${firstName(contactById(ctx.lastQuote.contact_id)?.name ?? 'o cliente')} no WhatsApp?` : ''}`;
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

/* ================= simulador de cliente (a IA atendendo) ================= */
interface SimState { convId: string | null; contactId: string | null; service: string | null; date: string | null; time: string | null; askedData: boolean; booked: boolean }
let sim: SimState = { convId: null, contactId: null, service: null, date: null, time: null, askedData: false, booked: false };

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

function priceLine(s: Service): string {
  if (s.price_type === 'sob_consulta') return `${s.name}: o valor depende de uma avaliação, então fazemos uma visita técnica sem custo`;
  return `${s.name} ${s.price_type === 'a_partir_de' ? 'começa em' : 'sai por'} ${brl(s.price)}`;
}

export async function runSimulator(text: string, opts: { reset?: boolean; name?: string }): Promise<AgentReply> {
  if (opts.reset) sim = { convId: null, contactId: null, service: null, date: null, time: null, askedData: false, booked: false };
  const conv = simConversation(opts.name || 'Cliente de teste');
  const contact = contactById(sim.contactId)!;
  pushMessage(conv, { direction: 'in', sender: 'contato', sender_name: contact.name, body: text, media: null, wa_status: null, actions: null, response_seconds: null, channel: 'simulador' });
  const t0 = Date.now();
  await pause(900 + Math.random() * 700);
  const f = fold(text);
  const d = demoDb(); const company = d.company; const ai = d.ai; const emo = ai.use_emojis;
  const today = localDate(new Date(), TZ);
  const actions: ActionReceipt[] = [];
  let reply = '';
  let handoff = false;

  const svcFound = matchService(f);
  if (svcFound) sim.service = svcFound.id;
  const date = parseDate(f, today); const time = parseTime(f);
  if (date) sim.date = date;
  if (time) sim.time = time;
  const service = table('services').find((s) => s.id === sim.service) ?? null;

  if (conv.handler === 'humano') {
    reply = '';
  } else if (/\b(atendente|humano|pessoa|alguem da equipe|falar com (o|a) (dono|responsavel|gerente))\b/.test(f)) {
    handoff = true;
    reply = `Claro! Já chamei uma pessoa da equipe para falar com você. ${emo ? '🙋' : ''} Enquanto isso, se quiser, me conta o que você precisa.`;
  } else if (/\b(reclama|absurdo|pessimo|horrivel|nao apareceu|atras|estragou|manchou|danific|procon|reembolso|devolv)\w*/.test(f)) {
    handoff = true;
    reply = `Sinto muito por isso${emo ? ' 😔' : ''}. Já passei seu caso para uma pessoa da equipe, que vai te responder o quanto antes para resolver.`;
  } else if (/\b(desconto|mais barato|faz por|abaixa|negocia|melhor preco)\b/.test(f)) {
    const pct = Number(f.match(/(\d{1,2})\s*%/)?.[1] ?? 0);
    if (pct > ai.max_discount_pct) { handoff = true; reply = `Entendo! Esse desconto passa do que eu posso autorizar por aqui, então já pedi para o responsável avaliar. Ele te responde em instantes${emo ? ' 🙏' : '.'}`; }
    else reply = `Consigo sim te ajudar: no Pix tem 5% de desconto${service ? `, então ${service.name.toLowerCase()} sai por ${brl(service.price * 0.95)}` : ''}. Quer que eu reserve um horário?`;
  } else if (sim.askedData && !sim.booked && sim.date && sim.time && (/^(sim|s|pode|pode sim|isso|confirmo|ok|fechado|claro)\b/.test(f) || text.includes(',') || text.trim().split(/\s+/).length >= 3)) {
    // cliente mandou nome e endereço
    const isYes = /^(sim|s|pode|pode sim|isso|confirmo|ok|fechado|claro)\b/.test(f);
    const nameGuess = text.split(/[,\n]/)[0].trim();
    if (!isYes && nameGuess.split(/\s+/).length >= 2 && nameGuess.length < 60) { contact.name = titleCase(nameGuess); }
    const addr = !isYes && text.includes(',') ? text.split(',').slice(1).join(',').trim() : null;
    if (addr) contact.address = addr;
    contact.updated_at = new Date().toISOString(); emit('contacts');
    const start = fromLocal(sim.date, sim.time, TZ).toISOString();
    const ok = isFree(start, service?.duration_min ?? company.slot_minutes, company, table('appointments'));
    if (!ok.ok) {
      const alt = slotsForDate(sim.date, company, table('appointments'), service?.duration_min ?? 60).slice(0, 4).map((s) => s.time);
      reply = `Poxa, esse horário acabou de ser ocupado. ${alt.length ? `Ainda tenho ${alt.join(', ')} nesse dia. Qual prefere?` : 'Quer tentar outro dia?'}`;
      sim.time = null;
    } else {
      const ap = createAppointment(contact, start, service, 'ia_cliente');
      sim.booked = true;
      contact.stage = 'fechado'; contact.temperature = 'quente'; emit('contacts');
      actions.push({ tool: 'agendar_horario', label: 'Horário reservado na agenda', status: 'ok', detail: `${WEEKDAYS[weekdayOf(sim.date)]} às ${sim.time}${service ? ` · ${service.name}` : ''}` });
      if (addr) actions.push({ tool: 'atualizar_meus_dados', label: 'Cadastro atualizado', status: 'ok', detail: 'Nome e endereço salvos' });
      audit({ actor_type: 'ia', actor_name: AI_NAME(), channel: 'ia_cliente', action: 'agendar_horario', summary: `Reservou ${fmtDate(sim.date)} às ${sim.time} para ${contact.name}${service ? ` (${service.name})` : ''}`, target_type: 'appointment', target_id: ap.id, status: 'ok' });
      notify({ kind: 'agendamento', title: 'Novo horário reservado pela IA', body: `${contact.name} · ${fmtDate(sim.date)} às ${sim.time}`, link: '#/agenda' });
      reply = `Combinado, ${firstName(contact.name)}! ${emo ? '✅ ' : ''}Reservei ${fmtLong(sim.date)} às ${sim.time}${service ? ` para ${service.name.toLowerCase()}` : ''}${service && service.price_type !== 'sob_consulta' ? ` (${service.price_type === 'a_partir_de' ? 'a partir de ' : ''}${brl(service.price)})` : ''}. ${ap.status === 'pendente' ? 'A equipe confirma em instantes.' : 'Está tudo certo na agenda.'} Qualquer coisa, é só me chamar por aqui!`;
    }
  } else if (!date && !time && sim.date && !sim.time && !sim.booked && !/\?/.test(text) && (text.includes(',') || text.trim().split(/\s+/).length >= 3) && !/\b(quanto|valor|preco|horario|atende|pagamento)\b/.test(f)) {
    // mandou nome e endereço antes de escolher o horário: guarda e pede a escolha
    const nameGuess = text.split(/[,\n]/)[0].trim();
    if (nameGuess.split(/\s+/).length >= 2 && nameGuess.length < 60) contact.name = titleCase(nameGuess);
    if (text.includes(',')) contact.address = text.split(',').slice(1).join(',').trim();
    contact.updated_at = new Date().toISOString(); emit('contacts');
    sim.askedData = true;
    const slots = slotsForDate(sim.date, company, table('appointments'), service?.duration_min ?? company.slot_minutes).slice(0, 4).map((s) => s.time);
    reply = slots.length ? `Anotado, ${firstName(contact.name)}! ${emo ? '📝 ' : ''}Agora só falta escolher o horário: ${slots.join(', ')}. Qual prefere?` : `Anotado, ${firstName(contact.name)}! Esse dia lotou. Quer ver outro dia?`;
  } else if ((date || time) && (sim.service || /\b(horario|agend|marc|pode ser|quero|tem)\b/.test(f) || sim.date)) {
    const day = sim.date ?? today;
    const dur = service?.duration_min ?? company.slot_minutes;
    const slots = slotsForDate(day, company, table('appointments'), dur);
    if (!(company.business_hours[String(weekdayOf(day))] ?? []).length) reply = `Não atendemos ${WEEKDAYS[weekdayOf(day)]}. ${emo ? '😕 ' : ''}Que tal outro dia?`;
    else if (sim.time) {
      const startIso = fromLocal(day, sim.time, TZ).toISOString();
      if (slots.some((s) => s.startsAt === startIso)) {
        if (sim.askedData && contact.address) reply = `Perfeito! Posso confirmar ${fmtLong(day)} às ${sim.time} no endereço ${contact.address}? Responda "sim" para eu reservar.`;
        else { reply = `Temos esse horário disponível! Posso reservar ${fmtLong(day)} às ${sim.time} para você? Só preciso do seu nome completo e do endereço.`; sim.askedData = true; }
      }
      else reply = slots.length ? `Esse horário não está livre. ${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} ainda tenho ${slots.slice(0, 4).map((s) => s.time).join(', ')}. Algum desses serve?` : `${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} está lotado. Quer ver outro dia?`;
    } else reply = slots.length ? `${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} tenho ${slots.slice(0, 5).map((s) => s.time).join(', ')}. Qual fica melhor?` : `${fmtLong(day)[0].toUpperCase() + fmtLong(day).slice(1)} não tenho horários livres. Quer tentar outro dia?`;
  } else if (/\b(quanto|valor|preco|custa|cobra|orcamento)\b/.test(f) || svcFound) {
    if (/\bsofa\b/.test(f) && !/\b(2|3|dois|tres|retratil|reclinavel|impermeab)\b/.test(f)) {
      const s2 = table('services').find((s) => s.name.startsWith('Limpeza de sofá 2'))!, s3 = table('services').find((s) => s.name.startsWith('Limpeza de sofá 3'))!, sr = table('services').find((s) => s.name.startsWith('Limpeza de sofá retrátil'))!;
      reply = `Olá! ${emo ? '😊 ' : ''}A limpeza de sofá de 3 lugares começa em ${brl(s3.price)}, conforme a tabela cadastrada. O de 2 lugares sai por ${brl(s2.price)} e o retrátil começa em ${brl(sr.price)}. Quer consultar os horários disponíveis?`;
      sim.service = s3.id;
    } else if (service) {
      reply = `${priceLine(service)}${service.description ? `. ${service.description}` : ''} Quer consultar os horários disponíveis?`;
    } else {
      reply = `Claro! Me conta qual serviço você precisa (sofá, colchão, tapete, cadeiras, poltrona ou banco de carro) que eu já te passo o valor.`;
    }
  } else if (/\b(atende|atendem|vai ate|regiao|bairro|cidade)\b/.test(f)) {
    reply = /\b(valparaiso|aguas lindas|luziania|entorno|goias|go)\b/.test(f) ? 'Atendemos sim! Por ser Entorno, tem uma taxa de deslocamento de R$ 30. Qual serviço você precisa?' : `Atendemos todo o DF${emo ? ' 🙌' : ''}. Qual serviço você precisa?`;
  } else if (/\b(pagamento|pagar|pix|cartao|parcel|dinheiro)\b/.test(f)) {
    reply = 'Aceitamos Pix (com 5% de desconto), cartão em até 3x sem juros ou dinheiro. O pagamento é feito depois do serviço.';
  } else if (/\b(horario de funcionamento|que horas|abre|fecha|funcionam)\b/.test(f)) {
    reply = 'Atendemos de segunda a sexta, das 8h às 18h, e aos sábados das 8h às 13h. Domingo não abrimos.';
  } else if (/\b(obrigad|valeu|show|perfeito|otimo|maravilh)\w*/.test(f)) {
    reply = `Imagina${emo ? '! 💙' : '!'} Qualquer coisa, é só chamar por aqui.`;
  } else if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|hello)\b/.test(f)) {
    reply = ai.greeting || `Oi! Aqui é ${ai.assistant_name}, de ${company.name}. Como posso te ajudar?`;
  } else {
    reply = `Posso te ajudar com preços, horários e orçamentos${emo ? ' 😊' : '.'} Qual serviço você precisa?`;
  }

  if (handoff) {
    conv.handler = 'humano'; conv.needs_attention = true; conv.attention_reason = 'Cliente de teste pediu atendimento humano'; emit('conversations');
    actions.push({ tool: 'chamar_atendente', label: 'Atendimento passado para a equipe', status: 'ok' });
    notify({ kind: 'atendimento', title: `${contact.name} precisa de você`, body: 'A IA passou o atendimento para a equipe.', link: '#/conversas' });
  }
  if (reply) pushMessage(conv, { direction: 'out', sender: 'ia', sender_name: AI_NAME(), body: reply, media: null, wa_status: 'lida', actions: actions.length ? actions : null, response_seconds: Math.round((Date.now() - t0) / 1000), channel: 'simulador' });
  conv.unread = 0;
  return { conversation_id: conv.id, reply, actions, handoff };
}

/* ================= sugestão de resposta (caixa de entrada) ================= */
export function suggestReplyDemo(convId: string): string {
  const conv = table('conversations').find((c) => c.id === convId);
  const contact = contactById(conv?.contact_id);
  const last = table('messages').filter((m) => m.conversation_id === convId && m.direction === 'in').pop();
  const f = fold(last?.body ?? '');
  const name = firstName(contact?.name) || '';
  if (/atras|nao apareceu|aguardo|alguem/.test(f)) return `Oi, ${name}! Peço desculpas pela demora. Falei agora com o técnico: ele teve um imprevisto no trânsito e chega em até 20 minutos. Como pedido de desculpas, vamos aplicar 10% de desconto no seu serviço. Obrigado pela paciência!`;
  if (/desconto|faz por|230/.test(f)) return `Oi, ${name}! Consegui uma condição especial: fechando hoje no Pix, a impermeabilização sai por R$ 250. Posso reservar um horário para você?`;
  if (/sindica|condominio|salao/.test(f)) return `Olá, Helena! Obrigado pelo contato. Podemos fazer uma visita técnica sem custo para avaliar os 12 sofás e as 40 cadeiras. Que dia e horário ficam bons para você esta semana?`;
  if (/audio/.test(f)) return `Oi, ${name}! Ouvi seu áudio. Temos horário quinta às 15h. Posso confirmar?`;
  return `Oi, ${name}! Obrigado pela mensagem. Posso te ajudar com mais alguma coisa?`;
}
