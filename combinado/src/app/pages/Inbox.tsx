// Conversas: caixa de entrada do WhatsApp com a IA atendendo e a equipe assumindo quando precisa.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Bot, CalendarPlus, CheckCircle2, Clock3, FilePlus2, Hand, Info, MessageCircle, MoreVertical, Phone, Search, Send, Smartphone, Sparkles, UserRound, Wand2, AlertTriangle, Undo2,
} from 'lucide-react';
import { api, isDemo } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Contact, Conversation, Stage, Temperature } from '../data/types';
import { Avatar, Badge, Button, Drawer, Empty, IconButton, Loader, Menu, Select, Segmented, cx, useDebounced, useFillHeight, useToast } from '../ui';
import { Thread } from '../ui/chat';
import { brl, fmtDate, fmtListTime, fold, formatPhone } from '../../shared/format';

type Filter = 'todas' | 'equipe' | 'ia' | 'nao_lidas';
export const STAGE_LABEL: Record<Stage, string> = { novo: 'Novo contato', conversando: 'Em conversa', orcamento: 'Orçamento enviado', fechado: 'Paciente', perdido: 'Não seguiu' };
export const TEMP_LABEL: Record<Temperature, string> = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };
export const TEMP_TONE: Record<Temperature, 'orange' | 'yellow' | 'blue'> = { quente: 'orange', morno: 'yellow', frio: 'blue' };

export default function Inbox() {
  const { id } = useParams();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('todas');
  const [q, setQ] = useState('');
  const term = useDebounced(q, 200);
  const { data: convs = [], isLoading } = useList('conversations', { filters: [{ col: 'kind', op: 'eq', value: 'cliente' }], order: [{ col: 'last_message_at', asc: false }], limit: 300 });
  const ids = useMemo(() => [...new Set(convs.map((c) => c.contact_id).filter(Boolean) as string[])], [convs]);
  const { data: contacts = [] } = useList('contacts', ids.length ? { filters: [{ col: 'id', op: 'in', value: ids }] } : { limit: 0 }, { enabled: ids.length > 0 });
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const list = useMemo(() => convs.filter((c) => {
    if (filter === 'equipe' && !(c.handler === 'humano' || c.needs_attention)) return false;
    if (filter === 'ia' && c.handler !== 'ia') return false;
    if (filter === 'nao_lidas' && !c.unread) return false;
    if (term.trim()) { const ct = byId.get(c.contact_id ?? ''); const t = fold(term); if (!fold(ct?.name).includes(t) && !(ct?.phone ?? '').includes(term.replace(/\D/g, '') || '¬')) return false; }
    return true;
  }), [convs, filter, term, byId]);
  const counts = { equipe: convs.filter((c) => c.handler === 'humano' || c.needs_attention).length, nao_lidas: convs.filter((c) => c.unread > 0).length };

  const current = convs.find((c) => c.id === id) ?? null;
  const boxRef = useFillHeight<HTMLElement>();
  useEffect(() => { if (!id && list.length && window.innerWidth > 860) nav(`/conversas/${list[0].id}`, { replace: true }); }, [id, list, nav]);

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div className="page-head-text"><h1>Conversas</h1><p>A IA responde no WhatsApp. Quando precisar de você, a conversa sobe com um aviso laranja.</p></div>
        <div className="page-head-actions"><Link to="/simulador" className="btn"><Smartphone />Testar como paciente</Link></div>
      </div>
      <section ref={boxRef} className={cx('card inbox', current && 'has-chat')}>
        <aside className="ib-list">
          <div className="ib-list-head">
            <div className="input-wrap"><Search /><input className="input" placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar conversas" /></div>
            <Segmented label="Filtrar conversas" value={filter} onChange={setFilter} options={[
              { value: 'todas', label: 'Todas' },
              { value: 'equipe', label: <>Equipe{counts.equipe ? <b style={{ color: 'var(--orange-ink)' }}> {counts.equipe}</b> : null}</> },
              { value: 'ia', label: 'IA' },
              { value: 'nao_lidas', label: <>Não lidas{counts.nao_lidas ? <b> {counts.nao_lidas}</b> : null}</> },
            ]} />
          </div>
          <div className="ib-items" role="list">
            {isLoading && <Loader />}
            {!isLoading && list.length === 0 && <Empty icon={<MessageCircle />} title="Nenhuma conversa aqui">{filter === 'todas' ? 'Quando um paciente chamar no WhatsApp, a conversa aparece aqui.' : 'Tente outro filtro.'}</Empty>}
            {list.map((c) => <ConvItem key={c.id} c={c} contact={byId.get(c.contact_id ?? '')} active={c.id === id} />)}
          </div>
        </aside>
        {current ? <Chat key={current.id} conv={current} contact={byId.get(current.contact_id ?? '')} /> : <div className="ib-chat" style={{ display: 'grid', placeItems: 'center' }}><Empty icon={<MessageCircle />} title="Escolha uma conversa" /></div>}
        {current && byId.get(current.contact_id ?? '') && <ContactSide contact={byId.get(current.contact_id ?? '')!} />}
      </section>
    </>
  );
}

