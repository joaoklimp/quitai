-- App instalável da ORBYTA:
-- 1) sessão encerrada perde o acesso na hora e a verificação em duas etapas (código do autenticador) vale também no servidor;
-- 2) notificações no celular e no computador (Web Push): aparelhos, preferências e envio a cada aviso novo;
-- 3) desempenho: políticas que recalculavam o login a cada linha e chaves estrangeiras sem índice.

/* ---------- 1) sessão válida e verificação em duas etapas ---------- */
-- Toda permissão do painel passa por my_company, my_role, has_role e is_platform_admin; elas agora exigem:
-- a) sessão ainda aberta: "sair dos outros aparelhos" e troca de senha derrubam o acesso na hora, sem esperar o token vencer;
-- b) quem ativou a verificação em duas etapas precisa ter digitado o código nesta sessão (nível "aal2"):
--    com a senha roubada, mas sem o celular, o banco não entrega nada (nem pela API direta).
create or replace function public.session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select (auth.jwt() ->> 'session_id' is null
          or exists (select 1 from auth.sessions s where s.id = (auth.jwt() ->> 'session_id')::uuid))
     and (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'))
$$;
revoke all on function public.session_ok() from public, anon, authenticated;
grant execute on function public.session_ok() to service_role; -- as permissões usam por dentro (security definer)

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.members where user_id = auth.uid() and active and public.session_ok() limit 1
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and active and public.session_ok() limit 1
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any (roles) from public.members where user_id = auth.uid() and active and public.session_ok() limit 1), false)
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_ok() and exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

/* ---------- 2) notificações push ---------- */
-- Cada aparelho (navegador ou app instalado) que aceitou receber avisos. Só as Edge Functions leem e gravam.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures int not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index push_subscriptions_company_idx on public.push_subscriptions (company_id);

-- Preferências de cada pessoa: tipos de aviso silenciados e se a tela bloqueada mostra nomes e detalhes.
-- Por padrão a tela bloqueada não mostra nome de paciente nem valores (dado de saúde é sensível).
create table public.push_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  muted text[] not null default '{}',
  details boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Segredos gerados pelo próprio sistema (ex.: chaves VAPID das notificações), gravados criptografados.
create table public.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_prefs enable row level security;
alter table public.app_secrets enable row level security;
revoke all on public.push_subscriptions, public.push_prefs, public.app_secrets from anon, authenticated;

-- Aviso novo no painel → a Edge Function "push" entrega nos aparelhos (só se alguém da empresa ativou).
-- Nunca atrapalha a gravação do aviso: qualquer falha vira só um alerta no log do banco.
create or replace function public.tg_push_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.push_subscriptions s
                 where s.company_id = new.company_id and (new.user_id is null or s.user_id = new.user_id)) then
    return null;
  end if;
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := jsonb_build_object('action', 'deliver', 'id', new.id),
      timeout_milliseconds := 15000);
  exception when others then
    raise warning 'push: aviso % não enviado aos aparelhos: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.tg_push_notification() from public, anon, authenticated;
create trigger push_after_insert after insert on public.notifications
  for each row execute function public.tg_push_notification();

-- Quem sai da equipe (ou é desativado) para de receber os avisos da empresa na hora.
create or replace function public.tg_push_member_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or (old.active and not new.active) then
    delete from public.push_subscriptions where user_id = old.user_id and company_id = old.company_id;
  end if;
  return null;
end $$;
revoke all on function public.tg_push_member_gone() from public, anon, authenticated;
create trigger push_member_gone after update of active or delete on public.members
  for each row execute function public.tg_push_member_gone();

/* ---------- 3) avisos: o que é do financeiro fica com dono e gerente ---------- */
-- Pagamentos recebidos, notas fiscais e assinatura aparecem só para quem já vê essas telas.
-- (o login entra como "(select auth.uid())": o banco calcula uma vez por consulta, não uma vez por linha)
alter policy notifications_read on public.notifications
  using (company_id = public.my_company() and (user_id is null or user_id = (select auth.uid()))
         and (kind not in ('venda', 'financeiro', 'assinatura') or public.has_role('dono', 'gerente')));
