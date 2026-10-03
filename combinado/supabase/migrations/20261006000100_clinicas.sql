-- ORBYTA Clínicas — a ORBYTA passa a ser especializada em clínicas (médicas, odontológicas, estética, fisioterapia,
-- psicologia, nutrição e multidisciplinares):
-- 1) profissionais, cada um com sua agenda, especialidade, registro no conselho e procedimentos que atende;
-- 2) ficha do paciente: convênio, carteirinha e responsável (o CPF já existe em contacts.document);
-- 3) convênios aceitos pela clínica e consulta particular ou por convênio;
-- 4) confirmação de presença registrada pelo paciente e retorno automático depois da consulta.

/* ---------- profissionais ---------- */
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  specialty text check (length(specialty) <= 80),       -- ex.: Dermatologia, Ortodontia
  council text check (length(council) <= 40),           -- registro no conselho, ex.: CRM-SP 123456
  color text not null default '#3D86F0' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  business_hours jsonb,                                 -- vazio = horário da clínica
  service_ids uuid[] not null default '{}',             -- vazio = atende todos os procedimentos
  member_user_id uuid references auth.users (id) on delete set null, -- login da equipe, se o profissional usa o painel
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index professionals_company_idx on public.professionals (company_id, sort);
create trigger professionals_updated before update on public.professionals for each row execute function public.tg_set_updated_at();

alter table public.professionals enable row level security;
create policy professionals_read on public.professionals for select to authenticated using (company_id = public.my_company());
create policy professionals_insert on public.professionals for insert to authenticated
  with check (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id));
create policy professionals_update on public.professionals for update to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy professionals_delete on public.professionals for delete to authenticated using (company_id = public.my_company() and public.has_role('dono', 'gerente'));
revoke all on public.professionals from anon;

/* ---------- consultas: profissional, convênio e confirmação do paciente ---------- */
alter table public.appointments
  add column professional_id uuid references public.professionals (id) on delete set null,
  add column payment_kind text not null default 'particular' check (payment_kind in ('particular', 'convenio')),
  add column insurance text check (length(insurance) <= 80),
  add column patient_confirmed_at timestamptz;
create index appointments_professional_idx on public.appointments (professional_id, starts_at);

/* ---------- ficha do paciente ---------- */
alter table public.contacts
  add column insurance text check (length(insurance) <= 80),        -- convênio (vazio = particular)
  add column insurance_card text check (length(insurance_card) <= 40), -- número da carteirinha
  add column guardian_name text check (length(guardian_name) <= 120);  -- responsável (menores de idade)

/* ---------- procedimentos: retorno ---------- */
alter table public.services add column return_days int check (return_days between 1 and 730); -- vazio = sem retorno

/* ---------- clínica: convênios aceitos ---------- */
alter table public.companies add column insurances text[] not null default '{}';
grant update (insurances) on public.companies to authenticated;

/* ---------- automação de retorno ---------- */
alter table public.automations drop constraint if exists automations_kind_check;
alter table public.automations add constraint automations_kind_check
  check (kind in ('lembrete_agendamento', 'followup_orcamento', 'resumo_diario', 'pos_atendimento', 'reativacao', 'lembrete_tarefa', 'relatorio_semanal', 'encaixe', 'retorno'));

create or replace function public.tg_company_new_automations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.automations (company_id, kind, enabled, config, template_name) values
    (new.id, 'relatorio_semanal', true, '{"dia":1,"horario":"08:00"}', 'relatorio_semanal'),
    (new.id, 'encaixe', true, '{"antecedencia_horas":2}', 'encaixe_disponivel'),
    (new.id, 'retorno', true, '{"horario":"10:00"}', 'lembrete_retorno')
  on conflict (company_id, kind) do nothing;
  return null;
end $$;
insert into public.automations (company_id, kind, enabled, config, template_name)
  select id, 'retorno', true, '{"horario":"10:00"}', 'lembrete_retorno' from public.companies
  on conflict (company_id, kind) do nothing;

