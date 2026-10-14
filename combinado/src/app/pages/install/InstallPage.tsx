// Página pública "Baixar o app" (/app/#/instalar): funciona sem login, a partir do site e da tela de entrar.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, Download, MonitorSmartphone, Sparkles } from 'lucide-react';
import { AuthLayout } from '../auth/Auth';
import { InstallGuide, isPlatform, type Platform } from './InstallGuide';
import { enterDemo } from '../../data/api';
import { BRAND } from '../../../shared/brand';

export default function InstallPage({ loggedIn, platform }: { loggedIn: boolean; platform?: string }) {
  const initial: Platform | null = isPlatform(platform) ? platform : null;
  useEffect(() => { document.title = `Baixar o app · ${BRAND.name}`; }, []);
  return (
    <AuthLayout>
      <div className="auth-card install-card">
        <span className="auth-sent-ic"><Download /></span>
        <h2>Baixe o app da {BRAND.name}</h2>
        <p className="sub">Para Windows, Mac, Android e iPhone. Não precisa de loja: instala direto pelo navegador, em poucos segundos.</p>
        <ul className="install-perks">
          <li><MonitorSmartphone />Abre com um clique, numa janela própria</li>
          <li><BellRing />Avisa quando um paciente precisar de você</li>
          <li><Sparkles />Sempre atualizado, sem baixar nada de novo</li>
        </ul>
        <InstallGuide initial={initial} />
        <div className="auth-foot">
          {loggedIn
            ? <Link className="btn solid" to="/">Abrir o painel<ArrowRight /></Link>
            : <Link className="btn solid" to="/entrar">Entrar na minha conta<ArrowRight /></Link>}
          {!loggedIn && <button type="button" className="auth-demo-btn" onClick={enterDemo}><Sparkles />Ver a demonstração sem cadastro</button>}
        </div>
      </div>
    </AuthLayout>
  );
}
