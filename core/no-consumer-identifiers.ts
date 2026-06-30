/**
 * no-consumer-identifiers (CORE lint, OSS regression guard). The WHOLE harness is
 * destined to be published, so a single internal/consumer identifier leaking into its
 * source — in CODE *or* a COMMENT *or* DOCS — would ship in the open. This is the TESTED
 * gate that prevents that: a forbidden-pattern scan (evasion-resistant) over `core/*.ts`
 * (`scanCoreDir`) AND over the whole PUBLISHABLE tree — `core/`, `heal/`, `adapters/`,
 * `scripts/`, `llm/`, `docs/`, `.github/`, plus root docs, across `.ts/.md/.yml/.json`
 * (`scanPublishableTree`). Prose docs are where a name most easily slips in, so they are
 * scanned too, not just code.
 *
 * Pure + deterministic (LLM-free), so it is a real gate property. Mutation-proven in
 * core/conformance/no-consumer-identifiers.spec.ts.
 *
 * IMPORTANT — the denylist is CONSUMER-SUPPLIED, never hardcoded here. The whole point
 * of this guard is to keep internal names out of the published source; baking those
 * very names into this file (as a regex list) would defeat it — the leak-guard would
 * itself publish the leak. So `core/` ships the MECHANISM only; the forbidden tokens
 * come from the consumer's private environment at scan time:
 *
 *   1. `UNDERSTUDY_FORBIDDEN_IDENTIFIERS` — inline list, comma/newline-separated.
 *   2. `UNDERSTUDY_FORBIDDEN_FILE`        — path to a token-per-line file.
 *   3. `.understudy-forbidden.local`      — a gitignored file in CWD (auto-loaded).
 *   4. nothing configured                 → empty list (a public consumer with no
 *                                            internal names to guard is a valid no-op).
 *
 * See `.understudy-forbidden.example` for the format. Keep real internal tokens ONLY in
 * the private (env/gitignored) denylist — NEVER write them into `core/`.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Conventional gitignored denylist file, auto-loaded from CWD when present. */
export const LOCAL_DENYLIST_FILE = '.understudy-forbidden.local'

/** This lint's own files — historically held patterns as data; kept excluded so a
 * future synthetic test fixture here can never trip the directory scan. */
const SELF_FILES: readonly string[] = [
  'no-consumer-identifiers.ts',
  'no-consumer-identifiers.spec.ts',
]

/** Escape a literal so it is matched verbatim inside a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compile one literal denylist token into a separator-flexible, case-insensitive
 * RegExp. Runs of separator chars (`-`, `_`, `.`, `/`, whitespace) in the token become
 * a flexible `[-_.\s/]+` class, so a `acme-pipeline` entry also catches `acme pipeline`,
 * `acme/pipeline`, `acme_pipeline` (separator-narrowing evasion). A single-word token
 * stays exact. Returns null for blanks and `#` comment lines.
 */
export function compileToken(token: string): RegExp | null {
  const trimmed = token.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const segments = trimmed
    .split(/[-_.\s/]+/)
    .filter(Boolean)
    .map(escapeRegex)
  if (segments.length === 0) return null
  return new RegExp(segments.join('[-_.\\s/]+'), 'i')
}

/** Compile a comma/newline-separated list of literal tokens into patterns. */
export function compileDenylist(raw: string): RegExp[] {
  return raw
    .split(/[,\n]/)
    .map(compileToken)
    .filter((re): re is RegExp => re !== null)
}

/**
 * Resolve the consumer-supplied denylist (see file header for precedence). Returns an
 * empty list when nothing is configured — a public consumer guarding no internal names
 * is a legitimate no-op, NOT a failure.
 */
export function loadForbiddenPatterns(cwd: string = process.cwd()): RegExp[] {
  const inline = process.env.UNDERSTUDY_FORBIDDEN_IDENTIFIERS
  if (inline && inline.trim()) return compileDenylist(inline)

  const fileEnv = process.env.UNDERSTUDY_FORBIDDEN_FILE
  if (fileEnv && fs.existsSync(fileEnv)) return compileDenylist(fs.readFileSync(fileEnv, 'utf-8'))

  const local = path.resolve(cwd, LOCAL_DENYLIST_FILE)
  if (fs.existsSync(local)) return compileDenylist(fs.readFileSync(local, 'utf-8'))

  return []
}

