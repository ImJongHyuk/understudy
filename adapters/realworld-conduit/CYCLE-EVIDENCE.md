<!--
  ⚠️ TEMPORARY / DRAFT — packaged Planner→Generator→Healer cycle evidence ⚠️
-->

# Packaged agent cycle evidence — Planner → Generator → Healer (via the MCP)

The full upstream (Plane A) cycle, run end-to-end against the live hermetic
RealWorld/Conduit app through the `playwright-test` MCP. Each role ran as the
packaged agent's prompt (`.claude/agents/playwright-test-*.md`) driving the MCP
tools. Verified 2026-06-17.

> The packaged subagent *names* aren't auto-discovered from the workbench root
> (they live in this repo's `.claude/agents/`), so each role was run by a
> general-purpose subagent primed with the packaged prompt + the connected MCP —
> the packaged LOGIC, same tools. From a session rooted in this repo the named
> agents resolve directly.

## 1. Planner — explored the live app, saved a plan

Drove the MCP (`planner_setup_page` → `browser_navigate`/`browser_snapshot`) over
the live app and saved a one-scenario plan: *"A visitor opens an article from the
Global Feed and reads it on its detail page."* It correctly observed the real DOM:
home defaults to an empty "Your Feed"; the `button "Global Feed"` reveals the seeded
article; the preview links to `#/article/welcome-to-conduit`.

## 2. Generator — drove the flow, wrote a working spec

Drove the scenario live (`generator_setup_page` → navigate → click "Global Feed" →
click the article → `generator_read_log` → `generator_write_test`) and wrote a spec
that fit the adapter conventions (imported `../fixtures`, hash routing, role-first
selectors, `// oracle:` notes, lint-clean). It RAN GREEN via the MCP runner:

```
✓ setup › authenticate
✓ realworld › read-article › a visitor opens an article from the Global Feed and reads it on its detail page
2 passed
```

## 3. Healer — diagnosed a real RED, fixed it, re-ran green (INV-6 honored)

An induced selector drift (`button /show all articles/i`, which doesn't exist) made
the spec RED. The Healer ran `test_run` (saw the failure), diagnosed via `test_debug`
+ `browser_snapshot` (the real control is `button "Global Feed"`), and fixed ONLY the
selector:

```diff
- await page.getByRole('button', { name: /show all articles/i }).click()
+ await page.getByRole('button', { name: 'Global Feed' }).click()
```

→ re-ran GREEN in 1 attempt. **INV-6 compliance (verified):** no `test.skip`/`fixme`/
`only`, no test removed (count unchanged), no assertion/matcher weakened, no gate
(`core/**`/trust) edited, lint still clean. A selector correction to match reality —
exactly what the post-Healer lint permits.

## Disposition

The cycle's value is the demonstrated capability, recorded here. The generated
`read-article.spec.ts` (+ its plan + the MCP default `seed.spec.ts` stub) were demo
byproducts: the spec reads a MANUALLY-seeded standing article, so it would fail on a
fresh stack / in CI (L2 standing-data dependence) and overlaps `articles-journey`.
They were removed to keep the committed suite CI-robust (every shipped spec
self-seeds). To turn the read flow into a permanent spec, harden it to seed its own
article via the `seed` fixture (as `articles-journey` does).
