-- Combinado — regras de negócio no banco: gatilhos, histórico de ações, avisos e funções (RPC)
-- chamadas pelo painel, pela página pública do orçamento e pelas Edge Functions.

/* =========================================================================================
   Utilitários
   ========================================================================================= */
create or replace function public.fmt_brl(v numeric) returns text
language sql immutable as $$
  select 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,')
$$;

create or replace function public.quote_no(n int) returns text
language sql immutable as $$ select lpad(n::text, 4, '0') $$;

create or replace function public.first_name(t text) returns text
language sql immutable as $$ select split_part(trim(coalesce(t, '')), ' ', 1) $$;

-- mesmo critério de shared/format.ts: só dígitos, com 55 quando vier sem o código do país
create or replace function public.normalize_phone(raw text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
begin
  if d = '' then return null; end if;
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if length(d) in (10, 11) then d := '55' || d; end if;
  return d;
end $$;

-- variações do mesmo celular brasileiro (com e sem o 9 depois do DDD), como o WhatsApp às vezes manda
create or replace function public.phone_variants(raw text) returns text[]
language plpgsql immutable as $$
declare d text := public.normalize_phone(raw);
begin
  if d is null then return '{}'; end if;
  if left(d, 2) = '55' and length(d) = 13 and substr(d, 5, 1) = '9' then return array[d, left(d, 4) || substr(d, 6)]; end if;
  if left(d, 2) = '55' and length(d) = 12 then return array[d, left(d, 4) || '9' || substr(d, 5)]; end if;
  return array[d];
end $$;

create or replace function public.company_tz(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.companies where id = cid), 'America/Sao_Paulo')
$$;

create or replace function public.fmt_when(ts timestamptz, tz text) returns text
language sql stable as $$
  select to_char(ts at time zone tz, 'DD/MM') || ' às ' || to_char(ts at time zone tz, 'HH24:MI')
$$;

create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create trigger companies_updated before update on public.companies for each row execute function public.tg_set_updated_at();
create trigger ai_settings_updated before update on public.ai_settings for each row execute function public.tg_set_updated_at();
create trigger whatsapp_accounts_updated before update on public.whatsapp_accounts for each row execute function public.tg_set_updated_at();
create trigger whatsapp_credentials_updated before update on public.whatsapp_credentials for each row execute function public.tg_set_updated_at();
create trigger billing_accounts_updated before update on public.billing_accounts for each row execute function public.tg_set_updated_at();
create trigger contacts_updated before update on public.contacts for each row execute function public.tg_set_updated_at();
create trigger services_updated before update on public.services for each row execute function public.tg_set_updated_at();
create trigger appointments_updated before update on public.appointments for each row execute function public.tg_set_updated_at();

/* =========================================================================================
   Histórico de ações e avisos
   ========================================================================================= */
