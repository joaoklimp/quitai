// Formulário "Fale com o suporte": guarda a mensagem e avisa o dono do Quitaí por e-mail.
// Funciona com ou sem login. Responder o e-mail de aviso responde direto ao cliente.
import { admin, caller, cors, json } from '../_shared/common.ts';

const TOPICS: Record<string, string> = {
  pagamento: 'Pagamento ou assinatura',
  acesso: 'Login ou senha',
  duvida: 'Dúvida sobre o uso',
  problema: 'Algo não funciona',
  outro: 'Outro assunto',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.website) return json(req, { ok: true }); // armadilha para robôs
    const me = await caller(req);
    const name = String(body.name ?? me?.name ?? '').trim().slice(0, 80);
    const email = String(me?.email ?? body.email ?? '').trim().toLowerCase().slice(0, 160);
    const topic = TOPICS[String(body.topic)] ? String(body.topic) : 'outro';
    const message = String(body.message ?? '').trim().slice(0, 4000);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 10) return json(req, { error: 'invalid' }, 400);

    // no máximo 5 mensagens por hora por e-mail
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since);
    if ((count ?? 0) >= 5) return json(req, { error: 'rate_limited' }, 429);

    let companyName = '';
    let plan = '';
    if (me) {
      const { data: c } = await admin.from('companies').select('data,plan,billing_status').eq('id', me.company_id).maybeSingle();
      companyName = (c?.data?.name as string) ?? '';
      plan = c ? `${c.plan} · ${c.billing_status}` : '';
    }
    const { data: ticket, error } = await admin.from('support_tickets')
      .insert({ company_id: me?.company_id ?? null, user_id: me?.user_id ?? null, name, email, topic, message })
      .select('id').single();
    if (error) throw error;

    const key = Deno.env.get('RESEND_API_KEY');
    const inbox = Deno.env.get('SUPPORT_INBOX');
    if (key && inbox) {
      const rows = [
        ['Assunto', TOPICS[topic]], ['Nome', name], ['E-mail', email],
        ['Empresa', companyName || '(sem login)'], ['Plano', plan || '-'], ['Protocolo', ticket.id.slice(0, 8)],
      ].map(([k, v]) => `<tr><td style="color:#676D82;padding:2px 12px 2px 0">${k}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join('');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Suporte Quitaí <suporte@usequitai.com.br>',
          to: [inbox],
          reply_to: email,
          subject: `[Suporte Quitaí] ${TOPICS[topic]} · ${name}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px"><table>${rows}</table><hr><p style="white-space:pre-wrap">${escapeHtml(message)}</p><p style="color:#676D82;font-size:13px">Responda este e-mail para falar direto com o cliente.</p></div>`,
        }),
      });
      if (!res.ok) console.error('envio do aviso de suporte falhou', res.status, await res.text());
    }
    return json(req, { ok: true, protocol: ticket.id.slice(0, 8) });
  } catch (e) {
    console.error(e);
    return json(req, { error: 'server_error' }, 500);
  }
});
