/**
 * heal/triage conformance — the rollout failure-triage classifier. The campaign loop buckets
 * failures automatically (couldn't see the controls? gutted the assertion? edited the wrong
 * upstream step?) so the next lever is chosen, not guessed. The heuristics are checked
 * most-specific first; this locks ONE representative rollout per category to that bucket, and
 * checks every bucket suggests a (non-empty) next lever.
 */
import { test, expect } from '@playwright/test'
import { triageRollout } from '../../heal/triage'
import type { StepRecord } from '../../heal/diagnostics'

/** A failing run_test step (every rollout starts RED). */
const RED: StepRecord = { name: 'run_test', result: 'passed=false\nFAILED. button not found' }

test("passing rollout → 'healed'", () => {
  const out = triageRollout({
    passed: true,
    reason: 'healed cleanly',
    steps: [{ name: 'run_test', result: 'passed=true\n1 passed' }],
  })
  expect(out.category).toBe('healed')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("loop error → 'loop-error'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'loop error: provider 503 after 3 retries',
    steps: [RED],
  })
  expect(out.category).toBe('loop-error')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("forbidden move → 'forbidden-move'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'forbidden move: edited a non-spec file (rules: spec-only)',
    steps: [RED, { name: 'replace_in_spec', result: 'ok' }],
  })
  expect(out.category).toBe('forbidden-move')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("dropped load-bearing assertion → 'dropped-assertion'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'dropped load-bearing `expect(page).toHaveURL` (assertion gutted — anti-cheat)',
    steps: [RED, { name: 'replace_in_spec', result: 'ok' }],
  })
  expect(out.category).toBe('dropped-assertion')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("replace_in_spec error: → 'apply-failure'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'test still RED',
    steps: [
      RED,
      { name: 'replace_in_spec', args: { old: 'goto("/old")' }, result: 'error: old-string not found in spec' },
    ],
  })
  expect(out.category).toBe('apply-failure')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("every accessibility snapshot unrendered (loading…) → 'grounding-empty'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'no edit (vacuous)',
    steps: [
      RED,
      { name: 'get_accessibility', result: '- paragraph: loading…' },
      { name: 'get_accessibility', result: '- region: loading…' },
    ],
  })
  expect(out.category).toBe('grounding-empty')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("edit applied ok but still RED → 'still-red-wrong-fix'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'test still RED',
    steps: [
      RED,
      { name: 'get_accessibility', result: '- navigation:\n  - link "Home"\n  - link "Settings"\n  - link "Profile" with a fully rendered tree here' },
      { name: 'replace_in_spec', args: { old: 'a', replacement: 'b' }, result: 'ok' },
    ],
  })
  expect(out.category).toBe('still-red-wrong-fix')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("no edit made → 'vacuous-no-edit'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'no edit (vacuous)',
    steps: [
      RED,
      { name: 'get_accessibility', result: '- navigation:\n  - link "Home"\n  - link "Settings"\n  - link "Profile" with a fully rendered tree here' },
    ],
  })
  expect(out.category).toBe('vacuous-no-edit')
  expect(out.lever.length).toBeGreaterThan(0)
})

test("nothing matched → 'unknown'", () => {
  const out = triageRollout({
    passed: false,
    reason: 'mysterious gate verdict',
    steps: [RED],
  })
  expect(out.category).toBe('unknown')
  expect(out.lever.length).toBeGreaterThan(0)
})
