import { describe, expect, it } from 'vitest';
import { dayElapsed, rangeFor, sumPrev, ZERO } from '../metrics';

const row = (day: string, conversations: number) => ({ day, ...ZERO, conversations });

describe('comparação com o período anterior', () => {
  it('7 dias: o dia equivalente a hoje conta só a parte do expediente já passada', () => {
    const r = rangeFor('7d', '2026-10-02');
    expect(r).toMatchObject({ from: '2026-09-26', prevFrom: '2026-09-19', prevTo: '2026-09-25' });
    const rows = [row('2026-09-19', 10), row('2026-09-24', 10), row('2026-09-25', 20), row('2026-09-26', 99)];
    expect(sumPrev(rows, r, 0.5).conversations).toBe(30); // 10 + 10 + metade de 20; o dia 26 já é do período atual
    expect(sumPrev(rows, r, 0).conversations).toBe(20);
    expect(sumPrev(rows, r, 1).conversations).toBe(40);
  });

  it('12 meses: o período anterior termina na mesma data do ano passado', () => {
    expect(rangeFor('12m', '2026-10-02')).toMatchObject({ from: '2025-11-01', prevFrom: '2024-11-01', prevTo: '2025-10-02' });
    expect(rangeFor('12m', '2028-02-29').prevTo).toBe('2027-02-28');
  });

  it('parte do expediente (7h às 20h) no fuso da empresa', () => {
    const tz = 'America/Sao_Paulo';
    expect(dayElapsed(tz, new Date('2026-10-02T06:00:00Z'))).toBe(0); // 3h em São Paulo
    expect(dayElapsed(tz, new Date('2026-10-02T16:30:00Z'))).toBeCloseTo(0.5, 5); // 13h30
    expect(dayElapsed(tz, new Date('2026-10-03T00:30:00Z'))).toBe(1); // 21h30
  });
});

import { timeLeftLabel } from '../../../shared/format';
describe('tempo restante do teste grátis', () => {
  const end = '2026-10-11T04:54:55Z'; // 11/10 às 01:54 em Brasília
  it('não arredonda para cima: 6 dias e 15 horas aparecem como 6 dias', () => {
    expect(timeLeftLabel(end, 'America/Sao_Paulo', Date.parse('2026-10-04T13:37:00Z'))).toBe('6 dias (até 11/10)');
  });
  it('no último dia mostra o horário e, depois do prazo, encerrado', () => {
    expect(timeLeftLabel(end, 'America/Sao_Paulo', Date.parse('2026-10-10T12:00:00Z'))).toBe('menos de 1 dia (até 11/10 às 01:54)');
    expect(timeLeftLabel(end, 'America/Sao_Paulo', Date.parse('2026-10-11T05:00:00Z'))).toBe('encerrado');
  });
});
