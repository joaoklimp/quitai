// Baixar a ORBYTA como app: escolha do aparelho (Windows, Mac, Android, iPhone), botão de instalar quando o navegador
// permite e o passo a passo de cada um. No computador, Android e iPhone mostram um QR Code para abrir direto no celular.
// Aparece na página pública /instalar, no botão "Baixar o app" do topo e em Configurações → App e notificações.
import { useEffect, useState, type ReactNode, type SVGProps } from 'react';
import { Apple, Check, Copy, Download, Ellipsis, EllipsisVertical, Grid2x2Plus, MonitorDown, Share, SquarePlus } from 'lucide-react';
import { Button, Modal, cx, useToast } from '../../ui';
import { browserInfo, useInstall } from '../../pwa';

export type Platform = 'windows' | 'mac' | 'android' | 'ios';

/** Logotipos simples dos sistemas (só para identificar a opção). */
export function WindowsLogo(p: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...p}><path fill="currentColor" d="M3 3h8.4v8.4H3zM12.6 3H21v8.4h-8.4zM3 12.6h8.4V21H3zM12.6 12.6H21V21h-8.4z" /></svg>;
}
export function AndroidLogo(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
      <path fill="currentColor" fillRule="evenodd" d="M2.5 18.5a9.5 9.5 0 0 1 19 0Zm6.1-5.05a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Zm6.8 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
      <path d="M7.3 10.3 5.6 7.2M16.7 10.3l1.7-3.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export const PLATFORMS: { id: Platform; label: string; Icon: (p: SVGProps<SVGSVGElement>) => ReactNode }[] = [
  { id: 'windows', label: 'Windows', Icon: WindowsLogo },
  { id: 'mac', label: 'Mac', Icon: (p) => <Apple {...(p as object)} /> },
  { id: 'android', label: 'Android', Icon: AndroidLogo },
  { id: 'ios', label: 'iPhone e iPad', Icon: (p) => <Apple {...(p as object)} /> },
];
export const isPlatform = (v: unknown): v is Platform => v === 'windows' || v === 'mac' || v === 'android' || v === 'ios';

/** O sistema deste aparelho (Linux e outros seguem o passo a passo do Windows, que é o mesmo do Chrome). */
export function devicePlatform(): Platform | null {
  const { os } = browserInfo();
  return os === 'windows' ? 'windows' : os === 'mac' ? 'mac' : os === 'android' ? 'android' : os === 'ios' ? 'ios' : null;
}

const panelUrl = () => `${location.origin}/app/`;

function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="install-steps">{items.map((it, i) => <li key={i}><span className="n">{i + 1}</span><div>{it}</div></li>)}</ol>;
}
function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div className="install-block"><h4>{title}</h4>{children}</div>;
}

