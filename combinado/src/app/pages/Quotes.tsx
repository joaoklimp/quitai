// Orçamentos: lista com totais por situação e editor com prévia, envio pelo WhatsApp e link de aprovação.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, CalendarPlus, Check, Copy, FilePlus2, FileText, Link2, Printer, Plus, Search, Send, Trash2, X, Wallet, Sparkles } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Quote, QuoteItem, QuoteStatus } from '../data/types';
import { useMeCtx } from '../context';
import { Avatar, Badge, Button, Empty, Field, IconButton, Input, Loader, MoneyInput, PageHeader, Select, Textarea, cx, useConfirm, useDebounced, useToast } from '../ui';
import { ContactPicker, ServiceSelect } from '../ui/pickers';
import { addDays, brl, brl0, fmtAgo, fmtDate, formatPhone, todayLocal } from '../../shared/format';

export const Q_LABEL: Record<QuoteStatus, string> = { rascunho: 'Rascunho', enviado: 'Enviado', aprovado: 'Aprovado', recusado: 'Recusado', expirado: 'Expirado' };
export const Q_TONE: Record<QuoteStatus, 'violet' | 'blue' | 'green' | 'red' | undefined> = { rascunho: undefined, enviado: 'blue', aprovado: 'green', recusado: 'red', expirado: undefined };
const qn = (n: number) => String(n).padStart(4, '0');

export default function Quotes() {
  const { id } = useParams();
  if (id) return <QuoteEditor id={id === 'novo' ? null : id} />;
  return <QuoteList />;
}