/* ---------- um profissional não atende dois pacientes ao mesmo tempo ---------- */
create or replace function public.tg_appointments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; busy int; npro int;
begin
  if new.title = '' then
    select coalesce(s.name, 'Consulta') into new.title from (select 1) x left join public.services s on s.id = new.service_id;
  end if;
  if new.professional_id is not null and not exists (select 1 from public.professionals p where p.id = new.professional_id and p.company_id = new.company_id) then
    raise exception 'Profissional não encontrado.' using errcode = 'P0001';
  end if;
  if new.payment_kind = 'particular' then new.insurance := null; end if;
  if new.created_via in ('ia_cliente', 'site') and new.status not in ('cancelado', 'faltou')
     and (tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
          or new.professional_id is distinct from old.professional_id) then
    if new.professional_id is not null then
      select count(*) into busy from public.appointments a
        where a.professional_id = new.professional_id and a.id <> new.id and a.status not in ('cancelado', 'faltou')
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(new.starts_at, new.ends_at);
      if busy > 0 then raise exception 'horario_ocupado' using errcode = 'P0001', hint = 'Esse horário acabou de ser ocupado.'; end if;
    else
      select count(*) into npro from public.professionals where company_id = new.company_id and active;
      select capacity_per_slot into cap from public.companies where id = new.company_id;
      select count(*) into busy from public.appointments a
        where a.company_id = new.company_id and a.id <> new.id and a.status not in ('cancelado', 'faltou')
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(new.starts_at, new.ends_at);
      if busy >= greatest(coalesce(cap, 1), npro) then raise exception 'horario_ocupado' using errcode = 'P0001', hint = 'Esse horário acabou de ser ocupado.'; end if;
    end if;
  end if;
  return new;
end $$;

