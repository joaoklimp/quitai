// Leitura de planilhas no navegador, sem bibliotecas: CSV (vírgula ou ponto e vírgula) e Excel .xlsx (primeira aba).
// O .xlsx é um zip de XMLs: lemos o índice do zip, descompactamos com DecompressionStream e pegamos as células.

export async function readSheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return readXlsx(new Uint8Array(await file.arrayBuffer()));
  if (name.endsWith('.xls')) throw new Error('Arquivo .xls antigo: no Excel, use “Salvar como” e escolha .xlsx ou CSV.');
  return parseCsv(await file.text());
}

/** CSV com aspas, quebras de linha dentro de aspas e separador detectado (; é o padrão do Excel em português). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) && firstLine.includes(';') ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/* ---------- .xlsx ---------- */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + size);
    out.set(name, dec.decode(method === 0 ? raw : await inflate(raw)));
  }
  return out;
}

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export async function readXlsx(buf: Uint8Array): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n) || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels');
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const si of Array.from(parse(ss).getElementsByTagName('si'))) shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
  // primeira aba do arquivo (pela ordem do workbook), com sheet1 como reserva
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = files.get('xl/workbook.xml'), rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = parse(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = Array.from(parse(rels).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = files.get(sheetPath) ?? [...files.entries()].find(([k]) => k.startsWith('xl/worksheets/'))?.[1];
  if (!sheet) throw new Error('Não encontrei nenhuma aba na planilha.');
  const rows: string[][] = [];
  for (const r of Array.from(parse(sheet).getElementsByTagName('row'))) {
    const row: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const value = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('') : v;
      row[colIndex(c.getAttribute('r') ?? 'A1')] = value.trim();
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/* ---------- planilha → produtos ---------- */
export interface ProductRow { name: string; sku?: string; unit?: string; category?: string; stock?: string; min_stock?: string; cost?: string; price?: string }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HEADERS: [keyof ProductRow, RegExp][] = [
  ['min_stock', /^(estoque )?(minimo|min)( estoque)?$|^estoque minimo$|^alerta$/],
  ['stock', /^(estoque|saldo|quantidade|qtd|qtde|estoque atual|saldo atual)$/],
  ['sku', /^(codigo|cod|sku|ref|referencia|codigo de barras|ean)$/],
  ['name', /^(nome|produto|descricao|item|nome do produto)$/],
  ['unit', /^(unidade|un|und|medida)$/],
  ['category', /^(categoria|grupo|tipo|familia)$/],
  ['cost', /^(custo|preco de custo|valor de custo|custo unitario)$/],
  ['price', /^(preco|preco de venda|valor|valor de venda|venda)$/],
];

/** Número em formato brasileiro ou internacional ("1.234,56", "1234.56", "R$ 10") → "1234.56". */
export function normNumber(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  let s = v.replace(/[^\d,.-]/g, '');
  if (!s) return undefined;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? s : undefined;
}

/** Descobre as colunas pelo cabeçalho e devolve as linhas prontas para importar. */
export function toProductRows(rows: string[][]): { items: ProductRow[]; columns: (keyof ProductRow)[] } {
  if (!rows.length) return { items: [], columns: [] };
  const map = rows[0].map((h) => HEADERS.find(([, re]) => re.test(fold(h)))?.[0] ?? null);
  if (!map.includes('name')) throw new Error('A planilha precisa de uma coluna “Nome” (ou “Produto”) na primeira linha.');
  const items: ProductRow[] = [];
  for (const r of rows.slice(1)) {
    const o: Partial<ProductRow> = {};
    map.forEach((k, i) => { if (k && r[i] != null && r[i] !== '') o[k] = ['stock', 'min_stock', 'cost', 'price'].includes(k) ? normNumber(r[i]) : r[i]; });
    if (o.name) items.push(o as ProductRow);
  }
  return { items, columns: [...new Set(map.filter(Boolean) as (keyof ProductRow)[])] };
}

export const PRODUCT_TEMPLATE = 'Nome;Código;Unidade;Categoria;Estoque;Estoque mínimo;Custo;Preço\nShampoo para estofados 5L;SHA-5L;galão;Produtos;8;3;89,90;\nLuva nitrílica;LUV-M;par;EPI;40;10;2,90;\n';
