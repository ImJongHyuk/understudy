/**
 * RealWorld (Conduit) READ CUF — a visitor opens a SEEDED article DIRECTLY by its slug
 * and READS it on its detail page. The distinction from articles-journey (which proves
 * "appears in feed + open") is the read PAYLOAD: this asserts the article BODY renders on
 * the detail page — the bytes a reader actually consumes. Opening by slug (not via the feed)
 * keeps the oracle deterministic and not data-volume-brittle — the feed-listing path is
 * covered deliberately by articles-journey (L21).
 *
 * SELF-SEEDING / CI-safe: an earlier demo read spec depended on a manually-seeded
 * standing article, so it failed on a fresh stack. This one seeds its OWN article
 * via the `seed` fixture (real API, torn down even on failure) and asserts THAT
 * article's real title/slug/body — never a hard-coded standing title.
 */
import { test, expect } from '../fixtures'
import { seedArticle } from '../seed.adapter'

test.describe('realworld read-article (read CUF)', () => {
  test('a visitor opens a SEEDED article (by slug) and reads its body', async ({
    page,
    seed,
  }) => {
    // Per-run-unique body so the read assertion is tied to THIS run's seed (not
    // standing data). title/slug come back from the seed; the body is what we sent.
    const body = `the read payload — ${Date.now()}`
    const article = await seedArticle(seed, { body })

    await test.step('open the seeded article directly by slug', async () => {
      // L21: open by the seeded slug — deterministic, not data-volume-brittle. The feed-listing
      // path ("appears in feed + open by clicking") is covered deliberately by articles-journey.
      await page.goto(`/#/article/${article.id}`)
      // oracle: hash routing put us on the SEEDED article's detail page (#/article/:slug).
      await expect(page).toHaveURL(new RegExp(`#/article/${article.id}$`))
      // oracle: the detail page renders the seeded title heading.
      await expect(page.getByRole('heading', { name: article.name })).toBeVisible()
    })

    await test.step('the detail page renders the seeded body (the read payload)', async () => {
      // oracle: the READ payload — the article BODY we seeded is rendered for the reader. This
      // is what distinguishes a READ CUF from "appears + open".
      await expect(page.getByText(body)).toBeVisible()
    })
  })
})
