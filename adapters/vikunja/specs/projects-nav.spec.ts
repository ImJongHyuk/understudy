/**
 * Vikunja NAV CUF — an authenticated user opens the Projects page from the sidebar. A second, control-
 * driven journey (the tasks-journey is data-driven): it targets a NAMED nav link, so it is the spec a
 * real label/locale drift breaks — and the one the adapter-agnostic heal demo heals (scripts/
 * heal-real-break.ts --target=vikunja). The URL assertion is locale-invariant (routes aren't
 * translated); only the link's accessible name drifts.
 */
import { test, expect } from '../fixtures'

test.describe('vikunja projects-nav journey (reference CUF)', () => {
  test('an authenticated user opens the Projects page from the sidebar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Projects' }).click()
    // oracle: the projects route loaded (locale-invariant — the URL is not translated).
    await expect(page).toHaveURL(/\/projects/)
  })
})
