// Admin da plataforma (dono da ORBYTA): clínicas assinantes, planos, teste grátis, receita e ações sobre a assinatura.
// Mostra só cadastro, assinatura e números de uso — pacientes, conversas e valores de cada clínica ficam só com ela.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, Gift, History, LockOpen, Mail, MessageCircle, Search, ShieldCheck, TimerReset } from 'lucide-react';
import { api, isDemo } from '../data/api';
import type { AdminAction, AdminCompanyRow } from '../data/source';
import { Badge, Button, Drawer, Empty, Field, Loader, PageHeader, Select, Switch, Textarea, useConfirm, useDebounced, useToast } from '../ui';
import { brl, brl0, fmtAgo, fmtDate, fmtDateTime, fold, num, timeLeftLabel } from '../../shared/format';
import { PLANS, type PlanId } from '../../shared/plans';
import { SPECIALTIES } from '../../shared/presets';

type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'violet' | undefined;
const ST: Record<string, [Tone, string]> = { active: ['green', 'Ativa'], trialing: ['blue', 'Teste grátis'], past_due: ['yellow', 'Atrasada'], canceled: ['red', 'Cancelada'], blocked: ['red', 'Bloqueada'] };
const SPEC = Object.fromEntries(SPECIALTIES) as Record<string, string>;
const FILTERS: [string, string][] = [['todas', 'Todas as clínicas'], ['active', 'Ativas'], ['trialing', 'Em teste grátis'], ['acabando', 'Teste acabando (2 dias)'], ['past_due', 'Atrasadas'], ['cortesia', 'Cortesia'], ['canceled', 'Canceladas'], ['blocked', 'Bloqueadas']];

const trialLive = (c: AdminCompanyRow) => c.billing_status === 'trialing' && new Date(c.trial_ends_at) > new Date();
const trialEnding = (c: AdminCompanyRow) => trialLive(c) && +new Date(c.trial_ends_at) - Date.now() <= 2 * 86400000;
const waLink = (phone: string | null) => (phone ? `https://wa.me/55${phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')}` : null);

function StatusBadges({ c }: { c: AdminCompanyRow }) {
  const [tone, label] = c.billing_status === 'trialing' && !trialLive(c) ? (['red', 'Teste acabou'] as [Tone, string]) : ST[c.billing_status] ?? [undefined, c.billing_status];
  return <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}><Badge tone={tone} size="sm" dot>{label}</Badge>{c.complimentary && <Badge tone="violet" size="sm">Cortesia</Badge>}</span>;
}

function dueLabel(c: AdminCompanyRow) {
  if (c.billing_status === 'trialing') return trialLive(c) ? timeLeftLabel(c.trial_ends_at) : `acabou ${fmtDate(c.trial_ends_at)}`;
  if (c.current_period_end) return `${c.billing_status === 'canceled' ? 'acesso até' : 'renova'} ${fmtDate(c.current_period_end + 'T12:00:00')}`;
  return '—';
}

