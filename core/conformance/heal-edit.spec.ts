/**
 * heal/edit conformance — robust spec replace. Exact-substring replace is the worst edit format for
 * weak models (indent/quote/spacing drift → silent "not found", which masquerades as a reasoning
 * failure). applyReplace must land an exact match, a whitespace-drifted near-miss, and on a real
 * miss return a helpful numbered-snippet error — separating edit-APPLY from root-cause failures.
 */
import { test, expect } from '@playwright/test'
import { applyReplace } from '../../heal/edit'

const SPEC = `import { test, expect } from '../fixtures'

test('x', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /your feed/i }).click()
  await expect(page.getByRole('heading', { name: article.name })).toBeVisible()
})
`

test.describe('conformance: applyReplace (robust spec edit)', () => {
  test('exact substring replace (first occurrence)', () => {
    const r = applyReplace(SPEC, '/your feed/i', '/global feed/i')
    expect(r.ok).toBe(true)
    expect(r.spec).toContain('/global feed/i')
    expect(r.spec).not.toContain('/your feed/i')
  })

  test('whitespace-drifted near-miss still lands (the weak-model case)', () => {
    // The model reproduced the line with collapsed/extra spaces — exact match would fail.
    const r = applyReplace(SPEC, "getByRole('button',  { name:  /your feed/i })", "getByRole('button', { name: /global feed/i })")
    expect(r.ok).toBe(true)
    expect(r.spec).toContain('/global feed/i')
  })

  test('indentation drift on a whole line still lands', () => {
    const r = applyReplace(SPEC, "await page.goto('/')", "await page.goto('/#/home')")
    expect(r.ok).toBe(true)
    expect(r.spec).toContain("page.goto('/#/home')")
  })

  test('a real miss returns ok:false with a numbered nearest-lines hint', () => {
    const r = applyReplace(SPEC, "getByRole('button', { name: /nonexistent control/i })", 'x')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not found/i)
    expect(r.error).toMatch(/\d+:/) // a numbered line hint
  })

  test('empty old is rejected (never a no-op success)', () => {
    expect(applyReplace(SPEC, '', 'x').ok).toBe(false)
  })

  test('does not over-replace: only the first occurrence changes', () => {
    const dup = 'a = foo()\nb = foo()\n'
    const r = applyReplace(dup, 'foo()', 'bar()')
    expect(r.ok).toBe(true)
    expect(r.spec).toBe('a = bar()\nb = foo()\n')
  })
})
