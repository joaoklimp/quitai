// Convite na Visão geral: instalar a ORBYTA como app e ligar as notificações neste aparelho.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Download, X } from 'lucide-react';
import { useMeCtx } from '../../context';
import { Button, useToast } from '../../ui';
import { enablePush, pushState, useInstall, type PushState } from '../../pwa';
import { InstallModal } from '../install/InstallGuide';

const HIDE = 'orbyta-convite-app';

export function AppCard() {
  const { me } = useMeCtx();
  const inst = useInstall();
  const toast = useToast();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE) === '1'; } catch { return false; } });
  useEffect(() => { void pushState(me.user_id).then(setPush); }, [me.user_id]);
  if (hidden || push === null) return null;
  const close = () => { try { localStorage.setItem(HIDE, '1'); } catch { /* ignora */ } setHidden(true); };

  // não instalado (celular ou computador): convite para baixar o app; instalado: falta só ligar os avisos
  const mode = inst.installed ? (push === 'off' ? 'push' : null) : 'install';
  if (!mode) return null;
  const askPush = mode === 'push';

  const install = async () => {
    if (inst.canPrompt) { if (await inst.prompt()) toast('Pronto! A ORBYTA está instalada.'); return; }
    setGuide(true);
  };
  const turnOn = async () => {
    setBusy(true);
    try { await enablePush(me.user_id); setPush('on'); toast('Notificações ativadas neste aparelho'); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <section className="card app-invite" aria-label="App da ORBYTA">
      <span className="starter-ic">{askPush ? <BellRing /> : <Download />}</span>
      <div className="grow">
        <h3>{askPush ? 'Ligue as notificações neste aparelho' : 'Baixe o app da ORBYTA'}</h3>
        <p className="muted small">{askPush
          ? 'Saiba na hora quando um paciente precisar de você, quando um horário for marcado ou um orçamento aprovado.'
          : 'Abre com um toque no celular e no computador, em tela cheia, e avisa quando um paciente precisar de você.'}</p>
      </div>
      <div className="app-invite-actions">
        {askPush
          ? <Button variant="solid" loading={busy} icon={<BellRing />} onClick={turnOn}>Ativar</Button>
          : <Button variant="solid" icon={<Download />} onClick={install}>{inst.canPrompt ? 'Instalar agora' : 'Baixar o app'}</Button>}
        {!askPush && push === 'off' && <Button variant="ghost" loading={busy} onClick={turnOn}>Só as notificações</Button>}
        {!askPush && push !== 'off' && <Link className="link small only-desktop" to="/configuracoes/app">Notificações</Link>}
      </div>
      <button className="icon-btn xs" aria-label="Fechar convite do app" onClick={close}><X /></button>
      <InstallModal open={guide} onClose={() => setGuide(false)} />
    </section>
  );
}
