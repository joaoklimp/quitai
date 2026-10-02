// Entrar, criar conta e recuperar senha.
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Sparkles } from 'lucide-react';
import { api, enterDemo } from '../../data/api';
import { Button, Field, Input } from '../../ui';
import { BRAND, wordmarkHtml } from '../../../shared/brand';
import { TRIAL_DAYS } from '../../../shared/plans';

type Mode = 'entrar' | 'cadastro' | 'recuperar';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <a href="/" className="row" aria-label={`${BRAND.name}, página inicial`} dangerouslySetInnerHTML={{ __html: wordmarkHtml(36) }} />
        <div>
          <h1>Sua empresa funcionando <span className="accent">por uma conversa.</span></h1>
          <p>A IA atende seus clientes no WhatsApp, cria orçamentos, marca horários e executa o que você pedir. Você acompanha tudo por aqui.</p>
          <ul className="auth-points">
            <li><Check />{TRIAL_DAYS} dias grátis, sem cartão</li>
            <li><Check />Atendimento 24h com a sua tabela de preços</li>
            <li><Check />Ações sensíveis sempre com a sua confirmação</li>
          </ul>
        </div>
        <span className="foot small" style={{ color: '#26324A' }}>© {new Date().getFullYear()} {BRAND.name}</span>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}

export default function Auth() {
  const loc = useLocation();
  const initial: Mode = loc.pathname.includes('cadastro') || new URLSearchParams(location.search).has('cadastro') ? 'cadastro' : loc.pathname.includes('recuperar') ? 'recuperar' : 'entrar';
  const [mode, setMode] = useState<Mode>(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [accept, setAccept] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setOk('');
    if (mode !== 'recuperar' && !/\S+@\S+\.\S+/.test(email)) { setErr('Informe um e-mail válido.'); return; }
    if (mode === 'cadastro') {
      if (name.trim().length < 2) { setErr('Informe seu nome.'); return; }
      if (pw.length < 8) { setErr('A senha precisa ter pelo menos 8 caracteres.'); return; }
      if (!accept) { setErr('Aceite os termos de uso e a política de privacidade para continuar.'); return; }
    }
    setBusy(true);
    try {
      if (mode === 'entrar') { await api.signIn(email, pw); await qc.invalidateQueries({ queryKey: ['me'] }); nav('/'); }
      else if (mode === 'cadastro') {
        const r = await api.signUp({ name, email, password: pw });
        if (r.needsConfirmation) setOk(`Quase lá! Enviamos um link de confirmação para ${email}. Abra o e-mail para ativar sua conta (confira o spam).`);
        else { await qc.invalidateQueries({ queryKey: ['me'] }); nav('/'); }
      } else { await api.requestPasswordReset(email); setOk('Se houver uma conta com esse e-mail, você vai receber um link para criar uma nova senha.'); }
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <div className="auth-card">
        <h2>{mode === 'entrar' ? 'Entrar' : mode === 'cadastro' ? 'Comece grátis' : 'Recuperar senha'}</h2>
        <p className="sub">{mode === 'entrar' ? 'Que bom te ver de novo.' : mode === 'cadastro' ? `${TRIAL_DAYS} dias com tudo liberado. Sem cartão.` : 'Mandamos um link para o seu e-mail.'}</p>
        <form onSubmit={submit} noValidate>
          {mode === 'cadastro' && <Field label="Seu nome" htmlFor="n"><Input id="n" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus /></Field>}
          <Field label="E-mail" htmlFor="e"><Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus={mode !== 'cadastro'} /></Field>
          {mode !== 'recuperar' && (
            <Field label="Senha" htmlFor="p" hint={mode === 'cadastro' ? 'Pelo menos 8 caracteres' : undefined}>
              <div className="input-wrap"><Input id="p" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'cadastro' ? 'new-password' : 'current-password'} style={{ paddingRight: 44 }} />
                <button type="button" className="icon-btn xs" style={{ position: 'absolute', right: 8 }} onClick={() => setShow((v) => !v)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>{show ? <EyeOff /> : <Eye />}</button></div>
            </Field>
          )}
          {mode === 'cadastro' && <label className="check small"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /><span>Li e aceito os <a className="link" href="/termos/" target="_blank" rel="noreferrer">termos de uso</a> e a <a className="link" href="/privacidade/" target="_blank" rel="noreferrer">política de privacidade</a>.</span></label>}
          {err && <div className="auth-err" role="alert">{err}</div>}
          {ok && <div className="auth-ok" role="status">{ok}</div>}
          <Button type="submit" variant="solid" size="lg" block loading={busy}>{mode === 'entrar' ? 'Entrar' : mode === 'cadastro' ? 'Criar minha conta' : 'Enviar link'}</Button>
        </form>
        <div className="auth-alt">
          {mode === 'entrar' && <><button className="link" onClick={() => { setMode('recuperar'); setErr(''); setOk(''); }}>Esqueci minha senha</button><br /><span>Ainda não tem conta? <button className="link" onClick={() => { setMode('cadastro'); setErr(''); setOk(''); }}>Comece grátis</button></span></>}
          {mode !== 'entrar' && <span>Já tem conta? <button className="link" onClick={() => { setMode('entrar'); setErr(''); setOk(''); }}>Entrar</button></span>}
        </div>
        <div className="divider" />
        <Button block icon={<Sparkles />} onClick={enterDemo}>Ver a demonstração sem cadastro</Button>
      </div>
    </AuthLayout>
  );
}
