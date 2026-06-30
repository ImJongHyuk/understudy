/**
 * Intent-freshness CONFORMANCE / mutation proofs — the stale-oracle guard as a deterministic gate.
 * Mutation-proves the full set of reasons: fresh (allowed), missing-provenance (no record / empty
 * oracle), missing-marker (no/!parseable lastValidated), stale (older than the budget), orphan (a
 * record for a non-required CUF), the age boundary, and that an invalid `now` is a loud error (never a
 * silent pass). Pure-unit (no clock, no I/O), so the freshness discipline is VERIFIED, not asserted.
 */
import { test, expect } from '@playwright/test'
import { checkIntentFreshness, type IntentRecord } from '../intent-freshness'

const NOW = '2026-06-30'
const OPTS = { now: NOW, maxAgeDays: 90 }
const fresh = (id: string): IntentRecord => ({ id, oracle: 'SSOT#cuf', lastValidated: '2026-06-01' })

test.describe('conformance: intent-freshness gate (mutation-proven)', () => {
  test('FRESH: a provenanced, recently-validated record passes (promotion allowed)', () => {
    expect(checkIntentFreshness([fresh('a.spec.ts')], OPTS)).toEqual([])
  })

  test('missing-provenance: a record with an empty oracle is flagged', () => {
    const r: IntentRecord = { id: 'a.spec.ts', oracle: '   ', lastValidated: '2026-06-01' }
    expect(checkIntentFreshness([r], OPTS)).toEqual([
      { id: 'a.spec.ts', reason: 'missing-provenance', detail: 'empty oracle (no provenance pointer)' },
    ])
  })

  test('missing-provenance: a REQUIRED CUF with no record at all is flagged', () => {
    const v = checkIntentFreshness([fresh('a.spec.ts')], { ...OPTS, required: ['a.spec.ts', 'b.spec.ts'] })
    expect(v).toEqual([
      { id: 'b.spec.ts', reason: 'missing-provenance', detail: 'no intent record for a required CUF' },
    ])
  })

  test('missing-marker: a missing or unparseable lastValidated is flagged', () => {
    const noMarker: IntentRecord = { id: 'a.spec.ts', oracle: 'SSOT#cuf' }
    expect(checkIntentFreshness([noMarker], OPTS)[0]).toMatchObject({ id: 'a.spec.ts', reason: 'missing-marker' })
    const bad: IntentRecord = { id: 'b.spec.ts', oracle: 'SSOT#cuf', lastValidated: '2026-13-40' } // rollover → rejected
    expect(checkIntentFreshness([bad], OPTS)[0]).toMatchObject({ id: 'b.spec.ts', reason: 'missing-marker' })
  })

  test('stale: a record validated longer ago than the budget is flagged (blocks promotion)', () => {
    const old: IntentRecord = { id: 'a.spec.ts', oracle: 'SSOT#cuf', lastValidated: '2026-01-01' } // 180d before NOW
    const v = checkIntentFreshness([old], OPTS)
    expect(v[0]).toMatchObject({ id: 'a.spec.ts', reason: 'stale' })
    expect(v[0].detail).toContain('180d')
  })

  test('age boundary: EXACTLY maxAgeDays old is still fresh; one day more is stale', () => {
    // 90 days before 2026-06-30 = 2026-04-01.
    const at = { id: 'a.spec.ts', oracle: 'o', lastValidated: '2026-04-01' }
    const over = { id: 'b.spec.ts', oracle: 'o', lastValidated: '2026-03-31' }
    expect(checkIntentFreshness([at], OPTS)).toEqual([])
    expect(checkIntentFreshness([over], OPTS)[0]).toMatchObject({ reason: 'stale' })
  })

  test('orphan: a record for a CUF not in the required set is flagged (drift — record without a CUF)', () => {
    const v = checkIntentFreshness([fresh('a.spec.ts'), fresh('ghost.spec.ts')], { ...OPTS, required: ['a.spec.ts'] })
    expect(v).toEqual([{ id: 'ghost.spec.ts', reason: 'orphan', detail: 'record for a CUF not in the required set' }])
  })

  test('a future validation date is NOT stale (age is negative)', () => {
    const future: IntentRecord = { id: 'a.spec.ts', oracle: 'o', lastValidated: '2026-12-31' }
    expect(checkIntentFreshness([future], OPTS)).toEqual([])
  })

  test('an invalid `now` is a LOUD error, never a silent pass', () => {
    expect(() => checkIntentFreshness([fresh('a.spec.ts')], { now: 'today', maxAgeDays: 90 })).toThrow(/invalid 'now'/)
  })

  test('multiple violations are returned sorted by id', () => {
    const recs: IntentRecord[] = [
      { id: 'z.spec.ts', oracle: '', lastValidated: '2026-06-01' }, // missing-provenance
      { id: 'a.spec.ts', oracle: 'o', lastValidated: '2025-01-01' }, // stale
    ]
    const v = checkIntentFreshness(recs, OPTS)
    expect(v.map((x) => x.id)).toEqual(['a.spec.ts', 'z.spec.ts'])
  })
})
