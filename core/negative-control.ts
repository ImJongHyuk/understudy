/**
 * Negative-control classifier (CORE, project-agnostic) — turns the behaviour-level
 * negative-control discipline into a reusable, deterministic gate. A spec is only
 * trustworthy if, against an INTENTIONALLY regressed build, it actually goes RED —
 * and for the RIGHT reason: a NAMED behaviour assertion failing, not a vacuous
 * pass, not a green-on-good break, not an infra wobble (timeout/navigation/
 * network/setup), not some incidental non-named assertion.
 *
 * The classifier compares the two runs of a controlled experiment — the GOOD
 * (unmodified) build and the BAD (regressed) build — and returns a verdict. ACCEPT
 * means the negative-control held; otherwise the verdict carries the specific
 * reason the control is NOT credible.
 *
 * Pure + deterministic (LLM-free), so it is a real gate property. The optional
 * `outcomeFromPlaywrightTest` helper derives a `RunOutcome` from a Playwright JSON
 * test result, but the classifier itself stays pure and is the core deliverable.
 * Mutation-proven in core/conformance/negative-control.spec.ts.
 */

export type FailureKind = 'assertion' | 'timeout' | 'navigation' | 'network' | 'setup' | 'other'

export interface RunOutcome {
  readonly passed: boolean
  readonly failure?: {
    /** The failure landed on the spec's NAMED behaviour assertion (the load-bearing line). */
    readonly onNamedAssertion: boolean
    readonly kind: FailureKind
  }
}

export type NegControlVerdict =
  | { accept: true }
  | { accept: false; reason: 'vacuous' | 'broken-on-good' | 'infra' | 'wrong-failure' }

/** Infra-shaped failures — a RED for these is NOT a credible behaviour negative-control. */
const INFRA_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'timeout',
  'navigation',
  'network',
  'setup',
])

/**
 * The behaviour-level negative-control gate. ACCEPT iff the GOOD build is green AND
 * the BAD build goes RED ON the named behaviour assertion. Every other shape yields
 * a typed rejection reason:
 *  - both pass            -> 'vacuous'       (the spec proves nothing)
 *  - GOOD fails           -> 'broken-on-good' (the spec is just broken)
 *  - BAD fails on infra   -> 'infra'         (timeout/navigation/network/setup, not behaviour)
 *  - BAD fails off-line   -> 'wrong-failure' (a non-named assertion, not the load-bearing one)
 */
export function classifyNegativeControl(good: RunOutcome, bad: RunOutcome): NegControlVerdict {
  if (!good.passed) return { accept: false, reason: 'broken-on-good' }
  if (bad.passed) return { accept: false, reason: 'vacuous' }
  const f = bad.failure
  // No failure detail on a !passed run: treat as infra-shaped (uncredible behaviour control).
  if (!f || INFRA_KINDS.has(f.kind)) return { accept: false, reason: 'infra' }
  if (f.kind !== 'assertion' || !f.onNamedAssertion) {
    return { accept: false, reason: 'wrong-failure' }
  }
  return { accept: true }
}

/** The minimal shape we read from a Playwright JSON test result (one test). */
export interface PlaywrightTestResultLike {
  readonly status?: string // 'passed' | 'failed' | 'timedOut' | 'interrupted' | ...
  readonly errors?: ReadonlyArray<{ readonly message?: string; readonly location?: { readonly line?: number } }>
}

export interface OutcomeFromTestOptions {
  /** 1-based source line of the spec's NAMED behaviour assertion (the load-bearing line). */
  readonly namedAssertionLine: number
}

/**
 * OPTIONAL convenience: derive a `RunOutcome` from a single Playwright JSON test
 * result. Kept thin and side-effect-free; the classifier stays the core deliverable.
 *
 * Order of inference matters (and is load-bearing for the negative-control gate):
 *  1. TIMEOUT/INTERRUPTED is infra, FULL STOP — checked on BOTH the status AND the
 *     message, BEFORE any matcher/assertion sniff. A Playwright web-first assertion
 *     that times out reports `status:'failed'` with "Timed out … expect(locator).
 *     toBeVisible()"; the whitelisted matcher token must NOT promote that to a
 *     credible behaviour assertion. A timeout is always an infra wobble.
 *  2. ASSERTION SHAPE next: an `expect(` in the message is an assertion regardless
 *     of which matcher / 'navigate'/'network' words happen to appear in it — checked
 *     BEFORE the navigation/network substring checks so a real assertion is never
 *     mis-bucketed as infra.
 *  3. navigation / network substrings only for NON-assertion failures.
 *  4. everything else is 'other'.
 * An assertion landing on the named line is the credible behaviour assertion.
 */
