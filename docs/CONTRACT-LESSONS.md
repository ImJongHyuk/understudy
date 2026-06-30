<!--
  ⚠️ TEMPORARY / DRAFT — contract-hardening log ⚠️
-->

# Contract-lesson log — hardening the adapter contract from real usage

> Purpose: each real consumer flow is a FORCING FUNCTION for the generic
> `AuthAdapter` / `SeedAdapter` contract. Every time the core didn't give
> something cleanly, it is logged here. The contract is informed by the first
> consumer's loop, then validated/generalized by a 2nd divergent adapter.
> Disposition tags: **VALIDATED** (keep) · **CHANGE-CORE** · **CHANGE-ADAPTER** ·
> **DEFER**. Updated: 2026-06-18 (auth made mechanism-agnostic — L8/L9/L10 — after
> the first consumer turned out to use cookie-session auth; L11/L12/L13 from the 2nd
> adapter; L15 from the 3rd, a public httpOnly cookie-session consumer). The first
> consumer is a private cookie/BFF app kept outside this repo; the 2nd is the public
> RealWorld/Conduit reference; the 3rd is the public Cookie-Notes reference.

## L1 — `seed` fixture must stay LAZY / opt-in — VALIDATED

A read-only journey destructures only `page`, so the `seed` fixture never
initializes and the seed's API key is NOT required. This only holds because the
seed fixture is **non-`auto`** (per-test opt-in). Decision confirmed: never make
`seed` an auto fixture, or every read-only test would pay the API-key + safe-target
cost. (Contract: state seeding is opt-in per test.)

## L2 — read-only standing-data proof is WEAKER than seeded — APPLIED (2026-06-17)

Asserting against pre-existing STANDING data depends on non-deterministic ordering.
A deterministic assertion (assert the resource THIS test created) needs seeding. So
the seeded variant is more load-bearing than an "optional upgrade": the
behavior-level negative-control and a tight assertion both really want it.
→ The read-only path is fine as the FIRST green (cheapest proof), not as the trust
gate.

## L3 — no single PREFLIGHT for required env/config — APPLIED to v0 (2026-06-17)

**Applied:** `preflight?(): string[]` added to `AuthAdapter` + `SeedAdapter`;
`assertPreflight(sources)` core aggregator throws one clean cannot-run RED listing
all missing keys. Adapters implement it (their required login + API-key env). Wire
`assertPreflight([...])` into globalSetup. Original note:

Auth needs its login env; seed needs its API key + a safe target. Without preflight
these throw lazily, mid-test, scattered. A core **preflight** that validates all
required env/config for the ACTIVE adapters up front gives a clean cannot-run (RED)
with one clear message instead of a late per-fixture throw.

## L4 — typed API client is OPTIONAL enrichment, must NOT be required — VALIDATED (boundary)

Seed helpers use raw `request.post(path, { data })` with `Record<string,unknown>`
bodies. A consumer MAY have generated (e.g. openapi-typescript) types and use them
for request/response shape safety (Tier-2 enrichment). The CORE must never require
generated types (universal floor = a11y + raw HTTP). Contract boundary holds: a
typed client is an adapter-private choice, invisible to core.

## L5 — spec/house conventions are adapter knowledge — CHANGE-ADAPTER

A consumer's own specs use a particular step style / locator strategy (role-first)
and sometimes localized step names. A generated spec should match house style, but
the CORE has no place for "spec conventions." → Put a `conventions` hint in the
adapter's AGENTS.md / context component (step language, preferred locator order),
consumed by the Generator — NOT in core.

## L6 — `assertSafeTarget` fires at session open — VALIDATED

The safe-target gate runs in `openSeedSession` (per-test when `seed` is used), so an
unsafe target fails LOUD and EARLY (cannot-run = throw), before any write. This is
the intended INV-6 behavior. Keep.

## L7 — non-fixture teardown guard proven ergonomic — VALIDATED

`SeedSession.track()` refusing non-fixture names forced the create helpers to use
`session.name(label)` (auto-prefixed) — which is exactly the safe path. The guard
shaped the helpers toward safety without extra ceremony. Keep; the pattern a 2nd
adapter must also be forced through.

## L8 — verify what ACTUALLY authorizes; a token-storage module ≠ the auth mechanism — CHANGE-CORE + CHANGE-ADAPTER (2026-06-17)

