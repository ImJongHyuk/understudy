/**
 * A3 — cheap-model Healer measurement (the runnable form of docs/HEAL-MODEL-DELTA.md).
 *
 * Measures, per cheap model and per break-class, the success-rate of an agentic Healer
 * loop on a fixed induced break: failure in -> tool-driven root-cause -> patch out ->
 * graded by the DETERMINISTIC gate (a clean re-run GREEN with ZERO forbidden moves via
 * the core post-heal-lint, AND the spec actually changed). The LLM is NEVER in the gate
 * (INV-1) — it only proposes; the gate is the oracle. No premium ceiling is run (by
 * choice); we report absolute passes/N per (break, model).
 *
 * Config (from env; the caller sources the private env file):
 *   OPENROUTER_API_KEY      — required.
 *   A3_OPENROUTER_MODELS    — "model|provider,model|provider,..." (provider optional).
 *
 * The LLM layer sits behind the `llm/` provider-abstraction (`createBridge` → OpenRouter
 * with tool-capable routing, prefer-with-fallback, a circuit breaker, and tool-call
 * normalization). It is swappable for a LiteLLM/self-host endpoint without touching the
 * loop or scoring. The routing fix is what makes `xiaomi/mimo-v2.5` measurable — see
 * docs/PROVIDER-ROUTING-LESSONS.md.
 *
 * Usage:
 *   bun scripts/a3-heal-measure.ts --dry-run [--n=2]   # mock tools, validate the loop
 *   bun scripts/a3-heal-measure.ts [--n=5] [--model=x] [--break=name]   # real run
 */
import { chromium } from '@playwright/test'
import { lintHealedChange } from '../core/post-heal-lint'
import { createBridge, parseModels, type ModelSpec } from '../llm'
import { loadHealSkill } from '../skills/load-skill'
import { type HealTools, ensureSetup, cleanupTemp, runSpecOnce, makeRealTools, makeHealTarget } from '../heal/real-tools'
import { runHealLoop } from '../heal/heal-loop'
import { formatRolloutTrace, type StepRecord } from '../heal/diagnostics'
import { triageRollout } from '../heal/triage'
import { applyReplace } from '../heal/edit'
import fs from 'node:fs'
import { realworldAuthAdapter } from '../adapters/realworld-conduit/auth.adapter'

// A3 measures against the RealWorld reference consumer.
const HEAL_TARGET = makeHealTarget({
  authAdapter: realworldAuthAdapter,
  playwrightConfig: 'playwright.realworld.config.ts',
  specsDir: 'adapters/realworld-conduit/specs',
})

const API_KEY = process.env.OPENROUTER_API_KEY ?? ''

// The heal skill (Plane A) is a FIRST-CLASS artifact: a base skill ⊕ an optional per-project overlay,
// composed by skills/load-skill.ts (see skills/heal.skill.md). The realworld adapter may add
// adapters/realworld-conduit/heal.overlay.md. The product heal loop itself lives in heal/heal-loop.ts
// (shared with the real-break demo); we pass this skill into it.
const SYSTEM_PROMPT = loadHealSkill({ overlayPath: 'adapters/realworld-conduit/heal.overlay.md' })

// ── the break taxonomy (each is a covered control on the authed realworld home) ─
interface Break {
  readonly id: string
  readonly note: string
  readonly broken: string
  /** A substring present ONLY while still broken (mock run_test heuristic for --dry-run). */
  readonly brokenMarker: string
  /** For INSERTION fixes: a substring present ONLY once fixed (mock passes when present). */
  readonly fixedMarker?: string
  /** Load-bearing substrings the heal MUST preserve — anti-cheat so a "flow" break can't be
   * greened by gutting/retargeting the assertion instead of fixing the real (upstream) cause. */
  readonly mustRetain?: readonly string[]
  /** A canned accessibility tree for --dry-run (the real run reads the live app). */
  readonly mockSnapshot: string
}
const SPEC = (testName: string, locatorExpr: string) => `import { test, expect } from '../fixtures'

test('${testName}', async ({ page }) => {
  await page.goto('/')
  await expect(page.${locatorExpr}).toBeVisible()
})
`
const HOME_SNAPSHOT = [
  '- navigation:',
  '  - link " Home"',
  '  - link " New Article"   (/url "#/editor")',
  '  - text: understudy-e2e',
  '- main:',
  '  - button "Your Feed"',
  '  - button "Global Feed"',
  '  - heading "Popular Tags" [level=6]',
].join('\n')

