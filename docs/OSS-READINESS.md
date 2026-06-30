# OSS readiness

understudy is destined to be open-sourced. This is the release-discipline checklist and the mechanism
that enforces the one hard constraint — **no internal/consumer identifier ships in the public source.**

## The leak guard (enforced, not aspirational)

`core/no-consumer-identifiers.ts` is a pure, deterministic, evasion-resistant forbidden-identifier
scan, proven in `core/conformance/no-consumer-identifiers.spec.ts` (mutation-tested with synthetic
tokens). Two scopes, both run in conformance (and therefore in CI, on every push/PR):

- `scanCoreDir` — `core/*.ts` (the original guard).
- `scanPublishableTree` — the WHOLE publishable tree: `core/`, `heal/`, `adapters/`, `scripts/`,
  `llm/`, `docs/`, `.github/`, plus root docs (README/CONTRIBUTING/CLAUDE), across
  `.ts/.md/.yml/.json`. Prose docs are scanned too — a name slips into prose far more easily than into
  typed code.

The denylist is **consumer-supplied, never hardcoded** (baking the secret names into the guard would
itself publish them). Resolution order:

1. `UNDERSTUDY_FORBIDDEN_IDENTIFIERS` — inline, comma/newline-separated.
2. `UNDERSTUDY_FORBIDDEN_FILE` — path to a token-per-line file.
3. `.understudy-forbidden.local` — a gitignored file in CWD (auto-loaded).
4. nothing configured → empty list → **no-op** (a public clone guarding no internal names is a valid
   pass, not a failure).

So public CI (no denylist) is a no-op; the maintainer's machine (gitignored denylist present) actually
enforces it. Keep real internal tokens ONLY in the private/gitignored denylist — never in tracked
source. See `.understudy-forbidden.example` for the format.

## Verified status (current)

- Whole-tree scan with the maintainer denylist: **0 hits** across all publishable files — the harness
  is identifier-clean (code, comments, prose, CI).
- No internal adapter in `adapters/` (only the generic hermetic reference consumers: realworld-conduit,
  cookie-notes, vikunja). The private downstream consumer is maintained outside this repo.
- `core/auth-prefill.ts` binds to NO auth mechanism (the `sessionstorage|oidc|bearer|…` words that
  appear in docs/specs are the *verification regex* proving that, not identifiers).

## Pre-public checklist (open items)

These are not leaks — they are clarity/coverage decisions to settle before flipping the repo public:

- [x] **Synthetic-fixture residue removed; skill-learning kept (it uses the REAL gate).** Audited the
      benchmark-era code: the only true "artificial benchmark" residue was `heal/generate-fixtures.ts`
      (a generator of self-authored synthetic broken specs — and dead: zero importers), now removed.
      The skill-learning tooling (`scripts/skill-optimize.ts` + `heal/eval-stats.ts`, `heal/pareto.ts`,
      `heal/optimizer-prompt.ts`) is KEPT: it learns the skill against the REAL deterministic gate (not
      synthetic fixtures) — the project's "the gate is the verifier that teaches the skill" thesis,
      which is aligned with "verify the real system", so it ships as documented research tooling.
- [x] **Auth-mechanism coverage.** Mechanism-agnostic auth is proven on bearer-localStorage (×2),
      cookie-session, AND an OAuth2/OIDC redirect flow (`adapters/oidc/`, the 5th consumer — see
      CONTRACT-LESSONS L18). The last mechanism class is closed, core unchanged.
- [ ] **Packaged agents.** The Planner/Generator/Healer toolchain is validated via the playwright-test
      MCP (see `AGENTS-EVIDENCE.md`); `playwright init-agents` scaffolding of the `--loop=claude` agent
      guides is optional and not yet committed.
- [ ] **Final pass.** Re-run `bun run conformance` (the tree-wide guard) + `bun run lint:specs` +
      `bun run typecheck` green; confirm no `.env`/secret/storageState artifacts are tracked.
- [ ] **Git HISTORY is not publishable as-is — publish from a clean root.** The leak guard scans the
      WORKING TREE, not git history. Early history contains a now-EXTRACTED internal adapter and internal
      identifiers (removed from the working tree during the OSS scrub — e.g. the adapter extraction in
      `ffc7b75` and the denylist externalization in `208089a`). `git log -p` over the current history
      would therefore still expose them. **Before flipping public, do NOT publish this history:** either
      publish the current clean tree as a fresh single-root repo (recommended for a project this size), or
      rewrite history (`git filter-repo`) to drop the extracted-adapter path and scrub identifiers across
      ALL commits — then re-verify by running the whole-tree guard against every commit, not just HEAD.
      (Found 2026-06-24 during the OSS-readiness review; the working tree itself is clean.)
