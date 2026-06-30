/**
 * B11 — trace redaction + pre-upload leak-check (CORE, project-agnostic). The
 * server-like boundary that makes "no secret leaves in an artifact" load-bearing.
 * A run may upload a `trace.zip` ONLY after `scanForLeaks` is clean; redaction
 * scrubs known secret VALUES, sensitive header values, and generic token SHAPES.
 *
 * GENERIC by construction (no consumer identifiers): the core ships sensitive
 * HEADER names + provider-agnostic token SHAPES (Bearer/Basic/JWT). The specific
 * ENV VAR NAMES whose values are secrets, and any project-specific token shapes,
 * are supplied BY THE ADAPTER via `buildDenylist({ envNames, extraPatterns })` —
 * not hard-coded here. (Mirrors the L10 no-mechanism-in-core stance for auth.)
 *
 * The `playwright/.auth/` storageState + extra-state files are excluded from uploads
 * entirely (gitignored; never added to the artifact) — see the upload step.
 *
 * Mutation-proven in core/conformance/trust.spec.ts.
 */

export interface Denylist {
  /** Literal secret VALUES (resolved from env names) that must never appear verbatim. */
  readonly values: readonly string[]
  /** Sensitive header/field NAMES whose accompanying value is a secret. */
  readonly names: readonly string[]
  /** Token SHAPES to scrub (generic + any adapter-supplied). */
  readonly patterns: readonly RegExp[]
}

/** Sensitive header NAMES (case-insensitive) — universal. */
export const SENSITIVE_HEADER_NAMES = [
  'authorization',
  'cookie',
  'set-cookie',
  'api-key',
  'x-api-key',
] as const

/** Provider-agnostic token SHAPES — SOURCE strings (the `g` flag is added per use). */
const TOKEN_PATTERN_SOURCES = [
  'Bearer\\s+[A-Za-z0-9._~+/-]{10,}={0,2}',
  'Basic\\s+[A-Za-z0-9+/]{10,}={0,2}',
  // JWT: three base64url segments
  'eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}',
] as const

export interface DenylistOptions {
  /** Env source (defaults to `process.env`). */
  readonly env?: NodeJS.ProcessEnv
  /** Adapter-supplied env var NAMES whose VALUES are secrets to scrub. */
  readonly envNames?: readonly string[]
  /** Adapter-supplied extra token/secret SHAPES (e.g. a provider's key prefix). */
  readonly extraPatterns?: readonly RegExp[]
}

export function buildDenylist(opts: DenylistOptions = {}): Denylist {
  const env = opts.env ?? process.env
  const values = (opts.envNames ?? [])
    .map((n) => env[n])
    .filter((v): v is string => typeof v === 'string' && v.length >= 4)
  return {
    values,
    names: SENSITIVE_HEADER_NAMES,
    patterns: [
      ...TOKEN_PATTERN_SOURCES.map((s) => new RegExp(s, 'gi')),
      ...(opts.extraPatterns ?? []),
    ],
  }
}

/** A header line that actually carries a value, e.g. `authorization: Bearer x`. */
function headerRegex(name: string): RegExp {
  return new RegExp(`"?${name}"?\\s*[:=]\\s*\\S`, 'i')
}

/**
 * Return the kinds of leak found (empty = clean). The pre-upload gate: a non-empty
 * result MUST fail the run before any artifact upload. Reports CATEGORIES, never the
 * secret itself.
 */
export function scanForLeaks(text: string, dl: Denylist): string[] {
  const hits: string[] = []
  for (const v of dl.values) {
    if (v && text.includes(v)) hits.push('value:env-secret')
  }
  for (const src of dl.patterns) {
    // Fresh, non-global regex for a stateless test.
    if (new RegExp(src.source, src.flags.replace('g', '')).test(text)) {
      hits.push(`pattern:${src.source}`)
    }
  }
  for (const name of dl.names) {
    if (headerRegex(name).test(text)) hits.push(`header:${name}`)
  }
  return [...new Set(hits)]
}

const MASK = '***REDACTED***'

/** Scrub secret VALUES + token SHAPES + sensitive header values from text. */
export function redact(text: string, dl: Denylist): string {
  let out = text
  for (const v of dl.values) {
    if (v) out = out.split(v).join(MASK)
  }
  for (const src of dl.patterns) {
    out = out.replace(new RegExp(src.source, src.flags.includes('g') ? src.flags : src.flags + 'g'), MASK)
  }
  for (const name of dl.names) {
    out = out.replace(
      new RegExp(`("?${name}"?\\s*[:=]\\s*)(\\S+)`, 'gi'),
      `$1${MASK}`,
    )
  }
  return out
}
