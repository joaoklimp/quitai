// Procedimentos e valores: a tabela que a IA consulta para responder pacientes, marcar consultas e montar orçamentos.
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Sparkles, Tag, Trash2 } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { PriceType, Service } from '../data/types';
import { useAssistant } from '../context';
import { Badge, Button, Empty, Field, IconButton, Input, Loader, Modal, MoneyInput, PageHeader, Select, Switch, Textarea, useConfirm, useToast } from '../ui';
import { brl } from '../../shared/format';

const PT_LABEL: Record<PriceType, string> = { fixo: 'Valor fixo', a_partir_de: 'A partir de', sob_consulta: 'Depende de avaliação' };

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
      <PageHeader title="Procedimentos e valores" subtitle="A IA usa esta tabela para responder “quanto custa?”, marcar a consulta com a duração certa e convidar para o retorno no prazo."
        actions={<><Button icon={<Sparkles />} onClick={() => assistant.ask('Muda o valor da limpeza para R$ 240')}>Mudar valor pela IA</Button><Button variant="solid" icon={<Plus />} onClick={() => setEdit('new')}>Novo procedimento</Button></>} />
      <div className="callout ai" style={{ marginBottom: 18 }}><Sparkles /><span><strong>Como a IA usa isto:</strong> “valor fixo” ela informa direto; “a partir de” ela informa o valor mínimo e explica que depende da avaliação; “depende de avaliação” ela oferece marcar a avaliação. A duração define quanto tempo a agenda reserva, e o retorno define quando a IA convida o paciente a voltar.</span></div>
      {isLoading ? <Loader /> : data.length === 0 ? <Empty icon={<Tag />} title="Nenhum procedimento cadastrado" action={<Button variant="solid" icon={<Plus />} onClick={() => setEdit('new')}>Cadastrar procedimento</Button>}>Cadastre os procedimentos para a IA conseguir responder valores e marcar consultas.</Empty> : groups.map(([cat, list]) => (
        <section key={cat} className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div><h3>{cat}</h3><div className="sub">{list.length} {list.length === 1 ? 'procedimento' : 'procedimentos'}</div></div></div>
          <div className="svc-list">
            {list.map((s) => (
              <div key={s.id} className="svc">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}><b className="truncate">{s.name}</b>{!s.active && <Badge size="sm">pausado</Badge>}</div>
                  {s.description && <div className="muted small truncate">{s.description}</div>}
                </div>
                <div className="svc-meta"><span className="muted small">{s.duration_min} min</span>{s.return_days ? <Badge size="sm" tone="violet">retorno {s.return_days} d</Badge> : null}<Badge size="sm">{PT_LABEL[s.price_type]}</Badge></div>
                <b className="svc-price num">{s.price_type === 'sob_consulta' ? '—' : brl(s.price)}</b>
                <Switch checked={s.active} label={s.active ? 'Pausar procedimento' : 'Ativar procedimento'} onChange={async (v) => { await api.update('services', s.id, { active: v }); inv('services'); toast(v ? 'Procedimento ativo: a IA volta a oferecer' : 'Procedimento pausado: a IA não oferece mais'); }} />
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
  useEffect(() => { if (open) setF(service ?? { name: '', description: '', price: 0, price_type: 'fixo', duration_min: 30, category: '', active: true, return_days: null }); }, [open, service]);
  const set = (k: keyof Service, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name?.trim()) { toast('Dê um nome ao procedimento', 'err'); return; }
    setBusy(true);
    const row = { name: f.name.trim(), description: f.description?.trim() || null, price: Number(f.price ?? 0), price_type: f.price_type, duration_min: Math.max(5, Number(f.duration_min ?? 60)), category: f.category?.trim() || null, active: f.active ?? true, return_days: Number(f.return_days) > 0 ? Math.min(730, Number(f.return_days)) : null };
    try {
      if (service) await api.update('services', service.id, row); else await api.insert('services', { ...row, sort: count + 1 });
      inv('services'); toast(service ? 'Procedimento atualizado. A IA já usa o novo valor.' : 'Procedimento cadastrado'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={service ? 'Editar procedimento' : 'Novo procedimento'}
      footer={<>{service && <Button variant="danger-soft" icon={<Trash2 />} onClick={async () => { if (await confirm({ title: `Excluir “${service.name}”?`, text: 'Orçamentos e consultas antigas não mudam. Se só quer parar de oferecer, use o botão de pausar.', confirm: 'Excluir', danger: true })) { await api.remove('services', service.id); inv('services'); onClose(); } }}>Excluir</Button>}<span className="spacer" /><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="form-grid">
        <Field label="Nome do procedimento" className="full"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Ex.: Limpeza (profilaxia)" /></Field>
        <Field label="Tipo de valor"><Select value={f.price_type} onChange={(e) => set('price_type', e.target.value)}>{(Object.keys(PT_LABEL) as PriceType[]).map((p) => <option key={p} value={p}>{PT_LABEL[p]}</option>)}</Select></Field>
        <Field label="Valor particular"><MoneyInput value={f.price ?? 0} onChange={(v) => set('price', v)} /></Field>
        <Field label="Duração (minutos)" hint="Quanto tempo a agenda reserva"><Input type="number" min={5} step={5} value={f.duration_min ?? 60} onChange={(e) => set('duration_min', Number(e.target.value))} /></Field>
        <Field label="Categoria" hint="Ex.: Consultas, Prevenção"><Input value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} /></Field>
        <Field label="Retorno em (dias)" hint="Vazio = sem retorno. A IA convida o paciente nesse prazo."><Input type="number" min={0} max={730} value={f.return_days ?? ''} onChange={(e) => set('return_days', e.target.value ? Number(e.target.value) : null)} placeholder="Ex.: 180" /></Field>
        <Field label="Descrição para a IA usar com o paciente" className="full"><Textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="O que está incluso, preparo, quantas sessões... (sem orientação clínica)" /></Field>
      </div>
    </Modal>
  );
}
