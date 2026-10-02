// Kit de interface do painel.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpRight, Check, CircleAlert, Minus, X } from 'lucide-react';
import { formatPhone, initials, normalizePhone, parseMoney } from '../../shared/format';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/* ---------- botões ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' | 'soft' | 'danger' | 'danger-soft' | 'ai' | 'green' | 'default'; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean; block?: boolean; iconOnly?: boolean };
export function Button({ variant = 'default', size = 'md', icon, loading, block, iconOnly, className, children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} className={cx('btn', variant !== 'default' && variant, size !== 'md' && size, block && 'block', iconOnly && 'icon', className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
export function IconButton({ label, className, size, children, active, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'xs'; active?: boolean; badge?: number | boolean }) {
  return (
    <button type="button" className={cx('icon-btn', size, active && 'active', className)} aria-label={label} title={label} {...rest}>
      {children}
      {badge === true && <span className="dot" aria-hidden />}
      {typeof badge === 'number' && badge > 0 && <span className="count">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

/* ---------- selos ---------- */
export function Badge({ tone, children, dot, size, icon, title }: { tone?: 'blue' | 'orange' | 'green' | 'red' | 'violet' | 'yellow' | 'solid' | 'ai'; children: ReactNode; dot?: boolean; size?: 'sm'; icon?: ReactNode; title?: string }) {
  return <span className={cx('badge', tone, size)} title={title}>{dot && <span className="bdot" />}{icon}{children}</span>;
}

/* ---------- avatar ---------- */
const AV_COLORS = ['#2F7BFF', '#FF7A30', '#12C08B', '#7C5CFF', '#FF5FA2', '#10B5C9', '#F2A516', '#5B6CFF', '#E2516B', '#0EA5A0'];
export function colorFor(seed: string) { let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
export function Avatar({ name, size, online, src }: { name: string; size?: 'sm' | 'lg' | 'xl'; online?: boolean; src?: string | null }) {
  return (
    <span className={cx('avatar', size)} style={{ background: src ? 'var(--surface-3)' : `linear-gradient(135deg, ${colorFor(name)}, ${colorFor(name + 'x')})` }} aria-hidden>
      {src ? <img src={src} alt="" /> : initials(name)}
      {online && <span className="on" />}
    </span>
  );
}

/* ---------- campos ---------- */
export function Field({ label, hint, error, children, className, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx('field', className)}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx('input', invalid && 'invalid', className)} aria-invalid={invalid || undefined} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cx('textarea', className)} {...rest} />; }
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={cx('select', className)} {...rest}>{children}</select>; }

/** Campo de dinheiro: mostra "1.234,56" e devolve número. */
export function MoneyInput({ value, onChange, id, placeholder = '0,00', autoFocus }: { value: number | null | undefined; onChange: (v: number) => void; id?: string; placeholder?: string; autoFocus?: boolean }) {
  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [text, setText] = useState(value ? fmt(value) : '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? fmt(value) : ''); }, [value]);
  return (
    <div className="input-prefix">
      <span>R$</span>
      <input id={id} className="input num" inputMode="decimal" placeholder={placeholder} value={text} autoFocus={autoFocus}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; const v = parseMoney(text); setText(v ? fmt(v) : ''); onChange(v); }}
        onChange={(e) => { setText(e.target.value.replace(/[^\d.,]/g, '')); onChange(parseMoney(e.target.value)); }} />
    </div>
  );
}
/** Telefone com máscara (61) 99999-9999; devolve só dígitos com DDI 55. */
export function PhoneInput({ value, onChange, id, placeholder = '(61) 99999-9999' }: { value: string | null | undefined; onChange: (v: string) => void; id?: string; placeholder?: string }) {
  const [text, setText] = useState(value ? formatPhone(value) : '');
  useEffect(() => { setText(value ? formatPhone(value) : ''); }, [value]);
  return (
    <input id={id} className="input num" inputMode="tel" placeholder={placeholder} value={text}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, '').slice(0, 13);
        const local = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
        let t = local;
        if (local.length > 2) t = `(${local.slice(0, 2)}) ${local.slice(2)}`;
        if (local.length > 7) t = `(${local.slice(0, 2)}) ${local.slice(2, local.length === 11 ? 7 : 6)}-${local.slice(local.length === 11 ? 7 : 6)}`;
        setText(t);
        onChange(local.length >= 10 ? normalizePhone(local) : local);
      }} />
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.icon}{o.label}</button>)}
    </div>
  );
}

