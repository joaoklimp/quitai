// App instalável e notificações no aparelho: service worker, convite para instalar e inscrição para receber avisos.
import { useEffect, useReducer } from 'react';
import { api, isDemo } from './data/api';

const FLAG = 'orbyta-push'; // id da pessoa que ativou as notificações neste aparelho

export const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
export const pushSupported = swSupported && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export type BrowserKind = 'chrome' | 'edge' | 'opera' | 'samsung' | 'firefox' | 'safari' | 'other';
export type OsKind = 'android' | 'ios' | 'mac' | 'windows' | 'linux' | 'other';
/** Navegador e sistema, para mostrar o passo a passo certo de instalação. */
export function browserInfo(): { browser: BrowserKind; os: OsKind } {
  if (typeof navigator === 'undefined') return { browser: 'other', os: 'other' };
  const ua = navigator.userAgent;
  const os: OsKind = isIOS() ? 'ios' : /Android/i.test(ua) ? 'android' : /Windows/i.test(ua) ? 'windows' : /Mac OS X|Macintosh/i.test(ua) ? 'mac' : /Linux|CrOS/i.test(ua) ? 'linux' : 'other';
  const browser: BrowserKind = /Edg(A|iOS)?\//.test(ua) ? 'edge' : /OPR\/|Opera/.test(ua) ? 'opera' : /SamsungBrowser/.test(ua) ? 'samsung'
    : /Firefox\/|FxiOS/.test(ua) ? 'firefox' : /Chrome\/|CriOS/.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  return { browser, os };
}
/** O navegador deste computador instala apps? (Chrome, Edge e Opera instalam; Safari no Mac adiciona ao Dock; Firefox não.) */
export function desktopCanInstall(): boolean {
  const { browser, os } = browserInfo();
  if (os === 'android' || os === 'ios') return false;
  return browser === 'chrome' || browser === 'edge' || browser === 'opera' || (browser === 'safari' && os === 'mac');
}

