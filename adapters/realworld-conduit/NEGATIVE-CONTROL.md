<!--
  ⚠️ TEMPORARY / DRAFT — behavior-level negative-control evidence (RealWorld) ⚠️
-->

# Negative-control evidence — RealWorld reference journey

The credential-free, **real-SUT** version of the trust floor: a stronger proof than
a mock-based negative-control, because the regressed build is a REAL backend +
frontend, not fixtures.

## Method

- Spec: `specs/articles-journey.spec.ts`; named line:
  `await expect(page).toHaveURL(new RegExp(\`#/article/${article.id}$\`))` (line 31).
- Injected APP-CODE regression (a real code change in the Conduit frontend, NOT
  seed/stub): `ArticlesPreview.jsx` `to={\`/article/${article.slug}\`}` →
  `to={\`/article/${article.slug}-broken\`}` (the preview link routes to a wrong
  slug). Reverted with `git checkout` immediately after.

## Result — the quadrant (verified 2026-06-17, local hermetic Conduit)

| Build | Outcome | Detail |
|---|---|---|
| GOOD (unmodified) | **GREEN** (4.6s) | feed lists the seeded article; opens to its detail |
| BAD (injected code regression) | **RED** | fails ON line 31: `toHaveURL` got `…/#/article/<slug>-broken` |
| GOOD again (after revert) | **GREEN** | controlled experiment closed cleanly |

## Why valid

Behaviour failure (the SUT routes to the wrong article) surfaced by the specific
navigation assertion — not seed/stub manipulation, not an infra timeout, not vacuous
(GOOD build is green). Real backend + frontend in the loop, zero secrets.
