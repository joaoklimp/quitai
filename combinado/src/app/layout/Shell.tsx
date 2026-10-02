// Casca do painel: placa de vidro sobre o céu, barra com abas em pílula, trilho lateral e navegação do celular.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, CalendarDays, CheckCheck, ClipboardList, CreditCard, FileText, HelpCircle, History, LayoutGrid, LogOut, Menu as MenuIcon, MessageCircle,
  Monitor, Moon, Search, Settings, ShieldCheck, Smartphone, Sparkles, Sun, Tag, Users, Wallet, Workflow, CalendarCheck, CircleDollarSign, Bot, Info,
  Landmark, Package, Plug, Orbit, ReceiptText, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { BRAND, logoSvg, wordmarkHtml } from '../../shared/brand';
import { fmtAgo } from '../../shared/format';
import { Avatar, Button, IconButton, Menu, cx, useToast } from '../ui';
import { useAssistant, useMeCtx, useTheme } from '../context';
import { useList, useInvalidate } from '../data/hooks';
import { api, isDemo, leaveDemo, canUseRealAccount } from '../data/api';
import { CommandPalette } from './CommandPalette';
import type { Notification, Role } from '../data/types';

type NavItem = { to: string; label: string; icon: typeof Bell; end?: boolean; roles?: Role[] };
const MANAGERS: Role[] = ['dono', 'gerente'];
export const PRIMARY: NavItem[] = [
  { to: '/', label: 'Visão geral', icon: LayoutGrid, end: true },
  { to: '/conversas', label: 'Conversas', icon: MessageCircle },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/orcamentos', label: 'Orçamentos', icon: FileText },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/financeiro', label: 'Financeiro', icon: Landmark, roles: MANAGERS },
  { to: '/estoque', label: 'Estoque', icon: Package },
];
export const SECONDARY: NavItem[] = [
  { to: '/modulos', label: 'Módulos ORBYTA', icon: Orbit },
  { to: '/vendas', label: 'Vendas', icon: Wallet, roles: MANAGERS },
  { to: '/cobrancas', label: 'Cobranças e notas', icon: ReceiptText, roles: MANAGERS },
  { to: '/catalogo', label: 'Serviços e preços', icon: Tag },
  { to: '/tarefas', label: 'Tarefas', icon: ClipboardList },
  { to: '/analises', label: 'Análises', icon: BarChart3 },
  { to: '/automacoes', label: 'Automações', icon: Workflow },
  { to: '/integracoes', label: 'Integrações', icon: Plug },
  { to: '/simulador', label: 'Simulador do WhatsApp', icon: Smartphone },
  { to: '/historico', label: 'Histórico de ações', icon: History },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];
export const allowed = (items: NavItem[], role: Role) => items.filter((i) => !i.roles || i.roles.includes(role));

function useAttentionCount() {
  const { data } = useList('conversations', { filters: [{ col: 'needs_attention', op: 'eq', value: true }, { col: 'status', op: 'eq', value: 'aberta' }] });
  return data?.length ?? 0;
}

