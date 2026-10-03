// Lista de espera: quem quer um horário que não estava livre. Se alguém cancelar, a ORBYTA oferece o encaixe pelo WhatsApp.
import { useEffect, useState } from 'react';
import { Bot, CalendarClock, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../data/api';
import { useInvalidate, useList } from '../../data/hooks';
import type { WaitlistEntry } from '../../data/types';
import { can, useMeCtx } from '../../context';
import { Avatar, Badge, Button, Drawer, Empty, Field, Input, Select, useConfirm, useToast } from '../../ui';
import { ContactPicker } from '../../ui/pickers';
import { fmtAgo, fmtDate, localTime, todayLocal } from '../../../shared/format';

const PERIOD: Record<WaitlistEntry['period'], string> = { qualquer: 'Qualquer horário', manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };

export function useWaitlistCount() {
  const { data = [] } = useList('waitlist', { filters: [{ col: 'status', op: 'in', value: ['aguardando', 'oferecido'] }], limit: 200 });
  return data.length;
}

export function WaitlistDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const { data: list = [] } = useList('waitlist', { filters: [{ col: 'status', op: 'in', value: ['aguardando', 'oferecido', 'agendado'] }], order: [{ col: 'created_at', asc: true }], limit: 200 }, { enabled: open });
  const ids = [...new Set(list.map((w) => w.contact_id))];
  const { data: contacts = [] } = useList('contacts', ids.length ? { filters: [{ col: 'id', op: 'in', value: ids }] } : { limit: 0 }, { enabled: open && ids.length > 0 });
  const { data: services = [] } = useList('services', { order: [{ col: 'sort', asc: true }] }, { enabled: open });
  const cmap = new Map(contacts.map((c) => [c.id, c]));
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ contact: null as string | null, date: '', period: 'qualquer' as WaitlistEntry['period'], service: '', notes: '' });
  useEffect(() => { if (open) setAdding(false); }, [open]);
  const open_ = list.filter((w) => w.status !== 'agendado');
  const done = list.filter((w) => w.status === 'agendado').slice(-5).reverse();

  const add = async () => {
    if (!f.contact) { toast('Escolha o paciente', 'err'); return; }
    try {
      await api.insert('waitlist', { contact_id: f.contact, desired_date: f.date || null, period: f.period, service_id: f.service || null, notes: f.notes.trim() || null });
      inv('waitlist'); toast('Paciente na lista de espera. Avisamos quando abrir um horário.');
      setAdding(false); setF({ contact: null, date: '', period: 'qualquer', service: '', notes: '' });
    } catch (e) { toast(/one_open|duplicate/i.test((e as Error).message) ? 'Esse paciente já está na lista.' : (e as Error).message, 'err'); }
  };
  const remove = async (w: WaitlistEntry) => {
    if (!(await confirm({ title: 'Tirar da lista de espera?', text: cmap.get(w.contact_id)?.name ?? '', confirm: 'Tirar da lista' }))) return;
    try { await api.update('waitlist', w.id, { status: 'cancelado' }); inv('waitlist'); } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Lista de espera"
      actions={!adding ? <Button size="sm" variant="solid" icon={<Plus />} onClick={() => setAdding(true)}>Adicionar</Button> : undefined}>
      <p className="muted small" style={{ marginTop: 0 }}>Quando alguém cancela, a ORBYTA oferece o horário pelo WhatsApp para quem combina com o dia e o período, na ordem da lista. A IA também coloca pacientes aqui quando não há horário que sirva.</p>
      {adding && (
        <div className="card wl-form">
          <div className="row between"><b>Adicionar à lista</b><button className="icon-btn xs" aria-label="Fechar" onClick={() => setAdding(false)}><X /></button></div>
          <Field label="Paciente"><ContactPicker value={f.contact} onChange={(c) => setF({ ...f, contact: c?.id ?? null })} /></Field>
          <div className="form-grid">
            <Field label="Dia desejado" hint="Vazio = o primeiro que abrir"><Input type="date" min={todayLocal(tz)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Período"><Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as WaitlistEntry['period'] })}>{(Object.keys(PERIOD) as WaitlistEntry['period'][]).map((p) => <option key={p} value={p}>{PERIOD[p]}</option>)}</Select></Field>
          </div>
          <Field label="Serviço (opcional)"><Select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">Qualquer serviço</option>{services.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Observação (opcional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ex.: só depois das 14h" /></Field>
          <Button variant="solid" block onClick={add}>Colocar na lista</Button>
        </div>
      )}
      {open_.length === 0 && !adding ? <Empty icon={<CalendarClock />} title="Ninguém esperando">Quando não houver horário para alguém, coloque o paciente aqui (ou deixe a IA fazer isso na conversa).</Empty> : (
        <ul className="wl-list">
          {open_.map((w, i) => {
            const c = cmap.get(w.contact_id);
            return (
              <li key={w.id}>
                <span className="wl-pos">{i + 1}</span>
                <Avatar name={c?.name ?? '?'} size="sm" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="truncate" style={{ display: 'block' }}>{c?.name ?? 'Paciente'}</b>
                  <span className="muted small">{w.desired_date ? fmtDate(w.desired_date).slice(0, 5) : 'Qualquer dia'} · {PERIOD[w.period]}{w.service_id ? ` · ${services.find((s) => s.id === w.service_id)?.name ?? ''}` : ''}</span>
                  {w.notes && <span className="tiny muted" style={{ display: 'block' }}>{w.notes}</span>}
                  <span className="tiny muted" style={{ display: 'block' }}>{w.created_via === 'ia_cliente' ? <><Bot style={{ width: 12, verticalAlign: -2 }} /> Pela IA · </> : null}entrou {fmtAgo(w.created_at)}</span>
                </div>
                {w.status === 'oferecido' && w.offered_starts_at ? <Badge size="sm" tone="orange" title="Aguardando a resposta do paciente">Encaixe oferecido · {fmtDate(w.offered_starts_at, tz).slice(0, 5)} {localTime(w.offered_starts_at, tz)}</Badge> : <Badge size="sm">Aguardando</Badge>}
                {can(me, 'dono', 'gerente') && <button className="icon-btn xs" aria-label="Tirar da lista" onClick={() => void remove(w)}><Trash2 /></button>}
              </li>
            );
          })}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <h4 className="wl-sub">Encaixes que deram certo</h4>
          <ul className="wl-list done">{done.map((w) => <li key={w.id}><Avatar name={cmap.get(w.contact_id)?.name ?? '?'} size="sm" /><span className="grow">{cmap.get(w.contact_id)?.name ?? 'Paciente'}</span><Badge size="sm" tone="green">Agendado</Badge></li>)}</ul>
        </>
      )}
    </Drawer>
  );
}
