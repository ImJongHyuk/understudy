/**
 * heal/probe — pure helpers for the GROUNDING PROBE: `get_accessibility(path, clicks?)` can click
 * named buttons/links after navigating, then snapshot — so the model can ground INTERACTION-GATED
 * state (e.g. a list behind a "show all" tab) instead of guessing. The diagnosis showed the nav
 * ceiling was exactly this: the model root-causes correctly but can't *see* the corrected target
 * (it lives behind a click), so it guesses URLs. These helpers normalize the model-supplied click
 * list and turn each name into a lenient matcher. Pure (no browser) → conformance-verifiable.
 */

/** Max clicks honored in one probe — bounded so a model can't request an unbounded action chain. */
export const MAX_PROBE_CLICKS = 5

/** Coerce a model-supplied `clicks` argument into a clean, bounded list of non-empty names. */
export function parseClicks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue // accessible names are strings; drop malformed entries
    const s = x.trim()
    if (s) out.push(s)
    if (out.length >= MAX_PROBE_CLICKS) break
  }
  return out
}

/** A lenient accessible-name matcher: case-insensitive SUBSTRING, with regex specials escaped (the
 * name comes from the model, so "Order #1" must match literally, never as a regex). */
export function nameMatcher(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, 'i')
}
