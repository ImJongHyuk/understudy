/**
 * The `test` the RealWorld specs import. Composes browser auth (localStorage JWT
 * via storageState) + state seed (a machine-auth SeedSession, auto torn down) —
 * identical CORE machinery as the first adapter, proving the boundary holds for
 * a second, divergent consumer.
 */
import { makeAuthedTest, expect } from '../../core/auth-prefill'
import { openSeedSession, type SeedSession } from '../../core/state-seed'
import { realworldAuthAdapter } from './auth.adapter'
import { realworldSeedAdapter } from './seed.adapter'

export const test = makeAuthedTest(realworldAuthAdapter).extend<{ seed: SeedSession }>({
  seed: async ({}, use) => {
    const session = await openSeedSession(realworldSeedAdapter)
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
