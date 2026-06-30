/**
 * Cookie-Notes AUTHORING CUF — the write-plane counterpart to notes-journey
 * (which seeds via the API and reads). Here the authenticated user CREATES a note
 * entirely through the editor UI ("New note" -> fill the form -> Create) and then
 * SEES it: first on the just-created detail page, then back in the list on the
 * home page. This exercises the LLM authoring plane on the hermetic app — a real
 * human-shaped flow, no API shortcut for the create.
 *
 * Auth comes from the composed `test` (httpOnly `sid` cookie via storageState);
 * the note is created through the SUT, so there is no `seed` fixture here. The
 * title is per-run unique so the list assertion is deterministic. There is no
 * teardown: the in-memory store is pristine per stack `up`, so the run leaves no
 * orphan once the stack is torn down.
 */
import { test, expect } from '../fixtures'

// A per-run-unique, fixture-prefixed title so the list assertion can't collide
// with standing data. The prefix matches the seed adapter's so any stray note is
// still recognizably ours.
const title = `understudy-e2e-ui-note-${Date.now()}`
const body = 'created by understudy authoring journey'

test.describe('cookie-notes note-create journey (authoring CUF)', () => {
  test('an authenticated user creates a note via the editor and then sees it', async ({ page }) => {
    await test.step('open the editor from the "New note" link', async () => {
      await page.goto('/')
      // "New note" renders only when authenticated (authed-only nav link).
      await page.getByRole('link', { name: /new note/i }).click()
      // path routing: the editor lives at /notes/new
      await expect(page).toHaveURL(/\/notes\/new$/)
    })

    await test.step('fill in and create the note', async () => {
      await page.getByLabel('Title').fill(title)
      await page.getByLabel('Body').fill(body)
      await page.getByRole('button', { name: /create/i }).click()
    })

    await test.step('the freshly created note detail page shows it', async () => {
      // On success the app redirects to /notes/:id (numeric id assigned by the app).
      await expect(page).toHaveURL(/\/notes\/\d+$/)
      // oracle: the note we just authored renders as the detail-page heading.
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
      // oracle: the body we typed is rendered on the detail page.
      await expect(page.getByText(body)).toBeVisible()
    })

    await test.step('it also appears in the list on the home page', async () => {
      await page.goto('/')
      // oracle: the just-authored note is listed as a link on the home page.
      await expect(page.getByRole('link', { name: title })).toBeVisible()
    })
  })
})
