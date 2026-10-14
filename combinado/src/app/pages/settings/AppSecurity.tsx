// Configurações → "App e notificações" (instalar, avisos no aparelho, o que avisar, privacidade da tela bloqueada)
// e "Segurança" (senha, verificação em duas etapas e aparelhos conectados).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, BellOff, Check, Copy, Download, KeyRound, LogOut, MonitorSmartphone, Plus, Send, Share, ShieldCheck, Smartphone, SquarePlus, Trash2, Lock } from 'lucide-react';
import { api, isDemo } from '../../data/api';
import type { MfaEnrollment, PushPrefs } from '../../data/source';
import { useMeCtx, can, hasModule } from '../../context';
import { Badge, Button, Field, Input, Loader, Modal, Switch, useConfirm, useToast } from '../../ui';
import { fmtDate } from '../../../shared/format';
import { currentEndpoint, disablePush, enablePush, pushState, useInstall, type PushState } from '../../pwa';

type Kind = 'atendimento' | 'agendamento' | 'orcamento' | 'tarefa' | 'venda' | 'financeiro' | 'assinatura' | 'estoque' | 'sistema';
const KINDS: { kind: Kind; title: string; text: string; managers?: boolean; module?: 'estoque' }[] = [
  { kind: 'atendimento', title: 'Paciente precisa de você', text: 'Quando a IA passa a conversa para a equipe ou o paciente pede para falar com alguém.' },
  { kind: 'agendamento', title: 'Agenda', text: 'Consultas marcadas, remarcadas ou desmarcadas e encaixes da lista de espera.' },
  { kind: 'orcamento', title: 'Orçamentos', text: 'Quando o paciente aprova ou recusa um orçamento.' },
  { kind: 'tarefa', title: 'Lembretes de tarefas', text: 'No horário que você marcou.' },
  { kind: 'venda', title: 'Pagamentos recebidos', text: 'Cobranças pagas por Pix, boleto ou cartão.', managers: true },
  { kind: 'financeiro', title: 'Notas fiscais', text: 'Nota autorizada ou recusada pela prefeitura.', managers: true },
  { kind: 'assinatura', title: 'Assinatura da ORBYTA', text: 'Faturas, fim do teste grátis e limite de uso da IA.', managers: true },
  { kind: 'estoque', title: 'Estoque baixo', text: 'Quando um material chega no mínimo.', module: 'estoque' },
  { kind: 'sistema', title: 'Avisos da ORBYTA', text: 'Resumo da semana e novidades importantes.' },
];

