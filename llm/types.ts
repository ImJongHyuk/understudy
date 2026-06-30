/**
 * llm/ — Plane A (LLM authoring/healing) infrastructure, deliberately SEPARATE from
 * core/ (Plane B, the deterministic gate). NOTHING here ever runs inside the merge gate
 * (INV-1): these are the swappable model-access primitives the Planner/Generator/Healer
 * loops use UPSTREAM of the gate. Shared, provider-agnostic types live here.
 */

/** A model + an OPTIONAL preferred provider/endpoint slug (e.g. "xiaomi/fp8"). The
 * provider is a *preference*, not a hard pin (see RouteOptions.pin). */
export interface ModelSpec {
  readonly model: string
  readonly provider?: string
}

/** A normalized tool call, regardless of how the provider emitted it. */
export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly args: Record<string, unknown>
}

/** One assistant turn. `raw` is the provider's raw assistant message, pushed back into
 * history verbatim so multi-turn tool context is preserved. */
export interface LlmTurn {
  readonly content: string
  readonly reasoning?: string
  readonly toolCalls: ToolCall[]
  readonly raw: Record<string, unknown>
}

export type ChatMessage = Record<string, unknown>

export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

/**
 * Provider-routing policy. The two knobs that made `xiaomi/mimo-v2.5` "unusable" in A3
 * (see docs/PROVIDER-ROUTING-LESSONS.md):
 *  - `requireParameters` (default TRUE): only route to providers that support the request's
 *    params (notably `tools`). Without it, a tools request can be silently routed to a
 *    provider that IGNORES `tools` → empty tool_calls that LOOK like a vacuous no-edit.
 *  - `pin` (default FALSE): when a preferred provider is given, FALSE means "prefer it but
 *    fall back to another tool-capable provider for the SAME model" — so a transient
 *    provider stall is escaped. TRUE reproduces A3's old rigid single-provider pin
 *    (`allow_fallbacks:false`) and is for per-provider measurement only.
 */
export interface RouteOptions {
  readonly requireParameters?: boolean
  readonly pin?: boolean
  /**
   * Whether the model should THINK (reasoning on). Default FALSE — deterministic tool/heal
   * work wants reasoning OFF, because a reasoning-on model can spend a finite `max_tokens`
   * budget on hidden reasoning and return null content / no tool call (the real "mimo
   * unusable" pathology). The family-specific disable payload is applied automatically; see
   * `llm/reasoning.ts` and docs/PROVIDER-ROUTING-LESSONS.md.
   */
  readonly thinking?: boolean
}

/** A single-model caller. OpenRouter still load-balances / falls back across THAT model's
 * providers per the route policy; this throws only when the model itself can't be served. */
export interface LlmProvider {
  complete(spec: ModelSpec, messages: ChatMessage[], tools: ToolSchema[]): Promise<LlmTurn>
}

/** The high-level bridge the agentic loop talks to; model/provider selection is hidden. */
export interface LlmBridge {
  complete(messages: ChatMessage[], tools: ToolSchema[]): Promise<LlmTurn>
  /** Which candidate (model|provider) actually answered last — for telemetry/measurement. */
  readonly lastModel: string | undefined
}
