// Visão geral: o resumo do negócio no período, no estilo "placa de vidro sobre o céu".
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, CalendarDays, Check, ChevronDown, Download, MapPin, MessageCircle, MoreHorizontal, Send, Share2, Sparkles, Table2, Timer, TrendingUp,
  UserPlus, Wand2, FileText, CalendarCheck, CircleDollarSign, BellRing, Bot,
} from 'lucide-react';
import { useMeCtx, useAssistant } from '../context';
import { useList, useStats } from '../data/hooks';
import { bucketize, change, chatRevenue, rangeFor, sum, avgResponse, aiShare, PERIOD_LABEL, PERIOD_SHORT, type Period } from '../data/metrics';
import { PairBars, RadialGauge, GoalBar, Funnel, HBars, Sparkline } from '../charts';
import { Badge, Button, Delta, Empty, IconButton, Menu, PageHeader, Avatar, cx, useToast } from '../ui';
import { addDays, brl, brl0, brlShort, firstName, fmtAgo, fmtDuration, fmtLong, fmtTime, localDate, MONTHS, num, todayLocal, fromLocal } from '../../shared/format';
import type { AuditEntry, Contact, DailyStat } from '../data/types';

const PERIOD_KEY = 'combinado-periodo';
function usePeriod(): [Period, (p: Period) => void] {
  const [p, setP] = useState<Period>(() => { try { return (localStorage.getItem(PERIOD_KEY) as Period) || '7d'; } catch { return '7d'; } });
  return [p, (v) => { setP(v); try { localStorage.setItem(PERIOD_KEY, v); } catch { /* ignora */ } }];
}

