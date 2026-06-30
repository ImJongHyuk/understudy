/**
 * The "authenticate once" setup project for the Cookie-Notes reference consumer.
 * Same generic CORE lifecycle (`ensureAuth`) as the other consumers — only the
 * adapter differs. Proves capture-once-reuse works for an httpOnly-cookie session
 * too: the cookie is captured into storageState and reused, with NO extra-state.
 */
import { test as setup } from '@playwright/test'
import { ensureAuth } from '../../core/auth-prefill'
import { cookieAuthAdapter } from './auth.adapter'

setup('authenticate', async ({ browser }) => {
  await ensureAuth(browser, cookieAuthAdapter)
})