function CopyAddress() {
  const toast = useToast();
  const url = panelUrl();
  return (
    <div className="code-box install-url"><code>{url.replace(/^https?:\/\//, '')}</code>
      <button className="icon-btn xs" aria-label="Copiar endereço" onClick={() => { void navigator.clipboard?.writeText(url); toast('Endereço copiado'); }}><Copy /></button></div>
  );
}

/** QR Code para abrir a página de baixar direto no celular (a câmera do celular lê). */
function QrToPhone({ platform }: { platform: Platform }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import('uqr').then(({ renderSVG }) => {
      if (alive) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(`${location.origin}/app/#/instalar/${platform}`, { border: 1 }))}`);
    });
    return () => { alive = false; };
  }, [platform]);
  return (
    <div className="install-qr">
      {src ? <img src={src} alt={`QR Code para abrir no ${platform === 'ios' ? 'iPhone' : 'celular'}`} width={156} height={156} /> : <span className="spin" aria-hidden />}
      <p><b>Aponte a câmera do {platform === 'ios' ? 'iPhone' : 'celular'} para o código.</b> Ele abre esta página no aparelho, com o passo a passo abaixo.</p>
    </div>
  );
}

/* ---------- passo a passo de cada navegador ---------- */
const ChromeDesktop = ({ mac }: { mac?: boolean }) => (
  <Steps items={[
    <>Abra o painel no Chrome: <CopyAddress /></>,
    <>Na barra de endereço, à direita, clique no ícone <b>Instalar</b> <MonitorDown className="inline-ic" aria-hidden /> (uma telinha com uma seta) e em <b>Instalar</b>.</>,
    <>Não aparece? Menu <EllipsisVertical className="inline-ic" aria-label="três pontinhos" /> (no alto, à direita) → <b>Transmitir, salvar e compartilhar</b> → <b>Instalar ORBYTA…</b> (em versões mais antigas, <b>Instalar ORBYTA…</b> fica direto no menu).</>,
    <>Pronto: a ORBYTA abre numa janela própria e fica {mac ? 'no Launchpad e na pasta Aplicativos. Dá para deixar na Dock' : 'no menu Iniciar. Dá para fixar na barra de tarefas'}.</>,
  ]} />
);
const EdgeDesktop = () => (
  <Steps items={[
    <>Abra o painel no Edge: <CopyAddress /></>,
    <>Na barra de endereço, à direita, clique no ícone <b>Aplicativo disponível</b> <Grid2x2Plus className="inline-ic" aria-hidden /> e em <b>Instalar</b>.</>,
    <>Não aparece? Menu <Ellipsis className="inline-ic" aria-label="três pontinhos" /> (no alto, à direita) → <b>Aplicativos</b> → <b>Instalar ORBYTA</b>.</>,
    <>Pronto: a ORBYTA abre numa janela própria e fica no menu Iniciar. Dá para fixar na barra de tarefas.</>,
  ]} />
);
const SafariMac = () => (
  <Steps items={[
    <>Abra o painel no Safari: <CopyAddress /></>,
    <>No alto da tela, clique no menu <b>Arquivo</b> → <b>Adicionar ao Dock</b> e em <b>Adicionar</b>.</>,
    <>Pronto: a ORBYTA fica na Dock e na pasta Aplicativos. Precisa do macOS Sonoma (14) ou mais novo; nos mais antigos, use o Chrome.</>,
  ]} />
);
const ChromeAndroid = () => (
  <Steps items={[
    <>Abra o painel no Chrome do celular: <CopyAddress /></>,
    <>Toque no menu <EllipsisVertical className="inline-ic" aria-label="três pontinhos" /> (no alto, à direita) → <b>Instalar app</b> (em alguns celulares: <b>Adicionar à tela inicial</b>).</>,
    <>Confirme em <b>Instalar</b> e abra a ORBYTA pelo ícone novo na tela do celular.</>,
  ]} />
);
const SamsungAndroid = () => (
  <Steps items={[
    <>Abra o painel no Samsung Internet: <CopyAddress /></>,
    <>Toque no menu <b>☰</b> (embaixo, à direita) → <b>Adicionar página a</b> → <b>Tela inicial</b>.</>,
    <>Abra a ORBYTA pelo ícone novo na tela do celular.</>,
  ]} />
);
const SafariIos = () => (
  <Steps items={[
    <>Abra o painel no <b>Safari</b> do iPhone ou iPad: <CopyAddress /></>,
    <>Toque em <b>Compartilhar</b> <Share className="inline-ic" aria-label="ícone de compartilhar" /> (na barra de baixo; no iPad, no alto).</>,
    <>Role as opções e toque em <b>Adicionar à Tela de Início</b> <SquarePlus className="inline-ic" aria-hidden />, depois em <b>Adicionar</b>.</>,
    <>Abra a ORBYTA pelo ícone novo. As notificações funcionam a partir daí (iOS 16.4 ou mais novo).</>,
  ]} />
);
const FirefoxNote = () => <div className="callout warn install-ff"><Download /><span>O <b>Firefox</b> não instala apps no computador. Use o <b>Chrome</b> ou o <b>Edge</b> (as instruções estão abaixo). As notificações funcionam no Firefox mesmo sem instalar.</span></div>;

function PlatformSteps({ platform }: { platform: Platform }) {
  const { browser } = browserInfo();
  const here = devicePlatform() === platform;
  // o navegador em uso aparece primeiro
  const order = (list: [string, string, ReactNode][], first: string) => (here ? [...list.filter((x) => x[0] === first), ...list.filter((x) => x[0] !== first)] : list);
  if (platform === 'windows') {
    return <>{here && browser === 'firefox' && <FirefoxNote />}{order([['chrome', 'No Google Chrome', <ChromeDesktop />], ['edge', 'No Microsoft Edge (já vem no Windows)', <EdgeDesktop />]], browser).map(([k, t, el]) => <Block key={k} title={t}>{el}</Block>)}</>;
  }
  if (platform === 'mac') {
    return <>{here && browser === 'firefox' && <FirefoxNote />}{order([['safari', 'No Safari', <SafariMac />], ['chrome', 'No Google Chrome', <ChromeDesktop mac />]], browser).map(([k, t, el]) => <Block key={k} title={t}>{el}</Block>)}</>;
  }
  if (platform === 'android') {
    return <>{order([['chrome', 'No Google Chrome', <ChromeAndroid />], ['samsung', 'No Samsung Internet', <SamsungAndroid />]], browser).map(([k, t, el]) => <Block key={k} title={t}>{el}</Block>)}</>;
  }
  return <Block title="No Safari">{<SafariIos />}</Block>;
}

/** Escolha do aparelho + o que fazer nele. */
export function InstallGuide({ initial, onInstalled }: { initial?: Platform | null; onInstalled?: () => void }) {
  const inst = useInstall();
  const toast = useToast();
  const mine = devicePlatform();
  const [pf, setPf] = useState<Platform>(initial ?? mine ?? 'windows');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (initial) setPf(initial); }, [initial]);
  const here = pf === mine;
  const phoneTarget = pf === 'android' || pf === 'ios';
  const onComputer = mine !== 'android' && mine !== 'ios';

  return (
    <div className="install-guide">
      <div className="install-pick" role="tablist" aria-label="Escolha o aparelho">
        {PLATFORMS.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={pf === p.id} className={cx('install-opt', pf === p.id && 'on')} onClick={() => setPf(p.id)}>
            <p.Icon className="install-opt-ic" /><span>{p.label}</span>{p.id === mine && <em>este aparelho</em>}
          </button>
        ))}
      </div>

      {here && inst.installed ? (
        <div className="callout ok"><Check /><span>Você já está usando o app instalado neste aparelho.</span></div>
      ) : (
        <>
          {here && inst.canPrompt && (
            <div className="install-now">
              <Button variant="solid" size="lg" icon={<Download />} loading={busy} onClick={async () => {
                setBusy(true);
                try { if (await inst.prompt()) { toast('Pronto! A ORBYTA está instalada.'); onInstalled?.(); } } finally { setBusy(false); }
              }}>Instalar a ORBYTA agora</Button>
              <span className="muted small">Grátis, ocupa pouco espaço e se atualiza sozinho.</span>
            </div>
          )}
          {!here && phoneTarget && onComputer && <QrToPhone platform={pf} />}
          {!here && !phoneTarget && !onComputer && <p className="install-note">Faça isto no computador. Para abrir lá, use o endereço que aparece nos passos.</p>}
          {here && inst.canPrompt
            ? <details className="install-more"><summary>Prefere fazer pelo menu do navegador?</summary><PlatformSteps platform={pf} /></details>
            : <PlatformSteps platform={pf} />}
        </>
      )}
    </div>
  );
}

/** Janela com as opções (botão "Baixar o app" do topo e do convite na Visão geral). */
export function InstallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Baixar o app da ORBYTA" subtitle="Escolha o aparelho. Abre com um clique, numa janela própria, e avisa quando um paciente precisar de você.">
      <InstallGuide onInstalled={onClose} />
    </Modal>
  );
}
