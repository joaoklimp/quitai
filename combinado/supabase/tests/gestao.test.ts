// Módulos de gestão com um Postgres de verdade: financeiro, estoque, importação de planilha e base de conhecimento.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDb, type TestDb } from './harness';

let db: TestDb;
let dona: string, atendente: string, outro: string;
let cid: string;
const user = (id: string) => ({ user: id });

beforeAll(async () => {
  db = await startDb();
  dona = await db.createUser('dona@loja.com', 'Dona Lia');
  atendente = await db.createUser('caixa@loja.com', 'Caio Caixa');
  outro = await db.createUser('outro@empresa.com', 'Outro Dono');
  cid = (await db.as(user(dona), (q) => q.one<{ id: string }>(`select public.onboard_company('Loja da Lia', 'outro', '61999990000', 'Brasília', false) as id`))).id;
  await db.as(user(outro), (q) => q.one(`select public.onboard_company('Outra Empresa', 'outro', '11999990000', 'São Paulo', false)`));
  await db.as('service', (q) => q.exec(`insert into members (company_id, user_id, role, name, email) values ($1, $2, 'atendente', 'Caio Caixa', 'caixa@loja.com')`, [cid, atendente]));
}, 180_000);
afterAll(async () => { await db?.stop(); });

describe('financeiro', () => {
  it('dono lança e baixa contas; conta mensal paga gera a do mês seguinte', async () => {
    const e = await db.as(user(dona), (q) => q.one<{ id: string }>(`insert into finance_entries (company_id, kind, description, category, amount, due_date, recurrence)
      values ($1, 'pagar', 'Aluguel', 'Aluguel', 2500, '2026-10-05', 'mensal') returning id`, [cid]));
    await db.as(user(dona), (q) => q.exec(`update finance_entries set paid_at = now(), method = 'pix' where id = $1`, [e.id]));
    const rows = await db.as(user(dona), (q) => q.rows<{ due_date: string; paid: boolean }>(`select to_char(due_date, 'YYYY-MM-DD') as due_date, paid_at is not null as paid from finance_entries where description = 'Aluguel' order by due_date`));
    expect(rows).toEqual([{ due_date: '2026-10-05', paid: true }, { due_date: '2026-11-05', paid: false }]);
    const log = await db.as(user(dona), (q) => q.rows<{ summary: string }>(`select summary from audit_log where action in ('lancar_conta', 'baixar_conta') order by created_at`));
    expect(log.map((l) => l.summary)).toContain('Marcou como paga: Aluguel (R$ 2.500,00)');
  });

  it('atendente não vê nem lança contas; outra empresa também não', async () => {
    expect(await db.as(user(atendente), (q) => q.rows(`select id from finance_entries`))).toHaveLength(0);
    await expect(db.as(user(atendente), (q) => q.exec(`insert into finance_entries (company_id, kind, description, amount, due_date) values ($1, 'receber', 'X', 10, current_date)`, [cid]))).rejects.toThrow(/row-level security/);
    expect(await db.as(user(outro), (q) => q.rows(`select id from finance_entries`))).toHaveLength(0);
    await expect(db.as('anon', (q) => q.rows(`select * from finance_entries`))).rejects.toThrow(/permission denied/);
  });
});

