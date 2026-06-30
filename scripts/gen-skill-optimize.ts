/**
 * gen-skill-optimize — SkillOpt for the GENERATE skill: an optimizer LLM learns `skills/generate.skill.md`
 * against the deterministic gate, starting from a NAIVE skill, accepting an edit only when a HELD-OUT
 * gate score improves (Pareto / GEPA-style). The generation analogue of scripts/skill-optimize.ts.
 *
 * The crucial difference from the heal optimizer: there is NO faithful cheap MOCK gate for generation
 * (a generation task has many valid specs, so a substring mock isn't faithful). The reward here is the
 * REAL gate — `runGenLoop`'s run_test (a live Playwright run + the non-vacuous check). That makes each
 * rollout expensive, AND cheap-model generation variance (L25) makes the per-rollout reward noisy — so a
 * trustworthy learned-vs-hand result needs a budgeted LARGE-n run. A small run is a mechanism smoke
 * test, not a result. (See docs/CONTRACT-LESSONS.md L26.)
 *
 * Usage (env: OPENROUTER_API_KEY + A3_OPENROUTER_MODELS):
 *   bun scripts/gen-skill-optimize.ts [--executor=xiaomi/mimo-v2.5|xiaomi/fp8]
 *       [--optimizer=deepseek/deepseek-v4-flash|alibaba] [--epochs=1] [--n=1] [--tasks=mark-done]
 *       [--out=skills/generate.skill.learned.md]
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { createBridge, parseModels, type LlmBridge, type ModelSpec } from '../llm'
import { loadGenerateSkill } from '../skills/load-skill'
import { makeGenTools, type GenTarget } from '../gen/gen-tools'
import { runGenLoop } from '../gen/gen-loop'
import { paretoInsert, bestAggregate, type FrontierMember } from '../heal/pareto'
import { fmtPct } from '../heal/eval-stats'

const API_KEY = process.env.OPENROUTER_API_KEY ?? ''
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:4173'
const STORAGE = path.resolve('playwright/.auth/vikunja_user.storage.json')
const SPECS_DIR = path.resolve('adapters/vikunja/specs')
const CONFIG = 'playwright.vikunja.config.ts'

// --single-shot: score the FIRST write's run_test (no fix loop) so the skill's first-write quality is
// the gradient (the fix loop masks it — L26). Set in main from the flag; read by rolloutGen.
let SINGLE_SHOT = false

const SEED_NOTE =
  " A seed fixture is available: `import { seedProject, seedTask } from '../seed.adapter'` (async ({ page, " +
  'seed }); seedProject(seed)→{id}, seedTask(seed, projectId)→{id,name}); `seed.request` is an authed ' +
  'APIRequestContext to /api/v1.'

/** Self-contained generation tasks (each creates/seeds its own resource — no standing data needed). */
interface GenTask {
  readonly id: string
  readonly prompt: string
}
const TASKS: GenTask[] = [
  // ── easy (self-contained): naive often passes too — weak gradient (smoke only) ──
  { id: 'mark-done', prompt: 'Write a test: an authenticated user marks a task as DONE and verifies it is shown as done. You may create the task you operate on.' + SEED_NOTE },
  { id: 'create-task', prompt: 'Write a test: an authenticated user creates a task in a project (via the UI quick-add or the API seed) and verifies the task appears.' + SEED_NOTE },
  { id: 'set-priority', prompt: 'Write a test: an authenticated user opens a task and sets its priority, and the test verifies the priority is reflected.' + SEED_NOTE },
  // ── hard (locate a PRE-EXISTING resource in a busy project): a real gradient — a UI-locate fails
  //    (target off the first list page, or hidden because done), an API-id approach is robust. Targets
  //    are pre-seeded (see the harness setup) in project "understudy-e2e Backlog". Realistic, not rigged.
  { id: 'locate-active', prompt: "Write a test: open the EXISTING task titled 'Investigate flaky checkout timeout on staging' (it lives in the project 'understudy-e2e Backlog', which has many tasks) and mark it as DONE, then verify it is shown as done. The task and project already exist." + SEED_NOTE },
  { id: 'locate-done', prompt: "Write a test: verify that the EXISTING task titled 'Audit GDPR data retention policy' (in the project 'understudy-e2e Backlog') is marked as DONE. The task already exists and is already done." + SEED_NOTE },
  { id: 'locate-comment', prompt: "Write a test: open the EXISTING task titled 'Refactor the auth token refresh flow' (in the project 'understudy-e2e Backlog', many tasks) and add a comment to it, then verify the comment appears in the task. The task already exists." + SEED_NOTE },
  // ── HARD homogeneous (the single-shot study): verify a PRE-EXISTING, already-DONE (hence list-HIDDEN)
  //    task by title. ALL FIVE share ONE failure mode — a UI-locate can't find a hidden task (naive ~0%),
  //    an API-id lookup is robust (the skill's value). No mutation → stable across many rollouts. So
  //    train + held both EXHIBIT the failure the optimizer must learn to fix (the L26 fix). Pre-seeded.
  ...['Audit GDPR data retention policy', 'Rotate the staging database credentials', 'Deprecate the legacy v1 search endpoint', 'Backfill missing avatar thumbnails', 'Migrate the billing webhooks to the new queue'].map(
    (title, i): GenTask => ({
      id: `hidden-${i + 1}`,
      prompt: `Write a test: verify that the EXISTING task titled '${title}' (in the project 'understudy-e2e Backlog', which has many tasks) is marked as DONE. The task already exists and is already done — do NOT create it.` + SEED_NOTE,
    }),
  ),
]