/* ================= App e notificações ================= */
export function AppTab() {
  const { me } = useMeCtx();
  const toast = useToast();
  const inst = useInstall();
  const qc = useQueryClient();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cfg = useQuery({ queryKey: ['push-config'], queryFn: () => api.push<{ prefs: PushPrefs; devices: number }>('config'), staleTime: 60_000 });
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  useEffect(() => { void pushState(me.user_id).then(setState); }, [me.user_id]);
  useEffect(() => { if (cfg.data) setPrefs(cfg.data.prefs); }, [cfg.data]);
  const manager = can(me, 'dono', 'gerente');

  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); } };
  const turnOn = () => run('on', async () => { await enablePush(me.user_id); setState('on'); void qc.invalidateQueries({ queryKey: ['push-config'] }); toast('Notificações ativadas neste aparelho'); });
  const turnOff = () => run('off', async () => { await disablePush(); setState('off'); void qc.invalidateQueries({ queryKey: ['push-config'] }); toast('Notificações desativadas neste aparelho'); });
  const test = () => run('test', async () => {
    const r = await api.push<{ sent: number }>('test', { endpoint: (await currentEndpoint()) ?? '' });
    toast(r.sent ? 'Enviamos um aviso de teste. Ele chega em alguns segundos.' : 'Não consegui entregar o teste. Desative e ative de novo.', r.sent ? 'ok' : 'err');
  });
  const savePrefs = (patch: Partial<PushPrefs>) => run('prefs', async () => {
    const next = { ...(prefs ?? { muted: [], details: false }), ...patch };
    setPrefs(next);
    const r = await api.push<{ prefs: PushPrefs }>('prefs', patch);
    setPrefs(r.prefs);
    qc.setQueryData(['push-config'], (old: { prefs: PushPrefs; devices: number } | undefined) => old ? { ...old, prefs: r.prefs } : old);
  });
  const kinds = KINDS.filter((k) => (!k.managers || manager) && (!k.module || hasModule(me, k.module)));

  return (
    <>
      <section className="card set-section">
        <div className="card-head"><div><h3>App da ORBYTA</h3><div className="sub">Instale no celular e no computador: abre com um toque, em tela cheia, sem procurar o site.</div></div></div>
        {inst.installed ? (
          <div className="callout ok"><Check /><span>Você está usando o app instalado neste aparelho.</span></div>
        ) : inst.canPrompt ? (
          <div className="row wrap" style={{ gap: 12 }}>
            <Button variant="solid" icon={<Download />} onClick={async () => { if (await inst.prompt()) toast('Pronto! A ORBYTA está instalada.'); }}>Instalar a ORBYTA</Button>
            <span className="muted small">Grátis, não ocupa quase nada e atualiza sozinho.</span>
          </div>
        ) : inst.ios ? (
          <ol className="install-steps">
            <li><span className="n">1</span><span>Abra este painel no <b>Safari</b> (no iPhone, a instalação é por ele).</span></li>
            <li><span className="n">2</span><span>Toque em <b>Compartilhar</b> <Share className="inline-ic" aria-label="ícone de compartilhar" /> na barra de baixo.</span></li>
            <li><span className="n">3</span><span>Escolha <b>Adicionar à Tela de Início</b> <SquarePlus className="inline-ic" aria-hidden /> e toque em <b>Adicionar</b>.</span></li>
            <li><span className="n">4</span><span>Abra a ORBYTA pelo ícone novo e volte aqui para ligar as notificações.</span></li>
          </ol>
        ) : inst.android ? (
          <ol className="install-steps">
            <li><span className="n">1</span><span>No <b>Chrome</b>, toque no menu <b>⋮</b> (canto de cima).</span></li>
            <li><span className="n">2</span><span>Escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</span></li>
            <li><span className="n">3</span><span>Abra a ORBYTA pelo ícone novo.</span></li>
          </ol>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>No <b>Chrome</b> ou no <b>Edge</b>, clique no ícone de instalar à direita da barra de endereço (ou no menu ⋮ → <b>Instalar ORBYTA</b>). No Firefox e no Safari do computador, as notificações funcionam mesmo sem instalar.</p>
        )}
      </section>

      <section className="card set-section">
        <div className="card-head"><div><h3>Notificações neste aparelho</h3><div className="sub">Avisos na tela, mesmo com o painel fechado. Cada aparelho é ativado separadamente.</div></div>
          {state === 'on' && <Badge tone="green" dot>Ativadas</Badge>}</div>
        {state === null && <Loader />}
        {state === 'unsupported' && <div className="callout warn"><BellOff /><span>Este navegador não recebe notificações. Use o Chrome, Edge, Firefox ou Safari atualizados.</span></div>}
        {state === 'ios-install' && <div className="callout"><Smartphone /><span>No iPhone e no iPad, as notificações funcionam no <b>app instalado</b> (iOS 16.4 ou mais novo). Instale seguindo os passos acima e ative por lá.</span></div>}
        {state === 'denied' && <div className="callout warn"><BellOff /><span>As notificações estão <b>bloqueadas</b> para este site. Para liberar: toque no cadeado ao lado do endereço → <b>Permissões</b> → <b>Notificações</b> → <b>Permitir</b>. No app instalado do Android: segure o ícone → Informações do app → Notificações. Depois volte aqui.</span></div>}
        {state === 'off' && (
          <div className="row wrap" style={{ gap: 12 }}>
            <Button variant="solid" icon={<BellRing />} loading={busy === 'on'} onClick={turnOn}>Ativar notificações neste aparelho</Button>
            <span className="muted small">O navegador vai pedir sua permissão.</span>
          </div>
        )}
        {state === 'on' && (
          <div className="row wrap" style={{ gap: 10 }}>
            <Button icon={<Send />} loading={busy === 'test'} onClick={test}>Enviar notificação de teste</Button>
            <Button variant="ghost" icon={<BellOff />} loading={busy === 'off'} onClick={turnOff}>Desativar neste aparelho</Button>
          </div>
        )}
        {!isDemo && cfg.data && cfg.data.devices > 0 && <p className="muted small" style={{ margin: '12px 0 0' }}><MonitorSmartphone className="inline-ic" aria-hidden /> Você recebe avisos em {cfg.data.devices} {cfg.data.devices === 1 ? 'aparelho' : 'aparelhos'}. Para parar em todos, use Segurança → Desconectar os outros aparelhos.</p>}
      </section>

      <section className="card set-section">
        <div className="card-head"><div><h3>O que avisar</h3><div className="sub">Vale para todos os seus aparelhos. O sino do painel continua mostrando tudo.</div></div></div>
        {!prefs ? <Loader /> : (
          <>
            {kinds.map((k) => {
              const on = !prefs.muted.includes(k.kind);
              return (
                <div className="opt-row" key={k.kind}>
                  <div><div className="t">{k.title}</div><div className="d">{k.text}</div></div>
                  <Switch checked={on} label={k.title} disabled={busy === 'prefs'} onChange={(v) => savePrefs({ muted: v ? prefs.muted.filter((m) => m !== k.kind) : [...prefs.muted, k.kind] })} />
                </div>
              );
            })}
          </>
        )}
      </section>

      <section className="card set-section">
        <div className="card-head"><div><h3>Privacidade na tela bloqueada</h3><div className="sub">Dados de saúde são sensíveis (LGPD): por padrão, o aviso não mostra nomes nem valores.</div></div></div>
        {prefs && (
          <div className="opt-row">
            <div>
              <div className="t">Mostrar nome do paciente e detalhes</div>
              <div className="d">{prefs.details
                ? 'Ligado: o aviso mostra, por exemplo, “Juliana precisa de você · Quer remarcar a consulta”.'
                : 'Desligado: o aviso diz só o tipo, por exemplo, “Um paciente precisa de atendimento”. Os detalhes aparecem ao abrir a ORBYTA.'}</div>
            </div>
            <Switch checked={prefs.details} label="Mostrar detalhes na tela bloqueada" disabled={busy === 'prefs'} onChange={(v) => savePrefs({ details: v })} />
          </div>
        )}
        <p className="muted small" style={{ margin: '10px 0 0' }}><Lock className="inline-ic" aria-hidden /> O conteúdo dos avisos vai criptografado de ponta a ponta até o aparelho. Ao sair da conta, este aparelho para de receber.</p>
      </section>
    </>
  );
}