function ConvItem({ c, contact, active }: { c: Conversation; contact?: Contact; active: boolean }) {
  const name = contact?.name ?? formatPhone(contact?.phone) ?? 'Paciente';
  return (
    <Link to={`/conversas/${c.id}`} className={cx('ib-item', active && 'active', c.needs_attention && 'attention')} role="listitem">
      <Avatar name={name} />
      <div className="ib-main">
        <div className="ib-top"><span className="ib-name truncate">{name}</span><span className="ib-time">{fmtListTime(c.last_message_at)}</span></div>
        <div className="ib-prev">
          {c.handler === 'humano' ? <UserRound aria-label="com a equipe" /> : <Bot aria-label="com a IA" />}
          <span className="truncate">{c.last_message_preview ?? ''}</span>
          {c.unread > 0 && <span className="unread">{c.unread}</span>}
        </div>
        {(c.needs_attention || c.channel === 'simulador' || contact?.temperature === 'quente') && (
          <div className="ib-tags">
            {c.needs_attention && <Badge tone="orange" size="sm" dot>{c.attention_reason ? 'Precisa de você' : 'Atenção'}</Badge>}
            {c.channel === 'simulador' && <Badge size="sm">Teste</Badge>}
            {contact?.temperature === 'quente' && !c.needs_attention && <Badge tone="orange" size="sm">Lead quente</Badge>}
          </div>
        )}
      </div>
    </Link>
  );
}

