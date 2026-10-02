-- Combinado — base do banco: tabelas, índices, funções de acesso e regras de segurança (RLS).
-- Cada empresa só enxerga e altera os próprios dados. Quem escreve dados "de sistema" (mensagens do
-- WhatsApp, cobrança, uso da IA) são as Edge Functions, com a chave de serviço, que ignora o RLS.

create extension if not exists pgcrypto with schema extensions;

/* =========================================================================================
   Planos (fonte da verdade de preços e limites no servidor; o site tem uma cópia em shared/plans.ts)
   ========================================================================================= */
create table public.plans (
  id text primary key check (id in ('teste', 'essencial', 'profissional', 'empresa')),
  name text not null,
  monthly numeric(10, 2) not null,
  yearly numeric(10, 2) not null,
  ai_replies int not null,
  users int not null,
  automations boolean not null default true
);
insert into public.plans (id, name, monthly, yearly, ai_replies, users, automations) values
  ('teste', 'Teste grátis', 0, 0, 100, 2, true),
  ('essencial', 'Essencial', 149, 1490, 500, 2, false),
  ('profissional', 'Profissional', 299, 2990, 1500, 5, true),
  ('empresa', 'Empresa', 699, 6990, 4000, 15, true);

/* =========================================================================================
   Empresas e pessoas
   ========================================================================================= */
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  segment text not null default 'outro',
  document text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  timezone text not null default 'America/Sao_Paulo',
  business_hours jsonb not null default '{"1":[["08:00","18:00"]],"2":[["08:00","18:00"]],"3":[["08:00","18:00"]],"4":[["08:00","18:00"]],"5":[["08:00","18:00"]],"6":[["08:00","12:00"]]}'::jsonb,
  slot_minutes int not null default 30 check (slot_minutes between 5 and 240),
  capacity_per_slot int not null default 1 check (capacity_per_slot between 1 and 50),
  min_notice_minutes int not null default 60 check (min_notice_minutes between 0 and 10080),
  max_days_ahead int not null default 30 check (max_days_ahead between 1 and 365),
  monthly_goal numeric(12, 2) not null default 0 check (monthly_goal >= 0),
  plan text not null default 'teste' references public.plans (id),
  billing_status text not null default 'trialing' check (billing_status in ('trialing', 'active', 'past_due', 'canceled', 'blocked')),
  billing_cycle text check (billing_cycle in ('mensal', 'anual')),
  billing_method text check (billing_method in ('cartao', 'pix_boleto')),
  trial_ends_at timestamptz not null default now() + interval '7 days',
  current_period_end date,
  canceled_at timestamptz,
  complimentary boolean not null default false,
  owner_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'atendente' check (role in ('dono', 'gerente', 'atendente')),
  name text not null default '',
  email text not null default '',
  phone text,
  phone_verified_at timestamptz,
  active boolean not null default true,
  invited boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id),
  unique (user_id) -- cada pessoa participa de uma empresa
);
create index members_phone_idx on public.members (phone) where phone_verified_at is not null;

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.ai_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  enabled boolean not null default true,
  assistant_name text not null default 'Assistente' check (length(assistant_name) <= 40),
  tone text not null default 'amigavel' check (tone in ('amigavel', 'profissional', 'descontraido')),
  use_emojis boolean not null default true,
  instructions text not null default '' check (length(instructions) <= 8000),
  greeting text not null default '' check (length(greeting) <= 500),
  schedule_mode text not null default 'sempre' check (schedule_mode in ('sempre', 'fora_do_horario', 'horario_comercial')),
  booking_mode text not null default 'automatico' check (booking_mode in ('automatico', 'confirmar')),
  can_quote boolean not null default true,
  max_discount_pct numeric(5, 2) not null default 10 check (max_discount_pct between 0 and 100),
  handoff_on_complaint boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.whatsapp_accounts (
  company_id uuid primary key references public.companies (id) on delete cascade,
  phone_number_id text unique,
  waba_id text,
  display_phone text,
  verified_name text,
  status text not null default 'desconectado' check (status in ('desconectado', 'conectado', 'erro')),
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
-- token de acesso da Meta: só as Edge Functions leem (sem políticas de RLS e sem permissões para o painel)
create table public.whatsapp_credentials (
  company_id uuid primary key references public.companies (id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);

create table public.billing_accounts (
  company_id uuid primary key references public.companies (id) on delete cascade,
  asaas_customer_id text,
  asaas_subscription_id text unique,
  asaas_checkout_id text unique,
  pending jsonb, -- plano/ciclo escolhidos aguardando o primeiro pagamento
  access_revoked boolean not null default false, -- estorno ou contestação: não devolve o acesso sozinho
  updated_at timestamptz not null default now()
);

create table public.company_counters (
  company_id uuid primary key references public.companies (id) on delete cascade,
  quote_seq int not null default 0
);

/* =========================================================================================
   Negócio: clientes, serviços, orçamentos, agenda, vendas e tarefas
   ========================================================================================= */
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text,
  wa_name text,
  email text,
  address text,
  notes text,
  tags text[] not null default '{}',
  stage text not null default 'novo' check (stage in ('novo', 'conversando', 'orcamento', 'fechado', 'perdido')),
  temperature text not null default 'morno' check (temperature in ('quente', 'morno', 'frio')),
  score int not null default 50 check (score between 0 and 100),
  source text not null default 'manual' check (source in ('whatsapp', 'manual', 'indicacao', 'instagram', 'site', 'outro')),
  opt_in boolean not null default true,
  birthday date,
  last_interaction_at timestamptz,
  total_spent numeric(12, 2) not null default 0,
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contacts_phone_uq on public.contacts (company_id, phone) where phone is not null;
create index contacts_company_created_idx on public.contacts (company_id, created_at desc);
create index contacts_company_last_idx on public.contacts (company_id, last_interaction_at desc nulls last);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  price numeric(12, 2) not null default 0 check (price >= 0),
  price_type text not null default 'fixo' check (price_type in ('fixo', 'a_partir_de', 'sob_consulta')),
  duration_min int not null default 60 check (duration_min between 5 and 1440),
  category text,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_company_idx on public.services (company_id, sort);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number int not null default 0,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  title text,
  status text not null default 'rascunho' check (status in ('rascunho', 'enviado', 'aprovado', 'recusado', 'expirado')),
  subtotal numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  total numeric(12, 2) not null default 0,
  valid_until date,
  notes text,
  public_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  sent_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  response_note text,
  followup_sent_at timestamptz,
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index quotes_company_created_idx on public.quotes (company_id, created_at desc);
create index quotes_contact_idx on public.quotes (contact_id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  description text not null default '',
  qty numeric(10, 2) not null default 1 check (qty > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  sort int not null default 0
);
create index quote_items_quote_idx on public.quote_items (quote_id, sort);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  service_id uuid references public.services (id) on delete set null,
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmado' check (status in ('pendente', 'confirmado', 'concluido', 'cancelado', 'faltou')),
  address text,
  notes text,
  price numeric(12, 2),
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_company_start_idx on public.appointments (company_id, starts_at);
create index appointments_contact_idx on public.appointments (contact_id);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  quote_id uuid references public.quotes (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  description text not null default '',
  amount numeric(12, 2) not null check (amount > 0),
  method text not null default 'pix' check (method in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro')),
  origin text not null default 'equipe' check (origin in ('ia', 'equipe', 'balcao')),
  paid_at timestamptz not null default now(),
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now()
);
create index sales_company_paid_idx on public.sales (company_id, paid_at desc);
create index sales_contact_idx on public.sales (contact_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  due_at timestamptz,
  done_at timestamptz,
  contact_id uuid references public.contacts (id) on delete set null,
  reminded_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now()
);
create index tasks_company_due_idx on public.tasks (company_id, done_at, due_at);

/* =========================================================================================
   Conversas, mensagens e ações da IA
   ========================================================================================= */
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  member_user_id uuid references auth.users (id) on delete cascade,
  kind text not null default 'cliente' check (kind in ('cliente', 'dono')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'painel', 'simulador')),
  handler text not null default 'ia' check (handler in ('ia', 'humano')),
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  needs_attention boolean not null default false,
  attention_reason text,
  unread int not null default 0 check (unread >= 0),
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,
  awaiting_since timestamptz, -- primeira mensagem do cliente ainda sem resposta (tempo de resposta)
  ai_lock_until timestamptz, -- a IA está respondendo esta conversa (evita duas respostas ao mesmo tempo)
  ai_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index conversations_contact_uq on public.conversations (company_id, contact_id, channel) where kind = 'cliente' and contact_id is not null;
create unique index conversations_member_uq on public.conversations (company_id, member_user_id, channel) where kind = 'dono';
create index conversations_company_last_idx on public.conversations (company_id, last_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  sender text not null check (sender in ('contato', 'ia', 'equipe', 'sistema', 'dono')),
  sender_name text,
  body text not null default '',
  media jsonb,
  wa_message_id text unique,
  wa_status text check (wa_status in ('enviada', 'entregue', 'lida', 'falhou')),
  actions jsonb,
  response_seconds int,
  channel text check (channel in ('whatsapp', 'painel', 'simulador')),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_company_created_idx on public.messages (company_id, created_at);

create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  summary text not null,
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'cancelada', 'expirada', 'erro')),
  requested_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index pending_actions_company_idx on public.pending_actions (company_id, status, created_at desc);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_type text not null check (actor_type in ('usuario', 'ia', 'sistema', 'cliente')),
  actor_name text,
  actor_user_id uuid,
  channel text not null default 'painel' check (channel in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  action text not null,
  summary text not null,
  target_type text,
  target_id uuid,
  status text not null default 'ok' check (status in ('ok', 'erro', 'negado', 'aguardando', 'cancelado')),
  meta jsonb,
  created_at timestamptz not null default now()
);
create index audit_company_created_idx on public.audit_log (company_id, created_at desc);
create index audit_company_action_idx on public.audit_log (company_id, action, created_at);

/* =========================================================================================
   Automações, avisos, cobrança e uso
   ========================================================================================= */
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('lembrete_agendamento', 'followup_orcamento', 'resumo_diario', 'pos_atendimento', 'reativacao', 'lembrete_tarefa')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  template_name text,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, kind)
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  automation_id uuid references public.automations (id) on delete set null,
  kind text not null,
  target_key text not null, -- evita enviar duas vezes a mesma coisa (ex.: id do agendamento)
  target_label text not null default '',
  status text not null check (status in ('enviado', 'falhou', 'ignorado')),
  detail text,
  ran_at timestamptz not null default now(),
  unique (company_id, kind, target_key)
);
create index automation_runs_company_idx on public.automation_runs (company_id, ran_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade, -- nulo = para toda a equipe
  kind text not null check (kind in ('atendimento', 'agendamento', 'orcamento', 'venda', 'sistema', 'tarefa', 'assinatura')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_company_idx on public.notifications (company_id, created_at desc);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  asaas_payment_id text unique,
  amount numeric(12, 2) not null,
  status text not null check (status in ('paga', 'pendente', 'vencida', 'reembolsada', 'contestada', 'cancelada')),
  due_date date not null,
  paid_at timestamptz,
  method text check (method in ('cartao', 'pix', 'boleto')),
  url text,
  description text not null default '',
  created_at timestamptz not null default now()
);
create index invoices_company_idx on public.invoices (company_id, due_date desc);

create table public.usage_monthly (
  company_id uuid not null references public.companies (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  ai_replies int not null default 0,
  wa_sent int not null default 0,
  ai_input_tokens bigint not null default 0,
  ai_output_tokens bigint not null default 0,
  warned_80 boolean not null default false,
  primary key (company_id, month)
);

create table public.owner_link_codes (
  code text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- idempotência dos webhooks (Asaas e outros)
create table public.webhook_events (
  id text primary key,
  provider text not null,
  received_at timestamptz not null default now()
);

/* =========================================================================================
   Funções de acesso (usadas nas regras de RLS)
   ========================================================================================= */
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.members where user_id = auth.uid() and active limit 1
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and active limit 1
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any (roles) from public.members where user_id = auth.uid() and active limit 1), false)
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- A empresa pode criar e alterar dados? (teste em andamento, assinatura em dia, período pago não acabou ou cortesia)
create or replace function public.company_writable(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.complimentary
        or c.billing_status = 'active'
        or (c.billing_status = 'trialing' and c.trial_ends_at > now())
        or (c.billing_status = 'past_due' and coalesce(c.current_period_end, current_date) + 7 >= current_date)
        or (c.billing_status = 'canceled' and c.current_period_end is not null and c.current_period_end >= current_date)
    from public.companies c where c.id = cid
  ), false)
