/**
 * OpenRouter provider (OpenAI-compatible chat/completions). Implements the single-model
 * LlmProvider with bounded per-request timeout + retries, and — critically — the provider
 * ROUTING fix that makes models like xiaomi/mimo-v2.5 usable (see
 * docs/PROVIDER-ROUTING-LESSONS.md): require tool-capable providers, and prefer-with-
 * fallback rather than hard-pinning one stalling provider.
 */
import type { ChatMessage, LlmProvider, LlmTurn, ModelSpec, RouteOptions, ToolSchema } from './types'
import { extractToolCalls, stripThinkTags } from './normalize'
import { reasoningOverride } from './reasoning'

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface OpenRouterOptions {
  readonly apiKey: string
  readonly endpoint?: string
  /** Per-request abort (a hung provider must not block the run). Default 35 000 ms. */
  readonly timeoutMs?: number
  /** Attempts on timeout / 429 / 5xx / network error. Default 3. */
  readonly retries?: number
  readonly route?: RouteOptions
  readonly maxTokens?: number
}

/**
 * Build the OpenRouter `provider` routing object. The fix, in one place:
 *  - `require_parameters: true` (default) → never route a tools request to a provider that
 *    would silently ignore `tools` and return empty tool_calls.
 *  - a preferred provider becomes `order:[provider]` with `allow_fallbacks` driven by
 *    `route.pin`: FALSE (default) = prefer it but fall over to another tool-capable
 *    provider for the same model; TRUE = rigid single-provider pin (measurement only).
 */
export function buildProviderRoute(spec: ModelSpec, route?: RouteOptions): Record<string, unknown> | undefined {
  const obj: Record<string, unknown> = {}
  if (route?.requireParameters !== false) obj.require_parameters = true
  if (spec.provider) {
    obj.order = [spec.provider]
    obj.allow_fallbacks = route?.pin ? false : true
  }
  return Object.keys(obj).length > 0 ? obj : undefined
}

export class OpenRouterProvider implements LlmProvider {
  constructor(private readonly o: OpenRouterOptions) {
    if (!o.apiKey) throw new Error('OpenRouterProvider: apiKey required (cannot-run = RED)')
  }

  async complete(spec: ModelSpec, messages: ChatMessage[], tools: ToolSchema[]): Promise<LlmTurn> {
    const body: Record<string, unknown> = {
      model: spec.model,
      messages,
      tools: tools.map((t) => ({ type: 'function', function: t })),
      tool_choice: 'auto',
      temperature: 0,
      max_tokens: this.o.maxTokens ?? 1024,
    }
    const provider = buildProviderRoute(spec, this.o.route)
    if (provider) body.provider = provider

    // Family-specific reasoning control (default OFF). Without this, a reasoning-on model
    // can burn the max_tokens budget on hidden reasoning and return null content / no tool
    // call — the real "mimo unusable" failure. Merged at top level (OpenRouter fields).
    const reasoning = reasoningOverride(spec.model, this.o.route?.thinking ?? false)
    if (reasoning) Object.assign(body, reasoning)

    const retries = this.o.retries ?? 3
    const timeoutMs = this.o.timeoutMs ?? 35_000
    let lastErr = ''
    for (let attempt = 0; attempt < retries; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetch(this.o.endpoint ?? DEFAULT_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        })
        if (res.status === 429 || res.status >= 500) {
          lastErr = `http ${res.status}`
          await sleep(1500 * (attempt + 1))
          continue
        }
        const j = (await res.json()) as Record<string, unknown>
        const err = (j as { error?: unknown }).error
        if (err) {
          lastErr = JSON.stringify(err).slice(0, 200)
          await sleep(1200 * (attempt + 1))
          continue
        }
        const choice = (j.choices as Array<Record<string, unknown>>)?.[0]
        const msg = (choice?.message ?? {}) as Record<string, unknown>
        return {
          // Clean the human-facing content of any leaked <think> blocks (on-prem vLLM), but
          // extract tool calls from the RAW msg so a <tool_call> inside <think> is rescued.
          content: stripThinkTags((msg.content as string) ?? ''),
          reasoning: (msg.reasoning as string) ?? (msg.reasoning_content as string) ?? undefined,
          toolCalls: extractToolCalls(msg),
          raw: msg,
        }
      } catch (e) {
        lastErr = (e as Error).message
        await sleep(1200 * (attempt + 1))
      } finally {
        clearTimeout(timer)
      }
    }
    throw new Error(`OpenRouter ${spec.model} failed after ${retries} attempts: ${lastErr}`)
  }
}
