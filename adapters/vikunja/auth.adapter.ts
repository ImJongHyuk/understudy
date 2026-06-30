/**
 * Vikunja auth adapter — the FOURTH consumer (3rd public), a HERMETIC reference with a RICHER
 * surface than Conduit. Auth mechanism: a JWT in localStorage (key `token`), so Playwright
 * `storageState` carries it natively — same MECHANISM family as the RealWorld consumer, which is the
 * point: a divergent, richer app drops onto the SAME mechanism-agnostic core with adapter code only.
 *
 * Hermetic: the test user is a FIXED throwaway (not a secret) created on demand via the public
 * register endpoint (registration is enabled in the local stack).
 */
import { expect, type Page } from '@playwright/test'
import type { AuthAdapter } from '../../core/auth-prefill'

// The browser SUT is the from-source Vite dev frontend (:4173); it proxies /api → the backend.
const ORIGIN = process.env.VIKUNJA_BASE_URL ?? 'http://localhost:4173'

/** A fixed, throwaway local user — NOT a credential (the app is hermetic). */
export const TEST_USER = {
  username: 'understudy-e2e',
  email: 'understudy-e2e@example.com',
  password: 'Password123!',
} as const

export const vikunjaAuthAdapter: AuthAdapter = {
  id: 'vikunja:user',
  origin: ORIGIN,
  // No extra-state: the JWT lives in localStorage('token'), which storageState persists natively.

  async login(page: Page) {
    // Ensure the fixed user exists (register-if-needed; an "already exists" is a resolved response,
    // not a throw). Same origin as the SPA, so the relative /api/v1 path works.
    await page.request.post('/api/v1/register', {
      data: { username: TEST_USER.username, email: TEST_USER.email, password: TEST_USER.password },
    })
    // Real UI login → the SPA writes the JWT to localStorage('token'). The form is a hydrated SPA;
    // click-then-fill (not bare fill) so the framework's v-model captures the value before submit.
    await page.goto('/login')
    const user = page.getByRole('textbox', { name: /username or email/i })
    await user.waitFor({ state: 'visible' })
    await user.click()
    await user.fill(TEST_USER.username)
    const pass = page.getByRole('textbox', { name: 'Password' })
    await pass.click()
    await pass.fill(TEST_USER.password)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    // Wait until the SPA has authenticated before returning (else storageState is captured
    // mid-login). The authed signal is the user-menu button named after the USERNAME — data, so it
    // is LOCALE-INVARIANT (a localized nav label like "Projects"/"Projekte" would couple the probe
    // to the UI language; the username never changes with locale).
    await expect(page.getByRole('button', { name: TEST_USER.username })).toBeVisible({ timeout: 15_000 })
  },

  async assertAuthenticated(page: Page) {
    await page.goto('/')
    // Locale-invariant authed signal: the user-menu button named after the USERNAME (data, not a
    // translated label) — renders only when logged in.
    await expect(page.getByRole('button', { name: TEST_USER.username })).toBeVisible({ timeout: 15_000 })
    // SERVER-validate the cached session (L8): the localStorage JWT must resolve to a real user via
    // GET /api/v1/user. The dev DB is ephemeral across stack restarts, so a cached token can be for
    // a user that no longer exists — that is NOT a valid session and must force a fresh login().
    const serverValid = await page.evaluate(async () => {
      const token = window.localStorage.getItem('token')
      if (!token) return false
      const res = await fetch('/api/v1/user', { headers: { Authorization: `Bearer ${token}` } })
      return res.ok
    })
    if (!serverValid) {
      throw new Error(
        'cached Vikunja session is not server-valid (GET /api/v1/user rejected the token) — re-login required',
      )
    }
  },
}
