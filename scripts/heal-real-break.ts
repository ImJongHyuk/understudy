/**
 * Real-break heal DEMO — the honest end-to-end test of the agentic Healer (Plane A), on a REAL app
 * change, not a synthetic fixture.
 *
 * Workflow (the app change is external, e.g. rename a control in the live Conduit frontend so Vite
 * HMR picks it up):
 *   1. confirm the UNCHANGED reference spec is now RED against the changed app (a real break);
 *   2. run the PRODUCT heal loop (heal/heal-loop runHealLoop + the base⊕overlay skill + a real model)
 *      against the LIVE app — the LLM only proposes;
 *   3. score with the DETERMINISTIC gate (INV-1): non-vacuous edit + load-bearing assertions retained
 *      (anti-cheat) + no forbidden moves (post-heal-lint) + a clean re-run GREEN;
 *   4. print the locator diff so the heal is legible.
 *
 * Usage (after `bun run realworld:up` and applying a real app change):
 *   bun scripts/heal-real-break.ts [--spec=path] [--model='m|provider'] [--must=a,b,c] [--thinking]
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { lintHealedChange } from '../core/post-heal-lint'
import { createBridge, parseModels, type ModelSpec } from '../llm'
import { loadHealSkill } from '../skills/load-skill'
import { ensureSetup, cleanupTemp, runSpecOnce, makeRealTools, makeHealTarget, type HealTarget } from '../heal/real-tools'
import { realworldAuthAdapter } from '../adapters/realworld-conduit/auth.adapter'
import { vikunjaAuthAdapter } from '../adapters/vikunja/auth.adapter'

// Adapter-agnostic: the demo runs against any reference consumer. --target picks one.
const TARGETS: Record<string, { target: HealTarget; defaultSpec: string }> = {
  realworld: {
    target: makeHealTarget({
      authAdapter: realworldAuthAdapter,
      playwrightConfig: 'playwright.realworld.config.ts',
      specsDir: 'adapters/realworld-conduit/specs',
    }),
    defaultSpec: 'adapters/realworld-conduit/specs/articles-journey.spec.ts',
  },
  vikunja: {
    target: makeHealTarget({
      authAdapter: vikunjaAuthAdapter,
      playwrightConfig: 'playwright.vikunja.config.ts',
      specsDir: 'adapters/vikunja/specs',
    }),
    defaultSpec: 'adapters/vikunja/specs/tasks-journey.spec.ts',
  },
}
import { runHealLoop } from '../heal/heal-loop'
import { formatRolloutTrace, type StepRecord } from '../heal/diagnostics'
import { triageRollout } from '../heal/triage'
import { runAutoHeal } from '../heal/auto-heal'

const API_KEY = process.env.OPENROUTER_API_KEY ?? ''
function flag(name: string, def: string): string {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : def
}

/** Show the lines that changed between broken and healed (the legible heal). */
function showDiff(broken: string, healed: string): void {
  const a = broken.split('\n')
  const b = healed.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) console.log(`  - ${a[i].trim()}`)
      if (b[i] !== undefined) console.log(`  + ${b[i].trim()}`)
    }
  }
}

