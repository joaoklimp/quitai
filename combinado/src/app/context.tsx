// Contextos do painel: usuário logado, assistente (gaveta da IA) e tema.
import type { ModuleKey } from './data/types';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from './data/types';

export const MeContext = createContext<{ me: Me; refresh: () => void } | null>(null);
export function useMeCtx() {
  const v = useContext(MeContext);
  if (!v) throw new Error('MeContext ausente');
  return v;
}
export const can = (me: Me, ...roles: Me['role'][]) => roles.includes(me.role);
/** Módulo opcional ligado na empresa (estoque, cobranças e notas). */
export const hasModule = (me: Me, key: ModuleKey) => (me.company?.modules ?? []).includes(key);

/* gaveta do assistente (comandos para a IA) */
interface AssistantState { open: boolean; setOpen: (v: boolean) => void; prefill: string | null; ask: (text?: string) => void; clearPrefill: () => void }
const AssistantCtx = createContext<AssistantState>({ open: false, setOpen: () => {}, prefill: null, ask: () => {}, clearPrefill: () => {} });
export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const ask = useCallback((text?: string) => { if (text) setPrefill(text); setOpen(true); }, []);
  const clearPrefill = useCallback(() => setPrefill(null), []);
  return <AssistantCtx.Provider value={{ open, setOpen, prefill, ask, clearPrefill }}>{children}</AssistantCtx.Provider>;
}
export const useAssistant = () => useContext(AssistantCtx);

/* tema claro / escuro / automático */
export type ThemePref = 'auto' | 'light' | 'dark';
const THEME_KEY = 'orbyta-tema';
export function readTheme(): ThemePref { try { return (localStorage.getItem(THEME_KEY) as ThemePref) || 'auto'; } catch { return 'auto'; } }
export function applyTheme(t: ThemePref) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignora */ }
}
export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [t, setT] = useState<ThemePref>(readTheme);
  useEffect(() => { applyTheme(t); }, [t]);
  return [t, setT];
}
