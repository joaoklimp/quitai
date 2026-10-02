// Assistente do dono: a IA dentro do painel. Você pede do seu jeito e ela executa no sistema,
// com recibo de cada ação e confirmação obrigatória para ações sensíveis.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send, X, MessageCircle, Lightbulb } from 'lucide-react';
import { useAssistant, useMeCtx } from '../context';
import { useList } from '../data/hooks';
import { api, isDemo } from '../data/api';
import type { Message } from '../data/types';
import { Thread } from '../ui/chat';
import { IconButton, cx, useToast } from '../ui';

const EXAMPLES = [
  'Cadastra a Maria, telefone 61999999999, e cria um orçamento de R$ 350 para ela.',
  'Quanto vendi essa semana?',
  'O que tenho na agenda amanhã?',
  'Quais orçamentos estão parados?',
  'Agenda o João Pereira segunda às 10h para limpeza de sofá 3 lugares',
  'Registra uma venda de R$ 180 no Pix para a Juliana Ribeiro',
  'Me lembra de ligar para o fornecedor amanhã às 9h',
];
const CHIPS = ['Resumo de hoje', 'Agenda de amanhã', 'Orçamentos parados', 'Quem está esperando?', 'O que vence essa semana?', 'O que preciso repor?'];
const STEPS = ['Entendendo o pedido', 'Executando no sistema', 'Conferindo o resultado'];

export function AssistantDrawer() {
  const { open, setOpen, prefill, clearPrefill } = useAssistant();
  const { me } = useMeCtx();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const { data: convs = [] } = useList('conversations', { filters: [{ col: 'kind', op: 'eq', value: 'dono' }, { col: 'member_user_id', op: 'eq', value: me.user_id }], limit: 1 }, { enabled: open });
  const conv = convs[0];
  const { data: msgs = [] } = useList('messages', conv ? { filters: [{ col: 'conversation_id', op: 'eq', value: conv.id }], order: [{ col: 'created_at', asc: true }], limit: 200 } : { limit: 0 }, { enabled: open && !!conv });

  useEffect(() => { if (open && prefill) { setText(prefill); clearPrefill(); setTimeout(() => inputRef.current?.focus(), 80); } }, [open, prefill, clearPrefill]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, pending, open]);
  useEffect(() => {
    if (!pending) { setStep(0); return; }
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 900);
    return () => clearInterval(t);
  }, [pending]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const refreshAll = () => { void qc.invalidateQueries({ queryKey: ['list'] }); void qc.invalidateQueries({ queryKey: ['stats'] }); void qc.invalidateQueries({ queryKey: ['get'] }); };

  const send = async (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || pending) return;
    setText(''); setPending(t);
    try { await api.assistant(t); } catch (e) { toast((e as Error).message, 'err'); setText(t); } finally { setPending(null); refreshAll(); }
  };
  const resolve = async (id: string, approve: boolean) => {
    setPending(approve ? 'SIM' : 'NÃO');
    try { await api.resolvePending(id, approve); } catch (e) { toast((e as Error).message, 'err'); } finally { setPending(null); refreshAll(); }
  };

  const shown: Message[] = useMemo(() => {
    if (!pending || !conv) return msgs;
    return [...msgs, { id: 'pending', company_id: '', conversation_id: conv.id, direction: 'in', sender: 'dono', sender_name: 'Você', body: pending, media: null, wa_status: null, actions: null, response_seconds: null, channel: 'painel', created_at: new Date().toISOString() }];
  }, [msgs, pending, conv]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={() => setOpen(false)} />
      <aside className="drawer asst-drawer" role="dialog" aria-modal="true" aria-label="Assistente">
        <div className="asst">
          <div className="asst-head">
            <span className="sparkle-ai" style={{ width: 38, height: 38, borderRadius: 13 }}><Sparkles /></span>
            <div className="grow"><div className="t">Assistente</div><div className="s">Peça do seu jeito. A IA executa no sistema e te mostra o que fez.</div></div>
            <IconButton label="Fechar" size="sm" onClick={() => setOpen(false)}><X /></IconButton>
          </div>
          <div className="asst-body" ref={scroller}>
            {shown.length === 0 && (
              <div className="asst-welcome">
                <h3>Sua empresa funcionando <span className="accent">por uma conversa.</span></h3>
                <p>Escreva aqui ou mande no WhatsApp da empresa pelo seu número cadastrado. Vendas, cancelamentos, preços e descontos altos sempre pedem sua confirmação.</p>
                <div className="asst-ex">
                  {EXAMPLES.map((e) => <button key={e} onClick={() => void send(e)}><Lightbulb />{e}</button>)}
                </div>
              </div>
            )}
            {shown.length > 0 && <Thread messages={shown} mine={(m) => m.direction === 'in'} onResolve={resolve} renderAfter={pending ? (
              <div className="typing-row"><Sparkles style={{ width: 16, color: 'var(--violet)' }} /><span>{STEPS[step]}</span><span className="typing"><i /><i /><i /></span></div>
            ) : null} />}
          </div>
          {pending && <div className="asst-steps" style={{ background: 'var(--surface-2)' }}>{STEPS.map((s, i) => <span key={s} className={cx(i === step && 'on', i < step && 'done')}>{i < step ? '✓' : i + 1}. {s}</span>)}</div>}
          <div className="asst-chips">{CHIPS.map((c) => <button key={c} className="chip" onClick={() => void send(c)} disabled={!!pending}>{c}</button>)}</div>
          <div className="composer">
            <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder='Ex.: "agenda a Ana sexta às 15h"'
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} aria-label="Pedido para a IA" />
            <button className="send" onClick={() => void send()} disabled={!text.trim() || !!pending} aria-label="Enviar"><Send /></button>
          </div>
          <div className="muted tiny" style={{ padding: '0 16px 12px', background: 'var(--surface)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <MessageCircle style={{ width: 12 }} />{isDemo ? 'Demonstração: o assistente entende os pedidos mais comuns. Na conta real, quem responde é a IA completa.' : 'Também funciona no WhatsApp: verifique seu número em Configurações → WhatsApp.'}
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}
