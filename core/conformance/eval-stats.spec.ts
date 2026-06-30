/**
 * heal/eval-stats conformance — honest small-sample stats. The load-bearing fact: a "0%" or "50%"
 * cell at n=4 carries a huge CI, so comparisons must report intervals, not bare rates.
 */
import { test, expect } from '@playwright/test'
import { wilson, newcombeDiff, mcnemarMidP, fmtPct } from '../../heal/eval-stats'

test.describe('conformance: eval-stats (honest small-sample comparison)', () => {
  test('wilson(2,4) is centered at 0.5 with a wide CI (~0.15–0.85)', () => {
    const w = wilson(2, 4)
    expect(w.p).toBeCloseTo(0.5, 5)
    expect(w.lo).toBeCloseTo(0.15, 1)
    expect(w.hi).toBeCloseTo(0.85, 1)
  })

  test('"0%" at n=4 is NOT truly zero — Wilson upper ~0.49', () => {
    const w = wilson(0, 4)
    expect(w.p).toBe(0)
    expect(w.lo).toBe(0)
    expect(w.hi).toBeCloseTo(0.49, 1) // a 0/4 cell is compatible with a true ~49% rate
  })

  test('wilson clamps to [0,1] and handles n=0', () => {
    expect(wilson(4, 4).hi).toBeLessThanOrEqual(1)
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 })
  })

  test('newcombeDiff: 0/4 vs 2/4 — difference CI straddles 0 (not distinguishable at n=4)', () => {
    const d = newcombeDiff(0, 4, 2, 4) // A=naive 0%, B=hand 50%
    expect(d.p).toBeCloseTo(0.5, 5)
    expect(d.lo).toBeLessThan(0) // can't yet claim B>A at n=4 — exactly the honesty we need
    expect(d.hi).toBeGreaterThan(0)
  })

  test('newcombeDiff: 0/12 vs 8/12 — clearly distinguishable (lo>0)', () => {
    const d = newcombeDiff(0, 12, 8, 12)
    expect(d.lo).toBeGreaterThan(0) // larger n separates them
  })

  test('mcnemarMidP: no discordant pairs => p=1; 4-vs-0 => ~0.0625', () => {
    expect(mcnemarMidP(0, 0)).toBe(1)
    expect(mcnemarMidP(4, 0)).toBeCloseTo(0.0625, 3)
    expect(mcnemarMidP(2, 2)).toBeGreaterThan(0.5) // symmetric discordance = no signal
  })

  test('fmtPct renders a rate with its CI', () => {
    expect(fmtPct(2, 4)).toMatch(/50% \[\d+–\d+%\]/)
  })
})
