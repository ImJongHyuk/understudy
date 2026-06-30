/**
 * OIDC reference-consumer config — the FOURTH adapter on the SAME core. Same setup-project +
 * storageState + dependencies pattern as the others; only the adapter import differs. Proves the
 * harness onboards an OAuth2/OIDC redirect-flow consumer (the hardest auth mechanism) with adapter
 * code only — core unchanged.
 *
 * Run against the local hermetic OIDC stack:
 *   bun run oidc:up && bun run e2e:oidc
 */
import { defineConfig, devices } from '@playwright/test'
import { authArtifacts } from './core/auth-prefill'
import { oidcAuthAdapter } from './adapters/oidc/auth.adapter'

const { storageStatePath } = authArtifacts(oidcAuthAdapter)

export default defineConfig({
  // B10 host guard (localhost only) before any browser launches.
  globalSetup: './adapters/oidc/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  projects: [
    { name: 'setup', testDir: './adapters/oidc', testMatch: /\/setup\.ts$/ },
    {
      name: 'oidc',
      testDir: './adapters/oidc/specs',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: oidcAuthAdapter.origin,
        storageState: storageStatePath, // the oauth2-proxy session cookie, carried natively
        trace: 'retain-on-failure',
      },
      dependencies: ['setup'],
    },
  ],
})
