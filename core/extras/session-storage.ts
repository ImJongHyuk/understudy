/**
 * OPTIONAL extra-state helper — sessionStorage. Part of `understudy`.
 *
 * This is the ONE mechanism-specific helper the core SHIPS but never REQUIRES. It
 * is quarantined here (NOT in the auth-prefill lifecycle) precisely so the AUTH
 * invariant stays verifiable: `core/auth-prefill.ts` (the lifecycle) depends on no
 * mechanism, and the only mechanism code in `core/` lives under `core/extras/`,
 * imported solely by adapters that opt in. See CLAUDE.md "Auth is
 * mechanism-agnostic" + docs/CONTRACT-LESSONS.md L9/L10.
 *
 * Playwright's `storageState` carries cookies + localStorage + IndexedDB but NOT
 * sessionStorage. An adapter whose app keeps load-bearing state in sessionStorage
 * spreads this into its AuthAdapter:
 *
 *   export const myAdapter: AuthAdapter = {
 *     id, origin, login, assertAuthenticated,
 *     ...sessionStorageExtra(origin),
 *   }
 */
import type { BrowserContext, Page } from '@playwright/test'
import type { AuthAdapter } from '../auth-prefill'

export function sessionStorageExtra(
  origin: string,
): Pick<AuthAdapter, 'captureExtraState' | 'restoreExtraState'> {
  const host = new URL(origin).hostname
  return {
    async captureExtraState(page: Page) {
      const dump = await page.evaluate(() => JSON.stringify(window.sessionStorage))
      return JSON.parse(dump) as Record<string, string>
    },
    async restoreExtraState(context: BrowserContext, state: Record<string, string>) {
      // Hostname-guarded: the agent may traverse the IdP domain during a redirect;
      // never seed there.
      await context.addInitScript(
        (arg: { host: string; dump: Record<string, string> }) => {
          if (window.location.hostname !== arg.host) return
          for (const [k, v] of Object.entries(arg.dump))
            window.sessionStorage.setItem(k, v)
        },
        { host, dump: state },
      )
    },
  }
}
