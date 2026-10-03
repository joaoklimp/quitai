// Agenda da clínica: semana, dia ou lista, por profissional. A IA marca pelo WhatsApp respeitando o horário
// de cada profissional, e o paciente confirma presença respondendo ao lembrete.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Bot, CalendarClock, CalendarDays, CalendarPlus, Check, CheckCheck, ChevronLeft, ChevronRight, Clock3, CreditCard, List, Phone, Stethoscope, UserX, XCircle, Columns3, Square, Wallet } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Appointment, AppointmentStatus, Contact, Professional, Service } from '../data/types';
import { useMeCtx } from '../context';
import { slotsForDate } from '../data/availability';
import { Avatar, Badge, Button, Empty, Field, IconButton, Input, Modal, MoneyInput, PageHeader, Segmented, Select, cx, useToast } from '../ui';
import { ContactPicker } from '../ui/pickers';
import { WaitlistDrawer, useWaitlistCount } from './agenda/Waitlist';
import { addDays, brl, fmtDate, fmtDateTime, fmtLong, formatPhone, fromLocal, localDate, localParts, localTime, MONTHS_SHORT, todayLocal, weekdayOf, WEEKDAYS_SHORT } from '../../shared/format';

const ST_LABEL: Record<AppointmentStatus, string> = { pendente: 'A confirmar pela clínica', confirmado: 'Marcado', concluido: 'Atendido', cancelado: 'Desmarcado', faltou: 'Faltou' };
const ST_TONE: Record<AppointmentStatus, 'yellow' | 'blue' | 'green' | 'red' | undefined> = { pendente: 'yellow', confirmado: 'blue', concluido: 'green', cancelado: undefined, faltou: 'red' };
const HOUR_H = 58;
type View = 'semana' | 'dia' | 'lista';

function mondayOf(d: string) { let x = d; while (weekdayOf(x) !== 1) x = addDays(x, -1); return x; }

