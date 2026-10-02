// Webhook do WhatsApp (Meta Cloud API). Configure no app da Meta:
//   URL: https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook   ·   token de verificação: META_VERIFY_TOKEN
// Recebe mensagens e status de entrega. Responde 200 na hora e processa em segundo plano.
// - Número verificado da equipe → comandos (cadastra, orça, agenda, confirma com botões).
// - Qualquer outro número → atendimento ao cliente pela IA (uma resposta para várias mensagens seguidas).
import { db } from '../_shared/db.ts';
import { loadBase } from '../_shared/context.ts';
import { AUDIO_REPLY, countUsage, customerGate, customerTurn, ownerTurn, resolvePending, yesNo, type Member } from '../_shared/agent.ts';
import { findOrCreateContact, findOrCreateConversation, insertMessage } from '../_shared/conversation.ts';
import { downloadMedia, loadAccount, markRead, sendButtons, sendText, verifySignature, WaError, type WaAccount } from '../_shared/whatsapp.ts';
import { firstName, phoneVariants } from '../_shared/format.ts';
import type { ActionReceipt, MediaInfo } from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE_MS = Number(Deno.env.get('WA_DEBOUNCE_MS') ?? 2500);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    // verificação do webhook pela Meta
    const okToken = url.searchParams.get('hub.verify_token') === (Deno.env.get('META_VERIFY_TOKEN') ?? '') && !!Deno.env.get('META_VERIFY_TOKEN');
    if (url.searchParams.get('hub.mode') === 'subscribe' && okToken) return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256'), Deno.env.get('META_APP_SECRET') ?? ''))) {
    return new Response('invalid signature', { status: 401 });
  }
  let payload: WebhookPayload;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response('bad json', { status: 400 }); }

  const work = handle(payload).catch((e) => console.error('webhook', e));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
  return new Response('ok', { status: 200 });
});

/* ---------- tipos do payload da Meta (só o que usamos) ---------- */
interface WaMedia { id: string; mime_type?: string; caption?: string; filename?: string }
interface WaMessage {
  id: string; from: string; timestamp: string; type: string;
  text?: { body: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { text: string; payload?: string };
  image?: WaMedia; audio?: WaMedia; video?: WaMedia; document?: WaMedia; sticker?: WaMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
}
interface WaStatus { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; recipient_id: string; errors?: { code: number; title?: string }[] }
interface WebhookPayload {
  entry?: { changes?: { field: string; value: { metadata?: { phone_number_id: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[]; statuses?: WaStatus[] } }[] }[];
}

async function handle(p: WebhookPayload) {
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const v = change.value;
      const { data: link } = await db.from('whatsapp_accounts').select('company_id').eq('phone_number_id', v.metadata?.phone_number_id ?? '').maybeSingle();
      if (!link) continue;
      for (const st of v.statuses ?? []) await onStatus(link.company_id, st);
      if (!v.messages?.length) continue;
      const acc = await loadAccount(link.company_id);
      if (!acc) continue;
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      await Promise.all(v.messages.map((m) => onMessage(acc, m, names.get(m.from) ?? null).catch((e) => console.error('mensagem', m.id, e))));
    }
  }
}

/* ---------- status de entrega (enviada → entregue → lida; falha) ---------- */
const NEXT: Record<string, { to: string; from: string }> = {
  delivered: { to: 'entregue', from: 'wa_status.is.null,wa_status.eq.enviada' },
  read: { to: 'lida', from: 'wa_status.is.null,wa_status.in.(enviada,entregue)' },
  failed: { to: 'falhou', from: 'wa_status.is.null,wa_status.in.(enviada,entregue)' },
};
async function onStatus(companyId: string, st: WaStatus) {
  const step = NEXT[st.status];
  if (!step) return;
  const { data } = await db.from('messages').update({ wa_status: step.to }).eq('company_id', companyId).eq('wa_message_id', st.id).or(step.from).select('conversation_id').maybeSingle();
  if (st.status === 'failed' && data) {
    const code = st.errors?.[0]?.code;
    const reason = code === 131047 ? 'Mensagem não entregue: passou a janela de 24 horas' : 'Uma mensagem não foi entregue ao cliente';
    await db.from('conversations').update({ needs_attention: true, attention_reason: reason }).eq('id', data.conversation_id).eq('kind', 'cliente');
  }
}

/* ---------- mensagens recebidas ---------- */
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };

async function storeMedia(acc: WaAccount, obj: WaMedia, type: MediaInfo['type']): Promise<MediaInfo> {
  const info: MediaInfo = { type, mime: obj.mime_type ?? null, caption: obj.caption ?? null, filename: obj.filename ?? null, path: null };
  try {
    const { bytes, mime } = await downloadMedia(acc, obj.id);
    if (bytes.length > 25 * 1024 * 1024) return info;
    const clean = mime.split(';')[0].trim();
    const path = `${acc.company_id}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${EXT[clean] ?? 'bin'}`;
    const { error } = await db.storage.from('whatsapp-media').upload(path, bytes, { contentType: clean, upsert: false });
    if (!error) { info.path = path; info.mime = clean; } else console.error('guardar mídia', error.message);
  } catch (e) { console.error('baixar mídia', (e as Error).message); }
  return info;
}

