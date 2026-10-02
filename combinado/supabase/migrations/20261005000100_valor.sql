-- ORBYTA — o que faz o empreendedor sentir o valor todo dia:
-- 1) relatório "o que a ORBYTA fez por você" (função value_report, usada no painel e no WhatsApp toda semana);
-- 2) lista de espera e encaixe automático quando um horário é cancelado;
-- 3) módulos opcionais por empresa (o menu mostra só o que a empresa usa);
-- 4) automações novas: relatório semanal e encaixe.

/* ---------- módulos opcionais ---------- */
-- vazio = só o essencial (conversas, agenda, clientes, orçamentos, financeiro). Opções: 'estoque', 'cobrancas'.
alter table public.companies add column modules text[] not null default '{}'::text[]
  check (modules <@ array['estoque', 'cobrancas']::text[]);
update public.companies set modules = array['estoque', 'cobrancas']; -- quem já usa continua vendo tudo
grant update (modules) on public.companies to authenticated;

/* ---------- novas automações ---------- */
alter table public.automations drop constraint if exists automations_kind_check;
alter table public.automations add constraint automations_kind_check
  check (kind in ('lembrete_agendamento', 'followup_orcamento', 'resumo_diario', 'pos_atendimento', 'reativacao', 'lembrete_tarefa', 'relatorio_semanal', 'encaixe'));

create or replace function public.tg_company_new_automations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.automations (company_id, kind, enabled, config, template_name) values
    (new.id, 'relatorio_semanal', true, '{"dia":1,"horario":"08:00"}', 'relatorio_semanal'),
    (new.id, 'encaixe', true, '{"antecedencia_horas":2}', 'encaixe_disponivel')
  on conflict (company_id, kind) do nothing;
  return null;
end $$;
create trigger companies_new_automations after insert on public.companies for each row execute function public.tg_company_new_automations();
insert into public.automations (company_id, kind, enabled, config, template_name)
  select id, 'relatorio_semanal', true, '{"dia":1,"horario":"08:00"}', 'relatorio_semanal' from public.companies
  on conflict (company_id, kind) do nothing;
insert into public.automations (company_id, kind, enabled, config, template_name)
  select id, 'encaixe', true, '{"antecedencia_horas":2}', 'encaixe_disponivel' from public.companies
  on conflict (company_id, kind) do nothing;

/* ---------- lista de espera ---------- */
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  desired_date date,              -- dia desejado (vazio = qualquer dia)
  period text not null default 'qualquer' check (period in ('manha', 'tarde', 'noite', 'qualquer')),
  notes text check (length(notes) <= 500),
  status text not null default 'aguardando' check (status in ('aguardando', 'oferecido', 'agendado', 'cancelado')),
  offered_at timestamptz,
  offered_starts_at timestamptz,  -- horário oferecido no encaixe
  appointment_id uuid references public.appointments (id) on delete set null, -- horário marcado a partir da lista
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index waitlist_open_idx on public.waitlist (company_id, status, desired_date);
create unique index waitlist_one_open_uq on public.waitlist (company_id, contact_id) where status in ('aguardando', 'oferecido');
create trigger waitlist_updated before update on public.waitlist for each row execute function public.tg_set_updated_at();

alter table public.waitlist enable row level security;
create policy waitlist_read on public.waitlist for select to authenticated using (company_id = public.my_company());
create policy waitlist_insert on public.waitlist for insert to authenticated
  with check (company_id = public.my_company() and public.company_writable(company_id));
