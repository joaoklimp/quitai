// E-mails da assinatura do Quitaí enviados pelo próprio Quitaí (Resend), no lugar das notificações pagas do Asaas.
import { admin } from './common.ts';
import { escapeHtml, sendEmail } from './mail.ts';
import { GRACE_DAYS, planFromValue, PRICES } from './asaas.ts';

type Pay = { id: string; value: number; dueDate: string; billingType: string; invoiceUrl?: string; transactionReceiptUrl?: string | null; subscription?: string };

function brl(v: number) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function br(iso: string) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function plusDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function layout(title: string, paragraphs: string[], button?: { label: string; url: string }, foot?: string) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p}</p>`).join('');
  const btn = button ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#2B3FCB;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(button.label)}</a></p>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#121521">
  <div style="font-weight:bold;color:#2B3FCB;font-size:18px;margin-bottom:18px">Quitaí</div>
  <h2 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h2>${body}${btn}
  <p style="color:#676D82;font-size:13px;margin-top:28px;border-top:1px solid #E1E4EC;padding-top:12px">${foot ?? 'Dúvidas? Responda este e-mail ou use “Fale com o suporte” em usequitai.com.br.'}</p>
</div>`;
}

async function owner(companyId: string) {
  const { data } = await admin.from('members').select('email,name').eq('company_id', companyId).eq('role', 'owner').maybeSingle();
  return data;
}

/** Envia o e-mail certo para cada aviso de cobrança do Asaas. Não envia nada para contas cortesia. */
export async function billingMail(event: string, p: Pay, company: { id: string; complimentary?: boolean; data?: { name?: string } }) {
  if (company.complimentary) return;
  const o = await owner(company.id);
  if (!o?.email) return;
  const first = String(o.name || '').split(' ')[0] || 'tudo bem';
  const mapped = planFromValue(p.value, 'MONTHLY') ?? planFromValue(p.value, 'YEARLY');
  const plan = mapped ? `Plano ${PRICES[mapped.plan].name}` : 'Assinatura';
  const card = p.billingType === 'CREDIT_CARD';
  const url = p.invoiceUrl ?? 'https://usequitai.com.br/#assinatura';
  let subject = '', html = '';

  if (event === 'PAYMENT_CREATED' && !card) {
    subject = `Sua fatura do Quitaí: ${brl(p.value)}, vence em ${br(p.dueDate)}`;
    html = layout('Sua fatura está disponível', [
      `Olá, ${escapeHtml(first)}!`,
      `A fatura da sua assinatura do Quitaí (${escapeHtml(plan)}) já está disponível.`,
      `<strong>Valor:</strong> ${brl(p.value)}<br><strong>Vencimento:</strong> ${br(p.dueDate)}`,
      'Pague pelo QR Code Pix (confirma na hora) ou pelo boleto.',
    ], { label: 'Pagar com Pix ou boleto', url });
  } else if ((event === 'PAYMENT_RECEIVED' && !card) || (event === 'PAYMENT_CONFIRMED' && card)) {
    subject = `Pagamento confirmado: ${brl(p.value)}`;
    html = layout('Pagamento confirmado. Obrigado!', [
      `Olá, ${escapeHtml(first)}!`,
      `Recebemos o pagamento de <strong>${brl(p.value)}</strong> da sua assinatura do Quitaí (${escapeHtml(plan)}). Está tudo certo com o seu acesso.`,
    ], { label: 'Ver comprovante', url: p.transactionReceiptUrl || url });
  } else if (event === 'PAYMENT_OVERDUE') {
    const limit = plusDays(p.dueDate, GRACE_DAYS);
    subject = `Fatura do Quitaí vencida: pague até ${br(limit)} para não perder o acesso`;
    html = layout('Sua fatura venceu', [
      `Olá, ${escapeHtml(first)}!`,
      `Não identificamos o pagamento de <strong>${brl(p.value)}</strong>, que venceu em ${br(p.dueDate)}.`,
      `Para continuar usando o Quitaí sem interrupção, pague até <strong>${br(limit)}</strong>. Depois dessa data, o painel fica em modo leitura até o pagamento (seus dados continuam guardados).`,
      card ? 'Se o cartão foi recusado, você pode pagar esta fatura por Pix ou boleto pelo botão abaixo.' : 'Se você já pagou, desconsidere: o boleto pode levar até 3 dias úteis para compensar.',
    ], { label: 'Pagar agora', url });
  } else if (event === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED') {
    subject = 'O cartão da sua assinatura do Quitaí foi recusado';
    html = layout('Não conseguimos cobrar o cartão', [
      `Olá, ${escapeHtml(first)}!`,
      `A cobrança de <strong>${brl(p.value)}</strong> da sua assinatura do Quitaí foi recusada pelo cartão.`,
      'Você pode pagar esta fatura por Pix ou boleto, ou trocar a forma de pagamento em Assinatura no Quitaí.',
    ], { label: 'Pagar esta fatura', url });
  } else {
    return;
  }
  await sendEmail({ to: [o.email], subject, html });
}