/** The NAIVE start skill — a minimal generator prompt with NO authoring guidance (the thing to improve). */
const NAIVE_SKILL =
  'You are a Playwright test generator. Ground locators on the live app via get_accessibility (do not ' +
  "guess), then write the spec via write_spec and verify via run_test. The spec must begin `import { " +
  "test, expect } from '../fixtures'`. Fix and re-run if it fails."

interface GenRollout {
  readonly taskId: string
  readonly passed: boolean
  readonly reason: string
}

/** One rollout: run the executor (with a candidate skill) on one task; reward = a real, non-vacuous pass. */
async function rolloutGen(executor: LlmBridge, task: GenTask, skill: string, browser: Browser): Promise<GenRollout> {
  const target: GenTarget = {
    origin: ORIGIN,
    storageStatePath: STORAGE,
    outPath: path.join(SPECS_DIR, `_opt_${task.id}.spec.ts`),
    configPath: CONFIG,
  }
  try {
    const r = await runGenLoop(executor, makeGenTools(target, browser), skill, task.prompt, SINGLE_SHOT ? 8 : 14, SINGLE_SHOT)
    const lastRun = [...r.steps].reverse().find((s) => s.name === 'run_test')
    return { taskId: task.id, passed: r.verified, reason: r.verified ? 'real pass' : (lastRun?.arg ?? 'no run') }
  } catch (e) {
    return { taskId: task.id, passed: false, reason: `error: ${(e as Error).message}` }
  } finally {
    fs.rmSync(path.join(SPECS_DIR, `_opt_${task.id}.spec.ts`), { force: true })
  }
}

/** Mean gate pass-rate of a skill over tasks, n rollouts each + the per-task vector (the Pareto score). */
async function evaluate(
  executor: LlmBridge,
  skill: string,
  tasks: GenTask[],
  n: number,
  browser: Browser,
): Promise<{ score: number; perTask: number[]; rollouts: GenRollout[] }> {
  const rollouts: GenRollout[] = []
  const perTask: number[] = []
  for (const t of tasks) {
    let passes = 0
    for (let i = 0; i < n; i++) {
      const r = await rolloutGen(executor, t, skill, browser)
      rollouts.push(r)
      if (r.passed) passes++
    }
    perTask.push(passes / n)
  }
  const score = rollouts.length ? rollouts.filter((r) => r.passed).length / rollouts.length : 0
  return { score, perTask, rollouts }
}

