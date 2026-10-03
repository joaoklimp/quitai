// Pacientes, conversas e mensagens: encontrar ou criar, montar o histórico para a IA e entregar
// mensagens pelo WhatsApp respeitando a janela de 24 horas (fora dela, só modelo aprovado).
import { db, check, audit } from './db.ts';
import { firstName, fmtDate, formatPhone, localTime, normalizePhone, phoneVariants, brl } from './format.ts';
import type { Msg } from './ai.ts';
import type { ActionReceipt, Contact, Conversation, MediaInfo, Message } from './types.ts';
import { loadAccount, sendTemplate, sendText, WaError, withinWindow } from './whatsapp.ts';
import { quoteLink, quoteNo, type Base } from './context.ts';
import { TEMPLATES } from './templates.ts';

const UNIQUE = '23505';

export async function findOrCreateContact(companyId: string, phone: string, waName?: string | null): Promise<{ contact: Contact; created: boolean }> {
  const find = async () => {
    const { data } = await db.from('contacts').select('*').eq('company_id', companyId).in('phone', phoneVariants(phone)).limit(1);
    return (data?.[0] as Contact | undefined) ?? null;
  };
  const found = await find();
  if (found) {
    if (waName && !found.wa_name) await db.from('contacts').update({ wa_name: waName }).eq('id', found.id);
    return { contact: found, created: false };
  }
  const { data, error } = await db.from('contacts').insert({
    company_id: companyId, name: (waName?.trim() || formatPhone(phone)).slice(0, 120), phone: normalizePhone(phone), wa_name: waName ?? null,
    source: 'whatsapp', created_via: 'whatsapp', stage: 'novo', temperature: 'morno',
  }).select('*').single();
  if (error?.code === UNIQUE) return { contact: (await find())!, created: false }; // chegou junto com outra mensagem
  return { contact: check({ data, error }, 'novo cliente') as Contact, created: true };
}

export async function findOrCreateConversation(o: { companyId: string; kind: 'cliente' | 'dono'; channel: 'whatsapp' | 'painel' | 'simulador'; contactId?: string; memberUserId?: string }): Promise<Conversation> {
  const find = async () => {
    let q = db.from('conversations').select('*').eq('company_id', o.companyId).eq('kind', o.kind).eq('channel', o.channel);
    q = o.kind === 'cliente' ? q.eq('contact_id', o.contactId!) : q.eq('member_user_id', o.memberUserId!);
    const { data } = await q.limit(1);
    return (data?.[0] as Conversation | undefined) ?? null;
  };
  const found = await find();
  if (found) return found;
  const { data, error } = await db.from('conversations').insert({
    company_id: o.companyId, kind: o.kind, channel: o.channel, contact_id: o.contactId ?? null, member_user_id: o.memberUserId ?? null,
  }).select('*').single();
  if (error?.code === UNIQUE) return (await find())!;
  return check({ data, error }, 'nova conversa') as Conversation;
}

export async function insertMessage(row: Partial<Message> & Pick<Message, 'company_id' | 'conversation_id' | 'direction' | 'sender' | 'body'> & { wa_message_id?: string | null }): Promise<Message> {
  const { data, error } = await db.from('messages').insert(row).select('*').single();
  return check({ data, error }, 'mensagem') as Message;
}

function mediaText(m: MediaInfo, who: string): string {
  const cap = m.caption ? `: "${m.caption}"` : '';
  switch (m.type) {
    case 'image': return `[${who} mandou uma foto${cap}]`;
    case 'audio': return m.transcript ? `[${who} mandou um áudio; o texto abaixo é a transcrição automática, pode ter pequenos erros]` : `[${who} mandou um áudio, que você não consegue ouvir]`;
    case 'video': return `[${who} mandou um vídeo${cap}]`;
    case 'document': return `[${who} mandou um documento${m.filename ? ` (${m.filename})` : ''}${cap}]`;
    case 'sticker': return `[${who} mandou uma figurinha]`;
    case 'location': return `[${who} mandou uma localização${cap}]`;
    default: return `[${who} mandou um arquivo]`;
  }
}

function receiptsText(actions: ActionReceipt[] | null): string {
  if (!actions?.length) return '';
  return `\n[ações: ${actions.map((a) => `${a.label}${a.detail ? ` (${a.detail})` : ''} — ${a.status}`).join('; ')}]`;
}

/**
 * Histórico da conversa no formato da API: mensagens do paciente (ou da pessoa da equipe, no modo dono)
 * como "user" e as respostas como "assistant". Mensagens seguidas do mesmo lado viram um turno só.
 * A foto mais recente ainda sem resposta vai como imagem, para a IA poder olhar.
 */
