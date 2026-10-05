-- Cortesia dada pelo administrador: plano liberado sem cobrança, com ou sem data para acabar.
-- complimentary + comp_until nulo = cortesia sem prazo (ex.: conta da casa).
alter table public.companies add column if not exists comp_until date;
alter table public.companies add column if not exists comp_note text;

-- cortesia válida nunca bloqueia; vencida, segue as regras normais (fica em modo leitura até assinar)
create or replace function public.company_locked(c public.companies)
returns boolean language sql stable as $$
  select case
    when c.complimentary and (c.comp_until is null or c.comp_until >= (now() at time zone 'America/Sao_Paulo')::date) then false
    when c.billing_status = 'trial' then c.trial_ends_at < (now() at time zone 'America/Sao_Paulo')::date
    when c.billing_status = 'canceled' then c.current_period_end is null or c.current_period_end <= (now() at time zone 'America/Sao_Paulo')::date
    else false
  end
$$;

drop function if exists public.admin_companies();
create or replace function public.admin_companies()
returns table (
  id uuid, name text, owner_name text, owner_email text, plan text, billing_status text, billing_cycle text,
  trial_ends_at date, current_period_end date, canceled_at timestamptz, complimentary boolean,
  comp_until date, comp_note text, house boolean,
  stripe_customer_id text, clients integer, charges integer, members integer,
  last_login_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not_admin'; end if;
  return query
  select c.id, coalesce(c.data->>'name', ''), o.name, o.email, c.plan, c.billing_status, c.billing_cycle,
    c.trial_ends_at, c.current_period_end, c.canceled_at, c.complimentary,
    c.comp_until, c.comp_note,
    exists (select 1 from members m join platform_admins p on p.user_id = m.user_id where m.company_id = c.id),
    c.stripe_customer_id,
    coalesce(jsonb_array_length(c.data->'clients'), 0), coalesce(jsonb_array_length(c.data->'charges'), 0),
    (select count(*)::int from members m where m.company_id = c.id),
    (select max(m.last_login_at) from members m where m.company_id = c.id),
    c.created_at
  from companies c
  left join members o on o.company_id = c.id and o.role = 'owner'
  order by c.created_at desc;
end $$;
revoke execute on function public.admin_companies() from public, anon;
grant execute on function public.admin_companies() to authenticated;