/** Nome amigável do aparelho para a lista de aparelhos (ex.: "iPhone · Safari"). */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${os} · ${br}${isStandalone() ? ' (app)' : ''}`;
}

/* ---------- service worker ---------- */
let reg: Promise<ServiceWorkerRegistration | null> | null = null;
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported || import.meta.env.DEV) return Promise.resolve(null);
  reg ??= navigator.serviceWorker.register('/sw.js', { scope: '/app/', updateViaCache: 'none' }).catch(() => null);
  return reg;
}

/** Mensagens do service worker: clique numa notificação abre a tela certa do painel. */
export function onServiceWorkerMessage(open: (link: string) => void, pushed: () => void): () => void {
  if (!swSupported) return () => {};
  const h = (e: MessageEvent) => {
    const d = e.data as { type?: string; link?: string } | null;
    if (d?.type === 'orbyta-open' && typeof d.link === 'string' && d.link.startsWith('#/')) open(d.link);
    if (d?.type === 'orbyta-push') pushed();
  };
  navigator.serviceWorker.addEventListener('message', h);
  return () => navigator.serviceWorker.removeEventListener('message', h);
}

/* ---------- instalar ---------- */
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: InstallEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const ping = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  // o navegador avisa logo ao abrir a página: guardamos o convite para o botão "Instalar"
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; ping(); });
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; ping(); });
}

export function useInstall() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return {
    installed: installedNow || isStandalone(),
    canPrompt: !!deferred,
    ios: isIOS(),
    android: isAndroid(),
    async prompt(): Promise<boolean> {
      if (!deferred) return false;
      const ev = deferred;
      deferred = null;
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      ping();
      return outcome === 'accepted';
    },
  };
}

/* ---------- notificações ---------- */
export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const readFlag = () => { try { return localStorage.getItem(FLAG); } catch { return null; } };
const writeFlag = (v: string | null) => { try { if (v) localStorage.setItem(FLAG, v); else localStorage.removeItem(FLAG); } catch { /* ignora */ } };

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const t = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}
function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export async function pushState(userId: string): Promise<PushState> {
  if (!pushSupported) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted' || readFlag() !== userId) return 'off';
  const r = await registerServiceWorker();
  if (!r) return isDemo ? 'on' : 'off';
  return (await r.pushManager.getSubscription()) || isDemo ? 'on' : 'off';
}

async function subscribeHere(r: ServiceWorkerRegistration): Promise<void> {
  const { publicKey } = await api.push<{ publicKey: string }>('config');
  const key = keyBytes(publicKey);
  let sub = await r.pushManager.getSubscription();
  // chave do servidor mudou: inscrição antiga não serve mais
  if (sub && !sameKey(sub.options.applicationServerKey, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.push('subscribe', { subscription: sub.toJSON(), device: deviceLabel() });
}

/** Ativa neste aparelho. Precisa ser chamado direto no clique (o Safari exige). */
export async function enablePush(userId: string): Promise<void> {
  if (!pushSupported) throw new Error(isIOS() && !isStandalone() ? 'No iPhone, instale o app primeiro (Compartilhar → Adicionar à Tela de Início) e ative por lá.' : 'Este navegador não recebe notificações. Use o Chrome, Edge, Firefox ou Safari atualizado.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador (ícone de cadeado ao lado do endereço).' : 'Você não permitiu as notificações. Tente de novo quando quiser.');
  const r = await registerServiceWorker();
  if (r && !isDemo) {
    await navigator.serviceWorker.ready;
    await subscribeHere(r);
  }
  writeFlag(userId);
}

/** Desativa neste aparelho (também chamado ao sair da conta: aparelho deslogado não recebe nada). */
export async function disablePush(): Promise<void> {
  writeFlag(null);
  if (!swSupported) return;
  try {
    const r = await navigator.serviceWorker.getRegistration('/app/');
    const sub = await r?.pushManager.getSubscription();
    if (!sub) return;
    if (!isDemo) await api.push('unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch { /* sem service worker: nada a desfazer */ }
}

/** Endereço deste aparelho (para manter só ele ao desconectar os outros). */
export async function currentEndpoint(): Promise<string | null> {
  if (!swSupported) return null;
  try { return (await (await navigator.serviceWorker.getRegistration('/app/'))?.pushManager.getSubscription())?.endpoint ?? null; } catch { return null; }
}

/** Ao abrir o painel: confirma a inscrição deste aparelho com o servidor (o navegador pode trocá-la sozinho). */
export async function syncPush(userId: string): Promise<void> {
  if (!pushSupported || isDemo || readFlag() !== userId || Notification.permission !== 'granted') return;
  try { const r = await registerServiceWorker(); if (r) await subscribeHere(r); } catch { /* tenta de novo na próxima abertura */ }
}

/** Aviso do sistema quando o painel está aberto em segundo plano e o aparelho não recebe notificações push. */
export async function localNotify(title: string, body?: string | null, link?: string | null): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body: body ?? undefined, icon: '/icon-192.png', badge: '/badge-96.png', data: { link: link || '#/' } };
  try {
    const r = swSupported ? await navigator.serviceWorker.getRegistration('/app/') : undefined;
    if (r) { await r.showNotification(title, opts); return; }
    new window.Notification(title, opts); // o Android não aceita este jeito: por isso o service worker vem antes
  } catch { /* aviso é bônus: nunca derruba o painel */ }
}

/** Número de avisos não lidos no ícone do app instalado. */
export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { if (n > 0) void nav.setAppBadge?.(n)?.catch(() => {}); else void nav.clearAppBadge?.()?.catch(() => {}); } catch { /* sem suporte */ }
}

/* ---------- versão nova publicada ---------- */
// Depois de uma atualização, partes antigas do painel deixam de existir no servidor: recarrega uma vez em vez de quebrar.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => {
    try {
      const last = Number(sessionStorage.getItem('orbyta-reload') || 0);
      if (Date.now() - last < 30_000) return; // já tentou agora há pouco: deixa a tela de erro aparecer
      sessionStorage.setItem('orbyta-reload', String(Date.now()));
    } catch { /* sem armazenamento: recarrega mesmo assim */ }
    e.preventDefault();
    location.reload();
  });
}
