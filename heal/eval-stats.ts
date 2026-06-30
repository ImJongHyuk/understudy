/**
 * heal/eval-stats — honest small-sample statistics for gate-pass-rate comparisons. n≤10 on a binary
 * gate is a coin-flip; a bare "50%" or "0%" hides that. (Research Part 3 / Anthropic "Adding Error
 * Bars to Evals".) Pure math, no I/O — applied when reporting any A/B.
 *
 * - `wilson`        : CI for one proportion k/n. Wald collapses at small n / extreme p; Wilson does
 *                     not. NB wilson(0,4).hi ≈ 0.49 — a "0%" cell is compatible with a true ~49%.
 * - `newcombeDiff`  : CI for the difference of two INDEPENDENT proportions (our arms are independent
 *                     rollouts, not paired) — Newcombe's hybrid-score method, good at small n.
 * - `mcnemarMidP`   : two-sided mid-p for TRUE paired binary data (same items under A and B). Use
 *                     only when outcomes are paired; mid-p has better small-sample power than exact.
 */

function logFactorial(n: number): number {
  let s = 0
  for (let i = 2; i <= n; i++) s += Math.log(i)
  return s
}
function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0
  return Math.exp(logFactorial(n) - logFactorial(k) - logFactorial(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p))
}

export interface Interval {
  readonly p: number
  readonly lo: number
  readonly hi: number
}

/** Wilson score interval for k successes in n trials (default z=1.96 ≈ 95%). */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { p: 0, lo: 0, hi: 1 }
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

/** Newcombe difference CI for two INDEPENDENT proportions (B − A). lo<0<hi ⇒ not distinguishable. */
export function newcombeDiff(kA: number, nA: number, kB: number, nB: number, z = 1.96): Interval {
  const a = wilson(kA, nA, z)
  const b = wilson(kB, nB, z)
  const diff = b.p - a.p
  const lo = diff - Math.sqrt((b.p - b.lo) ** 2 + (a.hi - a.p) ** 2)
  const hi = diff + Math.sqrt((b.hi - b.p) ** 2 + (a.p - a.lo) ** 2)
  return { p: diff, lo: Math.max(-1, lo), hi: Math.min(1, hi) }
}

/** Two-sided McNemar mid-p for PAIRED binary outcomes. b = A-pass & B-fail, c = A-fail & B-pass;
 * only discordant pairs carry signal. mid-p = exact-two-sided − point-mass(min(b,c)). */
export function mcnemarMidP(b: number, c: number): number {
  const n = b + c
  if (n === 0) return 1
  const k = Math.min(b, c)
  let cum = 0
  for (let i = 0; i <= k; i++) cum += binomPmf(i, n, 0.5)
  const midP = 2 * cum - binomPmf(k, n, 0.5)
  return Math.min(1, Math.max(0, midP))
}

/** "50% [15–85%]" — a proportion with its Wilson CI, for report lines. */
export function fmtPct(k: number, n: number): string {
  const w = wilson(k, n)
  const r = (x: number) => Math.round(x * 100)
  return `${r(w.p)}% [${r(w.lo)}–${r(w.hi)}%]`
}
