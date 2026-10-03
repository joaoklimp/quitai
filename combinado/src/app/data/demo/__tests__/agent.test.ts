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
  it('muda o valor de um procedimento com confirmação (caso do print)', async () => {
    const original = table('services').map((s) => [s.id, s.price] as const);
    for (const [cmd, price] of [['Muda o valor da limpeza para R$ 270', 270], ['a limpeza agora custa 280', 280], ['altera o preço do clareamento pra 990', 990]] as const) {
      const r = await runOwnerCommand(cmd);
      expect(r.pending, cmd).toBeTruthy();
      const ok = await runOwnerCommand('sim');
      expect(ok.actions[0].status).toBe('ok');
      const svc = table('services').find((s) => s.id === (r.pending!.args as { service_id: string }).service_id)!;
      expect(svc.price).toBe(price);
    }
    expect(table('services').find((s) => /limpeza/i.test(s.name))!.price).toBe(280);
    for (const [id, price] of original) table('services').find((s) => s.id === id)!.price = price;
  });
  it('responde quanto a clínica recebeu na semana', async () => {
    const r = await runOwnerCommand('Quanto recebemos essa semana?');
    expect(r.reply).toMatch(/receb/);
  });
  it('lista quem ainda não confirmou a consulta de amanhã', async () => {
    const r = await runOwnerCommand('Quem ainda não confirmou amanhã?');
    expect(r.reply).toMatch(/confirm/);
    expect(r.actions[0]).toMatchObject({ tool: 'consultar_agenda' });
  });
  it('agenda cliente num dia útil e recusa domingo', async () => {
    const today = localDate(new Date(), 'America/Sao_Paulo');
    let d = addDays(today, 2); while (weekdayOf(d) !== 2) d = addDays(d, 1); // próxima terça
    const [, m, dd] = d.split('-');
    const r = await runOwnerCommand(`Marca a Marina Duarte ${dd}/${m} às 10h para limpeza com o Dr. Rafael`);
    const ok = r.actions.find((a) => a.tool === 'agendar');
    if (ok) expect(ok.status).toBe('ok'); else expect(r.reply).toMatch(/hor[aá]rio/i);
    let sun = addDays(today, 1); while (weekdayOf(sun) !== 0) sun = addDays(sun, 1);
    const [, sm, sd] = sun.split('-');
    const r2 = await runOwnerCommand(`Agenda a Marina Duarte ${sd}/${sm} às 10h`);
    expect(r2.reply).toMatch(/não atende|não está disponível|sem horários/i);
  });
});

