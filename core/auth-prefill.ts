/**
 * Generic auth-prefill engine — PROJECT-AGNOSTIC and MECHANISM-AGNOSTIC.
 * Part of `understudy`.
 *
 * Implements the canonical Playwright auth pattern (authenticate once → persist →
 * reuse via a `setup` project + `dependencies`) WITHOUT knowing the auth
 * mechanism. The core owns only the lifecycle:
 *
 *   login → capture → restore → verify → refresh
 *
 * and checks freshness with a runtime PROBE (`assertAuthenticated` on the restored
 * state), never by parsing tokens/cookies. Persistence defaults to Playwright's
 * native `storageState` (cookies + localStorage + IndexedDB). State storageState
 * can't carry (e.g. sessionStorage) is an OPTIONAL, adapter-declared extra
 * (`captureExtraState`/`restoreExtraState`); a `sessionStorageExtra(origin)` helper
 * is provided for that common case — opt-in, never a core premise.
 *
 * Whether the app uses a cookie/BFF session, a bearer token, sessionStorage, or
 * social OAuth is 100% the adapter's concern (see CLAUDE.md "Auth is
 * mechanism-agnostic" + docs/CONTRACT-LESSONS.md L8/L9/L10). To onboard a new web
 * project you implement one adapter — nothing here changes.
 */
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Everything a per-project adapter must supply for the prefill engine. The core
 * never inspects HOW authentication works — only this lifecycle surface.
 */
export interface AuthAdapter {
  /** Stable key per (project, user/role) → state file names. e.g. "myapp:user". */
  readonly id: string
  /** App origin under test — setup-context baseURL + extra-state hostname guard. */
  readonly origin: string
  /**
   * Become authenticated by ANY mechanism — drive the real login form, mint a
   * token and inject it, seed a cookie, or no-op for a mock/no-auth target. The
   * page is created with `baseURL = origin`, so relative `goto('/route')` works.
   * After this resolves, the context must be authenticated.
   */
  login(page: Page): Promise<void>
  /**
   * Navigate to a representative PROTECTED surface and throw / fail an expect
   * unless the authenticated UI is present. Used BOTH as the post-login gate AND
   * as the cached-state freshness PROBE — so the core never parses credentials.
   */
  assertAuthenticated(page: Page): Promise<void>
  /**
   * OPTIONAL, mechanism-neutral. `storageState` already carries cookies +
   * localStorage + IndexedDB. Implement this ONLY if the app keeps load-bearing
   * state elsewhere (e.g. sessionStorage). The core stores the returned JSON
   * opaquely and never interprets it. See `sessionStorageExtra`.
   */
  captureExtraState?(page: Page): Promise<Record<string, string>>
  /** OPTIONAL companion to `captureExtraState` — restore it before first navigation. */
  restoreExtraState?(context: BrowserContext, state: Record<string, string>): Promise<void>
  /** Optional preflight (L3): names of required-but-missing env/config. */
  preflight?(): string[]
}

export interface AuthArtifacts {
  /** storageState JSON (cookies + localStorage + IndexedDB). Goes in project `use`. */
  storageStatePath: string
  /** Opaque adapter extra-state JSON (only when `captureExtraState` is implemented). */
  extraStatePath: string
}

const AUTH_DIR = path.resolve(process.cwd(), 'playwright/.auth')

export function authArtifacts(adapter: AuthAdapter): AuthArtifacts {
  const safe = adapter.id.replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    storageStatePath: path.join(AUTH_DIR, `${safe}.storage.json`),
    extraStatePath: path.join(AUTH_DIR, `${safe}.extra.json`),
  }
}

function readJson(p: string): Record<string, string> | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>
  } catch {
    return null
  }
}

/** Restore any adapter extra-state into a context (no-op unless the adapter declares it). */
async function applyExtraState(context: BrowserContext, adapter: AuthAdapter): Promise<void> {
  if (!adapter.restoreExtraState) return
  const state = readJson(authArtifacts(adapter).extraStatePath)
  if (state) await adapter.restoreExtraState(context, state)
}

/**
 * PROBE freshness: open a context from the cached storageState (+ extra), restore
 * extra-state, and run the adapter's `assertAuthenticated`. Any failure (expired
 * cookie, expired token, missing file) means "not fresh" — mechanism-neutral.
 */
async function cachedStateIsValid(browser: Browser, adapter: AuthAdapter): Promise<boolean> {
  const { storageStatePath } = authArtifacts(adapter)
  if (!fs.existsSync(storageStatePath)) return false
  const context = await browser.newContext({
    baseURL: adapter.origin,
    storageState: storageStatePath,
  })
  try {
    await applyExtraState(context, adapter)
    const page = await context.newPage()
    await adapter.assertAuthenticated(page) // the probe
    return true
  } catch {
    return false
  } finally {
    await context.close()
  }
}

/**
 * Run the one-time live authentication and persist storageState (+ optional
 * extra-state). Asserts BEFORE persisting, so a failed login is never frozen into
 * the cache.
 */
async function captureFreshAuth(browser: Browser, adapter: AuthAdapter): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const { storageStatePath, extraStatePath } = authArtifacts(adapter)

  const context = await browser.newContext({ baseURL: adapter.origin })
  const page = await context.newPage()
  try {
    await adapter.login(page)
    await adapter.assertAuthenticated(page) // gate: never persist a failed login
    await context.storageState({ path: storageStatePath })
    if (adapter.captureExtraState) {
      const extra = await adapter.captureExtraState(page)
      fs.writeFileSync(extraStatePath, JSON.stringify(extra), 'utf-8')
    }
  } finally {
    await context.close()
  }
}

/**
 * The whole lifecycle in one call (use from `auth.setup.ts`): probe the cached
 * state and reuse it if the probe passes; otherwise authenticate live and persist.
 * No token/cookie introspection anywhere — freshness is purely behavioural.
 */
export async function ensureAuth(browser: Browser, adapter: AuthAdapter): Promise<void> {
  if (await cachedStateIsValid(browser, adapter)) return
  await captureFreshAuth(browser, adapter)
}

/**
 * Build a `test` whose every context restores the adapter's extra-state (if any)
 * before the first page exists. Cookies/localStorage still arrive via the
 * project-level `use: { storageState }`. For an adapter with no extra-state this is
 * a no-op. Usage: `export const test = makeAuthedTest(adapter)`.
 */
export function makeAuthedTest(adapter: AuthAdapter) {
  return base.extend({
    context: async ({ context }, use) => {
      await applyExtraState(context, adapter) // before page → present on first goto
      await use(context)
    },
  })
}

// The one mechanism-specific extra-state helper (`sessionStorageExtra`) is
// deliberately NOT here — it lives in `core/extras/session-storage.ts` so this
// lifecycle file depends on no mechanism (L10). Adapters that need it import it
// from there and opt in.

/**
 * Aggregate required-but-missing config across adapters (L3 preflight). Throw =
 * cannot-run RED, with one clear message, BEFORE the suite runs (wire in globalSetup).
 */
export function assertPreflight(sources: Array<{ preflight?(): string[] }>): void {
  const missing = sources.flatMap((s) => s.preflight?.() ?? [])
  if (missing.length) {
    throw new Error(`Cannot run — missing required config: ${[...new Set(missing)].join(', ')}`)
  }
}

export { expect }
