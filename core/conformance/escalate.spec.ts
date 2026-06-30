/**
 * heal/escalate conformance — the PURE auto-escalation policy. The bounded auto-heal loop applies
 * ONLY deterministic evidence-budget / transient-retry levers (INV-1: never anything that could
 * change the gate's verdict). This locks that scope: grounding-empty bumps the render budget within
 * the ceilings and retries (but terminates once maxed, so the loop can't spin on an identical
 * budget); a transient loop-error retries unchanged; every other category does NOT auto-retry (it
 * needs a skill/code/human change, or its cheap in-loop lever is already exhausted). Pure → no
 * browser here.
 */
import { test, expect } from '@playwright/test'
import { planEscalation } from '../../heal/escalate'
import type { TriageResult } from '../../heal/triage'
import { resolveSettle, type SettleConfig } from '../../heal/settle'

/** A triage result for `category` (lever/detail are irrelevant to the policy). */
const triage = (category: TriageResult['category']): TriageResult => ({
  category,
  lever: 'x',
  detail: 'x',
})

const DEFAULTS: SettleConfig = resolveSettle() // capMs 9000, networkidleMs 6000, quietMs 400

test('grounding-empty bumps capMs/networkidleMs and retries (quietMs unchanged)', () => {
  const plan = planEscalation(triage('grounding-empty'), DEFAULTS, 1)
  expect(plan.retry).toBe(true)
  // capMs doubled (9000→18000), networkidleMs ×1.5 (6000→9000), quietMs left alone.
  expect(plan.settle?.capMs).toBe(18_000)
  expect(plan.settle?.networkidleMs).toBe(9_000)
  expect(plan.settle?.quietMs).toBeUndefined()
  expect(plan.note.length).toBeGreaterThan(0)
})

test('grounding-empty respects the settle ceilings (never proposes past the max)', () => {
  // Already high: doubling capMs would exceed 30000 and ×1.5 networkidleMs would exceed 20000 —
  // both clamp to the ceiling, and since the budget still CHANGES we still retry.
  const high: SettleConfig = { quietMs: 400, capMs: 20_000, networkidleMs: 16_000 }
  const plan = planEscalation(triage('grounding-empty'), high, 1)
  expect(plan.retry).toBe(true)
  expect(plan.settle?.capMs).toBe(30_000) // min(40000, 30000)
  expect(plan.settle?.networkidleMs).toBe(20_000) // min(24000, 20000)
})

test('grounding-empty at the ceiling does NOT retry (loop terminates, no identical re-run)', () => {
  // Already maxed on both — a bump would produce an IDENTICAL budget, so terminate instead.
  const maxed: SettleConfig = { quietMs: 400, capMs: 30_000, networkidleMs: 20_000 }
  const plan = planEscalation(triage('grounding-empty'), maxed, 2)
  expect(plan.retry).toBe(false)
  expect(plan.settle).toBeUndefined()
  expect(plan.note).toContain('maxed')
})

test('loop-error retries with the settle budget unchanged', () => {
  const plan = planEscalation(triage('loop-error'), DEFAULTS, 1)
  expect(plan.retry).toBe(true)
  expect(plan.settle).toBeUndefined()
  expect(plan.note.length).toBeGreaterThan(0)
})

test('healed does NOT retry', () => {
  const plan = planEscalation(triage('healed'), DEFAULTS, 1)
  expect(plan.retry).toBe(false)
  expect(plan.settle).toBeUndefined()
  expect(plan.note.length).toBeGreaterThan(0)
})

// Every category that needs a skill/code/human change, or whose cheap in-loop lever is already
// exhausted, must NOT auto-retry — a blind resample just burns budget (best-of-N is deferred).
for (const category of [
  'forbidden-move',
  'dropped-assertion',
  'apply-failure',
  'still-red-wrong-fix',
  'vacuous-no-edit',
  'unknown',
] as const) {
  test(`${category} does NOT auto-retry (with a note saying why)`, () => {
    const plan = planEscalation(triage(category), DEFAULTS, 1)
    expect(plan.retry).toBe(false)
    expect(plan.settle).toBeUndefined()
    expect(plan.note.length).toBeGreaterThan(0)
  })
}
