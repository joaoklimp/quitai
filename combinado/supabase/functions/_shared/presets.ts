// GERADO por scripts/sync-functions.mjs a partir de src/shared/presets.ts. Não edite aqui: edite o original e rode "npm run sync:functions".
// Especialidades de clínica e procedimentos de exemplo, usados na primeira configuração
// (mesma lista da função segment_presets no banco).
export interface PresetService { name: string; price: number; price_type: 'fixo' | 'a_partir_de' | 'sob_consulta'; duration_min: number; category: string; return_days: number | null }

export type Specialty = 'clinica_medica' | 'odontologia' | 'estetica' | 'fisioterapia' | 'psicologia' | 'nutricao' | 'multidisciplinar';

export const SPECIALTIES: [Specialty, string][] = [
  ['clinica_medica', 'Clínica médica e consultório'],
  ['odontologia', 'Odontologia'],
  ['estetica', 'Estética e dermatologia'],
  ['fisioterapia', 'Fisioterapia e pilates'],
  ['psicologia', 'Psicologia'],
  ['nutricao', 'Nutrição'],
  ['multidisciplinar', 'Clínica multidisciplinar'],
];

export const specialtyLabel = (s: string) => SPECIALTIES.find(([v]) => v === s)?.[1] ?? 'Clínica';

const p = (name: string, price: number, price_type: PresetService['price_type'], duration_min: number, category: string, return_days = 0): PresetService =>
  ({ name, price, price_type, duration_min, category, return_days: return_days || null });

export const PRESETS: Record<Specialty, PresetService[]> = {
  clinica_medica: [p('Consulta', 300, 'fixo', 30, 'Consultas', 30), p('Retorno', 0, 'fixo', 20, 'Consultas'), p('Teleconsulta', 250, 'fixo', 30, 'Consultas', 30), p('Atestado e relatório', 0, 'sob_consulta', 15, 'Documentos')],
  odontologia: [p('Avaliação', 0, 'fixo', 30, 'Avaliações'), p('Limpeza (profilaxia)', 200, 'fixo', 40, 'Prevenção', 180), p('Restauração', 250, 'a_partir_de', 60, 'Tratamentos'), p('Clareamento', 900, 'a_partir_de', 60, 'Estética'), p('Manutenção de aparelho', 180, 'fixo', 30, 'Ortodontia', 30)],
  estetica: [p('Avaliação estética', 0, 'fixo', 30, 'Avaliações'), p('Limpeza de pele', 180, 'fixo', 60, 'Facial', 30), p('Toxina botulínica', 1200, 'a_partir_de', 40, 'Injetáveis', 120), p('Preenchimento', 1500, 'a_partir_de', 60, 'Injetáveis', 180), p('Depilação a laser (sessão)', 250, 'a_partir_de', 30, 'Corporal', 30)],
  fisioterapia: [p('Avaliação fisioterapêutica', 180, 'fixo', 50, 'Avaliações'), p('Sessão de fisioterapia', 130, 'fixo', 50, 'Sessões', 7), p('Pilates (aula)', 90, 'fixo', 50, 'Pilates', 7), p('RPG', 150, 'fixo', 50, 'Sessões', 7)],
  psicologia: [p('Primeira sessão', 200, 'fixo', 50, 'Sessões', 7), p('Sessão de psicoterapia', 180, 'fixo', 50, 'Sessões', 7), p('Sessão online', 170, 'fixo', 50, 'Sessões', 7)],
  nutricao: [p('Consulta nutricional', 280, 'fixo', 60, 'Consultas', 30), p('Retorno', 150, 'fixo', 40, 'Consultas', 30), p('Bioimpedância', 80, 'fixo', 20, 'Exames')],
  multidisciplinar: [p('Consulta', 250, 'fixo', 40, 'Consultas', 30), p('Retorno', 0, 'fixo', 20, 'Consultas'), p('Avaliação inicial', 150, 'fixo', 40, 'Avaliações'), p('Sessão de terapia', 150, 'fixo', 50, 'Sessões', 7)],
};

export const presetsFor = (s: string): PresetService[] => PRESETS[s as Specialty] ?? PRESETS.multidisciplinar;
