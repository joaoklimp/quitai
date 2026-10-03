// Ferramentas da IA. Cada uma valida a entrada, confere o que a pessoa (ou o paciente) pode fazer,
// age no banco, registra no histórico e devolve um recibo para o painel e para o WhatsApp.
// Ações sensíveis do modo dono não executam na hora: viram um pedido de confirmação (pending_actions).
import { db, audit, notify } from './db.ts';
import type { Tool, ToolResult } from './ai.ts';
import { at, priceText, quoteLink, quoteNo, type Base } from './context.ts';
import { deliverToContact, sendQuote } from './conversation.ts';
import { isFree, slotsForDate } from './availability.ts';
import { addDays, brl, firstName, fmtDate, fold, formatPhone, localDate, localTime, normalizePhone, parseMoney, WEEKDAYS_SHORT } from './format.ts';
import { loadAccount, sendTemplate, sendText, withinWindow } from './whatsapp.ts';
import { TEMPLATES } from './templates.ts';
import { createCharge, ProviderError, type Actor } from './payments.ts';
import { emitNote } from './fiscal.ts';
import type { ActionReceipt, Appointment, Contact, PayMethod, Professional, Role, Service } from './types.ts';

export interface AgentCtx extends Base {
  mode: 'cliente' | 'dono';
  channel: 'whatsapp' | 'painel' | 'simulador';
  conversationId: string;
  contact?: Contact; // modo paciente
  member?: { userId: string; name: string; role: Role }; // modo dono
}

