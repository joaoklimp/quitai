// Formatação em português do Brasil: dinheiro, números, datas no fuso da empresa e telefones.
// Este arquivo tem uma cópia em supabase/functions/_shared/text.ts (mantenha as duas iguais).

let displayTz = 'America/Sao_Paulo';
export function setDisplayTimeZone(tz: string) { displayTz = tz || 'America/Sao_Paulo'; }
export function getDisplayTimeZone() { return displayTz; }

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0Fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('pt-BR');

export function brl(v: number | null | undefined): string { return brlFmt.format(Number(v ?? 0)); }
export function brl0(v: number | null | undefined): string { return brl0Fmt.format(Math.round(Number(v ?? 0))); }
/** R$ 12,4 mil / R$ 1,2 mi */
export function brlShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e4) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return brl0(v);
}
export function num(v: number | null | undefined): string { return numFmt.format(Number(v ?? 0)); }
export function numShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e4) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return numFmt.format(Math.round(v));
}
export function pct(v: number, digits = 0): string {
  return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}
/** Interpreta "1.234,56", "1234.56", "R$ 350" etc. */
export function parseMoney(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').replace(/[^\d,.-]/g, '');
  if (!t) return 0;
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.')) || 0;
  const parts = t.split('.');
  if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) return Number(t.replace(/\./g, '')) || 0;
  return Number(t) || 0;
}

/* ---------- datas ---------- */

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    partsCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export type LocalParts = { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number };
/** Partes da data/hora no fuso informado. */
export function localParts(date: Date | string | number, tz = displayTz): LocalParts {
  const dt = date instanceof Date ? date : new Date(date);
  const p: Record<string, string> = {};
  for (const x of partsFmt(tz).formatToParts(dt)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WD[p.weekday] ?? 0 };
}
/** "2026-10-02" no fuso informado. */
export function localDate(date: Date | string | number, tz = displayTz): string {
  const p = localParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
export function localTime(date: Date | string | number, tz = displayTz): string {
  const p = localParts(date, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}
/** Converte data e hora locais (no fuso da empresa) para o instante UTC correspondente. */
export function fromLocal(dateStr: string, timeStr = '00:00', tz = displayTz): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0);
  // ajusta pela diferença do fuso (duas passadas cobrem a troca de horário de verão)
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    t += guess - asUtc;
  }
  return new Date(t);
}
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export function todayLocal(tz = displayTz): string { return localDate(new Date(), tz); }

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 02/10/2026 */
export function fmtDate(v: Date | string | number | null | undefined, tz = displayTz): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; }
  const p = localParts(v, tz);
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}
/** 2 out */
export function fmtDayMonth(v: Date | string | number, tz = displayTz): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [, m, d] = v.split('-').map(Number); return `${d} ${MONTHS_SHORT[m - 1]}`; }
  const p = localParts(v, tz);
  return `${p.d} ${MONTHS_SHORT[p.m - 1]}`;
}
/** sexta-feira, 2 de outubro */
export function fmtLong(v: Date | string | number, tz = displayTz): string {
  let p: { d: number; m: number; wd: number };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [, m, d] = v.split('-').map(Number); p = { d, m, wd: weekdayOf(v) }; }
  else p = localParts(v, tz);
  return `${WEEKDAYS[p.wd]}, ${p.d} de ${MONTHS[p.m - 1]}`;
}
/** 14:30 */
export function fmtTime(v: Date | string | number, tz = displayTz): string { return localTime(v, tz); }
/** 02/10 às 14:30 */
export function fmtDateTime(v: Date | string | number | null | undefined, tz = displayTz): string {
  if (v == null || v === '') return '—';
  const p = localParts(v, tz);
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')} às ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}
/** "agora", "há 5 min", "há 2 h", "ontem", "3 dias", "02/10" */
export function fmtAgo(v: Date | string | number | null | undefined, now = Date.now()): string {
  if (v == null || v === '') return '—';
  const t = new Date(v).getTime();
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400 && localDate(t) === localDate(now)) return `há ${Math.round(s / 3600)} h`;
  const days = daysBetween(localDate(t), localDate(now));
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return fmtDate(t);
}
/** Hora curta para listas de conversa: 14:30, ontem, seg, 02/10 */
export function fmtListTime(v: Date | string | number | null | undefined, now = Date.now()): string {
  if (v == null || v === '') return '';
  const days = daysBetween(localDate(v), localDate(now));
  if (days <= 0) return localTime(v);
  if (days === 1) return 'ontem';
  if (days < 7) return WEEKDAYS_SHORT[localParts(v).wd];
  const p = localParts(v);
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;
}
/** 1h 05min / 2min 09s */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r ? `${m}min ${String(r).padStart(2, '0')}s` : `${m}min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${String(mm).padStart(2, '0')}min` : `${h}h`;
}

/* ---------- telefone ---------- */

/** Só dígitos, com DDI 55 para números brasileiros (10 ou 11 dígitos). */
export function normalizePhone(raw: string | null | undefined): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  // celular brasileiro sem o 9 (WhatsApp às vezes manda assim): mantém como veio
  return d;
}
/** (61) 99999-9999 */
export function formatPhone(raw: string | null | undefined): string {
  const d = normalizePhone(raw);
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4), n = d.slice(4);
    return n.length === 9 ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}` : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
  }
  return `+${d}`;
}
/** Variantes do mesmo número (com e sem o nono dígito) para encontrar o cliente certo. */
export function phoneVariants(raw: string): string[] {
  const d = normalizePhone(raw);
  const out = new Set([d]);
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith('55') && d.length === 12) out.add(d.slice(0, 4) + '9' + d.slice(4));
  return [...out];
}

/* ---------- texto ---------- */

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export function firstName(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] || '';
}
/** Remove acentos e deixa em minúsculas (para buscas). */
export function fold(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
export function plural(n: number, one: string, many: string): string { return `${num(n)} ${n === 1 ? one : many}`; }
export function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
