// Transcrição de áudios do WhatsApp (clientes e equipe), para a IA entender mensagens de voz.
// Usa qualquer serviço compatível com a rota /audio/transcriptions da OpenAI. Padrão: Groq (Whisper), rápido e barato.
// Configuração (segredos das funções): TRANSCRIBE_API_KEY (obrigatório para ligar), TRANSCRIBE_API_URL e TRANSCRIBE_MODEL (opcionais).
// Sem chave, nada muda: a IA pede para o cliente escrever.

const DEFAULT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const EXT: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'webm', 'audio/wav': 'wav' };

export const transcriptionEnabled = () => !!Deno.env.get('TRANSCRIBE_API_KEY');

/** Devolve o texto falado no áudio, ou null se não deu (sem chave, áudio vazio, serviço fora do ar). */
export async function transcribe(bytes: Uint8Array, mime: string): Promise<string | null> {
  const key = Deno.env.get('TRANSCRIBE_API_KEY');
  if (!key || !bytes.length || bytes.length > 24 * 1024 * 1024) return null;
  const clean = mime.split(';')[0].trim();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: clean }), `audio.${EXT[clean] ?? 'ogg'}`);
  form.append('model', Deno.env.get('TRANSCRIBE_MODEL') || DEFAULT_MODEL);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  try {
    const res = await fetch(Deno.env.get('TRANSCRIBE_API_URL') || DEFAULT_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { console.error('transcrição', res.status, (await res.text()).slice(0, 300)); return null; }
    const text = String(((await res.json()) as { text?: string }).text ?? '').trim();
    return text ? text.slice(0, 4000) : null;
  } catch (e) {
    console.error('transcrição', (e as Error).message);
    return null;
  }
}
