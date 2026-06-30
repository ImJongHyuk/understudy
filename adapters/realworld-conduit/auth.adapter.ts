/**
 * RealWorld (Conduit) auth adapter — the SECOND consumer, a HERMETIC reference
 * with NO secrets and NO external infra (a local Conduit app). Its purpose is to
 * pressure-test the generic contract against a DIFFERENT auth mechanism than a
 * cookie/BFF consumer: the Conduit SPA stores its JWT in localStorage (key `loggedUser`), so
 * Playwright `storageState` carries it natively — no extra-state, no cookie BFF.
 * This is the mechanism-agnostic core's counterpoint proof (verified 2026-06-17).
 *
 * Hermetic: the test user is a FIXED throwaway (not a secret) that the adapter
 * creates on demand via the public register endpoint.
 */
import { expect, type Page } from '@playwright/test'
import type { AuthAdapter } from '../../core/auth-prefill'

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

/** A fixed, throwaway local user — NOT a credential (the app is hermetic). */
export const TEST_USER = {
  username: 'understudy-e2e',
  email: 'understudy-e2e@example.com',
  password: 'Password123!',
} as const

export const realworldAuthAdapter: AuthAdapter = {
  id: 'realworld-conduit:user',
  origin: ORIGIN,
  // No usesSessionStorage / no extra-state: the JWT lives in localStorage, which
  // storageState persists natively. (See module header.)

  async login(page: Page) {
    // Ensure the fixed user exists (register-if-needed; an "already exists" 422 is
    // fine — it's a resolved response, not a throw). Goes through the SPA's /api
    // proxy.
    await page.request.post('/api/users', {
      data: {
        user: {
          username: TEST_USER.username,
          email: TEST_USER.email,
          password: TEST_USER.password,
        },
      },
    })
    // Real UI login → the SPA writes the JWT to localStorage('loggedUser').
    // NOTE: this Conduit build uses HASH routing (#/login), not path routing.
    await page.goto('/#/login')
    await page.getByPlaceholder('Email').fill(TEST_USER.email)
    await page.getByPlaceholder('Password').fill(TEST_USER.password)
    await page.getByRole('button', { name: /login/i }).click()
    // Wait until the SPA has actually persisted the session before returning —
    // otherwise storageState is captured mid-login (the async POST → localStorage
    // write races the capture). The authed-only "New Article" nav link is the signal.
    await expect(page.getByRole('link', { name: /new article/i })).toBeVisible({
      timeout: 15_000,
    })
  },

  async assertAuthenticated(page: Page) {
    await page.goto('/')
    // "New Article" renders only when authenticated (client-side nav signal).
    await expect(page.getByRole('link', { name: /new article/i })).toBeVisible({
      timeout: 15_000,
    })
    // SERVER-validate the cached session (L8: verify what actually authorizes). The
    // nav link is client-only; the dev DB is ephemeral across stack restarts, so a
    // cached localStorage token can be for a user that no longer exists server-side.
    // GET /api/user must resolve the token to a real user — else this is NOT a valid
    // session and the probe fails, forcing a fresh login() (which re-registers).
    const serverValid = await page.evaluate(async () => {
      const raw = window.localStorage.getItem('loggedUser')
      if (!raw) return false
      let token: string | undefined
      try {
        // The SPA stores { headers, isAuth, loggedUser: { token, ... } }.
        const stored = JSON.parse(raw) as { loggedUser?: { token?: string } }
        token = stored.loggedUser?.token
      } catch {
        return false
      }
      if (!token) return false
      const res = await fetch('/api/user', { headers: { Authorization: `Token ${token}` } })
      return res.ok
    })
    if (!serverValid) {
      throw new Error(
        'cached session is not server-valid (GET /api/user rejected the token) — re-login required',
      )
    }
  },
}
