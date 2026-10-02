-- ORBYTA — módulos de gestão: financeiro (contas a pagar e a receber), estoque e base de conhecimento da IA.

/* =========================================================================================
   Base de conhecimento: perguntas e respostas que o dono cadastra para a IA usar
   ========================================================================================= */
alter table public.ai_settings
  add column faq jsonb not null default '[]'::jsonb
    check (jsonb_typeof(faq) = 'array' and jsonb_array_length(faq) <= 80),
  add column web_search boolean not null default false; -- pesquisa na internet só para dúvidas gerais
grant update (faq, web_search) on public.ai_settings to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('atendimento', 'agendamento', 'orcamento', 'venda', 'sistema', 'tarefa', 'assinatura', 'estoque', 'financeiro'));

/* =========================================================================================
   Financeiro: contas a pagar e a receber
   ========================================================================================= */
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('pagar', 'receber')),
  description text not null check (length(trim(description)) between 1 and 200),
  category text not null default 'Outros' check (length(category) <= 60),
  amount numeric(12, 2) not null check (amount > 0),
  due_date date not null,
  paid_at timestamptz,
  method text check (method in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro')),
  contact_id uuid references public.contacts (id) on delete set null,
  counterpart text check (length(counterpart) <= 120), -- fornecedor ou quem paga, quando não é um cliente cadastrado
  recurrence text not null default 'nenhuma' check (recurrence in ('nenhuma', 'mensal')),
  notes text check (length(notes) <= 1000),
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index finance_company_due_idx on public.finance_entries (company_id, due_date);
create trigger finance_updated before update on public.finance_entries for each row execute function public.tg_set_updated_at();

-- conta mensal paga: já deixa lançada a do mês seguinte
create or replace function public.tg_finance_recurrence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recurrence = 'mensal' and new.paid_at is not null and old.paid_at is null then
    insert into public.finance_entries (company_id, kind, description, category, amount, due_date, contact_id, counterpart, recurrence, notes, created_via)
    select new.company_id, new.kind, new.description, new.category, new.amount, (new.due_date + interval '1 month')::date, new.contact_id, new.counterpart, 'mensal', new.notes, 'automacao'
    where not exists (select 1 from public.finance_entries f where f.company_id = new.company_id and f.description = new.description
                        and f.kind = new.kind and f.due_date = (new.due_date + interval '1 month')::date);
  end if;
  return null;
end $$;
create trigger finance_recurrence after update of paid_at on public.finance_entries for each row execute function public.tg_finance_recurrence();

/* =========================================================================================
   Estoque: produtos e movimentações (entradas, saídas e ajustes)
   ========================================================================================= */
create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  sku text check (length(sku) <= 60),
  unit text not null default 'un' check (length(unit) between 1 and 12),
  category text not null default 'Geral' check (length(category) <= 60),
  stock numeric(12, 3) not null default 0,
  min_stock numeric(12, 3) not null default 0 check (min_stock >= 0),
  cost numeric(12, 2) check (cost >= 0),
  price numeric(12, 2) check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_company_sku_idx on public.products (company_id, lower(sku)) where sku is not null and sku <> '';
create index products_company_name_idx on public.products (company_id, lower(name));
create trigger products_updated before update on public.products for each row execute function public.tg_set_updated_at();

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  kind text not null check (kind in ('entrada', 'saida', 'ajuste')),
  qty numeric(12, 3) not null check (qty >= 0),
  balance_after numeric(12, 3),
  unit_cost numeric(12, 2) check (unit_cost >= 0),
  note text check (length(note) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_via text not null default 'painel' check (created_via in ('painel', 'ia_cliente', 'ia_dono', 'automacao', 'site', 'whatsapp')),
  created_at timestamptz not null default now(),
  check (kind = 'ajuste' or qty > 0)
);
create index stock_mov_product_idx on public.stock_movements (product_id, created_at desc);
create index stock_mov_company_idx on public.stock_movements (company_id, created_at desc);

-- cada movimentação atualiza o saldo do produto; saída maior que o saldo é recusada; avisa quando fica baixo
create or replace function public.tg_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.products; novo numeric;
begin
  select * into p from public.products where id = new.product_id for update;
  if p.id is null or p.company_id <> new.company_id then raise exception 'Produto não encontrado.' using errcode = '23503'; end if;
  novo := case new.kind when 'entrada' then p.stock + new.qty when 'saida' then p.stock - new.qty else new.qty end;
  if novo < 0 then
    raise exception 'Estoque insuficiente de %: há % %.', p.name, trim(to_char(p.stock, 'FM999999990.###')), p.unit using errcode = '23514';
  end if;
  new.balance_after := novo;
  update public.products set stock = novo where id = p.id;
  if novo <= p.min_stock and p.min_stock > 0 and p.stock > p.min_stock then
    perform public.notify(p.company_id, 'estoque', format('Estoque baixo: %s', p.name),
      format('Restam %s %s (mínimo: %s).', trim(to_char(novo, 'FM999999990.###')), p.unit, trim(to_char(p.min_stock, 'FM999999990.###'))), '#/estoque');
  end if;
  return new;
end $$;
create trigger stock_movement_apply before insert on public.stock_movements for each row execute function public.tg_stock_movement();

-- produto cadastrado já com saldo: vira um ajuste no histórico
create or replace function public.tg_product_initial_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock <> 0 then
    insert into public.stock_movements (company_id, product_id, kind, qty, note, created_via)
    values (new.company_id, new.id, 'ajuste', greatest(new.stock, 0), 'Saldo inicial', 'painel');
  end if;
  return null;
end $$;
create trigger product_initial_stock after insert on public.products for each row execute function public.tg_product_initial_stock();

/* Importação de planilha: cria ou atualiza produtos (pelo código ou pelo nome) e acerta o saldo informado. */
create or replace function public.import_products(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_company();
  r jsonb; v_name text; v_sku text; v_stock numeric; pid uuid; created int := 0; updated int := 0; skipped int := 0;
begin
  if cid is null or not public.has_role('dono', 'gerente') then raise exception 'Só o dono ou um gerente pode importar produtos.' using errcode = '42501'; end if;
  if not public.company_writable(cid) then raise exception 'A assinatura não permite alterações agora.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Envie até 2.000 linhas por vez.' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(trim(r->>'name'), '');
    v_sku := nullif(trim(r->>'sku'), '');
    if v_name is null or length(v_name) > 120 then skipped := skipped + 1; continue; end if;
    v_stock := case when (r->>'stock') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'stock')::numeric end;
    select id into pid from public.products
      where company_id = cid and ((v_sku is not null and lower(sku) = lower(v_sku)) or (v_sku is null and lower(name) = lower(v_name))) limit 1;
    if pid is null then
      insert into public.products (company_id, name, sku, unit, category, min_stock, cost, price, stock)
      values (cid, v_name, v_sku, coalesce(nullif(trim(r->>'unit'), ''), 'un'), coalesce(nullif(trim(r->>'category'), ''), 'Geral'),
              coalesce((r->>'min_stock')::numeric, 0), (r->>'cost')::numeric, (r->>'price')::numeric, greatest(coalesce(v_stock, 0), 0));
      created := created + 1;
    else
      update public.products set name = v_name,
        unit = coalesce(nullif(trim(r->>'unit'), ''), unit), category = coalesce(nullif(trim(r->>'category'), ''), category),
        min_stock = coalesce((r->>'min_stock')::numeric, min_stock), cost = coalesce((r->>'cost')::numeric, cost), price = coalesce((r->>'price')::numeric, price)
      where id = pid;
      if v_stock is not null then
        insert into public.stock_movements (company_id, product_id, kind, qty, note) values (cid, pid, 'ajuste', greatest(v_stock, 0), 'Importação de planilha');
      end if;
      updated := updated + 1;
    end if;
  end loop;
  perform public.audit(cid, 'importar_produtos', format('Importou uma planilha de produtos: %s novos, %s atualizados', created, updated), null, null);
  return jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped);