export async function buildHistory(conversationId: string, mode: 'cliente' | 'dono', tz: string, limit = 40): Promise<{ history: Msg[]; unanswered: Message[] }> {
  const { data } = await db.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit);
  const msgs = ((data ?? []) as Message[]).reverse().filter((m) => m.sender !== 'sistema');
  const lastOut = msgs.map((m) => m.direction).lastIndexOf('out');
  const unanswered = msgs.slice(lastOut + 1).filter((m) => m.direction === 'in');
  const now = Date.now();
  const who = mode === 'cliente' ? 'o cliente' : 'você';

  const turns: { role: 'user' | 'assistant'; parts: Exclude<Msg['content'], string> }[] = [];
  const push = (role: 'user' | 'assistant', part: Exclude<Msg['content'], string>[number]) => {
    const last = turns[turns.length - 1];
    if (last?.role === role) last.parts.push(part); else turns.push({ role, parts: [part] });
  };
  const newestImage = [...unanswered].reverse().find((m) => m.media?.type === 'image' && m.media.path);

  for (const m of msgs) {
    if (m.direction === 'in') {
      const old = now - Date.parse(m.created_at) > 12 * 3600_000 ? `(mensagem de ${fmtDate(m.created_at, tz)} às ${localTime(m.created_at, tz)}) ` : '';
      const text = [m.media ? mediaText(m.media, who) : '', m.body && !(m.media && m.body.startsWith('[')) ? m.body : ''].filter(Boolean).join(' ');
      if (m === newestImage) {
        const img = await loadImage(m.media!.path!);
        if (img) push('user', { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } });
      }
      push('user', { type: 'text', text: `${old}${text || '(mensagem vazia)'}` });
    } else {
      const prefix = m.sender === 'equipe' ? `[mensagem enviada pela equipe${m.sender_name ? ` (${m.sender_name})` : ''}] ` : '';
      push('assistant', { type: 'text', text: `${prefix}${m.body}${receiptsText(m.actions)}` || '(sem texto)' });
    }
  }
  // conversa iniciada pela empresa (lembrete, orçamento, aviso): a API pede que o primeiro turno seja do usuário
  if (turns.length && turns[0].role !== 'user') turns.unshift({ role: 'user', parts: [{ type: 'text', text: mode === 'cliente' ? '(A conversa começou com a mensagem da empresa abaixo.)' : '(Início da conversa.)' }] });
  return { history: turns.map((t) => ({ role: t.role, content: t.parts })) as Msg[], unanswered };
}

async function loadImage(path: string): Promise<{ b64: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } | null> {
  try {
    const { data, error } = await db.storage.from('whatsapp-media').download(path);
    if (error || !data) return null;
    const mime = (data.type || 'image/jpeg') as 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) || data.size > 4_500_000) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), mime };
  } catch { return null; }
}

/** Manda uma mensagem para o paciente pelo WhatsApp e registra na conversa. Fora das 24h, só com modelo. */
export async function deliverToContact(b: Base, contact: Contact, text: string, o: {
  sender: 'ia' | 'equipe'; senderName: string; template?: { name: string; params: string[] } | null; actions?: ActionReceipt[] | null;
}): Promise<{ sent: boolean; reason?: string; message?: Message }> {
  if (!contact.phone) return { sent: false, reason: 'O paciente não tem telefone cadastrado.' };
  const acc = await loadAccount(b.company.id);
  if (!acc) return { sent: false, reason: 'O WhatsApp da empresa não está conectado.' };
  const conv = await findOrCreateConversation({ companyId: b.company.id, kind: 'cliente', channel: 'whatsapp', contactId: contact.id });
  let waId = '';
  try {
    if (withinWindow(conv.last_inbound_at)) waId = await sendText(acc, contact.phone, text);
    else if (o.template && contact.opt_in) waId = await sendTemplate(acc, contact.phone, o.template.name, o.template.params);
    else return { sent: false, reason: o.template && !contact.opt_in ? 'O paciente pediu para não receber mensagens.' : 'Já passaram 24 horas desde a última mensagem do paciente: o WhatsApp só permite escrever com um modelo aprovado.' };
  } catch (e) {
    if (e instanceof WaError) return { sent: false, reason: e.friendly };
    throw e;
  }
  const message = await insertMessage({
    company_id: b.company.id, conversation_id: conv.id, direction: 'out', sender: o.sender, sender_name: o.senderName, body: text,
    wa_message_id: waId || null, wa_status: 'enviada', channel: 'whatsapp', actions: o.actions ?? null,
  });
  await db.rpc('bump_usage', { p_company: b.company.id, p_wa: 1 });
  return { sent: true, message };
}

/** Envia o link do orçamento ao paciente (texto na janela de 24h; fora dela, o modelo "orcamento_enviado"). */
export async function sendQuote(b: Base, quoteId: string, actor: { type: 'usuario' | 'ia'; name: string; userId?: string | null; channel: string }): Promise<{ sent: boolean; link: string; reason?: string }> {
  const { data: q } = await db.from('quotes').select('*').eq('id', quoteId).eq('company_id', b.company.id).maybeSingle();
  if (!q) throw new Error('Orçamento não encontrado.');
  const { data: contact } = await db.from('contacts').select('*').eq('id', q.contact_id).single();
  const link = quoteLink(b, q);
  const first = firstName(contact?.name) || 'tudo bem';
  const text = `Olá, ${first}! Segue o seu orçamento nº ${quoteNo(q.number)} no valor de ${brl(q.total)}: ${link}\nÉ só abrir o link para conferir e aprovar.`;
  const r = contact ? await deliverToContact(b, contact as Contact, text, { sender: actor.type === 'ia' ? 'ia' : 'equipe', senderName: actor.name, template: { name: TEMPLATES.orcamento.name, params: [first, quoteNo(q.number), brl(q.total), link] } }) : { sent: false, reason: 'Cliente não encontrado.' };
  if (r.sent) {
    await db.from('quotes').update({ status: q.status === 'rascunho' ? 'enviado' : q.status, sent_at: new Date().toISOString() }).eq('id', q.id);
    await audit({ company_id: b.company.id, actor_type: actor.type, actor_name: actor.name, actor_user_id: actor.userId ?? null, channel: actor.channel, action: 'enviar_orcamento', summary: `Enviou o orçamento nº ${quoteNo(q.number)} (${brl(q.total)}) para ${contact?.name ?? 'cliente'} pelo WhatsApp`, target_type: 'quote', target_id: q.id });
  }
  return { sent: r.sent, link, reason: r.reason };
}