export function Shell({ children }: { children: ReactNode }) {
  const { me } = useMeCtx();
  const assistant = useAssistant();
  const nav = useNavigate();
  const loc = useLocation();
  const attention = useAttentionCount();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); assistant.setOpen(!assistant.open); }
    };
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('keydown', onKey); window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll); };
  }, [assistant]);
  useEffect(() => { setMoreOpen(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);

  const trialDays = me.company.billing_status === 'trialing' ? Math.max(0, Math.ceil((Date.parse(me.company.trial_ends_at) - Date.now()) / 86400000)) : null;
  const blocked = !me.company.complimentary && (me.company.billing_status === 'canceled' || me.company.billing_status === 'blocked' || (me.company.billing_status === 'trialing' && trialDays === 0));

  return (
    <div className="app">
      <nav className="rail" aria-label="Atalhos">
        <IconButton label="Assistente (Ctrl+J)" active={assistant.open} onClick={() => assistant.setOpen(!assistant.open)}><Sparkles /><span className="tip">Assistente IA</span></IconButton>
        <div className="rail-sep" />
        {allowed(SECONDARY, me.role).map((s) => (
          <IconButton key={s.to} label={s.label} active={loc.pathname.startsWith(s.to)} onClick={() => nav(s.to)}><s.icon /><span className="tip">{s.label}</span></IconButton>
        ))}
        {me.isPlatformAdmin && <IconButton label="Admin da plataforma" active={loc.pathname.startsWith('/admin')} onClick={() => nav('/admin')}><ShieldCheck /><span className="tip">Admin da plataforma</span></IconButton>}
      </nav>

      <div className="board">
        <header className={cx('topbar', scrolled && 'scrolled')}>
          <NavLink to="/" className="brand" aria-label={`${BRAND.name} — início`}>
            <span className="brand-icon" dangerouslySetInnerHTML={{ __html: logoSvg(38, { title: false }) }} />
            <span className="brand-name" dangerouslySetInnerHTML={{ __html: wordmarkHtml(30) }} />
          </NavLink>
          <ScrollPills>
            {allowed(PRIMARY, me.role).map((p) => (
              <NavLink key={p.to} to={p.to} end={p.end} className={({ isActive }) => cx('pill', isActive && 'active')}>
                <p.icon />{p.label}{p.to === '/conversas' && attention > 0 && <span className="n">{attention}</span>}
              </NavLink>
            ))}
          </ScrollPills>
          <div className="topbar-tools">
            <button className="search-btn" onClick={() => setCmdOpen(true)} aria-label="Buscar"><Search /><span>Buscar...</span><span className="kbd">Ctrl K</span></button>
            <Notifications />
            <button className="ai-btn only-desktop" onClick={() => assistant.setOpen(true)} title="Assistente (Ctrl+J)"><span className="sparkle-ai"><Sparkles /></span><span className="label">Assistente</span></button>
            <UserMenu />
          </div>
        </header>

        {isDemo && (
          <div className="demo-bar" role="note">
            <Info />
            <span className="grow"><b>Modo demonstração.</b> Dados de exemplo da “{me.company.name}”. Teste à vontade: nada é cobrado nem enviado.</span>
            {canUseRealAccount ? <Button size="sm" variant="solid" onClick={leaveDemo}>Criar minha conta</Button> : <Button size="sm" onClick={() => { api.resetDemo?.(); toast('Demonstração restaurada'); }}>Restaurar dados</Button>}
          </div>
        )}
        {!isDemo && !me.company.complimentary && trialDays !== null && trialDays > 0 && (
          <div className="demo-bar" role="note"><Info /><span className="grow">Seu teste grátis termina em <b>{trialDays} {trialDays === 1 ? 'dia' : 'dias'}</b>. Assine para manter a IA atendendo.</span><Button size="sm" variant="solid" onClick={() => nav('/configuracoes/assinatura')}>Ver planos</Button></div>
        )}
        {!isDemo && blocked && (
          <div className="demo-bar" role="alert" style={{ background: 'var(--red-soft)' }}><Info /><span className="grow"><b>Sua assinatura está inativa.</b> O painel está em modo leitura e a IA parou de responder.</span><Button size="sm" variant="solid" onClick={() => nav('/configuracoes/assinatura')}>Reativar</Button></div>
        )}

        <main className="page" id="conteudo">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="Navegação">
        <NavLink to="/" end className={({ isActive }) => cx(isActive && 'active')}><LayoutGrid />Início</NavLink>
        <NavLink to="/conversas" className={({ isActive }) => cx(isActive && 'active')}><MessageCircle />Conversas{attention > 0 && <span className="n">{attention}</span>}</NavLink>
        <button onClick={() => assistant.setOpen(true)} aria-label="Assistente"><span className="bn-ai"><Sparkles /></span></button>
        <NavLink to="/agenda" className={({ isActive }) => cx(isActive && 'active')}><CalendarDays />Agenda</NavLink>
        <button onClick={() => setMoreOpen(true)} className={cx(moreOpen && 'active')}><MenuIcon />Mais</button>
      </nav>
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}

/** Abas do topo: quando não cabem, aparecem setas e a roda do mouse rola para o lado (nada fica escondido). */
function ScrollPills({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    const onWheel = (e: WheelEvent) => { if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } };
    update();
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(update); ro.observe(el);
    // a aba ativa fica sempre à vista
    el.querySelector<HTMLElement>('.pill.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return () => { el.removeEventListener('scroll', update); el.removeEventListener('wheel', onWheel); ro.disconnect(); };
  }, []);
  const go = (dir: number) => ref.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  return (
    <div className={cx('pills-wrap', edge.left && 'at-left', edge.right && 'at-right')}>
      {edge.left && <button className="pills-arrow left" onClick={() => go(-1)} aria-label="Ver abas anteriores"><ChevronLeft /></button>}
      <nav ref={ref} className="pills" aria-label="Principal">{children}</nav>
      {edge.right && <button className="pills-arrow right" onClick={() => go(1)} aria-label="Ver mais abas"><ChevronRight /></button>}
    </div>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const { me } = useMeCtx();
  const items = [...allowed(PRIMARY, me.role).filter((p) => !['/', '/conversas', '/agenda'].includes(p.to)), ...allowed(SECONDARY, me.role), ...(me.isPlatformAdmin ? [{ to: '/admin', label: 'Admin da plataforma', icon: ShieldCheck }] : [])];
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Menu">
        <div className="modal-head"><h2>Menu</h2><IconButton label="Fechar" size="sm" onClick={onClose}>✕</IconButton></div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, paddingBottom: 24 }}>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} onClick={onClose} className="card flat tight" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', fontSize: 12.5, fontWeight: 650 }}>
              <i.icon style={{ width: 22, height: 22 }} />{i.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserMenu() {
  const { me } = useMeCtx();
  const [theme, setTheme] = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();
  const roleLabel = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente' }[me.role];
  return (
    <Menu trigger={({ toggle }) => <button className="user-btn" onClick={toggle} aria-label="Sua conta"><Avatar name={me.name || me.email} /></button>}>
      {(close) => (
        <>
          <div style={{ padding: '10px 12px 8px' }}>
            <div style={{ fontWeight: 700 }}>{me.name}</div>
            <div className="muted small">{me.email}</div>
            <div className="small" style={{ marginTop: 6 }}><span className="badge sm">{roleLabel}</span> <span className="muted">· {me.company.name}</span></div>
          </div>
          <div className="sep" />
          <button onClick={() => { close(); nav('/configuracoes'); }}><Settings />Configurações</button>
          <button onClick={() => { close(); nav('/configuracoes/assinatura'); }}><CreditCard />Assinatura e faturas</button>
          <button onClick={() => { close(); nav('/ajuda'); }}><HelpCircle />Ajuda</button>
          <div className="sep" />
          <div className="menu-title">Tema</div>
          {([['auto', 'Automático', Monitor], ['light', 'Claro', Sun], ['dark', 'Escuro', Moon]] as const).map(([v, l, I]) => (
            <button key={v} onClick={() => setTheme(v)}><I />{l}{theme === v && <span className="check-mark">✓</span>}</button>
          ))}
          <div className="sep" />
          {isDemo
            ? <button onClick={async () => { close(); if (canUseRealAccount) leaveDemo(); else { await api.signOut(); qc.clear(); location.hash = '#/entrar'; location.reload(); } }}><LogOut />{canUseRealAccount ? 'Sair da demonstração' : 'Sair'}</button>
            : <button className="danger" onClick={async () => { close(); await api.signOut(); qc.clear(); location.hash = '#/entrar'; location.reload(); }}><LogOut />Sair</button>}
        </>
      )}
    </Menu>
  );
}

const N_ICON: Record<Notification['kind'], [typeof Bell, string, string]> = {
  atendimento: [MessageCircle, 'var(--orange-soft)', 'var(--orange-ink)'],
  agendamento: [CalendarCheck, 'var(--blue-soft)', 'var(--blue-ink)'],
  orcamento: [FileText, 'var(--violet-soft)', 'var(--violet-ink)'],
  venda: [CircleDollarSign, 'var(--green-soft)', 'var(--green-ink)'],
  tarefa: [ClipboardList, 'var(--yellow-soft)', 'var(--yellow-ink)'],
  assinatura: [CreditCard, 'var(--red-soft)', 'var(--red-ink)'],
  sistema: [Bot, 'var(--surface-3)', 'var(--ink-2)'],
  estoque: [Package, 'var(--orange-soft)', 'var(--orange-ink)'],
  financeiro: [Landmark, 'var(--green-soft)', 'var(--green-ink)'],
};

function Notifications() {
  const { data = [] } = useList('notifications', { order: [{ col: 'created_at', asc: false }], limit: 30 });
  const unread = data.filter((n) => !n.read_at).length;
  const inv = useInvalidate();
  const nav = useNavigate();
  const lastCount = useRef(unread);
  // aviso do sistema operacional quando chega algo novo (se a pessoa permitiu)
  useEffect(() => {
    if (unread > lastCount.current && 'Notification' in window && window.Notification.permission === 'granted' && document.hidden) {
      const n = data.find((x) => !x.read_at);
      if (n) new window.Notification(n.title, { body: n.body ?? undefined, icon: '/favicon.svg' });
    }
    lastCount.current = unread;
  }, [unread, data]);
  const markAll = async () => { await Promise.all(data.filter((n) => !n.read_at).map((n) => api.update('notifications', n.id, { read_at: new Date().toISOString() }))); inv('notifications'); };
  const items = useMemo(() => data.slice(0, 20), [data]);
  return (
    <Menu trigger={({ toggle }) => <IconButton label="Avisos" badge={unread || false} onClick={toggle}><Bell /></IconButton>}>
      {(close) => (
        <div className="notif-panel">
          <div className="notif-head">
            <h4>Avisos</h4>
            <div className="row" style={{ gap: 4 }}>
              {'Notification' in window && window.Notification.permission === 'default' && <Button size="sm" variant="ghost" onClick={() => window.Notification.requestPermission()}>Ativar no computador</Button>}
              {unread > 0 && <Button size="sm" variant="ghost" icon={<CheckCheck />} onClick={markAll}>Marcar lidas</Button>}
            </div>
          </div>
          <div className="notif-list">
            {items.length === 0 && <div className="empty" style={{ padding: 24 }}><p>Nenhum aviso por enquanto.</p></div>}
            {items.map((n) => {
              const [I, bg, fg] = N_ICON[n.kind] ?? N_ICON.sistema;
              return (
                <button key={n.id} className={cx('notif', !n.read_at && 'unread')} onClick={async () => { close(); if (!n.read_at) { await api.update('notifications', n.id, { read_at: new Date().toISOString() }); inv('notifications'); } if (n.link) nav(n.link.replace(/^#/, '')); }}>
                  <span className="ni" style={{ background: bg, color: fg }}><I /></span>
                  <span className="grow"><div className="nt">{n.title}</div>{n.body && <div className="nb">{n.body}</div>}<div className="nw">{fmtAgo(n.created_at)}</div></span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Menu>
  );
}
