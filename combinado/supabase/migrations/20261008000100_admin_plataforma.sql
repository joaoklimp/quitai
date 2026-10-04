-- Área do dono da ORBYTA: controle das clínicas assinantes sem acesso aos dados internos delas.
-- A visão geral traz só cadastro, assinatura e números agregados (quantidades), nunca pacientes, conversas ou valores da clínica.
-- 1) anotação interna por clínica (só a plataforma vê);
-- 2) ações do dono: cortesia, estender teste, trocar plano, bloquear e desbloquear — todas registradas;
-- 3) visão geral mais completa: contato do responsável, fim do teste, faturas pagas, novas clínicas no mês.

create table public.admin_company_notes (
  company_id uuid primary key references public.companies (id) on delete cascade,
  note text not null default '' check (length(note) <= 2000),
  updated_at timestamptz not null default now()
);

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index admin_actions_company_idx on public.admin_actions (company_id, created_at desc);

-- sem políticas: só as funções abaixo (que conferem se é administrador) leem e escrevem
alter table public.admin_company_notes enable row level security;
alter table public.admin_actions enable row level security;
revoke all on public.admin_company_notes, public.admin_actions from anon, authenticated;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rows jsonb; mon text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  mon_start timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.is_platform_admin() then raise exception 'Acesso restrito.' using errcode = '42501'; end if;
  with base as (
    select c.id, c.name, c.segment, c.city, c.state, c.phone, c.plan, c.billing_status, c.billing_cycle, c.billing_method,
      c.trial_ends_at, c.current_period_end, c.canceled_at, c.complimentary, c.created_at,
      coalesce(o.name, '') as owner_name, coalesce(o.email, c.email, '') as owner_email, o.phone as owner_phone,
      (select count(*) from public.members m where m.company_id = c.id and m.active) as members,
      (select count(*) from public.professionals p where p.company_id = c.id and p.active) as professionals,
      (select count(*) from public.contacts x where x.company_id = c.id) as contacts,
      (select count(*) from public.appointments a where a.company_id = c.id and a.starts_at >= mon_start) as appointments_month,
      coalesce((select u.ai_replies from public.usage_monthly u where u.company_id = c.id and u.month = mon), 0) as ai_replies_month,
      exists (select 1 from public.whatsapp_accounts w where w.company_id = c.id and w.status = 'conectado') as whatsapp,
      (select max(m.created_at) from public.messages m where m.company_id = c.id) as last_activity,
      coalesce((select sum(i.amount) from public.invoices i where i.company_id = c.id and i.status = 'paga'), 0) as paid_total,
      coalesce(n.note, '') as note,
      case when c.billing_status in ('active', 'past_due') and not c.complimentary then
        round(case when c.billing_cycle = 'anual' then p.yearly / 12 else p.monthly end, 2) else 0 end as mrr
    from public.companies c
    join public.plans p on p.id = c.plan
    left join public.members o on o.company_id = c.id and o.role = 'dono' and o.user_id = c.owner_id
    left join public.admin_company_notes n on n.company_id = c.id)
  select coalesce(jsonb_agg(to_jsonb(base) order by base.created_at desc), '[]'::jsonb) into rows from base;
  return jsonb_build_object(
    'companies', rows,
    'mrr', coalesce((select sum((r->>'mrr')::numeric) from jsonb_array_elements(rows) r), 0),
    'active', (select count(*) from public.companies where billing_status = 'active' and not complimentary),
    'trialing', (select count(*) from public.companies where billing_status = 'trialing' and trial_ends_at > now() and not complimentary),
    'trial_ending', (select count(*) from public.companies where billing_status = 'trialing' and not complimentary and trial_ends_at > now() and trial_ends_at <= now() + interval '2 days'),
    'past_due', (select count(*) from public.companies where billing_status = 'past_due' and not complimentary),
    'canceled', (select count(*) from public.companies where billing_status in ('canceled', 'blocked')),
    'complimentary', (select count(*) from public.companies where complimentary),
    'new_month', (select count(*) from public.companies where created_at >= mon_start),
    'received_month', coalesce((select sum(amount) from public.invoices where status = 'paga' and paid_at >= mon_start), 0));
end $$;

