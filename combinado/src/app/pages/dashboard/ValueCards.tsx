// "A ORBYTA trabalhou por você" (o valor que o dono vê toda semana) e "Primeiros passos" (a primeira vitória em minutos).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BellRing, CalendarCheck, Check, CircleDollarSign, Clock3, FileText, MessageCircle, Moon, Rocket, Smartphone, Sparkles, Sunset, Tag, X } from 'lucide-react';
import { api } from '../../data/api';
import { useList } from '../../data/hooks';
import { can, useMeCtx } from '../../context';
import { Segmented, cx } from '../../ui';
import { addDays, brl0, fromLocal, num, todayLocal } from '../../../shared/format';
import { fmtMinutes } from '../../../shared/value';

type Range = 'semana' | 'mes';

export function ValueCard() {
  const { me } = useMeCtx();
  const tz = me.company.timezone;
  const today = todayLocal(tz);
  const [range, setRange] = useState<Range>('semana');
  const from = fromLocal(range === 'semana' ? addDays(today, -6) : `${today.slice(0, 7)}-01`, '00:00', tz).toISOString();
  const to = fromLocal(addDays(today, 1), '00:00', tz).toISOString();
  const { data: r } = useQuery({ queryKey: ['value', range, today], queryFn: () => api.valueReport(from, to), staleTime: 60_000 });
  const auto = r ? r.reminders + r.followups + r.reviews_asked + r.reactivations : 0;
  const tiles = r ? [
    { icon: MessageCircle, tone: 'blue', value: num(r.ia_conversations), label: 'pacientes atendidos pela IA', sub: r.after_hours ? `${num(r.after_hours)} respostas fora do horário` : `${num(r.ia_replies)} respostas` },
    { icon: CalendarCheck, tone: 'violet', value: num(r.appointments), label: 'consultas marcadas', sub: r.encaixes ? `${r.encaixes} por encaixe` : 'sem você precisar responder' },
    { icon: FileText, tone: 'orange', value: num(r.quotes), label: 'orçamentos montados', sub: r.quotes_approved ? `${r.quotes_approved} aprovados · ${brl0(r.quotes_approved_value)}` : 'com link para aprovar' },
    { icon: CircleDollarSign, tone: 'green', value: brl0(r.charges_value + r.sales_ia_value), label: 'recebido de consultas da IA', sub: r.charges_paid ? `${r.charges_paid} cobranças pagas` : `${r.sales_ia} vendas fechadas` },
    { icon: BellRing, tone: 'pink', value: num(auto), label: 'lembretes e acompanhamentos', sub: 'enviados sozinhos' },
  ] : [];
  return (
    <section className="card value-card">
      <div className="value-head">
        <div>
          <span className="value-eyebrow"><Sparkles />A ORBYTA trabalhou por você</span>
          <h3>{r ? <><b>{fmtMinutes(r.minutes_saved)}</b> que você não precisou gastar</> : 'Calculando…'}</h3>
          <p className="muted small">Estimativa conservadora do tempo de recepção que a IA economizou (respostas, consultas, confirmações, orçamentos e cobranças) {range === 'semana' ? 'nos últimos 7 dias' : 'neste mês'}.</p>
        </div>
        <Segmented label="Período" value={range} onChange={setRange} options={[{ value: 'semana', label: '7 dias' }, { value: 'mes', label: 'Este mês' }]} />
      </div>
      <div className="value-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="value-tile">
            <span className={cx('value-ic', t.tone)}><t.icon /></span>
            <b>{t.value}</b>
            <span className="vt-label">{t.label}</span>
            <span className="vt-sub">{t.sub}</span>
          </div>
        ))}
      </div>
      {r && r.after_hours > 0 && <p className="value-note"><Moon />{num(r.after_hours)} {r.after_hours === 1 ? 'resposta foi dada' : 'respostas foram dadas'} enquanto a empresa estava fechada: paciente que antes esperava até o dia seguinte.</p>}
    </section>
  );
}

const DISMISS = (cid: string) => `orbyta-primeiros-passos-${cid}`;

export function GettingStarted() {
  const { me } = useMeCtx();
  const owner = can(me, 'dono', 'gerente');
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS(me.company.id)) === '1'; } catch { return false; } });
  const { data: sim = [] } = useList('conversations', { filters: [{ col: 'channel', op: 'eq', value: 'simulador' }], limit: 1 }, { enabled: !hidden });
  const { data: services = [] } = useList('services', { limit: 1 }, { enabled: !hidden });
  const { data: autos = [] } = useList('automations', { filters: [{ col: 'kind', op: 'eq', value: 'resumo_diario' }] }, { enabled: !hidden });
  const { data: mine = [] } = useList('members', { filters: [{ col: 'user_id', op: 'eq', value: me.user_id }] }, { enabled: !hidden });
  const { data: wa } = useQuery({ queryKey: ['wa'], queryFn: () => api.whatsapp(), enabled: !hidden && owner });
  if (hidden || !owner) return null;
  const steps = [
    { done: services.length > 0, icon: Tag, title: 'Confira procedimentos, valores e convênios', text: 'A IA só responde com o que estiver aqui.', to: '/catalogo', cta: 'Abrir tabela' },
    { done: sim.length > 0, icon: Sparkles, title: 'Teste a IA como se fosse um paciente', text: 'Pergunte preço, peça um horário, mande um “oi”.', to: '/simulador', cta: 'Abrir simulador' },
    { done: wa?.status === 'conectado', icon: MessageCircle, title: 'Conecte o WhatsApp da clínica', text: 'A partir daí a IA atende de verdade, 24 horas.', to: '/configuracoes/whatsapp', cta: 'Conectar' },
    { done: !!mine[0]?.phone_verified_at, icon: Smartphone, title: 'Verifique o seu número', text: 'Para mandar pedidos e áudios para a IA pelo seu WhatsApp.', to: '/configuracoes/whatsapp', cta: 'Verificar' },
    { done: autos[0]?.enabled === true, icon: Sunset, title: 'Ligue o resumo do dia', text: 'Todo dia: o que entrou, contas que vencem e quem não confirmou amanhã.', to: '/automacoes', cta: 'Ligar' },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const close = () => { try { localStorage.setItem(DISMISS(me.company.id), '1'); } catch { /* ignora */ } setHidden(true); };
  return (
    <section className="card starter">
      <div className="starter-head">
        <span className="starter-ic"><Rocket /></span>
        <div className="grow">
          <h3>Primeiros passos</h3>
          <p className="muted small">Em poucos minutos a ORBYTA já trabalha por você. {done} de {steps.length} feitos.</p>
          <div className="starter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        </div>
        <button className="icon-btn xs" aria-label="Esconder primeiros passos" onClick={close}><X /></button>
      </div>
      <ol className="starter-steps">
        {steps.map((s) => (
          <li key={s.title} className={cx(s.done && 'done')}>
            <span className="st-ic">{s.done ? <Check /> : <s.icon />}</span>
            <span className="grow"><b>{s.title}</b><span className="muted small">{s.text}</span></span>
            {!s.done && <Link className="btn sm" to={s.to}>{s.cta}</Link>}
          </li>
        ))}
      </ol>
      <p className="tiny muted" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}><Clock3 style={{ width: 13 }} />Leva uns 10 minutos. Dá para fechar este quadro e voltar depois em Ajuda.</p>
    </section>
  );
}
