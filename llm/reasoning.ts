/**
 * Per-model-family reasoning control — the fix for the real "mimo unusable" problem.
 *
 * Many reasoning models default to thinking ON. Under a finite `max_tokens` budget that
 * is catastrophic for deterministic, tool-driven work: the model spends the budget on
 * HIDDEN reasoning, hits the length limit, and returns **null content and no tool_call**
 * — which downstream looks identical to a "vacuous no-edit" or a "stall". Reproduced in
 * this repo: `xiaomi/mimo-v2.5` at max_tokens=256 intermittently returned
 * finish_reason=length, ~277 reasoning tokens, content=null / tool_calls=null; with
 * reasoning disabled it returned 0 reasoning tokens and a clean tool call every time.
 *
 * The fix is the provider's reasoning switch, which differs by family. This module is the
 * single source of truth mapping a model id → family → the request-body fragment that
 * achieves the desired thinking state. It is pure, deterministic, and provider-payload-
 * shaped for OpenRouter (fields merged at the top level of the chat/completions body).
 *
 * Families + payloads are PUBLIC, documented model behaviors (not consumer-specific):
 *   - OpenRouter unified `reasoning` control: https://openrouter.ai/docs/use-cases/reasoning-tokens
 *   - Qwen3 vLLM `chat_template_kwargs.enable_thinking`: https://qwen.readthedocs.io/en/latest/deployment/vllm.html
 *   For Qwen3 we send BOTH switches: vLLM honors `enable_thinking`, while non-vLLM
 *   OpenRouter providers honor `reasoning.enabled` — each ignores the key it doesn't know,
 *   so the dual payload disables thinking across heterogeneous serving backends.
 */

export type ModelFamily = 'grok' | 'mimo' | 'minimax' | 'glm' | 'qwen' | 'other'

/** Case-insensitive prefix table; first match wins (no overlapping prefixes today). */
const FAMILY_PREFIXES: ReadonlyArray<readonly [ModelFamily, readonly string[]]> = [
  ['grok', ['x-ai/grok-']],
  ['mimo', ['xiaomi/', 'mimo']],
  ['minimax', ['minimax/', 'minimax']],
  ['glm', ['z-ai/', 'glm']],
  ['qwen', ['qwen3', 'qwen/qwen3']],
]

/** Classify a model id into a reasoning-behavior family (`other` = no override needed). */
export function identifyFamily(modelId: string): ModelFamily {
  if (!modelId) return 'other'
  const lowered = modelId.toLowerCase()
  for (const [family, prefixes] of FAMILY_PREFIXES) {
    if (prefixes.some((p) => lowered.startsWith(p))) return family
  }
  return 'other'
}

/**
 * Return the request-body fragment that forces `thinking` for `modelId`, or `null` when
 * no override is needed (family default already matches, or family unknown). Default
 * `thinking: false` — deterministic tool/heal work wants reasoning OFF so the token budget
 * produces a real answer, not hidden reasoning.
 *
 * Merge the result into the OpenRouter chat/completions body at the TOP LEVEL:
 *   const r = reasoningOverride(model); if (r) Object.assign(body, r)
 */
export function reasoningOverride(
  modelId: string,
  thinking = false,
): Record<string, unknown> | null {
  const family = identifyFamily(modelId)
  if (thinking) {
    // Only GLM needs an explicit ENABLE; the others are thinking-on by default.
    return family === 'glm' ? { reasoning: { enabled: true } } : null
  }
  switch (family) {
    case 'grok':
      return { reasoning: { effort: 'none' } }
    case 'mimo':
    case 'minimax':
    case 'glm':
      return { reasoning: { enabled: false } }
    case 'qwen':
      // Dual payload — covers both vLLM (`enable_thinking`) and non-vLLM OpenRouter
      // providers (`reasoning.enabled`); each ignores the key it doesn't recognize.
      return { chat_template_kwargs: { enable_thinking: false }, reasoning: { enabled: false } }
    default:
      return null
  }
}