export default function Agenda() {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const today = todayLocal(tz);
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => (window.innerWidth < 860 ? 'dia' : 'semana'));
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState<Appointment | null>(null);
  const [waitOpen, setWaitOpen] = useState(!!params.get('espera'));
  const waitCount = useWaitlistCount();
  const [form, setForm] = useState<{ date: string; time?: string; contactId?: string | null; quoteId?: string | null; proId?: string | null } | null>(params.get('novo') ? { date: today, contactId: params.get('cliente'), quoteId: params.get('orcamento') } : null);
  const { data: pros = [] } = useList('professionals', { order: [{ col: 'sort' }, { col: 'name' }] });
  const proId = params.get('profissional');
  const pmap = useMemo(() => new Map(pros.map((p) => [p.id, p])), [pros]);
  const setPro = (id: string | null) => { if (id) params.set('profissional', id); else params.delete('profissional'); setParams(params, { replace: true }); };

  const days = useMemo(() => {
    if (view === 'semana') { const m = mondayOf(anchor); return Array.from({ length: 7 }, (_, i) => addDays(m, i)); }
    if (view === 'dia') return [anchor];
    return Array.from({ length: 14 }, (_, i) => addDays(anchor, i));
  }, [view, anchor]);
  const from = fromLocal(days[0], '00:00', tz).toISOString();
  const to = fromLocal(addDays(days[days.length - 1], 1), '00:00', tz).toISOString();
  const { data: allAppts = [] } = useList('appointments', { filters: [{ col: 'starts_at', op: 'gte', value: from }, { col: 'starts_at', op: 'lt', value: to }], order: [{ col: 'starts_at' }] });
  const appts = useMemo(() => (proId ? allAppts.filter((a) => a.professional_id === proId) : allAppts), [allAppts, proId]);
  const pending = appts.filter((a) => !a.patient_confirmed_at && (a.status === 'confirmado' || a.status === 'pendente') && Date.parse(a.starts_at) > Date.now() && Date.parse(a.starts_at) - Date.now() < 36 * 3600000).length;
  const ids = useMemo(() => [...new Set(appts.map((a) => a.contact_id).filter(Boolean) as string[])], [appts]);
  const { data: contacts = [] } = useList('contacts', ids.length ? { filters: [{ col: 'id', op: 'in', value: ids }] } : { limit: 0 }, { enabled: ids.length > 0 });
  const cmap = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const hours = (proId && pmap.get(proId)?.business_hours) || me.company.business_hours;
  const [startH, endH] = useMemo(() => {
    let a = 24, b = 0;
    for (const iv of Object.values(hours)) for (const [o, c] of iv) { a = Math.min(a, Number(o.slice(0, 2))); b = Math.max(b, Math.ceil(Number(c.slice(0, 2)) + Number(c.slice(3, 5)) / 60)); }
    return a >= b ? [8, 18] : [Math.max(0, a - 1), Math.min(24, b + 1)];
  }, [hours]);

  const step = (n: number) => setAnchor((a) => addDays(a, view === 'semana' ? 7 * n : view === 'dia' ? n : 14 * n));
  const label = view === 'semana'
    ? (() => { const a = days[0], b = days[6]; const [, am, ad] = a.split('-').map(Number); const [by, bm, bd] = b.split('-').map(Number); return `${ad} ${MONTHS_SHORT[am - 1]} – ${bd} ${MONTHS_SHORT[bm - 1]} ${by}`; })()
    : view === 'dia' ? fmtLong(anchor)[0].toUpperCase() + fmtLong(anchor).slice(1) : `Próximos 14 dias a partir de ${fmtDate(anchor)}`;
  const closeForm = () => { setForm(null); if (params.get('novo')) { params.delete('novo'); params.delete('cliente'); params.delete('orcamento'); setParams(params, { replace: true }); } };

  return (
    <>
      <PageHeader title="Agenda" subtitle="As consultas que a IA e a recepção marcaram. A IA só oferece horários livres, na agenda de cada profissional."
        actions={<>
          <Segmented label="Visualização" value={view} onChange={setView} options={[{ value: 'semana', label: 'Semana', icon: <Columns3 /> }, { value: 'dia', label: 'Dia', icon: <Square /> }, { value: 'lista', label: 'Lista', icon: <List /> }]} />
          <Button icon={<CalendarClock />} onClick={() => setWaitOpen(true)}>Lista de espera{waitCount ? <span className="count-pill">{waitCount}</span> : null}</Button>
          <Button variant="solid" icon={<CalendarPlus />} onClick={() => setForm({ date: anchor < today ? today : anchor, proId })}>Nova consulta</Button>
        </>} />
      <WaitlistDrawer open={waitOpen} onClose={() => { setWaitOpen(false); if (params.get('espera')) setParams({}, { replace: true }); }} />
      {pros.length > 0 && (
        <div className="pro-filter" role="group" aria-label="Profissional">
          <button type="button" className={cx('pro-chip', !proId && 'on')} onClick={() => setPro(null)}><Stethoscope />Todos</button>
          {pros.filter((p) => p.active || p.id === proId).map((p) => <button key={p.id} type="button" className={cx('pro-chip', proId === p.id && 'on')} style={{ ['--pro' as string]: p.color }} onClick={() => setPro(proId === p.id ? null : p.id)}><i />{p.name}</button>)}
          {pending > 0 && <span className="pro-pending" title="Consultas nas próximas 36 horas sem confirmação do paciente"><CalendarClock />{pending} sem confirmar</span>}
        </div>
      )}
      <div className="cal-toolbar">
        <IconButton label="Anterior" onClick={() => step(-1)}><ChevronLeft /></IconButton>
        <Button onClick={() => setAnchor(today)}>Hoje</Button>
        <IconButton label="Próximo" onClick={() => step(1)}><ChevronRight /></IconButton>
        <h2 className="cal-label">{label}</h2>
        <div className="legend only-desktop" style={{ marginLeft: 'auto' }}>
          <span><CheckCheck className="leg-ic" />Paciente confirmou</span>
          {(['pendente', 'concluido', 'faltou'] as AppointmentStatus[]).map((s) => <span key={s}><i className={`ev-swatch ${s}`} />{ST_LABEL[s]}</span>)}
        </div>
      </div>
      {view === 'dia' && (
        <div className="day-chips">{Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => <button key={d} className={cx('day-chip', d === anchor && 'on')} onClick={() => setAnchor(d)}><span>{WEEKDAYS_SHORT[weekdayOf(d)]}</span><b>{Number(d.slice(8))}</b></button>)}</div>
      )}

      {view === 'lista' ? (
        <section className="card">
          {appts.length === 0 ? <Empty icon={<CalendarDays />} title="Nenhum horário nos próximos 14 dias" /> : days.map((d) => {
            const list = appts.filter((a) => localDate(a.starts_at, tz) === d);
            if (!list.length) return null;
            return (
              <div key={d} className="agenda-day">
                <div className="agenda-day-h">{d === today ? 'Hoje' : fmtLong(d)[0].toUpperCase() + fmtLong(d).slice(1)}<span className="muted small"> · {list.length}</span></div>
                {list.map((a) => <ListRow key={a.id} a={a} c={cmap.get(a.contact_id ?? '')} pro={pmap.get(a.professional_id ?? '')} tz={tz} onOpen={() => setOpen(a)} />)}
              </div>
            );
          })}
        </section>
      ) : (
        <section className="card pad0 cal">
          <div className="cal-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
            <span />
            {days.map((d) => { const closed = !(hours[String(weekdayOf(d))] ?? []).length; return <div key={d} className={cx('cal-dh', d === today && 'today', closed && 'closed')}><span>{WEEKDAYS_SHORT[weekdayOf(d)]}</span><b>{Number(d.slice(8))}</b>{closed && <small>fechado</small>}</div>; })}
          </div>
          <div className="cal-body" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="cal-hours">{Array.from({ length: endH - startH }, (_, i) => <span key={i} style={{ height: HOUR_H }}>{String(startH + i).padStart(2, '0')}:00</span>)}</div>
            {days.map((d) => <DayColumn key={d} date={d} tz={tz} startH={startH} endH={endH} appts={appts.filter((a) => localDate(a.starts_at, tz) === d)} contacts={cmap} pros={pmap} isToday={d === today} closed={!(hours[String(weekdayOf(d))] ?? []).length}
              onPick={(time) => setForm({ date: d, time, proId })} onOpen={setOpen} />)}
          </div>
        </section>
      )}
      <AppointmentDetail appt={open} contact={open ? cmap.get(open.contact_id ?? '') : undefined} pro={open ? pmap.get(open.professional_id ?? '') : undefined} onClose={() => setOpen(null)} />
      <AppointmentForm init={form} onClose={closeForm} />
    </>
  );
}

