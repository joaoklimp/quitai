// Histórico de ações: tudo o que a IA, a equipe e as automações fizeram, para auditoria.
import { Fragment, useMemo, useState } from 'react';
import { Bot, Download, History as HistoryIcon, Search, Settings2, User, Workflow, Clock3, CircleSlash, XCircle, Check } from 'lucide-react';
import { useList } from '../data/hooks';
import type { AuditEntry, Channel } from '../data/types';
import { Badge, Button, Empty, Loader, PageHeader, Select, cx, useDebounced } from '../ui';
import { dayLabel } from '../ui/chat';
import { fmtDateTime, fmtTime, fold, localDate } from '../../shared/format';

const CH_LABEL: Record<Channel, string> = { painel: 'Painel', ia_cliente: 'IA atendendo cliente', ia_dono: 'Pedido do dono (IA)', automacao: 'Automação', site: 'Site', whatsapp: 'WhatsApp' };
const ACTOR: Record<AuditEntry['actor_type'], { label: string; icon: typeof Bot; cls: string }> = {
  ia: { label: 'IA', icon: Bot, cls: 'ai' }, usuario: { label: 'Equipe', icon: User, cls: 'team' }, sistema: { label: 'Sistema', icon: Workflow, cls: 'sys' }, cliente: { label: 'Cliente', icon: User, cls: 'client' },
};
const ST: Record<AuditEntry['status'], { label: string; tone: 'green' | 'yellow' | 'red' | undefined; icon: typeof Check }> = {
  ok: { label: 'Feito', tone: 'green', icon: Check }, aguardando: { label: 'Aguardando confirmação', tone: 'yellow', icon: Clock3 }, negado: { label: 'Negado', tone: 'red', icon: CircleSlash }, erro: { label: 'Erro', tone: 'red', icon: XCircle }, cancelado: { label: 'Cancelado', tone: undefined, icon: CircleSlash },
};

export default function History() {
  const [actor, setActor] = useState<AuditEntry['actor_type'] | 'todos'>('todos');
  const [channel, setChannel] = useState<Channel | 'todos'>('todos');
  const [q, setQ] = useState('');
  const term = useDebounced(q, 200);
  const [limit, setLimit] = useState(200);
  const { data = [], isLoading } = useList('audit_log', { filters: [...(actor !== 'todos' ? [{ col: 'actor_type', op: 'eq' as const, value: actor }] : []), ...(channel !== 'todos' ? [{ col: 'channel', op: 'eq' as const, value: channel }] : [])], order: [{ col: 'created_at', asc: false }], limit });
  const list = useMemo(() => (term.trim() ? data.filter((e) => fold(e.summary).includes(fold(term)) || fold(e.actor_name).includes(fold(term))) : data), [data, term]);
  const exportCsv = () => {
    const rows = [['Quando', 'Quem', 'Canal', 'Ação', 'Resumo', 'Situação'].join(';'), ...list.map((e) => [fmtDateTime(e.created_at), e.actor_name ?? ACTOR[e.actor_type].label, CH_LABEL[e.channel], e.action, `"${e.summary.replace(/"/g, '""')}"`, ST[e.status].label].join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'historico-de-acoes.csv'; a.click();
  };
  let lastDay = '';
  return (
    <>
      <PageHeader title="Histórico de ações" subtitle="Tudo o que muda no sistema fica registrado: quem fez, por onde e quando. Nada some sem deixar rastro."
        actions={<Button icon={<Download />} onClick={exportCsv}>Exportar</Button>} />
      <div className="filters">
        <div className="input-wrap" style={{ flex: '1 1 240px', maxWidth: 360 }}><Search /><input className="input" placeholder="Buscar no histórico" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar no histórico" /></div>
        <div className="row wrap" style={{ gap: 6 }}>
          {(['todos', 'ia', 'usuario', 'sistema'] as const).map((a) => <button key={a} className={cx('chip', actor === a && 'on')} onClick={() => setActor(a)}>{a === 'todos' ? 'Todos' : ACTOR[a].label}</button>)}
        </div>
        <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel | 'todos')} style={{ width: 230 }} aria-label="Canal">
          <option value="todos">Todos os canais</option>
          {(Object.keys(CH_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}
        </Select>
      </div>
      <section className="card">
        {isLoading ? <Loader /> : list.length === 0 ? <Empty icon={<HistoryIcon />} title="Nada por aqui" >Quando a IA ou a equipe fizerem algo, aparece aqui.</Empty> : (
          <ol className="audit">
            {list.map((e) => {
              const d = localDate(e.created_at);
              const head = d !== lastDay ? <li className="audit-day">{dayLabel(e.created_at)}</li> : null;
              lastDay = d;
              const A = ACTOR[e.actor_type]; const S = ST[e.status];
              return (
                <Fragment key={e.id}>
                  {head}
                  <li className="audit-row">
                    <span className={cx('audit-ic', A.cls)}><A.icon /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="audit-sum">{e.summary}</div>
                      <div className="muted small row wrap" style={{ gap: 8, marginTop: 3 }}><span>{e.actor_name ?? A.label}</span><span>·</span><span>{CH_LABEL[e.channel]}</span><span>·</span><span>{fmtTime(e.created_at)}</span></div>
                    </div>
                    {e.status !== 'ok' && <Badge tone={S.tone} size="sm" icon={<S.icon />}>{S.label}</Badge>}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}
        {data.length >= limit && <div style={{ textAlign: 'center', marginTop: 14 }}><Button onClick={() => setLimit((l) => l + 200)}>Carregar mais</Button></div>}
      </section>
      <p className="muted small row" style={{ gap: 6, marginTop: 12 }}><Settings2 style={{ width: 14 }} />Os registros são guardados por 12 meses e não podem ser editados.</p>
    </>
  );
}
