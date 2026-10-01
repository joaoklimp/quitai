// Formulário "Fale com o suporte": guarda a mensagem e passa para o assistente do suporte.
// Funciona com ou sem login.
import { admin, caller, cors, json } from '../_shared/common.ts';
import { protocol, TOPICS } from '../_shared/mail.ts';
import { handleIncoming, inBackground } from '../_shared/autoreply.ts';

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

    const { data: ticket, error } = await admin.from('support_tickets')
      .insert({ company_id: me?.company_id ?? null, user_id: me?.user_id ?? null, name, email, topic, message })
      .select('id').single();
    if (error) throw error;
    const proto = protocol(ticket.id);

    // o assistente responde ou encaminha em segundo plano (ou só confirma, se estiver desligado)
    inBackground(handleIncoming(ticket.id, true));
    return json(req, { ok: true, protocol: proto });
  } catch (e) {
    console.error(e);
    return json(req, { error: 'server_error' }, 500);
  }
});
