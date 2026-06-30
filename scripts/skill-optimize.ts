/**
 * Stage 2 (experiment e1) — a SkillOpt-style optimizer that LEARNS the heal skill against the
 * deterministic gate, then compares the learned skill to the hand-authored base (R1–R4).
 *
 * The thesis: the gate (our verifier) can *author* the scaffold we wrote by hand. We start from a
 * NAIVE skill (the old "Fix ONLY the locator" prompt that gave weak models 0/5), and let an
 * optimizer LLM propose bounded edits — accepting an edit ONLY when a HELD-OUT gate score strictly
 * improves (INV-1 at the meta level: the LLM proposes, the deterministic gate disposes).
 *
 * Rollouts run on a MOCK surface (fast, no docker/chromium) but the reward is the REAL gate:
 * `lintHealedChange` (no forbidden moves) + a green re-run + `mustRetain` (anti-cheat) + a
 * non-vacuous edit. The mock is faithful — green only on the genuinely-correct fix.
 *
 * Usage:
 *   bun scripts/skill-optimize.ts [--executor=xiaomi/mimo-v2.5|xiaomi/fp8] [--optimizer=deepseek/deepseek-v4-flash|alibaba]
 *                                 [--epochs=3] [--n=2] [--out=skills/heal.skill.learned.md]
 */
import fs from 'node:fs'
import { chromium, type Browser } from '@playwright/test'
import { lintHealedChange } from '../core/post-heal-lint'
import { loadHealSkill } from '../skills/load-skill'
import { createBridge, parseModels, type LlmBridge, type ModelSpec, type ToolSchema } from '../llm'
import { type HealTools, ensureSetup, cleanupTemp, runSpecOnce, makeRealTools, makeHealTarget } from '../heal/real-tools'
import { realworldAuthAdapter } from '../adapters/realworld-conduit/auth.adapter'

// The optimizer measures against the RealWorld reference consumer.
const HEAL_TARGET = makeHealTarget({
  authAdapter: realworldAuthAdapter,
  playwrightConfig: 'playwright.realworld.config.ts',
  specsDir: 'adapters/realworld-conduit/specs',
})
import { applyReplace } from '../heal/edit'
import { buildOptimizerLocalizeNote } from '../heal/optimizer-prompt'
import { formatRolloutTrace, type StepRecord } from '../heal/diagnostics'
import { triageRollout } from '../heal/triage'
import { parseClicks } from '../heal/probe'
import { fmtPct, newcombeDiff } from '../heal/eval-stats'
import { paretoInsert, bestAggregate, type FrontierMember } from '../heal/pareto'

const API_KEY = process.env.OPENROUTER_API_KEY ?? ''

// ── task corpus (mock breaks; the gate is faithful — green only on the right fix) ────────────
interface Break {
  readonly id: string
  readonly broken: string
  /** Substring present ONLY while still broken (mock run_test is RED while present). */
  readonly brokenMarker: string
  /** Load-bearing substrings the heal MUST preserve (anti-cheat). */
  readonly mustRetain?: readonly string[]
  /** Accessibility snapshot returned by the mock get_accessibility. */
  readonly snapshot: string
}

// Deliberately NON-leading: the page shows both feed tabs but the snapshot does NOT spell out
// where the seeded article lives. The agent must REASON from the TEST STRUCTURE (it clicks "Your
// Feed" — the user's personal feed — before asserting a freshly-seeded article) that the click
// switched away from the default feed. A snapshot that displays the article makes even the naive
// prompt win (the answer is on-screen) — so we withhold it to test the *skill*, not the read.
const HOME = `- navigation:
  - link "Home"
  - link "New Article" (link, href "#/editor")
  - text: understudy-e2e
- main:
  - button "Your Feed"
  - button "Global Feed"
  - heading "Popular Tags" [level=6]
  - text: "Showing the global article feed by default."`

