// Leitura de datas, horas, valores, telefones e formas de pagamento em frases em português.
// Usado no assistente da demonstração e no campo de tarefas. Recebe texto já sem acentos e minúsculo (fold).
import { addDays, normalizePhone, parseMoney, weekdayOf } from './format';
import type { PayMethod } from '../app/data/types';
import { fold } from './format';

const WD_WORDS: [RegExp, number][] = [[/\bdomingo\b/, 0], [/\bsegunda\b/, 1], [/\bterca\b/, 2], [/\bquarta\b/, 3], [/\bquinta\b/, 4], [/\bsexta\b/, 5], [/\bsabado\b/, 6]];

export function parseDate(f: string, today: string): string | null {
  if (/\bdepois de amanha\b/.test(f)) return addDays(today, 2);
  if (/\bamanha\b/.test(f)) return addDays(today, 1);
  if (/\bhoje\b/.test(f)) return today;
  const dm = f.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : +today.slice(0, 4);
    let d = `${y}-${String(+dm[2]).padStart(2, '0')}-${String(+dm[1]).padStart(2, '0')}`;
    if (!dm[3] && d < today) d = `${y + 1}${d.slice(4)}`;
    return d;
  }
  const dia = f.match(/\bdia (\d{1,2})\b/);
  if (dia) {
    let d = `${today.slice(0, 8)}${String(+dia[1]).padStart(2, '0')}`;
    if (d < today) { const [y, m] = today.split('-').map(Number); const nm = new Date(Date.UTC(y, m, +dia[1])); d = nm.toISOString().slice(0, 10); }
    return d;
  }
  for (const [re, wd] of WD_WORDS) {
    if (re.test(f)) {
      let d = addDays(today, 1);
      while (weekdayOf(d) !== wd) d = addDays(d, 1);
      if (/\b(proxima|que vem)\b/.test(f) && wd !== weekdayOf(today) && (weekdayOf(addDays(today, 1)) <= wd)) { /* "próxima sexta" = a desta semana se ainda não passou */ }
      return d;
    }
  }
  return null;
}
export function parseTime(f: string): string | null {
  if (/\bmeio[- ]dia\b/.test(f)) return '12:00';
  const m = f.match(/\b(?:as|a partir das|pelas|por volta das|para as|pras)\s+(\d{1,2})(?:(?::|h)(\d{2}))?\s*(?:h|hs|horas)?\b/) || f.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:h|hs|horas)\b/) || f.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  let h = +m[1]; const mi = m[2] ? +m[2] : 0;
  if (h > 23 || mi > 59) return null;
  if (/\b(da tarde|a tarde)\b/.test(f) && h < 12) h += 12;
  if (/\b(da noite)\b/.test(f) && h < 12) h += 12;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
export function parseMoneyIn(raw: string): number | null {
  const m = raw.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/i) || raw.match(/([\d.]+(?:,\d{1,2})?)\s*(?:reais|real|conto)/i) || fold(raw).match(/\b(?:orcamento|venda|valor|cobra|cobrar|por|de)\s+(?:de\s+)?(\d{2,6}(?:[.,]\d{1,2})?)\b(?!\s*(?:h\b|horas|m2|m²|lugares|x\b|%|\/|:))/);
  if (!m) return null;
  const v = parseMoney(m[1]);
  return v > 0 ? v : null;
}
export function parsePhone(raw: string): string | null {
  const m = raw.match(/(?:\+?55[\s-]*)?\(?(\d{2})\)?[\s-]*(9?\d{4})[\s.-]?(\d{4})\b/);
  return m ? normalizePhone(m[1] + m[2] + m[3]) : null;
}
export function parseMethod(f: string): PayMethod | null {
  if (/\bpix\b/.test(f)) return 'pix';
  if (/\bdinheiro|especie\b/.test(f)) return 'dinheiro';
  if (/\bdebito\b/.test(f)) return 'cartao_debito';
  if (/\bcartao|credito\b/.test(f)) return 'cartao_credito';
  if (/\bboleto\b/.test(f)) return 'boleto';
  if (/\btransferencia|ted\b/.test(f)) return 'transferencia';
  return null;
}
