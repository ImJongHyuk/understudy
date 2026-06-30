/**
 * Cookie-Notes reference-consumer config — the THIRD adapter on the SAME core.
 * Same setup-project + storageState + dependencies pattern as the other consumers;
 * only the adapter import differs. Proves the harness onboards a divergent consumer
 * (httpOnly server-session-cookie auth, no extra-state, no vault) with adapter code
 * only — core unchanged. The opaque `sid` cookie is carried by storageState
 * NATIVELY, so there is nothing mechanism-specific in this config.
 *
 * Run against the local hermetic Cookie-Notes app:
 *   bun run cookie:up   # docker (app :3100)
 *   bun run e2e:cookie
 */
import { defineConfig, devices } from '@playwright/test'
import { authArtifacts } from './core/auth-prefill'
import { cookieAuthAdapter } from './adapters/cookie-notes/auth.adapter'

const { storageStatePath } = authArtifacts(cookieAuthAdapter)

export default defineConfig({
  // B10 host guard (localhost only) before any browser launches.
  globalSetup: './adapters/cookie-notes/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  projects: [
    { name: 'setup', testDir: './adapters/cookie-notes', testMatch: /\/setup\.ts$/ },
    {
      name: 'cookie',
      testDir: './adapters/cookie-notes/specs',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: cookieAuthAdapter.origin,
        storageState: storageStatePath, // httpOnly `sid` cookie carried natively
        trace: 'retain-on-failure',
      },
      dependencies: ['setup'],
    },
  ],
})
