// Automações agendadas (a função "cron" chama runCron a cada 5 minutos).
// Roda as automações ligadas em cada empresa: lembrete de horário, acompanhamento de orçamento, resumo do dia,
// pós-atendimento, reativação de clientes, lembretes de tarefas, relatório semanal de valor e encaixe de
// clientes da lista de espera em horários cancelados. Cada envio é registrado uma vez só.
import { db, notify } from '../_shared/db.ts';
import { syncNote } from '../_shared/fiscal.ts';
import type { FiscalNote } from '../_shared/types.ts';
import { loadBase, quoteLink, quoteNo, type Base } from '../_shared/context.ts';
import { deliverToContact } from '../_shared/conversation.ts';
import { lastOwnerWhatsApp } from '../_shared/tools.ts';
import { loadAccount, sendTemplate, sendText, withinWindow } from '../_shared/whatsapp.ts';
import { addDays, brl, firstName, fmtDate, fromLocal, localDate, localTime, WEEKDAYS } from '../_shared/format.ts';
import { isFree } from '../_shared/availability.ts';
import { fmtMinutes, valueHighlights, valueOneLine } from '../_shared/value.ts';
import type { Appointment, Automation, AutomationKind, Contact, ValueReport, WaitlistEntry } from '../_shared/types.ts';
import { TEMPLATES } from '../_shared/templates.ts';

const MAX_PER_RUN = 150;
let budget = MAX_PER_RUN;

