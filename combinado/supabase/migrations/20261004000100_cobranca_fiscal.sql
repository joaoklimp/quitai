-- ORBYTA — cobrança dos clientes da empresa (Asaas da própria empresa) e emissão de nota fiscal de serviço (Focus NFe).
-- As chaves de cada empresa ficam em integration_credentials, fora do alcance do painel (só as Edge Functions leem).

alter table public.contacts add column document text check (document ~ '^[0-9]{11}$|^[0-9]{14}$'); -- CPF ou CNPJ, só números

/* ---------- integrações da empresa ---------- */
create table public.company_integrations (
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null check (provider in ('asaas', 'focusnfe')),
  status text not null default 'conectado' check (status in ('conectado', 'erro', 'desconectado')),
  environment text not null default 'producao' check (environment in ('producao', 'testes')),
  config jsonb not null default '{}'::jsonb, -- dados não secretos (ex.: dados fiscais do prestador)
  account_name text,
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (company_id, provider)
);
create trigger company_integrations_updated before update on public.company_integrations for each row execute function public.tg_set_updated_at();

create table public.integration_credentials (
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null check (provider in ('asaas', 'focusnfe')),
  api_key text not null,
  webhook_token text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  primary key (company_id, provider)
);

/* ---------- cobranças (Pix, boleto ou link) ---------- */
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  quote_id uuid references public.quotes (id) on delete set null,
  description text not null check (length(trim(description)) between 1 and 300),
  amount numeric(12, 2) not null check (amount >= 5),
  due_date date not null,
  method text not null default 'pix_boleto' check (method in ('pix', 'boleto', 'pix_boleto')),
  status text not null default 'pendente' check (status in ('pendente', 'paga', 'vencida', 'cancelada', 'estornada')),
  provider_id text unique,
  invoice_url text,
  pix_code text,
  paid_at timestamptz,
  sent_at timestamptz,
  sale_id uuid references public.sales (id) on delete set null,
  finance_entry_id uuid references public.finance_entries (id) on delete set null,
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index charges_company_idx on public.charges (company_id, created_at desc);
create trigger charges_updated before update on public.charges for each row execute function public.tg_set_updated_at();

-- o recebimento da cobrança vira venda: a conta a receber fica ligada a ela (sem contar duas vezes no caixa)
alter table public.finance_entries add column sale_id uuid references public.sales (id) on delete set null;

/* ---------- notas fiscais de serviço (NFS-e) ---------- */
create table public.fiscal_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  ref text not null unique default replace(gen_random_uuid()::text, '-', ''), -- referência enviada ao emissor
  contact_id uuid references public.contacts (id) on delete set null,
  sale_id uuid references public.sales (id) on delete set null,
  charge_id uuid references public.charges (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  description text not null check (length(trim(description)) between 1 and 2000),
  taker jsonb not null default '{}'::jsonb, -- tomador: nome, CPF/CNPJ, e-mail, endereço
  status text not null default 'processando' check (status in ('processando', 'autorizada', 'erro', 'cancelada')),
  number text,
  verification_code text,
  pdf_url text,
  xml_url text,
  error text,
  issued_at timestamptz,
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fiscal_notes_company_idx on public.fiscal_notes (company_id, created_at desc);
create trigger fiscal_notes_updated before update on public.fiscal_notes for each row execute function public.tg_set_updated_at();

/* ---------- acesso: dono e gerente leem; quem cria e altera são as Edge Functions ---------- */
alter table public.company_integrations enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.charges enable row level security;
alter table public.fiscal_notes enable row level security;

create policy integrations_read on public.company_integrations for select to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente'));
create policy charges_read on public.charges for select to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente'));
create policy fiscal_notes_read on public.fiscal_notes for select to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente'));

revoke all on public.integration_credentials from authenticated, anon;
revoke insert, update, delete on public.company_integrations, public.charges, public.fiscal_notes from authenticated;
revoke all on public.company_integrations, public.charges, public.fiscal_notes from anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.charges, public.fiscal_notes;
  end if;
end $$;
