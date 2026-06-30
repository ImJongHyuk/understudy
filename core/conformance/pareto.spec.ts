/**
 * heal/pareto conformance — the GEPA anti-collapse core. A skill that wins on a DIFFERENT flavor
 * than the incumbent must survive (the frontier keeps both); a strictly-worse skill must not.
 */
import { test, expect } from '@playwright/test'
import { dominates, paretoInsert, bestAggregate, type FrontierMember } from '../../heal/pareto'

const m = (scores: number[], item: string): FrontierMember<string> => ({ scores, item })

test.describe('conformance: pareto frontier (GEPA anti-flavor-collapse)', () => {
  test('dominates: ≥ everywhere and > somewhere', () => {
    expect(dominates([1, 1], [0, 0])).toBe(true)
    expect(dominates([1, 0.5], [0.5, 0.5])).toBe(true)
    expect(dominates([1, 0], [0, 1])).toBe(false) // incomparable (each wins one flavor)
    expect(dominates([1, 1], [1, 1])).toBe(false) // equal is not strict domination
    expect(dominates([0, 0], [1, 1])).toBe(false)
  })

  test('a strictly-worse candidate is rejected (frontier unchanged)', () => {
    const f = [m([1, 1], 'A')]
    expect(paretoInsert(f, m([0, 0], 'B')).map((x) => x.item)).toEqual(['A'])
    expect(paretoInsert(f, m([1, 1], 'dup')).map((x) => x.item)).toEqual(['A']) // equal = no new info
  })

  test('an incomparable candidate (wins a different flavor) is KEPT — the whole point', () => {
    const f = [m([1, 0], 'feed-tab-skill')]
    const next = paretoInsert(f, m([0, 1], 'nav-skill'))
    expect(next.map((x) => x.item).sort()).toEqual(['feed-tab-skill', 'nav-skill'])
  })

  test('a dominating candidate evicts the members it beats', () => {
    const f = [m([1, 0], 'A'), m([0, 1], 'B')]
    const next = paretoInsert(f, m([1, 1], 'C')) // dominates both
    expect(next.map((x) => x.item)).toEqual(['C'])
  })

  test('bestAggregate picks the highest mean from the frontier', () => {
    const f = [m([1, 0], 'A'), m([0.6, 0.6], 'B'), m([0, 1], 'C')]
    expect(bestAggregate(f)?.item).toBe('B') // mean 0.6 > 0.5
    expect(bestAggregate([])).toBeNull()
  })
})