$$;

/* =========================================================================================
   RLS: liga em todas as tabelas e define o que o painel (usuário autenticado) pode fazer
   ========================================================================================= */
alter table public.plans enable row level security;
alter table public.companies enable row level security;
alter table public.members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.ai_settings enable row level security;
alter table public.whatsapp_accounts enable row level security;
alter table public.whatsapp_credentials enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.company_counters enable row level security;
alter table public.contacts enable row level security;
alter table public.services enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.appointments enable row level security;
alter table public.sales enable row level security;
alter table public.tasks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.pending_actions enable row level security;
alter table public.audit_log enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.invoices enable row level security;
alter table public.usage_monthly enable row level security;
alter table public.owner_link_codes enable row level security;
alter table public.webhook_events enable row level security;

-- Permissões de tabela: o visitante anônimo não acessa nada direto (a página pública do orçamento usa funções).
revoke all on all tables in schema public from anon;
revoke all on public.whatsapp_credentials, public.billing_accounts, public.company_counters, public.owner_link_codes, public.webhook_events from authenticated;
revoke insert, update, delete on public.plans, public.platform_admins, public.whatsapp_accounts, public.messages, public.pending_actions,
  public.audit_log, public.automation_runs, public.invoices, public.usage_monthly from authenticated;
revoke insert, delete on public.companies, public.ai_settings, public.automations from authenticated;
revoke insert on public.conversations from authenticated;
revoke update on public.companies, public.members, public.conversations, public.notifications, public.ai_settings, public.automations from authenticated;
-- só as colunas que o painel pode mudar
grant update (name, segment, document, phone, email, address, city, state, timezone, business_hours, slot_minutes, capacity_per_slot, min_notice_minutes, max_days_ahead, monthly_goal) on public.companies to authenticated;
grant update (role, active, name, phone) on public.members to authenticated;
grant update (handler, status, needs_attention, attention_reason, unread) on public.conversations to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (enabled, assistant_name, tone, use_emojis, instructions, greeting, schedule_mode, booking_mode, can_quote, max_discount_pct, handoff_on_complaint) on public.ai_settings to authenticated;
grant update (enabled, config, template_name) on public.automations to authenticated;