-- Histórico das ações do dono da plataforma (de uma clínica ou de todas).
create or replace function public.admin_history(p_company uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Acesso restrito.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'company_id', a.company_id, 'company_name', c.name, 'action', a.action, 'detail', a.detail,
      'admin_email', u.email, 'created_at', a.created_at) order by a.created_at desc)
    from (select * from public.admin_actions where p_company is null or company_id = p_company order by created_at desc limit 100) a
    left join public.companies c on c.id = a.company_id
    left join auth.users u on u.id = a.admin_id), '[]'::jsonb);
end $$;

-- Ações do dono da plataforma sobre a assinatura de uma clínica.
create or replace function public.admin_company_action(p_company uuid, p_action text, p_value text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.companies;
  v_days int;
  v_detail text;
  v_status text;
begin
  if not public.is_platform_admin() then raise exception 'Acesso restrito.' using errcode = '42501'; end if;
  select * into c from public.companies where id = p_company for update;
  if not found then raise exception 'Clínica não encontrada.'; end if;

  case p_action
    when 'cortesia' then
      if p_value not in ('sim', 'nao') then raise exception 'Valor inválido.'; end if;
      update public.companies set complimentary = (p_value = 'sim') where id = p_company;
      v_detail := case when p_value = 'sim' then 'Liberou como cortesia' else 'Tirou a cortesia' end;
      if p_value = 'sim' then
        perform public.notify(p_company, 'assinatura', 'Acesso liberado pela ORBYTA', 'Sua clínica tem acesso completo como cortesia.', '#/configuracoes/assinatura');
      end if;

    when 'estender_teste' then
      v_days := case when p_value ~ '^\d{1,3}$' then p_value::int end;
      if v_days is null or v_days not between 1 and 90 then raise exception 'Informe de 1 a 90 dias.'; end if;
      if c.billing_status in ('active', 'past_due') then raise exception 'A clínica já é assinante; o teste não se aplica.'; end if;
      update public.companies
        set trial_ends_at = greatest(trial_ends_at, now()) + make_interval(days => v_days),
            billing_status = 'trialing', canceled_at = null
        where id = p_company returning trial_ends_at into c.trial_ends_at;
      v_detail := format('Estendeu o teste em %s dia(s), até %s', v_days, to_char(c.trial_ends_at at time zone c.timezone, 'DD/MM/YYYY HH24:MI'));
      perform public.notify(p_company, 'assinatura', 'Teste grátis estendido', format('Seu teste vai até %s.', to_char(c.trial_ends_at at time zone c.timezone, 'DD/MM')), '#/configuracoes/assinatura');

    when 'plano' then
      if not exists (select 1 from public.plans where id = p_value) then raise exception 'Plano inválido.'; end if;
      update public.companies set plan = p_value where id = p_company;
      v_detail := format('Trocou o plano de %s para %s', c.plan, p_value);

    when 'bloquear' then
      if c.billing_status = 'blocked' then raise exception 'A clínica já está bloqueada.'; end if;
      update public.companies set billing_status = 'blocked', complimentary = false where id = p_company;
      v_detail := 'Bloqueou o acesso' || coalesce(': ' || nullif(trim(p_value), ''), '');

    when 'desbloquear' then
      if c.billing_status <> 'blocked' then raise exception 'A clínica não está bloqueada.'; end if;
      v_status := case
        when c.current_period_end is not null and c.current_period_end >= current_date then 'active'
        when c.trial_ends_at > now() then 'trialing'
        else 'canceled' end;
      update public.companies set billing_status = v_status where id = p_company;
      v_detail := 'Desbloqueou o acesso';

    when 'nota' then
      insert into public.admin_company_notes (company_id, note, updated_at) values (p_company, left(coalesce(p_value, ''), 2000), now())
        on conflict (company_id) do update set note = excluded.note, updated_at = now();
      v_detail := 'Atualizou a anotação';

    else raise exception 'Ação desconhecida.';
  end case;

  insert into public.admin_actions (company_id, admin_id, action, detail) values (p_company, auth.uid(), p_action, v_detail);
  return jsonb_build_object('ok', true, 'detail', v_detail);
end $$;

revoke execute on function public.admin_history(uuid), public.admin_company_action(uuid, text, text) from public, anon;
grant execute on function public.admin_overview(), public.admin_history(uuid), public.admin_company_action(uuid, text, text) to authenticated;
