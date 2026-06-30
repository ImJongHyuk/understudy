/**
 * OIDC auth adapter — the FOURTH consumer, and the hardest auth MECHANISM for the contract: a real
 * OAuth2/OIDC authorization-code REDIRECT flow (oauth2-proxy as the relying party in front of Dex as
 * the IdP; see adapters/oidc/docker-compose.yml). Its purpose is to pressure-test "auth is
 * mechanism-agnostic" at the limit: a multi-hop, cross-origin redirect to an external IdP login form,
 * then a callback that establishes a SESSION COOKIE.
 *
 * The whole protocol stays INSIDE this adapter — `login()` drives the redirect dance like a human; the
 * core never sees OIDC. The session is an oauth2-proxy cookie, so Playwright `storageState` carries it
 * natively (no extra-state). Freshness is the behavioural probe, never token/claim parsing — so token
 * expiry just makes the probe fail → the core re-runs `login()` (refresh/`exp` logic isn't core's
 * concern). Hermetic: the user is a FIXED throwaway declared in dex.config.yaml; no secrets.
 */
import { expect, type Page } from '@playwright/test'
import type { AuthAdapter } from '../../core/auth-prefill'

const ORIGIN = process.env.OIDC_BASE_URL ?? 'http://localhost:4180'

/** Fixed throwaway user — declared in dex.config.yaml staticPasswords; NOT a credential. */
export const TEST_USER = {
  email: 'understudy-e2e@example.com',
  password: 'Password123!',
} as const

export const oidcAuthAdapter: AuthAdapter = {
  id: 'oidc:user',
  origin: ORIGIN,
  // Session = the oauth2-proxy cookie → storageState persists it natively. No captureExtraState.

  async login(page: Page) {
    // The REAL authorization-code redirect dance, driven like a human:
    //   RP (/) --302--> IdP login form --creds--> consent --callback--> session cookie --> protected app.
    await page.goto('/') // oauth2-proxy redirects an unauthenticated visitor to the Dex login form
    await page.getByPlaceholder('email address').fill(TEST_USER.email)
    await page.getByPlaceholder('password').fill(TEST_USER.password)
    await page.getByRole('button', { name: 'Login' }).click()
    // Dex consent screen (this build does not honor skipApprovalScreen) — grant if it appears. Kept
    // conditional so the adapter is robust whether or not consent is shown.
    const grant = page.getByRole('button', { name: 'Grant Access' })
    if (await grant.isVisible({ timeout: 5_000 }).catch(() => false)) await grant.click()
    // Back on the protected upstream, authenticated — it echoes our injected identity.
    await expect(page.getByText(TEST_USER.email)).toBeVisible({ timeout: 15_000 })
  },

  async assertAuthenticated(page: Page) {
    // Probe a protected surface. A valid cached session cookie → the RP serves the upstream (which
    // echoes the oauth2-proxy-injected email); an invalid/expired one → the RP 302s to the IdP login
    // (no email present) and this throws, forcing a fresh login(). No token parsing — purely behavioural.
    await page.goto('/')
    await expect(page.getByText(TEST_USER.email)).toBeVisible({ timeout: 15_000 })
  },
}
