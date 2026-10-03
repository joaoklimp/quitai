// Cobranças (Pix e boleto pelo Asaas da empresa) e notas fiscais de serviço (NFS-e pela Focus NFe).
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Check, Copy, ExternalLink, FileCheck2, Landmark, Plug, Plus, ReceiptText, RefreshCw, Send, Sparkles } from 'lucide-react';
import { api, isDemo } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Charge, ChargeMethod, ChargeStatus, Contact, FiscalNote, FiscalStatus } from '../data/types';
import { can, useMeCtx } from '../context';
import { Badge, Button, Empty, Field, Input, Loader, Modal, MoneyInput, PageHeader, Segmented, Select, Switch, Textarea, useConfirm, useToast } from '../ui';
import { ContactPicker } from '../ui/pickers';
import { addDays, brl, brl0, fmtDate, fmtDateTime, todayLocal } from '../../shared/format';

export const CHARGE_METHOD: Record<ChargeMethod, string> = { pix_boleto: 'Pix ou boleto', pix: 'Pix', boleto: 'Boleto' };
const CHARGE_STATUS: Record<ChargeStatus, { label: string; tone: 'green' | 'red' | 'orange' | 'blue' | undefined }> = {
  pendente: { label: 'Aguardando', tone: 'blue' }, paga: { label: 'Paga', tone: 'green' }, vencida: { label: 'Vencida', tone: 'red' }, cancelada: { label: 'Cancelada', tone: undefined }, estornada: { label: 'Estornada', tone: 'orange' },
};
const NOTE_STATUS: Record<FiscalStatus, { label: string; tone: 'green' | 'red' | 'orange' | undefined }> = {
  processando: { label: 'Na prefeitura', tone: 'orange' }, autorizada: { label: 'Autorizada', tone: 'green' }, erro: { label: 'Recusada', tone: 'red' }, cancelada: { label: 'Cancelada', tone: undefined },
};
export const onlyDigits = (s: string) => s.replace(/\D/g, '');
export function fmtDoc(d?: string | null) {
  const x = onlyDigits(d ?? '');
  if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d ?? '';
}

type Tab = 'cobrancas' | 'notas';

export default function Charges() {
  const { me } = useMeCtx();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('aba') === 'notas' ? 'notas' : 'cobrancas';
  const setTab = (t: Tab) => setParams(t === 'notas' ? { aba: 'notas' } : {}, { replace: true });
  const { data: integrations = [] } = useList('company_integrations');
  const asaas = integrations.find((i) => i.provider === 'asaas' && i.status === 'conectado');
  const focus = integrations.find((i) => i.provider === 'focusnfe' && i.status === 'conectado');
  const [chargeForm, setChargeForm] = useState(params.get('nova') === 'cobranca');
  const [noteForm, setNoteForm] = useState<{ open: boolean; preset?: NotePreset }>({ open: params.get('nova') === 'nota', preset: params.get('venda') ? { saleId: params.get('venda') } : undefined });

  if (!can(me, 'dono', 'gerente')) return <Empty icon={<Landmark />} title="Sem acesso">As cobranças e notas ficam visíveis só para o dono e gerentes.</Empty>;
  return (
    <>
      <PageHeader title="Cobranças e notas fiscais" subtitle="Mande Pix ou boleto para o paciente no WhatsApp e emita a nota do serviço. Quando ele paga, vira venda e a conta é baixada sozinha."
        actions={<>
          <Button icon={<ReceiptText />} onClick={() => setNoteForm({ open: true })}>Emitir nota</Button>
          <Button variant="solid" icon={<Plus />} onClick={() => setChargeForm(true)}>Nova cobrança</Button>
        </>} />
      <div style={{ marginBottom: 16 }}>
        <Segmented label="Mostrar" value={tab} onChange={setTab} options={[{ value: 'cobrancas', label: 'Cobranças', icon: <Landmark /> }, { value: 'notas', label: 'Notas fiscais', icon: <ReceiptText /> }]} />
      </div>
      {tab === 'cobrancas' ? <ChargesTab connected={!!asaas} testMode={asaas?.environment === 'testes'} onNew={() => setChargeForm(true)} onNote={(c) => setNoteForm({ open: true, preset: { chargeId: c.id, contactId: c.contact_id, amount: c.amount, description: c.description, saleId: c.sale_id } })} />
        : <NotesTab connected={!!focus} testMode={focus?.environment === 'testes'} onNew={() => setNoteForm({ open: true })} />}
      <ChargeForm open={chargeForm} connected={!!asaas} onClose={() => { setChargeForm(false); if (params.get('nova')) setParams(tab === 'notas' ? { aba: 'notas' } : {}, { replace: true }); }} />
      <NoteForm open={noteForm.open} preset={noteForm.preset} connected={!!focus} onClose={() => { setNoteForm({ open: false }); if (params.get('nova') || params.get('venda')) setParams({ aba: 'notas' }, { replace: true }); }} />
    </>
  );
}

