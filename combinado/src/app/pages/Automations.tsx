// Automações: o que a IA faz sozinha, no horário certo, sem ninguém lembrar.
import { AlarmClock, BellRing, CalendarClock, CalendarHeart, Lock, MessageSquareText, RefreshCcw, Send, Star, Sunset, TrendingUp, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Automation, AutomationKind } from '../data/types';
import { useMeCtx, can } from '../context';
import { Badge, Empty, Input, Loader, PageHeader, Select, Switch, cx, useToast } from '../ui';
import { fmtAgo, fmtDateTime } from '../../shared/format';
import { PLANS } from '../../shared/plans';

type Opt = { key: string; label: string; type: 'select' | 'bool' | 'time' | 'text'; options?: [number | string, string][] };
const META: Record<AutomationKind, { title: string; desc: string; icon: typeof BellRing; bg: string; fg: string; opts: Opt[]; needs: 'all' | 'automations'; example: string }> = {
  lembrete_agendamento: { title: 'Lembrete e confirmação de consulta', desc: 'Lembra o paciente pelo WhatsApp antes da consulta e pede para confirmar presença. Quem não pode vir já remarca ali mesmo, e o horário vai para a lista de espera. É o que mais reduz faltas.', icon: BellRing, bg: 'var(--blue-soft)', fg: 'var(--blue-ink)', needs: 'all',
    opts: [{ key: 'horas_antes', label: 'Enviar', type: 'select', options: [[2, '2 horas antes'], [12, '12 horas antes'], [24, '1 dia antes'], [48, '2 dias antes']] }, { key: 'pedir_confirmacao', label: 'Pedir confirmação', type: 'bool' }],
    example: 'Olá, Juliana! Lembrete da sua consulta de limpeza com a Dra. Marina amanhã, às 14:00. Pode confirmar sua presença respondendo SIM? Se não puder vir, me avise que eu remarco.' },
  followup_orcamento: { title: 'Acompanhamento de orçamento', desc: 'Quando o paciente não responde um orçamento de tratamento, a IA manda uma mensagem gentil para retomar a conversa.', icon: Send, bg: 'var(--orange-soft)', fg: 'var(--orange-ink)', needs: 'automations',
    opts: [{ key: 'dias_depois', label: 'Depois de', type: 'select', options: [[1, '1 dia'], [2, '2 dias'], [3, '3 dias'], [5, '5 dias']] }, { key: 'max_tentativas', label: 'Tentativas', type: 'select', options: [[1, '1 vez'], [2, '2 vezes'], [3, '3 vezes']] }],
    example: 'Oi, Ricardo! Tudo bem? Seu orçamento nº 0412 do clareamento (R$ 1.200,00) ainda está disponível. Quer que eu reserve um horário?' },
  resumo_diario: { title: 'Resumo do dia no seu WhatsApp', desc: 'Todo dia, no horário que você escolher: o que entrou, orçamentos esperando, contas que vencem, quem precisa de resposta e a agenda de amanhã, com quem ainda não confirmou.', icon: Sunset, bg: 'var(--violet-soft)', fg: 'var(--violet-ink)', needs: 'all',
    opts: [{ key: 'horario', label: 'Horário', type: 'time' }, { key: 'incluir_agenda', label: 'Incluir agenda de amanhã', type: 'bool' }],
    example: 'Resumo de hoje: R$ 4.380 recebidos, 3 orçamentos esperando aprovação, a conta de luz vence amanhã. Amanhã: 18 consultas, 3 sem confirmar.' },
  pos_atendimento: { title: 'Pós-consulta e avaliação', desc: 'Depois da consulta, agradece o paciente e pede uma avaliação no Google.', icon: Star, bg: 'var(--green-soft)', fg: 'var(--green-ink)', needs: 'automations',
    opts: [{ key: 'horas_depois', label: 'Enviar', type: 'select', options: [[1, '1 hora depois'], [3, '3 horas depois'], [24, '1 dia depois']] }, { key: 'pedir_avaliacao', label: 'Pedir avaliação', type: 'bool' }, { key: 'link_avaliacao', label: 'Link da avaliação', type: 'text' }],
    example: 'Obrigada pela confiança, Aline! 💙 Se puder, deixe uma avaliação pra gente: g.page/vidaplena' },
  reativacao: { title: 'Reativação de pacientes', desc: 'Pacientes que não voltam há muito tempo recebem um convite para marcar uma consulta.', icon: RefreshCcw, bg: 'var(--pink-soft)', fg: 'var(--pink)', needs: 'automations',
    opts: [{ key: 'dias_sem_compra', label: 'Sem vir há', type: 'select', options: [[90, '90 dias'], [180, '6 meses'], [210, '7 meses'], [365, '1 ano']] }, { key: 'desconto_pct', label: 'Desconto', type: 'select', options: [[0, 'sem desconto'], [5, '5%'], [10, '10%'], [15, '15%']] }],
    example: 'Oi, Paulo! Faz tempo que não te vemos na Vida Plena. Quando quiser marcar uma consulta, é só responder aqui.' },
  retorno: { title: 'Retorno automático', desc: 'No prazo de retorno de cada procedimento (ex.: limpeza a cada 6 meses, manutenção do aparelho todo mês), a IA convida o paciente a marcar. Só vai para quem ainda não marcou.', icon: CalendarHeart, bg: 'var(--violet-soft)', fg: 'var(--violet-ink)', needs: 'all',
    opts: [{ key: 'horario', label: 'Enviar a partir de', type: 'time' }],
    example: 'Olá, Mariana! Está chegando a hora do seu retorno de limpeza na Vida Plena. Quer que eu veja um horário para você? É só responder por aqui.' },
  lembrete_tarefa: { title: 'Lembretes das suas tarefas', desc: 'Você recebe no WhatsApp os lembretes que pediu para a IA (“me lembra de…”).', icon: AlarmClock, bg: 'var(--yellow-soft)', fg: 'var(--yellow-ink)', needs: 'all',
    opts: [{ key: 'minutos_antes', label: 'Avisar', type: 'select', options: [[0, 'na hora'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 hora antes']] }],
    example: 'Lembrete: enviar as guias do Amil Dental às 10h.' },
  relatorio_semanal: { title: 'Relatório da semana', desc: 'Toda semana, no seu WhatsApp e no painel: quantos pacientes a IA atendeu, consultas marcadas, confirmações, orçamentos, o que entrou e o tempo que a recepção economizou.', icon: TrendingUp, bg: 'var(--green-soft)', fg: 'var(--green-ink)', needs: 'all',
    opts: [{ key: 'dia', label: 'Dia', type: 'select', options: [[1, 'segunda-feira'], [2, 'terça-feira'], [3, 'quarta-feira'], [4, 'quinta-feira'], [5, 'sexta-feira'], [6, 'sábado'], [0, 'domingo']] }, { key: 'horario', label: 'Horário', type: 'time' }],
    example: 'Sua semana com a ORBYTA: atendi 86 pacientes (31 fora do horário), marquei 42 consultas, 9 encaixes, e as faltas caíram para 4%. Tempo que a recepção economizou: 9h 20min.' },
  encaixe: { title: 'Encaixe automático', desc: 'Quando um paciente desmarca, a IA oferece o horário para quem está na lista de espera. Cadeira vazia vira consulta.', icon: CalendarClock, bg: 'var(--blue-soft)', fg: 'var(--blue-ink)', needs: 'automations',
    opts: [{ key: 'antecedencia_horas', label: 'Só se faltar pelo menos', type: 'select', options: [[1, '1 hora'], [2, '2 horas'], [4, '4 horas'], [12, '12 horas']] }],
    example: 'Olá, Fernanda! Boa notícia: abriu um horário amanhã às 15h para limpeza com a Dra. Marina. Quer ficar com ele? É só responder SIM.' },
};
const ORDER: AutomationKind[] = ['lembrete_agendamento', 'encaixe', 'retorno', 'resumo_diario', 'relatorio_semanal', 'followup_orcamento', 'pos_atendimento', 'reativacao', 'lembrete_tarefa'];

export default function Automations() {
  const { me } = useMeCtx();
  const { data = [], isLoading } = useList('automations');
  const { data: runs = [] } = useList('automation_runs', { order: [{ col: 'ran_at', asc: false }], limit: 30 });
  const plan = PLANS[me.company.plan];
  const allowed = (k: AutomationKind) => META[k].needs === 'all' || me.company.plan === 'teste' || plan.automations;
  const byKind = new Map(data.map((a) => [a.kind, a]));
  return (
    <>
      <PageHeader title="Automações" subtitle="Mensagens que saem sozinhas, na hora certa. Você liga, ajusta e acompanha tudo por aqui." />
      <div className="callout" style={{ marginBottom: 18 }}><MessageSquareText /><span>Para falar com o paciente depois de 24 horas sem conversa, o WhatsApp exige <strong>modelos de mensagem aprovados</strong>. A ORBYTA usa os modelos indicados em cada automação. É só cadastrar uma vez: veja o passo a passo em <Link className="link" to="/configuracoes/whatsapp">Configurações → WhatsApp</Link>.</span></div>
      {isLoading ? <Loader /> : (
        <div className="auto-grid">
          {ORDER.map((k) => <AutoCard key={k} kind={k} a={byKind.get(k)} allowed={allowed(k)} canEdit={can(me, 'dono', 'gerente')} runs={runs.filter((r) => r.kind === k).length} />)}
        </div>
      )}
      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-head"><div><h3>Execuções recentes</h3><div className="sub">O que as automações enviaram</div></div></div>
        {runs.length === 0 ? <Empty icon={<Workflow />} title="Nada enviado ainda" /> : (
          <div className="runs">
            {runs.map((r) => {
              const M = META[r.kind];
              return (
                <div key={r.id} className="run">
                  <span className="auto-ic" style={{ width: 34, height: 34, borderRadius: 12, background: M.bg, color: M.fg }}><M.icon style={{ width: 16, height: 16 }} /></span>
                  <div className="grow" style={{ minWidth: 0 }}><b className="truncate" style={{ display: 'block' }}>{M.title} · {r.target_label}</b><span className="muted small">{r.detail ?? ''}</span></div>
                  <span className="muted small nowrap">{fmtDateTime(r.ran_at)}</span>
                  <Badge tone={r.status === 'enviado' ? 'green' : r.status === 'falhou' ? 'red' : undefined} size="sm">{r.status}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function AutoCard({ kind, a, allowed, canEdit, runs }: { kind: AutomationKind; a?: Automation; allowed: boolean; canEdit: boolean; runs: number }) {
  const M = META[kind];
  const inv = useInvalidate();
  const toast = useToast();
  const save = async (patch: Partial<Automation>) => {
    if (!a) return;
    await api.update('automations', a.id, patch);
    inv('automations');
  };
  const cfg = a?.config ?? {};
  const setCfg = (k: string, v: string | number | boolean) => save({ config: { ...cfg, [k]: v } });
  const on = !!a?.enabled && allowed;
  return (
    <section className={cx('card auto', !on && 'off')}>
      <div className="auto-top">
        <span className="auto-ic" style={{ background: M.bg, color: M.fg }}><M.icon /></span>
        <div className="grow"><h3>{M.title}</h3><p>{M.desc}</p></div>
        <Switch checked={on} disabled={!allowed || !canEdit || !a} label={on ? `Desligar ${M.title}` : `Ligar ${M.title}`} onChange={async (v) => { await save({ enabled: v }); toast(v ? `${M.title}: ligado` : `${M.title}: desligado`); }} />
      </div>
      {!allowed ? (
        <div className="lock"><Lock />Disponível a partir do plano Profissional. <Link className="link" to="/configuracoes/assinatura">Ver planos</Link></div>
      ) : (
        <div className="auto-cfg">
          {M.opts.map((o) => (
            <label key={o.key} className="row" style={{ gap: 8 }}>
              {o.type === 'bool' ? <><input type="checkbox" checked={!!cfg[o.key]} disabled={!canEdit} onChange={(e) => setCfg(o.key, e.target.checked)} />{o.label}</>
                : <>{o.label}{o.type === 'select' ? <Select value={String(cfg[o.key] ?? o.options?.[0][0])} disabled={!canEdit} onChange={(e) => setCfg(o.key, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}>{o.options!.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}</Select>
                  : <Input type={o.type === 'time' ? 'time' : 'text'} defaultValue={String(cfg[o.key] ?? '')} disabled={!canEdit} onBlur={(e) => { if (e.target.value !== String(cfg[o.key] ?? '')) void setCfg(o.key, e.target.value); }} style={{ width: o.type === 'text' ? 180 : 110 }} />}</>}
            </label>
          ))}
        </div>
      )}
      <details>
        <summary className="muted small" style={{ cursor: 'pointer' }}>Ver exemplo de mensagem</summary>
        <div className="msg out" style={{ marginTop: 10, maxWidth: '100%' }}><div className="bubble" style={{ background: 'var(--surface-2)' }}>{M.example}</div></div>
      </details>
      <div className="auto-foot">
        {a?.template_name && <span>Modelo do WhatsApp: <code>{a.template_name}</code></span>}
        <span className="spacer" />
        <span>{runs} envios recentes</span>
        {a?.last_run_at && <span>· último {fmtAgo(a.last_run_at)}</span>}
      </div>
    </section>
  );
}
