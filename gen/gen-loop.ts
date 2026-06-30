/**
 * gen/gen-loop — understudy's OWN Generator loop: failure-free authoring of a gate-passing,
 * non-vacuous Playwright spec, driven by the `llm/` bridge (any model) against the deterministic gate.
 * The generation analogue of `heal/heal-loop.ts`: the LLM is NEVER the oracle (INV-1) — it only
 * proposes (write_spec); pass/fail is decided by `run_test` (Playwright + the non-vacuous check). The
 * skill (Plane A) is passed in so the caller composes base ⊕ overlay (`skills/load-skill.ts`).
 *
 * Mechanics (not skill text): after enough grounding the model is pushed to write; a passing-but-VACUOUS
 * spec is rejected so a cheap model can't game the oracle; a still-RED run loops back to fix.
 */
import type { LlmBridge, ToolSchema } from '../llm'
import type { GenTools } from './gen-tools'

export const GEN_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'get_accessibility',
    description:
      'Return the accessibility tree (roles + names) of the LIVE app page at the given path, so you ' +
      'can ground real locators before writing the test. Call it as many times as you need.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'app path, e.g. "/" or "/projects/1"' } },
      required: ['path'],
    },
  },
  {
    name: 'write_spec',
    description:
      'Write the candidate Playwright spec (overwrites the previous write). After writing, call ' +
      'run_test to verify; fix and re-write if it fails.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string', description: 'the complete .spec.ts source' } },
      required: ['content'],
    },
  },
  {
    name: 'run_test',
    description:
      'Run the spec you wrote and return whether it PASSES (and is non-vacuous) plus the error output. ' +
      'The task is complete only when this is a real pass. If it fails, read the error, fix via ' +
      'write_spec, and run again.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
]

export interface GenStep {
  readonly name: string
  readonly arg: string
}

export interface GenOutcome {
  readonly wrote: boolean
  /** A REAL pass: Playwright green AND non-vacuous. */
  readonly verified: boolean
  readonly steps: GenStep[]
}

/**
 * Drive the Generator to a real (non-vacuous) GREEN, or give up after maxSteps. Mirrors runHealLoop:
 * the loop never decides trust — `run_test` (the gate) does. Returns the per-step trace for diagnosis.
 *
 * `singleShot`: end the loop after the FIRST real run_test (pass OR fail OR vacuous) — no fix iteration.
 * This measures the FIRST-WRITE quality of the skill (a fix loop lets a weak skill iterate its way to
 * green, masking the skill's gradient — see docs/CONTRACT-LESSONS.md L26). Use a small maxSteps with it.
 */
export async function runGenLoop(
  bridge: LlmBridge,
  tools: GenTools,
  skill: string,
  task: string,
  maxSteps = 14,
  singleShot = false,
): Promise<GenOutcome> {
  const steps: GenStep[] = []
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: skill },
    { role: 'user', content: task },
  ]
  let wrote = false
  let verified = false
  let ranOnce = false // a real run_test (wrote==true) executed — the "shot" in single-shot mode
  let nudged = false
  let groundCount = 0
  const GROUND_CAP = 4

  for (let step = 0; step < maxSteps; step++) {
    const turn = await bridge.complete(messages, GEN_TOOL_SCHEMAS)
    if (turn.toolCalls.length === 0) {
      if (!verified && !nudged) {
        nudged = true
        messages.push({
          role: 'user',
          content: wrote
            ? 'You wrote a spec but did not verify it — call run_test now; if it fails, fix via write_spec and run again.'
            : 'You did not call write_spec. Ground via get_accessibility if needed, then write_spec, then run_test.',
        })
        continue
      }
      break
    }
    messages.push(turn.raw)
    for (const call of turn.toolCalls) {
      if (call.name === 'get_accessibility') groundCount++
      let result: string
      try {
        if (call.name === 'get_accessibility') {
          result = await tools.get_accessibility(String(call.args.path ?? '/'))
          steps.push({ name: 'get_accessibility', arg: String(call.args.path ?? '/') })
        } else if (call.name === 'write_spec') {
          const r = await tools.write_spec(String(call.args.content ?? ''))
          wrote = r.ok
          result = r.ok ? 'ok — spec written. Now call run_test to verify it passes.' : `error: ${r.error}`
          steps.push({ name: 'write_spec', arg: `${String(call.args.content ?? '').length} chars` })
        } else if (call.name === 'run_test') {
          if (!wrote) {
            result = 'no spec written yet — call write_spec first.'
          } else {
            const r = await tools.run_test()
            ranOnce = true
            if (r.passed && r.vacuous) {
              result =
                'passed=false (VACUOUS) — the spec passes but does not exercise the behaviour: it ' +
                'performs no user action (click/fill/check) and/or asserts on a constant. Rewrite it to ' +
                'PERFORM the action and ASSERT on the resulting app state, then run_test again.'
              steps.push({ name: 'run_test', arg: 'VACUOUS' })
            } else {
              verified = r.passed
              result = `passed=${r.passed}\n${r.output}`
              steps.push({ name: 'run_test', arg: r.passed ? 'PASS' : 'FAIL' })
            }
          }
        } else {
          result = `unknown tool: ${call.name}`
        }
      } catch (e) {
        result = `tool error: ${(e as Error).message}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
    if (verified || (singleShot && ranOnce)) break
    if (!wrote && groundCount >= GROUND_CAP) {
      messages.push({
        role: 'user',
        content:
          'You have observed the app enough. Do NOT call get_accessibility again. Call write_spec NOW, then run_test.',
      })
    }
  }
  return { wrote, verified, steps }
}
