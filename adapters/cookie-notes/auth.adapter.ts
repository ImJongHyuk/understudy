/**
 * Cookie-Notes auth adapter — the THIRD consumer, a HERMETIC reference with NO
 * secrets and NO external infra (a local notes app). Its whole POINT is an auth
 * mechanism the other reference consumers lack: an httpOnly SERVER SESSION COOKIE
 * (opaque `sid`, NOT readable by JS), backed by an in-memory session store.
 *
 * Counterpoint to the RealWorld consumer (a JWT in localStorage): there the
 * credential is JS-readable and the harness can SERVER-validate it by replaying
 * the token; here the credential is a server-side session reachable ONLY via the
 * cookie. Playwright's `storageState` carries cookies NATIVELY, so this adapter
 * needs NO usesSessionStorage and NO captureExtraState/restoreExtraState — the
 * mechanism-agnostic proof that a cookie session drops onto the same core with
 * zero extra-state. `assertAuthenticated` can never PARSE the cookie; it can only
 * PROBE it at runtime (GET /api/me).
 *
 * Hermetic: the test user is a FIXED throwaway (not a secret) that the app
 * self-creates on first login (register-if-needed) — so no seeding step.
 */
import { expect, type Page } from '@playwright/test'
import type { AuthAdapter } from '../../core/auth-prefill'

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100'

/** A fixed, throwaway local user — NOT a credential (the app is hermetic). */
export const TEST_USER = {
  username: 'e2e-user',
  password: 'e2e-pass',
} as const

export const cookieAuthAdapter: AuthAdapter = {
  id: 'cookie-notes:user',
  origin: ORIGIN,
  // No usesSessionStorage / no captureExtraState: the session lives ONLY in the
  // httpOnly `sid` cookie, which storageState persists natively. (See header.)

  async login(page: Page) {
    // Real UI login → the app sets the httpOnly `sid` cookie on the redirect.
    // NOTE: this app uses PATH routing (/login), not hash routing.
    await page.goto('/login')
    await page.getByLabel('Username').fill(TEST_USER.username)
    await page.getByLabel('Password').fill(TEST_USER.password)
    await page.getByRole('button', { name: /sign in/i }).click()
    // Wait until the server has actually established the session before returning
    // (L13: block until persisted) — otherwise storageState is captured mid-login
    // (the redirect + Set-Cookie races the capture). The authed-only "New note"
    // link is the signal that the session cookie is live.
    await expect(page.getByRole('link', { name: /new note/i })).toBeVisible({
      timeout: 15_000,
    })
  },

  async assertAuthenticated(page: Page) {
    await page.goto('/')
    // SERVER-validate the cached session (L8: verify what actually authorizes).
    // The opaque httpOnly `sid` cookie can't be parsed; the ONLY proof it carries
    // a live session is to hit the server probe. The in-memory store is ephemeral
    // across stack restarts, so a stale cookie no longer maps to a session — GET
    // /api/me must return ok, else this is NOT a valid session and the probe fails,
    // forcing a fresh login(). The fetch runs in the page so the cookie rides along.
    const serverValid = await page.evaluate(async () => {
      const res = await fetch('/api/me', { credentials: 'same-origin' })
      return res.ok
    })
    if (!serverValid) {
      throw new Error(
        'cached session is not server-valid (GET /api/me rejected the cookie) — re-login required',
      )
    }
  },
}
