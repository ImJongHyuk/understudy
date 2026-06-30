/**
 * Vikunja reference-consumer config — a 4th adapter (richer surface) on the SAME core. Same
 * setup-project + storageState + dependencies pattern as the other consumers; only the adapter
 * import differs. Proves the harness onboards a divergent, richer consumer with adapter code only —
 * core unchanged.
 *
 * Run against the local hermetic Vikunja app:  bun run vikunja:up && bun run e2e:vikunja
 */
import { defineConfig, devices } from '@playwright/test'
import { authArtifacts } from './core/auth-prefill'
import { vikunjaAuthAdapter } from './adapters/vikunja/auth.adapter'

const { storageStatePath } = authArtifacts(vikunjaAuthAdapter)

export default defineConfig({
  // B10 host guard (localhost only) before any browser launches.
  globalSetup: './adapters/vikunja/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  projects: [
    { name: 'setup', testDir: './adapters/vikunja', testMatch: /\/setup\.ts$/ },
    {
      name: 'vikunja',
      testDir: './adapters/vikunja/specs',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: vikunjaAuthAdapter.origin,
        storageState: storageStatePath, // localStorage JWT carried natively
        trace: 'retain-on-failure',
      },
      dependencies: ['setup'],
    },
  ],
})
