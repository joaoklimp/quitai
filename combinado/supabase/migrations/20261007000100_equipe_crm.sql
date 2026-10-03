-- ORBYTA Clínicas — equipe e funil:
-- 1) foto do profissional (imagem pequena, já reduzida no navegador) e meta de produção mensal;
-- 2) distribuição em rodízio: quando a IA passa a conversa para a equipe, ela vai para a próxima pessoa da recepção;
-- 3) motivo de perda do paciente (para saber por que os orçamentos não viram tratamento);
-- 4) Google como origem do paciente.

/* ---------- profissionais: foto e meta ---------- */
alter table public.professionals
  add column photo_url text check (photo_url is null or (photo_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)' and length(photo_url) <= 300000)),
  add column monthly_goal numeric(12, 2) check (monthly_goal >= 0); -- vazio = sem meta

/* ---------- distribuição de conversas ---------- */
alter table public.companies add column auto_assign boolean not null default true;
grant update (auto_assign) on public.companies to authenticated;

alter table public.members add column last_assigned_at timestamptz;

alter table public.conversations add column assigned_to uuid references auth.users (id) on delete set null;
create index conversations_assigned_idx on public.conversations (company_id, assigned_to) where assigned_to is not null;
grant update (assigned_to) on public.conversations to authenticated;

-- Escolhe quem atende: recepção (atendente) e gerentes ativos, em rodízio (quem recebeu há mais tempo primeiro).
-- Sem ninguém da recepção, fica com o dono.
create or replace function public.next_assignee(p_company uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from (
    select user_id, case when role in ('atendente', 'gerente') then 0 else 1 end as pri, last_assigned_at
    from public.members
    where company_id = p_company and active and not invited
  ) m
  order by pri, last_assigned_at nulls first, user_id
  limit 1;
$$;
revoke all on function public.next_assignee(uuid) from public, anon, authenticated;

create or replace function public.tg_conversations_assign() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if new.kind <> 'cliente' then return new; end if;
  -- o responsável precisa ser da mesma clínica
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (select 1 from public.members where company_id = new.company_id and user_id = new.assigned_to and active) then
      raise exception 'Essa pessoa não faz parte da equipe.';
    end if;
  end if;
  if new.assigned_to is null and (new.needs_attention or new.handler = 'humano')
     and (tg_op = 'INSERT' or not (old.needs_attention or old.handler = 'humano'))
     and (select auto_assign from public.companies where id = new.company_id) then
    v_user := public.next_assignee(new.company_id);
    if v_user is not null then
      new.assigned_to := v_user;
      update public.members set last_assigned_at = now() where company_id = new.company_id and user_id = v_user;
    end if;
  end if;
  return new;
end $$;
create trigger conversations_assign before insert or update of needs_attention, handler, assigned_to on public.conversations
  for each row execute function public.tg_conversations_assign();

/* ---------- motivo de perda ---------- */
alter table public.contacts add column lost_reason text check (lost_reason in ('preco', 'convenio', 'horario', 'distancia', 'concorrente', 'sem_resposta', 'desistiu', 'outro'));

create or replace function public.tg_contacts_lost_reason() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.stage <> 'perdido' then new.lost_reason := null; end if;
  return new;
end $$;
create trigger contacts_lost_reason before insert or update of stage, lost_reason on public.contacts
  for each row execute function public.tg_contacts_lost_reason();

/* ---------- origem: Google ---------- */
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source in ('whatsapp', 'manual', 'indicacao', 'instagram', 'google', 'site', 'outro'));
