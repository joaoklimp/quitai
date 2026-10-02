// Financeiro: contas a pagar e a receber, vencimentos, fluxo de caixa previsto e resultado do mês.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Check, Download, Landmark, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { FinanceEntry, FinanceKind, PayMethod } from '../data/types';
import { can, useMeCtx } from '../context';
import { PairBars } from '../charts';
import { Badge, Button, Empty, Field, Input, Loader, Modal, MoneyInput, PageHeader, Segmented, Select, Switch, Textarea, useConfirm, useToast } from '../ui';
import { ContactPicker } from '../ui/pickers';
import { addDays, brl, brl0, fmtDate, fromLocal, todayLocal, MONTHS_SHORT } from '../../shared/format';
import { METHOD_LABEL } from './Sales';

export const CATEGORIES: Record<FinanceKind, string[]> = {
  pagar: ['Fornecedores', 'Aluguel', 'Pessoal', 'Impostos', 'Contas da casa', 'Transporte', 'Equipamentos', 'Marketing', 'Outros'],
  receber: ['Serviços', 'Contratos', 'Produtos', 'Outros'],
};
type View = 'abertas' | 'vencidas' | 'mes' | 'pagas' | 'todas';
const VIEW_LABEL: Record<View, string> = { abertas: 'Em aberto', vencidas: 'Vencidas', mes: 'Vencem este mês', pagas: 'Pagas e recebidas', todas: 'Todas' };

export function statusOf(e: FinanceEntry, today: string): { label: string; tone: 'green' | 'red' | 'orange' | 'blue' } {
  if (e.paid_at) return { label: e.kind === 'pagar' ? 'Paga' : 'Recebida', tone: 'green' };
  if (e.due_date < today) return { label: 'Vencida', tone: 'red' };
  if (e.due_date === today) return { label: 'Vence hoje', tone: 'orange' };
  return { label: 'Em aberto', tone: 'blue' };
}

