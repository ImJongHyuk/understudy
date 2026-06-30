/**
 * Post-Healer lint (CORE, project-agnostic) — the DETERMINISTIC, LLM-free gate
 * side of INV-6. The Healer agent only *proposes* a patch; that patch re-enters
 * the merge gate from scratch and is judged here, never on the honor system. A
 * patch that trips ANY rule below is REJECTED: the heal does not count as green,
 * the test stays RED, and the failure escalates to a human.
 *
 * The four rules mirror the HARD CONSTRAINTS in
 * `.claude/agents/playwright-test-healer.md` ("Post-Healer lint" section):
 *   1) gate-policy edit  — a fix must target the TEST, never the gate that judges it.
 *   2) skip/quarantine added — there is no "mark it skipped" escape hatch.
 *   3) test-count reduced — deleting/commenting out a case to get green is a FALSE green.
 *   4) assertion weakened — removing an expect or downgrading a matcher lowers the bar.
 *
 * Pure + deterministic (no LLM, INV-1), so it is a real gate property. Heuristics
 * are deliberately CONSERVATIVE — a few high-confidence signals over comprehensive
 * coverage — so a legitimate heal (e.g. a pure selector correction) passes clean.
 * Mutation-proven in core/conformance/post-heal-lint.spec.ts.
 *
 * KNOWN CONSERVATIVE LIMITS (out of scope — this is a line/regex heuristic, not an
 * AST analysis, so a few count-restoring evasions slip past on purpose):
 *   • per-literal regex-anchor evasion — rule 4c counts anchors file-wide, so a
 *     decoy `/^x$/` added elsewhere can restore the count after a real anchor is
 *     dropped from a meaningful regex.
 *   • decoy-count evasion — rules 3/4a count `test(`/`expect(` file-wide, so a
 *     throwaway `test('noop', () => {})` or stray `expect(true)` can mask a real
 *     deletion/downgrade by restoring the totals.
 * Both would need AST-level, per-assertion attribution. They are backstopped by
 * three independent layers: the behaviour-level negative control (a weakened heal
 * still has to keep the broken flow RED), the human-review floor on every heal,
 * and the deterministic re-run of the merged patch from scratch — a heal that is
 * weakened-but-still-green is caught there, not here. The line lint stays
 * conservative by design rather than chasing false positives on legitimate heals.
 */

export interface HealChange {
  readonly path: string
  /** Pre-heal source. Empty string ('') denotes a newly-added file. */
  readonly before: string
  readonly after: string
}

export interface HealViolation {
  readonly rule: string
  readonly path: string
  readonly detail: string
}

/* ── rule 1: gate-policy edit ──────────────────────────────────────────────
 * The fix must target the TEST, never the gate that judges it. Any change under
 * core/** (incl. core/conformance/**) or a trust path is a gate-policy edit.
 */
const GATE_PATH_RE = /(^|\/)(core|trust)\//