function NotConnected({ what, provider }: { what: string; provider: string }) {
  return (
    <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="integ-ic"><Plug /></span>
      <div className="grow" style={{ minWidth: 220 }}><b>Conecte {provider} para {what}</b><p className="muted small" style={{ margin: '4px 0 0' }}>Leva 2 minutos e você pode testar no modo de testes antes de usar de verdade.</p></div>
      <Link className="btn solid sm" to="/integracoes">Conectar</Link>
    </div>
  );
}

function useContactMap(ids: (string | null)[]) {
  const uniq = useMemo(() => [...new Set(ids.filter(Boolean) as string[])], [ids]);
  const { data = [] } = useList('contacts', uniq.length ? { filters: [{ col: 'id', op: 'in', value: uniq.slice(0, 500) }] } : { limit: 0 }, { enabled: uniq.length > 0 });
  return new Map(data.map((c) => [c.id, c]));
}

function ChargesTab({ connected, testMode, onNew, onNote }: { connected: boolean; testMode: boolean; onNew: () => void; onNote: (c: Charge) => void }) {
  const { me } = useMeCtx();
  const today = todayLocal(me.company.timezone);
  const [view, setView] = useState<'abertas' | 'pagas' | 'todas'>('abertas');
  const { data: charges = [], isLoading } = useList('charges', { order: [{ col: 'created_at', asc: false }], limit: 1000 });
  const cmap = useContactMap(charges.map((c) => c.contact_id));
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const open = charges.filter((c) => c.status === 'pendente' || c.status === 'vencida');
  const overdue = open.filter((c) => c.status === 'vencida' || c.due_date < today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const paidMonth = charges.filter((c) => c.status === 'paga' && (c.paid_at ?? '') >= monthStart);
  const sum = (l: Charge[]) => l.reduce((s, c) => s + c.amount, 0);
  const list = charges.filter((c) => (view === 'abertas' ? c.status === 'pendente' || c.status === 'vencida' : view === 'pagas' ? c.status === 'paga' : true));

  const run = async (c: Charge, action: 'charge_send' | 'charge_sync' | 'charge_cancel' | 'demo_pay', ok: string) => {
    setBusy(c.id + action);
    try {
      const r = await api.integrations<{ sent?: boolean; reason?: string; charge?: Charge }>(action, { id: c.id });
      inv('charges', 'finance_entries', 'sales', 'contacts');
      if (action === 'charge_send' && r.sent === false) toast(r.reason || 'Não foi possível mandar no WhatsApp.', 'err');
      else if (action === 'charge_sync') toast(r.charge?.status === 'paga' ? 'Pagamento confirmado: virou venda.' : r.charge?.status === 'vencida' ? 'Ainda não foi paga e já venceu.' : 'Ainda não foi paga.');
      else toast(ok);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  const copy = async (text: string, msg: string) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Não deu para copiar', 'err'); } };

  return (
    <>
      {!connected && <NotConnected what="cobrar com Pix e boleto" provider="o Asaas da empresa" />}
      {connected && testMode && <p className="muted small" style={{ margin: '0 0 12px' }}><Badge size="sm" tone="orange">Modo de testes</Badge> As cobranças são de mentira (sandbox do Asaas). Troque para produção em Integrações quando quiser cobrar de verdade.</p>}
      <div className="stat-row">
        <div className="stat"><span>A receber</span><b>{brl0(sum(open))}</b><small>{open.length} {open.length === 1 ? 'cobrança' : 'cobranças'} em aberto</small></div>
        <div className="stat"><span>Vencidas</span><b style={{ color: overdue.length ? 'var(--red-ink)' : undefined }}>{brl0(sum(overdue))}</b><small>{overdue.length ? `${overdue.length} sem pagamento` : 'nada atrasado 🙌'}</small></div>
        <div className="stat"><span>Recebido no mês</span><b style={{ color: 'var(--green-ink)' }}>{brl0(sum(paidMonth))}</b><small>{paidMonth.length} pagas pelo link</small></div>
        <div className="stat"><span>Pelo WhatsApp</span><b style={{ fontSize: 15, lineHeight: 1.35 }}>“cobra R$ 250 da Juliana para sexta”</b><small>a IA pede sua confirmação</small></div>
      </div>
      <section className="card" style={{ marginTop: 6 }}>
        <div className="card-head wrap" style={{ gap: 10 }}>
          <div><h3>Cobranças</h3><div className="sub">Cada cobrança tem um link com Pix e boleto. O pagamento cai na conta Asaas da empresa.</div></div>
          <Select value={view} onChange={(e) => setView(e.target.value as typeof view)} style={{ width: 180 }} aria-label="Mostrar"><option value="abertas">Em aberto</option><option value="pagas">Pagas</option><option value="todas">Todas</option></Select>
        </div>
        {isLoading ? <Loader /> : list.length === 0 ? <Empty icon={<Landmark />} title={view === 'pagas' ? 'Nenhuma cobrança paga ainda' : 'Nenhuma cobrança em aberto'} action={<Button variant="solid" icon={<Plus />} onClick={onNew}>Nova cobrança</Button>}>Gere um Pix ou boleto e mande para o paciente no WhatsApp. Quando ele pagar, a ORBYTA registra a venda sozinha.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Vencimento</th><th>Paciente</th><th>Descrição</th><th>Situação</th><th className="num">Valor</th><th /></tr></thead>
              <tbody>{list.slice(0, 400).map((c) => {
                const st = CHARGE_STATUS[c.status === 'pendente' && c.due_date < today ? 'vencida' : c.status];
                const ct = cmap.get(c.contact_id ?? '') as Contact | undefined;
                const active = c.status === 'pendente' || c.status === 'vencida';
                return (
                  <tr key={c.id}>
                    <td className="nowrap">{fmtDate(c.due_date)}</td>
                    <td className="truncate" style={{ maxWidth: 180 }}>{ct?.name ?? '—'}</td>
                    <td style={{ maxWidth: 260 }}><span className="truncate" style={{ display: 'block' }}>{c.description}</span><span className="muted tiny">{CHARGE_METHOD[c.method]}{c.sent_at ? ' · enviada no WhatsApp' : ''}{c.created_via === 'ia_dono' ? ' · pela IA' : ''}</span></td>
                    <td><Badge size="sm" tone={st.tone} dot>{st.label}</Badge>{c.paid_at && <div className="muted tiny">{fmtDateTime(c.paid_at)}</div>}</td>
                    <td className="num"><b>{brl(c.amount)}</b></td>
                    <td className="nowrap">
                      {c.invoice_url && <button className="icon-btn xs" aria-label="Copiar link de pagamento" title="Copiar link de pagamento" onClick={() => copy(c.invoice_url!, 'Link de pagamento copiado')}><Copy /></button>}
                      {c.invoice_url && <a className="icon-btn xs" aria-label="Abrir cobrança" title="Abrir cobrança" href={c.invoice_url} target="_blank" rel="noreferrer"><ExternalLink /></a>}
                      {active && c.pix_code && <Button size="sm" onClick={() => copy(c.pix_code!, 'Pix copia e cola copiado')}>Pix</Button>}
                      {active && <Button size="sm" icon={<Send />} loading={busy === c.id + 'charge_send'} onClick={() => run(c, 'charge_send', 'Cobrança enviada no WhatsApp')}>{c.sent_at ? 'Reenviar' : 'Enviar'}</Button>}
                      {active && !isDemo && <button className="icon-btn xs" aria-label="Conferir pagamento" title="Conferir pagamento no Asaas" onClick={() => run(c, 'charge_sync', '')}><RefreshCw /></button>}
                      {active && isDemo && <Button size="sm" icon={<Sparkles />} loading={busy === c.id + 'demo_pay'} onClick={() => run(c, 'demo_pay', 'Pagamento simulado: virou venda e a conta foi baixada.')}>Simular pagamento</Button>}
                      {c.status === 'paga' && <Button size="sm" icon={<ReceiptText />} onClick={() => onNote(c)}>Nota</Button>}
                      {active && <button className="icon-btn xs" aria-label="Cancelar cobrança" title="Cancelar cobrança" onClick={async () => { if (await confirm({ title: 'Cancelar esta cobrança?', text: `${ct?.name ?? ''} · ${brl(c.amount)}. O link deixa de funcionar.`, confirm: 'Cancelar cobrança', danger: true })) await run(c, 'charge_cancel', 'Cobrança cancelada'); }}><Ban /></button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function NotesTab({ connected, testMode, onNew }: { connected: boolean; testMode: boolean; onNew: () => void }) {
  const { data: notes = [], isLoading } = useList('fiscal_notes', { order: [{ col: 'created_at', asc: false }], limit: 1000 });
  const inv = useInvalidate();
  const toast = useToast();
  const [cancel, setCancel] = useState<FiscalNote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const auth = notes.filter((n) => n.status === 'autorizada');
  const sync = async (n: FiscalNote) => {
    setBusy(n.id);
    try { const r = await api.integrations<{ note: FiscalNote }>('note_sync', { id: n.id }); inv('fiscal_notes'); toast(r.note.status === 'autorizada' ? 'Nota autorizada' : r.note.status === 'erro' ? 'A prefeitura recusou a nota' : 'Ainda na prefeitura. Tente de novo em instantes.'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  return (
    <>
      {!connected && <NotConnected what="emitir nota fiscal de serviço" provider="a Focus NFe" />}
      {connected && testMode && <p className="muted small" style={{ margin: '0 0 12px' }}><Badge size="sm" tone="orange">Homologação</Badge> As notas são de teste e não têm valor fiscal. Troque para produção em Integrações quando o seu contador aprovar.</p>}
      <div className="stat-row">
        <div className="stat"><span>Notas autorizadas</span><b>{auth.length}</b><small>{brl0(auth.reduce((s, n) => s + n.amount, 0))} no total</small></div>
        <div className="stat"><span>Na prefeitura</span><b>{notes.filter((n) => n.status === 'processando').length}</b><small>aguardando autorização</small></div>
        <div className="stat"><span>Recusadas</span><b style={{ color: notes.some((n) => n.status === 'erro') ? 'var(--red-ink)' : undefined }}>{notes.filter((n) => n.status === 'erro').length}</b><small>veja o motivo na lista</small></div>
        <div className="stat"><span>Pelo WhatsApp</span><b style={{ fontSize: 15, lineHeight: 1.35 }}>“emite a nota da Juliana”</b><small>a IA pede sua confirmação</small></div>
      </div>
      <section className="card" style={{ marginTop: 6 }}>
        <div className="card-head"><div><h3>Notas fiscais de serviço (NFS-e)</h3><div className="sub">Emitidas na prefeitura da sua cidade pela Focus NFe. O PDF fica disponível assim que for autorizada.</div></div></div>
        {isLoading ? <Loader /> : notes.length === 0 ? <Empty icon={<ReceiptText />} title="Nenhuma nota emitida" action={<Button variant="solid" icon={<Plus />} onClick={onNew}>Emitir nota</Button>}>Emita a nota de um serviço em segundos, a partir de uma venda, de uma cobrança paga ou do zero.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Data</th><th>Nº</th><th>Tomador</th><th>Serviço</th><th>Situação</th><th className="num">Valor</th><th /></tr></thead>
              <tbody>{notes.slice(0, 400).map((n) => {
                const st = NOTE_STATUS[n.status];
                return (
                  <tr key={n.id}>
                    <td className="nowrap muted">{fmtDateTime(n.issued_at ?? n.created_at)}</td>
                    <td className="nowrap">{n.number ?? '—'}</td>
                    <td style={{ maxWidth: 200 }}><span className="truncate" style={{ display: 'block' }}>{n.taker?.name ?? '—'}</span>{n.taker?.document && <span className="muted tiny">{fmtDoc(n.taker.document)}</span>}</td>
                    <td className="truncate" style={{ maxWidth: 240 }}>{n.description}</td>
                    <td><Badge size="sm" tone={st.tone} dot>{st.label}</Badge>{n.error && <div className="tiny" style={{ color: 'var(--red-ink)', maxWidth: 260, whiteSpace: 'normal' }}>{n.error}</div>}</td>
                    <td className="num"><b>{brl(n.amount)}</b></td>
                    <td className="nowrap">
                      {n.pdf_url && <a className="btn sm" href={n.pdf_url} target="_blank" rel="noreferrer"><FileCheck2 />PDF</a>}
                      {n.xml_url && <a className="icon-btn xs" href={n.xml_url} target="_blank" rel="noreferrer" aria-label="Baixar XML" title="XML"><ExternalLink /></a>}
                      {n.status === 'processando' && <Button size="sm" icon={<RefreshCw />} loading={busy === n.id} onClick={() => sync(n)}>Atualizar</Button>}
                      {n.status === 'autorizada' && <button className="icon-btn xs" aria-label="Cancelar nota" title="Cancelar nota" onClick={() => setCancel(n)}><Ban /></button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <CancelNote note={cancel} onClose={() => setCancel(null)} />
    </>
  );
}

function CancelNote({ note, onClose }: { note: FiscalNote | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  useEffect(() => { if (note) setReason(''); }, [note]);
  const go = async () => {
    if (!note) return;
    if (reason.trim().length < 15) { toast('Escreva o motivo (pelo menos 15 letras).', 'err'); return; }
    setBusy(true);
    try { await api.integrations('note_cancel', { id: note.id, reason: reason.trim() }); inv('fiscal_notes'); toast('Nota cancelada na prefeitura'); onClose(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!note} onClose={onClose} title={`Cancelar a nota nº ${note?.number ?? ''}`} subtitle={note ? `${note.taker?.name ?? ''} · ${brl(note.amount)}` : ''}
      footer={<><Button variant="ghost" onClick={onClose}>Voltar</Button><Button variant="danger" loading={busy} onClick={go}>Cancelar nota</Button></>}>
      <Field label="Motivo do cancelamento" hint="A prefeitura exige um motivo. Algumas cidades só aceitam cancelar dentro de um prazo."><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Serviço não foi prestado, paciente desistiu." autoFocus /></Field>
    </Modal>
  );
}

function ChargeForm({ open, connected, onClose }: { open: boolean; connected: boolean; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const { me } = useMeCtx();
  const [contact, setContact] = useState<Contact | null>(null);
  const [f, setF] = useState({ document: '', amount: 0, description: '', due_date: '', method: 'pix_boleto' as ChargeMethod, send: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setContact(null); setF({ document: '', amount: 0, description: '', due_date: addDays(todayLocal(me.company.timezone), 3), method: 'pix_boleto', send: true }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!contact) { toast('Escolha o paciente', 'err'); return; }
    const doc = onlyDigits(f.document);
    if (!/^(\d{11}|\d{14})$/.test(doc)) { toast('Informe o CPF ou CNPJ do paciente (o Asaas exige).', 'err'); return; }
    if (f.amount < 5) { toast('O valor mínimo é R$ 5,00', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.integrations<{ charge: Charge; sent: boolean; reason?: string }>('charge_create', { contact_id: contact.id, document: doc, amount: f.amount, description: f.description.trim() || 'Serviço', due_date: f.due_date, method: f.method, send: f.send });
      inv('charges', 'finance_entries', 'contacts');
      toast(f.send ? (r.sent ? `Cobrança enviada para ${contact.name} no WhatsApp` : `Cobrança criada. Não foi enviada: ${r.reason ?? 'sem WhatsApp'}`) : 'Cobrança criada. Copie o link para mandar.', f.send && !r.sent ? 'err' : undefined);
      onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Nova cobrança" subtitle="Gera um link com Pix e boleto no Asaas da empresa."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} disabled={!connected} onClick={save}>{f.send ? 'Gerar e enviar' : 'Gerar cobrança'}</Button></>}>
      {!connected ? <Empty icon={<Plug />} title="Conecte o Asaas primeiro" action={<Link className="btn solid" to="/integracoes" onClick={onClose}>Ir para Integrações</Link>}>Você cria uma conta grátis no Asaas, copia a chave da API e cola aqui na ORBYTA.</Empty> : (
        <div className="form-grid">
          <Field label="Paciente" className="full"><ContactPicker value={contact?.id ?? null} onChange={(c) => { setContact(c); setF((x) => ({ ...x, document: c?.document ? fmtDoc(c.document) : x.document })); }} autoFocus /></Field>
          <Field label="CPF ou CNPJ do paciente"><Input value={f.document} inputMode="numeric" onChange={(e) => setF({ ...f, document: e.target.value })} onBlur={() => setF((x) => ({ ...x, document: fmtDoc(x.document) }))} placeholder="000.000.000-00" /></Field>
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Descrição" className="full"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: Limpeza de sofá 3 lugares" /></Field>
          <Field label="Vencimento"><Input type="date" value={f.due_date} min={todayLocal(me.company.timezone)} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Forma"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as ChargeMethod })}>{(Object.keys(CHARGE_METHOD) as ChargeMethod[]).map((m) => <option key={m} value={m}>{CHARGE_METHOD[m]}</option>)}</Select></Field>
          <label className="row full" style={{ gap: 10 }}><Switch checked={f.send} onChange={(v) => setF({ ...f, send: v })} label="Mandar no WhatsApp" /><span>Mandar o link para o paciente no WhatsApp agora</span></label>
          <p className="muted small full" style={{ margin: 0 }}>Também entra em Financeiro → a receber. Quando o paciente pagar, a ORBYTA registra a venda e dá baixa sozinha.</p>
        </div>
      )}
    </Modal>
  );
}

export interface NotePreset { contactId?: string | null; saleId?: string | null; chargeId?: string | null; amount?: number; description?: string }

function NoteForm({ open, preset, connected, onClose }: { open: boolean; preset?: NotePreset; connected: boolean; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [contactId, setContactId] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', document: '', email: '', amount: 0, description: '' });
  const [busy, setBusy] = useState(false);
  const { data: sale } = useList('sales', preset?.saleId ? { filters: [{ col: 'id', op: 'eq', value: preset.saleId }] } : { limit: 0 }, { enabled: open && !!preset?.saleId && !preset.amount });
  useEffect(() => {
    if (!open) return;
    setContactId(preset?.contactId ?? null);
    setF({ name: '', document: '', email: '', amount: preset?.amount ?? 0, description: preset?.description ?? '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const s = sale?.[0]; if (open && s && !preset?.amount) { setContactId(s.contact_id); setF((x) => ({ ...x, amount: s.amount, description: s.description })); } }, [sale, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (c: Contact | null) => { setContactId(c?.id ?? null); setF((x) => ({ ...x, name: c?.name ?? '', document: c?.document ? fmtDoc(c.document) : '', email: c?.email ?? '' })); };
  const { data: picked } = useList('contacts', contactId ? { filters: [{ col: 'id', op: 'eq', value: contactId }] } : { limit: 0 }, { enabled: open && !!contactId });
  useEffect(() => { const c = picked?.[0]; if (c && !f.name) setF((x) => ({ ...x, name: c.name, document: c.document ? fmtDoc(c.document) : x.document, email: c.email ?? x.email })); }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!f.name.trim()) { toast('Informe o nome do paciente', 'err'); return; }
    const doc = onlyDigits(f.document);
    if (doc && !/^(\d{11}|\d{14})$/.test(doc)) { toast('CPF ou CNPJ inválido', 'err'); return; }
    if (f.amount <= 0) { toast('Informe o valor', 'err'); return; }
    if (f.description.trim().length < 5) { toast('Descreva o serviço prestado', 'err'); return; }
    setBusy(true);
    try {
      await api.integrations('note_emit', { contact_id: contactId, sale_id: preset?.saleId ?? null, charge_id: preset?.chargeId ?? null, amount: f.amount, description: f.description.trim(), taker: { name: f.name.trim(), document: doc, email: f.email.trim() } });
      inv('fiscal_notes', 'contacts'); toast('Nota enviada para a prefeitura. Você recebe um aviso quando for autorizada.'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Emitir nota fiscal de serviço" subtitle="NFS-e emitida na prefeitura da sua cidade pela Focus NFe."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" icon={<Check />} loading={busy} disabled={!connected} onClick={save}>Emitir nota</Button></>}>
      {!connected ? <Empty icon={<Plug />} title="Conecte a emissão de notas primeiro" action={<Link className="btn solid" to="/integracoes" onClick={onClose}>Ir para Integrações</Link>}>Você precisa de uma conta na Focus NFe com o certificado digital da empresa e os dados fiscais que o seu contador passa.</Empty> : (
        <div className="form-grid">
          <Field label="Paciente cadastrado (opcional)" className="full"><ContactPicker value={contactId} onChange={pick} /></Field>
          <Field label="Nome ou razão social do tomador" className="full"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="CPF ou CNPJ" hint="Recomendado. Algumas prefeituras exigem."><Input value={f.document} inputMode="numeric" onChange={(e) => setF({ ...f, document: e.target.value })} onBlur={() => setF((x) => ({ ...x, document: fmtDoc(x.document) }))} /></Field>
          <Field label="E-mail (a prefeitura envia a nota)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Valor do serviço"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Descrição do serviço" className="full"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: Higienização de sofá 3 lugares e 2 poltronas, realizada em 02/10/2026." /></Field>
        </div>
      )}
    </Modal>
  );
}