describe('estoque', () => {
  let pid = '';
  it('saldo inicial, entradas e saídas atualizam o produto e o histórico', async () => {
    pid = (await db.as(user(dona), (q) => q.one<{ id: string }>(`insert into products (company_id, name, sku, unit, stock, min_stock, cost, price) values ($1, 'Detergente 5L', 'DET5', 'un', 10, 4, 20, 35) returning id`, [cid]))).id;
    await db.as(user(atendente), (q) => q.exec(`insert into stock_movements (company_id, product_id, kind, qty, note) values ($1, $2, 'saida', 3, 'Uso no serviço')`, [cid, pid]));
    await db.as(user(dona), (q) => q.exec(`insert into stock_movements (company_id, product_id, kind, qty) values ($1, $2, 'entrada', 5)`, [cid, pid]));
    const p = await db.as(user(dona), (q) => q.one<{ stock: string }>(`select stock::text from products where id = $1`, [pid]));
    expect(Number(p.stock)).toBe(12);
    const movs = await db.as(user(dona), (q) => q.rows<{ kind: string; balance_after: string }>(`select kind, balance_after::text from stock_movements where product_id = $1 order by created_at, balance_after`, [pid]));
    expect(movs.map((m) => [m.kind, Number(m.balance_after)])).toEqual([['ajuste', 10], ['saida', 7], ['entrada', 12]]);
  });

  it('saída maior que o saldo é recusada e o saldo não muda direto pelo painel', async () => {
    await expect(db.as(user(dona), (q) => q.exec(`insert into stock_movements (company_id, product_id, kind, qty) values ($1, $2, 'saida', 50)`, [cid, pid]))).rejects.toThrow(/Estoque insuficiente de Detergente 5L/);
    await expect(db.as(user(dona), (q) => q.exec(`update products set stock = 999 where id = $1`, [pid]))).rejects.toThrow(/permission denied/);
    await expect(db.as(user(dona), (q) => q.exec(`delete from stock_movements where product_id = $1`, [pid]))).rejects.toThrow(/permission denied/);
  });

  it('avisa a equipe quando o estoque fica abaixo do mínimo', async () => {
    await db.as(user(dona), (q) => q.exec(`insert into stock_movements (company_id, product_id, kind, qty) values ($1, $2, 'saida', 9)`, [cid, pid]));
    const n = await db.as(user(dona), (q) => q.rows<{ title: string; body: string }>(`select title, body from notifications where kind = 'estoque'`));
    expect(n).toEqual([{ title: 'Estoque baixo: Detergente 5L', body: 'Restam 3 un (mínimo: 4).' }]);
  });

  it('atendente registra saída mas não cadastra produto; outra empresa não vê', async () => {
    await expect(db.as(user(atendente), (q) => q.exec(`insert into products (company_id, name) values ($1, 'X')`, [cid]))).rejects.toThrow(/row-level security/);
    expect(await db.as(user(outro), (q) => q.rows(`select id from products`))).toHaveLength(0);
    await expect(db.as(user(outro), (q) => q.exec(`insert into stock_movements (company_id, product_id, kind, qty) values ($1, $2, 'entrada', 1)`, [cid, pid]))).rejects.toThrow(/row-level security/);
  });

  it('importa planilha: cria novos, atualiza pelo código e acerta o saldo', async () => {
    const r = await db.as(user(dona), (q) => q.one<{ r: { created: number; updated: number; skipped: number } }>(`select public.import_products($1::jsonb) as r`, [[
      { name: 'Detergente 5 litros', sku: 'det5', stock: '20', price: '36' },
      { name: 'Luva nitrílica', unit: 'par', stock: '50', min_stock: '10', category: 'EPI' },
      { name: '', stock: '3' },
    ]]));
    expect(r.r).toEqual({ created: 1, updated: 1, skipped: 1 });
    const list = await db.as(user(dona), (q) => q.rows<{ name: string; stock: string; price: string | null }>(`select name, stock::text, price::text from products order by name`));
    expect(list.map((p) => [p.name, Number(p.stock), p.price && Number(p.price)])).toEqual([['Detergente 5 litros', 20, 36], ['Luva nitrílica', 50, null]]);
    await expect(db.as(user(atendente), (q) => q.one(`select public.import_products('[]'::jsonb)`))).rejects.toThrow(/Só o dono ou um gerente/);
  });
});

describe('base de conhecimento da IA', () => {
  it('o dono salva perguntas e respostas; a atendente não altera', async () => {
    await db.as(user(dona), (q) => q.exec(`update ai_settings set faq = $1::jsonb, web_search = true`, [[{ q: 'Formas de pagamento?', a: 'Pix, cartão em até 3x e dinheiro.' }]]));
    const s = await db.as(user(dona), (q) => q.one<{ faq: { q: string; a: string }[]; web_search: boolean }>(`select faq, web_search from ai_settings`));
    expect(s).toEqual({ faq: [{ q: 'Formas de pagamento?', a: 'Pix, cartão em até 3x e dinheiro.' }], web_search: true });
    expect(await db.as(user(atendente), (q) => q.exec(`update ai_settings set faq = '[]'::jsonb`))).toBe(0);
  });
});