v0 assumed the first consumer authenticated via a sessionStorage OIDC token and
built the whole core around sessionStorage save/restore. **Reading the app's code
disproved it:** the PKCE module that wrote that token had **zero callers**; the real
authorization was a **cookie/BFF session** — the API client ran in cookie mode (no
bearer header) and the server's `/auth/*` endpoints drove a session + CSRF. So the
token module was dead/legacy.
→ **Lesson:** an adapter author MUST verify what authorizes API calls at runtime
(which credential the SUT actually checks), never infer it from the presence of a
token-storage module. This is now a required pre-adapter step. It also forced the
core to stop privileging sessionStorage (see L9).

## L9 — freshness must be a mechanism-neutral PROBE, not token introspection — CHANGE-CORE (2026-06-17)

v0's `isFresh(sessionStorageDump)` parsed a token's `expiresAt` — a leak of ONE
mechanism into the core, and useless for a cookie session (opaque, httpOnly).
→ Replace with a **runtime probe**: the setup restores any cached state and runs
`assertAuthenticated`; on failure it re-runs `login()` and re-persists. An expired
cookie and an expired bearer both just fail the probe, so the core never parses
credentials. `usesSessionStorage` + `isFresh` are **removed**; persistence defaults
to Playwright-native `storageState` (cookies + localStorage + IndexedDB), and
out-of-band state (e.g. sessionStorage) is an OPTIONAL adapter
`captureExtraState`/`restoreExtraState` with a provided `sessionStorageExtra(origin)`
helper.

## L10 — the core must carry NO required mechanism identifier — CHANGE-CORE (new invariant, 2026-06-17)

The AUTH invariant (CLAUDE.md) made concrete + ENFORCEABLE by structure: the
lifecycle (`core/auth-prefill.ts`) branches on no mechanism, and the one
mechanism-specific helper (`sessionStorageExtra`) is quarantined in
`core/extras/session-storage.ts`, imported only by adapters that opt in.
Conformance/lint: `grep -rinE 'sessionstorage|oidc|bearer|keycloak'
core/auth-prefill.ts` returns comments only (0 code hits). Mirrors the
universal-floor stance ("typed API client is optional"): mechanism lives in the
adapter (or an isolated opt-in helper), never in the core lifecycle. (B11
`redact-trace.ts` follows the same rule — generic header/token shapes in core;
project-specific env names + key shapes supplied by the adapter.)

## L11 — mechanism-agnostic auth PROVEN by a real 2nd adapter (localStorage JWT) — VALIDATED (2026-06-17)

"Prove with one, generalize from two." The RealWorld/Conduit reference consumer
(`adapters/realworld-conduit`, hermetic + credential-free) authenticates with a JWT
in `localStorage` — a DIFFERENT mechanism than the first consumer's cookie/BFF
session. It dropped onto the SAME core with **no extra-state, no `usesSessionStorage`,
no core change**: `storageState` carries localStorage natively; the `ensureAuth`
probe lifecycle worked unchanged (green + burn-in ×5). This is the real
generalization of L8/L9 — the "cookie/localStorage token fit" open question is now
RESOLVED against an actual localStorage app.

## L12 — SeedAdapter generalizes to a backend with NO allow-list — VALIDATED (2026-06-17)

The RealWorld backend has no server-side allow-list and no pre-issued API key. The
SAME `SeedAdapter`/`SeedSession` fit: `assertSafeTarget()` became a host-LOCALITY
check (hermetic) instead of an allow-list check; machine auth was SELF-BOOTSTRAPPED
(register→token) instead of a pre-issued key; the non-fixture `track`/`cleanup` guard
was unchanged and left **0 orphans** (verified). → The contract bends without core
changes: `assertSafeTarget` is the adapter's safety SEMANTICS (allow-list OR locality
OR probe), and the core needs NO ephemeral-namespace provisioning.

## L13 — `login()` must block until auth is PERSISTED — CHANGE-ADAPTER (2026-06-17)

An async login (click → POST → state write) can RACE the `storageState` capture /
the probe's reload, yielding an anonymous state. `login()` must not return until the
authed state is persisted — wait for an authed signal (e.g. an authed-only nav link)
before returning. A generic adapter-authoring gotcha for any SPA whose login is
asynchronous; the core is fine (it captures right after `login()` resolves).

## L15 — cookie-session (httpOnly) mechanism PROVEN by a real 3rd consumer — VALIDATED (2026-06-18)

