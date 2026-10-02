// Cliente do Claude e o laço de ferramentas do agente (manual, para controlar confirmações, recibos e custo).
// Modelos: AI_MODEL (padrão: Claude Opus 5.5) e, só para as respostas aos clientes, AI_MODEL_CUSTOMER
// (o maior volume; claude-sonnet-5-5 custa metade). Sem AI_MODEL_CUSTOMER, os clientes usam o AI_MODEL.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import type { ActionReceipt } from './types.ts';

export const MODEL = Deno.env.get('AI_MODEL') || 'claude-opus-5-5';
export const CUSTOMER_MODEL = Deno.env.get('AI_MODEL_CUSTOMER') || MODEL;
export const aiConfigured = () => !!Deno.env.get('ANTHROPIC_API_KEY');

/**
 * Se o Opus recusar um pedido por política, a própria API refaz no modelo recomendado ("fallbacks: default").
 * O parâmetro só vai para a família Opus 5; nos outros modelos a recusa volta como resposta vazia e é tratada.
 */
export function fallbackParams(model: string): { betas?: string[]; fallbacks?: 'default' } {
  return model.startsWith('claude-opus-5') ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  // o SDK já repete sozinho erros temporários (limite de uso, sobrecarga, 5xx)
  client ??= new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), maxRetries: 3, timeout: 75_000 });
  return client;
}
/** Só para testes: troca o cliente por um falso que devolve respostas roteirizadas. */
export function __setClientForTests(fake: unknown) { client = fake as Anthropic; }

export type Msg = Anthropic.Beta.BetaMessageParam;
export type Effort = 'low' | 'medium' | 'high';

export interface ToolResult { content: string; receipt?: ActionReceipt; error?: boolean }
export interface Tool<C> {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool['input_schema'];
  run(input: Record<string, unknown>, ctx: C): Promise<ToolResult>;
}

export interface AgentRun {
  text: string;
  receipts: ActionReceipt[];
  usage: { input: number; output: number };
  refused: boolean;
  toolCalls: number;
}

/**
 * Roda o agente até ele responder em texto. O sistema estável (regras, catálogo) vai com cache;
 * o trecho dinâmico (data, hora, cliente) vem depois, sem cache, para não invalidar o prefixo.
 * Cada resultado de ferramenta volta numa única mensagem do usuário, com is_error quando falha.
 */
export async function runAgent<C>(o: {
  system: string;
  dynamic?: string;
  history: Msg[];
  tools: Tool<C>[];
  ctx: C;
  effort: Effort;
  model?: string;
  maxTokens?: number;
  maxSteps?: number;
}): Promise<AgentRun> {
  const model = o.model ?? MODEL;
  const messages: Msg[] = [...o.history];
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }];
  if (o.dynamic) system.push({ type: 'text', text: o.dynamic });
  const tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const receipts: ActionReceipt[] = [];
  const usage = { input: 0, output: 0 };
  let toolCalls = 0;

  for (let step = 0; step < (o.maxSteps ?? 8); step++) {
    const res = await anthropic().beta.messages.create({
      model,
      max_tokens: o.maxTokens ?? 8000,
      ...fallbackParams(model),
      output_config: { effort: o.effort },
      system,
      ...(tools.length ? { tools } : {}),
      messages,
    });
    usage.input += (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    usage.output += res.usage.output_tokens ?? 0;

    if (res.stop_reason === 'refusal') return { text: '', receipts, usage, refused: true, toolCalls };
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }

    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    // cortada no limite de tamanho: uma chamada de ferramenta pela metade não pode ser executada
    if (res.stop_reason === 'max_tokens') return { text, receipts, usage, refused: false, toolCalls };
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!uses.length) return { text, receipts, usage, refused: false, toolCalls };

    // devolve o turno completo (com os blocos de raciocínio) antes dos resultados
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      toolCalls++;
      const tool = o.tools.find((t) => t.name === u.name);
      let out: ToolResult;
      try {
        out = tool ? await tool.run((u.input ?? {}) as Record<string, unknown>, o.ctx) : { content: `Ferramenta desconhecida: ${u.name}.`, error: true };
      } catch (e) {
        console.error('ferramenta', u.name, e);
        out = { content: `Não foi possível concluir: ${(e as Error).message}`, error: true };
      }
      if (out.receipt) receipts.push(out.receipt);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: '', receipts, usage, refused: false, toolCalls };
}

/** Uma resposta simples, sem ferramentas (ex.: sugestão de resposta para a equipe). */
export async function complete(o: { system: string; history: Msg[]; effort?: Effort; model?: string; maxTokens?: number }): Promise<{ text: string; usage: { input: number; output: number } }> {
  const model = o.model ?? MODEL;
  const res = await anthropic().beta.messages.create({
    model,
    max_tokens: o.maxTokens ?? 4000,
    ...fallbackParams(model),
    output_config: { effort: o.effort ?? 'low' },
    system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
    messages: o.history,
  });
  const text = res.stop_reason === 'refusal' ? '' : res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { text, usage: { input: (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), output: res.usage.output_tokens ?? 0 } };
}

/** Erros da API que valem uma mensagem específica (limite, chave inválida). */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'A chave da IA não está configurada corretamente.';
  if (e instanceof Anthropic.RateLimitError) return 'A IA está com muitos pedidos agora. Tente de novo em instantes.';
  if (e instanceof Anthropic.APIError) return 'A IA ficou indisponível por um momento. Tente de novo em instantes.';
  return 'Não consegui falar com a IA agora. Tente de novo em instantes.';
}
