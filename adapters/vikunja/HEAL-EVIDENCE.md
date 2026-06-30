<!--
  ⚠️ TEMPORARY / DRAFT — adapter-agnostic heal evidence (Vikunja) ⚠️
-->

# Heal evidence — Vikunja (the heal path is adapter-agnostic)

The agentic Healer (Plane A) is no longer RealWorld-bound. `heal/real-tools.ts` takes a `HealTarget`
(origin / storageState / temp-spec path / playwright config) built by `makeHealTarget`, so `heal/`
imports NO adapter and the SAME product loop (`heal/heal-loop.ts`) heals ANY consumer.
`scripts/heal-real-break.ts --target=<name>` selects the consumer; the same run on Conduit still
PASSES (no regression), and it also heals Vikunja.

## A from-source DEV image makes Vikunja source-editable (like Conduit)

The Vikunja reference runs as TWO services (`docker-compose.yml`): `api` is the upstream PROD image
(Go backend, pinned by digest) and `web` is the **frontend from source in Vite DEV mode** (HMR),
built by `Dockerfile.dev` (pinned to the matching upstream tag), proxying `/api` → `api`. So editing
a frontend source file in the `web` container hot-reloads — exactly the Conduit setup. The browser
SUT is the dev frontend (`:4173`); the seed talks to the backend API (`:3456`) directly.

## Real source-relabel drift heal on Vikunja (gate-verified)

Controlled experiments (local hermetic Vikunja dev stack, 2026-06-21) — each is a REAL frontend
SOURCE edit (live Vite HMR), via the SAME generalized driver (`heal-real-break.ts --target=vikunja`,
deepseek-v4-flash). Each ran GOOD (`e2e:vikunja` 5/5 GREEN) → BAD (spec RED) → HEALED (gate PASS) →
GOOD-again (revert):

| Drift type | locator strategy | source edit | spec | Healer's edit → gate |
| --- | --- | --- | --- | --- |
| **nav link** (static `/`) | `getByRole('link', name)` | `Navigation.vue` "Projects" → "Workspaces" | projects-nav | `name: 'Projects'` → `'Workspaces'` → **PASS** |
| **topbar button** (static `/`) | `getByRole('button', name)` | `OpenQuickActions.vue` `title` "Open the search…" → "Find anything" | quick-search | `name: /open the search/i` → `/find anything/i` → **PASS** |
| **input placeholder** (dynamic `/projects/{id}`) | `getByPlaceholder` | `AddTask.vue` placeholder "Add a task…" → "Quick add field" | create-task | `getByPlaceholder(/Add a task/i)` → `getByRole('textbox', { name: /Add a task/i })` → **PASS** |
| **quick-add button** (dynamic `/projects/{id}`) | `getByRole('button', name)` | `AddTask.vue` "Add" → "Insert" | create-task | `name: 'Add'` → `'Insert'` → **PASS** |

The fix is the legitimate test-maintenance edit (match the relabelled control), load-bearing assertion
retained (anti-cheat), no forbidden move, clean re-run GREEN. LLM never in the gate (INV-1).

**The dynamic-page rows are the GROUNDING LEVER paying off.** They were vacuous at first — and the
`--dump` trace showed why: the model DID navigate to the right dynamic URL (`/projects/{id}`), but
`get_accessibility` snapshotted the SPA's "Vikunja is loading…" placeholder (it waited only for
`domcontentloaded`, before the client-side route data fetch + render). With no real controls in the
snapshot, the model blind-guessed and stayed RED. The fundamental fix (`docs/HEAL-QUALITY.md`): make
`get_accessibility` WAIT for the async render to settle (`networkidle`, bounded + best-effort) before
snapshotting. Now the snapshot shows the rendered view → the model grounds the relabelled control and
heals. This is generic (any client-rendered SPA), not Vikunja-specific, and it does NOT regress the
static-route heals.

Two more notes:
- **Pick a relabel that isn't a SUPERSTRING of the old name.** Playwright `getByRole({ name })`
  defaults to SUBSTRING matching, so "Projects" → "All Projects" did NOT break the locator (it still
  matched). "Workspaces" is a real break. (A test-authoring gotcha, surfaced by this drift.)
- **A locale switch is an alternative real break** (no source edit): setting the user's language to
  `de-DE` renders "Projekte", which also breaks the link locator and heals the same way — the auth
  probe is keyed on the USERNAME (data → locale/label-invariant), so a label/locale drift breaks the
  SPEC under test, never the auth setup.
