// Integrações: o que já conecta hoje e o que vem a seguir (sem prometer o que ainda não existe).
import { Link } from 'react-router-dom';
import { CalendarDays, Check, Clock, FileSpreadsheet, Landmark, MessageCircle, Plug, ReceiptText, Server, Webhook } from 'lucide-react';
import type { ReactNode } from 'react';
import { BRAND } from '../../shared/brand';
import { Badge, PageHeader } from '../ui';

interface Item { id: string; name: string; what: string; icon: ReactNode; status: 'ativo' | 'em_breve'; action?: ReactNode; partners?: string }

const GROUPS: { title: string; sub: string; items: Item[] }[] = [
  {
    title: 'Conectado hoje', sub: 'Funciona agora, sem custo extra',
    items: [
      { id: 'whatsapp', name: 'WhatsApp (API oficial da Meta)', what: 'A IA atende os clientes e recebe os comandos da equipe pelo número da empresa.', icon: <MessageCircle />, status: 'ativo', action: <Link className="btn sm" to="/configuracoes/whatsapp">Configurar</Link> },
      { id: 'planilhas', name: 'Planilhas (Excel e CSV)', what: 'Importe produtos para o estoque e exporte clientes, vendas, financeiro e estoque para o Excel.', icon: <FileSpreadsheet />, status: 'ativo', action: <Link className="btn sm" to="/estoque">Importar estoque</Link> },
    ],
  },
  {
    title: 'Próximas integrações', sub: 'Em desenvolvimento. Diga qual você quer primeiro e ela sobe na fila.',
    items: [
      { id: 'fiscal', name: 'Emissão de nota fiscal', what: 'Emitir NFS-e e NF-e direto da venda ou pelo WhatsApp (“emite a nota da Juliana”).', icon: <ReceiptText />, status: 'em_breve', partners: 'Focus NFe, NFE.io ou eNotas' },
      { id: 'cobranca', name: 'Cobrança dos seus clientes', what: 'Gerar Pix e boleto para o cliente na própria conversa e dar baixa sozinho quando ele pagar.', icon: <Landmark />, status: 'em_breve', partners: 'Asaas e Mercado Pago' },
      { id: 'erp', name: 'ERP', what: 'Sincronizar clientes, produtos, estoque e pedidos com o sistema que você já usa.', icon: <Server />, status: 'em_breve', partners: 'Bling, Tiny (Olist) e Omie' },
      { id: 'agenda', name: 'Google Agenda', what: 'Os horários marcados pela IA aparecem na agenda do celular da equipe.', icon: <CalendarDays />, status: 'em_breve' },
      { id: 'api', name: 'API e webhooks', what: 'Avisos automáticos para outros sistemas quando entra cliente, venda ou orçamento.', icon: <Webhook />, status: 'em_breve' },
    ],
  },
];

export default function Integrations() {
  return (
    <>
      <PageHeader title="Integrações" subtitle={`Conecte o ${BRAND.name} às ferramentas que a sua empresa já usa.`} />
      {GROUPS.map((g) => (
        <section key={g.title} style={{ marginBottom: 22 }}>
          <div className="section-title"><h3>{g.title}</h3><span className="muted small">{g.sub}</span></div>
          <div className="integ-grid">
            {g.items.map((i) => (
              <article key={i.id} className="card integ">
                <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <span className="integ-ic">{i.icon}</span>
                  <div className="grow">
                    <div className="row between" style={{ gap: 8 }}><b>{i.name}</b>{i.status === 'ativo' ? <Badge size="sm" tone="green" icon={<Check />}>Ativo</Badge> : <Badge size="sm" icon={<Clock />}>Em breve</Badge>}</div>
                    <p className="muted small" style={{ margin: '6px 0 0' }}>{i.what}</p>
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
    </>
  );
}