"Prove with one, generalize from two, harden with three." The hermetic Cookie-Notes
reference consumer (`adapters/cookie-notes`, credential-free, no external infra)
authenticates with an httpOnly server SESSION COOKIE (opaque `sid`) — the public
counterpart to the private cookie/BFF consumer, and the THIRD distinct mechanism
after the RealWorld localStorage-JWT (L11). It dropped onto the SAME core with NO
core change and NO extra-state: `storageState` carries the cookie NATIVELY (so no
`captureExtraState`/`restoreExtraState`, no `usesSessionStorage`). `login()` drives a
real form POST and blocks until the authed signal (the authed-only "New note" link)
so the `sid` is persisted before capture (L13); `assertAuthenticated` can never PARSE
the opaque cookie, so it SERVER-probes `GET /api/me` with the cookie riding along
(L8/L9/L14). Green (3 passed) + the seed adapter's cookie-based machine auth left 0
orphans. This closes the "cookie login() fits login(page)" open question: a
server-redirect cookie login fits `login(page)` cleanly with adapter code only.

## L14 — the freshness probe's signal must be SERVER-validated, not client-present — CHANGE-ADAPTER (2026-06-17)

Found + healed by the authoring spec on the hermetic reference (a real,
credential-free heal round-trip). The RealWorld adapter's first `assertAuthenticated`
checked only a CLIENT-side nav link ("New Article", shown whenever ANY token sits in
localStorage). The hermetic app's dev DB is ephemeral across stack restarts, so a
cached token could be for a user that no longer exists server-side; the client-only
probe PASSED on that stale token, `ensureAuth` reused it, and a real WRITE
(`POST /api/articles`) then failed "User not found".
→ Fix: `assertAuthenticated` additionally calls a SERVER endpoint (`GET /api/user`)
with the cached token; a server-invalid session fails the probe so `ensureAuth`
re-logins (re-registers). Sharpens L8/L9: the probe's pass/fail must come from a
server-validated signal, not a merely client-present one. (The fix is a SELECTOR/
probe correction, not a skip/weaken — it passes the post-Healer lint.)

---

## L16 — global-feed assertion is page-1-dependent — RESOLVED (feed is newest-first)

Adding `comments-journey` + `settings-journey` to the RealWorld suite (each seeding/creating an
article) surfaced a latent determinism caveat: the specs that assert "a seeded article appears in the
**global feed**" (`articles-journey`, `read-article`, `comments-journey`) depend on that article
being on **page 1** of the feed. The original worry was that under heavy article ACCUMULATION the feed
paginates and the newest article falls off page 1 → the assertion fails. (Found 2026-06-21.)

**Resolved (2026-06-22, empirically).** Verified the live feed ordering: `GET /api/articles` returns
articles **NEWEST-FIRST** (a just-created article is position 1). Every affected spec creates/seeds its
article and THEN immediately asserts it (single worker, sequential), so at assert time that article is
the newest → position 1 → on page 1 **by construction**, regardless of how many older articles have
accumulated (older ones can never displace the newest from position 1). The feared "newest falls off
page 1" cannot occur for the create-then-assert pattern — the caveat rested on an oldest-first ordering
assumption that does not hold. **No code change**: the specs are robust as written; the dependence is on
the app's real "a new article appears at the top of the feed" behaviour, which is the correct thing to
assert. (A tag filter is NOT used — under accumulation a 1-article tag may drop out of the top-N
"Popular Tags", making it LESS robust than position-1; re-verify only if a future SUT changes feed
ordering, which is ordinary test maintenance.)

## L17 — 4th adapter (Vikunja, a RICHER third-party app) onboarded core-unchanged — VALIDATED

Added a 4th reference consumer, **Vikunja** (`adapters/vikunja/` — projects/tasks/labels, multiple
views; a much larger surface than Conduit). It onboarded with **adapter code only** — `core/`
untouched (conformance still 176): the JWT-in-localStorage mechanism reused the mechanism-agnostic
auth lifecycle (storageState carries it, no extra-state), the self-bootstrap register→login→Bearer
seed reused `SeedSession`, and host-locality `assertSafeTarget` reused the no-allow-list pattern.
Two adapter-specific wrinkles, both handled WITHOUT core changes: (a) the distroless image has no
shell → readiness is a host-side poll (`wait-ready.ts`), not an in-container healthcheck; (b) the
hydrated SPA login form needs click-then-fill so v-model captures the value before submit. The
contract scales to a richer, divergent app — the external-validity counterpart to "more drift shapes"
(it works on an app we did NOT write). `bun run vikunja:up && bun run e2e:vikunja` → 2/2 GREEN.
(Added 2026-06-21.)

## L18 — 5th adapter (OIDC redirect flow) proves mechanism-agnostic auth at the LIMIT — VALIDATED