async function main() {
  if (!API_KEY) {
    console.error('heal-real-break: OPENROUTER_API_KEY not set (cannot-run = RED). Source the private env.')
    process.exit(1)
  }
  const targetName = flag('target', 'realworld')
  const entry = TARGETS[targetName]
  if (!entry) {
    console.error(`heal-real-break: unknown --target "${targetName}" (have: ${Object.keys(TARGETS).join(', ')})`)
    process.exit(1)
  }
  const target = entry.target
  const specPath = flag('spec', entry.defaultSpec)
  const modelStr = flag('model', (process.env.A3_OPENROUTER_MODELS ?? '').split(',')[0] || 'deepseek/deepseek-v4-flash|alibaba')
  const model = parseModels(modelStr)[0] as ModelSpec
  const mustRetain = flag('must', 'article.name,toBeVisible,toHaveURL').split(',').map((s) => s.trim()).filter(Boolean)
  const thinking = process.argv.includes('--thinking')
  const broken = fs.readFileSync(specPath, 'utf-8')
  // Optional per-adapter overlay (adapters/<x>/heal.overlay.md); base-only if absent.
  const overlayPath = path.join(path.dirname(path.dirname(specPath)), 'heal.overlay.md')
  const skill = fs.existsSync(overlayPath) ? loadHealSkill({ overlayPath }) : loadHealSkill()

  console.log(`real-break heal demo — target=${targetName} spec=${specPath} model=${model.model} thinking=${thinking}`)
  console.log(`ensuring auth (${targetName} setup project)…`)
  ensureSetup(target)
  const browser = await chromium.launch()
  try {
    // 1) The real break: the UNCHANGED reference spec must be RED against the changed app.
    const red = runSpecOnce(target, broken)
    if (red.passed) {
      console.error('[red-check] reference spec is GREEN — no real break present. Apply the app change first.')
      process.exit(2)
    }
    console.log('[red-check] reference spec is RED against the changed app (a real break) ✓')

    // 2) The PRODUCT heal loop (the LLM only proposes; never in the gate). `skill` set above.
    const bridge = createBridge({
      models: [model],
      route: { requireParameters: true, pin: false, thinking },
      openRouter: { timeoutMs: thinking ? 120_000 : 60_000, retries: 3, maxTokens: 16_384 },
      resilient: { breakerThreshold: 2 },
    })

    // 3) The deterministic gate (INV-1): vacuous / anti-cheat / lint / GREEN. Wrapped as an injectable
    //    `score` so both the single-shot path and --auto's bounded retry run the SAME gate — and the
    //    gate stays HERE, in the script, never inside heal/ (the LLM never sees it).
    const score = async (healed: string): Promise<{ verdict: 'PASS' | 'FAIL'; reason: string }> => {
      if (healed === broken) return { verdict: 'FAIL', reason: 'no edit (vacuous)' }
      const dropped = mustRetain.find((m) => !healed.includes(m))
      if (dropped) return { verdict: 'FAIL', reason: `dropped load-bearing \`${dropped}\` (assertion gutted — anti-cheat)` }
      const violations = lintHealedChange([{ path: specPath, before: broken, after: healed }])
      if (violations.length > 0) return { verdict: 'FAIL', reason: `forbidden move: ${violations.map((v) => v.rule).join(',')}` }
      if (!runSpecOnce(target, healed).passed) return { verdict: 'FAIL', reason: 'still RED' }
      return { verdict: 'PASS', reason: 'healed cleanly' }
    }

    const auto = process.argv.includes('--auto')
    let healed: string
    let steps: StepRecord[]
    let verdict: 'PASS' | 'FAIL'
    let reason: string
    if (auto) {
      // Bounded auto-lever loop: heal → gate → triage → apply an auto-applicable lever (bump the
      // render budget / transient retry) → re-heal, up to maxEscalations. The LAST attempt's trace,
      // verdict, and triage are what we report.
      const res = await runAutoHeal({ bridge, target, brokenSpec: broken, browser, skill, score })
      healed = res.healed
      steps = res.steps
      verdict = res.verdict
      reason = res.reason
      console.log(`\n=== auto-heal: ${res.attempts} attempt(s), escalations: [${res.escalations.join(' | ')}] ===`)
    } else {
      const tools = makeRealTools(target, broken, browser)
      steps = await runHealLoop(bridge, tools, skill)
      healed = tools.getSpec()
      const scored = await score(healed)
      verdict = scored.verdict
      reason = scored.reason
    }

    // 4) Legible heal.
    console.log('\n=== heal diff ===')
    if (healed === broken) console.log('  (no change)')
    else showDiff(broken, healed)
    console.log(`\n=== verdict: ${verdict} (${reason}) ===`)
    // Auto-triage: classify the outcome + name the next lever (production diagnosis on the trace).
    const triage = triageRollout({ passed: verdict === 'PASS', reason, steps })
    console.log(`=== triage: ${triage.category} → ${triage.lever} ===\n  ${triage.detail}`)
    // Optional: dump the rollout step trace for diagnosis (--dump=<file>).
    const dumpFile = flag('dump', '')
    if (dumpFile) {
      fs.writeFileSync(
        dumpFile,
        formatRolloutTrace({ brkId: specPath, passed: verdict === 'PASS', reason, steps }) +
          `\n\ntriage: ${triage.category} → ${triage.lever}\n  ${triage.detail}\n`,
      )
      console.log(`(trace dumped to ${dumpFile})`)
    }
    cleanupTemp(target)
    await browser.close()
    process.exit(verdict === 'PASS' ? 0 : 1)
  } catch (e) {
    cleanupTemp(target)
    await browser.close()
    console.error('demo error:', (e as Error).message)
    process.exit(1)
  }
}

main()
