// Horários livres de um dia, a partir do horário de funcionamento, do tamanho do horário e da capacidade.
// A mesma regra existe no servidor (supabase/functions/_shared/agenda.ts).
import type { Appointment, Company } from './types';
import { fromLocal, localDate, weekdayOf } from '../../shared/format';

export interface Slot { time: string; startsAt: string; endsAt: string; free: number }

type AgendaCfg = Pick<Company, 'business_hours' | 'slot_minutes' | 'capacity_per_slot' | 'min_notice_minutes' | 'max_days_ahead' | 'timezone'>;

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function overlapping(appts: Appointment[], start: number, end: number): number {
  let n = 0;
  for (const a of appts) {
    if (a.status === 'cancelado' || a.status === 'faltou') continue;
    const s = Date.parse(a.starts_at), e = Date.parse(a.ends_at);
    if (s < end && e > start) n++;
  }
  return n;
}

export function slotsForDate(date: string, cfg: AgendaCfg, appts: Appointment[], durationMin: number, now = new Date()): Slot[] {
  const tz = cfg.timezone || 'America/Sao_Paulo';
  const today = localDate(now, tz);
  if (date < today) return [];
  const maxDay = localDate(new Date(now.getTime() + cfg.max_days_ahead * 86400000), tz);
  if (date > maxDay) return [];
  const intervals = cfg.business_hours[String(weekdayOf(date))] ?? [];
  const step = Math.max(10, cfg.slot_minutes || 60);
  const dur = Math.max(step, durationMin || step);
  const earliest = now.getTime() + (cfg.min_notice_minutes || 0) * 60000;
  const out: Slot[] = [];
  for (const [open, close] of intervals) {
    for (let m = toMin(open); m + dur <= toMin(close); m += step) {
      const start = fromLocal(date, toHHMM(m), tz).getTime();
      if (start < earliest) continue;
      const end = start + dur * 60000;
      const free = cfg.capacity_per_slot - overlapping(appts, start, end);
      if (free > 0) out.push({ time: toHHMM(m), startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), free });
    }
  }
  return out;
}

/** Confere se um horário específico está livre. */
export function isFree(startIso: string, durationMin: number, cfg: AgendaCfg, appts: Appointment[], now = new Date()): { ok: boolean; reason?: string } {
  const tz = cfg.timezone || 'America/Sao_Paulo';
  const date = localDate(startIso, tz);
  const slots = slotsForDate(date, cfg, appts, durationMin, now);
  const t = Date.parse(startIso);
  if (t < now.getTime()) return { ok: false, reason: 'Esse horário já passou.' };
  const intervals = cfg.business_hours[String(weekdayOf(date))] ?? [];
  if (!intervals.length) return { ok: false, reason: 'A empresa não atende nesse dia.' };
  if (slots.some((s) => Date.parse(s.startsAt) === t)) return { ok: true };
  return { ok: false, reason: 'Esse horário não está disponível.' };
}
