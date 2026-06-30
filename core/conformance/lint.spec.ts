/**
 * Spec-lint CONFORMANCE / mutation proofs — the no-hard-wait + semantic-selector
 * gate (T0.7). Inject a violation → REJECT; clean role-based specs → pass. Ties
 * the lint to the REAL observability spec so it has no false positive.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { lintSpecText } from '../lint-specs'

test.describe('conformance: spec lint rejects flakiness-prone constructs (mutation-proven)', () => {
  test('rejects waitForTimeout (hard wait)', () => {
    expect(lintSpecText('await page.waitForTimeout(500)').map((v) => v.rule)).toContain(
      'no-wait-for-timeout',
    )
  })

  test('rejects a networkidle wait', () => {
    expect(
      lintSpecText("await page.waitForLoadState('networkidle')").map((v) => v.rule),
    ).toContain('no-networkidle')
  })

  test('rejects a raw page-level CSS/XPath selector', () => {
    expect(lintSpecText("await page.locator('.row-0').click()").length).toBeGreaterThan(0)
    expect(lintSpecText('await page.$$("tr")').map((v) => v.rule)).toContain('no-page-query')
  })

  test('PASSES clean role-based selectors, incl. .locator() chained off getByRole', () => {
    const clean =
      "await page.getByRole('table').locator('tbody tr').first().click()\n" +
      "await expect(page.getByRole('heading', { name: /sources/i })).toBeVisible()"
    expect(lintSpecText(clean)).toEqual([])
  })

  test('the REAL reference spec is lint-clean (no false positive)', () => {
    const src = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'adapters/realworld-conduit/specs/articles-journey.spec.ts',
      ),
      'utf-8',
    )
    expect(lintSpecText(src)).toEqual([])
  })
})
