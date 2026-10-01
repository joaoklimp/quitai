-- Administração do Quitaí: cortesia para contas da casa e painel só para administradores.

alter table public.companies add column if not exists complimentary boolean not null default false;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- Visão geral de todas as empresas (só administradores).
create or replace function public.admin_companies()
returns table (
  id uuid, name text, owner_name text, owner_email text, plan text, billing_status text, billing_cycle text,
  trial_ends_at date, current_period_end date, canceled_at timestamptz, complimentary boolean,
  stripe_customer_id text, clients integer, charges integer, members integer,
  last_login_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not_admin'; end if;
  return query
  select c.id, coalesce(c.data->>'name', ''), o.name, o.email, c.plan, c.billing_status, c.billing_cycle,
    c.trial_ends_at, c.current_period_end, c.canceled_at, c.complimentary, c.stripe_customer_id,
    coalesce(jsonb_array_length(c.data->'clients'), 0), coalesce(jsonb_array_length(c.data->'charges'), 0),
    (select count(*)::int from members m where m.company_id = c.id),
    (select max(m.last_login_at) from members m where m.company_id = c.id),
    c.created_at
  from companies c
  left join members o on o.company_id = c.id and o.role = 'owner'
  order by c.created_at desc;
end $$;

create or replace function public.admin_tickets(p_limit integer default 50)
returns table (id uuid, created_at timestamptz, name text, email text, topic text, message text, status text, company_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not_admin'; end if;
  return query
  select t.id, t.created_at, t.name, t.email, t.topic, t.message, t.status, coalesce(c.data->>'name', '')
  from support_tickets t left join companies c on c.id = t.company_id
  order by t.created_at desc limit least(greatest(p_limit, 1), 200);
end $$;

create or replace function public.admin_set_ticket(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not_admin'; end if;
  if p_status not in ('aberto', 'respondido', 'fechado') then raise exception 'invalid_status'; end if;
  update support_tickets set status = p_status where id = p_id;
end $$;

-- Conta da casa nunca fica bloqueada
create or replace function public.company_locked(c public.companies)
returns boolean language sql stable as $$
  select case
    when c.complimentary then false
    when c.billing_status = 'trial' then c.trial_ends_at < (now() at time zone 'America/Sao_Paulo')::date
    when c.billing_status = 'canceled' then c.current_period_end is null or c.current_period_end <= (now() at time zone 'America/Sao_Paulo')::date
    else false
  end
$$;

revoke execute on function public.is_platform_admin(), public.admin_companies(), public.admin_tickets(integer), public.admin_set_ticket(uuid, text) from public, anon;
grant execute on function public.is_platform_admin(), public.admin_companies(), public.admin_tickets(integer), public.admin_set_ticket(uuid, text) to authenticated;
