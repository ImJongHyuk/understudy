/**
 * heal/auto-heal — the BOUNDED auto-lever-application loop on top of the heal loop + triage. Today
 * triage only NAMES the next lever and a human applies it; this ACTS on the safely-auto-applicable
 * ones (the evidence-budget / transient-retry levers planEscalation green-lights) as a bounded retry
 * within ONE heal session. INV-1 is preserved end-to-end: the deterministic gate is injected by the
 * caller (`score`) and is the SOLE oracle — the LLM only proposes, the escalation only changes the
 * render-settle budget or does a transient retry, never the verdict. Orchestration only; adapter-free
 * (the bumped target is a plain spread, no adapter import). Bounded + never-hang: each attempt's loop
 * is already bounded, escalations are capped, and a non-retryable triage terminates immediately.
 */
import type { Browser } from '@playwright/test'
import type { LlmBridge } from '../llm'
import type { StepRecord } from './diagnostics'
import type { HealTarget } from './real-tools'
import type { TriageResult } from './triage'
import { makeRealTools } from './real-tools'
import { runHealLoop } from './heal-loop'
import { triageRollout } from './triage'
import { planEscalation } from './escalate'
import { resolveSettle } from './settle'

export interface AutoHealResult {
  readonly healed: string                 // final spec text
  readonly steps: StepRecord[]            // trace of the LAST attempt
  readonly verdict: 'PASS' | 'FAIL'
  readonly reason: string
  readonly triage: TriageResult           // triage of the LAST attempt
  readonly attempts: number               // total attempts run (1 + escalations applied)
  readonly escalations: string[]          // the planEscalation notes that were applied, in order
}

/** Run the heal loop; score it with the caller-injected deterministic gate (INV-1 — the gate lives in
 * the caller, NOT here); triage; if the triage names an auto-applicable lever, apply it (bump the
 * target's settle budget and/or retry) and run again — bounded by maxEscalations. Returns the final
 * scored result + the escalation history. */
export async function runAutoHeal(opts: {
  bridge: LlmBridge
  target: HealTarget
  brokenSpec: string
  browser: Browser
  skill: string
  /** the deterministic gate, injected so this module stays free of adapter/lint specifics (INV-1) */
  score: (healed: string, steps: StepRecord[]) => Promise<{ verdict: 'PASS' | 'FAIL'; reason: string }>
  maxEscalations?: number   // default 2
}): Promise<AutoHealResult> {
  const { bridge, brokenSpec, browser, skill, score } = opts
  const maxEscalations = opts.maxEscalations ?? 2

  let target = opts.target
  const escalations: string[] = []
  let attempt = 1

  // Bounded retry loop. Each iteration rebuilds tools from the FRESH brokenSpec, so an escalation is
  // a clean re-heal (a higher render budget), never a continuation of a half-edited spec.
  for (;;) {
    const tools = makeRealTools(target, brokenSpec, browser)
    const steps = await runHealLoop(bridge, tools, skill)
    const healed = tools.getSpec()

    const { verdict, reason } = await score(healed, steps)
    const triage = triageRollout({ passed: verdict === 'PASS', reason, steps })

    // Done on a PASS, or once we've spent our escalation budget (attempts beyond the first are
    // escalations). Either way, return the LAST attempt's full scored result + the history.
    if (verdict === 'PASS' || attempt > maxEscalations) {
      return { healed, steps, verdict, reason, triage, attempts: attempt, escalations }
    }

    // Decide the next attempt from the LAST attempt's triage against its ACTUAL settle budget.
    const plan = planEscalation(triage, resolveSettle(target.settle), attempt)
    if (!plan.retry) {
      return { healed, steps, verdict, reason, triage, attempts: attempt, escalations }
    }

    // Apply the lever: merge the settle bump over the current (resolved) budget. The spread keeps
    // heal/ adapter-free — no adapter is reconstructed, only the settle field is bumped.
    target = { ...target, settle: { ...resolveSettle(target.settle), ...plan.settle } }
    escalations.push(plan.note)
    attempt++
  }
}
