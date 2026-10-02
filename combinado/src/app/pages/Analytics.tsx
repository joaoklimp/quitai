// Análises: como o atendimento e as vendas evoluem, onde a IA ajuda e quando os clientes chamam.
import { useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Table2 } from 'lucide-react';
import { useList, usePeakHours, usePeriod, useStats } from '../data/hooks';
import { aiShare, avgResponse, bucketize, change, conversion, dayElapsed, rangeFor, sum, sumPrev, PERIOD_LABEL, type Period } from '../data/metrics';
import { useMeCtx } from '../context';
import { Donut, Funnel, Heatmap, HBars, LineChart, PairBars, Sparkline } from '../charts';
import { Button, Delta, IconButton, Menu, PageHeader, cx } from '../ui';
import { brl0, brlShort, fmtDuration, fromLocal, num, pct, todayLocal } from '../../shared/format';
import type { ContactSource, DailyStat } from '../data/types';

const SRC: Record<ContactSource, string> = { whatsapp: 'WhatsApp', manual: 'Cadastro manual', indicacao: 'Indicação', instagram: 'Instagram', site: 'Site', outro: 'Outro' };

export default function Analytics() {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const today = todayLocal(tz);
  const [period, setPeriod] = usePeriod();
  const range = useMemo(() => rangeFor(period, today), [period, today]);
  const { data: rows = [], isFetching } = useStats(range.prevFrom, range.to);
  const curRows = rows.filter((r) => r.day >= range.from);
  const cur = sum(curRows), prev = sumPrev(rows, range, dayElapsed(tz));
  const buckets = bucketize(curRows, range);
  const { data: peak } = usePeakHours(range.from, range.to);
  const [tables, setTables] = useState<Record<string, boolean>>({});
  const t = (k: string) => () => setTables((x) => ({ ...x, [k]: !x[k] }));
  const spark = (f: (r: DailyStat) => number) => buckets.slice(-12).map((b) => f(b.stat));

  const tiles = [
    { label: 'Conversas', value: num(cur.conversations), d: change(cur.conversations, prev.conversations), good: true, s: spark((r) => r.conversations) },
    { label: 'Conversão em venda', value: pct(conversion(cur), 1), d: change(conversion(cur), conversion(prev)), good: true, s: spark((r) => conversion(r)) },
    { label: 'Faturamento', value: brlShort(cur.sales_amount), d: change(cur.sales_amount, prev.sales_amount), good: true, s: spark((r) => r.sales_amount) },
    { label: 'Tempo de resposta', value: fmtDuration(avgResponse(cur)), d: change(avgResponse(cur), avgResponse(prev)), good: false, s: spark((r) => avgResponse(r)) },
    { label: 'Respondido pela IA', value: pct(aiShare(cur)), d: change(aiShare(cur), aiShare(prev)), good: true, s: spark((r) => aiShare(r)) },
    { label: 'Orçamentos aprovados', value: num(cur.quotes_approved), d: change(cur.quotes_approved, prev.quotes_approved), good: true, s: spark((r) => r.quotes_approved) },
  ];

  const since = fromLocal(range.from, '00:00', tz).toISOString();
  const { data: newContacts = [] } = useList('contacts', { filters: [{ col: 'created_at', op: 'gte', value: since }], limit: 3000 });
  const sources = useMemo(() => {
    const m = new Map<ContactSource, number>();
    for (const c of newContacts) m.set(c.source, (m.get(c.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: SRC[k], value: v, display: num(v) }));
  }, [newContacts]);
  const { data: quotes = [] } = useList('quotes', { filters: [{ col: 'created_at', op: 'gte', value: since }], limit: 3000 });
  const requested = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes) { const k = (q.title ?? 'Outros').replace(/\s*\(.*\)$/, ''); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => ({ key: k, label: k, value: v, display: `${num(v)} pedidos` }));
  }, [quotes]);
  const wd = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const hourCols = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'));
  const peakVals = (peak ?? Array.from({ length: 7 }, () => Array(24).fill(0))).map((row) => row.slice(6, 23));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const busiest = useMemo(() => {
    let best = { d: 0, h: 0, v: -1 };
    (peak ?? []).forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
    return best.v > 0 ? `${wd[best.d]} às ${String(best.h).padStart(2, '0')}h` : null;
  }, [peak]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Análises" subtitle="Os números do atendimento e das vendas, para decidir com calma."
        actions={<Menu trigger={({ toggle }) => <Button onClick={toggle} icon={<CalendarDays />}>{PERIOD_LABEL[period]}<ChevronDown style={{ width: 15 }} /></Button>}>
          {(close) => (['7d', '30d', '90d', '12m'] as Period[]).map((p) => <button key={p} onClick={() => { setPeriod(p); close(); }}>{PERIOD_LABEL[p]}{p === period && <Check className="check-mark" />}</button>)}
        </Menu>} />
      <div className={cx(isFetching && rows.length > 0 && 'refetching')}>
        <div className="tile-grid">
          {tiles.map((k) => (
            <div key={k.label} className="stat tile">
              <div className="row between" style={{ alignItems: 'flex-start' }}><span>{k.label}</span><Sparkline values={k.s} width={58} height={22} color="var(--c1)" /></div>
              <b>{k.value}</b>
              <Delta value={k.d} goodWhenUp={k.good} suffix="vs anterior" />
            </div>
          ))}
        </div>

        <div className="an-grid">
          <section className="card an-wide">
            <div className="card-head"><div><h3>Conversas x Vendas</h3><div className="sub">Quantas conversas viraram venda em cada período</div></div><IconButton label="Alternar tabela" size="sm" onClick={t('pair')}><Table2 /></IconButton></div>
            <div className="legend" style={{ marginBottom: 12 }}><span><i style={{ background: 'var(--c1)' }} />Conversas</span><span><i style={{ background: 'var(--c2)' }} />Vendas</span></div>
            <PairBars table={tables.pair} aName="Conversas" bName="Vendas" height={230} data={buckets.map((b) => ({ key: b.key, label: b.label, long: b.long, a: b.stat.conversations, b: b.stat.sales_count, extra: [['Valor', brl0(b.stat.sales_amount)]] }))} />
          </section>
          <section className="card">
            <div className="card-head"><div><h3>Quem respondeu</h3><div className="sub">Mensagens enviadas no período</div></div></div>
            <div className="row" style={{ gap: 22, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Donut parts={[{ key: 'ia', label: 'IA', value: cur.msgs_ai, color: 'var(--c1)' }, { key: 'eq', label: 'Equipe', value: cur.msgs_team, color: 'var(--c2)' }]} center={pct(aiShare(cur))} caption="pela IA" />
              <div className="legend" style={{ flexDirection: 'column', gap: 10 }}>
                <span><i style={{ background: 'var(--c1)' }} />IA<b style={{ marginLeft: 8 }}>{num(cur.msgs_ai)}</b></span>
                <span><i style={{ background: 'var(--c2)' }} />Equipe<b style={{ marginLeft: 8 }}>{num(cur.msgs_team)}</b></span>
                <span className="muted small" style={{ fontWeight: 500 }}>{num(cur.handoffs)} vezes a IA chamou uma pessoa</span>
              </div>
            </div>
          </section>
          <section className="card an-wide">
            <div className="card-head"><div><h3>Tempo médio de resposta</h3><div className="sub">Do “oi” do cliente até a primeira resposta</div></div><IconButton label="Alternar tabela" size="sm" onClick={t('resp')}><Table2 /></IconButton></div>
            {tables.resp ? <table className="chart-table"><thead><tr><th>Período</th><th>Tempo médio</th></tr></thead><tbody>{buckets.map((b) => <tr key={b.key}><td>{b.long}</td><td>{fmtDuration(avgResponse(b.stat))}</td></tr>)}</tbody></table>
              : <LineChart points={buckets.map((b) => ({ label: b.label, long: b.long, value: avgResponse(b.stat) }))} format={(v) => fmtDuration(v)} />}
          </section>
          <section className="card">
            <div className="card-head"><div><h3>Funil</h3><div className="sub">{PERIOD_LABEL[period]}</div></div></div>
            <Funnel steps={[{ label: 'Conversas', value: cur.conversations }, { label: 'Orçamentos', value: cur.quotes_sent }, { label: 'Aprovados', value: cur.quotes_approved }, { label: 'Vendas', value: cur.sales_count }]} />
          </section>
          <section className="card an-wide">
            <div className="card-head"><div><h3>Quando os clientes chamam</h3><div className="sub">{busiest ? `Pico: ${busiest}. A IA cobre noites e fins de semana.` : 'Mensagens recebidas por dia e hora'}</div></div></div>
            <Heatmap rows={order.map((d) => wd[d])} cols={hourCols} values={order.map((d) => peakVals[d])} unit="mensagens" />
          </section>
          <section className="card">
            <div className="card-head"><div><h3>De onde vêm os clientes</h3><div className="sub">Novos cadastros no período</div></div></div>
            {sources.length ? <HBars rows={sources} color="var(--c4)" /> : <p className="muted">Sem novos clientes no período.</p>}
            <div className="divider" />
            <div className="card-head" style={{ marginBottom: 10 }}><div><h3>Mais pedidos</h3><div className="sub">Serviços nos orçamentos</div></div></div>
            {requested.length ? <HBars rows={requested} /> : <p className="muted">Sem orçamentos no período.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
