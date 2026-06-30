/**
 * CONFORMANCE profile — runs the CORE contract + trust-machinery suite (pure-unit;
 * no browser, no network, no target). This is how "project-agnostic" + the
 * server-like boundaries (B10/B11) + the mechanism-agnostic auth invariant (L10)
 * become VERIFIABLE. Run: `bun run conformance`.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './core/conformance',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
})
