// Página pública do orçamento: o cliente abre o link do WhatsApp, confere e aprova (ou recusa).
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Check, MessageCircle, X, FileText } from 'lucide-react';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/playfair-display/latin-700-italic.css';
import '../app/styles/tokens.css';
import '../app/styles/base.css';
import '../app/styles/ui.css';
import './quote.css';
import { brl, fmtDate, firstName } from '../shared/format';
import { BRAND, logoSvg } from '../shared/brand';

interface PublicQuote {
  number: number; status: string; title: string | null; subtotal: number; discount: number; total: number; valid_until: string | null; notes: string | null;
  items: { description: string; qty: number; unit_price: number }[];
  company: { name: string; phone: string | null; city: string | null };
  contact_name: string | null;
}

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
const token = decodeURIComponent(location.hash.replace(/^#/, '')).trim();

async function load(): Promise<PublicQuote | null> {
  if (URL_ && KEY && !localStorage.getItem('orbyta-modo')) {
    const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.rpc('public_quote', { p_token: token });
    if (error) throw new Error(error.message);
    return data as PublicQuote | null;
  }
  // demonstração: lê os dados guardados no navegador
  const raw = localStorage.getItem('orbyta-demo');
  if (!raw) return null;
  const db = JSON.parse(raw);
  const q = db.quotes.find((x: { public_token: string }) => x.public_token === token);
  if (!q) return null;
  const c = db.contacts.find((x: { id: string }) => x.id === q.contact_id);
  return { ...q, items: db.quote_items.filter((i: { quote_id: string }) => i.quote_id === q.id).sort((a: { sort: number }, b: { sort: number }) => a.sort - b.sort), company: { name: db.company.name, phone: db.company.phone, city: db.company.city }, contact_name: c?.name ?? null };
}
async function respond(decision: 'aprovado' | 'recusado', note: string): Promise<void> {
  if (URL_ && KEY && !localStorage.getItem('orbyta-modo')) {
    const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
    const { error } = await sb.rpc('respond_quote', { p_token: token, p_decision: decision, p_note: note || null });
    if (error) throw new Error(error.message.includes('nao_disponivel') ? 'Este orçamento não está mais disponível para resposta.' : error.message);
    return;
  }
  const db = JSON.parse(localStorage.getItem('orbyta-demo') ?? '{}');
  const q = db.quotes?.find((x: { public_token: string }) => x.public_token === token);
  if (q) {
    q.status = decision; q.responded_at = new Date().toISOString();
    db.notifications?.unshift({ id: crypto.randomUUID(), company_id: q.company_id, user_id: null, kind: 'orcamento', title: decision === 'aprovado' ? 'Orçamento aprovado pelo cliente' : 'Orçamento recusado', body: `nº ${String(q.number).padStart(4, '0')} · ${brl(q.total)}${note ? ` · “${note}”` : ''}`, link: `#/orcamentos/${q.id}`, read_at: null, created_at: new Date().toISOString() });
    localStorage.setItem('orbyta-demo', JSON.stringify(db));
  }
}

function App() {
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [done, setDone] = useState<'aprovado' | 'recusado' | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { load().then((d) => { setQ(d); setState(d ? 'ok' : 'missing'); }).catch((e) => { setErr(String(e.message ?? e)); setState('error'); }); }, []);
  useEffect(() => { if (q) document.title = `Orçamento nº ${String(q.number).padStart(4, '0')} · ${q.company.name}`; }, [q]);

  const act = async (d: 'aprovado' | 'recusado') => {
    setBusy(true); setErr('');
    try { await respond(d, note); setDone(d); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const wa = q?.company.phone ? `https://wa.me/${q.company.phone}?text=${encodeURIComponent(`Olá! Sobre o orçamento nº ${String(q.number).padStart(4, '0')}...`)}` : null;
  const expired = q?.valid_until && q.valid_until < new Date().toISOString().slice(0, 10);
  const final = done ?? (q && ['aprovado', 'recusado', 'expirado'].includes(q.status) ? q.status : null);

  return (
    <main className="pq">
      <div className="pq-card">
        {state === 'loading' && <div className="loader"><span /></div>}
        {state === 'missing' && <div className="pq-empty"><FileText /><h1>Orçamento não encontrado</h1><p>O link pode estar incompleto ou o orçamento foi removido. Peça um novo link para a empresa.</p></div>}
        {state === 'error' && <div className="pq-empty"><FileText /><h1>Não foi possível abrir</h1><p>{err}</p></div>}
        {state === 'ok' && q && (
          <>
            <header className="pq-head">
              <div><div className="pq-company">{q.company.name}</div><div className="pq-sub">{q.company.city ?? ''}</div></div>
              <div className="pq-num">Orçamento<br /><b>nº {String(q.number).padStart(4, '0')}</b></div>
            </header>
            <h1 className="pq-title">{q.contact_name ? <>Olá, {firstName(q.contact_name)}! </> : null}Aqui está o seu <span className="accent">orçamento.</span></h1>
            {q.title && <p className="pq-desc">{q.title}</p>}
            <div className="pq-items">
              {q.items.map((i, k) => <div key={k} className="pq-item"><span>{i.description}{i.qty !== 1 ? <small> × {i.qty.toLocaleString('pt-BR')}</small> : null}</span><b>{brl(i.qty * i.unit_price)}</b></div>)}
            </div>
            {q.discount > 0 && <><div className="pq-line"><span>Subtotal</span><span>{brl(q.subtotal)}</span></div><div className="pq-line"><span>Desconto</span><span>− {brl(q.discount)}</span></div></>}
            <div className="pq-total"><span>Total</span><b>{brl(q.total)}</b></div>
            {q.valid_until && <div className="pq-valid">{expired ? 'Venceu em' : 'Válido até'} {fmtDate(q.valid_until)}</div>}
            {q.notes && <p className="pq-notes">{q.notes}</p>}
            {final ? (
              <div className={`pq-result ${final}`}>
                {final === 'aprovado' ? <><Check /><div><b>Combinado! Orçamento aprovado.</b><span>{q.company.name} já foi avisada e vai falar com você para marcar o melhor horário.</span></div></> : final === 'recusado' ? <><X /><div><b>Orçamento recusado.</b><span>Obrigado por avisar. Se quiser outra proposta, é só chamar no WhatsApp.</span></div></> : <><X /><div><b>Este orçamento venceu.</b><span>Peça uma versão atualizada no WhatsApp.</span></div></>}
              </div>
            ) : expired ? (
              <div className="pq-result expirado"><X /><div><b>Este orçamento venceu.</b><span>Peça uma versão atualizada no WhatsApp.</span></div></div>
            ) : refusing ? (
              <div className="pq-refuse">
                <label className="label" htmlFor="why">Quer contar o motivo? (opcional)</label>
                <textarea id="why" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: achei o valor alto, vou fazer mais pra frente..." />
                <div className="pq-actions"><button className="btn ghost" onClick={() => setRefusing(false)}>Voltar</button><button className="btn danger" disabled={busy} onClick={() => act('recusado')}>Recusar orçamento</button></div>
              </div>
            ) : (
              <div className="pq-actions">
                <button className="btn lg green" disabled={busy} onClick={() => act('aprovado')}><Check />Aprovar orçamento</button>
                <button className="btn lg ghost" onClick={() => setRefusing(true)}>Recusar</button>
              </div>
            )}
            {err && <p className="pq-err" role="alert">{err}</p>}
            {wa && <a className="btn block pq-wa" href={wa} target="_blank" rel="noreferrer"><MessageCircle />Tirar dúvidas no WhatsApp</a>}
          </>
        )}
      </div>
      <a className="pq-brand" href="/" target="_blank" rel="noreferrer"><span dangerouslySetInnerHTML={{ __html: logoSvg(22, { title: false }) }} style={{ display: 'contents' }} />Enviado com {BRAND.name}</a>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
