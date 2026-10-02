// Testes do banco com um Postgres de verdade: isolamento entre empresas (RLS), permissões da equipe,
// orçamentos, página pública, mensagens, números do painel, assinatura, agenda, uso e histórico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDb, type Q, type TestDb } from './harness';

let db: TestDb;
let ana: string, beto: string, carla: string; // Ana (dona da Brilho Lar), Beto (dono de outra empresa), Carla (atendente da Ana)
let cidA: string, cidB: string;

const user = (id: string) => ({ user: id });

beforeAll(async () => {
  db = await startDb();
  ana = await db.createUser('ana@brilholar.com', 'Ana Duarte');
  beto = await db.createUser('beto@oficina.com', 'Beto Lima');
  carla = await db.createUser('carla@brilholar.com', 'Carla Souza');
}, 180_000);
afterAll(async () => { await db?.stop(); });

describe('primeira configuração', () => {
  it('cria a empresa com dono, IA, automações e serviços do segmento', async () => {
    cidA = (await db.as(user(ana), (q) => q.one<{ id: string }>(`select public.onboard_company('Brilho Lar Higienização', 'limpeza', '(61) 99999-0000', 'Brasília', true) as id`))).id;
    const info = await db.as(user(ana), (q) => q.one<{ services: number; automations: number; role: string; greeting: string; phone: string; audits: number }>(`
      select (select count(*)::int from services) as services, (select count(*)::int from automations) as automations,
             (select role from members where user_id = auth.uid()) as role, (select greeting from ai_settings) as greeting,
             (select phone from companies) as phone, (select count(*)::int from audit_log) as audits`));
    expect(info).toEqual({ services: 5, automations: 8, role: 'dono', greeting: 'Olá! Aqui é da Brilho Lar Higienização. Como posso ajudar?', phone: '5561999990000', audits: 1 });
  });

  it('não deixa a mesma pessoa criar duas empresas', async () => {
    await expect(db.as(user(ana), (q) => q.one(`select public.onboard_company('Outra', 'outro', '', null, false)`))).rejects.toThrow('já faz parte');
  });

  it('segunda empresa e uma atendente na primeira', async () => {
    cidB = (await db.as(user(beto), (q) => q.one<{ id: string }>(`select public.onboard_company('Oficina do Beto', 'oficina', '11988887777', 'São Paulo', true) as id`))).id;
    await db.as('service', (q) => q.exec(`insert into members (company_id, user_id, role, name, email) values ($1, $2, 'atendente', 'Carla Souza', 'carla@brilholar.com')`, [cidA, carla]));
    expect(cidB).not.toBe(cidA);
  });
});

describe('isolamento entre empresas (RLS)', () => {
  it('uma empresa não vê nem altera os dados da outra', async () => {
    const contact = await db.as(user(ana), (q) => q.one<{ id: string }>(`insert into contacts (company_id, name, phone) values ($1, 'Maria Silva', '61 98765-4321') returning id`, [cidA]));
    const seen = await db.as(user(beto), (q) => q.rows(`select id from contacts`));
    expect(seen).toHaveLength(0);
    await expect(db.as(user(beto), (q) => q.exec(`insert into contacts (company_id, name) values ($1, 'Intruso')`, [cidA]))).rejects.toThrow(/row-level security/);
    const changed = await db.as(user(beto), (q) => q.exec(`update contacts set name = 'Hackeado' where id = $1`, [contact.id]));
    expect(changed).toBe(0);
    const services = await db.as(user(beto), (q) => q.rows<{ name: string }>(`select name from services order by sort`));
    expect(services[0].name).toBe('Troca de óleo e filtro'); // só os da oficina
  });

  it('dados internos (tokens, cobrança, contadores) ficam fora do alcance do painel', async () => {
    await expect(db.as(user(ana), (q) => q.rows(`select * from whatsapp_credentials`))).rejects.toThrow(/permission denied/);
    await expect(db.as(user(ana), (q) => q.rows(`select * from billing_accounts`))).rejects.toThrow(/permission denied/);
    await expect(db.as('anon', (q) => q.rows(`select * from quotes`))).rejects.toThrow(/permission denied/);
  });

  it('o painel não altera plano nem situação da assinatura', async () => {
    await expect(db.as(user(ana), (q) => q.exec(`update companies set billing_status = 'active', plan = 'empresa'`))).rejects.toThrow(/permission denied/);
    const n = await db.as(user(ana), (q) => q.exec(`update companies set monthly_goal = 32000 where id = $1`, [cidA]));
    expect(n).toBe(1);
  });
});