/** Roda as automações (exportado para os testes). */
export async function runCron(req: Request): Promise<Response> {
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('unauthorized', { status: 401 });
  budget = MAX_PER_RUN;
  const { data: autos } = await db.from('automations').select('*').eq('enabled', true);
  const byCompany = new Map<string, Automation[]>();
  for (const a of (autos ?? []) as Automation[]) byCompany.set(a.company_id, [...(byCompany.get(a.company_id) ?? []), a]);
  const report: Record<string, number> = {};
  for (const [companyId, list] of byCompany) {
    if (budget <= 0) break;
    try {
      const b = await loadBase(companyId);
      if (!b.writable) continue;
      const acc = await loadAccount(companyId);
      for (const a of list) {
        if (!allowed(b, a.kind) || budget <= 0) continue;
        if (!acc && a.kind !== 'lembrete_tarefa' && a.kind !== 'relatorio_semanal') continue; // sem WhatsApp conectado só sobra o aviso no painel
        const n = await RUN[a.kind](b, a);
        if (n) { report[a.kind] = (report[a.kind] ?? 0) + n; await db.from('automations').update({ last_run_at: new Date().toISOString() }).eq('id', a.id); }
      }
    } catch (e) { console.error('automações', companyId, e); }
  }
  // notas fiscais ainda em processamento na prefeitura: confere o resultado (as mais recentes primeiro)
  const { data: pending } = await db.from('fiscal_notes').select('*').eq('status', 'processando').gt('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(40);
  for (const n of (pending ?? []) as FiscalNote[]) {
    try { if ((await syncNote(n))?.status !== 'processando') report.notas_fiscais = (report.notas_fiscais ?? 0) + 1; } catch (e) { console.error('nota fiscal', n.id, (e as Error).message); }
  }
  return Response.json({ ok: true, sent: report });
}

/** Mesma regra da tela de Automações: o que mostra valor todo dia vale em todos os planos; o resto, do Profissional em diante. */
export const ALL_PLANS: AutomationKind[] = ['lembrete_tarefa', 'lembrete_agendamento', 'resumo_diario', 'relatorio_semanal'];
function allowed(b: Base, kind: AutomationKind): boolean {
  if (ALL_PLANS.includes(kind) || b.plan.id === 'teste') return true;
  return b.plan.automations;
}

/** Registra a execução; devolve falso se esse alvo já foi tratado (não manda duas vezes). */
async function claim(b: Base, a: Automation, key: string, label: string): Promise<string | null> {
  const { data, error } = await db.from('automation_runs').insert({ company_id: b.company.id, automation_id: a.id, kind: a.kind, target_key: key, target_label: label, status: 'enviado' }).select('id').single();
  return error ? null : data.id;
}
async function settle(runId: string, ok: boolean, detail: string) {
  await db.from('automation_runs').update({ status: ok ? 'enviado' : 'falhou', detail: detail.slice(0, 300) }).eq('id', runId);
}

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const dayName = (b: Base, iso: string) => {
  const d = localDate(iso, b.tz), today = localDate(new Date(), b.tz);
  return d === today ? 'hoje' : d === addDays(today, 1) ? 'amanhã' : `${WEEKDAYS[new Date(d + 'T12:00:00Z').getUTCDay()]}, ${fmtDate(iso, b.tz).slice(0, 5)}`;
};

type Runner = (b: Base, a: Automation) => Promise<number>;
const RUN: Record<AutomationKind, Runner> = {
  /* lembrete antes do horário marcado */
  async lembrete_agendamento(b, a) {
    const hours = num(a.config.horas_antes, 24);
    const now = Date.now();
    const { data } = await db.from('appointments').select('*, contact:contacts(*)').eq('company_id', b.company.id).in('status', ['confirmado', 'pendente']).is('reminder_sent_at', null)
      .gt('starts_at', new Date(now + 30 * 60000).toISOString()).lte('starts_at', new Date(now + hours * 3600000).toISOString()).limit(50);
    let sent = 0;
    for (const ap of (data ?? []) as (Appointment & { contact: Contact | null })[]) {
      if (budget <= 0) break;
      const c = ap.contact;
      // marcado em cima da hora (menos da metade da antecedência): não precisa lembrar
      if (!c?.phone || !c.opt_in || Date.parse(ap.starts_at) - Date.parse(ap.created_at) < (hours * 3600000) / 2) { await db.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', ap.id); continue; }
      const run = await claim(b, a, ap.id, c.name);
      if (!run) continue;
      const quando = dayName(b, ap.starts_at), hora = localTime(ap.starts_at, b.tz);
      const text = `Olá, ${firstName(c.name)}! Passando para lembrar do seu horário de ${ap.title} ${quando}, às ${hora}.${a.config.pedir_confirmacao ? ' Pode confirmar respondendo *SIM*? Se precisar remarcar, é só me avisar por aqui.' : ''}`;
      const r = await deliverToContact(b, c, text, { sender: 'ia', senderName: 'Lembrete automático', template: { name: a.template_name || TEMPLATES.lembrete.name, params: [firstName(c.name), ap.title, quando, hora] } });
      await settle(run, r.sent, r.sent ? `Horário ${quando} às ${hora}` : r.reason ?? 'não enviado');
      await db.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', ap.id);
      if (r.sent) { sent++; budget--; }
    }
    return sent;
  },

  /* acompanhamento de orçamento sem resposta */
  async followup_orcamento(b, a) {
    const days = num(a.config.dias_depois, 2), max = num(a.config.max_tentativas, 2);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await db.from('quotes').select('*, contact:contacts(*)').eq('company_id', b.company.id).eq('status', 'enviado').lt('sent_at', cutoff)
      .or(`followup_sent_at.is.null,followup_sent_at.lt.${cutoff}`).limit(40);
    let sent = 0;
    for (const q of data ?? []) {
      if (budget <= 0) break;
      const c = q.contact as Contact | null;
      if (!c?.phone || !c.opt_in) continue;
      const { count } = await db.from('automation_runs').select('id', { count: 'exact', head: true }).eq('company_id', b.company.id).eq('kind', a.kind).like('target_key', `${q.id}:%`);
      if ((count ?? 0) >= max) continue;
      const run = await claim(b, a, `${q.id}:${(count ?? 0) + 1}`, c.name);
      if (!run) continue;
      const link = quoteLink(b, q);
      const text = `Olá, ${firstName(c.name)}! Passando para saber se ficou alguma dúvida sobre o orçamento nº ${quoteNo(q.number)} (${brl(q.total)}). O link continua aqui: ${link}`;
      const r = await deliverToContact(b, c, text, { sender: 'ia', senderName: 'Acompanhamento automático', template: { name: a.template_name || TEMPLATES.acompanhamento.name, params: [firstName(c.name), quoteNo(q.number), brl(q.total), link] } });
      await settle(run, r.sent, r.sent ? `Orçamento nº ${quoteNo(q.number)} sem resposta há ${days} dias` : r.reason ?? 'não enviado');
      await db.from('quotes').update({ followup_sent_at: new Date().toISOString() }).eq('id', q.id);
      if (r.sent) { sent++; budget--; }
    }
    return sent;
  },

  /* resumo do dia no WhatsApp de quem tem número verificado */
  async resumo_diario(b, a) {
    const hhmm = /^\d{2}:\d{2}$/.test(String(a.config.horario)) ? String(a.config.horario) : '19:00';
    const now = new Date();
    const today = localDate(now, b.tz);
    if (localTime(now, b.tz) < hhmm) return 0;
    const acc = await loadAccount(b.company.id);
    if (!acc) return 0;
    const { data: people } = await db.from('members').select('user_id, name, phone').eq('company_id', b.company.id).eq('active', true).in('role', ['dono', 'gerente']).not('phone_verified_at', 'is', null);
    if (!people?.length) return 0;
    const dayStart = (d: string) => fromLocal(d, '00:00', b.tz).toISOString();
    const from = dayStart(today), to = dayStart(addDays(today, 1)), to2 = dayStart(addDays(today, 2));
    const id = b.company.id;
    const tomorrowDate = addDays(today, 1);
    const [sales, quotes, waiting, tomorrow, money, overdue, waitlist, quotesOpen] = await Promise.all([
      db.from('sales').select('amount').eq('company_id', id).gte('paid_at', from).lt('paid_at', to),
      db.from('quotes').select('status').eq('company_id', id).gte('created_at', from).lt('created_at', to),
      db.from('conversations').select('id', { count: 'exact', head: true }).eq('company_id', id).eq('needs_attention', true).eq('status', 'aberta'),
      db.from('appointments').select('starts_at, title, contact:contacts(name)').eq('company_id', id).gte('starts_at', to).lt('starts_at', to2).neq('status', 'cancelado').order('starts_at').limit(12),
      db.from('finance_entries').select('kind, amount, due_date').eq('company_id', id).is('paid_at', null).lte('due_date', tomorrowDate),
      db.from('charges').select('amount').eq('company_id', id).eq('status', 'vencida'),
      db.from('waitlist').select('id', { count: 'exact', head: true }).eq('company_id', id).in('status', ['aguardando', 'oferecido']),
      db.from('quotes').select('total').eq('company_id', id).eq('status', 'enviado'),
    ]);
    const total = (sales.data ?? []).reduce((t, x) => t + Number(x.amount), 0);
    const agenda = (tomorrow.data ?? []) as unknown as { starts_at: string; title: string; contact: { name: string } | null }[];
    const fin = (money.data ?? []) as { kind: string; amount: number; due_date: string }[];
    const sum = (l: { amount: number }[]) => l.reduce((t, x) => t + Number(x.amount), 0);
    const payTomorrow = fin.filter((x) => x.kind === 'pagar' && x.due_date === tomorrowDate);
    const payLate = fin.filter((x) => x.kind === 'pagar' && x.due_date <= today);
    const receive = fin.filter((x) => x.kind === 'receber' && x.due_date <= tomorrowDate);
    const open = (quotesOpen.data ?? []) as { total: number }[];
    const lines = [
      `*Resumo de hoje na ${b.company.name}*`,
      `💰 Vendas: ${(sales.data ?? []).length} · ${brl(total)}`,
      `📄 Orçamentos criados: ${(quotes.data ?? []).length}${open.length ? ` · ${open.length} esperando o cliente aprovar (${brl(open.reduce((t, x) => t + Number(x.total), 0))})` : ''}`,
      `💬 Esperando resposta: ${waiting.count ?? 0}`,
      payLate.length ? `⚠️ Contas a pagar vencidas: ${payLate.length} (${brl(sum(payLate))})` : '',
      payTomorrow.length ? `📤 Vencem amanhã: ${payTomorrow.length} ${payTomorrow.length === 1 ? 'conta' : 'contas'} (${brl(sum(payTomorrow))})` : '',
      receive.length ? `📥 A receber até amanhã: ${brl(sum(receive))}` : '',
      (overdue.data ?? []).length ? `🔴 Cobranças vencidas: ${(overdue.data ?? []).length} (${brl(sum(overdue.data as { amount: number }[]))})` : '',
      waitlist.count ? `⏳ Lista de espera: ${waitlist.count} ${waitlist.count === 1 ? 'cliente' : 'clientes'}` : '',
      a.config.incluir_agenda !== false ? (agenda.length ? `📅 Amanhã:\n${agenda.map((x) => `• ${localTime(x.starts_at, b.tz)} ${x.contact?.name ?? ''} — ${x.title}`).join('\n')}` : '📅 Amanhã: agenda livre') : '',
    ].filter(Boolean).join('\n');
    let sent = 0;
    for (const p of people) {
      if (!p.phone || budget <= 0) continue;
      const run = await claim(b, a, `${today}:${p.user_id}`, p.name);
      if (!run) continue;
      let ok = false, detail = 'Resumo do dia';
      try {
        if (withinWindow(await lastOwnerWhatsApp(b.company.id, p.user_id))) { await sendText(acc, p.phone, lines); ok = true; }
        else { await sendTemplate(acc, p.phone, a.template_name || TEMPLATES.resumo.name, [b.company.name, `${(sales.data ?? []).length} vendas (${brl(total)}), ${(quotes.data ?? []).length} orçamentos, ${waiting.count ?? 0} esperando resposta`]); ok = true; }
      } catch (e) { detail = (e as Error).message; }
      await settle(run, ok, detail);
      if (ok) { sent++; budget--; await db.rpc('bump_usage', { p_company: b.company.id, p_wa: 1 }); }
    }
    return sent;
  },

  /* agradecimento e pedido de avaliação depois do serviço */
  async pos_atendimento(b, a) {
    const hours = num(a.config.horas_depois, 3);
    const end = Date.now() - hours * 3600000;
    const { data } = await db.from('appointments').select('*, contact:contacts(*)').eq('company_id', b.company.id).in('status', ['concluido', 'confirmado'])
      .lte('ends_at', new Date(end).toISOString()).gt('ends_at', new Date(end - 24 * 3600000).toISOString()).limit(40);
    let sent = 0;
    for (const ap of (data ?? []) as (Appointment & { contact: Contact | null })[]) {
      if (budget <= 0) break;
      const c = ap.contact;
      if (!c?.phone || !c.opt_in) continue;
      const run = await claim(b, a, ap.id, c.name);
      if (!run) continue;
      const review = a.config.pedir_avaliacao && a.config.link_avaliacao ? ` Se puder, deixe uma avaliação: ${String(a.config.link_avaliacao).startsWith('http') ? '' : 'https://'}${a.config.link_avaliacao}` : '';
      const text = `Olá, ${firstName(c.name)}! Obrigado por escolher a ${b.company.name}. Esperamos que tenha gostado do serviço!${review}`;
      const r = await deliverToContact(b, c, text, { sender: 'ia', senderName: 'Pós-atendimento', template: { name: a.template_name || TEMPLATES.posAtendimento.name, params: [firstName(c.name), b.company.name, review.trim() || 'Qualquer coisa, é só chamar por aqui.'] } });
      await settle(run, r.sent, r.sent ? 'Agradecimento enviado' : r.reason ?? 'não enviado');
      if (r.sent) { sent++; budget--; }
    }
    return sent;
  },

  /* convite para voltar, para quem não compra há muito tempo */
  async reativacao(b, a) {
    const days = num(a.config.dias_sem_compra, 120), pct = num(a.config.desconto_pct, 0);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const month = localDate(new Date(), b.tz).slice(0, 7);
    const { data } = await db.from('contacts').select('*').eq('company_id', b.company.id).gt('total_spent', 0).eq('opt_in', true).not('phone', 'is', null)
      .lt('last_interaction_at', cutoff).order('total_spent', { ascending: false }).limit(15);
    let sent = 0;
    for (const c of (data ?? []) as Contact[]) {
      if (budget <= 0) break;
      const { data: recent } = await db.from('sales').select('id').eq('contact_id', c.id).gte('paid_at', cutoff).limit(1);
      if (recent?.length) continue;
      const run = await claim(b, a, `${c.id}:${month}`, c.name);
      if (!run) continue;
      const offer = pct ? `Para você voltar, preparamos ${pct}% de desconto no próximo serviço.` : 'Quando quiser agendar de novo, é só responder aqui.';
      const r = await deliverToContact(b, c, `Olá, ${firstName(c.name)}! Sentimos sua falta na ${b.company.name}. ${offer}`, { sender: 'ia', senderName: 'Reativação', template: { name: a.template_name || TEMPLATES.reativacao.name, params: [firstName(c.name), b.company.name, offer] } });
      await settle(run, r.sent, r.sent ? `Sem comprar há mais de ${days} dias` : r.reason ?? 'não enviado');
      if (r.sent) { sent++; budget--; }
    }
    return sent;
  },

  /* lembretes das tarefas ("me lembra de...") */
  async lembrete_tarefa(b, a) {
    const before = num(a.config.minutos_antes, 30);
    const now = Date.now();
    const { data } = await db.from('tasks').select('*').eq('company_id', b.company.id).is('done_at', null).is('reminded_at', null)
      .lte('due_at', new Date(now + before * 60000).toISOString()).gt('due_at', new Date(now - 6 * 3600000).toISOString()).limit(30);
    const acc = await loadAccount(b.company.id);
    let sent = 0;
    for (const t of data ?? []) {
      const run = await claim(b, a, t.id, t.title);
      if (!run) continue;
      await db.from('tasks').update({ reminded_at: new Date().toISOString() }).eq('id', t.id);
      await notify(b.company.id, 'tarefa', `Lembrete: ${t.title}`, t.due_at ? `${dayName(b, t.due_at)} às ${localTime(t.due_at, b.tz)}` : null, '#/tarefas', t.created_by ?? null);
      let detail = 'Aviso no painel';
      if (acc && t.created_by) {
        const { data: p } = await db.from('members').select('phone, phone_verified_at').eq('company_id', b.company.id).eq('user_id', t.created_by).maybeSingle();
        if (p?.phone && p.phone_verified_at) {
          try {
            if (withinWindow(await lastOwnerWhatsApp(b.company.id, t.created_by))) await sendText(acc, p.phone, `⏰ Lembrete: ${t.title}${t.due_at ? ` (${localTime(t.due_at, b.tz)})` : ''}`);
            else await sendTemplate(acc, p.phone, TEMPLATES.tarefa.name, [t.title]);
            detail = 'Aviso no painel e no WhatsApp';
          } catch (e) { detail = `Aviso no painel (WhatsApp: ${(e as Error).message.slice(0, 120)})`; }
        }
      }
      await settle(run, true, detail);
      sent++;
    }
    return sent;
  },

  /* relatório semanal "o que a ORBYTA fez por você" (dono e gerentes, no WhatsApp e no painel) */
  async relatorio_semanal(b, a) {
    const day = Math.min(6, Math.max(0, num(a.config.dia, 1)));
    const hhmm = /^\d{2}:\d{2}$/.test(String(a.config.horario)) ? String(a.config.horario) : '08:00';
    const now = new Date();
    const today = localDate(now, b.tz);
    if (new Date(today + 'T12:00:00Z').getUTCDay() !== day || localTime(now, b.tz) < hhmm) return 0;
    const from = fromLocal(addDays(today, -7), '00:00', b.tz).toISOString(), to = fromLocal(today, '00:00', b.tz).toISOString();
    const { data: report, error } = await db.rpc('value_report_for', { p_company: b.company.id, p_from: from, p_to: to });
    if (error || !report) { console.error('relatório semanal', error?.message); return 0; }
    const r = report as ValueReport;
    const items = valueHighlights(r);
    const saved = r.minutes_saved >= 30 ? `⏱️ Tempo que você deixou de gastar (estimativa): ${fmtMinutes(r.minutes_saved)}` : '';
    const text = [`*Sua semana na ${b.company.name} com a ORBYTA*`, ...(items.length ? items : ['Semana tranquila: nenhuma conversa nova.']), saved, b.origin ? `Relatório completo: ${b.origin}/app/#/` : ''].filter(Boolean).join('\n');
    let sent = 0;
    // aviso no painel (uma vez por semana), mesmo sem WhatsApp conectado
    if (await claim(b, a, `${today}:painel`, 'Painel')) {
      await notify(b.company.id, 'sistema', 'Sua semana com a ORBYTA', valueOneLine(r), '#/');
      sent++;
    }
    const acc = await loadAccount(b.company.id);
    if (!acc) return sent;
    const { data: people } = await db.from('members').select('user_id, name, phone').eq('company_id', b.company.id).eq('active', true).in('role', ['dono', 'gerente']).not('phone_verified_at', 'is', null);
    for (const p of people ?? []) {
      if (!p.phone || budget <= 0) continue;
      const run = await claim(b, a, `${today}:${p.user_id}`, p.name);
      if (!run) continue;
      let ok = false, detail = 'Relatório da semana';
      try {
        if (withinWindow(await lastOwnerWhatsApp(b.company.id, p.user_id))) await sendText(acc, p.phone, text);
        else await sendTemplate(acc, p.phone, a.template_name || TEMPLATES.relatorio.name, [b.company.name, valueOneLine(r)]);
        ok = true;
      } catch (e) { detail = (e as Error).message; }
      await settle(run, ok, detail);
      if (ok) { sent++; budget--; await db.rpc('bump_usage', { p_company: b.company.id, p_wa: 1 }); }
    }
    return sent;
  },

  /* encaixe: horário cancelado vira oferta para quem está na lista de espera */
  async encaixe(b, a) {
    const minHours = num(a.config.antecedencia_horas, 2);
    const now = Date.now();
    const { data: cancelled } = await db.from('appointments').select('*').eq('company_id', b.company.id).eq('status', 'cancelado')
      .gt('starts_at', new Date(now + minHours * 3600000).toISOString()).lt('starts_at', new Date(now + 21 * 86400000).toISOString())
      .gt('updated_at', new Date(now - 3 * 86400000).toISOString()).order('starts_at').limit(20);
    if (!cancelled?.length) return 0;
    const { data: waiting } = await db.from('waitlist').select('*, contact:contacts(*)').eq('company_id', b.company.id).eq('status', 'aguardando').order('created_at').limit(100);
    const queue = ((waiting ?? []) as (WaitlistEntry & { contact: Contact | null })[]).filter((w) => w.contact?.phone && w.contact.opt_in);
    if (!queue.length) return 0;
    let sent = 0;
    for (const ap of cancelled as Appointment[]) {
      if (budget <= 0 || !queue.length) break;
      // uma oferta por vez para cada horário: espera 2 horas pela resposta antes de oferecer ao próximo (até 3)
      const { data: prev } = await db.from('automation_runs').select('ran_at, target_key').eq('company_id', b.company.id).eq('kind', 'encaixe').like('target_key', `${ap.id}:%`).order('ran_at', { ascending: false });
      if ((prev ?? []).length >= 3 || (prev?.[0] && now - Date.parse(prev[0].ran_at) < 2 * 3600000)) continue;
      const date = localDate(ap.starts_at, b.tz);
      const hour = Number(localTime(ap.starts_at, b.tz).slice(0, 2));
      const period = hour < 12 ? 'manha' : hour < 18 ? 'tarde' : 'noite';
      const duration = Math.round((Date.parse(ap.ends_at) - Date.parse(ap.starts_at)) / 60000);
      const dayStart = fromLocal(date, '00:00', b.tz).toISOString(), dayEnd = fromLocal(addDays(date, 1), '00:00', b.tz).toISOString();
      const { data: dayAppts } = await db.from('appointments').select('*').eq('company_id', b.company.id).lt('starts_at', dayEnd).gt('ends_at', dayStart).not('status', 'in', '(cancelado,faltou)');
      if (!isFree(ap.starts_at, duration, b.company, (dayAppts ?? []) as Appointment[]).ok) continue; // alguém já ocupou
      const offeredBefore = new Set((prev ?? []).map((x) => x.target_key.split(':')[2]));
      const idx = queue.findIndex((w) => !offeredBefore.has(w.contact_id) && (!w.desired_date || w.desired_date === date) && (w.period === 'qualquer' || w.period === period) && (!w.service_id || !ap.service_id || w.service_id === ap.service_id) && w.contact_id !== ap.contact_id);
      if (idx < 0) continue;
      const w = queue.splice(idx, 1)[0];
      const c = w.contact!;
      const run = await claim(b, a, `${ap.id}:${(prev ?? []).length + 1}:${c.id}`, c.name);
      if (!run) continue;
      const quando = dayName(b, ap.starts_at), hora = localTime(ap.starts_at, b.tz);
      const servico = b.services.find((x) => x.id === (w.service_id ?? ap.service_id))?.name ?? ap.title ?? 'o atendimento';
      const text = `Olá, ${firstName(c.name)}! Boa notícia: abriu um horário ${quando} às ${hora} para ${servico}. Quer ficar com ele? É só responder *SIM* por aqui.`;
      const r = await deliverToContact(b, c, text, { sender: 'ia', senderName: 'Encaixe automático', template: { name: a.template_name || TEMPLATES.encaixe.name, params: [firstName(c.name), quando, hora, servico] } });
      await settle(run, r.sent, r.sent ? `Horário ${quando} às ${hora} oferecido` : r.reason ?? 'não enviado');
      if (r.sent) {
        await db.from('waitlist').update({ status: 'oferecido', offered_at: new Date().toISOString(), offered_starts_at: ap.starts_at, service_id: w.service_id ?? ap.service_id }).eq('id', w.id);
        await notify(b.company.id, 'agendamento', `Encaixe oferecido para ${firstName(c.name)}`, `${quando} às ${hora} · ${servico}`, '#/agenda');
        sent++; budget--;
      }
    }
    // ofertas sem resposta há mais de 2 horas voltam para a fila
    await db.from('waitlist').update({ status: 'aguardando', offered_at: null, offered_starts_at: null }).eq('company_id', b.company.id).eq('status', 'oferecido').lt('offered_at', new Date(now - 2 * 3600000).toISOString());
    return sent;
  },
};
