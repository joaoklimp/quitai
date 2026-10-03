// Dados de exemplo dos módulos de gestão (financeiro, estoque de materiais e perguntas frequentes) da clínica da demonstração.
import type { Charge, CompanyIntegration, Contact, FaqItem, FinanceEntry, FiscalNote, Product, StockMovement, WaitlistEntry } from '../types';
import { addDays, fromLocal } from '../../../shared/format';
import { DEMO_COMPANY_ID, DEMO_USER_ID, demoId } from './seed';

const TZ = 'America/Sao_Paulo';

export const DEMO_FAQ: FaqItem[] = [
  { q: 'Quais as formas de pagamento?', a: 'Particular: Pix, cartão de débito ou crédito em até 10x sem juros nos tratamentos acima de R$ 1.000. Também atendemos Unimed Odonto, Amil Dental, OdontoPrev e Bradesco Dental.' },
  { q: 'A avaliação é paga?', a: 'Não. A primeira avaliação e a avaliação ortodôntica são gratuitas. Nela a dentista examina e passa o plano de tratamento com os valores.' },
  { q: 'Precisa de preparo para a limpeza?', a: 'Não precisa de preparo. Escove os dentes antes, se puder, e chegue 10 minutos antes do horário.' },
  { q: 'Atendem crianças?', a: 'Sim. A Dra. Marina atende crianças a partir de 3 anos, sempre com o responsável junto na consulta.' },
  { q: 'Onde fica a clínica?', a: 'SCS Quadra 2, Bloco C, sala 410, Asa Sul. Tem estacionamento rotativo em frente ao prédio.' },
  { q: 'Emitem nota fiscal e recibo para reembolso?', a: 'Sim. Emitimos nota fiscal de serviço e recibo com o CPF do paciente para declarar no imposto ou pedir reembolso ao plano.' },
];

