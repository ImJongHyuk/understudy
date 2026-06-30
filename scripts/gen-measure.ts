/**
 * gen-measure — measurement entry for understudy's OWN generation loop (`gen/gen-loop`). The generation
 * analogue of scripts/a3-heal-measure.ts: it builds the `llm/` bridge + gen tools and runs `runGenLoop`
 * with a SKILL, scored by the deterministic gate (the loop's run_test = Playwright + a non-vacuous check
 * — cheap models GAME a naive pass-oracle, see docs/CONTRACT-LESSONS.md L25). This runs ANY OpenRouter
 * model on understudy's OWN runtime — Claude Code is NOT required.
 *
 * Arm = which skill: `guided` (default) = skills/generate.skill.md (the real, shipped skill);
 * `naked` = a minimal no-guidance baseline (to measure the skill's value). The TASK (identical across
 * arms) states the journey + the available seed fixture; only the skill differs. Target = Vikunja.
 *
 * Usage (env: OPENROUTER_API_KEY + A3_OPENROUTER_MODELS from the private env):
 *   bun scripts/gen-measure.ts --model=deepseek-v4-flash --arm=guided --flow=done [--thinking] [--max-tokens=N]
 */
import { chromium } from '@playwright/test'
import * as path from 'node:path'
import { createBridge, parseModels } from '../llm'
import { loadGenerateSkill } from '../skills/load-skill'
import { makeGenTools, type GenTarget } from '../gen/gen-tools'
import { runGenLoop } from '../gen/gen-loop'

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:4173'
const STORAGE = path.resolve('playwright/.auth/vikunja_user.storage.json')
const SPECS_DIR = path.resolve('adapters/vikunja/specs')
const CONFIG = 'playwright.vikunja.config.ts'

/** naked baseline: a minimal generator prompt WITHOUT understudy's authoring guidance (Slack-equiv). */
const NAKED_SKILL =
  'You are a Playwright test generator. Ground locators on the live app via get_accessibility (do not ' +
  "guess), then write the spec via write_spec and verify via run_test. The spec must begin `import { " +
  "test, expect } from '../fixtures'` (authenticated page). Fix and re-run if it fails."

/** Project-specific context shared by BOTH arms (the journey + the available tools). Only the skill differs. */
const SEED_NOTE =
  " A seed fixture is available: `import { seedProject, seedTask } from '../seed.adapter'` (test signature " +
  '`async ({ page, seed })`; seedProject(seed)→{id}, seedTask(seed, projectId)→{id,name}); `seed.request` ' +
  'is an authed APIRequestContext to /api/v1 (e.g. GET /api/v1/projects, POST /api/v1/tasks/:id {done:false}).'

const FLOWS: Record<string, string> = {
  done:
    'Write a test: an authenticated user marks a task as DONE and the test verifies the task is shown as ' +
    'done. You may create the task you operate on.' + SEED_NOTE,
  locate:
    'Write a test: an authenticated user opens the EXISTING task titled "Investigate flaky checkout timeout ' +
    'on staging" (in a project named "understudy-e2e Engineering Backlog" that has many tasks), marks it ' +
    'DONE, and verifies it is shown as done. The task and project already exist.' + SEED_NOTE,
}

function arg(name: string, def = ''): string {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : def
}

async function main() {
  const armName = arg('arm', 'guided')
  const flowName = arg('flow', 'done')
  const thinking = process.argv.includes('--thinking')
  const maxTokensArg = arg('max-tokens')
  const maxTokens = maxTokensArg ? parseInt(maxTokensArg, 10) : 4096
  // --task overrides the canned flows (e.g. to feed a scenario from a Planner-produced plan = the chain).
  const customTask = arg('task')
  const task = customTask || FLOWS[flowName]
  if (!task) throw new Error(`bad --flow=${flowName} (done|locate) — or pass --task="..."`)
  const label = customTask ? 'chain' : flowName
  const skill = armName === 'naked' ? NAKED_SKILL : loadGenerateSkill()

  let models = parseModels(process.env.A3_OPENROUTER_MODELS ?? '')
  const modelFilter = arg('model')
  if (modelFilter) models = models.filter((m) => m.model.includes(modelFilter))
  if (models.length === 0) throw new Error('no model (set A3_OPENROUTER_MODELS or pass --model=)')
  const m = models[0]

  const target: GenTarget = {
    origin: ORIGIN,
    storageStatePath: STORAGE,
    outPath: path.join(SPECS_DIR, `_gen_${armName}_${label}.spec.ts`),
    configPath: CONFIG,
  }

  const bridge = createBridge({
    models: [m],
    route: { requireParameters: true, pin: false, thinking },
    openRouter: { timeoutMs: thinking ? 120_000 : 60_000, retries: 3, maxTokens },
    resilient: { breakerThreshold: 2 },
  })

  const browser = await chromium.launch()
  try {
    const r = await runGenLoop(bridge, makeGenTools(target, browser), skill, task, 14)
    console.log(`MODEL=${m.model}${m.provider ? '|' + m.provider : ''} ARM=${armName} FLOW=${flowName}`)
    console.log(
      `STEPS=${r.steps.map((s) => `${s.name}${s.name === 'run_test' ? '(' + s.arg + ')' : ''}`).join(' → ') || '(none)'}`,
    )
    console.log(`WROTE=${r.wrote} VERIFIED=${r.verified} → ${r.verified ? target.outPath : '(no real pass)'}`)
  } finally {
    await browser.close()
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('gen-measure error:', e?.message ?? e)
    process.exit(1)
  },
)
