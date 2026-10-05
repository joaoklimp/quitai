// Proteção contra robôs nas telas de acesso: Cloudflare Turnstile (só aparece com VITE_TURNSTILE_SITE_KEY configurada).
// O token vai junto no cadastro, login, link por e-mail e recuperação de senha; o Supabase confere com a chave secreta.
import { useEffect, useRef } from 'react';

export const CAPTCHA_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || '';
export const CAPTCHA_ON = !!CAPTCHA_SITE_KEY;

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Não consegui carregar a verificação anti-robô.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Caixa "não sou um robô". `resetKey` muda depois de cada tentativa (o token só vale uma vez). */
export function Captcha({ onToken, resetKey }: { onToken: (t: string) => void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!CAPTCHA_ON) return;
    let alive = true;
    loadScript().then(() => {
      if (!alive || !box.current || !window.turnstile) return;
      id.current = window.turnstile.render(box.current, {
        sitekey: CAPTCHA_SITE_KEY, language: 'pt-br', theme: 'auto', appearance: 'interaction-only',
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(''),
        'error-callback': () => cb.current(''),
      });
    }).catch(() => cb.current(''));
    return () => { alive = false; if (id.current) window.turnstile?.remove(id.current); id.current = null; };
  }, []);

  useEffect(() => { if (resetKey && id.current) { cb.current(''); window.turnstile?.reset(id.current); } }, [resetKey]);

  if (!CAPTCHA_ON) return null;
  return <div ref={box} className="auth-captcha" />;
}