const single = (name: string, locator: string) => `import { test, expect } from '../fixtures'

test('${name}', async ({ page }) => {
  await page.goto('/')
  await expect(page.${locator}).toBeVisible()
})
`

const BREAKS: Break[] = [
  {
    id: 'name-rename',
    broken: single('name', "getByRole('button', { name: /show all articles/i })"),
    brokenMarker: '/show all articles/i',
    snapshot: HOME,
  },
  {
    id: 'wrong-role',
    broken: single('role', "getByRole('button', { name: /new article/i })"),
    brokenMarker: "getByRole('button', { name: /new article/i })",
    snapshot: HOME,
  },
  {
    id: 'changed-text',
    broken: single('text', "getByRole('heading', { name: /trending topics/i })"),
    brokenMarker: '/trending topics/i',
    snapshot: HOME,
  },
  {
    id: 'exact-case',
    broken: single('exact', "getByRole('button', { name: 'YOUR FEED', exact: true })"),
    brokenMarker: "'YOUR FEED', exact: true",
    snapshot: HOME,
  },
  // ── flow discriminators: the failing line is the assertion, but the cause is an UPSTREAM step.
  // Multiple fixtures (different surfaces of the SAME root-cause skill) let us split by FIXTURE
  // (no class-leakage) and average out the per-rollout coin-flip. Each seeds a REAL article that
  // shows in the default Global Feed at '/', and a wrong upstream step hides it.
  ...flowFixtures(),
]

/** Build the flow-break fixtures. Each: seed an article, do a WRONG upstream step, then assert the
 * (correct) article heading — RED until the UPSTREAM step is fixed (not the assertion). */
function flowFixtures(): Break[] {
  const spec = (upstream: string) => `import { test, expect } from '../fixtures'
import { seedArticle } from '../seed.adapter'

test('flow', async ({ page, seed }) => {
  const article = await seedArticle(seed)
${upstream}
  await expect(page.getByRole('heading', { name: article.name })).toBeVisible()
})
`
  const mustRetain = ['article.name', 'toBeVisible']
  return [
    {
      id: 'flow-feed-tab',
      // wrong CLICK: "Your Feed" (the user's empty personal feed) hides the seeded article.
      broken: spec(`  await page.goto('/')\n  await page.getByRole('button', { name: /your feed/i }).click()`),
      brokenMarker: '/your feed/i',
      mustRetain,
      snapshot: HOME,
    },
    {
      id: 'flow-nav-settings',
      // wrong NAVIGATION: the settings page has no article heading.
      broken: spec(`  await page.goto('/#/settings')`),
      brokenMarker: '/#/settings',
      mustRetain,
      snapshot: HOME,
    },
    {
      id: 'flow-nav-editor',
      // wrong NAVIGATION: the editor page has no article heading.
      broken: spec(`  await page.goto('/#/editor')`),
      brokenMarker: '/#/editor',
      mustRetain,
      snapshot: HOME,
    },
  ]
}

// ── mock tools (a fast rollout surface; HealTools + real tools come from heal/real-tools) ─────
function mockRunTest(brk: Break, spec: string): { passed: boolean; output: string } {
  if (spec.includes(brk.brokenMarker)) {
    return { passed: false, output: `Error: expect(locator).toBeVisible() failed — still broken (${brk.brokenMarker}).` }
  }
  return { passed: true, output: '1 passed' }
}
function makeMockTools(brk: Break): HealTools {
  let spec = brk.broken
  return {
    getSpec: () => spec,
    async run_test() {
      return mockRunTest(brk, spec)
    },
    async get_accessibility() {
      return brk.snapshot
    },
    async replace_in_spec(old, replacement) {
      const r = applyReplace(spec, old, replacement)
      if (!r.ok) return { ok: false, error: r.error }
      spec = r.spec as string
      return { ok: true }
    },
  }
}

