/**
 * RealWorld (Conduit) COMMENTS CUF — the engagement plane. An authenticated user opens a SEEDED
 * article DIRECTLY by its seeded slug (the feed is incidental navigation here — the behaviour under
 * test is commenting — so opening by slug is deterministic and not data-volume-brittle, L21. Direct
 * hash-nav hydrates the detail incl. the comment form, see CONTRACT-LESSONS L19) and posts a comment
 * that then appears in the thread. New surface vs the other
 * specs: a comment textarea + a post button + a thread oracle.
 *
 * The article is seeded via the real API and torn down by the `seed` fixture (even on failure); the
 * comment is per-run-unique so the assertion is tight.
 */
import { test, expect } from '../fixtures'
import { seedArticle } from '../seed.adapter'

test.describe('realworld comments journey (engagement CUF)', () => {
  test('an authenticated user comments on a seeded article and sees it in the thread', async ({
    page,
    seed,
  }) => {
    const article = await seedArticle(seed)
    const comment = `understudy-e2e comment ${Date.now()}`

    await test.step('open the seeded article directly by slug', async () => {
      // L21: the feed is incidental here; open by the seeded slug — deterministic, not data-volume-
      // brittle. Direct hash-nav hydrates the detail incl. the comment form (CONTRACT-LESSONS L19).
      await page.goto(`/#/article/${article.id}`)
      await expect(page).toHaveURL(new RegExp(`#/article/${article.id}$`))
    })

    await test.step('post a comment and see it in the thread', async () => {
      await page.getByPlaceholder('Write a comment...').fill(comment)
      await page.getByRole('button', { name: /post comment/i }).click()
      // oracle: the comment we just posted is rendered in the thread.
      await expect(page.getByText(comment)).toBeVisible()
    })
  })
})
