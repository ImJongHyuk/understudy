/**
 * The "authenticate once" setup project for the RealWorld reference consumer.
 * Same generic CORE lifecycle (`ensureAuth`) as the first consumer — only the adapter
 * differs. Proves capture-once-reuse works for a localStorage-JWT app too.
 */
import { test as setup } from '@playwright/test'
import { ensureAuth } from '../../core/auth-prefill'
import { realworldAuthAdapter } from './auth.adapter'

setup('authenticate', async ({ browser }) => {
  await ensureAuth(browser, realworldAuthAdapter)
})