// ── the gate (reward): deterministic, no LLM (INV-1). Uses tools.run_test for the final GREEN
//    check, so the SAME gate scores both the mock surface and the REAL playwright gate. ───────
async function score(brk: Break, tools: HealTools): Promise<{ passed: boolean; reason: string }> {
  const finalSpec = tools.getSpec()
  if (finalSpec === brk.broken) return { passed: false, reason: 'no edit (vacuous)' }
  for (const must of brk.mustRetain ?? []) {
    if (!finalSpec.includes(must)) return { passed: false, reason: `dropped \`${must}\`` }
  }
  const violations = lintHealedChange([{ path: 'specs/_opt.spec.ts', before: brk.broken, after: finalSpec }])
  if (violations.length > 0) return { passed: false, reason: `forbidden: ${violations.map((v) => v.rule).join(',')}` }
  if (!(await tools.run_test()).passed) return { passed: false, reason: 'still RED' }
  return { passed: true, reason: 'healed' }
}

// ── rollout: run the executor (with a candidate skill) on one break ──────────────────────────
const TOOL_SCHEMAS: ToolSchema[] = [
  { name: 'run_test', description: 'Run the failing test; returns passed + output.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'get_accessibility', description: 'Accessibility tree (roles + names) of the app at a path. Optionally pass `clicks` (accessible names of buttons/links) to click IN ORDER after navigating and snapshot the RESULT — use this to GROUND interaction-gated state (e.g. items behind a tab or "show all" toggle) before editing, instead of guessing a URL.', parameters: { type: 'object', properties: { path: { type: 'string' }, clicks: { type: 'array', items: { type: 'string' }, description: 'optional accessible names of buttons/links to click in order after navigating, to reach interaction-gated state' } }, required: ['path'] } },
  { name: 'replace_in_spec', description: 'Replace an exact substring in the test file with a corrected one.', parameters: { type: 'object', properties: { old: { type: 'string' }, replacement: { type: 'string' } }, required: ['old', 'replacement'] } },
]

// Lever C+D (deep-research): a TOOL-GROUNDED localize, harness-enforced (a *prompted* trace is
// unfaithful CoT and won't transfer — only a forced, evidence-grounded routine generalizes). When
// enabled, EVERY edit must be immediately preceded by a `localize` that names the earliest upstream
// step whose result is wrong (read from the failure page-state) + the planned edit. That enforces C
// (localize before the first edit) AND D (a still-RED edit forces a fresh re-localize = a structured
// reflection) in one mechanic. It is loop machinery, not skill text, so it applies to BOTH arms.
const LOCALIZE_SCHEMA: ToolSchema = {
  name: 'localize',
  description:
    'REQUIRED before each replace_in_spec. Localize the cause from the failure evidence: the failing ' +
    'assertion, the EARLIEST upstream step whose result is wrong (use the page-state returned by ' +
    'run_test), the evidence for that, and the edit you will now make.',
  parameters: {
    type: 'object',
    properties: {
      failing_assertion: { type: 'string', description: 'the assertion that errored' },
      upstream_step: { type: 'string', description: 'the earliest step whose result is wrong (often NOT the failing line)' },
      evidence: { type: 'string', description: 'what in the failure page-state shows that step put the app in the wrong state' },
      planned_edit: { type: 'string', description: 'the change you will make to fix that upstream step' },
    },
    required: ['failing_assertion', 'upstream_step', 'evidence', 'planned_edit'],
  },
}
let localizeEnabled = false
// The optimizer's localize-AWARENESS (it can write evidence-exploiting skill text). Default ON when
// localize is enabled; `--blind-optimizer` forces it OFF = the factorial control (budget held, only
// the awareness signal removed) that attributes the closed gap to awareness vs extra search.
let optimizerLocalizeAware = true
// When set, rollouts capture a per-step trace (localize/edit/run_test) for diagnosis (--dump).
let captureSteps = false
let ROLLOUT_STEPS = 6
function toolSchemas(): ToolSchema[] {
  return localizeEnabled ? [...TOOL_SCHEMAS, LOCALIZE_SCHEMA] : TOOL_SCHEMAS
}

interface Rollout {
  readonly brkId: string
  readonly passed: boolean
  readonly reason: string
  readonly finalSpec: string
  readonly steps?: StepRecord[] // populated only when captureSteps (--dump) — for diagnosis
}

async function rollout(
  bridge: LlmBridge,
  brk: Break,
  skill: string,
  makeTools: (b: Break) => HealTools,
  maxSteps = ROLLOUT_STEPS,
): Promise<Rollout> {
  const tools = makeTools(brk)
  const first = await tools.run_test()
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: skill },
    { role: 'user', content: `The failing test:\n\n\`\`\`ts\n${tools.getSpec()}\n\`\`\`\n\nInitial run_test: passed=${first.passed}\n${first.output}\n\nHeal it.` },
  ]
  // NEUTRAL loop: the only fixed mechanic is "you must make an edit" (generic). All root-cause /
  // reflection GUIDANCE comes from the SKILL (system prompt), never the loop — otherwise the loop
  // would leak the very guidance e1 is trying to learn into the naive arm (it did: naive scored
  // 100% because a hardcoded reflection said "reconsider the upstream step, not the assertion").
  let editsMade = false
  let nudged = false
  let localizedSinceEdit = false
  const steps: StepRecord[] = []
  try {
    for (let step = 0; step < maxSteps; step++) {
      const turn = await bridge.complete(messages, toolSchemas())
      if (turn.toolCalls.length === 0) {
        if (!editsMade && !nudged) {
          nudged = true
          messages.push({
            role: 'user',
            content: localizeEnabled
              ? 'You ended without an edit. Call localize (the earliest upstream wrong step), then replace_in_spec, then run_test.'
              : 'You ended without an edit. Call replace_in_spec to change the test, then run_test to check.',
          })
          continue
        }
        break
      }
      messages.push(turn.raw)
      for (const call of turn.toolCalls) {
        let result: string
        if (call.name === 'run_test') {
          const r = await tools.run_test()
          result = `passed=${r.passed}\n${r.output}`
          if (r.passed) {
            if (captureSteps) steps.push({ name: call.name, args: call.args as Record<string, unknown>, result })
            messages.push({ role: 'tool', tool_call_id: call.id, content: result })
            break
          }
        } else if (call.name === 'get_accessibility') {
          result = await tools.get_accessibility(String(call.args.path ?? '/'), parseClicks(call.args.clicks))
        } else if (call.name === 'localize') {
          const up = String(call.args.upstream_step ?? '').trim()
          const ev = String(call.args.evidence ?? '').trim()
          const pe = String(call.args.planned_edit ?? '').trim()
          if (!up || !ev || !pe) {
            result = 'localize incomplete: give upstream_step, evidence (from the failure page-state), and planned_edit.'
          } else {
            localizedSinceEdit = true
            result = 'localized — now make exactly the planned edit with replace_in_spec.'
          }
        } else if (call.name === 'replace_in_spec') {
          if (localizeEnabled && !localizedSinceEdit) {
            result = 'Call localize FIRST (name the earliest upstream wrong step from the failure page-state), then edit.'
          } else {
            const r = await tools.replace_in_spec(String(call.args.old ?? ''), String(call.args.replacement ?? ''))
            result = r.ok ? 'ok' : `error: ${r.error}`
            if (r.ok) {
              editsMade = true
              localizedSinceEdit = false // a still-RED edit forces a fresh localize before the next (D)
            }
          }
        } else {
          result = `unknown tool: ${call.name}`
        }
        if (captureSteps) steps.push({ name: call.name, args: call.args as Record<string, unknown>, result })
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }
  } catch {
    /* a dead provider / loop error scores as a fail, like the gate would see it */
  }
  const s = await score(brk, tools)
  return { brkId: brk.id, passed: s.passed, reason: s.reason, finalSpec: tools.getSpec(), steps: captureSteps ? steps : undefined }
}