function DayColumn({ tz, startH, endH, appts, contacts, pros, isToday, closed, onPick, onOpen }: { date: string; tz: string; startH: number; endH: number; appts: Appointment[]; contacts: Map<string, Contact>; pros: Map<string, Professional>; isToday: boolean; closed: boolean; onPick: (t: string) => void; onOpen: (a: Appointment) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  // colunas para horários que se sobrepõem
  const laid = useMemo(() => {
    const items = appts.map((a) => ({ a, s: Date.parse(a.starts_at), e: Date.parse(a.ends_at), col: 0, cols: 1 }));
    const active: typeof items = [];
    for (const it of items) {
      for (let i = active.length - 1; i >= 0; i--) if (active[i].e <= it.s) active.splice(i, 1);
      const used = new Set(active.map((x) => x.col));
      let c = 0; while (used.has(c)) c++;
      it.col = c; active.push(it);
      const n = Math.max(...active.map((x) => x.col)) + 1;
      for (const x of active) x.cols = Math.max(x.cols, n);
    }
    return items;
  }, [appts]);
  const pos = (iso: string) => { const p = localParts(iso, tz); return ((p.h + p.mi / 60) - startH) * HOUR_H; };
  const nowP = localParts(new Date(now), tz);
  return (
    <div className={cx('cal-col', isToday && 'today', closed && 'closed')} style={{ height: (endH - startH) * HOUR_H }}
      onClick={(e) => { if (e.target !== e.currentTarget) return; const y = e.nativeEvent.offsetY; const h = startH + Math.floor(y / HOUR_H); const half = (y % HOUR_H) > HOUR_H / 2 ? '30' : '00'; onPick(`${String(h).padStart(2, '0')}:${half}`); }}>
      {Array.from({ length: endH - startH }, (_, i) => <div key={i} className="cal-line" style={{ top: i * HOUR_H }} />)}
      {laid.map(({ a, col, cols }) => {
        const c = contacts.get(a.contact_id ?? '');
        const top = pos(a.starts_at), height = Math.max(26, pos(a.ends_at) - top - 3);
        return (
          <button key={a.id} className={cx('ev', a.status, pros.get(a.professional_id ?? '') && 'has-pro')} style={{ top, height, left: `calc(${(col / cols) * 100}% + 3px)`, width: `calc(${100 / cols}% - 6px)`, ['--pro' as string]: pros.get(a.professional_id ?? '')?.color }} onClick={() => onOpen(a)} title={`${localTime(a.starts_at, tz)} ${c?.name ?? ''} · ${a.title}${pros.get(a.professional_id ?? '') ? ` · ${pros.get(a.professional_id ?? '')!.name}` : ''}${a.patient_confirmed_at ? ' · paciente confirmou' : ''}`}>
            <b className="truncate">{a.patient_confirmed_at && <CheckCheck className="ev-ok" />}{c?.name ?? 'Paciente'}</b>
            {height > 40 && <span className="truncate">{localTime(a.starts_at, tz)} · {a.title}</span>}
            {a.created_via === 'ia_cliente' && height > 56 && <span className="ev-ai"><Bot />IA</span>}
          </button>
        );
      })}
      {isToday && nowP.h >= startH && nowP.h < endH && <div className="cal-now" style={{ top: (nowP.h + nowP.mi / 60 - startH) * HOUR_H }} />}
    </div>
  );
}

function ListRow({ a, c, pro, tz, onOpen }: { a: Appointment; c?: Contact; pro?: Professional; tz: string; onOpen: () => void }) {
  return (
    <button className="agenda-row" onClick={onOpen}>
      <span className="num tl-time">{localTime(a.starts_at, tz)}</span>
      <span className={cx('ev-swatch', a.status)} style={pro ? { background: pro.color } : undefined} />
      <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}><b className="truncate" style={{ display: 'block' }}>{c?.name ?? 'Paciente'}</b><span className="muted small truncate" style={{ display: 'block' }}>{a.title}{pro ? ` · ${pro.name}` : ''}{a.payment_kind === 'convenio' ? ` · ${a.insurance}` : ''}</span></span>
      {a.patient_confirmed_at && (a.status === 'confirmado' || a.status === 'pendente') ? <Badge tone="green" size="sm" icon={<CheckCheck />}>Confirmou</Badge> : <Badge tone={ST_TONE[a.status]} size="sm">{ST_LABEL[a.status]}</Badge>}
    </button>
  );
}

