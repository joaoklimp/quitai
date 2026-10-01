-- Bloqueio por estorno, contestação ou decisão do administrador: a sincronização com o Asaas não devolve o acesso.
alter table public.companies add column if not exists access_revoked boolean not null default false;
