// GERADO por scripts/sync-functions.mjs a partir de src/shared/plans.ts. Não edite aqui: edite o original e rode "npm run sync:functions".
// Planos e limites. Há uma cópia em supabase/functions/_shared/plans.ts (preço e limite valem no servidor).
export type PlanId = 'teste' | 'essencial' | 'profissional' | 'empresa';
export type PaidPlanId = Exclude<PlanId, 'teste'>;
export type Cycle = 'mensal' | 'anual';

export interface PlanInfo {
  id: PlanId;
  name: string;
  monthly: number; // R$ por mês no plano mensal
  yearly: number;  // R$ por ano no plano anual
  aiReplies: number; // respostas da IA por mês
  users: number;
  numbers: number; // números de WhatsApp
  highlight?: boolean;
  blurb: string;
  features: string[];
  automations: boolean; // lembretes, acompanhamento de orçamentos, resumo diário
}

export const TRIAL_DAYS = 7;

export const PLANS: Record<PlanId, PlanInfo> = {
  teste: {
    id: 'teste', name: 'Teste grátis', monthly: 0, yearly: 0, aiReplies: 100, users: 2, numbers: 1, automations: true,
    blurb: `${TRIAL_DAYS} dias com tudo liberado, sem cartão.`,
    features: [],
  },
  essencial: {
    id: 'essencial', name: 'Essencial', monthly: 149, yearly: 1490, aiReplies: 500, users: 2, numbers: 1, automations: false,
    blurb: 'Para quem atende sozinho e quer parar de perder cliente no WhatsApp.',
    features: [
      'IA atendendo no WhatsApp 24h',
      '500 respostas da IA por mês',
      'Agenda, orçamentos e clientes',
      'Comandos do dono pelo WhatsApp',
      'Até 2 pessoas na equipe',
    ],
  },
  profissional: {
    id: 'profissional', name: 'Profissional', monthly: 299, yearly: 2990, aiReplies: 1500, users: 5, numbers: 1, automations: true, highlight: true,
    blurb: 'Para equipes que vendem todo dia e querem tudo no automático.',
    features: [
      'Tudo do Essencial',
      '1.500 respostas da IA por mês',
      'Lembretes de horário e acompanhamento de orçamentos',
      'Resumo diário no seu WhatsApp',
      'Relatórios completos',
      'Até 5 pessoas na equipe',
    ],
  },
  empresa: {
    id: 'empresa', name: 'Empresa', monthly: 699, yearly: 6990, aiReplies: 4000, users: 15, numbers: 1, automations: true,
    blurb: 'Para operações com volume alto e várias pessoas atendendo.',
    features: [
      'Tudo do Profissional',
      '4.000 respostas da IA por mês',
      'Até 15 pessoas na equipe',
      'Reativação de clientes inativos',
      'Implantação assistida e suporte prioritário',
    ],
  },
};

export const PAID_PLANS: PaidPlanId[] = ['essencial', 'profissional', 'empresa'];

export function planPrice(plan: PaidPlanId, cycle: Cycle): number {
  return cycle === 'anual' ? PLANS[plan].yearly : PLANS[plan].monthly;
}
/** Valor por mês equivalente no plano anual. */
export function monthlyEquivalent(plan: PaidPlanId, cycle: Cycle): number {
  return cycle === 'anual' ? Math.round((PLANS[plan].yearly / 12) * 100) / 100 : PLANS[plan].monthly;
}
