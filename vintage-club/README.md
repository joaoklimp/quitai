# Vintage Club · site

Site estático do Vintage Club (salão de beleza e barbearia no Gama, DF). Não tem build: basta publicar esta pasta
em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel, hospedagem comum) e abrir o `index.html`.

## Arquivos

- `index.html`: todo o conteúdo (textos, preços, equipe, links).
- `assets/css/site.css`: visual. As cores e as fontes ficam no bloco `:root` no início do arquivo.
- `assets/js/site.js`: animações, quadro de serviços e ticket, menu do celular, perguntas frequentes.
- `assets/fonts/`: Newsreader, Archivo e Kalam, hospedadas aqui mesmo.
- `assets/vendor/`: GSAP 3.13 (com ScrollTrigger e SplitText) e Lenis 1.3, hospedados aqui mesmo.
- `assets/img/`, `assets/video/`: fotos da equipe, retrato do fundador, quadros do vídeo e o vídeo da casa.

Sem JavaScript, ou se as bibliotecas falharem, todo o conteúdo continua visível. Com "reduzir movimento" ligado
no aparelho, as animações grandes não rodam.

## Como mudar

- **Preço de um serviço**: em `index.html`, procure o `data-id` do serviço (`cm-al`, `cm-eq`, `cf-al`, `ci-eq`,
  `barba`, `rm`, `rf`, `pele`, `sob-m`, `sob-f`). Em cada botão de valor, troque o número no texto, no `data-v` e no
  `aria-label`. Para os cortes, atualize também o comparativo "Aucirley ou equipe?": os valores escritos no
  `index.html` (`#cmp-chart`) e a tabela `CMP` em `assets/js/site.js`, que anima o comparativo ao trocar o
  comprimento. Confira ainda as respostas das perguntas frequentes.
- **Telefone / WhatsApp**: procure por `556132578428` (links) e `3257-8428` (texto).
- **Horário**: hoje o site diz só "Fechamos às 20h" e manda consultar os dias pelo WhatsApp. Quando os horários
  completos estiverem confirmados, atualize a seção Visite, o rodapé e a pergunta "Até que horas vocês atendem?".
- **Equipe**: os cards ficam na seção `#equipe`. As fotos são quadradas (600×600).

## Prévia para o cliente

Enquanto o site está em apresentação, `vercel.json` (cabeçalho `X-Robots-Tag: noindex`) e `robots.txt`
(`Disallow: /`) impedem que buscadores indexem a prévia. **Apague os dois arquivos no lançamento**, senão o site
oficial também fica fora do Google.

## Quando o domínio estiver definido

No `<head>` há um comentário `TODO` explicando o que trocar: `og:image` e o `image` do JSON-LD com endereço
completo (`https://…/assets/img/salao-interior.jpg`), mais `og:url`, `<link rel="canonical">` e `"url"` no JSON-LD.
Sem isso, a prévia do link no WhatsApp e no Instagram pode sair sem foto.
