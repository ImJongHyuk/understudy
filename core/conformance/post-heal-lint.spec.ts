/**
 * Post-Healer lint CONFORMANCE / mutation proofs — the deterministic gate side of
 * INV-6 (T-heal). For each of the four ways a heal could launder a red test as
 * green, inject that mutation into a healed patch → REJECT; and prove that a
 * LEGITIMATE heal (a pure selector correction with unchanged test/expect counts)
 * → [] (no violations). Pure-unit (no browser, no network), so the gate's
 * "LLM never lowers the bar" boundary is VERIFIED, not asserted.
 */
import { test, expect } from '@playwright/test'
import { lintHealedChange } from '../post-heal-lint'
import type { HealChange } from '../post-heal-lint'

/** A realistic adapter spec, used as the pre-heal baseline for each mutation. */
const BASE_SPEC = [
  "import { test, expect } from '../fixtures'",
  '',
  "test.describe('journey', () => {",
  "  test('sees the seeded article', async ({ page }) => {",
  "    await page.goto('/')",
  "    await page.getByRole('button', { name: /global feed/i }).click()",
  "    await expect(page.getByRole('heading', { name: /hello/i })).toHaveText(/hello/)",
  '  })',
  '',
  "  test('opens the article detail', async ({ page }) => {",
  "    await page.getByRole('heading', { name: /hello/i }).click()",
  '    await expect(page).toHaveURL(/#\\/article\\/^slug$/)',
  '  })',
  '})',
  '',
].join('\n')

const change = (over: Partial<HealChange>): HealChange => ({
  path: 'adapters/realworld-conduit/specs/articles-journey.spec.ts',
  before: BASE_SPEC,
  after: BASE_SPEC,
  ...over,
})