/**
 * 1-based line number of `offset` within `text` (offset === text.length maps to
 * the final line). Used to map a whole-text/normalized hit back to its source line.
 */
function lineOf(text: string, offset: number): number {
  let line = 1
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) line++
  }
  return line
}

/**
 * Quote/backtick/`+`-stripped projection of `text`, with a back-map from each
 * projected char to its ORIGINAL offset (so a hit resolves to a real source line).
 * This defeats tokens an adversary split across lines or hid behind
 * string-concatenation: `"ac" +\n "me"` (concat) and a backtick template wrapped over
 * a newline both re-join to `acme` here.
 *
 * Whitespace handling is the `whitespace` mode:
 *   - `'collapse'` → a whitespace run becomes a single space (word boundaries
 *     survive). Catches concat-split tokens where the split was around a dropped
 *     quote/`+` (whose adjacent whitespace is removed as pure syntax), while
 *     keeping multi-word patterns honest (they still need a real separator, so a
 *     collapsed space can't fabricate one out of generic prose).
 *   - `'strip'` → ALL whitespace is removed, re-joining a token wrapped mid-word
 *     across a newline inside one literal (`` `ac⏎me` ``). Multi-word patterns
 *     simply stop matching here (no separator left), and single-word tokens are
 *     specific enough that gluing generic words into one is implausible.
 *
 * Deliberately narrow: it removes only quoting/concat syntax and whitespace. It
 * does NOT delete arbitrary characters, so it cannot conjure a forbidden token out
 * of generic vocabulary — it only re-joins one that was real but obfuscated.
 */
