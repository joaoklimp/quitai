-- Segurança:
-- 1) mass assignment: o painel (papel "authenticated") não consegue forjar colunas que só o sistema escreve
--    (origem do registro, autor, datas de criação, resposta do paciente ao orçamento, saldo do estoque etc.);
-- 2) limite de requisições (rate limit) usado pelas Edge Functions, por usuário e por IP;
-- 3) permissões de inserção que o painel não usa são retiradas.

/* ---------- 1) colunas protegidas ---------- */
create or replace function public.tg_guard_panel_columns() returns trigger
language plpgsql set search_path = public as $$
declare
  locked text[] := array['id', 'company_id', 'created_at', 'created_via', 'created_by'];
  keep jsonb;
  cur jsonb := to_jsonb(new);
  forced jsonb := '{}'::jsonb;
begin
  -- só vale para o painel; funções do banco (security definer) e Edge Functions (service_role) seguem livres
  if current_user <> 'authenticated' then return new; end if;

  locked := locked || case tg_table_name
    when 'quotes' then array['number', 'public_token', 'viewed_at', 'responded_at', 'response_note', 'followup_sent_at']
    when 'appointments' then array['reminder_sent_at']
    when 'contacts' then array['total_spent', 'last_interaction_at', 'score']
    when 'stock_movements' then array['balance_after']
    when 'tasks' then array['reminded_at']
    when 'waitlist' then array['offered_at', 'offered_starts_at']
    else array[]::text[] end;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, to_jsonb(old) -> k), '{}'::jsonb) into keep
    from unnest(locked) k where cur ? k;
    return jsonb_populate_record(new, keep);
  end if;

  -- INSERT: o que o sistema define não vem do navegador
  if cur ? 'created_via' then forced := forced || jsonb_build_object('created_via', 'painel'); end if;
  if cur ? 'created_by' then forced := forced || jsonb_build_object('created_by', auth.uid()); end if;
  if cur ? 'created_at' then forced := forced || jsonb_build_object('created_at', now()); end if;
  if tg_table_name = 'quotes' then
    forced := forced || jsonb_build_object('public_token', encode(extensions.gen_random_bytes(16), 'hex'),
      'viewed_at', null, 'responded_at', null, 'response_note', null, 'followup_sent_at', null);
  elsif tg_table_name = 'appointments' then forced := forced || jsonb_build_object('reminder_sent_at', null);
  elsif tg_table_name = 'contacts' then forced := forced || jsonb_build_object('total_spent', 0, 'score', 50);
  elsif tg_table_name = 'tasks' then forced := forced || jsonb_build_object('reminded_at', null);
  elsif tg_table_name = 'waitlist' then forced := forced || jsonb_build_object('offered_at', null, 'offered_starts_at', null);
  end if;
  return jsonb_populate_record(new, forced);
end $$;
revoke all on function public.tg_guard_panel_columns() from public, anon, authenticated;

-- o nome começa com "a_" para rodar antes dos outros gatilhos (o PostgreSQL usa a ordem alfabética)
do $$
declare t text;
begin
  foreach t in array array['appointments', 'contacts', 'finance_entries', 'professionals', 'quote_items', 'quotes', 'sales',
                           'services', 'tasks', 'products', 'stock_movements', 'waitlist']
  loop
    execute format('drop trigger if exists a_guard_panel_columns on public.%I', t);
    execute format('create trigger a_guard_panel_columns before insert or update on public.%I for each row execute function public.tg_guard_panel_columns()', t);
  end loop;
end $$;

-- o painel não cria membros nem notificações diretamente (isso passa pelas funções do servidor)
revoke insert on public.members, public.notifications from authenticated;

/* ---------- 2) limite de requisições ---------- */
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Conta uma requisição para a chave e diz se ainda está dentro do limite da janela.
create or replace function public.rate_hit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (left(p_key, 200), now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into n;
  -- limpeza ocasional das janelas antigas
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  return n <= p_max;
end $$;
revoke all on function public.rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_hit(text, int, int) to service_role;