export default function Admin() {
  const { data, isLoading } = useQuery({ queryKey: ['admin'], queryFn: () => api.adminOverview() });
  const { data: history } = useQuery({ queryKey: ['admin', 'history'], queryFn: () => api.adminHistory() });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('todas');
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounced(q, 200);
  const rows = useMemo(() => (data?.companies ?? []).filter((c) => {
    const okStatus = status === 'todas' ? true : status === 'cortesia' ? c.complimentary : status === 'acabando' ? trialEnding(c) && !c.complimentary : c.billing_status === status;
    const hay = fold(`${c.name} ${c.owner_name} ${c.owner_email} ${c.city ?? ''}`);
    return okStatus && (!term || hay.includes(fold(term)));
  }), [data, term, status]);
  if (isLoading || !data) return <Loader />;
  const open = data.companies.find((c) => c.id === openId) ?? null;
  return (
    <>
      <PageHeader eyebrow={<><ShieldCheck style={{ width: 14 }} /> Só você (dono da ORBYTA) vê esta página</>} title="Admin da plataforma"
        subtitle={isDemo ? 'Exemplo com clínicas fictícias. Na sua conta real, aparecem as clínicas que se cadastram na ORBYTA.' : 'Clínicas cadastradas, assinaturas, teste grátis e receita.'} />
      <div className="stat-row">
        <div className="stat"><span>Receita recorrente (MRR)</span><b>{brl0(data.mrr)}</b><small>{brl0(data.mrr * 12)} por ano</small></div>
        <div className="stat"><span>Recebido no mês</span><b>{brl0(data.received_month)}</b><small>faturas pagas</small></div>
        <div className="stat"><span>Assinantes ativas</span><b>{num(data.active)}</b><small>{data.past_due ? `${data.past_due} com pagamento atrasado` : 'nenhuma atrasada'}</small></div>
        <div className="stat"><span>Em teste grátis</span><b>{num(data.trialing)}</b><small>{data.trial_ending ? `${data.trial_ending} acabando em até 2 dias` : 'converter é a prioridade'}</small></div>
        <div className="stat"><span>Novas no mês</span><b>{num(data.new_month)}</b><small>{data.complimentary ? `${data.complimentary} em cortesia` : 'cadastros este mês'}</small></div>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        <ShieldCheck style={{ width: 13, verticalAlign: -2 }} /> Você vê cadastro, assinatura e quantidades de uso. Pacientes, conversas e valores de cada clínica ficam só com ela (LGPD).
      </p>
      <div className="filters">
        <div className="input-wrap" style={{ flex: '1 1 240px', maxWidth: 360 }}><Search /><input className="input" placeholder="Buscar clínica, responsável, e-mail ou cidade" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar clínica" /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 230 }} aria-label="Situação">{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>
      <section className="card">
        {rows.length === 0 ? <Empty icon={<Building2 />} title="Nenhuma clínica" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Clínica</th><th>Responsável</th><th>Plano</th><th>Situação</th><th>Teste / renovação</th><th>WhatsApp</th><th className="num">IA no mês</th><th>Último uso</th><th className="num">MRR</th></tr></thead>
            <tbody>{rows.map((c) => {
              const limit = PLANS[(c.plan as PlanId) ?? 'teste']?.aiReplies ?? 100;
              return (
                <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(c.id); }}>
                  <td><b>{c.name}</b><div className="muted" style={{ fontSize: 12 }}>{[SPEC[c.segment] ?? c.segment, c.city].filter(Boolean).join(' · ')}</div></td>
                  <td>{c.owner_name || '—'}<div className="muted" style={{ fontSize: 12 }}>{c.owner_email}</div></td>
                  <td>{PLANS[c.plan as PlanId]?.name ?? c.plan}{c.billing_cycle && <div className="muted" style={{ fontSize: 12 }}>{c.billing_cycle}</div>}</td>
                  <td><StatusBadges c={c} /></td>
                  <td className="muted">{dueLabel(c)}</td>
                  <td>{c.whatsapp ? <Badge tone="green" size="sm">conectado</Badge> : <span className="muted">—</span>}</td>
                  <td className="num"><span style={{ color: c.ai_replies_month / limit > 0.9 ? 'var(--red-ink)' : undefined }}>{num(c.ai_replies_month)}</span><span className="muted"> / {num(limit)}</span></td>
                  <td className="muted">{c.last_activity ? fmtAgo(c.last_activity) : 'nunca'}</td>
                  <td className="num"><b>{c.mrr ? brl0(c.mrr) : '—'}</b></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h3 className="row" style={{ gap: 8, fontSize: 16, marginBottom: 10 }}><History style={{ width: 16 }} /> Suas últimas ações</h3>
        {!history?.length ? <p className="muted">Nenhuma ação ainda. Clique numa clínica para dar cortesia, estender o teste, trocar o plano ou bloquear.</p> : (
          <ul className="admin-log">{history.slice(0, 12).map((h) => <li key={h.id}><b>{h.company_name ?? 'Clínica removida'}</b> — {h.detail}<span className="muted"> · {fmtDateTime(h.created_at)}</span></li>)}</ul>
        )}
      </section>
      <CompanyDrawer c={open} onClose={() => setOpenId(null)} />
    </>
  );
}

function CompanyDrawer({ c, onClose }: { c: AdminCompanyRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [days, setDays] = useState('7');
  const [note, setNote] = useState<string | null>(null);
  const { data: history } = useQuery({ queryKey: ['admin', 'history', c?.id], queryFn: () => api.adminHistory(c!.id), enabled: !!c });
  const act = useMutation({
    mutationFn: ({ action, value }: { action: AdminAction; value?: string }) => api.adminAction(c!.id, action, value),
    onSuccess: (r) => { toast(r.detail); setNote(null); void qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  if (!c) return null;
  const paying = ['active', 'past_due'].includes(c.billing_status);
  const wa = waLink(c.owner_phone ?? c.phone);
  const close = () => { setNote(null); onClose(); };
  return (
    <Drawer open onClose={close} title={c.name} wide>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatusBadges c={c} />
        <span className="muted" style={{ fontSize: 13 }}>{[SPEC[c.segment] ?? c.segment, [c.city, c.state].filter(Boolean).join('/')].filter(Boolean).join(' · ')} · cliente desde {fmtDate(c.created_at)}</span>
      </div>

      <div className="admin-grid">
        <div className="admin-box">
          <h4>Responsável</h4>
          <p><b>{c.owner_name || '—'}</b></p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {c.owner_email && <a className="btn sm" href={`mailto:${c.owner_email}`}><Mail /> {c.owner_email}</a>}
            {wa && <a className="btn sm" href={wa} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a>}
          </div>
        </div>
        <div className="admin-box">
          <h4>Assinatura</h4>
          <dl className="admin-dl">
            <dt>Plano</dt><dd>{PLANS[c.plan as PlanId]?.name ?? c.plan}{c.billing_cycle ? ` · ${c.billing_cycle}` : ''}</dd>
            <dt>Pagamento</dt><dd>{c.billing_method === 'cartao' ? 'Cartão' : c.billing_method === 'pix_boleto' ? 'Pix ou boleto' : '—'}</dd>
            <dt>Teste grátis</dt><dd>{c.billing_status === 'trialing' ? dueLabel(c) : `até ${fmtDate(c.trial_ends_at)}`}</dd>
            <dt>Período pago</dt><dd>{c.current_period_end ? `até ${fmtDate(c.current_period_end + 'T12:00:00')}` : '—'}</dd>
            <dt>Já pagou</dt><dd>{brl(c.paid_total)}</dd>
            <dt>MRR</dt><dd>{c.mrr ? brl0(c.mrr) : '—'}</dd>
          </dl>
        </div>
        <div className="admin-box">
          <h4>Uso (só quantidades)</h4>
          <dl className="admin-dl">
            <dt>Equipe no painel</dt><dd>{num(c.members)}</dd>
            <dt>Profissionais</dt><dd>{num(c.professionals)}</dd>
            <dt>Pacientes cadastrados</dt><dd>{num(c.contacts)}</dd>
            <dt>Agendamentos no mês</dt><dd>{num(c.appointments_month)}</dd>
            <dt>Respostas da IA no mês</dt><dd>{num(c.ai_replies_month)} / {num(PLANS[c.plan as PlanId]?.aiReplies ?? 0)}</dd>
            <dt>WhatsApp</dt><dd>{c.whatsapp ? 'conectado' : 'não conectado'}</dd>
            <dt>Último uso</dt><dd>{c.last_activity ? fmtAgo(c.last_activity) : 'nunca'}</dd>
          </dl>
        </div>
      </div>

      <h4 className="admin-h">Ações</h4>
      <div className="admin-actions">
        <div className="admin-act">
          <Gift />
          <div className="grow"><b>Cortesia</b><p className="muted">Acesso completo sem cobrar (parceiros, clínicas piloto, amigos).</p></div>
          <Switch label="Cortesia" checked={c.complimentary} disabled={act.isPending || c.billing_status === 'blocked'} onChange={(v) => act.mutate({ action: 'cortesia', value: v ? 'sim' : 'nao' })} />
        </div>
        <div className="admin-act">
          <TimerReset />
          <div className="grow"><b>Estender teste grátis</b><p className="muted">{paying ? 'Já é assinante; não se aplica.' : 'Conta a partir do fim atual do teste (ou de agora, se já acabou).'}</p></div>
          <Select value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 110 }} aria-label="Dias" disabled={paying}>{['3', '7', '14', '30'].map((d) => <option key={d} value={d}>+{d} dias</option>)}</Select>
          <Button size="sm" disabled={paying || act.isPending} onClick={() => act.mutate({ action: 'estender_teste', value: days })}>Estender</Button>
        </div>
        <div className="admin-act">
          <Building2 />
          <div className="grow"><b>Plano</b><p className="muted">{paying && !c.complimentary ? 'A cobrança segue o plano assinado no Asaas; mude aqui só em casos combinados.' : 'Define os limites (IA, equipe) da clínica.'}</p></div>
          <Select value={c.plan} disabled={act.isPending} aria-label="Plano" style={{ width: 160 }}
            onChange={async (e) => { const v = e.target.value; if (await confirm({ title: `Trocar para o plano ${PLANS[v as PlanId]?.name ?? v}?`, text: 'Os limites da clínica mudam na hora.', confirm: 'Trocar' })) act.mutate({ action: 'plano', value: v }); }}>
            {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="admin-act">
          {c.billing_status === 'blocked' ? <LockOpen /> : <Ban />}
          <div className="grow"><b>{c.billing_status === 'blocked' ? 'Desbloquear acesso' : 'Bloquear acesso'}</b><p className="muted">{c.billing_status === 'blocked' ? 'Volta para a situação da assinatura (ativa, teste ou cancelada).' : 'Para abuso ou fraude: a IA para e o painel fica só para consulta.'}</p></div>
          {c.billing_status === 'blocked'
            ? <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ action: 'desbloquear' })}>Desbloquear</Button>
            : <Button size="sm" variant="danger" disabled={act.isPending} onClick={async () => { if (await confirm({ title: `Bloquear ${c.name}?`, text: 'A IA deixa de responder os pacientes dessa clínica até você desbloquear. Pagamentos não tiram o bloqueio.', confirm: 'Bloquear', danger: true })) act.mutate({ action: 'bloquear' }); }}>Bloquear</Button>}
        </div>
      </div>

      <h4 className="admin-h">Anotação interna</h4>
      <Field hint="Só você vê. Ex.: como conheceu, combinados, próximo contato.">
        <Textarea rows={3} maxLength={2000} value={note ?? c.note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: indicada pelo Dr. Paulo; ligar dia 15 para falar do plano anual." />
      </Field>
      {note !== null && note !== c.note && <Button size="sm" variant="solid" loading={act.isPending} onClick={() => act.mutate({ action: 'nota', value: note })}>Salvar anotação</Button>}

      <h4 className="admin-h">Histórico</h4>
      {!history?.length ? <p className="muted">Nenhuma ação sua nesta clínica ainda.</p> : (
        <ul className="admin-log">{history.map((h) => <li key={h.id}>{h.detail}<span className="muted"> · {fmtDateTime(h.created_at)}</span></li>)}</ul>
      )}
    </Drawer>
  );
}
