// Configurações: empresa, assistente IA, WhatsApp, equipe, assinatura e conta.
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Bot, MessageCircle, Users, CreditCard, UserCog, Check, Copy, Plus, Trash2, ShieldCheck, Smartphone, Sparkles, Download, KeyRound, ExternalLink,
  QrCode, Receipt, RefreshCw, Lock, CircleAlert, Link2, Unlink,
} from 'lucide-react';
import { api, isDemo } from '../data/api';
import { SUPABASE_URL } from '../data/supabase/supaSource';
import { useInvalidate, useList } from '../data/hooks';
import type { AiSettings, BusinessHours, Company, Member, Role, Tone, WhatsAppAccount } from '../data/types';
import { useMeCtx, can, useTheme } from '../context';
import { Avatar, Badge, Button, Empty, Field, Input, Loader, Modal, MoneyInput, PageHeader, PhoneInput, Segmented, Select, Switch, Textarea, cx, useConfirm, useToast } from '../ui';
import { brl, fmtDate, fmtAgo, formatPhone, WEEKDAYS } from '../../shared/format';
import { TEMPLATE_LIST } from '../../shared/templates';
import { PLANS, PAID_PLANS, planPrice, monthlyEquivalent, type Cycle, type PaidPlanId } from '../../shared/plans';

const TABS = [
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'assistente', label: 'Assistente IA', icon: Bot },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'equipe', label: 'Equipe', icon: Users },
  { id: 'assinatura', label: 'Assinatura', icon: CreditCard },
  { id: 'conta', label: 'Sua conta', icon: UserCog },
];
export const SEGMENTS: [string, string][] = [['limpeza', 'Limpeza e higienização'], ['beleza', 'Beleza e estética'], ['oficina', 'Oficina e serviços automotivos'], ['assistencia', 'Assistência técnica'], ['saude', 'Clínica e consultório'], ['pet', 'Pet shop e veterinária'], ['reformas', 'Reformas e manutenção'], ['eventos', 'Eventos e buffet'], ['educacao', 'Aulas e cursos'], ['outro', 'Outro']];
const TZS: [string, string][] = [['America/Sao_Paulo', 'Brasília (SP, RJ, MG, Sul, GO, DF...)'], ['America/Manaus', 'Amazonas (−1h)'], ['America/Cuiaba', 'Mato Grosso e MS (−1h)'], ['America/Belem', 'Pará e Amapá'], ['America/Fortaleza', 'Nordeste'], ['America/Recife', 'Pernambuco'], ['America/Rio_Branco', 'Acre (−2h)'], ['America/Noronha', 'Fernando de Noronha (+1h)']];

export default function Settings() {
  const { tab = 'empresa' } = useParams();
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <>
      <PageHeader title="Configurações" subtitle="Ajuste a empresa, a IA, o WhatsApp e a equipe. As mudanças valem na hora." />
      <div className="settings">
        <nav className="settings-nav" aria-label="Seções">
          {TABS.map((t) => <NavLink key={t.id} to={`/configuracoes/${t.id}`} className={() => cx(t.id === current.id && 'active')}><t.icon />{t.label}</NavLink>)}
        </nav>
        <div>
          {current.id === 'empresa' && <CompanyTab />}
          {current.id === 'assistente' && <AssistantTab />}
          {current.id === 'whatsapp' && <WhatsAppTab />}
          {current.id === 'equipe' && <TeamTab />}
          {current.id === 'assinatura' && <BillingTab />}
          {current.id === 'conta' && <AccountTab />}
        </div>
      </div>
    </>
  );
}

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return <div className="save-bar"><span className="muted small grow">Você tem alterações não salvas.</span><Button variant="ghost" onClick={onReset}>Descartar</Button><Button variant="solid" loading={busy} onClick={onSave} icon={<Check />}>Salvar alterações</Button></div>;
}

