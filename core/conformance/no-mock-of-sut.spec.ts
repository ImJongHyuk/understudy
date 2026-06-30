/**
 * No-mock-of-SUT CONFORMANCE / mutation proofs — the SUT-chain-stays-real gate.
 * Route the SUT's own API → REJECT; route a third-party host (not a sutMatcher)
 * → pass. Ties the lint to the REAL reference specs so it has no false positive
 * (both honor no-mock-of-SUT by construction).
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { lintNoMockOfSut, NO_MOCK_OF_SUT_RULE } from '../no-mock-of-sut'

const SUT = ['/api', 'localhost:3001'] as const

test.describe('conformance: no-mock-of-SUT rejects mocking the SUT chain (mutation-proven)', () => {
  test('rejects page.route of the SUT API (glob)', () => {
    expect(
      lintNoMockOfSut("await page.route('**/api/articles', (r) => r.fulfill({}))", ['/api']).map(
        (v) => v.rule,
      ),
    ).toContain(NO_MOCK_OF_SUT_RULE)
  })

  test('rejects context.route of the SUT host', () => {
    expect(
      lintNoMockOfSut(
        "await context.route('https://localhost:3001/api/x', (r) => r.abort())",
        SUT,
      ).length,
    ).toBeGreaterThan(0)
  })

  test('rejects a *.route handle (any receiver name) of the SUT', () => {
    expect(
      lintNoMockOfSut('await ctx.route("**/api/**", handler)', SUT).map((v) => v.rule),
    ).toContain(NO_MOCK_OF_SUT_RULE)
  })

  // ── Hardened evasions an adversary reached for (G2) ──────────────────────
  test('rejects a MULTI-LINE page.route() of the SUT (auto-formatted)', () => {
    // Playwright auto-format puts the matcher on its own line, so the `.route(`
    // line carries no quoted arg — the joined-buffer scan still sees the call.
    const src = "await page.route(\n  '**/api/articles',\n  (r) => r.fulfill({}),\n)"
    const v = lintNoMockOfSut(src, SUT)
    expect(v.map((x) => x.rule)).toContain(NO_MOCK_OF_SUT_RULE)
    expect(v[0].line).toBe(1) // reported at the `.route(` line, not the matcher line
  })

  test('rejects bracket-notation receiver page["route"](...) of the SUT', () => {
    expect(
      lintNoMockOfSut(`await page["route"]('**/api/articles', (r) => r.abort())`, SUT).map(
        (v) => v.rule,
      ),
    ).toContain(NO_MOCK_OF_SUT_RULE)
  })

  test('rejects back-tick bracket-notation receiver page[`route`](...) of the SUT', () => {
    expect(
      lintNoMockOfSut('await page[`route`]("**/api/**", handler)', SUT).length,
    ).toBeGreaterThan(0)
  })

  test('rejects a RegExp route matcher of the SUT', () => {
    // A RegExp first-arg (escaped delimiter `\/api`) is inspected against its source.
    expect(
      lintNoMockOfSut('await page.route(/\\/api\\/articles/, (r) => r.fulfill({}))', SUT).map(
        (v) => v.rule,
      ),
    ).toContain(NO_MOCK_OF_SUT_RULE)
  })

  test('rejects a MULTI-LINE bracket-notation RegExp route of the SUT (combined)', () => {
    const src = 'await context[`route`](\n  /localhost:3001\\/api/,\n  (r) => r.abort(),\n)'
    expect(lintNoMockOfSut(src, SUT).length).toBeGreaterThan(0)
  })

  test('PASSES a multi-line route of a THIRD-PARTY host (not a sutMatcher)', () => {
    const src = "await page.route(\n  'https://cdn.example.com/track.js',\n  (r) => r.abort(),\n)"
    expect(lintNoMockOfSut(src, SUT)).toEqual([])
  })

  test('PASSES a RegExp route of a THIRD-PARTY host (not a sutMatcher)', () => {
    expect(
      lintNoMockOfSut('await page.route(/cdn\\.example\\.com/, (r) => r.abort())', SUT),
    ).toEqual([])
  })

  test('PASSES a clean spec with no route at all', () => {
    const clean =
      "await page.goto('/')\n" +
      "await page.getByRole('button', { name: /global feed/i }).click()"
    expect(lintNoMockOfSut(clean, SUT)).toEqual([])
  })

  test('PASSES routing a THIRD-PARTY host not in sutMatchers', () => {
    // Stubbing a third-party (e.g. analytics) is allowed — only the SUT chain is sacred.
    expect(
      lintNoMockOfSut("await page.route('https://cdn.example.com/track.js', (r) => r.abort())", SUT),
    ).toEqual([])
  })

  test('IGNORES a commented-out SUT route', () => {
    expect(
      lintNoMockOfSut("// await page.route('**/api/articles', noop)", SUT),
    ).toEqual([])
  })

  test('does NOT flag a bare SUT URL that is not a .route() matcher', () => {
    // A real spec references `/api/...` in request.delete(...) — that is the REAL
    // SUT chain, not an interception, and must not be flagged.
    expect(lintNoMockOfSut("await request.delete(`/api/articles/${slug}`)", SUT)).toEqual([])
  })

  test('empty sutMatchers → no violations (core stays consumer-agnostic)', () => {
    expect(lintNoMockOfSut("await page.route('**/api/articles', noop)", [])).toEqual([])
  })

  for (const file of ['articles-journey.spec.ts', 'article-create-journey.spec.ts']) {
    test(`the REAL reference spec ${file} honors no-mock-of-SUT (no false positive)`, () => {
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'adapters/realworld-conduit/specs', file),
        'utf-8',
      )
      expect(lintNoMockOfSut(src, ['/api', 'localhost:3001'])).toEqual([])
    })
  }
})