end $$;

/* =========================================================================================
   Acesso: financeiro só para dono e gerente; estoque visível para a equipe, cadastro por dono e gerente
   ========================================================================================= */
alter table public.finance_entries enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;

create policy finance_read on public.finance_entries for select to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente'));
create policy finance_insert on public.finance_entries for insert to authenticated
  with check (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id));
create policy finance_update on public.finance_entries for update to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy finance_delete on public.finance_entries for delete to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente'));

create policy products_read on public.products for select to authenticated using (company_id = public.my_company());
create policy products_insert on public.products for insert to authenticated
  with check (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id));
create policy products_update on public.products for update to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente') and public.company_writable(company_id)) with check (company_id = public.my_company());
create policy products_delete on public.products for delete to authenticated
  using (company_id = public.my_company() and public.has_role('dono', 'gerente'));
-- o saldo só muda por movimentação
revoke update on public.products from authenticated;
grant update (name, sku, unit, category, min_stock, cost, price, active) on public.products to authenticated;

create policy stock_mov_read on public.stock_movements for select to authenticated using (company_id = public.my_company());
create policy stock_mov_insert on public.stock_movements for insert to authenticated
  with check (company_id = public.my_company() and public.company_writable(company_id));
-- o histórico de movimentações não se altera: correções viram um ajuste
revoke update, delete on public.stock_movements from authenticated;

