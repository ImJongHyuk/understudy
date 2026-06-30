/**
 * Vikunja QUICK-SEARCH CUF — an authenticated user opens the quick-actions/search overlay from the
 * top bar. This targets a role=BUTTON on a STATIC route (the topbar at '/'), complementing the
 * role=link (projects-nav) and placeholder/button-on-a-dynamic-page (create-task) journeys — so a
 * button source-relabel drift breaks it, and it is groundable (the control is at '/', not behind a
 * dynamic/seeded URL), so the heal demo can observe + fix it.
 */
import { test, expect } from '../fixtures'

test.describe('vikunja quick-search journey (reference CUF)', () => {
  test('an authenticated user opens the quick-actions search overlay', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /open the search/i }).click()
    // oracle: the quick-actions overlay opened (its command/search input is visible).
    await expect(page.getByPlaceholder(/type a command or search/i)).toBeVisible()
  })
})
