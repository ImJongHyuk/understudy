/**
 * Negative-control CONFORMANCE / mutation proofs — the behaviour-level trust floor
 * as a deterministic gate (G4). Mutation-proves the FULL quadrant: the ACCEPT case
 * (GOOD green + BAD red on the named assertion), plus every rejection reason —
 * 'vacuous' (pass/pass), 'broken-on-good' (GOOD fails), 'infra' (BAD timeout), and
 * 'wrong-failure' (BAD fails NOT on the named line). Pure-unit (no browser, no
 * network), so the negative-control discipline is VERIFIED, not asserted.
 *
 * Ties the optional derivation helper to the REAL RealWorld evidence shape
 * (NEGATIVE-CONTROL.md): a `toHaveURL` regression landing on the named line.
 */
import { test, expect } from '@playwright/test'
import {
  classifyNegativeControl,
  outcomeFromPlaywrightTest,
  runNegativeControl,
  runNegativeControlBuild,
  type RunOutcome,
  type PlaywrightTestResultLike,
} from '../negative-control'

const GOOD_PASS: RunOutcome = { passed: true }
const BAD_NAMED_ASSERT: RunOutcome = {
  passed: false,
  failure: { onNamedAssertion: true, kind: 'assertion' },
}

test.describe('conformance: negative-control quadrant classifier (mutation-proven)', () => {
  test('ACCEPT: GOOD green + BAD red ON the named behaviour assertion', () => {
    expect(classifyNegativeControl(GOOD_PASS, BAD_NAMED_ASSERT)).toEqual({ accept: true })
  })

  test("vacuous: both builds pass -> the spec proves nothing", () => {
    expect(classifyNegativeControl(GOOD_PASS, GOOD_PASS)).toEqual({
      accept: false,
      reason: 'vacuous',
    })
  })

  test("broken-on-good: GOOD build fails -> the spec is just broken", () => {
    const goodFails: RunOutcome = {
      passed: false,
      failure: { onNamedAssertion: true, kind: 'assertion' },
    }
    expect(classifyNegativeControl(goodFails, BAD_NAMED_ASSERT)).toEqual({
      accept: false,
      reason: 'broken-on-good',
    })
  })

  test("infra: BAD build fails on a timeout (not behaviour)", () => {
    const badTimeout: RunOutcome = {
      passed: false,
      failure: { onNamedAssertion: false, kind: 'timeout' },
    }
    expect(classifyNegativeControl(GOOD_PASS, badTimeout)).toEqual({
      accept: false,
      reason: 'infra',
    })
  })

  test("infra: every infra kind (navigation/network/setup) is rejected, even on the named line", () => {
    for (const kind of ['navigation', 'network', 'setup'] as const) {
      const bad: RunOutcome = { passed: false, failure: { onNamedAssertion: true, kind } }
      expect(classifyNegativeControl(GOOD_PASS, bad)).toEqual({ accept: false, reason: 'infra' })
    }
  })

  test("infra: a !passed BAD run with NO failure detail is uncredible (infra)", () => {
    expect(classifyNegativeControl(GOOD_PASS, { passed: false })).toEqual({
      accept: false,
      reason: 'infra',
    })
  })

  test("wrong-failure: BAD fails NOT on the named line (assertion off the load-bearing line)", () => {
    const badOffLine: RunOutcome = {
      passed: false,
      failure: { onNamedAssertion: false, kind: 'assertion' },
    }
    expect(classifyNegativeControl(GOOD_PASS, badOffLine)).toEqual({
      accept: false,
      reason: 'wrong-failure',
    })
  })

  test("wrong-failure: BAD fails on the named line but kind is 'other' (not an assertion)", () => {
    const badOther: RunOutcome = {
      passed: false,
      failure: { onNamedAssertion: true, kind: 'other' },
    }
    expect(classifyNegativeControl(GOOD_PASS, badOther)).toEqual({
      accept: false,
      reason: 'wrong-failure',
    })
  })
})