async function onMessage(acc: WaAccount, m: WaMessage, profileName: string | null) {
  const { data: dup } = await db.from('messages').select('id').eq('wa_message_id', m.id).maybeSingle();
  if (dup) return; // a Meta pode entregar o mesmo aviso mais de uma vez

  let body = '';
  let media: MediaInfo | null = null;
  let buttonId: string | null = null;
  switch (m.type) {
    case 'text': body = m.text?.body ?? ''; break;
    case 'interactive': buttonId = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null; body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''; break;
    case 'button': buttonId = m.button?.payload ?? null; body = m.button?.text ?? ''; break;
    case 'image': case 'audio': case 'video': case 'document': case 'sticker': {
      const obj = m[m.type as 'image'];
      if (obj) { media = await storeMedia(acc, obj, m.type as MediaInfo['type']); body = obj.caption ?? ''; }
      break;
    }
    case 'location': media = { type: 'location', caption: [m.location?.name, m.location?.address, m.location ? `${m.location.latitude},${m.location.longitude}` : ''].filter(Boolean).join(' · ') }; break;
    case 'reaction': return;
    default: body = '[tipo de mensagem não suportado]';
  }

  // "ATIVAR 123456": liga o número de quem mandou à pessoa da equipe que gerou o código no painel
  const code = body.match(/^\s*ativar\s+(\d{6})\s*$/i);
  if (code) {
    const { data: r } = await db.rpc('claim_owner_code', { p_company: acc.company_id, p_code: code[1], p_phone: m.from });
    if (r?.ok) {
      await sendText(acc, m.from, `Pronto, ${firstName(r.name)}! ✅ Seu número está verificado.\n\nAgora é só me mandar pedidos por aqui, do jeito que você fala. Por exemplo:\n• "Cadastra a Maria, telefone 61 99999-9999, e cria um orçamento de R$ 350 para ela"\n• "O que tenho na agenda amanhã?"\n• "Quanto vendi este mês?"`);
      return;
    }
  }

  const { data: member } = await db.from('members').select('user_id, name, role').eq('company_id', acc.company_id).eq('active', true).not('phone_verified_at', 'is', null).in('phone', phoneVariants(m.from)).limit(1).maybeSingle();
  if (member) return onOwnerMessage(acc, m, { userId: member.user_id, name: member.name, role: member.role }, body, media, buttonId);
  return onCustomerMessage(acc, m, profileName, body, media);
}

