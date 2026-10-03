// ORBYTA ONE: uma conta, um painel, vários módulos que compartilham os mesmos dados (com permissão e histórico).
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { ArrowRight, Bot, Briefcase, History, Landmark, Lock, Package, Plug, ReceiptText, type LucideIcon } from 'lucide-react';
import { api } from '../data/api';
import type { ModuleKey } from '../data/types';
import { useList } from '../data/hooks';
import { can, hasModule, useMeCtx } from '../context';
import { BRAND, logoSvg } from '../../shared/brand';
import { brl0, num, todayLocal } from '../../shared/format';
import { isLow } from './Stock';
import { Button, PageHeader, Switch, useToast } from '../ui';

interface Mod { key: string; name: string; desc: string; icon: LucideIcon; to: string; links: [string, string][]; stat?: string; color: string; locked?: boolean; optional?: ModuleKey }

export default function Modules() {
  const { me, refresh } = useMeCtx();
  const toast = useToast();
  const [busy, setBusy] = useState<ModuleKey | null>(null);
  const owner = can(me, 'dono');
  const toggle = async (k: ModuleKey, on: boolean) => {
    setBusy(k);
    try {
      const next = on ? [...new Set([...(me.company.modules ?? []), k])] : (me.company.modules ?? []).filter((x) => x !== k);
      await api.updateCompany({ modules: next });
      refresh();
      toast(on ? 'Módulo ativado: já aparece no menu' : 'Módulo desligado: some do menu, os dados continuam guardados');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  const today = todayLocal(me.company.timezone);
  const manager = can(me, 'dono', 'gerente');
  const { data: convs = [] } = useList('conversations', { filters: [{ col: 'status', op: 'eq', value: 'aberta' }], limit: 500 });
  const { data: products = [] } = useList('products', { limit: 3000 });
  const { data: bills = [] } = useList('finance_entries', { filters: [{ col: 'paid_at', op: 'is', value: null }], limit: 3000 }, { enabled: manager });
  const { data: quotes = [] } = useList('quotes', { filters: [{ col: 'status', op: 'eq', value: 'enviado' }], limit: 500 });
  const overdue = bills.filter((b) => b.due_date < today);
  const mods: Mod[] = [
    { key: 'ai', name: `${BRAND.name} AI`, desc: 'Atende pacientes no WhatsApp e executa os comandos da equipe.', icon: Bot, to: '/conversas', color: 'var(--c1)', links: [['Conversas', '/conversas'], ['Simulador', '/simulador'], ['Automações', '/automacoes']], stat: `${num(convs.length)} conversas abertas` },
    { key: 'gestao', name: `${BRAND.name} Gestão`, desc: 'Clientes, orçamentos, agenda e vendas no mesmo lugar.', icon: Briefcase, to: '/clientes', color: 'var(--violet-ink)', links: [['Pacientes', '/clientes'], ['Orçamentos', '/orcamentos'], ['Agenda', '/agenda'], ...(manager ? [['Vendas', '/vendas'] as [string, string]] : [])], stat: `${num(quotes.length)} ${quotes.length === 1 ? 'orçamento aguardando' : 'orçamentos aguardando'} resposta` },
    { key: 'finance', name: `${BRAND.name} Finance`, desc: 'Contas a pagar e a receber, vencimentos e caixa previsto.', icon: Landmark, to: '/financeiro', color: 'var(--green-ink)', links: [['Contas', '/financeiro'], ['Exportar', '/financeiro']], stat: manager ? (overdue.length ? `${overdue.length} contas vencidas` : `${brl0(bills.reduce((s, b) => s + (b.kind === 'pagar' ? b.amount : 0), 0))} a pagar em aberto`) : undefined, locked: !manager },
    { key: 'estoque', name: `${BRAND.name} Estoque`, desc: 'Entradas, saídas, alertas de reposição e importação do Excel. Para quem vende ou usa produtos.', icon: Package, to: '/estoque', color: 'var(--orange-ink)', links: [['Produtos', '/estoque']], stat: hasModule(me, 'estoque') ? ((n) => (n ? `${n} ${n === 1 ? 'produto' : 'produtos'} para repor` : 'Nada para repor'))(products.filter(isLow).length) : undefined, optional: 'estoque' },
    { key: 'cobranca', name: `${BRAND.name} Cobrança`, desc: 'Pix e boleto mandados no WhatsApp, baixa sozinha quando o paciente paga e nota fiscal de serviço.', icon: ReceiptText, to: '/cobrancas', color: 'var(--pink)', links: [['Cobranças', '/cobrancas'], ['Notas fiscais', '/cobrancas?aba=notas']], locked: !manager, optional: 'cobrancas' },
    { key: 'conecta', name: `${BRAND.name} Conecta`, desc: 'WhatsApp oficial, planilhas, Asaas e Focus NFe. ERP em breve.', icon: Plug, to: '/integracoes', color: 'var(--blue-ink)', links: [['Integrações', '/integracoes']] },
  ];
  return (
    <>
      <PageHeader title={`${BRAND.name} ONE`} subtitle="Uma conta. Um painel. Ligue só o que a sua empresa usa: o menu fica com a cara do seu negócio." />
      <section className="one-hero card">
        <div className="one-orbit" aria-hidden="true">
          <span className="ring r1" /><span className="ring r2" /><span className="ring r3" />
          <span className="core" dangerouslySetInnerHTML={{ __html: logoSvg(64, { title: false }) }} />
          {mods.map((m, i) => <span key={m.key} className={`sat s${i}`} style={{ color: m.color }}><m.icon /></span>)}
        </div>
        <div className="one-copy">
          <h2>Administre a empresa <em>conversando</em>.</h2>
          <p>Todos os módulos usam os mesmos pacientes, produtos e números. Quando a IA marca um horário, registra uma venda ou dá baixa no estoque, tudo se atualiza junto, com permissão por papel e histórico de cada ação.</p>
          <div className="one-tags"><span><Lock />Permissões por papel</span><span><History />Histórico de ações</span><span><Bot />IA em todos os módulos</span></div>
        </div>
      </section>
      <div className="mod-grid">
        {mods.map((m) => {
          const off = !!m.optional && !hasModule(me, m.optional);
          return (
            <article key={m.key} className={`card mod ${m.locked ? 'locked' : ''} ${off ? 'off' : ''}`}>
              <div className="mod-head">
                <span className="mod-ic" style={{ color: m.color }}><m.icon /></span>
                <div className="grow"><b>{m.name}</b><p className="muted small">{m.desc}</p></div>
                {m.optional && owner && <Switch checked={!off} onChange={(v) => void toggle(m.optional!, v)} label={off ? `Ativar ${m.name}` : `Desligar ${m.name}`} />}
              </div>
              {m.stat && !off && <div className="mod-stat">{m.stat}</div>}
              <div className="mod-links">
                {off ? (owner ? <Button size="sm" variant="solid" loading={busy === m.optional} onClick={() => void toggle(m.optional!, true)}>Ativar módulo</Button> : <span className="muted small">Desligado. Peça para o dono ativar.</span>)
                  : m.locked ? <span className="muted small"><Lock style={{ width: 13, verticalAlign: -2 }} /> Só para dono e gerentes</span>
                  : m.links.map(([l, to]) => <Link key={l} to={to} className="chip">{l}</Link>)}
                {!m.locked && !off && <Link to={m.to} className="mod-go" aria-label={`Abrir ${m.name}`}><ArrowRight /></Link>}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
