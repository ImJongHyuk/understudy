/**
 * heal/escalate — a PURE escalation policy: given a finished rollout's triage, decide whether and how
 * to escalate the NEXT attempt. Where heal/triage NAMES the next lever, this DECIDES whether that
 * lever is safe to auto-apply in a bounded retry. The honest, conservative scope is the whole point:
 * we ONLY auto-apply levers that deterministically change the EVIDENCE BUDGET (the render-settle
 * window) or do a transient retry — never anything that could change the gate's verdict (INV-1: the
 * deterministic gate stays the sole oracle, the LLM only proposes). Categories that need a human /
 * skill / code change, or whose cheap in-loop levers (R3 reflexion / R4 nudge) are already exhausted,
 * do NOT auto-retry: a blind resample of a stochastic model just burns budget (best-of-N is
 * intentionally deferred elsewhere). Pure (no I/O) → conformance-verifiable.
 */
import type { TriageResult } from './triage'
import type { SettleConfig } from './settle'

/** The settle ceilings the escalation may bump toward — mirrors heal/settle.ts SETTLE_BOUNDS upper
 * bounds. resolveSettle clamps authoritatively at apply time; we respect them here so the returned
 * partial is already legible (it never proposes a value the resolver would have to walk back). */
const CAP_MS_CEILING = 30_000
const NETWORKIDLE_MS_CEILING = 20_000

export interface EscalationPlan {
  readonly retry: boolean            // retry the whole rollout?
  readonly settle?: Partial<SettleConfig>  // settle-budget override merged into next attempt's target (undefined = unchanged)
  readonly note: string              // human-readable why
}

/** Pure: given a triage result + the current settle budget + the attempt index, decide whether/how to
 * escalate the NEXT attempt. ONLY deterministic, evidence-budget / transient-retry levers are
 * auto-applied — never anything that changes the gate's verdict (INV-1). Categories needing a
 * human/skill/code change (forbidden-move, dropped-assertion, apply-failure) or whose cheap in-loop
 * levers (R3 reflexion / R4 nudge) are already exhausted (still-red-wrong-fix, vacuous-no-edit) do
 * NOT auto-retry — a blind resample just burns budget (best-of-N is intentionally deferred elsewhere). */
export function planEscalation(triage: TriageResult, current: SettleConfig, attempt: number): EscalationPlan {
  switch (triage.category) {
    // The model had no rendered evidence (every grounding snapshot was loading/empty). This is the
    // ONE quality bucket worth an auto-retry: bumping the render budget deterministically gives the
    // NEXT snapshot more time to paint the real controls — it changes the evidence, never the verdict.
    case 'grounding-empty': {
      const capMs = Math.min(current.capMs * 2, CAP_MS_CEILING)
      const networkidleMs = Math.min(Math.round(current.networkidleMs * 1.5), NETWORKIDLE_MS_CEILING)
      // If we're already at the ceiling, a retry would re-run with an IDENTICAL budget — terminate
      // instead so the loop can't spin burning budget on a guaranteed-same evidence window.
      if (capMs === current.capMs && networkidleMs === current.networkidleMs) {
        return { retry: false, note: 'render budget already maxed — no further escalation' }
      }
      return {
        retry: true,
        settle: { capMs, networkidleMs }, // quietMs unchanged — the wait-for-quiet shape is fine, only the budget was short
        note: `grounding-empty (attempt ${attempt}): model had no rendered evidence; doubling render budget (capMs ${current.capMs}→${capMs}, networkidleMs ${current.networkidleMs}→${networkidleMs}) and retrying`,
      }
    }

    // A provider/timeout error before any verdict — not a model-quality signal. A plain retry of the
    // unchanged rollout is the right lever (the resilient bridge already breaks/falls back internally).
    case 'loop-error':
      return { retry: true, note: `loop-error (attempt ${attempt}): transient loop/provider error; retrying unchanged` }

    // The gate accepted the heal — there is nothing to escalate.
    case 'healed':
      return { retry: false, note: 'healed — no escalation needed' }

    // Anti-cheat / apply mechanics: a forbidden move, a gutted load-bearing assertion, or an edit
    // that never landed. None of these is fixed by more evidence or a resample — they need a skill /
    // code / human change, so auto-retrying would only burn budget.
    case 'forbidden-move':
      return { retry: false, note: 'forbidden-move: needs a skill anti-cheat change, not a retry' }
    case 'dropped-assertion':
      return { retry: false, note: 'dropped-assertion: needs a skill anti-cheat change, not a retry' }
    case 'apply-failure':
      return { retry: false, note: 'apply-failure: needs a code change to edit-apply, not a retry' }

    // Cheap in-loop levers already exhausted: still-red-wrong-fix has already run R3 (reflexion) and
    // vacuous-no-edit has already run R4 (the no-edit nudge). A blind resample of the same stochastic
    // model is the deferred best-of-N — not an auto-applied lever here.
    case 'still-red-wrong-fix':
      return { retry: false, note: 'still-red-wrong-fix: R3 reflexion already ran in-loop; a blind resample is deferred best-of-N, not auto-applied' }
    case 'vacuous-no-edit':
      return { retry: false, note: 'vacuous-no-edit: R4 nudge already ran in-loop; a blind resample is deferred best-of-N, not auto-applied' }

    // Unclassified — defer to a human reading the --dump trace; do not guess a lever.
    case 'unknown':
    default:
      return { retry: false, note: 'unknown failure: needs a human to read the --dump trace, not an auto-retry' }
  }
}