function normalizePath(p: string): string {
  // Tolerate leading "./" and Windows separators so path matching is robust.
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/* ── rule 2: skip / quarantine constructs ──────────────────────────────────
 * Each is a way to launder a red test as green. We count occurrences and REJECT
 * when the count rises (after > before), so a heal that ADDS one is caught while
 * a spec that already carried one (untouched by this heal) is not penalized.
 */
const SKIP_PATTERNS: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: 'test.skip', re: /\btest\s*\.\s*skip\b/g },
  { name: 'test.fixme', re: /\btest\s*\.\s*fixme\b/g },
  { name: 'test.only', re: /\btest\s*\.\s*only\b/g },
  { name: 'test.slow', re: /\btest\s*\.\s*slow\b/g },
  { name: '.skip(', re: /\.\s*skip\s*\(/g },
  { name: '.fixme(', re: /\.\s*fixme\s*\(/g },
  { name: '.only(', re: /\.\s*only\s*\(/g },
  { name: 'xtest', re: /\bxtest\b/g },
  { name: 'xit', re: /\bxit\b/g },
]

/* ── rule 3: test count ────────────────────────────────────────────────────
 * The patched file must contain ≥ the pre-heal number of test(/it( cases.
 */
const TEST_DECL_RE = /\b(?:test|it)\s*\(/g

/* ── rule 4: assertion weakening ───────────────────────────────────────────
 * (a) expect( count must not drop.
 * (b) matcher downgrades: a strong, value-bearing matcher swapped for a looser
 *     "merely present/truthy" one (count of the strong matchers drops).
 * (c) a regex anchor (^ or $) dropped from the source.
 * (d) an action/expect timeout widened or newly added to mask slowness.
 */
const EXPECT_RE = /\bexpect\s*\(/g

/** Strong, value-bearing matchers whose disappearance signals a downgrade. */
const STRONG_MATCHERS: readonly string[] = [
  'toHaveText',
  'toContainText',
  'toHaveValue',
  'toHaveCount',
  'toHaveURL',
  'toHaveAttribute',
  'toHaveClass',
  'toEqual',
  'toBe',
  'toMatch',
  'toHaveScreenshot',
]

/** Loose matchers a downgrade typically lands on (presence/truthiness only). */
const LOOSE_MATCHERS: readonly string[] = [
  'toBeVisible',
  'toBeTruthy',
  'toBeDefined',
  'toBeAttached',
]

function countMatches(text: string, re: RegExp): number {
  // Fresh stateless copy — never share a /g lastIndex across calls.
  const m = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))
  return m ? m.length : 0
}

function countMatcher(text: string, name: string): number {
  return countMatches(text, new RegExp(`\\.\\s*${name}\\s*\\(`, 'g'))
}

/** Count regex anchors (`^` / `$`) appearing inside a JS regex literal. */
function countRegexAnchors(text: string): number {
  let n = 0
  for (const lit of text.match(/\/(?:\\.|[^/\n\\])+\/[a-z]*/g) ?? []) {
    n += (lit.match(/[\^$]/g) ?? []).length
  }
  return n
}

/**
 * Numeric token of a `timeout:` option, matched ROBUSTLY so a separator/exponent/
 * sign cannot smuggle a widening past the lint. Covers the JS number forms a heal
 * might emit: decimal integers with `_` separators (`30_000`), decimals (`1_500.0`),
 * scientific notation (`1e3`, `1.5e4`, `0.5e4`), hex (`0x7530`), and an explicit
 * leading sign (`+30000`). A naive `/\d+/` read only the leading run — `30_000`
 * looked like `30`, a 6x widening masked AND mis-reported; and a bare `\d` start
 * missed `+30000` entirely. We capture the whole literal, then evaluate it below.
 */
const TIMEOUT_NUM_RE =
  /\btimeout\s*:\s*([+-]?(?:0[xX][0-9a-fA-F_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d[\d_]*)?))/g

/** Evaluate a captured numeric token (strip `_` separators) to its real value. */
function parseTimeoutToken(tok: string): number {
  return Number(tok.replace(/_/g, ''))
}

/**
 * Largest explicit `timeout: <n>` (action/expect option) in the source, in ms;
 * -1 when no explicit timeout is present. The value is parsed for real (separators,
 * decimals, exponents, hex), so both the widening test AND the reported figure are
 * accurate — a `timeout: 30_000` is judged and reported as 30000, not 30.
 */
function maxTimeout(text: string): number {
  let max = 0
  let found = false
  for (const m of text.matchAll(TIMEOUT_NUM_RE)) {
    found = true
    const v = parseTimeoutToken(m[1])
    if (Number.isFinite(v) && v > max) max = v
  }
  return found ? max : -1 // -1 = "no explicit timeout present"
}

const TEST_FILE_RE = /\.(spec|test)\.[cm]?[jt]sx?$/

/**
 * Judge a set of healed changes. Returns every violation found (empty = a clean,
 * legitimate heal). A new file (before === '') is exempt from the count/weaken
 * deltas — there is no pre-heal baseline to compare against — but is still
 * subject to the gate-path rule (a heal may never ADD a core/trust file either).
 */
export function lintHealedChange(changes: readonly HealChange[]): HealViolation[] {
  const out: HealViolation[] = []
  const push = (rule: string, path: string, detail: string) => out.push({ rule, path, detail })

  for (const change of changes) {
    const path = normalizePath(change.path)
    const { before, after } = change

    // Rule 1 — gate-policy edit (applies to every change, incl. new files).
    if (GATE_PATH_RE.test(path)) {
      push('gate-policy-edit', path, 'heal must target the test, not gate code under core/** or trust/**')
      continue // gate edits are categorically rejected; later deltas are moot.
    }

    const isTestFile = TEST_FILE_RE.test(path)
    const isNewFile = before === ''

    // Rule 2 — skip/quarantine added (test files only; count must not rise).
    if (isTestFile) {
      for (const { name, re } of SKIP_PATTERNS) {
        const added = countMatches(after, re) - countMatches(before, re)
        if (added > 0) {
          push('skip-or-quarantine-added', path, `added ${added} \`${name}\` construct(s)`)
        }
      }
    }

    // The remaining rules compare against a pre-heal baseline; a new file has none.
    if (isNewFile) continue

    // Rule 3 — test count reduced.
    const testsBefore = countMatches(before, TEST_DECL_RE)
    const testsAfter = countMatches(after, TEST_DECL_RE)
    if (testsAfter < testsBefore) {
      push('test-count-reduced', path, `test/it count ${testsBefore} -> ${testsAfter}`)
    }

    // Rule 4a — expect count reduced.
    const expectBefore = countMatches(before, EXPECT_RE)
    const expectAfter = countMatches(after, EXPECT_RE)
    if (expectAfter < expectBefore) {
      push('assertion-weakened', path, `expect() count ${expectBefore} -> ${expectAfter}`)
    }

    // Rule 4b — matcher downgrade: strong value-bearing matcher count dropped
    // while a loose presence/truthiness matcher count rose (high-confidence swap).
    const strongBefore = STRONG_MATCHERS.reduce((s, m) => s + countMatcher(before, m), 0)
    const strongAfter = STRONG_MATCHERS.reduce((s, m) => s + countMatcher(after, m), 0)
    const looseBefore = LOOSE_MATCHERS.reduce((s, m) => s + countMatcher(before, m), 0)
    const looseAfter = LOOSE_MATCHERS.reduce((s, m) => s + countMatcher(after, m), 0)
    if (strongAfter < strongBefore && looseAfter > looseBefore) {
      push(
        'assertion-weakened',
        path,
        `matcher downgrade: strong ${strongBefore} -> ${strongAfter}, loose ${looseBefore} -> ${looseAfter}`,
      )
    }

    // Rule 4c — a regex anchor dropped (^…$ removed to widen a match).
    const anchorsBefore = countRegexAnchors(before)
    const anchorsAfter = countRegexAnchors(after)
    if (anchorsAfter < anchorsBefore) {
      push('assertion-weakened', path, `regex anchor(s) dropped ${anchorsBefore} -> ${anchorsAfter}`)
    }

    // Rule 4d — a timeout widened or newly introduced to mask slowness.
    const tBefore = maxTimeout(before)
    const tAfter = maxTimeout(after)
    const widened = tBefore >= 0 && tAfter > tBefore
    const added = tBefore < 0 && tAfter >= 0
    if (widened || added) {
      push(
        'assertion-weakened',
        path,
        added
          ? `timeout introduced (${tAfter}ms) — masks slowness`
          : `timeout widened ${tBefore}ms -> ${tAfter}ms — masks slowness`,
      )
    }
  }

  return out
}
