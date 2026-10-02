// ORBYTA ONE: uma conta, um painel, vários módulos que compartilham os mesmos dados (com permissão e histórico).
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Briefcase, History, Landmark, Lock, Package, Plug, type LucideIcon } from 'lucide-react';
import { useList } from '../data/hooks';
import { can, useMeCtx } from '../context';
import { BRAND, logoSvg } from '../../shared/brand';
import { brl0, num, todayLocal } from '../../shared/format';
import { isLow } from './Stock';
import { PageHeader } from '../ui';

interface Mod { key: string; name: string; desc: string; icon: LucideIcon; to: string; links: [string, string][]; stat?: string; color: string; locked?: boolean }

export default function Modules() {
  const { me } = useMeCtx();
  const today = todayLocal(me.company.timezone);
  const manager = can(me, 'dono', 'gerente');
  const { data: convs = [] } = useList('conversations', { filters: [{ col: 'status', op: 'eq', value: 'aberta' }], limit: 500 });
  const { data: products = [] } = useList('products', { limit: 3000 });
  const { data: bills = [] } = useList('finance_entries', { filters: [{ col: 'paid_at', op: 'is', value: null }], limit: 3000 }, { enabled: manager });
  const { data: quotes = [] } = useList('quotes', { filters: [{ col: 'status', op: 'eq', value: 'enviado' }], limit: 500 });
  const overdue = bills.filter((b) => b.due_date < today);
  const mods: Mod[] = [
    { key: 'ai', name: `${BRAND.name} AI`, desc: 'Atende clientes no WhatsApp e executa os comandos da equipe.', icon: Bot, to: '/conversas', color: 'var(--c1)', links: [['Conversas', '/conversas'], ['Simulador', '/simulador'], ['Automações', '/automacoes']], stat: `${num(convs.length)} conversas abertas` },
    { key: 'gestao', name: `${BRAND.name} Gestão`, desc: 'Clientes, orçamentos, agenda e vendas no mesmo lugar.', icon: Briefcase, to: '/clientes', color: 'var(--violet-ink)', links: [['Clientes', '/clientes'], ['Orçamentos', '/orcamentos'], ['Agenda', '/agenda'], ...(manager ? [['Vendas', '/vendas'] as [string, string]] : [])], stat: `${num(quotes.length)} ${quotes.length === 1 ? 'orçamento aguardando' : 'orçamentos aguardando'} resposta` },
    { key: 'finance', name: `${BRAND.name} Finance`, desc: 'Contas a pagar e a receber, vencimentos e caixa previsto.', icon: Landmark, to: '/financeiro', color: 'var(--green-ink)', links: [['Contas', '/financeiro'], ['Exportar', '/financeiro']], stat: manager ? (overdue.length ? `${overdue.length} contas vencidas` : `${brl0(bills.reduce((s, b) => s + (b.kind === 'pagar' ? b.amount : 0), 0))} a pagar em aberto`) : undefined, locked: !manager },
    { key: 'estoque', name: `${BRAND.name} Estoque`, desc: 'Entradas, saídas, alertas de reposição e importação do Excel.', icon: Package, to: '/estoque', color: 'var(--orange-ink)', links: [['Produtos', '/estoque']], stat: ((n) => (n ? `${n} ${n === 1 ? 'produto' : 'produtos'} para repor` : 'Nada para repor'))(products.filter(isLow).length) },
    { key: 'conecta', name: `${BRAND.name} Conecta`, desc: 'WhatsApp, planilhas, cobrança com Pix e boleto e nota fiscal de serviço. ERP em breve.', icon: Plug, to: '/integracoes', color: 'var(--blue-ink)', links: [['Integrações', '/integracoes'], ['Cobranças e notas', '/cobrancas']] },
  ];
  return (
    <>
      <PageHeader title={`${BRAND.name} ONE`} subtitle="Uma conta. Um painel. Vários módulos conversando entre si." />
      <section className="one-hero card">
        <div className="one-orbit" aria-hidden="true">
          <span className="ring r1" /><span className="ring r2" /><span className="ring r3" />
          <span className="core" dangerouslySetInnerHTML={{ __html: logoSvg(64, { title: false }) }} />
          {mods.map((m, i) => <span key={m.key} className={`sat s${i}`} style={{ color: m.color }}><m.icon /></span>)}
        </div>
        <div className="one-copy">
          <h2>Administre a empresa <em>conversando</em>.</h2>
          <p>Todos os módulos usam os mesmos clientes, produtos e números. Quando a IA marca um horário, registra uma venda ou dá baixa no estoque, tudo se atualiza junto, com permissão por papel e histórico de cada ação.</p>
          <div className="one-tags"><span><Lock />Permissões por papel</span><span><History />Histórico de ações</span><span><Bot />IA em todos os módulos</span></div>
        </div>
      </section>
      <div className="mod-grid">
        {mods.map((m) => (
          <article key={m.key} className={`card mod ${m.locked ? 'locked' : ''}`}>
            <div className="mod-head"><span className="mod-ic" style={{ color: m.color }}><m.icon /></span><div><b>{m.name}</b><p className="muted small">{m.desc}</p></div></div>
            {m.stat && <div className="mod-stat">{m.stat}</div>}
            <div className="mod-links">
              {m.locked ? <span className="muted small"><Lock style={{ width: 13, verticalAlign: -2 }} /> Só para dono e gerentes</span>
                : m.links.map(([l, to]) => <Link key={l} to={to} className="chip">{l}</Link>)}
              {!m.locked && <Link to={m.to} className="mod-go" aria-label={`Abrir ${m.name}`}><ArrowRight /></Link>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
