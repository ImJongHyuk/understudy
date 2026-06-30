<!--
  ⚠️ TEMPORARY / DRAFT — design artifact ⚠️
-->

# Auth-prefill — reusable CORE + per-project ADAPTER (DRAFT)

Implements the **canonical Playwright auth pattern** (authenticate once → persist →
reuse via a `setup` project + `dependencies`) in a **mechanism-agnostic** way: the
core knows the auth *lifecycle* + a runtime *probe*, never the mechanism.
Persistence defaults to Playwright-native `storageState` (cookies + localStorage +
IndexedDB); state it can't carry (e.g. sessionStorage) is an OPTIONAL adapter-declared
extra. See `docs/CONTRACT-LESSONS.md` L8/L9/L10 for why (the first consumer's real
auth turned out to be a cookie/BFF session, not the sessionStorage token v0 assumed).

## The split

```text
core/auth-prefill.ts                      ← PROJECT-AGNOSTIC lifecycle. No mechanism code (L10).
  - AuthAdapter interface                 (the contract; mechanism-agnostic)
  - ensureAuth()       probe cached state → reuse; else login() + persist storageState (+ optional extra)
  - makeAuthedTest()   restore any adapter extra-state into each test context
core/extras/session-storage.ts            ← the ONE mechanism helper the core SHIPS (opt-in, isolated)
  - sessionStorageExtra(origin)           an adapter spreads this in IFF its app uses sessionStorage

adapters/<project>/auth.adapter.ts        ← THE ONLY project-specific auth file.
adapters/<project>/fixtures.ts            ← `export const test = makeAuthedTest(adapter)`
adapters/<project>/setup.ts               ← the setup project (swap the adapter import)
playwright.<project>.config.ts            ← setup + storageState + dependencies wiring
```

## Onboard a NEW project = implement ONE adapter

```ts
export const myAdapter: AuthAdapter = {
  id: 'myapp:user',
  origin: 'https://myapp.example.com',
  async login(page) { /* drive the login form (or mint+inject a token / seed a cookie) */ },
  async assertAuthenticated(page) { /* goto a PROTECTED route, expect the authed UI */ },
  // optional — only if the app keeps state storageState can't carry (e.g. sessionStorage):
  // import { sessionStorageExtra } from '../../core/extras/session-storage'
  // ...sessionStorageExtra('https://myapp.example.com'),
}
```

Nothing in `core/` changes. That is the reuse boundary.

## Flavors, one engine

`login()` is the single seam; the engine is identical regardless of flavor:

- **UI login**: `login()` drives the real form once → the server/app persists the
  session (a cookie, or a token in localStorage) → `storageState` carries it → reuse.
- **Token-injection / cookie-seed**: `login()` mints a token (ROPC / service-account
  / token-exchange) or seeds a cookie directly — same `ensureAuth` / `makeAuthedTest`
  machinery, no core change.
- **Mock / no-auth**: a no-op `login()` (or a mock profile) when the target runs
  without auth.

> Caveat for cookie/BFF apps: a headless token mint (ROPC/etc.) is NOT a drop-in —
> minting a bearer does not create the server session cookie the API authorizes by;
> the adapter must exchange for / seed the session cookie.

## Two auth needs are SEPARATE

- **Browser/user auth** (this module): a USER session so the E2E flow acts as a user.
- **State seeding**: a MACHINE API key / service token to create state via the app's
  API — no user login, not this module.

## State seeding — same CORE + ADAPTER split

```text
core/state-seed.ts                         ← PROJECT-AGNOSTIC. Never changes per project.
  - SeedAdapter interface                  (the contract)
  - SeedSession                            namespacing + teardown registry + NON-FIXTURE guard
  - openSeedSession() / makeSeededTest()   safe-target gate (cannot-run = THROW) + lifecycle

adapters/<project>/seed.adapter.ts         ← THE ONLY project-specific seeding file
  + a few create helpers (one per resource the flows need)
```

Invariants baked into the CORE (so every project inherits them):

- **MACHINE auth, not user login** — seeding uses an API key / service token,
  separate from the browser session. The token may be self-bootstrapped (register →
  token) where no pre-issued key exists.
- **Non-fixture deletion guard** — `SeedSession` refuses to track/delete any resource
  whose name lacks the fixture prefix. Teardown always runs (even on test failure)
  and re-throws on leaks.
- **Safe-target gate** — `assertSafeTarget()` throws (cannot-run = RED, never a silent
  skip) unless the target is safe: an allow-listed isolated target where the backend
  enforces one, or a host-locality check for a hermetic local app. A server-side
  rejection is the hard rail; this is the loud early one.
- **Per-run namespace** — `${fixturePrefix}${uuid}-` avoids cross-run name collisions
  (resource-name level).

Usage in a spec (auth + seed composed in one `test`):

```ts
import { test, expect } from '../fixtures'

test('reference journey', async ({ page, seed }) => {
  const item = await seedThing(seed, { /* fields */ })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: item.name })).toBeVisible()
  // teardown is automatic via the `seed` fixture.
})
```

Onboard a NEW project = implement one `SeedAdapter` + its create helpers. CORE unchanged.

## Notes

- First consumer (private, kept outside this repo): UI login → cookie/BFF session,
  carried via `storageState`.
- Reference consumer (public): `adapters/realworld-conduit` — localStorage JWT,
  hermetic, credential-free.
- B11 — `playwright/.auth/` MUST be gitignored + redacted (session/state files are
  secrets).
