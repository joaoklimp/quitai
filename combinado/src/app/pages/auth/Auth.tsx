// Entrar, criar conta, link de acesso por e-mail e recuperar senha. Login social com Google e Microsoft.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { api, enterDemo, isDemo } from '../../data/api';
import type { AuthProvider } from '../../data/source';
import { Button, Field, Input, cx } from '../../ui';
import { BRAND, wordmarkHtml } from '../../../shared/brand';
import { TRIAL_DAYS } from '../../../shared/plans';
import { ENABLED_PROVIDERS, PROVIDER_LABEL, ProviderIcon } from './providers';

type Mode = 'entrar' | 'cadastro' | 'recuperar' | 'link';

/** Moldura das telas de acesso: painel da marca à esquerda e o formulário à direita. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="auth-side-glow" aria-hidden="true" />
        <a href="/" className="auth-brand" aria-label={`${BRAND.name}, página inicial`} dangerouslySetInnerHTML={{ __html: wordmarkHtml(30) }} />
        <div className="auth-pitch">
          <span className="auth-eyebrow"><Sparkles />Gestão empresarial com IA que executa</span>
          <h1>Sua empresa inteira, <em>numa conversa.</em></h1>
          <p>Peça pelo WhatsApp ou pelo painel e a {BRAND.name} faz: atende pacientes, monta orçamentos, organiza a agenda, cobra e cuida do caixa.</p>
          <div className="auth-demo" aria-hidden="true">
            <div className="ad-msg me">Cadastra a Maria e manda um orçamento de R$ 350 pra ela</div>
            <div className="ad-msg ai"><b><Sparkles />{BRAND.name}</b>Pronto! Já fiz tudo isso:</div>
            <div className="ad-receipt">
              <span><i><Check /></i>Paciente Maria cadastrada</span>
              <span><i><Check /></i>Orçamento nº 0419 de R$ 350,00</span>
              <span><i><Check /></i>Link enviado no WhatsApp</span>
            </div>
          </div>
        </div>
        <ul className="auth-trust">
          <li><ShieldCheck /><span><b>Seus dados protegidos</b>Cada empresa isolada no banco, de acordo com a LGPD</span></li>
          <li><Zap /><span><b>{TRIAL_DAYS} dias grátis</b>Tudo liberado, sem cartão de crédito</span></li>
        </ul>
        <div className="auth-legal">
          <span>© {new Date().getFullYear()} {BRAND.name}</span>
          <a href="/termos/">Termos</a><a href="/privacidade/">Privacidade</a><a href="/seguranca/">Segurança</a>
        </div>
      </aside>
      <main className="auth-main">
        <a className="auth-back" href="/"><ArrowLeft />Voltar ao site</a>
        <a href="/" className="auth-brand-m" aria-label={`${BRAND.name}, página inicial`} dangerouslySetInnerHTML={{ __html: wordmarkHtml(26) }} />
        {children}
      </main>
    </div>
  );
}

function strength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) && pw.length >= 10) s++;
  const score = (pw.length < 8 ? 0 : Math.min(3, s)) as 0 | 1 | 2 | 3;
  return { score, label: pw.length < 8 ? 'Curta demais' : ['Fraca', 'Razoável', 'Boa', 'Forte'][score] };
}

export default function Auth() {
  const loc = useLocation();
  const initial: Mode = loc.pathname.includes('cadastro') || new URLSearchParams(location.search).has('cadastro') ? 'cadastro' : loc.pathname.includes('recuperar') ? 'recuperar' : 'entrar';
  const [mode, setModeRaw] = useState<Mode>(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<AuthProvider | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [sentLink, setSentLink] = useState(false);
  const [accept, setAccept] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const st = strength(pw);

  const setMode = (m: Mode) => { setModeRaw(m); setErr(''); setOk(''); setSentLink(false); nav(m === 'cadastro' ? '/cadastro' : m === 'recuperar' ? '/recuperar' : '/entrar', { replace: true }); };
  useEffect(() => { document.title = `${mode === 'cadastro' ? 'Criar conta' : mode === 'recuperar' ? 'Recuperar senha' : 'Entrar'} · ${BRAND.name}`; }, [mode]);

  const enter = async () => { await qc.invalidateQueries({ queryKey: ['me'] }); nav('/', { replace: true }); };

  const social = async (p: AuthProvider) => {
    setErr(''); setOk('');
    if (mode === 'cadastro' && !accept) { setErr('Aceite os termos de uso e a política de privacidade para continuar.'); return; }
    setProvider(p);
    try { await api.signInWithProvider(p, mode === 'cadastro' ? 'cadastro' : 'entrar'); if (isDemo) await enter(); }
    catch (e) { setErr((e as Error).message); setProvider(null); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setOk('');
    if (!/\S+@\S+\.\S+/.test(email)) { setErr('Informe um e-mail válido.'); return; }
    if (mode === 'cadastro') {
      if (name.trim().length < 2) { setErr('Informe seu nome.'); return; }
      if (pw.length < 8) { setErr('A senha precisa ter pelo menos 8 caracteres.'); return; }
      if (!accept) { setErr('Aceite os termos de uso e a política de privacidade para continuar.'); return; }
    }
    if (mode === 'entrar' && !pw) { setErr('Digite sua senha.'); return; }
    setBusy(true);
    try {
      if (mode === 'entrar') { await api.signIn(email, pw); await enter(); }
      else if (mode === 'cadastro') {
        const r = await api.signUp({ name, email, password: pw });
        if (r.needsConfirmation) setOk(`Quase lá! Enviamos um link de confirmação para ${email}. Abra o e-mail para ativar sua conta (confira também o spam).`);
        else await enter();
      } else if (mode === 'link') { await api.signInWithEmailLink(email); setSentLink(true); setOk(`Enviamos um link de acesso para ${email}. Abra no celular ou no computador: ele vale por 1 hora.`); }
      else { await api.requestPasswordReset(email); setOk('Se houver uma conta com esse e-mail, você vai receber um link para criar uma nova senha.'); }
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  const title = { entrar: 'Entrar na sua conta', cadastro: 'Crie sua conta grátis', recuperar: 'Recuperar a senha', link: 'Entrar sem senha' }[mode];
  const sub = {
    entrar: 'Que bom te ver de novo.',
    cadastro: `${TRIAL_DAYS} dias com tudo liberado. Sem cartão de crédito.`,
    recuperar: 'Informe seu e-mail e mandamos um link para criar uma nova senha.',
    link: 'Mandamos um link para o seu e-mail. É só clicar para entrar.',
  }[mode];

  return (
    <AuthLayout>
      <div className="auth-card">
        {isDemo && <div className="auth-vitrine"><Sparkles /><span><b>Vitrine da {BRAND.name}.</b> O acesso aqui é simulado: entre com qualquer e-mail ou pelos botões e conheça o painel.</span></div>}
        {(mode === 'entrar' || mode === 'cadastro') && (
          <div className="auth-tabs" role="tablist" aria-label="Acesso">
            <button role="tab" aria-selected={mode === 'entrar'} className={cx(mode === 'entrar' && 'on')} onClick={() => setMode('entrar')}>Entrar</button>
            <button role="tab" aria-selected={mode === 'cadastro'} className={cx(mode === 'cadastro' && 'on')} onClick={() => setMode('cadastro')}>Criar conta</button>
          </div>
        )}
        {(mode === 'recuperar' || mode === 'link') && <button className="auth-up" onClick={() => setMode('entrar')}><ArrowLeft />Voltar para entrar</button>}
        <h2>{title}</h2>
        <p className="sub">{sub}</p>

        {(mode === 'entrar' || mode === 'cadastro') && ENABLED_PROVIDERS.length > 0 && (
          <>
            <div className="auth-social">
              {ENABLED_PROVIDERS.map((p) => (
                <button key={p} type="button" className={cx('social-btn', p)} onClick={() => social(p)} disabled={!!provider || busy} aria-busy={provider === p || undefined}>
                  {provider === p ? <span className="spin" aria-hidden="true" /> : <ProviderIcon provider={p} />}
                  <span>{mode === 'cadastro' ? 'Criar conta' : 'Continuar'} com {PROVIDER_LABEL[p]}</span>
                </button>
              ))}
            </div>
            <div className="auth-or"><span>ou com seu e-mail</span></div>
          </>
        )}

        {sentLink ? (
          <div className="auth-sent">
            <span className="auth-sent-ic"><Mail /></span>
            <div className="auth-ok" role="status">{ok}</div>
            {isDemo && <Button variant="solid" size="lg" block icon={<Check />} onClick={async () => { setBusy(true); try { await api.signIn(email, ''); await enter(); } finally { setBusy(false); } }} loading={busy}>Abrir o link (simulação)</Button>}
            <Button variant="ghost" block onClick={() => { setSentLink(false); setOk(''); }}>Usar outro e-mail</Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="auth-form">
            {mode === 'cadastro' && <Field label="Seu nome" htmlFor="n"><Input id="n" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Como quer ser chamado" /></Field>}
            <Field label={mode === 'cadastro' ? 'E-mail de trabalho' : 'E-mail'} htmlFor="e"><Input id="e" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="voce@suaempresa.com.br" autoFocus={mode !== 'cadastro'} /></Field>
            {(mode === 'entrar' || mode === 'cadastro') && (
              <div className="field">
                <div className="row between"><label htmlFor="p">Senha</label>{mode === 'entrar' && <button type="button" className="link small" onClick={() => setMode('recuperar')}>Esqueci a senha</button>}</div>
                <div className="pw-wrap"><Input id="p" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'cadastro' ? 'new-password' : 'current-password'} placeholder={mode === 'cadastro' ? 'Pelo menos 8 caracteres' : ''} style={{ paddingRight: 44 }} />
                  <button type="button" className="icon-btn xs" style={{ position: 'absolute', right: 8 }} onClick={() => setShow((v) => !v)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>{show ? <EyeOff /> : <Eye />}</button></div>
                {mode === 'cadastro' && pw && <div className={cx('pw-meter', `s${st.score}`)} aria-live="polite"><i /><i /><i /><span>{st.label}</span></div>}
              </div>
            )}
            {mode === 'cadastro' && <label className="check small"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /><span>Li e aceito os <a className="link" href="/termos/" target="_blank" rel="noreferrer">termos de uso</a> e a <a className="link" href="/privacidade/" target="_blank" rel="noreferrer">política de privacidade</a>.</span></label>}
            {err && <div className="auth-err" role="alert">{err}</div>}
            {ok && <div className="auth-ok" role="status">{ok}</div>}
            <Button type="submit" variant="solid" size="lg" block loading={busy}>{{ entrar: 'Entrar', cadastro: 'Criar minha conta', recuperar: 'Enviar link', link: 'Enviar link de acesso' }[mode]}</Button>
            {mode === 'entrar' && <button type="button" className="auth-magic" onClick={() => setMode('link')}><Mail />Receber um link de acesso por e-mail</button>}
          </form>
        )}

        {mode === 'cadastro' && ENABLED_PROVIDERS.length > 0 && <p className="auth-fine">Ao criar a conta com {ENABLED_PROVIDERS.map((p) => PROVIDER_LABEL[p]).join(', ').replace(/, ([^,]*)$/, ' ou $1')}, você também precisa aceitar os termos acima.</p>}
        <div className="auth-foot">
          <button type="button" className="auth-demo-btn" onClick={enterDemo}><Sparkles />{isDemo ? 'Entrar direto na empresa de exemplo' : 'Ver a demonstração sem cadastro'}</button>
          <span className="auth-secure"><Lock />Conexão criptografada · Dados protegidos pela LGPD</span>
        </div>
      </div>
    </AuthLayout>
  );
}
