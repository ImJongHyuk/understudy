/**
 * heal/edit — robust spec editing. Exact-substring replace is the WORST edit format for weak
 * models: they reproduce the `old` string with drifted indentation / spacing / quotes and the edit
 * silently fails ("old not found"), which then looks like a *reasoning* failure. (Research: making
 * only the edit tool robust lifts the weakest models' edit-success by up to ~10x.) So `applyReplace`
 * tries exact → whitespace-flexible, and on a real miss returns a numbered snippet of the nearest
 * lines so the model can correct — separating edit-APPLY failures from genuine root-cause failures.
 */

export interface EditResult {
  readonly ok: boolean
  readonly spec?: string
  readonly error?: string
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Match `oldStr` ignoring leading/trailing whitespace and treating internal whitespace runs as
 * flexible (`\s+`), so indent/spacing drift still lands. Returns the matched span or null. */
function findWhitespaceFlexible(spec: string, oldStr: string): { start: number; end: number } | null {
  const trimmed = oldStr.trim()
  if (!trimmed) return null
  // Build a regex: escape literals, collapse whitespace runs to \s+.
  const pattern = trimmed
    .split(/\s+/)
    .map(escapeRe)
    .join('\\s+')
  const re = new RegExp(pattern)
  const m = re.exec(spec)
  return m ? { start: m.index, end: m.index + m[0].length } : null
}

/** Up to `k` source lines most similar to `oldStr` (shared-token overlap), numbered, for a miss hint. */
function nearestLines(spec: string, oldStr: string, k = 3): string {
  const wanted = new Set(oldStr.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
  const lines = spec.split('\n')
  const scored = lines.map((line, i) => {
    const toks = line.toLowerCase().match(/[a-z0-9_]+/g) ?? []
    const overlap = toks.filter((t) => wanted.has(t)).length
    return { n: i + 1, line, overlap }
  })
  return scored
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, k)
    .map((s) => `  ${s.n}: ${s.line}`)
    .join('\n')
}

/** Robust replace: exact → whitespace-flexible. On miss, a helpful numbered-snippet error. */
export function applyReplace(spec: string, oldStr: string, replacement: string): EditResult {
  if (!oldStr) return { ok: false, error: 'the `old` string is empty' }
  const idx = spec.indexOf(oldStr)
  if (idx !== -1) {
    return { ok: true, spec: spec.slice(0, idx) + replacement + spec.slice(idx + oldStr.length) }
  }
  const flex = findWhitespaceFlexible(spec, oldStr)
  if (flex) {
    return { ok: true, spec: spec.slice(0, flex.start) + replacement + spec.slice(flex.end) }
  }
  const near = nearestLines(spec, oldStr)
  return {
    ok: false,
    error: `\`old\` not found (tried exact + whitespace-flexible).${near ? ` Nearest lines:\n${near}` : ''}`,
  }
}
