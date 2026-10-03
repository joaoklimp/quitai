// Textos do relatório "o que a ORBYTA fez por você": os mesmos no painel e no WhatsApp.
import type { ValueReport } from '../app/data/types';
import { brl } from './format';

/** "3h 20min", "45 min" */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}min` : `${h}h`;
}

/** Destaques em frases curtas, do mais importante para o menos. Só entra o que aconteceu de fato. */
export function valueHighlights(r: ValueReport): string[] {
  const out: string[] = [];
  const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  if (r.ia_replies) out.push(`💬 Respondi ${pl(r.ia_conversations, 'paciente', 'pacientes')} (${pl(r.ia_replies, 'mensagem', 'mensagens')})${r.after_hours ? `, ${r.after_hours} fora do horário comercial` : ''}`);
  if (r.appointments) out.push(`📅 Marquei ${pl(r.appointments, 'consulta', 'consultas')} na agenda`);
  if (r.encaixes) out.push(`🔁 Encaixei ${pl(r.encaixes, 'paciente', 'pacientes')} em horários desmarcados`);
  if (r.quotes) out.push(`📄 Montei ${pl(r.quotes, 'orçamento', 'orçamentos')}${r.quotes_approved ? `, ${r.quotes_approved} aprovados (${brl(r.quotes_approved_value)})` : ''}`);
  if (r.sales_ia) out.push(`💰 ${pl(r.sales_ia, 'consulta marcada por mim foi paga', 'consultas marcadas por mim foram pagas')} (${brl(r.sales_ia_value)})`);
  if (r.charges_paid) out.push(`✅ Recebi ${pl(r.charges_paid, 'cobrança', 'cobranças')} por Pix ou boleto (${brl(r.charges_value)})`);
  const auto = r.reminders + r.followups + r.reviews_asked + r.reactivations;
  if (auto) out.push(`🔔 Mandei ${pl(auto, 'lembrete ou acompanhamento', 'lembretes e acompanhamentos')}`);
  if (r.owner_commands) out.push(`⚡ Executei ${pl(r.owner_commands, 'pedido seu', 'pedidos seus')}`);
  return out;
}

/** Uma linha só, para o modelo de mensagem do WhatsApp (sem quebras). */
export function valueOneLine(r: ValueReport): string {
  const parts = [
    r.ia_conversations ? `${r.ia_conversations} pacientes atendidos` : '',
    r.appointments ? `${r.appointments} consultas marcadas` : '',
    r.quotes ? `${r.quotes} orçamentos` : '',
    r.charges_value ? `${brl(r.charges_value)} recebidos` : '',
    r.minutes_saved >= 30 ? `cerca de ${fmtMinutes(r.minutes_saved)} economizadas` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'semana tranquila, sem novidades';
}
