# CLAUDE.md — understudy

Guidance for agents and contributors working in this repo. understudy is an
independent, project-agnostic **agentic E2E testing harness** on Playwright
Agents (Planner / Generator / Healer): a thin, project-agnostic `core/` plus a
per-project `adapter/`.

## Invariants (carry into all work)

- **LLM never inside the merge gate.** Agents author/heal upstream
  (human-reviewed); the gate runs only deterministic Playwright.
- **Universal floor** = accessibility tree + raw HTTP; a typed API client is an
  optional, adapter-private enrichment, never required.
- **Auth is mechanism-agnostic.** `core/` knows only the auth *lifecycle*
  (authenticate → capture → restore → verify → refresh) and verifies freshness by
  a runtime *probe* (`assertAuthenticated` on the restored state), NOT by parsing
  tokens/cookies. The *mechanism* (cookie/BFF session, bearer in localStorage,
  sessionStorage, OAuth/OIDC…) is 100% adapter-private. Persistence defaults to
  Playwright-native `storageState` (cookies + localStorage + IndexedDB); anything
  it can't carry (e.g. sessionStorage) is an OPTIONAL, adapter-declared
  `captureExtraState`/`restoreExtraState`. The lifecycle (`core/auth-prefill.ts`)
  branches on NO mechanism; the only mechanism-specific code in `core/` is the
  opt-in helpers under `core/extras/` (e.g. `session-storage.ts`), imported solely
  by adapters that need them. Verify:
  `grep -rinE 'sessionstorage|oidc|bearer|keycloak' core/auth-prefill.ts` returns
  only comments.
- **Negative-control = behaviour-level** (break the real flow → test must go RED);
  assertion-mutation is only a supplement.
- **cannot-run = RED**, never a silent skip (`assertSafeTarget` / `assertPreflight`).
- New project onboarding = implement ONE adapter; `core/` stays unchanged.

## Layout

```text
core/        project-agnostic harness (never changes per project)
adapters/    per-project adapters (incl. the hermetic reference consumer)
docs/        the adapter contract + design notes
scripts/     repo tooling (spec lint, artifact-leak checks)
.github/     CI workflows
```

A private downstream consumer is maintained outside this repo; only the generic,
publishable harness and its hermetic reference consumer live here.

## Stack / commands

bun + TypeScript + Playwright (1.56+, for `init-agents`).

```bash
bun install
bunx playwright install chromium
bun run realworld:up && bun run e2e:realworld   # hermetic reference consumer
bun run conformance        # adapter-contract conformance suite
bun run typecheck
bun run lint:specs         # spec-authoring lint
```

## Commit / PR conventions

See `CONTRIBUTING.md` for commit, branch, and pull-request conventions.
