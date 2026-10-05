# Quitaí

Sistema on-line de cobrança e fechamento financeiro para pequenos negócios no Brasil (site: usequitai.com.br).
O dono do produto é uma pessoa só; fale com ela em português do Brasil, de forma simples e sem jargão.

## Estrutura

```
index.html                  site inteiro: página de vendas, cadastro, login e o painel (HTML + CSS + JS num arquivo só)
CNAME, robots.txt, sitemap.xml
_config.yml                 o que fica fora do site (o GitHub Pages publica o repositório inteiro)
supabase/functions/         funções do servidor (Deno + TypeScript)
  billing/                  assinatura pelo Asaas: assinar, cancelar, "já paguei", health, admin_revoke, admin_comp, admin_comp_remove
  asaas-webhook/            avisos do Asaas → plano, situação e faturas da empresa
  stripe-webhook/           legado: assinaturas antigas da Stripe
  team/                     equipe: criar acesso, redefinir senha, remover pessoa, excluir conta
  support/                  formulário "Fale com o suporte" (com ou sem login)
  support-inbound/          e-mails que chegam em suporte@ (webhook do Resend)
  support-admin/            atendimento pelo painel de Administração
  _shared/                  common.ts (CORS, cliente admin, caller), asaas.ts, ai.ts, autoreply.ts, mail.ts, billing-mail.ts, sync.ts (Stripe)
supabase/migrations/        SQL do banco, em ordem pelo nome
```

Não existe build, package.json, testes automatizados nem CI.

## Site (`index.html`)

- Arquivo grande (~9.700 linhas). Não leia inteiro: procure as seções pelos cabeçalhos `/* ====` e use grep.
- JavaScript puro dentro de uma IIFE com `'use strict'`. A única biblioteca externa é o `supabase-js`, carregado do jsDelivr com `integrity`.
- Para montar HTML, use a tag `html\`...\``, que escapa tudo. Use `raw()` só com conteúdo confiável. Nunca monte HTML concatenando dados do usuário.
- Os dados do painel de cada empresa ficam num JSON só (`companies.data`), salvo pela RPC `save_company` com controle de versão (`conflict` quando outra pessoa salvou antes). O `localStorage` é cache.
- O modo demonstração usa uma empresa fictícia e fica só no navegador.
- As funções do servidor são chamadas por `callFn(nome, body)`. O servidor devolve códigos de erro curtos em inglês (`not_owner`, `invalid_doc`...), e a mensagem que a pessoa vê fica em `FN_ERRORS`. Código novo no servidor = mensagem nova em `FN_ERRORS`.
- A IA do painel usa `window.claude.use('sample')`. Fora do ambiente de artifact do Claude, `AI.ns` fica `null` e esses recursos ficam indisponíveis.
- A chave do Supabase em `CLOUD_CFG` é a pública (publishable) e pode ficar no site. A `service_role` nunca vai para o site.

## Banco (Supabase, projeto `zldzvtmtulmqkikvarbj`)

- Tabelas: `companies`, `members`, `platform_admins`, `support_tickets`, `support_messages`, `support_settings`, `asaas_events`.
- Bloqueio do painel: `company_locked(c)` (usada por `save_company`). Mudou a regra de acesso, mude ali e no `billingState`/`applyServerBilling` do `index.html`.
- RLS ligado em todas as tabelas. O site só lê `companies` e `members` da própria empresa (`my_company_id()`).
- Toda escrita passa por funções `security definer` (RPC) ou pelas funções do servidor com a `service_role`. Não dê `insert`/`update` direto para `anon`/`authenticated`.
- Plano, situação da assinatura e faturas só são escritos pelo servidor.
- Datas de negócio (vencimento, fim do período, teste grátis) usam o fuso `America/Sao_Paulo`. No TypeScript, use `todaySP()`.

## Pagamentos (Asaas; a Stripe é legado)

- Cartão: Asaas Checkout recorrente. A assinatura criada é ligada à empresa pelo `checkoutSession` (`adoptFromCheckout`).
- Pix/boleto: o Quitaí cria o cliente e a assinatura no Asaas (`billingType: 'UNDEFINED'`).
- O plano de uma assinatura é identificado pelo **valor**. `PRICES` em `_shared/asaas.ts` (em reais) precisa bater com `PLANS` no `index.html` (em centavos) e com o texto `KNOWLEDGE` em `_shared/ai.ts`. Mudou preço, mude nos três.
- `syncCompany()` é a fonte da verdade: lê assinatura e cobranças no Asaas e recalcula `plan`, `billing_status`, `current_period_end` e `invoices`.
- Regras que não podem quebrar:
  - Cortesia: `complimentary` + `comp_until` (data em que acaba; nula = sem prazo, como a conta da casa). Dada e removida pelo admin (`admin_comp`, `admin_comp_remove`, em `grantCourtesy`/`removeCourtesy`). Enquanto vale (`courtesyActive`), o pagamento não mexe na conta e `company_locked` não bloqueia. Ao dar cortesia, a assinatura paga é encerrada no Asaas.
  - Cortesia sem prazo (`courtesyForever`) não assina. Com prazo, pode assinar: a assinatura começa em `comp_until` e a cortesia sai (`courtesyHandoff`). Vencida sem assinatura, cai nas regras normais (`billing_status = 'canceled'`) e o painel fica em modo leitura.
  - A conta da casa (empresa de um `platform_admins`) não é mexida pelas ações de admin (`own_company`).
  - `access_revoked` (estorno, contestação ou bloqueio pelo admin) não é desfeito pela sincronização.
  - O webhook processa cada aviso uma vez só (`asaas_events`). Se der erro, apaga o registro e devolve 500 para o Asaas reenviar.
  - Troca de plano não cobra em dobro: a assinatura nova começa no fim do período já pago.
  - Tolerância de `GRACE_DAYS` (5) depois do vencimento antes de bloquear.
