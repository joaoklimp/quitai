// Integrações: o que já conecta hoje (WhatsApp, planilhas, cobrança pelo Asaas e nota fiscal pela Focus NFe) e o que vem a seguir.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Check, Clock, Copy, ExternalLink, FileSpreadsheet, Landmark, MessageCircle, Plug, ReceiptText, Server, Unplug, Webhook } from 'lucide-react';
import { BRAND } from '../../shared/brand';
import { api, isDemo } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { CompanyIntegration, IntegrationProvider } from '../data/types';
import { can, useMeCtx } from '../context';
import { Badge, Button, Field, Input, Modal, PageHeader, Segmented, Select, Switch, useConfirm, useToast } from '../ui';
import { fmtDoc, onlyDigits } from './Charges';

interface Item { id: string; name: string; what: string; icon: ReactNode; status: 'ativo' | 'em_breve' | 'conectar'; action?: ReactNode; partners?: string; extra?: ReactNode }
type WebhookInfo = { url: string; token: string; events: string[] };

export default function Integrations() {
  const { me } = useMeCtx();
  const owner = can(me, 'dono');
  const { data: integrations = [] } = useList('company_integrations');
  const get = (p: IntegrationProvider) => integrations.find((i) => i.provider === p && i.status === 'conectado');
  const asaas = get('asaas'), focus = get('focusnfe');
  const [modal, setModal] = useState<IntegrationProvider | null>(null);
  const [hook, setHook] = useState<WebhookInfo | null>(null);
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();

  const disconnect = async (p: IntegrationProvider) => {
    if (!(await confirm({ title: p === 'asaas' ? 'Desconectar o Asaas?' : 'Desconectar a emissão de notas?', text: p === 'asaas' ? 'As cobranças já criadas continuam no Asaas, mas a ORBYTA deixa de receber o aviso de pagamento.' : 'As notas já emitidas continuam valendo. Você não conseguirá emitir novas até conectar de novo.', confirm: 'Desconectar', danger: true }))) return;
    try { await api.integrations('disconnect', { provider: p }); inv('company_integrations'); toast('Desconectado'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const envBadge = (i?: CompanyIntegration) => i && (i.environment === 'testes' ? <Badge size="sm" tone="orange">{i.provider === 'focusnfe' ? 'Homologação' : 'Testes'}</Badge> : <Badge size="sm" tone="green">Produção</Badge>);
  const connectActions = (p: IntegrationProvider, on?: CompanyIntegration, page?: ReactNode) => owner ? (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {on && page}
      {on && <Button size="sm" variant="ghost" icon={<Unplug />} onClick={() => disconnect(p)}>Desconectar</Button>}
      <Button size="sm" variant={on ? 'default' : 'solid'} icon={<Plug />} onClick={() => setModal(p)}>{on ? 'Alterar' : 'Conectar'}</Button>
    </div>
  ) : on ? page : <span className="muted small">Só o dono conecta</span>;

  const groups: { title: string; sub: string; items: Item[] }[] = [
    {
      title: 'Conectado hoje', sub: 'Funciona agora',
      items: [
        { id: 'whatsapp', name: 'WhatsApp (API oficial da Meta)', what: 'A IA atende os pacientes e recebe os comandos da equipe pelo número da empresa.', icon: <MessageCircle />, status: 'ativo', action: <Link className="btn sm" to="/configuracoes/whatsapp">Configurar</Link> },
        { id: 'planilhas', name: 'Planilhas (Excel e CSV)', what: 'Importe produtos para o estoque e exporte pacientes, vendas, financeiro e estoque para o Excel.', icon: <FileSpreadsheet />, status: 'ativo', action: <Link className="btn sm" to="/estoque">Importar estoque</Link> },
        {
          id: 'cobranca', name: 'Cobrança dos seus pacientes (Asaas)', icon: <Landmark />, status: asaas ? 'ativo' : 'conectar',
          what: 'Gere Pix e boleto, mande o link no WhatsApp (pelo painel ou pedindo para a IA) e a ORBYTA dá baixa e registra a venda sozinha quando o paciente paga.',
          extra: asaas ? <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{envBadge(asaas)}{asaas.config?.webhook === 'manual' ? <button className="badge sm orange" onClick={async () => { try { setHook(await api.integrations<WebhookInfo>('webhook_info')); } catch (e) { toast((e as Error).message, 'err'); } }}>Aviso de pagamento: configurar à mão</button> : <Badge size="sm">Aviso de pagamento automático</Badge>}</div>
            : <p className="tiny" style={{ margin: '6px 0 0', color: 'var(--ink-3)' }}>Você usa a sua conta Asaas: o dinheiro cai direto nela. Tarifas do Asaas por cobrança paga.</p>,
          action: connectActions('asaas', asaas, <Link className="btn sm" to="/cobrancas">Ver cobranças</Link>),
        },
        {
          id: 'fiscal', name: 'Nota fiscal de serviço (Focus NFe)', icon: <ReceiptText />, status: focus ? 'ativo' : 'conectar',
          what: 'Emita NFS-e da venda, da cobrança paga ou pelo WhatsApp (“emite a nota da Juliana”). O PDF fica guardado e o paciente recebe por e-mail.',
          extra: focus ? <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{envBadge(focus)}<Badge size="sm">CNPJ {fmtDoc(String(focus.config?.cnpj ?? ''))}</Badge></div>
            : <p className="tiny" style={{ margin: '6px 0 0', color: 'var(--ink-3)' }}>Precisa de conta na Focus NFe com o certificado digital A1 da empresa. NF-e de produto ainda não.</p>,
          action: connectActions('focusnfe', focus, <Link className="btn sm" to="/cobrancas?aba=notas">Ver notas</Link>),
        },
      ],
    },
    {
      title: 'Próximas integrações', sub: 'Em desenvolvimento. Diga qual você quer primeiro e ela sobe na fila.',
      items: [
        { id: 'erp', name: 'ERP', what: 'Sincronizar pacientes, produtos, estoque e pedidos com o sistema que você já usa.', icon: <Server />, status: 'em_breve', partners: 'Bling, Tiny (Olist) e Omie' },
        { id: 'nfe', name: 'NF-e de produto', what: 'Nota fiscal de venda de mercadoria, com baixa no estoque.', icon: <ReceiptText />, status: 'em_breve', partners: 'Focus NFe' },
        { id: 'agenda', name: 'Google Agenda', what: 'Os horários marcados pela IA aparecem na agenda do celular da equipe.', icon: <CalendarDays />, status: 'em_breve' },
        { id: 'api', name: 'API e webhooks', what: 'Avisos automáticos para outros sistemas quando entra paciente, venda ou orçamento.', icon: <Webhook />, status: 'em_breve' },
      ],
    },
  ];

  return (
    <>
      <PageHeader title="Integrações" subtitle={`Conecte o ${BRAND.name} às ferramentas que a sua empresa já usa.`} />
      {groups.map((g) => (
        <section key={g.title} style={{ marginBottom: 22 }}>
          <div className="section-title"><h3>{g.title}</h3><span className="muted small">{g.sub}</span></div>
          <div className="integ-grid">
            {g.items.map((i) => (
              <article key={i.id} className="card integ">
                <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <span className="integ-ic">{i.icon}</span>
                  <div className="grow">
                    <div className="row between" style={{ gap: 8 }}><b>{i.name}</b>{i.status === 'ativo' ? <Badge size="sm" tone="green" icon={<Check />}>Ativo</Badge> : i.status === 'conectar' ? <Badge size="sm" tone="blue">Disponível</Badge> : <Badge size="sm" icon={<Clock />}>Em breve</Badge>}</div>
                    <p className="muted small" style={{ margin: '6px 0 0' }}>{i.what}</p>
                    {i.extra}
                    {i.partners && <p className="tiny" style={{ margin: '6px 0 0', color: 'var(--ink-3)' }}>Parceiros previstos: {i.partners}</p>}
                  </div>
                </div>
                <div className="integ-foot">
                  {i.action ?? <a className="btn sm" href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`Quero a integração: ${i.name}`)}`}><Plug />Quero essa</a>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      <AsaasModal open={modal === 'asaas'} current={asaas} onClose={() => setModal(null)} onWebhook={setHook} />
      <FocusModal open={modal === 'focusnfe'} current={focus} onClose={() => setModal(null)} />
      <WebhookModal info={hook} onClose={() => setHook(null)} />
    </>
  );
}

function AsaasModal({ open, current, onClose, onWebhook }: { open: boolean; current?: CompanyIntegration; onClose: () => void; onWebhook: (w: WebhookInfo) => void }) {
  const [key, setKey] = useState('');
  const [env, setEnv] = useState<'testes' | 'producao'>('testes');
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  useEffect(() => { if (open) { setKey(''); setEnv(current?.environment ?? 'testes'); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.integrations<{ webhook: WebhookInfo | null }>('connect_asaas', { api_key: key.trim(), environment: env });
      inv('company_integrations'); onClose();
      if (r.webhook) { toast('Asaas conectado. Falta só um passo: o aviso de pagamento.'); onWebhook(r.webhook); }
      else toast('Asaas conectado. Já dá para cobrar os pacientes.');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Conectar o Asaas" subtitle="As cobranças saem da conta Asaas da sua empresa e o dinheiro cai direto nela."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Conectar</Button></>}>
      <ol className="small" style={{ margin: '0 0 14px', paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Crie a conta da empresa em <a href={env === 'testes' ? 'https://sandbox.asaas.com' : 'https://www.asaas.com'} target="_blank" rel="noreferrer">{env === 'testes' ? 'sandbox.asaas.com' : 'asaas.com'} <ExternalLink style={{ width: 12 }} /></a> (é grátis).</li>
        <li>No Asaas, vá em <b>Integrações → Chaves de API</b> e gere uma chave.</li>
        <li>Cole a chave abaixo. A ORBYTA cadastra sozinha o aviso de pagamento.</li>
      </ol>
      <div className="form-grid">
        <div className="full"><Segmented label="Ambiente" value={env} onChange={setEnv} options={[{ value: 'testes', label: 'Testes (sandbox)' }, { value: 'producao', label: 'Produção (cobrança real)' }]} /></div>
        <Field label="Chave da API do Asaas" className="full" hint={current ? 'Por segurança a chave atual não aparece. Cole de novo para trocar.' : 'Começa com $aact_. Fica guardada só no servidor, nunca no navegador.'}>
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder={isDemo ? 'Na demonstração, qualquer texto com 20 letras' : '$aact_...'} autoComplete="off" spellCheck={false} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

function FocusModal({ open, current, onClose }: { open: boolean; current?: CompanyIntegration; onClose: () => void }) {
  const { me } = useMeCtx();
  const [token, setToken] = useState('');
  const [env, setEnv] = useState<'testes' | 'producao'>('testes');
  const [c, setC] = useState({ cnpj: '', inscricao_municipal: '', codigo_municipio: '', item_lista_servico: '', aliquota: '', codigo_tributario_municipio: '', optante_simples_nacional: true, natureza_operacao: '1' });
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    const k = (current?.config ?? {}) as Record<string, unknown>;
    setToken(''); setEnv(current?.environment ?? 'testes');
    setC({ cnpj: fmtDoc(String(k.cnpj ?? me.company.document ?? '')), inscricao_municipal: String(k.inscricao_municipal ?? ''), codigo_municipio: String(k.codigo_municipio ?? ''), item_lista_servico: String(k.item_lista_servico ?? ''), aliquota: k.aliquota != null ? String(k.aliquota).replace('.', ',') : '', codigo_tributario_municipio: String(k.codigo_tributario_municipio ?? ''), optante_simples_nacional: k.optante_simples_nacional !== false, natureza_operacao: String(k.natureza_operacao ?? '1') });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (onlyDigits(c.cnpj).length !== 14) { toast('CNPJ da empresa inválido', 'err'); return; }
    if (onlyDigits(c.codigo_municipio).length !== 7) { toast('O código do município (IBGE) tem 7 números', 'err'); return; }
    setBusy(true);
    try {
      await api.integrations('connect_focus', { token: token.trim(), environment: env, config: { ...c, cnpj: onlyDigits(c.cnpj), aliquota: Number(c.aliquota.replace(',', '.')) || 0 } });
      inv('company_integrations'); toast('Emissão de nota conectada. Faça uma nota de teste para conferir.'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof c) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} size="wide" title="Conectar a emissão de nota fiscal" subtitle="NFS-e (nota de serviço) pela Focus NFe, na prefeitura da sua cidade."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Conectar</Button></>}>
      <ol className="small" style={{ margin: '0 0 14px', paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Contrate a <a href="https://focusnfe.com.br" target="_blank" rel="noreferrer">Focus NFe <ExternalLink style={{ width: 12 }} /></a>, cadastre a empresa e envie o certificado digital A1.</li>
        <li>Copie o <b>token</b> da empresa no painel da Focus ({env === 'testes' ? 'token de homologação' : 'token de produção'}).</li>
        <li>Peça ao seu contador os dados fiscais abaixo. Comece em homologação: as notas de teste não têm valor fiscal.</li>
      </ol>
      <div className="form-grid">
        <div className="full"><Segmented label="Ambiente" value={env} onChange={setEnv} options={[{ value: 'testes', label: 'Homologação (teste)' }, { value: 'producao', label: 'Produção (nota real)' }]} /></div>
        <Field label="Token da Focus NFe" className="full" hint={current ? 'O token atual não aparece. Cole de novo para salvar.' : 'Fica guardado só no servidor.'}><Input value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder={isDemo ? 'Na demonstração, qualquer texto' : ''} /></Field>
        <Field label="CNPJ da empresa"><Input value={c.cnpj} inputMode="numeric" onChange={set('cnpj')} onBlur={() => setC((x) => ({ ...x, cnpj: fmtDoc(x.cnpj) }))} /></Field>
        <Field label="Inscrição municipal"><Input value={c.inscricao_municipal} onChange={set('inscricao_municipal')} /></Field>
        <Field label="Código do município (IBGE)" hint="7 números. Ex.: São Paulo 3550308"><Input value={c.codigo_municipio} inputMode="numeric" maxLength={7} onChange={set('codigo_municipio')} /></Field>
        <Field label="Item da lista de serviço (LC 116)" hint="Ex.: 0702, 1401, 1705"><Input value={c.item_lista_servico} onChange={set('item_lista_servico')} /></Field>
        <Field label="Alíquota do ISS (%)" hint="Ex.: 2 ou 5"><Input value={c.aliquota} inputMode="decimal" onChange={set('aliquota')} /></Field>
        <Field label="Código tributário do município" hint="Só se a prefeitura pedir"><Input value={c.codigo_tributario_municipio} onChange={set('codigo_tributario_municipio')} /></Field>
        <Field label="Natureza da operação"><Select value={c.natureza_operacao} onChange={set('natureza_operacao')}><option value="1">1 · Tributação no município</option><option value="2">2 · Tributação fora do município</option><option value="3">3 · Isenção</option><option value="4">4 · Imune</option></Select></Field>
        <label className="row" style={{ gap: 10, alignSelf: 'end', paddingBottom: 8 }}><Switch checked={c.optante_simples_nacional} onChange={(v) => setC({ ...c, optante_simples_nacional: v })} label="Optante do Simples" /><span>Optante do Simples Nacional</span></label>
      </div>
    </Modal>
  );
}

function WebhookModal({ info, onClose }: { info: WebhookInfo | null; onClose: () => void }) {
  const toast = useToast();
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Copiado'); } catch { toast('Não deu para copiar', 'err'); } };
  return (
    <Modal open={!!info} onClose={onClose} title="Aviso de pagamento do Asaas" subtitle="O Asaas não deixou a ORBYTA cadastrar o aviso sozinha. Faça uma vez e pronto."
      footer={<Button variant="solid" onClick={onClose}>Feito</Button>}>
      {info && <>
        <ol className="small" style={{ margin: '0 0 14px', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>No Asaas, abra <b>Integrações → Webhooks</b> e clique em <b>Adicionar</b>.</li>
          <li>Cole o endereço e o token abaixo, na versão de API v3.</li>
          <li>Marque os eventos de cobrança: {info.events.join(', ')}.</li>
        </ol>
        <Field label="URL do webhook"><div className="row" style={{ gap: 6 }}><Input readOnly value={info.url} onFocus={(e) => e.target.select()} /><Button icon={<Copy />} iconOnly aria-label="Copiar URL" onClick={() => copy(info.url)} /></div></Field>
        <Field label="Token de autenticação"><div className="row" style={{ gap: 6 }}><Input readOnly value={info.token} onFocus={(e) => e.target.select()} /><Button icon={<Copy />} iconOnly aria-label="Copiar token" onClick={() => copy(info.token)} /></div></Field>
        <p className="muted small" style={{ margin: '10px 0 0' }}>Enquanto isso, o botão <b>Conferir pagamento</b> em Cobranças consulta o Asaas na hora.</p>
      </>}
    </Modal>
  );
}
