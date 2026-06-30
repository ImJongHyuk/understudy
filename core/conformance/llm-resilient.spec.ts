/**
 * llm/resilient conformance — ordered fallback + per-candidate circuit breaker.
 * Deterministic + network-free (a scripted mock provider). Proves: success path sets
 * lastModel; a failing candidate falls over to the next; a persistently-failing candidate
 * TRIPS after the threshold and is then SKIPPED (never re-hammered); all-tripped throws;
 * a success RESETS the consecutive-failure counter.
 */
import { test, expect } from '@playwright/test'
import { ResilientBridge } from '../../llm/resilient'
import type { LlmProvider, LlmTurn, ModelSpec } from '../../llm/types'

const turnFor = (spec: ModelSpec): LlmTurn => ({
  content: `ok:${spec.model}`,
  toolCalls: [],
  raw: { role: 'assistant', model: spec.model },
})

/** A mock provider whose per-call outcome is decided by `decide(spec, callIndex)`:
 * return `'ok'` to succeed or an Error to throw. `calls` records the candidate key each call. */
function mockProvider(decide: (spec: ModelSpec, callIndex: number) => 'ok' | Error): {
  provider: LlmProvider
  calls: string[]
} {
  const calls: string[] = []
  const provider: LlmProvider = {
    async complete(spec) {
      const key = spec.provider ? `${spec.model}|${spec.provider}` : spec.model
      const outcome = decide(spec, calls.length)
      calls.push(key)
      if (outcome instanceof Error) throw outcome
      return turnFor(spec)
    },
  }
  return { provider, calls }
}

test.describe('conformance: ResilientBridge fallback + circuit breaker', () => {
  test('single healthy candidate: returns a turn and records lastModel', async () => {
    const { provider } = mockProvider(() => 'ok')
    const bridge = new ResilientBridge(provider, [{ model: 'deepseek/x' }])
    const turn = await bridge.complete([], [])
    expect(turn.content).toBe('ok:deepseek/x')
    expect(bridge.lastModel).toBe('deepseek/x')
  })

  test('falls over to the next candidate when the first fails', async () => {
    const { provider, calls } = mockProvider((s) => (s.model === 'bad' ? new Error('boom') : 'ok'))
    const bridge = new ResilientBridge(provider, [{ model: 'bad' }, { model: 'good' }])
    const turn = await bridge.complete([], [])
    expect(turn.content).toBe('ok:good')
    expect(bridge.lastModel).toBe('good')
    expect(calls).toEqual(['bad', 'good'])
  })

  test('a persistently-failing candidate TRIPS after threshold, then is SKIPPED (not re-hammered)', async () => {
    const { provider, calls } = mockProvider(() => new Error('always down'))
    const bridge = new ResilientBridge(provider, [{ model: 'dead', provider: 'fp8' }], { breakerThreshold: 2 })
    // call 1 → fails (n=1, not tripped) → throws exhausted
    await expect(bridge.complete([], [])).rejects.toThrow(/exhausted/)
    // call 2 → fails (n=2 → tripped) → throws
    await expect(bridge.complete([], [])).rejects.toThrow(/exhausted/)
    // call 3 → candidate already tripped → provider NOT invoked again
    await expect(bridge.complete([], [])).rejects.toThrow(/exhausted/)
    expect(calls.length).toBe(2) // provider hit exactly twice across THREE complete() calls
    expect(bridge.allTripped).toBe(true)
  })

  test('breaker (threshold 1) trips a bad candidate so later calls skip straight to the good one', async () => {
    const { provider, calls } = mockProvider((s) => (s.model === 'bad' ? new Error('down') : 'ok'))
    const bridge = new ResilientBridge(provider, [{ model: 'bad' }, { model: 'good' }], { breakerThreshold: 1 })
    await bridge.complete([], []) // bad fails→tripped, good ok
    await bridge.complete([], []) // bad skipped, good ok
    expect(calls).toEqual(['bad', 'good', 'good']) // 'bad' tried only once
    expect(bridge.lastModel).toBe('good')
  })

  test('a success RESETS the consecutive-failure counter (a lone blip never trips)', async () => {
    // fail, ok (reset), fail, ok → with threshold 2 the candidate must NEVER trip.
    const script: Array<'ok' | Error> = [new Error('blip'), 'ok', new Error('blip'), 'ok']
    const { provider } = mockProvider((_s, i) => script[i] ?? 'ok')
    const bridge = new ResilientBridge(provider, [{ model: 'flaky' }], { breakerThreshold: 2 })
    await expect(bridge.complete([], [])).rejects.toThrow() // fail (n=1)
    expect((await bridge.complete([], [])).content).toBe('ok:flaky') // ok → reset
    await expect(bridge.complete([], [])).rejects.toThrow() // fail (n=1 again, NOT 2)
    expect((await bridge.complete([], [])).content).toBe('ok:flaky') // still healthy, not tripped
    expect(bridge.allTripped).toBe(false)
  })

  test('emits breaker telemetry events', async () => {
    const events: string[] = []
    const { provider } = mockProvider(() => new Error('down'))
    const bridge = new ResilientBridge(provider, [{ model: 'dead' }], {
      breakerThreshold: 1,
      onEvent: (e) => events.push(e.type),
    })
    await expect(bridge.complete([], [])).rejects.toThrow()
    expect(events).toContain('attempt')
    expect(events).toContain('failure')
    expect(events).toContain('tripped')
    expect(events).toContain('exhausted')
  })

  test('rejects construction with zero candidates', () => {
    const { provider } = mockProvider(() => 'ok')
    expect(() => new ResilientBridge(provider, [])).toThrow(/≥1 candidate/)
  })
})