/* ---------- procedimentos de exemplo por especialidade (mesma lista de src/shared/presets.ts) ---------- */
-- [nome, preço, tipo de preço, duração em minutos, categoria, dias para retorno (0 = sem retorno)]
create or replace function public.segment_presets(p_segment text) returns jsonb
language sql immutable as $$
  select coalesce(('{
    "clinica_medica": [["Consulta",300,"fixo",30,"Consultas",30],["Retorno",0,"fixo",20,"Consultas",0],["Teleconsulta",250,"fixo",30,"Consultas",30],["Atestado e relatório",0,"sob_consulta",15,"Documentos",0]],
    "odontologia": [["Avaliação",0,"fixo",30,"Avaliações",0],["Limpeza (profilaxia)",200,"fixo",40,"Prevenção",180],["Restauração",250,"a_partir_de",60,"Tratamentos",0],["Clareamento",900,"a_partir_de",60,"Estética",0],["Manutenção de aparelho",180,"fixo",30,"Ortodontia",30]],
    "estetica": [["Avaliação estética",0,"fixo",30,"Avaliações",0],["Limpeza de pele",180,"fixo",60,"Facial",30],["Toxina botulínica",1200,"a_partir_de",40,"Injetáveis",120],["Preenchimento",1500,"a_partir_de",60,"Injetáveis",180],["Depilação a laser (sessão)",250,"a_partir_de",30,"Corporal",30]],
    "fisioterapia": [["Avaliação fisioterapêutica",180,"fixo",50,"Avaliações",0],["Sessão de fisioterapia",130,"fixo",50,"Sessões",7],["Pilates (aula)",90,"fixo",50,"Pilates",7],["RPG",150,"fixo",50,"Sessões",7]],
    "psicologia": [["Primeira sessão",200,"fixo",50,"Sessões",7],["Sessão de psicoterapia",180,"fixo",50,"Sessões",7],["Sessão online",170,"fixo",50,"Sessões",7]],
    "nutricao": [["Consulta nutricional",280,"fixo",60,"Consultas",30],["Retorno",150,"fixo",40,"Consultas",30],["Bioimpedância",80,"fixo",20,"Exames",0]],
    "multidisciplinar": [["Consulta",250,"fixo",40,"Consultas",30],["Retorno",0,"fixo",20,"Consultas",0],["Avaliação inicial",150,"fixo",40,"Avaliações",0],["Sessão de terapia",150,"fixo",50,"Sessões",7]]
  }'::jsonb) -> p_segment, '{
    "x": [["Consulta",250,"fixo",40,"Consultas",30],["Retorno",0,"fixo",20,"Consultas",0],["Avaliação inicial",150,"fixo",40,"Avaliações",0]]
  }'::jsonb -> 'x')
$$;

/* ---------- primeira configuração: a clínica já nasce com procedimentos e com o dono como primeiro profissional ---------- */
create or replace function public.onboard_company(p_name text, p_segment text, p_phone text, p_city text default null, p_preset boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  u record;
  item jsonb;
  i int := 0;
  seg text := coalesce(nullif(p_segment, ''), 'multidisciplinar');
begin
  if uid is null then raise exception 'Entre na sua conta para continuar.' using errcode = '42501'; end if;
  perform set_config('orbyta.skip_audit', 'on', true); -- os procedimentos de exemplo não entram no histórico
  if exists (select 1 from public.members where user_id = uid) then raise exception 'Você já faz parte de uma clínica.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Informe o nome da clínica.' using errcode = 'P0001'; end if;
  select email, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)) as name into u from auth.users where id = uid;

  insert into public.companies (name, segment, phone, city, owner_id, email, slot_minutes)
  values (trim(p_name), seg, public.normalize_phone(p_phone), nullif(trim(coalesce(p_city, '')), ''), uid, u.email, case when seg in ('psicologia', 'fisioterapia') then 60 else 30 end)
  returning id into cid;
  insert into public.members (company_id, user_id, role, name, email) values (cid, uid, 'dono', coalesce(u.name, ''), coalesce(u.email, ''));
  insert into public.ai_settings (company_id, greeting, tone) values (cid, format('Olá! Aqui é da %s. Como posso ajudar?', trim(p_name)), 'profissional');
  insert into public.company_counters (company_id) values (cid);
  insert into public.automations (company_id, kind, enabled, config, template_name) values
    (cid, 'lembrete_agendamento', true, '{"horas_antes":24,"pedir_confirmacao":true}', 'lembrete_agendamento'),
    (cid, 'followup_orcamento', true, '{"dias_depois":2,"max_tentativas":2}', 'acompanhamento_orcamento'),
    (cid, 'resumo_diario', true, '{"horario":"19:00","incluir_agenda":true}', 'resumo_diario'),
    (cid, 'pos_atendimento', false, '{"horas_depois":3,"pedir_avaliacao":true,"link_avaliacao":""}', 'pos_atendimento'),
    (cid, 'reativacao', false, '{"dias_sem_compra":180,"desconto_pct":0}', 'reativacao_cliente'),
    (cid, 'lembrete_tarefa', true, '{"minutos_antes":30}', null);
  if coalesce(p_preset, true) then
    for item in select * from jsonb_array_elements(public.segment_presets(seg)) loop
      insert into public.services (company_id, name, price, price_type, duration_min, category, sort, return_days)
      values (cid, item->>0, (item->>1)::numeric, item->>2, (item->>3)::int, item->>4, i, nullif((item->>5)::int, 0));
      i := i + 1;
    end loop;
  end if;
  insert into public.professionals (company_id, name, member_user_id) values (cid, coalesce(nullif(u.name, ''), 'Profissional'), uid);
  perform public.notify(cid, 'sistema', 'Bem-vindo à ORBYTA!', 'Cadastre os profissionais da clínica, teste a IA no Simulador e conecte o WhatsApp quando estiver pronto.', '#/profissionais');
  perform set_config('orbyta.skip_audit', 'off', true);
  insert into public.audit_log (company_id, actor_type, actor_name, actor_user_id, channel, action, summary)
  values (cid, 'usuario', u.name, uid, 'painel', 'criar_empresa', format('Criou a clínica %s', trim(p_name)));
  return cid;
end $$;

/* ---------- histórico: quem cadastra ou desativa profissional ---------- */
create or replace function public.tg_audit_professionals() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_setting('orbyta.skip_audit', true) = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    perform public.audit(new.company_id, 'criar_profissional', format('Cadastrou o profissional %s', new.name), 'professional', new.id);
  elsif tg_op = 'DELETE' then
    perform public.audit(old.company_id, 'excluir_profissional', format('Excluiu o profissional %s', old.name), 'professional', old.id);
  elsif new.active is distinct from old.active then
    perform public.audit(new.company_id, 'atualizar_profissional', format('%s o profissional %s', case when new.active then 'Reativou' else 'Desativou' end, new.name), 'professional', new.id);
  end if;
  return null;
end $$;
create trigger professionals_audit after insert or update or delete on public.professionals for each row execute function public.tg_audit_professionals();

/* tempo real */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.professionals;
  end if;
end $$;

revoke execute on function public.tg_audit_professionals() from public, anon, authenticated;
