// Primeira configuração: a empresa, o segmento (com serviços de exemplo) e pronto.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Car, Check, HeartPulse, Home, PawPrint, PartyPopper, Scissors, Sparkles, SprayCan, Wrench, GraduationCap, Shapes, LogOut } from 'lucide-react';
import { api } from '../../data/api';
import { Button, Field, Input, PhoneInput, cx } from '../../ui';
import { AuthLayout } from './Auth';
import { PRESETS } from '../../../shared/presets';
import { brl } from '../../../shared/format';

const SEGS: [string, string, typeof Car][] = [['limpeza', 'Limpeza e higienização', SprayCan], ['beleza', 'Beleza e estética', Scissors], ['oficina', 'Oficina mecânica', Car], ['assistencia', 'Assistência técnica', Wrench], ['saude', 'Clínica e consultório', HeartPulse], ['pet', 'Pet shop', PawPrint], ['reformas', 'Reformas', Home], ['eventos', 'Eventos e buffet', PartyPopper], ['educacao', 'Aulas e cursos', GraduationCap], ['outro', 'Outro', Shapes]];

export default function Onboarding() {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState('');
  const [segment, setSegment] = useState('limpeza');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [preset, setPreset] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const finish = async () => {
    setBusy(true); setErr('');
    try { await api.onboard({ company: company.trim(), segment, phone, city: city.trim() || undefined, preset }); await qc.invalidateQueries({ queryKey: ['me'] }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      <div className="auth-card" style={{ width: 'min(560px, 100%)' }}>
        <div className="wizard-steps">{[0, 1, 2].map((i) => <span key={i} className={cx(i <= step && 'on')} />)}</div>
        {step === 0 && (
          <>
            <h2>Sobre a sua empresa</h2>
            <p className="sub">É assim que a IA vai se apresentar para os clientes.</p>
            <form onSubmit={(e) => { e.preventDefault(); if (company.trim().length >= 2) setStep(1); else setErr('Informe o nome da empresa.'); }}>
              <Field label="Nome da empresa"><Input value={company} onChange={(e) => { setCompany(e.target.value); setErr(''); }} autoFocus placeholder="Ex.: Brilho Lar Higienização" /></Field>
              <div className="form-grid">
                <Field label="WhatsApp da empresa" hint="O número que os clientes chamam"><PhoneInput value={phone} onChange={setPhone} /></Field>
                <Field label="Cidade"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
              </div>
              {err && <div className="auth-err">{err}</div>}
              <Button type="submit" variant="solid" size="lg" block icon={<ArrowRight />}>Continuar</Button>
            </form>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Qual é o seu ramo?</h2>
            <p className="sub">Já deixamos uma tabela de serviços de exemplo para a IA começar. Você ajusta os preços depois.</p>
            <div className="seg-grid" style={{ marginTop: 18 }}>{SEGS.map(([v, l, I]) => <button key={v} type="button" className={cx('seg-card', segment === v && 'on')} onClick={() => setSegment(v)}><I />{l}</button>)}</div>
            <div className="mini-list" style={{ marginTop: 16 }}>{PRESETS[segment].slice(0, 4).map((s) => <div key={s.name}><span>{s.name}</span><b>{s.price_type === 'sob_consulta' ? 'sob consulta' : `${s.price_type === 'a_partir_de' ? 'a partir de ' : ''}${brl(s.price)}`}</b></div>)}</div>
            <label className="check small" style={{ marginTop: 12 }}><input type="checkbox" checked={preset} onChange={(e) => setPreset(e.target.checked)} /><span>Começar com estes serviços de exemplo</span></label>
            <div className="row" style={{ marginTop: 18, gap: 10 }}><Button icon={<ArrowLeft />} onClick={() => setStep(0)}>Voltar</Button><Button variant="solid" size="lg" className="grow" icon={<ArrowRight />} onClick={() => setStep(2)}>Continuar</Button></div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Tudo pronto para começar</h2>
            <p className="sub">Seu teste grátis começa agora. Depois de entrar:</p>
            <ul className="auth-points" style={{ marginTop: 16 }}>
              <li><Check />Teste a IA no Simulador do WhatsApp</li>
              <li><Check />Confira os serviços, preços e o horário de funcionamento</li>
              <li><Check />Conecte o número da empresa e verifique o seu</li>
            </ul>
            {err && <div className="auth-err" style={{ marginTop: 14 }}>{err}</div>}
            <div className="row" style={{ marginTop: 22, gap: 10 }}><Button icon={<ArrowLeft />} onClick={() => setStep(1)}>Voltar</Button><Button variant="solid" size="lg" className="grow" loading={busy} icon={<Sparkles />} onClick={finish}>Criar minha empresa</Button></div>
          </>
        )}
        <div className="auth-alt"><button className="link" onClick={async () => { await api.signOut(); location.reload(); }}><LogOut className="ii" /> Sair</button></div>
      </div>
    </AuthLayout>
  );
}