describe('equipe e permissões', () => {
  it('atendente não muda papéis nem dados da empresa', async () => {
    await expect(db.as(user(carla), (q) => q.exec(`update members set role = 'dono' where user_id = auth.uid()`))).rejects.toThrow('Só o dono');
    const n = await db.as(user(carla), (q) => q.exec(`update companies set name = 'Outro nome'`));
    expect(n).toBe(0);
    await expect(db.as(user(carla), (q) => q.exec(`insert into services (company_id, name, price) values ($1, 'Serviço pirata', 1)`, [cidA]))).rejects.toThrow(/row-level security/);
  });

  it('atendente pode trocar o próprio telefone (e perde a verificação)', async () => {
    await db.as('service', (q) => q.exec(`update members set phone = '5561977776666', phone_verified_at = now() where user_id = $1`, [carla]));
    await db.as(user(carla), (q) => q.exec(`update members set phone = '(61) 95555-4444' where user_id = auth.uid()`));
    const m = await db.as(user(carla), (q) => q.one<{ phone: string; phone_verified_at: string | null }>(`select phone, phone_verified_at from members where user_id = auth.uid()`));
    expect(m).toEqual({ phone: '5561955554444', phone_verified_at: null });
  });

  it('a empresa nunca fica sem dono', async () => {
    await expect(db.as(user(ana), (q) => q.exec(`update members set role = 'gerente' where user_id = auth.uid()`))).rejects.toThrow('pelo menos um dono');
  });
});