function QuoteList() {
  const nav = useNavigate();
  const [status, setStatus] = useState<QuoteStatus | 'todos'>('todos');
  const [q, setQ] = useState('');
  const term = useDebounced(q, 200);
  const { data: all = [], isLoading } = useList('quotes', { order: [{ col: 'created_at', asc: false }], limit: 600 });
  const ids = useMemo(() => [...new Set(all.map((x) => x.contact_id))], [all]);
  const { data: contacts = [] } = useList('contacts', ids.length ? { filters: [{ col: 'id', op: 'in', value: ids.slice(0, 600) }] } : { limit: 0 }, { enabled: ids.length > 0 });
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const list = all.filter((x) => (status === 'todos' || x.status === status) && (!term.trim() || String(x.number).includes(term.replace(/\D/g, '') || '¬') || (byId.get(x.contact_id)?.name ?? '').toLowerCase().includes(term.toLowerCase()) || (x.title ?? '').toLowerCase().includes(term.toLowerCase())));
  const month = todayLocal().slice(0, 7);
  const open = all.filter((x) => x.status === 'enviado');
  const approvedMonth = all.filter((x) => x.status === 'aprovado' && (x.responded_at ?? '').slice(0, 7) === month);
  const decided = all.filter((x) => x.status === 'aprovado' || x.status === 'recusado' || x.status === 'expirado');
  const rate = decided.length ? all.filter((x) => x.status === 'aprovado').length / decided.length : 0;
  const ticket = approvedMonth.length ? approvedMonth.reduce((s, x) => s + x.total, 0) / approvedMonth.length : 0;
  const count = (s: QuoteStatus) => all.filter((x) => x.status === s).length;
  return (
    <>
      <PageHeader title="Orçamentos" subtitle="A IA monta orçamentos com a sua tabela de preços. Você acompanha, ajusta e envia o link para o cliente aprovar."
        actions={<Button variant="solid" icon={<FilePlus2 />} onClick={() => nav('/orcamentos/novo')}>Novo orçamento</Button>} />
      <div className="stat-row">
        <div className="stat"><span>Em aberto</span><b>{brl0(open.reduce((s, x) => s + x.total, 0))}</b><small>{open.length} orçamentos aguardando o cliente</small></div>
        <div className="stat"><span>Aprovados no mês</span><b>{brl0(approvedMonth.reduce((s, x) => s + x.total, 0))}</b><small>{approvedMonth.length} aprovados</small></div>
        <div className="stat"><span>Taxa de aprovação</span><b>{Math.round(rate * 100)}%</b><small>dos orçamentos respondidos</small></div>
        <div className="stat"><span>Ticket médio</span><b>{brl0(ticket)}</b><small>nos aprovados do mês</small></div>
      </div>
      <div className="filters">
        <div className="input-wrap" style={{ flex: '1 1 240px', maxWidth: 360 }}><Search /><input className="input" placeholder="Buscar por número, cliente ou título" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar orçamentos" /></div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={cx('chip', status === 'todos' && 'on')} onClick={() => setStatus('todos')}>Todos {all.length}</button>
          {(Object.keys(Q_LABEL) as QuoteStatus[]).map((s) => <button key={s} className={cx('chip', status === s && 'on')} onClick={() => setStatus(s)}>{Q_LABEL[s]} {count(s)}</button>)}
        </div>
      </div>
      <section className="card">
        {isLoading ? <Loader /> : list.length === 0 ? <Empty icon={<FileText />} title="Nenhum orçamento aqui" action={<Button variant="solid" icon={<Plus />} onClick={() => nav('/orcamentos/novo')}>Criar orçamento</Button>}>Peça para a IA: “cria um orçamento de R$ 350 para a Maria”.</Empty> : (
          <>
            <div className="table-wrap only-desktop">
              <table className="table">
                <thead><tr><th>Nº</th><th>Cliente</th><th>Serviço</th><th>Situação</th><th>Feito por</th><th>Validade</th><th className="num">Valor</th></tr></thead>
                <tbody>{list.slice(0, 300).map((x) => {
                  const c = byId.get(x.contact_id);
                  const expired = x.status === 'enviado' && x.valid_until && x.valid_until < todayLocal();
                  return (
                    <tr key={x.id} className="clickable" onClick={() => nav(`/orcamentos/${x.id}`)}>
                      <td className="num" style={{ textAlign: 'left' }}><b>{qn(x.number)}</b></td>
                      <td><div className="row"><Avatar name={c?.name ?? '?'} size="sm" /><span className="truncate">{c?.name ?? '—'}</span></div></td>
                      <td className="muted truncate" style={{ maxWidth: 240 }}>{x.title ?? '—'}</td>
                      <td><Badge tone={Q_TONE[x.status]} size="sm" dot>{Q_LABEL[x.status]}</Badge>{expired && <Badge tone="yellow" size="sm">venceu</Badge>}</td>
                      <td className="muted">{x.created_via.startsWith('ia') ? <span className="row" style={{ gap: 4 }}><Bot style={{ width: 14 }} />IA</span> : 'Equipe'}</td>
                      <td className="muted">{fmtDate(x.valid_until)}</td>
                      <td className="num"><b>{brl(x.total)}</b></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="card-list only-mobile">
              {list.slice(0, 150).map((x) => (
                <Link key={x.id} to={`/orcamentos/${x.id}`} className="card-list-item">
                  <div className="grow" style={{ minWidth: 0 }}><b>nº {qn(x.number)} · {byId.get(x.contact_id)?.name ?? '—'}</b><div className="muted small truncate">{x.title}</div></div>
                  <div style={{ textAlign: 'right' }}><b>{brl0(x.total)}</b><div><Badge tone={Q_TONE[x.status]} size="sm">{Q_LABEL[x.status]}</Badge></div></div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

type Line = { key: string; service_id: string | null; description: string; qty: number; unit_price: number };
let lineSeq = 0;
const newLine = (p: Partial<Line> = {}): Line => ({ key: `l${++lineSeq}`, service_id: null, description: '', qty: 1, unit_price: 0, ...p });

function QuoteEditor({ id }: { id: string | null }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { me } = useMeCtx();
  const toast = useToast();
  const confirm = useConfirm();
  const inv = useInvalidate();
  const { data: quote, isLoading } = useQuery({ queryKey: ['quote', id], queryFn: () => (id ? api.getQuote(id) : Promise.resolve(null)), enabled: !!id });
  const [contactId, setContactId] = useState<string | null>(params.get('cliente'));
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [discount, setDiscount] = useState(0);
  const [validUntil, setValidUntil] = useState(addDays(todayLocal(), 7));
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<QuoteStatus>('rascunho');
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { data: contactRows } = useList('contacts', contactId ? { filters: [{ col: 'id', op: 'eq', value: contactId }] } : { limit: 0 }, { enabled: !!contactId });
  const contact = contactRows?.[0];

  useEffect(() => {
    if (!quote) return;
    setContactId(quote.contact_id); setTitle(quote.title ?? ''); setDiscount(quote.discount); setValidUntil(quote.valid_until ?? addDays(todayLocal(), 7)); setNotes(quote.notes ?? ''); setStatus(quote.status);
    setLines((quote.items ?? []).map((i: QuoteItem) => newLine({ service_id: i.service_id, description: i.description, qty: i.qty, unit_price: i.unit_price })));
    setDirty(false);
  }, [quote]);

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const total = Math.max(0, subtotal - discount);
  const touch = () => setDirty(true);
  const setLine = (k: string, patch: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l))); touch(); };

  const save = async (extra: Partial<Quote> = {}): Promise<Quote | null> => {
    if (!contactId) { toast('Escolha o cliente do orçamento', 'err'); return null; }
    const items = lines.filter((l) => l.description.trim() || l.unit_price > 0);
    if (!items.length) { toast('Adicione pelo menos um item', 'err'); return null; }
    const saved = await api.saveQuote({ id: quote?.id, contact_id: contactId, title: title.trim() || items[0].description, discount, valid_until: validUntil, notes: notes.trim() || null, status, ...extra }, items.map((l) => ({ service_id: l.service_id, description: l.description.trim() || 'Item', qty: l.qty, unit_price: l.unit_price })));
    inv('quotes', 'contacts'); setDirty(false);
    return saved;
  };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); } };
  const link = (q: Pick<Quote, 'public_token'>) => `${location.origin}/orcamento/#${q.public_token}`;

  if (id && isLoading) return <Loader />;
  if (id && !quote) return <Empty title="Orçamento não encontrado" action={<Button onClick={() => nav('/orcamentos')}>Voltar</Button>} />;

  return (
    <>
      <div className="editor-head">
        <IconButton label="Voltar" onClick={() => nav('/orcamentos')}><ArrowLeft /></IconButton>
        <div className="grow">
          <h1>{quote ? `Orçamento nº ${qn(quote.number)}` : 'Novo orçamento'}</h1>
          <p className="muted">{quote ? <>{quote.created_via.startsWith('ia') ? <><Sparkles className="ii" /> Criado pela IA</> : 'Criado pela equipe'} · {fmtAgo(quote.created_at)}{quote.sent_at ? ` · enviado ${fmtAgo(quote.sent_at)}` : ''}</> : 'Monte os itens, confira a prévia e envie para o cliente aprovar pelo link.'}</p>
        </div>
        {quote && <Badge tone={Q_TONE[status]} dot>{Q_LABEL[status]}</Badge>}
      </div>
      <div className="editor">
        <section className="card">
          <div className="form-grid">
            <Field label="Cliente" className="full"><ContactPicker value={contactId} onChange={(c) => { setContactId(c?.id ?? null); touch(); }} autoFocus={!id && !contactId} /></Field>
            <Field label="Título" className="full"><Input value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} placeholder="Ex.: Limpeza de sofá e colchão" /></Field>
          </div>
          <div className="label" style={{ margin: '20px 0 8px' }}>Itens</div>
          <div className="lines">
            <div className="line head"><span>Descrição</span><span>Qtd.</span><span>Valor unit.</span><span className="num">Total</span><span /></div>
            {lines.map((l) => (
              <div key={l.key} className="line">
                <Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Serviço ou produto" aria-label="Descrição" />
                <Input type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(l.key, { qty: Math.max(0, Number(e.target.value)) })} aria-label="Quantidade" className="num" />
                <MoneyInput value={l.unit_price} onChange={(v) => setLine(l.key, { unit_price: v })} />
                <b className="num line-total">{brl(l.qty * l.unit_price)}</b>
                <IconButton label="Remover item" size="xs" onClick={() => { setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()])); touch(); }}><X /></IconButton>
              </div>
            ))}
          </div>
          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <ServiceSelect className="grow" onPick={(s) => { setLines((ls) => [...ls.filter((x) => x.description.trim() || x.unit_price), newLine({ service_id: s.id, description: s.name, unit_price: s.price })]); if (!title) setTitle(s.name); touch(); }} />
            <Button icon={<Plus />} onClick={() => { setLines((ls) => [...ls, newLine()]); touch(); }}>Item avulso</Button>
          </div>
          <div className="form-grid" style={{ marginTop: 20 }}>
            <Field label="Desconto" hint={subtotal ? `${((discount / subtotal) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do subtotal` : undefined}><MoneyInput value={discount} onChange={(v) => { setDiscount(Math.min(v, subtotal)); touch(); }} /></Field>
            <Field label="Válido até"><Input type="date" value={validUntil} onChange={(e) => { setValidUntil(e.target.value); touch(); }} /></Field>
            <Field label="Situação"><Select value={status} onChange={(e) => { setStatus(e.target.value as QuoteStatus); touch(); }}>{(Object.keys(Q_LABEL) as QuoteStatus[]).map((s) => <option key={s} value={s}>{Q_LABEL[s]}</option>)}</Select></Field>
            <Field label="Observações para o cliente" className="full"><Textarea value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="Ex.: Pagamento no Pix com 5% de desconto. Secagem de 4 a 8 horas." /></Field>
          </div>
        </section>

        <aside className="col" style={{ gap: 16 }}>
          <section className="card quote-preview" id="quote-print">
            <div className="qp-head"><div><div className="qp-company">{me.company.name}</div><div className="muted small">{formatPhone(me.company.phone)}{me.company.city ? ` · ${me.company.city}` : ''}</div></div><div className="qp-num">nº {quote ? qn(quote.number) : '—'}</div></div>
            <div className="qp-to"><span className="muted small">Para</span><b>{contact?.name ?? 'Escolha o cliente'}</b></div>
            <div className="qp-items">
              {lines.filter((l) => l.description || l.unit_price).map((l) => <div key={l.key} className="qp-item"><span>{l.description || 'Item'}{l.qty !== 1 ? ` × ${l.qty.toLocaleString('pt-BR')}` : ''}</span><b>{brl(l.qty * l.unit_price)}</b></div>)}
            </div>
            <div className="qp-sum"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
            {discount > 0 && <div className="qp-sum"><span>Desconto</span><span>− {brl(discount)}</span></div>}
            <div className="qp-total"><span>Total</span><b>{brl(total)}</b></div>
            <div className="muted small">Válido até {fmtDate(validUntil)}</div>
            {notes && <p className="qp-notes">{notes}</p>}
          </section>
          <section className="card tight col" style={{ gap: 8 }}>
            <Button variant="solid" block loading={busy === 'save'} icon={<Check />} onClick={() => run('save', async () => { const s = await save(); if (s) { toast('Orçamento salvo'); if (!id) nav(`/orcamentos/${s.id}`, { replace: true }); } })}>{dirty || !id ? 'Salvar' : 'Salvo'}</Button>
            <Button block loading={busy === 'send'} icon={<Send />} disabled={!contact?.phone && !!contact} onClick={() => run('send', async () => {
              const s = await save(); if (!s) return;
              const r = await api.sendQuote(s.id);
              setStatus(s.status === 'rascunho' ? 'enviado' : s.status); inv('quotes', 'messages', 'conversations');
              toast(r.sent ? 'Orçamento enviado no WhatsApp do cliente' : r.reason ?? 'Link pronto. Copie e envie para o cliente.');
              if (!id) nav(`/orcamentos/${s.id}`, { replace: true });
            })}>Enviar pelo WhatsApp</Button>
            {quote && <Button block icon={<Copy />} onClick={async () => { await navigator.clipboard.writeText(link(quote)); toast('Link do orçamento copiado'); }}>Copiar link de aprovação</Button>}
            {quote && <a className="btn block" href={link(quote)} target="_blank" rel="noreferrer"><Link2 />Ver como o cliente</a>}
            <Button block icon={<Printer />} onClick={() => window.print()}>Imprimir ou salvar PDF</Button>
            {quote && status === 'aprovado' && (
              <div className="callout ok" style={{ marginTop: 6 }}><Check /><div><strong>Aprovado!</strong> Próximos passos:<div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                <Button size="sm" icon={<CalendarPlus />} onClick={() => nav(`/agenda?novo=1&cliente=${quote.contact_id}&orcamento=${quote.id}`)}>Agendar serviço</Button>
                <Button size="sm" icon={<Wallet />} onClick={() => nav(`/vendas?novo=1&cliente=${quote.contact_id}&valor=${quote.total}&orcamento=${quote.id}`)}>Registrar venda</Button>
              </div></div></div>
            )}
            {quote && <Button block variant="danger-soft" icon={<Trash2 />} onClick={async () => { if (await confirm({ title: `Excluir o orçamento nº ${qn(quote.number)}?`, text: 'Esta ação não pode ser desfeita.', confirm: 'Excluir', danger: true })) { await api.remove('quotes', quote.id); inv('quotes'); toast('Orçamento excluído'); nav('/orcamentos'); } }}>Excluir</Button>}
          </section>
        </aside>
      </div>
    </>
  );
}
