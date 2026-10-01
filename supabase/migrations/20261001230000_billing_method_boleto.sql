-- Forma de pagamento da assinatura também pode ser boleto (Asaas)
alter table public.companies drop constraint if exists companies_billing_method_check;
alter table public.companies add constraint companies_billing_method_check check (billing_method in ('cartao', 'pix', 'boleto'));
