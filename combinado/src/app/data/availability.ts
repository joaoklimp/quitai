// Horários livres de um dia, a partir do horário de funcionamento, do tamanho do horário e de quem atende.
// Clínica com profissionais cadastrados: cada profissional tem a própria agenda (e, se quiser, o próprio horário
// e os procedimentos que faz); um horário está livre quando ao menos um profissional que atende o procedimento
// está livre. Sem profissionais, vale a capacidade por horário da empresa.
// O servidor usa a mesma regra (cópia gerada em supabase/functions/_shared/availability.ts).
import type { Appointment, BusinessHours, Company, Professional } from './types';
import { fromLocal, localDate, weekdayOf } from '../../shared/format';

export interface Slot { time: string; startsAt: string; endsAt: string; free: number; /** profissionais livres nesse horário */ pros: string[] }

type AgendaCfg = Pick<Company, 'business_hours' | 'slot_minutes' | 'capacity_per_slot' | 'min_notice_minutes' | 'max_days_ahead' | 'timezone'>;
type Pro = Pick<Professional, 'id' | 'name' | 'active' | 'business_hours' | 'service_ids'>;

export interface SlotOpts {
  /** profissionais da clínica (todos; os inativos são ignorados) */
  professionals?: Pro[];
  /** procedimento escolhido: só conta quem atende */
  serviceId?: string | null;
  /** profissional pedido pelo paciente */
  professionalId?: string | null;
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const live = (a: Appointment) => a.status !== 'cancelado' && a.status !== 'faltou';
const hits = (a: Appointment, start: number, end: number) => Date.parse(a.starts_at) < end && Date.parse(a.ends_at) > start;

export function overlapping(appts: Appointment[], start: number, end: number): number {
  let n = 0;
  for (const a of appts) if (live(a) && hits(a, start, end)) n++;
  return n;
}

/** Profissionais que podem fazer o procedimento (e, se pedido, só aquele profissional). */
export function eligiblePros(opts: SlotOpts = {}): Pro[] {
  return (opts.professionals ?? []).filter((p) => p.active
    && (!opts.professionalId || p.id === opts.professionalId)
    && (!opts.serviceId || !p.service_ids?.length || p.service_ids.includes(opts.serviceId)));
}

const within = (hours: BusinessHours, date: string, from: number, to: number) =>
  (hours[String(weekdayOf(date))] ?? []).some(([o, c]) => toMin(o) <= from && to <= toMin(c));

export function slotsForDate(date: string, cfg: AgendaCfg, appts: Appointment[], durationMin: number, now = new Date(), opts: SlotOpts = {}): Slot[] {
  const tz = cfg.timezone || 'America/Sao_Paulo';
  const today = localDate(now, tz);
  if (date < today) return [];
  const maxDay = localDate(new Date(now.getTime() + cfg.max_days_ahead * 86400000), tz);
  if (date > maxDay) return [];
  const usePros = (opts.professionals ?? []).some((p) => p.active);
  const pros = usePros ? eligiblePros(opts) : [];
  if (usePros && !pros.length) return [];
  // o dia abre do primeiro horário da clínica ou de algum profissional até o último
  const intervals = usePros
    ? [cfg.business_hours, ...pros.map((p) => p.business_hours).filter(Boolean)].flatMap((h) => (h as BusinessHours)[String(weekdayOf(date))] ?? [])
    : cfg.business_hours[String(weekdayOf(date))] ?? [];
  const step = Math.max(10, cfg.slot_minutes || 60);
  const dur = Math.max(step, durationMin || step);
  const earliest = now.getTime() + (cfg.min_notice_minutes || 0) * 60000;
  const seen = new Set<number>();
  const out: Slot[] = [];
  for (const [open, close] of intervals) {
    for (let m = toMin(open); m + dur <= toMin(close); m += step) {
      if (seen.has(m)) continue;
      seen.add(m);
      const start = fromLocal(date, toHHMM(m), tz).getTime();
      if (start < earliest) continue;
      const end = start + dur * 60000;
      if (!usePros) {
        const free = cfg.capacity_per_slot - overlapping(appts, start, end);
        if (free > 0) out.push({ time: toHHMM(m), startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), free, pros: [] });
        continue;
      }
      const freePros = pros.filter((p) => within(p.business_hours ?? cfg.business_hours, date, m, m + dur)
        && !appts.some((a) => live(a) && a.professional_id === p.id && hits(a, start, end)));
      // consultas sem profissional definido ocupam uma vaga qualquer
      const unassigned = appts.filter((a) => live(a) && !a.professional_id && hits(a, start, end)).length;
      const free = freePros.length - unassigned;
      if (free > 0) out.push({ time: toHHMM(m), startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), free, pros: freePros.map((p) => p.id) });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Confere se um horário específico está livre e, havendo profissionais, quem pode atender. */
export function isFree(startIso: string, durationMin: number, cfg: AgendaCfg, appts: Appointment[], now = new Date(), opts: SlotOpts = {}): { ok: boolean; reason?: string; professionalId?: string } {
  const tz = cfg.timezone || 'America/Sao_Paulo';
  const date = localDate(startIso, tz);
  const t = Date.parse(startIso);
  if (t < now.getTime()) return { ok: false, reason: 'Esse horário já passou.' };
  const slots = slotsForDate(date, cfg, appts, durationMin, now, opts);
  const usePros = (opts.professionals ?? []).some((p) => p.active);
  if (!usePros && !(cfg.business_hours[String(weekdayOf(date))] ?? []).length) return { ok: false, reason: 'A clínica não atende nesse dia.' };
  if (usePros && !eligiblePros(opts).length) return { ok: false, reason: opts.professionalId ? 'Esse profissional não faz esse procedimento.' : 'Nenhum profissional faz esse procedimento.' };
  const slot = slots.find((s) => Date.parse(s.startsAt) === t);
  if (slot) return { ok: true, professionalId: slot.pros[0] };
  return { ok: false, reason: opts.professionalId ? 'Esse profissional não tem esse horário livre.' : 'Esse horário não está disponível.' };
}