/** Mean gate pass-rate of a skill over `breaks`, n rollouts each. Returns score + the rollouts. */
async function evaluate(
  bridge: LlmBridge,
  skill: string,
  breaks: Break[],
  n: number,
  makeTools: (b: Break) => HealTools,
): Promise<{ score: number; rollouts: Rollout[]; perFixture: number[] }> {
  const rollouts: Rollout[] = []
  const perFixture: number[] = [] // aligned to `breaks` order — the Pareto score vector
  for (const brk of breaks) {
    let passes = 0
    for (let i = 0; i < n; i++) {
      const r = await rollout(bridge, brk, skill, makeTools)
      rollouts.push(r)
      if (r.passed) passes++
    }
    perFixture.push(passes / n)
  }
  const score = rollouts.filter((r) => r.passed).length / rollouts.length
  return { score, rollouts, perFixture }
}

// ── reflect: the optimizer LLM proposes a bounded skill edit (text-space "gradient") ─────────
const OPTIMIZER_SYSTEM = `You optimize a natural-language SKILL document for a Playwright test-HEALER agent that uses tools (run_test, get_accessibility, replace_in_spec). A DETERMINISTIC gate scores each heal: it must re-run GREEN, make a real (non-empty) edit, keep load-bearing assertions, and use no forbidden moves (skip/weaken/timeout). You see the current skill and scored rollouts (which tasks the agent passed/failed and why). Propose a REVISED skill that fixes the observed failures.

Constraints:
- Make MINIMAL, targeted edits (a small "learning rate"): change/add only what the failures justify; keep what already works.
- Stay GENERIC and project-agnostic: NO app-specific control names, NO answers copied from a task — teach the agent HOW to reason, not the answer.
- Keep the hard anti-cheat rules intact (never skip/weaken/delete assertions or widen timeouts).
- Output ONLY the full revised skill markdown — no preamble, no code fences, no commentary.`

