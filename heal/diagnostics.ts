/**
 * heal/diagnostics — render a heal rollout as a readable step trace (localize / edit / run_test),
 * so a stuck flavor can be DIAGNOSED from what the model actually did, not guessed. The campaign
 * principle is analysis-first: before adding a lever for a capped flavor (e.g. nav-settings ~50%),
 * observe the rollouts — does the model localize the wrong upstream step, apply the wrong fix, or
 * never get usable evidence? Pure (no I/O) so it is conformance-verifiable. The caller (the
 * optimizer/eval harness) collects the steps; this just formats them.
 */
export interface StepRecord {
  readonly name: string
  readonly args?: Record<string, unknown>
  readonly result?: string
}

export interface RolloutTrace {
  readonly brkId: string
  readonly passed: boolean
  readonly reason: string
  readonly steps: ReadonlyArray<StepRecord>
}

/** Collapse whitespace and clip to `n` chars (trace lines stay scannable; evidence blobs truncate). */
function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

/** One rollout → a compact, human-scannable trace: a PASS/FAIL header + one line per tool step,
 * with the localize's upstream/plan and the edit's old→new spelled out (those are the diagnosis). */
export function formatRolloutTrace(t: RolloutTrace): string {
  const head = `### ${t.brkId} — ${t.passed ? 'PASS' : 'FAIL'} (${t.reason})`
  const lines = t.steps.map((s, i) => {
    const n = `${i + 1}. ${s.name}`
    const a = s.args ?? {}
    if (s.name === 'localize') {
      return `${n}  upstream="${clip(String(a.upstream_step ?? ''), 120)}" planned="${clip(String(a.planned_edit ?? ''), 120)}" => ${clip(s.result ?? '', 60)}`
    }
    if (s.name === 'replace_in_spec') {
      return `${n}  old="${clip(String(a.old ?? ''), 80)}" -> new="${clip(String(a.replacement ?? ''), 80)}" => ${clip(s.result ?? '', 40)}`
    }
    if (s.name === 'run_test') {
      return `${n}  => ${clip(s.result ?? '', 200)}`
    }
    return `${n}  ${clip(JSON.stringify(a), 60)} => ${clip(s.result ?? '', 160)}`
  })
  return [head, ...lines].join('\n')
}
