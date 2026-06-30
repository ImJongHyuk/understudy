<!-- Evidence: the packaged Playwright Agents (Planner / Generator / Healer) work end-to-end on
     understudy's harness, driven via the playwright-test MCP. The campaign's product loop
     (heal/heal-loop.ts) has been a faithful PROXY for this toolchain; this is the real thing. -->

# Packaged-agent evidence — Planner / Generator / Healer via the playwright-test MCP

understudy is a harness on **Playwright Agents**. Most of the campaign validated a *product loop*
(`heal/heal-loop.ts`) as a proxy for the packaged agents (so it could run a cheap model against the
real gate). This closes that gap: the **literal packaged agents**, driven through the `playwright-test`
MCP, were run end-to-end against the hermetic reference consumer (Conduit) + the RealWorld adapter +
`playwright.realworld.config.ts`. INV-1 holds throughout — the agents author/heal UPSTREAM; the gate
that decides pass/fail runs ONLY deterministic Playwright.

Wiring: `.mcp.json` points the MCP server at `playwright.realworld.config.ts`. `test_list` returns the
6 reference tests, confirming the MCP is bound to understudy's config (not a stray default). The MCP's
working directory is the parent workspace, so test paths it writes/runs are prefixed `repos/understudy/`
— a harness-integration note for anyone reproducing this.

## Planner → Generator → gate (GREEN)

1. **Planner** — `planner_setup_page(project=realworld)` brought up an authenticated page (the project
   `storageState` from the `setup` project). Explored the home page (`browser_navigate` +
   `browser_snapshot`), then `planner_submit_plan` recorded a data-independent reader journey: "an
   authenticated user sees the home shell and switches to the Global Feed".
2. **Generator** — `generator_setup_page(plan)` re-primed the page; the steps were performed with the
   browser tools (`browser_navigate`, `browser_verify_element_visible`/`_text_visible`, `browser_click`),
   `generator_read_log` assembled the recorded locators + web-first assertions, and
   `generator_write_test` wrote `adapters/realworld-conduit/specs/agent-home-feed.spec.ts`.
3. **Gate** — `test_run` → **2 passed** (setup + the agent-generated test). The test passes `bun run
   lint:specs` (no skip/fixme/forbidden waits) and `tsc`. It is hermetic (no seed; asserts the home
   shell + feed-tab navigation), so it is stable on the pristine-per-`up` DB.

## Healer (RED → test_debug → GREEN)

A REAL frontend change (not a fixture) drove the heal: `FeedToggler` "Global Feed" → "All Articles"
(edited in the running container; live Vite HMR).

- `test_run` on the unchanged agent test → **RED**: `getByRole('button', { name: 'Global Feed' })` →
  "element(s) not found".
- `test_debug` → **paused on the error with the page snapshot at the moment of failure**, which showed
  the relabeled control `button "All Articles"`. This is the Healer's grounding evidence — it can *see*
  the control was renamed, not just that a line timed out.
- Principled heal (locator → "All Articles", every assertion retained — no skip/weaken, no gate edit) →
  `test_run` → **GREEN**.
- Reverted the app change AND the locator → `test_run` → **GREEN** (GOOD-again). The committed spec
  targets the REAL control ("Global Feed"), so it is valid against the unbroken pinned app.

## What this establishes / honest limits

- The packaged Planner/Generator/Healer toolchain integrates with understudy's adapter, config, auth
  (`storageState`), and deterministic gate — the proxy loop was faithful.
- `agent-home-feed.spec.ts` is kept as a **labelled, agent-generated reference CUF** + a living
  regression guard that the toolchain still works (it runs in the normal `realworld` project).
- `agents/` was NOT scaffolded via `playwright init-agents`; what is validated is the MCP machinery the
  agents drive (planner/generator/test tools). Scaffolding the `--loop=claude` agent guides is a
  separate, optional step.
- The generated test is intentionally data-independent. A seeded flow (e.g. asserting a specific
  article) would wire the adapter's `seed` fixture into the generated test — a richer follow-up.