const BREAKS: Break[] = [
  {
    id: 'name-rename',
    note: 'wrong accessible NAME (button exists under a different name)',
    broken: SPEC('a3 name — feed toggle', "getByRole('button', { name: /show all articles/i })"),
    brokenMarker: '/show all articles/i',
    mockSnapshot: HOME_SNAPSHOT,
  },
  {
    id: 'wrong-role',
    note: '"New Article" is a LINK, not a button (wrong ROLE)',
    broken: SPEC('a3 role — new article', "getByRole('button', { name: /new article/i })"),
    brokenMarker: "getByRole('button', { name: /new article/i })",
    mockSnapshot: HOME_SNAPSHOT,
  },
  {
    id: 'changed-text',
    note: 'heading copy drift ("Popular Tags", not "Trending Topics")',
    broken: SPEC('a3 text — sidebar heading', "getByRole('heading', { name: /trending topics/i })"),
    brokenMarker: '/trending topics/i',
    mockSnapshot: HOME_SNAPSHOT,
  },
  {
    id: 'exact-case',
    note: 'over-strict exact+case match ("Your Feed", not exact "YOUR FEED")',
    broken: SPEC('a3 exact — your feed', "getByRole('button', { name: 'YOUR FEED', exact: true })"),
    brokenMarker: "'YOUR FEED', exact: true",
    mockSnapshot: HOME_SNAPSHOT,
  },
  // ── HARD: flow breaks. The FAILING line is NOT the line to fix — the model must
  // root-cause from the flow + the error, not just rewrite the failing locator. Each
  // seeds a REAL article and keeps a load-bearing assertion (mustRetain) so the only
  // way to green is the genuine fix, not gutting/retargeting the assertion.
  {
    id: 'flow-wrong-step',
    note: 'wrong UPSTREAM step: clicks "Your Feed" (empty) so the seeded article never shows; fix the CLICK, not the (correct) assertion',
    broken: `import { test, expect } from '../fixtures'
import { seedArticle } from '../seed.adapter'

test('a3 flow-wrong-step — seeded article in feed', async ({ page, seed }) => {
  const article = await seedArticle(seed)
  await page.goto('/')
  await page.getByRole('button', { name: /your feed/i }).click()
  await expect(page.getByRole('heading', { name: article.name })).toBeVisible()
})
`,
    brokenMarker: '/your feed/i',
    mustRetain: ['article.name', 'toBeVisible'],
    mockSnapshot: HOME_SNAPSHOT,
  },
]

// ── scoring (deterministic; the gate is the oracle) ──────────────────────────
interface AttemptResult {
  readonly passed: boolean
  readonly reason: string
}
async function score(brk: Break, tools: HealTools): Promise<AttemptResult> {
  const finalSpec = tools.getSpec()
  if (finalSpec === brk.broken) return { passed: false, reason: 'no edit (vacuous)' }
  // Anti-cheat: a flow break must be fixed at its real cause, not by gutting the assertion.
  for (const must of brk.mustRetain ?? []) {
    if (!finalSpec.includes(must)) return { passed: false, reason: `dropped load-bearing \`${must}\`` }
  }
  const violations = lintHealedChange([
    { path: 'adapters/realworld-conduit/specs/_a3.spec.ts', before: brk.broken, after: finalSpec },
  ])
  if (violations.length > 0) {
    return { passed: false, reason: `forbidden move: ${violations.map((v) => v.rule).join(',')}` }
  }
  const final = await tools.run_test()
  if (!final.passed) return { passed: false, reason: 'test still RED' }
  return { passed: true, reason: 'healed cleanly' }
}

