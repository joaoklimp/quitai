// Busca rápida (Ctrl+K): páginas, clientes, orçamentos e ações.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, FilePlus2, Search, Sparkles, UserPlus, User, FileText, CornerDownLeft } from 'lucide-react';
import { PRIMARY, SECONDARY } from './Shell';
import { useAssistant } from '../context';
import { useList } from '../data/hooks';
import { useDebounced } from '../ui';
import { brl, fold, formatPhone } from '../../shared/format';

type Item = { id: string; group: string; label: string; meta?: string; icon: typeof Search; run: () => void };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const assistant = useAssistant();
  const term = useDebounced(q, 150);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: contacts = [] } = useList('contacts', term.trim().length >= 2 ? { search: { cols: ['name', 'phone', 'email'], term }, limit: 6, order: [{ col: 'last_interaction_at', asc: false }] } : { limit: 0 }, { enabled: open && term.trim().length >= 2 });
  const num = term.replace(/\D/g, '');
  const { data: quotes = [] } = useList('quotes', num.length >= 2 ? { filters: [{ col: 'number', op: 'eq', value: Number(num) }], limit: 3 } : { limit: 0 }, { enabled: open && num.length >= 2 && num.length <= 6 });

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const f = fold(term);
    const go = (to: string) => () => { onClose(); nav(to); };
    const actions: Item[] = [
      { id: 'a-ai', group: 'Ações', label: term ? `Pedir para a IA: “${term}”` : 'Falar com o assistente', icon: Sparkles, run: () => { onClose(); assistant.ask(term || undefined); } },
      { id: 'a-c', group: 'Ações', label: 'Novo cliente', icon: UserPlus, run: go('/clientes?novo=1') },
      { id: 'a-q', group: 'Ações', label: 'Novo orçamento', icon: FilePlus2, run: go('/orcamentos/novo') },
      { id: 'a-a', group: 'Ações', label: 'Novo agendamento', icon: CalendarPlus, run: go('/agenda?novo=1') },
    ];
    const pages: Item[] = [...PRIMARY, ...SECONDARY].map((p) => ({ id: 'p' + p.to, group: 'Páginas', label: p.label, icon: p.icon, run: go(p.to) }));
    const out: Item[] = [];
    out.push(...actions.filter((a) => !f || a.id === 'a-ai' || fold(a.label).includes(f)));
    out.push(...contacts.map((c) => ({ id: 'c' + c.id, group: 'Clientes', label: c.name, meta: formatPhone(c.phone), icon: User, run: go(`/clientes/${c.id}`) })));
    out.push(...quotes.map((x) => ({ id: 'q' + x.id, group: 'Orçamentos', label: `Orçamento nº ${String(x.number).padStart(4, '0')}`, meta: brl(x.total), icon: FileText, run: go(`/orcamentos/${x.id}`) })));
    out.push(...pages.filter((p) => !f || fold(p.label).includes(f)));
    return out;
  }, [term, contacts, quotes, nav, onClose, assistant]);

  useEffect(() => { setSel(0); }, [term]);
  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
    if (e.key === 'Escape') onClose();
  };
  let lastGroup = '';
  return createPortal(
    <div className="overlay" style={{ placeItems: 'start center', paddingTop: '12vh' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal cmdk" role="dialog" aria-label="Buscar">
        <div className="cmdk-input"><Search /><input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Busque clientes, orçamentos, páginas ou peça algo à IA" aria-label="Buscar" /></div>
        <div className="cmdk-list" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="cmdk-group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head}
                <button className="cmdk-item" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={it.run}>
                  <it.icon /><span className="truncate">{it.label}</span>{it.meta && <span className="meta">{it.meta}</span>}{i === sel && <CornerDownLeft style={{ marginLeft: it.meta ? 8 : 'auto', width: 14 }} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
