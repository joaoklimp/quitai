// Criptografia dos segredos das clínicas guardados no banco (token do WhatsApp, chave do Asaas, token da Focus NFe).
// AES-256-GCM com a chave DATA_ENCRYPTION_KEY (64 caracteres hexadecimais) que fica só nos segredos das Edge Functions.
// O valor gravado fica "enc:v1:<base64 de iv+cifra>". Valores antigos, em texto puro, continuam sendo lidos.

const PREFIX = 'enc:v1:';
let cached: Promise<CryptoKey | null> | null = null;

function loadKey(): Promise<CryptoKey | null> {
  cached ??= (async () => {
    const hex = (Deno.env.get('DATA_ENCRYPTION_KEY') ?? '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      if (hex) console.error('DATA_ENCRYPTION_KEY inválida: use 64 caracteres hexadecimais');
      return null;
    }
    const raw = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  })();
  return cached;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Criptografa para gravar no banco. Sem chave configurada, grava como veio (e avisa no log). */
export async function seal(plain: string): Promise<string> {
  const key = await loadKey();
  if (!key) { console.warn('DATA_ENCRYPTION_KEY ausente: segredo gravado sem criptografia'); return plain; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return PREFIX + b64(out);
}

/** Lê um segredo do banco (criptografado ou antigo, em texto puro). */
export async function open(stored: string | null | undefined): Promise<string> {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored;
  const key = await loadKey();
  if (!key) throw new Error('DATA_ENCRYPTION_KEY ausente: não consigo ler um segredo criptografado');
  const all = unb64(stored.slice(PREFIX.length));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
  return new TextDecoder().decode(pt);
}

export const isSealed = (v: string | null | undefined) => !!v && v.startsWith(PREFIX);
