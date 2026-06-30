/**
 * Adapter manifest (C5) for the hermetic RealWorld reference consumer. Note what
 * is ABSENT vs an allow-listed backend: there is no server-side allow-list, so the
 * safety gate is host-locality (assertSafeTarget = localhost) — the contract bends
 * cleanly to a backend without that allow-list discipline. No secrets here.
 */
import { realworldAuthAdapter } from './auth.adapter'
import { realworldSeedAdapter } from './seed.adapter'

export const realworldAdapterConfig = {
  id: 'realworld-conduit',
  auth: realworldAuthAdapter,
  seed: realworldSeedAdapter,
  // B10 host allow-list — the local hermetic app only.
  hostAllowlist: ['localhost:3000', '127.0.0.1:3000'] as const,
  fixturePrefix: 'understudy-e2e-',
  // a11y + raw HTTP floor; no contract enrichment.
  enrichment: { openapi: false },
} as const

export type RealworldAdapterConfig = typeof realworldAdapterConfig
