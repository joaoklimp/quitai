// Dados de exemplo dos módulos de gestão (financeiro, estoque e base de conhecimento) da empresa da demonstração.
import type { Charge, CompanyIntegration, Contact, FaqItem, FinanceEntry, FiscalNote, Product, StockMovement } from '../types';
import { addDays, fromLocal } from '../../../shared/format';
import { DEMO_COMPANY_ID, DEMO_USER_ID, demoId } from './seed';

const TZ = 'America/Sao_Paulo';

export const DEMO_FAQ: FaqItem[] = [
  { q: 'Quais as formas de pagamento?', a: 'Pix (com 5% de desconto), cartão de crédito em até 3x sem juros ou dinheiro. O pagamento é feito depois do serviço.' },
  { q: 'Quanto tempo demora para secar?', a: 'De 4 a 8 horas, dependendo do tecido e da ventilação do ambiente.' },
  { q: 'Os produtos fazem mal para pets e crianças?', a: 'Não. Usamos produtos biodegradáveis e sem cheiro forte. Depois de seco, pets e crianças podem usar normalmente.' },
  { q: 'Tem garantia?', a: 'Sim. Se alguma mancha voltar em até 7 dias, refazemos sem custo.' },
  { q: 'Preciso estar em casa?', a: 'Precisa de alguém maior de idade para receber o técnico e liberar o acesso. O serviço leva de 1 a 3 horas.' },
  { q: 'Vocês emitem nota fiscal?', a: 'Sim, emitimos nota fiscal de serviço. É só pedir no momento do pagamento.' },
];

