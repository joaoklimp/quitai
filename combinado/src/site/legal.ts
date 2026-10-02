// Páginas internas (termos, privacidade, segurança, sobre e 404): mesmos estilos da landing, sem animações.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/playfair-display/latin-700-italic.css';
import '../app/styles/tokens.css';
import '../app/styles/base.css';
import '../app/styles/ui.css';
import './site.css';
import './legal.css';
import './inner.css';

document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
const head = document.querySelector('.site-head');
const onScroll = () => head?.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Formulário de contato (página Sobre): abre o e-mail com a mensagem pronta.
const form = document.querySelector<HTMLFormElement>('#contato-form');
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const v = (k: string) => String(f.get(k) ?? '').trim();
  const err = form.querySelector<HTMLElement>('.cf-err')!;
  const problem = v('nome').length < 2 ? 'Informe seu nome.' : !/\S+@\S+\.\S+/.test(v('email')) ? 'Informe um e-mail válido.' : v('mensagem').length < 5 ? 'Escreva a sua mensagem.' : '';
  err.hidden = !problem; err.textContent = problem;
  if (problem) return;
  const body = `${v('mensagem')}\n\n—\n${v('nome')}${v('empresa') ? ` · ${v('empresa')}` : ''}\n${v('email')}`;
  location.href = `mailto:contato@orbyta.com.br?subject=${encodeURIComponent(`${v('assunto')}: ${v('empresa') || v('nome')}`)}&body=${encodeURIComponent(body)}`;
});