async function propose(
  optimizer: LlmBridge,
  skill: string,
  rollouts: Rollout[],
  rejected: string[],
  trainScore: number,
): Promise<string> {
  const fails = rollouts.filter((r) => !r.passed)
  const failSummary = fails
    .map((r) => `- [${r.brkId}] FAIL (${r.reason}); final spec excerpt: ${JSON.stringify(r.finalSpec.replace(/\s+/g, ' ').slice(0, 220))}`)
    .join('\n')
  const passSummary = rollouts.filter((r) => r.passed).map((r) => r.brkId).join(', ') || '(none)'
  const rej = rejected.length ? `\n\nPreviously-REJECTED edit ideas (they did NOT improve the held-out score — try something different):\n${rejected.slice(-3).map((x, i) => `${i + 1}. ${x}`).join('\n')}` : ''
  // The optimizer's localize-awareness note (tested artifact). Empty under --blind-optimizer = the
  // factorial control: same budget, only the awareness signal removed.
  const localizeNote = buildOptimizerLocalizeNote(localizeEnabled, optimizerLocalizeAware)
  const user = `Current skill:\n"""\n${skill}\n"""\n\nRollouts (train score ${(trainScore * 100).toFixed(0)}%): passed = ${passSummary}.\nFailures:\n${failSummary || '(none)'}${rej}${localizeNote}\n\nReturn the full revised skill markdown.`
  const turn = await optimizer.complete(
    [{ role: 'system', content: OPTIMIZER_SYSTEM }, { role: 'user', content: user }],
    [],
  )
  let out = (turn.content || '').trim()
  // strip an accidental code fence
  const fence = out.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/)
  if (fence) out = fence[1].trim()
  return out
}