create policy plans_read on public.plans for select to authenticated using (true);

create policy companies_read on public.companies for select to authenticated using (id = public.my_company());
create policy companies_update on public.companies for update to authenticated
  using (id = public.my_company() and public.has_role('dono', 'gerente')) with check (id = public.my_company());

create policy members_read on public.members for select to authenticated using (company_id = public.my_company());
create policy members_update on public.members for update to authenticated
  using (company_id = public.my_company() and (public.has_role('dono') or user_id = auth.uid()))
  with check (company_id = public.my_company());

create policy platform_admins_read on public.platform_admins for select to authenticated using (user_id = auth.uid());

create policy ai_settings_read on public.ai_settings for select to authenticated using (company_id = public.my_company());
create policy ai_settings_update on public.ai_settings for update to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente')) with check (company_id = public.my_company());

create policy whatsapp_read on public.whatsapp_accounts for select to authenticated using (company_id = public.my_company());

-- dados do negócio: todos da equipe leem; criar e alterar exigem a assinatura ativa
create policy contacts_read on public.contacts for select to authenticated using (company_id = public.my_company());
create policy contacts_insert on public.contacts for insert to authenticated with check (company_id = public.my_company() and public.company_writable(company_id));
create policy contacts_update on public.contacts for update to authenticated
  using (company_id = public.my_company() and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy contacts_delete on public.contacts for delete to authenticated using (company_id = public.my_company() and public.has_role('dono', 'gerente'));

create policy services_read on public.services for select to authenticated using (company_id = public.my_company());
create policy services_insert on public.services for insert to authenticated
  with check (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id));
