/**
 * The `test` the Vikunja specs import. Composes browser auth (localStorage JWT via storageState) +
 * state seed (a machine-auth SeedSession, auto torn down) — the IDENTICAL core machinery as the
 * other consumers, proving the boundary holds for a 4th, richer one with adapter code only.
 */
import { makeAuthedTest, expect } from '../../core/auth-prefill'
import { openSeedSession, type SeedSession } from '../../core/state-seed'
import { vikunjaAuthAdapter } from './auth.adapter'
import { vikunjaSeedAdapter } from './seed.adapter'

export const test = makeAuthedTest(vikunjaAuthAdapter).extend<{ seed: SeedSession }>({
  seed: async ({}, use) => {
    const session = await openSeedSession(vikunjaSeedAdapter)
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
