// Clientes: lista e funil (arraste entre as etapas), ficha completa e cadastro.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { Columns3, List, Plus, Search, UserPlus, Users, MessageCircle, FilePlus2, CalendarPlus, Trash2, Download, Phone } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Contact, ContactSource, Stage, Temperature } from '../data/types';
import { Avatar, Badge, Button, Drawer, Empty, Field, Input, Loader, Modal, PageHeader, PhoneInput, Segmented, Select, Textarea, cx, useConfirm, useDebounced, useToast } from '../ui';
import { ContactSide, STAGE_LABEL, TEMP_LABEL, TEMP_TONE } from './Inbox';
import { brl, brl0, fmtAgo, formatPhone, normalizePhone } from '../../shared/format';

const STAGES: Stage[] = ['novo', 'conversando', 'orcamento', 'fechado', 'perdido'];
const STAGE_COLOR: Record<Stage, string> = { novo: 'var(--violet)', conversando: 'var(--c1)', orcamento: 'var(--c2)', fechado: 'var(--c3)', perdido: 'var(--ink-4)' };
const SOURCE_LABEL: Record<ContactSource, string> = { whatsapp: 'WhatsApp', manual: 'Cadastro manual', indicacao: 'Indicação', instagram: 'Instagram', site: 'Site', outro: 'Outro' };

