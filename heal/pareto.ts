/**
 * heal/pareto — Pareto-frontier acceptance over per-FIXTURE scores (GEPA's anti-collapse mechanism).
 * Single-winner acceptance (best aggregate) lets the optimizer collapse onto ONE flavor-dominant
 * skill — exactly the flavor-overfit we measured. Keeping the frontier of skills that each win on
 * SOME fixture preserves diversity, so the search can build on complementary strengths instead of
 * overfitting one flavor (dspy.GEPA). Pure functions — verifiable without a run.
 */

export interface FrontierMember<T> {
  /** per-fixture pass-rates in a FIXED fixture order (same order for every member). */
  readonly scores: readonly number[]
  readonly item: T
}

/** `a` dominates `b` iff a ≥ b on every fixture and strictly > on at least one. */
export function dominates(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) throw new Error('dominates: score vectors differ in length')
  let strictly = false
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false
    if (a[i] > b[i]) strictly = true
  }
  return strictly
}

function equal(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** Insert a candidate: reject if any member dominates or equals it; else drop the members it
 * dominates and add it. Returns the new frontier (input not mutated). */
export function paretoInsert<T>(frontier: ReadonlyArray<FrontierMember<T>>, cand: FrontierMember<T>): FrontierMember<T>[] {
  for (const m of frontier) {
    if (equal(m.scores, cand.scores) || dominates(m.scores, cand.scores)) return [...frontier]
  }
  const kept = frontier.filter((m) => !dominates(cand.scores, m.scores))
  return [...kept, cand]
}

/** The deploy pick: the frontier member with the best MEAN score (ties → earliest inserted). */
export function bestAggregate<T>(frontier: ReadonlyArray<FrontierMember<T>>): FrontierMember<T> | null {
  let best: FrontierMember<T> | null = null
  let bestMean = -Infinity
  for (const m of frontier) {
    const mean = m.scores.length ? m.scores.reduce((s, x) => s + x, 0) / m.scores.length : 0
    if (mean > bestMean) {
      bestMean = mean
      best = m
    }
  }
  return best
}
