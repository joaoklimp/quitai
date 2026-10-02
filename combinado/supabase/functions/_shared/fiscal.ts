// Nota fiscal de serviço (NFS-e) pela Focus NFe, com o token da própria empresa.
// A emissão é assíncrona: enviamos a nota com uma referência (ref) e consultamos até a prefeitura autorizar ou recusar.
// Os dados fiscais do prestador (CNPJ, inscrição municipal, código do município, item da lista de serviço e alíquota)
// ficam em company_integrations.config. Os campos exigidos variam por prefeitura: o erro da prefeitura volta para a tela.
import { db, audit, notify } from './db.ts';
import { brl } from './format.ts';
import type { Base } from './context.ts';
import { credsFor, ProviderError, type Actor, type Creds } from './payments.ts';
import type { FiscalNote } from './types.ts';

export interface FiscalConfig {
  cnpj: string; inscricao_municipal: string; codigo_municipio: string; item_lista_servico: string;
  aliquota: number; codigo_tributario_municipio?: string; optante_simples_nacional?: boolean; natureza_operacao?: string;
}

const base = (cr: Pick<Creds, 'environment'>) => (cr.environment === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br');

export async function focusCall<T = Record<string, unknown>>(cr: Pick<Creds, 'api_key' | 'environment'>, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${base(cr)}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Basic ${btoa(`${cr.api_key}:`)}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try { data = (text ? JSON.parse(text) : {}) as T; } catch { data = { mensagem: text } as T; }
  if (res.status === 401 || res.status === 403) throw new ProviderError(res.status, text, 'O token da Focus NFe é inválido ou não tem permissão para esta empresa.');
  return { status: res.status, data };
}

/** Confere o token: uma referência que não existe responde 404 quando o token é válido. */
export async function checkFocusToken(cr: Pick<Creds, 'api_key' | 'environment'>): Promise<void> {
  const r = await focusCall(cr, '/v2/nfse/orbyta-teste-de-conexao');
  if (r.status >= 500) throw new ProviderError(r.status, JSON.stringify(r.data), 'A Focus NFe está fora do ar agora. Tente de novo em instantes.');
}

interface FocusNote { status?: string; numero?: string; codigo_verificacao?: string; url?: string; url_danfse?: string; caminho_xml_nota_fiscal?: string; erros?: { mensagem?: string }[]; mensagem?: string; data_emissao?: string }

export interface NewNote { contactId?: string | null; saleId?: string | null; chargeId?: string | null; amount: number; description: string; taker: { name: string; document?: string | null; email?: string | null } }

export async function emitNote(b: Base, n: NewNote, actor: Actor): Promise<FiscalNote> {
  const cr = await credsFor(b.company.id, 'focusnfe');
  if (!cr) throw new ProviderError(400, 'sem integração', 'Conecte a Focus NFe em Integrações para emitir notas.');
  const { data: integ } = await db.from('company_integrations').select('config').eq('company_id', b.company.id).eq('provider', 'focusnfe').single();
  const cfg = (integ?.config ?? {}) as FiscalConfig;
  if (!cfg.cnpj || !cfg.inscricao_municipal || !cfg.codigo_municipio || !cfg.item_lista_servico) throw new ProviderError(400, 'config', 'Complete os dados fiscais da empresa em Integrações → Nota fiscal.');
  const amount = Math.round(n.amount * 100) / 100;
  if (!(amount > 0)) throw new ProviderError(400, 'valor', 'Informe o valor da nota.');
  const doc = (n.taker.document ?? '').replace(/\D/g, '');
  if (doc && !/^(\d{11}|\d{14})$/.test(doc)) throw new ProviderError(400, 'documento', 'CPF ou CNPJ do cliente inválido.');

  const { data: note, error } = await db.from('fiscal_notes').insert({
    company_id: b.company.id, contact_id: n.contactId ?? null, sale_id: n.saleId ?? null, charge_id: n.chargeId ?? null, amount, description: n.description.slice(0, 2000),
    taker: { name: n.taker.name, document: doc || undefined, email: n.taker.email || undefined }, created_via: actor.via,
  }).select('*').single();
  if (error) throw new Error(error.message);

  const tomador: Record<string, unknown> = { razao_social: n.taker.name.slice(0, 115) };
  if (doc.length === 11) tomador.cpf = doc; else if (doc.length === 14) tomador.cnpj = doc;
  if (n.taker.email) tomador.email = n.taker.email;
  const body = {
    data_emissao: new Date().toISOString(),
    natureza_operacao: cfg.natureza_operacao ?? '1',
    optante_simples_nacional: cfg.optante_simples_nacional ?? true,
    prestador: { cnpj: cfg.cnpj, inscricao_municipal: cfg.inscricao_municipal, codigo_municipio: cfg.codigo_municipio },
    tomador,
    servico: {
      valor_servicos: amount, discriminacao: n.description.slice(0, 2000), aliquota: Number(cfg.aliquota ?? 0), iss_retido: false,
      item_lista_servico: cfg.item_lista_servico, ...(cfg.codigo_tributario_municipio ? { codigo_tributario_municipio: cfg.codigo_tributario_municipio } : {}),
    },
  };
  const r = await focusCall<FocusNote>(cr, `/v2/nfse?ref=${note.ref}`, { method: 'POST', body });
  if (r.status >= 400) {
    const msg = r.data.erros?.map((e) => e.mensagem).filter(Boolean).join(' ') || r.data.mensagem || 'A Focus NFe recusou a nota.';
    await db.from('fiscal_notes').update({ status: 'erro', error: msg.slice(0, 1000) }).eq('id', note.id);
    throw new ProviderError(r.status, JSON.stringify(r.data), msg);
  }
  await audit({ company_id: b.company.id, actor_type: actor.type, actor_name: actor.name, actor_user_id: actor.userId ?? null, channel: actor.channel, action: 'emitir_nota', summary: `Enviou para emissão a nota de ${brl(amount)} para ${n.taker.name}`, target_type: 'fiscal_note', target_id: note.id });
  return (await syncNote(note as FiscalNote, cr)) ?? (note as FiscalNote);
}

const STATUS: Record<string, FiscalNote['status']> = { autorizado: 'autorizada', erro_autorizacao: 'erro', cancelado: 'cancelada', processando_autorizacao: 'processando' };

/** Consulta a nota na Focus e atualiza a linha. Avisa a equipe quando a prefeitura autoriza ou recusa. */
export async function syncNote(note: FiscalNote, cr?: Creds | null): Promise<FiscalNote | null> {
  cr ??= await credsFor(note.company_id, 'focusnfe');
  if (!cr) return null;
  const r = await focusCall<FocusNote>(cr, `/v2/nfse/${note.ref}`);
  if (r.status === 404) return null;
  const status = STATUS[r.data.status ?? ''] ?? note.status;
  const patch: Partial<FiscalNote> = { status };
  if (status === 'autorizada') {
    Object.assign(patch, { number: r.data.numero ?? null, verification_code: r.data.codigo_verificacao ?? null, pdf_url: r.data.url_danfse ?? r.data.url ?? null,
      xml_url: r.data.caminho_xml_nota_fiscal ? `${base(cr)}${r.data.caminho_xml_nota_fiscal}` : null, issued_at: r.data.data_emissao ?? new Date().toISOString(), error: null });
  }
  if (status === 'erro') patch.error = (r.data.erros?.map((e) => e.mensagem).filter(Boolean).join(' ') || 'A prefeitura recusou a nota.').slice(0, 1000);
  const { data: saved } = await db.from('fiscal_notes').update(patch).eq('id', note.id).select('*').single();
  if (status !== note.status && (status === 'autorizada' || status === 'erro')) {
    await notify(note.company_id, 'financeiro', status === 'autorizada' ? `Nota fiscal nº ${patch.number ?? ''} autorizada` : 'Nota fiscal recusada pela prefeitura',
      status === 'autorizada' ? `${note.taker?.name ?? 'Cliente'} · ${brl(Number(note.amount))}` : patch.error ?? null, '#/cobrancas?aba=notas');
  }
  return saved as FiscalNote;
}

export async function cancelNote(b: Base, note: FiscalNote, reason: string, actor: Actor): Promise<FiscalNote> {
  const cr = await credsFor(b.company.id, 'focusnfe');
  if (!cr) throw new ProviderError(400, 'sem integração', 'A Focus NFe não está conectada.');
  if (note.status !== 'autorizada') throw new ProviderError(400, 'status', 'Só dá para cancelar nota autorizada.');
  const r = await focusCall<FocusNote>(cr, `/v2/nfse/${note.ref}`, { method: 'DELETE', body: { justificativa: reason.slice(0, 255) } });
  if (r.status >= 400) throw new ProviderError(r.status, JSON.stringify(r.data), r.data.erros?.map((e) => e.mensagem).join(' ') || r.data.mensagem || 'A prefeitura não aceitou o cancelamento.');
  const { data } = await db.from('fiscal_notes').update({ status: 'cancelada' }).eq('id', note.id).select('*').single();
  await audit({ company_id: b.company.id, actor_type: actor.type, actor_name: actor.name, actor_user_id: actor.userId ?? null, channel: actor.channel, action: 'cancelar_nota', summary: `Cancelou a nota nº ${note.number ?? ''} (${brl(Number(note.amount))}): ${reason}`, target_type: 'fiscal_note', target_id: note.id });
  return data as FiscalNote;
}