test.describe('conformance: outcomeFromPlaywrightTest derivation (optional helper)', () => {
  const NAMED_LINE = 31 // the RealWorld evidence: toHaveURL on line 31 (NEGATIVE-CONTROL.md)

  test('a passed result -> passed outcome', () => {
    expect(outcomeFromPlaywrightTest({ status: 'passed' }, { namedAssertionLine: NAMED_LINE })).toEqual(
      { passed: true },
    )
  })

  test('the REAL evidence shape: a toHaveURL regression on the named line classifies as ACCEPT', () => {
    // Mirrors NEGATIVE-CONTROL.md: BAD build fails ON line 31 with a toHaveURL mismatch.
    const bad = outcomeFromPlaywrightTest(
      {
        status: 'failed',
        errors: [
          { message: 'Error: expect(page).toHaveURL: got "…/#/article/slug-broken"', location: { line: NAMED_LINE } },
        ],
      },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({ accept: true })
  })

  test("a timedOut result derives the 'timeout' (infra) kind", () => {
    const bad = outcomeFromPlaywrightTest({ status: 'timedOut' }, { namedAssertionLine: NAMED_LINE })
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: false, kind: 'timeout' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({ accept: false, reason: 'infra' })
  })

  test("EVASION 1: a web-first assertion TIMEOUT (status:'failed', 'Timed out … expect(…).toBeVisible()' ON the named line) is infra, NOT an accepted behaviour RED", () => {
    // The matcher token (toBeVisible) is whitelisted AND the failure lands on the named
    // line — yet a TIMEOUT is an infra wobble, never a credible behaviour negative-control.
    const bad = outcomeFromPlaywrightTest(
      {
        status: 'failed',
        errors: [
          {
            message: 'Timed out 5000ms waiting for expect(locator).toBeVisible()',
            location: { line: NAMED_LINE },
          },
        ],
      },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: false, kind: 'timeout' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({ accept: false, reason: 'infra' })
  })

  test("FALSE POSITIVE 0: a clean assertion whose code frame echoes a `{ timeout: N }` OPTION stays an assertion (ON the named line -> ACCEPT)", () => {
    // A real failing assertion's message includes the source CODE FRAME, which a couple of lines up
    // commonly shows a wait with an option, e.g. `await page.waitForURL(/…/, { timeout: 20_000 })`. The
    // OPTION keyword `timeout` must NOT be mistaken for the timeout FAILURE phrase — else a genuine
    // assertion RED is mis-bucketed as infra. The phrase always has a number+ms after it; the option is
    // always `timeout:` (colon, no whitespace+digit).
    const bad = outcomeFromPlaywrightTest(
      {
        status: 'failed',
        errors: [
          {
            message:
              'Error: expect(received).toMatch(expected)\n\nExpected pattern: /\\/reports$/\n' +
              'Received string:  "/settings"\n\n' +
              '  5 |   await page.waitForURL(/\\/dashboard$/, { timeout: 20_000 })\n' +
              '  6 |   const href = await link.getAttribute(\'href\')\n' +
              '> 7 |   expect(href).toMatch(/\\/reports$/)',
            location: { line: NAMED_LINE },
          },
        ],
      },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({ accept: true })
  })

  test("an 'interrupted' result derives the 'timeout' (infra) kind", () => {
    const bad = outcomeFromPlaywrightTest({ status: 'interrupted' }, { namedAssertionLine: NAMED_LINE })
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: false, kind: 'timeout' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({ accept: false, reason: 'infra' })
  })

  test('FALSE POSITIVE 1: a real assertion whose message merely mentions "navigate" stays an assertion (ON the named line -> ACCEPT)', () => {
    const bad = outcomeFromPlaywrightTest(
      {
        status: 'failed',
        errors: [
          {
            message: 'Error: expect(page).toHaveURL: expected to navigate to "…/#/" but got "…/#/login"',
            location: { line: NAMED_LINE },
          },
        ],
      },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({ accept: true })
  })

  test('FALSE POSITIVE 2: a real assertion whose message merely mentions "network" stays an assertion (ON the named line -> ACCEPT)', () => {
    const bad = outcomeFromPlaywrightTest(
      {
        status: 'failed',
        errors: [
          {
            message: 'Error: expect(received).toContainText: expected "network status: online"',
            location: { line: NAMED_LINE },
          },
        ],
      },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({ accept: true })
  })

  test('FALSE POSITIVE 3: a real assertion with a non-whitelisted matcher (toHaveCount) or an "Error:" prefix stays an assertion (ON the named line -> ACCEPT)', () => {
    const count = outcomeFromPlaywrightTest(
      {
        status: 'failed',
        errors: [{ message: 'Error: expect(locator).toHaveCount(3)', location: { line: NAMED_LINE } }],
      },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(count).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
    expect(classifyNegativeControl({ passed: true }, count)).toEqual({ accept: true })

    const equal = outcomeFromPlaywrightTest(
      {
        status: 'failed',
        errors: [{ message: 'Error: expect(received).toEqual(expected)', location: { line: NAMED_LINE } }],
      },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(equal).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
    expect(classifyNegativeControl({ passed: true }, equal)).toEqual({ accept: true })
  })

  test('a navigation/network error message maps to the infra kinds', () => {
    const nav = outcomeFromPlaywrightTest(
      { status: 'failed', errors: [{ message: 'page.goto: failed to navigate to URL' }] },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(nav.failure?.kind).toBe('navigation')
    const net = outcomeFromPlaywrightTest(
      { status: 'failed', errors: [{ message: 'apiRequest failed: net::ERR_CONNECTION_REFUSED' }] },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(net.failure?.kind).toBe('network')
  })

  test("an assertion that lands OFF the named line derives onNamedAssertion=false -> wrong-failure", () => {
    const bad = outcomeFromPlaywrightTest(
      { status: 'failed', errors: [{ message: 'expect(received).toBeVisible()', location: { line: 99 } }] },
      { namedAssertionLine: NAMED_LINE },
    )
    expect(bad).toEqual({ passed: false, failure: { onNamedAssertion: false, kind: 'assertion' } })
    expect(classifyNegativeControl({ passed: true }, bad)).toEqual({
      accept: false,
      reason: 'wrong-failure',
    })
  })
})

test.describe('conformance: runNegativeControl runner (injected runSpec -> classify)', () => {
  const LINE = 10
  // A fake runSpec: maps a source tag to a canned Playwright JSON result, recording invocations — so
  // the runner is verified with NO browser/network (the spawn is the caller's, injected here).
  const fakeRunner = (results: Record<string, PlaywrightTestResultLike>) => {
    const calls: string[] = []
    return { run: (source: string) => { calls.push(source); return results[source] }, calls }
  }
  const arm = (source: string) => ({ source, namedAssertionLine: LINE })

  test('ACCEPT: GOOD passes, BAD fails ON the named line', async () => {
    const { run } = fakeRunner({
      GOOD: { status: 'passed' },
      BAD: { status: 'failed', errors: [{ message: 'Error: expect(page).toHaveURL(/x/)', location: { line: LINE } }] },
    })
    const r = await runNegativeControl(run, arm('GOOD'), arm('BAD'))
    expect(r.verdict).toEqual({ accept: true })
    expect(r.good).toEqual({ passed: true })
    expect(r.bad).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
  })

  test('short-circuit: a broken GOOD returns broken-on-good and NEVER runs BAD', async () => {
    const { run, calls } = fakeRunner({
      GOOD: { status: 'failed', errors: [{ message: 'expect(page).toBeVisible()', location: { line: LINE } }] },
      BAD: { status: 'passed' },
    })
    const r = await runNegativeControl(run, arm('GOOD'), arm('BAD'))
    expect(r.verdict).toEqual({ accept: false, reason: 'broken-on-good' })
    expect(r.bad).toBeUndefined()
    expect(calls).toEqual(['GOOD']) // BAD was never run
  })

  test('vacuous: GOOD + BAD both pass', async () => {
    const { run } = fakeRunner({ GOOD: { status: 'passed' }, BAD: { status: 'passed' } })
    const r = await runNegativeControl(run, arm('GOOD'), arm('BAD'))
    expect(r.verdict).toEqual({ accept: false, reason: 'vacuous' })
  })

  test('infra: GOOD passes but BAD fails on a timeout', async () => {
    const { run } = fakeRunner({ GOOD: { status: 'passed' }, BAD: { status: 'timedOut' } })
    const r = await runNegativeControl(run, arm('GOOD'), arm('BAD'))
    expect(r.verdict).toEqual({ accept: false, reason: 'infra' })
  })
})

test.describe('conformance: runNegativeControlBuild (build-mutation, gold-standard)', () => {
  const LINE = 7
  const arm = { source: 'the-one-cuf-source', namedAssertionLine: LINE }
  const PASS: PlaywrightTestResultLike = { status: 'passed' }
  const RED_NAMED: PlaywrightTestResultLike = {
    status: 'failed',
    errors: [{ message: 'Error: expect(href).toMatch(/x/)', location: { line: LINE } }],
  }
  const TIMEOUT: PlaywrightTestResultLike = { status: 'timedOut' }

  // GOOD and BAD share the ONE source, so a source→result map can't tell them apart — successive calls
  // pop a QUEUE. The log records run/mutate/revert/sleep ORDER so the build invariants are provable.
  const harness = (queue: PlaywrightTestResultLike[]) => {
    const log: string[] = []
    let sleeps = 0
    return {
      runSpec: (_s: string) => (log.push('run'), queue.shift() ?? PASS),
      mutate: () => void log.push('mutate'),
      revert: () => void log.push('revert'),
      sleep: async (_ms: number) => void (sleeps++, log.push('sleep')),
      log,
      sleeps: () => sleeps,
    }
  }

  test('ACCEPT: GOOD (pristine) passes, BAD (regressed) reds on the named line; GOOD runs BEFORE mutate, revert is LAST', async () => {
    const h = harness([PASS, RED_NAMED])
    const r = await runNegativeControlBuild(h.runSpec, arm, h.mutate, h.revert)
    expect(r.verdict).toEqual({ accept: true })
    expect(r.good).toEqual({ passed: true })
    expect(r.bad).toEqual({ passed: false, failure: { onNamedAssertion: true, kind: 'assertion' } })
    expect(h.log).toEqual(['run', 'mutate', 'run', 'revert'])
  })

  test('broken-on-good SHORT-CIRCUITS: a failing GOOD never mutates and never reverts (build untouched)', async () => {
    const h = harness([RED_NAMED]) // GOOD itself fails
    const r = await runNegativeControlBuild(h.runSpec, arm, h.mutate, h.revert)
    expect(r.verdict).toEqual({ accept: false, reason: 'broken-on-good' })
    expect(r.bad).toBeUndefined()
    expect(h.log).toEqual(['run']) // no 'mutate', no 'revert'
  })

  test('retry-until-clean: a not-yet-live regression (vacuous, then mid-rebuild timeout) re-runs until the named RED', async () => {
    const h = harness([PASS /*GOOD*/, PASS /*BAD#1 not built → vacuous*/, TIMEOUT /*BAD#2 mid-rebuild*/, RED_NAMED /*BAD#3 live*/])
    const seen: RunOutcome[] = []
    const r = await runNegativeControlBuild(h.runSpec, arm, h.mutate, h.revert, {
      retries: 5,
      settleMs: 10,
      sleep: h.sleep,
      onAttempt: (_n, o) => seen.push(o),
    })
    expect(r.verdict).toEqual({ accept: true })
    expect(seen.length).toBe(3) // stopped at the FIRST clean assertion RED (3rd BAD attempt), not all 5
    expect(h.sleeps()).toBe(3) // settle BEFORE each attempt
    expect(h.log.filter((x) => x === 'revert')).toEqual(['revert']) // reverted exactly once
  })

  test('retries EXHAUSTED with no credible RED → vacuous (REJECT), and still reverts', async () => {
    const h = harness([PASS /*GOOD*/, PASS, PASS /*BAD always vacuous*/])
    const r = await runNegativeControlBuild(h.runSpec, arm, h.mutate, h.revert, { retries: 2, settleMs: 1, sleep: h.sleep })
    expect(r.verdict).toEqual({ accept: false, reason: 'vacuous' })
    expect(h.log.filter((x) => x === 'run').length).toBe(3) // GOOD + 2 BAD attempts
    expect(h.log[h.log.length - 1]).toBe('revert')
  })

  test('revert ALWAYS runs even when mutate THROWS (finally) — the build is never left regressed', async () => {
    const log: string[] = []
    const runSpec = () => (log.push('run'), PASS) // GOOD passes
    const mutate = () => {
      log.push('mutate')
      throw new Error('edit failed')
    }
    const revert = () => void log.push('revert')
    await expect(runNegativeControlBuild(runSpec, arm, mutate, revert)).rejects.toThrow('edit failed')
    expect(log).toEqual(['run', 'mutate', 'revert']) // GOOD ran, mutate threw, revert STILL ran
  })
})
