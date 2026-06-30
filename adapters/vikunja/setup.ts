/**
 * The "authenticate once" setup project for the Vikunja reference consumer. The SAME generic core
 * lifecycle (`ensureAuth`) as the other consumers — only the adapter differs.
 */
import { test as setup } from '@playwright/test'
import { ensureAuth } from '../../core/auth-prefill'
import { vikunjaAuthAdapter } from './auth.adapter'

setup('authenticate', async ({ browser }) => {
  await ensureAuth(browser, vikunjaAuthAdapter)
})