export default function Contacts() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'lista' | 'funil'>(() => (localStorage.getItem('combinado-clientes-view') as 'lista' | 'funil') || 'lista');
  const [q, setQ] = useState('');
  const term = useDebounced(q, 220);
  const [temp, setTemp] = useState<Temperature | 'todas'>((params.get('temperatura') as Temperature) || 'todas');
  const [stage, setStage] = useState<Stage | 'todas'>('todas');
  const [limit, setLimit] = useState(200);
  const [editing, setEditing] = useState<Contact | 'new' | null>(params.get('novo') ? 'new' : null);
  useEffect(() => { try { localStorage.setItem('combinado-clientes-view', view); } catch { /* ignora */ } }, [view]);

  const filters = [
    ...(temp !== 'todas' ? [{ col: 'temperature', op: 'eq' as const, value: temp }] : []),
    ...(stage !== 'todas' && view === 'lista' ? [{ col: 'stage', op: 'eq' as const, value: stage }] : []),
  ];
  const { data = [], isLoading } = useList('contacts', { filters, search: term.trim() ? { cols: ['name', 'phone', 'email', 'tags'], term } : undefined, order: [{ col: 'last_interaction_at', asc: false }], limit: view === 'funil' ? 400 : limit });
  const selected = id ? data.find((c) => c.id === id) : undefined;
  const { data: one } = useList('contacts', id && !selected ? { filters: [{ col: 'id', op: 'eq', value: id }] } : { limit: 0 }, { enabled: !!id && !selected });
  const current = selected ?? one?.[0];

  const exportCsv = () => {
    const rows = [['Nome', 'Telefone', 'E-mail', 'Etapa', 'Temperatura', 'Origem', 'Total comprado', 'Última interação'].join(';'), ...data.map((c) => [c.name, formatPhone(c.phone), c.email ?? '', STAGE_LABEL[c.stage], TEMP_LABEL[c.temperature], SOURCE_LABEL[c.source], c.total_spent.toFixed(2).replace('.', ','), c.last_interaction_at ?? ''].join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'clientes.csv'; a.click();
  };

  return (
    <>
      <PageHeader title="Clientes" subtitle="Todo mundo que falou com a sua empresa. A IA cadastra, classifica e move no funil sozinha."
        actions={<>
          <Segmented label="Modo de exibição" value={view} onChange={setView} options={[{ value: 'lista', label: 'Lista', icon: <List /> }, { value: 'funil', label: 'Funil', icon: <Columns3 /> }]} />
          <Button icon={<Download />} onClick={exportCsv} className="only-desktop">Exportar</Button>
          <Button variant="solid" icon={<UserPlus />} onClick={() => setEditing('new')}>Novo cliente</Button>
        </>} />
      <div className="filters">
        <div className="input-wrap" style={{ flex: '1 1 260px', maxWidth: 380 }}><Search /><input className="input" placeholder="Buscar por nome, telefone, e-mail ou etiqueta" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar clientes" /></div>
        <div className="row wrap" style={{ gap: 6 }}>
          {(['todas', 'quente', 'morno', 'frio'] as const).map((t) => <button key={t} className={cx('chip', temp === t && 'on')} onClick={() => setTemp(t)}>{t === 'todas' ? 'Todas as temperaturas' : `${TEMP_LABEL[t]}s`}</button>)}
        </div>
        {view === 'lista' && (
          <Select value={stage} onChange={(e) => setStage(e.target.value as Stage | 'todas')} style={{ width: 200 }} aria-label="Etapa">
            <option value="todas">Todas as etapas</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </Select>
        )}
      </div>

      {isLoading ? <Loader /> : view === 'lista' ? (
        <section className="card">
          {data.length === 0 ? <Empty icon={<Users />} title="Nenhum cliente encontrado" action={<Button variant="solid" icon={<Plus />} onClick={() => setEditing('new')}>Cadastrar cliente</Button>}>Quando alguém chamar no WhatsApp, a IA cadastra automaticamente.</Empty> : (
            <>
              <div className="table-wrap only-desktop">
                <table className="table">
                  <thead><tr><th>Cliente</th><th>Etapa</th><th>Lead</th><th>Origem</th><th>Última interação</th><th className="num">Já comprou</th></tr></thead>
                  <tbody>
                    {data.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/clientes/${c.id}`)}>
                        <td><div className="row"><Avatar name={c.name} size="sm" /><div style={{ minWidth: 0 }}><b className="truncate" style={{ display: 'block' }}>{c.name}</b><span className="muted small">{formatPhone(c.phone) || c.email || '—'}</span></div></div></td>
                        <td><span className="stage-pill"><i style={{ background: STAGE_COLOR[c.stage] }} />{STAGE_LABEL[c.stage]}</span></td>
                        <td><Badge tone={TEMP_TONE[c.temperature]} size="sm" dot>{TEMP_LABEL[c.temperature]}</Badge></td>
                        <td className="muted">{SOURCE_LABEL[c.source]}</td>
                        <td className="muted">{fmtAgo(c.last_interaction_at)}</td>
                        <td className="num"><b>{c.total_spent ? brl(c.total_spent) : '—'}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-list only-mobile">
                {data.map((c) => (
                  <Link key={c.id} to={`/clientes/${c.id}`} className="card-list-item">
                    <Avatar name={c.name} />
                    <div className="grow" style={{ minWidth: 0 }}><b className="truncate" style={{ display: 'block' }}>{c.name}</b><span className="muted small">{STAGE_LABEL[c.stage]} · {fmtAgo(c.last_interaction_at)}</span></div>
                    <Badge tone={TEMP_TONE[c.temperature]} size="sm" dot>{TEMP_LABEL[c.temperature]}</Badge>
                  </Link>
                ))}
              </div>
              {data.length >= limit && <div style={{ textAlign: 'center', marginTop: 14 }}><Button onClick={() => setLimit((l) => l + 200)}>Mostrar mais</Button></div>}
            </>
          )}
        </section>
      ) : <Board contacts={data} />}

      <Drawer open={!!id} onClose={() => nav('/clientes')} title="Ficha do cliente" wide actions={current ? <Button size="sm" onClick={() => setEditing(current)}>Editar</Button> : null}>
        {current ? <ContactDetail contact={current} onDeleted={() => nav('/clientes')} /> : <Loader />}
      </Drawer>
      <ContactForm open={!!editing} contact={editing === 'new' ? null : editing} onClose={() => { setEditing(null); if (params.get('novo')) { params.delete('novo'); setParams(params, { replace: true }); } }} />
    </>
  );
}

function Board({ contacts }: { contacts: Contact[] }) {
  const inv = useInvalidate();
  const toast = useToast();
  const nav = useNavigate();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const { data: openQuotes = [] } = useList('quotes', { filters: [{ col: 'status', op: 'eq', value: 'enviado' }], limit: 500 });
  const quoteSum = useMemo(() => { const m = new Map<string, number>(); for (const q of openQuotes) m.set(q.contact_id, (m.get(q.contact_id) ?? 0) + q.total); return m; }, [openQuotes]);
  const move = async (id: string, stage: Stage) => {
    const c = contacts.find((x) => x.id === id);
    if (!c || c.stage === stage) return;
    await api.update('contacts', id, { stage });
    inv('contacts');
    toast(`${c.name.split(' ')[0]} agora está em “${STAGE_LABEL[stage]}”`);
  };
  return (
    <div className="board-cols">
      {STAGES.map((s) => {
        const list = contacts.filter((c) => c.stage === s);
        const value = list.reduce((sum, c) => sum + (s === 'fechado' ? c.total_spent : quoteSum.get(c.id) ?? 0), 0);
        return (
          <section key={s} className={cx('board-col', over === s && 'over')} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain') || drag; if (id) void move(id, s); }}>
            <header><span className="dot" style={{ background: STAGE_COLOR[s] }} /><b>{STAGE_LABEL[s]}</b><span className="muted small">{list.length}</span>{value > 0 && <span className="muted small" style={{ marginLeft: 'auto' }}>{brl0(value)}</span>}</header>
            <div className="board-items">
              {list.slice(0, 60).map((c) => (
                <article key={c.id} className="board-card" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); setDrag(c.id); }} onDragEnd={() => setDrag(null)} onClick={() => nav(`/clientes/${c.id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/clientes/${c.id}`); }}>
                  <div className="row"><Avatar name={c.name} size="sm" /><b className="truncate grow">{c.name}</b><span className="dot" title={TEMP_LABEL[c.temperature]} style={{ background: c.temperature === 'quente' ? 'var(--orange)' : c.temperature === 'morno' ? 'var(--yellow)' : 'var(--blue)' }} /></div>
                  <div className="muted small" style={{ marginTop: 8 }}>{fmtAgo(c.last_interaction_at)}{quoteSum.get(c.id) ? ` · orçamento ${brl0(quoteSum.get(c.id)!)}` : c.total_spent ? ` · já comprou ${brl0(c.total_spent)}` : ''}</div>
                  {c.tags.length > 0 && <div className="tag-list" style={{ marginTop: 8 }}>{c.tags.slice(0, 3).map((t) => <Badge key={t} size="sm">{t}</Badge>)}</div>}
                  <Select className="board-move only-mobile" value={c.stage} onClick={(e) => e.stopPropagation()} onChange={(e) => void move(c.id, e.target.value as Stage)} aria-label="Mover para">{STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}</Select>
                </article>
              ))}
              {list.length > 60 && <div className="muted small" style={{ textAlign: 'center', padding: 8 }}>+ {list.length - 60} clientes</div>}
              {list.length === 0 && <div className="board-empty">Arraste um cliente para cá</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ContactDetail({ contact, onDeleted }: { contact: Contact; onDeleted: () => void }) {
  const nav = useNavigate();
  const confirm = useConfirm();
  const inv = useInvalidate();
  const toast = useToast();
  const { data: conv = [] } = useList('conversations', { filters: [{ col: 'contact_id', op: 'eq', value: contact.id }], limit: 1 });
  const { data: sales = [] } = useList('sales', { filters: [{ col: 'contact_id', op: 'eq', value: contact.id }], order: [{ col: 'paid_at', asc: false }], limit: 10 });
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {conv[0] && <Button size="sm" icon={<MessageCircle />} onClick={() => nav(`/conversas/${conv[0].id}`)}>Conversa</Button>}
        <Button size="sm" icon={<FilePlus2 />} onClick={() => nav(`/orcamentos/novo?cliente=${contact.id}`)}>Orçamento</Button>
        <Button size="sm" icon={<CalendarPlus />} onClick={() => nav(`/agenda?novo=1&cliente=${contact.id}`)}>Agendar</Button>
        {contact.phone && <a className="btn sm" href={`https://wa.me/${contact.phone}`} target="_blank" rel="noreferrer"><Phone />WhatsApp</a>}
      </div>
      <ContactSide contact={contact} inDrawer />
      <div>
        <div className="label" style={{ marginBottom: 8 }}>Compras</div>
        {sales.length === 0 ? <p className="muted small">Nenhuma compra registrada.</p> : <div className="mini-list">{sales.map((s) => <div key={s.id}><span className="truncate">{s.description}</span><b>{brl(s.amount)}</b></div>)}</div>}
      </div>
      <Button variant="danger-soft" icon={<Trash2 />} onClick={async () => {
        if (!(await confirm({ title: `Excluir ${contact.name}?`, text: 'O cadastro sai da lista. Orçamentos, vendas e conversas continuam guardados no histórico.', confirm: 'Excluir', danger: true }))) return;
        await api.remove('contacts', contact.id); inv('contacts'); toast('Cliente excluído'); onDeleted();
      }}>Excluir cliente</Button>
    </div>
  );
}

export function ContactForm({ open, contact, onClose }: { open: boolean; contact: Contact | null; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [f, setF] = useState<Partial<Contact>>({});
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(contact ?? { name: '', phone: '', email: '', address: '', notes: '', source: 'manual', opt_in: true, stage: 'novo', temperature: 'morno' }); setTags((contact?.tags ?? []).join(', ')); } }, [open, contact]);
  const set = (k: keyof Contact, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name || f.name.trim().length < 2) { toast('Informe o nome do cliente', 'err'); return; }
    setBusy(true);
    const row: Partial<Contact> = { name: f.name.trim(), phone: f.phone ? normalizePhone(f.phone) : null, email: f.email?.trim() || null, address: f.address?.trim() || null, notes: f.notes?.trim() || null, source: f.source, opt_in: !!f.opt_in, stage: f.stage, temperature: f.temperature, birthday: f.birthday || null, tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) };
    try {
      if (contact) await api.update('contacts', contact.id, row);
      else await api.insert('contacts', { ...row, score: 50, total_spent: 0, created_via: 'painel', last_interaction_at: new Date().toISOString() });
      inv('contacts'); toast(contact ? 'Cliente atualizado' : 'Cliente cadastrado'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={contact ? 'Editar cliente' : 'Novo cliente'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="form-grid">
        <Field label="Nome" className="full"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="WhatsApp"><PhoneInput value={f.phone ?? ''} onChange={(v) => set('phone', v)} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Endereço" className="full"><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Rua, número, bairro" /></Field>
        <Field label="Etapa"><Select value={f.stage} onChange={(e) => set('stage', e.target.value)}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select></Field>
        <Field label="Temperatura"><Select value={f.temperature} onChange={(e) => set('temperature', e.target.value)}>{(['quente', 'morno', 'frio'] as Temperature[]).map((t) => <option key={t} value={t}>{TEMP_LABEL[t]}</option>)}</Select></Field>
        <Field label="Origem"><Select value={f.source} onChange={(e) => set('source', e.target.value)}>{(Object.keys(SOURCE_LABEL) as ContactSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select></Field>
        <Field label="Aniversário"><Input type="date" value={f.birthday ?? ''} onChange={(e) => set('birthday', e.target.value)} /></Field>
        <Field label="Etiquetas" hint="Separe por vírgula. Ex.: sofá, condomínio, recorrente" className="full"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <Field label="Anotações" className="full"><Textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        <label className="check full"><input type="checkbox" checked={!!f.opt_in} onChange={(e) => set('opt_in', e.target.checked)} /><span>O cliente aceita receber mensagens da empresa (lembretes e novidades). <span className="muted">Pela LGPD, peça autorização antes de enviar promoções.</span></span></label>
      </div>
    </Modal>
  );
}
