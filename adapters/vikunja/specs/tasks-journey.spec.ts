/**
 * Vikunja TASKS CUF — the reference journey for the richer consumer. An authenticated user opens a
 * SEEDED project and sees a SEEDED task in it. Proves the full closed loop on a 4th, divergent app
 * (real login → storageState → reuse; real API seed + teardown; real SUT) with ZERO secrets — the
 * same core machinery as the RealWorld/Cookie-Notes references. The `seed` fixture tears both the
 * task and its project down even on failure.
 */
import { test, expect } from '../fixtures'
import { seedProject, seedTask } from '../seed.adapter'

test.describe('vikunja tasks journey (reference CUF)', () => {
  test('an authenticated user sees a SEEDED task inside a SEEDED project', async ({ page, seed }) => {
    const project = await seedProject(seed)
    const task = await seedTask(seed, project.id)

    await test.step('the seeded project view lists the seeded task', async () => {
      await page.goto(`/projects/${project.id}`)
      // oracle: the task just created via the real API is shown in the project's view.
      await expect(page.getByText(task.name)).toBeVisible()
    })
  })
})
