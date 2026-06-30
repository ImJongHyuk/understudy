/**
 * llm/ public surface — the swappable model-access layer for Plane A (authoring/healing).
 * Build a resilient bridge over OpenRouter from explicit config or env, or compose the
 * primitives (OpenRouterProvider, ResilientBridge, the tool-call normalizer) directly.
 */
import { OpenRouterProvider, type OpenRouterOptions } from './openrouter'
import { ResilientBridge, type ResilientOptions } from './resilient'
import type { LlmBridge, ModelSpec, RouteOptions } from './types'

export * from './types'
export { extractToolCalls, parseToolArgs, stripThinkTags } from './normalize'
export { identifyFamily, reasoningOverride, type ModelFamily } from './reasoning'
export { OpenRouterProvider, buildProviderRoute, type OpenRouterOptions } from './openrouter'
export { ResilientBridge, type ResilientOptions, type BridgeEvent } from './resilient'

/** Parse `A3_OPENROUTER_MODELS` CSV: "model|provider,model|provider,..." (provider optional). */
export function parseModels(csv: string): ModelSpec[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [model, provider] = pair.split('|').map((x) => x.trim())
      return provider ? { model, provider } : { model }
    })
}

export interface BridgeConfig {
  readonly apiKey?: string
  /** Candidates in priority order. Product: several (fallback). Measurement: one. */
  readonly models?: ModelSpec[]
  readonly route?: RouteOptions
  readonly openRouter?: Partial<OpenRouterOptions>
  readonly resilient?: ResilientOptions
}

/**
 * Build a ResilientBridge over OpenRouter. Reads OPENROUTER_API_KEY + A3_OPENROUTER_MODELS
 * from env when not given. Defaults route to tool-capable, prefer-with-fallback (the fix);
 * pass `route:{pin:true}` only for rigid per-provider measurement.
 */
export function createBridge(cfg: BridgeConfig = {}): LlmBridge {
  const apiKey = cfg.apiKey ?? process.env.OPENROUTER_API_KEY ?? ''
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set (cannot-run = RED)')
  const models = cfg.models ?? parseModels(process.env.A3_OPENROUTER_MODELS ?? '')
  if (models.length === 0) throw new Error('no models configured (set A3_OPENROUTER_MODELS or pass models)')
  const provider = new OpenRouterProvider({ apiKey, route: cfg.route, ...cfg.openRouter })
  return new ResilientBridge(provider, models, cfg.resilient)
}