/* ---------- cliente ---------- */
async function onCustomerMessage(acc: WaAccount, m: WaMessage, profileName: string | null, body: string, media: MediaInfo | null) {
  const { contact } = await findOrCreateContact(acc.company_id, m.from, profileName);
  const conv = await findOrCreateConversation({ companyId: acc.company_id, kind: 'cliente', channel: 'whatsapp', contactId: contact.id });
  let msg;
  try {
    msg = await insertMessage({ company_id: acc.company_id, conversation_id: conv.id, direction: 'in', sender: 'contato', sender_name: contact.name, body, media, wa_message_id: m.id, channel: 'whatsapp' });
  } catch (e) {
    if (/duplicate|23505/.test((e as Error).message)) return;
    throw e;
  }
  // pedido para não receber mais mensagens automáticas (LGPD e regras do WhatsApp)
  if (/^\s*(parar|sair|stop|descadastrar|nao quero mais mensagens)\s*$/i.test(body.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    await db.from('contacts').update({ opt_in: false }).eq('id', contact.id);
    const text = 'Pronto, você não vai mais receber lembretes nem mensagens automáticas nossas. Se precisar de algo, é só escrever aqui. 🙂';
    const waId = await sendText(acc, m.from, text).catch(() => '');
    await insertMessage({ company_id: acc.company_id, conversation_id: conv.id, direction: 'out', sender: 'ia', sender_name: 'Combinado', body: text, wa_message_id: waId || null, wa_status: waId ? 'enviada' : 'falhou', channel: 'whatsapp' });
    return;
  }
  await answerCustomer(acc, conv.id, msg.id, m.id);
}

/** Espera o cliente terminar de digitar, garante uma resposta por vez e responde o que estiver pendente. */
async function answerCustomer(acc: WaAccount, convId: string, msgId: string, waMessageId: string) {
  await sleep(DEBOUNCE_MS);
  const { data: latest } = await db.from('messages').select('id').eq('conversation_id', convId).eq('direction', 'in').order('created_at', { ascending: false }).limit(1);
  if (latest?.[0]?.id !== msgId) return; // chegou outra mensagem: quem responde é a vez dela
  const { data: locked } = await db.rpc('try_lock_conversation', { p_id: convId, p_seconds: 150 });
  if (!locked) return; // já há uma resposta em andamento; ela confere as mensagens novas no final
  try {
    for (let round = 0; round < 3; round++) {
      const { data: conv } = await db.from('conversations').select('*').eq('id', convId).single();
      if (!conv || conv.handler === 'humano') return;
      const b = await loadBase(acc.company_id);
      const gate = await customerGate(b);
      if (gate) {
        if (/limite/.test(gate) && !conv.needs_attention) await db.from('conversations').update({ needs_attention: true, attention_reason: 'Limite de respostas da IA do plano atingido' }).eq('id', convId);
        return;
      }
      const { data: contact } = await db.from('contacts').select('*').eq('id', conv.contact_id).single();
      if (!contact?.phone) return;
      await markRead(acc, waMessageId, true);
      const startedAt = new Date().toISOString();
      const r = await customerTurn(b, conv, contact, 'whatsapp');
      if (r.usage.input) await countUsage(b, r.usage);
      if (r.reply) {
        let waId = '';
        let failed = false;
        try { waId = await sendText(acc, contact.phone, r.reply); } catch (e) {
          failed = true;
          console.error('enviar resposta', e instanceof WaError ? e.message : e);
          await db.from('conversations').update({ needs_attention: true, attention_reason: e instanceof WaError ? e.friendly : 'A resposta da IA não foi enviada' }).eq('id', convId);
        }
        await insertMessage({ company_id: acc.company_id, conversation_id: convId, direction: 'out', sender: 'ia', sender_name: b.ai.assistant_name || 'IA', body: r.reply, actions: r.actions.length ? r.actions : null, wa_message_id: waId || null, wa_status: failed ? 'falhou' : 'enviada', channel: 'whatsapp' });
        if (!failed) await db.rpc('bump_usage', { p_company: acc.company_id, p_wa: 1 });
      }
      // o cliente mandou mais alguma coisa enquanto a IA respondia? responde de novo
      const { data: newer } = await db.from('messages').select('id, wa_message_id').eq('conversation_id', convId).eq('direction', 'in').gt('created_at', startedAt).order('created_at', { ascending: false }).limit(1);
      if (!newer?.length) break;
      waMessageId = newer[0].wa_message_id ?? waMessageId;
      await sleep(1200);
    }
  } finally {
    await db.rpc('release_conversation', { p_id: convId });
  }
}

/* ---------- equipe (número verificado) ---------- */
async function onOwnerMessage(acc: WaAccount, m: WaMessage, member: Member, body: string, media: MediaInfo | null, buttonId: string | null) {
  const conv = await findOrCreateConversation({ companyId: acc.company_id, kind: 'dono', channel: 'painel', memberUserId: member.userId });
  await insertMessage({ company_id: acc.company_id, conversation_id: conv.id, direction: 'in', sender: 'dono', sender_name: member.name, body, media, wa_message_id: m.id, channel: 'whatsapp' });
  await markRead(acc, m.id, true);
  const b = await loadBase(acc.company_id);

  // botão "Confirmar"/"Cancelar" ou um "sim"/"não" para a única confirmação aberta
  let decision: { id: string; approve: boolean } | null = null;
  if (buttonId && /^(ok|no):/.test(buttonId)) decision = { id: buttonId.slice(3), approve: buttonId.startsWith('ok:') };
  else {
    const yn = yesNo(body);
    if (yn !== null) {
      const { data: open } = await db.from('pending_actions').select('id').eq('conversation_id', conv.id).eq('status', 'pendente').gt('expires_at', new Date().toISOString());
      if (open?.length === 1) decision = { id: open[0].id, approve: yn };
    }
  }
  if (decision) {
    const r = await resolvePending(b, decision.id, decision.approve, member, 'whatsapp');
    return replyOwner(acc, m.from, conv.id, r.reply, r.actions);
  }
  if (media?.type === 'audio' && !body.trim()) return replyOwner(acc, m.from, conv.id, AUDIO_REPLY, []);

  const r = await ownerTurn(b, conv, member, 'whatsapp');
  if (r.usage.input) await countUsage(b, r.usage);
  await replyOwner(acc, m.from, conv.id, r.reply, r.actions);
}

/** Resposta para a equipe: texto + lista do que foi feito; se houver algo para confirmar, vai com botões. */
async function replyOwner(acc: WaAccount, to: string, convId: string, text: string, actions: ActionReceipt[]) {
  const pending = actions.find((a) => a.status === 'aguardando' && a.pending_id);
  const done = actions.filter((a) => a.status === 'ok');
  const lines = done.map((a) => `✓ ${a.label}`);
  if (done.length) lines.push('✓ Painel atualizado');
  const full = [text, lines.join('\n')].filter(Boolean).join('\n\n');
  let waId = '';
  try {
    waId = pending
      ? await sendButtons(acc, to, full, [{ id: `ok:${pending.pending_id}`, title: 'Confirmar' }, { id: `no:${pending.pending_id}`, title: 'Cancelar' }])
      : await sendText(acc, to, full);
  } catch (e) { console.error('responder equipe', e); }
  await insertMessage({ company_id: acc.company_id, conversation_id: convId, direction: 'out', sender: 'ia', sender_name: 'Combinado', body: text, actions: actions.length ? actions : null, wa_message_id: waId || null, wa_status: waId ? 'enviada' : 'falhou', channel: 'whatsapp' });
  if (waId) await db.rpc('bump_usage', { p_company: acc.company_id, p_wa: 1 });
}
