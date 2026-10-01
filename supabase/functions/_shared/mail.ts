// Envio de e-mails do suporte pelo Resend (remetente suporte@usequitai.com.br).
export const SUPPORT_FROM = 'Suporte Quitaí <suporte@usequitai.com.br>';

export const TOPICS: Record<string, string> = {
  pagamento: 'Pagamento ou assinatura',
  acesso: 'Login ou senha',
  duvida: 'Dúvida sobre o uso',
  problema: 'Algo não funciona',
  outro: 'Outro assunto',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Código curto do atendimento, usado no assunto para ligar as respostas do cliente ao atendimento. */
export function protocol(ticketId: string): string {
  return ticketId.slice(0, 8);
}
export function ticketSubject(ticketId: string, topic: string): string {
  return `[Quitaí #${protocol(ticketId)}] ${TOPICS[topic] ?? 'Suporte'}`;
}

/** Corpo em HTML simples a partir de texto, com a marca do Quitaí. */
export function brandedHtml(text: string, footer: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#121521">
  <div style="font-weight:bold;color:#2B3FCB;font-size:18px;margin-bottom:16px">Quitaí</div>
  <div style="white-space:pre-wrap;line-height:1.5">${escapeHtml(text)}</div>
  <p style="color:#676D82;font-size:13px;margin-top:28px;border-top:1px solid #E1E4EC;padding-top:12px">${footer}</p>
</div>`;
}

export async function sendEmail(msg: { to: string[]; subject: string; html: string; text?: string; reply_to?: string; headers?: Record<string, string> }): Promise<{ ok: boolean; id?: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: SUPPORT_FROM, ...msg }),
  });
  if (!res.ok) {
    console.error('envio de e-mail falhou', res.status, await res.text());
    return { ok: false };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, id: data.id };
}

/** Aviso para o dono do Quitaí (caixa definida em SUPPORT_INBOX). */
export async function notifyOwner(subject: string, rows: [string, string][], message: string, replyTo?: string) {
  const inbox = Deno.env.get('SUPPORT_INBOX');
  if (!inbox) return;
  const table = rows.map(([k, v]) => `<tr><td style="color:#676D82;padding:2px 12px 2px 0">${k}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join('');
  await sendEmail({
    to: [inbox],
    subject,
    reply_to: replyTo,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px"><table>${table}</table><hr><p style="white-space:pre-wrap">${escapeHtml(message)}</p><p style="color:#676D82;font-size:13px">Responda pelo painel: usequitai.com.br → Administração → Suporte.</p></div>`,
  });
}