const OPTIMIZER_SYSTEM = `You optimize a natural-language SKILL document for a Playwright test-GENERATOR agent that uses tools (get_accessibility, write_spec, run_test). A DETERMINISTIC gate scores each generated spec: it must run GREEN and be NON-VACUOUS — it must perform the real user action(s) AND assert on real app/API state, not a constant (no expect(true), no no-op goto). You see the current skill and scored rollouts (which tasks passed/failed and why). Propose a REVISED skill that fixes the observed failures.

Constraints:
- Make MINIMAL, targeted edits (a small "learning rate"): change/add only what the failures justify; keep what already works.
- Stay GENERIC and project-agnostic: NO app-specific control names, NO answers copied from a task — teach HOW to author a robust, non-vacuous spec, not the answer.
- Keep the anti-vacuous + robust-by-construction guidance intact (seed the mid-state; prefer a deterministic id/URL oracle over a list/feed one; make it idempotent).
- Output ONLY the full revised skill markdown — no preamble, no code fences, no commentary.`

async function propose(optimizer: LlmBridge, skill: string, rollouts: GenRollout[], rejected: string[], trainScore: number): Promise<string> {
  const fails = rollouts.filter((r) => !r.passed).map((r) => `- [${r.taskId}] FAIL (${r.reason})`).join('\n')
  const pass = rollouts.filter((r) => r.passed).map((r) => r.taskId).join(', ') || '(none)'
  const rej = rejected.length ? `\n\nPreviously-REJECTED edits (did NOT improve held-out — try something different):\n${rejected.slice(-3).map((x, i) => `${i + 1}. ${x}`).join('\n')}` : ''
  const user = `Current skill:\n"""\n${skill}\n"""\n\nRollouts (train ${(trainScore * 100).toFixed(0)}%): passed = ${pass}.\nFailures:\n${fails || '(none)'}${rej}\n\nReturn the full revised skill markdown.`
  const turn = await optimizer.complete([{ role: 'system', content: OPTIMIZER_SYSTEM }, { role: 'user', content: user }], [])
  let out = (turn.content || '').trim()
  const fence = out.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/)
  if (fence) out = fence[1].trim()
  return out
}

function flag(name: string, def: string): string {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : def
}

