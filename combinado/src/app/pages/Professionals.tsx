// Profissionais da clínica: cada um tem a própria agenda, especialidade, registro no conselho,
// os procedimentos que faz, foto, meta de produção do mês e, se quiser, um horário diferente do da clínica.
// A IA marca com quem estiver livre.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CalendarDays, Camera, Clock, Pencil, Plus, Stethoscope, Target, Trash2, Trophy } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { BusinessHours, Professional } from '../data/types';
import { can, useMeCtx } from '../context';
import { Badge, Button, Empty, Field, IconButton, Input, Loader, Modal, MoneyInput, PageHeader, Switch, cx, useConfirm, useToast } from '../ui';
import { HoursEditor } from './Settings';
import { ProAvatar, shrinkPhoto } from '../ui/pro';
import { addDays, brl0, fromLocal, pct, todayLocal, WEEKDAYS } from '../../shared/format';

export const PRO_COLORS = ['#3D86F0', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#EF4444', '#64748B'];

function hoursSummary(h: BusinessHours | null): string {
  if (!h) return 'Horário da clínica';
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => (h[String(d)] ?? []).length);
  if (!days.length) return 'Sem horário definido';
  return days.map((d) => WEEKDAYS[d].slice(0, 3)).join(', ');
}

export default function Professionals() {
  const { me } = useMeCtx();
  const owner = can(me, 'dono', 'gerente');
  const tz = me.company.timezone;
  const { data = [], isLoading } = useList('professionals', { order: [{ col: 'sort' }, { col: 'name' }] });
  const { data: services = [] } = useList('services', { order: [{ col: 'sort' }] });
  const today = todayLocal(tz);
  const { data: week = [] } = useList('appointments', { filters: [{ col: 'starts_at', op: 'gte', value: fromLocal(today, '00:00', tz).toISOString() }, { col: 'starts_at', op: 'lt', value: fromLocal(addDays(today, 7), '00:00', tz).toISOString() }], limit: 2000 });
  const monthStart = today.slice(0, 8) + '01';
  const { data: monthAppts = [] } = useList('appointments', { filters: [{ col: 'starts_at', op: 'gte', value: fromLocal(monthStart, '00:00', tz).toISOString() }, { col: 'starts_at', op: 'lt', value: fromLocal(addDays(today, 1), '00:00', tz).toISOString() }], limit: 5000 });
  // produção do mês: consultas realizadas (concluídas), pelo valor da consulta ou do procedimento
  const prod = useMemo(() => {
    const price = new Map(services.map((s) => [s.id, s.price]));
    const m = new Map<string, { amount: number; done: number; missed: number }>();
    for (const a of monthAppts) {
      if (!a.professional_id) continue;
      const x = m.get(a.professional_id) ?? { amount: 0, done: 0, missed: 0 };
      if (a.status === 'concluido') { x.done++; x.amount += a.price ?? price.get(a.service_id ?? '') ?? 0; }
      if (a.status === 'faltou') x.missed++;
      m.set(a.professional_id, x);
    }
    return m;
  }, [monthAppts, services]);
  const ranking = useMemo(() => data.filter((p) => p.active).map((p) => ({ p, ...(prod.get(p.id) ?? { amount: 0, done: 0, missed: 0 }) })).sort((a, b) => b.amount - a.amount), [data, prod]);
  const monthLabel = new Date(fromLocal(monthStart, '12:00', tz)).toLocaleDateString('pt-BR', { month: 'long', timeZone: tz });
  const [edit, setEdit] = useState<Professional | 'new' | null>(null);
  const inv = useInvalidate();
  const toast = useToast();
  const load = useMemo(() => {
    const m = new Map<string, { today: number; week: number }>();
    for (const a of week) {
      if (!a.professional_id || a.status === 'cancelado') continue;
      const x = m.get(a.professional_id) ?? { today: 0, week: 0 };
      x.week++;
      if (a.starts_at < fromLocal(addDays(today, 1), '00:00', tz).toISOString()) x.today++;
      m.set(a.professional_id, x);
    }
    return m;
  }, [week, today, tz]);
  return (
    <>
      <PageHeader title="Profissionais" subtitle="Cada profissional tem a própria agenda. A IA marca com quem o paciente pedir ou com quem estiver livre para o procedimento."
        actions={owner ? <Button variant="solid" icon={<Plus />} onClick={() => setEdit('new')}>Novo profissional</Button> : undefined} />
      {isLoading ? <Loader /> : data.length === 0 ? (
        <Empty icon={<Stethoscope />} title="Nenhum profissional cadastrado" action={owner ? <Button variant="solid" icon={<Plus />} onClick={() => setEdit('new')}>Cadastrar profissional</Button> : undefined}>
          Sem profissionais, a agenda funciona como uma só (pela capacidade em Configurações → Clínica).
        </Empty>
      ) : (
        <>
        {ranking.length > 1 && ranking.some((r) => r.amount > 0) && (
          <section className="card pro-rank">
            <div className="card-head"><div><h3><Trophy />Produção de {monthLabel}</h3><div className="sub">Consultas realizadas até hoje, pelo valor de cada procedimento</div></div></div>
            <ol>
              {ranking.map((r, i) => {
                const goal = r.p.monthly_goal ?? 0;
                return (
                  <li key={r.p.id}>
                    <span className="rank-n">{i + 1}º</span>
                    <ProAvatar p={r.p} size={34} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}><b className="truncate">{r.p.name}</b><span className="muted small">{r.done} realizadas{r.missed ? ` · ${r.missed} faltas` : ''}</span></div>
                      {goal > 0 && <div className="goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, r.amount / goal) * 100)} aria-label={`Meta de ${r.p.name}`}><i style={{ width: `${Math.min(100, (r.amount / goal) * 100)}%`, background: r.p.color }} /></div>}
                    </div>
                    <div className="rank-val"><b className="num">{brl0(r.amount)}</b>{goal > 0 && <span className="muted small">{pct(r.amount / goal)} de {brl0(goal)}</span>}</div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
        <div className="pro-grid">
          {data.map((p) => {
            const l = load.get(p.id) ?? { today: 0, week: 0 };
            const svcNames = p.service_ids.length ? p.service_ids.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean) : [];
            return (
              <article key={p.id} className={cx('card pro-card', !p.active && 'off')} style={{ ['--pro' as string]: p.color }}>
                <div className="pro-top">
                  <ProAvatar p={p} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b className="truncate" style={{ display: 'block' }}>{p.name}</b>
                    <span className="muted small truncate" style={{ display: 'block' }}>{p.specialty || 'Sem especialidade'}</span>
                  </div>
                  {owner && <IconButton label="Editar" size="xs" onClick={() => setEdit(p)}><Pencil /></IconButton>}
                </div>
                <div className="pro-meta">
                  {p.council && <span><BadgeCheck />{p.council}</span>}
                  <span><Clock />{hoursSummary(p.business_hours)}</span>
                  {p.monthly_goal ? <span><Target />Meta {brl0(p.monthly_goal)}</span> : null}
                </div>
                <div className="pro-svcs">
                  {svcNames.length ? svcNames.slice(0, 4).map((n) => <Badge key={n} size="sm">{n}</Badge>) : <Badge size="sm" tone="blue">Todos os procedimentos</Badge>}
                  {svcNames.length > 4 && <Badge size="sm">+{svcNames.length - 4}</Badge>}
                </div>
                <div className="pro-foot">
                  <Link className="pro-stat" to={`/agenda?profissional=${p.id}`}><CalendarDays /><span><b className="num">{l.today}</b> hoje · <b className="num">{l.week}</b> em 7 dias</span></Link>
                  {owner && <Switch checked={p.active} label={p.active ? 'Desativar profissional' : 'Ativar profissional'} onChange={async (v) => { await api.update('professionals', p.id, { active: v }); inv('professionals'); toast(v ? 'Profissional ativo: a IA volta a marcar com ele' : 'Profissional desativado: a IA não marca mais com ele'); }} />}
                </div>
              </article>
            );
          })}
        </div>
        </>
      )}
      <ProfessionalForm open={!!edit} pro={edit === 'new' ? null : edit} count={data.length} onClose={() => setEdit(null)} />
    </>
  );
}

function ProfessionalForm({ open, pro, onClose, count }: { open: boolean; pro: Professional | null; onClose: () => void; count: number }) {
  const { me } = useMeCtx();
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: services = [] } = useList('services', { order: [{ col: 'sort' }] }, { enabled: open });
  const [f, setF] = useState<Partial<Professional>>({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) setF(pro ?? { name: '', specialty: '', council: '', color: PRO_COLORS[count % PRO_COLORS.length], service_ids: [], business_hours: null, active: true, photo_url: null, monthly_goal: null }); }, [open, pro, count]);
  const pickPhoto = async (file?: File | null) => {
    if (!file) return;
    setPhotoBusy(true);
    try { set('photo_url', await shrinkPhoto(file)); } catch (e) { toast((e as Error).message, 'err'); } finally { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const set = <K extends keyof Professional>(k: K, v: Professional[K]) => setF((x) => ({ ...x, [k]: v }));
  const ids = f.service_ids ?? [];
  const save = async () => {
    if ((f.name ?? '').trim().length < 2) { toast('Informe o nome do profissional', 'err'); return; }
    setBusy(true);
    const row = { name: f.name!.trim(), specialty: f.specialty?.trim() || null, council: f.council?.trim() || null, color: f.color ?? PRO_COLORS[0], service_ids: ids, business_hours: f.business_hours ?? null, active: f.active ?? true, photo_url: f.photo_url ?? null, monthly_goal: f.monthly_goal || null };
    try {
      if (pro) await api.update('professionals', pro.id, row); else await api.insert('professionals', { ...row, sort: count + 1 });
      inv('professionals'); toast(pro ? 'Profissional atualizado. A IA já usa a nova agenda.' : 'Profissional cadastrado'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="wide" title={pro ? 'Editar profissional' : 'Novo profissional'}
      footer={<>{pro && <Button variant="danger-soft" icon={<Trash2 />} onClick={async () => { if (await confirm({ title: `Excluir ${pro.name}?`, text: 'As consultas já marcadas ficam na agenda, sem profissional. Se só quer parar de marcar, desative.', confirm: 'Excluir', danger: true })) { await api.remove('professionals', pro.id); inv('professionals'); onClose(); } }}>Excluir</Button>}<span className="spacer" /><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="pro-photo">
        <button type="button" className="pro-photo-btn" onClick={() => fileRef.current?.click()} aria-label={f.photo_url ? 'Trocar foto' : 'Adicionar foto'} disabled={photoBusy}>
          <ProAvatar p={{ name: f.name || '?', color: f.color ?? PRO_COLORS[0], photo_url: f.photo_url }} size={84} />
          <span className="pro-photo-cam"><Camera /></span>
        </button>
        <div>
          <b>Foto do profissional</b>
          <p className="muted small" style={{ margin: '2px 0 10px' }}>Aparece no painel e na agenda. Use uma foto de rosto, de frente. Reduzimos o tamanho sozinhos.</p>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon={<Camera />} loading={photoBusy} onClick={() => fileRef.current?.click()}>{f.photo_url ? 'Trocar foto' : 'Escolher foto'}</Button>
            {f.photo_url && <Button size="sm" variant="ghost" onClick={() => set('photo_url', null)}>Remover</Button>}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pickPhoto(e.target.files?.[0])} />
        </div>
      </div>
      <div className="form-grid">
        <Field label="Nome" className="full"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Ex.: Dra. Marina Costa" /></Field>
        <Field label="Especialidade"><Input value={f.specialty ?? ''} onChange={(e) => set('specialty', e.target.value)} placeholder="Ex.: Ortodontia" /></Field>
        <Field label="Registro no conselho" hint="Aparece para os pacientes"><Input value={f.council ?? ''} onChange={(e) => set('council', e.target.value)} placeholder="Ex.: CRO-DF 1234" /></Field>
        <Field label="Meta de produção do mês" hint="Opcional. Soma das consultas realizadas."><MoneyInput value={f.monthly_goal ?? null} onChange={(v) => set('monthly_goal', v || null)} /></Field>
        <Field label="Cor na agenda" className="full">
          <div className="swatches">{PRO_COLORS.map((c) => <button key={c} type="button" className={cx('swatch', f.color === c && 'on')} style={{ background: c }} aria-label={`Cor ${c}`} onClick={() => set('color', c)} />)}</div>
        </Field>
      </div>
      <h4 className="form-sub">Procedimentos que atende</h4>
      <p className="muted small" style={{ marginTop: 0 }}>Nenhum marcado = atende todos. A IA só oferece este profissional para o que ele faz.</p>
      <div className="check-grid">
        {services.filter((s) => s.active).map((s) => (
          <label key={s.id} className="check small"><input type="checkbox" checked={ids.includes(s.id)} onChange={(e) => set('service_ids', e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} /><span>{s.name}</span></label>
        ))}
      </div>
      <h4 className="form-sub">Horário de atendimento</h4>
      <label className="check small"><input type="checkbox" checked={!!f.business_hours} onChange={(e) => set('business_hours', e.target.checked ? structuredClone(me.company.business_hours) : null)} /><span>Este profissional tem horário diferente do da clínica</span></label>
      {f.business_hours && <div style={{ marginTop: 12 }}><HoursEditor value={f.business_hours} onChange={(v) => set('business_hours', v)} /></div>}
    </Modal>
  );
}