// ── mock tools (--dry-run): no docker/Playwright ─────────────────────────────
function makeMockTools(brk: Break): HealTools {
  let spec = brk.broken
  return {
    getSpec: () => spec,
    async run_test() {
      const stillBroken = brk.fixedMarker ? !spec.includes(brk.fixedMarker) : spec.includes(brk.brokenMarker)
      return stillBroken
        ? { passed: false, output: `Error: still broken (mock heuristic)` }
        : { passed: true, output: '1 passed' }
    },
    async get_accessibility() {
      return brk.mockSnapshot
    },
    async replace_in_spec(old, replacement) {
      const r = applyReplace(spec, old, replacement)
      if (!r.ok) return { ok: false, error: r.error }
      spec = r.spec as string
      return { ok: true }
    },
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const dumpFile = args.find((a) => a.startsWith('--dump='))?.split('=')[1] ?? ''
  if (dumpFile) fs.writeFileSync(dumpFile, `# a3 heal rollout traces — N varies\n`)
  const nArg = args.find((a) => a.startsWith('--n='))
  const N = nArg ? parseInt(nArg.split('=')[1], 10) : dryRun ? 2 : 5
  const modelArg = args.find((a) => a.startsWith('--model='))
  const breakArg = args.find((a) => a.startsWith('--break='))
  // Reasoning-mode experiment knobs: --thinking turns reasoning ON (default OFF). Pair it
  // with a generous --max-tokens so reasoning has room AND the tool call still fits, and a
  // larger --timeout-ms since reasoning responses are slower.
  const thinking = args.includes('--thinking')
  const maxTokensArg = args.find((a) => a.startsWith('--max-tokens='))
  const maxTokens = maxTokensArg ? parseInt(maxTokensArg.split('=')[1], 10) : undefined
  const timeoutArg = args.find((a) => a.startsWith('--timeout-ms='))
  const timeoutMs = timeoutArg ? parseInt(timeoutArg.split('=')[1], 10) : thinking ? 120_000 : 35_000

  if (!API_KEY) {
    console.error('A3: OPENROUTER_API_KEY not set (cannot-run = RED). Source the private env first.')
    process.exit(1)
  }
  let models = parseModels(process.env.A3_OPENROUTER_MODELS ?? '')
  if (modelArg) models = models.filter((m) => m.model.includes(modelArg.split('=')[1]))
  let breaks = BREAKS
  if (breakArg) breaks = BREAKS.filter((b) => b.id.includes(breakArg.split('=')[1]))
  if (models.length === 0 || breaks.length === 0) {
    console.error('A3: no models or no breaks to run.')
    process.exit(1)
  }

  console.log(`A3 heal measurement — ${dryRun ? 'DRY-RUN (mock)' : 'REAL'} — N=${N}`)
  console.log(`reasoning=${thinking ? 'ON' : 'OFF'} max_tokens=${maxTokens ?? 'default'} timeout=${timeoutMs}ms`)
  console.log(`models: ${models.map((m) => m.model).join(', ')}`)
  console.log(`breaks: ${breaks.map((b) => b.id).join(', ')}\n`)

  if (!dryRun) {
    console.log('ensuring auth (realworld setup project)…')
    ensureSetup(HEAL_TARGET)
  }
  // One shared browser for every get_accessibility call (real runs); contexts are per-call.
  const sharedBrowser = dryRun ? null : await chromium.launch()

  // grid[breakId][model] = passes
  const grid: Record<string, Record<string, number>> = {}

  for (const brk of breaks) {
    grid[brk.id] = {}
    // Validate the break is RED deterministically before measuring (well-posed).
    if (!dryRun) {
      const red = runSpecOnce(HEAL_TARGET, brk.broken)
      if (red.passed) {
        console.error(`A3: break "${brk.id}" is NOT red (ill-posed) — skipping.`)
        cleanupTemp(HEAL_TARGET)
        continue
      }
    }
    for (const m of models) {
      // One bridge per (break, model), reused across the N attempts so the circuit breaker
      // can fast-fail a stalling provider after the first couple of misses instead of each
      // attempt re-hammering (and timing out on) it. Routing fix: tool-capable +
      // prefer-with-fallback, NOT a rigid single-provider pin — see
      // docs/PROVIDER-ROUTING-LESSONS.md (this is what makes mimo measurable).
      const bridge = createBridge({
        models: [m],
        route: { requireParameters: true, pin: false, thinking },
        openRouter: { timeoutMs, retries: 3, ...(maxTokens ? { maxTokens } : {}) },
        resilient: {
          breakerThreshold: 2,
          onEvent: (e) => {
            if (e.type === 'tripped') console.log(`  ⚡ breaker tripped: ${e.model}`)
          },
        },
      })
      let passes = 0
      for (let i = 0; i < N; i++) {
        const tools = dryRun ? makeMockTools(brk) : makeRealTools(HEAL_TARGET, brk.broken, sharedBrowser!)
        let r: AttemptResult
        let steps: StepRecord[] = []
        try {
          steps = await runHealLoop(bridge, tools, SYSTEM_PROMPT)
          r = await score(brk, tools)
        } catch (e) {
          r = { passed: false, reason: `loop error: ${(e as Error).message}` }
        }
        if (r.passed) passes++
        console.log(`[${brk.id}][${m.model}] attempt ${i + 1}: ${r.passed ? 'PASS' : 'FAIL'} (${r.reason})`)
        if (dumpFile) {
          const tri = triageRollout({ passed: r.passed, reason: r.reason, steps })
          fs.appendFileSync(
            dumpFile,
            `\n===== ${m.model} | attempt ${i + 1} =====\n` +
              formatRolloutTrace({ brkId: brk.id, passed: r.passed, reason: r.reason, steps }) +
              `\n\ntriage: ${tri.category} → ${tri.lever}\n  ${tri.detail}\n`,
          )
        }
      }
      grid[brk.id][m.model] = passes
    }
  }
  if (!dryRun) cleanupTemp(HEAL_TARGET)
  await sharedBrowser?.close()

  console.log('\n=== A3 summary — passes/N per break × model ===')
  const header = ['break'.padEnd(14), ...models.map((m) => m.model.split('/').pop()!.padEnd(20))]
  console.log(header.join(' | '))
  for (const brk of breaks) {
    const row = [brk.id.padEnd(14)]
    for (const m of models) {
      const p = grid[brk.id]?.[m.model]
      row.push(`${p === undefined ? 'skip' : `${p}/${N}`}`.padEnd(20))
    }
    console.log(row.join(' | '))
  }
}

// Force a clean exit even if a best-effort browser.close() leaked a chromium handle
// (otherwise the open handle keeps the process alive after the summary is printed).
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