/* ---------- variação ---------- */
export function Delta({ value, goodWhenUp = true, suffix }: { value: number | null; goodWhenUp?: boolean; suffix?: string }) {
  if (value == null || !isFinite(value)) return <span className="delta flat"><Minus />—</span>;
  const up = value > 0.0005, down = value < -0.0005;
  const good = up ? goodWhenUp : down ? !goodWhenUp : null;
  const cls = good === null ? 'flat' : good ? 'up' : 'down';
  return (
    <span className={cx('delta', cls)} title={suffix}>
      {up ? <ArrowUpRight aria-label="subiu" /> : down ? <ArrowDownRight aria-label="caiu" /> : <Minus aria-label="estável" />}
      {Math.abs(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0 })}%
      {suffix && <span className="vs">{suffix}</span>}
    </span>
  );
}

/* ---------- estados ---------- */
export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty">{icon && <div className="empty-icon">{icon}</div>}<h4>{title}</h4>{children && <p>{children}</p>}{action}</div>;
}
export function Loader() { return <div className="loader" role="status" aria-label="Carregando"><span /></div>; }
export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) { return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />; }

/* ---------- janela ---------- */
export function Modal({ open, onClose, title, subtitle, children, footer, size }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow' }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="modal-head">
          <div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <IconButton label="Fechar" size="sm" onClick={onClose}><X /></IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
export function Drawer({ open, onClose, title, children, actions, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className={cx('drawer', wide && 'wide')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="drawer-head"><div className="grow" style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>{actions}<IconButton label="Fechar" size="sm" onClick={onClose}><X /></IconButton></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

/* ---------- menu suspenso ---------- */
export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h); document.addEventListener('touchstart', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); document.removeEventListener('keydown', k); };
  }, [ref, onOut, active]);
}
export function Menu({ trigger, children, align = 'right', up }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && <div className={cx('menu', align === 'left' && 'left', up && 'up')} role="menu">{children(close)}</div>}
    </div>
  );
}

/* ---------- avisos ---------- */
type Toast = { id: number; text: string; kind: 'ok' | 'err' | 'info'; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(text: string, kind?: Toast['kind'], action?: Toast['action']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, kind, action }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 6500 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {list.map((t) => (
            <div key={t.id} className={cx('toast', t.kind)}>
              {t.kind === 'err' ? <CircleAlert /> : <Check />}
              <span>{t.text}</span>
              {t.action && <button onClick={() => { t.action!.run(); setList((l) => l.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- confirmação ---------- */
type ConfirmOpts = { title: string; text?: ReactNode; confirm?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!state} onClose={() => done(false)} title={state?.title ?? ''} size="narrow"
        footer={<><Button variant="ghost" onClick={() => done(false)}>Voltar</Button><Button variant={state?.danger ? 'danger' : 'solid'} onClick={() => done(true)} autoFocus>{state?.confirm ?? 'Confirmar'}</Button></>}>
        {state?.text && <div className="muted-2" style={{ fontSize: 14 }}>{state.text}</div>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------- cabeçalho de página ---------- */
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Faz um elemento ocupar a altura que sobra na janela (caixa de entrada, agenda). */
export function useFillHeight<T extends HTMLElement>(bottomGap = 24) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const mobile = window.innerWidth <= 860;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = window.innerHeight - top - (mobile ? 96 : bottomGap);
      el.style.setProperty('--fill-h', `${Math.max(mobile ? 460 : 520, h)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    const ro = new ResizeObserver(fit); ro.observe(document.body);
    return () => { window.removeEventListener('resize', fit); ro.disconnect(); };
  }, [bottomGap]);
  return ref;
}
