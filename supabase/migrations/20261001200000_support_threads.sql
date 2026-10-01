-- Conversa de cada atendimento: respostas enviadas pelo Quitaí e respostas do cliente por e-mail.
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null,
  email_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon, authenticated;

-- o painel passa a mostrar quantas mensagens cada atendimento tem
drop function if exists public.admin_tickets(integer);
create or replace function public.admin_tickets(p_limit integer default 50)
returns table (id uuid, created_at timestamptz, name text, email text, topic text, message text, status text, company_name text, replies integer, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not_admin'; end if;
  return query
  select t.id, t.created_at, t.name, t.email, t.topic, t.message, t.status, coalesce(c.data->>'name', ''),
    (select count(*)::int from support_messages m where m.ticket_id = t.id),
    coalesce((select max(m.created_at) from support_messages m where m.ticket_id = t.id), t.created_at)
  from support_tickets t left join companies c on c.id = t.company_id
  order by coalesce((select max(m.created_at) from support_messages m where m.ticket_id = t.id), t.created_at) desc
  limit least(greatest(p_limit, 1), 200);
end $$;
revoke execute on function public.admin_tickets(integer) from public, anon;
grant execute on function public.admin_tickets(integer) to authenticated;
