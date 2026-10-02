# ORBYTA

**Administre sua empresa conversando.**

Plataforma de gestão para pequenas e médias empresas em que a inteligência artificial não só responde: ela executa. A IA atende os clientes no WhatsApp 24 horas, passa preços, monta orçamentos e marca horários. O dono e a equipe administram o negócio por mensagem (clientes, orçamentos, agenda, vendas, contas a pagar e a receber, estoque) e o painel se atualiza sozinho. Por exemplo:

> “Cadastra a Maria, telefone 61 99999-9999, e cria um orçamento de R$ 350 para ela.”
>
> ✓ Cliente Maria cadastrado · ✓ Orçamento nº 0419 de R$ 350,00 criado
>
> (e o orçamento já aparece no painel comercial)

Tudo aparece no painel em tempo real: conversas, clientes, orçamentos, agenda, vendas, tarefas e o histórico de cada ação.

---

## Experimente em 1 minuto (modo demonstração)

Precisa do [Node.js 22](https://nodejs.org) ou mais novo.

```bash
npm install
npm run dev
```

- Site: <http://localhost:5173/>
- Painel com dados de exemplo: <http://localhost:5173/app/?demo>

O modo demonstração não precisa de nenhuma chave: os dados ficam só no seu navegador. No **Simulador** você conversa como se fosse um cliente no WhatsApp, e no **Assistente** (botão no topo do painel, ou Ctrl+J) você testa os comandos do dono. Nesse modo, as respostas vêm de uma IA local simplificada, só para mostrar o fluxo. A IA de verdade (Claude) roda no servidor depois da publicação.

Para publicar de verdade, siga o **[DEPLOY.md](DEPLOY.md)**, um passo a passo do zero até o primeiro cliente pagando.

---

## O que tem no sistema

| Parte | O que faz |
|---|---|
| **Site** (`/`) | Página de vendas: recursos, simulação de conversa, planos e perguntas frequentes. |
| **Painel** (`/app/`) | Cadastro, login, criação da empresa (com serviços prontos por ramo), visão geral com gráficos, conversas, clientes, orçamentos, agenda, vendas, catálogo, tarefas, financeiro, estoque, integrações, módulos, análises, automações, histórico, configurações, assinatura, ajuda e área de administração da plataforma. |
| **Financeiro** | Contas a pagar e a receber, contas mensais (ao pagar, a do mês seguinte já fica lançada), vencidas em destaque, resultado do mês e caixa previsto das próximas 6 semanas. Só dono e gerente acessam. |
| **Estoque** | Produtos com saldo, mínimo e custo; entradas, saídas e ajustes com histórico; alerta quando um produto fica abaixo do mínimo; importação de planilha do Excel (.xlsx) ou CSV e exportação. |
| **Integrações** | WhatsApp oficial e planilhas funcionando. Nota fiscal, cobrança dos clientes, ERP (Bling, Tiny, Omie), Google Agenda e API estão listados como “em breve”, sem prometer o que ainda não existe. |
| **Orçamento público** (`/orcamento/#…`) | Link enviado ao cliente para ver e aprovar o orçamento. A aprovação vai direto para o painel. |
| **Termos e Privacidade** (`/termos/`, `/privacidade/`) | Textos-base de acordo com a LGPD, com os campos da empresa a preencher. |
| **IA de atendimento** | Responde clientes com o catálogo, as regras e as **perguntas frequentes** que o dono cadastra (com pesquisa na internet opcional, só para dúvidas gerais), consulta horários livres, agenda, monta orçamentos, envia links e passa a conversa para a equipe (reclamação, pedido de humano ou assunto que não sabe). |
| **IA de comandos** | O dono e a equipe falam com a IA pelo WhatsApp ou pelo painel: cadastrar, orçar, agendar, registrar venda, criar tarefa, lançar e consultar contas, dar entrada e saída no estoque, consultar números do dia. Ações sensíveis (registrar venda, dar baixa em conta, cancelar horário, mudar preço de serviço, mandar mensagem para um cliente, desconto acima do limite) ficam **aguardando confirmação**. |
| **WhatsApp** | API oficial da Meta (Cloud API): webhook com assinatura conferida, janela de 24 horas respeitada, modelos aprovados fora dela, fotos e documentos guardados de forma privada, indicador de “digitando”. |
| **Automações** | Lembrete antes do horário, acompanhamento de orçamento sem resposta, resumo do dia no WhatsApp do dono, agradecimento com pedido de avaliação depois do serviço, lembretes de tarefas e reativação de clientes inativos. |
| **Assinatura** | Teste grátis de 7 dias, planos mensal e anual pelo Asaas (cartão recorrente, Pix ou boleto), faturas no painel, troca de plano e cancelamento. |
| **Segurança** | Cada empresa só enxerga os próprios dados (RLS no Postgres), papéis dono, gerente e atendente, histórico de auditoria de cada ação (de pessoas e da IA), números da equipe verificados por código e exclusão da conta com os dados (LGPD). |

---

## Como funciona

```
 Cliente no WhatsApp ───┐
 Dono/equipe no WhatsApp ┴─► Meta (Cloud API) ─► whatsapp-webhook
                                                   │  confere a assinatura da Meta
                                                   │  descobre a empresa, quem está falando e o que pode fazer
                                                   ▼
 Painel (React) ─────────────────────────────► agent · whatsapp · billing · team   (login do usuário)
                                                   │
                                                   ▼
                                      Claude + ferramentas (consultar horários, agendar, orçar, cadastrar…)
                                                   │
                                                   ▼
                                Postgres (Supabase): RLS por empresa, gatilhos, auditoria
                                                   │
                     ┌─────────────────────────────┴──────────────────────────┐
                     ▼                                                        ▼
            resposta no WhatsApp                                   painel atualiza em tempo real

 pg_cron (a cada 5 min) ─► cron: lembretes, acompanhamentos, resumo do dia, tarefas
 Asaas ─► asaas-webhook: libera, renova ou bloqueia o plano
```

- **A IA nunca mexe no banco diretamente.** Ela só chama ferramentas, e cada ferramenta confere a empresa, o papel de quem pediu e os limites do plano antes de agir. Tudo vira um registro no histórico.
- **Os clientes não conseguem mudar as regras.** O que o cliente escreve é tratado como mensagem, nunca como instrução, e o catálogo e os preços vêm do banco.
- **Confirmação antes do que é sensível.** A ação fica pendente e só é executada com “sim” (no WhatsApp) ou com o botão de confirmar (no painel).

---

## Tecnologia

- **Painel e site:** React 19, TypeScript, Vite (várias páginas), React Router, TanStack Query, ícones Lucide, fontes Plus Jakarta Sans e Playfair Display. O site é HTML estático com um script leve e o painel é uma aplicação React.
- **Servidor:** Supabase (Postgres 17, Auth, Storage, Realtime, Edge Functions em Deno, pg_cron e pg_net).
- **IA:** Claude, da Anthropic, com ferramentas (function calling). O padrão é o Claude Opus 5.5, e dá para usar o Claude Sonnet 5.5 nas respostas aos clientes para reduzir o custo pela metade (veja “Custos da IA” no DEPLOY.md).
- **WhatsApp:** WhatsApp Cloud API (Meta), com cadastro incorporado (Embedded Signup) opcional.
- **Pagamentos:** Asaas (Checkout para cartão recorrente e assinaturas para Pix e boleto).

---

## Estrutura

```
combinado/
├── index.html                 site (landing page)
├── app/index.html             painel
├── orcamento/index.html       página pública do orçamento
├── termos/ · privacidade/     páginas legais
├── src/
│   ├── site/                  script e estilos do site e das páginas legais
│   ├── app/                   painel: páginas, componentes, gráficos, dados
│   │   └── data/              fontes de dados: Supabase (real) e demonstração (local)
│   ├── quote/                 página do orçamento
│   └── shared/                marca, planos, formatos, modelos de mensagem do WhatsApp
├── supabase/
│   ├── migrations/            esquema, RLS, funções SQL, gatilhos, tempo real, arquivos e agendamentos
│   ├── functions/             Edge Functions (agent, whatsapp-webhook, whatsapp, billing, asaas-webhook, team, cron)
│   │   └── _shared/           IA, ferramentas, WhatsApp, Asaas, conversas e cópias sincronizadas de src/shared
│   ├── templates/             e-mails de cadastro, convite e nova senha (em português)
│   └── tests/                 testes do banco com Postgres de verdade
├── public/                    ícones, imagem de compartilhamento, manifesto
└── scripts/                   geração de imagens, sincronização, Deno, capturas de tela
```

Algumas regras (planos, formatos, modelos de mensagem, disponibilidade de horários) existem no painel e no servidor. A fonte é `src/shared/`, e `npm run sync:functions` copia esses arquivos para `supabase/functions/_shared/`. Um teste falha se as cópias ficarem diferentes.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Site e painel em <http://localhost:5173> |
| `npm run build` | Confere os tipos e gera a versão de produção em `dist/` |
| `npm run preview` | Serve o `dist/` em <http://localhost:4173> |
| `npm run typecheck` | Só confere os tipos do painel e do site |
| `npm test` | Testes rápidos (IA de demonstração, leitura de planilhas, comparação de períodos do painel, cópias sincronizadas) |
| `npm run test:db` | Testes do banco num Postgres 17 de verdade: RLS entre empresas, papéis, gatilhos, numeração, funções, financeiro e estoque |
| `npm run test:functions` | Testes das Edge Functions (Deno, Claude simulado) |
| `npm run check:functions` | Confere os tipos das Edge Functions |
| `npm run sync:functions` | Copia `src/shared` para as Edge Functions |
| `npm run assets` | Gera de novo o favicon, os ícones e a imagem de compartilhamento. Usa o Playwright, que não vem instalado: antes, rode `npm i -D playwright` e `npx playwright install chromium` |

### Teste de ponta a ponta das funções

`npm run test:db` também roda, quando encontra o [PostgREST](https://github.com/PostgREST/postgrest/releases), um teste que sobe o banco com a mesma API REST do Supabase e executa as ferramentas reais da IA no Deno: atendimento com agendamento, comandos do dono com confirmação, orçamento, venda, tarefas, mensagens repetidas, janela de 24 horas e isolamento entre empresas.

```bash
POSTGREST_BIN=/caminho/para/postgrest npm run test:db
```

Sem o PostgREST, esse teste é pulado e os demais rodam normalmente.

---

## Trocar o nome da marca

O nome aparece em poucos lugares:

1. `src/shared/brand.ts` (nome, frase, e-mail de suporte, símbolo e logotipo)
2. o `<title>` e as descrições dos arquivos `index.html`, `app/index.html`, `orcamento/index.html`, `termos/index.html` e `privacidade/index.html`
3. `public/manifest.webmanifest`
4. os e-mails em `supabase/templates/`
5. os modelos de mensagem do WhatsApp em `src/shared/templates.ts` (“Lembrete da ORBYTA…”). Depois de mudar, rode `npm run sync:functions`.

Depois, `npm run assets` gera de novo o favicon, os ícones e a imagem de compartilhamento a partir do `brand.ts` (precisa do Node 22.18 ou mais novo; veja a observação sobre o Playwright em “Comandos”).

O fundo animado (planetas com bordas de luz, estrelas e a lua em órbita) é só CSS, em `src/app/styles/orbit.css`, e respeita quem desativa animações no sistema.