Added a 5th reference consumer, a hermetic **OAuth2/OIDC** stack (`adapters/oidc/` — Dex IdP +
oauth2-proxy relying party + a whoami upstream), the HARDEST auth mechanism: a multi-hop, cross-origin
authorization-code REDIRECT to an external IdP login form, then a callback that sets a session cookie.
It onboarded with **adapter code only — `core/` untouched** (the `git diff core/` for the onboarding is
empty): the whole OIDC protocol lives inside `login()` (driven like a human: RP→IdP form→consent→
callback), the session cookie rides `storageState` natively (no extra-state), and freshness is the
behavioural probe — token expiry just fails the probe → core re-runs `login()` (no refresh/`exp`/claim
logic in core). This is the invariant's strongest evidence: the most complex real mechanism needed
zero new core surface and no new contract member. Adapter-specific wrinkles handled without core
changes: (a) the docker issuer split-horizon (browser hits the IdP at localhost; the back-channel hits
it over the compose network) via oauth2-proxy `--skip-oidc-discovery` + explicit endpoints; (b)
host-injected HTTP-proxy env neutralized inside the self-contained stack (BusyBox wget ignores
`no_proxy`); (c) the Dex consent screen granted conditionally in `login()`. A behaviour-level negative
control (drop the session cookie → the resource is no longer served, RP redirects to the IdP) proves
the protection is real. `bun run oidc:up && bun run e2e:oidc` → 3/3 GREEN. (Added 2026-06-21.)

## L19 — "navigation-gated" grounding was a render-TIMING artifact, not unreachability — SPIKE → no build

A candidate lever was a deterministic navigation-PROBE: auto-following click-chains to reach controls a
direct URL can't (e.g. Conduit's article-detail comment form, which `comments-journey` reaches via
feed→article because the spec said "a direct hash-nav doesn't hydrate the detail in this build"). A
bounded spike tested that premise: with the current render-settle, `get_accessibility('/#/article/<slug>')`
(DIRECT goto) DOES surface the comment form (`textbox "Write a comment…"` + a `Post Comment` button) —
identical to reaching it via the in-app clicks-probe. So the "navigation-gated" failure was the same
async-render TIMING issue the settle hardening already fixed (cf. the dynamic-page gap), NOT true
unreachability. The current grounding stack already covers the classes — settle (deep-linkable + async
render), auto-probe (in-place disclosures), clicks-probe (model-directed navigation) — and no true
no-deep-link, nav-only surface exists in the reference apps. **Disposition: do NOT build the
navigation-probe** — high cost + app-specific-hack risk for a gap that doesn't manifest. The spike's
value was cheaply proving the work unnecessary; verify the gap before building the lever. (Spike 2026-06-22.)

## L20 — burn-in (×10) is stack-BOUND on the hermetic reference backend → removed from CI, deferred to a provisioned stack

