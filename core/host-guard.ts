/**
 * B10 — host-allowlist guard (CORE, project-agnostic). The server-like boundary
 * that makes "prod-never" load-bearing instead of discipline-dependent: resolve
 * the effective baseURL host and HARD-FAIL (cannot-run = RED, INV-6) on any host
 * not in the adapter's allow-list, BEFORE a browser launches — the client-side
 * mirror of a server-side allow-list rejection (e.g. a 422).
 *
 * Generic: takes a baseURL + an allow-list. The WHICH (the consumer's allow-list)
 * comes from the adapter config; this file knows no consumer.
 */

/** Effective host (hostname + port) of a baseURL. Throws cannot-run on a bad URL. */
export function effectiveHost(baseURL: string): string {
  try {
    return new URL(baseURL).host
  } catch {
    throw new Error(`cannot-run (RED): baseURL "${baseURL}" is not a valid URL`)
  }
}

/**
 * Hard-fail unless the baseURL host is allow-listed. Call from a `globalSetup`
 * (wired by the LIVE config) so it fires before any browser launches.
 */
export function assertHostAllowed(baseURL: string, allowlist: readonly string[]): void {
  const host = effectiveHost(baseURL)
  if (!allowlist.includes(host)) {
    throw new Error(
      `cannot-run (RED): target host "${host}" is not allow-listed ` +
        `[${allowlist.join(', ')}]. Refusing to run against a non-allow-listed host ` +
        `(mirrors a server-side allow-list rejection, e.g. a 422; INV-6).`,
    )
  }
}

/**
 * Exploration-safety rail (§4.5): free agent exploration must run on mock/local
 * ONLY — never the live target. Hard-fail unless the host is localhost-class.
 */
export function assertExplorationLocal(baseURL: string): void {
  const hostname = new URL(baseURL).hostname
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)
  if (!isLocal) {
    throw new Error(
      `cannot-run (RED): free exploration must run on mock/local, but baseURL ` +
        `host "${effectiveHost(baseURL)}" is not localhost. The live target is for ` +
        `final curated verification only (§4.5).`,
    )
  }
}
