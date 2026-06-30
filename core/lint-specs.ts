/**
 * Spec lint (CORE, project-agnostic) — the write-time complement to burn-in:
 * burn-in proves a spec is never red for the WRONG reason; this lint forbids the
 * constructs that CAUSE flakiness in the first place. Hard waits and raw
 * page-level CSS/XPath selectors are rejected; semantic, auto-waiting
 * role/label/text locators are the path of least resistance.
 *
 * Pure + deterministic (LLM-free), so it is a real gate property. Mutation-proven
 * in core/conformance/lint.spec.ts.
 */

export interface SpecViolation {
  readonly rule: string
  readonly line: number
  readonly text: string
}

interface Rule {
  readonly rule: string
  readonly re: RegExp
  readonly why: string
}

const RULES: readonly Rule[] = [
  // Hard waits — the #1 source of flakiness; auto-waiting assertions instead.
  { rule: 'no-wait-for-timeout', re: /\bwaitForTimeout\s*\(/, why: 'hard wait — use an auto-waiting expect/locator' },
  { rule: 'no-networkidle', re: /networkidle/, why: 'discouraged wait — assert a visible result instead' },
  { rule: 'no-sleep', re: /\bsleep\s*\(/, why: 'hard sleep — use an auto-waiting assertion' },
  // Raw, non-semantic page-level selectors — prefer getByRole/getByLabel/getByText.
  // (A `.locator(...)` CHAINED off a role locator is fine; only bare `page.locator`
  // with a string + `page.$`/`page.$$` are flagged.)
  { rule: 'no-raw-page-locator', re: /\bpage\s*\.\s*locator\s*\(\s*[`'"]/, why: 'raw page selector — anchor on getByRole/getByLabel/getByText' },
  { rule: 'no-page-query', re: /\bpage\s*\.\s*\$\$?\s*\(/, why: 'page.$ / page.$$ — use semantic locators' },
]

/** Return every lint violation in a spec's source (empty = clean). */
export function lintSpecText(text: string): SpecViolation[] {
  const out: SpecViolation[] = []
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '') // ignore line comments
    for (const r of RULES) {
      if (r.re.test(code)) out.push({ rule: r.rule, line: i + 1, text: line.trim() })
    }
  })
  return out
}

/** The rule catalog (rule → why), for reporting / docs. */
export function ruleCatalog(): ReadonlyArray<{ rule: string; why: string }> {
  return RULES.map((r) => ({ rule: r.rule, why: r.why }))
}
