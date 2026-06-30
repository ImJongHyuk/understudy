/**
 * RealWorld (Conduit) reference CUF — the deterministic, no-mock-of-SUT journey.
 *
 * Unlike a credentialed live consumer (whose seeded variant needs credentials), this hermetic app
 * lets us seed a REAL article via the REAL API and assert THAT one — proving the
 * full closed loop (real login -> storageState -> reuse; real seed + teardown; real
 * SUT chain) with ZERO secrets. The `seed` fixture tears the article down even on
 * failure.
 *
 * NOTE (L21): this is the DELIBERATE feed-listing CUF — "the seeded article appears in the global
 * feed" IS the behaviour under test, so the feed oracle stays here on purpose. It is robust by
 * construction under this harness (newest-first feed + create-then-immediately-assert + workers:1,
 * see CONTRACT-LESSONS L16). Specs that only NEED to reach the detail open it by slug instead.
 */
import { test, expect } from '../fixtures'
import { seedArticle } from '../seed.adapter'

test.describe('realworld articles journey (reference CUF)', () => {
  test('an authenticated user sees a SEEDED article in the global feed and opens it', async ({
    page,
    seed,
  }) => {
    const article = await seedArticle(seed)

    await test.step('the seeded article appears in the global feed', async () => {
      await page.goto('/')
      // Conduit's feed toggle is a button; the global feed lists all articles.
      await page.getByRole('button', { name: /global feed/i }).click()
      // oracle: the article just created via the real API is listed in the feed.
      await expect(page.getByRole('heading', { name: article.name })).toBeVisible()
    })

    await test.step('opening it shows the article detail page', async () => {
      await page.getByRole('heading', { name: article.name }).click()
      // hash routing: #/article/:slug
      await expect(page).toHaveURL(new RegExp(`#/article/${article.id}$`))
      await expect(page.getByRole('heading', { name: article.name })).toBeVisible()
    })
  })
})
