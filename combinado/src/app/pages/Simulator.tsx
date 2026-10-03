// Simulador: converse com a IA como se fosse um paciente no WhatsApp, antes de ligar o número de verdade.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, RotateCcw, Send, Settings2, Sparkles, Signal, Wifi, BatteryFull } from 'lucide-react';
import { api } from '../data/api';
import { useList } from '../data/hooks';
import { useMeCtx } from '../context';
import type { ActionReceipt, Message } from '../data/types';
import { Avatar, Button, Field, Input, PageHeader, useToast } from '../ui';
import { Receipts, Thread } from '../ui/chat';
import { fmtTime } from '../../shared/format';

const TRIES = ['Oi! Quanto custa uma limpeza?', 'Tem horário sexta às 14h com a Dra. Marina?', 'Vocês aceitam Unimed?', 'Quanto custa colocar aparelho?', 'Estou com dor de dente, posso tomar remédio?', 'Quero falar com uma pessoa'];

export default function Simulator() {
  const { me } = useMeCtx();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('Paciente de teste');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [log, setLog] = useState<ActionReceipt[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  const { data: ai } = useAiName();
  const { data: msgs = [] } = useList('messages', convId ? { filters: [{ col: 'conversation_id', op: 'eq', value: convId }], order: [{ col: 'created_at', asc: true }] } : { limit: 0 }, { enabled: !!convId });

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, busy]);

  const send = async (raw?: string, reset = false) => {
    const t = (raw ?? text).trim();
    if (!t || busy) return;
    setText(''); setBusy(t);
    try {
      const r = await api.simulate(t, { reset: reset || !convId, name });
      setConvId(r.conversation_id);
      if (r.actions.length) setLog((l) => [...r.actions, ...l].slice(0, 12));
      if (r.handoff) toast('A IA passou o atendimento para a equipe. Veja em Conversas.');
    } catch (e) { toast((e as Error).message, 'err'); } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['list'] }); void qc.invalidateQueries({ queryKey: ['stats'] });
    }
  };
  const restart = () => { setConvId(null); setLog([]); toast('Conversa reiniciada. A próxima mensagem começa um atendimento novo.'); };

  const shown: Message[] = useMemo(() => busy ? [...msgs, { id: 'p', company_id: '', conversation_id: convId ?? '', direction: 'in', sender: 'contato', sender_name: name, body: busy, media: null, wa_status: null, actions: null, response_seconds: null, channel: 'simulador', created_at: new Date().toISOString() }] : msgs, [msgs, busy, convId, name]);

  return (
    <>
      <PageHeader title="Simulador do WhatsApp" subtitle="Teste a IA como se você fosse um paciente. O que acontecer aqui entra de verdade no sistema, marcado como teste." actions={<><Link className="btn" to="/configuracoes/assistente"><Settings2 />Ajustar a IA</Link><Button icon={<RotateCcw />} onClick={restart}>Recomeçar</Button></>} />
      <div className="sim">
        <div className="col" style={{ gap: 18 }}>
          <section className="card">
            <h3 style={{ fontSize: 16 }}>Como a {ai ?? 'IA'} vai atender</h3>
            <p className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>Ela responde com base nos procedimentos e valores, nos convênios aceitos, na agenda de cada profissional e nas instruções que você escreveu. Nunca orienta sintomas: nesses casos, e quando o paciente pede, ela chama a equipe.</p>
            <div className="form-grid" style={{ marginTop: 16 }}>
              <Field label="Nome do paciente de teste"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Clínica"><Input value={me.company.name} disabled /></Field>
            </div>
            <div className="label" style={{ marginTop: 18 }}>Experimente perguntar</div>
            <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>{TRIES.map((t) => <button key={t} className="chip" onClick={() => void send(t)} disabled={!!busy}>{t}</button>)}</div>
          </section>
          <section className="card">
            <div className="card-head"><div><h3>O que a IA fez nesta conversa</h3><div className="sub">Cada ação aparece também na Agenda, em Orçamentos e no Histórico.</div></div></div>
            {log.length === 0 ? <p className="muted" style={{ fontSize: 13.5 }}>Nenhuma ação ainda. Peça um horário ou um orçamento para ver a IA trabalhando.</p> : <Receipts actions={log} />}
          </section>
        </div>
        <div className="sim-phone-wrap">
          <div className="phone">
            <div className="phone-notch" />
            <div className="phone-screen">
              <div className="phone-status"><span>{fmtTime(new Date())}</span><span style={{ display: 'flex', gap: 5 }}><Signal style={{ width: 14 }} /><Wifi style={{ width: 14 }} /><BatteryFull style={{ width: 16 }} /></span></div>
              <div className="phone-top">
                <Avatar name={me.company.name} />
                <div className="grow"><div className="n">{me.company.name}<BadgeCheck /></div><div className="st">{busy ? 'digitando…' : 'conta comercial'}</div></div>
                <Sparkles style={{ width: 18, opacity: 0.8 }} />
              </div>
              <div className="phone-chat" ref={chatRef}>
                {shown.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: '#54656F', fontSize: 13 }}>Mande uma mensagem como se fosse um paciente. 👇</div>
                  : <Thread messages={shown} mine={(m) => m.direction === 'in'} showSender={false} renderAfter={busy ? <div className="typing-row" style={{ background: '#fff', color: '#54656F' }}><span className="typing"><i /><i /><i /></span></div> : null} />}
              </div>
              <form className="phone-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensagem" aria-label="Mensagem do paciente de teste" />
                <button type="submit" aria-label="Enviar" disabled={!!busy}><Send /></button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function useAiName() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => { void api.aiSettings().then((s) => setName(s.assistant_name)).catch(() => {}); }, []);
  return { data: name };
}