test.describe('conformance: post-heal lint enforces INV-6 (mutation-proven)', () => {
  // ── rule 1: gate-policy edit ───────────────────────────────────────────────
  test('REJECTS a heal that edits gate code under core/', () => {
    const rules = lintHealedChange([
      change({ path: 'core/lint-specs.ts', before: 'const RULES = [a]', after: 'const RULES = []' }),
    ]).map((v) => v.rule)
    expect(rules).toContain('gate-policy-edit')
  })

  test('REJECTS a heal that edits a conformance proof under core/conformance/', () => {
    const rules = lintHealedChange([
      change({ path: 'core/conformance/trust.spec.ts', before: 'expect(x)', after: 'expect(y)' }),
    ]).map((v) => v.rule)
    expect(rules).toContain('gate-policy-edit')
  })

  test('REJECTS a heal that edits a trust path', () => {
    const rules = lintHealedChange([
      change({ path: 'trust/burn-in.json', before: '{"runs":5}', after: '{"runs":1}' }),
    ]).map((v) => v.rule)
    expect(rules).toContain('gate-policy-edit')
  })

  // ── rule 2: skip / quarantine added ────────────────────────────────────────
  test('REJECTS a heal that adds test.skip', () => {
    const after = BASE_SPEC.replace("test('opens the article detail'", "test.skip('opens the article detail'")
    const rules = lintHealedChange([change({ after })]).map((v) => v.rule)
    expect(rules).toContain('skip-or-quarantine-added')
  })

  test('REJECTS a heal that adds test.fixme', () => {
    const after = BASE_SPEC.replace("test('opens the article detail'", "test.fixme('opens the article detail'")
    expect(lintHealedChange([change({ after })]).map((v) => v.rule)).toContain(
      'skip-or-quarantine-added',
    )
  })

  test('REJECTS a heal that adds test.only', () => {
    const after = BASE_SPEC.replace("test('sees the seeded article'", "test.only('sees the seeded article'")
    expect(lintHealedChange([change({ after })]).map((v) => v.rule)).toContain(
      'skip-or-quarantine-added',
    )
  })

  test('REJECTS a heal that adds test.slow', () => {
    const after = BASE_SPEC.replace(
      "await page.goto('/')",
      "test.slow()\n    await page.goto('/')",
    )
    expect(lintHealedChange([change({ after })]).map((v) => v.rule)).toContain(
      'skip-or-quarantine-added',
    )
  })

  test('REJECTS a heal that introduces xit/xtest', () => {
    const after = BASE_SPEC.replace("test('opens the article detail'", "xit('opens the article detail'")
    expect(lintHealedChange([change({ after })]).map((v) => v.rule)).toContain(
      'skip-or-quarantine-added',
    )
  })

  // ── rule 3: test count reduced ─────────────────────────────────────────────
  test('REJECTS a heal that deletes a test case', () => {
    // Drop the second test entirely (one test( -> ... remains).
    const after = BASE_SPEC.slice(0, BASE_SPEC.indexOf("  test('opens")) + '})\n'
    const rules = lintHealedChange([change({ after })]).map((v) => v.rule)
    expect(rules).toContain('test-count-reduced')
  })

  // ── rule 4: assertion weakened ─────────────────────────────────────────────
  test('REJECTS a heal that removes an expect()', () => {
    const after = BASE_SPEC.replace(
      "    await expect(page).toHaveURL(/#\\/article\\/^slug$/)\n",
      '',
    )
    expect(lintHealedChange([change({ after })]).map((v) => v.rule)).toContain('assertion-weakened')
  })

  test('REJECTS a matcher downgrade (toHaveText -> toBeVisible)', () => {
    const after = BASE_SPEC.replace(
      "await expect(page.getByRole('heading', { name: /hello/i })).toHaveText(/hello/)",
      "await expect(page.getByRole('heading', { name: /hello/i })).toBeVisible()",
    )
    expect(lintHealedChange([change({ after })]).map((v) => v.rule)).toContain('assertion-weakened')
  })

  test('REJECTS a matcher downgrade (specific value -> toBeTruthy)', () => {
    const before =
      "test('x', async () => { await expect(getCount()).toEqual(3) })\n"
    const after =
      "test('x', async () => { await expect(getCount()).toBeTruthy() })\n"
    expect(
      lintHealedChange([change({ path: 'adapters/a/specs/a.spec.ts', before, after })]).map(
        (v) => v.rule,
      ),
    ).toContain('assertion-weakened')
  })

  test('REJECTS dropping a regex anchor (^…$ widened)', () => {
    const after = BASE_SPEC.replace('/#\\/article\\/^slug$/', '/#\\/article\\/slug/')
    expect(lintHealedChange([change({ after })]).map((v) => v.rule)).toContain('assertion-weakened')
  })

  test('REJECTS widening an existing timeout to mask slowness', () => {
    const before =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 1000 }) })\n"
    const after =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 30000 }) })\n"
    expect(
      lintHealedChange([change({ path: 'adapters/a/specs/a.spec.ts', before, after })]).map(
        (v) => v.rule,
      ),
    ).toContain('assertion-weakened')
  })

  test('REJECTS newly introducing a timeout to mask slowness', () => {
    const before =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible() })\n"
    const after =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 30000 }) })\n"
    expect(
      lintHealedChange([change({ path: 'adapters/a/specs/a.spec.ts', before, after })]).map(
        (v) => v.rule,
      ),
    ).toContain('assertion-weakened')
  })

  // HARDEN G1 — a numeric separator must not smuggle a widening past rule 4d. A
  // naive /\d+/ read `30_000` as `30` (< before), missing a 6x widening AND
  // mis-reporting the value. Assert both the REJECT and the corrected figure.
  test('REJECTS widening via a numeric-separator timeout (30_000) and reports the real value', () => {
    const before =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 }) })\n"
    const after =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 }) })\n"
    const violations = lintHealedChange([change({ path: 'adapters/a/specs/a.spec.ts', before, after })])
    expect(violations.map((v) => v.rule)).toContain('assertion-weakened')
    // Value reporting: must show the true 30000, never the leading-run 30.
    expect(violations.some((v) => v.detail.includes('30000ms'))).toBe(true)
    expect(violations.some((v) => v.detail.includes('30ms'))).toBe(false)
  })

  // HARDEN G1 — scientific notation is the same evasion: `1e4` read as `1`.
  test('REJECTS widening via an exponent timeout (1e4)', () => {
    const before =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 }) })\n"
    const after =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 1e4 }) })\n"
    const violations = lintHealedChange([change({ path: 'adapters/a/specs/a.spec.ts', before, after })])
    expect(violations.map((v) => v.rule)).toContain('assertion-weakened')
    expect(violations.some((v) => v.detail.includes('10000ms'))).toBe(true)
  })

  // HARDEN G1 (re-refute) — an explicit leading sign also evades a bare-digit read:
  // `timeout: +30000` made the old capture fail entirely (maxTimeout -> -1, "no
  // timeout"), silently allowing a 6x widening. The signed literal must be parsed.
  test('REJECTS widening via a sign-prefixed timeout (+30000) and reports the real value', () => {
    const before =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 }) })\n"
    const after =
      "test('x', async () => { await expect(page.getByRole('alert')).toBeVisible({ timeout: +30000 }) })\n"
    const violations = lintHealedChange([change({ path: 'adapters/a/specs/a.spec.ts', before, after })])
    expect(violations.map((v) => v.rule)).toContain('assertion-weakened')
    expect(violations.some((v) => v.detail.includes('30000ms'))).toBe(true)
  })

  // ── legitimate heal: a pure selector correction PASSES ─────────────────────
  test('PASSES a legitimate selector correction (unchanged test/expect counts)', () => {
    const after = BASE_SPEC.replace(
      "await page.getByRole('button', { name: /global feed/i }).click()",
      "await page.getByRole('tab', { name: /global feed/i }).click()",
    )
    // Pure getByRole name/role fix — same tests, same expects, no skip, no downgrade.
    expect(after).not.toEqual(BASE_SPEC) // sanity: the mutation actually changed something
    expect(lintHealedChange([change({ after })])).toEqual([])
  })

  // HARDEN G1 — the robust timeout parser must NOT manufacture a false positive:
  // a clean selector heal whose UNCHANGED timeout uses a separator/exponent parses
  // identically before vs after, so rule 4d stays silent and the heal passes clean.
  test('PASSES a clean selector heal whose unchanged timeout uses a separator (no FP)', () => {
    const before =
      "test('x', async ({ page }) => { await expect(page.getByRole('button', { name: /go/i })).toBeVisible({ timeout: 30_000 }) })\n"
    const after =
      "test('x', async ({ page }) => { await expect(page.getByRole('tab', { name: /go/i })).toBeVisible({ timeout: 30_000 }) })\n"
    expect(after).not.toEqual(before) // sanity: the selector actually changed
    expect(lintHealedChange([change({ path: 'adapters/a/specs/a.spec.ts', before, after })])).toEqual(
      [],
    )
  })

  test('PASSES adding a NEW adapter spec file (before == "")', () => {
    expect(
      lintHealedChange([
        change({ path: 'adapters/a/specs/new.spec.ts', before: '', after: BASE_SPEC }),
      ]),
    ).toEqual([])
  })
})
