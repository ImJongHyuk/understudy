/**
 * heal/diagnostics conformance — the rollout step-trace formatter. The diagnosis of a capped flavor
 * depends on the localize (upstream/plan) and the edit (old→new) being legible and on long evidence
 * blobs being clipped (so a 4k aria snapshot doesn't drown the trace). Lock both.
 */
import { test, expect } from '@playwright/test'
import { formatRolloutTrace, type RolloutTrace } from '../../heal/diagnostics'

const TRACE: RolloutTrace = {
  brkId: 'flow-nav-settings',
  passed: false,
  reason: 'still RED',
  steps: [
    { name: 'run_test', result: 'passed=false\nFAILED. ' + 'x'.repeat(500) },
    {
      name: 'localize',
      args: { upstream_step: "page.goto('/#/settings')", evidence: 'y'.repeat(400), planned_edit: "navigate to the article page" },
      result: 'localized — now make exactly the planned edit with replace_in_spec.',
    },
    { name: 'replace_in_spec', args: { old: "goto('/#/settings')", replacement: "goto('/#/article/' + article.slug)" }, result: 'ok' },
    { name: 'run_test', result: 'passed=false\nstill red' },
  ],
}

test('header shows fixture + PASS/FAIL + reason', () => {
  const out = formatRolloutTrace(TRACE)
  expect(out).toContain('### flow-nav-settings — FAIL (still RED)')
})

test('localize line exposes the upstream step + the planned edit (the diagnosis)', () => {
  const out = formatRolloutTrace(TRACE)
  expect(out).toContain("upstream=\"page.goto('/#/settings')\"")
  expect(out).toContain('planned="navigate to the article page"')
})

test('edit line spells out old -> new (so a wrong fix is visible)', () => {
  const out = formatRolloutTrace(TRACE)
  expect(out).toContain("old=\"goto('/#/settings')\" -> new=\"goto('/#/article/' + article.slug)\"")
})

test('long evidence/output is clipped (the 4k snapshot must not drown the trace)', () => {
  const out = formatRolloutTrace(TRACE)
  expect(out).toContain('…')
  expect(out).not.toContain('y'.repeat(200)) // evidence blob clipped
  expect(out.split('\n').every((l) => l.length < 320)).toBe(true)
})

test('PASS header on a passing rollout', () => {
  const out = formatRolloutTrace({ brkId: 'flow-feed-tab', passed: true, reason: 'healed', steps: [] })
  expect(out).toContain('### flow-feed-tab — PASS (healed)')
})
