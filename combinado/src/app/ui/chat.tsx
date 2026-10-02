// Peças de conversa usadas na caixa de entrada, no assistente e no simulador.
import { Fragment, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCheck, Clock3, Sparkles, XCircle, CircleSlash, Mic, FileText, Image as ImageIcon, MapPin, MessageCircle } from 'lucide-react';
import type { ActionReceipt, Message } from '../data/types';
import { daysBetween, fmtDate, fmtTime, localDate, WEEKDAYS } from '../../shared/format';
import { cx } from './index';
import { api } from '../data/api';

export function dayLabel(iso: string): string {
  const d = localDate(iso), today = localDate(new Date());
  const diff = daysBetween(d, today);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7) { const wd = WEEKDAYS[new Date(iso).getDay()]; return wd[0].toUpperCase() + wd.slice(1); }
  return fmtDate(iso);
}

export function Ticks({ status }: { status: Message['wa_status'] }) {
  if (!status) return null;
  if (status === 'falhou') return <XCircle className="ticks fail" aria-label="falhou" />;
  if (status === 'enviada') return <Check className="ticks" aria-label="enviada" />;
  return <CheckCheck className={cx('ticks', status === 'lida' && 'read')} aria-label={status} />;
}

const ICON: Record<ActionReceipt['status'], typeof Check> = { ok: Check, erro: XCircle, aguardando: Clock3, cancelada: CircleSlash, negada: CircleSlash };
export function Receipts({ actions, onResolve, compact }: { actions: ActionReceipt[]; onResolve?: (pendingId: string, approve: boolean) => void; compact?: boolean }) {
  return (
    <div className={cx('receipts', compact && 'compact')}>
      {!compact && <div className="receipts-title">Ações realizadas</div>}
      {actions.map((a, i) => {
        const I = ICON[a.status] ?? Check;
        return (
          <div key={i} className={cx('receipt', a.status)}>
            <span className="r-ic"><I /></span>
            <span className="grow"><span className="r-l">{a.label}</span>{a.detail && <span className="r-d">{a.detail}</span>}</span>
            {a.status === 'aguardando' && a.pending_id && onResolve && (
              <span className="r-act">
                <button className="btn sm danger-soft" onClick={() => onResolve(a.pending_id!, false)}>Cancelar</button>
                <button className="btn sm green" onClick={() => onResolve(a.pending_id!, true)}>Confirmar</button>
              </span>
            )}
            {a.link && a.status === 'ok' && <a className="r-link" href={a.link}>Abrir</a>}
          </div>
        );
      })}
    </div>
  );
}

function Media({ m }: { m: NonNullable<Message['media']> }) {
  // arquivos do WhatsApp ficam numa pasta privada: o link é temporário e pedido na hora de mostrar
  const { data: signed } = useQuery({ queryKey: ['media', m.path], queryFn: () => api.mediaUrl?.(m.path!) ?? null, enabled: !m.url && !!m.path && !!api.mediaUrl, staleTime: 50 * 60_000 });
  const url = m.url ?? signed ?? null;
  if (m.type === 'image' && url) return <img className="msg-img" src={url} alt={m.caption ?? 'Imagem enviada'} loading="lazy" />;
  const I = m.type === 'audio' ? Mic : m.type === 'image' ? ImageIcon : m.type === 'location' ? MapPin : FileText;
  const label = m.type === 'audio' ? (m.transcript ? 'Áudio · transcrito pela IA' : 'Áudio') : m.type === 'image' ? 'Imagem' : m.type === 'location' ? (m.caption || 'Localização') : m.filename ?? 'Documento';
  return <div className="msg-file">{url ? <a href={url} target="_blank" rel="noreferrer"><I />{label}</a> : <><I />{label}</>}{m.type === 'audio' && url && <audio controls src={url} preload="none" />}</div>;
}

/** Linha de mensagens agrupadas por dia. `mine` decide quais ficam à direita. */
export function Thread({ messages, mine, onResolve, renderAfter, showSender = true }: { messages: Message[]; mine: (m: Message) => boolean; onResolve?: (id: string, ok: boolean) => void; renderAfter?: ReactNode; showSender?: boolean }) {
  let lastDay = '';
  return (
    <div className="thread">
      {messages.map((m, i) => {
        const day = localDate(m.created_at);
        const sep = day !== lastDay ? <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div> : null;
        lastDay = day;
        const right = mine(m);
        const prev = messages[i - 1];
        const grouped = prev && localDate(prev.created_at) === day && prev.sender === m.sender && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60000;
        if (m.sender === 'sistema') return <Fragment key={m.id}>{sep}<div className="sys-msg">{m.body}</div></Fragment>;
        return (
          <Fragment key={m.id}>
            {sep}
            <div className={cx('msg', right ? 'out' : 'in', m.sender, grouped && 'grouped')}>
              <div className="bubble">
                {showSender && !grouped && (m.sender === 'ia' || m.sender === 'equipe') && (
                  <div className="who">{m.sender === 'ia' ? <><Sparkles />{m.sender_name ?? 'IA'}</> : m.sender_name ?? 'Equipe'}{m.channel === 'whatsapp' && m.direction === 'out' && <MessageCircle className="via" aria-label="pelo WhatsApp" />}</div>
                )}
                {m.media && <Media m={m.media} />}
                {m.body && !(m.media && m.body.startsWith('[')) && <div className="txt">{m.body}</div>}
                <div className="meta">{m.channel === 'whatsapp' && m.sender === 'dono' && <span className="via-tag">WhatsApp</span>}{fmtTime(m.created_at)}{m.direction === 'out' && <Ticks status={m.wa_status} />}</div>
              </div>
              {m.actions && m.actions.length > 0 && <Receipts actions={m.actions} onResolve={onResolve} compact={!onResolve} />}
            </div>
          </Fragment>
        );
      })}
      {renderAfter}
    </div>
  );
}
