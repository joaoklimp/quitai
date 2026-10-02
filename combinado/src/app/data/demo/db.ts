// Banco em memória do modo demonstração, guardado no navegador (localStorage).
import type { Filter, Query, TableName, RowMap, AuditEntry, Notification, Message, Conversation, Contact } from '../types';
import { buildDemo, DEMO_COMPANY_ID, DEMO_VERSION, type DemoDB } from './seed';
import { fold } from '../../../shared/format';

const KEY = 'combinado-demo';
let db: DemoDB | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(t: TableName) => void>();

function load(): DemoDB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDB;
      // dados de outra versão ou muito antigos (o painel deve parecer "de hoje"): gera de novo
      const age = Date.now() - Date.parse(parsed.seededAt);
      if (parsed.version === DEMO_VERSION && age < 6 * 3600 * 1000) return parsed;
    }
  } catch { /* sem acesso ao armazenamento: segue só em memória */ }
  return buildDemo(new Date());
}

export function demoDb(): DemoDB {
  if (!db) { db = load(); persist(); }
  return db;
}

export function resetDemoDb() {
  db = buildDemo(new Date());
  persist(true);
  for (const t of ['contacts', 'quotes', 'appointments', 'sales', 'conversations', 'messages', 'tasks', 'notifications', 'audit_log', 'automations'] as TableName[]) emit(t);
}

export function persist(now = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const write = () => { try { if (db) localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* cota cheia: segue em memória */ } };
  if (now) write(); else saveTimer = setTimeout(write, 400);
}

export function emit(table: TableName) { for (const l of listeners) l(table); persist(); }
export function onChange(cb: (t: TableName) => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

let seq = 0;
export function newId(): string {
  const d = demoDb();
  d.seq.id++;
  seq++;
  return `0000e000-${(Date.now() % 1e4).toString(16).padStart(4, '0')}-4000-8000-${(d.seq.id * 7919 + seq).toString(16).padStart(12, '0')}`;
}

/* ---------- consultas ---------- */
function get(row: Record<string, unknown>, col: string): unknown { return row[col]; }
function matches(row: Record<string, unknown>, f: Filter): boolean {
  const v = get(row, f.col);
  switch (f.op) {
    case 'eq': return v === f.value;
    case 'neq': return v !== f.value;
    case 'gt': return (v as never) > (f.value as never);
    case 'gte': return (v as never) >= (f.value as never);
    case 'lt': return (v as never) < (f.value as never);
    case 'lte': return (v as never) <= (f.value as never);
    case 'in': return (f.value as unknown[]).includes(v);
    case 'is': return v === null || v === undefined;
    case 'not_null': return v !== null && v !== undefined;
  }
}
export function runQuery<T>(rows: T[], q?: Query): T[] {
  let out = rows as unknown as Record<string, unknown>[];
  for (const f of q?.filters ?? []) out = out.filter((r) => matches(r, f));
  if (q?.search?.term?.trim()) {
    const t = fold(q.search.term);
    const digits = q.search.term.replace(/\D/g, '');
    out = out.filter((r) => q.search!.cols.some((c) => {
      const v = r[c];
      if (Array.isArray(v)) return v.some((x) => fold(String(x)).includes(t));
      const s = String(v ?? '');
      return fold(s).includes(t) || (digits.length >= 4 && s.replace(/\D/g, '').includes(digits));
    }));
  }
  if (q?.order?.length) {
    out = [...out].sort((a, b) => {
      for (const o of q.order!) {
        const av = a[o.col] as never, bv = b[o.col] as never;
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (o.asc === false ? -1 : 1);
      }
      return 0;
    });
  }
  if (q?.limit) out = out.slice(0, q.limit);
  return out.map((r) => structuredClone(r)) as unknown as T[];
}

export function table<T extends TableName>(name: T): RowMap[T][] {
  return demoDb()[name] as unknown as RowMap[T][];
}

/* ---------- efeitos que no servidor são gatilhos ---------- */
export function audit(entry: Omit<AuditEntry, 'id' | 'company_id' | 'created_at'> & { created_at?: string }) {
  const row: AuditEntry = { id: newId(), company_id: DEMO_COMPANY_ID, created_at: entry.created_at ?? new Date().toISOString(), ...entry };
  table('audit_log').unshift(row);
  emit('audit_log');
  return row;
}
export function notify(n: Omit<Notification, 'id' | 'company_id' | 'created_at' | 'read_at' | 'user_id'>) {
  const row: Notification = { id: newId(), company_id: DEMO_COMPANY_ID, user_id: null, read_at: null, created_at: new Date().toISOString(), ...n };
  table('notifications').unshift(row);
  emit('notifications');
  return row;
}
export function pushMessage(conv: Conversation, m: Omit<Message, 'id' | 'company_id' | 'conversation_id' | 'created_at'> & { created_at?: string }): Message {
  const row: Message = { id: newId(), company_id: DEMO_COMPANY_ID, conversation_id: conv.id, created_at: m.created_at ?? new Date().toISOString(), ...m };
  table('messages').push(row);
  conv.last_message_at = row.created_at;
  conv.last_message_preview = (row.body || (row.media ? '[mídia]' : '')).slice(0, 120);
  if (row.direction === 'in') { conv.last_inbound_at = row.created_at; conv.unread += 1; }
  if (conv.contact_id) {
    const c = table('contacts').find((x) => x.id === conv.contact_id);
    if (c) { c.last_interaction_at = row.created_at; c.updated_at = row.created_at; }
  }
  emit('messages'); emit('conversations');
  return row;
}
export function contactById(id: string | null | undefined): Contact | undefined {
  return id ? table('contacts').find((c) => c.id === id) : undefined;
}
