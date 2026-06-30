/**
 * The "authenticate once" setup project for the OIDC reference consumer. Same generic CORE lifecycle
 * (`ensureAuth`) as every other adapter — only the adapter differs. Proves capture-once-reuse works
 * for an OAuth2/OIDC redirect-flow app (session cookie) too, core unchanged.
 */
import { test as setup } from '@playwright/test'
import { ensureAuth } from '../../core/auth-prefill'
import { oidcAuthAdapter } from './auth.adapter'

setup('authenticate', async ({ browser }) => {
  await ensureAuth(browser, oidcAuthAdapter)
})