/* ================= empresa ================= */
function CompanyTab() {
  const { me, refresh } = useMeCtx();
  const toast = useToast();
  const [f, setF] = useState<Company>(me.company);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(me.company), [me.company]);
  const dirty = JSON.stringify(f) !== JSON.stringify(me.company);
  const set = <K extends keyof Company>(k: K, v: Company[K]) => setF((x) => ({ ...x, [k]: v }));
  const owner = can(me, 'dono', 'gerente');
  const save = async () => { setBusy(true); try { await api.updateCompany(f); refresh(); toast('Dados da empresa salvos'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); } };
  return (
    <>
      <section className="card set-section">
        <div className="card-head"><div><h3>Dados da empresa</h3><div className="sub">A IA usa o nome e a cidade para se apresentar.</div></div></div>
        <div className="form-grid">
          <Field label="Nome da empresa" className="full"><Input value={f.name} onChange={(e) => set('name', e.target.value)} disabled={!owner} /></Field>
          <Field label="Segmento"><Select value={f.segment} onChange={(e) => set('segment', e.target.value)} disabled={!owner}>{SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="CPF ou CNPJ"><Input value={f.document ?? ''} onChange={(e) => set('document', e.target.value)} disabled={!owner} /></Field>
          <Field label="Telefone comercial"><PhoneInput value={f.phone ?? ''} onChange={(v) => set('phone', v)} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} disabled={!owner} /></Field>
          <Field label="Endereço" className="full"><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} disabled={!owner} /></Field>
          <Field label="Cidade"><Input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} disabled={!owner} /></Field>
          <Field label="Estado"><Input value={f.state ?? ''} maxLength={2} onChange={(e) => set('state', e.target.value.toUpperCase())} disabled={!owner} /></Field>
          <Field label="Fuso horário" className="full"><Select value={f.timezone} onChange={(e) => set('timezone', e.target.value)} disabled={!owner}>{TZS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        </div>
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>Horário de funcionamento</h3><div className="sub">A IA só marca horários dentro destes intervalos. Use dois intervalos para a pausa do almoço.</div></div></div>
        <HoursEditor value={f.business_hours} onChange={(v) => set('business_hours', v)} disabled={!owner} />
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>Agenda</h3><div className="sub">Como a IA reserva horários.</div></div></div>
        <div className="form-grid">
          <Field label="Intervalo entre horários" hint="De quanto em quanto tempo a agenda oferece horários"><Select value={f.slot_minutes} onChange={(e) => set('slot_minutes', Number(e.target.value))} disabled={!owner}>{[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutos</option>)}</Select></Field>
          <Field label="Atendimentos ao mesmo tempo" hint="Quantas equipes, salas ou cadeiras você tem"><Input type="number" min={1} max={50} value={f.capacity_per_slot} onChange={(e) => set('capacity_per_slot', Math.max(1, Number(e.target.value)))} disabled={!owner} /></Field>
          <Field label="Antecedência mínima"><Select value={f.min_notice_minutes} onChange={(e) => set('min_notice_minutes', Number(e.target.value))} disabled={!owner}>{[[0, 'Sem antecedência'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [1440, '1 dia']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Marcar até quantos dias à frente"><Input type="number" min={1} max={365} value={f.max_days_ahead} onChange={(e) => set('max_days_ahead', Math.max(1, Number(e.target.value)))} disabled={!owner} /></Field>
          <Field label="Meta de vendas do mês" hint="Aparece na Visão geral"><MoneyInput value={f.monthly_goal} onChange={(v) => set('monthly_goal', v)} /></Field>
        </div>
      </section>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setF(me.company)} />
    </>
  );
}

function HoursEditor({ value, onChange, disabled }: { value: BusinessHours; onChange: (v: BusinessHours) => void; disabled?: boolean }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const set = (d: number, iv: [string, string][]) => onChange({ ...value, [String(d)]: iv });
  return (
    <div className="hours">
      {order.map((d) => {
        const iv = value[String(d)] ?? [];
        const open = iv.length > 0;
        return (
          <div key={d} className={cx('hours-row', !open && 'closed')}>
            <b style={{ textTransform: 'capitalize' }}>{WEEKDAYS[d]}</b>
            <Switch checked={open} disabled={disabled} label={`${WEEKDAYS[d]}: ${open ? 'aberto' : 'fechado'}`} onChange={(v) => set(d, v ? [['08:00', '18:00']] : [])} />
            <div className="times">
              {!open ? <span>Fechado</span> : iv.map(([a, b], i) => (
                <span key={i} className="row" style={{ gap: 6 }}>
                  <Input type="time" value={a} disabled={disabled} onChange={(e) => set(d, iv.map((x, k) => (k === i ? [e.target.value, x[1]] : x)) as [string, string][])} aria-label="Abre" />
                  <span>às</span>
                  <Input type="time" value={b} disabled={disabled} onChange={(e) => set(d, iv.map((x, k) => (k === i ? [x[0], e.target.value] : x)) as [string, string][])} aria-label="Fecha" />
                  {iv.length > 1 && <button type="button" className="icon-btn xs" aria-label="Remover intervalo" onClick={() => set(d, iv.filter((_, k) => k !== i))}><Trash2 /></button>}
                </span>
              ))}
              {open && iv.length < 3 && !disabled && <button type="button" className="link small" onClick={() => set(d, [...iv, ['14:00', '18:00']])}>+ intervalo</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================= assistente ================= */
const TONES: [Tone, string, string][] = [['amigavel', 'Amigável', '“Oi! Claro, te ajudo agora 😊”'], ['profissional', 'Profissional', '“Olá! Será um prazer ajudar.”'], ['descontraido', 'Descontraído', '“Opa! Bora resolver isso 🚀”']];
function AssistantTab() {
  const { data: ai, isLoading } = useQuery({ queryKey: ['ai'], queryFn: () => api.aiSettings() });
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { me } = useMeCtx();
  const [f, setF] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (ai) setF(ai); }, [ai]);
  if (isLoading || !f || !ai) return <Loader />;
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const dirty = JSON.stringify(f) !== JSON.stringify(ai);
  const owner = can(me, 'dono', 'gerente');
  const save = async () => { setBusy(true); try { const r = await api.updateAiSettings(f); qc.setQueryData(['ai'], r); toast('Assistente atualizado. Vale a partir da próxima mensagem.'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); } };
  return (
    <>
      <section className="card set-section">
        <div className="opt-row" style={{ paddingTop: 0 }}>
          <div><div className="t">IA atendendo os clientes no WhatsApp</div><div className="d">Desligada, as mensagens ficam para a equipe responder em Conversas. Os seus comandos continuam funcionando.</div></div>
          <Switch checked={f.enabled} disabled={!owner} label="IA atendendo" onChange={(v) => set('enabled', v)} />
        </div>
        <div className="form-grid" style={{ marginTop: 6 }}>
          <Field label="Nome da assistente" hint="Como ela se apresenta"><Input value={f.assistant_name} onChange={(e) => set('assistant_name', e.target.value)} disabled={!owner} maxLength={30} /></Field>
          <Field label="Usar emojis"><div style={{ paddingTop: 8 }}><Switch checked={f.use_emojis} disabled={!owner} label="Usar emojis" onChange={(v) => set('use_emojis', v)} /></div></Field>
        </div>
        <div className="label" style={{ margin: '18px 0 8px' }}>Tom de voz</div>
        <div className="tone-grid">{TONES.map(([v, l, ex]) => <button key={v} type="button" className={cx('tone', f.tone === v && 'on')} disabled={!owner} onClick={() => set('tone', v)}><b>{l}</b><span>{ex}</span></button>)}</div>
        <Field label="Saudação" className="full"><Input value={f.greeting} onChange={(e) => set('greeting', e.target.value)} disabled={!owner} placeholder={`Oi! Aqui é a ${f.assistant_name}, da ${me.company.name}. Como posso ajudar?`} /></Field>
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>O que a IA precisa saber</h3><div className="sub">Escreva como se explicasse para um funcionário novo. Os preços vêm de <Link className="link" to="/catalogo">Serviços e preços</Link>.</div></div></div>
        <Textarea value={f.instructions} onChange={(e) => set('instructions', e.target.value)} disabled={!owner} style={{ minHeight: 220 }} placeholder={'Exemplos:\n• Onde vocês atendem e se cobram deslocamento\n• Formas de pagamento e parcelamento\n• Prazos, garantia, cuidados\n• O que NÃO fazem\n• Quando chamar uma pessoa'} />
        <div className="muted small" style={{ marginTop: 8 }}>{f.instructions.length} caracteres · Evite colocar dados pessoais de clientes aqui.</div>
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>Regras de atendimento</h3><div className="sub">O que a IA pode fazer sozinha.</div></div></div>
        <div className="opt-row"><div><div className="t">Quando a IA responde</div><div className="d">Fora do horário, a IA garante que ninguém fica sem resposta.</div></div>
          <Select value={f.schedule_mode} disabled={!owner} onChange={(e) => set('schedule_mode', e.target.value as AiSettings['schedule_mode'])} style={{ width: 240 }}><option value="sempre">Sempre, 24 horas</option><option value="fora_do_horario">Só fora do horário comercial</option><option value="horario_comercial">Só no horário comercial</option></Select></div>
        <div className="opt-row"><div><div className="t">Agendamentos pelo WhatsApp</div><div className="d">“Confirmar na hora”: o horário já entra confirmado. “Equipe aprova”: entra como “a confirmar” até alguém aprovar.</div></div>
          <Segmented label="Agendamentos" value={f.booking_mode} onChange={(v) => set('booking_mode', v)} options={[{ value: 'automatico', label: 'Confirmar na hora' }, { value: 'confirmar', label: 'Equipe aprova' }]} /></div>
        <div className="opt-row"><div><div className="t">IA monta orçamentos para clientes</div><div className="d">Com base na tabela de preços. Itens “sob consulta” sempre vão para a equipe.</div></div><Switch checked={f.can_quote} disabled={!owner} label="IA monta orçamentos" onChange={(v) => set('can_quote', v)} /></div>
        <div className="opt-row"><div><div className="t">Desconto máximo sem pedir sua confirmação</div><div className="d">Acima disso, a IA pede sua aprovação (para clientes, ela chama a equipe).</div></div><div className="row" style={{ gap: 6 }}><Input type="number" min={0} max={100} value={f.max_discount_pct} disabled={!owner} onChange={(e) => set('max_discount_pct', Math.min(100, Math.max(0, Number(e.target.value))))} style={{ width: 90 }} />%</div></div>
        <div className="opt-row"><div><div className="t">Chamar uma pessoa em reclamações</div><div className="d">Quando o cliente reclama, a IA pede desculpas e passa para a equipe na hora.</div></div><Switch checked={f.handoff_on_complaint} disabled={!owner} label="Chamar pessoa em reclamações" onChange={(v) => set('handoff_on_complaint', v)} /></div>
        <div className="callout" style={{ marginTop: 14 }}><ShieldCheck /><span><strong>Sempre com sua confirmação:</strong> registrar vendas, cancelar horários, mudar preços, excluir clientes, mandar mensagens em seu nome e descontos acima do limite. Clientes nunca acessam funções da empresa.</span></div>
      </section>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><Button icon={<Smartphone />} onClick={() => nav('/simulador')}>Testar no simulador</Button></div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setF(ai)} />
    </>
  );
}

/* ================= whatsapp ================= */
function WhatsAppTab() {
  const { me, refresh } = useMeCtx();
  const { data: wa, isLoading, refetch } = useQuery({ queryKey: ['wa'], queryFn: () => api.whatsapp() });
  const toast = useToast();
  const confirm = useConfirm();
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState<{ code: string; number: string | null } | null>(null);
  const { data: members = [] } = useList('members');
  const meMember = members.find((m) => m.user_id === me.user_id);
  const webhook = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/whatsapp-webhook` : 'https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook';
  const copy = async (t: string) => { await navigator.clipboard.writeText(t); toast('Copiado'); };
  if (isLoading || !wa) return <Loader />;
  const connected = wa.status === 'conectado';
  return (
    <>
      <section className="card set-section">
        <div className="card-head"><div><h3>Número da empresa</h3><div className="sub">A API oficial do WhatsApp (Meta). Os clientes falam com este número e a IA responde.</div></div></div>
        <div className={cx('conn', !connected && 'off')}>
          <span className="conn-ic"><MessageCircle /></span>
          <div className="grow">
            {connected ? <><b style={{ fontSize: 17 }}>{wa.display_phone}</b><div className="muted small">{wa.verified_name} · conectado {fmtAgo(wa.connected_at)}</div></> : <><b style={{ fontSize: 16 }}>Nenhum número conectado</b><div className="muted small">{wa.last_error ? `Último erro: ${wa.last_error}` : 'Conecte para a IA começar a atender. Enquanto isso, teste no simulador.'}</div></>}
          </div>
          {connected ? <Badge tone="green" dot>Conectado</Badge> : <Badge>Desconectado</Badge>}
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
          {!connected && <MetaConnect onDone={() => { void refetch(); refresh(); }} />}
          {!connected && <Button icon={<KeyRound />} onClick={() => setManual(true)}>Conectar com credenciais</Button>}
          {connected && can(me, 'dono') && <Button variant="danger-soft" icon={<Unlink />} onClick={async () => { if (await confirm({ title: 'Desconectar o WhatsApp?', text: 'A IA para de responder os clientes até você conectar de novo.', confirm: 'Desconectar', danger: true })) { await api.disconnectWhatsApp(); void refetch(); toast('WhatsApp desconectado'); } }}>Desconectar</Button>}
          <Link className="btn" to="/simulador"><Smartphone />Testar no simulador</Link>
        </div>
      </section>

      <section className="card set-section">
        <div className="card-head"><div><h3>Seu número para mandar comandos</h3><div className="sub">Pelo seu WhatsApp pessoal você fala com a IA da empresa e ela executa: cadastrar, agendar, orçar, consultar vendas.</div></div></div>
        {meMember?.phone_verified_at ? (
          <div className="callout ok"><Check /><span><strong>{formatPhone(meMember.phone)} verificado.</strong> Mande mensagens para {wa.display_phone ?? 'o número da empresa'} e a IA reconhece você como {me.role}. Ações sensíveis pedem sua confirmação.</span></div>
        ) : code ? (
          <div className="col" style={{ gap: 12 }}>
            <p className="muted-2">Do seu WhatsApp pessoal, envie esta mensagem para <b>{code.number ?? 'o número da empresa'}</b>:</p>
            <div className="big-code">{code.code}</div>
            <p className="muted small">O código vale por 15 minutos. Assim que a mensagem chegar, seu número fica verificado.</p>
            <Button icon={<RefreshCw />} onClick={() => { refresh(); toast('Atualizado'); }}>Já enviei</Button>
          </div>
        ) : (
          <Button variant="solid" icon={<QrCode />} disabled={!connected && !isDemo} onClick={async () => { try { const c = await api.ownerLinkCode(); setCode(c); } catch (e) { toast((e as Error).message, 'err'); } }}>Verificar meu número</Button>
        )}
      </section>

      <section className="card set-section">
        <div className="card-head"><div><h3>Configuração técnica (Meta)</h3><div className="sub">Para quem vai conectar o número no painel de desenvolvedor da Meta.</div></div></div>
        <ol className="steps">
          <li><span>No <a className="link" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">Meta for Developers <ExternalLink className="ii" /></a>, crie um app do tipo Negócios e adicione o produto WhatsApp.</span></li>
          <li><span>Em WhatsApp → Configuração, cadastre o webhook com a URL abaixo e o mesmo token de verificação definido no servidor (<code>META_VERIFY_TOKEN</code>). Assine o campo <b>messages</b>.<div className="code-box" style={{ marginTop: 8 }}><code>{webhook}</code><button className="icon-btn xs" onClick={() => copy(webhook)} aria-label="Copiar URL"><Copy /></button></div></span></li>
          <li><span>Crie um usuário do sistema com permissão no WhatsApp e gere um token permanente. Use o identificador do número e o da conta (WABA) em “Conectar com credenciais”.</span></li>
          <li><span>Cadastre os modelos de mensagem abaixo (idioma: português do Brasil) no Gerenciador do WhatsApp. Eles são usados pelas automações fora da janela de 24 horas.</span></li>
        </ol>
        <div className="mini-list" style={{ marginTop: 16 }}>
          {TEMPLATE_LIST.map((t) => (
            <div key={t.name} style={{ flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
              <div className="row between"><b><code>{t.name}</code></b><span className="row" style={{ gap: 6 }}><Badge size="sm">{t.category}</Badge><button className="icon-btn xs" onClick={() => copy(t.body)} aria-label="Copiar texto"><Copy /></button></span></div>
              <span className="small" style={{ color: 'var(--ink-2)' }}>{t.body}</span>
              <span className="muted tiny">{t.use} Variáveis: {t.params.map((x, i) => `{{${i + 1}}} ${x}`).join(' · ')}</span>
            </div>
          ))}
        </div>
      </section>
      <ManualConnect open={manual} onClose={() => setManual(false)} onDone={() => { void refetch(); refresh(); }} />
    </>
  );
}

function ManualConnect({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ phone_number_id: '', waba_id: '', access_token: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    if (!f.phone_number_id.trim() || !f.access_token.trim()) { toast('Preencha o identificador do número e o token', 'err'); return; }
    setBusy(true);
    try { const w: WhatsAppAccount = await api.connectWhatsApp({ phone_number_id: f.phone_number_id.trim(), waba_id: f.waba_id.trim(), access_token: f.access_token.trim() }); toast(`Conectado: ${w.display_phone ?? 'número'}`); onDone(); onClose(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Conectar com credenciais" subtitle="Os dados ficam guardados só no servidor. Ninguém da equipe consegue ver o token depois." footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Conectar e testar</Button></>}>
      <div className="form-grid">
        <Field label="Identificação do número (Phone number ID)" className="full"><Input value={f.phone_number_id} onChange={(e) => setF({ ...f, phone_number_id: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Identificação da conta (WABA ID)" className="full"><Input value={f.waba_id} onChange={(e) => setF({ ...f, waba_id: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Token de acesso permanente" className="full"><Input type="password" value={f.access_token} onChange={(e) => setF({ ...f, access_token: e.target.value })} autoComplete="off" /></Field>
      </div>
    </Modal>
  );
}

/** Cadastro incorporado da Meta (Embedded Signup): aparece quando o app da Meta está configurado. */
function MetaConnect({ onDone }: { onDone: () => void }) {
  const appId = import.meta.env.VITE_META_APP_ID as string | undefined;
  const configId = import.meta.env.VITE_META_CONFIG_ID as string | undefined;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!appId || !configId || isDemo) return null;
  const start = async () => {
    setBusy(true);
    try {
      await loadFbSdk(appId);
      const info: { phone_number_id?: string; waba_id?: string } = {};
      const onMsg = (ev: MessageEvent) => {
        if (!/facebook\.com$/.test(new URL(ev.origin).hostname)) return;
        try { const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; if (d?.type === 'WA_EMBEDDED_SIGNUP' && d.data) Object.assign(info, d.data); } catch { /* outra mensagem */ }
      };
      window.addEventListener('message', onMsg);
      const code = await new Promise<string | null>((resolve) => {
        (window as unknown as { FB: { login: (cb: (r: { authResponse?: { code?: string } }) => void, o: unknown) => void } }).FB.login((r) => resolve(r.authResponse?.code ?? null), { config_id: configId, response_type: 'code', override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: '3' } });
      });
      window.removeEventListener('message', onMsg);
      if (!code) { toast('Conexão cancelada', 'err'); return; }
      await api.connectWhatsApp({ phone_number_id: info.phone_number_id ?? '', waba_id: info.waba_id ?? '', access_token: `code:${code}` });
      toast('WhatsApp conectado!'); onDone();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return <Button variant="solid" loading={busy} icon={<Link2 />} onClick={start}>Conectar com a Meta</Button>;
}
function loadFbSdk(appId: string): Promise<void> {
  const w = window as unknown as { FB?: { init: (o: unknown) => void }; fbAsyncInit?: () => void };
  if (w.FB) return Promise.resolve();
  return new Promise((resolve, reject) => {
    w.fbAsyncInit = () => { w.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v23.0' }); resolve(); };
    const s = document.createElement('script'); s.src = 'https://connect.facebook.net/pt_BR/sdk.js'; s.async = true; s.defer = true; s.crossOrigin = 'anonymous'; s.onerror = () => reject(new Error('Não foi possível carregar o login da Meta'));
    document.body.appendChild(s);
  });
}

/* ================= equipe ================= */
const ROLE_LABEL: Record<Role, string> = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente' };
const ROLE_DESC: Record<Role, string> = { dono: 'Tudo, inclusive assinatura e exclusão da conta', gerente: 'Tudo, menos assinatura e exclusão da conta', atendente: 'Conversas, clientes, orçamentos e agenda (sem vendas e configurações)' };
function TeamTab() {
  const { me } = useMeCtx();
  const { data: members = [], isLoading } = useList('members');
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'atendente' as Role });
  const [busy, setBusy] = useState(false);
  const limit = PLANS[me.company.plan].users;
  const owner = can(me, 'dono', 'gerente');
  const invite = async () => {
    if (!f.name.trim() || !/\S+@\S+\.\S+/.test(f.email)) { toast('Informe nome e e-mail válidos', 'err'); return; }
    setBusy(true);
    try { await api.inviteMember({ name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role }); inv('members'); toast(`Convite enviado para ${f.email}`); setOpen(false); setF({ name: '', email: '', role: 'atendente' }); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <>
      <section className="card set-section">
        <div className="card-head"><div><h3>Equipe</h3><div className="sub">{members.length} de {limit} pessoas no plano {PLANS[me.company.plan].name}</div></div>{owner && <Button variant="solid" icon={<Plus />} disabled={members.length >= limit} onClick={() => setOpen(true)}>Convidar pessoa</Button>}</div>
        {isLoading ? <Loader /> : members.map((m: Member) => (
          <div key={m.user_id} className="member">
            <Avatar name={m.name} />
            <div className="grow" style={{ minWidth: 0 }}><b>{m.name}{m.user_id === me.user_id && <span className="muted"> (você)</span>}</b><div className="muted small">{m.email}{m.phone_verified_at ? ` · WhatsApp ${formatPhone(m.phone)} verificado` : ''}{m.invited ? ' · convite pendente' : ''}</div></div>
            {owner && m.role !== 'dono' && m.user_id !== me.user_id ? (
              <Select value={m.role} onChange={async (e) => { await api.updateMember(m.user_id, { role: e.target.value as Role }); inv('members'); toast('Permissão atualizada'); }} style={{ width: 150 }} aria-label="Papel">{(['gerente', 'atendente'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
            ) : <Badge>{ROLE_LABEL[m.role]}</Badge>}
            {owner && m.role !== 'dono' && m.user_id !== me.user_id && <button className="icon-btn xs" aria-label="Remover" onClick={async () => { if (await confirm({ title: `Remover ${m.name}?`, text: 'A pessoa perde o acesso na hora. O histórico do que ela fez continua guardado.', confirm: 'Remover', danger: true })) { await api.removeMember(m.user_id); inv('members'); toast('Pessoa removida'); } }}><Trash2 /></button>}
          </div>
        ))}
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>O que cada papel pode fazer</h3></div></div>
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <div key={r} className="opt-row"><div><div className="t">{ROLE_LABEL[r]}</div><div className="d">{ROLE_DESC[r]}</div></div></div>)}
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title="Convidar pessoa" subtitle="Ela recebe um e-mail para criar a senha e entrar." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="solid" loading={busy} onClick={invite}>Enviar convite</Button></>}>
        <div className="form-grid">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Papel" className="full"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="atendente">Atendente</option><option value="gerente">Gerente</option></Select></Field>
        </div>
      </Modal>
    </>
  );
}

/* ================= assinatura ================= */
const STATUS_LABEL: Record<string, [string, 'green' | 'yellow' | 'red' | 'blue']> = { trialing: ['Teste grátis', 'blue'], active: ['Ativa', 'green'], past_due: ['Pagamento atrasado', 'yellow'], canceled: ['Cancelada', 'red'], blocked: ['Bloqueada', 'red'] };
function BillingTab() {
  const { me, refresh } = useMeCtx();
  const toast = useToast();
  const confirm = useConfirm();
  const c = me.company;
  const { data: usage } = useQuery({ queryKey: ['usage'], queryFn: () => api.usage() });
  const { data: invoices = [] } = useList('invoices', { order: [{ col: 'due_date', asc: false }], limit: 24 });
  const [cycle, setCycle] = useState<Cycle>(c.billing_cycle ?? 'mensal');
  const [pick, setPick] = useState<PaidPlanId | null>(null);
  const plan = PLANS[c.plan];
  const used = usage?.ai_replies ?? 0;
  const [label, tone] = STATUS_LABEL[c.billing_status] ?? ['—', 'blue'];
  const trialLeft = Math.max(0, Math.ceil((Date.parse(c.trial_ends_at) - Date.now()) / 86400000));
  const owner = can(me, 'dono');
  return (
    <>
      <section className="card set-section">
        <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="row" style={{ gap: 10 }}><h3 style={{ fontSize: 22 }}>Plano {plan.name}</h3><Badge tone={tone} dot>{label}</Badge>{c.complimentary && <Badge tone="violet">Cortesia</Badge>}</div>
            <p className="muted" style={{ marginTop: 6 }}>
              {c.billing_status === 'trialing' ? `${trialLeft} ${trialLeft === 1 ? 'dia' : 'dias'} de teste restantes (até ${fmtDate(c.trial_ends_at)}).` : c.current_period_end ? `${c.billing_status === 'canceled' ? 'Acesso até' : 'Próxima cobrança em'} ${fmtDate(c.current_period_end)} · ${c.billing_cycle ?? ''} · ${c.billing_method === 'cartao' ? 'cartão de crédito' : 'Pix ou boleto'}` : ''}
            </p>
          </div>
          {!isDemo && <Button size="sm" icon={<RefreshCw />} onClick={async () => { try { const r = await api.syncBilling(); refresh(); toast(r.status === 'active' ? 'Pagamento confirmado. Tudo certo!' : 'Ainda não encontramos o pagamento. Pode levar alguns minutos.'); } catch (e) { toast((e as Error).message, 'err'); } }}>Já paguei e não liberou</Button>}
        </div>
        <div className="usage" style={{ marginTop: 18 }}>
          <div className="row between small"><span>Respostas da IA neste mês</span><b>{used.toLocaleString('pt-BR')} de {plan.aiReplies.toLocaleString('pt-BR')}</b></div>
          <div className="progress"><span style={{ width: `${Math.min(100, (used / plan.aiReplies) * 100)}%`, background: used / plan.aiReplies > 0.9 ? 'var(--red)' : used / plan.aiReplies > 0.75 ? 'var(--yellow)' : 'var(--c1)' }} /></div>
          <span className="muted small">Se o limite acabar, as conversas vão para a equipe responder e você recebe um aviso. O contador zera todo mês.</span>
        </div>
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>Planos</h3><div className="sub">Troque quando quiser. O novo plano começa quando terminar o período já pago.</div></div><Segmented label="Ciclo" value={cycle} onChange={setCycle} options={[{ value: 'mensal', label: 'Mensal' }, { value: 'anual', label: 'Anual · 2 meses grátis' }]} /></div>
        <div className="plans">
          {PAID_PLANS.map((p) => {
            const info = PLANS[p]; const isCur = c.plan === p && c.billing_status !== 'trialing';
            return (
              <div key={p} className={cx('plan', info.highlight && 'hl', isCur && 'current')}>
                {info.highlight && <span className="tag"><Badge tone="solid" size="sm">Mais escolhido</Badge></span>}
                <h3>{info.name}</h3>
                <p className="muted small">{info.blurb}</p>
                <div className="price"><b>{brl(monthlyEquivalent(p, cycle)).replace(',00', '')}</b><span>/mês{cycle === 'anual' ? ` · ${brl(planPrice(p, 'anual')).replace(',00', '')} por ano` : ''}</span></div>
                <ul>{info.features.map((x) => <li key={x}><Check />{x}</li>)}</ul>
                <span className="spacer" />
                {isCur ? <Button block disabled>Plano atual</Button> : <Button block variant={info.highlight ? 'solid' : 'default'} disabled={!owner} onClick={() => setPick(p)}>{c.billing_status === 'active' ? 'Trocar para este' : 'Assinar'}</Button>}
              </div>
            );
          })}
        </div>
        {!owner && <p className="muted small" style={{ marginTop: 10 }}><Lock className="ii" /> Só o dono da conta pode mudar a assinatura.</p>}
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>Faturas</h3><div className="sub">Cobranças da assinatura</div></div></div>
        {invoices.length === 0 ? <Empty icon={<Receipt />} title="Nenhuma fatura ainda" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Forma</th><th>Situação</th><th className="num">Valor</th><th /></tr></thead>
            <tbody>{invoices.map((i) => <tr key={i.id}><td>{fmtDate(i.due_date)}</td><td>{i.description}</td><td>{i.method === 'cartao' ? 'Cartão' : i.method === 'boleto' ? 'Boleto' : i.method === 'pix' ? 'Pix' : '—'}</td><td><Badge tone={i.status === 'paga' ? 'green' : i.status === 'vencida' ? 'red' : i.status === 'pendente' ? 'yellow' : undefined} size="sm">{i.status}</Badge></td><td className="num"><b>{brl(i.amount)}</b></td><td>{i.url && <a className="link small" href={i.url} target="_blank" rel="noreferrer">{i.status === 'paga' ? 'Recibo' : 'Pagar'}</a>}</td></tr>)}</tbody></table></div>
        )}
      </section>
      {owner && c.billing_status === 'active' && !c.complimentary && (
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="danger-soft" onClick={async () => { if (await confirm({ title: 'Cancelar a assinatura?', text: `Você continua com acesso até ${fmtDate(c.current_period_end)}. Depois disso a IA para de responder e o painel fica só para consulta. Seus dados continuam guardados.`, confirm: 'Cancelar assinatura', danger: true })) { try { await api.cancelSubscription(); refresh(); toast('Assinatura cancelada. Você pode voltar quando quiser.'); } catch (e) { toast((e as Error).message, 'err'); } } }}>Cancelar assinatura</Button></div>
      )}
      <Checkout plan={pick} cycle={cycle} onClose={() => setPick(null)} />
    </>
  );
}

function Checkout({ plan, cycle, onClose }: { plan: PaidPlanId | null; cycle: Cycle; onClose: () => void }) {
  const { me, refresh } = useMeCtx();
  const toast = useToast();
  const [method, setMethod] = useState<'cartao' | 'pix_boleto'>('cartao');
  const [doc, setDoc] = useState(me.company.document ?? '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { if (plan) { setDone(null); setBusy(false); } }, [plan]);
  if (!plan) return null;
  const info = PLANS[plan];
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.checkout({ plan, cycle, method, cpfCnpj: doc.replace(/\D/g, '') || undefined });
      if (r.url) { window.location.href = r.url; return; }
      setDone(r.message ?? (r.scheduled ? `Tudo certo! O novo plano começa em ${fmtDate(r.scheduled)}.` : 'Assinatura atualizada.'));
      refresh();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Plano ${info.name}`} subtitle={`${brl(planPrice(plan, cycle))} por ${cycle === 'anual' ? 'ano' : 'mês'}. Pagamento seguro processado pelo Asaas.`}
      footer={done ? <Button variant="solid" onClick={onClose}>Fechar</Button> : <><Button variant="ghost" onClick={onClose}>Voltar</Button><Button variant="solid" loading={busy} onClick={go}>{method === 'cartao' ? 'Ir para o pagamento' : 'Gerar cobrança'}</Button></>}>
      {done ? <div className="callout ok"><Check /><span>{done}</span></div> : (
        <div className="col" style={{ gap: 16 }}>
          <div className="method-pick">
            <button type="button" className={cx(method === 'cartao' && 'on')} onClick={() => setMethod('cartao')}><b><CreditCard />Cartão de crédito</b><span>Renova sozinho. Sem preocupação.</span></button>
            <button type="button" className={cx(method === 'pix_boleto' && 'on')} onClick={() => setMethod('pix_boleto')}><b><QrCode />Pix ou boleto</b><span>A cobrança chega todo {cycle === 'anual' ? 'ano' : 'mês'} com QR Code e boleto.</span></button>
          </div>
          <Field label="CPF ou CNPJ de quem paga" hint={method === 'pix_boleto' ? 'Obrigatório para emitir a cobrança.' : 'Opcional no cartão (a página de pagamento pede os dados).'}><Input value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" /></Field>
          <div className="callout"><CircleAlert /><span>Você pode cancelar quando quiser, sem multa. {cycle === 'anual' ? 'No anual, o valor é cobrado de uma vez e equivale a 10 meses.' : ''}</span></div>
        </div>
      )}
    </Modal>
  );
}

/* ================= conta ================= */
function AccountTab() {
  const { me, refresh } = useMeCtx();
  const toast = useToast();
  const confirm = useConfirm();
  const [theme, setTheme] = useTheme();
  const [name, setName] = useState(me.name);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); } };
  const exportData = () => run('exp', async () => {
    const data = await api.exportAll();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = `combinado-dados-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    toast('Arquivo com seus dados baixado');
  });
  const notifPerm = useMemo(() => ('Notification' in window ? window.Notification.permission : 'denied'), []);
  return (
    <>
      <section className="card set-section">
        <div className="card-head"><div><h3>Seu perfil</h3><div className="sub">{me.email}</div></div></div>
        <div className="form-grid">
          <Field label="Seu nome"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Tema"><Select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}><option value="auto">Automático (do aparelho)</option><option value="light">Claro</option><option value="dark">Escuro</option></Select></Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><Button variant="solid" loading={busy === 'name'} disabled={name.trim() === me.name || name.trim().length < 2} onClick={() => run('name', async () => { await api.updateMember(me.user_id, { name: name.trim() }); refresh(); toast('Nome atualizado'); })}>Salvar nome</Button></div>
      </section>
      {!isDemo && (
        <section className="card set-section">
          <div className="card-head"><div><h3>Senha</h3><div className="sub">Use pelo menos 8 caracteres.</div></div></div>
          <div className="row wrap" style={{ gap: 10 }}><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nova senha" autoComplete="new-password" style={{ maxWidth: 320 }} /><Button loading={busy === 'pw'} disabled={pw.length < 8} onClick={() => run('pw', async () => { await api.updatePassword(pw); setPw(''); toast('Senha alterada'); })}>Alterar senha</Button></div>
        </section>
      )}
      <section className="card set-section">
        <div className="card-head"><div><h3>Avisos no computador</h3><div className="sub">Receba um alerta quando um cliente precisar de você, mesmo com o painel em outra aba.</div></div></div>
        {notifPerm === 'granted' ? <div className="callout ok"><Check /><span>Avisos ativados neste navegador.</span></div> : <Button onClick={() => window.Notification?.requestPermission().then(() => toast('Pronto!'))}>Ativar avisos</Button>}
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>Seus dados</h3><div className="sub">LGPD: você pode baixar ou apagar tudo quando quiser.</div></div></div>
        <div className="row wrap" style={{ gap: 10 }}>
          <Button icon={<Download />} loading={busy === 'exp'} onClick={exportData}>Baixar meus dados</Button>
          {can(me, 'dono') && <Button variant="danger-soft" icon={<Trash2 />} onClick={() => setDelOpen(true)}>Excluir conta e dados</Button>}
        </div>
        {isDemo && <p className="muted small" style={{ marginTop: 10 }}>Na demonstração, excluir apenas restaura os dados de exemplo.</p>}
      </section>
      <section className="card set-section">
        <div className="card-head"><div><h3>Ajuda</h3></div></div>
        <div className="row wrap" style={{ gap: 10 }}><Link className="btn" to="/ajuda"><Sparkles />Perguntas frequentes</Link><a className="btn" href="/termos/" target="_blank" rel="noreferrer">Termos de uso</a><a className="btn" href="/privacidade/" target="_blank" rel="noreferrer">Privacidade</a></div>
      </section>
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Excluir a conta?" size="narrow" footer={<><Button variant="ghost" onClick={() => setDelOpen(false)}>Voltar</Button><Button variant="danger" loading={busy === 'del'} disabled={delText.trim().toUpperCase() !== 'EXCLUIR'} onClick={() => run('del', async () => { if (await confirm({ title: 'Última confirmação', text: 'Tudo será apagado: clientes, conversas, orçamentos, agenda e vendas. A assinatura é cancelada.', confirm: 'Apagar tudo', danger: true })) { await api.deleteAccount(); location.href = '/'; } })}>Excluir definitivamente</Button></>}>
        <p className="muted-2" style={{ fontSize: 14 }}>Isso apaga a empresa {me.company.name}, todos os dados e cancela a assinatura. Baixe seus dados antes, se quiser guardar.</p>
        <Field label='Digite EXCLUIR para confirmar' className="full"><Input value={delText} onChange={(e) => setDelText(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

