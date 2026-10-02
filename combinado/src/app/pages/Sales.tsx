// Vendas: o que entrou, por forma de pagamento e por origem (IA, equipe, balcão).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Download, Plus, Wallet, Trash2 } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { PayMethod, Sale, SaleOrigin } from '../data/types';
import { useMeCtx, can } from '../context';
import { Donut, HBars } from '../charts';
import { Avatar, Badge, Button, Empty, Field, Input, Loader, Modal, MoneyInput, PageHeader, Select, cx, useConfirm, useToast } from '../ui';
import { ContactPicker } from '../ui/pickers';
import { addDays, brl, brl0, fmtDateTime, fromLocal, todayLocal } from '../../shared/format';

export const METHOD_LABEL: Record<PayMethod, string> = { pix: 'Pix', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', boleto: 'Boleto', transferencia: 'Transferência', outro: 'Outro' };
const ORIGIN_LABEL: Record<SaleOrigin, string> = { ia: 'Fechada pela IA', equipe: 'Equipe', balcao: 'Balcão' };
type Range = 'mes' | 'mes_passado' | '30d' | '90d' | 'ano';
const RANGE_LABEL: Record<Range, string> = { mes: 'Este mês', mes_passado: 'Mês passado', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', ano: 'Este ano' };

export default function Sales() {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const today = todayLocal(tz);
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<Range>('mes');
  const [form, setForm] = useState(!!params.get('novo'));
  const confirm = useConfirm();
  const inv = useInvalidate();
  const toast = useToast();
  const [from, to] = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    if (range === 'mes') return [`${today.slice(0, 7)}-01`, today];
    if (range === 'mes_passado') return [new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)];
    if (range === 'ano') return [`${y}-01-01`, today];
    return [addDays(today, range === '30d' ? -29 : -89), today];
  }, [range, today]);
  const { data: sales = [], isLoading } = useList('sales', { filters: [{ col: 'paid_at', op: 'gte', value: fromLocal(from, '00:00', tz).toISOString() }, { col: 'paid_at', op: 'lt', value: fromLocal(addDays(to, 1), '00:00', tz).toISOString() }], order: [{ col: 'paid_at', asc: false }], limit: 2000 });
  const ids = useMemo(() => [...new Set(sales.map((s) => s.contact_id).filter(Boolean) as string[])], [sales]);
  const { data: contacts = [] } = useList('contacts', ids.length ? { filters: [{ col: 'id', op: 'in', value: ids.slice(0, 500) }] } : { limit: 0 }, { enabled: ids.length > 0 });
  const cmap = new Map(contacts.map((c) => [c.id, c]));
  const total = sales.reduce((s, x) => s + x.amount, 0);
  const byMethod = (Object.keys(METHOD_LABEL) as PayMethod[]).map((m) => ({ key: m, label: METHOD_LABEL[m], value: sales.filter((s) => s.method === m).reduce((a, b) => a + b.amount, 0) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const byOrigin = (['ia', 'equipe', 'balcao'] as SaleOrigin[]).map((o, i) => ({ key: o, label: ORIGIN_LABEL[o], value: sales.filter((s) => s.origin === o).reduce((a, b) => a + b.amount, 0), color: ['var(--c1)', 'var(--c2)', 'var(--c3)'][i] }));
  const closeForm = () => { setForm(false); if (params.get('novo')) setParams({}, { replace: true }); };
  const exportCsv = () => {
    const rows = [['Data', 'Cliente', 'Descrição', 'Forma', 'Origem', 'Valor'].join(';'), ...sales.map((s) => [fmtDateTime(s.paid_at), cmap.get(s.contact_id ?? '')?.name ?? '', s.description, METHOD_LABEL[s.method], ORIGIN_LABEL[s.origin], s.amount.toFixed(2).replace('.', ',')].join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `vendas-${from}-a-${to}.csv`; a.click();
  };
  if (!can(me, 'dono', 'gerente')) return <Empty title="Sem acesso" >As vendas ficam visíveis só para o dono e gerentes.</Empty>;
  return (
    <>
      <PageHeader title="Vendas" subtitle="Tudo o que entrou, inclusive as vendas registradas pelo WhatsApp com a sua confirmação."
        actions={<>
          <Select value={range} onChange={(e) => setRange(e.target.value as Range)} style={{ width: 190 }} aria-label="Período">{(Object.keys(RANGE_LABEL) as Range[]).map((r) => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}</Select>
          <Button icon={<Download />} onClick={exportCsv} className="only-desktop">Exportar</Button>
          <Button variant="solid" icon={<Plus />} onClick={() => setForm(true)}>Registrar venda</Button>
        </>} />
      <div className="stat-row">
        <div className="stat"><span>Total vendido</span><b>{brl0(total)}</b><small>{sales.length} vendas · {RANGE_LABEL[range].toLowerCase()}</small></div>
        <div className="stat"><span>Ticket médio</span><b>{brl0(sales.length ? total / sales.length : 0)}</b><small>por venda</small></div>
        <div className="stat"><span>Fechadas pela IA</span><b>{brl0(byOrigin[0].value)}</b><small>{total ? Math.round((byOrigin[0].value / total) * 100) : 0}% do total</small></div>
        <div className="stat"><span>Meta do mês</span><b>{me.company.monthly_goal ? `${Math.round((range === 'mes' ? total / me.company.monthly_goal : 0) * 100)}%` : '—'}</b><small>{range === 'mes' ? `de ${brl0(me.company.monthly_goal)}` : 'veja em “Este mês”'}</small></div>
      </div>
      <div className="two-col">
        <section className="card">
          <div className="card-head"><div><h3>Por origem</h3><div className="sub">Quem fechou a venda</div></div></div>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Donut parts={byOrigin} center={brl0(total)} caption="no período" />
            <div className="legend" style={{ flexDirection: 'column', gap: 10 }}>{byOrigin.map((o) => <span key={o.key}><i style={{ background: o.color }} />{o.label}<b style={{ marginLeft: 8 }}>{brl0(o.value)}</b></span>)}</div>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div><h3>Por forma de pagamento</h3><div className="sub">Valor recebido</div></div></div>
          {byMethod.length ? <HBars rows={byMethod.map((m) => ({ key: m.key, label: m.label, value: m.value, display: brl0(m.value) }))} /> : <Empty title="Sem vendas no período" />}
        </section>
      </div>
      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-head"><div><h3>Lançamentos</h3><div className="sub">{sales.length} no período</div></div></div>
        {isLoading ? <Loader /> : sales.length === 0 ? <Empty icon={<Wallet />} title="Nenhuma venda no período" action={<Button variant="solid" icon={<Plus />} onClick={() => setForm(true)}>Registrar venda</Button>}>Pelo WhatsApp: “registra uma venda de R$ 180 no Pix para a Juliana”.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th>Forma</th><th>Origem</th><th className="num">Valor</th><th /></tr></thead>
              <tbody>{sales.slice(0, 400).map((s: Sale) => (
                <tr key={s.id}>
                  <td className="muted nowrap">{fmtDateTime(s.paid_at)}</td>
                  <td>{s.contact_id ? <div className="row"><Avatar name={cmap.get(s.contact_id)?.name ?? '?'} size="sm" /><span className="truncate">{cmap.get(s.contact_id)?.name ?? '—'}</span></div> : <span className="muted">Balcão</span>}</td>
                  <td className="truncate" style={{ maxWidth: 260 }}>{s.description}</td>
                  <td>{METHOD_LABEL[s.method]}</td>
                  <td>{s.origin === 'ia' ? <Badge tone="ai" size="sm" icon={<Bot />}>IA</Badge> : <Badge size="sm">{ORIGIN_LABEL[s.origin]}</Badge>}{s.created_via === 'ia_dono' && <span className="muted tiny"> · pelo WhatsApp</span>}</td>
                  <td className="num"><b>{brl(s.amount)}</b></td>
                  <td><button className="icon-btn xs" aria-label="Excluir venda" onClick={async () => { if (await confirm({ title: 'Excluir esta venda?', text: `${brl(s.amount)} · ${s.description}`, confirm: 'Excluir', danger: true })) { await api.remove('sales', s.id); inv('sales'); toast('Venda excluída'); } }}><Trash2 /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <SaleForm open={form} onClose={closeForm} initial={{ contactId: params.get('cliente'), amount: Number(params.get('valor') || 0), quoteId: params.get('orcamento'), appointmentId: params.get('agendamento') }} />
    </>
  );
}

function SaleForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: { contactId: string | null; amount: number; quoteId: string | null; appointmentId: string | null } }) {
  const inv = useInvalidate();
  const toast = useToast();
  const { me } = useMeCtx();
  const [contactId, setContactId] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PayMethod>('pix');
  const [origin, setOrigin] = useState<SaleOrigin>('equipe');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setContactId(initial.contactId); setAmount(initial.amount || 0); setDescription(''); setDate(todayLocal()); setOrigin(initial.quoteId ? 'ia' : 'equipe'); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (amount <= 0) { toast('Informe o valor da venda', 'err'); return; }
    setBusy(true);
    try {
      const now = new Date();
      const paid = date === todayLocal() ? now : fromLocal(date, '12:00', me.company.timezone);
      await api.insert('sales', { contact_id: contactId, quote_id: initial.quoteId, appointment_id: initial.appointmentId, description: description.trim() || 'Venda', amount, method, origin: contactId ? origin : 'balcao', paid_at: paid.toISOString(), created_via: 'painel' });
      inv('sales', 'contacts'); toast('Venda registrada'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Registrar venda" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Registrar</Button></>}>
      <div className="form-grid">
        <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Forma de pagamento"><Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{(Object.keys(METHOD_LABEL) as PayMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select></Field>
        <Field label="Cliente (opcional)" className="full"><ContactPicker value={contactId} onChange={(c) => setContactId(c?.id ?? null)} /></Field>
        <Field label="Descrição" className="full"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Limpeza de sofá 3 lugares" /></Field>
        <Field label="Data"><Input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Quem fechou"><Select value={contactId ? origin : 'balcao'} disabled={!contactId} onChange={(e) => setOrigin(e.target.value as SaleOrigin)}>{(Object.keys(ORIGIN_LABEL) as SaleOrigin[]).map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}</Select></Field>
      </div>
      <p className={cx('muted', 'small')} style={{ marginTop: 12 }}>Dica: pelo WhatsApp é só mandar “registra uma venda de R$ 180 no Pix para a Juliana”. A IA pede sua confirmação antes de lançar.</p>
    </Modal>
  );
}