// The NAIVE start skill — the old scaffold that biased weak models toward symptom-fixing (0/5).
const NAIVE_SKILL = `You are a Playwright test HEALER. A test is failing because a locator in the test no longer matches the app (a wrong name, wrong role, wrong/changed text, or a too-strict exact/case match). Fix it.

Rules:
- Fix ONLY the test's locator to match the REAL control in the app's accessibility tree.
- NEVER add test.skip/test.fixme/test.only, NEVER delete a test, NEVER remove or weaken an assertion, NEVER widen/add a timeout.
- Use get_accessibility to read the real role + name, then replace_in_spec to correct the locator, then run_test to confirm GREEN.
- When run_test reports passed=true, stop.

Work in small steps: run_test -> get_accessibility -> replace_in_spec -> run_test.`

// ── main optimizer loop ──────────────────────────────────────────────────────────────────────
function flag(name: string, def: string): string {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : def
}

async function main() {
  if (!API_KEY) {
    console.error('skill-optimize: OPENROUTER_API_KEY not set (cannot-run = RED). Source the private env.')
    process.exit(1)
  }
  const executorSpec = parseModels(flag('executor', 'xiaomi/mimo-v2.5|xiaomi/fp8'))[0] as ModelSpec
  const optimizerSpec = parseModels(flag('optimizer', 'deepseek/deepseek-v4-flash|alibaba'))[0] as ModelSpec
  const epochs = parseInt(flag('epochs', '3'), 10)
  const n = parseInt(flag('n', '2'), 10)
  const outFile = flag('out', 'skills/heal.skill.learned.md')
  const gate = flag('gate', 'mock') // 'mock' = fast proxy; 'real' = the faithful playwright gate

  // Reasoning-on + headroom for the (weak) executor; the optimizer just needs to write well.
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

  // Default: train on the discriminator + 2 single-locator classes; hold out the other two so a
  // "fix the earliest wrong step" edit is rewarded only if it generalizes (no class-leakage).
  // --focus=<id> measures ONE break (e.g. flow-wrong-step) with the full n — the easy classes
  // saturate, so a focused run is what discriminates skills on the real gate (note: a single
  // fixture means train==held here, so an epoch overfits; the naive-vs-hand COMPARISON is the read).
  const focus = flag('focus', '')
  const pick = (csv: string): Break[] => {
    const ids = csv.split(',').map((s) => s.trim()).filter(Boolean)
    return BREAKS.filter((b) => ids.includes(b.id))
  }
  const trainIds = flag('train', '')
  const heldIds = flag('held', '')
  const train = trainIds ? pick(trainIds) : focus ? pick(focus) : pick('flow-feed-tab,name-rename,wrong-role')
  const held = heldIds ? pick(heldIds) : focus ? pick(focus) : pick('changed-text,exact-case,flow-feed-tab')

  console.log(`skill-optimize (e1) — gate=${gate} executor=${executorSpec.model} optimizer=${optimizerSpec.model} epochs=${epochs} n=${n}`)
  console.log(`train: ${train.map((b) => b.id).join(', ')} | held-out: ${held.map((b) => b.id).join(', ')}\n`)

  // Rollout surface. MOCK = fast but easy (a reasoning executor often solves the clean mock
  // regardless of skill). REAL = the faithful playwright gate where the difficulty actually lives.
  let sharedBrowser: Browser | null = null
  let makeTools: (b: Break) => HealTools
  if (gate === 'real') {
    console.log('ensuring auth (realworld setup project)…')
    ensureSetup(HEAL_TARGET)
    sharedBrowser = await chromium.launch()
    makeTools = (b) => makeRealTools(HEAL_TARGET, b.broken, sharedBrowser!)
    // RED-precheck: every fixture MUST fail before measuring (well-posed). A green one is
    // ill-posed and would silently corrupt the score.
    for (const b of [...new Set([...train, ...held])]) {
      const red = runSpecOnce(HEAL_TARGET, b.broken)
      console.log(`[red-check] ${b.id}: ${red.passed ? '!!! NOT RED (ill-posed)' : 'RED ok'}`)
    }
  } else {
    makeTools = (b) => makeMockTools(b)
  }

  // --eval-only: no learning — just measure naive vs hand-authored PER FIXTURE on the held set.
  // The focused A/B for a loop change (e.g. the trace lever): does hand-authored now root-cause a
  // flavor it failed before? Per-fixture (not aggregate) so the gap is visible flavor by flavor.
  if (process.argv.includes('--eval-only')) {
    const ab = process.argv.includes('--ab-localize')
    ROLLOUT_STEPS = 8 // localize+edit cycles need a couple more turns; held constant across BOTH arms
    // --dump=<file>: also write every rollout's step trace (localize/edit/run_test) for diagnosis.
    const dumpFile = flag('dump', '')
    if (dumpFile) {
      captureSteps = true
      fs.writeFileSync(dumpFile, `# rollout traces — n=${n} held=${held.map((b) => b.id).join(',')}\n`)
    }
    const modes = ab ? [false, true] : [process.argv.includes('--localize')]
    const skills: ReadonlyArray<readonly [string, string]> = [
      ['naive', NAIVE_SKILL],
      ['hand R1–R4', loadHealSkill()],
    ]
    const passes: Record<string, number> = {} // `${loc}|${label}|${id}` -> #passes (for the CIs)
    console.log('\n=== eval-only — per-fixture gate pass-rate (Wilson 95% CI) ===')
    for (const loc of modes) {
      localizeEnabled = loc
      console.log(`--- localize ${loc ? 'ON (lever C/D)' : 'off'} ---`)
      for (const [label, sk] of skills) {
        for (const b of held) {
          const ev = await evaluate(executor, sk, [b], n, makeTools)
          const k = Math.round(ev.score * n)
          passes[`${loc}|${label}|${b.id}`] = k
          console.log(`  loc=${loc ? 'on ' : 'off'} ${label.padEnd(12)} ${b.id.padEnd(20)} : ${fmtPct(k, n)}`)
          if (dumpFile) {
            fs.appendFileSync(dumpFile, `\n===== loc=${loc ? 'on' : 'off'} | ${label} | ${b.id} =====\n`)
            for (const r of ev.rollouts) {
              const tri = triageRollout({ passed: r.passed, reason: r.reason, steps: r.steps ?? [] })
              fs.appendFileSync(dumpFile, formatRolloutTrace({ brkId: r.brkId, passed: r.passed, reason: r.reason, steps: r.steps ?? [] }) + `\n\ntriage: ${tri.category} → ${tri.lever}\n  ${tri.detail}\n`)
            }
          }
        }
      }
    }
    if (ab) {
      console.log('\n--- C/D effect (localize on − off), Newcombe 95% CI per skill×fixture ---')
      for (const [label] of skills) {
        for (const b of held) {
          const off = passes[`false|${label}|${b.id}`] ?? 0
          const on = passes[`true|${label}|${b.id}`] ?? 0
          const d = newcombeDiff(off, n, on, n)
          const verdict = d.lo > 0 ? 'on>off' : d.hi < 0 ? 'off>on' : 'n.s.'
          const r = (x: number) => Math.round(x * 100)
          console.log(`  ${label.padEnd(12)} ${b.id.padEnd(20)} : Δ=${r(d.p)}pp [${r(d.lo)}–${r(d.hi)}] (${verdict})`)
        }
      }
    }
    if (gate === 'real') {
      cleanupTemp(HEAL_TARGET)
      await sharedBrowser?.close()
    }
    return
  }

  // Levers C/D for the learning path too: a learned skill should be optimized to EXPLOIT the
  // grounded-localize harness (the A/B showed naive does NOT benefit from C/D — a root-cause-framed
  // skill must). --localize turns it on for every rollout here.
  if (process.argv.includes('--localize')) {
    localizeEnabled = true
    ROLLOUT_STEPS = 8
  }
  // Factorial control: keep rollout-localize ON but blind the OPTIMIZER (no awareness note). Pairs
  // with --localize at the same n/epochs to attribute the closed gap to awareness vs extra search.
  if (process.argv.includes('--blind-optimizer')) {
    optimizerLocalizeAware = false
    console.log('optimizer: BLIND (factorial control — rollout-localize on, no awareness note)')
  } else if (localizeEnabled) {
    console.log('optimizer: localize-AWARE (writes evidence-exploiting skill text)')
  }

  // GEPA-style learning: a Pareto FRONTIER over per-FIXTURE held-out scores (anti flavor-collapse —
  // single-winner acceptance overfits one flavor, which is exactly what we measured). Seed = naive;
  // each epoch mutate a frontier member and insert the candidate by Pareto domination; deploy the
  // best-aggregate frontier member.
  const fmtVec = (v: number[]) => v.map((x) => `${(x * 100).toFixed(0)}%`).join(',')
  const naiveEval = await evaluate(executor, NAIVE_SKILL, held, n, makeTools)
  let frontier: FrontierMember<string>[] = [{ scores: naiveEval.perFixture, item: NAIVE_SKILL }]
  console.log(`[init] NAIVE held-out per-fixture = [${fmtVec(naiveEval.perFixture)}] (${held.map((b) => b.id).join(',')})`)
  const rejected: string[] = []

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const seed = frontier[(epoch - 1) % frontier.length] // rotate frontier members as mutation seeds
    const train_eval = await evaluate(executor, seed.item, train, n, makeTools)
    const candidate = await propose(optimizer, seed.item, train_eval.rollouts, rejected, train_eval.score)
    if (!candidate || candidate.length < 100) {
      console.log(`[epoch ${epoch}] optimizer returned an empty/short skill — skipping`)
      continue
    }
    const cand_eval = await evaluate(executor, candidate, held, n, makeTools)
    const before = frontier.length
    frontier = paretoInsert(frontier, { scores: cand_eval.perFixture, item: candidate })
    const accepted = frontier.some((m) => m.item === candidate)
    console.log(
      `[epoch ${epoch}] train=${(train_eval.score * 100).toFixed(0)}% -> candidate held-out=[${fmtVec(cand_eval.perFixture)}] => ` +
        `${accepted ? `ACCEPT (frontier ${before}->${frontier.length})` : 'reject (Pareto-dominated)'}`,
    )
    if (!accepted) rejected.push(`an edit scoring [${fmtVec(cand_eval.perFixture)}] (Pareto-dominated)`)
  }

  const deployed = bestAggregate(frontier) as FrontierMember<string>
  const best = { skill: deployed.item, score: deployed.scores.reduce((s, x) => s + x, 0) / (deployed.scores.length || 1) }
  fs.writeFileSync(outFile, best.skill + '\n')
  console.log(`\nfrontier size ${frontier.length}; deployed best-aggregate held-out ${(best.score * 100).toFixed(0)}% -> ${outFile}`)

  // Final comparison (e1): NAIVE vs LEARNED vs HAND-AUTHORED (R1–R4), same held-out set + n.
  console.log('\n=== e1 comparison — held-out gate pass-rate ===')
  const naive = (await evaluate(executor, NAIVE_SKILL, held, n, makeTools)).score
  const learned = (await evaluate(executor, best.skill, held, n, makeTools)).score
  const hand = (await evaluate(executor, loadHealSkill(), held, n, makeTools)).score
  console.log(`naive (old scaffold) : ${(naive * 100).toFixed(0)}%`)
  console.log(`LEARNED (this run)   : ${(learned * 100).toFixed(0)}%`)
  console.log(`hand-authored R1–R4  : ${(hand * 100).toFixed(0)}%`)

  if (gate === 'real') {
    cleanupTemp(HEAL_TARGET)
    await sharedBrowser?.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
