-- Mensagens de suporte enviadas pelo site. Só o servidor (funções) lê e escreve.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  email text not null,
  topic text not null,
  message text not null,
  status text not null default 'aberto' check (status in ('aberto', 'respondido', 'fechado')),
  created_at timestamptz not null default now()
);
create index if not exists support_tickets_email_idx on public.support_tickets (email, created_at desc);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon, authenticated;
