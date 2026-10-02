// Seletores reutilizados: cliente (com cadastro rápido) e serviço do catálogo.
import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Contact, Service } from '../data/types';
import { Avatar, Button, Field, Input, Modal, PhoneInput, cx, useClickOutside, useDebounced, useToast } from './index';
import { brl, formatPhone, normalizePhone } from '../../shared/format';

export function ContactPicker({ value, onChange, autoFocus }: { value: string | null; onChange: (c: Contact | null) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const term = useDebounced(q, 180);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const { data: selected } = useList('contacts', value ? { filters: [{ col: 'id', op: 'eq', value }] } : { limit: 0 }, { enabled: !!value });
  const { data: results = [] } = useList('contacts', { search: term.trim() ? { cols: ['name', 'phone', 'email'], term } : undefined, order: [{ col: 'last_interaction_at', asc: false }], limit: 8 }, { enabled: open });
  const cur = selected?.[0];
  if (cur && value) {
    return (
      <div className="picked">
        <Avatar name={cur.name} size="sm" />
        <div className="grow"><b className="truncate" style={{ display: 'block' }}>{cur.name}</b><span className="muted small">{formatPhone(cur.phone) || cur.email || 'sem contato'}</span></div>
        <button type="button" className="icon-btn xs" aria-label="Trocar cliente" onClick={() => onChange(null)}><X /></button>
      </div>
    );
  }
  return (
    <div className="picker" ref={ref}>
      <div className="input-wrap"><Search /><input className="input" value={q} autoFocus={autoFocus} placeholder="Buscar cliente por nome ou telefone" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} aria-label="Buscar cliente" /></div>
      {open && (
        <div className="picker-pop">
          {results.map((c) => (
            <button type="button" key={c.id} className="picker-opt" onClick={() => { onChange(c); setOpen(false); setQ(''); }}>
              <Avatar name={c.name} size="sm" /><span className="grow truncate">{c.name}</span><span className="muted small">{formatPhone(c.phone)}</span>
            </button>
          ))}
          {results.length === 0 && <div className="muted small" style={{ padding: 10 }}>Nenhum cliente encontrado.</div>}
          <button type="button" className="picker-opt new" onClick={() => { setCreating(true); setOpen(false); }}><UserPlus />Cadastrar {q.trim() ? `“${q.trim()}”` : 'novo cliente'}</button>
        </div>
      )}
      <QuickContact open={creating} initialName={q} onClose={() => setCreating(false)} onCreated={(c) => { onChange(c); setQ(''); }} />
    </div>
  );
}

export function QuickContact({ open, onClose, onCreated, initialName = '' }: { open: boolean; onClose: () => void; onCreated: (c: Contact) => void; initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  useEffect(() => { if (open) { setName(initialName); setPhone(''); } }, [open, initialName]);
  const save = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      const c = await api.insert('contacts', { name: name.trim(), phone: phone ? normalizePhone(phone) : null, tags: [], stage: 'novo', temperature: 'morno', score: 50, source: 'manual', opt_in: true, total_spent: 0, created_via: 'painel', last_interaction_at: new Date().toISOString() });
      inv('contacts'); toast('Cliente cadastrado'); onCreated(c); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Cadastro rápido" size="narrow" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Cadastrar</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="WhatsApp" hint="Com DDD. A IA usa esse número para falar com o cliente."><PhoneInput value={phone} onChange={setPhone} /></Field>
      </div>
    </Modal>
  );
}

export function ServiceSelect({ onPick, className }: { onPick: (s: Service) => void; className?: string }) {
  const { data = [] } = useList('services', { filters: [{ col: 'active', op: 'eq', value: true }], order: [{ col: 'sort' }] });
  return (
    <select className={cx('select', className)} value="" onChange={(e) => { const s = data.find((x) => x.id === e.target.value); if (s) onPick(s); }} aria-label="Adicionar serviço do catálogo">
      <option value="">+ Adicionar serviço do catálogo</option>
      {data.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.price_type === 'sob_consulta' ? 'sob consulta' : `${s.price_type === 'a_partir_de' ? 'a partir de ' : ''}${brl(s.price)}`}</option>)}
    </select>
  );
}
