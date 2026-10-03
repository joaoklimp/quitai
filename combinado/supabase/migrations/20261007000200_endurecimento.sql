-- Endurecimento apontado pelo verificador de segurança do Supabase:
-- 1) funções de gatilho (tg_*) e auxiliares internas não ficam expostas como RPC para o painel ou visitantes;
-- 2) search_path fixo nas funções que ainda não tinham;
-- 3) pg_net fora do schema public (as funções dela continuam no schema "net").

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'tg\_%' or p.proname in ('next_assignee'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;

  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fmt_brl', 'quote_no', 'first_name', 'normalize_phone', 'phone_variants', 'fmt_when',
                        'tg_set_updated_at', 'tg_contacts_before', 'tg_conversations_before', 'segment_presets')
  loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;

  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
