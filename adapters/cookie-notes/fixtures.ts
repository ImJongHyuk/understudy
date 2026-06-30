/**
 * The `test` the Cookie-Notes specs import. Composes browser auth (httpOnly `sid`
 * cookie via storageState) + state seed (a machine-auth SeedSession, auto torn
 * down) — identical CORE machinery as the other adapters, proving the boundary
 * holds for a third, divergent consumer (a server-side cookie session, no
 * extra-state).
 */
import { makeAuthedTest, expect } from '../../core/auth-prefill'
import { openSeedSession, type SeedSession } from '../../core/state-seed'
import { cookieAuthAdapter } from './auth.adapter'
import { cookieSeedAdapter } from './seed.adapter'

export const test = makeAuthedTest(cookieAuthAdapter).extend<{ seed: SeedSession }>({
  seed: async ({}, use) => {
    const session = await openSeedSession(cookieSeedAdapter)
    try {
      await use(session)
    } finally {
      await session.cleanup() // teardown ALWAYS, even on test failure
      await session.request.dispose()
    }
  },
})

export { expect }
export type { SeedSession } from '../../core/state-seed'