function Chat({ conv, contact }: { conv: Conversation; contact?: Contact }) {
  const { data: msgs = [], isLoading } = useList('messages', { filters: [{ col: 'conversation_id', op: 'eq', value: conv.id }], order: [{ col: 'created_at', asc: true }], limit: 400 });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inv = useInvalidate();
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => { if (conv.unread) void api.markRead(conv.id).then(() => inv('conversations')); }, [conv.id, conv.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length]);

  const windowLeft = conv.last_inbound_at ? 24 - (Date.now() - Date.parse(conv.last_inbound_at)) / 3600000 : -1;
  const windowOpen = conv.channel === 'simulador' || windowLeft > 0;
  const name = contact?.name ?? 'Paciente';

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (conv.handler === 'ia') await api.setHandler(conv.id, 'humano');
      await api.sendMessage(conv.id, t);
      setText('');
      inv('messages', 'conversations');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const suggest = async () => {
    setSuggesting(true);
    try { setText(await api.suggestReply(conv.id)); } catch (e) { toast((e as Error).message, 'err'); } finally { setSuggesting(false); }
  };
  const toggleHandler = async () => {
    const next = conv.handler === 'ia' ? 'humano' : 'ia';
    await api.setHandler(conv.id, next);
    inv('conversations');
    toast(next === 'ia' ? 'A IA voltou a atender esta conversa' : 'Você assumiu a conversa. A IA fica em silêncio aqui.');
  };

  return (
    <div className="ib-chat">
      <div className="ib-chat-head">
        <IconButton label="Voltar" size="sm" className="only-mobile" onClick={() => nav('/conversas')}><ArrowLeft /></IconButton>
        <Avatar name={name} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="who-name truncate">{name}</div>
          <div className="who-sub">{contact?.phone ? formatPhone(contact.phone) : conv.channel === 'simulador' ? 'Conversa de teste (simulador)' : ''}{conv.handler === 'ia' ? ' · IA atendendo' : ' · Equipe atendendo'}</div>
        </div>
        <Button size="sm" variant={conv.handler === 'ia' ? 'solid' : 'ai'} icon={conv.handler === 'ia' ? <Hand /> : <Sparkles />} onClick={toggleHandler}>{conv.handler === 'ia' ? 'Assumir conversa' : 'Devolver para a IA'}</Button>
        <IconButton label="Ficha do paciente" size="sm" className="side-toggle" onClick={() => setSideOpen(true)}><Info /></IconButton>
        <Menu trigger={({ toggle }) => <IconButton label="Mais opções" size="sm" onClick={toggle}><MoreVertical /></IconButton>}>
          {(close) => <>
            {contact && <button onClick={() => { close(); nav(`/clientes/${contact.id}`); }}><UserRound />Ver ficha completa</button>}
            {contact && <button onClick={() => { close(); nav(`/orcamentos/novo?cliente=${contact.id}`); }}><FilePlus2 />Novo orçamento</button>}
            {contact && <button onClick={() => { close(); nav(`/agenda?novo=1&cliente=${contact.id}`); }}><CalendarPlus />Agendar horário</button>}
            {contact?.phone && <a href={`tel:+${contact.phone}`} onClick={close}><Phone />Ligar</a>}
            <div className="sep" />
            <button onClick={async () => { close(); await api.update('conversations', conv.id, { status: conv.status === 'aberta' ? 'resolvida' : 'aberta', needs_attention: false }); inv('conversations'); toast(conv.status === 'aberta' ? 'Conversa marcada como resolvida' : 'Conversa reaberta'); }}>{conv.status === 'aberta' ? <><CheckCircle2 />Marcar como resolvida</> : <><Undo2 />Reabrir conversa</>}</button>
          </>}
        </Menu>
      </div>
      {conv.needs_attention && conv.attention_reason && <div className="ai-handling" style={{ background: 'var(--orange-soft)' }}><AlertTriangle style={{ color: 'var(--orange-ink)' }} /><span><b>A IA pediu ajuda:</b> {conv.attention_reason}</span></div>}
      <div className="ib-scroll" ref={scroller}>
        {isLoading ? <Loader /> : <Thread messages={msgs} mine={(m) => m.direction === 'out'} />}
      </div>
      {conv.channel !== 'simulador' && (
        <div className={cx('ib-window', !windowOpen && 'closed')}>
          <Clock3 />
          {windowOpen ? <span>Janela de 24h aberta: dá para responder livremente por mais <b>{Math.max(1, Math.floor(windowLeft))}h</b>.</span> : <span>Fora da janela de 24h do WhatsApp: só dá para enviar <b>modelos aprovados</b> (lembrete, acompanhamento). {isDemo ? 'Na demonstração o envio é simulado.' : ''}</span>}
        </div>
      )}
      {conv.handler === 'ia' && <div className="ai-handling"><Bot /><span>A IA está atendendo. Se você responder, assume a conversa automaticamente.</span></div>}
      <div className="composer">
        <Button variant="ghost" iconOnly icon={suggesting ? undefined : <Wand2 />} loading={suggesting} onClick={suggest} title="Sugerir resposta com a IA" aria-label="Sugerir resposta com a IA" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Responder ${name.split(' ')[0]}...`} rows={1}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} aria-label="Mensagem" />
        <button className="send" onClick={send} disabled={!text.trim() || busy} aria-label="Enviar"><Send /></button>
      </div>
      {contact && <Drawer open={sideOpen} onClose={() => setSideOpen(false)} title="Ficha do paciente"><ContactSide contact={contact} inDrawer /></Drawer>}
    </div>
  );
}

export function ContactSide({ contact, inDrawer }: { contact: Contact; inDrawer?: boolean }) {
  const inv = useInvalidate();
  const toast = useToast();
  const { data: quotes = [] } = useList('quotes', { filters: [{ col: 'contact_id', op: 'eq', value: contact.id }], order: [{ col: 'created_at', asc: false }], limit: 4 });
  const { data: appts = [] } = useList('appointments', { filters: [{ col: 'contact_id', op: 'eq', value: contact.id }], order: [{ col: 'starts_at', asc: false }], limit: 4 });
  const [notes, setNotes] = useState(contact.notes ?? '');
  useEffect(() => setNotes(contact.notes ?? ''), [contact.id, contact.notes]);
  const save = async (patch: Partial<Contact>) => { await api.update('contacts', contact.id, patch); inv('contacts'); };
  return (
    <aside className={cx(!inDrawer && 'ib-side')}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'grid', placeItems: 'center' }}><Avatar name={contact.name} size="xl" /></div>
        <div style={{ fontWeight: 800, fontSize: 17, marginTop: 10 }}>{contact.name}</div>
        <div className="muted small">{formatPhone(contact.phone) || 'Sem telefone'}</div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
          <Badge tone={TEMP_TONE[contact.temperature]} dot>Lead {TEMP_LABEL[contact.temperature].toLowerCase()}</Badge>
          {contact.tags.map((t) => <Badge key={t} size="sm">{t}</Badge>)}
        </div>
      </div>
      <div>
        <h4>Etapa no funil</h4>
        <Select value={contact.stage} onChange={(e) => save({ stage: e.target.value as Stage }).then(() => toast('Etapa atualizada'))} aria-label="Etapa">
          {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </Select>
      </div>
      <div>
        <h4>Pontuação do lead</h4>
        <div className="score"><div className="progress"><span style={{ width: `${contact.score}%`, background: contact.score > 70 ? 'var(--orange)' : contact.score > 40 ? 'var(--yellow)' : 'var(--blue)' }} /></div><b className="small">{contact.score}</b></div>
      </div>
      <dl className="kv">
        <dt>Paciente desde</dt><dd>{fmtDate(contact.created_at)}</dd>
        <dt>Convênio</dt><dd>{contact.insurance ? `${contact.insurance}${contact.insurance_card ? ` · ${contact.insurance_card}` : ''}` : 'Particular'}</dd>
        {contact.birthday && <><dt>Nascimento</dt><dd>{fmtDate(contact.birthday + 'T12:00:00Z')}</dd></>}
        {contact.guardian_name && <><dt>Responsável</dt><dd>{contact.guardian_name}</dd></>}
        <dt>Total pago</dt><dd>{brl(contact.total_spent)}</dd>
        {contact.email && <><dt>E-mail</dt><dd>{contact.email}</dd></>}
        <dt>Origem</dt><dd style={{ textTransform: 'capitalize' }}>{contact.source}</dd>
      </dl>
      <div>
        <h4>Orçamentos</h4>
        <div className="mini-list">
          {quotes.length === 0 && <div className="muted">Nenhum ainda</div>}
          {quotes.map((q) => <Link key={q.id} to={`/orcamentos/${q.id}`}><span>nº {String(q.number).padStart(4, '0')} · {q.status}</span><b>{brl(q.total)}</b></Link>)}
        </div>
      </div>
      <div>
        <h4>Consultas</h4>
        <div className="mini-list">
          {appts.length === 0 && <div className="muted">Nenhum ainda</div>}
          {appts.map((a) => <Link key={a.id} to="/agenda"><span className="truncate">{fmtDate(a.starts_at)} · {a.title}</span><span className="muted">{a.status}</span></Link>)}
        </div>
      </div>
      <div>
        <h4>Anotações</h4>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (contact.notes ?? '')) void save({ notes }).then(() => toast('Anotação salva')); }} placeholder="Ex.: prefere horários à tarde, vem com o filho..." />
      </div>
    </aside>
  );
}
