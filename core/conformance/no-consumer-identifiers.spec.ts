/**
 * no-consumer-identifiers CONFORMANCE / mutation proofs — the OSS regression guard.
 *
 * Two layers:
 *  1. MECHANISM (this file) — proven against SYNTHETIC, fake denylist tokens, so the
 *     spec itself ships ZERO real internal names. Inject a fake identifier → REJECT;
 *     generic source → clean; evasions (concat/newline-split, separator-narrowing,
 *     whitespace-rigid) all caught; generic vocabulary never fabricates a hit.
 *  2. THE REAL GATE — scan the actual `core/` with the CONSUMER-SUPPLIED denylist
 *     (`loadForbiddenPatterns`) and assert ZERO hits. With no denylist configured
 *     (e.g. public CI) it is a no-op; on a maintainer's machine the gitignored
 *     `.understudy-forbidden.local` supplies the real names and proves none leaked.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  scanForbidden,
  scanCoreDir,
  scanPublishableTree,
  compileToken,
  compileDenylist,
  loadForbiddenPatterns,
} from '../no-consumer-identifiers'

// Synthetic denylist — purely fake tokens (never real internal names). Covers a
// single-word token, a hyphen-joined multi-segment token, and a space-joined one.
const FAKE = 'zphantomcorp, acme-pipeline, Secret Console, zz-inc'
const P = compileDenylist(FAKE)

test.describe('conformance: no-consumer-identifiers mechanism (mutation-proven, synthetic tokens)', () => {
  test('rejects a denylisted identifier embedded in a string', () => {
    expect(scanForbidden('const v = "zphantomcorp-dev"', P).length).toBeGreaterThan(0)
  })

  test('rejects a denylisted identifier embedded in a COMMENT (would leak in published source)', () => {
    expect(scanForbidden('// adapter for the zphantomcorp console', P).length).toBeGreaterThan(0)
  })

  test('PASSES generic source (no false positive)', () => {
    expect(scanForbidden('const ok = "generic"', P)).toEqual([])
  })

  test('reports the matching pattern + 1-based line, never the offending source', () => {
    const hits = scanForbidden('line one is clean\nconst x = "zz-inc"', P)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].line).toBe(2)
    // Output carries the PATTERN source, not the surrounding code.
    expect(hits.some((h) => h.pattern.includes('zz'))).toBe(true)
  })

  test('each compiled pattern is self-detecting (the list is wired, not dead)', () => {
    for (const re of P) {
      // A literal-ish sample that satisfies the pattern: collapse the separator
      // class to one '-', a bare `\s+` to a space, then drop residual metachars.
      const sample = re.source
        .replace(/\[[-_.\\s/]+\]\+?/g, '-') // [-_.\s/]+ → one separator
        .replace(/\\s\+?/g, ' ') // bare \s / \s+ → a real space
        .replace(/[\\+]/g, '') // leftover backslashes / quantifiers
      expect(scanForbidden(sample, [re]).length).toBeGreaterThan(0)
    }
  })

  test('rejects a newline/concat-split token (string concatenation across lines)', () => {
    // `"zphan" +\n "tomcorp"` — split across a newline via `+` concat. A per-line
    // scan would never see `zphantomcorp`; the normalized projection re-joins it.
    const src = 'const v =\n  "zphan" +\n  "tomcorp"'
    expect(scanForbidden(src, P).some((h) => h.pattern.includes('zphantomcorp'))).toBe(true)
  })

  test('rejects a token wrapped across lines inside a template literal', () => {
    const src = 'const v = `zphan' + '\n' + 'tomcorp`'
    expect(scanForbidden(src, P).some((h) => h.pattern.includes('zphantomcorp'))).toBe(true)
  })

  test('rejects "Secret Console" with two-space and tab separators (whitespace-rigid evasion)', () => {
    expect(scanForbidden('label = "Secret  Console"', P).length).toBeGreaterThan(0)
    expect(scanForbidden('label = "Secret\tConsole"', P).length).toBeGreaterThan(0)
    expect(scanForbidden('label = "Secret\nConsole"', P).length).toBeGreaterThan(0)
  })

  test('rejects "acme pipeline" joined by a space and by slashes (separator-narrow evasion)', () => {
    expect(scanForbidden('const a = "acme pipeline"', P).length).toBeGreaterThan(0)
    expect(scanForbidden('const p = "/acme/pipeline/"', P).length).toBeGreaterThan(0)
  })

  test('PASSES generic vocabulary the normalized scan must NOT fabricate hits from', () => {
    // Concatenation/whitespace collapse must not glue innocent words into a token.
    expect(scanForbidden('const url = "knowledge" + "base"', P)).toEqual([])
    expect(scanForbidden('// a console for the knowledge base', P)).toEqual([])
    expect(scanForbidden('const sum = a + b + c', P)).toEqual([])
    expect(scanForbidden('const s = "sea" + "horse"', P)).toEqual([])
    expect(scanForbidden('render the\nConsole component', P)).toEqual([])
  })
})

test.describe('conformance: denylist loader (env / file / local precedence)', () => {
  test('compileToken: blanks and # comments compile to null; tokens compile', () => {
    expect(compileToken('')).toBeNull()
    expect(compileToken('   ')).toBeNull()
    expect(compileToken('# a comment')).toBeNull()
    expect(compileToken('acme-pipeline')).not.toBeNull()
  })

  test('compileDenylist: empty input → no patterns; mixed input → only real tokens', () => {
    expect(compileDenylist('')).toEqual([])
    const pats = compileDenylist('# header\n\nzphantomcorp\nacme-pipeline')
    expect(pats.length).toBe(2)
    expect(scanForbidden('x zphantomcorp y', pats).length).toBeGreaterThan(0)
  })

  test('loadForbiddenPatterns: inline env var is honored', () => {
    const saved = process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS
    const savedFile = process.env.UNDERSTUDY_FORBIDDEN_FILE
    try {
      delete process.env.UNDERSTUDY_FORBIDDEN_FILE
      process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS = 'zphantomcorp'
      const pats = loadForbiddenPatterns()
      expect(scanForbidden('the zphantomcorp service', pats).length).toBeGreaterThan(0)
    } finally {
      if (saved === undefined) delete process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS
      else process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS = saved
      if (savedFile !== undefined) process.env.UNDERSTUDY_FORBIDDEN_FILE = savedFile
    }
  })

  test('loadForbiddenPatterns: file path is honored', () => {
    const saved = process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS
    const savedFile = process.env.UNDERSTUDY_FORBIDDEN_FILE
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-deny-'))
    const file = path.join(dir, 'denylist.txt')
    fs.writeFileSync(file, '# fixture\nzphantomcorp\n')
    try {
      delete process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS
      process.env.UNDERSTUDY_FORBIDDEN_FILE = file
      const pats = loadForbiddenPatterns()
      expect(scanForbidden('x zphantomcorp', pats).length).toBeGreaterThan(0)
    } finally {
      if (saved !== undefined) process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS = saved
      if (savedFile === undefined) delete process.env.UNDERSTUDY_FORBIDDEN_FILE
      else process.env.UNDERSTUDY_FORBIDDEN_FILE = savedFile
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('loadForbiddenPatterns: nothing configured → empty (a public no-op, not a failure)', () => {
    const saved = process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS
    const savedFile = process.env.UNDERSTUDY_FORBIDDEN_FILE
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-empty-'))
    try {
      delete process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS
      delete process.env.UNDERSTUDY_FORBIDDEN_FILE
      expect(loadForbiddenPatterns(emptyDir)).toEqual([])
    } finally {
      if (saved !== undefined) process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS = saved
      if (savedFile !== undefined) process.env.UNDERSTUDY_FORBIDDEN_FILE = savedFile
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})

test.describe('conformance: the REAL core/ is free of consumer identifiers', () => {
  test('scanning core/ with the configured denylist yields ZERO hits', () => {
    // No denylist configured (public CI) → no-op pass. With the maintainer's
    // gitignored `.understudy-forbidden.local` present, this scans core/ with the
    // real internal names and proves none leaked into published source.
    const offenders = scanCoreDir(path.resolve(process.cwd(), 'core'), loadForbiddenPatterns())
    expect(offenders, JSON.stringify(offenders)).toEqual([])
  })
})

test.describe('conformance: the WHOLE publishable tree is free of consumer identifiers', () => {
  test('scanning core/ + heal/ + adapters/ + scripts/ + llm/ + docs/ + .github/ + root docs yields ZERO hits', () => {
    // The OSS-readiness guard: the entire harness ships, not just core/, and a name slips into PROSE
    // (docs) more easily than into typed code. No denylist configured (public CI) → no-op pass; with
    // the maintainer's gitignored denylist it proves nothing internal leaked anywhere publishable.
    const offenders = scanPublishableTree(process.cwd(), loadForbiddenPatterns())
    // Report file:line ONLY on failure — never the matched token (it is a private identifier).
    const where = offenders.flatMap((o) => o.hits.map((h) => `${o.file}:${h.line}`))
    expect(where, where.join('\n')).toEqual([])
  })
})
