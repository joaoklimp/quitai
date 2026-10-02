// Nova senha (link do e-mail de recuperação ou do convite da equipe).
import { useState, type FormEvent } from 'react';
import { api } from '../../data/api';
import { Button, Field, Input } from '../../ui';
import { AuthLayout } from './Auth';

export default function NewPassword() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (pw.length < 8) { setErr('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (pw !== pw2) { setErr('As senhas não são iguais.'); return; }
    setBusy(true);
    try { await api.updatePassword(pw); setDone(true); setTimeout(() => { location.hash = '#/'; location.reload(); }, 1200); }
    catch (e2) { setErr((e2 as Error).message || 'O link expirou. Peça um novo em “Esqueci minha senha”.'); } finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      <div className="auth-card">
        <h2>Criar nova senha</h2>
        <p className="sub">Escolha uma senha para entrar no painel.</p>
        <form onSubmit={submit}>
          <Field label="Nova senha"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus /></Field>
          <Field label="Repita a senha"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          {err && <div className="auth-err" role="alert">{err}</div>}
          {done && <div className="auth-ok" role="status">Senha criada! Entrando…</div>}
          <Button type="submit" variant="solid" size="lg" block loading={busy}>Salvar senha</Button>
        </form>
      </div>
    </AuthLayout>
  );
}
