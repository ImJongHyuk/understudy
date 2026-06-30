/**
 * heal/heal-loop — the PRODUCT Healer loop, shared by the measurement harness
 * (scripts/a3-heal-measure.ts) and the real-break demo (scripts/heal-real-break.ts) so both drive
 * the SAME agentic path: failure-in → tool-driven root-cause → patch-out, with the LLM NEVER in the
 * gate (INV-1 — it only proposes; the deterministic gate is the oracle, applied by the caller's
 * `score`). The skill (Plane A) is passed in so each caller can compose its own base⊕overlay.
 *
 * R3 (Reflexion): a still-RED edit forces a re-think of the UPSTREAM step. R4 (no-vacuous): a
 * prose-only stop without an edit is nudged once. These are generic loop mechanics, not skill text.
 */
import type { LlmBridge, ToolSchema } from '../llm'
import type { HealTools } from './real-tools'
import type { StepRecord } from './diagnostics'

export const HEAL_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'run_test',
    description: 'Run the failing test and return whether it now passes plus the output/error.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_accessibility',
    description:
      'Return the accessibility tree (roles + names) of the app page at the given path, so you can find the REAL control the test should target.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'app path, e.g. "/"' } },
      required: ['path'],
    },
  },
  {
    name: 'replace_in_spec',
    description:
      'Replace an exact substring in the test file with a corrected one. Returns ok or an error if the old substring was not found.',
    parameters: {
      type: 'object',
      properties: {
        old: { type: 'string', description: 'exact substring currently in the test' },
        replacement: { type: 'string', description: 'the corrected substring' },
      },
      required: ['old', 'replacement'],
    },
  },
]

/** Drive the Healer to GREEN (or give up after maxSteps). The caller scores the result with the
 * deterministic gate afterwards — this loop never decides pass/fail. Returns the per-step trace
 * (run_test / get_accessibility / replace_in_spec) for diagnosis (--dump). */
export async function runHealLoop(bridge: LlmBridge, tools: HealTools, skill: string, maxSteps = 6): Promise<StepRecord[]> {
  const steps: StepRecord[] = []
  const first = await tools.run_test()
  steps.push({ name: 'run_test', result: `passed=${first.passed}\n${first.output}` })
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: skill },
    {
      role: 'user',
      content:
        `The failing test file:\n\n\`\`\`ts\n${tools.getSpec()}\n\`\`\`\n\n` +
        `Initial run_test result: passed=${first.passed}\n${first.output}\n\nHeal it.`,
    },
  ]
  let editsMade = false
  let nudged = false
  for (let step = 0; step < maxSteps; step++) {
    const turn = await bridge.complete(messages, HEAL_TOOL_SCHEMAS)
    if (turn.toolCalls.length === 0) {
      // R4 (no-vacuous): don't accept a prose-only stop without an edit — nudge once.
      if (!editsMade && !nudged) {
        nudged = true
        messages.push({
          role: 'user',
          content:
            'You ended without any edit. You MUST call replace_in_spec to fix the cause — re-examine the ' +
            'UPSTREAM steps (a wrong click/navigation), not just the failing assertion. Make the edit now.',
        })
        continue
      }
      return steps
    }
    messages.push(turn.raw)
    let reflect = false
    for (const call of turn.toolCalls) {
      let result: string
      try {
        if (call.name === 'run_test') {
          const r = await tools.run_test()
          result = `passed=${r.passed}\n${r.output}`
          if (r.passed) {
            steps.push({ name: call.name, args: call.args as Record<string, unknown>, result })
            messages.push({ role: 'tool', tool_call_id: call.id, content: result })
            return steps
          }
          if (editsMade) reflect = true // R3: still RED after an edit → force a re-think
        } else if (call.name === 'get_accessibility') {
          result = await tools.get_accessibility(String(call.args.path ?? '/'))
        } else if (call.name === 'replace_in_spec') {
          const r = await tools.replace_in_spec(String(call.args.old ?? ''), String(call.args.replacement ?? ''))
          result = r.ok ? 'ok' : `error: ${r.error}`
          if (r.ok) editsMade = true
        } else {
          result = `unknown tool: ${call.name}`
        }
      } catch (e) {
        result = `tool error: ${(e as Error).message}`
      }
      steps.push({ name: call.name, args: call.args as Record<string, unknown>, result })
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
    if (reflect) {
      // R3 (Reflexion, specialized): a still-RED post-edit means the edit missed the cause.
      messages.push({
        role: 'user',
        content:
          'Still RED after your edit — it did not address the cause. Which EARLIER step (a click, a ' +
          'navigation, a missing setup) put the page in a state where the assertion cannot pass? Reconsider ' +
          'that upstream step, not the assertion.',
      })
    }
  }
  return steps
}
