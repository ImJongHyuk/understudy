<!--
  ⚠️ TEMPORARY / DRAFT — universal-floor / contract-optional principle ⚠️
-->

# A11y-only floor — the authoring plane degrades to the accessibility tree (INV-2)

> **INV-2 (Universal floor).** The authoring plane (Planner → Generator) MUST be
> able to produce a valid test **plan** and a compilable **spec** from the
> **accessibility tree + raw HTTP alone**. Code/contract enrichment (a typed API
> client generated from an OpenAPI/JSON-schema contract, e.g. via
> `openapi-typescript`) is an **OPTIONAL, adapter-private Tier-2 enrichment that is
> OFF by default** — never a precondition for authoring or running. This mirrors
> the auth invariant: the *floor* lives in the core/agents; the *enrichment* lives
> in the adapter and the core never requires it (see `INTERFACES-v0.md` invariant 2
> and `CONTRACT-LESSONS.md` L4).

## Why this is the floor (not a nice-to-have)

A web SUT always exposes two things the harness can rely on with **zero** project
setup:

1. the **accessibility tree** — roles, names, labels — which Playwright's
   role-first locators (`getByRole`, `getByLabel`, `getByText`) read directly; and
2. **raw HTTP** — `request.post(path, { data })` with `Record<string, unknown>`
   bodies for state seeding.

That pair is the **universal floor**: every app has it, so onboarding a new app
costs ONE adapter and never a contract file. A contract (OpenAPI / JSON-schema)
and the generated typed client on top of it are real and useful — but they are an
*accelerator*, not a *gate*. The moment authoring **requires** a contract, the
harness stops being project-agnostic: an app with no published spec (the common
case) could not be onboarded at all. So the rule is one-directional:

- **a11y floor present, contract absent** → authoring + run MUST work. (Required.)
- **a11y floor present, contract present** → authoring MAY use it for request/
  response shape safety. (Optional, adapter-private, default OFF.)

## Contract-optional, off by default — where it shows up in this repo

- The reference consumer manifest declares enrichment **off explicitly**, as the
  default posture:

  ```ts
  // adapters/realworld-conduit/adapter.config.ts
  enrichment: { openapi: false },   // a11y + raw HTTP floor; no contract enrichment.
  ```

- The seed helpers ride the raw-HTTP floor — untyped `Record`-shaped bodies, no
  generated client — and still seed + teardown correctly
  (`adapters/realworld-conduit/seed.adapter.ts`, `core/state-seed.ts`).
- The core ships **no** OpenAPI/codegen dependency and **no** contract loader: the
  agents author against the live a11y snapshot, and `core/` exposes only
  raw-HTTP/`storageState` primitives.

## The RealWorld reference inherently exercises the a11y-only floor

The public RealWorld / Conduit reference (`adapters/realworld-conduit`) ships
**no OpenAPI contract** — there is no spec file to point `openapi-typescript` at.
So the reference consumer is not a contrived "enrichment off" demo: it is
**structurally** an a11y-only target. Authoring its plan + spec works from the
accessibility tree alone, and seeding works from raw HTTP alone, exactly because
there is nothing else to lean on. That makes the reference loop a continuous,
hermetic proof that INV-2's floor holds with **zero** contract input.

The (private, kept-outside-this-repo) cookie/BFF consumer is the divergent case
that *could* carry a contract — and there the rule is the same: its
`openapi`/codegen enrichment defaults **OFF**; turning it on is an explicit,
adapter-local opt-in that the core neither sees nor depends on. Two consumers,
one floor: the contract is enrichment on both, required by neither.

## Graceful degradation (what "degrade" means concretely)

| Input available                 | Plan / spec authoring | Run (gate) | Notes                                  |
| ------------------------------- | --------------------- | ---------- | -------------------------------------- |
| a11y tree + raw HTTP only       | ✅ required to work    | ✅          | the floor; RealWorld lives here        |
| + OpenAPI contract (opt-in)     | ✅ may use for shapes  | ✅          | adapter-private Tier-2; default OFF    |
| a11y tree absent / SUT down     | ❌ cannot-run = RED    | ❌ RED      | INV-1: never a silent skip             |

Enrichment can only **add** type-shape safety to request/response bodies in the
authoring plane. It can never be load-bearing for whether a plan can be made, a
spec can compile, or the deterministic gate can run. If a contract *were* required
and it were missing, that would be a cannot-run — and per INV-1 a cannot-run is
**RED, never a silent skip**. Keeping the contract optional is precisely what
keeps the a11y-only path a real path rather than a fallback that quietly no-ops.

## Greppable guard — NO agent prompt may hard-require a contract/spec file

INV-2 is only as strong as the authoring prompts. If any agent prompt
(`.claude/agents/*.md`) declared a *required* OpenAPI / schema / contract
dependency, an app without one could not be authored, and the floor would be
broken in practice. So the guard is structural and greppable: the agent prompts
carry **no** required contract/spec/schema dependency.

Check (zero hits = pass):

```bash
grep -rinE 'openapi|swagger|json-?schema' .claude/agents/*.md
# → no matches (exit 1); 0 required-contract hits.
```

Result on the current tree: **0 hits** (grep exit status 1 — no matches). The
Planner authors from the browser snapshot / live a11y tree, the Generator drives
real Playwright tool calls against that tree, and the Healer debugs against the
running app — none of the three names or requires a contract artifact. The
authoring plane therefore runs on the a11y-only floor by construction, with
contract enrichment remaining an opt-in adapter concern that defaults OFF.

> Companion lints: `core/auth-prefill.ts` carries no required mechanism identifier
> (`grep -rinE 'sessionstorage|oidc|bearer|keycloak' core/auth-prefill.ts` →
> comments only — L10), and seed bodies stay raw-HTTP/untyped in `core/` (L4).
> This file adds the matching guard for the authoring plane: no required contract
> in any agent prompt.