describe('orçamentos', () => {
  let contactId: string, quoteId: string, token: string;
  it('numera por empresa, soma os itens e aplica o desconto', async () => {
    contactId = (await db.as(user(ana), (q) => q.one<{ id: string }>(`select id from contacts where name = 'Maria Silva'`))).id;
    quoteId = (await db.as(user(ana), (q) => q.one<{ id: string }>(`select public.save_quote($1, $2) as id`, [
      { contact_id: contactId, title: 'Limpeza de sofá', status: 'enviado', discount: 20 },
      [{ description: 'Limpeza de sofá 3 lugares', qty: 1, unit_price: 180 }, { description: 'Impermeabilização', qty: 2, unit_price: 85 }],
    ]))).id;
    const q1 = await db.as(user(ana), (q) => q.one<{ number: number; subtotal: string; discount: string; total: string; sent_at: string | null; public_token: string }>(`select number, subtotal, discount, total, sent_at, public_token from quotes where id = $1`, [quoteId]));
    expect([q1.number, Number(q1.subtotal), Number(q1.discount), Number(q1.total), !!q1.sent_at]).toEqual([1, 350, 20, 330, true]);
    token = q1.public_token;
    const saveAndNumber = (q: Q, quote: object, items: object[]) =>
      q.one<{ id: string }>(`select public.save_quote($1, $2) as id`, [quote, items]).then((r) => q.one<{ number: number }>(`select number from quotes where id = $1`, [r.id]));
    const second = await db.as(user(ana), (q) => saveAndNumber(q, { contact_id: contactId }, [{ description: 'Tapete', qty: 3, unit_price: 25 }]));
    expect(second.number).toBe(2);
    const otherCompany = await db.as(user(beto), async (q) => {
      const c = await q.one<{ id: string }>(`insert into contacts (company_id, name) values ($1, 'Cliente da oficina') returning id`, [cidB]);
      return saveAndNumber(q, { contact_id: c.id }, [{ description: 'Revisão', qty: 1, unit_price: 450 }]);
    });
    expect(otherCompany.number).toBe(1);
  });

  it('o cliente vira "orçamento" no funil e o histórico registra', async () => {
    const r = await db.as(user(ana), (q) => q.one<{ stage: string; summary: string }>(`
      select (select stage from contacts where id = $1) as stage, (select summary from audit_log where action = 'criar_orcamento' order by created_at limit 1) as summary`, [contactId]));
    expect(r.stage).toBe('orcamento');
    expect(r.summary).toBe('Criou o orçamento nº 0001 de R$ 330,00 para Maria Silva');
  });

  it('não salva orçamento para cliente de outra empresa', async () => {
    await expect(db.as(user(beto), (q) => q.one(`select public.save_quote($1, $2)`, [{ contact_id: contactId }, [{ description: 'x', qty: 1, unit_price: 1 }]]))).rejects.toThrow('Escolha um cliente');
  });

  it('página pública: o visitante vê o orçamento e aprova uma única vez', async () => {
    const pub = await db.as('anon', (q) => q.one<{ data: { number: number; total: number; items: unknown[]; company: { name: string }; contact_name: string; status: string } }>(`select public.public_quote($1) as data`, [token]));
    expect(pub.data).toMatchObject({ number: 1, total: 330, company: { name: 'Brilho Lar Higienização' }, contact_name: 'Maria Silva', status: 'enviado' });
    expect(pub.data.items).toHaveLength(2);
    await db.as('anon', (q) => q.one(`select public.respond_quote($1, 'aprovado', 'Pode vir na sexta!')`, [token]));
    await expect(db.as('anon', (q) => q.one(`select public.respond_quote($1, 'recusado', null)`, [token]))).rejects.toThrow('nao_disponivel');
    const after = await db.as(user(ana), (q) => q.one<{ status: string; stage: string; note: string; notif: string; audit: string }>(`
      select (select status from quotes where id = $1) as status, (select stage from contacts where id = $2) as stage,
             (select response_note from quotes where id = $1) as note,
             (select title from notifications where kind = 'orcamento' order by created_at desc limit 1) as notif,
             (select summary from audit_log where action = 'aprovar_orcamento' limit 1) as audit`, [quoteId, contactId]));
    expect(after).toEqual({ status: 'aprovado', stage: 'fechado', note: 'Pode vir na sexta!', notif: 'Maria aprovou o orçamento', audit: 'Aprovou o orçamento nº 0001 (R$ 330,00) pelo link' });
    const missing = await db.as('anon', (q) => q.one<{ data: unknown }>(`select public.public_quote('0000000000000000000000') as data`));
    expect(missing.data).toBeNull();
  });

  it('manutenção expira orçamentos vencidos', async () => {
    const id = await db.as(user(ana), (q) => q.one<{ id: string }>(`select public.save_quote($1, $2) as id`, [{ contact_id: contactId, status: 'enviado', valid_until: '2020-01-01' }, [{ description: 'Antigo', qty: 1, unit_price: 99 }]]));
    await db.as('service', (q) => q.one(`select public.housekeeping()`));
    const s = await db.as(user(ana), (q) => q.one<{ status: string }>(`select status from quotes where id = $1`, [id.id]));
    expect(s.status).toBe('expirado');
  });
});

