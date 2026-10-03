// Cabeçalho das páginas internas e rodapé de todo o site (landing, segurança, sobre, termos, privacidade e 404).
// O plugin staticHtml do vite.config troca <header data-site-header></header> e <footer data-site-footer></footer> por estes trechos.

export const SITE_EMAIL = 'contato@orbyta.com.br';

/** Cabeçalho simples das páginas internas: logotipo, atalhos do site e acesso. */
export const SITE_HEADER = `<header class="site-head inner-head">
  <div class="wrap-wide head-row">
    <a class="site-brand" href="/" aria-label="ORBYTA, página inicial"><i data-wordmark="34"></i></a>
    <nav class="head-nav" aria-label="Principal">
      <a href="/#como-funciona">Produto</a>
      <a href="/#modulos">Módulos</a>
      <a href="/#precos">Preços</a>
      <a href="/seguranca/">Segurança</a>
      <a href="/sobre/">Sobre</a>
    </nav>
    <div class="head-cta">
      <a class="btn ghost head-login" href="/app/?real#/entrar">Entrar</a>
      <a class="btn solid head-try" href="/app/?real#/cadastro">Teste grátis<i data-icon="arrow-up-right"></i></a>
    </div>
  </div>
</header>`;

export const SITE_FOOTER = `<footer class="site-foot">
  <div class="wrap foot-grid">
    <div class="foot-brand">
      <a class="site-brand" href="/" aria-label="ORBYTA, página inicial"><i data-wordmark="30"></i></a>
      <p>Software com IA para clínicas. A recepção da sua clínica, no automático.</p>
      <a class="foot-mail" href="mailto:${SITE_EMAIL}"><i data-icon="mail"></i>${SITE_EMAIL}</a>
    </div>
    <nav class="foot-col" aria-label="Produto"><b>Produto</b><a href="/#como-funciona">Como funciona</a><a href="/#recursos">Recursos</a><a href="/#modulos">ORBYTA ONE</a><a href="/#precos">Preços</a><a href="/app/?demo">Demonstração</a></nav>
    <nav class="foot-col" aria-label="Empresa"><b>Empresa</b><a href="/sobre/">Sobre a ORBYTA</a><a href="/seguranca/">Segurança</a><a href="/sobre/#contato">Contato</a><a href="/sobre/#contato">Parcerias</a></nav>
    <nav class="foot-col" aria-label="Conta"><b>Conta</b><a href="/app/?real#/entrar">Entrar</a><a href="/app/?real#/cadastro">Criar conta grátis</a><a href="/app/?real#/recuperar">Recuperar senha</a></nav>
    <nav class="foot-col" aria-label="Legal"><b>Legal</b><a href="/termos/">Termos de uso</a><a href="/privacidade/">Privacidade</a><a href="/privacidade/#p9">Seus direitos (LGPD)</a><a href="/seguranca/#subprocessadores">Subprocessadores</a></nav>
  </div>
  <div class="wrap foot-bottom">
    <span>© <span data-year>2026</span> ORBYTA. Todos os direitos reservados.</span>
    <span class="foot-meta"><span class="foot-lang"><i data-icon="globe"></i>Português (Brasil)</span><span>Feito no Brasil, pensado para crescer.</span></span>
  </div>
</footer>`;
