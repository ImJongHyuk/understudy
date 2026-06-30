/**
 * No-mock-of-SUT lint (CORE, project-agnostic) — the write-time guard that keeps
 * E2E honest. A spec may stub THIRD-PARTY traffic, but it must NOT `page.route` /
 * `context.route` the System-Under-Test's OWN API: if the SUT chain is faked the
 * test stops proving the thing E2E exists to prove (the real request/response
 * loop, real auth, real serialization). The SUT chain stays real — that is where
 * E2E earns its keep.
 *
 * Pure + deterministic (LLM-free), so it is a real gate property. The core stays
 * consumer-agnostic: the SUT's own URLs/hosts (`sutMatchers`) are supplied by the
 * ADAPTER (from its call-location map), never hard-coded here — mirroring the
 * lint-specs / redact-trace stance.
 *
 * Robust against the route-interception evasions an adversary reaches for:
 *  - MULTI-LINE `.route(` (Playwright auto-format puts the matcher on the next
 *    line) — we scan a joined buffer, not isolated lines.
 *  - bracket-notation receiver `page["route"](…)` / `page[`route`](…)`.
 *  - RegExp matcher `page.route(/\/api\//, …)` — the matcher is inspected whether
 *    it is a QUOTED string OR a RegExp literal (sutMatcher is tested against the
 *    RegExp source too).
 * String-concat URLs (`'/ap' + 'i'`) are best-effort only — the static first
 * literal segment is what gets inspected.
 *
 * KNOWN, ACCEPTED false positive: a legitimate third-party `.route()` whose
 * matcher merely CONTAINS a sutMatcher as a SUBSTRING (e.g. a CDN path that
 * happens to embed `/api`) is flagged. That is inherent to a substring gate and
 * is the safe direction to err — narrow the sutMatcher to disambiguate.
 *
 * KNOWN LIMIT (out of threat model): an inline block comment wedged between the
 * call and its first arg (`page.route(/* x *\/ '/api/...')`) dodges the matcher.
 * This requires a DELIBERATE obfuscation, but the threat here is an HONEST author
 * accidentally faking the SUT, not an adversary hiding a mock in a comment — and a
 * mock you went out of your way to disguise still defeats the test you wrote it
 * for. Only line comments are stripped (preserving `scheme://`); full comment
 * tokenization is out of scope for this deterministic substring gate.
 *
 * Mutation-proven in core/conformance/no-mock-of-sut.spec.ts.
 */

export interface SutMockViolation {
  readonly rule: string
  readonly line: number
  readonly text: string
}

/** The single rule emitted by this lint. */
export const NO_MOCK_OF_SUT_RULE = 'no-mock-of-sut'

// A route-interception call on any receiver — `.route(` (page.route(, ctx.route(,
// …) OR a bracket-notation access of the `route` member: `["route"](`,
// `['route'](`, `[`route`](` — with its FIRST argument: a QUOTED string
// (single/double/back-tick) OR a RegExp literal (`/…/flags`). The receiver name
// is never constrained — the SUT must not be intercepted however the route handle
// was reached — and whitespace (incl. newlines, once the source is joined into a
// single buffer) is tolerated everywhere, so a multi-line auto-formatted call is
// matched. Captures the string body (group 3) or the RegExp source (group 4) so
// the sutMatcher can be tested against either.
const ROUTE_FIRST_ARG =
  /(?:\.\s*route|\[\s*([`'"])route\1\s*\])\s*\(\s*(?:([`'"])((?:\\.|(?!\2)[^\\])*)\2|\/((?:\\.|[^\\/\n])+)\/[a-z]*)/g

/**
 * Strip a trailing `//` line comment WITHOUT mangling `://` URL schemes (e.g.
 * `https://localhost:3001/...`). A `//` counts as a comment only when it is not
 * the `//` of a `scheme://` — i.e. not immediately preceded by a `:`.
 */
function stripLineComment(line: string): string {
  return line.replace(/(^|[^:])\/\/.*$/, '$1')
}

/**
 * Return every no-mock-of-SUT violation in a spec's source (empty = clean).
 *
 * Flags a route interception whose first-arg matcher (quoted glob OR RegExp
 * source) contains ANY `sutMatcher` as a substring (e.g. `'/api'`,
 * `'api.example.com'`, `'localhost:3001'`). Multi-line calls and bracket-notation
 * receivers are handled. Line comments are ignored; a `.route` of a THIRD-PARTY
 * host not in `sutMatchers` is allowed.
 */
export function lintNoMockOfSut(
  specText: string,
  sutMatchers: readonly string[],
): SutMockViolation[] {
  const out: SutMockViolation[] = []
  if (sutMatchers.length === 0) return out

  // Strip comments per line FIRST (preserves `scheme://` + ignores commented-out
  // routes), then join into one buffer so a `.route(` split across newlines is
  // still seen. `lineStarts[i]` = buffer offset of the joined line `i`; used to
  // map a match offset back to its 1-based source line for the report.
  const rawLines = specText.split('\n')
  const codeLines = rawLines.map(stripLineComment)
  const buffer = codeLines.join('\n')
  const lineStarts: number[] = []
  let acc = 0
  for (const l of codeLines) {
    lineStarts.push(acc)
    acc += l.length + 1 // +1 for the '\n' join char
  }
  const lineOf = (offset: number): number => {
    // Largest lineStart <= offset → 1-based line number.
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  // Walk every route call whose first arg is an inspectable matcher (quoted
  // string OR RegExp source); flag the call when the matcher contains a
  // sutMatcher. One violation per source line is enough (`flagged`).
  ROUTE_FIRST_ARG.lastIndex = 0
  let m: RegExpExecArray | null
  const flagged = new Set<number>()
  while ((m = ROUTE_FIRST_ARG.exec(buffer)) !== null) {
    const raw = m[3] !== undefined ? m[3] : m[4]
    if (raw === undefined) continue
    // A RegExp source escapes its delimiter (`\/api` for `/api`); unescape `\/`
    // so a sutMatcher like `/api` is found in either matcher form. (Harmless for
    // quoted strings, which seldom escape the URL-relevant chars.)
    const matcher = raw.replace(/\\\//g, '/')
    if (sutMatchers.some((s) => s.length > 0 && matcher.includes(s))) {
      const line = lineOf(m.index)
      if (!flagged.has(line)) {
        flagged.add(line)
        out.push({
          rule: NO_MOCK_OF_SUT_RULE,
          line,
          text: rawLines[line - 1].trim(),
        })
      }
    }
  }
  out.sort((a, b) => a.line - b.line)
  return out
}
