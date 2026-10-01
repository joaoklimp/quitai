-- Quitaí: empresas, equipe e assinatura.
-- Os dados do painel de cada empresa ficam em companies.data (jsonb).
-- Plano, assinatura e faturas são escritos só pelo servidor (webhook da Stripe).

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  plan text not null default 'pro' check (plan in ('basico', 'pro', 'empresa')),
  billing_status text not null default 'trial' check (billing_status in ('trial', 'active', 'past_due', 'canceled')),
  billing_cycle text not null default 'mensal' check (billing_cycle in ('mensal', 'anual')),
  trial_ends_at date not null default ((now() at time zone 'America/Sao_Paulo')::date + 7),
  current_period_end date,
  canceled_at timestamptz,
  invoices jsonb not null default '[]'::jsonb,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  name text not null,
  role text not null check (role in ('owner', 'admin', 'financeiro', 'leitura')),
  active boolean not null default true,
  must_change boolean not null default false,
  invited_by uuid,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists members_company_idx on public.members (company_id);
create unique index if not exists members_one_owner on public.members (company_id) where role = 'owner';

alter table public.companies enable row level security;
alter table public.members enable row level security;

-- Ninguém escreve direto nas tabelas pelo site: tudo passa pelas funções abaixo.
revoke all on public.companies from anon, authenticated;
revoke all on public.members from anon, authenticated;
grant select on public.companies to authenticated;
grant select on public.members to authenticated;

-- Empresa do usuário logado, só se o acesso dele estiver valendo
-- (ativo e, para quem não é dono, empresa no plano Empresa).
create or replace function public.my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m.company_id
  from members m join companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.active and (m.role = 'owner' or c.plan = 'empresa')
$$;

drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated
  using (id = public.my_company_id());

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (company_id = public.my_company_id() or user_id = auth.uid());

create or replace function public.company_locked(c public.companies)
returns boolean language sql stable as $$
  select case
    when c.billing_status = 'trial' then c.trial_ends_at < (now() at time zone 'America/Sao_Paulo')::date
    when c.billing_status = 'canceled' then c.current_period_end is null or c.current_period_end <= (now() at time zone 'America/Sao_Paulo')::date
    else false
  end
$$;

-- Cria a empresa e o dono logo depois do cadastro.
create or replace function public.create_company(p_name text, p_owner_name text, p_plan text, p_segment text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already_member'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into companies (plan, data)
  values (
    case when p_plan in ('basico', 'pro', 'empresa') then p_plan else 'pro' end,
    jsonb_build_object('name', left(coalesce(nullif(trim(p_name), ''), 'Minha empresa'), 80), 'email', lower(v_email),
      'segment', case when p_segment in ('servicos', 'comercio', 'outro') then p_segment else 'servicos' end)
  )
  returning id into v_id;
  insert into members (user_id, company_id, email, name, role, last_login_at)
  values (auth.uid(), v_id, lower(v_email), left(coalesce(nullif(trim(p_owner_name), ''), split_part(v_email, '@', 1)), 80), 'owner', now());
  return v_id;
end $$;

-- Salva os dados do painel com controle de versão (evita sobrescrever o trabalho de outra pessoa).
create or replace function public.save_company(p_data jsonb, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_member members;
  v_company companies;
  v_limit integer;
begin
  select * into v_member from members where user_id = auth.uid();
  if v_member.user_id is null or v_member.company_id is distinct from public.my_company_id() then raise exception 'no_access'; end if;
  if v_member.role = 'leitura' then raise exception 'read_only'; end if;
  select * into v_company from companies where id = v_member.company_id for update;
  if v_company.version <> p_version then raise exception 'conflict'; end if;
  if public.company_locked(v_company) then raise exception 'locked'; end if;
  v_limit := case v_company.plan when 'basico' then 50 when 'pro' then 200 else null end;
  if v_limit is not null and jsonb_array_length(coalesce(p_data -> 'clients', '[]'::jsonb)) > v_limit then raise exception 'client_limit'; end if;
  if pg_column_size(p_data) > 20 * 1024 * 1024 then raise exception 'too_large'; end if;
  update companies set data = p_data, version = version + 1, updated_at = now()
  where id = v_company.id;
  return v_company.version + 1;
end $$;

-- Troca de plano durante o teste grátis (depois disso, a troca é pela Stripe).
create or replace function public.set_trial_plan(p_plan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_member members;
begin
  if p_plan not in ('basico', 'pro', 'empresa') then raise exception 'invalid_plan'; end if;
  select * into v_member from members where user_id = auth.uid();
  if v_member.user_id is null or v_member.role <> 'owner' then raise exception 'not_owner'; end if;
  update companies set plan = p_plan, updated_at = now()
  where id = v_member.company_id and billing_status = 'trial';
  if not found then raise exception 'not_in_trial'; end if;
end $$;

-- Pequenas atualizações do próprio usuário.
create or replace function public.touch_login()
returns void language sql security definer set search_path = public as $$
  update members set last_login_at = now() where user_id = auth.uid()
$$;
create or replace function public.update_my_name(p_name text)
returns void language sql security definer set search_path = public as $$
  update members set name = left(trim(p_name), 80) where user_id = auth.uid() and length(trim(p_name)) >= 2
$$;
create or replace function public.clear_must_change()
returns void language sql security definer set search_path = public as $$
  update members set must_change = false where user_id = auth.uid()
$$;

-- Funções de administração da equipe (dono ou administrador).
create or replace function public.manage_member(p_user uuid, p_action text, p_role text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me members;
  v_target members;
begin
  select * into v_me from members where user_id = auth.uid();
  if v_me.user_id is null or v_me.role not in ('owner', 'admin') or not v_me.active then raise exception 'not_allowed'; end if;
  select * into v_target from members where user_id = p_user and company_id = v_me.company_id;
  if v_target.user_id is null or v_target.role = 'owner' or v_target.user_id = v_me.user_id then raise exception 'not_allowed'; end if;
  if p_action = 'role' then
    if p_role not in ('admin', 'financeiro', 'leitura') then raise exception 'invalid_role'; end if;
    update members set role = p_role where user_id = p_user;
  elsif p_action = 'activate' then
    update members set active = true where user_id = p_user;
  elsif p_action = 'deactivate' then
    update members set active = false where user_id = p_user;
  else
    raise exception 'invalid_action';
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_company_id(), public.create_company(text, text, text, text), public.save_company(jsonb, integer),
  public.set_trial_plan(text), public.touch_login(), public.update_my_name(text), public.clear_must_change(),
  public.manage_member(uuid, text, text) to authenticated;
