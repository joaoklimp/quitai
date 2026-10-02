-- ORBYTA — recursos da plataforma Supabase: tempo real, arquivos do WhatsApp e agendamentos.
-- Cada bloco verifica se o recurso existe, para a migração também rodar num Postgres comum (testes).

/* ---------- tempo real: o painel atualiza sozinho quando chega mensagem, orçamento, etc. ---------- */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.messages, public.conversations, public.notifications, public.appointments, public.quotes,
      public.pending_actions, public.contacts, public.sales, public.tasks;
  end if;
end $$;

/* ---------- arquivos recebidos pelo WhatsApp (fotos, áudios, documentos): bucket privado por empresa ---------- */
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('whatsapp-media', 'whatsapp-media', false, 26214400)
    on conflict (id) do nothing;

    -- a equipe só lê os arquivos da própria empresa (pasta = id da empresa); quem grava são as Edge Functions
    execute $p$
      create policy "midia da propria empresa" on storage.objects for select to authenticated
      using (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = public.my_company()::text)
    $p$;
  end if;
end $$;

/* ---------- agendamentos (pg_cron + pg_net) ----------
   A cada 5 minutos: chama a Edge Function "cron" (lembretes, acompanhamentos, resumo do dia, tarefas).
   A cada 10 minutos: manutenção no próprio banco (expira orçamentos e confirmações pendentes).
   Antes, guarde no Vault o endereço do projeto e o segredo do agendador (veja DEPLOY.md):
     select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
     select vault.create_secret('UM-SEGREDO-LONGO', 'cron_secret');
   e configure o mesmo segredo nas funções: supabase secrets set CRON_SECRET=UM-SEGREDO-LONGO */
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;

    perform cron.unschedule(jobid) from cron.job where jobname in ('orbyta-automacoes', 'orbyta-manutencao');

    perform cron.schedule('orbyta-automacoes', '*/5 * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cron',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := jsonb_build_object('at', now()),
        timeout_milliseconds := 55000
      ) where exists (select 1 from vault.decrypted_secrets where name = 'project_url');
    $job$);

    perform cron.schedule('orbyta-manutencao', '*/10 * * * *', 'select public.housekeeping()');
  end if;
end $$;