/* histórico de ações do painel */
create or replace function public.tg_audit_gestao() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); pname text;
begin
  if auth.uid() is null then return null; end if;
  case tg_table_name
    when 'finance_entries' then
      if tg_op = 'INSERT' then
        perform public.audit(r.company_id, 'lancar_conta', format('Lançou conta a %s: %s (%s, vence %s)', new.kind, new.description, public.fmt_brl(new.amount), to_char(new.due_date, 'DD/MM/YYYY')), 'finance', new.id);
      elsif tg_op = 'DELETE' then
        perform public.audit(r.company_id, 'excluir_conta', format('Excluiu a conta %s (%s)', old.description, public.fmt_brl(old.amount)), 'finance', old.id);
      elsif new.paid_at is not null and old.paid_at is null then
        perform public.audit(r.company_id, 'baixar_conta', format('Marcou como %s: %s (%s)', case when new.kind = 'pagar' then 'paga' else 'recebida' end, new.description, public.fmt_brl(new.amount)), 'finance', new.id);
      end if;
    when 'stock_movements' then
      select name into pname from public.products where id = new.product_id;
      perform public.audit(r.company_id, 'movimentar_estoque', format('%s de %s %s (saldo: %s)', initcap(new.kind), trim(to_char(new.qty, 'FM999999990.###')), coalesce(pname, 'produto'), trim(to_char(new.balance_after, 'FM999999990.###'))), 'product', new.product_id);
    when 'products' then
      if tg_op = 'INSERT' then perform public.audit(r.company_id, 'cadastrar_produto', format('Cadastrou o produto %s', new.name), 'product', new.id);
      elsif tg_op = 'DELETE' then perform public.audit(r.company_id, 'excluir_produto', format('Excluiu o produto %s', old.name), 'product', old.id);
      end if;
    else null;
  end case;
  return null;
end $$;
create trigger finance_audit after insert or update or delete on public.finance_entries for each row execute function public.tg_audit_gestao();
create trigger stock_mov_audit after insert on public.stock_movements for each row execute function public.tg_audit_gestao();
create trigger products_audit after insert or delete on public.products for each row execute function public.tg_audit_gestao();

/* tempo real */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.finance_entries, public.products, public.stock_movements;
  end if;
end $$;

/* visitante não acessa nada disso; funções novas só para quem está logado */
revoke all on public.finance_entries, public.products, public.stock_movements from anon;
revoke execute on function public.import_products(jsonb), public.tg_stock_movement(), public.tg_product_initial_stock(),
  public.tg_finance_recurrence(), public.tg_audit_gestao() from public, anon;
grant execute on function public.import_products(jsonb) to authenticated;
