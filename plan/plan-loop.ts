/**
 * plan/plan-loop — understudy's OWN Planner loop: explore a running app and author a focused, non-vacuous
 * test plan, driven by the `llm/` bridge (any model). The planning analogue of gen/gen-loop, but with NO
 * run_test gate — a plan is not executable. The only deterministic check is `isVacuousPlan` (structure);
 * the plan's real verification is DOWNSTREAM (the Generator turns each scenario into a gated spec).
 * Model-agnostic: understudy plans with any model on its OWN runtime — Claude Code is not required.
 */
import type { LlmBridge, ToolSchema } from '../llm'
import { type PlanTools, isVacuousPlan } from './plan-tools'

export const PLAN_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'get_accessibility',
    description:
      'Return the accessibility tree (roles + names) of the LIVE app page at the given path, so you can ' +
      'ground the plan in real controls before writing it. Call it as many times as you need.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'app path, e.g. "/" or "/projects/1"' } },
      required: ['path'],
    },
  },
  {
    name: 'write_plan',
    description:
      'Write the complete test plan as markdown (overwrites the previous write). Call it once you have ' +
      'grounded enough; the plan must contain concrete, independent scenarios with numbered steps.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string', description: 'the complete plan markdown' } },
      required: ['content'],
    },
  },
]

export interface PlanStep {
  readonly name: string
  readonly arg: string
}

export interface PlanOutcome {
  readonly wrote: boolean
  /** A non-vacuous plan was written (passed the light structural check). */
  readonly ok: boolean
  readonly steps: PlanStep[]
}

/** Drive the Planner to a non-vacuous plan, or give up after maxSteps. */
export async function runPlanLoop(
  bridge: LlmBridge,
  tools: PlanTools,
  skill: string,
  goal: string,
  maxSteps = 10,
): Promise<PlanOutcome> {
  const steps: PlanStep[] = []
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: skill },
    { role: 'user', content: goal },
  ]
  let wrote = false
  let ok = false
  let nudged = false
  let groundCount = 0
  const GROUND_CAP = 4

  for (let step = 0; step < maxSteps; step++) {
    const turn = await bridge.complete(messages, PLAN_TOOL_SCHEMAS)
    if (turn.toolCalls.length === 0) {
      if (!ok && !nudged) {
        nudged = true
        messages.push({
          role: 'user',
          content: 'You did not write a non-vacuous plan. Ground via get_accessibility if needed, then call write_plan with concrete scenarios.',
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
        } else if (call.name === 'write_plan') {
          const content = String(call.args.content ?? '')
          const r = await tools.write_plan(content)
          wrote = r.ok
          if (r.ok && isVacuousPlan(content)) {
            result =
              'rejected: the plan is empty/generic (no concrete scenarios with numbered steps grounded ' +
              'in real controls). Explore more if needed, then write_plan a real plan.'
            steps.push({ name: 'write_plan', arg: 'VACUOUS' })
          } else {
            ok = r.ok
            result = r.ok ? 'ok — plan written.' : `error: ${r.error}`
            steps.push({ name: 'write_plan', arg: r.ok ? `${content.length} chars` : 'error' })
          }
        } else {
          result = `unknown tool: ${call.name}`
        }
      } catch (e) {
        result = `tool error: ${(e as Error).message}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
    if (ok) break
    if (!wrote && groundCount >= GROUND_CAP) {
      messages.push({
        role: 'user',
        content: 'You have observed the app enough. Call write_plan NOW with concrete, grounded scenarios.',
      })
    }
  }
  return { wrote, ok, steps }
}