-- Registra uma ação. Do painel (usuário logado), o autor é a pessoa; sem usuário, é o sistema.
-- As Edge Functions gravam o histórico da IA direto na tabela, com o autor e o canal certos.
create or replace function public.audit(p_company uuid, p_action text, p_summary text, p_target_type text default null, p_target_id uuid default null,
  p_status text default 'ok', p_actor_type text default null, p_actor_name text default null, p_channel text default null, p_meta jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_type text := p_actor_type; v_name text := p_actor_name;
begin
  if current_setting('combinado.skip_audit', true) = 'on' then return; end if;
  if v_type is null then v_type := case when auth.uid() is not null then 'usuario' else 'sistema' end; end if;
  if v_name is null and v_type = 'usuario' then select name into v_name from public.members where user_id = auth.uid() limit 1; end if;
  if v_name is null then v_name := case v_type when 'ia' then 'IA' when 'sistema' then 'Sistema' when 'cliente' then 'Cliente' else 'Equipe' end; end if;
  insert into public.audit_log (company_id, actor_type, actor_name, actor_user_id, channel, action, summary, target_type, target_id, status, meta)
  values (p_company, v_type, v_name, auth.uid(), coalesce(p_channel, 'painel'), p_action, p_summary, p_target_type, p_target_id, p_status, p_meta);
end $$;

create or replace function public.notify(p_company uuid, p_kind text, p_title text, p_body text default null, p_link text default null, p_user uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (company_id, user_id, kind, title, body, link) values (p_company, p_user, p_kind, p_title, p_body, p_link);
$$;

-- Ações feitas no painel viram histórico automaticamente (as Edge Functions registram as delas).
create or replace function public.tg_audit_panel() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record := coalesce(new, old);
  cid uuid;
  tz text;
  who text;
begin
  if auth.uid() is null then return null; end if; -- ação de sistema ou da IA: quem fez registra
  if tg_table_name = 'companies' then cid := r.id; else cid := r.company_id; end if;
  tz := public.company_tz(cid);
  case tg_table_name
    when 'contacts' then
      if tg_op = 'INSERT' then perform public.audit(cid, 'cadastrar_cliente', format('Cadastrou o cliente %s', new.name), 'contact', new.id);
      elsif tg_op = 'DELETE' then perform public.audit(cid, 'excluir_cliente', format('Excluiu o cliente %s', old.name), 'contact', old.id);
      end if;
    when 'services' then
      if tg_op = 'INSERT' then perform public.audit(cid, 'criar_servico', format('Criou o serviço %s (%s)', new.name, case new.price_type when 'sob_consulta' then 'sob consulta' else public.fmt_brl(new.price) end), 'service', new.id);
      elsif tg_op = 'DELETE' then perform public.audit(cid, 'excluir_servico', format('Excluiu o serviço %s', old.name), 'service', old.id);
      elsif new.price is distinct from old.price or new.price_type is distinct from old.price_type then
        perform public.audit(cid, 'atualizar_servico', format('Alterou o preço de %s de %s para %s', new.name, public.fmt_brl(old.price), public.fmt_brl(new.price)), 'service', new.id);
      elsif new.active is distinct from old.active then
        perform public.audit(cid, 'atualizar_servico', format('%s o serviço %s', case when new.active then 'Reativou' else 'Desativou' end, new.name), 'service', new.id);
      end if;
    when 'quotes' then
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        perform public.audit(cid, 'atualizar_orcamento', format('Marcou o orçamento nº %s como %s', public.quote_no(new.number), new.status), 'quote', new.id);
      elsif tg_op = 'DELETE' then perform public.audit(cid, 'excluir_orcamento', format('Excluiu o orçamento nº %s', public.quote_no(old.number)), 'quote', old.id);
      end if;
    when 'appointments' then
      select name into who from public.contacts where id = r.contact_id;
      if tg_op = 'INSERT' then
        perform public.audit(cid, 'agendar', format('Agendou %s para %s (%s)', coalesce(who, new.title), public.fmt_when(new.starts_at, tz), new.title), 'appointment', new.id);
      elsif tg_op = 'DELETE' then perform public.audit(cid, 'excluir_agendamento', format('Excluiu o horário de %s em %s', coalesce(who, old.title), public.fmt_when(old.starts_at, tz)), 'appointment', old.id);
      elsif new.status is distinct from old.status and new.status = 'cancelado' then
        perform public.audit(cid, 'cancelar_agendamento', format('Cancelou o horário de %s em %s', coalesce(who, new.title), public.fmt_when(new.starts_at, tz)), 'appointment', new.id);
      elsif new.status is distinct from old.status then
        perform public.audit(cid, 'atualizar_agendamento', format('Marcou o horário de %s em %s como %s', coalesce(who, new.title), public.fmt_when(new.starts_at, tz), new.status), 'appointment', new.id);
      elsif new.starts_at is distinct from old.starts_at then
        perform public.audit(cid, 'remarcar', format('Remarcou %s para %s', coalesce(who, new.title), public.fmt_when(new.starts_at, tz)), 'appointment', new.id);
      end if;
    when 'sales' then
      select name into who from public.contacts where id = r.contact_id;
      if tg_op = 'INSERT' then perform public.audit(cid, 'registrar_venda', format('Registrou venda de %s (%s)%s', public.fmt_brl(new.amount), new.method, coalesce(' para ' || who, '')), 'sale', new.id);
      elsif tg_op = 'DELETE' then perform public.audit(cid, 'excluir_venda', format('Excluiu a venda de %s%s', public.fmt_brl(old.amount), coalesce(' de ' || who, '')), 'sale', old.id);
      elsif new.amount is distinct from old.amount then perform public.audit(cid, 'atualizar_venda', format('Alterou uma venda de %s para %s', public.fmt_brl(old.amount), public.fmt_brl(new.amount)), 'sale', new.id);
      end if;
    when 'tasks' then
      if tg_op = 'INSERT' then perform public.audit(cid, 'criar_tarefa', format('Criou a tarefa "%s"', new.title), 'task', new.id);
      elsif tg_op = 'UPDATE' and new.done_at is not null and old.done_at is null then perform public.audit(cid, 'concluir_tarefa', format('Concluiu a tarefa "%s"', new.title), 'task', new.id);
      end if;
    when 'conversations' then
      if new.handler is distinct from old.handler then
        select name into who from public.contacts where id = new.contact_id;
        perform public.audit(cid, case when new.handler = 'ia' then 'devolver_para_ia' else 'assumir_conversa' end,
          format('%s a conversa com %s', case when new.handler = 'ia' then 'Devolveu para a IA' else 'Assumiu' end, coalesce(who, 'cliente')), 'conversation', new.id);
      end if;
    when 'members' then
      if new.role is distinct from old.role then perform public.audit(cid, 'alterar_papel', format('Mudou %s para %s', new.name, new.role), 'member', null);
      elsif new.active is distinct from old.active then perform public.audit(cid, case when new.active then 'reativar_membro' else 'desativar_membro' end, format('%s o acesso de %s', case when new.active then 'Reativou' else 'Desativou' end, new.name), 'member', null);
      end if;
    when 'ai_settings' then perform public.audit(cid, 'atualizar_ia', 'Atualizou as configurações do assistente', null, null);
    when 'companies' then perform public.audit(new.id, 'atualizar_empresa', 'Atualizou os dados da empresa', null, null);
    when 'automations' then
      if new.enabled is distinct from old.enabled then perform public.audit(cid, case when new.enabled then 'ativar_automacao' else 'desativar_automacao' end, format('%s a automação %s', case when new.enabled then 'Ligou' else 'Desligou' end, replace(new.kind, '_', ' ')), 'automation', new.id);
      end if;
    else null;
  end case;
  return null;
end $$;

create trigger contacts_audit after insert or delete on public.contacts for each row execute function public.tg_audit_panel();
create trigger services_audit after insert or update or delete on public.services for each row execute function public.tg_audit_panel();
create trigger quotes_audit after update or delete on public.quotes for each row execute function public.tg_audit_panel();
create trigger appointments_audit after insert or update or delete on public.appointments for each row execute function public.tg_audit_panel();
create trigger sales_audit after insert or update or delete on public.sales for each row execute function public.tg_audit_panel();
create trigger tasks_audit after insert or update on public.tasks for each row execute function public.tg_audit_panel();
create trigger conversations_audit after update of handler on public.conversations for each row execute function public.tg_audit_panel();
create trigger members_audit after update of role, active on public.members for each row execute function public.tg_audit_panel();
create trigger ai_settings_audit after update on public.ai_settings for each row execute function public.tg_audit_panel();
create trigger companies_audit after update of name, segment, document, phone, email, address, city, state, timezone, business_hours, slot_minutes, capacity_per_slot, min_notice_minutes, max_days_ahead, monthly_goal
  on public.companies for each row execute function public.tg_audit_panel();
create trigger automations_audit after update of enabled on public.automations for each row execute function public.tg_audit_panel();

/* =========================================================================================
   Gatilhos de negócio
   ========================================================================================= */
-- telefone sempre normalizado
create or replace function public.tg_contacts_before() returns trigger
language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  new.name := trim(new.name);
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  return new;
end $$;
create trigger contacts_before before insert or update of phone, name, email on public.contacts for each row execute function public.tg_contacts_before();

-- orçamento: número sequencial por empresa, validade padrão e totais calculados pelos itens
create or replace function public.tg_quotes_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare tz text := public.company_tz(new.company_id);
begin
  if tg_op = 'INSERT' then
    insert into public.company_counters as cc (company_id, quote_seq) values (new.company_id, 1)
      on conflict (company_id) do update set quote_seq = cc.quote_seq + 1
      returning quote_seq into new.number;
    new.valid_until := coalesce(new.valid_until, (now() at time zone tz)::date + 7);
    if not exists (select 1 from public.contacts where id = new.contact_id and company_id = new.company_id) then
      raise exception 'Cliente não encontrado nesta empresa.' using errcode = 'P0001';
    end if;
  else
    new.number := old.number;
    new.public_token := old.public_token;
    new.company_id := old.company_id;
    new.updated_at := now();
  end if;
  new.subtotal := coalesce((select sum(round(qty * unit_price, 2)) from public.quote_items where quote_id = new.id), 0);
  new.discount := least(greatest(coalesce(new.discount, 0), 0), new.subtotal);
  new.total := new.subtotal - new.discount;
  if new.status = 'enviado' and new.sent_at is null then new.sent_at := now(); end if;
  if new.status in ('aprovado', 'recusado') and (tg_op = 'INSERT' or old.status is distinct from new.status) then new.responded_at := coalesce(new.responded_at, now()); end if;
  return new;
end $$;
create trigger quotes_before before insert or update on public.quotes for each row execute function public.tg_quotes_before();

create or replace function public.tg_quotes_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.contacts set stage = 'orcamento' where id = new.contact_id and stage in ('novo', 'conversando');
  elsif new.status is distinct from old.status then
    if new.status = 'aprovado' then update public.contacts set stage = 'fechado', temperature = 'quente' where id = new.contact_id;
    elsif new.status = 'recusado' then update public.contacts set stage = 'perdido' where id = new.contact_id and stage <> 'fechado';
    elsif new.status = 'enviado' then update public.contacts set stage = 'orcamento' where id = new.contact_id and stage in ('novo', 'conversando');
    end if;
  end if;
  return null;
end $$;
create trigger quotes_after after insert or update of status on public.quotes for each row execute function public.tg_quotes_after();

create or replace function public.tg_quote_items_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('combinado.saving_quote', true) = 'on' then return null; end if; -- save_quote recalcula no fim
  update public.quotes set updated_at = now() where id = coalesce(new.quote_id, old.quote_id);
  return null;
end $$;
create trigger quote_items_after after insert or update or delete on public.quote_items for each row execute function public.tg_quote_items_after();

create or replace function public.tg_quote_items_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from public.quotes where id = new.quote_id;
  if new.company_id is null then raise exception 'Orçamento não encontrado.' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger quote_items_before before insert or update of quote_id on public.quote_items for each row execute function public.tg_quote_items_before();

-- mensagens: atualizam a conversa, o tempo de resposta e a última interação do cliente
create or replace function public.tg_messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare since timestamptz;
begin
  if new.direction = 'out' and new.sender in ('ia', 'equipe') and new.response_seconds is null then
    select awaiting_since into since from public.conversations where id = new.conversation_id;
    if since is not null then new.response_seconds := greatest(0, extract(epoch from (new.created_at - since)))::int; end if;
  end if;
  return new;
end $$;
create trigger messages_before before insert on public.messages for each row execute function public.tg_messages_before();

create or replace function public.tg_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  conv record;
  preview text := left(coalesce(nullif(trim(new.body), ''), case new.media->>'type' when 'image' then '📷 Foto' when 'audio' then '🎤 Áudio' when 'video' then '🎬 Vídeo' when 'document' then '📄 Documento' when 'location' then '📍 Localização' else 'Mensagem' end), 160);
begin
  update public.conversations c set
    last_message_at = new.created_at,
    last_message_preview = preview,
    last_inbound_at = case when new.direction = 'in' then new.created_at else c.last_inbound_at end,
    unread = case when new.direction = 'in' then c.unread + 1 else c.unread end,
    awaiting_since = case
      when new.direction = 'in' and new.sender = 'contato' then coalesce(c.awaiting_since, new.created_at)
      when new.direction = 'out' and new.sender in ('ia', 'equipe') then null
      else c.awaiting_since end,
    status = case when new.direction = 'in' then 'aberta' else c.status end
  where c.id = new.conversation_id
  returning c.kind, c.contact_id into conv;
  if conv.kind = 'cliente' and conv.contact_id is not null then
    update public.contacts set
      last_interaction_at = new.created_at,
      stage = case when stage = 'novo' and new.direction = 'out' then 'conversando' else stage end
    where id = conv.contact_id;
  end if;
  return null;
end $$;
create trigger messages_after after insert on public.messages for each row execute function public.tg_messages_after();

-- vendas: total gasto do cliente sempre certo
create or replace function public.tg_sales_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[] := array_remove(array[case when tg_op <> 'INSERT' then old.contact_id end, case when tg_op <> 'DELETE' then new.contact_id end], null);
begin
  update public.contacts c set total_spent = coalesce((select sum(amount) from public.sales s where s.contact_id = c.id), 0)
  where c.id = any (ids);
  if tg_op = 'INSERT' and new.contact_id is not null then
    update public.contacts set stage = 'fechado' where id = new.contact_id and stage <> 'fechado';
  end if;
  return null;
end $$;
create trigger sales_after after insert or update of amount, contact_id or delete on public.sales for each row execute function public.tg_sales_after();

-- equipe: só o dono muda papéis e acessos; a empresa nunca fica sem dono; trocar o telefone exige verificar de novo
create or replace function public.tg_members_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if (new.role is distinct from old.role or new.active is distinct from old.active) and not public.has_role('dono') then
      raise exception 'Só o dono pode mudar papéis e acessos.' using errcode = '42501';
    end if;
    if old.role = 'dono' and (new.role <> 'dono' or not new.active)
       and not exists (select 1 from public.members where company_id = old.company_id and role = 'dono' and active and user_id <> old.user_id) then
      raise exception 'A empresa precisa de pelo menos um dono ativo.' using errcode = 'P0001';
    end if;
  end if;
  new.phone := public.normalize_phone(new.phone);
  if new.phone is distinct from old.phone and auth.uid() is not null then new.phone_verified_at := null; end if;
  return new;
end $$;
create trigger members_before before update on public.members for each row execute function public.tg_members_before();

-- conversas: devolver para a IA limpa o aviso; um novo aviso de atenção vira notificação para a equipe
create or replace function public.tg_conversations_before() returns trigger
language plpgsql as $$
begin
  if new.handler = 'ia' and old.handler = 'humano' then new.needs_attention := false; new.attention_reason := null; end if;
  if new.status = 'resolvida' and old.status = 'aberta' then new.needs_attention := false; end if;
  return new;
end $$;
create trigger conversations_before before update on public.conversations for each row execute function public.tg_conversations_before();

create or replace function public.tg_conversations_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.kind = 'cliente' and new.needs_attention and not coalesce(old.needs_attention, false) then
    select name into who from public.contacts where id = new.contact_id;
    perform public.notify(new.company_id, 'atendimento', format('%s precisa de você', coalesce(public.first_name(who), 'Um cliente')),
      coalesce(new.attention_reason, 'A IA passou o atendimento para a equipe.'), '#/conversas/' || new.id);
  end if;
  return null;
end $$;
create trigger conversations_after after insert or update of needs_attention on public.conversations for each row execute function public.tg_conversations_after();

-- agenda: a IA nunca marca em cima de outro horário (respeitando a capacidade por horário)
create or replace function public.tg_appointments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; busy int;
begin
  if new.title = '' then
    select coalesce(s.name, 'Atendimento') into new.title from (select 1) x left join public.services s on s.id = new.service_id;
  end if;
  if new.created_via in ('ia_cliente', 'site') and new.status not in ('cancelado', 'faltou')
     and (tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    select capacity_per_slot into cap from public.companies where id = new.company_id;
    select count(*) into busy from public.appointments a
      where a.company_id = new.company_id and a.id <> new.id and a.status not in ('cancelado', 'faltou')
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(new.starts_at, new.ends_at);
    if busy >= coalesce(cap, 1) then raise exception 'horario_ocupado' using errcode = 'P0001', hint = 'Esse horário acabou de ser ocupado.'; end if;
  end if;
  return new;
end $$;
create trigger appointments_before before insert or update on public.appointments for each row execute function public.tg_appointments_before();

/* =========================================================================================
   Primeira configuração da empresa (com serviços de exemplo do segmento)
   ========================================================================================= */
-- Mesma lista de src/shared/presets.ts
create or replace function public.segment_presets(p_segment text) returns jsonb
language sql immutable as $$
  select coalesce(('{
    "limpeza": [["Limpeza de sofá 3 lugares",180,"a_partir_de",120,"Sofás"],["Limpeza de sofá 2 lugares",150,"fixo",90,"Sofás"],["Higienização de colchão casal",160,"fixo",60,"Colchões"],["Limpeza de tapete (por m²)",25,"a_partir_de",60,"Tapetes"],["Impermeabilização de sofá",290,"a_partir_de",120,"Sofás"]],
    "beleza": [["Corte feminino",80,"a_partir_de",60,"Cabelo"],["Escova",60,"a_partir_de",45,"Cabelo"],["Manicure e pedicure",70,"fixo",90,"Unhas"],["Design de sobrancelha",45,"fixo",30,"Rosto"],["Limpeza de pele",150,"fixo",60,"Estética"]],
    "oficina": [["Troca de óleo e filtro",180,"a_partir_de",60,"Manutenção"],["Alinhamento e balanceamento",120,"fixo",60,"Rodas"],["Revisão completa",450,"a_partir_de",240,"Manutenção"],["Diagnóstico eletrônico",100,"fixo",45,"Diagnóstico"],["Funilaria e pintura",0,"sob_consulta",60,"Lataria"]],
    "assistencia": [["Troca de tela de celular",250,"a_partir_de",90,"Celulares"],["Troca de bateria",150,"a_partir_de",60,"Celulares"],["Formatação de computador",120,"fixo",120,"Computadores"],["Orçamento técnico",0,"sob_consulta",30,"Geral"]],
    "saude": [["Consulta",250,"fixo",50,"Consultas"],["Retorno",0,"fixo",30,"Consultas"],["Avaliação inicial",150,"fixo",40,"Avaliações"],["Sessão de fisioterapia",120,"fixo",50,"Sessões"]],
    "pet": [["Banho (porte pequeno)",60,"fixo",60,"Banho"],["Banho e tosa (porte médio)",110,"a_partir_de",90,"Tosa"],["Tosa higiênica",45,"fixo",30,"Tosa"],["Consulta veterinária",180,"fixo",40,"Veterinária"]],
    "reformas": [["Visita técnica",0,"sob_consulta",60,"Visitas"],["Pintura (por m²)",35,"a_partir_de",240,"Pintura"],["Instalação elétrica (ponto)",90,"a_partir_de",60,"Elétrica"],["Reparo hidráulico",150,"a_partir_de",90,"Hidráulica"]],
    "eventos": [["Buffet por pessoa",85,"a_partir_de",300,"Buffet"],["Decoração",0,"sob_consulta",120,"Decoração"],["Visita para degustação",0,"fixo",60,"Atendimento"]],
    "educacao": [["Aula avulsa",90,"fixo",60,"Aulas"],["Pacote mensal (4 aulas)",320,"fixo",60,"Pacotes"],["Aula experimental",0,"fixo",45,"Aulas"]],
    "outro": [["Atendimento",100,"a_partir_de",60,"Serviços"],["Orçamento sob medida",0,"sob_consulta",30,"Serviços"]]
  }'::jsonb) -> p_segment, '[]'::jsonb)
$$;

create or replace function public.onboard_company(p_name text, p_segment text, p_phone text, p_city text default null, p_preset boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  u record;
  item jsonb;
  i int := 0;
begin
  if uid is null then raise exception 'Entre na sua conta para continuar.' using errcode = '42501'; end if;
  perform set_config('combinado.skip_audit', 'on', true); -- os serviços de exemplo não entram no histórico
  if exists (select 1 from public.members where user_id = uid) then raise exception 'Você já faz parte de uma empresa.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Informe o nome da empresa.' using errcode = 'P0001'; end if;
  select email, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1)) as name into u from auth.users where id = uid;

  insert into public.companies (name, segment, phone, city, owner_id, email)
  values (trim(p_name), coalesce(nullif(p_segment, ''), 'outro'), public.normalize_phone(p_phone), nullif(trim(coalesce(p_city, '')), ''), uid, u.email)
  returning id into cid;
  insert into public.members (company_id, user_id, role, name, email) values (cid, uid, 'dono', coalesce(u.name, ''), coalesce(u.email, ''));
  insert into public.ai_settings (company_id, greeting) values (cid, format('Olá! Aqui é da %s. Como posso ajudar?', trim(p_name)));
  insert into public.company_counters (company_id) values (cid);
  insert into public.automations (company_id, kind, enabled, config, template_name) values
    (cid, 'lembrete_agendamento', true, '{"horas_antes":24,"pedir_confirmacao":true}', 'lembrete_agendamento'),
    (cid, 'followup_orcamento', true, '{"dias_depois":2,"max_tentativas":2}', 'acompanhamento_orcamento'),
    (cid, 'resumo_diario', true, '{"horario":"19:00","incluir_agenda":true}', 'resumo_diario'),
    (cid, 'pos_atendimento', false, '{"horas_depois":3,"pedir_avaliacao":true,"link_avaliacao":""}', 'pos_atendimento'),
    (cid, 'reativacao', false, '{"dias_sem_compra":120,"desconto_pct":10}', 'reativacao_cliente'),
    (cid, 'lembrete_tarefa', true, '{"minutos_antes":30}', null);
  if coalesce(p_preset, true) then
    for item in select * from jsonb_array_elements(public.segment_presets(coalesce(nullif(p_segment, ''), 'outro'))) loop
      insert into public.services (company_id, name, price, price_type, duration_min, category, sort)
      values (cid, item->>0, (item->>1)::numeric, item->>2, (item->>3)::int, item->>4, i);
      i := i + 1;
    end loop;
  end if;
  perform public.notify(cid, 'sistema', 'Bem-vindo ao Combinado!', 'Teste a IA no Simulador e conecte o WhatsApp quando estiver pronto.', '#/simulador');
  perform set_config('combinado.skip_audit', 'off', true);
  insert into public.audit_log (company_id, actor_type, actor_name, actor_user_id, channel, action, summary)
  values (cid, 'usuario', u.name, uid, 'painel', 'criar_empresa', format('Criou a empresa %s', trim(p_name)));
  return cid;
end $$;

/* =========================================================================================
   Orçamentos: salvar (com itens), página pública e resposta do cliente
   ========================================================================================= */
create or replace function public.save_quote(p_quote jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_company();
  qid uuid := nullif(p_quote->>'id', '')::uuid;
  is_new boolean := nullif(p_quote->>'id', '') is null;
  it jsonb;
  i int := 0;
  who text;
begin
  if cid is null then raise exception 'Sessão expirada. Entre de novo.' using errcode = '42501'; end if;
  if not public.company_writable(cid) then raise exception 'Sua assinatura está inativa. Reative para criar e editar orçamentos.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione pelo menos um item ao orçamento.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.contacts where id = (p_quote->>'contact_id')::uuid and company_id = cid) then raise exception 'Escolha um cliente.' using errcode = 'P0001'; end if;

  if not is_new then
    perform 1 from public.quotes where id = qid and company_id = cid for update;
    if not found then raise exception 'Orçamento não encontrado.' using errcode = 'P0001'; end if;
  end if;

  perform set_config('combinado.saving_quote', 'on', true);
  if qid is null then
    insert into public.quotes (company_id, contact_id, title, status, discount, valid_until, notes, created_via)
    values (cid, (p_quote->>'contact_id')::uuid, nullif(p_quote->>'title', ''), coalesce(nullif(p_quote->>'status', ''), 'rascunho'),
            coalesce((p_quote->>'discount')::numeric, 0), nullif(p_quote->>'valid_until', '')::date, nullif(p_quote->>'notes', ''), 'painel')
    returning id into qid;
  else
    delete from public.quote_items where quote_id = qid;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.quote_items (quote_id, company_id, service_id, description, qty, unit_price, sort)
    values (qid, cid, nullif(it->>'service_id', '')::uuid, coalesce(nullif(trim(it->>'description'), ''), 'Item'), greatest(coalesce((it->>'qty')::numeric, 1), 0.01), greatest(coalesce((it->>'unit_price')::numeric, 0), 0), i);
    i := i + 1;
  end loop;
  perform set_config('combinado.saving_quote', 'off', true);

  -- recalcula os totais e aplica os campos (o gatilho do orçamento faz as contas)
  perform set_config('combinado.skip_audit', 'on', true);
  update public.quotes set
    contact_id = (p_quote->>'contact_id')::uuid,
    title = nullif(p_quote->>'title', ''),
    status = coalesce(nullif(p_quote->>'status', ''), status),
    discount = coalesce((p_quote->>'discount')::numeric, 0),
    valid_until = coalesce(nullif(p_quote->>'valid_until', '')::date, valid_until),
    notes = nullif(p_quote->>'notes', '')
  where id = qid;
  perform set_config('combinado.skip_audit', 'off', true);

  select name into who from public.contacts where id = (p_quote->>'contact_id')::uuid;
  if is_new then
    perform public.audit(cid, 'criar_orcamento', (select format('Criou o orçamento nº %s de %s para %s', public.quote_no(number), public.fmt_brl(total), coalesce(who, 'cliente')) from public.quotes where id = qid), 'quote', qid);
  else
    perform public.audit(cid, 'atualizar_orcamento', (select format('Atualizou o orçamento nº %s (%s, %s)', public.quote_no(number), status, public.fmt_brl(total)) from public.quotes where id = qid), 'quote', qid);
  end if;
  return qid;
end $$;

-- Dados do orçamento para a página pública (sem login). Só o necessário, pelo token secreto do link.
create or replace function public.public_quote(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; out jsonb;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into q from public.quotes where public_token = p_token;
  if not found then return null; end if;
  if q.viewed_at is null then update public.quotes set viewed_at = now() where id = q.id; end if;
  select jsonb_build_object(
    'number', q.number, 'status', case when q.status = 'enviado' and q.valid_until < (now() at time zone c.timezone)::date then 'expirado' else q.status end,
    'title', q.title, 'subtotal', q.subtotal, 'discount', q.discount, 'total', q.total, 'valid_until', q.valid_until, 'notes', q.notes,
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'qty', i.qty, 'unit_price', i.unit_price) order by i.sort) from public.quote_items i where i.quote_id = q.id), '[]'::jsonb),
    'company', jsonb_build_object('name', c.name, 'phone', coalesce(w.display_phone, c.phone), 'city', c.city),
    'contact_name', ct.name)
  into out
  from public.companies c
  left join public.whatsapp_accounts w on w.company_id = c.id
  left join public.contacts ct on ct.id = q.contact_id
  where c.id = q.company_id;
  return out;
end $$;

create or replace function public.respond_quote(p_token text, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; tz text; who text;
begin
  if p_decision not in ('aprovado', 'recusado') then raise exception 'decisao_invalida' using errcode = 'P0001'; end if;
  select * into q from public.quotes where public_token = p_token for update;
  if not found then raise exception 'nao_disponivel' using errcode = 'P0001'; end if;
  tz := public.company_tz(q.company_id);
  if q.status not in ('enviado', 'rascunho') or (q.valid_until is not null and q.valid_until < (now() at time zone tz)::date) then
    raise exception 'nao_disponivel' using errcode = 'P0001';
  end if;
  update public.quotes set status = p_decision, responded_at = now(), response_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = q.id;
  select name into who from public.contacts where id = q.contact_id;
  perform public.notify(q.company_id, 'orcamento',
    case when p_decision = 'aprovado' then format('%s aprovou o orçamento', coalesce(public.first_name(who), 'O cliente')) else format('%s recusou o orçamento', coalesce(public.first_name(who), 'O cliente')) end,
    format('nº %s · %s%s', public.quote_no(q.number), public.fmt_brl(q.total), coalesce(' · “' || nullif(trim(coalesce(p_note, '')), '') || '”', '')),
    '#/orcamentos/' || q.id);
  insert into public.audit_log (company_id, actor_type, actor_name, channel, action, summary, target_type, target_id)
  values (q.company_id, 'cliente', coalesce(who, 'Cliente'), 'site', case when p_decision = 'aprovado' then 'aprovar_orcamento' else 'recusar_orcamento' end,
          format('%s o orçamento nº %s (%s) pelo link', case when p_decision = 'aprovado' then 'Aprovou' else 'Recusou' end, public.quote_no(q.number), public.fmt_brl(q.total)), 'quote', q.id);
  return jsonb_build_object('status', p_decision);
end $$;

/* =========================================================================================
   Números do painel
   ========================================================================================= */
create or replace function public.daily_stats(p_from date, p_to date)
returns table (
  day date, msgs_in bigint, msgs_ai bigint, msgs_team bigint, conversations bigint, new_contacts bigint,
  quotes_created bigint, quotes_sent bigint, quotes_approved bigint, quotes_value numeric,
  sales_count bigint, sales_amount numeric, sales_ia numeric, sales_equipe numeric, sales_balcao numeric,
  appointments bigint, response_sum bigint, response_count bigint, handoffs bigint
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  cid uuid := public.my_company();
  tz text := public.company_tz(cid);
  t0 timestamptz := (p_from::timestamp) at time zone tz;
  t1 timestamptz := ((p_to + 1)::timestamp) at time zone tz;
begin
  if cid is null then return; end if;
  if p_to - p_from > 800 then raise exception 'Período muito longo.' using errcode = 'P0001'; end if;
  return query
  with days as (select generate_series(p_from, p_to, interval '1 day')::date as d),
  m as (
    select (msg.created_at at time zone tz)::date as d,
      count(*) filter (where msg.direction = 'in') as msgs_in,
      count(*) filter (where msg.direction = 'out' and msg.sender = 'ia') as msgs_ai,
      count(*) filter (where msg.direction = 'out' and msg.sender = 'equipe') as msgs_team,
      count(distinct msg.conversation_id) filter (where msg.direction = 'in') as convs,
      coalesce(sum(msg.response_seconds) filter (where msg.response_seconds is not null), 0)::bigint as rsum,
      count(msg.response_seconds) as rcount
    from public.messages msg join public.conversations c on c.id = msg.conversation_id
    where msg.company_id = cid and msg.created_at >= t0 and msg.created_at < t1 and c.kind = 'cliente' and c.channel = 'whatsapp'
    group by 1),
  ct as (select (created_at at time zone tz)::date as d, count(*) as n from public.contacts where company_id = cid and created_at >= t0 and created_at < t1 group by 1),
  qc as (select (created_at at time zone tz)::date as d, count(*) as n from public.quotes where company_id = cid and created_at >= t0 and created_at < t1 group by 1),
  qs as (select (sent_at at time zone tz)::date as d, count(*) as n from public.quotes where company_id = cid and sent_at >= t0 and sent_at < t1 group by 1),
  qa as (select (responded_at at time zone tz)::date as d, count(*) as n, sum(total) as v from public.quotes where company_id = cid and status = 'aprovado' and responded_at >= t0 and responded_at < t1 group by 1),
  s as (
    select (paid_at at time zone tz)::date as d, count(*) as n, sum(amount) as v,
      coalesce(sum(amount) filter (where origin = 'ia'), 0) as ia,
      coalesce(sum(amount) filter (where origin = 'equipe'), 0) as eq,
      coalesce(sum(amount) filter (where origin = 'balcao'), 0) as bal
    from public.sales where company_id = cid and paid_at >= t0 and paid_at < t1 group by 1),
  ap as (select (created_at at time zone tz)::date as d, count(*) as n from public.appointments where company_id = cid and created_at >= t0 and created_at < t1 group by 1),
  h as (select (created_at at time zone tz)::date as d, count(*) as n from public.audit_log where company_id = cid and action = 'chamar_atendente' and created_at >= t0 and created_at < t1 group by 1)
  select days.d,
    coalesce(m.msgs_in, 0), coalesce(m.msgs_ai, 0), coalesce(m.msgs_team, 0), coalesce(m.convs, 0), coalesce(ct.n, 0),
    coalesce(qc.n, 0), coalesce(qs.n, 0), coalesce(qa.n, 0), coalesce(qa.v, 0),
    coalesce(s.n, 0), coalesce(s.v, 0), coalesce(s.ia, 0), coalesce(s.eq, 0), coalesce(s.bal, 0),
    coalesce(ap.n, 0), coalesce(m.rsum, 0), coalesce(m.rcount, 0), coalesce(h.n, 0)
  from days
  left join m on m.d = days.d left join ct on ct.d = days.d left join qc on qc.d = days.d left join qs on qs.d = days.d
  left join qa on qa.d = days.d left join s on s.d = days.d left join ap on ap.d = days.d left join h on h.d = days.d
  order by days.d;
end $$;

create or replace function public.peak_hours(p_from date, p_to date)
returns table (dow int, hour int, total bigint) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare cid uuid := public.my_company(); tz text := public.company_tz(cid);
begin
  if cid is null then return; end if;
  return query
  select extract(dow from msg.created_at at time zone tz)::int, extract(hour from msg.created_at at time zone tz)::int, count(*)
  from public.messages msg join public.conversations c on c.id = msg.conversation_id
  where msg.company_id = cid and msg.direction = 'in' and c.kind = 'cliente' and c.channel = 'whatsapp'
    and msg.created_at >= (p_from::timestamp) at time zone tz and msg.created_at < ((p_to + 1)::timestamp) at time zone tz
  group by 1, 2;
end $$;

create or replace function public.usage_current()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_company(); mon text; u record;
begin
  if cid is null then return null; end if;
  mon := to_char(now() at time zone public.company_tz(cid), 'YYYY-MM');
  select * into u from public.usage_monthly where company_id = cid and month = mon;
  return jsonb_build_object('company_id', cid, 'month', mon, 'ai_replies', coalesce(u.ai_replies, 0), 'wa_sent', coalesce(u.wa_sent, 0),
    'ai_input_tokens', coalesce(u.ai_input_tokens, 0), 'ai_output_tokens', coalesce(u.ai_output_tokens, 0));
end $$;

-- Usado pelas Edge Functions (chave de serviço): soma o uso do mês e avisa ao chegar em 80% do limite.
create or replace function public.bump_usage(p_company uuid, p_ai int default 0, p_wa int default 0, p_in bigint default 0, p_out bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mon text := to_char(now() at time zone public.company_tz(p_company), 'YYYY-MM'); u record; lim int;
begin
  insert into public.usage_monthly as um (company_id, month, ai_replies, wa_sent, ai_input_tokens, ai_output_tokens)
  values (p_company, mon, p_ai, p_wa, p_in, p_out)
  on conflict (company_id, month) do update set
    ai_replies = um.ai_replies + excluded.ai_replies, wa_sent = um.wa_sent + excluded.wa_sent,
    ai_input_tokens = um.ai_input_tokens + excluded.ai_input_tokens, ai_output_tokens = um.ai_output_tokens + excluded.ai_output_tokens
  returning * into u;
  select p.ai_replies into lim from public.companies c join public.plans p on p.id = c.plan where c.id = p_company;
  if lim > 0 and u.ai_replies >= lim * 0.8 and not u.warned_80 then
    update public.usage_monthly set warned_80 = true where company_id = p_company and month = mon;
    perform public.notify(p_company, 'assinatura', 'Você já usou 80% das respostas da IA deste mês',
      format('%s de %s respostas. Se precisar, mude de plano para a IA não parar.', u.ai_replies, lim), '#/configuracoes/assinatura');
  end if;
  return jsonb_build_object('ai_replies', u.ai_replies, 'limit', lim);
end $$;

/* =========================================================================================
   Comandos pelo WhatsApp: código para verificar o número do dono (ou de alguém da equipe)
   ========================================================================================= */
create or replace function public.owner_link_code()
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_company(); v_code text; exp timestamptz := now() + interval '15 minutes'; num text;
begin
  if cid is null then raise exception 'Sessão expirada. Entre de novo.' using errcode = '42501'; end if;
  delete from public.owner_link_codes where user_id = auth.uid() or expires_at < now() - interval '1 day';
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.owner_link_codes o where o.code = v_code);
  end loop;
  insert into public.owner_link_codes (code, company_id, user_id, expires_at) values (v_code, cid, auth.uid(), exp);
  select display_phone into num from public.whatsapp_accounts where company_id = cid;
  return jsonb_build_object('code', 'ATIVAR ' || v_code, 'number', num, 'expires_at', exp);
end $$;

-- Chamado pelo webhook do WhatsApp quando chega "ATIVAR 123456": liga o número de quem mandou à pessoa da equipe.
create or replace function public.claim_owner_code(p_company uuid, p_code text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; m record;
begin
  select * into o from public.owner_link_codes where code = p_code and company_id = p_company and used_at is null and expires_at > now() for update;
  if not found then return jsonb_build_object('ok', false); end if;
  update public.owner_link_codes set used_at = now() where code = p_code;
  -- o número passa a valer só para esta pessoa
  update public.members set phone = null, phone_verified_at = null where company_id = p_company and user_id <> o.user_id and phone = any (public.phone_variants(p_phone));
  update public.members set phone = public.normalize_phone(p_phone), phone_verified_at = now() where company_id = p_company and user_id = o.user_id returning * into m;
  insert into public.audit_log (company_id, actor_type, actor_name, actor_user_id, channel, action, summary)
  values (p_company, 'usuario', m.name, m.user_id, 'whatsapp', 'verificar_numero', format('Verificou o número %s para enviar comandos pelo WhatsApp', m.phone));
  return jsonb_build_object('ok', true, 'user_id', m.user_id, 'name', m.name, 'role', m.role);
end $$;

/* =========================================================================================
   Trava por conversa: só uma resposta da IA por vez (mensagens seguidas do cliente viram uma resposta)
   ========================================================================================= */
create or replace function public.try_lock_conversation(p_id uuid, p_seconds int default 120)
returns boolean language sql security definer set search_path = public as $$
  with upd as (
    update public.conversations set ai_lock_until = now() + make_interval(secs => p_seconds)
    where id = p_id and (ai_lock_until is null or ai_lock_until < now())
    returning 1)
  select exists (select 1 from upd)
$$;

create or replace function public.release_conversation(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.conversations set ai_lock_until = null where id = p_id
$$;

/* =========================================================================================
   Admin da plataforma
   ========================================================================================= */
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rows jsonb; mon text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
begin
  if not public.is_platform_admin() then raise exception 'Acesso restrito.' using errcode = '42501'; end if;
  with base as (
    select c.id, c.name, c.plan, c.billing_status, c.created_at,
      (select count(*) from public.members m where m.company_id = c.id and m.active) as members,
      coalesce((select u.ai_replies from public.usage_monthly u where u.company_id = c.id and u.month = mon), 0) as ai_replies_month,
      exists (select 1 from public.whatsapp_accounts w where w.company_id = c.id and w.status = 'conectado') as whatsapp,
      (select max(m.created_at) from public.messages m where m.company_id = c.id) as last_activity,
      case when c.billing_status in ('active', 'past_due') and not c.complimentary then
        round(case when c.billing_cycle = 'anual' then p.yearly / 12 else p.monthly end, 2) else 0 end as mrr
    from public.companies c join public.plans p on p.id = c.plan)
  select coalesce(jsonb_agg(to_jsonb(base) order by base.created_at desc), '[]'::jsonb) into rows from base;
  return jsonb_build_object(
    'companies', rows,
    'mrr', coalesce((select sum((r->>'mrr')::numeric) from jsonb_array_elements(rows) r), 0),
    'active', (select count(*) from public.companies where billing_status = 'active'),
    'trialing', (select count(*) from public.companies where billing_status = 'trialing' and trial_ends_at > now()),
    'canceled', (select count(*) from public.companies where billing_status in ('canceled', 'blocked')));
end $$;

/* =========================================================================================
   Manutenção periódica (chamada pelo agendador): expira orçamentos e confirmações pendentes
   ========================================================================================= */
create or replace function public.housekeeping()
returns jsonb language plpgsql security definer set search_path = public as $$
declare nq int; np int;
begin
  perform set_config('combinado.skip_audit', 'on', true);
  update public.quotes q set status = 'expirado'
  from public.companies c
  where c.id = q.company_id and q.status = 'enviado' and q.valid_until < (now() at time zone c.timezone)::date;
  get diagnostics nq = row_count;
  update public.pending_actions set status = 'expirada', resolved_at = now() where status = 'pendente' and expires_at < now();
  get diagnostics np = row_count;
  delete from public.owner_link_codes where expires_at < now() - interval '1 day';
  delete from public.webhook_events where received_at < now() - interval '30 days';
  return jsonb_build_object('quotes_expired', nq, 'pending_expired', np);
end $$;

/* =========================================================================================
   Permissões das funções
   ========================================================================================= */
revoke execute on all functions in schema public from public, anon;
-- painel (usuário logado)
grant execute on function public.my_company(), public.my_role(), public.has_role(text[]), public.is_platform_admin(), public.company_writable(uuid),
  public.onboard_company(text, text, text, text, boolean), public.save_quote(jsonb, jsonb), public.daily_stats(date, date), public.peak_hours(date, date),
  public.usage_current(), public.owner_link_code(), public.admin_overview(),
  public.fmt_brl(numeric), public.quote_no(int), public.first_name(text), public.normalize_phone(text), public.phone_variants(text), public.fmt_when(timestamptz, text)
  to authenticated;
-- página pública do orçamento (sem login)
grant execute on function public.public_quote(text), public.respond_quote(text, text, text) to anon, authenticated;
-- Edge Functions (chave de serviço): tudo, inclusive o que os gatilhos chamam
grant execute on all functions in schema public to service_role;
revoke execute on function public.audit(uuid, text, text, text, uuid, text, text, text, text, jsonb), public.notify(uuid, text, text, text, text, uuid),
  public.bump_usage(uuid, int, int, bigint, bigint), public.claim_owner_code(uuid, text, text), public.housekeeping(),
  public.try_lock_conversation(uuid, int), public.release_conversation(uuid) from authenticated;
grant execute on function public.audit(uuid, text, text, text, uuid, text, text, text, text, jsonb), public.notify(uuid, text, text, text, text, uuid),
  public.bump_usage(uuid, int, int, bigint, bigint), public.claim_owner_code(uuid, text, text), public.housekeeping() to service_role;
