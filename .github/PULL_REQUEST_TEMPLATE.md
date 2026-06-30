<!-- Thanks for contributing to understudy. The invariants below are the whole point of
     the project — a change that violates one will be rejected (see CONTRIBUTING.md). -->

## What & why

<!-- What does this change, and why? Link any related issue. -->

## Invariants (tick what applies; explain any that don't)

- [ ] **No LLM in the merge gate (INV-1)** — the deterministic gate is unchanged / still LLM-free.
- [ ] **Thin core** — `core/` stays project-agnostic; no consumer/app identifiers leaked into it.
- [ ] **Behaviour-level negative-control** — a real break goes RED on its named assertion (not assertion-mutation only).
- [ ] **`cannot-run` → RED** — never a silent skip.
- [ ] New/changed behaviour is covered by the conformance suite.

## Checks

- [ ] `bun run typecheck` passes.
- [ ] `bun run conformance` passes.
- [ ] Specs (if any) follow the authoring lint (`bun run lint:specs`).