create policy services_update on public.services for update to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy services_delete on public.services for delete to authenticated using (company_id = public.my_company() and public.has_role('dono', 'gerente'));

create policy quotes_read on public.quotes for select to authenticated using (company_id = public.my_company());
create policy quotes_insert on public.quotes for insert to authenticated with check (company_id = public.my_company() and public.company_writable(company_id));
create policy quotes_update on public.quotes for update to authenticated
  using (company_id = public.my_company() and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy quotes_delete on public.quotes for delete to authenticated using (company_id = public.my_company() and public.has_role('dono', 'gerente'));

create policy quote_items_read on public.quote_items for select to authenticated using (company_id = public.my_company());
create policy quote_items_insert on public.quote_items for insert to authenticated with check (company_id = public.my_company() and public.company_writable(company_id));
create policy quote_items_update on public.quote_items for update to authenticated
  using (company_id = public.my_company() and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy quote_items_delete on public.quote_items for delete to authenticated using (company_id = public.my_company() and public.company_writable(company_id));

create policy appointments_read on public.appointments for select to authenticated using (company_id = public.my_company());
create policy appointments_insert on public.appointments for insert to authenticated with check (company_id = public.my_company() and public.company_writable(company_id));
create policy appointments_update on public.appointments for update to authenticated
  using (company_id = public.my_company() and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy appointments_delete on public.appointments for delete to authenticated using (company_id = public.my_company() and public.has_role('dono', 'gerente'));

create policy sales_read on public.sales for select to authenticated using (company_id = public.my_company());
create policy sales_insert on public.sales for insert to authenticated with check (company_id = public.my_company() and public.company_writable(company_id));
create policy sales_update on public.sales for update to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy sales_delete on public.sales for delete to authenticated using (company_id = public.my_company() and public.has_role('dono', 'gerente'));

create policy tasks_read on public.tasks for select to authenticated using (company_id = public.my_company());
create policy tasks_insert on public.tasks for insert to authenticated with check (company_id = public.my_company() and public.company_writable(company_id));
create policy tasks_update on public.tasks for update to authenticated
  using (company_id = public.my_company() and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy tasks_delete on public.tasks for delete to authenticated using (company_id = public.my_company());

create policy conversations_read on public.conversations for select to authenticated
  using (company_id = public.my_company() and (kind = 'cliente' or member_user_id = auth.uid()));
create policy conversations_update on public.conversations for update to authenticated
  using (company_id = public.my_company() and kind = 'cliente') with check (company_id = public.my_company());

create policy messages_read on public.messages for select to authenticated
  using (company_id = public.my_company() and exists (
    select 1 from public.conversations c where c.id = conversation_id and (c.kind = 'cliente' or c.member_user_id = auth.uid())));

create policy pending_read on public.pending_actions for select to authenticated
  using (company_id = public.my_company() and exists (
    select 1 from public.conversations c where c.id = conversation_id and (c.kind = 'cliente' or c.member_user_id = auth.uid())));

create policy audit_read on public.audit_log for select to authenticated using (company_id = public.my_company());

create policy automations_read on public.automations for select to authenticated using (company_id = public.my_company());
create policy automations_update on public.automations for update to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente')) with check (company_id = public.my_company());
create policy automation_runs_read on public.automation_runs for select to authenticated using (company_id = public.my_company());

create policy notifications_read on public.notifications for select to authenticated
  using (company_id = public.my_company() and (user_id is null or user_id = auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (company_id = public.my_company() and (user_id is null or user_id = auth.uid())) with check (company_id = public.my_company());

create policy invoices_read on public.invoices for select to authenticated using (company_id = public.my_company() and public.has_role('dono'));
create policy usage_read on public.usage_monthly for select to authenticated using (company_id = public.my_company());