export function buildGestao(now: Date, today: string, contacts: Contact[]): { finance_entries: FinanceEntry[]; products: Product[]; stock_movements: StockMovement[]; charges: Charge[]; fiscal_notes: FiscalNote[]; company_integrations: CompanyIntegration[]; waitlist: WaitlistEntry[] } {
  const at = (date: string, hhmm = '10:00') => fromLocal(date, hhmm, TZ).toISOString();
  const created = at(addDays(today, -40));
  const monthDay = (d: number) => { const [y, m] = today.split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  const contactNamed = (n: string) => contacts.find((c) => c.name.startsWith(n))?.id ?? null;

  type F = [FinanceEntry['kind'], string, string, number, string, string | null, string | null, FinanceEntry['recurrence'], FinanceEntry['method']?];
  // tipo, descrição, categoria, valor, vencimento, pago em, contraparte, recorrência, forma
  const rows: F[] = [
    ['pagar', 'Aluguel da sala 410', 'Aluguel', 4200, monthDay(5), null, 'Imobiliária Central', 'mensal'],
    ['pagar', 'Salário — Carla Mendes (recepção)', 'Pessoal', 2300, monthDay(5), null, 'Carla Mendes', 'mensal'],
    ['pagar', 'Materiais odontológicos (pedido 8812)', 'Fornecedores', 1860, addDays(today, 3), null, 'Dental Cremer', 'nenhuma'],
    ['pagar', 'Laboratório de prótese — coroas', 'Laboratório', 1450, addDays(today, -2), null, 'Lab Sorriso Prótese', 'nenhuma'],
    ['pagar', 'Manutenção da autoclave', 'Equipamentos', 520, addDays(today, 10), null, 'BioTec Assistência', 'nenhuma'],
    ['pagar', 'Energia elétrica', 'Contas da clínica', 690, addDays(today, -6), at(addDays(today, -7), '09:20'), 'Neoenergia', 'mensal', 'pix'],
    ['pagar', 'Internet e telefone', 'Contas da clínica', 159.9, addDays(today, -9), at(addDays(today, -9), '08:40'), 'Vivo', 'mensal', 'cartao_credito'],
    ['pagar', 'Anúncios no Instagram', 'Marketing', 600, addDays(today, -12), at(addDays(today, -12), '11:05'), 'Meta Ads', 'mensal', 'cartao_credito'],
    ['receber', 'Repasse Unimed Odonto — guias do mês', 'Convênios', 7840, addDays(today, 15), null, 'Unimed Odonto', 'nenhuma'],
    ['receber', 'Repasse Amil Dental — guias do mês', 'Convênios', 4120, addDays(today, 6), null, 'Amil Dental', 'nenhuma'],
    ['receber', 'Juliana Ribeiro — parcela do clareamento', 'Tratamentos', 300, addDays(today, -1), null, null, 'nenhuma'],
    ['receber', 'Repasse OdontoPrev — guias do mês passado', 'Convênios', 3260, addDays(today, -4), at(addDays(today, -3), '15:10'), 'OdontoPrev', 'nenhuma', 'transferencia'],
    ['receber', 'Repasse Unimed Odonto — guias do mês passado', 'Convênios', 7210, addDays(today, -24), at(addDays(today, -24), '10:30'), 'Unimed Odonto', 'nenhuma', 'transferencia'],
  ];
  const finance_entries: FinanceEntry[] = rows.map(([kind, description, category, amount, due, paid, counterpart, recurrence, method]) => ({
    id: demoId('f1'), company_id: DEMO_COMPANY_ID, kind, description, category, amount, due_date: due, paid_at: paid, method: method ?? null,
    contact_id: description.startsWith('Juliana') ? contactNamed('Juliana Ribeiro') : null, counterpart, recurrence, notes: null,
    created_via: description.startsWith('Laboratório') ? 'ia_dono' : 'painel', created_at: created, updated_at: paid ?? created,
  }));

  // produtos: [nome, código, unidade, categoria, mínimo, custo, preço, saldo inicial, movimentações [dias atrás, tipo, qtd, nota]]
  type P = [string, string, string, string, number, number, number | null, number, [number, StockMovement['kind'], number, string | null][]];
  const list: P[] = [
    ['Anestésico lidocaína 2% (caixa com 50)', 'ANE-LID', 'caixa', 'Anestésicos', 3, 165, null, 6, [[21, 'saida', 1, 'Consumo da semana'], [12, 'saida', 1, null], [5, 'saida', 1, null], [1, 'saida', 1, null]]],
    ['Resina composta A2', 'RES-A2', 'seringa', 'Restauradores', 4, 89.9, null, 9, [[25, 'saida', 2, null], [16, 'saida', 2, null], [8, 'saida', 2, null], [1, 'saida', 1, 'Restaurações do dia']]],
    ['Gel clareador 35%', 'CLA-35', 'kit', 'Estética', 2, 210, null, 4, [[18, 'saida', 1, null], [6, 'entrada', 1, null]]],
    ['Luvas de procedimento M (caixa)', 'LUV-M', 'caixa', 'EPI', 6, 38, null, 18, [[15, 'saida', 4, null], [4, 'saida', 3, null]]],
    ['Máscaras descartáveis (caixa com 50)', 'MAS-50', 'caixa', 'EPI', 4, 29, null, 12, [[14, 'saida', 3, null]]],
    ['Sugador descartável (pacote com 40)', 'SUG-40', 'pacote', 'Descartáveis', 5, 14.5, null, 20, [[20, 'saida', 5, null], [9, 'saida', 4, null], [3, 'saida', 4, null]]],
    ['Fio de sutura 4-0', 'FIO-40', 'un', 'Cirurgia', 10, 9.8, null, 30, [[15, 'saida', 8, null], [4, 'saida', 6, null]]],
    ['Kit clareamento caseiro (revenda)', 'KIT-CLA', 'kit', 'Revenda', 2, 120, 250, 6, [[7, 'saida', 2, 'Vendido na recepção']]],
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
    { company_id: DEMO_COMPANY_ID, provider: 'asaas', status: 'conectado', environment: 'testes', config: { webhook: 'automatico' }, account_name: 'Vida Plena Odontologia', last_error: null, connected_at: ago(20), updated_at: ago(20) },
    { company_id: DEMO_COMPANY_ID, provider: 'focusnfe', status: 'conectado', environment: 'testes', config: { cnpj: '11222333000181', inscricao_municipal: '0745123', codigo_municipio: '5300108', item_lista_servico: '0412', aliquota: 2, optante_simples_nacional: true }, account_name: 'Vida Plena Odontologia', last_error: null, connected_at: ago(20), updated_at: ago(20) },
  ];
  const named = (n: string) => contacts.find((c) => c.name.startsWith(n)) ?? contacts[0];
  const ch = (c: Contact, description: string, amount: number, due: string, status: Charge['status'], created: number, paid?: number): Charge => {
    const id = demoId('f4');
    return { id, company_id: DEMO_COMPANY_ID, contact_id: c.id, quote_id: null, description, amount, due_date: due, method: 'pix_boleto', status, provider_id: `pay_demo${id.slice(-6)}`, invoice_url: `https://sandbox.asaas.com/i/demo${id.slice(-6)}`, pix_code: `00020126580014br.gov.bcb.pix0136demo-${id.slice(-6)}5204000053039865406${amount.toFixed(2)}5802BR`, paid_at: paid != null ? ago(paid, '15:20') : null, sent_at: ago(created, '10:05'), sale_id: null, finance_entry_id: null, created_via: created % 2 ? 'ia_dono' : 'painel', created_at: ago(created), updated_at: ago(paid ?? created) };
  };
  // CPFs fictícios (válidos no formato) para os pacientes que já foram cobrados
  named('Ricardo').document = '52998224725'; named('Bruno').document = '11144477735'; named('Patrícia').document = '39053344705';
  const charges: Charge[] = [
    ch(named('Ricardo'), 'Clareamento a laser (entrada)', 600, addDays(today, 2), 'pendente', 0),
    ch(named('Bruno'), 'Restauração (2)', 560, addDays(today, -3), 'paga', 5, 3),
    ch(named('Patrícia'), 'Limpeza (profilaxia)', 220, addDays(today, -2), 'vencida', 7),
  ];
  const note = (c: Contact, amount: number, description: string, status: FiscalNote['status'], d: number, n: string | null): FiscalNote => ({
    id: demoId('f5'), company_id: DEMO_COMPANY_ID, ref: `demo${demoId('f6').slice(-8)}`, contact_id: c.id, sale_id: null, charge_id: null, amount, description,
    taker: { name: c.name, document: c.document ?? undefined, email: c.email ?? undefined }, status, number: n, verification_code: n ? 'A1B2C3D4' : null,
    pdf_url: n ? 'https://homologacao.focusnfe.com.br/notas_fiscais_servico/exemplo.pdf' : null, xml_url: null, error: null, issued_at: n ? ago(d, '16:00') : null, created_via: 'painel', created_at: ago(d), updated_at: ago(d),
  });
  const fiscal_notes: FiscalNote[] = [note(named('Bruno'), 560, 'Restauração (2)', 'autorizada', 3, '2026000123'), note(named('Aline'), 1200, 'Clareamento a laser', 'autorizada', 9, '2026000117')];
  // lista de espera: dois aguardando e um que já conseguiu encaixe nesta semana
  const wl = (c: Contact, desired: string | null, period: WaitlistEntry['period'], status: WaitlistEntry['status'], d: number, notes: string | null = null): WaitlistEntry => ({
    id: demoId('f7'), company_id: DEMO_COMPANY_ID, contact_id: c.id, service_id: null, desired_date: desired, period, notes, status,
    offered_at: status !== 'aguardando' ? ago(d - 1, '09:10') : null, offered_starts_at: status !== 'aguardando' ? at(addDays(today, 1), '15:00') : null,
    appointment_id: null, created_via: d % 2 ? 'ia_cliente' : 'painel', created_at: ago(d), updated_at: ago(status === 'agendado' ? d - 1 : d),
  });
  const waitlist: WaitlistEntry[] = [
    wl(named('Larissa'), addDays(today, 1), 'tarde', 'aguardando', 1, 'Avaliação ortodôntica. Só consegue depois das 14h.'),
    wl(named('Patrícia'), null, 'manha', 'aguardando', 2, 'Limpeza pelo Bradesco Dental.'),
    wl(named('Débora'), addDays(today, 1), 'qualquer', 'agendado', 3),
  ];
  return { finance_entries, products, stock_movements, charges, fiscal_notes, company_integrations, waitlist };
}
