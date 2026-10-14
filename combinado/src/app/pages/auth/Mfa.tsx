// Segunda etapa do login (quem ativou a verificação em duas etapas): código de 6 números do aplicativo autenticador.
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { api } from '../../data/api';
import { Button, Field, Input } from '../../ui';
import { AuthLayout } from './Auth';
import { disablePush } from '../../pwa';

export default function MfaChallenge() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const qc = useQueryClient();

  const verify = async (value: string) => {
    setErr('');
    if (value.length !== 6) { setErr('Digite os 6 números que aparecem no aplicativo.'); return; }
    setBusy(true);
    try {
      await api.mfaVerify(value);
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setErr((e as Error).message);
      setCode('');
    } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void verify(code); };
  const other = async () => { await disablePush(); await api.signOut(); qc.clear(); location.hash = '#/entrar'; location.reload(); };

  return (
    <AuthLayout>
      <div className="auth-card">
        <span className="auth-sent-ic"><ShieldCheck /></span>
        <h2>Confirme que é você</h2>
        <p className="sub">Sua conta tem verificação em duas etapas. Abra o aplicativo autenticador do seu celular (Google Authenticator, Microsoft Authenticator ou outro) e digite o código da ORBYTA.</p>
        <form onSubmit={submit} noValidate className="auth-form">
          <Field label="Código de 6 números" htmlFor="otp">
            <Input id="otp" className="otp-input" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="000000" value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(v);
                if (v.length === 6 && !busy) void verify(v); // ao completar os 6 números, confirma sozinho
              }} />
          </Field>
          {err && <div className="auth-err" role="alert">{err}</div>}
          <Button type="submit" variant="solid" size="lg" block loading={busy}>Confirmar</Button>
        </form>
        <p className="auth-fine">O código muda a cada 30 segundos. Se não funcionar, confira se a data e a hora do celular estão automáticas. Perdeu o celular? Peça ajuda ao suporte da ORBYTA pelo e-mail da sua conta.</p>
        <button type="button" className="auth-up" onClick={other}><ArrowLeft />Entrar com outra conta</button>
      </div>
    </AuthLayout>
  );
}
