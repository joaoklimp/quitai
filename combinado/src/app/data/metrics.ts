// Contas do painel a partir dos agregados diários (iguais no modo demo e no Supabase).
import type { DailyStat } from './types';
import { addDays, daysBetween, localParts, MONTHS_SHORT, weekdayOf } from '../../shared/format';

export type Period = '7d' | '30d' | '90d' | '12m';
export const PERIOD_LABEL: Record<Period, string> = { '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', '12m': 'Últimos 12 meses' };
export const PERIOD_SHORT: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', '12m': '12 meses' };

export const ZERO: Omit<DailyStat, 'day'> = {
  msgs_in: 0, msgs_ai: 0, msgs_team: 0, conversations: 0, new_contacts: 0, quotes_created: 0, quotes_sent: 0, quotes_approved: 0, quotes_value: 0,
  sales_count: 0, sales_amount: 0, sales_ia: 0, sales_equipe: 0, sales_balcao: 0, appointments: 0, response_sum: 0, response_count: 0, handoffs: 0,
};
const KEYS = Object.keys(ZERO) as (keyof typeof ZERO)[];

export function sum(rows: DailyStat[]): DailyStat {
  const out: DailyStat = { day: '', ...ZERO };
  for (const r of rows) for (const k of KEYS) out[k] += Number(r[k] ?? 0);
  return out;
}

export interface Range { from: string; to: string; prevFrom: string; prevTo: string; bucket: 'day' | 'week' | 'month'; days: number }
export function rangeFor(period: Period, today: string): Range {
  if (period === '12m') {
    const from = `${addDays(today, -365).slice(0, 7)}-01`;
    const start = addDays(`${today.slice(0, 7)}-01`, 0);
    // 12 meses fechando no mês atual
    const [y, m] = start.split('-').map(Number);
    const fromM = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10);
    const prevFromM = new Date(Date.UTC(y, m - 1 - 23, 1)).toISOString().slice(0, 10);
    void from;
    // o período anterior termina na mesma data do ano passado (o mês atual ainda não acabou)
    const [ty, tm, td] = today.split('-').map(Number);
    const sameDay = Math.min(td, new Date(Date.UTC(ty - 1, tm, 0)).getUTCDate());
    const prevTo = `${ty - 1}-${String(tm).padStart(2, '0')}-${String(sameDay).padStart(2, '0')}`;
    return { from: fromM, to: today, prevFrom: prevFromM, prevTo, bucket: 'month', days: daysBetween(fromM, today) + 1 };
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = addDays(today, -(days - 1));
  return { from, to: today, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), bucket: period === '90d' ? 'week' : 'day', days };
}

/**
 * Quanto do expediente de hoje já passou (das 7h às 20h, no fuso da empresa), de 0 a 1.
 * Hoje ainda não acabou: comparar com dias inteiros do período anterior mostraria queda todo começo de dia.
 */
export function dayElapsed(tz: string, now: Date = new Date()): number {
  const { h, mi } = localParts(now, tz);
  return Math.min(1, Math.max(0, (h * 60 + mi - 7 * 60) / (13 * 60)));
}

/** Período anterior até o mesmo ponto: o dia equivalente a hoje (prevTo) conta só a parte do expediente já passada. */
export function sumPrev(rows: DailyStat[], range: Range, elapsed: number): DailyStat {
  const out = sum(rows.filter((r) => r.day >= range.prevFrom && r.day < range.prevTo));
  const last = rows.find((r) => r.day === range.prevTo);
  if (last) for (const k of KEYS) out[k] += Number(last[k] ?? 0) * elapsed;
  return out;
}

export interface Bucket { key: string; label: string; long: string; start: string; end: string; stat: DailyStat }
export function bucketize(rows: DailyStat[], range: Range): Bucket[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: Bucket[] = [];
  if (range.bucket === 'day') {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const [, m, dd] = d.split('-').map(Number);
      const wd = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][weekdayOf(d)];
      out.push({ key: d, label: range.days <= 7 ? wd : `${dd}`, long: `${wd}, ${dd} ${MONTHS_SHORT[m - 1]}`, start: d, end: d, stat: byDay.get(d) ?? { day: d, ...ZERO } });
    }
  } else if (range.bucket === 'week') {
    let start = range.from;
    while (weekdayOf(start) !== 1) start = addDays(start, -1);
    for (let s = start; s <= range.to; s = addDays(s, 7)) {
      const e = addDays(s, 6);
      const days: DailyStat[] = [];
      for (let d = s; d <= e; d = addDays(d, 1)) if (d >= range.from && d <= range.to) { const r = byDay.get(d); if (r) days.push(r); }
      const [, m, dd] = s.split('-').map(Number);
      out.push({ key: s, label: `${dd}/${String(m).padStart(2, '0')}`, long: `Semana de ${dd} ${MONTHS_SHORT[m - 1]}`, start: s, end: e, stat: { ...sum(days), day: s } });
    }
  } else {
    const [fy, fm] = range.from.split('-').map(Number);
    for (let i = 0; i < 12; i++) {
      const d0 = new Date(Date.UTC(fy, fm - 1 + i, 1));
      const s = d0.toISOString().slice(0, 10);
      const e = new Date(Date.UTC(fy, fm + i, 0)).toISOString().slice(0, 10);
      const days = rows.filter((r) => r.day >= s && r.day <= e);
      const mm = d0.getUTCMonth();
      out.push({ key: s.slice(0, 7), label: MONTHS_SHORT[mm], long: `${MONTHS_SHORT[mm]} ${d0.getUTCFullYear()}`, start: s, end: e, stat: { ...sum(days), day: s } });
    }
  }
  return out;
}

/** Variação relativa (0.18 = +18%). null quando não há base de comparação. */
export function change(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return (cur - prev) / prev;
}

export function avgResponse(s: DailyStat): number { return s.response_count ? s.response_sum / s.response_count : 0; }
export function aiShare(s: DailyStat): number { const t = s.msgs_ai + s.msgs_team; return t ? s.msgs_ai / t : 0; }
export function conversion(s: DailyStat): number { return s.conversations ? s.sales_count / s.conversations : 0; }
export function approvalRate(s: DailyStat): number { return s.quotes_sent ? s.quotes_approved / s.quotes_sent : 0; }
export function chatRevenue(s: DailyStat): number { return s.sales_ia + s.sales_equipe; }