describe('simulador (IA atendendo o paciente)', () => {
  it('passa o valor da limpeza e marca a consulta com a profissional', async () => {
    const a = await runSimulator('Oi! Quanto custa uma limpeza?', { reset: true, name: 'Teste Simulador' });
    expect(a.reply).toMatch(/R\$\s?220/);
    const today = localDate(new Date(), 'America/Sao_Paulo');
    let d = addDays(today, 3); while (weekdayOf(d) !== 3) d = addDays(d, 1); // próxima quarta
    const [, m, dd] = d.split('-');
    const b = await runSimulator(`Quero ${dd}/${m} às 15h com a Dra. Marina`, {});
    expect(b.reply).toMatch(/tenho/i);
    if (/nome completo/.test(b.reply)) {
      const before = table('appointments').length;
      const c = await runSimulator('Joana Prado', {});
      expect(c.reply).toMatch(/Prontinho/);
      expect(c.reply).toMatch(/Dra\. Marina/);
      expect(table('appointments').length).toBe(before + 1);
      expect(table('appointments').at(-1)!.professional_id).toBe(table('professionals').find((p) => p.name.includes('Marina'))!.id);
    }
  });
  it('não orienta sintomas: encaminha para a equipe e, na urgência, indica o SAMU', async () => {
    const a = await runSimulator('Estou com dor e o dente está inchado, posso tomar ibuprofeno?', { reset: true, name: 'Dor Teste' });
    expect(a.handoff).toBe(true);
    expect(a.reply).toMatch(/profissional/);
    expect(a.reply).not.toMatch(/\b(tome|tomar) \d/i);
    const b = await runSimulator('Estou com falta de ar', { reset: true, name: 'Urgência Teste' });
    expect(b.handoff).toBe(true);
    expect(b.reply).toMatch(/192/);
  });
  it('responde sobre convênio com a lista aceita pela clínica', async () => {
    const a = await runSimulator('Vocês aceitam Amil?', { reset: true, name: 'Convênio Teste' });
    expect(a.reply).toMatch(/Amil Dental/);
    const b = await runSimulator('E Hapvida, aceita?', {});
    expect(b.reply).toMatch(/particular/);
  });
  it('pergunta no meio do agendamento não vira o nome do cliente (caso do print)', async () => {
    await runSimulator('Oi, tudo bem?', { reset: true, name: 'Paciente Print' });
    const today = localDate(new Date(), 'America/Sao_Paulo');
    let d = addDays(today, 3); while (weekdayOf(d) !== 5) d = addDays(d, 1); // próxima sexta
    const [, m, dd] = d.split('-');
    const a = await runSimulator(`Tem horário dia ${dd}/${m} às 14h?`, {});
    expect(a.reply).toMatch(/nome completo/);
    const before = table('appointments').length;
    const b = await runSimulator('Quais as formas de pagamento?', {});
    expect(b.reply).toMatch(/Pix/);
    expect(b.reply).toMatch(/nome completo/); // lembra o que falta para reservar
    expect(table('appointments').length).toBe(before);
    expect(table('contacts').find((c) => c.name.startsWith('Quais'))).toBeUndefined();
    const c = await runSimulator('Paula Mendes', {});
    expect(c.reply).toMatch(/Paula/);
    expect(table('appointments').length).toBe(before + 1);
  });
  it('responde pelas perguntas frequentes cadastradas pelo dono', async () => {
    const r = await runSimulator('Vocês atendem crianças?', { reset: true, name: 'Mãe Teste' });
    expect(r.reply).toMatch(/Dra\. Marina/);
    const g = await runSimulator('A avaliação é paga?', {});
    expect(g.reply).toMatch(/gratuita/);
  });
  it('passa para humano quando o paciente reclama', async () => {
    const r = await runSimulator('Esperei 40 minutos e ninguém me atendeu, que absurdo', {});
    expect(r.handoff).toBe(true);
  });
});

describe('financeiro e estoque por comando', () => {
  it('lança conta mensal, consulta e dá baixa com confirmação', async () => {
    const r = await runOwnerCommand('Lança o aluguel da sala de R$ 1.900 todo dia 10');
    expect(r.actions[0]).toMatchObject({ tool: 'lancar_conta', status: 'ok' });
    const e = table('finance_entries').find((x) => x.amount === 1900)!;
    expect(e).toMatchObject({ kind: 'pagar', recurrence: 'mensal', category: 'Aluguel' });
    expect(e.due_date.slice(8)).toBe('10');
    const q = await runOwnerCommand('O que tenho a pagar?');
    expect(q.reply).toMatch(/a pagar/);
    const b = await runOwnerCommand('Paguei o aluguel da sala');
    expect(b.actions[0]).toMatchObject({ tool: 'baixar_conta', status: 'aguardando' });
    await runOwnerCommand('sim');
    expect(table('finance_entries').find((x) => x.id === e.id)!.paid_at).toBeTruthy();
    expect(table('finance_entries').filter((x) => x.description === e.description).length).toBe(2); // a do próximo mês
  });
  it('dá baixa no estoque, recusa saída maior que o saldo e lista o que repor', async () => {
    const p = table('products').find((x) => x.name.startsWith('Resina'))!;
    const start = p.stock;
    const r = await runOwnerCommand('Dá baixa de 1 resina composta');
    expect(r.actions[0]).toMatchObject({ tool: 'movimentar_estoque', status: 'ok' });
    expect(table('products').find((x) => x.id === p.id)!.stock).toBe(start - 1);
    const big = await runOwnerCommand('Usei 500 resinas compostas');
    expect(big.reply).toMatch(/Estoque insuficiente/);
    const low = await runOwnerCommand('O que preciso repor?');
    expect(low.reply).toMatch(/Resina composta/);
  });
});

