// Estoque: produtos, entradas e saídas, alertas de estoque baixo e importação de planilha (CSV ou Excel).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Download, FileSpreadsheet, History as HistoryIcon, Package, Pencil, Plus, Search, SlidersHorizontal, Upload } from 'lucide-react';
import { api } from '../data/api';
import { useInvalidate, useList } from '../data/hooks';
import type { Product, StockKind, StockMovement } from '../data/types';
import { can, useMeCtx } from '../context';
import { Badge, Button, Drawer, Empty, Field, Input, Loader, Modal, MoneyInput, PageHeader, Select, cx, useToast } from '../ui';
import { brl, brl0, fmtDateTime, fold, num } from '../../shared/format';
import { PRODUCT_TEMPLATE, readSheet, toProductRows, type ProductRow } from '../data/sheet';

const KIND_LABEL: Record<StockKind, string> = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' };
const qty = (n: number) => num(Math.round(n * 1000) / 1000);
export const isLow = (p: Product) => p.min_stock > 0 && p.stock <= p.min_stock;

export default function Stock() {
  const { me } = useMeCtx();
  const manager = can(me, 'dono', 'gerente');
  const [term, setTerm] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [edit, setEdit] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [move, setMove] = useState<{ product: Product; kind: StockKind } | null>(null);
  const [hist, setHist] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const { data: products = [], isLoading } = useList('products', { order: [{ col: 'name', asc: true }], limit: 3000 });
  const { data: recent = [] } = useList('stock_movements', { order: [{ col: 'created_at', asc: false }], limit: 300 });
  const active = products.filter((p) => p.active);
  const low = active.filter(isLow);
  const value = active.reduce((s, p) => s + Math.max(0, p.stock) * (p.cost ?? 0), 0);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const out30 = recent.filter((m) => m.kind === 'saida' && m.created_at >= since30).length;
  const list = useMemo(() => {
    const t = fold(term);
    return products.filter((p) => (!onlyLow || isLow(p)) && (!t || fold(`${p.name} ${p.sku ?? ''} ${p.category}`).includes(t)));
  }, [products, term, onlyLow]);
  const pmap = new Map(products.map((p) => [p.id, p]));

  const exportCsv = () => {
    const rows = [['Nome', 'Código', 'Unidade', 'Categoria', 'Estoque', 'Estoque mínimo', 'Custo', 'Preço'].join(';'),
      ...products.map((p) => [p.name, p.sku ?? '', p.unit, p.category, String(p.stock).replace('.', ','), String(p.min_stock).replace('.', ','), p.cost != null ? p.cost.toFixed(2).replace('.', ',') : '', p.price != null ? p.price.toFixed(2).replace('.', ',') : ''].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'estoque.csv'; a.click();
  };

  return (
    <>
      <PageHeader title="Estoque" subtitle="Entradas, saídas e alertas de estoque baixo. Pelo WhatsApp: “dá baixa de 2 removedores de mancha”."
        actions={<>
          <Button icon={<Download />} onClick={exportCsv} className="only-desktop">Exportar</Button>
          {manager && <Button icon={<Upload />} onClick={() => setImporting(true)}>Importar planilha</Button>}
          {manager && <Button variant="solid" icon={<Plus />} onClick={() => setEdit({ open: true, product: null })}>Novo produto</Button>}
        </>} />

      <div className="stat-row">
        <div className="stat"><span>Produtos ativos</span><b>{num(active.length)}</b><small>{products.length - active.length ? `${products.length - active.length} inativos` : 'cadastrados'}</small></div>
        <div className="stat"><span>Abaixo do mínimo</span><b style={{ color: low.length ? 'var(--orange-ink)' : undefined }}>{low.length}</b><small>{low.length ? 'hora de repor' : 'tudo em dia'}</small></div>
        <div className="stat"><span>Valor em estoque</span><b>{brl0(value)}</b><small>pelo custo</small></div>
        <div className="stat"><span>Saídas (30 dias)</span><b>{out30}</b><small>movimentações</small></div>
      </div>

      {low.length > 0 && (
        <section className="card stock-alert">
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle style={{ color: 'var(--orange-ink)', flex: 'none', marginTop: 2 }} />
            <div className="grow">
              <b>Repor em breve</b>
              <div className="chips-wrap" style={{ marginTop: 8 }}>
                {low.map((p) => <button key={p.id} className="chip" onClick={() => setMove({ product: p, kind: 'entrada' })}>{p.name} · {qty(p.stock)} {p.unit}<span className="muted"> (mín. {qty(p.min_stock)})</span></button>)}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-head wrap" style={{ gap: 10 }}>
          <div className="search-field"><Search /><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar produto, código ou categoria" aria-label="Buscar produto" /></div>
          <Button size="sm" variant={onlyLow ? 'solid' : undefined} icon={<AlertTriangle />} onClick={() => setOnlyLow(!onlyLow)}>Só estoque baixo</Button>
        </div>
        {isLoading ? <Loader /> : list.length === 0 ? (
          <Empty icon={<Package />} title={products.length ? 'Nenhum produto encontrado' : 'Nenhum produto ainda'}
            action={manager && !products.length ? <div className="row" style={{ gap: 8, justifyContent: 'center' }}><Button icon={<Upload />} onClick={() => setImporting(true)}>Importar planilha</Button><Button variant="solid" icon={<Plus />} onClick={() => setEdit({ open: true, product: null })}>Cadastrar produto</Button></div> : undefined}>
            {products.length ? 'Tente outra busca.' : 'Cadastre os produtos que você usa ou vende, ou traga tudo de uma planilha do Excel.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Produto</th><th>Categoria</th><th>Saldo</th><th className="num only-desktop">Custo</th><th className="num only-desktop">Preço</th><th /></tr></thead>
              <tbody>{list.map((p) => (
                <tr key={p.id} className={cx(!p.active && 'muted')}>
                  <td style={{ maxWidth: 300 }}><div className="truncate"><b style={{ fontWeight: 650 }}>{p.name}</b></div><div className="muted tiny">{p.sku || 'sem código'}</div></td>
                  <td className="muted">{p.category}</td>
                  <td style={{ minWidth: 150 }}>
                    <div className="row" style={{ gap: 8 }}><b>{qty(p.stock)}</b><span className="muted small">{p.unit}</span>{isLow(p) && <Badge size="sm" tone="orange">Baixo</Badge>}</div>
                    {p.min_stock > 0 && <div className="stock-bar" title={`Mínimo: ${qty(p.min_stock)}`}><i className={cx(isLow(p) && 'low')} style={{ width: `${Math.min(100, (p.stock / (p.min_stock * 3)) * 100)}%` }} /><s style={{ left: '33.3%' }} /></div>}
                  </td>
                  <td className="num only-desktop">{p.cost != null ? brl(p.cost) : '—'}</td>
                  <td className="num only-desktop">{p.price != null ? brl(p.price) : '—'}</td>
                  <td className="nowrap">
                    <button className="icon-btn xs" aria-label="Entrada" title="Entrada" onClick={() => setMove({ product: p, kind: 'entrada' })}><ArrowDownToLine /></button>
                    <button className="icon-btn xs" aria-label="Saída" title="Saída" onClick={() => setMove({ product: p, kind: 'saida' })}><ArrowUpFromLine /></button>
                    {manager && <button className="icon-btn xs" aria-label="Ajustar saldo" title="Ajustar saldo" onClick={() => setMove({ product: p, kind: 'ajuste' })}><SlidersHorizontal /></button>}
                    <button className="icon-btn xs" aria-label="Histórico" title="Histórico" onClick={() => setHist(p)}><HistoryIcon /></button>
                    {manager && <button className="icon-btn xs" aria-label="Editar" title="Editar" onClick={() => setEdit({ open: true, product: p })}><Pencil /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-head"><div><h3>Últimas movimentações</h3><div className="sub">Entradas, saídas e ajustes de todos os produtos</div></div></div>
        {recent.length === 0 ? <Empty title="Nenhuma movimentação ainda" /> : <MovementList rows={recent.slice(0, 12)} pmap={pmap} />}
      </section>

      <ProductForm open={edit.open} product={edit.product} onClose={() => setEdit({ open: false, product: null })} />
      <MoveForm move={move} onClose={() => setMove(null)} />
      <Drawer open={!!hist} onClose={() => setHist(null)} title={hist?.name ?? ''}>
        {hist && <ProductHistory product={hist} />}
      </Drawer>
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function MovementList({ rows, pmap }: { rows: StockMovement[]; pmap?: Map<string, Product> }) {
  return (
    <div className="mini-list">
      {rows.map((m) => {
        const p = pmap?.get(m.product_id);
        return (
          <div key={m.id}>
            <span className={cx('mov-ic', m.kind)}>{m.kind === 'entrada' ? <ArrowDownToLine /> : m.kind === 'saida' ? <ArrowUpFromLine /> : <SlidersHorizontal />}</span>
            <span className="grow truncate"><b style={{ fontWeight: 650 }}>{KIND_LABEL[m.kind]}{m.kind === 'ajuste' ? ' para' : ''} {qty(m.qty)}</b>{p && <> · {p.name}</>}{m.note && <span className="muted"> · {m.note}</span>}{m.created_via === 'ia_dono' && <span className="muted"> · pela IA</span>}</span>
            <span className="muted small nowrap">saldo {qty(m.balance_after ?? 0)} · {fmtDateTime(m.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProductHistory({ product }: { product: Product }) {
  const { data = [], isLoading } = useList('stock_movements', { filters: [{ col: 'product_id', op: 'eq', value: product.id }], order: [{ col: 'created_at', asc: false }], limit: 200 });
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 0 }}>
        <div className="stat"><span>Saldo</span><b>{qty(product.stock)} {product.unit}</b><small>mínimo {qty(product.min_stock)}</small></div>
        <div className="stat"><span>Valor</span><b>{brl0(Math.max(0, product.stock) * (product.cost ?? 0))}</b><small>pelo custo</small></div>
      </div>
      {isLoading ? <Loader /> : <MovementList rows={data} />}
    </div>
  );
}

function ProductForm({ open, product, onClose }: { open: boolean; product: Product | null; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [f, setF] = useState({ name: '', sku: '', unit: 'un', category: 'Geral', stock: '', min_stock: '', cost: 0, price: 0, active: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(product ? { name: product.name, sku: product.sku ?? '', unit: product.unit, category: product.category, stock: String(product.stock), min_stock: String(product.min_stock || ''), cost: product.cost ?? 0, price: product.price ?? 0, active: product.active }
      : { name: '', sku: '', unit: 'un', category: 'Geral', stock: '', min_stock: '', cost: 0, price: 0, active: true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = (s: string) => Number(s.replace(',', '.')) || 0;
  const save = async () => {
    if (!f.name.trim()) { toast('Escreva o nome do produto', 'err'); return; }
    setBusy(true);
    try {
      const row: Partial<Product> = { name: f.name.trim(), sku: f.sku.trim() || null, unit: f.unit.trim() || 'un', category: f.category.trim() || 'Geral', min_stock: n(f.min_stock), cost: f.cost || null, price: f.price || null, active: f.active };
      if (product) await api.update('products', product.id, row);
      else await api.insert('products', { ...row, stock: Math.max(0, n(f.stock)) });
      inv('products', 'stock_movements'); toast(product ? 'Produto atualizado' : 'Produto cadastrado'); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={product ? 'Editar produto' : 'Novo produto'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="form-grid">
        <Field label="Nome" className="full"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Código (opcional)"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        <Field label="Unidade"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="un, kg, litro, caixa..." /></Field>
        <Field label="Categoria"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        {product ? <Field label="Saldo" hint="Para mudar o saldo, use entrada, saída ou ajuste."><Input value={`${f.stock} ${f.unit}`} disabled /></Field>
          : <Field label="Saldo inicial"><Input inputMode="decimal" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} placeholder="0" /></Field>}
        <Field label="Estoque mínimo" hint="Avisamos quando chegar nele."><Input inputMode="decimal" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} placeholder="0" /></Field>
        <Field label="Custo unitário"><MoneyInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} /></Field>
        <Field label="Preço de venda (opcional)"><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
        {product && <Field label="Situação"><Select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field>}
      </div>
    </Modal>
  );
}

function MoveForm({ move, onClose }: { move: { product: Product; kind: StockKind } | null; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (move) { setAmount(move.kind === 'ajuste' ? String(move.product.stock) : ''); setNote(''); } }, [move]);
  if (!move) return null;
  const { product: p, kind } = move;
  const value = Number(amount.replace(',', '.'));
  const after = kind === 'entrada' ? p.stock + (value || 0) : kind === 'saida' ? p.stock - (value || 0) : value || 0;
  const save = async () => {
    if (!(value > 0) && !(kind === 'ajuste' && value === 0)) { toast('Informe a quantidade', 'err'); return; }
    setBusy(true);
    try {
      await api.insert('stock_movements', { product_id: p.id, kind, qty: value, note: note.trim() || null, created_via: 'painel' });
      inv('products', 'stock_movements', 'notifications'); toast(`${KIND_LABEL[kind]} registrada`); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${KIND_LABEL[kind]} · ${p.name}`} subtitle={`Saldo atual: ${qty(p.stock)} ${p.unit}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} onClick={save}>Registrar</Button></>}>
      <div className="form-grid">
        <Field label={kind === 'ajuste' ? 'Saldo correto' : 'Quantidade'} hint={amount ? `Saldo depois: ${qty(after)} ${p.unit}${after < 0 ? ' — maior que o estoque' : ''}` : undefined} error={after < 0 ? 'A saída é maior que o saldo.' : null}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Observação (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'entrada' ? 'Ex.: Nota fiscal 3321' : kind === 'saida' ? 'Ex.: Serviço do condomínio' : 'Ex.: Contagem do mês'} /></Field>
      </div>
    </Modal>
  );
}

const COL_LABEL: Record<keyof ProductRow, string> = { name: 'Nome', sku: 'Código', unit: 'Unidade', category: 'Categoria', stock: 'Estoque', min_stock: 'Mínimo', cost: 'Custo', price: 'Preço' };

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ file: string; items: ProductRow[]; columns: (keyof ProductRow)[] } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  useEffect(() => { if (open) { setParsed(null); setErr(''); } }, [open]);
  const load = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try {
      const { items, columns } = toProductRows(await readSheet(file));
      if (!items.length) throw new Error('Não encontrei produtos na planilha.');
      setParsed({ file: file.name, items, columns });
    } catch (e) { setParsed(null); setErr((e as Error).message); }
  };
  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const r = await api.importProducts(parsed.items);
      inv('products', 'stock_movements');
      toast(`${r.created} novos e ${r.updated} atualizados${r.skipped ? ` · ${r.skipped} linhas ignoradas` : ''}`);
      onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const template = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + PRODUCT_TEMPLATE], { type: 'text/csv;charset=utf-8' })); a.download = 'modelo-estoque.csv'; a.click(); };
  return (
    <Modal open={open} onClose={onClose} title="Importar planilha de produtos" subtitle="Excel (.xlsx) ou CSV. A primeira linha precisa ter os nomes das colunas."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="solid" loading={busy} disabled={!parsed} onClick={run}>{parsed ? `Importar ${parsed.items.length} produtos` : 'Importar'}</Button></>}>
      <div className={cx('dropzone', drag && 'over')} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void load(e.dataTransfer.files[0]); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') input.current?.click(); }}>
        <FileSpreadsheet />
        <b>{parsed ? parsed.file : 'Arraste a planilha aqui ou clique para escolher'}</b>
        <span className="muted small">Colunas reconhecidas: Nome, Código, Unidade, Categoria, Estoque, Estoque mínimo, Custo e Preço</span>
        <input ref={input} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {err && <div className="auth-err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      {parsed && (
        <div className="table-wrap" style={{ marginTop: 14, maxHeight: 260 }}>
          <table className="table">
            <thead><tr>{parsed.columns.map((c) => <th key={c}>{COL_LABEL[c]}</th>)}</tr></thead>
            <tbody>{parsed.items.slice(0, 8).map((r, i) => <tr key={i}>{parsed.columns.map((c) => <td key={c} className="truncate" style={{ maxWidth: 200 }}>{r[c] ?? ''}</td>)}</tr>)}</tbody>
          </table>
          {parsed.items.length > 8 && <p className="muted small" style={{ padding: '8px 4px' }}>e mais {parsed.items.length - 8} produtos.</p>}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>Produtos com o mesmo código (ou o mesmo nome, se não tiver código) são atualizados, e o saldo vira o da planilha. <button className="link" onClick={template}>Baixar planilha modelo</button></p>
    </Modal>
  );
}
