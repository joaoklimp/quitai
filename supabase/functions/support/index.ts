// Formulário "Fale com o suporte": guarda a mensagem, confirma o recebimento para o cliente
// e avisa o dono do Quitaí. Funciona com ou sem login.
import { admin, caller, cors, json } from '../_shared/common.ts';
import { brandedHtml, notifyOwner, protocol, sendEmail, ticketSubject, TOPICS } from '../_shared/mail.ts';

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
    const proto = protocol(ticket.id);

    // confirmação para o cliente; responder este e-mail continua a mesma conversa
    const first = name.split(' ')[0];
    await sendEmail({
      to: [email],
      subject: ticketSubject(ticket.id, topic),
      html: brandedHtml(
        `Olá, ${first}!\n\nRecebemos sua mensagem e já estamos olhando. Respondemos por aqui, normalmente no mesmo dia útil.\n\nSeu protocolo é #${proto}.\n\nSua mensagem:\n"${message}"`,
        'Para acrescentar algo, é só responder este e-mail.',
      ),
    });
    await notifyOwner(
      `[Suporte Quitaí] ${TOPICS[topic]} · ${name}`,
      [['Assunto', TOPICS[topic]], ['Nome', name], ['E-mail', email], ['Empresa', companyName || '(sem login)'], ['Plano', plan || '-'], ['Protocolo', `#${proto}`]],
      message,
    );
    return json(req, { ok: true, protocol: proto });
  } catch (e) {
    console.error(e);
    return json(req, { error: 'server_error' }, 500);
  }
});
