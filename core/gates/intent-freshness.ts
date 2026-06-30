/**
 * Intent-freshness gate (CORE, project-agnostic) — the deterministic guard against a STALE oracle
 * (SPEC §7.3 / the "generated assertions encode current behaviour as correct" risk). E2E's correctness
 * oracle is INTENT, not the implementation's current behaviour; intent rots if nobody re-confirms it.
 * So each Critical User Flow carries an intended-outcome RECORD: a provenance pointer (where the intent
 * comes from — an SSOT section, issue#, plan doc) + a last-validated marker (when it was last confirmed
 * against the product's INTENDED behaviour). This check flags any CUF whose provenance is missing or
 * whose marker is stale, to BLOCK PROMOTION (it never touches the deterministic run — a stale oracle is
 * a trust problem, not a red test).
 *
 * Pure + deterministic (LLM-free, and `now` is INJECTED — core never reads a clock), so it is a real
 * gate property. Consumer-agnostic: the records + the staleness budget are supplied by the caller (the
 * adapter's intended-outcome records / its freshness policy), never hard-coded here. The core decides;
 * parsing records out of spec files / a manifest is the caller's I/O, mirroring the negative-control
 * classifier (pure) vs its runner (injected I/O). Mutation-proven in
 * core/conformance/intent-freshness.spec.ts.
 */

export type IntentFreshnessReason = 'missing-provenance' | 'missing-marker' | 'stale' | 'orphan'

/** One CUF's intended-outcome record. `id` is opaque to core (e.g. the spec path). */
export interface IntentRecord {
  readonly id: string
  /** Provenance pointer: where the intended outcome comes from (SSOT ref / issue# / plan doc). */
  readonly oracle?: string
  /** Last-validated marker, ISO calendar date 'YYYY-MM-DD' (when the intent was last re-confirmed). */
  readonly lastValidated?: string
}

export interface IntentStaleness {
  readonly id: string
  readonly reason: IntentFreshnessReason
  readonly detail?: string
}

export interface IntentFreshnessOptions {
  /** "Today", ISO 'YYYY-MM-DD', INJECTED by the caller — core never reads the system clock. */
  readonly now: string
  /** A record older than this many days is `stale` (age === maxAgeDays is still fresh). */
  readonly maxAgeDays: number
  /** The full set of CUF ids that MUST carry a fresh record (e.g. the actual gate spec files). A
   * required id with no record → `missing-provenance`; a record whose id isn't required → `orphan`.
   * Omit to check only the records given (no presence/orphan cross-check). */
  readonly required?: readonly string[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse a strict 'YYYY-MM-DD' to a UTC day-number; null if malformed OR a rollover (e.g. month 13).
 * Date.UTC is a pure function of its args (not the clock), so this stays deterministic. */
function dayNumber(iso: string): number | null {
  if (!DATE_RE.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const dt = new Date(ms)
  // reject silent rollover ('2026-13-40' → next year): the round-trip must equal the input parts.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return Math.floor(ms / 86_400_000)
}

/**
 * Return every freshness violation across the intended-outcome records (empty = all fresh → promotion
 * allowed). Reasons: `missing-provenance` (a required CUF has no record, or a record has no oracle),
 * `missing-marker` (no/!parseable lastValidated), `stale` (validated > maxAgeDays ago), `orphan` (a
 * record for a CUF not in `required`). Deterministic + side-effect-free.
 */
export function checkIntentFreshness(
  records: readonly IntentRecord[],
  opts: IntentFreshnessOptions,
): IntentStaleness[] {
  const nowDay = dayNumber(opts.now)
  if (nowDay === null) {
    throw new Error(`checkIntentFreshness: invalid 'now' date '${opts.now}' (want YYYY-MM-DD)`)
  }
  const out: IntentStaleness[] = []
  const byId = new Map<string, IntentRecord>()
  for (const r of records) byId.set(r.id, r)
  const requiredSet = opts.required ? new Set(opts.required) : null

  // 1) Every required CUF must have a record at all.
  if (requiredSet) {
    for (const id of requiredSet) {
      if (!byId.has(id)) out.push({ id, reason: 'missing-provenance', detail: 'no intent record for a required CUF' })
    }
  }

  // 2) Each record: in-scope, provenance present, marker present + parseable, and fresh.
  for (const r of records) {
    if (requiredSet && !requiredSet.has(r.id)) {
      out.push({ id: r.id, reason: 'orphan', detail: 'record for a CUF not in the required set' })
      continue
    }
    if (!r.oracle || r.oracle.trim() === '') {
      out.push({ id: r.id, reason: 'missing-provenance', detail: 'empty oracle (no provenance pointer)' })
      continue
    }
    const day = r.lastValidated ? dayNumber(r.lastValidated) : null
    if (day === null) {
      out.push({ id: r.id, reason: 'missing-marker', detail: `unparseable lastValidated '${r.lastValidated ?? ''}'` })
      continue
    }
    const ageDays = nowDay - day
    if (ageDays > opts.maxAgeDays) {
      out.push({ id: r.id, reason: 'stale', detail: `validated ${ageDays}d ago (budget ${opts.maxAgeDays}d)` })
    }
  }

  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}
