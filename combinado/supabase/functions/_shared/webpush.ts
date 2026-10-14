// Web Push sem bibliotecas: assinatura VAPID (RFC 8292) e conteúdo criptografado de ponta a ponta (aes128gcm, RFC 8291).
// O serviço de push do navegador (Google, Mozilla, Apple, Microsoft) só repassa: não consegue ler o aviso.

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (t: string): Bytes => new Uint8Array(enc.encode(t));

export const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64u(s: string): Bytes {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

/* ---------- aparelhos aceitos ---------- */
// Só os serviços de push dos navegadores: o servidor nunca faz pedidos para endereços escolhidos por quem chama (SSRF).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, // Chrome, Edge no Android, Samsung, Opera
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /\.notify\.windows\.com$/, // Edge no Windows
  /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/, // Safari (Mac, iPhone e iPad com o app instalado)
];
export function allowedEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && !u.password && PUSH_HOSTS.some((r) => r.test(u.hostname));
}

export interface PushTarget { endpoint: string; p256dh: string; auth: string }

/** Confere o que o navegador mandou: endereço de um serviço de push conhecido e chaves com o tamanho certo. */
export function validSubscription(s: unknown): PushTarget | null {
  const o = s as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = String(o?.endpoint ?? ''), p256dh = String(o?.keys?.p256dh ?? ''), auth = String(o?.keys?.auth ?? '');
  if (!allowedEndpoint(endpoint)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return null;
  try {
    const pub = unb64u(p256dh), sec = unb64u(auth);
    if (pub.length !== 65 || pub[0] !== 4 || sec.length !== 16) return null;
  } catch { return null; }
  return { endpoint, p256dh, auth };
}

/* ---------- chaves VAPID (identificam o servidor da ORBYTA para os serviços de push) ---------- */
export interface VapidKeys { publicKey: string; privateJwk: JsonWebKey }

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64u(raw), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}

const signers = new Map<string, Promise<CryptoKey>>();
function signer(keys: VapidKeys): Promise<CryptoKey> {
  let k = signers.get(keys.publicKey);
  if (!k) {
    const { d, x, y, kty, crv } = keys.privateJwk;
    k = crypto.subtle.importKey('jwk', { d, x, y, kty, crv }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    signers.set(keys.publicKey, k);
  }
  return k;
}

/** Cabeçalho Authorization do RFC 8292: token ES256 para a origem do serviço de push, válido por 12 horas. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const head = b64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signer(keys), utf8(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

/* ---------- criptografia do conteúdo (RFC 8291) ---------- */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * Criptografa o aviso para um aparelho: chave efêmera do servidor + chave pública e segredo do navegador.
 * `fixed` existe só para conferir com o exemplo do RFC nos testes.
 */
export async function encryptPayload(plaintext: Uint8Array, target: Pick<PushTarget, 'p256dh' | 'auth'>, fixed?: { salt: Bytes; serverKeys: CryptoKeyPair }): Promise<Bytes> {
  const uaPublic = unb64u(target.p256dh);
  const authSecret = unb64u(target.auth);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server = fixed?.serverKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // um registro só: conteúdo + delimitador 0x02 (último registro, sem preenchimento)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ct);
}

/* ---------- envio ---------- */
export interface PushOptions { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' }
export interface PushResult { ok: boolean; status: number; gone: boolean }
export type PushSender = (target: PushTarget, payload: Record<string, unknown>, keys: VapidKeys, subject: string, opts?: PushOptions) => Promise<PushResult>;

/** Entrega um aviso. `gone` = o aparelho cancelou ou a inscrição venceu (pode apagar). */
export const sendWebPush: PushSender = async (target, payload, keys, subject, opts = {}) => {
  if (!allowedEndpoint(target.endpoint)) return { ok: false, status: 0, gone: true };
  const body = await encryptPayload(utf8(JSON.stringify(payload)), target);
  const r = await fetch(target.endpoint, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 86_400),
      Urgency: opts.urgency ?? 'normal',
    },
    body,
  });
  await r.body?.cancel();
  return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
};
