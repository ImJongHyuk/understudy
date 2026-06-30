<!--
  ⚠️ TEMPORARY / DRAFT — heal round-trip evidence (Plan A / A2) ⚠️
-->

# Heal round-trip evidence — RealWorld reference (credential-free)

A real heal round-trip on the hermetic app: a genuine RED was found, root-caused
from the trace (the B7 e2e-debug capability), and healed with a PRINCIPLED fix that
passes the post-Healer lint (no skip/fixme, no assertion-weakening, no gate-policy
edit). The literal packaged Healer agent needs the `playwright-test` MCP (not
connected in this session); this demonstrates the same loop with the same rules.

## The break (real, not injected)

`article-create-journey.spec.ts` (authored by the workflow from source-reading) went
RED on first live run at the post-publish step:

```
expect(page).toHaveURL(/#\/article\//) — received "http://localhost:3000/#/editor"
```

## Root cause (from the trace + page snapshot)

The editor stayed on `#/editor` and the form showed **"User not found"** — the
article create (`POST /api/articles`) was rejected because the browser's cached
`storageState` token was for a user that does not exist in the CURRENT backend. The
dev DB is ephemeral across stack restarts; the auth freshness probe checked only a
CLIENT-side nav link, so it PASSED on the stale token and reused it. (See L14.)

## The fix (heal — principled, lint-clean)

`auth.adapter.ts` `assertAuthenticated` now also SERVER-validates the cached token
(`GET /api/user`); a server-invalid session fails the probe → `ensureAuth` re-logins
(re-registers). This is a probe correction (L8), NOT a skip/weaken and NOT a
gate-policy edit → it satisfies the post-Healer lint. (A token-extraction bug in the
first attempt was also fixed: the SPA stores `{ loggedUser: { token } }`.)

## Result

```
3 passed — setup (server-validating probe) + article-create (authoring) + articles (seeded)
```

GOOD-after-heal = GREEN; the break was a real behaviour failure (server rejected the
write), root-caused from the trace, fixed without lowering the bar.

## Automated agentic heal on a REAL app change (product loop + a real model)

The above was a hand-driven round-trip. This closes the loop with the AGENTIC Healer (Plane A) on a
REAL code change, end-to-end — the LLM only proposes, the deterministic gate disposes (INV-1).
Reproduce with `scripts/heal-real-break.ts`, which drives the shared product loop `heal/heal-loop.ts`
(the same loop the A3 measurement uses).

Controlled experiments (local hermetic Conduit, 2026-06-21) — each row is a REAL frontend change
(live Vite HMR, NOT a fixture/stub), healed by `scripts/heal-real-break.ts` (deepseek-v4-flash + the
base⊕overlay skill). Each ran GOOD (suite 6/6 GREEN) → BAD (spec RED) → HEALED (gate PASS) →
GOOD-again (revert → GREEN):

| Drift type (real frontend change) | locator strategy | spec broken | Healer's edit → gate |
| --- | --- | --- | --- |
| **button text** — `FeedToggler` "Global Feed" → "All Articles" | `getByRole('button', name)` | articles-journey | `/global feed/i` → `/all articles/i` → **PASS** |
| **input placeholder** — editor "Article Title" → "Story Title" | `getByPlaceholder(...)` | article-create | `getByPlaceholder('Article Title')` → `getByPlaceholder('Story Title')` → **PASS** |
| **submit CTA** — editor "Publish Article" → "Submit Story" | `getByRole('button', name)` | article-create | `/publish article/i` → `/submit story/i` → **PASS** |
| **settings button** — `SettingsForm` "Update Settings" → "Save Profile" | `getByRole('button', name)` | settings-journey | `/update settings/i` → `/save profile/i` → **PASS** |

Why valid: each break is a REAL frontend code change (a renamed control), not a synthetic fixture; the
fix is the legitimate test-maintenance edit (match the renamed control) with EVERY load-bearing
assertion retained (anti-cheat) and no forbidden move (post-heal-lint), verified by a clean re-run
GREEN. The LLM never touched the gate. A cheap model sufficed — this is heal on real drift, the
Healer's actual job (not a synthetic break tuned for a benchmark).

Honest note (a coupling, not a Healer limit): a 4th drift — renaming the "New Article" nav link — is
NOT an isolated spec break. That link is the **auth-freshness probe** (`assertAuthenticated`), so
renaming it fails the SETUP project, not just the spec. A clean `getByRole('link')` drift isn't
available in this corpus (it's the only link the specs target). That coupling is a real observation
about the auth probe; a richer reference app (more independent links/routes) is the way to cover
more drift shapes.

Honest limit (consistent with the probe diagnosis): a comment-textarea drift (`CommentEditor`
"Write a comment…" → "Share your thoughts…") on `comments-journey` did NOT heal with the cheap model
(vacuous — no edit). The comment form is **interaction-gated** (the article detail hydrates only via
in-app feed navigation, not a direct `goto`), so `get_accessibility(path)` doesn't surface it — the
same grounding gap documented in `docs/HEAL-QUALITY.md`. Directly-navigable surfaces (the feed
button, the editor, Settings) heal cleanly; an interaction-gated one needs the grounding lever (or a
stronger model). This is the richer surface earning its keep: it exercises BOTH the easy and the
hard heal shapes.

Two new reference specs cover this richer surface: `settings-journey.spec.ts` (a multi-field form +
a PUT round-trip persistence oracle) and `comments-journey.spec.ts` (a comment thread). Robustness
note surfaced by the richer suite: the global-feed assertion (`articles`/`read-article`/`comments`)
depends on the seeded article being on **page 1** of the feed — true on the pristine-per-`up`
hermetic DB (6/6 GREEN), but it degrades under heavy article ACCUMULATION (pagination pushes the
newest off page 1). Logged as a determinism caveat (see `docs/CONTRACT-LESSONS.md` L16).
