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

> **Status:** early `0.x` — usable, but the API may change before `1.0`.

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

## Quickstart

Verify the harness itself — the adapter-contract suite + the deterministic trust
gates. No browser, no Docker, ~seconds:

```bash
bun install
bun run typecheck && bun run conformance
```

Then watch it drive a **real app** — a hermetic, credential-free SUT brought up
locally via Docker:

```bash
bunx playwright install chromium
bun run realworld:up && bun run e2e:realworld && bun run realworld:down
```

Onboarding your own app is just **one adapter** (next); `core/` never changes.

## Onboard your app

A new project = **one adapter**. The whole browser-auth surface is two methods —
the core never learns your mechanism:

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

Need backend state? Add a `SeedAdapter` (resources created + torn down via the API,
behind a non-fixture deletion guard). Then wire a Playwright `setup` project +
`storageState` and write specs. Full contract:
[`docs/INTERFACES-v0.md`](docs/INTERFACES-v0.md); the four `adapters/` below are
working templates to copy.

## Reference consumers

Each is **hermetic and credential-free** — a real SUT brought up locally via
Docker, no secrets, so anyone can reproduce it. Together they validate the
mechanism-agnostic core across every major auth class, each onboarded with
**adapter code only — `core/` unchanged**:

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
the `playwright-test` MCP. They author and heal tests **upstream** — the merge gate
then runs only the resulting deterministic Playwright. The Healer is validated
end-to-end on real breaks (rename a live control → spec RED → heal → GREEN);
grounding levers (failure-trace, a11y probe, render-settle, auto-probe, triage)
raise weak-model root-causing without ever touching the gate
(`docs/HEAL-QUALITY.md`).

## Layout

```text
core/       project-agnostic harness — auth lifecycle, machine-auth state seeding,
            host guard, the deterministic trust gates (negative-control,
            no-mock-of-SUT, intent-freshness, post-heal-lint) + the OSS leak guard,
            and the mutation-proven conformance/ suite. Never changes per project.
heal/       the agentic Healer loop + grounding levers.
adapters/   one per consumer — the four hermetic reference consumers (above).
docs/       the adapter contract (INTERFACES-v0) + design notes + lessons.
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
architecture, the invariants every change must preserve, how to run the gate
locally, and the PR/commit conventions. Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
