/**
 * Auth-lifecycle CONFORMANCE — app-free proof of `ensureAuth`'s PROBE control flow
 * (L9). The freshness rule is "restore cached state → run `assertAuthenticated`;
 * reuse on pass, re-`login()`+re-persist on fail" — NEVER token introspection,
 * NEVER a silent skip. This locks that control flow against a FAKE AuthAdapter so it
 * needs no served app, no network, no real auth mechanism:
 *
 *   - `login(page)` just navigates to `about:blank` and bumps a counter (so we can
 *     assert HOW MANY times the core authenticated live).
 *   - `assertAuthenticated(page)` passes/throws off a mutable we control — this IS a
 *     probe over an arbitrary mechanism, since the core never inspects credentials.
 *
 * Uses the real `browser` fixture (chromium) — `ensureAuth` opens real contexts and
 * persists a real `storageState` to `playwright/.auth`, so this exercises the actual
 * capture/restore path, not a stub. Each case uses a unique adapter id and wipes its
 * `.auth` artifacts first so cases never leak cached state into one another.
 *
 * The mechanism-specific re-capture against a SERVED app (cookie expiry, extra-state
 * round-trip) is exercised on the live/mock profiles; here we prove the
 * mechanism-NEUTRAL control flow.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import { ensureAuth, authArtifacts, type AuthAdapter } from '../auth-prefill'

/** A served-app-free AuthAdapter whose login is a counter and whose probe is a knob. */
interface FakeAuth {
  adapter: AuthAdapter
  /** how many times the core ran live `login()` */
  logins(): number
  /** make the next `assertAuthenticated` call throw `times` times, then pass */
  failProbe(times: number): void
}

function makeFakeAuth(id: string): FakeAuth {
  let loginCount = 0
  let probeFailsLeft = 0
  const adapter: AuthAdapter = {
    id,
    origin: 'about:blank',
    async login(page: Page) {
      loginCount += 1
      await page.goto('about:blank') // no served app — proves login is mechanism-free
    },
    async assertAuthenticated(_page: Page) {
      if (probeFailsLeft > 0) {
        probeFailsLeft -= 1
        throw new Error('probe: not authenticated')
      }
    },
  }
  return {
    adapter,
    logins: () => loginCount,
    failProbe: (times: number) => {
      probeFailsLeft = times
    },
  }
}

/** Remove any cached artifacts for this adapter id so each case starts from no-cache. */
function wipeAuthArtifacts(adapter: AuthAdapter): void {
  const { storageStatePath, extraStatePath } = authArtifacts(adapter)
  for (const p of [storageStatePath, extraStatePath]) {
    try {
      fs.rmSync(p)
    } catch {
      /* absent is the desired state */
    }
  }
}

test.describe('conformance: ensureAuth PROBE control flow (L9, app-free)', () => {
  test('NO cache → authenticates exactly once and persists storageState', async ({
    browser,
  }) => {
    const fake = makeFakeAuth('conformance:auth-no-cache')
    wipeAuthArtifacts(fake.adapter)
    const { storageStatePath } = authArtifacts(fake.adapter)
    expect(fs.existsSync(storageStatePath)).toBe(false)

    await ensureAuth(browser, fake.adapter)

    expect(fake.logins()).toBe(1) // authenticated live once
    expect(fs.existsSync(storageStatePath)).toBe(true) // and persisted the capture
  })

  test('cache present + probe PASSES → REUSES it, never re-authenticates', async ({
    browser,
  }) => {
    const fake = makeFakeAuth('conformance:auth-reuse')
    wipeAuthArtifacts(fake.adapter)

    await ensureAuth(browser, fake.adapter) // first run: no cache → login #1 + persist
    expect(fake.logins()).toBe(1)

    await ensureAuth(browser, fake.adapter) // probe passes → reuse, no new login
    expect(fake.logins()).toBe(1)
  })

  test('cache present + probe FAILS once → RE-authenticates (never silent-skips)', async ({
    browser,
  }) => {
    const fake = makeFakeAuth('conformance:auth-recapture')
    wipeAuthArtifacts(fake.adapter)

    await ensureAuth(browser, fake.adapter) // no cache → login #1 + persist
    expect(fake.logins()).toBe(1)

    fake.failProbe(1) // cached state goes stale: probe fails exactly once, then passes
    await ensureAuth(browser, fake.adapter)
    expect(fake.logins()).toBe(2) // stale probe forced a re-capture, not a skip

    await ensureAuth(browser, fake.adapter) // probe healthy again → reuse, no new login
    expect(fake.logins()).toBe(2)
  })
})
