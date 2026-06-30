/**
 * heal/optimizer-prompt conformance — the optimizer localize-awareness note + its factorial control.
 * The note must appear ONLY when the grounded-localize harness is active AND awareness is on; the
 * `aware=false` path is the budget-held control that isolates the awareness signal from extra
 * search. A regression here would silently re-confound the factorial (a "blind" arm that isn't).
 */
import { test, expect } from '@playwright/test'
import { buildOptimizerLocalizeNote } from '../../heal/optimizer-prompt'

test('localize off → no note (no leakage when C/D is not active)', () => {
  expect(buildOptimizerLocalizeNote(false, true)).toBe('')
  expect(buildOptimizerLocalizeNote(false, false)).toBe('')
})

test('blind optimizer (aware=false) → no note even with localize ON — the factorial control', () => {
  expect(buildOptimizerLocalizeNote(true, false)).toBe('')
})

test('aware optimizer (localize ON, aware) → the backward-trace note', () => {
  const note = buildOptimizerLocalizeNote(true, true)
  expect(note.length).toBeGreaterThan(100)
  // teaches the GENERAL routine (backward trace from the failure evidence) …
  expect(note).toContain('trace BACKWARD')
  expect(note).toContain('localize')
  expect(note).toContain('never relax the assertion')
  // … and stays project-agnostic: no app-specific control names / answers.
  expect(note.toLowerCase()).not.toContain('your feed')
  expect(note.toLowerCase()).not.toContain('settings')
  expect(note).not.toContain('goto')
})
