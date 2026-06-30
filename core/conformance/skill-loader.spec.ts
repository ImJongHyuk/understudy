/**
 * skills/load-skill conformance — the heal skill is a first-class artifact composed as
 * BASE ⊕ OVERLAY. Deterministic + pure-ish (reads the committed base file). Proves: the base
 * loads and is model-facing-clean (HTML maintainer comments stripped, R1 wiring present); an
 * overlay is appended only when present; a missing overlay yields base-only.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHealSkill, stripSkillComments, BASE_HEAL_SKILL } from '../../skills/load-skill'

test.describe('conformance: heal skill loader (base ⊕ overlay)', () => {
  test('the committed base skill exists and is non-empty', () => {
    expect(fs.existsSync(BASE_HEAL_SKILL)).toBe(true)
    expect(loadHealSkill().length).toBeGreaterThan(200)
  })

  test('the base carries the root-cause wiring (R1) and the no-vacuous rule (R4)', () => {
    const skill = loadHealSkill()
    expect(skill).toContain('NOT the line to fix')
    expect(skill).toContain('EARLIEST wrong step')
    expect(skill).toMatch(/at least one .*replace_in_spec.* edit/)
  })

  test('maintainer HTML comments are stripped from the model-facing skill', () => {
    expect(stripSkillComments('<!-- note -->keep<!--\nmulti\n-->this')).toBe('keepthis')
    expect(loadHealSkill()).not.toContain('<!--')
    expect(loadHealSkill()).not.toContain('OSS-clean') // a maintainer-note phrase inside the comment
  })

  test('a present overlay is composed AFTER the base under its own header', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-skill-'))
    const overlay = path.join(dir, 'heal.overlay.md')
    fs.writeFileSync(overlay, '<!-- private -->In THIS app the "Members" tab hides pending rows.')
    try {
      const composed = loadHealSkill({ overlayPath: overlay })
      expect(composed).toContain('## Project-specific overlay')
      expect(composed).toContain('Members" tab hides pending rows')
      expect(composed).not.toContain('<!--') // overlay comments stripped too
      // base content still present and FIRST
      expect(composed.indexOf('EARLIEST wrong step')).toBeLessThan(composed.indexOf('Members'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a missing overlay path yields the base unchanged (no header)', () => {
    const composed = loadHealSkill({ overlayPath: '/no/such/heal.overlay.md' })
    expect(composed).toBe(loadHealSkill())
    expect(composed).not.toContain('## Project-specific overlay')
  })
})
