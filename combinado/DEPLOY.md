# Publicar a ORBYTA

Passo a passo do zero até o primeiro cliente pagando. Siga na ordem: cada etapa usa o que a anterior criou.

**Tempo estimado:** 2 a 3 horas para o sistema no ar. A aprovação da Meta (verificação da empresa e dos modelos de mensagem) pode levar alguns dias, então comece a etapa 6 cedo.

## Contas que você vai precisar

| Serviço | Para quê | Custo |
|---|---|---|
| [Supabase](https://supabase.com) | Banco de dados, login, arquivos e funções do servidor | Grátis para testar. Para produção, o plano Pro (cerca de US$ 25 por mês, confira o preço atual), que não pausa por inatividade e tem backup diário |
| [Anthropic](https://console.anthropic.com) | A IA (Claude) | Por uso. Veja “Custos da IA” no fim |
| [Meta for Developers](https://developers.facebook.com) e um portfólio empresarial da Meta | WhatsApp Cloud API | Respostas dentro de 24 horas da mensagem do cliente são gratuitas. Mensagens com modelo (lembretes, resumos) são cobradas por envio, conforme a tabela da Meta para o Brasil |
| [Asaas](https://www.asaas.com) | Cobrar a assinatura (cartão, Pix e boleto) | Taxa por pagamento recebido |
| Hospedagem do site: [Vercel](https://vercel.com), [Netlify](https://netlify.com) ou [Cloudflare Pages](https://pages.cloudflare.com) | Publicar o site e o painel | Grátis no começo |
| Um domínio (ex.: `orbyta.com.br`) e um serviço de e-mail transacional ([Resend](https://resend.com), [Brevo](https://brevo.com) ou Amazon SES) | Endereço do site e e-mails de cadastro | Baixo |

Ferramentas no computador: [Node.js 22+](https://nodejs.org) e [Git](https://git-scm.com). A linha de comando do Supabase roda com `npx supabase`, sem instalar nada.

Nos exemplos abaixo, troque:
- `SEU_REF` pelo identificador do projeto no Supabase (aparece no endereço `https://SEU_REF.supabase.co`);
- `seudominio.com.br` pelo seu domínio.

---

## 1. Banco de dados (Supabase)

1. Crie um projeto em <https://supabase.com/dashboard>. Região: **South America (São Paulo)**. Guarde a senha do banco.
2. No terminal, dentro da pasta `combinado`:

   ```bash
   npm install
   npx supabase login
   npx supabase link --project-ref SEU_REF
   npx supabase db push
   ```

   O `db push` cria as tabelas (inclusive financeiro, estoque, cobranças e notas fiscais), as regras de acesso por empresa (RLS), as funções e gatilhos, o tempo real do painel, a pasta privada de arquivos do WhatsApp (`whatsapp-media`) e os dois agendamentos (`orbyta-automacoes` a cada 5 minutos e `orbyta-manutencao` a cada 10).

3. Gere um segredo longo para o agendador (guarde, ele é usado de novo na etapa 2):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. No painel do Supabase, abra **SQL Editor** e rode (com os seus valores):

   ```sql
   select vault.create_secret('https://SEU_REF.supabase.co', 'project_url');
   select vault.create_secret('O-SEGREDO-GERADO-ACIMA', 'cron_secret');
   ```

5. Confira se os agendamentos existem:

   ```sql
   select jobname, schedule, active from cron.job;
   ```

   Devem aparecer `orbyta-automacoes` e `orbyta-manutencao`. Se a lista vier vazia, ative as extensões **pg_cron** e **pg_net** em **Database → Extensions** e rode `npx supabase db push` de novo.

---

## 2. Segredos das funções do servidor

1. Copie o modelo e preencha:

   ```bash
   cp supabase/functions/.env.example supabase/functions/.env
   ```

   | Variável | O que é |
   |---|---|
   | `ANTHROPIC_API_KEY` | Chave da API da Anthropic (**Console → API Keys**) |
   | `AI_MODEL` | Modelo da IA. Padrão `claude-opus-5-5` |
   | `AI_MODEL_CUSTOMER` | Modelo só das respostas aos clientes (o maior volume). Recomendado: `claude-sonnet-5-5`, que custa metade. Vazio = usa o `AI_MODEL` |
   | `META_APP_ID` | ID do app da Meta (etapa 6) |
   | `META_APP_SECRET` | Chave secreta do app da Meta (etapa 6). Confere a assinatura de cada mensagem recebida |
   | `META_VERIFY_TOKEN` | Uma senha que você inventa, usada para a Meta validar o webhook (etapa 6) |
   | `META_GRAPH_VERSION` | Versão da API da Meta. Padrão `v23.0` |
   | `ASAAS_API_KEY` | Chave da API do Asaas (etapa 7) |
   | `ASAAS_ENV` | `sandbox` para testar, `production` para cobrar de verdade |
   | `ASAAS_WEBHOOK_TOKEN` | Uma senha que você inventa, usada pelo Asaas ao avisar pagamentos (etapa 7) |
   | `CRON_SECRET` | **O mesmo segredo** guardado no Vault como `cron_secret` |
   | `SITE_URL` | Endereço do site, sem barra no final: `https://seudominio.com.br` (vai nos links de orçamento, convites e retorno do pagamento) |
   | `ALLOWED_ORIGINS` | Endereços que podem chamar as funções, separados por vírgula: `https://seudominio.com.br,https://www.seudominio.com.br` |
   | `WA_DEBOUNCE_MS` | Quanto esperar (em milissegundos) por mais mensagens seguidas do cliente antes de responder tudo de uma vez. Padrão `2500` |

   `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem nas funções, não precisa definir.

2. Envie os segredos:

   ```bash
   npx supabase secrets set --env-file supabase/functions/.env
   ```

   O arquivo `.env` não vai para o GitHub (está no `.gitignore`).

---

## 3. Funções do servidor

```bash
npx supabase functions deploy
```

Isso publica as nove funções: `agent`, `whatsapp-webhook`, `whatsapp`, `billing`, `asaas-webhook`, `team`, `cron`, `integrations` (conectar Asaas e Focus NFe da empresa, cobrar e emitir notas) e `cobranca-webhook` (aviso de pagamento das cobranças que as empresas fazem aos clientes delas). Cada uma faz a própria conferência de acesso (as do painel validam o login do usuário; as que recebem chamadas de fora conferem a assinatura da Meta, o token do Asaas ou o segredo do agendador), por isso o `supabase/config.toml` desliga a verificação automática de token do Supabase. Assim elas funcionam com as chaves antigas e com as novas chaves de API do Supabase.

Sempre que mudar algo em `supabase/functions/`, rode esse comando de novo. Se mudou algo em `src/shared/`, rode antes `npm run sync:functions`.

---

## 4. Login e e-mails (Supabase Auth)

1. **Authentication → URL Configuration**
   - **Site URL:** `https://seudominio.com.br` (sem barra no final)
   - **Redirect URLs:** adicione `https://seudominio.com.br/app/**` e, para testar no computador, `http://localhost:5173/app/**`

2. **Authentication → Emails → SMTP Settings:** configure o envio pelo seu serviço de e-mail (Resend, Brevo, SES). O envio padrão do Supabase serve só para testes: tem limite baixo e só entrega para endereços da sua equipe no Supabase. Remetente sugerido: `ORBYTA <nao-responda@seudominio.com.br>`.

3. **Authentication → Emails → Templates:** cole os modelos em português que estão em `supabase/templates/`:

   | Modelo no Supabase | Arquivo | Assunto |
   |---|---|---|
   | Confirm signup | `confirmacao.html` | Confirme seu e-mail na ORBYTA |
   | Invite user | `convite.html` | Seu convite para a equipe na ORBYTA |
   | Reset password | `nova-senha.html` | Crie uma nova senha na ORBYTA |
   | Magic link | `link-de-acesso.html` | Seu link de acesso à ORBYTA |

   Esses modelos usam links que funcionam em qualquer aparelho (a pessoa pode pedir no computador e abrir no celular). O painel também aceita os links dos modelos padrão do Supabase, mas os padrão estão em inglês.

4. **Authentication → Sign In / Providers → Email:** deixe **Confirm email** ligado. Se quiser, aumente o tamanho mínimo da senha para 8 (o painel já exige 8).

5. **Entrar com Google e Microsoft** (**Authentication → Sign In / Providers**). A tela de acesso mostra os dois botões; ative cada um no Supabase (enquanto um não estiver ativo, o botão dele avisa que ainda não está disponível). Em todos, a **Callback URL** é a que o Supabase mostra na página do provedor: `https://SEU_REF.supabase.co/auth/v1/callback`.
   - **Google:** no [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crie um *OAuth client ID* do tipo **Web application**, com a Callback URL acima em *Authorized redirect URIs*. Na *OAuth consent screen*, coloque o nome ORBYTA, o logotipo e os links de `/privacidade/` e `/termos/`. Cole *Client ID* e *Client Secret* no Supabase.
   - **Apple (opcional, desligado por padrão):** para mostrar o botão, inclua `apple` em `VITE_AUTH_PROVIDERS`. Precisa de conta no Apple Developer Program. Crie um *Services ID* com **Sign in with Apple**, cadastre o domínio do site e a Callback URL, e gere uma chave (*Key*) com Sign in with Apple. No Supabase informe o Services ID, o Team ID, o Key ID e a chave (o Supabase gera o segredo; ele vence a cada 6 meses e precisa ser renovado).
   - **Microsoft:** no [portal do Azure](https://portal.azure.com) → *App registrations* → *New registration*, em *Supported account types* escolha contas de qualquer organização **e** contas pessoais da Microsoft, e use a Callback URL como *Redirect URI (Web)*. Crie um *client secret* e cole *Application (client) ID* e o segredo no provedor **Azure** do Supabase, com a URL `https://login.microsoftonline.com/common`.
   - Para esconder algum botão, defina no site `VITE_AUTH_PROVIDERS` (ex.: `google,microsoft`; `nenhum` esconde todos).
   - Quem entra pela primeira vez com um desses botões cai direto na criação da empresa, já com o nome que veio da conta.

---

## 5. Site e painel (hospedagem)

Variáveis de ambiente do site (modelo em `.env.example`):

| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://SEU_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Chave pública do projeto (**Project Settings → API Keys**, a chave `anon`/publishable. Nunca use a `service_role` aqui) |
| `VITE_SITE_URL` | `https://seudominio.com.br` (vai nas tags de compartilhamento do site) |
| `VITE_META_APP_ID` | Opcional: ID do app da Meta, para o botão “Conectar com a Meta” |
| `VITE_META_CONFIG_ID` | Opcional: ID da configuração do cadastro incorporado (etapa 6) |
| `VITE_AUTH_PROVIDERS` | Opcional: botões de login social que aparecem (padrão `google,microsoft`; inclua `apple` se ativar; `nenhum` esconde) |

**Vercel:** *Add New → Project*, escolha o repositório, **Root Directory** `combinado`, preset **Vite**, comando `npm run build`, saída `dist`. Coloque as variáveis acima e publique.

**Netlify:** *Add new site → Import an existing project*, **Base directory** `combinado`, **Build command** `npm run build`, **Publish directory** `combinado/dist`, mais as variáveis.

**Cloudflare Pages:** *Create → Pages → Connect to Git*, **Root directory** `combinado`, **Build command** `npm run build`, **Build output** `dist`, mais as variáveis.

Não precisa de regra de redirecionamento: o site tem uma página para cada endereço (`/`, `/app/`, `/orcamento/`, `/termos/`, `/privacidade/`) e o painel usa rotas com `#`.

Depois, ligue o seu domínio na hospedagem e confira:
- `https://seudominio.com.br/` abre o site;
- `https://seudominio.com.br/app/` abre a tela de entrar;
- **Criar conta** manda o e-mail de confirmação, e o link leva para a criação da empresa.

---

## 6. WhatsApp (Meta)

### 6.1 App e webhook

1. Em <https://business.facebook.com>, crie (ou use) o portfólio empresarial da sua empresa. Em **Configurações → Central de segurança**, faça a **verificação da empresa** (necessária para sair dos limites de teste).
2. Em <https://developers.facebook.com/apps>, **Criar app → Outro → Empresa** e adicione o produto **WhatsApp**.
3. Em **Configurações do app → Básico**, copie o **ID do app** (`META_APP_ID` e `VITE_META_APP_ID`) e a **Chave secreta do app** (`META_APP_SECRET`). Atualize os segredos (etapa 2) se ainda não tinha esses valores.
4. Em **WhatsApp → Configuração → Webhook**:
   - **URL de callback:** `https://SEU_REF.supabase.co/functions/v1/whatsapp-webhook`
   - **Token de verificação:** o mesmo `META_VERIFY_TOKEN`
   - Clique em **Verificar e salvar** e, em **Campos do webhook**, assine **messages**.
5. Coloque o app no modo **Ao vivo** (exige política de privacidade: use `https://seudominio.com.br/privacidade/`).

### 6.2 Conectar um número

Há dois jeitos. Comece pelo primeiro.

**A) Com credenciais (para o seu número e os primeiros clientes)**

1. Em **WhatsApp → Configuração da API**, adicione e verifique o número da empresa. Anote o **Identificação do número de telefone** e o **Identificação da conta do WhatsApp Business (WABA)**.
2. No portfólio empresarial, **Configurações → Usuários do sistema → Adicionar** (função Administrador). Em **Atribuir ativos**, dê controle total do app e da conta do WhatsApp. Gere um token **sem expiração** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
3. No painel da ORBYTA: **Configurações → WhatsApp → Conectar com credenciais**. Informe os dois identificadores e o token. Se o número é novo na API, informe também um **PIN de 6 números**: a ORBYTA registra o número com ele (se o número já tem verificação em duas etapas, use o mesmo PIN).

**B) Cadastro incorporado (o cliente conecta sozinho, com o login da Meta)**

Exige que o seu app seja aprovado como **Provedor de Tecnologia** da Meta (verificação da empresa e revisão do app com acesso avançado às duas permissões acima).

1. No app, adicione **Login do Facebook para Empresas → Configurações → Criar configuração**, com a variação de login **Cadastro incorporado do WhatsApp**. Copie o **ID da configuração** para `VITE_META_CONFIG_ID`.
2. Em **Login do Facebook para Empresas → Configurações**, ligue **Login com o SDK do JavaScript** e adicione `seudominio.com.br` em **Domínios permitidos**.
3. Publique o site de novo (as variáveis `VITE_` entram na hora da construção). O botão **Conectar com a Meta** aparece em **Configurações → WhatsApp**.

### 6.3 Modelos de mensagem

Fora das 24 horas depois da última mensagem do cliente, o WhatsApp só deixa a empresa escrever com um modelo aprovado. As automações usam estes (cadastre em **Gerenciador do WhatsApp → Modelos de mensagem**, idioma **Português (BR)**, com o nome e o texto exatos). Os textos também aparecem no painel em **Configurações → WhatsApp**, com botão de copiar, e ficam em `src/shared/templates.ts`.

| Nome | Categoria | Texto |
|---|---|---|
| `orcamento_enviado` | Utilidade | Olá, {{1}}! Segue o seu orçamento nº {{2}} no valor de {{3}}: {{4}} É só abrir o link para conferir e aprovar. |
| `lembrete_agendamento` | Utilidade | Olá, {{1}}! Passando para lembrar do seu horário de {{2}} {{3}}, às {{4}}. Responda SIM para confirmar ou me avise se precisar remarcar. |
| `acompanhamento_orcamento` | Utilidade | Olá, {{1}}! Passando para saber se ficou alguma dúvida sobre o orçamento nº {{2}} ({{3}}). O link continua aqui: {{4}} |
| `pos_atendimento` | Marketing | Olá, {{1}}! Obrigado por escolher a {{2}}. {{3}} |
| `reativacao_cliente` | Marketing | Olá, {{1}}! Sentimos sua falta na {{2}}. {{3}} |
| `resumo_diario` | Utilidade | Resumo de hoje na {{1}}: {{2}}. Responda esta mensagem para ver os detalhes. |
| `lembrete_tarefa` | Utilidade | Lembrete da ORBYTA: {{1}}. Responda esta mensagem se precisar de algo. |
| `aviso_equipe` | Utilidade | Aviso da ORBYTA: {{1}}. Abra o painel para ver os detalhes. |
| `cobranca_cliente` | Utilidade | Olá, {{1}}! Segue a cobrança de {{2}} referente a {{3}}, com vencimento em {{4}}. Para pagar com Pix ou boleto, é só abrir o link: {{5}} |

Os modelos são de cada conta do WhatsApp: no cadastro incorporado, cada cliente precisa tê-los na própria conta (eles aparecem no painel para copiar).

### 6.4 Comandos pelo WhatsApp do dono

No painel, **Configurações → WhatsApp → Verificar meu número**. Mande o código mostrado, do seu WhatsApp pessoal, para o número da empresa. A partir daí a IA reconhece você e executa os comandos, pedindo confirmação nas ações sensíveis. Cada pessoa da equipe verifica o próprio número.

---

## 7. Pagamentos (Asaas)

Esta seção é a **assinatura da ORBYTA** (as empresas pagando você). A cobrança que cada empresa faz aos clientes dela usa a conta Asaas da própria empresa e está na seção 7.1.

Teste tudo primeiro no ambiente de testes (<https://sandbox.asaas.com>) com `ASAAS_ENV=sandbox`. Depois troque para a conta de produção.

1. **Integrações → Chaves de API:** gere a chave e coloque em `ASAAS_API_KEY`.
2. **Integrações → Webhooks → Adicionar:**
   - **URL:** `https://SEU_REF.supabase.co/functions/v1/asaas-webhook`
   - **Token de autenticação:** o mesmo `ASAAS_WEBHOOK_TOKEN`
   - **Eventos:** todos os de **Cobranças**, todos os de **Assinaturas** e o **Checkout pago** (`CHECKOUT_PAID`)
   - Versão da API: v3. Deixe a fila ativa.
3. **Minha conta → Informações:** cadastre o site `https://seudominio.com.br`. O Checkout do Asaas só volta para endereços do domínio cadastrado.
4. Atualize os segredos (`npx supabase secrets set --env-file supabase/functions/.env`).

Como funciona: o cartão vai pelo Checkout do Asaas com cobrança recorrente. Pix e boleto viram uma assinatura com fatura mensal ou anual. O webhook mantém o plano em dia: libera quando paga, dá 7 dias de tolerância quando atrasa e bloqueia em caso de estorno ou contestação. Se um pagamento não liberar o plano, o botão **Já paguei** em **Configurações → Assinatura** confere direto no Asaas.

Os preços dos planos ficam na tabela `plans` do banco e em `src/shared/plans.ts` (o servidor confere o valor pelo banco). Para mudar um preço, altere os dois e publique de novo.

### 7.1 Cobrança dos clientes e nota fiscal (cada empresa conecta a sua)

Nada para configurar no servidor: cada empresa conecta as próprias contas em **Integrações**, e as chaves ficam guardadas só no banco (tabela `integration_credentials`, que nem a equipe da empresa consegue ler).

**Cobrança (Asaas da empresa)**

1. A empresa cria a conta dela no Asaas (comece pelo sandbox) e gera a chave em **Integrações → Chaves de API**.
2. No painel: **Integrações → Cobrança dos seus clientes → Conectar**, escolhe o ambiente e cola a chave.
3. A ORBYTA confere a chave e cadastra sozinha o webhook `https://SEU_REF.supabase.co/functions/v1/cobranca-webhook?empresa=<id>` com um token próprio da empresa. Se o Asaas recusar, o painel mostra a URL e o token para cadastrar à mão.
4. Cobranças: pelo painel (**Cobranças e notas**) ou pelo WhatsApp do dono (“cobra R$ 250 da Juliana para sexta”, com confirmação). O Asaas exige CPF ou CNPJ do cliente (campo no cadastro do cliente). A cobrança entra em Financeiro → a receber; quando é paga, vira venda e a conta é baixada. O link vai pelo WhatsApp (dentro das 24 horas como mensagem normal; fora, pelo modelo `cobranca_cliente`).

**Nota fiscal de serviço (Focus NFe da empresa)**

1. A empresa contrata a Focus NFe, cadastra o CNPJ e envia o certificado digital A1 no painel da Focus.
2. No painel: **Integrações → Nota fiscal de serviço → Conectar**, com o token da Focus e os dados fiscais (CNPJ, inscrição municipal, código IBGE do município, item da lista de serviço, alíquota do ISS, Simples Nacional). Esses dados vêm do contador.
3. Comece em **homologação**: as notas de teste não valem. Cada prefeitura tem exigências próprias; se recusar, o motivo aparece na lista de notas.
4. A emissão é assíncrona: o agendador `orbyta-automacoes` consulta as notas em processamento e avisa a equipe quando a prefeitura autoriza ou recusa. Só NFS-e (serviço); NF-e de produto ainda não.

---

## 8. Primeiro acesso

1. Abra `https://seudominio.com.br/app/`, crie a sua conta, confirme o e-mail e cadastre a empresa (os serviços de exemplo do ramo já vêm prontos para editar).
2. Torne-se administrador da plataforma (no **SQL Editor**):

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'voce@seudominio.com.br';
   ```

   A página **Admin** aparece no menu, com empresas, assinaturas e uso da IA.
3. Para dar uma conta cortesia (sem cobrança), por exemplo para a sua própria empresa:

   ```sql
   update public.companies set complimentary = true, plan = 'empresa', billing_status = 'active'
   where id = (select company_id from public.members where email = 'voce@seudominio.com.br');
   ```

4. Teste no **Simulador** do painel, depois mande uma mensagem de outro celular para o número conectado.

---

## 9. Textos legais

Em `termos/index.html` e `privacidade/index.html`, os trechos marcados em amarelo (`<mark class="fill">`) precisam dos dados da sua empresa: razão social, CNPJ, endereço, e-mail de contato e do encarregado de dados (LGPD), região dos servidores (São Paulo, se seguiu a etapa 1) e foro. Peça para um advogado revisar antes de lançar.

---

## 10. Custos da IA

Medido no código: cada resposta a um cliente envia cerca de 10 mil caracteres fixos (regras, catálogo e ferramentas, guardados em cache pela Anthropic) mais a conversa recente, e usa uma ou duas chamadas ao modelo (duas quando consulta horários ou agenda). Os comandos do dono usam mais ferramentas e raciocinam mais.

Estimativa por resposta, em dólares (preços da Anthropic: Opus 5.5 a US$ 4 / US$ 20 por milhão de tokens de entrada / saída; Sonnet 5.5 a US$ 2 / US$ 10; leitura de cache a US$ 0,20 nos dois):

| | Opus 5.5 | Sonnet 5.5 |
|---|---|---|
| Resposta a cliente | US$ 0,02 a 0,04 | US$ 0,01 a 0,02 |
| Comando do dono | US$ 0,05 a 0,08 | US$ 0,03 a 0,04 |

O valor menor vale para empresas com conversas frequentes (o cache fica ativo). O maior, para mensagens espaçadas.

Custo máximo por empresa se ela usar **todas** as respostas do plano:

| Plano | Preço | Respostas/mês | Tudo no Opus 5.5 | Clientes no Sonnet 5.5 |
|---|---|---|---|---|
| Essencial | R$ 149 | 500 | US$ 10 a 20 | US$ 5 a 10 |
| Profissional | R$ 299 | 1.500 | US$ 30 a 60 | US$ 15 a 30 |
| Empresa | R$ 699 | 4.000 | US$ 80 a 160 | US$ 45 a 80 |

Multiplique pela cotação do dólar. Com o dólar a R$ 5,50, o plano Empresa todo no Opus pode custar até R$ 880 de IA, mais que o preço do plano. Por isso a recomendação para o lançamento:

- `AI_MODEL_CUSTOMER=claude-sonnet-5-5`: atendimento rápido e bom, pela metade do custo;
- `AI_MODEL=claude-opus-5-5` (padrão): os comandos do dono, que são menos e mais complexos.

No Console da Anthropic, defina um **limite de gasto mensal** (**Settings → Limits**) e acompanhe o uso por empresa na página **Admin** do painel. Se o custo médio ficar alto, ajuste os limites de respostas dos planos (tabela `plans` e `src/shared/plans.ts`).

---

## 11. Antes de lançar

- [ ] `npm run build` sem erros e site publicado no domínio
- [ ] Criar conta, confirmar e-mail e criar empresa funcionam
- [ ] Esqueci a senha: o e-mail chega e o link abre **Criar nova senha**
- [ ] Convite de equipe: o e-mail chega e a pessoa consegue criar a senha
- [ ] WhatsApp conectado: mensagem de outro celular recebe resposta da IA
- [ ] Comando pelo WhatsApp do dono (depois de verificar o número) cria cliente e orçamento
- [ ] Orçamento enviado abre em `/orcamento/` e a aprovação aparece no painel
- [ ] Agendamentos rodando: `select * from cron.job_run_details order by start_time desc limit 5;` sem erros
- [ ] Assinatura no ambiente de testes do Asaas: cartão e Pix liberam o plano
- [ ] Modelos de mensagem aprovados na Meta
- [ ] Textos legais preenchidos e revisados
- [ ] Limite de gasto definido no Console da Anthropic
- [ ] `ASAAS_ENV=production` com a chave de produção e o webhook da conta de produção

---

## Problemas comuns

**A Meta não valida o webhook.** O token de verificação no app da Meta precisa ser idêntico ao `META_VERIFY_TOKEN`, e a função precisa estar publicada. Teste: `https://SEU_REF.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123` deve mostrar `123`.

**A mensagem chega no painel, mas a IA não responde.** Confira, em ordem: `ANTHROPIC_API_KEY` definida; IA ligada em **Configurações → Assistente IA**; conversa não está com a equipe (atendimento humano); limite de respostas do plano; assinatura em dia. Os registros ficam em **Edge Functions → whatsapp-webhook → Logs**.

**Mensagens recebidas não aparecem.** O campo **messages** precisa estar assinado no webhook e o app precisa estar **Ao vivo**. Ao conectar, a ORBYTA inscreve o app na conta do WhatsApp; se trocou de token, conecte de novo.

**“O WhatsApp só permite escrever com um modelo aprovado.”** Passaram 24 horas desde a última mensagem do cliente. A automação usa o modelo correspondente, que precisa estar aprovado com o nome exato.

**Os lembretes e o resumo do dia não saem.** Confira `select * from cron.job_run_details order by start_time desc limit 10;` e as respostas em `select * from net._http_response order by created desc limit 10;`. Status 401 significa que o `CRON_SECRET` das funções está diferente do `cron_secret` do Vault.

**Os e-mails de cadastro não chegam.** Configure o SMTP próprio (etapa 4) e confira a caixa de spam. No serviço de e-mail, valide o domínio (registros SPF e DKIM).

**Pagou e o plano não liberou.** Confira o webhook no Asaas (fila pausada ou erros) e se o token é igual ao `ASAAS_WEBHOOK_TOKEN`. O botão **Já paguei** força a conferência.
