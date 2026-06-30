/**
 * Cookie-Notes reference CUF — the deterministic, no-mock-of-SUT journey.
 *
 * Like the RealWorld articles-journey, this hermetic app lets us seed a REAL note
 * via the REAL cookie-authed API and assert THAT one — proving the full closed loop
 * (real login -> storageState cookie -> reuse; real seed + teardown; real SUT chain)
 * with ZERO secrets. The browser session and the seed session share the SAME fixed
 * throwaway user, so the seeded note is the signed-in user's own note and shows in
 * the list. The `seed` fixture tears down even on failure (here a no-op: the
 * in-memory store is pristine per stack `up`).
 */
import { test, expect } from '../fixtures'
import { seedNote } from '../seed.adapter'

test.describe('cookie-notes notes journey (reference CUF)', () => {
  test('an authenticated user sees a SEEDED note in the list and opens it', async ({
    page,
    seed,
  }) => {
    const note = await seedNote(seed)

    await test.step('the seeded note appears in the list on the home page', async () => {
      await page.goto('/')
      // oracle: the note just created via the real cookie-authed API is listed.
      await expect(page.getByRole('link', { name: note.name })).toBeVisible()
    })

    await test.step('opening it shows the note detail page', async () => {
      await page.getByRole('link', { name: note.name }).click()
      // path routing: /notes/:id
      await expect(page).toHaveURL(new RegExp(`/notes/${note.id}$`))
      // oracle: the detail page renders the seeded note's title as the heading.
      await expect(page.getByRole('heading', { name: note.name })).toBeVisible()
    })
  })
})
