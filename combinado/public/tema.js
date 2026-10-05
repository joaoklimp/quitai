// Aplica o tema salvo (claro/escuro) antes da página aparecer, sem piscar.
try{var t=localStorage.getItem('orbyta-tema');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}