describe('conversas e números do painel', () => {
  let convId: string, contactId: string;
  it('mensagens atualizam a conversa, as não lidas e o tempo de resposta', async () => {
    const ids = await db.as('service', async (q) => {
      const c = await q.one<{ id: string }>(`insert into contacts (company_id, name, phone, source, created_via) values ($1, 'Juliana Ribeiro', '5561912345678', 'whatsapp', 'whatsapp') returning id`, [cidA]);
      const conv = await q.one<{ id: string }>(`insert into conversations (company_id, contact_id) values ($1, $2) returning id`, [cidA, c.id]);
      await q.exec(`insert into messages (company_id, conversation_id, direction, sender, body, channel, created_at) values ($1, $2, 'in', 'contato', 'Oi! Quanto custa limpar um sofá?', 'whatsapp', now() - interval '60 seconds')`, [cidA, conv.id]);
      await q.exec(`insert into messages (company_id, conversation_id, direction, sender, body, channel, created_at) values ($1, $2, 'in', 'contato', 'É de 3 lugares', 'whatsapp', now() - interval '50 seconds')`, [cidA, conv.id]);
      await q.exec(`insert into messages (company_id, conversation_id, direction, sender, body, channel, created_at) values ($1, $2, 'out', 'ia', 'Fica a partir de R$ 180!', 'whatsapp', now() - interval '15 seconds')`, [cidA, conv.id]);
      return { conv: conv.id, contact: c.id };
    });
    convId = ids.conv; contactId = ids.contact;
    const r = await db.as(user(ana), (q) => q.one<{ unread: number; preview: string; awaiting: string | null; secs: number; stage: string }>(`
      select c.unread, c.last_message_preview as preview, c.awaiting_since as awaiting,
             (select response_seconds from messages where conversation_id = c.id and direction = 'out') as secs,
             (select stage from contacts where id = c.contact_id) as stage
      from conversations c where c.id = $1`, [convId]));
    expect(r).toEqual({ unread: 2, preview: 'Fica a partir de R$ 180!', awaiting: null, secs: 45, stage: 'conversando' });
  });

  it('trava por conversa: só uma resposta da IA por vez', async () => {
    const first = await db.as('service', (q) => q.one<{ ok: boolean }>(`select public.try_lock_conversation($1, 60) as ok`, [convId]));
    const second = await db.as('service', (q) => q.one<{ ok: boolean }>(`select public.try_lock_conversation($1, 60) as ok`, [convId]));
    await db.as('service', (q) => q.one(`select public.release_conversation($1)`, [convId]));
    const third = await db.as('service', (q) => q.one<{ ok: boolean }>(`select public.try_lock_conversation($1, 60) as ok`, [convId]));
    await db.as('service', (q) => q.one(`select public.release_conversation($1)`, [convId]));
    expect([first.ok, second.ok, third.ok]).toEqual([true, false, true]);
    await expect(db.as(user(ana), (q) => q.one(`select public.try_lock_conversation($1, 60)`, [convId]))).rejects.toThrow(/permission denied/);
  });

  it('a atendente vê as conversas de clientes, mas não a conversa privada do dono com a IA', async () => {
    await db.as('service', (q) => q.exec(`insert into conversations (company_id, member_user_id, kind, channel) values ($1, $2, 'dono', 'painel')`, [cidA, ana]));
    const rows = await db.as(user(carla), (q) => q.rows<{ kind: string }>(`select kind from conversations`));
    expect(rows.map((r) => r.kind)).toEqual(['cliente']);
  });

  it('pedido de ajuda da IA vira aviso para a equipe', async () => {
    await db.as('service', (q) => q.exec(`update conversations set needs_attention = true, attention_reason = 'Pediu desconto de 20%' where id = $1`, [convId]));
    const n = await db.as(user(ana), (q) => q.one<{ title: string; body: string; link: string }>(`select title, body, link from notifications where kind = 'atendimento'`));
    expect(n).toEqual({ title: 'Juliana precisa de você', body: 'Pediu desconto de 20%', link: `#/conversas/${convId}` });
  });

  it('vendas atualizam o total gasto do cliente', async () => {
    await db.as(user(carla), (q) => q.exec(`insert into sales (company_id, contact_id, description, amount, method, origin) values ($1, $2, 'Sofá', 150, 'pix', 'ia'), ($1, $2, 'Tapete', 100, 'dinheiro', 'equipe')`, [cidA, contactId]));
    const c = await db.as(user(ana), (q) => q.one<{ total_spent: string; stage: string }>(`select total_spent, stage from contacts where id = $1`, [contactId]));
    expect([Number(c.total_spent), c.stage]).toEqual([250, 'fechado']);
    await db.as(user(ana), (q) => q.exec(`delete from sales where description = 'Tapete'`));
    const d = await db.as(user(ana), (q) => q.one<{ total_spent: string }>(`select total_spent from contacts where id = $1`, [contactId]));
    expect(Number(d.total_spent)).toBe(150);
  });

  it('daily_stats e peak_hours contam no fuso da empresa', async () => {
    const rows = await db.as(user(ana), (q) => q.rows<Record<string, string>>(`
      select * from public.daily_stats(((now() at time zone 'America/Sao_Paulo')::date - 1), (now() at time zone 'America/Sao_Paulo')::date)`));
    expect(rows).toHaveLength(2);
    const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k]), 0);
    expect({ in: sum('msgs_in'), ai: sum('msgs_ai'), convs: sum('conversations'), sales: sum('sales_count'), amount: sum('sales_amount'), ia: sum('sales_ia'), resp: sum('response_sum'), respN: sum('response_count'), approved: sum('quotes_approved') })
      .toEqual({ in: 2, ai: 1, convs: 1, sales: 1, amount: 150, ia: 150, resp: 45, respN: 1, approved: 1 });
    const peak = await db.as(user(ana), (q) => q.rows<{ total: string }>(`select * from public.peak_hours(current_date - 1, current_date + 1)`));
    expect(peak.reduce((s, r) => s + Number(r.total), 0)).toBe(2);
    const other = await db.as(user(beto), (q) => q.rows<Record<string, string>>(`select * from public.daily_stats(current_date - 1, current_date)`));
    expect(other.reduce((s, r) => s + Number(r.msgs_in), 0)).toBe(0);
  });
});

