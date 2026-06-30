/**
 * RealWorld (Conduit) AUTHORING CUF — the write-plane counterpart to
 * articles-journey (which seeds via the API and reads). Here the authenticated
 * user CREATES an article entirely through the editor UI ("New Article" ->
 * fill the form -> Publish) and then SEES it: first on the just-published detail
 * page, then back in the Global Feed. This exercises the LLM authoring plane on
 * the hermetic app — a real human-shaped flow, no API shortcut for the create.
 *
 * Auth comes from the composed `test` (localStorage JWT via storageState); the
 * article is created through the SUT, so there is no `seed` fixture here. The
 * title is per-run unique so the feed assertion is deterministic, and we delete
 * the created article via the API in an afterEach so the run leaves no orphan.
 */
import { test, expect } from '../fixtures'
import { realworldSeedAdapter } from '../seed.adapter'

// A per-run-unique, fixture-prefixed title so the slug is unique and the feed
// assertion can't collide with standing data. Matches the seed adapter's prefix
// so any stray article is still recognizably ours.
const title = `understudy-e2e-ui-article-${Date.now()}`
const description = 'authored through the editor UI'
const body = 'created by understudy authoring journey'

test.describe('realworld article-create journey (authoring CUF)', () => {
  // Best-effort teardown of the UI-created article so the run leaves no orphan.
  // Uses the same self-bootstrapped machine auth as the seed path; a 404 (never
  // created) is fine.
  test.afterEach(async () => {
    realworldSeedAdapter.assertSafeTarget()
    const request = await realworldSeedAdapter.newRequestContext()
    try {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      await request.delete(`/api/articles/${slug}`)
    } finally {
      await request.dispose()
    }
  })

  test('an authenticated user creates an article via the editor and then sees it', async ({
    page,
  }) => {
    await test.step('open the editor from the navbar "New Article" link', async () => {
      await page.goto('/')
      // "New Article" renders only when authenticated (authed-only nav link).
      await page.getByRole('link', { name: /new article/i }).click()
      // hash routing: the editor lives at #/editor
      await expect(page).toHaveURL(/#\/editor$/)
    })

    await test.step('fill in and publish the article', async () => {
      // Editor fields are placeholder-labelled inputs (no associated <label>).
      await page.getByPlaceholder('Article Title').fill(title)
      await page.getByPlaceholder("What's this article about?").fill(description)
      await page.getByPlaceholder('Write your article (in markdown)').fill(body)
      // The submit button reads "Publish Article" when creating (vs "Update Article").
      await page.getByRole('button', { name: /publish article/i }).click()
    })

    await test.step('the freshly published article detail page shows it', async () => {
      // On success the SPA navigates to #/article/:slug (slug derived from title).
      await expect(page).toHaveURL(/#\/article\//)
      // oracle: the article we just authored renders as the detail-page heading.
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
      // oracle: the body we typed is rendered on the detail page.
      await expect(page.getByText(body)).toBeVisible()
    })

    await test.step('it also appears in the Global Feed', async () => {
      // L21/L16: a feed-listing oracle, kept because the just-published article is newest → page 1
      // by construction (create-then-immediately-assert, workers:1). The deterministic proof is the
      // detail-by-slug assertions above; this step adds real feed-discovery coverage.
      await page.goto('/')
      // Conduit's feed toggle is a button; the global feed lists all articles.
      await page.getByRole('button', { name: /global feed/i }).click()
      // oracle: the just-authored article is listed in the global feed.
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    })
  })
})
