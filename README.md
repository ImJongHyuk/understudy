# understudy

[![CI](https://github.com/ImJongHyuk/understudy/actions/workflows/ci.yml/badge.svg)](https://github.com/ImJongHyuk/understudy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An independent, project-agnostic **agentic E2E testing harness** built on
Playwright Agents (Planner / Generator / Healer).

The idea: in an AI-coding workflow the bottleneck is verification, not authoring.
A Playwright E2E test is both a **sensor** (run it → catch regressions) and a
**spec** (read it → the intended user behaviour). Agents author and heal those
tests upstream; a **deterministic Playwright merge gate that no LLM sits inside**
verifies them. This repo is the reusable core of that harness — not tied to any
one application.

## Design

- **Two planes.** LLM authoring/healing happens upstream and is human-reviewed
  (Plane A); the merge gate runs only deterministic Playwright (Plane B). No LLM
  in the gate — ever.
- **Thin CORE + thick ADAPTER.** `core/` is project-agnostic and never changes
  per project. Onboarding a new web app = implementing one adapter; `core/` stays
  untouched (enforced by the conformance suite).
- **Universal floor.** Accessibility tree + raw HTTP; a typed API client is an
  optional, adapter-private enrichment, never required.
- **Auth is mechanism-agnostic.** The core owns only the auth lifecycle
  (authenticate → capture → restore → verify → refresh) and checks freshness with a
  runtime probe — never by parsing tokens/cookies. The mechanism (cookie/BFF,
  bearer, sessionStorage, OAuth2/OIDC) lives entirely in the adapter; persistence
  defaults to Playwright `storageState`.
- **Fail loud.** Negative controls are behaviour-level (break the real flow → the
  test must go RED); `cannot-run` is RED, never a silent skip.

## Onboard your app

A new project = **one adapter**; `core/` never changes. The whole browser-auth surface is two
methods — the core never learns your mechanism:

```ts
import type { AuthAdapter } from '../../core/auth-prefill'

export const myAuth: AuthAdapter = {
  id: 'myapp:user',
  origin: 'http://localhost:3000',
  // Become authenticated by ANY mechanism — drive the real login, mint+inject a token, seed a cookie…
  async login(page) { /* … */ },
  // Probe a protected surface; this IS the cached-state freshness check (no token parsing).
  async assertAuthenticated(page) { /* await expect(page.getByRole(...)).toBeVisible() */ },
}
```

Need backend state? Add a `SeedAdapter` (resources created + torn down via the API, behind a
non-fixture deletion guard). Then wire a Playwright `setup` project + `storageState` and write specs.
Full contract: [`docs/INTERFACES-v0.md`](docs/INTERFACES-v0.md); the four `adapters/` are working
templates to copy.

## Layout

```text
core/          project-agnostic harness (never changes per project)
  auth-prefill.ts             authenticate once → persist (storageState) → reuse, probe-refreshed
  state-seed.ts               machine-auth state seeding + teardown with a non-fixture guard
  host-guard.ts               localhost / allow-list guard (cannot-run = RED)
  negative-control.ts         behaviour-level RED classifier (anti-cheat)
  post-heal-lint.ts           forbids skip / assertion-weakening / gate-edits in a heal
  no-consumer-identifiers.ts  OSS leak guard — no internal name ships in published source
  conformance/                the mutation-proven adapter-contract suite
heal/          the agentic Healer loop + grounding levers (failure-trace, a11y probe,
               render-settle, deterministic auto-probe, triage, bounded auto-lever)
adapters/      one per consumer — the hermetic reference consumers live here
  realworld-conduit/   Conduit (RealWorld)            — bearer JWT in localStorage
  cookie-notes/        a cookie/session notes app     — httpOnly cookie / BFF session
  vikunja/             Vikunja (a richer third-party) — bearer JWT in localStorage
  oidc/                Dex + oauth2-proxy             — OAuth2/OIDC redirect flow
docs/          the adapter contract (INTERFACES-v0) + design notes + lessons
```

## Reference consumers

Each reference consumer is **hermetic and credential-free** — a real SUT brought
up locally via Docker, no secrets, so anyone can reproduce it. Together they
validate the mechanism-agnostic core across every major auth class, each onboarded
with **adapter code only — `core/` unchanged**:

| Adapter | SUT | Auth mechanism |
| --- | --- | --- |
| `realworld-conduit` | Conduit (RealWorld) | bearer JWT in localStorage |
| `cookie-notes` | a notes app | httpOnly cookie / BFF session |
| `vikunja` | Vikunja (richer third-party) | bearer JWT in localStorage |
| `oidc` | Dex + oauth2-proxy | OAuth2/OIDC authorization-code redirect |

```bash
bun run realworld:up && bun run e2e:realworld && bun run realworld:down
# the others mirror this: {cookie,vikunja,oidc}:up  +  e2e:{cookie,vikunja,oidc}  +  {…}:down
```

## Agents

The Planner / Generator / Healer are the Playwright Agents toolchain, driven via
the `playwright-test` MCP (evidence: `docs/AGENTS-EVIDENCE.md`). They author and
heal tests **upstream** — the merge gate then runs only the resulting deterministic
Playwright. The Healer is validated end-to-end on real breaks (rename a live
control → spec RED → heal → GREEN); grounding levers (failure-trace, accessibility
probe, render-settle, deterministic auto-probe, triage) raise weak-model
root-causing without ever touching the gate (`docs/HEAL-QUALITY.md`).

## Status

- **Four hermetic reference consumers** in-repo — bearer-localStorage,
  cookie/session, and OAuth2/OIDC redirect auth — all on one unchanged `core/`.
- **Deterministic merge gate in CI**: typecheck + a mutation-proven adapter-contract
  conformance suite + spec lint + an E2E matrix over every adapter + an artifact
  leak-check. No LLM anywhere in CI.
- **Agentic Healer validated** end-to-end (the product loop and the packaged agents
  via the MCP).
- **OSS-clean by construction**: a tree-wide forbidden-identifier guard keeps
  internal names out of the published source (`docs/OSS-READINESS.md`).

## Develop

```bash
bun install
bunx playwright install chromium
bun run realworld:up && bun run e2e:realworld   # a hermetic reference consumer
bun run conformance && bun run typecheck && bun run lint:specs
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
architecture, the invariants every change must preserve, how to run the gate
locally, and the PR/commit conventions.

## License

[MIT](LICENSE).