describe('agenda', () => {
  it('a IA não marca em cima de outro horário; a equipe pode encaixar', async () => {
    const base = `insert into appointments (company_id, title, starts_at, ends_at, created_via) values ($1, $2, $3, $4, $5)`;
    await db.as('service', (q) => q.exec(base, [cidA, 'Sofá', '2030-05-10T17:00:00Z', '2030-05-10T19:00:00Z', 'ia_cliente']));
    await expect(db.as('service', (q) => q.exec(base, [cidA, 'Colchão', '2030-05-10T18:00:00Z', '2030-05-10T19:00:00Z', 'ia_cliente']))).rejects.toThrow('horario_ocupado');
    await db.as('service', (q) => q.exec(base, [cidA, 'Colchão', '2030-05-10T19:00:00Z', '2030-05-10T20:00:00Z', 'ia_cliente'])); // encosta, não sobrepõe
    const n = await db.as(user(ana), (q) => q.exec(base, [cidA, 'Encaixe', '2030-05-10T18:00:00Z', '2030-05-10T18:30:00Z', 'painel']));
    expect(n).toBe(1);
    const audit = await db.as(user(ana), (q) => q.one<{ summary: string }>(`select summary from audit_log where action = 'agendar' order by created_at desc limit 1`));
    expect(audit.summary).toBe('Agendou Encaixe para 10/05 às 15:00 (Encaixe)');
  });
});

describe('comandos pelo WhatsApp', () => {
  it('o código ATIVAR liga o número a quem gerou e só vale uma vez', async () => {
    const r = await db.as(user(ana), (q) => q.one<{ data: { code: string } }>(`select public.owner_link_code() as data`));
    expect(r.data.code).toMatch(/^ATIVAR \d{6}$/);
    const code = r.data.code.slice(7);
    const ok = await db.as('service', (q) => q.one<{ data: { ok: boolean; role: string } }>(`select public.claim_owner_code($1, $2, '61 98888-7777') as data`, [cidA, code]));
    expect(ok.data).toMatchObject({ ok: true, role: 'dono' });
    const again = await db.as('service', (q) => q.one<{ data: { ok: boolean } }>(`select public.claim_owner_code($1, $2, '61 98888-7777') as data`, [cidA, code]));
    expect(again.data.ok).toBe(false);
    const m = await db.as(user(ana), (q) => q.one<{ phone: string; verified: boolean }>(`select phone, phone_verified_at is not null as verified from members where user_id = auth.uid()`));
    expect(m).toEqual({ phone: '5561988887777', verified: true });
    await expect(db.as(user(ana), (q) => q.one(`select public.claim_owner_code($1, '123456', '1')`, [cidA]))).rejects.toThrow(/permission denied/);
  });
});

