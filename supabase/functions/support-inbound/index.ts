// Recebe (via webhook do Resend) os e-mails que os clientes mandam para suporte@usequitai.com.br
// e coloca cada um na conversa certa do painel; o assistente do suporte cuida do resto.
import { admin } from '../_shared/common.ts';
import { protocol } from '../_shared/mail.ts';
import { handleIncoming, inBackground } from '../_shared/autoreply.ts';

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function bytesToB64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Confere a assinatura do webhook (padrão Svix usado pelo Resend). */
async function verify(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sigs = req.headers.get('svix-signature');
  if (!secret.startsWith('whsec_') || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', b64ToBytes(secret.slice(6)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = bytesToB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return sigs.split(' ').some((s) => s.split(',')[1] === mac);
}

/** Tira do texto a parte citada da mensagem anterior ("Em ... escreveu:", linhas com ">"). */
function stripQuoted(text: string): string {
  // o Gmail quebra "Em <data>, <nome> <e-mail> escreveu:" em várias linhas
  const cut = /\n\s*(Em|On) [^\n]*(\n[^\n]*){0,3}?(escreveu|wrote):/i.exec('\n' + text.replace(/\r/g, ''));
  if (cut) text = ('\n' + text.replace(/\r/g, '')).slice(0, cut.index);
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const l of lines) {
    if (/^(Em|On) .+(escreveu|wrote):\s*$/i.test(l.trim()) || /^-{2,}\s*(Mensagem original|Original Message)/i.test(l.trim())) break;
    if (l.startsWith('>')) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verify(req, body))) return new Response('invalid signature', { status: 401 });
  try {
    const event = JSON.parse(body);
    if (event.type !== 'email.received') return new Response('ignored');
    const emailId = event.data?.email_id ?? event.data?.id;
    if (!emailId) return new Response('no id');

    const { data: seen } = await admin.from('support_messages').select('id').eq('email_id', emailId).maybeSingle();
    if (seen) return new Response('duplicate');

    // ler e-mails recebidos exige uma chave com acesso total (a de envio é só "Sending access")
    const readKey = Deno.env.get('RESEND_INBOUND_KEY') ?? Deno.env.get('RESEND_API_KEY');
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: { Authorization: `Bearer ${readKey}` } });
    if (!res.ok) { console.error('não consegui ler o e-mail recebido', res.status); return new Response(`fetch failed ${res.status}`, { status: 500 }); }
    const mail = await res.json();
    const from = addressOf(String(mail.from ?? ''));
    const subject = String(mail.subject ?? '');
    const text = stripQuoted(String(mail.text ?? '').trim() || String(mail.html ?? '').replace(/<[^>]+>/g, ' ')).slice(0, 8000);
    if (!from || !text) return new Response('empty');
    // evita loop: e-mails do próprio domínio e respostas automáticas (férias, "fora do escritório") não acionam o assistente
    if (from.endsWith('@usequitai.com.br')) return new Response('own domain');
    const hdrs = JSON.stringify(mail.headers ?? {}).toLowerCase();
    const autoMail = /auto-submitted"?\s*[:,]\s*"?auto-|x-autoreply|x-autorespond|precedence"?\s*[:,]\s*"?(auto_reply|bulk|junk)/.test(hdrs)
      || /^(resposta autom[aá]tica|auto:|automatic reply|out of office|fora do escrit[oó]rio|ausente)/i.test(subject.trim());

    // acha o atendimento pelo protocolo no assunto; se não tiver, o mais recente desse e-mail
    let ticket: { id: string; name: string; email: string; topic: string } | null = null;
    const proto = /#([0-9a-f]{8})\b/i.exec(subject)?.[1]?.toLowerCase();
    if (proto) {
      const { data } = await admin.from('support_tickets').select('id,name,email,topic').eq('email', from).order('created_at', { ascending: false }).limit(50);
      ticket = (data ?? []).find((t) => protocol(t.id) === proto) ?? null;
    }
    if (!ticket) {
      const { data } = await admin.from('support_tickets').select('id,name,email,topic').eq('email', from).order('created_at', { ascending: false }).limit(1).maybeSingle();
      ticket = data ?? null;
    }
    if (!ticket && autoMail) return new Response('auto reply ignored');
    if (!ticket) {
      // e-mail novo de alguém sem atendimento: vira um atendimento novo (ignora reenvio do mesmo e-mail)
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { data: dup } = await admin.from('support_tickets').select('id').eq('email', from).eq('message', text).gte('created_at', since).limit(1).maybeSingle();
      if (dup) return new Response('duplicate');
      const { data, error } = await admin.from('support_tickets').insert({ name: from.split('@')[0], email: from, topic: 'outro', message: text }).select('id,name,email,topic').single();
      if (error) throw error;
      inBackground(handleIncoming(data.id, true));
      return new Response('created');
    }

    await admin.from('support_messages').insert({ ticket_id: ticket.id, direction: 'in', body: text, email_id: emailId });
    if (autoMail) return new Response('auto reply stored'); // guarda na conversa, mas não responde nem reabre
    await admin.from('support_tickets').update({ status: 'aberto' }).eq('id', ticket.id);
    inBackground(handleIncoming(ticket.id, false));
    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 });
  }
});
