/**
 * skills/ — the Plane A "skill" artifacts and their loader. A skill is a version-controlled
 * markdown document that makes a swappable LLM produce gate-passing work; the deterministic gate
 * (Plane B) is the verifier that scores it. This loader composes the effective skill as
 * BASE ⊕ OVERLAY, mirroring understudy's generic-core / per-project-adapter split:
 *
 *   - BASE   (`skills/heal.skill.md`) — project-agnostic, OSS-clean, the shared core skill.
 *   - OVERLAY (`adapters/<project>/heal.overlay.md`, optional) — per-project knowledge
 *     (its real flows, control vocabulary, common root-causes), composed AFTER the base.
 *
 * v0 skills are hand-authored; later they can be LEARNED against the gate (SkillOpt-style) — the
 * gate is exactly the verifier such an optimizer needs. This loader is pure + deterministic.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The base heal skill, resolved next to this module (cwd-independent). */
export const BASE_HEAL_SKILL = path.resolve(HERE, 'heal.skill.md')

/** The base generate skill, resolved next to this module (cwd-independent). */
export const BASE_GENERATE_SKILL = path.resolve(HERE, 'generate.skill.md')

/** The base plan skill, resolved next to this module (cwd-independent). */
export const BASE_PLAN_SKILL = path.resolve(HERE, 'plan.skill.md')

/** Strip HTML comments (maintainer-only notes) so only model-facing content remains. */
export function stripSkillComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '').trim()
}

export interface SkillOptions {
  /** Path to a per-project overlay (`heal.overlay.md`), composed AFTER the base. Ignored if absent. */
  readonly overlayPath?: string
  /** Override the base skill path (tests / alternate base). */
  readonly basePath?: string
}

/**
 * Compose the effective heal skill = BASE ⊕ OVERLAY. The base is always present; an overlay is
 * appended only if `overlayPath` is given AND the file exists and is non-empty. Returns the
 * model-facing system-prompt string (comments stripped).
 */
export function loadHealSkill(opts: SkillOptions = {}): string {
  return composeSkill(opts.basePath ?? BASE_HEAL_SKILL, opts.overlayPath)
}

/**
 * Compose the effective GENERATE skill = BASE ⊕ OVERLAY (same contract as `loadHealSkill`). The
 * generation analogue of the heal skill: the Plane A document the Generator loop (`gen/gen-loop.ts`)
 * runs as its system prompt, model-agnostic, graded by the deterministic gate.
 */
export function loadGenerateSkill(opts: SkillOptions = {}): string {
  return composeSkill(opts.basePath ?? BASE_GENERATE_SKILL, opts.overlayPath)
}

/**
 * Compose the effective PLAN skill = BASE ⊕ OVERLAY (same contract as the others). The Plane A document
 * the Planner loop (`plan/plan-loop.ts`) runs as its system prompt, model-agnostic.
 */
export function loadPlanSkill(opts: SkillOptions = {}): string {
  return composeSkill(opts.basePath ?? BASE_PLAN_SKILL, opts.overlayPath)
}

/** BASE ⊕ OVERLAY composition shared by the heal and generate loaders. */
function composeSkill(basePath: string, overlayPath?: string): string {
  const base = stripSkillComments(fs.readFileSync(basePath, 'utf-8'))
  if (overlayPath && fs.existsSync(overlayPath)) {
    const overlay = stripSkillComments(fs.readFileSync(overlayPath, 'utf-8'))
    if (overlay) return `${base}\n\n## Project-specific overlay\n\n${overlay}`
  }
  return base
}