function AppointmentDetail({ appt, contact, pro, onClose }: { appt: Appointment | null; contact?: Contact; pro?: Professional; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const nav = useNavigate();
  const { me } = useMeCtx();
  if (!appt) return null;
  const setStatus = async (status: AppointmentStatus) => {
    await api.update('appointments', appt.id, { status });
    inv('appointments');
    toast(status === 'cancelado' ? 'Consulta desmarcada. O horário vai para quem está na lista de espera.' : `Consulta marcada como “${ST_LABEL[status].toLowerCase()}”`, 'ok', status === 'concluido' && appt.payment_kind !== 'convenio' ? { label: 'Registrar pagamento', run: () => nav(`/vendas?novo=1&cliente=${appt.contact_id ?? ''}&valor=${appt.price ?? ''}&agendamento=${appt.id}`) } : undefined);
    onClose();
  };
  const confirmByPatient = async () => { await api.update('appointments', appt.id, { patient_confirmed_at: new Date().toISOString() }); inv('appointments'); toast('Presença confirmada'); onClose(); };
  return (
    <Modal open onClose={onClose} title={contact?.name ?? 'Horário'} subtitle={`${fmtLong(appt.starts_at)} · ${localTime(appt.starts_at, me.company.timezone)}–${localTime(appt.ends_at, me.company.timezone)}`}
      footer={<>
        {appt.status !== 'cancelado' && <Button variant="danger-soft" icon={<XCircle />} onClick={() => setStatus('cancelado')}>Desmarcar</Button>}
        {appt.status === 'pendente' && <Button icon={<Check />} onClick={() => setStatus('confirmado')}>Aprovar</Button>}
        {appt.status !== 'concluido' && appt.status !== 'cancelado' && <Button variant="solid" icon={<Check />} onClick={() => setStatus('concluido')}>Atendido</Button>}
      </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Badge tone={ST_TONE[appt.status]} dot>{ST_LABEL[appt.status]}</Badge>
          {appt.patient_confirmed_at && appt.status !== 'cancelado' && <Badge tone="green" icon={<CheckCheck />}>Paciente confirmou presença</Badge>}
          {appt.created_via === 'ia_cliente' && <Badge tone="ai" icon={<Bot />}>Marcada pela IA no WhatsApp</Badge>}
        </div>
        <dl className="kv-list">
          <dt><Clock3 />Procedimento</dt><dd>{appt.title}{appt.price && appt.payment_kind !== 'convenio' ? ` · ${brl(appt.price)}` : ''}</dd>
          <dt><Stethoscope />Profissional</dt><dd>{pro ? <span className="row" style={{ gap: 6 }}><i className="pro-dot" style={{ background: pro.color }} />{pro.name}{pro.council ? <span className="muted small">· {pro.council}</span> : null}</span> : 'Sem profissional definido'}</dd>
          <dt><CreditCard />Pagamento</dt><dd>{appt.payment_kind === 'convenio' ? `Convênio ${appt.insurance ?? ''}${contact?.insurance_card ? ` · carteirinha ${contact.insurance_card}` : ''}` : 'Particular'}</dd>
          {contact?.phone && <><dt><Phone />WhatsApp</dt><dd>{formatPhone(contact.phone)}</dd></>}
          {contact?.guardian_name && <><dt>Responsável</dt><dd>{contact.guardian_name}</dd></>}
          {appt.notes && <><dt>Observações</dt><dd>{appt.notes}</dd></>}
          {appt.reminder_sent_at && <><dt>Lembrete</dt><dd>Enviado {fmtDate(appt.reminder_sent_at)}{appt.patient_confirmed_at ? ` · confirmou ${fmtDateTime(appt.patient_confirmed_at)}` : ' · ainda sem resposta'}</dd></>}
        </dl>
        <div className="row wrap" style={{ gap: 8 }}>
          {!appt.patient_confirmed_at && (appt.status === 'confirmado' || appt.status === 'pendente') && Date.parse(appt.starts_at) > Date.now() && <Button size="sm" icon={<BadgeCheck />} onClick={confirmByPatient}>Paciente confirmou</Button>}
          {appt.status !== 'faltou' && appt.status !== 'cancelado' && Date.parse(appt.starts_at) < Date.now() && <Button size="sm" icon={<UserX />} onClick={() => setStatus('faltou')}>Faltou</Button>}
          {appt.status === 'concluido' && appt.payment_kind !== 'convenio' && <Button size="sm" icon={<Wallet />} onClick={() => nav(`/vendas?novo=1&cliente=${appt.contact_id ?? ''}&valor=${appt.price ?? ''}&agendamento=${appt.id}`)}>Registrar pagamento</Button>}
          {contact && <Button size="sm" onClick={() => nav(`/clientes/${contact.id}`)}>Ficha do paciente</Button>}
        </div>
      </div>
    </Modal>
  );
}

function AppointmentForm({ init, onClose }: { init: { date: string; time?: string; contactId?: string | null; quoteId?: string | null; proId?: string | null } | null; onClose: () => void }) {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const inv = useInvalidate();
  const toast = useToast();
  const { data: services = [] } = useList('services', { filters: [{ col: 'active', op: 'eq', value: true }], order: [{ col: 'sort' }] });
  const [contact, setContact] = useState<Contact | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [date, setDate] = useState(todayLocal(tz));
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(me.company.slot_minutes);
  const [notes, setNotes] = useState('');
  const { data: pros = [] } = useList('professionals', { filters: [{ col: 'active', op: 'eq', value: true }], order: [{ col: 'sort' }] });
  const [proId, setProId] = useState<string>('');
  const [pay, setPay] = useState<string>(''); // '' = particular; senão, o nome do convênio
  const [price, setPrice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [anyTime, setAnyTime] = useState(false);
  useEffect(() => { if (init) { setDate(init.date); setTime(init.time ?? ''); setContactId(init.contactId ?? null); setService(null); setNotes(''); setPrice(0); setAnyTime(!!init.time); setDuration(me.company.slot_minutes); setProId(init.proId ?? ''); setPay(''); } }, [init, me.company.slot_minutes]);
  const eligible = pros.filter((p) => !service || !p.service_ids.length || p.service_ids.includes(service.id));
  const dayStart = fromLocal(date, '00:00', tz).toISOString(), dayEnd = fromLocal(addDays(date, 1), '00:00', tz).toISOString();
  const { data: dayAppts = [] } = useList('appointments', init ? { filters: [{ col: 'starts_at', op: 'gte', value: dayStart }, { col: 'starts_at', op: 'lt', value: dayEnd }] } : { limit: 0 }, { enabled: !!init });
  const slots = useMemo(() => slotsForDate(date, me.company, dayAppts, duration, new Date(), { professionals: pros, serviceId: service?.id ?? null, professionalId: proId || null }), [date, me.company, dayAppts, duration, pros, service, proId]);
  if (!init) return null;
  const save = async () => {
    if (!contactId) { toast('Escolha o paciente', 'err'); return; }
    if (!time) { toast('Escolha o horário', 'err'); return; }
    setBusy(true);
    try {
      const starts = fromLocal(date, time, tz);
      const chosen = proId || slots.find((x) => x.time === time)?.pros[0] || (pros.length === 1 ? pros[0].id : null);
      await api.insert('appointments', { contact_id: contactId, service_id: service?.id ?? null, title: service?.name ?? 'Consulta', starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + duration * 60000).toISOString(), status: 'confirmado', address: null, notes: notes || null, price: pay ? null : price || null, created_via: 'painel', reminder_sent_at: null, professional_id: chosen, payment_kind: pay ? 'convenio' : 'particular', insurance: pay || null });
      inv('appointments'); toast(`Consulta marcada${chosen ? ` com ${pros.find((p) => p.id === chosen)?.name}` : ''}`); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Nova consulta" subtitle="A agenda mostra só os horários livres do profissional, considerando a duração do procedimento." footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Marcar consulta</Button></>}>
      <div className="form-grid">
        <Field label="Paciente" className="full"><ContactPicker value={contactId} onChange={(c) => { setContactId(c?.id ?? null); setContact(c); if (c?.insurance && (me.company.insurances ?? []).includes(c.insurance)) setPay(c.insurance); }} /></Field>
        <Field label="Procedimento" className="full">
          <Select value={service?.id ?? ''} onChange={(e) => { const s = services.find((x) => x.id === e.target.value) ?? null; setService(s); if (s) { setDuration(s.duration_min); setPrice(s.price); } if (s && proId && !pros.find((p) => p.id === proId && (!p.service_ids.length || p.service_ids.includes(s.id)))) setProId(''); setTime(''); }}>
            <option value="">Consulta (sem procedimento da tabela)</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_min} min</option>)}
          </Select>
        </Field>
        {pros.length > 0 && <Field label="Profissional"><Select value={proId} onChange={(e) => { setProId(e.target.value); setTime(''); }}><option value="">Quem estiver livre</option>{eligible.map((p) => <option key={p.id} value={p.id}>{p.name}{p.specialty ? ` · ${p.specialty}` : ''}</option>)}</Select></Field>}
        <Field label="Pagamento"><Select value={pay} onChange={(e) => setPay(e.target.value)}><option value="">Particular</option>{(me.company.insurances ?? []).map((x) => <option key={x} value={x}>Convênio {x}</option>)}</Select></Field>
        <Field label="Dia"><Input type="date" value={date} min={todayLocal(tz)} onChange={(e) => { setDate(e.target.value); setTime(''); }} /></Field>
        <Field label="Duração (min)"><Input type="number" min={10} step={10} value={duration} onChange={(e) => setDuration(Math.max(10, Number(e.target.value)))} /></Field>
        <div className="field full">
          <label>Horário {!anyTime && <span className="muted">· {slots.length} livres</span>}</label>
          {anyTime ? <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /> : slots.length ? (
            <div className="slot-grid">{slots.map((s) => <button key={s.time} type="button" className={cx('slot', time === s.time && 'on')} onClick={() => setTime(s.time)}>{s.time}{!proId && pros.length > 1 && <small>{s.pros.length} {s.pros.length === 1 ? 'livre' : 'livres'}</small>}</button>)}</div>
          ) : <div className="muted small">Nenhum horário livre nesse dia{proId ? ' para esse profissional' : ''}.</div>}
          <button type="button" className="link small" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setAnyTime((v) => !v)}>{anyTime ? 'Mostrar só horários livres' : 'Marcar em outro horário (encaixe)'}</button>
        </div>
        {!pay && <Field label="Valor previsto"><MoneyInput value={price} onChange={setPrice} /></Field>}
        <Field label="Observações" className={pay ? 'full' : undefined}><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Administrativas (ex.: trazer exames)" /></Field>
      </div>
      {contact && <div className="row" style={{ marginTop: 14, gap: 8 }}><Avatar name={contact.name} size="sm" /><span className="muted small">O paciente recebe o lembrete e confirma presença pelo WhatsApp, se a automação estiver ligada.</span></div>}
    </Modal>
  );
}
