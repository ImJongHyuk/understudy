/**
 * heal/optimizer-prompt — the optimizer's localize-awareness note, as a tested, versioned prompt
 * artifact (not an inline string).
 *
 * When the grounded-localize harness (levers C/D) is active, the optimizer must KNOW it exists —
 * otherwise it cannot author skill text that exploits the failure page-state evidence, which is the
 * exact framing the hand-authored skill has and a BLIND optimizer cannot invent. Round 2 of the
 * learning e1 closed the learned↔hand gap with this note ON, but three levers moved together
 * (n, epochs, awareness). `aware=false` is the FACTORIAL CONTROL: holding budget fixed (same n /
 * epochs / rollout-localize) and removing only the note isolates whether the awareness SIGNAL — not
 * the extra search — is what taught the gate the root-cause skill. The note teaches the GENERAL
 * backward-trace routine, never an app-specific answer (the held-out gate still disposes — INV-1 at
 * the meta level). Pure (no I/O) so it is conformance-verifiable without a run.
 */
export function buildOptimizerLocalizeNote(localizeEnabled: boolean, aware: boolean): string {
  if (!localizeEnabled || !aware) return ''
  return (
    '\n\nThe healer runs under a REQUIRED localize step: before every replace_in_spec it must call ' +
    '`localize` with the failing assertion, the EARLIEST upstream step whose result is wrong, the ' +
    'evidence, and the planned edit. run_test returns the page accessibility snapshot AT the moment ' +
    'of failure — concrete evidence of what the steps actually produced. The skills that pass the ' +
    'hard (flow) cases TEACH the agent to use that failure snapshot: trace BACKWARD from the failing ' +
    'assertion to the FIRST step whose resulting page-state diverged from what the test intends ' +
    '(e.g. a navigation or click that left the app on the wrong page/view), and fix THAT upstream ' +
    'step — never relax the assertion. A skill that only talks about matching locator names will ' +
    'keep failing the flow cases. Make the revised skill instruct the agent to perform this ' +
    'evidence-grounded backward trace.'
  )
}