export function outcomeFromPlaywrightTest(
  result: PlaywrightTestResultLike,
  opts: OutcomeFromTestOptions,
): RunOutcome {
  if (result.status === 'passed') return { passed: true }

  const err = result.errors?.[0]
  const msg = err?.message ?? ''
  const onNamedAssertion = err?.location?.line === opts.namedAssertionLine

  // (1) Timeout/interrupted is infra — before any matcher/assertion sniff. A web-first
  // assertion timeout reports status:'failed' with "Timed out …", so check the message too.
  // Match the timeout FAILURE PHRASE ("Timed out 5000ms" / "Timeout 5000ms exceeded" /
  // "timeout of 30000ms exceeded") — NOT the bare option keyword `timeout`, which appears in the
  // code frame Playwright echoes into the error (e.g. `await page.waitForURL(/…/, { timeout: 20_000 })`
  // a couple of lines above the failing assertion). The old `/timed?\s*out/i` matched "timeout" inside
  // `{ timeout: 20_000 }` and mis-bucketed a clean assertion RED as infra. The phrase always has a
  // number+ms after it; the option is always `timeout:` (colon, no whitespace+digit).
  if (
    result.status === 'timedOut' ||
    result.status === 'interrupted' ||
    /timed out|timeout\s+(?:of\s+)?\d/i.test(msg)
  ) {
    return { passed: false, failure: { onNamedAssertion: false, kind: 'timeout' } }
  }

  let kind: FailureKind = 'other'
  if (isAssertionMessage(msg)) {
    // (2) Assertion shape wins over navigation/network substrings the message may carry.
    kind = 'assertion'
  } else if (/\bnavigat/i.test(msg)) {
    kind = 'navigation'
  } else if (/\bnet::|\bnetwork\b|ECONNREFUSED|fetch failed/i.test(msg)) {
    kind = 'network'
  }

  return { passed: false, failure: { onNamedAssertion, kind } }
}

/**
 * Is this error message an `expect`-shaped assertion? An `expect(` anywhere in the
 * message is the strongest signal (a real Playwright assertion, e.g. `Error: expect(
 * page).toHaveCount(...)`), regardless of which matcher it uses or whether it is
 * prefixed `Error:`. We also recognise a bare matcher token (no `expect(` reconstructed
 * in the message) for common matchers — without a `^` anchor, so an `Error:` prefix
 * doesn't hide it. NB: a "Timed out … expect(…)" message is handled as a TIMEOUT
 * upstream and never reaches here.
 */
