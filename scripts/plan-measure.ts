/**
 * plan-measure — measurement entry for understudy's OWN Planner loop (`plan/plan-loop`). Builds the
 * `llm/` bridge + planner tools, runs `runPlanLoop` with the plan skill against a live app, and writes
 * the produced plan. Runs ANY OpenRouter model on understudy's OWN runtime — Claude Code is NOT required.
 * A plan has no run_test gate (it isn't executable); its real verification is downstream (feed a scenario
 * to gen-measure → the deterministic gate).
 *
 * Usage (env: OPENROUTER_API_KEY + A3_OPENROUTER_MODELS from the private env):
 *   bun scripts/plan-measure.ts --model=mimo [--out=/tmp/plan.md] [--thinking] [--max-tokens=N]
 */
import { chromium } from '@playwright/test'
import * as path from 'node:path'
import { createBridge, parseModels } from '../llm'
import { loadPlanSkill } from '../skills/load-skill'
import { makePlanTools, type PlanTarget } from '../plan/plan-tools'
import { runPlanLoop } from '../plan/plan-loop'

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:4173'
const STORAGE = path.resolve('playwright/.auth/vikunja_user.storage.json')

const GOAL =
  'Produce a focused test plan for this task-manager web app. Explore it and design 2–4 concrete, ' +
  'INDEPENDENT user-journey scenarios that a Generator can turn into Playwright specs (e.g. create a ' +
  'task, mark a task done, navigate projects). A seed fixture + an authed /api/v1 are available for ' +
  'setup state; prefer scenarios verifiable by a deterministic id/URL over list position.'

function arg(name: string, def = ''): string {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : def
}

async function main() {
  const thinking = process.argv.includes('--thinking')
  const maxTokensArg = arg('max-tokens')
  const maxTokens = maxTokensArg ? parseInt(maxTokensArg, 10) : 4096
  const outPath = path.resolve(arg('out', '/tmp/understudy-plan.md'))

  let models = parseModels(process.env.A3_OPENROUTER_MODELS ?? '')
  const modelFilter = arg('model')
  if (modelFilter) models = models.filter((m) => m.model.includes(modelFilter))
  if (models.length === 0) throw new Error('no model (set A3_OPENROUTER_MODELS or pass --model=)')
  const m = models[0]

  const target: PlanTarget = { origin: ORIGIN, storageStatePath: STORAGE, outPath }
  const bridge = createBridge({
    models: [m],
    route: { requireParameters: true, pin: false, thinking },
    openRouter: { timeoutMs: thinking ? 120_000 : 60_000, retries: 3, maxTokens },
    resilient: { breakerThreshold: 2 },
  })

  const browser = await chromium.launch()
  try {
    const r = await runPlanLoop(bridge, makePlanTools(target, browser), loadPlanSkill(), GOAL, 10)
    console.log(`MODEL=${m.model}${m.provider ? '|' + m.provider : ''}`)
    console.log(`STEPS=${r.steps.map((s) => `${s.name}${s.arg === 'VACUOUS' ? '(VACUOUS)' : ''}`).join(' → ') || '(none)'}`)
    console.log(`WROTE=${r.wrote} OK=${r.ok} → ${r.ok ? outPath : '(no real plan)'}`)
  } finally {
    await browser.close()
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('plan-measure error:', e?.message ?? e)
    process.exit(1)
  },
)