export default function Dashboard() {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const today = todayLocal(tz);
  const [period, setPeriod] = usePeriod();
  const range = useMemo(() => rangeFor(period, today), [period, today]);
  const { data: rows, isFetching } = useStats(range.prevFrom, range.to);
  const toast = useToast();
  const [table, setTable] = useState(false);

  const cur = useMemo(() => sum((rows ?? []).filter((r) => r.day >= range.from)), [rows, range]);
  const prev = useMemo(() => sum((rows ?? []).filter((r) => r.day < range.from)), [rows, range]);
  const buckets = useMemo(() => bucketize((rows ?? []).filter((r) => r.day >= range.from), range), [rows, range]);
  const monthStart = `${today.slice(0, 7)}-01`;
  const { data: monthRows } = useStats(monthStart, today);
  const month = useMemo(() => sum(monthRows ?? []), [monthRows]);
  const { data: rows30 } = useStats(addDays(today, -30), addDays(today, -1));
  const last30 = useMemo(() => sum(rows30 ?? []), [rows30]);

  const exportCsv = () => {
    const lines = [['Período', 'Conversas', 'Vendas', 'Valor vendido (R$)', 'Orçamentos aprovados'].join(';'), ...buckets.map((b) => [b.long, b.stat.conversations, b.stat.sales_count, b.stat.sales_amount.toFixed(2).replace('.', ','), b.stat.quotes_approved].join(';'))];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `combinado-visao-geral-${period}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const share = async () => {
    const text = `Resumo ${PERIOD_LABEL[period].toLowerCase()} — ${me.company.name}\n• ${num(cur.conversations)} conversas no WhatsApp (${Math.round(aiShare(cur) * 100)}% respondidas pela IA)\n• ${num(cur.quotes_approved)} orçamentos aprovados\n• ${brl(cur.sales_amount)} em vendas (${num(cur.sales_count)})\n• Tempo médio de resposta: ${fmtDuration(avgResponse(cur))}\nGerado pelo Combinado`;
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Resumo copiado. É só colar no WhatsApp.'); }
    } catch { /* cancelado */ }
  };

  return (
    <>
      <PageHeader
        eyebrow={<>{fmtLong(today)[0].toUpperCase() + fmtLong(today).slice(1)}</>}
        title="Visão geral"
        subtitle={`Tudo o que aconteceu nas conversas da ${me.company.name}, em tempo real.`}
        actions={<>
          <Menu trigger={({ toggle }) => <Button onClick={toggle} icon={<CalendarDays />}>{PERIOD_LABEL[period]}<ChevronDown style={{ width: 15 }} /></Button>}>
            {(close) => (['7d', '30d', '90d', '12m'] as Period[]).map((p) => <button key={p} onClick={() => { setPeriod(p); close(); }}>{PERIOD_LABEL[p]}{p === period && <Check className="check-mark" />}</button>)}
          </Menu>
          <Button icon={<Download />} onClick={exportCsv} className="only-desktop">Exportar</Button>
          <Button variant="solid" icon={<Share2 />} onClick={share}>Compartilhar resumo</Button>
        </>}
      />

      <div className={cx('dash', isFetching && rows && 'refetching')}>
        <KpiStrip cur={cur} prev={prev} periodShort={PERIOD_SHORT[period]} month={month} goal={me.company.monthly_goal} today={today} last30={last30} />
        <AiSuggestions />

        <section className="card dash-chart">
          <div className="card-head">
            <div>
              <h3>Conversas x Vendas</h3>
              <div className="sub"><TrendingUp style={{ width: 14 }} /><Delta value={change(cur.sales_count, prev.sales_count)} suffix="em vendas vs período anterior" /></div>
            </div>
            <div className="actions">
              <Link to="/analises" className="btn sm">Ver relatório<ArrowUpRight /></Link>
              <IconButton label={table ? 'Ver gráfico' : 'Ver tabela'} size="sm" onClick={() => setTable((t) => !t)}><Table2 /></IconButton>
              <Menu trigger={({ toggle }) => <IconButton label="Mais opções" size="sm" onClick={toggle}><MoreHorizontal /></IconButton>}>
                {(close) => <><button onClick={() => { exportCsv(); close(); }}><Download />Exportar CSV</button><button onClick={() => { setTable((t) => !t); close(); }}><Table2 />{table ? 'Ver gráfico' : 'Ver como tabela'}</button></>}
              </Menu>
            </div>
          </div>
          <div className="legend" style={{ marginBottom: 14 }}><span><i style={{ background: 'var(--c1)' }} />Conversas</span><span><i style={{ background: 'var(--c2)' }} />Vendas</span></div>
          <PairBars table={table} aName="Conversas" bName="Vendas" height={250}
            data={buckets.map((b) => ({ key: b.key, label: b.label, long: b.long, a: b.stat.conversations, b: b.stat.sales_count, extra: [['Valor vendido', brl0(b.stat.sales_amount)], ['Conversão', `${b.stat.conversations ? Math.round((b.stat.sales_count / b.stat.conversations) * 100) : 0}%`]] }))} />
        </section>

        <LeadQuality />
        <TodayAgenda tz={tz} today={today} />
        <NeedsYou />
        <AiWork today={today} rows={rows ?? []} />
        <section className="card dash-funnel">
          <div className="card-head"><div><h3>Funil de vendas</h3><div className="sub">{PERIOD_LABEL[period]}</div></div><Link to="/analises" className="btn sm ghost">Detalhes<ArrowUpRight /></Link></div>
          <Funnel steps={[{ label: 'Conversas', value: cur.conversations }, { label: 'Orçamentos enviados', value: cur.quotes_sent }, { label: 'Aprovados', value: cur.quotes_approved }, { label: 'Vendas', value: cur.sales_count }]} />
        </section>
        <TopServices from={range.from} tz={tz} />
      </div>
    </>
  );
}

/* ---------- faixa de indicadores + meta do mês ---------- */
function KpiStrip({ cur, prev, periodShort, month, goal, today, last30 }: { cur: DailyStat; prev: DailyStat; periodShort: string; month: DailyStat; goal: number; today: string; last30: DailyStat }) {
  const { data: waiting = [] } = useList('conversations', { filters: [{ col: 'needs_attention', op: 'eq', value: true }, { col: 'status', op: 'eq', value: 'aberta' }] });
  const nav = useNavigate();
  const monthName = MONTHS[Number(today.slice(5, 7)) - 1];
  const total = month.sales_amount;
  const [yy, mm, dd] = today.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  // projeção: média diária dos últimos 30 dias aplicada aos dias que faltam
  const pace = Math.round(total + (last30.sales_amount / 30) * (daysInMonth - dd));
  const kpis = [
    { label: 'Novos leads', value: num(cur.new_contacts), delta: change(cur.new_contacts, prev.new_contacts), good: true, to: '/clientes', icon: UserPlus },
    { label: 'Aguardando você', value: num(waiting.length), sub: waiting.length ? `${waiting.length === 1 ? 'conversa' : 'conversas'} na fila` : 'fila zerada 🎉', to: '/conversas', icon: MessageCircle },
    { label: 'Tempo de resposta', value: fmtDuration(avgResponse(cur)), delta: change(avgResponse(cur), avgResponse(prev)), good: false, to: '/analises', icon: Timer },
    { label: 'Vendas pelas conversas', value: brlShort(chatRevenue(cur)), delta: change(chatRevenue(cur), chatRevenue(prev)), good: true, to: '/vendas', icon: CircleDollarSign },
  ];
  return (
    <section className="card dash-kpis" aria-label="Indicadores">
      <div className="kpi-row">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <div className="kpi-top"><span>{k.label}</span><IconButton label={`Abrir ${k.label.toLowerCase()}`} size="xs" onClick={() => nav(k.to)}><ArrowUpRight /></IconButton></div>
            <div className="kpi-val"><b>{k.value}</b>{'delta' in k && k.delta !== undefined ? <Delta value={k.delta} goodWhenUp={k.good} suffix={`vs ${periodShort} anteriores`} /> : <span className="kpi-sub">{k.sub}</span>}</div>
          </div>
        ))}
      </div>
      <div className="kpi-goal">
        <div className="goal-head">
          <span className="t">Meta de vendas de {monthName}</span>
          <span className="v"><b>{brl0(total)}</b> de {brl0(goal)} · {goal ? Math.round((total / goal) * 100) : 0}%</span>
        </div>
        {pace > 0 && <div className="goal-pace">No ritmo atual, o mês fecha em <b>{brl0(pace)}</b>{goal ? <> · {pace >= goal ? 'acima da meta 🎯' : `faltariam ${brl0(goal - pace)}`}</> : null}</div>}
        <GoalBar goal={goal} parts={[
          { key: 'ia', label: 'Fechadas pela IA', value: month.sales_ia, color: 'var(--c1)', display: brl0(month.sales_ia) },
          { key: 'eq', label: 'Fechadas pela equipe', value: month.sales_equipe, color: 'var(--c2)', display: brl0(month.sales_equipe) },
          { key: 'bal', label: 'Balcão e outros', value: month.sales_balcao, color: 'var(--c3)', display: brl0(month.sales_balcao) },
        ]} />
        <div className="legend" style={{ marginTop: 12 }}>
          <span><i style={{ background: 'var(--c1)' }} />IA {brl0(month.sales_ia)}</span>
          <span><i style={{ background: 'var(--c2)' }} />Equipe {brl0(month.sales_equipe)}</span>
          <span><i style={{ background: 'var(--c3)' }} />Balcão {brl0(month.sales_balcao)}</span>
          <span><i style={{ background: 'var(--hatch)', border: '1px solid var(--line-2)' }} />Falta {brl0(Math.max(0, goal - total))}</span>
        </div>
      </div>
    </section>
  );
}

/* ---------- sugestões da IA (regras sobre os dados) ---------- */
function AiSuggestions() {
  const assistant = useAssistant();
  const nav = useNavigate();
  const twoDaysAgo = useMemo(() => new Date(Date.now() - 2 * 86400000).toISOString(), []);
  const { data: stale = [] } = useList('quotes', { filters: [{ col: 'status', op: 'eq', value: 'enviado' }, { col: 'sent_at', op: 'lt', value: twoDaysAgo }], limit: 50 });
  const { data: waiting = [] } = useList('conversations', { filters: [{ col: 'needs_attention', op: 'eq', value: true }, { col: 'status', op: 'eq', value: 'aberta' }], order: [{ col: 'last_inbound_at', asc: true }] });
  const { data: lastIn = [] } = useList('messages', { filters: [{ col: 'direction', op: 'eq', value: 'in' }, { col: 'channel', op: 'eq', value: 'whatsapp' }], order: [{ col: 'created_at', asc: false }], limit: 1 });
  const { data: contacts = [] } = useList('contacts', waiting.length ? { filters: [{ col: 'id', op: 'in', value: waiting.map((w) => w.contact_id ?? '') }] } : { limit: 0 }, { enabled: waiting.length > 0 });
  const staleTotal = stale.reduce((s, q) => s + q.total, 0);
  const first = waiting[0];
  const firstContact = contacts.find((c) => c.id === first?.contact_id);
  const items: { icon: typeof Send; tone: string; text: string; cta: string; run: () => void }[] = [];
  if (first) items.push({ icon: BellRing, tone: 'orange', text: `${firstName(firstContact?.name) || 'Um cliente'} está esperando há ${fmtAgo(first.last_inbound_at).replace('há ', '')}${first.attention_reason ? ` · ${first.attention_reason}` : ''}`, cta: 'Responder', run: () => nav(`/conversas/${first.id}`) });
  if (stale.length) items.push({ icon: Send, tone: 'blue', text: `${stale.length} ${stale.length === 1 ? 'orçamento parado' : 'orçamentos parados'} há mais de 2 dias (${brl0(staleTotal)})`, cta: 'Acompanhar', run: () => assistant.ask('Manda uma mensagem de acompanhamento para os orçamentos parados há mais de 2 dias') });
  items.push({ icon: CalendarDays, tone: 'violet', text: 'Veja os horários livres de amanhã e ofereça para quem pediu orçamento', cta: 'Ver agenda', run: () => assistant.ask('O que tenho na agenda amanhã?') });
  return (
    <section className="card dash-ai">
      <div className="ai-visual" aria-hidden>
        <div className="bubble b1">{lastIn[0]?.body?.slice(0, 46) ?? 'Oi! Quanto custa uma limpeza de sofá?'}</div>
        <div className="bubble b2">Temos horário sexta às 14h. Posso reservar?</div>
        <div className="gen"><Sparkles /><span>Gerando resposta</span><span className="typing"><i /><i /><i /></span></div>
        <Send className="send" />
      </div>
      <h3 className="ai-title">Sugestões da IA</h3>
      <p className="ai-sub">O que fazer agora para não perder venda.</p>
      <ul className="ai-list">
        {items.slice(0, 3).map((it, i) => (
          <li key={i}><span className={cx('ai-ic', it.tone)}><it.icon /></span><span className="grow"><span>{it.text}</span><button className="link" onClick={it.run}>{it.cta} →</button></span></li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- qualidade dos leads ---------- */
function LeadQuality() {
  const since = useMemo(() => new Date(Date.now() - 30 * 86400000).toISOString(), []);
  const { data = [] } = useList('contacts', { filters: [{ col: 'last_interaction_at', op: 'gte', value: since }] });
  const by = (t: Contact['temperature']) => data.filter((c) => c.temperature === t && c.stage !== 'perdido').length;
  const parts = [
    { key: 'quente', label: 'Quentes', value: by('quente'), color: 'var(--c2)' },
    { key: 'morno', label: 'Mornos', value: by('morno'), color: 'var(--c-muted)' },
    { key: 'frio', label: 'Frios', value: by('frio'), color: 'var(--c1)' },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <section className="card dash-gauge">
      <div className="card-head"><div><h3>Qualidade dos leads</h3><div className="sub">Clientes ativos nos últimos 30 dias</div></div>
        <Menu trigger={({ toggle }) => <IconButton label="Mais opções" size="sm" onClick={toggle}><MoreHorizontal /></IconButton>}>
          {(close) => <Link to="/clientes?temperatura=quente" onClick={close}><UserPlus />Ver leads quentes</Link>}
        </Menu>
      </div>
      {total === 0 ? <Empty title="Sem leads ainda">Quando os clientes chamarem no WhatsApp, a IA classifica cada um aqui.</Empty> : <RadialGauge parts={parts} center={num(total)} caption="leads ativos" />}
    </section>
  );
}

/* ---------- agenda de hoje ---------- */
function TodayAgenda({ tz, today }: { tz: string; today: string }) {
  const start = useMemo(() => fromLocal(today, '00:00', tz).toISOString(), [today, tz]);
  const end = useMemo(() => fromLocal(addDays(today, 1), '00:00', tz).toISOString(), [today, tz]);
  const { data = [] } = useList('appointments', { filters: [{ col: 'starts_at', op: 'gte', value: start }, { col: 'starts_at', op: 'lt', value: end }, { col: 'status', op: 'neq', value: 'cancelado' }], order: [{ col: 'starts_at' }] });
  const ids = data.map((a) => a.contact_id).filter(Boolean) as string[];
  const { data: contacts = [] } = useList('contacts', ids.length ? { filters: [{ col: 'id', op: 'in', value: ids }] } : { limit: 0 }, { enabled: ids.length > 0 });
  const now = Date.now();
  return (
    <section className="card dash-agenda">
      <div className="card-head"><div><h3>Agenda de hoje</h3><div className="sub">{data.length ? `${data.length} ${data.length === 1 ? 'horário' : 'horários'} · ${data.filter((a) => a.status === 'concluido').length} concluídos` : 'Dia livre'}</div></div><Link to="/agenda" className="btn sm ghost">Abrir agenda<ArrowUpRight /></Link></div>
      {data.length === 0 ? <Empty icon={<CalendarDays />} title="Nenhum horário hoje">Quando a IA reservar um horário pelo WhatsApp, ele aparece aqui na hora.</Empty> : (
        <ol className="timeline">
          {data.map((a) => {
            const c = contacts.find((x) => x.id === a.contact_id);
            const nowOn = Date.parse(a.starts_at) <= now && Date.parse(a.ends_at) > now;
            return (
              <li key={a.id} className={cx(a.status === 'concluido' && 'done', nowOn && 'now')}>
                <span className="tl-time num">{fmtTime(a.starts_at, tz)}</span>
                <span className="tl-dot" />
                <div className="tl-body">
                  <div className="row between"><b className="truncate">{c?.name ?? 'Cliente'}</b>{a.status === 'concluido' ? <Badge tone="green" size="sm">Concluído</Badge> : nowOn ? <Badge tone="blue" size="sm" dot>Agora</Badge> : a.status === 'pendente' ? <Badge tone="yellow" size="sm">A confirmar</Badge> : <Badge size="sm">Confirmado</Badge>}</div>
                  <div className="muted small truncate">{a.title}{a.created_via === 'ia_cliente' && <> · <Bot className="ii" /> marcado pela IA</>}</div>
                  {a.address && <div className="muted tiny truncate"><MapPin className="ii" /> {a.address}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ---------- precisam de você ---------- */
function NeedsYou() {
  const { data = [] } = useList('conversations', { filters: [{ col: 'needs_attention', op: 'eq', value: true }, { col: 'status', op: 'eq', value: 'aberta' }], order: [{ col: 'last_inbound_at', asc: true }], limit: 5 });
  const ids = data.map((a) => a.contact_id).filter(Boolean) as string[];
  const { data: contacts = [] } = useList('contacts', ids.length ? { filters: [{ col: 'id', op: 'in', value: ids }] } : { limit: 0 }, { enabled: ids.length > 0 });
  return (
    <section className="card dash-needs">
      <div className="card-head"><div><h3>Precisam de você</h3><div className="sub">A IA passou estes atendimentos para a equipe</div></div></div>
      {data.length === 0 ? <Empty icon={<Check />} title="Tudo em dia">A IA está dando conta das conversas. Quando precisar de uma pessoa, aparece aqui.</Empty> : (
        <ul className="needs">
          {data.map((cv) => {
            const c = contacts.find((x) => x.id === cv.contact_id);
            return (
              <li key={cv.id}>
                <Link to={`/conversas/${cv.id}`} className="needs-item">
                  <Avatar name={c?.name ?? '?'} size="sm" />
                  <span className="grow"><b className="truncate" style={{ display: 'block' }}>{c?.name ?? 'Cliente'}</b><span className="muted small truncate" style={{ display: 'block' }}>{cv.attention_reason ?? cv.last_message_preview}</span></span>
                  <span className="wait">{fmtAgo(cv.last_inbound_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- o que a IA fez ---------- */
const ACT_ICON: Record<string, typeof Bot> = { agendar_horario: CalendarCheck, agendar: CalendarCheck, solicitar_orcamento: FileText, criar_orcamento: FileText, registrar_venda: CircleDollarSign, cadastrar_cliente: UserPlus, chamar_atendente: BellRing, enviar_orcamento: Send };
function AiWork({ today, rows }: { today: string; rows: DailyStat[] }) {
  const { data = [] } = useList('audit_log', { filters: [{ col: 'actor_type', op: 'eq', value: 'ia' }], order: [{ col: 'created_at', asc: false }], limit: 6 });
  const t = rows.find((r) => r.day === today);
  const trend = rows.slice(-12).map((r) => r.msgs_ai);
  return (
    <section className="card dash-aiwork">
      <div className="card-head">
        <div><h3>A IA trabalhou por você</h3><div className="sub">{t ? `Hoje: ${num(t.msgs_ai)} respostas · ${num(t.appointments)} horários marcados` : 'Hoje'}</div></div>
        <Sparkline values={trend} width={96} height={30} />
      </div>
      {data.length === 0 ? <Empty icon={<Wand2 />} title="Nenhuma ação ainda" /> : (
        <ul className="feed">
          {data.map((e: AuditEntry) => {
            const I = ACT_ICON[e.action] ?? Sparkles;
            return <li key={e.id}><span className={cx('feed-ic', e.status === 'aguardando' && 'wait')}><I /></span><span className="grow"><span className="feed-t">{e.summary}</span><span className="feed-w">{fmtAgo(e.created_at)} · {e.channel === 'ia_dono' ? 'pedido do dono' : 'atendendo cliente'}</span></span></li>;
          })}
        </ul>
      )}
      <Link to="/historico" className="btn sm soft block" style={{ marginTop: 12 }}>Ver histórico completo</Link>
    </section>
  );
}

/* ---------- serviços que mais vendem ---------- */
function TopServices({ from, tz }: { from: string; tz: string }) {
  const start = useMemo(() => fromLocal(from, '00:00', tz).toISOString(), [from, tz]);
  const { data = [] } = useList('sales', { filters: [{ col: 'paid_at', op: 'gte', value: start }] });
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data) { const k = s.description.split(' + ')[0].replace(/\s*\(.*\)$/, ''); m.set(k, (m.get(k) ?? 0) + s.amount); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ key: label, label, value, display: brl0(value) }));
  }, [data]);
  return (
    <section className="card dash-top">
      <div className="card-head"><div><h3>Serviços que mais vendem</h3><div className="sub">Faturamento no período</div></div><Link to="/vendas" className="btn sm ghost">Vendas<ArrowUpRight /></Link></div>
      {rows.length ? <HBars rows={rows} /> : <Empty title="Sem vendas no período" />}
      <div className="muted tiny" style={{ marginTop: 12 }}>Atualizado {fmtAgo(new Date().toISOString())} · {localDate(new Date(), tz) === from ? 'hoje' : `desde ${from.split('-').reverse().join('/')}`}</div>
    </section>
  );
}
