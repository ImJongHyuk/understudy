/**
 * RealWorld reference-consumer config — the SECOND adapter on the SAME core. Same
 * setup-project + storageState + dependencies pattern as the first consumer; only the
 * adapter import differs. Proves the harness onboards a divergent consumer
 * (localStorage-JWT auth, no vault) with adapter code only — core unchanged.
 *
 * Run against the local hermetic Conduit app:
 *   docker + `npm run dev` (frontend :3000, API :3001), then `bun run e2e:realworld`.
 */
import { defineConfig, devices } from '@playwright/test'
import { authArtifacts } from './core/auth-prefill'
import { realworldAuthAdapter } from './adapters/realworld-conduit/auth.adapter'

const { storageStatePath } = authArtifacts(realworldAuthAdapter)

export default defineConfig({
  // B10 host guard (localhost only) before any browser launches.
  globalSetup: './adapters/realworld-conduit/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  projects: [
    { name: 'setup', testDir: './adapters/realworld-conduit', testMatch: /\/setup\.ts$/ },
    {
      name: 'realworld',
      testDir: './adapters/realworld-conduit/specs',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: realworldAuthAdapter.origin,
        storageState: storageStatePath, // localStorage JWT carried natively
        trace: 'retain-on-failure',
      },
      dependencies: ['setup'],
    },
  ],
})
