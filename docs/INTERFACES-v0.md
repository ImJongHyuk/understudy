# Adapter contract — v0 (shape frozen 2026-06-17; validated across 4 reference consumers 2026-06-22)

The reuse boundary of the independent harness. The shape was frozen AFTER the first consumer's loop's
contract lessons (L1–L7) and has since been pressure-tested against four divergent consumers. v0 is the
*product*: any project's tests are leaves; this contract + its conformance tests (shipped — `bun run
conformance`) are what make the system project-agnostic.

> **Auth correction (2026-06-17, L8/L9).** The first adapter revealed v0 had
> over-fit auth to ONE mechanism (a sessionStorage OIDC token). The first
> consumer's *real* authorization turned out to be a cookie/BFF session (verified:
> the PKCE/sessionStorage module had zero callers; the API client ran in
> `credentials:'include'` cookie mode with no bearer). The contract is therefore
> corrected to be **auth-mechanism-AGNOSTIC**: the core owns only the auth
> *lifecycle* + *probe* freshness; the mechanism is adapter-private. This is the
> operative AuthAdapter shape below (supersedes the original
> `usesSessionStorage`/`isFresh` form).

> "Prove with one, generalize from many." v0 was proven against one private consumer and is now
> VALIDATED against FOUR hermetic, in-repo reference consumers on the SAME core (adapter code only):
> `realworld-conduit` (bearer JWT in localStorage), `cookie-notes` (httpOnly cookie / BFF session),
> `vikunja` (a richer third-party app, JWT in localStorage), and `oidc` (a real OAuth2/OIDC
> authorization-code redirect flow — the hardest mechanism). Every major auth mechanism class is now
> covered with `core/` unchanged. Open questions are folded in below (L11/L12/L15/L17/L18).

## What an adapter implements (the whole contract)

### AuthAdapter (browser/user auth → prefill)

```ts
interface AuthAdapter {
  id: string                                   // "project:role" → state file names
  origin: string                               // app origin (baseURL + extra-state host guard)
  // Become authenticated by ANY mechanism (UI login / token mint+inject / cookie
  // seed / mock-no-auth). The core never asks how; after this resolves the
  // context must be authenticated.
  login(page: Page): Promise<void>
  // Navigate to a representative PROTECTED surface and throw/expect-fail unless
  // the authenticated UI is present. Used BOTH as the post-login gate AND as the
  // cached-state freshness PROBE — so the core never parses tokens/cookies.
  assertAuthenticated(page: Page): Promise<void>
  // OPTIONAL, mechanism-neutral. storageState already carries cookies +
  // localStorage + IndexedDB. Only an app that keeps load-bearing state
  // ELSEWHERE (e.g. sessionStorage) implements these; the core stores/returns
  // the JSON opaquely and never interprets it. A `sessionStorageExtra(origin)`
  // helper is PROVIDED for that common case (opt-in, not a premise).
  captureExtraState?(page: Page): Promise<Record<string, string>>
  restoreExtraState?(context: BrowserContext, state: Record<string, string>): Promise<void>
  preflight?(): string[]                       // L3: required-but-missing env names
}
```

**Freshness is a PROBE, not introspection.** The setup project restores any cached
state and runs `assertAuthenticated`; if it throws, it re-runs `login()` and
re-persists. This works identically for every mechanism (an expired cookie and an
expired bearer both simply fail the probe), so the core needs no
`usesSessionStorage` flag and no `isFresh(tokenDump)` — both are removed.

### SeedAdapter (machine state seeding → D3)

```ts
interface SeedAdapter {
  id: string
  fixturePrefix: string                        // only names with this prefix may be created/deleted
  newRequestContext(): Promise<APIRequestContext> // machine auth (API key / service token)
  assertSafeTarget(): void                     // throw (cannot-run RED) unless target is the safe/allow-listed env
  preflight?(): string[]                       // L3
}
```

### SeedSession (engine-owned; adapters/helpers use it)

- `name(label)` → `${fixturePrefix}${runId}-${label}` (per-run unique namespace)
- `track(resource, deleteFn)` → registers for teardown; **refuses non-fixture names**
- `cleanup()` → reverse-order teardown, always runs, re-throws on leaks

### Core helpers (project-agnostic)

`ensureAuth(browser, adapter)` (probe cached state → reuse, else login + persist) ·
`makeAuthedTest(adapter)` (restores any adapter `extraState` per context) ·
`sessionStorageExtra(origin)` (PROVIDED opt-in helper, isolated in `core/extras/`) ·
`openSeedSession(adapter)` · `makeSeededTest(adapter)` ·
`assertPreflight(adapters[])` (wire into globalSetup).

## Invariants the contract enforces (inherited by every project)

1. **LLM never in the gate** — these tests run deterministically; agents author/heal upstream.
2. **Universal floor** — a11y + raw HTTP; typed API client is optional adapter-private enrichment (L4).
3. **No-fixture deletion guard** — `track`/`cleanup` cannot delete what this run didn't create (L7).
4. **cannot-run = RED** — `assertSafeTarget` / `assertPreflight` throw, never silent-skip (L6, INV-6).
5. **Separate auth needs** — user auth (browser) vs machine API key (seeding) are distinct paths.
6. **Auth mechanism-agnostic** — the core owns the lifecycle + probe freshness only;
   the mechanism (cookie/BFF, bearer, sessionStorage, OAuth…) is adapter-private; no
   required mechanism identifier in `core/` (L8/L9).

## Intentionally NOT frozen (open questions — mostly resolved by the 2nd–5th consumers)

- ~~Token in **cookie/localStorage** (not sessionStorage)~~ — RESOLVED by the
  mechanism-agnostic shape: `storageState` carries cookies + localStorage natively,
  so cookie/BFF sessions and Next.js cookie sessions need NO extra-state and NO flag. `captureExtraState`/`restoreExtraState` covers the exotic out-of-band
  case (e.g. sessionStorage). Still open: an app needing a *fully custom* persistence
  store the opaque JSON shape can't model — revisit only if a real adapter hits it.
- ~~Backend with **no server allow-list / no fixture discipline**~~ — RESOLVED (L12):
  RealWorld has no vault; `assertSafeTarget` became a host-locality check and machine
  auth was self-bootstrapped (register→token). Same `SeedSession`, 0 orphans, no core
  ephemeral-namespace provisioning needed.
- `assertSafeTarget()` sync vs **async probe** (per-PR ephemeral env liveness) →
  maybe `assertSafeTarget(): void | Promise<void>` in v1. (Still OPEN — all four current
  adapters are sync.)
- Per-resource create-body shapes — adapter detail, not contract.

## Conformance tests (shipped — `bun run conformance`)

A generic suite the CORE ships that any adapter must pass: `track` rejects a
non-fixture name; `cleanup` deletes only fixture resources; `assertSafeTarget`
throws on an unsafe target; `ensureAuth` reuses a probe-valid cached state and
re-captures when the probe fails (freshness without token introspection);
`captureExtraState`/`restoreExtraState` round-trips opaque JSON when an adapter
declares it; and the **no-mechanism-in-core lint** (L10) — the lifecycle
`core/auth-prefill.ts` has no non-comment mechanism identifier (`grep -rinE
'sessionstorage|oidc|bearer|keycloak' core/auth-prefill.ts` → comments only); the
only mechanism code lives under `core/extras/`. This is how "generic" becomes
*verifiable*, not aspirational.