function isAssertionMessage(msg: string): boolean {
  return /\bexpect\s*\(/i.test(msg) || /\b(?:toHaveURL|toBeVisible|toHaveText|toContainText|toHaveCount|toEqual|toBe|toMatch|toHaveValue|toBeChecked|toHaveAttribute)\b|\bassertion\b/i.test(msg)
}

// ── OPTIONAL runner — drive the controlled experiment and classify ───────────────────────────────
/** One arm of the controlled experiment: a spec source + the 1-based line of its NAMED assertion. */
export interface NegControlArm {
  readonly source: string
  readonly namedAssertionLine: number
}

/** Run ONE spec source and return its Playwright JSON test result (the single test). Injected by the
 * caller so CORE stays I/O-free + deterministic — the actual Playwright spawn lives in the driver. */
export type SpecRunner = (source: string) => Promise<PlaywrightTestResultLike> | PlaywrightTestResultLike

export interface NegControlRun {
  readonly verdict: NegControlVerdict
  readonly good: RunOutcome
  /** undefined when GOOD was broken — BAD is not run (short-circuit). */
  readonly bad?: RunOutcome
}

/**
 * Drive the full GOOD→BAD negative-control with an injected `runSpec`, then classify. Short-circuits on
 * a broken GOOD (no point running BAD). This is the reusable bridge from the (proven) pure classifier to
 * a REAL controlled experiment — the missing wiring the heal/consumer drivers did ad-hoc. Stays generic
 * (no Playwright import, no app/consumer identifiers); the caller supplies how to run a spec.
 */
export async function runNegativeControl(
  runSpec: SpecRunner,
  good: NegControlArm,
  bad: NegControlArm,
): Promise<NegControlRun> {
  const goodOut = outcomeFromPlaywrightTest(await runSpec(good.source), { namedAssertionLine: good.namedAssertionLine })
  if (!goodOut.passed) return { verdict: { accept: false, reason: 'broken-on-good' }, good: goodOut }
  const badOut = outcomeFromPlaywrightTest(await runSpec(bad.source), { namedAssertionLine: bad.namedAssertionLine })
  return { verdict: classifyNegativeControl(goodOut, badOut), good: goodOut, bad: badOut }
}

// ── OPTIONAL runner — the BUILD-MUTATION (gold-standard) variant ───────────────────────────────────
export interface NegControlBuildOptions {
  /** BAD-build run attempts (default 1 = no retry). >1 absorbs an async rebuild (e.g. dev-server HMR)
   * that may not be live on the first run: a still-pristine build yields a 'passed' (vacuous) and a
   * mid-rebuild yields a timeout — NEITHER is a credible RED, so we re-run until a clean named-assertion
   * failure appears or attempts are exhausted. Exhaustion leaves the last outcome → classified as
   * vacuous/infra (REJECT), NEVER a false ACCEPT. */
  readonly retries?: number
  /** Settle delay applied BEFORE each BAD attempt — give the mutated build time to (re)build. Requires
   * `sleep`; ignored without it (core holds no timer of its own, so it stays deterministic + testable). */
  readonly settleMs?: number
  /** Injected delay (e.g. `(ms) => new Promise(r => setTimeout(r, ms))`). Kept out of core so conformance
   * uses a fake clock — core never touches a real timer. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Progress hook, one call per BAD attempt with its derived outcome. */
  readonly onAttempt?: (attempt: number, outcome: RunOutcome) => void
}

/**
 * The GOLD-STANDARD negative-control: SAME spec, two BUILDS. Unlike `runNegativeControl` (where GOOD and
 * BAD are two different spec SOURCES — a flow/source mutation), here the controlled variable is the APP
 * CODE: run the one spec against the pristine build, apply an app-code regression via `mutate`, run the
 * SAME spec against the regressed build, and ALWAYS undo it via `revert`. This is the generic form of the
 * "inject a real regression → the CUF must go RED on its named line → revert" pattern that consumer
 * drivers (and the reference build harness) otherwise re-implement ad-hoc.
 *
 * Invariants:
 *  - `revert` runs in a `finally` — a thrown `mutate`/`runSpec` (or any error) can NEVER leave the build
 *    regressed. (Make `revert` idempotent + safe on an un-mutated tree — e.g. restore original bytes.)
 *  - GOOD is run on the PRISTINE tree, before `mutate`; a broken GOOD short-circuits (no mutate/revert).
 *  - retry stops at the FIRST credible RED (a settled `assertion` failure); the classifier then makes the
 *    accept / wrong-failure call. LLM-free + I/O-free (runSpec/mutate/revert/sleep all injected).
 */
export async function runNegativeControlBuild(
  runSpec: SpecRunner,
  spec: NegControlArm,
  mutate: () => void | Promise<void>,
  revert: () => void | Promise<void>,
  opts: NegControlBuildOptions = {},
): Promise<NegControlRun> {
  const good = outcomeFromPlaywrightTest(await runSpec(spec.source), { namedAssertionLine: spec.namedAssertionLine })
  if (!good.passed) return { verdict: { accept: false, reason: 'broken-on-good' }, good }

  let bad: RunOutcome | undefined
  const attempts = Math.max(1, opts.retries ?? 1)
  try {
    await mutate()
    for (let i = 1; i <= attempts; i++) {
      if (opts.settleMs && opts.sleep) await opts.sleep(opts.settleMs)
      bad = outcomeFromPlaywrightTest(await runSpec(spec.source), { namedAssertionLine: spec.namedAssertionLine })
      opts.onAttempt?.(i, bad)
      // Stop at the first SETTLED failure (a real `assertion` — the regressed build is live). A 'passed'
      // (regression not yet built → vacuous) or an infra-shaped failure (mid-rebuild) is not credible →
      // keep retrying. The classifier decides accept vs wrong-failure on whatever we stop with.
      if (!bad.passed && bad.failure?.kind === 'assertion') break
    }
  } finally {
    await revert()
  }
  return { verdict: classifyNegativeControl(good, bad as RunOutcome), good, bad }
}