describe('cobrança e nota fiscal (demonstração)', () => {
  it('cobra o paciente com confirmação, o pagamento vira recebimento e a nota é emitida', async () => {
    const { api } = await import('../../api');
    const { setInstantDemo } = await import('../demoSource');
    setInstantDemo(true);
    const juliana = findContacts('Ricardo Almeida')[0];
    const r = await runOwnerCommand('Cobra R$ 250 do Ricardo Almeida para sexta');
    expect(r.actions[0]).toMatchObject({ tool: 'cobrar_cliente', status: 'aguardando' });
    const before = table('charges').length;
    const ok = await runOwnerCommand('sim');
    expect(ok.actions[0]).toMatchObject({ tool: 'cobrar_cliente', status: 'ok' });
    expect(table('charges').length).toBe(before + 1);
    const ch = table('charges')[0];
    expect(ch).toMatchObject({ contact_id: juliana.id, amount: 250, status: 'pendente', created_via: 'ia_dono' });
    expect(table('finance_entries').find((x) => x.id === ch.finance_entry_id)).toMatchObject({ kind: 'receber', amount: 250 });

    const sales = table('sales').length;
    await api.integrations('demo_pay', { id: ch.id });
    expect(table('charges')[0].status).toBe('paga');
    expect(table('sales').length).toBe(sales + 1);
    expect(table('finance_entries').find((x) => x.id === ch.finance_entry_id)!.paid_at).toBeTruthy();

    const n = await runOwnerCommand('Emite a nota do Ricardo Almeida');
    expect(n.actions[0]).toMatchObject({ tool: 'emitir_nota', status: 'aguardando' });
    await runOwnerCommand('sim');
    await new Promise((res) => setTimeout(res, 5));
    const note = table('fiscal_notes')[0];
    expect(note).toMatchObject({ charge_id: ch.id, amount: 250, status: 'autorizada' });
    expect(note.number).toBeTruthy();
  });
  it('pede o CPF quando o paciente não tem', async () => {
    const c = table('contacts').find((x) => !x.document && x.name.split(' ').length >= 2 && findContacts(x.name).length === 1)!;
    const r = await runOwnerCommand(`Cobra R$ 90 do ${c.name}`);
    expect(r.reply).toMatch(/CPF ou CNPJ/);
    expect(r.actions).toHaveLength(0);
  });
});

describe('valor para o empreendedor (demonstração)', () => {
  it('relatório de valor mostra o que a IA fez no mês', async () => {
    const { demoValueReport } = await import('../demoSource');
    const now = new Date();
    const r = demoValueReport(new Date(now.getTime() - 30 * 86400000).toISOString(), now.toISOString());
    expect(r.ia_replies).toBeGreaterThan(0);
    expect(r.minutes_saved).toBeGreaterThan(0);
    expect(r.after_hours).toBeLessThanOrEqual(r.ia_replies);
  });
  it('horário cancelado é oferecido para quem está na lista de espera', async () => {
    const { api } = await import('../../api');
    const fernanda = table('waitlist').find((w) => w.status === 'aguardando' && w.desired_date)!;
    const day = fernanda.desired_date!;
    const other = table('contacts').find((c) => c.id !== fernanda.contact_id)!;
    const ap = await api.insert('appointments', { contact_id: other.id, title: 'Limpeza (profilaxia)', starts_at: new Date(`${day}T15:00:00-03:00`).toISOString(), ends_at: new Date(`${day}T16:00:00-03:00`).toISOString(), status: 'confirmado', created_via: 'painel' });
    await api.update('appointments', ap.id, { status: 'cancelado' });
    const w = table('waitlist').find((x) => x.id === fernanda.id)!;
    expect(w.status).toBe('oferecido');
    expect(table('notifications')[0].title).toMatch(/Encaixe oferecido/);
    const r = await runOwnerCommand('Quem está na lista de espera?');
    expect(r.reply).toMatch(/encaixe oferecido/);
  });
  it('no simulador, o paciente pede para entrar na lista de espera', async () => {
    const r = await runSimulator('Me coloca na lista de espera para sábado', { reset: true, name: 'Lia Teste' });
    expect(r.actions[0]).toMatchObject({ tool: 'entrar_lista_espera' });
    expect(table('waitlist').some((w) => w.status === 'aguardando' && findContacts('Lia Teste')[0]?.id === w.contact_id)).toBe(true);
  });
});
