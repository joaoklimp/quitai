// Tarefas e lembretes do dono (também criados pelo WhatsApp: "me lembra de...").
import { useMemo, useState } from 'react';
import { Bot, CalendarClock, Check, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Task } from '../data/types';
import { useMeCtx } from '../context';
import { Badge, Button, Empty, Input, Loader, PageHeader, cx, useToast } from '../ui';
import { addDays, fmtDateTime, fromLocal, localDate, todayLocal } from '../../shared/format';
import { parseDate, parseTime } from '../../shared/parse';
import { fold } from '../../shared/format';

export default function Tasks() {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const today = todayLocal(tz);
  const { data = [], isLoading } = useList('tasks', { order: [{ col: 'due_at', asc: true }], limit: 500 });
  const inv = useInvalidate();
  const toast = useToast();
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const groups = useMemo(() => {
    const open = data.filter((t) => !t.done_at);
    const late = open.filter((t) => t.due_at && Date.parse(t.due_at) < Date.now() && localDate(t.due_at, tz) < today);
    const todayL = open.filter((t) => t.due_at && localDate(t.due_at, tz) === today);
    const next = open.filter((t) => !t.due_at || localDate(t.due_at, tz) > today);
    const done = data.filter((t) => t.done_at).sort((a, b) => ((b.done_at ?? '') > (a.done_at ?? '') ? 1 : -1));
    return { late, todayL, next, done };
  }, [data, today, tz]);
  const add = async () => {
    const raw = text.trim();
    if (!raw) return;
    const f = fold(raw);
    const d = parseDate(f, today), t = parseTime(f);
    const title = raw.replace(/\s+(hoje|amanh[ãa]|depois de amanh[ãa]|(na |no )?(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?|[àa]s\s+\d{1,2}(h|:\d{2})?\d*|dia \d{1,2}|\d{1,2}\/\d{1,2})\b.*$/i, '').trim() || raw;
    await api.insert('tasks', { title: title[0].toUpperCase() + title.slice(1), due_at: d || t ? fromLocal(d ?? today, t ?? '09:00', tz).toISOString() : null, done_at: null, contact_id: null, reminded_at: null, created_via: 'painel' });
    setText(''); inv('tasks'); toast(d || t ? 'Tarefa criada com lembrete' : 'Tarefa criada');
  };
  const toggle = async (t: Task) => { await api.update('tasks', t.id, { done_at: t.done_at ? null : new Date().toISOString() }); inv('tasks'); };
  const Row = ({ t }: { t: Task }) => (
    <div className={cx('task', t.done_at && 'done')}>
      <button className="task-check" onClick={() => toggle(t)} aria-label={t.done_at ? 'Reabrir' : 'Concluir'}>{t.done_at && <Check />}</button>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="task-title">{t.title}</div>
        <div className="muted small row" style={{ gap: 8 }}>{t.due_at && <span className="row" style={{ gap: 4 }}><CalendarClock style={{ width: 13 }} />{fmtDateTime(t.due_at)}</span>}{t.created_via === 'ia_dono' && <Badge tone="ai" size="sm" icon={<Bot />}>pelo WhatsApp</Badge>}</div>
      </div>
      <button className="icon-btn xs" aria-label="Excluir" onClick={async () => { await api.remove('tasks', t.id); inv('tasks'); }}><Trash2 /></button>
    </div>
  );
  const Section = ({ title, list, tone }: { title: string; list: Task[]; tone?: string }) => list.length ? <section className="card" style={{ marginBottom: 16 }}><div className="card-head"><div><h3 style={{ color: tone }}>{title}</h3><div className="sub">{list.length}</div></div></div><div className="tasks">{list.map((t) => <Row key={t.id} t={t} />)}</div></section> : null;
  return (
    <>
      <PageHeader title="Tarefas" subtitle="Seus lembretes. Pelo WhatsApp é só mandar “me lembra de ligar para o fornecedor amanhã às 9h”." />
      <form className="task-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Plus />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nova tarefa… (ex.: conferir estoque amanhã às 10h)" aria-label="Nova tarefa" />
        <Button type="submit" variant="solid" disabled={!text.trim()}>Adicionar</Button>
      </form>
      {isLoading ? <Loader /> : data.length === 0 ? <Empty icon={<ClipboardList />} title="Nenhuma tarefa" >Anote aqui o que você não pode esquecer. Você recebe o lembrete no WhatsApp.</Empty> : <>
        <Section title="Atrasadas" list={groups.late} tone="var(--red-ink)" />
        <Section title="Hoje" list={groups.todayL} />
        <Section title="Próximas" list={groups.next} />
        {groups.done.length > 0 && <Button variant="ghost" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Esconder' : 'Mostrar'} concluídas ({groups.done.length})</Button>}
        {showDone && <Section title="Concluídas" list={groups.done.slice(0, 50)} />}
      </>}
      <p className="muted small" style={{ marginTop: 10 }}>Amanhã: {addDays(today, 1).split('-').reverse().join('/')}</p>
    </>
  );
}
