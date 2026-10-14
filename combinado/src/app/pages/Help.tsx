// Ajuda: perguntas frequentes e contato.
import { Link } from 'react-router-dom';
import { LifeBuoy, Mail, Smartphone, Sparkles } from 'lucide-react';
import { useAssistant } from '../context';
import { Button, PageHeader } from '../ui';
import { BRAND } from '../../shared/brand';

const FAQ: [string, string][] = [
  ['Como a IA sabe os meus preços?', 'Ela consulta a tabela em “Serviços e preços”. “Preço fixo” ela informa direto; “a partir de” ela informa o mínimo e explica que pode variar; “sob consulta” ela oferece uma visita ou chama a equipe. Tudo o que você escrever em Configurações → Assistente IA também vira conhecimento dela.'],
  ['A IA pode errar ou inventar coisas?', 'Ela foi instruída a responder só com base nas suas informações e a chamar uma pessoa quando não sabe. Ações que mexem em dinheiro ou cancelam algo nunca acontecem sem a sua confirmação. Tudo fica no Histórico de ações.'],
  ['Como eu mando comandos pelo WhatsApp?', 'Em Configurações → WhatsApp, clique em “Verificar meu número” e envie o código do seu WhatsApp pessoal para o número da empresa. Depois é só conversar: “cadastra a Maria e cria um orçamento de R$ 350 para ela”.'],
  ['O que acontece se o paciente pedir para falar com uma pessoa?', 'A IA para de responder naquela conversa, avisa a equipe (no painel e no seu WhatsApp) e a conversa aparece com o aviso laranja em Conversas. Quando você terminar, clique em “Devolver para a IA”.'],
  ['Preciso de um número novo de WhatsApp?', 'O número precisa estar ligado à API oficial do WhatsApp (Meta). Você pode usar um número novo ou migrar o atual. Um número na API oficial não fica no aplicativo comum ao mesmo tempo, salvo nos casos em que a Meta permite a coexistência com o WhatsApp Business.'],
  ['Quanto custam as mensagens do WhatsApp?', 'Responder pacientes que chamaram você nas últimas 24 horas não tem custo da Meta. Mensagens fora dessa janela (lembretes, acompanhamentos) usam modelos aprovados e são cobradas pela Meta direto na sua conta, por mensagem.'],
  ['Meus dados ficam seguros?', 'Cada empresa só enxerga os próprios dados (regra aplicada direto no banco). Senhas e tokens não aparecem para a equipe. Você pode baixar ou apagar tudo em Configurações → Sua conta.'],
  ['Como instalo a ORBYTA como app no celular?', 'No Android, abra o painel no Chrome e toque em “Instalar” (ou no menu ⋮ → Instalar app). No iPhone, abra no Safari, toque em Compartilhar e em “Adicionar à Tela de Início”. No computador, use o ícone de instalar na barra de endereço do Chrome ou do Edge. O passo a passo está em Configurações → App e notificações.'],
  ['Como recebo os avisos no celular?', 'Em Configurações → App e notificações, toque em “Ativar notificações neste aparelho” e permita quando o navegador perguntar. Cada aparelho é ativado separadamente e você escolhe o que quer receber. No iPhone, ative pelo app instalado (iOS 16.4 ou mais novo). Por padrão, a tela bloqueada não mostra nome de paciente nem valores.'],
  ['O que é a verificação em duas etapas?', 'Uma proteção extra: além da senha, o login pede um código de 6 números que aparece num aplicativo autenticador do seu celular (Google Authenticator ou Microsoft Authenticator). Mesmo que alguém descubra sua senha, não entra sem o seu celular. Ative em Configurações → Segurança e cadastre um segundo celular como reserva.'],
  ['Esqueci a conta aberta em outro computador. E agora?', 'Em Configurações → Segurança, toque em “Desconectar os outros aparelhos”. Todos os outros celulares e computadores saem da sua conta na hora e param de receber notificações. Trocar a senha também desconecta os outros aparelhos.'],
  ['Posso cancelar quando quiser?', 'Sim, sem multa. O acesso continua até o fim do período pago. Depois, o painel fica só para consulta e a IA para de responder. Seus dados continuam guardados para consulta e exportação até você pedir a exclusão (contas sem assinatura por mais de 12 meses podem ser excluídas, sempre com aviso antes).'],
];

export default function Help() {
  const assistant = useAssistant();
  return (
    <>
      <PageHeader title="Ajuda" subtitle="Respostas rápidas para as dúvidas mais comuns." actions={<Button icon={<Sparkles />} onClick={() => assistant.ask()}>Perguntar ao assistente</Button>} />
      <div className="two-col">
        <section className="card faq">
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </section>
        <div className="col" style={{ gap: 16 }}>
          <section className="card">
            <h3 style={{ fontSize: 16 }}>Primeiros passos</h3>
            <ol className="steps" style={{ marginTop: 14 }}>
              <li><span>Confira <Link className="link" to="/catalogo">serviços e preços</Link> e o <Link className="link" to="/configuracoes/empresa">horário de funcionamento</Link>.</span></li>
              <li><span>Escreva as regras da empresa em <Link className="link" to="/configuracoes/assistente">Assistente IA</Link>.</span></li>
              <li><span>Teste tudo no <Link className="link" to="/simulador">Simulador do WhatsApp</Link>.</span></li>
              <li><span>Conecte o número em <Link className="link" to="/configuracoes/whatsapp">WhatsApp</Link> e verifique o seu.</span></li>
            </ol>
          </section>
          <section className="card">
            <h3 style={{ fontSize: 16 }}>Fale com a gente</h3>
            <p className="muted" style={{ marginTop: 6 }}>Respondemos em dias úteis, das 9h às 18h.</p>
            <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
              <a className="btn" href={`mailto:${BRAND.supportEmail}`}><Mail />{BRAND.supportEmail}</a>
              <Link className="btn" to="/simulador"><Smartphone />Simulador</Link>
              <a className="btn" href="/termos/" target="_blank" rel="noreferrer"><LifeBuoy />Termos</a>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
