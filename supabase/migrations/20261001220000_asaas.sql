-- Pagamentos pelo Asaas (Pix, boleto e cartão). A Stripe fica desativada para novas assinaturas.
alter table public.companies add column if not exists billing_provider text check (billing_provider in ('stripe', 'asaas'));
alter table public.companies add column if not exists billing_method text check (billing_method in ('cartao', 'pix'));
alter table public.companies add column if not exists asaas_customer_id text;
alter table public.companies add column if not exists asaas_subscription_id text unique;
alter table public.companies add column if not exists asaas_checkout_id text;
create index if not exists companies_asaas_customer_idx on public.companies (asaas_customer_id);
create index if not exists companies_asaas_checkout_idx on public.companies (asaas_checkout_id);

-- avisos do Asaas já processados (entrega "pelo menos uma vez": evita processar duas vezes)
create table if not exists public.asaas_events (
  id text primary key,
  event text not null,
  received_at timestamptz not null default now()
);
alter table public.asaas_events enable row level security;
revoke all on public.asaas_events from anon, authenticated;