/* ---------- utilitários ---------- */
const s = (v: unknown, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const money = (v: unknown) => (typeof v === 'number' ? v : parseMoney(String(v ?? '')));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ok = (content: string, receipt?: ActionReceipt): ToolResult => ({ content, receipt });
const err = (content: string): ToolResult => ({ content, error: true });
const when = (b: Base, iso: string) => `${WEEKDAYS_SHORT[new Date(localDate(iso, b.tz) + 'T12:00:00Z').getUTCDay()]} ${fmtDate(iso, b.tz).slice(0, 5)} às ${localTime(iso, b.tz)}`;
const sim = (c: AgentCtx) => c.channel === 'simulador';
const suffix = (c: AgentCtx) => (sim(c) ? ' (simulador)' : '');

function actor(c: AgentCtx) {
  return c.mode === 'cliente'
    ? { actor_type: 'ia' as const, actor_name: c.ai.assistant_name || 'IA', actor_user_id: null, channel: 'ia_cliente' }
    : { actor_type: 'ia' as const, actor_name: `IA, a pedido de ${c.member?.name ?? 'equipe'}`, actor_user_id: c.member?.userId ?? null, channel: 'ia_dono' };
}
const via = (c: AgentCtx) => (c.mode === 'cliente' ? 'ia_cliente' : 'ia_dono');
async function log(c: AgentCtx, action: string, summary: string, target_type?: string, target_id?: string | null, status = 'ok') {
  await audit({ company_id: c.company.id, ...actor(c), action, summary: summary + suffix(c), target_type: target_type ?? null, target_id: target_id ?? null, status });
}
async function alert(c: AgentCtx, kind: string, title: string, body: string, link: string) {
  if (!sim(c)) await notify(c.company.id, kind, title, body, link);
}
const iaActor = (c: AgentCtx): Actor => ({ type: 'ia', name: `IA, a pedido de ${c.member?.name ?? 'equipe'}`, userId: c.member?.userId ?? null, channel: 'ia_dono', via: 'ia_dono' });
function canWrite(c: AgentCtx): ToolResult | null {
  return c.writable ? null : err('A assinatura da empresa está inativa: só é possível consultar. Avise a pessoa para reativar em Configurações → Assinatura.');
}
function needRole(c: AgentCtx, ...roles: Role[]): ToolResult | null {
  return c.mode === 'dono' && c.member && !roles.includes(c.member.role) ? err(`O papel de ${c.member.role} não permite essa ação. Peça para o dono ou um gerente.`) : null;
}

async function dayAppointments(c: AgentCtx, date: string): Promise<Appointment[]> {
  const start = at(c, date, '00:00').toISOString(), end = at(c, addDays(date, 1), '00:00').toISOString();
  const { data } = await db.from('appointments').select('*').eq('company_id', c.company.id).lt('starts_at', end).gt('ends_at', start).not('status', 'in', '(cancelado,faltou)');
  return (data ?? []) as Appointment[];
}
const service = (c: AgentCtx, id: unknown) => c.services.find((x) => x.id === s(id));
const professional = (c: AgentCtx, id: unknown) => c.professionals.find((x) => x.id === s(id));
const proName = (c: AgentCtx, id?: string | null) => (id ? c.professionals.find((p) => p.id === id)?.name : undefined);
/** "Dr. Bruno Reis" → "Dr. Bruno"; "Ana Duarte" → "Ana". */
const shortPro = (name?: string) => { const t = (name ?? '').trim().split(/\s+/); return /^(dra?|prof(a|ª)?|enf)\.?$/i.test(t[0] ?? '') ? t.slice(0, 2).join(' ') : t[0] ?? ''; };
const slotOpts = (c: AgentCtx, serviceId?: string | null, professionalId?: string | null) => ({ professionals: c.professionals, serviceId: serviceId ?? null, professionalId: professionalId ?? null });
/** Convênio pedido: precisa estar na lista aceita pela clínica. Devolve o nome oficial, null (particular) ou um erro. */
function insuranceOf(c: AgentCtx, raw: unknown): { name: string | null; error?: string } {
  const want = s(raw, 80);
  if (!want || /^particular$/i.test(want)) return { name: null };
  const found = (c.company.insurances ?? []).find((x) => fold(x) === fold(want) || fold(x).includes(fold(want)) || fold(want).includes(fold(x)));
  return found ? { name: found } : { name: null, error: `A clínica não atende pelo convênio "${want}". Convênios aceitos: ${(c.company.insurances ?? []).join(', ') || 'nenhum (só particular)'}. Ofereça a consulta particular.` };
}
async function contactById(c: AgentCtx, id: unknown): Promise<Contact | null> {
  const { data } = await db.from('contacts').select('*').eq('company_id', c.company.id).eq('id', s(id)).maybeSingle();
  return (data as Contact | null) ?? null;
}
async function appointmentFor(c: AgentCtx, id: unknown): Promise<Appointment | null> {
  let q = db.from('appointments').select('*').eq('company_id', c.company.id).eq('id', s(id));
  if (c.mode === 'cliente') q = q.eq('contact_id', c.contact!.id); // o paciente só mexe nos próprios horários
  const { data } = await q.maybeSingle();
  return (data as Appointment | null) ?? null;
}

/* ---------- confirmação de ações sensíveis ---------- */
async function askConfirmation(c: AgentCtx, tool: string, args: Record<string, unknown>, summary: string): Promise<ToolResult> {
  const { data, error } = await db.from('pending_actions').insert({
    company_id: c.company.id, conversation_id: c.conversationId, tool, args, summary, requested_by: c.member?.userId ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  await log(c, tool, `Pediu confirmação: ${summary}`, 'pending_action', data.id, 'aguardando');
  return {
    content: `Pedido registrado e AGUARDANDO CONFIRMAÇÃO: ${summary}. Ainda não foi feito. Diga em uma frase o que vai acontecer e peça para a pessoa confirmar (ela verá os botões Confirmar e Cancelar).`,
    receipt: { tool, label: summary, status: 'aguardando', pending_id: data.id },
  };
}

/* ---------- agenda ---------- */
async function freeSlots(c: AgentCtx, input: Record<string, unknown>): Promise<ToolResult> {
  const date = s(input.data);
  if (!DATE.test(date)) return err('Informe a data no formato AAAA-MM-DD.');
  const svc = input.servico_id ? service(c, input.servico_id) : undefined;
  if (input.servico_id && !svc) return err('Procedimento não encontrado: use um id da lista de procedimentos.');
  const pro = input.profissional_id ? professional(c, input.profissional_id) : undefined;
  if (input.profissional_id && !pro) return err('Profissional não encontrado: use um id da lista de profissionais.');
  const duration = svc?.duration_min ?? c.company.slot_minutes;
  const intervals = c.company.business_hours?.[String(new Date(date + 'T12:00:00Z').getUTCDay())] ?? [];
  const today = localDate(new Date(), c.tz);
  if (date < today) return err('Essa data já passou.');
  if (date > addDays(today, c.company.max_days_ahead)) return ok(`A agenda só está aberta até ${fmtDate(addDays(today, c.company.max_days_ahead) + 'T12:00:00Z', c.tz)}.`);
  if (!intervals.length && !c.professionals.some((p) => (p.business_hours?.[String(new Date(date + 'T12:00:00Z').getUTCDay())] ?? []).length)) return ok(`A clínica não atende em ${WEEKDAYS_SHORT[new Date(date + 'T12:00:00Z').getUTCDay()]}, ${fmtDate(date + 'T12:00:00Z', c.tz)}.`);
  const slots = slotsForDate(date, c.company, await dayAppointments(c, date), duration, new Date(), slotOpts(c, svc?.id, pro?.id));
  const label = `${svc?.name ?? 'consulta'} (${duration} min)${pro ? ` com ${pro.name}` : ''}`;
  if (!slots.length) return ok(`Não há horários livres em ${fmtDate(date + 'T12:00:00Z', c.tz)} para ${label}. Sugira outro dia${pro ? ' ou outro profissional' : ''}.`);
  const who = (x: { pros: string[] }) => (c.professionals.length > 1 && !pro ? ` (${x.pros.map((id) => shortPro(proName(c, id))).join('/')})` : '');
  return ok(`Horários livres em ${WEEKDAYS_SHORT[new Date(date + 'T12:00:00Z').getUTCDay()]} ${fmtDate(date + 'T12:00:00Z', c.tz)} para ${label}: ${slots.map((x) => `${x.time}${who(x)}`).join(', ')}.`);
}

async function book(c: AgentCtx, input: Record<string, unknown>): Promise<ToolResult> {
  const blocked = canWrite(c); if (blocked) return blocked;
  const date = s(input.data), time = s(input.hora);
  if (!DATE.test(date) || !TIME.test(time)) return err('Informe data (AAAA-MM-DD) e hora (HH:MM).');
  let contact = c.contact ?? null;
  if (c.mode === 'dono') {
    contact = input.cliente_id ? await contactById(c, input.cliente_id) : null;
    if (input.cliente_id && !contact) return err('Cliente não encontrado. Use buscar_clientes para achar o id.');
  }
  const svc = input.servico_id ? service(c, input.servico_id) : undefined;
  if (c.mode === 'cliente' && !svc) return err('Escolha um procedimento da lista (servico_id).');
  if (input.servico_id && !svc) return err('Procedimento não encontrado: use um id da lista.');
  const pro = input.profissional_id ? professional(c, input.profissional_id) : undefined;
  if (input.profissional_id && !pro) return err('Profissional não encontrado: use um id da lista de profissionais.');
  const ins = insuranceOf(c, input.convenio);
  if (ins.error) return err(ins.error);
  const duration = Math.max(10, Number(input.duracao_min) || svc?.duration_min || c.company.slot_minutes);
  const start = at(c, date, time);
  const end = new Date(start.getTime() + duration * 60000);
  const force = c.mode === 'dono' && input.encaixar === true;
  let proId: string | null = pro?.id ?? null;
  if (!force) {
    const free = isFree(start.toISOString(), duration, c.company, await dayAppointments(c, date), new Date(), slotOpts(c, svc?.id, pro?.id));
    if (!free.ok) return err(`${free.reason} Consulte os horários livres e ofereça outra opção${c.mode === 'dono' ? ' (ou use encaixar: true se a pessoa quiser marcar mesmo assim)' : ''}.`);
    proId = free.professionalId ?? proId;
  } else if (!proId && c.professionals.length === 1) proId = c.professionals[0].id;
  if (c.mode === 'cliente' && contact) {
    const patch: Record<string, unknown> = {};
    const name = s(input.nome, 120), address = s(input.endereco, 300);
    if (name && fold(name) !== fold(contact.name)) patch.name = name;
    if (address) patch.address = address;
    if (ins.name && contact.insurance !== ins.name) patch.insurance = ins.name;
    if (s(input.carteirinha, 40)) patch.insurance_card = s(input.carteirinha, 40);
    if (Object.keys(patch).length) { await db.from('contacts').update(patch).eq('id', contact.id); Object.assign(contact, patch); }
  }
  const pending = c.mode === 'cliente' && c.ai.booking_mode === 'confirmar';
  const { data: appt, error } = await db.from('appointments').insert({
    company_id: c.company.id, contact_id: contact?.id ?? null, service_id: svc?.id ?? null, title: svc?.name ?? (s(input.titulo, 120) || 'Atendimento'),
    starts_at: start.toISOString(), ends_at: end.toISOString(), status: pending ? 'pendente' : 'confirmado',
    address: s(input.endereco, 300) || null, notes: s(input.observacoes, 1000) || null,
    price: svc && svc.price_type !== 'sob_consulta' && !ins.name ? svc.price : null, created_via: via(c),
    professional_id: proId, payment_kind: ins.name ? 'convenio' : 'particular', insurance: ins.name,
  }).select('*').single();
  if (error) return err(/horario_ocupado/.test(error.message) ? 'Esse horário acabou de ser ocupado. Consulte de novo e ofereça outro.' : `Não consegui agendar: ${error.message}`);
  const label = `${when(c, appt.starts_at)} · ${appt.title}${proId ? ` com ${proName(c, proId)}` : ''}${ins.name ? ` · ${ins.name}` : ''}`;
  // quem estava na lista de espera e conseguiu o horário sai da lista (encaixe concluído)
  if (contact && !sim(c)) await db.from('waitlist').update({ status: 'agendado', appointment_id: appt.id }).eq('company_id', c.company.id).eq('contact_id', contact.id).in('status', ['aguardando', 'oferecido']);
  await log(c, 'agendar', `Agendou ${contact?.name ?? appt.title} para ${fmtDate(appt.starts_at, c.tz).slice(0, 5)} às ${localTime(appt.starts_at, c.tz)} (${appt.title})${pending ? ', aguardando confirmação da equipe' : ''}`, 'appointment', appt.id);
  if (c.mode === 'cliente') await alert(c, 'agendamento', pending ? `Confirmar horário de ${firstName(contact?.name)}` : `${firstName(contact?.name)} marcou um horário`, label, '#/agenda');
  return ok(`Consulta marcada (${pending ? 'pendente de confirmação da equipe' : 'confirmada'}): ${label}. Id ${appt.id}.`,
    { tool: 'agendar_horario', label: pending ? 'Consulta reservada (aguardando a equipe)' : 'Consulta marcada', detail: label, status: 'ok', link: '#/agenda' });
}

async function myAppointments(c: AgentCtx): Promise<ToolResult> {
  const { data } = await db.from('appointments').select('*').eq('contact_id', c.contact!.id).gte('ends_at', new Date().toISOString()).not('status', 'in', '(cancelado,faltou)').order('starts_at').limit(10);
  const list = (data ?? []) as Appointment[];
  return ok(list.length ? list.map((a) => `[${a.id}] ${when(c, a.starts_at)} — ${a.title}${a.professional_id ? ` com ${proName(c, a.professional_id) ?? 'profissional'}` : ''} (${a.status}${a.patient_confirmed_at ? ', presença confirmada' : ''})`).join('\n') : 'O paciente não tem consultas marcadas.');
}

async function reschedule(c: AgentCtx, input: Record<string, unknown>): Promise<ToolResult> {
  const blocked = canWrite(c); if (blocked) return blocked;
  const appt = await appointmentFor(c, input.agendamento_id);
  if (!appt) return err('Horário não encontrado.');
  if (['cancelado', 'concluido', 'faltou'].includes(appt.status)) return err(`Esse horário está ${appt.status} e não pode ser remarcado.`);
  const date = s(input.data), time = s(input.hora);
  if (!DATE.test(date) || !TIME.test(time)) return err('Informe data (AAAA-MM-DD) e hora (HH:MM).');
  const duration = Math.round((Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60000);
  const start = at(c, date, time);
  const others = (await dayAppointments(c, date)).filter((a) => a.id !== appt.id);
  const pro = input.profissional_id ? professional(c, input.profissional_id) : undefined;
  if (input.profissional_id && !pro) return err('Profissional não encontrado.');
  let proId = pro?.id ?? appt.professional_id ?? null;
  if (!(c.mode === 'dono' && input.encaixar === true)) {
    // tenta manter o mesmo profissional; se ele não puder, qualquer um que faça o procedimento
    let free = isFree(start.toISOString(), duration, c.company, others, new Date(), slotOpts(c, appt.service_id, proId));
    if (!free.ok && !pro && proId) free = isFree(start.toISOString(), duration, c.company, others, new Date(), slotOpts(c, appt.service_id, null));
    if (!free.ok) return err(`${free.reason} Ofereça outra opção.`);
    proId = free.professionalId ?? proId;
  }
  const { error } = await db.from('appointments').update({ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + duration * 60000).toISOString(), reminder_sent_at: null, patient_confirmed_at: null, professional_id: proId }).eq('id', appt.id);
  if (error) return err(/horario_ocupado/.test(error.message) ? 'Esse horário acabou de ser ocupado.' : error.message);
  const label = `${when(c, start.toISOString())} · ${appt.title}${proId ? ` com ${proName(c, proId)}` : ''}`;
  await log(c, 'remarcar', `Remarcou ${appt.title} de ${fmtDate(appt.starts_at, c.tz).slice(0, 5)} ${localTime(appt.starts_at, c.tz)} para ${fmtDate(start, c.tz).slice(0, 5)} ${localTime(start, c.tz)}`, 'appointment', appt.id);
  if (c.mode === 'cliente') await alert(c, 'agendamento', `${firstName(c.contact?.name)} remarcou o horário`, label, '#/agenda');
  return ok(`Remarcado para ${label}.`, { tool: 'remarcar_horario', label: 'Horário remarcado', detail: label, status: 'ok', link: '#/agenda' });
}

async function cancelAppointmentNow(c: AgentCtx, appt: Appointment, reason: string): Promise<ToolResult> {
  const notes = [appt.notes, reason ? `Cancelado: ${reason}` : null].filter(Boolean).join('\n');
  await db.from('appointments').update({ status: 'cancelado', notes }).eq('id', appt.id);
  const label = `${when(c, appt.starts_at)} · ${appt.title}`;
  await log(c, 'cancelar_agendamento', `Cancelou o horário de ${fmtDate(appt.starts_at, c.tz).slice(0, 5)} às ${localTime(appt.starts_at, c.tz)} (${appt.title})${reason ? ` — ${reason}` : ''}`, 'appointment', appt.id);
  if (c.mode === 'cliente') await alert(c, 'agendamento', `${firstName(c.contact?.name)} cancelou o horário`, `${label}${reason ? ` · ${reason}` : ''}`, '#/agenda');
  return ok(`Horário cancelado: ${label}.`, { tool: 'cancelar_horario', label: 'Horário cancelado', detail: label, status: 'ok', link: '#/agenda' });
}

/* ---------- lista de espera ---------- */
const PERIODS = ['manha', 'tarde', 'noite', 'qualquer'];
const PERIOD_TEXT: Record<string, string> = { manha: 'de manhã', tarde: 'à tarde', noite: 'à noite', qualquer: 'em qualquer horário' };

async function joinWaitlist(c: AgentCtx, contact: Contact, input: Record<string, unknown>): Promise<ToolResult> {
  const blocked = canWrite(c); if (blocked) return blocked;
  const date = s(input.data);
  if (date && !DATE.test(date)) return err('Use a data no formato AAAA-MM-DD (ou deixe vazio para qualquer dia).');
  const svc = input.servico_id ? service(c, input.servico_id) : undefined;
  if (input.servico_id && !svc) return err('Serviço não encontrado: use um id da lista.');
  const period = PERIODS.includes(s(input.periodo)) ? s(input.periodo) : 'qualquer';
  const row = { company_id: c.company.id, contact_id: contact.id, service_id: svc?.id ?? null, desired_date: date || null, period, notes: s(input.observacoes, 500) || null, created_via: via(c) };
  if (sim(c)) return ok(`(Simulador) ${contact.name} entraria na lista de espera ${date ? `para ${fmtDate(date + 'T12:00:00Z', c.tz).slice(0, 5)}` : 'para o primeiro horário'} ${PERIOD_TEXT[period]}.`, { tool: 'entrar_lista_espera', label: 'Cliente na lista de espera', detail: `${contact.name}${date ? ` · ${fmtDate(date + 'T12:00:00Z', c.tz).slice(0, 5)}` : ''}`, status: 'ok', link: '#/agenda' });
  const { data: open } = await db.from('waitlist').select('id').eq('company_id', c.company.id).eq('contact_id', contact.id).in('status', ['aguardando', 'oferecido']).maybeSingle();
  const { error } = open ? await db.from('waitlist').update({ ...row, status: 'aguardando', offered_at: null, offered_starts_at: null }).eq('id', open.id) : await db.from('waitlist').insert(row);
  if (error) return err(`Não consegui colocar na lista: ${error.message}`);
  const detail = `${contact.name}${date ? ` · ${fmtDate(date + 'T12:00:00Z', c.tz).slice(0, 5)}` : ''} · ${PERIOD_TEXT[period]}${svc ? ` · ${svc.name}` : ''}`;
  await log(c, 'lista_espera', `Colocou ${contact.name} na lista de espera (${detail})`, 'contact', contact.id);
  if (c.mode === 'cliente') await alert(c, 'agendamento', `${firstName(contact.name)} entrou na lista de espera`, detail, '#/agenda');
  return ok(`${contact.name} está na lista de espera. Se abrir um horário que sirva, a ORBYTA avisa pelo WhatsApp na hora.`, { tool: 'entrar_lista_espera', label: 'Cliente na lista de espera', detail, status: 'ok', link: '#/agenda' });
}

/* ---------- orçamentos ---------- */
interface ItemIn { servico_id?: string; descricao?: string; quantidade?: number; valor_unitario?: number | string }

async function createQuote(c: AgentCtx, input: Record<string, unknown>, confirmed = false): Promise<ToolResult> {
  const blocked = canWrite(c); if (blocked) return blocked;
  if (c.mode === 'cliente' && !c.ai.can_quote) return err('A empresa prefere que a equipe faça os orçamentos: chame a equipe.');
  const contact = c.mode === 'cliente' ? c.contact! : await contactById(c, input.cliente_id);
  if (!contact) return err('Cliente não encontrado. Use buscar_clientes (ou cadastrar_cliente) para ter o id.');
  const raw = Array.isArray(input.itens) ? (input.itens as ItemIn[]) : [];
  if (!raw.length || raw.length > 30) return err('Informe de 1 a 30 itens.');
  const items: { service_id: string | null; description: string; qty: number; unit_price: number }[] = [];
  for (const it of raw) {
    const svc = it.servico_id ? service(c, it.servico_id) : undefined;
    if (it.servico_id && !svc) return err(`Serviço ${it.servico_id} não encontrado na tabela.`);
    const qty = Math.min(1000, Math.max(0.01, Number(it.quantidade) || 1));
    let price: number;
    if (c.mode === 'cliente') {
      if (!svc) return err('Para o paciente, use só serviços da tabela (servico_id).');
      if (svc.price_type === 'sob_consulta') return err(`${svc.name} é sob consulta: não dá para orçar sem avaliação. Chame a equipe.`);
      price = svc.price;
    } else {
      price = it.valor_unitario != null && it.valor_unitario !== '' ? money(it.valor_unitario) : svc && svc.price_type !== 'sob_consulta' ? svc.price : NaN;
      if (!Number.isFinite(price) || price < 0) return err(`Falta o valor de "${svc?.name ?? it.descricao ?? 'item'}". Pergunte quanto cobrar.`);
    }
    items.push({ service_id: svc?.id ?? null, description: s(it.descricao, 300) || svc?.name || 'Item', qty, unit_price: Math.round(price * 100) / 100 });
  }
  const subtotal = items.reduce((t, i) => t + Math.round(i.qty * i.unit_price * 100) / 100, 0);
  const pct = Math.max(0, Number(input.desconto_percentual) || 0);
  let discount = Math.max(0, money(input.desconto_valor) || 0);
  if (pct) discount = Math.round(subtotal * pct) / 100;
  discount = Math.min(discount, subtotal);
  const pctEff = subtotal ? (discount / subtotal) * 100 : 0;
  const limit = Number(c.ai.max_discount_pct) || 0;
  if (pctEff > limit + 0.001) {
    if (c.mode === 'cliente') return err(`Desconto acima do permitido (${limit}%). Chame a equipe para negociar.`);
    if (!confirmed) return askConfirmation(c, 'criar_orcamento', { ...input, cliente_id: contact.id }, `Orçamento para ${contact.name} de ${brl(subtotal - discount)} com ${Math.round(pctEff)}% de desconto (acima do limite de ${limit}%)`);
  }
  const days = Math.min(90, Math.max(1, Number(input.validade_dias) || 7));
  const title = items.length === 1 ? items[0].description : `${items[0].description} e mais ${items.length - 1}`;
  const { data: q, error } = await db.from('quotes').insert({
    company_id: c.company.id, contact_id: contact.id, title: title.slice(0, 120), status: 'rascunho', notes: s(input.observacoes, 1000) || null,
    valid_until: addDays(localDate(new Date(), c.tz), days), created_via: via(c),
  }).select('id').single();
  if (error) return err(`Não consegui criar o orçamento: ${error.message}`);
  const { error: ie } = await db.from('quote_items').insert(items.map((i, idx) => ({ ...i, quote_id: q.id, company_id: c.company.id, sort: idx })));
  if (ie) { await db.from('quotes').delete().eq('id', q.id); return err(`Não consegui salvar os itens: ${ie.message}`); }
  // aplica o desconto depois dos itens (o banco recalcula subtotal e total) e marca como enviado no modo paciente
  const { data: full } = await db.from('quotes').update({ discount, status: c.mode === 'cliente' ? 'enviado' : 'rascunho' }).eq('id', q.id).select('*').single();
  const link = quoteLink(c, full);
  const label = `nº ${quoteNo(full.number)} · ${brl(full.total)}`;
  await log(c, 'criar_orcamento', `Criou o orçamento nº ${quoteNo(full.number)} de ${brl(full.total)} para ${contact.name}`, 'quote', full.id);
  if (c.mode === 'cliente') await alert(c, 'orcamento', `A IA enviou um orçamento para ${firstName(contact.name)}`, label, `#/orcamentos/${full.id}`);
  const receipt: ActionReceipt = { tool: 'criar_orcamento', label: `Orçamento nº ${quoteNo(full.number)} de ${brl(full.total)} criado`, detail: `${contact.name}${discount ? ` · desconto de ${brl(discount)}` : ''}`, status: 'ok', link: `#/orcamentos/${full.id}` };
  if (c.mode === 'dono' && input.enviar === true) {
    const r = await sendQuote(c, full.id, { type: 'ia', name: actor(c).actor_name, userId: c.member?.userId, channel: 'ia_dono' });
    return ok(`Orçamento ${label} criado para ${contact.name}. ${r.sent ? 'Enviado ao paciente pelo WhatsApp.' : `Não foi enviado: ${r.reason} Link para mandar manualmente: ${link}`}`,
      { ...receipt, label: `${receipt.label}${r.sent ? ' e enviado' : ''}` });
  }
  return ok(`Orçamento ${label} criado para ${contact.name}. Validade: ${days} dias. Link para o paciente aprovar: ${link}${c.mode === 'dono' ? ' (use enviar_orcamento para mandar pelo WhatsApp)' : ' — mande este link ao paciente.'}`, receipt);
}

/* ---------- vendas, serviços e mensagens (executam depois da confirmação) ---------- */
const METHODS: PayMethod[] = ['pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro'];

export const EXECUTORS: Record<string, (c: AgentCtx, a: Record<string, unknown>) => Promise<ToolResult>> = {
  async registrar_venda(c, a) {
    const blocked = canWrite(c); if (blocked) return blocked;
    const amount = Math.round(money(a.valor) * 100) / 100;
    if (!(amount > 0)) return err('Valor inválido.');
    const contact = a.cliente_id ? await contactById(c, a.cliente_id) : null;
    let origin: 'ia' | 'equipe' | 'balcao' = contact ? 'equipe' : 'balcao';
    let quoteId: string | null = null;
    if (a.orcamento_id) {
      const { data: q } = await db.from('quotes').select('id, created_via, number').eq('company_id', c.company.id).eq('id', s(a.orcamento_id)).maybeSingle();
      if (q) { quoteId = q.id; if (q.created_via === 'ia_cliente') origin = 'ia'; }
    }
    const { data: sale, error } = await db.from('sales').insert({
      company_id: c.company.id, contact_id: contact?.id ?? null, quote_id: quoteId, description: s(a.descricao, 300) || 'Venda',
      amount, method: METHODS.includes(a.metodo as PayMethod) ? a.metodo : 'pix', origin, created_via: 'ia_dono',
    }).select('*').single();
    if (error) return err(`Não consegui registrar: ${error.message}`);
    if (quoteId) await db.from('quotes').update({ status: 'aprovado' }).eq('id', quoteId).in('status', ['rascunho', 'enviado']);
    await log(c, 'registrar_venda', `Registrou venda de ${brl(amount)} (${sale.method})${contact ? ` para ${contact.name}` : ''}`, 'sale', sale.id);
    return ok(`Venda de ${brl(amount)} registrada${contact ? ` para ${contact.name}` : ''}.`, { tool: 'registrar_venda', label: `Venda de ${brl(amount)} registrada`, detail: `${sale.method.replace('_', ' ')}${contact ? ` · ${contact.name}` : ''}`, status: 'ok', link: '#/vendas' });
  },
  async cancelar_horario(c, a) {
    const appt = await appointmentFor(c, a.agendamento_id);
    if (!appt) return err('Horário não encontrado.');
    if (appt.status === 'cancelado') return ok('Esse horário já estava cancelado.');
    const r = await cancelAppointmentNow(c, appt, s(a.motivo, 200));
    if (a.avisar_cliente === true && appt.contact_id) {
      const contact = await contactById(c, appt.contact_id);
      if (contact) {
        const sent = await deliverToContact(c, contact, `Olá, ${firstName(contact.name)}! Precisamos cancelar o seu horário de ${when(c, appt.starts_at)} (${appt.title}). Se quiser, me responda aqui que remarcamos.`, { sender: 'ia', senderName: c.ai.assistant_name || 'IA', template: null });
        r.content += sent.sent ? ' Paciente avisado pelo WhatsApp.' : ` O paciente não foi avisado: ${sent.reason}`;
      }
    }
    return r;
  },
  async atualizar_servico(c, a) {
    const svc = service(c, a.servico_id);
    if (!svc) return err('Serviço não encontrado.');
    const patch: Partial<Service> = {};
    if (a.preco != null && a.preco !== '') patch.price = money(a.preco);
    if (a.tipo_preco && ['fixo', 'a_partir_de', 'sob_consulta'].includes(String(a.tipo_preco))) patch.price_type = a.tipo_preco as Service['price_type'];
    if (typeof a.ativo === 'boolean') patch.active = a.ativo;
    if (s(a.nome)) patch.name = s(a.nome, 120);
    if (Number(a.duracao_min) > 0) patch.duration_min = Math.round(Number(a.duracao_min));
    const { error } = await db.from('services').update(patch).eq('id', svc.id);
    if (error) return err(error.message);
    const parts = [patch.price != null ? `preço ${brl(svc.price)} → ${brl(patch.price)}` : '', patch.active === false ? 'desativado' : patch.active === true ? 'reativado' : '', patch.name ? `novo nome "${patch.name}"` : '', patch.duration_min ? `duração ${patch.duration_min} min` : '', patch.price_type ? `tipo ${patch.price_type}` : ''].filter(Boolean).join(', ');
    await log(c, 'atualizar_servico', `Alterou o serviço ${svc.name}: ${parts}`, 'service', svc.id);
    Object.assign(svc, patch);
    return ok(`Serviço ${svc.name} atualizado: ${parts}.`, { tool: 'atualizar_servico', label: `Serviço ${svc.name} atualizado`, detail: parts, status: 'ok', link: '#/catalogo' });
  },
  async mensagem_para_cliente(c, a) {
    const contact = await contactById(c, a.cliente_id);
    if (!contact) return err('Cliente não encontrado.');
    const text = s(a.mensagem, 2000);
    const r = await deliverToContact(c, contact, text, { sender: 'equipe', senderName: c.member?.name ?? 'Equipe', template: null });
    if (!r.sent) return err(`Não foi enviada: ${r.reason}`);
    await log(c, 'mensagem_para_cliente', `Mandou mensagem para ${contact.name}: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`, 'contact', contact.id);
    return ok(`Mensagem enviada para ${contact.name}.`, { tool: 'mensagem_para_cliente', label: `Mensagem enviada para ${contact.name}`, detail: text.slice(0, 80), status: 'ok' });
  },
  async criar_orcamento(c, a) { return createQuote(c, a, true); },
  async cobrar_cliente(c, a) {
    const blocked = canWrite(c); if (blocked) return blocked;
    try {
      const r = await createCharge(c, { contactId: s(a.cliente_id), amount: money(a.valor), description: s(a.descricao, 300) || 'Serviço', dueDate: DATE.test(s(a.vencimento)) ? s(a.vencimento) : addDays(localDate(new Date().toISOString(), c.tz), 3), method: (['pix', 'boleto'].includes(String(a.forma)) ? a.forma : 'pix_boleto') as 'pix', document: s(a.cpf_cnpj, 20) || null, send: a.enviar !== false && !sim(c) }, iaActor(c));
      const ch = r.charge;
      return ok(`Cobrança de ${brl(ch.amount)} criada. Link: ${ch.invoice_url}.${r.sent ? ' Enviada ao paciente pelo WhatsApp.' : r.reason ? ` Não enviei pelo WhatsApp: ${r.reason}` : ''}`,
        { tool: 'cobrar_cliente', label: `Cobrança de ${brl(ch.amount)} criada`, detail: `${ch.description}${r.sent ? ' · enviada no WhatsApp' : ''}`, status: 'ok', link: '#/cobrancas' });
    } catch (e) { return err(e instanceof ProviderError ? e.friendly : (e as Error).message); }
  },
  async emitir_nota(c, a) {
    const blocked = canWrite(c); if (blocked) return blocked;
    const contact = a.cliente_id ? await contactById(c, a.cliente_id) : null;
    if (!contact) return err('Cliente não encontrado.');
    try {
      const n = await emitNote(c, { contactId: contact.id, saleId: s(a.venda_id) || null, amount: money(a.valor), description: s(a.descricao, 2000) || 'Prestação de serviço', taker: { name: contact.name, document: s(a.cpf_cnpj, 20) || contact.document || null, email: contact.email } }, iaActor(c));
      return ok(`Nota de ${brl(n.amount)} enviada para a prefeitura (situação: ${n.status}). Avisamos no painel quando for autorizada.`, { tool: 'emitir_nota', label: n.status === 'autorizada' ? `Nota nº ${n.number} autorizada` : 'Nota fiscal em emissão', detail: `${contact.name} · ${brl(n.amount)}`, status: n.status === 'erro' ? 'erro' : 'ok', link: '#/cobrancas?aba=notas' });
    } catch (e) { return err(e instanceof ProviderError ? e.friendly : (e as Error).message); }
  },
  async baixar_conta(c, a) {
    const blocked = canWrite(c); if (blocked) return blocked;
    const { data: e } = await db.from('finance_entries').select('*').eq('company_id', c.company.id).eq('id', s(a.conta_id)).maybeSingle();
    if (!e) return err('Conta não encontrada.');
    if (e.paid_at) return ok(`Essa conta já estava ${e.kind === 'pagar' ? 'paga' : 'recebida'}.`);
    const method = METHODS.includes(a.metodo as PayMethod) ? a.metodo : 'pix';
    const { error } = await db.from('finance_entries').update({ paid_at: new Date().toISOString(), method }).eq('id', e.id);
    if (error) return err(error.message);
    const verb = e.kind === 'pagar' ? 'paga' : 'recebida';
    await log(c, 'baixar_conta', `Marcou como ${verb}: ${e.description} (${brl(Number(e.amount))})`, 'finance', e.id);
    return ok(`${e.description} marcada como ${verb}${e.recurrence === 'mensal' ? '. A do próximo mês já ficou lançada' : ''}.`, { tool: 'baixar_conta', label: `Conta ${verb}`, detail: `${e.description} · ${brl(Number(e.amount))}`, status: 'ok', link: '#/financeiro' });
  },
};

/* ---------- definições ---------- */
type T = Tool<AgentCtx>;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const date = str('Data no formato AAAA-MM-DD.');
const hour = str('Hora no formato HH:MM (24h).');

const consultarHorarios: T = {
  name: 'consultar_horarios',
  description: 'Lista os horários livres de um dia, respeitando o horário da clínica, a agenda de cada profissional e a duração do procedimento. Use sempre antes de oferecer ou marcar uma consulta.',
  input_schema: obj({ data: date, servico_id: str('Id do procedimento (para a duração e os profissionais certos). Opcional.'), profissional_id: str('Id do profissional, se o paciente pediu alguém. Opcional.') }, ['data']),
  run: (i, c) => freeSlots(c, i),
};

export const CUSTOMER_TOOLS: T[] = [
  consultarHorarios,
  {
    name: 'agendar_horario',
    description: 'Marca uma consulta para o paciente desta conversa. Antes, confirme com ele o procedimento, a data e a hora e tenha o nome. Sem profissional_id, a agenda escolhe quem estiver livre.',
    input_schema: obj({ servico_id: str('Id do procedimento da tabela.'), data: date, hora: hour, profissional_id: str('Id do profissional, se o paciente escolheu.'), convenio: str('Nome do convênio, se for por convênio (vazio = particular).'), carteirinha: str('Número da carteirinha do convênio, se informado.'), nome: str('Nome do paciente, se ele informou.'), observacoes: str('Detalhes administrativos para a equipe (ex.: "consulta para o filho, Pedro, 8 anos"). Nada de sintomas.') }, ['servico_id', 'data', 'hora']),
    run: (i, c) => book(c, i),
  },
  {
    name: 'meus_horarios',
    description: 'Lista as próximas consultas do paciente desta conversa (com os ids).',
    input_schema: obj({}),
    run: (_i, c) => myAppointments(c),
  },
  {
    name: 'remarcar_horario',
    description: 'Muda a data e a hora de uma consulta do paciente desta conversa (mantém o profissional quando possível). Consulte os horários livres antes.',
    input_schema: obj({ agendamento_id: str('Id da consulta (de meus_horarios).'), data: date, hora: hour, profissional_id: str('Outro profissional, se o paciente pediu.') }, ['agendamento_id', 'data', 'hora']),
    run: (i, c) => reschedule(c, i),
  },
  {
    name: 'cancelar_horario',
    description: 'Desmarca uma consulta do paciente desta conversa, quando ele pedir. O horário vai para a lista de espera.',
    input_schema: obj({ agendamento_id: str('Id do horário.'), motivo: str('Motivo informado pelo paciente.') }, ['agendamento_id']),
    run: async (i, c) => {
      const blocked = canWrite(c); if (blocked) return blocked;
      const appt = await appointmentFor(c, i.agendamento_id);
      if (!appt) return err('Horário não encontrado entre os do paciente.');
      if (appt.status !== 'confirmado' && appt.status !== 'pendente') return err(`Esse horário está ${appt.status}.`);
      return cancelAppointmentNow(c, appt, s(i.motivo, 200));
    },
  },
  {
    name: 'confirmar_presenca',
    description: 'Registra que o paciente confirmou que vai comparecer a uma consulta (por exemplo, respondendo SIM ao lembrete).',
    input_schema: obj({ agendamento_id: str('Id do horário confirmado.') }, ['agendamento_id']),
    run: async (i, c) => {
      const appt = await appointmentFor(c, i.agendamento_id);
      if (!appt) return err('Horário não encontrado entre os do paciente.');
      if (appt.status === 'cancelado') return err('Esse horário foi cancelado.');
      await db.from('appointments').update({ status: appt.status === 'pendente' && c.ai.booking_mode !== 'confirmar' ? 'confirmado' : appt.status, patient_confirmed_at: new Date().toISOString() }).eq('id', appt.id);
      const label = `${when(c, appt.starts_at)} · ${appt.title}`;
      await log(c, 'confirmar_presenca', `${c.contact?.name ?? 'O paciente'} confirmou presença em ${label}`, 'appointment', appt.id);
      return ok(`Presença confirmada: ${label}.`, { tool: 'confirmar_presenca', label: 'Paciente confirmou presença', detail: label, status: 'ok', link: '#/agenda' });
    },
  },
  {
    name: 'criar_orcamento',
    description: 'Cria um orçamento para o paciente desta conversa com serviços da tabela (preço da tabela) e devolve o link para ele aprovar. Mande o link na resposta.',
    input_schema: obj({
      itens: { type: 'array', description: 'Serviços do orçamento.', items: obj({ servico_id: str('Id do serviço da tabela.'), quantidade: { type: 'number', description: 'Quantidade (padrão 1).' }, descricao: str('Detalhe do item, opcional.') }, ['servico_id']) },
      desconto_percentual: { type: 'number', description: 'Desconto em %, só se o paciente pediu e dentro do limite da empresa.' },
      observacoes: str('Observações que aparecem no orçamento.'),
    }, ['itens']),
    run: (i, c) => createQuote(c, i),
  },
  {
    name: 'atualizar_cadastro',
    description: 'Atualiza a ficha do paciente desta conversa (nome, e-mail, CPF, nascimento, convênio, carteirinha, responsável, endereço) ou anota uma observação administrativa para a equipe. Nunca anote sintomas.',
    input_schema: obj({ nome: str('Nome completo.'), email: str('E-mail.'), cpf: str('CPF (só números ou com pontos).'), nascimento: str('Data de nascimento AAAA-MM-DD.'), convenio: str('Convênio (vazio = particular).'), carteirinha: str('Número da carteirinha.'), responsavel: str('Nome do responsável, se o paciente é menor de idade.'), endereco: str('Endereço.'), observacao: str('Observação administrativa para a equipe.') }),
    run: async (i, c) => {
      const patch: Record<string, unknown> = {};
      if (s(i.nome)) patch.name = s(i.nome, 120);
      if (s(i.email)) patch.email = s(i.email, 200);
      const cpf = s(i.cpf).replace(/\D/g, '');
      if (cpf) { if (cpf.length !== 11) return err('CPF precisa ter 11 números.'); patch.document = cpf; }
      if (s(i.nascimento)) { if (!DATE.test(s(i.nascimento))) return err('Data de nascimento no formato AAAA-MM-DD.'); patch.birthday = s(i.nascimento); }
      if (s(i.convenio)) { const ins = insuranceOf(c, i.convenio); if (ins.error) return err(ins.error); patch.insurance = ins.name; }
      if (s(i.carteirinha)) patch.insurance_card = s(i.carteirinha, 40);
      if (s(i.responsavel)) patch.guardian_name = s(i.responsavel, 120);
      if (s(i.endereco)) patch.address = s(i.endereco, 300);
      if (s(i.observacao)) patch.notes = [c.contact!.notes, `${fmtDate(new Date(), c.tz)}: ${s(i.observacao, 500)}`].filter(Boolean).join('\n');
      if (!Object.keys(patch).length) return err('Nada para atualizar.');
      await db.from('contacts').update(patch).eq('id', c.contact!.id);
      Object.assign(c.contact!, patch);
      return ok('Ficha atualizada.', { tool: 'atualizar_cadastro', label: 'Ficha do paciente atualizada', detail: Object.keys(patch).map((k) => ({ name: 'nome', email: 'e-mail', address: 'endereço', notes: 'observação', document: 'CPF', birthday: 'nascimento', insurance: 'convênio', insurance_card: 'carteirinha', guardian_name: 'responsável' }[k] ?? k)).join(', '), status: 'ok' });
    },
  },
  {
    name: 'entrar_lista_espera',
    description: 'Coloca o paciente desta conversa na lista de espera quando não há horário que sirva. Se alguém desmarcar, a clínica oferece o horário pelo WhatsApp.',
    input_schema: obj({ data: str('Dia desejado AAAA-MM-DD (vazio = o primeiro horário que abrir).'), periodo: { type: 'string', enum: PERIODS, description: 'Período preferido.' }, servico_id: str('Id do serviço, se já escolheu.'), observacoes: str('Detalhes (ex.: "pode ir depois das 17h").') }),
    run: (i, c) => joinWaitlist(c, c.contact!, i),
  },
  {
    name: 'chamar_atendente',
    description: 'Passa a conversa para uma pessoa da equipe e para de responder. Use quando o paciente pedir, reclamar, trouxer assunto clínico ou urgência, pedir desconto acima do limite, ou quando você não tiver certeza.',
    input_schema: obj({ motivo: str('Motivo curto, para a equipe entender sem ler tudo (ex.: "Pediu 20% de desconto").') }, ['motivo']),
    run: async (i, c) => {
      const reason = s(i.motivo, 160) || 'Pediu atendimento humano';
      await db.from('conversations').update({ handler: 'humano', needs_attention: true, attention_reason: reason }).eq('id', c.conversationId);
      await log(c, 'chamar_atendente', `Passou o atendimento de ${c.contact?.name ?? 'cliente'} para a equipe: ${reason}`, 'conversation', c.conversationId);
      if (!sim(c)) await alertTeamOnWhatsApp(c, `🔔 ${firstName(c.contact?.name) || 'Um cliente'} precisa de atendimento: ${reason}.${c.origin ? ` Responda pelo painel: ${c.origin}/app/#/conversas/${c.conversationId}` : ''}`);
      return ok('Equipe avisada. Diga ao paciente, em uma frase, que alguém da equipe vai continuar o atendimento em breve. Não use mais ferramentas.',
        { tool: 'chamar_atendente', label: 'Atendimento passado para a equipe', detail: reason, status: 'ok', link: `#/conversas/${c.conversationId}` });
    },
  },
];

/** Última mensagem que a pessoa da equipe mandou pelo WhatsApp (para saber se a janela de 24h está aberta). */
export async function lastOwnerWhatsApp(companyId: string, userId: string): Promise<string | null> {
  const { data: conv } = await db.from('conversations').select('id').eq('company_id', companyId).eq('kind', 'dono').eq('member_user_id', userId).maybeSingle();
  if (!conv) return null;
  const { data } = await db.from('messages').select('created_at').eq('conversation_id', conv.id).eq('direction', 'in').eq('channel', 'whatsapp').order('created_at', { ascending: false }).limit(1);
  return data?.[0]?.created_at ?? null;
}

const reasonOf = (text: string) => (text.match(/atendimento: (.*?)\.( Responda|$)/)?.[1] ?? 'veja no painel').slice(0, 120);

/** Avisa no WhatsApp quem tem número verificado (dono e gerentes): texto na janela de 24 horas, modelo fora dela. */
async function alertTeamOnWhatsApp(c: AgentCtx, text: string) {
  try {
    const acc = await loadAccount(c.company.id);
    if (!acc) return;
    const { data: people } = await db.from('members').select('user_id, phone').eq('company_id', c.company.id).eq('active', true).in('role', ['dono', 'gerente']).not('phone_verified_at', 'is', null);
    for (const p of people ?? []) {
      if (!p.phone) continue;
      if (withinWindow(await lastOwnerWhatsApp(c.company.id, p.user_id))) await sendText(acc, p.phone, text);
      else await sendTemplate(acc, p.phone, TEMPLATES.avisoEquipe.name, [`${firstName(c.contact?.name) || 'Um cliente'} precisa de atendimento (${reasonOf(text)})`]).catch((e) => console.error('aviso por modelo', e.message));
    }
  } catch (e) { console.error('aviso à equipe', e); }
}

export const OWNER_TOOLS: T[] = [
  {
    name: 'buscar_clientes',
    description: 'Procura pacientes pelo nome, telefone ou e-mail. Devolve id, nome, telefone, convênio e nascimento.',
    input_schema: obj({ busca: str('Nome, parte do nome ou telefone.') }, ['busca']),
    run: async (i, c) => {
      const term = s(i.busca, 80).replace(/[%,()]/g, ' ').trim();
      if (!term) return err('Informe o que procurar.');
      const digits = term.replace(/\D/g, '');
      const ors = [`name.ilike.%${term}%`, `email.ilike.%${term}%`];
      if (digits.length >= 4) ors.push(`phone.ilike.%${digits}%`);
      const { data } = await db.from('contacts').select('id, name, phone, stage, insurance, birthday, total_spent').eq('company_id', c.company.id).or(ors.join(',')).order('last_interaction_at', { ascending: false, nullsFirst: false }).limit(8);
      const list = (data ?? []) as Contact[];
      return ok(list.length ? list.map((x) => `[${x.id}] ${x.name}${x.phone ? ` · ${formatPhone(x.phone)}` : ''}${x.insurance ? ` · ${x.insurance}` : ' · particular'}${x.birthday ? ` · nasc. ${fmtDate(x.birthday + 'T12:00:00Z', c.tz)}` : ''}`).join('\n') : `Nenhum paciente encontrado para "${term}".`);
    },
  },
  {
    name: 'cadastrar_cliente',
    description: 'Cadastra um paciente novo. Se já existir alguém com o mesmo telefone, devolve esse cadastro.',
    input_schema: obj({ nome: str('Nome do paciente.'), telefone: str('Telefone com DDD.'), email: str('E-mail.'), nascimento: str('Data de nascimento AAAA-MM-DD.'), convenio: str('Convênio (vazio = particular).'), carteirinha: str('Número da carteirinha.'), responsavel: str('Responsável, se menor de idade.'), observacoes: str('Anotações administrativas.') }, ['nome']),
    run: async (i, c) => {
      const blocked = canWrite(c); if (blocked) return blocked;
      const name = s(i.nome, 120);
      if (name.length < 2) return err('Informe o nome do paciente.');
      const ins = insuranceOf(c, i.convenio);
      if (ins.error) return err(ins.error);
      if (s(i.nascimento) && !DATE.test(s(i.nascimento))) return err('Data de nascimento no formato AAAA-MM-DD.');
      const phone = normalizePhone(s(i.telefone, 40)) || null;
      if (phone) {
        const { data: dup } = await db.from('contacts').select('id, name').eq('company_id', c.company.id).eq('phone', phone).maybeSingle();
        if (dup) return ok(`Já existe um paciente com esse telefone: [${dup.id}] ${dup.name}. Use esse cadastro.`);
      }
      const { data, error } = await db.from('contacts').insert({
        company_id: c.company.id, name, phone, email: s(i.email, 200) || null, notes: s(i.observacoes, 1000) || null, source: 'manual', created_via: 'ia_dono',
        birthday: s(i.nascimento) || null, insurance: ins.name, insurance_card: s(i.carteirinha, 40) || null, guardian_name: s(i.responsavel, 120) || null,
      }).select('id, name').single();
      if (error) return err(error.message);
      await log(c, 'cadastrar_cliente', `Cadastrou o paciente ${name}${phone ? ` (${formatPhone(phone)})` : ''}`, 'contact', data.id);
      return ok(`Paciente cadastrado: [${data.id}] ${name}.`, { tool: 'cadastrar_cliente', label: `Paciente ${firstName(name)} cadastrado`, detail: phone ? formatPhone(phone) : undefined, status: 'ok', link: `#/clientes/${data.id}` });
    },
  },
  {
    name: 'atualizar_cliente',
    description: 'Atualiza a ficha de um paciente: nome, telefone, e-mail, CPF, nascimento, convênio, carteirinha, responsável, endereço, anotações administrativas, etapa ou temperatura.',
    input_schema: obj({
      cliente_id: str('Id do paciente.'), nome: str('Nome.'), telefone: str('Telefone.'), email: str('E-mail.'), cpf: str('CPF.'), nascimento: str('Nascimento AAAA-MM-DD.'), convenio: str('Convênio ("particular" para tirar).'), carteirinha: str('Carteirinha.'), responsavel: str('Responsável.'), endereco: str('Endereço.'), observacoes: str('Anotações administrativas (substitui as atuais).'),
      etapa: { type: 'string', enum: ['novo', 'conversando', 'orcamento', 'fechado', 'perdido'] }, temperatura: { type: 'string', enum: ['quente', 'morno', 'frio'] },
    }, ['cliente_id']),
    run: async (i, c) => {
      const blocked = canWrite(c); if (blocked) return blocked;
      const contact = await contactById(c, i.cliente_id);
      if (!contact) return err('Paciente não encontrado.');
      const patch: Record<string, unknown> = {};
      if (s(i.nome)) patch.name = s(i.nome, 120);
      if (s(i.telefone)) patch.phone = normalizePhone(s(i.telefone, 40));
      if (s(i.email)) patch.email = s(i.email, 200);
      if (s(i.endereco)) patch.address = s(i.endereco, 300);
      const cpf = s(i.cpf).replace(/\D/g, '');
      if (cpf) { if (cpf.length !== 11) return err('CPF precisa ter 11 números.'); patch.document = cpf; }
      if (s(i.nascimento)) { if (!DATE.test(s(i.nascimento))) return err('Nascimento no formato AAAA-MM-DD.'); patch.birthday = s(i.nascimento); }
      if (s(i.convenio)) { const ins = insuranceOf(c, i.convenio); if (ins.error) return err(ins.error); patch.insurance = ins.name; }
      if (s(i.carteirinha)) patch.insurance_card = s(i.carteirinha, 40);
      if (s(i.responsavel)) patch.guardian_name = s(i.responsavel, 120);
      if (s(i.observacoes)) patch.notes = s(i.observacoes, 2000);
      if (i.etapa) patch.stage = i.etapa;
      if (i.temperatura) patch.temperature = i.temperatura;
      if (!Object.keys(patch).length) return err('Nada para atualizar.');
      const { error } = await db.from('contacts').update(patch).eq('id', contact.id);
      if (error) return err(/contacts_phone_uq/.test(error.message) ? 'Outro paciente já usa esse telefone.' : error.message);
      await log(c, 'atualizar_cliente', `Atualizou o cadastro de ${contact.name}`, 'contact', contact.id);
      return ok(`Cadastro de ${contact.name} atualizado.`, { tool: 'atualizar_cliente', label: `Cadastro de ${firstName(contact.name)} atualizado`, status: 'ok', link: `#/clientes/${contact.id}` });
    },
  },
  {
    name: 'criar_orcamento',
    description: 'Cria um orçamento para um paciente. Itens podem ser da tabela (servico_id, usa o preço da tabela) ou avulsos (descricao + valor_unitario). Use enviar: true para mandar ao paciente pelo WhatsApp na hora.',
    input_schema: obj({
      cliente_id: str('Id do paciente.'),
      itens: { type: 'array', description: 'Itens do orçamento.', items: obj({ servico_id: str('Id do serviço (opcional).'), descricao: str('Descrição do item.'), quantidade: { type: 'number' }, valor_unitario: { type: 'number', description: 'Valor por unidade em reais (obrigatório se o item não é da tabela ou é sob consulta).' } }) },
      desconto_valor: { type: 'number', description: 'Desconto em reais.' }, desconto_percentual: { type: 'number', description: 'Desconto em %.' },
      validade_dias: { type: 'number', description: 'Validade em dias (padrão 7).' }, observacoes: str('Observações.'), enviar: { type: 'boolean', description: 'Enviar ao paciente pelo WhatsApp agora.' },
    }, ['cliente_id', 'itens']),
    run: (i, c) => createQuote(c, i),
  },
  {
    name: 'enviar_orcamento',
    description: 'Envia um orçamento existente ao paciente pelo WhatsApp (pelo número do orçamento ou id).',
    input_schema: obj({ numero: { type: 'number', description: 'Número do orçamento (ex.: 412).' }, orcamento_id: str('Id do orçamento.') }),
    run: async (i, c) => {
      let q = db.from('quotes').select('id, number, status').eq('company_id', c.company.id);
      q = i.orcamento_id ? q.eq('id', s(i.orcamento_id)) : q.eq('number', Number(i.numero));
      const { data } = await q.maybeSingle();
      if (!data) return err('Orçamento não encontrado.');
      if (['aprovado', 'recusado'].includes(data.status)) return err(`O orçamento nº ${quoteNo(data.number)} já foi ${data.status}.`);
      const r = await sendQuote(c, data.id, { type: 'ia', name: actor(c).actor_name, userId: c.member?.userId, channel: 'ia_dono' });
      return r.sent
        ? ok(`Orçamento nº ${quoteNo(data.number)} enviado pelo WhatsApp.`, { tool: 'enviar_orcamento', label: `Orçamento nº ${quoteNo(data.number)} enviado`, status: 'ok', link: `#/orcamentos/${data.id}` })
        : err(`Não foi enviado: ${r.reason} Link para mandar manualmente: ${r.link}`);
    },
  },
  {
    name: 'listar_orcamentos',
    description: 'Lista orçamentos recentes, com filtro opcional por situação ou paciente.',
    input_schema: obj({ status: { type: 'string', enum: ['rascunho', 'enviado', 'aprovado', 'recusado', 'expirado'] }, cliente_id: str('Id do paciente.') }),
    run: async (i, c) => {
      let q = db.from('quotes').select('id, number, title, status, total, sent_at, created_at, contact:contacts(name)').eq('company_id', c.company.id).order('created_at', { ascending: false }).limit(12);
      if (i.status) q = q.eq('status', s(i.status));
      if (i.cliente_id) q = q.eq('contact_id', s(i.cliente_id));
      const { data } = await q;
      const list = (data ?? []) as unknown as { id: string; number: number; title: string | null; status: string; total: number; created_at: string; contact: { name: string } | null }[];
      return ok(list.length ? list.map((x) => `nº ${quoteNo(x.number)} [${x.id}] ${x.contact?.name ?? '—'} · ${x.title ?? ''} · ${brl(x.total)} · ${x.status} · ${fmtDate(x.created_at, c.tz)}`).join('\n') : 'Nenhum orçamento encontrado.');
    },
  },
  {
    name: 'consultar_agenda',
    description: 'Mostra as consultas marcadas num período (padrão: o dia informado), com profissional, convênio e se o paciente já confirmou. Filtre por profissional se pedirem.',
    input_schema: obj({ data_inicio: date, data_fim: str('Data final AAAA-MM-DD (opcional).'), profissional_id: str('Só a agenda deste profissional (opcional).') }, ['data_inicio']),
    run: async (i, c) => {
      const d0 = s(i.data_inicio), d1 = s(i.data_fim) || d0;
      if (!DATE.test(d0) || !DATE.test(d1)) return err('Use datas no formato AAAA-MM-DD.');
      const { data } = await db.from('appointments').select('*, contact:contacts(name, phone)').eq('company_id', c.company.id)
        .gte('starts_at', at(c, d0, '00:00').toISOString()).lt('starts_at', at(c, addDays(d1, 1), '00:00').toISOString()).neq('status', 'cancelado').order('starts_at').limit(80);
      const list = ((data ?? []) as unknown as (Appointment & { contact: { name: string } | null })[]).filter((a) => !i.profissional_id || a.professional_id === s(i.profissional_id));
      return ok(list.length ? list.map((a) => `[${a.id}] ${when(c, a.starts_at)} — ${a.contact?.name ?? '(sem paciente)'} · ${a.title}${a.professional_id ? ` · ${proName(c, a.professional_id) ?? ''}` : ''}${a.payment_kind === 'convenio' ? ` · ${a.insurance}` : ' · particular'} · ${a.status}${a.patient_confirmed_at ? ' · confirmou presença' : a.status === 'confirmado' || a.status === 'pendente' ? ' · ainda não confirmou' : ''}`).join('\n') : 'Nenhuma consulta marcada nesse período.');
    },
  },
  consultarHorarios,
  {
    name: 'lista_espera',
    description: 'Sem cliente_id: mostra quem está na lista de espera. Com cliente_id: coloca esse paciente na lista (avisamos quando abrir um horário).',
    input_schema: obj({ cliente_id: str('Id do paciente para adicionar (opcional).'), data: str('Dia desejado AAAA-MM-DD (opcional).'), periodo: { type: 'string', enum: PERIODS }, servico_id: str('Id do serviço (opcional).'), observacoes: str('Observações.') }),
    run: async (i, c) => {
      if (i.cliente_id) {
        const contact = await contactById(c, i.cliente_id);
        if (!contact) return err('Cliente não encontrado. Use buscar_clientes para achar o id.');
        return joinWaitlist(c, contact, i);
      }
      const { data } = await db.from('waitlist').select('*, contact:contacts(name), service:services(name)').eq('company_id', c.company.id).in('status', ['aguardando', 'oferecido']).order('created_at').limit(40);
      const list = (data ?? []) as unknown as { status: string; desired_date: string | null; period: string; contact: { name: string } | null; service: { name: string } | null; offered_starts_at: string | null }[];
      return ok(list.length ? list.map((w) => `• ${w.contact?.name ?? '—'} · ${w.desired_date ? fmtDate(w.desired_date + 'T12:00:00Z', c.tz).slice(0, 5) : 'qualquer dia'} ${PERIOD_TEXT[w.period] ?? ''}${w.service ? ` · ${w.service.name}` : ''}${w.status === 'oferecido' && w.offered_starts_at ? ` · encaixe oferecido para ${when(c, w.offered_starts_at)}` : ''}`).join('\n') : 'Ninguém na lista de espera.');
    },
  },
  {
    name: 'agendar_horario',
    description: 'Marca uma consulta. Confere a agenda do profissional; use encaixar: true só se a pessoa quiser marcar mesmo com a agenda ocupada.',
    input_schema: obj({ cliente_id: str('Id do paciente (opcional).'), servico_id: str('Id do procedimento (opcional).'), profissional_id: str('Id do profissional (opcional: sem ele, quem estiver livre).'), convenio: str('Convênio (vazio = particular).'), titulo: str('Título, se não for um procedimento da tabela.'), data: date, hora: hour, duracao_min: { type: 'number' }, observacoes: str('Observações administrativas.'), encaixar: { type: 'boolean' } }, ['data', 'hora']),
    run: (i, c) => book(c, i),
  },
  {
    name: 'remarcar_horario',
    description: 'Muda data e hora de uma consulta (e, se pedirem, o profissional).',
    input_schema: obj({ agendamento_id: str('Id da consulta.'), data: date, hora: hour, profissional_id: str('Novo profissional (opcional).'), encaixar: { type: 'boolean' } }, ['agendamento_id', 'data', 'hora']),
    run: (i, c) => reschedule(c, i),
  },
  {
    name: 'cancelar_horario',
    description: 'Cancela um horário (pede confirmação antes). Pode avisar o paciente pelo WhatsApp.',
    input_schema: obj({ agendamento_id: str('Id do horário.'), motivo: str('Motivo.'), avisar_cliente: { type: 'boolean', description: 'Mandar aviso ao paciente.' } }, ['agendamento_id']),
    run: async (i, c) => {
      const appt = await appointmentFor(c, i.agendamento_id);
      if (!appt) return err('Horário não encontrado.');
      return askConfirmation(c, 'cancelar_horario', i, `Cancelar o horário de ${when(c, appt.starts_at)} (${appt.title})${i.avisar_cliente ? ' e avisar o cliente' : ''}`);
    },
  },
  {
    name: 'registrar_venda',
    description: 'Registra uma venda recebida (pede confirmação antes).',
    input_schema: obj({ valor: { type: 'number', description: 'Valor em reais.' }, metodo: { type: 'string', enum: METHODS }, cliente_id: str('Id do paciente (opcional).'), descricao: str('O que foi vendido.'), orcamento_id: str('Id do orçamento pago (opcional).') }, ['valor']),
    run: async (i, c) => {
      const blocked = canWrite(c); if (blocked) return blocked;
      const amount = money(i.valor);
      if (!(amount > 0)) return err('Informe um valor maior que zero.');
      const contact = i.cliente_id ? await contactById(c, i.cliente_id) : null;
      if (i.cliente_id && !contact) return err('Cliente não encontrado.');
      return askConfirmation(c, 'registrar_venda', i, `Registrar venda de ${brl(amount)}${i.metodo ? ` (${String(i.metodo).replace('_', ' ')})` : ''}${contact ? ` para ${contact.name}` : ''}`);
    },
  },
  {
    name: 'criar_tarefa',
    description: 'Cria uma tarefa ou lembrete para a equipe. Com data e hora, a pessoa recebe o lembrete no WhatsApp.',
    input_schema: obj({ titulo: str('O que fazer.'), data: str('Data AAAA-MM-DD (opcional).'), hora: str('Hora HH:MM (opcional).'), cliente_id: str('Cliente relacionado (opcional).') }, ['titulo']),
    run: async (i, c) => {
      const blocked = canWrite(c); if (blocked) return blocked;
      const title = s(i.titulo, 300);
      if (!title) return err('Informe a tarefa.');
      const d = s(i.data), h = s(i.hora);
      const due = DATE.test(d) ? at(c, d, TIME.test(h) ? h : '09:00').toISOString() : null;
      const { data, error } = await db.from('tasks').insert({ company_id: c.company.id, title, due_at: due, contact_id: s(i.cliente_id) || null, created_by: c.member?.userId ?? null, created_via: 'ia_dono' }).select('id').single();
      if (error) return err(error.message);
      await log(c, 'criar_tarefa', `Criou a tarefa "${title}"${due ? ` para ${fmtDate(due, c.tz)} às ${localTime(due, c.tz)}` : ''}`, 'task', data.id);
      return ok(`Tarefa criada${due ? ` para ${when(c, due)}` : ''}.`, { tool: 'criar_tarefa', label: 'Tarefa criada', detail: `${title}${due ? ` · ${when(c, due)}` : ''}`, status: 'ok', link: '#/tarefas' });
    },
  },
  {
    name: 'listar_tarefas',
    description: 'Lista as tarefas em aberto.',
    input_schema: obj({}),
    run: async (_i, c) => {
      const { data } = await db.from('tasks').select('id, title, due_at').eq('company_id', c.company.id).is('done_at', null).order('due_at', { ascending: true, nullsFirst: false }).limit(20);
      return ok((data ?? []).length ? (data ?? []).map((t) => `[${t.id}] ${t.title}${t.due_at ? ` · ${when(c, t.due_at)}` : ''}`).join('\n') : 'Nenhuma tarefa em aberto.');
    },
  },
  {
    name: 'concluir_tarefa',
    description: 'Marca uma tarefa como feita.',
    input_schema: obj({ tarefa_id: str('Id da tarefa.') }, ['tarefa_id']),
    run: async (i, c) => {
      const { data } = await db.from('tasks').update({ done_at: new Date().toISOString() }).eq('company_id', c.company.id).eq('id', s(i.tarefa_id)).is('done_at', null).select('title').maybeSingle();
      if (!data) return err('Tarefa não encontrada ou já concluída.');
      await log(c, 'concluir_tarefa', `Concluiu a tarefa "${data.title}"`, 'task', s(i.tarefa_id));
      return ok('Tarefa concluída.', { tool: 'concluir_tarefa', label: 'Tarefa concluída', detail: data.title, status: 'ok' });
    },
  },
  {
    name: 'criar_servico',
    description: 'Adiciona um serviço à tabela de preços.',
    input_schema: obj({ nome: str('Nome do serviço.'), preco: { type: 'number' }, tipo_preco: { type: 'string', enum: ['fixo', 'a_partir_de', 'sob_consulta'] }, duracao_min: { type: 'number' }, categoria: str('Categoria.') }, ['nome']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const blocked = canWrite(c); if (blocked) return blocked;
      const { data, error } = await db.from('services').insert({
        company_id: c.company.id, name: s(i.nome, 120), price: Math.max(0, money(i.preco) || 0), price_type: ['fixo', 'a_partir_de', 'sob_consulta'].includes(String(i.tipo_preco)) ? i.tipo_preco : 'fixo',
        duration_min: Math.max(5, Math.round(Number(i.duracao_min) || 60)), category: s(i.categoria, 60) || null, sort: c.services.length,
      }).select('*').single();
      if (error) return err(error.message);
      c.services.push(data as Service);
      await log(c, 'criar_servico', `Criou o serviço ${data.name} (${priceText(data)})`, 'service', data.id);
      return ok(`Serviço criado: [${data.id}] ${data.name} — ${priceText(data)}.`, { tool: 'criar_servico', label: `Serviço ${data.name} criado`, detail: priceText(data), status: 'ok', link: '#/catalogo' });
    },
  },
  {
    name: 'atualizar_servico',
    description: 'Muda preço, tipo de preço, nome, duração ou desativa um serviço (pede confirmação antes).',
    input_schema: obj({ servico_id: str('Id do serviço.'), preco: { type: 'number' }, tipo_preco: { type: 'string', enum: ['fixo', 'a_partir_de', 'sob_consulta'] }, nome: str('Novo nome.'), duracao_min: { type: 'number' }, ativo: { type: 'boolean' } }, ['servico_id']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const svc = service(c, i.servico_id);
      if (!svc) return err('Serviço não encontrado.');
      const what = [i.preco != null ? `preço de ${brl(svc.price)} para ${brl(money(i.preco))}` : '', i.ativo === false ? 'desativar' : '', s(i.nome) ? `renomear para "${s(i.nome)}"` : '', i.duracao_min ? `duração ${i.duracao_min} min` : ''].filter(Boolean).join(', ');
      return askConfirmation(c, 'atualizar_servico', i, `Alterar ${svc.name}: ${what || 'dados do serviço'}`);
    },
  },
  {
    name: 'resumo',
    description: 'Números do período: vendas, orçamentos, horários, pacientes novos e conversas esperando resposta.',
    input_schema: obj({ periodo: { type: 'string', enum: ['hoje', 'ontem', 'semana', 'mes', 'mes_passado'] } }, ['periodo']),
    run: async (i, c) => {
      const today = localDate(new Date(), c.tz);
      const p = s(i.periodo) || 'hoje';
      let d0 = today, d1 = today;
      if (p === 'ontem') d0 = d1 = addDays(today, -1);
      if (p === 'semana') d0 = addDays(today, -6);
      if (p === 'mes') d0 = today.slice(0, 8) + '01';
      if (p === 'mes_passado') { const first = today.slice(0, 8) + '01'; d1 = addDays(first, -1); d0 = d1.slice(0, 8) + '01'; }
      const t0 = at(c, d0, '00:00').toISOString(), t1 = at(c, addDays(d1, 1), '00:00').toISOString();
      const id = c.company.id;
      const [sales, quotes, approved, appts, contacts, waiting] = await Promise.all([
        db.from('sales').select('amount, origin').eq('company_id', id).gte('paid_at', t0).lt('paid_at', t1),
        db.from('quotes').select('total').eq('company_id', id).gte('created_at', t0).lt('created_at', t1),
        db.from('quotes').select('total').eq('company_id', id).eq('status', 'aprovado').gte('responded_at', t0).lt('responded_at', t1),
        db.from('appointments').select('id', { count: 'exact', head: true }).eq('company_id', id).gte('starts_at', t0).lt('starts_at', t1).neq('status', 'cancelado'),
        db.from('contacts').select('id', { count: 'exact', head: true }).eq('company_id', id).gte('created_at', t0).lt('created_at', t1),
        db.from('conversations').select('id', { count: 'exact', head: true }).eq('company_id', id).eq('needs_attention', true).eq('status', 'aberta'),
      ]);
      const sl = (sales.data ?? []) as { amount: number; origin: string }[];
      const total = sl.reduce((t, x) => t + Number(x.amount), 0);
      const byIa = sl.filter((x) => x.origin === 'ia').reduce((t, x) => t + Number(x.amount), 0);
      const qs = (quotes.data ?? []) as { total: number }[], qa = (approved.data ?? []) as { total: number }[];
      const label = { hoje: 'Hoje', ontem: 'Ontem', semana: 'Últimos 7 dias', mes: 'Este mês', mes_passado: 'Mês passado' }[p] ?? p;
      const goal = Number(c.company.monthly_goal);
      return ok([
        `${label} (${fmtDate(d0 + 'T12:00:00Z', c.tz)}${d0 !== d1 ? ` a ${fmtDate(d1 + 'T12:00:00Z', c.tz)}` : ''}):`,
        `Vendas: ${sl.length} · ${brl(total)} (${brl(byIa)} fechadas pela IA)`,
        `Orçamentos criados: ${qs.length} (${brl(qs.reduce((t, x) => t + Number(x.total), 0))}) · aprovados: ${qa.length} (${brl(qa.reduce((t, x) => t + Number(x.total), 0))})`,
        `Horários marcados: ${appts.count ?? 0} · pacientes novos: ${contacts.count ?? 0}`,
        `Conversas esperando resposta agora: ${waiting.count ?? 0}`,
        p === 'mes' && goal > 0 ? `Meta do mês: ${brl(goal)} (${Math.round((total / goal) * 100)}% atingido)` : '',
      ].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'conversas_pendentes',
    description: 'Lista as conversas de pacientes que estão esperando alguém da equipe.',
    input_schema: obj({}),
    run: async (_i, c) => {
      const { data } = await db.from('conversations').select('id, attention_reason, last_inbound_at, contact:contacts(name)').eq('company_id', c.company.id).eq('needs_attention', true).eq('status', 'aberta').order('last_inbound_at').limit(15);
      const list = (data ?? []) as unknown as { id: string; attention_reason: string | null; last_inbound_at: string | null; contact: { name: string } | null }[];
      return ok(list.length ? list.map((x) => `${x.contact?.name ?? 'Cliente'} — ${x.attention_reason ?? 'aguardando'}${x.last_inbound_at ? ` (desde ${when(c, x.last_inbound_at)})` : ''}`).join('\n') : 'Nenhuma conversa esperando. 🎉');
    },
  },
  {
    name: 'mensagem_para_cliente',
    description: 'Manda uma mensagem de texto para um paciente pelo WhatsApp, em nome da equipe (pede confirmação antes). Só funciona se o paciente escreveu nas últimas 24 horas.',
    input_schema: obj({ cliente_id: str('Id do paciente.'), mensagem: str('Texto exato a enviar.') }, ['cliente_id', 'mensagem']),
    run: async (i, c) => {
      const contact = await contactById(c, i.cliente_id);
      if (!contact) return err('Cliente não encontrado.');
      const text = s(i.mensagem, 2000);
      if (!text) return err('Escreva a mensagem.');
      return askConfirmation(c, 'mensagem_para_cliente', i, `Enviar para ${contact.name}: "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"`);
    },
  },
  {
    name: 'lancar_conta',
    description: 'Lança uma conta a pagar (aluguel, fornecedor, salário, imposto) ou um valor a receber (contrato, boleto de paciente) no financeiro.',
    input_schema: obj({
      tipo: { type: 'string', enum: ['pagar', 'receber'] }, descricao: str('O que é a conta.'), valor: { type: 'number', description: 'Valor em reais.' },
      vencimento: str('Data de vencimento AAAA-MM-DD. Sem data, use hoje.'), categoria: str('Ex.: Fornecedores, Aluguel, Pessoal, Impostos, Contas da casa, Serviços, Contratos.'),
      fornecedor: str('Fornecedor ou quem paga (opcional).'), cliente_id: str('Cliente cadastrado, para valores a receber (opcional).'),
      mensal: { type: 'boolean', description: 'true se repete todo mês.' }, ja_pago: { type: 'boolean', description: 'true se já foi paga ou recebida.' },
    }, ['tipo', 'descricao', 'valor']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const blocked = canWrite(c); if (blocked) return blocked;
      const amount = Math.round(money(i.valor) * 100) / 100;
      if (!(amount > 0)) return err('Informe um valor maior que zero.');
      const kind = i.tipo === 'receber' ? 'receber' : 'pagar';
      const due = DATE.test(s(i.vencimento)) ? s(i.vencimento) : localDate(new Date().toISOString(), c.tz);
      const { data, error } = await db.from('finance_entries').insert({
        company_id: c.company.id, kind, description: s(i.descricao, 200) || 'Conta', category: s(i.categoria, 60) || (kind === 'pagar' ? 'Outros' : 'Serviços'),
        amount, due_date: due, counterpart: s(i.fornecedor, 120) || null, contact_id: s(i.cliente_id) || null, recurrence: i.mensal === true ? 'mensal' : 'nenhuma',
        ...(i.ja_pago === true ? { paid_at: new Date().toISOString(), method: 'pix' } : {}), created_via: 'ia_dono',
      }).select('id, description').single();
      if (error) return err(error.message);
      await log(c, 'lancar_conta', `Lançou conta a ${kind}: ${data.description} (${brl(amount)}, vence ${fmtDate(due + 'T12:00:00Z', c.tz)})`, 'finance', data.id);
      return ok(`Conta a ${kind} lançada: ${data.description}, ${brl(amount)}, vencimento ${fmtDate(due + 'T12:00:00Z', c.tz)}${i.mensal === true ? ', todo mês' : ''}. Id ${data.id}.`,
        { tool: 'lancar_conta', label: `Conta a ${kind} lançada`, detail: `${data.description} · ${brl(amount)} · ${fmtDate(due + 'T12:00:00Z', c.tz).slice(0, 5)}`, status: 'ok', link: '#/financeiro' });
    },
  },
  {
    name: 'consultar_contas',
    description: 'Lista contas a pagar e a receber em aberto (com ids), as vencidas e o resultado do mês. Use para perguntas como "o que vence essa semana?" ou "quanto tenho a receber?".',
    input_schema: obj({ filtro: { type: 'string', enum: ['abertas', 'vencidas', 'proximos_7_dias'], description: 'Padrão: abertas.' }, tipo: { type: 'string', enum: ['pagar', 'receber', 'todas'] } }),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const today = localDate(new Date().toISOString(), c.tz);
      let q = db.from('finance_entries').select('id, kind, description, amount, due_date, counterpart').eq('company_id', c.company.id).is('paid_at', null).order('due_date').limit(40);
      if (i.tipo === 'pagar' || i.tipo === 'receber') q = q.eq('kind', i.tipo);
      if (i.filtro === 'vencidas') q = q.lt('due_date', today);
      if (i.filtro === 'proximos_7_dias') q = q.lte('due_date', addDays(today, 7));
      const { data } = await q;
      const rows = data ?? [];
      const monthStart = `${today.slice(0, 7)}-01`;
      const { data: paid } = await db.from('finance_entries').select('kind, amount, sale_id').eq('company_id', c.company.id).gte('paid_at', at(c, monthStart, '00:00').toISOString());
      const { data: sales } = await db.from('sales').select('amount').eq('company_id', c.company.id).gte('paid_at', at(c, monthStart, '00:00').toISOString());
      const inM = (paid ?? []).filter((p) => p.kind === 'receber' && !p.sale_id).reduce((t, p) => t + Number(p.amount), 0) + (sales ?? []).reduce((t, p) => t + Number(p.amount), 0);
      const outM = (paid ?? []).filter((p) => p.kind === 'pagar').reduce((t, p) => t + Number(p.amount), 0);
      const list = rows.map((r) => `[${r.id}] ${r.kind === 'pagar' ? 'A PAGAR' : 'A RECEBER'} · ${r.description}${r.counterpart ? ` (${r.counterpart})` : ''} · ${brl(Number(r.amount))} · vence ${fmtDate(r.due_date + 'T12:00:00Z', c.tz)}${r.due_date < today ? ' · VENCIDA' : ''}`).join('\n');
      return ok(`${list || 'Nenhuma conta nesse filtro.'}\nResultado do mês até agora: entrou ${brl(inM)} (vendas e recebimentos), saiu ${brl(outM)}.`);
    },
  },
  {
    name: 'baixar_conta',
    description: 'Marca uma conta como paga ou recebida (pede confirmação antes). Use o id de consultar_contas.',
    input_schema: obj({ conta_id: str('Id da conta.'), metodo: { type: 'string', enum: METHODS } }, ['conta_id']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const { data: e } = await db.from('finance_entries').select('kind, description, amount, paid_at').eq('company_id', c.company.id).eq('id', s(i.conta_id)).maybeSingle();
      if (!e) return err('Conta não encontrada.');
      if (e.paid_at) return ok('Essa conta já está baixada.');
      return askConfirmation(c, 'baixar_conta', i, `Marcar como ${e.kind === 'pagar' ? 'paga' : 'recebida'}: ${e.description} (${brl(Number(e.amount))})`);
    },
  },
  {
    name: 'consultar_estoque',
    description: 'Busca produtos do estoque com saldo, mínimo e id. Sem busca, lista os que estão abaixo do mínimo.',
    input_schema: obj({ busca: str('Nome ou código do produto (opcional).') }),
    run: async (i, c) => {
      const term = s(i.busca, 80);
      let q = db.from('products').select('id, name, sku, unit, stock, min_stock').eq('company_id', c.company.id).eq('active', true).order('name').limit(30);
      if (term) q = q.or(`name.ilike.%${term.replace(/[%,()]/g, ' ')}%,sku.ilike.%${term.replace(/[%,()]/g, ' ')}%`);
      const { data } = await q;
      let rows = data ?? [];
      if (!term) rows = rows.filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock));
      if (!rows.length) return ok(term ? `Nenhum produto encontrado para "${term}".` : 'Nenhum produto abaixo do mínimo.');
      return ok(rows.map((p) => `[${p.id}] ${p.name}${p.sku ? ` (${p.sku})` : ''} · saldo ${Number(p.stock)} ${p.unit} · mínimo ${Number(p.min_stock)}${Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock) ? ' · REPOR' : ''}`).join('\n'));
    },
  },
  {
    name: 'movimentar_estoque',
    description: 'Registra entrada (compra, reposição) ou saída (uso, venda, perda) de um produto. Use o id de consultar_estoque.',
    input_schema: obj({ produto_id: str('Id do produto.'), tipo: { type: 'string', enum: ['entrada', 'saida'] }, quantidade: { type: 'number' }, observacao: str('Motivo (opcional).') }, ['produto_id', 'tipo', 'quantidade']),
    run: async (i, c) => {
      const blocked = canWrite(c); if (blocked) return blocked;
      const qty = Number(i.quantidade);
      if (!(qty > 0)) return err('Informe uma quantidade maior que zero.');
      const { data: p } = await db.from('products').select('id, name, unit').eq('company_id', c.company.id).eq('id', s(i.produto_id)).maybeSingle();
      if (!p) return err('Produto não encontrado.');
      const kind = i.tipo === 'entrada' ? 'entrada' : 'saida';
      const { data: m, error } = await db.from('stock_movements').insert({ company_id: c.company.id, product_id: p.id, kind, qty, note: s(i.observacao, 300) || null, created_by: c.member?.userId ?? null, created_via: 'ia_dono' }).select('balance_after').single();
      if (error) return err(error.message);
      const bal = Number(m.balance_after);
      await log(c, 'movimentar_estoque', `${kind === 'entrada' ? 'Entrada' : 'Saída'} de ${qty} ${p.unit} de ${p.name} (saldo: ${bal})`, 'product', p.id);
      return ok(`${kind === 'entrada' ? 'Entrada' : 'Saída'} registrada: ${qty} ${p.unit} de ${p.name}. Saldo agora: ${bal} ${p.unit}.`, { tool: 'movimentar_estoque', label: `${kind === 'entrada' ? 'Entrada' : 'Saída'} de estoque`, detail: `${qty} ${p.unit} · ${p.name} · saldo ${bal}`, status: 'ok', link: '#/estoque' });
    },
  },
  {
    name: 'cadastrar_produto',
    description: 'Cadastra um produto no estoque, com saldo inicial e estoque mínimo para alerta.',
    input_schema: obj({ nome: str('Nome do produto.'), unidade: str('un, kg, litro, caixa...'), saldo: { type: 'number' }, minimo: { type: 'number' }, custo: { type: 'number' }, preco: { type: 'number' }, codigo: str('Código (opcional).') }, ['nome']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const blocked = canWrite(c); if (blocked) return blocked;
      const name = s(i.nome, 120);
      if (!name) return err('Informe o nome.');
      const { data, error } = await db.from('products').insert({ company_id: c.company.id, name, unit: s(i.unidade, 12) || 'un', stock: Math.max(0, Number(i.saldo) || 0), min_stock: Math.max(0, Number(i.minimo) || 0), cost: Number(i.custo) > 0 ? Number(i.custo) : null, price: Number(i.preco) > 0 ? Number(i.preco) : null, sku: s(i.codigo, 60) || null }).select('id, stock, unit').single();
      if (error) return err(/duplicate|unique/i.test(error.message) ? 'Já existe um produto com esse código.' : error.message);
      await log(c, 'cadastrar_produto', `Cadastrou o produto ${name}`, 'product', data.id);
      return ok(`Produto ${name} cadastrado com saldo ${Number(data.stock)} ${data.unit}. Id ${data.id}.`, { tool: 'cadastrar_produto', label: `Produto ${name} cadastrado`, detail: `saldo ${Number(data.stock)} ${data.unit}`, status: 'ok', link: '#/estoque' });
    },
  },
  {
    name: 'cobrar_cliente',
    description: 'Gera uma cobrança (Pix, boleto ou os dois) no Asaas da empresa para um paciente e manda o link pelo WhatsApp (pede confirmação antes). Precisa do CPF ou CNPJ do paciente: se não estiver no cadastro, pergunte.',
    input_schema: obj({ cliente_id: str('Id do paciente.'), valor: { type: 'number', description: 'Valor em reais (mínimo R$ 5).' }, descricao: str('A que se refere.'), vencimento: str('AAAA-MM-DD. Sem data, 3 dias a partir de hoje.'), forma: { type: 'string', enum: ['pix', 'boleto', 'pix_boleto'] }, cpf_cnpj: str('CPF ou CNPJ, se não estiver no cadastro.'), enviar: { type: 'boolean', description: 'Mandar o link no WhatsApp (padrão: sim).' } }, ['cliente_id', 'valor', 'descricao']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const contact = await contactById(c, i.cliente_id);
      if (!contact) return err('Cliente não encontrado.');
      const amount = money(i.valor);
      if (!(amount >= 5)) return err('O valor mínimo de uma cobrança é R$ 5,00.');
      const doc = s(i.cpf_cnpj, 20).replace(/\D/g, '') || contact.document || '';
      if (!/^(\d{11}|\d{14})$/.test(doc)) return err(`Preciso do CPF ou CNPJ de ${contact.name} para gerar a cobrança. Pergunte e chame de novo com cpf_cnpj.`);
      const { data: integ } = await db.from('company_integrations').select('status').eq('company_id', c.company.id).eq('provider', 'asaas').maybeSingle();
      if (integ?.status !== 'conectado') return err('O Asaas da empresa não está conectado. Conecte em Integrações para cobrar pacientes.');
      return askConfirmation(c, 'cobrar_cliente', { ...i, cpf_cnpj: doc }, `Cobrar ${brl(amount)} de ${contact.name} (${s(i.descricao, 80)})${i.enviar === false ? '' : ' e enviar o link no WhatsApp'}`);
    },
  },
  {
    name: 'emitir_nota',
    description: 'Emite a nota fiscal de serviço (NFS-e) para um paciente (pede confirmação antes). Use o valor e a descrição do serviço; com venda_id, liga a nota à venda.',
    input_schema: obj({ cliente_id: str('Id do paciente (tomador).'), valor: { type: 'number' }, descricao: str('Descrição do serviço na nota.'), venda_id: str('Venda relacionada (opcional).'), cpf_cnpj: str('CPF ou CNPJ do paciente (opcional, mas recomendado).') }, ['cliente_id', 'valor', 'descricao']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const contact = await contactById(c, i.cliente_id);
      if (!contact) return err('Cliente não encontrado.');
      const { data: integ } = await db.from('company_integrations').select('status').eq('company_id', c.company.id).eq('provider', 'focusnfe').maybeSingle();
      if (integ?.status !== 'conectado') return err('A emissão de nota fiscal não está conectada. Conecte a Focus NFe em Integrações.');
      return askConfirmation(c, 'emitir_nota', i, `Emitir nota fiscal de ${brl(money(i.valor))} para ${contact.name}: ${s(i.descricao, 80)}`);
    },
  },
  {
    name: 'consultar_cobrancas',
    description: 'Lista as cobranças da empresa (em aberto, vencidas ou pagas) com valor, paciente e link.',
    input_schema: obj({ situacao: { type: 'string', enum: ['pendente', 'vencida', 'paga', 'todas'] } }),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      let q = db.from('charges').select('id, description, amount, due_date, status, invoice_url, contact_id').eq('company_id', c.company.id).order('created_at', { ascending: false }).limit(20);
      if (['pendente', 'vencida', 'paga'].includes(String(i.situacao))) q = q.eq('status', i.situacao);
      const { data } = await q;
      if (!(data ?? []).length) return ok('Nenhuma cobrança nesse filtro.');
      const ids = [...new Set((data ?? []).map((x) => x.contact_id).filter(Boolean))];
      const { data: cs } = await db.from('contacts').select('id, name').in('id', ids);
      const names = new Map((cs ?? []).map((x) => [x.id, x.name]));
      return ok((data ?? []).map((x) => `[${x.id}] ${names.get(x.contact_id) ?? 'Cliente'} · ${brl(Number(x.amount))} · ${x.description} · vence ${fmtDate(x.due_date + 'T12:00:00Z', c.tz)} · ${x.status}${x.status !== 'paga' && x.invoice_url ? ` · ${x.invoice_url}` : ''}`).join('\n'));
    },
  },
  {
    name: 'pausar_ia',
    description: 'Liga ou desliga o atendimento automático da IA com os pacientes.',
    input_schema: obj({ pausar: { type: 'boolean', description: 'true para pausar, false para voltar a atender.' } }, ['pausar']),
    run: async (i, c) => {
      const denied = needRole(c, 'dono', 'gerente'); if (denied) return denied;
      const enabled = i.pausar !== true;
      await db.from('ai_settings').update({ enabled }).eq('company_id', c.company.id);
      c.ai.enabled = enabled;
      await log(c, enabled ? 'reativar_ia' : 'pausar_ia', enabled ? 'Voltou a deixar a IA atender os clientes' : 'Pausou o atendimento da IA');
      return ok(enabled ? 'A IA voltou a atender os pacientes.' : 'A IA está pausada: as mensagens dos pacientes ficam para a equipe responder.', { tool: 'pausar_ia', label: enabled ? 'IA reativada' : 'IA pausada', status: 'ok', link: '#/configuracoes/assistente' });
    },
  },
];
