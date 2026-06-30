/**
 * heal/triage — classify a finished heal ROLLOUT (its step trace + the gate verdict) into a
 * failure CATEGORY and the single NEXT LEVER most likely to move it. Where heal/diagnostics
 * RENDERS a rollout for a human to read, this TRIAGES it: a small, pure heuristic over the same
 * signals so the campaign loop can bucket failures automatically instead of eyeballing every
 * --dump trace. The principle is analysis-first — name WHY a rollout failed (couldn't see the
 * controls? gutted the assertion? edited the wrong upstream step?) so the next lever is chosen,
 * not guessed. Pure (no I/O) → conformance-verifiable.
 */
import type { StepRecord } from './diagnostics'

/** The bucket a failed (or healed) rollout falls into. Most-specific first when triaging. */
export type TriageCategory =
  | 'healed'
  | 'apply-failure'
  | 'dropped-assertion'
  | 'forbidden-move'
  | 'grounding-empty'
  | 'still-red-wrong-fix'
  | 'vacuous-no-edit'
  | 'loop-error'
  | 'unknown'

export interface TriageInput {
  readonly passed: boolean
  readonly reason: string
  readonly steps: ReadonlyArray<StepRecord>
}

export interface TriageResult {
  /** which failure bucket the rollout fell into */
  readonly category: TriageCategory
  /** the single next lever most likely to move this bucket */
  readonly lever: string
  /** one-line human summary of which signal fired */
  readonly detail: string
}

/** A get_accessibility snapshot is "unrendered" when the SPA hadn't painted the real controls yet:
 * it still shows a loading marker, or it's so short there's nothing to ground against. */
function isUnrendered(result: string | undefined): boolean {
  const s = (result ?? '').trim()
  return s.toLowerCase().includes('loading') || s.length < 80
}

/**
 * Triage one rollout into a { category, lever, detail }. Heuristics are checked MOST-SPECIFIC
 * FIRST so a more diagnostic signal (e.g. an unrendered grounding snapshot) wins over a generic
 * verdict string (e.g. "no edit"). Pure: depends only on the inputs.
 */
export function triageRollout(input: TriageInput): TriageResult {
  const { passed, reason, steps } = input
  const r = reason.toLowerCase()

  // 1. The gate accepted the heal — nothing to triage.
  if (passed) {
    return { category: 'healed', lever: '—', detail: `healed (${reason})` }
  }

  // 2. The loop itself errored (provider/timeout) — not a model-quality signal.
  if (r.startsWith('loop error')) {
    return {
      category: 'loop-error',
      lever: 'provider/timeout resilience',
      detail: `loop error before a verdict: ${reason}`,
    }
  }

  // 3/4. Anti-cheat verdicts: the model made a forbidden move or gutted a load-bearing assertion.
  if (r.includes('forbidden')) {
    return {
      category: 'forbidden-move',
      lever: 'skill anti-cheat framing',
      detail: `forbidden move flagged by the gate: ${reason}`,
    }
  }
  if (r.includes('dropped')) {
    return {
      category: 'dropped-assertion',
      lever: 'skill anti-cheat framing',
      detail: `dropped a load-bearing assertion: ${reason}`,
    }
  }

  // 5. The edit never landed — replace_in_spec's old-string didn't match the spec.
  const applyFailures = steps.filter(
    (s) => s.name === 'replace_in_spec' && (s.result ?? '').startsWith('error:'),
  )
  if (applyFailures.length > 0) {
    return {
      category: 'apply-failure',
      lever: 'robust edit-apply (heal/edit.ts)',
      detail: `${applyFailures.length} replace_in_spec edit(s) failed to apply (old-string didn't match)`,
    }
  }

  // 6. The model never had usable evidence — every accessibility snapshot was unrendered.
  //    This is the key bucket: it couldn't see the real controls, so any fix is a guess.
  const grounding = steps.filter((s) => s.name === 'get_accessibility')
  if (grounding.length > 0 && grounding.every((s) => isUnrendered(s.result))) {
    return {
      category: 'grounding-empty',
      lever:
        'render-settle / grounding — get_accessibility snapshotted before the async render',
      detail: `${grounding.length}/${grounding.length} get_accessibility snapshots were unrendered (loading/empty)`,
    }
  }

  // 7. The edit applied but the test is still RED — the fix missed the upstream cause.
  const appliedOk = steps.some(
    (s) => s.name === 'replace_in_spec' && (s.result ?? '') === 'ok',
  )
  if (appliedOk && r.includes('still red')) {
    return {
      category: 'still-red-wrong-fix',
      lever: 're-localize / reflexion — the edit missed the upstream cause',
      detail: 'an edit applied cleanly but the test is still RED — wrong fix',
    }
  }

  // 8. The model never committed an edit — the verdict was vacuous.
  if (r.includes('no edit') || r.includes('vacuous')) {
    return {
      category: 'vacuous-no-edit',
      lever: 'stronger failure evidence / enforce an edit',
      detail: `no edit was made (vacuous): ${reason}`,
    }
  }

  // 9. Nothing matched — fall back to a human reading the dump.
  return {
    category: 'unknown',
    lever: 'inspect the --dump trace',
    detail: `unclassified failure: ${reason}`,
  }
}