describe('assinatura e uso', () => {
  it('avisa ao chegar em 80% das respostas da IA do plano', async () => {
    await db.as('service', (q) => q.one(`select public.bump_usage($1, 79, 79, 1000, 500)`, [cidA]));
    const before = await db.as(user(ana), (q) => q.rows(`select id from notifications where kind = 'assinatura'`));
    expect(before).toHaveLength(0);
    await db.as('service', (q) => q.one(`select public.bump_usage($1, 1, 1, 10, 5)`, [cidA]));
    const after = await db.as(user(ana), (q) => q.one<{ title: string }>(`select title from notifications where kind = 'assinatura'`));
    expect(after.title).toBe('Você já usou 80% das respostas da IA deste mês');
    const u = await db.as(user(ana), (q) => q.one<{ data: { ai_replies: number; wa_sent: number } }>(`select public.usage_current() as data`));
    expect(u.data).toMatchObject({ ai_replies: 80, wa_sent: 80 });
  });

  it('teste vencido deixa só consultar', async () => {
    await db.as('service', (q) => q.exec(`update companies set trial_ends_at = now() - interval '1 day' where id = $1`, [cidA]));
    await expect(db.as(user(ana), (q) => q.exec(`insert into contacts (company_id, name) values ($1, 'Novo')`, [cidA]))).rejects.toThrow(/row-level security/);
    const read = await db.as(user(ana), (q) => q.rows(`select id from contacts`));
    expect(read.length).toBeGreaterThan(0);
    const cid = await db.as(user(ana), (q) => q.one<{ id: string }>(`select id from contacts limit 1`));
    await expect(db.as(user(ana), (q) => q.one(`select public.save_quote($1, $2)`, [{ contact_id: cid.id }, [{ description: 'x', qty: 1, unit_price: 1 }]]))).rejects.toThrow('assinatura está inativa');
    await db.as('service', (q) => q.exec(`update companies set billing_status = 'active', plan = 'profissional', billing_cycle = 'mensal', current_period_end = current_date + 30 where id = $1`, [cidA]));
    const n = await db.as(user(ana), (q) => q.exec(`insert into contacts (company_id, name) values ($1, 'Novo')`, [cidA]));
    expect(n).toBe(1);
  });

  it('admin da plataforma: só administradores veem a visão geral', async () => {
    await expect(db.as(user(ana), (q) => q.one(`select public.admin_overview()`))).rejects.toThrow('Acesso restrito');
    await db.as('service', (q) => q.exec(`insert into platform_admins (user_id) values ($1)`, [ana]));
    const o = await db.as(user(ana), (q) => q.one<{ data: { companies: { name: string; mrr: number }[]; mrr: number; active: number } }>(`select public.admin_overview() as data`));
    expect(o.data.companies).toHaveLength(2);
    expect(o.data.mrr).toBe(299);
    expect(o.data.active).toBe(1);
  });
});

describe('histórico de ações', () => {
  it('mudanças de preço feitas no painel ficam registradas', async () => {
    const s = await db.as(user(ana), (q) => q.one<{ id: string }>(`insert into services (company_id, name, price) values ($1, 'Lavagem de cortina', 100) returning id`, [cidA]));
    await db.as(user(ana), (q) => q.exec(`update services set price = 120 where id = $1`, [s.id]));
    const rows = await db.as(user(ana), (q) => q.rows<{ action: string; summary: string; actor_name: string }>(`select action, summary, actor_name from audit_log where target_id = $1 order by created_at`, [s.id]));
    expect(rows).toEqual([
      { action: 'criar_servico', summary: 'Criou o serviço Lavagem de cortina (R$ 100,00)', actor_name: 'Ana Duarte' },
      { action: 'atualizar_servico', summary: 'Alterou o preço de Lavagem de cortina de R$ 100,00 para R$ 120,00', actor_name: 'Ana Duarte' },
    ]);
    await expect(db.as(user(ana), (q) => q.exec(`delete from audit_log`))).rejects.toThrow(/permission denied/);
  });
});