alter policy notifications_update on public.notifications
  using (company_id = public.my_company() and (user_id is null or user_id = (select auth.uid()))
         and (kind not in ('venda', 'financeiro', 'assinatura') or public.has_role('dono', 'gerente')))
  with check (company_id = public.my_company());

alter policy members_update on public.members
  using (company_id = public.my_company() and (public.has_role('dono') or user_id = (select auth.uid())))
  with check (company_id = public.my_company());

alter policy platform_admins_read on public.platform_admins using (user_id = (select auth.uid()));

alter policy conversations_read on public.conversations
  using (company_id = public.my_company() and (kind = 'cliente' or member_user_id = (select auth.uid())));

alter policy messages_read on public.messages
  using (company_id = public.my_company() and exists (
    select 1 from public.conversations c where c.id = conversation_id and (c.kind = 'cliente' or c.member_user_id = (select auth.uid()))));

alter policy pending_read on public.pending_actions
  using (company_id = public.my_company() and exists (
    select 1 from public.conversations c where c.id = conversation_id and (c.kind = 'cliente' or c.member_user_id = (select auth.uid()))));

/* ---------- 4) índices das chaves estrangeiras (exclusões e junções sem varrer a tabela inteira) ---------- */
create index if not exists admin_actions_admin_idx on public.admin_actions (admin_id);
create index if not exists appointments_service_idx on public.appointments (service_id);
create index if not exists automation_runs_automation_idx on public.automation_runs (automation_id);
create index if not exists charges_contact_idx on public.charges (contact_id);
create index if not exists charges_finance_entry_idx on public.charges (finance_entry_id);
create index if not exists charges_quote_idx on public.charges (quote_id);
create index if not exists charges_sale_idx on public.charges (sale_id);
create index if not exists companies_owner_idx on public.companies (owner_id);
create index if not exists companies_plan_idx on public.companies (plan);
create index if not exists conversations_assigned_to_idx on public.conversations (assigned_to);
create index if not exists conversations_contact_idx on public.conversations (contact_id);
create index if not exists conversations_member_user_idx on public.conversations (member_user_id);
create index if not exists finance_entries_contact_idx on public.finance_entries (contact_id);
create index if not exists finance_entries_sale_idx on public.finance_entries (sale_id);
create index if not exists fiscal_notes_charge_idx on public.fiscal_notes (charge_id);
create index if not exists fiscal_notes_contact_idx on public.fiscal_notes (contact_id);
create index if not exists fiscal_notes_sale_idx on public.fiscal_notes (sale_id);
create index if not exists notifications_user_idx on public.notifications (user_id);
create index if not exists owner_link_codes_company_idx on public.owner_link_codes (company_id);
create index if not exists owner_link_codes_user_idx on public.owner_link_codes (user_id);
create index if not exists pending_actions_conversation_idx on public.pending_actions (conversation_id);
create index if not exists pending_actions_requested_by_idx on public.pending_actions (requested_by);
create index if not exists pending_actions_resolved_by_idx on public.pending_actions (resolved_by);
create index if not exists professionals_member_user_idx on public.professionals (member_user_id);
create index if not exists quote_items_company_idx on public.quote_items (company_id);
create index if not exists quote_items_service_idx on public.quote_items (service_id);
create index if not exists sales_appointment_idx on public.sales (appointment_id);
create index if not exists sales_quote_idx on public.sales (quote_id);
create index if not exists stock_movements_created_by_idx on public.stock_movements (created_by);
create index if not exists tasks_contact_idx on public.tasks (contact_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists waitlist_appointment_idx on public.waitlist (appointment_id);
create index if not exists waitlist_contact_idx on public.waitlist (contact_id);
create index if not exists waitlist_service_idx on public.waitlist (service_id);
