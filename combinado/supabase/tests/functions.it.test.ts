// Integração das Edge Functions com o banco de verdade: Postgres 17 + PostgREST (a API REST do Supabase)
// + um proxy com os caminhos do Supabase (/rest/v1). As ferramentas reais da IA rodam no Deno contra eles,
// com o Claude simulado decidindo quais ferramentas chamar.
// Precisa do PostgREST (https://github.com/PostgREST/postgrest/releases): defina POSTGREST_BIN ou deixe "postgrest" no PATH.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDb, type TestDb } from './harness';

const PGRST = process.env.POSTGREST_BIN || 'postgrest';
const hasPgrst = spawnSync(PGRST, ['--version'], { stdio: 'ignore' }).status === 0;
const FUNCTIONS = fileURLToPath(new URL('../functions/', import.meta.url));
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(payload: object): string {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}

let db: TestDb;
let pgrst: ChildProcess;
let proxy: Server;
let proxyPort = 0;
let companyId = '', userId = '';

async function waitFor(url: string, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`não respondeu: ${url}`);
}

describe.skipIf(!hasPgrst)('ferramentas da IA contra o banco (PostgREST)', () => {
  beforeAll(async () => {
    db = await startDb();
    await db.sql(`create role authenticator login password 'authpw' noinherit; grant anon, authenticated, service_role to authenticator;`);
    const restPort = 56000 + Math.floor(Math.random() * 3000);
    pgrst = spawn(PGRST, [], {
      env: {
        ...process.env,
        PGRST_DB_URI: `postgres://authenticator:authpw@127.0.0.1:${db.port}/combinado`,
        PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET,
        PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(restPort), PGRST_LOG_LEVEL: 'error',
      },
      stdio: 'inherit',
    });
    await waitFor(`http://127.0.0.1:${restPort}/`);
    // proxy com os caminhos do Supabase: /rest/v1 → PostgREST; armazenamento de arquivos não existe aqui
    proxy = createServer((req, res) => {
      if (!req.url?.startsWith('/rest/v1')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"não disponível no teste"}'); return; }
      const fwd = request({ host: '127.0.0.1', port: restPort, path: req.url.slice('/rest/v1'.length) || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${restPort}` } }, (r) => { res.writeHead(r.statusCode ?? 500, r.headers); r.pipe(res); });
      fwd.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
      req.pipe(fwd);
    });
    await new Promise<void>((ok) => proxy.listen(0, '127.0.0.1', () => ok()));
    proxyPort = (proxy.address() as { port: number }).port;

    // empresa de teste: atende todos os dias das 8h às 18h, sem antecedência mínima
    userId = await db.createUser('ana@brilholar.com', 'Ana Duarte');
    companyId = (await db.as({ user: userId }, (q) => q.one<{ id: string }>(`select public.onboard_company('Brilho Lar Higienização', 'limpeza', '61999990000', 'Brasília', true) as id`))).id;
    const hours = JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [['08:00', '18:00']]])));
    await db.sql(`update companies set business_hours = $1::jsonb, slot_minutes = 60, min_notice_minutes = 0, max_days_ahead = 60 where id = $2`, [hours, companyId]);
  }, 240_000);

  afterAll(async () => {
    proxy?.close();
    pgrst?.kill();
    await db?.stop();
  });

  it('as ferramentas e o agente funcionam de ponta a ponta', async () => {
    const deno = process.env.DENO_BIN ? [process.env.DENO_BIN] : ['npx', '--yes', 'deno@2'];
    // assíncrono: o proxy roda neste mesmo processo e precisa continuar respondendo
    const child = spawn(deno[0], [...deno.slice(1), 'test', '--no-config', '--node-modules-dir=none', '--min-dep-age=0', '--allow-env', '--allow-net', 'tests/integration_it.ts'], {
      cwd: FUNCTIONS,
      shell: process.platform === 'win32',
      env: {
        ...process.env, DENO_NO_PACKAGE_JSON: '1',
        SUPABASE_URL: `http://127.0.0.1:${proxyPort}`, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
        ANTHROPIC_API_KEY: 'sk-ant-teste', SITE_URL: 'https://combinado.test', IT_COMPANY_ID: companyId, IT_USER_ID: userId,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const status = await new Promise<number | null>((ok) => child.on('close', ok));
    out = out.replace(/\x1b\[[0-9;]*m/g, '');
    if (status !== 0) console.log(out.split('\n').filter((l) => !l.startsWith('Download')).slice(-80).join('\n'));
    expect(status).toBe(0);
    expect(out).toMatch(/ok \| \d+ passed \| 0 failed/);
  }, 320_000);
});
