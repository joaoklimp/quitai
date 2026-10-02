// Serviços de exemplo por segmento, usados na primeira configuração (mesma lista da função onboard_company no banco).
export interface PresetService { name: string; price: number; price_type: 'fixo' | 'a_partir_de' | 'sob_consulta'; duration_min: number; category: string }

export const PRESETS: Record<string, PresetService[]> = {
  limpeza: [
    { name: 'Limpeza de sofá 3 lugares', price: 180, price_type: 'a_partir_de', duration_min: 120, category: 'Sofás' },
    { name: 'Limpeza de sofá 2 lugares', price: 150, price_type: 'fixo', duration_min: 90, category: 'Sofás' },
    { name: 'Higienização de colchão casal', price: 160, price_type: 'fixo', duration_min: 60, category: 'Colchões' },
    { name: 'Limpeza de tapete (por m²)', price: 25, price_type: 'a_partir_de', duration_min: 60, category: 'Tapetes' },
    { name: 'Impermeabilização de sofá', price: 290, price_type: 'a_partir_de', duration_min: 120, category: 'Sofás' },
  ],
  beleza: [
    { name: 'Corte feminino', price: 80, price_type: 'a_partir_de', duration_min: 60, category: 'Cabelo' },
    { name: 'Escova', price: 60, price_type: 'a_partir_de', duration_min: 45, category: 'Cabelo' },
    { name: 'Manicure e pedicure', price: 70, price_type: 'fixo', duration_min: 90, category: 'Unhas' },
    { name: 'Design de sobrancelha', price: 45, price_type: 'fixo', duration_min: 30, category: 'Rosto' },
    { name: 'Limpeza de pele', price: 150, price_type: 'fixo', duration_min: 60, category: 'Estética' },
  ],
  oficina: [
    { name: 'Troca de óleo e filtro', price: 180, price_type: 'a_partir_de', duration_min: 60, category: 'Manutenção' },
    { name: 'Alinhamento e balanceamento', price: 120, price_type: 'fixo', duration_min: 60, category: 'Rodas' },
    { name: 'Revisão completa', price: 450, price_type: 'a_partir_de', duration_min: 240, category: 'Manutenção' },
    { name: 'Diagnóstico eletrônico', price: 100, price_type: 'fixo', duration_min: 45, category: 'Diagnóstico' },
    { name: 'Funilaria e pintura', price: 0, price_type: 'sob_consulta', duration_min: 60, category: 'Lataria' },
  ],
  assistencia: [
    { name: 'Troca de tela de celular', price: 250, price_type: 'a_partir_de', duration_min: 90, category: 'Celulares' },
    { name: 'Troca de bateria', price: 150, price_type: 'a_partir_de', duration_min: 60, category: 'Celulares' },
    { name: 'Formatação de computador', price: 120, price_type: 'fixo', duration_min: 120, category: 'Computadores' },
    { name: 'Orçamento técnico', price: 0, price_type: 'sob_consulta', duration_min: 30, category: 'Geral' },
  ],
  saude: [
    { name: 'Consulta', price: 250, price_type: 'fixo', duration_min: 50, category: 'Consultas' },
    { name: 'Retorno', price: 0, price_type: 'fixo', duration_min: 30, category: 'Consultas' },
    { name: 'Avaliação inicial', price: 150, price_type: 'fixo', duration_min: 40, category: 'Avaliações' },
    { name: 'Sessão de fisioterapia', price: 120, price_type: 'fixo', duration_min: 50, category: 'Sessões' },
  ],
  pet: [
    { name: 'Banho (porte pequeno)', price: 60, price_type: 'fixo', duration_min: 60, category: 'Banho' },
    { name: 'Banho e tosa (porte médio)', price: 110, price_type: 'a_partir_de', duration_min: 90, category: 'Tosa' },
    { name: 'Tosa higiênica', price: 45, price_type: 'fixo', duration_min: 30, category: 'Tosa' },
    { name: 'Consulta veterinária', price: 180, price_type: 'fixo', duration_min: 40, category: 'Veterinária' },
  ],
  reformas: [
    { name: 'Visita técnica', price: 0, price_type: 'sob_consulta', duration_min: 60, category: 'Visitas' },
    { name: 'Pintura (por m²)', price: 35, price_type: 'a_partir_de', duration_min: 240, category: 'Pintura' },
    { name: 'Instalação elétrica (ponto)', price: 90, price_type: 'a_partir_de', duration_min: 60, category: 'Elétrica' },
    { name: 'Reparo hidráulico', price: 150, price_type: 'a_partir_de', duration_min: 90, category: 'Hidráulica' },
  ],
  eventos: [
    { name: 'Buffet por pessoa', price: 85, price_type: 'a_partir_de', duration_min: 300, category: 'Buffet' },
    { name: 'Decoração', price: 0, price_type: 'sob_consulta', duration_min: 120, category: 'Decoração' },
    { name: 'Visita para degustação', price: 0, price_type: 'fixo', duration_min: 60, category: 'Atendimento' },
  ],
  educacao: [
    { name: 'Aula avulsa', price: 90, price_type: 'fixo', duration_min: 60, category: 'Aulas' },
    { name: 'Pacote mensal (4 aulas)', price: 320, price_type: 'fixo', duration_min: 60, category: 'Pacotes' },
    { name: 'Aula experimental', price: 0, price_type: 'fixo', duration_min: 45, category: 'Aulas' },
  ],
  outro: [
    { name: 'Atendimento', price: 100, price_type: 'a_partir_de', duration_min: 60, category: 'Serviços' },
    { name: 'Orçamento sob medida', price: 0, price_type: 'sob_consulta', duration_min: 30, category: 'Serviços' },
  ],
};
