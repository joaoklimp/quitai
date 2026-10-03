// Primeira configuração: a clínica, a especialidade (com procedimentos de exemplo) e pronto.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, Apple, ArrowLeft, ArrowRight, Brain, Check, HeartPulse, LogOut, Package, ReceiptText, Smile, Sparkles, Stethoscope, Users } from 'lucide-react';
import type { ModuleKey } from '../../data/types';
import { api } from '../../data/api';
import { Button, Field, Input, PhoneInput, Switch, cx } from '../../ui';
import { AuthLayout } from './Auth';
import { presetsFor, type Specialty } from '../../../shared/presets';
import { brl } from '../../../shared/format';

const SEGS: [Specialty, string, typeof Smile][] = [['clinica_medica', 'Clínica médica e consultório', Stethoscope], ['odontologia', 'Odontologia', Smile], ['estetica', 'Estética e dermatologia', Sparkles], ['fisioterapia', 'Fisioterapia e pilates', Activity], ['psicologia', 'Psicologia', Brain], ['nutricao', 'Nutrição', Apple], ['multidisciplinar', 'Clínica multidisciplinar', Users]];

export default function Onboarding() {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState('');
  const [segment, setSegment] = useState<Specialty>('odontologia');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [preset, setPreset] = useState(true);
  const [modules, setModules] = useState<ModuleKey[] | null>(null); // null = sugestão do ramo
  const chosen = modules ?? suggestedModules(segment);
  const toggleMod = (k: ModuleKey, on: boolean) => setModules(on ? [...new Set([...chosen, k])] : chosen.filter((x) => x !== k));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const finish = async () => {
    setBusy(true); setErr('');
    try { await api.onboard({ company: company.trim(), segment, phone, city: city.trim() || undefined, preset, modules: chosen }); await qc.invalidateQueries({ queryKey: ['me'] }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      <div className="auth-card" style={{ width: 'min(560px, 100%)' }}>
        <div className="wizard-steps">{[0, 1, 2].map((i) => <span key={i} className={cx(i <= step && 'on')} />)}</div>
        {step === 0 && (
          <>
            <h2>Sobre a sua clínica</h2>
            <p className="sub">É assim que a secretária virtual vai se apresentar para os pacientes.</p>
            <form onSubmit={(e) => { e.preventDefault(); if (company.trim().length >= 2) setStep(1); else setErr('Informe o nome da clínica.'); }}>
              <Field label="Nome da clínica"><Input value={company} onChange={(e) => { setCompany(e.target.value); setErr(''); }} autoFocus placeholder="Ex.: Vida Plena Odontologia" /></Field>
              <div className="form-grid">
                <Field label="WhatsApp da clínica" hint="O número que os pacientes chamam"><PhoneInput value={phone} onChange={setPhone} /></Field>
                <Field label="Cidade"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
              </div>
              {err && <div className="auth-err">{err}</div>}
              <Button type="submit" variant="solid" size="lg" block icon={<ArrowRight />}>Continuar</Button>
            </form>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Qual é a especialidade?</h2>
            <p className="sub">Já deixamos procedimentos de exemplo, com o prazo de retorno, para a IA começar. Você ajusta os valores depois.</p>
            <div className="seg-grid" style={{ marginTop: 18 }}>{SEGS.map(([v, l, I]) => <button key={v} type="button" className={cx('seg-card', segment === v && 'on')} onClick={() => setSegment(v)}><I />{l}</button>)}</div>
            <div className="mini-list" style={{ marginTop: 16 }}>{presetsFor(segment).slice(0, 4).map((s) => <div key={s.name}><span>{s.name}</span><b>{s.price_type === 'sob_consulta' ? 'sob consulta' : `${s.price_type === 'a_partir_de' ? 'a partir de ' : ''}${brl(s.price)}`}</b></div>)}</div>
            <label className="check small" style={{ marginTop: 12 }}><input type="checkbox" checked={preset} onChange={(e) => setPreset(e.target.checked)} /><span>Começar com estes procedimentos de exemplo</span></label>
            <div className="onb-mods">
              <b>O que mais você quer usar?</b>
              <span className="muted small">Atendimento, agenda dos profissionais, pacientes, orçamentos e financeiro já vêm ligados. Você muda isso quando quiser em Módulos.</span>
              <label className="onb-mod"><span className="om-ic"><Package /></span><span className="grow"><b>Estoque de materiais</b><span className="muted small">Materiais e descartáveis, entradas, saídas e aviso de reposição</span></span><Switch checked={chosen.includes('estoque')} onChange={(v) => toggleMod('estoque', v)} label="Estoque" /></label>
              <label className="onb-mod"><span className="om-ic"><ReceiptText /></span><span className="grow"><b>Cobrança e nota fiscal</b><span className="muted small">Pix e boleto no WhatsApp, baixa sozinha e NFS-e</span></span><Switch checked={chosen.includes('cobrancas')} onChange={(v) => toggleMod('cobrancas', v)} label="Cobrança e nota fiscal" /></label>
            </div>
            <div className="row" style={{ marginTop: 18, gap: 10 }}><Button icon={<ArrowLeft />} onClick={() => setStep(0)}>Voltar</Button><Button variant="solid" size="lg" className="grow" icon={<ArrowRight />} onClick={() => setStep(2)}>Continuar</Button></div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Tudo pronto para começar</h2>
            <p className="sub">Seu teste grátis começa agora. Depois de entrar:</p>
            <ul className="auth-points" style={{ marginTop: 16 }}>
              <li><Check />Cadastre os profissionais e o horário de cada um (você já entra como o primeiro)</li>
              <li><Check />Confira os procedimentos, valores e os convênios aceitos</li>
              <li><Check />Teste a secretária no Simulador e conecte o WhatsApp da clínica</li>
            </ul>
            {err && <div className="auth-err" style={{ marginTop: 14 }}>{err}</div>}
            <div className="row" style={{ marginTop: 22, gap: 10 }}><Button icon={<ArrowLeft />} onClick={() => setStep(1)}>Voltar</Button><Button variant="solid" size="lg" className="grow" loading={busy} icon={<HeartPulse />} onClick={finish}>Criar minha clínica</Button></div>
          </>
        )}
        <div className="auth-alt"><button className="link" onClick={async () => { await api.signOut(); location.reload(); }}><LogOut className="ii" /> Sair</button></div>
      </div>
    </AuthLayout>
  );
}

/** Sugestão de módulos: quem usa muito material (odontologia, estética) começa com o estoque ligado. */
function suggestedModules(segment: string): ModuleKey[] {
  return ['odontologia', 'estetica'].includes(segment) ? ['estoque', 'cobrancas'] : ['cobrancas'];
}
