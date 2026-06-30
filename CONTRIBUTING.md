# Contributing to understudy

Thanks for your interest in understudy — an independent, project-agnostic
**agentic E2E testing harness** on Playwright Agents (Planner / Generator /
Healer): agents author and heal tests upstream, and a **deterministic Playwright
merge gate that no LLM sits inside** verifies them.

Please read this guide before opening a pull request. The most important thing to
internalize is the set of **invariants** below — they are the whole point of the
project, and a change that violates one will be rejected no matter how convenient.

## Architecture in one breath

understudy is split into two layers:

- **`core/`** — thin and **project-agnostic**. It owns the auth lifecycle, state
  seeding/teardown, and the trust machinery. It never changes per project.
- **`adapters/`** — one per onboarded web app. An adapter implements the contract
  (`docs/INTERFACES-v0.md`) and is the *only* code you write to onboard a new SUT.

The reference consumers (`adapters/realworld-conduit`, `cookie-notes`, `vikunja`,
`oidc`) are hermetic, credential-free adapters against real SUTs brought up locally
via Docker — covering bearer-localStorage, cookie/session, and OAuth2/OIDC redirect
auth on one unchanged `core/`. They are how you reproduce the full loop with no
secrets.

Read these before contributing:

- `README.md` — what understudy is and how to run it.
- `docs/INTERFACES-v0.md` — the frozen adapter contract (the actual product).
- `docs/CONTRACT-LESSONS.md` — what real loops taught us about the contract.

## Invariants you MUST preserve

These are non-negotiable. Any PR is read against them first.

1. **The LLM is never inside the merge gate.** Agents author/heal tests upstream
   (human-reviewed); the gate runs only deterministic Playwright. No agent, no MCP
   server, no model credentials anywhere in CI.
2. **Universal floor = accessibility tree + raw HTTP.** A typed API client is an
   optional, adapter-private enrichment — never required by `core/`.
3. **Auth is mechanism-agnostic.** `core/` knows only the auth *lifecycle*
   (authenticate → capture → restore → verify → refresh) and checks freshness with
   a runtime *probe* (`assertAuthenticated` on the restored state). It never parses
   tokens or cookies. The *mechanism* (cookie/BFF session, bearer in localStorage,
   sessionStorage, OAuth…) is 100% adapter-private. The lifecycle in
   `core/auth-prefill.ts` branches on no mechanism; the only mechanism-specific code
   in `core/` is the opt-in helpers under `core/extras/`, imported solely by adapters
   that need them.
4. **Negative-control is behaviour-level.** Break the real flow → the test must go
   RED. Assertion-mutation is only a supplement, never the proof on its own.
5. **cannot-run = RED, never a silent skip.** `assertSafeTarget` / `assertPreflight`
   throw when the environment isn't safe or is missing config; they never skip.
6. **A new consumer is ONE adapter, core unchanged.** Onboarding a web app means
   implementing the contract in a new adapter. If a change forces `core/` to learn
   something app-specific, that is the wrong shape — raise it as a contract question
   in `docs/CONTRACT-LESSONS.md` first.

## Running the gate locally

The gate is the same deterministic checks CI runs. Get a clean green before you open
a PR.

```bash
bun install
bunx playwright install chromium

# App-free, LLM-free deterministic checks
bun run typecheck
bun run conformance
bun run lint:specs

# Deterministic E2E against the hermetic RealWorld reference (Docker)
bun run realworld:up && bun run e2e:realworld
bun run realworld:down
```

If you touched the auth or seed lifecycle, `bun run burn-in` repeats the reference E2E ×10 as a local
flake hunt:

```bash
bun run burn-in   # repeats the reference E2E ×10 — LOCAL tool, not a CI gate
```

Note it is a LOCAL tool, **not** a CI job: the hermetic single-container reference backend can't
sustain ×10 sustained load (it saturates on bcrypt auth + CRUD — a false signal, not spec flake; see
`docs/CONTRACT-LESSONS.md` L20), so run it against a provisioned stack. The push/PR reference-e2e
matrix (×1 per adapter) is the deterministic gate.

## Conformance suite expectation

`core/`'s behaviour is protected by a generic conformance suite
(`bun run conformance`) that any adapter must pass and that proves the invariants are
**verifiable, not aspirational** (e.g. `track` rejects a non-fixture name; `cleanup`
deletes only fixture resources; `assertSafeTarget` throws on an unsafe target;
`ensureAuth` reuses a probe-valid cached state and re-captures when the probe fails;
the no-mechanism-in-core lint).

**New core behaviour needs a mutation-proven conformance test.** Add a test that
goes RED when the behaviour is broken (mutate the implementation and watch it fail),
not just GREEN on the happy path. A conformance test that still passes after you
sabotage the thing it claims to guard is not protecting anything.

## Pull requests & commits

- **Conventional-commit style** for messages, e.g. `feat(core): ...`, `fix: ...`,
  `docs: ...`, `chore: ...`, `refactor: ...`, `test: ...`.
- **The gate must be green.** `typecheck`, `conformance`, `lint:specs`, and the
  reference E2E all pass before a PR is mergeable.
- Keep the change focused. If you discovered something the contract didn't cleanly
  give you, log it in `docs/CONTRACT-LESSONS.md` rather than bending `core/` to one
  app's needs.
- Describe **which invariant(s) your change touches** (or confirm it touches none)
  in the PR description — this makes review fast.

By contributing you agree that your contributions are licensed under the project's
[MIT License](./LICENSE).