- `ASAAS_ENV` diferente de `production` = sandbox. No domínio oficial, o checkout em sandbox só é liberado para os e-mails em `ASAAS_SANDBOX_TESTERS`.
- Os e-mails de cobrança saem pelo Quitaí (`billing-mail.ts`, via Resend). As notificações pagas do Asaas ficam desligadas por cliente (`notificationDisabled: true`).

## Suporte

Formulário (`support`) ou e-mail (`support-inbound`) → `handleIncoming` em `autoreply.ts`. A IA (`ai.ts`, Claude pela API) responde sozinha ou encaminha para uma pessoa, e avisa o dono em `SUPPORT_INBOX`.
- Encaminha sempre quando a pessoa pede atendente ou depois de `MAX_AUTO` respostas automáticas.
- O assistente liga e desliga em `support_settings.auto_reply`.
- As respostas nunca prometem reembolso, desconto, prazo ou funcionalidade fora do `KNOWLEDGE`. Funcionalidade nova no produto = atualizar o `KNOWLEDGE`.

## Publicar

- **Site:** GitHub Pages a partir da `main` (domínio no `CNAME`). Push na `main` = site no ar.
  - O Pages publica todo arquivo do repositório. Arquivo ou pasta nova que não é do site (documentação, código do servidor, notas) entra em `exclude` no `_config.yml`, senão fica público em usequitai.com.br.
- **Funções:** publicadas à mão (Supabase CLI ou ferramenta `deploy_edge_function` do Supabase). Todas estão com `verify_jwt: false`, porque o login é conferido no código por `caller()` e os webhooks conferem token ou assinatura próprios. Ao republicar, mantenha `verify_jwt` desligado (`--no-verify-jwt`) e inclua os arquivos de `_shared/` que a função importa.
- **Banco:** as migrations **não** são rastreadas pelo Supabase (`list_migrations` vem vazio). Elas são aplicadas à mão (SQL Editor ou `execute_sql`). Por isso:
  - toda migration precisa poder rodar de novo sem quebrar (`if not exists`, `create or replace`, `drop ... if exists`);
  - mudança nova = arquivo novo `supabase/migrations/AAAAMMDDHHMMSS_nome.sql`. Não edite uma migration já aplicada.
- Publicar função, aplicar SQL ou mexer no Asaas de produção afeta clientes reais e dinheiro real. Antes, confirme com o dono, a não ser que ele já tenha pedido.

## Segredos (variáveis das funções no Supabase)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `ALLOWED_ORIGINS`, `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_SANDBOX_TESTERS`, `RESEND_API_KEY`, `RESEND_INBOUND_KEY`, `RESEND_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `SUPPORT_INBOX`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIG`.

Nunca coloque valores no repositório, em logs ou em respostas. `billing` com `{ "action": "health" }` diz se cada chave está configurada, sem mostrar o valor.

## Conferir antes de subir

Não há testes. No mínimo:

```sh
# sintaxe do JavaScript do site
node -e "const s=require('fs').readFileSync('index.html','utf8');new Function([...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]);console.log('ok')"
```

- Para funções em TypeScript, use `deno check supabase/functions/<nome>/index.ts` se o Deno estiver instalado (no ambiente na nuvem ele não vem instalado).
- Para mudanças de tela, abra o `index.html` no navegador (Playwright/Chromium) e use o modo demonstração.
- Pagamento se testa no sandbox do Asaas, nunca em produção.

## Convenções

- Tudo que a pessoa vê, comentários e mensagens de commit: português do Brasil, simples e direto.
- Mensagem de commit: uma frase dizendo o que muda para quem usa, sem prefixo (`feat:`, `fix:`). Exemplo: "Pix: cobrança abre em nova aba e o Quitaí libera o plano sozinho quando o pagamento cai".
- TypeScript e JS: 2 espaços, aspas simples, ponto e vírgula, código compacto. Comentários curtos explicam o porquê.
- Dinheiro no site e nas faturas (`invoices[].amount`) fica em centavos. Na API do Asaas, em reais.
- Planos: `basico`, `pro`, `empresa`. Ciclos: `mensal`, `anual`. Papéis na equipe: `owner`, `admin`, `financeiro`, `leitura`.