create policy waitlist_update on public.waitlist for update to authenticated
  using (company_id = public.my_company() and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy waitlist_delete on public.waitlist for delete to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente'));
revoke update on public.waitlist from authenticated;
grant update (service_id, desired_date, period, notes, status) on public.waitlist to authenticated;
revoke all on public.waitlist from anon;

-- quem entra na lista e quem consegue o encaixe fica no histórico
create or replace function public.tg_audit_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  if auth.uid() is null then return null; end if;
  select name into cname from public.contacts where id = new.contact_id;
  if tg_op = 'INSERT' then
    perform public.audit(new.company_id, 'lista_espera', format('Colocou %s na lista de espera%s', coalesce(cname, 'o cliente'),
      case when new.desired_date is not null then ' para ' || to_char(new.desired_date, 'DD/MM') else '' end), 'waitlist', new.id);
  end if;
  return null;
end $$;
create trigger waitlist_audit after insert on public.waitlist for each row execute function public.tg_audit_waitlist();

/* ---------- relatório de valor ---------- */
-- Quanto a ORBYTA trabalhou pela empresa num período. O tempo economizado é uma estimativa conservadora:
-- 1,5 min por resposta da IA, 4 min por horário marcado, 6 min por orçamento, 1 min por lembrete, 3 min por cobrança recebida.
create or replace function public.value_report_for(p_company uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text; hours jsonb;
  ia_replies int; ia_convs int; after_hours int; owner_cmds int;
  appts int; quotes_n int; quotes_ok int; quotes_value numeric; sales_ia numeric; sales_ia_n int;
  charges_n int; charges_value numeric; reminders int; followups int; encaixes int; reviews int; reactivated int;
begin
  select timezone, business_hours into tz, hours from public.companies where id = p_company;
  if tz is null then return null; end if;

  select count(*), count(distinct m.conversation_id),
         count(*) filter (where not exists (
           select 1 from jsonb_array_elements(coalesce(hours -> extract(dow from m.created_at at time zone tz)::int::text, '[]'::jsonb)) iv
           where (m.created_at at time zone tz)::time >= (iv ->> 0)::time and (m.created_at at time zone tz)::time < (iv ->> 1)::time))
    into ia_replies, ia_convs, after_hours
    from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company and m.sender = 'ia' and m.direction = 'out' and c.kind = 'cliente'
      and m.created_at >= p_from and m.created_at < p_to;

  select count(*) into owner_cmds from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company and c.kind = 'dono' and m.sender = 'dono' and m.created_at >= p_from and m.created_at < p_to;

  select count(*) into appts from public.appointments
    where company_id = p_company and created_via in ('ia_cliente', 'ia_dono') and created_at >= p_from and created_at < p_to;

  select count(*), count(*) filter (where status = 'aprovado'), coalesce(sum(total) filter (where status = 'aprovado'), 0)
    into quotes_n, quotes_ok, quotes_value
    from public.quotes where company_id = p_company and created_via in ('ia_cliente', 'ia_dono') and created_at >= p_from and created_at < p_to;

  select count(*), coalesce(sum(amount), 0) into sales_ia_n, sales_ia from public.sales
    where company_id = p_company and origin = 'ia' and paid_at >= p_from and paid_at < p_to;

  select count(*), coalesce(sum(amount), 0) into charges_n, charges_value from public.charges
    where company_id = p_company and status = 'paga' and paid_at >= p_from and paid_at < p_to;

  select count(*) filter (where kind = 'lembrete_agendamento'), count(*) filter (where kind = 'followup_orcamento'),
         count(*) filter (where kind = 'pos_atendimento'), count(*) filter (where kind = 'reativacao')
    into reminders, followups, reviews, reactivated
    from public.automation_runs where company_id = p_company and status = 'enviado' and ran_at >= p_from and ran_at < p_to;

  select count(*) into encaixes from public.waitlist
    where company_id = p_company and status = 'agendado' and updated_at >= p_from and updated_at < p_to;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'ia_replies', ia_replies, 'ia_conversations', ia_convs, 'after_hours', after_hours, 'owner_commands', owner_cmds,
    'appointments', appts, 'quotes', quotes_n, 'quotes_approved', quotes_ok, 'quotes_approved_value', quotes_value,
    'sales_ia', sales_ia_n, 'sales_ia_value', sales_ia, 'charges_paid', charges_n, 'charges_value', charges_value,
    'reminders', reminders, 'followups', followups, 'reviews_asked', reviews, 'reactivations', reactivated, 'encaixes', encaixes,
    'minutes_saved', round(ia_replies * 1.5 + appts * 4 + quotes_n * 6 + (reminders + followups + reviews + reactivated) * 1 + charges_n * 3)
  );
end $$;

-- versão do painel: sempre da empresa de quem está logado
create or replace function public.value_report(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.value_report_for(public.my_company(), p_from, p_to) where public.my_company() is not null
$$;

/* tempo real */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.waitlist;
  end if;
end $$;

revoke execute on function public.value_report_for(uuid, timestamptz, timestamptz), public.tg_audit_waitlist(), public.tg_company_new_automations() from public, anon, authenticated;
revoke execute on function public.value_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.value_report(timestamptz, timestamptz) to authenticated;