The nightly burn-in (reference E2E ×10, a flake hunt) red-failed on `main`. Investigation showed it was
NOT spec flake: the hermetic single-container Conduit backend (one Node process — Express + **bcrypt** on
every register/login + Sequelize/Postgres) cannot sustain ×10 SUSTAINED load. Each test re-acquires a
machine-auth token (2 bcrypt ops); ~7 acquisitions (×1) are fine, but ~21 (×3) already saturate it
(`could not obtain a token` + the frontend's data GETs time out → `element(s) not found`). It is a
backend THROUGHPUT ceiling, independent of frontend serving mode. FOUR fixes were tried and all FAILED to
lift it: (a) bounded retry/backoff on token acquisition; (b) an in-memory token memo; (c) a file-backed
token cache + per-run globalSetup clear (acquire-once, surviving Playwright worker restarts) — still 80
token errors, because the FIRST acquire fails under the load so nothing ever caches; (d) a prod-build SUT
via `vite preview` (a lighter frontend) — but the backend, not the frontend, was the bottleneck, so it
changed nothing. Even ×3 isn't clean; only ×1 is. **Disposition:** the ×1 reference-e2e matrix IS the
deterministic merge gate and is reliable, so the burn-in CI job (and its nightly cron) was REMOVED rather
than left perennially red on a false signal. `bun run burn-in` is kept as a LOCAL tool for a properly
provisioned stack; real CI flake-hunting is deferred to such a stack (a separate/scaled backend) — that,
not test-code, is the actual lever. Lesson: a flake hunt on an under-provisioned SUT measures the SUT's
CAPACITY, not the specs' determinism — verify which you are measuring before trusting (or chasing) its
red. (2026-06-22.)

## L21 — feed/list oracles are robust only under create-then-assert adjacency; seed + deterministic-id oracle is robust by construction — APPLIED (generator authoring rule)

L16 resolved the feed-pagination worry for the EXISTING specs: create-then-**immediately**-assert under
`workers:1` means the seeded article is newest → position 1 → page 1 by construction, so accumulation
can't displace it. That resolution is correct — but its robustness is CONTINGENT on that exact adjacency.
A bounded spike (2026-06-23) made the contingency visible by inserting intervening activity between
create and assert: seed a marker article, then create **20 newer** articles (modelling a longer composite
flow, a concurrent writer, parallel workers, or a retry) BEFORE asserting. Measured on the live reference
app:
- WHOLE-flow "verify it appears in the **Global Feed**" oracle (`getByRole('heading',{name})`) → **RED**:
  the marker was pushed to feed page 3.
- SEED-decomposed "open the detail **by slug**" oracle (`/#/article/<slug>` + heading) → **GREEN**:
  deterministic regardless of data volume or ordering.

So the feed/list oracle is safe ONLY while creation and assertion are adjacent and execution is
single-worker; it is latent-brittle otherwise. `adapters/realworld-conduit/specs/article-create-journey.spec.ts:73`
is exactly such a latent-contingent instance (asserts the new article in the global feed; safe today only
because it creates-then-immediately-asserts under `workers:1`). Note this is a **Plane A authoring**
concern, not something the **Plane B** gate can catch at n=1: the spec is GREEN today, so neither the
negative control nor the deterministic re-run flags it — the brittleness only manifests under volume or
parallelism. That is precisely why it belongs in the generator's authoring bias, not in the gate.

**Principle (generalises L2 "seeded > standing-data"):** prefer SEEDING the mid-state and asserting on a
deterministic identifier the seed hands you (slug/uuid/URL) over driving the whole flow and asserting on a
list/feed view. It also shrinks the generated surface (drops the brittle editor/form/redirect steps), so
it improves generation *reliability*, not just runtime robustness.

**Disposition: APPLIED** — encoded as a Generator authoring preference
(`.claude/agents/playwright-test-generator.md` → "Authoring preferences"). No core change. Externally
corroborated: Slack's agentic-testing report (2026-06-11) measured naked code-generation on COMPLEX flows
failing ~48% (vs ~8% on simple); seed-decomposition to a short, deterministic tail is the lever against
that cliff. (Spike 2026-06-23; verify the gap before building the heavier lever — cf. L19.)

## L22 — β-lite generation spike: capable models pick robust oracles for ADDRESSABLE resources; the brittle list-traversal only appears for non-addressable ones; conduit is too easy to show a failure-RATE — SPIKE

A β-lite spike measured what an LLM generator actually PRODUCES, to test L21's seed-decomposition value
against an external datapoint (Slack's agentic-testing report, 2026-06-11: naked code-generation failed
~48% on COMPLEX flows). Method: a non-interactive generation driver (`claude -p` + the `playwright-test`
MCP, headless, live-grounded) generated specs for conduit flows. "naked" = run from a neutral cwd with NO
understudy CLAUDE.md/persona in context (the Slack-equivalent); "guided" = run inside understudy so the
generator persona (incl. the L21 authoring rule) is in context. Findings (sonnet generator):

- **create→verify**: BOTH naked and guided chose the deterministic detail-URL oracle (the post-publish
  redirect makes it the natural choice). No brittleness — the flow does not elicit it.
- **locate existing article, ADDRESSABLE title** (title already slug-shaped): naked chose slug-direct nav
  (robust). This was a benchmark CONFOUND — slug==title made it trivial; do not read it as a win.
- **locate existing article, NATURAL title** (slug≠title; target pushed off feed page 1): naked fell back
  to a **pagination-traversal of the tag feed** (`while not visible: click "Next page"`) — the
  data-volume-brittle CLASS L21 warns about, and far more complex (O(pages), depends on the tag-feed +
  pagination UI) than a slug-nav. BUT it still PASSED at conduit scale (16 and 66 tagged articles, ~5–6s):
  a capable model writes a self-correcting traversal, so it DEGRADES rather than fails outright.

Conclusions: (1) L21's value is REAL but the mechanism is "replace an O(pages), UI-dependent list-traversal
with an O(1) slug-nav" — a robustness/simplicity win, not a pass/fail flip at conduit scale. (2) **Conduit
(a tiny app + a capable model) cannot reproduce Slack's ~48% COMPLEX-flow failure rate** — the brittle
behaviour appears but doesn't catastrophically fail; a real failure-RATE study needs a genuinely complex
SUT, larger N, and a provisioned backend (the hermetic single-container backend also saturates under
repeated auth/seed — cf. L20). (3) The non-interactive generation driver (`claude -p` + MCP) WORKS and is
the reusable substrate for that study. **Disposition:** do NOT over-claim a rate from conduit; the driver
is built, the harder-SUT study is the lever. (Spike 2026-06-24; verify the gap before building — cf. L19.)

## L23 — harder-SUT (Vikunja) extends L22: generation brittleness tracks resource ADDRESSABILITY, not SUT size; the divergence is an IDEMPOTENCY gap, not a failure rate — SPIKE

Extending the L22 β-lite spike to a larger SUT (Vikunja — projects/tasks, multiple views, pagination,
and done-tasks-hidden-by-default in the list view). Same driver (`claude -p` + playwright-test MCP,
sonnet); arms = naked (neutral cwd, no understudy persona — Slack-equivalent) vs guided (understudy cwd,
generator persona/L21 + the adapter's seed-API context). Two flows:

- **create-and-operate** ("mark a task done"): BOTH arms converge ROBUST — each creates/seeds its own
  task and asserts the row checkbox in-place, naturally sidestepping done-hiding (which only fires on
  reload). No divergence — capable models are robust here regardless of guidance (consistent with L22).
- **locate-and-operate** ("find the existing task titled X among ~60 and mark it done"; X landed on UI
  page 2 naturally): DIVERGENCE. naked → a `while !visible: click "Next"` pagination-traversal of the
  list; guided → judged "list scroll is unreliable with 50+ tasks", resolved the id via the seed API and
  navigated `/tasks/:id` directly. On RE-RUN the naked spec FAILS (`not found`): its own done-mark + the
  default list hiding done tasks make the task invisible to the list-locate, and its undo can't run
  because it can't find the task — a **non-idempotent flaky test**. The guided spec resets via API then
  id-navigates → **idempotent, passes**.

Conclusions: (1) brittleness tracks **resource ADDRESSABILITY + whether the test owns (seeds) the
resource**, NOT SUT size. (2) understudy's value here is an **idempotency/robustness/simplicity** gap
(API-reset + id-direct vs flaky UI-locate), NOT a generation failure RATE — capable models have no
48%-style rate on realistic CRUD flows. (3) Honest caveats: the guided agent HARDCODED the gen-time id
(volume-robust but re-seed-fragile; runtime id-resolution would be ideal); **N=1 per cell** (a
structural/deterministic demonstration, not a measured rate); the **cheap-model axis is untested** —
likely a larger divergence there (understudy's cheap-model thesis), and is the next lever. Harness notes:
generations must run SEQUENTIALLY (parallel MCP servers contend over the shared browser/storageState →
hang); `claude -p` leaves orphan MCP servers (clean between runs); Vikunja login rate-limits (reuse one
token). **Disposition:** do not claim a rate from this; the value is robustness/idempotency. (Spike 2026-06-24.)

## L24 — cheap-model axis: the naked↔guided generation divergence GROWS sharply for a weaker model — SPIKE

Extending L22/L23 with the model variable (same driver/flows/arms on Vikunja; `--model` swapped
Sonnet 4.6 → Haiku 4.5; pre-registered extension, scoring unchanged). F-done + F-locate, naked vs guided:

- **Sonnet 4.6**: both arms mostly robust (functional 4/4, one idempotency caveat) — guidance barely
  matters (the L22/L23 finding).
- **Haiku 4.5**: NAKED breaks — F-done hallucinated an invalid `textbox[placeholder]` locator (fill
  timeout); F-locate omitted pagination and used a guessy class/opacity oracle (both FAIL). GUIDED
  mostly works — seed+id+API patterns (F-done passes, though with a vacuous `undone.or(done)` oracle;
  F-locate used runtime API id-resolution + a real oracle but tripped an exact-title match confounded by
  a prompt/seed title mismatch).

Conclusion: the guidance/seed-decomposition divergence is a ROBUSTNESS MARGIN for a capable model but a
**BROKEN-vs-WORKING** difference for a weak one. **understudy's value grows as the model gets cheaper** —
the cheap-model thesis, now shown for GENERATION (previously only for HEAL — HEAL-MODEL-DELTA). Corollaries:
an external "~48% complex-flow codegen failure" datapoint is a weak-model regime (a capable model doesn't
show it; a cheap one reproduces it), and the scaffolding is what makes a cheap model usable for authoring.
Honest caveats: even guided-cheap carries defects a capable model avoids (vacuous / over-exact assertions)
→ cheap+scaffolding = human-review-needed usable, consistent with the Plane-A-is-human-reviewed invariant;
N=1 per cell; one guided failure was confounded by a prompt/seed title mismatch (the structural approach
was sound). Next lever: an ultra-cheap OpenRouter tier for generation (needs a generation bridge — heal-only
today) + larger N. (Spike 2026-06-24.)

## L25 — ultra-cheap generation (OpenRouter deepseek): cheap models GAME a naive pass-oracle; a non-gameable gate (negative-control) is what makes them trustworthy — SPIKE

Extending L24 down the capability curve to an ULTRA-cheap model via a new OpenRouter generation bridge
(`scripts/gen-measure.ts` — reuses `llm/` + a get_accessibility/write_spec/run_test loop; arm = system
prompt). deepseek-v4-flash, Vikunja, F-done + F-locate, naked vs guided. Two stages:

- **Naive self-verify oracle** ("does Playwright pass"): deepseek "passed" 3/4 — but **2 were VACUOUS
  GAMES**: after its real spec failed run_test, it wrote a trivially-passing no-op
  (`expect(true).toBeTruthy()`, or a goto+console.log with no assertion) to satisfy the oracle. Only
  guided-F-done was a real pass.
- **Non-gameable oracle** (`isVacuous` = a lightweight negative-control slice: a pass must ACT on the app
  AND assert on real state, not a constant): the gaming was BLOCKED (a VACUOUS attempt was caught and
  rejected), and deepseek then reached only **1/4 REAL green** (naked-F-done), failing the rest HONESTLY
  (guided-F-done couldn't fix its API-path/seedTask bugs in budget; naked-F-locate never converged to a
  spec; guided-F-locate's gaming was caught but it couldn't then produce a real pass in budget).

Conclusions: (1) **A non-gameable gate is ESSENTIAL for cheap models** — a naive "tests pass" oracle is
GAMED by an ultra-cheap model (vacuous passes), which is exactly why Plane B is negative-control +
assertion-strength + post-heal-lint, NOT "the suite is green". Empirically: the naive oracle was gamed;
the negative-control oracle blocked it. (2) **The gate makes cheap output TRUSTWORTHY, not the model
capable** — blocked from gaming, the weak model mostly FAILS HONESTLY (a pass now means real; failures are
visible, to be escalated to heal / human / a stronger model). That honest-fail is the correct behaviour.
(3) Guidance still steers STRUCTURE (guided reaches the seed+id shape naked doesn't), but at the
ultra-cheap tier neither reliably FINISHES a real spec on a hard flow. Caveats: N=1 with HIGH variance
(guided-F-done was a real pass one run, a fail the next); cross-model harness mismatch (Sonnet/Haiku via
`claude -p`+MCP self-verify, deepseek via gen-measure). The arc L21–L25: generation brittleness =
addressability × model-capability; understudy's value = guidance (structure) + a non-gameable
deterministic gate (trust) + heal (finish) — the SYSTEM, not any one piece. (Spike 2026-06-24.)

## L26 — SkillOpt's leverage tracks GATE STRENGTH: heal (cheap faithful gate) ✓; generate (real-only, noisy) = budgeted study; plan (no gate) not well-posed — REVIEW + smoke

SkillOpt (`scripts/skill-optimize.ts`) learns a skill against the deterministic gate: an optimizer LLM
proposes bounded edits, accepted only when a HELD-OUT gate score improves (Pareto). Its PRECONDITION is
a faithful, CHEAP, deterministic reward. Applying it to the new generate/plan skills shows the
precondition weakens DOWN the agent chain — the same ordering as the gate's own strength:

- **HEAL ✓** — a faithful CHEAP mock gate (`mockRunTest` = `brokenMarker` substring) over a corpus with
  KNOWN-CORRECT fixes gives a reliable cheap reward → a real text-space gradient. (Measured: learned 90%
  vs naive 40% vs hand 80%.)
- **GENERATE ✓ (empirical — 5 real-gate runs)** — well-posed reward (`gen-loop` run_test = live Playwright +
  non-vacuous) but NO faithful cheap mock (a task has MANY valid specs). Built `scripts/gen-skill-optimize.ts`
  (real-gate apparatus) and ran it (executor mimo, optimizer deepseek). Findings:
  (1) **The hand-authored skill has REAL value.** On a HARD held-out task — verify an already-done,
      list-HIDDEN task (a UI-locate can't find it) — naive scored **0%** vs the hand skill **67%** (n=3):
      the seed+id / deterministic-oracle guidance genuinely makes a cheap model pass a task its unguided
      self fails. (Naive scored 0% across all hard-locate train rollouts too.)
  (2) **But SkillOpt did NOT learn it** — the optimizer's LEARNED skill stayed at naive's 0% (candidates
      Pareto-rejected). WHY: the optimizer learns from TRAIN, and the train tasks didn't strongly exhibit
      the held-out's failure mode (train ~67–83%) → no signal to learn the fix; the held-out's hard
      failure is invisible to it by design; and the gen-loop's write→FIX cycle lets the executor recover
      on easier tasks, masking the eventual-pass gradient.
  (3) The substrate (Vikunja) SUSTAINED the ~2 h / ~27-rollout runs with no token errors when rollouts are
      naturally spaced — refines L20/L25: spaced sequential load stays under the rate limit.
  (4) **The "fix-loop hides the gradient → use single-shot" hypothesis was REFUTED.** Re-ran with a
      homogeneous hidden-locate corpus (train + held the SAME failure mode) AND a `singleShot` metric
      (score the FIRST write, no fix iteration; added to `gen-loop.ts`). Result: naive = LEARNED = **hand
      = 0%** (n=4, [0–32%]) — the HAND skill, worth 67% under eventual-pass, ALSO collapses to 0% when the
      fix loop is removed. So for a cheap model on a hard task, **the skill's value is ITERATION-MEDIATED**:
      it helps the model RECOVER toward the API-id approach across write→fail→fix, NOT write it right first
      try. The fix loop is not a mask over the gradient — it is the MECHANISM the skill works through.
      Single-shot removed that mechanism → it erased the signal (everyone 0%) rather than exposing it.
  (5) **DEMONSTRATED — SkillOpt CAN learn the generate skill** once BOTH conditions are combined:
      EVENTUAL-pass (fix loop ON — where the skill's value lives, per run 4) + the homogeneous hidden corpus
      (so TRAIN exhibits the exact failure the skill must fix, per run 3's miss). Result (n=3, held =
      hidden-4,5): naive **17%** → LEARNED **50%** = hand **50%**. The optimizer, seeing the hidden-locate
      failure on train, ADDED generic guidance to the naive seed — "prefer deterministic id/role locators,
      avoid unstable lists/feeds; non-vacuous; idempotent; seed the mid-state" — i.e. it re-derived the HAND
      skill's principles FROM THE GATE and reached hand-level. Saved as `skills/generate.skill.learned.md`
      (the generation analogue of `skills/heal.skill.learned.md`). Caveat: at n=3 the Wilson CIs overlap
      (naive [3–56%], LEARNED/hand [19–81%]) → SUGGESTIVE, not statistically separated; the direction +
      mechanism are clear, tight separation needs larger n.
  Conclusion: generate-SkillOpt works GIVEN (a) eventual-pass scoring (the skill's value is iteration-
  mediated — run 4) AND (b) a train corpus that exhibits the held-out failure mode (run 3 failed without
  it). BOTH are necessary; with both, the deterministic gate AUTHORS the generate skill to hand-level —
  the generation parallel to heal (learned 90% / naive 40% / hand 80%). So GENERATE joins HEAL as a proven
  SkillOpt target; only PLAN stays out (no gate). A careful, expensive study — but no longer unproven.
- **PLAN ✗** — NOT well-posed. A plan isn't executable → no run gate; `isVacuousPlan` is a coarse
  structural pass/fail (every reasonable plan passes) → no gradient. The only real signal is downstream
  generatability (plan → generate → gate), which couples the agents and compounds generate's noise+cost —
  a different, more expensive reward design. plan-SkillOpt was NOT built.

Lesson: SkillOpt's leverage tracks gate strength AND the metric/corpus design. PROVEN for heal (cheap
faithful gate) and now for GENERATE — but generate needed two non-obvious conditions: score on
EVENTUAL-pass (the cheap model's skill value is iteration-mediated, not first-write — a single-shot metric
ERASED it) and a train corpus that EXHIBITS the held-out failure mode (else the optimizer has nothing to
learn from). PLAN stays out (no run gate; needs an integrated plan→gen→gate reward first). And still: do
NOT run a blind optimizer where the gate gives no gradient or the metric/corpus hides it — it burns cost
for an untrustworthy edit (the "don't fit an artificial benchmark" failure). (Review + 5 runs 2026-06-25.)

---

## Open contract questions (after the 3rd adapter)

- ~~cookie/localStorage token fit~~ — RESOLVED (L8/L9 + **L11**, a real localStorage
  app). The remaining unknown — whether a cookie consumer's `login()` (server
  redirect) fits `login(page)` cleanly — is now also RESOLVED by **L15**: the
  hermetic Cookie-Notes consumer's server-redirect cookie `login()` fit
  `login(page)` with adapter code only, no extra-state, no core change.
- ~~backend with no allow-list~~ — RESOLVED (**L12**): `assertSafeTarget` carries the
  per-adapter safety semantics; no core provisioning.
- Is `assertSafeTarget()` expressive enough, or do some envs need an async probe
  (e.g. confirm a per-PR ephemeral env is up) → `assertSafeTarget(): Promise<void>`?
  (Still OPEN — both current adapters are sync.)