function projectText(
  text: string,
  whitespace: 'collapse' | 'strip',
): { projected: string; map: number[] } {
  const chars: string[] = []
  const map: number[] = []
  // After a dropped quote/concat-`+`, swallow the whitespace that follows it AND
  // retroactively drop a single space we may have just emitted before it.
  let dropAdjacentWhitespace = false
  const isWs = (c: string): boolean => /\s/.test(c)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    // String delimiters used to fragment a token across concatenated pieces.
    const isQuote = ch === '"' || ch === "'" || ch === '`'
    // A `+` acting as a concat joiner (flanked by quote/whitespace), not arithmetic.
    let isConcatPlus = false
    if (ch === '+') {
      const prevRaw = i > 0 ? text[i - 1] : ''
      const nextRaw = text[i + 1] ?? ''
      isConcatPlus =
        (prevRaw === '' || isWs(prevRaw) || /['"`]/.test(prevRaw)) &&
        (nextRaw === '' || isWs(nextRaw) || /['"`]/.test(nextRaw))
    }
    if (isQuote || isConcatPlus) {
      // Drop a space we just emitted — it only separated this fragment.
      if (chars.length > 0 && chars[chars.length - 1] === ' ') {
        chars.pop()
        map.pop()
      }
      dropAdjacentWhitespace = true
      continue
    }
    if (isWs(ch)) {
      if (whitespace === 'strip') continue
      if (dropAdjacentWhitespace) continue // whitespace glued to dropped syntax
      if (chars.length > 0 && chars[chars.length - 1] === ' ') continue // collapse run
      chars.push(' ')
      map.push(i)
      continue
    }
    dropAdjacentWhitespace = false
    chars.push(ch)
    map.push(i)
  }
  return { projected: chars.join(''), map }
}

/**
 * Return every forbidden-identifier hit in `text` (empty = clean), with the
 * matching pattern source and 1-based line number. Reports the PATTERN, never the
 * surrounding source, so the gate output never re-leaks the offending line.
 *
 * Scans the WHOLE text (not per-line) so a token straddling a newline is visible,
 * and ALSO scans two projections (quotes/backticks/`+`-concat stripped; whitespace
 * collapsed, then fully stripped) so a newline- or concat-split token is re-joined
 * and caught. A projected hit is mapped back to an approximate original line via
 * the projection's back-map. Each (pattern, line) pair is reported once.
 *
 * `patterns` defaults to the consumer-supplied denylist (`loadForbiddenPatterns`).
 */
export function scanForbidden(
  text: string,
  patterns: readonly RegExp[] = loadForbiddenPatterns(),
): { pattern: string; line: number }[] {
  const seen = new Set<string>()
  const hits: { pattern: string; line: number }[] = []
  const add = (pattern: string, line: number): void => {
    const key = `${pattern}@${line}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ pattern, line })
  }

  // The raw text plus two obfuscation-defeating projections; each carries a
  // back-map from a (projected) offset to the original source offset. The raw
  // text maps 1:1, so its back-map is the identity.
  const identity = Array.from(text, (_, i) => i)
  const collapsed = projectText(text, 'collapse')
  const stripped = projectText(text, 'strip')
  const passes: { text: string; map: number[] }[] = [
    { text, map: identity },
    { text: collapsed.projected, map: collapsed.map },
    { text: stripped.projected, map: stripped.map },
  ]

  for (const re of patterns) {
    // Fresh, global+multiline regex so every occurrence is found; stripping any
    // pre-existing `g`/`m` first avoids a stale `lastIndex` skipping a match.
    const compiled = new RegExp(re.source, `${re.flags.replace(/[gm]/g, '')}gm`)
    for (const { text: hay, map } of passes) {
      for (const m of hay.matchAll(compiled)) {
        const origOffset = m.index < map.length ? map[m.index] : text.length
        add(re.source, lineOf(text, origOffset))
      }
    }
  }
  return hits
}

/** Recursively collect `*.ts` files under `dir`, EXCLUDING this lint's own files. */
function collectCoreTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectCoreTs(full))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !SELF_FILES.includes(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Source roots that SHIP when understudy is published — the whole harness, not just `core/`. */
export const PUBLISHABLE_ROOTS: readonly string[] = [
  'core',
  'heal',
  'adapters',
  'scripts',
  'llm',
  'docs',
  '.github',
]

/** Directories never published / not authored source — skipped by the tree walk. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'test-results',
  'playwright-report',
  '.playwright-mcp',
  'dist',
  'build',
])

/** File kinds where an internal name could ship: code, prose docs, CI/workflow, config. */
const PUBLISHABLE_EXT = /\.(ts|tsx|js|mjs|cjs|md|ya?ml|json)$/

/** Recursively collect publishable files (by extension) under `dir`, skipping SKIP_DIRS and this
 * lint's own files. */
function collectPublishable(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...collectPublishable(path.join(dir, entry.name)))
    } else if (entry.isFile() && PUBLISHABLE_EXT.test(entry.name) && !SELF_FILES.includes(entry.name)) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/**
 * Scan the WHOLE publishable tree (PUBLISHABLE_ROOTS under `repoRoot`, plus root-level `*.md` such as
 * README/CONTRIBUTING/CLAUDE) for forbidden identifiers — the OSS-readiness regression guard. Broader
 * than `scanCoreDir`: prose docs and CI workflows ship too, and a name slips into prose more easily
 * than into typed code. Same consumer-supplied denylist + same no-op-when-unconfigured semantics. A
 * non-empty result MUST fail the gate (an internal identifier is about to be published).
 */
export function scanPublishableTree(
  repoRoot: string = process.cwd(),
  patterns: readonly RegExp[] = loadForbiddenPatterns(),
): { file: string; hits: { pattern: string; line: number }[] }[] {
  const files: string[] = []
  for (const root of PUBLISHABLE_ROOTS) {
    const abs = path.resolve(repoRoot, root)
    if (fs.existsSync(abs)) files.push(...collectPublishable(abs))
  }
  // Root-level docs (README.md, CONTRIBUTING.md, CLAUDE.md, …) ship too.
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.resolve(repoRoot, entry.name))
  }
  const out: { file: string; hits: { pattern: string; line: number }[] }[] = []
  for (const file of files) {
    const hits = scanForbidden(fs.readFileSync(file, 'utf-8'), patterns)
    if (hits.length > 0) out.push({ file, hits })
  }
  return out
}

/**
 * Scan every `core/*.ts` (recursively) for forbidden identifiers, EXCEPT this lint
 * and its spec. A non-empty result MUST fail the gate — an internal identifier is
 * about to ship in published source. With no denylist configured the scan is a no-op
 * (empty), which is correct for a public consumer guarding no internal names.
 */
export function scanCoreDir(
  coreDir: string = path.resolve(process.cwd(), 'core'),
  patterns: readonly RegExp[] = loadForbiddenPatterns(),
): { file: string; hits: { pattern: string; line: number }[] }[] {
  const out: { file: string; hits: { pattern: string; line: number }[] }[] = []
  for (const file of collectCoreTs(coreDir)) {
    const hits = scanForbidden(fs.readFileSync(file, 'utf-8'), patterns)
    if (hits.length > 0) out.push({ file, hits })
  }
  return out
}
