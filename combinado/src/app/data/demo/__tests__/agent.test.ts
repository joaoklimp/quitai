import { describe, expect, it, beforeAll } from 'vitest';
import { parseDate, parseMoneyIn, parsePhone, parseTime, runOwnerCommand, runSimulator, setInstant, findContacts } from '../agent';
import { demoDb, table } from '../db';
import { addDays, localDate, weekdayOf } from '../../../../shared/format';

beforeAll(() => setInstant(true));

describe('extração de dados', () => {
  it('entende valores em reais', () => {
    expect(parseMoneyIn('cria um orçamento de R$ 350 para ela')).toBe(350);
    expect(parseMoneyIn('venda de R$1.250,90 no pix')).toBe(1250.9);
    expect(parseMoneyIn('orçamento de 480 reais')).toBe(480);
    expect(parseMoneyIn('agenda sexta às 14h')).toBeNull();
  });
  it('entende telefones brasileiros', () => {
    expect(parsePhone('telefone 61999999999')).toBe('5561999999999');
    expect(parsePhone('fone (61) 98888-7777')).toBe('5561988887777');
  });
  it('entende datas e horas', () => {
    const today = '2026-10-02'; // sexta
    expect(parseDate('amanha', today)).toBe('2026-10-03');
    expect(parseDate('segunda as 10h', today)).toBe('2026-10-05');
    expect(parseDate('dia 15', today)).toBe('2026-10-15');
    expect(parseDate('15/11', today)).toBe('2026-11-15');
    expect(parseTime('sexta as 14h')).toBe('14:00');
    expect(parseTime('as 9:30')).toBe('09:30');
    expect(parseTime('meio-dia')).toBe('12:00');
  });
});

describe('comandos do dono', () => {
  it('cadastra cliente e cria orçamento na mesma frase (exemplo da Maria)', async () => {
    demoDb();
    const before = table('quotes').length;
    const r = await runOwnerCommand('Cadastra a Marina Duarte, telefone 61988887766, e cria um orçamento de R$ 350 para ela.');
    expect(r.actions.map((a) => a.tool)).toEqual(expect.arrayContaining(['cadastrar_cliente', 'criar_orcamento']));
    expect(table('quotes').length).toBe(before + 1);
    const c = findContacts('Marina Duarte')[0];
    expect(c?.phone).toBe('5561988887766');
    expect(table('quotes')[0].contact_id).toBe(c.id);
    expect(table('quotes')[0].total).toBe(350);
    expect(r.reply).toMatch(/Combinado/);
  });
  it('venda pede confirmação e só registra depois do SIM', async () => {
    const before = table('sales').length;
    const r = await runOwnerCommand('Registra uma venda de R$ 200 no pix para a Marina Duarte');
    expect(r.pending).toBeTruthy();
    expect(table('sales').length).toBe(before);
    const ok = await runOwnerCommand('sim');
    expect(ok.actions[0].status).toBe('ok');
    expect(table('sales').length).toBe(before + 1);
    expect(table('sales')[0].amount).toBe(200);
  });
  it('responde quanto vendeu na semana', async () => {
    const r = await runOwnerCommand('Quanto vendi essa semana?');
    expect(r.reply).toMatch(/vend/);
  });
  it('agenda cliente num dia útil e recusa domingo', async () => {
    const today = localDate(new Date(), 'America/Sao_Paulo');
    let d = addDays(today, 2); while (weekdayOf(d) !== 2) d = addDays(d, 1); // próxima terça
    const [, m, dd] = d.split('-');
    const r = await runOwnerCommand(`Agenda a Marina Duarte ${dd}/${m} às 10h para limpeza de sofá 3 lugares`);
    const ok = r.actions.find((a) => a.tool === 'agendar');
    if (ok) expect(ok.status).toBe('ok'); else expect(r.reply).toMatch(/hor[aá]rio/i);
    let sun = addDays(today, 1); while (weekdayOf(sun) !== 0) sun = addDays(sun, 1);
    const [, sm, sd] = sun.split('-');
    const r2 = await runOwnerCommand(`Agenda a Marina Duarte ${sd}/${sm} às 10h`);
    expect(r2.reply).toMatch(/não atende|não está disponível|sem horários/i);
  });
});

describe('simulador (IA atendendo o cliente)', () => {
  it('passa o preço do sofá e reserva o horário', async () => {
    const a = await runSimulator('Oi! Quanto custa uma limpeza de sofá?', { reset: true, name: 'Teste Simulador' });
    expect(a.reply).toMatch(/R\$\s?180/);
    const today = localDate(new Date(), 'America/Sao_Paulo');
    let d = addDays(today, 3); while (weekdayOf(d) !== 3) d = addDays(d, 1); // próxima quarta
    const [, m, dd] = d.split('-');
    const b = await runSimulator(`Quero ${dd}/${m} às 15h.`, {});
    expect(b.reply).toMatch(/dispon[ií]vel|tenho/i);
    if (/Posso reservar/.test(b.reply)) {
      const before = table('appointments').length;
      const c = await runSimulator('Joana Prado, SQS 102 Bloco A, Asa Sul', {});
      expect(c.reply).toMatch(/Combinado/);
      expect(table('appointments').length).toBe(before + 1);
    }
  });
  it('passa para humano quando o cliente reclama', async () => {
    const r = await runSimulator('O técnico não apareceu, que absurdo', {});
    expect(r.handoff).toBe(true);
  });
});
