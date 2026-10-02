// Páginas legais (termos e privacidade): mesmos estilos da landing, sem animações.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/playfair-display/latin-700-italic.css';
import '../app/styles/tokens.css';
import '../app/styles/base.css';
import '../app/styles/ui.css';
import './site.css';
import './legal.css';

document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
const head = document.querySelector('.site-head');
const onScroll = () => head?.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
