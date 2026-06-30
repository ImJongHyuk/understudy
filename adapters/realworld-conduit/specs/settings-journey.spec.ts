/**
 * RealWorld (Conduit) SETTINGS CUF — the account-management plane. An authenticated user edits a
 * field on the Settings form and the change PERSISTS (a real PUT /api/user round-trip, asserted by
 * reloading the form). This exercises a surface the other reference specs don't: a multi-field form
 * (placeholder-labelled inputs) + a submit button + a persistence oracle.
 *
 * Only the BIO is touched — never email/password — so the shared hermetic test user (and thus every
 * other spec's auth) is unaffected. The value is per-run-unique so the reload assertion is tight.
 */
import { test, expect } from '../fixtures'

test.describe('realworld settings journey (account CUF)', () => {
  test('an authenticated user updates their bio and it persists', async ({ page }) => {
    const bio = `understudy-e2e bio ${Date.now()}`

    await test.step('open Settings and update the bio', async () => {
      await page.goto('/#/settings')
      await expect(page.getByRole('heading', { name: /your settings/i })).toBeVisible()
      await page.getByPlaceholder('Short bio about you').fill(bio)
      await page.getByRole('button', { name: /update settings/i }).click()
    })

    await test.step('the update persisted (reload the form, the bio is still there)', async () => {
      await page.goto('/#/settings')
      // oracle: the server stored the bio (PUT /api/user) — the reloaded form shows it.
      await expect(page.getByPlaceholder('Short bio about you')).toHaveValue(bio)
    })
  })
})
