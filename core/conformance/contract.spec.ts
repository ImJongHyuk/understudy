/**
 * Adapter-contract CONFORMANCE — the generic suite the CORE ships that makes
 * "project-agnostic" VERIFIABLE, not aspirational. These test the CORE lifecycle
 * + safety invariants against fakes (no real backend, no browser), so they lock in
 * L3/L6/L7/L9 and protect every future adapter + every core change.
 *
 * Auth-lifecycle conformance that needs a real served app (probe re-capture,
 * extra-state round-trip) is exercised against the live/mock profiles, not here.
 */
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { SeedSession, openSeedSession } from '../state-seed'
import type { SeedAdapter } from '../state-seed'
import { assertPreflight } from '../auth-prefill'

const fakeRequest = {} as APIRequestContext

test.describe('conformance: SeedSession non-fixture guard + teardown (L7)', () => {
  test('track REFUSES a non-fixture resource name', () => {
    const s = new SeedSession(fakeRequest, 'fix-', 'run1')
    expect(() =>
      s.track({ kind: 'x', id: '1', name: 'not-prefixed' }, async () => {}),
    ).toThrow(/Refusing to track non-fixture/)
  })

  test('session.name auto-prefixes, and that name is trackable', () => {
    const s = new SeedSession(fakeRequest, 'fix-', 'run1')
    const name = s.name('credential')
    expect(name.startsWith('fix-')).toBe(true)
    expect(() =>
      s.track({ kind: 'credential', id: '1', name }, async () => {}),
    ).not.toThrow()
  })

  test('cleanup deletes tracked fixtures in REVERSE order', async () => {
    const order: string[] = []
    const s = new SeedSession(fakeRequest, 'fix-', 'run1')
    s.track({ kind: 'a', id: 'a1', name: s.name('a') }, async () => {
      order.push('a')
    })
    s.track({ kind: 'b', id: 'b1', name: s.name('b') }, async () => {
      order.push('b')
    })
    await s.cleanup()
    expect(order).toEqual(['b', 'a'])
  })

  test('cleanup RE-THROWS when a delete fails (potential leak = loud)', async () => {
    const s = new SeedSession(fakeRequest, 'fix-', 'run1')
    s.track({ kind: 'a', id: 'a1', name: s.name('a') }, async () => {
      throw new Error('boom')
    })
    await expect(s.cleanup()).rejects.toThrow(/Seed teardown failed/)
  })
})

test.describe('conformance: safe-target gate fires before any write (L6, cannot-run=RED)', () => {
  function unsafeAdapter(onBuild: () => void): SeedAdapter {
    return {
      id: 'conformance:unsafe',
      fixturePrefix: 'fix-',
      assertSafeTarget() {
        throw new Error('Unsafe seed target vault')
      },
      async newRequestContext() {
        onBuild()
        return fakeRequest
      },
    }
  }

  test('openSeedSession throws (cannot-run) on an unsafe target', async () => {
    await expect(openSeedSession(unsafeAdapter(() => {}))).rejects.toThrow(
      /Unsafe seed target/,
    )
  })

  test('it does NOT build the authed request context when the target is unsafe', async () => {
    let built = false
    await expect(
      openSeedSession(unsafeAdapter(() => (built = true))),
    ).rejects.toThrow()
    expect(built).toBe(false) // the gate fires BEFORE machine auth
  })
})

test.describe('conformance: preflight aggregation (L3)', () => {
  test('aggregates missing keys across adapters and throws ONCE', () => {
    expect(() =>
      assertPreflight([{ preflight: () => ['A'] }, { preflight: () => ['B'] }]),
    ).toThrow(/A, B/)
  })

  test('passes when nothing is missing (adapters without preflight are fine)', () => {
    expect(() => assertPreflight([{ preflight: () => [] }, {}])).not.toThrow()
  })
})
