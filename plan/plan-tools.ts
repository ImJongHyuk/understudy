/**
 * plan/plan-tools — the TOOL surface for understudy's own PLANNER loop (`plan/plan-loop.ts`), the
 * planning analogue of gen/gen-tools. Two tools, both backed by real Playwright (NO LLM):
 *   - get_accessibility — live-ground: aria snapshot of the running app at a path.
 *   - write_plan        — write the candidate test plan (markdown).
 * A plan is NOT executable, so there is no run_test gate here; the only deterministic check is a light
 * non-vacuous structural one (`isVacuousPlan`). A plan's real verification is DOWNSTREAM — the Generator
 * turns each scenario into a spec that the deterministic gate runs.
 */
import { type Browser } from '@playwright/test'
import * as fs from 'node:fs'

export interface PlanTarget {
  /** App base URL the browser grounds against. */
  readonly origin: string
  /** Playwright storageState the grounding context loads (authenticated session). */
  readonly storageStatePath: string
  /** Absolute path the plan markdown is written to. */
  readonly outPath: string
}

export interface PlanTools {
  get_accessibility(path: string): Promise<string>
  write_plan(content: string): Promise<{ ok: boolean; error?: string }>
  getContent(): string
}

/**
 * A plan is "vacuous" if it has no real scenario structure — too short, or missing numbered/bulleted
 * steps, or missing any heading/scenario marker. A light gate (a plan can't be run); the strong check is
 * downstream generation. Catches an empty/generic/TODO plan a weak model might emit to finish early.
 */
export function isVacuousPlan(md: string): boolean {
  const t = md.trim()
  const hasSteps = /\n\s*\d+\.\s+\S/.test(md) || /\n\s*[-*]\s+\S/.test(md)
  const hasHeadingOrScenario = /\n#{1,4}\s+\S/.test(md) || /scenario|journey/i.test(md)
  return t.length < 200 || !hasSteps || !hasHeadingOrScenario
}

/** Build the planner tools bound to a target + a (shared) browser. Contexts are per-call. */
export function makePlanTools(target: PlanTarget, browser: Browser): PlanTools {
  let content = ''
  return {
    async get_accessibility(p: string): Promise<string> {
      const ctx = await browser.newContext({ storageState: target.storageStatePath, baseURL: target.origin })
      try {
        const page = await ctx.newPage()
        page.setDefaultTimeout(15_000)
        await page.goto(p || '/')
        await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {})
        await page.waitForTimeout(600)
        const snap = await page.locator('body').ariaSnapshot()
        return snap.length > 6_000 ? snap.slice(0, 6_000) + '\n…[truncated]' : snap
      } finally {
        await ctx.close().catch(() => {})
      }
    },
    async write_plan(c: string) {
      try {
        content = c
        fs.writeFileSync(target.outPath, c, 'utf-8')
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    getContent: () => content,
  }
}