export default function Finance() {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const today = todayLocal(tz);
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<'todas' | FinanceKind>((params.get('tipo') as FinanceKind) || 'todas');
  const [view, setView] = useState<View>('abertas');
  const [form, setForm] = useState<{ open: boolean; entry: FinanceEntry | null; kind: FinanceKind }>({ open: !!params.get('novo'), entry: null, kind: (params.get('novo') as FinanceKind) || 'pagar' });
  const [paying, setPaying] = useState<FinanceEntry | null>(null);
  const confirm = useConfirm();
  const inv = useInvalidate();
  const toast = useToast();
  const { data: all = [], isLoading } = useList('finance_entries', { order: [{ col: 'due_date', asc: true }], limit: 3000 });
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = addDays(`${today.slice(0, 7)}-01`, 31).slice(0, 7) + '-01';
  const { data: monthSales = [] } = useList('sales', { filters: [{ col: 'paid_at', op: 'gte', value: fromLocal(monthStart, '00:00', tz).toISOString() }], limit: 3000 });

  const open = all.filter((e) => !e.paid_at);
  const sum = (l: FinanceEntry[]) => l.reduce((s, e) => s + e.amount, 0);
  const toPay = open.filter((e) => e.kind === 'pagar'), toReceive = open.filter((e) => e.kind === 'receber');
  const overdue = open.filter((e) => e.due_date < today);
  const paidThisMonth = all.filter((e) => e.paid_at && e.paid_at >= fromLocal(monthStart, '00:00', tz).toISOString());
  const inMonth = sum(paidThisMonth.filter((e) => e.kind === 'receber' && !e.sale_id)) /* o que virou venda já conta nas vendas */ + monthSales.reduce((s, x) => s + x.amount, 0);
  const outMonth = sum(paidThisMonth.filter((e) => e.kind === 'pagar'));

  // fluxo previsto: próximas 6 semanas (vencidas entram na primeira)
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const start = addDays(today, i * 7), end = addDays(today, i * 7 + 6);
    const inWeek = (e: FinanceEntry) => (i === 0 ? e.due_date <= end : e.due_date >= start && e.due_date <= end);
    const [, m, d] = start.split('-').map(Number);
    return { key: start, label: i === 0 ? 'Esta sem.' : `${d}/${MONTHS_SHORT[m - 1]}`, long: `Semana de ${fmtDate(start)} a ${fmtDate(end)}`, a: Math.round(sum(open.filter((e) => e.kind === 'receber' && inWeek(e)))), b: Math.round(sum(open.filter((e) => e.kind === 'pagar' && inWeek(e)))) };
  }), [open, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = all.filter((e) => (kind === 'todas' || e.kind === kind) && (
    view === 'abertas' ? !e.paid_at : view === 'vencidas' ? !e.paid_at && e.due_date < today : view === 'mes' ? e.due_date >= monthStart && e.due_date < monthEnd : view === 'pagas' ? !!e.paid_at : true));
  const shown = view === 'pagas' ? [...list].sort((a, b) => ((b.paid_at ?? '') > (a.paid_at ?? '') ? 1 : -1)) : list;

  const exportCsv = () => {
    const rows = [['Tipo', 'Descrição', 'Categoria', 'Vencimento', 'Valor', 'Situação', 'Pago em', 'Forma', 'Fornecedor/pagador'].join(';'),
      ...shown.map((e) => [e.kind === 'pagar' ? 'A pagar' : 'A receber', e.description, e.category, fmtDate(e.due_date), e.amount.toFixed(2).replace('.', ','), statusOf(e, today).label, e.paid_at ? fmtDate(e.paid_at) : '', e.method ? METHOD_LABEL[e.method] : '', e.counterpart ?? ''].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `financeiro-${today}.csv`; a.click();
  };
  const closeForm = () => { setForm((f) => ({ ...f, open: false, entry: null })); if (params.get('novo')) setParams({}, { replace: true }); };

  if (!can(me, 'dono', 'gerente')) return <Empty icon={<Landmark />} title="Sem acesso">O financeiro fica visível só para o dono e gerentes.</Empty>;
  return (
    <>
      <PageHeader title="Financeiro" subtitle="Contas a pagar e a receber, vencimentos e o caixa previsto. Pelo WhatsApp: “lança uma conta de luz de R$ 380 para dia 10”."
        actions={<>
          <Button icon={<Download />} onClick={exportCsv} className="only-desktop">Exportar</Button>
          <Button icon={<ArrowDownLeft />} onClick={() => setForm({ open: true, entry: null, kind: 'receber' })}>A receber</Button>
          <Button variant="solid" icon={<Plus />} onClick={() => setForm({ open: true, entry: null, kind: 'pagar' })}>Conta a pagar</Button>
        </>} />

      <div className="stat-row">
        <div className="stat"><span>A pagar em aberto</span><b>{brl0(sum(toPay))}</b><small>{toPay.length} {toPay.length === 1 ? 'conta' : 'contas'}</small></div>
        <div className="stat"><span>A receber em aberto</span><b>{brl0(sum(toReceive))}</b><small>{toReceive.length} {toReceive.length === 1 ? 'lançamento' : 'lançamentos'}</small></div>
        <div className="stat"><span>Vencidas</span><b style={{ color: overdue.length ? 'var(--red-ink)' : undefined }}>{brl0(sum(overdue))}</b><small>{overdue.length ? `${overdue.length} sem pagamento` : 'nada atrasado 🙌'}</small></div>
        <div className="stat"><span>Resultado do mês</span><b style={{ color: inMonth - outMonth < 0 ? 'var(--red-ink)' : 'var(--green-ink)' }}>{brl0(inMonth - outMonth)}</b><small>entrou {brl0(inMonth)} · saiu {brl0(outMonth)}</small></div>
      </div>

      <section className="card">
        <div className="card-head"><div><h3>Caixa previsto</h3><div className="sub">O que vence nas próximas 6 semanas (as vencidas entram na primeira)</div></div></div>
        <PairBars data={weeks} aName="A receber" bName="A pagar" height={200} />
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-head wrap" style={{ gap: 10 }}>
          <Segmented label="Tipo" value={kind} onChange={setKind} options={[{ value: 'todas', label: 'Tudo' }, { value: 'pagar', label: 'A pagar', icon: <ArrowUpRight /> }, { value: 'receber', label: 'A receber', icon: <ArrowDownLeft /> }]} />
          <Select value={view} onChange={(e) => setView(e.target.value as View)} style={{ width: 200 }} aria-label="Mostrar">{(Object.keys(VIEW_LABEL) as View[]).map((v) => <option key={v} value={v}>{VIEW_LABEL[v]}</option>)}</Select>
        </div>
        {isLoading ? <Loader /> : shown.length === 0 ? <Empty icon={<Landmark />} title="Nada por aqui" action={<Button variant="solid" icon={<Plus />} onClick={() => setForm({ open: true, entry: null, kind: kind === 'receber' ? 'receber' : 'pagar' })}>Lançar conta</Button>}>Lance contas a pagar (aluguel, fornecedores, salários) e a receber (contratos, boletos) para ver o caixa previsto.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Situação</th><th className="num">Valor</th><th /></tr></thead>
              <tbody>{shown.slice(0, 500).map((e) => {
                const st = statusOf(e, today);
                return (
                  <tr key={e.id}>
                    <td className="nowrap">{fmtDate(e.due_date)}</td>
                    <td style={{ maxWidth: 320 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className={`fin-dot ${e.kind}`} aria-label={e.kind === 'pagar' ? 'A pagar' : 'A receber'}>{e.kind === 'pagar' ? <ArrowUpRight /> : <ArrowDownLeft />}</span>
                        <span className="truncate"><b style={{ fontWeight: 650 }}>{e.description}</b>{e.counterpart && <span className="muted small"> · {e.counterpart}</span>}</span>
                        {e.recurrence === 'mensal' && <Repeat className="muted" style={{ width: 14, flex: 'none' }} aria-label="Mensal" />}
                      </div>
                    </td>
                    <td className="muted">{e.category}</td>
                    <td><Badge size="sm" tone={st.tone} dot>{st.label}</Badge>{e.created_via === 'ia_dono' && <span className="muted tiny"> · pela IA</span>}</td>
                    <td className="num"><b style={{ color: e.kind === 'pagar' ? 'var(--ink)' : 'var(--green-ink)' }}>{e.kind === 'pagar' ? '−' : '+'} {brl(e.amount)}</b></td>
                    <td className="nowrap">
                      {!e.paid_at && <Button size="sm" icon={<Check />} onClick={() => setPaying(e)}>{e.kind === 'pagar' ? 'Pagar' : 'Receber'}</Button>}
                      <button className="icon-btn xs" aria-label="Editar" onClick={() => setForm({ open: true, entry: e, kind: e.kind })}><Pencil /></button>
                      <button className="icon-btn xs" aria-label="Excluir" onClick={async () => { if (await confirm({ title: 'Excluir esta conta?', text: `${e.description} · ${brl(e.amount)}`, confirm: 'Excluir', danger: true })) { await api.remove('finance_entries', e.id); inv('finance_entries'); toast('Conta excluída'); } }}><Trash2 /></button>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <EntryForm open={form.open} entry={form.entry} kind={form.kind} onClose={closeForm} />
      <PayForm entry={paying} onClose={() => setPaying(null)} />
    </>
  );
}

function EntryForm({ open, entry, kind: initialKind, onClose }: { open: boolean; entry: FinanceEntry | null; kind: FinanceKind; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [kind, setKind] = useState<FinanceKind>(initialKind);
  const [f, setF] = useState({ description: '', category: '', amount: 0, due_date: todayLocal(), counterpart: '', contact_id: null as string | null, recurrence: false, notes: '', paid: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKind(entry?.kind ?? initialKind);
    setF(entry ? { description: entry.description, category: entry.category, amount: entry.amount, due_date: entry.due_date, counterpart: entry.counterpart ?? '', contact_id: entry.contact_id, recurrence: entry.recurrence === 'mensal', notes: entry.notes ?? '', paid: !!entry.paid_at }
      : { description: '', category: CATEGORIES[initialKind][0], amount: 0, due_date: todayLocal(), counterpart: '', contact_id: null, recurrence: false, notes: '', paid: false });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!f.description.trim()) { toast('Escreva a descrição', 'err'); return; }
    if (f.amount <= 0) { toast('Informe o valor', 'err'); return; }
    setBusy(true);
    try {
      const row: Partial<FinanceEntry> = { kind, description: f.description.trim(), category: f.category || 'Outros', amount: f.amount, due_date: f.due_date, counterpart: f.counterpart.trim() || null, contact_id: f.contact_id, recurrence: f.recurrence ? 'mensal' : 'nenhuma', notes: f.notes.trim() || null };
      if (entry) await api.update('finance_entries', entry.id, row);
      else await api.insert('finance_entries', { ...row, created_via: 'painel', ...(f.paid ? { paid_at: new Date().toISOString(), method: 'pix' as PayMethod } : {}) });
      inv('finance_entries'); toast(entry ? 'Conta atualizada' : 'Conta lançada'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={entry ? 'Editar conta' : kind === 'pagar' ? 'Nova conta a pagar' : 'Novo valor a receber'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>{entry ? 'Salvar' : 'Lançar'}</Button></>}>
      <div className="form-grid">
        {!entry && <div className="full"><Segmented label="Tipo" value={kind} onChange={(k) => { setKind(k); setF((x) => ({ ...x, category: CATEGORIES[k][0] })); }} options={[{ value: 'pagar', label: 'A pagar', icon: <ArrowUpRight /> }, { value: 'receber', label: 'A receber', icon: <ArrowDownLeft /> }]} /></div>}
        <Field label="Descrição" className="full"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={kind === 'pagar' ? 'Ex.: Aluguel do galpão' : 'Ex.: Contrato mensal — Clínica'} autoFocus /></Field>
        <Field label="Valor"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Vencimento"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Categoria"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{[...new Set([...CATEGORIES[kind], f.category].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label={kind === 'pagar' ? 'Fornecedor (opcional)' : 'Quem paga (opcional)'}><Input value={f.counterpart} onChange={(e) => setF({ ...f, counterpart: e.target.value })} /></Field>
        {kind === 'receber' && <Field label="Cliente cadastrado (opcional)" className="full"><ContactPicker value={f.contact_id} onChange={(c) => setF({ ...f, contact_id: c?.id ?? null, counterpart: f.counterpart || c?.name || '' })} /></Field>}
        <Field label="Observação" className="full"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="row full" style={{ gap: 10 }}><Switch checked={f.recurrence} onChange={(v) => setF({ ...f, recurrence: v })} label="Repetir todo mês" /><span>Repetir todo mês <span className="muted small">(ao pagar, a do próximo mês já fica lançada)</span></span></label>
        {!entry && <label className="row full" style={{ gap: 10 }}><Switch checked={f.paid} onChange={(v) => setF({ ...f, paid: v })} label="Já foi pago" /><span>{kind === 'pagar' ? 'Já foi paga' : 'Já recebi'}</span></label>}
      </div>
    </Modal>
  );
}

function PayForm({ entry, onClose }: { entry: FinanceEntry | null; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const { me } = useMeCtx();
  const [method, setMethod] = useState<PayMethod>('pix');
  const [date, setDate] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (entry) { setMethod('pix'); setDate(todayLocal()); } }, [entry]);
  const save = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      const at = date === todayLocal() ? new Date() : fromLocal(date, '12:00', me.company.timezone);
      await api.update('finance_entries', entry.id, { paid_at: at.toISOString(), method });
      inv('finance_entries');
      toast(entry.recurrence === 'mensal' ? 'Baixada. A do próximo mês já está lançada.' : entry.kind === 'pagar' ? 'Conta paga' : 'Recebimento registrado');
      onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!entry} onClose={onClose} title={entry?.kind === 'pagar' ? 'Marcar como paga' : 'Registrar recebimento'} subtitle={entry ? `${entry.description} · ${brl(entry.amount)}` : ''}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} icon={<Check />} onClick={save}>Confirmar</Button></>}>
      <div className="form-grid">
        <Field label="Forma"><Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{(Object.keys(METHOD_LABEL) as PayMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select></Field>
        <Field label="Data"><Input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
