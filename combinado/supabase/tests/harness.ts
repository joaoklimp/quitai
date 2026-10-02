// Sobe um Postgres 17 de verdade (embedded-postgres), imita o mínimo do Supabase (papéis, auth.uid(),
// esquema auth) e aplica as migrações. Os testes agem como usuário logado, visitante ou chave de serviço.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

const SUPABASE_STUB = /* sql */ `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Who = { user: string } | 'anon' | 'service';
export interface Q {
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  exec(sql: string, params?: unknown[]): Promise<number>;
}

export interface TestDb {
  /** Executa como um papel do Supabase dentro de uma transação (confirmada no fim, desfeita em caso de erro). */
  as<T>(who: Who, fn: (q: Q) => Promise<T>): Promise<T>;
  createUser(email: string, name: string): Promise<string>;
  stop(): Promise<void>;
}

export async function startDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'combinado-pg-'));
  const port = 55000 + Math.floor(Math.random() * 5000);
  // o Postgres não roda como root: em contêineres, usa o usuário "postgres" do sistema
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, createPostgresUser: asRoot, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase('combinado');
  const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'combinado' });
  await client.connect();
  await client.query('set timezone = \'UTC\'');
  await client.query(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    try { await client.query(readFileSync(join(MIGRATIONS, file), 'utf8')); }
    catch (e) { throw new Error(`Migração ${file}: ${(e as Error).message}`); }
  }

  // objetos e listas viram JSON (os parâmetros jsonb das funções); o resto vai como está
  const prep = (params?: unknown[]) => params?.map((p) => (p !== null && typeof p === 'object' && !(p instanceof Date) ? JSON.stringify(p) : p));
  const q: Q = {
    async rows(sql, params) { return (await client.query(sql, prep(params))).rows; },
    async one(sql, params) { const r = (await client.query(sql, prep(params))).rows; if (r.length !== 1) throw new Error(`esperava 1 linha, veio ${r.length}: ${sql}`); return r[0]; },
    async exec(sql, params) { return (await client.query(sql, prep(params))).rowCount ?? 0; },
  };

  let queue: Promise<unknown> = Promise.resolve();
  const as: TestDb['as'] = (who, fn) => {
    const run = async () => {
      await client.query('begin');
      try {
        if (who === 'service') await client.query('set local role service_role');
        else if (who === 'anon') { await client.query('set local role anon'); await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`); }
        else {
          await client.query('set local role authenticated');
          await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who.user, role: 'authenticated' })]);
        }
        const out = await fn(q);
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  };

  return {
    as,
    async createUser(email, name) {
      const r = await client.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, { name }]);
      return r.rows[0].id as string;
    },
    async stop() {
      await client.end().catch(() => {});
      await server.stop().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
