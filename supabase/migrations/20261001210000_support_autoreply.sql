-- Assistente automático do suporte: responde sozinho e encaminha para uma pessoa quando precisa.
alter table public.support_tickets add column if not exists escalated boolean not null default false;
alter table public.support_tickets add column if not exists summary text;
alter table public.support_tickets add column if not exists auto_replies integer not null default 0;
alter table public.support_messages add column if not exists auto boolean not null default false;

create table if not exists public.support_settings (
  id integer primary key default 1 check (id = 1),
  auto_reply boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.support_settings (id) values (1) on conflict do nothing;
alter table public.support_settings enable row level security;
revoke all on public.support_settings from anon, authenticated;

create or replace function public.admin_support_settings(p_auto_reply boolean default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v boolean;
begin
  if not public.is_platform_admin() then raise exception 'not_admin'; end if;
  if p_auto_reply is not null then
    update support_settings set auto_reply = p_auto_reply, updated_at = now() where id = 1;
  end if;
  select auto_reply into v from support_settings where id = 1;
  return v;
end $$;

drop function if exists public.admin_tickets(integer);
create or replace function public.admin_tickets(p_limit integer default 50)
returns table (id uuid, created_at timestamptz, name text, email text, topic text, message text, status text, company_name text,
  replies integer, last_at timestamptz, escalated boolean, summary text, auto_replies integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not_admin'; end if;
  return query
  select t.id, t.created_at, t.name, t.email, t.topic, t.message, t.status, coalesce(c.data->>'name', ''),
    (select count(*)::int from support_messages m where m.ticket_id = t.id),
    coalesce((select max(m.created_at) from support_messages m where m.ticket_id = t.id), t.created_at),
    t.escalated, t.summary, t.auto_replies
  from support_tickets t left join companies c on c.id = t.company_id
  order by (t.escalated and t.status = 'aberto') desc,
    coalesce((select max(m.created_at) from support_messages m where m.ticket_id = t.id), t.created_at) desc
  limit least(greatest(p_limit, 1), 200);
end $$;

revoke execute on function public.admin_support_settings(boolean), public.admin_tickets(integer) from public, anon;
grant execute on function public.admin_support_settings(boolean), public.admin_tickets(integer) to authenticated;