async function main() {
  if (!API_KEY) {
    console.error('gen-skill-optimize: OPENROUTER_API_KEY not set — source the private env.')
    process.exit(1)
  }
  const executorSpec = parseModels(flag('executor', 'xiaomi/mimo-v2.5|xiaomi/fp8'))[0] as ModelSpec
  const optimizerSpec = parseModels(flag('optimizer', 'deepseek/deepseek-v4-flash|alibaba'))[0] as ModelSpec
  const epochs = parseInt(flag('epochs', '1'), 10)
  const n = parseInt(flag('n', '1'), 10)
  const outFile = flag('out', 'skills/generate.skill.learned.md')
  SINGLE_SHOT = process.argv.includes('--single-shot')
  const byIds = (csv: string): GenTask[] => {
    const ids = csv.split(',').map((s) => s.trim()).filter(Boolean)
    return ids.map((id) => TASKS.find((t) => t.id === id)).filter((t): t is GenTask => Boolean(t))
  }
  const pickIds = flag('tasks', '').split(',').map((s) => s.trim()).filter(Boolean)
  const corpus = pickIds.length ? byIds(flag('tasks', '')) : TASKS
  // Explicit --train / --held win; else train on the first task(s), hold out the last (so a learned
  // edit is rewarded only if it generalizes). Hold out a HARD task to measure the skill's real value.
  const trainFlag = flag('train', '')
  const heldFlag = flag('held', '')
  const train = trainFlag ? byIds(trainFlag) : corpus.slice(0, Math.max(1, corpus.length - 1))
  const held = heldFlag ? byIds(heldFlag) : corpus.length > 1 ? corpus.slice(-1) : corpus

  const executor = createBridge({
    models: [executorSpec],
    route: { requireParameters: true, pin: false, thinking: true },
    openRouter: { timeoutMs: 120_000, retries: 3, maxTokens: 16_384 },
    resilient: { breakerThreshold: 2 },
  })
  const optimizer = createBridge({
    models: [optimizerSpec],
    route: { requireParameters: true, pin: false, thinking: false },
    openRouter: { timeoutMs: 120_000, retries: 3, maxTokens: 8_192 },
  })

  console.log(`gen-skill-optimize — executor=${executorSpec.model} optimizer=${optimizerSpec.model} epochs=${epochs} n=${n} single-shot=${SINGLE_SHOT}`)
  console.log(`train: ${train.map((t) => t.id).join(', ')} | held-out: ${held.map((t) => t.id).join(', ')}`)
  console.log(`NOTE: REAL gate (live Playwright + non-vacuous) — expensive + noisy (L25). ${SINGLE_SHOT ? 'single-shot = first-write quality (no fix loop, L26).' : 'eventual-pass (fix loop may mask the gradient, L26).'}\n`)

  const browser = await chromium.launch()
  try {
    const fmtVec = (v: number[]) => v.map((x) => `${(x * 100).toFixed(0)}%`).join(',')
    const naiveEval = await evaluate(executor, NAIVE_SKILL, held, n, browser)
    let frontier: FrontierMember<string>[] = [{ scores: naiveEval.perTask, item: NAIVE_SKILL }]
    console.log(`[init] NAIVE held-out per-task = [${fmtVec(naiveEval.perTask)}] (${held.map((t) => t.id).join(',')})`)
    const rejected: string[] = []

    for (let epoch = 1; epoch <= epochs; epoch++) {
      const seed = frontier[(epoch - 1) % frontier.length]
      const trainEval = await evaluate(executor, seed.item, train, n, browser)
      const candidate = await propose(optimizer, seed.item, trainEval.rollouts, rejected, trainEval.score)
      if (!candidate || candidate.length < 100) {
        console.log(`[epoch ${epoch}] optimizer returned empty/short skill — skipping`)
        continue
      }
      const candEval = await evaluate(executor, candidate, held, n, browser)
      const before = frontier.length
      frontier = paretoInsert(frontier, { scores: candEval.perTask, item: candidate })
      const accepted = frontier.some((m) => m.item === candidate)
      console.log(`[epoch ${epoch}] train=${(trainEval.score * 100).toFixed(0)}% -> candidate held-out=[${fmtVec(candEval.perTask)}] => ${accepted ? `ACCEPT (${before}->${frontier.length})` : 'reject (Pareto-dominated)'}`)
      if (!accepted) rejected.push(`an edit scoring [${fmtVec(candEval.perTask)}]`)
    }

    const deployed = bestAggregate(frontier) as FrontierMember<string>
    fs.writeFileSync(outFile, deployed.item + '\n')
    const learnedScore = deployed.scores.reduce((s, x) => s + x, 0) / (deployed.scores.length || 1)
    console.log(`\nfrontier ${frontier.length}; deployed best-aggregate held-out ${(learnedScore * 100).toFixed(0)}% -> ${outFile}`)

    console.log('\n=== comparison — held-out gate pass-rate ===')
    const naive = (await evaluate(executor, NAIVE_SKILL, held, n, browser)).score
    const hand = (await evaluate(executor, loadGenerateSkill(), held, n, browser)).score
    console.log(`naive   : ${fmtPct(Math.round(naive * n * held.length), n * held.length)}`)
    console.log(`LEARNED : ${fmtPct(Math.round(learnedScore * n * held.length), n * held.length)}`)
    console.log(`hand    : ${fmtPct(Math.round(hand * n * held.length), n * held.length)}`)
  } finally {
    await browser.close()
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
