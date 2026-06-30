/**
 * Vikunja CREATE-TASK CUF — an authenticated user adds a task through the quick-add UI of a SEEDED
 * project and sees it in the list. Unlike projects-nav (a role=link control) this spec targets a
 * PLACEHOLDER input and a role=button — so it is the spec that placeholder/button source-relabel
 * drifts break, and the one the adapter-agnostic heal demo heals across those locator strategies.
 *
 * The project is seeded via the API + torn down by the `seed` fixture (the UI-created task lives in
 * it and is removed by the project cascade); the title is per-run-unique so the assertion is tight.
 */
import { test, expect } from '../fixtures'
import { seedProject } from '../seed.adapter'

test.describe('vikunja create-task journey (authoring CUF)', () => {
  test('an authenticated user adds a task via quick-add and sees it', async ({ page, seed }) => {
    const project = await seedProject(seed)
    const taskTitle = seed.name('uitask')

    await page.goto(`/projects/${project.id}`)
    await page.getByPlaceholder(/Add a task/i).fill(taskTitle)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    // oracle: the task we just created via the UI is listed in the project view.
    await expect(page.getByText(taskTitle)).toBeVisible()
  })
})