/* ================= Segurança ================= */
export function SecurityTab() {
  const { me } = useMeCtx();
  const toast = useToast();
  const confirm = useConfirm();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const factors = useQuery({ queryKey: ['mfa'], queryFn: () => api.mfaFactors(), enabled: !isDemo });
  const verified = (factors.data ?? []).filter((f) => f.verified);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); } };

  const start = () => run('enroll', async () => { setCode(''); setErr(''); setEnroll(await api.mfaEnroll()); });
  const finish = async () => {
    if (!enroll) return;
    setErr('');
    if (code.length !== 6) { setErr('Digite os 6 números que aparecem no aplicativo.'); return; }
    setBusy('confirm');
    try {
      await api.mfaConfirm(enroll.factorId, code);
      setEnroll(null);
      await factors.refetch();
      toast('Verificação em duas etapas ativada. No próximo login, o painel vai pedir o código.');
    } catch (e) { setErr((e as Error).message); setCode(''); } finally { setBusy(null); }
  };
  const remove = (id: string) => run('rm' + id, async () => {
    const last = verified.length === 1;
    if (!(await confirm({ title: last ? 'Desligar a verificação em duas etapas?' : 'Remover este celular?', text: last ? 'Sua conta volta a pedir só a senha. Quem descobrir sua senha consegue entrar.' : 'O código deste celular deixa de funcionar.', confirm: last ? 'Desligar' : 'Remover', danger: true }))) return;
    await api.mfaRemove(id);
    await factors.refetch();
    toast(last ? 'Verificação em duas etapas desligada' : 'Celular removido');
  });
  const logoutOthers = () => run('others', async () => {
    if (!(await confirm({ title: 'Desconectar os outros aparelhos?', text: 'Todos os outros celulares e computadores saem da sua conta na hora e param de receber notificações. Este aparelho continua conectado.', confirm: 'Desconectar' }))) return;
    if (!isDemo) await api.push('unsubscribe_all', { keep: (await currentEndpoint()) ?? '' });
    await api.signOutOthers();
    toast('Pronto. Os outros aparelhos foram desconectados.');
  });

  return (
    <>
      <section className="card set-section">
        <div className="card-head"><div><h3>Verificação em duas etapas</h3><div className="sub">Além da senha, o login pede um código do seu celular. Mesmo que alguém descubra a senha, não entra sem o celular.</div></div>
          {verified.length > 0 && <Badge tone="green" icon={<ShieldCheck />}>Ativada</Badge>}</div>
        {isDemo ? (
          <div className="callout"><ShieldCheck /><span>Na demonstração não há conta para proteger. Na sua conta real, ative aqui em 1 minuto.</span></div>
        ) : factors.isLoading ? <Loader /> : verified.length === 0 ? (
          <>
            {can(me, 'dono', 'gerente') && <div className="callout warn" style={{ marginBottom: 12 }}><ShieldCheck /><span><b>Recomendado para você.</b> Quem administra a clínica vê dados de todos os pacientes: a verificação em duas etapas é a melhor proteção contra senha vazada.</span></div>}
            <Button variant="solid" icon={<KeyRound />} loading={busy === 'enroll'} onClick={start}>Ativar verificação em duas etapas</Button>
          </>
        ) : (
          <>
            <ul className="device-list">
              {verified.map((f) => (
                <li key={f.id}><Smartphone /><span className="grow"><b>{f.name}</b><span className="muted small">Cadastrado em {fmtDate(f.created_at.slice(0, 10))}</span></span>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} loading={busy === 'rm' + f.id} onClick={() => remove(f.id)}>{verified.length === 1 ? 'Desligar' : 'Remover'}</Button></li>
              ))}
            </ul>
            {verified.length < 3 && <Button icon={<Plus />} loading={busy === 'enroll'} onClick={start} style={{ marginTop: 10 }}>Cadastrar outro celular (reserva)</Button>}
            <p className="muted small" style={{ margin: '10px 0 0' }}>Dica: cadastre um segundo celular como reserva. Se perder o principal, você ainda consegue entrar.</p>
          </>
        )}
      </section>

      {!isDemo && (
        <section className="card set-section">
          <div className="card-head"><div><h3>Senha</h3><div className="sub">Use pelo menos 8 caracteres, misturando letras e números. Ao trocar, os outros aparelhos saem da conta.</div></div></div>
          <div className="row wrap" style={{ gap: 10 }}>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nova senha" autoComplete="new-password" style={{ maxWidth: 320 }} />
            <Button loading={busy === 'pw'} disabled={pw.length < 8} onClick={() => run('pw', async () => { await api.updatePassword(pw); setPw(''); toast('Senha alterada. Os outros aparelhos foram desconectados.'); })}>Alterar senha</Button>
          </div>
        </section>
      )}

      <section className="card set-section">
        <div className="card-head"><div><h3>Aparelhos conectados</h3><div className="sub">Esqueceu a conta aberta num computador da recepção ou perdeu o celular? Desconecte todos os outros de uma vez.</div></div></div>
        <Button icon={<LogOut />} loading={busy === 'others'} onClick={logoutOthers}>Desconectar os outros aparelhos</Button>
        <ul className="sec-tips">
          <li><Check />Cada pessoa da equipe tem o próprio login (Configurações → Equipe): nunca compartilhe a sua senha.</li>
          <li><Check />Em computador compartilhado, use “Sair” no menu da sua foto ao terminar.</li>
          <li><Check />A ORBYTA nunca pede sua senha ou código por WhatsApp, e-mail ou telefone.</li>
        </ul>
      </section>

      <Modal open={!!enroll} onClose={() => setEnroll(null)} title="Ativar verificação em duas etapas" size="narrow"
        footer={<><Button variant="ghost" onClick={() => setEnroll(null)}>Cancelar</Button><Button variant="solid" loading={busy === 'confirm'} onClick={finish}>Ativar</Button></>}>
        {enroll && (
          <div className="mfa-setup">
            <ol className="install-steps">
              <li><span className="n">1</span><span>Instale um aplicativo autenticador no celular: <b>Google Authenticator</b> ou <b>Microsoft Authenticator</b> (grátis na loja).</span></li>
              <li><span className="n">2</span><span>No aplicativo, toque em <b>+</b> e leia o QR Code abaixo com a câmera.</span></li>
            </ol>
            <img className="mfa-qr" src={enroll.qr} alt="QR Code para o aplicativo autenticador" width={190} height={190} />
            <p className="muted small" style={{ margin: '0 0 6px' }}>Não consegue ler? Digite esta chave no aplicativo:</p>
            <div className="code-box"><code>{enroll.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <button className="icon-btn xs" aria-label="Copiar chave" onClick={() => { void navigator.clipboard?.writeText(enroll.secret); toast('Chave copiada'); }}><Copy /></button></div>
            <ol className="install-steps" start={3}>
              <li><span className="n">3</span><span>Digite o código de 6 números que aparece no aplicativo:</span></li>
            </ol>
            <Field htmlFor="mfa-code">
              <Input id="mfa-code" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter') void finish(); }} />
            </Field>
            {err && <div className="auth-err" role="alert">{err}</div>}
          </div>
        )}
      </Modal>
    </>
  );
}

