// Serviços e preços: a tabela que a IA consulta para responder clientes e montar orçamentos.
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Sparkles, Tag, Trash2 } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { PriceType, Service } from '../data/types';
import { useAssistant } from '../context';
import { Badge, Button, Empty, Field, IconButton, Input, Loader, Modal, MoneyInput, PageHeader, Select, Switch, Textarea, useConfirm, useToast } from '../ui';
import { brl } from '../../shared/format';

const PT_LABEL: Record<PriceType, string> = { fixo: 'Preço fixo', a_partir_de: 'A partir de', sob_consulta: 'Sob consulta' };

export default function Catalog() {
  const { data = [], isLoading } = useList('services', { order: [{ col: 'sort' }, { col: 'name' }] });
  const [edit, setEdit] = useState<Service | 'new' | null>(null);
  const inv = useInvalidate();
  const toast = useToast();
  const assistant = useAssistant();
  const groups = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of data) { const k = s.category || 'Outros'; m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()];
  }, [data]);
  return (
    <>
      <PageHeader title="Serviços e preços" subtitle="A IA usa esta tabela para responder “quanto custa?” e montar orçamentos. Mantenha preços e durações em dia."
        actions={<><Button icon={<Sparkles />} onClick={() => assistant.ask('Muda o preço da limpeza de poltrona para R$ 95')}>Mudar preço pela IA</Button><Button variant="solid" icon={<Plus />} onClick={() => setEdit('new')}>Novo serviço</Button></>} />
      <div className="callout ai" style={{ marginBottom: 18 }}><Sparkles /><span><strong>Como a IA usa isto:</strong> “preço fixo” ela informa direto; “a partir de” ela informa o valor mínimo e explica que pode variar; “sob consulta” ela oferece uma visita ou chama a equipe. A duração define quanto tempo a agenda reserva.</span></div>
      {isLoading ? <Loader /> : data.length === 0 ? <Empty icon={<Tag />} title="Nenhum serviço cadastrado" action={<Button variant="solid" icon={<Plus />} onClick={() => setEdit('new')}>Cadastrar serviço</Button>}>Cadastre o que você vende para a IA conseguir responder preços.</Empty> : groups.map(([cat, list]) => (
        <section key={cat} className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div><h3>{cat}</h3><div className="sub">{list.length} {list.length === 1 ? 'serviço' : 'serviços'}</div></div></div>
          <div className="svc-list">
            {list.map((s) => (
              <div key={s.id} className="svc">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}><b className="truncate">{s.name}</b>{!s.active && <Badge size="sm">pausado</Badge>}</div>
                  {s.description && <div className="muted small truncate">{s.description}</div>}
                </div>
                <div className="svc-meta"><span className="muted small">{s.duration_min} min</span><Badge size="sm">{PT_LABEL[s.price_type]}</Badge></div>
                <b className="svc-price num">{s.price_type === 'sob_consulta' ? '—' : brl(s.price)}</b>
                <Switch checked={s.active} label={s.active ? 'Pausar serviço' : 'Ativar serviço'} onChange={async (v) => { await api.update('services', s.id, { active: v }); inv('services'); toast(v ? 'Serviço ativo: a IA volta a oferecer' : 'Serviço pausado: a IA não oferece mais'); }} />
                <IconButton label="Editar" size="xs" onClick={() => setEdit(s)}><Pencil /></IconButton>
              </div>
            ))}
          </div>
        </section>
      ))}
      <ServiceForm open={!!edit} service={edit === 'new' ? null : edit} count={data.length} onClose={() => setEdit(null)} />
    </>
  );
}

function ServiceForm({ open, service, onClose, count }: { open: boolean; service: Service | null; onClose: () => void; count: number }) {
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState<Partial<Service>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(service ?? { name: '', description: '', price: 0, price_type: 'fixo', duration_min: 60, category: '', active: true }); }, [open, service]);
  const set = (k: keyof Service, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name?.trim()) { toast('Dê um nome ao serviço', 'err'); return; }
    setBusy(true);
    const row = { name: f.name.trim(), description: f.description?.trim() || null, price: Number(f.price ?? 0), price_type: f.price_type, duration_min: Math.max(5, Number(f.duration_min ?? 60)), category: f.category?.trim() || null, active: f.active ?? true };
    try {
      if (service) await api.update('services', service.id, row); else await api.insert('services', { ...row, sort: count + 1 });
      inv('services'); toast(service ? 'Serviço atualizado. A IA já usa o novo valor.' : 'Serviço cadastrado'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={service ? 'Editar serviço' : 'Novo serviço'}
      footer={<>{service && <Button variant="danger-soft" icon={<Trash2 />} onClick={async () => { if (await confirm({ title: `Excluir “${service.name}”?`, text: 'Orçamentos antigos não mudam. Se só quer parar de oferecer, use o botão de pausar.', confirm: 'Excluir', danger: true })) { await api.remove('services', service.id); inv('services'); onClose(); } }}>Excluir</Button>}<span className="spacer" /><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="form-grid">
        <Field label="Nome do serviço" className="full"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Ex.: Limpeza de sofá 3 lugares" /></Field>
        <Field label="Tipo de preço"><Select value={f.price_type} onChange={(e) => set('price_type', e.target.value)}>{(Object.keys(PT_LABEL) as PriceType[]).map((p) => <option key={p} value={p}>{PT_LABEL[p]}</option>)}</Select></Field>
        <Field label="Preço"><MoneyInput value={f.price ?? 0} onChange={(v) => set('price', v)} /></Field>
        <Field label="Duração (minutos)" hint="Quanto tempo a agenda reserva"><Input type="number" min={5} step={5} value={f.duration_min ?? 60} onChange={(e) => set('duration_min', Number(e.target.value))} /></Field>
        <Field label="Categoria" hint="Ex.: Sofás, Colchões"><Input value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} /></Field>
        <Field label="Descrição para a IA usar com o cliente" className="full"><Textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="O que está incluso, cuidados, prazo de secagem..." /></Field>
      </div>
    </Modal>
  );
}
