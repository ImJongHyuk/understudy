/**
 * Ordered-fallback bridge with a per-candidate circuit breaker.
 *
 *  - ONE candidate  → a MEASUREMENT bridge: the breaker fast-fails a dead/stalling provider
 *    after `breakerThreshold` consecutive failures, so the remaining attempts of a run don't
 *    each re-hammer (and time out on) the same hung provider.
 *  - MANY candidates → a PRODUCT bridge: falls over to the next candidate on failure.
 *
 * Breaker state persists across calls (reuse ONE bridge across a run), so a provider that
 * stalls is tried, tripped, then skipped — never re-tried for the rest of the run. This is
 * the complement to OpenRouter's same-model provider fallback: it bounds the cost of a
 * genuinely dead candidate. Never silently substitutes a DIFFERENT model within one logical
 * call without the caller opting in via the candidate list order.
 */
import type { ChatMessage, LlmBridge, LlmProvider, LlmTurn, ModelSpec, ToolSchema } from './types'

export interface BridgeEvent {
  readonly type: 'attempt' | 'success' | 'failure' | 'tripped' | 'exhausted'
  readonly model: string
  readonly detail?: string
}

export interface ResilientOptions {
  /** Consecutive failures before a candidate trips OPEN (skipped thereafter). Default 2. */
  readonly breakerThreshold?: number
  readonly onEvent?: (e: BridgeEvent) => void
}

const keyOf = (s: ModelSpec): string => (s.provider ? `${s.model}|${s.provider}` : s.model)

export class ResilientBridge implements LlmBridge {
  private readonly fails = new Map<string, number>()
  private readonly tripped = new Set<string>()
  lastModel: string | undefined

  constructor(
    private readonly provider: LlmProvider,
    private readonly candidates: readonly ModelSpec[],
    private readonly opts: ResilientOptions = {},
  ) {
    if (candidates.length === 0) throw new Error('ResilientBridge needs ≥1 candidate')
  }

  /** True once every candidate has tripped — the bridge can serve nothing more. */
  get allTripped(): boolean {
    return this.candidates.every((c) => this.tripped.has(keyOf(c)))
  }

  async complete(messages: ChatMessage[], tools: ToolSchema[]): Promise<LlmTurn> {
    const threshold = this.opts.breakerThreshold ?? 2
    const emit = this.opts.onEvent ?? ((): void => {})
    const errors: string[] = []
    for (const spec of this.candidates) {
      const k = keyOf(spec)
      if (this.tripped.has(k)) continue
      emit({ type: 'attempt', model: k })
      try {
        const turn = await this.provider.complete(spec, messages, tools)
        this.fails.set(k, 0)
        this.lastModel = k
        emit({ type: 'success', model: k })
        return turn
      } catch (e) {
        const msg = (e as Error).message
        errors.push(`${k}: ${msg}`)
        const n = (this.fails.get(k) ?? 0) + 1
        this.fails.set(k, n)
        emit({ type: 'failure', model: k, detail: msg })
        if (n >= threshold) {
          this.tripped.add(k)
          emit({ type: 'tripped', model: k })
        }
      }
    }
    emit({ type: 'exhausted', model: this.candidates.map(keyOf).join(',') })
    throw new Error(`all candidates exhausted/tripped: ${errors.join(' | ') || '(all already tripped)'}`)
  }
}
