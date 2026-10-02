// Admin da plataforma (dono do SaaS): empresas, planos, uso e receita recorrente.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Search, ShieldCheck } from 'lucide-react';
import { api, isDemo } from '../data/api';
import { Badge, Empty, Loader, PageHeader, Select, useDebounced } from '../ui';
import { brl0, fmtAgo, fmtDate, fold, num } from '../../shared/format';
import { PLANS, type PlanId } from '../../shared/plans';

const ST: Record<string, ['green' | 'yellow' | 'red' | 'blue' | undefined, string]> = { active: ['green', 'Ativa'], trialing: ['blue', 'Teste'], past_due: ['yellow', 'Atrasada'], canceled: ['red', 'Cancelada'], blocked: ['red', 'Bloqueada'] };

export default function Admin() {
  const { data, isLoading } = useQuery({ queryKey: ['admin'], queryFn: () => api.adminOverview() });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('todas');
  const term = useDebounced(q, 200);
  const rows = useMemo(() => (data?.companies ?? []).filter((c) => (status === 'todas' || c.billing_status === status) && (!term || fold(c.name).includes(fold(term)))), [data, term, status]);
  if (isLoading || !data) return <Loader />;
  const aiTotal = data.companies.reduce((s, c) => s + c.ai_replies_month, 0);
  return (
    <>
      <PageHeader eyebrow={<><ShieldCheck style={{ width: 14 }} /> Só administradores da plataforma veem esta página</>} title="Admin da plataforma" subtitle={isDemo ? 'Exemplo com empresas fictícias. Na sua conta real, aparecem as empresas que assinam o Combinado.' : 'Empresas, planos, uso da IA e receita recorrente.'} />
      <div className="stat-row">
        <div className="stat"><span>Receita recorrente (MRR)</span><b>{brl0(data.mrr)}</b><small>{brl0(data.mrr * 12)} por ano</small></div>
        <div className="stat"><span>Assinaturas ativas</span><b>{num(data.active)}</b><small>pagando hoje</small></div>
        <div className="stat"><span>Em teste grátis</span><b>{num(data.trialing)}</b><small>{data.trialing ? 'converter é a prioridade' : 'nenhum agora'}</small></div>
        <div className="stat"><span>Respostas da IA no mês</span><b>{num(aiTotal)}</b><small>todas as empresas</small></div>
      </div>
      <div className="filters">
        <div className="input-wrap" style={{ flex: '1 1 240px', maxWidth: 360 }}><Search /><input className="input" placeholder="Buscar empresa" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar empresa" /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 200 }} aria-label="Situação"><option value="todas">Todas as situações</option>{Object.entries(ST).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>
      <section className="card">
        {rows.length === 0 ? <Empty icon={<Building2 />} title="Nenhuma empresa" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Empresa</th><th>Plano</th><th>Situação</th><th>WhatsApp</th><th className="num">Equipe</th><th className="num">IA no mês</th><th>Último uso</th><th>Desde</th><th className="num">MRR</th></tr></thead>
            <tbody>{rows.map((c) => {
              const limit = PLANS[(c.plan as PlanId) ?? 'teste']?.aiReplies ?? 100;
              const [tone, label] = ST[c.billing_status] ?? [undefined, c.billing_status];
              return (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td>{PLANS[c.plan as PlanId]?.name ?? c.plan}</td>
                  <td><Badge tone={tone} size="sm" dot>{label}</Badge></td>
                  <td>{c.whatsapp ? <Badge tone="green" size="sm">conectado</Badge> : <span className="muted">—</span>}</td>
                  <td className="num">{c.members}</td>
                  <td className="num"><span style={{ color: c.ai_replies_month / limit > 0.9 ? 'var(--red-ink)' : undefined }}>{num(c.ai_replies_month)}</span><span className="muted"> / {num(limit)}</span></td>
                  <td className="muted">{fmtAgo(c.last_activity)}</td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                  <td className="num"><b>{c.mrr ? brl0(c.mrr) : '—'}</b></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