export function buildGestao(now: Date, today: string, contacts: Contact[]): { finance_entries: FinanceEntry[]; products: Product[]; stock_movements: StockMovement[]; charges: Charge[]; fiscal_notes: FiscalNote[]; company_integrations: CompanyIntegration[] } {
  const at = (date: string, hhmm = '10:00') => fromLocal(date, hhmm, TZ).toISOString();
  const created = at(addDays(today, -40));
  const monthDay = (d: number) => { const [y, m] = today.split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  const contactNamed = (n: string) => contacts.find((c) => c.name.startsWith(n))?.id ?? null;

  type F = [FinanceEntry['kind'], string, string, number, string, string | null, string | null, FinanceEntry['recurrence'], FinanceEntry['method']?];
  // tipo, descrição, categoria, valor, vencimento, pago em, contraparte, recorrência, forma
  const rows: F[] = [
    ['pagar', 'Aluguel do galpão', 'Aluguel', 2800, monthDay(5), null, 'Imobiliária Central', 'mensal'],
    ['pagar', 'Salário — Carla Mendes', 'Pessoal', 2100, monthDay(5), null, 'Carla Mendes', 'mensal'],
    ['pagar', 'Produtos de limpeza (pedido 3321)', 'Fornecedores', 1240, addDays(today, 3), null, 'Química Center', 'nenhuma'],
    ['pagar', 'Combustível da van', 'Transporte', 600, addDays(today, -2), null, 'Posto Asa Sul', 'nenhuma'],
    ['pagar', 'Manutenção da extratora', 'Equipamentos', 450, addDays(today, 10), null, 'TecLimp Assistência', 'nenhuma'],
    ['pagar', 'Energia elétrica', 'Contas da casa', 380, addDays(today, -6), at(addDays(today, -7), '09:20'), 'Neoenergia', 'mensal', 'pix'],
    ['pagar', 'Internet e telefone', 'Contas da casa', 129.9, addDays(today, -9), at(addDays(today, -9), '08:40'), 'Vivo', 'mensal', 'cartao_credito'],
    ['pagar', 'Anúncios no Instagram', 'Marketing', 350, addDays(today, -12), at(addDays(today, -12), '11:05'), 'Meta Ads', 'mensal', 'cartao_credito'],
    ['receber', 'Condomínio Parque das Águas — 12 sofás', 'Serviços', 3600, addDays(today, 15), null, 'Condomínio Parque das Águas', 'nenhuma'],
    ['receber', 'Contrato mensal — Clínica Bem Estar', 'Contratos', 1500, addDays(today, 6), null, 'Clínica Bem Estar', 'mensal'],
    ['receber', 'Juliana Ribeiro — boleto', 'Serviços', 250, addDays(today, -1), null, null, 'nenhuma'],
    ['receber', 'Escritório Alves & Lima — cadeiras', 'Serviços', 980, addDays(today, -4), at(addDays(today, -3), '15:10'), 'Alves & Lima Advocacia', 'nenhuma', 'transferencia'],
    ['receber', 'Contrato mensal — Clínica Bem Estar', 'Contratos', 1500, addDays(today, -24), at(addDays(today, -24), '10:30'), 'Clínica Bem Estar', 'nenhuma', 'pix'],
  ];
  const finance_entries: FinanceEntry[] = rows.map(([kind, description, category, amount, due, paid, counterpart, recurrence, method]) => ({
    id: demoId('f1'), company_id: DEMO_COMPANY_ID, kind, description, category, amount, due_date: due, paid_at: paid, method: method ?? null,
    contact_id: description.startsWith('Juliana') ? contactNamed('Juliana Ribeiro') : null, counterpart, recurrence, notes: null,
    created_via: description.startsWith('Combustível') ? 'ia_dono' : 'painel', created_at: created, updated_at: paid ?? created,
  }));

  // produtos: [nome, código, unidade, categoria, mínimo, custo, preço, saldo inicial, movimentações [dias atrás, tipo, qtd, nota]]
  type P = [string, string, string, string, number, number, number | null, number, [number, StockMovement['kind'], number, string | null][]];
  const list: P[] = [
    ['Shampoo neutro para estofados 5L', 'SHA-5L', 'galão', 'Produtos', 3, 89.9, null, 8, [[21, 'saida', 1, 'Serviços da semana'], [12, 'saida', 1, null], [5, 'saida', 1, null], [2, 'entrada', 2, 'Pedido Química Center']]],
    ['Removedor de manchas 1L', 'REM-1L', 'frasco', 'Produtos', 4, 42.5, null, 9, [[25, 'saida', 2, null], [16, 'saida', 2, null], [8, 'saida', 2, null], [1, 'saida', 1, 'Serviço condomínio']]],
    ['Impermeabilizante 5L', 'IMP-5L', 'galão', 'Produtos', 2, 210, null, 4, [[18, 'saida', 1, null], [6, 'entrada', 1, null]]],
    ['Bactericida 5L', 'BAC-5L', 'galão', 'Produtos', 2, 64, null, 5, [[10, 'saida', 1, null]]],
    ['Escova de cerdas macias', 'ESC-01', 'un', 'Acessórios', 3, 18, null, 10, [[14, 'saida', 2, 'Desgaste']]],
    ['Pano de microfibra', 'MIC-40', 'un', 'Acessórios', 20, 6.5, null, 60, [[20, 'saida', 12, null], [9, 'saida', 10, null], [3, 'saida', 8, null]]],
    ['Luva nitrílica', 'LUV-M', 'par', 'EPI', 10, 2.9, null, 40, [[15, 'saida', 12, null], [4, 'saida', 10, null]]],
    ['Kit higienização de sofá (revenda)', 'KIT-SOF', 'kit', 'Revenda', 2, 38, 79.9, 6, [[7, 'saida', 2, 'Vendido no balcão']]],
  ];
  const products: Product[] = [];
  const stock_movements: StockMovement[] = [];
  for (const [name, sku, unit, category, min, cost, price, initial, movs] of list) {
    const p: Product = { id: demoId('f2'), company_id: DEMO_COMPANY_ID, name, sku, unit, category, stock: initial, min_stock: min, cost, price, active: true, created_at: created, updated_at: created };
    stock_movements.push({ id: demoId('f3'), company_id: DEMO_COMPANY_ID, product_id: p.id, kind: 'ajuste', qty: initial, balance_after: initial, unit_cost: cost, note: 'Saldo inicial', created_by: DEMO_USER_ID, created_via: 'painel', created_at: created });
    for (const [daysAgo, kind, qty, note] of movs) {
      p.stock = kind === 'entrada' ? p.stock + qty : kind === 'saida' ? p.stock - qty : qty;
      stock_movements.push({ id: demoId('f3'), company_id: DEMO_COMPANY_ID, product_id: p.id, kind, qty, balance_after: p.stock, unit_cost: kind === 'entrada' ? cost : null, note, created_by: DEMO_USER_ID, created_via: 'painel', created_at: new Date(now.getTime() - daysAgo * 86400000).toISOString() });
    }
    p.updated_at = stock_movements[stock_movements.length - 1].created_at;
    products.push(p);
  }
  stock_movements.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // integrações conectadas em modo de testes, com algumas cobranças e notas de exemplo
  const ago = (d: number, h = '10:00') => at(addDays(today, -d), h);
  const company_integrations: CompanyIntegration[] = [
    { company_id: DEMO_COMPANY_ID, provider: 'asaas', status: 'conectado', environment: 'testes', config: { webhook: 'automatico' }, account_name: 'Brilho Lar Higienização', last_error: null, connected_at: ago(20), updated_at: ago(20) },
    { company_id: DEMO_COMPANY_ID, provider: 'focusnfe', status: 'conectado', environment: 'testes', config: { cnpj: '11222333000181', inscricao_municipal: '0745123', codigo_municipio: '5300108', item_lista_servico: '0702', aliquota: 2, optante_simples_nacional: true }, account_name: 'Brilho Lar Higienização', last_error: null, connected_at: ago(20), updated_at: ago(20) },
  ];
  const named = (n: string) => contacts.find((c) => c.name.startsWith(n)) ?? contacts[0];
  const ch = (c: Contact, description: string, amount: number, due: string, status: Charge['status'], created: number, paid?: number): Charge => {
    const id = demoId('f4');
    return { id, company_id: DEMO_COMPANY_ID, contact_id: c.id, quote_id: null, description, amount, due_date: due, method: 'pix_boleto', status, provider_id: `pay_demo${id.slice(-6)}`, invoice_url: `https://sandbox.asaas.com/i/demo${id.slice(-6)}`, pix_code: `00020126580014br.gov.bcb.pix0136demo-${id.slice(-6)}5204000053039865406${amount.toFixed(2)}5802BR`, paid_at: paid != null ? ago(paid, '15:20') : null, sent_at: ago(created, '10:05'), sale_id: null, finance_entry_id: null, created_via: created % 2 ? 'ia_dono' : 'painel', created_at: ago(created), updated_at: ago(paid ?? created) };
  };
  // CPFs fictícios (válidos no formato) para os clientes que já foram cobrados
  named('Juliana').document = '52998224725'; named('Bruno').document = '11144477735'; named('Patrícia').document = '39053344705';
  const charges: Charge[] = [
    ch(named('Juliana'), 'Limpeza de sofá 3 lugares', 180, addDays(today, 2), 'pendente', 0),
    ch(named('Bruno'), 'Limpeza de 8 cadeiras', 280, addDays(today, -3), 'paga', 5, 3),
    ch(named('Patrícia'), 'Higienização de colchão casal', 220, addDays(today, -2), 'vencida', 7),
  ];
  const note = (c: Contact, amount: number, description: string, status: FiscalNote['status'], d: number, n: string | null): FiscalNote => ({
    id: demoId('f5'), company_id: DEMO_COMPANY_ID, ref: `demo${demoId('f6').slice(-8)}`, contact_id: c.id, sale_id: null, charge_id: null, amount, description,
    taker: { name: c.name, document: c.document ?? undefined, email: c.email ?? undefined }, status, number: n, verification_code: n ? 'A1B2C3D4' : null,
    pdf_url: n ? 'https://homologacao.focusnfe.com.br/notas_fiscais_servico/exemplo.pdf' : null, xml_url: null, error: null, issued_at: n ? ago(d, '16:00') : null, created_via: 'painel', created_at: ago(d), updated_at: ago(d),
  });
  const fiscal_notes: FiscalNote[] = [note(named('Bruno'), 280, 'Limpeza de 8 cadeiras', 'autorizada', 3, '2026000123'), note(named('Juliana'), 180, 'Limpeza de sofá 3 lugares', 'autorizada', 9, '2026000117')];
  return { finance_entries, products, stock_movements, charges, fiscal_notes, company_integrations };
}
